import {bindEntryStartupIdentity} from './services/entryStartupPolicy.js';
import {TradingQualityRuntimeObserver} from './services/tradingQualityRuntimeObserver.js';
import { OperationalLogger } from './services/operationalLogger.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRuntime } from './runtime/appRuntime.js';
import { createHttpServer } from './server.js';
import { redactAudit } from './api/projections.js';
import { createRuntimeIdentity } from './runtime/runtimeIdentity.js';
import { installProcessLifecycleTelemetry,processErrorFact } from './runtime/processLifecycleTelemetry.js';
import { RELEASE_VERSION } from '@zdj/contracts';
// A fresh real process never inherits an implicit Entry write authorization.
process.env.ZDJ_ENTRY_EXECUTION_POLICY ??= 'ANALYSIS_ONLY';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const host=process.env.ZDJ_HOST??'0.0.0.0',port=Number(process.env.ZDJ_PORT??8080),configDir=path.resolve(process.env.ZDJ_CONFIG_DIR??path.join(root,'config')),dataDir=path.resolve(process.env.ZDJ_DATA_DIR??path.join(root,'data'));
const lifecycle=installProcessLifecycleTelemetry(dataDir);lifecycle.record('PROCESS_START',{releaseVersion:RELEASE_VERSION,host,port,startReason:process.env.ZDJ_START_REASON??null});
lifecycle.record('BOOTSTRAP_STARTED',{configDir,dataDir});
let identityRecord:Awaited<ReturnType<typeof createRuntimeIdentity>>,runtime:EngineRuntime;
try{
  identityRecord=await createRuntimeIdentity(dataDir,host,port,RELEASE_VERSION);
  bindEntryStartupIdentity(identityRecord.identity);
  runtime=await EngineRuntime.create({configDir,dataDir});
  lifecycle.record('BOOTSTRAP_RUNTIME_CREATED',{instanceId:identityRecord.identity.instanceId,recoveredRuntimeEntities:runtime.settingsStore.runtimeLoadRecoveries});
}catch(error){lifecycle.record('BOOTSTRAP_FAILED',{error:processErrorFact(error)});throw error;}
runtime.setRuntimeIdentity(identityRecord.identity);
try{runtime.qualityObserver=new TradingQualityRuntimeObserver(dataDir,runtime.state);}catch(error){runtime.events.publish('V393_OBSERVER_UNAVAILABLE',{reason:String(error)});}
const logger=new OperationalLogger(path.join(dataDir,'runtime-logs'),{...identityRecord.identity,environment:runtime.state.settings.connections.exchange.environment},{maxFileBytes:Number(process.env.ZDJ_LOG_MAX_FILE_BYTES??104857600),maxTotalBytes:Number(process.env.ZDJ_LOG_MAX_TOTAL_BYTES??2147483648),retentionDays:Number(process.env.ZDJ_LOG_RETENTION_DAYS??7)});
(runtime as any).operationalLogHealth=()=>logger.health();
runtime.events.on('event',event=>logger.record(event));
if(runtime.settingsStore.runtimeLoadRecoveries.length)runtime.events.publish('RUNTIME_ENTITY_REPLAYED_FROM_EXACT_EVENT',{recoveries:runtime.settingsStore.runtimeLoadRecoveries,historicalRecordsModified:false});
runtime.events.publish(identityRecord.identity.startReason==='SUPERVISOR_RESTART'?'SUPERVISOR_RESTART':'ENGINE_INSTANCE_STARTED',{instanceId:identityRecord.identity.instanceId,pid:process.pid,startReason:identityRecord.identity.startReason,restartCount:identityRecord.identity.restartCount});
if(identityRecord.previous&&JSON.stringify(identityRecord.previous.lanIps??[])!==JSON.stringify(identityRecord.identity.lanIps))runtime.events.publish('LAN_IP_CHANGED',{previous:identityRecord.previous.lanIps??[],current:identityRecord.identity.lanIps,instanceId:identityRecord.identity.instanceId});
const {server}=createHttpServer(runtime);let shuttingDown=false;const shutdown=async(reason='SHUTDOWN',exitCode=0)=>{if(shuttingDown)return;shuttingDown=true;process.exitCode=exitCode;lifecycle.record('SHUTDOWN_REQUESTED',{reason,exitCode,instanceId:identityRecord.identity.instanceId});runtime.events.publish('LAN_ENGINE_PROCESS_EXITED',{pid:process.pid,instanceId:identityRecord.identity.instanceId,reason,exitCode});try{runtime.stop();}catch(error){logger.record({type:'SHUTDOWN_PERSISTENCE_FAILED',ts:Date.now(),payload:{message:String(error)}});}finally{await logger.close();server.close(()=>{lifecycle.record('HTTP_SERVER_CLOSED',{reason,exitCode});process.exit(exitCode);});}};
server.on('error',(error:any)=>{lifecycle.record('HTTP_SERVER_ERROR',{port,error:processErrorFact(error)});runtime.events.publish('LAN_PORT_OWNERSHIP_CHANGED',{message:error instanceof Error?error.message:String(error),code:error?.code??null,port});if(error?.code==='EADDRINUSE')process.exitCode=1;});
server.listen(port,host,()=>{lifecycle.record('HTTP_LISTENING',{host,port,instanceId:identityRecord.identity.instanceId});runtime.events.publish('LAN_AVAILABLE',{host,port,pid:process.pid,lanIps:identityRecord.identity.lanIps});console.log(JSON.stringify({ts:Date.now(),level:'info',event:'HTTP_LISTENING',host,port,dataMode:runtime.state.settings.connections.marketDataMode,aiMode:runtime.state.settings.connections.aiMode,instanceId:identityRecord.identity.instanceId,lanIps:identityRecord.identity.lanIps,startReason:identityRecord.identity.startReason}));});
void runtime.start().catch(error=>{lifecycle.record('RUNTIME_START_FAILED',{error:processErrorFact(error)});runtime.events.publish('RUNTIME_BOOTSTRAP_FAILED',{message:error instanceof Error?error.message:String(error)});});
process.on('uncaughtException',error=>{process.exitCode=1;lifecycle.record('ENGINE_FATAL_HANDLER',{kind:'uncaughtException',error:processErrorFact(error)});runtime.events.publish('ENGINE_FATAL_ERROR',{message:error instanceof Error?error.message:String(error)});console.error(error);void shutdown('UNCAUGHT_EXCEPTION',1);});
process.on('unhandledRejection',reason=>{process.exitCode=1;lifecycle.record('ENGINE_FATAL_HANDLER',{kind:'unhandledRejection',error:processErrorFact(reason)});runtime.events.publish('ENGINE_FATAL_ERROR',{message:reason instanceof Error?reason.message:String(reason),kind:'unhandledRejection'});console.error(reason);void shutdown('UNHANDLED_REJECTION',1);});
process.on('SIGINT',()=>{void shutdown('SIGINT',0);});process.on('SIGTERM',()=>{void shutdown('SIGTERM',0);});const exitAfterMs=Number(process.env.ZDJ_EXIT_AFTER_MS??0);if(exitAfterMs>0)setTimeout(()=>{void shutdown('ZDJ_EXIT_AFTER_MS',0);},exitAfterMs).unref();

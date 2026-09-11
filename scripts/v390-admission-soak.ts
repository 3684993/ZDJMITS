import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';import {DatabaseSync,backup} from 'node:sqlite';
import {OperationalLogger} from '../apps/engine/src/services/operationalLogger.js';import {SettingsStore} from '../apps/engine/src/config/settingsStore.js';
const durationMs=Number(process.env.ZDJ_SOAK_DURATION_MS??7200000),dir=process.env.ZDJ_SOAK_DATA_DIR??await mkdtemp(path.join(os.tmpdir(),'mits-admission-soak-')),report=path.resolve('docs/reports/v390-admission-soak.json'),store=new SettingsStore(path.resolve('config'),dir);
// Read-only snapshot of actual history volume; all writes target the isolated directory.
await writeFile(report,JSON.stringify({status:'PREPARING_FULL_DATABASE_BACKUP',isolatedDataDir:dir,exchangeCalls:0}));
if(!process.env.ZDJ_SOAK_DATA_DIR){const source=new DatabaseSync(path.resolve('data/zdj-settings.sqlite'),{readOnly:true});await backup(source,path.join(dir,'zdj-settings.sqlite'));source.close();}
if(path.resolve(dir).toLowerCase()===path.resolve('data').toLowerCase())throw new Error('ISOLATED_DATABASE_REQUIRED');
await store.load();const value=store.loadRuntime<any>();if(!value)throw new Error('RUNTIME_FIXTURE_REQUIRED');
const logger=new OperationalLogger(path.join(dir,'logs'),{instanceId:`soak-${Date.now()}`,buildId:'isolated',environment:'MOCK'},{maxFileBytes:1024*1024}),lag=monitorEventLoopDelay({resolution:10});lag.enable();
const startedAt=Date.now(),monotonicStart=performance.now(),prefix=`soak-${startedAt}:`,checkpointMs:number[]=[],auditMs:number[]=[];let batches=0,events=0,critical=0,failures=0;
const quantile=(rows:number[],q:number)=>[...rows].sort((a,b)=>a-b)[Math.min(rows.length-1,Math.floor(rows.length*q))]??0;
async function save(status:string){await writeFile(report,JSON.stringify({status,startedAt,durationMs,elapsedMs:performance.now()-monotonicStart,databaseScale:'FULL_9GB_SQLITE_BACKUP',isolatedDataDir:dir,productionWrites:0,exchangeCalls:0,events,critical,failures,checkpoint:store.checkpointMetrics(),checkpointP99:quantile(checkpointMs,.99),auditP99:quantile(auditMs,.99),eventLoopP99:lag.percentile(99)/1e6,logger:logger.health()},null,2));}
try{
 store.persistRuntime(value); // migration is measured separately from the steady-state samples
 while(performance.now()-monotonicStart<durationMs){
  const begin=performance.now();value.generation++;store.persistRuntime(value);checkpointMs.push(performance.now()-begin);
  for(let i=0;i<40;i++){logger.record({type:i%2?'CANDIDATE_RANKING_SHADOW':'SHADOW_SAMPLE_RECORDED',ts:Date.now(),payload:{data:'x'.repeat(8000)}});events++;}
  const time=performance.now();store.recordRuntimeEvent({id:`${prefix}${batches}`,type:'ENTRY_SUBMIT_ATTEMPTED',ts:Date.now(),symbol:'MOCKUSDT',payload:{intentId:`mock-${batches}`,clientOrderId:`isolated-${batches}`,exchangeWrites:0}});auditMs.push(performance.now()-time);critical++;
  batches++;if(batches%30===0)await save('RUNNING');await new Promise(r=>setTimeout(r,1000));
 }
 const stored=(store as any).db.prepare("SELECT count(*) AS n FROM runtime_events WHERE id LIKE ?").get(prefix+'%').n;if(stored!==critical)throw new Error('AUDIT_COUNT_MISMATCH');
 await logger.close();await save('COMPLETE');
}catch(error){failures++;await save('FAILED');throw error;}finally{lag.disable();await logger.close();store.close();}

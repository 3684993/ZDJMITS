import { Router, type NextFunction, type Request, type Response } from 'express';
import { isIP } from 'node:net';
import type { SystemSettings } from '@zdj/contracts';
import { loadAiResources } from '../config/aiResourceLoader.js';
import { reconfigureBinanceTransports } from '../adapters/binance/BinanceTransport.js';
import type { EngineRuntime } from '../runtime/appRuntime.js';

type RuntimeResourceKind='exchange'|'proxy'|'ai';
const aiLoadDefault=()=>({active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'等待动态交易池候选',queueDepth:0});

function canonicalProxy(settings:SystemSettings,item?:any):SystemSettings{
  const next=structuredClone(settings),current=next.connections.proxy;
  next.connections.proxy={...current,...(item?{enabled:item.enabled!==false,protocol:'SOCKS5H' as const,url:String(item.url??current.url),expectedStaticEgressIp:String(item.expectedStaticEgressIp??current.expectedStaticEgressIp??'').trim()||undefined}:{}),forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',bypassLocalhost:true,failClosed:true};
  return next;
}
function canonicalExchange(settings:SystemSettings,item:any):SystemSettings{
  const next=structuredClone(settings),current=next.connections.exchange,type=String(item?.type??item?.provider??current.provider);
  if(type!=='BINANCE_USDM')throw new Error('EXCHANGE_ADAPTER_UNSUPPORTED');
  const environment=String(item?.environment??current.environment);
  if(environment!=='TESTNET'&&environment!=='PRODUCTION')throw new Error('EXCHANGE_ENVIRONMENT_UNSUPPORTED');
  const rest=String(item?.restBaseUrl??item?.testnetRestBaseUrl??item?.productionRestBaseUrl??'');
  if(environment==='TESTNET'&&rest&&new URL(rest).hostname!=='demo-fapi.binance.com')throw new Error('TESTNET_REST_HOST_NOT_ALLOWED');
  next.connections.exchange={...current,provider:'BINANCE_USDM',environment:environment as 'TESTNET'|'PRODUCTION',
    ...(environment==='TESTNET'?{testnetBaseUrl:rest||current.testnetBaseUrl,testnetRestBaseUrl:rest||current.testnetRestBaseUrl||current.testnetBaseUrl,testnetWsBaseUrl:String(item?.wsBaseUrl??item?.testnetWsBaseUrl??current.testnetWsBaseUrl??'wss://stream.binancefuture.com/ws')}:{productionBaseUrl:rest||current.productionBaseUrl,productionRestBaseUrl:rest||current.productionRestBaseUrl||current.productionBaseUrl,productionWsBaseUrl:String(item?.wsBaseUrl??item?.productionWsBaseUrl??current.productionWsBaseUrl??'wss://fstream.binance.com/ws')}),
    credentialRef:String(item?.credentialRef??current.credentialRef),recvWindowMs:Number(item?.recvWindowMs??current.recvWindowMs),autoTimeSync:item?.autoTimeSync??current.autoTimeSync};
  return next;
}
function aiResource(item:any){
  const role=String(item?.role??'');if(role!=='SCOUT'&&role!=='PRIMARY_BRAIN')throw new Error('AI_RESOURCE_ROLE_UNSUPPORTED');
  return{id:String(item.id??''),role,enabled:item.enabled!==false,baseUrl:String(item.baseUrl??''),model:String(item.model??''),maxConcurrency:Number(item.maxConcurrency??1),gpu:String(item.gpu??'未指定')};
}
function rejectSecretFields(item:any){if(item&&['apiKey','apiSecret','secret','password','token'].some(key=>Object.prototype.hasOwnProperty.call(item,key)))throw new Error('RESOURCE_SECRET_FIELD_FORBIDDEN');}
function resourceView(settings:SystemSettings,kind:RuntimeResourceKind){
  if(kind==='exchange'){const x=settings.connections.exchange as any;return[{id:'binance-usdm',name:'Binance USD-M',type:'BINANCE_USDM',environment:x.environment,restBaseUrl:x.environment==='TESTNET'?(x.testnetRestBaseUrl??x.testnetBaseUrl):(x.productionRestBaseUrl??x.productionBaseUrl),wsBaseUrl:x.environment==='TESTNET'?(x.testnetWsBaseUrl??'wss://stream.binancefuture.com/ws'):(x.productionWsBaseUrl??'wss://fstream.binance.com/ws'),credentialRef:x.credentialRef,enabled:true,active:true,status:'READY'}];}
  if(kind==='proxy')return[{id:'binance-proxy',name:'SOCKS5H',type:'SOCKS5H',url:settings.connections.proxy.url,expectedStaticEgressIp:(settings.connections.proxy as any).expectedStaticEgressIp??'',enabled:settings.connections.proxy.enabled,active:true,status:settings.connections.proxy.enabled?'READY':'DISABLED'}];
  return settings.aiResources.map(item=>({...item,active:item.enabled,status:item.enabled?'READY':'DISABLED'}));
}
function syncAiRuntime(runtime:EngineRuntime,settings:SystemSettings){
  runtime.state.aiResources=loadAiResources(settings);const load=(runtime.ai as any).load as Map<string,any>,ids=new Set(runtime.state.aiResources.map(item=>item.id));
  for(const item of runtime.state.aiResources)if(!load.has(item.id))load.set(item.id,aiLoadDefault());
  for(const id of [...load.keys()])if(!ids.has(id))load.delete(id);
  void runtime.ai.probeResources().catch(error=>runtime.events.publish('AI_RESOURCE_HEALTH_REFRESH_FAILED',{message:error instanceof Error?error.message:String(error)}));
}
function hotApply(runtime:EngineRuntime,before:SystemSettings,after:SystemSettings){
  const a=before.connections.proxy,b=after.connections.proxy,proxyChanged=a.enabled!==b.enabled||a.url!==b.url||a.protocol!==b.protocol||a.binanceRestRoute!==b.binanceRestRoute;
  reconfigureBinanceTransports(after.connections);
  if(proxyChanged){const market=(runtime as any).market;if(market?.retentionSymbols&&market?.stop&&market?.setRetentionSymbols){const retained=market.retentionSymbols();market.stop();market.setRetentionSymbols(retained);}}
  syncAiRuntime(runtime,after);
}
export async function saveRuntimeSettings(runtime:EngineRuntime,input:unknown){
  const before=runtime.state.settings,expected=Number((input as any)?.settingsVersion);
  if(!Number.isInteger(expected)||expected<1)throw new Error('SETTINGS_VERSION_REQUIRED');
  const saved=await runtime.updateSettingsIfVersion(input,expected);hotApply(runtime,before,saved);return saved;
}
function expectedVersion(req:Request){const raw=req.body?.expectedSettingsVersion??req.header('if-match')??req.query.expectedSettingsVersion,n=Number(raw);if(!Number.isInteger(n)||n<1)throw new Error('SETTINGS_VERSION_REQUIRED');return n;}
function conflict(res:Response,error:unknown,currentVersion:number){if(String(error).includes('SETTINGS_VERSION_CONFLICT')){res.status(409).json({error:{message:'SETTINGS_VERSION_CONFLICT'},currentSettingsVersion:currentVersion});return true;}return false;}

export function createRuntimeSettingsResourcesRouter(runtime:EngineRuntime){
  const router=Router(),kindOf=(req:Request):RuntimeResourceKind=>{const kind=String(req.params.kind??'');if(!['exchange','proxy','ai'].includes(kind))throw new Error('RESOURCE_KIND_UNSUPPORTED');return kind as RuntimeResourceKind;};
  const legacy=canonicalProxy(runtime.state.settings),current=runtime.state.settings.connections.proxy,canonical=legacy.connections.proxy;
  if(current.forceBinanceRest!==canonical.forceBinanceRest||current.forceBinanceWs!==canonical.forceBinanceWs||current.proxyDns!==canonical.proxyDns||current.binanceRestRoute!==canonical.binanceRestRoute||current.failClosed!==canonical.failClosed)void saveRuntimeSettings(runtime,legacy).catch(error=>runtime.events.publish('SETTINGS_PROXY_MIGRATION_FAILED',{message:error instanceof Error?error.message:String(error)}));
  router.put('/settings',async(req,res,next)=>{try{
    const requested=req.body as SystemSettings,current=runtime.state.settings;
    const candidate=canonicalProxy({...requested,connections:{...requested.connections,exchange:current.connections.exchange,proxy:current.connections.proxy},aiResources:current.aiResources});
    res.json(await saveRuntimeSettings(runtime,candidate));
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  router.get('/settings/resources/:kind',(req,res,next)=>{try{const kind=kindOf(req);res.json({settingsVersion:runtime.state.settings.settingsVersion,items:resourceView(runtime.state.settings,kind)});}catch(error){next(error);}});
  const save=async(req:Request,res:Response,next:NextFunction)=>{try{
    const kind=kindOf(req),expected=expectedVersion(req),before=runtime.state.settings;rejectSecretFields(req.body);
    const id=kind==='proxy'?'binance-proxy':kind==='exchange'?'binance-usdm':String(req.params.id??req.body?.id??'');
    if(!id)throw new Error('RESOURCE_ID_REQUIRED');
    let nextSettings:SystemSettings,item:any;
    if(kind==='proxy'){const expected=String(req.body?.expectedStaticEgressIp??'').trim();if(expected&&!isIP(expected))throw new Error('PROXY_EXPECTED_EGRESS_IP_INVALID');item={id,name:req.body?.name??'SOCKS5H',type:'SOCKS5H',url:String(req.body?.url??before.connections.proxy.url),expectedStaticEgressIp:expected||undefined,enabled:req.body?.enabled!==false};nextSettings=canonicalProxy(before,item);}
    else if(kind==='exchange'){item={id,name:req.body?.name??'Binance USD-M',type:'BINANCE_USDM',environment:req.body?.environment??before.connections.exchange.environment,restBaseUrl:req.body?.restBaseUrl,wsBaseUrl:req.body?.wsBaseUrl,credentialRef:req.body?.credentialRef??before.connections.exchange.credentialRef,enabled:true};nextSettings=canonicalExchange(before,item);}
    else{item=aiResource({...req.body,id});nextSettings=structuredClone(before);nextSettings.aiResources=[...nextSettings.aiResources.filter(existing=>existing.id!==item.id),item];}
    const saved=await runtime.updateResourceSettings(nextSettings,expected,{kind,operation:'SAVE',id,value:item});hotApply(runtime,before,saved);
    res.json({...resourceView(saved,kind).find(row=>row.id===id)??item,settingsVersion:saved.settingsVersion});
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}};
  router.post('/settings/resources/:kind',save);router.put('/settings/resources/:kind/:id',save);
  router.delete('/settings/resources/:kind/:id',async(req,res,next)=>{try{
    const kind=kindOf(req),expected=expectedVersion(req),before=runtime.state.settings,id=String(req.params.id);
    if(kind==='exchange')return res.status(409).json({error:{message:'ACTIVE_EXCHANGE_DELETE_REQUIRES_REPLACEMENT'},currentSettingsVersion:before.settingsVersion});
    const nextSettings=structuredClone(before);
    if(kind==='proxy')nextSettings.connections.proxy={...nextSettings.connections.proxy,enabled:false,forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',failClosed:true};
    else nextSettings.aiResources=nextSettings.aiResources.filter(item=>item.id!==id);
    const saved=await runtime.updateResourceSettings(nextSettings,expected,{kind,operation:'DELETE',id:kind==='proxy'?'binance-proxy':id});hotApply(runtime,before,saved);
    res.status(204).setHeader('x-settings-version',String(saved.settingsVersion)).end();
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  return router;
}

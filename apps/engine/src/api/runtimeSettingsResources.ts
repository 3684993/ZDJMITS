import { Router, type NextFunction, type Request, type Response } from 'express';
import type { SystemSettings } from '@zdj/contracts';
import { loadAiResources } from '../config/aiResourceLoader.js';
import { reconfigureBinanceTransports } from '../adapters/binance/BinanceTransport.js';
import type { EngineRuntime } from '../runtime/appRuntime.js';

type RuntimeResourceKind='proxy'|'ai';
const aiLoadDefault=()=>({active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'等待动态交易池候选',queueDepth:0});

function canonicalProxy(settings:SystemSettings,item?:any):SystemSettings{
  const next=structuredClone(settings),current=next.connections.proxy;
  next.connections.proxy={...current,...(item?{enabled:item.enabled!==false,protocol:'SOCKS5H' as const,url:String(item.url??current.url)}:{}),forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',bypassLocalhost:true,failClosed:true};
  return next;
}
function aiResource(item:any){
  const role=String(item?.role??'');if(role!=='SCOUT'&&role!=='PRIMARY_BRAIN')throw new Error('AI_RESOURCE_ROLE_UNSUPPORTED');
  return{id:String(item.id??''),role,enabled:item.enabled!==false,baseUrl:String(item.baseUrl??''),model:String(item.model??''),maxConcurrency:Number(item.maxConcurrency??1),gpu:String(item.gpu??'未指定')};
}
function resourceView(settings:SystemSettings,kind:RuntimeResourceKind){
  if(kind==='proxy')return[{id:'binance-proxy',name:'SOCKS5H',type:'SOCKS5H',url:settings.connections.proxy.url,enabled:settings.connections.proxy.enabled,status:settings.connections.proxy.enabled?'READY':'DISABLED'}];
  return settings.aiResources.map(item=>({...item,status:item.enabled?'READY':'DISABLED'}));
}
function syncAiRuntime(runtime:EngineRuntime,settings:SystemSettings){
  runtime.state.aiResources=loadAiResources(settings);const load=(runtime.ai as any).load as Map<string,any>,ids=new Set(runtime.state.aiResources.map(item=>item.id));
  for(const item of runtime.state.aiResources)if(!load.has(item.id))load.set(item.id,aiLoadDefault());
  for(const id of [...load.keys()])if(!ids.has(id))load.delete(id);
  void runtime.ai.probeResources().catch(error=>runtime.events.publish('AI_RESOURCE_HEALTH_REFRESH_FAILED',{message:error instanceof Error?error.message:String(error)}));
}
export async function saveRuntimeSettings(runtime:EngineRuntime,input:unknown){
  const saved=await runtime.updateSettings(input);reconfigureBinanceTransports(saved.connections);syncAiRuntime(runtime,saved);return saved;
}

export function createRuntimeSettingsResourcesRouter(runtime:EngineRuntime){
  const router=Router(),guard=(req:Request,res:Response,next:NextFunction)=>{const kind=String(req.params.kind??'');if(kind!=='proxy'&&kind!=='ai')return next();return kind as RuntimeResourceKind;};
  router.put('/settings',async(req,res,next)=>{try{res.json(await saveRuntimeSettings(runtime,canonicalProxy(req.body as SystemSettings)));}catch(error){next(error);}});
  router.get('/settings/resources/:kind',(req,res,next)=>{const kind=guard(req,res,next);if(typeof kind!=='string')return;res.json({items:resourceView(runtime.state.settings,kind)});});
  const save=async(req:Request,res:Response,next:NextFunction)=>{const kind=guard(req,res,next);if(typeof kind!=='string')return;try{const current=runtime.state.settings;let nextSettings:SystemSettings,item:any;if(kind==='proxy'){item={...req.body,id:'binance-proxy',type:'SOCKS5H',name:req.body?.name??'SOCKS5H'};nextSettings=canonicalProxy(current,item);}else{item=aiResource(req.body);nextSettings=structuredClone(current);nextSettings.aiResources=[...nextSettings.aiResources.filter(existing=>existing.id!==item.id),item];}
      const saved=await saveRuntimeSettings(runtime,nextSettings);await runtime.settingsStore.resourceSave(kind,item);res.json(resourceView(saved,kind).find(row=>row.id===(kind==='proxy'?'binance-proxy':item.id))??item);
    }catch(error){next(error);}};
  router.post('/settings/resources/:kind',save);router.put('/settings/resources/:kind',save);
  router.delete('/settings/resources/:kind/:id',async(req,res,next)=>{const kind=guard(req,res,next);if(typeof kind!=='string')return;try{const current=runtime.state.settings,nextSettings=structuredClone(current);if(kind==='proxy')nextSettings.connections.proxy={...nextSettings.connections.proxy,enabled:false,forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',failClosed:true};else nextSettings.aiResources=nextSettings.aiResources.filter(item=>item.id!==req.params.id);await saveRuntimeSettings(runtime,nextSettings);await runtime.settingsStore.resourceDelete(kind,kind==='proxy'?'binance-proxy':req.params.id);res.status(204).end();}catch(error){next(error);}});
  return router;
}
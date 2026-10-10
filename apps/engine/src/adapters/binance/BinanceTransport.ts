import {isIP} from 'node:net';
import {resolveBinanceWsEndpoint, type BinanceWsLane} from './wsEndpoint.js';
import {binanceReadContext} from './binanceReadContext.js';
import { createHash, randomUUID } from 'node:crypto';
import { getBinanceRequestBudget, binanceBudgetLane, binanceHealthBlocksEntry, binanceEntryBlockReason, type RequestBudgetMeta } from './requestBudget.js';
import {storageEntryBlockReason} from '../../services/storageCapacityGuard.js';
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ConnectionSettings } from '@zdj/contracts';
const TESTNET_REST_ALLOWLIST=new Set(['demo-fapi.binance.com']);
export function isAllowedTestnetRestHost(host:string){return TESTNET_REST_ALLOWLIST.has(String(host).toLowerCase());}
function klineWeight(limit:number){return limit<100?1:limit<500?2:limit<=1000?5:10;}function depthWeight(limit:number){return limit<=50?2:limit<=100?5:limit<=500?10:20;}
export function binanceRequestWeight(url:URL,method='GET'){const p=url.pathname,hasSymbol=url.searchParams.has('symbol'),limit=Math.max(1,Number(url.searchParams.get('limit')??0)||500);if(p.endsWith('/time')||p.endsWith('/exchangeInfo')||p.endsWith('/openInterest')||p.endsWith('/fundingRate')||p.endsWith('/listenKey')||p.endsWith('/leverage'))return 1;if(p.endsWith('/klines')||p.endsWith('/markPriceKlines')||p.endsWith('/indexPriceKlines')||p.endsWith('/continuousKlines'))return klineWeight(limit);if(p.endsWith('/depth'))return depthWeight(limit);if(p.endsWith('/ticker/24hr'))return hasSymbol?1:40;if(p.endsWith('/ticker/bookTicker'))return hasSymbol?2:5;if(p.endsWith('/premiumIndex'))return hasSymbol?1:10;if(p.endsWith('/income'))return 30;if(p.endsWith('/openOrders'))return hasSymbol?1:40;if(p.endsWith('/account')||p.endsWith('/balance')||p.endsWith('/positionRisk'))return 5;if(p.endsWith('/openAlgoOrders'))return hasSymbol?1:40;if(p.endsWith('/multiAssetsMargin')||p.endsWith('/commissionRate'))return 30;if(p.endsWith('/userTrades')||p.endsWith('/allOrders'))return 5;if(p.endsWith('/order'))return method==='POST'?0:1;if(p.endsWith('/positionSide/dual')||p.endsWith('/leverageBracket'))return 30;throw new Error(`BINANCE_ENDPOINT_WEIGHT_UNREGISTERED:${method.toUpperCase()}:${p}`);}
export function inferredBinanceSource(url:URL,method:string){const p=url.pathname,m=method.toUpperCase();if(m==='POST'&&p.endsWith('/leverage'))return'EXECUTION_CRITICAL';if(m!=='GET'&&p.endsWith('/order'))return'EXECUTION_CRITICAL';if(p.endsWith('/order')||p.endsWith('/userTrades'))return'ORDER_VERIFICATION';if(p.endsWith('/account')||p.endsWith('/balance')||p.endsWith('/positionRisk')||p.endsWith('/positionSide/dual')||p.endsWith('/multiAssetsMargin')||p.endsWith('/leverageBracket')||p.endsWith('/commissionRate'))return'PRIVATE_STATE';if(p.endsWith('/income'))return'BACKGROUND_AUDIT';if(p.endsWith('/openOrders')||p.endsWith('/openAlgoOrders')||p.endsWith('/allOrders'))return'RECONCILIATION';if(p.endsWith('/listenKey'))return'USER_DATA_STREAM';if(p.endsWith('/exchangeInfo'))return'RATE_LIMIT_CONTROL';if(p.endsWith('/klines')||p.endsWith('/markPriceKlines')||p.endsWith('/indexPriceKlines')||p.endsWith('/continuousKlines')||p.endsWith('/depth')||p.endsWith('/ticker/24hr')||p.endsWith('/ticker/bookTicker')||p.endsWith('/premiumIndex')||p.endsWith('/openInterest')||p.endsWith('/fundingRate'))return'MARKET_DATA';if(p.endsWith('/time'))return'CLOCK';return'UNKNOWN';}
export function inferredBinancePurpose(url:URL,method:string){const p=url.pathname,m=method.toUpperCase();if(p.endsWith('/leverage')&&m==='POST')return'SET_ENTRY_LEVERAGE';if(p.endsWith('/order'))return m==='POST'?'SUBMIT_ORDER':m==='PUT'?'AMEND_ORDER':m==='DELETE'?'CANCEL_ORDER':'EXACT_ORDER_FACT';if(p.endsWith('/listenKey'))return m==='POST'?'CREATE_LISTEN_KEY':m==='PUT'?'KEEPALIVE_LISTEN_KEY':'DELETE_LISTEN_KEY';return `READ_${p.split('/').pop()!.replace(/[^A-Za-z0-9]/g,'_').toUpperCase()}`;}
function priorityFor(source:string):0|1|2|3|4{const lane=binanceBudgetLane(source);return lane==='EXECUTION'?0:lane==='PRIVATE_TRUTH'?1:lane==='CONTROL'?2:lane==='MARKET_PUBLIC'?3:4;}
export function shouldDeferAtTransport(source:string,health:{status:string;admissionObservedWeight1m:number|null;softPublicWeight:number;softBackgroundWeight:number},weight:number){const lane=binanceBudgetLane(source);if(lane!=='MARKET_PUBLIC'&&lane!=='BACKGROUND')return false;if(health.status==='SATURATED'||health.status==='RATE_LIMITED'||health.status==='RECOVERING'||health.status==='PERSISTENCE_FAILED'||health.status==='PRIVATE_ONLY')return true;const ceiling=lane==='BACKGROUND'?Math.min(health.softPublicWeight,health.softBackgroundWeight):health.softBackgroundWeight;return health.admissionObservedWeight1m!==null&&health.admissionObservedWeight1m+weight>ceiling;}
export function extractObservedIp(body:string){for(const match of body.matchAll(/\bIP\s*[(=:]?\s*([0-9a-f:.]+)/ig)){if(isIP(match[1]!))return match[1]!;}return null;}
export function binanceBudgetFailureMessage(message:string,meta:RequestBudgetMeta){return `${message}|requestId=${String(meta.requestId??'UNKNOWN')}|endpoint=${String(meta.endpoint??'UNKNOWN')}|method=${String(meta.method??'GET')}|source=${String(meta.source??'UNKNOWN')}|purpose=${String(meta.purpose??'UNSPECIFIED')}|routeIdentity=${String(meta.routeIdentity??'UNKNOWN')}`;}

const liveTransports=new Set<WeakRef<BinanceTransport>>();
type TransportFailure={message:string;completedAt:number;requestId:string;endpoint:string;method:string;routeIdentity:string;source:string;purpose:string;failurePhase:string|null};
const recentFailuresByRoute=new Map<string,TransportFailure[]>();
const recentSuccessByRoute=new Map<string,Map<string,number>>();
function recordTransportSuccess(meta:RequestBudgetMeta){const key=`${meta.method}:${meta.endpoint}`,rows=recentSuccessByRoute.get(String(meta.routeIdentity))??new Map<string,number>();rows.set(key,Date.now());recentSuccessByRoute.set(String(meta.routeIdentity),rows);}
function recordTransportFailure(meta:RequestBudgetMeta,message:string,failurePhase:string|null=null){const key=String(meta.routeIdentity),rows=recentFailuresByRoute.get(key)??[];rows.push({message:(message+(failurePhase?'|failurePhase='+failurePhase:'')).slice(0,600),failurePhase,completedAt:Date.now(),requestId:String(meta.requestId),endpoint:String(meta.endpoint),method:String(meta.method),routeIdentity:key,source:String(meta.source),purpose:String(meta.purpose)});recentFailuresByRoute.set(key,rows.slice(-100));}
export function shouldPublishTransportFailure(method:string,endpoint:string,message:string){if(!/^Binance HTTP|^BINANCE_TRANSPORT_BLOCKED/.test(message))return false;if(endpoint.endsWith('/order')&&((method==='GET'&&/"code"\s*:\s*-2013\b/.test(message))||(method==='DELETE'&&/"code"\s*:\s*-2011\b/.test(message))))return false;return true;}
function currentTransportFailures(routeIdentity:string){const now=Date.now(),successes=recentSuccessByRoute.get(routeIdentity);return(recentFailuresByRoute.get(routeIdentity)??[]).filter(row=>now-row.completedAt<120_000&&Number(successes?.get(`${row.method}:${row.endpoint}`)??0)<row.completedAt).slice(-50);}
export function reconfigureBinanceTransports(settings:ConnectionSettings){for(const ref of [...liveTransports]){const transport=ref.deref();if(transport)transport.reconfigure(settings);else liveTransports.delete(ref);}}

const proxyConnectTiming=new WeakMap<Parameters<SocksProxyAgent['connect']>[0],{proxyConnectStartedAt:number|null;proxyConnectedAt:number|null}>();
const proxyConnectDeadlines=new WeakMap<Parameters<SocksProxyAgent['connect']>[0],number>();

/** Bound the actual SOCKS negotiation, which otherwise ignores ClientRequest abort until it returns. */
class BoundedSocksProxyAgent extends SocksProxyAgent {
 override connect(req:Parameters<SocksProxyAgent['connect']>[0],opts:Parameters<SocksProxyAgent['connect']>[1]){
  if(req.destroyed)return Promise.reject(new Error('Proxy request already aborted'));
  const deadline=proxyConnectDeadlines.get(req);if(deadline===undefined)return super.connect(req,opts);
  const timeout=Math.max(1,deadline-Date.now()),timing=proxyConnectTiming.get(req);if(timing)timing.proxyConnectStartedAt=Date.now();
  // A per-connect delegate avoids mutating one shared agent's timeout across concurrent requests.
  return new SocksProxyAgent(this.proxyUrl,{timeout,socketOptions:this.socketOptions??undefined}).connect(req,opts).then(socket=>{if(timing)timing.proxyConnectedAt=Date.now();return socket;});
 }
}

/** Single Binance network boundary. Exchange traffic is proxy-only and fail-closed. */
export class BinanceTransport {
 private agent:SocksProxyAgent|null=null;private budget!:ReturnType<typeof getBinanceRequestBudget>;private routeIdentity='proxy-unavailable';private settings:ConnectionSettings;private requestLimitFlight:Promise<void>|null=null;
 constructor(settings:ConnectionSettings){this.settings=settings;this.applyRoute();liveTransports.add(new WeakRef(this));}
 private applyRoute(){const retired=this.agent;if(this.settings.proxy.enabled&&this.settings.proxy.url)this.agent=new BoundedSocksProxyAgent(this.settings.proxy.url,{keepAlive:true,maxSockets:6,maxFreeSockets:6});else this.agent=null;
  // Preserve captured in-flight/queued requests, but leave no pooled idle socket on an old route.
  if(retired){retired.keepAlive=false;for(const sockets of Object.values(retired.freeSockets))for(const socket of sockets)socket.destroy();}
  const proxyHash=this.agent?createHash('sha256').update(this.settings.proxy.url).digest('hex').slice(0,12):'unavailable';this.routeIdentity=`proxy-${proxyHash}`;this.budget=getBinanceRequestBudget(this.settings.exchange.environment,this.routeIdentity);this.requestLimitFlight=null;}
 reconfigure(settings:ConnectionSettings){this.settings=settings;this.applyRoute();}
 dispose(){try{this.agent?.destroy();}catch{}this.agent=null;for(const ref of [...liveTransports]){const value=ref.deref();if(!value||value===this)liveTransports.delete(ref);}}
 effectiveBaseUrl(){const exchange=this.settings.exchange as typeof this.settings.exchange & {testnetRestBaseUrl?:string;productionRestBaseUrl?:string};return exchange.environment==='TESTNET'?(exchange.testnetRestBaseUrl??exchange.testnetBaseUrl):(exchange.productionRestBaseUrl??exchange.productionBaseUrl);}environment(){return this.settings.exchange.environment;}executionMode(){return this.settings.executionMode;}
 private assertProxy(){if(!this.settings.proxy.enabled||!this.agent)throw new Error('PROXY_REQUIRED: Binance exchange traffic is proxy-only and configured fail-closed');}
 requestBudgetHealth(){return{...this.budget.health(),routeIdentity:this.routeIdentity,route:this.restRoute()};}
 entryBlockReason(){if(!this.settings.proxy.enabled||!this.agent)return 'PROXY_REQUIRED';return binanceEntryBlockReason(this.settings.exchange.environment,this.routeIdentity);}
 restRoute(){const host=new URL(this.effectiveBaseUrl()).hostname;return{mode:'CONFIGURED' as const,throughProxy:Boolean(this.agent),host,routeIdentity:this.routeIdentity,proxyUrl:this.agent?this.settings.proxy.url:null,failClosed:true,deprecatedTestnetRestHost:host==='testnet.binancefuture.com'};}
 private restAgent(){this.assertProxy();return this.agent!;}
 assertTestnetExchangeWrite(){const url=new URL(this.effectiveBaseUrl());if(this.settings.exchange.environment!=='TESTNET'||this.settings.executionMode!=='TESTNET_ENABLED'||!isAllowedTestnetRestHost(url.hostname))throw new Error('TESTNET_ONLY_WRITE_LOCK: Binance Demo Testnet write disabled for this environment/host');this.assertProxy();}
 private configuredWsUrl(){const exchange=this.settings.exchange as typeof this.settings.exchange & {testnetWsBaseUrl?:string;productionWsBaseUrl?:string};return exchange.environment==='TESTNET'?(exchange.testnetWsBaseUrl??'wss://demo-fstream.binance.com'):(exchange.productionWsBaseUrl??'wss://fstream.binance.com');}
 effectiveWsUrl(lane:BinanceWsLane='PUBLIC'){return resolveBinanceWsEndpoint(this.settings.exchange.environment,this.configuredWsUrl(),lane);}
 websocketOptions(){this.assertProxy();return{agent:this.agent!};}
 websocketRoute(){const common={throughProxy:Boolean(this.agent),proxyUrl:this.agent?this.settings.proxy.url:null,routeIdentity:this.routeIdentity,failClosed:true};try{const configuredUrl=this.configuredWsUrl(),publicUrl=this.effectiveWsUrl('PUBLIC'),marketUrl=this.effectiveWsUrl('MARKET'),privateUrl=this.effectiveWsUrl('PRIVATE');return{...common,url:configuredUrl,publicUrl,marketUrl,privateUrl,tlsServername:new URL(marketUrl).hostname,configurationError:null};}catch(error){return{...common,url:null,publicUrl:null,marketUrl:null,privateUrl:null,tlsServername:null,configurationError:error instanceof Error?error.message:'BINANCE_WS_CONFIG_INVALID'};}}
 private assertBinance(url:URL){if(!(url.hostname==='binance.com'||url.hostname.endsWith('.binance.com'))&&!(url.hostname==='binancefuture.com'||url.hostname.endsWith('.binancefuture.com')))throw new Error(`Refusing non-Binance transport host: ${url.hostname}`);this.assertProxy();}
 private async ensureRequestWeightLimit(){if(this.budget.health().limitSource==='BINANCE_EXCHANGE_INFO')return;if(!this.requestLimitFlight){const flight=this.json<any>('/fapi/v1/exchangeInfo',{source:'RATE_LIMIT_CONTROL',purpose:'REQUEST_WEIGHT_DISCOVERY'}).then(()=>{}).finally(()=>{if(this.requestLimitFlight===flight)this.requestLimitFlight=null;});this.requestLimitFlight=flight;}await this.requestLimitFlight;}
 async json<T>(pathOrUrl:string,init:{method?:string;headers?:Record<string,string>;body?:string;timeoutMs?:number;source?:string;purpose?:string;signal?:AbortSignal;onDispatch?:(startedAt:number)=>void}={}):Promise<T>{
   const url=new URL(pathOrUrl,this.effectiveBaseUrl());this.assertBinance(url);
   if(url.origin!==new URL(this.effectiveBaseUrl()).origin)throw new Error('BINANCE_ENVIRONMENT_ORIGIN_MISMATCH');
   const method=(init.method??'GET').toUpperCase(),context=method==='GET'?binanceReadContext():undefined,signal=method==='GET'?(init.signal??context?.signal):undefined,
     source=init.source??context?.source??inferredBinanceSource(url,method);
   if(source==='UNKNOWN')throw new Error('BINANCE_ENDPOINT_SOURCE_UNREGISTERED:'+method+':'+url.pathname);
   if(signal?.aborted)throw new Error(`BINANCE_READ_ABORTED:${String(signal.reason)}`);
   if(source==='CLOCK'&&this.budget.health().limitSource==='CONSERVATIVE_DEFAULT')try{await this.ensureRequestWeightLimit();}catch{/* bounded clock recovery remains available */}
   const budget=this.budget,agent=this.restAgent(),priority=source==='PRIVATE_STATE'&&/\/(account|balance)$/.test(url.pathname)?0:source==='MARKET_DATA'&&/^QUOTE_/.test(String(init.purpose))?2:priorityFor(source),weight=binanceRequestWeight(url,method),
     meta:RequestBudgetMeta={requestId:randomUUID(),source,purpose:init.purpose??inferredBinancePurpose(url,method),endpoint:url.pathname,method,routeIdentity:this.routeIdentity,orderCount:url.pathname.endsWith('/order')&&(method==='POST'||method==='PUT')?1:0},budgetHealth=budget.health();
   if(shouldDeferAtTransport(source,budgetHealth,weight)){budget.recordDeferred(meta,weight);throw new Error(binanceBudgetFailureMessage(`BINANCE_REQUEST_BUDGET_DEFERRED:${budgetHealth.status}`,meta));}
   try{return await budget.run(priority,weight,()=>{
     if(init.purpose==='NEW_ENTRY'){const storageBlock=storageEntryBlockReason();if(storageBlock)throw new Error(`STORAGE_ENTRY_BLOCKED:${storageBlock}`);const health=budget.health();if(binanceHealthBlocksEntry(health.status))throw new Error(`BINANCE_ENTRY_BUDGET_BLOCKED:${health.status}`);}
     return new Promise<T>((resolve,reject)=>{
       const timeoutMs=init.timeoutMs??15_000,deadline=AbortSignal.timeout(timeoutMs),requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
       const timing={startedAt:Date.now(),proxyConnectStartedAt:null as number|null,proxyConnectedAt:null as number|null,socketAssignedAt:null as number|null,secureConnectedAt:null as number|null,responseAt:null as number|null,completedAt:null as number|null,reusedSocket:false,failurePhase:null as string|null};
       // A quote's observation bound starts at admitted wire dispatch, not while
       // waiting in admission. Network/body time remains part of its age.
       init.onDispatch?.(timing.startedAt);
       let removeSecureListener=()=>{},removeAbortListener=()=>{},settled=false;
       const finish=(failed=false)=>{if(settled)return false;settled=true;removeSecureListener();removeAbortListener();timing.completedAt=Date.now();if(failed)timing.failurePhase=signal?.aborted?'READ_BUDGET_ABORT':timing.responseAt?'RESPONSE_BODY':timing.secureConnectedAt?'FIRST_BYTE':timing.socketAssignedAt?'TLS_HANDSHAKE':timing.proxyConnectStartedAt?'SOCKS_NEGOTIATION':'AGENT_QUEUE';budget.recordNetworkTiming(meta,timing);return true;};
       const request=https.request(url,{method,headers:{'user-agent':'zdj-mits-v3/3.9',...init.headers},agent,timeout:timeoutMs,signal:requestSignal},response=>{
         timing.responseAt=Date.now();let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});
         response.once('error',error=>{if(finish(true))reject(error);});response.on('end',()=>{if(!finish())return;
           const status=response.statusCode??500,observedIp=(status===418||status===429)?extractObservedIp(body):null;
           budget.observeResponse(status,response.headers as Record<string,string|string[]|undefined>,response.headers['retry-after'] as string|undefined,meta,observedIp,Number(body.match(/banned until (\d+)/i)?.[1]??0));
           if(status>=400)return reject(new Error(`Binance HTTP ${status}: ${body.slice(0,512)}`));recordTransportSuccess(meta);
           try{const parsed=JSON.parse(body) as T;if(url.pathname.endsWith('/exchangeInfo')){const limits=(parsed as any)?.rateLimits;if(Array.isArray(limits))budget.configureRateLimits(limits);}resolve(parsed);}catch{reject(new Error('Binance returned invalid JSON'));}
         });
       });
       proxyConnectDeadlines.set(request,timing.startedAt+timeoutMs);proxyConnectTiming.set(request,timing);
       request.once('socket',socket=>{timing.socketAssignedAt=Date.now();timing.reusedSocket=request.reusedSocket;if((socket as any).encrypted&&(socket as any).secureConnecting!==true)timing.secureConnectedAt=Date.now();else{const connected=()=>{timing.secureConnectedAt=Date.now();};socket.once('secureConnect',connected);removeSecureListener=()=>socket.removeListener('secureConnect',connected);}});
       request.once('timeout',()=>request.destroy(new Error('Binance request timed out')));
       request.once('error',error=>{if(!finish(true))return;reject(new Error(signal?.aborted?`BINANCE_READ_ABORTED:${String(signal.reason)}`:`BINANCE_TRANSPORT_BLOCKED: ${error.name==='AbortError'?'Binance request timed out':error.message}`));});
       const aborted=()=>{request.destroy();if(finish(true))reject(new Error(signal?.aborted?`BINANCE_READ_ABORTED:${String(signal.reason)}`:'BINANCE_TRANSPORT_BLOCKED: Binance request timed out'));};
       requestSignal.addEventListener('abort',aborted,{once:true});removeAbortListener=()=>requestSignal.removeEventListener('abort',aborted);
       if(requestSignal.aborted)aborted();else request.end(init.body);
     });
   },meta,signal);}catch(error){
     const message=error instanceof Error?error.message:String(error);if(shouldPublishTransportFailure(method,url.pathname,message))recordTransportFailure(meta,message,budget.dispatchLedger().find(row=>row.requestId===meta.requestId)?.networkTiming?.failurePhase??null);
     if(message.startsWith('BINANCE_REQUEST_QUEUE_TIMEOUT')||message.startsWith('BINANCE_REQUEST_QUEUE_FULL')||message.startsWith('BINANCE_RATE_LIMIT_UNTIL:')||message.startsWith('BINANCE_REQUEST_BUDGET_DEFERRED:')||message.startsWith('BINANCE_READ_ABORTED:'))throw new Error(binanceBudgetFailureMessage(message,meta));throw error;
   }
 }

 async health(){this.assertProxy();const startedAt=Date.now(),serverTime=await this.json<{serverTime:number}>('/fapi/v1/time',{source:'HEALTH_PROBE',purpose:'SERVER_TIME'});return{status:'HEALTHY' as const,latencyMs:Date.now()-startedAt,serverTime,effectiveBaseUrl:this.effectiveBaseUrl(),throughProxy:true,route:this.restRoute(),requestBudget:this.requestBudgetHealth()};}
}
export function binanceTransportGovernance(){const routes=new Map<string,unknown>();for(const ref of [...liveTransports]){const transport=ref.deref();if(!transport){liveTransports.delete(ref);continue;}const route=transport.restRoute();routes.set(String(route.routeIdentity),{environment:transport.environment(),rest:route,ws:transport.websocketRoute(),requestBudget:transport.requestBudgetHealth(),recentFailures:currentTransportFailures(String(route.routeIdentity))});}return[...routes.values()];}

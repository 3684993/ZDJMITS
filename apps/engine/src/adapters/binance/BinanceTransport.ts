import {isIP} from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { getBinanceRequestBudget, binanceBudgetLane, binanceHealthBlocksEntry, binanceEntryBlockReason, binanceEgressState, binanceEgressEntryBlockReason, type RequestBudgetMeta } from './requestBudget.js';
import {storageEntryBlockReason} from '../../services/storageCapacityGuard.js';
import https from 'node:https';
import type { ClientRequest } from 'node:http';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ConnectionSettings } from '@zdj/contracts';
import { binanceJsonTimeoutMs, readBinanceJsonBody } from './binanceJsonResponse.js';
import { assertEntryDispatchDeadline, assertEntryDispatchGuard, isEntryOrderWrite, type EntryDispatchGuard } from './entryDispatchDeadline.js';
export const BINANCE_EGRESS_VERIFY_TIMEOUT_MS = 15_000;
function safeNetworkFailure(error:unknown){
 if(!(error instanceof Error))return'NETWORK_REQUEST_FAILED';
 if(error.name==='AbortError'||error.message==='Binance request timed out')return'Binance request timed out';
 const code=(error as NodeJS.ErrnoException).code;
 // Network/proxy error messages may contain the request URL or credentials.
 // Preserve the bounded error code, never arbitrary upstream message text.
 return typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(code)?code:'NETWORK_REQUEST_FAILED';
}
const TESTNET_REST_ALLOWLIST=new Set(['demo-fapi.binance.com']);
export function isAllowedTestnetRestHost(host:string){return TESTNET_REST_ALLOWLIST.has(String(host).toLowerCase());}
function klineWeight(limit:number){return limit<100?1:limit<500?2:limit<=1000?5:10;}function depthWeight(limit:number){return limit<=50?2:limit<=100?5:limit<=500?10:20;}
export function binanceRequestWeight(url:URL,method='GET'){const p=url.pathname,hasSymbol=url.searchParams.has('symbol'),limit=Math.max(1,Number(url.searchParams.get('limit')??0)||500);if(p.endsWith('/time')||p.endsWith('/exchangeInfo')||p.endsWith('/openInterest')||p.endsWith('/fundingRate')||p.endsWith('/listenKey')||p.endsWith('/leverage'))return 1;if(p.endsWith('/klines')||p.endsWith('/markPriceKlines')||p.endsWith('/indexPriceKlines')||p.endsWith('/continuousKlines'))return klineWeight(limit);if(p.endsWith('/depth'))return depthWeight(limit);if(p.endsWith('/ticker/24hr'))return hasSymbol?1:40;if(p.endsWith('/ticker/bookTicker'))return hasSymbol?2:5;if(p.endsWith('/premiumIndex'))return hasSymbol?1:10;if(p.endsWith('/income'))return 30;if(p.endsWith('/openOrders'))return hasSymbol?1:40;if(p.endsWith('/account')||p.endsWith('/balance')||p.endsWith('/positionRisk'))return 5;if(p.endsWith('/userTrades')||p.endsWith('/allOrders'))return 5;if(p.endsWith('/order'))return method==='POST'?0:1;if(p.endsWith('/positionSide/dual')||p.endsWith('/leverageBracket'))return 30;throw new Error(`BINANCE_ENDPOINT_WEIGHT_UNREGISTERED:${method.toUpperCase()}:${p}`);}
export function inferredBinanceSource(url:URL,method:string){const p=url.pathname;if(method!=='GET'&&p.endsWith('/order'))return'EXECUTION_CRITICAL';if(p.endsWith('/order')||p.endsWith('/userTrades'))return'ORDER_VERIFICATION';if(p.endsWith('/account')||p.endsWith('/balance')||p.endsWith('/positionRisk')||p.endsWith('/positionSide/dual')||p.endsWith('/leverageBracket'))return'PRIVATE_STATE';if(p.endsWith('/income'))return'BACKGROUND_AUDIT';if(p.endsWith('/openOrders')||p.endsWith('/allOrders'))return'RECONCILIATION';if(p.endsWith('/listenKey'))return'USER_DATA_STREAM';if(p.endsWith('/exchangeInfo'))return'RATE_LIMIT_CONTROL';if(p.endsWith('/klines')||p.endsWith('/depth')||p.endsWith('/ticker/24hr')||p.endsWith('/ticker/bookTicker')||p.endsWith('/premiumIndex')||p.endsWith('/openInterest')||p.endsWith('/fundingRate'))return'MARKET_DATA';if(p.endsWith('/time'))return'CLOCK';return'UNKNOWN';}
function priorityFor(source:string):0|1|2|3|4{const lane=binanceBudgetLane(source);return lane==='EXECUTION'?0:lane==='PRIVATE_TRUTH'?1:lane==='CONTROL'?2:lane==='MARKET_PUBLIC'?3:4;}
export function shouldDeferAtTransport(source:string,health:{status:string;admissionObservedWeight1m:number|null;softPublicWeight:number;softBackgroundWeight:number},weight:number){const lane=binanceBudgetLane(source);if(lane!=='MARKET_PUBLIC'&&lane!=='BACKGROUND')return false;if(health.status==='SATURATED'||health.status==='RATE_LIMITED'||health.status==='RECOVERING'||health.status==='PERSISTENCE_FAILED'||health.status==='PRIVATE_ONLY')return true;const ceiling=lane==='BACKGROUND'?Math.min(health.softPublicWeight,health.softBackgroundWeight):health.softBackgroundWeight;return health.admissionObservedWeight1m!==null&&health.admissionObservedWeight1m+weight>ceiling;}
export function extractObservedIp(body:string){for(const match of body.matchAll(/\bIP\s*[(=:]?\s*([0-9a-f:.]+)/ig)){if(isIP(match[1]!))return match[1]!;}return null;}
export function binanceBudgetFailureMessage(message:string,meta:RequestBudgetMeta){return `${message}|requestId=${String(meta.requestId??'UNKNOWN')}|endpoint=${String(meta.endpoint??'UNKNOWN')}|method=${String(meta.method??'GET')}|source=${String(meta.source??'UNKNOWN')}|purpose=${String(meta.purpose??'UNSPECIFIED')}|routeIdentity=${String(meta.routeIdentity??'UNKNOWN')}`;}

type EgressTruth={routeIdentity:string;expectedEgressIp:string|null;lastVerifiedEgressIp:string|null;lastVerifiedAt:number|null;status:'UNVERIFIED'|'VERIFIED'|'MISMATCH'|'UNAVAILABLE';lastError:string|null};
const egressTruthByRoute=new Map<string,EgressTruth>();
const liveTransports=new Set<WeakRef<BinanceTransport>>();
export function reconfigureBinanceTransports(settings:ConnectionSettings){for(const ref of [...liveTransports]){const transport=ref.deref();if(transport)transport.reconfigure(settings);else liveTransports.delete(ref);}}

/** Re-prove the fixed egress for every live transport. Testnet writes stay blocked until this
 *  has run once in the process, so a restart must not leave the engine write-stalled. */
export async function verifyBinanceTransportEgress(){for(const ref of [...liveTransports]){const transport=ref.deref();if(!transport){liveTransports.delete(ref);continue;}try{await transport.verifyEgressIp();}catch{/* the transport already recorded UNAVAILABLE with the reason */}}}

/** Single Binance network boundary. Exchange traffic is proxy-only and fail-closed. */
export class BinanceTransport {
 private configurationGeneration=0;
 private pooledRestAgent:SocksProxyAgent|null=null;private pooledProxyUrl:string|null=null;
 private agent:SocksProxyAgent|null=null;private budget!:ReturnType<typeof getBinanceRequestBudget>;private routeIdentity='proxy-unavailable';private settings:ConnectionSettings;private requestLimitFlight:Promise<void>|null=null;
 constructor(settings:ConnectionSettings){this.settings=settings;this.applyRoute();liveTransports.add(new WeakRef(this));}
 private applyRoute(){
  this.configurationGeneration++;
  const proxyUrl=this.settings.proxy.enabled&&this.settings.proxy.url?this.settings.proxy.url:null;
  if(proxyUrl!==this.pooledProxyUrl){
   // REST and upgraded WebSocket sockets have independent pools. Route changes
   // close the old REST pool; identical settings retain reusable connections.
   this.pooledRestAgent?.destroy();
   this.pooledRestAgent=proxyUrl?new SocksProxyAgent(proxyUrl,{keepAlive:true,keepAliveMsecs:1000,maxSockets:6,maxFreeSockets:2}):null;
   this.pooledProxyUrl=proxyUrl;
  }
  if(proxyUrl)this.agent=new SocksProxyAgent(proxyUrl);else this.agent=null;const proxyHash=this.agent?createHash('sha256').update(this.settings.proxy.url).digest('hex').slice(0,12):'unavailable';this.routeIdentity=`proxy-${proxyHash}`;this.budget=getBinanceRequestBudget(this.settings.exchange.environment,this.routeIdentity);const expected=String((this.settings.proxy as any).expectedStaticEgressIp??'').trim()||null,prior=egressTruthByRoute.get(this.routeIdentity);const carried=prior&&prior.expectedEgressIp===expected?prior:null;/* a new expected egress IP invalidates the old proof */egressTruthByRoute.set(this.routeIdentity,{routeIdentity:this.routeIdentity,expectedEgressIp:expected,lastVerifiedEgressIp:carried?.lastVerifiedEgressIp??null,lastVerifiedAt:carried?.lastVerifiedAt??null,status:carried?.status??'UNVERIFIED',lastError:carried?.lastError??null});this.requestLimitFlight=null;}
 reconfigure(settings:ConnectionSettings){this.settings=settings;this.applyRoute();}
 effectiveBaseUrl(){const exchange=this.settings.exchange as typeof this.settings.exchange & {testnetRestBaseUrl?:string;productionRestBaseUrl?:string};return exchange.environment==='TESTNET'?(exchange.testnetRestBaseUrl??exchange.testnetBaseUrl):(exchange.productionRestBaseUrl??exchange.productionBaseUrl);}environment(){return this.settings.exchange.environment;}executionMode(){return this.settings.executionMode;}
 private assertProxy(){if(!this.settings.proxy.enabled||!this.agent)throw new Error('PROXY_REQUIRED: Binance exchange traffic is proxy-only and configured fail-closed');}
 requestBudgetHealth(){return{...this.budget.health(),routeIdentity:this.routeIdentity,route:this.restRoute()};}
 entryBlockReason(){const egressBlock=binanceEgressEntryBlockReason(this.egressStatus());if(egressBlock)return egressBlock;return binanceEntryBlockReason(this.settings.exchange.environment,this.routeIdentity);}
 restRoute(){const host=new URL(this.effectiveBaseUrl()).hostname;return{mode:'CONFIGURED' as const,throughProxy:Boolean(this.agent),host,routeIdentity:this.routeIdentity,proxyUrl:this.agent?this.settings.proxy.url:null,expectedStaticEgressIp:egressTruthByRoute.get(this.routeIdentity)?.expectedEgressIp??null,failClosed:true,deprecatedTestnetRestHost:host==='testnet.binancefuture.com'};}
 private restAgent(){this.assertProxy();return this.pooledRestAgent!;}
 assertTestnetExchangeWrite(){const url=new URL(this.effectiveBaseUrl());if(this.settings.exchange.environment!=='TESTNET'||this.settings.executionMode!=='TESTNET_ENABLED'||!isAllowedTestnetRestHost(url.hostname))throw new Error('TESTNET_ONLY_WRITE_LOCK: Binance Demo Testnet write disabled for this environment/host');this.assertProxy();const egress=binanceEgressState(this.egressStatus());if(!egress.verified)throw new Error(`TESTNET_WRITE_EGRESS_NOT_VERIFIED:${egress.status}`);}
 effectiveWsUrl(){const exchange=this.settings.exchange as typeof this.settings.exchange & {testnetWsBaseUrl?:string;productionWsBaseUrl?:string};return exchange.environment==='TESTNET'?(exchange.testnetWsBaseUrl??'wss://stream.binancefuture.com/ws'):(exchange.productionWsBaseUrl??'wss://fstream.binance.com/ws');}
 websocketOptions(){this.assertProxy();return{agent:this.agent!};}
 websocketRoute(){return{url:this.effectiveWsUrl(),throughProxy:Boolean(this.agent),proxyUrl:this.agent?this.settings.proxy.url:null,tlsServername:new URL(this.effectiveWsUrl()).hostname,routeIdentity:this.routeIdentity,failClosed:true};}
 private assertBinance(url:URL){if(!(url.hostname==='binance.com'||url.hostname.endsWith('.binance.com'))&&!(url.hostname==='binancefuture.com'||url.hostname.endsWith('.binancefuture.com')))throw new Error(`Refusing non-Binance transport host: ${url.hostname}`);this.assertProxy();}
 private async ensureRequestWeightLimit(){if(this.budget.health().limitSource==='BINANCE_EXCHANGE_INFO')return;if(!this.requestLimitFlight){const flight=this.json<any>('/fapi/v1/exchangeInfo',{source:'RATE_LIMIT_CONTROL',purpose:'REQUEST_WEIGHT_DISCOVERY'}).then(()=>{}).finally(()=>{if(this.requestLimitFlight===flight)this.requestLimitFlight=null;});this.requestLimitFlight=flight;}await this.requestLimitFlight;}
 async json<T>(pathOrUrl:string,init:{method?:string;headers?:Record<string,string>;body?:string;timeoutMs?:number;source?:string;purpose?:string;entryExecutionExpiresAt?:number;entryDispatchGuard?:EntryDispatchGuard}={}):Promise<T>{
  const url=new URL(pathOrUrl,this.effectiveBaseUrl());this.assertBinance(url);
  if(url.origin!==new URL(this.effectiveBaseUrl()).origin)throw new Error('BINANCE_ENVIRONMENT_ORIGIN_MISMATCH');
  const method=(init.method??'GET').toUpperCase(),source=init.source??inferredBinanceSource(url,method);
  if(source==='CLOCK'&&this.budget.health().limitSource==='CONSERVATIVE_DEFAULT')try{await this.ensureRequestWeightLimit();}catch{/* The clock/control lane remains the bounded recovery probe if discovery itself is rate-limited. */}
  const priority=priorityFor(source),weight=binanceRequestWeight(url,method),meta:RequestBudgetMeta={requestId:randomUUID(),source,purpose:init.purpose??'BINANCE_HTTP',endpoint:url.pathname,method,routeIdentity:this.routeIdentity,orderCount:url.pathname.endsWith('/order')&&(method==='POST'||method==='PUT')?1:0},budgetHealth=this.budget.health();
  if(shouldDeferAtTransport(source,budgetHealth,weight)){this.budget.recordDeferred(meta,weight);throw new Error(binanceBudgetFailureMessage(`BINANCE_REQUEST_BUDGET_DEFERRED:${budgetHealth.status}`,meta));}
  try{return await this.budget.run(priority,weight,()=>{
   if(init.purpose==='NEW_ENTRY'||init.purpose==='ENTRY_REPRICE'){
    const storageBlock=storageEntryBlockReason();if(storageBlock)throw new Error(`STORAGE_ENTRY_BLOCKED:${storageBlock}`);
    const health=this.budget.health();if(binanceHealthBlocksEntry(health.status))throw new Error(`BINANCE_ENTRY_BUDGET_BLOCKED:${health.status}`);
   }
   // This runs after budget queueing and local admission checks, before any socket/request creation.
   // Only new exposure is bounded; exact-order queries, cancels and protective orders stay available.
   if(isEntryOrderWrite(method,init.purpose)){
    assertEntryDispatchDeadline(init.entryExecutionExpiresAt);
    assertEntryDispatchGuard(init.entryDispatchGuard);
    // A synchronous guard can consume time; keep the existing absolute clock exclusive.
    assertEntryDispatchDeadline(init.entryExecutionExpiresAt);
   }
   return new Promise<T>((resolve,reject)=>{
    const timeoutMs=binanceJsonTimeoutMs(url,method,init.timeoutMs),startedAt=performance.now();
    const controller=new AbortController();
    let request:ClientRequest|undefined,deadlineTimer:ReturnType<typeof setTimeout>|undefined;
    let settled=false,phase='PROXY_CONNECT',receivedBytes=0,httpStatus:number|null=null;
    const finish=()=>{settled=true;if(deadlineTimer!==undefined)clearTimeout(deadlineTimer);};
    // The diagnostic records only the registered pathname and timing/byte facts.
    // Signed query strings, request headers and proxy credentials never enter it.
    const transportFailure=(message:string)=>{
     if(settled)return;finish();
     reject(new Error(`${binanceBudgetFailureMessage(`BINANCE_TRANSPORT_BLOCKED: ${message}`,meta)}|phase=${phase}|elapsedMs=${Math.round(performance.now()-startedAt)}|receivedBytes=${receivedBytes}|httpStatus=${httpStatus??'UNKNOWN'}`));
    };
    const expire=()=>{transportFailure('Binance request timed out');controller.abort();request?.destroy();};
    // ClientRequest removes its AbortSignal listener when HTTP ends. Keep this
    // independent deadline until bounded decompression and JSON parsing finish.
    deadlineTimer=setTimeout(expire,timeoutMs);
    const withinDeadline=()=>{
     if(settled)return false;
     if(performance.now()-startedAt>=timeoutMs){expire();return false;}
     return true;
    };
    try{
    request=https.request(url,{method,headers:{'user-agent':'zdj-mits-v3/3.9','accept-encoding':'gzip',...init.headers},agent:this.restAgent(),timeout:timeoutMs,signal:controller.signal},response=>{
     phase='RESPONSE_BODY';httpStatus=response.statusCode??500;
     response.once('end',()=>{phase='RESPONSE_DECODE';});
     const observe=(body:string)=>this.budget.observeResponse(httpStatus!,response.headers as Record<string,string|string[]|undefined>,response.headers['retry-after'] as string|undefined,meta,(httpStatus===418||httpStatus===429)?extractObservedIp(body):null,Number(body.match(/banned until (\d+)/i)?.[1]??0));
     void readBinanceJsonBody(response,{onProgress:bytes=>{receivedBytes=bytes;}}).then(body=>{
      observe(body);
      if(!withinDeadline())return;
      if(httpStatus!>=400){finish();reject(new Error(`Binance HTTP ${httpStatus}: ${body.slice(0,512)}`));return;}
      let parsed:T;
      phase='RESPONSE_PARSE';
      try{parsed=JSON.parse(body) as T;}
      catch{if(withinDeadline()){finish();reject(new Error('Binance returned invalid JSON'));}return;}
      if(!withinDeadline())return;
      if(url.pathname.endsWith('/exchangeInfo')){const limits=(parsed as any)?.rateLimits;if(Array.isArray(limits))this.budget.configureRateLimits(limits);}
      if(!withinDeadline())return;
      finish();resolve(parsed);
     }).catch(error=>{
      // Even an incomplete/corrupt error body must retain authoritative HTTP
      // status/Retry-After facts for rate-limit governance.
      observe('');
      transportFailure(error instanceof Error?error.message:'BINANCE_RESPONSE_INVALID');
      request?.destroy();
     });
    });
    request.once('socket',socket=>{
     if(request!.reusedSocket){phase='RESPONSE_HEADERS';return;}
     phase='TLS_CONNECT';
     if('secureConnecting' in socket)socket.once('secureConnect',()=>{phase='RESPONSE_HEADERS';});
    });
    request.once('timeout',expire);
    request.once('error',error=>transportFailure(safeNetworkFailure(error)));
    request.end(init.body);
    }catch(error){transportFailure(error instanceof Error?safeNetworkFailure(error):'NETWORK_REQUEST_FAILED');request?.destroy();}
   });
  },meta);}catch(error){
   const message=error instanceof Error?error.message:String(error);
   if(message.startsWith('BINANCE_REQUEST_QUEUE_TIMEOUT')||message.startsWith('BINANCE_REQUEST_QUEUE_FULL')||message.startsWith('BINANCE_RATE_LIMIT_UNTIL:')||message.startsWith('BINANCE_REQUEST_BUDGET_DEFERRED:'))throw new Error(binanceBudgetFailureMessage(message,meta));
   throw error;
  }
 }

 egressStatus(){return structuredClone(egressTruthByRoute.get(this.routeIdentity)??{routeIdentity:this.routeIdentity,expectedEgressIp:null,lastVerifiedEgressIp:null,lastVerifiedAt:null,status:'UNVERIFIED',lastError:null});}
 async verifyEgressIp(){
  this.assertProxy();
  const prior=this.egressStatus(),expected=String((this.settings.proxy as any).expectedStaticEgressIp??'').trim()||null;
  const routeIdentity=this.routeIdentity,generation=this.configurationGeneration;
  const stillCurrent=()=>generation===this.configurationGeneration&&routeIdentity===this.routeIdentity
   &&expected===(String((this.settings.proxy as any).expectedStaticEgressIp??'').trim()||null)
   &&expected===egressTruthByRoute.get(routeIdentity)?.expectedEgressIp;
  try{
   const ip=await new Promise<string>((resolve,reject)=>{
    let request:ClientRequest|undefined,settled=false,deadlineTimer:ReturnType<typeof setTimeout>|undefined;
    const controller=new AbortController(),startedAt=performance.now();
    const finish=()=>{settled=true;if(deadlineTimer!==undefined)clearTimeout(deadlineTimer);};
    const fail=(error:Error)=>{if(settled)return;finish();reject(error);request?.destroy();};
    const expire=()=>{fail(new Error('Binance request timed out'));controller.abort();};
    deadlineTimer=setTimeout(expire,BINANCE_EGRESS_VERIFY_TIMEOUT_MS);
    try{
    request=https.request(new URL('https://checkip.amazonaws.com/'),{
     method:'GET',headers:{'user-agent':'zdj-mits-v3/3.9'},agent:this.restAgent(),
     timeout:BINANCE_EGRESS_VERIFY_TIMEOUT_MS,signal:controller.signal,
    },response=>{
     // A single IP response is tiny. Bound it and reject interrupted framing;
     // a valid-looking prefix is not proof of a complete successful response.
     void readBinanceJsonBody(response,{maxWireBytes:1024,maxDecodedBytes:1024}).then(body=>{
      if(settled)return;
      if(performance.now()-startedAt>=BINANCE_EGRESS_VERIFY_TIMEOUT_MS){expire();return;}
      if((response.statusCode??500)>=400)throw new Error(`EGRESS_VERIFY_HTTP_${response.statusCode}`);
      const value=body.trim();
      if(!isIP(value))throw new Error('EGRESS_VERIFY_INVALID_IP');
      finish();resolve(value);
     }).catch(error=>fail(error instanceof Error?error:new Error('EGRESS_VERIFY_RESPONSE_INVALID')));
    });
    request.once('timeout',expire);
    request.once('error',error=>fail(new Error(safeNetworkFailure(error))));
    request.end();
    }catch(error){fail(new Error(error instanceof Error?safeNetworkFailure(error):'NETWORK_REQUEST_FAILED'));}
   });
   if(!stillCurrent())return this.egressStatus();
   const truth:EgressTruth={routeIdentity,expectedEgressIp:expected,lastVerifiedEgressIp:ip,lastVerifiedAt:Date.now(),status:expected&&expected!==ip?'MISMATCH':'VERIFIED',lastError:null};
   egressTruthByRoute.set(routeIdentity,truth);return structuredClone(truth);
  }catch(error){
   if(!stillCurrent())return this.egressStatus();
   const truth:EgressTruth={...prior,expectedEgressIp:expected,status:'UNAVAILABLE',lastError:error instanceof Error?error.message:String(error)};
   egressTruthByRoute.set(routeIdentity,truth);return structuredClone(truth);
  }
 }
 async health(){this.assertProxy();const startedAt=Date.now(),[serverTime,egress]=await Promise.all([this.json<{serverTime:number}>('/fapi/v1/time',{source:'HEALTH_PROBE',purpose:'SERVER_TIME'}),this.verifyEgressIp()]);return{status:(egress.status==='VERIFIED'?'HEALTHY':'DEGRADED') as 'HEALTHY'|'DEGRADED',latencyMs:Date.now()-startedAt,serverTime,effectiveBaseUrl:this.effectiveBaseUrl(),throughProxy:true,route:this.restRoute(),egress,requestBudget:this.requestBudgetHealth()};}
}
export function binanceTransportGovernance(){const routes=new Map<string,unknown>();for(const ref of [...liveTransports]){const transport=ref.deref();if(!transport){liveTransports.delete(ref);continue;}const route=transport.restRoute();routes.set(String(route.routeIdentity),{environment:transport.environment(),rest:route,ws:transport.websocketRoute(),egress:transport.egressStatus(),requestBudget:transport.requestBudgetHealth()});}return[...routes.values()];}

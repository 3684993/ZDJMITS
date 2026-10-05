import { Router, type NextFunction, type Request, type Response } from 'express';
import { SystemSettingsSchema, type SystemSettings } from '@zdj/contracts';
import { loadAiResources } from '../config/aiResourceLoader.js';
import { BinanceTransport, reconfigureBinanceTransports } from '../adapters/binance/BinanceTransport.js';
import type { EngineRuntime } from '../runtime/appRuntime.js';
import { applyGovernancePatch, changedGovernancePaths, governanceFieldOf, governanceReadback, governanceRequiresAck, readPath } from '../config/governanceSettingsMatrix.js';

type RuntimeResourceKind='exchange'|'proxy'|'ai';
const aiLoadDefault=()=>({active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'等待动态交易池候选',queueDepth:0});

function canonicalProxy(settings:SystemSettings,item?:any):SystemSettings{
  const next=structuredClone(settings),current=next.connections.proxy as any,{expectedStaticEgressIp:_legacyEgress,...withoutLegacyEgress}=current;
  next.connections.proxy={...withoutLegacyEgress,...(item?{enabled:item.enabled!==false,protocol:'SOCKS5H' as const,url:String(item.url??current.url)}:{}),forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',bypassLocalhost:true,failClosed:true};
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
  const role=String(item?.role??'REVIEW_BRAIN');if(!['SCOUT','PRIMARY_BRAIN','REVIEW_BRAIN'].includes(role))throw new Error('AI_RESOURCE_LEGACY_ROLE_UNSUPPORTED');
  return{id:String(item.id??''),name:String(item.name??item.id??''),role,enabled:item.enabled!==false,baseUrl:String(item.baseUrl??''),model:String(item.model??''),maxConcurrency:Number(item.maxConcurrency??1),gpu:String(item.gpu??'未指定')};
}
function rejectSecretFields(item:any){if(item&&['apiKey','apiSecret','secret','password','token'].some(key=>Object.prototype.hasOwnProperty.call(item,key)))throw new Error('RESOURCE_SECRET_FIELD_FORBIDDEN');}
function resourceView(settings:SystemSettings,kind:RuntimeResourceKind,runtime?:EngineRuntime){
  if(kind==='exchange'){const x=settings.connections.exchange as any;return[{id:'binance-usdm',name:'Binance USD-M',type:'BINANCE_USDM',environment:x.environment,restBaseUrl:x.environment==='TESTNET'?(x.testnetRestBaseUrl??x.testnetBaseUrl):(x.productionRestBaseUrl??x.productionBaseUrl),wsBaseUrl:x.environment==='TESTNET'?(x.testnetWsBaseUrl??'wss://stream.binancefuture.com/ws'):(x.productionWsBaseUrl??'wss://fstream.binance.com/ws'),credentialRef:x.credentialRef,enabled:true,active:true,status:'READY'}];}
  if(kind==='proxy')return[{id:'binance-proxy',name:'SOCKS5H',type:'SOCKS5H',url:settings.connections.proxy.url,enabled:settings.connections.proxy.enabled,active:true,status:settings.connections.proxy.enabled?'READY':'DISABLED'}];
  const metrics=new Map((runtime?.ai?.resourceMetrics?.()??[]).map((row:any)=>[row.id,row]));
  return settings.aiResources.map(item=>{const metric:any=metrics.get(item.id);return{...item,name:item.name??item.id,
    duties:(settings.aiDutyRoutes??[]).filter(route=>route.enabled&&route.resourceId===item.id).map(route=>route.duty),
    activeRequests:Number(metric?.active??0),queueDepth:Number(metric?.queueDepth??0),status:item.enabled?(metric?.connectionStatus==='OFFLINE'?'OFFLINE':metric?.connectionStatus==='UNKNOWN'?'UNKNOWN':metric?.active?'BUSY':'ONLINE'):'DISABLED',
    healthCheckedAt:metric?.healthCheckedAt??null,latencyMs:metric?.lastLatencyMs??null,lastError:metric?.healthReason??null,totalRuns:metric?.totalRuns??0,failures:metric?.failures??0};});
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
  /**
   * S08: a whole-settings PUT may only change governance leaves the matrix lists and permits.
   * Everything outside those namespaces keeps behaving as before; inside them, an unlisted path is a
   * refusal rather than a silent write, which is what makes the matrix the real authority.
   */
  const governanceGuard=(req:Request,res:Response)=>{
    const requested=req.body as SystemSettings;
    if(!requested||typeof requested!=='object')return false;
    const blocked=changedGovernancePaths(runtime.state.settings,requested).filter(path=>{
      const field=governanceFieldOf(path);
      return !field||!field.editable||governanceRequiresAck(field,readPath(runtime.state.settings,path),readPath(requested,path));
    });
    if(!blocked.length)return false;
    res.status(400).json({error:{code:'SETTINGS_GOVERNANCE_PATH_REQUIRES_PATCH',blockedPaths:blocked,
      hint:'治理字段必须走 PATCH /api/v3/settings/governance：字段矩阵会校验单位、区间、生效时点与权限确认(ack)。'}});
    return true;
  };
  router.put('/settings',async(req,res,next)=>{try{
    if(governanceGuard(req,res))return;
    const requested=req.body as SystemSettings,current=runtime.state.settings;
    const candidate=canonicalProxy({...requested,connections:{...requested.connections,exchange:current.connections.exchange,proxy:current.connections.proxy},aiResources:current.aiResources,aiDutyRoutes:current.aiDutyRoutes});
    res.json(await saveRuntimeSettings(runtime,candidate));
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  router.get('/settings/governance',(_req,res)=>{res.json({settingsVersion:runtime.state.settings.settingsVersion,
    releaseIdentity:runtime.state.settings.releasePolicy?.lifecycleVersion??null,fields:governanceReadback(runtime.state.settings),
    // The durable truth the operator is configuring against, read from the ledger itself rather than
    // restated from settings, so a newer-on-disk schema cannot be hidden behind a version number.
    ownershipSchema:runtime.exitRuntime?.schemaInfo()??null});});
  router.patch('/settings/governance',async(req,res,next)=>{try{
    const expected=expectedVersion(req),acks=Array.isArray(req.body?.acks)?req.body.acks.map(String):[];
    const patch=req.body?.fields;
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length){res.status(400).json({error:{code:'GOVERNANCE_PATCH_EMPTY'}});return;}
    const {settings:candidate,applied,refusals}=applyGovernancePatch(runtime.state.settings,patch as Record<string,unknown>,{acks});
    if(refusals.length){res.status(400).json({error:{code:'GOVERNANCE_PATCH_REFUSED'},refusals,currentSettingsVersion:runtime.state.settings.settingsVersion});return;}
    const saved=await runtime.updateSettingsIfVersion(candidate,expected);hotApply(runtime,runtime.state.settings,saved);
    // The response is the server's readback after the write, not the values the caller sent.
    res.json({settingsVersion:saved.settingsVersion,applied,readback:governanceReadback(saved).filter(row=>applied.includes(row.path))});
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  /**
   * The only channel that can put a PortfolioRisk dataset authority into this account. It is separate
   * from the governance PATCH on purpose: the margin brackets, every version and the maintenance rate
   * are derived by the server from content it collected itself, so a request that carries one of those
   * names is refused rather than quietly accepted and re-derived.
   */
  const serverDerivedField=(name:string)=>/version|contenthash|margintier|maintenancemarginrate|brackets|credential|clustermap/i.test(name);
  const AUTHORITY_REQUEST_FIELDS=['limits','correlation','scenarios','acks','expectedSettingsVersion','operator'];
  const forgedAuthorityFields=(body:{[key:string]:unknown}|undefined)=>{
    const found=Object.keys(body??{}).filter(key=>!AUTHORITY_REQUEST_FIELDS.includes(key));
    const nested=(value:unknown,prefix:string)=>{
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      for(const key of Object.keys(value as Record<string,unknown>)){
        if(serverDerivedField(key))found.push(`${prefix}.${key}`);
        if(key==='clusters')nested((value as Record<string,unknown>).clusters,`${prefix}.clusters`);
      }
    };
    nested(body?.limits,'limits');nested(body?.correlation,'correlation');
    return found;
  };
  /**
   * The same collection and compilation a commit performs, with nothing persisted. A refusal that only
   * says "0.2" leaves the operator to guess which bracket the server saw, and a guess invites somebody
   * to edit the database by hand.
   */
  router.post('/settings/portfolio-risk-authority/preview',async(req,res,next)=>{try{
    const body=req.body as {limits?:Record<string,unknown>;correlation?:{clusters?:unknown};scenarios?:unknown[]}|undefined;
    const forged=forgedAuthorityFields(body as {[key:string]:unknown}|undefined);
    if(forged.length){res.status(400).json({error:{code:'PORTFOLIO_RISK_AUTHORITY_FIELD_IS_SERVER_DERIVED',fields:forged}});return;}
    if(!body?.limits||!Array.isArray(body.scenarios)||!body.scenarios.length){res.status(400).json({error:{code:'PORTFOLIO_RISK_PREVIEW_INCOMPLETE'}});return;}
    res.json({...await runtime.collectPortfolioRiskAuthorityPreview({limits:body.limits,clusters:body.correlation?.clusters,scenarios:body.scenarios}),persisted:false});
  }catch(error){next(error);}});
  router.get('/settings/portfolio-risk-authority',(_req,res,next)=>{try{
    const readback=runtime.portfolioRiskAuthorityReadback?.()??null;
    res.json({settingsVersion:runtime.state.settings.settingsVersion,authority:readback?.authority??null,profileStatus:readback?.status??'PROFILE_NOT_CONFIGURED',
      profileBlockers:readback?.blockers??[],lastDriftInspection:runtime.portfolioRiskAuthorityDriftReport??null});
  }catch(error){next(error);}});
  router.post('/settings/portfolio-risk-authority',async(req,res,next)=>{try{
    const expected=expectedVersion(req),body=req.body as {limits?:Record<string,unknown>;correlation?:{clusters?:unknown};scenarios?:unknown[];acks?:unknown[];operator?:string}|undefined;
    const forged=forgedAuthorityFields(body as {[key:string]:unknown}|undefined);
    if(forged.length){res.status(400).json({error:{code:'PORTFOLIO_RISK_AUTHORITY_FIELD_IS_SERVER_DERIVED',fields:forged,
      hint:'保证金档位、各数据集版本与维持保证金率只能由服务端从真实采集内容派生；请求不携带这些字段。'}});return;}
    if(!body?.limits||typeof body.limits!=='object'||Array.isArray(body.limits)||!Object.keys(body.limits).length){res.status(400).json({error:{code:'PORTFOLIO_RISK_LIMITS_REQUIRED'}});return;}
    if(!Array.isArray(body.scenarios)||!body.scenarios.length){res.status(400).json({error:{code:'PORTFOLIO_RISK_SCENARIOS_REQUIRED'}});return;}
    const committed=await runtime.commitPortfolioRiskAuthority({limits:body.limits,clusters:body.correlation?.clusters,scenarios:body.scenarios,
      acks:Array.isArray(body.acks)?body.acks.map(String):[],expectedSettingsVersion:expected,operator:String(body.operator??'cockpit')});
    res.json({...committed,authority:committed.readback?.authority??null,profileStatus:committed.readback?.status??null});
  }catch(error){
    if(conflict(res,error,runtime.state.settings.settingsVersion))return;
    const message=String(error instanceof Error?error.message:error);
    if(message.includes('PORTFOLIO_RISK_LIMITS_REFUSED')){res.status(400).json({error:{code:'PORTFOLIO_RISK_LIMITS_REFUSED'},refusals:(error as unknown as {refusals?:unknown[]}).refusals??[],currentSettingsVersion:runtime.state.settings.settingsVersion});return;}
    if(message.includes('PORTFOLIO_RISK_AUTHORITY_UNPROVEN')||message.includes('MARGIN_')||message.includes('AUTHORITY_')||message.includes('BRACKET_')){
      res.status(423).json({error:{code:'PORTFOLIO_RISK_AUTHORITY_UNPROVEN',blockers:(error as unknown as {blockers?:string[]}).blockers??[message.slice(0,400)],
        explanation:'组合风险权威数据集未能从真实 Testnet 事实证明，未写入任何 Settings。'}});return;}
    next(error);}});
  router.get('/settings/resources/:kind',(req,res,next)=>{try{const kind=kindOf(req);res.json({settingsVersion:runtime.state.settings.settingsVersion,items:resourceView(runtime.state.settings,kind,runtime)});}catch(error){next(error);}});
  router.get('/settings/ai-duty-routes',(_req,res)=>res.json({settingsVersion:runtime.state.settings.settingsVersion,routes:runtime.state.settings.aiDutyRoutes??[],resources:runtime.state.settings.aiResources.map(({id,name,enabled,model})=>({id,name:name??id,enabled,model}))}));
  router.put('/settings/ai-duty-routes',async(req,res,next)=>{try{
    const expected=expectedVersion(req),routes=Array.isArray(req.body?.routes)?req.body.routes:[],before=runtime.state.settings,candidate=structuredClone(before);
    candidate.aiDutyRoutes=routes;
    // Validate uniqueness, target existence/enabled state, and the required sole Entry Primary before commit.
    const parsed=SystemSettingsSchema.parse(candidate);
    if(parsed.aiDutyRoutes.filter(route=>route.enabled).some(route=>!['SCOUT_RESEARCH','ENTRY_PRIMARY','PENDING_ENTRY_REVIEW','POSITION_REVIEW'].includes(route.duty)))throw new Error('AI_DUTY_UNSUPPORTED');
    const saved=await runtime.updateSettingsIfVersion(parsed,expected);hotApply(runtime,before,saved);
    res.json({settingsVersion:saved.settingsVersion,routes:saved.aiDutyRoutes});
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  const save=async(req:Request,res:Response,next:NextFunction)=>{try{
    const kind=kindOf(req),expected=expectedVersion(req),before=runtime.state.settings;rejectSecretFields(req.body);
    const id=kind==='proxy'?'binance-proxy':kind==='exchange'?'binance-usdm':String(req.params.id??req.body?.id??'');
    if(!id)throw new Error('RESOURCE_ID_REQUIRED');
    let nextSettings:SystemSettings,item:any;
    if(kind==='proxy'){item={id,name:req.body?.name??'SOCKS5H',type:'SOCKS5H',url:String(req.body?.url??before.connections.proxy.url),enabled:req.body?.enabled!==false};nextSettings=canonicalProxy(before,item);}
    else if(kind==='exchange'){item={id,name:req.body?.name??'Binance USD-M',type:'BINANCE_USDM',environment:req.body?.environment??before.connections.exchange.environment,restBaseUrl:req.body?.restBaseUrl,wsBaseUrl:req.body?.wsBaseUrl,credentialRef:req.body?.credentialRef??before.connections.exchange.credentialRef,enabled:true};nextSettings=canonicalExchange(before,item);}
    else{item=aiResource({...req.body,id});nextSettings=structuredClone(before);nextSettings.aiResources=[...nextSettings.aiResources.filter(existing=>existing.id!==item.id),item];}
    const saved=await runtime.updateResourceSettings(nextSettings,expected,{kind,operation:'SAVE',id,value:item});hotApply(runtime,before,saved);
    res.json({...resourceView(saved,kind,runtime).find(row=>row.id===id)??item,settingsVersion:saved.settingsVersion});
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}};
  router.post('/settings/resources/:kind',save);router.put('/settings/resources/:kind/:id',save);
  router.post('/settings/resources/:kind/:id/test',async(req,res,next)=>{try{
    const kind=kindOf(req),id=String(req.params.id);
    if(kind==='ai'){
      const resource=runtime.state.settings.aiResources.find(item=>item.id===id);if(!resource)return res.status(404).json({error:{message:'AI_RESOURCE_NOT_FOUND'}});
      const startedAt=Date.now(),response=await fetch(`${resource.baseUrl.replace(/\/$/,'')}/models`,{signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`AI_HTTP_${response.status}`);
      const body=await response.json() as any,models=[...(body.data??[]).map((item:any)=>item.id),...(body.models??[]).map((item:any)=>item.model)].filter(Boolean);
      return res.json({id,status:'HEALTHY',latencyMs:Date.now()-startedAt,modelConfigured:models.includes(resource.model),models});
    }
    const transport=new BinanceTransport(runtime.state.settings.connections),health=await transport.health();
    if(kind==='proxy')return res.json({id,status:health.status,transport:health});
    const ref=runtime.state.settings.connections.exchange.credentialRef,[key,secret]=await Promise.all([runtime.settingsStore.secretStatus(`${ref}:apiKey`),runtime.settingsStore.secretStatus(`${ref}:apiSecret`)]);
    return res.json({id,status:health.status,transport:health,credentials:{configured:key.configured&&secret.configured,status:key.configured&&secret.configured?'READY':key.status},writeEnabled:runtime.state.settings.connections.executionMode==='TESTNET_ENABLED'&&runtime.state.settings.connections.exchange.environment==='TESTNET'&&key.configured&&secret.configured});
  }catch(error){next(error);}});
  router.delete('/settings/resources/:kind/:id',async(req,res,next)=>{try{
    const kind=kindOf(req),expected=expectedVersion(req),before=runtime.state.settings,id=String(req.params.id);
    if(kind==='exchange')return res.status(409).json({error:{message:'ACTIVE_EXCHANGE_DELETE_REQUIRES_REPLACEMENT'},currentSettingsVersion:before.settingsVersion});
    const nextSettings=structuredClone(before);
    if(kind==='proxy')nextSettings.connections.proxy={...nextSettings.connections.proxy,enabled:false,forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,binanceRestRoute:'CONFIGURED',failClosed:true};
    else {
      const duties=(nextSettings.aiDutyRoutes??[]).filter(route=>route.enabled&&route.resourceId===id).map(route=>route.duty);
      if(duties.length)return res.status(409).json({error:{code:'AI_RESOURCE_IN_USE',resourceId:id,duties},currentSettingsVersion:before.settingsVersion});
      nextSettings.aiResources=nextSettings.aiResources.filter(item=>item.id!==id);
    }
    const saved=await runtime.updateResourceSettings(nextSettings,expected,{kind,operation:'DELETE',id:kind==='proxy'?'binance-proxy':id});hotApply(runtime,before,saved);
    res.status(204).setHeader('x-settings-version',String(saved.settingsVersion)).end();
  }catch(error){if(conflict(res,error,runtime.state.settings.settingsVersion))return;next(error);}});
  return router;
}

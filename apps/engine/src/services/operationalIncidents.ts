import {createHash} from 'node:crypto';
import type {OperationalIncident} from '@zdj/contracts';

type Candidate=Omit<OperationalIncident,'incidentId'|'active'|'firstSeenAt'|'lastSeenAt'|'recoveredAt'|'count'>;
const text=(value:unknown)=>String(value??'').replace(/(apiKey|apiSecret|signature|authorization)=([^&\s]+)/gi,'$1=[REDACTED]').slice(0,600);
const template=(publicCode:string,titleZh:string,messageZh:string,remediationZh:string,category:OperationalIncident['category'],blockingScopes:string[]):Pick<Candidate,'publicCode'|'titleZh'|'messageZh'|'remediationZh'|'category'|'severity'|'blockingScopes'>=>({publicCode,titleZh,messageZh,remediationZh,category,severity:'ERROR',blockingScopes});
const NETWORK=template('NET-001','Binance 连接错误','无法连接 Binance；只有依赖该交易所事实的操作会安全暂停。','检查交易所服务、网络与已配置代理；系统不会把该错误解释为行情趋势。','NETWORK',['MARKET_DATA','NEW_ENTRY','EXCHANGE_WRITE']);
const TIMEOUT=template('NET-002','Binance REST 连续响应延迟','60 秒内多次关键 Binance REST 请求超时；孤立慢请求只记遥测，不会触发此事故。只有确实缺少关键事实的操作会安全暂停。','系统优先使用 WebSocket 实时事实并自动恢复；连续发生时再检查交易所服务与当前活动代理。','NETWORK',['MARKET_DATA','NEW_ENTRY']);
const MARKET=template('MARKET-DATA-001','行情数据链路暂不可执行','报价、订单簿或K线的新鲜度/连续性不足，当前没有数据完整的可执行候选，新建仓分析已暂停。','系统会自动恢复；若持续发生，请检查 Binance WebSocket/REST 行情连接与交易所行情服务。这不是行情涨跌趋势判断。','MARKET_DATA',['MARKET_DATA','NEW_ENTRY']);
const SUBMIT=template('EX-SUBMIT-UNKNOWN','订单提交结果未知','系统正按原 clientOrderId 查询订单身份，确认前禁止重复提交。','查看订单身份查询结果；不要手动重复提交同一订单。','SUBMIT_UNKNOWN',['EXCHANGE_WRITE','NEW_ENTRY']);
const HTTP:Record<number,ReturnType<typeof template>>={
  451:template('EX-HTTP-451','交易所拒绝当前网络出口','Binance 拒绝当前网络访问。','检查出口、区域和账户访问条件，使用符合交易所规则的可访问网络。','EXCHANGE',['MARKET_DATA','PRIVATE_DATA','EXCHANGE_WRITE']),
  429:template('EX-HTTP-429','交易所请求限频','Binance 已限制请求，系统按 Retry-After 与预算等待。','等待自动退避；不要反复刷新或提高请求频率。','EXCHANGE',['MARKET_DATA','NEW_ENTRY']),
  418:template('EX-HTTP-418','交易所暂时封禁当前出口','Binance 暂时封禁当前出口，相关请求已停止。','等待 blockedUntil 到期，并检查网络出口和请求预算。','EXCHANGE',['MARKET_DATA','NEW_ENTRY','EXCHANGE_WRITE']),
};
const BUSINESS:Record<number,[string,string]>={
  [-1021]:['请求时间戳不在交易所允许窗口','检查系统时钟与 Binance 时间同步。'],
  [-2015]:['API 凭据、权限或 IP 限制未通过','检查 TESTNET 凭据、交易权限与允许的出口 IP。'],
  [-2019]:['保证金不足','检查交易所可用保证金及其他占用。'],
  [-1111]:['价格或数量精度不符合交易所规则','检查当前 exchangeInfo 精度及冻结候选。'],
  [-1013]:['订单未通过交易所过滤规则','检查最小数量、名义价值及交易所过滤条件。'],
  [-4024]:['价格低于交易所当前允许下限','检查实时价格带，等待安全重定价或放弃订单。'],
  [-4025]:['价格高于交易所当前允许上限','检查实时价格带，等待安全重定价或放弃订单。'],
  [-5022]:['Maker-only 订单若会立即成交，交易所会拒绝挂单','等待下一次冻结候选和合法 maker 价格；不要将拒单显示为已挂单。'],
};
export function classifyOperationalError(input:{message:unknown;subsystem?:string;budgetPressureProven?:boolean;transportEvidence?:boolean;retryAfter?:string|null;blockedUntil?:number|null;httpStatus?:number|null;requestId?:string|null;endpoint?:string|null;method?:string|null;routeIdentity?:string|null;expectedEgressIp?:string|null;observedEgressIp?:string|null}):Candidate|null{
  const raw=text(input.message),status=input.httpStatus??Number(raw.match(/Binance HTTP (\d{3})/)?.[1]??0),code=Number(raw.match(/"code"\s*:\s*(-?\d+)/)?.[1]??NaN);
  let base:ReturnType<typeof template>|null=null;
  if(/TESTNET_WRITE_EGRESS_NOT_VERIFIED|BINANCE_EGRESS_(?:MISMATCH|UNAVAILABLE|UNVERIFIED)/.test(raw))return null;
  if(input.endpoint?.endsWith('/order')&&((input.method==='GET'&&code===-2013)||(input.method==='DELETE'&&code===-2011)))return null;
  if(HTTP[status])base=HTTP[status]!;
  else if(/SUBMIT.*UNKNOWN|ACK.*UNKNOWN|ENTRY_SUBMIT_UNACKED/.test(raw))base=SUBMIT;
  else if(/BINANCE_REQUEST_QUEUE_TIMEOUT/.test(raw))base=input.budgetPressureProven?null:input.transportEvidence?TIMEOUT:null;
  else if(/timed out|ETIMEDOUT|TimeoutError/i.test(raw))base=TIMEOUT;
  else if(/ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|SOCKS|PROXY_REQUIRED|socket|DNS|BINANCE_TRANSPORT_BLOCKED/i.test(raw))base=NETWORK;
  else if(Number.isFinite(code)){
    if(code===-1000)base=template('EX-BINANCE-1000','Binance 临时处理异常 -1000','Binance 未给出明确业务拒绝原因；该错误属于通用服务器/网络处理异常，不能据此判定账户或订单条件有误。','系统会保持 fail-closed 并安全重试；若持续发生，请检查 TESTNET/交易所服务与网络链路。','EXCHANGE',['EXCHANGE_WRITE','NEW_ENTRY']);
    else{const [meaning,action]=BUSINESS[code]??['交易所拒绝该请求，具体原因见原始返回','检查原始 Binance code/msg、账户与订单条件后处理。'];base=template(`EX-BINANCE-${Math.abs(code)}`,`Binance 业务错误 ${code}`,meaning,action,'EXCHANGE',['EXCHANGE_WRITE','NEW_ENTRY']);}
  }
  if(!base)return null;
  return {...base,subsystem:input.subsystem??'BINANCE',sourceCode:Number.isFinite(code)?String(code):status?`HTTP_${status}`:raw.split(/[:|]/)[0]??'UNKNOWN',sourceMessage:raw,requestId:input.requestId??null,endpoint:input.endpoint??null,method:input.method??null,routeIdentity:input.routeIdentity??null,httpStatus:status||null,binanceCode:Number.isFinite(code)?code:null,expectedEgressIp:input.expectedEgressIp??null,observedEgressIp:input.observedEgressIp??null,retryAfter:input.retryAfter??null,blockedUntil:input.blockedUntil??null};
}
export class OperationalIncidentTracker{
  private rows=new Map<string,OperationalIncident>();
  private archived:OperationalIncident[]=[];
  private pending=new Map<string,{count:number;lastSeenAt:number}>();
  observe(candidates:Candidate[],now=Date.now()){
    const seen=new Set<string>(),candidateIds=new Set<string>();
    for(const row of candidates){
      const networkRoot=row.publicCode==='NET-001'||row.publicCode==='NET-002',
        identity=networkRoot?`${row.publicCode}:${row.subsystem}:${row.routeIdentity??''}`:`${row.publicCode}:${row.subsystem}:${row.endpoint??''}:${row.routeIdentity??''}`,
        id=createHash('sha256').update(identity).digest('hex').slice(0,16);
      candidateIds.add(id);
      if(row.publicCode==='MARKET-DATA-001'){
        const prior=this.pending.get(id),next={count:prior&&now-prior.lastSeenAt<=10_000?prior.count+1:1,lastSeenAt:now};this.pending.set(id,next);
        // The execution gate pauses immediately; the operator alert waits for persistence.
        if(next.count<3)continue;
      }
      seen.add(id);const old=this.rows.get(id);if(old&&!old.active)this.archived.push(old);const repeated=old?.active&&old.sourceMessage===row.sourceMessage&&old.requestId===row.requestId;
      this.rows.set(id,{...row,incidentId:id,active:true,firstSeenAt:old?.active?old.firstSeenAt:now,lastSeenAt:now,recoveredAt:null,count:repeated?old.count:(old?.active?old.count:0)+1});
    }
    for(const id of [...this.pending.keys()])if(!candidateIds.has(id))this.pending.delete(id);
    for(const [id,row] of this.rows)if(row.active&&!seen.has(id))this.rows.set(id,{...row,active:false,recoveredAt:now});
    if(this.rows.size>200)for(const [id] of [...this.rows].filter(([,row])=>!row.active).sort((a,b)=>(a[1].recoveredAt??0)-(b[1].recoveredAt??0)).slice(0,this.rows.size-200))this.rows.delete(id);
    if(this.archived.length>200)this.archived.splice(0,this.archived.length-200);
    return this.read();
  }
  read(){const rows=[...this.rows.values(),...this.archived].sort((a,b)=>b.lastSeenAt-a.lastSeenAt);return{active:rows.filter(row=>row.active),history:rows};}
}
export function operationalCandidates(facts:{pipeline:any;routes:any[];account:any;marketStream?:any;valuation?:any;orders?:any}):Candidate[]{
  const out:Candidate[]=[];
  const now=Date.now(),marketHealthy=facts.pipeline?.pipelineState==='RUNNING'&&facts.pipeline?.freshMarkets?.status==='FRESH';
  const marketRestEndpoint=(endpoint:unknown)=>/\/fapi\/v1\/(openInterest|premiumIndex|ticker\/24hr|ticker\/bookTicker|depth|klines)$|\/futures\/data\//.test(String(endpoint??''));
  const controlEndpoint=(endpoint:unknown)=>String(endpoint??'')==='/fapi/v1/time';
  const timeoutLike=(message:unknown)=>/timed out|ETIMEDOUT|TimeoutError|BINANCE_REQUEST_QUEUE_TIMEOUT/i.test(String(message??''));
  for(const route of facts.routes){const budget=route.requestBudget??{},recent=budget.recentDispatches??[],failures=route.recentFailures??[];
    // A healthy WS stream is the primary market truth. REST market timeouts are tolerated while that
    // truth remains fresh; they are recovery telemetry, not a global NEW_ENTRY outage.
    const relevantFailures=failures.filter((failure:any)=>!controlEndpoint(failure.endpoint)&&!(marketHealthy&&marketRestEndpoint(failure.endpoint)));
    const makerRejects=relevantFailures.filter((failure:any)=>/"code"\s*:\s*-5022\b/.test(String(failure.message??''))&&now-Number(failure.completedAt??now)<60_000);
    for(const failure of relevantFailures){
      if(timeoutLike(failure.message))continue; // aggregated below with hysteresis
      if(/"code"\s*:\s*-5022\b/.test(String(failure.message??''))){if(makerRejects.length<3||failure!==makerRejects.at(-1))continue;}
      const row=classifyOperationalError({message:failure.message,subsystem:'BINANCE_HTTP',requestId:failure.requestId,endpoint:failure.endpoint,method:failure.method,routeIdentity:failure.routeIdentity});if(row)out.push(row);
    }
    const http=recent.filter((row:any)=>[418,429,451].includes(row.status)&&now-Number(row.completedAt??0)<120_000).at(-1);
    if(http){const row=classifyOperationalError({message:`Binance HTTP ${http.status}`,httpStatus:http.status,subsystem:'BINANCE_HTTP',endpoint:http.endpoint,method:http.method,requestId:http.requestId,routeIdentity:http.routeIdentity,retryAfter:http.retryAfter,blockedUntil:http.blockedUntil});if(row)out.push(row);}
    // Normal Internet/Testnet jitter is not an incident. Require a burst of >=3 critical timeout facts
    // inside 60s before NET-002 becomes visible. One or two isolated failures remain telemetry only.
    const transportTimeouts=relevantFailures.filter((row:any)=>timeoutLike(row.message)&&now-Number(row.completedAt??now)<60_000);
    const queueTimeouts=recent.filter((row:any)=>row.decision==='TIMEOUT'&&now-Number(row.completedAt??0)<60_000&&!controlEndpoint(row.endpoint)&&!(marketHealthy&&marketRestEndpoint(row.endpoint)));
    const timeoutFacts=[...transportTimeouts,...queueTimeouts],latest=timeoutFacts.at(-1),lowPressure=Number(budget.admissionObservedWeight1m??budget.usedWeight1m??Infinity)<Number(budget.softBackgroundWeight??0);
    if(latest&&timeoutFacts.length>=3&&lowPressure){
      const row=classifyOperationalError({message:'BINANCE_REQUEST_QUEUE_TIMEOUT',subsystem:'BINANCE_HTTP',transportEvidence:true,budgetPressureProven:false,endpoint:latest.endpoint,method:latest.method,requestId:latest.requestId,routeIdentity:latest.routeIdentity});if(row)out.push(row);
    }
  }
  if(facts.pipeline?.pipelineState==='PAUSED_MARKET_DATA_UNAVAILABLE'&&!out.some(row=>row.category==='NETWORK'))out.push({...MARKET,subsystem:'MARKET_DATA',sourceCode:String(facts.pipeline.marketDataReason??'MARKET_QUOTES_STALE'),sourceMessage:text(facts.pipeline.marketDataReason??'MARKET_QUOTES_STALE')});
  if(facts.account?.status==='UNAVAILABLE'&&facts.account.reason){const row=classifyOperationalError({message:facts.account.reason,subsystem:'PRIVATE_DATA'});if(row)out.push(row);}
  if(facts.valuation?.status==='ACCOUNT_VALUATION_INCONSISTENT')out.push({...template('ACCOUNT_VALUATION_INCONSISTENT','账户估值无法对账','同一 Binance 快照的钱包、浮盈亏与账户权益不一致。','检查交易所账户字段与资产换算；暂勿将该数字视为总资产。','ACCOUNT',['PRIVATE_DATA']),subsystem:'ACCOUNT',sourceCode:'ACCOUNT_VALUATION_INCONSISTENT',sourceMessage:'same-snapshot invariant failed'});
  // Historical UNKNOWN rows remain in the audit and risk occupancy models.  A
  // submit incident describes a current submit acknowledgement gap only.
  if((facts.orders??[]).some((order:any)=>order.status==='UNKNOWN'&&order.activeRiskExposure!==false&&Number.isFinite(Number(order.createdAt))&&Date.now()-Number(order.createdAt)<3_600_000))out.push({...SUBMIT,subsystem:'ENTRY_ORDER',sourceCode:'ENTRY_SUBMIT_UNKNOWN',sourceMessage:'recent unresolved order identity'});
  return out;
}

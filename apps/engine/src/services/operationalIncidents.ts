import {createHash} from 'node:crypto';
import type {OperationalIncident} from '@zdj/contracts';

type Candidate=Omit<OperationalIncident,'incidentId'|'active'|'firstSeenAt'|'lastSeenAt'|'recoveredAt'|'count'>;
const text=(value:unknown)=>String(value??'').replace(/(apiKey|apiSecret|signature|authorization)=([^&\s]+)/gi,'$1=[REDACTED]').slice(0,600);
const template=(publicCode:string,titleZh:string,messageZh:string,remediationZh:string,category:OperationalIncident['category'],blockingScopes:string[]):Pick<Candidate,'publicCode'|'titleZh'|'messageZh'|'remediationZh'|'category'|'severity'|'blockingScopes'>=>({publicCode,titleZh,messageZh,remediationZh,category,severity:'ERROR',blockingScopes});
const NETWORK=template('NET-001','VPN或网络错误','无法连接 Binance，依赖交易所事实的操作已安全暂停。','检查 VPN、代理和网络，并使用符合交易所规则的可访问出口。','NETWORK',['MARKET_DATA','NEW_ENTRY','EXCHANGE_WRITE']);
const TIMEOUT=template('NET-002','VPN或网络延迟过高','Binance 请求持续超时，依赖实时事实的新建仓已安全暂停。','检查网络质量或切换低延迟、可合法访问的出口。','NETWORK',['MARKET_DATA','NEW_ENTRY']);
const EGRESS_UNAVAILABLE=template('NET-003','出口网络无法验证','系统无法确认当前出口 IP，交易写入已安全暂停。','检查 VPN/代理连接后重新检测出口。','NETWORK',['EXCHANGE_WRITE','NEW_ENTRY']);
const EGRESS_MISMATCH=template('NET-004','出口 IP 与配置不一致','当前出口与预期出口不一致，交易写入已安全暂停。','切换到正确出口，或按 Settings 配置流程更新预期出口。','NETWORK',['EXCHANGE_WRITE','NEW_ENTRY']);
const MARKET=template('MARKET-DATA-001','行情事实不可用','当前没有数据完整的可执行候选，新建仓分析已暂停。','等待行情自动恢复；若持续发生，请检查行情连接与交易所状态。','MARKET_DATA',['MARKET_DATA','NEW_ENTRY']);
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
};
export function classifyOperationalError(input:{message:unknown;subsystem?:string;budgetPressureProven?:boolean;transportEvidence?:boolean;retryAfter?:string|null;blockedUntil?:number|null;httpStatus?:number|null;requestId?:string|null;endpoint?:string|null;method?:string|null;routeIdentity?:string|null;expectedEgressIp?:string|null;observedEgressIp?:string|null}):Candidate|null{
  const raw=text(input.message),status=input.httpStatus??Number(raw.match(/Binance HTTP (\d{3})/)?.[1]??0),code=Number(raw.match(/"code"\s*:\s*(-?\d+)/)?.[1]??NaN);
  let base:ReturnType<typeof template>|null=null;
  if(/TESTNET_WRITE_EGRESS_NOT_VERIFIED:MISMATCH|BINANCE_EGRESS_MISMATCH/.test(raw))base=EGRESS_MISMATCH;
  else if(/TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE|BINANCE_EGRESS_UNAVAILABLE/.test(raw))base=EGRESS_UNAVAILABLE;
  else if(HTTP[status])base=HTTP[status]!;
  else if(/SUBMIT.*UNKNOWN|ACK.*UNKNOWN|ENTRY_SUBMIT_UNACKED/.test(raw))base=SUBMIT;
  else if(/BINANCE_REQUEST_QUEUE_TIMEOUT/.test(raw))base=input.budgetPressureProven?null:input.transportEvidence?TIMEOUT:null;
  else if(/timed out|ETIMEDOUT|TimeoutError/i.test(raw))base=TIMEOUT;
  else if(/ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|SOCKS|PROXY_REQUIRED|socket|DNS|BINANCE_TRANSPORT_BLOCKED/i.test(raw))base=NETWORK;
  else if(Number.isFinite(code)){
    const [meaning,action]=BUSINESS[code]??['交易所拒绝该请求，具体原因见原始返回','检查原始 Binance code/msg、账户与订单条件后处理。'];
    base=template(`EX-BINANCE-${Math.abs(code)}`,`Binance 业务错误 ${code}`,meaning,action,'EXCHANGE',['EXCHANGE_WRITE','NEW_ENTRY']);
  }
  if(!base)return null;
  return {...base,subsystem:input.subsystem??'BINANCE',sourceCode:Number.isFinite(code)?String(code):status?`HTTP_${status}`:raw.split(/[:|]/)[0]??'UNKNOWN',sourceMessage:raw,requestId:input.requestId??null,endpoint:input.endpoint??null,method:input.method??null,routeIdentity:input.routeIdentity??null,httpStatus:status||null,binanceCode:Number.isFinite(code)?code:null,expectedEgressIp:input.expectedEgressIp??null,observedEgressIp:input.observedEgressIp??null,retryAfter:input.retryAfter??null,blockedUntil:input.blockedUntil??null};
}
export class OperationalIncidentTracker{
  private rows=new Map<string,OperationalIncident>();
  private archived:OperationalIncident[]=[];
  observe(candidates:Candidate[],now=Date.now()){
    const seen=new Set<string>();
    for(const row of candidates){const id=createHash('sha256').update(`${row.publicCode}:${row.subsystem}:${row.endpoint??''}:${row.routeIdentity??''}`).digest('hex').slice(0,16);seen.add(id);const old=this.rows.get(id);if(old&&!old.active)this.archived.push(old);const repeated=old?.active&&old.sourceMessage===row.sourceMessage&&old.requestId===row.requestId;this.rows.set(id,{...row,incidentId:id,active:true,firstSeenAt:old?.active?old.firstSeenAt:now,lastSeenAt:now,recoveredAt:null,count:repeated?old.count:(old?.active?old.count:0)+1});}
    for(const [id,row] of this.rows)if(row.active&&!seen.has(id))this.rows.set(id,{...row,active:false,recoveredAt:now});
    if(this.rows.size>200)for(const [id] of [...this.rows].filter(([,row])=>!row.active).sort((a,b)=>(a[1].recoveredAt??0)-(b[1].recoveredAt??0)).slice(0,this.rows.size-200))this.rows.delete(id);
    if(this.archived.length>200)this.archived.splice(0,this.archived.length-200);
    return this.read();
  }
  read(){const rows=[...this.rows.values(),...this.archived].sort((a,b)=>b.lastSeenAt-a.lastSeenAt);return{active:rows.filter(row=>row.active),history:rows};}
}
export function operationalCandidates(facts:{pipeline:any;routes:any[];account:any;marketStream?:any;valuation?:any;orders?:any}):Candidate[]{
  const out:Candidate[]=[];
  for(const route of facts.routes){const egress=route.egress??{},budget=route.requestBudget??{},recent=budget.recentDispatches??[];
    if(egress.status==='MISMATCH'||egress.status==='UNAVAILABLE'){const row=classifyOperationalError({message:egress.status==='MISMATCH'?'BINANCE_EGRESS_MISMATCH':'BINANCE_EGRESS_UNAVAILABLE',expectedEgressIp:egress.expectedEgressIp,observedEgressIp:egress.lastVerifiedEgressIp,routeIdentity:egress.routeIdentity});if(row)out.push(row);}
    const http=recent.filter((row:any)=>[418,429,451].includes(row.status)&&Date.now()-Number(row.completedAt??0)<120_000).at(-1);
    if(http){const row=classifyOperationalError({message:`Binance HTTP ${http.status}`,httpStatus:http.status,subsystem:'BINANCE_HTTP',endpoint:http.endpoint,method:http.method,requestId:http.requestId,routeIdentity:http.routeIdentity,retryAfter:http.retryAfter,blockedUntil:http.blockedUntil});if(row)out.push(row);}
    const stream=facts.marketStream??facts.pipeline?.marketDataDetail??{},timeout=recent.filter((row:any)=>row.decision==='TIMEOUT'&&Date.now()-Number(row.completedAt??0)<60_000).at(-1),lowPressure=Number(budget.admissionObservedWeight1m??budget.usedWeight1m??Infinity)<Number(budget.softBackgroundWeight??0),transportEvidence=Boolean(stream.lastError||stream.streamError||(facts.pipeline?.marketDataReason&&stream.connectedAt&&Date.now()-Number(stream.connectedAt)<60_000));
    if(timeout&&lowPressure&&transportEvidence){const row=classifyOperationalError({message:'BINANCE_REQUEST_QUEUE_TIMEOUT',subsystem:'BINANCE_HTTP',transportEvidence:true,budgetPressureProven:false,endpoint:timeout.endpoint,method:timeout.method,requestId:timeout.requestId,routeIdentity:timeout.routeIdentity});if(row)out.push(row);}
  }
  if(facts.pipeline?.pipelineState==='PAUSED_MARKET_DATA_UNAVAILABLE'&&!out.some(row=>row.category==='NETWORK'))out.push({...MARKET,subsystem:'MARKET_DATA',sourceCode:String(facts.pipeline.marketDataReason??'MARKET_QUOTES_STALE'),sourceMessage:text(facts.pipeline.marketDataReason??'MARKET_QUOTES_STALE')});
  if(facts.account?.status==='UNAVAILABLE'&&facts.account.reason){const row=classifyOperationalError({message:facts.account.reason,subsystem:'PRIVATE_DATA'});if(row)out.push(row);}
  if(facts.valuation?.status==='ACCOUNT_VALUATION_INCONSISTENT')out.push({...template('ACCOUNT_VALUATION_INCONSISTENT','账户估值无法对账','同一 Binance 快照的钱包、浮盈亏与账户权益不一致。','检查交易所账户字段与资产换算；暂勿将该数字视为总资产。','ACCOUNT',['PRIVATE_DATA']),subsystem:'ACCOUNT',sourceCode:'ACCOUNT_VALUATION_INCONSISTENT',sourceMessage:'same-snapshot invariant failed'});
  // Historical UNKNOWN rows remain in the audit and risk occupancy models.  A
  // submit incident describes a current submit acknowledgement gap only.
  if((facts.orders??[]).some((order:any)=>order.status==='UNKNOWN'&&order.activeRiskExposure!==false&&Number.isFinite(Number(order.createdAt))&&Date.now()-Number(order.createdAt)<3_600_000))out.push({...SUBMIT,subsystem:'ENTRY_ORDER',sourceCode:'ENTRY_SUBMIT_UNKNOWN',sourceMessage:'recent unresolved order identity'});
  return out;
}

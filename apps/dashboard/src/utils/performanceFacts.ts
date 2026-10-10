export type LampTone='good'|'warn'|'bad'|'unknown';
export type LampFact={tone:LampTone;text:string;detail:string};
export const numberOrNull=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
export const ageMs=(stamp:unknown,now=Date.now()):number|null=>{
  const value=numberOrNull(stamp);
  return value!==null&&value>0&&value<=now?now-value:null;
};
export const stale=(stamp:unknown,now=Date.now(),ttl=60_000)=>{const age=ageMs(stamp,now);return age===null||age>ttl;};
export function aiLamp(resource:any,now=Date.now()):LampFact{
  if(!resource)return{tone:'unknown',text:'数据缺失',detail:'没有收到模型资源记录'};
  if(stale(resource.healthCheckedAt,now,60_000))return{tone:'unknown',text:'未确认',detail:'模型连接探测时间缺失或已过期'};
  if(resource.connectionStatus==='OFFLINE')return{tone:'bad',text:'断开',detail:String(resource.healthReason??'模型探测失败')};
  if(resource.connectionStatus==='DEGRADED'||resource.connectionStatus==='MAINTENANCE')return{tone:'warn',text:resource.connectionStatus==='MAINTENANCE'?'维护中':'探测未完成',detail:String(resource.healthReason??'维护期间停止新推理；超时不等于模型崩溃')};
  if(resource.connectionStatus!=='ONLINE')return{tone:'unknown',text:'未确认',detail:'连接状态未确认'};
  if(resource.currentStatus==='DEGRADED'||resource.currentStatus==='FAILED')return{tone:'warn',text:'告警',detail:String(resource.idleReason??'近期推理失败')};
  if(Number(resource.queueDepth)>0)return{tone:'warn',text:'排队',detail:'队列深度 '+resource.queueDepth};
  if(Number(resource.active)>0)return{tone:'good',text:'推理中',detail:'模型连接正常，存在自然任务'};
  return{tone:'good',text:'空闲',detail:String(resource.nextStep??'模型连接正常，当前无任务')};
}
export function exchangeLamp(snapshot:any,incidents:any[]=[],now=Date.now(),evidence?:any):LampFact{
  const active=Array.isArray(incidents)?incidents.filter((row:any)=>row?.active===true):[];
  const error=active.find((row:any)=>['EXCHANGE','NETWORK'].includes(row.category)&&row.httpStatus===451);
  if(error)return{tone:'bad',text:'HTTP 451',detail:'已记录活跃的交易所HTTP拒绝；无法凭此断定SOCKS故障，不得切换出口绕过'};
  const failed=active.find((row:any)=>[502,503].includes(row.httpStatus));
  if(failed)return{tone:'bad',text:'HTTP '+failed.httpStatus,detail:'已记录明确HTTP失败；订单响应UNKNOWN不能自动重发'};
  const limited=active.find((row:any)=>[418,429].includes(row.httpStatus));
  if(limited)return{tone:'warn',text:'交易所HTTP告警',detail:'活跃HTTP '+limited.httpStatus+'，应与SOCKS/SSH超时分层排查'};
  const transport=active.find((row:any)=>row.category==='NETWORK');
  if(transport)return{tone:'warn',text:transport.publicCode==='BINANCE-QUEUE-001'?'本地排队拥塞':'请求链路告警',detail:String(transport.messageZh??'关键请求超时或无法连接；不能凭此断定代理或模型崩溃')};
  const service=Array.isArray(snapshot?.health)?snapshot.health.find((r:any)=>r.id==='trading-network'):null;
  if(!service||stale(service.updatedAt,now,60_000))
    return{tone:'unknown',text:'状态未确认',detail:'缺少最近60秒的交易网络健康报告'};
  if(service.status==='OFFLINE')return{tone:'bad',text:'网络离线',detail:String(service.detail??'交易网络无法使用')};
  if(service.status==='DEGRADED')return{tone:'warn',text:'网络降级',detail:String(service.detail??'交易网络服务降级')};
  if(service.status==='HEALTHY'){
    if(evidence!==undefined){const requests=Object.values(evidence?.budgets??{}).flatMap((b:any)=>Array.isArray(b?.recentDispatches)?b.recentDispatches:[]);if(!requests.some((r:any)=>typeof r.status==='number'&&r.status>=200&&r.status<300&&evidence?.routes?.some((route:any)=>route.rest?.routeIdentity===r.routeIdentity)&&!stale(r.completedAt,now,30_000)))return{tone:'unknown',text:'网络待确认',detail:'执行门禁就绪不等于当前网络正常；没有最近30秒当前路由成功HTTP事实'};}
    return{tone:'good',text:'网络报告正常',detail:'最近请求及引擎执行门禁读回；不代表账户地区授权、签名TP或每条WS事件已独立验证'};
  }
  return{tone:'unknown',text:'状态未确认',detail:'未识别的交易网络健康状态'};
}
export function proxyLamp(routes:any,evidence?:any,now=Date.now()):LampFact{
  if(!Array.isArray(routes)||!routes.length)return{tone:'unknown',text:'未确认',detail:'没有代理链路状态'};
  if(routes.some((r:any)=>r.rest?.throughProxy===false||r.rest?.failClosed===false))
    return{tone:'bad',text:'配置异常',detail:'REST 未通过受控代理或 fail-closed 未生效'};
  if(routes.some((r:any)=>r.ws?.configurationError))
    return{tone:'warn',text:'路由告警',detail:'WebSocket 路由配置异常'};
  const requests=Object.values(evidence?.budgets??{}).flatMap((b:any)=>Array.isArray(b?.recentDispatches)?b.recentDispatches:[]);
  const verified=routes.every((route:any)=>requests.some((r:any)=>r.routeIdentity===route.rest?.routeIdentity&&typeof r.status==='number'&&r.status>=200&&r.status<500&&!stale(r.completedAt,now,30_000)));
  if(verified)return{tone:'good',text:'代理请求已返回',detail:'最近30秒配置路由收到HTTP响应；不等同于SSH进程或交易所授权验证'};
  return{tone:'warn',text:'已配置 / 未验证',detail:'通过 SOCKS 配置不等于 SSH/TCP 通道实时可达；需要独立连接探测'};
}
export function privateLamp(snapshot:any,now=Date.now(),diagnostics?:any):LampFact{
  const a=snapshot?.account;
  if(!a||!a.status)return{tone:'unknown',text:'未确认',detail:'没有私有账户快照'};
  if(a.status==='UNAVAILABLE')return{tone:'bad',text:'不可用',detail:String(a.reason??'私有事实不可用')};
  if(a.status==='STALE'||stale(a.asOf,now,60_000))return{tone:'unknown',text:'过期 / 待确认',detail:'私有数据采样超过60秒或缺失'};
  if(diagnostics?.sync?.consecutiveFailures>0||diagnostics?.sync?.lastError)return{tone:'warn',text:'同步降级',detail:'私有同步最近失败；账户缓存仍在新鲜窗口内'};
  if(a.status==='READY')return{tone:'good',text:'同步正常',detail:'账户快照新鲜；不等同于独立签名TP已全部核对'};
  return{tone:'warn',text:String(a.status),detail:'私有同步尚未就绪'};
}
export function p95(values:unknown[]):number|null{
  const x=values.map(numberOrNull).filter((n):n is number=>n!==null&&n>=0).sort((a,b)=>a-b);
  return x.length?x[Math.ceil(x.length*.95)-1]!:null;
}
export function uniqueAiRunStats(runs:any[]){
  const list=[...new Map(runs.filter(r=>r?.id).map(r=>[r.id,r])).values()];
  const byRole=['SCOUT','PRIMARY_BRAIN','REVIEW_BRAIN'].map(role=>{
    const items=list.filter(r=>r.role===role);
    const timed=items.filter(r=>numberOrNull(r?.timing?.queueMs)!==null);
    return{role,count:items.length,failed:items.filter(r=>r.status==='FAILED'||r.status==='TIMEOUT').length,
      queuedP95Ms:p95(timed.map(r=>r.timing.queueMs)),timingSamples:timed.length};
  });
  return{byRole,rows:list.length};
}
export function withSampleGaps(points:Array<{ts:number;value:number|null}>,ttlMs:number){
  const sorted=points.filter(p=>Number.isFinite(p.ts)).sort((a,b)=>a.ts-b.ts),out:Array<{ts:number;value:number|null}>=[];
  for(const p of sorted){const last=out.at(-1);if(last&&p.ts-last.ts>ttlMs)out.push({ts:last.ts+1,value:null});out.push(p);}
  return out;
}

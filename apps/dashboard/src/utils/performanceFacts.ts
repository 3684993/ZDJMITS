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
  if(resource.connectionStatus!=='ONLINE')return{tone:'unknown',text:'未确认',detail:'连接状态未确认'};
  if(resource.currentStatus==='DEGRADED'||resource.currentStatus==='FAILED')return{tone:'warn',text:'告警',detail:String(resource.idleReason??'近期推理失败')};
  if(Number(resource.queueDepth)>0)return{tone:'warn',text:'排队',detail:'队列深度 '+resource.queueDepth};
  if(Number(resource.active)>0)return{tone:'good',text:'推理中',detail:'模型连接正常，存在自然任务'};
  return{tone:'good',text:'空闲',detail:String(resource.nextStep??'模型连接正常，当前无任务')};
}
export function proxyLamp(routes:any):LampFact{
  if(!Array.isArray(routes)||!routes.length)return{tone:'unknown',text:'未确认',detail:'没有代理链路状态'};
  if(routes.some((r:any)=>r.rest?.throughProxy===false||r.rest?.failClosed===false))
    return{tone:'bad',text:'配置异常',detail:'REST 未通过受控代理或 fail-closed 未生效'};
  if(routes.some((r:any)=>r.ws?.configurationError))
    return{tone:'warn',text:'路由告警',detail:'WebSocket 路由配置异常'};
  return{tone:'warn',text:'已配置 / 未验证',detail:'通过 SOCKS 配置不等于 SSH/TCP 通道实时可达；需要独立连接探测'};
}
export function privateLamp(snapshot:any,now=Date.now()):LampFact{
  const a=snapshot?.account;
  if(!a||!a.status)return{tone:'unknown',text:'未确认',detail:'没有私有账户快照'};
  if(a.status==='UNAVAILABLE')return{tone:'bad',text:'不可用',detail:String(a.reason??'私有事实不可用')};
  if(a.status==='STALE'||stale(a.asOf,now,60_000))return{tone:'warn',text:'过期 / 待确认',detail:'私有数据采样超过60秒或缺失'};
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

import {aiLamp,exchangeLamp,privateLamp,proxyLamp,stale,type LampFact} from './performanceFacts';

export type CockpitSignal={id:string;label:string;tone:LampFact['tone'];text:string;detail:string};
const signal=(id:string,label:string,fact:LampFact):CockpitSignal=>({id,label,...fact});
/** Environment uses the exact configured execution identity. A missing/stale snapshot is NOT production. */
export function environmentSignal(snapshot:any,now=Date.now()):CockpitSignal{
  if(!snapshot||stale(snapshot.ts,now,60_000))
    return signal('environment','交易环境',{tone:'bad',text:'环境未确认',detail:'缺少新鲜 Engine 配置快照；不能假定测试盘或实盘'});
  const name=String(snapshot.settings?.connections?.exchange?.environment??'').toUpperCase();
  const mode=String(snapshot.settings?.connections?.executionMode??'');
  if(name==='TESTNET')return signal('environment','交易环境',{tone:'warn',text:'测试盘',detail:'Engine environment=TESTNET · '+mode+'；测试环境不是实盘'});
  if(name==='PRODUCTION')return signal('environment','交易环境',{tone:'good',text:'实盘',detail:'Engine environment=PRODUCTION · '+mode+'；此灯仅表示环境配置，并非下单授权或Production写入证明'});
  return signal('environment','交易环境',{tone:'bad',text:'环境异常',detail:'交易环境缺失或不受支持，禁止从标签推断交易权限'});
}
/** Signed private account and routed REST jointly prove an effective exchange path, not SSH handshake telemetry. */
export function effectiveProxySignal(routes:any,snapshot:any,now=Date.now()):CockpitSignal{
  const configured=proxyLamp(routes);
  if(configured.tone==='bad')return signal('proxy','代理',configured);
  const privateStatus=privateLamp(snapshot,now);
  if(configured.tone==='warn'&&privateStatus.tone==='good')
    return signal('proxy','代理',{tone:'good',text:'交易通路可用',detail:'SOCKS REST路由配置与新鲜签名账户快照同时存在；证明交易所功能性可达，不代表SSH握手/出口链路已独立探测'});
  return signal('proxy','代理',configured);
}
export function cockpitSignals(input:{snapshot:any;routes:any;resources:any[];incidents?:any[];now?:number}):CockpitSignal[]{
  const now=input.now??Date.now();
  const account=privateLamp(input.snapshot,now);
  // Prioritize known exchange errors; a fresh signed account can prove private reads when health is absent.
  const exchange=exchangeLamp(input.snapshot,input.incidents??[],now);
  const usableExchange=exchange.tone==='unknown'&&account.tone==='good'
    ?{tone:'good' as const,text:'签名账户可达',detail:'60秒内确认签名私有账户数据；并不证明每一笔订单或SSH独立监测'}
    :exchange;
  const rows=[
    environmentSignal(input.snapshot,now),
    effectiveProxySignal(input.routes,input.snapshot,now),
    signal('exchange','交易所',usableExchange),
    signal('private','私有同步',account),
  ];
  const roles=[['SCOUT','Scout'],['PRIMARY_BRAIN','Primary'],['REVIEW_BRAIN','Review']] as const;
  for(const [role,label] of roles){
    const resource=Array.isArray(input.resources)?input.resources.find(r=>r?.role===role):null;
    rows.push(signal(role,label,aiLamp(resource,now)));
  }
  const tp=input.snapshot?.executionTruth?.takeProfitCoverage;
  if(!tp||stale(input.snapshot?.ts,now,60_000))
    rows.push(signal('tp','持仓保护',{tone:'unknown',text:'等待事实',detail:'缺少当前实例的TP保护口径；不等同于签名交易所保护单核验'}));
  else if(Number(tp.missing)>0||tp.status==='OFFLINE')
    rows.push(signal('tp','持仓保护',{tone:'bad',text:'保护缺口',detail:`已报告缺失${tp.missing??'未确认'}；不得以本地保护数替代签名交易所订单`}));
  else if(tp.status==='HEALTHY'&&Number(tp.unresolved??0)===0)
    rows.push(signal('tp','持仓保护',{tone:'good',text:'本地覆盖',detail:'Engine 当前TP覆盖投影正常；正式发布仍需新鲜签名TP全仓证明'}));
  else rows.push(signal('tp','持仓保护',{tone:'warn',text:'待核验',detail:String(tp.detail??'TP覆盖证据尚未闭合')}));
  return rows;
}

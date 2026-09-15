import { resolveUnderlying } from '@zdj/core';

const activeStatuses=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const value=(input:unknown)=>typeof input==='string'&&input.trim()?input.trim():null;

export function p0EntryIntegrity(input:{entryOrders:any[];entryIntents:any[];fills:any[];primaryRuns:any[];events:any[];since:number;verifiedOrderFactMismatchCount?:number}){
  const orders=input.entryOrders,intents=new Map(input.entryIntents.map(row=>[row.id,row]));
  const crossSymbolOrderMismatchCount=input.fills.filter(fill=>{
    if(!fill.decisionChainId)return false;
    const linked=orders.find(order=>order.decisionChainId===fill.decisionChainId);
    return Boolean(linked&&linked.symbol!==fill.symbol);
  }).length+input.events.filter(event=>event.type==='ENTRY_ORDER_ACTIVE_RESTORED'&&value(event.symbol)&&value(event.payload?.symbol)&&event.symbol!==event.payload.symbol).length;
  const activeRemoteEntryWithNewPrimaryCount=orders.filter(order=>activeStatuses.has(order.status)&&String(order.factSource??'').startsWith('BINANCE')).reduce((count,order)=>{
    const owner=order.decisionChainId??intents.get(order.intentId)?.brainRunId??null,underlying=resolveUnderlying(order.symbol),anchor=Math.max(input.since,Number(order.createdAt??0));
    return count+input.primaryRuns.filter(run=>run.role==='PRIMARY_BRAIN'&&run.id!==owner&&run.startedAt>=anchor&&resolveUnderlying(run.symbol)===underlying).length;
  },0);
  const verifiedRiskRelease=(event:any)=>{
    const p=event.payload,e=p?.evidence,at=Number(event.ts),symbol=p?.symbol??event.symbol,identity=p?.clientOrderId??p?.exchangeOrderId??p?.orderId;
    const required=['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT'];
    const positionRiskExcluded=e?.sources?.includes('BINANCE_LONG_SHORT_POSITION_ZERO')||e?.sources?.includes('POSITION_PRESENT_PROVEN_OTHER_CYCLE');
    return p?.occupancyReleased===true&&p.activeRiskExposure===false&&e?.status==='VERIFIED_NO_ACTIVE_RISK'&&Number.isFinite(at)&&Number.isFinite(e.checkedAt)&&e.checkedAt<=at&&e.validUntil>at&&symbol&&identity&&e.identityTombstone===`ENTRY:${String(symbol).toUpperCase()}:${identity}`&&required.every(source=>e.sources?.includes(source))&&positionRiskExcluded;
  };
  const releaseEvents=input.events.filter(event=>event.type==='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED'&&event.payload?.occupancyReleased!==false);
  const verifiedNoActiveRiskReleaseCount=releaseEvents.filter(verifiedRiskRelease).length;
  const unverifiedRemoteTerminalReleasedOccupancyCount=releaseEvents.length-verifiedNoActiveRiskReleaseCount;
  const BrainRunMisattributionCount=input.events.filter(event=>{
    if(event.type==='CANDIDATE_LIFECYCLE_CHANGED'&&['PRIMARY_QUEUED','PRIMARY_RUNNING'].includes(event.payload?.status))return Boolean(value(event.payload?.runId));
    const brain=value(event.payload?.brainRunId),chain=value(event.payload?.decisionChainId);
    return Boolean(brain&&chain&&brain!==chain);
  }).length;
  const verifiedOrderFactMismatchCount=Number(input.verifiedOrderFactMismatchCount??0);
  return{verifiedNoActiveRiskReleaseCount,crossSymbolOrderMismatchCount,activeRemoteEntryWithNewPrimaryCount,unverifiedRemoteTerminalReleasedOccupancyCount,BrainRunMisattributionCount,verifiedOrderFactMismatchCount,passed:[crossSymbolOrderMismatchCount,activeRemoteEntryWithNewPrimaryCount,unverifiedRemoteTerminalReleasedOccupancyCount,BrainRunMisattributionCount,verifiedOrderFactMismatchCount].every(count=>count===0)};
}

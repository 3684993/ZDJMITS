import type { RuntimeState } from '../state/runtimeState.js';

const activeOrderStatuses=new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const runnableLifecycle=new Set(['READY','SHORTLIST','SCOUT_QUEUED','SCOUT_RUNNING','SCOUT_DONE','PRIMARY_QUEUED','PRIMARY_RUNNING','PLACE_READY']);
const blockerCategory=(reason:string):'SUPPLY'|'CAPITAL'|'CAPACITY'|'RISK'|'MARKET'|'GOVERNANCE'|'AI'=>{
  const r=reason.toUpperCase();
  if(r.includes('AI_')||r.includes('PRIMARY_'))return'AI';
  if(r.includes('RISK')||r.includes('DRAWDOWN')||r.includes('CIRCUIT'))return'RISK';
  if(r.includes('POSITION_CAPACITY')||r.includes('MAX_POSITION')||r.includes('RESERVATION')||r.includes('OCCUP'))return'CAPACITY';
  if(r.includes('CAPITAL')||r.includes('MARGIN')||r.includes('BALANCE')||r.includes('DIRECTION_CAPACITY')||r.includes('NOT_ROUTED'))return'CAPITAL';
  if(r.includes('STALE')||r.includes('TECHNICAL')||r.includes('QUOTE')||r.includes('ORDER_BOOK')||r.includes('MARKET')||r.includes('DATA_'))return'MARKET';
  if(r.includes('ASSET_')||r.includes('GOVERNANCE')||r.includes('BLACKLIST')||r.includes('EXCLUDED')||r.includes('QUALITY_'))return'GOVERNANCE';
  return'SUPPLY';
};

export function candidateSupplyHealth(state:RuntimeState){
  const pool=state.pool.list(),universe=state.universe,capital=state.runtimeControl.capital;
  const resident=universe.filter(x=>x.residentEligible&&x.rank>0);
  const pipelineReady=universe.filter(x=>x.eligible&&x.rank>0&&x.pipelineEligible!==false);
  const routeBySymbol=new Map(capital.routedCandidates.map(route=>[route.symbol,route]));
  const executionReady=pipelineReady.filter(candidate=>{const route=routeBySymbol.get(candidate.symbol);return Boolean(route&&(route.longExecutable||route.shortExecutable));});
  const positions=new Set([...state.positions.values()].map(position=>String(position.symbol)));
  const activeEntries=new Set([...state.entryOrders.values()].filter(order=>activeOrderStatuses.has(order.status)).map(order=>String(order.symbol)));
  const protectedSymbols=new Set<string>(['BTCUSDT','ETHUSDT',...universe.map(candidate=>candidate.symbol),...positions,...activeEntries]);
  for(const [symbol,row] of state.candidateLifecycle)if(String(row?.status??'').includes('WAIT')||String(row?.status??'').includes('PRIMARY')||String(row?.status??'').includes('ANALYZ'))protectedSymbols.add(symbol);
  const zombieSnapshots=[...state.snapshots.keys()].filter(symbol=>!protectedSymbols.has(symbol));
  const consumed=new Set<string>([...positions,...activeEntries]);
  for(const [symbol,row] of state.candidateLifecycle)if(['QUARANTINED','POSITION_HELD','ENTRY_WORKING'].includes(String(row?.status??'')))consumed.add(symbol);
  const blockers=new Map<string,number>();
  const add=(reason:string,by=1)=>blockers.set(reason,(blockers.get(reason)??0)+by);
  const executionReadySymbols=new Set(executionReady.map(candidate=>candidate.symbol));
  for(const candidate of resident){
    if(executionReadySymbols.has(candidate.symbol))continue;
    if(!candidate.eligible)for(const reason of candidate.exclusionReasons??[])add(reason);
    if(candidate.pipelineEligible===false){const status=String(candidate.lifecycle??state.candidateLifecycle.get(candidate.symbol)?.status??'PIPELINE_BLOCKED');if(!runnableLifecycle.has(status))add(`LIFECYCLE_${status}`);}
    const route=routeBySymbol.get(candidate.symbol);if(!route)add('CAPITAL_NOT_ROUTED');else if(!route.longExecutable&&!route.shortExecutable)add('DIRECTION_CAPACITY_UNAVAILABLE');
  }
  for(const [reason,count] of Object.entries(capital.reasonCounts??{})){const numericCount=Number(count);if(numericCount>0)add(`CAPITAL_${reason}`,numericCount);}
  const topBlockers=[...blockers.entries()].map(([reason,count])=>({reason,count,category:blockerCategory(reason)})).sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason)).slice(0,12);
  const blockerCategories={SUPPLY:0,CAPITAL:0,CAPACITY:0,RISK:0,MARKET:0,GOVERNANCE:0,AI:0};for(const [reason,count] of blockers)blockerCategories[blockerCategory(reason)]+=count;
  const readyZeroReason=executionReady.length===0?[...Object.entries(blockerCategories)].sort((a,b)=>b[1]-a[1])[0]?.[0]??'SUPPLY':null;
  return {
    semanticVersion:'PHASE_A_V1',activeCohortCount:state.snapshots.size,activeCohortSemantic:'CURRENT_ONLINE_SNAPSHOT_SET',residentCount:resident.length,pipelineReadyCount:pipelineReady.length,executionReadyCount:executionReady.length,capitalExecutableCount:capital.executableCandidateCount,poolResidentCount:pool.length,poolReadyCount:pool.filter(item=>item.state==='READY').length,poolWaitingCount:pool.filter(item=>item.state==='WAITING').length,consumedCount:consumed.size,zombieSnapshotCount:zombieSnapshots.length,zombieSnapshots:zombieSnapshots.slice(0,20),readyZeroReason,blockerCategories,topBlockers,
  };
}

import { resolveUnderlying } from '@zdj/core';

export type SupplyBlocker = 'SUPPLY'|'CAPITAL'|'CAPACITY'|'RISK'|'MARKET'|'GOVERNANCE'|'AI';

/**
 * Diagnostic-only supply accounting.  It deliberately does not turn resident
 * candidates into dispatch candidates; Phase B owns that scheduling change.
 */
export function buildSupplyHealth(input:{
  universe:any[];
  pool:any[];
  snapshots:Map<string,unknown>;
  positions:Set<string>;
  activeEntries:Set<string>;
  capacity:{used:number;max:number};
  runtimeControl:any;
  aiResources?:any[];
  target:number;
  lowWatermark:number;
}){
  const {universe,pool,snapshots,positions,activeEntries,capacity,runtimeControl,target,lowWatermark}=input;
  const ranked=universe.filter(candidate=>candidate.rank>0);
  const routes=new Map<string,any>((runtimeControl?.capital?.routedCandidates??[]).map((route:any)=>[route.symbol,route]));
  const resident=ranked.filter(candidate=>candidate.residentEligible??candidate.eligible);
  const potentialReady=ranked.filter(candidate=>candidate.eligible&&candidate.pipelineEligible!==false);
  const dispatchReady=potentialReady.filter(candidate=>{const route=routes.get(candidate.symbol);return Boolean(route?.longExecutable||route?.shortExecutable);});
  const poolReady=pool.filter(item=>item.state==='READY');
  const poolWaiting=pool.filter(item=>item.state==='WAITING');
  const poolAnalyzing=pool.filter(item=>item.state==='ANALYZING');
  const occupiedUnderlyings=new Set([...positions,...activeEntries].map(resolveUnderlying));
  const freeResidentUnderlyings=new Set(resident
    .filter(candidate=>!occupiedUnderlyings.has(candidate.underlyingAsset??resolveUnderlying(candidate.symbol)))
    .map(candidate=>candidate.underlyingAsset??resolveUnderlying(candidate.symbol)));
  const stale=ranked.filter(candidate=>candidate.exclusionReasons?.some((reason:string)=>reason.endsWith('_STALE')));
  const governanceBlocked=universe.filter(candidate=>candidate.assetAdmission?.classification==='RESEARCH_ONLY'||candidate.assetAdmission?.classification==='EXCLUDED'||candidate.exclusionReasons?.some((reason:string)=>reason.startsWith('ASSET_')||reason.startsWith('MARKET_QUALITY_')));
  const cooldown=ranked.filter(candidate=>candidate.lifecycle==='REJECT_COOLDOWN'||candidate.lifecycle==='AI_FAILURE_COOLDOWN'||candidate.lifecycle==='TECHNICAL_COOLDOWN'||candidate.exclusionReasons?.includes('REJECT_COOLDOWN'));
  const capitalBlocked=potentialReady.filter(candidate=>!routes.has(candidate.symbol)||!(routes.get(candidate.symbol)?.longExecutable||routes.get(candidate.symbol)?.shortExecutable));
  const riskBlocked=runtimeControl?.reasonCode==='DAILY_RISK_LIMIT'||runtimeControl?.mode==='PAUSED_DAILY_RISK_LIMIT';
  const primary=input.aiResources?.find(resource=>resource.role==='PRIMARY_BRAIN');
  const aiBlocked=primary?.status==='OFFLINE'||primary?.connectionStatus==='OFFLINE';
  const reasonCounts:Record<SupplyBlocker,number>={
    SUPPLY:resident.length===0?1:0,
    CAPITAL:capitalBlocked.length,
    CAPACITY:capacity.used>=capacity.max?1:0,
    RISK:riskBlocked?1:0,
    MARKET:stale.length,
    GOVERNANCE:governanceBlocked.length,
    AI:aiBlocked?1:0,
  };
  const rootBlocker:SupplyBlocker|null=capacity.used>=capacity.max?'CAPACITY'
    :riskBlocked?'RISK'
    :aiBlocked?'AI'
    :dispatchReady.length===0&&capitalBlocked.length?'CAPITAL'
    :dispatchReady.length===0&&stale.length?'MARKET'
    :dispatchReady.length===0&&governanceBlocked.length?'GOVERNANCE'
    :dispatchReady.length===0?'SUPPLY'
    :null;
  return {
    cohort:{status:'NOT_ESTABLISHED' as const,memberCount:null as number|null},
    retention:{status:'NOT_INVENTORIED' as const,zombieSnapshotCount:null as number|null},
    counts:{
      rankedSymbols:ranked.length,
      residentSymbols:resident.length,
      potentialReadySymbols:potentialReady.length,
      dispatchReadySymbols:dispatchReady.length,
      poolReadySymbols:poolReady.length,
      poolWaitingSymbols:poolWaiting.length,
      poolAnalyzingSymbols:poolAnalyzing.length,
      cooldownSymbols:cooldown.length,
      staleSymbols:stale.length,
      governanceBlockedSymbols:governanceBlocked.length,
      occupiedUnderlyings:occupiedUnderlyings.size,
      freeResidentUnderlyings:freeResidentUnderlyings.size,
      snapshotCount:snapshots.size,
      consumedSymbols:null as number|null,
    },
    target,
    lowWatermark,
    rootBlocker,
    reasonCounts,
    // These are intentionally separate: a resident pool entry is not proof of
    // dispatch eligibility, and a dispatch-ready Universe row is not proof it
    // currently occupies a pool slot until Phase B changes scheduling.
    poolCount:pool.length,
    readyCount:poolReady.length,
    qualifiedSupply:resident.length,
    readySupply:dispatchReady.length,
    targetGap:Math.max(0,target-pool.length),
    supplyShortage:resident.length<target,
    refillFailure:resident.length>=target&&pool.length<target,
    belowLowWatermark:poolReady.length<lowWatermark,
  };
}

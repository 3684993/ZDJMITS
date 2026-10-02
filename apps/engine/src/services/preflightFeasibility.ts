import { testnetFundsOnlyEntry } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import { privateAccountFresh } from './privateAccountReadiness.js';
import { computeExecutableRiskHeadroom } from './riskReadiness.js';
import { capitalFactVersion } from './runtimeControlService.js';
import { collectPendingEntryRiskExposures } from './entryRiskOccupancy.js';
import { candidateCapitalFromState } from './capitalCapacity.js';
import { readAdmissionCapacity } from './admissionCapacityReader.js';
import {entryGateDecision} from './entryGateTaxonomy.js';

const ACTIVE_ORDER = new Set(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED']);
const ACTIVE_RESERVATION = new Set(['RESERVED','WORKING']);
type Direction = 'LONG'|'SHORT';

/** Read-only feasibility snapshot immediately before Primary. It never reserves capital or authorizes an order. */
export function evaluatePreflightFeasibility(state:RuntimeState,symbol:string,marketReasons:string[]=[],now=Date.now()){
  const capital:any=state.runtimeControl.capital,route:any=capital.routedCandidates.find((row:any)=>row.symbol===symbol),market:any=state.snapshots.get(symbol),candidate:any=state.universe.find((row:any)=>row.symbol===symbol),capacity=state.entryCapacity();
  const activeReservations=[...state.entryReservations.values()].filter((row:any)=>ACTIVE_RESERVATION.has(row.status)&&Number(row.expiresAt)>now),workingOrders=[...state.entryOrders.values()].filter((row:any)=>ACTIVE_ORDER.has(row.status));
  const storedCapitalVersion=String(capital.capitalVersion??''),currentCapitalVersion=capitalFactVersion(state),legacyInjectedRoute=storedCapitalVersion==='0'&&Number(capital.evaluatedAt??0)===0;
  const capitalVersionCurrent=legacyInjectedRoute||Boolean(storedCapitalVersion&&storedCapitalVersion!=='0'&&storedCapitalVersion===currentCapitalVersion),maxCapitalAge=Math.max(15_000,Number(state.settings.runtimeControl?.capitalCheckIntervalSeconds??30)*1000+5_000),capitalFresh=legacyInjectedRoute||(Number.isFinite(capital.evaluatedAt)&&now-Number(capital.evaluatedAt)>=0&&now-Number(capital.evaluatedAt)<=maxCapitalAge),routeGenerationCurrent=!candidate||legacyInjectedRoute||Number(capital.generation??0)===Number(candidate.selectionGeneration??capital.generation??0),privateReady=privateAccountFresh(state.account,now),governance=Boolean(candidate?.eligible&&candidate?.pipelineEligible!==false&&state.runtimeControl.mode==='RUNNING'&&state.executionGovernance?.mode==='AUTO_RUNNING'&&state.settings.riskGovernance.entrySafetyMode==='AUTO');
  const quoteAsset=String(route?.quoteAsset??'UNKNOWN'),minimumNotionalUsd=Math.max(Number(route?.minExecutableNotionalUsd??0),Number(market?.quote?.minNotional??0));
  // One funding computation for the whole pipeline: the wallet figure, the committed margin and the
  // route's own verified leverage come from the same object the cockpit displays.
  const capital0=candidateCapitalFromState(state,{symbol,quoteAsset,leverage:route?.leverage,leverageFact:Number(route?.leverage)>=1?'CANDIDATE_RECOMMENDED':'UNPROVEN',minimumNotionalUsd,now});
  const {executableMarginUsd:availableMarginUsd,reservedMarginUsd:reservedMargin,leverage}=capital0;
  const equity=Number(state.account.equityUsd??0),expectedAdverseMovePct=Math.max(.001,Number(market?.technical?.['15m']?.atrPercent)/100),dailyDrawdownPct=Number(state.account.riskBaseline?.riskDrawdownPct??0),maxReservations=Number(state.settings.riskGovernance.maxConcurrentReservations??Number.POSITIVE_INFINITY),pendingRiskExposures=collectPendingEntryRiskExposures(state,{now});
  const requested:Direction[]=[];if(route?.longExecutable)requested.push('LONG');if(route?.shortExecutable)requested.push('SHORT');
  const riskHeadroom:Record<Direction,any>={LONG:null,SHORT:null},feasibleNotionalUsd:Record<Direction,number>={LONG:0,SHORT:0},allowedDirections:Direction[]=[];
  for(const side of requested){
    const routeCap=Number(side==='LONG'?(route.longFeasibleNotionalUsd??route.longRecommendedNotionalUsd??0):(route.shortFeasibleNotionalUsd??route.shortRecommendedNotionalUsd??0)),
      recommended=Number(side==='LONG'?(route.longRecommendedNotionalUsd??routeCap):(route.shortRecommendedNotionalUsd??routeCap)),
      plannedNotional=Math.max(0,Math.min(routeCap,recommended>0?recommended:routeCap)),
      risk=computeExecutableRiskHeadroom({settings:state.settings,equity,positions:[...state.positions.values()],pendingRiskExposures,symbol,side,
        // The gate's own ceiling is part of the pre-model answer, so a direction can never be declared
        // feasible here and refused there by a limit this layer never looked at.
        ...readAdmissionCapacity(state,symbol,side,now,{leverage,leverageFact:capital0.leverageFact??'UNPROVEN',quoteAsset}),
        plannedNotional,expectedAdverseMovePct,dailyDrawdownPct,capital:capital0,minimumNotional:minimumNotionalUsd});
    riskHeadroom[side]=risk;
    if(risk.executable){allowedDirections.push(side);feasibleNotionalUsd[side]=risk.finalNotional;}
  }
  let reason='PASS';if(!market)reason='MARKET_DATA_MISSING';else if(marketReasons.length)reason=`MARKET_${marketReasons[0]}`;else if(!governance)reason='GOVERNANCE_OR_PIPELINE_BLOCKED';else if(!privateReady)reason='PRIVATE_NOT_READY';else if(!testnetFundsOnlyEntry(state.settings)&&capacity.used>=capacity.max)reason='POSITION_CAPACITY_FULL';else if(!testnetFundsOnlyEntry(state.settings)&&activeReservations.length>=maxReservations)reason='RESERVATION_CAPACITY_FULL';else if(!storedCapitalVersion)reason='CAPITAL_VERSION_MISSING';else if(!testnetFundsOnlyEntry(state.settings)&&!capitalVersionCurrent)reason='CAPITAL_FACTS_CHANGED';else if(!capitalFresh)reason='CAPITAL_FACTS_STALE';else if(!testnetFundsOnlyEntry(state.settings)&&!routeGenerationCurrent)reason='CAPITAL_ROUTE_GENERATION_STALE';else if(!route)reason='NO_CAPITAL_ROUTE';else if(!testnetFundsOnlyEntry(state.settings)&&equity<=0)reason='NO_EQUITY';else if(quoteAsset==='UNKNOWN'||availableMarginUsd*leverage+1e-8<minimumNotionalUsd)reason='INSUFFICIENT_AVAILABLE_MARGIN';else if(!allowedDirections.length)reason=requested.length?(riskHeadroom[requested[0]]?.reason??'NO_FEASIBLE_DIRECTION'):([route?.riskHeadroom?.LONG?.reason,route?.riskHeadroom?.SHORT?.reason].find(r=>r&&r!=='PASS')??'NO_FEASIBLE_DIRECTION');
  return {symbol,trend15m:market?.technical?.['15m']?.trend??'UNKNOWN',route:route?{longExecutable:route.longExecutable,shortExecutable:route.shortExecutable,longFeasibleNotionalUsd:route.longFeasibleNotionalUsd,shortFeasibleNotionalUsd:route.shortFeasibleNotionalUsd}:null,allowedDirections,feasibleNotionalUsd,minimumExecutableNotionalUsd:minimumNotionalUsd,quoteAsset,availableMarginUsd,reservedMarginUsd:reservedMargin,capitalVersion:storedCapitalVersion,currentCapitalVersion,capitalVersionCurrent,capitalFresh,routeGenerationCurrent,capacity,activeReservations:activeReservations.length,workingOrders:workingOrders.length,pendingRiskExposureCount:pendingRiskExposures.length,pendingRiskNotionalUsd:pendingRiskExposures.reduce((sum,row)=>sum+row.notionalUsd,0),privateReady,governance,riskHeadroom,marketGeneration:state.marketGeneration,createdAt:now,expiresAt:now+Math.min(15_000,maxCapitalAge),pass:reason==='PASS',reason,
    reasonGate:reason==='PASS'?null:entryGateDecision(reason)};
}

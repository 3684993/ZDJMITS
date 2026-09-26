import { resolveQuoteAsset, resolveUnderlying } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import { collectPendingEntryRiskExposures, entryOrderOccupiesRisk } from './entryRiskOccupancy.js';
import { computeExecutableRiskHeadroom } from './riskReadiness.js';
import { activeExecutionLeaseMargin } from './executionLease.js';
import { candidateCapitalFromState, leverageFactOf } from './capitalCapacity.js';
import { classifySideCapacityBinding } from './entryCapacityTrace.js';
import { readAdmissionCapacity } from './admissionCapacityReader.js';
import { privateAccountFresh } from './privateAccountReadiness.js';
import type { HistoricalTpReachabilityEnvelope } from './historicalTpReachability.js';
import { humanManagedExposure } from './economicEntryFeasibility.js';
import { legalTargetHorizonMinutes } from './quantityHorizonCandidates.js';

export type ExecutionEnvelopeSide = 'LONG' | 'SHORT';
export interface SideExecutionCapacity {
  executable: boolean;
  maxMarginUsd: number;
  maxNotionalUsd: number;
  maxQuantityUnits: number;
  /** The whole-step quantity the exchange will not fill under, from that symbol's real filters. Optional
   * because an envelope persisted by an earlier build may not carry it; a fresh one always does. */
  minQuantityUnits?: number;
  /** [floor, ceiling] of a quantity this side could legally be submitted at, or null when it cannot. */
  legalQuantityRangeUnits?: [number, number] | null;
  riskHeadroom: { factVersion:string; remaining:Record<string,number>; blockers:string[]; reason:string };
  /** The one number that limits this side, named from the same classifier the cockpit reads. */
  firstBindingConstraint?: string;
  /** max(exchange minNotional, minQty x reference price), computed from the real filters. */
  minimumLegalNotionalUsd?: number;
  /** The admission ledger's own verdict for this side, carried so the pre-model refusal can state numbers. */
  admission?: {ceilingUsd: number | null; refusal: string | null; gate: string | null; detail: string | null} | null;
  /** [floor, ceiling] of a notional this side could legally be submitted at, or null when it cannot. */
  legalNotionalRangeUsd?: [number, number] | null;
  authorization?: 'EXECUTABLE' | string;
}
export interface PreAiExecutionEnvelope {
  version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE';
  symbol:string;
  underlying:string;
  quoteAsset:string;
  createdAt:number;
  expiresAt:number;
  notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.';
  account:{status:string;equityUsd:number;availableMarginUsd:number;reservedMarginUsd:number;executionLeaseMarginUsd:number;freeMarginUsd:number};
  positionCapacity:{used:number;max:number;slotAvailable:boolean;sameUnderlyingOccupied:boolean};
  leverage:number;
  exchange:{tickSize:number;stepSize:number;minQty:number;minNotional:number};
  makerReachableBand:{min:number;max:number};
  recentTradedPrices:Array<{price:number;lastSeenAt:number}>;
  fees:{makerFeeBps:number;takerFeeBps:number;roundTripCostBps:number;safetyMarginBps:number};
  economics?:{version:'V3.9.5';minNetProfitUsd:number;minNetProfitRoiPct:number;admissionMode:'OFF'|'SHADOW'|'ENFORCE';historicalTpReachabilityEnabled:boolean;minHistoricalReachProbability:number;reachabilityLookbackBars:number;reachabilityMinSamples:number;targetHorizonMinutes:number[];humanManagedExposure:{positions:number;notionalUsd:number;maxPositions:number;maxNotionalUsd:number;withinLimits:boolean}};
  reachability?:HistoricalTpReachabilityEnvelope;
  LONG:SideExecutionCapacity;
  SHORT:SideExecutionCapacity;
  /** Sides a submission could actually be placed on right now; deterministic, never a judgement. */
  executableSides:ExecutionEnvelopeSide[];
  noExecutableSide:boolean;
  /** Stated in words because a nested number is not an instruction: the model must not choose a side it cannot submit. */
  sideAuthorization:Record<ExecutionEnvelopeSide,string>;
  leaseRequiredMarginUsd:number;
}

const roundDownUnits=(quantity:number,step:number)=>step>0?Math.max(0,Math.floor(quantity/step+1e-9)):0;

/**
 * The allocation plan this route's own side was sized with, read back from the capital admission that
 * produced the route. Absent facts (no sample for this symbol yet) mean "no verdict", never a refusal.
 */
function routedSidePlanFacts(state:RuntimeState,symbol:string,side:ExecutionEnvelopeSide){
  const route=(state.runtimeControl?.capital?.routedCandidates??[]).find((row:any)=>String(row?.symbol??'').toUpperCase()===symbol.toUpperCase());
  return (side==='LONG'?route?.longPlanFacts:route?.shortPlanFacts)??null;
}

/** Objective execution capacity computed before Primary. It contains no market-direction recommendation. */
export function buildPreAiExecutionEnvelope(state:RuntimeState,symbol:string,now=Date.now(),reachability?:HistoricalTpReachabilityEnvelope):PreAiExecutionEnvelope {
  const market=state.snapshots.get(symbol);if(!market)throw new Error(`PRE_AI_ENVELOPE_MARKET_MISSING:${symbol}`);
  const q=market.quote,quoteAsset=resolveQuoteAsset(symbol),underlying=resolveUnderlying(symbol),candidate:any=state.universe.find((row:any)=>row.symbol===symbol),p=state.settings.portfolioIntelligence;
  const equityUsd=Number(state.account.equityUsd??0),availableBalance=Number(state.account.assets.find((asset:any)=>asset.asset===quoteAsset)?.availableBalance??0);
  const activeReservations=[...state.entryReservations.values()].filter((row:any)=>['RESERVED','WORKING'].includes(row.status)&&Number(row.expiresAt)>now&&row.quoteAsset===quoteAsset);
  const leverage0=Math.min(Number(p.globalMaxLeverage??1),Number(candidate?.recommendedLeverage??p.globalMaxLeverage??1)),capital=candidateCapitalFromState(state,{symbol,quoteAsset,leverage:leverage0,leverageFact:leverageFactOf(leverage0),minimumNotionalUsd:Math.max(Number(q.minNotional??0),Number(q.minQty??0)*Number(q.last??0)),now});
  const {reservedMarginUsd,executionLeaseMarginUsd,executableMarginUsd:freeMarginUsd}=capital;
  const privateReady=privateAccountFresh(state.account,now),capacity=state.entryCapacity(),sameUnderlyingOccupied=[...state.positions.values()].some(row=>resolveUnderlying(row.symbol)===underlying)||[...state.entryOrders.values()].some(row=>resolveUnderlying(row.symbol)===underlying&&entryOrderOccupiesRisk(row,now))||[...state.entryReservations.values()].some((row:any)=>row.underlying===underlying&&['RESERVED','WORKING'].includes(row.status)&&Number(row.expiresAt)>now);
  const slotAvailable=capacity.used<state.settings.portfolio.maxPositions&&!sameUnderlyingOccupied;
  const leverage=Math.max(1,leverage0);
  const minimumNotional=Math.max(Number(q.minNotional??0),Number(q.minQty??0)*Number(q.last??0)),quoteNotionalCapacity=capital.executableNotionalUsd;
  const pendingRiskExposures=collectPendingEntryRiskExposures(state,{now}),expectedAdverseMovePct=Math.max(.001,Number(market.technical['15m'].atrPercent??0)/100),dailyDrawdownPct=Number(state.account.riskBaseline?.riskDrawdownPct??0),human=humanManagedExposure(state),humanHardBlock=state.settings.tradeEconomics.admissionMode==='ENFORCE'&&state.settings.positionManagement.humanManagedAdmissionCapsEnabled&&!human.withinLimits;
  const atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;
  // Problem B: a symbol the committed margin-tier authority does not cover has no verified maintenance
  // bracket, so no capacity claim for it is proven. Absence of the mirror (no committed authority at all)
  // is deliberately not a refusal — the fleet-level profile gate owns that case, and one uncovered symbol
  // must never suppress healthy candidates.
  const coverage=state.marginTierCoverage as {symbols?:string[]}|null;
  const marginTierProven=Array.isArray(coverage?.symbols)?coverage!.symbols!.includes(String(symbol).trim().toUpperCase()):true;
  const sideCapacity=(side:ExecutionEnvelopeSide):SideExecutionCapacity=>{
    // Sizing has already refused some sides for a bounded capacity. That verdict is a pre-AI fact: the
    // envelope must not present a side as selectable when the layer that produces the order size said no.
    const planFacts=routedSidePlanFacts(state,symbol,side),planRejects=String(planFacts?.admission??'').startsWith('REJECT_');
    // The gate this candidate will actually be judged by, read before the model is asked: a side that no
    // positive notional can pass is not offered to the model as an executable choice.
    const admission=readAdmissionCapacity(state,symbol,side,now);
    const risk=computeExecutableRiskHeadroom({settings:state.settings,equity:equityUsd,positions:[...state.positions.values()],pendingRiskExposures,symbol,side,...admission,plannedNotional:Number.MAX_SAFE_INTEGER,expectedAdverseMovePct,dailyDrawdownPct,capital,minimumNotional});
    const filtersComplete=[q.tickSize,q.stepSize,q.minQty,q.minNotional,q.last].every((value:number)=>Number.isFinite(Number(value))&&Number(value)>0);
    const minimumLegalNotionalUsd=filtersComplete?Math.max(Number(q.minNotional),Number(q.minQty)*Number(q.last)):0;
    const maxNotionalUsd=slotAvailable&&risk.executable&&!planRejects?Math.max(0,Math.min(quoteNotionalCapacity,risk.finalNotional)):0,maxMarginUsd=maxNotionalUsd/Math.max(1,leverage);
    // A whole-step quantity that is affordable at the reachable price band and still clears the exchange
    // floor. Both bounds are published: a lower one the order cannot legally be placed under, and an upper
    // one the authorized capacity cannot cover. Neither is a suggestion — both come from real filters.
    const bandCeilingPrice=Math.max(bandMax,q.ask,q.last,q.tickSize),
      capacityUnits=roundDownUnits(maxNotionalUsd/Math.max(q.last,q.tickSize),q.stepSize),
      bandLimitedUnits=roundDownUnits(maxNotionalUsd/bandCeilingPrice,q.stepSize),
      legalMaxQuantityUnits=Math.min(capacityUnits,bandLimitedUnits),
      minQuantityUnits=filtersComplete?Math.max(1,Math.ceil(Number(q.minQty)/Number(q.stepSize)-1e-9),Math.ceil(minimumLegalNotionalUsd/(Math.max(q.last,q.tickSize)*Number(q.stepSize))-1e-9)):0;
    const executable=marginTierProven&&privateReady&&slotAvailable&&!humanHardBlock&&!planRejects&&maxNotionalUsd+1e-8>=minimumNotional&&legalMaxQuantityUnits>=minQuantityUnits;
    const blockers=[...risk.blockers,...(planRejects?[`SIDE_PLAN_${planFacts.admission}`]:[]),...(humanHardBlock?['HUMAN_MANAGED_EXPOSURE_LIMIT']:[]),...(marginTierProven?[]:[`MARGIN_TIER_SYMBOL_UNPROVEN:${symbol}`])];
    const binding=classifySideCapacityBinding({symbol,side,executable,blockers,
      // The probe asked "how much room is there", so its own constraint name is not a denial. When the gate
      // raised no blocker but sizing already refused this side, the refusal is the nearer cause.
      firstBindingConstraint:planRejects&&!risk.blockers?.length?null:risk.firstBindingConstraint??null,
      plannedNotionalUsd:Number(risk.plannedNotional??0),finalNotionalUsd:maxNotionalUsd,minimumLegalNotionalUsd:filtersComplete?minimumLegalNotionalUsd:null,exchangeFiltersComplete:filtersComplete,
      planPresent:true,routePresent:true,marginTierProven,portfolioRiskAllowed:!admission.riskAdmissionRefusal&&!risk.blockers.includes('REJECT_RISK_ADMISSION_CEILING'),capitalBindingConstraint:capital?.bindingConstraint??null,capitalExecutableNotionalUsd:capital?.executableNotionalUsd??null,
      planAdmission:planFacts?.admission??null,capacityRoom:planFacts?.capacityRoom??null,
      // The admission ledger's own words, so the envelope refuses with the number that binds.
      riskAdmission:{ceilingUsd:admission.riskAdmissionCeilingUsd,refusal:admission.riskAdmissionRefusal,
        gate:admission.capacity?.firstBinding?.gate??null,detail:admission.capacity?.firstBinding?.detail??null}});
    return {executable,maxMarginUsd,maxNotionalUsd,maxQuantityUnits:legalMaxQuantityUnits,minQuantityUnits,
      legalQuantityRangeUnits:executable?[minQuantityUnits,legalMaxQuantityUnits]:null,
      firstBindingConstraint:binding.constraint,minimumLegalNotionalUsd,
      admission:{ceilingUsd:admission.riskAdmissionCeilingUsd,refusal:admission.riskAdmissionRefusal,
        gate:admission.capacity?.firstBinding?.gate??null,detail:admission.capacity?.firstBinding?.detail??null},
      legalNotionalRangeUsd:executable?[minimumLegalNotionalUsd,Math.min(maxNotionalUsd,legalMaxQuantityUnits*Number(q.stepSize)*bandCeilingPrice)]:null,
      authorization:executable?'EXECUTABLE':`NOT_EXECUTABLE:${binding.constraint}`,
      riskHeadroom:{factVersion:risk.factVersion,remaining:risk.remaining,blockers,reason:humanHardBlock?'HUMAN_MANAGED_EXPOSURE_LIMIT':risk.reason}};
  };
  const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),
    executableSides=([['LONG',LONG],['SHORT',SHORT]] as const).filter(([,capacity])=>capacity.executable).map(([side])=>side),
    sideAuthorization={LONG:LONG.authorization??'NOT_EXECUTABLE:UNCLASSIFIED',SHORT:SHORT.authorization??'NOT_EXECUTABLE:UNCLASSIFIED'} as Record<ExecutionEnvelopeSide,string>;
  const makerFeeBps=state.settings.takeProfit.makerFeeRate*10_000,takerFeeBps=state.settings.takeProfit.takerFeeRate*10_000,safetyMarginBps=(makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps))*state.settings.takeProfit.feeSafetyBufferPct/100;
  const economics={version:'V3.9.5' as const,minNetProfitUsd:state.settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:state.settings.takeProfit.minNetProfitRoiPct,admissionMode:state.settings.tradeEconomics.admissionMode,historicalTpReachabilityEnabled:state.settings.tradeEconomics.historicalTpReachabilityEnabled,minHistoricalReachProbability:state.settings.tradeEconomics.minHistoricalReachProbability,reachabilityLookbackBars:state.settings.tradeEconomics.reachabilityLookbackBars,reachabilityMinSamples:state.settings.tradeEconomics.reachabilityMinSamples,targetHorizonMinutes:legalTargetHorizonMinutes(state.settings),humanManagedExposure:{positions:human.positions,notionalUsd:human.notionalUsd,maxPositions:human.maxPositions,maxNotionalUsd:human.maxNotionalUsd,withinLimits:human.withinLimits}};
  return {version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',symbol,underlying,quoteAsset,executableSides,noExecutableSide:executableSides.length===0,sideAuthorization,createdAt:now,expiresAt:now+Math.max(45_000,Number(state.settings.ai.decisionTimeoutMs??30_000)+15_000),notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.',account:{status:String(state.account.status),equityUsd,availableMarginUsd:availableBalance,reservedMarginUsd,executionLeaseMarginUsd,freeMarginUsd},positionCapacity:{used:capacity.used,max:state.settings.portfolio.maxPositions,slotAvailable,sameUnderlyingOccupied},leverage,exchange:{tickSize:q.tickSize,stepSize:q.stepSize,minQty:q.minQty,minNotional:q.minNotional},makerReachableBand:{min:bandMin,max:bandMax},recentTradedPrices:market.recentTradedPrices??[],fees:{makerFeeBps,takerFeeBps,roundTripCostBps:makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps),safetyMarginBps},economics,...(reachability?{reachability}:{}),LONG,SHORT,leaseRequiredMarginUsd:Math.max(LONG.maxMarginUsd,SHORT.maxMarginUsd)};
}

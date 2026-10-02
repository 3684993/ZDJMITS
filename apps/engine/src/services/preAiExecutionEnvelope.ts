import { testnetFundsOnlyEntry } from '@zdj/core';
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
  minimumInitialMarginQuote?: number | null;
  minimumOrderNotionalQuote?: number | null;
  businessMinimumConfigured?: boolean;
  /** The admission ledger's own verdict for this side, carried so the pre-model refusal can state numbers. */
  admission?: {ceilingUsd: number | null; refusal: string | null; gate: string | null; detail: string | null} | null;
  /** [floor, ceiling] of a notional this side could legally be submitted at, or null when it cannot. */
  legalNotionalRangeUsd?: [number, number] | null;
  authorization?: 'EXECUTABLE' | string;
}
export interface PreAiExecutionEnvelope {
  version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE';
  resourcePolicy?:'TESTNET_FUNDS_ONLY'|'LEGACY_RISK_ENFORCED';
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
  /** P4: what the earmark asked for, what capped it and to what, so a lease is never read as a debit. */
  leaseBudget?:{requestedUsd:number;cappedBy:LeaseBudgetSource;budgetUsd:number};
}

export type LeaseBudgetSource='ROUTED_PLAN_MARGIN'|'CONFIGURED_PER_POSITION_MARGIN'|'EXCHANGE_MINIMUM_MARGIN';

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
  const slotAvailable=testnetFundsOnlyEntry(state.settings)||(capacity.used<state.settings.portfolio.maxPositions&&!sameUnderlyingOccupied);
  const leverage=Math.max(1,leverage0);
  const minimumNotional=Math.max(Number(q.minNotional??0),Number(q.minQty??0)*Number(q.last??0)),quoteNotionalCapacity=capital.executableNotionalUsd;
  const pendingRiskExposures=collectPendingEntryRiskExposures(state,{now}),expectedAdverseMovePct=Math.max(.001,Number(market.technical['15m'].atrPercent??0)/100),dailyDrawdownPct=Number(state.account.riskBaseline?.riskDrawdownPct??0),human=humanManagedExposure(state),humanHardBlock=!testnetFundsOnlyEntry(state.settings)&&state.settings.tradeEconomics.admissionMode==='ENFORCE'&&state.settings.positionManagement.humanManagedAdmissionCapsEnabled&&!human.withinLimits;
  const atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;
  // Problem B: a symbol the committed margin-tier authority does not cover has no verified maintenance
  // bracket, so no capacity claim for it is proven. Absence of the mirror (no committed authority at all)
  // is deliberately not a refusal — the fleet-level profile gate owns that case, and one uncovered symbol
  // must never suppress healthy candidates.
  const coverage=state.marginTierCoverage as {symbols?:string[]}|null;
  const marginTierProven=testnetFundsOnlyEntry(state.settings)||(Array.isArray(coverage?.symbols)?coverage!.symbols!.includes(String(symbol).trim().toUpperCase()):true);
  const sideCapacity=(side:ExecutionEnvelopeSide):SideExecutionCapacity=>{
    // Sizing has already refused some sides for a bounded capacity. That verdict is a pre-AI fact: the
    // envelope must not present a side as selectable when the layer that produces the order size said no.
    const planFacts=routedSidePlanFacts(state,symbol,side),planRejects=String(planFacts?.admission??'').startsWith('REJECT_');
    // The gate this candidate will actually be judged by, read before the model is asked: a side that no
    // positive notional can pass is not offered to the model as an executable choice.
    const admission=readAdmissionCapacity(state,symbol,side,now,{leverage,leverageFact:capital?.leverageFact??'UNPROVEN',quoteAsset});
    const risk=computeExecutableRiskHeadroom({settings:state.settings,equity:equityUsd,positions:[...state.positions.values()],pendingRiskExposures,symbol,side,...admission,plannedNotional:Number.MAX_SAFE_INTEGER,expectedAdverseMovePct,dailyDrawdownPct,capital,minimumNotional});
    const filtersComplete=[q.tickSize,q.stepSize,q.minQty,q.minNotional,q.last].every((value:number)=>Number.isFinite(Number(value))&&Number(value)>0);
    const minimumLegalNotionalUsd=filtersComplete?Math.max(Number(q.minNotional),Number(q.minQty)*Number(q.last)):0;
    const configuredMargin=state.settings.entry.minimumInitialMarginByQuote?.[quoteAsset];
    const configuredOrderNotional=state.settings.entry.minimumOrderNotionalByQuote?.[quoteAsset];
    const minimumInitialMarginQuote=Number.isFinite(Number(configuredMargin))&&Number(configuredMargin)>0?Number(configuredMargin):null;
    const symbolKey=String(symbol).toUpperCase(),configuredOrderFloor=Number.isFinite(Number(configuredOrderNotional))&&Number(configuredOrderNotional)>0?Number(configuredOrderNotional):0;
    // A legal exchange minimum is never the business sizing authority. Every supported quote pair
    // needs at least 100 quote units; BTCUSDT/BTCUSDC require 200, even if Settings is lower.
    const minimumOrderNotionalQuote=Math.max(configuredOrderFloor,symbolKey==='BTCUSDT'||symbolKey==='BTCUSDC'?200:100);
    const fundsOnly=testnetFundsOnlyEntry(state.settings);
    const businessMinimumConfigured=minimumInitialMarginQuote!==null&&minimumOrderNotionalQuote>=100;
    const businessMinimumNotional=Math.max(minimumLegalNotionalUsd,minimumOrderNotionalQuote,(minimumInitialMarginQuote??0)*leverage);
    const maxNotionalUsd=slotAvailable&&risk.executable&&!planRejects?Math.max(0,Math.min(quoteNotionalCapacity,risk.finalNotional)):0,maxMarginUsd=maxNotionalUsd/Math.max(1,leverage);
    // A whole-step quantity that is affordable at the reachable price band and still clears the exchange
    // floor. Both bounds are published: a lower one the order cannot legally be placed under, and an upper
    // one the authorized capacity cannot cover. Neither is a suggestion — both come from real filters.
    const bandCeilingPrice=Math.max(bandMax,q.ask,q.last,q.tickSize),
      capacityUnits=roundDownUnits(maxNotionalUsd/Math.max(q.last,q.tickSize),q.stepSize),
      bandLimitedUnits=roundDownUnits(maxNotionalUsd/bandCeilingPrice,q.stepSize),
      legalMaxQuantityUnits=Math.min(capacityUnits,bandLimitedUnits),
      minQuantityUnits=filtersComplete?Math.max(1,Math.ceil(Number(q.minQty)/Number(q.stepSize)-1e-9),Math.ceil(businessMinimumNotional/(bandCeilingPrice*Number(q.stepSize))-1e-9)):0;
    const executable=businessMinimumConfigured&&marginTierProven&&privateReady&&slotAvailable&&!humanHardBlock&&!planRejects&&maxNotionalUsd+1e-8>=Math.max(minimumNotional,businessMinimumNotional)&&legalMaxQuantityUnits>=minQuantityUnits;
    const blockers=[...risk.blockers,...(planRejects?[`SIDE_PLAN_${planFacts.admission}`]:[]),...(humanHardBlock?['HUMAN_MANAGED_EXPOSURE_LIMIT']:[]),...(marginTierProven?[]:[`MARGIN_TIER_SYMBOL_UNPROVEN:${symbol}`]),...(!businessMinimumConfigured?['BUSINESS_MINIMUM_INITIAL_MARGIN_UNCONFIGURED']:[]),...(fundsOnly&&businessMinimumConfigured&&maxNotionalUsd+1e-8<businessMinimumNotional?['BUSINESS_MINIMUM_EXCEEDS_AVAILABLE_FUNDS']:[])];
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
    const firstBindingConstraint=fundsOnly?(!businessMinimumConfigured?'BUSINESS_MINIMUM_INITIAL_MARGIN_UNCONFIGURED':planRejects&&!risk.blockers?.length?binding.constraint:businessMinimumNotional>maxNotionalUsd?'BUSINESS_MINIMUM_EXCEEDS_AVAILABLE_FUNDS':binding.constraint):binding.constraint;
    return {executable,maxMarginUsd,maxNotionalUsd,maxQuantityUnits:legalMaxQuantityUnits,minQuantityUnits,
      legalQuantityRangeUnits:executable?[minQuantityUnits,legalMaxQuantityUnits]:null,
      firstBindingConstraint,minimumLegalNotionalUsd,
      minimumInitialMarginQuote,minimumOrderNotionalQuote,businessMinimumConfigured,
      admission:{ceilingUsd:admission.riskAdmissionCeilingUsd,refusal:admission.riskAdmissionRefusal,
        gate:admission.capacity?.firstBinding?.gate??null,detail:admission.capacity?.firstBinding?.detail??null},
      legalNotionalRangeUsd:executable?[businessMinimumNotional,Math.min(maxNotionalUsd,legalMaxQuantityUnits*Number(q.stepSize)*bandCeilingPrice)]:null,
      authorization:executable?'EXECUTABLE':`NOT_EXECUTABLE:${firstBindingConstraint}`,
      riskHeadroom:{factVersion:risk.factVersion,remaining:risk.remaining,blockers,reason:humanHardBlock?'HUMAN_MANAGED_EXPOSURE_LIMIT':risk.reason}};
  };
  const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),
    executableSides=([['LONG',LONG],['SHORT',SHORT]] as const).filter(([,capacity])=>capacity.executable).map(([side])=>side),
    sideAuthorization={LONG:LONG.authorization??'NOT_EXECUTABLE:UNCLASSIFIED',SHORT:SHORT.authorization??'NOT_EXECUTABLE:UNCLASSIFIED'} as Record<ExecutionEnvelopeSide,string>;
  const makerFeeBps=state.settings.takeProfit.makerFeeRate*10_000,takerFeeBps=state.settings.takeProfit.takerFeeRate*10_000,safetyMarginBps=(makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps))*state.settings.takeProfit.feeSafetyBufferPct/100;
  const economics={version:'V3.9.5' as const,minNetProfitUsd:state.settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:state.settings.takeProfit.minNetProfitRoiPct,admissionMode:state.settings.tradeEconomics.admissionMode,historicalTpReachabilityEnabled:state.settings.tradeEconomics.historicalTpReachabilityEnabled,minHistoricalReachProbability:state.settings.tradeEconomics.minHistoricalReachProbability,reachabilityLookbackBars:state.settings.tradeEconomics.reachabilityLookbackBars,reachabilityMinSamples:state.settings.tradeEconomics.reachabilityMinSamples,targetHorizonMinutes:legalTargetHorizonMinutes(state.settings),humanManagedExposure:{positions:human.positions,notionalUsd:human.notionalUsd,maxPositions:human.maxPositions,maxNotionalUsd:human.maxNotionalUsd,withinLimits:human.withinLimits},businessMinimumPolicyVersion:'V397-ENTRY-FLOOR-1' as const,minimumInitialMarginQuote:LONG.minimumInitialMarginQuote??SHORT.minimumInitialMarginQuote??null,minimumOrderNotionalQuote:LONG.minimumOrderNotionalQuote??SHORT.minimumOrderNotionalQuote??null};
  // P4/R9: an analysis lease is a pre-model earmark, not a debit of the account. It used to be
  // max(LONG.maxMarginUsd, SHORT.maxMarginUsd), and because the probe sized the side with
  // plannedNotional=MAX_SAFE_INTEGER that number was essentially the whole quote balance - which made
  // every other route on the same asset read zero capacity while one candidate was being analysed.
  // The lease is now bounded by the candidate's own budget: enough margin that the largest *legal*
  // order this symbol could be sized at still fits after the earmark.
  const marginBudget=entryCandidateMarginBudgetUsd(state,symbol,{leverage,minimumLegalNotionalUsd:Math.max(LONG.minimumLegalNotionalUsd??0,SHORT.minimumLegalNotionalUsd??0)});
  const leaseRequiredMarginUsd=Math.min(Math.max(LONG.maxMarginUsd,SHORT.maxMarginUsd),marginBudget.budgetUsd);
  return {version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',resourcePolicy:testnetFundsOnlyEntry(state.settings)?'TESTNET_FUNDS_ONLY':'LEGACY_RISK_ENFORCED',symbol,underlying,quoteAsset,executableSides,noExecutableSide:executableSides.length===0,sideAuthorization,createdAt:now,expiresAt:now+Math.max(45_000,Number(state.settings.ai.decisionTimeoutMs??30_000)+15_000),notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.',account:{status:String(state.account.status),equityUsd,availableMarginUsd:availableBalance,reservedMarginUsd,executionLeaseMarginUsd,freeMarginUsd},positionCapacity:{used:capacity.used,max:state.settings.portfolio.maxPositions,slotAvailable,sameUnderlyingOccupied},leverage,exchange:{tickSize:q.tickSize,stepSize:q.stepSize,minQty:q.minQty,minNotional:q.minNotional},makerReachableBand:{min:bandMin,max:bandMax},recentTradedPrices:market.recentTradedPrices??[],fees:{makerFeeBps,takerFeeBps,roundTripCostBps:makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps),safetyMarginBps},economics,...(reachability?{reachability}:{}),LONG,SHORT,leaseRequiredMarginUsd,leaseBudget:{requestedUsd:Math.max(LONG.maxMarginUsd,SHORT.maxMarginUsd),cappedBy:marginBudget.source,budgetUsd:marginBudget.budgetUsd}};
}

/**
 * The margin one Entry on this symbol may be sized at. The routed plan's own margin wins when it
 * exists, because that is the allocation this candidate was actually given; otherwise the published
 * per-position cap applies. A symbol whose budget falls under the exchange minimum still gets the
 * minimum, so an earmark is never rounded down into an artificial denial.
 */
export function entryCandidateMarginBudgetUsd(state:RuntimeState,symbol:string,input:{leverage:number;minimumLegalNotionalUsd:number}):{budgetUsd:number;source:LeaseBudgetSource}{
  const p=state.settings.portfolioIntelligence??{},portfolio=state.settings.portfolio??{};
  const route=(state.runtimeControl?.capital?.routedCandidates??[]).find((row:any)=>String(row?.symbol??'').toUpperCase()===String(symbol).toUpperCase());
  const planned=Math.max(Number(route?.longPlanFacts?.marginUsd??0),Number(route?.shortPlanFacts?.marginUsd??0),Number(route?.marginUsd??0));
  const configured=Math.max(0,Number(p.maxMarginPerPositionUsd??0),Number(portfolio.entryMarginUsd??0));
  const floor=input.minimumLegalNotionalUsd/Math.max(1,input.leverage);
  const source:LeaseBudgetSource=planned>0?'ROUTED_PLAN_MARGIN':configured>0?'CONFIGURED_PER_POSITION_MARGIN':'EXCHANGE_MINIMUM_MARGIN';
  const budget=planned>0?planned:configured>0?configured:floor;
  return{budgetUsd:Math.max(budget,floor),source};
}

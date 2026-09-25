import { resolveQuoteAsset, resolveUnderlying } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import { collectPendingEntryRiskExposures, entryOrderOccupiesRisk } from './entryRiskOccupancy.js';
import { computeExecutableRiskHeadroom } from './riskReadiness.js';
import { activeExecutionLeaseMargin } from './executionLease.js';
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
  riskHeadroom: { factVersion:string; remaining:Record<string,number>; blockers:string[]; reason:string };
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
  leaseRequiredMarginUsd:number;
}

const roundDownUnits=(quantity:number,step:number)=>step>0?Math.max(0,Math.floor(quantity/step+1e-9)):0;

/** Objective execution capacity computed before Primary. It contains no market-direction recommendation. */
export function buildPreAiExecutionEnvelope(state:RuntimeState,symbol:string,now=Date.now(),reachability?:HistoricalTpReachabilityEnvelope):PreAiExecutionEnvelope {
  const market=state.snapshots.get(symbol);if(!market)throw new Error(`PRE_AI_ENVELOPE_MARKET_MISSING:${symbol}`);
  const q=market.quote,quoteAsset=resolveQuoteAsset(symbol),underlying=resolveUnderlying(symbol),candidate:any=state.universe.find((row:any)=>row.symbol===symbol),p=state.settings.portfolioIntelligence;
  const equityUsd=Number(state.account.equityUsd??0),availableBalance=Number(state.account.assets.find((asset:any)=>asset.asset===quoteAsset)?.availableBalance??0);
  const activeReservations=[...state.entryReservations.values()].filter((row:any)=>['RESERVED','WORKING'].includes(row.status)&&Number(row.expiresAt)>now&&row.quoteAsset===quoteAsset);
  const reservedMarginUsd=activeReservations.reduce((sum:number,row:any)=>sum+Math.max(0,Number(row.marginUsd??0)),0),executionLeaseMarginUsd=activeExecutionLeaseMargin(state,quoteAsset,now),freeMarginUsd=Math.max(0,availableBalance-reservedMarginUsd-executionLeaseMarginUsd);
  const privateReady=privateAccountFresh(state.account,now),capacity=state.entryCapacity(),sameUnderlyingOccupied=[...state.positions.values()].some(row=>resolveUnderlying(row.symbol)===underlying)||[...state.entryOrders.values()].some(row=>resolveUnderlying(row.symbol)===underlying&&entryOrderOccupiesRisk(row,now))||[...state.entryReservations.values()].some((row:any)=>row.underlying===underlying&&['RESERVED','WORKING'].includes(row.status)&&Number(row.expiresAt)>now);
  const slotAvailable=capacity.used<state.settings.portfolio.maxPositions&&!sameUnderlyingOccupied;
  const leverage=Math.max(1,Math.min(Number(p.globalMaxLeverage??1),Number(candidate?.recommendedLeverage??p.globalMaxLeverage??1)));
  const minimumNotional=Math.max(Number(q.minNotional??0),Number(q.minQty??0)*Number(q.last??0)),maxMarginByPolicy=Math.max(0,Math.min(freeMarginUsd,Number(p.maxMarginPerPositionUsd??freeMarginUsd),equityUsd*Math.max(0,Number(p.maxEquityPct??1)))),quoteNotionalCapacity=maxMarginByPolicy*leverage;
  const pendingRiskExposures=collectPendingEntryRiskExposures(state,{now}),expectedAdverseMovePct=Math.max(.001,Number(market.technical['15m'].atrPercent??0)/100),dailyDrawdownPct=Number(state.account.riskBaseline?.riskDrawdownPct??0),human=humanManagedExposure(state),humanHardBlock=state.settings.tradeEconomics.admissionMode==='ENFORCE'&&state.settings.positionManagement.humanManagedAdmissionCapsEnabled&&!human.withinLimits;
  const sideCapacity=(side:ExecutionEnvelopeSide):SideExecutionCapacity=>{
    const risk=computeExecutableRiskHeadroom({settings:state.settings,equity:equityUsd,positions:[...state.positions.values()],pendingRiskExposures,symbol,side,plannedNotional:Number.MAX_SAFE_INTEGER,expectedAdverseMovePct,dailyDrawdownPct,quoteNotionalCapacity:quoteNotionalCapacity*.995,minimumNotional});
    const maxNotionalUsd=slotAvailable&&risk.executable?Math.max(0,Math.min(quoteNotionalCapacity,risk.finalNotional)):0,maxMarginUsd=maxNotionalUsd/Math.max(1,leverage),maxQuantityUnits=roundDownUnits(maxNotionalUsd/Math.max(q.last,q.tickSize),q.stepSize),minUnits=Math.max(1,Math.ceil(q.minQty/q.stepSize-1e-9));
    return {executable:privateReady&&slotAvailable&&!humanHardBlock&&maxNotionalUsd+1e-8>=minimumNotional&&maxQuantityUnits>=minUnits,maxMarginUsd,maxNotionalUsd,maxQuantityUnits,riskHeadroom:{factVersion:risk.factVersion,remaining:risk.remaining,blockers:[...risk.blockers,...(humanHardBlock?['HUMAN_MANAGED_EXPOSURE_LIMIT']:[])],reason:humanHardBlock?'HUMAN_MANAGED_EXPOSURE_LIMIT':risk.reason}};
  };
  const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),atr1=Math.max(Number(market.technical['1m'].atr14??0),q.tickSize),bandMin=Math.max(q.tickSize,q.last-atr1*.8),bandMax=q.last+atr1*.8;
  for(const side of [LONG,SHORT])side.maxQuantityUnits=Math.min(side.maxQuantityUnits,roundDownUnits(side.maxNotionalUsd/Math.max(bandMax,q.ask,q.last),q.stepSize));
  const makerFeeBps=state.settings.takeProfit.makerFeeRate*10_000,takerFeeBps=state.settings.takeProfit.takerFeeRate*10_000,safetyMarginBps=(makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps))*state.settings.takeProfit.feeSafetyBufferPct/100;
  const economics={version:'V3.9.5' as const,minNetProfitUsd:state.settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:state.settings.takeProfit.minNetProfitRoiPct,admissionMode:state.settings.tradeEconomics.admissionMode,historicalTpReachabilityEnabled:state.settings.tradeEconomics.historicalTpReachabilityEnabled,minHistoricalReachProbability:state.settings.tradeEconomics.minHistoricalReachProbability,reachabilityLookbackBars:state.settings.tradeEconomics.reachabilityLookbackBars,reachabilityMinSamples:state.settings.tradeEconomics.reachabilityMinSamples,targetHorizonMinutes:legalTargetHorizonMinutes(state.settings),humanManagedExposure:{positions:human.positions,notionalUsd:human.notionalUsd,maxPositions:human.maxPositions,maxNotionalUsd:human.maxNotionalUsd,withinLimits:human.withinLimits}};
  return {version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',symbol,underlying,quoteAsset,createdAt:now,expiresAt:now+Math.max(45_000,Number(state.settings.ai.decisionTimeoutMs??30_000)+15_000),notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.',account:{status:String(state.account.status),equityUsd,availableMarginUsd:availableBalance,reservedMarginUsd,executionLeaseMarginUsd,freeMarginUsd},positionCapacity:{used:capacity.used,max:state.settings.portfolio.maxPositions,slotAvailable,sameUnderlyingOccupied},leverage,exchange:{tickSize:q.tickSize,stepSize:q.stepSize,minQty:q.minQty,minNotional:q.minNotional},makerReachableBand:{min:bandMin,max:bandMax},recentTradedPrices:market.recentTradedPrices??[],fees:{makerFeeBps,takerFeeBps,roundTripCostBps:makerFeeBps+(state.settings.takeProfit.exitFeeAssumption==='TAKER'?takerFeeBps:makerFeeBps),safetyMarginBps},economics,...(reachability?{reachability}:{}),LONG,SHORT,leaseRequiredMarginUsd:Math.max(LONG.maxMarginUsd,SHORT.maxMarginUsd)};
}

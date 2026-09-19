import { estimateTradingCost } from '@zdj/core';
import type { BrainDecision, EntryExecutionEnvelope, Side } from '@zdj/contracts';
type ProfitTakePlan=BrainDecision['profitTakePlan'];
import type { RuntimeState } from '../state/runtimeState.js';
import type { MarketDataHub } from './marketDataHub.js';
import { evaluateTargetReachability, reachabilityTimeframe } from './historicalTpReachability.js';

export interface EconomicAdmissionResult {
  version:'V3.9.5';
  mode:'OFF'|'SHADOW'|'ENFORCE';
  passed:boolean;
  validatedAt:number;
  expectedNetProfit:number;
  requiredNetProfit:number;
  reachProbability:number|null;
  historicalHardMaxMovePercent:number|null;
  targetMovePercent:number;
  notionalUsd:number;
  blockers:string[];
}
export function humanManagedExposure(state:RuntimeState){
  const equity=Math.max(0,Number(state.account.equityUsd??0)),rows=[...state.positions.values()].filter((p:any)=>p.managementStatus==='HUMAN_MANAGED'),
    notionalUsd=rows.reduce((n:number,p:any)=>n+Math.abs(Number(p.quantity??0)*Number(p.markPrice??p.entryPrice??0)),0),
    maxPositions=state.settings.positionManagement.maxHumanManagedPositions,
    maxNotionalUsd=equity*state.settings.positionManagement.maxHumanManagedNotionalPctEquity,
    enabled=state.settings.positionManagement.humanManagedAdmissionCapsEnabled,
    withinLimits=!enabled||(rows.length<maxPositions&&notionalUsd<maxNotionalUsd-1e-8);
  return{positions:rows.length,notionalUsd,maxPositions,maxNotionalUsd,withinLimits,enabled};
}

export function evaluateEconomicEntryFeasibility(input:{
  state:RuntimeState;
  market?:MarketDataHub;
  symbol:string;
  side:Side;
  quantityUnits:number;
  acceptablePriceRange:{min:number;max:number};
  profitTakePlan:ProfitTakePlan|null|undefined;
  envelope:EntryExecutionEnvelope|any;
  actualEntryPrice?:number;
  now?:number;
}):EconomicAdmissionResult{
  const {state}=input,settings=state.settings,mode=settings.tradeEconomics.admissionMode,now=input.now??Date.now(),snapshot=state.snapshots.get(input.symbol);
  const blockers:string[]=[];
  if(mode==='OFF'||!snapshot||!input.profitTakePlan){
    if(!snapshot)blockers.push('ECONOMIC_MARKET_FACT_MISSING');
    if(!input.profitTakePlan)blockers.push('ECONOMIC_TP_PLAN_MISSING');
    return{version:'V3.9.5',mode,passed:mode==='OFF',validatedAt:now,expectedNetProfit:0,requiredNetProfit:settings.takeProfit.minNetProfitUsd,reachProbability:null,historicalHardMaxMovePercent:null,targetMovePercent:0,notionalUsd:0,blockers};
  }
  const step=snapshot.quote.stepSize,units=Number(input.quantityUnits),qty=units*step,sideEnvelope=input.envelope?.[input.side],
    entryPrice=Number(input.actualEntryPrice??(input.side==='LONG'?input.acceptablePriceRange.max:input.acceptablePriceRange.min)),
    target=Number(input.profitTakePlan.targetPrice),notionalUsd=qty*entryPrice;
  if(!Number.isInteger(units)||units<=0||!Number.isFinite(qty)||qty<=0)blockers.push('AI_QUANTITY_UNITS_INVALID');
  if(!sideEnvelope?.executable||units>Number(sideEnvelope?.maxQuantityUnits??0)||notionalUsd>Number(sideEnvelope?.maxNotionalUsd??0)+1e-8)blockers.push('AI_QUANTITY_EXCEEDS_ENVELOPE');
  if(target<input.profitTakePlan.acceptableTargetRange.min||target>input.profitTakePlan.acceptableTargetRange.max)blockers.push('TP_TARGET_OUTSIDE_AI_RANGE');
  const directionValid=input.side==='LONG'?target>entryPrice:target<entryPrice;
  if(!directionValid)blockers.push('TP_TARGET_WRONG_SIDE');
  const exitRate=settings.takeProfit.exitFeeAssumption==='MAKER'?settings.takeProfit.makerFeeRate:settings.takeProfit.takerFeeRate;
  let expectedNetProfit=Number.NEGATIVE_INFINITY,requiredNetProfit=settings.takeProfit.minNetProfitUsd;
  if(Number.isFinite(entryPrice)&&entryPrice>0&&qty>0&&Number.isFinite(target)&&target>0){
    const e=estimateTradingCost({entryPrice,qty,direction:input.side,leverage:Number(input.envelope?.leverage??1),entryFeeRate:settings.takeProfit.entryFeeRate,expectedExitFeeRate:exitRate,expectedSlippagePct:settings.takeProfit.slippageBufferPct,feeSafetyBufferPct:settings.takeProfit.feeSafetyBufferPct,minNetProfitUsd:settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:settings.takeProfit.minNetProfitRoiPct},target);
    expectedNetProfit=e.expectedNetProfit;requiredNetProfit=e.requiredNetProfit;
    if(e.expectedNetProfit+1e-8<e.requiredNetProfit)blockers.push('ECONOMIC_MIN_NET_PROFIT_UNMET');
  }else blockers.push('ECONOMIC_INPUT_INVALID');
  const targetMovePercent=Number.isFinite(entryPrice)&&entryPrice>0?Math.abs(target/entryPrice-1)*100:0;
  let reachProbability:number|null=null,historicalHardMaxMovePercent:number|null=null;
  if(settings.tradeEconomics.historicalTpReachabilityEnabled&&directionValid){
    if(!input.market){blockers.push('TP_REACHABILITY_DATA_MISSING');}
    else {const tf=reachabilityTimeframe(input.profitTakePlan.targetHorizonMinutes),rows=input.market.cachedCandles(input.symbol,tf,300),
      r=evaluateTargetReachability({rows,side:input.side,horizonMinutes:input.profitTakePlan.targetHorizonMinutes,targetMovePercent,lookbackBars:settings.tradeEconomics.reachabilityLookbackBars,minSamples:settings.tradeEconomics.reachabilityMinSamples,now});
    reachProbability=r.reachProbability;historicalHardMaxMovePercent=r.hardMaxMovePercent;
    if(r.status==='STALE')blockers.push('TP_REACHABILITY_DATA_STALE');
    else if(r.status==='INSUFFICIENT_DATA')blockers.push('TP_REACHABILITY_DATA_INSUFFICIENT');
    else{
      if(r.hardMaxMovePercent!==null&&targetMovePercent>r.hardMaxMovePercent+1e-9)blockers.push('TP_HISTORICAL_REACHABILITY_UNMET');
      if(r.reachProbability!==null&&r.reachProbability+1e-12<settings.tradeEconomics.minHistoricalReachProbability)blockers.push('TP_REACH_PROBABILITY_UNMET');
    }}
  }
  const human=humanManagedExposure(state);
  if(settings.positionManagement.humanManagedAdmissionCapsEnabled&&!human.withinLimits)blockers.push('HUMAN_MANAGED_EXPOSURE_LIMIT');
  return{version:'V3.9.5',mode,passed:blockers.length===0,validatedAt:now,expectedNetProfit,requiredNetProfit,reachProbability,historicalHardMaxMovePercent,targetMovePercent,notionalUsd,blockers};
}

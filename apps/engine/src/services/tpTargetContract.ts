import { type Position, type ProfitTakePlan } from '@zdj/contracts';
import { roundToTick, type TradingCostEstimate } from '@zdj/core';

/**
 * P5: the take-profit target contract.
 *
 * The V3.9.6 guardian ordered its sources correctly (human mandate, then the authorized model
 * target, then 15m structure, then a fixed profitable fallback) but then applied two numbers the
 * model never chose: a hard-coded 1.2% minimum move for a full position, and a required net profit
 * that every candidate had to reach. For a $5 position that required roughly a 20% favourable move
 * to net $1, so every protected position ended up on a target the strategy had not authorised
 * (R2: all 55 rows reported `profitTakePlanSource=FIXED_PROFITABLE`).
 *
 * This module keeps the source order, drops the hidden overrides, and states for every selection
 * what the original authorised target was, what is being used, and why - so a fallback is a recorded
 * decision rather than an untraceable rewrite.
 */

export type TargetSource='HUMAN'|'AI'|'STRUCTURE_15M'|'FIXED_PROFITABLE';

export type TakeProfitCandidate={price:number;source:TargetSource;reason:string;authorized:boolean;horizonExpiresAt:number|null;range:{min:number;max:number}|null};

export type TargetSelection={
  price:number;source:TargetSource;reason:string;
  /** P5 provenance: what the strategy asked for versus what is being placed. */
  provenance:{
    authorizedPresent:boolean;
    authorizedPrice:number|null;
    authorizedReason:string|null;
    authorizedHorizonExpiresAt:number|null;
    authorizedValid:boolean;
    finalPrice:number;
    fellBackFrom:TargetSource|null;
    /** Why the chosen price differs from the authorized one, in order of what was checked. */
    refusals:string[];
    /** The economics at the chosen price, kept as a reading, never as a hidden override. */
    economics:{expectedNetProfit:number|null;requiredNetProfit:number|null;meetsProfitFloor:boolean|null};
    profitFloorDisposition:'WARN_AND_KEEP'|'FALL_BACK';
    minMoveFloorPercent:number;
    minMoveFloorSource:'CONFIGURED'|'DEFAULT_ZERO';
    parameterVersion:string;
  };
  economicWarning:{expectedNetProfit:number;requiredNetProfit:number;shortfallUsd:number}|null;
};

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value);

/**
 * Is an authorized model target still usable? The horizon, the evidence bar, the announced range and
 * the reachable side of the book are the checks the previous build also made; the profit floor and
 * the hard-coded move floor are deliberately not among them.
 */
export function authorizedTargetFacts(input:{position:Position;plan:ProfitTakePlan|null;tickSize:number;now:number;
  card:{isClosed?:boolean;barCloseTime?:number;lastClosedBar?:{closeTime:number};atrPercent?:number}|null;
  sideReachable:(price:number)=>boolean;movePct:(price:number)=>number;maxMovePercent:number;
  economicsFor:(price:number)=>TradingCostEstimate|null;profitFloorDisposition:'WARN_AND_KEEP'|'FALL_BACK';minMoveFloorPercent:number;minMoveFloorSource:'CONFIGURED'|'DEFAULT_ZERO';parameterVersion:string;
  }):{candidate:TakeProfitCandidate|null;refusals:string[];economics:TradingCostEstimate|null}{
  const plan=input.plan;
  if(!plan)return{candidate:null,refusals:['NO_AUTHORIZED_TARGET'],economics:null};
  const rounded=roundToTick(plan.targetPrice,input.tickSize,input.position.side==='LONG'?'ceil':'floor');
  const refusals:string[]=[];
  if(!finite(rounded)||rounded<=0){refusals.push('TARGET_PRICE_UNPROVEN');return{candidate:null,refusals,economics:null};}
  const horizonExpiresAt=input.position.openedAt+plan.targetHorizonMinutes*60_000;
  if(!(input.position.openedAt>0&&input.now<=horizonExpiresAt))refusals.push(`AI_HORIZON_EXPIRED_AT_${horizonExpiresAt}`);
  const evidence=input.card;
  const evidenceValid=Boolean(evidence&&Array.isArray(plan.evidenceRefs)&&plan.evidenceRefs.some(ref=>/15m/i.test(String(ref)))&&evidence.isClosed===true
    &&finite(evidence.barCloseTime)&&evidence.lastClosedBar?.closeTime===evidence.barCloseTime&&(input.now-Number(evidence.barCloseTime))<=1_805_000);
  if(!evidenceValid)refusals.push('15M_CLOSED_EVIDENCE_STALE_OR_ABSENT');
  const rangeValid=rounded>=plan.acceptableTargetRange.min&&rounded<=plan.acceptableTargetRange.max;
  if(!rangeValid)refusals.push(`OUTSIDE_AUTHORIZED_RANGE:${plan.acceptableTargetRange.min}-${plan.acceptableTargetRange.max}`);
  const sideOk=input.sideReachable(rounded)&&(input.position.side==='LONG'?rounded>input.position.entryPrice:rounded<input.position.entryPrice);
  if(!sideOk)refusals.push('TARGET_NOT_ON_REACHABLE_SIDE');
  // The distance cap is the configured structural ceiling or six ATRs, whichever is wider - it is an
  // upper bound on absurdity, not a floor that pushes the target away.
  const distanceOk=finite(evidence?.atrPercent)&&input.movePct(rounded)<=Math.max(input.maxMovePercent,Number(evidence!.atrPercent)*6);
  if(!distanceOk)refusals.push('TARGET_BEYOND_STRUCTURE_DISTANCE_CAP');
  const economics=input.economicsFor(rounded);
  const meetsFloor=Boolean(economics&&economics.expectedNetProfit>=economics.requiredNetProfit);
  if(!meetsFloor&&input.profitFloorDisposition==='FALL_BACK')refusals.push(`PROFIT_FLOOR_NOT_MET:${economics?economics.expectedNetProfit.toFixed(6):'NO_ECONOMICS'}<${economics?economics.requiredNetProfit.toFixed(6):'UNPROVEN'}`);
  if(input.minMoveFloorPercent>0&&input.movePct(rounded)<input.minMoveFloorPercent)refusals.push(`CONFIGURED_MIN_MOVE_FLOOR:${input.minMoveFloorPercent}`);
  if(refusals.length)return{candidate:null,refusals,economics};
  return{candidate:{price:rounded,source:'AI',reason:plan.targetReason||'AUTHORIZED_MODEL_TARGET',authorized:true,
    horizonExpiresAt,range:{min:Number(plan.acceptableTargetRange.min),max:Number(plan.acceptableTargetRange.max)}},refusals,economics};
}

/**
 * Builds the selection record. A kept authorized target that does not reach the configured profit
 * floor is reported as an economic warning attached to the placed order - visible to the operator and
 * to the accounting - instead of silently moving the target.
 */
export function assembleTargetSelection(input:{
  chosen:TakeProfitCandidate;
  authorized:{price:number|null;reason:string|null;horizonExpiresAt:number|null;refusals:string[];present:boolean};
  economics:(price:number)=>TradingCostEstimate|null;
  profitFloorDisposition:'WARN_AND_KEEP'|'FALL_BACK';
  minMoveFloorPercent:number;minMoveFloorSource:'CONFIGURED'|'DEFAULT_ZERO';parameterVersion:string;
}):TargetSelection{
  const economics=input.economics(input.chosen.price);
  const meetsFloor=economics?economics.expectedNetProfit>=economics.requiredNetProfit:null;
  const warning=economics&&economics.expectedNetProfit<economics.requiredNetProfit&&input.chosen.authorized
    ?{expectedNetProfit:economics.expectedNetProfit,requiredNetProfit:economics.requiredNetProfit,shortfallUsd:economics.requiredNetProfit-economics.expectedNetProfit}
    :null;
  return{
    price:input.chosen.price,source:input.chosen.source,reason:input.chosen.reason,
    economicWarning:warning,
    provenance:{
      authorizedPresent:input.authorized.present,authorizedPrice:input.authorized.price,authorizedReason:input.authorized.reason,
      authorizedHorizonExpiresAt:input.authorized.horizonExpiresAt,authorizedValid:input.chosen.source==='AI',
      finalPrice:input.chosen.price,
      fellBackFrom:input.chosen.source==='AI'?null:input.authorized.present?'AI':null,
      refusals:input.authorized.refusals,
      economics:{expectedNetProfit:economics?.expectedNetProfit??null,requiredNetProfit:economics?.requiredNetProfit??null,meetsProfitFloor:meetsFloor},
      profitFloorDisposition:input.profitFloorDisposition,
      minMoveFloorPercent:input.minMoveFloorPercent,minMoveFloorSource:input.minMoveFloorSource,
      parameterVersion:input.parameterVersion,
    },
  };
}

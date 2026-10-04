import { AllocationPlanSchema, type AllocationPlan, type MarketSymbolSnapshot, type UniverseCandidate } from '@zdj/contracts';
import { exposure, locationScore, resolveQuoteAsset, resolveUnderlying, riskTier, uid } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { PreAiExecutionEnvelope, ExecutionEnvelopeSide } from './preAiExecutionEnvelope.js';

/** Keep the frozen quantity inside its pre-Primary price and capital interval, without resizing it. */
export function frozenAllocationPrice(input:{desiredPrice:number;quantity:number;tickSize:number;
  entryRange:{min:number;max:number};maxNotionalUsd:number}):number|null{
  const {desiredPrice,quantity,tickSize,entryRange,maxNotionalUsd}=input;
  if(![desiredPrice,quantity,tickSize,entryRange.min,entryRange.max,maxNotionalUsd].every(Number.isFinite)||
    quantity<=0||tickSize<=0||entryRange.min<=0||entryRange.max<entryRange.min||maxNotionalUsd<=0)return null;
  const low=Math.ceil(entryRange.min/tickSize-1e-9),
    high=Math.floor(Math.min(entryRange.max,maxNotionalUsd/quantity)/tickSize+1e-9);
  if(!Number.isSafeInteger(low)||!Number.isSafeInteger(high)||high<low)return null;
  const units=Math.max(low,Math.min(high,Math.round(desiredPrice/tickSize)));
  const price=Number((units*tickSize).toPrecision(15));
  return price*quantity<=maxNotionalUsd+1e-8?price:null;
}

/** Materializes one frozen system candidate exactly. It has zero sizing or candidate-switch authority. */
export function materializeCandidateQuantityAllocation(input:{state:RuntimeState;candidate:UniverseCandidate;snapshot:MarketSymbolSnapshot;side:ExecutionEnvelopeSide;quantityUnits:number;authorizationMaxPrice:number;envelope:PreAiExecutionEnvelope}):AllocationPlan {
  const {state,candidate,snapshot,side,envelope}=input,units=Number(input.quantityUnits),step=snapshot.quote.stepSize;
  if(!Number.isInteger(units)||units<=0)throw new Error('AI_QUANTITY_UNITS_INVALID');
  const sideEnvelope=envelope[side];
  if(!sideEnvelope.executable)throw new Error('AI_DIRECTION_NOT_EXECUTABLE');
  // Both bounds of the legal quantity interval are verified here; nothing is clamped into range. The upper
  // bound is checked first because it is the authorized-capacity limit, and its name is the useful one.
  if(units>sideEnvelope.maxQuantityUnits)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  if(Number.isFinite(Number(sideEnvelope.minQuantityUnits))&&units<Number(sideEnvelope.minQuantityUnits))throw new Error('AI_QUANTITY_BELOW_ENVELOPE');
  const quantity=units*step,price=Number(input.authorizationMaxPrice),notionalUsd=quantity*price;
  if(!Number.isFinite(quantity)||quantity+1e-12<snapshot.quote.minQty)throw new Error('AI_QUANTITY_BELOW_MIN_QTY');
  if(!Number.isFinite(price)||price<=0||notionalUsd+1e-8<snapshot.quote.minNotional)throw new Error('AI_QUANTITY_BELOW_MIN_NOTIONAL');
  if(notionalUsd>sideEnvelope.maxNotionalUsd+1e-8)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  const leverage=envelope.leverage,marginUsd=notionalUsd/Math.max(1,leverage);
  if(marginUsd>sideEnvelope.maxMarginUsd+1e-8)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  const p=state.settings.portfolioIntelligence,positions=[...state.positions.values()].map(row=>({symbol:row.symbol,side:row.side,quantity:row.quantity,markPrice:row.markPrice,leverage:row.leverage})),before=exposure(positions,state.account.assets,p),after=exposure([...positions,{symbol:snapshot.symbol,side,quantity,markPrice:price,leverage}],state.account.assets,p),tier=(candidate.riskTier as any)??riskTier(snapshot,p);
  return AllocationPlanSchema.parse({planId:uid('alloc_candidate'),underlying:candidate.underlyingAsset??resolveUnderlying(snapshot.symbol),symbol:snapshot.symbol,quoteAsset:candidate.quoteAsset??resolveQuoteAsset(snapshot.symbol),riskTier:tier,directionPolicy:'BOTH',directionPreference:'BALANCED',direction:side,locationScore:locationScore(snapshot,side),locationWouldBlock:false,marginMode:p.symbolMarginModes[snapshot.symbol]??p.tierMarginModes[tier]??p.marginMode,leverage,marginUsd,notionalUsd,minExecutableMarginUsd:Math.max(snapshot.quote.minNotional/leverage,snapshot.quote.minQty*price/leverage),altLongMarginFactor:1,directionLeverageCap:leverage,exposureBefore:before,exposureAfter:after,admission:'ALLOW',policySource:'V3.9.7_CANDIDATE_QUANTITY_MATERIALIZER',reasons:['SYSTEM_CANDIDATE_QUANTITY_FROZEN','NO_CONFIDENCE_RESIZING','NO_DIRECTION_POLICY_RESIZING','NO_POST_SELECTION_RESIZING'],createdAt:Date.now()});
}

/** Archived callers retain the old symbol; live Entry uses the candidate-named export above. */
export const materializeAiQuantityAllocation=materializeCandidateQuantityAllocation;

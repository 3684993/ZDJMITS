import { AllocationPlanSchema, type AllocationPlan, type MarketSymbolSnapshot, type UniverseCandidate } from '@zdj/contracts';
import { exposure, locationScore, resolveQuoteAsset, resolveUnderlying, riskTier, uid } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { PreAiExecutionEnvelope, ExecutionEnvelopeSide } from './preAiExecutionEnvelope.js';

/** Materializes the model's frozen quantityUnits. It has zero sizing authority. */
export function materializeAiQuantityAllocation(input:{state:RuntimeState;candidate:UniverseCandidate;snapshot:MarketSymbolSnapshot;side:ExecutionEnvelopeSide;quantityUnits:number;authorizationMaxPrice:number;envelope:PreAiExecutionEnvelope}):AllocationPlan {
  const {state,candidate,snapshot,side,envelope}=input,units=Number(input.quantityUnits),step=snapshot.quote.stepSize;
  if(!Number.isInteger(units)||units<=0)throw new Error('AI_QUANTITY_UNITS_INVALID');
  const sideEnvelope=envelope[side];
  if(!sideEnvelope.executable)throw new Error('AI_DIRECTION_NOT_EXECUTABLE');
  if(units>sideEnvelope.maxQuantityUnits)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  const quantity=units*step,price=Number(input.authorizationMaxPrice),notionalUsd=quantity*price;
  if(!Number.isFinite(quantity)||quantity+1e-12<snapshot.quote.minQty)throw new Error('AI_QUANTITY_BELOW_MIN_QTY');
  if(!Number.isFinite(price)||price<=0||notionalUsd+1e-8<snapshot.quote.minNotional)throw new Error('AI_QUANTITY_BELOW_MIN_NOTIONAL');
  if(notionalUsd>sideEnvelope.maxNotionalUsd+1e-8)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  const leverage=envelope.leverage,marginUsd=notionalUsd/Math.max(1,leverage);
  if(marginUsd>sideEnvelope.maxMarginUsd+1e-8)throw new Error('AI_QUANTITY_EXCEEDS_ENVELOPE');
  const p=state.settings.portfolioIntelligence,positions=[...state.positions.values()].map(row=>({symbol:row.symbol,side:row.side,quantity:row.quantity,markPrice:row.markPrice,leverage:row.leverage})),before=exposure(positions,state.account.assets,p),after=exposure([...positions,{symbol:snapshot.symbol,side,quantity,markPrice:price,leverage}],state.account.assets,p),tier=(candidate.riskTier as any)??riskTier(snapshot,p);
  return AllocationPlanSchema.parse({planId:uid('alloc_ai'),underlying:candidate.underlyingAsset??resolveUnderlying(snapshot.symbol),symbol:snapshot.symbol,quoteAsset:candidate.quoteAsset??resolveQuoteAsset(snapshot.symbol),riskTier:tier,directionPolicy:'BOTH',directionPreference:'BALANCED',direction:side,locationScore:locationScore(snapshot,side),locationWouldBlock:false,marginMode:p.symbolMarginModes[snapshot.symbol]??p.tierMarginModes[tier]??p.marginMode,leverage,marginUsd,notionalUsd,minExecutableMarginUsd:Math.max(snapshot.quote.minNotional/leverage,snapshot.quote.minQty*price/leverage),altLongMarginFactor:1,directionLeverageCap:leverage,exposureBefore:before,exposureAfter:after,admission:'ALLOW',policySource:'V3.9.3_AI_QUANTITY_MATERIALIZER',reasons:['AI_QUANTITY_UNITS_FROZEN','NO_CONFIDENCE_RESIZING','NO_DIRECTION_POLICY_RESIZING'],createdAt:Date.now()});
}

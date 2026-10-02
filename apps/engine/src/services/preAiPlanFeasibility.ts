import { quantityLadder, minimumQuantityProfitFloor } from './quantityHorizonCandidates.js';
import type { PreAiExecutionEnvelope } from './preAiExecutionEnvelope.js';

/**
 * A cheap, deterministic answer to one question: does this side have *any* hard-executable plan path
 * at all, given the exchange filters and the risk capacity the envelope already computed?
 *
 * It exists because the 27B model costs ~55 seconds per run and the account was paying for a
 * PLACE decision that the plan layer then refused on mechanical grounds. Only hard gates may skip the
 * model here - the quantity ladder the exchange allows and the minimum-size profit floor - both
 * computed by the same functions the plan path uses, so a probe can never be stricter or looser than
 * the plan it precedes. Statistics are excluded by design: a historical reachability sample is a
 * judgement the model is allowed to make its thesis against, and in SHADOW it must not even be a veto.
 *
 * The probe also never chooses a side. It answers per side and refuses the model only when both
 * answers are "no hard path exists"; S06-T01 stays intact.
 */
export type PreAiPlanFeasibilitySide={executable:boolean;reasons:string[];statisticalEvidence:string[];quantityUnits:number;floorTargetPrice:number|null};
export type PreAiPlanFeasibility={symbol:string;checkedAt:number;noHardExecutableSide:boolean;
  sides:{LONG:PreAiPlanFeasibilitySide;SHORT:PreAiPlanFeasibilitySide}};

export function evaluatePreAiPlanFeasibility(input:{symbol:string;now:number;envelope:PreAiExecutionEnvelope;
  settings:{takeProfit:Parameters<typeof minimumQuantityProfitFloor>[0]['takeProfit'];tradeEconomics?:{admissionMode?:string};
    portfolioIntelligence?:{businessMinInitialMarginUsd?:number;preferredInitialMarginUsd?:number}}}):PreAiPlanFeasibility{
  const {symbol,now,envelope,settings}=input;
  const quote={tickSize:Number(envelope.exchange.tickSize),stepSize:Number(envelope.exchange.stepSize),minQty:Number(envelope.exchange.minQty),minNotional:Number(envelope.exchange.minNotional)};
  const probe=(side:'LONG'|'SHORT'):PreAiPlanFeasibilitySide=>{
    const capacity=envelope[side];
    const reasons:string[]=[];
    if(!capacity.executable)reasons.push(...(capacity.riskHeadroom?.blockers?.length?capacity.riskHeadroom.blockers:[capacity.riskHeadroom?.reason||'SIDE_NOT_EXECUTABLE']));
    // Each side is priced at the most favourable maker price it could legally get, because this
    // probe may only refuse when no legal price works: priced at the adverse edge it would be
    // stricter than the plan it precedes and could silently starve the pipeline of model calls.
    const entryPrice=side==='LONG'?Number(envelope.makerReachableBand.min):Number(envelope.makerReachableBand.max);
    if(!(quote.stepSize>0)||!(quote.tickSize>0)||!(envelope.leverage>0)||!(entryPrice>0))reasons.push('CANDIDATE_MARKET_FACT_INVALID');
    if(reasons.length)return{executable:false,reasons:[...new Set(reasons)],statisticalEvidence:[],quantityUnits:0,floorTargetPrice:null};
    const quantityCeiling=Math.min(Number(capacity.maxQuantityUnits??0),Number(capacity.maxNotionalUsd??0)/(quote.stepSize*entryPrice),
      Number(capacity.maxMarginUsd??Number.POSITIVE_INFINITY)*envelope.leverage/(quote.stepSize*entryPrice));
    // The probe sizes at the same legal minimum the plan would use. It never grows a quantity to make
    // the answer come out yes - that would be sizing to the outcome, which S06-T02 forbids.
    const ladder=quantityLadder(Number(capacity.minQuantityUnits??1),quantityCeiling,quote.stepSize,entryPrice,quote.minNotional,{leverage:envelope.leverage,
      businessMinInitialMarginUsd:Number(settings.portfolioIntelligence?.businessMinInitialMarginUsd??100),
      preferredInitialMarginUsd:Number(settings.portfolioIntelligence?.preferredInitialMarginUsd??200)});
    if(!ladder.length)return{executable:false,reasons:['BUSINESS_MIN_INITIAL_MARGIN_UNAVAILABLE'],statisticalEvidence:[],quantityUnits:0,floorTargetPrice:null};
    const floor=minimumQuantityProfitFloor({entryPrice,quantityUnits:ladder[0],stepSize:quote.stepSize,direction:side,leverage:envelope.leverage,tickSize:quote.tickSize,takeProfit:settings.takeProfit});
    if(!floor.met)return{executable:false,reasons:['MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY',`MIN_NET_PROFIT_USD=${floor.requiredNetProfitUsd}`,`ATTAINED_NET_PROFIT_USD=${floor.expectedNetProfitUsd}`],
      statisticalEvidence:[],quantityUnits:ladder[0],floorTargetPrice:floor.floorTargetPrice};
    return{executable:true,reasons:[],statisticalEvidence:[],quantityUnits:ladder[0],floorTargetPrice:floor.floorTargetPrice};
  };
  const LONG=probe('LONG'),SHORT=probe('SHORT');
  return{symbol,checkedAt:now,noHardExecutableSide:!LONG.executable&&!SHORT.executable,sides:{LONG,SHORT}};
}

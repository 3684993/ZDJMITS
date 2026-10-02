import {createHash} from 'node:crypto';
import {TradePlanCandidateTargetSchema, type TradePlanCandidate, type TradePlanEconomics, type TradePlanRisk} from '@zdj/contracts';
import {STANDARD_TP_HORIZONS, reachabilityTimeframe, evaluateTargetReachability, summarizeReachability} from './historicalTpReachability.js';
import {estimateTradingCost,tradingCostSnapshot} from '@zdj/core';

/**
 * S06-B/C: the system, not the model, enumerates the legal (quantity, horizon, target) combinations.
 *
 * Every candidate is a full cost, risk and statistical statement about itself, so a later reviewer
 * can recompute why it was offered. Two rules are the point of this file: a size is only ever grown
 * because the risk envelope allows it, never to make a thin trade clear the profit floor; and a
 * missing statistical sample stays missing rather than becoming a fifty-fifty guess.
 */

export type CandidateRiskFacts={capitalAtRiskUsd:number;grossNotionalAfterUsd:number;longNotionalAfterUsd:number;shortNotionalAfterUsd:number;
  clusterNotionalAfterUsd:number;limitingConstraints:string[];riskGeneration:number;snapshotHash:string;profileVersion:string;humanSlotsAfter:number};

export type CandidateSet={schemaVersion:'V396-PLAN-CANDIDATE-SET-1'|'V397-PLAN-CANDIDATE-SET-2';symbol:string;side:'LONG'|'SHORT';createdAt:number;expiresAt:number;
  factVersion:string;candidateSetHash:string;candidates:TradePlanCandidate[];noTradeReasons:string[];
  /**
   * Statistical statements the account is not currently entitled to enforce. They are reported here so
   * a reviewer can see the sample disagreed with the target, and never folded into `noTradeReasons`,
   * which is the list that actually refuses a plan.
   */
  statisticalEvidence?:string[];
  quantityLadder:number[];horizonLadder:number[];rejectedCombinations:number;
  /** The caller's own choice, when one was asked for, and why it was or was not offered. */
  selection?:{quantityUnits:number;targetPrice:number;targetHorizonMinutes:number;offered:boolean;refusals:string[];
    /** Parameters the model left unset, which the system then took from its own floor and ladder. */
    fallbacks?:string[];resolved?:{quantityUnits:number;targetPrice:number;targetHorizonMinutes:number;candidateId:string}};
  feasibleQuantityUnits?:{min:number;max:number};bounds?:Array<{horizonMinutes:number;minTargetPrice:number;maxTargetPrice:number|null;status:string}>;
  entryTtlMinutes?:number;managementDurationMs?:number};

export type CandleRow={high:number;low:number;close:number;closeTime:number};

// Versioned domains keep new authority disjoint from historical candidate ids. Sort object keys so
// equivalent fact objects have one identity; array order remains part of the published menu.
const canonicalJson=(value:unknown):string=>JSON.stringify(value,(_key,item)=>
  item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const stableId=(domain:'cand_v2'|'cset_v2',value:unknown)=>`${domain}_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0,24)}`;
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const round=(value:number,digits:number)=>Number(value.toFixed(digits));
/** Prices are expressed in whole ticks, always on the conservative side of the bound they state. */
const alignTick=(price:number,tick:number,up:boolean)=>Number(Number((up?Math.ceil(price/tick-1e-9):Math.floor(price/tick+1e-9))*tick).toFixed(Math.max(0,(String(tick).split('.')[1]??'').length)));

export type BusinessSizingPolicy={leverage:number;businessMinInitialMarginUsd:number;preferredInitialMarginUsd:number};
export function quantityLadder(minUnits:number,maxUnits:number,stepSize:number,entryPrice:number,minNotional:number,policy?:BusinessSizingPolicy){
  // A step of 1 at a sub-cent price needs hundreds of units before the exchange minimum notional is
  // met, so the ladder starts at the smallest size that is legal, not at one step.
  const smallestLegal=Math.max(1,Math.ceil((minNotional*(1+1e-9))/(stepSize*entryPrice)));
  const businessFloor=policy?Math.ceil((policy.businessMinInitialMarginUsd*policy.leverage)/(stepSize*entryPrice)-1e-9):1;
  const preferred=policy?Math.ceil((policy.preferredInitialMarginUsd*policy.leverage)/(stepSize*entryPrice)-1e-9):null;
  const floor=Math.max(1,Math.ceil(minUnits),smallestLegal,businessFloor),ceiling=Math.floor(maxUnits);
  if(!Number.isSafeInteger(floor)||!Number.isSafeInteger(ceiling)||ceiling<floor)return[];
  const wanted=[floor,preferred,Math.ceil(floor+(ceiling-floor)*.5),ceiling]
    .filter((units):units is number=>units!==null)
    .filter(units=>units>=floor&&units<=ceiling&&units*stepSize*entryPrice+1e-9>=minNotional);
  return [...new Set(wanted)].sort((a,b)=>a-b).slice(0,4);
}

export type ProfitFloorInput={entryPrice:number;quantityUnits:number;stepSize:number;direction:'LONG'|'SHORT';leverage:number;tickSize:number;
  takeProfit:{entryFeeRate:number;takerFeeRate:number;makerFeeRate:number;exitFeeAssumption:string;slippageBufferPct:number;feeSafetyBufferPct:number;minNetProfitUsd:number;minNetProfitRoiPct:number}};

/**
 * The price at which a given size clears its own profit floor, and whether it can get there at all.
 *
 * This is the single implementation of "profitable at this size": the plan path and the pre-AI
 * feasibility probe both call it, because the two must never disagree about what the hard economic
 * condition means - a probe that was cheaper or stricter than the plan would either waste a model
 * call or admit a trade the plan then refuses. Statistics are deliberately absent here; they bind in
 * `buildQuantityHorizonCandidates`, not in the floor.
 */
export function minimumQuantityProfitFloor(input:ProfitFloorInput):
  {met:boolean;floorTargetPrice:number;minProfitableExitPrice:number;requiredNetProfitUsd:number;expectedNetProfitUsd:number}{
  const {entryPrice,tickSize,direction,quantityUnits,stepSize,leverage,takeProfit}=input;
  const exitFeeRate=takeProfit.exitFeeAssumption==='MAKER'?takeProfit.makerFeeRate:takeProfit.takerFeeRate;
  const cost=(exitPrice:number)=>estimateTradingCost({entryPrice,qty:quantityUnits*stepSize,direction,leverage,entryFeeRate:takeProfit.entryFeeRate,
    expectedExitFeeRate:exitFeeRate,expectedSlippagePct:takeProfit.slippageBufferPct,feeSafetyBufferPct:takeProfit.feeSafetyBufferPct,
    minNetProfitUsd:takeProfit.minNetProfitUsd,minNetProfitRoiPct:takeProfit.minNetProfitRoiPct},exitPrice);
  const minProfitableExitPrice=cost(entryPrice).minProfitableExitPrice;
  // A required profit the whole position can never yield has no representable answer: the solver
  // returns its own search bound, which for SHORT is a fraction of one tick, and rounding that to a
  // tick produces zero - not a price. The floor is then stated at the smallest legal tick so the
  // honest answer is "not met at this size", never a crash the caller has to guess about.
  const atLeastOneTick=(price:number)=>Math.max(tickSize,Number.isFinite(price)?price:tickSize);
  // The floor is the first whole tick at which the computed net really clears the requirement: the
  // solver's own answer carries a tolerance, so aligning once is not enough to trust the bound.
  let floorTargetPrice=atLeastOneTick(alignTick(direction==='LONG'?Math.max(minProfitableExitPrice,entryPrice+tickSize):Math.min(minProfitableExitPrice,entryPrice-tickSize),tickSize,direction==='LONG'));
  for(let step=0;step<6;step++){
    const probe=cost(floorTargetPrice);
    if(probe.expectedNetProfit+1e-9>=probe.requiredNetProfit)break;
    floorTargetPrice=atLeastOneTick(alignTick(floorTargetPrice+(direction==='LONG'?tickSize:-tickSize),tickSize,direction==='LONG'));
  }
  const economics=cost(floorTargetPrice);
  return{met:economics.expectedNetProfit+1e-8>=economics.requiredNetProfit,floorTargetPrice,minProfitableExitPrice,
    requiredNetProfitUsd:economics.requiredNetProfit,expectedNetProfitUsd:economics.expectedNetProfit};
}

function horizonLadder(settings:any,targetHorizons:number[]|undefined){
  const configured=Array.isArray(targetHorizons)&&targetHorizons.length?targetHorizons:STANDARD_TP_HORIZONS;
  const max=Math.min(1440,Number(settings?.takeProfit?.structureMaxMovePercent?1440:1440));
  const allowed=configured.filter(h=>Number.isInteger(h)&&h>=5&&h<=max).sort((a,b)=>a-b);
  const picked=[15,60,240].map(want=>allowed.reduce<number|null>((best,h)=>h>=want&&(best===null||Math.abs(h-want)<Math.abs(best-want))?h:best,null))
    .filter((h):h is number=>h!=null);
  return [...new Set(picked.length?picked:allowed.slice(0,3))].slice(0,3);
}

/**
 * The horizons a plan can actually be written for. This is exported so the pre-AI envelope can publish
 * the same set the plan layer will enforce: the model was being invited to choose any horizon from 5 to
 * 1440 minutes and then refused for `CANDIDATE_HORIZON_UNSUPPORTED`, which is a self-inflicted loss of
 * conversions, not a risk decision.
 */
export function legalTargetHorizonMinutes(settings:any,targetHorizons?:number[]):number[]{
  return horizonLadder(settings,targetHorizons??settings?.tradeEconomics?.standardTpHorizons);
}

export function buildQuantityHorizonCandidates(input:{
  symbol:string;
  side:'LONG'|'SHORT';
  now:number;
  quote:{bid:number;ask:number;tickSize:number;stepSize:number;minQty:number;minNotional:number};
  leverage:number;
  envelope:{maxQuantityUnits:number;maxNotionalUsd:number;maxMarginUsd:number;minQuantityUnits?:number;executable:boolean;riskHeadroom?:{reason?:string;blockers?:string[]}};
  envelopeExpiresAt:number;
  factVersion:string;
  risk:CandidateRiskFacts|null;
  settings:{takeProfit:{entryFeeRate:number;takerFeeRate:number;makerFeeRate:number;exitFeeAssumption:string;slippageBufferPct:number;feeSafetyBufferPct:number;minNetProfitUsd:number;minNetProfitRoiPct:number};
    tradeEconomics:{admissionMode:string;historicalTpReachabilityEnabled?:boolean;reachabilityLookbackBars?:number;reachabilityMinSamples?:number;minHistoricalReachProbability?:number};
    portfolioIntelligence?:{businessMinInitialMarginUsd?:number;preferredInitialMarginUsd?:number}};
  candles:(timeframe:string,count:number)=>CandleRow[];
  targetHorizons?:number[];
  managementDurationMs:number;
  /** Funding over the horizon, only when S01 accounting can price it; otherwise unknown. */
  fundingEstimate?:{amountUsd:number|null;status:'VERIFIED'|'UNPROVEN'|'INSUFFICIENT_SAMPLE'|'CONFLICT';sourceId:string|null};
  /** The model's own choice. It is validated and computed here, never taken on trust. */
  selection?:{quantityUnits:number;targetPrice:number;targetHorizonMinutes:number};
}):CandidateSet{
  const {symbol,side,now,quote,leverage,envelope,settings}=input;
  const identityFacts={factVersion:input.factVersion,envelopeExpiresAt:input.envelopeExpiresAt,
    exchange:{tickSize:quote.tickSize,stepSize:quote.stepSize,minQty:quote.minQty,minNotional:quote.minNotional},
    envelope:{executable:envelope.executable,minQuantityUnits:envelope.minQuantityUnits??1,maxQuantityUnits:envelope.maxQuantityUnits,
      maxNotionalUsd:envelope.maxNotionalUsd,maxMarginUsd:envelope.maxMarginUsd,riskHeadroom:envelope.riskHeadroom??null},
    policy:{takeProfit:settings.takeProfit,tradeEconomics:settings.tradeEconomics,
      businessMinInitialMarginUsd:settings.portfolioIntelligence?.businessMinInitialMarginUsd??100,
      preferredInitialMarginUsd:settings.portfolioIntelligence?.preferredInitialMarginUsd??200}};
  // A rejected set still answers every field a consumer reads: the caller's own selection is refused
  // with the same reasons, instead of the caller having to guess whether an absent field means no.
  const rejectAll=(...reasons:string[]):CandidateSet=>({schemaVersion:'V397-PLAN-CANDIDATE-SET-2',symbol,side,createdAt:now,expiresAt:input.envelopeExpiresAt,
    factVersion:input.factVersion,candidateSetHash:stableId('cset_v2',{schemaVersion:'V397-PLAN-CANDIDATE-SET-2',symbol,side,identityFacts,reasons:[...new Set(reasons)]}),candidates:[],noTradeReasons:[...new Set(reasons)],statisticalEvidence:[],quantityLadder:[],horizonLadder:[],
    rejectedCombinations:0,feasibleQuantityUnits:{min:0,max:0},bounds:[],entryTtlMinutes:1,managementDurationMs:input.managementDurationMs,
    selection:input.selection?{...input.selection,offered:false,refusals:[...new Set(reasons)],fallbacks:[]}:undefined});
  if(!envelope.executable)return rejectAll('SIDE_NOT_EXECUTABLE',...(envelope.riskHeadroom?.blockers??[]));
  if(![quote.stepSize,quote.tickSize,leverage].every(value=>finite(value)&&value>0))return rejectAll('CANDIDATE_MARKET_FACT_INVALID');
  const entryPrice=side==='LONG'?quote.ask:quote.bid;
  if(!finite(entryPrice)||entryPrice<=0)return rejectAll('CANDIDATE_ENTRY_PRICE_UNPROVEN');
  const businessMinInitialMarginUsd=Math.max(0,Number(settings.portfolioIntelligence?.businessMinInitialMarginUsd??100));
  const preferredInitialMarginUsd=Math.max(businessMinInitialMarginUsd,Number(settings.portfolioIntelligence?.preferredInitialMarginUsd??200));
  const quantityCeiling=Math.min(Number(envelope.maxQuantityUnits??0),Number(envelope.maxNotionalUsd??0)/(quote.stepSize*entryPrice),
    Number(envelope.maxMarginUsd??Number.POSITIVE_INFINITY)*leverage/(quote.stepSize*entryPrice));
  const quantities=quantityLadder(Number(envelope.minQuantityUnits??1),quantityCeiling,quote.stepSize,entryPrice,quote.minNotional,
    {leverage,businessMinInitialMarginUsd,preferredInitialMarginUsd});
  if(!quantities.length)return rejectAll('BUSINESS_MIN_INITIAL_MARGIN_UNAVAILABLE',`BUSINESS_MIN_INITIAL_MARGIN_USD=${round(businessMinInitialMarginUsd,6)}`,
    `AVAILABLE_INITIAL_MARGIN_USD=${round(Number(envelope.maxMarginUsd??0),6)}`);
  const horizons=horizonLadder(settings,input.targetHorizons);
  if(!horizons.length)return rejectAll('NO_LEGAL_TARGET_HORIZON');
  const costPolicy=tradingCostSnapshot({...settings.takeProfit,exitFeeAssumption:settings.takeProfit.exitFeeAssumption==='MAKER'?'MAKER':'TAKER'}),exitFeeRate=costPolicy.expectedExitFeeRate;
  // Mechanical legality (envelope, filters, tick, side) always binds. The economic and statistical
  // gates bind only when the account runs them in ENFORCE; otherwise they are recorded, not assumed.
  const enforceEconomics=settings.tradeEconomics?.admissionMode==='ENFORCE';
  const funding=input.fundingEstimate??{amountUsd:null,status:'UNPROVEN' as const,sourceId:null};
  const entryTtlMinutes=Math.max(1,Math.min(60,Math.floor(Math.max(0,input.envelopeExpiresAt-now)/60_000)||1));
  const candidates:TradePlanCandidate[]=[];
  let rejected=0;
  const targetFor=(units:number,horizonMinutes:number)=>{
    const profitFloor=minimumQuantityProfitFloor({entryPrice,quantityUnits:units,stepSize:quote.stepSize,direction:side,leverage,tickSize:quote.tickSize,takeProfit:settings.takeProfit});
    const rows=input.candles(reachabilityTimeframe(horizonMinutes),300) as never;
    const summary=summarizeReachability({rows,horizonMinutes,lookbackBars:settings.tradeEconomics.reachabilityLookbackBars??180,
      minSamples:settings.tradeEconomics.reachabilityMinSamples??30,now}),statistics=summary[side];
    const reach={status:summary.status,sampleCount:summary.sampleCount,timeframe:summary.timeframe,
      hardMaxMovePercent:summary.status==='READY'?statistics.hardMaxMovePercent:null,reachProbability:null,targetMovePercent:0};
    const targetAt=(move:number)=>move>0?alignTick(side==='LONG'?entryPrice*(1+move/100):entryPrice*(1-move/100),quote.tickSize,side==='SHORT'):null;
    const p50Target=summary.status==='READY'?targetAt(statistics.p50):null,p75Target=summary.status==='READY'?targetAt(statistics.p75):null;
    // p75 is the ordinary statistical ceiling. hard-max remains tail evidence and is never offered as
    // a normal TP candidate; otherwise one outlier candle becomes an executable objective.
    const statistical=summary.status==='READY'&&statistics.p75>0?statistics.p75:null,statisticalTarget=p75Target;
    const floorBeyondCeiling=statisticalTarget!=null&&(side==='LONG'?profitFloor.floorTargetPrice>statisticalTarget+1e-12:profitFloor.floorTargetPrice<statisticalTarget-1e-12);
    return{floorTarget:profitFloor.floorTargetPrice,statisticalTarget,p50Target,p75Target,p50Move:summary.status==='READY'?statistics.p50:null,
      p75Move:summary.status==='READY'?statistics.p75:null,minProfitableExit:profitFloor.minProfitableExitPrice,statistical,reach,floorBeyondCeiling,profitFloor};
  };
  // The smallest size decides whether a trade exists at all. If it cannot clear the profit floor the
  // answer is NO_TRADE; offering a bigger size that clears the floor would be sizing to the outcome.
  const smallest=targetFor(quantities[0],horizons[0]);
  const smallestEconomics=smallest.profitFloor;
  // Two questions that were previously answered with one message. Whether the smallest legal size can
  // clear its own profit floor is arithmetic and binds in every mode (S06-T02). The calibrated reach
  // probability remains SHADOW-able, but p50/p75 define the ordinary candidate domain: a floor beyond
  // p75 is not silently promoted to a tail objective merely because probability enforcement is off.
  if(!smallestEconomics.met)
    return rejectAll('MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY',`MIN_NET_PROFIT_USD=${round(smallestEconomics.requiredNetProfitUsd,6)}`,
      `ATTAINED_NET_PROFIT_USD=${round(smallestEconomics.expectedNetProfitUsd,6)}`);
  const ceilingExceededAtMinimum=smallest.floorBeyondCeiling===true;
  if(ceilingExceededAtMinimum&&enforceEconomics)
    return rejectAll('HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY',
      `FLOOR_TARGET=${round(smallest.floorTarget,10)}`,`STATISTICAL_CEILING=${smallest.statisticalTarget==null?'UNPROVEN':round(smallest.statisticalTarget,10)}`);
  const statisticalEvidence=ceilingExceededAtMinimum?['HISTORICAL_TARGET_CEILING_EXCEEDED_AT_MINIMUM_QUANTITY']:[];

  const buildCandidate=(units:number,horizon:number,targetPrice:number,rangeTargets:number[]=[],targetBasis:TradePlanEconomics['targetBasis']='PROFIT_FLOOR_UNPROVEN',reachabilityBand?:{p50:number|null;p75:number|null})=>{
    const notional=units*quote.stepSize*entryPrice, margin=notional/leverage;
    const cost=estimateTradingCost({entryPrice,qty:units*quote.stepSize,direction:side,leverage,entryFeeRate:settings.takeProfit.entryFeeRate,
      expectedExitFeeRate:exitFeeRate,expectedSlippagePct:settings.takeProfit.slippageBufferPct,feeSafetyBufferPct:settings.takeProfit.feeSafetyBufferPct,
      minNetProfitUsd:settings.takeProfit.minNetProfitUsd,minNetProfitRoiPct:settings.takeProfit.minNetProfitRoiPct},targetPrice);
    const blockers:string[]=[];
    if(margin>Number(envelope.maxMarginUsd??0)+1e-8||notional>Number(envelope.maxNotionalUsd??0)+1e-8)blockers.push('QUANTITY_EXCEEDS_ENVELOPE');
    if(!(units*quote.stepSize>=quote.minQty-1e-12))blockers.push('QUANTITY_BELOW_MIN_QTY');
    if(notional+1e-9<quote.minNotional)blockers.push('NOTIONAL_BELOW_MIN');
    // Dollar economics is deterministic and belongs to the executable candidate contract in every
    // mode. SHADOW applies to uncalibrated probability evidence, not to a target already known to miss
    // its fee-adjusted minimum-net requirement.
    if(cost.expectedNetProfit+1e-8<cost.requiredNetProfit)blockers.push('ECONOMIC_MIN_NET_PROFIT_UNMET');
    if(targetBasis==='PROFIT_FLOOR_BEYOND_P75')blockers.push('TARGET_BEYOND_P75_REACHABILITY_BAND');
    if(side==='LONG'?targetPrice<=entryPrice:targetPrice>=entryPrice)blockers.push('TARGET_ON_WRONG_SIDE_OF_ENTRY');
    const targetMovePercent=entryPrice>0?Math.abs(targetPrice/entryPrice-1)*100:0;
    const reach=evaluateTargetReachability({rows:input.candles(reachabilityTimeframe(horizon),300) as never,side,horizonMinutes:horizon,
      targetMovePercent,lookbackBars:settings.tradeEconomics.reachabilityLookbackBars??180,minSamples:settings.tradeEconomics.reachabilityMinSamples??30,now});
    const probabilityKnown=reach.status==='READY'&&finite(reach.reachProbability);
    // A stale or missing sample is recorded in the economics as what it is; it refuses a candidate
    //    only where the account actually enforces the economic gate.
    if(enforceEconomics&&settings.tradeEconomics.historicalTpReachabilityEnabled&&reach.status==='STALE')blockers.push('TP_REACHABILITY_DATA_STALE');
    if(enforceEconomics&&settings.tradeEconomics.historicalTpReachabilityEnabled&&!probabilityKnown)
      blockers.push(`TP_REACHABILITY_${reach.status==='INSUFFICIENT_DATA'?'INSUFFICIENT_SAMPLE':'UNPROVEN'}`);
    if(enforceEconomics&&probabilityKnown&&finite(reach.hardMaxMovePercent)&&targetMovePercent>(reach.hardMaxMovePercent as number)+1e-9)
      blockers.push('TP_HISTORICAL_REACHABILITY_UNMET');
    const economics:TradePlanEconomics={
      targetConditionalNetProfitUsd:round(cost.expectedNetProfit,6),targetConditionalNetProfitStatus:'VERIFIED',
      // The unconditional expectation needs a distribution; without a ready sample it stays unknown,
      // and it is never filled in from the model's own confidence.
      expectedNetPnlAtHorizonUsd:probabilityKnown?round((reach.reachProbability as number)*cost.expectedNetProfit+(1-(reach.reachProbability as number))*-Math.max(0,cost.requiredNetProfit),6):null,
      expectedNetPnlAtHorizonStatus:probabilityKnown?'VERIFIED':'INSUFFICIENT_SAMPLE',
      reachProbability:probabilityKnown?reach.reachProbability:null,
      reachProbabilityStatus:probabilityKnown?'VERIFIED':reach.status==='STALE'?'STALE':reach.status==='INSUFFICIENT_DATA'?'INSUFFICIENT_SAMPLE':'UNPROVEN',
      reachSampleCount:reach.sampleCount,historicalHardMaxMovePercent:finite(reach.hardMaxMovePercent)?reach.hardMaxMovePercent:null,
      targetMovePercent:round(targetMovePercent,6),
      statisticalSource:probabilityKnown?`CLOSED_CANDLE_CACHE:${reach.timeframe}:${reach.sampleCount}`:null,
      targetBasis,reachabilityP50MovePercent:reachabilityBand?.p50??null,reachabilityP75MovePercent:reachabilityBand?.p75??null,
      // The same comparison the ENFORCE gate above uses, stated as evidence in every mode: an operator
      // must be able to see "the sample never moved this far" without it being either a veto or a pass.
      targetVsStatisticalCeiling:!probabilityKnown||!finite(reach.hardMaxMovePercent)?'UNPROVEN'
        :targetMovePercent>(reach.hardMaxMovePercent as number)+1e-9?'BEYOND':'WITHIN',
      modelConfidence:null,modelConfidenceIsAuthority:false,
    };
    const risk:TradePlanRisk|null=input.risk?{capitalAtRiskUsd:round(input.risk.capitalAtRiskUsd+margin,6),grossNotionalAfterUsd:round(input.risk.grossNotionalAfterUsd+notional,6),
      longNotionalAfterUsd:round(side==='LONG'?input.risk.longNotionalAfterUsd+notional:input.risk.longNotionalAfterUsd,6),
      shortNotionalAfterUsd:round(side==='SHORT'?input.risk.shortNotionalAfterUsd+notional:input.risk.shortNotionalAfterUsd,6),
      clusterNotionalAfterUsd:round(input.risk.clusterNotionalAfterUsd+notional,6),
      limitingConstraints:[...new Set(input.risk.limitingConstraints)].slice(0,24),riskGeneration:input.risk.riskGeneration,
      snapshotHash:input.risk.snapshotHash,profileVersion:input.risk.profileVersion,humanSlotsAfter:input.risk.humanSlotsAfter+1}:null;
    const range=rangeTargets.filter(value=>finite(value));
    const target=TradePlanCandidateTargetSchema.parse({targetPrice:round(targetPrice,10),
      acceptableTargetRange:{min:round(Math.min(targetPrice,...range),10),max:round(Math.max(targetPrice,...range),10)}});
    const authorization:Omit<TradePlanCandidate,'candidateId'|'createdAt'>={schemaVersion:'V397-PLAN-CANDIDATE-2',symbol,side,quantityUnits:units,quantitySteps:units,
      notionalUsd:round(notional,6),marginUsd:round(margin,6),leverage,entryReferencePrice:round(entryPrice,10),...target,
      entryTtlMinutes,
      targetHorizonMinutes:horizon,managementDurationMs:input.managementDurationMs,
      costs:{entryFeeUsd:round(cost.estimatedEntryFee,6),exitFeeUsd:round(cost.estimatedExitFee,6),slippageUsd:round(cost.slippageBuffer,6),
        uncertaintyBufferUsd:round(cost.feeSafetyBuffer,6),fundingEstimateUsd:funding.amountUsd??0,fundingStatus:funding.status,
        fxRateToQuote:1,costVersion:costPolicy.costVersion},
      economics,risk,evidenceRefs:[],executable:blockers.length===0,blockers:[...new Set(blockers)].slice(0,24)};
    return{...authorization,candidateId:stableId('cand_v2',{identityFacts,authorization}),createdAt:now};
  };
  const primaryHorizon=horizons.reduce((best,horizon)=>Math.abs(horizon-60)<Math.abs(best-60)?horizon:best,horizons[0]!);
  const orderedHorizons=[...horizons].sort((a,b)=>(a===primaryHorizon?-1:b===primaryHorizon?1:Math.abs(a-60)-Math.abs(b-60)));
  for(const units of quantities){
    for(const horizon of orderedHorizons){
      const priced=targetFor(units,horizon);
      const band=[priced.p50Target,priced.p75Target].filter((value,index,row):value is number=>finite(value)&&(row.indexOf(value)===index));
      if(priced.reach.status==='READY'){
        if(priced.floorBeyondCeiling)candidates.push(buildCandidate(units,horizon,priced.floorTarget,band,'PROFIT_FLOOR_BEYOND_P75',{p50:priced.p50Move,p75:priced.p75Move}));
        else{
          const ordinary=[{price:priced.p50Target,basis:'P50' as const},...(horizon===primaryHorizon?[{price:priced.p75Target,basis:'P75' as const}]:[])];
          for(const target of ordinary)if(finite(target.price))candidates.push(buildCandidate(units,horizon,target.price,band,target.basis,{p50:priced.p50Move,p75:priced.p75Move}));
        }
      }else candidates.push(buildCandidate(units,horizon,priced.floorTarget,[priced.floorTarget],'PROFIT_FLOOR_UNPROVEN',{p50:null,p75:null}));
    }
  }
  const executable=candidates.filter(row=>row.executable);
  const reasons:string[]=[];
  if(!executable.length){
    reasons.push('NO_EXECUTABLE_CANDIDATE');
    for(const blocker of new Set(candidates.flatMap(row=>row.blockers)))reasons.push(blocker);
  }
  const kept=executable.slice(0,16);
  const selection=input.selection;
  let selectionOutcome:{offered:boolean;refusals:string[];fallbacks:string[];resolved?:{quantityUnits:number;targetPrice:number;targetHorizonMinutes:number;candidateId:string}}
    ={offered:false,refusals:['NO_SELECTION_REQUESTED'],fallbacks:[]};
  let selected:TradePlanCandidate|null=null;
  let selectionRequest={quantityUnits:0,targetPrice:0,targetHorizonMinutes:0};
  if(selection){
    const rawUnits=Math.trunc(Number(selection.quantityUnits)),rawHorizon=Math.trunc(Number(selection.targetHorizonMinutes)),rawTarget=Number(selection.targetPrice);
    const refusals:string[]=[],fallbacks:string[]=[];
    let units=rawUnits,horizon=rawHorizon,target=rawTarget;
    if(!Number.isSafeInteger(units)||units<=0)refusals.push(`CANDIDATE_QUANTITY_INVALID:${selection.quantityUnits??'none'}`);
    else if(units<quantities[0])refusals.push(`CANDIDATE_QUANTITY_BELOW_LEGAL_MINIMUM:units=${units}<${quantities[0]}`);
    else if(units>quantities[quantities.length-1])refusals.push(`CANDIDATE_QUANTITY_EXCEEDS_ENVELOPE:units=${units}>${quantities[quantities.length-1]}`);
    if(refusals.length===0&&(!Number.isSafeInteger(horizon)||horizon<=0)){
      horizon=horizons[Math.floor((horizons.length-1)/2)];
      fallbacks.push(`TARGET_HORIZON_FROM_LADDER:${horizon}`);
    }else if(refusals.length===0&&!horizons.includes(horizon))refusals.push(`CANDIDATE_HORIZON_UNSUPPORTED:${horizon}`);
    const priced=refusals.length?null:targetFor(units,horizon);
    if(refusals.length===0&&!(finite(target)&&target>0)){
      // No model target: the system uses its own profit floor, never a prettier number.
      target=priced!.floorTarget;
      fallbacks.push(`TARGET_FROM_PROFIT_FLOOR:${target}`);
    }
    let computed:TradePlanCandidate|null=null;
    if(refusals.length===0&&priced){
      // SHADOW applies to uncalibrated reach probability, not to the system-owned ordinary target menu.
      // A model-selected target may not turn p90/hard-max/tail evidence into executable authority.
      if(priced.floorBeyondCeiling===true){
        statisticalEvidence.push(`SELECTION_TARGET_BEYOND_STATISTICAL_CEILING:units=${units},horizon=${horizon},floor=${priced.floorTarget},ceiling=${priced.statisticalTarget}`);
        refusals.push(`NO_FEASIBLE_TARGET_WITHIN_P75_REACHABILITY_BAND:floor=${priced.floorTarget},p75=${priced.statisticalTarget}`);
      }
      else{
        if(side==='LONG'?target+1e-12<priced.floorTarget:target-1e-12>priced.floorTarget){
          const reason=`CANDIDATE_TARGET_BELOW_PROFIT_FLOOR:target=${target},${side==='LONG'?'<':'>'}floor=${priced.floorTarget}`;
          refusals.push(reason);
        }
        else if(priced.statisticalTarget!=null&&(side==='LONG'?target>priced.statisticalTarget+1e-12:target<priced.statisticalTarget-1e-12)){
          statisticalEvidence.push(`CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND:target=${target},bound=${priced.statisticalTarget}`);
          refusals.push(`CANDIDATE_TARGET_BEYOND_P75_REACHABILITY_BAND:target=${target},p75=${priced.statisticalTarget}`);
        }
        if(refusals.length===0)computed=buildCandidate(units,horizon,target,[priced.p50Target,priced.p75Target].filter(finite) as number[],
          priced.reach.status==='READY'?'LEGACY_SELECTED_WITHIN_P75':'PROFIT_FLOOR_UNPROVEN',{p50:priced.p50Move,p75:priced.p75Move});
      }
    }
    if(computed&&!computed.executable)refusals.push(...computed.blockers);
    if(computed&&refusals.length===0){
      if(!kept.some(row=>row.candidateId===computed!.candidateId))kept.push(computed);
      selectionOutcome={offered:true,refusals:[],fallbacks,resolved:{quantityUnits:units,targetPrice:target,targetHorizonMinutes:horizon,candidateId:computed.candidateId}};
      selected=computed;
    }else selectionOutcome={offered:false,refusals:refusals.length?refusals:['SELECTION_NOT_OFFERED_UNSPECIFIED'],fallbacks};
    selectionRequest={quantityUnits:units,targetPrice:target,targetHorizonMinutes:horizon};
  }
  const bounds=horizons.map(horizon=>{const priced=targetFor(quantities[0],horizon);
    return{horizonMinutes:horizon,minTargetPrice:priced.floorTarget,maxTargetPrice:priced.statisticalTarget??null,status:priced.reach.status,sampleCount:priced.reach.sampleCount};});
  const published=selected?[...kept.filter(row=>row.candidateId!==selected!.candidateId),selected]:kept.slice(0,18);
  return{schemaVersion:'V397-PLAN-CANDIDATE-SET-2',symbol,side,createdAt:now,expiresAt:input.envelopeExpiresAt,factVersion:input.factVersion,
    candidateSetHash:stableId('cset_v2',{schemaVersion:'V397-PLAN-CANDIDATE-SET-2',symbol,side,identityFacts,
      candidates:published.map(({createdAt,...authorization})=>authorization),selection:selection?{...selectionRequest,...selectionOutcome}:null}),
    candidates:published,
    noTradeReasons:reasons,statisticalEvidence:[...new Set(statisticalEvidence)],quantityLadder:quantities,horizonLadder:horizons,rejectedCombinations:rejected,
    selection:selection?{...selectionRequest,...selectionOutcome}:undefined,feasibleQuantityUnits:{min:quantities[0],max:quantities[quantities.length-1]},
    bounds,entryTtlMinutes,managementDurationMs:input.managementDurationMs};
}

/**
 * The same generator with a resolver attached. `compute` re-runs the single implementation above with
 * the requested triple, so there is exactly one place where a candidate is ever arithmetic-ed - a
 * reviewer cannot be shown one number here and a different one there.
 */
export function createQuantityHorizonCandidates(input:Parameters<typeof buildQuantityHorizonCandidates>[0]){
  return{
    set:buildQuantityHorizonCandidates(input),
    compute:(request:{quantityUnits:number;targetHorizonMinutes:number;targetPrice:number})=>{
      const set=buildQuantityHorizonCandidates({...input,selection:request});
      const resolved=set.selection;
      if(!resolved?.offered)return{candidate:null,refusals:resolved?.refusals??['CANDIDATE_SET_UNAVAILABLE'],bounds:null};
      const candidate=set.candidates.find(row=>row.candidateId===resolved.resolved?.candidateId)??set.candidates.find(row=>row.quantityUnits===request.quantityUnits
        &&row.targetHorizonMinutes===request.targetHorizonMinutes&&Math.abs(row.targetPrice-request.targetPrice)<=1e-9)??null;
      const bounds=set.bounds?.find(row=>row.horizonMinutes===Math.trunc(request.targetHorizonMinutes))??null;
      return{candidate,refusals:candidate?[]:['CANDIDATE_NOT_COMPUTED'],bounds};
    },
  };
}

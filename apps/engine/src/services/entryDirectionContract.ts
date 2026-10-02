import type { BrainDecision, MarketSymbolSnapshot } from '@zdj/contracts';
import {createHash} from 'node:crypto';

export type TrendDirectionRole='SUPPORTS_LONG'|'SUPPORTS_SHORT'|'NEUTRAL';
export type AlignmentClass='ALIGNED_LONG'|'ALIGNED_SHORT'|'MIXED'|'COUNTER_TREND_REVERSAL';

import {directionFacts} from '@zdj/core';
export {directionFacts} from '@zdj/core';

export function validateDirectionContract(snapshot:MarketSymbolSnapshot,decision:BrainDecision){
  const facts=directionFacts(snapshot),side=decision.tradeSide??decision.direction;
  const factualMismatch=decision.trend1dRole!==facts.trend1dRole||decision.trend4hRole!==facts.trend4hRole||decision.trend15mRole!==facts.trend15mRole;
  if(factualMismatch)return{ok:false,reason:'DIRECTION_TIMEFRAME_ROLE_MISMATCH',facts,counterTrend:false,minimumCandidateRequired:false};
  const counterTrend=Boolean(side&&facts.strategicConsensus&&side!==facts.strategicConsensus);
  if(counterTrend){
    const exceptionValid=decision.counterTrendException===true&&decision.alignmentClass==='COUNTER_TREND_REVERSAL'&&Boolean(decision.counterTrendReason?.trim());
    return{ok:exceptionValid,reason:exceptionValid?null:'COUNTER_TREND_EXCEPTION_REQUIRED',facts,counterTrend:true,minimumCandidateRequired:true};
  }
  if(decision.counterTrendException||decision.alignmentClass==='COUNTER_TREND_REVERSAL')
    return{ok:false,reason:'COUNTER_TREND_EXCEPTION_NOT_APPLICABLE',facts,counterTrend:false,minimumCandidateRequired:false};
  if(decision.alignmentClass!==facts.baseAlignmentClass)
    return{ok:false,reason:'DIRECTION_ALIGNMENT_CLASS_MISMATCH',facts,counterTrend:false,minimumCandidateRequired:false};
  return{ok:true,reason:null,facts,counterTrend:false,minimumCandidateRequired:false};
}

export type EntryThesisSnapshot={
  capturedAt:number;last:number;atr15m:number;
  trend1m:string;trend5m:string;trend15m:string;trend4h:string;trend1d:string;
  asOf15m:number;asOf4h:number;asOf1d:number;
  /** Additional evidence is optional when reading a historical captured thesis. */
  evidenceVersion?:'V397-ENTRY-THESIS-1';symbol?:string;factFingerprint?:string;
  quote?:{last:number;mark:number;bid:number;ask:number;ts:number};
  roles?:ReturnType<typeof directionFacts>;
  bars?:Record<string,{asOf:number;barOpenTime:number|null;barCloseTime:number|null;receivedAt:number|null;
    isClosed:boolean;source:string;trend:string;atr14:number;lastClosedBar:MarketSymbolSnapshot['technical']['15m']['lastClosedBar']|null}>;
};

export function captureEntryThesis(snapshot:MarketSymbolSnapshot,now=Date.now()):EntryThesisSnapshot{
  const quote={last:snapshot.quote.last,mark:snapshot.quote.mark,bid:snapshot.quote.bid,ask:snapshot.quote.ask,ts:snapshot.quote.ts};
  const bars=Object.fromEntries((['1m','5m','15m','4h','1d'] as const).map(timeframe=>{
    const card=snapshot.technical[timeframe];
    return[timeframe,{asOf:card.asOf,barOpenTime:card.barOpenTime??null,barCloseTime:card.barCloseTime??null,
      receivedAt:card.receivedAt??null,isClosed:card.isClosed,source:card.source,trend:card.trend,atr14:card.atr14,
      lastClosedBar:card.lastClosedBar?{...card.lastClosedBar}:null}];
  }));
  const facts={symbol:snapshot.symbol,quote,bars};
  return{capturedAt:now,last:snapshot.quote.last,atr15m:snapshot.technical['15m'].atr14,
    trend1m:snapshot.technical['1m'].trend,trend5m:snapshot.technical['5m'].trend,trend15m:snapshot.technical['15m'].trend,
    trend4h:snapshot.technical['4h'].trend,trend1d:snapshot.technical['1d'].trend,
    asOf15m:snapshot.technical['15m'].asOf,asOf4h:snapshot.technical['4h'].asOf,asOf1d:snapshot.technical['1d'].asOf,
    evidenceVersion:'V397-ENTRY-THESIS-1',...facts,roles:directionFacts(snapshot),
    factFingerprint:createHash('sha256').update(JSON.stringify(facts)).digest('hex')};
}

export function entryThesisDrift(before:EntryThesisSnapshot,current:MarketSymbolSnapshot,acceptablePriceRange?:{min:number;max:number}|null,now=Date.now()){
  const reasons:string[]=[];
  const t=current.technical;
  const changedClosedBarTimeframes=([['1d',before.asOf1d],['4h',before.asOf4h],['15m',before.asOf15m]] as const).filter(([tf,asOf])=>t[tf].asOf!==asOf).map(([tf])=>tf);
  const changedStructureTimeframes=([['1d',before.trend1d],['4h',before.trend4h],['15m',before.trend15m]] as const).filter(([tf,trend])=>t[tf].trend!==trend).map(([tf])=>tf);
  const changedTimingTimeframes=([['1m',before.trend1m],['5m',before.trend5m]] as const).filter(([tf,trend])=>t[tf].trend!==trend).map(([tf])=>tf);
  if(changedClosedBarTimeframes.length)reasons.push('MATERIAL_CLOSED_BAR_CHANGED');
  if(changedStructureTimeframes.length)reasons.push('MATERIAL_STRUCTURE_TREND_CHANGED');
  if(changedTimingTimeframes.length)reasons.push('EXECUTION_TIMING_TREND_CHANGED');
  const atr=Math.max(Number(before.atr15m)||0,Number(t['15m'].atr14)||0);
  const absolutePriceDelta=Math.abs(current.quote.last-before.last),priceDeltaThreshold=.35*atr;
  const priceDriftExceeded=atr>0&&absolutePriceDelta>priceDeltaThreshold;
  if(priceDriftExceeded)reasons.push('ENTRY_LOCATION_DRIFT_GT_0_35_ATR');
  const beforeInside=acceptablePriceRange?before.last>=acceptablePriceRange.min&&before.last<=acceptablePriceRange.max:null;
  const currentOutside=acceptablePriceRange?current.quote.ask<acceptablePriceRange.min||current.quote.bid>acceptablePriceRange.max:null;
  if(beforeInside&&currentOutside)reasons.push('MARKET_LEFT_AUTHORIZED_ENTRY_RANGE');
  return{ok:reasons.length===0,reasons:[...new Set(reasons)],before,current:captureEntryThesis(current,now),
    diagnostics:{version:'V397-ENTRY-THESIS-DRIFT-1' as const,evaluatedAt:now,elapsedMs:now-before.capturedAt,
      changedClosedBarTimeframes,changedStructureTimeframes,changedTimingTimeframes,
      price:{beforeLast:before.last,currentLast:current.quote.last,currentBid:current.quote.bid,currentAsk:current.quote.ask,
        signedDelta:current.quote.last-before.last,absoluteDelta:absolutePriceDelta,beforeAtr15m:before.atr15m,currentAtr15m:t['15m'].atr14,
        atrUsed:atr,atrSelection:'MAX_BEFORE_CURRENT' as const,thresholdAtr:.35,thresholdPrice:priceDeltaThreshold,
        deltaAtr:atr>0?absolutePriceDelta/atr:null,comparison:'STRICT_GREATER_THAN' as const,enabled:atr>0,exceeded:priceDriftExceeded},
      authorizedRange:acceptablePriceRange?{...acceptablePriceRange}:null,beforeInsideAuthorizedRange:beforeInside,
      currentSpreadOutsideAuthorizedRange:currentOutside,marketLeftAuthorizedRange:Boolean(beforeInside&&currentOutside)}};
}

import type { EntryIntelligencePacket } from '@zdj/contracts';

/**
 * S07-A: the review request.
 *
 * A review is a different question from an entry, so it gets a different prompt: "given the plan this
 * position was opened under, is that plan still intact?" It is deliberately given no way to ask for a
 * new quantity, price or side, because the only thing an answer may change is whether the existing
 * plan's own invalidation has been satisfied.
 */

export const POSITION_REVIEW_DECISIONS = ['HOLD', 'REDUCE_PROPOSAL', 'EXIT_PROPOSAL', 'HANDOFF'] as const;
export type PositionReviewDecision = (typeof POSITION_REVIEW_DECISIONS)[number];

export type PositionReviewRequest = {
  symbol: string;
  cycleId: string;
  positionId: string;
  planRef: string;
  planVersion: number;
  reviewNumber: number;
  at: number;
  ownerVersion: number;
  triggerKey: string;
  factsHash: string;
  position: {
    side: string;
    entryPrice: number;
    quantity: number;
    markPrice: number | null;
    unrealizedPnlUsd: number | null;
    openedAt: number;
    managementDeadlineAt: number | null;
    remainingMs: number | null;
  };
  plan: {
    side: string;
    quantityUnits: number;
    entryReferencePrice: number;
    targetPrice: number;
    targetHorizonMinutes: number;
    thesis: string;
    invalidationPredicate: string;
    predicateEvidenceRefs: string[];
    minNetProfitUsd: number | null;
    maxRealizedLossUsd: number | null;
    economicMandate?: unknown | null;
  };
  budget: { normalReviewsPerPlan: number; exceptionReviewsPerPlan: number; used: number };
  memory: unknown;
};

/** Bounded, fact-only. Nothing here quotes a label as an answer or repeats raw candle series. */
export function buildPositionReviewPrompt(packet: EntryIntelligencePacket, request: PositionReviewRequest): string {
  // Position review has no entry execution envelope: synthesizing one here would make current
  // capacity/sizing facts look like authority over an already-open position. Keep this contract
  // strictly market + existing-plan facts and give each source a stable citation id.
  const frameNames=['1m','5m','15m','1h','4h','1d','1w'] as const;
  const referenceFrameNames=['15m','1h','4h','1d','1w'] as const;
  const technical=(rows:any,frames:readonly string[],prefix:string)=>Object.fromEntries(frames.flatMap(tf=>{
    const row=rows?.[tf];if(!row)return [];
    return [[tf,{factId:`${prefix}.${tf}.confirmed`,asOf:row.asOf,barCloseTime:row.barCloseTime??row.asOf,
      isClosed:row.isClosed!==false,source:row.source??'UNKNOWN',trend:row.trend,trendStrength:row.trendStrength,
      ema8:row.ema8,ema21:row.ema21,ema55:row.ema55,emaSlope21:row.emaSlope21,macdLine:row.macdLine,
      macdSignal:row.macdSignal,macdHistogram:row.macdHistogram,macdHistogramSlope:row.macdHistogramSlope,
      atr14:row.atr14,atrPercent:row.atrPercent,volumeZScore:row.volumeZScore,
      recentSwingLow:row.recentSwingLow,recentSwingHigh:row.recentSwingHigh,
      ...(row.lastClosedBar?{lastClosedBar:row.lastClosedBar}:{missingClosedBarAnchor:true})}]];
  }));
  const market=(name:string,source:any,frames:readonly string[],prefix:string)=>source?{
    symbol:source.symbol??(name==='symbol'?packet.symbol:name.toUpperCase()+'USDT'),
    quote:{factId:`${prefix}.quote`,source:'BINANCE_MARKET',ts:source.quote?.ts,bid:source.quote?.bid,ask:source.quote?.ask,
      last:source.quote?.last,mark:source.quote?.mark},
    technical:technical(source.technical,frames,prefix),
    ...(source.orderBook?{orderBook:{factId:`${prefix}.orderbook`,source:'BINANCE_ORDERBOOK',ts:source.orderBook.ts,
      bids:source.orderBook.bids?.slice(0,5),asks:source.orderBook.asks?.slice(0,5)}}:{}),
  }:{missing:true};
  const references=(packet as any).referenceMarkets??{};
  const facts={MARKET_FACTS:{symbol:market('symbol',packet.market,frameNames,'symbol'),
      btc:market('btc',references.btc,referenceFrameNames,'btc'),eth:market('eth',references.eth,referenceFrameNames,'eth')},
    PLAN_FACTS:{factId:'plan.current',planRef:request.planRef,planVersion:request.planVersion,side:request.plan.side,
      entryReferencePrice:request.plan.entryReferencePrice,targetPrice:request.plan.targetPrice,
      targetHorizonMinutes:request.plan.targetHorizonMinutes,thesis:request.plan.thesis,
      invalidationPredicate:request.plan.invalidationPredicate,predicateEvidenceRefs:request.plan.predicateEvidenceRefs,
      minNetProfitUsd:request.plan.minNetProfitUsd,maxRealizedLossUsd:request.plan.maxRealizedLossUsd,
      economicMandate:request.plan.economicMandate??null}};
  return `You are the independent Position Review brain under protocol V3.9.6. Question: is the TradePlan this position was opened under still intact?
You are advisory only. You have no order permission, no sizing permission and no authority to change ownership, deadlines, risk limits or the plan itself.
Answer exactly one of:
HOLD - the plan's thesis still stands and no cited fact satisfies its invalidation predicate.
REDUCE_PROPOSAL - evidence supports reducing exposure; this is advisory and cannot change quantity or submit an order.
EXIT_PROPOSAL - a supplied fact ID satisfies the plan's own invalidation predicate; a human decision gate will still run after you.
HANDOFF - the facts needed to judge this plan are no longer available or the situation is outside the plan; a human takes over management.
Never propose a new entry, a reversal, a side, a quantity, a limit price or a take-profit level; a response containing any of those fields is rejected as an authority violation.
An unresolved loss is not by itself an invalidation: the loss ceiling is a human-owned permission line, not a review trigger.
Cite only supplied MARKET_FACTS, PLAN_FACTS or MEMORY ids in evidenceRefs. Never invent evidence, prices, fills, probabilities or future outcomes.
The plan's stated net-profit floor and realized-loss permission are constraints you read, not numbers you may revise.
Return exactly one unfenced JSON object: {"decision":"HOLD|REDUCE_PROPOSAL|EXIT_PROPOSAL|HANDOFF","reason":"<short factual reason>","evidenceRefs":["<supplied id>"]}
REVIEW_ENVELOPE:${JSON.stringify(request)}
INPUT:${JSON.stringify(facts)}`;
}

export type PositionReviewVerdict = { decision: PositionReviewDecision; reason: string; evidenceRefs: string[] };

/**
 * Parsed fail-closed. Entry-shaped output is refused rather than reinterpreted, and an answer that
 * asks for an exit without a cited fact is refused, because that is exactly the case where a model
 * would otherwise talk a deterministic gate into doing something it was not authorized to do.
 */
export function parsePositionReview(value: unknown): PositionReviewVerdict {
  const v = value as any;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('REVIEW_OUTPUT_MALFORMED');
  const entryAuthority = ['tradeSide', 'quantityUnits', 'idealPrice', 'acceptablePriceRange', 'profitTakePlan', 'horizonMinutes', 'action']
    .filter(field => v[field] != null);
  if (entryAuthority.length) throw new Error(`REVIEW_OUTPUT_CARRIES_ENTRY_AUTHORITY:${entryAuthority.join(',')}`);
  if (!POSITION_REVIEW_DECISIONS.includes(v.decision)) throw new Error(`REVIEW_DECISION_UNSUPPORTED:${String(v.decision ?? 'missing')}`);
  if (typeof v.reason !== 'string' || !v.reason.trim()) throw new Error('REVIEW_REASON_MISSING');
  const evidenceRefs = (Array.isArray(v.evidenceRefs) ? v.evidenceRefs.map(String) : []).slice(0, 8);
  if (v.decision !== 'HOLD' && !evidenceRefs.length) throw new Error('REVIEW_EVIDENCE_MISSING');
  return { decision: v.decision, reason: v.reason.trim().slice(0, 400), evidenceRefs };
}

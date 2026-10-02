import { compactEntryFacts } from '@zdj/core';
import type { EntryIntelligencePacket } from '@zdj/contracts';

/**
 * S07-A: the review request.
 *
 * A review is a different question from an entry, so it gets a different prompt: "given the plan this
 * position was opened under, is that plan still intact?" It is deliberately given no way to ask for a
 * new quantity, price or side, because the only thing an answer may change is whether the existing
 * plan's own invalidation has been satisfied.
 */

export const POSITION_REVIEW_DECISIONS = ['HOLD', 'EXIT_PROPOSAL', 'HANDOFF'] as const;
export type PositionReviewDecision = (typeof POSITION_REVIEW_DECISIONS)[number];

export type PositionReviewRequest = {
  reviewMilestone?: 'THESIS_REVIEW' | 'TIME_STOP_DECISION';
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
    managementDeadlineAt: number;
    remainingMs: number;
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
  };
  budget: { normalReviewsPerPlan: number; exceptionReviewsPerPlan: number; used: number };
  /** Deterministic inputs for the 60/90 minute decision. UNKNOWN stays null/status rather than being
   * filled by the reviewer. None of these fields grants order authority. */
  decisionFacts?: {
    thesis: { invalid: boolean | null; predicate: string | null; evidenceRefs: string[] };
    reachability: { targetBasis: string | null; p50MovePercent: number | null; p75MovePercent: number | null;
      remainingMovePercent: number | null; withinP75Band: boolean | null; horizonRemainingMs: number };
    economics: { costVersion: string | null; expectedNetProfitUsd: number | null; requiredNetProfitUsd: number | null;
      remainingEdgeUsd: number | null; status: string };
    opportunityCost: { positionAgeMinutes: number; marginUsd: number | null; slotOccupied: true; timeStopDue: boolean };
  };
  memory: unknown;
};

/** Bounded, fact-only. Nothing here quotes a label as an answer or repeats raw candle series. */
export function buildPositionReviewPrompt(packet: EntryIntelligencePacket, request: PositionReviewRequest): string {
  const facts = compactEntryFacts(packet);
  return `You are the independent Position Review brain under protocol V3.9.7. Question: is the TradePlan this position was opened under still intact?
You are advisory only. You have no order permission, no sizing permission and no authority to change ownership, deadlines, risk limits or the plan itself.
THESIS_REVIEW is the scheduled 60-minute reconsideration. TIME_STOP_DECISION is the bounded 90-minute decision point, not an instruction to market-close. At either milestone, weigh the supplied invalidation, remaining reachability, fee-adjusted remaining edge and occupied-capital opportunity cost together. Null/UNKNOWN facts must lead to HANDOFF when they are necessary for the judgment; never invent them.
Answer exactly one of:
HOLD - the plan's thesis still stands and no cited fact satisfies its invalidation predicate.
EXIT_PROPOSAL - a supplied fact ID satisfies the plan's own invalidation predicate; a human decision gate will still run after you.
HANDOFF - the facts needed to judge this plan are no longer available or the situation is outside the plan; a human takes over management.
Never propose a new entry, a reversal, a side, a quantity, a limit price or a take-profit level; a response containing any of those fields is rejected as an authority violation.
An unresolved loss is not by itself an invalidation: the loss ceiling is a human-owned permission line, not a review trigger.
Cite only supplied MARKET_FACTS, PLAN_FACTS or MEMORY ids in evidenceRefs. Never invent evidence, prices, fills, probabilities or future outcomes.
The plan's stated net-profit floor and realized-loss permission are constraints you read, not numbers you may revise.
Return exactly one unfenced JSON object: {"decision":"HOLD|EXIT_PROPOSAL|HANDOFF","reason":"<short factual reason>","evidenceRefs":["<supplied id>"]}
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

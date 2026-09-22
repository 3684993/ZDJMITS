import { z } from 'zod';

/**
 * S06/J3: the immutable trade plan.
 *
 * The plan is the artefact that makes an entry auditable after the fact: it records which
 * system-generated candidate was chosen, what the model believed, what the cost and risk facts said
 * at that moment, and the three different time limits that apply to it. The model never authors any
 * of the executable numbers - it selects a candidate id or waits - so a plan can always be recomputed
 * from the facts it cites. Once persisted, the plan is never rewritten to match what happened; the
 * divergence is recorded beside it.
 */

export const PlanEvidenceStatusSchema = z.enum(['VERIFIED', 'INSUFFICIENT_SAMPLE', 'UNPROVEN', 'CONFLICT', 'STALE', 'NOT_APPLICABLE']);
export type PlanEvidenceStatus = z.infer<typeof PlanEvidenceStatusSchema>;

/** Only pre-registered comparisons may invalidate a thesis; no expression from a model is evaluated. */
export const InvalidationPredicateSchema = z.enum([
  'CLOSED_BAR_BREAKS_LEVEL',
  'STRUCTURE_EVIDENCE_WITHDRAWN',
  'EXTERNAL_FACT_EXPIRED',
  'PLAN_HORIZON_ELAPSED',
  'NO_PREDICATE',
]);
export type InvalidationPredicate = z.infer<typeof InvalidationPredicateSchema>;

const money = z.number().finite();
const price = z.number().finite().positive();

export const TradePlanCostsSchema = z.object({
  entryFeeUsd: money,
  exitFeeUsd: money,
  slippageUsd: money,
  uncertaintyBufferUsd: money,
  fundingEstimateUsd: money,
  fundingStatus: PlanEvidenceStatusSchema,
  fxRateToQuote: z.number().finite().nullable(),
  costVersion: z.string().min(1).max(120),
}).strict();
export type TradePlanCosts = z.infer<typeof TradePlanCostsSchema>;

/**
 * Two different questions, therefore two different fields: what the cycle nets *if* the target is
 * reached, and the expectation over the whole horizon. A missing statistical sample stays a status,
 * never a number, and no field here may be filled in from model confidence.
 */
export const TradePlanEconomicsSchema = z.object({
  targetConditionalNetProfitUsd: z.number().finite().nullable(),
  targetConditionalNetProfitStatus: PlanEvidenceStatusSchema,
  expectedNetPnlAtHorizonUsd: z.number().finite().nullable(),
  expectedNetPnlAtHorizonStatus: PlanEvidenceStatusSchema,
  reachProbability: z.number().min(0).max(1).nullable(),
  reachProbabilityStatus: PlanEvidenceStatusSchema,
  reachSampleCount: z.number().int().nonnegative(),
  historicalHardMaxMovePercent: z.number().finite().nullable(),
  targetMovePercent: z.number().finite().nonnegative(),
  statisticalSource: z.string().max(160).nullable(),
  modelConfidence: z.number().finite().nullable(),
  modelConfidenceIsAuthority: z.literal(false),
}).strict();
export type TradePlanEconomics = z.infer<typeof TradePlanEconomicsSchema>;

export const TradePlanRiskSchema = z.object({
  capitalAtRiskUsd: money,
  grossNotionalAfterUsd: money,
  longNotionalAfterUsd: money,
  shortNotionalAfterUsd: money,
  clusterNotionalAfterUsd: money,
  limitingConstraints: z.array(z.string().max(80)).max(24),
  riskGeneration: z.number().int().positive(),
  snapshotHash: z.string().regex(/^v396r[0-9a-f]{32,}$/),
  profileVersion: z.string().min(8).max(120),
  humanSlotsAfter: z.number().int().nonnegative(),
}).strict();
export type TradePlanRisk = z.infer<typeof TradePlanRiskSchema>;

export const TradePlanCandidateSchema = z.object({
  schemaVersion: z.literal('V396-PLAN-CANDIDATE-1').default('V396-PLAN-CANDIDATE-1'),
  candidateId: z.string().min(8).max(120),
  symbol: z.string().min(1).max(40),
  side: z.enum(['LONG', 'SHORT']),
  quantityUnits: z.number().int().positive(),
  quantitySteps: z.number().int().positive(),
  notionalUsd: money.nonnegative(),
  marginUsd: money.nonnegative(),
  leverage: z.number().int().positive(),
  entryReferencePrice: price,
  targetPrice: price,
  acceptableTargetRange: z.object({ min: price, max: price }).strict(),
  entryTtlMinutes: z.number().int().min(1).max(60),
  targetHorizonMinutes: z.number().int().min(5).max(1440),
  managementDurationMs: z.number().int().positive(),
  costs: TradePlanCostsSchema,
  economics: TradePlanEconomicsSchema,
  risk: TradePlanRiskSchema,
  evidenceRefs: z.array(z.string().max(160)).max(12),
  executable: z.boolean(),
  blockers: z.array(z.string().max(160)).max(24),
  createdAt: z.number().int().nonnegative(),
}).strict();
export type TradePlanCandidate = z.infer<typeof TradePlanCandidateSchema>;

export const TradePlanProvenanceSchema = z.object({
  modelRunId: z.string().max(160).nullable(),
  promptVersion: z.string().max(80).nullable(),
  factVersion: z.string().min(1).max(160),
  envelopeExpiresAt: z.number().int().positive(),
  candidateSetHash: z.string().min(8).max(120),
  createdAt: z.number().int().nonnegative(),
  source: z.enum(['AI', 'HUMAN', 'SYSTEM']),
}).strict();
export type TradePlanProvenance = z.infer<typeof TradePlanProvenanceSchema>;

export const TradePlanSchema = z.object({
  schemaVersion: z.literal('V396-TRADE-PLAN-1').default('V396-TRADE-PLAN-1'),
  planId: z.string().min(8).max(120),
  planVersion: z.number().int().positive(),
  supersedesPlanId: z.string().max(120).nullable().default(null),
  cycleId: z.string().min(1).max(160),
  scope: z.string().min(4).max(400),
  symbol: z.string().min(1).max(40),
  side: z.enum(['LONG', 'SHORT', 'WAIT']),
  /** The system candidate this plan matched. The model never supplies this; the engine derives it. */
  selectedCandidateId: z.string().max(120).nullable(),
  quantityUnits: z.number().int().nonnegative(),
  notionalUsd: money.nonnegative(),
  marginUsd: money.nonnegative(),
  leverage: z.number().int().positive(),
  entryReferencePrice: z.number().finite().nullable(),
  targetPrice: z.number().finite().nullable(),
  acceptableTargetRange: z.object({ min: price, max: price }).nullable(),
  entryTtlMinutes: z.number().int().min(1).max(60),
  targetHorizonMinutes: z.number().int().min(5).max(1440),
  managementDurationMs: z.number().int().positive(),
  thesis: z.string().min(1).max(600),
  invalidationPredicate: InvalidationPredicateSchema,
  predicateLevel: z.number().finite().nullable(),
  predicateEvidenceRefs: z.array(z.string().max(160)).max(12),
  counterEvidenceRefs: z.array(z.string().max(160)).max(12),
  releaseCondition: z.string().max(600).nullable(),
  costs: TradePlanCostsSchema.nullable(),
  economics: TradePlanEconomicsSchema.nullable(),
  risk: TradePlanRiskSchema.nullable(),
  minNetProfitUsd: money,
  maxRealizedLossUsd: money.nonnegative(),
  provenance: TradePlanProvenanceSchema,
  persistedAt: z.number().int().nonnegative(),
  immutable: z.literal(true),
})
  .strict()
  .superRefine((plan, ctx) => {
    // A WAIT carries no executable authority at all: no size, no candidate, no target.
    if (plan.side === 'WAIT') {
      if (plan.quantityUnits !== 0 || plan.notionalUsd !== 0 || plan.marginUsd !== 0)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'WAIT_PLAN_CARRIES_EXECUTABLE_QUANTITY' });
      if (plan.selectedCandidateId !== null || plan.targetPrice !== null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'WAIT_PLAN_CARRIES_TARGET_AUTHORITY' });
    } else {
      if (!plan.selectedCandidateId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PLAN_SELECTION_REQUIRED' });
      if (plan.quantityUnits <= 0 || plan.notionalUsd <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PLACE_PLAN_QUANTITY_MISSING' });
      if (plan.targetPrice === null || plan.entryReferencePrice === null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PLACE_PLAN_PRICES_MISSING' });
      if (plan.targetPrice !== null && plan.entryReferencePrice !== null) {
        const reachable = plan.side === 'LONG' ? plan.targetPrice > plan.entryReferencePrice : plan.targetPrice < plan.entryReferencePrice;
        if (!reachable) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TARGET_ON_WRONG_SIDE_OF_ENTRY' });
      }
    }
    // The three horizons are different things and are checked as such. An entry that outlives its
    // own thesis, or an AI authority shorter than the horizon it is managing toward, is a mis-fill.
    if (plan.entryTtlMinutes > plan.targetHorizonMinutes)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ENTRY_TTL_EXCEEDS_TARGET_HORIZON' });
    if (plan.managementDurationMs < plan.targetHorizonMinutes * 60_000)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MANAGEMENT_DEADLINE_SHORTER_THAN_TARGET_HORIZON' });
    if (plan.invalidationPredicate !== 'NO_PREDICATE' && plan.side !== 'WAIT' && !plan.predicateEvidenceRefs.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PREDICATE_EVIDENCE_MISSING' });
  });
export type TradePlan = z.infer<typeof TradePlanSchema>;

/**
 * What actually happened, recorded beside the plan. The plan itself is never edited to fit the
 * outcome, so a later review can still tell the prediction apart from the fill.
 */
export const ExecutedPlanRecordSchema = z.object({
  schemaVersion: z.literal('V396-PLAN-EXECUTION-1').default('V396-PLAN-EXECUTION-1'),
  planId: z.string().min(8).max(120),
  planVersion: z.number().int().positive(),
  cycleId: z.string().min(1).max(160),
  intentId: z.string().max(160).nullable(),
  reservationId: z.string().max(160).nullable(),
  orderId: z.string().max(160).nullable(),
  plannedEntryPrice: z.number().finite().nullable(),
  actualEntryPrice: z.number().finite().nullable(),
  plannedQuantityUnits: z.number().int().nonnegative(),
  executedQuantityUnits: z.number().int().nonnegative(),
  priceDeviationUsd: money,
  quantityDeviationUnits: z.number().int(),
  feeActualUsd: z.number().finite().nullable(),
  fundingStatusAtFill: PlanEvidenceStatusSchema,
  predictionMutated: z.literal(false),
  recordedAt: z.number().int().nonnegative(),
  source: z.enum(['SYSTEM_FILL', 'RECONCILIATION', 'MANUAL', 'PARTIAL_FILL']),
}).strict();
export type ExecutedPlanRecord = z.infer<typeof ExecutedPlanRecordSchema>;

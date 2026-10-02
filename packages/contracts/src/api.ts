import { z } from 'zod';
import { AiResourceSchema, AiRunSchema } from './ai.js';
import { EntryIntelligencePacketSchema } from './eip.js';
import { SystemSettingsSchema } from './settings.js';
import { EntryOrderSchema, PositionSchema, TakeProfitOrderSchema } from './trading.js';
import { PoolItemSchema, UniverseCandidateSchema } from './universe.js';
import { PortfolioExposureSchema } from './portfolio.js';
import { RuntimeControlStateSchema } from './runtimeControl.js';

export const ServiceHealthSchema = z.object({
  id: z.string(), label: z.string(), status: z.enum(['HEALTHY','DEGRADED','OFFLINE']), detail: z.string(), updatedAt: z.number().int(),
});
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

const CandidateBlockerCategorySchema=z.enum(['SUPPLY','CAPITAL','CAPACITY','RISK','MARKET','GOVERNANCE','AI']);
export const CandidateSupplyHealthSchema=z.object({
  semanticVersion:z.string(),activeCohortCount:z.number().int().nonnegative(),activeCohortSemantic:z.string(),residentCount:z.number().int().nonnegative(),pipelineReadyCount:z.number().int().nonnegative(),executionReadyCount:z.number().int().nonnegative(),capitalExecutableCount:z.number().int().nonnegative(),poolResidentCount:z.number().int().nonnegative(),poolReadyCount:z.number().int().nonnegative(),poolWaitingCount:z.number().int().nonnegative(),consumedCount:z.number().int().nonnegative(),zombieSnapshotCount:z.number().int().nonnegative(),zombieSnapshots:z.array(z.string()),readyZeroReason:CandidateBlockerCategorySchema.nullable(),blockerCategories:z.record(CandidateBlockerCategorySchema,z.number().int().nonnegative()),topBlockers:z.array(z.object({reason:z.string(),count:z.number().int().nonnegative(),category:CandidateBlockerCategorySchema})),
});
export type CandidateSupplyHealth=z.infer<typeof CandidateSupplyHealthSchema>;

export const DashboardSnapshotSchema = z.object({
  ts: z.number().int(),
  snapshotVersion: z.number().int().nonnegative().optional(),
  asOf: z.number().int().optional(),
  reconciliation: z.object({state:z.enum(['SETTLED','RUNNING','DEGRADED']),verifiedOrderFactMismatchCount:z.number().int().nonnegative().default(0)}).optional(),
  account: z.object({
    status: z.enum(['NOT_CONFIGURED','SYNCING','READY','STALE','UNAVAILABLE']), source: z.string(), asOf: z.number().int().nullable(), reason: z.string().nullable(),
    equityUsd: z.number().nullable(), availableUsd: z.number().nullable(), walletBalanceUsd: z.number().nullable(), unrealizedPnlUsd: z.number().nullable(), realizedPnlUsd24h: z.number().nullable(),
    assets:z.array(z.object({asset:z.string(),walletBalance:z.number(),availableBalance:z.number(),crossWalletBalance:z.number().nullable(),unrealizedPnl:z.number(),usdValue:z.number().nullable(),marginEligible:z.boolean()})),
    activePositions: z.number().int(), pendingEntries: z.number().int(), activeEntryOrders:z.number().int().optional(), activeTpOrders:z.number().int().optional(),
  }),
  universe: z.object({ total: z.number().int(), eligible: z.number().int(), topN: z.number().int(), generation:z.number().int().nonnegative().optional() }),
  supply: z.object({
    cohort:z.object({status:z.literal('NOT_ESTABLISHED'),memberCount:z.number().int().nonnegative().nullable()}),
    retention:z.object({status:z.literal('NOT_INVENTORIED'),zombieSnapshotCount:z.number().int().nonnegative().nullable()}),
    counts:z.record(z.string(),z.number().int().nonnegative().nullable()),
    target:z.number().int().nonnegative(),lowWatermark:z.number().int().nonnegative(),rootBlocker:z.enum(['SUPPLY','CAPITAL','CAPACITY','RISK','MARKET','GOVERNANCE','AI']).nullable(),reasonCounts:z.record(z.string(),z.number().int().nonnegative()),poolCount:z.number().int().nonnegative(),readyCount:z.number().int().nonnegative(),qualifiedSupply:z.number().int().nonnegative(),readySupply:z.number().int().nonnegative(),targetGap:z.number().int().nonnegative(),supplyShortage:z.boolean(),refillFailure:z.boolean(),belowLowWatermark:z.boolean(),
  }).optional(),
  candidateSupply:CandidateSupplyHealthSchema.optional(),
  pool: z.array(PoolItemSchema),
  positions: z.array(PositionSchema),
  entryOrders: z.array(EntryOrderSchema),
  entryOrderReadback:z.object({status:z.enum(['READY','STALE','UNAVAILABLE']),verifiedAt:z.number().nullable(),validUntil:z.number().nullable()}).optional(),
  tpOrders: z.array(TakeProfitOrderSchema),
  aiResources: z.array(AiResourceSchema),
  recentAiRuns: z.array(AiRunSchema),
  health: z.array(ServiceHealthSchema),
  readiness: z.object({overall:z.enum(['READY','READ_ONLY','NEEDS_CONFIGURATION','DEGRADED','OFFLINE']), privateDataStatus:z.enum(['NOT_CONFIGURED','SYNCING','READY','STALE','UNAVAILABLE']), reason:z.string().nullable()}),
  settings: SystemSettingsSchema,
  tradeNetPnl: z.number().nullable().optional(), tradeCompletedCount:z.number().int().nonnegative().optional(), tradeTradingNetExFunding:z.number().nullable().optional(), tradeCompletedExFundingCount:z.number().int().nonnegative().optional(), tradeFundingUnknownCount:z.number().int().nonnegative().optional(), tradeActivity:z.record(z.string(),z.unknown()).optional(),
  exchangeFillFacts:z.object({entryFillsLast1h:z.number().int().nonnegative(),exitFillsLast1h:z.number().int().nonnegative(),closedTradesLast1h:z.number().int().nonnegative(),netPnlLast1h:z.number(),exchangeFillsLast1h:z.number().int().nonnegative(),attributedFillsLast1h:z.number().int().nonnegative(),unattributedFillsLast1h:z.number().int().nonnegative(),externalFillsLast1h:z.number().int().nonnegative(),systemFillAttributionGapLast1h:z.number().int().nonnegative(),systemFillParityAlert:z.boolean(),tradeRecordLag:z.number().int().nonnegative(),fillsByProvenanceLast1h:z.record(z.string(),z.number().int().nonnegative()).optional()}).optional(),
  /**
   * P2/P7 read-side. The cycle/lot ledger, the exit-convergence queue and the decomposed engine
   * health are each their own fact group, because one aggregate "SETTLED" label hid cross-store drift.
   */
  positionCycleFacts:z.object({records:z.number().int().nonnegative(),lotsRecorded:z.number().int().nonnegative(),ledgerInconsistent:z.number().int().nonnegative(),unconserved:z.number().int().nonnegative(),lotAllocation:z.record(z.string(),z.number().int().nonnegative())}).optional(),
  exitConvergence:z.object({available:z.boolean(),reason:z.string().nullable().optional(),evaluatedAt:z.number().int().nullable().optional(),openTasks:z.number().int().nonnegative().optional(),eligibleNow:z.number().int().nonnegative().optional(),neverPolled:z.number().int().nonnegative().optional(),oldestUnpolledAgeMs:z.number().nonnegative().optional(),nextEligibleAt:z.number().nullable().optional(),terminalUnreleasedClaims:z.number().int().nonnegative().optional(),unreleasedClaims:z.number().int().nonnegative().optional(),batchLimit:z.number().int().positive().optional(),intervalMs:z.number().int().positive().optional(),maxServiceIntervalMs:z.number().nonnegative().optional(),nominalServiceIntervalMs:z.number().nonnegative().optional(),queryDeadlineMs:z.number().nonnegative().optional(),serviceBoundBasis:z.string().optional(),fullWalkRounds:z.number().int().nonnegative().optional(),fairness:z.string().optional(),
    /** Why the walk did or did not poll on its last turn: a stopped queue must name its own cause. */
    passGate:z.object({at:z.number().nullable().optional(),reason:z.string().nullable().optional(),due:z.boolean().optional(),attempted:z.number().int().nonnegative().nullable().optional(),inFlight:z.boolean().optional()}).nullable().optional()}).optional(),
  executionTruth:z.object({
    evaluatedAt:z.number().int(),
    /** Each check answers one question; none of them may stand in for the others. */
    exchangeIngestion:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),detail:z.string().nullable()}),
    orderTerminalParity:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),mismatchCount:z.number().int().nonnegative(),detail:z.string().nullable()}),
    exitClaimConvergence:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),openTasks:z.number().int().nonnegative(),terminalUnreleasedClaims:z.number().int().nonnegative(),oldestUnpolledAgeMs:z.number().nonnegative(),detail:z.string().nullable()}),
    takeProfitCoverage:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),required:z.number().int().nonnegative(),protected:z.number().int().nonnegative(),missing:z.number().int().nonnegative(),unresolved:z.number().int().nonnegative(),detail:z.string().nullable()}),
    positionCoverage:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),local:z.number().int().nonnegative(),remote:z.number().int().nonnegative(),detail:z.string().nullable()}),
    fillCycleConservation:z.object({status:z.enum(['HEALTHY','DEGRADED','UNKNOWN']),ledgerInconsistent:z.number().int().nonnegative(),unconserved:z.number().int().nonnegative(),conserved:z.number().int().nonnegative().optional(),openConserved:z.number().int().nonnegative().optional(),unproven:z.number().int().nonnegative().optional(),detail:z.string().nullable()}),
    fundingCoverage:z.object({status:z.enum(['HEALTHY','PARTIAL','UNKNOWN']),recordsWithExactFunding:z.number().int().nonnegative(),recordsUnknown:z.number().int().nonnegative(),incomeRows:z.number().int().nonnegative(),coverageComplete:z.boolean(),lastSync:z.object({at:z.number().nullable(),rows:z.number().int().nonnegative().nullable(),failures:z.number().int().nonnegative().nullable(),symbolsScanned:z.number().int().nonnegative().nullable(),skipped:z.string().nullable()}).nullable().optional(),detail:z.string().nullable()}),
    reviewAuthority:z.object({status:z.enum(['HEALTHY','DISABLED','DEGRADED','UNKNOWN']),enabled:z.boolean(),aiActiveCycles:z.number().int().nonnegative(),scheduledDue:z.number().int().nonnegative(),
      /** The last review attempt as facts, not as a label: when, what it decided, and why it stopped. */
      lastOutcome:z.object({lastTickAt:z.number().nullable(),lastVerdictAt:z.number().nullable(),lastDecision:z.string().nullable(),lastReason:z.string().nullable(),
        usable:z.boolean(),enabled:z.boolean(),considered:z.number().int().nonnegative(),reserved:z.number().int().nonnegative(),completed:z.number().int().nonnegative(),
        discarded:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),due:z.number().int().nonnegative(),exhausted:z.number().int().nonnegative(),
        failureBlocked:z.number().int().nonnegative(),skippedReason:z.string().nullable()}).nullable().optional(),
      detail:z.string().nullable(),
      /** P6: how the shared Primary endpoint is being divided between Entry and Review. */
      reviewFairness:z.object({reservationMs:z.number().int().positive(),reviewCapacitySharePercent:z.number().min(0).max(50),
        reviewOwedSince:z.number().nullable(),reviewOwedWaitMs:z.number().nonnegative(),
        windowServes:z.number().int().nonnegative(),windowReviews:z.number().int().nonnegative(),
        reviewShareUsedPercent:z.number().nonnegative(),heldForReview:z.boolean()}).nullable().optional()}),
    /** P6: per-cycle review obligation, stated as last review / next due / failures / why skipped. */
    reviewCycles:z.array(z.object({cycleId:z.string(),scope:z.string(),used:z.number().int().nonnegative(),limit:z.number().int().nonnegative(),failures:z.number().int().nonnegative(),
      lastReviewAt:z.number().nullable(),nextDueAt:z.number().nullable(),lastOutcome:z.string().nullable(),skippedReason:z.string().nullable()})).optional(),
    /** Active commissions are split by what actually proves them, never summed into one number. */
    activeCommissions:z.object({remoteConfirmedEntry:z.number().int().nonnegative(),remoteConfirmedTakeProfit:z.number().int().nonnegative(),manual:z.number().int().nonnegative(),localUnresolvedUnknown:z.number().int().nonnegative()}),
  }).optional(),
  portfolioIntelligence: PortfolioExposureSchema.extend({availableUsdt:z.number().nullable(),availableUsdc:z.number().nullable(),riskTierDistribution:z.record(z.string(),z.number()),directionPolicyDistribution:z.record(z.string(),z.number()),recentAllocationPlans:z.number().int().nonnegative()}).optional(),
  runtimeControl: RuntimeControlStateSchema.optional(),
  externalResearch:z.record(z.string(),z.unknown()).optional(),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

export const UniverseResponseSchema = z.object({ generation: z.number().int(), candidates: z.array(UniverseCandidateSchema) });
export const PoolResponseSchema = z.object({ items: z.array(PoolItemSchema) });
export const EipResponseSchema = z.object({ packet: EntryIntelligencePacketSchema });

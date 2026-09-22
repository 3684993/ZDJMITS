import { z } from 'zod';

export const EntryProtectionModeSchema = z.enum(['OFF', 'SHADOW', 'REQUIRED']);
export type EntryProtectionMode = z.infer<typeof EntryProtectionModeSchema>;

export const EntrySafetyModeSchema = z.enum(['SAFETY_REVIEW_PAUSED', 'SHADOW', 'SHADOW_READY', 'AUTO']);
export type EntrySafetyMode = z.infer<typeof EntrySafetyModeSchema>;

export const ShadowObservationSettingsSchema = z.object({
  quoteTtlMs: z.number().int().positive().default(20_000),
  bookTtlMs: z.number().int().positive().default(20_000),
  klineTtlMs: z.number().int().positive().default(125_000),
  accountTtlMs: z.number().int().positive().default(45_000),
  reconnectGraceMs: z.number().int().nonnegative().default(30_000),
  aiEnabled: z.boolean().default(true),
  aiMaxRunsPerMinute: z.number().int().min(0).max(30).default(2),
  aiQueueLimit: z.number().int().min(0).max(100).default(8),
  aiSamplingRatio: z.number().min(0).max(1).default(.25),
  markRetentionDays: z.number().int().min(1).max(90).default(30),
  posteriorMinSamples: z.number().int().min(1).max(1000).default(1),
}).default({});
export type ShadowObservationSettings = z.infer<typeof ShadowObservationSettingsSchema>;

/** AI exit authority is a separate, default-OFF permission; it is never implied by AI entry. */
export const AiExitAuthoritySchema = z.enum(['OFF', 'SHADOW', 'ENFORCE']);
export type AiExitAuthority = z.infer<typeof AiExitAuthoritySchema>;

export const ExitCoordinationSettingsSchema = z.object({
  aiExitAuthority: AiExitAuthoritySchema.default('OFF'),
  /**
   * AI realized net-loss permission line for one cycle, in USDT. It is the line at which the AI
   * loses the authority to decide, not an account loss cap, and a human may only tighten it.
   */
  aiExitLossLimitUsd: z.number().min(0).max(10).default(10),
  /** Independent AI profit floor. The TP economics floor is never borrowed as an AI permission. */
  aiExitMinNetProfitUsd: z.number().positive().max(1_000).default(0.2),
  /** Small-loss exits are refused until a human enables them explicitly. */
  aiExitAllowSmallLoss: z.boolean().default(false),
  aiExitAuthorizationTtlMs: z.number().int().min(1_000).max(30_000).default(15_000),
  continuousConvergenceEnabled: z.boolean().default(true),
  convergenceIntervalMs: z.number().int().min(30_000).max(3_600_000).default(120_000),
  convergenceBatchLimit: z.number().int().min(1).max(20).default(8),
}).default({});
export type ExitCoordinationSettings = z.infer<typeof ExitCoordinationSettingsSchema>;

/**
 * Portfolio risk admission profile. Every limit is explicit and unit-annotated, and the whole
 * block is unconfigured by default: an unconfigured profile must refuse new risk instead of
 * silently producing a tradable headroom.
 */
export const PortfolioRiskProfileSettingsSchema = z.object({
  configured: z.boolean().default(false),
  maxCapitalAtRiskUsd: z.number().nonnegative().default(0),
  maxDrawdownPct: z.number().min(0).max(1).default(0),
  maxStressLossUsd: z.number().nonnegative().default(0),
  maxGrossNotionalUsd: z.number().nonnegative().default(0),
  maxDirectionNotionalUsd: z.number().nonnegative().default(0),
  maxClusterNotionalUsd: z.number().nonnegative().default(0),
  minMarginBufferPct: z.number().min(0).max(1).default(0),
  minLiquidationBufferPct: z.number().min(0).max(1).default(0),
  maxHumanPositions: z.number().int().nonnegative().default(0),
  maxHumanNotionalUsd: z.number().nonnegative().default(0),
  maxPendingHandoffs: z.number().int().nonnegative().default(0),
  maxAckAgeMs: z.number().int().nonnegative().default(0),
  correlationVersion: z.string().default(''),
  clusters: z.record(z.string()).default({}),
  scenarioVersion: z.string().default(''),
  scenarios: z.array(z.object({
    id: z.string(),
    priceShockPct: z.number(),
    spreadWidenPct: z.number().min(0).max(1),
    fundingShockPct: z.number().min(0).max(1),
    markBasisShockPct: z.number(),
    depthPenaltyPct: z.number().min(0).max(1),
    exchangeUnavailable: z.boolean().default(false),
    unavailablePenaltyPct: z.number().min(0).max(1).default(0),
    clusterConvergencePct: z.number().min(0).max(1),
  })).default([]),
}).default({});
export type PortfolioRiskProfileSettings = z.infer<typeof PortfolioRiskProfileSettingsSchema>;

export const RiskGovernanceSettingsSchema = z.object({
  entrySafetyMode: EntrySafetyModeSchema.default('SAFETY_REVIEW_PAUSED'),
  protectionMode: EntryProtectionModeSchema.default('SHADOW'),
  requirePostAiVerification: z.boolean().default(true),
  failClosedOnMissingEvidence: z.boolean().default(true),
  requiredEvidenceCompleteness: z.number().min(0).max(1).default(.92),
  maxDailyLossUsd: z.number().nonnegative().default(0),
  maxDailyLossPct: z.number().nonnegative().max(1).default(0),
  maxConcurrentReservations: z.number().int().min(1).max(100).default(6),
  reservationTtlSeconds: z.number().int().min(30).max(3600).default(300),
  lockLeaseSeconds: z.number().int().min(15).max(3600).default(120),
  circuitBreakerEnabled: z.boolean().default(true),
  perTradeRiskPctEquity: z.number().nonnegative().max(1).default(0.01),
  maxGrossExposurePct: z.number().positive().max(20).default(1),
  maxDirectionExposurePct: z.number().positive().max(20).default(.5),
  maxClusterExposurePct: z.number().positive().max(20).default(.35),
  maxClusterDirectionExposurePct: z.number().positive().max(20).default(.35),
  maxDailyDrawdownPct: z.number().nonnegative().max(1).default(.05),
  highRiskReviewEnabled: z.boolean().default(true),
  highRiskEvidenceThreshold: z.number().min(0).max(1).default(.95),
  shadowDurationDays: z.number().int().min(1).max(30).default(7),
  protectionShadowEnabled: z.boolean().default(true),
  shadow: ShadowObservationSettingsSchema,
  exitCoordination: ExitCoordinationSettingsSchema,
  portfolioRisk: PortfolioRiskProfileSettingsSchema,
}).default({});
export type RiskGovernanceSettings = z.infer<typeof RiskGovernanceSettingsSchema>;

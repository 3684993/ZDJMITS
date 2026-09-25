import { z } from 'zod';
import { EntrySafetyModeSchema } from './riskGovernance.js';

export const RuntimeModeSchema=z.enum(['RUNNING','PAUSED_MANUAL','PAUSED_NO_CAPITAL','PAUSED_NO_EXECUTABLE_CONTRACT','PAUSED_DAILY_RISK_LIMIT','DEGRADED']);
export type RuntimeMode=z.infer<typeof RuntimeModeSchema>;

export const RuntimeReasonCodeSchema=z.enum([
  'NONE','MANUAL_PAUSE','MANUAL_RESUME','NO_CAPITAL','NO_EXECUTABLE_CONTRACT','PRIVATE_NOT_READY','MARKET_NOT_READY',
  'MIN_EXECUTABLE_CANDIDATES_NOT_MET','AUTO_RESUMED','DAILY_RISK_LIMIT','MANUAL_RISK_OVERRIDE','DEGRADED',
]);
export type RuntimeReasonCode=z.infer<typeof RuntimeReasonCodeSchema>;

export const RuntimeControlSettingsSchema=z.object({
  autoPauseOnNoCapital:z.boolean().default(true),
  autoResumeOnCapital:z.boolean().default(true),
  minExecutableCandidates:z.number().int().min(0).max(30).default(1),
  capitalCheckIntervalSeconds:z.number().int().min(15).max(300).default(30),
});
export type RuntimeControlSettings=z.infer<typeof RuntimeControlSettingsSchema>;

/**
 * What one side's allocation plan actually said. A side that was never sized, a side that was sized and
 * refused, and a side whose size is below the exchange floor are three different answers, and a boolean
 * cannot carry them.
 */
export const CapitalSidePlanFactsSchema=z.object({present:z.boolean(),admission:z.string(),reasons:z.array(z.string()).default([]),
  minExecutableMarginUsd:z.number().nonnegative(),notionalUsd:z.number().nonnegative(),marginUsd:z.number().nonnegative(),leverage:z.number().int().positive()}).nullable().default(null);
export type CapitalSidePlanFacts=z.infer<typeof CapitalSidePlanFactsSchema>;

export const CapitalRouteSampleSchema=z.object({symbol:z.string(),underlying:z.string(),quoteAsset:z.enum(['USDT','USDC','BUSD','UNKNOWN']),marginUsd:z.number().nonnegative(),leverage:z.number().int().positive(),admission:z.string(),reason:z.string(),longExecutable:z.boolean().default(true),shortExecutable:z.boolean().default(true),longRecommendedNotionalUsd:z.number().nonnegative().nullable().default(null),shortRecommendedNotionalUsd:z.number().nonnegative().nullable().default(null),longFeasibleNotionalUsd:z.number().nonnegative().nullable().default(null),shortFeasibleNotionalUsd:z.number().nonnegative().nullable().default(null),minExecutableNotionalUsd:z.number().nonnegative().default(0),longPlanFacts:CapitalSidePlanFactsSchema,shortPlanFacts:CapitalSidePlanFactsSchema});
export type CapitalRouteSample=z.infer<typeof CapitalRouteSampleSchema>;

export const CapitalAdmissionSummarySchema=z.object({
  generation:z.number().int().nonnegative().default(0),
  /** Independent fingerprint for capital/risk facts; not a selection generation. */
  capitalVersion:z.string().default('0'),
  directionBudget:z.object({longAvailableNotionalUsd:z.number().nonnegative(),shortAvailableNotionalUsd:z.number().nonnegative(),grossAvailableNotionalUsd:z.number().nonnegative(),evaluatedAt:z.number().int()}).default({longAvailableNotionalUsd:0,shortAvailableNotionalUsd:0,grossAvailableNotionalUsd:0,evaluatedAt:0}),
  evaluatedAt:z.number().int(),
  executableCandidateCount:z.number().int().nonnegative(),
  usdtAvailable:z.number().nonnegative(),
  usdcAvailable:z.number().nonnegative(),
  usdtExecutableUnderlyings:z.number().int().nonnegative(),
  usdcExecutableUnderlyings:z.number().int().nonnegative(),
  noUsdtMargin:z.number().int().nonnegative(),
  noUsdcMargin:z.number().int().nonnegative(),
  noUsdcContract:z.number().int().nonnegative(),
  liquidityRejected:z.number().int().nonnegative(),
  exposureRejected:z.number().int().nonnegative(),
  minMarginRejected:z.number().int().nonnegative(),
  marketNotFresh:z.number().int().nonnegative(),
  underlyingBlocked:z.number().int().nonnegative(),
  reasonCounts:z.record(z.string(),z.number().int().nonnegative()),
  routedCandidates:z.array(CapitalRouteSampleSchema).max(50),
  nextRecheckAt:z.number().int().nullable(),
});
export type CapitalAdmissionSummary=z.infer<typeof CapitalAdmissionSummarySchema>;

export const ManualRiskOverrideSchema=z.object({
  status:z.literal('MANUAL_RISK_OVERRIDE_ACTIVE'),
  riskCycleKey:z.string().min(1),
  activatedAt:z.number().int(),
  expiresAt:z.number().int(),
  previousState:z.object({runtimeMode:RuntimeModeSchema,executionMode:z.string(),pauseReason:z.string()}),
  operatorAction:z.literal('MANUAL_RISK_PAUSE_OVERRIDE'),
  reason:z.string().min(1).max(240),
  riskMetrics:z.object({capitalEpochRealizedPnlUsd:z.number(),riskDrawdownPct:z.number(),equityUsd:z.number()}),
});
export type ManualRiskOverride=z.infer<typeof ManualRiskOverrideSchema>;

export const RuntimeControlStateSchema=z.object({
  mode:RuntimeModeSchema,
  reasonCode:RuntimeReasonCodeSchema,
  reasonText:z.string(),
  pausedAt:z.number().int().nullable(),
  pauseSource:z.enum(['NONE','MANUAL','AUTO']).default('NONE'),
  autoResume:z.boolean(),
  lastTransitionAt:z.number().int(),
  nextCapitalCheckAt:z.number().int().nullable(),
  capital:CapitalAdmissionSummarySchema,
  entrySafetyMode:EntrySafetyModeSchema.default('SAFETY_REVIEW_PAUSED'),
  manualRiskOverride:ManualRiskOverrideSchema.nullable().default(null),
});
export type RuntimeControlState=z.infer<typeof RuntimeControlStateSchema>;

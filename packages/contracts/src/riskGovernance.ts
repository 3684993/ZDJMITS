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
}).default({});
export type RiskGovernanceSettings = z.infer<typeof RiskGovernanceSettingsSchema>;

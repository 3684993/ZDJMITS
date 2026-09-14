import { z } from 'zod';

export const TradingQualityMetricBasisSchema = z.enum([
  'PRICE_MARKOUT',
  'MARK_MARKOUT',
  'EXECUTABLE_EX_FUNDING',
  'EXECUTABLE_WITH_FUNDING',
]);
export type TradingQualityMetricBasis = z.infer<typeof TradingQualityMetricBasisSchema>;

export const TradingQualityHorizonMsSchema = z.union([
  z.literal(30_000), z.literal(60_000), z.literal(180_000), z.literal(300_000), z.literal(900_000),
]);
export type TradingQualityHorizonMs = z.infer<typeof TradingQualityHorizonMsSchema>;

export const TradingQualityExperimentManifestSchema = z.object({
  experimentId: z.string().min(1),
  environment: z.string().min(1),
  accountScope: z.string().min(1),
  codeHead: z.string().min(7),
  configHash: z.string().min(8),
  policyVersion: z.string().min(1),
  metricVersion: z.string().min(1),
  ruleHash: z.string().min(8),
  analysisPlanHash: z.string().min(8),
  decisionStartAt: z.number().int().nonnegative(),
  entryEnrollmentEndAt: z.number().int().positive(),
  followupEndAt: z.number().int().positive(),
  authoritativeClock: z.enum(['EXCHANGE_EVENT_TIME', 'SYSTEM_UTC']),
  enrollmentRuleVersion: z.string().min(1),
  transitionalRule: z.literal('BASELINE_PREEXISTING_ORDER_IS_TRANSITIONAL'),
  exclusionReasons: z.array(z.string()).default([]),
  runtimeSessions: z.array(z.object({
    sessionId: z.string().min(1),
    startedAt: z.number().int().nonnegative(),
    endedAt: z.number().int().nonnegative().nullable().default(null),
  })).default([]),
  createdAt: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.entryEnrollmentEndAt <= value.decisionStartAt) ctx.addIssue({code:z.ZodIssueCode.custom,message:'entryEnrollmentEndAt must be after decisionStartAt'});
  if (value.followupEndAt <= value.entryEnrollmentEndAt) ctx.addIssue({code:z.ZodIssueCode.custom,message:'followupEndAt must be after entryEnrollmentEndAt'});
  if (value.createdAt > value.decisionStartAt) ctx.addIssue({code:z.ZodIssueCode.custom,message:'manifest must be frozen before decisionStartAt'});
});
export type TradingQualityExperimentManifest = z.infer<typeof TradingQualityExperimentManifestSchema>;

export const TradingQualityEnrollmentEvidenceSchema = z.object({
  decisionAt: z.number().int().nonnegative(),
  intentCreatedAt: z.number().int().nonnegative(),
  cycleCreatedAt: z.number().int().nonnegative(),
  source: z.enum(['NEW_DECISION','TRANSITIONAL_EXISTING_ORDER','HISTORICAL_IMPORT','UNKNOWN']),
  environment: z.string().min(1),
  accountScope: z.string().min(1),
  codeHead: z.string().min(7),
  configHash: z.string().min(8),
  policyVersion: z.string().min(1),
  metricVersion: z.string().min(1),
  ruleHash: z.string().min(8),
});
export type TradingQualityEnrollmentEvidence = z.infer<typeof TradingQualityEnrollmentEvidenceSchema>;

export const TradingQualityFundingEvidenceSchema = z.object({
  attributionStatus: z.enum(['EXACT','UNKNOWN']),
  factIds: z.array(z.string().min(1)),
  coverageStartAt: z.number().int().nonnegative(),
  coverageEndAt: z.number().int().nonnegative(),
  accountScope: z.string().min(1),
  cycleId: z.string().min(1),
  verifiedAt: z.number().int().nonnegative(),
}).superRefine((value, ctx) => {
  if (value.coverageEndAt < value.coverageStartAt) ctx.addIssue({code:z.ZodIssueCode.custom,message:'funding coverage is inverted'});
  if (value.attributionStatus === 'EXACT' && value.factIds.length === 0) ctx.addIssue({code:z.ZodIssueCode.custom,message:'EXACT funding requires durable evidence ids'});
});
export type TradingQualityFundingEvidence = z.infer<typeof TradingQualityFundingEvidenceSchema>;

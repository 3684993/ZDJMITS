import { z } from 'zod';

export const ExecutionModeSchema = z.enum([
  'MANUAL_ONLY',
  'SHADOW_ONLY',
  'AUTO_READY',
  'AUTO_RUNNING',
  'AUTO_PAUSED_RISK',
  'AUTO_PAUSED_USER',
  'WEEKLY_REVIEW_PENDING',
]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const CapitalEpochSchema = z.object({
  capitalEpochId: z.string().min(1),
  startedAt: z.number().int(),
  reason: z.literal('USER_CONFIRMED_TESTNET_CAPITAL_RESET'),
  startingEquityUsd: z.number().nonnegative(),
  startingUsdtAvailable: z.number().nonnegative(),
  startingUsdcAvailable: z.number().nonnegative(),
  startingPositions: z.number().int().nonnegative(),
  startingOrders: z.number().int().nonnegative(),
  previousEpochId: z.string().nullable(),
  exchangeRealizedPnl24hAtStart: z.number(),
  accountFingerprint: z.string().min(1),
});
export type CapitalEpoch = z.infer<typeof CapitalEpochSchema>;

export const WeeklyLiveValidationSchema = z.object({
  validationId: z.string().min(1),
  status: z.enum(['AUTO_RUNNING','INVALIDATED','WEEKLY_REVIEW_PENDING']),
  startedAt: z.number().int(),
  requiredUntil: z.number().int(),
  completedAt: z.number().int().nullable(),
  invalidatedAt: z.number().int().nullable(),
  invalidationReason: z.string().nullable(),
  capitalEpochId: z.string().min(1),
  codeVersion: z.string().min(1),
  gitCommit: z.string().min(1),
  sourceHash: z.string().min(1),
  settingsHash: z.string().min(1),
  testnetAccountFingerprint: z.string().min(1),
  entryCountAtStart: z.number().int().nonnegative(),
  positionCountAtStart: z.number().int().nonnegative(),
  tradeRecordCountAtStart: z.number().int().nonnegative(),
  automaticStopMarketCount: z.number().int().nonnegative().default(0),
  automaticEmergencyCloseCount: z.number().int().nonnegative().default(0),
  automaticLossReduceCount: z.number().int().nonnegative().default(0),
});
export type WeeklyLiveValidation = z.infer<typeof WeeklyLiveValidationSchema>;


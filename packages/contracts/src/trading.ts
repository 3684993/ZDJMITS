import { z } from 'zod';
import { ProfitTakePlanSchema } from './ai.js';

export const SideSchema = z.enum(['LONG','SHORT']);
export type Side = z.infer<typeof SideSchema>;

export const EntryIntentSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: SideSchema,
  confidence: z.number().min(0).max(1),
  idealPrice: z.number().positive(),
  acceptablePriceRange: z.object({ min: z.number().positive(), max: z.number().positive() }),
  horizonMinutes: z.number().int().min(1).max(5),
  leverage: z.number().int().positive(),
  createdAt: z.number().int(),
  absoluteExpiresAt: z.number().int(),
  aiAuthorizationExpiresAt:z.number().int().optional(),
  configuredOrderTtlExpiresAt:z.number().int().optional(),
  packetId: z.string(),
  brainRunId: z.string(),
  allocationPlan: z.any().optional(),
  reservationId: z.string().nullable().optional(),
  decisionChainId: z.string().nullable().optional(),
  protectionMode: z.enum(['OFF','SHADOW','REQUIRED']).optional(),
  snapshotId: z.string().nullable().optional(),
  structuredInvalidationId: z.string().nullable().optional(),
  profitTakePlan: ProfitTakePlanSchema.nullable().optional(),
});
export type EntryIntent = z.infer<typeof EntryIntentSchema>;

export const EntryOrderSchema = z.object({
  id: z.string(),
  exchangeOrderId: z.string().nullable(),
  symbol: z.string(),
  side: SideSchema,
  quantity: z.number().positive(),
  price: z.number().positive(),
  filledQuantity: z.number().nonnegative(),
  leverage: z.number().int().positive(),
  status: z.enum(['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED','FILLED','CANCELED','EXPIRED','REJECTED']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  absoluteExpiresAt: z.number().int(),
  repriceCount: z.number().int().nonnegative(),
  intentId: z.string(),
  reachability: z.number().min(0).max(1),
  reservationId: z.string().nullable().optional(),
  decisionChainId: z.string().nullable().optional(),
  clientOrderId: z.string().max(35).nullable().optional(),
  orderType:z.string().nullable().optional(),
  timeInForce:z.string().nullable().optional(),
  maker:z.boolean().optional(),
  factSource:z.string().nullable().optional(),
  verifiedAt:z.number().int().nullable().optional(),
  fillState:z.enum(['NONE','PARTIAL','COMPLETE']).default('NONE'),
  fills:z.array(z.object({tradeId:z.string(),qty:z.number().positive(),price:z.number().positive(),commission:z.number().nonnegative().nullable(),commissionAsset:z.string().nullable(),executedAt:z.number().int()})).default([]),
});
export type EntryOrder = z.infer<typeof EntryOrderSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: SideSchema,
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  markPrice: z.number().positive(),
  leverage: z.number().int().positive(),
  unrealizedPnl: z.number(),
  unrealizedPnlPercent: z.number(),
  openedAt: z.number().int(),
  firstObservedAt: z.number().int().nullable().default(null),
  entryTimeSource: z.enum(['SYSTEM_FILL','BINANCE_TRADE_HISTORY','BINANCE_ORDER_HISTORY','SQLITE_EXECUTION_HISTORY','RECONCILIATION','IMPORTED_AT_STARTUP','UNKNOWN']).default('UNKNOWN'),
  managementStatus: z.enum(['AUTO_MANAGED','HUMAN_MANAGED']).default('AUTO_MANAGED'),
  humanManagedAt: z.number().int().nullable().default(null),
  tpStatus: z.enum(['PENDING','PROTECTED','MISSING','MISMATCH','REPAIRING','REPAIR_FAILED','MANUAL_REVIEW_REQUIRED']),
  tpOrderId: z.string().nullable(),
  tpLastVerifiedAt: z.number().int().nullable().default(null),
  tpCoverageSource: z.enum(['BINANCE_OPEN_ORDER','SYSTEM_CREATED','NONE']).default('NONE'),
  tpEconomics: z.object({
    currentTpPrice:z.number().positive().nullable(), expectedGrossProfit:z.number(), expectedFees:z.number().nonnegative(), expectedNetProfit:z.number(),
    requiredNetProfit:z.number().nonnegative(), breakEvenPrice:z.number().positive().nullable(), minProfitableExitPrice:z.number().positive().nullable(),
    status:z.enum(['TP_OK','TP_LOW_NET','TP_NET_NEGATIVE','TP_DATA_INCOMPLETE','TP_TARGET_BELOW_NET_FLOOR','TP_TARGET_UNREALISTIC'])
  }).nullable().optional(),
  profitTakePlan: ProfitTakePlanSchema.nullable().optional(),
  profitTakePlanSource:z.enum(['AI','STRUCTURE_15M','FIXED_PROFITABLE']).nullable().optional(),
  lossHandoff:z.object({cycleId:z.string(),lastClosedBarAt:z.number().int().nullable(),consecutiveLossBars:z.number().int().nonnegative(),status:z.enum(['ACTIVE','UNKNOWN','HUMAN_HANDOFF'])}).nullable().optional(),
});
export type Position = z.infer<typeof PositionSchema>;

export const TakeProfitOrderSchema = z.object({
  id: z.string(),
  exchangeOrderId: z.string().nullable(),
  positionId: z.string(),
  symbol: z.string(),
  side: z.enum(['SELL','BUY']),
  quantity: z.number().positive(),
  price: z.number().positive(),
  status: z.enum(['UNKNOWN','WORKING','FILLED','CANCELED','EXPIRED','REJECTED']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  clientOrderId: z.string().max(35).nullable().optional(),
});
export type TakeProfitOrder = z.infer<typeof TakeProfitOrderSchema>;

export const TradeRecordClassificationSchema = z.enum(['COMPLETE','PARTIAL','IMPORTED','EXTERNAL','DUPLICATE','CONFLICT','INVALID']);
export type TradeRecordClassification = z.infer<typeof TradeRecordClassificationSchema>;

export const TradeRecordSchema = z.object({
  tradeId: z.string(), symbol: z.string(), direction: SideSchema,
  openedAt: z.number().int().nullable(), closedAt: z.number().int().nullable(), durationMs: z.number().int().nonnegative().nullable(),
  entryQty: z.number().nonnegative(), entryAveragePrice: z.number().positive().nullable(), exitAveragePrice: z.number().positive().nullable(),
  entryFee: z.number().nonnegative().nullable().default(null), exitFee: z.number().nonnegative().nullable().default(null), totalFee: z.number().nonnegative().nullable().default(null), funding: z.number().nullable(),
  entryGrossNotional:z.number().nonnegative().default(0), exitGrossNotional:z.number().nonnegative().default(0),
  marginUsed:z.number().positive().nullable().default(null), netRoiOnMargin:z.number().nullable().default(null), netReturnOnNotional:z.number().nullable().default(null),
  entryFillCount:z.number().int().nonnegative().default(0), exitFillCount:z.number().int().nonnegative().default(0),
  feeBreakdown:z.array(z.object({stage:z.enum(['ENTRY','EXIT']),asset:z.string(),amount:z.number(),usd:z.number().nullable(),conversionSource:z.string().nullable()})).default([]),
  grossRealizedPnl: z.number().nullable(), netPnl: z.number().nullable(),
  closeReason: z.enum(['TP','MANUAL','RECONCILIATION','UNKNOWN']).nullable(),
  status: z.enum(['OPEN','PARTIALLY_CLOSED','CLOSED','IMPORTED_OPEN_POSITION','INCOMPLETE']),
  entryRunId: z.string().nullable(), entryIntentId: z.string().nullable(), entryOrderIds: z.array(z.string()), exitOrderIds: z.array(z.string()),
  source: z.enum(['SYSTEM','IMPORTED_AT_STARTUP','RECONCILIATION','LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT','EXTERNAL']), regime: z.string().nullable(),
  feeCompleteness: z.enum(['COMPLETE','PARTIAL','UNKNOWN']).default('UNKNOWN'), recordCompleteness: z.enum(['COMPLETE','PARTIAL']).default('PARTIAL'),
  classification:TradeRecordClassificationSchema.default('PARTIAL'), canonical:z.boolean().default(true), duplicateOf:z.string().nullable().default(null), cycleId:z.string().nullable().default(null), repairSource:z.string().nullable().default(null), linkedFillIds:z.array(z.string()).default([]), missingFacts:z.array(z.string()).default([]), integrityFlags:z.array(z.string()).default([]),
  createdAt: z.number().int(), updatedAt: z.number().int(), firstObservedAt: z.number().int().nullable(),
});
export type TradeRecord = z.infer<typeof TradeRecordSchema>;

export const ExperienceSampleSchema = z.object({
  sampleId: z.string(), tradeId: z.string(), symbol: z.string(), direction: SideSchema, regime: z.string().nullable(),
  netPnl: z.number(), winLoss: z.enum(['WIN','LOSS','FLAT']), fillDelayMs: z.number().int().nonnegative().nullable(), holdingDurationMs: z.number().int().nonnegative().nullable(),
  lesson: z.string(), mistakeTags: z.array(z.string()), successTags: z.array(z.string()), createdAt: z.number().int(),
});
export type ExperienceSample = z.infer<typeof ExperienceSampleSchema>;

export const ExecutionFillSchema = z.object({
  fillId:z.string(),symbol:z.string(),direction:SideSchema,side:z.enum(['BUY','SELL']),positionSide:z.enum(['LONG','SHORT','BOTH']),orderId:z.string(),clientOrderId:z.string(),tradeId:z.string(),
  executionTime:z.number().int(),qty:z.number().positive(),price:z.number().positive(),realizedPnl:z.number(),commission:z.number().nonnegative(),commissionAsset:z.string(),commissionUsd:z.number().nullable(),maker:z.boolean(),source:z.enum(['USER_DATA_WS','EXCHANGE_AUDIT','SIMULATION']),attributionStatus:z.enum(['SYSTEM_ATTRIBUTED','EXTERNAL_OR_UNLINKED','PENDING']).default('PENDING'),decisionChainId:z.string().nullable().optional(),allocationPlanId:z.string().nullable().optional()
});
export type ExecutionFill = z.infer<typeof ExecutionFillSchema>;

export const ManualActionSchema = z.enum(['REDUCE','ADD','EMERGENCY_CLOSE','PLACE_LIMIT','REPLACE_TP','REBUILD_TP']);
export type ManualAction = z.infer<typeof ManualActionSchema>;

export const ManualIntentSchema = z.object({
  id: z.string(), idempotencyKey: z.string(), positionId: z.string(), symbol: z.string(), side: SideSchema,
  action: ManualActionSchema, quantity: z.number().positive().nullable(), price: z.number().positive().nullable(),
  reduceOnly: z.boolean(), postOnly: z.boolean(), status: z.enum(['RECEIVED','VALIDATED','SUBMITTED','UNKNOWN','COMPLETED','REJECTED','CANCELED','EXPIRED']),
  reason: z.string().nullable(), exchangeOrderId: z.string().nullable(), createdAt: z.number().int(), updatedAt: z.number().int(),
  clientOrderId: z.string().max(35).nullable().optional(),
});
export type ManualIntent = z.infer<typeof ManualIntentSchema>;

export const ManualOrderSchema = z.object({
  id: z.string(), intentId: z.string(), exchangeOrderId: z.string().nullable(), positionId: z.string(), symbol: z.string(),
  side: z.enum(['BUY','SELL']), positionSide: z.enum(['LONG','SHORT','BOTH']).nullable(), type: z.enum(['LIMIT','MARKET']),
  quantity: z.number().positive(), price: z.number().positive().nullable(), reduceOnly: z.boolean(), postOnly: z.boolean(),
  status: z.enum(['NEW','UNKNOWN','WORKING','PARTIALLY_FILLED','FILLED','CANCELED','EXPIRED','REJECTED']), filledQuantity: z.number().nonnegative(),
  createdAt: z.number().int(), updatedAt: z.number().int(), clientOrderId: z.string().max(35).nullable().optional(),
});
export type ManualOrder = z.infer<typeof ManualOrderSchema>;

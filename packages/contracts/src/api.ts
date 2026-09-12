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
  supply: z.object({cohort:z.object({status:z.literal('NOT_ESTABLISHED'),memberCount:z.number().int().nonnegative().nullable()}),retention:z.object({status:z.literal('NOT_INVENTORIED'),zombieSnapshotCount:z.number().int().nonnegative().nullable()}),counts:z.record(z.string(),z.number().int().nonnegative().nullable()),target:z.number().int().nonnegative(),lowWatermark:z.number().int().nonnegative(),rootBlocker:z.enum(['SUPPLY','CAPITAL','CAPACITY','RISK','MARKET','GOVERNANCE','AI']).nullable(),reasonCounts:z.record(z.string(),z.number().int().nonnegative()),poolCount:z.number().int().nonnegative(),readyCount:z.number().int().nonnegative(),qualifiedSupply:z.number().int().nonnegative(),readySupply:z.number().int().nonnegative(),targetGap:z.number().int().nonnegative(),supplyShortage:z.boolean(),refillFailure:z.boolean(),belowLowWatermark:z.boolean()}).optional(),
  pool: z.array(PoolItemSchema),
  positions: z.array(PositionSchema),
  entryOrders: z.array(EntryOrderSchema),
  tpOrders: z.array(TakeProfitOrderSchema),
  aiResources: z.array(AiResourceSchema),
  recentAiRuns: z.array(AiRunSchema),
  health: z.array(ServiceHealthSchema),
  readiness: z.object({overall:z.enum(['READY','READ_ONLY','NEEDS_CONFIGURATION','DEGRADED','OFFLINE']), privateDataStatus:z.enum(['NOT_CONFIGURED','SYNCING','READY','STALE','UNAVAILABLE']), reason:z.string().nullable()}),
  settings: SystemSettingsSchema,
  tradeNetPnl: z.number().nullable().optional(), tradeCompletedCount:z.number().int().nonnegative().optional(), tradeActivity:z.record(z.string(),z.unknown()).optional(),
  exchangeFillFacts:z.object({entryFillsLast1h:z.number().int().nonnegative(),exitFillsLast1h:z.number().int().nonnegative(),closedTradesLast1h:z.number().int().nonnegative(),netPnlLast1h:z.number(),exchangeFillsLast1h:z.number().int().nonnegative(),attributedFillsLast1h:z.number().int().nonnegative(),unattributedFillsLast1h:z.number().int().nonnegative(),externalFillsLast1h:z.number().int().nonnegative(),systemFillAttributionGapLast1h:z.number().int().nonnegative(),systemFillParityAlert:z.boolean(),tradeRecordLag:z.number().int().nonnegative()}).optional(),
  portfolioIntelligence: PortfolioExposureSchema.extend({availableUsdt:z.number().nullable(),availableUsdc:z.number().nullable(),riskTierDistribution:z.record(z.string(),z.number()),directionPolicyDistribution:z.record(z.string(),z.number()),recentAllocationPlans:z.number().int().nonnegative()}).optional(),
  runtimeControl: RuntimeControlStateSchema.optional(),
  externalResearch:z.record(z.string(),z.unknown()).optional(),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;

export const UniverseResponseSchema = z.object({ generation: z.number().int(), candidates: z.array(UniverseCandidateSchema) });
export const PoolResponseSchema = z.object({ items: z.array(PoolItemSchema) });
export const EipResponseSchema = z.object({ packet: EntryIntelligencePacketSchema });

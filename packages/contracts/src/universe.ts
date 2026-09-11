import { z } from "zod";

export const SymbolLifecycleSchema = z.enum([
  "AVAILABLE",
  "SHORTLIST",
  "POOL",
  "ANALYZING",
  "PENDING_ENTRY",
  "POSITION",
  "COOLDOWN",
  "DATA_BLOCKED",
  "READY",
  "SCOUT_QUEUED",
  "SCOUT_RUNNING",
  "SCOUT_DONE",
  "PRIMARY_QUEUED",
  "PRIMARY_RUNNING",
  "PLACE_READY",
  "PRIMARY_COMPLETED",
  "WAIT_FOR_PRICE",
  "WAIT_EXECUTION_RANGE",
  "ENTRY_WORKING",
  "POSITION_HELD",
  "HELD",
  "REJECT_COOLDOWN",
  "AI_FAILURE_COOLDOWN",
  "TECHNICAL_COOLDOWN",
  "QUARANTINED",
  "WAITING_CAPITAL_ROUTE",
  "EXCLUDED_UNDERLYING",
]);
export type SymbolLifecycle = z.infer<typeof SymbolLifecycleSchema>;

export const OpportunityComponentsSchema = z.object({
  liquidity: z.number().min(0).max(100),
  tradingActivity: z.number().min(0).max(100),
  capitalActivity: z.number().min(0).max(100),
  technicalOpportunity: z.number().min(0).max(100),
  executionReachability: z.number().min(0).max(100),
  dataQuality: z.number().min(0).max(100),
});
export type OpportunityComponents = z.infer<typeof OpportunityComponentsSchema>;

export const MarketQualityGradeSchema=z.enum(['A','B','C','D']);
export type MarketQualityGrade=z.infer<typeof MarketQualityGradeSchema>;
export const MarketQualitySchema=z.object({
  grade:MarketQualityGradeSchema,
  admitted:z.boolean(),
  reasons:z.array(z.string()),
  quoteVolumeUsd24h:z.number().nonnegative(),
  tradeCount24h:z.number().int().nonnegative(),
  spreadBps:z.number().nonnegative(),
  bidDepth05Usd:z.number().nonnegative(),
  askDepth05Usd:z.number().nonnegative(),
  bidDepth1Usd:z.number().nonnegative(),
  askDepth1Usd:z.number().nonnegative(),
  openInterestUsd:z.number().nullable(),
  listingAgeDays:z.number().nullable(),
  realizedVolatility15mPct:z.number().nonnegative(),
  makerFillQuality:z.number().min(0).max(1).nullable(),
  calibration:z.object({minQuoteVolumeUsd24h:z.number(),minTradeCount24h:z.number(),maxSpreadBps:z.number(),minDepthUsd:z.number(),minOpenInterestUsd:z.number(),minListingAgeDays:z.number(),maxRealizedVolatility15mPct:z.number()}),
});
export type MarketQuality=z.infer<typeof MarketQualitySchema>;

export const AssetAdmissionClassSchema=z.enum(['CORE','APPROVED_LIQUID','RESEARCH_ONLY','EXCLUDED']);
export type AssetAdmissionClass=z.infer<typeof AssetAdmissionClassSchema>;
export const AssetAdmissionSchema=z.object({
  underlying:z.string().min(1),
  classification:AssetAdmissionClassSchema,
  directoryVersion:z.string().min(1),
  sourceDomain:z.enum(['STATIC_GOVERNANCE','PRODUCTION_PUBLIC_RESEARCH']),
  reason:z.string().min(1),
  updatedAt:z.number().int(),
});
export type AssetAdmission=z.infer<typeof AssetAdmissionSchema>;

export const UniverseCandidateSchema = z.object({
  symbol: z.string(),
  // Rank zero is explicit: eligible but outside Top N, or blocked.
  rank: z.number().int().nonnegative(),
  score: z.number().min(0).max(100),
  lifecycle: SymbolLifecycleSchema,
  eligible: z.boolean(),
  exclusionReasons: z.array(z.string()),
  components: OpportunityComponentsSchema,
  quoteVolumeUsd24h: z.number().nonnegative(),
  spreadBps: z.number().nonnegative(),
  lastPrice: z.number().positive(),
  change24hPercent: z.number(),
  dataCompleteness: z.number().min(0).max(1),
  selectionGeneration: z.number().int().nonnegative(),
  updatedAt: z.number().int(),
  underlyingAsset: z.string().optional(),
  quoteAsset: z.string().optional(),
  selectedContract: z.string().optional(),
  riskTier: z.string().optional(),
  directionPolicy: z.string().optional(),
  directionPreference: z.string().optional(),
  locationScore: z.number().min(0).max(100).optional(),
  recommendedMargin: z.number().nonnegative().optional(),
  recommendedLeverage: z.number().int().positive().optional(),
  existingUnderlyingExposure: z.number().nonnegative().optional(),
  eligibleContracts: z.array(z.string()).optional(),
  /** Scheduler eligibility is intentionally independent from Universe ranking. */
  pipelineEligible: z.boolean().optional(),
  /** Stable collection membership survives transient position/order/cooldown states. */
  residentEligible: z.boolean().optional(),
  lifecycleReason: z.string().optional(),
  nextEligibleAt: z.number().int().nullable().optional(),
  marketQuality: MarketQualitySchema.optional(),
  assetAdmission: AssetAdmissionSchema.optional(),
  schedulerPriority: z.number().optional(),
});
export type UniverseCandidate = z.infer<typeof UniverseCandidateSchema>;

export const PoolItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  rank: z.number().int().positive(),
  score: z.number().min(0).max(100),
  components: OpportunityComponentsSchema,
  state: z.enum(["READY", "WAITING", "ANALYZING", "REJECTED", "EXPIRED"]),
  addedAt: z.number().int(),
  expiresAt: z.number().int(),
  selectionGeneration: z.number().int(),
});
export type PoolItem = z.infer<typeof PoolItemSchema>;

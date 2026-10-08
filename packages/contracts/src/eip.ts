import { OpportunityEvidenceSchema } from './opportunity.js';
import { z } from 'zod';
import { DerivativesSnapshotSchema, OrderBookSchema, QuoteSchema, TechnicalCardSchema, TimeframeSchema } from './market.js';
import { OpportunityComponentsSchema } from './universe.js';

export const EvidenceRefSchema = z.object({
  id: z.string(),
  category: z.enum(['PRICE','TECHNICAL','MICROSTRUCTURE','DERIVATIVES','REGIME','PORTFOLIO','EXPERIENCE','SELECTION']),
  label: z.string(),
  value: z.string(),
  ts: z.number().int(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
const ReferenceMarketSchema=z.object({symbol:z.string(),quote:QuoteSchema,technical:z.record(TimeframeSchema,TechnicalCardSchema),derivatives:DerivativesSnapshotSchema,orderBook:OrderBookSchema,recentTradedPrices:z.array(z.object({price:z.number().positive(),lastSeenAt:z.number().int()})).max(16).optional()});

export const ExistingPositionContextSchema=z.object({
  version:z.literal('V398_POSITION_CONTEXT_1'),asOf:z.number().int().positive(),privateAccountAsOf:z.number().int().nullable(),environment:z.enum(['TESTNET','PRODUCTION']),source:z.string(),coverage:z.enum(['BOUND_REACHED_UNKNOWN','CURRENT_SNAPSHOT','STALE_OR_UNPROVEN']),notice:z.string(),
  positions:z.array(z.object({symbol:z.string(),quoteAsset:z.enum(['USDT','USDC','UNKNOWN']),side:z.enum(['LONG','SHORT']),cycleId:z.string().nullable(),quantity:z.number().finite().positive().nullable(),managementStatus:z.string(),recordedOpenedAt:z.number().int().positive().nullable(),entryTimeSource:z.string(),firstFillAt:z.number().int().positive().nullable(),holdingAgeMs:z.number().int().nonnegative().nullable(),timeEvidence:z.enum(['PARTIAL_RETAINED_ENTRY_MATCHES_CYCLE_OPEN','UNKNOWN']),inventoryEvidence:z.enum(['CURRENT_PRIVATE_ACCOUNT_CONTEXT','STALE_OR_UNPROVEN']),reasons:z.array(z.string())}).strict()).max(8),
}).strict().superRefine((v,ctx)=>{for(const p of v.positions){if(p.firstFillAt!==null&&(p.firstFillAt>v.asOf||p.holdingAgeMs!==v.asOf-p.firstFillAt))ctx.addIssue({code:'custom',message:'POSITION_CONTEXT_TIME_CONFLICT'});if(p.timeEvidence==='UNKNOWN'&&(p.firstFillAt!==null||p.holdingAgeMs!==null))ctx.addIssue({code:'custom',message:'UNKNOWN_POSITION_AGE_MUST_BE_NULL'});}});

export const EntryIntelligencePacketSchema = z.object({
  existingPositionContext:ExistingPositionContextSchema.optional(),
  opportunityEvidence:OpportunityEvidenceSchema.optional(),
  version: z.literal('3.0'),
  packetId: z.string(),
  symbol: z.string(),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  selection: z.object({rank:z.number().int().positive(),score:z.number().min(0).max(100),components:OpportunityComponentsSchema,selectionMode:z.string()}),
  market: z.object({recentTradedPrices:z.array(z.object({price:z.number().positive(),lastSeenAt:z.number().int()})).max(16).optional(),quote:QuoteSchema,technical:z.record(TimeframeSchema,TechnicalCardSchema),derivatives:DerivativesSnapshotSchema,orderBook:OrderBookSchema}),
  /** Raw BTC/ETH reference facts. These are evidence, never a precomputed direction answer. */
  referenceMarkets:z.object({btc:ReferenceMarketSchema,eth:ReferenceMarketSchema}).optional(),
  /** Pre-AI objective execution boundary injected immediately before Primary. */
  executionEnvelope:z.any().optional(),
  microstructure: z.object({spreadBps:z.number().nonnegative(),bidDepthUsd5:z.number().nonnegative(),askDepthUsd5:z.number().nonnegative(),microPrice:z.number().positive(),imbalance:z.number().min(-1).max(1),reachableBand1m:z.tuple([z.number().positive(),z.number().positive()]),reachableBand5m:z.tuple([z.number().positive(),z.number().positive()]),reachabilityScore:z.number().min(0).max(1)}),
  economic:z.object({makerFeeBps:z.number().nonnegative(),takerFeeBps:z.number().nonnegative(),roundTripCostBps:z.number().nonnegative(),safetyMarginBps:z.number().nonnegative(),configuredTargetMoveBps:z.number().positive(),minimumEconomicEdgeBps:z.number().positive(),longSpaceToResistanceBps:z.number().nullable(),shortSpaceToSupportBps:z.number().nullable(),provenance:z.string()}).default({makerFeeBps:0,takerFeeBps:0,roundTripCostBps:0,safetyMarginBps:0,configuredTargetMoveBps:1,minimumEconomicEdgeBps:1,longSpaceToResistanceBps:null,shortSpaceToSupportBps:null,provenance:'LEGACY_PACKET_NO_ECONOMIC_FACTS'}),
  globalRegime:z.object({btc:z.object({symbol:z.string(),trend15m:z.string(),trend4h:z.string(),trend1d:z.string(),trend1w:z.string(),change24hPercent:z.number()}),eth:z.object({symbol:z.string(),trend15m:z.string(),trend4h:z.string(),trend1d:z.string(),trend1w:z.string(),change24hPercent:z.number()}),regime:z.enum(['RISK_ON','RISK_OFF','MIXED','HIGH_VOLATILITY','LOW_VOLATILITY'])}),
  portfolio:z.object({activePositions:z.number().int().nonnegative(),pendingEntries:z.number().int().nonnegative(),longPositions:z.number().int().nonnegative(),shortPositions:z.number().int().nonnegative(),longProfitableRatio:z.number().min(0).max(1),shortProfitableRatio:z.number().min(0).max(1),longNotionalUsd:z.number().nonnegative(),shortNotionalUsd:z.number().nonnegative()}),
  experience:z.object({sampleSize:z.number().int().nonnegative(),sameSymbolWinRate:z.number().min(0).max(1).nullable(),sameRegimeWinRate:z.number().min(0).max(1).nullable(),averageFillMinutes:z.number().nonnegative().nullable(),recentLessons:z.array(z.string()).max(8)}),
  directionPolicy:z.object({reference:z.string(),weights:z.record(z.string(),z.number()),hardConstraints:z.array(z.string())}),
  portfolioIntelligence:z.object({underlying:z.string(),quoteAsset:z.string(),riskTier:z.string(),directionPolicy:z.string(),directionPreference:z.string().optional(),allowedDirections:z.array(z.enum(['LONG','SHORT'])).optional(),preferredDirection:z.enum(['LONG','SHORT']).nullable().optional(),longExceptionRequired:z.boolean().optional(),altLongQuality:z.number().nullable().optional(),marginFactor:z.number().positive().optional(),leverageCap:z.number().int().positive().optional(),locationScore:z.number(),recommendedMargin:z.number(),recommendedLeverage:z.number(),marginMode:z.string(),existingUnderlyingExposure:z.number(),allocationAdmission:z.string(),reasons:z.array(z.string())}).optional(),
  evidenceCompleteness:z.number().min(0).max(1),contradictions:z.array(z.string()),evidence:z.array(EvidenceRefSchema),
});
export type EntryIntelligencePacket = z.infer<typeof EntryIntelligencePacketSchema>;

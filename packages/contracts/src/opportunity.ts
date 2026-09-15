import { z } from 'zod';

export const TradingQualityPolicySchema = z.object({
  mode: z.enum(['OFF', 'SHADOW', 'ENFORCE']).default('OFF'),
  policyVersion: z.string().min(1).default('TQ-V3-1'),
  eventTtlMs: z.number().int().min(1000).max(300000).default(120000),
  authorizationTtlMs: z.number().int().min(1000).max(300000).default(90000),
  positionObservationHorizonMs: z.number().int().min(60000).default(900000),
  maxLocationAtr: z.number().positive().default(1),
  minNetSpaceBps: z.number().nonnegative().default(0),
  adverseBoundaryBps: z.number().positive().default(10),
  favorableBoundaryBps: z.number().positive().default(10),
});
export type TradingQualityPolicy = z.infer<typeof TradingQualityPolicySchema>;

export const OpportunityEvidenceSchema = z.object({
  opportunityId: z.string(), version: z.string(), policyVersion: z.string(),
  symbol: z.string(), direction: z.enum(['LONG', 'SHORT']).nullable(),
  setupType: z.enum(['TREND_PULLBACK', 'TREND_RESUMPTION', 'BREAKOUT_CONFIRMATION', 'NONE']),
  structureAnchor: z.object({barCloseTime:z.number(), price:z.number(), target:z.number()}).nullable(),
  timingEvent: z.object({id:z.string(),status:z.enum(['COMPLETED','PENDING','NONE']),time:z.number().nullable(),
    anchorPrice:z.number().nullable(),timeframe:z.enum(['1m','5m','15m']).nullable(),provenance:z.string()}),
  eventTtlMs:z.number(), authorizationTtlMs:z.number(), positionObservationHorizonMs:z.number(),
  locationFacts:z.object({distanceAtr:z.number().nullable(),atr:z.number().nullable()}),
  executablePriceBand:z.object({min:z.number(),max:z.number()}).nullable(), structuralTarget:z.number().nullable(),
  payoffSpaceBps:z.number().nullable(), costs:z.object({entryFeeBps:z.number(),exitFeeBps:z.number(),bufferBps:z.number()}),
  disposition:z.enum(['ALLOW','WAIT','REJECT']), blockers:z.array(z.string()), releaseCondition:z.string(),
  observedAt:z.number(), expiresAt:z.number(), materialFactFingerprint:z.string(),
});
export type OpportunityEvidence = z.infer<typeof OpportunityEvidenceSchema>;

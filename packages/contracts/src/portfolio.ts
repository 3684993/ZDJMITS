import { z } from 'zod';

export const QuoteAssetPolicySchema=z.enum(['AUTO','USDT_ONLY','USDC_ONLY']);

/**
 * A Binance futures symbol can be quoted in more assets than this system is allowed to *fund* a new
 * Entry with. Parsing and funding are two different questions, and only one of them is a list of
 * suffixes: `4000BONKUSDT`, `BNBFDUSD` and a BTC wallet balance are all real account facts, while
 * `EntryFundingUniverse` is the product's own permission for what may pay for a new position.
 */
export const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'FDUSD'] as const;
export type QuoteSuffix = (typeof QUOTE_SUFFIXES)[number];
/** The single Entry funding universe. Nothing outside it may size, reserve, lease or route an Entry. */
export const ENTRY_QUOTE_ASSETS = ['USDT', 'USDC'] as const;
export type EntryQuoteAsset = (typeof ENTRY_QUOTE_ASSETS)[number];

/** Which quote leg a symbol name actually carries; never a funding permission. */
export function quoteSuffixOf(symbolOrAsset: unknown): QuoteSuffix | 'UNKNOWN' {
  const value = String(symbolOrAsset ?? '').trim().toUpperCase();
  const hit = QUOTE_SUFFIXES.map((suffix) => ({suffix, at: value.lastIndexOf(suffix)})).filter((row) => row.at > 0 && row.at + row.suffix.length === value.length).sort((a, b) => b.at - a.at)[0];
  return hit?.suffix ?? (value === 'BUSD' || value === 'FDUSD' ? 'UNKNOWN' : (QUOTE_SUFFIXES as readonly string[]).includes(value) ? value as QuoteSuffix : 'UNKNOWN');
}

/** The one answer to "may this asset pay for a new Entry". */
export function isEntryQuoteAsset(value: unknown): value is EntryQuoteAsset {
  return (ENTRY_QUOTE_ASSETS as readonly string[]).includes(String(value ?? '').trim().toUpperCase());
}

/** Symbol-level form of the same test, so no caller keeps its own copy of the list. */
export function entryFundingEligibleSymbol(symbol: unknown): boolean {
  return isEntryQuoteAsset(quoteSuffixOf(symbol));
}
export type QuoteAssetPolicy=z.infer<typeof QuoteAssetPolicySchema>;
export const UnderlyingExposurePolicySchema=z.enum(['BLOCK_ALL','BLOCK_SAME_DIRECTION','ALLOW_HEDGE']);
export type UnderlyingExposurePolicy=z.infer<typeof UnderlyingExposurePolicySchema>;
export const AssetRiskTierSchema=z.enum(['CORE','LIQUID_ALT','SPECULATIVE','NEW_LISTING','RESTRICTED']);
export type AssetRiskTier=z.infer<typeof AssetRiskTierSchema>;
export const DirectionPolicySchema=z.enum(['BOTH','LONG_BIASED','SHORT_BIASED','LONG_ONLY','SHORT_ONLY','DISABLED']);
export type DirectionPolicy=z.infer<typeof DirectionPolicySchema>;
/** User-facing direction semantics. DirectionPolicy remains as a
 * compatibility projection for older allocation/audit records. */
export const DirectionPreferenceSchema=z.enum(['BALANCED','INTELLIGENT_SHORT_BIAS','STRICT_SHORT_BIAS','SHORT_ONLY','CUSTOM']);
export type DirectionPreference=z.infer<typeof DirectionPreferenceSchema>;
export const MarginModeSchema=z.enum(['ISOLATED','CROSS','AUTO']);
export type MarginMode=z.infer<typeof MarginModeSchema>;
export const PortfolioAdmissionSchema=z.enum(['ALLOW','ALLOW_REDUCED_SIZE','REJECT_DUPLICATE_UNDERLYING','REJECT_EXPOSURE_LIMIT','REJECT_QUOTE_MARGIN','REJECT_RISK_TIER','REJECT_LOCATION','REJECT_DIRECTION_POLICY','REJECT_MAX_POSITIONS','REJECT_DATA_QUALITY','REJECT_PROTECTION_REQUIRED']);
export type PortfolioAdmission=z.infer<typeof PortfolioAdmissionSchema>;

export const PortfolioIntelligenceSettingsSchema=z.object({
  enabled:z.boolean().default(true),quoteAssetPolicy:QuoteAssetPolicySchema.default('AUTO'),underlyingExposurePolicy:UnderlyingExposurePolicySchema.default('BLOCK_SAME_DIRECTION'),
  riskTierMode:z.enum(['AUTO','MANUAL_OVERRIDE']).default('AUTO'),globalDirectionPolicy:DirectionPolicySchema.default('BOTH'),tierDirectionPolicies:z.record(z.string(),DirectionPolicySchema).default({}),symbolDirectionPolicies:z.record(z.string(),DirectionPolicySchema).default({}),
  globalDirectionPreference:DirectionPreferenceSchema.default('INTELLIGENT_SHORT_BIAS'),
  tierDirectionPreferences:z.record(z.string(),DirectionPreferenceSchema).default({CORE:'BALANCED',LIQUID_ALT:'INTELLIGENT_SHORT_BIAS',SPECULATIVE:'STRICT_SHORT_BIAS',NEW_LISTING:'SHORT_ONLY'}),
  symbolDirectionPreferences:z.record(z.string(),DirectionPreferenceSchema).default({}),
  /** Long-only risk reductions, independently auditable from generic tier sizing. */
  altLongMarginFactors:z.record(z.string(),z.number().positive().max(1)).default({CORE:1,LIQUID_ALT:.65,SPECULATIVE:.35,NEW_LISTING:.1}),
  altLongLeverageCaps:z.record(z.string(),z.number().int().positive().max(125)).default({CORE:20,LIQUID_ALT:8,SPECULATIVE:3,NEW_LISTING:1}),
  dynamicMarginEnabled:z.boolean().default(true),baseMarginUsd:z.number().positive().default(200),minMarginUsd:z.number().min(.01).default(1),maxMarginPerPositionUsd:z.number().positive().default(500),maxEquityPct:z.number().positive().max(1).default(.1),
  tierMarginFactors:z.record(z.string(),z.number().nonnegative()).default({CORE:1,LIQUID_ALT:.8,SPECULATIVE:.45,NEW_LISTING:.3,RESTRICTED:0}),
  dynamicLeverageEnabled:z.boolean().default(true),globalMaxLeverage:z.number().int().positive().max(125).default(20),tierMaxLeverage:z.record(z.string(),z.number().int().positive().max(125)).default({CORE:20,LIQUID_ALT:12,SPECULATIVE:5,NEW_LISTING:3,RESTRICTED:1}),
  marginMode:MarginModeSchema.default('AUTO'),tierMarginModes:z.record(z.string(),MarginModeSchema).default({}),symbolMarginModes:z.record(z.string(),MarginModeSchema).default({}),
  locationProtectionEnabled:z.boolean().default(true),minLocationScore:z.number().min(0).max(100).default(45),maxEma21DistanceAtr:z.number().positive().default(2),maxBbLong:z.number().default(.9),minBbShort:z.number().default(.1),maxImpulseAtr:z.number().positive().default(2),
  maxSameUnderlyingPositions:z.number().int().positive().default(1),maxLongExposurePct:z.number().positive().max(1).default(.5),maxShortExposurePct:z.number().positive().max(1).default(.5),maxSpeculativeExposurePct:z.number().positive().max(1).default(.2),maxSpeculativePositions:z.number().int().positive().default(2),maxQuoteAssetMarginUsagePct:z.number().positive().max(1).default(.8),
  symbolOverrides:z.record(z.string(),z.object({riskTier:AssetRiskTierSchema.optional(),directionPolicy:DirectionPolicySchema.optional(),maxMarginUsd:z.number().positive().optional(),maxLeverage:z.number().int().positive().max(125).optional(),quoteAssetPolicy:QuoteAssetPolicySchema.optional(),marginMode:MarginModeSchema.optional()}).partial()).default({}),
});
export type PortfolioIntelligenceSettings=z.infer<typeof PortfolioIntelligenceSettingsSchema>;

export const PortfolioExposureSchema=z.object({longNotionalUsd:z.number().nonnegative(),shortNotionalUsd:z.number().nonnegative(),longExposurePct:z.number().nonnegative(),shortExposurePct:z.number().nonnegative(),speculativeNotionalUsd:z.number().nonnegative(),speculativeExposurePct:z.number().nonnegative(),usdtMarginUsd:z.number().nonnegative(),usdcMarginUsd:z.number().nonnegative(),sameUnderlyingExposure:z.number().nonnegative(),duplicateBlocks:z.number().int().nonnegative(),locationBlocks:z.number().int().nonnegative()});
export type PortfolioExposure=z.infer<typeof PortfolioExposureSchema>;
export const AllocationPlanSchema=z.object({planId:z.string(),underlying:z.string(),symbol:z.string(),quoteAsset:z.enum(['USDT','USDC','BUSD','UNKNOWN']),riskTier:AssetRiskTierSchema,directionPolicy:DirectionPolicySchema,directionPreference:DirectionPreferenceSchema.default('INTELLIGENT_SHORT_BIAS'),direction:z.enum(['LONG','SHORT']),locationScore:z.number().min(0).max(100),locationWouldBlock:z.boolean().default(false),marginMode:MarginModeSchema,leverage:z.number().int().positive(),marginUsd:z.number().positive(),notionalUsd:z.number().positive(),minExecutableMarginUsd:z.number().positive(),altLongMarginFactor:z.number().positive().max(1).default(1),directionLeverageCap:z.number().int().positive().max(125).default(125),exposureBefore:PortfolioExposureSchema,exposureAfter:PortfolioExposureSchema,admission:PortfolioAdmissionSchema,policySource:z.string(),reasons:z.array(z.string()).default([]),createdAt:z.number().int()});
export type AllocationPlan=z.infer<typeof AllocationPlanSchema>;

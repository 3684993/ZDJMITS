import { z } from 'zod';

/** Immutable, versioned sizing and economics authority for one TESTNET entry decision. */
export const EntryEconomicMandateSchema = z.object({
  schemaVersion: z.literal('V397-ENTRY-ECONOMIC-MANDATE-1'),
  mandateId: z.string().min(8).max(160),
  environment: z.literal('TESTNET'),
  quoteAsset: z.enum(['USDT', 'USDC', 'BUSD']),
  settingsVersion: z.number().int().positive(),
  factsHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  side: z.enum(['LONG', 'SHORT']),
  directionFacts: z.array(z.object({
    timeframe: z.enum(['1d', '4h', '15m']),
    closedAt: z.number().int().positive().nullable(),
    direction: z.enum(['UP', 'DOWN', 'RANGE', 'UNKNOWN']),
    status: z.enum(['FRESH', 'STALE', 'MISSING']),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  }).strict()).length(3),
  sizing: z.object({
    minimumInitialMarginQuote: z.number().finite().positive(),
    minimumOrderNotionalQuote: z.number().finite().nonnegative(),
    exchangeMinimumNotionalQuote: z.number().finite().positive(),
    selectedInitialMarginQuote: z.number().finite().positive(),
    selectedNotionalQuote: z.number().finite().positive(),
    quantityUnits: z.number().int().positive(),
    quantity: z.number().finite().positive(),
    leverage: z.number().int().positive(),
    entryPrice: z.number().finite().positive(),
    stepSize: z.number().finite().positive(),
    priceTick: z.number().finite().positive(),
  }).strict(),
  economics: z.object({
    entryFeeQuote: z.number().finite().nonnegative(),
    expectedExitFeeQuote: z.number().finite().nonnegative(),
    slippageBufferQuote: z.number().finite().nonnegative(),
    fundingQuote: z.number().finite().nullable(),
    fundingStatus: z.enum(['VERIFIED', 'INSUFFICIENT_SAMPLE', 'UNPROVEN', 'CONFLICT']),
    fxToUsd: z.number().finite().positive().nullable(),
    fxStatus: z.enum(['VERIFIED', 'INSUFFICIENT_SAMPLE', 'UNPROVEN', 'CONFLICT', 'NOT_REQUIRED']),
    minimumNetProfitQuote: z.number().finite().nonnegative(),
    targetPrice: z.number().finite().positive(),
    targetHorizonMinutes: z.number().int().min(5).max(1440),
    targetConditionalNetQuote: z.number().finite().nullable(),
    expectedNetQuote: z.number().finite().nullable(),
    oneHourReachability: z.number().min(0).max(1).nullable(),
    oneHourReachabilityStatus: z.enum(['VERIFIED', 'INSUFFICIENT_SAMPLE', 'UNPROVEN', 'STALE']),
    costVersion: z.string().min(1).max(160),
  }).strict(),
  rationale: z.string().min(1).max(600),
}).strict().superRefine((mandate, ctx) => {
  const expectedTimeframes = ['1d', '4h', '15m'] as const;
  const seen = new Set<string>();
  for (const fact of mandate.directionFacts) {
    if (seen.has(fact.timeframe)) ctx.addIssue({ code: 'custom', path: ['directionFacts'], message: 'MANDATE_DIRECTION_TIMEFRAME_DUPLICATE' });
    seen.add(fact.timeframe);
    if (fact.status !== 'FRESH' || fact.closedAt === null || fact.evidenceHash === null)
      ctx.addIssue({ code: 'custom', path: ['directionFacts'], message: 'MANDATE_DIRECTION_FACT_NOT_FRESH' });
  }
  if (expectedTimeframes.some(timeframe => !seen.has(timeframe)))
    ctx.addIssue({ code: 'custom', path: ['directionFacts'], message: 'MANDATE_DIRECTION_TIMEFRAME_MISSING' });
  if (mandate.expiresAt <= mandate.createdAt) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'MANDATE_EXPIRY_INVALID' });
  if (mandate.sizing.selectedInitialMarginQuote + 1e-8 < mandate.sizing.minimumInitialMarginQuote)
    ctx.addIssue({ code: 'custom', path: ['sizing', 'selectedInitialMarginQuote'], message: 'BUSINESS_MINIMUM_INITIAL_MARGIN_NOT_MET' });
  if (mandate.sizing.selectedNotionalQuote + 1e-8 < mandate.sizing.minimumOrderNotionalQuote)
    ctx.addIssue({ code: 'custom', path: ['sizing', 'selectedNotionalQuote'], message: 'BUSINESS_MINIMUM_ORDER_NOTIONAL_NOT_MET' });
  if (mandate.sizing.selectedNotionalQuote + 1e-8 < mandate.sizing.exchangeMinimumNotionalQuote)
    ctx.addIssue({ code: 'custom', path: ['sizing', 'selectedNotionalQuote'], message: 'EXCHANGE_MINIMUM_NOTIONAL_NOT_MET' });
  if (Math.abs(mandate.sizing.selectedNotionalQuote - mandate.sizing.quantity * mandate.sizing.entryPrice) > Math.max(1e-8, mandate.sizing.selectedNotionalQuote * 1e-8))
    ctx.addIssue({ code: 'custom', path: ['sizing', 'selectedNotionalQuote'], message: 'MANDATE_NOTIONAL_ARITHMETIC_MISMATCH' });
  if (Math.abs(mandate.sizing.selectedInitialMarginQuote - mandate.sizing.selectedNotionalQuote / mandate.sizing.leverage) > Math.max(1e-8, mandate.sizing.selectedInitialMarginQuote * 1e-8))
    ctx.addIssue({ code: 'custom', path: ['sizing', 'selectedInitialMarginQuote'], message: 'MANDATE_MARGIN_ARITHMETIC_MISMATCH' });
  if (Math.abs(mandate.sizing.quantity - mandate.sizing.quantityUnits * mandate.sizing.stepSize) > Math.max(1e-12, mandate.sizing.quantity * 1e-8))
    ctx.addIssue({ code: 'custom', path: ['sizing', 'quantity'], message: 'MANDATE_QUANTITY_STEP_MISMATCH' });
});

export type EntryEconomicMandate = z.infer<typeof EntryEconomicMandateSchema>;

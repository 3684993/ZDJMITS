import { z } from 'zod';

export const TimeframeSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const CandleSchema = z.object({
  openTime: z.number().int(),
  closeTime: z.number().int(),
  receivedAt: z.number().int().optional(),
  isClosed: z.boolean().optional(),
  source: z.enum(['BINANCE_REST','BINANCE_WS','MOCK','EXTERNAL']).optional(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
  quoteVolume: z.number().nonnegative().default(0),
  trades: z.number().int().nonnegative().default(0),
});
export type Candle = z.infer<typeof CandleSchema>;

export const QuoteSchema = z.object({
  symbol: z.string(),
  last: z.number().positive(),
  mark: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  tickSize: z.number().positive(),
  stepSize: z.number().positive(),
  minQty: z.number().positive(),
  minNotional: z.number().positive(),
  quoteVolumeUsd24h: z.number().nonnegative(),
  priceChangePercent24h: z.number(),
  tradeCount24h: z.number().int().nonnegative(),
  ts: z.number().int(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const OrderBookSchema = z.object({
  symbol: z.string(),
  bids: z.array(z.tuple([z.number().positive(), z.number().positive()])),
  asks: z.array(z.tuple([z.number().positive(), z.number().positive()])),
  ts: z.number().int(),
});
export type OrderBook = z.infer<typeof OrderBookSchema>;

export const DerivativesSnapshotSchema = z.object({
  symbol: z.string(),
  openInterest: z.number().nonnegative().nullable(),
  openInterestChange5m: z.number().nullable(),
  openInterestChange15m: z.number().nullable(),
  fundingRate: z.number().nullable(),
  takerBuySellRatio5m: z.number().positive().nullable(),
  globalLongShortRatio: z.number().positive().nullable(),
  topTraderPositionRatio: z.number().positive().nullable(),
  ts: z.number().int(),
});
export type DerivativesSnapshot = z.infer<typeof DerivativesSnapshotSchema>;

export const TechnicalCardSchema = z.object({
  timeframe: TimeframeSchema,
  asOf: z.number().int(),
  barOpenTime: z.number().int().optional(),
  barCloseTime: z.number().int().optional(),
  receivedAt: z.number().int().optional(),
  isClosed: z.boolean().default(true),
  source: z.enum(['BINANCE_REST','BINANCE_WS','MOCK','EXTERNAL','UNKNOWN']).default('UNKNOWN'),
  lastClosedBar: z.object({openTime:z.number().int(),closeTime:z.number().int(),open:z.number().positive(),high:z.number().positive(),low:z.number().positive(),close:z.number().positive(),volume:z.number().nonnegative()}).strict().optional(),
  inProgressBar: z.object({
    openTime:z.number().int(),closeTime:z.number().int(),receivedAt:z.number().int(),
    elapsedRatio:z.number().min(0).max(1),lastPrice:z.number().positive(),volume:z.number().nonnegative(),source:z.string(),
  }).strict().nullable().default(null),
  sampleSize: z.number().int().positive(),
  lastPrice: z.number().positive(),
  trend: z.enum(['UP', 'DOWN', 'RANGE', 'UNCERTAIN']),
  trendStrength: z.number().min(0).max(1),
  ema8: z.number().positive(),
  ema21: z.number().positive(),
  ema55: z.number().positive(),
  emaSlope21: z.number(),
  macdLine: z.number(),
  macdSignal: z.number(),
  macdHistogram: z.number(),
  macdHistogramSlope: z.number(),
  macdCrossDirection: z.enum(['BULLISH', 'BEARISH', 'NONE']),
  macdCrossAgeBars: z.number().int().nonnegative(),
  bbUpper: z.number().positive(),
  bbMiddle: z.number().positive(),
  bbLower: z.number().finite(),
  bbPosition: z.number(),
  bbBandwidth: z.number().nonnegative(),
  atr14: z.number().nonnegative(),
  atrPercent: z.number().nonnegative(),
  volumeZScore: z.number(),
  recentSwingHigh: z.number().positive(),
  recentSwingLow: z.number().positive(),
  higherHighs: z.number().int().nonnegative(),
  higherLows: z.number().int().nonnegative(),
  lowerHighs: z.number().int().nonnegative(),
  lowerLows: z.number().int().nonnegative(),
  freshnessMs: z.number().int().nonnegative(),
});
export type TechnicalCard = z.infer<typeof TechnicalCardSchema>;

export const MarketSymbolSnapshotSchema = z.object({
  symbol: z.string(),
  quote: QuoteSchema,
  orderBook: OrderBookSchema,
  derivatives: DerivativesSnapshotSchema,
  technical: z.record(TimeframeSchema, TechnicalCardSchema),
  dataCompleteness: z.number().min(0).max(1),
  listingAgeDays: z.number().nonnegative().nullable().optional(),
  recentTradedPrices: z.array(z.object({price:z.number().positive(),lastSeenAt:z.number().int()})).max(16).optional(),
});
export type MarketSymbolSnapshot = z.infer<typeof MarketSymbolSnapshotSchema>;

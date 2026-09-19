import { describe, expect, it, vi } from 'vitest';
import { closedCandleGap } from '@zdj/core';
import { BinancePublicMarketDataProvider } from './BinancePublicMarketDataProvider.js';

const PERIODS = { '1m': 60_000, '5m': 300_000, '15m': 900_000 } as const;
type Frame = keyof typeof PERIODS;

/** Builds a WS-shaped closed series ending on the boundary before `now`, optionally punching holes. */
function series(timeframe: Frame, count: number, now: number, skipOffsets: number[] = []) {
  const period = PERIODS[timeframe], end = Math.floor(now / period) * period;
  const rows: any[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = end - (count - i) * period;
    if (skipOffsets.includes(openTime)) continue;
    rows.push({ openTime, closeTime: openTime + period - 1, open: 100 + i * 0.01, high: 102 + i * 0.01,
      low: 99 + i * 0.01, close: 101 + i * 0.01, volume: 100, receivedAt: now - (count - i) * period,
      isClosed: true, source: 'BINANCE_WS', quoteVolume: 10_000, trades: 10 });
  }
  return rows;
}

/** REST reply for the same window that always contains the skipped minutes. */
function restRows(timeframe: Frame, count: number, now: number) {
  const period = PERIODS[timeframe], end = Math.floor(now / period) * period, rows: any[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = end - (count - i) * period;
    rows.push([openTime, '100', '101', '99', '100', '10', openTime + period - 1, '1000', 10]);
  }
  return rows;
}

function providerWith(json: any) {
  const provider = new BinancePublicMarketDataProvider({ json, environment: () => 'TESTNET' } as any);
  vi.spyOn((provider as any).stream, 'quote').mockReturnValue(null);
  vi.spyOn((provider as any).stream, 'book').mockReturnValue(null);
  return provider;
}

describe('V3.9.5 closed-candle continuity validator', () => {
  const now = 1_800_000_000_000;

  it('accepts a continuous series that ends on the current closed boundary', () => {
    const facts = closedCandleGap(series('1m', 120, now), '1m', now);
    expect(facts).toMatchObject({ ok: true, closedCount: 120, missing: 0, duplicates: 0,
      boundaryInvalid: false, latestClosedAtBoundary: true });
  });

  it('reports the exact missing minute of a middle gap even when count and latest look healthy', () => {
    const period = PERIODS['1m'], full = series('1m', 120, now), skipped = full[60]!.openTime;
    const facts = closedCandleGap(full.filter((_, i) => i !== 60), '1m', now);
    expect(facts.ok).toBe(false);
    expect(facts.missing).toBe(1);
    expect(facts.firstMissingOpenTime).toBe(skipped);
    expect(facts.closedCount).toBe(119);
    expect(facts.latestClosedAtBoundary).toBe(true);
    expect(period).toBe(60_000);
  });

  it('rejects duplicated openTimes and undersized closed boundaries', () => {
    const rows = series('1m', 30, now);
    expect(closedCandleGap([...rows, rows.at(-1)!], '1m', now).duplicates).toBe(1);
    const broken = rows.map((row, i) => (i === 5 ? { ...row, closeTime: row.openTime + 30_000 } : row));
    expect(closedCandleGap(broken, '1m', now).boundaryInvalid).toBe(true);
  });

  it('treats a stale latest closed candle as not at the boundary', () => {
    expect(closedCandleGap(series('1m', 120, now), '1m', now + 180_000).latestClosedAtBoundary).toBe(false);
  });
});

describe('V3.9.5 getCandles trusts the live cache only when it is continuous', () => {
  it.each(['1m', '5m', '15m'] as Frame[])('%s middle gap falls through to REST instead of returning the holey live cache', async (timeframe) => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const limit = 120, period = PERIODS[timeframe];
    const json = vi.fn(async (_path: string) => restRows(timeframe, limit + 5, now));
    const provider = providerWith(json), stream = (provider as any).stream;
    stream.seedCandles('BTCUSDT', timeframe, series(timeframe, limit + 10, now,
      [Math.floor(now / period) * period - 40 * period]));
    const rows = await provider.getCandles('BTCUSDT', timeframe, limit);
    expect(json).toHaveBeenCalledTimes(1);
    expect(String(json.mock.calls[0]![0])).toContain(`interval=${timeframe}`);
    expect(closedCandleGap(rows, timeframe, now).ok).toBe(true);
    vi.useRealTimers();
  });

  it('does not spend REST when the live cache is continuous', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const json = vi.fn(async () => restRows('1m', 130, now));
    const provider = providerWith(json), stream = (provider as any).stream;
    stream.seedCandles('BTCUSDT', '1m', series('1m', 120, now));
    const rows = await provider.getCandles('BTCUSDT', '1m', 120);
    expect(json).not.toHaveBeenCalled();
    expect(rows).toHaveLength(120);
    vi.useRealTimers();
  });

  it('heals the shared cache after a REST reload so the next read stays offline', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const json = vi.fn(async (_path: string) => restRows('1m', 125, now));
    const provider = providerWith(json), stream = (provider as any).stream;
    stream.seedCandles('BTCUSDT', '1m', series('1m', 130, now, [Math.floor(now / 60_000) * 60_000 - 40 * 60_000]));
    await provider.getCandles('BTCUSDT', '1m', 120);
    expect(json).toHaveBeenCalledTimes(1);
    expect(closedCandleGap(stream.candleSeries('BTCUSDT', 120_000, '1m'), '1m', now).ok).toBe(true);
    await provider.getCandles('BTCUSDT', '1m', 120);
    expect(json).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('stays fail-closed when REST cannot answer and does not fall back to the holey cache', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const json = vi.fn(async (_path: string) => { throw new Error('BINANCE_REQUEST_DEFERRED'); });
    const provider = providerWith(json), stream = (provider as any).stream;
    stream.seedCandles('BTCUSDT', '1m', series('1m', 130, now, [Math.floor(now / 60_000) * 60_000 - 40 * 60_000]));
    await expect(provider.getCandles('BTCUSDT', '1m', 120)).rejects.toThrow('BINANCE_REQUEST_DEFERRED');
    vi.useRealTimers();
  });
});

describe('V3.9.5 live technical hydration cannot pin a broken sequence', () => {
  it('refuses a holey cache, then rebuilds the card after a REST repair despite the fingerprint cache', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const json = vi.fn(async (_path: string) => restRows('1m', 125, now));
    const provider = providerWith(json), stream = (provider as any).stream;
    stream.seedCandles('BTCUSDT', '1m', series('1m', 130, now, [Math.floor(now / 60_000) * 60_000 - 40 * 60_000]));
    // fail closed while the hole is present
    expect(() => provider.hydrateLiveTechnical({ symbol: 'BTCUSDT', technical: {} } as any))
      .toThrow('1m closed candle gap');
    await provider.getCandles('BTCUSDT', '1m', 120);
    const healed = provider.hydrateLiveTechnical({ symbol: 'BTCUSDT', technical: {} } as any);
    expect(healed.technical['1m']).toBeDefined();
    expect(healed.technical['1m'].barCloseTime).toBe(Math.floor(now / 60_000) * 60_000 - 1);
    vi.useRealTimers();
  });
});

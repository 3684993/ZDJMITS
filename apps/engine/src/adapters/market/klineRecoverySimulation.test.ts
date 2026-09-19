import { describe, expect, it, vi } from 'vitest';
import { closedCandleGap } from '@zdj/core';
import { BinancePublicMarketDataProvider } from './BinancePublicMarketDataProvider.js';
import { MarketDataHub } from '../../services/marketDataHub.js';

/**
 * Pre-deploy proof for the repair loop. A WebSocket disconnect punches the same hole into
 * every symbol's live 1m cache while quotes keep flowing: the repair must cost one bounded
 * klines request per symbol, must never degrade into a per-symbol snapshot reload, and must
 * not need a restart or a cache clear.
 */
const PERIODS = { '1m': 60_000, '5m': 300_000, '15m': 900_000 } as const;
type Frame = keyof typeof PERIODS;
const SYMBOLS = ['BTCUSDT', 'ETHUSDT', ...Array.from({ length: 58 }, (_, i) => `SYM${String(i).padStart(2, '0')}USDT`)];

function wsSeries(timeframe: Frame, count: number, now: number, holeOpenTime = -1) {
  const period = PERIODS[timeframe], end = Math.floor(now / period) * period, rows: any[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = end - (count - i) * period;
    if (openTime === holeOpenTime) continue;
    rows.push({ openTime, closeTime: openTime + period - 1, open: 100, high: 101, low: 99, close: 100,
      volume: 100, receivedAt: openTime, isClosed: true, source: 'BINANCE_WS', quoteVolume: 1000, trades: 5 });
  }
  return rows;
}

function restSeries(count: number, now: number, period: number) {
  const end = Math.floor(now / period) * period;
  return Array.from({ length: count }, (_, i) => {
    const openTime = end - (count - i) * period;
    return [openTime, '100', '101', '99', '100', '100', openTime + period - 1, '1000', 5];
  });
}

function snapshot(symbol: string, now: number) {
  const frames = Object.fromEntries((Object.entries(PERIODS) as [Frame, number][]).map(([tf, period]) => {
    const boundary = Math.floor(now / period) * period, close = boundary - 1;
    return [tf, { barCloseTime: close, asOf: close + 1, isClosed: true, receivedAt: now }];
  }));
  return {
    symbol,
    quote: { ts: now, bid: 99.9, ask: 100.1, last: 100, mark: 100, tickSize: 0.01, stepSize: 0.01, minQty: 1,
      minNotional: 5, quoteVolumeUsd24h: 1e9, priceChangePercent24h: 1, tradeCount24h: 1e5 },
    orderBook: { ts: now, bids: [[99.9, 1]], asks: [[100.1, 1]] },
    technical: frames,
  } as any;
}

describe('V3.9.5 mass 1m gap heals without a request storm', () => {
  it('uses at most one klines request per symbol, reloads no snapshots and restores readiness', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    const hole = Math.floor(now / PERIODS['1m']) * PERIODS['1m'] - 40 * PERIODS['1m'];
    const klines: string[] = [];
    const transport = {
      environment: () => 'TESTNET',
      json: vi.fn(async (path: string) => {
        klines.push(path);
        const params = new URLSearchParams(path.split('?')[1]);
        return restSeries(Number(params.get('limit') ?? 120), Date.now(), PERIODS[(params.get('interval') ?? '1m') as Frame]);
      }),
    };
    const provider = new BinancePublicMarketDataProvider(transport as any);
    const stream = (provider as any).stream;
    stream.symbols = new Set(SYMBOLS);
    for (const symbol of SYMBOLS) {
      stream.seedCandles(symbol, '1m', wsSeries('1m', 130, now, hole));
      stream.seedCandles(symbol, '5m', wsSeries('5m', 130, now));
      stream.seedCandles(symbol, '15m', wsSeries('15m', 250, now));
    }
    const state: any = {
      snapshots: new Map(SYMBOLS.map(symbol => [symbol, snapshot(symbol, now)])),
      pool: { list: () => SYMBOLS.map(symbol => ({ symbol })) },
      positionSymbols: () => [], activeEntrySymbols: () => [], candidateLifecycle: new Map(), settings: {},
    };
    const events: any[] = [];
    const hub: any = new MarketDataHub(provider, state, {
      publish: (type: string, payload: unknown, symbol?: string) => { events.push({ type, symbol }); return { type } as any; },
    } as any);
    const getSnapshot = vi.spyOn(provider, 'getSnapshot');
    /** Quotes and books keep arriving; only the closed kline series is broken. */
    const pumpQuotes = () => {
      for (const symbol of SYMBOLS) {
        stream.onEvent({ e: 'bookTicker', s: symbol, b: '99.9', a: '100.1', E: Date.now() });
        stream.books.set(symbol, { symbol, bids: [[99.9, 1]], asks: [[100.1, 1]], ts: Date.now() });
      }
    };
    /** The healthy stream keeps delivering the next closed minute, which is exactly what makes
     *  "latest bar is current" blind to the hole it left behind. */
    /** The stream is subscribed to kline_1m/5m/15m, so every frame keeps closing. */
    const pumpClosedBars = () => {
      for (const symbol of SYMBOLS) for (const period of Object.values(PERIODS)) {
        const boundary = Math.floor(Date.now() / period) * period;
        stream.onEvent({ e: 'kline', s: symbol, k: { i: period === 60_000 ? '1m' : period === 300_000 ? '5m' : '15m',
          t: boundary - period, T: boundary - 1, x: true, o: '100', h: '101', l: '99', c: '100', v: '100', q: '1000', n: 5 }, E: Date.now() });
      }
    };

    expect(closedCandleGap(stream.candleSeries('SYM00USDT', 2 * PERIODS['1m'], '1m'), '1m', now).missing).toBe(1);

    await hub.tick();
    expect(hub.technicalBlocked.size).toBe(SYMBOLS.length);
    expect(klines.length).toBe(0);
    expect(getSnapshot.mock.calls.map(c=>c[0])).toEqual([]);

    let rounds = 0;
    while (hub.technicalBlocked.size > 0 && rounds < 40) {
      // a real tick cadence is sub-minute, so frames that close less often still get rebuilt
      await vi.advanceTimersByTimeAsync(30_000);
      pumpQuotes();
      await hub.tick();
      await vi.advanceTimersByTimeAsync(30_000);
      pumpQuotes();
      pumpClosedBars();
      await hub.tick();
      await hub.recoverStale();
      rounds++;
    }

    expect(hub.technicalBlocked.size).toBe(0);
    const candleReloads = klines.filter(path => path.includes('/fapi/v1/klines'));
    const perSymbol = new Map<string, number>();
    for (const path of candleReloads) { const sym = new URLSearchParams(path.split('?')[1]).get('symbol')!; perSymbol.set(sym, (perSymbol.get(sym) ?? 0) + 1); }
    // one bounded reload per affected symbol, and no symbol is ever requested twice
    expect(Math.max(...perSymbol.values())).toBe(1);
    expect(candleReloads.length).toBe(SYMBOLS.length);
    expect(klines.length).toBeLessThanOrEqual(SYMBOLS.length + 1);
    expect(candleReloads.every(path => path.includes('interval=1m'))).toBe(true);
    expect(getSnapshot.mock.calls.map(c=>c[0])).toEqual([]);
    expect(rounds).toBeLessThanOrEqual(24);
    for (const symbol of SYMBOLS) expect(hub.primaryReadyReasons(symbol)).toEqual([]);
    expect(closedCandleGap(stream.candleSeries('SYM00USDT', 2 * PERIODS['1m'], '1m'), '1m', Date.now()).ok).toBe(true);
    expect(events.filter(event => event.type === 'MARKET_KLINE_SEQUENCE_REPAIRED').length).toBe(SYMBOLS.length);
    vi.useRealTimers();
  });
});

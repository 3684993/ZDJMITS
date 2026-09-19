import { describe, expect, it, vi } from 'vitest';
import { MarketDataHub } from '../../services/marketDataHub.js';

const HoleyError = '1m closed candle gap';

/** A snapshot that is fully fresh apart from a blocked closed sequence. */
function snapshotWithFreshFrames(symbol: string, now = Date.now()) {
  const frames = { '1m': 60_000, '5m': 300_000, '15m': 900_000 } as const;
  return {
    symbol, quote: { ts: now }, orderBook: { ts: now },
    technical: Object.fromEntries(Object.entries(frames).map(([tf, period]) => {
      const boundary = Math.floor(now / period) * period;
      const close = now - boundary <= 10_000 ? boundary - period - 1 : boundary - 1;
      return [tf, { barCloseTime: close, asOf: close + 1, isClosed: true, receivedAt: now }];
    })),
  } as any;
}

function hubWith(provider: any, symbols: string[], mockFreshness = true) {
  const state: any = {
    snapshots: new Map(symbols.map(symbol => [symbol, snapshotWithFreshFrames(symbol)])),
    pool: { list: () => [] }, positionSymbols: () => [], activeEntrySymbols: () => [],
    candidateLifecycle: new Map(), settings: {},
  };
  const events: any[] = [];
  const hub: any = new MarketDataHub(provider, state, {
    publish: (type: string, payload: any, symbol: string) => { events.push({ type, payload, symbol }); return { id: type, type, ts: Date.now(), payload } as any; },
  } as any);
  for (const symbol of symbols) hub.technicalBlocked.set(`${symbol}:1m`, { timeframe: '1m', sequence: 'holey', at: Date.now() });
  if (mockFreshness) vi.spyOn(hub, 'freshness').mockReturnValue({ stale: symbols, fresh: 0, total: symbols.length });
  return { hub, state, events };
}

const healedFacts = { ok: true, missing: 0, duplicates: 0, closedCount: 120, latestClosedAtBoundary: true };

describe('V3.9.5 targeted kline repair instead of a snapshot storm', () => {
  it('repairs the broken frame with one klines reload and never assembles a snapshot', async () => {
    const getSnapshot = vi.fn(async (_symbol: string) => { throw new Error('SHOULD_NOT_BE_CALLED'); });
    const repairCandles = vi.fn(async (_symbol: string, _timeframe: string) => healedFacts);
    const { hub, events } = hubWith({ getSnapshot, repairCandles } as any, ['BADUSDT']);
    expect(await hub.recoverStale()).toBe(0);
    expect(repairCandles).toHaveBeenCalledTimes(1);
    expect(repairCandles.mock.calls[0]![0]).toBe('BADUSDT');
    expect(repairCandles.mock.calls[0]![1]).toBe('1m');
    // BTC/ETH are always snapshot-loaded; the repaired symbol must not be.
    expect(getSnapshot.mock.calls.map(call => call[0])).not.toContain('BADUSDT');
    expect(events.some(event => event.type === 'MARKET_KLINE_SEQUENCE_REPAIRED')).toBe(true);
  });

  it('keeps the normal full reload path when quote or book facts are the problem', async () => {
    const symbol = 'BADUSDT';
    const state: any = {
      snapshots: new Map([[symbol, { symbol, quote: { ts: Date.now() - 60_000 }, orderBook: { ts: Date.now() }, technical: {} } as any]]),
      pool: { list: () => [] }, positionSymbols: () => [], activeEntrySymbols: () => [],
      candidateLifecycle: new Map(), settings: {},
    };
    const getSnapshot = vi.fn(async (_sym: string) => ({ symbol, quote: { ts: Date.now() }, orderBook: { ts: Date.now() }, technical: {} }));
    const repairCandles = vi.fn(async (_symbol: string, _timeframe: string) => healedFacts);
    const hub: any = new MarketDataHub({ getSnapshot, repairCandles } as any, state, { publish: vi.fn() } as any);
    hub.technicalBlocked.set(`${symbol}:1m`, { timeframe: '1m', sequence: 'holey', at: Date.now() });
    vi.spyOn(hub, 'freshness').mockReturnValue({ stale: [symbol], fresh: 0, total: 1 });
    await hub.recoverStale();
    expect(repairCandles).not.toHaveBeenCalled();
    expect(getSnapshot.mock.calls.map(call => call[0])).toContain('BADUSDT');
  });

  it('still repairs with one klines reload after the blocked card has also gone stale', async () => {
    const symbol = 'BADUSDT';
    const staleCardSnapshot = snapshotWithFreshFrames(symbol);
    for (const tf of ['1m', '5m', '15m']) staleCardSnapshot.technical[tf] = { ...staleCardSnapshot.technical[tf], barCloseTime: staleCardSnapshot.technical[tf].barCloseTime - 900_000, asOf: staleCardSnapshot.technical[tf].asOf - 900_000 };
    const state: any = { snapshots: new Map([[symbol, staleCardSnapshot]]), pool: { list: () => [] }, positionSymbols: () => [], activeEntrySymbols: () => [], candidateLifecycle: new Map(), settings: {} };
    const getSnapshot = vi.fn(async (_s: string) => { throw new Error('FULL_RELOAD_NOT_NEEDED'); });
    const repairCandles = vi.fn(async (_s: string, _tf: string) => healedFacts);
    const hub: any = new MarketDataHub({ getSnapshot, repairCandles } as any, state, { publish: vi.fn() } as any);
    hub.technicalBlocked.set(`${symbol}:1m`, { timeframe: '1m', sequence: 'holey', at: Date.now() });
    expect(hub.primaryReadyReasons(symbol)).toEqual(expect.arrayContaining(['TECHNICAL_1m_SEQUENCE_INVALID', 'TECHNICAL_1m_STALE']));
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledTimes(1);
    expect(getSnapshot.mock.calls.map(call => call[0])).not.toContain(symbol);
  });

  it('does not spend a second request while the per-frame repair cooldown is open', async () => {
    const repairCandles = vi.fn(async (_symbol: string, _timeframe: string) => ({ ok: false, missing: 2, duplicates: 0, closedCount: 118, latestClosedAtBoundary: true }));
    const { hub } = hubWith({ getSnapshot: vi.fn(async () => { throw new Error('NOT_HERE'); }), repairCandles } as any, ['BADUSDT']);
    await hub.recoverStale();
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledTimes(1);
  });

  it('defers without retrying when the request governor says no budget', async () => {
    const repairCandles = vi.fn(async (_symbol: string, _timeframe: string) => { throw new Error('BINANCE_REQUEST_BUDGET_DEFERRED:1m'); });
    const { hub, events } = hubWith({ getSnapshot: vi.fn(async () => { throw new Error('NOT_HERE'); }), repairCandles } as any, ['BADUSDT']);
    await hub.recoverStale();
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledTimes(1);
    expect(events.some(event => event.type === 'MARKET_KLINE_SEQUENCE_REPAIR_FAILED')).toBe(true);
  });

  it('keeps at most two symbols repairing at once across a wide stale set', async () => {
    const symbols = ['AUSDT', 'BUSDT', 'CUSDT', 'DUSDT', 'EUSDT'];
    let active = 0, max = 0;
    const repairCandles = vi.fn(async (_symbol: string, _timeframe: string) => {
      active++; max = Math.max(max, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return healedFacts;
    });
    const { hub } = hubWith({ getSnapshot: vi.fn(async () => { throw new Error('NOT_HERE'); }), repairCandles } as any, symbols);
    await hub.recoverStale();
    expect(max).toBeLessThanOrEqual(2);
    expect(repairCandles.mock.calls.length).toBeGreaterThan(0);
  });

  it('keeps the sequence block until a rebuilt card actually replaces the broken one', async () => {
    const symbol = 'BADUSDT';
    const provider: any = { tick: vi.fn(), hydrateLiveMarket: (s: any) => s, hydrateLiveTechnical: () => { throw new Error(HoleyError); } };
    const { hub, state } = hubWith(provider, [symbol]);
    await hub.tick();
    expect(state.snapshots.get(symbol)).toBeTruthy();
    expect(hub.primaryReadyReasons(symbol)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
    await hub.tick();
    expect(hub.primaryReadyReasons(symbol)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
    provider.hydrateLiveTechnical = () => snapshotWithFreshFrames(symbol);
    await hub.tick();
    expect(hub.primaryReadyReasons(symbol)).toEqual([]);
  });
});

describe('V3.9.5 freshness facts behind the pipeline diagnosis', () => {
  it('counts a sequence block separately from quote staleness', () => {
    const { hub } = hubWith({ getSnapshot: vi.fn(), repairCandles: vi.fn() } as any, ['BADUSDT'], false);
    const facts = hub.freshness();
    expect(facts.sequenceInvalid).toBe(1);
    expect(facts.quoteFreshRatio).toBe(1);
    expect(facts.klineFreshRatio).toBe(1);
    expect(facts.stale).toContain('BADUSDT');
  });
});

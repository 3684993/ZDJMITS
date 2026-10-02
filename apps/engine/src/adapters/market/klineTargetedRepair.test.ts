import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketDataHub } from '../../services/marketDataHub.js';

const HoleyError = '1m closed candle gap';
afterEach(() => vi.useRealTimers());

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

describe('targeted REST recovery preserves failure evidence independently of WebSocket health', () => {
  const restricted = 'Binance HTTP 451: Service unavailable from a restricted location';

  function restrictedHub(repairCandles: any) {
    const getSnapshot = vi.fn(async () => { throw new Error('SHOULD_NOT_RELOAD'); });
    const provider = { getSnapshot, repairCandles, streamMetrics: () => ({ state: 'LIVE', lastError: null, backfills: 0 }) };
    const result = hubWith(provider, ['BTCUSDT', 'ETHUSDT']);
    result.hub.technicalBlocked.delete('ETHUSDT:1m');
    result.hub.freshness.mockReturnValue({ stale: ['BTCUSDT'], fresh: 1, total: 2 });
    return { ...result, getSnapshot };
  }

  function dependencySnapshot(symbol: string) {
    const snapshot = snapshotWithFreshFrames(symbol);
    snapshot.dataCompleteness = 1;
    for (const tf of ['1m', '5m', '15m']) snapshot.technical[tf].sampleSize = 240;
    for (const tf of ['1h', '4h', '1d', '1w']) snapshot.technical[tf] = { asOf: Date.now(), sampleSize: 240, isClosed: true };
    return snapshot;
  }

  async function failedRecoveryForDependencies() {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    const repairCandles = vi.fn().mockRejectedValueOnce(new Error(restricted));
    const result = restrictedHub(repairCandles);
    result.hub.freshness.mockRestore();
    result.hub.setRetentionSymbols(['BTCUSDT', 'ETHUSDT']);
    for (const symbol of ['BTCUSDT', 'ETHUSDT']) result.state.snapshots.set(symbol, dependencySnapshot(symbol));
    await result.hub.recoverStale();
    vi.advanceTimersByTime(60_000);
    for (const symbol of ['BTCUSDT', 'ETHUSDT']) result.state.snapshots.set(symbol, dependencySnapshot(symbol));
    return { ...result, repairCandles };
  }

  it('retains HTTP 451 and the sequence block during cooldown while quotes stay LIVE', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    const repairCandles = vi.fn(async () => { throw new Error(restricted); });
    const { hub, getSnapshot } = restrictedHub(repairCandles);
    await hub.recoverStale();
    const nextRetryAt = Date.now() + 60_000;
    expect(hub.metrics()).toMatchObject({ state: 'LIVE', lastError: null, backfills: 0,
      recoveryFailures: [{ symbol: 'BTCUSDT', reason: restricted, nextRetryAt }],
      klineRecovery: { attempts: 1, successes: 0, failures: 1, pendingFrames: 1,
        lastFailure: { symbol: 'BTCUSDT', timeframe: '1m', reason: restricted, httpStatus: 451 },
        frames: [{ symbol: 'BTCUSDT', lastError: restricted, httpStatus: 451, nextRetryAt }] } });
    await hub.recoverStale();
    // Entry dependency recovery shares the same cooldown and must retain its cause.
    await hub.repairSequence('BTCUSDT', ['1m']);
    expect(hub.metrics().klineRecovery.frames[0]).toMatchObject({ lastError: restricted, nextRetryAt });
    expect(hub.primaryReadyReasons('BTCUSDT')).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
    expect(repairCandles).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it('records a partial frame repair without clearing the failed frame or its error', async () => {
    const repairCandles = vi.fn(async (_symbol: string, timeframe: string) => {
      if (timeframe === '15m') throw new Error(restricted);
      return healedFacts;
    });
    const { hub, state, events } = restrictedHub(repairCandles);
    hub.technicalBlocked.set('BTCUSDT:15m', { timeframe: '15m', sequence: 'holey', at: Date.now() });
    // The provider can rebuild only the successful frame; the 15m card stays unchanged.
    hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
      ...snapshot.technical, '1m': { ...snapshot.technical['1m'] },
    } });
    const previous15m = state.snapshots.get('BTCUSDT').technical['15m'];
    await hub.recoverStale();
    expect(hub.metrics()).toMatchObject({ recoveryFailures: [{ symbol: 'BTCUSDT', reason: restricted }],
      klineRecovery: { attempts: 2, successes: 1, failures: 1, pendingFrames: 1,
        frames: [{ timeframe: '15m', lastError: restricted, httpStatus: 451 }] } });
    expect(state.snapshots.get('BTCUSDT').technical['15m']).toBe(previous15m);
    expect(hub.primaryReadyReasons('BTCUSDT')).toContain('TECHNICAL_15m_SEQUENCE_INVALID');
    expect(events.find(event => event.type === 'MARKET_KLINE_SEQUENCE_REPAIRED')?.payload.complete).toBe(false);
    expect(events.find(event => event.type === 'MARKET_KLINE_SEQUENCE_REPAIR_FAILED')?.payload.complete).toBe(false);
  });

  it('retries after cooldown and clears the current error only after real repair', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_020_000);
    const repairCandles = vi.fn().mockRejectedValueOnce(new Error(restricted)).mockResolvedValue(healedFacts);
    const { hub, state, getSnapshot } = restrictedHub(repairCandles);
    await hub.recoverStale();
    vi.advanceTimersByTime(60_000);
    state.snapshots.set('BTCUSDT', snapshotWithFreshFrames('BTCUSDT'));
    hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
      ...snapshot.technical, '1m': { ...snapshot.technical['1m'] },
    } });
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledTimes(2);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(hub.primaryReadyReasons('BTCUSDT')).not.toContain('TECHNICAL_1m_SEQUENCE_INVALID');
    expect(hub.metrics()).toMatchObject({ recoveryFailures: [],
      klineRecovery: { attempts: 2, successes: 1, failures: 1, pendingFrames: 0, frames: [],
        lastFailure: { reason: restricted, httpStatus: 451 } } });
  });

  it('clears a stale-recovery failure when the entry dependency path restores every dependency', async () => {
    const { hub, repairCandles, getSnapshot } = await failedRecoveryForDependencies();
    repairCandles.mockImplementationOnce(async () => {
      hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
        ...snapshot.technical, '1m': { ...snapshot.technical['1m'] },
      } });
      return healedFacts;
    });
    expect(await hub.refreshEntryDependencies(['BTCUSDT'], 'BTCUSDT')).toBe(1);
    expect(hub.freshness()).toMatchObject({ fresh: 2, total: 2, sequenceInvalid: 0, stale: [] });
    expect(hub.metrics()).toMatchObject({ recoveryFailures: [], klineRecovery: {
      pendingFrames: 0, successes: 1, lastFailure: { reason: restricted, httpStatus: 451 },
    } });
    expect(hub.recovery.get('BTCUSDT')).toMatchObject({ attempt: 0, reason: null, lastSuccessAt: Date.now() });
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledTimes(2);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it.each(['tick', 'refreshSymbols'])('settles current recovery failure after %s publishes fully healthy facts', async (entrypoint) => {
    const { hub, getSnapshot, repairCandles } = await failedRecoveryForDependencies();
    if (entrypoint === 'tick') {
      hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
        ...snapshot.technical, '1m': { ...snapshot.technical['1m'] },
      } });
      await hub.tick();
    } else {
      getSnapshot.mockResolvedValueOnce(dependencySnapshot('BTCUSDT') as never);
      expect(await hub.refreshSymbols(['BTCUSDT'])).toBe(1);
    }
    expect(hub.freshness()).toMatchObject({ fresh: 2, total: 2, sequenceInvalid: 0, stale: [] });
    expect(hub.metrics()).toMatchObject({ recoveryFailures: [], klineRecovery: {
      pendingFrames: 0, lastFailure: { reason: restricted, httpStatus: 451 },
    } });
    expect(hub.recovery.get('BTCUSDT')).toMatchObject({ attempt: 0, reason: null, lastSuccessAt: Date.now() });
    await hub.recoverStale();
    expect(repairCandles).toHaveBeenCalledOnce();
    expect(getSnapshot).toHaveBeenCalledTimes(entrypoint === 'tick' ? 0 : 1);
  });

  it('does not settle a new ownership failure when an old snapshot refresh completes', async () => {
    const { hub, state, getSnapshot } = await failedRecoveryForDependencies();
    let finish!: (snapshot: any) => void;
    getSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const pending = hub.refreshSymbols(['BTCUSDT']);
    hub.setRetentionSymbols(['ETHUSDT']);
    hub.setRetentionSymbols(['BTCUSDT', 'ETHUSDT']);
    const current = dependencySnapshot('BTCUSDT');
    state.snapshots.set('BTCUSDT', current);
    hub.technicalBlocked.delete('BTCUSDT:1m');
    const replacementFailure = { attempt: 1, nextRetryAt: Date.now() + 60_000, lastSuccessAt: null, reason: 'NEW_OWNERSHIP_FAILURE' };
    hub.recovery.set('BTCUSDT', replacementFailure);
    finish(dependencySnapshot('BTCUSDT'));
    expect(await pending).toBe(0);
    expect(state.snapshots.get('BTCUSDT')).toBe(current);
    expect(hub.recovery.get('BTCUSDT')).toBe(replacementFailure);
    expect(hub.metrics().klineRecovery.lastFailure).toMatchObject({ reason: restricted, httpStatus: 451 });
  });

  it.each(['15m sequence', 'quote', 'slow frame'])('retains the failure while another %s dependency remains unusable', async (remaining) => {
    const { hub, state, repairCandles } = await failedRecoveryForDependencies();
    if (remaining === '15m sequence') hub.technicalBlocked.set('BTCUSDT:15m', { timeframe: '15m', sequence: 'other-hole', at: Date.now() });
    repairCandles.mockImplementation(async (_symbol: string, timeframe: string) => {
      if (timeframe === '15m') throw new Error(restricted);
      if (remaining === 'quote') state.snapshots.get('BTCUSDT').quote.ts -= 60_000;
      if (remaining === 'slow frame') state.snapshots.get('BTCUSDT').technical['1h'].asOf -= 8_000_000;
      hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
        ...snapshot.technical, '1m': { ...snapshot.technical['1m'] },
      } });
      return healedFacts;
    });
    expect(await hub.refreshEntryDependencies(['BTCUSDT'], 'BTCUSDT')).toBe(0);
    expect(hub.metrics().recoveryFailures).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', reason: restricted, lastSuccessAt: null })]);
    expect(hub.metrics().klineRecovery.lastFailure).toMatchObject({ reason: restricted, httpStatus: 451 });
  });

  it.each(['1m sequence', 'order book'])('does not equate a healthy reference refresh with recovery of its failed %s', async (remaining) => {
    const { hub, state, repairCandles } = await failedRecoveryForDependencies();
    hub.technicalBlocked.set('BTCUSDT:15m', { timeframe: '15m', sequence: 'reference-hole', at: Date.now() });
    if (remaining === 'order book') {
      hub.technicalBlocked.delete('BTCUSDT:1m');
      state.snapshots.get('BTCUSDT').orderBook.ts -= 60_000;
    }
    repairCandles.mockImplementationOnce(async () => {
      hub.provider.hydrateLiveTechnical = (snapshot: any) => ({ ...snapshot, technical: {
        ...snapshot.technical, '15m': { ...snapshot.technical['15m'] },
      } });
      return healedFacts;
    });
    expect(await hub.refreshEntryDependencies(['BTCUSDT'], 'SOLUSDT')).toBe(1);
    expect(hub.referenceReadyReasons('BTCUSDT')).toEqual([]);
    expect(hub.primaryReadyReasons('BTCUSDT')).not.toEqual([]);
    expect(hub.metrics().recoveryFailures).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', reason: restricted, lastSuccessAt: null })]);
  });

  it('cannot clear a new ownership failure when an old dependency repair completes', async () => {
    const { hub, state, repairCandles } = await failedRecoveryForDependencies();
    let finish!: (facts: typeof healedFacts) => void;
    repairCandles.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = hub.refreshEntryDependencies(['BTCUSDT'], 'BTCUSDT');
    hub.setRetentionSymbols(['ETHUSDT']);
    hub.setRetentionSymbols(['BTCUSDT', 'ETHUSDT']);
    state.snapshots.set('BTCUSDT', dependencySnapshot('BTCUSDT'));
    hub.technicalBlocked.delete('BTCUSDT:1m');
    const replacementFailure = { attempt: 1, nextRetryAt: Date.now() + 60_000, lastSuccessAt: null, reason: 'NEW_OWNERSHIP_FAILURE' };
    hub.recovery.set('BTCUSDT', replacementFailure);
    finish(healedFacts);
    await pending;
    expect(hub.primaryReadyReasons('BTCUSDT')).toEqual([]);
    expect(hub.recovery.get('BTCUSDT')).toBe(replacementFailure);
    expect(hub.metrics().klineRecovery.lastFailure).toMatchObject({ reason: restricted, httpStatus: 451 });
  });
});

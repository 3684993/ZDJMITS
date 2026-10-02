import {afterEach, expect, it, vi} from 'vitest';
import {EventBus} from '../events/eventBus.js';
import {MarketDataHub} from './marketDataHub.js';

const NOW = 1_800_000_000_000, SYMBOL = 'SOLUSDT';
function harness(quoteAt = NOW, symbol = SYMBOL, failedTimeframe = '1m') {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const snapshot: any = {symbol, dataCompleteness: 1,
    quote: {symbol, last: 100, bid: 99, ask: 101, ts: quoteAt},
    orderBook: {symbol, bids: [[99, 1]], asks: [[101, 1]], ts: NOW}, derivatives: {ts: NOW},
    technical: Object.fromEntries(['1m', '5m', '15m', '1h', '4h', '1d', '1w']
      .map(tf => [tf, {asOf: NOW, sampleSize: 240, isClosed: true}]))};
  const state: any = {snapshots: new Map([[symbol, snapshot]]), settings: {selection: {minDataCompleteness: .9}}};
  const provider = {
    getQuote: vi.fn(async () => ({...snapshot.quote, ts: Date.now()})),
    getOrderBook: vi.fn(async () => ({...snapshot.orderBook, ts: Date.now()})),
    getSnapshot: vi.fn(async () => snapshot),
    repairCandles: vi.fn(async () => ({ok: false, missing: 1, latestClosedAtBoundary: true})),
    // After reporting a failed sequence once, the real provider caches its fingerprint.
    // Publishing quote/book facts must not mistake that suppressed repeat for a repaired card.
    hydrateLiveTechnical: vi.fn((s: any) => s).mockImplementationOnce(() => {
      throw Object.assign(new Error('NON_CONTIGUOUS_CLOSED_BARS'), {technicalTimeframe: failedTimeframe, technicalSequence: 'known-gap'});
    }),
  };
  const hub = new MarketDataHub(provider as never, state, new EventBus());
  return {hub, provider, state, snapshot};
}
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

it('quote-only publication preserves a known invalid sequence until a technical repair succeeds', async () => {
  const {hub, provider, state, snapshot} = harness(NOW - 30_000);
  await hub.tick();
  expect(hub.primaryReadyReasons(SYMBOL)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
  expect(await hub.refreshEntryDependencies([SYMBOL], SYMBOL)).toBe(0);
  expect(provider.getQuote).toHaveBeenCalledOnce();
  expect(state.snapshots.get(SYMBOL).quote.ts).toBe(NOW);
  expect(state.snapshots.get(SYMBOL).technical['1m']).toBe(snapshot.technical['1m']);
  expect(hub.primaryReadyReasons(SYMBOL)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
  expect(provider.repairCandles).toHaveBeenCalledExactlyOnceWith(SYMBOL, '1m');
  expect(provider.getSnapshot).not.toHaveBeenCalled();
});

it('a failed candle repair and its cooldown do not fall through to repeated full snapshot requests', async () => {
  const {hub, provider} = harness();
  await hub.tick();
  for (const elapsed of [0, 5_001, 10_002]) {
    vi.setSystemTime(NOW + elapsed);
    expect(await hub.refreshEntryDependencies([SYMBOL], SYMBOL)).toBe(0);
    expect(hub.primaryReadyReasons(SYMBOL)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
  }
  expect(provider.repairCandles).toHaveBeenCalledExactlyOnceWith(SYMBOL, '1m');
  expect(provider.getSnapshot).not.toHaveBeenCalled();
  expect(provider.getQuote).not.toHaveBeenCalled();
  expect(provider.getOrderBook).not.toHaveBeenCalled();
});

it('keeps a known reference 15m sequence failure blocked despite fresh quote and card timestamps', async () => {
  const {hub, provider, snapshot} = harness(NOW, 'BTCUSDT', '15m');
  snapshot.orderBook.ts = NOW - 90_000;
  await hub.tick();
  expect(hub.referenceReadyReasons('BTCUSDT')).toEqual(['TECHNICAL_15m_SEQUENCE_INVALID']);
  expect(await hub.refreshEntryDependencies(['BTCUSDT'], SYMBOL)).toBe(0);
  expect(hub.referenceReadyReasons('BTCUSDT')).toEqual(['TECHNICAL_15m_SEQUENCE_INVALID']);
  expect(provider.repairCandles).toHaveBeenCalledExactlyOnceWith('BTCUSDT', '15m');
  expect(provider.getSnapshot).not.toHaveBeenCalled();
  expect(provider.getQuote).not.toHaveBeenCalled();
  expect(provider.getOrderBook).not.toHaveBeenCalled();
});

it('releases a reference 15m sequence failure only after a rebuilt card is published', async () => {
  const {hub, provider} = harness(NOW, 'ETHUSDT', '15m');
  await hub.tick();
  provider.repairCandles.mockImplementation(async () => {
    provider.hydrateLiveTechnical.mockImplementation((s: any) => ({...s, technical: {...s.technical, '15m': {...s.technical['15m']}}}));
    return {ok: true, missing: 0, latestClosedAtBoundary: true};
  });
  expect(await hub.refreshEntryDependencies(['ETHUSDT'], SYMBOL)).toBe(1);
  expect(hub.referenceReadyReasons('ETHUSDT')).toEqual([]);
  expect(provider.repairCandles).toHaveBeenCalledExactlyOnceWith('ETHUSDT', '15m');
  expect(provider.getSnapshot).not.toHaveBeenCalled();
});

it('does not make reference 1m, 5m or orderbook facts a dependency when the consumed evidence is usable', async () => {
  const {hub, provider, snapshot} = harness(NOW, 'BTCUSDT', '1m');
  snapshot.orderBook.ts = NOW - 90_000;
  snapshot.technical['5m'].asOf = NOW - 900_000;
  await hub.tick();
  expect(hub.primaryReadyReasons('BTCUSDT')).toContain('TECHNICAL_1m_SEQUENCE_INVALID');
  expect(hub.referenceReadyReasons('BTCUSDT')).toEqual([]);
  expect(await hub.refreshEntryDependencies(['BTCUSDT'], SYMBOL)).toBe(1);
  expect(provider.getQuote).not.toHaveBeenCalled();
  expect(provider.getOrderBook).not.toHaveBeenCalled();
  expect(provider.repairCandles).not.toHaveBeenCalled();
  expect(provider.getSnapshot).not.toHaveBeenCalled();
});

it('drops retry metadata on eviction and does not recreate it when an old ownership read completes', async () => {
  const {hub, provider, state, snapshot} = harness(NOW - 30_000);
  hub.setRetentionSymbols([SYMBOL]);
  await hub.refreshEntryDependencies([SYMBOL], SYMBOL);
  expect((hub as any).dependencyRetryAt.size).toBe(1);
  hub.setRetentionSymbols([]);
  expect((hub as any).dependencyRetryAt.size).toBe(0);

  hub.setRetentionSymbols([SYMBOL]);
  state.snapshots.set(SYMBOL, snapshot);
  let finish!: (quote: any) => void;
  provider.getQuote.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const pending = hub.refreshEntryDependencies([SYMBOL], SYMBOL);
  hub.setRetentionSymbols([]);
  finish({...snapshot.quote, ts: NOW});
  expect(await pending).toBe(0);
  expect(state.snapshots.has(SYMBOL)).toBe(false);
  expect((hub as any).dependencyRetryAt.size).toBe(0);
});

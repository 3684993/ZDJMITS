import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema, type MarketSymbolSnapshot } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type: 'json'};
import { EventBus, type DomainEvent } from '../events/eventBus.js';
import { RuntimeState } from '../state/runtimeState.js';
import { EntryCoordinator } from './entryCoordinator.js';
import { eipDependencyIssues, eipEvidenceError } from './eipDependencies.js';

const NOW = 1_800_000_000_000;
const candidate = 'XRPUSDT';
function snapshot(symbol: string, quoteAt = NOW): MarketSymbolSnapshot {
  return {symbol, dataCompleteness: 1, quote: {ts: quoteAt}, orderBook: {ts: NOW},
    technical: Object.fromEntries(['1m', '5m', '15m', '1h', '4h', '1d', '1w'].map(tf => [tf, {asOf: NOW}]))} as MarketSymbolSnapshot;
}
function harness(symbol = candidate) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const state = new RuntimeState(SystemSettingsSchema.parse(defaults));
  for (const required of new Set([symbol, 'BTCUSDT', 'ETHUSDT'])) state.snapshots.set(required, snapshot(required));
  const bus = new EventBus(), events: DomainEvent[] = [];
  bus.on('event', event => events.push(event));
  const build = vi.fn(() => {
    expect(eipDependencyIssues(symbol, state.snapshots, state.settings.selection.minDataCompleteness)).toEqual([]);
    return {evidenceCompleteness: 1};
  });
  const ai = {scout: vi.fn(), decide: vi.fn(), hasCapacity: vi.fn(() => true)};
  const market = {primaryReadyReasons: vi.fn((): string[] => []), referenceReadyReasons: vi.fn((_symbol: string): string[] => []), refreshEntryDependencies: vi.fn(async (symbols: string[]) => {
    for (const required of symbols) state.snapshots.set(required, snapshot(required));
    return symbols.length;
  })};
  const coordinator = new EntryCoordinator(state, {build} as never, ai as never, {} as never, bus, market as never);
  return {state, events, ai, market, build, coordinator, run: () => (coordinator as any).analyze(symbol)};
}
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

describe('selected Entry dependency preflight', () => {
  it('repairs stale BTC and ETH references before the first EIP without refreshing the candidate or pool', async () => {
    const h = harness();
    h.state.snapshots.get('BTCUSDT')!.quote.ts = NOW - 16_000;
    h.state.snapshots.get('ETHUSDT')!.quote.ts = NOW - 22_000;
    h.state.snapshots.set('UNRELATEDUSDT', snapshot('UNRELATEDUSDT', NOW - 90_000));
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['BTCUSDT', 'ETHUSDT'], candidate);
    expect(h.build).toHaveBeenCalledOnce();
    expect(h.state.snapshots.get('UNRELATEDUSDT')!.quote.ts).toBe(NOW - 90_000);
    expect(h.events.find(event => event.type === 'ENTRY_DEPENDENCY_PREFLIGHT')?.payload).toMatchObject({ready: true, modelCallConsumed: false});
  });

  it('takes a zero-refresh fast path when all consumed dependencies are fresh', async () => {
    const h = harness();
    // Reference order books and short cards are not consumed by EIP regime freshness.
    h.state.snapshots.get('BTCUSDT')!.orderBook.ts = NOW - 90_000;
    h.state.snapshots.get('ETHUSDT')!.technical['1m']!.asOf = NOW - 900_000;
    await h.run();
    expect(h.market.refreshEntryDependencies).not.toHaveBeenCalled();
    expect(h.build).toHaveBeenCalledOnce();
  });

  it('fails closed before EIP, Scout, Primary or reservation when the normal refresh still returns stale facts', async () => {
    const h = harness(), stale = NOW - 16_000;
    h.state.snapshots.get('BTCUSDT')!.quote.ts = stale;
    h.market.refreshEntryDependencies.mockResolvedValue(0);
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['BTCUSDT'], candidate);
    expect(h.state.snapshots.get('BTCUSDT')!.quote.ts).toBe(stale);
    expect(h.build).not.toHaveBeenCalled();
    expect(h.ai.scout).not.toHaveBeenCalled();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.state.entryReservations.size).toBe(0);
    expect(h.state.candidateLifecycle.get(candidate)).toMatchObject({status: 'TECHNICAL_COOLDOWN', failureCount: 0});
    expect(h.events.find(event => event.type === 'ENTRY_DECISION_BLOCKED')?.payload).toMatchObject({stage: 'EIP_DEPENDENCY_PREFLIGHT', modelCallConsumed: false});
  });

  it('rechecks references after the Primary slot wait and blocks before model spend', async () => {
    const h = harness();
    h.state.executionGovernance.mode = 'AUTO_RUNNING';
    h.state.settings.riskGovernance.entrySafetyMode = 'AUTO';
    h.ai.hasCapacity.mockImplementation(() => {
      h.state.snapshots.get('ETHUSDT')!.quote.ts = NOW - 16_000;
      return true;
    });
    h.market.refreshEntryDependencies.mockResolvedValue(0);
    await h.run();
    expect(h.build).toHaveBeenCalledOnce();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['ETHUSDT'], candidate);
    expect(h.events.find(event => event.type === 'ENTRY_DEPENDENCY_PREFLIGHT')?.payload).toMatchObject({stage: 'AFTER_PRIMARY_SLOT', ready: false});
    expect(h.ai.scout).not.toHaveBeenCalled();
    expect(h.ai.decide).not.toHaveBeenCalled();
  });

  it('requests each symbol once when the candidate is also the stale BTC reference', async () => {
    const h = harness('BTCUSDT');
    h.state.snapshots.get('BTCUSDT')!.quote.ts = NOW - 16_000;
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['BTCUSDT'], 'BTCUSDT');
    expect(h.build).toHaveBeenCalledOnce();
  });

  it('repairs absent reference snapshots and stale long timeframe cards through the same bounded request', async () => {
    const h = harness();
    h.state.snapshots.delete('BTCUSDT');
    h.state.snapshots.get('ETHUSDT')!.technical['1h']!.asOf = NOW - 7_205_001;
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['BTCUSDT', 'ETHUSDT'], candidate);
    expect(h.build).toHaveBeenCalledOnce();
  });

  it('retains candidate market sequence gates even when EIP age checks pass', async () => {
    const h = harness();
    h.market.primaryReadyReasons.mockReturnValue(['TECHNICAL_1m_SEQUENCE_INVALID']);
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith([candidate], candidate);
    expect(h.build).not.toHaveBeenCalled();
    expect(h.ai.decide).not.toHaveBeenCalled();
  });

  it('repairs a known reference 15m sequence failure despite otherwise fresh EIP evidence', async () => {
    const h = harness();
    h.market.referenceReadyReasons.mockImplementation(symbol => symbol === 'BTCUSDT' ? ['TECHNICAL_15m_SEQUENCE_INVALID'] : []);
    h.market.refreshEntryDependencies.mockImplementation(async () => {
      h.market.referenceReadyReasons.mockReturnValue([]);
      return 1;
    });
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['BTCUSDT'], candidate);
    expect(h.build).toHaveBeenCalledOnce();
  });

  it('blocks model spending if a consumed reference 15m sequence remains invalid after repair', async () => {
    const h = harness();
    h.market.referenceReadyReasons.mockImplementation(symbol => symbol === 'ETHUSDT' ? ['TECHNICAL_15m_SEQUENCE_INVALID'] : []);
    await h.run();
    expect(h.market.refreshEntryDependencies).toHaveBeenCalledExactlyOnceWith(['ETHUSDT'], candidate);
    expect(h.build).not.toHaveBeenCalled();
    expect(h.ai.scout).not.toHaveBeenCalled();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.events.find(event => event.type === 'ENTRY_DECISION_BLOCKED')?.payload).toMatchObject({
      stage: 'EIP_DEPENDENCY_PREFLIGHT', dependencies: [{symbol: 'ETHUSDT', reason: 'MARKET_DATA_STALE: TECHNICAL_15m_SEQUENCE_INVALID'}],
    });
  });

  it('uses the full candidate gate once when BTC is itself selected and the reference gate only for ETH', async () => {
    const h = harness('BTCUSDT');
    await h.run();
    expect(h.market.referenceReadyReasons).toHaveBeenCalledExactlyOnceWith('ETHUSDT');
    expect(h.market.primaryReadyReasons).toHaveBeenCalledExactlyOnceWith('BTCUSDT', NOW);
    expect(h.market.refreshEntryDependencies).not.toHaveBeenCalled();
  });
});

describe('shared EIP evidence contract', () => {
  it('keeps the 15-second quote limit exact for both candidate and reference roles', () => {
    const s = snapshot('BTCUSDT', NOW - 15_000);
    expect(eipEvidenceError(s, .95, false, NOW)).toBeNull();
    expect(eipEvidenceError(s, .95, true, NOW)).toBeNull();
    expect(eipEvidenceError(s, .95, false, NOW + 1)).toContain('EIP_EVIDENCE_STALE: BTCUSDT quote');
    expect(eipEvidenceError(s, .95, true, NOW + 1)).toContain('EIP_EVIDENCE_STALE: BTCUSDT quote');
  });

  it('checks full evidence when BTC is the candidate while allowing its reference-only omissions for another candidate', () => {
    const s = snapshot('BTCUSDT');
    delete s.technical['1m'];
    expect(eipEvidenceError(s, .95, true, NOW)).toBeNull();
    expect(eipEvidenceError(s, .95, false, NOW)).toBe('EIP_EVIDENCE_MISSING: BTCUSDT technical.1m');
    s.technical['1m'] = {asOf: NOW} as any;
    s.dataCompleteness = .5;
    expect(eipEvidenceError(s, .95, false, NOW)).toContain('EIP_EVIDENCE_INCOMPLETE');
  });
});

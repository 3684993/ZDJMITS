import { describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { ReconciliationService } from './reconciliationService.js';
import { EntryCoordinator } from './entryCoordinator.js';
import { reconcileCandidateLifecycles } from './candidateLifecycleDeriver.js';
import { advanceRemoteFactAudit } from './entryRiskOccupancy.js';

const settings = () => SystemSettingsSchema.parse({ ...defaults, appearance: { ...defaults.appearance, theme: 'BINANCE_NOIR' } });
const now = () => Date.now();

const historicalRow = (over: Record<string, unknown> = {}) => ({
  id: 'entry_old', intentId: 'intent_old', symbol: 'BTCUSDT', side: 'LONG', quantity: 2, price: 100,
  filledQuantity: 0, leverage: 20, status: 'CANCELED', exchangeOrderId: null, clientOrderId: 'ml_old',
  exchangeTerminalStatus: 'CANCELED', createdAt: now() - 86_400_000, updatedAt: now() - 86_400_000,
  absoluteExpiresAt: now() + 60_000, repriceCount: 0, factSource: null, reservationId: null, reachability: 1, ...over,
});

function fixture(rows: Record<string, unknown>[]) {
  const state = new RuntimeState(settings()), events: any[] = [];
  for (const row of rows) state.entryOrders.set((row as any).id, row as any);
  const bus = new EventBus(); bus.on('event', event => events.push(event));
  const adapter: any = {
    fetchOpenOrders: vi.fn(async () => []), fetchPositions: vi.fn(async () => []),
    findEntryByClientOrderId: vi.fn(async (_order: any) => null),
    fetchSymbolRiskFacts: vi.fn(async () => ({ fills: [], orders: [] })),
    fetchSymbolTradeFacts: vi.fn(async () => ({ fills: [], income: [], orders: [] })),
  };
  const service = new ReconciliationService(adapter, state, bus, { ensure: vi.fn() } as any);
  const pass = async () => { (service as any).lastFullOrderScanAt = 0; (service as any).lastUnknownRiskScanAt = 0; await service.run(); };
  const exactProbes = () => adapter.findEntryByClientOrderId.mock.calls.length;
  return { state, events, adapter, service, pass, exactProbes };
}

describe('remote fact audit integration', () => {
  it('performs zero per-order remote calls for a deferred historical row but still probes a fresh one', async () => {
    const escalated = advanceRemoteFactAudit(null, { sources: ['REMOTE_EXACT_ORDER_ABSENT'], reason: 'EXACT_ORDER_NOT_FOUND' }, now(), 'neverSubmitted', 'ENTRY:BTCUSDT:ml_old');
    const deferredRow = historicalRow({ remoteAudit: { ...escalated, tier: 2, consecutive: 9, nextAuditAt: now() + 3_600_000 } });
    const x = fixture([deferredRow]);
    await x.pass();
    expect(x.exactProbes()).toBe(0);
    expect(x.state.entryOrders.get('entry_old')).toBeTruthy();
    expect(x.service.health().historicalUnknownCount).toBe(0);

    const due = fixture([historicalRow({ remoteAudit: { ...escalated, nextAuditAt: now() - 1 } })]);
    await due.pass();
    expect(due.exactProbes()).toBe(1);
  });

  it('costs nothing at all for a row positively rejected before the wire call', async () => {
    const x = fixture([historicalRow({ factSource: 'LOCAL_NOT_SUBMITTED' })]);
    for (let pass = 0; pass < 4; pass++) { (x.service as any).terminalVerificationAttempts.clear(); await x.pass(); }
    expect(x.exactProbes()).toBe(0);
    expect(x.state.entryOrders.get('entry_old')).toBeTruthy();
  });

  it('records identical no-fact proofs once per state change instead of once per pass', async () => {
    const x = fixture([historicalRow()]);
    for (let pass = 0; pass < 6; pass++) { (x.service as any).terminalVerificationAttempts.clear(); await x.pass(); }
    const emitted = x.events.filter(event => event.type === 'ENTRY_ORDER_HISTORICAL_VERIFY_FAILED');
    expect(x.exactProbes()).toBeGreaterThanOrEqual(3);
    expect(emitted.length).toBeLessThanOrEqual(3);
    const stored = x.state.entryOrders.get('entry_old') as any;
    expect(stored.remoteAudit.consecutive).toBeGreaterThanOrEqual(2);
    expect(stored.status).toBe('CANCELED');
  });

  it('lets a live identity in open orders break the deferral immediately', async () => {
    const escalated = advanceRemoteFactAudit(null, { sources: ['REMOTE_EXACT_ORDER_ABSENT'], reason: 'EXACT_ORDER_NOT_FOUND' }, now(), 'neverSubmitted', 'ENTRY:BTCUSDT:ml_old');
    const row = historicalRow({ status: 'UNKNOWN', exchangeTerminalStatus: 'UNKNOWN', factSource: null, remoteAudit: { ...escalated, tier: 2, consecutive: 9, nextAuditAt: now() + 3_600_000 } });
    const x = fixture([row]);
    // still no valid no-risk proof for an UNKNOWN row, so it must be probed even with a future deadline
    await x.pass();
    expect(x.exactProbes()).toBe(1);

    const y = fixture([row]);
    y.adapter.fetchOpenOrders.mockResolvedValue([{ ...row, status: 'WORKING', exchangeOrderId: '777', verifiedAt: now(), updatedAt: now(), factSource: 'BINANCE_OPEN_ORDERS' }]);
    await y.pass();
    const restored = y.state.entryOrders.get('entry_old') as any;
    expect(restored.status).toBe('WORKING');
    expect(restored.activeRiskExposure).toBe(true);
    expect(restored.remoteAudit?.tier ?? 0).toBe(0);
    expect(y.state.entryCapacity().inFlight).toBe(1);
  });

  it('counts terminal audit tiers and reports a null last audit until one happens', async () => {
    const x = fixture([historicalRow()]);
    expect(x.service.health().unknownRiskLastAuditAt).toBe(null);
    expect(x.service.health().unknownRiskNextAuditAt).toBe(null);
    const byClass = x.service.health().remoteFactAuditsByClassAndTier as any[];
    expect(byClass.find(entry => entry.class === 'terminal').ladderMs).toEqual([5 * 60_000, 30 * 60_000, 60 * 60_000]);
    expect(byClass.find(entry => entry.class === 'neverSubmitted').ladderMs).toEqual([5 * 60_000, 30 * 60_000, 6 * 60 * 60_000]);
    await x.pass();
    const after = x.service.health().remoteFactAuditsByClassAndTier as any[];
    expect(after.find(entry => entry.class === 'terminal').tiers[0]).toBe(1);
    expect(x.service.health().unknownRiskLastAuditAt).toBe(null);
  });

  it('reviewPending skips the exact query for a deferred UNKNOWN and keeps it for a fresh one', async () => {
    const state = new RuntimeState(settings());
    const fresh = { id: 'entry_fresh', intentId: 'i_fresh', symbol: 'ETHUSDT', side: 'LONG', quantity: 2, price: 100, filledQuantity: 0, status: 'UNKNOWN', exchangeOrderId: null, clientOrderId: 'ml_fresh', createdAt: now() - 60_000, updatedAt: now(), absoluteExpiresAt: now() + 600_000, repriceCount: 0 };
    // A deferred UNKNOWN must carry the multi-source no-risk proof that earned the slower tier.
    const proof = { status: 'VERIFIED_NO_ACTIVE_RISK', sources: ['BINANCE_EXACT_ORDER_NOT_FOUND', 'BINANCE_OPEN_ORDERS_IDENTITY_ABSENT', 'BINANCE_USER_TRADES_IDENTITY_ABSENT', 'BINANCE_ALL_ORDERS_IDENTITY_ABSENT', 'BINANCE_LONG_SHORT_POSITION_ZERO'], checkedAt: now() - 60_000, validUntil: now() - 60_000 + 1_800_000, identityTombstone: 'ENTRY:BTCUSDT:ml_settled', reason: 'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT' };
    const settled = { ...fresh, id: 'entry_settled', symbol: 'BTCUSDT', clientOrderId: 'ml_settled', intentId: 'i_settled', activeRiskExposure: false, activeRiskEvidence: proof, remoteAudit: { tier: 2, consecutive: 9, nextAuditAt: now() + 1_800_000, factHash: 'h', verifiedCount: 9, lastAuditAt: now() - 1, lastEventAt: 0, lastEmittedReason: null } };
    state.entryOrders.set(fresh.id, fresh as any); state.entryOrders.set(settled.id, settled as any);
    const exchange = { findEntryByClientOrderId: vi.fn(async (_order: any) => null), cancelEntry: vi.fn(async (order: any) => ({ ...order, status: 'CANCELED' })), setLeverage: vi.fn(async () => {}) };
    const entry = new EntryCoordinator(state, {} as never, {} as never, exchange as never, new EventBus());
    await entry.reviewPending();
    const probed = exchange.findEntryByClientOrderId.mock.calls.map(call => (call[0] as any).id);
    expect(probed).toContain('entry_fresh');
    expect(probed).not.toContain('entry_settled');
    expect(probed.length).toBe(1);
  });

  it('emits lifecycle re-derivation only on a real transition', () => {
    const state = new RuntimeState(settings()), events: any[] = [];
    const bus = new EventBus(); bus.on('event', event => events.push(event));
    (state as any).universe = [{ symbol: 'BTCUSDT', eligible: true }];
    reconcileCandidateLifecycles(state, bus, 'TEST_FIRST');
    const afterFirst = events.filter(event => event.type === 'CANDIDATE_LIFECYCLE_REDERIVED').length;
    reconcileCandidateLifecycles(state, bus, 'TEST_SECOND');
    expect(events.filter(event => event.type === 'CANDIDATE_LIFECYCLE_REDERIVED').length).toBe(afterFirst);
    state.positions.set('exchange_BTCUSDT_LONG', { id: 'exchange_BTCUSDT_LONG', symbol: 'BTCUSDT', side: 'LONG', quantity: 2, entryPrice: 100, markPrice: 100, leverage: 20, unrealizedPnl: 0, unrealizedPnlPercent: 0, openedAt: now(), firstObservedAt: now(), entryTimeSource: 'SYSTEM_FILL', managementStatus: 'AUTO_MANAGED', humanManagedAt: null, tpStatus: 'PENDING', tpOrderId: null, tpLastVerifiedAt: null, tpCoverageSource: 'NONE', cycleId: 'cycle_x' } as any);
    reconcileCandidateLifecycles(state, bus, 'TEST_THIRD');
    const emitted = events.filter(event => event.type === 'CANDIDATE_LIFECYCLE_REDERIVED');
    expect(emitted.length).toBe(afterFirst + 1);
    expect(emitted.at(-1)!.payload).toMatchObject({ nextState: 'POSITION_HELD', trigger: 'TEST_THIRD' });
  });
});

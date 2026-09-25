import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';
import {collectPendingEntryRiskExposures,entryOrderOccupiesRisk,hasVerifiedNoActiveRisk,historicalNoRiskEligible,jitteredNextAuditAt,remoteRiskAudit,remoteRiskAuditDeferred,UNKNOWN_RISK_EVIDENCE_TIER_MS} from './entryRiskOccupancy.js';

/**
 * §B3: a historical UNKNOWN may only occupy pending risk while the *current* moment lacks a
 * verifiable no-active-risk proof. An inconclusive re-probe observes nothing, so it must not
 * downgrade a proof that has not expired yet — while anything the exchange positively reports
 * (a late fill, a reappearing order, a position that can be attributed) invalidates it at once.
 * The durable `UNKNOWN` status is never rewritten by any case below.
 */

const NO_RISK_SOURCES = ['BINANCE_EXACT_ORDER_NOT_FOUND', 'BINANCE_OPEN_ORDERS_IDENTITY_ABSENT', 'BINANCE_USER_TRADES_IDENTITY_ABSENT', 'BINANCE_ALL_ORDERS_IDENTITY_ABSENT', 'BINANCE_LONG_SHORT_POSITION_ZERO'];
const TOMBSTONE = 'ENTRY:FETUSDT:ml_fet';
const settings = () => SystemSettingsSchema.parse({...defaults, appearance: {...defaults.appearance, theme: 'BINANCE_NOIR'}});

const proof = (now: number, {ageMs = 60_000, ttlMs = UNKNOWN_RISK_EVIDENCE_TIER_MS[2]}: {ageMs?: number; ttlMs?: number} = {}) =>
  ({status: 'VERIFIED_NO_ACTIVE_RISK', sources: [...NO_RISK_SOURCES], checkedAt: now - ageMs, validUntil: now - ageMs + ttlMs, identityTombstone: TOMBSTONE, reason: 'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT'});

/** A promoted historical row: proof on the row, audit tier 2, next audit already due so this pass will probe. */
const provenOrder = (now: number, over: Record<string, unknown> = {}) => ({
  id: 'entry_fet', intentId: 'intent_fet', clientOrderId: 'ml_fet', exchangeOrderId: null, symbol: 'FETUSDT', side: 'LONG', quantity: 10, price: 1, filledQuantity: 0, leverage: 10,
  status: 'UNKNOWN', createdAt: now - 86_400_000, updatedAt: now - 60_000, absoluteExpiresAt: now + 60_000, repriceCount: 0, reservationId: 'r_fet', cycleId: 'cycle_fet', reachability: 1,
  activeRiskExposure: false, activeRiskEvidence: proof(now), remoteAudit: {tier: 2, consecutive: 9, nextAuditAt: now - 1, factHash: `${[...NO_RISK_SOURCES].sort().join(',')}|EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT`,
    verifiedCount: 9, lastAuditAt: now - 60_000, lastEventAt: now - 60_000, lastEmittedReason: 'EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK'}, ...over,
} as any);

function fixture(now: number, {order, riskFacts}: {order?: (now: number) => any; riskFacts?: (service: () => RuntimeState) => any} = {}) {
  const state = new RuntimeState(settings());
  const row = (order ?? provenOrder)(now);
  state.entryOrders.set(row.id, row);
  state.entryReservations.set('r_fet', {id: 'r_fet', underlying: 'FET', quoteAsset: 'USDT', marginUsd: 1, notionalUsd: 10, planId: 'p', intentId: 'intent_fet', createdAt: now - 86_400_000, expiresAt: now + 86_400_000, status: 'WORKING'} as any);
  const events: any[] = [];
  const bus = new EventBus();
  bus.on('event', event => events.push(event));
  const adapter: any = {fetchOpenOrders: vi.fn(async () => []), fetchPositions: vi.fn(async () => []), findEntryByClientOrderId: vi.fn(async () => null),
    fetchSymbolRiskFacts: vi.fn(riskFacts ? riskFacts(() => state) : async (symbol: string, start: number, end: number) => ({fills: [], orders: [], coverageComplete: true, coverageStart: start, coverageEnd: end})),
    fetchSymbolTradeFacts: vi.fn(async () => ({fills: [], income: [], orders: []}))};
  const service = new ReconciliationService(adapter, state, bus, {ensure: vi.fn()} as any);
  const pass = async () => {
    (service as any).lastFullOrderScanAt = 0;(service as any).lastUnknownRiskScanAt = 0;await service.run();
  };
  return {state, events, adapter, service, pass, row: () => state.entryOrders.get('entry_fet') as any};
}

describe('an inconclusive re-probe cannot downgrade a live no-active-risk proof', () => {
  beforeEach(() => {vi.useFakeTimers({now: Date.now(), toFake: ['Date']});});
  afterEach(() => {vi.useRealTimers();});

  it('NR-01 keeps the proof, the audit tier and the released claim when coverage comes back incomplete', async () => {
    const now = Date.now();
    const x = fixture(now, {riskFacts: () => async (symbol: string, start: number, end: number) => ({fills: [], orders: [], coverageStart: start, coverageEnd: end, coverageComplete: false})});
    const before = x.row();
    expect(entryOrderOccupiesRisk(before, now)).toBe(false);
    expect(remoteRiskAuditDeferred(before, now)).toBe(false);
    await x.pass();
    const after = x.row();
    expect(after.status).toBe('UNKNOWN');
    expect(after.activeRiskExposure).toBe(false);
    expect(after.activeRiskEvidence).toEqual(before.activeRiskEvidence);
    expect(remoteRiskAudit(after)!.tier).toBe(2);
    expect(collectPendingEntryRiskExposures(x.state, {now})).toEqual([]);
    expect(x.state.entryCapacity()).toMatchObject({inFlight: 0, used: 0});
    expect(x.events.filter(e => e.type === 'ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED' && e.payload.occupancyReleased === false)).toEqual([]);
    const retained = x.events.filter(e => e.type === 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED');
    expect(retained).toHaveLength(1);
    expect(retained[0].payload).toMatchObject({orderId: 'entry_fet', symbol: 'FETUSDT', inconclusiveBecause: 'RISK_FACT_COVERAGE_INCOMPLETE', occupancyReleased: true, proofValidUntil: before.activeRiskEvidence.validUntil});
    expect(x.state.entryReservations.get('r_fet')?.status).toBe('RELEASED');
  });

  it('NR-02 keeps the proof on a transport failure but schedules the fresh-cadence retry', async () => {
    const now = Date.now();
    const x = fixture(now, {riskFacts: () => async () => {throw new Error('BINANCE_TRANSPORT_BLOCKED:Binance request timed out');}});
    const before = x.row();
    await x.pass();
    const after = x.row(), audit = remoteRiskAudit(after)!;
    expect(after.activeRiskExposure).toBe(false);
    expect(after.activeRiskEvidence).toEqual(before.activeRiskEvidence);
    expect(audit.tier).toBe(2);
    expect(audit.factHash).toBe(remoteRiskAudit(before)!.factHash);
    // Retrying at the fastest tier is what keeps a preserved proof from outliving its evidence.
    expect(audit.nextAuditAt).toBeLessThanOrEqual(now + UNKNOWN_RISK_EVIDENCE_TIER_MS[0]);
    expect(audit.nextAuditAt).toBe(jitteredNextAuditAt(Date.now(), UNKNOWN_RISK_EVIDENCE_TIER_MS[0], `unknown|${TOMBSTONE}`));
    expect(x.events.some(e => e.type === 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED' && e.payload.inconclusiveBecause === 'RISK_FACT_READER_FAILED')).toBe(true);
  });

  it('NR-03 does not lose a proof that another write installed while this pass was awaiting the exchange', async () => {
    const now = Date.now();
    // The pass starts from an already-expired proof, so nothing in its own view is still valid.
    const stale = {checkedAt: now - 40 * 60_000, validUntil: now - 10 * 60_000};
    const x = fixture(now, {
      order: stamp => ({...provenOrder(stamp), activeRiskEvidence: {...proof(stamp), ...stale}, activeRiskExposure: true}),
      riskFacts: getState => async (symbol: string, start: number, end: number) => {
        const state = getState();
        // A renewal that lands mid-pass is the exact write the live account already agreed to.
        state.entryOrders.set('entry_fet', {...state.entryOrders.get('entry_fet')!, activeRiskExposure: false, activeRiskEvidence: proof(Date.now())} as any);
        return {fills: [], orders: [], coverageStart: start, coverageEnd: end, coverageComplete: false};
      },
    });
    await x.pass();
    const after = x.row();
    expect(after.activeRiskExposure).toBe(false);
    expect(after.activeRiskEvidence.validUntil).toBeGreaterThan(Date.now());
    expect(collectPendingEntryRiskExposures(x.state, {now: Date.now()})).toEqual([]);
  });

  it.each([
    ['a late user trade for the same identity', () => ({fills: [{clientOrderId: 'ml_fet', orderId: '123', symbol: 'FETUSDT', qty: 10, price: 1, executionTime: Date.now()}], orders: [], coverageComplete: true})],
    ['the order reappearing in open orders', () => ({fills: [], orders: [{clientOrderId: 'ml_fet', orderId: '88', symbol: 'FETUSDT'}], coverageComplete: true})],
  ] as const)('NR-04 still fails closed on %s', async (_label, facts) => {
    const x = fixture(Date.now(), {riskFacts: () => async () => facts()});
    await x.pass();
    const after = x.row();
    expect(after.status).toBe('UNKNOWN');
    expect(after.activeRiskExposure).toBe(true);
    expect(after.activeRiskEvidence.status).toBe('CONFLICT');
    expect(remoteRiskAudit(after)!.tier).toBe(0);
    expect(entryOrderOccupiesRisk(after, Date.now())).toBe(true);
    expect(collectPendingEntryRiskExposures(x.state, {now: Date.now()}).map(row => row.id)).toEqual(['order:entry_fet']);
    expect(x.events.some(e => e.type === 'ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT' && e.payload.failClosed === true)).toBe(true);
    expect(x.state.entryReservations.get('r_fet')?.status).toBe('WORKING');
  });

  it('NR-05 fails closed when an unattributable position appears for the same symbol and side', async () => {
    const now = Date.now();
    const x = fixture(now);
    // Same symbol/side, no cycle, no fill and no owning order: the position may be this order's fill.
    const position = {id: 'exchange_FETUSDT_LONG', cycleId: 'cycle_other', symbol: 'FETUSDT', side: 'LONG', quantity: 10, entryPrice: 1, markPrice: 1, leverage: 10,
      unrealizedPnl: 0, unrealizedPnlPercent: 0, openedAt: now, firstObservedAt: now, entryTimeSource: 'IMPORTED_AT_STARTUP', managementStatus: 'AUTO_MANAGED', humanManagedAt: null,
      tpStatus: 'PENDING', tpOrderId: null, tpLastVerifiedAt: null, tpCoverageSource: 'NONE'} as any;
    x.adapter.fetchPositions.mockResolvedValue([position]);
    await x.pass();
    const after = x.row();
    expect(after.activeRiskExposure).toBe(true);
    expect(entryOrderOccupiesRisk(after, Date.now())).toBe(true);
    expect(remoteRiskAudit(after)!.tier).toBe(0);
    expect(x.events.some(e => e.type === 'ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED')).toBe(true);
  });

  it('NR-06 returns the row to pending risk once its own proof window has closed', async () => {
    const now = Date.now();
    const x = fixture(now, {riskFacts: () => async (symbol: string, start: number, end: number) => ({fills: [], orders: [], coverageStart: start, coverageEnd: end, coverageComplete: false})});
    const expired = {...x.row(), activeRiskEvidence: {...proof(now, {ttlMs: 60_000}), checkedAt: now - 10 * 60_000, validUntil: now - 9 * 60_000}, activeRiskExposure: true};
    x.state.entryOrders.set('entry_fet', expired);
    expect(hasVerifiedNoActiveRisk(expired, Date.now())).toBe(false);
    await x.pass();
    const after = x.row();
    expect(after.activeRiskExposure).toBe(true);
    expect(collectPendingEntryRiskExposures(x.state, {now: Date.now()}).map(row => row.id)).toEqual(['order:entry_fet']);
    expect(after.status).toBe('UNKNOWN');
    expect(x.events.some(e => e.type === 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED')).toBe(false);
  });

  it('NR-07 never rewrites the durable UNKNOWN or invents a risk fact while preserving it', async () => {
    const now = Date.now();
    const x = fixture(now, {riskFacts: () => async (symbol: string, start: number, end: number) => ({fills: [], orders: [], coverageStart: start, coverageEnd: end, coverageComplete: false})});
    const before = x.row();
    await x.pass();
    const after = x.row();
    expect(after).toMatchObject({id: 'entry_fet', status: 'UNKNOWN', exchangeOrderId: null, filledQuantity: 0, symbol: 'FETUSDT', clientOrderId: 'ml_fet'});
    // The preserved proof is byte-identical to the one already on the row: nothing renewed or extended it.
    expect(after.activeRiskEvidence).toEqual(before.activeRiskEvidence);
    expect(after.activeRiskEvidence.validUntil).toBe(before.activeRiskEvidence.validUntil);
    expect(historicalNoRiskEligible(after, Date.now())).toBe(true);
    expect(remoteRiskAudit(after)!.verifiedCount).toBe(9);
  });

  it('NR-08 keeps the release cadence honest: a preserved proof is re-probed, not extended', async () => {
    const x = fixture(Date.now(), {riskFacts: () => async (symbol: string, start: number, end: number) => ({fills: [], orders: [], coverageStart: start, coverageEnd: end, coverageComplete: false})});
    await x.pass();
    const first = x.row();
    expect(first.activeRiskEvidence.validUntil).toBeGreaterThan(Date.now());
    // Every further inconclusive pass must ask again, and must never push the window out.
    for (let pass = 0; pass < 3; pass++) {
      vi.advanceTimersByTime(5 * 60_000 + 1_000);
      const before = x.row().activeRiskEvidence;
      await x.pass();
      expect(x.row().activeRiskEvidence).toEqual(before);
      expect(x.row().activeRiskExposure).toBe(false);
    }
    expect(x.adapter.fetchSymbolRiskFacts.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(remoteRiskAudit(x.row())!.tier).toBe(2);
  });
});

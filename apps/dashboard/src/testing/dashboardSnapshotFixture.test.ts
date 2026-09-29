import { describe, expect, it } from 'vitest';
import { DashboardSnapshotSchema } from '@zdj/contracts';
import { makeDashboardSnapshot, makePosition } from './dashboardSnapshotFixture';

describe('dashboard snapshot fixture', () => {
  it('produces a snapshot the live contract accepts, P7 read-side fields included', () => {
    const snapshot = makeDashboardSnapshot();
    expect(DashboardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.executionTruth?.activeCommissions).toMatchObject({
      remoteConfirmedEntry: 1, remoteConfirmedTakeProfit: 2, manual: 0, localUnresolvedUnknown: 4,
    });
    expect(snapshot.exitConvergence?.maxServiceIntervalMs).toBe(300_000);
    expect(snapshot.exchangeFillFacts?.fillsByProvenanceLast1h).toMatchObject({ UNPROVEN: 1 });
    expect(snapshot.positions[0]?.cycleId).toBe('cycle_BTCUSDT_LONG_1');
    expect(snapshot.positions[0]?.physicalCycleKey).toContain('BTCUSDT|LONG');
    expect(snapshot.settings.connections.exchange.environment).toBe('TESTNET');
  });

  it('lets a test override one nested fact without rebuilding the whole payload', () => {
    const snapshot = makeDashboardSnapshot({ account: { activeTpOrders: 5 }, positions: [makePosition({ id: 'pos_only' })] });
    expect(snapshot.account.activeTpOrders).toBe(5);
    expect(snapshot.account.activeEntryOrders).toBe(1);
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]?.id).toBe('pos_only');
    expect(snapshot.positions[0]?.entryTimeSource).toBe('SYSTEM_FILL');
    // fields the fixture never mentions still arrive with the contract's own defaults, not undefined
    expect(snapshot.positions[0]?.tpLastVerifiedAt).toBeNull();
    expect(snapshot.positions[0]?.positionRiskSource).toBeNull();
    expect(snapshot.positions[0]?.managementStatus).toBe('AUTO_MANAGED');
  });

  it('rejects a payload the Engine would never send instead of hiding the mistake', () => {
    expect(() => makeDashboardSnapshot({ account: { status: 'PROBABLY_READY' } })).toThrow();
    expect(() => makeDashboardSnapshot({ executionTruth: { activeCommissions: { remoteConfirmedEntry: -1 } } })).toThrow();
  });
});

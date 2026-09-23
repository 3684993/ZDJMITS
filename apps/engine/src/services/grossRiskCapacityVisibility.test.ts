import { describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { directionBudget, portfolioCapacityVisibility, type PositionCapacity } from './riskReadiness.js';
import { governanceFieldOf } from '../config/governanceSettingsMatrix.js';
import { harness } from './tradingQualityTestHarness.js';

/**
 * The gross/direction exposure caps are already the authoritative backend fields. These tests pin
 * what the Engine projects about them, and that a capacity-blocked book is never described to the
 * operator as "no candidate has arrived".
 */
const settings = (grossPct: number, directionPct = 0.5) =>
  SystemSettingsSchema.parse({
    ...defaults,
    riskGovernance: { ...defaults.riskGovernance, maxGrossExposurePct: grossPct, maxDirectionExposurePct: directionPct },
    appearance: { ...defaults.appearance, theme: 'BINANCE_NOIR' },
  });
type Held = { symbol: string; side: 'LONG' | 'SHORT'; quantity: number; markPrice: number; leverage: number };
const position = (symbol: string, side: 'LONG' | 'SHORT', quantity: number, markPrice: number): Held =>
  ({ symbol, side, quantity, markPrice, leverage: 8 });
/** The projection only reads quantity/markPrice/side, so the fixture rows stay partial on purpose. */
const headroom = (parsed: ReturnType<typeof settings>, equity: number, rows: Held[], at = Date.now()) =>
  directionBudget(parsed as never, equity, rows as never, at);
const book = (...rows: Held[]) => new Map(rows.map(row => [row.symbol, row]));
const slots = (positions: number, max = 50): PositionCapacity => ({ positions, inFlight: 0, reserved: 0, used: positions, max });

describe('gross and direction exposure headroom projection', () => {
  it('projects the dynamic limits from equity x the stored ratio and leaves the gate outputs unchanged', () => {
    const at = Date.now();
    const budget = headroom(settings(1), 10_000, [position('AAAUSDT', 'LONG', 100, 10), position('BBBUSDT', 'SHORT', 50, 20)], at);
    expect(budget.equityUsd).toBe(10_000);
    expect(budget.grossLimitUsd).toBe(10_000);
    expect(budget.directionLimitUsd).toBe(5_000);
    expect(budget.grossNotionalUsd).toBe(2_000);
    expect(budget.longNotionalUsd).toBe(1_000);
    expect(budget.shortNotionalUsd).toBe(1_000);
    expect(budget.remainingGrossUsd).toBe(8_000);
    expect(budget.grossUsedPct).toBeCloseTo(0.2, 10);
    expect(budget.evaluatedAt).toBe(at);
    expect(budget.grossAvailableNotionalUsd).toBe(8_000);
    expect(budget.longAvailableNotionalUsd).toBe(4_000);
    expect(budget.shortAvailableNotionalUsd).toBe(4_000);
  });

  it('reads the stored ratio: 1 = 100% equity, 2 = 200% equity, 0.5 = 50% per direction', () => {
    expect(headroom(settings(1), 10_000, [], Date.now()).grossLimitUsd).toBe(10_000);
    expect(headroom(settings(2), 10_000, [], Date.now()).grossLimitUsd).toBe(20_000);
    expect(headroom(settings(0.5), 10_000, [], Date.now()).directionLimitUsd).toBe(5_000);
    expect(headroom(settings(20), 10_000, [], Date.now()).grossLimitUsd).toBe(200_000);
  });

  it('binds the first capacity blocker in the order the gates themselves run', () => {
    const full = [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)];
    const blocked = portfolioCapacityVisibility(slots(27), headroom(settings(1), 10_000, full, Date.now()));
    expect(blocked.gross.remainingUsd).toBe(0);
    expect(blocked.firstBlocker).toBe('GROSS');
    // 27/50 slots say nothing about new-risk headroom.
    expect(blocked.slots.used).toBe(27);
    expect(blocked.slots.max).toBe(50);
    const oneSide = portfolioCapacityVisibility(slots(1), headroom(settings(4, 0.5), 10_000, [position('ZZZUSDT', 'SHORT', 100, 50)], Date.now()));
    expect(oneSide.gross.remainingUsd).toBeGreaterThan(0);
    expect(oneSide.direction.SHORT.remainingUsd).toBe(0);
    expect(oneSide.direction.LONG.remainingUsd).toBeGreaterThan(0);
    expect(oneSide.firstBlocker).toBe('DIRECTION_SHORT');
    const noSlots = portfolioCapacityVisibility(slots(50), headroom(settings(1), 10_000, [], Date.now()));
    expect(noSlots.gross.remainingUsd).toBe(10_000);
    expect(noSlots.firstBlocker).toBe('POSITION_CAPACITY');
    expect(portfolioCapacityVisibility(slots(0), headroom(settings(1), 10_000, [], Date.now())).firstBlocker).toBe('NONE');
  });

  it('recovers headroom from a manual reduction with no threshold, mode or restart change', () => {
    const s = settings(1);
    const full = [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)];
    const before = portfolioCapacityVisibility(slots(2), headroom(s, 10_000, full, Date.now()));
    expect(before.firstBlocker).toBe('GROSS');
    const after = portfolioCapacityVisibility(slots(1), headroom(s, 10_000, [full[1]], Date.now()));
    expect(after.gross.remainingUsd).toBeGreaterThan(0);
    expect(after.gross.limitUsd).toBe(before.gross.limitUsd);
    expect(after.firstBlocker).not.toBe('GROSS');
  });

  it('exposes both caps through the existing governance write boundary as NEXT_ENTRY_CYCLE ratios', () => {
    for (const [path, defaultValue] of [['riskGovernance.maxGrossExposurePct', 1], ['riskGovernance.maxDirectionExposurePct', 0.5]] as const) {
      expect(governanceFieldOf(path)).toMatchObject({ kind: 'number', unit: 'RATIO', min: 0.0001, max: 20, defaultValue, editable: true, effectiveAt: 'NEXT_ENTRY_CYCLE' });
    }
  });

  it('raises only future admission when the operator raises a cap, never an existing position', () => {
    const held = position('BTCUSDT', 'LONG', 0.1, 86_000);
    const rows = book(held);
    const before = headroom(settings(1), 10_000, [...rows.values()], Date.now());
    const after = headroom(settings(2), 10_000, [...rows.values()], Date.now());
    expect(after.grossLimitUsd).toBe(before.grossLimitUsd * 2);
    expect(after.grossNotionalUsd).toBe(before.grossNotionalUsd);
    expect(held).toEqual({ symbol: 'BTCUSDT', side: 'LONG', quantity: 0.1, markPrice: 86_000, leverage: 8 });
    expect([...rows.values()]).toHaveLength(1);
  });
});

describe('capacity starvation is never reported as a missing candidate', () => {
  function pipeline() {
    const h = harness();
    h.state.settings.connections.executionMode = 'READ_ONLY';
    h.state.settings.riskGovernance = { ...h.state.settings.riskGovernance, maxGrossExposurePct: 1, maxDirectionExposurePct: 0.5 };
    (h.ai as unknown as { probePrimaryIfDue: unknown }).probePrimaryIfDue = vi.fn(async () => {});
    (h.supplied as { quantityUnits?: number }).quantityUnits = 1000;
    const setIdle = vi.fn();
    (h.ai as unknown as { setIdleContext: unknown }).setIdleContext = setIdle;
    h.state.snapshots.set('BTCUSDT', { ...h.state.snapshots.get(h.packet.symbol)!, symbol: 'BTCUSDT' });
    h.state.snapshots.set('ETHUSDT', { ...h.state.snapshots.get(h.packet.symbol)!, symbol: 'ETHUSDT' });
    // A human-held book that consumes the whole 100%-of-equity gross cap. The candidate's own
    // underlying stays free, so exposure — not occupancy — is what binds.
    h.state.positions.set('SOLUSDT', { symbol: 'SOLUSDT', side: 'LONG', quantity: 400, markPrice: 25.1, leverage: 5 } as never);
    // The same assignment RuntimeControlService.evaluate() makes every capital check cycle: the
    // stored budget is the object the gates just consumed, not a second computation.
    const sync = () => {
      const budget = directionBudget(h.state.settings, Number(h.state.account.equityUsd), [...h.state.positions.values()], Date.now());
      h.state.runtimeControl.capital.directionBudget = budget as never;
      return portfolioCapacityVisibility(h.state.entryCapacity(), budget);
    };
    return { h, setIdle, sync, lastIdle: () => setIdle.mock.calls.at(-1) ?? [] };
  }

  it('names the capacity blocker while eligible candidates exist but no risk headroom does', async () => {
    const { h, sync, lastIdle } = pipeline();
    expect(sync().firstBlocker).toBe('GROSS');
    await h.coordinator.processPool();
    expect(lastIdle()[0]).toBe('WAITING_EXECUTION_CAPACITY');
    // The operator sees which gate bound, at what size, instead of an unexplained silence.
    expect(lastIdle()[2]).toBe('新增风险额度已用尽：GROSS（Gross $10040.00 / $10000.00，槽位 1/50）；继续供给与订单维护');
    expect(h.events.some(event => event.type === 'ANALYSIS_DISPATCH_INTENT')).toBe(false);
    expect(h.ai.decide).not.toHaveBeenCalled();
  });

  it('still says WAITING_CANDIDATE when there is genuinely no supply', async () => {
    const { h, sync, lastIdle } = pipeline();
    h.state.positions.clear();
    h.state.universe = [];
    h.state.pool.remove(h.packet.symbol);
    expect(sync().firstBlocker).toBe('NONE');
    await h.coordinator.processPool();
    expect(lastIdle()[0]).toBe('WAITING_CANDIDATE');
    expect(String(lastIdle()[2])).not.toContain('GROSS');
  });

  it('resumes PRIMARY on the next tick after a manual reduction, with every exchange write still zero', async () => {
    const { h, sync, lastIdle } = pipeline();
    sync();
    await h.coordinator.processPool();
    expect(lastIdle()[0]).toBe('WAITING_EXECUTION_CAPACITY');
    // The operator closes the position by hand. Nothing is restarted, no threshold moves, and the
    // permission stays READ_ONLY.
    const thresholds = JSON.stringify(h.state.settings.riskGovernance);
    const mode = h.state.settings.connections.executionMode;
    h.state.positions.delete('SOLUSDT');
    expect(h.state.settings.connections.executionMode).toBe(mode);
    expect(JSON.stringify(h.state.settings.riskGovernance)).toBe(thresholds);
    expect(sync().firstBlocker).toBe('NONE');
    await h.coordinator.processPool();
    // The dispatch intent is synchronous; the read-only completion runs through the async analysis
    // chain, so it is awaited by outcome rather than by a fixed number of scheduler ticks.
    const settled = async (predicate: () => boolean) => {
      for (let attempt = 0; attempt < 60 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      return predicate();
    };
    expect(h.events.some(event => event.type === 'ANALYSIS_DISPATCH_INTENT')).toBe(true);
    expect(await settled(() => h.events.some(event => event.type === 'ANALYSIS_ONLY_COMPLETED'))).toBe(true);
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.state.entryIntents.size).toBe(0);
    expect(h.state.entryOrders.size).toBe(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.exchange.cancelEntry).not.toHaveBeenCalled();
    expect(h.exchange.setLeverage).not.toHaveBeenCalled();
    expect(h.events.find(event => event.type === 'ANALYSIS_DISPATCH_INTENT')?.payload?.mode).toBe('ANALYSIS_ONLY');
  });

  it('types the projection against the same directionBudget result the gates consume', () => {
    const visibility = portfolioCapacityVisibility(slots(27), headroom(settings(1), 10_000, [position('AAAUSDT', 'LONG', 100, 10)], Date.now()));
    expect(Object.keys(visibility).sort()).toEqual(['direction', 'evaluatedAt', 'firstBlocker', 'gross', 'slots']);
    expect(visibility.direction.LONG).toMatchObject({ notionalUsd: 1_000, limitUsd: 5_000, remainingUsd: 4_000 });
  });
});

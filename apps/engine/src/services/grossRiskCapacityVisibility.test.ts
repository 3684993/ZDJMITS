import { describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { directionBudget, portfolioCapacityVisibility, type PositionCapacity } from './riskReadiness.js';
import { capitalCapacityForQuoteAsset } from './capitalCapacity.js';
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

  it('publishes the stored 0.8 direction cap as the same limit for both sides and both surfaces', () => {
    // The live Testnet setting is maxDirectionExposurePct=0.8: one Engine number must reach the API
    // projection and the cockpit, with no surface substituting the gross limit for it.
    const at = Date.now();
    const budget = headroom(settings(1, 0.8), 10_000, [position('AAAUSDT', 'LONG', 100, 10)], at);
    expect(budget.directionLimitUsd).toBeCloseTo(8_000, 8);
    const view = portfolioCapacityVisibility(slots(1), budget);
    expect(view.exposure.LONG.limitUsd).toBeCloseTo(8_000, 8);
    expect(view.exposure.SHORT.limitUsd).toBeCloseTo(8_000, 8);
    // Gross is a different question and keeps its own ceiling.
    expect(view.exposure.gross.limitUsd).toBeCloseTo(10_000, 8);
    expect(view.exposure.LONG.remainingUsd).toBeCloseTo(7_000, 8);
  });

  it('binds the first capacity blocker in the order the gates themselves run', () => {
    const full = [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)];
    const blocked = portfolioCapacityVisibility(slots(27), headroom(settings(1), 10_000, full, Date.now()));
    expect(blocked.exposure.gross.remainingUsd).toBe(0);
    expect(blocked.firstBlocker).toBe('GROSS');
    // 27/50 slots say nothing about new-risk headroom.
    expect(blocked.limits.slots.used).toBe(27);
    expect(blocked.limits.slots.max).toBe(50);
    const oneSide = portfolioCapacityVisibility(slots(1), headroom(settings(4, 0.5), 10_000, [position('ZZZUSDT', 'SHORT', 100, 50)], Date.now()));
    expect(oneSide.exposure.gross.remainingUsd).toBeGreaterThan(0);
    expect(oneSide.exposure.SHORT.remainingUsd).toBe(0);
    expect(oneSide.exposure.LONG.remainingUsd).toBeGreaterThan(0);
    expect(oneSide.firstBlocker).toBe('DIRECTION_SHORT');
    const noSlots = portfolioCapacityVisibility(slots(50), headroom(settings(1), 10_000, [], Date.now()));
    expect(noSlots.exposure.gross.remainingUsd).toBe(10_000);
    expect(noSlots.firstBlocker).toBe('POSITION_CAPACITY');
    expect(portfolioCapacityVisibility(slots(0), headroom(settings(1), 10_000, [], Date.now())).firstBlocker).toBe('NONE');
  });

  it('keeps a single saturated side from being reported as an exhausted book (the live t1/t2 case)', () => {
    // 100% gross, 50% per direction: a $6,000 SHORT book fills the direction cap while $4,000 of
    // gross and LONG headroom remain. The pre-fix predicate called this "额度已用尽".
    const view = portfolioCapacityVisibility(slots(1), headroom(settings(1), 10_000, [position('SEOUSDT', 'SHORT', 600, 10)], Date.now()));
    expect(view.firstBlocker).toBe('DIRECTION_SHORT');
    expect(view.blockingDimensions).toEqual(['DIRECTION_SHORT']);
    expect(view.exhaustedForNewRisk).toBe(false);
    expect(view.exhaustedReason).toBeNull();
    expect(view.exposure.gross.remainingUsd).toBe(4_000);
    // LONG's own dimension has $5,000 free; the $4,000 that actually limits new risk is the gross
    // ratio above it, and it is reported separately instead of being folded into the direction line.
    expect(view.exposure.LONG.remainingUsd).toBe(5_000);
    expect(view.exposure.LONG.mode).toBe('ENFORCE');
    expect(view.exposure.SHORT.remainingUsd).toBe(0);
  });

  it('reports an exhausted book only when a gate denies every new risk', () => {
    const gross = portfolioCapacityVisibility(slots(27), headroom(settings(1), 10_000, [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)], Date.now()));
    expect(gross.exposure.gross.remainingUsd).toBe(0);
    expect(gross.exhaustedForNewRisk).toBe(true);
    expect(gross.exhaustedReason).toBe('GROSS');
    const bothSides = portfolioCapacityVisibility(slots(2), headroom(settings(2, 0.5), 10_000, [position('AAAUSDT', 'LONG', 50, 100), position('BBBUSDT', 'SHORT', 50, 100)], Date.now()));
    expect(bothSides.exposure.gross.remainingUsd).toBe(10_000);
    expect(bothSides.exposure.LONG.remainingUsd).toBe(0);
    expect(bothSides.exposure.SHORT.remainingUsd).toBe(0);
    expect(bothSides.firstBlocker).toBe('DIRECTION_LONG');
    expect(bothSides.exhaustedForNewRisk).toBe(true);
    expect(bothSides.exhaustedReason).toBe('BOTH_DIRECTIONS');
    const slotsFull = portfolioCapacityVisibility(slots(50), headroom(settings(2), 10_000, [], Date.now()));
    expect(slotsFull.exposure.gross.remainingUsd).toBe(20_000);
    expect(slotsFull.exhaustedReason).toBe('POSITION_CAPACITY');
    const unevaluated = portfolioCapacityVisibility(slots(0), { ...headroom(settings(1), 10_000, [], Date.now()), evaluatedAt: 0 });
    expect(unevaluated.firstBlocker).toBe('NOT_EVALUATED');
    expect(unevaluated.exhaustedForNewRisk).toBe(false);
  });


  it('recovers headroom from a manual reduction with no threshold, mode or restart change', () => {
    const s = settings(1);
    const full = [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)];
    const before = portfolioCapacityVisibility(slots(2), headroom(s, 10_000, full, Date.now()));
    expect(before.firstBlocker).toBe('GROSS');
    const after = portfolioCapacityVisibility(slots(1), headroom(s, 10_000, [full[1]], Date.now()));
    expect(after.exposure.gross.remainingUsd).toBeGreaterThan(0);
    expect(after.exposure.gross.limitUsd).toBe(before.exposure.gross.limitUsd);
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
    // stored budget and the executable count are the object the gates just consumed, not a second
    // computation. A book that denies all new risk leaves no executable candidate; otherwise the
    // routed candidates stay executable and some other layer decides whether to dispatch.
    const sync = () => {
      const budget = directionBudget(h.state.settings, Number(h.state.account.equityUsd), [...h.state.positions.values()], Date.now());
      const view = portfolioCapacityVisibility(h.state.entryCapacity(), budget, {routes:h.state.runtimeControl.capital.routedCandidates??[]});
      h.state.runtimeControl.capital.directionBudget = budget as never;
      h.state.runtimeControl.capital.executableCandidateCount = view.exhaustedForNewRisk ? 0 : h.state.runtimeControl.capital.routedCandidates.length;
      return view;
    };
    return { h, setIdle, sync, lastIdle: () => setIdle.mock.calls.at(-1) ?? [] };
  }

  it('does not claim exhausted risk when only one side is full and a candidate is still executable', async () => {
    const { h, sync, lastIdle } = pipeline();
    // The live t1/t2 shape: SHORT fills its 50% cap while Gross and LONG keep ~$4,000 of headroom,
    // the routed candidate is executable on LONG, and the reason nothing dispatched is that the
    // candidate's own underlying is already held.
    h.state.positions.delete('SOLUSDT');
    h.state.positions.set('SEOUSDT', { symbol: 'SEOUSDT', side: 'SHORT', quantity: 600, markPrice: 10, leverage: 5 } as never);
    h.state.positions.set('4USDT', { symbol: '4USDT', side: 'SHORT', quantity: 1, markPrice: 0.03, leverage: 5 } as never);
    sync();
    expect(h.state.runtimeControl.capital.executableCandidateCount).toBe(1);
    await h.coordinator.processPool();
    expect(lastIdle()[0]).not.toBe('WAITING_EXECUTION_CAPACITY');
    expect(String(lastIdle()[2])).not.toContain('已用尽');
    expect(h.events.some(event => event.type === 'ANALYSIS_DISPATCH_INTENT')).toBe(false);
  });

  it('names the capacity blocker while eligible candidates exist but no risk headroom does', async () => {
    const { h, sync, lastIdle } = pipeline();
    expect(sync().firstBlocker).toBe('GROSS');
    await h.coordinator.processPool();
    expect(lastIdle()[0]).toBe('WAITING_EXECUTION_CAPACITY');
    // The operator sees which gate bound, how large the book is, and under which policy — never a
    // notional ratio dressed up as a remaining money balance.
    const spoken = String(lastIdle()[2]);
    expect(spoken).toContain('新增风险额度已用尽：GROSS');
    expect(spoken).toContain('首因');
    expect(spoken).toContain('槽位 1/50');
    expect(spoken).toContain('组合名义 $10040.00');
    expect(spoken).toContain('其政策为 ENFORCE');
    expect(spoken).not.toMatch(/Gross 剩/);
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

  it('observes a notional ratio without letting it veto or rename itself as money', () => {
    const at = Date.now();
    const marginDriven = (gross: string, direction: string) => SystemSettingsSchema.parse({
      ...defaults, appearance: {...defaults.appearance, theme: 'BINANCE_NOIR'},
      riskGovernance: {...defaults.riskGovernance, maxGrossExposurePct: 1, maxDirectionExposurePct: 0.5, exposureCapacityPolicy: {gross, direction, cluster: 'ENFORCE'}},
    });
    const spent = headroom(marginDriven('OBSERVE', 'OBSERVE'), 10_000, [position('BTCUSDT', 'LONG', 0.1, 86_000), position('AVAXUSDT', 'SHORT', 800, 11)], at);
    // The default document still enforces both ratios, and the fact itself is never deleted.
    expect(headroom(settings(1), 10_000, [], at).policy).toEqual({gross: 'ENFORCE', direction: 'ENFORCE', cluster: 'ENFORCE'});
    expect(spent.grossLimitUsd).toBe(10_000);
    expect(spent.remainingGrossUsd).toBe(0);
    const view = portfolioCapacityVisibility(slots(27), spent);
    expect(view.exposure.gross).toMatchObject({mode: 'OBSERVE', enforced: false, remainingUsd: 0, notionalUsd: 17_400, limitUsd: 10_000});
    expect(view.firstBlocker).toBe('NONE');
    expect(view.exhaustedForNewRisk).toBe(false);
    // A funded account is reported as funded even while the ratio is over its observed ceiling.
    const funded = portfolioCapacityVisibility(slots(1), spent, {funding: [
      capitalCapacityForQuoteAsset({quoteAsset: 'USDT', availableBalanceUsd: 3_861.56, reservedMarginUsd: 0, executionLeaseMarginUsd: 0}),
      capitalCapacityForQuoteAsset({quoteAsset: 'USDC', availableBalanceUsd: 4_972.88, reservedMarginUsd: 0, executionLeaseMarginUsd: 0}),
    ]});
    expect(funded.funding.executableMarginUsd).toBeCloseTo(8_834.44, 2);
    expect(funded.funding.proven).toBe(true);
    // With no money left, the blocker is the money — not the ratio.
    const broke = portfolioCapacityVisibility(slots(1), spent, {funding: [capitalCapacityForQuoteAsset({quoteAsset: 'USDT', availableBalanceUsd: 0, reservedMarginUsd: 0, executionLeaseMarginUsd: 0})]});
    expect(broke.exhaustedReason).toBe('AVAILABLE_MARGIN');
    expect(broke.exposure.gross.mode).toBe('OBSERVE');
  });

  it('types the projection against the same directionBudget result the gates consume', () => {
    const visibility = portfolioCapacityVisibility(slots(27), headroom(settings(1), 10_000, [position('AAAUSDT', 'LONG', 100, 10)], Date.now()));
    expect(Object.keys(visibility).sort()).toEqual(['blockingDimensions', 'entryCapacity', 'evaluatedAt', 'exhaustedForNewRisk', 'exhaustedReason', 'funding', 'limits', 'firstBlocker', 'exposure'].sort());
    expect(visibility.exposure.LONG).toMatchObject({ notionalUsd: 1_000, limitUsd: 5_000, remainingUsd: 4_000 });
  });
});

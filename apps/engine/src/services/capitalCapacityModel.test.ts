import {describe,expect,it} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {computeExecutableRiskHeadroom} from './executableRiskHeadroom.js';
import {capitalCapacityForQuoteAsset, candidateCapitalCapacity} from './capitalCapacity.js';

/**
 * §C: real money and portfolio notional are two different questions.
 *
 * The facts below are the frozen 2026-09-25 Testnet baseline: equity $10,728.75, book gross
 * $10,820.94 (i.e. `maxGrossExposurePct=1` is already spent), $3,861.56 USDT and $4,972.88 USDC of
 * genuinely available margin, 17 of 50 slots used, PortfolioRisk profile READY. Under the old model
 * that shape leaves about $34 of "new risk allowance" for every candidate, which is a limit about a
 * notional ratio, not a statement about money — and it makes the remaining 33 slots unreachable.
 */

const EQUITY = 10_728.748015;
const positions = [
  {symbol: 'BTCUSDT', side: 'LONG' as const, quantity: 0.01, markPrice: 84_712.9},
  {symbol: 'ETHUSDT', side: 'SHORT' as const, quantity: 1.1, markPrice: 3_980.4},
  {symbol: 'SOLUSDT', side: 'SHORT' as const, quantity: 42, markPrice: 178.4},
  {symbol: 'UNIUSDT', side: 'SHORT' as const, quantity: 117, markPrice: 9.206},
  {symbol: 'PENGUUSDT', side: 'SHORT' as const, quantity: 36_332, markPrice: 0.009724},
];
const grossOf = () => positions.reduce((n, row) => n + row.quantity * row.markPrice, 0);

const settingsWith = (policy?: Record<string, string>) => SystemSettingsSchema.parse({
  ...defaults,
  appearance: {...defaults.appearance, theme: 'BINANCE_NOIR'},
  ...(policy ? {riskGovernance: {...defaults.riskGovernance, exposureCapacityPolicy: policy}} : {}),
});

const MARGIN_USDT = {quoteAsset: 'USDT', availableBalanceUsd: 3_861.560262, reservedMarginUsd: 0, executionLeaseMarginUsd: 0} as const;
const usdtCapital = (over: Record<string, unknown> = {}) => candidateCapitalCapacity({...MARGIN_USDT, leverage: 10, leverageFact: 'CANDIDATE_RECOMMENDED', maxMarginPerPositionUsd: 1_000, maxEquityPctPerPosition: 0.1, minimumNotionalUsd: 1, ...over});

const headroom = (settings: ReturnType<typeof SystemSettingsSchema.parse>, over: Record<string, unknown> = {}) => computeExecutableRiskHeadroom({
  settings, equity: EQUITY, positions, pendingRiskExposures: [], symbol: 'LINKUSDT', side: 'LONG', plannedNotional: Number.MAX_SAFE_INTEGER,
  expectedAdverseMovePct: 0.006, dailyDrawdownPct: 0.01, capital: usdtCapital(), ...over,
} as never);

describe('margin-driven capacity is separated from the notional exposure facts', () => {
  it('CC-01 keeps the enforced default exactly as it behaves today', () => {
    const h = headroom(settingsWith());
    expect(grossOf()).toBeGreaterThan(EQUITY);
    expect(h.remaining.gross).toBe(0);
    expect(h.blockers).toContain('REJECT_GROSS_EXPOSURE');
    expect(h.finalNotional).toBe(0);
    expect(h.executable).toBe(false);
    expect(h.firstBindingConstraint).toBe('GROSS_ENFORCED');
  });

  it('CC-02 does not let an observed notional ratio masquerade as the money ceiling', () => {
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'}));
    // The gross fact is still computed and reported: observing it is not deleting it.
    expect(h.observed.gross).toMatchObject({mode: 'OBSERVE', enforced: false, notionalUsd: grossOf()});
    expect(h.observed.gross.limitUsd).toBeCloseTo(EQUITY, 6);
    expect(h.blockers).not.toContain('REJECT_GROSS_EXPOSURE');
    // $3,861 of real USDT margin at the candidate's own verified 10x must not collapse to $34.
    expect(h.finalNotional).toBeGreaterThan(1_000);
    expect(h.executable).toBe(true);
    expect(h.remaining.gross).toBe(0);
  });

  it('CC-03 binds on available margin, and names it, when the wallet really is empty', () => {
    const empty = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {capital: usdtCapital({availableBalanceUsd: 0.05})});
    expect(empty.executable).toBe(false);
    expect(empty.firstBindingConstraint).toBe('AVAILABLE_MARGIN');
    expect(empty.blockers).toContain('INSUFFICIENT_AVAILABLE_MARGIN');
    expect(empty.capital?.executableNotionalUsd).toBeLessThan(1);
  });

  it('CC-04 still binds on the cluster cap while gross and direction are observed', () => {
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'}), {symbol: 'ETHUSDT'});
    expect(h.observed.cluster.enforced).toBe(true);
    expect(h.remaining.cluster).toBeLessThan(h.capital!.executableNotionalUsd);
    expect(h.finalNotional).toBeCloseTo(h.remaining.cluster, 6);
    expect(h.firstBindingConstraint).toBe('CLUSTER');
  });

  it('CC-05 never lets an observed direction limit veto', () => {
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'}), {side: 'SHORT', symbol: 'DOGEUSDT'});
    expect(h.blockers).not.toContain('REJECT_DIRECTION_EXPOSURE');
    expect(h.observed.direction).toMatchObject({mode: 'OBSERVE', enforced: false});
    expect(h.executable).toBe(true);
  });

  it('CC-06 charges reserved and leased margin before calling margin executable', () => {
    const ledger = capitalCapacityForQuoteAsset({...MARGIN_USDT, reservedMarginUsd: 2_000, executionLeaseMarginUsd: 500} as never);
    expect(ledger).toMatchObject({quoteAsset: 'USDT', availableBalanceUsd: 3_861.560262, reservedMarginUsd: 2_000, executionLeaseMarginUsd: 500});
    expect(ledger.executableMarginUsd).toBeCloseTo(3_861.560262 - 2_000 - 500, 6);
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {capital: usdtCapital({reservedMarginUsd: 2_000, executionLeaseMarginUsd: 500})});
    expect(h.capital?.executableMarginUsd).toBeCloseTo(1_361.560262, 6);
  });

  it('CC-07 refuses to invent a leverage fact', () => {
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {capital: usdtCapital({leverage: 0, leverageFact: 'UNPROVEN'})});
    expect(h.executable).toBe(false);
    expect(h.firstBindingConstraint).toBe('LEVERAGE_UNPROVEN');
    expect(h.blockers).toContain('LEVERAGE_UNPROVEN');
    expect(h.capital?.executableNotionalUsd).toBe(0);
  });

  it('CC-08 keeps per-trade risk sizing as an independent ceiling', () => {
    // 1% of equity at a 0.6% adverse move allows 1788.12; a bigger capital figure must not raise it.
    const h = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'OBSERVE'}), {capital: usdtCapital({availableBalanceUsd: 100_000, maxMarginPerPositionUsd: 100_000, maxEquityPctPerPosition: 1})});
    expect(h.remaining.riskSizing).toBeCloseTo(EQUITY * 0.01 / 0.006, 4);
    expect(h.finalNotional).toBeCloseTo(h.remaining.riskSizing, 4);
    expect(h.firstBindingConstraint).toBe('PER_TRADE_RISK');
  });

  it('CC-09 names exactly one binding constraint, and the first blocker when there is one', () => {
    const denied = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {dailyDrawdownPct: 0.9});
    expect(denied.executable).toBe(false);
    expect(denied.firstBindingConstraint).toBe('DAILY_DRAWDOWN');
    expect(denied.blockers[0]).toBe('REJECT_DAILY_DRAWDOWN');
    const allowed = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {plannedNotional: 500});
    // A planned notional below every ceiling is limited by the plan itself, not by a spare dimension.
    expect(allowed.executable).toBe(true);
    expect(allowed.finalNotional).toBe(500);
    expect(allowed.firstBindingConstraint).toBe('PLANNED_NOTIONAL');
  });

  it('CC-10 puts the policy and the capital facts into the version a JIT revalidation compares', () => {
    const observed = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}));
    const enforced = headroom(settingsWith({gross: 'ENFORCE', direction: 'ENFORCE'}));
    expect(observed.factVersion).not.toBe(enforced.factVersion);
    const thin = headroom(settingsWith({gross: 'OBSERVE', direction: 'OBSERVE'}), {capital: usdtCapital({availableBalanceUsd: 900})});
    expect(thin.factVersion).not.toBe(observed.factVersion);
    expect(JSON.parse(observed.factVersion)).toMatchObject({exposureCapacityPolicy: {gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'}});
  });
});

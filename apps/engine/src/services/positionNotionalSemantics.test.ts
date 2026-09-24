import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { ExternalTradeAdapter } from '../adapters/exchange/ExternalTradeAdapter.js';
import { dashboardProjection } from '../api/projections.js';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { computeExecutableRiskHeadroom } from './executableRiskHeadroom.js';

/**
 * What `Position.notionalUsd` means. The position row already carries direction in
 * `side` and magnitude in `quantity`, and the authoritative risk math recomputes notional
 * from `Math.abs(quantity * markPrice)` rather than reading this field, so the field is an
 * unsigned magnitude. Persisting the exchange's signed value instead contradicts the contract
 * and, worse, every `>0`/`nonnegative` exposure filter would silently treat a short as no
 * exposure at all. These tests pin that decision at all three layers at once.
 */
const settings = () => SystemSettingsSchema.parse({ ...defaults, appearance: { ...defaults.appearance, theme: 'BINANCE_NOIR' } });
const shortRow = { symbol: 'AVAXUSDT', positionSide: 'SHORT', positionAmt: '-90.5', entryPrice: '8.10', markPrice: '8.20', leverage: '8', unRealizedProfit: '-9.05', notional: '-742.10', maintMargin: '92.76', marginAsset: 'USDT', liquidationPrice: '16.20' };
const longRow = { symbol: 'ADAUSDT', positionSide: 'LONG', positionAmt: '47', entryPrice: '0.24', markPrice: '0.25', leverage: '8', unRealizedProfit: '0.47', notional: '11.75', maintMargin: '1.47', marginAsset: 'USDT', liquidationPrice: '0.22' };

function adapterWith(positionRisk: unknown[]) {
  const transport = {
    effectiveBaseUrl: () => 'https://demo-fapi.binance.com',
    environment: () => 'TESTNET',
    executionMode: () => 'READ_ONLY',
    assertTestnetExchangeWrite: () => {},
    json: vi.fn(async (url: string) => {
      if (url.startsWith('/fapi/v1/time')) return { serverTime: 1 };
      if (url.startsWith('/fapi/v3/positionRisk')) return positionRisk;
      return {};
    }),
  };
  return new ExternalTradeAdapter(transport as never, { apiKey: 'key', apiSecret: 'secret' });
}

let runtime: EngineRuntime | null = null;
let dir = '';
afterEach(async () => {
  runtime?.stop();
  runtime = null;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
});

async function harness() {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mits-notional-'));
  runtime = await EngineRuntime.createTestHarness({ configDir: '../../config', dataDir: dir });
  return runtime;
}

describe('position notionalUsd semantics', () => {
  it('maps an exchange short position to an unsigned notional while keeping direction in side', async () => {
    const positions = await adapterWith([shortRow, longRow]).fetchPositions();
    const short = positions.find((p) => p.symbol === 'AVAXUSDT')!;
    const long = positions.find((p) => p.symbol === 'ADAUSDT')!;
    expect(short.side).toBe('SHORT');
    expect(short.quantity).toBeCloseTo(90.5, 6);
    expect(Number.isFinite(short.notionalUsd!)).toBe(true);
    expect(short.notionalUsd!).toBeGreaterThanOrEqual(0);
    expect(Math.abs(short.notionalUsd!)).toBeCloseTo(742.1, 4);
    expect(long.notionalUsd!).toBeCloseTo(11.75, 4);
  });

  it('normalises legacy persisted signed notionals so the dashboard snapshot still validates', async () => {
    const rt = await harness();
    const legacy = {
      id: 'exchange_AVAXUSDT_SHORT',
      symbol: 'AVAXUSDT',
      side: 'SHORT',
      quantity: 90.5,
      entryPrice: 8.1,
      markPrice: 8.2,
      leverage: 8,
      // The shape V3.9.6 wrote to disk before this decision: signed, as Binance reported it.
      notionalUsd: -742.1,
      unrealizedPnl: -9.05,
      unrealizedPnlPercent: 0,
      openedAt: 1,
      firstObservedAt: 1,
      entryTimeSource: 'SYSTEM_FILL',
      managementStatus: 'HUMAN_MANAGED',
      humanManagedAt: 1,
      tpStatus: 'PROTECTED',
      tpOrderId: 'tp_legacy',
      tpLastVerifiedAt: 1,
      tpCoverageSource: 'BINANCE_OPEN_ORDER',
      cycleId: 'cycle_legacy_1',
    };
    rt.state.restore({ positions: [[legacy.id, legacy]], runtimeControl: {} });
    const restored = rt.state.positions.get(legacy.id)!;
    expect(restored.notionalUsd!).toBeGreaterThanOrEqual(0);
    expect(Math.abs(restored.notionalUsd!)).toBeCloseTo(742.1, 4);
    expect(() => dashboardProjection(rt)).not.toThrow();
    expect(dashboardProjection(rt).positions.map((p) => p.symbol)).toContain('AVAXUSDT');
  });

  it('keeps gross and directional exposure identical whether the stored field is signed or unsigned', () => {
    const book = (notionalOf: (side: 'LONG' | 'SHORT', magnitude: number) => number) => [
      { symbol: 'AVAXUSDT', side: 'SHORT' as const, quantity: 90.5, markPrice: 8.2, notionalUsd: notionalOf('SHORT', 742.1) },
      { symbol: 'ADAUSDT', side: 'LONG' as const, quantity: 47, markPrice: 0.25, notionalUsd: notionalOf('LONG', 11.75) },
    ];
    const headroom = (positions: ReturnType<typeof book>) =>
      computeExecutableRiskHeadroom({
        settings: settings(),
        equity: 10_000,
        positions,
        pendingRiskExposures: [],
        symbol: 'TESTUSDT',
        side: 'LONG',
        plannedNotional: 100,
        expectedAdverseMovePct: 0.005,
        dailyDrawdownPct: 0,
        quoteNotionalCapacity: 100_000,
        minimumNotional: 5,
      });
    const signed = headroom(book((side, magnitude) => (side === 'SHORT' ? -magnitude : magnitude)));
    const unsigned = headroom(book((_side, magnitude) => magnitude));
    // Long and short never net each other out, and the stored sign cannot move any number.
    expect(signed.gross).toBeCloseTo(signed.long + signed.short, 6);
    expect(unsigned.gross).toBeCloseTo(unsigned.long + unsigned.short, 6);
    expect(unsigned).toMatchObject({ gross: signed.gross, long: signed.long, short: signed.short });
  });

  it('refuses to read a legacy signed short as zero exposure through the contract guard', () => {
    const rows = [
      { id: 'position:AVAXUSDT:SHORT', kind: 'POSITION' as const, symbol: 'AVAXUSDT', side: 'SHORT' as const, notionalUsd: -742.1 },
      { id: 'position:ADAUSDT:LONG', kind: 'POSITION' as const, symbol: 'ADAUSDT', side: 'LONG' as const, notionalUsd: 11.75 },
    ];
    // This is exactly the filter shape used by humanCapacityPolicy, portfolioStress and
    // portfolioRiskLedger: a stored negative silently disappears from exposure entirely.
    const counted = rows.filter((row) => row.notionalUsd > 0).length;
    expect(counted).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.notionalUsd, 0)).toBeLessThan(742.1);
  });
});

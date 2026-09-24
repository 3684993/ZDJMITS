import { describe, expect, it, vi } from 'vitest';
import { exposure } from '@zdj/core';
import { PositionSchema, SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { positionLeverageFact, validPositionLeverage } from './positionRiskFacts.js';
import { ExternalTradeAdapter } from '../adapters/exchange/ExternalTradeAdapter.js';
import { ReconciliationService } from './reconciliationService.js';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';

/**
 * The one-shot V3 deploy died 175 seconds after its single authorized start, and this file is the
 * reason it must never happen twice.
 *
 * `/fapi/v3/positionRisk` was confirmed live on Testnet and does return `marginAsset`, `maintMargin`,
 * `initialMargin`, `notional` and `liquidationPrice` — but it does **not** return `leverage`, which
 * `/fapi/v2/positionRisk` states. A blind `Number(row.leverage)` therefore produced `NaN` for all 12
 * positions, `core.exposure()` turned it into `Math.max(1, NaN)` inside the 250 ms dashboard
 * projection, `PortfolioExposureSchema.parse` threw, and `main.ts`'s uncaughtException handler exited
 * with code 1. 1,256 green engine tests missed it because every V3 fixture handed us a `leverage`.
 *
 * So the fixtures below are the exchange's real rows, copied verbatim from
 * `docs/evidence/v396/position-risk-v3-one-shot-activation-20260924/05-p0-live-v3-vs-v2-payload.txt`,
 * and the assertions run through the seam that actually died — not only through the mapper.
 */

const liveV3Rows = [
  { symbol: 'BTCUSDT', positionSide: 'LONG', positionAmt: '0.0425', entryPrice: '86890.0', breakEvenPrice: '86907.378', markPrice: '84389.90000000', unRealizedProfit: '-106.65769510', liquidationPrice: '0', isolatedMargin: '0', notional: '3586.57075000', marginAsset: 'USDT', isolatedWallet: '0', initialMargin: '256.18365575', maintMargin: '14.34628300', positionInitialMargin: '256.18365575', openOrderInitialMargin: '0', adl: 0, bidNotional: '0', askNotional: '3737.13975000', updateTime: 1790023346125 },
  { symbol: 'ETHUSDT', positionSide: 'LONG', positionAmt: '0.010', entryPrice: '2758.56', breakEvenPrice: '2759.111712', markPrice: '2674.81000000', unRealizedProfit: '-0.83750000', liquidationPrice: '0', isolatedMargin: '0', notional: '26.74810000', marginAsset: 'USDT', isolatedWallet: '0', initialMargin: '1.67175625', maintMargin: '0.13374050', positionInitialMargin: '1.67175625', openOrderInitialMargin: '0', adl: 1, bidNotional: '0', askNotional: '28.61040000', updateTime: 1790007761244 },
  { symbol: 'LTCUSDT', positionSide: 'SHORT', positionAmt: '-0.360', entryPrice: '56.84000000000001', breakEvenPrice: '56.828632000000006', markPrice: '73.51708333', unRealizedProfit: '-6.00374999', liquidationPrice: '13454.47175796', isolatedMargin: '0', notional: '-26.46614999', marginAsset: 'USDT', isolatedWallet: '0', initialMargin: '3.30826875', maintMargin: '0.17202997', positionInitialMargin: '3.30826875', openOrderInitialMargin: '0', adl: 1, bidNotional: '19.44360000', askNotional: '0', updateTime: 1789804135377 },
  { symbol: 'ZECUSDT', positionSide: 'SHORT', positionAmt: '-0.788', entryPrice: '1436.509999999998', breakEvenPrice: '1436.2226979999973', markPrice: '1518.74000000', unRealizedProfit: '-64.90577200', liquidationPrice: '7583.39374578', isolatedMargin: '0', notional: '-1196.76712000', marginAsset: 'USDT', isolatedWallet: '0', initialMargin: '99.73060132', maintMargin: '17.95150680', positionInitialMargin: '99.73060132', openOrderInitialMargin: '0', adl: 1, bidNotional: '1118.38475000', askNotional: '0', updateTime: 1789804135377 },
  { symbol: 'BNBUSDC', positionSide: 'SHORT', positionAmt: '-0.06', entryPrice: '762.45', breakEvenPrice: '762.3127590000001', markPrice: '779.41000000', unRealizedProfit: '-1.01760000', liquidationPrice: '83365.17202634', isolatedMargin: '0', notional: '-46.76460000', marginAsset: 'USDC', isolatedWallet: '0', initialMargin: '5.84557500', maintMargin: '0.23382300', positionInitialMargin: '5.84557500', openOrderInitialMargin: '0', adl: 1, bidNotional: '44.70720000', askNotional: '0', updateTime: 1789804135377 },
  // Fields exactly as the probe reported them for this position; the row also proves the derivation
  // against the exchange itself, because /fapi/v2/positionRisk states "leverage":"8" for this symbol
  // in the same evidence file while /fapi/v3/positionRisk states no leverage at all.
  { symbol: 'ONDOUSDT', positionSide: 'SHORT', positionAmt: '-15.0', entryPrice: '0.39499999999999996', breakEvenPrice: '0.39492099999999997', markPrice: '0.50560000', liquidationPrice: '319.10207678', isolatedMargin: '0', notional: '-7.58400000', marginAsset: 'USDT', initialMargin: '0.94800000', maintMargin: '0.11376000', positionInitialMargin: '0.94800000', openOrderInitialMargin: '0', bidNotional: '4.91999999', askNotional: '0' },
];
// Only the cross-checked value is claimed as observed; the rest are asserted against the quotient the
// same row states, because V3 gives us no leverage to compare with.
const observedLeverage: Record<string, number> = { ONDOUSDT: 8 };
const quotientLeverage = (row: Record<string, unknown>) => Math.abs(Number(row.notional)) / Number(row.initialMargin);

function transportFor(rows: unknown[]) {
  const calls: string[] = [], writes: string[] = [];
  const transport = {
    environment: () => 'TESTNET',
    executionMode: () => 'READ_ONLY',
    json: async (path: string) => {
      calls.push(path.split('?')[0]);
      if (path.startsWith('/fapi/v1/time')) return { serverTime: Date.now() };
      return rows;
    },
    assertTestnetExchangeWrite: (operation: string) => { writes.push(String(operation)); throw new Error('WRITE_ATTEMPTED'); },
  };
  return { transport, calls, writes };
}

describe('V3 states no leverage, and a NaN leverage kills the whole engine', () => {
  it('the live V3 rows carry no leverage field at all, while V2 does', () => {
    expect(liveV3Rows.every(row => !('leverage' in row))).toBe(true);
    expect(positionLeverageFact({ leverage: '8' })).toEqual({ leverage: 8, fact: 'EXCHANGE_STATED' });
    expect(positionLeverageFact({ leverage: undefined })).toEqual({ leverage: null, fact: 'UNPROVEN' });
    // A quotient that is not one leverage must not be rounded into one.
    expect(positionLeverageFact({ notional: '100', initialMargin: '13.5' }).leverage).toBeNull();
    expect(positionLeverageFact({ notional: '100', initialMargin: '0' }).leverage).toBeNull();
    expect(positionLeverageFact({ notional: '-26.46614999', initialMargin: '3.30826875' })).toEqual({ leverage: 8, fact: 'EXCHANGE_DERIVED_FROM_INITIAL_MARGIN' });
  });

  it('every position mapped from the real Testnet payload has the leverage the exchange actually uses', async () => {
    const { transport, writes } = transportFor(liveV3Rows);
    const positions = await new ExternalTradeAdapter(transport as never, { apiKey: 'k', apiSecret: 's' }).fetchPositions();
    expect(positions).toHaveLength(liveV3Rows.length);
    expect(writes).toEqual([]);
    const bySymbol = new Map(positions.map(row => [row.symbol, row]));
    for (const row of liveV3Rows) {
      const mapped = bySymbol.get(row.symbol)!;
      expect(Number.isFinite(mapped.leverage), row.symbol).toBe(true);
      expect(validPositionLeverage(mapped.leverage), row.symbol).toBe(mapped.leverage);
      expect(mapped.leverage, row.symbol).toBe(Math.round(quotientLeverage(row)));
      if (observedLeverage[row.symbol]) expect(mapped.leverage).toBe(observedLeverage[row.symbol]);
    }
  });

  it('the mapped rows satisfy PositionSchema, which is what the dashboard projection parses', async () => {
    const { transport } = transportFor(liveV3Rows);
    const positions = await new ExternalTradeAdapter(transport as never, { apiKey: 'k', apiSecret: 's' }).fetchPositions();
    for (const row of positions) {
      // A single field the contract rejects takes the process down; parse every row, not one.
      expect(() => PositionSchema.parse(row), row.symbol).not.toThrow();
      expect(PositionSchema.parse(row).leverage).toBe(validPositionLeverage(row.leverage));
    }
  });

  it('the exposure projection that crashed cannot produce a non-finite margin from these rows', async () => {
    const { transport } = transportFor(liveV3Rows);
    const positions = await new ExternalTradeAdapter(transport as never, { apiKey: 'k', apiSecret: 's' }).fetchPositions();
    const view = positions.map(row => ({ symbol: row.symbol, side: row.side, quantity: Number(row.quantity), markPrice: Number(row.markPrice), leverage: Number(row.leverage) }));
    const assets = [{ asset: 'USDT', walletBalance: 5000, availableBalance: 4000, usdValue: 5000 }, { asset: 'USDC', walletBalance: 100, availableBalance: 100, usdValue: 100 }] as never;
    const computed = exposure(view, assets, SystemSettingsSchema.parse(defaults).portfolioIntelligence);
    for (const key of ['usdtMarginUsd', 'usdcMarginUsd', 'longNotionalUsd', 'shortNotionalUsd'] as const) {
      expect(Number.isFinite(computed[key]), key).toBe(true);
    }
    // USDT margin is the sum of USDT-quoted notional / leverage, and BNBUSDC belongs to USDC only.
    expect(computed.usdcMarginUsd).toBeCloseTo(46.7646 / 8, 6);
    expect(computed.usdtMarginUsd).toBeGreaterThan(computed.usdcMarginUsd);
  });

  it('a fresh row with no leverage at all never overwrites a leverage the exchange already supported', async () => {
    const settings = { takeProfit: { enabled: true, targetPriceMovePercent: 0.45, quantityPercent: 100 } } as never;
    const local: any = { id: 'p', symbol: 'BTCUSDT', side: 'LONG', quantity: 0.0425, entryPrice: 86890, markPrice: 84389.9, leverage: 14, unrealizedPnl: -106, unrealizedPnlPercent: -18, openedAt: 1, tpStatus: 'PENDING', tpOrderId: null };
    const state = new RuntimeState(settings);
    state.positions.set('p', local);
    const published: any[] = [], bus = new EventBus();
    bus.on('POSITION_LEVERAGE_UNPROVEN', event => published.push(event));
    // This is the poisoned shape: an existing row whose leverage was destroyed by the old mapper.
    const fresh = { ...local, markPrice: 84400, leverage: null };
    await new ReconciliationService({ fetchOpenOrders: vi.fn(async () => []), fetchPositions: vi.fn(async () => [fresh]) } as never, state, bus, { ensure: vi.fn() } as never).run();
    expect(state.positions.get('p')?.leverage).toBe(14);
    expect(Number.isFinite(Number(state.positions.get('p')?.leverage))).toBe(true);
    expect(published).toHaveLength(0);
  });

  it('neither side stating a leverage keeps the position out of the poisoned state and says why', async () => {
    const settings = { takeProfit: { enabled: true, targetPriceMovePercent: 0.45, quantityPercent: 100 } } as never;
    const local: any = { id: 'p', symbol: 'BTCUSDT', side: 'LONG', quantity: 0.0425, entryPrice: 86890, markPrice: 84389.9, leverage: null, unrealizedPnl: -106, unrealizedPnlPercent: -18, openedAt: 1, tpStatus: 'PENDING', tpOrderId: null };
    const state = new RuntimeState(settings);
    state.positions.set('p', local);
    const published: any[] = [], bus = new EventBus();
    bus.on('POSITION_LEVERAGE_UNPROVEN', event => published.push(event));
    const fresh = { ...local, markPrice: 84400, leverage: null };
    await new ReconciliationService({ fetchOpenOrders: vi.fn(async () => []), fetchPositions: vi.fn(async () => [fresh]) } as never, state, bus, { ensure: vi.fn() } as never).run();
    const stored = state.positions.get('p')!;
    expect(published.map(event => event.payload?.symbol)).toContain('BTCUSDT');
    // Never invent a number, and never write one the contract will reject: the mark still moves.
    expect(validPositionLeverage(stored.leverage)).toBeNull();
    expect(stored.markPrice).not.toBe(84400);
    expect([...state.positions.keys()]).toEqual(['p']);
  });
});

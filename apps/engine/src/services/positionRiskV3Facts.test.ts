import { describe, expect, it } from 'vitest';
import { ExternalTradeAdapter } from '../adapters/exchange/ExternalTradeAdapter.js';
import { liquidationBufferFact } from './positionRiskFacts.js';
import { PortfolioRiskAdmission } from './portfolioRiskLedger.js';
import { portfolioRiskAuthorityCompile } from './portfolioRiskAuthority.js';

/**
 * The live account proved this the hard way: every open position reported
 * `MAINTENANCE_MARGIN_UNPROVEN` and `POSITION_MARGIN_ASSET_UNPROVEN`, so `POSITION_FACT_INVALID`
 * held for every candidate at every size and no entry could ever be admitted. The mapper was reading
 * `/fapi/v2/positionRisk` for `maintMarginAmt` / `maintenanceMargin`, which is not what the current
 * USDⓈ-M Position Information V3 contract returns (`maintMargin`, `marginAsset`, `liquidationPrice`).
 *
 * A zero liquidation price is not a missing field either: the official V3 sample shows a non-zero
 * position with `liquidationPrice = 0` alongside a real `maintMargin`. Each of these tests pins one
 * of those confusions, and none of them is allowed to be answered by computing a risk fact from the
 * profile's bracket rate or the entry's leverage.
 */

const v3Row = (over: Record<string, unknown> = {}) => ({
  symbol: 'ADAUSDT', positionSide: 'LONG', positionAmt: '47', entryPrice: '0.24', markPrice: '0.25',
  leverage: '8', notional: '11.75', marginAsset: 'USDT', maintMargin: '1.47', liquidationPrice: '0.02',
  unrealizedProfit: '0.47', ...over,
});
// The shape the retired mapper was written against: v2 kept quantity in `positionAmt` and reported
// no per-position maintenance amount at all on the live demo endpoint.
const v2Row = (over: Record<string, unknown> = {}) => ({
  symbol: 'ADAUSDT', positionSide: 'LONG', positionAmt: '47', entryPrice: '0.24', markPrice: '0.25',
  leverage: '8', notional: '11.75', unRealizedProfit: '0.47', ...over,
});

function transportWith(handler: (path: string, params?: Record<string, unknown>) => unknown) {
  const calls: string[] = [], writes: string[] = [];
  return {
    calls, writes,
    transport: {
      environment: () => 'TESTNET',
      executionMode: () => 'READ_ONLY',
      json: async (path: string) => {
        calls.push(path.split('?')[0]);
        if (path.startsWith('/fapi/v1/time')) return { serverTime: Date.now() };
        const [route, query] = path.split('?');
        const params = Object.fromEntries(new URLSearchParams(query ?? ''));
        return handler(route, params);
      },
      assertTestnetExchangeWrite: (operation: string) => { writes.push(String(operation)); throw new Error('WRITE_ATTEMPTED'); },
      entryBlockReason: () => null,
    },
  };
}
const adapterFor = (transport: unknown) => new ExternalTradeAdapter(transport as never, { apiKey: 'k', apiSecret: 's' });

describe('position risk truth comes from the V3 contract', () => {
  it('reads /fapi/v3/positionRisk and maps marginAsset / maintMargin / liquidationPrice from the row itself', async () => {
    const { calls, writes, transport } = transportWith(route => route.endsWith('positionRisk')
      ? [v3Row(), v3Row({ symbol: 'AVAXUSDT', positionSide: 'SHORT', positionAmt: '-90.5', markPrice: '8.20', notional: '-742.10', maintMargin: '92.76', liquidationPrice: '16.20' })]
      : []);
    const positions = await adapterFor(transport).fetchPositions();
    expect(calls.filter(path => path === '/fapi/v3/positionRisk')).toHaveLength(1);
    expect(calls.some(path => path === '/fapi/v2/positionRisk')).toBe(false);
    expect(writes).toEqual([]);
    expect(positions).toHaveLength(2);
    const ada = positions.find(row => row.symbol === 'ADAUSDT')!, avax = positions.find(row => row.symbol === 'AVAXUSDT')!;
    expect(ada.marginAsset).toBe('USDT');
    expect(ada.maintenanceMarginUsd).toBe(1.47);
    expect(ada.liquidationPrice).toBe(0.02);
    expect(ada.notionalUsd).toBe(11.75);
    // A short keeps an unsigned magnitude and the direction its row states.
    expect(avax.side).toBe('SHORT');
    expect(avax.maintenanceMarginUsd).toBe(92.76);
    expect(avax.notionalUsd).toBe(742.1);
  });

  it('an exchange-reported liquidation price of exactly zero stays 0, it is not silently nulled', async () => {
    const { transport } = transportWith(() => [v3Row({ liquidationPrice: '0' })]);
    const [position] = await adapterFor(transport).fetchPositions();
    expect(position.liquidationPrice).toBe(0);
    expect(position.maintenanceMarginUsd).toBe(1.47);
  });

  it('probe and mapper must read the same endpoint, so a probe can never certify what the runtime cannot see', async () => {
    const { calls, transport } = transportWith(route => route.endsWith('positionRisk') ? [v3Row({ positionAmt: '30', notional: '12.31427700', maintMargin: '0.08004280', liquidationPrice: '0' })] : []);
    const probe = await adapterFor(transport).probePositionRiskFields();
    expect(probe.endpoint).toBe('/fapi/v3/positionRisk');
    expect(calls).toContain('/fapi/v3/positionRisk');
    expect(calls.some(path => path === '/fapi/v2/positionRisk')).toBe(false);
    expect(probe.fieldNames).toEqual(expect.arrayContaining(['maintMargin', 'marginAsset', 'liquidationPrice', 'notional', 'positionAmt']));
    // Strings stay as the exchange sent them; the probe is evidence, not a re-derivation.
    expect(probe.rows[0]).toMatchObject({ marginAsset: 'USDT', maintMargin: '0.08004280', liquidationPrice: '0', positionAmt: '30' });
  });

  it('when V3 is unsupported the row still exists for exits, but no risk fact may be claimed from V2', async () => {
    const { calls, transport } = transportWith((route, params) => {
      if (route === '/fapi/v3/positionRisk') throw new Error('HTTP_404_NOT_FOUND');
      return params?.symbol ? [v2Row()] : [v2Row()];
    });
    const positions = await adapterFor(transport).fetchPositions();
    expect(calls).toContain('/fapi/v3/positionRisk');
    expect(positions).toHaveLength(1);
    // Existence survived; the risk facts are missing, and missing is not zero and not derived.
    expect(positions[0].quantity).toBe(47);
    expect(positions[0].maintenanceMarginUsd).toBeNull();
    expect(positions[0].liquidationPrice).toBeNull();
    expect((positions[0] as unknown as { positionRiskSource?: string }).positionRiskSource).not.toBe('V3_VERIFIED');
  });
});

describe('liquidation buffer is directional, finite, and never an invention', () => {
  it('C3 a non-zero LONG whose exchange row reports 0 is a proven zero-price boundary, not a gap', () => {
    const fact = liquidationBufferFact({ symbol: 'BTCUSDT', side: 'LONG', markPrice: 83_500, liquidationPrice: 0 });
    expect(fact).toMatchObject({ bufferPct: 1, fact: 'EXCHANGE_REPORTED_ZERO' });
    expect(Number.isFinite(fact.bufferPct)).toBe(true);
    expect(fact.blocker).toBeUndefined();
  });

  it('C3 a non-zero SHORT reporting 0 stays unproven: the price would sit on the wrong side', () => {
    const fact = liquidationBufferFact({ symbol: 'ZECUSDT', side: 'SHORT', markPrice: 1_480, liquidationPrice: 0 });
    expect(fact.bufferPct).toBeNull();
    expect(fact.fact).toBe('UNPROVEN');
    expect(fact.blocker).toContain('LIQUIDATION_BUFFER_UNPROVEN:ZECUSDT:SHORT');
  });

  it('C3 a positive price is read directionally and never through abs()', () => {
    expect(liquidationBufferFact({ symbol: 'A', side: 'LONG', markPrice: 100, liquidationPrice: 80 })).toEqual({ bufferPct: 0.2, fact: 'EXCHANGE_REPORTED_PRICE' });
    expect(liquidationBufferFact({ symbol: 'B', side: 'SHORT', markPrice: 100, liquidationPrice: 120 })).toEqual({ bufferPct: 0.2, fact: 'EXCHANGE_REPORTED_PRICE' });
    // The old abs() formula called both of these a 20% buffer; one of them is an impossible price.
    expect(liquidationBufferFact({ symbol: 'C', side: 'LONG', markPrice: 100, liquidationPrice: 120 }).blocker).toContain('LIQUIDATION_PRICE_DIRECTION_INVALID:C:LONG');
    expect(liquidationBufferFact({ symbol: 'D', side: 'SHORT', markPrice: 100, liquidationPrice: 80 }).blocker).toContain('LIQUIDATION_PRICE_DIRECTION_INVALID:D:SHORT');
    expect(liquidationBufferFact({ symbol: 'E', side: 'LONG', markPrice: 100, liquidationPrice: 100 }).blocker).toContain('LIQUIDATION_PRICE_DIRECTION_INVALID:E:LONG');
  });

  it('a missing field is unproven, and zero maintenance margin is a real number rather than absence', () => {
    expect(liquidationBufferFact({ symbol: 'F', side: 'LONG', markPrice: 100, liquidationPrice: null }).bufferPct).toBeNull();
    expect(liquidationBufferFact({ symbol: 'G', side: 'LONG', markPrice: 100, liquidationPrice: undefined }).bufferPct).toBeNull();
    expect(liquidationBufferFact({ symbol: 'H', side: 'LONG', markPrice: 100, liquidationPrice: Number.NaN }).blocker).toContain('LIQUIDATION_BUFFER_UNPROVEN');
    expect(liquidationBufferFact({ symbol: 'I', side: 'LONG', markPrice: 0, liquidationPrice: 0 }).bufferPct).toBeNull();
  });
});

const positionRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', symbol: 'BTCUSDT', side: 'LONG', quantity: 0.0425, markPrice: 83_500, entryPrice: 80_000, leverage: 10,
  marginAsset: 'USDT', notionalUsd: 3548.13, maintenanceMarginUsd: 14.2, liquidationPrice: 0, cycleId: 'cycle-1',
  managementStatus: 'HUMAN_MANAGED', tpStatus: 'PROTECTED', openedAt: Date.now() - 3_600_000, unrealizedPnl: 5, ...over,
});
function admissionWith(position: Record<string, unknown>, facts: unknown) {
  const state: any = {
    settings: { connections: { exchange: { environment: 'TESTNET', credentialRef: 'binance-primary' } }, riskGovernance: { portfolioRisk: profileRow } },
    positions: new Map([['p1', position]]), entryOrders: new Map(), entryReservations: new Map(), snapshots: new Map(),
    account: { status: 'READY', asOf: Date.now(), equityUsd: 10_800, assets: [{ asset: 'USDT', walletBalance: 4000, availableBalance: 4000, usdValue: 4000 }], riskBaseline: { startingEquityUsd: 10_800 } },
    positionSymbols: () => new Set(['BTCUSDT']), activeEntrySymbols: () => new Set<string>(), pool: { readyList: () => [] },
  };
  const admission = new PortfolioRiskAdmission({
    state, identity: () => ({ environment: 'TESTNET', account: 'binance-primary' }),
    ownerOf: () => ({ ownerState: 'HUMAN_MANAGED' as const, handoffAt: null, acknowledgedAt: null }),
    cashFlows: () => [{ id: 'cf-1', amountUsd: 0, factStatus: 'VERIFIED' as const }],
    profile: () => state.settings.riskGovernance.portfolioRisk,
    authority: () => ({ facts: facts as never, staleObservedContentHash: null }),
  });
  return { admission, state };
}
const bracketRead = { environment: 'TESTNET', credentialRef: 'binance-primary', observedAt: 1, failures: [],
  symbols: [
    { symbol: 'BTCUSDT', brackets: [{ bracket: 0, initialLeverage: 10, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.025, cum: 0 }] },
    { symbol: 'SOLUSDT', brackets: [{ bracket: 0, initialLeverage: 10, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.025, cum: 0 }] },
  ] };
const compiled = portfolioRiskAuthorityCompile({ environment: 'TESTNET', accountScope: 'binance-primary', bracketRead, requiredSymbols: ['BTCUSDT', 'SOLUSDT'], clusters: {},
  scenarios: [{ id: 'DOWN_10', priceShockPct: -0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: -0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5 }], sizingBound: { maxEntryNotionalUsd: 10_800, maintenanceRateBound: 0.2 } });
if (!compiled.ok) throw new Error(`fixture authority must compile: ${compiled.blockers.join(',')}`);
const profileRow = { configured: true, maxCapitalAtRiskUsd: 10_800, maxStressLossUsd: 5_400, maxGrossNotionalUsd: 10_800, maxDirectionNotionalUsd: 8_640, maxClusterNotionalUsd: 10_800,
  maxHumanNotionalUsd: 10_800, maxDrawdownPct: 1, minMarginBufferPct: 0, minLiquidationBufferPct: 0, maxHumanPositions: 50, maxPendingHandoffs: 50, maxAckAgeMs: 86_400_000, snapshotTtlMs: 20_000,
  ...compiled.profileFacts };

const candidate = { symbol: 'SOLUSDT', side: 'LONG' as const, quoteAsset: 'USDT', notionalUsd: 1000, marginUsd: 100, leverage: 10, markPrice: 150, planId: 'plan-1' };
describe('D.13 a READY authority never upgrades a position-level gap, and never synthesizes one', () => {
  /** `admit()` is the only surface that composes profile, snapshot and stress blockers. */
  const riskBlockers = (admission: PortfolioRiskAdmission) => String(admission.admit(candidate as never).reasons);

  it('the live BTCUSDT case: LONG with reported 0 liquidation and a real maintMargin is now VERIFIED', () => {
    const { admission } = admissionWith(positionRow(), compiled.facts);
    const blockers = riskBlockers(admission);
    expect(blockers).not.toMatch(/MAINTENANCE_MARGIN_UNPROVEN|POSITION_MARGIN_ASSET_UNPROVEN|LIQUIDATION_BUFFER_UNPROVEN|LIQUIDATION_PRICE_DIRECTION_INVALID|POSITION_FACT_INVALID|POSITION_FACT_UNVERIFIED/);
    expect(admission.profileReadback([]).status).toBe('READY');
    // The account is far from its caps, so this is a real admission, not a vacuous one.
    expect(admission.admit(candidate as never).allowed).toBe(true);
  });

  it('dropping maintMargin from the row must fail as unproven, not be computed from the bracket rate × notional', () => {
    const { admission } = admissionWith(positionRow({ maintenanceMarginUsd: null }), compiled.facts);
    expect(riskBlockers(admission)).toContain('MAINTENANCE_MARGIN_UNPROVEN');
    // 0.025 × 3548.13 = 88.70 would be the synthesized value; it must not appear anywhere.
    expect(JSON.stringify(admission.snapshot() ?? {})).not.toMatch(/88\.7/);
  });

  it('dropping marginAsset must fail as unproven instead of defaulting to the quote suffix', () => {
    const { admission } = admissionWith(positionRow({ marginAsset: null }), compiled.facts);
    expect(riskBlockers(admission)).toContain('POSITION_MARGIN_ASSET_UNPROVEN');
  });

  it('a SHORT whose exchange row reports 0 liquidation stays fail-closed even with a READY authority', () => {
    const { admission } = admissionWith(positionRow({ side: 'SHORT', liquidationPrice: 0 }), compiled.facts);
    const decision = admission.admit(candidate as never);
    expect(String(decision.reasons)).toMatch(/LIQUIDATION_BUFFER_UNPROVEN:\S*SHORT/);
    const exposure = decision.snapshot.exposures.find(row => row.kind === 'POSITION' && row.symbol === 'BTCUSDT')!;
    expect(exposure.liquidationBufferPct).toBeNull();
    expect(exposure.liquidationPriceFact).toBe('UNPROVEN');
    expect(exposure.factStatus).toBe('UNKNOWN');
  });

  it('an impossible liquidation price is named as a direction defect, not smoothed into a buffer', () => {
    const { admission } = admissionWith(positionRow({ liquidationPrice: 91_000 }), compiled.facts);
    expect(riskBlockers(admission)).toContain('LIQUIDATION_PRICE_DIRECTION_INVALID:BTCUSDT:LONG');
  });

  it('D.1 the proven zero-price boundary is what the snapshot publishes: buffer 1 and a VERIFIED fact', () => {
    const { admission } = admissionWith(positionRow(), compiled.facts);
    const exposure = admission.admit(candidate as never).snapshot.exposures.find(row => row.kind === 'POSITION' && row.symbol === 'BTCUSDT')!;
    expect(exposure.liquidationBufferPct).toBe(1);
    expect(Number.isFinite(exposure.liquidationBufferPct)).toBe(true);
    expect(exposure.factStatus).toBe('VERIFIED');
    expect(exposure.maintenanceMarginUsd).toBe(14.2);
    // The published buffer carries the provenance of the row it came from, so a reported zero can
    // never be mistaken for a projected figure in the snapshot evidence.
    expect(exposure.liquidationPriceFact).toBe('EXCHANGE_REPORTED_ZERO');
    const projected = admission.snapshot().exposures.find(row => row.kind === 'PENDING');
    expect(projected?.liquidationPriceFact ?? 'UNPROVEN').not.toBe('EXCHANGE_REPORTED_ZERO');
  });

  it('D.11 a row the exchange only confirmed exists can never produce an admissible risk ticket', async () => {
    const { calls, writes, transport } = transportWith(route => route === '/fapi/v3/positionRisk'
      ? (() => { throw new Error('-1100 connect ECONNRESET'); })()
      : [v2Row({ markPrice: '0.25', liquidationPrice: '0.02' })]);
    const [row] = await adapterFor(transport).fetchPositions();
    expect(calls).toEqual(['/fapi/v1/time', '/fapi/v3/positionRisk', '/fapi/v2/positionRisk']);
    expect(writes).toEqual([]);
    // V2 carried the price and the quantity, so the position is still manageable for exits...
    expect(row.liquidationPrice).toBe(0.02);
    // ...but it never states this position's margin requirement, so the risk layer must not claim it.
    expect(row.maintenanceMarginUsd).toBeNull();
    const decision = admissionWith(positionRow({ maintenanceMarginUsd: null, positionRiskSource: 'V2_EXISTENCE_ONLY' }), compiled.facts).admission.admit(candidate as never);
    expect(decision.allowed).toBe(false);
    expect(decision.ticket).toBeNull();
    expect(String(decision.reasons)).toMatch(/MAINTENANCE_MARGIN_UNPROVEN|POSITION_FACT_UNVERIFIED/);
  });

  it('a malformed V3 payload is a read failure, not an empty book', async () => {
    const { calls, writes, transport } = transportWith(() => ({ errorMessage: 'GATEWAY_TIMEOUT' }));
    const positions = await adapterFor(transport).fetchPositions();
    expect(positions).toEqual([]);
    expect(writes).toEqual([]);
    expect(calls.filter(path => path.endsWith('positionRisk')).length).toBeLessThanOrEqual(2);
    const { calls: probeCalls, writes: probeWrites, transport: probeTransport } = transportWith(() => 'not-an-array');
    const probe = await adapterFor(probeTransport).probePositionRiskFields();
    expect(probe.rowCount).toBe(0);
    expect(probe.rows).toEqual([]);
    expect(probeWrites).toEqual([]);
    expect(probeCalls.filter(path => path.endsWith('positionRisk'))).toEqual(['/fapi/v3/positionRisk']);
  });

  it('a SHORT with a directionally sane positive price is verified the same way a LONG is', () => {
    const { admission } = admissionWith(positionRow({ side: 'SHORT', markPrice: 8_200, notionalUsd: 3_548.13, liquidationPrice: 9_100 }), compiled.facts);
    const decision = admission.admit(candidate as never);
    expect(String(decision.reasons)).not.toMatch(/LIQUIDATION_BUFFER_UNPROVEN|LIQUIDATION_PRICE_DIRECTION_INVALID|MAINTENANCE_MARGIN_UNPROVEN|POSITION_MARGIN_ASSET_UNPROVEN/);
    const exposure = decision.snapshot.exposures.find(row => row.kind === 'POSITION' && row.symbol === 'BTCUSDT')!;
    expect(exposure.side).toBe('SHORT');
    expect(exposure.liquidationBufferPct).toBeCloseTo((9_100 - 8_200) / 8_200, 6);
  });
});

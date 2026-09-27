import {describe,expect,it} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {PortfolioRiskAdmission} from './portfolioRiskLedger.js';
import {collectPortfolioPendingRiskFacts, entryOrderOccupiesRisk} from './entryRiskOccupancy.js';

/**
 * The portfolio risk account must not decide on its own which entry orders occupy risk. One
 * authority already answers that — entryOrderOccupiesRisk / collectPendingEntryRiskExposures — and
 * every case below is an attempt to make the risk account disagree with it, in either direction:
 * phantom risk that was proven absent, or a released lineage that should never have been released.
 */

const identity = {environment: 'TESTNET', account: 'binance-primary'};
const now = 10_000;
const profile = (over: Record<string, unknown> = {}) => ({
  configured: true, marginTierVersion: 'bracket-table-2026-09', maintenanceMarginRatePct: 0.005, correlationVersion: 'corr-2026-09', scenarioVersion: 'scn-2026-09',
  maxCapitalAtRiskUsd: 600, maxDrawdownPct: 0.2, maxStressLossUsd: 900, maxGrossNotionalUsd: 6_000, maxDirectionNotionalUsd: 4_000, maxClusterNotionalUsd: 3_000,
  minMarginBufferPct: 0.2, minLiquidationBufferPct: 0.01, maxHumanPositions: 6, maxHumanNotionalUsd: 6_000, maxPendingHandoffs: 4, maxAckAgeMs: 8 * 3_600_000,
  snapshotTtlMs: 20_000, cashFlowWindowMs: 86_400_000, cashFlowMaxAgeMs: 900_000, clusters: {BTC: 'MAJOR', BNB: 'MAJOR'},
  scenarios: [{id: 'shock10', priceShockPct: 0.1, spreadWidenPct: 0.01, fundingShockPct: 0.001, markBasisShockPct: 0.005, depthPenaltyPct: 0.01, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.25}],
  ...over,
});

function host(over: {assets?: unknown[]; profileOver?: Record<string, unknown>} = {}) {
  const state = new RuntimeState({portfolio: {maxPositions: 10}, riskGovernance: {portfolioRisk: profile(over.profileOver ?? {})}} as never);
  state.account = {...state.account, status: 'READY', asOf: now, equityUsd: 10_000,
    assets: over.assets ?? [{asset: 'USDT', walletBalance: 10_000, availableBalance: 9_000, usdValue: 10_000}],
    riskBaseline: {startingEquityUsd: 11_000, currentEquityUsd: 10_000, riskDrawdownPct: 0.09}} as never;
  state.runtimeControl = {...state.runtimeControl, capital: {...state.runtimeControl.capital, generation: 7, evaluatedAt: now, capitalVersion: 'capital-test', nextRecheckAt: now + 300_000}} as never;
  const admission = new PortfolioRiskAdmission({state, identity: () => identity,
    ownerOf: () => null,
    cashFlows: () => [{id: 'coverage', amountUsd: 0, factStatus: 'VERIFIED'}],
    profile: () => (state.settings.riskGovernance as {portfolioRisk?: Record<string, unknown>}).portfolioRisk ?? {}});
  const evaluate = () => {
    const {snapshot, blockers} = admission.refresh(now);
    // The pending reasons live on the snapshot the admission just built; the caller sees one list.
    return {snapshot, blockers: [...new Set([...blockers, ...snapshot.blockers])], pending: snapshot.exposures.filter(row => row.kind === 'PENDING')};
  };
  return {state, admission, evaluate};
}

type Proof = 'valid' | 'none' | 'expired' | 'tombstone' | 'unverified';
const unknownOrder = (id: string, symbol: string, {quantity = 1, price = 100, leverage = 10, proof = 'valid' as Proof, reservationId = null}: {quantity?: number; price?: number; leverage?: number; proof?: Proof; reservationId?: string} = {}) => {
  const tombstone = `ENTRY:${symbol}:ml_${id}`;
  const row: Record<string, unknown> = {id, clientOrderId: `ml_${id}`, exchangeOrderId: null, symbol, side: 'LONG', quantity, price, filledQuantity: 0, leverage,
    status: 'UNKNOWN', createdAt: 1, updatedAt: 1, absoluteExpiresAt: 999_999_999_999, repriceCount: 0, intentId: `intent_${id}`, reservationId, reachability: 1};
  if (proof !== 'none') {
    row.activeRiskExposure = false;
    row.activeRiskEvidence = {status: proof === 'unverified' ? 'UNVERIFIED' : 'VERIFIED_NO_ACTIVE_RISK', sources: ['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT','BINANCE_LONG_SHORT_POSITION_ZERO'], checkedAt: now - 1_000,
      validUntil: proof === 'expired' ? now - 1 : now + 60_000, identityTombstone: proof === 'tombstone' ? `ENTRY:${symbol}:other` : tombstone};
  }
  return row as never;
};
const workingOrder = (id: string, symbol: string, reservationId: string, {quantity = 10, price = 100, filledQuantity = 0, leverage = 10}: {quantity?: number; price?: number; filledQuantity?: number; leverage?: number} = {}) =>
  ({id, clientOrderId: `ml_${id}`, exchangeOrderId: '1', symbol, side: 'LONG', quantity, price, filledQuantity, leverage, status: 'WORKING',
    createdAt: 1, updatedAt: 1, absoluteExpiresAt: 999_999_999_999, repriceCount: 0, intentId: `intent_${id}`, reservationId, reachability: 1} as any);
const reservation = (id: string, underlying: string, quoteAsset: string, {notionalUsd = 1000, marginUsd = notionalUsd / 10, status = 'WORKING', createdAt = 1}: {notionalUsd?: number; marginUsd?: number; status?: string; createdAt?: number} = {}) =>
  ({id, underlying, quoteAsset, marginUsd, notionalUsd, planId: `plan_${id}`, intentId: `intent_${id}`, createdAt, expiresAt: createdAt + 60_000, status} as any);

const idsOf = (pending: {id: string}[]) => pending.map(row => row.id).sort();

describe('the portfolio risk account consumes the single entry occupancy authority', () => {
  it('T1 drops an UNKNOWN that is proven to hold no active risk, without rewriting the row', () => {
    const {state, evaluate} = host();
    state.entryOrders.set('u1', unknownOrder('u1', 'FETUSDT', {proof: 'valid'}));
    expect(entryOrderOccupiesRisk(state.entryOrders.get('u1')!, now)).toBe(false);
    const {pending, blockers} = evaluate();
    expect(idsOf(pending), JSON.stringify(blockers)).toEqual([]);
    expect(blockers.filter(reason => String(reason).includes('u1'))).toEqual([]);
    // The historical fact stays exactly as it was: the fix reinterprets occupancy, never the record.
    expect(state.entryOrders.get('u1')).toMatchObject({status: 'UNKNOWN'});
  });

  it('T2 keeps an UNKNOWN with no proof occupying risk fail-closed', () => {
    const {state, evaluate} = host();
    state.entryOrders.set('u2', unknownOrder('u2', 'FETUSDT', {proof: 'none'}));
    expect(entryOrderOccupiesRisk(state.entryOrders.get('u2')!, now)).toBe(true);
    const {pending, blockers} = evaluate();
    expect(idsOf(pending)).toEqual(['pending:order:u2']);
    expect(pending[0]).toMatchObject({factStatus: 'UNKNOWN', notionalUsd: 100});
    expect(blockers).toContain('PENDING_RISK_UNVERIFIED:order:u2');
  });

  it.each(['expired', 'tombstone', 'unverified'] as Proof[])('T3 keeps an UNKNOWN with %s proof occupying risk', proof => {
    const {state, evaluate} = host();
    state.entryOrders.set('u3', unknownOrder('u3', 'FETUSDT', {proof}));
    expect(entryOrderOccupiesRisk(state.entryOrders.get('u3')!, now)).toBe(true);
    expect(idsOf(evaluate().pending)).toEqual(['pending:order:u3']);
  });

  it('T4 counts one reservation lineage once, with the order fact winning', () => {
    const {state, evaluate} = host();
    state.entryReservations.set('r1', reservation('r1', 'DOGE', 'USDT'));
    state.entryOrders.set('o1', workingOrder('o1', 'DOGEUSDT', 'r1', {quantity: 10, price: 100, filledQuantity: 4}));
    const {pending} = evaluate();
    expect(idsOf(pending), JSON.stringify(pending)).toEqual(['pending:order:o1']);
    expect(pending[0]).toMatchObject({notionalUsd: 600});
  });

  it('T5 charges a partial fill only for the remaining quantity', () => {
    const {state, evaluate} = host();
    state.entryReservations.set('r2', reservation('r2', 'SOL', 'USDT', {notionalUsd: 2000, marginUsd: 200}));
    state.entryOrders.set('o2', workingOrder('o2', 'SOLUSDT', 'r2', {quantity: 20, price: 100, filledQuantity: 15}));
    const {pending, snapshot} = evaluate();
    expect(pending).toHaveLength(1);
    expect(pending[0].notionalUsd).toBe(500);
    expect(snapshot.pendingNotionalUsd).toBe(500);
  });

  it('T6 maps a USDC lineage to USDC instead of the USDT bucket', () => {
    const {state, evaluate} = host({assets: [{asset: 'USDT', walletBalance: 10_000, availableBalance: 9_000, usdValue: 10_000}, {asset: 'USDC', walletBalance: 5_000, availableBalance: 4_000, usdValue: 5_000}]});
    state.entryReservations.set('r3', reservation('r3', 'BNB', 'USDC', {notionalUsd: 800, marginUsd: 100}));
    state.entryOrders.set('o3', workingOrder('o3', 'BNBUSDC', 'r3', {quantity: 8, price: 100, filledQuantity: 0}));
    const {pending} = evaluate();
    expect(idsOf(pending)).toEqual(['pending:order:o3']);
    expect(pending[0]).toMatchObject({quoteAsset: 'USDC', notionalUsd: 800, marginUsd: 80});
    // A reservation-only lineage must keep its own verified margin, not a recomputed guess.
    state.entryOrders.delete('o3');
    expect(evaluate().pending[0]).toMatchObject({id: 'pending:reservation:r3', quoteAsset: 'USDC', marginUsd: 100});
  });

  it('T7 reproduces the live 46-row shape: 44 proven absent, 2 still unproven', () => {
    const {state, evaluate} = host();
    const symbols = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 0; i < 44; i++) state.entryOrders.set(`x${i}`, unknownOrder(`x${i}`, `${symbols[i % 5]}USDT`, {quantity: 1, price: 150, proof: 'valid'}));
    state.entryOrders.set('keep1', unknownOrder('keep1', 'BTCUSDT', {quantity: 1, price: 70_000, proof: 'none'}));
    state.entryOrders.set('keep2', unknownOrder('keep2', 'VVVUSDT', {quantity: 1, price: 40_000, proof: 'expired'}));

    const occupying = [...state.entryOrders.values()].filter(row => entryOrderOccupiesRisk(row, now)).map(row => `order:${row.id}`).sort();
    const {pending, snapshot} = evaluate();
    expect(idsOf(pending)).toEqual(['pending:order:keep1', 'pending:order:keep2'].sort());
    expect(idsOf(pending)).toEqual(occupying.map(id => `pending:${id}`));
    // 44 released rows are worth 44 x $150 of phantom exposure that must not be counted.
    expect(snapshot.pendingNotionalUsd).toBe(110_000);
    expect(pending.length).toBe(2);
  });

  it('never treats an absent exchange order id or a zero fill alone as proof of no risk', () => {
    const {state, evaluate} = host();
    state.entryOrders.set('bare', {id: 'bare', clientOrderId: 'ml_bare', exchangeOrderId: null, symbol: 'FETUSDT', side: 'LONG', quantity: 1, price: 100,
      filledQuantity: 0, leverage: 10, status: 'UNKNOWN', createdAt: 1, updatedAt: 1, absoluteExpiresAt: 999_999_999_999, repriceCount: 0, intentId: 'i', reservationId: null, reachability: 1} as any);
    expect(entryOrderOccupiesRisk(state.entryOrders.get('bare')!, now)).toBe(true);
    expect(idsOf(evaluate().pending)).toEqual(['pending:order:bare']);
  });

  it('holds the invariant that pending order membership equals the occupancy authority, for any mix', () => {
    const {state, evaluate} = host();
    state.entryReservations.set('m-r1', reservation('m-r1', 'DOGE', 'USDT'));
    state.entryReservations.set('m-r2', {...reservation('m-r2', 'SOL', 'USDT'), status: 'RELEASED'} as never);
    state.entryOrders.set('m-working', workingOrder('m-working', 'DOGEUSDT', 'm-r1'));
    state.entryOrders.set('m-unknown-proof', unknownOrder('m-unknown-proof', 'FETUSDT', {proof: 'valid'}));
    state.entryOrders.set('m-unknown-blind', unknownOrder('m-unknown-blind', 'AVAXUSDT', {proof: 'none'}));
    state.entryOrders.set('m-canceled-unknown-terminal', {id: 'm-canceled-unknown-terminal', clientOrderId: 'ml_c', exchangeOrderId: '9', symbol: 'NEOUSDT', side: 'LONG',
      quantity: 5, price: 20, filledQuantity: 0, leverage: 10, status: 'CANCELED', exchangeTerminalStatus: 'UNKNOWN', activeRiskExposure: true,
      createdAt: 1, updatedAt: 1, absoluteExpiresAt: 999_999_999_999, repriceCount: 0, intentId: 'i', reservationId: null, reachability: 1} as any);
    state.entryOrders.set('m-filled', {...workingOrder('m-filled', 'XRPUSDT', 'm-r2'), status: 'FILLED', filledQuantity: 10} as never);
    const facts = evaluate().pending;
    const authoritativeOrders = [...state.entryOrders.values()].filter(row => entryOrderOccupiesRisk(row, now)).map(row => `pending:order:${row.id}`).sort();
    expect(idsOf(facts).filter(id => id.includes('order:')).sort()).toEqual(authoritativeOrders);
    // A lineage whose order already represents its reservation must not add a second key.
    expect(facts.some(row => row.id === 'pending:reservation:m-r1')).toBe(false);
    // Every seed the risk account receives names a lineage source, and an unproven outcome is never
    // laundered into a verified fact.
    const seeds = collectPortfolioPendingRiskFacts(state, {now});
    expect(seeds.every(row => ['RESERVATION', 'ORDER', 'UNKNOWN'].includes(row.source))).toBe(true);
    expect(seeds.filter(row => row.source === 'UNKNOWN').map(row => row.id).sort()).toEqual(['order:m-canceled-unknown-terminal', 'order:m-unknown-blind']);
    expect(state.entryReservations.get('m-r1')).toMatchObject({status: 'WORKING'});
  });
});

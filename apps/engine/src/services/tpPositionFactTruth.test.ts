import { describe, expect, it, vi } from 'vitest';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { TpGuardian } from './tpGuardian.js';
import { coordinatedExchange, exitRuntimeHarness } from './v396ExitTestHarness.js';

/**
 * Problem C: one position row must never be able to say "unprotected live position" and "the exchange
 * has not settled whether this position exists" with the same label, and a proven live SHORT must be
 * protected by the same absolute quantity the exchange reports.
 */
const settings: any = {
  takeProfit: { enabled: true, targetPriceMovePercent: .45, quantityPercent: 100, tpEconomicsEnabled: false,
    minNetProfitUsd: .01, minNetProfitRoiPct: 0, feeSafetyBufferPct: 0, exitFeeAssumption: 'TAKER',
    slippageBufferPct: 0, entryFeeRate: .0004, makerFeeRate: .0002, takerFeeRate: .0004 },
};

function harness(position: any, exchange: any) {
  const state = new RuntimeState(settings), events = new EventBus(), seen: any[] = [];
  events.on('event', (event) => seen.push(event));
  state.positions.set(position.id, position);
  state.snapshots.set(position.symbol, { quote: { mark: position.markPrice, bid: position.markPrice - .12,
    ask: position.markPrice + .1, tickSize: .01, stepSize: .001, minQty: .001 } } as any);
  return { state, seen, guardian: new TpGuardian(state, exchange, events, exitRuntimeHarness()) };
}
const shortPosition = (): any => ({ id: 'p_dash', cycleId: 'cycle_test_dash', symbol: 'DASHUSDT', side: 'SHORT', quantity: .1,
  entryPrice: 62.9, markPrice: 62.5, leverage: 12, tpStatus: 'MISSING', tpOrderId: null });

describe('C1 a proven live SHORT is protected by its absolute exchange quantity', () => {
  it('the hedge-mode reduce-only TP is placed for a SHORT whose positionAmt is negative', async () => {
    const place = vi.fn(async (order: any) => ({ ...order, status: 'WORKING' }));
    const exchange = any({ ...coordinatedExchange({ mode: 'HEDGE', liveQuantity: .1 }), placeTakeProfit: place, findTakeProfitByClientOrderId: vi.fn(async () => null) });
    const position = shortPosition(), h = harness(position, exchange);
    await h.guardian.ensure(position);
    expect(exchange.proveReduction).toHaveBeenCalledWith({ symbol: 'DASHUSDT', positionSide: 'SHORT', quantity: .1 });
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0]![0].side).toBe('BUY');
    expect(h.state.positions.get('p_dash')?.tpStatus).toBe('PROTECTED');
    expect(h.guardian.metrics()).toMatchObject({ required: 1, protected: 1, missing: 0, positionFactUnresolved: 0 });
  });
});

describe('C2 a contradiction between the proof and the position book stays visibly unresolved', () => {
  const refusing = (message: string) => any({
    ...coordinatedExchange({ liveQuantity: .1 }),
    proveReduction: vi.fn(async () => { throw new Error(message); }),
    placeTakeProfit: vi.fn(async (order: any) => ({ ...order, status: 'WORKING' })),
    findTakeProfitByClientOrderId: vi.fn(async () => null),
  });

  it('NO_LIVE_POSITION while the authoritative book still holds the row is unresolved, not missing protection', async () => {
    const exchange = refusing('REDUCTION_PROOF_NO_LIVE_POSITION:DASHUSDT:SHORT');
    const position = shortPosition(), h = harness(position, exchange);
    await h.guardian.ensure(position);
    expect(exchange.placeTakeProfit).not.toHaveBeenCalled();
    expect(h.state.positions.get('p_dash')?.tpStatus).toBe('POSITION_FACT_UNRESOLVED');
    const event = h.seen.find((row: any) => row.type === 'TP_POSITION_FACT_UNRESOLVED');
    expect(event?.payload).toMatchObject({ positionId: 'p_dash', submissionOutcome: 'NOT_ATTEMPTED', reduceOnlySubmitted: false, durableSide: 'SHORT' });
    expect(h.guardian.metrics()).toMatchObject({ required: 0, protected: 0, missing: 0, positionFactUnresolved: 1 });
    expect(h.guardian.metrics().positionFactUnresolvedSymbols).toEqual(['DASHUSDT:SHORT']);
  });

  it('an unavailable proof fails closed the same way instead of guessing either answer', async () => {
    const exchange = refusing('REDUCTION_PROOF_UNAVAILABLE');
    const position = shortPosition(), h = harness(position, exchange);
    await h.guardian.ensure(position);
    expect(exchange.placeTakeProfit).not.toHaveBeenCalled();
    expect(h.state.positions.get('p_dash')?.tpStatus).toBe('POSITION_FACT_UNRESOLVED');
  });

  it('an ordinary submit rejection is still a repair failure and still counts as unprotected', async () => {
    const exchange = any({ ...coordinatedExchange({ mode: 'HEDGE', liveQuantity: .1 }),
      placeTakeProfit: vi.fn(async (order: any) => { throw new Error('Binance HTTP 400: {"code":-1111,"msg":"Precision over maximum"}'); }),
      findTakeProfitByClientOrderId: vi.fn(async () => null) });
    const position = shortPosition(), h = harness(position, exchange);
    await h.guardian.ensure(position);
    expect(h.state.positions.get('p_dash')?.tpStatus).toBe('REPAIR_FAILED');
    expect(h.seen.some((row: any) => row.type === 'TP_POSITION_FACT_UNRESOLVED')).toBe(false);
    expect(h.guardian.metrics()).toMatchObject({ required: 1, missing: 1, positionFactUnresolved: 0 });
  });
});

function any(value: unknown) { return value as any; }

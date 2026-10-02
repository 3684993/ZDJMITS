import { describe, expect, it } from 'vitest';
import { decimalFromUnits } from '@zdj/core';
import { OrderPrecisionError } from '../adapters/binance/orderPrecision.js';
import { harness, systemCandidateDecision } from './tradingQualityTestHarness.js';

describe('precision at native Entry execution', () => {
  it.each([0.0001, 0.00001, 0.005])('persists the authorized integer quantity without multiplication residue for step %s', async stepSize => {
    const h = harness();
    h.packet.market.quote.stepSize = stepSize;
    h.state.snapshots.get(h.packet.symbol)!.quote.stepSize = stepSize;
    await h.run();
    expect(h.exchange.placeEntry, JSON.stringify(h.events.filter(e => /BLOCKED|FAILED/.test(e.type)).map(e => e.payload.reason))).toHaveBeenCalledOnce();
    const intent = [...h.state.entryIntents.values()][0]!;
    const order = h.exchange.placeEntry.mock.calls[0]![0];
    const authorizedQuantity = decimalFromUnits(intent.quantityUnits!, intent.executionEnvelope!.exchange.stepSize);
    expect(String(order.quantity)).toBe(authorizedQuantity);
    expect([...h.state.entryOrders.values()][0]!.quantity).toBe(Number(authorizedQuantity));
  });

  it.each([true, false])('treats a precision failure as locally unsent only with typed proof=%s', async typed => {
    const h = harness();
    const error = new OrderPrecisionError(h.packet.symbol, 'quantity', 'OFF_GRID');
    h.exchange.placeEntry.mockRejectedValue(typed ? error : new Error(error.message));
    await h.run();
    const order = [...h.state.entryOrders.values()][0]!;
    expect(order.status).toBe(typed ? 'REJECTED' : 'UNKNOWN');
    if (typed) {
      expect(order.factSource).toBe('LOCAL_NOT_SUBMITTED');
      expect(h.exchange.findEntryByClientOrderId).not.toHaveBeenCalled();
    } else {
      expect(h.exchange.findEntryByClientOrderId).toHaveBeenCalledOnce();
    }
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  });

  it('keeps an acknowledged working order when only a local reprice is refused', async () => {
    const h = harness();
    await h.run();
    const order = [...h.state.entryOrders.values()][0]!;
    // Reprice management has already crossed admission in this focused outcome test.
    (h.coordinator as any).executionHardBlock = () => null;
    const market = h.state.snapshots.get(order.symbol)!;
    const intent = h.state.entryIntents.get(order.intentId)!;
    const price = order.price + market.quote.tickSize * 4;
    intent.idealPrice = price;
    intent.acceptablePriceRange = { min: price, max: price + market.quote.tickSize * 2 };
    market.quote.bid = price; market.quote.ask = price + market.quote.tickSize;
    order.updatedAt = Date.now() - 30_000;
    const replaceEntry = (h.exchange as any).replaceEntry = async () => { throw new OrderPrecisionError(order.symbol, 'price', 'OFF_GRID'); };
    expect(replaceEntry).toBeDefined();
    await h.coordinator.reviewPending();
    expect(h.state.entryOrders.get(order.id)!.status).toBe('WORKING');
    expect(h.events.some(e => e.type === 'ENTRY_ORDER_REPRICE_BLOCKED' && String(e.payload.reason).includes('ORDER_DECIMAL_INVALID'))).toBe(true);
  });

  it('does not reinterpret authorized units if the exchange step changes while setting leverage', async () => {
    const h = harness();
    h.exchange.setLeverage.mockImplementation(async () => {
      h.state.snapshots.get(h.packet.symbol)!.quote.stepSize *= 10;
    });
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.some(e => String(e.payload.reason).includes('EXCHANGE_STEP_CHANGED_AFTER_DECISION'))).toBe(true);
    expect([...h.state.entryOrders.values()].some(o => o.status === 'UNKNOWN')).toBe(false);
  });

  it('ends a malformed legacy wait locally without throwing from the scheduler', async () => {
    const h = harness();
    const q = h.state.snapshots.get(h.packet.symbol)!.quote;
    const target = Math.ceil(q.bid * 1.02 / q.tickSize) * q.tickSize;
    h.ai.decide.mockImplementation(async (packet: any) => ({runId:'precision-wait',
      decision:systemCandidateDecision(packet,h.supplied,'LONG',{idealPrice:target,acceptablePriceRange:{min:target,max:target+q.tickSize*4}})}));
    await h.run();
    expect(h.state.candidateLifecycle.get(h.packet.symbol).status).toBe('WAIT_EXECUTION_RANGE');
    const intent = [...h.state.entryIntents.values()][0]!;
    delete intent.quantityUnits;
    Object.assign(q,{bid:target,ask:target+q.tickSize,last:target,mark:target});
    await expect((h.coordinator as any).resumeExecutionWaits(Date.now())).resolves.toBeUndefined();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.candidateLifecycle.get(h.packet.symbol).status).toBe('REJECT_COOLDOWN');
  });

  it('retains a working legacy order when missing units prevent constructing an amend', async () => {
    const h = harness();await h.run();
    const order=[...h.state.entryOrders.values()][0]!,intent=h.state.entryIntents.get(order.intentId)!;
    const q=h.state.snapshots.get(order.symbol)!.quote,price=order.price+q.tickSize*4;
    delete intent.quantityUnits;intent.idealPrice=price;intent.acceptablePriceRange={min:price,max:price+q.tickSize*2};
    q.bid=price;q.ask=price+q.tickSize;order.updatedAt=Date.now()-30_000;
    await h.coordinator.reviewPending();
    expect(h.state.entryOrders.get(order.id)!.status).toBe('WORKING');
    expect(h.events.some(e=>e.type==='ENTRY_ORDER_REPRICE_BLOCKED'&&e.payload.requestSent===false)).toBe(true);
  });
});

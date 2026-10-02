import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryOrder, TakeProfitOrder } from '@zdj/contracts';
import { ExternalTradeAdapter } from './ExternalTradeAdapter.js';
import { OrderPrecisionError, type OrderPrecisionRulesReader } from '../binance/orderPrecision.js';

const NOW = 1_790_850_591_900;
const SECRET = 'isolated-test-secret';
const BTC_RULES = { stepSize: 0.0001, tickSize: 0.1 };
const defaultRules: OrderPrecisionRulesReader = symbol => symbol === 'BTCUSDT' ? BTC_RULES : undefined;

type Call = { url: URL; method: string; init?: { method?: string; entryExecutionExpiresAt?: number } };
function harness(readRules: OrderPrecisionRulesReader = defaultRules) {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const calls: Call[] = [];
  let lastWrite: URLSearchParams | undefined;
  let canceled = false;
  const transport = {
    environment: () => 'TESTNET',
    executionMode: () => 'TESTNET_ENABLED',
    assertTestnetExchangeWrite: vi.fn(),
    json: vi.fn(async (path: string, init?: Call['init']) => {
      const url = new URL(path, 'https://isolated.invalid');
      const method = init?.method ?? 'GET';
      calls.push({ url, method, init });
      if (url.pathname === '/fapi/v1/time') return { serverTime: NOW };
      if (url.pathname === '/fapi/v1/positionSide/dual') return { dualSidePosition: false };
      if (url.pathname === '/fapi/v1/order') {
        if (method === 'POST' || method === 'PUT') {
          lastWrite = url.searchParams;
          return { orderId: 123, status: 'NEW' };
        }
        if (method === 'DELETE') { canceled = true; return { orderId: 123 }; }
        return {
          symbol: url.searchParams.get('symbol'), orderId: 123, clientOrderId: 'ml_precision_test',
          status: canceled ? 'CANCELED' : 'NEW', origQty: lastWrite?.get('quantity') ?? '0.0107',
          price: lastWrite?.get('price') ?? '83623.5', executedQty: '0', updateTime: NOW,
        };
      }
      throw new Error(`Unexpected mocked route: ${method} ${url.pathname}`);
    }),
  };
  const adapter = new ExternalTradeAdapter(transport as never, { apiKey: 'isolated-key', apiSecret: SECRET }, 5000, readRules);
  const writes = () => calls.filter(call => call.url.pathname === '/fapi/v1/order' && ['POST', 'PUT'].includes(call.method));
  return { adapter, calls, writes, transport };
}
function entry(overrides: Partial<EntryOrder> = {}): EntryOrder {
  return {
    id: 'entry_precision_test', intentId: 'intent_precision_test', clientOrderId: 'ml_precision_test',
    exchangeOrderId: null, symbol: 'BTCUSDT', side: 'LONG', quantity: 107 * 0.0001,
    price: 83623.5, filledQuantity: 0, leverage: 20, status: 'NEW', createdAt: NOW - 1,
    updatedAt: NOW - 1, decisionCompletedAt: NOW - 1, decisionExecutionExpiresAt: NOW + 59_999,
    absoluteExpiresAt: NOW + 59_999, repriceCount: 0, reachability: 1, fillState: 'NONE', fills: [], ...overrides,
  };
}
function takeProfit(overrides: Partial<TakeProfitOrder> = {}): TakeProfitOrder {
  return {
    id: 'tp_precision_test', positionId: 'position_precision_test', clientOrderId: 'tp_precision_test',
    exchangeOrderId: null, symbol: 'BTCUSDT', side: 'SELL', quantity: 107 * 0.0001,
    price: 83623.5, status: 'WORKING', createdAt: NOW - 1, updatedAt: NOW - 1, ...overrides,
  };
}
function expectSignature(call: Call) {
  const unsigned = new URLSearchParams(call.url.searchParams);
  const signature = unsigned.get('signature');
  unsigned.delete('signature');
  expect(signature).toBe(createHmac('sha256', SECRET).update(unsigned.toString()).digest('hex'));
}
afterEach(() => vi.restoreAllMocks());

describe('ExternalTradeAdapter decimal wire boundary', () => {
  it('signs the BTC 107-unit regression as 0.0107 without changing the authorized quantity', async () => {
    const h = harness();
    const order = entry();
    expect(String(order.quantity)).toBe('0.010700000000000001');
    const result = await h.adapter.placeEntry(order);
    expect(h.writes()).toHaveLength(1);
    const call = h.writes()[0]!;
    expect(call.method).toBe('POST');
    expect(Object.fromEntries(call.url.searchParams)).toMatchObject({
      symbol: 'BTCUSDT', quantity: '0.0107', price: '83623.5', type: 'LIMIT', timeInForce: 'GTX',
    });
    expect(call.init?.entryExecutionExpiresAt).toBe(order.decisionExecutionExpiresAt);
    expectSignature(call);
    expect(result).toMatchObject({ quantity: order.quantity, exchangeOrderId: '123', status: 'WORKING' });
    expect(order.quantity).toBe(107 * 0.0001);
  });

  it('canonicalizes a floating price tail on native PUT while preserving order identity and the deadline', async () => {
    const h = harness();
    const order = entry({ exchangeOrderId: '123', status: 'WORKING' });
    const result = await h.adapter.replaceEntry(order, 0.1 + 0.2);
    expect(h.writes()).toHaveLength(1);
    const call = h.writes()[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url.searchParams.get('quantity')).toBe('0.0107');
    expect(call.url.searchParams.get('price')).toBe('0.3');
    expect(call.url.searchParams.get('origClientOrderId')).toBe(order.clientOrderId);
    expect(call.init?.entryExecutionExpiresAt).toBe(order.decisionExecutionExpiresAt);
    expectSignature(call);
    expect(result).toMatchObject({ exchangeOrderId: '123', price: 0.3, repriceCount: 1, absoluteExpiresAt: order.absoluteExpiresAt });
    expect(h.calls.some(call => call.method === 'POST' || call.method === 'DELETE')).toBe(false);
  });

  it('applies the same canonical wire representation to take-profit without losing reduceOnly', async () => {
    const h = harness();
    await h.adapter.placeTakeProfit(takeProfit({ price: 0.1 + 0.2 }));
    const call = h.writes()[0]!;
    expect(Object.fromEntries(call.url.searchParams)).toMatchObject({
      quantity: '0.0107', price: '0.3', type: 'LIMIT', timeInForce: 'GTC', reduceOnly: 'true', side: 'SELL',
    });
    expectSignature(call);
  });

  it.each(['LIMIT', 'MARKET'] as const)('canonicalizes manual %s quantity and never invents a MARKET price', async type => {
    const h = harness();
    await h.adapter.placeManualOrder({
      clientOrderId: 'manual_precision_test', symbol: 'BTCUSDT', side: 'SELL', type,
      quantity: 107 * 0.0001, ...(type === 'LIMIT' ? { price: 0.1 + 0.2 } : {}),
      reduceOnly: true, postOnly: type === 'LIMIT',
    });
    expect(h.writes()).toHaveLength(1);
    const call = h.writes()[0]!;
    expect(call.url.searchParams.get('quantity')).toBe('0.0107');
    expect(call.url.searchParams.get('price')).toBe(type === 'LIMIT' ? '0.3' : null);
    expect(call.url.searchParams.get('type')).toBe(type);
    expect(call.url.searchParams.get('reduceOnly')).toBe('true');
    expectSignature(call);
  });

  it('uses each symbol’s current filters for scientific notation and non-power-of-ten increments', async () => {
    const rules = vi.fn<OrderPrecisionRulesReader>(symbol => ({
      BTCUSDT: BTC_RULES,
      TINYUSDT: { stepSize: 1e-8, tickSize: 1e-7 },
      ODDUSDT: { stepSize: 0.005, tickSize: 0.25 },
    })[symbol]);
    const h = harness(rules);
    await h.adapter.placeEntry(entry());
    await h.adapter.placeEntry(entry({ symbol: 'TINYUSDT', quantity: 3 * 1e-8, price: 3 * 1e-7 }));
    await h.adapter.placeEntry(entry({ symbol: 'ODDUSDT', quantity: 3 * 0.005, price: 7 * 0.25 }));
    expect(h.writes().map(call => [call.url.searchParams.get('symbol'), call.url.searchParams.get('quantity'), call.url.searchParams.get('price')])).toEqual([
      ['BTCUSDT', '0.0107', '83623.5'], ['TINYUSDT', '0.00000003', '0.0000003'], ['ODDUSDT', '0.015', '1.75'],
    ]);
    expect(rules.mock.calls.map(([symbol]) => symbol)).toEqual(['BTCUSDT', 'TINYUSDT', 'ODDUSDT']);
    h.writes().forEach(expectSignature);
  });

  it('rechecks changed filters on the next submission instead of using a precision cached for the symbol', async () => {
    let rules = { stepSize: 0.0001, tickSize: 0.1 };
    const h = harness(() => rules);
    await h.adapter.placeEntry(entry());
    rules = { stepSize: 0.001, tickSize: 0.1 };
    await expect(h.adapter.placeEntry(entry())).rejects.toBeInstanceOf(OrderPrecisionError);
    expect(h.writes()).toHaveLength(1);
  });
});

describe('ExternalTradeAdapter refuses invalid decimals before an order write', () => {
  it.each([
    ['quantity', 0.01075], ['price', 83623.55], ['quantity', NaN], ['quantity', Infinity],
    ['quantity', 0], ['quantity', -0.01], ['price', NaN], ['price', 0], ['price', -1],
  ] as const)('rejects %s=%s instead of rounding it into an order', async (field, value) => {
    const h = harness();
    let error: unknown;
    try { await h.adapter.placeEntry(entry({ [field]: value })); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(OrderPrecisionError);
    expect(error).toMatchObject({ code: 'ORDER_DECIMAL_INVALID', symbol: 'BTCUSDT', field, wireAttempted: false });
    expect(h.writes()).toHaveLength(0);
    expect(h.transport.assertTestnetExchangeWrite).not.toHaveBeenCalled();
  });

  it('rejects a PUT off the price lattice without dispatching or querying a possibly changed order', async () => {
    const h = harness();
    await expect(h.adapter.replaceEntry(entry(), 83623.55)).rejects.toBeInstanceOf(OrderPrecisionError);
    expect(h.calls.filter(call => call.url.pathname === '/fapi/v1/order')).toHaveLength(0);
  });

  it('refuses missing per-symbol rules before signing an order write', async () => {
    const h = harness(() => undefined);
    await expect(h.adapter.placeEntry(entry())).rejects.toMatchObject({
      name: 'OrderPrecisionError', field: 'filters', detail: 'UNAVAILABLE', wireAttempted: false,
    });
    expect(h.writes()).toHaveLength(0);
  });

  it('rejects an absent LIMIT price and an invalid MARKET quantity through the manual path', async () => {
    const h = harness();
    const base = { clientOrderId: 'manual_precision_test', symbol: 'BTCUSDT', side: 'BUY' as const, reduceOnly: false, postOnly: false };
    await expect(h.adapter.placeManualOrder({ ...base, type: 'LIMIT', quantity: 0.01 })).rejects.toBeInstanceOf(OrderPrecisionError);
    await expect(h.adapter.placeManualOrder({ ...base, type: 'MARKET', quantity: NaN })).rejects.toBeInstanceOf(OrderPrecisionError);
    expect(h.writes()).toHaveLength(0);
  });

  it('keeps exact queries and cancellation available when order filters are missing', async () => {
    const readRules = vi.fn<OrderPrecisionRulesReader>(() => undefined);
    const h = harness(readRules);
    const working = entry({ status: 'WORKING', exchangeOrderId: '123' });
    expect(await h.adapter.findEntryByClientOrderId(working)).toMatchObject({ status: 'WORKING', exchangeOrderId: '123' });
    expect(await h.adapter.cancelEntry(working)).toMatchObject({ status: 'CANCELED', exchangeOrderId: '123' });
    expect(h.calls.filter(call => call.url.pathname === '/fapi/v1/order').map(call => call.method)).toEqual(['GET', 'DELETE', 'GET']);
    expect(readRules).not.toHaveBeenCalled();
    expect(h.writes()).toHaveLength(0);
    h.calls.filter(call => call.url.pathname === '/fapi/v1/order').forEach(expectSignature);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { SystemSettingsSchema } from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with { type: 'json' };
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { EntryCoordinator } from './entryCoordinator.js';
import { binanceEgressEntryBlockReason, binanceEgressState } from '../adapters/binance/requestBudget.js';
import { BinanceTransport } from '../adapters/binance/BinanceTransport.js';
import { ExternalTradeAdapter } from '../adapters/exchange/ExternalTradeAdapter.js';

/** node:https is stubbed so the egress echo service can be driven to VERIFIED / MISMATCH / UNAVAILABLE on demand. */
const harness = vi.hoisted(() => ({ request: ((..._args: any[]): any => { throw new Error('HTTPS_NOT_STUBBED'); }) as (...args: any[]) => any }));
vi.mock('node:https', () => ({ default: { request: (...args: any[]) => harness.request(...args) } }));

const settings = () => SystemSettingsSchema.parse({ ...defaults, appearance: { ...defaults.appearance, theme: 'BINANCE_NOIR' } });
const transportSettings = (expectedStaticEgressIp: string | null) => ({
  executionMode: 'TESTNET_ENABLED',
  exchange: {
    environment: 'TESTNET', testnetBaseUrl: 'https://demo-fapi.binance.com', testnetRestBaseUrl: 'https://demo-fapi.binance.com',
    testnetWsBaseUrl: 'wss://stream.binancefuture.com/ws', productionBaseUrl: 'https://fapi.binance.com',
    productionRestBaseUrl: 'https://fapi.binance.com', productionWsBaseUrl: 'wss://fstream.binance.com/ws',
  },
  proxy: { enabled: true, url: 'socks5h://127.0.0.1:20081', expectedStaticEgressIp, forceBinanceRest: true, forceBinanceWs: true, proxyDns: true, failClosed: true, binanceRestRoute: 'CONFIGURED' },
});

function stubEgressEcho(body: string, options: { error?: string; status?: number } = {}) {
  harness.request = ((_url: any, _opts: any, onResponse: any) => {
    const handlers: Record<string, () => void> = {};
    return {
      once(event: string, handler: () => void) { handlers[event] = handler; return this; },
      end() {
        if (options.error) { setTimeout(() => handlers.error?.(), 0); return; }
        const response = {
          statusCode: options.status ?? 200, setEncoding() { },
          on(event: string, handler: (chunk?: string) => void) {
            if (event === 'data') setTimeout(() => handler(body), 0);
            if (event === 'end') setTimeout(() => handler(), 5);
          },
        };
        setTimeout(() => onResponse(response), 0);
      },
      destroy() { return this; },
    };
  }) as any;
}

function coordinatorFixture(admissionReason: { value: string | null }) {
  const state = new RuntimeState(settings()), events: any[] = [];
  const bus = new EventBus(); bus.on('event', event => events.push(event));
  const exchange: any = {
    entryAdmissionBlockReason: vi.fn(() => admissionReason.value),
    findEntryByClientOrderId: vi.fn(async () => null),
    cancelEntry: vi.fn(async (order: any) => order),
    replaceEntry: vi.fn(async (order: any) => order),
  };
  const ai: any = { setIdleContext: vi.fn(), startPrimary: vi.fn(), dispatch: vi.fn(), beginPrimary: vi.fn() };
  const coordinator = new EntryCoordinator(state, {} as any, ai, exchange, bus);
  return { state, events, exchange, ai, coordinator };
}

describe('egress fail-closed single source of truth', () => {
  it('treats an absent expectation as no gate and any non-VERIFIED status as blocked', () => {
    expect(binanceEgressEntryBlockReason({ expectedEgressIp: null, status: 'UNVERIFIED' })).toBeNull();
    expect(binanceEgressEntryBlockReason({ expectedEgressIp: '203.0.113.10', status: 'VERIFIED' })).toBeNull();
    for (const status of ['UNVERIFIED', 'UNAVAILABLE', 'MISMATCH'])
      expect(binanceEgressEntryBlockReason({ expectedEgressIp: '203.0.113.10', status })).toBe(`BINANCE_EGRESS_${status}`);
    expect(binanceEgressState({})).toMatchObject({ expected: null, status: 'UNVERIFIED', verified: true });
  });

  it('blocks both Entry admission and the write boundary while the probe cannot reach the echo service', async () => {
    const transport = new BinanceTransport(transportSettings('203.0.113.10') as never);
    stubEgressEcho('', { error: ' aborted' });
    expect((await transport.verifyEgressIp()).status).toBe('UNAVAILABLE');
    expect(transport.entryBlockReason()).toBe('BINANCE_EGRESS_UNAVAILABLE');
    expect(() => transport.assertTestnetExchangeWrite()).toThrow('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE');
  });

  it('admits again on the same instance after a successful re-verification, without a restart', async () => {
    const transport = new BinanceTransport(transportSettings('203.0.113.10') as never);
    stubEgressEcho('203.0.113.10\n');
    expect((await transport.verifyEgressIp()).status).toBe('VERIFIED');
    expect(transport.entryBlockReason()).toBeNull();
    expect(() => transport.assertTestnetExchangeWrite()).not.toThrow();
  });

  it('reports MISMATCH when the observed egress IP differs from the configured static IP', async () => {
    const transport = new BinanceTransport(transportSettings('203.0.113.10') as never);
    stubEgressEcho('198.51.100.99\n');
    expect((await transport.verifyEgressIp()).status).toBe('MISMATCH');
    expect(transport.entryBlockReason()).toBe('BINANCE_EGRESS_MISMATCH');
    expect(() => transport.assertTestnetExchangeWrite()).toThrow('TESTNET_WRITE_EGRESS_NOT_VERIFIED:MISMATCH');
  });

  it('invalidates a carried proof when the expected static egress IP changes on the same route', async () => {
    const first = transportSettings('203.0.113.10'), transport = new BinanceTransport(first as never);
    stubEgressEcho('203.0.113.10\n');
    await transport.verifyEgressIp();
    expect(transport.egressStatus()).toMatchObject({ status: 'VERIFIED', lastVerifiedEgressIp: '203.0.113.10' });
    transport.reconfigure(transportSettings('198.51.100.7') as never);
    expect(transport.egressStatus()).toMatchObject({ expectedEgressIp: '198.51.100.7', status: 'UNVERIFIED', lastVerifiedEgressIp: null });
    expect(transport.entryBlockReason()).toBe('BINANCE_EGRESS_UNVERIFIED');
    expect(() => transport.assertTestnetExchangeWrite()).toThrow('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNVERIFIED');
  });

  it('refuses the exchange write before opening a socket and keeps the write counters clean', async () => {
    const transport = new BinanceTransport(transportSettings('203.0.113.10') as never);
    stubEgressEcho('', { error: 'aborted' });
    await transport.verifyEgressIp();
    const adapter = new ExternalTradeAdapter(transport, { apiKey: 'k', apiSecret: 's' });
    const dispatch = vi.spyOn(transport, 'json');
    await expect(adapter.cancelEntry({ id: 'entry_x', symbol: 'BTCUSDT', clientOrderId: 'ml_x', exchangeOrderId: '1', quantity: 1 } as never))
      .rejects.toThrow('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE');
    expect(dispatch).not.toHaveBeenCalled();
    expect((adapter as any).writeStats).toMatchObject({ testnetWrites: 0, productionWrites: 0, blockedProductionWriteAttempts: 1 });
  });
});

describe('Layer A: Entry admission reads the transport egress proof', () => {
  it('stops the pool before any AI dispatch or state mutation and reports the reason once', async () => {
    const admission = { value: 'BINANCE_EGRESS_UNAVAILABLE' };
    const { state, events, ai, coordinator } = coordinatorFixture(admission);
    state.tpOrders.set('tp_keep', { id: 'tp_keep', symbol: 'BTCUSDT', status: 'WORKING' } as any);
    state.positions.set('position_keep', { id: 'position_keep', symbol: 'BTCUSDT', side: 'LONG' } as any);
    const before = { tp: state.tpOrders.size, positions: state.positions.size, orders: state.entryOrders.size, reservations: state.entryReservations.size, lifecycle: state.candidateLifecycle.size };
    for (let pass = 0; pass < 4; pass += 1) await coordinator.processPool();
    expect(events.filter(event => event.type === 'ENTRY_ADMISSION_BLOCKED')).toHaveLength(1);
    expect(events.filter(event => event.type === 'ENTRY_ADMISSION_BLOCKED')[0]?.payload).toMatchObject({ reason: 'BINANCE_EGRESS_UNAVAILABLE', previousReason: null });
    expect(ai.setIdleContext).not.toHaveBeenCalled();
    expect(ai.startPrimary).not.toHaveBeenCalled();
    expect({ tp: state.tpOrders.size, positions: state.positions.size, orders: state.entryOrders.size, reservations: state.entryReservations.size, lifecycle: state.candidateLifecycle.size }).toEqual(before);
  });

  it('resumes admission automatically once the proof returns, without a restart', async () => {
    const admission = { value: 'BINANCE_EGRESS_MISMATCH' };
    const { events, ai, coordinator } = coordinatorFixture(admission);
    await coordinator.processPool();
    admission.value = null;
    await coordinator.processPool();
    await coordinator.processPool();
    const resumed = events.filter(event => event.type === 'ENTRY_ADMISSION_RESUMED');
    expect(resumed).toHaveLength(1);
    expect(resumed[0].payload).toMatchObject({ reason: null, previousReason: 'BINANCE_EGRESS_MISMATCH' });
    expect(ai.setIdleContext).toHaveBeenCalled();
    expect(events.filter(event => event.type === 'ENTRY_ADMISSION_BLOCKED')).toHaveLength(1);
  });

  it('surfaces the egress reason through the final execution hard block as well', () => {
    const { coordinator } = coordinatorFixture({ value: 'BINANCE_EGRESS_UNAVAILABLE' });
    expect((coordinator as any).executionHardBlock({ symbol: 'BTCUSDT', id: 'intent_x' })).toBe('BINANCE_EGRESS_UNAVAILABLE');
  });

  it('leaves order-state auditing and read-only recovery paths running while admission is blocked', async () => {
    const admission = { value: 'BINANCE_EGRESS_UNAVAILABLE' };
    const { state, exchange, coordinator } = coordinatorFixture(admission);
    state.entryOrders.set('entry_fresh', {
      id: 'entry_fresh', intentId: 'intent_fresh', symbol: 'BTCUSDT', side: 'LONG', quantity: 2, price: 100, filledQuantity: 0,
      status: 'UNKNOWN', clientOrderId: 'ml_fresh', exchangeOrderId: null, createdAt: Date.now() - 5_000, updatedAt: Date.now() - 5_000,
      absoluteExpiresAt: Date.now() + 60_000, repriceCount: 0, reachability: 1, reservationId: null,
    } as any);
    exchange.entryAdmissionBlockReason.mockClear();
    await coordinator.reviewPending();
    expect(exchange.entryAdmissionBlockReason).not.toHaveBeenCalled();
    expect(exchange.findEntryByClientOrderId).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing budget semantics in front of Entry when the egress proof is healthy', async () => {
    const admission = { value: 'BINANCE_BUDGET_SATURATED' };
    const { events, ai, coordinator } = coordinatorFixture(admission);
    await coordinator.processPool();
    expect(events.filter(event => event.type === 'ENTRY_ADMISSION_BLOCKED')[0]?.payload).toMatchObject({ reason: 'BINANCE_BUDGET_SATURATED' });
    expect(ai.setIdleContext).not.toHaveBeenCalled();
  });
});

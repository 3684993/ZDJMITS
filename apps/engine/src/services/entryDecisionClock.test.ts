import {afterEach, describe, expect, it, vi} from 'vitest';
import {EntryIntentSchema, EntryOrderSchema} from '@zdj/contracts';
import {EntryCoordinator} from './entryCoordinator.js';
import {EntryExecutionExpiredBeforeDispatchError} from '../adapters/binance/entryDispatchDeadline.js';
import {harness, systemCandidateDecision} from './tradingQualityTestHarness.js';

const EXPIRED = 'ENTRY_DECISION_EXECUTION_EXPIRED';
afterEach(() => vi.restoreAllMocks());

function timedHarness() {
  const start = Date.now();
  let now = start;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const h = harness();
  const original = h.ai.decide.getMockImplementation()!;
  h.ai.decide.mockImplementation(async (...args: any[]) => ({
    ...await original(...args), decisionCompletedAt: now, latencyMs: 135_664,
  }));
  const setTime = (at: number, refresh = true) => {
    now = at;
    if (refresh) {
      const market = h.state.snapshots.get(h.packet.symbol)!;
      market.quote.ts = now;
      market.orderBook.ts = now;
      h.state.account.asOf = now;
    }
  };
  return {...h, start, setTime};
}

function reasons(h: ReturnType<typeof timedHarness>) {
  return h.events.filter(e => /BLOCKED|REJECTED|FAILED|TERMINATED/.test(e.type));
}

async function waitingHarness() {
  const h = timedHarness();
  const market = h.state.snapshots.get(h.packet.symbol)!;
  const tick = market.quote.tickSize;
  const target = Math.ceil(market.quote.bid * 1.02 / tick) * tick;
  h.ai.decide.mockImplementation(async (packet: any) => ({
    runId: 'waiting-clock-run', decisionCompletedAt: h.start, latencyMs: 135_664,
    decision: systemCandidateDecision(packet, h.supplied, 'LONG', {
      idealPrice: target, acceptablePriceRange: {min: target, max: target + tick * 4},
    }),
  }));
  await h.run();
  expect(h.state.candidateLifecycle.get(h.packet.symbol), JSON.stringify(reasons(h))).toMatchObject({status: 'WAIT_EXECUTION_RANGE'});
  expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  const makeReachable = () => {
    const snapshot = h.state.snapshots.get(h.packet.symbol)!;
    Object.assign(snapshot.quote, {bid: target, ask: target + tick, last: target, mark: target});
  };
  return {...h, makeReachable};
}

describe('Entry execution clock starts at a valid PLACE completion', () => {
  it('accepts a 135-second Primary result with fresh facts and grants one 60-second execution window', async () => {
    const h = timedHarness();
    h.state.settings.ai.decisionTimeoutMs = 180_000;
    const original = h.ai.decide.getMockImplementation()!;
    const completedAt = h.start + 135_664;
    h.ai.decide.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      h.setTime(completedAt);
      return {...result, decisionCompletedAt: completedAt};
    });
    await h.run();
    expect(h.exchange.placeEntry, JSON.stringify(reasons(h))).toHaveBeenCalledOnce();
    const intent = [...h.state.entryIntents.values()][0] as any;
    const order = h.exchange.placeEntry.mock.calls[0][0] as any;
    expect(intent).toMatchObject({decisionCompletedAt: completedAt, decisionExecutionExpiresAt: completedAt + 60_000, absoluteExpiresAt: completedAt + 60_000});
    expect(order).toMatchObject({decisionCompletedAt: completedAt, decisionExecutionExpiresAt: completedAt + 60_000, absoluteExpiresAt: completedAt + 60_000});
    expect(JSON.stringify(h.events)).not.toContain('PRIMARY_LATENCY_EXECUTION_BOUND_EXCEEDED');
  });

  it.each([[59_999, true], [60_000, false]] as const)('a leverage request consuming %i ms leaves submit allowed=%s', async (elapsed, allowed) => {
    const h = timedHarness();
    h.exchange.setLeverage.mockImplementation(async () => h.setTime(h.start + elapsed));
    await h.run();
    expect(h.exchange.placeEntry, JSON.stringify(reasons(h))).toHaveBeenCalledTimes(allowed ? 1 : 0);
    const intent = [...h.state.entryIntents.values()][0] as any;
    expect(intent.decisionExecutionExpiresAt).toBe(h.start + 60_000);
    if (!allowed) {
      expect(JSON.stringify(reasons(h))).toContain(EXPIRED);
      expect([...h.state.entryOrders.values()].some(o => o.status === 'UNKNOWN' || o.status === 'SUBMITTING')).toBe(false);
    }
  });

  it('does not reset the clock when the completed decision was returned late to its caller', async () => {
    const h = timedHarness();
    const original = h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async (...args: any[]) => ({...await original(...args), decisionCompletedAt: h.start - 60_000}));
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.entryIntents.size).toBe(0);
    expect(JSON.stringify(reasons(h))).toContain(EXPIRED);
  });

  it('an authorized price wait uses the original deadline and never reruns Primary at expiry', async () => {
    const h = await waitingHarness();
    const intent = [...h.state.entryIntents.values()][0] as any;
    expect(h.state.candidateLifecycle.get(h.packet.symbol).executionWait.expiresAt).toBe(h.start + 60_000);
    h.setTime(h.start + 30_000);
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    expect(intent.decisionExecutionExpiresAt).toBe(h.start + 60_000);
    h.setTime(h.start + 60_000);
    h.makeReachable();
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.state.candidateLifecycle.get(h.packet.symbol)).toMatchObject({status: 'REJECT_COOLDOWN', executionWait: null});
    expect(h.events.find(e => e.type === 'ENTRY_EXECUTION_WAIT_TERMINATED')?.payload.reason).toBe(EXPIRED);
  });

  it.each(['journal claim', 'submit event'] as const)('accounts for synchronous %s work immediately before the wire call', async delayAt => {
    const h = timedHarness();
    if (delayAt === 'journal claim') {
      (h.coordinator as any).journal = {
        claim: vi.fn(() => {h.setTime(h.start + 60_000); return {acquired: true};}),
        save: vi.fn(),
      };
    } else {
      h.bus.on('event', e => {if (e.type === 'ENTRY_SUBMIT_ATTEMPTED') h.setTime(h.start + 60_000);});
    }
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.exchange.findEntryByClientOrderId).not.toHaveBeenCalled();
    expect([...h.state.entryOrders.values()][0]).toMatchObject({status: 'REJECTED', factSource: 'LOCAL_NOT_SUBMITTED'});
    expect(JSON.stringify(reasons(h))).toContain(EXPIRED);
  });

  it.each([true, false])('classifies transport expiry as proven unsent only with its typed proof=%s', async provenUnsent => {
    const h = timedHarness();
    h.exchange.placeEntry.mockImplementation(async () => {
      h.setTime(h.start + 60_000);
      throw provenUnsent ? new EntryExecutionExpiredBeforeDispatchError() : new Error(EXPIRED);
    });
    await h.run();
    const order = [...h.state.entryOrders.values()][0];
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(order.status).toBe(provenUnsent ? 'REJECTED' : 'UNKNOWN');
    expect(h.exchange.findEntryByClientOrderId).toHaveBeenCalledTimes(provenUnsent ? 0 : 1);
    if (provenUnsent) expect(order.factSource).toBe('LOCAL_NOT_SUBMITTED');
    else expect(h.state.candidateLifecycle.get(h.packet.symbol).reason).toBe('SUBMISSION_UNKNOWN_RECONCILIATION');
  });

  it('does not renew the deadline after an exchange post-only rejection', async () => {
    const h = await waitingHarness();
    h.makeReachable();
    h.exchange.placeEntry.mockRejectedValue(new Error('BINANCE -5022 post-only would take liquidity'));
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    const order = [...h.state.entryOrders.values()][0] as any;
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(order.status).toBe('NEW');
    expect(order.decisionExecutionExpiresAt).toBe(h.start + 60_000);
    h.setTime(h.start + 60_000);
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.events.find(e => e.type === 'ENTRY_EXECUTION_WAIT_TERMINATED')?.payload.reason).toBe(EXPIRED);
    expect(h.state.entryOrders.get(order.id)?.status).toBe('REJECTED');
  });

  it('preserves the decision timestamps through schema serialization and a reconstructed coordinator', async () => {
    const h = await waitingHarness();
    const original = [...h.state.entryIntents.values()][0];
    const restored = EntryIntentSchema.parse(JSON.parse(JSON.stringify(original))) as any;
    expect(restored).toMatchObject({decisionCompletedAt: h.start, decisionExecutionExpiresAt: h.start + 60_000});
    h.state.entryIntents.set(restored.id, restored);
    h.setTime(h.start + 60_000);
    h.makeReachable();
    const restarted = new EntryCoordinator(h.state, {} as never, h.ai as never, h.exchange as never, h.bus);
    await (restarted as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(restored.decisionExecutionExpiresAt).toBe(h.start + 60_000);
    expect(h.events.find(e => e.type === 'ENTRY_EXECUTION_WAIT_TERMINATED')?.payload.reason).toBe(EXPIRED);
  });

  it('continues querying its UNKNOWN order after expiry without granting a second submit', async () => {
    const h = await waitingHarness();
    h.makeReachable();
    h.exchange.placeEntry.mockRejectedValue(new Error('response lost'));
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    const original = [...h.state.entryOrders.values()][0];
    expect(original.status).toBe('UNKNOWN');
    const restored = EntryOrderSchema.parse(JSON.parse(JSON.stringify(original))) as any;
    expect(restored).toMatchObject({decisionCompletedAt: h.start, decisionExecutionExpiresAt: h.start + 60_000});
    h.state.entryOrders.set(restored.id, restored);
    h.setTime(h.start + 60_001);
    h.exchange.findEntryByClientOrderId.mockResolvedValue({...restored, status: 'WORKING', exchangeOrderId: 'accepted-before-deadline'} as any);
    const restarted = new EntryCoordinator(h.state, {} as never, h.ai as never, h.exchange as never, h.bus);
    await (restarted as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.exchange.findEntryByClientOrderId).toHaveBeenLastCalledWith(expect.objectContaining({clientOrderId: original.clientOrderId}));
    expect(h.state.entryOrders.get(restored.id)).toMatchObject({status: 'WORKING', exchangeOrderId: 'accepted-before-deadline', decisionExecutionExpiresAt: h.start + 60_000});
  });

  it.each(['future', 'partial'] as const)('rejects a restored %s decision clock without granting a renewed window', async kind => {
    const h = await waitingHarness();
    const intent = [...h.state.entryIntents.values()][0] as any;
    if (kind === 'future') {
      intent.decisionCompletedAt = h.start + 1_000;
      intent.decisionExecutionExpiresAt = h.start + 61_000;
    } else delete intent.decisionCompletedAt;
    h.makeReachable();
    await (h.coordinator as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.find(e => e.type === 'ENTRY_EXECUTION_WAIT_TERMINATED')?.payload.reason).toBe('ENTRY_DECISION_CLOCK_INVALID');
  });

  it('retains a legacy intent original expiry without manufacturing a new clock on recovery', async () => {
    const h = await waitingHarness();
    const intent = [...h.state.entryIntents.values()][0] as any;
    delete intent.decisionCompletedAt;
    delete intent.decisionExecutionExpiresAt;
    intent.absoluteExpiresAt = h.start + 80_000;
    intent.aiAuthorizationExpiresAt = h.start + 80_000;
    h.state.entryIntents.set(intent.id, EntryIntentSchema.parse(JSON.parse(JSON.stringify(intent))));
    h.setTime(h.start + 60_001);
    h.makeReachable();
    const restarted = new EntryCoordinator(h.state, {} as never, h.ai as never, h.exchange as never, h.bus);
    await (restarted as any).resumeExecutionWaits(Date.now());
    expect(h.exchange.placeEntry, JSON.stringify(reasons(h))).toHaveBeenCalledOnce();
    const submitted = h.exchange.placeEntry.mock.calls[0][0] as any;
    expect(submitted.absoluteExpiresAt).toBe(h.start + 80_000);
    expect(submitted.decisionCompletedAt).toBeUndefined();
    expect(submitted.decisionExecutionExpiresAt).toBeUndefined();
    expect(h.state.entryIntents.get(intent.id)?.absoluteExpiresAt).toBe(h.start + 80_000);
  });

  it('keeps an existing working order when replacement expires before dispatch, then cancels at TTL review', async () => {
    const h = timedHarness();
    h.state.settings.entry.nearMarket.enabled = true;
    h.state.snapshots.get(h.packet.symbol)!.recentTradedPrices = [{price:h.state.snapshots.get(h.packet.symbol)!.quote.bid,lastSeenAt:Date.now()}];
    await h.run();
    const order = [...h.state.entryOrders.values()][0];
    expect(order.status).toBe('WORKING');
    h.setTime(h.start + 55_000);
    const market = h.state.snapshots.get(h.packet.symbol)!;
    const tick = market.quote.tickSize;
    market.quote.bid += tick * 4;
    market.quote.ask += tick * 4;
    market.quote.last = market.quote.bid;
    market.quote.mark = market.quote.bid;
    h.state.settings.entry.nearMarket.enabled = true;
    market.recentTradedPrices = [{price: market.quote.bid, lastSeenAt: Date.now()}];
    const replaceEntry = vi.fn(async () => {h.setTime(h.start + 60_000); throw new EntryExecutionExpiredBeforeDispatchError();});
    (h.exchange as any).replaceEntry = replaceEntry;
    await h.coordinator.reviewPending();
    expect(replaceEntry).toHaveBeenCalledOnce();
    expect(h.state.entryOrders.get(order.id)).toMatchObject({status: 'WORKING', price: order.price, absoluteExpiresAt: h.start + 60_000});
    expect(h.exchange.cancelEntry).not.toHaveBeenCalled();
    expect(h.events.find(e => e.type === 'ENTRY_ORDER_REPRICE_BLOCKED')?.payload).toMatchObject({reason: EXPIRED, requestSent: false, existingOrderStatus: 'WORKING'});
    await h.coordinator.reviewPending();
    expect(h.exchange.cancelEntry).toHaveBeenCalledOnce();
    expect(h.state.entryOrders.get(order.id)?.status).toBe('CANCELED');
    expect(replaceEntry).toHaveBeenCalledOnce();
  });

  it('keeps quote freshness authoritative even when the new decision clock is fresh', async () => {
    const h = timedHarness();
    const original = h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      h.state.snapshots.get(h.packet.symbol)!.quote.ts = h.start - 15_001;
      return result;
    });
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(JSON.stringify(reasons(h))).toContain('QUOTE_STALE');
    expect(h.state.entryIntents.size).toBe(0);
  });

  it('does not renew an expired pre-Primary execution lease when a fresh decision arrives', async () => {
    const h = timedHarness();
    const original = h.ai.decide.getMockImplementation()!;
    h.ai.decide.mockImplementation(async (...args: any[]) => {
      const result = await original(...args);
      h.setTime(h.start + 301_000);
      return {...result, decisionCompletedAt: Date.now()};
    });
    await h.run();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.state.entryIntents.size).toBe(0);
    expect(JSON.stringify(reasons(h))).toMatch(/EXECUTION_LEASE_EXPIRED|CANDIDATE_SET_EXPIRED/);
  });
});

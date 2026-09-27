import {describe, expect, it} from 'vitest';
import {harness} from './tradingQualityTestHarness.js';
import {projectRunExecutionOutcomes} from './runExecutionOutcome.js';

const fixtureSymbol = '4USDT';
const RUN = 'chain-run';

/** A Primary answer that passes every hard gate, so the only variable left is the chain itself. */
function armed(over: Record<string, unknown> = {}) {
  const h = harness();
  const quote = h.state.snapshots.get(fixtureSymbol)!.quote;
  (h.ai as any).decide.mockImplementation(async () => ({
    runId: RUN,
    decision: {
      ...h.supplied, decision: 'PLACE_LONG', tradeSide: 'LONG', direction: 'LONG', structureDirection: 'LONG',
      quantityUnits: 1000, idealPrice: Number(quote.bid),
      acceptablePriceRange: {min: Number(quote.bid), max: Number(quote.ask) + Number(quote.tickSize) * 10},
      horizonMinutes: 3, ...over,
    },
  }));
  return h;
}

const outcome = (events: any[], decision = 'PLACE_LONG') =>
  projectRunExecutionOutcomes(
    events.map((event) => ({type: event.type, ts: event.ts, symbol: event.symbol ?? null, payload: event.payload})),
    [{brainRunId: RUN, symbol: fixtureSymbol, decision, direction: 'LONG', decidedAt: events[0]?.ts ?? Date.now()}],
  ).get(RUN)!;

describe('V3.9.6 PLACE -> submit chain closure', () => {
  it('EC-01 (T5) a PLACE that clears every hard gate reserves, intents, orders and submits exactly once', async () => {
    const h = armed();
    await h.run();
    const types = h.events.map((event: any) => event.type);
    for (const required of ['TRADE_PLAN_PERSISTED', 'ENTRY_RESERVATION_CREATED', 'ENTRY_INTENT_CREATED', 'ENTRY_SUBMIT_ATTEMPTED', 'ENTRY_ORDER_CREATED']) {
      expect(types.filter((type: string) => type === required), `${required} must appear exactly once`).toHaveLength(1);
    }
    expect(types.indexOf('TRADE_PLAN_PERSISTED'), 'the plan is durable before capital is booked')
      .toBeLessThan(types.indexOf('ENTRY_RESERVATION_CREATED'));
    expect(types.indexOf('ENTRY_RESERVATION_CREATED')).toBeLessThan(types.indexOf('ENTRY_INTENT_CREATED'));
    expect(types.indexOf('ENTRY_INTENT_CREATED')).toBeLessThan(types.indexOf('ENTRY_ORDER_CREATED'));

    expect(h.state.entryReservations.size, 'one reservation, not one per attempt').toBe(1);
    expect(h.state.entryIntents.size).toBe(1);
    expect([...h.state.entryOrders.values()]).toHaveLength(1);
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.exchange.setLeverage).toHaveBeenCalledOnce();
    expect(h.events.some((event: any) => event.type !== 'FROZEN_CHOICE_CONVERSION_OBSERVED' && /AWAIT|APPROVAL|OBSERV/i.test(event.type)), 'no new holding state may sit between a legal plan and the wire').toBe(false);
    expect(types.filter((type: string) => type === 'FROZEN_CHOICE_CONVERSION_OBSERVED')).toHaveLength(1);

    const reservation = [...h.state.entryReservations.values()][0] as any;
    expect(reservation.status, 'the booking is still live: it became the order, it was not refunded').not.toBe('RELEASED');
    const plan = h.events.find((event: any) => event.type === 'TRADE_PLAN_PERSISTED')!.payload as any;
    const intent = h.state.entryIntents.values().next().value as any;
    expect(intent.planId).toBe(plan.planId);
    expect(intent.brainRunId).toBe(RUN);
    expect(outcome(h.events).executionState).toBe('SUBMITTED');
  });

  it('EC-02 (T6) a fact that changes between the plan and the wire stops the submit and says so', async () => {
    const h = armed();
    const snapshot = h.state.snapshots.get(fixtureSymbol)!;
    h.exchange.setLeverage.mockImplementation(async () => {
      // The quote goes stale while the order is being prepared: exactly the race JIT exists for.
      h.state.snapshots.set(fixtureSymbol, {...snapshot, quote: {...snapshot.quote, ts: Date.now() - 60_000}});
    });
    await h.run();
    expect(h.exchange.placeEntry, 'a stale fact may not be traded on').not.toHaveBeenCalled();
    const blocked = h.events.filter((event: any) => event.type === 'ENTRY_ORDER_BLOCKED');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].payload).toMatchObject({brainRunId: RUN, stage: 'JIT', intentId: expect.any(String)});
    expect(String(blocked[0].payload.reason)).toBe('JIT_BLOCKED:QUOTE_STALE');
    const plan = h.events.find((event: any) => event.type === 'TRADE_PLAN_PERSISTED')!.payload as any;
    const types = h.events.map((event: any) => event.type);
    expect(plan.planId, 'the plan was written before the booking, so the refusal has a plan to point at').toBeTruthy();
    expect(types.indexOf('TRADE_PLAN_PERSISTED')).toBeLessThan(types.indexOf('ENTRY_RESERVATION_CREATED'));
    expect([...h.state.entryReservations.values()][0].status, 'the refused booking is released, not left holding margin').toBe('RELEASED');
    const row = outcome(h.events);
    expect(row).toMatchObject({executionState: 'NOT_SUBMITTED', blockStage: 'JIT', orderId: null, submittedAt: null});
    expect(row.blockReasons[0]).toContain('JIT_BLOCKED:');
    expect(row.executionLabel).toContain('未挂单 · JIT');
    expect(row.tradePlanId).toBeTruthy();
  });

  it('EC-03 (T6) a human exit goal raised while the order is prepared stops the entry', async () => {
    const h = armed();
    h.exchange.setLeverage.mockImplementation(async () => {
      const now = Date.now();
      h.state.manualExitGoals.set('goal_1', {
        positionId: 'pos_manual', symbol: fixtureSymbol, side: 'LONG', rootKey: 'ML_manual',
        attempt: 1, createdAt: now, nextAttemptAt: now + 60_000, lastReason: 'HUMAN_TAKE_OVER',
      } as never);
    });
    await h.run();
    expect(h.exchange.placeEntry, 'a position under human management may not receive an automatic entry').not.toHaveBeenCalled();
    const blocked = h.events.filter((event: any) => event.type === 'ENTRY_ORDER_BLOCKED');
    expect(blocked[0]?.payload).toMatchObject({brainRunId: RUN, stage: 'JIT', reason: 'JIT_BLOCKED:HUMAN_EXIT_GOAL_ACTIVE'});
    expect([...h.state.entryReservations.values()][0].status).toBe('RELEASED');
    const row = outcome(h.events);
    expect(row).toMatchObject({executionState: 'NOT_SUBMITTED', blockStage: 'JIT', orderId: null});
    expect(row.executionLabel).toContain('未挂单 · JIT · JIT_BLOCKED:HUMAN_EXIT_GOAL_ACTIVE');
  });

  it('EC-04 (T5) an unknown submission is reconciled, never re-sent', async () => {
    const h = armed();
    h.exchange.placeEntry.mockImplementation(async () => { throw new Error('ETIMEDOUT'); });
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    const unknown = h.events.find((event: any) => event.type === 'ENTRY_ORDER_SUBMISSION_UNKNOWN');
    expect(unknown?.payload).toMatchObject({brainRunId: RUN, clientOrderId: expect.any(String)});
    const row = outcome(h.events);
    expect(row.executionState, 'an unknown outcome is not a refusal, and it is not a fill').not.toBe('FILLED');
    expect(h.state.entryOrders.get(`entry_${[...h.state.entryIntents.values()][0].id}`)?.status).toBe('UNKNOWN');
  });
});

it('a throwing telemetry subscriber cannot alter the real conversion/submit chain or call Primary twice',async()=>{
  const h=armed();h.bus.on('FROZEN_CHOICE_CONVERSION_OBSERVED',()=>{throw new Error('telemetry sink failure');});
  await h.run();expect(h.ai.decide).toHaveBeenCalledOnce();expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
  expect(h.state.entryReservations.size).toBe(1);expect(h.state.entryIntents.size).toBe(1);expect(h.state.entryOrders.size).toBe(1);
  const observation=h.events.find((row:any)=>row.type==='FROZEN_CHOICE_CONVERSION_OBSERVED')!.payload as any;
  expect(observation).toMatchObject({side:'LONG',selectedQuantityUnits:1000,selectedHorizonMinutes:3,conversion:'CONVERTED'});
  expect(outcome(h.events).executionState).toBe('SUBMITTED');
});

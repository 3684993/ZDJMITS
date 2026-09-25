import {describe, expect, it} from 'vitest';
import {
  ENTRY_CONVERSION_EVENT_TYPES,
  EXECUTION_LABELS,
  EXECUTION_LINEAGE_GRACE_MS,
  entryConversionWindow,
  projectRunExecutionOutcomes,
  type LineageEvent,
  type RunRow,
} from './runExecutionOutcome.js';

const T0 = 1_800_000_000_000;
const at = (offsetSeconds: number) => T0 + offsetSeconds * 1000;

const run = (over: Partial<RunRow> & {brainRunId: string}): RunRow => ({
  symbol: 'BTCUSDT',
  decision: 'PLACE_LONG',
  direction: 'LONG',
  decidedAt: T0,
  ...over,
});

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>, seconds: number, symbol = 'BTCUSDT'): LineageEvent => ({
  type, ts: at(seconds), symbol, payload: {brainRunId: 'run-a', ...payload}, id: `evt_${type}_${seq++}`,
});

/** The whole chain, in the order the coordinator writes it, so each test can cut it anywhere. */
function chain(over: {until?: 'plan' | 'risk' | 'reservation' | 'intent' | 'waiting' | 'submit' | 'partial' | 'fill'} = {}): LineageEvent[] {
  const until = over.until ?? 'fill';
  const stop = ['plan', 'risk', 'reservation', 'intent', 'waiting', 'submit', 'partial', 'fill'].indexOf(until);
  const rows: LineageEvent[] = [
    ev('ENTRY_ECONOMIC_ADMISSION_EVALUATED', {mode: 'SHADOW', passed: true}, 1),
    ev('PORTFOLIO_RISK_ADMISSION_EVALUATED', {allowed: true, allocationPlanId: 'alloc_1'}, 2),
    ev('TRADE_PLAN_PERSISTED', {planId: 'plan_1', planVersion: 1, cycleId: 'cycle_1'}, 3),
  ];
  if (stop < 2) return rows;
  rows.push(ev('ENTRY_RESERVATION_CREATED', {planId: 'plan_1', intentId: 'intent_1', reservationId: 'res_1', marginUsd: 20}, 4));
  if (stop < 3) return rows;
  rows.push(ev('ENTRY_INTENT_CREATED', {intent: {id: 'intent_1', planId: 'plan_1', reservationId: 'res_1', side: 'LONG', brainRunId: 'run-a'}, decisionChainId: 'run-a'}, 5));
  if (stop < 4) return rows;
  if (until === 'waiting') {
    rows.push(ev('ENTRY_EXECUTION_WAITING', {intentId: 'intent_1', allocationPlanId: 'plan_1', reason: 'UNREACHABLE_MAKER: OUT_OF_BAND'}, 6));
    return rows;
  }
  rows.push(ev('ENTRY_SUBMIT_ATTEMPTED', {intentId: 'intent_1', orderId: 'entry_intent_1', clientOrderId: 'ML_intent_1'}, 7));
  if (stop < 5) return rows;
  rows.push(ev('ENTRY_ORDER_CREATED', {
    intentId: 'intent_1',
    order: {id: 'entry_intent_1', intentId: 'intent_1', clientOrderId: 'ML_intent_1', exchangeOrderId: '9001', status: 'WORKING', submittedAt: at(8)},
  }, 8));
  if (stop < 6) return rows;
  if (until === 'partial') {
    rows.push(ev('ORDER_FILL_RECONCILED', {intentId: 'intent_1', orderId: 'entry_intent_1', exchangeOrderId: '9001', clientOrderId: 'ML_intent_1', status: 'PARTIALLY_FILLED', filledQuantity: 1}, 9));
    return rows;
  }
  rows.push(ev('ORDER_FILL_RECONCILED', {intentId: 'intent_1', orderId: 'entry_intent_1', exchangeOrderId: '9001', clientOrderId: 'ML_intent_1', status: 'FILLED', filledQuantity: 2}, 9));
  rows.push(ev('ENTRY_FILLED', {intentId: 'intent_1', orderId: 'entry_intent_1', exchangeOrderId: '9001', clientOrderId: 'ML_intent_1', filledQuantity: 2}, 10));
  return rows;
}

const outcomeOf = (events: LineageEvent[], runs: RunRow[], now = at(60)) =>
  projectRunExecutionOutcomes(events, runs, now).get(runs[0].brainRunId)!;

/** Re-sign a chain fixture for another run, the way a second Primary run would produce it - with its
 * own intent, reservation and order ids, because identity is what the attribution rules depend on. */
const retarget = (events: LineageEvent[], runId: string, extra: Record<string, unknown> = {}): LineageEvent[] =>
  events.map((event) => {
    const payload: Record<string, any> = {...(event.payload as Record<string, unknown>), brainRunId: runId, ...extra};
    if (payload.intent) payload.intent = {...payload.intent, id: `intent_${runId}`, reservationId: `res_${runId}`};
    if (payload.intentId != null) payload.intentId = `intent_${runId}`;
    if (payload.reservationId != null) payload.reservationId = `res_${runId}`;
    if (payload.order) payload.order = {...payload.order, id: `entry_intent_${runId}`, intentId: `intent_${runId}`};
    if (payload.orderId != null) payload.orderId = `entry_intent_${runId}`;
    return {...event, payload};
  });

describe('V3.9.6 Run -> execution outcome projection', () => {
  it('EO-01 a run that reached the exchange reads as 已成交 with the whole lineage', () => {
    const rows = chain();
    const outcome = outcomeOf(rows, [run({brainRunId: 'run-a'})]);
    expect(outcome.executionState).toBe('FILLED');
    expect(outcome.executionLabel).toBe(EXECUTION_LABELS.FILLED);
    expect(outcome).toMatchObject({
      tradePlanReady: true, tradePlanId: 'plan_1', reservationId: 'res_1', intentId: 'intent_1',
      orderId: 'entry_intent_1', clientOrderId: 'ML_intent_1', exchangeOrderId: '9001',
      submittedAt: at(8), firstFillAt: at(9), blockStage: null, blockReasons: [], portfolioRiskAllowed: true,
    });
    expect(outcome.lineageProven).toBe(true);
  });

  it('EO-02 every intermediate step has its own answer, and a resting order is never 已挂单 before submit', () => {
    const cases: Array<[NonNullable<Parameters<typeof chain>[0]['until']>, string, string]> = [
      ['plan', 'EXECUTING', EXECUTION_LABELS.EXECUTING],
      ['reservation', 'EXECUTING', EXECUTION_LABELS.EXECUTING],
      ['intent', 'EXECUTING', EXECUTION_LABELS.EXECUTING],
      ['waiting', 'WAITING_PRICE', EXECUTION_LABELS.WAITING_PRICE],
      ['submit', 'SUBMITTED', EXECUTION_LABELS.SUBMITTED],
      ['partial', 'PARTIALLY_FILLED', EXECUTION_LABELS.PARTIALLY_FILLED],
    ];
    for (const [until, state, label] of cases) {
      const outcome = outcomeOf(chain({until}), [run({brainRunId: 'run-a'})]);
      expect(outcome.executionState, `until=${until}`).toBe(state);
      expect(outcome.executionLabel, `until=${until}`).toBe(label);
    }
    const resting = outcomeOf(chain({until: 'waiting'}), [run({brainRunId: 'run-a'})]);
    expect(resting.orderId).toBe(null);
    expect(resting.submittedAt).toBe(null);
    expect(resting.intentId, 'a waiting price still carries the intent that owns the reservation').toBe('intent_1');
    const working = outcomeOf(chain({until: 'submit'}), [run({brainRunId: 'run-a'})]);
    expect(working.firstFillAt, 'a working order is not a fill').toBe(null);
  });

  it('EO-03 a refusal names the layer that wrote it, in the order the chain runs', () => {
    const refusals: Array<[LineageEvent, string]> = [
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'EIP', reason: 'EVIDENCE_INCOMPLETE_FAIL_CLOSED'}, 1), 'EVIDENCE'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'PRE_AI_TRADE_PLAN', reason: 'PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE'}, 1), 'PRE_AI'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'EXECUTION_LEASE', reason: 'MARGIN_LEASE_TAKEN'}, 1), 'EXECUTION_LEASE'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'POST_PRIMARY_EXECUTION_ENVELOPE', reason: 'AI_DIRECTION_NOT_EXECUTABLE'}, 1), 'AI_VERIFY'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'ECONOMIC_ADMISSION', reason: 'MIN_NET_PROFIT_UNMET'}, 1), 'ECONOMICS'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'TRADE_PLAN', reasons: ['PLAN_SIDE_NOT_EXECUTABLE:LONG', 'CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY']}, 1), 'TRADE_PLAN'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'RESERVATION', reason: 'POSITIONS_FULL', planId: 'plan_1', intentId: 'intent_1'}, 1), 'RESERVATION'],
      [ev('ENTRY_DECISION_BLOCKED', {stage: 'LIVE_RISK_ENVELOPE', reason: 'MAX_GROSS_EXPOSURE', planId: 'plan_1', reservationId: 'res_1'}, 1), 'JIT'],
      [ev('ENTRY_ORDER_BLOCKED', {stage: 'JIT', reason: 'JIT_BLOCKED:DATA_ERROR: QUOTE_STALE', intentId: 'intent_1', orderId: 'entry_intent_1'}, 1), 'JIT'],
      [ev('ENTRY_ORDER_BLOCKED', {stage: 'BINANCE_SUBMIT', reason: 'POST_ONLY_REJECTED', intentId: 'intent_1'}, 1), 'SUBMIT'],
      [ev('ENTRY_EXECUTION_WAIT_TERMINATED', {stage: 'ENTRY_EXECUTION_WAIT_TERMINATED', reason: 'QUOTE_STALE_WHILE_WAITING', intentId: 'intent_1'}, 1), 'EXECUTION_WAIT'],
    ];
    for (const [event, stage] of refusals) {
      const outcome = outcomeOf([event], [run({brainRunId: 'run-a'})]);
      expect(outcome.executionState, event.type).toBe('NOT_SUBMITTED');
      expect(outcome.blockStage, JSON.stringify(event.payload)).toBe(stage);
      expect(outcome.executionLabel).toContain('未挂单');
      expect(outcome.executionLabel).toContain(stage);
      expect(outcome.blockReasons.length).toBeGreaterThan(0);
    }
    const plan = outcomeOf([
      ev('TRADE_PLAN_PERSISTED', {planId: 'plan_1'}, 1),
      ev('ENTRY_DECISION_BLOCKED', {stage: 'RESERVATION', reason: 'MAX_CONCURRENT_RESERVATIONS', planId: 'plan_1'}, 2),
    ], [run({brainRunId: 'run-a'})]);
    expect(plan).toMatchObject({executionState: 'NOT_SUBMITTED', blockStage: 'RESERVATION', tradePlanReady: true, tradePlanId: 'plan_1'});
  });

  it('EO-04 a risk refusal is a block, a risk pass is only a fact about the layer', () => {
    expect(outcomeOf(chain({until: 'plan'}), [run({brainRunId: 'run-a'})]).portfolioRiskAllowed).toBe(true);
    const denied = outcomeOf([
      ev('PORTFOLIO_RISK_ADMISSION_EVALUATED', {allowed: false, reasons: ['MAX_DIRECTION_EXPOSURE']}, 1),
    ], [run({brainRunId: 'run-a'})]);
    expect(denied).toMatchObject({executionState: 'NOT_SUBMITTED', blockStage: 'PORTFOLIO_RISK', portfolioRiskAllowed: false});
    expect(denied.blockReasons).toContain('MAX_DIRECTION_EXPOSURE');
  });

  it('EO-05 (T7) two runs on one symbol never share an order, an intent or a fill', () => {
    const events: LineageEvent[] = [
      ev('TRADE_PLAN_PERSISTED', {planId: 'plan_1'}, 1, 'ETHUSDT'),
      ev('ENTRY_RESERVATION_CREATED', {planId: 'plan_1', intentId: 'intent_1', reservationId: 'res_1'}, 2, 'ETHUSDT'),
      ev('ENTRY_INTENT_CREATED', {intent: {id: 'intent_1', planId: 'plan_1', reservationId: 'res_1', side: 'LONG', brainRunId: 'run-a'}, decisionChainId: 'run-a'}, 3, 'ETHUSDT'),
      ev('ENTRY_ORDER_CREATED', {order: {id: 'entry_intent_1', intentId: 'intent_1', clientOrderId: 'ML_intent_1', exchangeOrderId: '9001', status: 'WORKING', submittedAt: at(4)}}, 4, 'ETHUSDT'),
      ev('ENTRY_FILLED', {intentId: 'intent_1', orderId: 'entry_intent_1', exchangeOrderId: '9001', filledQuantity: 2}, 5, 'ETHUSDT'),
      // The second run is still deciding: it has no intent of its own yet.
      ev('PORTFOLIO_RISK_ADMISSION_EVALUATED', {allowed: true}, 6, 'ETHUSDT'),
    ];
    events.forEach((event) => { if ((event.payload as any).brainRunId === 'run-a' && Number(event.ts) > at(5)) (event.payload as any).brainRunId = 'run-b'; });
    const outcomes = projectRunExecutionOutcomes(events, [
      run({brainRunId: 'run-a', symbol: 'ETHUSDT'}),
      run({brainRunId: 'run-b', symbol: 'ETHUSDT', decidedAt: at(6)}),
    ], at(60));
    const first = outcomes.get('run-a')!, second = outcomes.get('run-b')!;
    expect(first).toMatchObject({executionState: 'FILLED', intentId: 'intent_1', orderId: 'entry_intent_1', exchangeOrderId: '9001', firstFillAt: at(5)});
    expect(second).toMatchObject({executionState: 'EXECUTING', intentId: null, orderId: null, exchangeOrderId: null, firstFillAt: null});
    expect(second.tradePlanId, 'the new run must not inherit the old plan id').toBe(null);
  });

  it('EO-06 (T7) a fill that claims the wrong run is reported, not attached to whoever is nearby', () => {
    const events = chain();
    events.push({id: 'evt_leak', type: 'ENTRY_FILLED', ts: at(11), symbol: 'BTCUSDT', payload: {brainRunId: 'run-b', intentId: 'intent_1', orderId: 'entry_intent_1'}});
    const outcomes = projectRunExecutionOutcomes(events, [
      run({brainRunId: 'run-a'}),
      run({brainRunId: 'run-b', decidedAt: at(11)}),
    ], at(60));
    expect(outcomes.get('run-b')!.executionState, 'a run that never created an order cannot be credited with a fill').not.toBe('FILLED');
    expect(outcomes.get('run-b')!.orderId).toBe(null);
    expect(outcomes.get('run-a')!.executionState).toBe('FILLED');
    const reported = [...outcomes.values()].flatMap(row => row.inconsistentFacts);
    expect(reported.join('|')).toContain('ENTRY_FILLED');
  });

  it('EO-07 the model declining to enter is a decision, not an execution failure', () => {
    for (const decision of ['REJECT_CANDIDATE', 'WAIT', 'WAIT_FOR_PRICE']) {
      const outcome = outcomeOf([
        ev('CANDIDATE_REJECTED', {reason: 'NO_EDGE_AT_CURRENT_PRICE', decision}, 1),
      ], [run({brainRunId: 'run-a', decision})]);
      expect(outcome.executionState, decision).toBe('DECISION_ONLY');
      expect(outcome.executionLabel, decision).toBe(EXECUTION_LABELS.DECISION_ONLY);
      expect(outcome.blockStage, decision).toBe(null);
      expect(outcome.blockReasons, decision).toEqual([]);
    }
  });

  it('EO-08 absence becomes a statement only after the deterministic layers had time to speak', () => {
    const silent = [run({brainRunId: 'run-a'})];
    expect(outcomeOf([], silent, T0 + 60_000).executionState).toBe('EXECUTING');
    const late = outcomeOf([], silent, T0 + EXECUTION_LINEAGE_GRACE_MS + 60_000);
    expect(late.executionState).toBe('NOT_SUBMITTED');
    expect(late.blockStage).toBe(null);
    expect(late.blockReasons).toEqual(['EXECUTION_LINEAGE_UNPROVEN']);
    expect(late.executionLabel).toContain('链路未记录');
    expect(late.lineageProven).toBe(false);
  });

  it('EO-09a a symptom headline never hides the cause the layer computed', () => {
    const outcome = outcomeOf([
      ev('ENTRY_DECISION_BLOCKED', {stage: 'TRADE_PLAN', reasons: ['PLAN_SIDE_NOT_EXECUTABLE:SHORT', 'CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY']}, 1),
    ], [run({brainRunId: 'run-a', decision: 'PLACE_SHORT', direction: 'SHORT'})]);
    expect(outcome.blockReasons).toEqual([
      'CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY',
      'PLAN_SIDE_NOT_EXECUTABLE:SHORT',
    ]);
    expect(outcome.executionLabel).toBe('未挂单 · TRADE_PLAN · CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
    const window = entryConversionWindow([
      ev('ENTRY_DECISION_BLOCKED', {stage: 'TRADE_PLAN', reasons: ['PLAN_SIDE_NOT_EXECUTABLE:SHORT', 'CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY']}, 1),
    ], {since: T0, until: at(60)});
    expect(window.topDropReason).toBe('CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY');
  });

  it('EO-09 a duplicate event for one run counts once, because two plans would be a defect', () => {
    const events = [...chain({until: 'plan'}), ...chain({until: 'plan'}), ...chain({until: 'plan'})];
    const window = entryConversionWindow(events, {since: T0, until: at(60)});
    expect(window).toMatchObject({place: 0, tradePlanReady: 1, riskAllowed: 1, economicAdmissionPassed: 1});
  });
});

describe('V3.9.6 entry conversion funnel', () => {
  const primary = (runId: string, decision: string, seconds: number, symbol = 'BTCUSDT'): LineageEvent => ({
    id: `evt_p_${runId}`, type: 'PRIMARY_DECISION_NORMALIZED', ts: at(seconds), symbol,
    payload: {runId, normalizedDecision: decision},
  });

  it('EO-10 (T8) counts each stage from the event that creates it, not from the last status', () => {
    const events: LineageEvent[] = [
      primary('r1', 'PLACE_LONG', 1), primary('r2', 'PLACE_SHORT', 2), primary('r3', 'PLACE_LONG', 3),
      primary('r4', 'PLACE_SHORT', 4), primary('r5', 'PLACE_LONG', 5), primary('r6', 'PLACE_LONG', 6),
      primary('r7', 'REJECT_CANDIDATE', 7), primary('r8', 'WAIT', 8),
      // r1: all the way to a fill.
      ...retarget(chain(), 'r1'),
      // r2: submitted, resting.
      ...retarget(chain({until: 'submit'}), 'r2', {intentId: 'intent_2', orderId: 'entry_intent_2'}),
      // r3: waiting for price.
      ...retarget(chain({until: 'waiting'}), 'r3'),
      // r4: refused at the trade plan.
      {...primary('r4', 'PLACE_SHORT', 9), type: 'ENTRY_DECISION_BLOCKED', payload: {brainRunId: 'r4', stage: 'TRADE_PLAN', reasons: ['PLAN_SIDE_NOT_EXECUTABLE:SHORT', 'CANDIDATE_SET_MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY']}},
      // r5, r6: refused by the risk authority.
      {id: 'b5', type: 'ENTRY_DECISION_BLOCKED', ts: at(10), symbol: 'BTCUSDT', payload: {brainRunId: 'r5', stage: 'PORTFOLIO_RISK_ADMISSION', reason: 'MAX_GROSS_EXPOSURE', reasons: ['MAX_GROSS_EXPOSURE']}},
      {id: 'b6', type: 'ENTRY_DECISION_BLOCKED', ts: at(11), symbol: 'BTCUSDT', payload: {brainRunId: 'r6', stage: 'PORTFOLIO_RISK_ADMISSION', reason: 'MAX_GROSS_EXPOSURE', reasons: ['MAX_GROSS_EXPOSURE']}},
    ];
    const window = entryConversionWindow(events, {since: T0, until: at(60)});
    expect(window).toMatchObject({
      primaryCompleted: 8,
      place: 6,
      riskAllowed: 3,
      economicAdmissionPassed: 3,
      tradePlanReady: 3,
      reservationCreated: 3,
      intentCreated: 3,
      submitAttempted: 2,
      orderSubmitted: 2,
      entryFilled: 1,
      waitingPrice: 1,
    });
    expect(window.ratios).toEqual({
      placeToTradePlan: Number(((3 / 6) * 100).toFixed(1)),
      tradePlanToSubmit: Number(((2 / 3) * 100).toFixed(1)),
      placeToSubmit: Number(((2 / 6) * 100).toFixed(1)),
      submitToFill: Number(((1 / 2) * 100).toFixed(1)),
    });
    expect(window.topDropStage).toBe('PORTFOLIO_RISK');
    expect(window.topDropReason).toBe('MAX_GROSS_EXPOSURE');
    expect(window.topDropCount).toBe(2);
    expect(window.degraded, 'capital and the profit floor are intended gates, so they do not alert').toBe(false);
    expect(window.degradedReason).toBe(null);
  });

  it('EO-11 ENTRY_CONVERSION_DEGRADED fires when a non-capital blocker eats every PLACE', () => {
    const events: LineageEvent[] = [];
    for (let index = 0; index < 6; index++) {
      const runId = `d${index}`;
      events.push(primary(runId, 'PLACE_LONG', index));
      events.push({id: `x${index}`, type: 'ENTRY_DECISION_BLOCKED', ts: at(index + 10), symbol: 'BTCUSDT',
        payload: {brainRunId: runId, stage: 'TRADE_PLAN', reason: 'PLAN_SIDE_NOT_EXECUTABLE:LONG', reasons: ['PLAN_SIDE_NOT_EXECUTABLE:LONG']}});
    }
    const window = entryConversionWindow(events, {since: T0, until: at(60)});
    expect(window.place).toBe(6);
    expect(window.orderSubmitted).toBe(0);
    expect(window.degraded).toBe(true);
    expect(window.degradedReason).toBe('ENTRY_CONVERSION_DEGRADED:TRADE_PLAN:PLAN_SIDE_NOT_EXECUTABLE:LONG');
    expect(window.topDropCount).toBe(6);
  });

  it('EO-12 the alert stays silent while money or the frozen floor is the honest answer', () => {
    const cases: Array<[string, string]> = [
      ['MAX_FREE_MARGIN', 'ECONOMIC_ADMISSION'],
      ['MIN_PROFIT_FLOOR_UNMET_AT_MINIMUM_QUANTITY', 'TRADE_PLAN'],
      ['POSITION_CAPACITY_FULL', 'RESERVATION'],
    ];
    for (const [reason, stage] of cases) {
      const events: LineageEvent[] = [];
      for (let index = 0; index < 6; index++) {
        const runId = `g${index}`;
        events.push(primary(runId, 'PLACE_LONG', index));
        events.push({id: `g${index}`, type: 'ENTRY_DECISION_BLOCKED', ts: at(index + 20), symbol: 'BTCUSDT', payload: {brainRunId: runId, stage, reason}});
      }
      const window = entryConversionWindow(events, {since: T0, until: at(90)});
      expect(window.topDropReason, reason).toBe(reason);
      expect(window.degraded, `${reason} is an intended gate`).toBe(false);
    }
  });

  it('EO-13 an empty window reports nothing rather than a division by zero', () => {
    const window = entryConversionWindow([], {since: T0, until: at(60)});
    expect(window.primaryCompleted).toBe(0);
    expect(window.ratios).toEqual({placeToTradePlan: null, tradePlanToSubmit: null, placeToSubmit: null, submitToFill: null});
    expect(window.blocked).toEqual([]);
    expect(window.degraded).toBe(false);
  });

  it('EO-14 the funnel reads exactly the event types the projection is built from', () => {
    const produced = new Set(chain().map((event) => event.type));
    for (const type of produced) expect(ENTRY_CONVERSION_EVENT_TYPES, `chain event ${type} must be readable by the funnel`).toContain(type);
  });

  it('EO-15 a fill written without a run id still counts for the run that created the order', () => {
    // The simulated-fill path publishes ENTRY_FILLED with only the order object, so a funnel that
    // reads run ids off the payload alone reports "0 filled" while the cockpit's own row says 已成交.
    const events: LineageEvent[] = [
      primary('r9', 'PLACE_LONG', 1),
      ...retarget(chain({until: 'intent'}), 'r9'),
      ev('ENTRY_ORDER_CREATED', {brainRunId: 'r9', order: {id: 'entry_intent_1', intentId: 'intent_1', clientOrderId: 'ML_intent_1', exchangeOrderId: '9001', status: 'WORKING', submittedAt: at(8)}}, 8),
      {id: 'evt_fill_no_run', type: 'ENTRY_FILLED', ts: at(9), symbol: 'BTCUSDT', payload: {order: {id: 'entry_intent_1', intentId: 'intent_1', exchangeOrderId: '9001', status: 'FILLED', filledQuantity: 2}, positionId: 'pos_entry_intent_1'}},
    ];
    const window = entryConversionWindow(events, {since: T0, until: at(60)});
    expect(window.orderSubmitted).toBe(1);
    expect(window.entryFilled, 'the fill must be attributed to the run that owns the intent').toBe(1);
    expect(window.ratios.submitToFill).toBe(100);
    const outcome = outcomeOf(events, [run({brainRunId: 'r9'})]);
    expect(outcome).toMatchObject({executionState: 'FILLED', exchangeOrderId: '9001'});
  });
});

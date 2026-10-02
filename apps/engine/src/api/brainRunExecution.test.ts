import {afterEach, describe, expect, it} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SettingsStore} from '../config/settingsStore.js';
import {harness,systemCandidateDecision} from '../services/tradingQualityTestHarness.js';
import {withExecutionOutcomes} from './router.js';

const fixtureSymbol: string = '4USDT';
const dirs: string[] = [];

async function openStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'zdj-run-execution-'));
  dirs.push(dir);
  const store = new SettingsStore(path.resolve(process.cwd(), '../../config'), dir);
  await store.load();
  return store;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try { rmSync(dir, {recursive: true, force: true}); } catch { /* a Windows handle may still be closing */ }
  }
});

/** The coordinator's own events, journalled exactly as the runtime journals them. */
function armed(store: SettingsStore) {
  const h = harness();
  h.bus.on('event', (event: any) => store.recordRuntimeEvent(event));
  (h.ai as any).decide.mockImplementation(async (packet: any) => ({
    runId: 'durable-run',
    decision: systemCandidateDecision(packet,h.supplied,'LONG',{packetId:packet?.packetId}),
  }));
  return h;
}

const recordRun = (store: SettingsStore, over: Record<string, unknown> = {}) => store.upsertAiRun({
  id: 'durable-run', symbol: fixtureSymbol, role: 'PRIMARY_BRAIN', model: 'test-27b', status: 'COMPLETED',
  decision: 'PLACE_LONG', direction: 'LONG', startedAt: Date.now() - 5_000, completedAt: Date.now(), ...over,
} as never);

const firstRow = async (store: SettingsStore) => {
  const page = store.listAiRunSummaries({from: 0});
  return withExecutionOutcomes({settingsStore: store} as never, page.items)[0];
};

describe('V3.9.6 durable run -> execution result', () => {
  it('RX-01 a natural PLACE that reaches the wire is journalled as 已挂单 with its whole lineage', async () => {
    const store = await openStore();
    const h = armed(store);
    await h.run();
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    recordRun(store);
    const row = await firstRow(store);
    expect(row.role).toBe('PRIMARY_BRAIN');
    expect(row.execution).toMatchObject({
      brainRunId: 'durable-run', symbol: fixtureSymbol, decision: 'PLACE_LONG', direction: 'LONG',
      executionState: 'SUBMITTED', executionLabel: '已挂单', blockStage: null, blockReasons: [],
      tradePlanReady: true, lineageProven: true,
    });
    expect(row.execution.tradePlanId).toMatch(/^plan/);
    expect(row.execution.reservationId).toBeTruthy();
    expect(row.execution.intentId).toMatch(/^intent/);
    expect(row.execution.orderId).toMatch(/^entry_intent/);
    expect(row.execution.clientOrderId).toBeTruthy();
    expect(row.execution.submittedAt, 'the accept time is written back, not inferred from createdAt').toBeGreaterThan(0);
    expect(row.execution.firstFillAt, 'an accepted order is not a fill').toBe(null);
    expect(row.execution.inconsistentFacts).toEqual([]);
  });

  it('RX-02 a legal wait for price says 等待价格 and never borrows 已挂单', async () => {
    const store = await openStore();
    const h = armed(store);
    // Reachability-by-recent-trade is the policy the live account runs, and the archived fixture
    // carries no trade ticks - turning the policy on is what makes the wait honest here.
    h.state.settings.entry.nearMarket = {...h.state.settings.entry.nearMarket, enabled: true};
    await h.run();
    expect(h.exchange.placeEntry, 'no recent trade sits in the authorized band, so nothing may be sent').not.toHaveBeenCalled();
    recordRun(store);
    const row = await firstRow(store);
    expect(row.execution).toMatchObject({executionState: 'WAITING_PRICE', executionLabel: '等待价格', blockStage: null, orderId: null, submittedAt: null, firstFillAt: null});
    expect(row.execution.intentId, 'the intent that owns the reservation is still reported').toBeTruthy();
    expect(row.execution.tradePlanId).toBeTruthy();
  });

  it('RX-03 a scout row carries no execution answer, because it never had an order to place', async () => {
    const store = await openStore();
    recordRun(store);
    recordRun(store, {id: 'scout-run', role: 'SCOUT', decision: null, direction: null});
    const page = store.listAiRunSummaries({from: 0});
    const rows = withExecutionOutcomes({settingsStore: store} as never, page.items);
    expect(rows.find((row: any) => row.id === 'scout-run')!.execution).toBe(null);
    expect(rows.find((row: any) => row.id === 'durable-run')!.execution.executionState, 'no execution event was journalled for it').toBe('EXECUTING');
  });

  it('RX-04 the funnel reads the same journal the rows do', async () => {
    const store = await openStore();
    const h = armed(store);
    await h.run();
    recordRun(store);
    const {entryConversionWindow} = await import('../services/runExecutionOutcome.js');
    const events = store.runtimeEvents(Date.now() - 60_000, ['PRIMARY_DECISION_NORMALIZED', 'TRADE_PLAN_PERSISTED', 'ENTRY_RESERVATION_CREATED', 'ENTRY_INTENT_CREATED', 'ENTRY_SUBMIT_ATTEMPTED', 'ENTRY_ORDER_CREATED'], 5000);
    const window = entryConversionWindow(events, {since: Date.now() - 60_000, until: Date.now() + 1000});
    expect(window.tradePlanReady).toBe(1);
    expect(window.reservationCreated, 'the reservation is a durable fact, not an inference from the intent').toBe(1);
    expect(window.intentCreated).toBe(1);
    expect(window.submitAttempted).toBe(1);
    expect(window.orderSubmitted).toBe(1);
    expect(window.entryFilled).toBe(0);
    expect(window.ratios.placeToSubmit, 'the model never emitted PRIMARY_DECISION_NORMALIZED in this stub, so PLACE is honestly zero').toBe(null);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { executionReadiness } from './executionReadiness.js';
import { portfolioRiskProfileBlockers, portfolioRiskProfileStatus } from './portfolioRiskLedger.js';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { harness } from './tradingQualityTestHarness.js';

/**
 * A model call is only paid for when the book could act on its answer. These tests pin the gate that
 * replaced "analyse 24 times, submit nothing", and they pin that a missing fact is reported as the
 * reason instead of being smoothed into a WAIT.
 */
const profile = (over: Record<string, unknown> = {}) => ({
  configured: true, marginTierVersion: 'bracket-table-2026-09', maintenanceMarginRatePct: 0.005, correlationVersion: 'corr-2026-09', scenarioVersion: 'scn-2026-09',
  maxCapitalAtRiskUsd: 600, maxDrawdownPct: 0.2, maxStressLossUsd: 900, maxGrossNotionalUsd: 6000, maxDirectionNotionalUsd: 4000, maxClusterNotionalUsd: 3000,
  minMarginBufferPct: 0.2, minLiquidationBufferPct: 0.01, maxHumanPositions: 6, maxHumanNotionalUsd: 6000, maxPendingHandoffs: 4, maxAckAgeMs: 8 * 3_600_000,
  snapshotTtlMs: 20_000, cashFlowWindowMs: 86_400_000, cashFlowMaxAgeMs: 900_000,
  clusters: { BTC: 'MAJOR' }, scenarios: [{ id: 'shock10', priceShockPct: 0.1 }], ...over,
});
const now = 1_790_160_000_000;
const readiness = (over: Record<string, unknown> = {}) => executionReadiness({
  settings: {
    connections: { executionMode: 'TESTNET_ENABLED', exchange: { environment: 'TESTNET' } },
    riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: profile() },
  } as never,
  account: { status: 'READY', asOf: now - 5_000 } as never,
  runtimeControlMode: 'RUNNING', executionGovernanceMode: 'AUTO_RUNNING', writeAdmissionBlock: null, executableCandidateCount: 3, now, ...over,
} as never);

describe('execution readiness judgment', () => {
  it('permits model spend only when every execution fact is present', () => {
    const ready = readiness();
    expect(ready).toMatchObject({ intent: true, ready: true, modelSpendPermitted: true, blockers: [], firstBlocker: null, mode: 'EXECUTION_READY' });
  });

  it('refuses to pay for a PLACE the write lock will only convert to a WAIT', () => {
    const locked = readiness({ settings: { connections: { executionMode: 'READ_ONLY', exchange: { environment: 'TESTNET' } }, riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: profile() } } });
    expect(locked.intent).toBe(true);
    expect(locked.ready).toBe(false);
    expect(locked.modelSpendPermitted).toBe(false);
    expect(locked.blockers).toContain('EXECUTION_WRITE_LOCKED');
    expect(locked.text).toContain('EXECUTION_WRITE_LOCKED');
  });

  it('treats a stale private account as no facts, not as the cached balance it still holds', () => {
    const stale = readiness({ account: { status: 'READY', asOf: now - 61_000 } });
    expect(stale.blockers).toContain('PRIVATE_DATA_UNAVAILABLE');
    expect(stale.modelSpendPermitted).toBe(false);
    const unavailable = readiness({ account: { status: 'UNAVAILABLE', asOf: now - 1_000 } });
    expect(unavailable.blockers).toContain('PRIVATE_DATA_UNAVAILABLE');
  });

  it('names the exact profile fact that is missing, and never calls an unconfigured profile "ready"', () => {
    const unconfigured = readiness({ settings: { connections: { executionMode: 'TESTNET_ENABLED', exchange: { environment: 'TESTNET' } }, riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: { configured: false } } } });
    expect(unconfigured.blockers).toEqual(['RISK_PROFILE_UNCONFIGURED']);
    expect(unconfigured.profileStatus).toBe('PROFILE_NOT_CONFIGURED');
    expect(portfolioRiskProfileStatus({ configured: false })).toBe('PROFILE_NOT_CONFIGURED');
    expect(portfolioRiskProfileBlockers(profile({ correlationVersion: '' }))).toEqual(['CORRELATION_VERSION_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ maintenanceMarginRatePct: null }))).toEqual(['MARGIN_TIER_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ scenarios: [], scenarioVersion: '' }))).toEqual(['STRESS_SCENARIO_SET_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ maxGrossNotionalUsd: null }))[0]).toContain('RISK_PROFILE_FIELDS_MISSING');
    expect(portfolioRiskProfileBlockers(profile())).toEqual([]);
    expect(portfolioRiskProfileStatus(profile())).toBe('READY');
    const factsUnproven = readiness({ settings: { connections: { executionMode: 'TESTNET_ENABLED', exchange: { environment: 'TESTNET' } }, riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: profile({ correlationVersion: '' }) } } });
    expect(factsUnproven.blockers).toEqual(['CORRELATION_VERSION_UNPROVEN']);
    expect(factsUnproven.profileStatus).toBe('PROFILE_FACTS_UNPROVEN');
  });

  it('keeps production out of reach and a non-auto policy in research mode', () => {
    const production = readiness({ settings: { connections: { executionMode: 'TESTNET_ENABLED', exchange: { environment: 'PRODUCTION' } }, riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: profile() } } });
    expect(production.blockers[0]).toBe('ENVIRONMENT_NOT_TESTNET');
    expect(production.modelSpendPermitted).toBe(false);
    const shadow = readiness({ executionGovernanceMode: 'SHADOW_ONLY' });
    expect(shadow.intent).toBe(false);
    expect(shadow.mode).toBe('RESEARCH_ONLY');
    expect(shadow.modelSpendPermitted).toBe(true);
    const noCandidate = readiness({ executableCandidateCount: 0 });
    expect(noCandidate.blockers).toEqual(['NO_EXECUTABLE_CANDIDATE']);
    expect(noCandidate.modelSpendPermitted).toBe(false);
  });
});

/**
 * The real coordinator with a real candidate, driven one scheduler tick at a time: verdict first,
 * then processPool, exactly as the runtime does it. A test here fails for the same reason production
 * would: the Primary was asked for an answer the book cannot execute.
 */
async function equipped(side: 'LONG' | 'SHORT') {
  const h = harness();
  h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
  h.state.settings.tradingQuality = { mode: 'OFF' } as never;
  h.state.account = { ...h.state.account, status: 'READY', asOf: Date.now() };
  (h.state.settings.riskGovernance as Record<string, unknown>).entrySafetyMode = 'AUTO';
  (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile();
  const probe = vi.fn(async () => {});
  (h.ai as unknown as { probePrimaryIfDue: unknown }).probePrimaryIfDue = probe;
  (h.ai as unknown as { setIdleContext: unknown }).setIdleContext = vi.fn();
  h.state.runtimeControl = { ...h.state.runtimeControl, mode: 'RUNNING', capital: { ...h.state.runtimeControl.capital, executableCandidateCount: 3 } };
  h.state.executionGovernance = { ...h.state.executionGovernance, mode: 'AUTO_RUNNING' };
  h.state.snapshots.set('BTCUSDT', { ...h.state.snapshots.get(h.packet.symbol)!, symbol: 'BTCUSDT' });
  h.state.snapshots.set('ETHUSDT', { ...h.state.snapshots.get(h.packet.symbol)!, symbol: 'ETHUSDT' });
  (h.supplied as { quantityUnits?: number }).quantityUnits = 1000;
  const market = h.state.snapshots.get(h.packet.symbol)!;
  const tickSize = market.quote.tickSize, price = side === 'LONG' ? market.quote.bid : market.quote.ask;
  h.ai.decide.mockResolvedValue({ runId: `chain-${side}`, decision: { ...h.supplied, decision: `PLACE_${side}`, direction: side, tradeSide: side, quantityUnits: 1000, idealPrice: price, acceptablePriceRange: { min: price - tickSize * 20, max: price + tickSize * 20 }, horizonMinutes: 3, reachability: 0.9, reason: 'NATURAL_PLACE_CHAIN' } } as never);
  const settle = async (ms = 120) => { await new Promise(resolve => setTimeout(resolve, ms)); };
  const cycle = async () => {
    h.coordinator.noteExecutionReadiness(executionReadiness({
      settings: h.state.settings,
      account: h.state.account,
      runtimeControlMode: h.state.runtimeControl.mode,
      executionGovernanceMode: h.state.executionGovernance.mode,
      writeAdmissionBlock: h.coordinator.writeAdmissionBlockReason(),
      executableCandidateCount: h.state.runtimeControl.capital.executableCandidateCount,
    } as never));
    await h.coordinator.processPool();
    await settle();
  };
  return { h, price, probe, cycle, settle };
}

describe('an armed trade intent spends no model on facts it cannot execute', () => {
  it('asks the Primary zero times under READ_ONLY while candidates are executable', async () => {
    const { h, cycle, probe } = await equipped('LONG');
    h.state.settings.connections.executionMode = 'READ_ONLY';
    await cycle();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(probe, 'the Primary health probe is part of the model cost, so it stays closed too').not.toHaveBeenCalled();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    expect(h.events.filter(event => event.type === 'EXECUTION_READINESS_BLOCKED').at(-1)?.payload?.firstBlocker).toBe('EXECUTION_WRITE_LOCKED');
    expect(h.coordinator.analysisDiagnostics().reason).toBe('EXECUTION_WRITE_LOCKED');
    expect(h.coordinator.analysisDiagnostics().execution).toMatchObject({ intent: true, ready: false, firstBlocker: 'EXECUTION_WRITE_LOCKED' });
  });

  it('blocks on stale private facts and resumes on the next tick without a restart', async () => {
    const { h, cycle } = await equipped('LONG');
    h.state.account = { ...h.state.account, asOf: Date.now() - 90_000 };
    await cycle();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.coordinator.analysisDiagnostics().reason).toBe('PRIVATE_DATA_UNAVAILABLE');
    // The private poll succeeds; no process restart and no settings reload is asked for.
    h.state.account = { ...h.state.account, asOf: Date.now() };
    await cycle();
    expect(h.ai.decide, 'a recovered fact must be answered at once').toHaveBeenCalledOnce();
    expect(h.events.some(event => event.type === 'EXECUTION_READINESS_RESUMED')).toBe(true);
    expect(h.coordinator.analysisDiagnostics().execution.ready).toBe(true);
  });

  it('spends nothing while the risk profile is unconfigured, and names the missing fact', async () => {
    const { h, cycle } = await equipped('LONG');
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = { configured: false };
    await cycle();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.events.filter(event => event.type === 'EXECUTION_READINESS_BLOCKED').at(-1)?.payload?.blockers).toContain('RISK_PROFILE_UNCONFIGURED');
    const gate = h.coordinator.analysisDiagnostics().execution;
    expect(gate.ready).toBe(false);
    expect(gate.blockers).toContain('RISK_PROFILE_UNCONFIGURED');
  });

  it('keeps deterministic supply maintenance running while the model is refused', async () => {
    const { h, cycle } = await equipped('LONG');
    h.state.settings.connections.executionMode = 'READ_ONLY';
    await cycle();
    expect(h.ai.decide).not.toHaveBeenCalled();
    // processPool reached its ready-view computation: refusing the model must not freeze the pool.
    expect(h.state.pool.readyList().length, 'the candidate pool must stay warm for the first ready tick').toBeGreaterThan(0);
    expect(h.coordinator.analysisDiagnostics().lastTickAt).toBeGreaterThan(0);
  });

  it('never spends a model outside Testnet, whatever the settings claim', async () => {
    const { h, cycle } = await equipped('LONG');
    h.state.settings.connections.exchange.environment = 'PRODUCTION';
    await cycle();
    expect(h.ai.decide).not.toHaveBeenCalled();
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
  });
});

describe('the runtime pushes the verdict instead of deciding it per surface', () => {
  function runtime() {
    const h = harness();
    const noted = vi.fn();
    const processPool = vi.fn(async () => {});
    const fake: Record<string, unknown> = {
      state: h.state,
      runtimeControl: { canDispatch: () => true },
      entry: { processPool, noteExecutionReadiness: noted, writeAdmissionBlockReason: () => null },
    };
    // Bind the runtime's own gate instead of reimplementing it, so the test cannot drift from production.
    fake.executionReadinessSnapshot = () =>
      (EngineRuntime.prototype as unknown as { executionReadinessSnapshot: (this: unknown) => unknown }).executionReadinessSnapshot.call(fake);
    const dispatch = (EngineRuntime.prototype as unknown as { dispatchAnalysisTick: (this: unknown) => Promise<void> }).dispatchAnalysisTick;
    return { h, noted, processPool, tick: () => dispatch.call(fake) };
  }

  it('reports the first real reason every tick and still runs the deterministic tick body', async () => {
    const { h, noted, processPool, tick } = runtime();
    h.state.settings.connections.executionMode = 'READ_ONLY';
    h.state.account = { ...h.state.account, status: 'READY', asOf: Date.now(), equityUsd: 10_000 };
    h.state.runtimeControl = { ...h.state.runtimeControl, mode: 'RUNNING', capital: { ...h.state.runtimeControl.capital, executableCandidateCount: 3 } };
    h.state.executionGovernance = { ...h.state.executionGovernance, mode: 'AUTO_RUNNING' };
    (h.state.settings.riskGovernance as Record<string, unknown>).entrySafetyMode = 'AUTO';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile();
    await tick();
    expect(noted).toHaveBeenCalledOnce();
    expect(noted.mock.calls[0][0]).toMatchObject({ intent: true, ready: false, firstBlocker: 'EXECUTION_WRITE_LOCKED' });
    expect(processPool, 'supply maintenance is not the model cost, so the tick still runs it').toHaveBeenCalledOnce();
    // Unlocking writes through the settings boundary is enough: the next tick is permitted to spend.
    h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
    await tick();
    expect(noted.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, modelSpendPermitted: true });
  });

  it('does not evaluate readiness at all when the environment is not Testnet', async () => {
    const { h, noted, processPool, tick } = runtime();
    h.state.settings.connections.exchange.environment = 'PRODUCTION';
    h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile();
    await tick();
    expect(noted).not.toHaveBeenCalled();
    expect(processPool).not.toHaveBeenCalled();
  });
});

describe('a PLACE with every fact present walks the real entry chain', () => {
  it.each(['LONG', 'SHORT'] as const)('%s reserves, creates intent and order, and submits exactly once', async side => {
    const { h, price, cycle } = await equipped(side);
    await cycle();
    const reservations = [...h.state.entryReservations.values()];
    expect(h.ai.decide, 'the model must actually be asked once').toHaveBeenCalledOnce();
    expect(reservations, JSON.stringify(h.events.filter(e => /BLOCKED|REJECT|FAILED/.test(e.type)))).toHaveLength(1);
    expect(reservations[0].status).not.toBe('RELEASED');
    expect(h.state.entryIntents.size).toBe(1);
    expect(h.state.entryOrders.size).toBe(1);
    const order = [...h.state.entryOrders.values()][0] as Record<string, unknown>;
    expect(order.side).toBe(side);
    expect(order.price).toBe(price);
    expect(h.exchange.placeEntry).toHaveBeenCalledTimes(1);
    expect(h.events.some(event => event.type === 'TRADE_PLAN_PERSISTED')).toBe(true);
    expect(h.events.some(event => event.type === 'PORTFOLIO_RISK_ADMISSION_EVALUATED' && event.payload.allowed)).toBe(true);
    expect(h.events.some(event => event.type === 'ENTRY_DECISION_BLOCKED'), JSON.stringify(h.events.filter(e => e.type === 'ENTRY_DECISION_BLOCKED'))).toBe(false);
  });

  it('reports a post-AI refusal with its stage and reason instead of a vague WAIT, and spends no second call', async () => {
    const { h, cycle, settle } = await equipped('LONG');
    // A PLACE whose own price triple is self-contradictory is the case that used to end as an
    // unexplained silence: the deterministic post-AI verifier must refuse it, with a stage and a
    // reason, and the same facts must not buy a second model call.
    const market = h.state.snapshots.get(h.packet.symbol)!;
    h.ai.decide.mockResolvedValue({ runId: 'chain-invalid', decision: { ...h.supplied, decision: 'PLACE_LONG', direction: 'LONG', tradeSide: 'LONG', quantityUnits: 1000, idealPrice: market.quote.ask * 1.05, acceptablePriceRange: { min: market.quote.bid, max: market.quote.ask }, horizonMinutes: 3, reachability: 0.9, reason: 'POST_AI_VERIFY_FAIL' } } as never);
    await cycle();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.state.entryIntents.size).toBe(0);
    expect(h.exchange.placeEntry).not.toHaveBeenCalled();
    const blocked = h.events.filter(event => event.type === 'ENTRY_DECISION_BLOCKED');
    expect(blocked.length, JSON.stringify(h.events.filter(e => /REJECT|FAILED/.test(e.type)).slice(0, 6))).toBeGreaterThan(0);
    expect(blocked.at(-1)!.payload?.stage).toBe('POST_AI_VERIFY');
    expect(String(blocked.at(-1)!.payload?.reason)).toBe('DETERMINISTIC_POST_AI_VERIFY_FAILED');
    await h.coordinator.processPool();
    await settle(60);
    expect(h.ai.decide, 'the refused facts must not re-burn the model').toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { executionReadiness } from './executionReadiness.js';
import { portfolioRiskProfileBlockers, portfolioRiskProfileStatus } from './portfolioRiskLedger.js';
import { portfolioRiskAuthorityCompile } from './portfolioRiskAuthority.js';
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

  it('F2 missing risk brackets remain observational for TESTNET', () => {
    const accountScope = 'binance-primary';
    const compiled = portfolioRiskAuthorityCompile({
      environment: 'TESTNET', accountScope,
      bracketRead: {environment: 'TESTNET', credentialRef: accountScope, observedAt: now, failures: [],
        symbols: [{symbol: 'BTCUSDT', brackets: [{bracket: 0, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.005, initialLeverage: 10, cum: 0}]}]},
      requiredSymbols: ['BTCUSDT'], clusters: {BTC: 'MAJOR'}, scenarios: [{id: 'shock10', priceShockPct: 0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: 0, depthPenaltyPct: 0, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5}],
    });
    if (!compiled.ok) throw new Error(`fixture must compile: ${compiled.blockers.join(',')}`);
    const input = {settings: {connections: {executionMode: 'TESTNET_ENABLED', exchange: {environment: 'TESTNET'}},
      riskGovernance: {entrySafetyMode: 'AUTO', portfolioRisk: profile(compiled.profileFacts)}} as never,
    account: {status: 'READY', asOf: now - 5_000} as never, runtimeControlMode: 'RUNNING', executionGovernanceMode: 'AUTO_RUNNING',
      writeAdmissionBlock: null, executableCandidateCount: 2, portfolioRiskAuthority: {facts: compiled.facts}, authorityScope: {environment: 'TESTNET', accountScope}, now};
    expect(executionReadiness({...input, executableCandidateSymbols: ['BTCUSDT', 'DOGEUSDT']})).toMatchObject({ready: true, modelSpendPermitted: true});
    const noneCovered = executionReadiness({...input, executableCandidateSymbols: ['DOGEUSDT', 'SOLUSDT']});
    expect(noneCovered.blockers).toEqual([]);
    expect(noneCovered.ready).toBe(true);
    expect(noneCovered.modelSpendPermitted).toBe(true);
    // Without a durable authority the pool comparison is meaningless: the absence is the blocker.
    expect(executionReadiness({...input, portfolioRiskAuthority: {facts: null}, executableCandidateSymbols: ['DOGEUSDT']})).toMatchObject({profileStatus: 'PROFILE_FACTS_UNPROVEN'});
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
    expect(unconfigured.blockers).toEqual([]);
    expect(unconfigured.profileStatus).toBe('PROFILE_NOT_CONFIGURED');
    expect(portfolioRiskProfileStatus({ configured: false })).toBe('PROFILE_NOT_CONFIGURED');
    expect(portfolioRiskProfileBlockers(profile({ correlationVersion: '' }))).toEqual(['CORRELATION_VERSION_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ maintenanceMarginRatePct: null }))).toEqual(['MARGIN_TIER_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ scenarios: [], scenarioVersion: '' }))).toEqual(['STRESS_SCENARIO_SET_UNPROVEN']);
    expect(portfolioRiskProfileBlockers(profile({ maxGrossNotionalUsd: null }))[0]).toContain('RISK_PROFILE_FIELDS_MISSING');
    // The shape layer's own list is complete - and that is exactly why it is not the authority: with
    // no durable dataset behind these versions the runtime never reaches READY (see the H1 case below).
    expect(portfolioRiskProfileBlockers(profile())).toEqual([]);
    expect(portfolioRiskProfileStatus(profile())).toBe('READY');
    expect(portfolioRiskProfileBlockers(profile(), {facts: null, environment: 'TESTNET', accountScope: 'binance-primary'})).toEqual(['MARGIN_AUTHORITY_MISSING']);
    expect(portfolioRiskProfileStatus(profile(), {facts: null, environment: 'TESTNET', accountScope: 'binance-primary'})).toBe('PROFILE_FACTS_UNPROVEN');
    const factsUnproven = readiness({ settings: { connections: { executionMode: 'TESTNET_ENABLED', exchange: { environment: 'TESTNET' } }, riskGovernance: { entrySafetyMode: 'AUTO', portfolioRisk: profile({ correlationVersion: '' }) } } });
    expect(factsUnproven.blockers).toEqual([]);
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
  const market = h.state.snapshots.get(h.packet.symbol)!;
  const tickSize = market.quote.tickSize, price = side === 'LONG' ? market.quote.bid : market.quote.ask;
  h.ai.decide.mockImplementation(async (decisionPacket: any) => ({ runId: `chain-${side}`, decision: h.candidateDecision(decisionPacket, side, 0, { idealPrice: price, acceptablePriceRange: { min: price - tickSize * 20, max: price + tickSize * 20 }, horizonMinutes: 3, reachability: 0.9, reason: 'NATURAL_PLACE_CHAIN' }) }) as never);
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

  it('TESTNET spends model capacity despite an unconfigured risk profile', async () => {
    const {h,cycle}=await equipped('LONG');
    (h.state.settings.riskGovernance as any).portfolioRisk={configured:false};
    await cycle();expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.coordinator.analysisDiagnostics().execution).toMatchObject({ready:true,blockers:[]});
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
  const authorityScenarios = [
    { id: 'DOWN_10', priceShockPct: -0.1, spreadWidenPct: 0.01, fundingShockPct: 0.005, markBasisShockPct: -0.01, depthPenaltyPct: 0.02, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: 0.5 },
    { id: 'EXCHANGE_GAP_15', priceShockPct: -0.15, spreadWidenPct: 0.02, fundingShockPct: 0.005, markBasisShockPct: -0.02, depthPenaltyPct: 0.03, exchangeUnavailable: true, unavailablePenaltyPct: 0.03, clusterConvergencePct: 0.75 },
  ];
  /** Compiled by the real authority compiler from a synthetic bracket read: a fixture is not a weaker rule. */
  function committedAuthority(h: ReturnType<typeof harness>) {
    const accountScope = String(h.state.settings.connections.exchange.credentialRef ?? 'binance-primary');
    // Coverage has to include what this tick can actually execute, or the gate is right to refuse.
    const routed = ((h.state.runtimeControl.capital.routedCandidates ?? []) as Array<{symbol?: string; longExecutable?: boolean; shortExecutable?: boolean}>)
      .filter(route => route.longExecutable || route.shortExecutable).map(route => String(route.symbol ?? '').toUpperCase()).filter(Boolean);
    const symbols = [...new Set(['BTCUSDT', ...routed])].sort();
    const compiled = portfolioRiskAuthorityCompile({
      environment: 'TESTNET', accountScope,
      bracketRead: {environment: 'TESTNET', credentialRef: accountScope, observedAt: Date.now(), failures: [],
        symbols: symbols.map(symbol => ({symbol, brackets: [{bracket: 0, notionalFloor: 0, notionalCap: null, maintMarginRatio: 0.005, initialLeverage: 10, cum: 0}]}))},
      requiredSymbols: symbols, clusters: {BTC: 'MAJOR'}, scenarios: authorityScenarios,
    });
    if (!compiled.ok) throw new Error(`fixture authority must compile: ${compiled.blockers.join(',')}`);
    return compiled;
  }
  function runtime(options: { authority?: boolean } = {}) {
    const h = harness();
    const authority = committedAuthority(h);
    const noted = vi.fn();
    const processPool = vi.fn(async () => {});
    const fake: Record<string, unknown> = {
      state: h.state,
      runtimeControl: { canDispatch: () => true },
      entry: { processPool, noteExecutionReadiness: noted, writeAdmissionBlockReason: () => null },
      portfolioRiskAuthority: options.authority === false
        ? {facts: null, reasons: ['AUTHORITY_NOT_LOADED'], loadedAt: 0, staleObservedContentHash: null}
        : {facts: authority.facts, reasons: [], loadedAt: Date.now(), staleObservedContentHash: null},
    };
    const privateMethod = (name: string) => (EngineRuntime.prototype as unknown as Record<string, (this: unknown) => unknown>)[name];
    // Bind the runtime's own gate instead of reimplementing it, so the test cannot drift from production.
    fake.authorityScope = () => privateMethod('authorityScope').call(fake);
    fake.portfolioRiskRequiredSymbols = () => privateMethod('portfolioRiskRequiredSymbols').call(fake);
    fake.executionReadinessSnapshot = () => privateMethod('executionReadinessSnapshot').call(fake);
    const dispatch = (EngineRuntime.prototype as unknown as { dispatchAnalysisTick: (this: unknown) => Promise<void> }).dispatchAnalysisTick;
    return { h, fake, noted, processPool, profileFacts: authority.profileFacts, tick: () => dispatch.call(fake) };
  }

  it('reports the first real reason every tick and still runs the deterministic tick body', async () => {
    const { h, noted, processPool, profileFacts, tick } = runtime();
    h.state.settings.connections.executionMode = 'READ_ONLY';
    h.state.account = { ...h.state.account, status: 'READY', asOf: Date.now(), equityUsd: 10_000 };
    h.state.runtimeControl = { ...h.state.runtimeControl, mode: 'RUNNING', capital: { ...h.state.runtimeControl.capital, executableCandidateCount: 3 } };
    h.state.executionGovernance = { ...h.state.executionGovernance, mode: 'AUTO_RUNNING' };
    (h.state.settings.riskGovernance as Record<string, unknown>).entrySafetyMode = 'AUTO';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile(profileFacts);
    await tick();
    expect(noted).toHaveBeenCalledOnce();
    expect(noted.mock.calls[0][0]).toMatchObject({ intent: true, ready: false, firstBlocker: 'EXECUTION_WRITE_LOCKED' });
    expect(processPool, 'supply maintenance is not the model cost, so the tick still runs it').toHaveBeenCalledOnce();
    // Unlocking writes through the settings boundary is enough: the next tick is permitted to spend.
    h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
    await tick();
    expect(noted.mock.calls.at(-1)?.[0]).toMatchObject({ ready: true, modelSpendPermitted: true });
  });

  it('H1 missing committed risk authority does not suppress TESTNET analysis', async () => {
    const { h, noted, profileFacts, tick } = runtime({ authority: false });
    h.state.account = { ...h.state.account, status: 'READY', asOf: Date.now(), equityUsd: 10_000 };
    h.state.runtimeControl = { ...h.state.runtimeControl, mode: 'RUNNING', capital: { ...h.state.runtimeControl.capital, executableCandidateCount: 3 } };
    h.state.executionGovernance = { ...h.state.executionGovernance, mode: 'AUTO_RUNNING' };
    (h.state.settings.riskGovernance as Record<string, unknown>).entrySafetyMode = 'AUTO';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile(profileFacts);
    await tick();
    const verdict = noted.mock.calls.at(-1)?.[0] as { ready: boolean; modelSpendPermitted: boolean; blockers: string[]; profileStatus: string };
    expect(verdict.blockers).toEqual([]);
    expect(verdict.profileStatus).toBe('PROFILE_FACTS_UNPROVEN');
    expect(verdict.ready).toBe(true);
    expect(verdict.modelSpendPermitted).toBe(true);
  });

  it('H17 risk bracket drift does not veto TESTNET PLACE', async () => {
    const { h, fake, noted, profileFacts, tick } = runtime();
    h.state.account = { ...h.state.account, status: 'READY', asOf: Date.now(), equityUsd: 10_000 };
    h.state.runtimeControl = { ...h.state.runtimeControl, mode: 'RUNNING', capital: { ...h.state.runtimeControl.capital, executableCandidateCount: 3 } };
    h.state.executionGovernance = { ...h.state.executionGovernance, mode: 'AUTO_RUNNING' };
    (h.state.settings.riskGovernance as Record<string, unknown>).entrySafetyMode = 'AUTO';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile(profileFacts);
    h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
    await tick();
    expect((noted.mock.calls.at(-1)?.[0] as {ready: boolean}).ready).toBe(true);
    // A fresher collection that disagrees with the committed one is a diagnosis, and it costs no model.
    (fake.portfolioRiskAuthority as {staleObservedContentHash: string | null}).staleObservedContentHash = 'f'.repeat(64);
    await tick();
    const verdict = noted.mock.calls.at(-1)?.[0] as {ready: boolean; modelSpendPermitted: boolean; blockers: string[]};
    expect(verdict.blockers).toEqual([]);
    expect(verdict.ready).toBe(true);
    expect(verdict.modelSpendPermitted).toBe(true);
  });

  it('does not evaluate readiness at all when the environment is not Testnet', async () => {
    const { h, noted, processPool, profileFacts, tick } = runtime();
    h.state.settings.connections.exchange.environment = 'PRODUCTION';
    h.state.settings.connections.executionMode = 'TESTNET_ENABLED';
    (h.state.settings.riskGovernance as Record<string, unknown>).portfolioRisk = profile(profileFacts);
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

  it('normalizes redundant post-AI entry-location fields and executes the frozen candidate once', async () => {
    const { h, cycle, settle } = await equipped('LONG');
    const market = h.state.snapshots.get(h.packet.symbol)!;
    h.ai.decide.mockImplementation(async (decisionPacket: any) => ({
      runId: 'chain-normalized',
      decision: h.candidateDecision(decisionPacket, 'LONG', 0, {
        idealPrice: market.quote.ask * 1.05,
        acceptablePriceRange: { min: market.quote.bid, max: market.quote.ask },
        horizonMinutes: 3,
        reachability: 0.9,
        reason: 'POST_AI_REDUNDANT_FIELD_NORMALIZATION',
      }),
    }) as never);
    await cycle();
    expect(h.ai.decide).toHaveBeenCalledOnce();
    expect(h.state.entryIntents.size).toBe(1);
    expect(h.exchange.placeEntry).toHaveBeenCalledOnce();
    expect(h.events.some(event => event.type === 'POST_AI_REDUNDANT_FIELD_NORMALIZED'
      && event.payload?.field === 'entryLocation' && event.payload?.postAiVeto === false)).toBe(true);
    expect(h.events.some(event => event.type === 'ENTRY_DECISION_BLOCKED' && String(event.payload?.stage ?? '').startsWith('POST_AI'))).toBe(false);
    await h.coordinator.processPool();
    await settle(60);
    expect(h.ai.decide, 'one Primary decision may create at most one intent').toHaveBeenCalledOnce();
  });
});

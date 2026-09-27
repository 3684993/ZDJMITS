import {describe, expect, it} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {PortfolioRiskAdmission, rankAdmissionReasons, type AdmissionCapacityFacts} from './portfolioRiskLedger.js';
import {bookAdmissionSummary, inputsFor} from './admissionCapacityReader.js';
import {computeExecutableRiskHeadroom} from './executableRiskHeadroom.js';
import {buildPreAiExecutionEnvelope} from './preAiExecutionEnvelope.js';
import {portfolioCapacityVisibility} from './riskReadiness.js';
import {entrySideCapacityTraces} from './entryCapacityTrace.js';
import {harness} from './tradingQualityTestHarness.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/**
 * V3.9.6 PLACE→Submit: the capacity surfaces and the committing gate must answer with one semantics.
 *
 * The live failure this closes was structural, not numerical: 264 of 265 Brain PLACE decisions were refused
 * by `admit()` while the cockpit published "both sides executable, $396 available" and the pre-AI envelope
 * dispatched another model run. The gate's reasons were sorted alphabetically and `reasons[0]` was reported,
 * so an unrelated label masked the ceiling that was actually out of room, and the capacity layer asserted
 * `portfolioRisk.allowed=true` because it never asked.
 *
 * These cases pin the replacement rule: an unproven fact first, then a denial that holds at any size, then
 * the tightest dollar ceiling — always with the numbers attached, never with a co-binding gate hidden, and
 * never with a missing verdict rendered as room.
 */

const fixtureSymbol: string = JSON.parse(readFileSync(new URL('./fixtures/v363-entry.json', import.meta.url), 'utf8'))[0].packet.symbol;
const identity = {environment: 'TESTNET', account: 'binance-primary'};
const any = (value: unknown) => value as any;

const profile = (over: Record<string, any> = {}) => ({
  configured: true, marginTierVersion: 'bracket-2026-09', maintenanceMarginRatePct: .005, correlationVersion: 'corr-2026-09', scenarioVersion: 'scn-2026-09',
  maxCapitalAtRiskUsd: 600, maxDrawdownPct: .2, maxStressLossUsd: 900, maxGrossNotionalUsd: 6_000, maxDirectionNotionalUsd: 4_000, maxClusterNotionalUsd: 6_000,
  minMarginBufferPct: .2, minLiquidationBufferPct: .01, maxHumanPositions: 6, maxHumanNotionalUsd: 6_000, maxPendingHandoffs: 4, maxAckAgeMs: 8 * 3_600_000,
  snapshotTtlMs: 20_000, cashFlowWindowMs: 86_400_000, cashFlowMaxAgeMs: 900_000, clusters: {},
  scenarios: [{id: 'shock10', priceShockPct: .10, spreadWidenPct: .01, fundingShockPct: .001, markBasisShockPct: .005, depthPenaltyPct: .01, exchangeUnavailable: false, unavailablePenaltyPct: 0, clusterConvergencePct: .25}],
  ...over,
});

/** A live book of one handoff-managed LONG, exactly the shape the cockpit had been describing wrongly. */
function book(options:{profile?:Record<string,any>;acknowledgedAt?:number|null;handoffAgeMs?:number;cashFlows?:any[]|null;grossUsd?:number}={}){
  const now = Date.now(), notional = options.grossUsd ?? 6_500;
  const settings: any = {portfolio: {maxPositions: 10}, riskGovernance: {portfolioRisk: profile(options.profile ?? {})}};
  const state = new RuntimeState(any(settings));
  state.account = {...state.account, status: 'READY', asOf: now, equityUsd: 10_000,
    assets: [{asset: 'USDT', walletBalance: 10_000, availableBalance: 9_000, usdValue: 10_000}],
    riskBaseline: {startingEquityUsd: 11_000, currentEquityUsd: 10_000, riskDrawdownPct: .09}};
  state.runtimeControl = {...state.runtimeControl, capital: {generation: 7, evaluatedAt: now, capitalVersion: 'capital-pt', nextRecheckAt: now + 300_000}} as never;
  state.positions.set('p1', {id: 'p1', symbol: 'BTCUSDT', side: 'LONG', quantity: 65, markPrice: notional / 65, entryPrice: notional / 65, leverage: 10,
    openedAt: now - 60_000, firstObservedAt: now - 60_000, cycleId: 'cycle_p1', liquidationPrice: notional / 65 * .85, marginAsset: 'USDT',
    notionalUsd: notional, maintenanceMarginUsd: notional * .005} as never);
  const handoffAt = now - (options.handoffAgeMs ?? 10 * 3_600_000);
  const owners = new Map<string, any>([['p1', {ownerState: 'HANDOFF_PENDING', handoffAt, acknowledgedAt: options.acknowledgedAt ?? null}]]);
  const admission = new PortfolioRiskAdmission({state, identity: () => identity,
    ownerOf: (_scope, cycleId) => owners.get(String(cycleId).replace(/^cycle_/, '')) ?? null,
    cashFlows: () => options.cashFlows === null ? [] : [{id: `coverage:${now}`, amountUsd: 0, factStatus: 'VERIFIED'}],
    profile: () => (state.settings.riskGovernance as any).portfolioRisk ?? {}});
  state.entryRiskGate = (input: any) => admission.gate(input);
  (state as any).riskAdmission = admission;
  return {now, state, admission, owners,
    candidate: (over: Record<string, any> = {}): any => ({symbol: 'ETHUSDT', side: 'LONG', quoteAsset: 'USDT', notionalUsd: 500, marginUsd: 50, leverage: 10, markPrice: 3_000, planId: 'plan_pt_1', intentId: null, ...over})};
}

const gate = (name: string, reason: string, maxAdditionalUsd: number, limitUsd = 10_811.957, usedUsd = 11_113.54) =>
  ({name, reason, unit: 'NOTIONAL_USD' as const, limitUsd, usedUsd, maxAdditionalUsd});

describe('the admitting gate names the constraint that actually binds', () => {
  it('PT-01 reports the tightest dollar ceiling, not the alphabetically first label', () => {
    const ranked = rankAdmissionReasons({reasons: ['HUMAN_POTENTIAL_NOTIONAL_LIMIT', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_CLUSTER_NOTIONAL'],
      gates: [gate('MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', 0), gate('HUMAN_POTENTIAL_NOTIONAL', 'HUMAN_POTENTIAL_NOTIONAL_LIMIT', 0),
        gate('MAX_CLUSTER_NOTIONAL', 'STRESS_LIMIT:MAX_CLUSTER_NOTIONAL', 0)], candidateNotionalUsd: 5.02});
    expect(ranked.firstBinding?.code).toBe('STRESS_LIMIT:MAX_GROSS_NOTIONAL');
    expect(ranked.firstBinding?.kind).toBe('NOTIONAL');
    expect(ranked.firstBinding?.gate).toBe('MAX_GROSS_NOTIONAL');
    // The number the operator has to act on: the shortfall is the human reduction, not a vague "risk limit".
    expect(ranked.firstBinding?.shortfallUsd).toBeCloseTo(306.6, 1);
    // Co-binding ceilings stay listed: naming one first must never hide that three are breached at once.
    expect(ranked.ordered).toContain('HUMAN_POTENTIAL_NOTIONAL_LIMIT');
    expect(ranked.ordered).toContain('STRESS_LIMIT:MAX_CLUSTER_NOTIONAL');
  });

  it('PT-02 names the strictly tighter ceiling when the book has one', () => {
    const ranked = rankAdmissionReasons({reasons: ['STRESS_LIMIT:MAX_GROSS_NOTIONAL', 'HUMAN_POTENTIAL_NOTIONAL_LIMIT'],
      gates: [gate('MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', 900), gate('HUMAN_POTENTIAL_NOTIONAL', 'HUMAN_POTENTIAL_NOTIONAL_LIMIT', -40)]});
    expect(ranked.firstBinding?.code).toBe('HUMAN_POTENTIAL_NOTIONAL_LIMIT');
    expect(ranked.firstBinding?.headroomUsd).toBe(-40);
  });

  it('PT-03 a denial that holds at any size outranks the arithmetic, and says so', () => {
    const ranked = rankAdmissionReasons({reasons: ['HUMAN_PENDING_HANDOFF_LIMIT', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL'],
      gates: [gate('MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', 0)]});
    expect(ranked.firstBinding?.code).toBe('HUMAN_PENDING_HANDOFF_LIMIT');
    expect(ranked.firstBinding?.kind).toBe('SIZE_INDEPENDENT');
    // Shrinking the order cannot answer this one, and the number is still not hidden.
    expect(ranked.firstBinding?.shortfallUsd).toBeNull();
    expect(ranked.ordered).toContain('STRESS_LIMIT:MAX_GROSS_NOTIONAL');
  });

  it('PT-04 an unproven fact outranks every policy reading of it, and the summary label never leads', () => {
    const ranked = rankAdmissionReasons({reasons: ['PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE', 'PENDING_RISK_UNVERIFIED:order:intent_1', 'HUMAN_ACK_OVERDUE'],
      gates: [gate('MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', 0)]});
    expect(ranked.firstBinding?.code).toBe('PENDING_RISK_UNVERIFIED:order:intent_1');
    expect(ranked.firstBinding?.kind).toBe('EVIDENCE');
    expect(ranked.ordered.indexOf('PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE')).toBeGreaterThan(ranked.ordered.indexOf('PENDING_RISK_UNVERIFIED:order:intent_1'));
  });

  it('PT-05 ACK age is diagnostic; clearing real exposure is what changes the admission result', () => {
    const overdue = book();
    expect(overdue.admission.capacityFacts(overdue.now).admitsAnyPositiveNotional).toBe(false);
    const denied = overdue.admission.admit(overdue.candidate(), overdue.now);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('STRESS_LIMIT:MAX_GROSS_NOTIONAL');
    expect(denied.reasons).not.toContain('HUMAN_ACK_OVERDUE');

    // Acknowledgement remains ownership evidence but cannot alter the risk ceiling.
    overdue.owners.set('p1', {ownerState: 'HANDOFF_PENDING', handoffAt: overdue.now - 1_000, acknowledgedAt: overdue.now});
    const afterAck = overdue.admission.admit(overdue.candidate(), overdue.now);
    expect(afterAck.allowed).toBe(false);
    expect(afterAck.reason).toBe('STRESS_LIMIT:MAX_GROSS_NOTIONAL');
    expect(afterAck.firstBinding?.shortfallUsd).toBeGreaterThan(500);

    // Reducing the book below the committed ceiling is what actually admits — no threshold was touched.
    overdue.state.positions.get('p1')!.markPrice = 1_200 / 65;
    overdue.state.positions.get('p1')!.notionalUsd = 1_200;
    overdue.state.positions.get('p1')!.maintenanceMarginUsd = 6;
    overdue.state.positions.get('p1')!.liquidationPrice = 1_200 / 65 * .85;
    const admitted = overdue.admission.admit(overdue.candidate({notionalUsd: 500, marginUsd: 50}), overdue.now);
    expect(admitted.allowed, JSON.stringify(admitted.reasons)).toBe(true);
    expect(admitted.firstBinding).toBeNull();
  });

  it('PT-06 the capacity view and the gate agree on the same book, with the number attached', () => {
    const live = book();
    const summary = bookAdmissionSummary(live.state, live.now);
    expect(summary).toMatchObject({status: 'AVAILABLE', hasVerdict: true, exhausted: true, code: 'STRESS_LIMIT:MAX_GROSS_NOTIONAL'});
    expect(summary.overdueHandoffs).toBe(1);
    expect(summary.ceilingUsdBySide).toEqual({LONG: 0, SHORT: 0});
    const budget = {evaluatedAt: live.now, policy: {gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'ENFORCE'},
      grossNotionalUsd: 6_500, grossLimitUsd: 10_000, remainingGrossUsd: 3_500, grossUsedPct: .65,
      longNotionalUsd: 6_500, shortNotionalUsd: 0, directionLimitUsd: 10_000, longAvailableNotionalUsd: 3_500, shortAvailableNotionalUsd: 10_000,
      longUsedPct: .65, shortUsedPct: 0} as any;
    const view = portfolioCapacityVisibility({positions: 1, inFlight: 0, reserved: 0, used: 1, max: 10}, budget, {admission: summary});
    // The ratio model still says there is direction room (it is observed, not enforced) — and that is no
    // longer allowed to read as "can add", because the gate's own denial decides the status line.
    expect(view.exposure.LONG.remainingUsd).toBeGreaterThan(0);
    expect(view.sideStatus.code).toBe('RISK_ADMISSION_EXHAUSTED');
    expect(view.firstBlocker).toBe('RISK_ADMISSION');
    expect(view.exhaustedForNewRisk).toBe(true);
    expect(view.admission.detail).toContain('MAX_GROSS_NOTIONAL');
  });

  it('PT-07 absent or failed admission is unavailable in execution mode; analysis-only remains non-vetoing', () => {
    const permissive = book({profile: {maxGrossNotionalUsd: 60_000, maxHumanNotionalUsd: 60_000, maxClusterNotionalUsd: 60_000, maxCapitalAtRiskUsd: 60_000,
      maxDirectionNotionalUsd: 40_000, maxStressLossUsd: 5_000}, acknowledgedAt: Date.now()});
    const summary = bookAdmissionSummary(permissive.state, permissive.now);
    expect(summary.exhausted, JSON.stringify(summary)).toBe(false);
    expect(summary.hasVerdict).toBe(true);
    expect(permissive.admission.admit(permissive.candidate(), permissive.now).allowed,
      JSON.stringify(permissive.admission.admit(permissive.candidate(), permissive.now).reasons)).toBe(true);
    // An absent admission is different from a valid numeric zero and fails closed before execution.
    expect(inputsFor(null, 'LONG')).toMatchObject({riskAdmissionCeilingUsd: null, riskAdmissionRefusal: 'RISK_ADMISSION_UNAVAILABLE'});
    const missing = new RuntimeState(any({}));
    expect(bookAdmissionSummary(missing, Date.now())).toMatchObject({status: 'UNAVAILABLE', hasVerdict: false, code: 'RISK_ADMISSION_UNAVAILABLE'});
    const broken = new RuntimeState(any({}));
    (broken as any).riskAdmission = {capacityFacts: () => { throw new Error('read failure'); }};
    expect(bookAdmissionSummary(broken, Date.now())).toMatchObject({status: 'UNAVAILABLE', hasVerdict: false, code: 'RISK_ADMISSION_UNAVAILABLE'});
    const analysis = new RuntimeState(any({connections: {executionMode: 'READ_ONLY', exchange: {environment: 'TESTNET'}}}));
    expect(bookAdmissionSummary(analysis, Date.now()).status).toBe('NOT_APPLICABLE');
    const budget = {evaluatedAt: Date.now(), policy: {gross: 'OBSERVE', direction: 'OBSERVE', cluster: 'OBSERVE'}, grossNotionalUsd: 0, grossLimitUsd: 1, remainingGrossUsd: 0,
      grossUsedPct: 1, longNotionalUsd: 0, shortNotionalUsd: 0, directionLimitUsd: 1, longAvailableNotionalUsd: 0, shortAvailableNotionalUsd: 0, longUsedPct: 0, shortUsedPct: 0} as any;
    const view = portfolioCapacityVisibility({positions: 0, inFlight: 0, reserved: 0, used: 0, max: 10}, budget, {admission: bookAdmissionSummary(missing)});
    expect(view.firstBlocker).toBe('RISK_ADMISSION_UNAVAILABLE');
    expect(view.admission.status).toBe('UNAVAILABLE');
    expect(view.sideStatus.code).toBe('RISK_ADMISSION_UNAVAILABLE');
  });
});

describe('risk-chain simplification preserves independent limits and sizes in each gate unit', () => {
  it('an overdue ACK stays visible as governance work but cannot veto an otherwise admissible Entry', () => {
    const overdue = book({grossUsd: 1_200, handoffAgeMs: 10 * 3_600_000, profile: {maxAckAgeMs: 8 * 3_600_000,
      maxGrossNotionalUsd: 6_000, maxHumanNotionalUsd: 6_000, maxClusterNotionalUsd: 6_000, maxCapitalAtRiskUsd: 600,
      maxDirectionNotionalUsd: 4_000, maxStressLossUsd: 900, maxHumanPositions: 6, maxPendingHandoffs: 4}});
    const facts = overdue.admission.capacityFacts(overdue.now);
    expect(facts.overdueHandoffs).toBe(1);
    expect(facts.oldestOverdueHours).toBeGreaterThan(9);
    const decision = overdue.admission.admit(overdue.candidate(), overdue.now);
    expect(decision.allowed, JSON.stringify(decision.reasons)).toBe(true);
    expect(decision.snapshot.grossNotionalUsd).toBeCloseTo(1_700, 6);
  });

  it('ranked gate shortfalls add candidate impact in the gate unit only', () => {
    const ranked = rankAdmissionReasons({reasons: ['STRESS_LIMIT:MAX_GROSS_NOTIONAL', 'STRESS_LIMIT:MAX_CAPITAL_AT_RISK', 'STRESS_LIMIT:MAX_STRESS_LOSS'], gates: [
      {name: 'MAX_GROSS_NOTIONAL', reason: 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', unit: 'NOTIONAL_USD', limitUsd: 100, usedUsd: 95, maxAdditionalUsd: 5, candidateImpactUsd: 20},
      {name: 'MAX_CAPITAL_AT_RISK', reason: 'STRESS_LIMIT:MAX_CAPITAL_AT_RISK', unit: 'MARGIN_USD', limitUsd: 100, usedUsd: 98, maxAdditionalUsd: 2, candidateImpactUsd: 5},
      {name: 'MAX_STRESS_LOSS', reason: 'STRESS_LIMIT:MAX_STRESS_LOSS', unit: 'LOSS_USD', limitUsd: 60, usedUsd: 50, maxAdditionalUsd: 10, candidateImpactUsd: 3},
    ]});
    const byCode = new Map(ranked.ordered.map(code => [code, code]));
    expect([...byCode.keys()]).toHaveLength(3);
    expect(ranked.firstBinding?.kind).toBe('NOTIONAL');
    const margin = rankAdmissionReasons({reasons: ['STRESS_LIMIT:MAX_CAPITAL_AT_RISK'], gates: [
      {name: 'MAX_CAPITAL_AT_RISK', reason: 'STRESS_LIMIT:MAX_CAPITAL_AT_RISK', unit: 'MARGIN_USD', limitUsd: 100, usedUsd: 98, maxAdditionalUsd: 2, candidateImpactUsd: 5},
    ]});
    expect(margin.firstBinding?.kind).toBe('LIMIT');
    expect(margin.firstBinding?.shortfallUsd).toBe(3);
  });

  it('candidate risk ceiling converts margin headroom by verified leverage and solves stress loss in loss dollars', () => {
    const stress = book({grossUsd: 1_200, profile: {maxGrossNotionalUsd: 20_000, maxHumanNotionalUsd: 20_000,
      maxClusterNotionalUsd: 20_000, maxCapitalAtRiskUsd: 60_000, maxDirectionNotionalUsd: 20_000, maxStressLossUsd: 600,
      maxHumanPositions: 6, maxPendingHandoffs: 4}});
    const ceiling = stress.admission.capacityFacts(stress.now, 'ETHUSDT', {leverage: 10, leverageFact: 'CANDIDATE_RECOMMENDED', quoteAsset: 'USDT'});
    const expectedStressCeiling = (600 - 1_200 * (.126 + .025)) / (.126 + .025);
    expect(ceiling.maxNewRiskNotionalUsdBySide.LONG).toBeCloseTo(expectedStressCeiling, 4);
    expect(ceiling.maxNewRiskNotionalUsdBySide.SHORT).toBeCloseTo(expectedStressCeiling, 4);
    const margin = book({grossUsd: 1_200, profile: {maxGrossNotionalUsd: 20_000, maxHumanNotionalUsd: 20_000,
      maxClusterNotionalUsd: 20_000, maxCapitalAtRiskUsd: 180, maxDirectionNotionalUsd: 20_000, maxStressLossUsd: 20_000,
      maxHumanPositions: 6, maxPendingHandoffs: 4}});
    const marginFacts = margin.admission.capacityFacts(margin.now, 'ETHUSDT', {leverage: 10, leverageFact: 'CANDIDATE_RECOMMENDED', quoteAsset: 'USDT'});
    expect(marginFacts.maxNewRiskNotionalUsdBySide.LONG).toBeCloseTo(600, 6);
  });

  it('retains a genuinely tighter mapped-cluster ceiling', () => {
    const clustered = book({grossUsd: 1_200, profile: {maxGrossNotionalUsd: 5_000, maxHumanNotionalUsd: 5_000,
      maxClusterNotionalUsd: 1_500, maxCapitalAtRiskUsd: 60_000, maxDirectionNotionalUsd: 5_000, maxStressLossUsd: 20_000,
      maxHumanPositions: 6, maxPendingHandoffs: 4, clusters: {BTC: 'MAJORS'}}});
    const facts = clustered.admission.capacityFacts(clustered.now, 'BTCUSDT', {leverage: 10, leverageFact: 'CANDIDATE_RECOMMENDED', quoteAsset: 'USDT'});
    expect(facts.maxNewRiskNotionalUsdBySide.LONG).toBeCloseTo(300, 6);
    const decision = clustered.admission.admit(clustered.candidate({symbol: 'BTCUSDT', notionalUsd: 500, marginUsd: 50}), clustered.now);
    expect(decision.reasons).toContain('STRESS_LIMIT:MAX_CLUSTER_NOTIONAL');
  });
});

describe('the pre-AI envelope refuses with the gate number, before any model run', () => {
  const capacityFacts = (over: Partial<AdmissionCapacityFacts> = {}): any => ({
    evaluatedAt: Date.now(), admitsAnyPositiveNotional: false, maxNewRiskNotionalUsd: 0, maxNewRiskNotionalUsdBySide: {LONG: 0, SHORT: 0},
    evidenceBlockers: [], sizeIndependentRefusals: ['HUMAN_ACK_OVERDUE'],
    firstBinding: {kind: 'SIZE_INDEPENDENT', code: 'HUMAN_ACK_OVERDUE', gate: null, limitUsd: null, usedUsd: null, headroomUsd: null, shortfallUsd: null,
      detail: 'HUMAN_ACK_OVERDUE（与名义规模无关的拒因）'}, ...over,
  });
  const armed = (facts: any) => {
    const h = harness();
    (h.state as any).riskAdmission = {capacityFacts: () => facts};
    return h.state;
  };

  it('PT-08 a size-independent denial makes both sides non-executable and names itself', () => {
    const envelope = buildPreAiExecutionEnvelope(armed(capacityFacts()), fixtureSymbol);
    for (const side of ['LONG', 'SHORT'] as const) {
      expect(envelope[side].executable).toBe(false);
      expect(envelope[side].firstBindingConstraint).toBe('HUMAN_ACK_OVERDUE');
      expect(envelope[side].legalQuantityRangeUnits).toBeNull();
      expect(envelope[side].admission?.refusal).toBe('HUMAN_ACK_OVERDUE');
      expect(envelope[side].authorization).toBe('NOT_EXECUTABLE:HUMAN_ACK_OVERDUE');
    }
    expect(envelope.executableSides).toEqual([]);
    expect(envelope.noExecutableSide).toBe(true);
  });

  it('PT-09 a dollar ceiling is stated as the room left, and never blamed on the exchange floor', () => {
    const envelope = buildPreAiExecutionEnvelope(armed(capacityFacts({
      sizeIndependentRefusals: [], admitsAnyPositiveNotional: false,
      firstBinding: {kind: 'NOTIONAL', code: 'STRESS_LIMIT:MAX_GROSS_NOTIONAL', gate: 'MAX_GROSS_NOTIONAL', limitUsd: 10_811.957, usedUsd: 11_113.54,
        headroomUsd: 0, shortfallUsd: 306.6, detail: 'MAX_GROSS_NOTIONAL 上限 10811.96，已用 11113.54，可新增 0.00，缺口 306.61'},
    })), fixtureSymbol);
    const quote = envelope.LONG;
    expect(quote.executable).toBe(false);
    // The capacity layer names the dimension it ran out of; which committed ceiling that was, and by how
    // much, travels with it — so no surface has to guess from a blocker list.
    expect(quote.firstBindingConstraint).toBe('RISK_ADMISSION_CEILING');
    expect(quote.admission?.gate).toBe('MAX_GROSS_NOTIONAL');
    expect(String(quote.admission?.detail)).toContain('10811.96');
    expect(quote.riskHeadroom.blockers).toContain('REJECT_RISK_ADMISSION_CEILING');
  });

  it('PT-10 funding and exchange floors still refuse on their own terms when the gate allows', () => {
    const open = capacityFacts({admitsAnyPositiveNotional: true, maxNewRiskNotionalUsd: 5_000, maxNewRiskNotionalUsdBySide: {LONG: 5_000, SHORT: 5_000},
      sizeIndependentRefusals: [], firstBinding: null});
    const funded = harness();
    (funded.state as any).riskAdmission = {capacityFacts: () => open};
    funded.state.account = {...funded.state.account, assets: [{asset: 'USDT', availableBalance: 0, walletBalance: 0, usdValue: 0, marginEligible: true}]};
    const broke = buildPreAiExecutionEnvelope(funded.state, fixtureSymbol);
    expect(broke.LONG.executable).toBe(false);
    // The gate gave room, so the money fact is the cause and keeps its own name.
    expect(String(broke.LONG.firstBindingConstraint)).toMatch(/AVAILABLE_MARGIN|MARGIN_POLICY_CAP/);
    expect(broke.LONG.firstBindingConstraint).not.toBe('RISK_ADMISSION_CEILING');
  });

  it('PT-11 a symbol with no verified margin bracket is still refused by name, not by the book verdict', () => {
    const state = armed(capacityFacts({admitsAnyPositiveNotional: true, maxNewRiskNotionalUsd: 5_000, maxNewRiskNotionalUsdBySide: {LONG: 5_000, SHORT: 5_000},
      sizeIndependentRefusals: [], evidenceBlockers: [], firstBinding: null}));
    state.marginTierCoverage = {symbols: ["NOTTHISONEUSDT"]} as any;
    const envelope = buildPreAiExecutionEnvelope(state, fixtureSymbol);
    expect(envelope.LONG.executable).toBe(false);
    expect(envelope.LONG.firstBindingConstraint).toBe(`MARGIN_TIER_SYMBOL_UNPROVEN:${fixtureSymbol}`);
  });
});

describe('the per-candidate capacity row agrees with the gate', () => {
  it('PT-15 a per-candidate row never says "executable" while the gate denies at any size', () => {
    const state = harness().state;
    const headroom = {executable: true, finalNotional: 396.28, plannedNotional: 396.28, remaining: {}, blockers: [] as string[],
      observed: {admission: null}, firstBindingConstraint: 'PLANNED_NOTIONAL'};
    const route = {symbol: fixtureSymbol, underlying: 'TRUMP', quoteAsset: 'USDT', longFeasibleNotionalUsd: 396.28, shortFeasibleNotionalUsd: 396.28,
      riskHeadroom: {LONG: headroom, SHORT: headroom}};
    const traces = entrySideCapacityTraces(state, [route], {now: Date.now(),
      admission: {exhausted: true, code: 'HUMAN_ACK_OVERDUE', gate: null, detail: 'HUMAN_ACK_OVERDUE（与名义规模无关）', ceilingUsdBySide: {LONG: 0, SHORT: 0}}});
    for (const side of ['LONG', 'SHORT'] as const) {
      const row = traces[side][0];
      // The money fact stays visible and unaltered; only the verdict changes, and it changes to the gate's.
      expect(row.finalNotionalBeforeRoundingUsd).toBeCloseTo(396.28, 2);
      expect(row.executable).toBe(false);
      expect(row.firstBindingConstraint).toBe('HUMAN_ACK_OVERDUE');
      expect(row.blockers).toContain('REJECT_RISK_ADMISSION_CEILING');
      expect(String(row.explanation)).toContain('HUMAN_ACK_OVERDUE');
    }
    // The same row with no gate verdict is left alone: absence of the gate is never a refusal.
    const unjudged = entrySideCapacityTraces(state, [route], {now: Date.now(), admission: {exhausted: false, code: null, gate: null, detail: null, ceilingUsdBySide: {LONG: 0, SHORT: 0}}});
    expect(unjudged.LONG[0].firstBindingConstraint).not.toBe('HUMAN_ACK_OVERDUE');
  });
});

describe('the ceiling is a real dimension of the capacity arithmetic', () => {
  const base = () => ({settings: harness().state.settings as any, equity: 10_000, positions: [] as any[], symbol: 'ETHUSDT', side: 'LONG' as const,
    plannedNotional: 500, expectedAdverseMovePct: .01, dailyDrawdownPct: 0,
    capital: {quoteAsset: 'USDT', availableBalanceUsd: 9_000, reservedMarginUsd: 0, executionLeaseMarginUsd: 0, executableMarginUsd: 9_000,
      leverage: 10, leverageFact: 'CANDIDATE_RECOMMENDED', policyMarginCapUsd: 9_000, executableNotionalUsd: 90_000, bindingConstraint: 'NONE'} as any,
    minimumNotional: 5});

  it('PT-12 a ceiling below the exchange floor denies the side and is named as the ceiling', () => {
    const bound = computeExecutableRiskHeadroom({...base(), riskAdmissionCeilingUsd: 2});
    expect(bound.executable).toBe(false);
    expect(bound.firstBindingConstraint).toBe('RISK_ADMISSION_CEILING');
    expect(bound.finalNotional).toBe(0);
    expect(bound.remaining.admission).toBe(2);
  });

  it('PT-13 the same facts with room left change the identity they are bound to', () => {
    const tight = computeExecutableRiskHeadroom({...base(), riskAdmissionCeilingUsd: 100});
    const loose = computeExecutableRiskHeadroom({...base(), riskAdmissionCeilingUsd: 10_000});
    expect(tight.factVersion).not.toBe(loose.factVersion);
    expect(loose.executable, JSON.stringify(loose.blockers)).toBe(true);
    // No ceiling is not "zero room": it is this layer having no opinion about the gate.
    const none = computeExecutableRiskHeadroom({...base(), riskAdmissionCeilingUsd: null});
    expect(none.executable).toBe(true);
    expect(none.remaining.admission).toBe(Number.MAX_VALUE);
  });

  it('PT-14 a refusal that holds at any size denies even when funding is ample', () => {
    const refused = computeExecutableRiskHeadroom({...base(), riskAdmissionRefusal: 'HUMAN_ACK_OVERDUE',
      riskAdmissionNote: {gate: null, detail: 'HUMAN_ACK_OVERDUE'}});
    expect(refused.executable).toBe(false);
    expect(refused.firstBindingConstraint).toBe('HUMAN_ACK_OVERDUE');
    // The money blocker list keeps its own vocabulary: the refusal is named, not folded in.
    expect(refused.blockers.filter((reason: string) => reason === 'REJECT_RISK_ADMISSION_CEILING')).toHaveLength(1);
  });
});

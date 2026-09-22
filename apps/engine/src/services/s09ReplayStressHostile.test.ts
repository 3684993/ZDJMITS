import { describe, expect, it } from 'vitest';
import { detectFutureAvailabilityViolation, replayCycle, replayScenario, validateSplitIntegrity, type ReplayEvent, type SimCycle } from './s09ReplayEngine.js';
import { annualisedRatio, mulberry32, pairedAdvantage, reviewExperimentEvidence, stationaryBlockBootstrap } from './s09Statistics.js';
import { configHashOf, experimentIdOf, REQUIRED_ABLATION_GROUPS, reviewExperimentManifest, sealExperimentManifest, type ExperimentManifest } from './s09ExperimentManifest.js';

/**
 * S09 acceptance for the offline replay, stress and statistics layer.
 *
 * Nothing here is a performance claim: the streams are synthetic and the verdicts are about whether the
 * machinery refuses to lie. The tests that matter most are the ones where a tempting number has to be
 * turned down - a leak, a missing cost, an interval that crosses zero, a group that was not reported.
 */

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const costs = { makerRate: 0.0002, takerRate: 0.0004, slippageBps: 5, modelLatencyMs: 1_500, fundingSign: 'APPLIED' as const };
const human = (responseMs: number | null, id = 'r') => ({ id, responseMs, description: `${id} human response scenario` });
const manifestCosts = { makerRate: 0.0002, takerRate: 0.0004, fundingSource: 'synthetic-funding-facts', slippageSource: 'synthetic-arrival-gap',
  modelLatencyMs: 1_500, ackLossModelled: true };
const nonBar = (id: string, at: number, kind: ReplayEvent['kind'], symbol: string, payload: ReplayEvent['payload'] = {}): ReplayEvent =>
  ({ id, availableAt: at, kind, symbol, payload });

const bar = (id: string, at: number, symbol: string, high: number, low: number, close: number, extra: Record<string, unknown> = {}): ReplayEvent =>
  ({ id, availableAt: at, kind: 'BAR', symbol, payload: { high, low, close, mark: close, ...extra } });

const cycle = (over: Partial<SimCycle> = {}): SimCycle => ({
  cycleId: 'c1', symbol: 'BTCUSDT', side: 'LONG', openedAt: T0, entryEvidenceIds: ['b-open'], entryPrice: 100, quantity: 10,
  marginUsd: 100, targetPrice: 110, lossPermissionUsd: -10, horizonMs: 4 * HOUR, fundingIntervalMs: 8 * HOUR,
  liquidationPrice: 90, stepSize: 1, tickSize: 0.1, planSource: 'REPLAY_RESPONSE', ...over,
});

describe('S09-T01 regime resolution', () => {
  it('resolves a target touch as a maker exit and a loss-line touch as a taker exit, both after costs', () => {
    const up = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110)], costs, human(60_000));
    expect(up).toMatchObject({ status: 'CLOSED_TARGET', intraBarAmbiguous: false, partialFills: 0 });
    expect(up.netPnlUsd).toBeCloseTo(100 - (100 * 10 * 0.0002 + 10 * 110 * 0.0002), 6);
    const down = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-sl', T0 + HOUR, 'BTCUSDT', 100, 89, 90)], costs, human(60_000));
    expect(down.status).toBe('CLOSED_LOSS_LINE');
    expect(down.netPnlUsd!).toBeLessThan(-100);
  });

  it('keeps a direction bias visible instead of collapsing it into a win rate', () => {
    // The same rising stream pays a long plan and breaches a short plan's permission line: the asymmetry
    // has to survive into the result, which a pooled win rate would erase.
    const stream = [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110)];
    const long = replayCycle(cycle(), stream, costs, human(60_000));
    const short = replayCycle(cycle({ cycleId: 'c2', side: 'SHORT', targetPrice: 90, entryEvidenceIds: ['b-open'] }), stream, costs, human(60_000));
    expect([long.status, short.status]).toEqual(['CLOSED_TARGET', 'CLOSED_LOSS_LINE']);
    expect(long.netPnlUsd!).toBeGreaterThan(0);
    expect(short.netPnlUsd!).toBeLessThan(0);
    // A short plan whose facts never touch either line stays censored rather than becoming a zero.
    const drift = replayCycle(cycle({ cycleId: 'c3', side: 'SHORT', targetPrice: 90, entryEvidenceIds: ['b-open'] }),
      [bar('b-open', T0, 'BTCUSDT', 101, 99, 100)], costs, human(null));
    expect(drift.netPnlUsd).toBeNull();
    expect(drift.holdingMs).toBeGreaterThan(0);
  });
});

describe('S09-T02/T03/T04/T05 stress paths', () => {
  it('prices a correlated tail as liquidation of the posted margin, not as a mark', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      { id: 'liq', availableAt: T0 + 10 * 60_000, kind: 'LIQUIDATION', symbol: 'BTCUSDT', payload: { mark: 89 } }], costs, human(null));
    expect(result).toMatchObject({ status: 'LIQUIDATED' });
    expect(result.grossPnlUsd).toBeCloseTo(-100, 6);
  });

  it('charges fees, adverse funding and slippage, and reports the advantage disappearing', () => {
    // Neither line is touched, so the exit is a taker fill with slippage: the only path on which a
    // cost model can actually turn a thin edge negative.
    const stream: ReplayEvent[] = [bar('b-open', T0, 'BTCUSDT', 101, 99, 102),
      nonBar('fund', T0 + 8 * HOUR, 'FUNDING', 'BTCUSDT', { fundingRate: 0.001 })];
    const cheap = replayCycle(cycle({ targetPrice: 110 }), stream, { ...costs, slippageBps: 0, takerRate: 0.0004 }, human(0 + 60_000, 'h'));
    const expensive = replayCycle(cycle({ targetPrice: 110 }), stream, { ...costs, slippageBps: 400, takerRate: 0.0015 }, human(0 + 60_000, 'h'));
    expect(cheap.status).toBe('HANDOFF_RESOLVED');
    expect(cheap.netPnlUsd!).toBeGreaterThan(expensive.netPnlUsd!);
    expect(expensive.fundingUsd!).toBeGreaterThan(0);
  });

  it('leaves an unowned handoff censored with capital still occupied, and never as a zero', () => {
    const scenario = (responseMs: number | null) => replayScenario({ scenarioId: 's', human: human(responseMs, responseMs == null ? 'never' : 'fast'),
      cycles: [cycle()], stream: [bar('b-open', T0, 'BTCUSDT', 101, 99, 95)], costs, startEquityUsd: 1_000, asOf: T0 });
    const never = scenario(null), fast = scenario(5 * 60_000);
    expect(never.account.unresolvedCycles).toBe(1);
    expect(never.account.accountNetReturnPct).toBeNull();
    expect(never.account.capitalUsageUsdSeconds).toBeGreaterThan(0);
    expect(never.account.handoffBacklog).toBe(1);
    expect(fast.account.accountNetReturnPct).not.toBeNull();
    expect(fast.account.handoffBacklog).toBe(0);
  });

  it('absorbs duplicate and reordered deliveries without counting a fill twice', () => {
    // Delivered twice and out of order, yet resolved once: the counts are of the delivery, not of a
    // tidy internal ordering that would hide both problems.
    const stream = [bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110), bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      bar('b-open', T0, 'BTCUSDT', 101, 99, 100)];
    const result = replayCycle(cycle(), stream, costs, human(60_000));
    expect(result.duplicateEvents).toBe(1);
    expect(result.reorderedEvents).toBe(1);
    expect(result.netPnlUsd!).toBeCloseTo(100 - (1000 * 0.0002 + 1100 * 0.0002), 4);
  });

  it('treats a lost acknowledgement as unresolved and refuses to invent the outcome', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      { id: 'ack', availableAt: T0 + HOUR, kind: 'EXIT_ACK_LOST', symbol: 'BTCUSDT', payload: {} }], costs, human(null));
    expect(result).toMatchObject({ ackLoss: true, status: 'UNRESOLVED_ACK', netPnlUsd: null });
    const resolved = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      { id: 'ack', availableAt: T0 + HOUR, kind: 'EXIT_ACK_LOST', symbol: 'BTCUSDT', payload: {} },
      { id: 'fact', availableAt: T0 + 2 * HOUR, kind: 'EXIT_FACT', symbol: 'BTCUSDT', payload: { mark: 105, quantityFilled: 10 } }], costs, human(null));
    expect(resolved.netPnlUsd!).toBeGreaterThan(0);
  });

  it('reports a delisting at the last observable price plus taker cost', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      { id: 'delist', availableAt: T0 + 2 * HOUR, kind: 'DELIST_NOTICE', symbol: 'BTCUSDT', payload: { mark: 80 } }], costs, human(null));
    expect(result.status).toBe('CLOSED_DELIST');
    expect(result.netPnlUsd!).toBeLessThan(-200);
  });

  it('reports a partial fill instead of assuming the whole size crossed', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100),
      bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110, { quantityFilled: 4 })], costs, human(null));
    expect(result.partialFills).toBe(1);
    // Four units made the target, the other six drifted to the handoff and were valued from the fact.
    expect(result.netPnlUsd).toBeNull();
  });
});

describe('S09-T06 leakage and split integrity', () => {
  it('refuses a cycle whose entry evidence was not yet available', () => {
    const stream = [bar('b-open', T0 + HOUR, 'BTCUSDT', 101, 99, 100)];
    const audit = detectFutureAvailabilityViolation([cycle({ entryEvidenceIds: ['b-open'] })], stream);
    expect(audit.violations.join('|')).toMatch(/FUTURE_DATA_LEAKAGE:c1:b-open/);
    const ok = detectFutureAvailabilityViolation([cycle({ entryEvidenceIds: ['b-open'], openedAt: T0 + HOUR + 1 })], stream);
    expect(ok.violations).toEqual([]);
    expect(detectFutureAvailabilityViolation([cycle({ entryEvidenceIds: ['ghost'] })], stream).violations.join('|'))
      .toContain('ENTRY_EVIDENCE_UNRESOLVED');
  });

  it('refuses an evaluation window that straddles the split boundary inside the embargo', () => {
    const splits = { trainEnd: T0 + 10 * HOUR, validationEnd: T0 + 20 * HOUR, finalTestEnd: T0 + 30 * HOUR };
    const straddle = validateSplitIntegrity(splits, HOUR, [cycle({ horizonMs: 6 * HOUR })], { c1: T0 + 12 * HOUR });
    expect(straddle.violations.join('|')).toMatch(/SPLIT_STRADDLE:c1/);
    const clean = validateSplitIntegrity(splits, HOUR, [cycle({ horizonMs: 2 * HOUR })], { c1: T0 + 2 * HOUR });
    expect(clean.violations).toEqual([]);
    expect(validateSplitIntegrity({ trainEnd: T0 + 20 * HOUR, validationEnd: T0 + 10 * HOUR, finalTestEnd: T0 + 30 * HOUR }, HOUR, []).violations)
      .toContain('SPLIT_ORDER_INVALID');
  });

  it('records the censored cycles it refuses to drop', () => {
    const splits = { trainEnd: T0 + 10 * HOUR, validationEnd: T0 + 20 * HOUR, finalTestEnd: T0 + 30 * HOUR };
    expect(validateSplitIntegrity(splits, HOUR, [cycle()], {}).censored).toEqual(['c1']);
  });
});

describe('S09-T07 cost honesty', () => {
  it('withholds the net figure when funding sign is unknown instead of assuming zero', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110)],
      { ...costs, fundingSign: 'UNKNOWN' }, human(60_000));
    expect(result.unresolvedCosts).toEqual(['FUNDING_SIGN_UNKNOWN']);
    expect(result.netPnlUsd).toBeNull();
    expect(result.status).toBe('CLOSED_TARGET');
  });

  it('keeps an in-bar ambiguity as a pessimistic number with an optimistic bound beside it', () => {
    const result = replayCycle(cycle(), [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-both', T0 + HOUR, 'BTCUSDT', 115, 85, 95)], costs, human(60_000));
    expect(result.intraBarAmbiguous).toBe(true);
    expect(result.status).toBe('CLOSED_LOSS_LINE');
    expect(result.optimisticNetUsd!).toBeGreaterThan(result.netPnlUsd!);
  });
});

describe('S09-T08 reproducibility', () => {
  const manifest = (): ExperimentManifest => {
    const groups = REQUIRED_ABLATION_GROUPS.map(id => ({ id, description: `group ${id}`, policy: id === 'C' ? 'simple-rule' : 'plan-policy',
      parameters: { id, horizonMs: 4 * HOUR }, configHash: '' }));
    return { schemaVersion: 'V396-EXPERIMENT-1', hypothesis: 'bounded review keeps net economics with fewer calls', frozenAt: T0,
      splits: { trainEnd: T0 + 100 * HOUR, validationEnd: T0 + 200 * HOUR, finalTestEnd: T0 + 300 * HOUR }, embargoMs: 4 * HOUR,
      universeRule: { asOf: 'AT_EVENT_TIME', listingSource: 'exchange-info@t0', exclusions: [], snapshotHash: 'uni_1' },
      missingDataRule: { maxGapMs: 5 * 60_000, treatUnknownAs: 'UNRESOLVED', dropCycle: false },
      groups, primaryMetric: { id: 'account_net_return_after_funding', formula: 'net/funding-adjusted', denominator: 'startEquityUsd',
        currencyUnit: 'USDT', timeGranularity: 'per-cycle' },
      secondaryMetrics: ['maxDrawdownPct', 'tailLossUsd', 'capitalUsageUsdSeconds', 'handoffBacklog'],
      riskBudget: { source: 'S05_PORTFOLIO_PROFILE', snapshotHash: 'v396r' + 'a'.repeat(64), maxCapitalAtRiskUsd: 200, maxStressLossUsd: 150 },
      thresholds: { nonInferiorityMarginPct: 5, minIndependentSamples: 30, minCoverageRatio: 0.9, acceptableExecutionModelErrorBps: 25, minimumTokenSavingPct: 30 },
      bootstrap: { method: 'stationary-block', blockLengthMs: 6 * HOUR, replicates: 2_000, intervalLevelPct: 95, seed: 20260922 },
      costModel: manifestCosts, humanResponseScenarios: [human(5 * 60_000, '5m'), human(HOUR, '1h'), human(8 * HOUR, '8h'), human(null, 'never')],
      tokenComparison: { frozenEventSetHash: null, baselineRows: 0, boundedRows: 0 },
      reproduction: { command: 'node scripts/v396-replay-report.mjs --manifest <id>', sourceCommit: 'a'.repeat(40), settingsHash: 'sha256:settings',
        promptSchemaVersion: 'V3.9.2', dataHashes: { 'stream:BTCUSDT': 'sha256:stream' } } };
  };

  it('freezes the identity over the content, so one changed parameter is a new experiment', () => {
    const sealed = sealExperimentManifest(manifest());
    expect(sealed.formal).toBe(true);
    expect(experimentIdOf(sealed)).toBe(sealed.experimentId);
    const moved = manifest();
    moved.groups[4].parameters.horizonMs = 8 * HOUR;
    expect(experimentIdOf(sealExperimentManifest(moved))).not.toBe(sealed.experimentId);
  });

  it('produces a byte-identical account on a re-run of the same frozen inputs', () => {
    const stream = [bar('b-open', T0, 'BTCUSDT', 101, 99, 100), bar('b-tp', T0 + HOUR, 'BTCUSDT', 111, 100, 110)];
    const run = () => JSON.stringify(replayScenario({ scenarioId: 'A', human: human(5 * 60_000), cycles: [cycle()], stream, costs, startEquityUsd: 1_000, asOf: T0 }));
    expect(run()).toBe(run());
  });

  it('rejects a manifest that is missing a control group, an embargo, or a risk budget source', () => {
    const noControl = manifest();
    noControl.groups = noControl.groups.filter(group => group.id !== 'C');
    expect(reviewExperimentManifest(noControl).refusals).toContain('ABLATION_GROUP_MISSING:C');
    const noEmbargo = manifest();
    noEmbargo.embargoMs = 0;
    expect(reviewExperimentManifest(noEmbargo).refusals).toContain('EMBARGO_MISSING');
    const borrowed = manifest();
    (borrowed.riskBudget as { source: string }).source = 'AFTER_THE_FACT';
    expect(reviewExperimentManifest(borrowed).refusals).toContain('RISK_BUDGET_NOT_FROM_ADMISSION_PROFILE');
    const dropped = manifest();
    dropped.missingDataRule.dropCycle = true;
    expect(reviewExperimentManifest(dropped).refusals).toContain('UNKNOWN_DATA_MAY_NOT_BE_DROPPED_SILENTLY');
    const instant = manifest();
    instant.humanResponseScenarios = [{ id: 'instant', responseMs: 0, description: 'assumes a human answers at once' }];
    expect(reviewExperimentManifest(instant).warnings).toContain('HUMAN_RESPONSE_ASSUMED_INSTANT');
    expect(sealExperimentManifest(instant).formal).toBe(false);
  });

  it('detects a stale group config hash rather than trusting the label', () => {
    const stale = manifest();
    stale.groups[0] = { ...stale.groups[0], parameters: { ...stale.groups[0].parameters, horizonMs: 9 * HOUR } };
    expect(reviewExperimentManifest(stale).refusals.join('|')).toMatch(/GROUP_CONFIG_HASH_STALE:A/);
    expect(configHashOf({ a: 1, b: 2 })).toBe(configHashOf({ b: 2, a: 1 }));
  });
});

describe('statistics refuse borrowed certainty', () => {
  const recipe = { blockLength: 3, replicates: 500, seed: 7 };

  it('is deterministic for a given seed', () => {
    const series = Array.from({ length: 40 }, (_, index) => Math.sin(index) + (index % 5) - 2);
    expect(stationaryBlockBootstrap(series, recipe)).toEqual(stationaryBlockBootstrap(series, recipe));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  it('calls an interval that crosses zero insufficient rather than positive', () => {
    const noisy = [-50, 40, -30, 25, -20, 15, -10, 5, -1, 0.5];
    const bootstrap = stationaryBlockBootstrap(noisy, recipe);
    expect(bootstrap.crossesZero).toBe(true);
    expect(bootstrap.intervalLow).toBeLessThan(0);
    expect(bootstrap.intervalHigh).toBeGreaterThan(0);
  });

  it('reports INSUFFICIENT_EVIDENCE when costs, coverage, samples or the control margin fall short', () => {
    const sealed = sealExperimentManifest({ schemaVersion: 'V396-EXPERIMENT-1', hypothesis: 'h', frozenAt: T0,
      splits: { trainEnd: T0 + 100 * HOUR, validationEnd: T0 + 200 * HOUR, finalTestEnd: T0 + 300 * HOUR }, embargoMs: 4 * HOUR,
      universeRule: { asOf: 'AT_EVENT_TIME', listingSource: 'x', exclusions: [], snapshotHash: 'u' },
      missingDataRule: { maxGapMs: 60_000, treatUnknownAs: 'UNRESOLVED', dropCycle: false },
      groups: REQUIRED_ABLATION_GROUPS.map(id => ({ id, description: id, policy: 'p', parameters: { id }, configHash: '' })),
      primaryMetric: { id: 'm', formula: 'f', denominator: 'd', currencyUnit: 'USDT', timeGranularity: 'per-cycle' },
      secondaryMetrics: [], riskBudget: { source: 'S05_PORTFOLIO_PROFILE', snapshotHash: 'v396r' + 'b'.repeat(64), maxCapitalAtRiskUsd: 1, maxStressLossUsd: 1 },
      thresholds: { nonInferiorityMarginPct: 5, minIndependentSamples: 30, minCoverageRatio: 0.9, acceptableExecutionModelErrorBps: 25, minimumTokenSavingPct: 30 },
      bootstrap: { method: 'stationary-block', blockLengthMs: HOUR, replicates: 1_000, intervalLevelPct: 95, seed: 3 },
      costModel: manifestCosts, humanResponseScenarios: [human(HOUR, '1h')],
      tokenComparison: { frozenEventSetHash: 'set_1', baselineRows: 10, boundedRows: 10 },
      reproduction: { command: 'c', sourceCommit: 's', settingsHash: 'h', promptSchemaVersion: 'V3.9.2', dataHashes: { a: 'b' } } });
    const account = { startEquityUsd: 1_000, finalEquityUsd: 1_000, accountNetReturnPct: null, realisedNetUsd: null, unresolvedCycles: 0,
      maxDrawdownPct: null, tailLossUsd: null, capitalUsageUsdSeconds: 0, openAgeMsP95: null, handoffBacklog: 0, exitSlippageBpsAvg: null,
      modelCostMsTotal: 0, cycles: 0, resolvedCycles: 0, censoredCycles: 0, coverageRatio: 0.5, costsComplete: false };
    const groups = REQUIRED_ABLATION_GROUPS.map(id => ({ id, reported: id !== 'E', samples: 5, account }));
    const bootstrap = stationaryBlockBootstrap([1, 2, -1, 3, -2, 4], recipe);
    const review = reviewExperimentEvidence({ manifest: sealed, groups, primarySeries: [1, 2], controlSeries: [1, 1],
      bootstrap, advantage: pairedAdvantage([2], [1], recipe), invariantsHeld: true, leakageEvents: 0, tokenComparison: { status: 'NOT_MEASURED', savingPct: null } });
    expect(review.engineering).toBe('FAIL');
    expect(review.reasons).toContain('GROUPS_NOT_REPORTED:E');
    expect(review.reasons).toContain('COSTS_INCOMPLETE:A,B,C,D,E,E-minus-memory');
    expect(review.reasons.join('|')).toMatch(/INSUFFICIENT_SAMPLES:2<30/);
    expect(review.status).toBe('INSUFFICIENT_EVIDENCE');

    const leaked = reviewExperimentEvidence({ ...{ manifest: sealed, groups, bootstrap }, primarySeries: [1, 2], controlSeries: [1, 1],
      advantage: pairedAdvantage([2], [1], recipe), invariantsHeld: true, leakageEvents: 2, tokenComparison: { status: 'NOT_MEASURED', savingPct: null } });
    expect(leaked.status).toBe('FAIL');
    expect(leaked.reasons.join('|')).toMatch(/FUTURE_DATA_LEAKAGE:2/);
  });

  it('will not annualise a two-sample series into a Sharpe-like claim', () => {
    expect(annualisedRatio([1], HOUR)).toMatchObject({ value: null });
    const ratio = annualisedRatio([1, 2, -1, 3], HOUR);
    expect(ratio.caveats).toContain('SHORT_WINDOW_ANNUALISATION_IS_NOT_A_FORECAST');
    expect(ratio.value).not.toBeNull();
  });
});

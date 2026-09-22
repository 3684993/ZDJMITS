import type { ReplayAccount } from './s09ReplayEngine.js';
import type { ExperimentManifest } from './s09ExperimentManifest.js';

/**
 * S09: the statistics that decide whether a replay result may be said to mean anything.
 *
 * Trading outcomes are serially correlated, so an ordinary bootstrap over individual trades pretends a
 * cluster of related fills is several independent observations. This uses a stationary block bootstrap
 * with the block length fixed in the preregistered manifest, and reports a percentile interval. The
 * verdict function is deliberately pessimistic: an interval that crosses zero, an incomplete cost
 * model, or too few independent samples all land on INSUFFICIENT_EVIDENCE rather than on a pass,
 * because "we cannot tell yet" is a usable sentence and a borrowed certainty is not.
 */

export type Verdict = 'ENGINEERING_PASS' | 'ECONOMIC_SUPPORTED' | 'INSUFFICIENT_EVIDENCE' | 'FAIL';

/** Deterministic 32-bit PRNG: the same seed must give the same interval on another machine. */
export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type BlockBootstrap = { mean: number; intervalLow: number; intervalHigh: number; replicates: number; blockLengthMs: number; crossesZero: boolean };

/**
 * Resamples blocks of the ordered series rather than single points, so a burst of correlated trades
 * moves the interval the way it moves the account.
 */
export function stationaryBlockBootstrap(series: number[], options: { blockLength: number; replicates: number; seed: number; levelPct?: number }): BlockBootstrap {
  const values = series.filter(value => Number.isFinite(value));
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  if (values.length < 2) return { mean, intervalLow: mean, intervalHigh: mean, replicates: 0, blockLengthMs: options.blockLength, crossesZero: true };
  const random = mulberry32(options.seed);
  const blockLength = Math.max(1, Math.min(values.length, Math.trunc(options.blockLength)));
  const level = options.levelPct ?? 95;
  const statistics: number[] = [];
  for (let replicate = 0; replicate < options.replicates; replicate++) {
    let sampled = 0, total = 0;
    while (sampled < values.length) {
      // Geometric block length keeps the series stationary instead of chopping it into fixed grids.
      const p = blockLength / values.length;
      const length = 1 + Math.floor(Math.log(1 - random()) / Math.log(1 - Math.min(0.999, Math.max(0.001, p))));
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < length && sampled < values.length; offset++, sampled++)
        total += values[(start + offset) % values.length];
    }
    statistics.push(total / sampled);
  }
  statistics.sort((a, b) => a - b);
  const tail = (100 - level) / 200;
  const at = (quantile: number) => statistics[Math.min(statistics.length - 1, Math.max(0, Math.floor(quantile * statistics.length)))];
  const intervalLow = at(tail), intervalHigh = at(1 - tail);
  return { mean, intervalLow, intervalHigh, replicates: options.replicates, blockLengthMs: blockLength, crossesZero: intervalLow <= 0 && intervalHigh >= 0 };
}

/** Paired difference against the pre-registered control, on the same frozen event stream. */
export function pairedAdvantage(treatment: number[], control: number[], options: { blockLength: number; replicates: number; seed: number; levelPct?: number }) {
  const length = Math.min(treatment.length, control.length);
  const differences: number[] = [];
  for (let index = 0; index < length; index++) differences.push(Number(treatment[index]) - Number(control[index]));
  const bootstrap = stationaryBlockBootstrap(differences, options);
  const meanTreatment = treatment.slice(0, length).reduce((sum, value) => sum + value, 0) / Math.max(1, length);
  const meanControl = control.slice(0, length).reduce((sum, value) => sum + value, 0) / Math.max(1, length);
  return { ...bootstrap, pairs: length, meanTreatment, meanControl,
    relativePct: meanControl === 0 ? null : (meanTreatment - meanControl) / Math.abs(meanControl) * 100 };
}

export type EvidenceReview = { status: Verdict; engineering: 'PASS' | 'FAIL'; reasons: string[]; detail: Record<string, unknown> };

/**
 * What the verdict function is allowed to say.
 *
 * `ECONOMIC_SUPPORTED` requires the interval to exclude zero, the control advantage to clear the
 * preregistered non-inferiority margin, complete costs, enough independent samples, and every
 * preregistered group reported. Anything weaker is either an engineering statement or no statement.
 */
export function reviewExperimentEvidence(input: {
  manifest: ExperimentManifest;
  groups: Array<{ id: string; reported: boolean; samples: number; account: ReplayAccount }>;
  primarySeries: number[];
  controlSeries: number[];
  bootstrap: BlockBootstrap;
  advantage: ReturnType<typeof pairedAdvantage>;
  invariantsHeld: boolean;
  leakageEvents: number;
  tokenComparison: { status: string; savingPct: number | null };
}): EvidenceReview {
  const reasons: string[] = [];
  const { manifest } = input;
  const thresholds = manifest.thresholds;
  if (!manifest.formal) reasons.push('MANIFEST_NOT_FORMAL:预注册缺项，只能作为探索结果');
  if (!input.invariantsHeld) reasons.push('HARD_INVARIANT_BROKEN');
  if (input.leakageEvents > 0) reasons.push(`FUTURE_DATA_LEAKAGE:${input.leakageEvents}`);
  const missingGroups = input.groups.filter(group => !group.reported).map(group => group.id);
  if (missingGroups.length) reasons.push(`GROUPS_NOT_REPORTED:${missingGroups.join(',')}`);
  const incompleteCosts = input.groups.filter(group => !group.account.costsComplete).map(group => group.id);
  if (incompleteCosts.length) reasons.push(`COSTS_INCOMPLETE:${incompleteCosts.join(',')}`);
  if (thresholds.minIndependentSamples != null && input.primarySeries.length < thresholds.minIndependentSamples)
    reasons.push(`INSUFFICIENT_SAMPLES:${input.primarySeries.length}<${thresholds.minIndependentSamples}`);
  const coverage = input.groups.length ? Math.min(...input.groups.map(group => group.account.coverageRatio)) : 0;
  if (thresholds.minCoverageRatio != null && coverage < thresholds.minCoverageRatio)
    reasons.push(`COVERAGE_BELOW_FLOOR:${Math.round(coverage * 100)}%<${Math.round(thresholds.minCoverageRatio * 100)}%`);
  if (input.bootstrap.crossesZero) reasons.push('INTERVAL_CROSSES_ZERO');
  const margin = thresholds.nonInferiorityMarginPct;
  const advantage = input.advantage.relativePct;
  if (margin != null && (advantage == null || advantage < margin)) reasons.push(`NON_INFERIORITY_NOT_MET:${advantage == null ? 'unreportable' : Math.round(advantage * 100) / 100}<${margin}`);
  if (input.tokenComparison.status === 'FAIL') reasons.push(`TOKEN_BUDGET_NOT_MET:${String(input.tokenComparison.savingPct)}%`);

  const engineering = input.invariantsHeld && input.leakageEvents === 0 && !missingGroups.length ? 'PASS' : 'FAIL';
  const blocking = reasons.filter(reason => !reason.startsWith('MANIFEST_NOT_FORMAL') && !reason.startsWith('TOKEN_BUDGET'));
  const status: Verdict = blocking.some(reason => reason.startsWith('HARD_INVARIANT') || reason.startsWith('FUTURE_DATA_LEAKAGE')) ? 'FAIL'
    : (blocking.length || !manifest.formal) ? 'INSUFFICIENT_EVIDENCE' : 'ECONOMIC_SUPPORTED';
  return { status, engineering, reasons, detail: { coverageRatio: coverage, bootstrap: input.bootstrap, advantage: input.advantage,
    samples: input.primarySeries.length, formal: manifest.formal === true, tokenComparison: input.tokenComparison } };
}

/** A Sharpe-like number may only be quoted with the sampling caveats attached, never as a forecast. */
export function annualisedRatio(series: number[], perSampleMs: number) {
  const values = series.filter(value => Number.isFinite(value));
  if (values.length < 2) return { value: null, caveats: ['NOT_COMPUTABLE_FEWER_THAN_TWO_SAMPLES'] };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  const perYear = deviation === 0 || perSampleMs <= 0 ? 0 : mean / deviation * Math.sqrt(365 * 86_400_000 / perSampleMs);
  return { value: Math.round(perYear * 1000) / 1000, caveats: ['AUTOCORRELATION_NOT_REMOVED', 'SHORT_WINDOW_ANNUALISATION_IS_NOT_A_FORECAST',
    'RESIDUAL_SAMPLING_USES_BLOCK_BOOTSTRAP_NOT_IID_TRADES'] };
}

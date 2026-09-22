import { createHash } from 'node:crypto';

/**
 * S09: the preregistration record.
 *
 * Everything that could be tuned after seeing the test set is fixed here instead: the split dates, the
 * embargo, the universe rule, the ablation groups, the primary metric and its denominator, the risk
 * budget taken from S05, and the bootstrap recipe. A run without these numbers may explore, and the
 * validator says so out loud - it cannot be reported as a formal pass, because a threshold chosen
 * after the result is not a threshold.
 */

export const EXPERIMENT_MANIFEST_SCHEMA = 'V396-EXPERIMENT-1' as const;
export const REQUIRED_ABLATION_GROUPS = ['A', 'B', 'C', 'D', 'E', 'E-minus-memory'] as const;
export type AblationGroupId = (typeof REQUIRED_ABLATION_GROUPS)[number];

export type ExperimentManifest = {
  schemaVersion: typeof EXPERIMENT_MANIFEST_SCHEMA;
  experimentId?: string;
  hypothesis: string;
  frozenAt: number;
  /** Data is only visible after its own availableAt; these boundaries decide which role a bar plays. */
  splits: { trainEnd: number; validationEnd: number; finalTestEnd: number };
  /** At least the longest evaluated holding window, so one trade never appears on both sides. */
  embargoMs: number;
  universeRule: { asOf: 'AT_EVENT_TIME'; listingSource: string; exclusions: string[]; snapshotHash: string };
  missingDataRule: { maxGapMs: number; treatUnknownAs: 'UNRESOLVED'; dropCycle: boolean };
  groups: Array<{ id: AblationGroupId; description: string; policy: string; parameters: Record<string, unknown>; configHash: string }>;
  primaryMetric: { id: string; formula: string; denominator: string; currencyUnit: string; timeGranularity: string };
  secondaryMetrics: string[];
  /** From the S05 portfolio profile: a budget raised after the test is not a budget. */
  riskBudget: { source: 'S05_PORTFOLIO_PROFILE'; snapshotHash: string; maxCapitalAtRiskUsd: number; maxStressLossUsd: number };
  thresholds: {
    nonInferiorityMarginPct: number | null;
    minIndependentSamples: number | null;
    minCoverageRatio: number | null;
    acceptableExecutionModelErrorBps: number | null;
    minimumTokenSavingPct: number | null;
  };
  bootstrap: { method: 'stationary-block'; blockLengthMs: number; replicates: number; intervalLevelPct: number; seed: number };
  costModel: { makerRate: number; takerRate: number; fundingSource: string; slippageSource: string; modelLatencyMs: number; ackLossModelled: boolean };
  humanResponseScenarios: Array<{ id: string; responseMs: number | null; description: string }>;
  tokenComparison: { frozenEventSetHash: string | null; baselineRows: number; boundedRows: number };
  reproduction: { command: string; sourceCommit: string; settingsHash: string; promptSchemaVersion: string; dataHashes: Record<string, string> };
  /** True when the run may be reported as a formal result at all. */
  formal?: boolean;
};

const canonical = (value: unknown): string => JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(entryKey => [entryKey, (item as Record<string, unknown>)[entryKey]]))
    : item);

export function experimentIdOf(manifest: ExperimentManifest): string {
  const { experimentId: _ignored, formal: _alsoIgnored, ...rest } = manifest;
  return `exp_${createHash('sha256').update(canonical(rest)).digest('hex').slice(0, 32)}`;
}

export function configHashOf(parameters: Record<string, unknown>): string {
  return `cfg_${createHash('sha256').update(canonical(parameters)).digest('hex').slice(0, 24)}`;
}

export type ManifestReview = { formal: boolean; refusals: string[]; warnings: string[] };

/**
 * Which warnings still bar a formal verdict. A missing pre-registered number would be chosen after the
 * result, and an assumed-instant human answer overstates the account, so both stay blocking. An
 * unmeasured token comparison is different: NOT_MEASURED is a reported state, not a borrowed number,
 * so it is disclosed rather than used to invalidate the whole experiment.
 */
const FORMALLY_BLOCKING = /^THRESHOLD_NOT_PREREGISTERED|^HUMAN_RESPONSE_ASSUMED_INSTANT/;

/**
 * What makes a manifest reportable. Refusals are things that would let a number look like evidence:
 * a missing threshold, an absent control group, a split that lets a trade straddle two sets, or a
 * risk budget that is not the one admission control actually used.
 */
export function reviewExperimentManifest(manifest: ExperimentManifest): ManifestReview {
  const refusals: string[] = [], warnings: string[] = [];
  if (manifest.schemaVersion !== EXPERIMENT_MANIFEST_SCHEMA) refusals.push(`MANIFEST_SCHEMA_UNSUPPORTED:${String(manifest.schemaVersion)}`);
  const { trainEnd, validationEnd, finalTestEnd } = manifest.splits ?? ({} as never);
  if (!(trainEnd > 0 && validationEnd > trainEnd && finalTestEnd > validationEnd)) refusals.push('SPLIT_ORDER_INVALID');
  const longestHoldingMs = Math.max(0, ...manifest.groups.map(group => Number(group.parameters?.horizonMs ?? 0)));
  if (!(manifest.embargoMs > 0)) refusals.push('EMBARGO_MISSING');
  else if (longestHoldingMs > 0 && manifest.embargoMs < longestHoldingMs) refusals.push(`EMBARGO_SHORTER_THAN_HOLDING:${manifest.embargoMs}<${longestHoldingMs}`);
  if (manifest.universeRule?.asOf !== 'AT_EVENT_TIME') refusals.push('UNIVERSE_NOT_TIME_FROZEN');
  if (!manifest.universeRule.snapshotHash) refusals.push('UNIVERSE_SNAPSHOT_UNPROVEN');
  if (manifest.missingDataRule?.treatUnknownAs !== 'UNRESOLVED' || manifest.missingDataRule.dropCycle !== false)
    refusals.push('UNKNOWN_DATA_MAY_NOT_BE_DROPPED_SILENTLY');
  const present = new Set(manifest.groups.map(group => group.id));
  for (const group of REQUIRED_ABLATION_GROUPS) if (!present.has(group)) refusals.push(`ABLATION_GROUP_MISSING:${group}`);
  for (const group of manifest.groups) {
    if (!group.description) refusals.push(`GROUP_DESCRIPTION_MISSING:${group.id}`);
    if (group.configHash !== configHashOf(group.parameters)) refusals.push(`GROUP_CONFIG_HASH_STALE:${group.id}`);
  }
  const thresholds = manifest.thresholds ?? ({} as never);
  for (const key of ['nonInferiorityMarginPct', 'minIndependentSamples', 'minCoverageRatio', 'acceptableExecutionModelErrorBps'] as const)
    if (thresholds[key] === null || thresholds[key] === undefined) warnings.push(`THRESHOLD_NOT_PREREGISTERED:${key}`);
  if (!manifest.primaryMetric?.formula || !manifest.primaryMetric?.denominator) refusals.push('PRIMARY_METRIC_INCOMPLETE');
  if (manifest.riskBudget?.source !== 'S05_PORTFOLIO_PROFILE' || !manifest.riskBudget.snapshotHash) refusals.push('RISK_BUDGET_NOT_FROM_ADMISSION_PROFILE');
  if (manifest.bootstrap?.method !== 'stationary-block' || !(manifest.bootstrap.replicates >= 1000) || !(manifest.bootstrap.blockLengthMs > 0)
    || manifest.bootstrap.intervalLevelPct !== 95) refusals.push('BOOTSTRAP_RECIPE_INCOMPLETE');
  if (manifest.costModel?.fundingSource === 'NONE' || manifest.costModel?.slippageSource === 'NONE') refusals.push('COST_MODEL_INCOMPLETE');
  if (manifest.costModel && manifest.costModel.modelLatencyMs <= 0) refusals.push('MODEL_LATENCY_MUST_NOT_BE_ZERO');
  if (!manifest.humanResponseScenarios?.length) refusals.push('HUMAN_RESPONSE_SCENARIOS_MISSING');
  if (manifest.humanResponseScenarios.some(scenario => scenario.responseMs === 0)) warnings.push('HUMAN_RESPONSE_ASSUMED_INSTANT');
  if (!manifest.reproduction?.command || !manifest.reproduction.sourceCommit) refusals.push('REPRODUCTION_COMMAND_MISSING');
  if (!Object.keys(manifest.reproduction?.dataHashes ?? {}).length) refusals.push('INPUT_DATA_NOT_HASHED');
  if (manifest.tokenComparison && !manifest.tokenComparison.frozenEventSetHash) warnings.push('TOKEN_COMPARISON_NOT_MEASURED');
  return { formal: refusals.length === 0 && !warnings.some(warning => FORMALLY_BLOCKING.test(warning)), refusals, warnings };
}

/** Freezes a manifest: derives every group hash, then the identity and the formal flag from them. */
export function sealExperimentManifest(manifest: ExperimentManifest): ExperimentManifest {
  const body: ExperimentManifest = { ...manifest,
    groups: manifest.groups.map(group => ({ ...group, configHash: configHashOf(group.parameters) })) };
  const review = reviewExperimentManifest(body);
  return { ...body, experimentId: experimentIdOf(body), formal: review.formal };
}

export function assertManifestReproducible(manifest: ExperimentManifest, delivered: ExperimentManifest) {
  if (!manifest.experimentId || delivered.experimentId !== manifest.experimentId)
    throw new Error(`EXPERIMENT_IDENTITY_CHANGED:${String(manifest.experimentId)}!=${String(delivered.experimentId)}`);
  if (canonical(manifest) !== canonical(delivered)) throw new Error(`EXPERIMENT_CONTENT_DRIFTED:${manifest.experimentId}`);
  return true;
}

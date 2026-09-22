import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * S09: reading a frozen replay bundle, and the shape of a report before anything is measured.
 *
 * The bundle is the only place a replay gets its numbers from, so every field it carries is checked
 * against the hash recorded next to it: a stream that was quietly edited after the manifest was sealed
 * is a different experiment, and saying so is the whole point of freezing `availableAt` in the first
 * place.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256Of = contents => createHash('sha256').update(contents).digest('hex');

export function loadReplayBundle(file) {
  const bundle = JSON.parse(readFileSync(file, 'utf8'));
  if (bundle.schemaVersion !== 'V396-REPLAY-BUNDLE-1') throw new Error(`REPLAY_BUNDLE_SCHEMA_UNSUPPORTED:${String(bundle.schemaVersion)}`);
  if (!Array.isArray(bundle.events) || !bundle.events.length) throw new Error('REPLAY_BUNDLE_HAS_NO_EVENTS');
  if (!Array.isArray(bundle.cycles) || !bundle.cycles.length) throw new Error('REPLAY_BUNDLE_HAS_NO_CYCLES');
  for (const event of bundle.events) {
    if (!event.id || !Number.isFinite(Number(event.availableAt)) || !event.symbol) throw new Error(`REPLAY_EVENT_INCOMPLETE:${String(event.id)}`);
    if (Number(event.availableAt) < Number(event.occurredAt ?? event.availableAt)) throw new Error(`REPLAY_EVENT_TIME_TRAVEL:${event.id}`);
  }
  for (const cycle of bundle.cycles)
    if (!Array.isArray(cycle.groups) || !cycle.groups.length) throw new Error(`REPLAY_CYCLE_HAS_NO_GROUPS:${cycle.cycleId}`);
  const dataHashes = Object.fromEntries(Object.entries(bundle.files ?? {}).map(([name, contents]) => [name, sha256Of(String(contents))]));
  const declared = bundle.dataHashes ?? {};
  for (const [name, hash] of Object.entries(declared))
    if (dataHashes[name] && dataHashes[name] !== hash) throw new Error(`REPLAY_INPUT_HASH_MISMATCH:${name}`);
  return {
    events: bundle.events, costs: bundle.costs, startEquityUsd: Number(bundle.startEquityUsd), asOf: Number(bundle.asOf),
    dataHashes: { ...dataHashes, ...declared },
    cycles: bundle.cycles.map(cycle => ({ ...cycle, entryEvidenceIds: cycle.entryEvidenceIds ?? [] })),
  };
}

/** The parts of a report that are known before a run: identity, thresholds, and what was not measured. */
export function reportSkeleton(manifest) {
  return {
    schemaVersion: 'V396-EXPERIMENT-REPORT-1',
    experimentId: manifest.experimentId ?? null,
    formal: manifest.formal === true,
    hypothesis: manifest.hypothesis,
    manifest,
    thresholds: manifest.thresholds,
    requiredGroups: manifest.groups.map(group => group.id),
    notMeasured: [
      { item: 'out_of_sample_economics', status: 'NOT_RUN', reason: '需要授权后的冻结事件流与真实账户会计。' },
      { item: 'tokenSavingRatio', status: 'NOT_MEASURED', reason: '缺少同一冻结事件集两侧完整 usage。' },
      { item: 'migration_canary_soak', status: 'PENDING_WINDOW_INCOMPLETE', reason: '运行窗口未开始，不以离线结果冒充。' },
    ],
    reproduction: manifest.reproduction,
    generatedBy: 'scripts/v396-replay-report.mjs',
  };
}

/** One row per human-response scenario, so the report cannot keep only the flattering assumption. */
export function humanSeriesOf(results) {
  const byScenario = new Map();
  for (const row of results) {
    const bucket = byScenario.get(row.humanScenario) ?? { scenario: row.humanScenario, groups: {}, incomplete: 0 };
    bucket.groups[row.group] = row.primaryMetricPct;
    if (row.primaryMetricPct == null) bucket.incomplete++;
    byScenario.set(row.humanScenario, bucket);
  }
  return [...byScenario.values()].sort((a, b) => a.scenario.localeCompare(b.scenario));
}

export const resolveFromRoot = relative => path.resolve(root, relative);

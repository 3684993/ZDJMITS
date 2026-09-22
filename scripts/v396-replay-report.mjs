#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayScenario, detectFutureAvailabilityViolation, validateSplitIntegrity } from '../apps/engine/dist/services/s09ReplayEngine.js';
import { humanSeriesOf, loadReplayBundle, reportSkeleton } from './v396-replay-bundle.mjs';

/**
 * S09: the result generator.
 *
 * It runs every preregistered ablation group against every pre-registered human-response scenario over
 * one frozen event stream, and it writes what comes out - including the groups that lost and the
 * measurements it could not make. The refusal paths are the important part: without a data bundle on
 * disk it writes NOT_RUN and the command that would produce it, and it never lets an exploratory
 * manifest print a formal verdict.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const manifestPath = path.resolve(root, arg('manifest', 'docs/evidence/v396/final-convergence-20260922/J6/experiment-manifest.json'));
const bundlePath = arg('bundle', 'docs/evidence/v396/final-convergence-20260922/J6/replay-bundle.json');
const outPath = path.resolve(root, arg('out', 'docs/evidence/v396/final-convergence-20260922/J6/experiment-report.json'));

if (!existsSync(manifestPath)) throw new Error(`EXPERIMENT_MANIFEST_MISSING:${path.relative(root, manifestPath)}`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const bundle = existsSync(path.resolve(root, bundlePath)) ? loadReplayBundle(path.resolve(root, bundlePath)) : null;

const report = reportSkeleton(manifest);
if (!bundle) {
  // No frozen stream on disk means nothing was measured. Say that, print the command, and stop.
  console.error(`REPLAY_INPUT_BUNDLE_MISSING:${bundlePath}`);
  writeFileSync(outPath, JSON.stringify({ ...report, runStatus: 'NOT_RUN',
    reason: '没有冻结的事件流输入；未生成任何数值，也不得据此声称经济结论。',
    reproduceWith: `node scripts/v396-replay-report.mjs --manifest ${path.relative(root, manifestPath)} --bundle <frozen-bundle.json>` }, null, 2) + '\n');
  process.exit(2);
}

const leakage = detectFutureAvailabilityViolation(bundle.cycles, bundle.events);
const splits = validateSplitIntegrity(manifest.splits, manifest.embargoMs, bundle.cycles,
  Object.fromEntries(bundle.cycles.map(cycle => [cycle.cycleId, null])));
const results = [];
for (const group of manifest.groups) {
  for (const scenario of manifest.humanResponseScenarios) {
    const cycles = bundle.cycles.filter(cycle => cycle.groups.includes(group.id));
    const replay = replayScenario({ scenarioId: group.id, human: scenario, cycles, stream: bundle.events, costs: bundle.costs,
      startEquityUsd: bundle.startEquityUsd, asOf: bundle.asOf });
    results.push({ group: group.id, configHash: group.configHash, humanScenario: scenario.id, samples: replay.account.cycles,
      primaryMetricPct: replay.account.accountNetReturnPct, account: replay.account, invariants: replay.invariants,
      reported: true });
  }
}
const primary = results.filter(row => row.group === 'E');
const control = results.filter(row => row.group === 'A');
console.error(`[replay] groups=${new Set(results.map(row => row.group)).size} runs=${results.length} leakage=${leakage.violations.length} straddle=${splits.violations.length}`);
writeFileSync(outPath, JSON.stringify({ ...report, runStatus: leakage.violations.length ? 'FAIL' : 'COMPLETED_OFFLINE_SYNTHETIC',
  dataHashes: bundle.dataHashes, leakageViolations: leakage.violations, splitViolations: splits.violations,
  results, primarySeries: primary.map(row => row.primaryMetricPct).filter(value => value != null),
  controlSeries: control.map(row => row.primaryMetricPct).filter(value => value != null),
  humanSeries: humanSeriesOf(results), formal: manifest.formal === true, tokenComparison: { status: 'NOT_MEASURED', savingPct: null,
    reason: '需要授权后的真实 usage 对照；本轮保持 NOT_MEASURED。' } }, null, 2) + '\n');
if (!existsSync(path.dirname(outPath))) mkdirSync(path.dirname(outPath), { recursive: true });
console.error(`REPLAY_REPORT_WRITTEN ${path.relative(root, outPath)}`);

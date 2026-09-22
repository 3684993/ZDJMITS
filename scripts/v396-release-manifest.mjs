#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * S10: the release manifest.
 *
 * It pins what a build actually contained - source commit, per-file hashes, settings defaults, prompt
 * and fact schema versions, the sealed experiment manifests and the offline evidence - and it states
 * the run-stage items as NOT_RUN rather than leaving them implicit. It records an identity; it does not
 * grant one: nothing here says the release is accepted, deployable or profitable.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.resolve(root, process.argv.find(argument => argument.startsWith('--out='))?.slice('--out='.length)
  ?? 'docs/evidence/v396/final-convergence-20260922/J6/release-manifest.json');
const sha256 = file => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const relative = file => path.relative(root, file).replace(/\\/g, '/');

const contractVersion = readFileSync(path.join(root, 'packages/contracts/src/version.ts'), 'utf8');
const releaseVersion = contractVersion.match(/RELEASE_VERSION\s*=\s*"([^"]+)"/)[1];
const apiVersion = contractVersion.match(/API_VERSION\s*=\s*"([^"]+)"/)[1];
const promptSchemaVersion = contractVersion.match(/PROMPT_SCHEMA_VERSION\s*=\s*"([^"]+)"/)[1];
const factSchemaVersion = contractVersion.match(/FACT_SCHEMA_VERSION\s*=\s*"([^"]+)"/)[1];
const packageVersions = ['package.json', 'packages/contracts/package.json', 'packages/core/package.json', 'apps/engine/package.json', 'apps/dashboard/package.json']
  .map(file => ({ file, version: JSON.parse(readFileSync(path.join(root, file), 'utf8')).version }));
if (new Set(packageVersions.map(entry => entry.version)).size !== 1 || packageVersions[0].version !== releaseVersion)
  throw new Error(`PACKAGE_RELEASE_IDENTITY_MISMATCH:${packageVersions.map(entry => `${entry.file}=${entry.version}`).join(',')}`);

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const worktreeClean = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length === 0;
/** `--is-ancestor` reports through its exit code; git prints nothing either way. */
function containsCommit(sha) {
  try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, encoding: 'utf8' }); return true; } catch { return false; }
}

/** Everything a reviewer needs to recompute a claim, and nothing that is merely adjacent. */
const IMPORTANT = [
  'config/settings.default.json',
  'packages/contracts/src/version.ts', 'packages/contracts/src/riskGovernance.ts', 'packages/contracts/src/tradePlan.ts',
  'packages/contracts/src/trading.ts', 'packages/contracts/src/ai.ts',
  'packages/core/src/tradingCost.ts', 'packages/core/src/compactEntry.ts',
  'apps/engine/src/config/governanceSettingsMatrix.ts', 'apps/engine/src/services/s03AiExitPolicy.ts',
  'apps/engine/src/services/s09ReplayEngine.ts', 'apps/engine/src/services/s09Statistics.ts', 'apps/engine/src/services/s09ExperimentManifest.ts',
  'apps/engine/src/services/positionReviewScheduler.ts', 'apps/engine/src/services/positionReviewRunner.ts',
  'apps/engine/src/services/aiUsageLedger.ts', 'apps/engine/src/services/tradeMemoryRetriever.ts',
  'apps/engine/src/services/ownershipJournal.ts', 'apps/engine/src/services/v396ExitRuntime.ts',
  'apps/engine/src/services/portfolioRiskLedger.ts', 'apps/engine/src/services/tradePlanService.ts',
  'apps/engine/src/state/runtimeState.ts', 'apps/engine/src/api/runtimeSettingsResources.ts',
  'scripts/durable-storage-inventory.mjs', 'scripts/v396-storage-coverage.mjs', 'scripts/v396-replay-bundle.mjs', 'scripts/v396-replay-report.mjs',
];
const evidenceFiles = ['docs/evidence/v396/final-convergence-20260922/J1', 'J2', 'J3', 'J4', 'J5', 'J6']
  .flatMap(group => ['RESULT.md', 'manifest.json', 'storage-coverage.json', 'experiment-manifest.json', 'experiment-report.json', 'release-manifest.json']
    .map(file => `docs/evidence/v396/final-convergence-20260922/${group}/${file}`))
  .filter(file => existsSync(path.join(root, file)) && !outPath.endsWith(path.basename(file)));
const experimentManifests = evidenceFiles.filter(file => file.endsWith('experiment-manifest.json'))
  .map(file => { const parsed = JSON.parse(readFileSync(path.join(root, file), 'utf8')); return { file, experimentId: parsed.experimentId ?? null, formal: parsed.formal === true }; });

const manifest = {
  schemaVersion: 'V396-RELEASE-MANIFEST-1',
  releaseVersion, apiVersion, promptSchemaVersion, factSchemaVersion,
  packageVersions, generatedAt: new Date().toISOString(),
  source: { commit: sourceCommit, branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    worktreeClean, historyContainsBaseline: containsCommit('51e7e1e5af06510a95bca3f075da94ececd2b06c'),
    baselineCommit: '51e7e1e5af06510a95bca3f075da94ececd2b06c' },
  settingsDefault: { file: 'config/settings.default.json', sha256: sha256(path.join(root, 'config/settings.default.json')) },
  files: Object.fromEntries([...IMPORTANT, ...evidenceFiles].map(file => [file, sha256(path.join(root, file))])),
  experiments: experimentManifests,
  storageCoverage: (() => {
    const file = path.join(root, 'docs/evidence/v396/final-convergence-20260922/J5/storage-coverage.json');
    const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    return { gate: report?.gate ?? 'MISSING', blockingFiles: report?.blockingFiles ?? ['UNKNOWN'] };
  })(),
  build: { contractsTestsCases: 0, note: 'contracts 包当前 0 用例，不作为契约覆盖。' },
  /** Everything that needs an explicit run authorisation, stated rather than implied. */
  runStageItems: [
    { item: 'isolated_migration_preview_migrate_readback_restore', status: 'NOT_RUN', requires: '隔离临时库可执行；本轮已给出清单与模板' },
    { item: 'live_database_migration', status: 'NOT_RUN', requires: '明确的运行授权' },
    { item: 'canary_shadow_window', status: 'NOT_RUN', requires: 'Engine 生命周期授权' },
    { item: 'testnet_write_round', status: 'NOT_RUN', requires: '交易所写接口授权' },
    { item: '24h_soak', status: 'PENDING_WINDOW_INCOMPLETE', requires: '连续 24 小时运行窗口' },
    { item: 'out_of_sample_replay_on_real_stream', status: 'NOT_RUN', requires: '冻结事件流与真实账户会计' },
    { item: 'token_saving_comparison', status: 'NOT_MEASURED', requires: '同一冻结事件集两侧完整 usage' },
  ],
  /** What this document is not. */
  claims: { accepted: false, profitable: false, deployAuthorised: false, liveWriteAuthorised: false },
  state: 'READY_FOR_TESTNET_AUTHORIZATION',
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.error(`RELEASE_MANIFEST_WRITTEN ${relative(outPath)} release=${releaseVersion} files=${Object.keys(manifest.files).length} sourceClean=${worktreeClean}`);

// Normalises this round's evidence text (LF, no trailing blanks) and indexes it with sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'docs/evidence/v396/pending-risk-occupancy-convergence-20260923';
const walk = base => readdirSync(base).flatMap(name => {
  const full = join(base, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

for (const file of walk(dir).filter(f => !/\.(png|jpg|jpeg|gif|zip|wasm)$/.test(f))) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '') + '\n';
  if (text !== readFileSync(file, 'utf8')) writeFileSync(file, text);
}

const files = execFileSync('git', ['ls-files', '-o', '--exclude-standard', dir], {encoding: 'utf8'})
  .split(/\r?\n/).filter(Boolean).filter(f => !f.endsWith('evidence-index.json') && !f.endsWith('index-evidence.mjs')).sort();
const entries = files.map(path => {
  const bytes = readFileSync(path);
  const body = /\.(png|jpg|jpeg|gif|zip|wasm)$/.test(path) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n');
  return {path, bytes: bytes.length, sha256: createHash('sha256').update(body).digest('hex')};
});

writeFileSync(`${dir}/evidence-index.json`, JSON.stringify({
  round: 'v396-pending-risk-occupancy-convergence',
  date: '2026-09-23',
  plan: 'docs/plans/v396/CODEX-V396-PENDING-RISK-OCCUPANCY-CONVERGENCE-20260923.md',
  report: 'docs/reports/v396-pending-risk-occupancy-convergence-20260923.md',
  branch: 'codex/v396-final-convergence-20260922',
  baselineHead: '0c87cf2 (docs-only commit above 32feb03; product source unchanged since the deployed e284a1a)',
  verdict: 'PATCHED OFFLINE AND GATED GREEN — PortfolioRisk no longer decides entry occupancy on its own; it consumes the single authority in entryRiskOccupancy.ts. UNKNOWN stays fail-closed, live durable replay shows the phantom pending notional removed, no lifecycle action, no settings write, no exchange write.',
  changedProductFiles: ['apps/engine/src/services/entryRiskOccupancy.ts', 'apps/engine/src/services/portfolioRiskLedger.ts'],
  newTestFile: 'apps/engine/src/services/pendingRiskOccupancyConvergence.test.ts',
  redToGreen: {beforePatch: '7 failed / 4 passed (11)', afterPatch: '11 passed'},
  liveReplay: {legacyPendingOrders: 46, authorityPendingOrders: 0, legacyPendingNotionalUsd: 31236.33, authorityPendingNotionalUsd: 0,
    durableUnknownRows: 46, unknownIdSetIdenticalToDeployRound: true,
    releasedWithoutValidProof: 0, releasedStillOccupyingAuthority: 0, releasedWithExchangeOrderId: 0, releasedWithFill: 0,
    note: 'At the 21:42 deploy-round sample the authority still held 2 of 46; both were re-proven by the periodic remote audit at 22:33:27 and 22:35:21, which is why the split moved. Nothing was rewritten or deleted here.'},
  gates: {verifyDeps: 0, s00Static: 0, storageCoverage: 0, engineAffectedTests: 0, engineTypecheck: 0, engineTests: 0, engineBuildToScratch: 0,
    coreTypecheck: 0, coreTests: 0, contractsTypecheck: 0, contractsTests: 0, gitDiffCheck: 0,
    engineFiles: 155, engineTests: 1194, coreFiles: 8, coreTests: 46, contracts: 'passWithNoTests (0 cases, not coverage)',
    scratchBuildDirRemoved: true, liveDistTouched: false},
  forbiddenAndNotDone: ['engine stop/start/restart', 'hot reload', 'watchdog/autostart', 'live apps/engine/dist or apps/dashboard/dist build', 'settings write',
    'executionMode change', 'portfolioRisk values', 'exchange writes', 'threshold or timeout changes', 'deleting or rewriting UNKNOWN rows'],
  liveInstanceUntouched: {pid: 50996, buildId: '3.9.6-dc8fb58b578c25d10726', executionMode: 'READ_ONLY', testnetWrites: 0, productionWrites: 0, lastWriteAt: null, settingsVersion: 191},
  files: entries,
}, null, 2) + '\n');
console.log(entries.map(e => `${e.sha256.slice(0, 12)}  ${e.path}`).join('\n'));

// Normalises this round's evidence text and indexes it with sha256 (LF-normalised for text, raw for images).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923';
const walk = base => readdirSync(base).flatMap(name => {
  const full = join(base, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
for (const file of walk(dir).filter(f => !/\.(png|jpg|jpeg|gif|zip|wasm)$/.test(f))) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '') + '\n';
  if (text !== readFileSync(file, 'utf8')) writeFileSync(file, text);
}

const files = execFileSync('git', ['ls-files', '-o', '--exclude-standard', dir], {encoding: 'utf8'}).split(/\r?\n/).filter(Boolean)
  .filter(f => !f.endsWith('evidence-index.json') && !f.endsWith('index-evidence.mjs')).sort();
const entries = files.map(path => {
  const bytes = readFileSync(path);
  const body = /\.(png|jpg|jpeg|gif|zip|wasm)$/.test(path) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n');
  return {path, bytes: bytes.length, sha256: createHash('sha256').update(body).digest('hex')};
});

writeFileSync(`${dir}/evidence-index.json`, JSON.stringify({
  round: 'v396-deploy-d570bef-pending-risk-live',
  date: '2026-09-24',
  deployedCommit: 'd570befca02e952bf174d3e1f42b93cf241285a3',
  branch: 'codex/v396-final-convergence-20260922',
  authorization: 'one normal stop + one MANUAL_START, then read-only acceptance and evidence only; no settings write, no PortfolioRisk profile configuration, no ENFORCE, no testnet/production trade write, no extra restart',
  verdict: 'DEPLOYED AND ACCEPTED — the running payload now takes entry occupancy from the single authority; the 46 phantom pending rows and their $31,236.33 phantom notional are gone on live durable data; Anti-Waste still spends zero model calls; write boundary 0/0/null; no new P0/P1',
  lifecycle: {stop: 1, start: 1, hotReload: 0, watchdog: 0, autostart: 0, secondRestart: 0, settingsWrite: 0, profileConfigured: false, exchangeOrderAction: 0},
  oldInstance: {pid: 50996, buildId: '3.9.6-dc8fb58b578c25d10726', sourceCommit: 'e284a1a', uptimeHours: 9.1, blockedProductionWriteAttemptsAtEnd: 1},
  newInstance: (() => { const live = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8')); const expected = JSON.parse(readFileSync('docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923/build-04-expected-artifact-identity.json', 'utf8')); const receipt = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-launch-receipt.json', 'utf8')); return {...live, hostPid: receipt.hostPid, launchId: receipt.launchId, provenanceClosedByHashMatch: live.buildId === expected.expectedBuildId && live.artifactHash === expected.artifactHash && live.sourceHash === expected.sourceHash}; })(),
  deployedPayloadProof: {statusOnlyOrderFilterGone: true, ledgerCallsSingleAuthority: true, usdtHardcodeGone: true, newExportPresent: true},
  liveDurableReplay: {legacyPendingOrders: 46, legacyPendingNotionalUsd: 31236.33, authorityPendingOrders: 0, authorityPendingNotionalUsd: 0,
    releasedPhantomNotionalUsd: 31236.33, durableUnknownRowsUnchanged: 46, releasedWithoutValidProof: 0, releasedWithExchangeOrderId: 0, releasedWithFill: 0,
    unknownRowsStillOccupyingWouldBeCounted: true},
  notClaimed: 'No real PORTFOLIO_RISK_ADMISSION_EVALUATED run exists on the new instance because READ_ONLY keeps model spend at zero, so the live admission path was not exercised; the numbers above come from the deployed module driven with the live durable rows.',
  antiWaste: {modelCallsSinceInstanceStart: 0, aiRunTerminal: 0, analysisOnlyCompleted: 0, tradePlanPersisted: 0, entryOrderSubmit: 0, executionReadinessBlocked: 1,
    supplyMaintenanceStillRunning: true, candidateLifecycleEvents: 90, marketMessagesAdvanced: true,
    executionReadiness: {intent: true, ready: false, modelSpendPermitted: false, firstBlocker: 'EXECUTION_WRITE_LOCKED', profileStatus: 'PROFILE_NOT_CONFIGURED'}},
  privateData: {windowMinutes: 7.9, failures: 0, recoveries: 0, status: 'READY', snapshotAgeMs: 8, note: 'previous instance saw 114 timeouts in 9h; nothing was loosened'},
  safety: {testnetWrites: 0, productionWrites: 0, lastWriteAt: null, blockedProductionWriteAttemptsThisInstance: 0, executionMode: 'READ_ONLY', environment: 'TESTNET',
    settingsVersion: 197, positions: 13, tpProtected: '13/13', orphans: 0, unverifiedTp: 0,
    ownership: '27 rows / 27 cycles / 0 AI_ACTIVE / outbox 0, identical before and after', sqliteIntegrity: true, fatalMatches: 0},
  preExistingDriftNotCausedByThisRound: {settingsVersion: '191 -> 197 by six cas writes between 06:04:25 and 06:28:26', positions: '14 -> 13 closed by hand before this round', blockedWriteCounter: 'one orphan-TP cancel refused under READ_ONLY on the previous instance; the counter is per instance and counts any refused exchange write'},
  files: entries,
}, null, 2) + '\n');
console.log(entries.map(e => `${e.sha256.slice(0, 12)}  ${e.path}`).join('\n'));

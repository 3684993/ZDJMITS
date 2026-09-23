// Indexes this round's evidence: path, byte length and sha256 of the LF-normalised text.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'docs/evidence/v396/deploy-e284a1a-anti-waste-20260923';
const files = execFileSync('git', ['ls-files', '-o', '--exclude-standard', dir], { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean).filter(f => !f.endsWith('evidence-index.json') && !f.endsWith('index-evidence.mjs')).sort();

const entries = files.map(path => {
  const bytes = readFileSync(path);
  // Text is hashed after LF normalisation so a CRLF checkout cannot change the digest; binaries are hashed raw.
  const text = /\.(png|jpg|jpeg|gif|zip|wasm)$/.test(path) ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n');
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(text).digest('hex') };
});

writeFileSync(`${dir}/evidence-index.json`, JSON.stringify({
  round: 'v396-deploy-e284a1a-anti-waste',
  date: '2026-09-23',
  plan: 'docs/plans/v396/CODEX-V396-DEPLOY-E284A1A-ANTI-WASTE-20260923.md',
  branch: 'codex/v396-final-convergence-20260922',
  headAtExecution: '374218e (docs-only authorization commit on top of e284a1a; product source byte-identical to the accepted e284a1a baseline)',
  deployedProductCommit: 'e284a1a4a2571fffea2f84dec76d687533e67d7a',
  verdict: 'DEPLOYED AND ACCEPTED — anti-waste gate live, zero model spend counted on the new instance, deterministic supply still running, writes 0/0, no new P0/P1; the pending-risk contradiction is root-caused and deferred to an offline red->green patch',
  lifecycle: { stop: 1, start: 1, hotReload: 0, watchdog: 0, autostart: 0, secondRestart: 0, settingsWrite: 0, exchangeOrderAction: 0 },
  oldInstance: { pid: 33432, buildId: '3.9.6-50d14dbd22d1ea5ed7d2', note: 'the e890ed5 build deployed at 18:19' },
  newInstance: {
    pid: 50996, hostPid: 42040, launchId: 'e635a90192b2405788f5ce5a18d05a9c',
    instanceId: 'dc5c58b8-3c9a-4414-8f02-b00d3b1005fb',
    buildId: '3.9.6-dc8fb58b578c25d10726',
    artifactHash: 'dc8fb58b578c25d10726b9ea52b9a5c3706215c31f2697e626b4c46b507e6bad',
    sourceHash: '84cecf6b2497790e963c942b3d037c888b8705ccd748008cbd537a01d4551897',
    startReason: 'MANUAL_START', startedAtLocal: '2026-09-23 21:30:09',
    provenance: 'expected artifactHash/sourceHash computed after the build equal the values the new process wrote itself',
  },
  acceptance: {
    executionReadinessProjected: true, intent: true, ready: false, modelSpendPermitted: false,
    firstBlocker: 'EXECUTION_WRITE_LOCKED', profileStatus: 'PROFILE_NOT_CONFIGURED',
    modelRunsSinceInstanceStart: 0, aiRunTerminalEvents: 0, analysisOnlyCompletedEvents: 0,
    tradePlanPersistedEvents: 0, entryOrderSubmitEvents: 0, executionReadinessBlockedEvents: 1,
    analysisDispatchHeartbeatEvents: '18 at 21:48:57 -> 28 at 21:53:32',
    supplyMaintenanceStillRunning: true, candidateLifecycleEvents: 115, marketMessagesAdvanced: true,
    testnetWrites: 0, productionWrites: 0, lastWriteAt: null, lockedToTestnet: true, executionMode: 'READ_ONLY',
    positions: 14, tpProtected: '14/14', ownership: '27 rows / 27 cycles / 0 AI_ACTIVE / outbox 0',
    fatalMatches: 0, sqliteIntegrity: true, persistenceStatus: 'HEALTHY',
    privateDataFlap: { failures: 27, recoveries: 15, errorCodeTally: { TIMEOUT: 27 }, durationMsRange: [1233, 23524], maxConsecutiveFailures: 5 },
  },
  pendingRiskFinding: {
    count: 46, countedByLedgerFilter: 46, countedByCanonicalOccupancyPredicate: 2,
    releasedByAuthoritativeEvidenceButStillCounted: 44, rowsWithMissingExpiresAt: 46,
    rowsWithSuspectedRealActiveRisk: 0, phantomPendingNotionalUsd: 30629.41, legitimatelyOccupyingNotionalUsd: 606.92,
    rootCause: 'portfolioRiskLedger.ts PortfolioRiskAdmission.inputs() builds builtPending with its own status-only filter instead of reusing entryRiskOccupancy.ts:23 entryOrderOccupiesRisk, which defers UNKNOWN rows to hasVerifiedNoActiveRisk',
    safetyDirection: 'over-counts risk; no real risk released, so not a P0',
    nextRoundNeedsProductPatch: true,
  },
  files: entries,
}, null, 2) + '\n');
console.log(entries.map(e => `${e.sha256.slice(0, 12)}  ${e.path}`).join('\n'));

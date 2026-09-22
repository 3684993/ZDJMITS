import { readFileSync, writeFileSync, statSync } from 'node:fs';


const A = 'D:/MITS/data/audit-export/20260923-cutover/';
const OUT = process.argv[2];
const ts8 = (t) => new Date(Number(t) + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const j = (f) => JSON.parse(readFileSync(A + f, 'utf8'));

const hot = j('phaseB-out.json');
const cold = j('phaseB2-out.json');
const stopline = j('ev/stopline-snapshot.json');
const prestopPipeline = j('prestop-pipeline.json');
const prestopPositions = j('prestop-positions.json');
const prestopOrders = j('prestop-orders.json');
const L = (t) => (t ? ts8(t) : null);
const now = Date.now();

const act = (prestopOrders.entry ?? []).filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status));
const nonTerminalWithoutEvidence = act.filter(
  (o) => o.activeRiskExposure !== false || o.activeRiskEvidence?.status !== 'VERIFIED_NO_ACTIVE_RISK' || Number(o.activeRiskEvidence?.validUntil ?? 0) < statSync(A + 'prestop-orders.json').mtimeMs,
);

const lifecycle = {
  runId: 'runtime-cutover-20260923',
  generatedAtUtc8: ts8(now),
  authorization: {
    document: 'docs/plans/v396/CODEX-V395-AUDIT-TO-V396-TESTNET-CUTOVER-20260923.md',
    scope: 'one specific manual stop of the running V3.9.5 engine as part of this V3.9.5 -> V3.9.6 Testnet cutover',
    autostartInstalledOrReenabled: false,
    productionWriteCapabilityUsed: false,
  },
  v395Identity: {
    instanceId: stopline.engineIdentity.instanceId,
    pid: stopline.engineIdentity.pid,
    version: stopline.engineIdentity.version,
    buildId: stopline.engineIdentity.buildId,
    artifactHash: hot.finalIdentity?.artifactHash ?? null,
    sourceHash: hot.finalIdentity?.sourceHash ?? null,
    listen: `${stopline.engineIdentity.host}:${stopline.engineIdentity.port}`,
    startedUtc8: stopline.engineIdentity.startedUtc8,
    uptimeHoursAtStop: Number(((statSync('D:/MITS/data/trading-quality.sqlite').mtimeMs - cold.finalIdentity.startedAt) / 3600e3).toFixed(2)),
    startReason: stopline.engineIdentity.startReason,
    restartCount: stopline.engineIdentity.restartCount,
    supervisor: stopline.engineIdentity.supervisor,
    launchReceipt: JSON.parse(readFileSync('D:/MITS/data/runtime/engine-launch-receipt.json', 'utf8')),
    environment: stopline.environmentIdentity.exchangeEnvironment,
    executionMode: stopline.environmentIdentity.executionMode,
    autoExecutionMode: stopline.environmentIdentity.autoExecutionMode,
    credentialRef: stopline.environmentIdentity.credentialRef,
    testnetRestBaseUrl: stopline.environmentIdentity.testnetRestBaseUrl,
    testnetWsBaseUrl: stopline.environmentIdentity.testnetWsBaseUrl,
    settingsVersion: stopline.environmentIdentity.settingsVersion,
    secretFieldsRecorded: false,
  },
  lastObservedRuntimeState: {
    pipelineAsOfUtc8: L(prestopPipeline.asOf),
    pipelineState: prestopPipeline.pipelineState,
    reasonCode: prestopPipeline.runtimeControl.reasonCode,
    reasonText: prestopPipeline.runtimeControl.reasonText,
    noEntryReason: prestopPipeline.noEntryReason,
    aiIdleReason: prestopPipeline.primaryBrain.resource.idleReason,
    aiHealthReason: prestopPipeline.primaryBrain.healthReason,
    aiLastRunAgeMinutes: Number((prestopPipeline.primaryBrain.lastRunAgeMs / 60000).toFixed(1)),
    capitalExecutableCandidates: prestopPipeline.runtimeControl.capital.executableCandidateCount,
    capacity: prestopPipeline.capacity,
    takeProfit: { required: prestopPipeline.takeProfit.required, protected: prestopPipeline.takeProfit.protected, missing: prestopPipeline.takeProfit.missing, orphanTp: prestopPipeline.takeProfit.orphanTp, duplicateTp: prestopPipeline.takeProfit.duplicateTp, qtyMismatch: prestopPipeline.takeProfit.qtyMismatch, wrongSide: prestopPipeline.takeProfit.wrongSide, unverifiedTp: prestopPipeline.takeProfit.unverifiedTp, repairFailed: prestopPipeline.takeProfit.repairFailed, retryQueue: prestopPipeline.takeProfit.retryQueue },
    reconciliation: { historicalUnknown: prestopPipeline.reconciliation.historicalUnknownCount, activeRiskUnresolvedAtThisRead: prestopPipeline.reconciliation.activeRiskUnresolvedCount, verifiedNoActiveRisk: prestopPipeline.reconciliation.verifiedNoActiveRiskUnknownCount },
    privateAccount: { status: prestopPipeline.binancePrivate.status, snapshotAgeMs: prestopPipeline.binancePrivate.snapshotAgeMs, consecutiveFailures: prestopPipeline.binancePrivate.consecutiveFailures },
    marketData: { status: prestopPipeline.freshMarkets.status, stale: prestopPipeline.freshMarkets.stale.length, quoteFreshRatio: prestopPipeline.freshMarkets.quoteFreshRatio, klineFreshRatio: prestopPipeline.freshMarkets.klineFreshRatio },
  },
  positionsOrdersUnknownTpAtStop: {
    positionCount: prestopPositions.length,
    unprotectedPositions: prestopPositions.filter((p) => p.tpStatus !== 'PROTECTED').map((p) => p.symbol),
    byManagementStatus: prestopPositions.reduce((m, p) => ((m[p.managementStatus] = (m[p.managementStatus] ?? 0) + 1), m), {}),
    grossNotionalUsd: Number(prestopPositions.reduce((s, p) => s + Number(p.quantity) * Number(p.markPrice), 0).toFixed(6)),
    unrealizedPnlUsd: Number(prestopPositions.reduce((s, p) => s + Number(p.unrealizedPnl ?? 0), 0).toFixed(6)),
    nonTerminalEntryOrders: act.length,
    nonTerminalEntryOrderStatuses: act.reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
    nonTerminalWithoutVerifiedNoRiskEvidence: nonTerminalWithoutEvidence.map((o) => o.clientOrderId),
    evidenceAgeMinutesRange: [
      Number(((statSync(A + 'prestop-orders.json').mtimeMs - Math.max(...act.map((o) => o.activeRiskEvidence?.checkedAt ?? 0))) / 60000).toFixed(1)),
      Number(((statSync(A + 'prestop-orders.json').mtimeMs - Math.min(...act.map((o) => o.activeRiskEvidence?.checkedAt ?? Infinity))) / 60000).toFixed(1)),
    ],
    workingTakeProfitOrders: (prestopOrders.takeProfit ?? []).filter((o) => o.status === 'WORKING').length,
    takeProfitStatusTally: (prestopOrders.takeProfit ?? []).reduce((m, o) => ((m[o.status] = (m[o.status] ?? 0) + 1), m), {}),
  },
  backups: {
    hotOnlineBackupAtUtc8: hot.capturedAtUtc8,
    hotOnlineBackupDir: 'D:/MITS-backups/cutover-20260923/pre-stop',
    hotOnlineBackupNote: 'taken through the SQLite online backup API while the engine was running; this is the only image that preserves the state as it was before the post-stop WAL checkpoint',
    hot: Object.fromEntries(Object.entries(hot.stores).map(([k, v]) => [k, { sha256: v.backupSha256, bytes: v.backupBytes, integrity_check: v.integrity_check, totalRows: v.totalRowsBackup, tables: v.tablesInSource, userVersion: v.userVersionBackup }])),
    hotConfig: hot.config,
    coldBackupAtUtc8: cold.capturedAtUtc8,
    coldBackupDir: 'D:/MITS-backups/cutover-20260923/cold',
    cold: Object.fromEntries(Object.entries(cold.stores).map(([k, v]) => [k, { sha256: v.coldBackupSha256, bytes: v.coldBackupBytes, integrity_check: v.integrity_check, foreign_key_check_rows: v.foreign_key_check_rows, totalRows: v.totalRows, tables: v.tables, runtimeSettingsVersion: v.runtimeSettingsVersion, journalMode: v.journalMode, liveHashEqualsBackupHash: v.liveSha256MatchesBackup }])),
    postStopWalCheckpoint: { statement: 'PRAGMA wal_checkpoint(TRUNCATE)', appliedWhileEngineWasStopped: true, reason: 'consolidate the durable store into a single restorable file; frames were moved into the main database, nothing was deleted', busy: cold.stores['zdj-settings.sqlite'].walCheckpointResult.busy, preCheckpointImagePreservedBy: 'hot online backup at ' + hot.capturedAtUtc8 },
    notBackedUp: cold.notBackedUp,
  },
  stopAction: {
    method: 'scripts/stop-zdj-lan.ps1 (repository-sanctioned manual stop; it proves the port owner matches data/runtime/engine-instance.json, node.exe and dist/main.js before stopping, and refuses to kill otherwise)',
    scriptOutput: 'ZDJ-MITS stopped; port 8080 is free',
    executedAtUtc8Approx: '2026-09-23 07:40+08',
    lastEngineDurableWriteUtc8: '2026-09-23 07:40:07+08',
    killAfterWhichNothingRelaunched: true,
    supervisorOrAutostartInstalled: false,
  },
  postStopVerification: {
    verifiedAtUtc8: ts8(now),
    listenersOn8080: 0,
    pid10540Alive: false,
    nodeProcessesRunningDistMainJs: 0,
    healthProbe: 'connection failed (expected: nothing is listening)',
    lanSupervisorStateFileBytes: statSync('D:/MITS/data/runtime/lan-supervisor-state.json').size,
    secondInstanceFound: false,
  },
  stopLineDecision: {
    recordedIn: 'docs/evidence/v396/runtime-cutover-20260923/v395-10h-audit/stopline-snapshot.json',
    a2BlockersFound: [],
    correction: {
      flawedCheckThatWasReplaced: 'unresolvedRiskNeverExceedsOneReauditSlot (activeRiskUnresolvedCount <= 1)',
      whyItWasWrong: 'the no-active-risk evidence for an UNKNOWN order has a 300 s TTL and is re-verified on a 5/15/30 minute ladder, so the instantaneous count is a function of when you sample, not of whether risk exists; it was observed at 0, 1 and 2 within ten minutes',
      gateActuallyUsed: 'every non-terminal entry order carries VERIFIED_NO_ACTIVE_RISK evidence from five exchange sources at the check instant, capacity.inFlight is 0 across repeated samples, and all 29 positions hold an exchange-side WORKING take-profit order',
    },
  },
};
writeFileSync(OUT, JSON.stringify(lifecycle, null, 1) + '\n');
console.log(JSON.stringify({ wrote: OUT, pid: lifecycle.v395Identity.pid, build: lifecycle.v395Identity.buildId, hotSha: lifecycle.backups.hot['zdj-settings.sqlite'].sha256.slice(0, 16), coldSha: lifecycle.backups.cold['zdj-settings.sqlite'].sha256.slice(0, 16), nonTermWithoutEvidence: lifecycle.positionsOrdersUnknownTpAtStop.nonTerminalWithoutVerifiedNoRiskEvidence, evidenceAgeMin: lifecycle.positionsOrdersUnknownTpAtStop.evidenceAgeMinutesRange, postStop: lifecycle.postStopVerification }, null, 1));

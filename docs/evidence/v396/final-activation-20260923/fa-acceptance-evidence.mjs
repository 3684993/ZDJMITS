import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const A = 'D:/MITS/data/audit-export/20260923-cutover/';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const j = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const pipeline = j('fa-pipeline.json');
const closeout = j('fa-closeout.json');
const watch = readFileSync(A + 'fa-watch.json', 'utf8');
const watchStart = watch.indexOf('{');
const watchJson = JSON.parse(watch.slice(watchStart));
const samples = watchJson.samples ?? [];

const store = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const settings = JSON.parse(String(store.prepare('select payload from settings where id=1').get().payload));
const sinceStart = (sql) => store.prepare(sql).get(identity.startedAt);
const events = store
  .prepare('select type, count(*) n, min(ts) first_ts, max(ts) last_ts from runtime_events where ts>=? group by type')
  .all(identity.startedAt);
const positions = store.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
const tpWorking = store.prepare("select payload from runtime_entities where kind='tpOrders'").all().map((r) => JSON.parse(String(r.payload))).filter((o) => o.status === 'WORKING');
const nonTerminal = store
  .prepare("select payload from runtime_entities where kind='entryOrders'")
  .all()
  .map((r) => JSON.parse(String(r.payload)))
  .filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(String(o.status)));
const fatal = sinceStart("select count(*) n from runtime_events where type in ('ENGINE_FATAL_ERROR','RUNTIME_STOPPING','RUNTIME_STOPPED') and ts>=?").n;
const orderWrites = sinceStart("select count(*) n from runtime_events where (type LIKE '%SUBMIT%' OR type LIKE '%ORDER_CREATED%' OR type LIKE '%ENTRY_FILLED%' OR type LIKE '%CANCEL%') and ts>=?").n;
const storeSettingsVersion = Number(store.prepare('select version from settings where id=1').get().version);
store.close();
const ledger = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', { readOnly: true });
const owners = ledger.prepare('SELECT scope, payload FROM v396_owners').all().map((r) => JSON.parse(String(r.payload)));
const ledgerInfo = {
  rows: owners.length,
  cycles: new Set(owners.map((o) => o.cycleId)).size,
  cyclesWithTwoRows: owners.length - new Set(owners.map((o) => o.cycleId)).size,
  stateTally: owners.reduce((m, o) => ((m[o.ownerState] = (m[o.ownerState] ?? 0) + 1), m), {}),
  aiActive: owners.filter((o) => o.ownerState === 'AI_ACTIVE').length,
  scopeSides: [...new Set(owners.map((o) => JSON.parse(String(o.scope))[3]))].sort(),
  claims: ledger.prepare('select count(*) n from v396_quantity_claims').get().n,
  mandates: ledger.prepare('select count(*) n from v396_mandates').get().n,
  integrity: String(ledger.prepare('PRAGMA integrity_check').get().integrity_check),
  sha256: sha('D:/MITS/data/v396-ownership.sqlite'),
};
ledger.close();

const a = pipeline.analysis ?? {};
const report = {
  runId: 'final-activation-runtime-20260923',
  generatedAtUtc8: ts8(Date.now()),
  plan: 'docs/plans/v396/CODEX-V396-FINAL-ACTIVATION-20260923.md',
  finalState: 'V396_TESTNET_ACTIVE_ANALYSIS_ONLY',
  instance: { pid: identity.pid, instanceId: identity.instanceId, version: identity.version, buildId: identity.buildId, artifactHash: identity.artifactHash, sourceHash: identity.sourceHash, startReason: identity.startReason, startedUtc8: ts8(identity.startedAt), uptimeMinutesAtEvidence: Number(((Date.now() - identity.startedAt) / 60000).toFixed(1)) },
  lifecycleActionsThisRound: {
    controlledStop: { authorizedBy: plan_uses_quote(), stoppedPid: 26896, method: 'scripts/stop-zdj-lan.ps1', output: 'ZDJ-MITS stopped; port 8080 is free', verified: { listeners: 0, engineProcesses: 0 } },
    manualStart: { method: 'scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall', hotReload: false, watchdogInstalled: false, autostartInstalled: false },
    hotReloadOrWatchdogUsed: false,
  },
  launchTier: {
    settingsVersion: settings.settingsVersion,
    settingsRowVersion: storeSettingsVersion,
    environment: settings.connections.exchange.environment,
    executionMode: settings.connections.executionMode,
    exchangeWriteLockHeld: settings.connections.executionMode === 'READ_ONLY',
    aiExitAuthority: settings.riskGovernance.exitCoordination.aiExitAuthority,
    enforceGranted: settings.riskGovernance.exitCoordination.aiExitAuthority === 'ENFORCE',
    positionReviewEnabled: settings.riskGovernance.exitCoordination.positionReviewEnabled,
    tradeEconomicsAdmissionMode: settings.tradeEconomics.admissionMode,
  },
  p1_1_analysisOnlyDispatch: {
    mode: a.mode,
    firstCauseReason: a.reason,
    lastBlockedReason: a.lastBlockedReason,
    lastTickAtUtc8: a.lastTickAt ? ts8(a.lastTickAt) : null,
    lastAttemptAtUtc8: a.lastAttemptAt ? ts8(a.lastAttemptAt) : null,
    lastSuccessAtUtc8: a.lastSuccessAt ? ts8(a.lastSuccessAt) : null,
    silenceMinutes: Number(((a.silenceMs ?? 0) / 60000).toFixed(1)),
    silenceIsMeasuredFromThisInstanceOnly: a.observationStartedAt >= identity.startedAt,
    capitalExecutableCandidates: a.capitalExecutableCount,
    dispatchHeartbeats: (events.find((e) => e.type === 'ANALYSIS_DISPATCH_HEARTBEAT')?.n) ?? 0,
    dispatchIntents: (events.find((e) => e.type === 'ANALYSIS_DISPATCH_INTENT')?.n) ?? 0,
    modelStatus: pipeline.primaryBrain?.resource?.status,
    reasonSequenceObserved: [...new Set(samples.map((s) => s.reason))],
    dashboardText: a.text,
    legacyGenericTextStillShownAsFirstCause: pipeline.runtimeControl.reasonText,
    samples,
  },
  p1_2_profileAuthority: {
    readback: pipeline.portfolioRiskProfile,
    interpretation: 'provenance names the settings path and version, contentHash covers the whole row including correlation/scenario/margin-tier versions, and configured=false with every limit at 0 is exposed as-is: no lenient default was invented and admission fails closed',
  },
  p1_3_marginUnits: {
    positionsObserved: positions.length,
    negativeNotionalUsd: positions.filter((p) => Number(p.notionalUsd) < 0).length,
    nullNotionalUsd: positions.filter((p) => p.notionalUsd == null).length,
    marginAssetsFromExchange: positions.reduce((m, p) => ((m[String(p.marginAsset ?? 'NULL')] = (m[String(p.marginAsset ?? 'NULL')] ?? 0) + 1), m), {}),
    interpretation: 'marginAsset stays null on these contract rows and PortfolioRiskAdmission now raises POSITION_MARGIN_ASSET_UNPROVEN instead of defaulting to USDT; non-stable balances need a fresh valuation before becoming USD margin, proven by the BTC fixtures',
  },
  primaryTradePlanAdmissionEvidence: {
    primaryRunsThisInstance: pipeline.primaryBrain?.resource?.totalRuns ?? 0,
    aiRequestsThisInstance: (events.find((e) => e.type === 'POOL_ANALYSIS_STARTED')?.n) ?? 0,
    tradePlansPersisted: (events.find((e) => e.type === 'TRADE_PLAN_PERSISTED')?.n) ?? 0,
    portfolioRiskAdmissionEvaluated: (events.find((e) => e.type === 'PORTFOLIO_RISK_ADMISSION_EVALUATED')?.n) ?? 0,
    analysisOnlyCompleted: (events.find((e) => e.type === 'ANALYSIS_ONLY_COMPLETED')?.n) ?? 0,
    naturalCapitalExecutableCandidateAppeared: Math.max(0, ...samples.map((x) => Number(x.capitalExec) || 0)) > 0,
    whyNotYet: 'capital admission stayed at 0 executable candidates for the whole observation window while pipeline-ready symbols fluctuated 0-2, so dispatch never had an eligible input; the plan forbids manufacturing a candidate or widening thresholds',
    pathProvenOpen: 'processPool ran to its candidate-selection stage on this instance (lastBlockedReason=NO_RUNNABLE_CANDIDATE, not a policy or fact gate), the write admission check passed, the model probe stayed ONLINE and the dispatch heartbeat kept 30s freshness, so the only missing input is a capital-executable candidate',
    offlineEquivalence: 'finalActivation.test.ts drives the same terminal path with a real PLACE_LONG/WAIT/REJECT decision and asserts ANALYSIS_ONLY_COMPLETED plus exactly one immutable SYSTEM trade plan, zero reservations/intents/orders and no placeEntry/cancelEntry call',
  },
  writeBoundary: closeout.productionWriteBoundary,
  stability: { fatalOrStopEvents: fatal, orderLifecycleEventsSinceStart: orderWrites, persistenceStatus: closeout.persistence?.status, persistenceIntegrity: closeout.persistence?.integrity, eventTally: events.map((e) => ({ type: e.type, n: e.n, firstUtc8: ts8(e.first_ts), lastUtc8: ts8(e.last_ts) })).sort((x, y) => y.n - x.n) },
  protectionAndTruth: {
    positions: positions.length,
    unprotected: positions.filter((p) => p.tpStatus !== 'PROTECTED').map((p) => p.symbol),
    workingTakeProfitOrders: tpWorking.length,
    takeProfitSymbols: new Set(tpWorking.map((t) => String(t.symbol))).size,
    everyPositionProtected: positions.every((p) => tpWorking.some((t) => String(t.symbol) === String(p.symbol))),
    nonTerminalEntryOrders: nonTerminal.length,
    unknownWithoutVerifiedNoRisk: nonTerminal.filter((o) => o.activeRiskExposure !== false || o.activeRiskEvidence?.status !== 'VERIFIED_NO_ACTIVE_RISK').length,
    ownershipLedger: ledgerInfo,
    ownershipUnchangedByRestart: ledgerInfo.rows === 27 && ledgerInfo.aiActive === 0 && ledgerInfo.cyclesWithTwoRows === 0,
  },
  gatesRunFromRepoRoot: {
    npmRunVerify: { exit: 0, engine: '1155 tests / 152 files', core: '46 / 8 files', dashboard: '25 / 9 files' },
    s00StaticCheck: { exit: 0, blockers: '[]' },
    storageCoverageCheck: { exit: 0, gate: 'S08_STORAGE_COVERAGE_PASS' },
    gitDiffCheck: { exit: 0 },
    transcripts: ['fa-verify.log', 'fa-s00.log', 'fa-storage.log', 'fa-diffcheck.log'],
  },
  notClaimed: {
    limitedTestnetWrite: 'NOT_RUN - phase E never executed; ENFORCE not granted',
    soakWindow: 'NOT_STARTED - excluded from this authorization by the plan',
    economicEdge: 'INSUFFICIENT_EVIDENCE - no out-of-sample or PnL claim in this round',
    accepted: 'not signed',
  },
};
function plan_uses_quote() {
  return 'CODEX-V396-FINAL-ACTIVATION-20260923.md section 正式启用';
}
writeFileSync(`${OUT}/runtime-acceptance.json`, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ state: report.finalState, pid: report.instance.pid, build: report.instance.buildId, reason: a.reason, mode: a.mode, heartbeats: report.p1_1_analysisOnlyDispatch.dispatchHeartbeats, writes: closeout.productionWriteBoundary.testnetWrites, fatal, owners: ledgerInfo.rows, aiActive: ledgerInfo.aiActive, enforce: report.launchTier.enforceGranted }, null, 1));

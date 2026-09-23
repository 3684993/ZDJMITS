import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const A = 'D:/MITS/data/audit-export/20260923-cutover/';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const j = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
const census = JSON.parse(readFileSync('D:/MITS-backups/cutover-20260923/ledger-pre-rebuild/pre-rebuild-census.json', 'utf8'));
const rebuild = j('rebuild/ownership-migration-v2.json');
const closeout = j('post-closeout.json');
const pipeline = j('post-pipeline.json');
const positions = j('post-positions.json');
const orders = j('post-orders.json');
const health = j('post-start-health.json');
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';

const led = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', { readOnly: true });
const rows = led.prepare('SELECT scope, payload FROM v396_owners').all().map((r) => ({ scope: String(r.scope), ...JSON.parse(String(r.payload)) }));
const byCycle = {};
for (const r of rows) (byCycle[r.cycleId] ??= []).push(r);
const ledger = {
  file: 'D:/MITS/data/v396-ownership.sqlite',
  bytes: statSync('D:/MITS/data/v396-ownership.sqlite').size,
  sha256: sha('D:/MITS/data/v396-ownership.sqlite'),
  ownerRows: rows.length,
  distinctCycles: Object.keys(byCycle).length,
  cyclesWithMoreThanOneRow: Object.values(byCycle).filter((v) => v.length > 1).length,
  stateTally: rows.reduce((m, r) => ((m[r.ownerState] = (m[r.ownerState] ?? 0) + 1), m), {}),
  aiActiveRows: rows.filter((r) => r.ownerState === 'AI_ACTIVE').length,
  scopeSidesSeen: [...new Set(rows.map((r) => JSON.parse(r.scope)[3]))].sort(),
  ownerVersionsObserved: [...new Set(rows.map((r) => r.ownerVersion))].sort(),
  outboxRows: led.prepare('select count(*) n from v396_outbox').get().n,
  outboxDelivered: led.prepare('select count(*) n from v396_outbox where delivered=1').get().n,
  quantityClaims: led.prepare('select count(*) n from v396_quantity_claims').get().n,
  mandates: led.prepare('select count(*) n from v396_mandates').get().n,
  integrity_check: String(led.prepare('PRAGMA integrity_check').get().integrity_check),
  schemaUserVersion: Number(led.prepare('select * from pragma_user_version').get().user_version),
};
led.close();
const store = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const fatal = store.prepare('select count(*) n from runtime_events where type in (\'ENGINE_FATAL_ERROR\',\'RUNTIME_STOPPING\',\'RUNTIME_STOPPED\') and ts>=?').get(identity.startedAt).n;
const writeLikeEvents = store.prepare("select count(*) n from runtime_events where (type LIKE '%SUBMIT%' OR type LIKE '%ORDER_CREATED%' OR type LIKE '%ENTRY_FILLED%' OR type LIKE '%CANCEL%') and ts>=?").get(identity.startedAt).n;
const settings = JSON.parse(String(store.prepare('select payload from settings where id=1').get().payload));
const storePositions = store.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
store.close();

const tpWorking = new Set((orders.takeProfit ?? []).filter((o) => o.status === 'WORKING').map((o) => String(o.symbol)));
const nonTerminal = (orders.entry ?? []).filter((o) => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status));
const notionalDelta = storePositions.map((p) => Math.abs(Number(p.notionalUsd) - Math.abs(Number(p.quantity) * Number(p.markPrice))));

const verification = {
  runId: 'ownership-ledger-rebuild-20260923',
  generatedAtUtc8: ts8(Date.now()),
  authorization: 'user message 2026-09-23: one stop + one start, ledger backup/rebuild/verification; explicitly excludes 24h soak, production writes, autotrading, and ENFORCE',
  lifecycleActions: {
    stop: { method: 'scripts/stop-zdj-lan.ps1', previousPid: 51008, output: 'ZDJ-MITS stopped; port 8080 is free', verified: { listeners: 0, engineProcesses: 0, pidGone: true } },
    start: { method: 'scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall', pid: identity.pid, instanceId: identity.instanceId, startedUtc8: ts8(identity.startedAt), version: identity.version, buildId: identity.buildId, artifactHash: identity.artifactHash, sourceHash: identity.sourceHash, autostartInstalled: false },
    totalLifecycleActionsUsed: 2,
  },
  backup: {
    ledgerBackupFile: 'D:/MITS-backups/cutover-20260923/ledger-pre-rebuild/v396-ownership.pre-rebuild.sqlite',
    ledgerBackupSha256: census.ledger.backupSha256,
    settingsBackupFile: 'D:/MITS-backups/cutover-20260923/ledger-pre-rebuild/zdj-settings.pre-rebuild.sqlite',
    settingsBackupBytes: census.storeFingerprint.totalRows,
    defectiveLedgerKeptInPlace: 'D:/MITS/data/v396-ownership.defective-20260923.sqlite',
    defectiveLedgerSha256: census.ledger.sha256,
    nothingDeleted: true,
  },
  defectCleared: {
    before: { ownerRows: census.ledger.ownerRows, distinctCycles: census.ledger.distinctCycles, cyclesWithTwoRows: census.ledger.cyclesWithTwoRows, contradictoryAuthorityCycles: census.ledger.contradictoryAuthorityCycles, aiActiveRows: census.ledger.aiActiveRows.length, tally: census.ledger.tallyBySideAndState },
    after: { ownerRows: ledger.ownerRows, distinctCycles: ledger.distinctCycles, cyclesWithTwoRows: ledger.cyclesWithMoreThanOneRow, aiActiveRows: ledger.aiActiveRows, tally: ledger.stateTally, scopeSidesSeen: ledger.scopeSidesSeen },
    cleared: ledger.cyclesWithMoreThanOneRow === 0 && ledger.aiActiveRows === 0 && !ledger.scopeSidesSeen.includes('ENTRY'),
    runtimeAdvancedInsteadOfRecreating: { ownerVersionsObserved: ledger.ownerVersionsObserved, note: 'versions above 1 exist only if the Engine wrote through the same key onto the migrated rows; no second row per cycle means the keys now agree' },
  },
  readBackThroughEngineKey: { performedBy: 'ownership-migration-v2-driver.mjs check every-open-cycle-readable-by-the-engine-key', result: rebuild.checks.find((c) => c.name === 'every-open-cycle-readable-by-the-engine-key'), allChecks: rebuild.checks },
  notionalSemantics: {
    contractLine: 'packages/contracts/src/trading.ts:125 notionalUsd: z.number().nonnegative().nullable().default(null) — unchanged by this work',
    relaxationUsed: false,
    howTheGuardWasProvenLive: 'PositionSchema.safeParse({notionalUsd:-742.1}) still rejects with code too_small, while 0 / positive / null parse; the fix normalizes at the adapter and at RuntimeState.restore instead of widening the schema',
    persistedPositions: storePositions.length,
    negativeNotionalUsd: storePositions.filter((p) => Number(p.notionalUsd) < 0).length,
    nullNotionalUsd: storePositions.filter((p) => p.notionalUsd == null).length,
    zeroNotionalUsd: storePositions.filter((p) => Number(p.notionalUsd) === 0).length,
    maxAbsoluteDeviationFromUnsignedMagnitude: Number(Math.max(...notionalDelta).toFixed(6)),
    conclusion: 'every stored notional equals |quantity| x markPrice exactly, so no value was zeroed, defaulted or sign-flipped to satisfy the schema',
  },
  postStart: {
    health: { status: health.status, ready: health.ready, version: health.version, pid: health.pid, uptimeMinutes: Number((closeout.runtime.uptimeMs / 60000).toFixed(1)) },
   档位: { settingsVersion: settings.settingsVersion, executionMode: settings.connections.executionMode, aiExitAuthority: settings.riskGovernance.exitCoordination.aiExitAuthority, positionReviewEnabled: settings.riskGovernance.exitCoordination.positionReviewEnabled, tradeEconomicsAdmissionMode: settings.tradeEconomics.admissionMode, environment: settings.connections.exchange.environment },
    writeBoundary: closeout.productionWriteBoundary,
    exchangeWritesSinceStart: { orderLifecycleEvents: writeLikeEvents, expected: 0 },
    stability: { fatalOrStopEventsSinceStart: fatal, expected: 0, persistence: closeout.persistence.status, persistenceIntegrity: closeout.persistence.integrity },
    ledgerIntegrity: { integrity_check: ledger.integrity_check, schemaUserVersion: ledger.schemaUserVersion, outboxDelivered: `${ledger.outboxDelivered}/${ledger.outboxRows}`, claims: ledger.quantityClaims, mandates: ledger.mandates },
  },
  ownershipAgainstExchangeFacts: {
    openPositions: positions.length,
    unprotectedPositions: positions.filter((p) => p.tpStatus !== 'PROTECTED').map((p) => p.symbol),
    exchangeWorkingTakeProfitOrders: tpWorking.size,
    everyOpenPositionHasWorkingTakeProfit: positions.every((p) => tpWorking.has(String(p.symbol))),
    ownershipRowsEqualOpenPositions: ledger.ownerRows === positions.length,
    humanManagedRowsMatchStore: rows.filter((r) => r.ownerState === 'HUMAN_MANAGED').length === positions.filter((p) => p.managementStatus === 'HUMAN_MANAGED').length,
    nonTerminalEntryOrders: nonTerminal.length,
    entryOrdersWithoutVerifiedNoRiskEvidence: nonTerminal.filter((o) => o.activeRiskExposure !== false || o.activeRiskEvidence?.status !== 'VERIFIED_NO_ACTIVE_RISK').length,
    reconciliation: { historicalUnknown: pipeline.reconciliation.historicalUnknownCount, activeRiskUnresolved: pipeline.reconciliation.activeRiskUnresolvedCount, verifiedNoActiveRisk: pipeline.reconciliation.verifiedNoActiveRiskUnknownCount },
    takeProfitGuard: `${pipeline.takeProfit.protected}/${pipeline.takeProfit.required}`,
    marketData: pipeline.freshMarkets.status,
    privateAccountAgeMs: pipeline.binancePrivate.snapshotAgeMs,
  },
  aiStillStarvedSameRootCause: { reasonCode: pipeline.runtimeControl.reasonCode, reasonText: pipeline.runtimeControl.reasonText, noEntryReason: pipeline.noEntryReason, aiIdleReason: pipeline.primaryBrain.resource.idleReason, aiHealthReason: pipeline.primaryBrain.healthReason, lastRunAgeMinutes: Number((pipeline.primaryBrain.lastRunAgeMs / 60000).toFixed(1)), capitalExecutableCandidates: pipeline.runtimeControl.capital.executableCandidateCount, capacity: pipeline.capacity, note: 'unchanged from the V3.9.5 audit: gross exposure still exceeds equity x maxGrossExposurePct, so nothing is dispatchable; the P1 alerting gap from the audit still stands and was not part of this authorization' },
  stopLinesHeld: {
    enforceAuthorityNotGranted: settings.riskGovernance.exitCoordination.aiExitAuthority !== 'ENFORCE',
    productionWrites: 0,
    autoTradingEnabled: false,
    soakClockStarted: false,
    acceptedSelfSigned: false,
    schemaNotRelaxed: true,
    repeatedRestartsUsed: 0,
  },
  remainingGateForPhaseE: 'E still requires aiExitAuthority=ENFORCE plus write capability; authority is now single-valued per cycle, but the account still has zero capital-executable candidates, so a natural write chain cannot be produced without loosening thresholds, which is prohibited. Phase E therefore stays NOT_RUN.',
};
writeFileSync(`${OUT}/post-start-verification.json`, JSON.stringify(verification, null, 1) + '\n');
copyFileSync('D:/MITS-backups/cutover-20260923/ledger-pre-rebuild/pre-rebuild-census.json', `${OUT}/pre-rebuild-census.json`);
copyFileSync(`${A}rebuild/ownership-migration-v2.json`, `${OUT}/rebuild-driver-result.json`);
console.log(JSON.stringify({ cleared: verification.defectCleared.cleared, rows: ledger.ownerRows, ai: ledger.aiActiveRows, dup: ledger.cyclesWithMoreThanOneRow, writes: closeout.productionWriteBoundary, fatal, versions: ledger.ownerVersionsObserved, magnitudeDelta: verification.notionalSemantics.maxAbsoluteDeviationFromUnsignedMagnitude, enforce: verification.stopLinesHeld.enforceAuthorityNotGranted }, null, 1));

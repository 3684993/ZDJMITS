import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const life = readFileSync('D:/MITS/data/runtime-logs/engine-process-lifecycle.jsonl', 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((l) => JSON.parse(l))
  .filter((r) => r.instanceId === identity.instanceId || Number(r.pid) === identity.pid);

const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const positions = db
  .prepare("select payload from runtime_entities where kind='positions'")
  .all()
  .map((r) => JSON.parse(String(r.payload)));
const fatal = db
  .prepare("select ts,type,payload from runtime_events where type in ('ENGINE_FATAL_ERROR','RUNTIME_STOPPING','RUNTIME_STOPPED','ENGINE_INSTANCE_STARTED') and ts>=? order by ts")
  .all(identity.startedAt);
const settings = JSON.parse(String(db.prepare('select payload from settings where id=1').get().payload));
const ownership = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', { readOnly: true });
const owners = ownership.prepare('select cycle_id, payload from v396_owners').all().map((r) => JSON.parse(String(r.payload)));
const tpWorking = db.prepare("select count(*) n from runtime_entities where kind='tpOrders'").get().n;
db.close();
ownership.close();

const firstPath = (payload) => {
  try {
    const issues = JSON.parse(String(payload));
    return Array.isArray(issues) ? issues.slice(0, 3).map((i) => i.path?.join('.')) : null;
  } catch {
    return null;
  }
};
const fatalRow = fatal.find((r) => r.type === 'ENGINE_FATAL_ERROR');
const zodIssues = (() => {
  try {
    return JSON.parse(JSON.parse(String(fatalRow.payload)).message);
  } catch {
    return null;
  }
})();

const report = {
  incidentId: 'v396-d-phase-fatal-20260923',
  generatedAtUtc8: ts8(Date.now()),
  verdict: 'P0_CUTOVER_HALTED_AT_PHASE_D',
  engine: {
    instanceId: identity.instanceId,
    pid: identity.pid,
    version: identity.version,
    buildId: identity.buildId,
    artifactHash: identity.artifactHash,
    sourceHash: identity.sourceHash,
    startReason: identity.startReason,
    startedUtc8: ts8(identity.startedAt),
    fatalAtUtc8: ts8(fatalRow?.ts),
    uptimeSecondsAtFatal: Number(((Number(fatalRow?.ts) - identity.startedAt) / 1000).toFixed(1)),
    sourceCommit: '1e97b69 on codex/v396-final-convergence-20260922',
    distBuild: 'built by `npm run verify` in the convergence worktree, exit code 0',
    launchMethod: 'scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall (single manual start, as authorized)',
    dataDirectory: 'D:/MITS/data reached through the worktree data junction, so the migrated Testnet store is the one in use',
  },
  failure: {
    kind: 'uncaughtException -> process.on(uncaughtException) -> shutdown(UNCAUGHT_EXCEPTION, exitCode 1)',
    errorName: 'ZodError',
    issueCount: Array.isArray(zodIssues) ? zodIssues.length : null,
    failingPaths: Array.isArray(zodIssues) ? [...new Set(zodIssues.map((i) => i.path?.join('.')))] : firstPath(fatalRow?.payload),
    constraintViolated: 'packages/contracts/src/trading.ts:125 notionalUsd: z.number().nonnegative().nullable().default(null)',
    throwSite: 'packages/contracts DashboardSnapshotSchema.parse called from apps/engine/src/api/projections.ts:128 (positions passed unchanged at :189)',
    trigger: 'apps/engine/src/api/router.ts:35 schedules publishSnapshot() 250ms after every runtime event, and :34 calls it once at router construction; the throw is therefore self-triggered and does not require an operator request',
    fatalHandlerSite: 'apps/engine/src/main.ts:33',
    reproduction: 'Load any durable store containing at least one SHORT position under V3.9.6 READ_ONLY/SHADOW and let private sync populate positions; the next snapshot publication throws and the process exits with code 1.',
  },
  dataContradiction: {
    positionsTotal: positions.length,
    withNotionalUsdField: positions.filter((p) => p.notionalUsd !== undefined).length,
    negativeNotionalUsd: positions.filter((p) => Number(p.notionalUsd) < 0).length,
    positiveNotionalUsd: positions.filter((p) => Number(p.notionalUsd) > 0).length,
    shortSide: positions.filter((p) => p.side === 'SHORT').length,
    longSide: positions.filter((p) => p.side === 'LONG').length,
    everyShortIsNegative: positions.every((p) => p.side !== 'SHORT' || Number(p.notionalUsd) < 0),
    everyLongIsPositive: positions.every((p) => p.side !== 'LONG' || Number(p.notionalUsd) > 0),
    examples: positions.filter((p) => Number(p.notionalUsd) < 0).slice(0, 3).map((p) => ({ symbol: p.symbol, side: p.side, notionalUsd: p.notionalUsd, absQuantityTimesMark: Number((Math.abs(Number(p.quantity)) * Number(p.markPrice)).toFixed(4)) })),
    reading: 'V3.9.6 persists exchange-signed notional (negative for SHORT) on the position row, while its own contract declares the same field non-negative. The two layers disagree about what notionalUsd means: signed direction exposure versus unsigned magnitude.',
    wasPresentBeforeCutover: 'the V3.9.5 position rows written before this cutover carried no notionalUsd field at all, so the contradiction is introduced by V3.9.6 sync, not inherited from migrated data',
  },
  lifecycleRecords: life.filter((r) => /UNCAUGHT|FATAL|SHUTDOWN|PROCESS_EXIT|HTTP_SERVER_CLOSED/.test(String(r.event))).map((r) => ({ utc8: ts8(r.ts), event: r.event, exitCode: r.exitCode, reason: r.payload?.reason ?? null, errorName: r.payload?.error?.name ?? null })),
  fatalEventPayloadPreview: String(JSON.parse(String(fatalRow?.payload ?? '{}')).message ?? '').slice(0, 400),
  settingsAtFatal: { settingsVersion: settings.settingsVersion, executionMode: settings.connections.executionMode, aiExitAuthority: settings.riskGovernance?.exitCoordination?.aiExitAuthority, positionReviewEnabled: settings.riskGovernance?.exitCoordination?.positionReviewEnabled, admissionMode: settings.tradeEconomics?.admissionMode, environment: settings.connections.exchange.environment },
  migratedLedgerAtFatal: {
    ownerRows: owners.length,
    ownerStateTally: owners.reduce((m, o) => ((m[o.ownerState] = (m[o.ownerState] ?? 0) + 1), m), {}),
    ownershipLedgerBytes: statSync('D:/MITS/data/v396-ownership.sqlite').size,
    ownershipLedgerSha256: createHash('sha256').update(readFileSync('D:/MITS/data/v396-ownership.sqlite')).digest('hex'),
    tpOrderEntitiesPersisted: tpWorking,
  },
  exchangeWriteAudit: {
    productionWriteRequests: 0,
    note: 'executionMode was READ_ONLY for the entire V3.9.6 run and aiExitAuthority was SHADOW; the phase-D SHADOW write-count criterion could not be evaluated over an observation window because the process died before one completed, so it stays NOT_RUN rather than PASS',
  },
  postIncidentState: {
    engineRunning: false,
    listenersOn8080: 0,
    v395RestartedAutomatically: false,
    rollbackAvailable: { coldImage: 'D:/MITS-backups/cutover-20260923/cold/zdj-settings.sqlite', sha256Prefix: '88c8ed2eca109534', settingsVersionAtBackup: 189 },
    positionsLeftUnmanaged: positions.length,
    positionsProtectedExchangeSide: 'the 29 take-profit orders were WORKING on Binance at stop time; they are exchange-side and remain active while no engine runs',
  },
  stopLineCompliance: {
    didNotRestartToObtainGreen: true,
    didNotRelaxSchemaOrThreshold: true,
    didNotDeleteAssertions: true,
    didNotFabricateFacts: true,
    phaseEExecuted: false,
    phaseFSucceeded: false,
    acceptedSelfSigned: false,
  },
};
writeFileSync(joinPath(OUT, 'crash-forensics.json'), JSON.stringify(report, null, 1) + '\n');
function joinPath(dir, file) {
  return dir.replace(/\/$/, '') + '/' + file;
}
console.log(JSON.stringify({ verdict: report.verdict, fatalAt: report.engine.fatalAtUtc8, uptimeS: report.engine.uptimeSecondsAtFatal, paths: report.failure.failingPaths, shorts: report.dataContradiction.negativeNotionalUsd, owners: report.migratedLedgerAtFatal.ownerStateTally }, null, 1));

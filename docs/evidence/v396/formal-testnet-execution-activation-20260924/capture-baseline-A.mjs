// Section A: read-only activation baseline for the formal Testnet execution round.
// GET + node:sqlite readOnly only. Performs no settings write and no exchange write.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/evidence/v396/formal-testnet-execution-activation-20260924';
mkdirSync(DIR, {recursive: true});
const BASE = 'http://127.0.0.1:8080';
const g = async path => {
  const r = await fetch(BASE + path);
  return r.ok ? await r.json() : {httpStatus: r.status};
};
const now = Date.now();
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const [health, settings, pipeline, closeout, governance, positions] = await Promise.all([
  g('/health'), g('/api/v3/settings'), g('/api/v3/pipeline'), g('/api/v3/diagnostics/closeout'),
  g('/api/v3/settings/governance'), g('/api/v3/positions'),
]);
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly: true});
const since = now - 30 * 60 * 1000;
const eventCounts = {};
for (const row of db.prepare('SELECT type, COUNT(*) n FROM runtime_events WHERE ts>=? GROUP BY type').all(since)) eventCounts[row.type] = Number(row.n);
const runs = db.prepare('SELECT role, status, COUNT(*) n FROM ai_runs_archive WHERE started_at>=? GROUP BY role,status').all(since)
  .reduce((a, r) => ((a[`${r.role}:${r.status}`] = Number(r.n)), a), {});
const unknown = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='entryOrders'").all()
  .map(r => JSON.parse(r.payload)).filter(row => row.status === 'UNKNOWN');
const own = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', {readOnly: true});
const owners = own.prepare('SELECT cycle_id, payload FROM v396_owners').all().map(r => ({cycle: r.cycle_id, state: JSON.parse(r.payload).ownerState}));

const risk = settings.riskGovernance ?? {};
const portfolioRisk = risk.portfolioRisk ?? null;
const profileRow = (governance.fields ?? []).filter(f => String(f.path).startsWith('riskGovernance.portfolioRisk'));

const out = {
  capturedAt: new Date(now).toISOString(),
  sourceOfTruth: 'GET /health, /api/v3/settings, /api/v3/settings/governance, /api/v3/pipeline, /api/v3/diagnostics/closeout, /api/v3/positions + node:sqlite readOnly',
  head: {deployedProductCommit: 'd570befca02e952bf174d3e1f42b93cf241285a3', evidenceCommit: '14be196', plan: 'docs/plans/v396/CODEX-V396-FORMAL-TESTNET-EXECUTION-ACTIVATION-20260924.md'},
  liveIdentity: {pid: identity.pid, instanceId: identity.instanceId, buildId: identity.buildId, artifactHash: identity.artifactHash, sourceHash: identity.sourceHash, startReason: identity.startReason, startedAtIso: new Date(identity.startedAt).toISOString(), restartCount: identity.restartCount,
    buildIdMatchesDeployedRoundArtifact: identity.buildId === '3.9.6-eaaabc52c682cc1ce56a'},
  health: {status: health.status, ready: health.ready, database: health.checks?.database, marketStream: health.checks?.marketStream?.state, privateData: health.checks?.privateData?.status ?? health.checks?.privateData},
  boundary: {environment: settings.connections?.exchange?.environment, executionMode: settings.connections?.executionMode, writeBoundary: closeout.productionWriteBoundary},
  settingsVersion: settings.settingsVersion,
  riskGovernanceReadback: profileRow,
  outerRiskValues: {maxGrossExposurePct: risk.maxGrossExposurePct, maxDirectionExposurePct: risk.maxDirectionExposurePct, maxClusterExposurePct: risk.maxClusterExposurePct, maxClusterDirectionExposurePct: risk.maxClusterDirectionExposurePct, maxPositions: settings.portfolio?.maxPositions, entrySafetyMode: risk.entrySafetyMode, aiExitAuthority: risk.exitCoordination?.aiExitAuthority, minHistoricalReachProbability: settings.tradeEconomics?.minHistoricalReachProbability},
  portfolioRiskRow: portfolioRisk,
  profileReadback: pipeline.portfolioRiskProfile ?? null,
  freshEquity: (() => {
    const privateData = health.checks?.privateData ?? {};
    const equityUsd = Number(privateData.equityUsd ?? pipeline.binancePrivate?.equityUsd ?? NaN);
    const asOf = Number(privateData.asOf ?? pipeline.binancePrivate?.asOf ?? 0);
    return {equityUsd: Number.isFinite(equityUsd) ? equityUsd : null, walletBalanceUsd: Number(privateData.walletBalanceUsd ?? null), availableUsd: Number(privateData.availableUsd ?? null),
      status: privateData.status ?? null, asOf, ageMs: asOf ? now - asOf : null, freshWithin60s: asOf ? now - asOf <= 60_000 : false, source: 'GET /health checks.privateData'};
  })(),
  executionReadiness: pipeline.executionReadiness ?? null,
  privateFacts: {status: pipeline.binancePrivate?.status, reason: pipeline.binancePrivate?.reason ?? null, consecutiveFailures: pipeline.privateSync?.consecutiveFailures ?? null, lastError: pipeline.privateSync?.lastError ?? null},
  egress: closeout.runtime?.egress ?? pipeline.egress ?? null,
  positions: {count: Array.isArray(positions) ? positions.length : null, tp: pipeline.takeProfit, allProtected: Array.isArray(positions) && positions.every(p => p.tpStatus === 'PROTECTED'), allHumanManaged: Array.isArray(positions) && positions.every(p => p.managementStatus === 'HUMAN_MANAGED')},
  ownership: {rows: owners.length, cycles: new Set(owners.map(o => o.cycle)).size, aiActive: owners.filter(o => o.state === 'AI_ACTIVE').length, duplicateCycles: owners.length - new Set(owners.map(o => o.cycle)).size},
  persistence: health.checks?.database ?? null,
  unknownDurable: {count: unknown.length, withExpiresAtNull: unknown.filter(r => r.expiresAt == null).length},
  authoritativePending: pipeline.runtimeControl?.capital?.executableCandidateCount ?? null,
  modelSpendBaseline30Minutes: {runs, eventCounts},
};
writeFileSync(`${DIR}/activation-baseline-A.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({build: out.liveIdentity.buildId, matches: out.liveIdentity.buildIdMatchesDeployedRoundArtifact, v: out.settingsVersion, mode: out.boundary.executionMode, writes: `${out.boundary.writeBoundary.testnetWrites}/${out.boundary.writeBoundary.productionWrites}`,
  equity: pipeline.account?.equityUsd ?? closeout.runtime?.equityUsd ?? null, caps: out.outerRiskValues, profileStatus: pipeline.portfolioRiskProfile?.status,
  readiness: pipeline.executionReadiness?.blockers, privateStatus: out.privateFacts.status, positions: out.positions.count, tp: out.positions.tp?.protected, unknown: out.unknownDurable.count, runs}, null, 1));
db.close(); own.close();

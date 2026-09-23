// Read-only deployment-round snapshot: identity, boundary, model spend, supply, ownership, TP.
// Usage: node snapshot.mjs <label>
// It writes nothing outside its own evidence JSON and performs no settings or lifecycle action.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const label = process.argv[2] ?? 'snapshot';
const BASE = 'http://127.0.0.1:8080';
const WINDOW_MIN = 30;
const now = Date.now();
const get = async path => {
  try {
    const res = await fetch(BASE + path);
    return res.ok ? await res.json() : { httpStatus: res.status };
  } catch (error) {
    return { fetchError: String(error?.message ?? error) };
  }
};
const settings = await get('/api/v3/settings');
const closeout = await get('/api/v3/diagnostics/closeout');
const pipeline = await get('/api/v3/pipeline');
const health = await get('/health');
const runtime = await get('/api/v3/ops/runtime');
const positions = await get('/api/v3/positions');
const human = await get('/api/v3/human-managed');
const supply = await get('/api/v3/diagnostics/supply');
const entryIntegrity = await get('/api/v3/diagnostics/p0-entry-integrity');

const parse = raw => { try { return JSON.parse(raw); } catch { return {}; } };
const settingsRow = settings?.data ?? settings ?? {};
const risk = settingsRow.riskGovernance ?? {};
const exit = risk.exitCoordination ?? {};

const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const since = now - WINDOW_MIN * 60_000;
const eventCounts = {};
for (const row of db.prepare('SELECT type, COUNT(*) n FROM runtime_events WHERE ts>=? GROUP BY type').all(since)) eventCounts[row.type] = Number(row.n);
const brainByRole = db.prepare("SELECT role, status, COUNT(*) n FROM ai_runs_archive WHERE started_at>=? GROUP BY role, status").all(since,).reduce((a, r) => {
  a[`${r.role ?? 'NULL'}:${r.status}`] = Number(r.n); return a;
}, {});
const lastPrimary = db.prepare("SELECT run_id, symbol, role, status, decision, started_at, completed_at FROM ai_runs_archive WHERE role='PRIMARY_BRAIN' ORDER BY started_at DESC LIMIT 3").all();
const instanceId = closeout?.runtime?.instanceId ?? null;
const instanceStartedAt = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8')).startedAt ?? 0;
const brainSinceStart = instanceId ? db.prepare("SELECT role, status, COUNT(*) n FROM ai_runs_archive WHERE started_at>=? GROUP BY role, status").all(instanceStartedAt).reduce((a, r) => ((a[`${r.role ?? 'NULL'}:${r.status}`] = Number(r.n)), a), {}) : {};

const own = new DatabaseSync('D:/MITS/data/v396-ownership.sqlite', { readOnly: true });
const scalar = sql => Number(own.prepare(sql).get()?.n ?? 0);
const ownership = {
  owners: scalar('SELECT COUNT(*) n FROM v396_owners'),
  cycles: Number(own.prepare('SELECT COUNT(DISTINCT cycle_id) n FROM v396_owners').get().n),
  aiActive: scalar("SELECT COUNT(*) n FROM v396_owners WHERE json_extract(payload,'$.ownerState')='AI_ACTIVE'"),
  outboxPending: scalar('SELECT COUNT(*) n FROM v396_outbox WHERE delivered=0'),
};

const positionItems = Array.isArray(positions) ? positions : Array.isArray(positions?.positions) ? positions.positions : Array.isArray(positions?.items) ? positions.items : [];
const snapshot = {
  label,
  capturedAt: new Date(now).toISOString(),
  identityFile: JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8')),
  health: { status: health?.status, ready: health?.ready, checks: health?.checks },
  runtime: { instanceId: runtime?.instanceId ?? closeout?.runtime?.instanceId, pid: runtime?.pid ?? closeout?.runtime?.pid, buildId: runtime?.buildId ?? closeout?.runtime?.buildId, uptimeMs: runtime?.uptimeMs, startReason: runtime?.startReason },
  settings: {
    settingsVersion: settingsRow.settingsVersion ?? closeout?.pipeline?.portfolioRiskProfile?.settingsVersion ?? null,
    environment: settingsRow.connections?.exchange?.environment,
    executionMode: settingsRow.connections?.executionMode,
    entrySafetyMode: risk.entrySafetyMode,
    aiExitAuthority: exit.aiExitAuthority,
    maxGrossExposurePct: risk.maxGrossExposurePct,
    maxDirectionExposurePct: risk.maxDirectionExposurePct,
    maxPositions: settingsRow.portfolio?.maxPositions,
    portfolioRiskConfigured: risk.portfolioRisk?.configured,
  },
  writeBoundary: closeout?.productionWriteBoundary,
  persistence: closeout?.runtime?.persistence ?? health?.checks?.database ?? null,
  pipelineFacts: {
    pipelineState: pipeline?.pipelineState,
    noEntryReason: pipeline?.noEntryReason,
    eligibility: pipeline?.eligibility,
    capacity: pipeline?.capacity,
    capacityVisibility: pipeline?.capacityVisibility,
    analysis: pipeline?.analysis,
    executionReadinessProjected: pipeline?.executionReadiness !== undefined,
    executionReadiness: pipeline?.executionReadiness ?? null,
    portfolioRiskProfileStatus: pipeline?.portfolioRiskProfile?.status ?? null,
    portfolioRiskProfileConfigured: pipeline?.portfolioRiskProfile?.configured ?? pipeline?.portfolioRiskProfile?.values?.configured ?? null,
    privateSync: pipeline?.privateSync,
    binancePrivate: pipeline?.binancePrivate,
    universeEligible: Array.isArray(pipeline?.universe) ? pipeline.universe.filter(x => x?.eligible).length : null,
    pool: pipeline?.pool,
    takeProfit: pipeline?.takeProfit,
    reconciliation: pipeline?.reconciliation,
  },
  supply: supply && Object.keys(supply).length ? { note: 'see rawSupply', raw: supply } : null,
  positions: { count: positionItems.length, tpByStatus: positionItems.reduce((a, p) => ((a[p?.tpStatus ?? 'NULL'] = (a[p?.tpStatus ?? 'NULL'] ?? 0) + 1), a), {}), management: positionItems.reduce((a, p) => ((a[p?.managementStatus ?? 'NULL'] = (a[p?.managementStatus ?? 'NULL'] ?? 0) + 1), a), {}) },
  humanManaged: { count: human?.count ?? null, notionalUsd: human?.notionalUsd ?? null, caps: human?.caps ?? null },
  entryIntegrity,
  ownership,
  modelSpend: { windowMinutes: WINDOW_MIN, eventCounts, aiRunsByRoleAndStatus: brainByRole, aiRunsSinceInstanceStart: brainSinceStart, lastPrimary },
};

writeFileSync(`docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923/${label}.json`, JSON.stringify(snapshot, null, 2) + '\n');
const b = snapshot.writeBoundary;
console.log(`${label}: pid=${snapshot.runtime?.pid} build=${snapshot.runtime?.buildId} mode=${snapshot.settings?.executionMode} v=${snapshot.settings?.settingsVersion} writes=${b?.testnetWrites}/${b?.productionWrites} lastWriteAt=${b?.lastWriteAt} positions=${snapshot.positions.count} tp=${JSON.stringify(snapshot.positions.tpByStatus)} readinessProjected=${snapshot.pipelineFacts.executionReadinessProjected} PRIMARY=${brainByRole["PRIMARY_BRAIN:COMPLETED"] ?? 0} SCOUT=${brainByRole["SCOUT:COMPLETED"] ?? 0} ANALYSIS_ONLY=${eventCounts.ANALYSIS_ONLY_COMPLETED ?? 0}`);
db.close(); own.close();

// Anti-waste acceptance sampler: proves zero model spend while deterministic supply keeps moving,
// counted only from this instance's start. Read-only: HTTP GET plus node:sqlite readOnly.
// Usage: node anti-waste-window.mjs <samples> <secondsBetween>
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const samples = Number(process.argv[2] ?? 4);
const gapMs = Number(process.argv[3] ?? 90) * 1000;
const BASE = 'http://127.0.0.1:8080';
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const startedAt = Number(identity.startedAt);
const get = async path => {
  try { const r = await fetch(BASE + path); return r.ok ? await r.json() : { httpStatus: r.status }; } catch (e) { return { fetchError: String(e?.message ?? e) }; }
};
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const runsSinceStart = () => db.prepare('SELECT role, status, COUNT(*) n FROM ai_runs_archive WHERE started_at>=? GROUP BY role,status').all(startedAt)
  .reduce((a, r) => ((a[`${r.role ?? 'NULL'}:${r.status}`] = Number(r.n)), a), {});
const eventsSince = types => {
  const marks = types.map(() => '?').join(',');
  return db.prepare(`SELECT type, COUNT(*) n FROM runtime_events WHERE ts>=? AND type IN (${marks}) GROUP BY type`).all(startedAt, ...types)
    .reduce((a, r) => ((a[r.type] = Number(r.n)), a), {});
};
const WATCHED = ['AI_RUN_TERMINAL', 'ANALYSIS_ONLY_COMPLETED', 'ANALYSIS_DISPATCH_INTENT', 'ANALYSIS_DISPATCH_HEARTBEAT', 'POOL_ANALYSIS_STARTED',
  'EXECUTION_READINESS_BLOCKED', 'EXECUTION_READINESS_RESUMED', 'ENTRY_ADMISSION_BLOCKED', 'ENTRY_DECISION_BLOCKED', 'ENTRY_ORDER_SUBMIT',
  'PRIMARY_DECISION_NORMALIZED', 'TRADE_PLAN_PERSISTED', 'CANDIDATE_LIFECYCLE_CHANGED', 'CANDIDATE_LIFECYCLE_REDERIVED', 'CANDIDATE_SUPPLY_HEALTH',
  'MARKET_COHORT_REFILLED', 'MARKET_COHORT_RETIRED', 'MARKET_COHORT_FAILED', 'PRIVATE_SYNC_FAILED', 'PRIVATE_SYNC_RECOVERED', 'RECONCILIATION_FAILED'];

const taken = [];
for (let i = 0; i < samples; i++) {
  const at = Date.now();
  const pipeline = await get('/api/v3/pipeline');
  const hot = await get('/api/v3/diagnostics/supply');
  const health = await get('/health');
  taken.push({
    at, iso: new Date(at).toISOString(),
    executionReadiness: pipeline?.executionReadiness ?? null,
    profileStatus: pipeline?.portfolioRiskProfile?.status ?? null,
    analysis: { reason: pipeline?.analysis?.reason, mode: pipeline?.analysis?.mode, lastAttemptAt: pipeline?.analysis?.lastAttemptAt, lastRequestAt: pipeline?.analysis?.lastRequestAt, lastSuccessAt: pipeline?.analysis?.lastSuccessAt, capitalExecutableCount: pipeline?.analysis?.capitalExecutableCount, silenceMs: pipeline?.analysis?.silenceMs, execution: pipeline?.analysis?.execution ?? null },
    supply: { eligibility: pipeline?.eligibility, pool: pipeline?.pool, universe: Array.isArray(pipeline?.universe) ? pipeline.universe.length : pipeline?.universe, capacity: pipeline?.capacity, capacityVisibility: pipeline?.capacityVisibility, marketFreshness: { state: health?.checks?.marketStream?.state ?? null, lastMessageAt: health?.checks?.marketStream?.lastMessageAt ?? null, subscriptions: health?.checks?.marketStream?.subscriptions ?? null, reconnects: health?.checks?.marketStream?.reconnects ?? null, pipelineAsOf: pipeline?.asOf ?? null }, work: pipeline?.work, primaryBrain: { status: pipeline?.primaryBrain?.status, idleReason: pipeline?.primaryBrain?.idleReason, nextStep: pipeline?.primaryBrain?.resource?.nextStep ?? null } },
    privateFacts: { status: pipeline?.binancePrivate?.status, asOf: pipeline?.binancePrivate?.asOf, snapshotAgeMs: pipeline?.privateSync?.snapshotAgeMs, consecutiveFailures: pipeline?.privateSync?.consecutiveFailures, lastError: pipeline?.privateSync?.lastError },
    reconciliation: { status: pipeline?.reconciliation?.status, historicalUnknownCount: pipeline?.reconciliation?.historicalUnknownCount, verifiedNoActiveRiskUnknownCount: pipeline?.reconciliation?.verifiedNoActiveRiskUnknownCount, activeRiskUnresolvedCount: pipeline?.reconciliation?.activeRiskUnresolvedCount },
    supplyDiagnosticsKeys: hot && typeof hot === 'object' ? Object.keys(hot).slice(0, 12) : null,
  });
  if (i < samples - 1) await new Promise(resolve => setTimeout(resolve, gapMs));
}

const at = Date.now();
const result = {
  instance: { pid: identity.pid, instanceId: identity.instanceId, buildId: identity.buildId, startReason: identity.startReason, startedAt, startedAtIso: new Date(startedAt).toISOString() },
  sampleCount: taken.length, gapSeconds: gapMs / 1000, windowMs: at - taken[0].at,
  aiRunsSinceInstanceStart: runsSinceStart(),
  eventsSinceInstanceStart: eventsSince(WATCHED),
  samples: taken,
  verdict: null,
  capturedAt: new Date(at).toISOString(),
};
const runs = result.aiRunsSinceInstanceStart;
const modelCalls = (runs['PRIMARY_BRAIN:COMPLETED'] ?? 0) + (runs['PRIMARY_BRAIN:RUNNING'] ?? 0) + (runs['PRIMARY_BRAIN:FAILED'] ?? 0) + (runs['SCOUT:COMPLETED'] ?? 0) + (runs['SCOUT:RUNNING'] ?? 0) + (runs['SCOUT:FAILED'] ?? 0);
const lifecycle = (result.eventsSinceInstanceStart.CANDIDATE_LIFECYCLE_REDERIVED ?? 0) + (result.eventsSinceInstanceStart.CANDIDATE_LIFECYCLE_CHANGED ?? 0);
const freshness = taken.map(s => s.supply.marketFreshness?.lastMessageAt ?? 0);
const readinessStable = taken.every(s => s.executionReadiness && s.executionReadiness.modelSpendPermitted === false && s.executionReadiness.intent === true);
result.verdict = {
  zeroModelCallsOnNewInstance: modelCalls === 0,
  modelCallsObserved: modelCalls,
  readinessBlockedEverySample: readinessStable,
  supplyMaintenanceStillRunning: lifecycle > 0 && freshness.at(-1) > freshness[0],
  candidateLifecycleEvents: lifecycle,
  marketLastMessageAdvanced: `${freshness[0]} -> ${freshness.at(-1)}`,
  noEntrySubmit: (result.eventsSinceInstanceStart.ENTRY_ORDER_SUBMIT ?? 0) === 0 && (result.eventsSinceInstanceStart.TRADE_PLAN_PERSISTED ?? 0) === 0,
};
writeFileSync('docs/evidence/v396/deploy-e284a1a-anti-waste-20260923/no-model-spend-window.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ window: result.verdict, events: result.eventsSinceInstanceStart }, null, 1));
db.close();

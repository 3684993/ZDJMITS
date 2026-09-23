// Read-only post-deploy readbacks: execution readiness, supply maintenance, log scan, t-late snapshot.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DIR = 'docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923';
const instance = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const json = path => JSON.parse(execFileSync('curl', ['-s', '--max-time', '10', `http://127.0.0.1:8080${path}`], { maxBuffer: 9e7 }).toString());
const pipe = json('/api/v3/pipeline');
const health = json('/health');
const closeout = json('/api/v3/diagnostics/closeout');
const positions = json('/api/v3/positions');
const win = JSON.parse(readFileSync(`${DIR}/no-model-spend-window.json`, 'utf8'));

writeFileSync(`${DIR}/execution-readiness-readback.json`, JSON.stringify({
  capturedAtIso: new Date().toISOString(),
  instance: { pid: instance.pid, instanceId: instance.instanceId, buildId: instance.buildId, startReason: instance.startReason, startedAtIso: new Date(instance.startedAt).toISOString() },
  executionReadiness: pipe.executionReadiness,
  portfolioRiskProfile: {
    status: pipe.portfolioRiskProfile?.status ?? null,
    configured: pipe.portfolioRiskProfile?.configured ?? pipe.portfolioRiskProfile?.values?.configured ?? null,
    settingsVersion: pipe.portfolioRiskProfile?.settingsVersion ?? null,
    blockers: pipe.portfolioRiskProfile?.blockers ?? null,
    missingFields: pipe.portfolioRiskProfile?.missingFields ?? null,
  },
  analysis: pipe.analysis,
  expectations: {
    intentTrue: pipe.executionReadiness?.intent === true,
    readyFalse: pipe.executionReadiness?.ready === false,
    modelSpendPermittedFalse: pipe.executionReadiness?.modelSpendPermitted === false,
    writeLockedInBlockers: (pipe.executionReadiness?.blockers ?? []).includes('EXECUTION_WRITE_LOCKED'),
    profileStatusNotConfigured: pipe.executionReadiness?.profileStatus === 'PROFILE_NOT_CONFIGURED' && pipe.portfolioRiskProfile?.status === 'PROFILE_NOT_CONFIGURED',
    blockerOrderMatchesCodePredicate: (pipe.executionReadiness?.blockers ?? []).join(',') === (pipe.executionReadiness?.blockers ?? []).slice().sort((a, b) => ['ENVIRONMENT_NOT_TESTNET', 'EXECUTION_WRITE_LOCKED', 'PRIVATE_DATA_UNAVAILABLE', 'RUNTIME_NOT_RUNNING', 'POLICY_NOT_AUTO', 'RISK_PROFILE_UNCONFIGURED', 'NO_EXECUTABLE_CANDIDATE'].indexOf(a) - ['ENVIRONMENT_NOT_TESTNET', 'EXECUTION_WRITE_LOCKED', 'PRIVATE_DATA_UNAVAILABLE', 'RUNTIME_NOT_RUNNING', 'POLICY_NOT_AUTO', 'RISK_PROFILE_UNCONFIGURED', 'NO_EXECUTABLE_CANDIDATE'].indexOf(b)).join(','),
  },
  writeBoundary: closeout.productionWriteBoundary,
}, null, 2) + '\n');

writeFileSync(`${DIR}/supply-maintenance-readback.json`, JSON.stringify({
  source: 'no-model-spend-window.json samples, same live process',
  verdict: win.verdict,
  eventsSinceInstanceStart: win.eventsSinceInstanceStart,
  samples: win.samples.map(s => ({
    at: s.at,
    local: new Date(s.at).toLocaleString(),
    marketFreshness: s.supply.marketFreshness,
    pool: s.supply.pool,
    eligibility: s.supply.eligibility,
    capacity: s.supply.capacity,
    readinessFirstBlocker: s.executionReadiness?.firstBlocker ?? null,
    blockers: s.executionReadiness?.blockers ?? null,
    executableCandidateCount: s.executionReadiness?.executableCandidateCount ?? null,
    reconciliation: { historicalUnknown: s.reconciliation?.historicalUnknownCount, verifiedNoActiveRisk: s.reconciliation?.verifiedNoActiveRiskUnknownCount, activeRiskUnresolved: s.reconciliation?.activeRiskUnresolvedCount },
  })),
}, null, 2) + '\n');

const logs = ['data/runtime-logs/engine.stdout.log', 'data/runtime-logs/engine.stderr.log'].filter(existsSync);
const matched = logs.flatMap(file => readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /FATAL|uncaughtException|unhandledRejection|\bError\b/.test(l)).slice(-40).map(line => ({ file, line })));
writeFileSync(`${DIR}/post-deploy-log-scan.json`, JSON.stringify({
  capturedAtIso: new Date().toISOString(),
  files: logs,
  health: { status: health.status, ready: health.ready, database: health.checks?.database, marketStream: health.checks?.marketStream?.state, subscriptions: health.checks?.marketStream?.subscriptions, privateData: health.checks?.privateData?.status ?? health.checks?.privateData },
  takeProfit: pipe.takeProfit,
  positions: { count: positions.length, tpByStatus: positions.reduce((a, p) => ((a[p?.tpStatus ?? 'NULL'] = (a[p?.tpStatus ?? 'NULL'] ?? 0) + 1), a), {}) },
  fatalMatches: matched,
  fatalCount: matched.length,
}, null, 2) + '\n');

console.log(JSON.stringify({
  readiness: pipe.executionReadiness,
  expectations: JSON.parse(readFileSync(`${DIR}/execution-readiness-readback.json`, 'utf8')).expectations,
  health: `${health.status}/ready=${health.ready}/db=${health.checks?.database?.integrity}`,
  fatalCount: matched.length,
  writeBoundary: closeout.productionWriteBoundary,
}, null, 1));

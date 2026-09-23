// Read-only live fact capture for the no-wasted-AI round. No lifecycle action, no settings write.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const OUT = 'docs/evidence/v396/execution-no-wasted-ai-20260923';
const WINDOW_MIN = 30;
const now = Date.now();
const get = async url => (await fetch('http://127.0.0.1:8080' + url)).json();
const pipeline = await get('/api/v3/pipeline');
const closeout = await get('/api/v3/diagnostics/closeout');
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const since = now - WINDOW_MIN * 60_000;
const counts = {};
for (const row of db.prepare('SELECT type, COUNT(*) n FROM runtime_events WHERE ts>=? GROUP BY type').all(since)) counts[row.type] = Number(row.n);
const events = type => db.prepare('SELECT ts, payload FROM runtime_events WHERE type=? AND ts>=? ORDER BY ts').all(type, since);
const parse = raw => { try { return JSON.parse(raw); } catch { return {}; } };
const privateFailures = events('PRIVATE_SYNC_FAILED').map(e => ({ at: e.ts, ...parse(e.payload) }));
const privateRecoveries = events('PRIVATE_SYNC_RECOVERED').map(e => ({ at: e.ts, ...parse(e.payload) }));
const admissions = events('PORTFOLIO_RISK_ADMISSION_EVALUATED').map(e => {
  const p = parse(e.payload), blockers = Array.isArray(p.blockers) ? p.blockers : [];
  const families = {};
  for (const b of blockers) {
    const key = String(b).split(/[:[]/)[0];
    families[key] = (families[key] ?? 0) + 1;
  }
  return { at: e.ts, allowed: p.allowed, symbol: p.symbol ?? null, distinctBlockers: blockers.length, families };
});
const profileFacts = pipeline.portfolioRiskProfile ?? null;
const write = (name, value) => writeFileSync(`${OUT}/${name}`, JSON.stringify({ capturedAtLocal: new Date(now).toString(), ...value }, null, 2));

write('live-facts-A.json', {
  source: 'GET /api/v3/pipeline + /api/v3/diagnostics/closeout + node:sqlite readOnly on D:/MITS/data/zdj-settings.sqlite',
  engine: closeout.runtime && { pid: closeout.runtime.pid, buildId: closeout.runtime.buildId, instanceId: closeout.runtime.instanceId },
  writeBoundary: closeout.productionWriteBoundary,
  settingsVersion: profileFacts?.settingsVersion ?? null,
  execution: {
    environment: closeout.productionWriteBoundary?.environment ?? null,
    executionMode: closeout.productionWriteBoundary?.executionMode ?? null,
    analysisMode: pipeline.analysis?.mode ?? null,
    runtimeControlMode: pipeline.runtimeControl?.mode ?? null,
    autoExecutionMode: pipeline.entryPermission?.autoExecutionMode ?? null,
    executionGovernanceMode: pipeline.pipelineState ?? null,
    capitalExecutableCandidateCount: pipeline.runtimeControl?.capital?.executableCandidateCount ?? null,
  },
  privateFacts: {
    binancePrivate: pipeline.binancePrivate,
    privateSync: pipeline.privateSync,
    noEntryReason: pipeline.noEntryReason,
    liveIncludesExecutionReadinessProjection: pipeline.executionReadiness !== undefined,
  },
  portfolioRiskProfileReadback: profileFacts,
  capacityVisibility: pipeline.capacityVisibility,
  capacity: pipeline.capacity,
  analysisDiagnostics: pipeline.analysis,
  eventCountsLastWindow: counts,
  windowMinutes: WINDOW_MIN,
});

write('private-facts-root-cause-D.json', {
  windowMinutes: WINDOW_MIN,
  failures: privateFailures,
  recoveries: privateRecoveries.map(r => ({ at: r.at, trigger: r.trigger, durationMs: r.durationMs })),
  failureErrorCodes: privateFailures.reduce((a, r) => ((a[r.errorCode ?? 'NONE'] = (a[r.errorCode ?? 'NONE'] ?? 0) + 1), a), {}),
  failureDurationsMs: privateFailures.map(r => r.durationMs),
  note: 'consecutiveFailures stays at 1: each poll times out once and the next poll succeeds, so account.status flaps READY/UNAVAILABLE instead of going permanently dark.',
});

write('risk-admission-facts-E.json', {
  windowMinutes: WINDOW_MIN,
  evaluations: admissions,
  latestBlockerFamilies: admissions.at(-1)?.families ?? null,
  profileConfigured: profileFacts?.configured ?? profileFacts?.values?.configured ?? null,
  profileStatus: profileFacts?.status ?? 'NOT_PROJECTED_BY_RUNNING_BUILD',
  note: 'The running build predates profileReadback().status, so the cockpit status is asserted by the offline dashboard test, not by this capture.',
});
db.close();
console.log('captured', new Date(now).toString());

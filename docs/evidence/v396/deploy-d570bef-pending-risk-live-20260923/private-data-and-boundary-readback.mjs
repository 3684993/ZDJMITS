// Read-only private-data observation on the deployed instance, plus the per-instance write-boundary counters.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923';
const identity = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const startedAt = Number(identity.startedAt);
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly: true});
const g = async path => JSON.parse(await (await fetch('http://127.0.0.1:8080' + path)).text());
const pipeline = await g('/api/v3/pipeline');
const closeout = await g('/api/v3/diagnostics/closeout');
const events = type => db.prepare('SELECT ts, payload FROM runtime_events WHERE type=? AND ts>=? ORDER BY ts').all(type, startedAt).map(r => ({at: r.ts, ...JSON.parse(r.payload)}));
const failures = events('PRIVATE_SYNC_FAILED'), recoveries = events('PRIVATE_SYNC_RECOVERED');
const windowMinutes = +((Date.now() - startedAt) / 60_000).toFixed(1);
const durations = failures.map(row => Number(row.durationMs ?? 0));

const out = {capturedAt: new Date().toISOString(), instance: {pid: identity.pid, buildId: identity.buildId, startedAtIso: new Date(startedAt).toISOString()},
  windowMinutes,
  failures: failures.map(f => ({at: f.at, local: new Date(f.at).toLocaleTimeString(), errorCode: f.errorCode ?? null, durationMs: f.durationMs ?? null, consecutiveFailures: f.consecutiveFailures ?? null})),
  recoveryCount: recoveries.length,
  stats: {failures: failures.length, recoveries: recoveries.length,
    errorCodeTally: failures.reduce((a, r) => ((a[r.errorCode ?? 'NONE'] = (a[r.errorCode ?? 'NONE'] ?? 0) + 1), a), {}),
    durationMsRange: durations.length ? [Math.min(...durations), Math.max(...durations)] : null,
    maxConsecutiveFailures: failures.length ? Math.max(...failures.map(f => Number(f.consecutiveFailures ?? 0))) : 0},
  livePrivate: {status: pipeline.binancePrivate?.status ?? null, asOf: pipeline.binancePrivate?.asOf ?? null, snapshotAgeMs: pipeline.privateSync?.snapshotAgeMs ?? null, consecutiveFailures: pipeline.privateSync?.consecutiveFailures ?? null, lastError: pipeline.privateSync?.lastError ?? null},
  executionReadiness: pipeline.executionReadiness,
  perInstanceWriteBoundary: closeout.productionWriteBoundary,
  countersExplained: 'blockedProductionWriteAttempts is per instance: the previous instance ended at 1 (an orphan-TP cancel refused because executionMode is READ_ONLY). A fresh zero on this instance is not proof that nothing ever happened historically.',
  discipline: 'No timeout change, no freshness-window change, no cached fact used to admit a write.'};
writeFileSync(`${DIR}/private-data-and-boundary-readback.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({windowMinutes, stats: out.stats, live: out.livePrivate, readiness: {blockers: out.executionReadiness?.blockers, first: out.executionReadiness?.firstBlocker, spend: out.executionReadiness?.modelSpendPermitted}, boundary: out.perInstanceWriteBoundary}, null, 1));
db.close();

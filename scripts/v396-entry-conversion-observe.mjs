// Read-only observation of natural entry conversion after a deployment: what the Engine itself
// says each Primary run did. GET requests only; no settings write, no lifecycle action, no exchange call.
import { createHash } from 'node:crypto';
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const limit = Number(process.argv[3] ?? 40);
const get = async (path) => {
  const response = await fetch(`${base}${path}`, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`HTTP_${response.status}:${path}`);
  return response.json();
};
const [closeout, pipeline, runs] = await Promise.all([
  get('/diagnostics/closeout'), get('/pipeline'), get(`/brain/runs?role=PRIMARY_BRAIN&limit=${limit}`),
]);
const restartAt = Number(closeout.runtime?.lastRestartAt ?? 0);
const rows = (runs.items ?? []).map((row) => ({
  brainRunId: row.id, symbol: row.symbol, decision: row.decision, direction: row.direction,
  completedAt: row.completedAt ?? row.startedAt ?? null,
  afterRestart: Number(row.completedAt ?? row.startedAt ?? 0) > restartAt,
  execution: row.execution ? {
    state: row.execution.executionState, label: row.execution.executionLabel, blockStage: row.execution.blockStage,
    blockReasons: row.execution.blockReasons, tradePlanId: row.execution.tradePlanId, reservationId: row.execution.reservationId,
    intentId: row.execution.intentId, orderId: row.execution.orderId, clientOrderId: row.execution.clientOrderId,
    exchangeOrderId: row.execution.exchangeOrderId, submittedAt: row.execution.submittedAt, firstFillAt: row.execution.firstFillAt,
    inconsistentFacts: row.execution.inconsistentFacts,
  } : null,
}));
const tally = (list) => list.reduce((counts, row) => {
  const key = `${row.execution?.state ?? 'NO_PROJECTION'}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const dropTally = (list) => list.reduce((counts, row) => {
  const stage = row.execution?.blockStage;
  if (!stage) return counts;
  const key = `${stage} / ${row.execution.blockReasons?.[0] ?? 'UNSPECIFIED'}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const place = rows.filter((row) => String(row.decision ?? '').startsWith('PLACE_'));
const sinceRestart = place.filter((row) => row.afterRestart);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
console.log(JSON.stringify({
  observedAt: new Date().toISOString(),
  identity: {pid: closeout.runtime?.pid, buildId: closeout.runtime?.buildId, instanceId: closeout.runtime?.instanceId, restartAt, uptimeMs: closeout.runtime?.uptimeMs, lastRestartReason: closeout.runtime?.lastRestartReason},
  permission: {entryPermission: pipeline.entryPermission, noEntryReason: pipeline.noEntryReason ?? null, readinessReady: pipeline.executionReadiness?.ready ?? null, firstBlocker: pipeline.executionReadiness?.firstBlocker ?? null, analysis: pipeline.analysis?.mode ?? null, lifecycleCounts: pipeline.candidateLifecycle?.counts ?? null},
  writeBoundary: closeout.productionWriteBoundary ?? null,
  funnel: {thirtyMinutes: pipeline.entryConversion?.thirtyMinutes ?? null, oneHour: pipeline.entryConversion?.oneHour ?? null},
  runs: {scanned: rows.length, placeTotal: place.length, placeSinceRestart: sinceRestart.length,
    outcomesAll: tally(place), outcomesSinceRestart: tally(sinceRestart),
    dropSinceRestart: dropTally(sinceRestart), dropAll: dropTally(place)},
  placeRows: place.slice(0, 30),
  rowsDigest: digest(rows),
}, null, 2));

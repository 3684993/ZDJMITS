// §A read-only baseline for the capital-capacity / UNKNOWN-convergence round.
// GET requests and read-only SQLite only: no settings write, no lifecycle action, no exchange call.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import process from 'node:process';

const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const dataDir = process.argv[3] ?? 'data';
const label = process.argv[4] ?? 'baseline';
const get = async (name) => {
  const response = await fetch(`${base}${name}`, {signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`HTTP_${response.status}:${name}`);
  return response.json();
};
const [closeout, settings, assets, positions, orders, readiness, snapshot] = await Promise.all([
  get('/diagnostics/closeout'), get('/settings'), get('/account/assets'), get('/positions'), get('/orders'),
  get('/settings/readiness'), get('/snapshot'),
]);
const pipeline = closeout.pipeline ?? {};
const governance = settings.riskGovernance ?? {};
const account = snapshot.account ?? {};
const money = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 1e6) / 1e6 : null);

const entryOrders = orders.entry ?? [];
const activeStatuses = new Set(['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED']);
const unknown = entryOrders.filter((row) => row.status === 'UNKNOWN');
const now = Date.now();
const proofOf = (row) => {
  const evidence = row.activeRiskEvidence ?? null;
  const fresh = Boolean(evidence && evidence.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(evidence.validUntil) > now
    && evidence.identityTombstone === `ENTRY:${String(row.symbol).toUpperCase()}:${String(row.clientOrderId ?? row.exchangeOrderId ?? row.id)}`);
  return {hasProof: Boolean(evidence), freshProof: fresh, status: evidence?.status ?? null, validUntil: evidence?.validUntil ?? null,
    ageMs: evidence?.checkedAt ? now - Number(evidence.checkedAt) : null, sources: evidence?.sources ?? [], auditTier: row.remoteAudit?.tier ?? null,
    consecutive: row.remoteAudit?.consecutive ?? null, nextAuditAt: row.remoteAudit?.nextAuditAt ?? null, verifiedCount: row.remoteAudit?.verifiedCount ?? null};
};
const unknownRows = unknown.map((row) => ({id: row.id, symbol: row.symbol, side: row.side, quantity: row.quantity, filledQuantity: row.filledQuantity,
  exchangeOrderId: row.exchangeOrderId ?? null, clientOrderId: row.clientOrderId ?? null, createdAt: row.createdAt, ageDays: Math.round((now - Number(row.createdAt)) / 86_400_000 * 10) / 10, ...proofOf(row)}));
const oldest = unknownRows.reduce((min, row) => (row.createdAt && (!min || row.createdAt < min.createdAt) ? row : min), null);

const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const durableCounts = Object.fromEntries(db.prepare("SELECT kind, COUNT(*) n FROM runtime_entities WHERE kind IN ('entryOrders','entryReservations','entryIntents','tradePlans','positions') GROUP BY kind").all().map((row) => [row.kind, row.n]));
const durableUnknown = db.prepare("SELECT e.entity_id id, json_extract(e.payload,'$.symbol') symbol, json_extract(e.payload,'$.status') status, json_extract(e.payload,'$.createdAt') createdAt FROM runtime_entities e WHERE e.kind='entryOrders' AND json_extract(e.payload,'$.status')='UNKNOWN'").all();
// How often the account-level fail-closed blocker actually fired, and for which order keys.
const pendingRiskEvents = db.prepare("SELECT json_extract(payload,'$.reason') reason, COUNT(*) n, MAX(ts) lastTs FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? AND json_extract(payload,'$.reason') LIKE 'PENDING_RISK_UNVERIFIED%' GROUP BY reason ORDER BY n DESC").all(now - 24 * 3_600_000);
const noRiskAudits = db.prepare("SELECT COUNT(*) n FROM runtime_events WHERE ts>=? AND (type LIKE '%NO_ACTIVE_RISK%' OR type LIKE '%REMOTE_FACT%')").all(now - 24 * 3_600_000)[0]?.n ?? 0;
db.close();

const pendingRiskKeys = new Set();
for (const row of unknownRows) if (!row.freshProof) pendingRiskKeys.add(`order:${row.id}`);

console.log(JSON.stringify({
  capturedAt: new Date(now).toISOString(), label,
  identity: {pid: closeout.runtime?.pid, buildId: closeout.runtime?.buildId, instanceId: closeout.runtime?.instanceId, lastRestartAt: closeout.runtime?.lastRestartAt, lastRestartReason: closeout.runtime?.lastRestartReason, restartCount: closeout.runtime?.restartCount, runtimeDataDir: closeout.runtime?.runtimeDataDir},
  permission: {settingsVersion: settings.settingsVersion ?? null, environment: settings.connections?.exchange?.environment, executionMode: settings.connections?.executionMode, entrySafetyMode: governance.entrySafetyMode, aiExitAuthority: governance.exitCoordination?.aiExitAuthority,
    entryPermission: pipeline.entryPermission ?? null, executionReadiness: {ready: pipeline.executionReadiness?.ready ?? null, firstBlocker: pipeline.executionReadiness?.firstBlocker ?? null},
    writeBoundary: closeout.productionWriteBoundary ?? null},
  money: {equityUsd: money(account.equityUsd ?? settings?.equityUsd), assets: (assets.assets ?? account.assets ?? []).map((row) => ({asset: row.asset, walletBalance: money(row.walletBalance), availableBalance: money(row.availableBalance), usdValue: money(row.usdValue), marginEligible: row.marginEligible ?? null}))},
  caps: {maxPositions: settings.portfolio?.maxPositions, maxGrossExposurePct: governance.maxGrossExposurePct, maxDirectionExposurePct: governance.maxDirectionExposurePct, maxClusterExposurePct: governance.maxClusterExposurePct, maxClusterDirectionExposurePct: governance.maxClusterDirectionExposurePct,
    perTradeRiskPctEquity: governance.perTradeRiskPctEquity, maxConcurrentReservations: governance.maxConcurrentReservations, maxDailyDrawdownPct: governance.maxDailyDrawdownPct,
    minNetProfitUsd: settings.takeProfit?.minNetProfitUsd, minNetProfitRoiPct: settings.takeProfit?.minNetProfitRoiPct, admissionMode: settings.tradeEconomics?.admissionMode, globalMaxLeverage: settings.portfolioIntelligence?.globalMaxLeverage},
  portfolioRisk: {profile: pipeline.portfolioRiskProfile ?? null, readinessProfile: readiness?.portfolioRisk ?? readiness?.profile ?? null, readinessKeys: readiness ? Object.keys(readiness) : []},
  exposures: {capacityVisibility: pipeline.capacityVisibility ?? null, directionBudget: pipeline.runtimeControl?.capital?.directionBudget ?? null,
    positionNotional: (positions.positions ?? positions.items ?? (Array.isArray(positions) ? positions : [])).reduce((sum, row) => sum + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0),
    positions: Array.isArray(positions.positions ?? positions.items) ? (positions.positions ?? positions.items).length : null,
    count: {positions: (positions.positions ?? positions.items ?? []).length ?? null, entryOrders: entryOrders.length, activeEntryOrders: entryOrders.filter((row) => activeStatuses.has(row.status)).length,
      byStatus: entryOrders.reduce((all, row) => ({...all, [row.status]: (all[row.status] ?? 0) + 1}), {}),
      routedCandidates: pipeline.runtimeControl?.capital?.routedCandidates?.length ?? null, executableCandidateCount: pipeline.runtimeControl?.capital?.executableCandidateCount ?? null}},
  unknownRisk: {inMemory: unknownRows.length, durable: durableUnknown.length,
    freshNoActiveRiskProof: unknownRows.filter((row) => row.freshProof).length,
    occupyingPendingRisk: pendingRiskKeys.size, oldest: oldest ? {id: oldest.id, symbol: oldest.symbol, createdAt: oldest.createdAt, ageDays: oldest.ageDays, auditTier: oldest.auditTier, consecutive: oldest.consecutive} : null,
    rows: unknownRows.slice(0, 60), durableCounts,
    pendingRiskEventsLast24h: pendingRiskEvents.map((row) => ({reason: row.reason, count: row.n, lastAt: new Date(Number(row.lastTs)).toISOString()})),
    pendingRiskEventCount24h: pendingRiskEvents.reduce((sum, row) => sum + Number(row.n), 0), noRiskAuditEvents24h: noRiskAudits},
  conversion: {activity: pipeline.entryActivity ?? null, thirtyMinutes: pipeline.entryConversion?.thirtyMinutes ?? null, oneHour: pipeline.entryConversion?.oneHour ?? null},
  lifecycleCounts: pipeline.candidateLifecycle?.counts ?? null,
  closeoutKeys: Object.keys(closeout),
}, null, 2));

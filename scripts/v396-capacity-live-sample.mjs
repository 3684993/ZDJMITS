// §G live acceptance sampler: capacity separation, UNKNOWN pending-risk behaviour and the Entry
// conversion chain, all read from the running Engine's own durable facts. Read-only.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const dataDir = process.argv[3] ?? 'data';
const label = process.argv[4] ?? 'sample';

const get = async (url) => {
  const response = await fetch(`${base}${url}`);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
};

const closeout = await get('/diagnostics/closeout');
const pipeline = await get('/pipeline');
const settings = await get('/settings');
const assets = await get('/account/assets').catch(() => null);
const positions = await get('/positions').catch(() => []);
const runtime = closeout.runtime ?? {}, capital = pipeline.runtimeControl?.capital ?? {}, view = pipeline.capacityVisibility ?? {};
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const since = Number(runtime.lastRestartAt ?? Date.now());
const tally = (sql, ...args) => db.prepare(sql).get(...args);
const types = ['ENTRY_DECISION_BLOCKED', 'ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED', 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED', 'ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT', 'ENTRY_ORDER_RISK_FACT_COVERAGE_INCOMPLETE', 'ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED', 'ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED', 'ENTRY_RESERVATION_CREATED', 'ENTRY_ORDER_SUBMITTED', 'ENTRY_FILL_RECORDED', 'ORDER_SUBMISSION_ACCEPTED'];
const eventCounts = Object.fromEntries(types.map(type => [type, tally('SELECT COUNT(*) n FROM runtime_events WHERE type=? AND ts>=?', type, since).n]));
const pendingRiskBlocks = db.prepare("SELECT json_extract(payload,'$.reason') reason, json_extract(payload,'$.symbol') symbol, ts FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? AND json_extract(payload,'$.reason') LIKE 'PENDING_RISK_UNVERIFIED%' ORDER BY ts ASC").all(since);
const blockReasons = db.prepare("SELECT json_extract(payload,'$.reason') reason, COUNT(*) n FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? GROUP BY reason ORDER BY n DESC LIMIT 25").all(since);
const unknownRows = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryOrders'").all()
  .map(row => ({id: row.id, order: JSON.parse(row.payload)})).filter(row => row.order.status === 'UNKNOWN');
const now = Date.now();
const occupying = unknownRows.filter(row => {
  const evidence = row.order.activeRiskEvidence;
  const fresh = row.order.activeRiskExposure === false && evidence?.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(evidence.validUntil) > now
    && evidence.identityTombstone === `ENTRY:${String(row.order.symbol).toUpperCase()}:${String(row.order.clientOrderId ?? row.order.exchangeOrderId ?? row.order.id)}`;
  return !fresh;
}).map(row => ({id: row.id, symbol: row.order.symbol, proofStatus: row.order.activeRiskEvidence?.status ?? null, validUntil: row.order.activeRiskEvidence?.validUntil ?? null, ageMs: now - Number(row.order.activeRiskEvidence?.validUntil ?? 0)}));
const funnel = pipeline.entryConversion ?? null;

console.log(JSON.stringify({
  label, capturedAt: new Date().toISOString(), uptimeMs: runtime.uptimeMs,
  identity: {pid: runtime.pid, buildId: runtime.buildId, instanceId: runtime.instanceId, restartCount: runtime.restartCount, lastRestartAt: runtime.lastRestartAt, lastRestartReason: runtime.lastRestartReason},
  permission: {settingsVersion: settings.settingsVersion, environment: closeout.productionWriteBoundary?.environment, executionMode: closeout.productionWriteBoundary?.executionMode,
    productionWrites: closeout.productionWriteBoundary?.productionWrites, blockedProductionWriteAttempts: closeout.productionWriteBoundary?.blockedProductionWriteAttempts, testnetWrites: closeout.productionWriteBoundary?.testnetWrites, lastWritePath: closeout.productionWriteBoundary?.lastWritePath},
  policy: settings.riskGovernance?.exposureCapacityPolicy, ratios: {maxGrossExposurePct: settings.riskGovernance?.maxGrossExposurePct, maxDirectionExposurePct: settings.riskGovernance?.maxDirectionExposurePct, maxClusterExposurePct: settings.riskGovernance?.maxClusterExposurePct, perTradeRiskPctEquity: settings.riskGovernance?.perTradeRiskPctEquity},
  capacity: {
    funding: view.funding, exposure: view.exposure, limits: view.limits, entryCapacity: view.entryCapacity,
    grossRatioLimitUsd: capital.directionBudget?.grossLimitUsd, directionRatioLimitUsd: capital.directionBudget?.directionLimitUsd,
    storedDirectionLimitEqualsSettings: Math.abs(Number(capital.directionBudget?.directionLimitUsd ?? 0) - Number(settings.riskGovernance?.maxDirectionExposurePct ?? 0) * Number(capital.directionBudget?.equityUsd ?? 0)) < 1e-6,
    executableCandidateCount: capital.executableCandidateCount, routedCount: (capital.routedCandidates ?? []).length,
    routes: (capital.routedCandidates ?? []).slice(0, 12).map(row => ({symbol: row.symbol, quoteAsset: row.quoteAsset, leverage: row.leverage,
      long: {notionalUsd: row.longFeasibleNotionalUsd, executable: row.longExecutable, constraint: row.riskHeadroom?.LONG?.firstBindingConstraint, capitalUsd: row.riskHeadroom?.LONG?.capital?.executableNotionalUsd, blockers: row.riskHeadroom?.LONG?.blockers},
      short: {notionalUsd: row.shortFeasibleNotionalUsd, executable: row.shortExecutable, constraint: row.riskHeadroom?.SHORT?.firstBindingConstraint, capitalUsd: row.riskHeadroom?.SHORT?.capital?.executableNotionalUsd, blockers: row.riskHeadroom?.SHORT?.blockers}})),
  },
  account: {equityUsd: pipeline.account?.equityUsd, positionCount: Array.isArray(positions) ? positions.length : (positions?.positions ?? []).length,
    assets: (assets?.assets ?? assets ?? []).map?.(row => ({asset: row.asset, availableBalance: row.availableBalance, walletBalance: row.walletBalance})) ?? null},
  unknownRisk: {durableUnknown: unknownRows.length, occupyingPendingRisk: occupying.length, occupyingRows: occupying.slice(0, 10)},
  eventsSinceRestart: {...eventCounts, pendingRiskBlockCount: pendingRiskBlocks.length, pendingRiskBlockFirst: pendingRiskBlocks[0] ?? null, pendingRiskBlockLast: pendingRiskBlocks.at(-1) ?? null},
  topBlockReasonsSinceRestart: blockReasons,
  conversion: funnel, activity: pipeline.activity ?? null,
}, null, 2));
db.close();

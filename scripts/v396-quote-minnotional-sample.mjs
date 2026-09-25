// §H read-only acceptance sampler for the quote-universe / minimum-notional round.
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
const runtime = closeout.runtime ?? {}, capital = pipeline.runtimeControl?.capital ?? {}, view = pipeline.capacityVisibility ?? {};
const since = Number(runtime.lastRestartAt ?? 0);
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const count = (type) => db.prepare('SELECT COUNT(*) n FROM runtime_events WHERE type=? AND ts>=?').get(type, since).n;
const envelopeEvents = db.prepare("SELECT ts, json_extract(payload,'$.executionEnvelope.executableSides') sides, json_extract(payload,'$.executionEnvelope.noExecutableSide') none, json_extract(payload,'$.executionEnvelope.sideAuthorization.LONG') longAuth, json_extract(payload,'$.executionEnvelope.sideAuthorization.SHORT') shortAuth, json_extract(payload,'$.symbol') symbol FROM runtime_events WHERE type='PRE_AI_EXECUTION_ENVELOPE_CREATED' AND ts>=? ORDER BY ts DESC LIMIT 12").all(since);
const blocked = db.prepare("SELECT ts, json_extract(payload,'$.reason') reason, json_extract(payload,'$.violation') violation, json_extract(payload,'$.direction') direction, json_extract(payload,'$.stage') stage FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? ORDER BY ts DESC LIMIT 25").all(since);
const pendingRisk = db.prepare("SELECT COUNT(*) n FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? AND json_extract(payload,'$.reason') LIKE 'PENDING_RISK_UNVERIFIED%'").get(since).n;
const unknown = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryOrders'").all()
  .map((row) => JSON.parse(row.payload)).filter((order) => order.status === 'UNKNOWN');
const nowMs = Date.now();
const proofLive = (order) => {
  const evidence = order.activeRiskEvidence;
  return order.activeRiskExposure === false && evidence?.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(evidence.validUntil) > nowMs
    && evidence.identityTombstone === `ENTRY:${String(order.symbol).toUpperCase()}:${String(order.clientOrderId ?? order.exchangeOrderId ?? order.id)}`;
};
const traceRow = (trace) => trace && ({symbol: trace.symbol, side: trace.side, quoteAsset: trace.quoteAsset, entryFundingEligible: trace.entryFundingEligible,
  leverage: trace.leverage, leverageFact: trace.leverageFact, executable: trace.executable, blockers: trace.blockers, firstBindingConstraint: trace.firstBindingConstraint,
  actualUsd: trace.actualUsd, requiredUsd: trace.requiredUsd, explanation: trace.explanation,
  funding: trace.funding, risk: {grossRemainingUsd: trace.risk?.grossRemainingUsd, grossMode: trace.risk?.grossMode, directionRemainingUsd: trace.risk?.directionRemainingUsd,
    clusterRemainingUsd: trace.risk?.clusterRemainingUsd, perTradeRiskRemainingUsd: trace.risk?.perTradeRiskRemainingUsd, portfolioRiskAllowed: trace.risk?.portfolioRiskAllowed},
  plan: trace.plan, exchangeFilters: trace.exchangeFilters, minimumLegalNotionalUsd: trace.minimumLegalNotionalUsd,
  plannedNotionalUsd: trace.plannedNotionalUsd, finalNotionalBeforeRoundingUsd: trace.finalNotionalBeforeRoundingUsd, rounded: trace.rounded});

console.log(JSON.stringify({
  label, capturedAt: new Date().toISOString(), uptimeMs: runtime.uptimeMs,
  identity: {pid: runtime.pid, buildId: runtime.buildId, instanceId: runtime.instanceId, restartCount: runtime.restartCount, lastRestartReason: runtime.lastRestartReason, lastRestartAt: runtime.lastRestartAt},
  permission: {settingsVersion: settings.settingsVersion, environment: closeout.productionWriteBoundary?.environment, executionMode: closeout.productionWriteBoundary?.executionMode,
    entrySafetyMode: settings.riskGovernance?.entrySafetyMode, aiExitAuthority: settings.riskGovernance?.exitCoordination?.aiExitAuthority,
    productionWrites: closeout.productionWriteBoundary?.productionWrites, blockedProductionWriteAttempts: closeout.productionWriteBoundary?.blockedProductionWriteAttempts,
    executionReadiness: pipeline.executionReadiness ?? null, portfolioRiskStatus: pipeline.portfolioRiskProfile?.status ?? null},
  entryFunding: {
    ledger: view.funding?.quoteAssets ?? null, totalExecutableMarginUsd: view.funding?.totalExecutableMarginUsd ?? null, proven: view.funding?.proven ?? null,
    excludedAssets: view.funding?.excludedAssets ?? null, accountEquityUsd: view.funding?.accountEquityUsd ?? null,
    accountAssets: (assets?.assets ?? []).map((row) => ({asset: row.asset, availableBalance: row.availableBalance, usdValue: row.usdValue, marginEligible: row.marginEligible ?? null})),
    sumCheck: Math.abs(Number(view.funding?.totalExecutableMarginUsd ?? 0) - (view.funding?.quoteAssets ?? []).reduce((n, row) => n + Number(row.executableMarginUsd), 0)) < 1e-6,
  },
  capacity: {policy: settings.riskGovernance?.exposureCapacityPolicy, exposure: view.exposure, limits: view.limits, sideStatus: view.sideStatus,
    entryCapacitySummary: {LONG: {...(view.entryCapacity?.LONG ?? {}), candidates: undefined}, SHORT: {...(view.entryCapacity?.SHORT ?? {}), candidates: undefined}},
    candidateCount: (view.entryCapacity?.LONG?.candidates ?? []).length + (view.entryCapacity?.SHORT?.candidates ?? []).length,
    traces: {LONG: (view.entryCapacity?.LONG?.candidates ?? []).slice(0, 6).map(traceRow), SHORT: (view.entryCapacity?.SHORT?.candidates ?? []).slice(0, 6).map(traceRow)},
    executableCandidateCount: capital.executableCandidateCount, routedCount: (capital.routedCandidates ?? []).length},
  envelopeFacts: {events: envelopeEvents.length, latest: envelopeEvents.slice(0, 6)},
  blockedSinceRestart: {total: blocked.length, pendingRiskUnverified: pendingRisk, violations: blocked.filter((row) => row.violation).slice(0, 5), reasons: blocked.reduce((map, row) => ({...map, [row.reason ?? 'NULL']: (map[row.reason ?? 'NULL'] ?? 0) + 1}), {})},
  unknownRisk: {durableUnknown: unknown.length, occupyingPendingRisk: unknown.filter((order) => !proofLive(order)).length},
  eventsSinceRestart: Object.fromEntries(['ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED', 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED', 'ENTRY_RESERVATION_CREATED', 'ENTRY_INTENT_CREATED', 'ORDER_SUBMISSION_ACCEPTED', 'ENTRY_FILL_RECORDED', 'AI_RUN_TERMINAL', 'ANALYSIS_DISPATCH_INTENT', 'PRE_AI_TRADE_PLAN_FEASIBILITY', 'PRE_AI_NO_EXECUTABLE_CAPACITY']
    .map((type) => [type, count(type)])),
  conversion: pipeline.entryConversion ?? null,
}, null, 2));
db.close();

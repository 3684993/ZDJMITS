// §1 read-only baseline freeze for the quote-asset / minimum-notional round. Nothing is written.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const dataDir = process.argv[3] ?? 'data';

const get = async (url) => {
  const response = await fetch(`${base}${url}`);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
};

const closeout = await get('/diagnostics/closeout');
const settings = await get('/settings');
const pipeline = await get('/pipeline');
const assets = await get('/account/assets').catch(() => null);
const positions = await get('/positions').catch(() => []);
const snapshotList = await get('/snapshot').catch(() => null);
const runtime = closeout.runtime ?? {}, capital = pipeline.runtimeControl?.capital ?? {}, view = pipeline.capacityVisibility ?? {};
const snapshots = Array.isArray(snapshotList) ? snapshotList : (snapshotList?.snapshots ?? []);
const snapshotBySymbol = new Map(snapshots.map((row) => [String(row.symbol ?? '').toUpperCase(), row]));
const routed = capital.routedCandidates ?? [];

const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const since = Number(runtime.lastRestartAt ?? 0);
const countSince = (type) => db.prepare('SELECT COUNT(*) n FROM runtime_events WHERE type=? AND ts>=?').get(type, since).n;
const unknown = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryOrders'").all()
  .map((row) => ({id: row.id, order: JSON.parse(row.payload)})).filter((row) => row.order.status === 'UNKNOWN');
const now = Date.now();
const proofLive = (order) => {
  const evidence = order.activeRiskEvidence;
  return order.activeRiskExposure === false && evidence?.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(evidence.validUntil) > now
    && evidence.identityTombstone === `ENTRY:${String(order.symbol).toUpperCase()}:${String(order.clientOrderId ?? order.exchangeOrderId ?? order.id)}`;
};
const reservationRows = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryReservations'").all()
  .map((row) => JSON.parse(row.payload)).filter((row) => ['RESERVED', 'WORKING'].includes(String(row.status)) && Number(row.expiresAt) > now);

const sideTrace = (route, side) => {
  const headroom = route.riskHeadroom?.[side] ?? null;
  const snapshot = snapshotBySymbol.get(String(route.symbol).toUpperCase());
  const quote = snapshot?.quote ?? {};
  const key = side === 'LONG' ? 'long' : 'short';
  return {
    symbol: route.symbol, side, quoteAsset: route.quoteAsset, leverage: route.leverage,
    executable: route[`${key}Executable`] ?? null,
    recommendedNotionalUsd: route[`${key}RecommendedNotionalUsd`] ?? null,
    feasibleNotionalUsd: route[`${key}FeasibleNotionalUsd`] ?? null,
    exchangeFilters: {tickSize: quote.tickSize ?? null, stepSize: quote.stepSize ?? null, minQty: quote.minQty ?? null, minNotional: quote.minNotional ?? null, last: quote.last ?? null, bid: quote.bid ?? null, ask: quote.ask ?? null},
    headroom: headroom && {
      plannedNotional: headroom.plannedNotional, finalNotional: headroom.finalNotional, minimumNotional: headroom.minimumNotional,
      executable: headroom.executable, reason: headroom.reason, blockers: headroom.blockers, firstBindingConstraint: headroom.firstBindingConstraint,
      limits: headroom.limits, remaining: headroom.remaining, observed: headroom.observed && {gross: headroom.observed.gross, direction: headroom.observed.direction, cluster: headroom.observed.cluster, clusterDirection: headroom.observed.clusterDirection},
      capital: headroom.capital, gross: headroom.gross, long: headroom.long, short: headroom.short, clusterNow: headroom.clusterNow, clusterDirectionNow: headroom.clusterDirectionNow,
      perTradeRiskUsd: headroom.perTradeRiskUsd, expectedAdverseMovePct: headroom.expectedAdverseMovePct, equity: headroom.equity,
    },
    physicalCapacity: route.physicalCapacity?.[side] ?? null,
  };
};

const result = {
  capturedAt: new Date().toISOString(), label: 'QUOTE_AND_MIN_NOTIONAL_BASELINE_FREEZE',
  identity: {pid: runtime.pid, buildId: runtime.buildId, instanceId: runtime.instanceId, restartCount: runtime.restartCount, lastRestartAt: runtime.lastRestartAt, lastRestartReason: runtime.lastRestartReason, uptimeMs: runtime.uptimeMs, runtimeDataDir: runtime.runtimeDataDir, version: runtime.version},
  writeBoundary: closeout.productionWriteBoundary ?? null,
  permission: {settingsVersion: settings.settingsVersion, environment: settings.connections?.environment, executionMode: settings.connections?.executionMode,
    entrySafetyMode: settings.riskGovernance?.entrySafetyMode, aiExitAuthority: settings.riskGovernance?.exitCoordination?.aiExitAuthority,
    pipelineState: pipeline.pipelineState, entryPermission: pipeline.entryPermission, executionReadiness: pipeline.executionReadiness, marketDataReason: pipeline.marketDataReason ?? null},
  caps: {maxPositions: settings.portfolio?.maxPositions, maxGrossExposurePct: settings.riskGovernance?.maxGrossExposurePct, maxDirectionExposurePct: settings.riskGovernance?.maxDirectionExposurePct,
    maxClusterExposurePct: settings.riskGovernance?.maxClusterExposurePct, maxClusterDirectionExposurePct: settings.riskGovernance?.maxClusterDirectionExposurePct,
    perTradeRiskPctEquity: settings.riskGovernance?.perTradeRiskPctEquity, maxConcurrentReservations: settings.riskGovernance?.maxConcurrentReservations, maxDailyDrawdownPct: settings.riskGovernance?.maxDailyDrawdownPct,
    minNetProfitUsd: settings.takeProfit?.minNetProfitUsd, minNetProfitRoiPct: settings.takeProfit?.minNetProfitRoiPct, admissionMode: settings.tradeEconomics?.admissionMode,
    globalMaxLeverage: settings.portfolioIntelligence?.globalMaxLeverage, maxMarginPerPositionUsd: settings.portfolioIntelligence?.maxMarginPerPositionUsd, maxEquityPct: settings.portfolioIntelligence?.maxEquityPct,
    exposureCapacityPolicy: settings.riskGovernance?.exposureCapacityPolicy, humanManagedAdmissionCapsEnabled: settings.positionManagement?.humanManagedAdmissionCapsEnabled},
  portfolioRisk: {status: pipeline.portfolioRiskProfile?.status, version: pipeline.portfolioRiskProfile?.version, configured: pipeline.portfolioRiskProfile?.configured, blockers: pipeline.portfolioRiskProfile?.blockers ?? null, values: pipeline.portfolioRiskProfile?.values ?? null},
  accountAssets: {equityUsd: capital.directionBudget?.equityUsd ?? null, assets: (assets?.assets ?? assets ?? []).map((row) => ({asset: row.asset, walletBalance: row.walletBalance, availableBalance: row.availableBalance, usdValue: row.usdValue, marginEligible: row.marginEligible ?? null})),
    positionCount: (Array.isArray(positions) ? positions : positions?.positions ?? []).map((row) => ({symbol: row.symbol, side: row.side, quantity: row.quantity, markPrice: row.markPrice, managementStatus: row.managementStatus ?? null, ownerState: row.ownerState ?? null}))},
  entryFunding: view.funding ?? null,
  exposure: view.exposure ?? null,
  limits: view.limits ?? null,
  entryCapacity: view.entryCapacity ?? null,
  capacitySummary: {executableCandidateCount: capital.executableCandidateCount, routedCount: routed.length, capitalVersion: capital.capitalVersion, evaluatedAt: capital.evaluatedAt, directionBudget: capital.directionBudget ?? null},
  candidateTraces: routed.flatMap((route) => [sideTrace(route, 'LONG'), sideTrace(route, 'SHORT')]),
  admissionReasonCounts: capital.reasonCounts ?? null,
  unknownRisk: {durableUnknown: unknown.length, proofLive: unknown.filter((row) => proofLive(row.order)).length, occupyingPendingRisk: unknown.filter((row) => !proofLive(row.order)).length,
    occupyingRows: unknown.filter((row) => !proofLive(row.order)).slice(0, 12).map((row) => ({id: row.id, symbol: row.order.symbol, proofStatus: row.order.activeRiskEvidence?.status ?? null, validUntil: row.order.activeRiskEvidence?.validUntil ?? null}))},
  activeReservations: reservationRows.map((row) => ({id: row.id, underlying: row.underlying, quoteAsset: row.quoteAsset, marginUsd: row.marginUsd, notionalUsd: row.notionalUsd, status: row.status, expiresAt: row.expiresAt})),
  eventsSinceRestart: Object.fromEntries(['ENTRY_DECISION_BLOCKED', 'PENDING_RISK_UNVERIFIED', 'ENTRY_RESERVATION_CREATED', 'ENTRY_INTENT_CREATED', 'ORDER_SUBMISSION_ACCEPTED', 'ENTRY_FILL_RECORDED', 'ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED', 'AI_RUN_TERMINAL', 'ANALYSIS_DISPATCH_INTENT', 'PRE_AI_EXECUTION_ENVELOPE_CREATED', 'MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE']
    .map((type) => [type, countSince(type)])),
  blockReasonsSinceRestart: db.prepare("SELECT json_extract(payload,'$.reason') reason, COUNT(*) n FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? GROUP BY reason ORDER BY n DESC LIMIT 20").all(since),
  conversion: pipeline.entryConversion ?? null,
};
console.log(JSON.stringify(result, null, 2));
db.close();

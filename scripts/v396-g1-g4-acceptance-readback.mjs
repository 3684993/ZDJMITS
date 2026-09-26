// Read-only acceptance readback for the G1-G4 round: no POST/PUT is issued and the durable store is opened readOnly.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const dataDir = process.argv[3] ?? 'data';
const get = async (url) => {
  const response = await fetch(`${base}${url}`);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
};

const [closeout, settingsResponse, positions] = await Promise.all([get('/diagnostics/closeout'), get('/settings'), get('/positions')]);
const pipeline = closeout.pipeline ?? {}, runtime = closeout.runtime ?? {}, boundary = closeout.productionWriteBoundary ?? {};
const settings = settingsResponse?.settings ?? settingsResponse ?? {};
const rows = Array.isArray(positions) ? positions : (positions?.positions ?? []);
const since = Number(runtime.lastRestartAt ?? 0);
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const now = Date.now();

const eventCounts = Object.fromEntries(db.prepare('SELECT type, COUNT(*) n FROM runtime_events WHERE ts>=? GROUP BY type')
  .all(since).map((r) => [r.type, r.n]));
const decisionTypes = ['PRIMARY_DECISION_NORMALIZED', 'AI_RUN_TERMINAL', 'AI_SIZING_ERROR', 'ENTRY_ECONOMIC_ADMISSION_EVALUATED',
  'PORTFOLIO_RISK_ADMISSION_EVALUATED', 'ENTRY_DECISION_BLOCKED', 'CANDIDATE_REJECTED', 'ENTRY_ORDER_SUBMITTED', 'ENTRY_ORDER_FILLED'];
const envelopes = db.prepare('SELECT ts, payload FROM runtime_events WHERE ts>=? AND type=? ORDER BY ts')
  .all(since, 'PRE_AI_EXECUTION_ENVELOPE_CREATED').map((r) => {
    const e = JSON.parse(r.payload).executionEnvelope ?? {};
    const side = (v = {}) => ({minimumLegalNotionalUsd: v.minimumLegalNotionalUsd ?? null, minQuantityUnits: v.minQuantityUnits ?? null,
      maxQuantityUnits: v.maxQuantityUnits ?? null, legalQuantityRangeUnits: v.legalQuantityRangeUnits ?? null,
      legalNotionalRangeUsd: v.legalNotionalRangeUsd ?? null, executable: v.executable ?? null, firstBindingConstraint: v.firstBindingConstraint ?? null});
    return {at: new Date(r.ts).toISOString(), symbol: e.symbol ?? null, executableSides: e.executableSides ?? null,
      sideAuthorization: e.sideAuthorization ?? null, exchange: e.exchange ?? null, makerReachableBand: e.makerReachableBand ?? null,
      LONG: side(e.LONG), SHORT: side(e.SHORT)};
  });
const decisions = db.prepare(`SELECT ts, type, payload FROM runtime_events WHERE ts>=? AND type IN (${decisionTypes.map(() => '?').join(',')}) ORDER BY ts`)
  .all(since, ...decisionTypes).map((r) => ({at: new Date(r.ts).toISOString(), type: r.type, ...JSON.parse(r.payload)}));
const unknowns = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryOrders'")
  .all().map((r) => JSON.parse(r.payload)).filter((o) => o.status === 'UNKNOWN');
const proofLive = (o) => {
  const e = o.activeRiskEvidence;
  return o.activeRiskExposure === false && e?.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(e.validUntil) > now
    && e.identityTombstone === `ENTRY:${String(o.symbol).toUpperCase()}:${String(o.clientOrderId ?? o.exchangeOrderId ?? o.id)}`;
};
const tally = (key) => rows.reduce((a, r) => { const k = String(r[key]); a[k] = (a[k] ?? 0) + 1; return a; }, {});

const traceRow = (t) => t && {symbol: t.symbol, side: t.side, quoteAsset: t.quoteAsset, entryFundingEligible: t.entryFundingEligible,
  referencePrice: t.referencePrice, minimumLegalNotionalUsd: t.minimumLegalNotionalUsd, exchangeFilters: t.exchangeFilters,
  leverage: t.leverage, leverageFact: t.leverageFact, plannedNotionalUsd: t.plannedNotionalUsd,
  finalNotionalBeforeRoundingUsd: t.finalNotionalBeforeRoundingUsd, rounded: t.rounded, executable: t.executable,
  blockers: t.blockers, firstBindingConstraint: t.firstBindingConstraint, actualUsd: t.actualUsd, requiredUsd: t.requiredUsd,
  explanation: t.explanation, funding: t.funding, risk: t.risk, plan: t.plan};
const sideRows = (side) => ((pipeline.capacityVisibility?.entryCapacity ?? {})[side]?.candidates ?? []).map(traceRow);

console.log(JSON.stringify({
  asOf: new Date(now).toISOString(),
  identity: {buildId: runtime.buildId, version: runtime.version, instanceId: runtime.instanceId, pid: runtime.pid,
    startReason: runtime.lastRestartReason, restartCount: runtime.restartCount, lastRestartAt: runtime.lastRestartAt,
    uptimeMs: runtime.uptimeMs, runtimeDataDir: runtime.runtimeDataDir},
  productionWriteBoundary: boundary,
  frozenEconomics: {settingsVersion: settings.settingsVersion, entryMarginUsd: settings.portfolio?.entryMarginUsd,
    maxPositions: settings.portfolio?.maxPositions, maxPendingEntries: settings.portfolio?.maxPendingEntries,
    maxDirectionExposurePct: settings.riskGovernance?.maxDirectionExposurePct, exposureCapacityPolicy: settings.riskGovernance?.exposureCapacityPolicy,
    aiExitAuthority: settings.riskGovernance?.aiExitAuthority ?? settings.aiExitAuthority,
    aiExitLossLimitUsd: settings.riskGovernance?.aiExitLossLimitUsd ?? settings.aiExitLossLimitUsd,
    legacyMaxLongExposurePct: settings.portfolioIntelligence?.maxLongExposurePct,
    legacyMaxShortExposurePct: settings.portfolioIntelligence?.maxShortExposurePct},
  g1: {sideStatus: pipeline.capacityVisibility?.sideStatus ?? null, exhaustedForNewRisk: pipeline.capacityVisibility?.exhaustedForNewRisk ?? null,
    firstBlocker: pipeline.capacityVisibility?.firstBlocker ?? null, limits: pipeline.capacityVisibility?.limits ?? null,
    exposure: pipeline.capacityVisibility?.exposure ?? null,
    entryCapacitySummary: {LONG: pipeline.capacityVisibility?.entryCapacity?.LONG ?? null, SHORT: pipeline.capacityVisibility?.entryCapacity?.SHORT ?? null},
    longTraces: sideRows('LONG'), shortTraces: sideRows('SHORT')},
  g2: {envelopeCount: envelopes.length, envelopes: envelopes.slice(-6), sizingErrorEvents: eventCounts.AI_SIZING_ERROR ?? 0, decisions},
  g3: {pipelineState: pipeline.pipelineState, noEntryReason: pipeline.noEntryReason ?? null, marketDataReason: pipeline.marketDataReason ?? null,
    marketDataIsolation: pipeline.marketDataIsolation ?? null, marketDataDetail: pipeline.marketDataDetail ?? null, freshMarkets: pipeline.freshMarkets ?? null},
  g4: {authoritativeBlocker: pipeline.authoritativeBlocker ?? null, entryConversion: pipeline.entryConversion ?? null,
    portfolioRiskProfile: pipeline.portfolioRiskProfile ?? null, analysis: pipeline.analysis ?? null, eligibility: pipeline.eligibility ?? null},
  assets: {positions: rows.length, managementStatus: tally('managementStatus'), tpStatus: tally('tpStatus'),
    grossNotionalUsd: rows.reduce((n, r) => n + Math.abs(Number(r.quantity) * Number(r.markPrice)), 0),
    unrealizedPnlUsd: rows.reduce((n, r) => n + Number(r.unrealizedPnl ?? 0), 0),
    rows: rows.map((r) => ({symbol: r.symbol, side: r.side, quantity: r.quantity, tpStatus: r.tpStatus,
      managementStatus: r.managementStatus, positionRiskSource: r.positionRiskSource, cycleId: r.cycleId ?? null}))},
  unknownEntryOrders: {durable: unknowns.length, liveNoActiveRiskProofs: unknowns.filter(proofLive).length,
    withoutLiveProof: unknowns.filter((o) => !proofLive(o)).length,
    occupying: unknowns.filter((o) => !proofLive(o)).map((o) => ({id: o.id ?? o.clientOrderId, symbol: o.symbol, side: o.side,
      status: o.status, activeRiskExposure: o.activeRiskExposure ?? null, activeRiskEvidence: o.activeRiskEvidence ?? null})).slice(0, 12)},
  eventCountsSinceRestart: eventCounts,
}, null, 1));

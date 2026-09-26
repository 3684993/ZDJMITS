// Phase 1 read-only audit: replay every Brain PLACE in a window and follow it to the exact gate that stopped it.
// Durable store is opened readOnly and every API call is a GET; nothing is written, restarted or submitted.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dataDir = process.argv[2] ?? 'data';
const base = process.argv[3] ?? 'http://127.0.0.1:8080/api/v3';
const hours = Number(process.argv[4] ?? 12);
const now = Date.now(), from = now - hours * 3_600_000, from6 = now - 6 * 3_600_000;
const get = async (route) => {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}`);
  return response.json();
};
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), { readOnly: true });
const events = db.prepare('SELECT ts, type, payload FROM runtime_events WHERE ts>=? ORDER BY ts').all(from)
  .map((row) => ({ ts: row.ts, type: row.type, payload: JSON.parse(row.payload) }));
const byType = (type) => events.filter((row) => row.type === type);
const index = (type, key) => new Map(byType(type).map((row) => [String(row.payload[key] ?? ''), { ...row.payload, _ts: row.ts }]));
const normalized = index('PRIMARY_DECISION_NORMALIZED', 'runId');
const economic = index('ENTRY_ECONOMIC_ADMISSION_EVALUATED', 'brainRunId');
const riskAdmission = index('PORTFOLIO_RISK_ADMISSION_EVALUATED', 'brainRunId');
const blockedByPlan = index('ENTRY_DECISION_BLOCKED', 'allocationPlanId');
const blockedByRun = index('ENTRY_DECISION_BLOCKED', 'brainRunId');
const rejected = index('CANDIDATE_REJECTED', 'brainRunId');
const envelopes = byType('PRE_AI_EXECUTION_ENVELOPE_CREATED').map((row) => ({ ts: row.ts, ...row.payload.executionEnvelope }));
const nearestEnvelope = (symbol, ts) => envelopes.filter((row) => String(row.symbol).toUpperCase() === String(symbol).toUpperCase()
  && Math.abs(row.ts - ts) <= 180_000).sort((a, b) => Math.abs(a.ts - ts) - Math.abs(b.ts - ts))[0] ?? null;
const plans = new Map(db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='allocationPlans'").all()
  .map((row) => [row.entity_id, JSON.parse(row.payload)]));
const reached = (kind) => new Set(db.prepare('SELECT payload FROM runtime_entities WHERE kind=?').all(kind)
  .map((row) => JSON.parse(row.payload)).filter((row) => Number(row.createdAt ?? row.updatedAt ?? 0) >= from)
  .map((row) => String(row.symbol ?? '').toUpperCase()));
const reservations = reached('entryReservations'), intents = reached('entryIntents'), orders = reached('entryOrders');
const fills = new Set(db.prepare("SELECT payload FROM runtime_entities WHERE kind='executionFills'").all()
  .map((row) => JSON.parse(row.payload)).filter((row) => Number(row.executionTime ?? 0) >= from).map((row) => String(row.symbol ?? '').toUpperCase()));

const placeRuns = byType('AI_RUN_TERMINAL').filter((row) => String(row.payload.decision ?? '').startsWith('PLACE_'));
const chains = placeRuns.map((row) => {
  const run = row.payload, symbol = String(run.symbol).toUpperCase();
  const blocked = blockedByPlan.get(String(run.allocationPlanId ?? '')) ?? blockedByRun.get(String(run.id)) ?? null;
  const plan = blocked?.allocationPlanId ? plans.get(String(blocked.allocationPlanId)) ?? null : null;
  const envelope = nearestEnvelope(symbol, row.ts);
  const side = envelope?.[normalized.get(String(run.id))?.normalizedDirection ?? run.direction] ?? null;
  const risk = riskAdmission.get(String(run.id));
  const econ = economic.get(String(run.id));
  return {
    runId: run.id, at: new Date(Number(row.ts)).toISOString(), symbol, quoteAsset: envelope?.quoteAsset ?? plan?.quoteAsset ?? null,
    direction: normalized.get(String(run.id))?.normalizedDirection ?? run.direction ?? null, decision: run.decision,
    parserRepaired: normalized.get(String(run.id))?.parserRepaired ?? null, modelTokens: (run.inputTokens ?? 0) + (run.outputTokens ?? 0),
    envelope: envelope ? { executableSides: envelope.executableSides, sideExecutable: side?.executable ?? null,
      minQuantityUnits: side?.minQuantityUnits ?? null, maxQuantityUnits: side?.maxQuantityUnits ?? null,
      minimumLegalNotionalUsd: side?.minimumLegalNotionalUsd ?? null, legalNotionalRangeUsd: side?.legalNotionalRangeUsd ?? null,
      exchangeFilters: envelope.exchange ?? null, leverage: envelope.leverage ?? null,
      account: envelope.account ? { equityUsd: envelope.account.equityUsd, availableMarginUsd: envelope.account.availableMarginUsd,
        reservedMarginUsd: envelope.account.reservedMarginUsd, executionLeaseMarginUsd: envelope.account.executionLeaseMarginUsd, freeMarginUsd: envelope.account.freeMarginUsd } : null,
      maxNotionalUsd: side?.maxNotionalUsd ?? null, firstBindingConstraint: side?.firstBindingConstraint ?? null } : null,
    plan: plan ? { planId: plan.planId, admission: plan.admission, reasons: plan.reasons, notionalUsd: plan.notionalUsd, marginUsd: plan.marginUsd,
      leverage: plan.leverage, minExecutableMarginUsd: plan.minExecutableMarginUsd, locationWouldBlock: plan.locationWouldBlock,
      exposureBefore: plan.exposureBefore, exposureAfter: plan.exposureAfter, capacityRoom: plan.capacityRoom ?? null } : null,
    economicAdmission: econ ? { mode: econ.mode, passed: econ.passed, expectedNetProfit: econ.expectedNetProfit, requiredNetProfit: econ.requiredNetProfit,
      reachProbability: econ.reachProbability, notionalUsd: econ.notionalUsd, blockers: econ.blockers, quantityMutated: econ.quantityMutated } : null,
    riskAdmission: risk ? { allowed: risk.allowed, reasons: risk.reasons, limits: risk.limits, grossNotionalUsd: risk.grossNotionalUsd,
      capitalAtRiskUsd: risk.capitalAtRiskUsd, snapshotHash: risk.snapshotHash ?? null, factCoverage: risk.factCoverage ?? null } : null,
    blocked: blocked ? { stage: blocked.stage, reason: blocked.reason, reasons: blocked.reasons ?? null, limits: blocked.limits ?? null } : null,
    candidateRejected: rejected.get(String(run.id))?.reason ?? null,
    reachedReservation: reservations.has(symbol), reachedIntent: intents.has(symbol), reachedSubmit: orders.has(symbol), reachedFill: fills.has(symbol),
  };
});

const census = {};
for (const row of byType('ENTRY_DECISION_BLOCKED')) {
  const key = `${row.payload.stage}|${row.payload.reason}`;
  census[key] = census[key] ?? { total: 0, last6h: 0, reasonsSeen: new Set(), limitsSeen: new Set() };
  census[key].total += 1; if (row.ts >= from6) census[key].last6h += 1;
  for (const reason of row.payload.reasons ?? []) census[key].reasonsSeen.add(reason);
  for (const limit of row.payload.limits ?? []) census[key].limitsSeen.add(limit);
}
const admissionReasons = {};
for (const row of byType('PORTFOLIO_RISK_ADMISSION_EVALUATED')) {
  for (const reason of row.payload.reasons ?? []) {
    const key = reason;
    admissionReasons[key] = admissionReasons[key] ?? { total: 0, last6h: 0 };
    admissionReasons[key].total += 1; if (row.ts >= from6) admissionReasons[key].last6h += 1;
  }
}
const pipeline = (await get('/pipeline'));
const settingsResponse = await get('/settings');
const settings = settingsResponse.settings ?? settingsResponse;
const profile = settings.riskGovernance?.portfolioRisk ?? {};
const positions = db.prepare("SELECT payload FROM runtime_entities WHERE kind='positions'").all().map((row) => JSON.parse(row.payload));
const handoffs = positions.filter((row) => row.lossHandoff?.status === 'HUMAN_MANAGED' || row.lossHandoff?.status === 'HUMAN_HANDOFF');
const overdue = handoffs.filter((row) => now - Number(row.lossHandoff?.lastClosedBarAt ?? 0) > Number(profile.maxAckAgeMs ?? 0));
const grossNow = positions.reduce((sum, row) => sum + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0);

console.log(JSON.stringify({
  window: { hours, from: new Date(from).toISOString(), to: new Date(now).toISOString(), placeRuns: placeRuns.length,
    blockedTotal: byType('ENTRY_DECISION_BLOCKED').length },
  criticalValues: {
    profile: { maxHumanNotionalUsd: profile.maxHumanNotionalUsd, maxGrossNotionalUsd: profile.maxGrossNotionalUsd,
      maxClusterNotionalUsd: profile.maxClusterNotionalUsd, maxDirectionNotionalUsd: profile.maxDirectionNotionalUsd,
      maxCapitalAtRiskUsd: profile.maxCapitalAtRiskUsd, maxHumanPositions: profile.maxHumanPositions, maxPendingHandoffs: profile.maxPendingHandoffs,
      maxAckAgeMs: profile.maxAckAgeMs, snapshotTtlMs: profile.snapshotTtlMs },
    live: { positions: positions.length, grossNotionalUsd: Number(grossNow.toFixed(2)),
      humanHandoffRows: handoffs.length, overdueAcks: overdue.length, oldestOverdueHours: overdue.length ? Number(((now - Math.min(...overdue.map((row) => Number(row.lossHandoff.lastClosedBarAt)))) / 3_600_000).toFixed(1)) : null,
      headroomAgainstHumanNotional: Number((Number(profile.maxHumanNotionalUsd) - grossNow).toFixed(2)),
      headroomAgainstGrossNotional: Number((Number(profile.maxGrossNotionalUsd) - grossNow).toFixed(2)),
      slotHeadroom: Number(profile.maxHumanPositions ?? 0) - positions.length },
    capacityVisibility: { sideStatus: pipeline.capacityVisibility?.sideStatus ?? null, exhaustedForNewRisk: pipeline.capacityVisibility?.exhaustedForNewRisk ?? null,
      exposure: pipeline.capacityVisibility?.exposure ?? null, limits: pipeline.capacityVisibility?.limits ?? null,
      funding: pipeline.capacityVisibility?.funding?.quoteAssets?.map((row) => ({ quoteAsset: row.quoteAsset, availableBalanceUsd: row.availableBalanceUsd,
        executionLeaseMarginUsd: row.executionLeaseMarginUsd, executableMarginUsd: row.executableMarginUsd })) ?? null },
    authoritativeBlocker: pipeline.authoritativeBlocker ?? null,
    marketDataIsolation: pipeline.marketDataIsolation ?? null,
    conversion: { thirtyMinutes: pipeline.entryConversion?.thirtyMinutes ?? null, oneHour: pipeline.entryConversion?.oneHour ?? null },
  },
  vetoCensus: Object.fromEntries(Object.entries(census).map(([key, value]) => [key, { total: value.total, last6h: value.last6h,
    reasonsSeen: [...value.reasonsSeen].sort(), limitsSeen: [...value.limitsSeen].sort() }])),
  riskAdmissionReasonCounts: admissionReasons,
  otherVetoSignals: { candidateRejected: Object.fromEntries(Object.entries(byType('CANDIDATE_REJECTED').reduce((all, row) => {
    all[row.payload.reason] = (all[row.payload.reason] ?? 0) + 1; return all; }, {}))),
    aiSizingErrors: byType('AI_SIZING_ERROR').length,
    planFeasibilityRefusals: byType('PRE_AI_TRADE_PLAN_FEASIBILITY').filter((row) => row.payload.noHardExecutableSide).length,
    envelopesCreated: envelopes.length,
    dispatchIntents: byType('ANALYSIS_DISPATCH_INTENT').length,
    ownershipJournalDegraded: byType('V396_OWNERSHIP_JOURNAL_DEGRADED').length,
    tpManualReviewRequired: byType('TP_MANUAL_REVIEW_REQUIRED').length,
    entryOrderRemoteUnverified: byType('ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED').length,
    manualOrderRemoteUnverified: byType('MANUAL_ORDER_REMOTE_STATUS_UNVERIFIED').length },
  reachedChainTotals: { reservations: reservations.size, intents: intents.size, submits: orders.size, fills: fills.size },
  chains: chains.slice(-40), chainsTotal: chains.length,
}, null, 1));
db.close();

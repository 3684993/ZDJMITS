// Phase 1.C read-only counterfactual: for real PLACE candidates, compute each gate's pass/fail threshold from the
// exchange facts and the committed profile that were in force at decision time, then name the first binding
// constraint numerically. GETs and a readOnly store open only; nothing is submitted, changed or restarted.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dataDir = process.argv[2] ?? 'data';
const base = process.argv[3] ?? 'http://127.0.0.1:8080/api/v3';
const perSide = Number(process.argv[4] ?? 4);
const now = Date.now();
const get = async (route) => {
  const response = await fetch(`${base}${route}`);
  if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}`);
  return response.json();
};
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), { readOnly: true });
const settings = await get('/settings');
const profile = (settings.settings ?? settings).riskGovernance?.portfolioRisk ?? {};
const planRows = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='allocationPlans'").all()
  .map((row) => ({ id: row.entity_id, plan: JSON.parse(row.payload) }))
  .filter((row) => Number(row.plan.createdAt ?? 0) >= now - 6 * 3_600_000);
const envelopes = db.prepare("SELECT ts, payload FROM runtime_events WHERE type='PRE_AI_EXECUTION_ENVELOPE_CREATED' AND ts>=? ORDER BY ts").all(now - 6 * 3_600_000)
  .map((row) => ({ ts: row.ts, ...JSON.parse(row.payload).executionEnvelope }));
const admissionFor = new Map(db.prepare("SELECT ts, payload FROM runtime_events WHERE type='PORTFOLIO_RISK_ADMISSION_EVALUATED' AND ts>=? ORDER BY ts").all(now - 6 * 3_600_000)
  .map((row) => { const payload = JSON.parse(row.payload); return [String(payload.allocationPlanId ?? ''), { ts: row.ts, payload }]; }));
const positions = db.prepare("SELECT payload FROM runtime_entities WHERE kind='positions'").all().map((row) => JSON.parse(row.payload));
const grossNow = positions.reduce((sum, row) => sum + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0);
const handoffNotionalNow = positions.reduce((sum, row) => sum + (row.lossHandoff?.status ? Math.abs(Number(row.quantity) * Number(row.markPrice)) : 0), 0);
const overdueNow = positions.filter((row) => row.lossHandoff?.status === 'HUMAN_HANDOFF' && now - Number(row.lossHandoff.lastClosedBarAt ?? 0) > Number(profile.maxAckAgeMs ?? 0));

/**
 * Every ENFORCE gate expressed as "how much new notional this side may still add". A gate that does not depend on
 * size is reported as a boolean condition instead of pretending to be a dollar limit.
 */
function gates(side, planned) {
  const longNow = positions.filter((row) => row.side === 'LONG').reduce((sum, row) => sum + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0);
  const shortNow = positions.filter((row) => row.side === 'SHORT').reduce((sum, row) => sum + Math.abs(Number(row.quantity) * Number(row.markPrice)), 0);
  const directionNow = side === 'LONG' ? longNow : shortNow;
  return {
    GROSS_NOTIONAL: { limitUsd: Number(profile.maxGrossNotionalUsd), usedUsd: Number(grossNow.toFixed(2)),
      maxAdditionalNotionalUsd: Number((Number(profile.maxGrossNotionalUsd) - grossNow).toFixed(2)), plannedNotionalUsd: planned,
      passes: grossNow + planned <= Number(profile.maxGrossNotionalUsd) },
    DIRECTION_NOTIONAL: { limitUsd: Number(profile.maxDirectionNotionalUsd), usedUsd: Number(directionNow.toFixed(2)),
      maxAdditionalNotionalUsd: Number((Number(profile.maxDirectionNotionalUsd) - directionNow).toFixed(2)), plannedNotionalUsd: planned,
      passes: directionNow + planned <= Number(profile.maxDirectionNotionalUsd) },
    HUMAN_HANDOFF_NOTIONAL: { limitUsd: Number(profile.maxHumanNotionalUsd), usedUsd: Number(handoffNotionalNow.toFixed(2)),
      maxAdditionalNotionalUsd: Number((Number(profile.maxHumanNotionalUsd) - handoffNotionalNow).toFixed(2)), plannedNotionalUsd: planned,
      passes: handoffNotionalNow + planned <= Number(profile.maxHumanNotionalUsd) },
    ACK_OVERDUE: { sizeIndependent: true, overduePositions: overdueNow.length, maxAckAgeMs: Number(profile.maxAckAgeMs),
      passes: overdueNow.length === 0, formula: 'refuses at any notional while a HUMAN_HANDOFF row is older than maxAckAgeMs' },
    CLUSTER_NOTIONAL: { limitUsd: Number(profile.maxClusterNotionalUsd), note: 'cluster membership comes from the committed correlation dataset; the ledger computes it per admission',
      passes: null },
  };
}
const picks = [];
const bySide = { LONG: [], SHORT: [] };
// Newest plans first: an admission event and the envelope that sized the plan belong to the same cycle,
// and a cycle is a couple of minutes wide. Oldest-first sampling would join a plan to an envelope from a
// much earlier cycle and report facts that were never in force together.
const ordered = [...planRows].sort((a, b) => Number(b.plan.createdAt) - Number(a.plan.createdAt));
const planIdsWithAdmission = new Set(planRows.map((row) => row.id).filter((id) => admissionFor.has(String(id))));
const orphanPlans = ordered.filter((row) => !planIdsWithAdmission.has(row.id)).slice(0, 6)
  .map((row) => ({ allocationPlanId: row.id, symbol: row.plan.symbol, direction: row.plan.direction, admission: row.plan.admission,
    createdAt: new Date(Number(row.plan.createdAt)).toISOString(), reasons: row.plan.reasons }));
for (const { id, plan } of ordered) {
  const side = String(plan.direction);
  if (!['LONG', 'SHORT'].includes(side) || bySide[side].length >= perSide) continue;
  const envelope = envelopes.filter((row) => String(row.symbol).toUpperCase() === String(plan.symbol).toUpperCase()
    && Math.abs(row.ts - Number(plan.createdAt)) <= 300_000).sort((a, b) => Math.abs(a.ts - Number(plan.createdAt)) - Math.abs(b.ts - Number(plan.createdAt)))[0] ?? null;
  const sideFacts = envelope?.[side] ?? null;
  const admission = admissionFor.get(String(id));
  bySide[side].push({
    allocationPlanId: id, symbol: plan.symbol, side, quoteAsset: plan.quoteAsset, createdAt: new Date(Number(plan.createdAt)).toISOString(),
    plannedNotionalUsd: Number(plan.notionalUsd), plannedMarginUsd: Number(plan.marginUsd), verifiedLeverage: plan.leverage ?? null,
    exchangeFacts: envelope?.exchange ?? null,
    exchangeMinimumLegalNotionalUsd: sideFacts?.minimumLegalNotionalUsd ?? null,
    legalQuantityRangeUnits: sideFacts?.legalQuantityRangeUnits ?? null,
    capitalMaximumExecutableNotionalUsd: sideFacts?.maxNotionalUsd ?? null,
    envelopeSideExecutable: sideFacts?.executable ?? null,
    funding: envelope?.account ? { availableMarginUsd: envelope.account.availableMarginUsd, reservedMarginUsd: envelope.account.reservedMarginUsd,
      executionLeaseMarginUsd: envelope.account.executionLeaseMarginUsd, freeMarginUsd: envelope.account.freeMarginUsd } : null,
    admissionAtDecisionTime: admission ? { allowed: admission.payload.allowed, reasons: admission.payload.reasons, limits: admission.payload.limits,
      grossNotionalUsdAtClaim: Number(admission.payload.grossNotionalUsd?.toFixed?.(2) ?? admission.payload.grossNotionalUsd),
      capitalAtRiskUsdAtClaim: admission.payload.capitalAtRiskUsd } : null,
    counterfactualGates: gates(side, Number(plan.notionalUsd)),
  });
}
picks.push(...bySide.LONG, ...bySide.SHORT);
const distance = (row) => Object.fromEntries(Object.entries(row.counterfactualGates)
  .filter(([, gate]) => gate.maxAdditionalNotionalUsd !== undefined)
  .map(([name, gate]) => [name, { headroomUsd: gate.maxAdditionalNotionalUsd, distanceFromPlannedUsd: Number((gate.maxAdditionalNotionalUsd - row.plannedNotionalUsd).toFixed(2)), passes: gate.passes }]));
const firstBinding = (row) => {
  const entries = Object.entries(row.counterfactualGates).filter(([, gate]) => gate.sizeIndependent && !gate.passes)
    .map(([name]) => ({ name, kind: 'size-independent condition currently false' }));
  const numeric = Object.entries(row.counterfactualGates).filter(([, gate]) => gate.maxAdditionalNotionalUsd !== undefined && !gate.passes)
    .sort((a, b) => a[1].maxAdditionalNotionalUsd - b[1].maxAdditionalNotionalUsd)
    .map(([name, gate]) => ({ name, headroomUsd: gate.maxAdditionalNotionalUsd, shortByUsd: Number((row.plannedNotionalUsd - gate.maxAdditionalNotionalUsd).toFixed(2)) }));
  return [...entries, ...numeric];
};
console.log(JSON.stringify({
  at: new Date(now).toISOString(),
  book: { positions: positions.length, grossNotionalUsd: Number(grossNow.toFixed(2)), humanHandoffNotionalUsd: Number(handoffNotionalNow.toFixed(2)),
    overdueHandoffs: overdueNow.length, oldestOverdueHours: overdueNow.length ? Number(((now - Math.min(...overdueNow.map((row) => Number(row.lossHandoff.lastClosedBarAt)))) / 3_600_000).toFixed(1)) : null },
  profileLimits: { maxGrossNotionalUsd: profile.maxGrossNotionalUsd, maxHumanNotionalUsd: profile.maxHumanNotionalUsd,
    maxClusterNotionalUsd: profile.maxClusterNotionalUsd, maxDirectionNotionalUsd: profile.maxDirectionNotionalUsd,
    maxCapitalAtRiskUsd: profile.maxCapitalAtRiskUsd, maxHumanPositions: profile.maxHumanPositions, maxAckAgeMs: profile.maxAckAgeMs },
  note: 'GROSS_NOTIONAL and HUMAN_HANDOFF_NOTIONAL are two distinct committed limits that currently bind on the same dollar sum, because every open row is a human handoff.',
  planToAdmissionCoverage: { plansInWindow: planRows.length, withAdmissionEvent: planIdsWithAdmission.size,
    withoutAdmissionEvent: planRows.length - planIdsWithAdmission.size, sampleWithout: orphanPlans },
  picks: picks.map((row) => ({ ...row, distance, firstBinding: firstBinding(row) })),
}, null, 1));
db.close();

// Read-only G2 attribution: for every primary run since a boundary, pair the envelope's legal quantity interval with the
// deterministic AllocationPlan the engine actually built, and report mutation/refusal facts. Nothing is written.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const dataDir = process.argv[2] ?? 'data';
const since = Number(process.argv[3] ?? 0);
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});

const events = db.prepare('SELECT ts, type, payload FROM runtime_events WHERE ts>=? ORDER BY ts')
  .all(since).map((r) => ({...r, payload: JSON.parse(r.payload)}));
const envelopes = events.filter((r) => r.type === 'PRE_AI_EXECUTION_ENVELOPE_CREATED')
  .map((r) => ({...r, symbol: r.payload.executionEnvelope?.symbol}));
const sideOf = (symbol, ts, side) => {
  const match = envelopes.filter((e) => e.symbol === symbol && Math.abs(e.ts - ts) <= 180_000)
    .sort((a, b) => Math.abs(a.ts - ts) - Math.abs(b.ts - ts))[0]?.payload.executionEnvelope?.[side];
  return match ?? null;
};
const plans = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='allocationPlans'").all()
  .map((r) => ({id: r.entity_id, plan: JSON.parse(r.payload)}))
  .filter((r) => Number(r.plan.createdAt ?? 0) >= since);
const runs = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='aiRuns'").all()
  .map((r) => JSON.parse(r.payload)).filter((r) => Number(r.startedAt ?? 0) >= since && r.role === 'PRIMARY_BRAIN');
const economic = new Map(events.filter((r) => r.type === 'ENTRY_ECONOMIC_ADMISSION_EVALUATED')
  .map((r) => [r.payload.brainRunId, {...r.payload, at: r.ts}]));
const blocked = new Map(events.filter((r) => r.type === 'ENTRY_DECISION_BLOCKED').map((r) => [r.payload.allocationPlanId, {...r.payload, at: r.ts}]));
const sizingErrors = events.filter((r) => r.type === 'AI_SIZING_ERROR');

const chains = plans.map(({id, plan}) => {
  const run = runs.find((r) => r.symbol === plan.symbol && r.direction === plan.direction && Math.abs(Number(r.completedAt ?? 0) - Number(plan.createdAt)) <= 180_000);
  const side = sideOf(plan.symbol, Number(plan.createdAt), plan.direction);
  const econ = economic.get(run?.id) ?? null;
  const refusal = blocked.get(id) ?? null;
  return {allocationPlanId: id, symbol: plan.symbol, direction: plan.direction, createdAt: new Date(Number(plan.createdAt)).toISOString(),
    runId: run?.id ?? null, model: run?.model ?? null, decision: run?.decision ?? null,
    envelope: side ? {minQuantityUnits: side.minQuantityUnits ?? null, maxQuantityUnits: side.maxQuantityUnits ?? null,
      legalQuantityRangeUnits: side.legalQuantityRangeUnits ?? null, legalNotionalRangeUsd: side.legalNotionalRangeUsd ?? null,
      minimumLegalNotionalUsd: side.minimumLegalNotionalUsd ?? null, executable: side.executable ?? null,
      firstBindingConstraint: side.firstBindingConstraint ?? null} : null,
    plan: {admission: plan.admission, reasons: plan.reasons, notionalUsd: plan.notionalUsd, marginUsd: plan.marginUsd,
      leverage: plan.leverage, minExecutableMarginUsd: plan.minExecutableMarginUsd, locationWouldBlock: plan.locationWouldBlock,
      exposureBefore: plan.exposureBefore, exposureAfter: plan.exposureAfter},
    aboveMinimumLegalNotional: side?.minimumLegalNotionalUsd != null ? Number(plan.notionalUsd) + 1e-9 >= Number(side.minimumLegalNotionalUsd) : null,
    insideLegalNotionalInterval: side?.legalNotionalRangeUsd?.length === 2
      ? Number(plan.notionalUsd) + 1e-9 >= Number(side.legalNotionalRangeUsd[0]) && Number(plan.notionalUsd) <= Number(side.legalNotionalRangeUsd[1]) + 1e-6 : null,
    quantityMutated: econ?.quantityMutated ?? null, targetMutated: econ?.targetMutated ?? null,
    economicBlockers: econ?.blockers ?? null,
    refusal: refusal ? {stage: refusal.stage, reasons: refusal.reasons} : null};
});

console.log(JSON.stringify({
  sinceIso: since ? new Date(since).toISOString() : null,
  totals: {primaryRuns: runs.length, allocationPlans: plans.length, envelopes: envelopes.length, aiSizingErrorEvents: sizingErrors.length,
    quantityMutated: chains.filter((c) => c.quantityMutated === true).length, targetMutated: chains.filter((c) => c.targetMutated === true).length,
    frozenQuantityPlans: chains.filter((c) => (c.plan.reasons ?? []).includes('AI_QUANTITY_UNITS_FROZEN')).length,
    belowMinimumLegalNotional: chains.filter((c) => c.aboveMinimumLegalNotional === false).length,
    outsideLegalNotionalInterval: chains.filter((c) => c.insideLegalNotionalInterval === false).length,
    submittedOrFilledEvents: events.filter((r) => ['ENTRY_ORDER_SUBMITTED', 'ENTRY_ORDER_FILLED'].includes(r.type)).length},
  chains,
}, null, 1));

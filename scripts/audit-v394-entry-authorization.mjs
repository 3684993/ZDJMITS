import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

// Entry authorization integrity auditor: proves, from durable runtime events, that the AI's own
// side / quantityUnits / acceptablePriceRange survived into the intent, the submitted order and the
// TP, and that no legacy direction policy vetoed anything. Used for Stage7 and for the 12H/24H windows.

const db = new DatabaseSync('data/zdj-settings.sqlite', { readOnly: true });
const sinceArg = process.argv[2] ? Date.parse(process.argv[2]) : Date.now() - 60 * 60_000;

const readJson = (p) => {
  let t = fs.readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return JSON.parse(t);
};

const rows = db
  .prepare('SELECT type,symbol,payload,ts FROM runtime_events WHERE ts>? ORDER BY ts')
  .all(sinceArg);

const byType = new Map();
for (const r of rows) {
  if (!byType.has(r.type)) byType.set(r.type, []);
  byType.get(r.type).push(r);
}
const parse = (r) => JSON.parse(r.payload);

const intents = (byType.get('ENTRY_INTENT_CREATED') ?? []).map(parse);
const orders = (byType.get('ENTRY_ORDER_CREATED') ?? []).map(parse);
const runs = (byType.get('AI_RUN_TERMINAL') ?? []).map(parse);
const fills = (byType.get('ENTRY_FILLED') ?? []).concat(byType.get('EXECUTION_FILL_OBSERVED') ?? []);

const LEGACY_VETOES = ['DIRECTION_NOT_ALLOWED', 'SPECULATIVE_LONG_EXCEPTION_EVIDENCE_REQUIRED'];
const vetoEvents = rows.filter(
  (r) => r.type === 'ENTRY_DIRECTION_POLICY_BLOCKED'
    || LEGACY_VETOES.includes(String(parse(r)?.reason ?? '')),
);

const tpSource = {};
for (const r of byType.get('TAKE_PROFIT_TARGET_SELECTED') ?? []) {
  const p = parse(r);
  tpSource[p.symbol] = p.source ?? p.tpSource ?? null;
}

const report = {
  windowSince: new Date(sinceArg).toISOString(),
  counts: {
    events: rows.length, aiRuns: runs.length, intents: intents.length,
    orders: orders.length, fills: fills.length, tpTargetSelected: (byType.get('TAKE_PROFIT_TARGET_SELECTED') ?? []).length,
  },
  aiDecisions: {},
  violations: { sideMismatch: 0, quantityMismatch: 0, rangeMismatch: 0, policyLeak: vetoEvents.length, nonAiTp: 0 },
  entries: [],
};

const decisionByRun = new Map(runs.map((r) => [r.id ?? r.runId ?? r.brainRunId, r]));

for (const intent of intents) {
  const i = intent.intent ?? intent;
  // Join on the run id when present, else on the most recent AI run for the same symbol that had
  // already started: id formats differ across read models and a silent miss would weaken the audit.
  const run = decisionByRun.get(i.brainRunId) ?? decisionByRun.get(i.decisionChainId)
    ?? runs.filter((r) => r.symbol === i.symbol && (r.startedAt ?? 0) <= (i.createdAt ?? Infinity))
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  // AI_RUN_TERMINAL carries the decision as flat fields; the executable authorization itself is the
  // frozen intent, whose side / quantityUnits / acceptablePriceRange / profitTakePlan can only come
  // from the AI contract (contracts/ai.ts rejects a PLACE without them).
  const d = run ? { decision: run.decision, side: run.direction ?? null, quantityUnits: run.quantityUnits ?? null } : {};
  const order = orders.map((o) => o.order ?? o).find((o) => o.intentId === i.id);
  const range = d.acceptablePriceRange ?? i.acceptablePriceRange ?? {};
  const row = {
    symbol: i.symbol,
    aiDecision: d.decision ?? null,
    aiSide: d.side ?? d.tradeSide ?? d.direction ?? null,
    aiQuantityUnits: d.quantityUnits ?? i.quantityUnits ?? null,
    aiRange: range,
    intentSide: i.side,
    intentQuantityUnits: i.quantityUnits,
    orderSide: order?.side ?? null,
    orderPrice: order?.price ?? null,
    orderQuantity: order?.quantity ?? null,
    orderStatus: order?.status ?? null,
    exchangeOrderId: order?.exchangeOrderId ?? null,
    tpSource: tpSource[i.symbol] ?? null,
  };
  const problems = [];
  if (row.aiSide && row.intentSide && row.aiSide !== row.intentSide) problems.push('AI→intent side');
  if (row.intentSide && row.orderSide && row.intentSide !== row.orderSide) problems.push('intent→order side');
  if (row.aiQuantityUnits != null && row.intentQuantityUnits != null && row.aiQuantityUnits !== row.intentQuantityUnits) problems.push('quantityUnits');
  if (row.orderPrice != null && Number.isFinite(range.min) && (row.orderPrice < range.min || row.orderPrice > range.max)) problems.push('order price outside AI range');
  if (row.tpSource && row.tpSource !== 'AI') problems.push(`tp source ${row.tpSource}`);
  row.problems = problems;
  report.entries.push(row);
  report.violations.sideMismatch += problems.filter((p) => /side/.test(p)).length;
  report.violations.quantityMismatch += problems.filter((p) => /quantityUnits/.test(p)).length;
  report.violations.rangeMismatch += problems.filter((p) => /range/.test(p)).length;
  report.violations.nonAiTp += problems.filter((p) => /tp source/.test(p)).length;
}

for (const r of byType.get('AI_RUN_TERMINAL') ?? []) {
  const p = parse(r);
  const k = p.decision ?? p.status ?? 'unknown';
  report.aiDecisions[k] = (report.aiDecisions[k] ?? 0) + 1;
}
report.policyLeakSamples = vetoEvents.slice(0, 5).map((r) => ({ type: r.type, symbol: r.symbol, reason: parse(r)?.reason }));

console.log(JSON.stringify(report, null, 1));
report.violations.total = report.violations.sideMismatch + report.violations.quantityMismatch
  + report.violations.rangeMismatch + report.violations.policyLeak;
console.error(`AUDIT verdict violations_total=${report.violations.total} entries=${report.entries.length} aiRuns=${report.counts.aiRuns}`);
db.close();

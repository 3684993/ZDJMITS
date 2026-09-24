// Post-activation monitor: what the natural pipeline is actually doing since the CAS, read from the
// durable event log plus the live projections. Nothing here triggers work; it only observes.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const since = Number(process.argv[2] ?? 0);
const BASE = 'http://127.0.0.1:8080';
const pipe = await (await fetch(`${BASE}/api/v3/pipeline`, { signal: AbortSignal.timeout(30000) })).json().catch(() => ({}));
const close = await (await fetch(`${BASE}/api/v3/diagnostics/closeout`, { signal: AbortSignal.timeout(30000) })).json().catch(() => ({}));
const wb = close.productionWriteBoundary ?? {};
console.log(`# observedAt=${new Date().toISOString()} since=${since ? new Date(since).toISOString() : 'n/a'}`);
console.log(`# execution=${wb.executionMode} testnetWrites=${wb.testnetWrites} productionWrites=${wb.productionWrites} lastWriteAt=${wb.lastWriteAt} lastWritePath=${JSON.stringify(wb.lastWritePath ?? null)}`);
console.log(`# readiness=${JSON.stringify(pipe.executionReadiness ?? null)}`);
console.log(`# analysis=${JSON.stringify({ mode: pipe.analysis?.mode, reason: pipe.analysis?.reason, lastBlockedReason: pipe.analysis?.lastBlockedReason, lastTickAt: pipe.analysis?.lastTickAt, capitalExecutableCount: pipe.analysis?.capitalExecutableCount, active: pipe.analysis?.active })}`);
console.log(`# primaryBrain=${JSON.stringify({ status: pipe.primaryBrain?.status, runs: pipe.primaryBrain?.runs, historicalRuns: pipe.primaryBrain?.historicalRuns, idleReason: pipe.primaryBrain?.idleReason, model: pipe.primaryBrain?.resource?.model, lastDecision: pipe.primaryBrain?.resource?.lastDecision, lastDirection: pipe.primaryBrain?.resource?.lastDirection, lastCompletedAt: pipe.primaryBrain?.resource?.lastCompletedAt, lastLatencyMs: pipe.primaryBrain?.resource?.lastLatencyMs, queueDepth: pipe.primaryBrain?.resource?.queueDepth, active: pipe.primaryBrain?.resource?.active })}`);
console.log(`# capacity=${JSON.stringify(pipe.capacityVisibility?.slots ?? null)} gross=${JSON.stringify({ used: pipe.capacityVisibility?.gross?.notionalUsd, limit: pipe.capacityVisibility?.gross?.limitUsd, remaining: pipe.capacityVisibility?.gross?.remainingUsd })} firstBlocker=${pipe.capacityVisibility?.firstBlocker} exhausted=${pipe.capacityVisibility?.exhaustedForNewRisk}`);
console.log(`# entryActivity=${JSON.stringify(pipe.entryActivity ?? null)}`);
console.log(`# pool=${JSON.stringify({ count: pipe.pool?.count ?? pipe.pool?.list?.length ?? null, ready: pipe.pool?.ready ?? null, reason: pipe.pool?.reason ?? null })}`);
console.log(`# positions=${JSON.stringify(pipe.existingPositions ?? null)} tp=${JSON.stringify({ required: pipe.takeProfit?.required, protected: pipe.takeProfit?.protected })} pendingEntries=${JSON.stringify(pipe.pendingEntries ?? null)}`);
console.log(`# noEntryReason=${JSON.stringify(pipe.noEntryReason ?? null)} pipelineState=${JSON.stringify(pipe.pipelineState ?? null)}`);

const db = new DatabaseSync(path.join(root, 'data/zdj-settings.sqlite'), { readOnly: true });
const rows = db.prepare('SELECT type, ts, symbol, payload FROM runtime_events WHERE ts >= ? ORDER BY ts DESC LIMIT 400').all(since || 0);
db.close();
const tally = new Map();
for (const row of rows) tally.set(row.type, (tally.get(row.type) ?? 0) + 1);
console.log(`\n## durable event types since window (total ${rows.length})`);
for (const [type, count] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)) console.log(`   ${count} x ${type}`);
const interesting = rows.filter(row => /PLACE|TRADE_PLAN|ENTRY_INTENT|ENTRY_ORDER|ADMISSION|SUBMIT|FILL|RISK_TICKET|AI_RUN|BRAIN|EXECUTION_READINESS|ENTRY_BLOCKED|OWNER|POSITION_OPENED|WRITE/i.test(row.type));
console.log(`\n## execution-relevant events (${interesting.length}), newest first`);
for (const row of interesting.slice(0, 30)) console.log(`   ${new Date(row.ts).toISOString()} ${row.type} ${row.symbol ?? ''} ${JSON.stringify(row.payload).slice(0, 260)}`);

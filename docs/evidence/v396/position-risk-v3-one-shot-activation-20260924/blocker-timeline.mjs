// Timeline boundary evidence for the final report: for each risk blocker, where it stands relative to
// the two moments that matter — the V3 build's first start (15:09:04Z) and the routing-demand coverage
// commit (16:12:20.879Z). Read-only over the durable event log.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const V3_START = 1790262544502;
const WIDE_COMMIT = 1790266340879;
const db = new DatabaseSync(path.join(root, 'data/zdj-settings.sqlite'), { readOnly: true });
const needle = term => `%${term}%`;
const types = ['MAINTENANCE_MARGIN_UNPROVEN', 'POSITION_MARGIN_ASSET_UNPROVEN', 'LIQUIDATION_BUFFER_UNPROVEN', 'MARGIN_TIER_SYMBOL_UNPROVEN', 'ACCOUNT_ASSET_UNVERIFIED', 'MARGIN_ASSET_UNVERIFIED', 'EXCHANGE_WRITE_LOCKED', 'PROFILE_NOT_CONFIGURED', 'PROFILE_FACTS_UNPROVEN', 'ANALYSIS_ONLY', 'POSITION_FACT_INVALID', 'POSITION_FACT_UNVERIFIED'];
console.log(`# durable runtime_events, read-only; V3 instance start=${new Date(V3_START).toISOString()} routing-demand commit=${new Date(WIDE_COMMIT).toISOString()}`);
for (const term of types) {
  const all = db.prepare('SELECT COUNT(*) n, MAX(ts) last FROM runtime_events WHERE payload LIKE ?').get(needle(term));
  const sinceStart = db.prepare('SELECT COUNT(*) n FROM runtime_events WHERE payload LIKE ? AND ts > ?').get(needle(term), V3_START).n;
  const sinceCommit = db.prepare('SELECT COUNT(*) n FROM runtime_events WHERE payload LIKE ? AND ts > ?').get(needle(term), WIDE_COMMIT).n;
  console.log(`  ${term.padEnd(30)} total=${String(all.n).padStart(4)}  last=${all.last ? new Date(all.last).toISOString() : 'never'}  sinceV3Start=${sinceStart}  sinceWideCommit=${sinceCommit}`);
}
const adm = db.prepare("SELECT ts, symbol, payload FROM runtime_events WHERE type='PORTFOLIO_RISK_ADMISSION_EVALUATED' AND ts > ? ORDER BY ts").all(WIDE_COMMIT);
console.log(`\n# admissions after the routing-demand commit: ${adm.length}`);
for (const row of adm) {
  const p = JSON.parse(row.payload);
  console.log(`  ${new Date(row.ts).toISOString()} ${row.symbol ?? ''} allowed=${p.allowed} generation=${p.riskGeneration} factCoverage=${JSON.stringify(p.factCoverage)} reasons=${JSON.stringify(p.reasons)}`);
}
const blocked = db.prepare("SELECT ts, symbol, payload FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts > ? ORDER BY ts").all(WIDE_COMMIT);
console.log(`\n# decisions still blocked after that commit: ${blocked.length}`);
for (const row of blocked) {
  const p = JSON.parse(row.payload);
  console.log(`  ${new Date(row.ts).toISOString()} ${row.symbol ?? ''} stage=${p.stage} reasons=${JSON.stringify(p.reasons)}`);
}
const writes = db.prepare("SELECT COUNT(*) n FROM runtime_events WHERE ts > ? AND (type LIKE '%SUBMIT%' OR type LIKE '%ENTRY_ORDER_CREATED%' OR type LIKE '%POSITION_OPENED%' OR type='ENTRY_INTENT_CREATED')").get(WIDE_COMMIT).n;
console.log(`\n# submit-side events after the commit: ${writes} (none expected while every candidate stops at TRADE_PLAN economics)`);
db.close();

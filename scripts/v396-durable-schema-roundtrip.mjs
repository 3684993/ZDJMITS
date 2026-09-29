// Read-only durable round-trip check: every persisted row is parsed back through the contract schema
// it will be loaded with. A field a writer emits that the schema does not declare is not a cosmetic
// problem - zod strips unknown keys on the way out and rejects bad enum values on the way in, so a
// single undeclared status turns into a silent data loss on the dashboard or a Engine that cannot
// start at all. This script finds both before a restart does.
//
//   node scripts/v396-durable-schema-roundtrip.mjs [dataDir]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(root, process.argv[2] ?? 'data');
const contracts = await import(pathToFileURL(path.join(root, 'packages/contracts/dist/index.js')).href);

// Each kind is the shape the Engine loads it as. `tradeRecords` also lives in its own table, which is
// the hydration source at startup, so both are checked.
const kinds = [
  { from: 'runtime_entities', kind: 'positions', schema: contracts.PositionSchema },
  { from: 'runtime_entities', kind: 'entryOrders', schema: contracts.EntryOrderSchema },
  { from: 'runtime_entities', kind: 'entryIntents', schema: contracts.EntryIntentSchema },
  { from: 'runtime_entities', kind: 'tpOrders', schema: contracts.TakeProfitOrderSchema },
  { from: 'runtime_entities', kind: 'manualOrders', schema: contracts.ManualOrderSchema },
  { from: 'runtime_entities', kind: 'tradeRecords', schema: contracts.TradeRecordSchema },
  { from: 'runtime_entities', kind: 'executionFills', schema: contracts.ExecutionFillSchema },
  { from: 'table', table: 'trade_records', schema: contracts.TradeRecordSchema },
];

const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), { readOnly: true });
const report = [];
for (const check of kinds) {
  const rows = check.from === 'table'
    ? db.prepare(`SELECT payload FROM ${check.table}`).all()
    : db.prepare('SELECT payload FROM runtime_entities WHERE kind=?').all(check.kind);
  const issues = new Map();
  let invalid = 0;
  for (const row of rows) {
    let payload = null;
    try { payload = JSON.parse(String(row.payload)); } catch (error) {
      invalid += 1;
      issues.set('UNPARSEABLE_JSON', (issues.get('UNPARSEABLE_JSON') ?? 0) + 1);
      continue;
    }
    const parsed = check.schema.safeParse(payload);
    if (parsed.success) continue;
    invalid += 1;
    for (const issue of parsed.error.issues) {
      const detail = issue.code === 'invalid_enum_value' ? `received=${JSON.stringify(issue.received)} allowed=${(issue.options ?? []).join('|')}`
        : issue.code === 'unrecognized_keys' ? `keys=${(issue.keys ?? []).join(',')}`
          : `received=${JSON.stringify(issue.received)} expected=${JSON.stringify(issue.expected ?? null)} minimum=${JSON.stringify(issue.minimum ?? null)}`;
      const key = `${issue.path.join('.') || '(root)'} ${issue.code} ${detail}`;
      issues.set(key, (issues.get(key) ?? 0) + 1);
    }
  }
  report.push({ source: check.from === 'table' ? check.table : check.kind, rows: rows.length, invalid,
    issues: [...issues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([issue, count]) => `${issue} x${count}`) });
}
db.close();

const failed = report.filter(row => row.invalid > 0);
console.log(JSON.stringify({ dataDir: path.relative(root, dataDir).replaceAll('\\', '/'), readOnly: true, exchangeWrites: 0,
  checked: report, verdict: failed.length ? 'DURABLE_SCHEMA_MISMATCH' : 'DURABLE_SCHEMA_ROUNDTRIP_OK' }, null, 1));
if (failed.length) process.exitCode = 1;

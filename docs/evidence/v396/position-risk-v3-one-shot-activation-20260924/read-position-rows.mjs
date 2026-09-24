// Read-only forensic helper: asks the durable store what the running build actually persisted for
// each open position, so a null in an API projection can be told apart from a null from the exchange.
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2] ?? 'data/zdj-settings.sqlite';
const db = new DatabaseSync(file, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
console.log(`file=${file}`);
console.log(`tables=${tables.join(',')}`);
const candidate = tables.find(name => /position|entity|state|kv|record/i.test(name));
for (const name of tables) {
  const rows = db.prepare(`SELECT * FROM "${name}" LIMIT 1`).all();
  const cols = Object.keys(rows[0] ?? {});
  const jsonish = cols.find(col => /payload|value|json|data/i.test(col));
  if (!jsonish) continue;
  const matches = db.prepare(`SELECT * FROM "${name}"`).all().filter(row => String(row[jsonish] ?? '').includes('cycle_entry_intent') && String(row[jsonish] ?? '').includes('positionRiskSource'));
  const sample = db.prepare(`SELECT * FROM "${name}"`).all().filter(row => String(row[jsonish] ?? '').includes('"marginAsset"'));
  if (!sample.length) continue;
  console.log(`\n## ${name} (json column ${jsonish}): rows with marginAsset=${sample.length}, rows already carrying positionRiskSource=${matches.length}`);
  for (const row of sample.slice(0, 14)) {
    const payload = JSON.parse(row[jsonish]);
    const id = String(payload.id ?? payload.symbol ?? '');
    console.log(`  ${id} | side=${payload.side} | marginAsset=${JSON.stringify(payload.marginAsset ?? null)} | maint=${JSON.stringify(payload.maintenanceMarginUsd ?? null)} | liq=${JSON.stringify(payload.liquidationPrice ?? null)} | src=${JSON.stringify(payload.positionRiskSource ?? 'FIELD_ABSENT')} | mark=${payload.markPrice}`);
  }
}

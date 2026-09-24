// Lists every way the stored position rows currently violate the contract the dashboard parses them
// with. Run before and after a repair so nothing is discovered for the first time at start-up.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { PositionSchema } = await import(pathToFileURL(path.join(root, 'packages/contracts/dist/index.js')).href);
const db = new DatabaseSync(path.join(root, 'data/zdj-settings.sqlite'), { readOnly: true });
const rows = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='positions' ORDER BY entity_id").all();
db.close();
const tally = new Map();
let rejected = 0;
for (const row of rows) {
  const payload = JSON.parse(row.payload);
  const parsed = PositionSchema.safeParse(payload);
  if (parsed.success) continue;
  rejected++;
  for (const issue of parsed.error.issues) {
    const key = `${issue.path.join('.')} <- ${issue.code}/${issue.expected}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log(`  REJECTED ${payload.symbol}/${payload.side}: ${parsed.error.issues.map(issue => `${issue.path.join('')}=${JSON.stringify(issue.code)}(${issue.expected})`).join(' | ')}`);
}
console.log(`# rows=${rows.length} rejected=${rejected}`);
for (const [key, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${count} x ${key}`);
process.exit(rejected ? 1 : 0);

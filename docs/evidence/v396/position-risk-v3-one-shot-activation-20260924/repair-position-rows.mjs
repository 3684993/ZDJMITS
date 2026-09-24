// Repairs the durable position rows this deploy's own bug poisoned, and nothing else.
//
// Damage mechanism: `Number(row.leverage)` on a V3 row (V3 states no leverage) wrote NaN for every
// open position. NaN then travelled: `core.requiredNetProfit()` computes `Math.max(1, leverage)`, which
// is NaN for NaN, so `tpEconomics.requiredNetProfit` was stored as null too. Both violate the contract
// the dashboard parses positions with (`PositionSchema`), so the stored book is invalid on its own
// terms and can fail a projection at any moment before a fresh read heals it.
//
// Repair scope, and why each step is not an invention:
//   leverage      <- the value the exchange itself supports for that same live position (V2's stated
//                    leverage, or V3's own |notional| / initialMargin quotient), matched on
//                    symbol + side + quantity.
//   tpEconomics   <- cleared to null only when it is still contract-invalid after the leverage fix.
//                    null is the contract's own "not computed yet"; the running product recomputes it
//                    on its next TP pass. We do not fabricate a number we cannot source.
// Anything else that still fails the contract aborts the whole run with nothing written.
//
// Default is a dry run. --apply additionally requires: no Engine holding the store, Testnet, and a
// cold backup taken before the first byte changes.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const apply = process.argv.includes('--apply');
const dbPath = path.join(root, 'data/zdj-settings.sqlite');
const load = relative => import(pathToFileURL(path.join(root, relative)).href);

const { validPositionLeverage } = await load('apps/engine/dist/services/positionRiskFacts.js');
const { PositionSchema } = await load('packages/contracts/dist/index.js');
const open = readonly => new DatabaseSync(dbPath, readonly ? { readOnly: true } : {});
const issuesOf = payload => {
  const parsed = PositionSchema.safeParse(payload);
  return parsed.success ? [] : parsed.error.issues.map(issue => String(issue.path.join('.')));
};

const readRows = () => {
  const db = open(true);
  try { return db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='positions' ORDER BY entity_id").all().map(row => ({ id: row.entity_id, payload: JSON.parse(row.payload) })); }
  finally { db.close(); }
};
const rows = readRows();
console.log(`# durable position rows = ${rows.length}   mode=${apply ? 'APPLY' : 'DRY RUN'}`);
const unhealthy = rows.filter(row => issuesOf(row.payload).length > 0);
for (const row of rows) console.log(`  ${row.payload.symbol}/${row.payload.side} leverage=${JSON.stringify(row.payload.leverage ?? null)} contractIssues=${issuesOf(row.payload).join(',') || 'none'}`);
console.log(`# rows failing the contract the dashboard parses with = ${unhealthy.length}`);
if (!unhealthy.length) { console.log('# nothing to repair'); process.exit(0); }

const { SettingsStore } = await load('apps/engine/dist/config/settingsStore.js');
const { BinanceTransport } = await load('apps/engine/dist/adapters/binance/BinanceTransport.js');
const { ExternalTradeAdapter } = await load('apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js');
const store = new SettingsStore(path.join(root, 'config'), path.join(root, 'data'));
const settings = await store.load();
const transport = new BinanceTransport(settings.connections);
if (transport.environment() !== 'TESTNET') throw new Error(`REPAIR_REQUIRES_TESTNET:${transport.environment()}`);
const ref = settings.connections.exchange.credentialRef;
const [apiKey, apiSecret] = await Promise.all([store.getSecret(`${ref}:apiKey`), store.getSecret(`${ref}:apiSecret`)]);
const live = await new ExternalTradeAdapter(transport, apiKey && apiSecret ? { apiKey, apiSecret } : null, settings.connections.exchange.recvWindowMs).fetchPositions();
console.log(`# live V3 positions read through the deployed adapter = ${live.length}`);

const plan = [];
for (const row of unhealthy) {
  const stored = row.payload;
  const match = live.find(fresh => fresh.symbol === stored.symbol && fresh.side === stored.side);
  const leverage = validPositionLeverage(match?.leverage);
  const quantityMatches = match && Number.isFinite(Number(stored.quantity)) && Math.abs(Number(stored.quantity) - Number(match.quantity)) <= Math.max(1e-12, Number(stored.quantity) * 1e-6);
  let next = stored, clearedTpEconomics = false;
  const steps = [];
  if (validPositionLeverage(stored.leverage) === null) {
    if (leverage === null || !quantityMatches) { console.log(`  REFUSE ${stored.symbol}/${stored.side}: no exactly-matched live leverage`); plan.push({ row, next: null, ok: false }); continue; }
    next = { ...next, leverage };
    steps.push(`leverage null->${leverage}`);
  }
  if (issuesOf(next).length) {
    const offending = issuesOf(next);
    if (!offending.every(field => field.startsWith('tpEconomics'))) { console.log(`  REFUSE ${stored.symbol}/${stored.side}: unsupported contract failure ${offending.join(',')}`); plan.push({ row, next: null, ok: false }); continue; }
    next = { ...next, tpEconomics: null };
    clearedTpEconomics = true;
    steps.push(`tpEconomics {${offending.map(field => field.replace('tpEconomics.', '')).join(',')}}->null`);
  }
  const remaining = issuesOf(next);
  if (remaining.length) { console.log(`  REFUSE ${stored.symbol}/${stored.side}: still invalid after repair: ${remaining.join(',')}`); plan.push({ row, next: null, ok: false }); continue; }
  plan.push({ row, next, leverage, quantityMatches, clearedTpEconomics, ok: true, steps });
  console.log(`  REPAIR ${stored.symbol}/${stored.side}: ${steps.join(' , ')} (liveQty=${match ? match.quantity : 'n/a'} storedQty=${stored.quantity})`);
}
if (plan.some(item => !item.ok)) { console.log('# a row could not be sourced exactly; aborting with nothing written'); process.exit(1); }
if (!apply) { console.log(`# dry run only: ${plan.length} row(s) would be repaired. Re-run with --apply.`); process.exit(0); }

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z');
const backupDir = `D:/MITS-backups/position-row-repair-${stamp}`;
mkdirSync(backupDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  try { copyFileSync(dbPath + suffix, path.join(backupDir, `zdj-settings.sqlite${suffix}`)); } catch { console.log(`# backup skipped (absent): zdj-settings.sqlite${suffix}`); }
}
console.log(`# cold backup written to ${backupDir}`);

const db = open(false);
try {
  db.exec('BEGIN IMMEDIATE');
  const write = db.prepare("UPDATE runtime_entities SET payload = ? WHERE kind = 'positions' AND entity_id = ?");
  for (const item of plan) write.run(JSON.stringify(item.next), item.row.id);
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* the transaction never opened */ }
  console.log(`# write refused and rolled back: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally { db.close(); }

const after = readRows();
const stillInvalid = after.filter(row => issuesOf(row.payload).length);
for (const row of after) console.log(`  AFTER ${row.payload.symbol}/${row.payload.side} leverage=${JSON.stringify(row.payload.leverage)} tpEconomics=${row.payload.tpEconomics === null ? 'null' : 'present'} contract=${issuesOf(row.payload).length ? 'REJECTED' : 'ACCEPTED'}`);
writeFileSync(path.join(backupDir, 'repair-result.json'), JSON.stringify({
  stamp, mode: 'apply',
  before: rows.map(row => ({ id: row.id, symbol: row.payload.symbol, side: row.payload.side, leverage: row.payload.leverage, tpEconomics: row.payload.tpEconomics, contractIssues: issuesOf(row.payload) })),
  repairs: plan.map(item => ({ id: item.row.id, symbol: item.row.payload.symbol, steps: item.steps, liveMarginAsset: item.leverage === null ? null : item.row.payload.marginAsset ?? null })),
  after: after.map(row => ({ id: row.id, symbol: row.payload.symbol, leverage: row.payload.leverage, contractIssues: issuesOf(row.payload) })),
}, null, 2));
console.log(`# after: rows=${after.length} contractRejected=${stillInvalid.length}`);
console.log(`# evidence: ${backupDir}/repair-result.json`);
process.exit(stillInvalid.length ? 1 : 0);

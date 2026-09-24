// Post-mortem reader for the P0. Part 1 (default) opens the durable store read-only and prints the
// persisted position rows exactly as the crashed instance last wrote them. Part 2 (--live) asks the
// exchange through the deployed product path — signed GETs only, no writer is ever constructed or
// called — so a live V3 payload can be examined without restarting the Engine.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const numeric = (value) => (typeof value === 'number' ? (Number.isFinite(value) ? String(value) : `NON_FINITE(${value})`) : `${typeof value}:${JSON.stringify(value ?? null)}`);

const db = new DatabaseSync(path.join(root, 'data/zdj-settings.sqlite'), { readOnly: true });
const rows = db.prepare("SELECT kind, entity_id, payload FROM runtime_entities WHERE kind IN ('positions','position')").all();
console.log(`# durable position rows (readOnly open of data/zdj-settings.sqlite) count=${rows.length}`);
let nanCount = 0;
for (const row of rows) {
  const p = JSON.parse(row.payload);
  const suspect = ['quantity', 'markPrice', 'leverage', 'entryPrice', 'notionalUsd'].filter(key => typeof p[key] !== 'number' || !Number.isFinite(p[key]));
  if (suspect.length) nanCount++;
  console.log(`  ${p.symbol}/${p.side} | qty=${numeric(p.quantity)} mark=${numeric(p.markPrice)} lev=${numeric(p.leverage)} notional=${numeric(p.notionalUsd)} marginAsset=${JSON.stringify(p.marginAsset ?? null)} maint=${numeric(p.maintenanceMarginUsd ?? null)} liq=${numeric(p.liquidationPrice ?? null)} src=${JSON.stringify(p.positionRiskSource ?? 'FIELD_ABSENT')} tp=${p.tpStatus}${suspect.length ? `  <-- NON-FINITE: ${suspect.join(',')}` : ''}`);
}
console.log(`  rows with a non-finite quantity/markPrice/leverage/entryPrice/notionalUsd = ${nanCount}`);
db.close();

if (!process.argv.includes('--live')) {
  console.log('\n# part 2 skipped (pass --live to issue signed GETs through the deployed adapter)');
  process.exit(0);
}

const { pathToFileURL } = await import('node:url');
const load = async (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { SettingsStore } = await load('apps/engine/dist/config/settingsStore.js');
const { BinanceTransport } = await load('apps/engine/dist/adapters/binance/BinanceTransport.js');
const { ExternalTradeAdapter } = await load('apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js');

const store = new SettingsStore(path.join(root, 'config'), path.join(root, 'data'));
const settings = await store.load();
const transport = new BinanceTransport(settings.connections);
const ref = settings.connections.exchange.credentialRef;
const [apiKey, apiSecret] = await Promise.all([store.getSecret(`${ref}:apiKey`), store.getSecret(`${ref}:apiSecret`)]);
console.log(`\n# live read-only probe environment=${transport.environment()} credentialsPresent=${Boolean(apiKey && apiSecret)} (no key material is printed)`);
const adapter = new ExternalTradeAdapter(transport, apiKey && apiSecret ? { apiKey, apiSecret } : null, settings.connections.exchange.recvWindowMs);

const probe = await adapter.probePositionRiskFields();
console.log(`\n## probe endpoint=${probe.environment}/${probe.endpoint} rowCount=${probe.rowCount} readError=${JSON.stringify(probe.readError)}`);
console.log(`   fieldNames(${probe.fieldNames.length})=${probe.fieldNames.join(',')}`);
for (const row of probe.rows) console.log('   ' + JSON.stringify(row));

const v2 = await adapter.signed('GET', '/fapi/v2/positionRisk', undefined, 'POSITION_FACT_COMPARE', 'PRIVATE_STATE');
const v2list = Array.isArray(v2) ? v2 : [];
console.log(`\n## comparison GET /fapi/v2/positionRisk rowCount=${v2list.length}`);
console.log(`   v2 fieldNames=${[...new Set(v2list.flatMap(r => Object.keys(r ?? {})))].sort().join(',')}`);
const nonzero = v2list.filter(r => Number(r?.positionAmt ?? 0) !== 0);
if (nonzero.length) console.log('   v2 sample nonzero row = ' + JSON.stringify(nonzero[0]));

// The raw V3 rows, unfiltered, so the field-name question is answered by the exchange and not by us.
const v3 = await adapter.signed('GET', '/fapi/v3/positionRisk', undefined, 'POSITION_FACT_COMPARE', 'PRIVATE_STATE');
const v3list = Array.isArray(v3) ? v3 : [];
console.log(`\n## raw GET /fapi/v3/positionRisk rowCount=${v3list.length}`);
console.log(`   v3 fieldNames=${[...new Set(v3list.flatMap(r => Object.keys(r ?? {})))].sort().join(',')}`);
for (const row of v3list.filter(r => Number(r?.positionAmt ?? 0) !== 0).slice(0, 4)) console.log('   v3 nonzero row = ' + JSON.stringify(row));

const positions = await adapter.fetchPositions();
console.log(`\n## adapter.fetchPositions() rows=${positions.length}`);
for (const p of positions) console.log(`   ${p.symbol}/${p.side} qty=${numeric(p.quantity)} mark=${numeric(p.markPrice)} lev=${numeric(p.leverage)} notional=${numeric(p.notionalUsd ?? null)} maint=${numeric(p.maintenanceMarginUsd ?? null)} liq=${numeric(p.liquidationPrice ?? null)} marginAsset=${JSON.stringify(p.marginAsset ?? null)} src=${JSON.stringify(p.positionRiskSource ?? null)}`);
console.log(`\n## adapter.lastPositionRiskError=${JSON.stringify(adapter.lastPositionRiskError)}`);
const writes = transport.writeStats?.() ?? transport.executionStats?.() ?? null;
console.log(`# transport write stats after all reads = ${JSON.stringify(writes)}`);
process.exit(0);

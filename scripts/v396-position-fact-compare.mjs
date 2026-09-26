// Read-only position-fact comparison for Problem C: asks the exchange the same question the TP guardian
// asks, through the deployed product path. Signed GETs only — no writer, no submit, no engine lifecycle.
// The durable store is copied into an OS temp directory first, so this process never writes to `data/`.
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] ?? '.');
const load = async (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { SettingsStore } = await load('apps/engine/dist/config/settingsStore.js');
const { BinanceTransport } = await load('apps/engine/dist/adapters/binance/BinanceTransport.js');
const { ExternalTradeAdapter } = await load('apps/engine/dist/adapters/exchange/ExternalTradeAdapter.js');

const temp = mkdtempSync(path.join(os.tmpdir(), 'zdj-position-fact-'));
try {
  const source = path.join(root, 'data', 'zdj-settings.sqlite');
  copyFileSync(source, path.join(temp, 'zdj-settings.sqlite'));
  for (const suffix of ['-wal', '-shm']) {
    try { copyFileSync(source + suffix, path.join(temp, 'zdj-settings.sqlite' + suffix)); } catch { /* no side files */ }
  }
  const store = new SettingsStore(path.join(root, 'config'), temp);
  const settings = await store.load();
  const durable = await import('node:sqlite').then(({ DatabaseSync }) => new DatabaseSync(path.join(temp, 'zdj-settings.sqlite'), { readOnly: true }));
  const rows = durable.prepare("SELECT payload FROM runtime_entities WHERE kind='positions'").all().map((r) => JSON.parse(r.payload));
  durable.close();
  const wanted = rows.filter((r) => String(r.tpStatus) !== 'PROTECTED');
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), copiedStore: true, liveDataDirUntouched: true,
    environment: settings.connections.exchange.environment, executionMode: settings.connections.executionMode,
    settingsVersion: settings.settingsVersion, entrySafetyMode: settings.riskGovernance.entrySafetyMode,
    durablePositions: rows.length, notProtected: wanted.map((r) => `${r.symbol}:${r.side}:${r.tpStatus}:${r.tpCoverageSource ?? 'NONE'}`) }, null, 1));

  const transport = new BinanceTransport(settings.connections);
  const ref = settings.connections.exchange.credentialRef;
  const [apiKey, apiSecret] = await Promise.all([store.getSecret(`${ref}:apiKey`), store.getSecret(`${ref}:apiSecret`)]);
  const adapter = new ExternalTradeAdapter(transport, apiKey && apiSecret ? { apiKey, apiSecret } : null, settings.connections.exchange.recvWindowMs);
  console.log(`# credentialsPresent=${Boolean(apiKey && apiSecret)} (no key material printed)`);
  console.log(`# positionMode=${JSON.stringify(await adapter.exitCoordinationCapabilities())}`);

  const v2All = await adapter.signed('GET', '/fapi/v2/positionRisk', undefined, 'POSITION_FACT_COMPARE', 'PRIVATE_STATE');
  const v3All = await adapter.signed('GET', '/fapi/v3/positionRisk', undefined, 'POSITION_FACT_COMPARE', 'PRIVATE_STATE');
  const nonzero = (list) => (Array.isArray(list) ? list : []).filter((r) => Number(r?.positionAmt ?? 0) !== 0);
  const key = (row) => `${String(row.symbol).toUpperCase()}:${String(row.positionSide ?? '').toUpperCase()}`;
  const bySide = (list) => new Map(nonzero(list).map((r) => [key(r), Number(r.positionAmt)]));
  const v2Book = bySide(v2All), v3Book = bySide(v3All);
  console.log(`# unfiltered v2 rows=${Array.isArray(v2All) ? v2All.length : 'n/a'} nonzero=${v2Book.size}` +
    ` | v3 rows=${Array.isArray(v3All) ? v3All.length : 'n/a'} nonzero=${v3Book.size}`);
  console.log(`# v3 book=${[...v3Book.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`# v2 book=${[...v2Book.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);

  const perSymbol = [];
  for (const row of wanted) {
    const symbol = String(row.symbol).toUpperCase(), side = String(row.side).toUpperCase();
    const filtered = await adapter.signed('GET', '/fapi/v2/positionRisk', { symbol }, 'POSITION_FACT_COMPARE', 'PRIVATE_STATE');
    const filteredRows = Array.isArray(filtered) ? filtered : [];
    let proof = null, refusal = null;
    try { proof = await adapter.proveReduction({ symbol, positionSide: side, quantity: Math.abs(Number(row.quantity)) }); }
    catch (error) { refusal = String(error instanceof Error ? error.message : error); }
    perSymbol.push({ symbol, side, durableQuantity: Number(row.quantity), durableTpStatus: row.tpStatus,
      v2FilteredRows: filteredRows.length, v2FilteredNonZeroRows: nonzero(filteredRows).length,
      v2BookAmt: v2Book.get(`${symbol}:${side}`) ?? null, v3BookAmt: v3Book.get(`${symbol}:${side}`) ?? null,
      proveReduction: proof ? { kind: proof.kind, liveQuantity: proof.liveQuantity } : null, refusal });
  }
  console.log(JSON.stringify({ perSymbol, lastPositionRiskError: adapter.lastPositionRiskError ?? null,
    writeStats: adapter.writeBoundaryMetrics?.() ?? null }, null, 1));
  store.close();
} finally {
  rmSync(temp, { recursive: true, force: true });
}
process.exit(0);

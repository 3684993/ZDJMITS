// Read-only B probe: ask the deployed collector to price the current coverage universe again and report, per symbol,
// whether Binance Testnet actually returns bracket rows. The preview route persists nothing (`persisted:false`);
// limits/clusters/scenarios are sent back verbatim from the live approved profile, so no risk number is widened.
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
// Operator-owned limit fields only. `marginTierVersion`, `maintenanceMarginRatePct`, `correlationVersion` and
// `scenarioVersion` are server-derived, and the route refuses a request that tries to supply them.
const LIMIT_KEYS = ['maxCapitalAtRiskUsd', 'maxStressLossUsd', 'maxGrossNotionalUsd', 'maxDirectionNotionalUsd', 'maxClusterNotionalUsd',
  'maxHumanNotionalUsd', 'maxDrawdownPct', 'minMarginBufferPct', 'minLiquidationBufferPct', 'maxHumanPositions', 'maxPendingHandoffs', 'maxAckAgeMs',
  'snapshotTtlMs', 'cashFlowWindowMs', 'cashFlowMaxAgeMs'];

const pipeline = await (await fetch(`${base}/pipeline`)).json();
const profile = pipeline.portfolioRiskProfile ?? {};
const values = profile.values ?? {};
const authority = profile.authority ?? {};
const before = new Set((authority.coverageSymbols ?? []).map((s) => String(s).toUpperCase()));
const response = await fetch(`${base}/settings/portfolio-risk-authority/preview`, {
  method: 'POST', headers: {'content-type': 'application/json'},
  body: JSON.stringify({limits: Object.fromEntries(LIMIT_KEYS.filter((k) => values[k] !== undefined).map((k) => [k, values[k]])),
    correlation: {clusters: values.clusters ?? {}}, scenarios: values.scenarios ?? []}),
  signal: AbortSignal.timeout(300_000),
});
const text = await response.text();
if (!response.ok) throw new Error(`preview -> HTTP ${response.status}: ${text.slice(0, 400)}`);
const preview = JSON.parse(text);
const rows = preview.perSymbol ?? [];
const observed = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.symbol ?? '').toUpperCase()).filter(Boolean));
const closeout = await (await fetch(`${base}/diagnostics/closeout`)).json();
console.log(JSON.stringify({
  at: new Date().toISOString(), persisted: preview.persisted ?? null,
  requiredSymbols: (preview.requiredSymbols ?? []).length, returnedByExchange: observed.size,
  collectionFailures: preview.collectionFailures ?? null, compiledOk: preview.ok ?? null, compileBlockers: preview.blockers ?? null,
  questionSymbols: ['ZROUSDT', '1000BONKUSDC', 'WIFUSDT', 'ETHFIUSDT', 'ETCUSDT', 'JUPUSDT', 'SOLUSDT', 'TAOUSDT']
    .map((symbol) => ({symbol, inRequestedUniverse: (preview.requiredSymbols ?? []).includes(symbol),
      committedBefore: before.has(symbol), returnedByExchangeNow: observed.has(symbol)})),
  writes: closeout.productionWriteBoundary,
}, null, 1));

// §F: ask the exchange, through the deployed product path, what the position-risk contract really
// returns on Testnet. Read-only by construction: the preview route forces persisted:false, and the
// probe underneath is a signed GET. Write counters are sampled before and after to prove that.
const BASE = process.env.ZDJ_BASE ?? 'http://127.0.0.1:8080';
const LIMIT_KEYS = ['maxCapitalAtRiskUsd', 'maxStressLossUsd', 'maxGrossNotionalUsd', 'maxDirectionNotionalUsd', 'maxClusterNotionalUsd', 'maxHumanNotionalUsd', 'maxDrawdownPct', 'minMarginBufferPct', 'minLiquidationBufferPct', 'maxHumanPositions', 'maxPendingHandoffs', 'maxAckAgeMs'];

async function json(route, init) {
  const res = await fetch(BASE + route, { ...init, signal: AbortSignal.timeout(120000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const boundary = async label => {
  const { body } = await json('/api/v3/diagnostics/closeout');
  const wb = body?.productionWriteBoundary ?? body?.writeBoundary ?? {};
  console.log(`  [${label}] testnetWrites=${wb.testnetWrites} productionWrites=${wb.productionWrites} blockedProduction=${wb.blockedProductionWriteAttempts} lastWriteAt=${wb.lastWriteAt} lastWritePath=${JSON.stringify(wb.lastWritePath ?? null)}`);
  return wb;
};

const pipe = await json('/api/v3/pipeline');
const profile = pipe.body?.portfolioRiskProfile ?? {};
const values = profile.values ?? {};
const limits = Object.fromEntries(LIMIT_KEYS.map(key => [key, values[key]]));
console.log(`# live profile status=${profile.status} configured=${profile.configured} settingsVersion=${profile.settingsVersion}`);
console.log(`# limits reused verbatim from the approved profile (nothing here widens a cap): ${JSON.stringify(limits)}`);
const before = await boundary('before preview');

const call = await json('/api/v3/settings/portfolio-risk-authority/preview', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limits, correlation: { clusters: values.clusters ?? {} }, scenarios: Array.isArray(values.scenarios) ? values.scenarios : [] }),
});
const after = await boundary('after preview');
const p = call.body ?? {};
console.log(`\n## POST /api/v3/settings/portfolio-risk-authority/preview -> HTTP ${call.status} persisted=${p.persisted}`);
console.log(`  ok=${p.ok} requiredSymbols(${(p.requiredSymbols ?? []).length})=${(p.requiredSymbols ?? []).join(',')}`);
console.log(`  sizingBound=${JSON.stringify(p.sizingBound)} collectionFailures=${JSON.stringify(p.collectionFailures)}`);
console.log(`  blockers=${JSON.stringify(p.blockers)}`);
console.log(`  wouldCommit=${JSON.stringify(p.wouldCommit ? { marginTierVersion: p.wouldCommit.marginTierVersion, contentHash: p.wouldCommit.contentHash, derivedMaintenanceMarginRatePct: p.wouldCommit.derivedMaintenanceMarginRatePct, derivation: p.wouldCommit.derivation, coverageSymbols: p.wouldCommit.coverageSymbols } : null)}`);
console.log(`  perSymbol(${(p.perSymbol ?? []).length})=${JSON.stringify((p.perSymbol ?? []).map(row => ({ s: row.symbol, t: row.tierCount, c: row.consideredTiers?.length, hi: row.highestConsideredRatio })))}`);

const probe = p.positionRiskProbe ?? null;
console.log(`\n## positionRiskProbe (raw exchange payload via ${probe?.endpoint ?? 'ABSENT'})`);
if (!probe) console.log('  ABSENT — the deployed build exposes no probe');
else {
  console.log(`  environment=${probe.environment} endpoint=${probe.endpoint} observedAt=${probe.observedAt} rowCount=${probe.rowCount} readError=${JSON.stringify(probe.readError)}`);
  console.log(`  fieldNames(${(probe.fieldNames ?? []).length})=${(probe.fieldNames ?? []).join(',')}`);
  for (const row of probe.rows ?? []) console.log('  ' + JSON.stringify(row));
  const keys = new Set((probe.rows ?? []).flatMap(row => Object.keys(row)));
  for (const wanted of ['marginAsset', 'maintMargin', 'liquidationPrice', 'notional', 'positionAmt', 'markPrice', 'initialMargin']) {
    console.log(`  field present in payload: ${wanted} = ${keys.has(wanted)}`);
  }
}
console.log(`\n## write boundary closure: unchanged=${before.testnetWrites === after.testnetWrites && before.productionWrites === after.productionWrites && before.lastWriteAt === after.lastWriteAt}`);

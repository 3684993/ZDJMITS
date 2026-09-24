// Read-only live state capture used before and after the deploy. Every field is selected explicitly:
// a whole settings payload contains exchange credentials, so it is never dumped.
const BASE = process.env.ZDJ_BASE ?? 'http://127.0.0.1:8080';
const LABEL = process.argv[2] ?? 'live';
const pick = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
async function get(route) {
  try {
    const res = await fetch(BASE + route, { signal: AbortSignal.timeout(25000) });
    const body = res.status === 200 ? await res.json().catch(() => null) : await res.text().catch(() => null);
    return { status: res.status, body };
  } catch (error) { return { status: 'ERR', body: String(error).slice(0, 160) }; }
}
console.log(`# ${LABEL} read-only live capture (${new Date().toISOString()}) base=${BASE}`);
console.log('# endpoints: /api/v3/settings, /api/v3/pipeline, /api/v3/diagnostics/closeout, /health, /api/v3/positions, /api/v3/settings/portfolio-risk-authority');

const st = await get('/api/v3/settings');
const s = st.body ?? {};
console.log(`\n## settings HTTP ${st.status}`);
console.log('  ' + JSON.stringify({
  settingsVersion: s.settingsVersion,
  environment: pick(s, 'connections.exchange.environment'), credentialRef: pick(s, 'connections.exchange.credentialRef'),
  executionMode: pick(s, 'connections.exchange.executionMode'), maxPositions: pick(s, 'portfolio.maxPositions'),
  maxGrossExposurePct: pick(s, 'riskGovernance.maxGrossExposurePct'), maxDirectionExposurePct: pick(s, 'riskGovernance.maxDirectionExposurePct'),
  maxClusterExposurePct: pick(s, 'riskGovernance.maxClusterExposurePct'), maxClusterDirectionExposurePct: pick(s, 'riskGovernance.maxClusterDirectionExposurePct'),
  entrySafetyMode: pick(s, 'riskGovernance.entrySafetyMode'), aiExitAuthority: pick(s, 'riskGovernance.exitCoordination.aiExitAuthority'),
  profileConfigured: pick(s, 'riskGovernance.portfolioRisk.configured'), marginTierVersion: pick(s, 'riskGovernance.portfolioRisk.marginTierVersion'),
  maintenanceMarginRatePct: pick(s, 'riskGovernance.portfolioRisk.maintenanceMarginRatePct'),
}));

const pipe = await get('/api/v3/pipeline');
const p = pipe.body ?? {};
console.log(`\n## pipeline HTTP ${pipe.status}`);
console.log('  runtimeControl=' + JSON.stringify({ mode: pick(p, 'runtimeControl.mode'), reasonCode: pick(p, 'runtimeControl.reasonCode'), entrySafetyMode: pick(p, 'runtimeControl.entrySafetyMode'), autoExecutionMode: pick(p, 'entryPermission.autoExecutionMode') }));
console.log('  executionReadiness=' + JSON.stringify(p.executionReadiness ?? null));
console.log('  capacityVisibility=' + JSON.stringify(p.capacityVisibility ?? null));
const prof = p.portfolioRiskProfile ?? {};
console.log('  portfolioRiskProfile=' + JSON.stringify({ configured: prof.configured, status: prof.status, settingsVersion: prof.settingsVersion, version: prof.version, blockers: prof.blockers, missingFields: prof.missingFields,
  authority: prof.authority ? { committed: prof.authority.committed, authorityStatus: prof.authority.authorityStatus, profileStatus: prof.authority.profileStatus, marginTierVersion: prof.authority.marginTierVersion, contentHash: prof.authority.contentHash, derivedMaintenanceMarginRatePct: prof.authority.derivedMaintenanceMarginRatePct, rateDerivation: prof.authority.rateDerivation, coverageCount: (prof.authority.coverageSymbols ?? []).length, coverageSymbols: prof.authority.coverageSymbols, missingSymbols: prof.authority.missingSymbols, mismatchReasons: prof.authority.mismatchReasons, observedAt: prof.authority.observedAt, committedAt: prof.authority.committedAt } : null }));
console.log('  positions=' + JSON.stringify(p.existingPositions ?? null) + ' takeProfit=' + JSON.stringify(p.takeProfit ?? null));
console.log('  pendingEntries=' + JSON.stringify(p.pendingEntries ?? null));
console.log('  reconciliation=' + JSON.stringify({ status: pick(p, 'reconciliation.status'), driftCount: pick(p, 'reconciliation.driftCount'), unresolvedDriftCount: pick(p, 'reconciliation.unresolvedDriftCount'), historicalUnknownCount: pick(p, 'reconciliation.historicalUnknownCount'), activeRiskUnresolvedCount: pick(p, 'reconciliation.activeRiskUnresolvedCount'), verifiedNoActiveRiskUnknownCount: pick(p, 'reconciliation.verifiedNoActiveRiskUnknownCount') }));
console.log('  binancePrivate=' + JSON.stringify({ status: p.binancePrivate?.status, asOf: p.binancePrivate?.asOf, consecutiveFailures: p.binancePrivate?.consecutiveFailures, lastError: p.binancePrivate?.lastError, snapshotAgeMs: p.binancePrivate?.snapshotAgeMs }));
console.log('  entryPermission=' + JSON.stringify(p.entryPermission ?? null) + ' noEntryReason=' + JSON.stringify(p.noEntryReason ?? null));
console.log('  analysis=' + JSON.stringify({ mode: pick(p, 'analysis.mode'), reason: pick(p, 'analysis.reason'), lastBlockedReason: pick(p, 'analysis.lastBlockedReason'), capitalExecutableCount: pick(p, 'analysis.capitalExecutableCount'), lastTickAt: pick(p, 'analysis.lastTickAt'), lastSuccessAt: pick(p, 'analysis.lastSuccessAt') }));
console.log('  primaryBrain=' + JSON.stringify({ status: p.primaryBrain?.status, runs: p.primaryBrain?.runs, historicalRuns: p.primaryBrain?.historicalRuns, idleReason: p.primaryBrain?.idleReason, lastDecision: p.primaryBrain?.resource?.lastDecision, lastCompletedAt: p.primaryBrain?.resource?.lastCompletedAt, queueDepth: p.primaryBrain?.resource?.queueDepth }));
const budget = Object.entries(p.restBudget ?? {}).map(([scope, row]) => [scope, { usedWeight1m: row.usedWeight1m, status: row.status, http418: row.http418, http429: row.http429, blocked: row.decisions?.blocked, queueTimeout: row.decisions?.queueTimeout,
  positionRiskEndpoints: (row.attribution ?? []).filter(a => /positionRisk|leverageBracket/.test(a.endpoint)).map(a => `${a.source} ${a.endpoint}:${a.requests}`) }]);
console.log('  budgetTotals=' + JSON.stringify(budget));

const close = await get('/api/v3/diagnostics/closeout');
const c = close.body ?? {};
console.log(`\n## closeout HTTP ${close.status}`);
console.log('  writeBoundary=' + JSON.stringify(pick(c, 'productionWriteBoundary') ?? pick(c, 'writeBoundary') ?? null));
console.log('  runtime=' + JSON.stringify({ pid: pick(c, 'runtime.pid'), instanceId: pick(c, 'runtime.instanceId'), buildId: pick(c, 'runtime.buildId'), restartCount: pick(c, 'runtime.restartCount'), uptimeMs: pick(c, 'runtime.uptimeMs'), lastRestartReason: pick(c, 'runtime.lastRestartReason') }));
console.log('  persistence=' + JSON.stringify({ integrity: pick(c, 'persistence.integrity'), status: pick(c, 'persistence.status'), error: pick(c, 'persistence.error') }));

const health = await get('/health');
const h = health.body ?? {};
console.log(`\n## /health HTTP ${health.status}`);
console.log('  ' + JSON.stringify({ status: h.status, ready: h.ready, integrity: h.integrity, fatal: h.fatal ?? null, runtime: h.runtime ?? null }).slice(0, 700));

const pos = await get('/api/v3/positions');
const rows = Array.isArray(pos.body) ? pos.body : (pos.body?.positions ?? pos.body?.data ?? []);
console.log(`\n## positions HTTP ${pos.status} count=${Array.isArray(rows) ? rows.length : 'n/a'}`);
if (Array.isArray(rows)) {
  console.log('  keys of row0 = ' + Object.keys(rows[0] ?? {}).join(','));
  let asset = 0, maint = 0, zero = 0, positive = 0, missing = 0, v3 = 0;
  for (const row of rows) {
    if (row.marginAsset) asset++;
    if (row.maintenanceMarginUsd != null) maint++;
    if (row.liquidationPrice === 0) zero++; else if (row.liquidationPrice != null) positive++; else missing++;
    if (row.positionRiskSource === 'V3_VERIFIED') v3++;
    console.log(`  ${row.symbol} | ${row.side} | marginAsset=${JSON.stringify(row.marginAsset ?? null)} | maint=${JSON.stringify(row.maintenanceMarginUsd ?? null)} | liq=${JSON.stringify(row.liquidationPrice ?? null)} | mark=${row.markPrice} | notional=${JSON.stringify(row.notionalUsd ?? null)} | src=${JSON.stringify(row.positionRiskSource ?? null)} | tp=${row.tpStatus} | cycle=${row.cycleId}`);
  }
  console.log(`  totals: positions=${rows.length} marginAssetProven=${asset} maintMarginProven=${maint} liqReportedZero=${zero} liqPositive=${positive} liqMissing=${missing} v3Tagged=${v3}`);
}
const authority = await get('/api/v3/settings/portfolio-risk-authority');
console.log(`\n## authority GET HTTP ${authority.status}`);
console.log('  ' + JSON.stringify(authority.body).slice(0, 900));

// §G — one explicit PortfolioRisk authority re-commit, only because the required sized universe grew.
// Nothing here widens a risk number: limits, scenarios and clusters are read back from the live
// approved profile and sent verbatim, and the maintenance rate stays server-derived from the real
// bracket rows. Settings writes go through the dedicated CAS channel, so a concurrent change loses.
const BASE = process.env.ZDJ_BASE ?? 'http://127.0.0.1:8080';
const LIMIT_KEYS = ['maxCapitalAtRiskUsd', 'maxStressLossUsd', 'maxGrossNotionalUsd', 'maxDirectionNotionalUsd', 'maxClusterNotionalUsd', 'maxHumanNotionalUsd', 'maxDrawdownPct', 'minMarginBufferPct', 'minLiquidationBufferPct', 'maxHumanPositions', 'maxPendingHandoffs', 'maxAckAgeMs'];
const APPLY = process.argv.includes('--apply');

async function call(route, init) {
  const res = await fetch(BASE + route, { ...init, signal: AbortSignal.timeout(180000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const boundary = async () => {
  const { body } = await call('/api/v3/diagnostics/closeout');
  const wb = body?.productionWriteBoundary ?? {};
  return `testnetWrites=${wb.testnetWrites} productionWrites=${wb.productionWrites} blockedProduction=${wb.blockedProductionWriteAttempts} lastWriteAt=${wb.lastWriteAt}`;
};

const pipe = await call('/api/v3/pipeline');
const profile = pipe.body?.portfolioRiskProfile ?? {};
const values = profile.values ?? {};
const authority = profile.authority ?? {};
const limits = Object.fromEntries(LIMIT_KEYS.map(key => [key, values[key]]));
const settingsVersion = profile.settingsVersion;
console.log(`# live profile=${profile.status} settingsVersion=${settingsVersion} committedCoverage=${(authority.coverageSymbols ?? []).length} committedHash=${String(authority.contentHash ?? '').slice(0, 12)} rate=${authority.derivedMaintenanceMarginRatePct} derivation=${authority.rateDerivation}`);
console.log(`# protected numbers are re-sent verbatim (no cap is touched): ${JSON.stringify(limits)}`);
console.log(`# scenarios/clusters re-sent verbatim: count=${Array.isArray(values.scenarios) ? values.scenarios.length : 'n/a'}/${JSON.stringify(Object.keys(values.clusters ?? {})).slice(0, 80)}`);

const before = await boundary();
const preview = await call('/api/v3/settings/portfolio-risk-authority/preview', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limits, correlation: { clusters: values.clusters ?? {} }, scenarios: values.scenarios ?? [] }),
});
const p = preview.body ?? {};
const committed = new Set(authority.coverageSymbols ?? []);
const added = (p.requiredSymbols ?? []).filter(symbol => !committed.has(symbol));
console.log(`\n## preview HTTP ${preview.status} ok=${p.ok} persisted=${p.persisted} required=${(p.requiredSymbols ?? []).length} collectionFailures=${JSON.stringify(p.collectionFailures)} blockers=${JSON.stringify(p.blockers)}`);
console.log(`   symbols outside committed coverage (${added.length}): ${added.join(',')}`);
console.log(`   wouldCommit: hash=${String(p.wouldCommit?.contentHash ?? '').slice(0, 12)} rate=${p.wouldCommit?.derivedMaintenanceMarginRatePct} derivation=${p.wouldCommit?.derivation} coverage=${(p.wouldCommit?.coverageSymbols ?? []).length}`);
if (!APPLY) { console.log('\n# dry run: pass --apply to make the single explicit commit.'); process.exit(0); }
if (!p.ok) { console.log('\n# preview not ok; refusing to commit'); process.exit(1); }

const commit = await call('/api/v3/settings/portfolio-risk-authority', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limits, correlation: { clusters: values.clusters ?? {} }, scenarios: values.scenarios ?? [], acks: ['PORTFOLIO_RISK_PROFILE_ENABLED'], expectedSettingsVersion: settingsVersion, operator: 'v396-final-coverage-refresh' }),
});
console.log(`\n## POST .../portfolio-risk-authority -> HTTP ${commit.status}`);
const c = commit.body ?? {};
console.log('   ' + JSON.stringify({ settingsVersion: c.settingsVersion, profileStatus: c.profileStatus, authorityStatus: c.authority?.authorityStatus, marginTierVersion: c.authority?.marginTierVersion, rate: c.authority?.derivedMaintenanceMarginRatePct, derivation: c.authority?.rateDerivation, coverage: (c.authority?.coverageSymbols ?? []).length, missingSymbols: c.authority?.missingSymbols, mismatchReasons: c.authority?.mismatchReasons, error: c.error ?? null, refusals: c.refusals ?? null, blockers: c.blockers ?? null }).slice(0, 1200));

const after = await call('/api/v3/settings/portfolio-risk-authority');
const a = after.body?.authority ?? {};
console.log(`\n## authority GET HTTP ${after.status} settingsVersion=${after.body?.settingsVersion}`);
console.log('   ' + JSON.stringify({ authorityStatus: a.authorityStatus, profileStatus: after.body?.profileStatus, marginTierVersion: a.marginTierVersion, rate: a.derivedMaintenanceMarginRatePct, derivation: a.rateDerivation, coverage: (a.coverageSymbols ?? []).length, coverageSymbols: a.coverageSymbols, missingSymbols: a.missingSymbols, mismatchReasons: a.mismatchReasons, committedAt: a.committedAt, blockers: after.body?.profileBlockers }).slice(0, 1400));

const verify = await call('/api/v3/pipeline');
const v = verify.body?.portfolioRiskProfile ?? {};
const settings = await call('/api/v3/settings');
const s = settings.body ?? {};
console.log(`\n## post-commit readback profile=${v.status} authority=${v.authority?.authorityStatus} coverage=${(v.authority?.coverageSymbols ?? []).length} missing=${JSON.stringify(v.authority?.missingSymbols)} rate=${v.authority?.derivedMaintenanceMarginRatePct}`);
console.log(`## readiness after commit ${JSON.stringify(verify.body?.executionReadiness ?? null)}`);
console.log(`## protected facts unchanged: settingsVersion ${settingsVersion} -> ${s.settingsVersion} (must be exactly +1) executionMode=${s?.connections?.exchange?.executionMode} environment=${s?.connections?.exchange?.environment} entrySafetyMode=${s?.riskGovernance?.entrySafetyMode} aiExitAuthority=${s?.riskGovernance?.exitCoordination?.aiExitAuthority} caps=${s?.riskGovernance?.maxGrossExposurePct}/${s?.riskGovernance?.maxDirectionExposurePct}/${s?.riskGovernance?.maxClusterExposurePct}/${s?.riskGovernance?.maxClusterDirectionExposurePct} maxPositions=${s?.portfolio?.maxPositions}`);
console.log(`## write boundary before=[${before}] after=[${await boundary()}]`);

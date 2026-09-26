// V3.9.6 governance closeout: re-preview the margin-tier authority from real Testnet brackets over the current routable
// universe, and — only if every precondition holds — commit it through the existing CAS channel with the operator's
// limits, clusters, scenarios and thresholds sent back verbatim. Default is read-only (preview only); pass `apply` to commit.
// No risk number is widened: a value that differs from the live profile aborts before any request is made.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APPLY = process.argv.includes('apply');
const root = path.resolve(process.argv[2] ?? '.');
const base = process.env.ZDJ_BASE ?? 'http://127.0.0.1:8080/api/v3';

const { V396_GOVERNANCE_FIELDS, PORTFOLIO_RISK } = await import(pathToFileURL(path.join(root, 'apps/engine/dist/config/governanceSettingsMatrix.js')).href);
const editableKeys = new Set(V396_GOVERNANCE_FIELDS
  .filter((field) => field.path.startsWith(`${PORTFOLIO_RISK}.`) && field.editable)
  .map((field) => field.path.slice(`${PORTFOLIO_RISK}.`.length)));
const SERVER_DERIVED = ['marginTierVersion', 'maintenanceMarginRatePct', 'correlationVersion', 'scenarioVersion'];

const call = async (route, init) => {
  const response = await fetch(`${base}${route}`, { ...init, signal: AbortSignal.timeout(300_000) });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};
const fail = (code, detail) => { console.log(JSON.stringify({ committed: false, aborted: code, detail: detail ?? null }, null, 1)); process.exit(1); };

const beforeSettingsResponse = await call('/settings');
const beforeSettings = beforeSettingsResponse.body?.settings ?? beforeSettingsResponse.body ?? {};
const before = await call('/pipeline');
if (before.status !== 200) fail('PIPELINE_READ_FAILED', before.status);
const pipelineBefore = before.body?.pipeline ?? before.body ?? {};
const profile = pipelineBefore.portfolioRiskProfile ?? {};
const values = profile.values ?? {};
const beforeAuthority = profile.authority ?? {};
const beforeUncovered = (beforeAuthority.coverageLag?.uncoveredCandidates ?? beforeAuthority.uncoveredCoverageCandidates ?? []).slice().sort();

// Limits are copied back exactly as the live approved profile states them. Anything the governance matrix
// does not expose as an editable field stays untouched, and the server-derived identities are never sent.
const limits = Object.fromEntries(Object.entries(values)
  .filter(([key, value]) => editableKeys.has(key) && !SERVER_DERIVED.includes(key) && value !== undefined)
  .map(([key, value]) => [key, structuredClone(value)]));
const clusters = structuredClone(values.clusters ?? {});
const scenarios = structuredClone(values.scenarios ?? []);
const boundary = async () => (await call('/diagnostics/closeout')).body?.productionWriteBoundary ?? null;
const writesBefore = await call('/diagnostics/closeout');

const preview = await call('/settings/portfolio-risk-authority/preview', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limits, correlation: { clusters }, scenarios }),
});
if (preview.status !== 400 && preview.status !== 423 && !preview.ok && preview.status !== 200) fail('PREVIEW_REQUEST_FAILED', preview.body);
if (preview.status !== 200) fail('PREVIEW_REFUSED', { code: preview.body?.error?.code, refusals: preview.body?.refusals, blockers: preview.body?.error?.blockers, explanation: preview.body?.explanation });
const p = preview.body;
const priced = new Map((p.perSymbol ?? []).map((row) => [String(row.symbol).toUpperCase(), row]));
const required = (p.requiredSymbols ?? []).map((symbol) => String(symbol).toUpperCase());
const missingFacts = beforeUncovered.filter((symbol) => !priced.has(String(symbol).toUpperCase()));
const emptyBrackets = beforeUncovered.filter((symbol) => !(priced.get(String(symbol).toUpperCase())?.tierCount >= 1));
const noRatio = beforeUncovered.filter((symbol) => {
  const row = priced.get(String(symbol).toUpperCase());
  return !(Number(row?.highestAnyTierRatio) > 0);
});

// Every precondition is checked before a single byte is written.
const gates = {
  persistedFalse: p.persisted === false,
  collectionFailuresZero: Array.isArray(p.collectionFailures) && p.collectionFailures.length === 0,
  compiledOk: p.ok === true,
  compileBlockersEmpty: Array.isArray(p.blockers) && p.blockers.length === 0,
  previewIsTestnet: String(p.environment).toUpperCase() === 'TESTNET',
  universeWithinCeiling: required.length > 0 && required.length <= 96,
  uncoveredAllRequested: beforeUncovered.every((symbol) => required.includes(String(symbol).toUpperCase())),
  uncoveredAllHaveExchangeFacts: missingFacts.length === 0,
  uncoveredAllHaveTierRows: emptyBrackets.length === 0,
  uncoveredAllHaveMaintenanceRatio: noRatio.length === 0,
  clustersUnchanged: JSON.stringify(clusters) === JSON.stringify(values.clusters ?? {}),
  scenariosUnchanged: JSON.stringify(scenarios) === JSON.stringify(values.scenarios ?? []),
  limitsUnchanged: Object.entries(limits).every(([key, value]) => JSON.stringify(value) === JSON.stringify(values[key])),
  serverDerivedFieldsNotSent: !Object.keys(limits).some((key) => SERVER_DERIVED.includes(key)),
};
const failed = Object.entries(gates).filter(([, ok]) => !ok).map(([name]) => name);
const summary = {
  mode: APPLY ? 'preview+commit' : 'preview-only',
  at: new Date().toISOString(),
  before: { settingsVersion: profile.settingsVersion, profileStatus: profile.status, authorityStatus: beforeAuthority.authorityStatus,
    marginTierVersion: beforeAuthority.marginTierVersion, contentHash: beforeAuthority.contentHash,
    coverageCount: (beforeAuthority.coverageSymbols ?? []).length, uncoveredCandidates: beforeUncovered,
    coverageLagCount: (beforeAuthority.coverageLag?.uncoveredCandidates ?? []).length },
  preview: { requiredSymbols: required.length, pricedSymbols: priced.size, collectionFailures: p.collectionFailures ?? null,
    compiledOk: p.ok ?? null, blockers: p.blockers ?? null, sizingBound: p.sizingBound ?? null,
    derivedMaintenanceMarginRatePct: p.derivedMaintenanceMarginRatePct ?? p.margin?.maintenanceMarginRatePct ?? null,
    contentHash: p.contentHash ?? p.margin?.contentHash ?? null },
  uncoveredSymbolFacts: beforeUncovered.map((symbol) => {
    const row = priced.get(String(symbol).toUpperCase());
    return { symbol, inRequiredUniverse: required.includes(String(symbol).toUpperCase()), tierCount: row?.tierCount ?? 0,
      consideredTiers: (row?.consideredTiers ?? []).length, highestAnyTierRatio: row?.highestAnyTierRatio ?? null,
      initialLeverageLowestTier: row?.consideredTiers?.[0]?.initialLeverage ?? null };
  }),
  gates, failedGates: failed, writesBefore: writesBefore.body?.productionWriteBoundary ?? null,
};
if (failed.length) { console.log(JSON.stringify({ ...summary, committed: false }, null, 1)); process.exit(1); }
if (!APPLY) { console.log(JSON.stringify({ ...summary, committed: false, reason: 'PREVIEW_OK_DRY_RUN' }, null, 1)); process.exit(0); }

const commit = await call('/settings/portfolio-risk-authority', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limits, correlation: { clusters }, scenarios, acks: [], operator: 'codex-v396-governance-closeout',
    expectedSettingsVersion: profile.settingsVersion }),
});
if (commit.status !== 200) {
  console.log(JSON.stringify({ ...summary, committed: false, commitStatus: commit.status, commitError: commit.body }, null, 1));
  process.exit(1);
}
const after = await call('/pipeline');
const afterProfile = (after.body?.pipeline ?? after.body ?? {}).portfolioRiskProfile ?? {};
const afterAuthority = afterProfile.authority ?? {};
const afterUncovered = (afterAuthority.coverageLag?.uncoveredCandidates ?? []).slice().sort();
const writesAfter = await call('/diagnostics/closeout');
// The only settings leaves this commit may touch are `settingsVersion` and the server-derived dataset
// identities under riskGovernance.portfolioRisk. Every economic threshold, governance mode and limit must
// read back byte-identical, which is what makes this a coverage refresh rather than a policy change.
const afterSettingsResponse = await call('/settings');
const afterSettings = afterSettingsResponse.body?.settings ?? afterSettingsResponse.body ?? {};
const leaves = (value, path = '', out = new Map()) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) leaves(child, path ? `${path}.${key}` : key, out);
  } else out.set(path, JSON.stringify(value));
  return out;
};
const settingChanges = (() => {
  const a = leaves(beforeSettings), b = leaves(afterSettings), changed = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue;
    changed.push({ key, before: a.get(key) ?? null, after: b.get(key) ?? null });
  }
  return changed;
})();
const allowedChange = (key) => key === 'settingsVersion' || key.startsWith('riskGovernance.portfolioRisk.');
const positions = await call('/positions');
const rows = Array.isArray(positions.body) ? positions.body : (positions.body.positions ?? []);
const unknowns = (await call('/diagnostics/closeout')).body?.pipeline?.reconciliation ?? null;
console.log(JSON.stringify({
  ...summary,
  committed: true,
  commit: { status: commit.status, newSettingsVersion: commit.body?.settingsVersion, marginTierVersion: commit.body?.authority?.marginTierVersion,
    contentHash: commit.body?.authority?.contentHash, profileStatus: commit.body?.profileStatus ?? commit.body?.authority?.profileStatus },
  after: { settingsVersion: afterProfile.settingsVersion, profileStatus: afterProfile.status, authorityStatus: afterAuthority.authorityStatus,
    marginTierVersion: afterAuthority.marginTierVersion, contentHash: afterAuthority.contentHash,
    coverageCount: (afterAuthority.coverageSymbols ?? []).length, uncoveredCandidates: afterUncovered,
    missingSymbols: afterAuthority.missingSymbols ?? null, mismatchReasons: afterAuthority.mismatchReasons ?? null },
  coverageDelta: { added: (afterAuthority.coverageSymbols ?? []).filter((s) => !(beforeAuthority.coverageSymbols ?? []).includes(s)).sort(),
    removed: (beforeAuthority.coverageSymbols ?? []).filter((s) => !(afterAuthority.coverageSymbols ?? []).includes(s)).sort(),
    stillUncovered: afterUncovered },
  invariants: { settingsVersionAdvancedOnce: Number(afterProfile.settingsVersion) === Number(profile.settingsVersion) + 1,
    settingsChangesOutsideAuthority: settingChanges.filter((row) => !allowedChange(row.key)),
    settingsChangedLeaves: settingChanges.map((row) => row.key),
    limitsUnchangedAfterCommit: Object.entries(limits).every(([key, value]) => JSON.stringify(afterProfile.values?.[key]) === JSON.stringify(value)),
    productionWrites: (writesAfter.body.productionWriteBoundary ?? {}).productionWrites,
    blockedProductionWrites: (writesAfter.body.productionWriteBoundary ?? {}).blockedProductionWriteAttempts,
    testnetWrites: (writesAfter.body.productionWriteBoundary ?? {}).testnetWrites,
    positions: rows.length, tpProtected: rows.filter((r) => r.tpStatus === 'PROTECTED').length,
    tpNotProtected: rows.filter((r) => r.tpStatus !== 'PROTECTED').map((r) => `${r.symbol}:${r.side}:${r.tpStatus}`),
    reconciliation: unknowns ? { historicalUnknown: unknowns.historicalUnknownCount, verifiedNoActiveRisk: unknowns.verifiedNoActiveRiskUnknownCount,
      activeRiskUnresolved: unknowns.activeRiskUnresolvedCount } : null },
  writesAfter: writesAfter.body.productionWriteBoundary,
}, null, 1));
process.exit(0);

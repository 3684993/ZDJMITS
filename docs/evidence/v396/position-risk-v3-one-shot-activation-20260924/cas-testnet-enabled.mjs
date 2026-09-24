// §H — one CAS: connections.executionMode READ_ONLY -> TESTNET_ENABLED, and nothing else.
//
// Default is a precondition check only. --apply sends the PUT, and the body is the live settings
// document with exactly one leaf changed; the script diffs what it sends against what it read and
// refuses to send anything else. Private/egress/profile/authority/integrity/TP facts must be real and
// healthy first — a stale private read is waited out, not argued around.
const BASE = process.env.ZDJ_BASE ?? 'http://127.0.0.1:8080';
const APPLY = process.argv.includes('--apply');

async function call(route, init) {
  const res = await fetch(BASE + route, { ...init, signal: AbortSignal.timeout(60000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const leaf = (path, value) => `${path}=${JSON.stringify(value)}`;
function flatten(value, prefix = '', out = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) flatten(child, `${prefix}${key}.`, out);
  else out.push({ path: prefix.replace(/\.$/, ''), value });
  return out;
}
const diff = (before, after) => {
  const left = new Map(flatten(before).map(row => [row.path, JSON.stringify(row.value)]));
  const right = new Map(flatten(after).map(row => [row.path, JSON.stringify(row.value)]));
  const changed = [];
  for (const [path, json] of right) if (left.has(path) && left.get(path) !== json) changed.push(`${path}: ${left.get(path)} -> ${json}`);
  for (const path of right.keys()) if (!left.has(path)) changed.push(`${path}: (absent) -> ${right.get(path)}`);
  for (const path of left.keys()) if (!right.has(path)) changed.push(`${path}: ${left.get(path)} -> (removed)`);
  return changed;
};

let checks = null;
for (let attempt = 1; attempt <= 4; attempt++) {
  const pipe = await call('/api/v3/pipeline');
  const close = await call('/api/v3/diagnostics/closeout');
  const p = pipe.body ?? {}, c = close.body ?? {};
  const readiness = p.executionReadiness ?? {};
  const facts = {
    environment: (c.productionWriteBoundary ?? {}).environment,
    lockedToTestnet: (c.productionWriteBoundary ?? {}).lockedToTestnet,
    executionMode: (c.productionWriteBoundary ?? {}).executionMode,
    testnetWrites: (c.productionWriteBoundary ?? {}).testnetWrites,
    productionWrites: (c.productionWriteBoundary ?? {}).productionWrites,
    integrity: (c.persistence ?? {}).integrity,
    persistenceStatus: (c.persistence ?? {}).status,
    privateStatus: p.binancePrivate?.status ?? null,
    privateAgeMs: Date.now() - Number(p.binancePrivate?.asOf ?? 0),
    privateConsecutiveFailures: p.binancePrivate?.consecutiveFailures ?? null,
    readinessBlockers: readiness.blockers ?? null,
    firstBlocker: readiness.firstBlocker ?? null,
    profileStatus: readiness.profileStatus ?? null,
    authorityStatus: p.portfolioRiskProfile?.authority?.authorityStatus ?? null,
    coverage: (p.portfolioRiskProfile?.authority?.coverageSymbols ?? []).length,
    missingSymbols: p.portfolioRiskProfile?.authority?.missingSymbols ?? null,
    rate: p.portfolioRiskProfile?.authority?.derivedMaintenanceMarginRatePct ?? null,
    runtimeMode: p.runtimeControl?.mode ?? null,
    entrySafetyMode: p.runtimeControl?.entrySafetyMode ?? null,
    autoExecutionMode: p.entryPermission?.autoExecutionMode ?? null,
    positions: p.existingPositions?.count ?? null,
    tp: { required: p.takeProfit?.required, protected: p.takeProfit?.protected, missing: p.takeProfit?.missing, unverified: p.takeProfit?.unverifiedTp, orphan: p.takeProfit?.orphanTp },
    executableCandidates: readiness.executableCandidateCount ?? null,
    settingsVersion: p.portfolioRiskProfile?.settingsVersion ?? null,
  };
  // The only blockers tolerated at CAS time are the write lock itself (what we are removing) and
  // supply facts about candidates, which say nothing about safety.
  const safetyBlockers = (facts.readinessBlockers ?? []).filter(reason => reason !== 'EXECUTION_WRITE_LOCKED' && reason !== 'NO_EXECUTABLE_CANDIDATE' && reason !== 'MARGIN_TIER_NO_COVERED_CANDIDATE');
  const healthy = facts.environment === 'TESTNET' && facts.lockedToTestnet === true && facts.integrity === true
    && facts.privateStatus === 'READY' && facts.privateAgeMs < 60_000 && facts.profileStatus === 'READY'
    && facts.authorityStatus === 'MATCHED' && (facts.missingSymbols ?? []).length === 0 && safetyBlockers.length === 0;
  console.log(`## precondition attempt ${attempt}: ${JSON.stringify(facts)}`);
  console.log(`   safetyBlockers=${JSON.stringify(safetyBlockers)} healthy=${healthy}`);
  checks = { facts, healthy };
  if (healthy) break;
  await new Promise(resolve => setTimeout(resolve, 12_000));
}
if (!checks.healthy) { console.log('\n# preconditions are not all real and healthy; refusing to switch. No write performed.'); process.exit(1); }
if (!APPLY) { console.log('\n# check-only run (pass --apply for the single CAS)'); process.exit(0); }

const before = await call('/api/v3/settings');
const source = before.body ?? {};
const sent = { ...source, connections: { ...source.connections, executionMode: 'TESTNET_ENABLED' } };
const changedBeforeSend = diff(source, sent);
console.log(`\n## PUT /api/v3/settings — self-diff of what is being sent (${changedBeforeSend.length} path(s)): ${JSON.stringify(changedBeforeSend)}`);
if (changedBeforeSend.length !== 1) { console.log('# more than one leaf would change; refusing'); process.exit(1); }
const written = await call('/api/v3/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sent) });
const after = written.body ?? {};
console.log(`## PUT -> HTTP ${written.status} settingsVersion ${source.settingsVersion} -> ${after.settingsVersion}`);
const applied = diff(source, after);
console.log(`## changed paths in the saved document (${applied.length}): ${JSON.stringify(applied.slice(0, 8))}`);

const verify = await call('/api/v3/pipeline');
const v = verify.body ?? {};
const close = await call('/api/v3/diagnostics/closeout');
const wb = (close.body ?? {}).productionWriteBoundary ?? {};
const gov = await call('/api/v3/settings/governance');
console.log('\n## post-CAS readback');
console.log(`   execution=${wb.executionMode} lockedToTestnet=${wb.lockedToTestnet} testnetWrites=${wb.testnetWrites} productionWrites=${wb.productionWrites} blockedProduction=${wb.blockedProductionWriteAttempts} lastWriteAt=${wb.lastWriteAt} lastWritePath=${JSON.stringify(wb.lastWritePath ?? null)}`);
console.log(`   runtimeControl=${JSON.stringify({ mode: v.runtimeControl?.mode, reasonCode: v.runtimeControl?.reasonCode, entrySafetyMode: v.runtimeControl?.entrySafetyMode })} entryPermission=${JSON.stringify(v.entryPermission ?? null)}`);
console.log(`   executionReadiness=${JSON.stringify(v.executionReadiness ?? null)}`);
console.log(`   analysis=${JSON.stringify({ mode: v.analysis?.mode, reason: v.analysis?.reason, lastBlockedReason: v.analysis?.lastBlockedReason, capitalExecutableCount: v.analysis?.capitalExecutableCount })}`);
console.log(`   profile=${v.portfolioRiskProfile?.status} authority=${v.portfolioRiskProfile?.authority?.authorityStatus} coverage=${(v.portfolioRiskProfile?.authority?.coverageSymbols ?? []).length} rate=${v.portfolioRiskProfile?.authority?.derivedMaintenanceMarginRatePct}`);
console.log(`   aiExitAuthority=${(gov.body?.fields ?? []).filter?.(row => /aiExitAuthority/.test(String(row?.path))).map(row => JSON.stringify(row.value)).join(',') ?? 'n/a'}`);
console.log(`   takeProfit=${JSON.stringify(v.takeProfit ?? null)} positions=${JSON.stringify(v.existingPositions ?? null)} reconciliation=${JSON.stringify({ status: v.reconciliation?.status, drift: v.reconciliation?.driftCount, unresolved: v.reconciliation?.unresolvedDriftCount })}`);

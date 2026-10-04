// S00 verification entrypoint. Reads source and evidence, writes one copy below the OS
// temp directory, and fails closed on any assertion. It never starts, stops or reloads
// the Engine, never opens a live database or Settings store, never issues a network or
// exchange request, and never modifies tracked files.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_STATIC_PATHS, BOUNDARY, FORBIDDEN_INDICATORS, INDICATORS, SELECTION,
  VERIFIER_IMPORT_ALLOWLIST, buildEntrypointReview, deriveIndicators, isLifecycleNamed,
} from './v396-s00-isolation-rules.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(`S00_CHECK_FAILED: ${message}`); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Working-tree bytes are not stable across checkouts: git text normalisation left the
// same committed markdown with different bytes in two worktrees. Identity hashes are
// therefore taken over LF-normalised text, and the rule is declared in the manifest.
const sha256Identity = text => sha256(text.replaceAll('\r\n', '\n'));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item => {
  const path = join(dir, item.name);
  return item.isDirectory() ? walk(path) : [path];
});
const evidenceRoot = 'docs/evidence/v396/S00/20260921T145000Z';
const argument = prefix => process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
const evidenceFiles = walk(join(root, evidenceRoot));
const rel = path => path.slice(root.length + 1).replaceAll('\\', '/');

const packageJson = JSON.parse(read('package.json'));
const settings = JSON.parse(read('config/settings.default.json'));
const fixturePath = `${evidenceRoot}/fixtures/s00-fixtures.json`;
const fixtureRaw = read(fixturePath);
const fixture = JSON.parse(fixtureRaw);
const baseline = JSON.parse(read(`${evidenceRoot}/baseline-manifest.json`));
const entryIndex = JSON.parse(read(`${evidenceRoot}/entrypoint-index.json`));
const entryReviewPath = argument('--review=') ?? `${evidenceRoot}/entrypoint-review.json`;
const entryReview = JSON.parse(read(entryReviewPath));
const entry = read('apps/engine/src/services/entryCoordinator.ts');
const manual = read('apps/engine/src/services/manualPositionService.ts');
const tp = read('apps/engine/src/services/tpGuardian.ts');
const main = read('apps/engine/src/main.ts');
const launcher = read('scripts/start-zdj-lan.ps1');
const dev = read('scripts/dev.mjs');

// S00-T01: this command is the only S00 verification command. Other repo commands are
// classified NOT_RUN rather than treated as isolated.
assert(packageJson.scripts.verify && packageJson.scripts['verify:isolated'], 'root verification scripts are missing');
assert(dev.includes("npm",) && dev.includes("@zdj/engine"), 'dev entrypoint was not inspected');
assert(main.includes('ZDJ_DATA_DIR') && main.includes('ZDJ_CONFIG_DIR') && main.includes('ZDJ_PORT'), 'runtime isolation knobs are not explicit');
assert(launcher.includes("StartReason -ne 'MANUAL_START'") && launcher.includes('Reuse an existing engine'), 'manual lifecycle guard is not explicit');
assert(entry.includes('ENTRY_SUBMIT_ATTEMPTED') && entry.includes('placeEntry') && entry.includes('TESTNET_ENABLED'), 'entry write boundary was not asserted');
assert(manual.includes('MANUAL_SUBMISSION_PREPARED') && manual.includes('submitOrder') && manual.includes('TRADING_BLOCKED'), 'manual write boundary was not asserted');
assert(tp.includes('TP_SUBMISSION_PREPARED') && tp.includes('placeTakeProfit'), 'TP write boundary was not asserted');
assert(settings.connections.exchange.environment === 'TESTNET' && settings.connections.executionMode === 'READ_ONLY', 'default settings are not read-only testnet');
assert(settings.riskGovernance.protectionMode === 'SHADOW' && settings.tradeEconomics.admissionMode === 'SHADOW', 'new default gates are not SHADOW');
assert(entryIndex.s00Verification.command === 'node scripts/v396-s00-static-check.mjs', 'S00 command is not explicitly pinned');
assert(entryIndex.s00Verification.classification === 'STATIC_READS_AND_OS_TEMP_ONLY', 'S00 command isolation classification is missing');
assert(entryIndex.notRunCommands.includes('npm run verify') && entryIndex.notRunCommands.includes('npm run verify:isolated'), 'unsafe aggregate commands are not explicitly NOT_RUN');

// S00-T01: the verifier proves its own capability boundary instead of trusting a label.
const selfSource = read('scripts/v396-s00-static-check.mjs');
const rulesSource = read('scripts/v396-s00-isolation-rules.mjs');
// The pattern is assembled at runtime so this line cannot match itself.
const specifierPattern = new RegExp("fro" + "m '([^']+)'", 'g');
const importsOf = source => [...source.matchAll(specifierPattern)].map(match => match[1]);
for (const specifier of importsOf(selfSource)) {
  assert(VERIFIER_IMPORT_ALLOWLIST.includes(specifier) || specifier === './v396-s00-isolation-rules.mjs',
    `S00 verifier imports an unlisted capability: ${specifier}`);
}
// Built by concatenation so this check cannot match its own pattern text.
const bannedCalls = ['child' + '_process', 'no' + 'de:net', 'node:' + 'http', 'node:' + 'tls', 'web' + 'socket', 'dy' + 'namic import', 'fet' + 'ch(', 'i' + 'mport("'];
for (const token of bannedCalls) {
  assert(!selfSource.includes(token), `S00 verifier references a forbidden capability: ${token}`);
}
// The token list is built by concatenation so this guard does not match its own text.
const writeTokens = ['write' + 'FileSync', 'append' + 'File', 'rm' + 'Sync', 'mkdir' + 'Sync'];
const selfLines = selfSource.split(/\r?\n/);
for (const token of writeTokens) {
  for (const [index, line] of selfLines.entries()) {
    if (!line.includes(`${token}(`)) continue;
    assert(/\btemp\b/.test(line), `S00 verifier writes outside the temporary directory at line ${index + 1}: ${line.trim()}`);
  }
}
assert(selfLines.some(line => line.includes('mkdtempSync(') && line.includes('tmpdir(')),
  'S00 verifier has no temporary directory');
for (const specifier of importsOf(rulesSource)) {
  assert(['node:fs', 'node:path'].includes(specifier), `rule table imports an unlisted capability: ${specifier}`);
}
for (const callSite of writeTokens.concat(['unl' + 'inkSync'])) {
  assert(!rulesSource.includes(`${callSite}(`), `rule table can mutate the host through ${callSite}`);
}

// S00-T01: the rule table itself may not be relaxed.
assert(ALLOWED_STATIC_PATHS.length === 1 && ALLOWED_STATIC_PATHS[0] === 'scripts/v396-s00-static-check.mjs',
  'more than one entrypoint may claim ALLOWED_STATIC');
for (const indicator of INDICATORS) {
  assert(typeof indicator.pattern.test === 'function' && indicator.label, 'indicator rule is malformed');
  assert(BOUNDARY[indicator.label], `indicator ${indicator.label} has no required boundary`);
  if (indicator.label !== 'runtime-data-or-credential-boundary') {
    assert(FORBIDDEN_INDICATORS.includes(indicator.label), `indicator ${indicator.label} is not forbidden`);
  }
}
assert(SELECTION.skipDirs.length > 0 && !SELECTION.excludedPatterns, 'entrypoint selection introduced a wildcard exclusion');
for (const path of SELECTION.exactPaths) assert(read(path).length > 0, `declared startup entrypoint is unreadable: ${path}`);

// S00-T01: exact, item-by-item review, re-derived from the current tree. A label that
// understates a side effect, or a status that a derived indicator forbids, fails here.
const expected = buildEntrypointReview(root);
assert(entryReview.inventoryVersion === expected.inventoryVersion, 'entrypoint review was not regenerated from the current rules');
assert(entryReview.entryCount === expected.entryCount && entryReview.entries.length === expected.entries.length,
  `entrypoint review count ${entryReview.entryCount} does not match the derived ${expected.entryCount}`);
assert(entryReview.entries.length === new Set(entryReview.entries.map(item => item.path)).size, 'entrypoint review has duplicate paths');
for (const [index, item] of expected.entries.entries()) {
  const delivered = entryReview.entries[index];
  assert(delivered.path === item.path, `entrypoint review order differs at ${item.path}`);
  assert(JSON.stringify(delivered) === JSON.stringify(item), `entrypoint review differs from the derived classification: ${item.path}`);
  assert(read(item.path).length > 0, `reviewed entrypoint is unreadable: ${item.path}`);
}
for (const item of entryReview.entries) {
  assert(item.path && item.kind && item.status && Array.isArray(item.sideEffects) && item.requiredBoundary && item.derivedFrom,
    `reviewed entrypoint is incomplete: ${item.path}`);
  const forbidden = item.sideEffects.filter(label => FORBIDDEN_INDICATORS.includes(label));
  if (item.status === 'ALLOWED_STATIC') {
    assert(item.path === ALLOWED_STATIC_PATHS[0], 'a second entrypoint claims ALLOWED_STATIC');
    assert(item.sideEffects.every(label => label === 'host-or-data-mutation'), 'the executed entrypoint declares a capability beyond a temp write');
    assert(/temp/i.test(item.requiredBoundary), 'the executed entrypoint does not state its temp write boundary');
  }
  if (item.status === 'CONDITIONAL_NOT_RUN') assert(forbidden.length === 0, `${item.path} is not forbidden but declares ${forbidden.join(',')}`);
  if (item.status === 'FORBIDDEN_OR_NOT_RUN') assert(forbidden.length > 0, `${item.path} is forbidden with no supporting indicator`);
  for (const command of item.commands ?? []) {
    const cmdForbidden = command.sideEffects.filter(label => FORBIDDEN_INDICATORS.includes(label));
    assert(command.status === 'FORBIDDEN_OR_NOT_RUN' || cmdForbidden.length === 0,
      `${item.path}#${command.name} is runnable but declares ${cmdForbidden.join(',')}`);
  }
}
// Independent re-read of the claims, so the artifact cannot be kept green by editing
// the review file alone: these are content facts the review must agree with.
for (const path of ['scripts/start-zdj-lan.ps1', 'scripts/windows/start-engine.ps1', 'scripts/run-acceptance.ps1']) {
  assert(isLifecycleNamed(path), `${path} is a lifecycle-named entrypoint and must be forbidden by name`);
}
assert(!isLifecycleNamed('apps/engine/vitest.config.ts'), 'a test config must not be treated as a lifecycle name');
for (const [path, label] of [['scripts/v393-fix-entry-wiring.mjs', 'source-tree-mutation'],
  ['scripts/v393-contract-cleanup.mjs', 'host-or-data-mutation'],
  ['scripts/dev.mjs', 'process-lifecycle'],
  ['scripts/windows/credential-manager.ps1', 'host-or-data-mutation'],
  ['scripts/audit-node-runtime.ps1', 'host-or-data-mutation'],
  ['.github/workflows/v392-verify.yml', 'source-tree-mutation'],
  ['apps/engine/src/main.ts', 'network-or-exchange']]) {
  assert(deriveIndicators(read(path)).includes(label), `${path} no longer shows ${label}; the review must be regenerated from fact`);
}
for (const path of ['scripts/start-zdj-lan.ps1', 'scripts/windows/start-engine.ps1', 'scripts/windows/start-dev.ps1',
  'scripts/dev.mjs', 'scripts/run-acceptance.ps1', 'scripts/v393-fix-entry-wiring.mjs', 'scripts/v393-contract-cleanup.mjs',
  'scripts/windows/credential-manager.ps1', 'scripts/audit-node-runtime.ps1', 'apps/engine/src/main.ts',
  'package.json', '.github/workflows/v392-verify.yml']) {
  const item = entryReview.entries.find(entry => entry.path === path);
  assert(item && item.status === 'FORBIDDEN_OR_NOT_RUN', `known lifecycle or mutating entrypoint is not forbidden: ${path}`);
}
for (const [path, command] of [['package.json', 'verify'], ['package.json', 'test'], ['package.json', 'dev'],
  ['apps/engine/package.json', 'dev'], ['apps/engine/package.json', 'start']]) {
  const item = entryReview.entries.find(entry => entry.path === path);
  assert(item?.commands?.find(entry => entry.name === command)?.status === 'FORBIDDEN_OR_NOT_RUN',
    `${path}#${command} must not be runnable by a later stage`);
}
for (const [path, command] of [['apps/engine/package.json', 'test'], ['packages/contracts/package.json', 'test'],
  ['packages/core/package.json', 'test'], ['apps/engine/package.json', 'typecheck']]) {
  const item = entryReview.entries.find(entry => entry.path === path);
  assert(item?.commands?.find(entry => entry.name === command)?.status === 'CONDITIONAL_NOT_RUN',
    `${path}#${command} should stay available to an isolated later stage`);
}
const mockExchange = read('apps/engine/src/adapters/exchange/MockExchangeAdapter.ts');
assert(!/fetch\(|WebSocket|https?:\/\//.test(mockExchange), 'mock exchange adapter has a network-shaped side effect');

// S00-T01: the test-isolation boundary is stated as a measured fact about the tree.
const engineTests = walk(join(root, 'apps', 'engine', 'src')).filter(path => path.endsWith('.test.ts'));
const engineTestSources = new Map(engineTests.map(path => [rel(path), readFileSync(path, 'utf8')]));
const opensStore = source => /new DatabaseSync\(|new SettingsStore|SettingsStore\.create|new EngineRuntime/.test(source);
const isolated = source => /mkdtemp|tmpdir/.test(source) || source.includes("':memory:'");
const engineTestsOpeningStores = [...engineTestSources].filter(([, source]) => opensStore(source)).map(([path]) => path);
for (const [path, source] of engineTestSources) {
  if (opensStore(source)) assert(isolated(source), `a store-opening engine test has no temp data dir or in-memory database: ${path}`);
  assert(!/['"]data[\\/]/.test(source), `an engine test points at the repository data directory: ${path}`);
  assert(!/ZDJ_PORT\s*[:=]\s*['"]?8080|:8080\b/.test(source), `an engine test binds the production port: ${path}`);
}
assert(engineTests.length > 0 && engineTestsOpeningStores.length > 0, 'engine test isolation could not be measured');

// S00-T02: redact by checking the delivered evidence, not merely by trusting its
// redaction declaration.
const redactionPath = `${evidenceRoot}/redaction-manifest.json`;
const redaction = JSON.parse(read(redactionPath));
assert(redaction.credentialRef && redaction.credentialValue === 'REDACTED', 'redaction manifest is incomplete');
assert(redaction.redacted.includes('apiSecret') && redaction.redacted.includes('secretValue'), 'redaction manifest does not declare secret fields');
for (const path of evidenceFiles) {
  if (rel(path) === redactionPath) continue;
  assert(!/(apiKey|apiSecret|secretValue|privateKey|password|BEGIN [A-Z ]*KEY)/i.test(readFileSync(path, 'utf8')), `credential-shaped material in evidence: ${rel(path)}`);
}

// S00-T03: experiment identity changes when one byte of a fixture or a bound input
// changes, so an old experiment identity cannot be reused.
const identitySources = baseline.identityHashSources;
// The September S00 experiment binds the September default. V3.9.7 changed
// that source in 3fb24ec, so verify the preserved baseline and current default
// as separate identities; never rewrite the original manifest.
const historicalSettingsPath = 'docs/reports/v397-final-system-closeout-20261003/v396-settings.default.json';
const currentSettingsIdentity = JSON.parse(read(argument('--current-identity=') ?? 'docs/reports/v397-final-system-closeout-20261003/current-settings-identity.json'));
const historicalPackageLockPath = argument('--historical-lock=') ?? identitySources.packageLock;
assert(currentSettingsIdentity.historicalCommit === baseline.actualBaseSha,
  'historical settings snapshot is not tied to the S00 baseline commit');
assert(currentSettingsIdentity.currentSource === identitySources.settingsDefault,
  'current settings identity names a different source');
assert(sha256Identity(read(historicalSettingsPath)) === baseline.identityHashes.settingsDefault,
  'historical settings snapshot differs from the original S00 hash');
assert(sha256Identity(read(currentSettingsIdentity.currentSource)) === currentSettingsIdentity.currentSha256,
  'current settings default differs from its V3.9.7 identity');
if(currentSettingsIdentity.currentPackageLockSha256)
  assert(sha256Identity(read(identitySources.packageLock))===currentSettingsIdentity.currentPackageLockSha256,
    'current package lock differs from its V3.9.7 identity');
assert(identitySources && Object.keys(identitySources).length >= 5, 'baseline identity hashes are not bound to files');
assert(baseline.identityHashNormalisation === 'sha256 over the file text with CRLF normalised to LF',
  'the identity hash rule is not declared');
assert(sha256Identity('a\r\nb') === sha256Identity('a\nb'), 'line-ending normalisation does not stabilise the identity');
assert(baseline.fixtureSchemaVersion === fixture.schemaVersion, 'the declared fixture schema does not match the delivered fixture');
for (const [key, path] of Object.entries(identitySources)) {
  const boundPath = key === 'settingsDefault' ? historicalSettingsPath : key==='packageLock'?historicalPackageLockPath:path;
  assert(baseline.identityHashes[key] === sha256Identity(read(boundPath)), `baseline identity hash no longer matches its source: ${key} -> ${boundPath}`);
}
const temp = mkdtempSync(join(tmpdir(), 'zdj-v396-s00-'));
try {
  const original = JSON.stringify(fixture);
  const changed = original.replace('normal-entry', 'normal-entry-mutated');
  assert(original !== changed && sha256(original) !== sha256(changed), 'fixture hash did not change after mutation');
  writeFileSync(join(temp, 'fixture-original.json'), original);
  writeFileSync(join(temp, 'fixture-mutated.json'), changed);
  assert(readFileSync(join(temp, 'fixture-mutated.json'), 'utf8') === changed, 'mutated fixture was not written to isolated temp storage');
  assert(sha256Identity(changed) !== baseline.identityHashes.fixtureFile, 'mutated fixture would reuse the declared experiment identity');
  for (const key of ['settingsDefault', 's00Specification', 'contracts', 'packageLock']) {
    const source = key === 'settingsDefault' ? historicalSettingsPath : key==='packageLock'?historicalPackageLockPath:identitySources[key];
    const bytes = read(source);
    assert(sha256Identity(`${bytes} mutated`) !== baseline.identityHashes[key], `one-byte drift in ${source} would reuse the declared identity`);
    writeFileSync(join(temp, `${key}.baseline`), bytes);
    assert(sha256Identity(readFileSync(join(temp, `${key}.baseline`), 'utf8')) === baseline.identityHashes[key], `${source} is not readable as the declared identity`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
assert(sha256Identity(fixtureRaw) === baseline.identityHashes.fixtureFile, 'baseline fixture identity does not match the delivered fixture');

// S00-T04/T05: legacy AUTO data needs review; BOTH is the one-way net-position scope.
assert(fixture.cases.some(item => item.id === 'legacy-auto-no-plan' && item.expected === 'MANUAL_REVIEW_REQUIRED'), 'legacy AUTO fixture missing');
assert(fixture.scopeExamples.oneWay.positionSide === 'BOTH' && fixture.scopeExamples.hedge.positionSide === 'LONG', 'scope examples are not explicit');

// S00-T04: fixtures must speak the frozen contract vocabulary, or S01 cannot consume them.
const OWNER_STATES = ['AI_ACTIVE', 'HANDOFF_PENDING', 'HUMAN_MANAGED', 'CLOSED'];
const FACT_STATUSES = ['EXACT', 'CONSERVATIVE_BOUND', 'UNKNOWN', 'CONFLICT'];
for (const item of fixture.cases) {
  assert(typeof item.cycleId === 'string' && item.cycleId.length > 0, `fixture case has no cycleId, so I04 cannot be exercised: ${item.id}`);
  assert(FACT_STATUSES.includes(item.factsStatus), `fixture case uses a non-contract FactStatus: ${item.id}`);
  if (item.ownerState !== undefined) {
    assert(OWNER_STATES.includes(item.ownerState) || item.legacy === true,
      `fixture case invents an ownerState without a legacy marker: ${item.id}`);
  }
}
assert(new Set(fixture.cases.map(item => item.cycleId)).size < fixture.cases.length,
  'fixtures share no cycle, so cumulative-loss accounting is untested');
for (const status of FACT_STATUSES) {
  assert(fixture.cases.some(item => item.factsStatus === status), `FactStatus ${status} has no fixture for S01 to consume`);
}
assert(fixture.cases.some(item => item.expected === 'CUMULATIVE_LOSS_WITHIN_CYCLE_NOT_RESET'
  && typeof item.cumulativeNetLossInCycle === 'number' && typeof item.remainingPermissionInCycle === 'number'),
  'I04 cumulative 10 USDT accounting has no fixture');
assert(fixture.cases.some(item => item.factsStatus === 'CONFLICT' && Array.isArray(item.conflictingSourceIds)),
  'CONFLICT has no fixture with the conflicting sources named');

// S00-T06: every invariant has a planned consumer, responsible phase and contract section.
const map = JSON.parse(read(`${evidenceRoot}/invariant-consumer-map.json`));
const expectedInvariantIds = Array.from({ length: 12 }, (_, index) => `I${String(index + 1).padStart(2, '0')}`);
assert(map.length === 12 && map.map(item => item.id).sort().join(',') === expectedInvariantIds.join(','), 'I01-I12 IDs are incomplete or duplicated');
assert(map.every(item => item.consumer && item.phase && item.contractSection && item.plannedTestStages?.length), 'I01-I12 consumer/test-responsibility map is incomplete');
const contractsText = read('docs/plans/v396/CONTRACTS.md');
const contractSections = [...contractsText.matchAll(/^## (\d+)\./gm)].map(match => match[1]);
for (const item of map) {
  for (const section of String(item.contractSection).split(',')) {
    assert(contractSections.includes(section.trim()), `I${item.id.slice(1)} cites a contract section that does not exist: ${section}`);
  }
}
assert(map.find(item => item.id === 'I10').authoritySource === 'README.md section 1 item 7 and AGENTS.md',
  'I10 must name the lifecycle authority, because CONTRACTS has no lifecycle section');

console.log(JSON.stringify({
  stage: 'S00',
  tests: { S00_T01: 'PASS', S00_T02: 'PASS', S00_T03: 'PASS', S00_T04: 'PASS', S00_T05: 'PASS', S00_T06: 'PASS' },
  fixtureHash: sha256(JSON.stringify(fixture)),
  network: 'NOT_USED',
  exchangeWrites: 0,
  engineLifecycle: 'NOT_USED',
  settingsModified: false,
  verifierScope: entryIndex.s00Verification.classification,
  entrypointReviewCount: entryReview.entryCount,
  entrypointStatusCounts: entryReview.entries.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] ?? 0) + 1 }), {}),
  engineTestIsolation: {
    testFiles: engineTests.length,
    openingAStore: engineTestsOpeningStores.length,
    everyStoreOpeningTestIsolated: true,
    repositoryDataDirReferences: 0,
    productionPortReferences: 0,
  },
  blockers: [],
}, null, 2));

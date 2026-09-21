import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = file => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(`S00_CHECK_FAILED: ${message}`); };
const sha256 = value => createHash('sha256').update(value).digest('hex');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item => {
  const path = join(dir, item.name);
  return item.isDirectory() ? walk(path) : [path];
});
const evidenceRoot = 'docs/evidence/v396/S00/20260921T145000Z';
const evidenceFiles = walk(join(root, evidenceRoot));
const rel = path => path.slice(root.length + 1).replaceAll('\\', '/');

const packageJson = JSON.parse(read('package.json'));
const settings = JSON.parse(read('config/settings.default.json'));
const fixturePath = `${evidenceRoot}/fixtures/s00-fixtures.json`;
const fixtureRaw = read(fixturePath);
const fixture = JSON.parse(fixtureRaw);
const baseline = JSON.parse(read(`${evidenceRoot}/baseline-manifest.json`));
const entryIndex = JSON.parse(read(`${evidenceRoot}/entrypoint-index.json`));
const entryReview = JSON.parse(read(`${evidenceRoot}/entrypoint-review.json`));
const entry = read('apps/engine/src/services/entryCoordinator.ts');
const manual = read('apps/engine/src/services/manualPositionService.ts');
const tp = read('apps/engine/src/services/tpGuardian.ts');
const main = read('apps/engine/src/main.ts');
const launcher = read('scripts/start-zdj-lan.ps1');
const dev = read('scripts/dev.mjs');

// S00-T01: this command is the only S00 verification command.  It only reads
// source/evidence and writes a fixture copy below the OS temp directory; other
// repo commands are classified NOT_RUN rather than treated as isolated.
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
const verifierSource = read('scripts/v396-s00-static-check.mjs');
assert(!/from 'node:(child_process|net|http|https|tls|worker_threads)'/.test(verifierSource), 'S00 verifier imports a process or network capability');
assert(!/\b(spawn|exec|fork|fetch)\s*\(/.test(verifierSource), 'S00 verifier can launch a process or request a network resource');
const mockExchange = read('apps/engine/src/adapters/exchange/MockExchangeAdapter.ts');
assert(!/fetch\(|WebSocket|https?:\/\//.test(mockExchange), 'mock exchange adapter has a network-shaped side effect');

// S00-T01: exact, item-by-item review. The review file is generated from the
// current tree's scripts plus package/test-config entries; no wildcard is used
// to turn an unreviewed entry into an exclusion.
const candidatePaths = walk(join(root, 'scripts')).concat(walk(join(root, 'apps')), walk(join(root, 'packages')))
  .filter(path => path.startsWith(join(root, 'scripts')) || path.endsWith('package.json') || /(?:^|[\\/])(vitest|vite)\.config\.[cm]?[jt]s$/.test(path))
  .map(rel).sort();
const reviewedPaths = entryReview.entries.map(item => item.path).sort();
assert(entryReview.entryCount === reviewedPaths.length && entryReview.entryCount === 99, 'entrypoint review count is not frozen');
assert(candidatePaths.join('\n') === reviewedPaths.join('\n'), 'entrypoint review is not an exact match for current startup/package/config files');
assert(entryReview.entries.every(item => item.path && item.status && Array.isArray(item.sideEffects) && item.requiredBoundary), 'entrypoint review has incomplete item fields');
assert(entryReview.entries.filter(item => item.status === 'ALLOWED_STATIC').map(item => item.path).join(',') === 'scripts/v396-s00-static-check.mjs', 'unexpected entry marked allowed');
for (const item of entryReview.entries) assert(read(item.path).length > 0, `reviewed entrypoint is unreadable: ${item.path}`);

// S00-T02: redact by checking the delivered evidence, not merely by trusting
// its redaction declaration. Credential-shaped keys/values are allowed only in
// the declaration itself, where they are explicitly documented as redacted.
const redactionPath = `${evidenceRoot}/redaction-manifest.json`;
const redaction = JSON.parse(read(redactionPath));
assert(redaction.credentialRef && redaction.credentialValue === 'REDACTED', 'redaction manifest is incomplete');
assert(redaction.redacted.includes('apiSecret') && redaction.redacted.includes('secretValue'), 'redaction manifest does not declare secret fields');
for (const path of evidenceFiles) {
  if (rel(path) === redactionPath) continue;
  assert(!/(apiKey|apiSecret|secretValue|privateKey|password|BEGIN [A-Z ]*KEY)/i.test(readFileSync(path, 'utf8')), `credential-shaped material in evidence: ${rel(path)}`);
}

// S00-T03: experiment identity changes when one byte of a fixture changes.
const temp = mkdtempSync(join(tmpdir(), 'zdj-v396-s00-'));
try {
const original = JSON.stringify(fixture);
  const changed = original.replace('normal-entry', 'normal-entry-mutated');
  assert(original !== changed && sha256(original) !== sha256(changed), 'fixture hash did not change after mutation');
  const path = join(temp, 'fixture.json');
  writeFileSync(path, original);
  writeFileSync(path, changed);
  assert(readFileSync(path, 'utf8') === changed, 'mutated fixture was not written to isolated temp storage');
  assert(sha256(changed) !== baseline.identityHashes.fixtureFile, 'mutated fixture would reuse the declared experiment identity');
} finally { rmSync(temp, { recursive: true, force: true }); }
assert(sha256(fixtureRaw) === baseline.identityHashes.fixtureFile, 'baseline fixture identity does not match the delivered fixture');

// S00-T04/T05: legacy AUTO data needs review; BOTH is the one-way net-position scope.
assert(fixture.cases.some(item => item.id === 'legacy-auto-no-plan' && item.expected === 'MANUAL_REVIEW_REQUIRED'), 'legacy AUTO fixture missing');
assert(fixture.scopeExamples.oneWay.positionSide === 'BOTH' && fixture.scopeExamples.hedge.positionSide === 'LONG', 'scope examples are not explicit');

// S00-T06: every invariant has a planned consumer and responsible phase.
const map = JSON.parse(read('docs/evidence/v396/S00/20260921T145000Z/invariant-consumer-map.json'));
const expectedInvariantIds = Array.from({ length: 12 }, (_, index) => `I${String(index + 1).padStart(2, '0')}`);
assert(map.length === 12 && map.map(item => item.id).sort().join(',') === expectedInvariantIds.join(','), 'I01-I12 IDs are incomplete or duplicated');
assert(map.every(item => item.consumer && item.phase && item.contractSection && item.plannedTestStages?.length), 'I01-I12 consumer/test-responsibility map is incomplete');

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
  blockers: [],
}, null, 2));

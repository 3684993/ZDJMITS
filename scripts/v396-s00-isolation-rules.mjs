// Shared, reviewable rule table for the S00 entrypoint isolation boundary.
//
// The scan is a conservative over-approximation: a keyword match can only push an
// entry toward a stricter status, never toward "allowed". Under-stating a side effect
// therefore fails the verification instead of passing it.
//
// `v396-s00-static-check.mjs` re-derives every classification from this table and
// refuses the artifact on any mismatch, so relaxing a rule here fails the gate.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Entry locations reviewed item-by-item. `exact` paths are additional startup entries
// that live outside `scripts/`; `pattern` selects the rest. No wildcard exclusion
// exists in this file: anything the selectors match must be classified.
export const SELECTION = {
  scriptDirs: ['scripts'],
  workspaceDirs: ['apps', 'packages'],
  exactPaths: [
    'package.json',
    'apps/engine/src/main.ts',
    'apps/engine/src/server.ts',
    'apps/dashboard/index.html',
    'apps/dashboard/src/main.ts',
  ],
  testConfigFile: /(?:^|\/)(?:vitest|vite)\.config\.[cm]?[jt]s$/,
  packageFile: /(?:^|\/)package\.json$/,
  ciWorkflowDir: '.github/workflows',
  // Dependency and build output trees are not repository entrypoints. Skipping them
  // keeps the candidate set identical whether or not `npm ci` has been run; it is a
  // determinism rule, not an exclusion of first-party code.
  skipDirs: ['node_modules', 'dist', '.git', 'data', 'data-test'],
};

export const INDICATORS = [
  {
    label: 'process-lifecycle',
    pattern: /child_process|spawnSync|\bspawn\s*\(|execSync|\bexecFile\s*\(|\bfork\s*\(|Start-Process|Start-Job|Stop-Process|taskkill|Invoke-Expression|\btsx watch\b|npm run dev\b|npm run start\b|vite --host/i,
  },
  {
    label: 'network-or-exchange',
    pattern: /\bfetch\s*\(|https?:\/\/|wss?:\/\/|WebSocket|Invoke-RestMethod|Invoke-WebRequest|axios|\bbinance\b|net\.createServer|createServer|\.listen\s*\(/i,
  },
  {
    label: 'host-or-data-mutation',
    pattern: /writeFileSync|writeFile\s*\(|WriteAllText|WriteAllBytes|appendFile|mkdirSync|\bmkdir\s*\(|rmSync|rimraf|\brem\s*rimraf|Remove-Item|Set-Content|Out-File|New-Item|Copy-Item|Move-Item|DatabaseSync|node:sqlite|\bUPDATE\b[\s\S]{0,40}\bSET\b|INSERT INTO|npm ci|npm install|Add-Type|DllImport|CredWrite|CredDelete|New-Object -ComObject/i,
  },
  {
    label: 'source-tree-mutation',
    pattern: /writeFileSync\([^)]*(?:apps|packages)\/|fs\.writeFileSync\(file|git (?:add|commit|push)\b/i,
  },
  {
    label: 'runtime-data-or-credential-boundary',
    pattern: /ZDJ_DATA_DIR|ZDJ_CONFIG_DIR|settings\.sqlite|zdj-settings|settings\.json|engine-instance\.json|apiSecret|apiKey|\bcredential\b|keytar|ConvertTo-SecureString|dotenv|process\.env\.[A-Z_]*(?:ZDJ|MITS)|['"]\.env['"]|['"]data[\\/]|data-test|\bPORT\b|ZDJ_PORT|Get-CimInstance|Win32_Process|Get-Process/i,
  },
  {
    label: 'exchange-write-capable',
    pattern: /placeEntry|placeTakeProfit|placeManualOrder|submitOrder|cancelOrder|newOrder|\/fapi\/v1\/order|type=LIMIT|"BUY"|'BUY'/i,
  },
  {
    label: 'aggregate-verification-chain',
    pattern: /npm run (?:verify|test|build|typecheck|acceptance)(?::|\b)|verify:scripts|verify:isolated|-ws\b.*--if-present/i,
  },
];

// Any of these forces FORBIDDEN_OR_NOT_RUN. Boundary-eligible work must not be able to
// spawn a process, reach a network or exchange endpoint, mutate the host, rewrite the
// source tree, touch a live data/credential boundary, or run an aggregate command.
export const FORBIDDEN_INDICATORS = [
  'process-lifecycle',
  'network-or-exchange',
  'host-or-data-mutation',
  'source-tree-mutation',
  'exchange-write-capable',
  'aggregate-verification-chain',
  'lifecycle-named-entrypoint',
];

// A lifecycle verb as the first token of a script file name, or of an npm script name.
// `package.json` is deliberately not matched: a manifest is judged command by command.
const LIFECYCLE_FILE_NAME = /(?:^|\/)(?:start|stop|restart|watch|serve|install|uninstall|init|package-zdj|reset|repair|rollout|deploy|endurance|guardian|canary|smoke|acceptance|run-)[^/]*\.(?:ps1|mjs|cjs|js|ts|cmd|bat)$/i;
const LIFECYCLE_COMMAND_NAME = /^(?:start|stop|restart|dev|serve|watch|install|init|reset|repair|rollout|deploy|endurance|guardian|canary|smoke|acceptance|observe|storage|v394:)\b/i;

// Filename heuristics that are lifecycle-bearing regardless of file contents.
export const FORBIDDEN_NAME_PATTERN = LIFECYCLE_FILE_NAME;

// The only command S00 executes. Anything else cannot claim ALLOWED_STATIC.
export const ALLOWED_STATIC_PATHS = Object.freeze(['scripts/v396-s00-static-check.mjs']);

// Module specifiers the ALLOWED_STATIC verifier may import. Checked against its own
// source so the keyword scan is not used to self-certify.
export const VERIFIER_IMPORT_ALLOWLIST = Object.freeze([
  'node:crypto',
  'node:fs',
  'node:path',
  'node:os',
  'node:url',
]);

export const BOUNDARY = {
  'process-lifecycle': 'no process start of any kind; requires explicit user authorization per Engine lifecycle action',
  'network-or-exchange': 'mock/no-network/no-exchange-write assertion with a write counter that throws',
  'host-or-data-mutation': 'unique temp data dir outside the repository; no live database or Settings store',
  'source-tree-mutation': 'source-rewriting patch; never run as a test step',
  'runtime-data-or-credential-boundary': 'unique temp data dir plus unique loopback port; no credential read',
  'exchange-write-capable': 'read-only adapter only; exchange writes require separate authorization',
  'aggregate-verification-chain': 'not runnable as a unit; classify each member command separately',
  'lifecycle-named-entrypoint': 'manual lifecycle entrypoint; excluded from automated verification',
};

const DEFAULT_BOUNDARY = 'unique temp data dir; unique loopback port; mock/no-network/no-exchange-write assertion; explicit user authorization where lifecycle is involved';

export function deriveIndicators(text) {
  return INDICATORS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

export function isLifecycleNamed(path) {
  return LIFECYCLE_FILE_NAME.test(path);
}

export function isLifecycleNamedCommand(name) {
  return LIFECYCLE_COMMAND_NAME.test(name);
}

export function deriveStatus(path, sideEffects) {
  if (ALLOWED_STATIC_PATHS.includes(path)) return 'ALLOWED_STATIC';
  if (sideEffects.some(label => FORBIDDEN_INDICATORS.includes(label))) return 'FORBIDDEN_OR_NOT_RUN';
  if (isLifecycleNamed(path)) return 'FORBIDDEN_OR_NOT_RUN';
  return 'CONDITIONAL_NOT_RUN';
}

export function deriveBoundary(sideEffects, path) {
  const notes = sideEffects.map(label => BOUNDARY[label]).filter(Boolean);
  if (isLifecycleNamed(path) && !notes.includes(BOUNDARY['lifecycle-named-entrypoint'])) {
    notes.push(BOUNDARY['lifecycle-named-entrypoint']);
  }
  return notes.length ? [...new Set(notes)].join('; ') : DEFAULT_BOUNDARY;
}

// ---- single source of the item-by-item review; both the generator and the verifier
// ---- call this, so the committed artifact cannot drift from the current tree.

function walk(root, relativeDir, seen = new Set()) {
  let items;
  try { items = readdirSync(join(root, relativeDir), { withFileTypes: true }); } catch { return []; }
  return items.flatMap(item => {
    if (SELECTION.skipDirs.includes(item.name) || seen.has(`${relativeDir}/${item.name}`)) return [];
    const rel = relativeDir ? `${relativeDir}/${item.name}` : item.name;
    if (!item.isDirectory()) return [rel];
    seen.add(rel);
    return walk(root, rel, seen);
  });
}

export function candidates(root) {
  const scanned = [...SELECTION.scriptDirs, ...SELECTION.workspaceDirs, SELECTION.ciWorkflowDir]
    .flatMap(dir => walk(root, dir))
    .filter(path => path.startsWith('scripts/') || SELECTION.packageFile.test(path)
      || SELECTION.testConfigFile.test(path) || path.startsWith(`${SELECTION.ciWorkflowDir}/`));
  return [...new Set(scanned.concat(SELECTION.exactPaths))].sort();
}

export function kindOf(path) {
  if (path.startsWith(`${SELECTION.ciWorkflowDir}/`)) return 'ci-workflow';
  if (path.endsWith('package.json')) return 'package-script';
  if (SELECTION.testConfigFile.test(path)) return 'test-config';
  if (/\.test\.[cm]?[jt]s$/.test(path)) return 'test-script';
  return path.startsWith('scripts/') ? 'script' : 'runtime-entry';
}

const referencedScripts = source => [...source.matchAll(/scripts\/[\w.\-/${}]+/g)]
  .map(match => match[0])
  .filter(path => /\.(?:mjs|cjs|js|ts|ps1)$/.test(path));

// Follows indirection hops so `dev = node scripts/dev.mjs` cannot hide the spawn inside
// dev.mjs, and a launcher that dot-sources another launcher cannot hide it either.
// Cycles are cut by the visited set and the depth is capped.
function indicatorsWithHops(root, source, visited, depth) {
  const found = new Set(deriveIndicators(source));
  if (depth < 3) {
    for (const path of referencedScripts(source)) {
      if (visited.has(path)) continue;
      visited.add(path);
      let body;
      try { body = readFileSync(join(root, path), 'utf8'); } catch { found.add('runtime-data-or-credential-boundary'); continue; }
      for (const label of deriveIndicators(body)) found.add(label);
      if (isLifecycleNamed(path)) found.add('lifecycle-named-entrypoint');
    }
  }
  return found;
}

export function indicatorsForCommand(root, name, command, visited = new Set()) {
  const found = indicatorsWithHops(root, command, visited, 0);
  if (/npm run (?:[\w:]+)(?:\s|$).*(?:-ws\b|--workspace)/.test(command) || /npm run (?:verify|test|build|typecheck|acceptance)/.test(command)) {
    found.add('aggregate-verification-chain');
  }
  if (isLifecycleNamedCommand(name)) found.add('lifecycle-named-entrypoint');
  return [...found].sort();
}

export function indicatorsForFile(root, path, visited = new Set()) {
  visited.add(path);
  const found = indicatorsWithHops(root, readFileSync(join(root, path), 'utf8'), visited, 1);
  if (isLifecycleNamed(path)) found.add('lifecycle-named-entrypoint');
  return [...found].sort();
}

export function buildEntrypointReview(root) {
  const text = path => readFileSync(join(root, path), 'utf8');
  const entries = candidates(root).map(path => {
    const kind = kindOf(path);
    const entry = { path, kind };
    if (kind === 'package-script') {
      const scripts = JSON.parse(text(path)).scripts ?? {};
      entry.commands = Object.entries(scripts).map(([name, command]) => {
        const sideEffects = indicatorsForCommand(root, name, String(command));
        return { name, sideEffects, status: deriveStatus(name, sideEffects) };
      }).sort((a, b) => a.name.localeCompare(b.name));
      entry.sideEffects = [...new Set(entry.commands.flatMap(item => item.sideEffects))].sort();
      entry.derivedFrom = 'package-script-command-text-and-one-hop-target';
      entry.status = entry.commands.some(item => item.status === 'FORBIDDEN_OR_NOT_RUN')
        ? 'FORBIDDEN_OR_NOT_RUN' : deriveStatus(path, entry.sideEffects);
    } else if (ALLOWED_STATIC_PATHS.includes(path)) {
      // The one executed entrypoint is not self-certified by a keyword scan: the scan is
      // reduced to the write it really performs, and the verifier proves its own import
      // allowlist and that every write call site is scoped to an OS temporary directory.
      entry.sideEffects = indicatorsForFile(root, path).filter(label => label === 'host-or-data-mutation');
      entry.derivedFrom = 'restricted-capability-entry; proven by import allowlist and temp-scoped write call sites';
      entry.status = 'ALLOWED_STATIC';
    } else {
      entry.sideEffects = indicatorsForFile(root, path);
      entry.derivedFrom = 'file-content-and-one-hop-target';
      entry.status = deriveStatus(path, entry.sideEffects);
    }
    entry.requiredBoundary = deriveBoundary(entry.sideEffects, path);
    return entry;
  });
  return {
    inventoryVersion: 'S00-T01-entry-review-2',
    capturedAt: '2026-09-21',
    derivation: 'mechanical over-approximating static scan by scripts/v396-s00-isolation-rules.mjs; a match can only tighten a status, never relax it',
    entryCount: entries.length,
    statusLegend: {
      ALLOWED_STATIC: 'executed by the S00 verification command',
      CONDITIONAL_NOT_RUN: 'not executed; a later stage may run it only after the required boundary is proven',
      FORBIDDEN_OR_NOT_RUN: 'not executed; process, network, exchange, host, source-tree or aggregate risk detected',
    },
    entries,
  };
}

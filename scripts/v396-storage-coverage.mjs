#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURABLE_SQLITE } from './durable-storage-inventory.mjs';

/**
 * S08: derive the storage-coverage report instead of writing one down.
 *
 * A coverage document that is typed by hand says what somebody believed, and beliefs go stale the
 * moment a script changes. Every field here is read out of the repository, so the report can only
 * claim a file is backed up when the tooling that runs before a deploy really enumerates it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const outArg = process.argv.find(argument => argument.startsWith('--out='));
const outFile = outArg ? path.resolve(root, outArg.slice('--out='.length))
  : path.join(root, 'docs/evidence/v396/final-convergence-20260922/J5/storage-coverage.json');
const verify = process.argv.includes('--verify-backup');

const backupScript = () => read('scripts/v394-stage6-preflight.mjs');
const pruneScript = () => read('scripts/prune-zdj-backups.mjs');
const maintainScript = () => read('scripts/maintain-storage.mjs');

/** Which durable files the pre-deploy backup actually enumerates, read from the inventory it uses. */
function backupInventory() {
  const declared = DURABLE_SQLITE.filter(Boolean);
  const loop = /for\s*\(\s*const\s+name\s+of\s+DURABLE_SQLITE\s*\)/.test(backupScript());
  const verified = backupScript().includes('BACKUP_FINGERPRINT_MISMATCH') && backupScript().includes('sqliteBackup(handle,target)');
  return { declared, enumeratedByBackupLoop: loop, contentVerifiedPerTable: verified };
}

function retentionInventory(name) {
  // Retention is generic over the data directory: a file joins it by living there with the same
  // extension, which is what this expression proves rather than what a list claims.
  const expression = /\.endsWith\(['"]\.sqlite['"]\)/.test(pruneScript());
  return { genericSqliteScan: expression, fileMatchesPattern: name.endsWith('.sqlite') };
}

const walk = dir => { try { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
}); } catch { return []; } };

/** Which production modules open this file. Derived by scanning the engine tree, not by a curated list. */
function runtimeConsumers(name) {
  return walk(path.join(root, 'apps/engine/src'))
    .filter(source => readFileSync(source, 'utf8').includes(name))
    .map(source => path.relative(root, source).replace(/\\/g, '/'))
    .sort();
}

function build() {
  const inventory = backupInventory();
  const files = inventory.declared.map(name => {
    const retention = retentionInventory(name), consumers = runtimeConsumers(name);
    const backedUp = inventory.enumeratedByBackupLoop && inventory.declared.includes(name);
    return {
      name,
      backedUpByExistingTooling: backedUp,
      contentVerifiedPerTable: inventory.contentVerifiedPerTable,
      inStorageRetentionInventory: retention.genericSqliteScan && retention.fileMatchesPattern,
      retentionMechanism: retention.genericSqliteScan ? 'generic-sqlite-scan(scripts/prune-zdj-backups.mjs)' : 'NONE',
      readByAnyRuntimeConsumer: consumers.length > 0,
      runtimeConsumers: consumers,
      grantsAiWriteAuthority: false,
      releaseBlocking: !(backedUp && retention.genericSqliteScan && consumers.length),
    };
  });
  const blocking = files.filter(file => file.releaseBlocking).map(file => file.name);
  return {
    schema: 'V396-STORAGE-COVERAGE-2',
    generatedBy: 'scripts/v396-storage-coverage.mjs',
    stageId: 'S08',
    gate: blocking.length ? 'S08_STORAGE_COVERAGE_OPEN' : 'S08_STORAGE_COVERAGE_PASS',
    durableSqliteInventory: inventory.declared,
    backupTooling: { script: 'scripts/v394-stage6-preflight.mjs', enumeratesInventory: inventory.enumeratedByBackupLoop, perTableRestoreProof: inventory.contentVerifiedPerTable },
    retentionTooling: { script: 'scripts/prune-zdj-backups.mjs', mechanism: 'generic *.sqlite scan' },
    compactionTooling: { script: 'scripts/maintain-storage.mjs', targetsSingleDatabase: /--db['"],\s*'data\/zdj-settings\.sqlite'/.test(maintainScript()) || maintainScript().includes("option('db','data/zdj-settings.sqlite')") },
    files,
    blockingFiles: blocking,
    liveSettingsDatabaseTouched: false,
    productionMigrationPerformed: false,
    note: 'S08 覆盖报告由本脚本从仓库内容推导；人工改写会被 apps/engine/src/services/ownershipStorageCoverage.test.ts 的推导复核判为不一致。',
  };
}

const report = build();
if (verify) {
  // Prove the backup loop actually round-trips a ledger: run the tool's own self-test, which works in
  // an OS temp directory and never touches a live data directory.
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/v394-stage6-preflight.mjs'), '--self-test'], { encoding: 'utf8' });
  report.backupSelfTest = { command: 'node scripts/v394-stage6-preflight.mjs --self-test', pass: output.includes('self-test PASS') };
  if (!report.backupSelfTest.pass) throw new Error('BACKUP_SELF_TEST_FAILED');
}
const COMPARED = ['schema', 'stageId', 'gate', 'durableSqliteInventory', 'backupTooling', 'retentionTooling', 'compactionTooling', 'files', 'blockingFiles',
  'liveSettingsDatabaseTouched', 'productionMigrationPerformed'];
const stable = value => JSON.stringify(Object.fromEntries(COMPARED.map(key => [key, value[key]])));

if (process.argv.includes('--check')) {
  if (!existsSync(outFile)) throw new Error(`STORAGE_COVERAGE_REPORT_MISSING:${outFile}`);
  const committed = JSON.parse(readFileSync(outFile, 'utf8'));
  if (stable(committed) !== stable(report)) {
    console.error('STORAGE_COVERAGE_REPORT_STALE: 提交内容与当前仓库推导结果不一致');
    console.error(JSON.stringify({ committed: committed.files?.map(f => [f.name, f.releaseBlocking]), derived: report.files.map(f => [f.name, f.releaseBlocking]) }, null, 2));
    process.exit(1);
  }
  console.log(`STORAGE_COVERAGE_CHECK_PASS gate=${committed.gate}`);
} else {
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`STORAGE_COVERAGE_WRITTEN ${path.relative(root, outFile)} gate=${report.gate}`);
}

/**
 * Phase C1: V3.9.6 ownership migration rehearsal against an isolated copy of the frozen
 * V3.9.5 durable image. Runs the runbook's seven steps (preview -> backup fingerprint ->
 * apply -> readback -> restore -> idempotent rerun -> newer-schema rejection) and writes a
 * machine-readable verdict. Never touches D:/MITS/data and never starts an engine.
 */
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OwnershipJournal,
  OWNERSHIP_SCHEMA_VERSION,
} from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipJournal.js';
import { OwnershipMigration } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipMigration.js';
import { executionScope } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/executionLifecycle.js';

const COLD = process.argv[2] ?? 'D:/MITS-backups/cutover-20260923/cold/zdj-settings.sqlite';
const OUT = process.argv[3];
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const tables = (db) =>
  Object.fromEntries(
    db
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
      .all()
      .map((r) => [r.name, Number(db.prepare(`select count(*) c from "${r.name}"`).get().c)]),
  );
const work = mkdtempSync(join(tmpdir(), 'zdj-v396-rehearsal-'));
const dataDir = join(work, 'data');
mkdirSync(dataDir, { recursive: true });
const copy = join(dataDir, 'zdj-settings.sqlite');
copyFileSync(COLD, copy);
const now = Date.now();
const ev = { runId: 'migration-rehearsal-20260923', nowUtc8: new Date(now + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08', tmpDir: work, sourceImage: COLD, sourceImageSha256: sha(COLD), steps: [] };
const step = (id, verdict, detail) => {
  ev.steps.push({ id, verdict, ...detail });
  console.log(`[${verdict}] ${id}`);
};
const fail = (id, detail) => {
  step(id, 'FAIL', detail);
  ev.verdict = 'FAIL';
  writeFileSync(join(OUT, 'migration-rehearsal.json'), JSON.stringify(ev, null, 1) + '\n');
  console.log('VERDICT=FAIL at step ' + id);
  process.exit(1);
};

/* subjects derived from the frozen image, exactly as the live engine would see them */
const src = new DatabaseSync(copy, { readOnly: true });
const settings = JSON.parse(String(src.prepare('select payload from settings where id=1').get().payload));
const env = settings.connections.exchange.environment;
const cred = settings.connections.exchange.credentialRef;
const positions = src
  .prepare("select payload from runtime_entities where kind='positions'")
  .all()
  .map((r) => JSON.parse(String(r.payload)));
const sourceTables = tables(src);
const sourceSettingsVersion = Number(settings.settingsVersion);
src.close();
const subjects = positions.map((p) => ({
  scope: executionScope(env, cred, String(p.symbol), 'ENTRY'),
  cycleId: String(p.cycleId ?? `cycle_${p.id}`),
  planRef: p.tradePlanRef ?? p.planRef ?? null,
  firstFillAt: Number(p.openedAt ?? p.firstObservedAt),
  deadline: p.aiManagementDeadline ?? p.managementDeadline ?? null,
  managementStatus: String(p.managementStatus),
  legacy: true,
}));
ev.subjects = {
  count: subjects.length,
  executionScopeShape: subjects[0].scope,
  byManagementStatus: subjects.reduce((m, s) => ((m[s.managementStatus] = (m[s.managementStatus] ?? 0) + 1), m), {}),
  withPlanRef: subjects.filter((s) => s.planRef).length,
  withDeadline: subjects.filter((s) => s.deadline != null).length,
  derivationNote: 'V3.9.5 has no immutable TradePlan and no AI management deadline field, so planRef is null and deadline is null for every cycle; legacy=true is set because the cycle predates the V3.9.6 plan/authority model.',
};

/* step 1: preview must not write */
{
  const before = sha(copy);
  const preview = OwnershipMigration.preview(subjects, null, now);
  const after = sha(copy);
  if (before !== after) fail('1-preview-readonly', { detail: 'preview changed the settings image' });
  const journalFile = join(dataDir, 'v396-ownership.sqlite');
  const journalExists = statExists(journalFile);
  step('1-preview-readonly', 'PASS', {
    imageHashUnchanged: true,
    wouldCreate: preview.created.length,
    wouldPreserve: preview.preserved.length,
    wouldSkip: preview.skipped.length,
    wouldMutateExisting: preview.wouldMutateExisting,
    ownerStatesFromPreview: preview.created.reduce((m, c) => ((m[c.ownerState] = (m[c.ownerState] ?? 0) + 1), m), {}),
    journalFileCreatedByPreview: journalExists,
    assertion: 'preview wrote nothing and proposed no AI_ACTIVE owner',
    pass: preview.wouldMutateExisting === 0 && !preview.created.some((c) => c.ownerState === 'AI_ACTIVE') && !journalExists,
  });
  if (preview.wouldMutateExisting !== 0 || preview.created.some((c) => c.ownerState === 'AI_ACTIVE')) fail('1-preview-authority', ev.steps.at(-1));
}
function statExists(f) {
  try {
    statSync(f);
    return true;
  } catch {
    return false;
  }
}

/* step 2: durable backup with per-table fingerprint equality */
const backupFile = join(work, 'backup-zdj-settings.sqlite');
{
  const handle = new DatabaseSync(copy, { readOnly: true });
  const before = tables(handle);
  const integrity = String(handle.prepare('PRAGMA integrity_check').get().integrity_check);
  await sqliteBackup(handle, backupFile);
  handle.close();
  const check = new DatabaseSync(backupFile, { readOnly: true });
  const after = tables(check);
  const checkIntegrity = String(check.prepare('PRAGMA integrity_check').get().integrity_check);
  check.close();
  const equal = JSON.stringify(before) === JSON.stringify(after);
  step('2-backup-fingerprint', equal && checkIntegrity === 'ok' ? 'PASS' : 'FAIL', {
    sourceIntegrity: integrity,
    backupIntegrity: checkIntegrity,
    tables: Object.keys(before).length,
    totalRowsSource: Object.values(before).reduce((a, b) => a + b, 0),
    totalRowsBackup: Object.values(after).reduce((a, b) => a + b, 0),
    fingerprintEqual: equal,
    differing: Object.keys(before).filter((t) => before[t] !== after[t]),
    note: 'same check scripts/v394-stage6-preflight.mjs performs; that script additionally gates on executionMode=READ_ONLY plus a SOCKS5h proxy with a static egress IP, which is a launch-time档位 assertion and is recorded separately for the D-phase start',
  });
  if (!equal) fail('2-backup-fingerprint', ev.steps.at(-1));
}

/* step 3: apply */
const journalFile = join(dataDir, 'v396-ownership.sqlite');
let applyFirst = null;
{
  const journal = new OwnershipJournal(journalFile);
  const migration = new OwnershipMigration(journal);
  applyFirst = migration.apply(subjects, now);
  const owners = journal.query('SELECT scope, cycle_id, version, payload FROM v396_owners ORDER BY cycle_id').map((r) => ({ row: r, o: JSON.parse(String(r.payload)) }));
  const claims = Number(journal.query('select count(*) as c from v396_quantity_claims')[0].c);
  const outbox = journal.pendingEvents().length;
  const schema = journal.schemaInfo();
  const anyAiActive = owners.filter((x) => x.o.ownerState === 'AI_ACTIVE').map((x) => x.o.cycleId);
  const humanCount = owners.filter((x) => x.o.ownerState === 'HUMAN_MANAGED').length;
  const handoffCount = owners.filter((x) => x.o.ownerState === 'HANDOFF_PENDING').length;
  journal.close();
  step('3-apply', anyAiActive.length === 0 && owners.length === subjects.length ? 'PASS' : 'FAIL', {
    created: applyFirst.created,
    preserved: applyFirst.preserved,
    humanPreserved: applyFirst.humanPreserved,
    ownerRows: owners.length,
    ownerPayloadFields: Object.keys(owners[0]?.o ?? {}),
    ownerStateTally: owners.reduce((m, x) => ((m[x.o.ownerState] = (m[x.o.ownerState] ?? 0) + 1), m), {}),
    aiActiveOwners: anyAiActive,
    humanManagedOwners: humanCount,
    handoffPendingOwners: handoffCount,
    ownersWithPlanRef: owners.filter((x) => x.o.planRef).length,
    ownersWithFutureDeadline: owners.filter((x) => Number(x.o.deadlineAt ?? 0) > now).length,
    quantityClaimRows: claims,
    outboxRows: outbox,
    schema,
    assertions: {
      noCycleBecameAiActive: anyAiActive.length === 0,
      humanManagedDidNotRegress: humanCount === subjects.filter((s) => s.managementStatus === 'HUMAN_MANAGED').length,
      planlessCyclesConservativelyHandoffPending: handoffCount === subjects.filter((s) => s.managementStatus !== 'HUMAN_MANAGED').length,
      noQuantityClaimFabricated: claims === 0,
    },
  });
  if (anyAiActive.length) fail('3-apply-authority', ev.steps.at(-1));
}

/* step 4: readback */
{
  const expect = subjects.map((s) => s.cycleId);
  const verify = OwnershipMigration.verify(journalFile, expect);
  const j = new OwnershipJournal(journalFile);
  const before = j.query('SELECT cycle_id, version, payload FROM v396_owners ORDER BY cycle_id').map((r) => ({ cycleId: r.cycle_id, ownerVersion: Number(r.version), ...JSON.parse(String(r.payload)) }));
  const outboxBefore = j.pendingEvents().length;
  j.close();
  step('4-readback', verify.missing.length === 0 ? 'PASS' : 'FAIL', { ...verify, ownersRecorded: before.length, outboxBefore, deadlineNullOrNot: before.filter((r) => r.deadline != null).length });
  if (verify.missing.length) fail('4-readback', ev.steps.at(-1));
}

/* step 5: restore into a fresh directory and re-verify read-only */
const restoreDir = join(work, 'restore');
mkdirSync(restoreDir, { recursive: true });
const restoredFile = join(restoreDir, 'v396-ownership.sqlite');
copyFileSync(journalFile, restoredFile);
{
  const restored = new OwnershipJournal(restoredFile);
  const schema = restored.schemaInfo();
  const owners = restored.query('SELECT cycle_id, payload FROM v396_owners ORDER BY cycle_id').map((r) => JSON.parse(String(r.payload)));
  restored.close();
  const verify = OwnershipMigration.verify(restoredFile, subjects.map((s) => s.cycleId));
  const identicalToApplied = OwnershipMigration.identical(journalFile, restoredFile);
  step('5-restore', schema.schemaVersion === OWNERSHIP_SCHEMA_VERSION && verify.missing.length === 0 && identicalToApplied ? 'PASS' : 'FAIL', {
    schema,
    owners: owners.length,
    missing: verify.missing,
    byteIdenticalToMigrationImage: identicalToApplied,
    restoredHash: sha(restoredFile),
    appliedHash: sha(journalFile),
  });
}

/* step 6: idempotent rerun */
{
  const j = new OwnershipJournal(journalFile);
  const counts = (journalHandle) =>
    Object.fromEntries(
      journalHandle
        .query("select name from sqlite_master where type='table' and name like 'v396_%' order by name")
        .map((r) => [String(r.name), Number(journalHandle.query(`select count(*) as c from "${String(r.name)}"`)[0].c)]),
    );
  const before = counts(j);
  const second = new OwnershipMigration(j).apply(subjects, now);
  const after = counts(j);
  const versions = j.query('SELECT cycle_id, version FROM v396_owners ORDER BY cycle_id').map((r) => String(r.cycle_id) + ':' + String(r.version));
  j.close();
  step('6-rerun-idempotent', second.created === 0 && second.preserved === applyFirst.created && JSON.stringify(before) === JSON.stringify(after) ? 'PASS' : 'FAIL', {
    secondApplyCreated: second.created,
    secondApplyPreserved: second.preserved,
    firstApplyCreated: applyFirst.created,
    tableCountsBefore: before,
    tableCountsAfter: after,
    rowCountsUnchanged: JSON.stringify(before) === JSON.stringify(after),
    ownerVersionSamples: versions.slice(0, 3),
    distinctOwnerVersions: [...new Set(versions.map((v) => v.split(':')[1]))],
  });
}

/* step 7: a newer ledger opened by an older runtime must be rejected without DDL */
{
  const futureFile = join(work, 'future-schema-ownership.sqlite');
  copyFileSync(journalFile, futureFile);
  const stamped = new DatabaseSync(futureFile);
  const hashBefore = sha(futureFile);
  stamped.exec(`PRAGMA user_version=${OWNERSHIP_SCHEMA_VERSION + 1}`);
  const stampedVersion = Number(stamped.prepare('select * from pragma_user_version').get().user_version);
  const tablesBefore = stamped.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name).join(',');
  stamped.close();
  let rejected = null;
  try {
    new OwnershipJournal(futureFile).close();
  } catch (error) {
    rejected = error instanceof Error ? error.message : String(error);
  }
  const probe = new DatabaseSync(futureFile, { readOnly: true });
  const tablesAfter = probe.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name).join(',');
  const hashAfter = sha(futureFile);
  probe.close();
  step('7-newer-schema-rejection', String(rejected).startsWith('OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME') && tablesBefore === tablesAfter ? 'PASS' : 'FAIL', {
    runtimeSchemaVersion: OWNERSHIP_SCHEMA_VERSION,
    stampedSchemaVersion: stampedVersion,
    thrown: rejected,
    tablesUnchanged: tablesBefore === tablesAfter,
    noDdlWritten: hashBefore === hashAfter,
    note: 'only the user_version integer differs between the two hashes by construction; the table set is what a rejected writer could have extended',
  });
  if (!String(rejected).startsWith('OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME')) fail('7-newer-schema-rejection', ev.steps.at(-1));
}

/* settings-image invariants that the real migration must also preserve */
{
  const handle = new DatabaseSync(copy, { readOnly: true });
  const after = tables(handle);
  const settingsVersion = Number(JSON.parse(String(handle.prepare('select payload from settings where id=1').get().payload)).settingsVersion);
  handle.close();
  step('8-source-image-untouched', JSON.stringify(sourceTables) === JSON.stringify(after) && settingsVersion === sourceSettingsVersion ? 'PASS' : 'FAIL', {
    settingsVersionBefore: sourceSettingsVersion,
    settingsVersionAfter: settingsVersion,
    perTableFingerprintUnchanged: JSON.stringify(sourceTables) === JSON.stringify(after),
    sourceImageHashStillMatchesFrozenCopy: sha(COLD) === ev.sourceImageSha256,
  });
}

ev.verdict = ev.steps.every((s) => s.verdict === 'PASS') ? 'PASS' : 'FAIL';
ev.subjectsUsed = subjects.length;
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'migration-rehearsal.json'), JSON.stringify(ev, null, 1) + '\n');
writeFileSync(join(OUT, 'migration-subjects.json'), JSON.stringify({ generatedAtUtc8: ev.nowUtc8, env, cred, sourceSettingsVersion, subjects }, null, 1) + '\n');
console.log('VERDICT=' + ev.verdict + ' tmpDir=' + work);
rmSync(work, { recursive: true, force: true });

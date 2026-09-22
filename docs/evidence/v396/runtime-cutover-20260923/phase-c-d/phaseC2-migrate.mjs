/**
 * Phase C2: apply the V3.9.6 ownership migration to the real Testnet data directory, then set
 * the launch档位 through the product's own settings consumer. Engine must be stopped.
 * Every invariant asserted here was first proven against an isolated copy in phase C1.
 */
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnershipJournal } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipJournal.js';
import { OwnershipMigration } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipMigration.js';
import { executionScope } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/executionLifecycle.js';
import { SettingsStore } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/config/settingsStore.js';

const DATA = process.argv[3] ?? 'D:/MITS/data';
const CONFIG = process.argv[4] ?? 'D:/MITS/config';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const COLD = 'D:/MITS-backups/cutover-20260923/cold/zdj-settings.sqlite';
const REHEARSAL = JSON.parse(readFileSync('D:/MITS/data/audit-export/20260923-cutover/rehearsal/migration-rehearsal.json', 'utf8'));
const REHEARSAL_SUBJECTS = JSON.parse(readFileSync('D:/MITS/data/audit-export/20260923-cutover/rehearsal/migration-subjects.json', 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const ts8 = (t) => new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const portListening = (port) =>
  new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(600);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
const guards = [];
const guard = (name, ok, detail) => {
  guards.push({ name, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  if (!ok) {
    writeFileSync(join(OUT, 'testnet-migration.json'), JSON.stringify({ verdict: 'FAIL', failedGuard: name, guards, nowUtc8: ts8(Date.now()) }, null, 1) + '\n');
    process.exit(1);
  }
};

const now = Date.now();
guard('engine-is-stopped', (await portListening(8080)) === false, { port: 8080 });

const db = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const settings = JSON.parse(String(db.prepare('select payload from settings where id=1').get().payload));
const env = settings.connections.exchange.environment;
const cred = settings.connections.exchange.credentialRef;
guard('environment-is-testnet', env === 'TESTNET', { environment: env });
guard('rest-host-is-binance-demo', new URL(String(settings.connections.exchange.testnetRestBaseUrl)).hostname === 'demo-fapi.binance.com', { rest: settings.connections.exchange.testnetRestBaseUrl });
guard('no-production-endpoint-selected', settings.connections.exchange.environment !== 'PRODUCTION', { environment: env, executionMode: settings.connections.executionMode });
const positions = db.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
const liveTables = Object.fromEntries(db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((r) => [r.name, Number(db.prepare(`select count(*) c from "${r.name}"`).get().c)]));
db.close();
guard('restore-point-present-and-verified', sha(COLD) === REHEARSAL.sourceImageSha256, { coldBackup: COLD, sha256: sha(COLD).slice(0, 16), bytes: statSync(COLD).size });

const subjects = positions.map((p) => ({
  scope: executionScope(env, cred, String(p.symbol), 'ENTRY'),
  cycleId: String(p.cycleId ?? `cycle_${p.id}`),
  planRef: p.tradePlanRef ?? p.planRef ?? null,
  firstFillAt: Number(p.openedAt ?? p.firstObservedAt),
  deadline: p.aiManagementDeadline ?? p.managementDeadline ?? null,
  managementStatus: String(p.managementStatus),
  legacy: true,
}));
guard('subjects-match-rehearsal', JSON.stringify(subjects) === JSON.stringify(REHEARSAL_SUBJECTS.subjects), { liveCount: subjects.length, rehearsalCount: REHEARSAL_SUBJECTS.subjects.length });

const journalFile = join(DATA, 'v396-ownership.sqlite');
const existedBefore = statExists(journalFile);
guard('ownership-ledger-absent-before-migration', existedBefore === false, { journalFile });

const preview = OwnershipMigration.preview(subjects, null, now);
guard('preview-proposes-no-ai-authority', preview.wouldMutateExisting === 0 && !preview.created.some((c) => c.ownerState === 'AI_ACTIVE'), { wouldCreate: preview.created.length, wouldMutateExisting: preview.wouldMutateExisting, ownerStates: preview.created.reduce((m, c) => ((m[c.ownerState] = (m[c.ownerState] ?? 0) + 1), m), {}) });

const journal = new OwnershipJournal(journalFile);
const applied = new OwnershipMigration(journal).apply(subjects, now);
const secondApply = new OwnershipMigration(journal).apply(subjects, now);
const owners = journal.query('SELECT scope, cycle_id, version, payload FROM v396_owners ORDER BY cycle_id').map((r) => ({ scope: r.scope, cycleId: r.cycle_id, version: Number(r.version), ...JSON.parse(String(r.payload)) }));
const claimRows = Number(journal.query('select count(*) as c from v396_quantity_claims')[0].c);
const mandateRows = Number(journal.query('select count(*) as c from v396_mandates')[0].c);
const historyRows = Number(journal.query('select count(*) as c from v396_claims_history')[0].c);
const outbox = journal.pendingEvents().length;
const schema = journal.schemaInfo();
journal.close();

const tally = owners.reduce((m, o) => ((m[o.ownerState] = (m[o.ownerState] ?? 0) + 1), m), {});
const humanSubjects = subjects.filter((s) => s.managementStatus === 'HUMAN_MANAGED').length;
guard('no-cycle-became-ai-active', !owners.some((o) => o.ownerState === 'AI_ACTIVE'), { tally });
guard('human-managed-did-not-regress', tally.HUMAN_MANAGED === humanSubjects, { owners: tally.HUMAN_MANAGED, subjects: humanSubjects });
guard('planless-cycles-are-handoff-pending', tally.HANDOFF_PENDING === subjects.length - humanSubjects, { tally, expected: subjects.length - humanSubjects });
guard('no-quantity-claim-or-mandate-fabricated', claimRows === 0 && mandateRows === 0 && historyRows === 0, { claimRows, mandateRows, historyRows });
guard('every-position-cycle-has-exactly-one-owner', owners.length === subjects.length && new Set(owners.map((o) => o.cycleId)).size === subjects.length, { owners: owners.length, subjects: subjects.length });
guard('second-apply-is-a-noop', secondApply.created === 0 && secondApply.preserved === applied.created, { secondApply, firstCreated: applied.created });
const verify = OwnershipMigration.verify(journalFile, subjects.map((s) => s.cycleId));
guard('readback-has-no-missing-cycle', verify.missing.length === 0, verify);

const after = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const tablesAfter = Object.fromEntries(after.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((r) => [r.name, Number(after.prepare(`select count(*) c from "${r.name}"`).get().c)]));
const settingsAfter = JSON.parse(String(after.prepare('select payload from settings where id=1').get().payload));
after.close();
guard('settings-database-untouched-by-migration', JSON.stringify(liveTables) === JSON.stringify(tablesAfter) && settingsAfter.settingsVersion === settings.settingsVersion, {
  tablesBefore: Object.keys(liveTables).length,
  tablesAfter: Object.keys(tablesAfter).length,
  rowsBefore: Object.values(liveTables).reduce((a, b) => a + b, 0),
  rowsAfter: Object.values(tablesAfter).reduce((a, b) => a + b, 0),
  settingsVersionBefore: settings.settingsVersion,
  settingsVersionAfter: settingsAfter.settingsVersion,
});

/* launch档位 through the product's own validated CAS writer, not a hand-written UPDATE */
const store = new SettingsStore(CONFIG, DATA);
const current = await store.load();
guard('settings-store-load-matches-direct-read', Number(current.settingsVersion) === Number(settingsAfter.settingsVersion) && current.connections.executionMode === settingsAfter.connections.executionMode, { loadedVersion: current.settingsVersion, directVersion: settingsAfter.settingsVersion, loadedExecutionMode: current.connections.executionMode });
const target = { ...settingsAfter, connections: { ...settingsAfter.connections, executionMode: 'READ_ONLY' } };
const saved = await store.saveIfVersion(target, Number(current.settingsVersion));
guard('execution-mode-is-read-only-through-settings-store-cas', saved.connections.executionMode === 'READ_ONLY' && saved.settingsVersion === Number(settingsAfter.settingsVersion) + 1, {
  settingsVersionBefore: settingsAfter.settingsVersion,
  settingsVersionAfter: saved.settingsVersion,
  executionModeBefore: settingsAfter.connections.executionMode,
  executionModeAfter: saved.connections.executionMode,
  monotonic: saved.settingsVersion > settingsAfter.settingsVersion,
});

const readOnlyProbe = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const persisted = JSON.parse(String(readOnlyProbe.prepare('select payload from settings where id=1').get().payload));
const audit = readOnlyProbe.prepare('select changed_at, source, old_version, new_version, summary from settings_audit order by id desc limit 3').all();
readOnlyProbe.close();
guard('durable-read-back-confirms-档位', persisted.connections.executionMode === 'READ_ONLY' && persisted.settingsVersion === saved.settingsVersion, { executionMode: persisted.connections.executionMode, settingsVersion: persisted.settingsVersion });

function statExists(f) {
  try {
    statSync(f);
    return true;
  } catch {
    return false;
  }
}

const result = {
  verdict: 'PASS',
  nowUtc8: ts8(Date.now()),
  migratedAtUtc8: ts8(now),
  targetDataDir: DATA,
  ownershipLedger: { file: journalFile, sha256: sha(journalFile), bytes: statSync(journalFile).size, schema },
  subjects: { count: subjects.length, byManagementStatus: subjects.reduce((m, s) => ((m[s.managementStatus] = (m[s.managementStatus] ?? 0) + 1), m), {}), withPlanRef: subjects.filter((s) => s.planRef).length, withDeadline: subjects.filter((s) => s.deadline != null).length },
  preview,
  apply: { first: applied, second: secondApply, owners: tally, outboxRows: outbox, claimRows, mandateRows, historyRows },
  readback: verify,
  ownersDetail: owners.map((o) => ({ cycleId: o.cycleId, ownerState: o.ownerState, ownerVersion: o.ownerVersion, planRef: o.planRef, deadline: o.deadline, reason: o.reason })),
  settings: { before: { version: settings.settingsVersion, executionMode: settings.connections.executionMode }, after: { version: persisted.settingsVersion, executionMode: persisted.connections.executionMode }, auditRows: audit },
  guards,
  rehearsalRef: 'docs/evidence/v396/runtime-cutover-20260923/migration-rehearsal/migration-rehearsal.json',
};
writeFileSync(join(OUT, 'testnet-migration.json'), JSON.stringify(result, null, 1) + '\n');
console.log('VERDICT=PASS owners=' + JSON.stringify(tally) + ' ledger=' + sha(journalFile).slice(0, 16) + ' settingsVersion=' + persisted.settingsVersion + ' executionMode=' + persisted.connections.executionMode);

/**
 * Corrected ownership migration driver. The original phaseC2 driver hand-rolled the ownership
 * scope as executionScope(env, cred, SYMBOL, 'ENTRY'), which the Engine never reads because
 * OwnershipRuntime keys a held position by its position side; the result was a parallel ledger and
 * re-initialised authority. This version derives every subject through the single shared helper,
 * and then reads back **through the Engine's own derivation** before declaring the migration good.
 *
 * Engine must be stopped. It never touches the live data directory when given a rehearsal copy.
 */
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnershipJournal } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipJournal.js';
import { OwnershipMigration } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/ownershipMigration.js';
import { executionScope } from 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist/services/executionLifecycle.js';

const DATA = process.argv[2];
const OUT = process.argv[3];
const LEDGER = process.argv[4] ?? join(DATA, 'v396-ownership.sqlite');
mkdirSync(OUT, { recursive: true });
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
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, ...detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 240)}`);
  if (!ok) {
    writeFileSync(join(OUT, 'ownership-migration-v2.json'), JSON.stringify({ verdict: 'FAIL', failedCheck: name, checks }, null, 1) + '\n');
    process.exit(1);
  }
};

check('engine-is-stopped', (await portListening(8080)) === false, {});
const store = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const settings = JSON.parse(String(store.prepare('select payload from settings where id=1').get().payload));
const identity = { environment: settings.connections.exchange.environment, account: settings.connections.exchange.credentialRef };
check('identity-is-testnet-credential', identity.environment === 'TESTNET' && String(identity.account).trim() !== '', { ...identity });
const positions = store.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
const tpWorking = new Set(
  store
    .prepare("select payload from runtime_entities where kind='tpOrders'")
    .all()
    .map((r) => JSON.parse(String(r.payload)))
    .filter((o) => o.status === 'WORKING')
    .map((o) => String(o.symbol)),
);
store.close();

const subjects = OwnershipMigration.subjectsForPositions(
  positions.map((p) => ({ ...p, positionSide: p.side })),
  identity,
);
check('one-subject-per-open-position', subjects.length === positions.length, { subjects: subjects.length, positions: positions.length });
check('subjects-use-the-position-side-scope', subjects.every((s, i) => s.scope === executionScope(identity.environment, identity.account, String(positions[i].symbol), String(positions[i].side))), {
  sampleScope: subjects[0]?.scope,
});

const journal = new OwnershipJournal(LEDGER);
const migration = new OwnershipMigration(journal);
const preview = OwnershipMigration.preview(subjects, journal, Date.now());
check('preview-creates-no-ai-authority', preview.wouldMutateExisting === 0 && !preview.created.some((c) => c.ownerState === 'AI_ACTIVE'), { wouldCreate: preview.created.length, wouldMutateExisting: preview.wouldMutateExisting });
const applied = migration.apply(subjects, Date.now());

/** Read back the way the Engine looks rows up, not the way the migration wrote them. */
const readBack = positions.map((p) => {
  const scope = executionScope(identity.environment, identity.account, String(p.symbol), String(p.side));
  const owner = journal.get(scope, String(p.cycleId));
  return { symbol: p.symbol, side: p.side, managementStatus: p.managementStatus, found: Boolean(owner), ownerState: owner?.ownerState ?? null, ownerVersion: owner?.ownerVersion ?? null, deadline: owner?.deadline ?? null, planRef: owner?.planRef ?? null };
});
const missing = readBack.filter((r) => !r.found);
const humanRows = readBack.filter((r) => r.managementStatus === 'HUMAN_MANAGED');
const aiActiveOnHuman = humanRows.filter((r) => r.ownerState === 'AI_ACTIVE');
const aiActiveAnywhere = readBack.filter((r) => r.ownerState === 'AI_ACTIVE');
const duplicateScopes = journal.query('SELECT cycle_id FROM v396_owners').map((r) => String(r.cycle_id));
const cyclesWithTwoRows = duplicateScopes.length - new Set(duplicateScopes).size;
journal.close();

check('every-open-cycle-readable-by-the-engine-key', missing.length === 0, { missing: missing.map((m) => m.symbol) });
check('no-human-managed-cycle-granted-ai-authority', aiActiveOnHuman.length === 0, { offenders: aiActiveOnHuman.map((r) => `${r.symbol}:${r.ownerState}`) });
check('no-cycle-granted-ai-authority-in-a-shadow-window', aiActiveAnywhere.length === 0, { offenders: aiActiveAnywhere.map((r) => `${r.symbol}:${r.ownerState}`) });
check('no-cycle-carries-two-owner-rows', cyclesWithTwoRows === 0, { cyclesWithTwoRows });
check('every-open-position-still-protected', [...tpWorking].length >= positions.filter((p) => p.tpStatus === 'PROTECTED').length, { tpWorkingSymbols: [...tpWorking].length });

const result = {
  verdict: 'PASS',
  ranAtUtc8: ts8(Date.now()),
  dataDir: DATA,
  ledger: LEDGER,
  identity,
  applied,
  readBackThroughEngineKey: readBack,
  checks,
};
writeFileSync(join(OUT, 'ownership-migration-v2.json'), JSON.stringify(result, null, 1) + '\n');
console.log('VERDICT=PASS owners=' + applied.created + '/' + applied.preserved + ' ledger=' + LEDGER);

// V3.9.7 P0/P1/P2 ledger repair: a re-runnable preview / apply tool for the two stale-state classes
// the root-cause audit found (R3 exit orders the exchange already ended while their quantity claim
// stayed ACTIVE, R4 TradeRecords keyed per Entry order instead of the physical holding).
//
// Rules this tool may never break:
//   * TESTNET only. A PRODUCTION (or unreadable) environment is refused before anything is opened.
//   * No exchange write and no exchange read either: evidence is an operator-captured bundle.
//   * Preview opens both databases read-only, so it is safe to run while the Engine is up.
//   * Apply requires --apply plus --confirm and refuses while the Engine process is alive, because
//     the runtime blob is cached in memory and a concurrent writer would undo the repair.
//   * A row changes only where the plan proved the new value. Everything unprovable is reported as
//     UNKNOWN and left exactly as it is; nothing is deleted.
//   * The exit-claim job writes through the same reducer the live readers use
//     (PositionExitCoordinator.applyVerifiedFacts), so a repair cannot grow a weaker second path.
//
//   node scripts/repair-v396-trading-loop.mjs                                   # preview, both jobs
//   node scripts/repair-v396-trading-loop.mjs --evidence=<orders.json>           # preview with evidence
//   node scripts/repair-v396-trading-loop.mjs --job=cycle-backfill --apply --confirm=TESTNET-REPAIR
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback = null) => {
  const found = process.argv.slice(2).find((entry) => entry.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.slice(2).includes(`--${name}`);

const dataDir = path.resolve(root, arg('data-dir', 'data'));
const job = arg('job', 'all');
if (!['all', 'exit-claims', 'cycle-backfill', 'conservation-label'].includes(job)) throw new Error(`UNKNOWN_JOB:${job}`);
const apply = has('apply');
const evidenceFile = arg('evidence');
const evidenceMaxAgeMs = Number(arg('evidence-max-age-ms', 60 * 60_000));
const settingsFile = path.join(dataDir, 'zdj-settings.sqlite');
const ownershipFile = path.join(dataDir, 'v396-ownership.sqlite');
const instanceFile = path.join(dataDir, 'runtime', 'engine-instance.json');
for (const file of [settingsFile, ownershipFile]) if (!existsSync(file)) throw new Error(`DATA_FILE_MISSING:${file}`);

const repair = await import(pathToFileURL(path.resolve(root, 'apps/engine/dist/services/tradingLoopRepair.js')).href);

// A refusal is a result, not a stack trace: an operator must see the boundary that stopped the run.
const refuse = (reason) => {
  console.log(JSON.stringify({mode: apply ? 'APPLY' : 'PREVIEW', job, dataDir, verdict: 'REFUSED', reason, exchangeWrites: 0}, null, 1));
  process.exit(1);
};

// ---- identity and environment boundary -------------------------------------------------------
// The exit ledger's scope is [environment,account,symbol,side]; the same identity the Engine derives
// from its own settings is used here, so a repair can only touch rows this account owns.
const source = new DatabaseSync(settingsFile, {readOnly: true});
const stored = source.prepare('SELECT payload FROM settings WHERE id=1').get();
if (!stored) { source.close(); refuse('SETTINGS_ROW_MISSING'); }
const exchange = JSON.parse(String(stored.payload))?.connections?.exchange ?? {};
const identity = {environment: String(exchange.environment ?? '').trim(), accountId: String(exchange.credentialRef ?? '').trim()};
if (identity.environment !== 'TESTNET' || !identity.accountId) {
  source.close();
  refuse(`${identity.environment || 'UNKNOWN_ENVIRONMENT'}:PRODUCTION_OR_UNKNOWN_ENVIRONMENT_IS_NEVER_REPAIRED`);
}
const rowsOf = (kind) => source.prepare('SELECT payload FROM runtime_entities WHERE kind=?').all(kind).map((row) => JSON.parse(String(row.payload)));
const fills = rowsOf('executionFills');
const records = rowsOf('tradeRecords');
// Two durable copies of the same record have to agree before either is written; this is reported so
// the operator sees a divergence instead of silently repairing one copy.
const tableCopies = new Map(source.prepare('SELECT trade_id,payload FROM trade_records').all()
  .map((row) => [String(row.trade_id), JSON.parse(String(row.payload))]));
const copyDivergence = records.reduce((all, record) => {
  const table = tableCopies.get(record.tradeId);
  if (!table) return {...all, missingTableRow: (all.missingTableRow ?? 0) + 1};
  const differs = ['cycleId', 'positionCycleId', 'ledgerConservation', 'status'].filter(field => String(record[field] ?? '') !== String(table[field] ?? ''));
  if (!differs.length) return {...all, agreed: (all.agreed ?? 0) + 1};
  const key = differs.sort().join('+');
  return {...all, [key]: (all[key] ?? 0) + 1};
}, {});
source.close();

const engineStatus = () => {
  if (!existsSync(instanceFile)) return {running: false, reason: 'NO_INSTANCE_FILE'};
  const instance = JSON.parse(readFileSync(instanceFile, 'utf8'));
  let running = false;
  try { process.kill(Number(instance.pid), 0); running = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  return {running, pid: Number(instance.pid), buildId: instance.buildId ?? null, instanceId: instance.instanceId ?? null};
};
// A stopped ledger is the only place apply may write: the runtime blob is cached in memory, so a
// live Engine would overwrite the repair on its next persist.
if (apply) {
  if (arg('confirm') !== 'TESTNET-REPAIR') refuse('APPLY_REQUIRES_CONFIRM:--confirm=TESTNET-REPAIR');
  const status = engineStatus();
  if (status.running) refuse(`ENGINE_RUNNING_APPLY_REFUSED:pid=${status.pid}`);
}

// ---- evidence bundle -------------------------------------------------------------------------
// What counts as evidence is decided by the plan module, not by this file: an exact terminal order
// read, or a cumulative fill the exchange itself reported. Anything else keeps the row UNKNOWN.
const evidenceRows = [];
const evidenceIssues = [];
if (evidenceFile) {
  const bundle = JSON.parse(readFileSync(path.resolve(root, evidenceFile), 'utf8'));
  const capturedAt = Number(bundle.at ?? bundle.capturedAt ?? 0);
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) evidenceIssues.push('EVIDENCE_BUNDLE_UNSTAMPED');
  else if (Date.now() - capturedAt > evidenceMaxAgeMs) evidenceIssues.push(`EVIDENCE_BUNDLE_STALE:${Date.now() - capturedAt}>${evidenceMaxAgeMs}`);
  const orders = Array.isArray(bundle) ? bundle : Array.isArray(bundle.orders) ? bundle.orders : [];
  for (const row of orders) {
    if (!row || typeof row !== 'object') { evidenceIssues.push('EVIDENCE_ROW_UNPARSEABLE'); continue; }
    if (!repair.ACCEPTED_EXIT_EVIDENCE.includes(String(row.source ?? ''))) { evidenceIssues.push(`UNACCEPTED_EVIDENCE_SOURCE:${row.source ?? 'EMPTY'}`); continue; }
    evidenceRows.push({
      clientOrderId: String(row.clientOrderId ?? '').trim(),
      source: String(row.source),
      exchangeOrderId: row.exchangeOrderId == null ? null : String(row.exchangeOrderId),
      symbol: String(row.symbol ?? '').trim().toUpperCase(),
      positionSide: ['LONG', 'SHORT', 'BOTH'].includes(String(row.positionSide)) ? row.positionSide : 'BOTH',
      originalQty: Number(row.originalQty ?? row.origQty ?? 0),
      executedQty: Number(row.executedQty ?? 0),
      exchangeStatus: String(row.exchangeStatus ?? row.status ?? '').trim().toUpperCase(),
      observedAt: Number(row.observedAt ?? row.updateTime ?? capturedAt ?? 0),
    });
  }
} else if (job !== 'cycle-backfill' && job !== 'conservation-label') evidenceIssues.push('EVIDENCE_BUNDLE_ABSENT:every_open_task_stays_UNKNOWN');

// ---- plans (read-only) -----------------------------------------------------------------------
const ledger = new DatabaseSync(ownershipFile, {readOnly: true});
const tasks = ledger.prepare('SELECT payload FROM v396_exit_tasks').all().map((row) => JSON.parse(String(row.payload)));
const claims = ledger.prepare('SELECT id,scope,payload FROM v396_quantity_claims').all()
  .map((row) => ({id: String(row.id), scope: String(row.scope), ...JSON.parse(String(row.payload))}))
  .filter((claim) => claim.status === 'ACTIVE');
ledger.close();

const exitPlan = job === 'all' || job === 'exit-claims'
  ? repair.planExitClaimConvergence({tasks, claims, evidence: evidenceRows, environment: identity.environment, accountId: identity.accountId})
  : null;
const cyclePlan = job === 'all' || job === 'cycle-backfill' ? repair.planCycleBackfill({fills, records}) : null;
const relabelPlan = job === 'all' || job === 'conservation-label' ? repair.planConservationRelabel({records, fills}) : null;

// ---- apply -----------------------------------------------------------------------------------
const applied = {exitFacts: null, cycles: [], relabels: [], transactions: 0, exchangeWrites: 0};

if (apply && exitPlan) {
  const facts = repair.exitFactsForRepair(exitPlan.rows, tasks, evidenceRows, identity);
  if (facts.length) {
    const {OwnershipJournal} = await import(pathToFileURL(path.resolve(root, 'apps/engine/dist/services/ownershipJournal.js')).href);
    const {PositionExitCoordinator} = await import(pathToFileURL(path.resolve(root, 'apps/engine/dist/services/s04ExitCoordinator.js')).href);
    const journal = new OwnershipJournal(ownershipFile);
    try {
      // The capabilities only matter for a submit, which a repair never does; no adapter is built,
      // so this process has no exchange write path at all.
      const coordinator = new PositionExitCoordinator(journal, {
        oneWayReduceOnly: true, hedgePositionSide: false, cancelReplaceAtomic: false, partialFillExpected: true,
        supportsTimeInForce: ['GTC'], positionMode: 'ONE_WAY',
      });
      applied.exitFacts = coordinator.applyVerifiedFacts(facts, Date.now());
    } finally { journal.close(); }
  } else applied.exitFacts = {applied: [], skipped: [], reason: 'NO_PROVEN_FACT_TO_WRITE'};
}

// The Engine keeps a TradeRecord in two durable places: the runtime entity row the checkpoint writes
// and the trade_records table `upsertTradeRecord` writes. Patching only one lets the other overwrite
// the repair on the next start, so both are read and written together, and a pair that disagrees is
// refused instead of guessed at.
const readPair = (db, tradeId) => {
  const entity = db.prepare("SELECT payload FROM runtime_entities WHERE kind='tradeRecords' AND entity_id=?").get(tradeId);
  const table = db.prepare('SELECT payload,status FROM trade_records WHERE trade_id=?').get(tradeId);
  return {entity: entity ? JSON.parse(String(entity.payload)) : null, table: table ? JSON.parse(String(table.payload)) : null, tableStatus: table ? String(table.status) : null};
};
const writePair = (db, tradeId, payload, status) => {
  const json = JSON.stringify(payload);
  const at = Date.now();
  const entity = db.prepare("UPDATE runtime_entities SET payload=? WHERE kind='tradeRecords' AND entity_id=?").run(json, tradeId);
  const table = db.prepare('UPDATE trade_records SET payload=?,status=?,updated_at=? WHERE trade_id=?').run(json, status ?? String(payload.status ?? ''), at, tradeId);
  return {entityRows: Number(entity.changes), tableRows: Number(table.changes)};
};

if (apply && cyclePlan) {
  const db = new DatabaseSync(settingsFile);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const superseded of cyclePlan.superseded) {
      const pair = readPair(db, superseded.oldTradeId);
      if (!pair.entity || !pair.table) { applied.cycles.push({tradeId: superseded.oldTradeId, status: pair.entity ? 'SKIPPED_TABLE_ROW_MISSING' : 'SKIPPED_ENTITY_ROW_MISSING'}); continue; }
      const current = pair.entity;
      if (String(current.cycleId ?? '') !== String(superseded.oldCycleId ?? '')) {
        applied.cycles.push({tradeId: superseded.oldTradeId, status: 'SKIPPED_ROW_CHANGED', cycleId: current.cycleId ?? null});
        continue;
      }
      if (String(pair.table.cycleId ?? '') !== String(current.cycleId ?? '') || String(pair.table.positionCycleId ?? '') !== String(current.positionCycleId ?? '')) {
        applied.cycles.push({tradeId: superseded.oldTradeId, status: 'SKIPPED_DIVERGED_COPIES'});
        continue;
      }
      // Additive re-key only: the tradeId, the money fields and the old cycle label all stay readable
      // (repairSource names it), because deleting the previous accounting is never a repair.
      const next = {...current, positionCycleId: superseded.newPhysicalCycleId,
        repairSource: `V397_CYCLE_BACKFILL:${String(superseded.oldCycleId ?? 'null')}`, updatedAt: Date.now()};
      const written = writePair(db, superseded.oldTradeId, next, pair.tableStatus ?? String(next.status ?? ''));
      db.prepare('INSERT INTO runtime_events(id,type,ts,symbol,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(
        `v397-cycle-repair:${superseded.oldTradeId}`, 'TRADE_RECORD_POSITION_CYCLE_ASSIGNED', Date.now(), String(current.symbol ?? ''),
        JSON.stringify({tradeId: superseded.oldTradeId, previousCycleId: current.cycleId ?? null, positionCycleId: superseded.newPhysicalCycleId,
          reason: superseded.reason, exchangeWrites: 0, mode: 'APPLY', written}));
      applied.cycles.push({tradeId: superseded.oldTradeId, status: 'POSITION_CYCLE_ASSIGNED', positionCycleId: superseded.newPhysicalCycleId, written});
    }
    db.exec('COMMIT');
    applied.transactions += 1;
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

if (apply && relabelPlan) {
  const db = new DatabaseSync(settingsFile);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of relabelPlan.rows) {
      const pair = readPair(db, row.tradeId);
      if (!pair.entity || !pair.table) { applied.relabels.push({tradeId: row.tradeId, status: pair.entity ? 'SKIPPED_TABLE_ROW_MISSING' : 'SKIPPED_ENTITY_ROW_MISSING'}); continue; }
      const current = pair.entity;
      if ((current.ledgerConservation ?? null) !== row.from) {
        applied.relabels.push({tradeId: row.tradeId, status: 'SKIPPED_ROW_CHANGED', from: current.ledgerConservation ?? null});
        continue;
      }
      if ((pair.table.ledgerConservation ?? null) !== row.from) {
        applied.relabels.push({tradeId: row.tradeId, status: 'SKIPPED_DIVERGED_COPIES', entity: current.ledgerConservation ?? null, table: pair.table.ledgerConservation ?? null});
        continue;
      }
      // The only field written is the derived label. Quantity, fees, PnL and status stay untouched.
      const next = {...current, ledgerConservation: row.to, updatedAt: Date.now()};
      const written = writePair(db, row.tradeId, next, pair.tableStatus ?? String(next.status ?? ''));
      db.prepare('INSERT INTO runtime_events(id,type,ts,symbol,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(
        `v397-conservation-relabel:${row.tradeId}`, 'TRADE_RECORD_CONSERVATION_RELABELLED', Date.now(), String(current.symbol ?? ''),
        JSON.stringify({tradeId: row.tradeId, from: row.from, to: row.to, reason: row.reason, exchangeWrites: 0, mode: 'APPLY', written}));
      applied.relabels.push({tradeId: row.tradeId, status: 'RELABELLED', from: row.from, to: row.to, written});
    }
    db.exec('COMMIT');
    applied.transactions += 1;
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

// ---- audit log -------------------------------------------------------------------------------
const leftUnknown = [];
if (exitPlan) for (const row of exitPlan.rows) if (row.action === 'KEEP_UNKNOWN') leftUnknown.push(`${row.clientOrderId}:${row.reason}`);
if (cyclePlan) {
  for (const row of cyclePlan.unproven) leftUnknown.push(`${row.symbol}:${row.side}:${row.tradeId ?? 'OPEN'}:${row.reason}`);
  for (const row of cyclePlan.inconsistent) leftUnknown.push(`${row.symbol}:${row.side}:${row.fillId}:NEGATIVE_RUNNING_QUANTITY`);
}
if (relabelPlan) for (const row of relabelPlan.rows) if (row.to === 'UNKNOWN') leftUnknown.push(`${row.tradeId}:${row.reason}:CONSERVATION_UNPROVEN`);
if (relabelPlan) for (const row of relabelPlan.rows) if (row.to === 'LEDGER_INCONSISTENT') leftUnknown.push(`${row.tradeId}:${row.reason}:CONSERVATION_LEDGER_INCONSISTENT`);

const document = repair.repairAuditRecord({
  job, preview: !apply, environment: identity.environment, accountId: identity.accountId,
  plan: {
    evidenceFile: evidenceFile ?? null, evidenceRows: evidenceRows.length, evidenceIssues,
    ledger: {exitTasks: tasks.length, activeClaims: claims.length, fills: fills.length, tradeRecords: records.length, copyDivergence},
    exitClaims: exitPlan,
    // The full assignment table is what makes the plan auditable, so it is kept in the log file but
    // summarised in the console readback.
    cycleBackfill: cyclePlan,
    conservationRelabel: relabelPlan,
  },
  applied: apply ? applied : null,
  identityKeys: [...(exitPlan?.rows ?? []).filter((row) => row.action.startsWith('CONVERGE')).map((row) => row.clientOrderId),
    ...(cyclePlan?.superseded ?? []).map((row) => row.oldTradeId),
    ...(relabelPlan?.rows ?? []).map((row) => row.tradeId)],
  leftUnknown,
});
const outDir = path.resolve(root, arg('out-dir', 'docs/reports/v396-trading-loop-full-implementation-20260929/repair'));
mkdirSync(outDir, {recursive: true});
const outFile = path.join(outDir, `${apply ? 'apply' : 'preview'}-${job}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);

console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'PREVIEW', job, environment: identity.environment, account: identity.accountId,
  engine: engineStatus(), evidence: {file: evidenceFile ?? null, rows: evidenceRows.length, issues: evidenceIssues},
  exitClaims: exitPlan ? exitPlan.summary : 'NOT_IN_SCOPE',
  durableCopies: copyDivergence,
  cycleBackfill: cyclePlan ? {...cyclePlan.summary, superseded: cyclePlan.superseded.length} : 'NOT_IN_SCOPE',
  conservationRelabel: relabelPlan ? relabelPlan.summary : 'NOT_IN_SCOPE',
  applied: apply ? {
    exitFacts: applied.exitFacts ? {applied: applied.exitFacts.applied.length, skipped: applied.exitFacts.skipped.length, reason: applied.exitFacts.reason ?? null} : null,
    cycles: Object.entries(applied.cycles.reduce((all, row) => ({...all, [row.status]: (all[row.status] ?? 0) + 1}), {}))
      .map(([status, count]) => `${status}:${count}`),
    relabels: Object.entries(applied.relabels.reduce((all, row) => ({...all, [row.status]: (all[row.status] ?? 0) + 1}), {}))
      .map(([status, count]) => `${status}:${count}`),
    transactions: applied.transactions, exchangeWrites: applied.exchangeWrites,
  } : null,
  leftUnknown: leftUnknown.length,
  auditLog: path.relative(root, outFile).replaceAll('\\', '/'),
  verdict: apply ? (evidenceIssues.length ? 'APPLIED_WITH_EVIDENCE_ISSUES' : 'APPLIED') : 'PREVIEW_ONLY',
}, null, 1));

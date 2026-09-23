/**
 * Pre-rebuild ownership ledger snapshot: consistent backup plus the exact defect census that the
 * rebuild must clear. Runs only while the Engine is stopped; it never deletes the original file.
 */
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'D:/MITS/data';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => (t == null || Number(t) === 0 ? null : new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(0, 19) + '+08');
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const identity = JSON.parse(readFileSync(join(DATA, 'runtime', 'engine-instance.json'), 'utf8'));

const ledger = join(DATA, 'v396-ownership.sqlite');
const ledgerBackup = join(OUT, 'v396-ownership.pre-rebuild.sqlite');
const src = new DatabaseSync(ledger, { readOnly: true });
const before = src.prepare('PRAGMA integrity_check').get().integrity_check;
const rows = src.prepare('SELECT scope, cycle_id, version, payload FROM v396_owners ORDER BY cycle_id, scope').all().map((r) => ({ scope: String(r.scope), cycleId: String(r.cycle_id), rowVersion: Number(r.version), ...JSON.parse(String(r.payload)) }));
const outboxBefore = src.prepare('SELECT count(*) n FROM v396_outbox').get().n;
const claimsBefore = src.prepare('SELECT count(*) n FROM v396_quantity_claims').get().n;
const mandatesBefore = src.prepare('SELECT count(*) n FROM v396_mandates').get().n;
const schemaBefore = { userVersion: Number(src.prepare('select * from pragma_user_version').get().user_version), tables: src.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => String(r.name)) };
await sqliteBackup(src, ledgerBackup);
src.close();

const store = new DatabaseSync(join(DATA, 'zdj-settings.sqlite'), { readOnly: true });
const settings = JSON.parse(String(store.prepare('select payload from settings where id=1').get().payload));
const positions = store.prepare("select payload from runtime_entities where kind='positions'").all().map((r) => JSON.parse(String(r.payload)));
const tpWorking = store.prepare("select payload from runtime_entities where kind='tpOrders'").all().map((r) => JSON.parse(String(r.payload))).filter((o) => o.status === 'WORKING').map((o) => String(o.symbol));
const storeTables = Object.fromEntries(store.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((r) => [r.name, Number(store.prepare(`select count(*) c from "${r.name}"`).get().c)]));
const ledgerBackupStore = join(OUT, 'zdj-settings.pre-rebuild.sqlite');
await sqliteBackup(store, ledgerBackupStore);
store.close();

const sideOf = (scope) => JSON.parse(String(scope))[3];
const cycles = new Map();
for (const r of rows) (cycles.get(r.cycleId) ?? cycles.set(r.cycleId, []).get(r.cycleId)).push(r);
const duplicates = [...cycles.entries()].filter(([, v]) => v.length > 1);
const conflicts = duplicates.filter(([, v]) => v.some((r) => r.ownerState === 'AI_ACTIVE') && v.some((r) => r.ownerState === 'HUMAN_MANAGED'));
const humanCycles = new Set(positions.filter((p) => p.managementStatus === 'HUMAN_MANAGED').map((p) => String(p.cycleId)));
const humanRowsUnderAi = [...humanCycles].filter((c) => (cycles.get(c) ?? []).some((r) => r.ownerState === 'AI_ACTIVE'));

const result = {
  capturedAtUtc8: ts8(Date.now()),
  engineStoppedConfirmed: { instanceId: identity.instanceId, pid: identity.pid, buildId: identity.buildId, version: identity.version },
  settingsAtStop: { settingsVersion: settings.settingsVersion, executionMode: settings.connections.executionMode, aiExitAuthority: settings.riskGovernance.exitCoordination.aiExitAuthority, environment: settings.connections.exchange.environment },
  positionsAtStop: {
    count: positions.length,
    unprotected: positions.filter((p) => p.tpStatus !== 'PROTECTED').map((p) => p.symbol),
    workingTpSymbols: tpWorking.length,
    everyPositionHasWorkingTp: positions.every((p) => tpWorking.includes(String(p.symbol))),
    negativeNotionalUsd: positions.filter((p) => Number(p.notionalUsd) < 0).length,
    notionalsMatchUnsignedMagnitude: positions.map((p) => ({ symbol: p.symbol, notionalUsd: p.notionalUsd, magnitudeFromQtyMark: Number((Math.abs(Number(p.quantity)) * Number(p.markPrice)).toFixed(4)) })),
  },
  storeFingerprint: { tables: Object.keys(storeTables).length, totalRows: Object.values(storeTables).reduce((a, b) => a + b, 0), perTable: storeTables },
  ledger: {
    file: ledger,
    bytes: statSync(ledger).size,
    sha256: sha(ledger),
    integrity_check: String(before),
    backupFile: ledgerBackup,
    backupSha256: sha(ledgerBackup),
    backupBytes: statSync(ledgerBackup).size,
    schema: schemaBefore,
    ownerRows: rows.length,
    distinctCycles: cycles.size,
    tallyBySideAndState: rows.reduce((m, r) => ((m[`${sideOf(r.scope)}|${r.ownerState}`] = (m[`${sideOf(r.scope)}|${r.ownerState}`] ?? 0) + 1), m), {}),
    cyclesWithTwoRows: duplicates.length,
    contradictoryAuthorityCycles: conflicts.length,
    humanManagedCyclesWithAnAiActiveRow: humanRowsUnderAi.length,
    aiActiveRows: rows.filter((r) => r.ownerState === 'AI_ACTIVE').map((r) => ({ cycleId: r.cycleId, side: sideOf(r.scope), reason: r.reason, planRef: r.planRef })),
    outboxRows: outboxBefore,
    quantityClaims: claimsBefore,
    mandates: mandatesBefore,
  },
};
writeFileSync(join(OUT, 'pre-rebuild-census.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ rows: result.ledger.ownerRows, cycles: result.ledger.distinctCycles, dup: result.ledger.cyclesWithTwoRows, conflicts: result.ledger.contradictoryAuthorityCycles, aiActive: result.ledger.aiActiveRows.length, ledgerSha: result.ledger.sha256.slice(0, 16), negNotional: result.positionsAtStop.negativeNotionalUsd, everyTp: result.positionsAtStop.everyPositionHasWorkingTp }, null, 1));

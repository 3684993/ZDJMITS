/**
 * Phase B post-stop freeze: the engine is down, so the durable store is opened once to replay
 * and checkpoint its WAL, then a cold consistent backup is taken with hash and per-table
 * fingerprints. Nothing here starts or restarts the engine.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = 'D:/MITS/data';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => new Date(Number(t) + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const sha256File = async (file) => {
  const h = createHash('sha256');
  await new Promise((res, rej) => {
    createReadStream(file, { highWaterMark: 1 << 22 })
      .on('data', (c) => h.update(c))
      .on('end', res)
      .on('error', rej);
  });
  return h.digest('hex');
};
const tableCounts = (db) =>
  Object.fromEntries(
    db
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
      .all()
      .map((r) => [r.name, Number(db.prepare(`select count(*) n from "${r.name}"`).get().n)]),
  );

const result = { capturedAtUtc8: ts8(Date.now()), engineLifecycleAtCapture: 'STOPPED_BY_AUTHORIZED_MANUAL_STOP', stores: {}, notBackedUp: {} };

for (const file of ['zdj-settings.sqlite', 'v393-evidence.sqlite']) {
  const source = join(LIVE, file);
  const dest = join(OUT, file);
  const sizeOf = (f) => { try { return statSync(f).size } catch { return 0 } };
  const before = { bytes: sizeOf(source), walBytes: sizeOf(source + '-wal') };
  const rw = new DatabaseSync(source, { readOnly: false, open: true });
  const checkpoint = rw.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const journalMode = String(rw.prepare('PRAGMA journal_mode').get().journal_mode);
  const integrity = String(rw.prepare('PRAGMA integrity_check').get().integrity_check);
  const counts = tableCounts(rw);
  const userVersion = Number(rw.prepare('select * from pragma_user_version').get().user_version);
  const hasSettings = rw.prepare("select name from sqlite_master where type='table' and name='settings'").get();
  const settings = hasSettings ? JSON.parse(String(rw.prepare('select payload from settings where id=1').get()?.payload ?? '{}')) : {};
  const fatal = rw.prepare('PRAGMA foreign_key_check').all().length;
  rw.close();
  copyFileSync(source, dest);
  result.stores[file] = {
    before,
    afterCheckpoint: { bytes: sizeOf(source), walBytes: sizeOf(source + '-wal'), walFilePresentAfterClose: existsSync(source + '-wal') },
    walCheckpointResult: { busy: checkpoint.busy, log: checkpoint.log, checkpointed: checkpoint.checkpointed },
    journalMode,
    integrity_check: integrity,
    foreign_key_check_rows: fatal,
    userVersion,
    tables: Object.keys(counts).length,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    perTableRowCounts: counts,
    coldBackupSha256: await sha256File(dest),
    coldBackupBytes: statSync(dest).size,
    liveSha256MatchesBackup: (await sha256File(source)) === (await sha256File(dest)),
    runtimeSettingsVersion: settings?.settingsVersion ?? null,
    exchangeEnvironment: settings?.connections?.exchange?.environment ?? null,
    executionMode: settings?.connections?.executionMode ?? null,
    credentialRef: settings?.connections?.exchange?.credentialRef ?? null,
  };
}

/**
 * The quality store is an append-only evidence database: it is not in the durable migration
 * inventory, so a byte copy is deliberately skipped to preserve disk headroom for the soak.
 */
result.notBackedUp['trading-quality.sqlite'] = {
  bytes: statSync(join(LIVE, 'trading-quality.sqlite')).size,
  walBytes: statSync(join(LIVE, 'trading-quality.sqlite-wal')).size,
  modifiedUtc8: ts8(statSync(join(LIVE, 'trading-quality.sqlite')).mtimeMs),
  reason: 'append-only trading-quality evidence store; outside DURABLE_SQLITE, not read or migrated by the V3.9.6 settings/ownership migration',
  rollbackImplication: 'a V3.9.6 run that appends to this file would not be reverted by restoring zdj-settings.sqlite alone; restore point for it is the hot image taken at 07:38 while WAL was intact',
};

const identity = JSON.parse(readFileSync(join(LIVE, 'runtime', 'engine-instance.json'), 'utf8'));
result.finalIdentity = { ...identity, startedUtc8: ts8(identity.startedAt) };
console.log(JSON.stringify(result, null, 1));
writeFileSync(join(OUT, 'post-stop-fingerprint.json'), JSON.stringify(result, null, 1) + '\n');

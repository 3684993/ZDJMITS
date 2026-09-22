/**
 * Phase B scene freeze: consistent online backups of the durable stores plus hash and
 * per-table row-count fingerprints, taken while the engine is still running (SQLite backup
 * API is the online-consistent path; the live database is opened read-only).
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = 'D:/MITS/data';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const ts8 = (t) => new Date(Number(t) + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + '+08';
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const tableCounts = (db) =>
  Object.fromEntries(
    db
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
      .all()
      .map((r) => [r.name, Number(db.prepare(`select count(*) n from "${r.name}"`).get().n)]),
  );

const RESULT = { capturedAtUtc8: ts8(Date.now()), outDir: OUT, stores: {}, config: {}, notes: [] };

for (const file of ['zdj-settings.sqlite', 'v393-evidence.sqlite']) {
  const source = join(LIVE, file);
  const dest = join(OUT, file);
  const liveBytes = statSync(source).size;
  const walBytes = statSync(source + '-wal').size;
  const src = new DatabaseSync(source, { readOnly: true, open: true });
  const liveCounts = tableCounts(src);
  const liveUserVersion = Number(src.prepare('select * from pragma_user_version').get().user_version);
  const started = Date.now();
  await backup(src, dest);
  src.close();
  const bak = new DatabaseSync(dest, { readOnly: true, open: true });
  const integrity = String(bak.prepare('PRAGMA integrity_check').get().integrity_check);
  const bakCounts = tableCounts(bak);
  const bakUserVersion = Number(bak.prepare('select * from pragma_user_version').get().user_version);
  const diverging = Object.keys(liveCounts).filter((t) => liveCounts[t] !== bakCounts[t]);
  bak.close();
  RESULT.stores[file] = {
    sourceBytes: liveBytes,
    sourceWalBytes: walBytes,
    backupBytes: statSync(dest).size,
    backupSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    backupSha256: sha256(dest),
    integrity_check: integrity,
    userVersionSource: liveUserVersion,
    userVersionBackup: bakUserVersion,
    tablesInSource: Object.keys(liveCounts).length,
    totalRowsSource: Object.values(liveCounts).reduce((a, b) => a + b, 0),
    totalRowsBackup: Object.values(bakCounts).reduce((a, b) => a + b, 0),
    /** A hot backup races the writer: later-arriving rows legitimately raise counts. */
    tablesDivergingFromLiveRead: diverging.map((t) => ({ table: t, live: liveCounts[t], backup: bakCounts[t] })),
    missingOrShrunk: diverging.filter((t) => bakCounts[t] < liveCounts[t]).map((t) => ({ table: t, live: liveCounts[t], backup: bakCounts[t] })),
    perTableRowCounts: liveCounts,
  };
}

for (const file of ['settings.default.json', 'ai-resources.default.json']) {
  const source = join(LIVE, '..', 'config', file);
  copyFileSync(source, join(OUT, 'config--' + file));
  const parsed = JSON.parse(readFileSync(source, 'utf8'));
  RESULT.config[file] = { bytes: statSync(source).size, sha256: sha256(source), topKeys: Object.keys(parsed).join(',') };
}
const identity = JSON.parse(readFileSync(join(LIVE, 'runtime', 'engine-instance.json'), 'utf8'));
RESULT.engineIdentity = { ...identity, startedUtc8: ts8(identity.startedAt) };

console.log(JSON.stringify(RESULT, null, 1));
writeFileSync(join(OUT, 'durable-fingerprint.json'), JSON.stringify(RESULT, null, 1) + '\n');

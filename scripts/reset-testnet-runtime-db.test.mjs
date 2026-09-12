import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('schema-only reset preserves schema/static configuration and never copies runtime history',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'zdj-reset-testnet-')),source=path.join(dir,'source.sqlite'),output=path.join(dir,'fresh.sqlite');let fresh;
 try{
  const db=new DatabaseSync(source);db.exec(`
   CREATE TABLE settings(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE secrets(ref TEXT PRIMARY KEY,ciphertext TEXT NOT NULL);
   CREATE TABLE connection_profiles(id TEXT PRIMARY KEY,profile TEXT NOT NULL);
   CREATE TABLE exchange_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE proxy_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE ai_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
   CREATE TABLE settings_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,summary TEXT NOT NULL);
   CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE runtime_events(id TEXT PRIMARY KEY,ts INTEGER NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE trade_records(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE INDEX idx_runtime_events_ts ON runtime_events(ts);
   CREATE VIEW recent_runtime_events AS SELECT id,ts FROM runtime_events WHERE ts>0;
   CREATE TRIGGER runtime_events_no_empty BEFORE INSERT ON runtime_events WHEN NEW.id='' BEGIN SELECT RAISE(ABORT,'empty id'); END;
   INSERT INTO settings VALUES(1,'{"mode":"TESTNET"}');
   INSERT INTO secrets VALUES('binance','encrypted');
   INSERT INTO connection_profiles VALUES('default','{"proxy":true}');
   INSERT INTO exchange_resources VALUES('binance','{}');
   INSERT INTO proxy_resources VALUES('proxy','{}');
   INSERT INTO ai_resources VALUES('primary','{}');
   INSERT INTO schema_migrations VALUES(1,1);
   INSERT INTO settings_audit(summary) VALUES('old');
   INSERT INTO runtime_state VALUES(1,'{"position":"old"}');
   INSERT INTO runtime_events VALUES('event',1,printf('%.*c',1048576,'x'));
   INSERT INTO trade_records VALUES('trade','{"old":true}');
  `);db.close();
  const before=statSync(source),result=spawnSync(process.execPath,[path.resolve('scripts/reset-testnet-runtime-db.mjs'),`--source=${source}`,`--output=${output}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);assert.equal(existsSync(output),true);assert.equal(statSync(source).size,before.size);assert.equal(statSync(source).mtimeMs,before.mtimeMs);
  const report=JSON.parse(readFileSync(`${output}.verification.json`,'utf8'));assert.equal(report.status,'FRESH_TESTNET_DB_READY_NOT_INSTALLED');assert.equal(report.strategy,'SCHEMA_ONLY_REBUILD');assert.equal(report.originalPreserved,true);assert.equal(report.autoVacuum,'INCREMENTAL');assert.equal(report.capacityPolicy.entryBlockMiB,1280);assert.ok(report.outputBytes<report.sourceBytes/4,`${report.outputBytes} should be far smaller than ${report.sourceBytes}`);
  fresh=new DatabaseSync(output,{readOnly:true});
  assert.equal(fresh.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(fresh.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(fresh.prepare('SELECT payload FROM settings WHERE id=1').get().payload,'{"mode":"TESTNET"}');assert.equal(fresh.prepare('SELECT ciphertext FROM secrets').get().ciphertext,'encrypted');
  for(const table of ['settings_audit','runtime_state','runtime_events','trade_records'])assert.equal(Number(fresh.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0);
  assert.equal(Number(fresh.prepare('PRAGMA auto_vacuum').get().auto_vacuum),2);
  const objects=fresh.prepare("SELECT type,name FROM sqlite_master WHERE name IN ('idx_runtime_events_ts','recent_runtime_events','runtime_events_no_empty') ORDER BY name").all().map(row=>`${row.type}:${row.name}`);assert.deepEqual(objects,['index:idx_runtime_events_ts','view:recent_runtime_events','trigger:runtime_events_no_empty'].sort());
 }finally{fresh?.close();rmSync(dir,{recursive:true,force:true});}
});

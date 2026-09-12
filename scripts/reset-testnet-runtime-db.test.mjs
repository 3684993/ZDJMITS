import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('reset-testnet-runtime-db preserves static configuration and clears runtime facts',()=>{
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
   CREATE TABLE runtime_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE trade_records(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   INSERT INTO settings VALUES(1,'{"mode":"TESTNET"}');
   INSERT INTO secrets VALUES('binance','encrypted');
   INSERT INTO connection_profiles VALUES('default','{"proxy":true}');
   INSERT INTO exchange_resources VALUES('binance','{}');
   INSERT INTO proxy_resources VALUES('proxy','{}');
   INSERT INTO ai_resources VALUES('primary','{}');
   INSERT INTO schema_migrations VALUES(1,1);
   INSERT INTO settings_audit(summary) VALUES('old');
   INSERT INTO runtime_state VALUES(1,'{"position":"old"}');
   INSERT INTO runtime_events VALUES('event','{"old":true}');
   INSERT INTO trade_records VALUES('trade','{"old":true}');
  `);db.close();
  const before=statSync(source).size,result=spawnSync(process.execPath,[path.resolve('scripts/reset-testnet-runtime-db.mjs'),`--source=${source}`,`--output=${output}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);assert.equal(existsSync(output),true);assert.equal(statSync(source).size,before);
  const report=JSON.parse(readFileSync(`${output}.verification.json`,'utf8'));assert.equal(report.status,'FRESH_TESTNET_DB_READY_NOT_INSTALLED');assert.equal(report.originalPreserved,true);assert.equal(report.autoVacuum,'INCREMENTAL');assert.equal(report.capacityPolicy.entryBlockMiB,1280);
  fresh=new DatabaseSync(output,{readOnly:true});
  assert.equal(fresh.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(fresh.prepare('SELECT payload FROM settings WHERE id=1').get().payload,'{"mode":"TESTNET"}');assert.equal(fresh.prepare('SELECT ciphertext FROM secrets').get().ciphertext,'encrypted');
  for(const table of ['settings_audit','runtime_state','runtime_events','trade_records'])assert.equal(Number(fresh.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0);
  assert.equal(Number(fresh.prepare('PRAGMA auto_vacuum').get().auto_vacuum),2);
 }finally{fresh?.close();rmSync(dir,{recursive:true,force:true});}
});

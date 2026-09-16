import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readdirSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

test('V3.9.3 init preserves static configuration and removes active local trading history',()=>{
 const data=mkdtempSync(path.join(os.tmpdir(),'zdj-v393-init-')),live=path.join(data,'zdj-settings.sqlite');let fresh;
 try{
  const db=new DatabaseSync(live);db.exec(`
   CREATE TABLE settings(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE secrets(ref TEXT PRIMARY KEY,ciphertext TEXT NOT NULL);
   CREATE TABLE connection_profiles(id TEXT PRIMARY KEY,profile TEXT NOT NULL);
   CREATE TABLE exchange_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE proxy_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE ai_resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
   CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE runtime_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE trade_records(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE experience_samples(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE manual_executions(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE entry_executions(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   INSERT INTO settings VALUES(1,'{"leverage":20}');
   INSERT INTO secrets VALUES('binance','encrypted');
   INSERT INTO connection_profiles VALUES('default','{"proxy":true}');
   INSERT INTO exchange_resources VALUES('binance','{}');
   INSERT INTO proxy_resources VALUES('proxy','{}');
   INSERT INTO ai_resources VALUES('primary','{"model":"qwen3.8-27b"}');
   INSERT INTO schema_migrations VALUES(1,1);
   INSERT INTO runtime_state VALUES(1,'{"positions":[1]}');
   INSERT INTO runtime_events VALUES('event','{}');
   INSERT INTO trade_records VALUES('trade','{}');
   INSERT INTO experience_samples VALUES('sample','{}');
   INSERT INTO manual_executions VALUES('manual','{}');
   INSERT INTO entry_executions VALUES('entry','{}');
  `);db.close();
  for(const name of ['trading-quality.sqlite','v393-evidence.sqlite','v393-experiment-manifest.json'])writeFileSync(path.join(data,name),'old');
  const result=spawnSync(process.execPath,[path.resolve('scripts/init-local-runtime.mjs'),`--data-dir=${data}`],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  fresh=new DatabaseSync(live,{readOnly:true});
  assert.equal(fresh.prepare('SELECT payload FROM settings').get().payload,'{"leverage":20}');
  assert.equal(fresh.prepare('SELECT ciphertext FROM secrets').get().ciphertext,'encrypted');
  assert.equal(fresh.prepare('SELECT payload FROM ai_resources').get().payload,'{"model":"qwen3.8-27b"}');
  for(const table of ['runtime_state','runtime_events','trade_records','experience_samples','manual_executions','entry_executions'])assert.equal(Number(fresh.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),0,table);
  for(const name of ['trading-quality.sqlite','v393-evidence.sqlite','v393-experiment-manifest.json'])assert.equal(existsSync(path.join(data,name)),false,name);
  const archives=readdirSync(path.join(data,'init-archive'));assert.equal(archives.length,1);
  const report=JSON.parse(readFileSync(path.join(data,'init-archive',archives[0],'init-report.json'),'utf8'));
  assert.equal(report.status,'V393_LOCAL_INIT_COMPLETE');assert.equal(report.exchangeWrites,false);assert.equal(report.exchangeOrdersCanceled,false);assert.equal(report.exchangePositionsClosed,false);
 }finally{fresh?.close();rmSync(data,{recursive:true,force:true});}
});

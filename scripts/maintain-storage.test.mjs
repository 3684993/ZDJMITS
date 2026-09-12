import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
const script=path.resolve('scripts/maintain-storage.mjs');
function fixture(){const dir=mkdtempSync(path.join(tmpdir(),'zdj-offline-')),file=path.join(dir,'source.sqlite'),db=new DatabaseSync(file),old=Date.now()-120*86400000;
 db.exec("CREATE TABLE runtime_events(id TEXT PRIMARY KEY,type TEXT,ts INTEGER,payload TEXT);CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,payload TEXT);CREATE TABLE trade_records(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE entry_execution_tasks(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE ai_runs_archive(run_id TEXT PRIMARY KEY,started_at INTEGER,status TEXT,payload TEXT);CREATE TABLE decision_chains(chain_id TEXT PRIMARY KEY,updated_at INTEGER,status TEXT,payload TEXT);");
 for(const [id,type,payload] of [['noise','PRIVATE_SYNC_COMPLETED',{}],['same','POSITION_LIFECYCLE_TRANSITION',{transition:'UNCHANGED'}],['change','POSITION_LIFECYCLE_TRANSITION',{transition:'CLOSE'}],['unknown','NEW_FUTURE_TP_FACT',{}],['manual','MANUAL_ACTION_COMPLETED',{}],['filled','ENTRY_FILLED',{}]])db.prepare('INSERT INTO runtime_events VALUES(?,?,?,?)').run(id,type,old,JSON.stringify(payload));
 db.prepare('INSERT INTO runtime_events VALUES(?,?,?,?)').run('legacy-bad','POSITION_LIFECYCLE_TRANSITION',old,'{legacy malformed json');
 db.prepare('INSERT INTO decision_chains VALUES(?,?,?,?)').run('legacy-chain',old,'CLOSED','{legacy malformed chain');
 db.exec(`INSERT INTO runtime_state VALUES(1,'{"position":"open","tp":"working"}');INSERT INTO trade_records VALUES('trade','{"fill":2}');INSERT INTO entry_execution_tasks VALUES('task','{"clientOrderId":"stable"}')`);
 db.prepare('INSERT INTO ai_runs_archive VALUES(?,?,?,?)').run('raw',Date.now()-20*86400000,'COMPLETED','{"raw":"payload"}');db.close();return{dir,file};}
function run(file,args=[],injection){return spawnSync(process.execPath,[...(injection?['--import',`data:text/javascript,${encodeURIComponent(injection)}`]:[]),script,`--db=${file}`,...args],{encoding:'utf8'});}
for(const mode of ['dry','build','alias','existing','wal','disk','delete-failure','vacuum-failure','publish-lock','corrupt-copy','crash'])test(`offline maintenance preserves source: ${mode}`,()=>{
 const {dir,file}=fixture(),output=file+'.compact';let original=readFileSync(file),injection;const args=mode==='dry'?[]:['--apply','--engine-stopped'];
 try{
  if(mode==='alias')args.push(`--compact=${file}`);
  if(mode==='existing')writeFileSync(output,'do-not-overwrite');
  if(mode==='wal')writeFileSync(file+'-wal','uncheckpointed');
  if(mode==='delete-failure'){const db=new DatabaseSync(file);db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON runtime_events BEGIN SELECT RAISE(ABORT,'injected failure');END");db.close();original=readFileSync(file);}
  if(mode==='disk')injection="import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.statfsSync=()=>({bavail:0,bsize:4096});syncBuiltinESMExports();";
  if(mode==='publish-lock')injection="import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';fs.linkSync=()=>{throw new Error('EACCES simulated Windows lock')};syncBuiltinESMExports();";
  if(mode==='vacuum-failure'||mode==='crash'||mode==='corrupt-copy')injection=`import{DatabaseSync}from'node:sqlite';const old=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(sql.startsWith('VACUUM INTO')){${mode==='crash'?"process.exit(23)":mode==='vacuum-failure'?"throw new Error('injected VACUUM failure')":"old.call(this,sql);const output=sql.slice(13,-1);const corrupt=new DatabaseSync(output);corrupt.exec(\"UPDATE trade_records SET payload='corrupted'\");corrupt.close();return"}}return old.call(this,sql);};`;
  const result=run(file,args,injection);assert.deepEqual(readFileSync(file),original,result.stderr);
  if(mode==='dry'||mode==='build')assert.equal(result.status,0,result.stderr);else assert.notEqual(result.status,0);
  if(mode==='build'){const db=new DatabaseSync(output,{readOnly:true});assert.deepEqual(db.prepare('SELECT id FROM runtime_events ORDER BY id').all().map(r=>r.id),['change','filled','legacy-bad','manual','unknown']);assert.equal(db.prepare('SELECT payload FROM ai_runs_archive').get().payload,'{}');assert.equal(db.prepare("SELECT payload FROM decision_chains WHERE chain_id='legacy-chain'").get().payload,'{legacy malformed chain');db.close();assert.ok(existsSync(output+'.verification.json'));}
  else if(mode==='existing')assert.equal(readFileSync(output,'utf8'),'do-not-overwrite');else assert.equal(existsSync(output),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('backup pruning requires an explicit verified baseline and keeps it even when it is oldest',()=>{
 const {dir,file}=fixture(),older=path.join(dir,'baseline.sqlite');let db=new DatabaseSync(older);db.exec('CREATE TABLE facts(id PRIMARY KEY)');db.close();
 const prune=path.resolve('scripts/prune-zdj-backups.mjs'),runPrune=(args)=>spawnSync(process.execPath,[prune,`--dir=${dir}`,...args],{encoding:'utf8'});
 try{const bytes=readFileSync(older);assert.equal(runPrune([]).status,0);assert.ok(existsSync(file));assert.notEqual(runPrune(['--apply']).status,0);
  assert.notEqual(runPrune([`--baseline=${older}`,'--apply']).status,0);assert.ok(existsSync(file));
  const result=runPrune([`--baseline=${older}`,'--apply','--engine-stopped','--replacement-verified']);assert.equal(result.status,0,result.stderr);assert.deepEqual(readFileSync(older),bytes);assert.equal(existsSync(file),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('AI quality treats missing outcomes as missing and does not promote PLACE-only samples',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'zdj-quality-')),file=path.join(dir,'quality.sqlite'),db=new DatabaseSync(file);
 db.exec('CREATE TABLE decision_episodes(symbol,decided_at,direction,decision,return_15m,return_1h,return_4h,return_24h,mfe,mae,decision_json,outcome_status)');
 for(let i=0;i<50;i++)db.prepare('INSERT INTO decision_episodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('BTCUSDT',Date.now(),'LONG','PLACE_LONG',null,null,null,null,null,null,'{"confidence":0.8}','PENDING');db.close();
 try{const result=spawnSync(process.execPath,[path.resolve('scripts/audit-ai-entry-quality.mjs'),`--db=${file}`],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.groups.PLACE_LONG.return1h.samples,0);assert.equal(report.groups.PLACE_LONG.return1h.mean,null);assert.equal(report.acceptance.status,'INSUFFICIENT_SAMPLE');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('valid WAL is copied and replayed only on the working database',()=>{
 const {dir,file}=fixture(),writer=new DatabaseSync(file);writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;INSERT INTO trade_records VALUES('wal-fact','committed-only-in-wal')");
 const original=readFileSync(file),wal=readFileSync(file+'-wal'),shm=readFileSync(file+'-shm');
 try{const result=run(file,['--apply','--engine-stopped']);assert.equal(result.status,0,result.stderr);assert.deepEqual(readFileSync(file),original);assert.deepEqual(readFileSync(file+'-wal'),wal);assert.deepEqual(readFileSync(file+'-shm'),shm);
 const compact=new DatabaseSync(file+'.compact',{readOnly:true});assert.equal(compact.prepare("SELECT payload FROM trade_records WHERE id='wal-fact'").get().payload,'committed-only-in-wal');compact.close();
 }finally{writer.close();rmSync(dir,{recursive:true,force:true});}
});

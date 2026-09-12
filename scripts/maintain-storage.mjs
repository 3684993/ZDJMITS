#!/usr/bin/env node
import {copyFileSync,constants,existsSync,mkdtempSync,rmSync,statSync,statfsSync,openSync,readSync,closeSync,fsyncSync,linkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Source is never opened by SQLite (even a read-only WAL connection can create sidecars).
// --apply builds a verified replacement only. Installation is a separate, explicit offline action.
const args=process.argv.slice(2),apply=args.includes('--apply');
const option=(name,fallback)=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const dbPath=path.resolve(option('db','data/zdj-settings.sqlite'));
const compactPath=path.resolve(option('compact',`${dbPath}.compact`));
const day=86_400_000,now=Date.now();
if(!existsSync(dbPath))throw new Error(`DB_NOT_FOUND:${dbPath}`);
if(apply&&!args.includes('--engine-stopped'))throw new Error('ENGINE_STOPPED_CONFIRMATION_REQUIRED');
if(dbPath.toLowerCase()===compactPath.toLowerCase())throw new Error('SOURCE_OUTPUT_ALIAS');
if(apply&&existsSync(compactPath))throw new Error('OUTPUT_ALREADY_EXISTS');
function assertOffline(){
  if(existsSync(dbPath+'-journal'))throw new Error('SOURCE_ROLLBACK_JOURNAL_PRESENT');
  if(existsSync(dbPath+'-wal')&&statSync(dbPath+'-wal').size){
    const header=Buffer.alloc(32),fd=openSync(dbPath+'-wal','r');try{readSync(fd,header,0,32,0);}finally{closeSync(fd);}
    const pageSize=header.readUInt32BE(8),size=statSync(dbPath+'-wal').size;
    if(![0x377f0682,0x377f0683].includes(header.readUInt32BE(0))||pageSize<512||pageSize>65536||(pageSize&(pageSize-1))||size<32||(size-32)%(pageSize+24)!==0)throw new Error('SOURCE_WAL_INVALID');
  }
}
function fileHash(file){const hash=createHash('sha256'),fd=openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{closeSync(fd);}}
function integrity(db){const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||rows[0].integrity_check!=='ok')throw new Error('SQLITE_INTEGRITY_FAILED');if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('SQLITE_FOREIGN_KEY_CHECK_FAILED');}
function quote(name){return `"${name.replaceAll('"','""')}"`;}
const telemetry=['SHADOW_SAMPLE_RECORDED','CANDIDATE_RANKING_SHADOW','POOL_UPDATED','POOL_SUPPLY_HEALTH','ASSET_ADMISSION_EVALUATED','UNIVERSE_UPDATED','MARKET_FRESHNESS_RECOVERED','MARKET_FRESHNESS_RECOVERY','AI_RUN_STARTED','AI_RUN_COMPLETED','CAPITAL_ROUTE_EVALUATED','PRIVATE_SYNC_STARTED','PRIVATE_SYNC_COMPLETED','RECONCILIATION_COMPLETED','MARKET_TARGETED_REFRESHED','MARKET_SLOW_FIELDS_REFRESHED'];
const telemetrySql=`COALESCE((type IN (${telemetry.map(t=>`'${t}'`).join(',')}) OR (type='POSITION_LIFECYCLE_TRANSITION' AND json_valid(payload) AND json_extract(payload,'$.transition')='UNCHANGED')),0)`;
assertOffline();
const originalBytes=statSync(dbPath).size,walBytes=existsSync(dbPath+'-wal')?statSync(dbPath+'-wal').size:0,space=statfsSync(path.dirname(compactPath)),requiredBytes=(originalBytes+walBytes)*(apply?3:2)+256*1024**2;
if(Number(space.bavail)*Number(space.bsize)<requiredBytes)throw new Error(`INSUFFICIENT_DISK_SPACE:need=${requiredBytes}`);
const sourceHash=fileHash(dbPath),sourceWalHash=existsSync(dbPath+'-wal')?fileHash(dbPath+'-wal'):null;
const sourceUnchanged=()=>fileHash(dbPath)===sourceHash&&(existsSync(dbPath+'-wal')?fileHash(dbPath+'-wal'):null)===sourceWalHash;
const workDir=mkdtempSync(path.join(path.dirname(compactPath),'.zdj-storage-')),workPath=path.join(workDir,'work.sqlite'),output=path.join(workDir,'replacement.sqlite');
let db;
try{
  copyFileSync(dbPath,workPath,constants.COPYFILE_EXCL);
  if(sourceWalHash!==null)copyFileSync(dbPath+'-wal',workPath+'-wal',constants.COPYFILE_EXCL);
  assertOffline();if(fileHash(workPath)!==sourceHash||(sourceWalHash!==null&&fileHash(workPath+'-wal')!==sourceWalHash)||!sourceUnchanged())throw new Error('SOURCE_CHANGED_DURING_COPY');
  db=new DatabaseSync(workPath);db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');integrity(db);
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>String(r.name));
  const policies=[
    ['decision_snapshots','created_at',7,'1'],
    ['decision_chains','updated_at',14,"status IN ('OPEN','WAITING_PRICE','CLOSED') AND NOT EXISTS (SELECT 1 FROM json_each(decision_chains.payload,'$.events') e WHERE json_extract(e.value,'$.type') GLOB '*ORDER*' OR json_extract(e.value,'$.type') GLOB '*FILL*' OR json_extract(e.value,'$.type') GLOB '*TP_*' OR json_extract(e.value,'$.type') GLOB '*MANUAL*')"],
    ['ai_runs_archive','started_at',90,"status IN ('COMPLETED','FAILED','CANCELED')"],
    ['external_research_tasks','updated_at',7,"status IN ('COMPLETED','FAILED','EXPIRED')"],
    ['external_intelligence_snapshots','expires_at',7,'1'],
    ['shadow_mark_series','ts',30,'1'],['regime_samples','sample_at',90,'1'],
    ['runtime_events','ts',1,telemetrySql],
  ].filter(([table])=>tables.includes(table)).map(([table,column,days,extra])=>({table,where:`${column}<${now-days*day} AND (${extra})`}));
  const mutable=new Set(policies.map(p=>p.table));
  const hashRows=(table,where='1')=>{let count=0;const hash=createHash('sha256'),columns=db.prepare(`PRAGMA table_info(${quote(table)})`).all().filter(r=>r.pk).sort((a,b)=>a.pk-b.pk).map(r=>quote(String(r.name)));if(!columns.length)columns.push('rowid');for(const row of db.prepare(`SELECT * FROM ${quote(table)} WHERE ${where} ORDER BY ${columns.join(',')}`).iterate()){hash.update(JSON.stringify(row,(_k,v)=>typeof v==='bigint'?String(v):v));hash.update('\n');count++;}return{count,sha256:hash.digest('hex')};};
  // Unknown tables are protected by default. Detect cascades, triggers and state changes, not only row counts.
  const protectedFacts=()=>Object.fromEntries(tables.filter(t=>!mutable.has(t)&&t!=='storage_retention_state').map(t=>[t,hashRows(t)]).concat(tables.includes('runtime_events')?[['critical_runtime_events',hashRows('runtime_events',`NOT ${telemetrySql}`)]]:[]));
  const before=protectedFacts();
  const plan=policies.map(p=>({...p,rows:Number(db.prepare(`SELECT COUNT(*) n FROM ${quote(p.table)} WHERE ${p.where}`).get().n)}));
  console.log(JSON.stringify({mode:apply?'BUILD_REPLACEMENT':'DRY_RUN',dbPath,sourceHash,sourceWalHash,originalBytes,compactPath,requiredBytes,policies:plan,protectedFacts:before},null,2));
  if(apply){
    // Replace the unsafe old trigger only on the disposable copy.
    db.exec('DROP TRIGGER IF EXISTS zdj_hourly_storage_retention');
    for(const p of policies){const statement=db.prepare(`DELETE FROM ${quote(p.table)} WHERE rowid IN (SELECT rowid FROM ${quote(p.table)} WHERE ${p.where} LIMIT 1000)`);while(statement.run().changes){} }
    if(tables.includes('ai_runs_archive')){
      const statement=db.prepare(`UPDATE ai_runs_archive SET payload='{}' WHERE rowid IN (SELECT rowid FROM ai_runs_archive WHERE started_at<${now-14*day} AND status IN ('COMPLETED','FAILED','CANCELED') AND payload<>'{}' LIMIT 1000)`);while(statement.run().changes){}
    }
    integrity(db);if(JSON.stringify(protectedFacts())!==JSON.stringify(before))throw new Error('PROTECTED_FACTS_CHANGED');
    db.exec(`VACUUM INTO '${output.replaceAll("'","''")}'`);db.close();db=new DatabaseSync(output,{readOnly:true});integrity(db);
    if(JSON.stringify(protectedFacts())!==JSON.stringify(before))throw new Error('COMPACT_PROTECTED_FACTS_CHANGED');
    db.close();db=undefined;assertOffline();if(!sourceUnchanged())throw new Error('SOURCE_CHANGED_DURING_MAINTENANCE');
    const fd=openSync(output,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}
    const report={status:'COMPACT_READY_NOT_REPLACED',dbPath,sourceHash,sourceWalHash,compactPath,compactHash:fileHash(output),compactBytes:statSync(output).size,integrity:'ok',protectedFacts:before,originalPreserved:true};
    // Hard link publishes the complete file atomically and refuses to overwrite any existing path.
    linkSync(output,compactPath);
    writeFileSync(`${compactPath}.verification.json`,JSON.stringify(report,null,2),{flag:'wx'});
    console.log(JSON.stringify(report,null,2));
  }
}finally{
  db?.close();
  // Only this invocation's generated directory is removed; the source and backups are never cleanup targets.
  if(path.dirname(workDir)===path.dirname(compactPath)&&path.basename(workDir).startsWith('.zdj-storage-'))rmSync(workDir,{recursive:true,force:true});
}

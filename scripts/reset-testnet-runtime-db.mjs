#!/usr/bin/env node
import {existsSync,mkdtempSync,rmSync,statSync,openSync,readSync,closeSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const args=process.argv.slice(2),option=(name,fallback)=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const source=path.resolve(option('source','data/zdj-settings.sqlite.compact'));
const output=path.resolve(option('output','data/zdj-settings.sqlite.fresh'));
if(!existsSync(source))throw new Error(`SOURCE_NOT_FOUND:${source}`);
if(existsSync(output)||existsSync(`${output}.verification.json`))throw new Error(`OUTPUT_ALREADY_EXISTS:${output}`);
if(source.toLowerCase()===output.toLowerCase())throw new Error('SOURCE_OUTPUT_ALIAS');
for(const sidecar of [`${source}-wal`,`${source}-shm`])if(existsSync(sidecar)&&statSync(sidecar).size>0)throw new Error(`SOURCE_NOT_STANDALONE:${sidecar}`);

const preserved=new Set(['settings','secrets','connection_profiles','exchange_resources','proxy_resources','ai_resources','schema_migrations']);
const hashFile=file=>{const h=createHash('sha256'),fd=openSync(file,'r'),b=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}};
const qi=name=>`"${String(name).replaceAll('"','""')}"`;
const json=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):Buffer.isBuffer(v)?{type:'Buffer',data:[...v]}:v);
const schemaRows=db=>db.prepare("SELECT type,name,tbl_name,COALESCE(sql,'') sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name").all().map(row=>({type:String(row.type),name:String(row.name),tbl_name:String(row.tbl_name),sql:String(row.sql)}));
const schemaHash=db=>{const h=createHash('sha256');for(const row of schemaRows(db))h.update(json(row)+'\n');return h.digest('hex');};
const hashRows=(db,table)=>{const h=createHash('sha256'),pk=db.prepare(`PRAGMA table_info(${qi(table)})`).all().filter(r=>r.pk).sort((a,b)=>a.pk-b.pk).map(r=>qi(r.name));let count=0;for(const row of db.prepare(`SELECT * FROM ${qi(table)} ORDER BY ${pk.length?pk.join(','):'rowid'}`).iterate()){h.update(json(row)+'\n');count++;}return{count,sha256:h.digest('hex')};};
const integrity=db=>{const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||rows[0].integrity_check!=='ok')throw new Error('SQLITE_INTEGRITY_FAILED');const foreign=db.prepare('PRAGMA foreign_key_check').all();if(foreign.length)throw new Error(`SQLITE_FOREIGN_KEY_CHECK_FAILED:${foreign.length}`);};
const sourceStat=statSync(source),sourceHash=hashFile(source),verificationPath=`${source}.verification.json`;
if(existsSync(verificationPath)){
 const verification=JSON.parse(readFileSync(verificationPath,'utf8'));
 if(verification.status!=='COMPACT_READY_NOT_REPLACED')throw new Error(`SOURCE_VERIFICATION_STATUS_INVALID:${verification.status}`);
 if(verification.compactHash&&verification.compactHash!==sourceHash)throw new Error('SOURCE_VERIFICATION_HASH_MISMATCH');
}

const workDir=mkdtempSync(path.join(path.dirname(output),'.zdj-reset-')),work=path.join(workDir,'fresh.sqlite');
let src,dst,verify;
try{
 src=new DatabaseSync(source,{readOnly:true});integrity(src);
 const tables=src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name));
 for(const required of preserved)if(!tables.includes(required))throw new Error(`PRESERVED_TABLE_MISSING:${required}`);
 const beforeSchema=schemaHash(src),beforePreserved=Object.fromEntries([...preserved].sort().map(table=>[table,hashRows(src,table)])),objects=schemaRows(src);

 dst=new DatabaseSync(work);dst.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=OFF; PRAGMA auto_vacuum=INCREMENTAL;');
 const tableObjects=objects.filter(row=>row.type==='table'),secondaryObjects=objects.filter(row=>row.type!=='table');
 dst.exec('BEGIN IMMEDIATE');
 try{
  for(const row of tableObjects)dst.exec(row.sql);
  for(const table of [...preserved].sort()){
   const columns=src.prepare(`PRAGMA table_xinfo(${qi(table)})`).all().filter(row=>Number(row.hidden??0)===0).map(row=>String(row.name));
   if(!columns.length)continue;
   const names=columns.map(qi).join(','),insert=dst.prepare(`INSERT INTO ${qi(table)}(${names}) VALUES(${columns.map(()=>'?').join(',')})`);
   for(const row of src.prepare(`SELECT ${names} FROM ${qi(table)}`).iterate())insert.run(...columns.map(column=>row[column]));
  }
  for(const row of secondaryObjects)dst.exec(row.sql);
  dst.exec('COMMIT');
 }catch(error){dst.exec('ROLLBACK');throw error;}
 dst.exec('PRAGMA foreign_keys=ON');integrity(dst);
 if(schemaHash(dst)!==beforeSchema)throw new Error('OUTPUT_SCHEMA_CHANGED');
 const outputPreserved=Object.fromEntries([...preserved].sort().map(table=>[table,hashRows(dst,table)]));if(json(outputPreserved)!==json(beforePreserved))throw new Error('OUTPUT_STATIC_CONFIGURATION_CHANGED');
 for(const table of tables.filter(table=>!preserved.has(table)))if(Number(dst.prepare(`SELECT COUNT(*) n FROM ${qi(table)}`).get().n)!==0)throw new Error(`RUNTIME_ROWS_REMAIN:${table}`);
 const autoVacuum=Number(dst.prepare('PRAGMA auto_vacuum').get().auto_vacuum);if(autoVacuum!==2)throw new Error(`INCREMENTAL_VACUUM_NOT_APPLIED:${autoVacuum}`);
 dst.exec('PRAGMA optimize');dst.close();dst=undefined;src.close();src=undefined;

 verify=new DatabaseSync(work,{readOnly:true});integrity(verify);if(schemaHash(verify)!==beforeSchema)throw new Error('REOPEN_SCHEMA_CHANGED');
 const reopenedPreserved=Object.fromEntries([...preserved].sort().map(table=>[table,hashRows(verify,table)]));if(json(reopenedPreserved)!==json(beforePreserved))throw new Error('REOPEN_STATIC_CONFIGURATION_CHANGED');
 if(Number(verify.prepare('PRAGMA auto_vacuum').get().auto_vacuum)!==2)throw new Error('REOPEN_INCREMENTAL_VACUUM_NOT_PERSISTED');verify.close();verify=undefined;

 const endStat=statSync(source);if(endStat.size!==sourceStat.size||endStat.mtimeMs!==sourceStat.mtimeMs)throw new Error('SOURCE_CHANGED_DURING_RESET');
 renameSync(work,output);
 const report={status:'FRESH_TESTNET_DB_READY_NOT_INSTALLED',strategy:'SCHEMA_ONLY_REBUILD',source,sourceHash,sourceBytes:sourceStat.size,output,outputHash:hashFile(output),outputBytes:statSync(output).size,integrity:'ok',autoVacuum:'INCREMENTAL',schemaHash:beforeSchema,preservedTables:[...preserved].sort(),preservedFacts:beforePreserved,clearedTables:tables.filter(table=>!preserved.has(table)),capacityPolicy:{warningMiB:512,pressureMiB:768,shedMiB:1024,entryBlockMiB:1280,hardReserveMiB:1792},originalPreserved:true};
 writeFileSync(`${output}.verification.json`,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
}finally{verify?.close();dst?.close();src?.close();rmSync(workDir,{recursive:true,force:true});}

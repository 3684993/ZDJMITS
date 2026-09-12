#!/usr/bin/env node
import {copyFileSync,existsSync,mkdtempSync,rmSync,statSync,openSync,readSync,closeSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const args=process.argv.slice(2),option=(name,fallback)=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const source=path.resolve(option('source','data/zdj-settings.sqlite.compact'));
const output=path.resolve(option('output','data/zdj-settings.sqlite.fresh'));
const hardMaxMiB=Math.max(512,Math.min(8192,Number(option('hard-max-mib','2048'))||2048));
if(!existsSync(source))throw new Error(`SOURCE_NOT_FOUND:${source}`);
if(existsSync(output))throw new Error(`OUTPUT_ALREADY_EXISTS:${output}`);
if(source.toLowerCase()===output.toLowerCase())throw new Error('SOURCE_OUTPUT_ALIAS');
const preserved=new Set(['settings','secrets','connection_profiles','exchange_resources','proxy_resources','ai_resources','schema_migrations']);
const hashFile=file=>{const h=createHash('sha256'),fd=openSync(file,'r'),b=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}};
const qi=name=>`"${String(name).replaceAll('"','""')}"`;
const workDir=mkdtempSync(path.join(path.dirname(output),'.zdj-reset-')),work=path.join(workDir,'work.sqlite'),vacuumed=path.join(workDir,'fresh.sqlite');
let db;
try{
 const sourceHash=hashFile(source);copyFileSync(source,work);
 db=new DatabaseSync(work);db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
 const integrity=()=>{const r=db.prepare('PRAGMA integrity_check').all();if(r.length!==1||r[0].integrity_check!=='ok')throw new Error('SQLITE_INTEGRITY_FAILED');if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('SQLITE_FOREIGN_KEY_CHECK_FAILED');};integrity();
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>String(r.name));
 for(const required of preserved)if(!tables.includes(required))throw new Error(`PRESERVED_TABLE_MISSING:${required}`);
 const hashRows=table=>{const h=createHash('sha256'),pk=db.prepare(`PRAGMA table_info(${qi(table)})`).all().filter(r=>r.pk).sort((a,b)=>a.pk-b.pk).map(r=>qi(r.name));let count=0;for(const row of db.prepare(`SELECT * FROM ${qi(table)} ORDER BY ${pk.length?pk.join(','):'rowid'}`).iterate()){h.update(JSON.stringify(row,(_k,v)=>typeof v==='bigint'?String(v):v)+'\n');count++;}return{count,sha256:h.digest('hex')};};
 const schemaHash=()=>{const h=createHash('sha256');for(const row of db.prepare("SELECT type,name,tbl_name,COALESCE(sql,'') sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").iterate())h.update(JSON.stringify(row)+'\n');return h.digest('hex');};
 const beforeSchema=schemaHash(),beforePreserved=Object.fromEntries([...preserved].sort().map(t=>[t,hashRows(t)]));
 db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
 try{for(const table of tables)if(!preserved.has(table))db.exec(`DELETE FROM ${qi(table)}`);if(tables.includes('settings_audit'))db.exec('DELETE FROM sqlite_sequence');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 db.exec('PRAGMA foreign_keys=ON');integrity();
 if(schemaHash()!==beforeSchema)throw new Error('SCHEMA_CHANGED_DURING_RESET');
 const afterPreserved=Object.fromEntries([...preserved].sort().map(t=>[t,hashRows(t)]));if(JSON.stringify(beforePreserved)!==JSON.stringify(afterPreserved))throw new Error('STATIC_CONFIGURATION_CHANGED');
 const nonStaticCounts=Object.fromEntries(tables.filter(t=>!preserved.has(t)).map(t=>[t,Number(db.prepare(`SELECT COUNT(*) n FROM ${qi(t)}`).get().n)]));if(Object.values(nonStaticCounts).some(Number))throw new Error('RUNTIME_ROWS_REMAIN');
 // A fresh runtime DB must be able to return free pages during bounded retention;
 // otherwise DELETEs only create a growing freelist and the file never shrinks.
 db.exec('PRAGMA auto_vacuum=INCREMENTAL');
 db.exec(`VACUUM INTO '${vacuumed.replaceAll("'","''")}'`);db.close();db=undefined;
 db=new DatabaseSync(vacuumed);db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');integrity();
 const autoVacuum=Number(db.prepare('PRAGMA auto_vacuum').get().auto_vacuum);if(autoVacuum!==2)throw new Error(`INCREMENTAL_VACUUM_NOT_APPLIED:${autoVacuum}`);
 const pageSize=Number(db.prepare('PRAGMA page_size').get().page_size),hardMaxPages=Math.floor(hardMaxMiB*1024*1024/pageSize),actualMaxPages=Number(db.prepare(`PRAGMA max_page_count=${hardMaxPages}`).get().max_page_count);if(actualMaxPages!==hardMaxPages)throw new Error(`MAX_PAGE_COUNT_NOT_APPLIED:${actualMaxPages}`);
 if(schemaHash()!==beforeSchema)throw new Error('OUTPUT_SCHEMA_CHANGED');
 const outputPreserved=Object.fromEntries([...preserved].sort().map(t=>[t,hashRows(t)]));if(JSON.stringify(beforePreserved)!==JSON.stringify(outputPreserved))throw new Error('OUTPUT_STATIC_CONFIGURATION_CHANGED');integrity();db.close();db=undefined;
 renameSync(vacuumed,output);
 const report={status:'FRESH_TESTNET_DB_READY_NOT_INSTALLED',source,sourceHash,sourceBytes:statSync(source).size,output,outputHash:hashFile(output),outputBytes:statSync(output).size,integrity:'ok',autoVacuum:'INCREMENTAL',preservedTables:[...preserved].sort(),preservedFacts:beforePreserved,clearedTables:tables.filter(t=>!preserved.has(t)),nonStaticCounts,hardMaxMiB,hardMaxPages,originalPreserved:hashFile(source)===sourceHash};
 writeFileSync(`${output}.verification.json`,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
}finally{db?.close();rmSync(workDir,{recursive:true,force:true});}

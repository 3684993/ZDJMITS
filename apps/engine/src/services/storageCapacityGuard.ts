import {existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const MiB=1024*1024;
export const STORAGE_LIMITS={warningBytes:512*MiB,pressureBytes:768*MiB,shedBytes:1024*MiB,entryBlockBytes:1280*MiB,hardReserveBytes:1792*MiB,physicalMaxBytes:2048*MiB} as const;
export const STORAGE_ROW_CAPS={decisionSnapshots:5000,analysisChains:5000,aiRawRuns:1000,aiArchiveRows:20000,nonCriticalRuntimeEvents:20000,shadowMarks:20000,externalResearchTasks:5000} as const;
export type StorageCapacityStatus='AVAILABLE'|'WARNING'|'PRESSURED'|'SHEDDING'|'ENTRY_BLOCKED'|'HARD_RESERVE';
export type StorageCapacityHealth={status:StorageCapacityStatus;dbPath:string;dbBytes:number;walBytes:number;totalBytes:number;limits:typeof STORAGE_LIMITS;checkedAt:number};
let cache:StorageCapacityHealth|null=null,lastMaintenanceAt=0;
const dataDir=()=>process.env.ZDJ_DATA_DIR?path.resolve(process.env.ZDJ_DATA_DIR):path.resolve('data');
export function storageCapacityHealth(force=false):StorageCapacityHealth{
 const now=Date.now();if(!force&&cache&&now-cache.checkedAt<1000)return cache;
 const dbPath=path.join(dataDir(),'zdj-settings.sqlite'),walPath=dbPath+'-wal',dbBytes=existsSync(dbPath)?statSync(dbPath).size:0,walBytes=existsSync(walPath)?statSync(walPath).size:0,totalBytes=dbBytes+walBytes;
 const status:StorageCapacityStatus=totalBytes>=STORAGE_LIMITS.hardReserveBytes?'HARD_RESERVE':totalBytes>=STORAGE_LIMITS.entryBlockBytes?'ENTRY_BLOCKED':totalBytes>=STORAGE_LIMITS.shedBytes?'SHEDDING':totalBytes>=STORAGE_LIMITS.pressureBytes?'PRESSURED':totalBytes>=STORAGE_LIMITS.warningBytes?'WARNING':'AVAILABLE';
 return cache={status,dbPath,dbBytes,walBytes,totalBytes,limits:STORAGE_LIMITS,checkedAt:now};
}
export function storageEntryBlockReason(){maintainStorageBounds();const h=storageCapacityHealth(true);return h.totalBytes>=STORAGE_LIMITS.entryBlockBytes?`SQLITE_CAPACITY_${h.status}:${h.totalBytes}`:null;}
export function storageShouldShedNonCritical(){return storageCapacityHealth().totalBytes>=STORAGE_LIMITS.shedBytes;}
const protectedEvent=`(type GLOB '*ORDER*' OR type GLOB '*FILL*' OR type GLOB 'TP_*' OR type GLOB 'MANUAL*' OR type GLOB 'TRADE_RECORD*' OR type IN ('ENTRY_SUBMIT_ATTEMPTED','ENTRY_INTENT_CREATED','ENTRY_FILLED'))`;
const analysisChain=`json_valid(payload) AND NOT EXISTS (SELECT 1 FROM json_each(payload,'$.events') e WHERE json_extract(e.value,'$.type') GLOB '*ORDER*' OR json_extract(e.value,'$.type') GLOB '*FILL*' OR json_extract(e.value,'$.type') GLOB 'TP_*' OR json_extract(e.value,'$.type') GLOB 'MANUAL*')`;
/** Bounded housekeeping: one small batch per class, never touches active state/order/fill/TP tables. */
export function maintainStorageBounds(now=Date.now()){
 if(now-lastMaintenanceAt<5000)return;lastMaintenanceAt=now;const file=path.join(dataDir(),'zdj-settings.sqlite');if(!existsSync(file))return;
 let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=25; PRAGMA foreign_keys=ON;');const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>String(r.name))),batch=250;
  const trim=(table:string,cap:number,order:string,where='1')=>{if(!tables.has(table))return 0;const n=Number((db!.prepare(`SELECT COUNT(*) n FROM "${table}" WHERE ${where}`).get() as any).n),excess=Math.min(batch,Math.max(0,n-cap));if(!excess)return 0;return Number(db!.prepare(`DELETE FROM "${table}" WHERE rowid IN (SELECT rowid FROM "${table}" WHERE ${where} ORDER BY ${order} LIMIT ?)` ).run(excess).changes);};
  db.exec('BEGIN IMMEDIATE');
  try{
   trim('decision_snapshots',STORAGE_ROW_CAPS.decisionSnapshots,'created_at ASC,rowid ASC');
   trim('decision_chains',STORAGE_ROW_CAPS.analysisChains,'updated_at ASC,rowid ASC',analysisChain);
   if(tables.has('ai_runs_archive')){
    db.prepare(`UPDATE ai_runs_archive SET payload='{}' WHERE rowid IN (SELECT rowid FROM ai_runs_archive WHERE status IN ('COMPLETED','FAILED','CANCELED') AND payload<>'{}' AND rowid NOT IN (SELECT rowid FROM ai_runs_archive WHERE status IN ('COMPLETED','FAILED','CANCELED') ORDER BY started_at DESC LIMIT ${STORAGE_ROW_CAPS.aiRawRuns}) ORDER BY started_at ASC LIMIT ${batch})`).run();
    trim('ai_runs_archive',STORAGE_ROW_CAPS.aiArchiveRows,'started_at ASC,rowid ASC',"status IN ('COMPLETED','FAILED','CANCELED') AND payload='{}'");
   }
   trim('runtime_events',STORAGE_ROW_CAPS.nonCriticalRuntimeEvents,'ts ASC,rowid ASC',`NOT ${protectedEvent}`);
   trim('shadow_mark_series',STORAGE_ROW_CAPS.shadowMarks,'ts ASC,rowid ASC');
   trim('external_research_tasks',STORAGE_ROW_CAPS.externalResearchTasks,'updated_at ASC,rowid ASC',"status IN ('COMPLETED','FAILED','EXPIRED')");
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const free=Number((db.prepare('PRAGMA freelist_count').get() as any).freelist_count??0);if(free>256)db.exec('PRAGMA incremental_vacuum(256)');
 }catch{/* Existing critical writers win. A later bounded pass retries; capacity guard remains fail-closed for new Entry. */}
 finally{db?.close();cache=null;}
}
export function resetStorageCapacityGuardForTest(){cache=null;lastMaintenanceAt=0;}

import {existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {STORAGE_MAINTENANCE_WORKER_SOURCE} from './storageMaintenanceWorkerSource.js';

const MiB=1024*1024;
export const STORAGE_LIMITS={warningBytes:512*MiB,pressureBytes:768*MiB,shedBytes:1024*MiB,entryBlockBytes:1280*MiB,hardReserveBytes:1792*MiB} as const;
export const STORAGE_ROW_CAPS={decisionSnapshots:5000,analysisChains:5000,executionChains:10000,aiRawRuns:1000,aiArchiveRows:20000,nonCriticalRuntimeEvents:20000,criticalRuntimeEvents:50000,shadowMarks:20000,externalResearchTasks:5000,decisionEpisodes:20000,stateChangeObservations:20000,regimeSamples:5000,closedTrades:10000,inactiveEntryExecutions:10000,inactiveManualExecutions:5000,experienceSamples:5000} as const;
export type StorageCapacityStatus='AVAILABLE'|'WARNING'|'PRESSURED'|'SHEDDING'|'ENTRY_BLOCKED'|'HARD_RESERVE';
export type StorageCapacityHealth={status:StorageCapacityStatus;dbPath:string;dbBytes:number;walBytes:number;totalBytes:number;limits:typeof STORAGE_LIMITS;checkedAt:number;maintenance:{running:boolean;lastResult:unknown;completedAt:number|null}};
let cache:StorageCapacityHealth|null=null,lastMaintenanceAt=0;
const dataDir=()=>process.env.ZDJ_DATA_DIR?path.resolve(process.env.ZDJ_DATA_DIR):path.resolve('data');
export function storageCapacityHealth(force=false):StorageCapacityHealth{
 const now=Date.now();if(!force&&cache&&now-cache.checkedAt<1000)return cache;
 const dbPath=path.join(dataDir(),'zdj-settings.sqlite'),walPath=dbPath+'-wal',dbBytes=existsSync(dbPath)?statSync(dbPath).size:0,walBytes=existsSync(walPath)?statSync(walPath).size:0,totalBytes=dbBytes+walBytes;
 const status:StorageCapacityStatus=totalBytes>=STORAGE_LIMITS.hardReserveBytes?'HARD_RESERVE':totalBytes>=STORAGE_LIMITS.entryBlockBytes?'ENTRY_BLOCKED':totalBytes>=STORAGE_LIMITS.shedBytes?'SHEDDING':totalBytes>=STORAGE_LIMITS.pressureBytes?'PRESSURED':totalBytes>=STORAGE_LIMITS.warningBytes?'WARNING':'AVAILABLE';
 return cache={status,dbPath,dbBytes,walBytes,totalBytes,limits:STORAGE_LIMITS,checkedAt:now,maintenance:{running:maintenance!==null,lastResult:maintenanceOutcome,completedAt:maintenanceCompletedAt}};
}
export function storageEntryBlockReason(){const h=storageCapacityHealth(true);return h.totalBytes>=STORAGE_LIMITS.entryBlockBytes?`SQLITE_CAPACITY_${h.status}:${h.totalBytes}`:null;}
export function storageShouldShedNonCritical(){return storageCapacityHealth().totalBytes>=STORAGE_LIMITS.shedBytes;}
const protectedEvent=`(type GLOB '*ORDER*' OR type GLOB '*FILL*' OR type GLOB 'TP_*' OR type GLOB 'MANUAL*' OR type GLOB 'TRADE_RECORD*' OR type IN ('ENTRY_SUBMIT_ATTEMPTED','ENTRY_INTENT_CREATED','ENTRY_FILLED'))`;
const analysisChain=`json_valid(payload) AND NOT EXISTS (SELECT 1 FROM json_each(payload,'$.events') e WHERE json_extract(e.value,'$.type') GLOB '*ORDER*' OR json_extract(e.value,'$.type') GLOB '*FILL*' OR json_extract(e.value,'$.type') GLOB 'TP_*' OR json_extract(e.value,'$.type') GLOB 'MANUAL*')`;
/** The runtime database is a bounded recovery store, not a permanent history warehouse. */
let maintenance:Promise<unknown>|null=null;
let maintenanceOutcome:unknown=null,maintenanceCompletedAt:number|null=null;
/** Admission and HTTP reads only inspect capacity. One bounded maintenance worker
 * runs from the scheduler; it retains the existing caps and critical-row policy. */
export function maintainStorageBounds(now=Date.now()):Promise<unknown>{
 if(maintenance)return maintenance;
 if(now-lastMaintenanceAt<5000)return Promise.resolve({status:'NOT_DUE'});
 lastMaintenanceAt=now;const directory=dataDir();
 if(!existsSync(path.join(directory,'zdj-settings.sqlite')))return Promise.resolve({status:'NO_DATABASE'});
 const worker=new Worker(STORAGE_MAINTENANCE_WORKER_SOURCE,{eval:true,workerData:{dataDir:directory,now,caps:STORAGE_ROW_CAPS,protectedEvent,analysisChain}});
 worker.unref();
 maintenance=new Promise((resolve)=>{
  let done=false;
  const finish=(result:unknown)=>{if(done)return;done=true;clearTimeout(deadline);cache=null;maintenance=null;maintenanceOutcome=result;maintenanceCompletedAt=Date.now();resolve(result);};
  const deadline=setTimeout(()=>{void worker.terminate().finally(()=>finish({status:'RETRY',error:'STORAGE_MAINTENANCE_DEADLINE'}));},30_000);deadline.unref();
  worker.once('message',finish);
  worker.once('error',error=>finish({status:'RETRY',error:String(error)}));
  worker.once('exit',code=>finish({status:'RETRY',error:`STORAGE_MAINTENANCE_EXIT:${code}`}));
 });
 worker.unref();
 return maintenance;
}
export function resetStorageCapacityGuardForTest(){cache=null;lastMaintenanceAt=0;maintenanceOutcome=null;maintenanceCompletedAt=null;}

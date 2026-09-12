import {existsSync,statSync} from 'node:fs';
import path from 'node:path';

const MiB=1024*1024;
export const STORAGE_LIMITS={warningBytes:512*MiB,pressureBytes:768*MiB,shedBytes:1024*MiB,entryBlockBytes:1280*MiB,hardReserveBytes:1792*MiB,physicalMaxBytes:2048*MiB} as const;
export type StorageCapacityStatus='AVAILABLE'|'WARNING'|'PRESSURED'|'SHEDDING'|'ENTRY_BLOCKED'|'HARD_RESERVE';
export type StorageCapacityHealth={status:StorageCapacityStatus;dbPath:string;dbBytes:number;walBytes:number;totalBytes:number;limits:typeof STORAGE_LIMITS;checkedAt:number};
let cache:StorageCapacityHealth|null=null;
const dataDir=()=>process.env.ZDJ_DATA_DIR?path.resolve(process.env.ZDJ_DATA_DIR):path.resolve('data');
export function storageCapacityHealth(force=false):StorageCapacityHealth{
 const now=Date.now();if(!force&&cache&&now-cache.checkedAt<1000)return cache;
 const dbPath=path.join(dataDir(),'zdj-settings.sqlite'),walPath=dbPath+'-wal',dbBytes=existsSync(dbPath)?statSync(dbPath).size:0,walBytes=existsSync(walPath)?statSync(walPath).size:0,totalBytes=dbBytes+walBytes;
 const status:StorageCapacityStatus=totalBytes>=STORAGE_LIMITS.hardReserveBytes?'HARD_RESERVE':totalBytes>=STORAGE_LIMITS.entryBlockBytes?'ENTRY_BLOCKED':totalBytes>=STORAGE_LIMITS.shedBytes?'SHEDDING':totalBytes>=STORAGE_LIMITS.pressureBytes?'PRESSURED':totalBytes>=STORAGE_LIMITS.warningBytes?'WARNING':'AVAILABLE';
 return cache={status,dbPath,dbBytes,walBytes,totalBytes,limits:STORAGE_LIMITS,checkedAt:now};
}
export function storageEntryBlockReason(){const h=storageCapacityHealth();return h.totalBytes>=STORAGE_LIMITS.entryBlockBytes?`SQLITE_CAPACITY_${h.status}:${h.totalBytes}`:null;}
export function storageShouldShedNonCritical(){return storageCapacityHealth().totalBytes>=STORAGE_LIMITS.shedBytes;}
export function resetStorageCapacityGuardForTest(){cache=null;}

import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,rmSync,truncateSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {resetStorageCapacityGuardForTest,storageCapacityHealth,storageEntryBlockReason,storageShouldShedNonCritical} from './storageCapacityGuard.js';
const prior=process.env.ZDJ_DATA_DIR;let dir='';
afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});dir='';if(prior===undefined)delete process.env.ZDJ_DATA_DIR;else process.env.ZDJ_DATA_DIR=prior;resetStorageCapacityGuardForTest();});
function size(mib:number){dir=mkdtempSync(path.join(os.tmpdir(),'zdj-storage-guard-'));process.env.ZDJ_DATA_DIR=dir;truncateSync(path.join(dir,'zdj-settings.sqlite'),mib*1024*1024);resetStorageCapacityGuardForTest();}
it('allows new entry below capacity warning',()=>{size(64);expect(storageCapacityHealth(true).status).toBe('AVAILABLE');expect(storageEntryBlockReason()).toBeNull();expect(storageShouldShedNonCritical()).toBe(false);});
it('sheds noncritical persistence before blocking new entry',()=>{size(1050);expect(storageCapacityHealth(true).status).toBe('SHEDDING');expect(storageShouldShedNonCritical()).toBe(true);expect(storageEntryBlockReason()).toBeNull();});
it('blocks new entry with large reserve before the physical max',()=>{size(1300);expect(storageCapacityHealth(true).status).toBe('ENTRY_BLOCKED');expect(storageEntryBlockReason()).toContain('SQLITE_CAPACITY_ENTRY_BLOCKED');});

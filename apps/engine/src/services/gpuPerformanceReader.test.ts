import {describe,it,expect,vi} from 'vitest';
import {createGpuPerformanceReader} from './gpuPerformanceReader.js';
const sample=(asOf=100000,instanceId='sidecar')=>({schemaVersion:1,asOf,instanceId,sampleSource:'WINDOWS_WDDM_PROCESS_COUNTERS',ttlMs:45000,services:[{resourceId:'llama:8084',port:8084,pid:123,processStartedAt:1,duty:'PRIMARY_BRAIN',luid:['0x00000000_0x0000f452'],measureStatus:'MEASURED',utilizationPct:76,dedicatedBytes:16000000000,sharedBytes:0,physicalDeviceIdVerified:false,physicalDeviceId:null}]});
describe('bounded passive GPU snapshot reader',()=>{
 it('fails closed for absent or relative operational paths, without reading the source checkout',async()=>{
  const r=createGpuPerformanceReader({file:'relative/gpu-snapshot.json'});
  expect(await r.read()).toMatchObject({measureStatus:'UNKNOWN',reason:'GPU_SNAPSHOT_ABSOLUTE_PATH_NOT_CONFIGURED',services:[]});
 });
 it('coalesces reads and expires values, retains history without stale live green',async()=>{let now=100000;const readText=vi.fn(async()=>JSON.stringify(sample()));const r=createGpuPerformanceReader({now:()=>now,readText});const values=await Promise.all(Array.from({length:20},()=>r.read()));expect(readText).toHaveBeenCalledTimes(1);expect(values[0].services[0].utilizationPct).toBe(76);now+=46000;expect((await r.read()).services[0]).toMatchObject({utilizationPct:null,measureStatus:'STALE'});});
 it('rejects future, huge, malformed, injected physical attribution and port identities',async()=>{for(const value of [sample(200000),{...sample(),services:[{...sample().services[0],physicalDeviceIdVerified:true}]},{...sample(),services:[{...sample().services[0],resourceId:'arbitrary'}]},'x'.repeat(65537)]){const r=createGpuPerformanceReader({now:()=>100000,readText:async()=>typeof value==='string'?value:JSON.stringify(value)});expect((await r.read()).measureStatus).toBe('UNKNOWN');}});
 it('cuts history at sidecar instance changes, rejects regressions and strips unknown fields',async()=>{let now=100000,value:any={...sample(),secret:'never publish'};const r=createGpuPerformanceReader({now:()=>now,readText:async()=>JSON.stringify(value)});expect(JSON.stringify(await r.read())).not.toContain('secret');now+=10000;value=sample(90000);expect((await r.read()).measureStatus).toBe('UNKNOWN');now+=10000;value=sample(now,'new');expect((await r.read()).history).toHaveLength(1);});
});

import {describe,it,expect} from 'vitest';
import {createHostPerformanceSampler,type HostPerformanceDeps} from './hostPerformanceSampler.js';
describe('hostPerformanceSampler',()=>{
  function fixture(){
    let at=1_000,idle=400,total=1_000,mem=1_000;
    const deps:HostPerformanceDeps={
      now:()=>at,cpus:()=>[{times:{user:total-idle,nice:0,sys:0,idle,irq:0}}],
      totalmem:()=>mem,freemem:()=>mem/4,memoryUsage:()=>({rss:400,heapUsed:100,heapTotal:200,external:10,arrayBuffers:0}),pid:123,
    };
    return{deps,advance:(ms:number,work:number,idleWork:number)=>{at+=ms;total+=work;idle+=idleWork;},invalidMem:()=>{mem=-1;}};
  }
  it('never invents CPU utilization from one tick, keeps real memory evidence',()=>{
    const f=fixture(),sampler=createHostPerformanceSampler(f.deps),first=sampler.read();
    expect(first.cpu).toMatchObject({usagePct:null,status:'UNKNOWN'});
    expect(first.memory).toMatchObject({totalBytes:1000,usedBytes:750,status:'MEASURED'});
    expect(first.engine).toMatchObject({pid:123,rssBytes:400});
    f.advance(10_000,500,100);
    const second=sampler.read();
    expect(second.cpu).toMatchObject({usagePct:80,status:'MEASURED',intervalMs:10000});
    expect(second.history).toHaveLength(2);
    expect(second.instanceId).toBe(first.instanceId);
  });
  it('deduplicates hot reads and caps history without fake interpolation',()=>{
    const f=fixture(),sampler=createHostPerformanceSampler(f.deps,{intervalMs:1000,capacity:2});
    const original=sampler.read();f.advance(300,100,30);
    expect(sampler.read().asOf).toBe(original.asOf);
    f.advance(1000,100,20);sampler.read();
    f.advance(1000,100,20);const result=sampler.read();
    expect(result.history).toHaveLength(2);expect(result.history[0]!.asOf).toBe(2300);
  });
  it('preserves UNKNOWN for invalid OS memory readings',()=>{
    const f=fixture();f.invalidMem();const result=createHostPerformanceSampler(f.deps).read();
    expect(result.memory).toMatchObject({status:'UNKNOWN',totalBytes:null,freeBytes:null,usedBytes:null});
  });
  it('OS sampling failures do not throw or manufacture metrics, callers cannot mutate cache',()=>{
    const f=fixture(),sampler=createHostPerformanceSampler(f.deps);const sample=sampler.read();sample.memory.usedBytes=999;sample.history[0]!.engine.rssBytes=999;
    expect(sampler.read().memory.usedBytes).toBe(750);expect(sampler.read().engine.rssBytes).toBe(400);
    f.advance(10000,500,100);f.deps.cpus=()=>{throw new Error('unavailable')};f.deps.memoryUsage=()=>{throw new Error('unavailable')};
    expect(sampler.read()).toMatchObject({cpu:{usagePct:null,status:'UNKNOWN'},engine:{rssBytes:null}});
  });
});

import * as os from 'node:os';
import type {HostPerformanceSample} from '@zdj/contracts';
export type {HostPerformanceSample} from '@zdj/contracts';

/**
 * Cheap, read-only host + Engine sampler. No PowerShell/CIM, network or exchange requests.
 * CPU percentage requires two different native OS tick samples; cold starts are UNKNOWN.
 * Lifetime-bound in-memory history: never stitches previous Engine instances together.
 */
type CpuTick={idle:number;total:number};
export type HostPerformanceDeps={
  now:()=>number;cpus:()=>Array<{times:{user:number;nice:number;sys:number;idle:number;irq:number}}>;
  totalmem:()=>number;freemem:()=>number;memoryUsage:()=>NodeJS.MemoryUsage;pid:number;
};
const nativeDeps:HostPerformanceDeps={
  now:Date.now,cpus:os.cpus,totalmem:os.totalmem,freemem:os.freemem,
  memoryUsage:process.memoryUsage.bind(process),pid:process.pid,
};
const positive=(n:number):number|null=>Number.isFinite(n)&&n>=0?n:null;
function ticks(cpus:ReturnType<HostPerformanceDeps['cpus']>):CpuTick|null{
  if(!cpus.length)return null;
  let total=0,idle=0;
  for(const cpu of cpus){
    const t=cpu.times;
    if(![t.user,t.nice,t.sys,t.idle,t.irq].every(n=>Number.isFinite(n)&&n>=0))return null;
    idle+=t.idle;total+=t.user+t.nice+t.sys+t.idle+t.irq;
  }
  return {idle,total};
}
export function createHostPerformanceSampler(deps:HostPerformanceDeps=nativeDeps,options:{intervalMs?:number;capacity?:number}={}){
  const intervalMs=Math.max(1000,Math.trunc(options.intervalMs??10_000));
  const capacity=Math.min(720,Math.max(2,Math.trunc(options.capacity??361)));
  const startedAt=deps.now(),instanceId=`engine:${deps.pid}:${startedAt}`;
  let previous:{at:number;tick:CpuTick}|null=null;
  let last:HostPerformanceSample|null=null;
  const history:HostPerformanceSample[]=[];
  let droppedSampleCount=0;
  const result=()=>({...structuredClone(last!),history:structuredClone(history),window:{coveredFrom:history[0]?.asOf??null,coveredTo:history.at(-1)?.asOf??null,sampleCount:history.length,droppedSampleCount}});
  function read(){
    const now=deps.now();
    if(last&&now>=last.asOf&&now-last.asOf<intervalMs)return result();
    let cores:ReturnType<HostPerformanceDeps['cpus']>=[],total:number|null=null,free:number|null=null,mem:Partial<NodeJS.MemoryUsage>={};
    try{cores=deps.cpus();}catch{}
    try{total=positive(deps.totalmem());free=positive(deps.freemem());}catch{}
    try{mem=deps.memoryUsage();}catch{}
    const next=ticks(cores);
    let usagePct:number|null=null,deltaMs:number|null=null;
    if(previous&&next&&now>previous.at){
      const deltaTotal=next.total-previous.tick.total,deltaIdle=next.idle-previous.tick.idle;
      if(deltaTotal>0&&deltaIdle>=0&&deltaIdle<=deltaTotal){
        usagePct=Math.round((1-deltaIdle/deltaTotal)*1000)/10;deltaMs=now-previous.at;
      }
    }
    previous=next?{at:now,tick:next}:null;
    const validMemory=total!==null&&free!==null&&free<=total;
    last={asOf:now,instanceId,source:'NODE_OS_CPU_TIMES_AND_MEMORY',sampleSource:'NODE_OS_CPU_TIMES_AND_MEMORY',ttlMs:30000,
      cpu:{usagePct,status:usagePct===null?'UNKNOWN':'MEASURED',logicalProcessors:cores.length||null,intervalMs:deltaMs},
      memory:{totalBytes:validMemory?total:null,freeBytes:validMemory?free:null,usedBytes:validMemory?total!-free!:null,status:validMemory?'MEASURED':'UNKNOWN'},
      engine:{pid:deps.pid,rssBytes:positive(mem.rss??NaN),heapUsedBytes:positive(mem.heapUsed??NaN),heapTotalBytes:positive(mem.heapTotal??NaN),externalBytes:positive(mem.external??NaN)},
    };
    history.push(last);if(history.length>capacity){droppedSampleCount+=history.length-capacity;history.splice(0,history.length-capacity);}
    return result();
  }
  return {read};
}

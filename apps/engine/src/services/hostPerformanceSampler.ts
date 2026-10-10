import * as os from 'node:os';

/**
 * Cheap, read-only host + Engine sampler. No PowerShell/CIM, network or exchange requests.
 * CPU percentage requires two different native OS tick samples; cold starts are UNKNOWN.
 * Lifetime-bound in-memory history: never stitches previous Engine instances together.
 */
type CpuTick={idle:number;total:number};
export type HostPerformanceSample={
  asOf:number;instanceId:string;source:'NODE_OS_CPU_TIMES_AND_MEMORY';
  cpu:{usagePct:number|null;status:'MEASURED'|'UNKNOWN';logicalProcessors:number|null;intervalMs:number|null};
  memory:{totalBytes:number|null;freeBytes:number|null;usedBytes:number|null;status:'MEASURED'|'UNKNOWN'};
  engine:{pid:number;rssBytes:number|null;heapUsedBytes:number|null;heapTotalBytes:number|null;externalBytes:number|null};
};
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
  function read(){
    const now=deps.now();
    if(last&&now>=last.asOf&&now-last.asOf<intervalMs)return{...last,history:[...history]};
    const cores=deps.cpus(),next=ticks(cores),total=positive(deps.totalmem()),free=positive(deps.freemem()),mem=deps.memoryUsage();
    let usagePct:number|null=null,deltaMs:number|null=null;
    if(previous&&next&&now>previous.at){
      const deltaTotal=next.total-previous.tick.total,deltaIdle=next.idle-previous.tick.idle;
      if(deltaTotal>0&&deltaIdle>=0&&deltaIdle<=deltaTotal){
        usagePct=Math.round((1-deltaIdle/deltaTotal)*1000)/10;deltaMs=now-previous.at;
      }
    }
    if(next)previous={at:now,tick:next};
    const validMemory=total!==null&&free!==null&&free<=total;
    last={asOf:now,instanceId,source:'NODE_OS_CPU_TIMES_AND_MEMORY',
      cpu:{usagePct,status:usagePct===null?'UNKNOWN':'MEASURED',logicalProcessors:cores.length||null,intervalMs:deltaMs},
      memory:{totalBytes:validMemory?total:null,freeBytes:validMemory?free:null,usedBytes:validMemory?total!-free!:null,status:validMemory?'MEASURED':'UNKNOWN'},
      engine:{pid:deps.pid,rssBytes:positive(mem.rss),heapUsedBytes:positive(mem.heapUsed),heapTotalBytes:positive(mem.heapTotal),externalBytes:positive(mem.external)},
    };
    history.push(last);if(history.length>capacity)history.splice(0,history.length-capacity);
    return {...last,history:[...history]};
  }
  return {read};
}

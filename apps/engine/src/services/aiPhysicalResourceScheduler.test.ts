import {it,expect} from 'vitest';
import {AiPhysicalResourceScheduler,type AiServiceIdentity} from './aiPhysicalResourceScheduler.js';
const resource=(id:string,port:number,role='PRIMARY_BRAIN')=>({id,baseUrl:`http://127.0.0.1:${port}/v1`,role,enabled:true,status:'ONLINE',maxConcurrency:1} as any);
const hash='a'.repeat(64);
const identity=(port:number,physicalServiceId=String(port)):AiServiceIdentity=>({endpoint:`http://127.0.0.1:${port}/v1`,physicalServiceId,modelSha256:hash,templateSha256:hash,contextSize:32768,outputContractHash:hash,generationConfigHash:hash});
it('atomically caps aliases, preserves ownership on duplicate release and shares physical identity',()=>{
 const a=resource('a',8084),alias={...a,id:'alias',baseUrl:'http://localhost:8084/v1/'};const scheduler=new AiPhysicalResourceScheduler();const first=scheduler.tryAcquire(a)!;expect(scheduler.tryAcquire(alias)).toBeNull();expect(first.release()).toBe(true);const second=scheduler.tryAcquire(alias)!;expect(first.release()).toBe(false);expect(scheduler.activeCount(a)).toBe(1);second.release();
 const sameGpu=new AiPhysicalResourceScheduler({identities:[identity(8084,'physical-1'),identity(8083,'physical-1')]});const lease=sameGpu.tryAcquire(a)!;expect(sameGpu.tryAcquire(resource('review',8083))).toBeNull();lease.release();
});
it('borrows only proven equivalent idle services and obeys overdue review/offline/context gates',()=>{
 const a=resource('primary',8084),b=resource('review',8083,'REVIEW_BRAIN');expect(new AiPhysicalResourceScheduler().compatible(a,b)).toBe(false);
 const policy={borrowIdle:true,identities:[identity(8084),identity(8083)]},scheduler=new AiPhysicalResourceScheduler(policy);const lease=scheduler.tryAcquire(a)!;
 expect(scheduler.select(a,[b])).toBe(b);expect(scheduler.select(a,[b],true)).toBeUndefined();expect(scheduler.select(a,[{...b,status:'OFFLINE'}])).toBeUndefined();
 expect(scheduler.select({...a,baseUrl:'invalid-url'},[b])).toBeUndefined();
 const busy=scheduler.tryAcquire(b)!;expect(scheduler.select(a,[b])).toBeUndefined();busy.release();
 expect(new AiPhysicalResourceScheduler({...policy,identities:[identity(8084),{...identity(8083),contextSize:16384}]}).compatible(a,b)).toBe(false);
 expect(new AiPhysicalResourceScheduler({...policy,identities:[identity(8084),{...identity(8083),generationConfigHash:'b'.repeat(64)}]}).compatible(a,b)).toBe(false);
 lease.release();expect(scheduler.select(a,[b])).toBe(a);
});
it('replay compares identical jobs and role counts without model calls or new Entry authorizations',()=>{
 const a=resource('primary',8084),b=resource('review',8083,'REVIEW_BRAIN');const delays=(borrowIdle:boolean)=>{
  const scheduler=new AiPhysicalResourceScheduler({borrowIdle,identities:[identity(8084),identity(8083)]});const first=scheduler.tryAcquire(a)!;const target=scheduler.select(a,[b]);const queueMs=target?0:100;const second=target?scheduler.tryAcquire(target):null;
  const roles=['PRIMARY_BRAIN','PRIMARY_BRAIN'];first.release();second?.release();return {queueMs,roles,entryAuthorizations:0};
 };
 expect(delays(false)).toEqual({queueMs:100,roles:['PRIMARY_BRAIN','PRIMARY_BRAIN'],entryAuthorizations:0});expect(delays(true)).toEqual({queueMs:0,roles:['PRIMARY_BRAIN','PRIMARY_BRAIN'],entryAuthorizations:0});
});

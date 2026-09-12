import {it,expect,vi} from 'vitest';import {RequestBudget} from './requestBudget.js';import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
it('reserves capacity for private work while public requests are saturated',async()=>{
 const budget=new RequestBudget(3,1,100);const release:Array<()=>void>=[];let publicStarted=0,privateStarted=0;
 const publicWork=Array.from({length:3},()=>budget.run(2,()=>new Promise<void>(resolve=>{publicStarted++;release.push(resolve);})));await new Promise(r=>setImmediate(r));
 const urgent=budget.run(0,async()=>{privateStarted++;});await urgent;expect(publicStarted).toBe(1);expect(privateStarted).toBe(1);
 for(let i=0;i<3;i++){release.shift()!();await new Promise(r=>setImmediate(r));}await Promise.all(publicWork);expect(budget.health().active).toBe(0);
});
it('fails queued requests during a ban instead of holding sync flights until expiry',async()=>{
 const budget=new RequestBudget(1,1,100);let release!:()=>void;
 const active=budget.run(2,()=>new Promise<void>(r=>release=r));await new Promise(r=>setImmediate(r));
 const fn=vi.fn(),waiting=budget.run(0,fn);const rejected=expect(waiting).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');
 budget.observe(418,'1200','3600');await rejected;await expect(budget.run(0,fn)).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');
 expect(fn).not.toHaveBeenCalled();expect(budget.health().queued).toBe(0);release();await active;
});
it('bounds queue waits and reserves weight for private work',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,2,100);budget.observe(200,'1000',undefined);
 const publicFn=vi.fn(),pending=budget.run(2,publicFn),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');
 await budget.run(0,async()=>{});await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(61000);await budget.run(2,publicFn);expect(publicFn).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
it('precharges endpoint weight and keeps public hydration below its soft ceiling',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,2,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20});budget.observe(200,'9',undefined);
 const publicFn=vi.fn(),pending=budget.run(2,2,publicFn),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');
 const privateFn=vi.fn(async()=>{});await budget.run(0,2,privateFn);expect(privateFn).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it('recovers from a ban sequentially instead of releasing every waiting subsystem at once',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,3,100);budget.observe(418,'1200','1');await vi.advanceTimersByTimeAsync(6001);
 let active=0,maxActive=0;const probe=()=>budget.run(0,1,async()=>{active++;maxActive=Math.max(maxActive,active);budget.observe(200,'10',undefined);active--;});
 const first=probe(),second=probe();await first;expect(maxActive).toBe(1);expect(budget.health().status).toBe('RECOVERING');expect(budget.health().recoverySuccesses).toBe(1);
 await vi.advanceTimersByTimeAsync(1600);await second;expect(maxActive).toBe(1);expect(budget.health().recoverySuccesses).toBe(2);
 await vi.advanceTimersByTimeAsync(1600);await probe();expect(budget.health().status).toBe('PRESSURED');expect(budget.health().recoverySuccesses).toBe(3);
 }finally{vi.useRealTimers();}
});
it('attributes endpoint weight and reports pressure instead of falsely AVAILABLE',async()=>{
 const budget=new RequestBudget(2,1,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20});
 await budget.run(0,5,async()=>{}, {source:'PRIVATE_STATE',endpoint:'/fapi/v2/account',purpose:'SYNC',method:'GET'});
 budget.observe(200,'16',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'});
 const health=budget.health();expect(health.status).toBe('PRESSURED');expect(health.attribution[0]?.source).toBe('PRIVATE_STATE');expect(health.attribution[0]?.estimatedWeight).toBe(5);
});
it('retains the Binance-observed banned IP for route diagnostics',()=>{
 const budget=new RequestBudget(1,1,100);budget.observe(418,'2300','60',{source:'RECONCILIATION',endpoint:'/fapi/v2/positionRisk'},'15.158.242.74');
 expect(budget.health().lastObservedBanIp).toBe('15.158.242.74');expect(budget.health().status).toBe('RATE_LIMITED');
});

it('precharges concurrent work on top of observed weight',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,3,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20});budget.observe(200,'17',undefined);
 let release!:()=>void;const first=budget.run(0,2,()=>new Promise<void>(r=>release=r));await Promise.resolve();const fn=vi.fn(),second=budget.run(0,2,fn),rejected=expect(second).rejects.toThrow('QUEUE_TIMEOUT');
 await vi.advanceTimersByTimeAsync(5100);await rejected;expect(fn).not.toHaveBeenCalled();release();await first;}finally{vi.useRealTimers();}
});
it('honors HTTP-date Retry-After and body ban deadline',()=>{
 const budget=new RequestBudget();const until=Date.now()+3600000;budget.observe(418,undefined,new Date(Date.now()+120000).toUTCString(),{},null,until);expect(budget.health().blockedUntil).toBeGreaterThanOrEqual(until);
});
it('persists unexplained observed weight pressure across a process restart window',()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);const dir=mkdtempSync(path.join(os.tmpdir(),'zdj-budget-pressure-')),prior=process.env.ZDJ_DATA_DIR;process.env.ZDJ_DATA_DIR=dir;
 try{const first=new RequestBudget(2,1,100,{persistKey:'route-a'});first.observe(200,'17',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});expect(first.health()).toMatchObject({status:'PRESSURED',observedWeightAnomaly:true,usedWeight1m:17});const restored=new RequestBudget(2,1,100,{persistKey:'route-a'});expect(restored.health()).toMatchObject({status:'PRESSURED',observedWeightAnomaly:true,usedWeight1m:17});}
 finally{if(prior===undefined)delete process.env.ZDJ_DATA_DIR;else process.env.ZDJ_DATA_DIR=prior;rmSync(dir,{recursive:true,force:true});vi.useRealTimers();}
});

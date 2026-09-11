import {it,expect,vi} from 'vitest';import {RequestBudget} from './requestBudget.js';
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

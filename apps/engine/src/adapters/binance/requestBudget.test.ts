import {it,expect,vi} from 'vitest';import {RequestBudget} from './requestBudget.js';import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
it('reserves capacity for private work while public requests are saturated',async()=>{const budget=new RequestBudget(3,1,100);const release:Array<()=>void>=[];let publicStarted=0,privateStarted=0;const publicWork=Array.from({length:3},()=>budget.run(2,()=>new Promise<void>(resolve=>{publicStarted++;release.push(resolve);}),undefined,{source:'MARKET_DATA'}));await new Promise(r=>setImmediate(r));const urgent=budget.run(0,async()=>{privateStarted++;},undefined,{source:'PRIVATE_STATE'});await urgent;expect(publicStarted).toBe(1);expect(privateStarted).toBe(1);for(let i=0;i<3;i++){release.shift()!();await new Promise(r=>setImmediate(r));}await Promise.all(publicWork);expect(budget.health().active).toBe(0);});
it('fails queued requests during a ban instead of holding sync flights until expiry',async()=>{const budget=new RequestBudget(1,1,100);let release!:()=>void;const active=budget.run(2,()=>new Promise<void>(r=>release=r),undefined,{source:'MARKET_DATA'});await new Promise(r=>setImmediate(r));const fn=vi.fn(),waiting=budget.run(0,fn,undefined,{source:'PRIVATE_STATE'});const rejected=expect(waiting).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');budget.observe(418,'1200','3600');await rejected;await expect(budget.run(0,fn,undefined,{source:'PRIVATE_STATE'})).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');expect(fn).not.toHaveBeenCalled();expect(budget.health().queued).toBe(0);release();await active;});
it('bounds queue waits and reserves weight for private work',async()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,2,100,{softPublicWeight:700,softBackgroundWeight:1000,hardWeight:2200});budget.observe(200,'1000',undefined,{source:'MARKET_DATA'});const publicFn=vi.fn(),pending=budget.run(2,publicFn,undefined,{source:'MARKET_DATA'}),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');await budget.run(0,async()=>{},undefined,{source:'PRIVATE_STATE'});await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(61000);await budget.run(2,publicFn,undefined,{source:'MARKET_DATA'});expect(publicFn).toHaveBeenCalledOnce();}finally{vi.useRealTimers();}});
it('precharges endpoint weight and keeps public hydration below its soft ceiling',async()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,2,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20,privateTruthWeight:20});budget.observe(200,'14',undefined,{source:'MARKET_DATA'});const publicFn=vi.fn(),pending=budget.run(2,2,publicFn,{source:'MARKET_DATA'}),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');const privateFn=vi.fn(async()=>{});await budget.run(0,2,privateFn,{source:'PRIVATE_STATE'});expect(privateFn).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();}finally{vi.useRealTimers();}});
it('recovers from a ban sequentially using control probes instead of releasing every waiting subsystem at once',async()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,3,100);budget.observe(418,'1200','1',{source:'RECONCILIATION'});await vi.advanceTimersByTimeAsync(6001);let active=0,maxActive=0;const probe=()=>budget.run(0,1,async()=>{active++;maxActive=Math.max(maxActive,active);budget.observe(200,'10',undefined,{source:'CLOCK',endpoint:'/fapi/v1/time'});active--;},{source:'CLOCK',endpoint:'/fapi/v1/time'});const first=probe(),second=probe();await first;expect(maxActive).toBe(1);expect(budget.health().status).toBe('RECOVERING');expect(budget.health().recoverySuccesses).toBe(1);await vi.advanceTimersByTimeAsync(1600);await second;expect(maxActive).toBe(1);expect(budget.health().status).toBe('AVAILABLE');expect(budget.health().recoverySuccesses).toBe(2);}finally{vi.useRealTimers();}});
it('attributes endpoint weight and reports pressure instead of falsely AVAILABLE',async()=>{const budget=new RequestBudget(2,1,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20});await budget.run(0,5,async()=>{}, {source:'PRIVATE_STATE',endpoint:'/fapi/v2/account',purpose:'SYNC',method:'GET'});budget.observe(200,'16',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'});const health=budget.health();expect(health.status).toBe('PRESSURED');expect(health.attribution[0]?.source).toBe('PRIVATE_STATE');expect(health.attribution[0]?.estimatedWeight).toBe(5);});
it('retains the Binance-observed banned IP for route diagnostics',()=>{const budget=new RequestBudget(1,1,100);budget.observe(418,'2300','60',{source:'RECONCILIATION',endpoint:'/fapi/v2/positionRisk'},'15.158.242.74');expect(budget.health().lastObservedBanIp).toBe('15.158.242.74');expect(budget.health().status).toBe('RATE_LIMITED');});
it('precharges concurrent private work on top of observed weight',async()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(3,3,100,{softPublicWeight:10,softBackgroundWeight:15,hardWeight:20,privateTruthWeight:20});budget.observe(200,'17',undefined,{source:'PRIVATE_STATE'});let release!:()=>void;const first=budget.run(0,2,()=>new Promise<void>(r=>release=r),{source:'PRIVATE_STATE'});await Promise.resolve();const fn=vi.fn(),second=budget.run(0,2,fn,{source:'PRIVATE_STATE'}),rejected=expect(second).rejects.toThrow('QUEUE_TIMEOUT');await vi.advanceTimersByTimeAsync(10_100);await rejected;expect(fn).not.toHaveBeenCalled();release();await first;}finally{vi.useRealTimers();}});
it('honors HTTP-date Retry-After and body ban deadline',()=>{const budget=new RequestBudget();const until=Date.now()+3600000;budget.observe(418,undefined,new Date(Date.now()+120000).toUTCString(),{},null,until);expect(budget.health().blockedUntil).toBeGreaterThanOrEqual(until);});
it('persists an unexplained observed-weight diagnostic without manufacturing budget pressure',()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);const dir=mkdtempSync(path.join(os.tmpdir(),'zdj-budget-pressure-')),prior=process.env.ZDJ_DATA_DIR;process.env.ZDJ_DATA_DIR=dir;try{const first=new RequestBudget(2,1,100,{persistKey:'route-a'});first.observe(200,'21',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});expect(first.health()).toMatchObject({status:'AVAILABLE',observedWeightAnomaly:true,usedWeight1m:21});const restored=new RequestBudget(2,1,100,{persistKey:'route-a'});expect(restored.health()).toMatchObject({status:'AVAILABLE',observedWeightAnomaly:false,usedWeight1m:null});}finally{if(prior===undefined)delete process.env.ZDJ_DATA_DIR;else process.env.ZDJ_DATA_DIR=prior;rmSync(dir,{recursive:true,force:true});vi.useRealTimers();}});
it('uses the latest Binance rolling-window observation instead of retaining a stale wall-clock maximum',async()=>{const budget=new RequestBudget(2,1,100,{softPublicWeight:1000,softBackgroundWeight:1800,hardWeight:2200});budget.observe(200,'1632',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});budget.observe(200,'34',undefined,{source:'CLOCK',endpoint:'/fapi/v1/time'});expect(budget.health()).toMatchObject({usedWeight1m:1632,observationTrust:'INCONSISTENT'});expect(budget.health().weightObservations.at(-1)).toMatchObject({previousUsedWeight1m:1632,usedWeight1m:34,counterDiscontinuity:true});const market=vi.fn(async()=>{});await budget.run(2,1,market,{source:'MARKET_DATA',endpoint:'/fapi/v1/ticker/bookTicker'});expect(market).toHaveBeenCalledOnce();});
it('preserves a legacy high-header file as evidence without restoring it as fresh startup pressure',()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);const dir=mkdtempSync(path.join(os.tmpdir(),'zdj-budget-legacy-')),prior=process.env.ZDJ_DATA_DIR;process.env.ZDJ_DATA_DIR=dir;try{mkdirSync(path.join(dir,'rate-limit'),{recursive:true});writeFileSync(path.join(dir,'rate-limit','legacy.json'),JSON.stringify({usedWeight:2656,weightObservedAt:1800000000000,anomalyUntil:1800000060000}));const budget=new RequestBudget(2,1,100,{persistKey:'legacy'});expect(budget.health()).toMatchObject({usedWeight1m:null,status:'AVAILABLE'});}finally{if(prior===undefined)delete process.env.ZDJ_DATA_DIR;else process.env.ZDJ_DATA_DIR=prior;rmSync(dir,{recursive:true,force:true});vi.useRealTimers();}});

it('keeps a bounded 512-row dispatch ledger',async()=>{const budget=new RequestBudget(1,1,1000);for(let i=0;i<520;i++)await budget.run(0,0,async()=>{}, {requestId:`r${i}`,source:'CLOCK',endpoint:'/fapi/v1/time'});const rows=budget.dispatchLedger();expect(rows).toHaveLength(512);expect(rows[0]?.requestId).toBe('r8');expect(rows.at(-1)).toMatchObject({requestId:'r519',decision:'ADMITTED'});});

it('does not let a locally blocked attempt overwrite the last exchange response time',async()=>{vi.useFakeTimers();vi.setSystemTime(1800000000000);try{const budget=new RequestBudget(1,1,100);const meta={requestId:'ok',source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'};await budget.run(0,1,async()=>{},meta);budget.observe(200,'10',undefined,meta);const responseAt=budget.health().attribution.find(x=>x.endpoint==='/fapi/v2/account')!.lastAt;vi.setSystemTime(1800000001000);budget.observe(418,'10','60',{requestId:'ban',source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'},'15.158.242.74');await expect(budget.run(0,1,async()=>{}, {requestId:'blocked',source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'})).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');const row=budget.health().attribution.find(x=>x.endpoint==='/fapi/v2/account')!;expect(row.lastAt).toBe(responseAt);expect(row.lastAttemptAt).toBe(1800000001000);expect(budget.dispatchLedger().at(-1)).toMatchObject({requestId:'blocked',decision:'BLOCKED'});}finally{vi.useRealTimers();}});


it('treats a Binance fixed-minute counter drop across the boundary as an expected reset',()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_059_000);
 try{
  const budget=new RequestBudget();
  budget.configureRateLimits([{rateLimitType:'REQUEST_WEIGHT',interval:'MINUTE',intervalNum:1,limit:6000}]);
  budget.observeResponse(200,{'x-mbx-used-weight-1m':'500'},undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'});
  vi.advanceTimersByTime(2_000);
  budget.observeResponse(200,{'x-mbx-used-weight-1m':'5'},undefined,{source:'CLOCK',endpoint:'/fapi/v1/time'});
  expect(budget.health().observationTrust).toBe('TRUSTED');
  expect(budget.health().weightObservations.at(-1)).toMatchObject({counterDiscontinuity:false,windowReset:true,usedWeight1m:5});
 }finally{vi.useRealTimers();}
});

it('captures multiple REQUEST_WEIGHT and ORDERS intervals from one response',()=>{
 const budget=new RequestBudget();
 budget.configureRateLimits([
  {rateLimitType:'REQUEST_WEIGHT',interval:'MINUTE',intervalNum:1,limit:6000},
  {rateLimitType:'ORDERS',interval:'SECOND',intervalNum:10,limit:50},
  {rateLimitType:'ORDERS',interval:'MINUTE',intervalNum:1,limit:1200},
 ]);
 budget.observeResponse(200,{'x-mbx-used-weight-1m':'321','x-mbx-order-count-10s':'7','x-mbx-order-count-1m':'41'},undefined,{source:'EXECUTION_CRITICAL',endpoint:'/fapi/v1/order'});
 const counters=budget.health().rateLimits;
 expect(counters).toEqual(expect.arrayContaining([
  expect.objectContaining({rateLimitType:'REQUEST_WEIGHT',interval:'MINUTE',intervalNum:1,observedCount:321,limit:6000}),
  expect.objectContaining({rateLimitType:'ORDERS',interval:'SECOND',intervalNum:10,observedCount:7,limit:50}),
  expect.objectContaining({rateLimitType:'ORDERS',interval:'MINUTE',intervalNum:1,observedCount:41,limit:1200}),
 ]));
});

it('reserves ORDERS headroom independently from REQUEST_WEIGHT',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const budget=new RequestBudget(1,1,100);
  budget.configureRateLimits([{rateLimitType:'ORDERS',interval:'SECOND',intervalNum:10,limit:50}]);
  budget.observeResponse(200,{'x-mbx-order-count-10s':'47'},undefined,{source:'EXECUTION_CRITICAL',endpoint:'/fapi/v1/order'});
  const fn=vi.fn(),pending=budget.run(0,0,fn,{source:'EXECUTION_CRITICAL',endpoint:'/fapi/v1/order',method:'POST',orderCount:1});
  await vi.advanceTimersByTimeAsync(9_999);expect(fn).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);await expect(pending).resolves.toBeUndefined();expect(fn).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});


it('enforces exchangeInfo REQUEST_WEIGHT intervals even before a response header is observed',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const budget=new RequestBudget(2,2,100);
  budget.configureRateLimits([{rateLimitType:'REQUEST_WEIGHT',interval:'SECOND',intervalNum:10,limit:10}]);
  await budget.run(3,7,async()=>1,{source:'MARKET_DATA',endpoint:'/fapi/v1/ticker/24hr'});
  const blocked=vi.fn(async()=>2),pending=budget.run(3,1,blocked,{source:'MARKET_DATA',endpoint:'/fapi/v1/klines'}),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');
  await vi.advanceTimersByTimeAsync(5_100);await rejected;expect(blocked).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});


it('backs off on HTTP 429 with Retry-After and records the request-limit event',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const budget=new RequestBudget(2,1,100);
  budget.observeResponse(429,{'x-mbx-used-weight-1m':'1200'},'2',{requestId:'rate-429',source:'MARKET_DATA',endpoint:'/fapi/v1/klines'});
  expect(budget.health()).toMatchObject({status:'RATE_LIMITED',http429:1});
  expect(budget.health().blockedUntil).toBeGreaterThanOrEqual(1_800_000_003_000);
  await expect(budget.run(1,1,async()=>{}, {source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'})).rejects.toThrow('BINANCE_RATE_LIMIT_UNTIL');
 }finally{vi.useRealTimers();}
});

it('defers BACKGROUND before PRIVATE_TRUTH under exchange pressure',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const budget=new RequestBudget(3,2,100);budget.configureRequestWeightLimit(6000);
  budget.observe(200,'3100',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'});
  const background=vi.fn(async()=>{}),pending=budget.run(4,5,background,{source:'BACKGROUND_AUDIT',endpoint:'/fapi/v1/userTrades'}),rejected=expect(pending).rejects.toThrow('BINANCE_REQUEST_QUEUE_TIMEOUT');
  const privateTruth=vi.fn(async()=>{});await budget.run(1,5,privateTruth,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});
  expect(privateTruth).toHaveBeenCalledOnce();expect(background).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_100);await rejected;
 }finally{vi.useRealTimers();}
});

it('does not mistake an older concurrent response for a same-window Binance counter discontinuity',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_010_000);
 try{
  const budget=new RequestBudget(2,2,100);
  let releaseA!:()=>void,releaseB!:()=>void;
  const aMeta={requestId:'concurrent-a',source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'};
  const bMeta={requestId:'concurrent-b',source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'};
  const a=budget.run(1,1,()=>new Promise<void>(resolve=>releaseA=resolve),aMeta);
  const b=budget.run(1,1,()=>new Promise<void>(resolve=>releaseB=resolve),bMeta);
  await Promise.resolve();
  vi.advanceTimersByTime(100);
  budget.observeResponse(200,{'x-mbx-used-weight-1m':'200'},undefined,bMeta);
  releaseB();await b;
  vi.advanceTimersByTime(100);
  budget.observeResponse(200,{'x-mbx-used-weight-1m':'190'},undefined,aMeta);
  releaseA();await a;
  expect(budget.health().observationTrust).toBe('TRUSTED');
  expect(budget.health().rateLimits).toEqual(expect.arrayContaining([expect.objectContaining({rateLimitType:'REQUEST_WEIGHT',observedCount:200,counterDiscontinuity:false})]));
  expect(budget.health().weightObservations.at(-1)).toMatchObject({usedWeight1m:190,counterDiscontinuity:false,staleOutOfOrder:true});
 }finally{vi.useRealTimers();}
});

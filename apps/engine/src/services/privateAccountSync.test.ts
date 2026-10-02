import {it,expect,vi,afterEach} from 'vitest';
import {PrivateAccountSync} from './privateAccountSync.js';
afterEach(()=>vi.useRealTimers());
it('coalesces 100 overlapping refreshes and never publishes a superseded generation',async()=>{
  let generation=1,reads=0,resolve!:(value:any)=>void,account:any={status:'SYNCING'},events:any[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>generation,read:()=>{reads++;return new Promise(r=>resolve=r);},get:()=>account,set:v=>account=v,emit:(type,payload)=>events.push({type,payload})});
  const calls=Array.from({length:100},()=>service.sync());generation=2;resolve({asOf:Date.now()});await Promise.all(calls);
  expect(reads).toBe(1);expect(account.status).toBe('SYNCING');expect(events.at(-1).type).toBe('PRIVATE_SYNC_DISCARDED');
  const next=service.sync();resolve({asOf:Date.now(),availableUsd:100});await next;expect(account).toMatchObject({status:'READY',availableUsd:100});expect(service.health().coalesced).toBe(99);
});
it('logs transient failure and recovery without erasing last known facts',async()=>{
  vi.useFakeTimers();
  let failed=true,account:any={status:'READY',availableUsd:100,asOf:1};const events:string[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:async()=>{if(failed)throw new Error('socket closed');return{availableUsd:90,asOf:Date.now()};},get:()=>account,set:v=>account=v,emit:type=>events.push(type)});
  await service.sync();expect(account).toMatchObject({status:'UNAVAILABLE',availableUsd:100});failed=false;await vi.advanceTimersByTimeAsync(5000);await service.sync();expect(account).toMatchObject({status:'READY',availableUsd:90});expect(events).toContain('PRIVATE_SYNC_RECOVERED');expect(service.health().consecutiveFailures).toBe(0);
});
it('isolates 100 delayed failures from replacement generations',async()=>{
 let generation=1,account:any={status:'READY',asOf:Date.now(),availableUsd:99},reject!:(e:Error)=>void;
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>generation,read:()=>new Promise((_,r)=>reject=r),get:()=>account,set:v=>account=v,emit:()=>{}});
 for(let i=0;i<100;i++){const pending=service.sync();generation++;account={status:'READY',asOf:Date.now(),availableUsd:i};reject(new Error('old transport failure'));await pending;expect(account).toMatchObject({status:'READY',availableUsd:i});}
});
it('marks stale account facts unavailable even while a refresh remains in flight',async()=>{
 let account:any={status:'READY',asOf:Date.now()-60001},resolve!:(a:any)=>void;
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:()=>new Promise(r=>resolve=r),get:()=>account,set:v=>account=v,emit:()=>{}});
 const flight=service.sync();expect(account.reason).toBe('PRIVATE_DATA_STALE');resolve({asOf:Date.now(),availableUsd:5});await flight;expect(account.status).toBe('READY');
});

it('classifies HTTP 451 and suppresses repeated refreshes without inventing fresh account facts',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);
 const oldAsOf=Date.now()-15_000,events:any[]=[];
 let account:any={status:'READY',asOf:oldAsOf,availableUsd:99},failed=true;
 const read=vi.fn(async()=>{if(failed)throw new Error('Binance HTTP 451: restricted location');return{asOf:Date.now(),availableUsd:98};});
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read,get:()=>account,set:v=>account=v,emit:(type,payload)=>events.push({type,payload})});
 await service.sync();const failureAt=Date.now();
 await Promise.all(Array.from({length:100},(_,i)=>service.sync(i%2?'USER_DATA':'POLL')));
 expect(read).toHaveBeenCalledTimes(1);
 expect(account).toMatchObject({status:'UNAVAILABLE',asOf:oldAsOf,availableUsd:99,reason:'Binance HTTP 451: restricted location'});
 expect(service.health()).toMatchObject({lastErrorCode:'REGION_RESTRICTED',lastFailureAt:failureAt,lastSuccessAt:null,consecutiveFailures:1,deferredRetries:100,retryDelayMs:60_000,nextRetryAt:failureAt+60_000});
 expect(events.filter(x=>x.type==='PRIVATE_SYNC_FAILED')).toHaveLength(1);
 expect(events.at(-1).payload.errorCode).toBe('REGION_RESTRICTED');
 await vi.advanceTimersByTimeAsync(59_999);failed=false;await service.sync();expect(read).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);await Promise.all(Array.from({length:20},()=>service.sync()));
 expect(read).toHaveBeenCalledTimes(2);expect(account).toMatchObject({status:'READY',asOf:Date.now(),availableUsd:98,reason:null});
 expect(service.health()).toMatchObject({lastErrorCode:null,lastError:null,consecutiveFailures:0,nextRetryAt:null,retryDelayMs:0});
 expect(events.at(-1).type).toBe('PRIVATE_SYNC_RECOVERED');
});

it('bounds ordinary failure backoff and reports the next retry without scheduling background reads',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);let account:any={status:'READY',asOf:Date.now(),availableUsd:10};
 const read=vi.fn(async()=>{throw new Error('socket closed');});
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read,get:()=>account,set:v=>account=v,emit:()=>{}});
 for(const delay of [5000,10000,20000,40000,60000,60000]){
  const before=read.mock.calls.length;await service.sync();expect(read).toHaveBeenCalledTimes(before+1);
  expect(service.health().retryDelayMs).toBe(delay);await vi.advanceTimersByTimeAsync(delay-1);
  await service.sync();expect(read).toHaveBeenCalledTimes(before+1);await vi.advanceTimersByTimeAsync(1);
 }
 await vi.advanceTimersByTimeAsync(600_000);expect(read).toHaveBeenCalledTimes(6);
 expect(account).toMatchObject({status:'UNAVAILABLE',availableUsd:10});
});

it('lets a replacement configuration attempt a real read but ignores old-generation failures',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);let generation=1,account:any={status:'READY',asOf:Date.now(),availableUsd:10};
 const read=vi.fn(async()=>{if(generation===1)throw new Error('Binance HTTP 451: restricted location');return{asOf:Date.now(),availableUsd:11};});
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>generation,read,get:()=>account,set:v=>account=v,emit:()=>{}});
 await service.sync();expect(service.health().nextRetryAt).toBe(Date.now()+60_000);
 generation=2;await service.sync();expect(read).toHaveBeenCalledTimes(2);expect(account).toMatchObject({status:'READY',availableUsd:11});
 expect(service.health()).toMatchObject({nextRetryAt:null,lastErrorCode:null});
});

it('rechecks replaced credentials immediately without a settings version change',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1800000000000);let valid=false,account:any={status:'UNAVAILABLE',asOf:1,availableUsd:10};
 const read=vi.fn(async()=>{if(!valid)throw new Error('Binance HTTP 403: old credential rejected');return{asOf:Date.now(),availableUsd:11};});
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>33,read,get:()=>account,set:v=>account=v,emit:()=>{}});
 await service.sync();valid=true;await service.sync();expect(read).toHaveBeenCalledTimes(1);
 await service.sync('CREDENTIALS_CHANGED');expect(read).toHaveBeenCalledTimes(2);
 expect(account).toMatchObject({status:'READY',availableUsd:11});expect(service.health()).toMatchObject({nextRetryAt:null,lastErrorCode:null});
});

it.each(['SUCCESS','FAILURE'])('discards an old credential %s and refreshes the new account in a single flight',async(outcome)=>{
 let account:any={status:'SYNCING'},resolve!:(value:any)=>void,reject!:(error:Error)=>void;
 const publications:any[]=[];
 const read=vi.fn().mockImplementationOnce(()=>new Promise((res,rej)=>{resolve=res;reject=rej;})).mockResolvedValue({asOf:Date.now(),availableUsd:22});
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>33,read,get:()=>account,set:v=>{publications.push(v);account=v;},emit:()=>{}});
 const old=service.sync(),fresh=service.sync('CREDENTIALS_CHANGED');expect(read).toHaveBeenCalledTimes(1);
 if(outcome==='SUCCESS')resolve({asOf:Date.now(),availableUsd:999});else reject(new Error('Binance HTTP 403: old credential'));
 await Promise.all([old,fresh]);expect(read).toHaveBeenCalledTimes(2);
 expect(publications).toHaveLength(1);expect(account).toMatchObject({status:'READY',availableUsd:22});
 expect(service.health()).toMatchObject({consecutiveFailures:0,lastErrorCode:null,nextRetryAt:null});
});

it.each([
 ['Binance HTTP 403: forbidden','AUTH_OR_PERMISSION'],
 ['Binance HTTP 429: slow down','RATE_LIMIT'],
 ['BINANCE_RATE_LIMIT_UNTIL:1800000060000','RATE_LIMIT'],
 ['Binance request timed out','TIMEOUT'],
 ['socket failed requestId=451','TRANSPORT_OR_RESPONSE'],
])('keeps the failure category specific for %s',async(reason,expected)=>{
 let account:any={status:'SYNCING'};
 const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:async()=>{throw new Error(reason);},get:()=>account,set:v=>account=v,emit:()=>{}});
 await service.sync();expect(service.health().lastErrorCode).toBe(expected);expect(account.status).toBe('UNAVAILABLE');
});

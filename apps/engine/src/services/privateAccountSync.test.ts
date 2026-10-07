import {it,expect} from 'vitest';
import {PrivateAccountSync} from './privateAccountSync.js';
it('coalesces 100 overlapping refreshes and never publishes a superseded generation',async()=>{
  let generation=1,reads=0,resolve!:(value:any)=>void,account:any={status:'SYNCING'},events:any[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>generation,read:()=>{reads++;return new Promise(r=>resolve=r);},get:()=>account,set:v=>account=v,emit:(type,payload)=>events.push({type,payload})});
  const calls=Array.from({length:100},()=>service.sync());generation=2;resolve({asOf:Date.now()});await Promise.all(calls);
  expect(reads).toBe(1);expect(account.status).toBe('SYNCING');expect(events.at(-1).type).toBe('PRIVATE_SYNC_DISCARDED');
  const next=service.sync();resolve({asOf:Date.now(),availableUsd:100});await next;expect(account).toMatchObject({status:'READY',availableUsd:100});expect(service.health().coalesced).toBe(99);
});
it('tolerates up to two transient private REST failures while last-known-good facts remain fresh',async()=>{
  let failed=true,account:any={status:'READY',availableUsd:100,asOf:Date.now()};const events:string[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:async()=>{if(failed)throw new Error('BINANCE_TRANSPORT_BLOCKED: Binance request timed out');return{availableUsd:90,asOf:Date.now()};},get:()=>account,set:v=>account=v,emit:type=>events.push(type)});
  await service.sync();expect(account).toMatchObject({status:'READY',availableUsd:100});await service.sync();expect(account.status).toBe('READY');expect(events.filter(x=>x==='PRIVATE_SYNC_TRANSIENT_TOLERATED')).toHaveLength(2);
  await service.sync();expect(account).toMatchObject({status:'UNAVAILABLE',availableUsd:100});expect(events).toContain('PRIVATE_SYNC_FAILED');
  failed=false;await service.sync();expect(account).toMatchObject({status:'READY',availableUsd:90});expect(events).toContain('PRIVATE_SYNC_RECOVERED');expect(service.health().consecutiveFailures).toBe(0);
});
it('does not tolerate a transient failure once the last-known-good private snapshot is stale',async()=>{
  let account:any={status:'READY',availableUsd:100,asOf:Date.now()-60_001};const events:string[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:async()=>{throw new Error('BINANCE_TRANSPORT_BLOCKED: Binance request timed out');},get:()=>account,set:v=>account=v,emit:type=>events.push(type)});
  await service.sync();expect(account.status).toBe('UNAVAILABLE');expect(events).toContain('PRIVATE_SYNC_FAILED');expect(events).not.toContain('PRIVATE_SYNC_TRANSIENT_TOLERATED');
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

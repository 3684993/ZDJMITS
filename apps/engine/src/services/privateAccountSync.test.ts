import {it,expect} from 'vitest';
import {PrivateAccountSync} from './privateAccountSync.js';
it('coalesces 100 overlapping refreshes and never publishes a superseded generation',async()=>{
  let generation=1,reads=0,resolve!:(value:any)=>void,account:any={status:'SYNCING'},events:any[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>generation,read:()=>{reads++;return new Promise(r=>resolve=r);},get:()=>account,set:v=>account=v,emit:(type,payload)=>events.push({type,payload})});
  const calls=Array.from({length:100},()=>service.sync());generation=2;resolve({asOf:Date.now()});await Promise.all(calls);
  expect(reads).toBe(1);expect(account.status).toBe('SYNCING');expect(events.at(-1).type).toBe('PRIVATE_SYNC_DISCARDED');
  const next=service.sync();resolve({asOf:Date.now(),availableUsd:100});await next;expect(account).toMatchObject({status:'READY',availableUsd:100});expect(service.health().coalesced).toBe(99);
});
it('logs transient failure and recovery without erasing last known facts',async()=>{
  let failed=true,account:any={status:'READY',availableUsd:100,asOf:1};const events:string[]=[];
  const service=new PrivateAccountSync({configured:()=>true,generation:()=>1,read:async()=>{if(failed)throw new Error('socket closed');return{availableUsd:90,asOf:Date.now()};},get:()=>account,set:v=>account=v,emit:type=>events.push(type)});
  await service.sync();expect(account).toMatchObject({status:'UNAVAILABLE',availableUsd:100});failed=false;await service.sync();expect(account).toMatchObject({status:'READY',availableUsd:90});expect(events).toContain('PRIVATE_SYNC_RECOVERED');expect(service.health().consecutiveFailures).toBe(0);
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

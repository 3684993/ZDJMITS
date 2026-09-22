import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RuntimeState} from './runtimeState.js';
import {SettingsStore} from '../config/settingsStore.js';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const settings:any={portfolio:{maxPositions:10},riskGovernance:{}};
const args={underlying:'BTC',quoteAsset:'USDT',marginUsd:60,notionalUsd:100,planId:'p',maxPositions:10,ttlSeconds:300,leaseSeconds:120,maxConcurrentReservations:10};
function state(){const s=new RuntimeState(settings);s.account.assets=[{asset:'USDT',availableBalance:100}];return s;}
describe('C2 reservation safety',()=>{
 it('retains expired reserved risk while an unknown write exists',()=>{const s=state(),r=s.reserveEntry(args);s.entryReservations.get(r.reservationId).expiresAt=1;s.entryOrders.set('o',{id:'o',symbol:'BTCUSDT',reservationId:r.reservationId,status:'UNKNOWN'});s.cleanupReservations();expect(s.entryReservations.get(r.reservationId).status).toBe('RESERVED');expect(s.reserveEntry({...args,underlying:'ETH'}).ok).toBe(false);});
 it('working reservations cannot double spend available margin',()=>{const s=state(),r=s.reserveEntry(args);s.attachReservationToIntent(r.reservationId,'i');expect(s.reserveEntry({...args,underlying:'ETH'}).ok).toBe(false);});
 it.each([NaN,Infinity,-1,0])('invalid margin %s cannot reserve',marginUsd=>expect(state().reserveEntry({...args,marginUsd}).ok).toBe(false));
 it('rejects unknown quote asset instead of bypassing balance',()=>expect(state().reserveEntry({...args,quoteAsset:'UNKNOWN'}).ok).toBe(false));
 it('durably reserves before returning and rejects a stale second writer',async()=>{
   const dir=await mkdtemp(path.join(os.tmpdir(),'v396-reservation-'));dirs.push(dir);
   const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();
   try{
     const a=state(),b=state();
     for(const s of [a,b])s.entryReservationTransaction=(revision:number,work:()=>unknown)=>(store as any).mutateEntryReservations(revision,()=>{const result=work();store.persistRuntime(s.serialize());return result;});
     const r=a.reserveEntry(args);expect(r.ok).toBe(true);
     expect((store.loadRuntime() as any).entryReservations[0][0]).toBe(r.reservationId);
     expect(b.reserveEntry({...args,underlying:'ETH'})).toMatchObject({ok:false,reason:'RESERVATION_DURABILITY_FAILED'});
     expect(b.entryReservations.size).toBe(0);
     const restored=state();restored.restore(store.loadRuntime());expect(restored.reserveEntry({...args,underlying:'ETH'}).ok).toBe(false);
   }finally{store.close();}
 });
 it('a failed durable commit leaves no in-memory claim or lock',()=>{const s=state();s.entryReservationTransaction=(_r:number,work:()=>unknown)=>{work();throw new Error('disk full');};expect(s.reserveEntry(args).ok).toBe(false);expect(s.entryReservations.size).toBe(0);expect(s.underlyingLocks.size).toBe(0);});
});

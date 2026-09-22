import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it} from 'vitest';
import {RuntimeState} from './runtimeState.js';
import {SettingsStore} from '../config/settingsStore.js';
import {privateAccountFresh} from '../services/privateAccountReadiness.js';

/**
 * C2 round-2 hostile validation (docs/plans/v396/CODEX-C2-FIX-ROUND2-20260922.md).
 *
 * Required coverage: one durable transaction for version/freshness/reservation, at most one
 * concurrent candidate inside the real headroom, no lost update across two writers, restart that
 * neither releases in-flight risk nor forks the revision, pure status reads, unrecognised statuses
 * kept occupied, and no stale private account admitting new risk.
 */

const ROOT=path.resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
const CONFIG_DIR=path.join(ROOT,'config');
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0)){try{await rm(dir,{recursive:true,force:true});}catch{/* busy handle on Windows */}}});
const tempDir=async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v396-c2-'));dirs.push(dir);return dir;};

const ARGS={underlying:'BTC',quoteAsset:'USDT',marginUsd:60,notionalUsd:1_000,planId:'plan_1',maxPositions:10,ttlSeconds:300,leaseSeconds:120,maxConcurrentReservations:10};
const settingsStub={portfolio:{maxPositions:10},riskGovernance:{}} as never;
const idOf=(result:any)=>String(result.reservationId);

/** Authoritative facts the reservation transaction now demands: fresh private account + capital route. */
function authoritative(state:RuntimeState,over:{balance?:number;asOf?:number;generation?:number;capitalVersion?:string;nextRecheckAt?:number}={}){
  const now=Date.now(),asOf=over.asOf??now;
  state.account={...state.account,status:'READY',asOf,equityUsd:over.balance??1_000,assets:[{asset:'USDT',availableBalance:over.balance??1_000}]};
  state.runtimeControl={...state.runtimeControl,capital:{...state.runtimeControl.capital,generation:over.generation??7,evaluatedAt:asOf,capitalVersion:over.capitalVersion??'capital-fixture',nextRecheckAt:over.nextRecheckAt??now+120_000}};
  return state;
}
const counters=()=>({transactions:0,persists:0});
/** The exact seam appRuntime.ts installs after restore. */
function wire(state:RuntimeState,store:SettingsStore,counter=counters()){
  state.entryReservationTransaction=(revision:number,work:()=>unknown)=>store.mutateEntryReservations(revision,()=>{counter.transactions++;const result=work();store.persistRuntime(state.serialize());counter.persists++;return result;});
  return counter;
}
const openStore=async()=>{const store=new SettingsStore(CONFIG_DIR,await tempDir());const settings=await store.load();return {store,settings};};
const durableReservation=(store:SettingsStore,id:string)=>(store.loadRuntime() as any).entryReservations.find((row:any)=>row[0]===id)?.[1];

describe('C2 one durable transaction: version, freshness, reservation',()=>{
  it('an admitted reservation carries a non-null risk binding built from the authoritative facts',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub)),counter=wire(state,store);
      const admitted=state.reserveEntry(ARGS);
      expect(admitted.ok).toBe(true);
      const binding=state.entryReservations.get(idOf(admitted)).riskBinding;
      expect(binding).not.toBeNull();
      expect(binding.riskGeneration).toBe(7);
      expect(String(binding.snapshotHash)).toMatch(/^v396r[0-9a-f]{16,}$/);
      expect(binding.evaluatedAt).toBeLessThanOrEqual(Date.now());
      expect(binding.expiresAt).toBeGreaterThan(Date.now());
      expect(counter.transactions).toBe(1);
    }finally{store.close();}
  });

  it('a caller claim that disagrees with the authoritative facts is refused',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub));
      wire(state,store);
      expect(state.reserveEntry({...ARGS,riskGeneration:6})).toMatchObject({ok:false,reason:'RISK_GENERATION_STALE'});
      expect(state.reserveEntry({...ARGS,riskCapitalVersion:'capital-other'})).toMatchObject({ok:false,reason:'CAPITAL_VERSION_STALE'});
      expect(state.entryReservations.size).toBe(0);
    }finally{store.close();}
  });

  it('stale capital facts cannot authorise a reservation even with a fresh account',async()=>{
    const {store}=await openStore();
    try{
      const now=Date.now();
      for(const over of [{generation:0},{capitalVersion:'0'},{capitalVersion:'  '},{nextRecheckAt:now-1}]){
        const state=authoritative(new RuntimeState(settingsStub),{...over,asOf:now} as never);
        wire(state,store);
        const refused=state.reserveEntry(ARGS);
        expect(refused.ok,JSON.stringify(over)).toBe(false);
        expect(['CAPITAL_GENERATION_REQUIRED','CAPITAL_VERSION_REQUIRED','CAPITAL_FACTS_EXPIRED']).toContain(refused.reason);
      }
      const neverEvaluated=new RuntimeState(settingsStub);
      authoritative(neverEvaluated);
      neverEvaluated.runtimeControl={...neverEvaluated.runtimeControl,capital:{...neverEvaluated.runtimeControl.capital,evaluatedAt:Number.NaN}};
      wire(neverEvaluated,store);
      expect(neverEvaluated.reserveEntry(ARGS)).toMatchObject({ok:false,reason:'CAPITAL_EVALUATION_UNPROVEN'});
    }finally{store.close();}
  });

  it('the S05 gate stays an extension: its refusal and its bad binding are both rejected',async()=>{
    const {store}=await openStore();
    try{
      const now=Date.now(),state=authoritative(new RuntimeState(settingsStub),{asOf:now});
      wire(state,store);
      state.entryRiskGate=()=>({allowed:false,reason:'STRESS_BUDGET_EXCEEDED'});
      expect(state.reserveEntry({...ARGS,riskGeneration:7})).toMatchObject({ok:false,reason:'STRESS_BUDGET_EXCEEDED'});
      state.entryRiskGate=()=>({allowed:true,binding:{riskGeneration:9,snapshotHash:'v396r_other',evaluatedAt:now-1,expiresAt:now+60_000}});
      expect(state.reserveEntry({...ARGS,riskGeneration:7})).toMatchObject({ok:false,reason:'RISK_BINDING_INVALID'});
      state.entryRiskGate=()=>({allowed:true,binding:{riskGeneration:7,snapshotHash:'',evaluatedAt:now-1,expiresAt:now+60_000}});
      expect(state.reserveEntry({...ARGS,riskGeneration:7})).toMatchObject({ok:false,reason:'RISK_BINDING_INVALID'});
      state.entryRiskGate=()=>({allowed:true,binding:{riskGeneration:7,snapshotHash:'v396r_ok',evaluatedAt:now-1,expiresAt:now-1}});
      expect(state.reserveEntry({...ARGS,riskGeneration:7})).toMatchObject({ok:false,reason:'RISK_BINDING_INVALID'});
      state.entryRiskGate=null;
      expect(state.reserveEntry({...ARGS,riskGeneration:7}).ok).toBe(true);
    }finally{store.close();}
  });

  it('a refusal changes no fact: same revision, no persisted payload',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub),{balance:10});
      const counter=wire(state,store);
      const revisionBefore=state.entryReservationRevision;
      expect(state.reserveEntry(ARGS)).toMatchObject({ok:false,reason:'RESERVED_QUOTE_MARGIN'});
      expect(state.reserveEntry({...ARGS,underlying:'   '})).toMatchObject({ok:false,reason:'RESERVATION_FACTS_INVALID'});
      expect(state.entryReservationRevision).toBe(revisionBefore);
      expect(counter.persists).toBe(0);
      expect(state.entryReservations.size).toBe(0);
    }finally{store.close();}
  });

  it('no production module outside RuntimeState writes the reservation maps at runtime',async()=>{
    const files=await sourceFiles(path.join(ROOT,'apps','engine','src'));
    const offenders:string[]=[];
    for(const file of files){
      const relative=path.relative(ROOT,file).replaceAll('\\','/');
      if(file.endsWith('.test.ts')||relative==='apps/engine/src/state/runtimeState.ts')continue;
      const source=await readFile(file,'utf8');
      source.split('\n').forEach((line,index)=>{if(/entryReservations\s*\.\s*(set|delete)\s*\(/.test(line))offenders.push(`${relative}:${index+1}`);});
    }
    expect(offenders,`every runtime reservation write must go through the atomic API: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('C2 concurrent writers and lost updates',()=>{
  it('two revision-current writers compete once: only one wins the headroom',async()=>{
    const {store}=await openStore();
    try{
      const a=authoritative(new RuntimeState(settingsStub),{balance:100}),b=authoritative(new RuntimeState(settingsStub),{balance:100});
      wire(a,store);wire(b,store);
      b.restore(store.loadRuntime());
      expect(a.reserveEntry(ARGS).ok).toBe(true);
      const raced=b.reserveEntry({...ARGS,underlying:'ETH'});
      expect(raced.ok,`the loser must fail closed rather than double spend: ${JSON.stringify(raced)}`).toBe(false);
      expect([...a.entryReservations.values()]).toHaveLength(1);
      const durable=store.loadRuntime() as any;
      expect(durable.entryReservations.filter((row:any)=>['RESERVED','WORKING'].includes(row[1].status)&&row[1].expiresAt>Date.now())).toHaveLength(1);
      expect(durable.entryReservationRevision).toBeGreaterThanOrEqual(1);
    }finally{store.close();}
  });

  it('two independent SettingsStore connections on one data dir still serialise on the revision',async()=>{
    const dir=await tempDir();
    const first=new SettingsStore(CONFIG_DIR,dir),second=new SettingsStore(CONFIG_DIR,dir);
    await first.load();await second.load();
    try{
      const a=authoritative(new RuntimeState(settingsStub),{balance:100}),b=authoritative(new RuntimeState(settingsStub),{balance:100});
      wire(a,first);wire(b,second);
      b.restore(first.loadRuntime());
      expect(a.reserveEntry(ARGS).ok).toBe(true);
      const raced=b.reserveEntry({...ARGS,underlying:'ETH'});
      expect(raced.ok,`second connection must not write over a newer revision: ${JSON.stringify(raced)}`).toBe(false);
      expect(first.loadRuntime().entryReservations).toHaveLength(second.loadRuntime().entryReservations.length);
      expect(second.loadRuntime().entryReservationRevision).toBe(first.loadRuntime().entryReservationRevision);
    }finally{first.close();second.close();}
  });

  it('an API-marked WORKING transition survives a second writer instead of being lost',async()=>{
    const {store}=await openStore();
    try{
      const first=authoritative(new RuntimeState(settingsStub)),counter=wire(first,store);
      const id=idOf(first.reserveEntry(ARGS));
      const stale=authoritative(new RuntimeState(settingsStub));
      stale.restore(store.loadRuntime());
      expect(first.markEntryReservationWorking(id,'intent_1')).toBe(true);
      wire(stale,store,counter);
      expect(stale.reserveEntry({...ARGS,underlying:'ETH'}).ok).toBe(false);
      const durable=durableReservation(store,id);
      expect(durable.status,'the WORKING fact must survive a revision-current second writer').toBe('WORKING');
      expect(durable.intentId).toBe('intent_1');
    }finally{store.close();}
  });

  it('a terminal row is never resurrected by an ordinary retry and only by a remote order fact',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub));
      wire(state,store);
      const id=idOf(state.reserveEntry(ARGS));
      state.entryOrders.set('order_1',{id:'order_1',reservationId:id,symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,status:'WORKING',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now(),absoluteExpiresAt:Date.now()+60_000,clientOrderId:'c_1'});
      expect(state.releaseEntryReservation(id),'release must be refused while an order occupies risk').toBe(false);
      state.entryOrders.delete('order_1');
      expect(state.releaseEntryReservation(id)).toBe(true);
      expect(state.markEntryReservationWorking(id,'intent_2')).toBe(false);
      expect(state.entryReservations.get(id).status).toBe('RELEASED');
      expect(state.markEntryReservationWorking(id,'intent_2',{orderId:'order_9',reason:'REMOTE_ORDER_FACT_ACTIVE'})).toBe(true);
      const reopened=state.entryReservations.get(id);
      expect(reopened.status).toBe('WORKING');
      expect(reopened).toMatchObject({reopenedBy:'EXCHANGE_FACT',reopenOrderId:'order_9',reopenedFromStatus:'RELEASED'});
      const committed=idOf(state.reserveEntry({...ARGS,underlying:'ETH'}));
      state.entryOrders.clear();
      expect(state.commitEntryReservation(committed)).toBe(true);
      expect(state.markEntryReservationWorking(committed,'intent_3',{orderId:'order_10',reason:'REMOTE_ORDER_FACT_ACTIVE'})).toBe(false);
      expect(state.entryReservations.get(committed).status).toBe('COMMITTED');
    }finally{store.close();}
  });
});

describe('C2 restart keeps in-flight risk and stays revision-consistent',()=>{
  it('restore loads only: no release, no transaction, no revision drift',async()=>{
    const {store}=await openStore();
    try{
      const writer=authoritative(new RuntimeState(settingsStub));
      wire(writer,store);
      const id=idOf(writer.reserveEntry(ARGS));
      writer.entryReservations.set(id,{...writer.entryReservations.get(id),expiresAt:Date.now()-1});
      store.persistRuntime(writer.serialize());
      const durable=store.loadRuntime() as any;
      const counter=wire(new RuntimeState(settingsStub),store);
      const reader=authoritative(new RuntimeState(settingsStub));
      const before=counter.transactions;
      reader.restore(durable);
      expect(reader.entryReservations.get(id).status,'restore must not release anything').toBe('RESERVED');
      expect(reader.entryReservationRevision).toBe(durable.entryReservationRevision);
      expect(counter.transactions,'restore must not open a durable transaction').toBe(before);
    }finally{store.close();}
  });

  it('the startup sequence releases provably expired risk durably and later entries still work',async()=>{
    const {store}=await openStore();
    try{
      const writer=authoritative(new RuntimeState(settingsStub));
      wire(writer,store);
      const id=idOf(writer.reserveEntry(ARGS));
      writer.entryReservations.set(id,{...writer.entryReservations.get(id),expiresAt:Date.now()-1});
      store.persistRuntime(writer.serialize());
      const restarted=authoritative(new RuntimeState(settingsStub));
      restarted.restore(store.loadRuntime());
      const counter=wire(restarted,store);
      expect(restarted.cleanupReservations()).toBe(true);
      expect(durableReservation(store,id).status).toBe('RELEASED');
      const durable=store.loadRuntime() as any;
      expect(restarted.entryReservationRevision).toBe(durable.entryReservationRevision);
      expect(counter.transactions).toBe(1);
      expect(restarted.reserveEntry({...ARGS,underlying:'ETH'}).ok,'a restart that only expired a reservation must not block later entries').toBe(true);
    }finally{store.close();}
  });

  it('an expired reservation whose UNKNOWN order is only in the durable entry store stays occupied',async()=>{
    const dir=await tempDir();
    const store=new SettingsStore(CONFIG_DIR,dir);await store.load();
    try{
      const writer=authoritative(new RuntimeState(settingsStub));
      wire(writer,store);
      const id=idOf(writer.reserveEntry({...ARGS,underlying:'ETH'}));
      writer.entryReservations.set(id,{...writer.entryReservations.get(id),expiresAt:Date.now()-1});
      writer.underlyingLocks.set('ETH',{reservationId:id,leaseUntil:Date.now()+120_000});
      store.persistRuntime(writer.serialize());
      const order={id:'order_unknown',intentId:'intent_unknown',symbol:'ETHUSDT',side:'LONG',quantity:1,price:100,filledQuantity:0,status:'UNKNOWN',reservationId:id,clientOrderId:'c_unknown',createdAt:Date.now()-20_000,updatedAt:Date.now()-20_000,absoluteExpiresAt:Date.now()+60_000} as any;
      const claim=store.claimEntryExecution(JSON.stringify(['TESTNET','binance-primary','ETHUSDT','LONG']),{intent:{id:'intent_unknown',symbol:'ETHUSDT',side:'LONG',createdAt:Date.now()-20_000} as any,order,reservation:{id,underlying:'ETH',quoteAsset:'USDT',marginUsd:60,notionalUsd:1_000,planId:'plan_1',intentId:'intent_unknown',createdAt:Date.now()-20_000,expiresAt:Date.now()-1,status:'RESERVED'} as any} as any);
      expect(claim.acquired).toBe(true);
      const now=Date.now()+60_000;
      const restored=authoritative(new RuntimeState(settingsStub),{asOf:now,nextRecheckAt:now+120_000});
      restored.restore(store.loadRuntime());
      expect(restored.entryReservations.get(id).status,'no release may happen before the durable orders are mounted').toBe('RESERVED');
      const wire2=wire(restored,store);
      const mounted=store.loadEntryExecutions();
      expect(mounted).toHaveLength(1);
      for(const saved of mounted){restored.entryIntents.set(saved.intent.id,saved.intent);restored.entryOrders.set(saved.order.id,saved.order);restored.upsertRecoveredEntryReservation(saved.reservation);}
      expect(restored.cleanupReservations(now),'the UNKNOWN order must keep its reservation occupied').toBe(false);
      expect(restored.entryReservations.get(id).status).toBe('RESERVED');
      expect(restored.reserveEntry({...ARGS,underlying:'ETH'})).toMatchObject({ok:false,reason:'UNDERLYING_LOCKED'});
      expect(durableReservation(store,id).status,'the UNKNOWN submission must stay occupied durably').toBe('RESERVED');
      expect(restored.entryReservationRevision).toBe((store.loadRuntime() as any).entryReservationRevision);
      const order2={...order,status:'CANCELED',exchangeOrderId:'e_1',exchangeTerminalStatus:'CANCELED',activeRiskExposure:false,updatedAt:now} as any;
      restored.entryOrders.set(order2.id,order2);
      expect(restored.cleanupReservations(now)).toBe(true);
      expect(durableReservation(store,id).status).toBe('RELEASED');
    }finally{store.close();}
  });
});

describe('C2 status reads never write, and odd ledger rows stay occupied',()=>{
  it('reservationSummary is a pure read even with expired rows and a failing store',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub));
      const counter=wire(state,store);
      const id=idOf(state.reserveEntry(ARGS));
      state.entryReservations.set(id,{...state.entryReservations.get(id),expiresAt:Date.now()-1});
      const summary=state.reservationSummary();
      expect(counter.transactions).toBe(1);
      expect(summary.active).toHaveLength(1);
      expect(summary.expiredReservations.map((row:any)=>row.id)).toEqual([id]);
      expect(state.reservationSummary().active).toHaveLength(1);
      expect(counter.transactions,'a status read must never open a reservation transaction').toBe(1);
      state.entryReservationTransaction=()=>{throw new Error('STORE_BUSY');};
      expect(()=>state.reservationSummary()).not.toThrow();
      expect(()=>state.entryCapacity()).not.toThrow();
      expect(state.entryCapacity().used).toBeGreaterThanOrEqual(0);
    }finally{store.close();}
  });

  it('runtimeControlStatus keeps reporting reservation diagnostics without mutating',async()=>{
    const source=await readFile(path.join(ROOT,'apps','engine','src','runtime','appRuntime.ts'),'utf8');
    expect(source).toMatch(/reservations:\s*this\.state\.reservationSummary\(\)/);
    expect(source).not.toMatch(/runtimeControlStatus\(\)\s*\{[^}]*cleanupReservations/);
    const startup=source.slice(source.indexOf('new RuntimeState(settings)'),source.indexOf('Testnet entry safety'));
    expect(startup).toContain('upsertRecoveredEntryReservation');
    expect(startup.indexOf('upsertRecoveredEntryReservation')).toBeLessThan(startup.indexOf('state.cleanupReservations()'));
    expect(startup).not.toMatch(/entryReservations\s*\.\s*set\s*\(/);
  });

  it('an unrecognised persisted status occupies margin and capacity until a mutation terminalises it',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub),{balance:100});
      wire(state,store);
      const id=idOf(state.reserveEntry(ARGS));
      state.entryReservations.set(id,{...state.entryReservations.get(id),status:'RESERVED_BUT_FORGOTTEN'});
      const admitted=state.reserveEntry({...ARGS,underlying:'ETH'});
      expect(admitted.ok,`an unknown status must count as occupied risk: ${JSON.stringify(state.entryReservations.get(id))}`).toBe(false);
      expect(state.entryCapacity().reserved).toBeGreaterThanOrEqual(1);
      const recovered=authoritative(new RuntimeState(settingsStub),{balance:100});
      recovered.restore(store.loadRuntime());
      expect(recovered.upsertRecoveredEntryReservation({id:'ghost',underlying:'SOL',quoteAsset:'USDT',marginUsd:60,notionalUsd:1_000,planId:'p',createdAt:Date.now(),expiresAt:Date.now()+120_000,status:'WHATEVER'})).toBe(true);
      const row=recovered.entryReservations.get('ghost');
      expect(row.status,'a recovered row with an unknown status is treated as occupied').toBe('WORKING');
      expect(row.recoveryReason).toBe('RESERVATION_STATUS_UNKNOWN');
      expect(recovered.entryCapacity().reserved).toBeGreaterThanOrEqual(1);
      expect(recovered.reserveEntry({...ARGS,underlying:'SOL'})).toMatchObject({ok:false,reason:'UNDERLYING_LOCKED'});
      const revisionBeforeMerge=recovered.entryReservationRevision;
      const sameRow={...recovered.entryReservations.get('ghost')};
      expect(recovered.upsertRecoveredEntryReservation(sameRow),'re-merging an identical fact must not bump the revision').toBe(false);
      expect(recovered.entryReservationRevision).toBe(revisionBeforeMerge);
    }finally{store.close();}
  });
});

describe('C2 private account facts gate admission',()=>{
  it.each([
    ['NOT_CONFIGURED with no observation time','NOT_CONFIGURED',null,'PRIVATE_ACCOUNT_NOT_CONFIGURED'],
    ['UNAVAILABLE account','UNAVAILABLE',null,'PRIVATE_ACCOUNT_UNAVAILABLE'],
    ['61 seconds old','READY',61_000,'PRIVATE_ACCOUNT_STALE'],
    ['6 seconds in the future','READY',-6_000,'PRIVATE_ACCOUNT_STALE'],
  ] as Array<[string,string,number|null,string]>)('%s cannot size a reservation',async(_name,status,ageMs,expected)=>{
    const {store}=await openStore();
    try{
      const state=new RuntimeState(settingsStub);
      const now=Date.now();
      state.account={...state.account,status,asOf:ageMs===null?null:now-ageMs,assets:[{asset:'USDT',availableBalance:100_000}]};
      state.runtimeControl={...state.runtimeControl,capital:{...state.runtimeControl.capital,generation:7,evaluatedAt:now,capitalVersion:'capital-fixture',nextRecheckAt:now+120_000}};
      wire(state,store);
      expect(privateAccountFresh(state.account,now)).toBe(false);
      const refused=state.reserveEntry(ARGS);
      expect(refused.ok,JSON.stringify(refused)).toBe(false);
      expect(refused.reason).toBe(expected);
      expect(state.entryReservations.size).toBe(0);
    }finally{store.close();}
  });

  it('a non-numeric balance is refused and a fresh READY account may proceed',async()=>{
    const {store}=await openStore();
    try{
      const broken=authoritative(new RuntimeState(settingsStub));
      broken.account={...broken.account,assets:[{asset:'USDT',availableBalance:Number.NaN}]};
      wire(broken,store);
      expect(broken.reserveEntry(ARGS).ok).toBe(false);
      const good=authoritative(new RuntimeState(settingsStub));
      wire(good,store);
      expect(good.reserveEntry(ARGS).ok).toBe(true);
    }finally{store.close();}
  });

  it('the durable payload cannot roll the reservation revision backwards',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub));
      wire(state,store);
      expect(state.reserveEntry(ARGS).ok).toBe(true);
      const revision=(store.loadRuntime() as any).entryReservationRevision;
      const tampered=store.loadRuntime() as any;
      tampered.entryReservationRevision=0;
      expect(()=>store.persistRuntime(tampered)).toThrow(/STALE_RESERVATION_CHECKPOINT/);
      expect((store.loadRuntime() as any).entryReservationRevision).toBe(revision);
    }finally{store.close();}
  });

  it('an in-flight mutation inside an active store transaction fails closed without corrupting memory',async()=>{
    const {store}=await openStore();
    try{
      const state=authoritative(new RuntimeState(settingsStub));
      wire(state,store);
      expect(store.mutateEntryReservations(state.entryReservationRevision,()=>state.reserveEntry(ARGS))).toMatchObject({ok:false});
      expect(state.entryReservations.size).toBe(0);
      expect(state.underlyingLocks.size).toBe(0);
      expect(state.reserveEntry(ARGS).ok).toBe(true);
    }finally{store.close();}
  });
});

async function sourceFiles(dir:string):Promise<string[]>{
  const out:string[]=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await sourceFiles(full));
    else if(entry.name.endsWith('.ts'))out.push(full);
  }
  return out;
}

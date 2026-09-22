import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SystemSettingsSchema } from '@zdj/contracts';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { SettingsStore } from '../config/settingsStore.js';
import { ManualPositionService } from './manualPositionService.js';
import { TpGuardian } from './tpGuardian.js';
import { manualIntentFromOrder } from './executionLifecycle.js';
import { entryIdentityTombstone } from './entryRiskOccupancy.js';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(status='WORKING') {
  const raw=JSON.parse(await readFile(path.resolve('../../config/settings.default.json'),'utf8'));
  raw.appearance.theme='BINANCE_NOIR';raw.connections.executionMode='TESTNET_ENABLED';raw.takeProfit.tpEconomicsEnabled=false;
  const state=new RuntimeState(SystemSettingsSchema.parse(raw)),events=new EventBus();state.account.status='READY';
  const p:any={cycleId:'cycle_test_1',id:'exchange_FXSUSDT_SHORT',symbol:'FXSUSDT',side:'SHORT',quantity:100,entryPrice:.31,markPrice:.30,leverage:5,tpStatus:'MISSING',tpOrderId:null};
  const quote={symbol:p.symbol,last:.3,mark:.3,bid:.299,ask:.301,stepSize:1,tickSize:.001,minQty:1,minNotional:5,ts:Date.now()};
  state.positions.set(p.id,p);state.snapshots.set(p.symbol,{symbol:p.symbol,quote} as any);
  const exchange:any={...coordinatedExchange({liveQuantity:1e6}),fetchPositions:vi.fn(async()=>[{...p}]),placeManualOrder:vi.fn(async(r:any)=>{
    if(status==='UNKNOWN')throw new Error('response lost');
    return{id:r.internalOrderId,intentId:'',clientOrderId:r.clientOrderId,exchangeOrderId:'same',positionId:p.id,symbol:p.symbol,side:r.side,positionSide:r.positionSide,type:'LIMIT',quantity:r.quantity,price:r.price,reduceOnly:true,postOnly:false,status,filledQuantity:status==='PARTIALLY_FILLED'?40:0,createdAt:Date.now(),updatedAt:Date.now()};
  }),findManualByClientOrderId:vi.fn(async()=>null),placeTakeProfit:vi.fn(async(r:any)=>({...r,exchangeOrderId:'tp-real-mock',status:'WORKING'})),cancelTakeProfit:vi.fn(async(r:any)=>({...r,status:'CANCELED'}))};
  const exitRuntime=exitRuntimeHarness();const tp=new TpGuardian(state,exchange,events,exitRuntime),market:any={snapshot:()=>({quote})};
  const reconcile=async()=>{if(status==='PARTIALLY_FILLED')state.positions.set(p.id,{...p,quantity:60});};
  return{state,p,exchange,tp,market,events,reconcile,exitRuntime};
}
describe('V3.9 execution outcomes with real services',()=>{
  it.each(['UNKNOWN','WORKING','PARTIALLY_FILLED'])('protects real remainder and joins new keys for %s',async status=>{
    const x=await fixture(status);const seen:any[]=[];x.events.on('event',event=>seen.push(event));const service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile,manualJournalHarness() as any,x.exitRuntime);
    const first=await service.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'a'});
    const second=await service.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'b'});
    expect(second.replayed).toBe(true);expect(second.order?.id).toBe(first.order.id);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();
    const remaining=x.state.positions.get(x.p.id)!;const coverage=[...x.state.tpOrders.values()].filter(o=>o.status==='WORKING');
    // C3: the live reduce-only close holds the whole quantity claim for this scope/cycle, so the
    // guardian must not add a second full exit on the same units. Protection is delegated, not lost.
    const liveClose=[...x.state.manualOrders.values()].some(o=>o.positionId===x.p.id&&['UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(String(o.status)));
    expect(liveClose).toBe(true);expect(coverage).toHaveLength(0);
    expect(seen.map(e=>String(e.payload?.message??'')).join('|')).toMatch(/QUANTITY_BUDGET_EXCEEDED|TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT/);
    expect(remaining.quantity).toBeGreaterThan(0);
  });
  it('retains UNKNOWN claim across SQLite reopen without another submission',async()=>{
    const x=await fixture('UNKNOWN'),dir=await mkdtemp(path.join(os.tmpdir(),'mits-v390-journal-'));dirs.push(dir);
    let store=new SettingsStore(path.resolve('../../config'),dir);
    await store.load();
    const journal={claim:(scope:string,value:any)=>store.claimManualExecution(scope,value),save:(value:any)=>store.saveManualExecution(value)};
    const first=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile,journal,x.exitRuntime);
    await first.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'before-crash'});store.close();
    store=new SettingsStore(path.resolve('../../config'),dir);
    await store.load();
    try{
      x.state.manualOrders.clear();x.state.manualIntents.clear();
      const restarted=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile,journal,x.exitRuntime);
      const result=await restarted.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'after-crash'});
      expect(result.replayed).toBe(true);expect(result.order?.status).toBe('UNKNOWN');expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();
    }finally{store.close();}
  },15_000);
  it.each(['CANCELED','EXPIRED','REJECTED'])('propagates delayed %s to intent',status=>{
    const next=manualIntentFromOrder({id:'i',action:'EMERGENCY_CLOSE',status:'UNKNOWN'} as any,{status,exchangeOrderId:'e'} as any,true);
    expect(next.status).toBe(status);expect(next.reason).toBe(`EXCHANGE_ORDER_${status}`);
  });
});


describe('V3.9 durable Entry ownership',()=>{
  it('enforces one underlying across database connections and retains a crash-before-response claim',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-v390-entry-cas-'));dirs.push(dir);
    const a=new SettingsStore(path.resolve('../../config'),dir);await a.load();const b=new SettingsStore(path.resolve('../../config'),dir);await b.load();
    const record:any={intent:{id:'first'},order:{id:'order-first',status:'SUBMITTING',updatedAt:1},reservation:{id:'r',status:'WORKING'}};
    try{
      expect(a.claimEntryExecution('TESTNET/account/BTC/ENTRY',record).acquired).toBe(true);
      const collision=b.claimEntryExecution('TESTNET/account/BTC/ENTRY',{...record,intent:{id:'second'},order:{id:'second',status:'SUBMITTING'}});
      expect(collision.acquired).toBe(false);expect(collision.record.intent.id).toBe('first');a.close();
      expect(b.claimEntryExecution('TESTNET/account/BTC/ENTRY',record).acquired).toBe(false);
      b.saveEntryExecution({...record,order:{...record.order,status:'CANCELED'}});
      expect(b.claimEntryExecution('TESTNET/account/BTC/ENTRY',{...record,intent:{id:'third'},order:{id:'third',status:'SUBMITTING'}}).acquired).toBe(true);
    }finally{try{a.close();}catch{}b.close();}
  });
});

describe('V3.9.5 durable entry claim release on proven no-active-risk',()=>{
  const scope='TESTNET/account/BTC/ENTRY';
  const unknownOrder=(id:string,evidence:{verified:boolean;ttlMs?:number})=>{
    const order:any={cycleId:'cycle_test_1',id,intentId:id,clientOrderId:`ml_${id}`,symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:0,exchangeOrderId:null,status:'UNKNOWN',createdAt:1,updatedAt:Date.now()};
    if(evidence.verified){order.activeRiskExposure=false;order.activeRiskEvidence={status:'VERIFIED_NO_ACTIVE_RISK',sources:['BINANCE_EXACT_ORDER_NOT_FOUND','BINANCE_OPEN_ORDERS_IDENTITY_ABSENT','BINANCE_USER_TRADES_IDENTITY_ABSENT','BINANCE_ALL_ORDERS_IDENTITY_ABSENT','BINANCE_LONG_SHORT_POSITION_ZERO'],checkedAt:Date.now(),validUntil:Date.now()+(evidence.ttlMs??300_000),identityTombstone:`ENTRY:BTCUSDT:ml_${id}`,reason:'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT'};}
    return order;
  };
  const recordFor=(id:string,evidence:{verified:boolean;ttlMs?:number})=>({intent:{id},order:unknownOrder(id,evidence),reservation:{id:`r_${id}`,status:'WORKING'}}) as any;
  const openStore=async(dir:string)=>{const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();return store;};
  const rowsOf=(store:SettingsStore)=>(store as any).db.prepare("SELECT intent_id,active,released_at,json_extract(payload,'$.order.status') status,json_extract(payload,'$.order.clientOrderId') clientOrderId FROM entry_execution_tasks ORDER BY intent_id").all();

  it('keeps blocking a second intent while an UNKNOWN submission is still genuinely unresolved',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-unresolved-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      expect(store.claimEntryExecution(scope,recordFor('first',{verified:false})).acquired).toBe(true);
      const collision=store.claimEntryExecution(scope,recordFor('second',{verified:false}));
      expect(collision.acquired).toBe(false);expect(collision.record.intent.id).toBe('first');
      expect(store.entryExecutionClaimStats().activeUnknownClaims).toBe(1);
    }finally{store.close();}
  });
  it('releases the scope once exchange facts prove no active risk and still keeps the UNKNOWN row',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-release-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      store.claimEntryExecution(scope,recordFor('first',{verified:false}));
      store.saveEntryExecution(recordFor('first',{verified:true}));
      expect(store.claimEntryExecution(scope,recordFor('second',{verified:false})).acquired).toBe(true);
      expect(rowsOf(store).find((row:any)=>row.intent_id==='first')).toMatchObject({active:0,status:'UNKNOWN'});
      expect(store.entryExecutionClaimStats()).toMatchObject({durableTasks:2,activeClaims:1,activeUnknownClaims:1,releasedClaims:1,releasedUnknownClaims:1});
    }finally{store.close();}
  });
  it('never lets a released claim re-arm the original intent, even as a rejected retry',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-no-rearm-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      store.claimEntryExecution(scope,recordFor('first',{verified:false}));
      store.saveEntryExecution(recordFor('first',{verified:true}));
      store.claimEntryExecution(scope,recordFor('second',{verified:false}));
      expect(store.claimEntryExecution(scope,recordFor('first',{verified:false}),true).acquired).toBe(false);
      expect(rowsOf(store).find((row:any)=>row.intent_id==='first').active).toBe(0);
    }finally{store.close();}
  });
  it('reports a collision instead of throwing when a proof-released intent tries to re-arm a free scope',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-rearm-empty-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      store.claimEntryExecution(scope,recordFor('first',{verified:false}));
      store.saveEntryExecution(recordFor('first',{verified:true}));
      const retry=store.claimEntryExecution(scope,recordFor('first',{verified:false}),true);
      expect(retry.acquired).toBe(false);expect(retry.record.intent.id).toBe('first');
      expect(rowsOf(store).find((row:any)=>row.intent_id==='first').active).toBe(0);
    }finally{store.close();}
  });
  it('keeps the pre-existing reprice re-arm for an order that reached a real terminal status',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-reprice-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      store.claimEntryExecution(scope,recordFor('first',{verified:false}));
      store.saveEntryExecution({intent:{id:'first'},order:{...unknownOrder('first',{verified:false}),status:'REJECTED'},reservation:null} as any);
      expect(rowsOf(store).find((row:any)=>row.intent_id==='first')).toMatchObject({active:0,released_at:0});
      expect(store.claimEntryExecution(scope,recordFor('first',{verified:false}),true).acquired).toBe(true);
    }finally{store.close();}
  });
  it('does not resurrect a released claim across restart after the evidence TTL lapses',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-restart-'));dirs.push(dir);
    const first=await openStore(dir);
    try{
      first.claimEntryExecution(scope,recordFor('first',{verified:false}));
      first.saveEntryExecution(recordFor('first',{verified:true}));
    }finally{first.close();}
    const reopened=await openStore(dir);
    try{
      reopened.saveEntryExecution(recordFor('first',{verified:true,ttlMs:-1}));
      const row=rowsOf(reopened).find((item:any)=>item.intent_id==='first')!;
      expect(row.active).toBe(0);expect(row.released_at).toBeGreaterThan(0);
      expect(reopened.claimEntryExecution(scope,recordFor('second',{verified:false})).acquired).toBe(true);
    }finally{reopened.close();}
  });
  it('restores a genuinely uncertain task across restart so it keeps blocking and cannot double-submit',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-uncertain-'));dirs.push(dir);
    const first=await openStore(dir);
    try{first.claimEntryExecution(scope,recordFor('pending',{verified:false}));}finally{first.close();}
    const reopened=await openStore(dir);
    try{
      const durable=reopened.loadEntryExecutions().find(row=>row.intent.id==='pending')!;
      reopened.saveEntryExecution(durable as any);
      expect(rowsOf(reopened).find((row:any)=>row.intent_id==='pending').active).toBe(1);
      const collision=reopened.claimEntryExecution(scope,recordFor('newintent',{verified:false}));
      expect(collision.acquired).toBe(false);expect(collision.record.intent.id).toBe('pending');
    }finally{reopened.close();}
  });
  it('gives the next entry a fresh identity instead of reusing the released intent or clientOrderId',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-identity-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      store.claimEntryExecution(scope,recordFor('first',{verified:false}));
      store.saveEntryExecution(recordFor('first',{verified:true}));
      expect(store.claimEntryExecution(scope,recordFor('second',{verified:false})).acquired).toBe(true);
      const rows=rowsOf(store);
      expect(rows.map((row:any)=>[row.intent_id,row.active,row.clientOrderId])).toEqual([['first',0,'ml_first'],['second',1,'ml_second']]);
      expect(new Set(rows.map((row:any)=>row.clientOrderId)).size).toBe(2);
    }finally{store.close();}
  });
  it('counts historical UNKNOWN orders separately from live durable claims',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'mits-claim-counts-'));dirs.push(dir);
    const store=await openStore(dir);
    try{
      for(const id of ['one','two','three']){
        const owned=`TESTNET/account/${id.toUpperCase()}/ENTRY`;
        store.claimEntryExecution(owned,recordFor(id,{verified:false}));
        store.saveEntryExecution(recordFor(id,{verified:true}));
      }
      const stats=store.entryExecutionClaimStats();
      const historical=(store as any).db.prepare("SELECT count(*) n FROM entry_execution_tasks WHERE json_extract(payload,'$.order.status')='UNKNOWN'").get().n;
      expect(historical).toBe(3);
      expect(stats).toMatchObject({durableTasks:3,activeClaims:0,activeUnknownClaims:0,releasedUnknownClaims:3});
    }finally{store.close();}
  });
});

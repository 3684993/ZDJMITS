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

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(status='WORKING') {
  const raw=JSON.parse(await readFile(path.resolve('../../config/settings.default.json'),'utf8'));
  raw.appearance.theme='BINANCE_NOIR';raw.connections.executionMode='TESTNET_ENABLED';raw.takeProfit.tpEconomicsEnabled=false;
  const state=new RuntimeState(SystemSettingsSchema.parse(raw)),events=new EventBus();state.account.status='READY';
  const p:any={id:'exchange_FXSUSDT_SHORT',symbol:'FXSUSDT',side:'SHORT',quantity:100,entryPrice:.31,markPrice:.30,leverage:5,tpStatus:'MISSING',tpOrderId:null};
  const quote={symbol:p.symbol,last:.3,mark:.3,bid:.299,ask:.301,stepSize:1,tickSize:.001,minQty:1,minNotional:5,ts:Date.now()};
  state.positions.set(p.id,p);state.snapshots.set(p.symbol,{symbol:p.symbol,quote} as any);
  const exchange:any={fetchPositions:vi.fn(async()=>[{...p}]),placeManualOrder:vi.fn(async(r:any)=>{
    if(status==='UNKNOWN')throw new Error('response lost');
    return{id:r.internalOrderId,intentId:'',clientOrderId:r.clientOrderId,exchangeOrderId:'same',positionId:p.id,symbol:p.symbol,side:r.side,positionSide:r.positionSide,type:'LIMIT',quantity:r.quantity,price:r.price,reduceOnly:true,postOnly:false,status,filledQuantity:status==='PARTIALLY_FILLED'?40:0,createdAt:Date.now(),updatedAt:Date.now()};
  }),findManualByClientOrderId:vi.fn(async()=>null),placeTakeProfit:vi.fn(async(r:any)=>({...r,exchangeOrderId:'tp-real-mock',status:'WORKING'})),cancelTakeProfit:vi.fn(async(r:any)=>({...r,status:'CANCELED'}))};
  const tp=new TpGuardian(state,exchange,events),market:any={snapshot:()=>({quote})};
  const reconcile=async()=>{if(status==='PARTIALLY_FILLED')state.positions.set(p.id,{...p,quantity:60});};
  return{state,p,exchange,tp,market,events,reconcile};
}
describe('V3.9 execution outcomes with real services',()=>{
  it.each(['UNKNOWN','WORKING','PARTIALLY_FILLED'])('protects real remainder and joins new keys for %s',async status=>{
    const x=await fixture(status),service=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile);
    const first=await service.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'a'});
    const second=await service.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'b'});
    expect(second.replayed).toBe(true);expect(second.order?.id).toBe(first.order.id);expect(x.exchange.placeManualOrder).toHaveBeenCalledOnce();
    const remaining=x.state.positions.get(x.p.id)!;const coverage=[...x.state.tpOrders.values()].filter(o=>o.status==='WORKING');
    expect(coverage).toHaveLength(1);expect(coverage[0]!.quantity).toBe(remaining.quantity);expect(remaining.tpStatus).toBe('PROTECTED');
  });
  it('retains UNKNOWN claim across SQLite reopen without another submission',async()=>{
    const x=await fixture('UNKNOWN'),dir=await mkdtemp(path.join(os.tmpdir(),'mits-v390-journal-'));dirs.push(dir);
    let store=new SettingsStore(path.resolve('../../config'),dir);
    await store.load();
    const journal={claim:(scope:string,value:any)=>store.claimManualExecution(scope,value),save:(value:any)=>store.saveManualExecution(value)};
    const first=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile,journal);
    await first.execute(x.p.id,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'before-crash'});store.close();
    store=new SettingsStore(path.resolve('../../config'),dir);
    await store.load();
    try{
      x.state.manualOrders.clear();x.state.manualIntents.clear();
      const restarted=new ManualPositionService(x.state,x.market,x.exchange,x.tp,x.events,x.reconcile,journal);
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

import {expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';
import {binanceReadContext} from '../adapters/binance/binanceReadContext.js';

it('uses lean risk facts and does not full-scan UNKNOWN state every 15 seconds',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const state=new RuntimeState(SystemSettingsSchema.parse(defaults)),now=Date.now();
    state.entryOrders.set('entry_x',{id:'entry_x',clientOrderId:'ml_x',exchangeOrderId:'123',symbol:'XLMUSDT',side:'SHORT',quantity:10,price:1,filledQuantity:0,leverage:20,status:'UNKNOWN',createdAt:now-1000,updatedAt:now-500,absoluteExpiresAt:now+60_000,repriceCount:0,intentId:'i',reachability:1} as any);
    const adapter:any={fetchPositions:vi.fn(async()=>[]),fetchOpenOrders:vi.fn(async()=>[]),findEntryByClientOrderId:vi.fn(async()=>null),fetchSymbolTradeFacts:vi.fn(async()=>({fills:[],income:[],orders:[]})),fetchSymbolRiskFacts:vi.fn(async()=>({fills:[],orders:[]}))};
    const service=new ReconciliationService(adapter,state,new EventBus(),{ensure:vi.fn()} as any);
    await service.run();
    expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledOnce();expect(adapter.fetchSymbolTradeFacts).not.toHaveBeenCalled();expect(adapter.fetchOpenOrders).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);await service.run();
    expect(adapter.fetchOpenOrders).toHaveBeenCalledOnce();expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(45_001);await service.run();
    expect(adapter.fetchOpenOrders).toHaveBeenCalledTimes(2);expect(adapter.fetchSymbolRiskFacts).toHaveBeenCalledTimes(2);
  }finally{vi.useRealTimers();}
});

it('aborts the initial private read at the reconciliation budget and releases the running guard',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const state=new RuntimeState(SystemSettingsSchema.parse(defaults));let signal:AbortSignal|undefined;
  const adapter:any={fetchPositions:vi.fn(()=>new Promise((_,reject)=>{signal=binanceReadContext()?.signal;signal!.addEventListener('abort',()=>reject(new Error('BINANCE_READ_ABORTED')),{once:true});})),fetchOpenOrders:vi.fn(async()=>[])};
  const service=new ReconciliationService(adapter,state,new EventBus(),{ensure:vi.fn()} as any),pass=service.run({startupCurrentOnly:true});
  await Promise.resolve();expect(signal?.aborted).toBe(false);await vi.advanceTimersByTimeAsync(15_001);await pass;await service.whenSettled();
  expect(signal?.aborted).toBe(true);expect(service.health().remoteReadBudget.budgetAborted).toBe(true);expect(adapter.fetchPositions).toHaveBeenCalledOnce();expect(adapter.fetchOpenOrders).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});


it('rotates failed historical exact identities rather than retrying the same first three forever',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const state=new RuntimeState(SystemSettingsSchema.parse(defaults)),now=Date.now();
  for(let i=0;i<6;i++)state.entryOrders.set(`entry_${i}`,{id:`entry_${i}`,clientOrderId:`ml_${i}`,symbol:'XLMUSDT',side:'SHORT',quantity:10,price:1,filledQuantity:0,leverage:20,status:'UNKNOWN',createdAt:now-3_600_000,updatedAt:now-500,absoluteExpiresAt:now-3_000_000,repriceCount:0,intentId:`intent_${i}`,reachability:1} as any);
  const exact=vi.fn(async()=>{throw new Error('Binance request timed out');}),adapter:any={fetchPositions:vi.fn(async()=>[]),fetchOpenOrders:vi.fn(async()=>[]),findEntryByClientOrderId:exact};
  const service=new ReconciliationService(adapter,state,new EventBus(),{ensure:vi.fn()} as any);
  await service.run();expect(exact).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(15_000);await service.run();expect(exact).toHaveBeenCalledTimes(6);
  expect(new Set(exact.mock.calls.map((args:any)=>args[0].id)).size).toBe(6);
  expect(service.health().remoteReadBudget).toMatchObject({uniqueIdentitiesAttempted:6,uniqueIdentitiesProgressed:0,oldestDeferredAgeMs:3_615_000,retryReasonsByClass:expect.arrayContaining([{class:'unknown',counts:{EXACT_QUERY_FAILED:3,BACKOFF_OR_PROOF_TTL:3}}])});
  expect([...state.entryOrders.values()].every(row=>row.status==='UNKNOWN')).toBe(true);
 }finally{vi.useRealTimers();}
});

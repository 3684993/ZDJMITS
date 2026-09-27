import {p0EntryIntegrity} from './p0EntryIntegrity.js';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {SettingsStore} from '../config/settingsStore.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ReconciliationService} from './reconciliationService.js';
import {NO_RISK_ABSENCE_SOURCES,hasVerifiedNoActiveRisk,entryOrderOccupiesRisk,durableEntryClaimActive,historicalNoRiskEligible} from './entryRiskOccupancy.js';
import {harness} from './tradingQualityTestHarness.js';
const dirs:string[]=[];afterEach(async()=>{vi.useRealTimers();for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const scope='TESTNET/account/BTC/ENTRY';
function order(id='o',now=Date.now()):any{return{id,intentId:id,symbol:'BTCUSDT',side:'LONG',status:'UNKNOWN',exchangeTerminalStatus:'UNKNOWN',clientOrderId:`ml_${id}`,exchangeOrderId:null,filledQuantity:0,quantity:1,price:100,createdAt:now-60000,updatedAt:now,absoluteExpiresAt:now+3600000,repriceCount:0,
 activeRiskExposure:false,activeRiskEvidence:{status:'VERIFIED_NO_ACTIVE_RISK',checkedAt:now-1000,validUntil:now+60000,identityTombstone:`ENTRY:BTCUSDT:ml_${id}`,sources:[...NO_RISK_ABSENCE_SOURCES,'BINANCE_LONG_SHORT_POSITION_ZERO']}};}
const record=(o:any)=>({intent:{id:o.intentId},order:o} as any);
async function storeAt(dir?:string){const dataDir=dir??await mkdtemp(path.join(os.tmpdir(),'zdj-strict-proof-'));if(!dir)dirs.push(dataDir);const store=new SettingsStore(path.resolve('../../config'),dataDir);await store.load();return{store,dataDir};}
it('hydrates malformed and expired proof verbatim but blocks new claims without waiting for a save',async()=>{
 const {store,dataDir}=await storeAt(),o=order();store.claimEntryExecution(scope,record(o));store.saveEntryExecution(record(o));
 o.activeRiskEvidence.checkedAt=null;store.saveEntryExecution(record(o));
 // Simulate a legacy database written by the old released_at latch.
 (store as any).db.prepare('UPDATE entry_execution_tasks SET active=0').run();store.close();
 const reopened=(await storeAt(dataDir)).store;
 try{const loaded=reopened.loadEntryExecutions()[0],before=JSON.stringify(loaded);expect(loaded.order).toMatchObject({status:'UNKNOWN',activeRiskEvidence:{checkedAt:null}});
  expect(hasVerifiedNoActiveRisk(loaded.order)).toBe(false);expect(entryOrderOccupiesRisk(loaded.order)).toBe(true);expect(durableEntryClaimActive(loaded.order)).toBe(true);expect(historicalNoRiskEligible(loaded.order)).toBe(false);
  expect(reopened.entryExecutionClaimStats()).toMatchObject({activeClaims:1,activeUnknownClaims:1,storedActiveClaims:0,reactivatedByProofValidation:1});
  expect(reopened.claimEntryExecution(scope,record(order('next'))).acquired).toBe(false);expect(JSON.stringify(reopened.loadEntryExecutions()[0])).toBe(before);
  const state=new RuntimeState({takeProfit:{enabled:false},portfolio:{maxPositions:10}} as any);state.restore({...state.serialize(),entryOrders:[['o',loaded.order]]});expect(state.entryCapacity().inFlight).toBe(1);
 }finally{reopened.close();}
});
it('expired proof reactivates effective claim on a pure stats/claim read, retaining release history',async()=>{
 const now=Date.now();vi.useFakeTimers({now,toFake:['Date']});const {store}=await storeAt();
 try{const o=order('o',now);store.claimEntryExecution(scope,record(o));store.saveEntryExecution(record(o));vi.advanceTimersByTime(60001);
  expect(store.entryExecutionClaimStats()).toMatchObject({activeClaims:1,storedActiveClaims:0,releasedClaims:1});
  expect(store.claimEntryExecution(scope,record(order('new'))).acquired).toBe(false);
 }finally{store.close();}
});
it('multiple reactivated proofs cannot bypass the unique active index or overwrite the current owner',async()=>{
 const {store}=await storeAt();
 try{const a=order('a'),b=order('b'),c={...order('c'),activeRiskExposure:true};
  for(const o of [a,b]){expect(store.claimEntryExecution(scope,record(o)).acquired).toBe(true);store.saveEntryExecution(record(o));}
  expect(store.claimEntryExecution(scope,record(c)).acquired).toBe(true);
  a.activeRiskEvidence.checkedAt=null;b.activeRiskEvidence.sources=[];store.saveEntryExecution(record(a));store.saveEntryExecution(record(b));
  expect(store.entryExecutionClaimStats()).toMatchObject({activeClaims:3,storedActiveClaims:1,reactivatedByProofValidation:2});
  store.saveEntryExecution(record({...c,status:'CANCELED',exchangeTerminalStatus:'CANCELED'}));
  expect(store.claimEntryExecution(scope,record(order('new'))).acquired).toBe(false);
  for(const id of ['a','b'])store.saveEntryExecution(record(order(id)));
  expect(store.claimEntryExecution(scope,record(order('new'))).acquired).toBe(true);
  expect(store.loadEntryExecutions().filter(r=>['a','b'].includes(r.order.id)).every(r=>r.order.status==='UNKNOWN')).toBe(true);
 }finally{store.close();}
});
it('terminal-UNKNOWN cannot pass through the ordinary historical terminal audit branch',async()=>{
 const state=new RuntimeState({takeProfit:{enabled:false}} as any),o={...order(),status:'CANCELED',activeRiskEvidence:{...order().activeRiskEvidence,checkedAt:null}};state.entryOrders.set('o',o);
 const reader=vi.fn(async(_s:string,start:number,end:number)=>({fills:[],orders:[],coverageComplete:false,coverageStart:start,coverageEnd:end}));
 const service=new ReconciliationService({fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>null,fetchSymbolRiskFacts:reader} as any,state,new EventBus(),{ensure:vi.fn()} as any);
 await service.run();expect(reader).toHaveBeenCalledOnce();expect(entryOrderOccupiesRisk(state.entryOrders.get('o')!)).toBe(true);
 expect(durableEntryClaimActive(state.entryOrders.get('o')!)).toBe(true);expect(service.health()).toMatchObject({entryUnknownProofValid:0,entryUnknownOccupyingRisk:1});
});
it('fresh real producer facts naturally renew invalid proof and R1/claims agree',async()=>{
 const {store}=await storeAt();try{const o=order();o.activeRiskEvidence.checkedAt=null;store.claimEntryExecution(scope,record(o));store.saveEntryExecution(record(o));
  const state=new RuntimeState({takeProfit:{enabled:false}} as any);state.entryOrders.set('o',store.loadEntryExecutions()[0].order);
  const bus=new EventBus();bus.on('RECONCILIATION_COMPLETED',()=>store.saveEntryExecution(record(state.entryOrders.get('o'))));
  const adapter={fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>null,fetchSymbolRiskFacts:async(_s:string,start:number,end:number)=>({fills:[],orders:[],coverageComplete:true,coverageStart:start,coverageEnd:end})};
  const service=new ReconciliationService(adapter as any,state,bus,{ensure:vi.fn()} as any,undefined,()=>store.entryExecutionClaimStats());
  await service.run();const saved=state.entryOrders.get('o')!;expect(hasVerifiedNoActiveRisk(saved)).toBe(true);expect(saved.status).toBe('UNKNOWN');
  expect(service.health()).toMatchObject({entryUnknownProofValid:1,entryUnknownOccupyingRisk:0});expect(store.entryExecutionClaimStats().activeClaims).toBe(0);
  await service.run();expect(service.health()).toMatchObject({activeEntryClaims:0,snapshotConsistency:'BEST_EFFORT_CROSS_STORE'});
 }finally{store.close();}
});
it('a successful absence probe cannot overwrite a newer fill arriving during its await',async()=>{
 const state=new RuntimeState({takeProfit:{enabled:false}} as any),o={...order(),activeRiskExposure:true};state.entryOrders.set('o',o);
 const adapter={fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>null,fetchSymbolRiskFacts:async(_s:string,start:number,end:number)=>{
  state.entryOrders.set('o',{...o,status:'PARTIALLY_FILLED',filledQuantity:.5,activeRiskExposure:true});return{fills:[],orders:[],coverageComplete:true,coverageStart:start,coverageEnd:end};}};
 await new ReconciliationService(adapter as any,state,new EventBus(),{ensure:vi.fn()} as any).run();
 expect(state.entryOrders.get('o')).toMatchObject({status:'PARTIALLY_FILLED',filledQuantity:.5,activeRiskExposure:true});expect(entryOrderOccupiesRisk(state.entryOrders.get('o')!)).toBe(true);
});
it('coordinator exact order recovery clears a prior absence proof before any later UNKNOWN',async()=>{
 const h=harness(),o=order();h.state.entryOrders.set('o',o);
 (h.exchange as any).findEntryByClientOrderId=vi.fn(async()=>({...o,status:'WORKING',exchangeOrderId:'real'}));
 await h.coordinator.reviewPending();expect(h.state.entryOrders.get('o')).toMatchObject({status:'WORKING',activeRiskExposure:true,activeRiskEvidence:null});
 const later={...h.state.entryOrders.get('o'),status:'UNKNOWN'} as any;expect(entryOrderOccupiesRisk(later)).toBe(true);expect(durableEntryClaimActive(later)).toBe(true);
});

it('counts terminal-UNKNOWN claims as unresolved UNKNOWN and preserves a newer exact-query result',async()=>{
 const {store}=await storeAt();try{const o={...order(),status:'CANCELED',activeRiskEvidence:{...order().activeRiskEvidence,checkedAt:null}};
  store.claimEntryExecution(scope,record(o));store.saveEntryExecution(record(o));expect(store.entryExecutionClaimStats()).toMatchObject({activeClaims:1,activeUnknownClaims:1});
  const state=new RuntimeState({takeProfit:{enabled:false}} as any);state.entryOrders.set('o',o);
  const adapter={fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>{
   state.entryOrders.set('o',{...o,status:'WORKING',exchangeOrderId:'new-fact',activeRiskExposure:true});throw new Error('old request timeout');}};
  await new ReconciliationService(adapter as any,state,new EventBus(),{ensure:vi.fn()} as any).run();
  expect(state.entryOrders.get('o')).toMatchObject({status:'WORKING',exchangeOrderId:'new-fact',activeRiskExposure:true});
 }finally{store.close();}
});

it.each([null,undefined,'1',0])('does not manufacture lifetime coverage when persisted createdAt is %s',async createdAt=>{
 const state=new RuntimeState({takeProfit:{enabled:false}} as any),o={...order(),createdAt,activeRiskExposure:true};state.entryOrders.set('o',o);
 const reader=vi.fn(async(_s:string,start:number,end:number)=>({fills:[],orders:[],coverageComplete:true,coverageStart:start,coverageEnd:end}));
 await new ReconciliationService({fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>null,fetchSymbolRiskFacts:reader} as any,state,new EventBus(),{ensure:vi.fn()} as any).run();
 expect(reader).not.toHaveBeenCalled();expect(entryOrderOccupiesRisk(state.entryOrders.get('o')!)).toBe(true);expect(hasVerifiedNoActiveRisk(state.entryOrders.get('o')!)).toBe(false);
});

it('exact-query timeout retains only valid proof and reports the same release to P0 and R1',async()=>{
 const state=new RuntimeState({takeProfit:{enabled:false}} as any),o=order();state.entryOrders.set('o',o);
 const bus=new EventBus(),events:any[]=[];bus.on('event',event=>events.push(event));
 const service=new ReconciliationService({fetchPositions:async()=>[],fetchOpenOrders:async()=>[],findEntryByClientOrderId:async()=>{throw new Error('timeout');}} as any,state,bus,{ensure:vi.fn()} as any);
 await service.run();expect(service.health()).toMatchObject({entryUnknownProofValid:1,entryUnknownOccupyingRisk:0});
 const event=events.find(e=>e.type==='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED');expect(event.payload).toMatchObject({occupancyReleased:true,activeRiskExposure:false,evidence:o.activeRiskEvidence});
 expect(p0EntryIntegrity({entryOrders:[],entryIntents:[],fills:[],primaryRuns:[],events:[event],since:0})).toMatchObject({verifiedNoActiveRiskReleaseCount:1,unverifiedRemoteTerminalReleasedOccupancyCount:0});
});

import {describe,expect,it,vi} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {EntryCancellation} from './entryCancellation.js';
import {entryCancelEligibility} from './entryCancelEligibility.js';

const order=(over:any={})=>({id:'local',intentId:'intent',reservationId:'reservation',cycleId:'cycle',symbol:'BTCUSDT',side:'LONG',clientOrderId:'client',exchangeOrderId:'remote',status:'WORKING',quantity:1,price:100,filledQuantity:0,updatedAt:10,createdAt:1,absoluteExpiresAt:1000,...over});
function setup(){
  const s=new RuntimeState({} as any);s.entryOrders.set('local',order());const bus=new EventBus(),events:any[]=[];bus.on('event',event=>events.push(event));
  const current:any={status:'READY',verifiedAt:Date.now()-10,validUntil:Date.now()+10000,items:[order()]};
  const cancel=vi.fn(async()=>order({status:'CANCELED',updatedAt:100})),persist=vi.fn();
  const release=vi.spyOn(s,'releaseEntryReservation'),hold=vi.spyOn(s,'markEntryReservationWorking');
  return{s,current,cancel,persist,release,hold,events,service:new EntryCancellation(s,bus,()=>current,cancel as any,persist)};
}
describe('explicit Entry cancel proof and convergence',()=>{
  it('only dispatches against a fresh uniquely matched remote active identity and persists the outcome',async()=>{
    const h=setup();expect(await h.service.execute('local')).toMatchObject({status:200,body:{status:'CANCELED',id:'local',cycleId:'cycle'}});
    expect(h.cancel).toHaveBeenCalledOnce();expect(h.persist).toHaveBeenCalledOnce();expect(h.release).toHaveBeenCalledOnce();
    expect(h.events).toEqual(expect.arrayContaining([expect.objectContaining({type:'ENTRY_ORDER_CANCELED_MANUAL',payload:expect.objectContaining({status:'CANCELED'})})]));
    expect((await h.service.execute('local')).status).toBe(409);expect(h.cancel).toHaveBeenCalledOnce();
  });
  it.each(['UNKNOWN','NEW','SUBMITTING'])('absent %s is not remotely cancellable',async status=>{
    const h=setup();h.s.entryOrders.set('local',order({status}));h.current.items=[];
    expect(await h.service.execute('local')).toMatchObject({status:409,body:{error:{code:'ENTRY_NOT_CONFIRMED_OPEN_ON_EXCHANGE'}}});expect(h.cancel).not.toHaveBeenCalled();
  });
  it.each(['STALE','UNAVAILABLE'])('refuses %s without a request',async status=>{
    const h=setup();h.current.status=status;expect((await h.service.execute('local')).status).toBe(503);expect(h.cancel).not.toHaveBeenCalled();
  });
  it('also rejects expired or future READY metadata',()=>{
    const current:any={status:'READY',items:[order()],verifiedAt:100,validUntil:200};
    expect(entryCancelEligibility(order(),current,201).allowed).toBe(false);expect(entryCancelEligibility(order(),current,99).allowed).toBe(false);
  });
  it('rejects cross-symbol, missing identity, conflict and ambiguous remote proof',()=>{
    for(const items of [[order({symbol:'ETHUSDT'})],[order({clientOrderId:undefined,exchangeOrderId:undefined})],[order({exchangeOrderId:'wrong'})],[order(),order()]]){
      expect(entryCancelEligibility(order(),{status:'READY',verifiedAt:1,validUntil:100,items},50).allowed).toBe(false);}
  });
  it('blocks a concurrent duplicate and retains the claim on a timeout',async()=>{
    const h=setup();let reject!:(e:Error)=>void;h.cancel.mockImplementation(()=>new Promise((_resolve,r)=>{reject=r;}));
    const pending=h.service.execute('local');expect(await h.service.execute('local')).toMatchObject({status:409,body:{error:{code:'ENTRY_CANCEL_IN_PROGRESS'}}});
    reject(new Error('timeout'));expect((await pending).status).toBe(502);expect(h.cancel).toHaveBeenCalledOnce();expect(h.release).not.toHaveBeenCalled();expect(h.hold).toHaveBeenCalledOnce();
    expect(h.s.entryOrders.get('local')).toMatchObject({status:'UNKNOWN',activeRiskExposure:true});expect(h.persist).toHaveBeenCalledOnce();
  });
  it.each(['UNKNOWN','WORKING'])('does not release the claim for a nonterminal %s response',async status=>{
    const h=setup();h.cancel.mockResolvedValue(order({status}));expect((await h.service.execute('local')).status).toBe(502);expect(h.release).not.toHaveBeenCalled();
  });
  it('does not apply a terminal response for another order',async()=>{
    const h=setup();h.cancel.mockResolvedValue(order({status:'CANCELED',exchangeOrderId:'other'}));
    expect((await h.service.execute('local')).status).toBe(502);expect(h.release).not.toHaveBeenCalled();
  });
  it.each(['CANCELED','UNKNOWN'])('concurrent FILLED wins against delayed %s',async status=>{
    const h=setup();h.cancel.mockImplementation(async()=>{h.s.entryOrders.set('local',order({status:'FILLED',filledQuantity:1,updatedAt:200}));return order({status,updatedAt:300});});
    expect(await h.service.execute('local')).toMatchObject({status:200,body:{status:'FILLED',filledQuantity:1}});expect(h.release).toHaveBeenCalledOnce();
    expect(h.events.some(event=>event.type==='ENTRY_ORDER_CANCELED_MANUAL')).toBe(false);
    expect(h.events).toEqual(expect.arrayContaining([expect.objectContaining({type:'ENTRY_CANCEL_TERMINAL_CONFIRMED',payload:expect.objectContaining({status:'FILLED'})})]));
  });
  it('preserves local decision clock and candidate authorization when the exchange ACK carries defaults',async()=>{
    const h=setup(),local={decisionCompletedAt:100,decisionExecutionExpiresAt:60100,selectedCandidateId:'candidate-local',candidateSetHash:'hash-local',opportunityAuthorization:{opportunityId:'opp-local',eventExpiresAt:90000},economicMandate:{mandateId:'main-mandate'},planId:'main-plan',decisionChainId:'local-chain'};
    h.s.entryOrders.set('local',order(local));
    h.cancel.mockResolvedValue(order({status:'CANCELED',updatedAt:300,decisionCompletedAt:0,decisionExecutionExpiresAt:0,selectedCandidateId:'old',candidateSetHash:'old',opportunityAuthorization:undefined,economicMandate:{mandateId:'wrong'},planId:'wrong',decisionChainId:'wrong',quantity:9,price:999}));
    expect(await h.service.execute('local')).toMatchObject({status:200,body:local});
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({...local,quantity:1,price:100}));
  });
  it.each(['FILLED','EXPIRED','REJECTED'])('reports actual terminal %s without claiming a cancel',async status=>{
    const h=setup();h.cancel.mockResolvedValue(order({status,updatedAt:300}));
    expect(await h.service.execute('local')).toMatchObject({status:200,body:{status}});
    expect(h.events.some(event=>event.type==='ENTRY_ORDER_CANCELED_MANUAL')).toBe(false);
    expect(h.events).toEqual(expect.arrayContaining([expect.objectContaining({type:'ENTRY_CANCEL_TERMINAL_CONFIRMED',payload:expect.objectContaining({status})})]));
  });
  it('retains partial fills when cancellation is confirmed and does not touch TP',async()=>{
    const h=setup();h.s.tpOrders.set('tp',{id:'tp',status:'WORKING'} as any);h.s.entryOrders.set('local',order({status:'PARTIALLY_FILLED',filledQuantity:.4}));
    expect(await h.service.execute('local')).toMatchObject({status:200,body:{status:'CANCELED',filledQuantity:.4}});expect(h.s.tpOrders.get('tp')).toEqual({id:'tp',status:'WORKING'});
  });
});

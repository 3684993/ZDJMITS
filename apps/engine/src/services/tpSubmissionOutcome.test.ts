import {describe,it,expect,vi} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';
import {confirmedTpSubmissionRejection,confirmedTpNotSent} from './tpSubmissionOutcome.js';
import { exitRuntimeHarness, manualJournalHarness, coordinatedExchange } from './v396ExitTestHarness.js';
const settings:any={takeProfit:{enabled:true,targetPriceMovePercent:.45,quantityPercent:100,tpEconomicsEnabled:false,minNetProfitUsd:.01,minNetProfitRoiPct:0,feeSafetyBufferPct:0,exitFeeAssumption:'TAKER',slippageBufferPct:0,entryFeeRate:.0004,makerFeeRate:.0002,takerFeeRate:.0004}};
function fixture(message:string){const state=new RuntimeState(settings),position:any={id:'p',cycleId:'cycle_test_1',symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:1,tpStatus:'MISSING',tpOrderId:null},events=new EventBus(),seen:any[]=[];events.on('event',e=>seen.push(e));state.positions.set('p',position);state.snapshots.set('BTCUSDT',{quote:{mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.001,minQty:.001}} as any);const exchange:any={...coordinatedExchange({liveQuantity:1e6}),placeTakeProfit:vi.fn().mockRejectedValue(new Error(message)),findTakeProfitByClientOrderId:vi.fn().mockResolvedValue(null)},runtime=exitRuntimeHarness();return{state,position,exchange,seen,events,runtime,guardian:new TpGuardian(state,exchange,events,runtime)};}

it('settles local preparation persistence failure without claiming an adapter call or leaking a quantity claim',async()=>{
 const f=fixture('unused');const fail=(event:any)=>{if(event.type==='TP_SUBMISSION_PREPARED')throw Error('database is locked');};f.events.on('event',fail);
 try{
  await f.guardian.ensure(f.position);const first=[...f.state.tpOrders.values()][0]!;
  expect(f.exchange.placeTakeProfit).not.toHaveBeenCalled();expect(first.status).toBe('REJECTED');expect(f.runtime.task(first.clientOrderId!)?.state).toBe('REJECTED');expect(f.runtime.adoptedUnits({symbol:'BTCUSDT',side:'LONG',cycleId:'cycle_test_1'})).toBe(0);
  expect(f.seen.find(e=>e.type==='TP_REPAIR_FAILED')?.payload.submissionOutcome).toBe('NOT_ATTEMPTED');
  f.events.off('event',fail);f.exchange.placeTakeProfit.mockImplementation(async(order:any)=>({...order,status:'WORKING',exchangeOrderId:'confirmed-new-id'}));
  await f.guardian.ensure(f.state.positions.get('p')!,true);expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);expect(f.state.positions.get('p')?.tpStatus).toBe('PROTECTED');
 }finally{f.events.off('event',fail);f.runtime.close();}
});

it('recovers an old pre-wire UNKNOWN only from complete atomic version history, refusing missing history and wrong environment',async()=>{
 const f=fixture('unused'),abort=vi.spyOn(f.runtime,'abortTpNotSent').mockReturnValue(null);const fail=(event:any)=>{if(event.type==='TP_SUBMISSION_PREPARED')throw Error('database is locked');};f.events.on('event',fail);
 try{
  await f.guardian.ensure(f.position);abort.mockRestore();f.events.off('event',fail);const row=[...f.state.tpOrders.values()][0]!,id=row.clientOrderId!;
  expect(f.exchange.placeTakeProfit).not.toHaveBeenCalled();expect(f.runtime.task(id)?.state).toBe('PREPARED');f.runtime.markSubmitUncertain(id);const task=f.runtime.task(id)!;expect(task.version).toBe(2);
  const journal=(f.runtime as any).journal,key=JSON.stringify([task.scope,task.cycleId,task.taskId,1]),saved=journal.query('SELECT payload FROM v396_outbox WHERE id=?',key)[0].payload;
  journal.write('DELETE FROM v396_outbox WHERE id=?',key);expect(f.runtime.abortTpNeverSubmitted(id)).toBeNull();expect(f.runtime.task(id)?.state).toBe('UNKNOWN');journal.write('INSERT INTO v396_outbox(id,payload) VALUES(?,?)',key,saved);
  const identity=vi.spyOn(f.runtime as any,'exchangeIdentity').mockReturnValue({environment:'PRODUCTION',account:'binance-primary'});expect(f.runtime.abortTpNeverSubmitted(id)).toBeNull();identity.mockRestore();
  expect(f.runtime.abortTpNeverSubmitted(id)?.state).toBe('REJECTED');expect(f.runtime.adoptedUnits({symbol:'BTCUSDT',side:'LONG',cycleId:'cycle_test_1'})).toBe(0);
 }finally{abort.mockRestore();f.events.off('event',fail);f.runtime.close();}
});

it('does not relabel an adapter database error or a forged pre-wire message as never sent',async()=>{
 for(const message of ['database is locked','TP_LOCAL_PREWIRE_FAILED: database is locked']){
  const f=fixture(message);
  try{expect(confirmedTpNotSent(new Error(message))).toBe(false);await f.guardian.ensure(f.position);const order=[...f.state.tpOrders.values()][0]!;expect(order.status).toBe('UNKNOWN');expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);expect(f.runtime.abortTpNeverSubmitted(order.clientOrderId!)).toBeNull();await f.guardian.ensure(f.state.positions.get('p')!,true);expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);}
  finally{f.runtime.close();}
 }
});
describe('TP submission outcome',()=>{
 it('reuses existing full TP coverage even when the position points to an older terminal order',async()=>{const f=fixture('should not submit');f.position.tpOrderId='old';f.state.tpOrders.set('old',{id:'old',positionId:'p',symbol:'BTCUSDT',side:'SELL',quantity:1,price:101,status:'REJECTED',exchangeOrderId:null,createdAt:1,updatedAt:1});f.state.tpOrders.set('covered',{id:'covered',positionId:'p',symbol:'BTCUSDT',side:'SELL',quantity:1,price:101,status:'WORKING',exchangeOrderId:'123',createdAt:2,updatedAt:2});await f.guardian.ensure(f.position);expect(f.exchange.placeTakeProfit).not.toHaveBeenCalled();expect(f.state.positions.get('p')?.tpOrderId).toBe('covered');});
 it('records a definite -2022 rejection without retaining phantom UNKNOWN and respects backoff',async()=>{const f=fixture('Binance HTTP 400: {"code":-2022,"msg":"ReduceOnly Order is rejected."}');await f.guardian.ensure(f.position);const order=[...f.state.tpOrders.values()][0]!;expect(order.status).toBe('REJECTED');expect(f.seen.find(e=>e.type==='TP_ORDER_REJECTED').payload.clientOrderId).toBe(order.clientOrderId);await f.guardian.ensure(f.position);expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);expect(f.guardian.metrics().unverifiedTp).toBe(0);});
 it('preserves uncertain network outcomes and forbids another submission',async()=>{const f=fixture('BINANCE_TRANSPORT_BLOCKED: request timed out');await f.guardian.ensure(f.position);await f.guardian.ensure(f.position,true);expect([...f.state.tpOrders.values()][0]!.status).toBe('UNKNOWN');expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);});
 it('does not interpret duplicate, lookup-not-found, malformed or 5xx responses as definitive rejection',()=>{for(const message of ['Binance HTTP 400: {"code":-2010,"msg":"Duplicate order"}','Binance HTTP 400: {"code":-2013}','Binance HTTP 500: {"code":-2022}','Binance HTTP 400: {"code":-2022','untrusted -2022'])expect(confirmedTpSubmissionRejection(message)).toBe(false);});
});

it('confirmed rejected TP may be repaired as a new intent while uncertainty may not',async()=>{
 const f=fixture('Binance HTTP 400: {"code":-2022,"msg":"ReduceOnly Order is rejected."}');
 await f.guardian.ensure(f.position);await f.guardian.ensure(f.state.positions.get('p')!,true);
 expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(2);
 const ids=f.exchange.placeTakeProfit.mock.calls.map((call:any[])=>call[0].clientOrderId);expect(new Set(ids).size).toBe(2);
});

it('releases a proven pre-wire egress refusal without fabricating an exchange rejection',async()=>{
 const f=fixture('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE');
 await f.guardian.ensure(f.position);
 expect([...f.state.tpOrders.values()][0]!.status).toBe('REJECTED');
 expect(f.seen.some(e=>e.type==='TP_SUBMISSION_NOT_SENT'&&e.payload.exchangeRequestSent===false)).toBe(true);
 expect(f.seen.find(e=>e.type==='TP_REPAIR_FAILED')?.payload.submissionOutcome).toBe('NOT_ATTEMPTED');
 await f.guardian.ensure(f.state.positions.get('p')!,true);
 expect(f.exchange.placeTakeProfit).toHaveBeenCalledTimes(2);
});

it('finds and cancels an under-sized working TP after a failed repair cleared the position pointer',async()=>{
 const f=fixture('TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE');
 f.state.tpOrders.set('old',{id:'old',positionId:'p',symbol:'BTCUSDT',side:'SELL',quantity:.5,price:101,status:'WORKING',exchangeOrderId:'123',createdAt:1,updatedAt:1});
 f.exchange.cancelTakeProfit=vi.fn(async(order:any)=>({...order,status:'CANCELED',updatedAt:Date.now()}));
 await f.guardian.ensure(f.position,true);
 expect(f.exchange.cancelTakeProfit).toHaveBeenCalledTimes(1);
 expect(f.state.tpOrders.get('old')?.status).toBe('CANCELED');
});

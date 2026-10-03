import {describe,expect,it} from 'vitest';
import {entryCancelEligibility} from './entryCancelEligibility.js';

const order=(status='WORKING')=>({id:'local-id',clientOrderId:'client-id',exchangeOrderId:'exchange-id',symbol:'BTCUSDT',status});
describe('Entry cancellation requires a fresh exact exchange order fact',()=>{
  const current={status:'READY' as const,verifiedAt:Date.now()-1000,validUntil:Date.now()+60000,items:[order()]};
  it('allows a confirmed active exchange order',()=>expect(entryCancelEligibility(order(),current).allowed).toBe(true));
  it('refuses historical UNKNOWN absent from openOrders without a cancel request',()=>expect(entryCancelEligibility(order('UNKNOWN'),{...current,items:[]}).code).toBe('ENTRY_NOT_CONFIRMED_OPEN_ON_EXCHANGE'));
  it('refuses if the snapshot is stale or unavailable',()=>expect(entryCancelEligibility(order(),{...current,status:'STALE',items:[]}).code).toBe('EXCHANGE_OPEN_ORDERS_READBACK_UNAVAILABLE'));
  it('refuses an already terminal order and repeated cancel',()=>expect(entryCancelEligibility(order('CANCELED'),current).code).toBe('ENTRY_ORDER_ALREADY_TERMINAL'));
  it('does not authorize cancellation after identity mismatch',()=>expect(entryCancelEligibility(order(),{...current,items:[{...order(),id:'other',clientOrderId:'other',exchangeOrderId:'other'}]}).allowed).toBe(false));
});

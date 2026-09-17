import {describe,expect,it} from 'vitest';
import {activeEntryOrdersForProjection} from './projections.js';

const order=(id:string,status:string,extra:Record<string,unknown>={})=>({
  id,intentId:`intent_${id}`,reservationId:null,clientOrderId:`ml_${id}`,exchangeOrderId:null,
  symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:0,leverage:1,status,
  createdAt:1,updatedAt:1,absoluteExpiresAt:2,repriceCount:0,reachability:1,...extra,
} as any);

describe('active Entry dashboard projection',()=>{
  it('keeps unresolved UNKNOWN active but hides VERIFIED_NO_ACTIVE_RISK UNKNOWN without rewriting history',()=>{
    const now=Date.now();
    const historical=order('historical','UNKNOWN',{
      activeRiskExposure:false,
      exchangeTerminalStatus:'UNKNOWN',
      activeRiskEvidence:{
        status:'VERIFIED_NO_ACTIVE_RISK',
        checkedAt:now,
        validUntil:now+60_000,
        identityTombstone:'ENTRY:BTCUSDT:ml_historical',
        sources:['BINANCE_EXACT_ORDER_NOT_FOUND'],
        reason:'EXCHANGE_TERMINAL_STATUS_UNKNOWN_CURRENT_RISK_ABSENT',
      },
    });
    const unresolved=order('unresolved','UNKNOWN',{activeRiskExposure:true,exchangeTerminalStatus:'UNKNOWN'});
    const working=order('working','WORKING');
    const canceled=order('canceled','CANCELED');
    const active=activeEntryOrdersForProjection([historical,unresolved,working,canceled],now);
    expect(active.map(row=>row.id)).toEqual(['unresolved','working']);
    expect(historical.status).toBe('UNKNOWN');
    expect(historical.exchangeTerminalStatus).toBe('UNKNOWN');
  });
});
import {expect,it,vi} from 'vitest';
import {RequestBudget} from './requestBudget.js';

it('keeps fresh Binance proxy weight authoritative after counter-domain discontinuity',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const budget=new RequestBudget(2,1,100,{softPublicWeight:1000,softBackgroundWeight:1800,hardWeight:2200});
    budget.observe(200,'1600',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});
    budget.observe(200,'34',undefined,{source:'CLOCK',endpoint:'/fapi/v1/time'});
    expect(budget.health().observationTrust).toBe('INCONSISTENT');
    budget.observe(200,'2301',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/positionRisk'});
    expect(budget.health()).toMatchObject({status:'SATURATED',admissionObservedWeight1m:2301,usedWeight1m:2301});
    const publicFn=vi.fn(),pending=budget.run(2,1,publicFn),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});

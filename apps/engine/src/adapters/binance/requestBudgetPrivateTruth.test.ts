import {expect,it,vi} from 'vitest';
import {RequestBudget} from './requestBudget.js';

it('learns the exchange REQUEST_WEIGHT limit and preserves a private truth reserve',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const budget=new RequestBudget(6,4,8);
    budget.configureRequestWeightLimit(6000);
    expect(budget.health()).toMatchObject({requestWeightLimit1m:6000,limitSource:'BINANCE_EXCHANGE_INFO',softPublicWeight:3000,softBackgroundWeight:4320,hardWeight:5100,privateTruthWeight:5700});
    budget.observe(200,'5200',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/positionRisk'});
    expect(budget.health().status).toBe('PRIVATE_ONLY');
    const privateFn=vi.fn(async()=>42),result=await budget.run(0,5,privateFn,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/positionRisk'});
    expect(result).toBe(42);expect(privateFn).toHaveBeenCalledOnce();
    const publicFn=vi.fn(async()=>1),pending=budget.run(2,1,publicFn,{source:'MARKET_DATA',endpoint:'/fapi/v1/klines'}),rejected=expect(pending).rejects.toThrow('QUEUE_TIMEOUT');
    await vi.advanceTimersByTimeAsync(5100);await rejected;expect(publicFn).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});

it('admits bounded control probes above the private-truth ceiling so stale weight can recover',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const budget=new RequestBudget(2,1,8);budget.configureRequestWeightLimit(6000);budget.observe(200,'6106',undefined,{source:'MARKET_DATA',endpoint:'/fapi/v1/ticker/24hr'});
    expect(budget.health().status).toBe('SATURATED');
    const clock=vi.fn(async()=>({serverTime:Date.now()}));await expect(budget.run(0,1,clock,{source:'CLOCK',endpoint:'/fapi/v1/time'})).resolves.toBeTruthy();expect(clock).toHaveBeenCalledOnce();
    const second=vi.fn(async()=>1),pending=budget.run(0,1,second,{source:'CLOCK',endpoint:'/fapi/v1/time'});await vi.advanceTimersByTimeAsync(4_999);expect(second).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(2);await expect(pending).resolves.toBe(1);expect(second).toHaveBeenCalledOnce();
  }finally{vi.useRealTimers();}
});

it('never locally blocks a zero-weight execution request solely because REQUEST_WEIGHT is saturated',async()=>{
  const budget=new RequestBudget(2,1,8);budget.configureRequestWeightLimit(6000);budget.observe(200,'6106',undefined,{source:'MARKET_DATA',endpoint:'/fapi/v1/ticker/24hr'});
  const execute=vi.fn(async()=> 'ok');await expect(budget.run(0,0,execute,{source:'EXECUTION_CRITICAL',endpoint:'/fapi/v1/order',method:'POST'})).resolves.toBe('ok');expect(execute).toHaveBeenCalledOnce();
});

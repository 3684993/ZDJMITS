import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ExternalTradeAdapter} from './ExternalTradeAdapter.js';

const NOW=1_800_000_000_000;
const restricted=new Error('Binance HTTP 451: Service unavailable from a restricted location');
function harness(clock:()=>Promise<{serverTime:number}>){
  const json=vi.fn(async(path:string)=>path==='/fapi/v1/time'?clock():[]);
  const adapter=new ExternalTradeAdapter({json,environment:()=> 'TESTNET',assertTestnetExchangeWrite:()=>{}} as never,{apiKey:'key',apiSecret:'secret'});
  return{adapter,json,clockCalls:()=>json.mock.calls.filter(([path])=>path==='/fapi/v1/time').length};
}

describe('private clock failure recovery',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);});
  afterEach(()=>{vi.useRealTimers();});

  it('shares concurrent failures and backs off repeated callers to a bounded thirty-second probe',async()=>{
    const h=harness(async()=>{throw restricted;});
    const failBurst=async()=>{
      const results=await Promise.allSettled(Array.from({length:20},()=>h.adapter.fetchOpenOrders()));
      for(const result of results){expect(result.status).toBe('rejected');if(result.status==='rejected')expect(result.reason).toBe(restricted);}
    };
    await failBurst();
    expect(h.clockCalls()).toBe(1);
    for(const delay of [5000,10000,20000,30000,30000]){
      const before=h.clockCalls();
      // Match the live one-second callers, including the instant before recovery is due.
      for(let elapsed=1000;elapsed<delay;elapsed+=1000){vi.advanceTimersByTime(1000);await failBurst();}
      vi.advanceTimersByTime(999);await failBurst();
      expect(h.clockCalls()).toBe(before);
      vi.advanceTimersByTime(1);await failBurst();
      expect(h.clockCalls()).toBe(before+1);
    }
    expect(h.json.mock.calls.every(([path])=>path==='/fapi/v1/time')).toBe(true);
  });

  it('single-flights recovery, signs only after fresh clock success, and resets the backoff',async()=>{
    let mode:'FAIL'|'RECOVER'='FAIL',resolveClock!:(value:{serverTime:number})=>void;
    const h=harness(()=>mode==='FAIL'?Promise.reject(restricted):new Promise(resolve=>{resolveClock=resolve;}));
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    vi.advanceTimersByTime(5000);mode='RECOVER';
    const reads=Array.from({length:20},()=>h.adapter.fetchOpenOrders());
    expect(h.clockCalls()).toBe(2);
    expect(h.json.mock.calls).toHaveLength(2);
    resolveClock({serverTime:Date.now()+1234});
    await expect(Promise.all(reads)).resolves.toEqual(Array.from({length:20},()=>[]));
    const signed=h.json.mock.calls.filter(([path])=>path.startsWith('/fapi/v1/openOrders?'));
    expect(signed).toHaveLength(20);
    for(const [path] of signed)expect(new URL(path,'https://demo-fapi.binance.com').searchParams.get('timestamp')).toBe(String(Date.now()+1234));
    vi.advanceTimersByTime(30_001);mode='FAIL';
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    expect(h.clockCalls()).toBe(3);
    vi.advanceTimersByTime(4999);
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    expect(h.clockCalls()).toBe(3);
    vi.advanceTimersByTime(1);
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    expect(h.clockCalls()).toBe(4);
  });

  it('blocks signed reads and writes after the cached clock expires and refresh fails',async()=>{
    let available=true;
    const h=harness(async()=>{if(!available)throw restricted;return{serverTime:Date.now()+500};});
    await h.adapter.fetchOpenOrders();
    expect(h.json.mock.calls).toHaveLength(2);
    vi.advanceTimersByTime(30_001);available=false;
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    const failedCalls=h.json.mock.calls.length;
    await expect(h.adapter.cancelEntry({symbol:'BTCUSDT',clientOrderId:'ML_existing'} as never)).rejects.toBe(restricted);
    await expect(h.adapter.fetchRealizedPnlSince(NOW)).rejects.toBe(restricted);
    expect(h.json.mock.calls).toHaveLength(failedCalls);
    expect(h.clockCalls()).toBe(2);
  });

  it('also backs off invalid clock responses without treating them as successful syncs',async()=>{
    let valid=false;
    const h=harness(async()=>({serverTime:valid?Date.now():Number.NaN}));
    const failure=await h.adapter.fetchOpenOrders().catch(error=>error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe('BINANCE_CLOCK_INVALID');
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(failure);
    expect(h.clockCalls()).toBe(1);
    vi.advanceTimersByTime(5000);valid=true;
    await expect(h.adapter.fetchOpenOrders()).resolves.toEqual([]);
    expect(h.clockCalls()).toBe(2);
  });

  it('preserves the bounded public-clock backoff across credential changes',async()=>{
    let available=false;
    const h=harness(async()=>{if(!available)throw restricted;return{serverTime:Date.now()};});
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    h.adapter.setCredentials({apiKey:'new-key',apiSecret:'new-secret'});available=true;
    vi.advanceTimersByTime(4999);
    await expect(h.adapter.fetchOpenOrders()).rejects.toBe(restricted);
    expect(h.clockCalls()).toBe(1);
    vi.advanceTimersByTime(1);
    await expect(h.adapter.fetchOpenOrders()).resolves.toEqual([]);
    expect(h.clockCalls()).toBe(2);
  });
});

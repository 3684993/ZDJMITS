import {afterEach,expect,it,vi} from 'vitest';
import {BinancePublicMarketDataProvider} from './BinancePublicMarketDataProvider.js';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('coalesces concurrent exchangeInfo reads into one Binance request',async()=>{
  let release!:(value:any)=>void;
  const json=vi.fn((path:string)=>path==='/fapi/v1/exchangeInfo'?new Promise(resolve=>{release=resolve;}):Promise.resolve([]));
  const provider=new BinancePublicMarketDataProvider({json,environment:()=> 'TESTNET'} as any);
  const reads=Array.from({length:50},()=>((provider as any).info()));
  await Promise.resolve();
  expect(json.mock.calls.filter(call=>call[0]==='/fapi/v1/exchangeInfo')).toHaveLength(1);
  release({symbols:[]});
  await Promise.all(reads);
  expect(json.mock.calls.filter(call=>call[0]==='/fapi/v1/exchangeInfo')).toHaveLength(1);
});

it('coalesces failures and holds the same bounded cooldown across repeated retention refreshes',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);
  let fail!:(error:Error)=>void;
  const failure=new Error('PUBLIC_METADATA_TIMEOUT'),value={symbols:[]};
  const json=vi.fn().mockReturnValueOnce(new Promise((_resolve,reject)=>{fail=reject;})).mockResolvedValue(value);
  const provider=new BinancePublicMarketDataProvider({json,environment:()=> 'TESTNET'} as any);
  vi.spyOn((provider as any).stream,'start').mockImplementation(()=>{});
  const reads=Array.from({length:50},()=>((provider as any).info()));
  const outcomes=Promise.allSettled(reads);
  expect(json).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  fail(failure);
  expect((await outcomes).every(row=>row.status==='rejected'&&row.reason===failure)).toBe(true);
  for(const elapsed of [0,1_000,59_999]){
    vi.setSystemTime(1_030_000+elapsed);
    provider.setLiveSymbols(['BTCUSDT']);
    provider.setLiveSymbols(['ETHUSDT']);
    await expect((provider as any).info()).rejects.toBe(failure);
    expect(json).toHaveBeenCalledTimes(1);
  }
  // Reading at 59,999ms must not push the deadline forward; the next caller may retry at 60s.
  vi.setSystemTime(1_090_000);
  provider.setLiveSymbols(['BTCUSDT']);
  const recovered=await Promise.all(Array.from({length:50},()=>((provider as any).info())));
  expect(recovered.every(row=>row===value)).toBe(true);
  expect(json).toHaveBeenCalledTimes(2);
  expect((provider as any).exchangeInfoFailure).toBeNull();
  await expect((provider as any).info()).resolves.toBe(value);
  expect(json).toHaveBeenCalledTimes(2);
});

it('keeps successful metadata for fifteen minutes measured from completion',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);
  let complete!:(value:any)=>void;
  const first={symbols:[]},second={symbols:[{symbol:'ETHUSDT'}]};
  const json=vi.fn().mockReturnValueOnce(new Promise(resolve=>{complete=resolve;})).mockResolvedValue(second);
  const provider=new BinancePublicMarketDataProvider({json} as any);
  const pending=(provider as any).info();
  vi.advanceTimersByTime(20_000);complete(first);
  await expect(pending).resolves.toBe(first);
  vi.advanceTimersByTime(15*60_000-1);
  await expect((provider as any).info()).resolves.toBe(first);
  expect(json).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await expect((provider as any).info()).resolves.toBe(second);
  expect(json).toHaveBeenCalledTimes(2);
});

it('refuses expired trading rules on both quote paths during failure cooldown and recovers new rules',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_000_000);
  const metadata=(tickSize:string)=>({symbols:[{symbol:'BTCUSDT',filters:[
    {filterType:'PRICE_FILTER',tickSize},{filterType:'LOT_SIZE',minQty:'0.001',stepSize:'0.001'},
    {filterType:'MIN_NOTIONAL',notional:'5'},
  ]}]});
  const failure=new Error('PUBLIC_METADATA_TIMEOUT');
  const json=vi.fn().mockResolvedValueOnce(metadata('0.1')).mockRejectedValueOnce(failure).mockResolvedValueOnce(metadata('0.5'));
  const provider=new BinancePublicMarketDataProvider({json} as any);
  vi.spyOn((provider as any).stream,'quote').mockImplementation(()=>({last:100,mark:100,bid:99.9,ask:100.1,ts:Date.now()}));
  expect(await provider.getQuote('BTCUSDT')).toMatchObject({tickSize:0.1});
  expect(provider.cachedQuote('BTCUSDT')).toMatchObject({tickSize:0.1});
  expect(json).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(15*60_000);
  expect(provider.cachedQuote('BTCUSDT')).toBeUndefined();
  await expect(provider.getQuote('BTCUSDT')).rejects.toBe(failure);
  vi.advanceTimersByTime(59_999);
  expect(provider.cachedQuote('BTCUSDT')).toBeUndefined();
  await expect(provider.getQuote('BTCUSDT')).rejects.toBe(failure);
  expect(json).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(await provider.getQuote('BTCUSDT')).toMatchObject({tickSize:0.5});
  expect(provider.cachedQuote('BTCUSDT')).toMatchObject({tickSize:0.5});
  expect(json).toHaveBeenCalledTimes(3);
});

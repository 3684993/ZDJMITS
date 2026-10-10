import {expect,it,vi} from 'vitest';
import {BinancePublicMarketDataProvider} from './BinancePublicMarketDataProvider.js';

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

it('backs off a failed catalog across later batches without returning expired facts',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1800000000000);
  const failure=new Error('catalog response body deadline'),json=vi.fn().mockRejectedValue(failure);
  const provider=new BinancePublicMarketDataProvider({json,environment:()=> 'TESTNET'} as any);
  try{
    const read=()=>((provider as any).info());
    let results=await Promise.allSettled(Array.from({length:50},read));
    expect(results.every(r=>r.status==='rejected'&&r.reason===failure)).toBe(true);
    expect(json).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1800000029999);
    results=await Promise.allSettled(Array.from({length:50},read));
    expect(results.every(r=>r.status==='rejected'&&r.reason===failure)).toBe(true);
    expect(json).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1800000030000);await expect(read()).rejects.toBe(failure);
    expect(json).toHaveBeenCalledTimes(2);
    vi.setSystemTime(1800000089999);await expect(read()).rejects.toBe(failure);
    expect(json).toHaveBeenCalledTimes(2);
    json.mockResolvedValue({symbols:[],rateLimits:[]});
    vi.setSystemTime(1800000090000);await expect(read()).resolves.toEqual({symbols:[],rateLimits:[]});
    expect(json).toHaveBeenCalledTimes(3);
    await expect(read()).resolves.toEqual({symbols:[],rateLimits:[]});
    expect(json).toHaveBeenCalledTimes(3);
    vi.setSystemTime(1800000990001);await read();expect(json).toHaveBeenCalledTimes(4);
  }finally{vi.useRealTimers();}
});

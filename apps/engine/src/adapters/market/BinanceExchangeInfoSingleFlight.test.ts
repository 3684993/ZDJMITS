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

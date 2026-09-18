import {expect,it,vi} from 'vitest';
import {ExternalTradeAdapter} from './ExternalTradeAdapter.js';

function adapterHarness(){
  const calls:string[]=[];
  const transport:any={effectiveBaseUrl:()=> 'https://demo-fapi.binance.com',environment:()=> 'TESTNET',executionMode:()=> 'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{},json:vi.fn(async(url:string)=>{calls.push(url);if(url==='/fapi/v1/time')return{serverTime:Date.now()};if(url.startsWith('/fapi/v1/userTrades'))return[];if(url.startsWith('/fapi/v1/allOrders'))return[];if(url.startsWith('/fapi/v1/income'))return[];return[];})};
  return{adapter:new ExternalTradeAdapter(transport,{apiKey:'key',apiSecret:'secret'}),calls};
}

it('uses no income request for UNKNOWN risk proof',async()=>{
  const h=adapterHarness();await h.adapter.fetchSymbolRiskFacts('XLMUSDT',1,2);
  expect(h.calls.some(url=>url.startsWith('/fapi/v1/income'))).toBe(false);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/userTrades'))).toHaveLength(1);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/allOrders'))).toHaveLength(1);
});

it('reuses the Binance clock offset for thirty seconds across private reads',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const h=adapterHarness();await h.adapter.fetchSymbolRiskFacts('XLMUSDT',1,2);vi.advanceTimersByTime(29_999);await h.adapter.fetchSymbolRiskFacts('ETHUSDT',1,2);
    expect(h.calls.filter(url=>url==='/fapi/v1/time')).toHaveLength(1);
    vi.advanceTimersByTime(2);await h.adapter.fetchSymbolRiskFacts('ARBUSDC',1,2);
    expect(h.calls.filter(url=>url==='/fapi/v1/time')).toHaveLength(2);
  }finally{vi.useRealTimers();}
});


it('collects each audit symbol once without a second income/userTrades/allOrders pass',async()=>{
  const h=adapterHarness();
  const audit=await h.adapter.fetchRecentTradeAudit(1,2,500,['BTCUSDT','ETHUSDT']);
  expect(audit.source).toBe('BINANCE_DEMO_PRIVATE');
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/income'))).toHaveLength(1);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/userTrades'))).toHaveLength(2);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/allOrders'))).toHaveLength(2);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v1/openOrders'))).toHaveLength(1);
  expect(h.calls.filter(url=>url.startsWith('/fapi/v2/positionRisk'))).toHaveLength(1);
});

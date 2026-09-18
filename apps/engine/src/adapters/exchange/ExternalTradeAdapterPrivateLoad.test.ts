import {expect,it,vi} from 'vitest';
import {ExternalTradeAdapter} from './ExternalTradeAdapter.js';

function adapterHarness(){
  const calls:string[]=[];
  const transport:any={effectiveBaseUrl:()=> 'https://demo-fapi.binance.com',environment:()=> 'TESTNET',executionMode:()=> 'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{},json:vi.fn(async(url:string)=>{calls.push(url);if(url==='/fapi/v1/time')return{serverTime:Date.now()};if(url.startsWith('/fapi/v1/userTrades'))return[];if(url.startsWith('/fapi/v1/allOrders'))return[];if(url.startsWith('/fapi/v1/order'))return{symbol:'BTCUSDT',orderId:7,clientOrderId:'ML_TEST',executedQty:'0',origQty:'1',price:'100',status:'NEW',type:'LIMIT',timeInForce:'GTX',updateTime:Date.now()};if(url.startsWith('/fapi/v1/income'))return[];return[];})};
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


it('single-flights three concurrent exact-order readers and reuses the short cache',async()=>{
 const h=adapterHarness(),order:any={id:'entry_1',clientOrderId:'ML_TEST',exchangeOrderId:'7',symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:0,leverage:20,status:'WORKING',createdAt:1,updatedAt:1,absoluteExpiresAt:9999999999999,repriceCount:0,intentId:'intent_1',reachability:1};
 const [a,b,d]=await Promise.all([h.adapter.findEntryByClientOrderId(order),h.adapter.findEntryByClientOrderId(order),h.adapter.findEntryByClientOrderId(order)]);
 expect(a?.exchangeOrderId).toBe('7');expect(b?.exchangeOrderId).toBe('7');expect(d?.exchangeOrderId).toBe('7');
 expect(h.calls.filter(url=>url.startsWith('/fapi/v1/order?'))).toHaveLength(1);
 await h.adapter.findEntryByClientOrderId(order);
 expect(h.calls.filter(url=>url.startsWith('/fapi/v1/order?'))).toHaveLength(1);
});


it('paginates 1000-row audit pages instead of silently truncating the evidence window',async()=>{
  const calls:string[]=[];
  const transport:any={effectiveBaseUrl:()=> 'https://demo-fapi.binance.com',environment:()=> 'TESTNET',executionMode:()=> 'READ_ONLY',assertTestnetExchangeWrite:()=>{},json:vi.fn(async(url:string)=>{
    calls.push(url);const u=new URL(url,'https://demo-fapi.binance.com');
    if(u.pathname==='/fapi/v1/time')return{serverTime:Date.now()};
    if(u.pathname==='/fapi/v1/income'){const page=Number(u.searchParams.get('page')??1);return page===1?Array.from({length:1000},(_,i)=>({symbol:'BTCUSDT',incomeType:'COMMISSION',income:'0',asset:'USDT',time:100+i%10,tranId:i})):[];}
    if(u.pathname==='/fapi/v1/userTrades'){const fromId=u.searchParams.get('fromId');return fromId===null?Array.from({length:1000},(_,i)=>({symbol:'BTCUSDT',side:'BUY',positionSide:'LONG',orderId:i,id:i,time:100+i%10,qty:'1',price:'100',realizedPnl:'0',commission:'0',commissionAsset:'USDT',maker:true})): [{symbol:'BTCUSDT',side:'BUY',positionSide:'LONG',orderId:1000,id:1000,time:150,qty:'1',price:'100',realizedPnl:'0',commission:'0',commissionAsset:'USDT',maker:true}];}
    if(u.pathname==='/fapi/v1/allOrders'){const orderId=u.searchParams.get('orderId');return orderId===null?Array.from({length:1000},(_,i)=>({symbol:'BTCUSDT',orderId:i,clientOrderId:`ML_${i}`,side:'BUY',positionSide:'LONG',status:'FILLED',type:'LIMIT',origQty:'1',executedQty:'1',avgPrice:'100',updateTime:100+i%10})): [{symbol:'BTCUSDT',orderId:1000,clientOrderId:'ML_1000',side:'BUY',positionSide:'LONG',status:'FILLED',type:'LIMIT',origQty:'1',executedQty:'1',avgPrice:'100',updateTime:150}];}
    if(u.pathname==='/fapi/v2/positionRisk'||u.pathname==='/fapi/v1/openOrders')return[];
    return[];
  })};
  const adapter=new ExternalTradeAdapter(transport,{apiKey:'key',apiSecret:'secret'});
  const audit=await adapter.fetchRecentTradeAudit(1,2000,2000,['BTCUSDT']);
  expect(audit.fills).toHaveLength(1001);
  expect(calls.filter(url=>url.startsWith('/fapi/v1/userTrades'))).toHaveLength(2);
  expect(calls.filter(url=>url.startsWith('/fapi/v1/allOrders'))).toHaveLength(2);
  expect(calls.filter(url=>url.startsWith('/fapi/v1/income'))).toHaveLength(2);
});

import { describe,expect,it,vi } from 'vitest';
import type { EntryOrder,TakeProfitOrder } from '@zdj/contracts';
import { ExternalTradeAdapter } from './ExternalTradeAdapter.js';

function harness(hedge:boolean,environment:'TESTNET'|'PRODUCTION'='TESTNET'){const calls:Array<{url:string;method?:string}>=[];const transport={effectiveBaseUrl:()=>environment==='TESTNET'?'https://testnet.binancefuture.com':'https://fapi.binance.com',environment:()=>environment,executionMode:()=> 'TESTNET_ENABLED',assertTestnetExchangeWrite:()=>{if(environment!=='TESTNET')throw new Error('TESTNET_ONLY_WRITE_LOCK')},json:vi.fn(async(url:string,init?:{method?:string})=>{calls.push({url,method:init?.method});if(url==='/fapi/v1/time')return{serverTime:1};if(url.startsWith('/fapi/v1/positionSide/dual'))return{dualSidePosition:hedge};if(url.startsWith('/fapi/v1/order'))return{orderId:123};return{};})};return{adapter:new ExternalTradeAdapter(transport as never,{apiKey:'key',apiSecret:'secret'}),calls};}
const entry={id:'entry_1',exchangeOrderId:null,symbol:'BTCUSDT',side:'SHORT',quantity:.01,price:100,filledQuantity:0,leverage:20,status:'NEW',createdAt:1,updatedAt:1,absoluteExpiresAt:2,repriceCount:0,intentId:'i',reachability:1} as EntryOrder;
const tp={id:'tp_1',exchangeOrderId:null,positionId:'p',symbol:'BTCUSDT',side:'SELL',quantity:.01,price:110,status:'WORKING',createdAt:1,updatedAt:1} as TakeProfitOrder;
it('retries Binance -1000 once when changing leverage because the target value is idempotent',async()=>{
  const h=harness(false);let writes=0;
  (h.adapter as any).transport.json.mockImplementation(async(url:string,init:any)=>{
    h.calls.push({url,method:init?.method});
    if(url==='/fapi/v1/time')return{serverTime:Date.now()};
    if(url.startsWith('/fapi/v1/leverageBracket'))return[{symbol:'BTCUSDT',brackets:[{initialLeverage:20}]}];
    if(url.startsWith('/fapi/v1/leverage')&&init?.method==='POST'){writes++;if(writes===1)throw new Error('Binance HTTP 400: {"code":-1000,"msg":"An unknown error occurred while processing the request."}');return{leverage:20,maxNotionalValue:'1000000',symbol:'BTCUSDT'};}
    return{};
  });
  await expect(h.adapter.setLeverage('BTCUSDT',20)).resolves.toBeUndefined();
  expect(h.calls.filter(call=>call.method==='POST'&&call.url.startsWith('/fapi/v1/leverage'))).toHaveLength(2);
});
it('never silently clamps a frozen leverage above the current exchange bracket',async()=>{
  const h=harness(false);
  (h.adapter as any).transport.json.mockImplementation(async(url:string,init:any)=>{
    h.calls.push({url,method:init?.method});
    if(url==='/fapi/v1/time')return{serverTime:Date.now()};
    if(url.startsWith('/fapi/v1/leverageBracket'))return[{symbol:'BTCUSDT',brackets:[{initialLeverage:15}]}];
    return{};
  });
  await expect(h.adapter.setLeverage('BTCUSDT',20)).rejects.toThrow('SET_LEVERAGE_EXCEEDS_EXCHANGE_MAX');
  expect(h.calls.some(call=>call.method==='POST')).toBe(false);
  await h.adapter.setLeverage('BTCUSDT',15);
  expect(h.calls.find(call=>call.method==='POST')?.url).toContain('leverage=15');
});
describe('Binance position mode order parameters',()=>{
  it('sends positionSide for hedge-mode entry and TP without reduceOnly',async()=>{const h=harness(true);await h.adapter.placeEntry(entry);await h.adapter.placeTakeProfit(tp);const orders=h.calls.filter(x=>x.url.startsWith('/fapi/v1/order'));expect(orders[0]!.url).toContain('positionSide=SHORT');expect(orders[1]!.url).toContain('positionSide=LONG');expect(orders[1]!.url).not.toContain('reduceOnly');});
  it('uses reduceOnly and omits positionSide in one-way mode',async()=>{const h=harness(false);await h.adapter.placeTakeProfit(tp);const order=h.calls.find(x=>x.url.startsWith('/fapi/v1/order'))!.url;expect(order).toContain('reduceOnly=true');expect(order).not.toContain('positionSide');});
  it('routes manual reduce through a post-only position-side order in hedge mode',async()=>{const h=harness(true);await h.adapter.placeManualOrder({clientOrderId:'manual_i1',symbol:'BTCUSDT',side:'SELL',positionSide:'LONG',type:'LIMIT',quantity:.01,price:101,reduceOnly:true,postOnly:true});const order=h.calls.find(x=>x.url.startsWith('/fapi/v1/order'))!.url;expect(order).toContain('side=SELL');expect(order).toContain('positionSide=LONG');expect(order).not.toContain('reduceOnly=true');expect(order).toContain('timeInForce=GTX');});
  it('serializes exchange decimals without binary floating-point tails or scientific notation',async()=>{const h=harness(false),quantity=6*.0001;await h.adapter.placeEntry({...entry,quantity,price:8.4118518875e4});await h.adapter.placeTakeProfit({...tp,quantity,price:1e-8});await h.adapter.placeManualOrder({clientOrderId:'manual_decimal',symbol:'BTCUSDT',side:'BUY',type:'LIMIT',quantity,price:8.4118518875e4,reduceOnly:false,postOnly:false});const orders=h.calls.filter(x=>x.url.startsWith('/fapi/v1/order'));for(const order of orders){expect(order.url).toContain('quantity=0.0006');expect(order.url).not.toContain('00000000000001');expect(order.url).not.toMatch(/(?:quantity|price)=[^&]*e(?:%2B|-)/i);}expect(orders[0]!.url).toContain('price=84118.518875');expect(orders[1]!.url).toContain('price=0.00000001');});
  it('uses same-symbol exchange order id for an exact lookup when client id is missing',async()=>{const h=harness(true);await h.adapter.findEntryByClientOrderId({...entry,exchangeOrderId:'28574055715',clientOrderId:null});const request=h.calls.find(x=>x.url.startsWith('/fapi/v1/order?'))!.url;expect(request).toContain('symbol=BTCUSDT');expect(request).toContain('orderId=28574055715');expect(request).not.toContain('origClientOrderId');});
  it('loads userTrades for an exact terminal order with executed quantity',async()=>{const h=harness(true);(h as any).adapter['transport'].json.mockImplementation(async(url:string)=>{h.calls.push({url});if(url==='/fapi/v1/time')return{serverTime:1};if(url.startsWith('/fapi/v1/order?'))return{orderId:123,clientOrderId:'ml_btc',executedQty:.0159,origQty:.0159,status:'FILLED',updateTime:4};if(url.startsWith('/fapi/v1/userTrades?'))return[{symbol:'BTCUSDT',orderId:123,clientOrderId:'ml_btc',id:99,time:3,qty:.0159,price:79690,side:'SELL',positionSide:'SHORT',realizedPnl:0,commission:.01,commissionAsset:'USDT',maker:true}];return{};});const result:any=await h.adapter.findEntryByClientOrderId({...entry,quantity:.0159,clientOrderId:'ml_btc'});expect(result).toMatchObject({status:'FILLED',filledQuantity:.0159,factSource:'BINANCE_EXACT_ORDER'});expect(result.verifiedExchangeFills).toHaveLength(1);expect(h.calls.some(x=>x.url.startsWith('/fapi/v1/userTrades?')&&x.url.includes('orderId=123'))).toBe(true);});
  it('fails closed before every production write',async()=>{const h=harness(true,'PRODUCTION');await expect(h.adapter.placeEntry(entry)).rejects.toThrow('TESTNET_ONLY_WRITE_LOCK');expect(h.adapter.writeBoundaryMetrics().productionWrites).toBe(0);expect(h.adapter.writeBoundaryMetrics().blockedProductionWriteAttempts).toBeGreaterThan(0);});
});


describe('V3.9 verified cancel and amend outcomes',()=>{
  const manual:any={...entry,id:'manual_order_1',intentId:'manual_intent_1',clientOrderId:'ec1_safe',positionId:'p',positionSide:'SHORT',side:'BUY',type:'LIMIT',reduceOnly:true,postOnly:false};
  function truth(status:string,filled=0){const h=harness(false);(h.adapter as any).transport.json.mockImplementation(async(url:string,init:any)=>{h.calls.push({url,method:init?.method});if(url==='/fapi/v1/time')return{serverTime:Date.now()};if(url.startsWith('/fapi/v1/userTrades'))return[];if(init?.method==='GET'){if(status==='MISSING')throw new Error('-2013');return{orderId:123,clientOrderId:'ec1_safe',status,executedQty:filled,origQty:.01,price:100.02};}return{orderId:123};});return h;}
  it.each(['FILLED','CANCELED','EXPIRED'])('preserves exact manual terminal %s',async status=>{const h=truth(status,status==='FILLED'?.01:0),result=await h.adapter.cancelManualOrder(manual);expect(result.status).toBe(status);expect(result.intentId).toBe(manual.intentId);expect(h.calls.some(x=>x.method==='GET')).toBe(true);});
  it('holds UNKNOWN when cancel confirmation is unavailable',async()=>{const h=truth('MISSING');expect((await h.adapter.cancelManualOrder(manual)).status).toBe('UNKNOWN');await expect(h.adapter.cancelTakeProfit(tp)).rejects.toThrow('UNVERIFIED');});
  it('amends original total quantity and retains queried price, fills, identity and TTL',async()=>{const h=truth('PARTIALLY_FILLED',.004),result=await h.adapter.replaceEntry({...entry,clientOrderId:'ml_safe',status:'PARTIALLY_FILLED',filledQuantity:.003},100.03);expect(result).toMatchObject({quantity:.01,filledQuantity:.004,price:100.02,status:'PARTIALLY_FILLED',createdAt:1,absoluteExpiresAt:2});expect(h.calls.filter(x=>x.method==='PUT')).toHaveLength(1);expect(h.calls.find(x=>x.method==='PUT')!.url).toContain('quantity=0.01');expect(h.calls.some(x=>x.method==='POST'||x.method==='DELETE')).toBe(false);});
});

it('returns fresh account facts even while income and valuation requests never complete',async()=>{const h=harness(false);(h.adapter as any).transport.json.mockImplementation(async(url:string)=>{if(url==='/fapi/v1/time')return{serverTime:Date.now()};if(url.startsWith('/fapi/v2/account'))return{assets:[{asset:'USDT',walletBalance:'100',availableBalance:'90'}],totalUnrealizedProfit:'0'};return new Promise(()=>{});});const result=await Promise.race([h.adapter.fetchAccountSnapshot(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('account blocked by enrichment')),100))]);expect(result).toMatchObject({availableUsd:90,realizedPnlUsd24h:null,enrichment:{pending:true}});});
it('coalesces public clock requests needed by concurrent private reads',async()=>{
 const h=harness(false);await Promise.all(Array.from({length:20},()=>h.adapter.fetchRealizedPnlSince(1).catch(()=>0)));expect(h.calls.filter(c=>c.url==='/fapi/v1/time')).toHaveLength(1);
});

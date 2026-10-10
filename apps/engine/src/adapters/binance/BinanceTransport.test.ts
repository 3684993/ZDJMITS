import {binanceRequestBudget,getBinanceRequestBudget} from './requestBudget.js';
import { describe, expect, it, vi } from 'vitest';
import {mkdtempSync,rmSync,truncateSync,writeFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {resetStorageCapacityGuardForTest} from '../../services/storageCapacityGuard.js';
import { BinanceTransport,binanceRequestWeight,inferredBinanceSource,inferredBinancePurpose,extractObservedIp,shouldPublishTransportFailure } from './BinanceTransport.js';
import {binanceBudgetLane} from './requestBudget.js';
import {withBinanceReadContext} from './binanceReadContext.js';
import https from 'node:https';
import {EventEmitter} from 'node:events';
const settings=(enabled=true)=>({executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://demo-fapi.binance.com',testnetRestBaseUrl:'https://demo-fapi.binance.com',testnetWsBaseUrl:'wss://stream.binancefuture.com/ws',productionBaseUrl:'https://fapi.binance.com',productionRestBaseUrl:'https://fapi.binance.com',productionWsBaseUrl:'wss://fstream.binance.com/ws'},proxy:{enabled,url:'socks5h://127.0.0.1:20081',forceBinanceRest:true,forceBinanceWs:true,proxyDns:true,failClosed:true,binanceRestRoute:'CONFIGURED'}});

it('reports quote dispatch time only after admission, before the wire request',async()=>{
 vi.useFakeTimers();vi.setSystemTime(10000);
 const transport=new BinanceTransport({...settings(),proxy:{...settings().proxy,url:'socks5h://127.0.0.1:29875'}} as never),onDispatch=vi.fn();let admit!:()=>void;
 const run=vi.spyOn((transport as any).budget,'run').mockImplementation((...args:any[])=>new Promise(resolve=>{admit=()=>resolve(args[2]());}));
 const requestSpy=vi.spyOn(https,'request').mockImplementation((...args:any[])=>{
  const req:any=new EventEmitter();req.destroy=vi.fn();req.end=()=>{const response:any=new EventEmitter();response.statusCode=200;response.headers={};response.setEncoding=vi.fn();args[2](response);response.emit('data','{}');response.emit('end');};return req;
 });
 try{const pending=transport.json('/fapi/v1/ticker/bookTicker?symbol=BTCUSDT',{onDispatch});expect(onDispatch).not.toHaveBeenCalled();expect(requestSpy).not.toHaveBeenCalled();vi.setSystemTime(17000);admit();await pending;expect(onDispatch).toHaveBeenCalledExactlyOnceWith(17000);expect(requestSpy).toHaveBeenCalledTimes(1);}
 finally{run.mockRestore();requestSpy.mockRestore();transport.dispose();vi.useRealTimers();}
});
it('prepares only query parameters after admission without allowing route or endpoint mutation',async()=>{
 const transport=new BinanceTransport({...settings(),proxy:{...settings().proxy,url:'socks5h://127.0.0.1:29878'}} as never);let admit!:()=>void;const query=vi.fn(()=>new URLSearchParams({timestamp:'NEW',signature:'fresh',symbol:'BTCUSDT'}));
 const run=vi.spyOn((transport as any).budget,'run').mockImplementation((...args:any[])=>new Promise(resolve=>{admit=()=>resolve(args[2]());}));
 const wire=vi.spyOn(https,'request').mockImplementation((...args:any[])=>{expect(args[0].origin).toBe('https://demo-fapi.binance.com');expect(args[0].pathname).toBe('/fapi/v1/order');expect(args[0].searchParams.get('timestamp')).toBe('NEW');const request:any=new EventEmitter();request.destroy=vi.fn();request.end=()=>{const response:any=new EventEmitter();response.statusCode=200;response.headers={};response.setEncoding=vi.fn();args[2](response);response.emit('data','{}');response.emit('end');};return request;});
 try{const pending=transport.json('/fapi/v1/order?timestamp=OLD',{dispatchQuery:query});expect(query).not.toHaveBeenCalled();expect(wire).not.toHaveBeenCalled();admit();await pending;expect(query).toHaveBeenCalledOnce();}finally{run.mockRestore();wire.mockRestore();transport.dispose();}
});

it('inherits cancellation and historical priority only for reads, preserving execution writes',async()=>{
 const transport=new BinanceTransport(settings() as never),controller=new AbortController(),run=vi.spyOn((transport as any).budget,'run').mockResolvedValue({} as never);
 try{
  await withBinanceReadContext({signal:controller.signal,source:'HISTORICAL_REPAIR'},()=>transport.json('/fapi/v1/order?symbol=BTCUSDT'));
  expect(run.mock.calls[0]![0]).toBe(4);expect(run.mock.calls[0]![3]).toMatchObject({source:'HISTORICAL_REPAIR'});expect(run.mock.calls[0]![4]).toBe(controller.signal);
  controller.abort();await withBinanceReadContext({signal:controller.signal,source:'HISTORICAL_REPAIR'},()=>transport.json('/fapi/v1/order',{method:'POST'}));
  expect(run.mock.calls[1]![0]).toBe(0);expect(run.mock.calls[1]![3]).toMatchObject({source:'EXECUTION_CRITICAL'});expect(run.mock.calls[1]![4]).toBeUndefined();
 }finally{run.mockRestore();}
});

it('assigns current account and required quote facts priority before generic reconstruction',async()=>{
 const cfg={...settings(),proxy:{...settings().proxy,url:'socks5h://127.0.0.1:29877'}},transport=new BinanceTransport(cfg as never),run=vi.spyOn((transport as any).budget,'run').mockResolvedValue({} as never);
 try{
  await transport.json('/fapi/v2/account');await transport.json('/fapi/v1/depth?symbol=BTCUSDT',{source:'MARKET_DATA',purpose:'QUOTE_BOOK_RECOVERY'});
  expect(run.mock.calls[0]![0]).toBe(0);expect(run.mock.calls[1]![0]).toBe(2);
 }finally{run.mockRestore();}
});

it('records network phase evidence and removes pending TLS listeners when the response completes',async()=>{
 const cfg={...settings(),proxy:{...settings().proxy,url:'socks5h://127.0.0.1:29876'}},transport=new BinanceTransport(cfg as never),socket:any=new EventEmitter();socket.encrypted=true;socket.secureConnecting=true;
 const requestSpy=vi.spyOn(https,'request').mockImplementation((...args:any[])=>{
  const callback=args[2],request:any=new EventEmitter();request.reusedSocket=false;request.destroy=vi.fn();request.end=()=>{
   request.emit('socket',socket);const response:any=new EventEmitter();response.statusCode=200;response.headers={};response.setEncoding=vi.fn();callback(response);response.emit('data','{}');response.emit('end');
  };return request;
 });
 try{
  await transport.json('/fapi/v1/ticker/bookTicker?symbol=BTCUSDT');
  expect(socket.listenerCount('secureConnect')).toBe(0);
  expect(transport.requestBudgetHealth().recentDispatches.at(-1)?.networkTiming).toMatchObject({startedAt:expect.any(Number),socketAssignedAt:expect.any(Number),responseAt:expect.any(Number),completedAt:expect.any(Number),responseStatus:200,responseDecodedBytes:2,failurePhase:null});
 }finally{requestSpy.mockRestore();}
});
describe('BinanceTransport proxy-only boundary',()=>{
 it('routes REST and WebSocket through the configured proxy',()=>{const transport=new BinanceTransport(settings() as never);expect(transport.restRoute()).toMatchObject({mode:'CONFIGURED',throughProxy:true,proxyUrl:'socks5h://127.0.0.1:20081',failClosed:true});expect((transport as any).restAgent()).toBeDefined();expect(transport.websocketRoute()).toMatchObject({throughProxy:true,proxyUrl:'socks5h://127.0.0.1:20081',tlsServername:'fstream.binancefuture.com',failClosed:true});expect(transport.websocketOptions().agent).toBeDefined();});
 it('ignores a legacy DIRECT flag and still uses the configured proxy',()=>{const cfg={...settings(),proxy:{...settings().proxy,binanceRestRoute:'DIRECT',forceBinanceRest:false,forceBinanceWs:false}};const transport=new BinanceTransport(cfg as never);expect(transport.restRoute()).toMatchObject({mode:'CONFIGURED',throughProxy:true});expect((transport as any).restAgent()).toBeDefined();expect(transport.websocketRoute().throughProxy).toBe(true);});
 it('fails closed when proxy is disabled instead of silently using DIRECT',async()=>{const transport=new BinanceTransport(settings(false) as never);expect(transport.restRoute()).toMatchObject({mode:'CONFIGURED',throughProxy:false,failClosed:true});expect(()=>transport.websocketOptions()).toThrow('PROXY_REQUIRED');await expect(transport.json('/fapi/v1/time')).rejects.toThrow('PROXY_REQUIRED');});
});
it('derives the 2026 split Public/Market WebSocket routes while preserving the legacy private-compatible URL',()=>{
 const transport=new BinanceTransport(settings() as never);
 expect(transport.effectiveWsUrl()).toBe('wss://stream.binancefuture.com/ws');
 expect(transport.effectiveWsUrl('PUBLIC')).toBe('wss://fstream.binancefuture.com/public/ws');
 expect(transport.effectiveWsUrl('MARKET')).toBe('wss://fstream.binancefuture.com/market/ws');
 expect(transport.websocketRoute()).toMatchObject({publicUrl:'wss://fstream.binancefuture.com/public/ws',marketUrl:'wss://fstream.binancefuture.com/market/ws',tlsServername:'fstream.binancefuture.com'});
});
it('reserves the private-truth lane for listen-key maintenance without relying on signature heuristics',async()=>{const transport=new BinanceTransport(settings() as never),run=vi.spyOn((transport as any).budget,'run').mockResolvedValue({} as never);try{await transport.json('/fapi/v1/listenKey',{method:'PUT',headers:{'X-MBX-APIKEY':'isolated-test'}});expect(run.mock.calls[0]![0]).toBe(1);expect(run.mock.calls[0]![1]).toBe(1);expect(run.mock.calls[0]![3]).toMatchObject({source:'USER_DATA_STREAM',endpoint:'/fapi/v1/listenKey'});}finally{run.mockRestore();}});
it.each([
 ['POST','/fapi/v1/leverage','EXECUTION'],['POST','/fapi/v1/order','EXECUTION'],['PUT','/fapi/v1/order','EXECUTION'],['DELETE','/fapi/v1/order','EXECUTION'],['GET','/fapi/v1/order','PRIVATE_TRUTH'],
 ['POST','/fapi/v1/listenKey','PRIVATE_TRUTH'],['PUT','/fapi/v1/listenKey','PRIVATE_TRUTH'],['DELETE','/fapi/v1/listenKey','PRIVATE_TRUTH'],
 ['GET','/fapi/v1/leverageBracket','PRIVATE_TRUTH'],['GET','/fapi/v1/accountConfig','PRIVATE_TRUTH'],['GET','/fapi/v2/account','PRIVATE_TRUTH'],['GET','/fapi/v3/account','PRIVATE_TRUTH'],['GET','/fapi/v1/balance','PRIVATE_TRUTH'],['GET','/fapi/v3/positionRisk','PRIVATE_TRUTH'],['GET','/fapi/v1/multiAssetsMargin','PRIVATE_TRUTH'],['GET','/fapi/v1/commissionRate','PRIVATE_TRUTH'],
 ['GET','/fapi/v1/openOrders','PRIVATE_TRUTH'],['GET','/fapi/v1/openAlgoOrders','PRIVATE_TRUTH'],['GET','/fapi/v1/allOrders','PRIVATE_TRUTH'],['GET','/fapi/v1/userTrades','PRIVATE_TRUTH'],['GET','/fapi/v1/income','BACKGROUND'],
 ['GET','/fapi/v1/exchangeInfo','CONTROL'],['GET','/fapi/v1/time','CONTROL'],['GET','/fapi/v1/klines','MARKET_PUBLIC'],['GET','/fapi/v1/depth','MARKET_PUBLIC'],['GET','/fapi/v1/ticker/24hr','MARKET_PUBLIC'],['GET','/fapi/v1/ticker/bookTicker','MARKET_PUBLIC'],
] as const)('classifies known %s %s into %s with a purpose', (method,path,lane)=>{const url=new URL(`https://demo-fapi.binance.com${path}`),source=inferredBinanceSource(url,method);expect(source).not.toBe('UNKNOWN');expect(binanceBudgetLane(source)).toBe(lane);expect(inferredBinancePurpose(url,method)).not.toBe('BINANCE_HTTP');expect(()=>binanceRequestWeight(url,method)).not.toThrow();});
it('puts leverage control in the execution priority and explicit purpose',async()=>{const transport=new BinanceTransport(settings() as never),run=vi.spyOn((transport as any).budget,'run').mockResolvedValue({} as never);try{await transport.json('/fapi/v1/leverage',{method:'POST'});expect(run.mock.calls[0]![0]).toBe(0);expect(run.mock.calls[0]![3]).toMatchObject({source:'EXECUTION_CRITICAL',purpose:'SET_ENTRY_LEVERAGE'});}finally{run.mockRestore();}});
it('accounts for heavy USD-M endpoints instead of counting every HTTP call as one',()=>{expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/openOrders?timestamp=1&signature=x'))).toBe(40);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/openOrders?symbol=BTCUSDT&timestamp=1&signature=x'))).toBe(1);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/income?limit=1000&timestamp=1&signature=x'))).toBe(30);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=500'))).toBe(10);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=240'))).toBe(2);});
it.each([['leverageBracket',1],['commissionRate',20],['accountConfig',5]] as const)('uses official %s weight without changing its private lane', (endpoint,weight)=>{
 const url=new URL(`https://demo-fapi.binance.com/fapi/v1/${endpoint}?symbol=BTCUSDT`);expect(binanceRequestWeight(url)).toBe(weight);expect(binanceBudgetLane(inferredBinanceSource(url,'GET'))).toBe('PRIVATE_TRUTH');
});
it('isolates production, testnet and different proxy route identities',()=>{expect(getBinanceRequestBudget('TESTNET')).not.toBe(getBinanceRequestBudget('PRODUCTION'));expect(getBinanceRequestBudget('TESTNET')).toBe(binanceRequestBudget);expect(getBinanceRequestBudget('TESTNET','proxy-a')).not.toBe(getBinanceRequestBudget('TESTNET','proxy-b'));});
it('never reports AVAILABLE after observed weight has crossed the hard ceiling',()=>{const t=new BinanceTransport(settings() as never),budget=(t as any).budget;budget.observe(200,'2301',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});expect(t.requestBudgetHealth().status).toBe('SATURATED');});
it('admits market hydration below the public ceiling even when observed weight differs from local estimates',async()=>{const cfg={...settings(),proxy:{...settings().proxy,url:'socks5h://127.0.0.1:20082'}},t=new BinanceTransport(cfg as never),budget=(t as any).budget,run=vi.spyOn(budget,'run').mockResolvedValue({} as never);try{budget.observe(200,'400',undefined,{source:'PRIVATE_STATE',endpoint:'/fapi/v2/account'});await t.json('/fapi/v1/ticker/bookTicker?symbol=BTCUSDT');expect(run).toHaveBeenCalledWith(3,2,expect.any(Function),expect.objectContaining({source:'MARKET_DATA'}),undefined);}finally{run.mockRestore();}});
it('blocks a cross-environment absolute URL before dispatch',async()=>{const transport=new BinanceTransport(settings() as never);await expect(transport.json('https://fapi.binance.com/fapi/v1/time')).rejects.toThrow('ENVIRONMENT_ORIGIN_MISMATCH');});
it('uses different budgets when the configured proxy changes',()=>{const first=settings(),second={...first,proxy:{...first.proxy,url:'socks5h://127.0.0.1:29999'}};expect((new BinanceTransport(first as never) as any).budget).not.toBe((new BinanceTransport(second as never) as any).budget);});
it('checks Entry pressure after budget admission and before opening a socket',async()=>{const transport=new BinanceTransport(settings() as never),budget=(transport as any).budget;const run=vi.spyOn(budget,'run').mockImplementation(async(...args:any[])=>{budget.observe(200,'2300',undefined);return args[2]();});try{await expect(transport.json('/fapi/v1/order',{method:'POST',purpose:'NEW_ENTRY'})).rejects.toThrow('ENTRY_BUDGET_BLOCKED');}finally{run.mockRestore();}});
it('checks SQLite capacity after budget admission and blocks only NEW_ENTRY before a socket opens',async()=>{const dir=mkdtempSync(path.join(os.tmpdir(),'zdj-transport-storage-')),prior=process.env.ZDJ_DATA_DIR,file=path.join(dir,'zdj-settings.sqlite');process.env.ZDJ_DATA_DIR=dir;writeFileSync(file,'');truncateSync(file,1300*1024*1024);resetStorageCapacityGuardForTest();const transport=new BinanceTransport(settings() as never),budget=(transport as any).budget,run=vi.spyOn(budget,'run').mockImplementation(async(...args:any[])=>args[2]());try{await expect(transport.json('/fapi/v1/order',{method:'POST',purpose:'NEW_ENTRY'})).rejects.toThrow('STORAGE_ENTRY_BLOCKED:SQLITE_CAPACITY_ENTRY_BLOCKED');}finally{run.mockRestore();if(prior===undefined)delete process.env.ZDJ_DATA_DIR;else process.env.ZDJ_DATA_DIR=prior;resetStorageCapacityGuardForTest();rmSync(dir,{recursive:true,force:true});}});
it('extracts only valid observed IP addresses instead of the letters in IP banned',()=>{expect(extractObservedIp('IP banned until 1900000000000')).toBeNull();expect(extractObservedIp('IP(15.158.242.74) banned until 1900000000000')).toBe('15.158.242.74');expect(extractObservedIp('IP: 2001:db8::1')).toBe('2001:db8::1');});
it('does not alarm on expected exact-order absence, but retains actionable Binance failures',()=>{const missing='Binance HTTP 400: {"code":-2013,"msg":"Order does not exist."}',alreadyAbsent='Binance HTTP 400: {"code":-2011,"msg":"Unknown order sent."}';expect(shouldPublishTransportFailure('GET','/fapi/v1/order',missing)).toBe(false);expect(shouldPublishTransportFailure('DELETE','/fapi/v1/order',alreadyAbsent)).toBe(false);expect(shouldPublishTransportFailure('DELETE','/fapi/v1/order',missing)).toBe(true);expect(shouldPublishTransportFailure('POST','/fapi/v1/order','Binance HTTP 400: {"code":-5022,"msg":"Post Only"}')).toBe(true);});

it('allows Demo REST writes but rejects the deprecated Testnet REST hostname',()=>{
 const demo=new BinanceTransport(settings() as never);expect(()=>demo.assertTestnetExchangeWrite()).not.toThrow();
 const legacy={...settings(),exchange:{...settings().exchange,testnetBaseUrl:'https://testnet.binancefuture.com',testnetRestBaseUrl:'https://testnet.binancefuture.com'}};
 expect(()=>new BinanceTransport(legacy as never).assertTestnetExchangeWrite()).toThrow('TESTNET_ONLY_WRITE_LOCK');
});
it('fails closed for an unregistered Binance endpoint weight',()=>{
 expect(()=>binanceRequestWeight(new URL('https://demo-fapi.binance.com/fapi/v1/unknown?signature=x'),'GET')).toThrow('BINANCE_ENDPOINT_WEIGHT_UNREGISTERED');
});

it('does not require fixed egress proof for a proxy-routed Testnet write',()=>{
 const cfg={...settings(),proxy:{...settings().proxy,expectedStaticEgressIp:'203.0.113.10'}},transport=new BinanceTransport(cfg as never);
 expect(transport.restRoute()).not.toHaveProperty('expectedStaticEgressIp');
 expect(transport.entryBlockReason()).not.toMatch(/^BINANCE_EGRESS_/);
 expect(()=>transport.assertTestnetExchangeWrite()).not.toThrow();
});

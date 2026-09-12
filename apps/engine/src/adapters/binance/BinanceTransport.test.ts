import {binanceRequestBudget,getBinanceRequestBudget} from './requestBudget.js';
import { describe, expect, it, vi } from 'vitest';
import { BinanceTransport,binanceRequestWeight,extractObservedIp } from './BinanceTransport.js';
const settings=(forceBinanceWs:boolean)=>({executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://testnet.binancefuture.com',productionBaseUrl:'https://fapi.binance.com'},proxy:{enabled:true,url:'socks5h://127.0.0.1:20081',forceBinanceRest:true,forceBinanceWs,proxyDns:true,failClosed:true}});
describe('BinanceTransport WebSocket route',()=>{
 it('uses the configured Binance Testnet stream hostname with direct TLS when WS proxy routing is disabled',()=>{const transport=new BinanceTransport(settings(false) as never);expect(transport.websocketRoute()).toMatchObject({url:'wss://stream.binancefuture.com/ws',throughProxy:false,proxyUrl:null,tlsServername:'stream.binancefuture.com'});expect(transport.websocketOptions()).toEqual({agent:undefined});});
 it('keeps the SOCKS route only when forceBinanceWs is explicitly enabled',()=>{const transport=new BinanceTransport(settings(true) as never);expect(transport.websocketRoute()).toMatchObject({throughProxy:true,proxyUrl:'socks5h://127.0.0.1:20081',tlsServername:'stream.binancefuture.com'});expect(transport.websocketOptions().agent).toBeDefined();});
});
it('supports explicit REST direct independently of WS and rejects contradictory forced-proxy configuration',()=>{const cfg={...settings(true),proxy:{...settings(true).proxy,binanceRestRoute:'DIRECT',forceBinanceRest:false}};const transport=new BinanceTransport(cfg as never);expect(transport.restRoute()).toMatchObject({mode:'DIRECT',throughProxy:false});expect((transport as any).restAgent()).toBeUndefined();expect(transport.websocketRoute().throughProxy).toBe(true);const conflict=new BinanceTransport({...cfg,proxy:{...cfg.proxy,forceBinanceRest:true}} as never);expect(()=>(conflict as any).restAgent()).toThrow('REST_ROUTE_CONFLICT');});
it('reserves priority zero for listen-key maintenance without relying on signature heuristics',async()=>{const transport=new BinanceTransport(settings(true) as never),run=vi.spyOn((transport as any).budget,'run').mockResolvedValue({} as never);try{await transport.json('/fapi/v1/listenKey',{method:'PUT',headers:{'X-MBX-APIKEY':'isolated-test'}});expect(run.mock.calls[0]![0]).toBe(0);expect(run.mock.calls[0]![1]).toBe(1);expect(run.mock.calls[0]![3]).toMatchObject({source:'USER_DATA_STREAM',endpoint:'/fapi/v1/listenKey'});}finally{run.mockRestore();}});
it('accounts for heavy USD-M endpoints instead of counting every HTTP call as one',()=>{expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/openOrders?timestamp=1&signature=x'))).toBe(40);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/openOrders?symbol=BTCUSDT&timestamp=1&signature=x'))).toBe(1);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/income?limit=1000&timestamp=1&signature=x'))).toBe(30);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=500'))).toBe(10);expect(binanceRequestWeight(new URL('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=240'))).toBe(2);});
it('isolates production, testnet and different route identities',()=>{expect(getBinanceRequestBudget('TESTNET')).not.toBe(getBinanceRequestBudget('PRODUCTION'));expect(getBinanceRequestBudget('TESTNET')).toBe(binanceRequestBudget);expect(getBinanceRequestBudget('TESTNET','proxy-a')).not.toBe(getBinanceRequestBudget('TESTNET','proxy-b'));});
it('never reports AVAILABLE after observed weight has crossed the hard ceiling',()=>{const t=new BinanceTransport(settings(true) as never),budget=(t as any).budget;budget.observe(200,'2301',undefined,{source:'RECONCILIATION',endpoint:'/fapi/v1/openOrders'});expect(t.requestBudgetHealth().status).toBe('SATURATED');});

it('blocks a cross-environment absolute URL before dispatch',async()=>{
 const transport=new BinanceTransport(settings(false) as never);await expect(transport.json('https://fapi.binance.com/fapi/v1/time')).rejects.toThrow('ENVIRONMENT_ORIGIN_MISMATCH');
});
it('shares direct-route budget despite irrelevant WS proxy differences',()=>{
 const first={...settings(false),proxy:{...settings(false).proxy,binanceRestRoute:'DIRECT',forceBinanceRest:false}},second={...first,proxy:{...first.proxy,url:'socks5h://127.0.0.1:29999'}};
 expect((new BinanceTransport(first as never) as any).budget).toBe((new BinanceTransport(second as never) as any).budget);
});

it('checks Entry pressure after budget admission and before opening a socket',async()=>{
 const transport=new BinanceTransport(settings(false) as never),budget=(transport as any).budget;
 const run=vi.spyOn(budget,'run').mockImplementation(async(...args:any[])=>{budget.observe(200,'2300',undefined);return args[2]();});
 try{await expect(transport.json('/fapi/v1/order',{method:'POST',purpose:'NEW_ENTRY'})).rejects.toThrow('ENTRY_BUDGET_BLOCKED');}finally{run.mockRestore();}
});

it('extracts only valid observed IP addresses instead of the letters in IP banned',()=>{
 expect(extractObservedIp('IP banned until 1900000000000')).toBeNull();expect(extractObservedIp('IP(15.158.242.74) banned until 1900000000000')).toBe('15.158.242.74');expect(extractObservedIp('IP: 2001:db8::1')).toBe('2001:db8::1');
});

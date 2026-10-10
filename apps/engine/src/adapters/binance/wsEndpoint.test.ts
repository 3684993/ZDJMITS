import {describe,expect,it} from 'vitest';
import {resolveBinanceWsEndpoint} from './wsEndpoint.js';
describe('Binance explicit WS lane/environment contract',()=>{
  it.each(['PUBLIC','MARKET','PRIVATE'] as const)('resolves %s on separate official Demo and production hosts',lane=>{
    expect(resolveBinanceWsEndpoint('TESTNET',undefined,lane)).toBe(`wss://demo-fstream.binance.com/${lane.toLowerCase()}/ws`);
    expect(resolveBinanceWsEndpoint('PRODUCTION',undefined,lane)).toBe(`wss://fstream.binance.com/${lane.toLowerCase()}/ws`);
  });
  it.each(['wss://demo-fstream.binance.com','wss://demo-fstream.binance.com/ws','wss://demo-fstream.binance.com/market/ws'])('normalizes official base %s',url=>expect(resolveBinanceWsEndpoint('TESTNET',url,'PRIVATE')).toBe('wss://demo-fstream.binance.com/private/ws'));
  it.each(['wss://stream.binancefuture.com/ws','wss://fstream.binancefuture.com/ws'])('requires explicit legacy migration %s',url=>expect(()=>resolveBinanceWsEndpoint('TESTNET',url)).toThrow('EXPLICIT_MIGRATION'));
  it.each(['wss://fstream.binance.com/ws','ws://demo-fstream.binance.com','wss://example.com','wss://demo-fstream.binance.com:8443','wss://key@demo-fstream.binance.com','wss://demo-fstream.binance.com?listenKey=secret','wss://demo-fstream.binance.com#x','wss://demo-fstream.binance.com/ws/secret'])('rejects unsafe base %s',url=>expect(()=>resolveBinanceWsEndpoint('TESTNET',url)).toThrow());
  it('rejects Demo in production and unknown environment',()=>{
    expect(()=>resolveBinanceWsEndpoint('PRODUCTION','wss://demo-fstream.binance.com')).toThrow('ORIGIN_MISMATCH');
    expect(()=>resolveBinanceWsEndpoint('UNKNOWN',undefined)).toThrow('ENVIRONMENT_INVALID');
  });
});

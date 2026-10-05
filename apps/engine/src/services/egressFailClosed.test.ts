import {describe,expect,it,vi} from 'vitest';
import {BinanceTransport} from '../adapters/binance/BinanceTransport.js';

const settings=(overrides:any={})=>({executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',testnetBaseUrl:'https://demo-fapi.binance.com',testnetRestBaseUrl:'https://demo-fapi.binance.com',productionBaseUrl:'https://fapi.binance.com',...overrides.exchange},proxy:{enabled:true,url:'socks5h://127.0.0.1:20081',expectedStaticEgressIp:'203.0.113.10',...overrides.proxy}});

describe('proxy-only TESTNET write boundary without fixed public IP',()=>{
  it('ignores legacy expectedStaticEgressIp for route identity and admission',()=>{
    const a=new BinanceTransport(settings() as never),b=new BinanceTransport(settings({proxy:{expectedStaticEgressIp:'198.51.100.7'}}) as never);
    expect(a.restRoute().routeIdentity).toBe(b.restRoute().routeIdentity);
    expect(a.restRoute()).not.toHaveProperty('expectedStaticEgressIp');
    expect(a.entryBlockReason()).toBeNull();
    expect(()=>a.assertTestnetExchangeWrite()).not.toThrow();
    expect(()=>b.assertTestnetExchangeWrite()).not.toThrow();
  });
  it('health only requests Binance time and never probes an IP echo service',async()=>{
    const transport=new BinanceTransport(settings() as never);
    const json=vi.spyOn(transport,'json').mockResolvedValue({serverTime:1} as never);
    expect((await transport.health()).status).toBe('HEALTHY');
    expect(json).toHaveBeenCalledOnce();
    expect(json.mock.calls[0]?.[0]).toBe('/fapi/v1/time');
  });
  it('keeps missing proxy, wrong host and Production blocked',()=>{
    expect(()=>new BinanceTransport(settings({proxy:{enabled:false}}) as never).assertTestnetExchangeWrite()).toThrow('PROXY_REQUIRED');
    expect(()=>new BinanceTransport(settings({exchange:{testnetRestBaseUrl:'https://testnet.binancefuture.com'}}) as never).assertTestnetExchangeWrite()).toThrow('TESTNET_ONLY_WRITE_LOCK');
    expect(()=>new BinanceTransport(settings({exchange:{environment:'PRODUCTION'}}) as never).assertTestnetExchangeWrite()).toThrow('TESTNET_ONLY_WRITE_LOCK');
  });
});

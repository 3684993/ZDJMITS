import {describe,it,expect,vi} from 'vitest';
import {ProductionReadOnlyPreflight} from './productionReadOnlyPreflight.js';

describe('separate production read-only boundary',()=>{
  const credentials={environment:'PRODUCTION' as const,credentialRef:'production-read-only',apiKey:'key',apiSecret:'secret'};
  it('permits only fixed GETs and exports no credential material or live approval',async()=>{
    const json=vi.fn(async(path:string,init:any)=>{expect(init.method).toBe('GET');if(path==='/fapi/v1/time')return{serverTime:Date.now()};if(path==='/fapi/v1/exchangeInfo')return{symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',filters:[{filterType:'PRICE_FILTER',tickSize:'0.1'},{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};if(path.startsWith('/fapi/v3/account'))return{availableBalance:'100',totalWalletBalance:'100',assets:[{asset:'USDT'}]};if(path.startsWith('/fapi/v1/positionSide'))return{dualSidePosition:false};if(path.startsWith('/fapi/v1/multiAssetsMargin'))return{multiAssetsMargin:false};if(path.startsWith('/fapi/v1/commissionRate'))return{makerCommissionRate:'0.0002',takerCommissionRate:'0.0005'};return[];});
    const result=await new ProductionReadOnlyPreflight({effectiveBaseUrl:()=> 'https://fapi.binance.com',json:json as any},credentials).inspect(['BTCUSDT']);
    expect(json).toHaveBeenCalledTimes(12);expect(result).toMatchObject({exchangeWrites:0,mode:'READ_ONLY',allowedMethods:['GET'],liveApproval:'PENDING_LIMITS_EXIT_PLAN_AND_EXPLICIT_ORDER_AUTHORIZATION',candidates:[{symbol:'BTCUSDT',tickSize:.1,stepSize:.001,minNotional:5}]});expect(JSON.stringify(result)).not.toContain('apiKey');expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each(['https://testnet.binancefuture.com','https://fapi.binance.com.attacker.invalid','https://fapi.binance.com/elsewhere'])('rejects %s before any signed request',async origin=>{const json=vi.fn();await expect(new ProductionReadOnlyPreflight({effectiveBaseUrl:()=>origin,json},credentials).inspect()).rejects.toThrow('ORIGIN_INVALID');expect(json).not.toHaveBeenCalled();});
});

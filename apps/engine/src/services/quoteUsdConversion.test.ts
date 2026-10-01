import {describe,expect,it} from 'vitest';
import {quoteUsdConversion} from './quoteUsdConversion.js';

describe('quote USD conversion',()=>{
  it('uses the USD denomination policy for USDT and a fresh observed conversion for USDC',()=>{
    const state={snapshots:new Map([['USDCUSDT',{quote:{last:.999824,ts:1_799_999_990_000}}]])} as any;
    expect(quoteUsdConversion(state,'BTCUSDT',1_800_000_000_000)).toMatchObject({status:'NOT_REQUIRED',rate:1});
    expect(quoteUsdConversion(state,'BTCUSDC',1_800_000_000_000)).toMatchObject({status:'VERIFIED',rate:.999824,observedAt:1_799_999_990_000,source:'USDCUSDT_QUOTE_LAST'});
  });
  it('fails closed for missing or stale USDC FX',()=>{
    expect(quoteUsdConversion({snapshots:new Map()} as any,'BTCUSDC',1_800_000_000_000).status).toBe('MISSING');
    const stale={snapshots:new Map([['USDCUSDT',{quote:{last:1,ts:1_799_999_000_000}}]])} as any;
    expect(quoteUsdConversion(stale,'BTCUSDC',1_800_000_000_000).status).toBe('STALE');
  });
});

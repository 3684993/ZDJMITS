import { resolveQuoteAsset } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';

/** Quote-to-USD valuation for business economics. USDC requires a fresh observed USDCUSDT quote. */
export function quoteUsdConversion(state:RuntimeState,symbol:string,now=Date.now(),maxAgeMs=60_000){
  const asset=resolveQuoteAsset(symbol);
  if(asset==='USDT')return{status:'NOT_REQUIRED' as const,rate:1,observedAt:null,source:'USD_DENOMINATED_USDT_POLICY'};
  if(asset!=='USDC')return{status:'UNSUPPORTED' as const,rate:null,observedAt:null,source:null};
  const quote=(state.snapshots.get('USDCUSDT') as any)?.quote;
  const rate=Number(quote?.last),observedAt=Number(quote?.ts);
  if(!(Number.isFinite(rate)&&rate>0&&Number.isFinite(observedAt)&&observedAt>0))return{status:'MISSING' as const,rate:null,observedAt:null,source:'USDCUSDT_QUOTE_LAST'};
  if(observedAt>now||now-observedAt>maxAgeMs)return{status:'STALE' as const,rate:null,observedAt,source:'USDCUSDT_QUOTE_LAST'};
  return{status:'VERIFIED' as const,rate,observedAt,source:'USDCUSDT_QUOTE_LAST'};
}

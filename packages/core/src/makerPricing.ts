import type { EntryIntent, MarketSymbolSnapshot } from '@zdj/contracts';
import { clamp, roundToTick, safeDiv } from './math.js';

export interface MakerQuote { price:number; reachable:boolean; reachability:number; reason:string; }
export function sizeEntryQuantity(notional:number,price:number,stepSize:number,minQty:number,minNotional:number){if(![notional,price,stepSize,minQty,minNotional].every(Number.isFinite)||price<=0||stepSize<=0)throw new Error('Invalid entry sizing inputs');let quantity=Math.floor((notional/price+1e-12)/stepSize)*stepSize;quantity=Math.max(quantity,Math.ceil((minQty-1e-12)/stepSize)*stepSize);if(quantity*price+1e-9<minNotional)quantity=Math.ceil((minNotional/price-1e-12)/stepSize)*stepSize;return Number(quantity.toFixed(Math.max(0,(String(stepSize).split('.')[1]??'').length)));}
export function priceReachability(intent:EntryIntent, market:MarketSymbolSnapshot):number {
  const t1=market.technical['1m'], t5=market.technical['5m']; const distance=Math.abs(intent.idealPrice-market.quote.last); const expected=Math.max(market.quote.tickSize, t1.atr14*0.7+t5.atr14*0.35); const spread=safeDiv(market.quote.ask-market.quote.bid,market.quote.last,0); return clamp(1-distance/(expected*2.5)-spread*20,0,1);
}
export function chooseMakerPrice(intent:EntryIntent, market:MarketSymbolSnapshot, offsetTicks=0):MakerQuote {
  const {min,max}=intent.acceptablePriceRange; const tick=market.quote.tickSize,epsilon=Math.max(Number.EPSILON*Math.max(1,Math.abs(min),Math.abs(max))*8,tick*1e-9); const r=priceReachability(intent,market);
  if(intent.side==='LONG'){
    const makerCeiling=market.quote.bid-offsetTicks*tick; const desired=clamp(intent.idealPrice,min,max); const raw=Math.min(makerCeiling,desired); const price=roundToTick(raw,tick,'floor');
    return {price,reachable:price+epsilon>=min&&price-epsilon<=max,reachability:r,reason:price+epsilon<min?'best maker price is below AI acceptable range':'maker buy inside AI price range'};
  }
  const makerFloor=market.quote.ask+offsetTicks*tick; const desired=clamp(intent.idealPrice,min,max); const raw=Math.max(makerFloor,desired); const price=roundToTick(raw,tick,'ceil');
  return {price,reachable:price+epsilon>=min&&price-epsilon<=max,reachability:r,reason:price-epsilon>max?'best maker price is above AI acceptable range':'maker sell inside AI price range'};
}

import type {EntryIntent,MarketSymbolSnapshot,SystemSettings} from '@zdj/contracts';
import {chooseMakerPrice} from '@zdj/core';
export function nearMarketPrice(intent:EntryIntent,market:MarketSymbolSnapshot,settings:SystemSettings['entry'],now=Date.now()) {
  const policy=settings.nearMarket;
  if(!policy?.enabled)return chooseMakerPrice(intent,market,settings.makerOffsetTicks);
  const q=market.quote,anchor=intent.side==='LONG'?q.bid:q.ask,epsilon=q.tickSize*1e-7;
  const valid=Number.isFinite(anchor)&&anchor>0&&q.tickSize>0&&now-q.ts<=15000&&q.ts<=now+1000&&q.bid<=q.ask;
  const rows=valid?(market.recentTradedPrices??[]).filter(row=>{
    const delta=intent.side==='LONG'?anchor-row.price:row.price-anchor;
    return now-row.lastSeenAt<=300000&&row.lastSeenAt<=now+1000&&delta>=-epsilon&&delta<=policy.maxOffsetTicks*q.tickSize+epsilon&&delta/anchor*10000<=policy.maxDistanceBps&&row.price+epsilon>=intent.acceptablePriceRange.min&&row.price-epsilon<=intent.acceptablePriceRange.max&&Math.abs(row.price/q.tickSize-Math.round(row.price/q.tickSize))<1e-6;
  // All candidates are still bounded by recent-trade, near-quote, tick, and
  // AI-range checks.  Inside that legal set, honor Primary's ideal first.
  }).sort((a,b)=>Math.abs(a.price-intent.idealPrice)-Math.abs(b.price-intent.idealPrice)||Math.abs(a.price-anchor)-Math.abs(b.price-anchor)):[];
  const selected=rows[0];
  return{price:selected?.price??anchor,reachable:Boolean(selected),reachability:selected?1:0,reason:selected?'RECENT_TRADE_NEAR_QUOTE':'NO_RECENT_TRADE_IN_AUTHORIZED_NEAR_BAND',lastSeenAt:selected?.lastSeenAt??null};
}

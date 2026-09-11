import type { MarketQuality, MarketSymbolSnapshot, SystemSettings } from '@zdj/contracts';

type Thresholds=MarketQuality['calibration'];
const finite=(v:number|null|undefined)=>typeof v==='number'&&Number.isFinite(v);
const percentile=(values:Array<number|null|undefined>,p:number)=>{const rows=values.filter((value):value is number=>finite(value)).sort((a,b)=>a-b);return rows.length?rows[Math.min(rows.length-1,Math.floor((rows.length-1)*p))]!:0;};
const depth=(rows:ReadonlyArray<ReadonlyArray<unknown>>,mid:number,side:'BID'|'ASK',band:number)=>rows.reduce((total,row)=>{const price=Number(row[0]),qty=Number(row[1]);return total+((side==='BID'?price>=mid*(1-band):price<=mid*(1+band))?price*qty:0);},0);
const metrics=(s:MarketSymbolSnapshot)=>{const mid=(s.quote.bid+s.quote.ask)/2,oi=s.derivatives.openInterest==null?null:s.derivatives.openInterest*s.quote.mark;return{quoteVolumeUsd24h:s.quote.quoteVolumeUsd24h,tradeCount24h:s.quote.tradeCount24h,spreadBps:mid>0?(s.quote.ask-s.quote.bid)/mid*10_000:Infinity,bidDepth05Usd:depth(s.orderBook.bids,mid,'BID',.005),askDepth05Usd:depth(s.orderBook.asks,mid,'ASK',.005),bidDepth1Usd:depth(s.orderBook.bids,mid,'BID',.01),askDepth1Usd:depth(s.orderBook.asks,mid,'ASK',.01),openInterestUsd:oi,listingAgeDays:s.listingAgeDays??null,realizedVolatility15mPct:s.technical['15m'].atrPercent};};
const threshold=(configured:number,calibrated:number)=>configured>0?configured:calibrated;

/** One admission result shared by visibility, ranking, Pool, and Primary dispatch. */
export function assessMarketQuality(snapshots:MarketSymbolSnapshot[],settings:SystemSettings,makerFillQuality:Record<string,number|undefined>={}){
  const cfg=settings.selection.marketQuality??{enabled:true,minQuoteVolumeUsd24h:0,minTradeCount24h:0,maxSpreadBps:0,minDepthUsd:0,minOpenInterestUsd:0,minListingAgeDays:0,allowedGrades:['A','B'] as Array<'A'|'B'|'C'|'D'>,allowSpeculative:true,allowNewListings:false,liquidityTopN:0,symbolBlacklist:[],underlyingBlacklist:[]},rows=snapshots.map(metrics),base={
    minQuoteVolumeUsd24h:threshold(cfg.minQuoteVolumeUsd24h,percentile(rows.map(x=>x.quoteVolumeUsd24h),.25)),
    minTradeCount24h:threshold(cfg.minTradeCount24h,percentile(rows.map(x=>x.tradeCount24h),.25)),
    maxSpreadBps:threshold(cfg.maxSpreadBps,percentile(rows.map(x=>x.spreadBps),.75)),
    minDepthUsd:threshold(cfg.minDepthUsd,percentile(rows.map(x=>Math.min(x.bidDepth05Usd,x.askDepth05Usd)),.20)),
    minOpenInterestUsd:threshold(cfg.minOpenInterestUsd,percentile(rows.map(x=>x.openInterestUsd??0),.20)),
    minListingAgeDays:threshold(cfg.minListingAgeDays,percentile(rows.map(x=>x.listingAgeDays??0),.10)),
    maxRealizedVolatility15mPct:percentile(rows.map(x=>x.realizedVolatility15mPct),.90),
  } satisfies Thresholds;
  const ranks={volume:percentile(rows.map(x=>x.quoteVolumeUsd24h),.75),trades:percentile(rows.map(x=>x.tradeCount24h),.75),depth:percentile(rows.map(x=>Math.min(x.bidDepth05Usd,x.askDepth05Usd)),.50),oi:percentile(rows.map(x=>x.openInterestUsd??0),.50),spread:percentile(rows.map(x=>x.spreadBps),.25),age:percentile(rows.map(x=>x.listingAgeDays??0),.25),vol:percentile(rows.map(x=>x.realizedVolatility15mPct),.75)};
  return new Map(snapshots.map(s=>{const m=metrics(s),fill=makerFillQuality[s.symbol.toUpperCase()]??null,reasons:string[]=[];
    if(m.quoteVolumeUsd24h<base.minQuoteVolumeUsd24h)reasons.push('QUALITY_LOW_24H_VOLUME');
    if(m.tradeCount24h<base.minTradeCount24h)reasons.push('QUALITY_LOW_TRADE_COUNT');
    if(m.spreadBps>base.maxSpreadBps)reasons.push('QUALITY_WIDE_SPREAD');
    if(Math.min(m.bidDepth05Usd,m.askDepth05Usd)<base.minDepthUsd)reasons.push('QUALITY_SHALLOW_DEPTH');
    if(m.openInterestUsd!==null&&m.openInterestUsd<base.minOpenInterestUsd)reasons.push('QUALITY_LOW_OPEN_INTEREST');
    if(m.listingAgeDays!==null&&m.listingAgeDays<base.minListingAgeDays)reasons.push('QUALITY_NEW_LISTING');
    if(m.realizedVolatility15mPct>base.maxRealizedVolatility15mPct)reasons.push('QUALITY_HIGH_REALIZED_VOLATILITY');
    if(fill!==null&&fill<.35)reasons.push('QUALITY_POOR_MAKER_FILL_HISTORY');
    const a=m.quoteVolumeUsd24h>=ranks.volume&&m.tradeCount24h>=ranks.trades&&Math.min(m.bidDepth05Usd,m.askDepth05Usd)>=ranks.depth&&(m.openInterestUsd??0)>=ranks.oi&&m.spreadBps<=ranks.spread&&(m.listingAgeDays??Infinity)>=ranks.age&&m.realizedVolatility15mPct<=ranks.vol&&(fill===null||fill>=.65);
    const d=reasons.includes('QUALITY_NEW_LISTING')||reasons.length>=3,grade=d?'D':a?'A':reasons.length>=2?'C':'B';
    const violatesConfiguredFloor=(cfg.minQuoteVolumeUsd24h>0&&m.quoteVolumeUsd24h<cfg.minQuoteVolumeUsd24h)||(cfg.minTradeCount24h>0&&m.tradeCount24h<cfg.minTradeCount24h)||(cfg.maxSpreadBps>0&&m.spreadBps>cfg.maxSpreadBps)||(cfg.minDepthUsd>0&&Math.min(m.bidDepth05Usd,m.askDepth05Usd)<cfg.minDepthUsd)||(cfg.minOpenInterestUsd>0&&m.openInterestUsd!==null&&m.openInterestUsd<cfg.minOpenInterestUsd)||(cfg.minListingAgeDays>0&&m.listingAgeDays!==null&&m.listingAgeDays<cfg.minListingAgeDays);
    return[s.symbol.toUpperCase(),{grade,admitted:!cfg.enabled||(cfg.allowedGrades.includes(grade)&&!violatesConfiguredFloor),reasons,...m,makerFillQuality:fill,calibration:base} satisfies MarketQuality] as const;
  }));
}

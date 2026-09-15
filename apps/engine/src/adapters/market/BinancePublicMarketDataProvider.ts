import type {
  Candle,
  DerivativesSnapshot,
  MarketSymbolSnapshot,
  OrderBook,
  Quote,
  TechnicalCard,
  Timeframe,
} from "@zdj/contracts";
import { buildTechnicalCard, clamp } from "@zdj/core";
import type { MarketDataProvider } from "../../types.js";
import { BinanceTransport } from "../binance/BinanceTransport.js";
import { BinanceMarketStream } from "./BinanceMarketStream.js";

const INTERVAL: Record<Timeframe, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w",
};
const DERIVATIVES_TTL_MS=5*60_000;

export class BinancePublicMarketDataProvider implements MarketDataProvider {
  private exchangeInfo: {value:any;fetchedAt:number} | null = null;
  private discoveryTicker: {value:any[];fetchedAt:number} | null = null;
  private discoveryTickerFlight: Promise<any[]> | null = null;
  private hourlyCache=new Map<string,{until:number;rows:Candle[]}>();
  private liveTechnicalFingerprint=new Map<string,string>();
  private derivativesCache=new Map<string,{until:number;value:DerivativesSnapshot}>();
  private derivativesFlights=new Map<string,Promise<DerivativesSnapshot>>();
  private readonly stream: BinanceMarketStream;
  private coverage: Array<{requested:string;symbol:string|null;status:'COLLECTED'|'UNAVAILABLE';reason:string|null}> = [];

  constructor(private transport: BinanceTransport) {
    this.stream = new BinanceMarketStream(transport, async (symbol) => ({book: await this.restOrderBook(symbol),candles: await this.getCandles(symbol, "1m", 120)}));
  }

  private async hourlyCandles(symbol:string){const cached=this.hourlyCache.get(symbol),now=Date.now();if(cached&&now<cached.until)return cached.rows;try{const rows=await this.getCandles(symbol,'1h',80);this.hourlyCache.set(symbol,{rows,until:(Math.floor(now/3600000)+1)*3600000+1000});return rows;}catch{return cached?.rows??[];}}
  private async json<T>(path: string) {return this.transport.json<T>(path);}
  private async info(){if(!this.exchangeInfo||Date.now()-this.exchangeInfo.fetchedAt>=15*60_000)this.exchangeInfo={value:await this.json<any>("/fapi/v1/exchangeInfo"),fetchedAt:Date.now()};return this.exchangeInfo.value;}
  private async ticker24hForDiscovery(){const now=Date.now();if(this.discoveryTicker&&now-this.discoveryTicker.fetchedAt<60_000)return this.discoveryTicker.value;if(this.discoveryTickerFlight)return this.discoveryTickerFlight;const flight=this.json<any[]>("/fapi/v1/ticker/24hr").then(value=>{this.discoveryTicker={value,fetchedAt:Date.now()};return value;}).finally(()=>{this.discoveryTickerFlight=null;});this.discoveryTickerFlight=flight;return flight;}

  async discoverSymbols(limit:number,prioritySymbols:string[]=[]){
    const rows=(await this.ticker24hForDiscovery()).filter(x=>/USD[TC]$/.test(String(x.symbol))).sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume));
    const contracts=new Set(((await this.info()).symbols??[]).filter((x:any)=>x.status==='TRADING'&&x.contractType==='PERPETUAL'&&/USD[TC]$/.test(String(x.symbol))).map((x:any)=>String(x.symbol).toUpperCase()));
    const tickerSymbols=new Set(rows.map(x=>String(x.symbol).toUpperCase()));
    const resolvePriority=(requested:string)=>{const value=String(requested).trim().toUpperCase().replace(/[\s/_-]+/g,''),exact=/USD[TC]$/.test(value)?value:null,options=exact?[exact]:[`${value}USDT`,`${value}USDC`];return options.find(symbol=>contracts.has(symbol)&&tickerSymbols.has(symbol))??null;};
    this.coverage=prioritySymbols.map(requested=>{const symbol=resolvePriority(requested);return{requested:String(requested).toUpperCase(),symbol,status:symbol?'COLLECTED' as const:'UNAVAILABLE' as const,reason:symbol?null:(/USD[TC]$/.test(String(requested).toUpperCase())&&!contracts.has(String(requested).toUpperCase())?'NO_EXECUTION_CONTRACT':'NO_EXECUTION_MARKET_DATA')};});
    const priority=this.coverage.flatMap(row=>{if(!row.symbol)return[];const requested=String(row.requested).replace(/USD[TC]$/,''),alternates=[`${requested}USDT`,`${requested}USDC`].filter(symbol=>contracts.has(symbol)&&tickerSymbols.has(symbol));return alternates.length?alternates:[row.symbol];});
    const usdc=rows.filter(x=>String(x.symbol).endsWith("USDC")).slice(0,Math.max(4,Math.ceil(limit*.2)));
    return [...new Set(["BTCUSDT","ETHUSDT",...priority,...rows.slice(0,limit).map(x=>String(x.symbol)),...usdc.map(x=>String(x.symbol))])];
  }
  async listSymbols(limit:number,prioritySymbols:string[]=[]){return this.discoverSymbols(limit,prioritySymbols);}
  collectionCoverage(){return this.coverage.map(row=>({...row}));}
  setLiveSymbols(symbols:string[]){this.stream.start([...new Set(symbols.map(x=>x.toUpperCase()))]);}

  private async rules(symbol:string){const info=await this.info(),s=info.symbols.find((x:any)=>x.symbol===symbol);if(!s)throw new Error(`Unknown Binance symbol ${symbol}`);const pf=s.filters.find((x:any)=>x.filterType==='PRICE_FILTER'),lf=s.filters.find((x:any)=>x.filterType==='LOT_SIZE'),nf=s.filters.find((x:any)=>x.filterType==='MIN_NOTIONAL'),values={tickSize:Number(pf?.tickSize),stepSize:Number(lf?.stepSize),minQty:Number(lf?.minQty),minNotional:Number(nf?.notional)};if(!pf||!lf||!nf||Object.values(values).some(value=>!Number.isFinite(value)||value<=0))throw new Error(`BINANCE_REQUIRED_FILTER_INVALID:${symbol}`);return values;}

  async getQuote(symbol:string):Promise<Quote>{
    const cached=this.stream.quote(symbol),rules=await this.rules(symbol);
    if(cached?.last&&cached.mark&&cached.bid&&cached.ask&&Date.now()-(cached.ts??0)<=15_000)return{symbol,last:cached.last,mark:cached.mark,bid:cached.bid,ask:cached.ask,...rules,quoteVolumeUsd24h:cached.quoteVolumeUsd24h??0,priceChangePercent24h:cached.priceChangePercent24h??0,tradeCount24h:cached.tradeCount24h??0,ts:cached.ts??Date.now()};
    const t=await this.json<any>(`/fapi/v1/ticker/24hr?symbol=${symbol}`);
    const p=await this.json<any>(`/fapi/v1/premiumIndex?symbol=${symbol}`);
    const book=await this.json<any>(`/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
    return{symbol,last:Number(t.lastPrice),mark:Number(p.markPrice),bid:Number(book.bidPrice),ask:Number(book.askPrice),...rules,quoteVolumeUsd24h:Number(t.quoteVolume),priceChangePercent24h:Number(t.priceChangePercent),tradeCount24h:Number(t.count??0),ts:Date.now()};
  }

  private candleFlights=new Map<string,Promise<Candle[]>>();private candleCache=new Map<string,{rows:Candle[];until:number}>();
  cachedCandles(symbol:string,timeframe:Timeframe,limit:number):Candle[]{const period=timeframe==='1m'?60000:timeframe==='5m'?300000:900000,live=['1m','5m','15m'].includes(timeframe)?this.stream.candleSeries(symbol,period*2,timeframe):null;if(live?.length)return live.slice(-limit);const rows=[...this.candleCache.entries()].filter(([key])=>key.startsWith(`${symbol}:${timeframe}:`)).map(([,value])=>value.rows).sort((a,b)=>(b.at(-1)?.closeTime??0)-(a.at(-1)?.closeTime??0));return rows[0]?.slice(-limit)??[];}
  async getCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>{const period=timeframe==='1m'?60000:timeframe==='5m'?300000:900000;if(['1m','5m','15m'].includes(timeframe)){const live=this.stream.candleSeries(symbol,period*2,timeframe),closed=live?.filter(c=>c.isClosed===true&&c.closeTime<Date.now());if(live&&live.length>=limit&&closed?.at(-1)?.closeTime===(Math.floor(Date.now()/period)*period-1))return live.slice(-limit);}const key=`${symbol}:${timeframe}:${limit}`,cached=this.candleCache.get(key);if(cached&&cached.until>Date.now())return cached.rows;const pending=this.candleFlights.get(key);if(pending)return pending;const flight=this.loadCandles(symbol,timeframe,limit).then(rows=>{const last=rows.at(-1),now=Date.now(),period=Math.max(1000,(last?.closeTime??now)-(last?.openTime??now)+1),until=last&&last.closeTime>=now?last.closeTime+1000:now+Math.min(period,30_000);if(this.candleCache.size>=2000)this.candleCache.delete(this.candleCache.keys().next().value!);this.candleCache.set(key,{rows,until});return rows;}).finally(()=>this.candleFlights.delete(key));this.candleFlights.set(key,flight);return flight;}
  private async loadCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>{const receivedAt=Date.now(),rows=await this.json<any[]>(`/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL[timeframe]}&limit=${limit}`),candles=rows.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6]),receivedAt,isClosed:Number(r[6])<=receivedAt,source:'BINANCE_REST' as const,quoteVolume:Number(r[7]),trades:Number(r[8])}));if(['1m','5m','15m'].includes(timeframe))this.stream.seedCandles(symbol,timeframe,candles);return candles;}
  private async restOrderBook(symbol:string):Promise<OrderBook>{const d=await this.json<any>(`/fapi/v1/depth?symbol=${symbol}&limit=20`);return{symbol,bids:d.bids.map((x:any)=>[Number(x[0]),Number(x[1])] as [number,number]),asks:d.asks.map((x:any)=>[Number(x[0]),Number(x[1])] as [number,number]),ts:Date.now()};}
  async getOrderBook(symbol:string):Promise<OrderBook>{return this.stream.book(symbol)??this.restOrderBook(symbol);}

  hydrateLiveMarket(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{const quote=this.stream.quote(snapshot.symbol),book=this.stream.book(snapshot.symbol);if(!quote&&!book)return snapshot;const now=Date.now();return{...snapshot,recentTradedPrices:this.stream.tradedPrices.near(snapshot.symbol,quote?.bid??snapshot.quote.bid,quote?.ask??snapshot.quote.ask,snapshot.quote.tickSize),quote:quote?{...snapshot.quote,last:quote.last??snapshot.quote.last,mark:quote.mark??snapshot.quote.mark,bid:quote.bid??snapshot.quote.bid,ask:quote.ask??snapshot.quote.ask,quoteVolumeUsd24h:quote.quoteVolumeUsd24h??snapshot.quote.quoteVolumeUsd24h,priceChangePercent24h:quote.priceChangePercent24h??snapshot.quote.priceChangePercent24h,tradeCount24h:quote.tradeCount24h??snapshot.quote.tradeCount24h,ts:quote.ts??now}:snapshot.quote,orderBook:book??snapshot.orderBook};}
  hydrateLiveTechnical(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{const now=Date.now();for(const tf of ['1m','5m','15m'] as const){const period=tf==='1m'?60000:tf==='5m'?300000:900000,candles=this.stream.candleSeries(snapshot.symbol,period*2,tf);if(!candles)continue;const closed=candles.filter(c=>c.isClosed===true&&c.closeTime<now);if(closed.length<(tf==='15m'?240:20))continue;const sequence=closed.map(c=>`${c.openTime}:${c.closeTime}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume}`).join('|'),key=`${snapshot.symbol}:${tf}`;if(this.liveTechnicalFingerprint.get(key)===sequence)continue;this.liveTechnicalFingerprint.set(key,sequence);try{return{...snapshot,technical:{...snapshot.technical,[tf]:buildTechnicalCard(tf,candles)}};}catch(error){if(error&&typeof error==='object')Object.assign(error,{technicalTimeframe:tf,technicalSequence:sequence});throw error;}}return snapshot;}
  hydrateLive(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{return this.hydrateLiveTechnical(this.hydrateLiveMarket(snapshot));}
  streamMetrics(){return this.stream.metrics();}stop(){this.stream.stop();}
  private async optional<T>(url:string,fallback:T):Promise<T>{try{return await this.json<T>(url);}catch{return fallback;}}

  async getDerivatives(symbol:string):Promise<DerivativesSnapshot>{
    const key=symbol.toUpperCase(),now=Date.now(),cached=this.derivativesCache.get(key);if(cached&&cached.until>now)return cached.value;
    const pending=this.derivativesFlights.get(key);if(pending)return pending;
    const flight=(async()=>{
      const testnet=this.transport.environment()==='TESTNET';
      const oi=await this.optional<any>(`/fapi/v1/openInterest?symbol=${key}`,null);
      const premium=await this.optional<any>(`/fapi/v1/premiumIndex?symbol=${key}`,null);
      let oiHist:any[]=[],taker:any[]=[],globalRatio:any[]=[],topPos:any[]=[];
      if(!testnet){
        oiHist=await this.optional<any[]>(`/futures/data/openInterestHist?symbol=${key}&period=5m&limit=4`,[]);
        taker=await this.optional<any[]>(`/futures/data/takerlongshortRatio?symbol=${key}&period=5m&limit=3`,[]);
        globalRatio=await this.optional<any[]>(`/futures/data/globalLongShortAccountRatio?symbol=${key}&period=5m&limit=2`,[]);
        topPos=await this.optional<any[]>(`/futures/data/topLongShortPositionRatio?symbol=${key}&period=5m&limit=2`,[]);
      }
      const pct=(arr:any[],span:number)=>arr.length>span&&Number(arr.at(-1)?.sumOpenInterestValue??arr.at(-1)?.sumOpenInterest)>0?Number(arr.at(-1)?.sumOpenInterestValue??arr.at(-1)?.sumOpenInterest)/Number(arr.at(-1-span)?.sumOpenInterestValue??arr.at(-1-span)?.sumOpenInterest)-1:null;
      const value:DerivativesSnapshot={symbol:key,openInterest:oi?Number(oi.openInterest):null,openInterestChange5m:pct(oiHist,1),openInterestChange15m:pct(oiHist,3),fundingRate:premium?Number(premium.lastFundingRate):null,takerBuySellRatio5m:taker.length?Number(taker.at(-1)?.buySellRatio):null,globalLongShortRatio:globalRatio.length?Number(globalRatio.at(-1)?.longShortRatio):null,topTraderPositionRatio:topPos.length?Number(topPos.at(-1)?.longShortRatio):null,ts:Date.now()};
      this.derivativesCache.set(key,{until:Date.now()+DERIVATIVES_TTL_MS,value});return value;
    })().finally(()=>this.derivativesFlights.delete(key));
    this.derivativesFlights.set(key,flight);return flight;
  }

  async getSnapshot(symbol:string):Promise<MarketSymbolSnapshot>{
    const frames=["1m","5m","15m","1h","4h","1d","1w"] as Timeframe[],hydrateOrder=["15m","1m","5m","1h","4h","1d","1w"] as Timeframe[];
    const quote=await this.getQuote(symbol);
    const orderBook=await this.getOrderBook(symbol);
    const byFrame=new Map<Timeframe,Candle[]>();
    for(const tf of hydrateOrder){
      const rows=tf==='1m'?await this.getCandles(symbol,tf,81):tf==='5m'?await this.getCandles(symbol,tf,81):tf==='15m'?await this.getCandles(symbol,tf,241):tf==='1h'?await this.hourlyCandles(symbol):await this.getCandles(symbol,tf,80);
      byFrame.set(tf,rows);
    }
    const derivatives=await this.getDerivatives(symbol),candles=frames.map(tf=>byFrame.get(tf)??[]);
    const technical=Object.fromEntries(frames.flatMap((tf,i)=>candles[i]!.length?[[tf,buildTechnicalCard(tf,candles[i]!)]]:[])) as Record<Timeframe,TechnicalCard>;
    this.stream.seed(symbol,orderBook,candles[0]!);let completeness=.72;if(orderBook.bids.length&&orderBook.asks.length)completeness+=.12;if(derivatives.openInterest!=null)completeness+=.08;if(derivatives.takerBuySellRatio5m!=null)completeness+=.08;
    const contract=(await this.info()).symbols.find((row:any)=>row.symbol===symbol),onboard=Number(contract?.onboardDate??0),listingAgeDays=onboard>0?Math.max(0,(Date.now()-onboard)/86_400_000):null;
    return{symbol,quote,orderBook,derivatives,technical,dataCompleteness:clamp(completeness,0,1),listingAgeDays};
  }
}

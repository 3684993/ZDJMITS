import type {
  Candle,
  DerivativesSnapshot,
  MarketSymbolSnapshot,
  OrderBook,
  Quote,
  TechnicalCard,
  Timeframe,
} from "@zdj/contracts";
import { buildTechnicalCard, clamp, CANDLE_PERIOD_MS, closedCandleGap } from "@zdj/core";
import type { CandleContinuity } from "@zdj/core";
import type { MarketDataProvider } from "../../types.js";
import { BinanceTransport } from "../binance/BinanceTransport.js";
import { BinanceMarketStream } from "./BinanceMarketStream.js";

const INTERVAL: Record<Timeframe, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w",
};
const DERIVATIVES_TTL_MS=5*60_000;

export class BinancePublicMarketDataProvider implements MarketDataProvider {
  private exchangeInfo: {value:any;fetchedAt:number} | null = null;
  private exchangeInfoFlight: Promise<any> | null = null;
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
  private async info(){const now=Date.now();if(this.exchangeInfo&&now-this.exchangeInfo.fetchedAt<15*60_000)return this.exchangeInfo.value;if(this.exchangeInfoFlight)return this.exchangeInfoFlight;const flight=this.json<any>("/fapi/v1/exchangeInfo").then(value=>{this.exchangeInfo={value,fetchedAt:Date.now()};return value;}).finally(()=>{this.exchangeInfoFlight=null;});this.exchangeInfoFlight=flight;return flight;}
  private async ticker24hForDiscovery(){const now=Date.now();if(this.discoveryTicker&&now-this.discoveryTicker.fetchedAt<60_000)return this.discoveryTicker.value;if(this.discoveryTickerFlight)return this.discoveryTickerFlight;const flight=this.json<any[]>("/fapi/v1/ticker/24hr").then(value=>{this.discoveryTicker={value,fetchedAt:Date.now()};return value;}).finally(()=>{this.discoveryTickerFlight=null;});this.discoveryTickerFlight=flight;return flight;}

  async discoverSymbols(limit:number,prioritySymbols:string[]=[]){
    const rows=(await this.ticker24hForDiscovery()).filter(x=>/USD[TC]$/.test(String(x.symbol))).sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume));
    const contracts=new Set(((await this.info()).symbols??[]).filter((x:any)=>x.status==='TRADING'&&x.contractType==='PERPETUAL'&&/USD[TC]$/.test(String(x.symbol))).map((x:any)=>String(x.symbol).toUpperCase()));
    const tickerSymbols=new Set(rows.map(x=>String(x.symbol).toUpperCase()));
    const resolvePriority=(requested:string)=>{const value=String(requested).trim().toUpperCase().replace(/[\s/_-]+/g,''),exact=/USD[TC]$/.test(value)?value:null,options=exact?[exact]:[`${value}USDT`,`${value}USDC`];return options.find(symbol=>contracts.has(symbol)&&tickerSymbols.has(symbol))??null;};
    this.coverage=prioritySymbols.map(requested=>{const symbol=resolvePriority(requested);return{requested:String(requested).toUpperCase(),symbol,status:symbol?'COLLECTED' as const:'UNAVAILABLE' as const,reason:symbol?null:(/USD[TC]$/.test(String(requested).toUpperCase())&&!contracts.has(String(requested).toUpperCase())?'NO_EXECUTION_CONTRACT':'NO_EXECUTION_MARKET_DATA')};});
    const priority=this.coverage.flatMap(row=>{if(!row.symbol)return[];const requested=String(row.requested).replace(/USD[TC]$/,''),alternates=[`${requested}USDT`,`${requested}USDC`].filter(symbol=>contracts.has(symbol)&&tickerSymbols.has(symbol));return alternates.length?alternates:[row.symbol];});
    const top=rows.slice(0,limit).map(x=>String(x.symbol).toUpperCase());
    // Discovery must expose both funded quote contracts before portfolio routing can choose one.
    // Keep this bounded: pair only the leading underlyings instead of doubling the whole cohort.
    const pairBudget=Math.max(4,Math.min(8,Math.ceil(limit*.4)));
    const paired=top.slice(0,pairBudget).flatMap(symbol=>{const underlying=symbol.replace(/USD[TC]$/,'');return [`${underlying}USDT`,`${underlying}USDC`].filter(candidate=>contracts.has(candidate)&&tickerSymbols.has(candidate));});
    const corePairs=["BTCUSDT","BTCUSDC","ETHUSDT","ETHUSDC"].filter(symbol=>contracts.has(symbol)&&tickerSymbols.has(symbol));
    const usdc=rows.filter(x=>String(x.symbol).endsWith("USDC")).slice(0,Math.max(4,Math.ceil(limit*.2)));
    return [...new Set(["BTCUSDT","ETHUSDT",...corePairs,...priority,...top,...paired,...usdc.map(x=>String(x.symbol))])];
  }
  async listSymbols(limit:number,prioritySymbols:string[]=[]){return this.discoverSymbols(limit,prioritySymbols);}
  collectionCoverage(){return this.coverage.map(row=>({...row}));}
  setLiveSymbols(symbols:string[]){this.stream.start([...new Set(symbols.map(x=>x.toUpperCase()))]);void this.info().catch(()=>{});}
  /** Static contract filters can be used even when the live quote is stale/missing. */
  cachedContractRules(symbol:string){
    const info=this.exchangeInfo?.value,s=info?.symbols?.find((row:any)=>row.symbol===symbol);
    if(!s)return undefined;
    const pf=s.filters?.find((x:any)=>x.filterType==='PRICE_FILTER'),lf=s.filters?.find((x:any)=>x.filterType==='LOT_SIZE'),nf=s.filters?.find((x:any)=>x.filterType==='MIN_NOTIONAL');
    const rules={tickSize:Number(pf?.tickSize),stepSize:Number(lf?.stepSize),minQty:Number(lf?.minQty),minNotional:Number(nf?.notional)};
    if(!pf||!lf||!nf||Object.values(rules).some(value=>!Number.isFinite(value)||value<=0))return undefined;
    return rules;
  }
  async getContractRules(symbol:string){return this.rules(symbol);}
  /** Never performs I/O. Manual/dashboard reads may use this without spending REST budget. */
  cachedQuote(symbol:string):Quote|undefined{
    const q=this.stream.quote(symbol),info=this.exchangeInfo?.value,s=info?.symbols?.find((row:any)=>row.symbol===symbol);
    if(!q||!s)return undefined;
    const pf=s.filters?.find((x:any)=>x.filterType==='PRICE_FILTER'),lf=s.filters?.find((x:any)=>x.filterType==='LOT_SIZE'),nf=s.filters?.find((x:any)=>x.filterType==='MIN_NOTIONAL');
    const rules={tickSize:Number(pf?.tickSize),stepSize:Number(lf?.stepSize),minQty:Number(lf?.minQty),minNotional:Number(nf?.notional)};
    const required=[q.last,q.mark,q.bid,q.ask,q.ts,...Object.values(rules)];
    if(!pf||!lf||!nf||required.some(value=>!Number.isFinite(Number(value))||Number(value)<=0))return undefined;
    return{symbol,last:Number(q.last),mark:Number(q.mark),bid:Number(q.bid),ask:Number(q.ask),...rules,quoteVolumeUsd24h:Number(q.quoteVolumeUsd24h??0),priceChangePercent24h:Number(q.priceChangePercent24h??0),tradeCount24h:Number(q.tradeCount24h??0),ts:Number(q.ts)};
  }

  private async rules(symbol:string){const info=await this.info(),s=info.symbols.find((x:any)=>x.symbol===symbol);if(!s)throw new Error(`Unknown Binance symbol ${symbol}`);const pf=s.filters.find((x:any)=>x.filterType==='PRICE_FILTER'),lf=s.filters.find((x:any)=>x.filterType==='LOT_SIZE'),nf=s.filters.find((x:any)=>x.filterType==='MIN_NOTIONAL'),values={tickSize:Number(pf?.tickSize),stepSize:Number(lf?.stepSize),minQty:Number(lf?.minQty),minNotional:Number(nf?.notional)};if(!pf||!lf||!nf||Object.values(values).some(value=>!Number.isFinite(value)||value<=0))throw new Error(`BINANCE_REQUIRED_FILTER_INVALID:${symbol}`);return values;}

  private quoteFlights=new Map<string,Promise<Quote>>();
  private bookFlights=new Map<string,Promise<OrderBook>>();
  private premiumFlights=new Map<string,Promise<{at:number;value:any}>>();
  private premiumCache=new Map<string,{at:number;value:any}>();
  private premiumIndexFact(symbol:string,critical:boolean){
    const cached=this.premiumCache.get(symbol);if(cached&&Date.now()-cached.at<=5_000)return Promise.resolve(cached);
    // A required mark must not inherit a queued advisory read's priority/deadline.
    // Coalesce within each lane; a late older response cannot replace a newer fact.
    const key=`${symbol}:${critical?'critical':'background'}`,pending=this.premiumFlights.get(key);if(pending)return pending;
    let at=Date.now();
    const flight=this.transport.json<any>(`/fapi/v1/premiumIndex?symbol=${symbol}`,{source:critical?'MARKET_DATA':'BACKGROUND_AUDIT',purpose:critical?'QUOTE_MARK_RECOVERY':'DERIVATIVES_CONTEXT_MARK_PRICE',timeoutMs:critical?undefined:3_000,onDispatch:startedAt=>{at=startedAt;}}).then(value=>{
      const fact={at,value};if(at>=(this.premiumCache.get(symbol)?.at??0)){if(this.premiumCache.size>=512&&!this.premiumCache.has(symbol))this.premiumCache.delete(this.premiumCache.keys().next().value!);this.premiumCache.set(symbol,fact);}return fact;
    }).finally(()=>this.premiumFlights.delete(key));this.premiumFlights.set(key,flight);return flight;
  }
  private premiumIndex(symbol:string,critical:boolean){return this.premiumIndexFact(symbol,critical).then(fact=>fact.value);}
  getQuote(symbol:string):Promise<Quote>{
    const pending=this.quoteFlights.get(symbol);if(pending)return pending;
    const flight=this.loadQuote(symbol).finally(()=>this.quoteFlights.delete(symbol));this.quoteFlights.set(symbol,flight);return flight;
  }
  private async loadQuote(symbol:string):Promise<Quote>{
    const rules=await this.rules(symbol),fields=this.stream.quoteFields(symbol),work:Promise<unknown>[]=[];
    // Required facts retain their own timestamp. Never pull all three endpoints for one gap.
    if(fields.last===undefined||fields.quoteVolumeUsd24h===undefined){let at=Date.now();work.push(this.transport.json<any>(`/fapi/v1/ticker/24hr?symbol=${symbol}`,{source:'MARKET_DATA',purpose:'QUOTE_LAST_RECOVERY',onDispatch:startedAt=>{at=startedAt;}}).then(t=>this.stream.seedQuote(symbol,{last:Number(t.lastPrice),quoteVolumeUsd24h:Number(t.quoteVolume),priceChangePercent24h:Number(t.priceChangePercent),tradeCount24h:Number(t.count??0),ts:at})));}
    if(fields.mark===undefined)work.push(this.premiumIndexFact(symbol,true).then(({at,value:p})=>this.stream.seedQuote(symbol,{mark:Number(p.markPrice),ts:Number(p.time)>0?Number(p.time):at})));
    if(fields.bid===undefined||fields.ask===undefined)work.push(this.getOrderBook(symbol).then(book=>{if(!book.bids.length||!book.asks.length)throw new Error(`BINANCE_BOOK_FACT_UNAVAILABLE:${symbol}`);this.stream.seedQuote(symbol,{bid:book.bids[0]![0],ask:book.asks[0]![0],ts:book.ts});}));
    await Promise.all(work);
    const q=this.stream.quote(symbol);if(!q?.last||!q.mark||!q.bid||!q.ask||!q.ts)throw new Error(`BINANCE_REQUIRED_QUOTE_FACT_UNAVAILABLE:${symbol}`);
    return{symbol,last:q.last,mark:q.mark,bid:q.bid,ask:q.ask,...rules,quoteVolumeUsd24h:q.quoteVolumeUsd24h??0,priceChangePercent24h:q.priceChangePercent24h??0,tradeCount24h:q.tradeCount24h??0,ts:q.ts};
  }

  private candleFlights=new Map<string,Promise<Candle[]>>();private candleCache=new Map<string,{rows:Candle[];until:number}>();
  cachedCandles(symbol:string,timeframe:Timeframe,limit:number):Candle[]{const period=timeframe==='1m'?60000:timeframe==='5m'?300000:900000,live=['1m','5m','15m'].includes(timeframe)?this.stream.candleSeries(symbol,period*2,timeframe):null;if(live?.length)return live.slice(-limit);const rows=[...this.candleCache.entries()].filter(([key])=>key.startsWith(`${symbol}:${timeframe}:`)).map(([,value])=>value.rows).sort((a,b)=>(b.at(-1)?.closeTime??0)-(a.at(-1)?.closeTime??0));return rows[0]?.slice(-limit)??[];}
  async getCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>{const period=timeframe==='1m'?60000:timeframe==='5m'?300000:900000;if(['1m','5m','15m'].includes(timeframe)){const live=this.stream.candleSeries(symbol,period*2,timeframe);if(live&&live.length>=limit){const continuity=closedCandleGap(live,timeframe);if(continuity.ok&&continuity.closedCount>=limit&&continuity.latestClosedAtBoundary)return live.slice(-limit);}}const key=`${symbol}:${timeframe}:${limit}`,cached=this.candleCache.get(key);if(cached&&cached.until>Date.now())return cached.rows;const pending=this.candleFlights.get(key);if(pending)return pending;const flight=this.loadCandles(symbol,timeframe,limit).then(rows=>{const last=rows.at(-1),now=Date.now(),period=Math.max(1000,(last?.closeTime??now)-(last?.openTime??now)+1),until=last&&last.closeTime>=now?last.closeTime+1000:now+Math.min(period,30_000);if(this.candleCache.size>=2000)this.candleCache.delete(this.candleCache.keys().next().value!);this.candleCache.set(key,{rows,until});return rows;}).finally(()=>this.candleFlights.delete(key));this.candleFlights.set(key,flight);return flight;}
  private async loadCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>{const receivedAt=Date.now(),rows=await this.json<any[]>(`/fapi/v1/klines?symbol=${symbol}&interval=${INTERVAL[timeframe]}&limit=${limit}`),candles=rows.map(r=>({openTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),closeTime:Number(r[6]),receivedAt,isClosed:Number(r[6])<=receivedAt,source:'BINANCE_REST' as const,quoteVolume:Number(r[7]),trades:Number(r[8])}));if(!['1m','5m','15m'].includes(timeframe))return candles;this.stream.seedCandles(symbol,timeframe,candles);const merged=this.stream.candleSeries(symbol,CANDLE_PERIOD_MS[timeframe]*2,timeframe),continuity=merged?closedCandleGap(merged,timeframe):null;return continuity?.ok&&continuity.closedCount>=limit&&continuity.latestClosedAtBoundary?merged!.slice(-limit):candles;}
  /**
   * Targeted closed-candle repair for one symbol/timeframe. Always goes to REST
   * (the shared live cache is the thing under suspicion), merges through the existing
   * seedCandles path and reports whether continuity is back. It never assembles a
   * snapshot, so a WebSocket candle hole costs one klines request instead of a full
   * quote/book/seven-frame/derivatives refresh.
   */
  private repairFlights=new Map<string,Promise<CandleContinuity>>();
  repairCandles(symbol:string,timeframe:Timeframe):Promise<CandleContinuity>{
    if(!['1m','5m','15m'].includes(timeframe))return Promise.reject(new Error(`CANDLE_REPAIR_UNSUPPORTED_TIMEFRAME:${timeframe}`));
    const key=`${symbol}:${timeframe}`,pending=this.repairFlights.get(key);if(pending)return pending;
    const limit=timeframe==='15m'?241:120;
    const flight=this.loadCandles(symbol,timeframe,limit).then(()=>closedCandleGap(this.stream.candleSeries(symbol,CANDLE_PERIOD_MS[timeframe]*2,timeframe)??[],timeframe)).finally(()=>this.repairFlights.delete(key));
    this.repairFlights.set(key,flight);return flight;
  }

  private async restOrderBook(symbol:string):Promise<OrderBook>{let at=Date.now();const d=await this.transport.json<any>(`/fapi/v1/depth?symbol=${symbol}&limit=20`,{source:'MARKET_DATA',purpose:'QUOTE_BOOK_RECOVERY',onDispatch:startedAt=>{at=startedAt;}}),ts=Number(d.T??d.E)>0?Number(d.T??d.E):at;if(!Number.isFinite(ts)||ts>Date.now()+1_000)throw new Error(`BINANCE_BOOK_TIMESTAMP_INVALID:${symbol}`);return{symbol,bids:d.bids.map((x:any)=>[Number(x[0]),Number(x[1])] as [number,number]),asks:d.asks.map((x:any)=>[Number(x[0]),Number(x[1])] as [number,number]),ts};}
  async getOrderBook(symbol:string):Promise<OrderBook>{const live=this.stream.book(symbol);if(live)return live;const pending=this.bookFlights.get(symbol);if(pending)return pending;const flight=this.restOrderBook(symbol).then(book=>{this.stream.seed(symbol,book,[]);return this.stream.book(symbol)??book;}).finally(()=>this.bookFlights.delete(symbol));this.bookFlights.set(symbol,flight);return flight;}

  hydrateLiveMarket(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{const quote=this.stream.quote(snapshot.symbol),book=this.stream.book(snapshot.symbol);if(!quote&&!book)return snapshot;const now=Date.now();return{...snapshot,recentTradedPrices:this.stream.tradedPrices.near(snapshot.symbol,quote?.bid??snapshot.quote.bid,quote?.ask??snapshot.quote.ask,snapshot.quote.tickSize),quote:quote?{...snapshot.quote,last:quote.last??snapshot.quote.last,mark:quote.mark??snapshot.quote.mark,bid:quote.bid??snapshot.quote.bid,ask:quote.ask??snapshot.quote.ask,quoteVolumeUsd24h:quote.quoteVolumeUsd24h??snapshot.quote.quoteVolumeUsd24h,priceChangePercent24h:quote.priceChangePercent24h??snapshot.quote.priceChangePercent24h,tradeCount24h:quote.tradeCount24h??snapshot.quote.tradeCount24h,ts:quote.ts??now}:snapshot.quote,orderBook:book??snapshot.orderBook};}
  hydrateLiveTechnical(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{const now=Date.now();for(const tf of ['1m','5m','15m'] as const){const period=tf==='1m'?60000:tf==='5m'?300000:900000,candles=this.stream.candleSeries(snapshot.symbol,period*2,tf);if(!candles)continue;const closed=candles.filter(c=>c.isClosed===true&&c.closeTime<now);if(closed.length<(tf==='15m'?240:20))continue;const sequence=closed.map(c=>`${c.openTime}:${c.closeTime}:${c.open}:${c.high}:${c.low}:${c.close}:${c.volume}`).join('|'),key=`${snapshot.symbol}:${tf}`;if(this.liveTechnicalFingerprint.get(key)===sequence)continue;this.liveTechnicalFingerprint.set(key,sequence);try{return{...snapshot,technical:{...snapshot.technical,[tf]:buildTechnicalCard(tf,candles)}};}catch(error){if(error&&typeof error==='object')Object.assign(error,{technicalTimeframe:tf,technicalSequence:sequence});throw error;}}return snapshot;}
  hydrateLive(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot{return this.hydrateLiveTechnical(this.hydrateLiveMarket(snapshot));}
  streamMetrics(){return this.stream.metrics();}stop(){this.stream.stop();}
  private async optional<T>(url:string,fallback:T,init:{timeoutMs?:number;source?:string;purpose?:string}={}):Promise<T>{try{return await this.transport.json<T>(url,init);}catch{return fallback;}}
  private neutralDerivatives(symbol:string):DerivativesSnapshot{return{symbol,openInterest:null,openInterestChange5m:null,openInterestChange15m:null,fundingRate:null,takerBuySellRatio5m:null,globalLongShortRatio:null,topTraderPositionRatio:null,ts:0};}

  async getDerivatives(symbol:string):Promise<DerivativesSnapshot>{
    const key=symbol.toUpperCase(),now=Date.now(),cached=this.derivativesCache.get(key);if(cached&&cached.until>now)return cached.value;
    const pending=this.derivativesFlights.get(key);if(pending)return pending;
    const flight=(async()=>{
      const testnet=this.transport.environment()==='TESTNET';
      // Derivatives are contextual ranking evidence, never an Entry correctness fact. Keep these
      // bounded and on the BACKGROUND lane so a slow Testnet REST endpoint cannot stall a snapshot.
      const [oi,premium]=await Promise.all([
        this.optional<any>(`/fapi/v1/openInterest?symbol=${key}`,null,{timeoutMs:3_000,source:'BACKGROUND_AUDIT',purpose:'DERIVATIVES_CONTEXT_OPEN_INTEREST'}),
        this.premiumIndex(key,false).catch(()=>null),
      ]);
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
    // Resolve executable facts first. Candle hydration is two reads per symbol, not a
    // seven-request fanout competing with current account/reduction truth.
    const [quote,orderBook]=await Promise.all([this.getQuote(symbol),this.getOrderBook(symbol)]);
    const loaded:Candle[][]=new Array(hydrateOrder.length);let cursor=0;
    const worker=async()=>{while(cursor<hydrateOrder.length){const index=cursor++,tf=hydrateOrder[index]!;loaded[index]=await (tf==='1m'?this.getCandles(symbol,tf,81):tf==='5m'?this.getCandles(symbol,tf,81):tf==='15m'?this.getCandles(symbol,tf,241):tf==='1h'?this.hourlyCandles(symbol):this.getCandles(symbol,tf,80));}};
    await Promise.all([worker(),worker()]);

    const byFrame=new Map<Timeframe,Candle[]>();hydrateOrder.forEach((tf,index)=>byFrame.set(tf,loaded[index]??[]));
    // Open interest/funding context is refreshed on the slow-field cadence. Cold startup must not wait
    // for it, and missing derivatives are neutral evidence rather than incomplete execution data.
    const derivatives=this.derivativesCache.get(symbol)?.value??this.neutralDerivatives(symbol),candles=frames.map(tf=>byFrame.get(tf)??[]);
    const technical=Object.fromEntries(frames.flatMap((tf,i)=>candles[i]!.length?[[tf,buildTechnicalCard(tf,candles[i]!)]]:[])) as Record<Timeframe,TechnicalCard>;
    this.stream.seed(symbol,orderBook,candles[0]!);
    const hotComplete=(['1m','5m','15m'] as const).every(tf=>(byFrame.get(tf)?.length??0)>0),completeness=.76+((orderBook.bids.length&&orderBook.asks.length) ? .12 : 0)+(hotComplete ? .12 : 0);
    const contract=(await this.info()).symbols.find((row:any)=>row.symbol===symbol),onboard=Number(contract?.onboardDate??0),listingAgeDays=onboard>0?Math.max(0,(Date.now()-onboard)/86_400_000):null;
    return{symbol,quote,orderBook,derivatives,technical,dataCompleteness:clamp(completeness,0,1),listingAgeDays};
  }
}

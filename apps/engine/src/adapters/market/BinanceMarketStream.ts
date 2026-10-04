import WebSocket from 'ws';
import { RecentTradePrices } from './recentTradePrices.js';
import type { Candle, OrderBook, Quote } from '@zdj/contracts';
import { BinanceTransport } from '../binance/BinanceTransport.js';

type StreamMetrics={state:'STOPPED'|'CONNECTING'|'LIVE'|'BACKOFF';connectedAt:number|null;lastMessageAt:number|null;lastTickerMessageAt:number|null;lastBookTickerMessageAt:number|null;lastPongAt:number|null;reconnects:number;gaps:number;gapsByType:{websocketConnection:number;quote:number;bookTicker:number;depthSequence:number;kline:number;eventTimestamp:number;subscription:number};backfills:number;subscriptions:number;cumulativeSubscriptions:number;recoverySuccess:number;recoveryFailure:number;lastError:string|null};
type QuotePatch=Partial<Pick<Quote,'last'|'mark'|'bid'|'ask'|'quoteVolumeUsd24h'|'priceChangePercent24h'|'tradeCount24h'|'ts'>>;
const fresh=(ts:number|undefined,maxAge:number)=>Boolean(ts&&Date.now()-ts<=maxAge);

/** One shared Binance USD-M socket. It never creates a socket per symbol. */
export class BinanceMarketStream {
  readonly tradedPrices=new RecentTradePrices();
  private socket:WebSocket|null=null; private stopped=true; private retry:NodeJS.Timeout|null=null; private heartbeat:NodeJS.Timeout|null=null; private attempt=0; private requestId=1;
  private controlQueue:Array<{method:'SUBSCRIBE'|'UNSUBSCRIBE';params:string[];id:number}>=[];private controlTimer:NodeJS.Timeout|null=null;private lastControlAt=0;
  private symbols=new Set<string>(); private subscribed=new Set<string>(); private quotes=new Map<string,QuotePatch>(); private books=new Map<string,OrderBook>(); private candles=new Map<string,Candle[]>(); private lastDepthUpdate=new Map<string,number>(); private backfillInFlight=new Set<string>(); private recoveryCooldown=new Map<string,number>(); private lastKlineClosed=new Map<string,number>(); private lastKlineGap:Record<string,unknown>|null=null;
  private readonly metricsValue:StreamMetrics={state:'STOPPED',connectedAt:null,lastMessageAt:null,lastTickerMessageAt:null,lastBookTickerMessageAt:null,lastPongAt:null,reconnects:0,gaps:0,gapsByType:{websocketConnection:0,quote:0,bookTicker:0,depthSequence:0,kline:0,eventTimestamp:0,subscription:0},backfills:0,subscriptions:0,cumulativeSubscriptions:0,recoverySuccess:0,recoveryFailure:0,lastError:null};
  constructor(private readonly transport:BinanceTransport,private readonly backfill:(symbol:string)=>Promise<{book:OrderBook;candles:Candle[]}>){}
  private retainSymbols(symbols:string[]){
    this.symbols=new Set(symbols.map(x=>x.toUpperCase()));
    this.tradedPrices.retain(this.symbols);
    for(const symbol of [...this.quotes.keys()])if(!this.symbols.has(symbol))this.quotes.delete(symbol);
    for(const symbol of [...this.books.keys()])if(!this.symbols.has(symbol))this.books.delete(symbol);
    for(const key of [...this.candles.keys()])if(!this.symbols.has(key.split(':')[0]!))this.candles.delete(key);
    for(const symbol of [...this.lastDepthUpdate.keys()])if(!this.symbols.has(symbol))this.lastDepthUpdate.delete(symbol);
    for(const symbol of [...this.recoveryCooldown.keys()])if(!this.symbols.has(symbol))this.recoveryCooldown.delete(symbol);
    for(const key of [...this.lastKlineClosed.keys()])if(!this.symbols.has(key.split(':')[0]!))this.lastKlineClosed.delete(key);
  }
  start(symbols:string[]){this.retainSymbols(symbols);if(!this.stopped){this.subscribeSymbols();return;}this.stopped=false;this.connect();}
  updateSymbols(symbols:string[]){this.retainSymbols(symbols);this.subscribeSymbols();}
  stop(){this.stopped=true;this.clearControls();if(this.retry)clearTimeout(this.retry);if(this.heartbeat)clearInterval(this.heartbeat);this.retry=this.heartbeat=null;this.socket?.close();this.socket=null;this.metricsValue.state='STOPPED';}
  metrics(){return{...this.metricsValue,gapsByType:{...this.metricsValue.gapsByType},lastKlineGap:this.lastKlineGap?{...this.lastKlineGap}:null};}
  quote(symbol:string,maxAgeMs=5_000){const q=this.quotes.get(symbol);return q&&fresh(q.ts,maxAgeMs)?q:undefined;}
  book(symbol:string,maxAgeMs=5_000){const b=this.books.get(symbol);return b&&fresh(b.ts,maxAgeMs)?b:undefined;}
  candleSeries(symbol:string,maxAgeMs=120_000,timeframe='1m'){const c=this.candles.get(timeframe==='1m'?symbol:`${symbol}:${timeframe}`);return c?.length&&fresh(c.at(-1)?.closeTime,maxAgeMs)?c:undefined;}
  seed(symbol:string,book:OrderBook,candles:Candle[]){this.books.set(symbol,book);this.seedCandles(symbol,'1m',candles);}
  seedCandles(symbol:string,timeframe:string,rows:Candle[]){
    const key=timeframe==='1m'?symbol:`${symbol}:${timeframe}`,merged=new Map(rows.map(c=>[c.openTime,c]));
    for(const c of this.candles.get(key)??[]){const other=merged.get(c.openTime);if(!other||(c.isClosed&&!other.isClosed)||(!(other.isClosed&&!c.isClosed)&&(c.receivedAt??0)>=(other.receivedAt??0)))merged.set(c.openTime,c);}
    this.candles.set(key,[...merged.values()].sort((a,b)=>a.openTime-b.openTime).slice(-300));
  }
  private connect(){if(this.stopped)return;this.metricsValue.state='CONNECTING';let socket:WebSocket;try{socket=new WebSocket(this.transport.effectiveWsUrl(),{...this.transport.websocketOptions(),handshakeTimeout:15_000});}catch(error){this.schedule(error);return;}this.socket=socket;
    socket.on('open',()=>{this.clearControls();this.subscribed.clear();this.lastDepthUpdate.clear();this.backfillInFlight.clear();const now=Date.now();this.metricsValue.state='LIVE';this.metricsValue.connectedAt=now;this.metricsValue.lastMessageAt=now;this.metricsValue.lastTickerMessageAt=now;this.metricsValue.lastBookTickerMessageAt=now;this.metricsValue.lastError=null;this.subscribeSymbols();this.heartbeat=setInterval(()=>{if(this.socket!==socket||socket.readyState!==WebSocket.OPEN)return;const alive=fresh(this.metricsValue.lastMessageAt??undefined,45_000)&&fresh(this.metricsValue.lastTickerMessageAt??undefined,45_000)&&fresh(this.metricsValue.lastBookTickerMessageAt??undefined,45_000);if(!alive){socket.terminate();return;}socket.ping();},15_000);});
    socket.on('pong',()=>{this.metricsValue.lastPongAt=Date.now();});socket.on('message',raw=>this.onMessage(String(raw)));
    socket.on('error',error=>{this.metricsValue.lastError=error.message;});socket.on('close',(code,reason)=>{this.clearControls();if(reason.length)this.metricsValue.lastError=`WS_CLOSE_${code}: ${String(reason)}`;if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;if(this.socket===socket)this.socket=null;if(!this.stopped)this.schedule(new Error(this.metricsValue.lastError??'socket closed'));});
  }
  private schedule(error:unknown){if(this.stopped)return;this.metricsValue.state='BACKOFF';this.metricsValue.lastError=error instanceof Error?error.message:String(error);this.metricsValue.reconnects++;this.metricsValue.gapsByType.websocketConnection++;const delay=Math.min(30_000,500*2**Math.min(this.attempt++,6))+Math.floor(Math.random()*250);this.retry=setTimeout(()=>this.connect(),delay);}
  private subscribeSymbols(){if(this.socket?.readyState!==WebSocket.OPEN)return;const desired=new Set(['!ticker@arr','!markPrice@arr@1s','!bookTicker',...[...this.symbols].flatMap(s=>[`${s.toLowerCase()}@depth20@500ms`,`${s.toLowerCase()}@kline_1m`,`${s.toLowerCase()}@kline_5m`,`${s.toLowerCase()}@kline_15m`,`${s.toLowerCase()}@aggTrade`])]);const remove=[...this.subscribed].filter(x=>!desired.has(x)),add=[...desired].filter(x=>!this.subscribed.has(x));for(const [method,items] of [['UNSUBSCRIBE',remove],['SUBSCRIBE',add]] as const)for(let i=0;i<items.length;i+=100)this.controlQueue.push({method,params:items.slice(i,i+100),id:this.requestId++});this.subscribed=desired;this.metricsValue.subscriptions=desired.size;this.metricsValue.cumulativeSubscriptions+=add.length;this.pumpControls();}
  private clearControls(){if(this.controlTimer)clearTimeout(this.controlTimer);this.controlTimer=null;this.controlQueue=[];}
  private pumpControls(){
    if(this.controlTimer||!this.controlQueue.length||this.socket?.readyState!==WebSocket.OPEN)return;
    this.controlTimer=setTimeout(()=>{this.controlTimer=null;if(this.socket?.readyState!==WebSocket.OPEN)return;const command=this.controlQueue.shift();if(command){this.socket.send(JSON.stringify(command));this.lastControlAt=Date.now();}this.pumpControls();},Math.max(0,350-(Date.now()-this.lastControlAt)));
  }
  private onMessage(raw:string){this.metricsValue.lastMessageAt=Date.now();let value:any;try{value=JSON.parse(raw);}catch{return;}const data=value.data??value;if(Array.isArray(data)){for(const row of data)this.onEvent(row);return;}this.onEvent(data);}
  private onEvent(d:any){if(!d||typeof d!=='object')return;if(d.e&&Date.now()-(this.metricsValue.connectedAt??Date.now())>15000)this.attempt=0;if(d.error){this.metricsValue.lastError=JSON.stringify(d.error);return;}if(d.e==='aggTrade'){const s=String(d.s);if(this.symbols.has(s))this.tradedPrices.record(s,Number(d.p),Number(d.T));}
    else if(d.e==='24hrTicker'||(d.s&&d.c!=null&&d.q!=null)){this.metricsValue.lastTickerMessageAt=Date.now();const s=String(d.s);if(!this.symbols.has(s))return;this.mergeQuote(s,{last:Number(d.c),quoteVolumeUsd24h:Number(d.q),priceChangePercent24h:Number(d.P),tradeCount24h:Number(d.n),ts:Number(d.E)||Date.now()});}
    else if(d.e==='markPriceUpdate'||(d.s&&d.p!=null&&d.i!=null)){const s=String(d.s);if(this.symbols.has(s))this.mergeQuote(s,{mark:Number(d.p),ts:Number(d.E)||Date.now()});}
    else if(d.e==='bookTicker'||(d.s&&d.b!=null&&d.a!=null&&!d.e)){this.metricsValue.lastBookTickerMessageAt=Date.now();const s=String(d.s);if(this.symbols.has(s))this.mergeQuote(s,{bid:Number(d.b),ask:Number(d.a),ts:Number(d.E)||Date.now()});}
    else if(d.e==='depthUpdate'||(d.bids&&d.asks)){const s=String(d.s);if(!this.symbols.has(s)||this.backfillInFlight.has(s))return;const previous=this.lastDepthUpdate.get(s),first=Number(d.U??d.firstUpdateId??0),last=Number(d.u??d.lastUpdateId??0),pu=Number(d.pu??0);if(previous&&last<=previous)return;const contiguous=!previous||pu===previous||(first>0&&first<=previous+1&&last>=previous+1);if(!contiguous){if((this.recoveryCooldown.get(s)??0)<=Date.now()){this.metricsValue.gaps++;this.metricsValue.gapsByType.depthSequence++;this.lastDepthUpdate.delete(s);void this.recover(s);}return;}this.lastDepthUpdate.set(s,last);this.books.set(s,{symbol:s,bids:(d.b??d.bids).map((x:any)=>[Number(x[0]),Number(x[1])]),asks:(d.a??d.asks).map((x:any)=>[Number(x[0]),Number(x[1])]),ts:Number(d.E)||Date.now()});}
    else if(d.e==='kline'){const s=String(d.s);if(!this.symbols.has(s))return;const k=d.k,tf=String(k.i??'1m');if(!['1m','5m','15m'].includes(tf))return;const key=tf==='1m'?s:`${s}:${tf}`,receivedAt=Number(d.E)||Date.now();const candle:Candle={openTime:Number(k.t),closeTime:Number(k.T),receivedAt,isClosed:Boolean(k.x),source:'BINANCE_WS',open:Number(k.o),high:Number(k.h),low:Number(k.l),close:Number(k.c),volume:Number(k.v),quoteVolume:Number(k.q),trades:Number(k.n)};const rows=this.candles.get(key)??[];const at=rows.findIndex(x=>x.openTime===candle.openTime);if(at>=0){const prior=rows[at]!;if(prior.isClosed&&!candle.isClosed||(prior.receivedAt??0)>receivedAt)return;rows[at]=candle;}else rows.push(candle);this.candles.set(key,rows.sort((a,b)=>a.openTime-b.openTime).slice(-300));
      // A dropped socket leaves a hole that "latest bar is current" cannot reveal, so the
      // closed-bar boundary is checked here as well and reported to the targeted repair loop.
      if(candle.isClosed){const period=tf==='1m'?60_000:tf==='5m'?300_000:900_000,previous=this.lastKlineClosed.get(key);
        if(previous!==undefined&&candle.openTime>previous+period){this.metricsValue.gaps++;this.metricsValue.gapsByType.kline++;
          this.lastKlineGap={symbol:s,timeframe:tf,expectedOpenTime:previous+period,actualOpenTime:candle.openTime,missingBars:Math.round((candle.openTime-previous)/period)-1,at:receivedAt};}
        if(previous===undefined||candle.openTime>previous)this.lastKlineClosed.set(key,candle.openTime);}
    }
  }
  private mergeQuote(symbol:string,patch:QuotePatch){this.quotes.set(symbol,{...this.quotes.get(symbol),...patch});}
  private async recover(symbol:string){const now=Date.now();if(this.backfillInFlight.has(symbol)||(this.recoveryCooldown.get(symbol)??0)>now)return;this.recoveryCooldown.set(symbol,now+60_000);this.backfillInFlight.add(symbol);try{const value=await this.backfill(symbol);if(!this.symbols.has(symbol))return;this.books.set(symbol,value.book);this.seedCandles(symbol,'1m',value.candles);this.lastDepthUpdate.delete(symbol);this.metricsValue.backfills++;this.metricsValue.recoverySuccess++;}catch(error){this.metricsValue.recoveryFailure++;this.metricsValue.lastError=error instanceof Error?error.message:String(error);}finally{this.backfillInFlight.delete(symbol);}}
}

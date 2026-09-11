import type { Candle, DerivativesSnapshot, MarketSymbolSnapshot, OrderBook, Quote, TechnicalCard, Timeframe } from '@zdj/contracts';
import { buildTechnicalCard, clamp } from '@zdj/core';
import type { MarketDataProvider } from '../../types.js';

const BASES = ['BTC','ETH','BNB','SOL','XRP','DOGE','ADA','AVAX','LINK','SUI','TRX','TON','DOT','LTC','BCH','UNI','NEAR','APT','ARB','OP','ATOM','FIL','ETC','AAVE','INJ','TIA','SEI','WIF','PEPE','SHIB','FET','RENDER','RUNE','MKR','LDO','ICP','GRT','ALGO','XLM','VET','HBAR','IMX','STX','JUP','PYTH','ENA','PENDLE','ONDO','TAO','WLD','MNT','KAS','FLOW','EGLD','SAND','MANA','AXS','GALA','DYDX','SNX','CRV','COMP','ZEC','DASH','KAVA','IOTA','THETA','NEO','QTUM','ZIL','BAT','CHZ','ENS','GMX','BLUR','ORDI','1000SATS','MEME','BONK','FLOKI','JTO','STRK','ZRO','AEVO','NOT','IO','LISTA','ZK','TURBO','POPCAT','MEW','BOME','BRETT','GOAT','PNUT','ACT','MOVE','VIRTUAL','HYPE'];
const TIMEFRAME_MS:Record<Timeframe,number>={'1m':60_000,'5m':300_000,'15m':900_000,'1h':3600_000,'4h':14_400_000,'1d':86_400_000,'1w':604_800_000};
function seed(symbol:string){let h=2166136261;for(const c of symbol)h=Math.imul(h^c.charCodeAt(0),16777619);return Math.abs(h>>>0);}
function unit(seedValue:number,index:number){const x=Math.sin(seedValue*0.0001+index*12.9898)*43758.5453;return x-Math.floor(x);}
function basePrice(symbol:string){const b=symbol.replace('USDT',''); if(b==='BTC')return 116000;if(b==='ETH')return 4800;if(b==='BNB')return 850;if(b==='SOL')return 195;if(b==='XRP')return 2.9;if(b==='DOGE')return .22;if(['PEPE','SHIB','BONK','FLOKI'].includes(b))return .00002;return Math.max(.02,(seed(symbol)%90000)/1000);}

export class MockMarketDataProvider implements MarketDataProvider {
  private symbols:string[]; private prices=new Map<string,number>(); private phase=0;
  constructor(count=120){
    this.symbols=[...BASES.map(x=>`${x}USDT`)]; while(this.symbols.length<count)this.symbols.push(`COIN${String(this.symbols.length+1).padStart(3,'0')}USDT`); this.symbols=this.symbols.slice(0,count);
    for(const s of this.symbols)this.prices.set(s,basePrice(s));
  }
  async tick(){this.phase++;for(const s of this.symbols){const p=this.prices.get(s)!;const ss=seed(s);const drift=Math.sin((this.phase+ss%37)/17)*0.0009;const noise=(unit(ss,this.phase)-.5)*0.0014;this.prices.set(s,Math.max(p*0.1,p*(1+drift+noise)));}}
  async listSymbols(limit:number){return this.symbols.slice(0,limit);}
  async getQuote(symbol:string):Promise<Quote>{
    const last=this.prices.get(symbol)??basePrice(symbol), ss=seed(symbol); const spreadBps=1.5+(ss%45)/10; const half=last*spreadBps/20000; const tick=last>=1000?.1:last>=100?.01:last>=1?.001:last>=.1?.0001:last>=.01?.00001:.0000001;
    const qv=25_000_000 + (ss%1000)*3_500_000; return {symbol,last,mark:last*(1+(unit(ss,this.phase+8)-.5)*.00015),bid:last-half,ask:last+half,tickSize:tick,stepSize:last>1000?.0001:last>100?.001:last>1?.01:.1,minQty:last>1000?.0001:last>100?.001:last>1?.01:.1,minNotional:5,quoteVolumeUsd24h:qv,priceChangePercent24h:(unit(ss,this.phase+20)-.5)*14,tradeCount24h:10_000+(ss%900_000),ts:Date.now()};
  }
  async getCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>{
    const now=Date.now(), ms=TIMEFRAME_MS[timeframe] ?? 60_000, current=this.prices.get(symbol)??basePrice(symbol), ss=seed(symbol)+timeframe.length*97; const volatility=timeframe==='1m'?.0015:timeframe==='5m'?.003:timeframe==='15m'?.006:timeframe==='4h'?.02:timeframe==='1d'?.035:.08; const trendBias=((ss%11)-5)*0.00008;
    const out:Candle[]=[]; let price=current*(1-(trendBias*limit)*0.5);
    for(let j=0;j<limit;j++){const idx=this.phase-limit+j; const ret=(unit(ss,idx)-.5)*volatility+trendBias+Math.sin((idx+ss%19)/15)*volatility*.12; const open=price; const close=open*(1+ret); const high=Math.max(open,close)*(1+unit(ss+1,idx)*volatility*.35); const low=Math.min(open,close)*(1-unit(ss+2,idx)*volatility*.35); const closeTime=now-(limit-1-j)*ms; out.push({openTime:closeTime-ms,closeTime,receivedAt:now,isClosed:true,source:'MOCK',open,high,low,close,volume:1000+(ss%9000)*(0.6+unit(ss+3,idx)),quoteVolume:(1000+(ss%9000))*close,trades:100+(ss%4000)}); price=close;}
    const scale=current/(out.at(-1)?.close??current); return out.map(c=>({...c,open:c.open*scale,high:c.high*scale,low:c.low*scale,close:c.close*scale,quoteVolume:c.quoteVolume*scale}));
  }
  async getOrderBook(symbol:string):Promise<OrderBook>{const q=await this.getQuote(symbol);const levels=8;const bids:[number,number][]=[],asks:[number,number][]=[];for(let i=0;i<levels;i++){bids.push([q.bid-i*q.tickSize,20+i*7]);asks.push([q.ask+i*q.tickSize,18+i*6]);}return{symbol,bids,asks,ts:Date.now()};}
  async getDerivatives(symbol:string):Promise<DerivativesSnapshot>{const ss=seed(symbol);return{symbol,openInterest:1_000_000+(ss%90_000_000),openInterestChange5m:(unit(ss,this.phase+2)-.5)*.035,openInterestChange15m:(unit(ss,this.phase+3)-.5)*.075,fundingRate:(unit(ss,this.phase+4)-.5)*.0005,takerBuySellRatio5m:.7+unit(ss,this.phase+5)*.65,globalLongShortRatio:.7+unit(ss,this.phase+6)*.8,topTraderPositionRatio:.7+unit(ss,this.phase+7)*.8,ts:Date.now()};}
  async getSnapshot(symbol:string):Promise<MarketSymbolSnapshot>{
    const quote=await this.getQuote(symbol), orderBook=await this.getOrderBook(symbol), derivatives=await this.getDerivatives(symbol); const technical={} as Record<Timeframe,TechnicalCard>;
    for(const tf of ['1m','5m','15m','1h','4h','1d','1w'] as Timeframe[]) technical[tf]=buildTechnicalCard(tf,await this.getCandles(symbol,tf,tf==='15m'?240:80));
    const missing=[derivatives.openInterest,derivatives.takerBuySellRatio5m].filter(x=>x==null).length; return{symbol,quote,orderBook,derivatives,technical,dataCompleteness:clamp(1-missing*.08,0,1)};
  }
}

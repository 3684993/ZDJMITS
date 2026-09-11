import { describe,expect,it,vi } from 'vitest';
import { BinanceMarketStream } from './BinanceMarketStream.js';

const book=(ts=Date.now())=>({symbol:'BTCUSDT',bids:[[100,1] as [number,number]],asks:[[101,1] as [number,number]],ts});
const candle={openTime:1,closeTime:Date.now(),open:100,high:101,low:99,close:100,volume:1,quoteVolume:100,trades:1};

describe('BinanceMarketStream cache and gap recovery',()=>{
  it('merges shared ticker, mark and book events into one quote',()=>{
    const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
    (stream as any).onEvent({e:'24hrTicker',s:'BTCUSDT',c:'100',q:'5000',P:'2',n:10,E:Date.now()});
    (stream as any).onEvent({e:'markPriceUpdate',s:'BTCUSDT',p:'100.2',E:Date.now()});
    (stream as any).onEvent({e:'bookTicker',s:'BTCUSDT',b:'99.9',a:'100.1',E:Date.now()});
    expect(stream.quote('BTCUSDT')).toMatchObject({last:100,mark:100.2,bid:99.9,ask:100.1,tradeCount24h:10});
  });
  it('detects a sequence gap and performs one centralized REST backfill',async()=>{
    const backfill=vi.fn(async()=>({book:book(),candles:[candle]}));const stream=new BinanceMarketStream({} as never,backfill);(stream as any).symbols=new Set(['BTCUSDT']);
    (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',u:10,pu:0,b:[[100,1]],a:[[101,1]],E:Date.now()});
    (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',u:12,pu:9,b:[[100,1]],a:[[101,1]],E:Date.now()});
    await vi.waitFor(()=>expect(backfill).toHaveBeenCalledTimes(1));
    expect(stream.metrics()).toMatchObject({gaps:1,backfills:1});expect(stream.book('BTCUSDT')).toBeDefined();
  });
  it('deduplicates all events that arrive while one depth recovery is in flight',async()=>{
    let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const backfill=vi.fn(async()=>{await pending;return{book:book(),candles:[candle]}});const stream=new BinanceMarketStream({} as never,backfill);(stream as any).symbols=new Set(['BTCUSDT']);
    (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',U:1,u:10,pu:0,b:[[100,1]],a:[[101,1]],E:Date.now()});
    for(let i=0;i<50;i++)(stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',U:20+i,u:20+i,pu:9,b:[[100,1]],a:[[101,1]],E:Date.now()});
    expect(stream.metrics()).toMatchObject({gaps:1,gapsByType:{depthSequence:1}});expect(backfill).toHaveBeenCalledOnce();release();await vi.waitFor(()=>expect(stream.metrics().backfills).toBe(1));
  });
});


it('paces more than 500 stream subscriptions below the observed five-message limit',async()=>{
 vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),sent:number[]=[];
 try{(stream as any).socket={readyState:1,send:()=>sent.push(Date.now()),close:vi.fn()};(stream as any).symbols=new Set(Array.from({length:175},(_,i)=>`S${i}USDT`));(stream as any).subscribeSymbols();await vi.advanceTimersByTimeAsync(4000);expect(sent).toHaveLength(9);expect(stream.metrics().subscriptions).toBeLessThan(1024);for(const at of sent)expect(sent.filter(t=>t>=at&&t<at+1000).length).toBeLessThanOrEqual(3);}finally{stream.stop();vi.useRealTimers();}
});

it('isolates closed 5m/15m bars and rejects a late open-bar downgrade',()=>{
 const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
 const now=Date.now(),event=(i:string,x:boolean,E=now)=>({e:'kline',s:'BTCUSDT',E,k:{i,t:now-900000,T:now-1,x,o:'100',h:'102',l:'99',c:'101',v:'3',q:'303',n:2}});
 (stream as any).onEvent(event('5m',true));(stream as any).onEvent(event('15m',true));(stream as any).onEvent(event('5m',false,now+1));
 expect(stream.candleSeries('BTCUSDT')).toBeUndefined();expect(stream.candleSeries('BTCUSDT',1800000,'5m')?.[0]?.isClosed).toBe(true);expect(stream.candleSeries('BTCUSDT',1800000,'15m')).toHaveLength(1);
 stream.seedCandles('BTCUSDT','15m',[{...candle,openTime:now-900000,closeTime:now-1,isClosed:false,receivedAt:now-10}]);expect(stream.candleSeries('BTCUSDT',1800000,'15m')?.[0]?.isClosed).toBe(true);
});

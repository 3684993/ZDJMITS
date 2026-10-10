import { describe,expect,it,vi } from 'vitest';
import { BinanceMarketStream } from './BinanceMarketStream.js';

const book=(ts=Date.now())=>({symbol:'BTCUSDT',bids:[[100,1] as [number,number]],asks:[[101,1] as [number,number]],ts});
const candle={openTime:1,closeTime:Date.now(),open:100,high:101,low:99,close:100,volume:1,quoteVolume:100,trades:1};

describe('BinanceMarketStream cache and gap recovery',()=>{
  it('treats Binance live-subscription {code,msg} errors as a real stream failure',()=>{
    const stream=new BinanceMarketStream({} as never,vi.fn()),terminate=vi.fn(),close=vi.fn();
    (stream as any).lanes.MARKET.socket={readyState:1,terminate,close};(stream as any).stopped=false;
    (stream as any).onMessage(JSON.stringify({code:2,msg:'Invalid request: too many parameters'}),'MARKET');
    expect(terminate).toHaveBeenCalledOnce();
    expect(stream.metrics()).toMatchObject({gaps:1,gapsByType:{subscription:1},lastError:expect.stringContaining('WS_CONTROL_ERROR')});
    stream.stop();
  });
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
  it('drops caches on retention release and ignores a late backfill from the old ownership set',async()=>{
    let release!:(value:{book:any;candles:any[]})=>void;const pending=new Promise<{book:any;candles:any[]}>(resolve=>{release=resolve;});
    const stream=new BinanceMarketStream({} as never,vi.fn(()=>pending));
    stream.updateSymbols(['BTCUSDT']);
    const now=Date.now();
    (stream as any).onEvent({e:'24hrTicker',s:'BTCUSDT',c:'100',q:'5000',P:'2',n:10,E:now});
    (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',U:1,u:10,pu:0,b:[[100,1]],a:[[101,1]],E:now});
    (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',U:20,u:20,pu:9,b:[[100,1]],a:[[101,1]],E:now});
    await Promise.resolve();
    stream.updateSymbols([]);
    expect(stream.quote('BTCUSDT')).toBeUndefined();
    expect(stream.book('BTCUSDT')).toBeUndefined();
    release({book:book(),candles:[candle]});
    await vi.waitFor(()=>expect((stream as any).backfillInFlight.size).toBe(0));
    expect(stream.book('BTCUSDT')).toBeUndefined();
    expect(stream.candleSeries('BTCUSDT',60_000)).toBeUndefined();
    expect(stream.metrics().backfills).toBe(0);
  });
});

it('paces split public/market subscriptions independently below the per-connection message limit',async()=>{
 vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),sent={PUBLIC:[] as number[],MARKET:[] as number[]};
 try{for(const laneName of ['PUBLIC','MARKET'] as const)(stream as any).lanes[laneName].socket={readyState:1,send:()=>sent[laneName].push(Date.now()),close:vi.fn()};(stream as any).symbols=new Set(Array.from({length:175},(_,i)=>`S${i}USDT`));(stream as any).subscribeSymbols();await vi.advanceTimersByTimeAsync(4000);expect(sent.PUBLIC).toHaveLength(2);expect(sent.MARKET).toHaveLength(9);expect(stream.metrics().lanes.PUBLIC.subscriptions).toBeLessThanOrEqual(1024);expect(stream.metrics().lanes.MARKET.subscriptions).toBeLessThanOrEqual(1024);for(const rows of [sent.PUBLIC,sent.MARKET])for(const at of rows)expect(rows.filter(t=>t>=at&&t<at+1000).length).toBeLessThanOrEqual(3);}finally{stream.stop();vi.useRealTimers();}
});

it('isolates closed 5m/15m bars and rejects a late open-bar downgrade',()=>{
 const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
 const now=Date.now(),event=(i:string,x:boolean,E=now)=>({e:'kline',s:'BTCUSDT',E,k:{i,t:now-900000,T:now-1,x,o:'100',h:'102',l:'99',c:'101',v:'3',q:'303',n:2}});
 (stream as any).onEvent(event('5m',true));(stream as any).onEvent(event('15m',true));(stream as any).onEvent(event('5m',false,now+1));
 expect(stream.candleSeries('BTCUSDT')).toBeUndefined();expect(stream.candleSeries('BTCUSDT',1800000,'5m')?.[0]?.isClosed).toBe(true);expect(stream.candleSeries('BTCUSDT',1800000,'15m')).toHaveLength(1);
 stream.seedCandles('BTCUSDT','15m',[{...candle,openTime:now-900000,closeTime:now-1,isClosed:false,receivedAt:now-10}]);expect(stream.candleSeries('BTCUSDT',1800000,'15m')?.[0]?.isClosed).toBe(true);
});
describe('V3.9.5 closed-kline continuity accounting',()=>{
  const kline=(s:string,tf:string,openTime:number,closed:boolean,eventTime:number)=>({e:'kline',s,k:{i:tf,t:openTime,T:openTime+(tf==='1m'?60_000:300_000)-1,x:closed,o:'1',h:'2',l:'1',c:'1.5',v:'10',q:'100',n:5,E:eventTime}});
  it('counts a skipped closed minute as a kline gap and records the expected boundary',()=>{
    const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
    const base=Date.now()-600_000;
    (stream as any).onEvent(kline('BTCUSDT','1m',base,true,base+60_000));
    (stream as any).onEvent(kline('BTCUSDT','1m',base+120_000,true,base+180_000));
    const metrics=stream.metrics() as any;
    expect(metrics.gapsByType.kline).toBe(1);
    expect(metrics.gaps).toBe(1);
    expect(metrics.lastKlineGap).toMatchObject({symbol:'BTCUSDT',timeframe:'1m',expectedOpenTime:base+60_000,actualOpenTime:base+120_000,missingBars:1});
  });
  it('does not report a gap for an uninterrupted series or for a still-open bar',()=>{
    const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
    const base=Date.now()-600_000;
    for(const offset of [0,60_000,120_000])(stream as any).onEvent(kline('BTCUSDT','1m',base+offset,true,base+offset+60_000));
    (stream as any).onEvent(kline('BTCUSDT','1m',base+180_000,false,base+200_000));
    const metrics=stream.metrics() as any;
    expect(metrics.gapsByType.kline).toBe(0);
    expect(metrics.lastKlineGap).toBeNull();
  });
  it('counts a 5m hole against the 5m period',()=>{
    const stream=new BinanceMarketStream({} as never,vi.fn());(stream as any).symbols=new Set(['BTCUSDT']);
    const base=Date.now()-3_600_000;
    (stream as any).onEvent(kline('BTCUSDT','5m',base,true,base+300_000));
    (stream as any).onEvent(kline('BTCUSDT','5m',base+600_000,true,base+900_000));
    expect((stream.metrics() as any).lastKlineGap).toMatchObject({timeframe:'5m',expectedOpenTime:base+300_000,missingBars:1});
  });
});


it('keeps ticker/mark freshness independent from current book events and rejects older/future repairs',()=>{
 vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
 try{
  const stream=new BinanceMarketStream({} as never,vi.fn()),now=Date.now();stream.updateSymbols(['BTCUSDT']);
  stream.seedQuote('BTCUSDT',{last:100,mark:101,bid:99,ask:102,ts:now-60_000});
  (stream as any).onEvent({e:'bookTicker',s:'BTCUSDT',b:'104',a:'105',E:now});
  expect(stream.quote('BTCUSDT')).toBeUndefined();expect(stream.quoteFields('BTCUSDT')).toMatchObject({bid:104,ask:105});
  expect(stream.quoteFields('BTCUSDT').mark).toBeUndefined();
  stream.seedQuote('BTCUSDT',{last:103,mark:104,ts:now-100});
  stream.seedQuote('BTCUSDT',{bid:1,ask:2,ts:now-200});
  stream.seedQuote('BTCUSDT',{last:999,mark:999,ts:now+60_000});
  expect(stream.quote('BTCUSDT')).toMatchObject({last:103,mark:104,bid:104,ask:105,ts:now-100});
  stream.seed('BTCUSDT',book(now),[]);stream.seed('BTCUSDT',{...book(now-100),bids:[[1,1]]},[]);
  expect(stream.book('BTCUSDT')!.bids[0]![0]).toBe(100);
 }finally{vi.useRealTimers();}
});


it('does not replace a current depth book with an older WS event or a future REST seed',()=>{
 const stream=new BinanceMarketStream({} as never,vi.fn()),now=Date.now();stream.updateSymbols(['BTCUSDT']);stream.seed('BTCUSDT',book(now),[]);
 (stream as any).onEvent({e:'depthUpdate',s:'BTCUSDT',u:12,pu:0,b:[[1,1]],a:[[2,1]],E:now-100});
 stream.seed('BTCUSDT',{...book(now+60_000),bids:[[999,1]]},[]);
 expect(stream.book('BTCUSDT')!.bids[0]![0]).toBe(100);
});

it('accounts for rejected-symbol decoded WS payload per lane without persisting raw data',()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const stream=new BinanceMarketStream({} as never,vi.fn());
    stream.updateSymbols(['BTCUSDT']);
    const publicPayload=JSON.stringify({e:'bookTicker',s:'OTHERUSDT',b:'1',a:'2',E:Date.now()}),
      marketPayload=JSON.stringify({e:'24hrTicker',s:'OTHERUSDT',c:'1',q:'100',P:'0',n:1,E:Date.now()});
    (stream as any).onMessage(publicPayload,'PUBLIC');
    (stream as any).onMessage(marketPayload,'MARKET');
    const traffic=(stream.metrics() as any).streamTraffic;
    expect(traffic.PUBLIC).toMatchObject({last60sMessages:1,totalMessages:1,last60sDecodedBytes:Buffer.byteLength(publicPayload)});
    expect(traffic.MARKET).toMatchObject({last60sMessages:1,totalMessages:1,last60sDecodedBytes:Buffer.byteLength(marketPayload)});
    expect(traffic.PUBLIC.measurement).toBe('DECODED_WS_APPLICATION_PAYLOAD_NOT_SSH_WIRE_BYTES');
    expect(stream.quote('OTHERUSDT')).toBeUndefined();
    expect(JSON.stringify(traffic)).not.toContain('OTHERUSDT');
    vi.advanceTimersByTime(61_000);
    const aged=(stream.metrics() as any).streamTraffic;
    expect(aged.PUBLIC.last60sMessages).toBe(0);
    expect(aged.MARKET.last60sDecodedBytes).toBe(0);
    expect(aged.PUBLIC.totalMessages).toBe(1);
  }finally{vi.useRealTimers();}
});

it('keeps retained 50s event across the former 10-second bucket boundary and counts each type',()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_009_900);
  try{
    const stream=new BinanceMarketStream({} as never,vi.fn());
    stream.updateSymbols(['BTCUSDT']);
    const book=JSON.stringify({e:'bookTicker',s:'OTHERUSDT',b:'1',a:'2',E:Date.now()});
    const ticker=JSON.stringify([{e:'24hrTicker',s:'OTHERUSDT',c:'1',q:'5',P:'0',n:1,E:Date.now()}]);
    (stream as any).onMessage(book,'PUBLIC');
    (stream as any).onMessage(ticker,'MARKET');
    vi.advanceTimersByTime(50_200);
    let traffic=(stream.metrics() as any).streamTraffic;
    expect(traffic.PUBLIC.last60sByType.BOOK_TICKER).toEqual({messages:1,decodedBytes:Buffer.byteLength(book)});
    expect(traffic.MARKET.last60sByType.TICKER_24H).toEqual({messages:1,decodedBytes:Buffer.byteLength(ticker)});
    expect(traffic.PUBLIC.windowResolutionMs).toBe(1000);
    vi.advanceTimersByTime(10_000);
    traffic=(stream.metrics() as any).streamTraffic;
    expect(traffic.PUBLIC.last60sMessages).toBe(0);
    expect(traffic.MARKET.last60sMessages).toBe(0);
    expect(traffic.PUBLIC.totalByType.BOOK_TICKER.messages).toBe(1);
    expect(JSON.stringify(traffic)).not.toContain('OTHERUSDT');
  }finally{vi.useRealTimers();}
});

it('bounds buckets for long-running diverse traffic and counts malformed frames safely',()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try{
    const stream=new BinanceMarketStream({} as never,vi.fn());
    for(let i=0;i<70;i++){(stream as any).onMessage('not-json','PUBLIC');vi.advanceTimersByTime(1000);}
    const traffic=(stream.metrics() as any).streamTraffic.PUBLIC;
    expect((stream as any).streamTraffic.PUBLIC.buckets.length).toBeLessThanOrEqual(60);
    expect(traffic.totalMessages).toBe(70);
    expect(traffic.last60sMessages).toBeLessThanOrEqual(60);
    expect(traffic.totalByType.INVALID_JSON.messages).toBe(70);
    expect(JSON.stringify(traffic)).not.toContain('not-json');
  }finally{vi.useRealTimers();}
});

it('treats a null JSON WS frame as control/other telemetry without throwing',()=>{
  const stream=new BinanceMarketStream({} as never,vi.fn());
  expect(()=>(stream as any).onMessage('null','PUBLIC')).not.toThrow();
  expect((stream.metrics() as any).streamTraffic.PUBLIC).toMatchObject({
    totalMessages:1,totalByType:{CONTROL_OR_OTHER:{messages:1,decodedBytes:4}}
  });
});

it('reconciles every event class to lane totals at one snapshot time, including rejected symbols',()=>{
  vi.useFakeTimers();vi.setSystemTime(1_800_000_000_000);
  try {
    const stream=new BinanceMarketStream({} as never,vi.fn());
    stream.updateSymbols(['BTCUSDT']);
    const frames=[{e:'bookTicker'},{e:'24hrTicker'},{e:'markPriceUpdate'},{e:'depthUpdate'},
      {e:'kline'},{e:'aggTrade'},{result:null,id:1},[{e:'bookTicker'},{e:'24hrTicker'}]];
    for(const lane of ['PUBLIC','MARKET'] as const){
      for(const frame of frames)(stream as any).onMessage(JSON.stringify(Array.isArray(frame)?frame:{...frame,s:'REJECTEDUSDT'}),lane);
      (stream as any).onMessage('invalid-json',lane);
    }
    const metrics=stream.metrics(),traffic=metrics.streamTraffic as any;
    for(const lane of ['PUBLIC','MARKET']){
      const value=traffic[lane],counts=Object.values(value.last60sByType) as any[];
      expect(Object.keys(value.last60sByType).sort()).toEqual(['BOOK_TICKER','TICKER_24H','MARK_PRICE','DEPTH','KLINE','AGG_TRADE','CONTROL_OR_OTHER','MIXED_OR_OTHER','INVALID_JSON'].sort());
      expect(counts.reduce((sum,row)=>sum+row.messages,0)).toBe(value.last60sMessages);
      expect(counts.reduce((sum,row)=>sum+row.decodedBytes,0)).toBe(value.last60sDecodedBytes);
      expect(value.last60sByType).toEqual(value.totalByType);
      expect(value.windowAsOf).toBe(metrics.quoteFactFreshness.evaluatedAt);
    }
    expect(JSON.stringify(traffic)).not.toContain('REJECTEDUSDT');
  } finally {vi.useRealTimers();}
});

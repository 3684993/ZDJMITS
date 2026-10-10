import { describe,expect,it,vi } from 'vitest';
import { BinanceMarketStream } from './BinanceMarketStream.js';
import { WebSocketServer } from 'ws';

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

it('paces acknowledged split subscriptions independently below the per-connection message limit',async()=>{
 vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),sent:Record<string,number[]>={};
 try{stream.updateSymbols(Array.from({length:175},(_,i)=>`S${i}USDT`));for(const laneName of Object.keys((stream as any).lanes)){sent[laneName]=[];(stream as any).lanes[laneName].socket={readyState:1,send:(raw:string)=>{sent[laneName]!.push(Date.now());const command=JSON.parse(raw);(stream as any).onMessage(JSON.stringify({id:command.id,result:null}),laneName);},close:vi.fn()};}(stream as any).subscribeSymbols();await vi.advanceTimersByTimeAsync(4000);expect(sent.PUBLIC).toHaveLength(4);expect(sent.MARKET).toHaveLength(10);expect(sent.MARKET_1).toHaveLength(1);for(const lane of Object.values((stream as any).lanes) as any[])expect(lane.confirmed.size).toBeLessThanOrEqual(1024);for(const rows of Object.values(sent))for(const at of rows)expect(rows.filter(t=>t>=at&&t<at+1000).length).toBeLessThanOrEqual(3);}finally{stream.stop();vi.useRealTimers();}
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

describe('retained-only USD-M market streams under SSH congestion',()=>{
 it('replaces both global MARKET arrays with per-symbol facts for normal retained cohorts',()=>{
   const stream=new BinanceMarketStream({} as never,vi.fn());
   stream.updateSymbols(['BTCUSDT','ETHUSDC']);
   const desired=(stream as any).desired('MARKET') as Set<string>;
   expect([...desired].sort()).toEqual([
     'btcusdt@ticker','btcusdt@markPrice@1s','btcusdt@kline_1m','btcusdt@kline_5m','btcusdt@kline_15m','btcusdt@aggTrade',
     'ethusdc@ticker','ethusdc@markPrice@1s','ethusdc@kline_1m','ethusdc@kline_5m','ethusdc@kline_15m','ethusdc@aggTrade'
   ].sort());
   expect(desired.has('!ticker@arr')).toBe(false);
   expect(desired.has('!markPrice@arr@1s')).toBe(false);
   stream.updateSymbols(['ETHUSDC']);
   const shrunk=(stream as any).desired('MARKET') as Set<string>;
   expect(shrunk.size).toBe(6);
   expect([...shrunk].every(value=>value.startsWith('ethusdc@'))).toBe(true);
   stream.stop();
 });
 it.each([160,161,191,192,239,255,256,1024])('covers all %i retained symbols across bounded connections',count=>{
   const stream=new BinanceMarketStream({} as never,vi.fn());stream.updateSymbols(Array.from({length:count},(_,i)=>`S${i}USDT`));
   const market:string[]=[],publicStreams:string[]=[];
   for(const name of Object.keys((stream as any).lanes)){const desired=(stream as any).desired(name) as Set<string>;expect(desired.size).toBeLessThanOrEqual(1024);(name.startsWith('MARKET')?market:publicStreams).push(...desired);}
   expect(market).toHaveLength(count*6);expect(new Set(market).size).toBe(count*6);expect(market.some(x=>x.startsWith('!'))).toBe(false);expect(publicStreams).toHaveLength(count*2);expect(publicStreams.some(x=>x.startsWith('!'))).toBe(false);
   for(let i=0;i<count;i++){expect(market).toContain(`s${i}usdt@ticker`);expect(market).toContain(`s${i}usdt@markPrice@1s`);expect(publicStreams).toContain(`s${i}usdt@depth20@500ms`);expect(publicStreams).toContain(`s${i}usdt@bookTicker`);}
   stream.updateSymbols(['BTCUSDT']);expect(Object.keys((stream as any).lanes)).toEqual(['PUBLIC','MARKET']);stream.stop();
 });
});

describe('subscription acknowledgement and recovery bounds',()=>{
 it('does not fabricate current quote facts when an exchange event has no timestamp',()=>{
  const stream=new BinanceMarketStream({} as never,vi.fn());stream.updateSymbols(['BTCUSDT']);
  for(const E of [undefined,0,NaN,Date.now()+60000]){
   (stream as any).onEvent({e:'24hrTicker',s:'BTCUSDT',c:'100',q:'1000',E});
   (stream as any).onEvent({e:'markPriceUpdate',s:'BTCUSDT',p:'100',E});
   (stream as any).onEvent({e:'bookTicker',s:'BTCUSDT',b:'99',a:'101',E},'PUBLIC');
  }
  expect(stream.quoteFields('BTCUSDT')).toEqual({});stream.stop();
 });
 it('reports disconnected or stopped subscription proof as pending even after an earlier ACK',()=>{
  const stream=new BinanceMarketStream({} as never,vi.fn());stream.updateSymbols(['BTCUSDT']);const lane=(stream as any).lanes.MARKET;
  lane.subscribed=(stream as any).desired('MARKET');lane.confirmed=new Set(lane.subscribed);lane.lastAckAt=Date.now();lane.state='LIVE';lane.socket={readyState:1,close:vi.fn()};
  expect(stream.metrics().streamTraffic.MARKET.subscriptionEvidence).toBe('EXCHANGE_ACKED');lane.socket.readyState=3;
  expect(stream.metrics().streamTraffic.MARKET.subscriptionEvidence).toBe('PENDING_EXCHANGE_ACK');stream.stop();expect(lane.confirmed.size).toBe(0);
 });
 it('waits for the exact ACK, rejects unrelated ACKs and tears down on ACK timeout',async()=>{
  vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),sent:any[]=[],terminate=vi.fn();
  try{stream.updateSymbols(['BTCUSDT']);const lane=(stream as any).lanes.MARKET;lane.socket={readyState:1,send:(raw:string)=>sent.push(JSON.parse(raw)),terminate,close:vi.fn()};(stream as any).subscribeLane('MARKET');await vi.advanceTimersByTimeAsync(350);
   expect(lane.confirmed.size).toBe(0);expect(stream.metrics().streamTraffic.MARKET.subscriptionEvidence).toBe('PENDING_EXCHANGE_ACK');
   (stream as any).onMessage(JSON.stringify({id:sent[0].id+1,result:null}),'MARKET');expect(lane.confirmed.size).toBe(0);
   await vi.advanceTimersByTimeAsync(10_000);expect(terminate).toHaveBeenCalledOnce();expect(lane.lastError).toBe('WS_SUBSCRIPTION_ACK_TIMEOUT');
  }finally{stream.stop();vi.useRealTimers();}
 });
 it('unsubscribes acknowledged old facts before adding a disjoint full cohort, even during rapid churn',async()=>{
  vi.useFakeTimers();const stream=new BinanceMarketStream({} as never,vi.fn()),server=new Set<string>();let maximum=0;
  try{stream.updateSymbols(Array.from({length:160},(_,i)=>`S${i}USDT`));const lane=(stream as any).lanes.MARKET;lane.socket={readyState:1,send:(raw:string)=>{const c=JSON.parse(raw);for(const item of c.params)c.method==='SUBSCRIBE'?server.add(item):server.delete(item);maximum=Math.max(maximum,server.size);(stream as any).onMessage(JSON.stringify({id:c.id,result:null}),'MARKET');},close:vi.fn()};(stream as any).subscribeLane('MARKET');await vi.advanceTimersByTimeAsync(350);stream.updateSymbols(Array.from({length:160},(_,i)=>`T${i}USDT`));stream.updateSymbols(['BTCUSDT']);await vi.advanceTimersByTimeAsync(20_000);expect(maximum).toBeLessThanOrEqual(960);expect([...server].sort()).toEqual([...(stream as any).desired('MARKET')].sort());expect(lane.confirmed).toEqual(server);
  }finally{stream.stop();vi.useRealTimers();}
 });
 it('bounds simultaneous depth repairs and spaces starts during a cohort-wide gap storm',async()=>{
  vi.useFakeTimers();const releases:Array<()=>void>=[],starts:number[]=[],backfill=vi.fn(async()=>{starts.push(Date.now());await new Promise<void>(r=>releases.push(r));return{book:book(),candles:[]};});const stream=new BinanceMarketStream({} as never,backfill);
  try{stream.updateSymbols(Array.from({length:50},(_,i)=>`S${i}USDT`));for(let i=0;i<50;i++){(stream as any).recover(`S${i}USDT`);(stream as any).recover(`S${i}USDT`);}expect(backfill).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(5000);expect(backfill).toHaveBeenCalledTimes(2);expect(stream.metrics().recovery).toMatchObject({active:2,queued:48});for(const release of releases)release();await vi.advanceTimersByTimeAsync(500);expect(backfill.mock.calls.length).toBeLessThanOrEqual(4);for(let i=1;i<starts.length;i++)expect(starts[i]!-starts[i-1]!).toBeGreaterThanOrEqual(500);stream.stop();for(const release of releases)release();await Promise.resolve();expect(stream.metrics().backfills).toBeLessThanOrEqual(2);
  }finally{stream.stop();vi.useRealTimers();}
 });
 it('restores full acknowledged subscriptions after a real socket disconnect without keeping stale confirmations',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address() as {port:number};const received:Record<string,string[]>={};let connections=0;
  server.on('connection',socket=>{const key=String(++connections);received[key]=[];socket.on('message',raw=>{const c=JSON.parse(String(raw));received[key]!.push(...c.params);socket.send(JSON.stringify({id:c.id,result:null}));});});
  const stream=new BinanceMarketStream({effectiveWsUrl:()=>`ws://127.0.0.1:${address.port}`,websocketOptions:()=>({})} as never,vi.fn());
  try{stream.start(['BTCUSDT']);await vi.waitFor(()=>expect(Object.values(stream.metrics().lanes).every((x:any)=>x.confirmedSubscriptions===x.subscriptions&&x.lastAckAt!==null)).toBe(true),{timeout:3000});for(const socket of server.clients)socket.close();await vi.waitFor(()=>expect(connections).toBeGreaterThanOrEqual(4),{timeout:5000});await vi.waitFor(()=>expect(Object.values(stream.metrics().lanes).every((x:any)=>x.confirmedSubscriptions===x.subscriptions&&x.lastAckAt!==null)).toBe(true),{timeout:3000});expect(Object.values(received).filter(rows=>rows.includes('btcusdt@ticker'))).toHaveLength(2);
  }finally{stream.stop();for(const socket of server.clients)socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
});

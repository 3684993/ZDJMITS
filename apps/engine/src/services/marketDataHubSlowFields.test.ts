import { afterEach, expect, it, vi } from 'vitest';
import { MarketDataHub } from './marketDataHub.js';

const periods={"1h":3_600_000,"4h":14_400_000,"1d":86_400_000,"1w":604_800_000} as const;
const closedAt=(now:number,period:number)=>(now-Math.floor(now/period)*period<=10_000?Math.floor(now/period)*period-period:Math.floor(now/period)*period)-1;
const card=(tf:keyof typeof periods,now:number)=>({timeframe:tf,asOf:closedAt(now,periods[tf]),barCloseTime:closedAt(now,periods[tf]),isClosed:true});
const candles=(now:number,period:number,count=80)=>{const end=closedAt(now,period);return Array.from({length:count},(_,i)=>{const closeTime=end-(count-1-i)*period,openTime=closeTime-period+1;return{openTime,closeTime,receivedAt:now,isClosed:true,source:'MOCK',open:100,high:102,low:99,close:101,volume:10,quoteVolume:1000,trades:10};});};

afterEach(()=>vi.useRealTimers());

it('does zero slow REST work while derivatives, rules and long cards are still current',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-11T15:30:00Z'));const now=Date.now();
  const snapshot:any={symbol:'SOLUSDT',quote:{ts:now},orderBook:{ts:now},derivatives:{ts:now},technical:{'1h':card('1h',now),'4h':card('4h',now),'1d':card('1d',now),'1w':card('1w',now)}};
  const state:any={snapshots:new Map([['SOLUSDT',snapshot]])};
  const provider:any={getDerivatives:vi.fn(),getQuote:vi.fn(),getCandles:vi.fn()};
  const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);(hub as any).rulesUpdatedAt.set('SOLUSDT',now);
  expect(await hub.refreshSlowFields(['SOLUSDT'])).toBe(0);expect(provider.getDerivatives).not.toHaveBeenCalled();expect(provider.getQuote).not.toHaveBeenCalled();expect(provider.getCandles).not.toHaveBeenCalled();
});

it('refreshes only the fields whose own cadence crossed a boundary',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-11T15:30:00Z'));const now=Date.now(),old1h={...card('1h',now),asOf:closedAt(now,periods['1h'])-periods['1h'],barCloseTime:closedAt(now,periods['1h'])-periods['1h']};
  const snapshot:any={symbol:'SOLUSDT',quote:{ts:now},orderBook:{ts:now},derivatives:{ts:now-301_000},technical:{'1h':old1h,'4h':card('4h',now),'1d':card('1d',now),'1w':card('1w',now)}};
  const provider:any={getDerivatives:vi.fn(async()=>({ts:now})),getQuote:vi.fn(),getCandles:vi.fn(async(_symbol:string,tf:string)=>candles(now,periods[tf as keyof typeof periods]))};
  const state:any={snapshots:new Map([['SOLUSDT',snapshot]])},hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);(hub as any).rulesUpdatedAt.set('SOLUSDT',now);
  expect(await hub.refreshSlowFields(['SOLUSDT'])).toBe(1);expect(provider.getDerivatives).toHaveBeenCalledOnce();expect(provider.getQuote).not.toHaveBeenCalled();expect(provider.getCandles).toHaveBeenCalledTimes(1);expect(provider.getCandles).toHaveBeenCalledWith('SOLUSDT','1h',80);expect(state.snapshots.get('SOLUSDT').technical['1h'].barCloseTime).toBe(closedAt(now,periods['1h']));
});

it('refreshes contract-rule facts on their own cadence without rebuilding technical cards',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-11T15:30:00Z'));const now=Date.now();
  const snapshot:any={symbol:'SOLUSDT',quote:{ts:now,tickSize:.01,stepSize:.1,minQty:.1,minNotional:5},orderBook:{ts:now},derivatives:{ts:now},technical:{'1h':card('1h',now),'4h':card('4h',now),'1d':card('1d',now),'1w':card('1w',now)}};
  const freshQuote={...snapshot.quote,tickSize:.001,ts:now};
  const provider:any={getDerivatives:vi.fn(),getQuote:vi.fn(async()=>freshQuote),getCandles:vi.fn()};
  const state:any={snapshots:new Map([['SOLUSDT',snapshot]])},hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);(hub as any).rulesUpdatedAt.set('SOLUSDT',now-901_000);
  expect(await hub.refreshSlowFields(['SOLUSDT'])).toBe(1);expect(provider.getQuote).toHaveBeenCalledOnce();expect(provider.getDerivatives).not.toHaveBeenCalled();expect(provider.getCandles).not.toHaveBeenCalled();expect(state.snapshots.get('SOLUSDT').quote.tickSize).toBe(.001);expect((hub.fieldFreshness('SOLUSDT',now) as any).fields.contractRules.fresh).toBe(true);
});

it('merges completed slow facts into the latest tick snapshot instead of restoring old quote/book facts',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-11T15:30:00Z'));const now=Date.now();let release!:(value:any)=>void;
  const derivatives=new Promise<any>(resolve=>release=resolve),snapshot:any={symbol:'SOLUSDT',quote:{symbol:'SOLUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.01,stepSize:.1,minQty:.1,minNotional:5,ts:now},orderBook:{symbol:'SOLUSDT',bids:[[99.9,1]],asks:[[100.1,1]],ts:now},derivatives:{ts:now-301_000},technical:{'1h':card('1h',now),'4h':card('4h',now),'1d':card('1d',now),'1w':card('1w',now)}};
  const state:any={snapshots:new Map([['SOLUSDT',snapshot]])},provider:any={getDerivatives:vi.fn(()=>derivatives),getQuote:vi.fn(),getCandles:vi.fn(),hydrateLiveMarket:vi.fn((current:any)=>({...current,quote:{...current.quote,last:202,mark:202,bid:201.9,ask:202.1,ts:now+1},orderBook:{...current.orderBook,bids:[[201.9,2]],asks:[[202.1,2]],ts:now+1}}))};
  const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);(hub as any).rulesUpdatedAt.set('SOLUSDT',now);
  const slow=hub.refreshSlowFields(['SOLUSDT']);await Promise.resolve();await hub.tick();release({ts:now,openInterest:77});await slow;
  expect(state.snapshots.get('SOLUSDT')).toMatchObject({quote:{last:202,mark:202},orderBook:{bids:[[201.9,2]]},derivatives:{openInterest:77}});
});

import {it,expect,vi} from 'vitest';import {MarketDataHub} from './marketDataHub.js';
it('recovers missing held/core/pool snapshots before unrelated stale assets with at most two simultaneous calls',async()=>{
 let active=0,max=0;const calls:string[]=[];const state:any={positionSymbols:()=>['HELDUSDT'],activeEntrySymbols:()=>['ORDERUSDT'],pool:{list:()=>[{symbol:'POOLUSDT'}]},snapshots:new Map(),settings:{}};
 const provider:any={getSnapshot:async(symbol:string)=>{calls.push(symbol);active++;max=Math.max(max,active);await Promise.resolve();active--;return{symbol};}};
 const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);vi.spyOn(hub,'freshness').mockReturnValue({stale:['OTHERUSDT']} as any);
 expect(await hub.recoverStale()).toBe(4);expect(calls).toEqual(['HELDUSDT','ORDERUSDT','BTCUSDT','ETHUSDT']);expect(max).toBeLessThanOrEqual(2);expect(state.snapshots.has('HELDUSDT')).toBe(true);
});

it('isolates a live candle-gap failure to one symbol',async()=>{
 const first={symbol:'BADUSDT'},second={symbol:'GOODUSDT'},state:any={snapshots:new Map([['BADUSDT',first],['GOODUSDT',second]])};
 const publish=vi.fn(),provider:any={tick:vi.fn(),hydrateLive:(snapshot:any)=>{if(snapshot.symbol==='BADUSDT')throw new Error('1m closed candle gap');return{...snapshot,hydrated:true};}};
 const hub=new MarketDataHub(provider,state,{publish} as any);
 await expect(hub.tick()).resolves.toBeUndefined();
 expect(state.snapshots.get('GOODUSDT').hydrated).toBe(true);
 expect(publish).toHaveBeenCalledWith('MARKET_SYMBOL_ERROR',{message:'1m closed candle gap',scope:'LIVE_HYDRATE'},'BADUSDT');
});

it('keeps quote/book management facts and emits one technical error per unchanged bad sequence',async()=>{
 const snapshot:any={symbol:'BADUSDT',quote:{last:1},orderBook:{ts:1},technical:{'1m':{barCloseTime:60_000}}};
 const state:any={snapshots:new Map([['BADUSDT',snapshot]])},publish=vi.fn();
 const provider:any={tick:vi.fn(),hydrateLiveMarket:(s:any)=>({...s,quote:{...s.quote,last:2},orderBook:{ts:2}}),hydrateLiveTechnical:()=>{throw new Error('1m closed candle gap');}};
 const hub=new MarketDataHub(provider,state,{publish} as any);
 await hub.tick();await hub.tick();
 expect(state.snapshots.get('BADUSDT')).toMatchObject({quote:{last:2},orderBook:{ts:2}});
 expect(publish).toHaveBeenCalledTimes(1);
 expect(publish).toHaveBeenCalledWith('MARKET_SYMBOL_ERROR',{message:'1m closed candle gap',scope:'LIVE_HYDRATE_TECHNICAL',timeframe:'1m',sequence:'60000'},'BADUSDT');
});

it('reports a recovered or changed bad candle sequence once again',async()=>{
 const state:any={snapshots:new Map([['BADUSDT',{symbol:'BADUSDT',technical:{'1m':{barCloseTime:1}}}]])},publish=vi.fn();let sequence='v1';
 const provider:any={hydrateLiveMarket:(s:any)=>s,hydrateLiveTechnical:()=>{const error:any=new Error('1m closed candle gap');error.technicalTimeframe='1m';error.technicalSequence=sequence;throw error;}};
 const hub=new MarketDataHub(provider,state,{publish} as any);
 await hub.tick();await hub.tick();sequence='v2';await hub.tick();
 expect(publish).toHaveBeenCalledTimes(2);
});

it('does not let one technical failure delay another symbol',async()=>{
 const state:any={snapshots:new Map([['BADUSDT',{symbol:'BADUSDT',technical:{'1m':{barCloseTime:1}}}],['GOODUSDT',{symbol:'GOODUSDT',technical:{'1m':{barCloseTime:1}}}]])};
 const provider:any={hydrateLiveMarket:(s:any)=>({...s,quoteUpdated:true}),hydrateLiveTechnical:(s:any)=>s.symbol==='BADUSDT'?(()=>{throw new Error('gap');})():({...s,technicalUpdated:true})};
 const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);
 await hub.tick();
 expect(state.snapshots.get('GOODUSDT')).toMatchObject({quoteUpdated:true,technicalUpdated:true});
});

it('blocks Primary on a failed sequence until a verified technical revision succeeds',async()=>{
 const now=Date.now(),snapshot:any={symbol:'BADUSDT',quote:{ts:now},orderBook:{ts:now},technical:{'1m':{asOf:now,barCloseTime:now-1,isClosed:true},'5m':{asOf:now,barCloseTime:now-1,isClosed:true},'15m':{asOf:now,barCloseTime:now-1,isClosed:true,sampleSize:240}}};let recover=false;
 const state:any={snapshots:new Map([['BADUSDT',snapshot]])};const provider:any={hydrateLiveMarket:(s:any)=>({...s,quote:{ts:now},orderBook:{ts:now}}),hydrateLiveTechnical:(s:any)=>{if(!recover){const e:any=new Error('1m closed candle gap');e.technicalTimeframe='1m';e.technicalSequence='bad';throw e;}return {...s,technical:{...s.technical,'1m':{...s.technical['1m'],barCloseTime:now-1}}};}};
 const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);await hub.tick();expect(hub.primaryReadyReasons('BADUSDT',now)).toContain('TECHNICAL_1m_SEQUENCE_INVALID');recover=true;await hub.tick();expect(hub.primaryReadyReasons('BADUSDT',now)).not.toContain('TECHNICAL_1m_SEQUENCE_INVALID');
});
it('does not write a deferred refresh back after retention eviction or rejoin epoch change',async()=>{
 let release!:(value:any)=>void;const pending=new Promise<any>(resolve=>release=resolve),state:any={snapshots:new Map(),settings:{connections:{marketDataMode:'MOCK'},selection:{assetDirectory:{approvedLiquid:[]}}},marketGeneration:0};
 const hub=new MarketDataHub({getSnapshot:async()=>pending} as any,state,{publish:vi.fn()} as any);
 hub.setRetentionSymbols(['SOLUSDT']);const refresh=hub.refreshSymbols(['SOLUSDT']);await Promise.resolve();hub.setRetentionSymbols([]);hub.setRetentionSymbols(['SOLUSDT']);release({symbol:'SOLUSDT'});await refresh;
 expect(state.snapshots.has('SOLUSDT')).toBe(false);
});
it('uses a fresh epoch flight after eviction/rejoin and rejects the late old response',async()=>{let oldRelease!:(v:any)=>void,newRelease!:(v:any)=>void,calls=0;const old=new Promise<any>(r=>oldRelease=r),fresh=new Promise<any>(r=>newRelease=r),state:any={snapshots:new Map(),settings:{connections:{marketDataMode:'MOCK'}},marketGeneration:0},hub=new MarketDataHub({getSnapshot:async()=>++calls===1?old:fresh,setLiveSymbols:vi.fn()} as any,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);const first=hub.refreshSymbols(['SOLUSDT']);await Promise.resolve();hub.setRetentionSymbols([]);hub.setRetentionSymbols(['SOLUSDT']);const second=hub.refreshSymbols(['SOLUSDT']);await Promise.resolve();newRelease({symbol:'SOLUSDT',quote:{last:2}});await second;oldRelease({symbol:'SOLUSDT',quote:{last:1}});await first;expect(calls).toBe(2);expect(state.snapshots.get('SOLUSDT').quote.last).toBe(2);});
it('coalesces budget-deferred targeted refreshes without per-symbol errors',async()=>{const publish=vi.fn(),state:any={snapshots:new Map(),settings:{}},provider:any={getSnapshot:vi.fn(async()=>{throw new Error('BINANCE_REQUEST_BUDGET_DEFERRED:PRESSURED');})},hub=new MarketDataHub(provider,state,{publish} as any);expect(await hub.refreshSymbols(['AAAUSDT','BBBUSDT','CCCUSDT'])).toBe(0);expect(provider.getSnapshot.mock.calls.length).toBeLessThanOrEqual(2);expect(await hub.refreshSymbols(['AAAUSDT'])).toBe(0);expect(provider.getSnapshot.mock.calls.length).toBeLessThanOrEqual(2);expect(publish).toHaveBeenCalledWith('MARKET_REFRESH_DEFERRED',expect.objectContaining({scope:'TARGETED_REFRESH',requested:3}));expect(publish).not.toHaveBeenCalledWith('MARKET_SYMBOL_ERROR',expect.anything(),expect.anything());});
it('derives WS ownership and refreshes slow fields without a full snapshot request',async()=>{const now=Date.now(),live=vi.fn(),state:any={snapshots:new Map([['SOLUSDT',{symbol:'SOLUSDT',quote:{ts:now},derivatives:{ts:1},technical:{'1h':{asOf:1},'4h':{asOf:1},'1d':{asOf:1},'1w':{asOf:1}}}]]),settings:{}},provider:any={setLiveSymbols:live,getSnapshot:vi.fn(),getQuote:async()=>({ts:now}),getDerivatives:async()=>({ts:now}),getCandles:async(tf:string)=>Array.from({length:80},(_,i)=>({openTime:i,closeTime:i+1,open:1,high:2,low:1,close:1.5,volume:1}))};const hub=new MarketDataHub(provider,state,{publish:vi.fn()} as any);hub.setRetentionSymbols(['SOLUSDT']);await hub.refreshSlowFields(['SOLUSDT']);hub.setRetentionSymbols([]);expect(provider.getSnapshot).not.toHaveBeenCalled();expect(live).toHaveBeenLastCalledWith([]);expect(state.snapshots.has('SOLUSDT')).toBe(false);});

import {afterEach,expect,it,vi} from 'vitest';
import {MarketDataHub} from './marketDataHub.js';
import {BinancePublicMarketDataProvider} from '../adapters/market/BinancePublicMarketDataProvider.js';
const NOW=1_800_000_000_000;
const snapshot=(symbol='BTCUSDT',at=NOW):any=>({symbol,quote:{symbol,last:100,bid:99,ask:101,ts:at},orderBook:{symbol,bids:[[99,1]],asks:[[101,1]],ts:at},derivatives:{ts:at},technical:Object.fromEntries(['1m','5m','15m','1h','4h','1d','1w'].map(tf=>[tf,{asOf:at,sampleSize:240}])),dataCompleteness:1});
const harness=(provider:any,values:any[])=>{const state:any={snapshots:new Map(values.map(v=>[v.symbol,v])),settings:{selection:{minDataCompleteness:.9}}};return {state,hub:new MarketDataHub(provider,state,{publish:vi.fn()} as any)};};
afterEach(()=>vi.useRealTimers());
it('publishes fresh cached reference quotes before spending REST',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);const provider:any={getSnapshot:vi.fn(),getQuote:vi.fn(),hydrateLiveMarket:(s:any)=>({...s,quote:{...s.quote,ts:NOW}})};
 const {hub,state}=harness(provider,[{...snapshot(),quote:{ts:NOW-30_000}}]);
 expect(await hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT')).toBe(1);
 expect(state.snapshots.get('BTCUSDT').quote.ts).toBe(NOW);expect(provider.getQuote).not.toHaveBeenCalled();expect(provider.getSnapshot).not.toHaveBeenCalled();
});
it('repairs a reference quote without orderbook or seven-history reloads',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);const provider:any={getQuote:vi.fn(async()=>snapshot().quote),getOrderBook:vi.fn(),getSnapshot:vi.fn()};
 const old=snapshot('BTCUSDT');old.quote.ts=NOW-30_000;old.orderBook.ts=NOW-30_000;
 const {hub}=harness(provider,[old]);expect(await hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT')).toBe(1);
 expect(provider.getQuote).toHaveBeenCalledTimes(1);expect(provider.getOrderBook).not.toHaveBeenCalled();expect(provider.getSnapshot).not.toHaveBeenCalled();
});
it('repairs both quote and book when the reference symbol is itself the candidate',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);const provider:any={getQuote:vi.fn(async()=>snapshot().quote),getOrderBook:vi.fn(async()=>snapshot().orderBook),getSnapshot:vi.fn()};
 const old=snapshot();old.quote.ts=old.orderBook.ts=NOW-30_000;const {hub}=harness(provider,[old]);
 expect(await hub.refreshEntryDependencies(['BTCUSDT'],'BTCUSDT')).toBe(1);expect(provider.getOrderBook).toHaveBeenCalledOnce();expect(provider.getSnapshot).not.toHaveBeenCalled();
});
it('coalesces concurrent dependency requests and retries after a bounded cooldown',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let finish!:(q:any)=>void;const provider:any={getQuote:vi.fn(()=>new Promise(r=>finish=r)),getSnapshot:vi.fn()};
 const old=snapshot();old.quote.ts=NOW-30_000;const {hub,state}=harness(provider,[old]);
 const first=hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT'),second=hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT');expect(provider.getQuote).toHaveBeenCalledOnce();
 finish({...old.quote});expect(await first).toBe(0);expect(await second).toBe(0);
 expect(await hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT')).toBe(0);expect(provider.getQuote).toHaveBeenCalledOnce();expect(provider.getSnapshot).not.toHaveBeenCalled();
 expect(state.snapshots.get('BTCUSDT').quote.ts).toBe(NOW-30_000);
 vi.setSystemTime(NOW+5001);const retry=hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT');expect(provider.getQuote).toHaveBeenCalledTimes(2);finish({...old.quote,ts:Date.now()});expect(await retry).toBe(1);
});
it('does not resurrect a dependency evicted while its read is pending',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let finish!:(q:any)=>void;const provider:any={getQuote:vi.fn(()=>new Promise(r=>finish=r)),setLiveSymbols:vi.fn()};
 const old=snapshot();old.quote.ts=NOW-30_000;const {hub,state}=harness(provider,[old]);hub.setRetentionSymbols(['BTCUSDT']);
 const pending=hub.refreshEntryDependencies(['BTCUSDT'],'SOLUSDT');hub.setRetentionSymbols([]);finish(snapshot().quote);expect(await pending).toBe(0);expect(state.snapshots.has('BTCUSDT')).toBe(false);
});
it('does not roll quote or book back when an older full snapshot completes after a tick',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let finish!:(s:any)=>void;const provider:any={getSnapshot:vi.fn(()=>new Promise(r=>finish=r))};const initial=snapshot();const {hub,state}=harness(provider,[initial]);
 const pending=hub.refreshSymbols(['BTCUSDT']);const updated=snapshot('BTCUSDT',NOW+1000);updated.quote.last=102;state.snapshots.set('BTCUSDT',updated);finish(initial);await pending;
 expect(state.snapshots.get('BTCUSDT').quote).toEqual(updated.quote);expect(state.snapshots.get('BTCUSDT').orderBook).toEqual(updated.orderBook);
});
it('keeps refreshed exchange filters while preserving newer market prices',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let finish!:(s:any)=>void;
 const provider:any={getSnapshot:vi.fn(()=>new Promise(r=>finish=r))},initial=snapshot();
 Object.assign(initial.quote,{tickSize:.01,stepSize:1,minQty:1,minNotional:5});
 const {hub,state}=harness(provider,[initial]),pending=hub.refreshSymbols(['BTCUSDT']);
 const updated={...initial,quote:{...initial.quote,last:102,bid:101,ask:103,ts:NOW+1000}};state.snapshots.set('BTCUSDT',updated);
 finish({...initial,quote:{...initial.quote,tickSize:.1,stepSize:10,minQty:10,minNotional:20}});await pending;
 expect(state.snapshots.get('BTCUSDT').quote).toMatchObject({last:102,bid:101,ask:103,ts:NOW+1000,tickSize:.1,stepSize:10,minQty:10,minNotional:20});
 expect(hub.fieldFreshness('BTCUSDT').fields.contractRules?.fresh).toBe(true);
});
it('a book-only dependency refresh preserves filters updated while it was pending',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let finish!:(s:any)=>void;
 const provider:any={getOrderBook:vi.fn(()=>new Promise(r=>finish=r)),getQuote:vi.fn(),getSnapshot:vi.fn()},initial=snapshot();
 Object.assign(initial.quote,{tickSize:.01,stepSize:1,minQty:1,minNotional:5});initial.orderBook.ts=NOW-30_000;
 const {hub,state}=harness(provider,[initial]),pending=hub.refreshEntryDependencies(['BTCUSDT'],'BTCUSDT');
 state.snapshots.set('BTCUSDT',{...initial,quote:{...initial.quote,tickSize:.1,stepSize:10,minQty:10,minNotional:20}});
 finish(snapshot().orderBook);expect(await pending).toBe(1);
 expect(state.snapshots.get('BTCUSDT').quote).toMatchObject({tickSize:.1,stepSize:10,minQty:10,minNotional:20});
 expect(provider.getQuote).not.toHaveBeenCalled();expect(provider.getSnapshot).not.toHaveBeenCalled();
});
it('bounds missing-dependency work to three selected symbols with at most two requests in flight',async()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);let active=0,peak=0;const provider:any={getSnapshot:vi.fn(async(symbol:string)=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return snapshot(symbol);})};
 const {hub}=harness(provider,[]);expect(await hub.refreshEntryDependencies(['SOLUSDT','BTCUSDT','ETHUSDT','OTHERUSDT'],'SOLUSDT')).toBe(3);
 expect(peak).toBe(2);expect(provider.getSnapshot.mock.calls.flat()).toEqual(['SOLUSDT','BTCUSDT','ETHUSDT']);
});
it('does not overwrite newer REST facts with an older stream patch or invent missing timestamps',()=>{
 vi.useFakeTimers();vi.setSystemTime(NOW);const provider:any=new BinancePublicMarketDataProvider({} as any);const initial=snapshot();
 provider.stream.quote=()=>({last:90,bid:89,ask:91,ts:NOW-1000});provider.stream.book=()=>({...initial.orderBook,ts:NOW-1000});
 expect(provider.hydrateLiveMarket(initial)).toBe(initial);
 provider.stream.quote=()=>({last:90,bid:89,ask:91});expect(provider.hydrateLiveMarket(initial)).toBe(initial);
 provider.stream.quote=()=>({last:102,bid:101,ask:103,ts:NOW});expect(provider.hydrateLiveMarket(initial).quote).toMatchObject({last:102,ts:NOW});
});

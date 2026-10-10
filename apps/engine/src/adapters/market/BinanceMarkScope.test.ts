import {expect,it,vi} from 'vitest';
import {BinanceMarketStream} from './BinanceMarketStream.js';
const create=(symbols:string[])=>{const s=new BinanceMarketStream({} as never,vi.fn());(s as any).retainSymbols(symbols);return s;};
it('requests equal-cadence mark only for retained symbols and preserves discovery/BBO',()=>{
 const s=create(['BTCUSDT','ETHUSDT']);const desired=(s as any).desired('MARKET') as Set<string>;
 expect(desired.has('!markPrice@arr@1s')).toBe(false);expect(desired).toEqual(new Set(['!ticker@arr',...['btc','eth'].flatMap(x=>[`${x}usdt@markPrice@1s`,`${x}usdt@kline_1m`,`${x}usdt@kline_5m`,`${x}usdt@kline_15m`,`${x}usdt@aggTrade`])]));expect((s as any).desired('PUBLIC').has('!bookTicker')).toBe(true);
});
it('falls back to existing all-market mark if scoped additions would exceed the MARKET connection limit',()=>{
 const s=create(Array.from({length:205},(_,i)=>`S${i}USDT`)),desired=(s as any).desired('MARKET') as Set<string>;
 expect(desired.has('!markPrice@arr@1s')).toBe(true);expect(desired.size).toBe(822);expect(desired.size).toBeLessThanOrEqual(1024);
 for(let i=0;i<205;i++)expect(desired.has(`s${i}usdt@kline_1m`)).toBe(true);
});
it('updates retained mark scope on ownership changes without authorizing any trades',()=>{
 const s=create(['BTCUSDT','ETHUSDT']);s.updateSymbols(['BTCUSDT','SOLUSDT']);const desired=(s as any).desired('MARKET') as Set<string>;
 expect(desired.has('btcusdt@markPrice@1s')).toBe(true);expect(desired.has('solusdt@markPrice@1s')).toBe(true);expect(desired.has('ethusdt@markPrice@1s')).toBe(false);
});
it('replays all-market vs selected individual frames into identical retained quote facts with fewer fixture bytes',()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);try{
 const retained=['BTCUSDT','ETHUSDT'],a=create(retained),b=create(retained);
 const rows=[...retained,...Array.from({length:62},(_,i)=>`S${i}USDT`)].map(s=>({e:'markPriceUpdate',E:100000,s,p:'100.2',i:'100.1',P:'100.3',r:'0.0001',T:200000}));
 for(const s of retained)for(const stream of [a,b]){(stream as any).onMessage(JSON.stringify({e:'24hrTicker',s,c:'100',q:'5000',P:'2',n:10,E:100000}),'MARKET');(stream as any).onMessage(JSON.stringify({e:'bookTicker',s,b:'99.9',a:'100.1',E:100000}),'PUBLIC');}
 const all=JSON.stringify(rows),selected=rows.filter(r=>retained.includes(r.s)).map(r=>JSON.stringify(r));
 (a as any).onMessage(all,'MARKET');for(const row of selected)(b as any).onMessage(row,'MARKET');
 for(const s of retained){expect(b.quote(s)).toEqual(a.quote(s));expect(b.quote(s)).toMatchObject({last:100,mark:100.2,bid:99.9,ask:100.1});}
 expect(Buffer.byteLength(selected.join(''))).toBeLessThan(Buffer.byteLength(all));
 vi.setSystemTime(106000);for(const stream of [a,b]){(stream as any).onMessage(JSON.stringify({e:'bookTicker',s:'BTCUSDT',b:'99.9',a:'100.1',E:106000}),'PUBLIC');(stream as any).onMessage(JSON.stringify({e:'24hrTicker',s:'BTCUSDT',c:'100',q:'5000',P:'2',n:10,E:106000}),'MARKET');expect(stream.quote('BTCUSDT')).toBeUndefined();}
 }finally{vi.useRealTimers();}
});

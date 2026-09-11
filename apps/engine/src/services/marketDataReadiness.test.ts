import {describe,expect,it} from 'vitest';
import {MarketDataHub} from './marketDataHub.js';
import {EventBus} from '../events/eventBus.js';

function snapshot(now:number){return{symbol:'BTCUSDT',quote:{ts:now},orderBook:{ts:now},technical:{'1m':{asOf:now},'5m':{asOf:now},'15m':{asOf:now}}} as any;}
describe('single Primary market readiness contract',()=>{
  it('requires quote, book, 1m, 5m and 15m from one readiness check',()=>{const now=Date.now(),state:any={snapshots:new Map([['BTCUSDT',snapshot(now)]])};const hub=new MarketDataHub({} as never,state,new EventBus());expect(hub.primaryReadyReasons('BTCUSDT',now)).toEqual([]);state.snapshots.get('BTCUSDT').technical['5m'].asOf=now-606_000;expect(hub.primaryReadyReasons('BTCUSDT',now)).toEqual(['TECHNICAL_5m_STALE']);state.snapshots.get('BTCUSDT').technical['5m'].asOf=now;state.snapshots.get('BTCUSDT').orderBook.ts=now-16_000;expect(hub.primaryReadyReasons('BTCUSDT',now)).toEqual(['ORDER_BOOK_STALE']);});
  it('fails closed on missing, non-finite and future evidence timestamps',()=>{const now=Date.now(),row=snapshot(now),state:any={snapshots:new Map([['BTCUSDT',row]])};const hub=new MarketDataHub({} as never,state,new EventBus());delete row.technical['5m'];row.quote.ts=Number.NaN;row.orderBook.ts=now+10_000;expect(hub.primaryReadyReasons('BTCUSDT',now)).toEqual(['QUOTE_TIMESTAMP_INVALID','ORDER_BOOK_TIMESTAMP_FUTURE','TECHNICAL_5m_MISSING']);});
  it('increments market generation exactly once per full refresh',async()=>{const now=Date.now(),snap=snapshot(now),state:any={marketGeneration:7,snapshots:new Map(),settings:{connections:{marketDataMode:'BINANCE'}}};const hub=new MarketDataHub({listSymbols:async()=>['BTCUSDT','ETHUSDT'],getSnapshot:async(symbol:string)=>({...snap,symbol})} as never,state,new EventBus());await hub.refresh(10);expect(state.marketGeneration).toBe(8);expect(state.snapshots.size).toBe(2);});
});

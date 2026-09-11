import {describe,it,expect,vi} from 'vitest';
import {nearMarketPrice} from './nearMarketPrice.js';
import {RecentTradePrices} from '../adapters/market/recentTradePrices.js';
import {EntryCoordinator} from './entryCoordinator.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
const settings:any={entry:{reviewIntervalSeconds:2,nearMarket:{enabled:true,ttlSeconds:90,reviewSeconds:2,repriceIntervalSeconds:5,maxReprices:6,maxOffsetTicks:2,maxDistanceBps:5}}};
describe('bounded near-market execution',()=>{
  it('requires actual recent trade evidence, quote proximity and unchanged direction',()=>{
    const now=Date.now(),market:any={quote:{bid:100,ask:100.01,tickSize:.01,ts:now},recentTradedPrices:[{price:100,lastSeenAt:now},{price:100.01,lastSeenAt:now}]};
    for(const side of ['LONG','SHORT']){
      const intent:any={side,idealPrice:90,acceptablePriceRange:{min:99,max:101}};
      const result=nearMarketPrice(intent,market,settings.entry,now);expect(result.reachable).toBe(true);expect(result.price).toBe(side==='LONG'?100:100.01);
      expect(nearMarketPrice(intent,{...market,recentTradedPrices:[]},settings.entry,now).reachable).toBe(false);
      expect(nearMarketPrice(intent,market,settings.entry,now+300001).reachable).toBe(false);
    }
  });
  it('does not invent prices inside a five-minute OHLC range or accept future ticks',()=>{
    const book=new RecentTradePrices(),now=Date.now();book.record('BTCUSDT',100,now);book.record('BTCUSDT',101,now);book.record('BTCUSDT',100.01,now+2000,now);
    expect(book.near('BTCUSDT',100,100.02,.01,now).map(x=>x.price)).toEqual([100]);
    expect(book.near('BTCUSDT',100,100.02,.01,now+300001)).toEqual([]);
  });
  it.each(['UNKNOWN','FILLED'])('does not fabricate EXPIRED when cancellation returns %s',async status=>{
    const state=new RuntimeState(settings),now=Date.now();const o:any={id:'o',intentId:'i',symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:0,status:'WORKING',createdAt:now-91000,updatedAt:now-10000,absoluteExpiresAt:now+100000,reservationId:'r',repriceCount:0};
    state.entryOrders.set('o',o);const release=vi.spyOn(state,'releaseEntryReservation');
    const exchange:any={cancelEntry:vi.fn(async()=>({...o,status,filledQuantity:status==='FILLED'?1:0}))};
    await new EntryCoordinator(state,{} as any,{} as any,exchange,new EventBus()).reviewPending();
    expect(state.entryOrders.get('o')?.status).toBe(status);expect(release).toHaveBeenCalledTimes(status==='UNKNOWN'?0:1);
  });
});

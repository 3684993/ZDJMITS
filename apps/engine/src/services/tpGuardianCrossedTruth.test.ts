import {expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import defaults from '../../../../config/settings.default.json' with {type:'json'};
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {TpGuardian} from './tpGuardian.js';

function fixture(crossed:boolean){
  const state=new RuntimeState(SystemSettingsSchema.parse(defaults)),now=Date.now();
  const position:any={id:'p1',cycleId:'c1',symbol:'XLMUSDT',side:'SHORT',quantity:10,entryPrice:1,markPrice:.98,leverage:20,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:now-60_000,firstObservedAt:now-60_000,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PROTECTED',tpOrderId:'tp1',tpLastVerifiedAt:now-120_000,tpCoverageSource:'BINANCE_OPEN_ORDER'};
  const tp:any={id:'tp1',clientOrderId:'tp_x',exchangeOrderId:'1',cycleId:'c1',positionId:'p1',symbol:'XLMUSDT',side:'BUY',quantity:10,price:.99,status:'WORKING',createdAt:now-180_000,updatedAt:now-120_000};
  state.positions.set(position.id,position);state.tpOrders.set(tp.id,tp);state.snapshots.set(position.symbol,{symbol:position.symbol,quote:{bid:.98,ask:crossed?.985:.995,mark:.98,last:.98,tickSize:.001,stepSize:1,minQty:1,minNotional:1,quoteVolumeUsd24h:1,priceChangePercent24h:0,tradeCount24h:1,ts:now},technical:{},orderBook:{bids:[],asks:[],ts:now},derivatives:{},dataCompleteness:1,listingAgeDays:100} as any);
  const exact=vi.fn(async()=>({...tp,status:'WORKING',updatedAt:Date.now()}));
  const exchange:any={findTakeProfitByClientOrderId:exact,cancelTakeProfit:vi.fn(),placeTakeProfit:vi.fn()};
  return{state,position,tp,exact,guardian:new TpGuardian(state,exchange,new EventBus())};
}

it('marks a crossed still-open TP pending and bounds exact verification to one request per 30s',async()=>{const x=fixture(true),previous=x.position.tpLastVerifiedAt;await x.guardian.ensure(x.position);await x.guardian.ensure(x.state.positions.get('p1')!);expect(x.exact).toHaveBeenCalledOnce();expect(x.state.positions.get('p1')).toMatchObject({tpStatus:'PENDING',tpOrderId:'tp1'});expect(x.state.positions.get('p1')!.tpLastVerifiedAt).toBeGreaterThan(previous);});

it('does not manufacture a new verification timestamp from an untouched local WORKING TP',async()=>{const x=fixture(false),previous=x.position.tpLastVerifiedAt;await x.guardian.ensure(x.position);expect(x.exact).not.toHaveBeenCalled();expect(x.state.positions.get('p1')).toMatchObject({tpStatus:'PROTECTED',tpOrderId:'tp1',tpLastVerifiedAt:previous});});

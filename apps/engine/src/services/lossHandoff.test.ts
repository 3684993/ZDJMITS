import {expect,it,vi,afterEach} from 'vitest';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {LossHandoffService} from './lossHandoff.js';

afterEach(()=>vi.useRealTimers());

function fixture(){
  vi.useFakeTimers();vi.setSystemTime(3_500_000);
  const state=new RuntimeState({positionManagement:{lossHandoffBars:2}} as any),events:any[]=[],bus=new EventBus();
  bus.on('POSITION_HUMAN_HANDOFF',e=>events.push(e));
  const pos:any={id:'p',symbol:'BTCUSDT',side:'LONG',entryPrice:100,quantity:1,markPrice:99,leverage:10,unrealizedPnl:-1,unrealizedPnlPercent:-1,openedAt:1,tpStatus:'PROTECTED',tpOrderId:'tp',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpCoverageSource:'SYSTEM_CREATED'};
  state.positions.set('p',pos);
  return{state,events,bus,service:new LossHandoffService(state,bus)};
}

it('counts only ordered contiguous bars that opened after the position and hands off without removing protection facts',()=>{
  const h=fixture(),first=1_799_999;
  h.state.snapshots.set('BTCUSDT',{technical:{'15m':{isClosed:true,barCloseTime:first,lastClosedBar:{closeTime:first,close:99}}},quote:{mark:999}} as any);
  h.service.tick();h.service.tick();expect((h.state.positions.get('p') as any).lossHandoff.consecutiveLossBars).toBe(1);
  const card:any=h.state.snapshots.get('BTCUSDT')!.technical['15m'];card.barCloseTime+=900_000;card.lastClosedBar.closeTime+=900_000;
  h.service.tick();
  expect(h.state.positions.get('p')).toMatchObject({managementStatus:'HUMAN_MANAGED',tpOrderId:'tp',tpStatus:'PROTECTED',lossHandoff:{status:'HUMAN_HANDOFF',consecutiveLossBars:2}});
  expect(h.events).toHaveLength(1);
});

it('rejects the bar that was already open when the position opened',()=>{
  const h=fixture(),preEntryBar=899_999;
  h.state.snapshots.set('BTCUSDT',{technical:{'15m':{isClosed:true,barCloseTime:preEntryBar,lastClosedBar:{closeTime:preEntryBar,close:99}}},quote:{mark:99}} as any);
  h.service.tick();
  expect(h.state.positions.get('p')).toMatchObject({managementStatus:'AUTO_MANAGED',lossHandoff:{status:'UNKNOWN',consecutiveLossBars:0,lastClosedBarAt:null}});
  expect(h.events).toHaveLength(0);
});

it('marks a missing first eligible closed bar UNKNOWN instead of inferring loss duration',()=>{
  const h=fixture(),late=2_699_999;
  h.state.snapshots.set('BTCUSDT',{technical:{'15m':{isClosed:true,barCloseTime:late,lastClosedBar:{closeTime:late,close:99}}},quote:{mark:99}} as any);
  h.service.tick();
  expect(h.state.positions.get('p')).toMatchObject({managementStatus:'AUTO_MANAGED',lossHandoff:{status:'UNKNOWN',consecutiveLossBars:0,lastClosedBarAt:null}});
  expect(h.events).toHaveLength(0);
});

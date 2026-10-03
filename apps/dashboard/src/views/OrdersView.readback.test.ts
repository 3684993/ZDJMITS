// @vitest-environment jsdom
import {flushPromises,mount,type VueWrapper} from '@vue/test-utils';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import OrdersView from './OrdersView.vue';
import {api} from '../api/client';

let store:any,wrapper:VueWrapper|null=null;
vi.mock('../stores/system',()=>({useSystemStore:()=>store}));
vi.mock('../api/client',()=>({api:{orders:vi.fn(),cancelEntry:vi.fn()}}));
const active=()=>({entry:[{id:'local',symbol:'BTCUSDT',side:'LONG',quantity:2,price:100,createdAt:1,filledQuantity:0,status:'WORKING',leverage:10,leverageVerified:true,
  economicMandate:{economics:{expectedNetQuote:2,minimumNetProfitQuote:1,targetPrice:102,targetHorizonMinutes:5}},cancelEligibility:{allowed:true,message:'已核验'}}],
  entryReadback:{status:'READY',verifiedAt:Date.now()},manual:[],manualReadback:{status:'READY'},historicalUnknown:[]});
beforeEach(()=>{vi.clearAllMocks();store={snapshot:{tpOrders:[]},refresh:vi.fn().mockResolvedValue(undefined)};vi.mocked(api.orders).mockResolvedValue(active());});
afterEach(()=>{wrapper?.unmount();wrapper=null;});
async function open(){wrapper=mount(OrdersView,{global:{stubs:{Panel:{props:['title','subtitle'],template:'<section><h2>{{title}}</h2><p>{{subtitle}}</p><slot/></section>'},StatusBadge:{props:['value'],template:'<span>{{value}}</span>'}}}});await flushPromises();return wrapper;}

it('preserves main economic columns and uses locally proven leverage beside cancellation eligibility',async()=>{
  const view=await open();expect(view.findAll('th').map(cell=>cell.text())).toContain('Expected net / Required');
  expect(view.findAll('th').map(cell=>cell.text())).toContain('TP / Horizon');
  const cells=view.findAll('tbody td');expect(cells[4].text()).toBe('20.0000 / 10x');expect(cells[5].text()).toBe('2 / 1');expect(cells[6].text()).toContain('102');
  expect(view.find('tbody button').attributes('disabled')).toBeUndefined();expect(api.cancelEntry).not.toHaveBeenCalled();
});

it('retains the last known row but disables cancellation when a subsequent readback fails',async()=>{
  const view=await open();vi.mocked(api.orders).mockRejectedValueOnce(new Error('readback unavailable'));
  await view.findAll('button').find(button=>button.text()==='刷新订单事实')!.trigger('click');await flushPromises();
  expect(view.text()).toContain('建仓委托最后已知快照');expect(view.text()).toContain('BTCUSDT');
  expect(view.find('tbody button').attributes('disabled')).toBeDefined();expect(api.cancelEntry).not.toHaveBeenCalled();
});

it('shows a FILLED cancellation race as filled and refreshes current orders without touching TP',async()=>{
  const view=await open();vi.mocked(api.cancelEntry).mockResolvedValueOnce({status:'FILLED'});
  vi.mocked(api.orders).mockResolvedValueOnce({...active(),entry:[]});
  await view.find('tbody button').trigger('click');await flushPromises();
  expect(api.cancelEntry).toHaveBeenCalledExactlyOnceWith('local');expect(view.text()).toContain('取消前订单已成交，已读回 FILLED');
  expect(view.text()).toContain('交易所当前没有活动建仓委托');expect(store.refresh).toHaveBeenCalledExactlyOnceWith(['SNAPSHOT']);
});

it('preserves main\'s bounded history and older hidden count after fresh readback',async()=>{
  vi.mocked(api.orders).mockResolvedValueOnce({...active(),historicalUnknown:[{id:'recent',symbol:'ETHUSDT',side:'SHORT',quantity:1,status:'UNKNOWN',createdAt:1}],historicalUnknownWindow:{visibleCount:1,olderHiddenCount:7}});
  const view=await open();await view.findAll('button').find(button=>button.text().startsWith('历史未确认'))!.trigger('click');
  expect(view.text()).toContain('普通界面只显示最近24小时（1）');expect(view.text()).toContain('更早隐藏 7 条');
  expect(view.text()).toContain('ETHUSDT');expect(view.text()).toContain('非活动单 · 不可取消');
});

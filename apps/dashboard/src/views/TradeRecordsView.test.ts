// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {it,expect,vi} from 'vitest';
import TradeRecords from './TradeRecordsView.vue';
import {api} from '../api/client';
vi.mock('../api/client',()=>({api:{tradeRecords:vi.fn(),tradeRecords24h:vi.fn()}}));
it('keeps native 24h values separate, hides failed/stale facts and stops hidden/unmounted polling',async()=>{
 vi.useFakeTimers();let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 vi.mocked(api.tradeRecords).mockResolvedValue({items:[],summary:{counts:{}}});
 vi.mocked(api.tradeRecords24h).mockResolvedValue({asOf:Date.now(),byAsset:{USDT:{cycles:1,netExFunding:3},USDC:{cycles:1,netExFunding:-2}}});
 const w=mount(TradeRecords,{global:{stubs:{Panel:{template:'<div><slot/></div>'},EmptyState:true,StatusBadge:true}}});await flushPromises();
 expect(w.text()).toContain('3.00 USDT');expect(w.text()).toContain('-2.00 USDC');expect(w.text()).not.toContain('1.00 USD');
 hidden=true;await vi.advanceTimersByTimeAsync(90000);expect(api.tradeRecords24h).toHaveBeenCalledTimes(1);expect(w.text()).not.toContain('3.00 USDT');
 hidden=false;vi.mocked(api.tradeRecords24h).mockRejectedValue(new Error('503'));document.dispatchEvent(new Event('visibilitychange'));await flushPromises();
 expect(w.text()).toContain('503');expect(w.text()).not.toContain('3.00 USDT');w.unmount();await vi.advanceTimersByTimeAsync(90000);expect(api.tradeRecords24h).toHaveBeenCalledTimes(2);
 vi.useRealTimers();vi.restoreAllMocks();
});

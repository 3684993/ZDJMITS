// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {expect,it,vi} from 'vitest';
import View from './TradeRecordsView.vue';
import {api} from '../api/client';
vi.mock('../api/client',()=>({api:{tradeRecords:vi.fn(),tradeRecord:vi.fn(),tradeRecordSyncPreview:vi.fn(),tradeRecordSyncApply:vi.fn()}}));
it('loads ALL history read-only and preserves explicit category, side/status and symbol filters',async()=>{
 vi.mocked(api.tradeRecords).mockResolvedValue({items:[{tradeId:'avax-origin',symbol:'AVAXUSDT',direction:'SHORT',classification:'PARTIAL',status:'INCOMPLETE',openedAt:1,closedAt:null,observedClosedAt:3,entryQty:288,lifecycleDiagnostics:{lifecycleStatus:'OBSERVED_FLAT_AWAITING_LEDGER',quantity:{entryLotMismatch:true,retainedLotQuantity:1074}}}],total:1,page:1,limit:20,summary:{counts:{total:1,partial:1}}} as any);
 const wrapper=mount(View,{global:{stubs:{Panel:{template:'<section><slot/></section>'},StatusBadge:true}}});try{
  await flushPromises();expect(new URLSearchParams(vi.mocked(api.tradeRecords).mock.calls.at(-1)![0]).get('category')).toBe('ALL');expect(wrapper.text()).toContain('已观察零仓');expect(wrapper.text()).toContain('1074');expect(wrapper.text()).toContain('UNKNOWN');
  await wrapper.find('input[placeholder="Symbol"]').setValue('AVAXUSDT');await wrapper.findAll('select')[0]!.setValue('INCOMPLETE');await wrapper.findAll('select')[1]!.setValue('SHORT');await wrapper.findAll('button').find(b=>b.text()==='查询')!.trigger('click');await flushPromises();const q=new URLSearchParams(vi.mocked(api.tradeRecords).mock.calls.at(-1)![0]);expect(q.get('symbol')).toBe('AVAXUSDT');expect(q.get('direction')).toBe('SHORT');expect(q.get('status')).toBe('INCOMPLETE');
  await wrapper.findAll('button').find(b=>b.text().startsWith('部分事实'))!.trigger('click');await flushPromises();expect(new URLSearchParams(vi.mocked(api.tradeRecords).mock.calls.at(-1)![0]).get('category')).toBe('PARTIAL');expect(api.tradeRecordSyncApply).not.toHaveBeenCalled();expect(api.tradeRecordSyncPreview).not.toHaveBeenCalled();
 }finally{wrapper.unmount();}
});

// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {it,expect,vi} from 'vitest';
import Overview from './OverviewView.vue';
import {api} from '../api/client';
vi.mock('../stores/system',()=>({useSystemStore:()=>({snapshot:null,refresh:vi.fn()})}));
vi.mock('../api/client',()=>({api:{pipeline:vi.fn(),accountAssets:vi.fn()}}));
it('refreshes private readiness without reopening, coalesces slow reads and stops on unmount',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 let resolve!:(v:any)=>void;vi.mocked(api.pipeline).mockReturnValueOnce(new Promise(r=>resolve=r));vi.mocked(api.accountAssets).mockResolvedValue({assets:[]} as any);
 const wrapper=mount(Overview,{global:{stubs:{Panel:{template:'<div><slot/></div>'},StatusBadge:true}}});
 await vi.advanceTimersByTimeAsync(6000);expect(api.pipeline).toHaveBeenCalledTimes(1);
 resolve({asOf:1,binancePrivate:{status:'UNAVAILABLE'},runtimeControl:{mode:'RUNNING',reasonText:'旧状态'}});await flushPromises();
 vi.mocked(api.pipeline).mockResolvedValue({asOf:2,binancePrivate:{status:'READY'},runtimeControl:{mode:'RUNNING',reasonText:'私有数据已恢复'}} as any);
 await vi.advanceTimersByTimeAsync(3000);await flushPromises();expect(wrapper.text()).toContain('私有数据已恢复');
 wrapper.unmount();await vi.advanceTimersByTimeAsync(6000);expect(api.pipeline).toHaveBeenCalledTimes(2);vi.useRealTimers();vi.restoreAllMocks();
});

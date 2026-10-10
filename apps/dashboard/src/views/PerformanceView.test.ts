// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import PerformanceView from './PerformanceView.vue';
import {api,brainRuns} from '../api/client';
vi.mock('../stores/system',()=>({useSystemStore:()=>({snapshot:{account:{status:'READY',asOf:100000},positions:[],localAccounting:{exFundingNet:123.45,confirmedAllInNet:987.65}},incidents:{active:[]}})}));
vi.mock('../api/client',()=>({api:{performanceHost:vi.fn(),performanceGpu:vi.fn(),brainResources:vi.fn(),binanceGovernance:vi.fn(),privateSync:vi.fn(),marketStreamTraffic:vi.fn()},brainRuns:vi.fn()}));
const host={asOf:100000,instanceId:'test',ttlMs:30000,source:'NODE_OS_CPU_TIMES_AND_MEMORY',cpu:{usagePct:42},memory:{usedBytes:100,totalBytes:200,freeBytes:100},engine:{pid:1,rssBytes:1,heapUsedBytes:1},history:[]};
const mountView=()=>mount(PerformanceView,{global:{stubs:{Panel:{template:'<div><slot/></div>'},PerformanceTrend:true,RouterLink:{template:'<a><slot/></a>'}}}});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(100000);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.mocked(api.performanceHost).mockResolvedValue(host as any);vi.mocked(api.performanceGpu).mockResolvedValue({services:[],history:[]} as any);vi.mocked(api.brainResources).mockResolvedValue([{id:'primary',connectionStatus:'ONLINE',healthCheckedAt:100000,active:0}]);vi.mocked(api.binanceGovernance).mockResolvedValue({routes:[]});vi.mocked(api.privateSync).mockResolvedValue({});vi.mocked(api.marketStreamTraffic).mockResolvedValue({});vi.mocked(brainRuns).mockResolvedValue({items:[]});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
it('renders real sources, clears failed live facts and never mixes untyped currency totals',async()=>{
 const w=mountView();await flushPromises();expect(w.text()).toContain('42.0');expect(w.text()).not.toContain('123.45');expect(w.text()).not.toContain('987.65');
 vi.mocked(api.performanceHost).mockRejectedValue(new Error('offline'));vi.mocked(api.brainResources).mockRejectedValue(new Error('offline'));
 await vi.advanceTimersByTimeAsync(15000);await flushPromises();expect(w.text()).not.toContain('42.0');expect(w.text()).not.toContain('绿 · 空闲');w.unmount();
});
it('does not poll hidden pages, aborts on unmount, masks stale metrics',async()=>{
 vi.mocked(api.performanceHost).mockResolvedValue({...host,asOf:1} as any);
 const w=mountView();await flushPromises();expect(w.text()).not.toContain('42.0');
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await vi.advanceTimersByTimeAsync(60000);expect(api.performanceHost).toHaveBeenCalledTimes(1);
 w.unmount();await vi.advanceTimersByTimeAsync(60000);expect(api.performanceHost).toHaveBeenCalledTimes(1);
});

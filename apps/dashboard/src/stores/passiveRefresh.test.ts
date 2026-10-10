// @vitest-environment jsdom
import {createPinia,setActivePinia} from 'pinia';
import {it,expect,vi} from 'vitest';
import {useSystemStore} from './system';
import {api} from '../api/client';
let event:(e:any)=>void=()=>{};
vi.mock('../api/realtime',()=>({connectRealtime:vi.fn((callback:any)=>{event=callback;return ()=>{};})}));
vi.mock('../api/client',()=>({api:{snapshot:vi.fn(),operationalIncidents:vi.fn(),universe:vi.fn()},residentPosition:vi.fn()}));
it('coalesces event storms and periodic reads, pauses hidden tabs, while explicit refresh stays immediate',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);setActivePinia(createPinia());
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 vi.mocked(api.snapshot).mockResolvedValue({ts:100000,account:{equityUsd:null},universe:{generation:1}} as any);
 vi.mocked(api.operationalIncidents).mockResolvedValue({active:[],history:[]});
 const store=useSystemStore();await store.refresh(['SNAPSHOT']);store.startRealtime();
 for(let i=0;i<100;i++)event({domains:['SNAPSHOT']});await store.refreshPassive();
 expect(api.snapshot).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(15000);expect(api.snapshot).toHaveBeenCalledTimes(2);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');event({domains:['SNAPSHOT']});
 await vi.advanceTimersByTimeAsync(30000);expect(api.snapshot).toHaveBeenCalledTimes(2);
 await store.refresh(['SNAPSHOT']);expect(api.snapshot).toHaveBeenCalledTimes(3);
 store.stopRealtime();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();
});

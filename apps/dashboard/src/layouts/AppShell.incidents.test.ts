// @vitest-environment jsdom
import {mount} from '@vue/test-utils';
import {nextTick,reactive} from 'vue';
import {expect,it,vi} from 'vitest';
import AppShell from './AppShell.vue';

const state=reactive({connected:true,error:null as string|null,snapshot:{settings:{connections:{exchange:{environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}}},incidents:{active:[] as any[],history:[] as any[]},refresh:vi.fn(async()=>{}),startRealtime:vi.fn(),stopRealtime:vi.fn()});
vi.mock('../stores/system',()=>({useSystemStore:()=>state}));
vi.mock('vue-router',async importOriginal=>({...await importOriginal<typeof import('vue-router')>(),useRoute:()=>({name:'overview'})}));

it('shows one global active incident with code and remedy, then removes it on recovery',async()=>{
  state.incidents.active=[{incidentId:'incident-1',active:true,publicCode:'NET-001',titleZh:'VPN或网络错误',messageZh:'无法连接 Binance',remediationZh:'检查 VPN 和网络',blockingScopes:['NEW_ENTRY'],sourceCode:'ECONNRESET',sourceMessage:'ECONNRESET',lastSeenAt:1000,firstSeenAt:1000,count:1}];
  const wrapper=mount(AppShell,{global:{stubs:{RouterLink:{template:'<a><slot/></a>'},RouterView:{template:'<div/>'}}}});
  await nextTick();
  expect(wrapper.find('[role="alert"].incident-banner').text()).toContain('NET-001');
  expect(wrapper.find('[role="alert"].incident-banner').text()).toContain('检查 VPN 和网络');
  state.incidents.active=[];await nextTick();
  expect(wrapper.find('[role="alert"].incident-banner').exists()).toBe(false);
  wrapper.unmount();
});

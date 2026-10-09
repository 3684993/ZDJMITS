// @vitest-environment jsdom
import {mount,flushPromises} from '@vue/test-utils';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import Settings from './SettingsView.vue';
import {api} from '../api/client';

const defaults=JSON.parse(readFileSync(path.resolve(process.cwd(),'../../config/settings.default.json'),'utf8'));
const proxy=[{id:'binance-proxy',name:'默认代理',type:'SOCKS5H',url:'socks5h://127.0.0.1:20081',enabled:true,active:true,status:'ACTIVE'}];
const exchange=[{id:'binance-usdm',name:'Binance USD-M',type:'BINANCE_USDM',environment:'TESTNET',executionMode:'TESTNET_ENABLED',restBaseUrl:'https://demo-fapi.binance.com',wsBaseUrl:'wss://stream.binancefuture.com/ws',credentialRef:'binance-primary',enabled:true,active:true,status:'READY'}];
const ai=[{id:'primary',name:'Primary',role:'PRIMARY_BRAIN',baseUrl:'http://127.0.0.1:8084/v1',model:'qwen',maxConcurrency:1,gpu:'GPU',enabled:true,status:'ONLINE',duties:['ENTRY_PRIMARY']}];

vi.mock('../api/client',()=>({
  api:{
    settings:vi.fn(),connections:vi.fn(),resources:vi.fn(),aiDutyRoutes:vi.fn(),governanceSettings:vi.fn(),
    saveSettings:vi.fn(),saveResource:vi.fn(),deleteResource:vi.fn(),activateResource:vi.fn(),testResource:vi.fn(),
    saveAiDutyRoutes:vi.fn(),saveGovernanceFields:vi.fn(),proxyPassiveHealth:vi.fn(),
  },
  saveExchangeCredentials:vi.fn(),testPrivateCredentials:vi.fn(),
}));

const mounted:ReturnType<typeof mount>[]=[];
afterEach(()=>{for(const wrapper of mounted.splice(0))wrapper.unmount();vi.useRealTimers();});
async function open(){
  const wrapper=mount(Settings,{global:{stubs:{Panel:{template:'<section><slot/></section>'},EmptyState:{props:['title','detail'],template:'<div>{{title}} {{detail}}</div>'}}}});
  mounted.push(wrapper);await flushPromises();return wrapper;
}
const tabButton=(w:any,label:string)=>w.findAll('button').find((b:any)=>b.text().trim()===label)!;

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(api.settings).mockResolvedValue(structuredClone(defaults));
  vi.mocked(api.connections).mockResolvedValue({credentials:{configured:true}} as never);
  vi.mocked(api.resources).mockImplementation(async(kind:string)=>({settingsVersion:1,items:structuredClone(kind==='proxy'?proxy:kind==='exchange'?exchange:ai)}) as never);
  vi.mocked(api.aiDutyRoutes).mockResolvedValue({settingsVersion:1,routes:defaults.aiDutyRoutes??[],resources:ai} as never);
  vi.mocked(api.governanceSettings).mockResolvedValue({settingsVersion:1,fields:[]} as never);
  vi.mocked(api.saveSettings).mockImplementation(async(x:any)=>x);
  vi.mocked(api.proxyPassiveHealth).mockResolvedValue({status:'RECENT_BINANCE_SUCCESS',queueDepth:0} as never);
});

it('polls existing evidence only while proxy tab is open and stops after unmount without a real probe',async()=>{
  vi.useFakeTimers();
  const w=await open();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.proxyPassiveHealth).not.toHaveBeenCalled();
  await tabButton(w,'网络代理').trigger('click');await flushPromises();
  expect(api.proxyPassiveHealth).toHaveBeenCalledTimes(1);
  expect(w.text()).toContain('最近已通过代理访问币安');
  await vi.advanceTimersByTimeAsync(30_000);await flushPromises();
  expect(api.proxyPassiveHealth).toHaveBeenCalledTimes(2);
  expect(api.testResource).not.toHaveBeenCalled();
  await tabButton(w,'交易所').trigger('click');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.proxyPassiveHealth).toHaveBeenCalledTimes(2);
  w.unmount();mounted.splice(mounted.indexOf(w),1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(api.proxyPassiveHealth).toHaveBeenCalledTimes(2);
});

it('adds a new proxy draft without replacing the existing proxy resource',async()=>{
  const w=await open();await tabButton(w,'网络代理').trigger('click');await flushPromises();
  expect(w.findAll('.resource-card')).toHaveLength(1);expect(w.text()).toContain('默认代理');
  await w.findAll('button').find((b:any)=>b.text().includes('新增代理'))!.trigger('click');await flushPromises();
  expect(w.findAll('.resource-card')).toHaveLength(2);expect(w.text()).toContain('默认代理');expect(w.text()).toContain('新代理');
  expect(w.text()).toContain('编辑 → 保存 → 测试 → 激活');
});

it('uses global save only on ordinary parameter tabs and independent actions on managed resource tabs',async()=>{
  const w=await open();
  expect(w.text()).toContain('保存当前参数');expect(w.text()).toContain('取消未保存修改');
  await tabButton(w,'交易所').trigger('click');await flushPromises();
  expect(w.text()).not.toContain('保存当前参数');expect(w.text()).toContain('保存资源');expect(w.text()).toContain('测试连接');
  await tabButton(w,'网络代理').trigger('click');await flushPromises();
  expect(w.text()).toContain('设为活动');expect(w.text()).toContain('删除');
  await tabButton(w,'AI 模型资源').trigger('click');await flushPromises();
  expect(w.text()).toContain('新增空白资源');expect(w.text()).toContain('保存资源');expect(w.text()).toContain('取消修改');
  expect(w.text()).toContain('候选 Scout 异步观察');expect(w.text()).toContain('保存工作负载策略');
});

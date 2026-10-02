import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {SystemSettingsSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

async function harness(){
  const raw=JSON.parse(await readFile(path.resolve(process.cwd(),'../..','config/settings.default.json'),'utf8'));
  raw.appearance={...raw.appearance,theme:'BINANCE_NOIR'};
  raw.externalIntelligence={...raw.externalIntelligence,researchEnabled:false};
  raw.ai={...raw.ai,scoutEnabled:true};
  raw.aiResources=raw.aiResources.map((resource:any)=>resource.role==='SCOUT'?{...resource,enabled:true}:resource);
  const state=new RuntimeState(SystemSettingsSchema.parse(raw));state.aiResources=loadAiResources(state.settings);
  const ai=new AiFabric(state,new EventBus(),{} as any);
  return{state,ai};
}

describe('dual-model runtime state',()=>{
  it('probes enabled Scout and Primary resources',async()=>{
    const {ai,state}=await harness();const primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!;const scout=state.aiResources.find(r=>r.role==='SCOUT')!;
    const probe=vi.spyOn((ai as any).openAi,'probe').mockImplementation(async(..._args:any[])=>({ok:true,reason:null}));
    await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);expect(ai.hasCapacity('SCOUT')).toBe(true);
    expect(state.aiResources.filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(ai.resourceMetrics().filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(probe.mock.calls.map(([url]:any[])=>url)).toEqual([scout.baseUrl,primary.baseUrl]);
    expect(probe).toHaveBeenCalledWith(scout.baseUrl,2000,scout.model);
    expect(probe).toHaveBeenCalledWith(primary.baseUrl,2000,primary.model);
    probe.mockResolvedValue({ok:false,reason:'offline'});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(false);
    expect(ai.resourceMetrics().find(r=>r.role==='PRIMARY_BRAIN')).toMatchObject({idleReason:'PRIMARY_MODEL_OFFLINE'});
    probe.mockResolvedValue({ok:true,reason:null});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
  });
  it('surfaces Scout when shared research duties are enabled',async()=>{
    const {state,ai}=await harness();state.settings.externalIntelligence.researchEnabled=true;
    ai.setResearchQueue(3);
    expect(state.aiResources.filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(ai.resourceMetrics().filter(r=>r.role==='SCOUT')).toHaveLength(1);
  });

  it('uses model-list health for the idle LM Studio Scout while preserving oMLX Primary probing',async()=>{
    const {state,ai}=await harness();
    const scout=state.aiResources.find(r=>r.role==='SCOUT')!,primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!;
    scout.baseUrl='http://127.0.0.1:1234/v1';scout.model='qwen/qwen3.5-9b';
    primary.baseUrl='http://127.0.0.1:8083/v1';primary.model='Qwen3.8-27B-4bit';
    let listed=true;
    const fetch=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url==='http://127.0.0.1:1234/v1/models')return new Response(JSON.stringify({object:'list',data:listed?[{id:scout.model,object:'model'}]:[]}));
      if(url==='http://127.0.0.1:8083/health')return new Response('ok');
      if(url==='http://127.0.0.1:8083/props')return new Response(JSON.stringify({model_alias:primary.model}));
      throw new Error(`UNEXPECTED_REQUEST:${url}`);
    });
    vi.stubGlobal('fetch',fetch);
    await ai.probeResources();
    expect(ai.resourceMetrics().find(r=>r.id===scout.id)).toMatchObject({connectionStatus:'ONLINE',totalRuns:0,active:0});
    expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
    listed=false;await ai.probeResources();
    expect(ai.hasCapacity('SCOUT')).toBe(false);
    expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
    expect(ai.resourceMetrics().find(r=>r.id===scout.id)?.healthReason).toContain(scout.model);
    expect(fetch.mock.calls.map(([url])=>String(url))).not.toContain('http://127.0.0.1:1234/health');
    expect(fetch.mock.calls.map(([url])=>String(url))).not.toContain('http://127.0.0.1:1234/props');
    expect(fetch.mock.calls.every(([url])=>!String(url).includes('/chat/completions'))).toBe(true);
  });

  it('passes the current Primary model into the circuit recovery probe',async()=>{
    const {state,ai}=await harness(),primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!;
    const probe=vi.spyOn((ai as any).openAi,'probe').mockResolvedValue({ok:true,identity:null,reason:null});
    for(let i=0;i<3;i++)(ai as any).recordPrimaryFailure('AI_TIMEOUT');
    expect(await ai.probePrimaryIfDue(Date.now()+31_000)).toBe(true);
    expect(probe).toHaveBeenCalledExactlyOnceWith(primary.baseUrl,2000,primary.model);
    expect(ai.circuitStatus().state).toBe('HALF_OPEN');
  });
});

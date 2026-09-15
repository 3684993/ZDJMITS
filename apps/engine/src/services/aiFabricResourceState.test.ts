import {describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {SystemSettingsSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';

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
});

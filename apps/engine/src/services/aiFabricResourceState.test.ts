import {describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {SystemSettingsSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';

async function harness(scoutConfigured=false){
  const raw=JSON.parse(await readFile(path.resolve(process.cwd(),'../..','config/settings.default.json'),'utf8'));
  raw.appearance={...raw.appearance,theme:'BINANCE_NOIR'};
  raw.externalIntelligence={...raw.externalIntelligence,researchEnabled:false};
  raw.ai={...raw.ai,scoutEnabled:scoutConfigured};
  if(scoutConfigured)raw.aiResources=raw.aiResources.map((resource:any)=>resource.role==='SCOUT'?{...resource,enabled:true}:resource);
  const state=new RuntimeState(SystemSettingsSchema.parse(raw));state.aiResources=loadAiResources(state.settings);
  const ai=new AiFabric(state,new EventBus(),{} as any);
  return{state,ai};
}

describe('9B research duty state',()=>{
  it('probes idle models independently and supports only Primary being online',async()=>{
    const {ai,state}=await harness(true);const primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!;
    const probe=vi.spyOn((ai as any).openAi,'probe').mockImplementation(async(...args:any[])=>({ok:args[0]===primary.baseUrl,reason:args[0]===primary.baseUrl?null:'connection refused'}));
    await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);expect(ai.hasCapacity('SCOUT')).toBe(false);
    expect(ai.resourceMetrics().find(r=>r.role==='SCOUT')).toMatchObject({connectionStatus:'OFFLINE',status:'OFFLINE'});
    probe.mockResolvedValue({ok:false,reason:'offline'});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(false);
    expect(ai.resourceMetrics().find(r=>r.role==='PRIMARY_BRAIN')).toMatchObject({idleReason:'PRIMARY_MODEL_OFFLINE'});
    probe.mockResolvedValue({ok:true,reason:null});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
  });
  it('reports disabled truthfully and never inherits Primary candidate cooldown',async()=>{
    const {ai}=await harness(true);ai.setIdleContext('候选冷却',7,'等待候选冷却结束');
    const scout=ai.resourceMetrics().find(x=>x.role==='SCOUT')!;
    expect(scout).toMatchObject({currentStatus:'DISABLED',idleReason:'DISABLED',queueDepth:0,totalRuns:0});
    expect(scout.nextStep).toBe('研究职责未启用');
  });
  it('uses exact waiting and queued states when research is enabled',async()=>{
    const {state,ai}=await harness(true);state.settings.externalIntelligence.researchEnabled=true;
    expect(ai.resourceMetrics().find(x=>x.role==='SCOUT')).toMatchObject({currentStatus:'WAITING_SHARED_EVENT',idleReason:'WAITING_SHARED_EVENT'});
    ai.setResearchQueue(3);
    expect(ai.resourceMetrics().find(x=>x.role==='SCOUT')).toMatchObject({currentStatus:'QUEUED',idleReason:'QUEUED',queueDepth:3});
  });
});

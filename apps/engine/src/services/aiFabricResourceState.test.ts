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
  raw.aiDutyRoutes=(raw.aiDutyRoutes??[]).map((route:any)=>route.duty==='SCOUT_RESEARCH'?{...route,enabled:true}:route);
  const state=new RuntimeState(SystemSettingsSchema.parse(raw));state.aiResources=loadAiResources(state.settings);
  const ai=new AiFabric(state,new EventBus(),{} as any);
  return{state,ai};
}

describe('dual-model runtime state',()=>{
  it('probes enabled Scout and Primary resources',async()=>{
    const {ai,state}=await harness();const primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!;const scout=state.aiResources.find(r=>r.role==='SCOUT')!;const review=state.aiResources.find(r=>r.role==='REVIEW_BRAIN')!;
    const probe=vi.spyOn((ai as any).openAi,'probe').mockImplementation(async(..._args:any[])=>({ok:true,reason:null}));
    await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);expect(ai.hasCapacity('SCOUT')).toBe(true);
    expect(state.aiResources.filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(ai.resourceMetrics().filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(probe.mock.calls.map(([url]:any[])=>url)).toEqual([scout.baseUrl,primary.baseUrl,review.baseUrl]);
    probe.mockResolvedValue({ok:false,reason:'offline'});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
    await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
    await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(false);
    expect(ai.resourceMetrics().find(r=>r.role==='PRIMARY_BRAIN')).toMatchObject({idleReason:'PRIMARY_MODEL_OFFLINE'});
    probe.mockResolvedValue({ok:true,reason:null});await ai.probeResources();expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
  });
  it('keeps the first physical-service release at one slot even with parallel resource configuration',async()=>{
    const {state,ai}=await harness(),primary=state.settings.aiResources.find((r:any)=>r.role==='PRIMARY_BRAIN')!;
    const review={id:'review-parallel',name:'GPU2 Review',role:'REVIEW_BRAIN',enabled:true,baseUrl:'http://127.0.0.1:8083/v1',model:'qwen/qwen3.8-27b',maxConcurrency:2,gpu:'RX 7900 XTX #2'};
    state.settings.aiResources.push(review as any);state.aiResources=loadAiResources(state.settings);(ai as any).load.set(review.id,{active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'wait',queueDepth:0});
    state.settings.aiDutyRoutes=[{duty:'ENTRY_PRIMARY',resourceId:primary.id,enabled:true,priority:100},{duty:'PENDING_ENTRY_REVIEW',resourceId:review.id,enabled:true,priority:20},{duty:'POSITION_REVIEW',resourceId:review.id,enabled:true,priority:90}] as any;
    (ai as any).endpointHealth.set(review.id,{available:true,checkedAt:Date.now(),reason:null});
    let active=0,maxActive=0,release!:(v?:unknown)=>void;const gate=new Promise(resolve=>{release=resolve;});
    const work=async()=>{active++;maxActive=Math.max(maxActive,active);await gate;active--;return true;};
    const a=(ai as any).queueReview('POSITION_REVIEW',work),b=(ai as any).queueReview('PENDING_ENTRY_REVIEW',work);
    await vi.waitFor(()=>expect(maxActive).toBe(1));release();await Promise.all([a,b]);
    expect(maxActive).toBe(1);
  });
  it('shows candidate Scout waiting truth instead of shared-event-only idle text',async()=>{
    const {state,ai}=await harness();state.settings.externalIntelligence.researchEnabled=false;state.settings.ai.scoutEnabled=true;
    expect(ai.resourceMetrics().find(r=>r.role==='SCOUT')).toMatchObject({currentStatus:'WAITING_CANDIDATE',nextStep:'等待动态交易池候选'});
    state.settings.externalIntelligence.researchEnabled=true;
    expect(ai.resourceMetrics().find(r=>r.role==='SCOUT')).toMatchObject({currentStatus:'WAITING_CANDIDATE_OR_SHARED_EVENT'});
  });
  it('surfaces Scout when shared research duties are enabled',async()=>{
    const {state,ai}=await harness();state.settings.externalIntelligence.researchEnabled=true;
    ai.setResearchQueue(3);
    expect(state.aiResources.filter(r=>r.role==='SCOUT')).toHaveLength(1);
    expect(ai.resourceMetrics().filter(r=>r.role==='SCOUT')).toHaveLength(1);
  });
  it('keeps GPU2 review duties isolated from GPU1 Entry Primary when the reviewer is offline',async()=>{
    const {state,ai}=await harness(),primary=state.settings.aiResources.find((r:any)=>r.role==='PRIMARY_BRAIN')!;
    const review={id:'review-gpu2',name:'GPU2 27B Reviewer',role:'REVIEW_BRAIN',enabled:true,baseUrl:'http://127.0.0.1:8083/v1',model:'qwen/qwen3.8-27b',maxConcurrency:1,gpu:'RX 7900 XTX #2'};
    state.settings.aiResources.push(review as any);state.aiResources=loadAiResources(state.settings);(ai as any).load.set(review.id,{active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'wait',queueDepth:0});
    state.settings.aiDutyRoutes=[{duty:'ENTRY_PRIMARY',resourceId:primary.id,enabled:true,priority:100},{duty:'PENDING_ENTRY_REVIEW',resourceId:review.id,enabled:true,priority:20},{duty:'POSITION_REVIEW',resourceId:review.id,enabled:true,priority:90}] as any;
    (ai as any).endpointHealth.set(review.id,{available:false,checkedAt:Date.now(),reason:'offline'});
    expect(ai.reviewAvailable('PENDING_ENTRY_REVIEW')).toBe(false);
    expect(ai.reviewAvailable('POSITION_REVIEW')).toBe(false);
    expect(ai.hasCapacity('PRIMARY_BRAIN')).toBe(true);
    expect((ai as any).dutyResource('ENTRY_PRIMARY')?.id).toBe(primary.id);
    expect((ai as any).dutyResource('POSITION_REVIEW')).toBeUndefined();
    (ai as any).endpointHealth.set(review.id,{available:true,checkedAt:Date.now(),reason:null});
    const lease=(ai as any).capacity.tryAcquire(state.aiResources.find(r=>r.id===review.id));const order:string[]=[];
    const pending=(ai as any).queueReview('PENDING_ENTRY_REVIEW',async()=>{order.push('PENDING_ENTRY_REVIEW');return'pending';});
    const position=(ai as any).queueReview('POSITION_REVIEW',async()=>{order.push('POSITION_REVIEW');return'position';});
    lease.release();(ai as any).pumpReviewQueue(review.id);
    await expect(position).resolves.toBe('position');await expect(pending).resolves.toBe('pending');
    expect(order).toEqual(['POSITION_REVIEW','PENDING_ENTRY_REVIEW']);
  });
});

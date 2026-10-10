import {it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {SystemSettingsSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';
async function harness(){const settings=SystemSettingsSchema.parse(JSON.parse(await readFile(path.resolve('../../config/settings.default.json'),'utf8')));const state=new RuntimeState(settings);state.aiResources=loadAiResources(settings);return {state,ai:new AiFabric(state,new EventBus(),{} as any)};}
it('one server alias cannot run Primary and queued Review at the same time',async()=>{
 const {ai,state}=await harness();const primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!,review=state.aiResources.find(r=>r.role==='REVIEW_BRAIN')!;review.baseUrl=primary.baseUrl.replace('127.0.0.1','localhost')+'/';
 let release!:()=>void,active=0,max=0;const gate=new Promise<void>(resolve=>release=resolve);
 vi.spyOn((ai as any).openAi,'runJson').mockImplementation(async()=>{active++;max=Math.max(max,active);await gate;active--;return {value:{},raw:{},inputTokens:1,outputTokens:1,finishReason:'stop',modelIdentity:null,timing:{queueMs:0,promptBuildMs:0,requestMs:1,retryMs:0,parseMs:0}};});
 const p=(ai as any).run({resource:primary,role:'PRIMARY_BRAIN',symbol:'TESTUSDT',packet:{createdAt:Date.now(),packetId:'fixture'},prompt:'offline',schemaName:'fixture',parse:(v:any)=>v});
 const r=(ai as any).queueReview('POSITION_REVIEW',async()=>{active++;max=Math.max(max,active);active--;return true;});
 await Promise.resolve();try{expect(max).toBe(1);}finally{release();await Promise.all([p,r]);}expect(max).toBe(1);
});
it('releases on model timeout and rejects expired/cancelled work before dispatch',async()=>{
 const {ai,state}=await harness();const primary=state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')!,review=state.aiResources.find(r=>r.role==='REVIEW_BRAIN')!;
 vi.spyOn((ai as any).openAi,'runJson').mockRejectedValue(new Error('timeout'));
 await expect((ai as any).run({resource:primary,role:'PRIMARY_BRAIN',symbol:'TESTUSDT',packet:{createdAt:Date.now(),packetId:'fixture'},prompt:'offline',schemaName:'fixture',parse:(v:any)=>v})).rejects.toThrow('timeout');
 expect((ai as any).capacity.activeCount(primary)).toBe(0);
 const work=vi.fn();await expect((ai as any).queueReview('POSITION_REVIEW',work,{expiresAt:Date.now()-1})).rejects.toThrow('EXPIRED');
 const controller=new AbortController();controller.abort();await expect((ai as any).queueReview('POSITION_REVIEW',work,{signal:controller.signal})).rejects.toThrow('CANCELLED');expect(work).not.toHaveBeenCalled();expect((ai as any).capacity.activeCount(review)).toBe(0);
});
it('deduplicates queued requests and cancellation never releases somebody else’s slot',async()=>{
 const {ai,state}=await harness();const review=state.aiResources.find(r=>r.role==='REVIEW_BRAIN')!;
 const lease=(ai as any).capacity.tryAcquire(review),controller=new AbortController(),work=vi.fn();
 const queued=(ai as any).queueReview('POSITION_REVIEW',work,{requestKey:'same-origin',signal:controller.signal});
 const rejection=expect(queued).rejects.toThrow('CANCELLED');
 await expect((ai as any).queueReview('POSITION_REVIEW',work,{requestKey:'same-origin'})).rejects.toThrow('DUPLICATE');
 controller.abort();await rejection;expect(work).not.toHaveBeenCalled();expect((ai as any).capacity.activeCount(review)).toBe(1);
 lease.release();expect((ai as any).capacity.activeCount(review)).toBe(0);
});

import { describe, expect, it } from 'vitest';
import { RuntimeState } from '../state/runtimeState.js';
import { ShadowReadinessService } from './shadowReadiness.js';
import type { SystemSettings } from '@zdj/contracts';

const settings={} as SystemSettings;
describe('ShadowReadinessService',()=>{
  it('classifies complete and incomplete samples without changing control state',()=>{
    const state=new RuntimeState(settings);state.account.asOf=Date.now();const service=new ShadowReadinessService(state,{runtimeEvents:()=>[]} as any);
    const good=service.classify({id:'e1',type:'SHADOW_SAMPLE_RECORDED',ts:1000,payload:{decisionChainId:'c1',decisionSnapshot:{snapshotId:'s1',marketSnapshotId:'m1',portfolioSnapshotId:'p1',settingsVersion:1,capitalSnapshotId:'c1',exposureSnapshotId:'r1'},dataQuality:{status:'GOOD'},riskEnvelope:{status:'PASS'}}});
    const bad=service.classify({id:'e2',type:'SHADOW_SAMPLE_RECORDED',ts:2000,payload:{decisionChainId:'c2',decisionSnapshot:{snapshotId:'s2'},dataQuality:{status:'UNTRUSTED',reasons:['QUOTE_INVALID']}}});
    expect(good.classification).toBe('VALID');expect(bad.classification).toBe('INVALID_CHAIN_INCOMPLETE');expect(state.runtimeControl.autoResume).toBe(true);
  });
  it('reports a completed period as manual review only',()=>{
    const state=new RuntimeState(settings);state.shadowRunner={...state.shadowRunner,status:'RUNNING',startAt:Date.now()-8*24*60*60_000,requiredUntil:Date.now()-1,samples:0};
    const p=new ShadowReadinessService(state,{runtimeEvents:()=>[]} as any).readiness();expect(p.status).toBe('SHADOW_READY');expect(p.autoResume).toBe(false);expect(p.automaticResumeAllowed).toBe(false);
  });
});

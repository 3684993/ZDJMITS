import {it,expect,vi} from 'vitest';
import {TpTargetShadow,type TpTargetShadowFacts} from './tpTargetShadow.js';
const facts=():TpTargetShadowFacts=>({scopeHash:'a'.repeat(64),cycleId:'offline',planId:'frozen-plan',planVersion:1,ownerVersion:1,owner:'AI_MANAGED',side:'LONG',positionQuantity:2,entryPrice:100,signedAt:100000,expiresAt:160000,factsVersion:'closed-bar-v1',tpIdentityHash:'b'.repeat(64),tpProtected:true,tpRemainingQuantity:2,currentTarget:110,authorizedRange:{min:105,max:115},candidates:[{id:'frozen-target',price:108,planId:'frozen-plan',planVersion:1,tickAligned:true,netAfterCosts:14,requiredNet:10,evidenceRefs:['closed-15m']}]});
const answer={decision:'SELECT_CANDIDATE',candidateId:'frozen-target',evidenceRefs:['closed-15m'],summary:'offline fixture'};
it('only compares a frozen target and produces no exchange or ownership capability',async()=>{
 const f=facts(),review=vi.fn().mockResolvedValue(answer),s=new TpTargetShadow({now:()=>100100,facts:()=>f,review});const before=structuredClone(f);
 expect(await s.run()).toMatchObject({usable:true,targetDelta:-2,exchangeWrites:0,entryPermission:false,protectionChanged:false});expect(f).toEqual(before);expect(await s.run()).toMatchObject({reason:'DUPLICATE_FACTS'});expect(review).toHaveBeenCalledTimes(1);
});
it('fails closed on free price/quantity, invented candidate or unbound evidence',async()=>{
 for(const output of [{...answer,price:107},{...answer,quantity:4},{...answer,candidateId:'invented'},{...answer,evidenceRefs:['fake']},{...answer,decision:'KEEP'}]){
  const s=new TpTargetShadow({now:()=>100100,facts,review:async()=>output});expect(await s.run()).toMatchObject({usable:false,exchangeWrites:0});
 }
});
it('does not invoke Review for human ownership, stale signatures, undercoverage or illegal economics',async()=>{
 for(const change of [{owner:'HUMAN_MANAGED'},{signedAt:1},{tpRemainingQuantity:1},{candidates:[{...facts().candidates[0],netAfterCosts:2}]}]){
  const review=vi.fn(),s=new TpTargetShadow({now:()=>100100,facts:()=>({...facts(),...change}),review});expect(await s.run()).toMatchObject({usable:false,exchangeWrites:0});expect(review).not.toHaveBeenCalled();
 }
});
it('rejects late owner/plan/identity changes and deduplicates concurrent same facts',async()=>{
 let f=facts(),finish!:(v:unknown)=>void;const review=vi.fn(()=>new Promise(r=>finish=r));const s=new TpTargetShadow({now:()=>100100,facts:()=>f,review});const first=s.run();expect(await s.run()).toMatchObject({reason:'DUPLICATE_FACTS'});f={...f,ownerVersion:2};finish(answer);expect(await first).toMatchObject({usable:false,reason:'FACTS_OR_OWNER_CHANGED',exchangeWrites:0});
});

import {describe,expect,it,vi} from 'vitest';
import {PositionReviewScheduler} from './positionReviewScheduler.js';

const versions={planVersion:1,planRef:'plan-1',ownerVersion:7,positionVersion:10,settingsVersion:3,riskGeneration:1,
  snapshotHash:'snap',evidenceVersion:'bars-v1',memoryVersion:'memory-v1'};

describe('human-managed position review evidence',()=>{
  it('permits review-only tickets without granting AI execution authority',()=>{
    const ownerOf=vi.fn(()=>({ownerState:'HUMAN_MANAGED',ownerVersion:7,deadline:null,reviewEligible:true}));
    const scheduler=new PositionReviewScheduler({ledger:{record:vi.fn(()=>({written:true,row:{}}))} as any,
      settings:()=>({normalReviewsPerPlan:2,exceptionReviewsPerPlan:1,failureBudget:2,minIntervalMs:1_000,authorityTtlMs:30_000}),ownerOf});
    const reserved=scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions,trigger:'SCHEDULED',now:100_000});
    expect(reserved.granted).toBe(true);
    if(!reserved.granted)return;
    expect(reserved.ticket.reviewOnly).toBe(true);
    expect(ownerOf).toHaveBeenCalled();
    const accepted=scheduler.accept(reserved.ticket,{now:101_000,usage:{inputTokens:10,outputTokens:5},status:'COMPLETED',
      modelIdentity:'qwen-review',promptHash:'hash'});
    expect(accepted).toMatchObject({usable:true,reason:'REVIEW_RESULT_APPLICABLE'});
  });
});

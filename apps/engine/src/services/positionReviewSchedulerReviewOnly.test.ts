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
  it('renews advisory review capacity on the configured dedicated-resource interval',()=>{
    const scheduler=new PositionReviewScheduler({ledger:{record:vi.fn((row:any)=>({written:true,row}))} as any,
      settings:()=>({normalReviewsPerPlan:1,exceptionReviewsPerPlan:0,failureBudget:2,minIntervalMs:1_000,authorityTtlMs:30_000,renewalMs:60_000}),
      ownerOf:()=>({ownerState:'HUMAN_MANAGED',ownerVersion:7,deadline:null,reviewEligible:true})});
    const first=scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions,trigger:'SCHEDULED',now:100_000});
    expect(first.granted).toBe(true);if(!first.granted)return;
    scheduler.accept(first.ticket,{now:101_000,usage:{inputTokens:10,outputTokens:5},status:'COMPLETED',modelIdentity:'review',promptHash:'h'});
    expect(scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions:{...versions,evidenceVersion:'bars-v2'},trigger:'SCHEDULED',now:150_000}).granted).toBe(false);
    expect(scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions:{...versions,evidenceVersion:'bars-v3'},trigger:'SCHEDULED',now:161_001}).granted).toBe(true);
  });
  it('archives a pre-model failure without exhausting the model failure budget',()=>{
    const recorded:any[]=[];
    const scheduler=new PositionReviewScheduler({ledger:{record:vi.fn((row:any)=>{recorded.push(row);return{written:true,row};})} as any,
      settings:()=>({normalReviewsPerPlan:2,exceptionReviewsPerPlan:1,failureBudget:1,minIntervalMs:1_000,authorityTtlMs:30_000}),
      ownerOf:()=>({ownerState:'HUMAN_MANAGED',ownerVersion:7,deadline:null,reviewEligible:true})});
    const first=scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions,trigger:'SCHEDULED',now:100_000});
    expect(first.granted).toBe(true);
    if(!first.granted)return;
    scheduler.accept(first.ticket,{now:100_010,usage:{inputTokens:null,outputTokens:null},status:'FAILED',promptHash:'missing-prompt-hash',failureBudgetExempt:true});
    expect(recorded.at(-1)).toMatchObject({status:'FAILED',errorCode:'REVIEW_CALL_FAILED'});
    expect(scheduler.state()[0]).toMatchObject({used:0,failures:0});
    expect(scheduler.reserve({positionId:'pos-1',cycleId:'cycle-1',scope:'scope-1',versions,trigger:'SCHEDULED',now:101_001}).granted).toBe(true);
  });
});

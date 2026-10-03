import {createHash} from 'node:crypto';
import {aiUsageRowOf,reviewOpeningRowOf,reviewRequestKeyOf,type AiUsageLedger,type AiUsageRole,type AiUsageRow} from './aiUsageLedger.js';

/**
 * S07-A/B: bounded review of positions that are already under AI management.
 *
 * Three things are enforced here and nowhere else: the same facts never trigger a second model call,
 * handoff-pending cycles never get a routine call, HUMAN_MANAGED cycles get review-only tickets, and a model answer that
 * arrives after the authority moved is archived rather than acted on. The budget is spent before the
 * request, so a timeout still costs what it cost, and exhausting it stops inference - it never stops
 * a deadline, a take-profit sweep or a handoff.
 */

export type ReviewVersions={planVersion:number;planRef:string;ownerVersion:number;positionVersion:number;settingsVersion:number;
  riskGeneration:number;snapshotHash:string;evidenceVersion:string;memoryVersion:string;predicateThresholdCrossed?:boolean};

export type ReviewTicket={budgetKey:string;triggerKey:string;reviewNumber:number;role:AiUsageRole;positionId:string;cycleId:string;scope:string;
  ownerVersion:number;reviewOnly:boolean;planRef:string;reservedAt:number;expiresAt:number;reasons:string[]};

export type BudgetState={budgetKey:string;planRef:string;cycleId:string;scope:string;normal:number;exception:number;used:number;failures:number;
  lastTriggerKey:string|null;lastFactsHash:string|null;lastSkippedReason?:string|null;runs:AiUsageRow[]};

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);

/** Everything that could legitimately change the answer. Leaving one out would let a stale call pass. */
export function reviewTriggerKeyOf(input:{scope:string;cycleId:string;versions:ReviewVersions;now:number}){
  const v=input.versions;
  return `trg_${hash([input.scope,input.cycleId,v.planVersion,v.planRef,v.ownerVersion,v.positionVersion,v.settingsVersion,v.riskGeneration,
    v.snapshotHash,v.evidenceVersion,v.memoryVersion,v.predicateThresholdCrossed===true])}`;
}

export function reviewFactsHashOf(versions:ReviewVersions){
  return hash({positionVersion:versions.positionVersion,settingsVersion:versions.settingsVersion,riskGeneration:versions.riskGeneration,
    snapshotHash:versions.snapshotHash,evidenceVersion:versions.evidenceVersion,memoryVersion:versions.memoryVersion});
}

export class PositionReviewScheduler {
  private budgets=new Map<string,BudgetState>();
  constructor(private readonly ports:{
    ledger:AiUsageLedger;
    settings:()=>{normalReviewsPerPlan:number;exceptionReviewsPerPlan:number;failureBudget:number;minIntervalMs:number;authorityTtlMs:number};
    /** Who owns the cycle right now. A journal or read model miss is treated as not AI-owned. */
    ownerOf:(scope:string,cycleId:string)=>{ownerState:string;ownerVersion:number;deadline:number|null;reviewEligible?:boolean}|null;
    now?:()=>number;
  }){}

  private key(input:{scope:string;planRef:string}){return `budget_${hash([input.scope,input.planRef])}`;}

  /**
   * A refusal is itself a fact the operator needs: "no review happened" has a different meaning when
   * the budget is exhausted, when the facts never changed, and when the model is simply busy.
   */
  private refuse(budget:BudgetState,reason:string,extra:Record<string,unknown>={}){
    budget.lastSkippedReason=reason;
    return {granted:false,reason,budgetKey:budget.budgetKey,...extra} as const;
  }

  budgetOf(scope:string,planRef:string,cycleId:string):BudgetState{
    const key=this.key({scope,planRef});
    const existing=this.budgets.get(key);
    if(existing)return existing;
    const created:BudgetState={budgetKey:key,planRef,cycleId,scope,normal:0,exception:0,used:0,failures:0,lastTriggerKey:null,lastFactsHash:null,runs:[]};
    this.budgets.set(key,created);
    return created;
  }

  /**
   * The decision and the budget spend happen in one synchronous step: there is no await between
   * "is there budget left" and "it is spent", so two events in one tick cannot both be granted.
   */
  reserve(input:{positionId:string;cycleId:string;scope:string;versions:ReviewVersions;trigger:'SCHEDULED'|'PREDICATE'|'MANUAL_REQUEST';now?:number}){
    const now=input.now??(this.ports.now?.()??Date.now());
    const settings=this.ports.settings();
    const owner=this.ports.ownerOf(input.scope,input.cycleId);
    if(!owner)return{granted:false,reason:'OWNER_UNTRACKED'} as const;
    // Human-owned positions remain reviewable evidence subjects, but their review never receives
    // execution authority. HANDOFF_PENDING/CLOSED/untracked positions remain non-reviewable.
    const reviewOnly=owner.ownerState==='HUMAN_MANAGED';
    if(owner.ownerState!=='AI_ACTIVE'&&!(reviewOnly&&owner.reviewEligible!==false))return{granted:false,reason:`OWNER_NOT_REVIEWABLE:${owner.ownerState}`,zeroRoutineCall:true} as const;
    if(owner.ownerVersion!==input.versions.ownerVersion)return{granted:false,reason:'OWNER_VERSION_DRIFT'} as const;
    if(!reviewOnly&&!(finite(owner.deadline)&&owner.deadline>now))return{granted:false,reason:'AI_MANAGEMENT_DEADLINE_ELAPSED'} as const;
    const budget=this.budgetOf(input.scope,input.versions.planRef,input.cycleId);
    const triggerKey=reviewTriggerKeyOf({scope:input.scope,cycleId:input.cycleId,versions:input.versions,now});
    const factsHash=reviewFactsHashOf(input.versions);
    const limit=Math.max(0,Math.trunc(settings.normalReviewsPerPlan))+(input.trigger==='PREDICATE'?Math.max(0,Math.trunc(settings.exceptionReviewsPerPlan)):0);
    if(budget.failures>=Math.max(1,Math.trunc(settings.failureBudget)))return this.refuse(budget,'REVIEW_FAILURE_BUDGET_EXHAUSTED',{budgetKey:budget.budgetKey});
    if(budget.used>=limit)return this.refuse(budget,budget.used>=limit?'REVIEW_BUDGET_EXHAUSTED':'REVIEW_BUDGET_INVALID',{budgetKey:budget.budgetKey,limit});
    if(triggerKey===budget.lastTriggerKey&&factsHash===budget.lastFactsHash)
      return this.refuse(budget,'REVIEW_FACTS_UNCHANGED',{budgetKey:budget.budgetKey,deduplicated:true});
    if(input.trigger!=='PREDICATE'&&budget.lastTriggerKey!==null&&triggerKey===budget.lastTriggerKey)
      return this.refuse(budget,'REVIEW_TRIGGER_ALREADY_CONSUMED',{budgetKey:budget.budgetKey,deduplicated:true});
    if(triggerKey===budget.lastTriggerKey&&input.trigger==='PREDICATE'&&input.versions.predicateThresholdCrossed!==true)
      return this.refuse(budget,'REVIEW_PREDICATE_UNCHANGED',{budgetKey:budget.budgetKey,deduplicated:true});
    const last=budget.runs[budget.runs.length-1];
    if(last&&Number(last.startedAt??0)>0&&now-Number(last.startedAt)<Math.max(1_000,settings.minIntervalMs))
      return this.refuse(budget,'REVIEW_MIN_INTERVAL_NOT_ELAPSED',{budgetKey:budget.budgetKey});
    budget.lastSkippedReason=null;
    budget.used++;
    budget.lastTriggerKey=triggerKey;
    budget.lastFactsHash=factsHash;
    const ticket:ReviewTicket={budgetKey:budget.budgetKey,triggerKey,reviewNumber:budget.used,role:'REVIEW',positionId:input.positionId,
      scope:input.scope,cycleId:input.cycleId,ownerVersion:input.versions.ownerVersion,reviewOnly,planRef:input.versions.planRef,
      reservedAt:now,expiresAt:now+Math.max(1_000,settings.authorityTtlMs),reasons:[`TRIGGER_${input.trigger}`]};
    // The reservation opens the ledger row before the request exists, so a call that dies with the
    // process is still visible as an unanswered request rather than as a call that never happened.
    // accept() finalizes this same row, because both derive the identity from the ticket.
    const opened=reviewOpeningRowOf({triggerKey,reviewNumber:budget.used,scope:input.scope,cycleId:input.cycleId,
      planRef:input.versions.planRef,budgetKey:budget.budgetKey,trigger:input.trigger,startedAt:now});
    this.ports.ledger.record(opened);
    budget.runs=[...budget.runs,opened].slice(-12);
    return{granted:true,ticket,limit,budget:{used:budget.used,failures:budget.failures}} as const;
  }

  /**
   * The answer may only be used while the same authority still stands. After that it is archived for
   * audit and the caller is told, in one word, that nothing may be built from it (S07-T02).
   *
   * The ownership read is deliberately re-taken from the journal here rather than accepted from the
   * caller: a callback that reports its own owner version is reporting what it hopes is still true.
   */
  accept(ticket:ReviewTicket,input:{now:number;usage:{inputTokens:number|null;outputTokens:number|null};
    status:AiUsageRow['status'];finishReason?:string|null;modelIdentity?:string|null;promptHash:string;latencyMs?:number|null;
    transportAttempts?:number|null;proposal?:unknown;failureBudgetExempt?:boolean}){
    const owner=this.ports.ownerOf(ticket.scope,ticket.cycleId);
    const usage=this.ports.ledger.record(usageRowOf(ticket,input));
    const budget=this.budgets.get(ticket.budgetKey);
    // A proven implementation defect before inference is archived, but does not exhaust
    // the model failure budget. Endpoint and model failures still count as before.
    if(input.status==='FAILED'||input.status==='TIMEOUT'||input.status==='TRUNCATED'){
      if(budget&&input.failureBudgetExempt!==true)budget.failures++;
    }
    if(!owner)return{usable:false,reason:'OWNER_UNTRACKED_AT_CALLBACK',archived:true,row:usage.row};
    if(ticket.reviewOnly?owner.ownerState!=='HUMAN_MANAGED':owner.ownerState!=='AI_ACTIVE')return{usable:false,reason:`OWNER_AUTHORITY_CHANGED:${owner.ownerState}`,archived:true,row:usage.row};
    if(owner.ownerVersion!==ticket.ownerVersion)return{usable:false,reason:'OWNER_VERSION_CHANGED_DURING_MODEL_CALL',archived:true,row:usage.row};
    // The spent budget is refunded by a call that never reached a model, so a dead endpoint cannot
    // silently starve the reviews that a recovered endpoint still owes. A call that did answer is
    // never refunded, however late it arrived.
    if(input.status==='FAILED'&&budget&&usage.written){budget.used=Math.max(0,budget.used-1);budget.lastTriggerKey=null;budget.lastFactsHash=null;}
    if(input.now>=ticket.expiresAt)return{usable:false,reason:'REVIEW_AUTHORITY_WINDOW_CLOSED',archived:true,row:usage.row};
    if(!ticket.reviewOnly&&input.now>=Number(owner.deadline??0))return{usable:false,reason:'AI_MANAGEMENT_DEADLINE_ELAPSED_DURING_MODEL_CALL',archived:true,row:usage.row};
    return{usable:true,reason:'REVIEW_RESULT_APPLICABLE',archived:true,row:usage.row};
  }

  state(){return [...this.budgets.values()].map(row=>({budgetKey:row.budgetKey,cycleId:row.cycleId,planRef:row.planRef,used:row.used,failures:row.failures,
    lastTriggerKey:row.lastTriggerKey,runs:row.runs.length}));}

  /**
   * P6: the review authority has to be observable per cycle, not just "enabled". Last review, next
   * due, failure count and the reason the last attempt was skipped are what tell an operator whether
   * a long-held position is actually being reconsidered or merely waiting for its take-profit.
   */
  reviewReadback(now=Date.now()){
    const settings=this.ports.settings();
    const minIntervalMs=Math.max(1_000,settings.minIntervalMs);
    const rows=[...this.budgets.values()].map(budget=>{
      const runs=budget.runs;
      const lastReviewAt=runs.length?Math.max(...runs.map(row=>Number(row.completedAt??row.startedAt??0)).filter(value=>Number.isFinite(value))):null;
      const last=runs[runs.length-1]??null;
      const limit=Math.max(0,Math.trunc(settings.normalReviewsPerPlan));
      return{budgetKey:budget.budgetKey,cycleId:budget.cycleId,scope:budget.scope,planRef:budget.planRef,
        used:budget.used,limit,failures:budget.failures,lastReviewAt,
        nextDueAt:lastReviewAt==null?now:lastReviewAt+minIntervalMs,
        lastOutcome:last?String(last.status??'UNKNOWN'):null,
        skippedReason:budget.lastSkippedReason??null};
    });
    return{evaluatedAt:now,budgets:rows.length,
      due:rows.filter(row=>row.used<row.limit&&row.failures<Math.max(1,Math.trunc(settings.failureBudget))&&row.nextDueAt<=now).length,
      exhausted:rows.filter(row=>row.used>=row.limit).length,
      failureBlocked:rows.filter(row=>row.failures>=Math.max(1,Math.trunc(settings.failureBudget))).length,
      minIntervalMs,rows};
  }

  dueCount(now=Date.now()){return this.reviewReadback(now).due;}

  /** What a restart must remember: spent budget is never refunded by losing memory. */
  serialize(){return [...this.budgets.values()].map(row=>({...row,runs:row.runs.map(usage=>({eventId:usage.eventId,status:usage.status,startedAt:usage.startedAt}))}));}
  restore(rows:any[]){for(const row of rows??[]){if(!row?.budgetKey)continue;this.budgets.set(String(row.budgetKey),{...row,runs:Array.isArray(row.runs)?row.runs:[]});}}
}

function finite(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value);}

function usageRowOf(ticket:ReviewTicket,input:{usage:{inputTokens:number|null;outputTokens:number|null};status:AiUsageRow['status'];
  finishReason?:string|null;modelIdentity?:string|null;promptHash:string;latencyMs?:number|null;transportAttempts?:number|null;proposal?:unknown;now:number}):AiUsageRow{
  return aiUsageRowOf({
    requestKey:reviewRequestKeyOf(ticket.triggerKey,ticket.reviewNumber),role:'REVIEW',status:input.status,
    inputTokens:input.usage.inputTokens,outputTokens:input.usage.outputTokens,
    latencyMs:finite(input.latencyMs)?Number(input.latencyMs):Math.max(0,input.now-ticket.reservedAt),
    finishReason:input.finishReason??null,promptHash:input.promptHash??'missing-prompt-hash',modelIdentity:input.modelIdentity??null,
    triggerReason:ticket.reasons.join(','),cacheHit:false,symbol:'',scope:ticket.scope,cycleId:ticket.cycleId,planRef:ticket.planRef,
    errorCode:input.status==='COMPLETED'?null:'REVIEW_CALL_FAILED',startedAt:ticket.reservedAt,completedAt:input.now,
    budgetKey:ticket.budgetKey,transportAttempts:input.transportAttempts??null,
  });
}

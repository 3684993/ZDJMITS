import type {RuntimeState} from '../state/runtimeState.js';
import type {EventBus} from '../events/eventBus.js';
import type {PositionReviewScheduler,ReviewTicket,ReviewVersions} from './positionReviewScheduler.js';
import type {V396ExitRuntime} from './v396ExitRuntime.js';
import {aiExitPlanFactsOf} from './tradePlanService.js';
import type {TradePlan} from '@zdj/contracts';

/**
 * S07-A/B: the production consumer of the review scheduler.
 *
 * It only ever asks "is a review owed for this cycle", spends the budget through the scheduler, and
 * records what came back. A usable answer becomes review evidence the AI exit path may read; a late
 * one is archived and explicitly not usable. When the model is unreachable, the budget is spent or
 * review is switched off, this loop does nothing at all - the deadline, the take-profit sweep and the
 * handoff are owned elsewhere and are never gated on it.
 */

export type ReviewVerdict={cycleId:string;scope:string;planRef:string;planVersion:number;decision:string;usable:boolean;reason:string;
  at:number;runId:string|null;ownerVersion:number;triggerKey:string};

export type ReviewAnswer={decision:string;runId:string|null;usage:{inputTokens:number|null;outputTokens:number|null};
  finishReason?:string|null;modelIdentity?:string|null;promptHash:string;latencyMs?:number|null;transportAttempts?:number|null};

export type ReviewTickReport={enabled:boolean;considered:number;reserved:number;deduplicated:number;refused:string[];completed:number;discarded:number;failed:number;zeroRoutineCalls:number};

export class PositionReviewRunner {
  constructor(private readonly ports:{
    state:RuntimeState;
    events:EventBus;
    exitRuntime:V396ExitRuntime;
    scheduler:PositionReviewScheduler;
    /** The 27B independent judgement. Absent capability means no review, never a silent substitute. */
    review:(input:{ticket:ReviewTicket;position:any;plan:TradePlan})=>Promise<ReviewAnswer>;
    settings:()=>Record<string,any>;
    /** Identity of the decision-relevant market facts, not a wall clock: a live price tick must not
     * by itself look like new evidence, or the deduplication the stage is graded on never binds. */
    evidenceVersion:(symbol:string)=>string;
    memoryVersion:()=>string;
    /** P6: declares that a review is owed, so the shared Primary endpoint can divide fairly. */
    noteOwed?:(at:number)=>void;
    reviewAvailable?:()=>boolean;
    clearOwed?:()=>void;
  }){}

  private versions(position:any,plan:TradePlan,scope:string,cycleId:string):ReviewVersions{
    const state=this.ports.state as any;
    return{planVersion:plan.planVersion,planRef:plan.planId,ownerVersion:Number(this.ports.exitRuntime.owner({symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt})?.ownerVersion??0),
      positionVersion:Math.trunc(Number((position as any).firstObservedAt??position.openedAt??0))||1,settingsVersion:Number(state.settings?.settingsVersion??0),
      riskGeneration:Number(state.runtimeControl?.capital?.generation??0),
      snapshotHash:String(state.riskLedger?.snapshotHash??'unbound'),evidenceVersion:this.ports.evidenceVersion(position.symbol),memoryVersion:this.ports.memoryVersion()};
  }

  private subject(position:any,cycleId:string){return{symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt};}

  /** One bounded pass over AI-managed cycles and review-only HUMAN_MANAGED evidence subjects. */
  async tick(now=Date.now()):Promise<ReviewTickReport>{
    const coordination=this.ports.settings();
    const report:ReviewTickReport={enabled:coordination.positionReviewEnabled===true,considered:0,reserved:0,deduplicated:0,refused:[],completed:0,discarded:0,failed:0,zeroRoutineCalls:0};
    if(!report.enabled){this.ports.clearOwed?.();return report;}
    const plans=[...(this.ports.state as any).tradePlans.values()] as TradePlan[];
    for(const position of [...(this.ports.state as any).positions.values()]){
      const cycleId=String(position.cycleId??'').trim();
      if(!cycleId)continue;
      const scope=(this.ports.exitRuntime as any).scope({symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt});
      const owner=this.ports.exitRuntime.owner(this.subject(position,cycleId));
      const reviewOnly=owner?.ownerState==='HUMAN_MANAGED';
      if(!owner||(owner.ownerState!=='AI_ACTIVE'&&!reviewOnly)){
        // Handoff-pending/closed/untracked cycles are non-reviewable. Human-managed cycles are
        // reviewed as evidence only; execution remains blocked by the ownership journal.
        if(owner&&owner.ownerState!=='CLOSED')report.zeroRoutineCalls++;
        continue;
      }
      const plan=plans.filter(row=>row.cycleId===cycleId&&row.scope===scope&&row.side!=='WAIT').at(-1);
      if(!plan)continue;
      report.considered++;
      // P6: declaring the debt before the model call is what lets a continuously queued Entry chain
      // yield a bounded share of the Primary endpoint to this review.
      if(!reviewOnly&&(owner.deadline==null||owner.deadline<=now))continue;
      if(this.ports.reviewAvailable?.()===false){this.ports.noteOwed?.(now);report.refused.push('REVIEW_RESOURCE_BUSY');continue;}
      const reserved=this.ports.scheduler.reserve({positionId:position.id,cycleId,scope,trigger:'SCHEDULED',versions:this.versions(position,plan,scope,cycleId),now});
      if(!reserved.granted){
        report.refused.push(reserved.reason);
        if((reserved as any).deduplicated)report.deduplicated++;
        continue;
      }
      this.ports.noteOwed?.(now);
      report.reserved++;
        const ticket=reserved.ticket;
      if(reviewOnly)this.ports.events.publish('POSITION_REVIEW_ONLY_AUTHORITY',{cycleId,scope,ownerVersion:ticket.ownerVersion,executionAuthority:false,reason:'HUMAN_MANAGED_REVIEW_EVIDENCE_ONLY'},position.symbol);
      // P7: the review moments belong to the cycle, not to a page's clock. Stamping them here means the
      // "last review / next due" a human reads is what the engine actually did.
      (this.ports.state as any).positions.set(position.id,{...position,lastReviewAt:now,nextReviewAt:now+Math.max(1_000,Number(coordination.reviewMinIntervalMs??300_000))});
      try{
        const answer=await this.ports.review({ticket,position,plan});
        const applied=this.ports.scheduler.accept(ticket,{
          now:Date.now(),usage:answer.usage,status:'COMPLETED',finishReason:answer.finishReason??null,
          modelIdentity:answer.modelIdentity??null,promptHash:answer.promptHash,latencyMs:answer.latencyMs??null,
          transportAttempts:answer.transportAttempts??null});
        const verdict:ReviewVerdict={cycleId,scope,planRef:plan.planId,planVersion:plan.planVersion,decision:answer.decision,usable:applied.usable,
          reason:applied.reason,at:Date.now(),runId:answer.runId,ownerVersion:ticket.ownerVersion,triggerKey:ticket.triggerKey};
        this.addVerdict(verdict);
        if(applied.usable)report.completed++;else report.discarded++;
        this.ports.events.publish(applied.usable?'POSITION_REVIEW_APPLIED':'POSITION_REVIEW_DISCARDED',{...verdict,archived:applied.archived,rowEventId:applied.row.eventId,
          usageStatus:applied.row.usageStatus,writableAuthority:applied.usable?'REVIEW_EVIDENCE_ONLY':'NONE'},position.symbol);
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        // A failed call still goes through the scheduler: the row is what proves a request was made
        // and failed, and the failure budget is what stops a dead endpoint from being retried forever.
        const applied=this.ports.scheduler.accept(ticket,{
          now:Date.now(),usage:{inputTokens:null,outputTokens:null},status:'FAILED',finishReason:null,promptHash:'missing-prompt-hash',
          failureBudgetExempt:message==='PRE_AI_EXECUTION_ENVELOPE_MISSING'});
        report.failed++;
        this.addVerdict({cycleId,scope,planRef:plan.planId,planVersion:plan.planVersion,decision:'REVIEW_FAILED',usable:false,
          reason:'REVIEW_CALL_FAILED',at:Date.now(),runId:null,ownerVersion:ticket.ownerVersion,triggerKey:ticket.triggerKey});
        this.ports.events.publish('POSITION_REVIEW_FAILED',{cycleId,scope,planRef:plan.planId,reason:message,rowEventId:applied.row.eventId,
          reviewFailures:(this.ports.scheduler.state().find(row=>row.budgetKey===ticket.budgetKey)?.failures??0),
          engineRestartTriggered:false,orderSent:false},position.symbol);
      }
    }
    // Spent budget is checkpointed with the rest of the runtime state: a restart must not refund a
    // review that already happened, or the bound would be a per-process suggestion.
    if(!report.refused.includes('REVIEW_RESOURCE_BUSY'))this.ports.clearOwed?.();
    const budgets=(this.ports.state as any).reviewBudgets as Map<string,unknown>;
    budgets.clear();
    for(const row of this.ports.scheduler.serialize())budgets.set(row.budgetKey,row);
    this.lastReport={...report,lastTickAt:now,lastVerdictAt:this.lastReport.lastVerdictAt,lastDecision:this.lastReport.lastDecision,lastReason:this.lastReport.lastReason,usable:this.lastReport.usable};
    return report;
  }

  addVerdict(verdict:ReviewVerdict){
    const store=(this.ports.state as any).positionReviews as Map<string,{latest:ReviewVerdict;history:ReviewVerdict[]}>;
    const prior=store.get(verdict.cycleId);
    if(!prior||verdict.at>=prior.latest.at)store.set(verdict.cycleId,{latest:verdict,history:[...(prior?.history??[]),verdict].slice(-12)});
    else store.set(verdict.cycleId,{...prior,history:[...prior.history,verdict].slice(-12)});
    this.lastReport={...this.lastReport,lastVerdictAt:verdict.at,lastDecision:verdict.decision,lastReason:verdict.reason,usable:verdict.usable};
  }

  /** P6/P7: the most recent review attempt, stated as a fact rather than inferred from a chart. */
  lastOutcome(){
    const report=this.lastReport;
    const scheduled=this.ports.scheduler.reviewReadback();
    const currentCycles=new Set([...this.ports.state.positions.values()].map(position=>String(position.cycleId??'')));
    const currentRows=scheduled.rows.filter(row=>currentCycles.has(row.cycleId));
    const persisted=[...((this.ports.state as any).positionReviews?.values()??[])].map((row:any)=>row?.latest).filter((row:any)=>row&&Number.isFinite(Number(row.at))).sort((a:any,b:any)=>Number(b.at)-Number(a.at))[0];
    return{...report,enabled:this.ports.settings().positionReviewEnabled===true,lastVerdictAt:report.lastVerdictAt??persisted?.at??null,lastDecision:report.lastDecision??persisted?.decision??null,lastReason:report.lastReason??persisted?.reason??null,usable:report.lastVerdictAt==null?persisted?.usable===true:report.usable,considered:report.lastTickAt==null?currentRows.length:report.considered,due:currentRows.filter(row=>row.used<row.limit&&row.failures<Math.max(1,Number(this.ports.settings().reviewFailureBudget??2))&&row.nextDueAt<=Date.now()).length,exhausted:currentRows.filter(row=>row.used>=row.limit).length,failureBlocked:currentRows.filter(row=>row.failures>=Math.max(1,Number(this.ports.settings().reviewFailureBudget??2))).length,
      skippedReason:currentRows.find(row=>row.skippedReason)?.skippedReason??null};
  }

  private lastReport:{lastTickAt:number|null;lastVerdictAt:number|null;lastDecision:string|null;lastReason:string|null;usable:boolean;enabled:boolean;considered:number;reserved:number;completed:number;discarded:number;failed:number}={
    lastTickAt:null,lastVerdictAt:null,lastDecision:null,lastReason:null,usable:false,enabled:false,considered:0,reserved:0,completed:0,discarded:0,failed:0};

  /** The only review fact an exit may read: usable, current, and for this exact plan version. */
  static usableVerdict(state:RuntimeState,input:{cycleId:string;planRef:string;planVersion:number;maxAgeMs:number;now:number}){
    const row=(state as any).positionReviews?.get?.(input.cycleId) as {latest:ReviewVerdict}|undefined;
    const verdict=row?.latest;
    if(!verdict||!verdict.usable)return null;
    if(verdict.planRef!==input.planRef||verdict.planVersion!==input.planVersion)return null;
    if(verdict.decision==='EXIT_PROPOSAL'){
      const plan=[...(state as any).tradePlans.values()].find((row:TradePlan)=>row.planId===input.planRef&&row.cycleId===input.cycleId&&row.planVersion===input.planVersion);
      if(!plan||!plan.invalidationPredicate?.trim()||plan.invalidationPredicate==='NO_PREDICATE')return null;
    }
    if(input.now-verdict.at>Math.max(1_000,input.maxAgeMs))return null;
    return verdict;
  }

  /**
   * Does a review change the plan facts the exit decision is bound to? Only a usable one does, and
   * the evidence it adds is a pointer to the archived run, never the model's own wording.
   *
   * HANDOFF deliberately does not invalidate the thesis: "a human should look at this" is a request
   * for custody, not an order to close. Only an exit proposal can move the exit decision.
   */
  static planFactsWithReview(planFacts:ReturnType<typeof aiExitPlanFactsOf>,verdict:ReviewVerdict|null){
    if(!planFacts||!verdict)return planFacts;
    if(verdict.decision!=='EXIT_PROPOSAL')return{...planFacts,reviewDecision:verdict.decision};
    return{...planFacts,thesisInvalid:true,
      invalidationEvidenceRefs:[...new Set([...planFacts.invalidationEvidenceRefs,`review:${verdict.runId??verdict.triggerKey}`])],
      reviewDecision:verdict.decision};
  }
}

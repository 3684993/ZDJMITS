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
  }){}

  private versions(position:any,plan:TradePlan,scope:string,cycleId:string):ReviewVersions{
    const state=this.ports.state as any;
    return{planVersion:plan.planVersion,planRef:plan.planId,ownerVersion:Number(this.ports.exitRuntime.owner({symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt})?.ownerVersion??0),
      positionVersion:Math.trunc(Number((position as any).firstObservedAt??position.openedAt??0))||1,settingsVersion:Number(state.settings?.settingsVersion??0),
      riskGeneration:Number(state.runtimeControl?.capital?.generation??0),
      snapshotHash:String(state.riskLedger?.snapshotHash??'unbound'),evidenceVersion:this.ports.evidenceVersion(position.symbol),memoryVersion:this.ports.memoryVersion()};
  }

  private subject(position:any,cycleId:string){return{symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt};}

  /** One bounded pass over the cycles that are actually under AI management. */
  async tick(now=Date.now()):Promise<ReviewTickReport>{
    const coordination=this.ports.settings();
    const report:ReviewTickReport={enabled:coordination.positionReviewEnabled===true,considered:0,reserved:0,deduplicated:0,refused:[],completed:0,discarded:0,failed:0,zeroRoutineCalls:0};
    if(!report.enabled)return report;
    const plans=[...(this.ports.state as any).tradePlans.values()] as TradePlan[];
    for(const position of [...(this.ports.state as any).positions.values()]){
      const cycleId=String(position.cycleId??'').trim();
      if(!cycleId)continue;
      const scope=(this.ports.exitRuntime as any).scope({symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt});
      const owner=this.ports.exitRuntime.owner(this.subject(position,cycleId));
      if(!owner||owner.ownerState!=='AI_ACTIVE'){
        // A human-owned or pending cycle is counted as deliberately un-called, not as a failure.
        if(owner&&owner.ownerState!=='CLOSED')report.zeroRoutineCalls++;
        continue;
      }
      const plan=plans.filter(row=>row.cycleId===cycleId&&row.scope===scope&&row.side!=='WAIT').at(-1);
      if(!plan)continue;
      report.considered++;
      const reserved=this.ports.scheduler.reserve({positionId:position.id,cycleId,scope,trigger:'SCHEDULED',versions:this.versions(position,plan,scope,cycleId),now});
      if(!reserved.granted){
        report.refused.push(reserved.reason);
        if((reserved as any).deduplicated)report.deduplicated++;
        continue;
      }
      report.reserved++;
      const ticket=reserved.ticket;
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
          now:Date.now(),usage:{inputTokens:null,outputTokens:null},status:'FAILED',finishReason:null,promptHash:'missing-prompt-hash'});
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
    const budgets=(this.ports.state as any).reviewBudgets as Map<string,unknown>;
    budgets.clear();
    for(const row of this.ports.scheduler.serialize())budgets.set(row.budgetKey,row);
    return report;
  }

  addVerdict(verdict:ReviewVerdict){
    const store=(this.ports.state as any).positionReviews as Map<string,{latest:ReviewVerdict;history:ReviewVerdict[]}>;
    const prior=store.get(verdict.cycleId);
    if(!prior||verdict.at>=prior.latest.at)store.set(verdict.cycleId,{latest:verdict,history:[...(prior?.history??[]),verdict].slice(-12)});
    else store.set(verdict.cycleId,{...prior,history:[...prior.history,verdict].slice(-12)});
  }

  /** The only review fact an exit may read: usable, current, and for this exact plan version. */
  static usableVerdict(state:RuntimeState,input:{cycleId:string;planRef:string;planVersion:number;maxAgeMs:number;now:number}){
    const row=(state as any).positionReviews?.get?.(input.cycleId) as {latest:ReviewVerdict}|undefined;
    const verdict=row?.latest;
    if(!verdict||!verdict.usable)return null;
    if(verdict.planRef!==input.planRef||verdict.planVersion!==input.planVersion)return null;
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

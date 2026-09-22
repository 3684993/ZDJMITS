import type {Position} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';
import type {EventBus} from '../events/eventBus.js';
import type {ExchangeTradeAdapter} from '../types.js';
import {V396ExitRuntime,exitSubjectFromPosition,type V396PrepareExitInput} from './v396ExitRuntime.js';
import type {AiExitAuthorityService} from './aiExitAuthority.js';
import {buildExitEstimate,exitPriceBound} from './s03ExitCostEstimator.js';
import {assembleExitCostFacts} from './s03ExitCostFacts.js';
import type {PolicyInput} from './s03AiExitPolicy.js';
import {confirmedTpSubmissionRejection} from './tpSubmissionOutcome.js';

/**
 * J1: the only production consumer of an AI-initiated exit. It decides from durable facts and may
 * only write when the authority is ENFORCE, a durable TradePlan exists for the cycle, every cost
 * fact is proven and the coordinator handed back a prepared task with its own clientOrderId. Under
 * the default OFF setting this file performs no exchange call at all, which is what the acceptance
 * test measures.
 */

/** A plan is proven by its durable identity, never inferred from a position label. */
export type AiExitPlanFacts={planRef:string;planVersion:number;thesisInvalid:boolean;invalidationPredicate:string|null;invalidationEvidenceRefs:string[];exitConditionMet:boolean;minNetProfitUsd:number};

export type AiExitTickReport={authority:'OFF'|'SHADOW'|'ENFORCE';considered:number;evaluated:number;shadow:number;prepared:number;submitted:number;blocked:Array<{cycleId:string;reasons:string[]}>};

export class V396AiExitRunner {
  constructor(private readonly ports:{
    state:RuntimeState;
    events:EventBus;
    exitRuntime:V396ExitRuntime;
    authority:AiExitAuthorityService;
    adapter:ExchangeTradeAdapter;
    /** J3 supplies the durable TradePlan reader; until then no cycle can be AI-managed. */
    planOf:(position:Position,scope:string,cycleId:string)=>AiExitPlanFacts|null;
    identity:()=>{environment:string;account:string};
  }){}

  private coordination(){
    const governance=this.ports.state.settings.riskGovernance as any;
    return governance?.exitCoordination??{};
  }

  private fees(){
    const tp=this.ports.state.settings.takeProfit as any;
    const takerRate=Number(tp?.takerFeeRate??NaN),makerRate=Number(tp?.makerFeeRate??NaN);
    const slipBps=Number(tp?.slippageBufferPct??NaN)*100,safetyBps=Number(tp?.feeSafetyBufferPct??NaN)*100;
    const uncertainty=Number.isFinite(slipBps)&&slipBps>0?slipBps:(Number.isFinite(safetyBps)&&safetyBps>0?safetyBps:NaN);
    return{takerRate,makerRate,assumption:(tp?.exitFeeAssumption==='MAKER'?'MAKER':'TAKER') as 'MAKER'|'TAKER',uncertaintyBufferBps:uncertainty};
  }

  /** One bounded pass. It reports what it did and never throws into a trading path. */
  async tick(now=Date.now()):Promise<AiExitTickReport>{
    const authority=this.ports.authority.currentAuthority();
    const report:AiExitTickReport={authority,considered:0,evaluated:0,shadow:0,prepared:0,submitted:0,blocked:[]};
    // OFF is checked before any read: the disabled path costs no query, no decision and no write.
    if(authority==='OFF')return report;
    const adapter=this.ports.adapter;
    if(!adapter.proveReduction||!adapter.findExitByClientOrderId){
      report.blocked.push({cycleId:'*',reasons:['AI_EXIT_ADAPTER_CAPABILITIES_UNPROVEN']});
      this.ports.events.publish('AI_EXIT_TICK_BLOCKED',{reason:'ADAPTER_CAPABILITIES_UNPROVEN',authority},'V396');
      return report;
    }
    const identity=this.ports.identity();
    const coordination=this.coordination();
    for(const position of [...this.ports.state.positions.values()]){
      const cycleId=String(position.cycleId??'').trim();
      if(!cycleId)continue;
      const subject=exitSubjectFromPosition(position);
      const scope=this.ports.exitRuntime.scope(subject);
      const owner=this.ports.exitRuntime.owner(subject);
      // Only a durable AI_ACTIVE owner is ever considered: AUTO_MANAGED is a legacy label and
      // HANDOFF_PENDING/HUMAN_MANAGED mean the authority was already withdrawn (I01, I06).
      if(!owner||owner.ownerState!=='AI_ACTIVE'||owner.cycleId!==cycleId)continue;
      report.considered++;
      if(owner.deadline==null||owner.deadline<=now){report.blocked.push({cycleId,reasons:['AI_MANAGEMENT_EXPIRED']});continue;}
      const plan=this.ports.planOf(position,scope,cycleId);
      if(!plan){
        report.blocked.push({cycleId,reasons:['AI_PLAN_UNPROVEN']});
        this.ports.events.publish('AI_EXIT_PLAN_UNPROVEN',{scope,cycleId,authority},position.symbol);
        continue;
      }
      report.evaluated++;
      const quote=(this.ports.state.snapshots.get(position.symbol) as any)?.quote??{};
      const stepSize=Number(quote.stepSize??NaN),tickSize=Number(quote.tickSize??NaN);
      const units=V396ExitRuntime.quantityUnitsOf(Number(position.quantity??0),stepSize);
      const records=[...this.ports.state.tradeRecords.values()].filter(record=>String(record.cycleId??'')===cycleId);
      const policyVersion=`s03:${identity.environment}:${identity.account}:${Number(this.ports.state.settings.settingsVersion??0)}`;
      const facts=assembleExitCostFacts({
        now,scope,cycleId,symbol:position.symbol,side:position.side==='SHORT'?'SHORT':'LONG',
        positionVersion:Math.trunc(Number((position as any).firstObservedAt??position.openedAt??0))||1,
        remainingQuantityUnits:units,stepSize,tickSize,minNotional:Number(quote.minNotional??NaN),
        entryPrice:Number(position.entryPrice??NaN),bid:Number(quote.bid??NaN),ask:Number(quote.ask??NaN),
        quoteAt:Number(quote.ts??NaN),expiresAt:Math.min(now+Number(coordination.aiExitAuthorizationTtlMs??15_000),Number(owner.deadline)),
        rateMaxAgeMs:60_000,costVersion:policyVersion,quoteAsset:'USDT',fx:null,
        record:records.length===1?records[0]:null,
        fills:this.ports.state.executionFills.filter(fill=>String(fill.cycleId??'')===cycleId),
        fees:this.fees(),
        depthNotionalUsd:Number.isFinite(Number(quote.depthNotionalUsd))?Number(quote.depthNotionalUsd):null,
      });
      if(records.length>1)facts.blockers.push(`CYCLE_RECORD_AMBIGUOUS:${records.length}`);
      if(!facts.ready||!facts.input){
        report.blocked.push({cycleId,reasons:facts.blockers});
        this.ports.events.publish('AI_EXIT_FACTS_INCOMPLETE',{scope,cycleId,blockers:facts.blockers,authority},position.symbol);
        continue;
      }
      const estimate=buildExitEstimate(facts.input);
      const fixedNet=estimate.grossRealizedToDate!=null&&estimate.incurredFees!=null&&estimate.signedFunding!=null
        ?estimate.grossRealizedToDate-estimate.incurredFees+estimate.signedFunding:null;
      const lossLimit=Number(coordination.aiExitLossLimitUsd??10);
      const exitFeeRate=Number(this.fees().assumption==='MAKER'?this.fees().makerRate:this.fees().takerRate);
      const bound=exitPriceBound({side:estimate.side,remainingQuantityUnits:estimate.remainingQuantityUnits,stepSize,
        tickSize,entryPrice:facts.input.entryPrice,exitFeeRate,fixedNetMilli:fixedNet==null?Number.NaN:Math.round(fixedNet*1_000),
        targetNet:-Math.abs(lossLimit),minNotional:facts.input.minNotional,now});
      const policyInput:Omit<PolicyInput,'now'>={
        owner:{ownerState:'AI_ACTIVE',ownerVersion:owner.ownerVersion,cycleId,scope,deadline:Number(owner.deadline)},
        plan:{planVersion:plan.planVersion,cycleId,scope,thesisInvalid:plan.thesisInvalid,invalidationPredicate:plan.invalidationPredicate,
          invalidationEvidenceRefs:plan.invalidationEvidenceRefs,exitConditionMet:plan.exitConditionMet,minNetProfitUsd:plan.minNetProfitUsd},
        estimate,bound,
        policy:{lossLimit,allowSmallLoss:coordination.aiExitAllowSmallLoss!==false,authorizationTtlMs:Number(coordination.aiExitAuthorizationTtlMs??15_000)},
      };
      const exitInput:V396PrepareExitInput={requestKey:'',subject,quantityUnits:units,limitPrice:Number(bound.limitPrice??0),now,
        positionVersion:facts.input.positionVersion,settingsVersion:Number(this.ports.state.settings.settingsVersion??0),
        riskGeneration:Number(this.ports.state.runtimeControl?.capital?.generation??0),
        availableReduceUnits:units,remainingUnits:units,minNotional:facts.input.minNotional,tickSize,stepSize,
        proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now,positionSide:subject.side}};
      if(authority==='SHADOW'){
        const outcome=await this.ports.authority.evaluate({subject,policyInput,exit:exitInput,now});
        report.shadow++;
        this.ports.events.publish('AI_EXIT_SHADOW_DECISION',{scope,cycleId,reasons:outcome.reasons,verdict:outcome.shadowDecision?.outcome??null,
          boundaryPrice:outcome.shadowDecision?.boundaryPrice??null,estimateHash:outcome.shadowDecision?.estimateHash??null},position.symbol);
        continue;
      }
      const proof=await adapter.proveReduction({symbol:position.symbol,positionSide:subject.side,quantity:Number(position.quantity??0)});
      const liveUnits=V396ExitRuntime.quantityUnitsOf(Number(proof?.liveQuantity??0),stepSize);
      const outcome=await this.ports.authority.evaluate({subject,policyInput,now,exit:{...exitInput,
        proof:{kind:proof.kind==='HEDGE_POSITION_SIDE'?'HEDGE_POSITION_SIDE':'ONE_WAY_REDUCE_ONLY',checkedAt:proof.checkedAt,positionSide:proof.positionSide},
        availableReduceUnits:Math.min(units,liveUnits)}});
      if(!outcome.accepted||!outcome.submitRequired||!outcome.clientOrderId){
        report.blocked.push({cycleId,reasons:outcome.reasons});
        this.ports.events.publish('AI_EXIT_PREPARE_REFUSED',{scope,cycleId,reasons:outcome.reasons},position.symbol);
        continue;
      }
      report.prepared++;
      const submitted=await this.submit(position,subject,outcome.clientOrderId,Number(bound.limitPrice),{stepSize,tickSize,units,positionVersion:facts.input.positionVersion},proof.checkedAt);
      if(submitted)report.submitted++;
      else report.blocked.push({cycleId,reasons:[submitted===null?'AI_EXIT_SUBMIT_UNACKED':'AI_EXIT_SUBMIT_REFUSED']});
    }
    return report;
  }

  /**
   * ENFORCE only. The durable row already exists, the SUBMITTING transition re-checks the owner and
   * the mandate inside its own transaction, and the JIT read happens immediately before the wire
   * call. Only the row the exchange returned may converge the task; a lost ACK stays unacked.
   */
  private async submit(position:Position,subject:ReturnType<typeof exitSubjectFromPosition>,clientOrderId:string,limitPrice:number,
    facts:{stepSize:number;tickSize:number;units:number;positionVersion:number},proofCheckedAt:number){
    const adapter=this.ports.adapter;
    const quantity=facts.units*facts.stepSize;
    if(!adapter.placeManualOrder||!(limitPrice>0)||!(quantity>0))return false;
    if(!this.ports.exitRuntime.transitionByClientOrderId(clientOrderId,'SUBMITTING',Date.now(),'AI_EXIT_SUBMIT_SENT'))return false;
    const jit=this.ports.exitRuntime.jitBeforeSubmit({subject,clientOrderId,proofCheckedAt,now:Date.now()});
    if(!jit.allowed){
      this.ports.events.publish('AI_EXIT_JIT_RECHECK_FAILED',{clientOrderId,blockers:jit.blockers},position.symbol);
      return false;
    }
    try{
      const placed=await adapter.placeManualOrder({clientOrderId,internalOrderId:`ai_exit:${position.id}`,symbol:position.symbol,
        side:position.side==='LONG'?'SELL':'BUY',positionSide:subject.side==='SHORT'?'SHORT':'LONG',type:'LIMIT',quantity,price:limitPrice,
        reduceOnly:true,postOnly:false,positionId:position.id});
      const filled=V396ExitRuntime.quantityUnitsOf(Number((placed as any)?.filledQuantity??0),facts.stepSize);
      const raw=String(placed?.status??'').toUpperCase();
      const state=filled>=facts.units&&filled>0?'FILLED':raw==='CANCELED'?'CANCELED':raw==='REJECTED'?'REJECTED':raw==='EXPIRED'?'EXPIRED':filled>0?'PARTIALLY_FILLED':'WORKING';
      this.ports.exitRuntime.observe({eventId:`AI:${clientOrderId}:${raw||'NEW'}:${filled}`,clientOrderId,state,filledUnits:filled,positionVersion:facts.positionVersion},Date.now());
      this.ports.events.publish('AI_EXIT_SUBMITTED',{positionId:position.id,clientOrderId,status:raw,limitPrice,quantity},position.symbol);
      return true;
    }catch(error){
      if(confirmedTpSubmissionRejection(error)){
        this.ports.exitRuntime.observe({eventId:`AI_REJECTED:${clientOrderId}`,clientOrderId,state:'REJECTED',filledUnits:0,positionVersion:facts.positionVersion},Date.now());
        return false;
      }
      this.ports.exitRuntime.markSubmitUncertain(clientOrderId,Date.now());
      this.ports.events.publish('AI_EXIT_SUBMIT_UNACKED_QUERY_BY_CLIENT_ID',{positionId:position.id,clientOrderId,
        reason:String(error instanceof Error?error.message:error),retryForbidden:true},position.symbol);
      return null;
    }
  }
}

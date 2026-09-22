import type {Position} from '@zdj/contracts';
import type {AdapterCapabilities,CoordinatorResult,ExitTaskState} from './s04ExitCoordinator.js';
import {PositionExitCoordinator} from './s04ExitCoordinator.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {OwnershipService,type ProtectionMandate} from './ownershipService.js';
import {executionScope} from './executionLifecycle.js';
import type {AiExitVerdict} from './s03AiExitPolicy.js';

export type V396ExitSubject={symbol:string;side:'LONG'|'SHORT';cycleId:string|null;openedAt?:number|null};
export type V396ReductionProof={kind:'ONE_WAY_REDUCE_ONLY'|'HEDGE_POSITION_SIDE';checkedAt:number;positionSide:'LONG'|'SHORT'};
export type V396PrepareExitInput={
  subject:V396ExitSubject;
  quantityUnits:number;
  limitPrice:number;
  now:number;
  positionVersion:number;
  settingsVersion:number;
  riskGeneration:number;
  availableReduceUnits:number;
  remainingUnits:number;
  minNotional:number;
  tickSize:number;
  stepSize:number;
  proof:V396ReductionProof;
};

const RECOVERY_CAPABILITIES:AdapterCapabilities={
  oneWayReduceOnly:true,
  hedgePositionSide:true,
  cancelReplaceAtomic:false,
  partialFillExpected:true,
  supportsTimeInForce:['GTC','GTX'],
  positionMode:'ONE_WAY',
};

/**
 * Production-facing bridge for S04. It deliberately owns no exchange writer: callers must first
 * persist PREPARED here and may only then use the returned clientOrderId at the existing adapter.
 * The bridge uses the same v396-ownership.sqlite truth as OwnershipRuntime, so MANUAL / TP / future
 * AI exits share scope, cycle, ownerVersion, mandate and quantity claims.
 */
export class V396ExitRuntime {
  private readonly journal:OwnershipJournal;
  private readonly ownership:OwnershipService;
  private readonly recoveryCoordinator:PositionExitCoordinator;

  constructor(
    dbFile:string,
    private readonly exchangeIdentity:()=>{environment:string;account:string},
    private readonly capabilities:()=>Promise<AdapterCapabilities>,
  ){
    this.journal=new OwnershipJournal(dbFile);
    this.ownership=new OwnershipService(this.journal);
    // Constructor creates v396_exit_tasks / v396_exit_observed in the runtime database.
    this.recoveryCoordinator=new PositionExitCoordinator(this.journal,RECOVERY_CAPABILITIES);
  }

  scope(subject:Pick<V396ExitSubject,'symbol'|'side'>){
    const identity=this.exchangeIdentity();
    return executionScope(identity.environment,identity.account,subject.symbol,subject.side);
  }

  private cycle(subject:V396ExitSubject){
    const cycleId=String(subject.cycleId??'').trim();
    if(!cycleId)throw new Error('V396_EXIT_CYCLE_ID_REQUIRED');
    return cycleId;
  }

  private ensureProtectionOwner(subject:V396ExitSubject,now:number){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    const existing=this.ownership.ownership(scope,cycleId);
    if(existing)return existing;
    // Untracked legacy/open positions are never silently granted AI authority. HANDOFF_PENDING
    // preserves protection while requiring a future explicit owner adoption for AI management.
    return this.journal.initialize({
      scope,
      cycleId,
      planRef:null,
      firstFillAt:Number.isFinite(subject.openedAt)&&Number(subject.openedAt)>0?Number(subject.openedAt):Math.max(0,now-1),
      durationMs:null,
      now,
      legacy:true,
    });
  }

  recordHumanTakeover(subject:V396ExitSubject,reason:string,now=Date.now()){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    return this.ownership.recordTakeoverFromHuman(scope,cycleId,reason,now);
  }

  owner(subject:V396ExitSubject){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    return this.ownership.ownership(scope,cycleId);
  }

  mandate(subject:V396ExitSubject){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    return this.ownership.mandate(scope,cycleId);
  }

  ensureGuardianMandate(subject:V396ExitSubject,allowedPrice:number,now=Date.now()):ProtectionMandate{
    if(!(Number.isFinite(allowedPrice)&&allowedPrice>0))throw new Error('V396_MANDATE_PRICE_INVALID');
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    this.ensureProtectionOwner(subject,now);
    const current=this.ownership.mandate(scope,cycleId);
    if(current?.revokedAt!=null)return current;
    if(current?.source==='HUMAN')return current;
    if(current&&current.allowedPrice===allowedPrice&&current.allowedQuantityRule==='FULL_REMAINING')return current;
    return this.ownership.putMandate({scope,cycleId,source:'GUARDIAN',allowedPrice,allowedQuantityRule:'FULL_REMAINING'},current?.version??0,now);
  }

  revokeProtectionByHuman(subject:V396ExitSubject,now=Date.now()){
    const scope=this.scope(subject),cycleId=this.cycle(subject),current=this.ownership.mandate(scope,cycleId);
    if(!current)return null;
    return this.ownership.revokeMandateByHuman(scope,cycleId,now);
  }

  private reject(...reasons:string[]):CoordinatorResult{
    return{accepted:false,taskId:null,clientOrderId:null,reasons,submitRequired:false};
  }

  private proofValid(input:V396PrepareExitInput){
    const p=input.proof;
    if(!p||!['ONE_WAY_REDUCE_ONLY','HEDGE_POSITION_SIDE'].includes(p.kind))return false;
    if(p.positionSide!==input.subject.side)return false;
    if(!Number.isFinite(p.checkedAt)||p.checkedAt>input.now||input.now-p.checkedAt>5_000)return false;
    return true;
  }

  private syntheticVerdict(ownerVersion:number,limitPrice:number,now:number,source:'MANUAL'|'TP'):AiExitVerdict{
    const id=`V396_${source}_${ownerVersion}_${now}_${limitPrice}`;
    return{
      outcome:'ALLOW',reasonCodes:[source==='MANUAL'?'HUMAN_CONFIRMED':'PROTECTION_MANDATE_ACTIVE'],evidenceRefs:[],
      ownerVersion,planVersion:1,estimateHash:id,authorizationExpiresAt:now+15_000,boundaryPrice:limitPrice,
      lossLimit:0,conservativeNet:0,orderType:'LIMIT',marketFallbackAllowed:false,decisionHash:id,
    };
  }

  private async prepare(source:'MANUAL'|'TP',input:V396PrepareExitInput,mandate?:ProtectionMandate|null):Promise<CoordinatorResult>{
    if(!this.proofValid(input))return this.reject('REDUCTION_PROOF_UNPROVEN');
    if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)return this.reject('QUANTITY_INVALID');
    const scope=this.scope(input.subject),cycleId=this.cycle(input.subject);
    const owner=source==='MANUAL'
      ? this.recordHumanTakeover(input.subject,'MANUAL_SUBMISSION',input.now)
      : this.ensureProtectionOwner(input.subject,input.now);
    if(owner.ownerState==='CLOSED')return this.reject('CYCLE_CLOSED');
    if(source==='MANUAL'&&owner.ownerState!=='HUMAN_MANAGED')return this.reject('HUMAN_OWNER_NOT_ESTABLISHED');
    if(source==='TP'&&(!mandate||mandate.revokedAt!=null))return this.reject('MANDATE_REVOKED_OR_MISSING');
    const verdict=this.syntheticVerdict(owner.ownerVersion,input.limitPrice,input.now,source);
    let coordinator:PositionExitCoordinator;
    try{coordinator=new PositionExitCoordinator(this.journal,await this.capabilities());}
    catch{return this.reject('ADAPTER_CAPABILITIES_UNPROVEN');}
    return coordinator.requestExit({
      scope,cycleId,source,quantityUnits:input.quantityUnits,verdict,
      mandate:source==='TP'?{version:mandate!.version,revokedAt:mandate!.revokedAt}:null,
      jit:{
        now:input.now,ownerVersion:owner.ownerVersion,positionVersion:input.positionVersion,
        settingsVersion:input.settingsVersion,riskGeneration:input.riskGeneration,
        deadline:input.now+15_000,estimateHash:verdict.estimateHash,conservativeNet:0,
        availableReduceUnits:input.availableReduceUnits,remainingUnits:input.remainingUnits,
        minNotional:input.minNotional,tickSize:input.tickSize,stepSize:input.stepSize,
      },
    });
  }

  async prepareManual(input:V396PrepareExitInput){return this.prepare('MANUAL',input,null);}
  async prepareTakeProfit(input:V396PrepareExitInput){
    const mandate=this.ensureGuardianMandate(input.subject,input.limitPrice,input.now);
    return this.prepare('TP',input,mandate);
  }

  transitionByClientOrderId(clientOrderId:string,next:ExitTaskState,now:number,reason:string){
    const task=this.recoveryCoordinator.findTaskByClientOrderId(clientOrderId);
    return task?this.recoveryCoordinator.transition(task.taskId,next,now,reason):null;
  }
  markSubmitUncertain(clientOrderId:string,now=Date.now()){
    const task=this.recoveryCoordinator.findTaskByClientOrderId(clientOrderId);
    return task?this.recoveryCoordinator.markSubmitUncertain(task.taskId,now):null;
  }
  observe(event:{eventId:string;clientOrderId:string;state:ExitTaskState;filledUnits:number;positionVersion:number},now=Date.now()){
    return this.recoveryCoordinator.observe([event],now);
  }
  recoveryPlan(now=Date.now()){return this.recoveryCoordinator.recoveryPlan(now);}
  task(clientOrderId:string){return this.recoveryCoordinator.findTaskByClientOrderId(clientOrderId);}
  close(){this.journal.close();}
}

export function exitSubjectFromPosition(position:Position):V396ExitSubject{
  return{symbol:position.symbol,side:position.side,cycleId:position.cycleId??null,openedAt:position.openedAt??null};
}

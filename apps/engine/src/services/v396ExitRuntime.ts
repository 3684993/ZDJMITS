import type {Position} from '@zdj/contracts';
import type {AdapterCapabilities,CoordinatorResult,ExitTask,ExitTaskState} from './s04ExitCoordinator.js';
import {PositionExitCoordinator,OPEN_STATES} from './s04ExitCoordinator.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {OwnershipService,type ProtectionMandate} from './ownershipService.js';
import {executionScope} from './executionLifecycle.js';
import type {AiExitVerdict} from './s03AiExitPolicy.js';
import type {ExitFactSource,VerifiedExitOrderFact} from './exitOrderFact.js';
import {normalizeExitOrderFact} from './exitOrderFact.js';
import {OrderProvenanceRegistry} from './orderProvenanceRegistry.js';
import {confirmedTpNotSent} from './tpSubmissionOutcome.js';

export type V396ExitSubject={symbol:string;side:'LONG'|'SHORT';cycleId:string|null;openedAt?:number|null};
export type V396ReductionProof={kind:'ONE_WAY_REDUCE_ONLY'|'HEDGE_POSITION_SIDE';checkedAt:number;positionSide:'LONG'|'SHORT'};
export type V396PrepareExitInput={
  /** Stable submit identity for one human/TP intent: a retry of it must reuse the clientOrderId. */
  requestKey:string;
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
  readonly provenance:OrderProvenanceRegistry;

  private lastConvergenceAt=0;private converging=false;
  constructor(
    dbFile:string,
    private readonly exchangeIdentity:()=>{environment:string;account:string},
    private readonly capabilities:()=>Promise<AdapterCapabilities>,
    private readonly authority:()=>{aiExitAuthority:'OFF'|'SHADOW'|'ENFORCE';intervalMs?:number;batchLimit?:number;continuousEnabled?:boolean}=()=>({aiExitAuthority:'OFF'}),
  ){
    this.journal=new OwnershipJournal(dbFile);
    this.ownership=new OwnershipService(this.journal);
    // Constructor creates v396_exit_tasks / v396_exit_observed in the runtime database.
    this.recoveryCoordinator=new PositionExitCoordinator(this.journal,RECOVERY_CAPABILITIES);
    // The durable order registry lives beside the exit ledger so identity and quantity budget are
    // written by the same process against the same file.
    this.provenance=new OrderProvenanceRegistry(dbFile,()=>this.exchangeIdentity());
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

  /** The same ownership read for a caller that already resolved the canonical scope. */
  ownerOfScope(scope:string,cycleId:string){
    return String(cycleId??'').trim()?this.ownership.ownership(scope,String(cycleId).trim()):null;
  }

  /** Durable ledger layout, for the operator readback. A newer file refuses to open at all. */
  schemaInfo(){return this.journal.schemaInfo();}

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

  /**
   * A human may re-arm protection explicitly after a revoke. The new mandate is HUMAN, so the
   * guardian never overwrites it. That price and quantity rule remain binding until the next
   * explicit human change; automatic Guardian logic may not reinterpret a HUMAN mandate.
   */
  rearmProtectionByHuman(subject:V396ExitSubject,allowedPrice:number,now=Date.now()):ProtectionMandate|null{
    if(!(Number.isFinite(allowedPrice)&&allowedPrice>0))return null;
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    this.ensureProtectionOwner(subject,now);
    const current=this.ownership.mandate(scope,cycleId);
    const written=this.ownership.putMandate({scope,cycleId,source:'HUMAN',allowedPrice,allowedQuantityRule:'FULL_REMAINING'},current?.version??0,now);
    return written.revokedAt==null?written:null;
  }

  revokeProtectionByHuman(subject:V396ExitSubject,now=Date.now()){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    // A revoke must survive even for a legacy/migrated position that has never had a Guardian
    // mandate row. Establish the non-AI owner first, then persist a HUMAN tombstone if necessary.
    this.ensureProtectionOwner(subject,now);
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
      // A synthetic maintenance decision never evaluated an economic line: it is a human-confirmed or
      // mandate-driven reduce-only close, so reporting a profit floor it did not use would be a lie.
      lossLimit:0,conservativeNet:0,profitFloorUsd:null,profitFloorSource:'NONE',
      orderType:'LIMIT',marketFallbackAllowed:false,decisionHash:id,provenance:'SYNTHETIC_MAINTENANCE',
    };
  }

  private async prepare(source:'MANUAL'|'TP',input:V396PrepareExitInput,mandate?:ProtectionMandate|null):Promise<CoordinatorResult>{
    if(!this.proofValid(input))return this.reject('REDUCTION_PROOF_UNPROVEN');
    if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)return this.reject('QUANTITY_INVALID');
    const scope=this.scope(input.subject),cycleId=this.cycle(input.subject);
    const requestKey=String(input.requestKey??'').trim();
    if(!requestKey)return this.reject('REQUEST_KEY_REQUIRED');
    const owner=source==='MANUAL'
      ? this.recordHumanTakeover(input.subject,'MANUAL_SUBMISSION',input.now)
      : this.ensureProtectionOwner(input.subject,input.now);
    if(owner.ownerState==='CLOSED')return this.reject('CYCLE_CLOSED');
    if(source==='MANUAL'&&owner.ownerState!=='HUMAN_MANAGED')return this.reject('HUMAN_OWNER_NOT_ESTABLISHED');
    if(source==='TP'){
      if(!mandate||mandate.revokedAt!=null)return this.reject('MANDATE_REVOKED_OR_MISSING');
      if(mandate.allowedQuantityRule!=='FULL_REMAINING')return this.reject('MANDATE_QUANTITY_RULE_UNSUPPORTED');
      if(!(mandate.allowedPrice!=null&&Number.isFinite(mandate.allowedPrice)&&mandate.allowedPrice>0))return this.reject('MANDATE_PRICE_UNPROVEN');
      const tolerance=Math.max(1e-12,Math.abs(input.tickSize)*1e-9);
      if(Math.abs(mandate.allowedPrice-input.limitPrice)>tolerance)return this.reject('MANDATE_PRICE_MISMATCH');
      if(input.quantityUnits!==input.remainingUnits)return this.reject('MANDATE_FULL_REMAINING_REQUIRED');
    }
    const verdict=this.syntheticVerdict(owner.ownerVersion,input.limitPrice,input.now,source);
    let coordinator:PositionExitCoordinator;
    try{coordinator=new PositionExitCoordinator(this.journal,await this.capabilities());}
    catch{return this.reject('ADAPTER_CAPABILITIES_UNPROVEN');}
    const checkedNow=Date.now(),latestOwner=this.ownership.ownership(scope,cycleId);
    if(!this.proofValid({...input,now:checkedNow}))return this.reject('REDUCTION_PROOF_EXPIRED');
    if(!latestOwner||latestOwner.ownerVersion!==owner.ownerVersion||latestOwner.ownerState==='CLOSED')return this.reject('OWNER_CHANGED_DURING_PREPARE');
    if(source==='TP'){
      const latest=this.ownership.mandate(scope,cycleId);
      if(!latest||latest.revokedAt!=null||latest.version!==mandate!.version)return this.reject('MANDATE_CHANGED_DURING_PREPARE');
    }
    return coordinator.requestExit({
      scope,cycleId,source,requestKey,quantityUnits:input.quantityUnits,verdict,
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

  /**
   * P2: the clientOrderId minted here is the identity a later fill will be judged against, so it is
   * registered at the moment of preparation rather than inferred from a prefix afterwards.
   */
  registerExitProvenance(input:{subject:V396ExitSubject;clientOrderId:string|null;role:'TP'|'EXIT';source:string;intentId?:string|null}){
    const clientOrderId=String(input.clientOrderId??'').trim();
    if(!clientOrderId)return{recorded:false,conflict:'CLIENT_ORDER_ID_MISSING'};
    const identity=this.exchangeIdentity();
    return this.provenance.record({environment:identity.environment,accountId:identity.account,symbol:input.subject.symbol,
      clientOrderId,role:input.role,intentId:input.intentId??null,cycleId:input.subject.cycleId??null,source:input.source});
  }

  async prepareManual(input:V396PrepareExitInput){return this.prepare('MANUAL',input,null);}

  /**
   * J1: the only AI exit door. Unlike MANUAL/TP it never accepts a synthetic verdict - it needs the
   * real S03 model verdict over actual cost facts, an unexpired management deadline, an AI-owned
   * cycle and an explicit ENFORCE authority. OFF and SHADOW therefore produce zero prepared tasks.
   */
  async prepareAiExit(input:V396PrepareExitInput,verdict:AiExitVerdict){
    const authority=this.authority();
    if(authority.aiExitAuthority!=='ENFORCE')return this.reject('AI_EXIT_AUTHORITY_'+(authority.aiExitAuthority==='SHADOW'?'SHADOW':'OFF'));
    if(!verdict||verdict.provenance!=='MODEL_COST_MODEL'||(verdict as any).synthetic===true)return this.reject('AI_EXIT_VERDICT_NOT_MODEL_COST_MODEL');
    if(verdict.outcome!=='ALLOW')return this.reject('AI_EXIT_VERDICT_NOT_ALLOW');
    const scope=this.scope(input.subject),cycleId=this.cycle(input.subject),now=Date.now();
    if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)return this.reject('QUANTITY_INVALID');
    if(!this.proofValid({...input,now}))return this.reject('REDUCTION_PROOF_UNPROVEN');
    const owner=this.ownership.ownership(scope,cycleId);
    if(!owner)return this.reject('AI_EXIT_OWNER_UNTRACKED');
    if(owner.ownerState!=='AI_ACTIVE')return this.reject('AI_EXIT_OWNER_NOT_AI:'+String(owner.ownerState));
    if(!(Number.isFinite(owner.deadline??Number.NaN)&&owner.deadline>now))return this.reject('AI_EXIT_DEADLINE_EXPIRED');
    if(verdict.ownerVersion!==owner.ownerVersion)return this.reject('AI_EXIT_OWNER_DRIFT');
    let coordinator:PositionExitCoordinator;
    try{coordinator=new PositionExitCoordinator(this.journal,await this.capabilities());}
    catch{return this.reject('ADAPTER_CAPABILITIES_UNPROVEN');}
    const checkedNow=Date.now(),latest=this.ownership.ownership(scope,cycleId);
    if(!latest||latest.ownerVersion!==owner.ownerVersion||latest.ownerState!=='AI_ACTIVE')return this.reject('OWNER_CHANGED_DURING_PREPARE');
    if(!(Number.isFinite(latest.deadline??Number.NaN)&&latest.deadline>checkedNow))return this.reject('AI_EXIT_DEADLINE_EXPIRED');
    if(!this.proofValid({...input,now:checkedNow}))return this.reject('REDUCTION_PROOF_EXPIRED');
    return coordinator.requestExit({scope,cycleId,source:'AI',requestKey:verdict.decisionHash,quantityUnits:input.quantityUnits,verdict,mandate:null,
      jit:{now:input.now,ownerVersion:owner.ownerVersion,positionVersion:input.positionVersion,settingsVersion:input.settingsVersion,riskGeneration:input.riskGeneration,
        deadline:Number(owner.deadline),estimateHash:verdict.estimateHash,conservativeNet:verdict.conservativeNet??0,
        availableReduceUnits:input.availableReduceUnits,remainingUnits:input.remainingUnits,minNotional:input.minNotional,tickSize:input.tickSize,stepSize:input.stepSize}});
  }

  /**
   * J1: an exit order that already exists at the exchange but is missing from the local ledger must
   * be adopted with a complete identity, otherwise it holds the quantity conservatively. A new submit
   * on top of an unadopted order is refused; the ledger is never repaired after the fact.
   */
  adoptRemoteExit(input:{subject:V396ExitSubject;clientOrderId:string|null;quantityUnits:number;source:'TP'|'MANUAL';evidenceRef:string|null}){
    const scope=this.scope(input.subject),cycleId=String(input.subject.cycleId??'').trim();
    const clientOrderId=String(input.clientOrderId??'').trim(),missing:string[]=[];
    if(!cycleId)missing.push('CYCLE_ID_MISSING');
    if(!clientOrderId)missing.push('CLIENT_ORDER_ID_MISSING');
    if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)missing.push('QUANTITY_UNITS_INVALID');
    if(!input.evidenceRef)missing.push('EXCHANGE_EVIDENCE_MISSING');
    const claimKey='adopt:'+scope+'|'+(cycleId||'NO_CYCLE')+'|'+(clientOrderId||'NO_ID');
    this.journal.transact(()=>{
      if(this.journal.query<{id:string}>('SELECT id FROM v396_quantity_claims WHERE id=?',claimKey)[0])return;
      this.journal.write('INSERT INTO v396_quantity_claims VALUES(?,?,?)',claimKey,scope,JSON.stringify({scope,cycleId:cycleId||null,source:input.source,claimId:claimKey,
        quantityUnits:Math.max(1,Number.isSafeInteger(input.quantityUnits)?input.quantityUnits:1),version:1,status:'ACTIVE',clientOrderId:clientOrderId||null,
        adopted:true,blockers:missing,observedAt:Date.now()}));
    });
    return{adopted:missing.length===0,blockers:missing,claimKey};
  }

  /** Units still held by adopted or unacked exits for one scope+cycle, including incomplete ones. */
  adoptedUnits(subject:V396ExitSubject){
    const scope=this.scope(subject),cycleId=String(subject.cycleId??'').trim();
    return this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE scope=?',scope)
      .map((row:any)=>JSON.parse(String(row.payload)))
      .filter((claim:any)=>claim.status==='ACTIVE'&&(claim.cycleId??null)===cycleId)
      .reduce((sum:number,claim:any)=>sum+Number(claim.quantityUnits),0);
  }

  /** Release an adoption claim only once its exchange identity is positively terminal. */
  settleAdoptedExit(input:{subject:V396ExitSubject;clientOrderId:string;terminal:boolean}){
    const scope=this.scope(input.subject),cycleId=String(input.subject.cycleId??'').trim();
    if(!input.terminal)return false;
    const claimKey='adopt:'+scope+'|'+cycleId+'|'+String(input.clientOrderId).trim();
    const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',claimKey)[0];
    if(!row)return false;
    const claim=JSON.parse(String(row.payload));
    this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify({...claim,version:claim.version+1,status:'RELEASED'}),claimKey);
    return true;
  }

  /**
   * J1: the FIRST_FILL management deadline is fixed once and is never extended by a late fill, a
   * partial fill or a restart. Expiry only withdraws AI authority; protection stays in force.
   */
  fixManagementDeadline(subject:V396ExitSubject,durationMs:number,firstFillAt:number,planRef:string|null=null){
    const scope=this.scope(subject),cycleId=this.cycle(subject);
    if(!(Number.isSafeInteger(durationMs)&&durationMs>0)||!Number.isFinite(firstFillAt))return null;
    const existing=this.ownership.ownership(scope,cycleId);
    if(existing&&Number.isFinite(existing.deadline??Number.NaN))return existing;
    return this.journal.initialize({scope,cycleId,planRef:existing?.planRef??planRef,firstFillAt,durationMs,now:Math.max(Number(existing?.transitionedAt??0),firstFillAt),legacy:false});
  }

  /** JIT immediately before the wire call: authority, task state and proof must still hold. */
  jitBeforeSubmit(input:{subject:V396ExitSubject;clientOrderId:string;proofCheckedAt:number;now:number}){
    const blockers:string[]=[];
    const owner=this.ownership.ownership(this.scope(input.subject),this.cycle(input.subject));
    if(!owner)blockers.push('OWNER_UNTRACKED');
    else if(owner.ownerState==='CLOSED')blockers.push('CYCLE_CLOSED');
    const task=this.recoveryCoordinator.findTaskByClientOrderId(input.clientOrderId);
    if(!task)blockers.push('PREPARED_TASK_MISSING');
    else if(!OPEN_STATES.includes(task.state))blockers.push('TASK_NOT_SUBMITTABLE:'+task.state);
    if(Date.now()-input.now>2_000)blockers.push('JIT_WINDOW_STALE');
    if(input.now-input.proofCheckedAt>5_000)blockers.push('REDUCTION_PROOF_EXPIRED');
    return{allowed:blockers.length===0,blockers,task};
  }

  /**
   * P1: every reader of an exit order ends up here. A WS order report, an exact-order read, the
   * open-order reconciliation sweep, a cancel/replace result and startup recovery all produce the
   * same fact, so a TP that the exchange says is FILLED cannot update one projection while the
   * durable task and its quantity claim keep their previous state.
   */
  recordVerifiedExitOrderFacts(facts:Array<VerifiedExitOrderFact|null|undefined>,now=Date.now()){
    const usable=facts.filter((fact):fact is VerifiedExitOrderFact=>Boolean(fact));
    if(!usable.length)return{applied:[],skipped:[]};
    const result=this.recoveryCoordinator.applyVerifiedFacts(usable,now);
    // Only an identity this ledger actually owns is registered as a system exit order. An entry-order
    // report arrives through the same reader and must not be recorded with an exit role.
    for(const fact of usable){
      if(!this.recoveryCoordinator.findTaskByClientOrderId(fact.clientOrderId))continue;
      this.provenance.record({environment:fact.environment,accountId:fact.accountId,symbol:fact.symbol,
        clientOrderId:fact.clientOrderId,exchangeOrderId:fact.exchangeOrderId,role:'EXIT',source:fact.source,observedAt:fact.observedAt});
    }
    return result;
  }

  /** Builds and applies the single fact from one raw exchange order report. */
  recordExitOrderReport(source:ExitFactSource,order:Parameters<typeof normalizeExitOrderFact>[0]['order'],observedAt=Date.now()){
    const identity=this.exchangeIdentity();
    const fact=normalizeExitOrderFact({source,environment:identity.environment,accountId:identity.account,order,observedAt});
    return this.recordVerifiedExitOrderFacts([fact],observedAt);
  }

  /** Bounded-convergence operator readback: queue depth, oldest unpolled age, terminal unreleased. */
  convergenceStats(now=Date.now()){
    const authority=this.authority();
    const intervalMs=Number(authority.intervalMs??120_000),limit=Math.max(1,Math.min(20,Number(authority.batchLimit??8)));
    return{...this.recoveryCoordinator.convergenceStats(now,limit,intervalMs,this.queryDeadlineMs()),unreleasedClaims:this.recoveryCoordinator.unreleasedClaimInventory().length};
  }

  /** J1: is the bounded continuous convergence pass due yet? */
  convergenceDue(now=Date.now()){
    const authority=this.authority();
    if(authority.continuousEnabled===false)return{due:false as const,reason:'CONTINUOUS_CONVERGENCE_DISABLED' as const};
    const intervalMs=Number(authority.intervalMs??120_000),limit=Math.max(1,Math.min(20,Number(authority.batchLimit??8)));
    if(this.converging)return{due:false as const,reason:'CONVERGENCE_IN_FLIGHT' as const};
    if(now-this.lastConvergenceAt<intervalMs)return{due:false as const,reason:'CONVERGENCE_NOT_DUE' as const};
    return{due:true as const,intervalMs,limit};
  }

  /**
   * A query gets the pass interval to answer, with a floor: a batch of eight hung reads must not take
   * longer than the interval that bounds the whole walk.
   */
  private queryDeadlineMs(){
    const authority=this.authority() as {queryTimeoutMs?:number;intervalMs?:number};
    const configured=Number(authority.queryTimeoutMs??0);
    if(Number.isFinite(configured)&&configured>0)return Math.min(600_000,Math.trunc(configured));
    // Half the cadence, floored at five seconds: eight hung reads must not make one pass outlast the
    // interval that bounds the whole walk, or the published service bound stops meaning anything.
    return Math.max(5_000,Math.min(30_000,Math.trunc(Number(authority.intervalMs??120_000))/2));
  }

  /**
   * A query that never answers must not be able to park the whole walk. `converging` is only ever
   * cleared by this method, so without a deadline one hung signed read stops convergence for the
   * rest of the process' life - which is the same starvation this stage exists to remove, only quieter.
   * A deadline is recorded as a failed attempt for that one order, so it backs off and the rest
   * keep their turn.
   */
  private async answeredWithin<T>(work:Promise<T>,timeoutMs:number):
    Promise<{status:'answered';value:T}|{status:'rejected';error:unknown}|{status:'timeout'}>{
    // Settled before it is raced: a rejection that lost the race would otherwise surface as an
    // unhandled promise, and a rejection that won must stay a rejection the caller can name.
    const settled=work.then(value=>({status:'answered' as const,value}) as {status:'answered';value:T},
      error=>({status:'rejected' as const,error}) as {status:'rejected';error:unknown});
    let timer:NodeJS.Timeout|null=null;
    try{
      return await Promise.race([settled,new Promise<{status:'timeout'}>(resolve=>{
        timer=setTimeout(()=>resolve({status:'timeout'}),Math.max(1,timeoutMs));timer.unref?.();
      })]);
    }finally{if(timer)clearTimeout(timer);}
  }

  /**
   * P1: bounded continuous convergence with a durable fair walk.
   *
   * The queue is drained by `next_eligible_at, last_attempt_at`, not by insertion order, so a head
   * of long-running WORKING orders can no longer hold the whole batch and starve the tail. The
   * worst case for any single order is the published `ceil(open/limit) x interval`, and backoff
   * after a failed query applies only to the order that failed.
   */
  async convergePeriodically(query:(input:{symbol:string;clientOrderId:string})=>Promise<{state:'FOUND';order:any}|{state:'ABSENT';reason:string}>,now=Date.now()){
    const gate=this.convergenceDue(now);
    if(!gate.due)return{...gate,converged:[] as Array<{clientOrderId:string;outcome:string;state:ExitTaskState|null}>,attempted:0,stats:this.recoveryCoordinator.convergenceStats(now,gate.limit??8,120_000,this.queryDeadlineMs())};
    this.converging=true;this.lastConvergenceAt=now;
    try{
      const pending=this.recoveryCoordinator.fairConvergenceQueue(now,gate.limit);
      const converged=await this.convergeTasks(pending,query,now,gate.intervalMs);
      return{due:true,intervalMs:gate.intervalMs,limit:gate.limit,converged,attempted:pending.length,stats:this.recoveryCoordinator.convergenceStats(Date.now(),gate.limit,gate.intervalMs,this.queryDeadlineMs())};
    }
    finally{this.converging=false;}
  }
  async prepareTakeProfit(input:V396PrepareExitInput){
    const mandate=this.ensureGuardianMandate(input.subject,input.limitPrice,input.now);
    return this.prepare('TP',input,mandate);
  }

  /** Convert a live quantity into the integer units the claim budget is counted in. */
  static quantityUnitsOf(quantity:number,stepSize:number){
    if(!Number.isFinite(quantity)||!Number.isFinite(stepSize)||stepSize<=0)return 0;
    const units=Math.round((quantity+Number.EPSILON)/stepSize);
    return Number.isSafeInteger(units)&&units>0&&Math.abs(units*stepSize-quantity)<=1e-9?units:0;
  }

  /**
   * Parse the canonical scope back into the exchange identity a read-only query needs. A scope that
   * does not carry a full symbol and LONG/SHORT side is refused rather than guessed at.
   */
  static parseScope(scope:string){
    let parsed:unknown;
    try{parsed=JSON.parse(String(scope));}catch{return null;}
    if(!Array.isArray(parsed)||parsed.length!==4)return null;
    const [environment,account,symbol,side]=parsed.map(part=>String(part??'').trim());
    if(!environment||!account||!symbol||!['LONG','SHORT','BOTH','ENTRY'].includes(side))return null;
    return{environment,account,symbol,side} as {environment:string;account:string;symbol:string;side:'LONG'|'SHORT'|'BOTH'|'ENTRY'};
  }

  /** Non-terminal tasks a restart must re-prove before anything else may be submitted. */
  tasksNeedingQuery(now=Date.now()){return this.recoveryCoordinator.recoveryPlan(now).mustQuery;}

  /**
   * Startup/restart convergence: read-only exact queries against the stored clientOrderId.
   * FOUND converges the task, ABSENT or a failed query keeps it unacked - nothing here may submit.
   */
  async convergeRecoveredTasks(query:(input:{symbol:string;clientOrderId:string})=>Promise<{state:'FOUND';order:any}|{state:'ABSENT';reason:string}>,now=Date.now()){
    const entries=this.tasksNeedingQuery(now).map((entry:any)=>({task:this.recoveryCoordinator.findTaskByClientOrderId(String(entry.clientOrderId??'')),attemptCount:0}))
      .filter(entry=>Boolean(entry.task));
    return this.convergeTasks(entries,query,now,0);
  }

  /**
   * P1: one query loop for both startup and continuous convergence. Each entry is turned into a
   * verified fact and pushed through the single reducer; the scheduling bookkeeping is written even
   * when the query failed, because a task that could not be polled must still come round again.
   */
  private async convergeTasks(entries:Array<{task:ExitTask|null;attemptCount:number}>,query:(input:{symbol:string;clientOrderId:string})=>Promise<{state:'FOUND';order:any}|{state:'ABSENT';reason:string}>,now:number,intervalMs:number){
    const converged:Array<{clientOrderId:string;outcome:string;state:ExitTaskState|null}>=[];
    const schedule=(entry:{task:ExitTask|null},failed:boolean)=>{
      if(!entry.task||!intervalMs)return;
      this.recoveryCoordinator.recordAttempt(entry.task.taskId,now,{failed,intervalMs,attemptCount:Math.trunc(Number((entry as any).attemptCount??0))});
    };
    for(const entry of entries){
      const task=entry.task;
      if(!task){continue;}
      const identity=V396ExitRuntime.parseScope(task.scope);
      if(!identity||!['LONG','SHORT','BOTH'].includes(identity.side)){converged.push({clientOrderId:task.clientOrderId,outcome:'SCOPE_UNPARSEABLE',state:task.state});continue;}
      const currentIdentity=this.exchangeIdentity();
      if(identity.environment!==currentIdentity.environment||identity.account!==currentIdentity.account){converged.push({clientOrderId:task.clientOrderId,outcome:'ACCOUNT_SCOPE_MISMATCH',state:task.state});schedule(entry,false);continue;}
      let fact:Awaited<ReturnType<typeof query>>;
      // The deadline is the point: one signed read that never answers used to hold `converging` true
      // for the life of the process, and every later pass then reported CONVERGENCE_IN_FLIGHT while
      // the queue silently stopped draining. Both a failure and a deadline count as a failed attempt
      // for that one order, so it backs off on its own and the rest of the queue keeps its turn.
      const answered=await this.answeredWithin(query({symbol:identity.symbol,clientOrderId:task.clientOrderId}),this.queryDeadlineMs());
      if(answered.status==='timeout'){converged.push({clientOrderId:task.clientOrderId,outcome:'QUERY_DEADLINE_STAYS_UNACKED',state:task.state});schedule(entry,true);continue;}
      if(answered.status==='rejected'){converged.push({clientOrderId:task.clientOrderId,outcome:'QUERY_FAILED_STAYS_UNACKED',state:task.state});schedule(entry,true);continue;}
      fact=answered.value;
      if(fact?.state!=='FOUND'||!fact.order){
        if(task.state!=='UNKNOWN'&&task.state!=='SUBMITTING')this.recoveryCoordinator.markSubmitUncertain(task.taskId,now);
        converged.push({clientOrderId:task.clientOrderId,outcome:'EXCHANGE_ABSENT_STAYS_UNACKED',state:task.state==='PREPARED'?'PREPARED':'UNKNOWN'});
        schedule(entry,false);continue;
      }
      const verified=normalizeExitOrderFact({source:'EXACT_ORDER',environment:identity.environment,accountId:identity.account,order:fact.order,observedAt:now,reportId:`RECOVERY:${task.clientOrderId}:${String(fact.order.status??'').toUpperCase()}:${Math.round(Number(fact.order.executedQty??fact.order.executedQuantity??0)*1e8)}:${task.version}`});
      if(!verified){converged.push({clientOrderId:task.clientOrderId,outcome:'EXCHANGE_FACT_UNVERIFIED',state:task.state});schedule(entry,false);continue;}
      // Through the runtime's own entry point, not straight to the reducer: applying a verified
      // exchange answer is also the moment the order's provenance becomes a durable fact. Going to
      // the reducer here converged the task but left the registry empty, so the fill it produced
      // still read as UNPROVEN origin.
      const applied=this.recordVerifiedExitOrderFacts([verified],now);
      if(applied.skipped.length&&applied.applied.length===0)converged.push({clientOrderId:task.clientOrderId,outcome:`OBSERVE_REFUSED:${applied.skipped[0].reason}`,state:task.state});
      else converged.push({clientOrderId:task.clientOrderId,outcome:`EXCHANGE_FACT_${verified.state}`,state:verified.state});
      schedule(entry,false);
    }
    return converged;
  }

  abortTpNotSent(clientOrderId:string,error:unknown,proofRef:string,now=Date.now()){
    const task=this.task(clientOrderId),identity=this.exchangeIdentity();
    if(!task||task.source!=='TP'||identity.environment!=='TESTNET'||!confirmedTpNotSent(error))return null;
    const scope=V396ExitRuntime.parseScope(task.scope);
    if(scope?.environment!==identity.environment||scope?.account!==identity.account)return null;
    if(task.reasons.some(reason=>/EXCHANGE_FACT|_CONVERGED|TP_SUBMIT_RESULT/.test(reason)))return null;
    return this.recoveryCoordinator.abortProvenNotSent(clientOrderId,proofRef,now);
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
  /** The durable quantity claim behind one exit order: ACTIVE still pins units, RELEASED does not. */
  claimFor(clientOrderId:string){
    const task=this.recoveryCoordinator.findTaskByClientOrderId(clientOrderId);
    return task?this.recoveryCoordinator.claimFor(task.taskId):null;
  }
  openQueueLength(){return this.recoveryCoordinator.openQueueLength();}
  /** P2 read-side: has the durable registry proven that this order identity is ours? */
  provenanceFor(input:{symbol:string;clientOrderId?:string|null;exchangeOrderId?:string|null}){
    const identity=this.exchangeIdentity();
    return this.provenance.resolve({environment:identity.environment,accountId:identity.account,...input});
  }
  close(){this.provenance.close();this.journal.close();}
}

export function exitSubjectFromPosition(position:Position):V396ExitSubject{
  return{symbol:position.symbol,side:position.side,cycleId:position.cycleId??null,openedAt:position.openedAt??null};
}

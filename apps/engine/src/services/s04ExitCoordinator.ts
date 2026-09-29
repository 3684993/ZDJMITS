/**
 * S04: unified position-exit coordination, just-in-time re-verification and crash recovery.
 *
 * Offline module. It is deliberately not wired into EngineRuntime: G2 requires the
 * concurrency/crash matrix in s04ExitCoordination.test.ts to pass first, and runtime
 * activation of a new AI exit path additionally needs the S08 read-side plus S10
 * authorization. Nothing here reaches an exchange, a network, a live database, or the
 * existing TP/manual writers.
 *
 * Two properties carry the stage:
 *  - a submit intent is persisted with its clientOrderId before the caller is told to submit,
 *    and an unacknowledged request stays UNKNOWN against that same clientOrderId forever, so a
 *    retry can never fork a second order identity (I11);
 *  - quantity is claimed per canonical scope and cycle across AI/MANUAL/TP, so a partial fill,
 *    a cancel-replace or a concurrent human exit cannot double-spend the position or add
 *    exposure (I02, I03).
 */
import {createHash} from 'node:crypto';
import type {OwnershipJournal} from './ownershipJournal.js';
import type {AiExitVerdict} from './s03AiExitPolicy.js';
import type {VerifiedExitOrderFact} from './exitOrderFact.js';
import {exitFactProvesTerminal} from './exitOrderFact.js';

export type ExitTaskState='PREPARED'|'SUBMITTING'|'WORKING'|'PARTIALLY_FILLED'|'FILLED'|'CANCELED'|'REJECTED'|'EXPIRED'|'UNKNOWN';
export const TERMINAL_STATES:ExitTaskState[]=['FILLED','CANCELED','REJECTED','EXPIRED'];
export const OPEN_STATES:ExitTaskState[]=['PREPARED','SUBMITTING','WORKING','PARTIALLY_FILLED','UNKNOWN'];
export type ExitSource='AI'|'MANUAL'|'TP';

export type ExitTask={
  taskId:string;clientOrderId:string;scope:string;cycleId:string;source:ExitSource;
  quantityUnits:number;limitPrice:number;state:ExitTaskState;version:number;filledUnits:number;
  ownerVersion:number;planVersion:number;positionVersion:number;settingsVersion:number;riskGeneration:number;
  estimateHash:string;decisionHash:string;authorizationExpiresAt:number;deadline:number;
  createdAt:number;updatedAt:number;reasons:string[];stepSize:number;requestKey:string|null;mandateVersion?:number;
};

export type AdapterCapabilities={
  oneWayReduceOnly:boolean;hedgePositionSide:boolean;cancelReplaceAtomic:boolean;
  partialFillExpected:boolean;supportsTimeInForce:string[];positionMode:'ONE_WAY'|'HEDGE';
};

/** Everything the JIT re-read produced: the estimate recomputed from current facts, plus versions. */
export type JitFacts={
  now:number;ownerVersion:number;positionVersion:number;settingsVersion:number;riskGeneration:number;
  deadline:number;estimateHash:string;conservativeNet:number;availableReduceUnits:number;
  remainingUnits:number;minNotional:number;tickSize:number;stepSize:number;
};

export type CoordinatorResult={accepted:boolean;taskId:string|null;clientOrderId:string|null;reasons:string[];submitRequired:boolean;cause?:string|null;conflict?:{scope:string;taskId:string|null;clientOrderId:string|null;state:ExitTaskState|null;intentId?:string|null;at?:number|null}|null};

/**
 * Scheduling columns added in the V3.9.7 exit-convergence work. They are additive with defaults, so
 * a build that predates them still reads this ledger - the layout stamp is reported, not bumped,
 * which keeps a rollback open.
 */
export const EXIT_TASK_SCHEDULING_COLUMNS=['last_attempt_at','next_eligible_at','attempt_count'] as const;

const DDL=`
CREATE TABLE IF NOT EXISTS v396_exit_tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,scope TEXT NOT NULL,cycle_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v396_exit_task_scope ON v396_exit_tasks(scope,cycle_id);
CREATE TABLE IF NOT EXISTS v396_exit_observed(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,observed_at INTEGER NOT NULL);
`;

const SCHEDULING_DDL=[
  'ALTER TABLE v396_exit_tasks ADD COLUMN last_attempt_at INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE v396_exit_tasks ADD COLUMN next_eligible_at INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE v396_exit_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0',
  'CREATE INDEX IF NOT EXISTS v396_exit_task_service ON v396_exit_tasks(next_eligible_at,last_attempt_at,id)',
];
const OPEN_STATE_SQL=`('PREPARED','SUBMITTING','WORKING','PARTIALLY_FILLED','UNKNOWN')`;

/**
 * Canonical exit scope is `[environment,account,symbol,positionSide]`. Parsing it back is what lets
 * one reducer verify that a fact from a reader really belongs to the task it claims to close,
 * instead of trusting a client order id that arrived from an unrelated symbol.
 */
export function parseExitScope(scope:string){
  let parsed:unknown;
  try{parsed=JSON.parse(String(scope));}catch{return null;}
  if(!Array.isArray(parsed)||parsed.length!==4)return null;
  const [environment,account,symbol,side]=parsed.map(part=>String(part??'').trim());
  if(!environment||!account||!symbol)return null;
  return{environment,account,symbol:symbol.toUpperCase(),side:side.toUpperCase()};
}

/** Quantity budget is counted in whole step units; a remainder that is not a whole unit is not a fact. */
export function exitQuantityUnits(quantity:number,stepSize:number){
  if(!Number.isFinite(quantity)||!Number.isFinite(stepSize)||stepSize<=0)return 0;
  const units=Math.round((quantity+Number.EPSILON)/stepSize);
  return Number.isSafeInteger(units)&&units>=0&&Math.abs(units*stepSize-quantity)<=1e-9?units:0;
}

const TRANSITIONS:Record<ExitTaskState,ExitTaskState[]>={
  PREPARED:['SUBMITTING','UNKNOWN','CANCELED','REJECTED'],
  SUBMITTING:['WORKING','PARTIALLY_FILLED','FILLED','CANCELED','UNKNOWN','REJECTED'],
  WORKING:['PARTIALLY_FILLED','FILLED','CANCELED','UNKNOWN','EXPIRED'],
  PARTIALLY_FILLED:['PARTIALLY_FILLED','FILLED','CANCELED','UNKNOWN','EXPIRED'],
  UNKNOWN:[],FILLED:[],CANCELED:[],REJECTED:[],EXPIRED:[],
};

export class PositionExitCoordinator {
  constructor(private readonly journal:OwnershipJournal,private readonly capabilities:AdapterCapabilities){
    journal.transact(()=>{for(const statement of DDL.split(';').filter(part=>part.trim()))journal.write(statement);});
    journal.transact(()=>{
      const stored=new Set((journal.query<{name:string}>('PRAGMA table_info(v396_exit_tasks)').map(row=>String(row.name))));
      for(const statement of SCHEDULING_DDL){
        const column=statement.match(/ADD COLUMN (\w+)/)?.[1];
        if(column&&stored.has(column))continue;
        try{journal.write(statement);}catch(error){if(!String(error).includes('duplicate column name'))throw error;}
      }
    });
  }

  tasksFor(scope:string,cycleId:string):ExitTask[]{
    return this.journal.query<{payload:string}>('SELECT payload FROM v396_exit_tasks WHERE scope=? AND cycle_id=?',scope,cycleId).map(row=>JSON.parse(String(row.payload)) as ExitTask);
  }

  allTasks():ExitTask[]{
    return this.journal.query<{payload:string}>('SELECT payload FROM v396_exit_tasks').map(row=>JSON.parse(String(row.payload)) as ExitTask);
  }

  private persist(task:ExitTask){
    this.journal.write('INSERT INTO v396_exit_tasks(id,payload,state,scope,cycle_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,state=excluded.state',task.taskId,JSON.stringify(task),task.state,task.scope,task.cycleId);
    this.journal.write('INSERT INTO v396_outbox(id,payload,delivered) VALUES(?,?,0) ON CONFLICT(id) DO NOTHING',JSON.stringify([task.scope,task.cycleId,task.taskId,task.version]),JSON.stringify({type:'EXIT_TASK_UPDATED',payload:{task}}));
  }

  /**
   * P1: the durable task and its quantity claim are one ledger, so a terminal fact must reach both
   * in the same transaction. `settleClaim` only ever marks a claim RELEASED after this method has
   * proved the identity, which is what keeps "local says FILLED" from freeing capacity.
   */
  private settleClaim(task:ExitTask,proof:string[]){
    const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',`claim:${task.taskId}`)[0];
    if(!row)return;
    const claim=JSON.parse(String(row.payload)) as {version:number};
    this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify({...claim,version:claim.version+1,status:'RELEASED',releasedAt:task.updatedAt,releasedBy:[...proof],quantityUnitsAtRelease:task.quantityUnits-task.filledUnits}),`claim:${task.taskId}`);
  }

  /**
   * The submit identity is owned by the caller's request, not by its size: with a requestKey the
   * seed is scope|cycle|source|requestKey, so a retry of one intent is constant while a later intent
   * in the same cycle legitimately gets a new ID. Without a requestKey the legacy quantity seed is
   * kept, which is what the offline S04 matrix was written against.
   */
  private clientOrderIdFor(scope:string,cycleId:string,source:ExitSource,quantityUnits:number,requestKey?:string){
    const key=String(requestKey??'').trim();
    const seed=JSON.stringify([scope,cycleId,source,key?'REQUEST':'QUANTITY',key||quantityUnits]);
    return `v396x${createHash('sha256').update(seed).digest('hex').slice(0,30)}`;
  }

  private reserveClaim(task:ExitTask){
    this.journal.write('INSERT INTO v396_quantity_claims VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',`claim:${task.taskId}`,task.scope,JSON.stringify({scope:task.scope,cycleId:task.cycleId,source:task.source,claimId:`claim:${task.taskId}`,quantityUnits:task.quantityUnits,version:1,status:'ACTIVE'}));
  }

  /**
   * S04-A/S04-C: the single entry point. Verdict freshness, JIT re-verification, the shared
   * quantity budget and the PREPARED row are decided in one transaction, and the row exists
   * before the caller is told a request may go out.
   */
  requestExit(input:{scope:string;cycleId:string;source:ExitSource;quantityUnits:number;verdict:AiExitVerdict;jit:JitFacts;mandate?:{version:number;revokedAt:number|null}|null;requestKey?:string}):CoordinatorResult{
    return this.journal.transact<CoordinatorResult>(()=>{
      const {verdict,jit}=input;
      const reject=(...reasons:string[]):CoordinatorResult=>({accepted:false,taskId:null,clientOrderId:null,reasons,submitRequired:false,cause:reasons[0]??'UNSPECIFIED_REFUSAL'});
      if(!input.scope||!input.cycleId)return reject('IDENTITY_MISSING');
      if(!['AI','MANUAL','TP'].includes(input.source))return reject('SOURCE_INVALID');
      if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)return reject('QUANTITY_INVALID');
      for(const [name,value] of Object.entries({now:jit.now,ownerVersion:jit.ownerVersion,positionVersion:jit.positionVersion,settingsVersion:jit.settingsVersion,riskGeneration:jit.riskGeneration,availableReduceUnits:jit.availableReduceUnits,remainingUnits:jit.remainingUnits,minNotional:jit.minNotional,tickSize:jit.tickSize,stepSize:jit.stepSize})){
        if(typeof value!=='number'||!Number.isFinite(value))return reject(`JIT_FACT_NOT_FINITE:${name}`);
      }
      if(!Number.isSafeInteger(jit.availableReduceUnits)||jit.availableReduceUnits<0)return reject('JIT_AVAILABILITY_UNPROVEN');
      if(!Number.isSafeInteger(jit.remainingUnits)||jit.remainingUnits<0||jit.stepSize<=0||jit.tickSize<=0||jit.minNotional<0)return reject('JIT_FILTERS_INVALID');

      if(verdict.outcome!=='ALLOW')return reject('VERDICT_NOT_ALLOW');
      if(verdict.orderType!=='LIMIT'||verdict.marketFallbackAllowed!==false)return reject('VERDICT_ORDER_TYPE_UNSAFE');
      if(!verdict.estimateHash||!verdict.decisionHash)return reject('VERDICT_IDENTITY_MISSING');
      if(!(verdict.authorizationExpiresAt!=null&&verdict.authorizationExpiresAt>jit.now))return reject('AUTHORIZATION_EXPIRED_OR_EMPTY');
      if(verdict.boundaryPrice==null||!Number.isFinite(verdict.boundaryPrice)||verdict.boundaryPrice<=0)return reject('BOUNDARY_PRICE_MISSING');
      if(jit.deadline==null||!Number.isFinite(jit.deadline)||jit.now>=jit.deadline)return reject('AI_MANAGEMENT_EXPIRED');

      // JIT: recompute the estimate from the facts that exist right now. A different hash means
      // the world moved, so this decision is void - the caller must not re-price and continue.
      if(jit.estimateHash!==verdict.estimateHash)return reject(`JIT_ESTIMATE_STALE:${verdict.estimateHash}->${jit.estimateHash}`);
      if(jit.ownerVersion!==verdict.ownerVersion)return reject(`JIT_OWNER_DRIFT:${verdict.ownerVersion}->${jit.ownerVersion}`);
      if(verdict.conservativeNet!=null&&Math.round(verdict.conservativeNet*1_000)!==Math.round(jit.conservativeNet*1_000))return reject(`JIT_NET_DRIFT:${verdict.conservativeNet}->${jit.conservativeNet}`);

      // The adapter must be able to prove a reduction cannot become an increase.
      if(this.capabilities.positionMode==='HEDGE'&&!this.capabilities.hedgePositionSide)return reject('HEDGE_MODE_UNSUPPORTED');
      if(this.capabilities.positionMode==='ONE_WAY'&&!this.capabilities.oneWayReduceOnly)return reject('REDUCE_ONLY_UNPROVEN');
      if(input.source==='AI'&&!this.capabilities.oneWayReduceOnly&&!this.capabilities.hedgePositionSide)return reject('ADAPTER_CANNOT_PROVE_NO_EXPOSURE_INCREASE');

      const existing=this.tasksFor(input.scope,input.cycleId);
      // The request key is required at the production bridge (V396ExitRuntime); the offline S04
      // semantics stay valid without one, where the quantity itself is the intent identity.
      const requestKey=String(input.requestKey??'').trim()||null;
      const clientOrderId=this.clientOrderIdFor(input.scope,input.cycleId,input.source,input.quantityUnits,requestKey??undefined);
      const scopeTasks=this.allTasks().filter(task=>task.scope===input.scope);
      const open=scopeTasks.filter(task=>OPEN_STATES.includes(task.state));
      const taskClaims=new Set(scopeTasks.map(task=>`claim:${task.taskId}`));
      const externalClaims=this.journal.query<{id:string;payload:string}>('SELECT id,payload FROM v396_quantity_claims WHERE scope=?',input.scope).filter(row=>!taskClaims.has(row.id)).map(row=>JSON.parse(row.payload));
      if(externalClaims.some(claim=>!['ACTIVE','UNKNOWN','RELEASED'].includes(claim.status)||!Number.isSafeInteger(claim.quantityUnits)||claim.quantityUnits<0))return reject('SHARED_CLAIM_FACTS_INVALID');
      const openUnits=open.reduce((sum,task)=>sum+task.quantityUnits-task.filledUnits,0)+externalClaims.filter(claim=>claim.status!=='RELEASED').reduce((sum,claim)=>sum+claim.quantityUnits,0);
      if(!Number.isSafeInteger(openUnits))return reject('SHARED_CLAIM_OVERFLOW');
      // An intent this caller already prepared is answered by identity first - and only that
      // caller, and only while it is still PREPARED, may be told to submit it. Coordination
      // conflicts are then judged for a new intent, so a different source can never read
      // 'already prepared' as licence to submit somebody else's order (I11).
      const replayed=existing.find(task=>task.clientOrderId===clientOrderId||task.source===input.source&&(requestKey?task.requestKey===requestKey:!task.requestKey&&task.quantityUnits===input.quantityUnits));
      if(replayed){
        if(replayed.quantityUnits!==input.quantityUnits||replayed.limitPrice!==verdict.boundaryPrice||replayed.stepSize!==jit.stepSize)return reject('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return {accepted:false,taskId:replayed.taskId,clientOrderId:replayed.clientOrderId,reasons:['IDEMPOTENCY_KEY_ALREADY_PREPARED'],submitRequired:replayed.source===input.source&&replayed.state==='PREPARED'};
      }
      if(input.source==='TP'&&open.some(task=>task.state==='SUBMITTING'||task.state==='UNKNOWN'))return reject('TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT');
      if(open.some(task=>task.state==='UNKNOWN')&&input.source!=='MANUAL')return reject('UNKNOWN_EXIT_MUST_CONVERGE_FIRST');
      // A mandate the human revoked stays revoked: protection may be restored only under a
      // valid mandate, never by a retry path that treats 'no TP row' as permission to re-arm (I07).
      if(input.source==='TP'&&input.mandate&&input.mandate.revokedAt!=null)return reject('MANDATE_REVOKED_BY_HUMAN');
      const reducible=Math.min(jit.remainingUnits,jit.availableReduceUnits)-openUnits;
      if(input.quantityUnits>reducible)return reject(`QUANTITY_BUDGET_EXCEEDED:reducible=${Math.max(0,reducible)}`,`OPEN_CLAIM_UNITS=${openUnits}`);
      if(verdict.boundaryPrice*input.quantityUnits*jit.stepSize<jit.minNotional)return reject('NOTIONAL_TOO_SMALL');
      if(Math.abs(verdict.boundaryPrice/jit.tickSize-Math.round(verdict.boundaryPrice/jit.tickSize))>1e-9)return reject('PRICE_NOT_TICK_ALIGNED');

      const task:ExitTask={
        taskId:`exit_${clientOrderId}`,clientOrderId,scope:input.scope,cycleId:input.cycleId,source:input.source,
        quantityUnits:input.quantityUnits,limitPrice:verdict.boundaryPrice,state:'PREPARED',version:1,filledUnits:0,
        ownerVersion:verdict.ownerVersion,planVersion:verdict.planVersion,positionVersion:jit.positionVersion,settingsVersion:jit.settingsVersion,riskGeneration:jit.riskGeneration,
        estimateHash:verdict.estimateHash,decisionHash:verdict.decisionHash,authorizationExpiresAt:verdict.authorizationExpiresAt!,deadline:jit.deadline,
        createdAt:jit.now,updatedAt:jit.now,reasons:[],stepSize:jit.stepSize,requestKey,...(input.mandate?{mandateVersion:input.mandate.version}:{}),
      };
      this.reserveClaim(task);
      this.persist(task);
      return {accepted:true,taskId:task.taskId,clientOrderId,reasons:['TASK_PREPARED_PERSISTED'],submitRequired:true};
    });
  }

  transition(taskId:string,next:ExitTaskState,now:number,reason:string):ExitTask|null{
    return this.journal.transact(()=>{
      const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_exit_tasks WHERE id=?',taskId)[0];
      if(!row)return null;
      const task=JSON.parse(String(row.payload)) as ExitTask;
      if(!TRANSITIONS[task.state]?.includes(next))return null;
      if(!Number.isFinite(now)||now<task.updatedAt)return null;
      // Once a write may have happened, only observe(exchange facts) may free its claim.
      if(TERMINAL_STATES.includes(next)&&task.state!=='PREPARED')return null;
      if(next==='SUBMITTING'){
        if(now>=task.authorizationExpiresAt||now>=task.deadline)return null;
        const owner=this.journal.get(task.scope,task.cycleId);
        if(owner&&(owner.ownerVersion!==task.ownerVersion||owner.ownerState==='CLOSED'||task.source==='AI'&&owner.ownerState!=='AI_ACTIVE'))return null;
        if(task.source==='TP'&&task.mandateVersion!=null){
          const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_mandates WHERE scope=? AND cycle_id=?',task.scope,task.cycleId)[0];
          const mandate=row?JSON.parse(row.payload):null;
          if(!mandate||mandate.version!==task.mandateVersion||mandate.revokedAt!=null||mandate.allowedPrice!==task.limitPrice)return null;
        }
      }
      const moved:ExitTask={...task,state:next,version:task.version+1,updatedAt:now,reasons:[...task.reasons,reason]};
      this.persist(moved);
      if(TERMINAL_STATES.includes(next))this.settleClaim(moved,['LOCAL_TRANSITION',reason]);
      return moved;
    });
  }

  /**
   * P1: the fair convergence queue.
   *
   * The previous pass took `tasksNeedingQuery().slice(0,8)`, and because a still-WORKING head item
   * became eligible again on the very next interval, the same eight orders were re-polled forever
   * while a terminal order at index 13/24/28 never got its query. Ordering by the persisted
   * `next_eligible_at` then `last_attempt_at` makes the walk a durable round-robin: an order that
   * was just serviced goes to the back, and one that nobody has polled sits at the front until it is.
   */
  fairConvergenceQueue(now:number,limit:number){
    const bounded=Math.max(1,Math.min(64,Math.trunc(Number(limit)||1)));
    const rows=this.journal.query<{id:string;payload:string,next_eligible_at:number,last_attempt_at:number,attempt_count:number}>(
      `SELECT id,payload,next_eligible_at,last_attempt_at,attempt_count FROM v396_exit_tasks WHERE state IN ${OPEN_STATE_SQL} AND next_eligible_at<=? ORDER BY next_eligible_at ASC,last_attempt_at ASC,id ASC LIMIT ?`,now,bounded);
    return rows.map(row=>({task:JSON.parse(String(row.payload)) as ExitTask,nextEligibleAt:Number(row.next_eligible_at),lastAttemptAt:Number(row.last_attempt_at),attemptCount:Number(row.attempt_count)}));
  }

  /** The full unserviced queue depth, independent of the batch that is eligible right now. */
  openQueueLength(){return this.journal.query<{c:number}>(`SELECT COUNT(*) c FROM v396_exit_tasks WHERE state IN ${OPEN_STATE_SQL}`)[0]?.c??0;}

  /**
   * Records that a query was made. The backoff lands on the single task that failed, never on the
   * queue: a repeatedly time-outing order must not push every other order further away.
   */
  recordAttempt(taskId:string,now:number,input:{failed:boolean;intervalMs:number;maxBackoffMs?:number;attemptCount:number}){
    const interval=Math.max(1_000,Math.floor(Number(input.intervalMs)||120_000));
    const ceiling=Math.max(interval,Math.floor(Number(input.maxBackoffMs??Math.max(interval,15*60_000))));
    const delay=input.failed?Math.min(ceiling,interval*2**Math.max(0,Math.min(6,Math.trunc(input.attemptCount)))):interval;
    this.journal.write('UPDATE v396_exit_tasks SET last_attempt_at=?,next_eligible_at=?,attempt_count=? WHERE id=?',now,now+delay,Math.trunc(input.attemptCount)+1,taskId);
    return{lastAttemptAt:now,nextEligibleAt:now+delay,attemptCount:Math.trunc(input.attemptCount)+1};
  }

  /**
   * P1 operator readback: how deep the queue is, how long the least-serviced order has waited, how
   * many terminal orders still pin a claim, and the interval within which a healthy queue must be
   * fully walked. `terminalUnreleasedClaims` is the direct proof that convergence is not stalled.
   */
  convergenceStats(now:number,batchLimit:number,intervalMs:number,queryDeadlineMs=30_000){
    const open=this.journal.query<{id:string;state:string;next_eligible_at:number;last_attempt_at:number;attempt_count:number;payload:string}>(
      `SELECT id,state,next_eligible_at,last_attempt_at,attempt_count,payload FROM v396_exit_tasks WHERE state IN ${OPEN_STATE_SQL}`);
    const neverPolled=open.filter(row=>Number(row.last_attempt_at)===0).length;
    // A waiting age has to be a real age. A task this process never polled is measured from its
    // durable creation time, otherwise the readback would report "since the epoch" (1.7e12 ms) and
    // an operator could not tell a fresh queue from a starved one.
    const ageOf=(row:{last_attempt_at:number;payload:string})=>{
      const attempted=Number(row.last_attempt_at);
      if(attempted>0)return Math.max(0,now-attempted);
      let created=0;
      try{created=Math.trunc(Number((JSON.parse(String(row.payload)) as {createdAt?:number}).createdAt??0));}catch{created=0;}
      return Math.max(0,now-(created>0?created:now));
    };
    const ages=open.map(ageOf);
    const oldestUnpolledAgeMs=ages.length?Math.max(...ages):0;
    const nextDue=open.map(row=>Number(row.next_eligible_at)).filter(value=>value>now);
    const terminalUnreleased=this.journal.query<{c:number}>(
      `SELECT COUNT(*) c FROM v396_exit_tasks task JOIN v396_quantity_claims claim ON claim.id='claim:'||task.id
        WHERE task.state IN ('FILLED','CANCELED','REJECTED','EXPIRED') AND json_extract(claim.payload,'$.status')='ACTIVE'`)[0]?.c??0;
    const batch=Math.max(1,Math.min(64,Math.trunc(Number(batchLimit)||1)));
    const fullWalkRounds=Math.ceil(open.length/batch);
    return{
      evaluatedAt:now,openTasks:open.length,eligibleNow:open.filter(row=>Number(row.next_eligible_at)<=now).length,
      neverPolled,oldestUnpolledAgeMs,nextEligibleAt:nextDue.length?Math.min(...nextDue):null,
      terminalUnreleasedClaims:terminalUnreleased,batchLimit:batch,intervalMs,
      nominalServiceIntervalMs:fullWalkRounds*intervalMs,
      maxServiceIntervalMs:fullWalkRounds*(intervalMs+batch*queryDeadlineMs+5_000),fullWalkRounds,
      serviceBoundBasis:'FIXED_QUEUE_PER_QUERY_DEADLINE_PLUS_CADENCE_EXCLUDES_FAILURE_BACKOFF',queryDeadlineMs,
      fairness:'PERSISTED_ROUND_ROBIN_NEXT_ELIGIBLE_THEN_LAST_ATTEMPT',
      schedulingColumnsPresent:this.journal.query<{name:string}>('PRAGMA table_info(v396_exit_tasks)').map(row=>String(row.name)).filter(name=>(EXIT_TASK_SCHEDULING_COLUMNS as readonly string[]).includes(name)).length,
    };
  }

  /** Claims still ACTIVE that no durable task owns: adopted-remote and unacknowledged exposures. */
  unreleasedClaimInventory(){
    const taskClaims=new Set(this.allTasks().map(task=>`claim:${task.taskId}`));
    return this.journal.query<{id:string;scope:string;payload:string}>('SELECT id,scope,payload FROM v396_quantity_claims')
      .map(row=>({row,claim:JSON.parse(String(row.payload)) as {status?:string;quantityUnits?:number;cycleId?:string|null;clientOrderId?:string|null;adopted?:boolean}}))
      .filter(({claim})=>claim.status==='ACTIVE')
      .map(({row,claim})=>({id:row.id,scope:row.scope,cycleId:claim.cycleId??null,clientOrderId:claim.clientOrderId??null,quantityUnits:Number(claim.quantityUnits??0),ownedByTask:taskClaims.has(row.id),adopted:claim.adopted===true}));
  }

  /**
   * P1: one idempotent reducer for every verified exit-order fact, whoever produced it.
   *
   * Rules the root-cause audit demanded: terminal states only advance (a late WORKING report can
   * never roll a FILLED order back), a partial fill updates the remainder instead of the whole
   * claim, and a claim is released only on a fact whose own coverage proves identity plus terminal.
   * An order from an already-closed physical cycle still converges here - the reducer keys on the
   * durable clientOrderId and never asks whether a position with that symbol is currently open.
   */
  applyVerifiedFacts(facts:VerifiedExitOrderFact[],now:number){
    return this.journal.transact(()=>{
      const applied:Array<{taskId:string;clientOrderId:string;from:ExitTaskState;to:ExitTaskState;claimReleased:boolean;remainingUnits:number}>=[];
      const skipped:Array<{eventId:string;clientOrderId:string;reason:string}>=[];
      for(const fact of facts){
        const note=(reason:string)=>{skipped.push({eventId:fact.eventId,clientOrderId:fact.clientOrderId,reason});};
        if(this.journal.query<{event_id:string}>('SELECT event_id FROM v396_exit_observed WHERE event_id=?',fact.eventId)[0]){note('DUPLICATE_EVENT');continue;}
        if(!fact.clientOrderId||!fact.symbol){note('FACT_IDENTITY_MISSING');continue;}
        if(!fact.coverage.proven){note(`FACT_COVERAGE_UNPROVEN:${fact.coverage.reason??'NONE'}`);continue;}
        const task=this.findTaskByClientOrderId(fact.clientOrderId);
        if(!task){note(`UNBOUND_ORDER:${fact.clientOrderId}`);continue;}
        // Identity is the whole point of routing every reader through one reducer: a fact whose
        // symbol or account contradicts the durable task is not evidence about that order, however
        // confidently the reader states it.
        const scopeIdentity=parseExitScope(task.scope);
        if(!scopeIdentity){note(`SCOPE_UNPARSEABLE:${task.taskId}`);continue;}
        if(scopeIdentity.symbol!==fact.symbol.toUpperCase()||scopeIdentity.environment!==fact.environment||scopeIdentity.account!==fact.accountId){note('FACT_IDENTITY_MISMATCH');continue;}
        if(TERMINAL_STATES.includes(task.state)){
          this.journal.write('INSERT INTO v396_exit_observed(event_id,payload,observed_at) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING',fact.eventId,JSON.stringify(fact),now);
          note(task.state===fact.state?'TERMINAL_ALREADY_CONVERGED':`TERMINAL_TASK_NO_REGRESSION:${task.state}<-${fact.state}`);continue;
        }
        if(!Number.isSafeInteger(now)||now<task.createdAt){note('INVALID_OBSERVATION_CLOCK');continue;}
        const units=(quantity:number)=>exitQuantityUnits(quantity,task.stepSize);
        const factOriginalUnits=units(fact.originalQty),factFilledUnits=units(fact.executedQty);
        if(factOriginalUnits<=0||factFilledUnits<0){note('FACT_QUANTITY_NOT_REPRESENTABLE_IN_STEP');continue;}
        if(factOriginalUnits!==task.quantityUnits){note(`QUANTITY_IDENTITY_MISMATCH:${factOriginalUnits}!=${task.quantityUnits}`);continue;}
        if(factFilledUnits>task.quantityUnits){note(`OVER_FILL:${factFilledUnits}>${task.quantityUnits}`);continue;}
        if(factFilledUnits<task.filledUnits){note(`FILL_REGRESSION:${factFilledUnits}<${task.filledUnits}`);continue;}
        if(fact.state==='FILLED'&&factFilledUnits!==task.quantityUnits){note('FILLED_WITHOUT_FULL_FILL_UNITS');continue;}
        const resolvingUncertain=task.state==='UNKNOWN';
        if(!resolvingUncertain&&task.state!=='PREPARED'&&fact.state!==task.state&&!TRANSITIONS[task.state]?.includes(fact.state)){note(`ILLEGAL_TRANSITION:${task.state}->${fact.state}`);continue;}
        const next:ExitTask={...task,state:fact.state,filledUnits:Math.max(task.filledUnits,factFilledUnits),version:task.version+1,updatedAt:now,
          reasons:[...task.reasons,`${fact.source}_CONVERGED${resolvingUncertain?'_FROM_UNKNOWN':''}`]};
        this.persist(next);
        const claimId=`claim:${next.taskId}`;
        const terminal=exitFactProvesTerminal(fact);
        const saved=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',claimId)[0];
        if(saved){
          const claim=JSON.parse(saved.payload) as {version:number};
          if(terminal)this.journal.write('INSERT INTO v396_claims_history(id,payload,settled_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,settled_at=excluded.settled_at',claimId,saved.payload,now);
          this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify({...claim,version:claim.version+1,quantityUnits:next.quantityUnits-next.filledUnits,clientOrderId:next.clientOrderId}),claimId);
        }
        this.journal.write('INSERT INTO v396_exit_observed(event_id,payload,observed_at) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING',fact.eventId,JSON.stringify(fact),now);
        // A terminal claim release goes through settleClaim so the same proof that closed the task
        // is the proof recorded as having released the quantity.
        if(terminal)this.settleClaim(next,[fact.source,...fact.coverage.proof]);
        applied.push({taskId:next.taskId,clientOrderId:next.clientOrderId,from:task.state,to:next.state,claimReleased:terminal,remainingUnits:next.quantityUnits-next.filledUnits});
      }
      return{applied,skipped};
    });
  }


  /** S04-T02/T06: ack lost keeps the identity and refuses a second submit path. */
  markSubmitUncertain(taskId:string,now:number){return this.transition(taskId,'UNKNOWN',now,'SUBMIT_ACK_LOST_MUST_QUERY_BY_CLIENT_ORDER_ID');}

  /** S04-T03/T07: converge exchange facts, idempotent per event and monotone per version. */
  observe(events:Array<{eventId:string;clientOrderId:string;state:ExitTaskState;filledUnits:number;positionVersion:number}>,now:number){
    return this.journal.transact(()=>{
      const applied:string[]=[],skipped:string[]=[];
      for(const event of events){
        const record=(note:string)=>{skipped.push(note);this.journal.write('INSERT INTO v396_exit_observed(event_id,payload,observed_at) VALUES(?,?,?) ON CONFLICT(event_id) DO NOTHING',event.eventId,JSON.stringify(event),now);};
        if(this.journal.query<{event_id:string}>('SELECT event_id FROM v396_exit_observed WHERE event_id=?',event.eventId)[0]){skipped.push(`DUPLICATE:${event.eventId}`);continue;}
        if(!Number.isSafeInteger(event.filledUnits)||event.filledUnits<0||!Number.isSafeInteger(event.positionVersion)){record('INVALID_FACT');continue;}
        if(!['WORKING','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED','EXPIRED'].includes(event.state)){record('INVALID_EXCHANGE_STATE');continue;}
        const task=this.findTaskByClientOrderId(event.clientOrderId);
        if(!task){record(`UNBOUND_ORDER:${event.clientOrderId}`);continue;}
        if(TERMINAL_STATES.includes(task.state)){record(`TERMINAL_TASK:${task.taskId}`);continue;}
        if(event.positionVersion<task.positionVersion){record(`STALE_WATERMARK:${event.eventId}`);continue;}
        if(event.filledUnits>task.quantityUnits){record(`OVER_FILL:${event.filledUnits}>${task.quantityUnits}`);continue;}
        if(event.state==='FILLED'&&event.filledUnits!==task.quantityUnits||event.state==='PARTIALLY_FILLED'&&(event.filledUnits===0||event.filledUnits>=task.quantityUnits)){record('INCONSISTENT_FILL_STATE');continue;}
        if(event.filledUnits<task.filledUnits){record(`FILL_REGRESSION:${event.filledUnits}<${task.filledUnits}`);continue;}
        // UNKNOWN may only be resolved by an exchange fact, never by a local guess:
        // transition() refuses to leave UNKNOWN, while observe() accepts whatever the query
        // proves. Without that, the claim of an unacknowledged order would hang forever and
        // keep occupying risk with no route to convergence.
        const resolvingUncertain=task.state==='UNKNOWN';
        if(!resolvingUncertain&&task.state!=='PREPARED'&&event.state!==task.state&&!TRANSITIONS[task.state]?.includes(event.state)){record(`ILLEGAL_TRANSITION:${task.state}->${event.state}`);continue;}
        const next:ExitTask={...task,state:event.state,filledUnits:event.filledUnits,positionVersion:event.positionVersion,version:task.version+1,updatedAt:now,reasons:[...task.reasons,resolvingUncertain?'EXCHANGE_FACT_RESOLVED_UNKNOWN':'EXCHANGE_FACT_CONVERGED']};
        this.persist(next);
        const claimId=`claim:${next.taskId}`;
        const savedClaim=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',claimId)[0];
        if(savedClaim)this.journal.write('INSERT INTO v396_claims_history(id,payload,settled_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,settled_at=excluded.settled_at',claimId,savedClaim.payload,now);
        if(savedClaim){const claim=JSON.parse(savedClaim.payload);this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify({...claim,quantityUnits:next.quantityUnits-next.filledUnits,version:claim.version+1,status:'ACTIVE'}),claimId);}
        this.journal.write('INSERT INTO v396_exit_observed(event_id,payload,observed_at) VALUES(?,?,?)',event.eventId,JSON.stringify(event),now);
        if(TERMINAL_STATES.includes(next.state))this.settleClaim(next,['LEGACY_OBSERVE',event.state]);
        applied.push(`${next.taskId}:${next.state}`);
      }
      return {applied,skipped};
    });
  }

  /** The quantity claim attached to one task, whatever its current status. */
  claimFor(taskId:string){
    const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',`claim:${taskId}`)[0];
    return row?(JSON.parse(String(row.payload)) as {status:string;quantityUnits:number;version:number;clientOrderId?:string|null}):null;
  }

  findTaskByClientOrderId(clientOrderId:string):ExitTask|null{
    const row=this.allTasks().find(task=>task.clientOrderId===clientOrderId);
    return row??null;
  }

  /** S04-E: startup recovery. Only queries and warnings; never re-submits or re-authorizes. */
  recoveryPlan(now:number){
    const open=this.allTasks().filter(task=>OPEN_STATES.includes(task.state));
    return {
      mustQuery:open.map(task=>({clientOrderId:task.clientOrderId,taskId:task.taskId,state:task.state})),
      protectionGaps:[...new Set(open.filter(task=>task.source!=='TP').map(task=>task.scope))],
      lapsedAuthority:open.filter(task=>task.authorizationExpiresAt<=now||task.deadline<=now).map(task=>task.taskId),
      blockedNewAiWrites:open.length>0,
      closedCycleRevivals:0,
    };
  }

  openClaimUnits(scope:string,cycleId:string){
    return this.tasksFor(scope,cycleId).filter(task=>OPEN_STATES.includes(task.state)).reduce((sum,task)=>sum+task.quantityUnits-task.filledUnits,0);
  }
}

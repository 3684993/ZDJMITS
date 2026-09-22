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
import type {OwnershipJournal} from './ownershipJournal.js';
import type {AiExitVerdict} from './s03AiExitPolicy.js';

export type ExitTaskState='PREPARED'|'SUBMITTING'|'WORKING'|'PARTIALLY_FILLED'|'FILLED'|'CANCELED'|'REJECTED'|'EXPIRED'|'UNKNOWN';
export const TERMINAL_STATES:ExitTaskState[]=['FILLED','CANCELED','REJECTED','EXPIRED'];
export const OPEN_STATES:ExitTaskState[]=['PREPARED','SUBMITTING','WORKING','PARTIALLY_FILLED','UNKNOWN'];
export type ExitSource='AI'|'MANUAL'|'TP';

export type ExitTask={
  taskId:string;clientOrderId:string;scope:string;cycleId:string;source:ExitSource;
  quantityUnits:number;limitPrice:number;state:ExitTaskState;version:number;filledUnits:number;
  ownerVersion:number;planVersion:number;positionVersion:number;settingsVersion:number;riskGeneration:number;
  estimateHash:string;decisionHash:string;authorizationExpiresAt:number;deadline:number;
  createdAt:number;updatedAt:number;reasons:string[];stepSize:number;requestKey:string|null;
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

export type CoordinatorResult={accepted:boolean;taskId:string|null;clientOrderId:string|null;reasons:string[];submitRequired:boolean};

const DDL=`
CREATE TABLE IF NOT EXISTS v396_exit_tasks(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,scope TEXT NOT NULL,cycle_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v396_exit_task_scope ON v396_exit_tasks(scope,cycle_id);
CREATE TABLE IF NOT EXISTS v396_exit_observed(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,observed_at INTEGER NOT NULL);
`;

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
   * The submit identity is owned by the caller's request, not by its size: with a requestKey the
   * seed is scope|cycle|source|requestKey, so a retry of one intent is constant while a later intent
   * in the same cycle legitimately gets a new ID. Without a requestKey the legacy quantity seed is
   * kept, which is what the offline S04 matrix was written against.
   */
  private clientOrderIdFor(scope:string,cycleId:string,source:ExitSource,quantityUnits:number,requestKey?:string){
    let h=0x811c9dc5>>>0;
    const key=String(requestKey??'').trim();
    const seed=key?`${scope}|${cycleId}|${source}|R:${key}`:`${scope}|${cycleId}|${source}|Q:${quantityUnits}`;
    for(let i=0;i<seed.length;i++)h=Math.imul(h^seed.charCodeAt(i),16777619)>>>0;
    return `v396x${h.toString(16).padStart(8,'0')}`;
  }

  private reserveClaim(task:ExitTask){
    this.journal.write('INSERT INTO v396_quantity_claims VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',`claim:${task.taskId}`,task.scope,JSON.stringify({scope:task.scope,cycleId:task.cycleId,source:task.source,claimId:`claim:${task.taskId}`,quantityUnits:task.quantityUnits,version:1,status:'ACTIVE'}));
  }

  private settleClaim(task:ExitTask){
    const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE id=?',`claim:${task.taskId}`)[0];
    if(!row)return;
    const claim=JSON.parse(String(row.payload)) as {version:number};
    this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify({...claim,version:claim.version+1,status:'RELEASED'}),`claim:${task.taskId}`);
  }

  /**
   * S04-A/S04-C: the single entry point. Verdict freshness, JIT re-verification, the shared
   * quantity budget and the PREPARED row are decided in one transaction, and the row exists
   * before the caller is told a request may go out.
   */
  requestExit(input:{scope:string;cycleId:string;source:ExitSource;quantityUnits:number;verdict:AiExitVerdict;jit:JitFacts;mandate?:{version:number;revokedAt:number|null}|null;requestKey?:string}):CoordinatorResult{
    return this.journal.transact<CoordinatorResult>(()=>{
      const {verdict,jit}=input;
      const reject=(...reasons:string[]):CoordinatorResult=>({accepted:false,taskId:null,clientOrderId:null,reasons,submitRequired:false});
      if(!input.scope||!input.cycleId)return reject('IDENTITY_MISSING');
      if(!Number.isSafeInteger(input.quantityUnits)||input.quantityUnits<=0)return reject('QUANTITY_INVALID');
      for(const [name,value] of Object.entries({now:jit.now,ownerVersion:jit.ownerVersion,positionVersion:jit.positionVersion,settingsVersion:jit.settingsVersion,riskGeneration:jit.riskGeneration,availableReduceUnits:jit.availableReduceUnits,remainingUnits:jit.remainingUnits,minNotional:jit.minNotional,tickSize:jit.tickSize,stepSize:jit.stepSize})){
        if(!Number.isFinite(Number(value)))return reject(`JIT_FACT_NOT_FINITE:${name}`);
      }
      if(!Number.isSafeInteger(jit.availableReduceUnits)||jit.availableReduceUnits<0)return reject('JIT_AVAILABILITY_UNPROVEN');

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
      const open=existing.filter(task=>OPEN_STATES.includes(task.state));
      const openUnits=open.reduce((sum,task)=>sum+task.quantityUnits-task.filledUnits,0);
      // An intent this caller already prepared is answered by identity first - and only that
      // caller, and only while it is still PREPARED, may be told to submit it. Coordination
      // conflicts are then judged for a new intent, so a different source can never read
      // 'already prepared' as licence to submit somebody else's order (I11).
      const replayed=existing.find(task=>task.clientOrderId===clientOrderId);
      if(replayed)return {accepted:false,taskId:replayed.taskId,clientOrderId,reasons:['IDEMPOTENCY_KEY_ALREADY_PREPARED',],submitRequired:replayed.source===input.source&&replayed.state==='PREPARED'};
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
        taskId:`exit_${input.cycleId}_${existing.length+1}`,clientOrderId,scope:input.scope,cycleId:input.cycleId,source:input.source,
        quantityUnits:input.quantityUnits,limitPrice:verdict.boundaryPrice,state:'PREPARED',version:1,filledUnits:0,
        ownerVersion:verdict.ownerVersion,planVersion:verdict.planVersion,positionVersion:jit.positionVersion,settingsVersion:jit.settingsVersion,riskGeneration:jit.riskGeneration,
        estimateHash:verdict.estimateHash,decisionHash:verdict.decisionHash,authorizationExpiresAt:verdict.authorizationExpiresAt!,deadline:jit.deadline,
        createdAt:jit.now,updatedAt:jit.now,reasons:[],stepSize:jit.stepSize,requestKey,
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
      const moved:ExitTask={...task,state:next,version:task.version+1,updatedAt:now,reasons:[...task.reasons,reason]};
      this.persist(moved);
      if(TERMINAL_STATES.includes(next))this.settleClaim(moved);
      return moved;
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
        const task=this.findTaskByClientOrderId(event.clientOrderId);
        if(!task){record(`UNBOUND_ORDER:${event.clientOrderId}`);continue;}
        if(TERMINAL_STATES.includes(task.state)){record(`TERMINAL_TASK:${task.taskId}`);continue;}
        if(event.positionVersion<task.positionVersion){record(`STALE_WATERMARK:${event.eventId}`);continue;}
        if(event.filledUnits>task.quantityUnits){record(`OVER_FILL:${event.filledUnits}>${task.quantityUnits}`);continue;}
        if(event.filledUnits<task.filledUnits){record(`FILL_REGRESSION:${event.filledUnits}<${task.filledUnits}`);continue;}
        // UNKNOWN may only be resolved by an exchange fact, never by a local guess:
        // transition() refuses to leave UNKNOWN, while observe() accepts whatever the query
        // proves. Without that, the claim of an unacknowledged order would hang forever and
        // keep occupying risk with no route to convergence.
        const resolvingUncertain=task.state==='UNKNOWN';
        if(!resolvingUncertain&&!TRANSITIONS[task.state]?.includes(event.state)){record(`ILLEGAL_TRANSITION:${task.state}->${event.state}`);continue;}
        const next:ExitTask={...task,state:event.state,filledUnits:event.filledUnits,positionVersion:event.positionVersion,version:task.version+1,updatedAt:now,reasons:[...task.reasons,resolvingUncertain?'EXCHANGE_FACT_RESOLVED_UNKNOWN':'EXCHANGE_FACT_CONVERGED']};
        this.persist(next);
        this.journal.write('INSERT INTO v396_exit_observed(event_id,payload,observed_at) VALUES(?,?,?)',event.eventId,JSON.stringify(event),now);
        if(TERMINAL_STATES.includes(next.state))this.settleClaim(next);
        applied.push(`${next.taskId}:${next.state}`);
      }
      return {applied,skipped};
    });
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

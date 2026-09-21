import {EventBus} from '../events/eventBus.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {OwnershipService} from './ownershipService.js';
import {executionScope} from './executionLifecycle.js';

export type OwnershipSubject={symbol:string;positionSide:string;cycleId:string|null};

/**
 * Durable ownership facts driven by what the Engine already proves deterministically:
 * a loss-handoff or a human submission revokes AI management for that cycle.
 *
 * Two rules are load-bearing. First, this service must never be able to break an existing
 * write path: every journal failure is contained and reported, because a human exit or a
 * TP maintenance sweep cannot be allowed to fail because a new accounting table is broken
 * (I07). Second, nothing here grants AI authority; the recorded state only ever narrows it
 * (I01, I06), and no consumer may treat a record as permission to send a new order.
 */
export class OwnershipRuntime {
  private journal:OwnershipJournal|null=null;
  private service:OwnershipService|null=null;
  private openError:string|null=null;
  private degradedCount=0;
  private recordedCount=0;
  constructor(private readonly events:EventBus,private readonly dbFile:string){
    try{this.journal=new OwnershipJournal(dbFile);}catch(error){this.openError=error instanceof Error?error.message:String(error);}
    events.on('event',event=>this.onEvent(event));
  }
  private identity(positionId:string):{scope:string;cycleId:string}|null{
    try{
      const subject=this.subject(positionId);if(!subject||!subject.cycleId)return null;
      const exchange=this.exchangeIdentity();
      return{scope:executionScope(exchange.environment,exchange.account,subject.symbol,subject.positionSide),cycleId:subject.cycleId};
    }catch{return null;}
  }
  /** Supplied by the runtime; a missing or invalid identity must never invent a scope. */
  subject(_positionId:string):OwnershipSubject|null{return null;}
  exchangeIdentity():{environment:string;account:string}{return{environment:'UNKNOWN',account:'UNKNOWN'};}
  private fail(stage:string,error:unknown){
    this.degradedCount++;
    this.events.publish('V396_OWNERSHIP_JOURNAL_DEGRADED',{stage,message:error instanceof Error?error.message:String(error),affectsTradingPath:false,authorityGranted:false},'V396');
  }
  private onEvent(event:{type?:string;payload?:any}){
    if(event?.type==='POSITION_HUMAN_HANDOFF'||event?.type==='MANUAL_SUBMISSION_PREPARED'){
      const positionId=String(event.payload?.positionId??event.payload?.intent?.positionId??'');
      if(positionId)this.recordHumanTakeover(positionId,event.type==='POSITION_HUMAN_HANDOFF'?'LOSS_HANDOFF_BARS':'MANUAL_SUBMISSION');
    }
  }
  /** Records the revocation of AI management for a cycle, creating a legacy record first. */
  recordHumanTakeover(positionId:string,reason:string){
    const identity=this.identity(positionId);if(!identity)return false;
    try{this.requireService().recordTakeoverFromHuman(identity.scope,identity.cycleId,reason,Date.now());this.recordedCount++;return true;}
    catch(error){this.fail('HUMAN_TAKEOVER',error);return false;}
  }
  /** Never report success on a journal we do not have: a missing handle must throw. */
  private requireService(){
    const journal=this.journal??this.reopen();
    return this.service??(this.service=new OwnershipService(journal));
  }
  private reopen():OwnershipJournal{
    if(this.journal)return this.journal;
    this.journal=new OwnershipJournal(this.dbFile);this.openError=null;this.service=new OwnershipService(this.journal);return this.journal;
  }
  /** Expiry plus at-least-once outbox delivery. Neither can throw into a trading path. */
  pump(now=Date.now()){
    const expired=this.expireDue(now);
    try{
      const drained=this.requireService().drainOutbox(event=>{this.events.publish('V396_OWNERSHIP_OUTBOX',event,'V396');});
      return{expired,...drained};
    }catch(error){this.fail('OUTBOX_PUMP',error);return{expired,delivered:0,failed:0,pending:0,tasks:0};}
  }
  /** Records the read receipt for a handoff. Never restores AI authority (I01). */
  acknowledge(positionId:string,now=Date.now()){
    const identity=this.identity(positionId);if(!identity)return false;
    try{this.requireService().acknowledge(identity.scope,identity.cycleId,now);this.recordedCount++;return true;}
    catch(error){this.fail('ACKNOWLEDGE',error);return false;}
  }
  ownershipService(){return this.journal?(this.service??(this.service=new OwnershipService(this.journal))):null;}
  /** Moves AI-managed cycles whose deadline has passed into handoff. Never extends a deadline. */
  expireDue(now=Date.now()){
    if(!this.journal&&!this.openError)return 0;
    try{const count=this.reopen().expire(now);this.recordedCount+=count;return count;}catch(error){this.fail('EXPIRE',error);return 0;}
  }
  pendingEvents(){try{return this.journal?this.journal.pendingEvents().length:0;}catch(error){this.fail('OUTBOX_READ',error);return 0;}}
  metrics(){return{enabled:this.journal!==null,openError:this.openError,recorded:this.recordedCount,degraded:this.degradedCount,outboxPending:this.pendingEvents()};}
  close(){try{this.journal?.close();}catch{/* a closed or locked handle is not a trading failure */}finally{this.journal=null;}}
}

export function attachOwnershipRuntime(events:EventBus,dbFile:string,resolve:(positionId:string)=>OwnershipSubject|null,exchange:()=>{environment:string;account:string}){
  const runtime=new OwnershipRuntime(events,dbFile);
  runtime.subject=resolve;runtime.exchangeIdentity=exchange;
  return runtime;
}

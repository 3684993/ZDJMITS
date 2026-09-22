import {OwnershipJournal} from './ownershipJournal.js';
import {transitionOwner,type Ownership,type QuantityClaim} from './v396OfflineStages.js';

export type ProtectionMandate={scope:string;cycleId:string;version:number;source:'GUARDIAN'|'HUMAN';allowedPrice:number|null;allowedQuantityRule:string;revokedAt:number|null;updatedAt:number};
export type ObservedPosition={scope:string;cycleId:string|null;quantityUnits:number;source:'EXCHANGE'|'LOCAL'|'UNKNOWN'};
export type OutboxEvent={id:string;payload:unknown};

/**
 * S02 acceptance layer over the durable journal: acknowledgement, outbox consumption,
 * reconciliation of observed position facts, protection mandates, and claim release.
 *
 * Three rules are the point of this file. A human acknowledgement is a read receipt and
 * never a re-grant (I01). Notification delivery is downstream of committed state, so a
 * failed delivery cannot roll back a revocation and a redelivery cannot create a second
 * work item (I06). An unverified position fact narrows authority; it never widens it (I02).
 * Nothing here can send an order, and no method returns anything an AI path may treat as
 * permission — that stays closed until S03/S04.
 */
export class OwnershipService {
  constructor(private readonly journal:OwnershipJournal){}

  ownership(scope:string,cycleId:string){return this.journal.get(scope,cycleId);}
  allOwners(){return this.journal.query<{payload:string}>('SELECT payload FROM v396_owners').map(row=>JSON.parse(String(row.payload)) as Ownership);}
  claimsFor(scope:string){return this.journal.query<{payload:string}>('SELECT payload FROM v396_quantity_claims WHERE scope=?',scope).map(row=>JSON.parse(String(row.payload)) as QuantityClaim);}
  activeClaimUnits(scope:string){return this.claimsFor(scope).filter(claim=>claim.status==='ACTIVE').reduce((sum,claim)=>sum+claim.quantityUnits,0);}

  private writeOwner(owner:Ownership){
    this.journal.write('INSERT INTO v396_owners VALUES(?,?,?,?) ON CONFLICT(scope,cycle_id) DO UPDATE SET version=excluded.version,payload=excluded.payload',owner.scope,owner.cycleId,owner.ownerVersion,JSON.stringify(owner));
  }
  private enqueue(id:string,type:string,payload:unknown){
    this.journal.write('INSERT INTO v396_outbox(id,payload,delivered) VALUES(?,?,0) ON CONFLICT(id) DO NOTHING',id,JSON.stringify({id,type,payload}));
  }

  /**
   * S02-T02/T04: the durable half of a human takeover, shared with the runtime wiring.
   * Each step commits on its own: if the process dies between them the cycle is left in
   * HANDOFF_PENDING, which is already revoked, so a crash can only under-grant, never
   * over-grant (I01). No step here can put a cycle back under AI management.
   */
  recordTakeoverFromHuman(scope:string,cycleId:string,reason:string,now:number):Ownership{
    if(!scope||!cycleId||!reason||!Number.isFinite(now))throw new Error('INVALID_TAKEOVER');
    let current=this.journal.get(scope,cycleId);
    if(!current)current=this.journal.initialize({scope,cycleId,planRef:null,firstFillAt:now-1,durationMs:null,now,legacy:true});
    if(current.ownerState==='CLOSED')throw new Error('CLOSED_OWNER_IMMUTABLE');
    if(current.ownerState==='HUMAN_MANAGED')return current;
    if(current.ownerState==='AI_ACTIVE')current=this.journal.transition(scope,cycleId,current.ownerVersion,'HANDOFF_PENDING',now,reason);
    return this.journal.transition(scope,cycleId,current.ownerVersion,'HUMAN_MANAGED',now,reason);
  }

  /** S02-T05: acknowledgement records that a human has seen the handoff, and nothing else. */
  acknowledge(scope:string,cycleId:string,now:number):Ownership{
    return this.journal.transact(()=>{
      const current=this.journal.get(scope,cycleId);
      if(!current)throw new Error('OWNER_NOT_FOUND');
      if(current.ownerState==='CLOSED')throw new Error('CLOSED_OWNER_IMMUTABLE');
      if(current.ownerState==='AI_ACTIVE')throw new Error('ACK_requires_handoff_state');
      if(!Number.isFinite(now)||now<current.transitionedAt)throw new Error('INVALID_ACK_CLOCK');
      if(current.acknowledgedAt!=null)return current;
      const acked:Ownership={...current,acknowledgedAt:now};
      this.writeOwner(acked);
      this.enqueue(JSON.stringify([acked.scope,acked.cycleId,acked.ownerVersion,'ACK']),'HANDOFF_ACKNOWLEDGED',{owner:acked,authorityGranted:false});
      return acked;
    });
  }

  /** At-least-once drain: a failure is reported and left pending, never rolled into state. */
  drainOutbox(deliver:(event:OutboxEvent)=>void){
    let delivered=0,failed=0;
    for(const event of this.journal.pendingEvents()){
      try{deliver(event);}catch{failed++;continue;}
      this.journal.markDelivered(event.id);delivered++;
    }
    return{delivered,failed,pending:this.journal.pendingEvents().length,tasks:this.pendingTasks().length};
  }

  /** Distinct work items: a redelivered event for the same scope/state must not stack up. */
  pendingTasks(){
    const seen=new Map<string,OutboxEvent>();
    for(const event of this.journal.pendingEvents()){
      const owner=(event.payload as {payload?:{owner?:Ownership}})?.payload?.owner??(event.payload as {owner?:Ownership})?.owner;
      const key=owner?`${owner.scope}|${owner.cycleId}|${(event.payload as {type?:string}).type}`:event.id;
      if(!seen.has(key))seen.set(key,event);
    }
    return [...seen.values()];
  }

  /**
   * S02-T06/T08: fold observed position facts into the authority ledger. An unowned cycle
   * is surfaced, never silently adopted; a drift or an unverified source revokes AI for the
   * cycle by bumping the version, so queued AI work fails its own CAS check later.
   */
  reconcile(observed:ObservedPosition[],now:number){
    return this.journal.transact(()=>{
      const report={unownedCycles:[] as string[],invalidated:[] as string[],humanPreserved:0,closedSkipped:0,missingCycle:0,clockRejected:0};
      for(const item of observed){
        if(!Number.isSafeInteger(item.quantityUnits)||item.quantityUnits<0)throw new Error('INVALID_OBSERVED_QUANTITY');
        if(!item.cycleId){report.missingCycle++;continue;}
        const current=this.journal.get(item.scope,item.cycleId);
        if(!current){report.unownedCycles.push(item.cycleId);continue;}
        if(!Number.isFinite(now)||now<current.transitionedAt){report.clockRejected++;continue;}
        if(current.ownerState==='CLOSED'){report.closedSkipped++;continue;}
        if(current.ownerState!=='AI_ACTIVE'){report.humanPreserved++;continue;}
        const claimed=this.activeClaimUnits(item.scope);
        const drift=claimed>item.quantityUnits;
        if(item.source!=='EXCHANGE'||drift){
          const next=transitionOwner(current,'HANDOFF_PENDING',current.ownerVersion,now,drift?'CLAIMED_UNITS_EXCEED_POSITION':'POSITION_FACT_UNVERIFIED');
          this.writeOwner(next);
          this.enqueue(JSON.stringify([next.scope,next.cycleId,next.ownerVersion]),'OWNERSHIP_CHANGED',{owner:next,authorityGranted:false});
          report.invalidated.push(item.cycleId);
        }
      }
      return report;
    });
  }

  mandate(scope:string,cycleId:string):ProtectionMandate|null{
    const row=this.journal.query<{payload:string}>('SELECT payload FROM v396_mandates WHERE scope=? AND cycle_id=?',scope,cycleId)[0];
    return row?JSON.parse(String(row.payload)) as ProtectionMandate:null;
  }

  /** S02-T07: mandate version CAS, and a human revocation outranks any later Guardian write. */
  putMandate(input:{scope:string;cycleId:string;source:'GUARDIAN'|'HUMAN';allowedPrice:number|null;allowedQuantityRule:string},expectedVersion:number,now:number):ProtectionMandate{
    return this.journal.transact(()=>{
      if(!input.scope||!input.cycleId||!['GUARDIAN','HUMAN'].includes(input.source)||!input.allowedQuantityRule)throw new Error('INVALID_MANDATE');
      if(!Number.isFinite(now))throw new Error('INVALID_MANDATE_CLOCK');
      const allowedPrice=input.allowedPrice==null?null:Number(input.allowedPrice);
      if(allowedPrice!=null&&(!Number.isFinite(allowedPrice)||allowedPrice<=0))throw new Error('INVALID_MANDATE_PRICE');
      const current=this.mandate(input.scope,input.cycleId);
      if(!current){
        if(expectedVersion!==0)throw new Error('MANDATE_VERSION_CONFLICT');
        if(input.source==='GUARDIAN'&&allowedPrice==null)throw new Error('MANDATE_PRICE_REQUIRED');
      }else{
        if(current.version!==expectedVersion)throw new Error('MANDATE_VERSION_CONFLICT');
        if(current.revokedAt!=null&&input.source==='GUARDIAN')throw new Error('MANDATE_HUMAN_REVOKED');
        if(now<current.updatedAt)throw new Error('MANDATE_CLOCK_ROLLBACK');
      }
      const next:ProtectionMandate={scope:input.scope,cycleId:input.cycleId,version:(current?.version??0)+1,source:input.source,allowedPrice,allowedQuantityRule:input.allowedQuantityRule,revokedAt:null,updatedAt:now};
      this.journal.write('INSERT INTO v396_mandates VALUES(?,?,?,?) ON CONFLICT(scope,cycle_id) DO UPDATE SET version=excluded.version,payload=excluded.payload',next.scope,next.cycleId,next.version,JSON.stringify(next));
      this.enqueue(JSON.stringify([next.scope,next.cycleId,next.version]),'PROTECTION_MANDATE_CHANGED',{mandate:next});
      return next;
    });
  }

  revokeMandateByHuman(scope:string,cycleId:string,now:number):ProtectionMandate{
    return this.journal.transact(()=>{
      if(!scope||!cycleId||!Number.isFinite(now))throw new Error('INVALID_MANDATE_REVOKE');
      const current=this.mandate(scope,cycleId);
      if(!current){
        const tombstone:ProtectionMandate={scope,cycleId,version:1,source:'HUMAN',allowedPrice:null,allowedQuantityRule:'FULL_REMAINING',revokedAt:now,updatedAt:now};
        this.journal.write('INSERT INTO v396_mandates VALUES(?,?,?,?)',scope,cycleId,tombstone.version,JSON.stringify(tombstone));
        this.enqueue(JSON.stringify([scope,cycleId,tombstone.version]),'PROTECTION_MANDATE_CHANGED',{mandate:tombstone,revoked:true,tombstone:true});
        return tombstone;
      }
      if(current.revokedAt!=null)return current;
      if(now<current.updatedAt)throw new Error('MANDATE_CLOCK_ROLLBACK');
      const next:ProtectionMandate={...current,version:current.version+1,source:'HUMAN',revokedAt:now,updatedAt:now};
      this.journal.write('INSERT INTO v396_mandates VALUES(?,?,?,?) ON CONFLICT(scope,cycle_id) DO UPDATE SET version=excluded.version,payload=excluded.payload',next.scope,next.cycleId,next.version,JSON.stringify(next));
      this.enqueue(JSON.stringify([next.scope,next.cycleId,next.version]),'PROTECTION_MANDATE_CHANGED',{mandate:next,revoked:true});
      return next;
    });
  }

  /** Open cycles with no live protection: the alert the human needs, not a silent gap. */
  unprotected(){
    const owners=this.allOwners().filter(owner=>owner.ownerState!=='CLOSED');
    return owners.filter(owner=>{
      const mandate=this.mandate(owner.scope,owner.cycleId);
      return !mandate||mandate.revokedAt!=null;
    }).map(owner=>({scope:owner.scope,cycleId:owner.cycleId,ownerState:owner.ownerState}));
  }

  /**
   * S04-A primitive only: a quantity claim is released by a positive terminal proof, never
   * by a timeout, a cancel attempt, or a wish. Wired to no order path in this checkpoint.
   */
  releaseClaim(claimId:string,proof:{terminal:boolean;source:string|null},now:number):QuantityClaim{
    return this.journal.transact(()=>{
      const row=this.journal.query<{scope:string;payload:string}>('SELECT scope,payload FROM v396_quantity_claims WHERE id=?',claimId)[0];
      if(!row)throw new Error('CLAIM_NOT_FOUND');
      const claim=JSON.parse(String(row.payload)) as QuantityClaim;
      if(claim.status==='RELEASED')return claim;
      if(proof?.terminal!==true||!proof?.source)throw new Error('CLAIM_RELEASE_UNPROVEN');
      const next:QuantityClaim={...claim,status:'RELEASED',version:claim.version+1};
      this.journal.write('UPDATE v396_quantity_claims SET payload=? WHERE id=?',JSON.stringify(next),claimId);
      this.journal.write('INSERT INTO v396_claims_history(id,payload,settled_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',claimId,JSON.stringify({claim:next,proof,now}),now);
      return next;
    });
  }
}

import {copyFileSync,existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {OwnershipJournal} from './ownershipJournal.js';
import {OwnershipService} from './ownershipService.js';

export type MigrationSubject={scope:string;cycleId:string;planRef:string|null;firstFillAt:number|null;deadline:number|null;managementStatus:string;legacy:boolean};
export type MigrationPlan={created:{scope:string;cycleId:string;ownerState:string;reason:string}[];preserved:string[];skipped:string[];wouldMutateExisting:number};

/**
 * Migration and recovery for the ownership ledger. It is a plan/apply pair that only ever
 * runs against a caller-supplied file: nothing here may be pointed at the live data
 * directory without a separate, explicit user instruction (I10). Preview never writes, an
 * apply on an isolated copy is verified by re-reading, and a second apply must be a no-op.
 */
export class OwnershipMigration {
  constructor(private readonly journal:OwnershipJournal){}

  /** Read-only: what would exist afterwards, with no authority invented for anyone. */
  static preview(subjects:MigrationSubject[],existing:OwnershipJournal|null,now:number):MigrationPlan{
    const plan:MigrationPlan={created:[],preserved:[],skipped:[],wouldMutateExisting:0};
    for(const subject of subjects){
      if(!subject.scope||!subject.cycleId||!Number.isFinite(now))throw new Error('INVALID_MIGRATION_SUBJECT');
      const prior=existing?.get(subject.scope,subject.cycleId);
      if(prior){plan.preserved.push(subject.cycleId);continue;}
      const humanOwned=subject.managementStatus==='HUMAN_MANAGED';
      const active=!subject.legacy&&Boolean(subject.planRef)&&subject.deadline!=null&&subject.deadline>now&&!humanOwned;
      plan.created.push({scope:subject.scope,cycleId:subject.cycleId,ownerState:active?'AI_ACTIVE':humanOwned?'HUMAN_MANAGED':'HANDOFF_PENDING',reason:active?'MIGRATED_PLAN':humanOwned?'MIGRATED_HUMAN_PRESERVED':'LEGACY_OR_INVALID_PLAN'});
      if(active)plan.wouldMutateExisting++;
    }
    return plan;
  }

  /** Applies exactly the previewed set. Existing rows are never rewritten or re-versioned. */
  apply(subjects:MigrationSubject[],now:number){
    const result={created:0,preserved:0,humanPreserved:0};
    for(const subject of subjects){
      if(this.journal.get(subject.scope,subject.cycleId)){result.preserved++;continue;}
      const humanOwned=subject.managementStatus==='HUMAN_MANAGED';
      const active=!subject.legacy&&Boolean(subject.planRef)&&subject.deadline!=null&&subject.deadline>now&&!humanOwned;
      // initialize() owns its transaction: each cycle commits or rolls back on its own, so a
      // half-applied migration can never leave a silently mixed authority set.
      this.journal.initialize({scope:subject.scope,cycleId:subject.cycleId,planRef:active?subject.planRef:null,firstFillAt:subject.firstFillAt??now-1,durationMs:active&&subject.deadline!=null?subject.deadline-(subject.firstFillAt??now-1):null,now,legacy:subject.legacy||(humanOwned&&!subject.planRef)});
      if(humanOwned){
        // A position already held by a human stays there; migration records it, it never
        // re-derives or narrows what the operator already decided (I06).
        const created=this.journal.get(subject.scope,subject.cycleId)!;
        if(created.ownerState!=='HUMAN_MANAGED')new OwnershipService(this.journal).recordTakeoverFromHuman(subject.scope,subject.cycleId,'MIGRATED_HUMAN_PRESERVED',now);
        result.humanPreserved++;
      }
      result.created++;
    }
    return result;
  }

  /** Runs the whole apply against a throwaway copy and reports read-back equality. */
  static rehearsal(subjects:MigrationSubject[],now:number){
    const dir=mkdtempSync(join(tmpdir(),'zdj-v396-migration-'));
    const file=join(dir,'ownership-copy.sqlite');
    const journal=new OwnershipJournal(file);
    try{
      const migration=new OwnershipMigration(journal);
      const first=migration.apply(subjects,now);
      const second=migration.apply(subjects,now);
      const owners=journal.query<{payload:string}>('SELECT payload FROM v396_owners').map(row=>JSON.parse(String(row.payload)));
      return{first,second,idempotent:second.created===0&&second.preserved===first.created,readBack:owners.length,outbox:journal.pendingEvents().length,file};
    }finally{journal.close();}
  }

  /** Snapshot of the live journal into a separate file, using the SQLite online backup. */
  backup(targetFile:string){return this.journal.backupTo(targetFile);}

  static verify(file:string,expectCycles:string[]){
    if(!existsSync(file))throw new Error('MIGRATION_IMAGE_MISSING');
    const journal=new OwnershipJournal(file);
    try{
      const owners=journal.query<{payload:string}>('SELECT payload FROM v396_owners').map(row=>JSON.parse(String(row.payload)) as {cycleId:string});
      const restored=new Set(owners.map(owner=>owner.cycleId));
      return{owners:owners.length,missing:expectCycles.filter(cycleId=>!restored.has(cycleId)),outbox:journal.pendingEvents().length};
    }finally{journal.close();}
  }

  /** Byte-identical image check used by the restore test. */
  static identical(left:string,right:string){
    return Buffer.compare(readFileSync(left),readFileSync(right))===0;
  }
}

export function copyJournalFile(from:string,to:string){copyFileSync(from,to);return to;}

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

/**
 * Two properties that must stay true while the ownership ledger is write-only and the
 * production migration is unauthorised:
 *   1. no ownership code may ever open the live settings database, so a V396 table can only
 *      ever be created in a file this stage owns — a schema change to the production store is
 *      a separately authorised migration, not a side effect of booting;
 *   2. the file it does create is currently outside the backup/retention inventory, so that
 *      gap must stay written down as a blocking release item instead of being forgotten.
 */
const root=join(process.cwd(),'..','..');
const sources=['services/ownershipJournal.ts','services/ownershipService.ts','services/ownershipMigration.ts','services/ownershipRuntime.ts','runtime/appRuntime.ts'];
const read=(relative:string)=>readFileSync(join(root,'apps','engine','src',relative),'utf8');
const coverage=JSON.parse(readFileSync(join(root,'docs/evidence/v396/S02/20260921T190000Z/storage-coverage.json'),'utf8'));
const storageScript=()=>readFileSync(join(root,'scripts','maintain-storage.mjs'),'utf8');

describe('ownership storage boundaries',()=>{
  it('never opens or mutates the live settings database',()=>{
    for(const file of sources){
      const text=read(file);
      expect(text,file).not.toMatch(/zdj-settings\.sqlite/);
      expect(text,file).not.toMatch(/settingsStore[^;]{0,40}\.db\b/);
    }
    expect(coverage.files.map((entry:{name:string})=>entry.name)).toContain('v396-ownership.sqlite');
  });

  it('keeps the un-backed-up ledger registered as a release blocker until it is covered',()=>{
    const ledger=coverage.files[0].name as string;const backedUp=storageScript().includes(ledger);
    const blocker=coverage.files.find((entry:{name:string;releaseBlocking:boolean})=>entry.name===ledger)?.releaseBlocking===true;
    // Exactly one of the two must hold: covered by the backup tooling, or still declared blocking.
    expect(backedUp||blocker).toBe(true);
    expect(backedUp&&blocker).toBe(false);
    if(!backedUp)expect(coverage.gate).toBe('S02_MIGRATION_AND_BACKUP_COVERAGE_OPEN');
  });

  it('does not let the ledger silently widen AI authority',()=>{
    const service=read('services/ownershipService.ts')+read('services/ownershipRuntime.ts');
    expect(service).not.toMatch(/transitionOwner\([^)]*'AI_ACTIVE'/);
    expect(service).not.toMatch(/next\s*:\s*OwnerState\s*=\s*'AI_ACTIVE'/);
    expect(read('services/ownershipJournal.ts')).toMatch(/HUMAN_REAUTHORIZATION_REQUIRED/);
    expect(read('services/ownershipJournal.ts')).toMatch(/CLOSED_OWNER_IMMUTABLE/);
  });
});

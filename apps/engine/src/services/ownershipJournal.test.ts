import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,describe,expect,it} from 'vitest';
import {OwnershipJournal} from './ownershipJournal.js';

const dirs:string[]=[],journals:OwnershipJournal[]=[];
const open=(file:string)=>{const j=new OwnershipJournal(file);journals.push(j);return j;};
const database=()=>{const dir=mkdtempSync(join(tmpdir(),'v396-owner-'));dirs.push(dir);return join(dir,'test.sqlite');};
const init={scope:'TESTNET:account:BTCUSDT:BOTH',cycleId:'c',planRef:'p',firstFillAt:100,durationMs:10,now:100,legacy:false};
const claim={scope:init.scope,cycleId:'c',source:'AI' as const,claimId:'one',quantityUnits:6,version:1,status:'ACTIVE' as const};
afterEach(()=>{for(const j of journals.splice(0))j.close();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
describe('S02/S04 durable foundation; no exchange writes',()=>{
  it('rolls ownership back if outbox insertion fails inside the same transaction',()=>{
    const file=database(),j=open(file),fault=new DatabaseSync(file);
    try{fault.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON v396_outbox BEGIN SELECT RAISE(ABORT,'INJECTED_OUTBOX_FAILURE'); END;");
      expect(()=>j.initialize(init)).toThrow('INJECTED_OUTBOX_FAILURE');
      expect(j.get(init.scope,'c')).toBeNull();expect(j.pendingEvents()).toHaveLength(0);
      fault.exec('DROP TRIGGER reject_outbox');expect(j.initialize(init).ownerVersion).toBe(1);
    }finally{fault.close();}
  });
  it('revokes at exact deadline and commits a recoverable outbox',()=>{
    const file=database(),j=open(file);j.initialize(init);
    expect(j.expire(109)).toBe(0);expect(j.expire(110)).toBe(1);expect(j.expire(111)).toBe(0);
    const recovered=open(file);expect(recovered.get(init.scope,'c')).toMatchObject({ownerState:'HANDOFF_PENDING',ownerVersion:2,deadline:110});
    expect(recovered.pendingEvents()).toHaveLength(2);
    expect(()=>recovered.reserve(claim,10,2,111)).toThrow('AI_AUTHORITY_REVOKED');
  });
  it('never extends deadline on later fills or restart and never automatically restores human authority',()=>{
    const j=open(database());j.initialize(init);
    expect(j.initialize({...init,now:105,firstFillAt:105,durationMs:100}).deadline).toBe(110);
    j.transition(init.scope,'c',1,'HANDOFF_PENDING',105,'MANUAL');j.transition(init.scope,'c',2,'HUMAN_MANAGED',106,'ACK');
    expect(j.initialize({...init,now:107}).ownerState).toBe('HUMAN_MANAGED');
    expect(()=>j.transition(init.scope,'c',3,'AI_ACTIVE',108,'RECOVERED_PROFIT')).toThrow();
  });
  it('competing connections cannot overwrite ownership or reserve duplicate quantity',()=>{
    const file=database(),a=open(file),b=open(file);a.initialize(init);
    a.reserve(claim,10,1,101);
    expect(()=>b.reserve({...claim,claimId:'two'},10,1,101)).toThrow('QUANTITY_BUDGET_EXCEEDED');
    a.transition(init.scope,'c',1,'HANDOFF_PENDING',102,'MANUAL');
    expect(()=>b.transition(init.scope,'c',1,'HUMAN_MANAGED',103,'STALE')).toThrow('OWNER_VERSION_CONFLICT');
    expect(b.pendingEvents()).toHaveLength(2);
  });
  it('same id is idempotent but cannot change quantity or scope',()=>{
    const j=open(database());j.initialize(init);j.reserve(claim,10,1,101);
    expect(j.reserve(claim,10,1,102)).toEqual(claim);
    expect(()=>j.reserve({...claim,quantityUnits:1},10,1,102)).toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('legacy and missing plans cannot mint AI authority',()=>{
    const j=open(database());expect(j.initialize({...init,legacy:true}).ownerState).toBe('HANDOFF_PENDING');
    expect(j.initialize({...init,cycleId:'other',planRef:null}).ownerState).toBe('HANDOFF_PENDING');
  });
  it('manual must revoke AI first; TP occupies shared quantity across cycles',()=>{
    const j=open(database());j.initialize(init);
    expect(()=>j.reserve({...claim,source:'MANUAL'},10,1,101)).toThrow('REVOKE_AI_BEFORE_MANUAL');
    j.reserve({...claim,source:'TP'},10,1,101);j.initialize({...init,cycleId:'other'});
    expect(()=>j.reserve({...claim,claimId:'other',cycleId:'other'},10,1,102)).toThrow('QUANTITY_BUDGET_EXCEEDED');
  });
  it('outbox delivery acknowledgement is idempotent and never reauthorizes AI',()=>{
    const j=open(database());j.initialize({...init,legacy:true});const id=j.pendingEvents()[0]!.id;
    j.markDelivered(id);j.markDelivered(id);expect(j.pendingEvents()).toHaveLength(0);
    expect(j.get(init.scope,'c')?.ownerState).toBe('HANDOFF_PENDING');
  });
  it('clock rollback cannot change ownership or reserve a fresh task',()=>{
    const j=open(database());j.initialize(init);
    expect(()=>j.transition(init.scope,'c',1,'HANDOFF_PENDING',99,'BACKWARD')).toThrow('INVALID_TRANSITION_CLOCK');
    expect(()=>j.reserve(claim,10,1,99)).toThrow('OWNER_VERSION_CONFLICT');
    expect(j.pendingEvents()).toHaveLength(1);
  });
});

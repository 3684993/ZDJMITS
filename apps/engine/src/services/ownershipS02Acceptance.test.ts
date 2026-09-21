import {copyFileSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {OwnershipJournal} from './ownershipJournal.js';
import {OwnershipService} from './ownershipService.js';
import {OwnershipMigration} from './ownershipMigration.js';
import {executionScope} from './executionLifecycle.js';

const opened:OwnershipJournal[]=[];
const dirs:string[]=[];
afterEach(()=>{
  while(opened.length){try{opened.pop()!.close();}catch{/* handle already gone */}}
  while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* Windows keeps a busy handle; an OS temp leftover is not a test failure */}}
});

function tempDir(){const dir=mkdtempSync(join(tmpdir(),'zdj-v396-s02-'));dirs.push(dir);return dir;}
const scope=(symbol='BTCUSDT',side='LONG')=>executionScope('TESTNET','binance-primary',symbol,side);
const open=(file:string)=>{const journal=new OwnershipJournal(file);opened.push(journal);return journal;};
const claim=(overrides:Partial<{claimId:string;quantityUnits:number;source:'AI'|'MANUAL'|'TP';cycleId:string;scope:string}>={})=>({scope:scope(),cycleId:'cycle_a',source:'AI',claimId:'claim_1',quantityUnits:100,version:1,status:'ACTIVE',...overrides}) as never;

describe('S02 acceptance matrix',()=>{
  it('S02-T01 enforces deadline-1 / deadline / deadline+1 exactly, and expiry blocks a new AI write',()=>{
    const journal=open(join(tempDir(),'t01.sqlite')),now=Date.now(),first=now-1_000,deadline=first+60_000;
    const service=new OwnershipService(journal);
    journal.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:first,durationMs:60_000,now,legacy:false});
    expect(journal.get(scope(),'cycle_a')).toMatchObject({ownerState:'AI_ACTIVE',deadline});
    expect(journal.expire(deadline-1)).toBe(0);
    expect(journal.get(scope(),'cycle_a')?.ownerState).toBe('AI_ACTIVE');
    // still inside the window: an AI claim is accepted
    expect(journal.reserve(claim({claimId:'claim_in'}),1_000,journal.get(scope(),'cycle_a')!.ownerVersion,deadline-1).claimId).toBe('claim_in');
    expect(journal.expire(deadline)).toBe(1);
    const expired=journal.get(scope(),'cycle_a')!;
    expect(expired).toMatchObject({ownerState:'HANDOFF_PENDING',reason:'AI_MANAGEMENT_EXPIRED'});
    expect(journal.expire(deadline+1)).toBe(0);
    expect(()=>journal.reserve(claim({claimId:'claim_late'}),1_000,expired.ownerVersion,deadline+1)).toThrow('AI_AUTHORITY_REVOKED');
  });

  it('S02-T02 only the path holding the current ownerVersion commits when AI and human race',()=>{
    const file=join(tempDir(),'t02.sqlite');
    const writer=open(file),now=Date.now();
    writer.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1_000,durationMs:600_000,now,legacy:false});
    const versionAtAnswerTime=writer.get(scope(),'cycle_a')!.ownerVersion;
    // The human action lands first, on a second connection.
    const reader=open(file);
    new OwnershipService(reader).recordTakeoverFromHuman(scope(),'cycle_a','MANUAL_SUBMISSION',Date.now());
    const stale=writer.get(scope(),'cycle_a')!.ownerVersion;
    expect(stale).toBeGreaterThan(versionAtAnswerTime);
    expect(()=>writer.reserve(claim({claimId:'claim_race'}),1_000,versionAtAnswerTime,Date.now())).toThrow('OWNER_VERSION_CONFLICT');
    expect(writer.get(scope(),'cycle_a')?.ownerState).toBe('HUMAN_MANAGED');
  });

  it('S02-T03 a later fill after recovery neither extends the deadline nor resets the cycle',()=>{
    const file=join(tempDir(),'t03.sqlite'),first=Date.now()-10_000;
    const a=open(file);
    const created=a.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:first,durationMs:120_000,now:first,legacy:false});
    a.close();
    const b=open(file);
    const again=b.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:first+60_000,durationMs:9_000_000,now:first+60_000,legacy:false});
    expect(again).toEqual(created);
    expect(b.get(scope(),'cycle_a')).toMatchObject({cycleId:'cycle_a',ownerVersion:1,deadline:first+120_000});
  });

  it('S02-T04 a crash after commit keeps the revocation and redelivers one idempotent task',()=>{
    const file=join(tempDir(),'t04.sqlite'),now=Date.now();
    const first=open(file);
    first.initialize({scope:scope(),cycleId:'cycle_x',planRef:null,firstFillAt:now-1,durationMs:null,now,legacy:true});
    new OwnershipService(first).recordTakeoverFromHuman(scope(),'cycle_x','LOSS_HANDOFF_BARS',now);
    // crash: no drain, handle dropped
    const after=open(file);
    const service=new OwnershipService(after);
    expect(service.ownership(scope(),'cycle_x')?.ownerState).toBe('HUMAN_MANAGED');
    const pending=after.pendingEvents();
    expect(pending.length).toBeGreaterThan(0);
    let seen:unknown[]=[];
    expect(service.drainOutbox(()=>{throw new Error('transport down');}).failed).toBeGreaterThan(0);
    expect(after.pendingEvents().length).toBe(pending.length);
    const delivered=service.drainOutbox(event=>seen.push(event));
    expect(delivered.delivered).toBe(pending.length);
    expect(after.pendingEvents()).toHaveLength(0);
    expect(seen.length).toBe(pending.length);
    // a second drain must be a no-op, so no duplicate work item can exist
    expect(service.drainOutbox(()=>{throw new Error('must not run');})).toMatchObject({delivered:0,failed:0});
    expect(service.pendingTasks()).toHaveLength(0);
  });

  it('S02-T05 an acknowledgement is a read receipt: neither silence nor profit restores AI',()=>{
    const journal=open(join(tempDir(),'t05.sqlite')),now=Date.now();
    const service=new OwnershipService(journal);
    journal.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1_000,durationMs:60_000,now,legacy:false});
    journal.transition(scope(),'cycle_a',1,'HANDOFF_PENDING',now,'AI_MANAGEMENT_EXPIRED');
    const acked=service.acknowledge(scope(),'cycle_a',now+1_000);
    expect(acked).toMatchObject({ownerState:'HANDOFF_PENDING',acknowledgedAt:now+1_000});
    expect(service.acknowledge(scope(),'cycle_a',now+9_000).acknowledgedAt).toBe(now+1_000);
    const human=journal.transition(scope(),'cycle_a',acked.ownerVersion,'HUMAN_MANAGED',now+2_000,'HUMAN_ACCEPTED');
    // price recovery is not an event this service can even receive
    expect(()=>journal.transition(scope(),'cycle_a',human.ownerVersion,'AI_ACTIVE',now+3_000,'RECOVERED')).toThrow('HUMAN_REAUTHORIZATION_REQUIRED');
    expect(journal.get(scope(),'cycle_a')).toMatchObject({ownerState:'HUMAN_MANAGED',acknowledgedAt:now+1_000});
    expect(()=>service.acknowledge(scope(),'cycle_a',now)).toThrow('INVALID_ACK_CLOCK');
  });

  it('S02-T06 an unverified or drifted same-scope quantity invalidates the standing authority',()=>{
    const journal=open(join(tempDir(),'t06.sqlite')),now=Date.now();
    const service=new OwnershipService(journal);
    journal.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1_000,durationMs:600_000,now,legacy:false});
    const version=journal.get(scope(),'cycle_a')!.ownerVersion;
    journal.reserve(claim({claimId:'claim_big'}),1_000,version,now);
    const drift=service.reconcile([{scope:scope(),cycleId:'cycle_a',quantityUnits:50,source:'EXCHANGE'}],now+1_000);
    expect(drift.invalidated).toEqual(['cycle_a']);
    expect(journal.get(scope(),'cycle_a')).toMatchObject({ownerState:'HANDOFF_PENDING',reason:'CLAIMED_UNITS_EXCEED_POSITION'});
    expect(()=>journal.reserve(claim({claimId:'claim_stale'}),1_000,version,now+2_000)).toThrow('OWNER_VERSION_CONFLICT');

    const journal2=open(join(tempDir(),'t06b.sqlite'));
    const service2=new OwnershipService(journal2);
    journal2.initialize({scope:scope('ETHUSDT'),cycleId:'cycle_e',planRef:'plan-1',firstFillAt:now-1_000,durationMs:600_000,now,legacy:false});
    const report=service2.reconcile([{scope:scope('ETHUSDT'),cycleId:'cycle_e',quantityUnits:100,source:'UNKNOWN'}],now+1_000);
    expect(report.invalidated).toEqual(['cycle_e']);
    expect(journal2.get(scope('ETHUSDT'),'cycle_e')?.reason).toBe('POSITION_FACT_UNVERIFIED');
    // an unowned cycle is reported, never silently adopted
    expect(service2.reconcile([{scope:scope('SOLUSDT'),cycleId:'cycle_orphan',quantityUnits:10,source:'EXCHANGE'}],now+2_000).unownedCycles).toEqual(['cycle_orphan']);
    expect(journal2.get(scope('SOLUSDT'),'cycle_orphan')).toBeNull();
  });

  it('S02-T07 a human mandate revocation outranks the guardian and reports the protection gap',()=>{
    const journal=open(join(tempDir(),'t07.sqlite')),now=Date.now();
    const service=new OwnershipService(journal);
    journal.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1_000,durationMs:600_000,now,legacy:false});
    const first=service.putMandate({scope:scope(),cycleId:'cycle_a',source:'GUARDIAN',allowedPrice:100,allowedQuantityRule:'FULL_POSITION'},0,now);
    expect(()=>service.putMandate({scope:scope(),cycleId:'cycle_a',source:'GUARDIAN',allowedPrice:101,allowedQuantityRule:'FULL_POSITION'},0,now+1)).toThrow('MANDATE_VERSION_CONFLICT');
    const revoked=service.revokeMandateByHuman(scope(),'cycle_a',now+2);
    expect(revoked).toMatchObject({source:'HUMAN',revokedAt:now+2,version:2});
    expect(()=>service.putMandate({scope:scope(),cycleId:'cycle_a',source:'GUARDIAN',allowedPrice:102,allowedQuantityRule:'FULL_POSITION'},revoked.version,now+3)).toThrow('MANDATE_HUMAN_REVOKED');
    expect(service.unprotected()).toEqual([{scope:scope(),cycleId:'cycle_a',ownerState:'AI_ACTIVE'}]);
    const replaced=service.putMandate({scope:scope(),cycleId:'cycle_a',source:'HUMAN',allowedPrice:103,allowedQuantityRule:'REDUCE_ONLY'},revoked.version,now+4);
    expect(replaced).toMatchObject({source:'HUMAN',revokedAt:null,version:3});
    expect(service.unprotected()).toEqual([]);
    expect(()=>service.putMandate({scope:scope('XRPUSDT'),cycleId:'cycle_x',source:'GUARDIAN',allowedPrice:null,allowedQuantityRule:'FULL_POSITION'},0,now+5)).toThrow('MANDATE_PRICE_REQUIRED');
  });

  it('S02-T08 legacy, human and closed cycles gain no authority and closed cycles stay closed',()=>{
    const journal=open(join(tempDir(),'t08.sqlite')),now=Date.now();
    const service=new OwnershipService(journal);
    const applied=new OwnershipMigration(journal).apply([
      {scope:scope('ADAUSDT'),cycleId:'cycle_legacy',planRef:null,firstFillAt:now-9_000,deadline:null,managementStatus:'AUTO_MANAGED',legacy:true},
      {scope:scope('DOGEUSDT'),cycleId:'cycle_human',planRef:null,firstFillAt:now-9_000,deadline:null,managementStatus:'HUMAN_MANAGED',legacy:false},
      {scope:scope('SOLUSDT'),cycleId:'cycle_planned',planRef:'plan-9',firstFillAt:now-1_000,deadline:now+300_000,managementStatus:'AUTO_MANAGED',legacy:false},
    ],now);
    expect(applied).toMatchObject({created:3,preserved:0,humanPreserved:1});
    expect(journal.get(scope('ADAUSDT'),'cycle_legacy')?.ownerState).toBe('HANDOFF_PENDING');
    expect(journal.get(scope('DOGEUSDT'),'cycle_human')?.ownerState).toBe('HUMAN_MANAGED');
    expect(journal.get(scope('SOLUSDT'),'cycle_planned')?.ownerState).toBe('AI_ACTIVE');
    const closed=journal.transition(scope('SOLUSDT'),'cycle_planned',1,'HANDOFF_PENDING',now+1,'TEST');
    journal.transition(scope('SOLUSDT'),'cycle_planned',closed.ownerVersion,'HUMAN_MANAGED',now+2,'TEST');
    const final=journal.transition(scope('SOLUSDT'),'cycle_planned',3,'CLOSED',now+3,'POSITION_FLAT');
    expect(final.ownerState).toBe('CLOSED');
    expect(()=>journal.transition(scope('SOLUSDT'),'cycle_planned',final.ownerVersion,'AI_ACTIVE',now+4,'REVIVE')).toThrow('CLOSED_OWNER_IMMUTABLE');
    const report=service.reconcile([{scope:scope('SOLUSDT'),cycleId:'cycle_planned',quantityUnits:5,source:'EXCHANGE'}],now+5);
    expect(report).toMatchObject({closedSkipped:1,invalidated:[]});
    expect(service.reconcile([{scope:scope('DOGEUSDT'),cycleId:'cycle_human',quantityUnits:5,source:'EXCHANGE'}],now+6).humanPreserved).toBe(1);
  });
});

describe('S02 storage migration and recovery',()=>{
  it('preview writes nothing and the rehearsal on an isolated copy is idempotent',()=>{
    const file=join(tempDir(),'mig.sqlite'),now=Date.now();
    const journal=open(file);
    const subjects=[{scope:scope('ADAUSDT'),cycleId:'cycle_legacy',planRef:null,firstFillAt:now-1,deadline:null,managementStatus:'AUTO_MANAGED' as const,legacy:true},
      {scope:scope('SOLUSDT'),cycleId:'cycle_plan',planRef:'plan-1',firstFillAt:now-1,deadline:now+60_000,managementStatus:'AUTO_MANAGED' as const,legacy:false}];
    const plan=OwnershipMigration.preview(subjects,journal,now);
    expect(plan.created.map(item=>item.cycleId)).toEqual(['cycle_legacy','cycle_plan']);
    expect(plan.created.map(item=>item.ownerState)).toEqual(['HANDOFF_PENDING','AI_ACTIVE']);
    expect(new OwnershipService(journal).allOwners()).toHaveLength(0);
    const rehearsal=OwnershipMigration.rehearsal(subjects,now);
    expect(rehearsal).toMatchObject({idempotent:true,readBack:2});
    expect(rehearsal.second.created).toBe(0);
    expect(rehearsal.second.preserved).toBe(2);
  });

  it('backup, restore and re-apply keep the same ownership set',async()=>{
    const dir=tempDir(),live=join(dir,'live.sqlite'),backup=join(dir,'backup.sqlite'),restored=join(dir,'restored.sqlite'),now=Date.now();
    const journal=open(live);
    const service=new OwnershipService(journal);
    new OwnershipMigration(journal).apply([{scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1,deadline:now+60_000,managementStatus:'AUTO_MANAGED',legacy:false}],now);
    service.recordTakeoverFromHuman(scope(),'cycle_a','LOSS_HANDOFF_BARS',now+1);
    journal.close();opened.pop();
    await new OwnershipMigration(open(live)).backup(backup);
    copyFileSync(backup,restored);
    expect(OwnershipMigration.verify(restored,['cycle_a'])).toMatchObject({owners:1,missing:[]});
    expect(OwnershipMigration.identical(backup,restored)).toBe(true);
    const replay=open(restored);
    expect(new OwnershipMigration(replay).apply([{scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1,deadline:now+60_000,managementStatus:'AUTO_MANAGED',legacy:false}],now)).toMatchObject({created:0,preserved:1});
    expect(new OwnershipService(replay).ownership(scope(),'cycle_a')).toMatchObject({ownerState:'HUMAN_MANAGED'});
  });
});

describe('S04-A durable claim primitives (not wired to any order path)',()=>{
  it('a claim survives a crash, is exactly-once by idempotency key, and only a terminal proof releases it',()=>{
    const file=join(tempDir(),'claims.sqlite'),now=Date.now();
    const writer=open(file);
    writer.initialize({scope:scope(),cycleId:'cycle_a',planRef:'plan-1',firstFillAt:now-1_000,durationMs:600_000,now,legacy:false});
    const version=writer.get(scope(),'cycle_a')!.ownerVersion;
    const reserved=writer.reserve(claim({claimId:'idem_1'}),1_000,version,now);
    expect(reserved.status).toBe('ACTIVE');
    const service=new OwnershipService(writer);
    expect(service.activeClaimUnits(scope())).toBe(100);
    expect(()=>service.releaseClaim('idem_1',{terminal:false,source:null},now+1)).toThrow('CLAIM_RELEASE_UNPROVEN');
    expect(()=>service.releaseClaim('idem_1',{terminal:true,source:null},now+1)).toThrow('CLAIM_RELEASE_UNPROVEN');
    // crash before any release
    const after=open(file);
    const afterService=new OwnershipService(after);
    expect(afterService.claimsFor(scope())).toHaveLength(1);
    expect(after.reserve(claim({claimId:'idem_1'}),1_000,version,now+2).claimId).toBe('idem_1');
    expect(()=>after.reserve(claim({claimId:'idem_1',quantityUnits:700}),1_000,version,now+2)).toThrow('IDEMPOTENCY_CONFLICT');
    expect(afterService.releaseClaim('idem_1',{terminal:true,source:'USER_TRADES'},now+3).status).toBe('RELEASED');
    expect(afterService.activeClaimUnits(scope())).toBe(0);
    expect(afterService.releaseClaim('idem_1',{terminal:false,source:null},now+4).status).toBe('RELEASED');
  });
});

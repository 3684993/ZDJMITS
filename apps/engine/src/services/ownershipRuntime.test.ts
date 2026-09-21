import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {EventBus} from '../events/eventBus.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {attachOwnershipRuntime} from './ownershipRuntime.js';
import {executionScope} from './executionLifecycle.js';

const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* Windows keeps a SQLite handle busy; an OS temp leftover is not a test failure */}}});
function tempFile(name='ownership.sqlite'){const dir=mkdtempSync(join(tmpdir(),'zdj-v396-owner-'));dirs.push(dir);return join(dir,name);}

const subject=(cycleId:string|null='cycle_a')=>({symbol:'BTCUSDT',positionSide:'LONG' as const,cycleId});
const scopeOf=(side='LONG')=>executionScope('TESTNET','binance-primary','BTCUSDT',side);

function harness(position:ReturnType<typeof subject>){
  const bus=new EventBus();
  const events:any[]=[];
  bus.on('event',event=>events.push(event));
  const runtime=attachOwnershipRuntime(bus,tempFile(),id=>id==='p1'?position:null,()=>({environment:'TESTNET',account:'binance-primary'}));
  return{bus,events,runtime};
}

describe('ownership runtime activation',()=>{
  it('records a human takeover durably and it survives a reopen',()=>{
    const {runtime,events}=harness(subject());
    expect(runtime.recordHumanTakeover('p1','LOSS_HANDOFF_BARS')).toBe(true);
    const file=(runtime as any).dbFile as string;
    const journal=new OwnershipJournal(file);
    const owner=journal.get(scopeOf(),'cycle_a');
    expect(owner).toMatchObject({cycleId:'cycle_a',ownerState:'HUMAN_MANAGED',reason:'LOSS_HANDOFF_BARS'});
    expect(owner!.ownerVersion).toBeGreaterThanOrEqual(2);
    expect(journal.pendingEvents().length).toBeGreaterThan(0);
    expect(runtime.metrics()).toMatchObject({enabled:true,recorded:1,degraded:0});
    journal.close();runtime.close();
    expect(events.some(event=>event.type==='V396_OWNERSHIP_JOURNAL_DEGRADED')).toBe(false);
  });

  it('is driven by the existing handoff and manual events without a caller change',()=>{
    const {bus,runtime}=harness(subject('cycle_evt'));
    bus.publish('POSITION_HUMAN_HANDOFF',{positionId:'p1',reason:'LOSS_HANDOFF_BARS'},'BTCUSDT');
    bus.publish('MANUAL_SUBMISSION_PREPARED',{positionId:'p1',intent:{positionId:'p1'}},'BTCUSDT');
    expect(runtime.metrics().recorded).toBe(2);
    const journal=new OwnershipJournal((runtime as any).dbFile as string);
    expect(journal.get(scopeOf(),'cycle_evt')?.ownerState).toBe('HUMAN_MANAGED');
    journal.close();runtime.close();
  });

  it('never lets a broken journal block the trading path',()=>{
    const bus=new EventBus();
    const events:any[]=[];
    bus.on('event',event=>events.push(event));
    // A path that cannot hold a SQLite file: the constructor fails, and the record must
    // degrade quietly instead of throwing into the publisher or the human exit caller.
    const runtime=attachOwnershipRuntime(bus,join(tmpdir(),'definitely-missing-root','zdj','nested','v396.sqlite'),()=>subject(),()=>({environment:'TESTNET',account:'binance-primary'}));
    expect(runtime.metrics().enabled).toBe(false);
    expect(()=>runtime.recordHumanTakeover('p1','MANUAL_SUBMISSION')).not.toThrow();
    expect(runtime.recordHumanTakeover('p1','MANUAL_SUBMISSION')).toBe(false);
    expect(runtime.expireDue()).toBe(0);
    expect(events.filter(event=>event.type==='V396_OWNERSHIP_JOURNAL_DEGRADED').length).toBeGreaterThan(0);
    expect(events.every(event=>event.payload?.affectsTradingPath===false||event.type!=='V396_OWNERSHIP_JOURNAL_DEGRADED')).toBe(true);
    runtime.close();
  });

  it('expires AI authority on the deadline without extending it',()=>{
    const file=tempFile();
    const journal=new OwnershipJournal(file);
    const now=Date.now();
    const created=journal.initialize({scope:scopeOf(),cycleId:'cycle_ai',planRef:'plan-1',firstFillAt:now-1_000,durationMs:60_000,now,legacy:false});
    expect(created).toMatchObject({ownerState:'AI_ACTIVE'});
    const bus=new EventBus();
    const runtime=attachOwnershipRuntime(bus,file,()=>subject('cycle_ai'),()=>({environment:'TESTNET',account:'binance-primary'}));
    expect(runtime.expireDue(now+30_000)).toBe(0);
    expect(runtime.expireDue(now+60_000)).toBe(1);
    expect(runtime.expireDue(now+70_000)).toBe(0);
    const reopened=new OwnershipJournal(file);
    const owner=reopened.get(scopeOf(),'cycle_ai');
    expect(owner).toMatchObject({ownerState:'HANDOFF_PENDING',reason:'AI_MANAGEMENT_EXPIRED'});
    expect(owner!.deadline).toBe(now-1_000+60_000);
    journal.close();reopened.close();runtime.close();
  });

  it('grants nothing when the cycle identity is unknown',()=>{
    const {runtime,events}=harness(subject(null));
    expect(runtime.recordHumanTakeover('p1','LOSS_HANDOFF_BARS')).toBe(false);
    expect(runtime.metrics()).toMatchObject({recorded:0,degraded:0});
    expect(events.length).toBe(0);
    runtime.close();
  });
});

import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {SettingsStore} from '../config/settingsStore.js';
import {entrySubmissionIsolation,portfolioScopeObservation} from './entrySubmissionIdentity.js';
import {NO_RISK_ABSENCE_SOURCES} from './entryRiskOccupancy.js';
import {EntryCoordinator} from './entryCoordinator.js';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';

/**
 * P3 acceptance, on a real SettingsStore and a real SQLite schema.
 *
 * The audited failure (ROOT_CAUSE_REPORT 8.2/R6) is not reproducible against a mocked journal: the
 * veto lived in the partial unique index on the persisted ENTRY scope, so a second Intent was
 * refused by storage, then re-labelled RESERVATION_INVALID one tick later. These tests drive the
 * same table, the same indexes and the same claim function the engine uses.
 */

const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});

const fundsOnlySettings={connections:{executionMode:'TESTNET_ENABLED',exchange:{environment:'TESTNET',credentialRef:'binance-primary'}}};
const productionSettings={connections:{executionMode:'ENABLED',exchange:{environment:'PRODUCTION',credentialRef:'binance-primary'}}};

async function openStore(){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-v396-submission-'));
  dirs.push(dataDir);
  const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);
  await store.load();
  return{store,dataDir};
}

const entryScope=(underlying:string,environment='TESTNET',account='binance-primary')=>JSON.stringify([environment,account,underlying,'ENTRY']);
const orderOf=(id:string,status='UNKNOWN',now=Date.now(),proof=false):any=>({
  id,intentId:id,symbol:`${id}USDT`,side:'LONG',status,exchangeTerminalStatus:status==='UNKNOWN'?'UNKNOWN':status,
  clientOrderId:`ml_${id}`,exchangeOrderId:status==='UNKNOWN'?null:`xe_${id}`,filledQuantity:0,quantity:1,price:100,
  createdAt:now-60_000,updatedAt:now,absoluteExpiresAt:now+3_600_000,repriceCount:0,
  activeRiskExposure:status==='UNKNOWN'&&!proof,
  ...(proof?{activeRiskEvidence:{status:'VERIFIED_NO_ACTIVE_RISK',checkedAt:now,validUntil:now+60_000,identityTombstone:`ENTRY:${id}`,sources:[...NO_RISK_ABSENCE_SOURCES,'BINANCE_LONG_SHORT_POSITION_ZERO']}}:{}),
});
const recordOf=(o:any)=>({intent:{id:o.intentId},order:o} as any);
const isolationFor=(settings:any,intentId:string,underlying:string,environment='TESTNET',account='binance-primary')=>
  entrySubmissionIsolation(settings,{environment,accountId:account,intentId,underlying,kind:'ENTRY'});

it('V398 durable no-add claim blocks a second wire even when two pre-Primary/JIT snapshots race',async()=>{
 const {store,dataDir}=await openStore(),other=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await other.load();
 try{
  const placeEntry=vi.fn(async(order:any)=>({...order,status:'WORKING',exchangeOrderId:'accepted'}));
  const create=(journalStore:SettingsStore,id:string)=>{
   const state=new RuntimeState(fundsOnlySettings as any),journal={claim:journalStore.claimEntryExecution.bind(journalStore),save:journalStore.saveEntryExecution.bind(journalStore)};
   const coordinator=new EntryCoordinator(state,{} as any,{} as any,{placeEntry} as any,new EventBus(),undefined,journal as any);
   // Both processes already passed their snapshot checks. Exercise the real final durable seam.
   (coordinator as any).executionHardBlock=()=>null;
   const intent={id,symbol:'ETHUSDT',side:'LONG',leverage:10,absoluteExpiresAt:Date.now()+60000,aiAuthorizationExpiresAt:Date.now()+60000} as any;
   const order=(coordinator as any).preparedOrder(intent,10,100,1);
   return{coordinator,intent,order};
  };
  const first=create(store,'origin'),second=create(other,'independent-add');
  await (first.coordinator as any).submitExactlyOnce(first.intent,first.order);
  await expect((second.coordinator as any).submitExactlyOnce(second.intent,second.order)).rejects.toThrow('NO_SEPARATE_ADD');
  expect(placeEntry).toHaveBeenCalledOnce();expect(other.noAddOrigin('TESTNET','binance-primary','ETHUSDT','LONG')).toMatchObject({intentId:'origin',quantity:10});
  const partial={...first.order,status:'UNKNOWN',filledQuantity:4,clientOrderId:first.order.clientOrderId};
  const query=vi.fn(async()=>({...partial,status:'PARTIALLY_FILLED',exchangeOrderId:'accepted'}));
  (first.coordinator as any).exchange={placeEntry,findEntryByClientOrderId:query};
  expect(await (first.coordinator as any).submitExactlyOnce(first.intent,partial)).toMatchObject({filledQuantity:4});
  expect(placeEntry).toHaveBeenCalledOnce();expect(query).toHaveBeenCalledOnce();
 }finally{other.close();store.close();}
});

it('V398 authorization and order quantity must agree before any durable origin is created',async()=>{
 const {store}=await openStore();try{
  const order=orderOf('cap-mismatch','NEW'),isolation={...isolationFor(fundsOnlySettings,order.intentId,'ETH'),noAdd:{authorizedQuantity:2}};
  expect(store.claimEntryExecution(entryScope('ETH'),recordOf(order),false,isolation)).toMatchObject({acquired:false,cause:'NO_SEPARATE_ADD',maySubmit:false});
  expect(store.noAddOrigin('TESTNET','binance-primary',order.symbol,order.side)).toBeNull();
 }finally{store.close();}
});

it('unchanged journal reconciliation performs no write but expired UNKNOWN proof reactivates its exact claim',async()=>{
 const {store}=await openStore(),now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
 try{
  const order=orderOf('stable','UNKNOWN',now);order.activeRiskExposure=false;
  order.activeRiskEvidence={status:'VERIFIED_NO_ACTIVE_RISK',proofTier:0,proofClass:'POSITION_ABSENT',checkedAt:now,validUntil:now+1000,identityTombstone:`ENTRY:${order.symbol.toUpperCase()}:${order.clientOrderId}`,sources:[...NO_RISK_ABSENCE_SOURCES,'BINANCE_LONG_SHORT_POSITION_ZERO']};
  const record=recordOf(order);store.claimEntryExecution(entryScope('stable'),record,false,isolationFor(fundsOnlySettings,order.intentId,'stable'));store.saveEntryExecution(record);
  const db=(store as any).db,before=Number(db.prepare('SELECT total_changes() n').get().n);
  expect(db.prepare('SELECT active,released_at FROM entry_execution_tasks WHERE intent_id=?').get(order.intentId)).toMatchObject({active:0,released_at:now});
  clock.mockReturnValue(now+50);store.saveEntryExecution(record);
  expect(Number(db.prepare('SELECT total_changes() n').get().n)).toBe(before);
  clock.mockReturnValue(now+2000);store.saveEntryExecution(record);
  expect(db.prepare('SELECT active,released_at FROM entry_execution_tasks WHERE intent_id=?').get(order.intentId)).toMatchObject({active:1,released_at:now});
  order.price=101;store.saveEntryExecution(record);expect(store.loadEntryExecutions()[0].order).toMatchObject({status:'UNKNOWN',price:101});
 }finally{clock.mockRestore();store.close();}
});

it('the cross-Intent ENTRY scope unique index is gone and is replaced by two distinct controls',async()=>{
  const {store,dataDir}=await openStore();
  try{
    const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'),{readOnly:true});
    const indexes=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='entry_execution_tasks'").all() as Array<{name:string;sql:string}>;
    db.close();
    const names=indexes.map(row=>row.name);
    expect(names).not.toContain('entry_execution_scope');
    expect(names).toContain('entry_execution_submission');
    expect(names).toContain('entry_execution_underlying_isolation');
    const submission=indexes.find(row=>row.name==='entry_execution_submission')!.sql;
    expect(submission).toMatch(/UNIQUE/i);
    expect(submission).toContain('submission_key');
    expect(submission).toMatch(/WHERE\s+active\s*=\s*1/i);
    const legacy=indexes.find(row=>row.name==='entry_execution_underlying_isolation')!.sql;
    // The legacy exclusion has to be conditional on the mode, otherwise removing it from funds-only
    // would also remove it from Production.
    expect(legacy).toContain('isolation_mode');
    expect(legacy).toContain('UNDERLYING_LEGACY');
    expect((store as any).db.prepare('SELECT version FROM schema_migrations WHERE version=11').get()).toBeTruthy();
  }finally{store.close();}
});

it('funds-only: a historical UNKNOWN claim on the same underlying cannot veto a new Intent',async()=>{
  const {store}=await openStore();
  try{
    // The audited shape: an older INJ Intent left an UNKNOWN durable task with an expired proof.
    const old=orderOf('INJ_old','UNKNOWN',Date.now()-3_600_000);
    const oldIsolation=isolationFor(fundsOnlySettings,old.intentId,'INJ');
    expect(store.claimEntryExecution(entryScope('INJ'),recordOf(old),false,oldIsolation).acquired).toBe(true);
    store.saveEntryExecution(recordOf(old));
    const stats=store.entryExecutionClaimStats();
    expect(stats.activeUnknownClaims).toBeGreaterThan(0);

    const fresh=orderOf('INJ_new','SUBMITTING',Date.now(),true);
    const claim=store.claimEntryExecution(entryScope('INJ'),recordOf(fresh),false,isolationFor(fundsOnlySettings,fresh.intentId,'INJ'));
    expect(claim.acquired).toBe(true);
    expect(claim.cause).toBe('ACQUIRED');
    // The history is still reported - as an observation, with enforced=false.
    const observation=portfolioScopeObservation({settings:fundsOnlySettings,environment:'TESTNET',accountId:'binance-primary',underlying:'INJ',side:'LONG',historicalUnknownRows:1,activeClaimRows:2});
    expect(observation).toMatchObject({enforced:false,basis:'TESTNET_FUNDS_ONLY_OBSERVATION'});
  }finally{store.close();}
});

it('Production legacy mode still excludes a second Intent on the same underlying',async()=>{
  const {store}=await openStore();
  try{
    const first=orderOf('BTC_a','WORKING');
    expect(store.claimEntryExecution(entryScope('BTC','PRODUCTION'),recordOf(first),false,isolationFor(productionSettings,first.intentId,'BTC','PRODUCTION')).acquired).toBe(true);
    store.saveEntryExecution(recordOf(first));
    const second=orderOf('BTC_b','SUBMITTING');
    const claim=store.claimEntryExecution(entryScope('BTC','PRODUCTION'),recordOf(second),false,isolationFor(productionSettings,second.intentId,'BTC','PRODUCTION'));
    expect(claim.acquired).toBe(false);
    expect(claim.cause).toBe('LEGACY_UNDERLYING_ISOLATION');
    expect(claim.conflict?.intentId).toBe('BTC_a');
    expect(portfolioScopeObservation({settings:productionSettings,environment:'PRODUCTION',accountId:'binance-primary',underlying:'BTC',side:'LONG'}).enforced).toBe(true);
  }finally{store.close();}
});

it('the same Intent replays to its own identity and is never given a second submit right',async()=>{
  const {store}=await openStore();
  try{
    const o=orderOf('CRV_1','SUBMITTING');
    const isolation=isolationFor(fundsOnlySettings,o.intentId,'CRV');
    expect(store.claimEntryExecution(entryScope('CRV'),recordOf(o),false,isolation).acquired).toBe(true);
    store.saveEntryExecution(recordOf(o));
    const replay=store.claimEntryExecution(entryScope('CRV'),recordOf(orderOf('CRV_1','UNKNOWN')),false,isolation);
    expect(replay.acquired).toBe(false);
    expect(replay.cause).toBe('SAME_INTENT_UNACKNOWLEDGED_RECOVER');
    expect(replay.mustQueryFirst).toBe(true);
    // An unacknowledged identity may not be told to submit again, whatever else changed.
    expect(replay.maySubmit).toBe(false);
    // Same submission key, different payload: storage refuses it outright.
    const db=(store as any).db as DatabaseSync;
    expect(()=>db.prepare('INSERT INTO entry_execution_tasks(intent_id,scope,active,payload,updated_at,submission_key,isolation_key,isolation_mode) VALUES(?,?,1,?,?,?,?,?)')
      .run('CRV_forged',entryScope('CRV'),'{}',Date.now(),isolation.submissionKey,isolation.isolationKey,'SUBMISSION_ONLY')).toThrow();
  }finally{store.close();}
});

it('two concurrent writers on one Intent produce exactly one active row',async()=>{
  const {store,dataDir}=await openStore();
  try{
    const o=orderOf('TIA_1','SUBMITTING');
    const isolation=isolationFor(fundsOnlySettings,o.intentId,'TIA');
    const first=store.claimEntryExecution(entryScope('TIA'),recordOf(o),false,isolation);
    // A second process in the same instant reads the ledger under its own write lock.
    const peer=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);
    await peer.load();
    const second=peer.claimEntryExecution(entryScope('TIA'),recordOf({...o,updatedAt:Date.now()+1}),false,isolation);
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.cause).toBe('SAME_INTENT_UNACKNOWLEDGED_RECOVER');
    const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'),{readOnly:true});
    const rows=db.prepare('SELECT COUNT(*) c FROM entry_execution_tasks WHERE submission_key=? AND active=1').get(isolation.submissionKey);
    db.close();peer.close();
    expect(Number(rows.c)).toBe(1);
  }finally{store.close();}
});

it('a released submission identity is not revived by a later claim of the same Intent',async()=>{
  const {store}=await openStore();
  try{
    const o=orderOf('APT_1','CANCELED',Date.now(),true);
    const isolation=isolationFor(fundsOnlySettings,o.intentId,'APT');
    store.claimEntryExecution(entryScope('APT'),recordOf(o),false,isolation);
    store.saveEntryExecution(recordOf(o));
    // The exchange proved this identity terminal and its claim released: that is the durable state a
    // released row has, written here directly so the test is about the rule, not about the predicate.
    (store as any).db.prepare("UPDATE entry_execution_tasks SET active=0,released_at=? WHERE intent_id='APT_1'").run(Date.now());
    const revival=store.claimEntryExecution(entryScope('APT'),recordOf(orderOf('APT_1','SUBMITTING')),false,isolation);
    expect(revival.acquired).toBe(false);
    expect(revival.cause).toBe('RELEASED_IDENTITY_IMMUTABLE');
    expect(revival.maySubmit).toBe(false);
    // The POST_ONLY reprice path passes retryRejected to re-arm a row the exchange never accepted; it
    // must not turn a released identity into a fresh submit right.
    const retried=store.claimEntryExecution(entryScope('APT'),recordOf(orderOf('APT_1','SUBMITTING')),true,isolation);
    expect(retried.acquired).toBe(false);
    expect(retried.cause).toBe('RELEASED_IDENTITY_IMMUTABLE');
    expect(retried.maySubmit).toBe(false);
  }finally{store.close();}
});

it('a journal conflict keeps its own cause instead of becoming a reservation error',async()=>{
  const {store}=await openStore();
  try{
    const o=orderOf('DOGE_1','SUBMITTING');
    const isolation=isolationFor(fundsOnlySettings,o.intentId,'DOGE');
    store.claimEntryExecution(entryScope('DOGE'),recordOf(o),false,isolation);
    // Corrupt the ledger the way a half-finished write would. The claim must fail as a journal fault
    // and must not be dressed up as an exchange or reservation problem by anything downstream.
    (store as any).db.prepare("UPDATE entry_execution_tasks SET active=1,payload='not-json' WHERE intent_id='DOGE_1'").run();
    expect(()=>store.claimEntryExecution(entryScope('DOGE'),recordOf({...o,updatedAt:Date.now()+1}),false,isolation)).toThrow();
    const stats=store.entryExecutionClaimStats();
    expect(stats.durableTasks).toBe(1);
    expect(stats.activeClaims).toBe(1);
    expect(stats.byIsolationMode.SUBMISSION_ONLY.rows).toBe(1);
    expect(stats.byIsolationMode.UNDERLYING_LEGACY.activeClaims).toBe(0);
    // A funds-only row is never counted as a legacy scope holder, so a broken foreign row cannot veto
    // a new Intent - and it is not deleted or rewritten to make the ledger look clean either.
    const fresh=orderOf('DOGE_2','SUBMITTING');
    const freshClaim=store.claimEntryExecution(entryScope('DOGE'),recordOf(fresh),false,isolationFor(fundsOnlySettings,fresh.intentId,'DOGE'));
    expect(freshClaim.acquired).toBe(true);
    expect(store.entryExecutionClaimStats().durableTasks).toBe(2);
  }finally{store.close();}
});

it('funds-only rows never participate in the legacy unique index',async()=>{
  const {store,dataDir}=await openStore();
  try{
    const underlying='SOL';
    for(const id of ['SOL_1','SOL_2','SOL_3']){
      const o=orderOf(id,'WORKING');
      const claim=store.claimEntryExecution(entryScope(underlying),recordOf(o),false,isolationFor(fundsOnlySettings,o.intentId,underlying));
      expect(claim.acquired).toBe(true);
      store.saveEntryExecution(recordOf(o));
    }
    const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'),{readOnly:true});
    const modes=db.prepare('SELECT isolation_mode,COUNT(*) c FROM entry_execution_tasks GROUP BY isolation_mode').all() as Array<{isolation_mode:string;c:number}>;
    db.close();
    expect(modes.find(row=>row.isolation_mode==='SUBMISSION_ONLY')?.c).toBe(3);
    // Three live Intents on one underlying coexist under funds-only, which is exactly what the old
    // single-index claim made impossible.
    expect(store.entryExecutionClaimStats().activeClaims).toBe(3);
  }finally{store.close();}
});

it('restarting on a funds-only ledger does not resurrect the scope veto index',async()=>{
  const {store,dataDir}=await openStore();
  const underlying='DOGE';
  for(const id of ['DOGE_1','DOGE_2']){
    const o=orderOf(id,'UNKNOWN');
    expect(store.claimEntryExecution(entryScope(underlying),recordOf(o),false,isolationFor(fundsOnlySettings,o.intentId,underlying)).acquired).toBe(true);
    store.saveEntryExecution(recordOf(o));
  }
  store.close();
  // The audited control regrew exactly here: open() used to re-create the legacy partial unique index
  // before dropping it, and creating it over two ACTIVE rows in one ENTRY scope threw
  // `UNIQUE constraint failed: entry_execution_tasks.scope` - the Engine could no longer start.
  const reopened=await (async()=>{const second=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await second.load();return second;})().catch(error=>{throw new Error(`REOPEN_FAILED:${error instanceof Error?error.message:String(error)}`);});
  try{
    const db=new DatabaseSync(path.join(dataDir,'zdj-settings.sqlite'),{readOnly:true});
    const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entry_execution_tasks'").all() as Array<{name:string}>).map(row=>row.name);
    const active=(db.prepare('SELECT COUNT(*) c FROM entry_execution_tasks WHERE scope=? AND active=1').get(entryScope(underlying)) as {c:number}).c;
    db.close();
    expect(names).not.toContain('entry_execution_scope');
    expect(Number(active)).toBe(2);
    // Both submissions still claim the same underlying, and neither is a cross-Intent veto.
    const stats=reopened.entryExecutionClaimStats();
    expect(stats.byIsolationMode.SUBMISSION_ONLY.rows).toBeGreaterThanOrEqual(2);
    expect(stats.vetoEnforced).toBe(false);
  }finally{reopened.close();}
});

it('WORKING replay cannot authorize another submit; client identity and payload cannot fork',async()=>{
  const {store}=await openStore();try{
    const order=orderOf('same','WORKING'),isolation=isolationFor(fundsOnlySettings,'same','BTC');
    expect(store.claimEntryExecution(entryScope('BTC'),recordOf(order),false,isolation).acquired).toBe(true);
    expect(store.claimEntryExecution(entryScope('BTC'),recordOf(order),false,isolation)).toMatchObject({acquired:false,maySubmit:false,mustQueryFirst:true});
    expect(store.claimEntryExecution(entryScope('BTC'),recordOf({...order,quantity:2}),false,isolation).cause).toBe('SUBMISSION_IDENTITY_CONFLICT');
    const other={...order,id:'other',intentId:'other'};
    expect(store.claimEntryExecution(entryScope('BTC'),recordOf(other),false,isolationFor(fundsOnlySettings,'other','BTC')).cause).toBe('SUBMISSION_IDENTITY_CONFLICT');
  }finally{store.close();}
});

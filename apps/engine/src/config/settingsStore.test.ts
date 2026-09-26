import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.mock('@zdj/contracts', async () => import(new URL('../../../../packages/contracts/src/index.js', import.meta.url).href));
import { SettingsStore } from './settingsStore.js';
vi.mock('@zdj/core', async () => import(new URL('../../../../packages/core/src/index.js', import.meta.url).href));
import { classifyAsset } from '@zdj/core';

const paths: string[] = [];

it('repairs a stale checkpoint cache after another connection evicts an entity',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-checkpoint-cache-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();
 try{const db=(store as any).db,value={executionFills:[{fillId:'f1',qty:1}]};store.persistRuntime(value);db.prepare("DELETE FROM runtime_entities WHERE kind='executionFills'").run();store.persistRuntime(value);expect(store.loadRuntime()).toMatchObject(value);}finally{store.close();}
});

it('replays only exact archived fills without writes and fails closed on conflicting evidence',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-checkpoint-replay-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();
 try{const db=(store as any).db,fill={fillId:'exchange_BTCUSDT_1',symbol:'BTCUSDT',direction:'LONG',side:'BUY',positionSide:'LONG',orderId:'order1',clientOrderId:'client1',tradeId:'1',executionTime:100,qty:1,price:100,realizedPnl:0,commission:1,commissionAsset:'USDT',commissionUsd:1,maker:true,source:'USER_DATA_WS',attributionStatus:'SYSTEM_ATTRIBUTED'};store.persistRuntime({executionFills:[fill]});db.prepare("DELETE FROM runtime_entities WHERE kind='executionFills'").run();
 expect(()=>store.loadRuntime()).toThrow('RUNTIME_ENTITY_MISSING');
 store.recordRuntimeEvent({id:'fact1',type:'EXCHANGE_FILL_ATTRIBUTED',ts:101,payload:{fill}});
 const before=db.prepare('SELECT total_changes() n').get().n;
 expect(store.loadRuntime()).toMatchObject({executionFills:[fill]});expect(db.prepare('SELECT total_changes() n').get().n).toBe(before);expect(store.runtimeLoadRecoveries.at(-1)?.sourceEventIds).toEqual(['fact1']);
 store.recordRuntimeEvent({id:'fact2',type:'EXCHANGE_FILL_ATTRIBUTED',ts:102,payload:{fill:{...fill,qty:2}}});expect(()=>store.loadRuntime()).toThrow('RUNTIME_FILL_REPLAY_CONFLICT');
 }finally{store.close();}
});
afterEach(async () => { await Promise.all(paths.splice(0).map(value => rm(value, { recursive: true, force: true }))); });

describe('SettingsStore', () => {
  it('migrates V3.9.4 economics by field facts while preserving a high optimistic settings revision',async()=>{
    const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-v395-settings-migration-'));paths.push(dataDir);
    const configDir=path.resolve(process.cwd(),'../../config'),first=new SettingsStore(configDir,dataDir),initial=await first.load();
    const legacy:any=structuredClone(initial);legacy.settingsVersion=177;legacy.takeProfit.minNetProfitUsd=.01;delete legacy.tradeEconomics;
    delete legacy.positionManagement.humanManagedAdmissionCapsEnabled;delete legacy.positionManagement.maxHumanManagedPositions;delete legacy.positionManagement.maxHumanManagedNotionalPctEquity;
    (first as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify(legacy));first.close();
    const reopened=new SettingsStore(configDir,dataDir);
    try{const migrated=await reopened.load();expect(migrated.settingsVersion).toBe(177);expect(migrated.takeProfit.minNetProfitUsd).toBe(1);expect(migrated.tradeEconomics.admissionMode).toBe('SHADOW');expect(migrated.positionManagement.maxHumanManagedPositions).toBe(4);}
    finally{reopened.close();}
  });
  it('rejects a migrated minNetProfitUsd below the floor instead of rewriting it on boot',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v395-clamp-low-'));paths.push(dir);const configDir=path.resolve(process.cwd(),'../../config');
    const boot=new SettingsStore(configDir,dir);const base:any=await boot.load();base.settingsVersion=177;
    (boot as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify({...base,takeProfit:{...base.takeProfit,minNetProfitUsd:.5}}));boot.close();
    const probe=new SettingsStore(configDir,dir);
    await expect(probe.load()).rejects.toThrow();
    const row=(probe as any).db.prepare('SELECT version,payload FROM settings WHERE id=1').get();probe.close();
    expect(JSON.parse(row.payload).takeProfit.minNetProfitUsd).toBe(.5);expect(row.version).toBe(177);
  });
  it('rejects a migrated minNetProfitUsd above the ceiling instead of clamping it to 20',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v395-clamp-high-'));paths.push(dir);const configDir=path.resolve(process.cwd(),'../../config');
    const boot=new SettingsStore(configDir,dir);const base:any=await boot.load();base.settingsVersion=177;
    (boot as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify({...base,takeProfit:{...base.takeProfit,minNetProfitUsd:25}}));boot.close();
    const probe=new SettingsStore(configDir,dir);
    await expect(probe.load()).rejects.toThrow();
    const row=(probe as any).db.prepare('SELECT version,payload FROM settings WHERE id=1').get();probe.close();
    expect(JSON.parse(row.payload).takeProfit.minNetProfitUsd).toBe(25);expect(row.version).toBe(177);
  });
  it('keeps in-range migrated floors untouched and migrates a legacy document exactly once',async()=>{
    const configDir=path.resolve(process.cwd(),'../../config');
    for(const value of [1,2,20]){
      const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v395-keep-'));paths.push(dir);
      const boot=new SettingsStore(configDir,dir);const base:any=await boot.load();base.settingsVersion=177;
      (boot as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify({...base,takeProfit:{...base.takeProfit,minNetProfitUsd:value}}));boot.close();
      const first=new SettingsStore(configDir,dir);const kept=await first.load();first.close();
      expect(kept.takeProfit.minNetProfitUsd).toBe(value);expect(kept.settingsVersion).toBe(177);
    }
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-v395-once-'));paths.push(dir);
    const boot=new SettingsStore(configDir,dir);const base:any=await boot.load();
    const legacy:any=structuredClone(base);legacy.settingsVersion=177;legacy.takeProfit.minNetProfitUsd=.01;delete legacy.tradeEconomics;
    delete legacy.positionManagement.humanManagedAdmissionCapsEnabled;delete legacy.positionManagement.maxHumanManagedPositions;delete legacy.positionManagement.maxHumanManagedNotionalPctEquity;
    (boot as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify(legacy));boot.close();
    const migratedStore=new SettingsStore(configDir,dir);const migrated=await migratedStore.load();migratedStore.close();
    expect(migrated.takeProfit.minNetProfitUsd).toBe(1);expect(migrated.tradeEconomics.admissionMode).toBe('SHADOW');expect(migrated.tradeEconomics.parameterProfile).toBe('CUSTOM');expect(migrated.positionManagement.maxHumanManagedPositions).toBe(4);
    const stored=JSON.stringify(migrated);
    const againStore=new SettingsStore(configDir,dir);const again=await againStore.load();againStore.close();
    const thirdStore=new SettingsStore(configDir,dir);const third=await thirdStore.load();thirdStore.close();
    expect(JSON.stringify(again)).toBe(stored);expect(JSON.stringify(third)).toBe(stored);
    expect(again.settingsVersion).toBe(177);expect(third.takeProfit.minNetProfitUsd).toBe(1);
  });
  it('persists versioned settings in SQLite and creates an integrity-checked backup', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'zdj-settings-')); paths.push(dataDir);
    const configDir = path.resolve(process.cwd(), '../../config'); const store = new SettingsStore(configDir, dataDir);
    const initial = await store.load(); const saved = await store.save({ ...initial, entry: { ...initial.entry, maxReprices: initial.entry.maxReprices + 1 } });
    expect(saved.settingsVersion).toBeGreaterThan(initial.settingsVersion); expect(store.integrityCheck()).toBe(true);
    const backup = path.join(dataDir, 'backup.sqlite'); await store.backup(backup); expect((await stat(backup)).size).toBeGreaterThan(0);
    const restored = new SettingsStore(configDir, dataDir); const recovered = await restored.load(); expect(recovered.entry.maxReprices).toBe(saved.entry.maxReprices); restored.close(); store.close();
  });
  it('rejects a stale compare-and-swap settings publish without changing current settings',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-settings-cas-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir),initial=await store.load();await store.save({...initial,entry:{...initial.entry,maxReprices:initial.entry.maxReprices+1}});await expect(store.saveIfVersion({...initial,entry:{...initial.entry,maxReprices:99}},initial.settingsVersion)).rejects.toThrow('SETTINGS_VERSION_CONFLICT');expect((await store.load()).entry.maxReprices).toBe(initial.entry.maxReprices+1);store.close();});
  it('accepts exactly one concurrent same-version CAS publish',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-settings-cas-race-'));paths.push(dir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dir),initial=await store.load(),a={...initial,entry:{...initial.entry,maxReprices:31}},b={...initial,entry:{...initial.entry,maxReprices:32}},results=await Promise.allSettled([store.saveIfVersion(a,initial.settingsVersion),store.saveIfVersion(b,initial.settingsVersion)]);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect((await store.load()).settingsVersion).toBe(initial.settingsVersion+1);store.close();});
  it('round-trips per-asset admission evidence through schema and SQLite',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-settings-admission-'));paths.push(dir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dir),initial=await store.load(),now=1_000_000,approval={symbol:'SOLUSDT',reason:'TEST',reviewedAt:now,validUntil:now+10,graceUntil:now+20,lkgSourceFailed:false,quoteVolumeUsd24h:30_000_000,medianDailyQuoteVolumeUsd30d:30_000_000,tradeCount24h:30_000,openInterestUsd:6_000_000,listingAgeDays:200,liquidityComposite:.5};await store.save({...initial,selection:{...initial.selection,assetDirectory:{...initial.selection.assetDirectory,version:'V3.9.1-test',methodVersion:'V3.9.1-LIQUIDITY-30D-V4',reviewedAt:now,nextReviewAt:now+10,evidenceHash:'evidence',approvedLiquid:['SOL'],excluded:[],approvals:{SOL:approval},lkgAssets:[]}}});const reopened=new SettingsStore(path.resolve(process.cwd(),'../../config'),dir);try{const reloaded=await reopened.load(),fresh=classifyAsset('SOLUSDT',reloaded,now+1);expect(fresh.reason).toBe('TRACEABLE_V4_DIRECTORY_APPROVAL');expect(fresh.classification).toBe('APPROVED_LIQUID');const grace=structuredClone(reloaded);(grace.selection.assetDirectory.approvals.SOL as any).lkgSourceFailed=true;expect(classifyAsset('SOLUSDT',grace,now+15).classification).toBe('APPROVED_LIQUID');expect(classifyAsset('SOLUSDT',grace,now+21).reason).toBe('ASSET_APPROVAL_EXPIRED');grace.selection.assetDirectory.excluded=['SOL'];expect(classifyAsset('SOLUSDT',grace,now+1).classification).toBe('EXCLUDED');}finally{reopened.close();store.close();}});
  it('persists runtime facts and redacted bounded audit metrics',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-runtime-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();store.persistRuntime({positions:[['p',{symbol:'BTCUSDT'}]]});store.recordRuntimeEvent({id:'e1',type:'TEST',ts:1,payload:{apiSecret:'must-not-leak'}});expect(store.loadRuntime<any>().positions[0][0]).toBe('p');expect(store.operationalMetrics()).toMatchObject({integrity:true,auditEvents:1});store.close();});
  it('keeps complete AI artifacts in the run archive and a lossless JSON reference in its decision chain',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-run-artifact-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();const run={id:'run1',symbol:'BTCUSDT',startedAt:1,status:'COMPLETED',inputPreview:'x'.repeat(20_000),outputPreview:'y'.repeat(20_000),normalizedPreview:'{}'};store.recordRuntimeEvent({id:'e1',type:'AI_RUN_COMPLETED',ts:2,symbol:'BTCUSDT',payload:run});expect(store.getAiRun('run1').inputPreview).toHaveLength(20_000);expect(store.getDecisionChain('run1').events[0].payload).toMatchObject({artifactRef:{table:'ai_runs_archive',runId:'run1'}});expect(store.getDecisionChain('run1').events[0].payload.inputPreview).toBeUndefined();store.close();});
  it('paginates compact AI summaries in SQL with a stable tie-break and keeps full detail by id',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-run-page-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();for(let i=0;i<105;i++)store.upsertAiRun({id:`run_${String(i).padStart(3,'0')}`,symbol:i%2?'ETHUSDT':'BTCUSDT',role:'PRIMARY_BRAIN',model:'qwen3.5:27b',status:'COMPLETED',decision:i%3?'NO_DIRECTION_EDGE':'WAIT_FOR_PRICE',direction:i%2?'LONG':'SHORT',startedAt:1000,completedAt:1100,latencyMs:100,inputTokens:10,outputTokens:5,inputPreview:'x'.repeat(10000)});const page=store.listAiRunSummaries({from:0,page:2,limit:20,role:'PRIMARY_BRAIN'});expect(page).toMatchObject({page:2,limit:20,total:105});expect(page.items).toHaveLength(20);expect(page.items[0].id).toBe('run_084');expect(JSON.stringify(page).length).toBeLessThan(50_000);expect(store.getAiRun('run_084').inputPreview).toHaveLength(10_000);store.close();});
  it('deduplicates and recovers external research tasks across store instances',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-research-'));paths.push(dataDir);const configDir=path.resolve(process.cwd(),'../../config');const snapshot={contentHash:'hash1',sourceId:'source1',availableAt:1};const first=new SettingsStore(configDir,dataDir);await first.load();expect(first.enqueueExternalResearch(snapshot)).toBe(true);expect(first.enqueueExternalResearch(snapshot)).toBe(false);expect(first.nextExternalResearch(2)?.contentHash).toBe('hash1');first.close();const second=new SettingsStore(configDir,dataDir);await second.load();(second as any).db.prepare("UPDATE external_research_tasks SET updated_at=0 WHERE content_hash='hash1'").run();expect(second.nextExternalResearch(200000)?.attempts).toBe(2);second.completeExternalResearch('hash1',{facts:[]});expect(second.externalResearchMetrics()).toMatchObject({queued:0,running:0,completed:1});second.close();});
  it('recovers deduplicated persisted exchange fill facts for restart-safe sync',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-fill-facts-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();const fill={symbol:'币安人生USDT',tradeId:'f1',executionTime:100,source:'USER_DATA_WS'};store.recordRuntimeEvent({id:'fill-ws',type:'EXCHANGE_FILL_ATTRIBUTED',ts:110,symbol:'币安人生USDT',payload:{fill}});store.recordRuntimeEvent({id:'fill-audit',type:'EXCHANGE_FILL_ATTRIBUTED',ts:120,symbol:'币安人生USDT',payload:{fill:{...fill,source:'EXCHANGE_AUDIT'}}});expect(store.listPersistedExchangeFillFacts('币安人生USDT',0,200)).toEqual([{...fill,source:'EXCHANGE_AUDIT'}]);store.close();});
  it('creates versioned product tables and supports resource CRUD',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-resources-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();store.upsertTradeRecord({tradeId:'t1',status:'OPEN',symbol:'BTCUSDT'});store.upsertExperienceSample({sampleId:'s1',tradeId:'t1',createdAt:1});store.resourceSave('proxy',{id:'p1',enabled:true});expect(store.listTradeRecords()).toHaveLength(1);expect(store.listExperienceSamples()).toHaveLength(1);expect(store.resourceList('proxy').some(row=>row.id==='p1')).toBe(true);store.resourceDelete('proxy','p1');expect(store.resourceList('proxy').some(row=>row.id==='p1')).toBe(false);store.close();});
  it('repairs missing external intelligence tables even when migration 7 is marked',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-external-migration-'));paths.push(dataDir);const configDir=path.resolve(process.cwd(),'../../config');const first=new SettingsStore(configDir,dataDir);await first.load();(first as any).db.exec('DROP TABLE external_provider_state; INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(7,1)');first.close();const repaired=new SettingsStore(configDir,dataDir);await repaired.load();repaired.setExternalProviderState('FEDERAL_RESERVE',{provider:'FEDERAL_RESERVE',status:'DISABLED'});expect(repaired.listExternalProviderStates()).toEqual([{provider:'FEDERAL_RESERVE',status:'DISABLED'}]);repaired.close();});
  it('rolls back a bounded transaction and rejects async transaction callbacks',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-transaction-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();try{await expect(store.transaction(()=>{store.resourceSave('proxy',{id:'rolled-back'});throw new Error('FORCE_ROLLBACK');},{timeoutMs:50,label:'TEST'})).rejects.toThrow('FORCE_ROLLBACK');expect(store.resourceList('proxy').some(row=>row.id==='rolled-back')).toBe(false);await expect(store.transaction((async()=>1) as any,{timeoutMs:50,label:'ASYNC'})).rejects.toThrow('SQLITE_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN');}finally{store.close();}});
  it('rolls back when the transaction deadline is exceeded',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-transaction-timeout-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);await store.load();try{await expect(store.transaction(()=>{store.resourceSave('proxy',{id:'too-slow'});const until=Date.now()+8;while(Date.now()<until){}return 1;},{timeoutMs:1,label:'TIMEOUT'})).rejects.toThrow('SQLITE_TRANSACTION_TIMEOUT:TIMEOUT');expect(store.resourceList('proxy').some(row=>row.id==='too-slow')).toBe(false);}finally{store.close();}});
});

it('migrates full recovery facts into atomic incremental entities and survives a database reopen',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-entities-'));paths.push(dir);const config=path.resolve('../../config');let store=new SettingsStore(config,dir);await store.load();const value={positions:[['p',{quantity:2}]],aiRuns:[{id:'run',inputPreview:'x'.repeat(100000)}],executionFills:[{fillId:'fill',qty:2}],manualExitGoals:[['p',{attempt:1}]]};store.persistRuntime(value);expect(store.checkpointMetrics().entityWrites).toBe(3);store.persistRuntime({...value,positions:[['p',{quantity:1}]]});expect(store.checkpointMetrics().entityWrites).toBe(1);expect(store.checkpointMetrics().checkpointBytes).toBeLessThan(1000);store.close();store=new SettingsStore(config,dir);await store.load();expect(store.loadRuntime()).toEqual({...value,positions:[['p',{quantity:1}]]});store.close();});
it('rolls back entity changes if checkpoint commit fails',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-entities-rollback-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();store.persistRuntime({positions:[['p',{quantity:1}]]});(store as any).db.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON runtime_state BEGIN SELECT RAISE(ABORT,'TEST_CHECKPOINT_FAILURE'); END;");expect(()=>store.persistRuntime({positions:[['p',{quantity:2}]]})).toThrow('TEST_CHECKPOINT_FAILURE');expect(store.loadRuntime()).toEqual({positions:[['p',{quantity:1}]]});store.close();});
it('records capacity before/after and preserves memory when settings persistence fails',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-capacity-audit-'));paths.push(dataDir);const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dataDir);const initial=await store.load();
 try{await store.save({...initial,portfolio:{...initial.portfolio,maxPositions:15}});const row=(store as any).db.prepare('SELECT summary FROM settings_audit ORDER BY id DESC LIMIT 1').get();expect(JSON.parse(row.summary).maxPositions).toEqual({before:initial.portfolio.maxPositions,after:15});
 (store as any).db.exec("CREATE TRIGGER reject_settings BEFORE UPDATE ON settings BEGIN SELECT RAISE(FAIL,'TEST_REJECT'); END");await expect(store.save({...initial,portfolio:{...initial.portfolio,maxPositions:20}})).rejects.toThrow('TEST_REJECT');expect((store as any).current.portfolio.maxPositions).toBe(15);
 }finally{store.close();}
});

it('archives AI telemetry without journaling it and retains changed position transitions',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-telemetry-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();
 try{store.recordRuntimeEvent({id:'run-event',type:'AI_RUN_COMPLETED',ts:Date.now(),payload:{id:'run',status:'COMPLETED',symbol:'BTCUSDT',startedAt:Date.now(),decision:'WAIT_FOR_PRICE'}});
 expect(store.getAiRun('run').decision).toBe('WAIT_FOR_PRICE');expect(store.runtimeEvents(0,['AI_RUN_COMPLETED'])).toHaveLength(0);
 for(const transition of ['UNCHANGED','OPEN','REDUCE','CLOSE'])store.recordRuntimeEvent({id:transition,type:'POSITION_LIFECYCLE_TRANSITION',ts:Date.now(),payload:{transition}});
 expect(store.runtimeEvents(0,['POSITION_LIFECYCLE_TRANSITION'])).toHaveLength(3);
 }finally{store.close();}
});
it('runs bounded retention, keeps raw running AI and all critical events, and evicts only orphan AI entities',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-retention-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();const db=(store as any).db,now=Date.now(),old=now-120*86400000;
 try{for(let i=0;i<150;i++)db.prepare('INSERT INTO decision_snapshots VALUES(?,?,?,?,?)').run('s'+i,null,'BTCUSDT',old,'{}');
 for(const status of ['RUNNING','COMPLETED'])store.upsertAiRun({id:status,startedAt:old,status,inputPreview:'raw'});
 store.recordRuntimeEvent({id:'critical',type:'TP_REPAIR_FAILED',ts:old,payload:{order:'working'}});
 store.persistRuntime({aiRuns:[{id:'old-ai'}],positions:[['p',{quantity:1}]]});store.persistRuntime({aiRuns:[],positions:[]});
 expect(db.prepare("SELECT count(*) n FROM runtime_entities WHERE kind='aiRuns'").get().n).toBe(0);expect(db.prepare("SELECT count(*) n FROM runtime_entities WHERE kind='positions'").get().n).toBe(1);
 store.maintainRetention(now);expect(db.prepare('SELECT count(*) n FROM decision_snapshots').get().n).toBe(50);
 for(let i=0;i<22;i++)store.maintainRetention(now);
 expect(store.getAiRun('RUNNING').inputPreview).toBe('raw');expect(store.getAiRun('COMPLETED')).toBeNull();expect(store.runtimeEvents(0,['TP_REPAIR_FAILED'])).toHaveLength(1);
 }finally{store.close();}
});
it('reuses a single trade sync baseline across concurrent sync requests',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-baseline-'));paths.push(dir);const store=new SettingsStore(path.resolve('../../config'),dir);await store.load();
 try{const results=await Promise.all([store.tradeSyncBaseline(dir),store.tradeSyncBaseline(dir)]);expect(results[0]).toBe(results[1]);const first=await stat(results[0]!);store.persistRuntime({newFact:true});expect(await store.tradeSyncBaseline(dir)).toBe(results[0]);expect((await stat(results[0]!)).mtimeMs).toBe(first.mtimeMs);}finally{store.close();}
});


describe('Live inference evidence',()=>{
  it('persists failed Primary runs as inference evidence without inventing an opportunity',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-inference-'));paths.push(dir);
    const store=new SettingsStore(path.resolve(process.cwd(),'../../config'),dir);await store.load();
    try {
      const run={id:'failed-primary',symbol:'BTCUSDT',role:'PRIMARY_BRAIN',startedAt:100,completedAt:200,status:'FAILED',triggerReason:'PERMISSION_CHANGED',failure:{errorCode:'AI_SCHEMA_INVALID'},inputPreview:'{}'};
      store.recordRuntimeEvent({id:'failure',type:'AI_RUN_FAILED',ts:200,symbol:'BTCUSDT',payload:run});
      const row=store.getDecisionEpisodeByRun(run.id);expect(row).not.toBeNull();
      expect(JSON.stringify(row)).toContain('PRIMARY_INFERENCE_RUN');expect(JSON.stringify(row)).toContain('PERMISSION_CHANGED');expect(JSON.stringify(row)).toContain('AI_SCHEMA_INVALID');
      expect(JSON.stringify(row)).toContain('marketOpportunityEpisodeId');
    } finally {store.close();}
  });
});

describe('D: a semantic no-op must not mint settings lineage',()=>{
  const configDir=()=>path.resolve(process.cwd(),'../../config');
  const auditCount=(store:unknown)=>((store as any).db.prepare('SELECT COUNT(*) n FROM settings_audit').get().n as number);
  const storedRow=(store:unknown)=>((store as any).db.prepare('SELECT version,payload FROM settings WHERE id=1').get() as {version:number,payload:string});
  it('saving the same decision set changes no version and writes no audit row, while a real change still does',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-settings-noop-'));paths.push(dir);
    const store=new SettingsStore(configDir(),dir);const initial=await store.load();
    try{
      const version=initial.settingsVersion,audits=auditCount(store);
      expect((await store.save(structuredClone(initial))).settingsVersion).toBe(version);
      expect(auditCount(store)).toBe(audits);
      // A stale client cannot mint versions by re-posting the same document with a bumped number.
      expect((await store.save({...structuredClone(initial),settingsVersion:version+99})).settingsVersion).toBe(version);
      expect(auditCount(store)).toBe(audits);
      expect(storedRow(store).version).toBe(version);
      const changed=await store.save({...structuredClone(initial),portfolio:{...initial.portfolio,maxPositions:12}});
      expect(changed.settingsVersion).toBe(version+1);
      expect(auditCount(store)).toBe(audits+1);
      expect(storedRow(store).version).toBe(version+1);
      const reopened=new SettingsStore(configDir(),dir);
      expect((await reopened.load()).portfolio.maxPositions).toBe(12);
      reopened.close();
    }finally{store.close();}
  });
  it('a reopen that migrates nothing adds no audit row, and a real migration still audits exactly once',async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),'zdj-settings-reopen-'));paths.push(dir);
    const boot=new SettingsStore(configDir(),dir);const base:any=await boot.load();
    const legacy:any=structuredClone(base);legacy.settingsVersion=177;legacy.takeProfit.minNetProfitUsd=.01;delete legacy.tradeEconomics;
    (boot as any).db.prepare('UPDATE settings SET version=?,payload=? WHERE id=1').run(177,JSON.stringify(legacy));boot.close();
    const migrated=new SettingsStore(configDir(),dir);const afterMigrate=await migrated.load();
    const auditsAtMigrate=auditCount(migrated);
    expect(afterMigrate.settingsVersion).toBe(177);expect(afterMigrate.takeProfit.minNetProfitUsd).toBe(1);expect(afterMigrate.tradeEconomics).toBeDefined();
    expect(JSON.parse(storedRow(migrated).payload).tradeEconomics).toBeDefined();
    migrated.close();
    const reopened=new SettingsStore(configDir(),dir);await reopened.load();
    expect(auditCount(reopened)).toBe(auditsAtMigrate);
    expect(storedRow(reopened).version).toBe(177);
    reopened.close();
  });
});

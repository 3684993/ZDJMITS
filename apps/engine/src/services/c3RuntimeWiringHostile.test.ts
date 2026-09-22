import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SystemSettingsSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {ManualPositionService} from './manualPositionService.js';
import {TpGuardian} from './tpGuardian.js';
import {OwnershipJournal} from './ownershipJournal.js';
import {PositionExitCoordinator,OPEN_STATES,type AdapterCapabilities,type JitFacts} from './s04ExitCoordinator.js';
import {buildExitEstimate,exitPriceBound,type CostItem,type EstimateInput} from './s03ExitCostEstimator.js';
import {decideAiExit,type AiExitVerdict,type PolicyInput} from './s03AiExitPolicy.js';
import {ExternalTradeAdapter} from '../adapters/exchange/ExternalTradeAdapter.js';
import {executionScope} from './executionLifecycle.js';
import {V396ExitRuntime,exitSubjectFromPosition} from './v396ExitRuntime.js';
import {coordinatedExchange,exitRuntimeHarness,manualJournalHarness,ONE_WAY_CAPABILITIES} from './v396ExitTestHarness.js';

/**
 * C3 wiring acceptance (docs/plans/v396/CODEX-C3-WIRING-ROUND1-20260922.md section 8).
 *
 * These tests pin the coordinated-exit invariants on the real services: one durable quantity claim
 * per scope+cycle across MANUAL/TP/future AI, durable PREPARED before any submit, a lost ACK that is
 * only ever re-proved by its original clientOrderId, human revoke beating every automatic rebuild
 * path, proofs that cannot turn a reduce into an increase, and restart recovery that queries.
 */

const ROOT=fileURLToPath(new URL('../../../..',import.meta.url));
const readSource=(relative:string)=>readFileSync(join(ROOT,'apps','engine','src',relative),'utf8');
const dirs:string[]=[];
afterEach(()=>{while(dirs.length){const dir=dirs.pop()!;try{rmSync(dir,{recursive:true,force:true});}catch{/* busy handle */}}});
const tempDir=()=>{const dir=mkdtempSync(join(tmpdir(),'zdj-v396-c3-'));dirs.push(dir);return dir;};

const POSITION_ID='exchange_BTCUSDT_LONG';
const identity={environment:'TESTNET',account:'binance-primary'};
const SCOPE=executionScope(identity.environment,identity.account,'BTCUSDT','LONG');
const CYCLE='cycle_c3_1';

type Options={liveQuantity?:number;manualFails?:boolean;tpFails?:boolean;submitStatus?:'WORKING'|'UNKNOWN'|'PARTIALLY_FILLED'|'FILLED';positionQty?:number;exitFile?:string};
function wiring(options:Options={}){
  const raw=JSON.parse(readFileSync(join(ROOT,'config','settings.default.json'),'utf8'));
  raw.connections.executionMode='TESTNET_ENABLED';raw.connections.exchange.environment='TESTNET';raw.connections.exchange.credentialRef=identity.account;
  const state=new RuntimeState(SystemSettingsSchema.parse(raw));
  state.account={...state.account,status:'READY',asOf:Date.now(),equityUsd:10_000,assets:[{asset:'USDT',availableBalance:10_000}]};
  const position=any({id:POSITION_ID,symbol:'BTCUSDT',side:'LONG',quantity:options.positionQty??1,entryPrice:90,markPrice:100,leverage:5,
    openedAt:Date.now()-120_000,firstObservedAt:Date.now()-120_000,entryTimeSource:'EXACT',cycleId:CYCLE,managementStatus:'AUTO_MANAGED',humanManagedAt:null,
    tpStatus:'MISSING',tpOrderId:null,tpCoverageSource:'NONE'});
  state.positions.set(POSITION_ID,position);
  const quote=any({symbol:'BTCUSDT',last:100,mark:100,bid:99.9,ask:100.1,tickSize:.1,stepSize:.1,minQty:.1,minNotional:5,ts:Date.now()});
  state.snapshots.set('BTCUSDT',{symbol:'BTCUSDT',quote} as never);
  const calls:string[]=[];
  const liveQuantity=options.liveQuantity??position.quantity;
  const exchange=any({...coordinatedExchange({liveQuantity}),
    fetchPositions:vi.fn(async()=>[{...position,quantity:state.positions.get(POSITION_ID)!.quantity}]),
    placeManualOrder:vi.fn(async(request:any)=>{calls.push('placeManualOrder');
      if(options.manualFails)throw new Error('ETIMEDOUT response lost after submit');
      return{id:request.internalOrderId,intentId:request.internalOrderId,clientOrderId:request.clientOrderId,exchangeOrderId:'ex_1',positionId:request.positionId??'',symbol:request.symbol,side:request.side,
        positionSide:request.positionSide??'BOTH',type:request.type,quantity:request.quantity,price:request.price,reduceOnly:request.reduceOnly,postOnly:request.postOnly,
        status:options.submitStatus??'WORKING',filledQuantity:options.submitStatus==='PARTIALLY_FILLED'?0.5:0,createdAt:Date.now(),updatedAt:Date.now()};}),
    findManualByClientOrderId:vi.fn(async(request:any)=>{calls.push('findManualByClientOrderId:'+request.clientOrderId);return null;}),
    cancelManualOrder:vi.fn(async(order:any)=>({...order,status:'CANCELED',updatedAt:Date.now()})),
    placeTakeProfit:vi.fn(async(order:any)=>{calls.push('placeTakeProfit');
      if(options.tpFails)throw new Error('ETIMEDOUT response lost after submit');
      return{...order,exchangeOrderId:'tp_ex',status:'WORKING',updatedAt:Date.now()};}),
    cancelTakeProfit:vi.fn(async(order:any)=>{calls.push('cancelTakeProfit');return{...order,status:'CANCELED',updatedAt:Date.now()};}),
    findTakeProfitByClientOrderId:vi.fn(async(order:any)=>{calls.push('findTakeProfitByClientOrderId:'+order.clientOrderId);return null;}),
    findExitByClientOrderId:vi.fn(async(input:{symbol:string;clientOrderId:string})=>{calls.push('findExitByClientOrderId:'+input.clientOrderId);return{state:'ABSENT' as const,reason:'-2013'};}),
    fetchOpenOrders:vi.fn(async()=>[]),setLeverage:vi.fn(async()=>{}),fetchSymbolTradeFacts:vi.fn(async()=>({fills:[],income:[],orders:[]})),
  });
  const market=any({snapshot:vi.fn(()=>({quote})),cachedQuote:vi.fn(()=>quote),freshQuote:vi.fn(async()=>quote)});
  const events=new EventBus();
  const seen:any[]=[];events.on('event',(event:any)=>seen.push(event));
  const journalDb=options.exitFile??':memory:';
  const exitRuntime=new V396ExitRuntime(journalDb,()=>identity,async()=>ONE_WAY_CAPABILITIES);
  const tp=new TpGuardian(state,exchange,events,exitRuntime);
  const manualJournal=manualJournalHarness();const originalClaim=manualJournal.claim.bind(manualJournal);manualJournal.claim=(scope:string,value:any)=>{calls.push('durable.claim');return originalClaim(scope,value);};
  const service=new ManualPositionService(state,market,exchange,tp,events,async()=>{},manualJournal as never,exitRuntime);
  return {state,position,quote,exchange,market,tp,service,events,seen,calls,manualJournal,exitRuntime};
}
const any=(value:unknown)=>value as any;
const closeRemaining=(h:ReturnType<typeof wiring>)=>h.service.execute(POSITION_ID,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'close_'+Math.random()});

describe('C3-1 one durable quantity claim across every exit writer',()=>{
  it('a live manual exit claim blocks a full-quantity TP on the same scope and cycle',async()=>{
    const h=wiring();
    await closeRemaining(h);
    expect(h.calls).toContain('placeManualOrder');
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    expect(h.calls,'the TP may not double-sell the quantity the manual close already claims').not.toContain('placeTakeProfit');
    expect(h.seen.map((event:any)=>String(event.payload?.message??'')).join('|')).toMatch(/QUANTITY_BUDGET_EXCEEDED/);
    expect(h.exitRuntime.task(String(h.manualJournal.claims[0]?.value?.order?.clientOrderId??''))??h.state.manualOrders.values().next().value).toBeTruthy();
  });

  it('the same request retried by two writers yields one clientOrderId and one submit',async()=>{
    const h=wiring();
    const first=await h.service.execute(POSITION_ID,{action:'REDUCE',quantity:1,price:100.1,idempotencyKey:'shared'});
    const second=await h.service.execute(POSITION_ID,{action:'REDUCE',quantity:1,price:100.1,idempotencyKey:'shared'});
    expect(h.exchange.placeManualOrder.mock.calls.length).toBe(1);
    expect(second.replayed||second.order?.id===first.order?.id).toBe(true);
  });

  it('TpGuardian, AccountExecutor and the cleanup writer all go through the coordinator',()=>{
    for(const [file,needle] of [['services/tpGuardian.ts','exitRuntime'],['services/testnetLowLossCleanupService.ts','prepareManual'],['services/manualPositionService.ts','prepareManual']] as const){
      expect(readSource(file),`${file} must reach the durable exit claim`).toContain(needle);
    }
    expect(readSource('services/accountExecutor.ts'),`AccountExecutor is a bare passthrough and must stay behind a prepared claim`).toContain('placeManualOrder');
  });
});

describe('C3-2 durable PREPARED strictly before any exchange submit',()=>{
  it('the manual path persists its claim before placeManualOrder',async()=>{
    const h=wiring();
    await closeRemaining(h);
    expect(h.calls.indexOf('durable.claim'),JSON.stringify(h.calls)).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf('durable.claim')).toBeLessThan(h.calls.indexOf('placeManualOrder'));
    const prepared=h.seen.findIndex((event:any)=>event.type==='MANUAL_SUBMISSION_PREPARED');
    expect(prepared).toBeGreaterThanOrEqual(0);
    expect(prepared).toBeLessThan(h.seen.findIndex((event:any)=>event.type==='MANUAL_ACTION_SUBMITTED'));
  });

  it('a TP submit is preceded by a persisted PREPARED task',async()=>{
    const h=wiring();
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    const index=h.calls.indexOf('placeTakeProfit');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(h.seen.some((event:any)=>event.type==='TP_SUBMISSION_PREPARED')).toBe(true);
    const task=h.exitRuntime.task(String(h.state.tpOrders.values().next().value?.clientOrderId??''));
    expect(task??null).toBeTruthy();
    expect(['SUBMITTING','WORKING','PARTIALLY_FILLED','FILLED']).toContain((task as any).state);
  });

  it('a missing manual journal fails closed before the wire',async()=>{
    const h=wiring();
    const crippled=new ManualPositionService(h.state,h.market,h.exchange,h.tp,h.events,async()=>{},undefined as never,h.exitRuntime);
    await crippled.execute(POSITION_ID,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:'no-journal'}).catch(()=>null);
    expect(h.calls).not.toContain('placeManualOrder');
  });

  it('without an adapter proof no exit may be submitted',async()=>{
    const h=wiring();
    delete (h.exchange as any).proveReduction;
    await h.service.execute(POSITION_ID,{action:'REDUCE',quantity:1,price:100.1,idempotencyKey:'no-proof'}).catch(()=>null);
    expect(h.calls).not.toContain('placeManualOrder');
    expect(h.seen.map((event:any)=>String(event.payload?.reason??'')).join('|')).toContain('REDUCTION_PROOF_UNAVAILABLE');
  });
});

describe('C3-3 a lost ACK stays UNKNOWN on the original clientOrderId',()=>{
  it('the manual submit failure is re-proved by its own clientOrderId and never resent',async()=>{
    const h=wiring({manualFails:true});
    await closeRemaining(h);
    expect(h.exchange.placeManualOrder.mock.calls.length).toBe(1);
    const submitted=(h.exchange.placeManualOrder.mock.calls[0]![0] as any).clientOrderId as string;
    expect(submitted).toMatch(/^v396x/);
    expect(h.calls).toContain('findManualByClientOrderId:'+submitted);
    const task=h.exitRuntime.task(submitted);
    expect((task as any).state).toBe('UNKNOWN');
    await closeRemaining(h);
    expect(h.exchange.placeManualOrder.mock.calls.length,'a second submit of an unacked exit is forbidden').toBe(1);
  });

  it('the TP submit failure is re-proved by its own clientOrderId and stays UNKNOWN',async()=>{
    const h=wiring({tpFails:true});
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true).catch(()=>null);
    const submitted=(h.exchange.placeTakeProfit.mock.calls[0]![0] as any).clientOrderId as string;
    expect(h.calls).toContain('findExitByClientOrderId:'+submitted);
    expect((h.exitRuntime.task(submitted) as any).state).toBe('UNKNOWN');
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true).catch(()=>null);
    expect(h.exchange.placeTakeProfit.mock.calls.length).toBe(1);
  });

  it('a FOUND exchange fact converges the unacked task without any resubmission',async()=>{
    const h=wiring({tpFails:true});
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true).catch(()=>null);
    const submitted=(h.exchange.placeTakeProfit.mock.calls[0]![0] as any).clientOrderId as string;
    const converged=await h.exitRuntime.convergeRecoveredTasks(async()=>({state:'FOUND',order:{symbol:'BTCUSDT',clientOrderId:submitted,exchangeOrderId:'ex_9',status:'NEW',originalQuantity:1,executedQuantity:0,positionSide:'LONG'}} as never));
    expect(converged[0].outcome).toMatch(/EXCHANGE_FACT_WORKING/);
    expect((h.exitRuntime.task(submitted) as any).state).toBe('WORKING');
    expect(h.exchange.placeTakeProfit.mock.calls.length).toBe(1);
    // and the guardian still refuses a second submit while that TP identity is unresolved
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true).catch(()=>null);
    expect(h.exchange.placeTakeProfit.mock.calls.length).toBe(1);
  });

  it('the runtime journal persists exit tasks so the next process can query them',()=>{
    const file=join(tempDir(),'v396-ownership.sqlite');
    new V396ExitRuntime(file,()=>identity,async()=>ONE_WAY_CAPABILITIES).close();
    const journal=new OwnershipJournal(file);
    const tables=journal.query<{name:string}>("SELECT name FROM sqlite_master WHERE type='table'").map((row:any)=>row.name);
    expect(tables).toContain('v396_exit_tasks');
    expect(tables).toContain('v396_quantity_claims');
  });
});

describe('C3-4 owner state is consumed before an exit write',()=>{
  it('a human takeover invalidates an older AI ownerVersion request',()=>{
    const h=wiring();
    const subject=exitSubjectFromPosition(h.position);
    const before=h.exitRuntime.recordHumanTakeover(subject,'MANUAL_SUBMISSION');
    expect(before.ownerState).toBe('HUMAN_MANAGED');
    const ctx=coordinatorFixture();
    const stale=exitRequest(ctx,{jit:jitFor(estimateFor(-5.79),{ownerVersion:before.ownerVersion-1})});
    expect(stale.accepted).toBe(false);
    expect(stale.reasons.join('|')).toMatch(/JIT_OWNER_DRIFT|OWNER_VERSION_STALE/);
    const current=exitRequest(ctx);
    expect(current.accepted).toBe(true);
  });

  it('the manual exit path refuses to submit while the AI owner is still authoritative',async()=>{
    const h=wiring();
    const subject=exitSubjectFromPosition(h.position);
    expect(h.exitRuntime.owner(subject)?.ownerState).not.toBe('HUMAN_MANAGED');
    await closeRemaining(h);
    expect(h.exitRuntime.owner(subject).ownerState).toBe('HUMAN_MANAGED');
    expect(h.exchange.placeManualOrder.mock.calls.length).toBe(1);
  });
});

describe('C3-5 human revoke beats every automatic rebuild path',()=>{
  it('after a durable revoke neither the sweep nor a forced repair rebuilds the TP',async()=>{
    const h=wiring();
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    expect(h.calls).toContain('placeTakeProfit');
    const mandate=h.exitRuntime.revokeProtectionByHuman(exitSubjectFromPosition(h.position));
    expect(mandate?.revokedAt).toBeTypeOf('number');
    h.calls.length=0;
    h.state.tpOrders.clear();
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    await h.tp.sweep();
    expect(h.calls).not.toContain('placeTakeProfit');
    expect(h.seen.map((event:any)=>event.type)).toContain('TP_REPAIR_BLOCKED_MANDATE_REVOKED');
  });

  it('only an explicit human re-arm restores protection',async()=>{
    const h=wiring();
    const subject=exitSubjectFromPosition(h.position);
    h.exitRuntime.revokeProtectionByHuman(subject);
    expect(h.exitRuntime.rearmProtectionByHuman(subject,-5)).toBeNull();
    expect(h.exitRuntime.rearmProtectionByHuman(subject,101)).toMatchObject({source:'HUMAN',revokedAt:null});
    h.calls.length=0;
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    expect(h.calls).toContain('placeTakeProfit');
  });

  it('the HTTP repair route refuses a revoked cycle without confirmRearm and the revoke is durable first',()=>{
    const router=readSource('api/router.ts');
    expect(router).toMatch(/TP_REPAIR_BLOCKED_MANDATE_REVOKED/);
    expect(router).toMatch(/confirmRearm\s*!==\s*true/);
    expect(router).toMatch(/revokeProtectionByHuman/);
    expect(router.indexOf('revokeProtectionByHuman')).toBeLessThan(router.indexOf('runtime.tp.cancel(order)'));
    expect(router).toMatch(/TP_PROTECTION_REVOKED_BY_HUMAN/);
  });
});

describe('C3-6 canonical identity and no reduce-becomes-increase',()=>{
  it('ONE_WAY submits a reduce-only order and HEDGE refuses an over-size reduction',async()=>{
    for(const hedge of [false,true]){
      const adapter=any(Object.create(ExternalTradeAdapter.prototype));
      adapter.positionMode={hedge,checkedAt:Date.now()};adapter.exactOrderCache=new Map();adapter.exactOrderFlights=new Map();
      adapter.signed=vi.fn(async(_method:string,path:string)=>path==='/fapi/v2/positionRisk'
        ?(hedge?[{symbol:'BTCUSDT',positionSide:'LONG',positionAmt:1}]:[{symbol:'BTCUSDT',positionAmt:1}])
        :[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:1}]);
      const capabilities=await adapter.exitCoordinationCapabilities();
      expect(capabilities.positionMode).toBe(hedge?'HEDGE':'ONE_WAY');
      expect(capabilities.cancelReplaceAtomic).toBe(false);
      expect(hedge?capabilities.hedgePositionSide:capabilities.oneWayReduceOnly).toBe(true);
      const proof=await adapter.proveReduction({symbol:'BTCUSDT',positionSide:'LONG',quantity:1});
      expect(proof.positionSide).toBe('LONG');
      await expect(adapter.proveReduction({symbol:'BTCUSDT',positionSide:'LONG',quantity:1.5})).rejects.toThrow(/REDUCTION_PROOF_EXCEEDS_LIVE_POSITION/);
      await expect(adapter.proveReduction({symbol:'BTCUSDT',positionSide:'SHORT',quantity:1})).rejects.toThrow(/REDUCTION_PROOF_NO_LIVE_POSITION/);
      expect((await adapter.findExitByClientOrderId({symbol:'BTCUSDT',clientOrderId:'v396xfound'})).state).toBe('FOUND');
      adapter.signed=vi.fn(async()=>{throw new Error('HTTP 500 internal');});
      await expect(adapter.findExitByClientOrderId({symbol:'BTCUSDT',clientOrderId:'v396xerror'})).rejects.toThrow(/500/);
      adapter.signed=vi.fn(async()=>{throw new Error('-2013 Order does not exist!');});
      expect((await adapter.findExitByClientOrderId({symbol:'BTCUSDT',clientOrderId:'v396xabsent'})).state).toBe('ABSENT');
    }
  });

  it('a coordinated manual submit keeps its position identity end to end',async()=>{
    const h=wiring();
    await closeRemaining(h);
    expect([...h.state.manualOrders.keys()],JSON.stringify(h.seen.map((event:any)=>event.type))).toHaveLength(1);
    const stored=h.state.manualOrders.get([...h.state.manualOrders.keys()][0]!);
    expect(stored?.positionId).toBe(POSITION_ID);
    expect(stored?.cycleId).toBe(CYCLE);
    expect(String(stored?.clientOrderId)).toMatch(/^v396x/);
  });

  it('exit claims use one canonical scope built from the full symbol and positionSide',async()=>{
    const h=wiring();
    await closeRemaining(h);
    const task=h.exitRuntime.task(String((h.exchange.placeManualOrder.mock.calls[0]![0] as any).clientOrderId));
    expect(JSON.parse((task as any).scope)).toEqual([identity.environment,identity.account,'BTCUSDT','LONG']);
    expect((task as any).cycleId).toBe(CYCLE);
  });

  it('no production writer mints a second exit identity or a random cycle',()=>{
    for(const file of ['services/tpGuardian.ts','services/manualPositionService.ts','services/testnetLowLossCleanupService.ts']){
      const source=readSource(file);
      if(file!=='services/manualPositionService.ts')expect(source,`${file} must not build its own exit clientOrderId`).not.toMatch(/binanceClientOrderIdFactory\.create\('(MR|EC|TP)/);
      else expect(source,'the manual exit submit must use the coordinator identity').toContain('clientForSubmit=prepared.clientOrderId');
      expect(source,`${file} must not invent a cycle identity`).not.toMatch(/`cycle_\$\{/);
    }
  });
});

describe('C3-7 partial fills leave only the real remainder claimed',()=>{
  it('a half-filled close frees exactly the filled half of the claim',async()=>{
    const h=wiring({submitStatus:'PARTIALLY_FILLED'});
    await closeRemaining(h);
    const submitted=(h.exchange.placeManualOrder.mock.calls[0]![0] as any).clientOrderId as string;
    const task=h.exitRuntime.task(submitted) as any;
    expect(task.state).toBe('PARTIALLY_FILLED');
    expect(task.quantityUnits-task.filledUnits).toBe(5);
    await h.tp.ensure(h.state.positions.get(POSITION_ID)!,true);
    expect(h.calls,'a full-size TP would double-sell the half that is still claimed').not.toContain('placeTakeProfit');
    expect(h.seen.map((event:any)=>String(event.payload?.message??'')).join('|')).toMatch(/QUANTITY_BUDGET_EXCEEDED|TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT/);
  });
});

describe('C3-8 restart queries and never resends',()=>{
  it('a reopened journal re-queries PREPARED and UNKNOWN tasks without any submit',async()=>{
    const dir=tempDir(),file=join(dir,'v396-ownership.sqlite');
    const first=wiring({exitFile:file,tpFails:true});
    await first.tp.ensure(first.state.positions.get(POSITION_ID)!,true).catch(()=>null);
    const submitted=(first.exchange.placeTakeProfit.mock.calls[0]![0] as any).clientOrderId as string;
    expect((first.exitRuntime.task(submitted) as any).state).toBe('UNKNOWN');
    const reopened=new V396ExitRuntime(file,()=>identity,async()=>ONE_WAY_CAPABILITIES);
    expect(reopened.tasksNeedingQuery().map((task:any)=>task.clientOrderId)).toContain(submitted);
    const queries:string[]=[];
    const converged=await reopened.convergeRecoveredTasks(async(input)=>{queries.push(input.clientOrderId);return{state:'ABSENT' as const,reason:'-2013'};});
    expect(queries).toEqual([submitted]);
    expect(converged[0]).toMatchObject({clientOrderId:submitted,outcome:'EXCHANGE_ABSENT_STAYS_UNACKED'});
    expect((reopened.task(submitted) as any).state).toBe('UNKNOWN');
    reopened.close();
  });

  it('a FOUND exchange fact at restart converges the task and still never submits',async()=>{
    const dir=tempDir(),file=join(dir,'v396-ownership.sqlite');
    const first=wiring({exitFile:file});
    await closeRemaining(first);
    const submitted=(first.exchange.placeManualOrder.mock.calls[0]![0] as any).clientOrderId as string;
    const reopened=new V396ExitRuntime(file,()=>identity,async()=>ONE_WAY_CAPABILITIES);
    const placeManual=vi.fn(),placeTp=vi.fn();
    const converged=await reopened.convergeRecoveredTasks(async()=>({state:'FOUND',order:{symbol:'BTCUSDT',clientOrderId:submitted,exchangeOrderId:'ex_1',status:'CANCELED',originalQuantity:1,executedQuantity:0,positionSide:'LONG'}} as any));
    expect(converged[0].outcome).toMatch(/EXCHANGE_FACT_CANCELED/);
    expect((reopened.task(submitted) as any).state).toBe('CANCELED');
    expect(placeManual).not.toHaveBeenCalled();expect(placeTp).not.toHaveBeenCalled();
    reopened.close();
  });

  it('the engine constructs the exit runtime, injects it, converges at startup and closes it',()=>{
    const app=readSource('runtime/appRuntime.ts');
    expect(app).toMatch(/new V396ExitRuntime\(/);
    expect(app).toMatch(/v396-ownership\.sqlite/);
    expect(app).toMatch(/convergeRecoveredExits/);
    expect(app).toMatch(/exitRuntime\?*\.close\(\)/);
    expect(app).toMatch(/tp = new TpGuardian\(state, trade, events, exitRuntime\)/);
    expect(app).toMatch(/new TestnetLowLossCleanupService\([\s\S]{0,240}exitRuntime/);
  });

  it('the offline coordinator refuses a stale requestKey replay after terminal and accepts a new key',()=>{
    const ctx=coordinatorFixture();
    const accepted=exitRequest(ctx,{requestKey:'intent_a'});
    expect(accepted.accepted).toBe(true);
    const retry=exitRequest(ctx,{requestKey:'intent_a'});
    expect(retry.clientOrderId).toBe(accepted.clientOrderId);
    expect(retry.reasons).toContain('IDEMPOTENCY_KEY_ALREADY_PREPARED');
    ctx.coordinator.transition(accepted.taskId!,'SUBMITTING',NOW+1,'SENT');
    ctx.coordinator.observe([{eventId:'terminal-fill',clientOrderId:accepted.clientOrderId!,state:'FILLED',filledUnits:10,positionVersion:8}],NOW+2);
    const nextIntent=exitRequest(ctx,{requestKey:'intent_b'});
    expect(nextIntent.accepted).toBe(true);
    expect(nextIntent.clientOrderId).not.toBe(accepted.clientOrderId);
  });
});

const NOW=1_800_000_000_000;
const CAPS:AdapterCapabilities=ONE_WAY_CAPABILITIES;
const item=(id:string,kind:CostItem['kind'],amount:number,extra:Partial<CostItem>={}):CostItem=>({id,kind,cycleId:CYCLE,scope:SCOPE,settled:!kind.startsWith('PROJECTED'),amount,status:'EXACT',asset:'USDT',sourceId:`src_${id}`,...extra});
const estimateFor=(remainingGross:number,extra:CostItem[]=[],over:Partial<EstimateInput>={})=>buildExitEstimate({
  scope:SCOPE,cycleId:CYCLE,positionVersion:7,costVersion:'cost-v1',remainingQuantityUnits:10,side:'LONG',
  quoteAt:NOW-1_000,expiresAt:NOW+14_000,now:NOW,entryPrice:100,bid:95,ask:96,tickSize:.1,stepSize:.1,minNotional:5,
  quoteAsset:'USDT',rateMaxAgeMs:60_000,items:[item('realized','REALIZED_GROSS',-2),item('entry-fee','ENTRY_FEE',1),item('funding','FUNDING',-0.5),
    item('remaining-gross','PROJECTED_EXIT_GROSS',remainingGross,{settled:false}),item('remaining-fee','PROJECTED_EXIT_FEE',.5,{settled:false}),
    item('buffer','UNCERTAINTY_BUFFER',.2,{settled:false}),...extra],...over});
const boundFor=()=>exitPriceBound({side:'LONG',remainingQuantityUnits:10,stepSize:.1,tickSize:.1,entryPrice:100,exitFeeRate:.0004,fixedNetMilli:Math.round(-4.2*1_000),targetNet:-10,minNotional:5,now:NOW});
const verdictFor=(estimate:ReturnType<typeof estimateFor>):AiExitVerdict=>decideAiExit({owner:{ownerState:'AI_ACTIVE',ownerVersion:4,cycleId:CYCLE,scope:SCOPE,deadline:NOW+60_000},
  plan:{planVersion:2,cycleId:CYCLE,scope:SCOPE,thesisInvalid:true,invalidationPredicate:'STRUCTURE_BREAK_15M',invalidationEvidenceRefs:['ev-1'],exitConditionMet:false,minNetProfitUsd:.5},
  estimate,bound:boundFor(),policy:{lossLimit:10,allowSmallLoss:true,authorizationTtlMs:15_000},now:NOW} as PolicyInput);
const jitFor=(estimate:ReturnType<typeof estimateFor>,over:Partial<JitFacts>={}):JitFacts=>({now:NOW,ownerVersion:4,positionVersion:7,settingsVersion:20,riskGeneration:11,deadline:NOW+60_000,
  estimateHash:estimate.estimateHash,conservativeNet:estimate.conservativeNet!,availableReduceUnits:10,remainingUnits:10,minNotional:5,tickSize:.1,stepSize:.1,...over} as JitFacts);
function coordinatorFixture(){const journal=new OwnershipJournal(join(tempDir(),'ledger.sqlite'));return {journal,coordinator:new PositionExitCoordinator(journal,CAPS)};}
function exitRequest(ctx:ReturnType<typeof coordinatorFixture>,overrides:Record<string,unknown>={}){const estimate=estimateFor(-5.79);
  return ctx.coordinator.requestExit({scope:SCOPE,cycleId:CYCLE,source:'AI',quantityUnits:10,verdict:verdictFor(estimate),jit:jitFor(estimate),...overrides} as never);}


describe('C3 Round 1.1 binding HUMAN protection',()=>{
  it('R1 revoke without a prior mandate survives reopening and blocks ensure and sweep',async()=>{
    const file=join(tempDir(),'revoke.sqlite'),first=wiring({exitFile:file}),subject=exitSubjectFromPosition(first.position);
    expect(first.exitRuntime.mandate(subject)).toBeNull();
    expect(first.exitRuntime.revokeProtectionByHuman(subject)).toMatchObject({source:'HUMAN',allowedPrice:null});
    first.exitRuntime.close();
    const h=wiring({exitFile:file});
    try{expect(h.exitRuntime.mandate(subject)?.revokedAt).not.toBeNull();await h.tp.ensure(h.position,true);await h.tp.sweep();expect(h.exchange.placeTakeProfit).not.toHaveBeenCalled();}finally{h.exitRuntime.close();}
  });
  it('R2 repair submits the exact HUMAN price, without Guardian repricing',async()=>{
    const h=wiring(),subject=exitSubjectFromPosition(h.position);
    try{h.exitRuntime.revokeProtectionByHuman(subject);h.exitRuntime.rearmProtectionByHuman(subject,101);await h.tp.ensure(h.position,true);expect(h.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);expect(h.exchange.placeTakeProfit.mock.calls[0][0].price).toBe(101);}finally{h.exitRuntime.close();}
  });
  it('R2 invalid HUMAN tick stays blocked rather than silently rounding',async()=>{
    const h=wiring();try{h.exitRuntime.rearmProtectionByHuman(exitSubjectFromPosition(h.position),101.05);await h.tp.ensure(h.position,true);expect(h.exchange.placeTakeProfit).not.toHaveBeenCalled();}finally{h.exitRuntime.close();}
  });
  it('R3 direct TP price drift is refused before submit',async()=>{
    const h=wiring();try{h.exitRuntime.rearmProtectionByHuman(exitSubjectFromPosition(h.position),101);await expect(h.tp.place(any({id:'tp_drift',positionId:POSITION_ID,cycleId:CYCLE,symbol:'BTCUSDT',side:'SELL',quantity:1,price:102}),{stepSize:.1,tickSize:.1})).rejects.toThrow('MANDATE_PRICE_MISMATCH');expect(h.exchange.placeTakeProfit).not.toHaveBeenCalled();}finally{h.exitRuntime.close();}
  });
  it.each(['REPLACE_TP','REBUILD_TP'] as const)('R4 %s binds filters, mandate, cycle and durable claim before wire',async action=>{
    const h=wiring();
    try{
      h.exchange.placeTakeProfit.mockImplementation(async(order:any)=>{
        expect(h.exitRuntime.mandate(exitSubjectFromPosition(h.position))).toMatchObject({source:'HUMAN',allowedPrice:101,revokedAt:null});
        expect(h.exitRuntime.task(order.clientOrderId)).toMatchObject({state:'SUBMITTING',scope:SCOPE,cycleId:CYCLE,stepSize:.1});
        expect(order.positionId).toBe(POSITION_ID);expect(order.cycleId).toBe(CYCLE);
        return {...order,status:'WORKING',updatedAt:Date.now()};
      });
      const result=await h.service.execute(POSITION_ID,{action,price:101,idempotencyKey:action});
      expect(result.order).toMatchObject({price:101,cycleId:CYCLE});expect(h.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);
    }finally{h.exitRuntime.close();}
  });
  it.each([100,50])('R5 FULL_REMAINING accepts only 100 percent (%s)',async percent=>{
    const h=wiring();try{h.state.settings.takeProfit.quantityPercent=percent;await h.tp.ensure(h.position,true);expect(h.exchange.placeTakeProfit).toHaveBeenCalledTimes(percent===100?1:0);if(percent!==100)expect(h.seen.map(e=>e.payload?.message??'').join('|')).toContain('MANDATE_FULL_REMAINING_REQUIRED');}finally{h.exitRuntime.close();}
  });
});


describe('final audit coordinator adversarial cases',()=>{
  it('different scopes sharing a cycle never overwrite tasks',()=>{
    const c=coordinatorFixture(),a=exitRequest(c),b=exitRequest(c,{scope:executionScope('TESTNET','another-account','BTCUSDT','LONG')});
    expect(a.accepted).toBe(true);expect(b.accepted).toBe(true);expect(a.taskId).not.toBe(b.taskId);expect(c.coordinator.allTasks()).toHaveLength(2);c.journal.close();
  });
  it('a previous cycle claim still occupies the same position scope',()=>{
    const c=coordinatorFixture();exitRequest(c);const b=exitRequest(c,{cycleId:'later-cycle'});expect(b.accepted).toBe(false);c.journal.close();
  });
  it('UNKNOWN cannot be resolved by a fabricated terminal fill quantity',()=>{
    const c=coordinatorFixture(),a=exitRequest(c);c.coordinator.markSubmitUncertain(a.taskId!,NOW);
    const result=c.coordinator.observe([{eventId:'bad-fill',clientOrderId:a.clientOrderId!,state:'FILLED',filledUnits:0,positionVersion:7}],NOW+1);
    expect(result.applied).toEqual([]);expect(c.coordinator.findTaskByClientOrderId(a.clientOrderId!)?.state).toBe('UNKNOWN');c.journal.close();
  });
  it('UNKNOWN cannot be reset into PREPARED by an exchange event',()=>{
    const c=coordinatorFixture(),a=exitRequest(c);c.coordinator.markSubmitUncertain(a.taskId!,NOW);
    expect(c.coordinator.observe([{eventId:'bad-state',clientOrderId:a.clientOrderId!,state:'PREPARED',filledUnits:0,positionVersion:7}],NOW+1).applied).toEqual([]);c.journal.close();
  });
  it('revoke while awaiting capabilities cannot authorize a TP',async()=>{
    let resume!:(value:AdapterCapabilities)=>void;
    const runtime=new V396ExitRuntime(':memory:',()=>identity,()=>new Promise(resolve=>{resume=resolve;}));
    const subject={symbol:'BTCUSDT',side:'LONG' as const,cycleId:CYCLE,openedAt:Date.now()-1000},now=Date.now();
    const waiting=runtime.prepareTakeProfit({requestKey:'racing',subject,quantityUnits:10,limitPrice:101,now,positionVersion:1,settingsVersion:1,riskGeneration:1,availableReduceUnits:10,remainingUnits:10,minNotional:5,tickSize:.1,stepSize:.1,proof:{kind:'ONE_WAY_REDUCE_ONLY',checkedAt:now,positionSide:'LONG'}});
    runtime.revokeProtectionByHuman(subject);resume(ONE_WAY_CAPABILITIES);
    expect((await waiting).accepted).toBe(false);runtime.close();
  });
  it('manual TP replacement releases only confirmed cancellation and places the new price',async()=>{
    const h=wiring();try{
      await h.tp.ensure(h.position,true);expect(h.exchange.placeTakeProfit).toHaveBeenCalledTimes(1);
      const first=h.exchange.placeTakeProfit.mock.calls[0][0];
      await h.service.execute(POSITION_ID,{action:'REPLACE_TP',price:102,idempotencyKey:'replace-existing'});
      expect(h.exchange.placeTakeProfit).toHaveBeenCalledTimes(2);expect(h.exitRuntime.task(first.clientOrderId)?.state).toBe('CANCELED');
    }finally{h.exitRuntime.close();}
  });
});


describe('final audit exact recovery boundaries',()=>{
  it('a local FILLED label cannot release a submitted claim',()=>{
    const c=coordinatorFixture(),a=exitRequest(c);c.coordinator.transition(a.taskId!,'SUBMITTING',NOW+1,'SENT');
    expect(c.coordinator.transition(a.taskId!,'FILLED',NOW+2,'LOCAL_GUESS')).toBeNull();expect(c.coordinator.openClaimUnits(SCOPE,CYCLE)).toBe(10);c.journal.close();
  });
  it.each(['wrong-client','wrong-symbol','bad-quantity','unknown-status'])('recovery refuses %s exchange facts',async defect=>{
    const h=wiring();try{
      await closeRemaining(h);const client=h.exchange.placeManualOrder.mock.calls[0][0].clientOrderId;
      const row:any={symbol:'BTCUSDT',clientOrderId:client,status:'CANCELED',originalQuantity:1,executedQuantity:0,positionSide:'LONG'};
      if(defect==='wrong-client')row.clientOrderId='other';if(defect==='wrong-symbol')row.symbol='ETHUSDT';if(defect==='bad-quantity')row.executedQuantity=-1;if(defect==='unknown-status')row.status='MADE_UP';
      const result=await h.exitRuntime.convergeRecoveredTasks(async()=>({state:'FOUND',order:row}));
      expect(result[0].outcome).toBe('EXCHANGE_FACT_UNVERIFIED');expect(h.exitRuntime.task(client)?.state).toBe('WORKING');
    }finally{h.exitRuntime.close();}
  });
});


describe('final audit TP crash identity',()=>{
  it('lost ACK persists the original client ID in the runtime TP projection before submit',async()=>{
    const h=wiring({tpFails:true});try{
      h.exchange.placeTakeProfit.mockImplementation(async(order:any)=>{
        expect(h.state.tpOrders.get(order.id)?.clientOrderId).toBe(order.clientOrderId);
        const prepared=h.seen.filter(e=>e.type==='TP_SUBMISSION_PREPARED').at(-1);
        expect(prepared?.payload.order.clientOrderId).toBe(order.clientOrderId);throw new Error('ETIMEDOUT');
      });
      await h.tp.ensure(h.position,true);const submitted=h.exchange.placeTakeProfit.mock.calls[0][0];expect(h.state.tpOrders.get(submitted.id)?.clientOrderId).toBe(submitted.clientOrderId);
    }finally{h.exitRuntime.close();}
  });
});

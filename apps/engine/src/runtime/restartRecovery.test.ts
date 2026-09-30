import { afterEach,describe,expect,it } from 'vitest';import { mkdtemp,rm } from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import { EngineRuntime } from './appRuntime.js';import type { EntryIntent,EntryOrder,Position,TakeProfitOrder } from '@zdj/contracts';
import { PositionService } from '../services/positionService.js';

it('persists recovered lot projections and their evidence before a second reopen',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-cycle-recovery-'));paths.push(dataDir);
  const configDir=path.resolve(process.cwd(),'../../config');
  const first=await EngineRuntime.createTestHarness({configDir,dataDir});
  const order={id:'entry_recovery',intentId:'intent_recovery',exchangeOrderId:'exchange_recovery',symbol:'BTCUSDT',side:'LONG',quantity:2,filledQuantity:2,price:100,leverage:10,status:'FILLED',createdAt:Date.now(),updatedAt:Date.now(),fills:[]} as EntryOrder;
  new PositionService(first.state,first.events).onEntryFilled(order);
  const record=[...first.state.tradeRecords.values()].find(r=>r.entryOrderIds.includes(order.id))!;
  const duplicate={...record,entryLots:[...record.entryLots!,{...record.entryLots![0],lotId:'fallback_alias'}]};
  first.state.tradeRecords.set(record.tradeId,duplicate);first.settingsStore.upsertTradeRecord(duplicate);first.stop();
  const second=await EngineRuntime.createTestHarness({configDir,dataDir});
  expect(second.state.tradeRecords.get(record.tradeId)?.entryLots).toHaveLength(1);
  expect(second.settingsStore.listTradeRecords().find(r=>r.tradeId===record.tradeId)?.entryLots).toHaveLength(1);
  expect(second.settingsStore.runtimeEvents(0,['CYCLE_ACCOUNTING_REBUILT_FROM_EXACT_IDENTITIES'])).toHaveLength(1);
  second.stop();
  const third=await EngineRuntime.createTestHarness({configDir,dataDir});
  expect(third.settingsStore.listTradeRecords().find(r=>r.tradeId===record.tradeId)?.entryLots).toHaveLength(1);
  expect(third.settingsStore.runtimeEvents(0,['CYCLE_ACCOUNTING_REBUILT_FROM_EXACT_IDENTITIES'])).toHaveLength(1);
  third.stop();
});
const paths:string[]=[];afterEach(async()=>Promise.all(paths.splice(0).map(x=>rm(x,{recursive:true,force:true}))));describe('runtime restart recovery',()=>{it('restores test-harness facts only through the explicit harness factory',async()=>{const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-restart-'));paths.push(dataDir);const configDir=path.resolve(process.cwd(),'../../config');const first=await EngineRuntime.createTestHarness({configDir,dataDir});const intent={id:'i'} as EntryIntent,entry={id:'e'} as EntryOrder,position={id:'p'} as Position,tp={id:'t'} as TakeProfitOrder;first.state.entryIntents.set('i',intent);first.state.entryOrders.set('e',entry);first.state.positions.set('p',position);first.state.tpOrders.set('t',tp);first.state.aiRuns=[{id:'a'} as any];first.state.tradeOutcomes=[{symbol:'BTCUSDT'} as any];first.state.account.availableUsd=4321;first.stop();const second=await EngineRuntime.createTestHarness({configDir,dataDir});expect(second.state.entryIntents.has('i')).toBe(true);expect(second.state.entryOrders.has('e')).toBe(true);expect(second.state.positions.has('p')).toBe(true);expect(second.state.tpOrders.has('t')).toBe(true);expect(second.state.aiRuns[0]?.id).toBe('a');expect(second.state.tradeOutcomes).toHaveLength(1);expect(second.state.account.availableUsd).toBe(4321);second.stop();});});

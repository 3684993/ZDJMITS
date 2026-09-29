import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import { afterEach,expect,it } from 'vitest';import { EngineRuntime } from '../runtime/appRuntime.js';import { dashboardProjection } from './projections.js';import {TradeRecordSchema} from '@zdj/contracts';

let runtime:EngineRuntime|null=null,dir='';
afterEach(async()=>{runtime?.stop();if(dir)await rm(dir,{recursive:true,force:true});});

/**
 * P2: the snapshot is published through DashboardSnapshotSchema, so a projected key that the contract
 * does not declare at that level never reaches the page. This test asserts the physical-cycle facts
 * survive the schema, not merely that the code builds them.
 */
it('publishes the position-cycle accounting facts through the snapshot schema',async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'mits-projection-cycle-'));
  runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir:dir});
  const base={symbol:'BTCUSDT',direction:'LONG' as const,openedAt:1,closedAt:2,durationMs:1,entryQty:2,exitQty:2,remainingQty:0,
    entryAveragePrice:100,exitAveragePrice:101,entryFee:.1,exitFee:.1,totalFee:.2,funding:null,entryGrossNotional:200,exitGrossNotional:202,
    marginUsed:null,netRoiOnMargin:null,netReturnOnNotional:null,entryFillCount:1,exitFillCount:1,feeBreakdown:[],grossRealizedPnl:2,netPnl:null,
    tradingNetPnlExFunding:1.8,fundingAttributionStatus:'UNKNOWN' as const,closeReason:'TP' as const,status:'CLOSED' as const,
    entryRunId:null,entryIntentId:'entry_one',entryOrderIds:['entry_one'],exitOrderIds:['tp_one'],source:'SYSTEM' as const,regime:null,
    feeCompleteness:'COMPLETE' as const,recordCompleteness:'COMPLETE' as const,classification:'COMPLETE' as const,canonical:true,duplicateOf:null,
    repairSource:null,linkedFillIds:['fill_one','fill_exit'],missingFacts:[],integrityFlags:[],createdAt:1,updatedAt:2,firstObservedAt:1};
  runtime.state.tradeRecords.set('rec_keyed',TradeRecordSchema.parse({...base,tradeId:'rec_keyed',cycleId:'pcycle_BTCUSDT_LONG_1',
    positionCycleId:'pcycle_BTCUSDT_LONG_1',lotAllocationMethod:'FIFO',entryLots:[{lotId:'lot_one',symbol:'BTCUSDT',side:'LONG',quantity:2,averagePrice:100}]}));
  runtime.state.tradeRecords.set('rec_legacy',TradeRecordSchema.parse({...base,tradeId:'rec_legacy',cycleId:'cycle_entry_intent_x',
    ledgerConservation:'LEDGER_INCONSISTENT',integrityFlags:['LEDGER_INCONSISTENT']}));
  const view=dashboardProjection(runtime);
  expect(view.positionCycleFacts).toMatchObject({records:2,lotsRecorded:1,ledgerInconsistent:1,unconserved:0});
  expect(view.positionCycleFacts!.lotAllocation).toMatchObject({FIFO:1,UNKNOWN:1});
});

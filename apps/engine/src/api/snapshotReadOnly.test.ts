import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import {TradeRecordSchema} from '@zdj/contracts';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {EngineRuntime} from '../runtime/appRuntime.js';
import {createApiRouter} from './router.js';
let runtime:EngineRuntime|null=null,server:any=null,dataDir:string|null=null;
it('TradeRecord GET list/detail and Experience perform zero SQLite writes and zero state mutation',async()=>{
 dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-trade-get-'));runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});
 const record=TradeRecordSchema.parse({tradeId:'get-fixture',symbol:'BTCUSDT',direction:'LONG',openedAt:1,closedAt:2,durationMs:1,entryQty:1,entryAveragePrice:100,exitAveragePrice:null,funding:null,grossRealizedPnl:null,netPnl:null,closeReason:'RECONCILIATION',status:'OPEN',entryRunId:null,entryIntentId:null,entryOrderIds:[],exitOrderIds:[],source:'SYSTEM',regime:null,createdAt:1,updatedAt:2,firstObservedAt:1});
 runtime.state.tradeRecords.set(record.tradeId,record);runtime.settingsStore.upsertTradeRecord(record);
 const db=(runtime.settingsStore as any).db;
 const app=express();app.use('/api/v3',createApiRouter(runtime));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const before=JSON.stringify([...runtime.state.tradeRecords]),changes=db.prepare('SELECT total_changes() n').get().n;
 for(const route of ['/trade-records','/trade-records?category=PARTIAL','/trade-records/get-fixture','/trade-records/missing','/experience'])await fetch(`http://127.0.0.1:${server.address().port}/api/v3${route}`);
 expect(db.prepare('SELECT total_changes() n').get().n).toBe(changes);expect(JSON.stringify([...runtime.state.tradeRecords])).toBe(before);
});
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));runtime?.stop();if(dataDir)await rm(dataDir,{recursive:true,force:true});server=null;runtime=null;dataDir=null;});
describe('published dashboard snapshot',()=>{
  it('serves a bounded immutable summary without reconciliation waits or SQLite writes',async()=>{dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-snapshot-'));runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});const wait=vi.spyOn(runtime.reconciliation,'whenSettled'),write=vi.spyOn(runtime.settingsStore,'upsertTradeRecord');const app=express();app.use('/api/v3',createApiRouter(runtime));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port,response=await fetch(`http://127.0.0.1:${port}/api/v3/snapshot`),body=await response.text();expect(response.status).toBe(200);expect(Buffer.byteLength(body)).toBeLessThan(150_000);expect(wait).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();expect(JSON.parse(body)).toMatchObject({snapshotVersion:1});});
});

it('position detail and stale manual preview perform zero market REST reads',async()=>{
 dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-position-get-'));runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});
 runtime.state.positions.set('p',{id:'p',symbol:'BTCUSDT',openedAt:Date.now(),side:'LONG',quantity:1,entryPrice:100,markPrice:100,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,tpStatus:'PENDING',tpOrderId:null,managementStatus:'AUTO_MANAGED'} as any);
 const candles=vi.spyOn(runtime.market,'candles').mockRejectedValue(new Error('REST forbidden')),quote=vi.spyOn(runtime.market,'freshQuote').mockRejectedValue(new Error('REST forbidden'));
 const app=express();app.use('/api/v3',createApiRouter(runtime));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/v3`,response=await fetch(base+'/positions/p');expect(response.status).toBe(200);expect((await response.json() as any).market.candles['1m']).toEqual([]);
 await fetch(base+'/positions/p/manual-preview');expect(candles).not.toHaveBeenCalled();expect(quote).not.toHaveBeenCalled();
});
it('reconciliation telemetry still persists execution facts',async()=>{
 dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-reconcile-event-'));runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});
 runtime.state.entryIntents.set('i',{id:'i'} as any);runtime.state.entryOrders.set('o',{id:'o',intentId:'i'} as any);
 runtime.state.manualIntents.set('m',{id:'m'} as any);runtime.state.manualOrders.set('mo',{id:'mo',intentId:'m'} as any);
 const entry=vi.spyOn(runtime.settingsStore,'saveEntryExecution').mockImplementation(()=>{}),manual=vi.spyOn(runtime.settingsStore,'saveManualExecution').mockImplementation(()=>{});
 runtime.events.publish('RECONCILIATION_COMPLETED',{});expect(entry).toHaveBeenCalled();expect(manual).toHaveBeenCalled();
});

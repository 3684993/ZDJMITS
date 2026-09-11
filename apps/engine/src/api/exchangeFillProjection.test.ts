import { afterEach,describe,expect,it } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { dashboardProjection } from './projections.js';

let runtime:EngineRuntime|null=null;
let dir='';
afterEach(async()=>{runtime?.stop();runtime=null;if(dir)await rm(dir,{recursive:true,force:true});dir='';});

describe('exchange fill projection',()=>{
  it('does not raise a system attribution alert for an external Binance App fill',async()=>{
    dir=await mkdtemp(path.join(os.tmpdir(),'mits-fill-projection-'));
    runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir:dir});
    runtime.state.executionFills=[{fillId:'external-1',symbol:'BTCUSDT',side:'SELL',direction:'LONG',positionSide:'LONG',orderId:'123',clientOrderId:'ios_external',tradeId:'trade-1',executionTime:Date.now(),qty:1,price:100,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:false,source:'EXCHANGE_AUDIT',attributionStatus:'EXTERNAL_OR_UNLINKED'}] as any;
    const facts=dashboardProjection(runtime).exchangeFillFacts!;
    expect(facts.externalFillsLast1h).toBe(1);
    expect(facts.unattributedFillsLast1h).toBe(1);
    expect(facts.systemFillAttributionGapLast1h).toBe(0);
    expect(facts.systemFillParityAlert).toBe(false);
  });
});

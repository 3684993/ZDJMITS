import { afterEach,describe,expect,it } from 'vitest';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let runtime:EngineRuntime|null=null;
let dir='';
afterEach(async()=>{runtime?.stop();runtime=null;if(dir)await rm(dir,{recursive:true,force:true});dir='';});

describe('resident EIP inspection',()=>{
  it('keeps a held contract available to read-only EIP inspection',async()=>{
    dir=await mkdtemp(path.join(os.tmpdir(),'zdj-eip-resident-'));
    runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir:dir});
    await runtime.market.refresh(120);
    runtime.universe.refresh();
    runtime.runtimeControl.evaluate(true);
    const candidate=runtime.state.universe.find(x=>x.symbol==='BTCUSDT')!;
    candidate.eligible=false;
    candidate.residentEligible=false;
    runtime.state.positions.set('held-btc',{symbol:'BTCUSDT'} as any);
    expect(runtime.eip.build('BTCUSDT').symbol).toBe('BTCUSDT');
  });
});

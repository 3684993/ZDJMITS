import { afterEach,describe,expect,it } from 'vitest';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { buildBrainPrompt } from '@zdj/core';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const runtimes:EngineRuntime[]=[],dirs:string[]=[];
async function ready(){const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-eip-'));dirs.push(dataDir);const runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});runtimes.push(runtime);await runtime.market.refresh(120);runtime.universe.refresh();runtime.runtimeControl.evaluate(true);return runtime;}
afterEach(async()=>{runtimes.splice(0).forEach(x=>x.stop());await Promise.all(dirs.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
describe('EIP 3.0 evidence gates',()=>{
  it('builds seven-timeframe evidence within a bounded prompt size',async()=>{const runtime=await ready();const packet=runtime.eip.build('BTCUSDT');expect(Object.keys(packet.market.technical)).toEqual(['1m','5m','15m','1h','4h','1d','1w']);expect((packet as any).evidenceDomains.required.technicalSixTimeframes).toBe('PRESENT');expect(packet.evidenceCompleteness).toBeGreaterThanOrEqual(runtime.state.settings.selection.minDataCompleteness);expect(buildBrainPrompt(packet,null).length).toBeLessThan(30_000);});
  it('fails closed for stale price but treats missing or stale derivatives as context',async()=>{const runtime=await ready(),symbol='BTCUSDT';const snapshot=runtime.state.snapshots.get(symbol)!;snapshot.quote.ts=Date.now()-16_000;expect(()=>runtime.eip.build(symbol)).toThrow('EIP_EVIDENCE_STALE');snapshot.quote.ts=Date.now();snapshot.derivatives.openInterest=null;snapshot.derivatives.ts=Date.now()-3_600_000;expect(()=>runtime.eip.build(symbol)).not.toThrow();});
});

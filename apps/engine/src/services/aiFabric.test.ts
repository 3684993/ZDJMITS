import { afterEach,describe,expect,it } from 'vitest';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { brainParse, entryDecisionParse, fifteenMinuteDirection, rawIntent } from './aiFabric.js';
import { parseSingleJsonDecision } from '../adapters/ai/OpenAiCompatibleClient.js';
import { mkdtemp,rm } from 'node:fs/promises';import os from 'node:os';import path from 'node:path';

const runtimes:EngineRuntime[]=[],dirs:string[]=[];
async function packet(){const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-ai-'));dirs.push(dataDir);const runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});runtimes.push(runtime);await runtime.market.refresh(20);runtime.universe.refresh();runtime.runtimeControl.evaluate(true);return runtime.eip.build('BTCUSDT');}
afterEach(async()=>{for(const runtime of runtimes.splice(0))runtime.stop();await Promise.all(dirs.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
const analysis=(p:any)=>({trend1m:p.market.technical['1m'].trend,trend5m:p.market.technical['5m'].trend,trend15m:p.market.technical['15m'].trend,trend4h:p.market.technical['4h'].trend,trend1d:p.market.technical['1d'].trend,trend1w:p.market.technical['1w'].trend,weightedConclusion:'15m authority'});
const base=(p:any)=>({action:'FINAL',confidence:.7,reachability:.8,directionAnalysis:analysis(p),entryInvalidation:'15m reversal',supportingEvidence:[],contradictions:[],missingEvidence:[],evidenceRefs:[],evidenceRequests:[],reason:'model intent'});

describe('Primary decision fail-closed normalization',()=>{
  it('fails closed on ambiguous multi-output and never selectively extracts a fenced decision',()=>{const raw='{"action":"FINAL","decision":"NO_DIRECTION_EDGE"}\n```json\n{"action":"FINAL","decision":"WAIT_FOR_PRICE"}\n```';expect(()=>parseSingleJsonDecision(raw)).toThrow('AI_OUTPUT_INVALID');expect(rawIntent(JSON.stringify({choices:[{message:{content:raw}}]}))).toBeNull();});
  it('keeps raw and normalized decisions on the same parsed source',()=>{const source={action:'FINAL',decision:'NO_DIRECTION_EDGE',direction:'SHORT'};const wrapped={choices:[{message:{content:JSON.stringify(source)}}],__zdjParsedDecision:source};expect(rawIntent(JSON.stringify(wrapped))).toStrictEqual(source);});
  it('normalizes a reject with structure direction but no executable side',async()=>{const p=await packet();const parsed=brainParse({...base(p),direction:'LONG',decision:'REJECT_CANDIDATE',idealPrice:123,acceptablePriceRange:{min:1,max:2},horizonMinutes:5},p);expect(parsed.direction).toBeNull();expect(parsed.tradeSide).toBeNull();expect(parsed.structureDirection).toBe(fifteenMinuteDirection(p));expect(parsed.decision).toBe('REJECT_CANDIDATE');expect(parsed.idealPrice).toBeNull();});
  it('repairs reject formatting without restoring a trade side',async()=>{const p=await packet();const parsed=brainParse({...base(p),direction:'LONG',decision:'REJECT_CANDIDATE',directionAnalysis:'15m long but timing poor',evidenceRequests:[{id:'invalid'}]},p);expect(parsed.direction).toBeNull();expect(parsed.tradeSide).toBeNull();expect(parsed.decision).toBe('REJECT_CANDIDATE');expect(parsed.directionAnalysis.trend15m).toContain('direction authority');expect(parsed.evidenceRequests).toEqual([]);});
  it.each([['PLACE_LONG','LONG'],['PLACE_SHORT','SHORT']] as const)('preserves raw %s',async(decision,direction)=>{const p=await packet();const parsed=brainParse({...base(p),direction,decision,idealPrice:p.market.quote.last,acceptablePriceRange:[p.microstructure.reachableBand1m[1],p.microstructure.reachableBand1m[0]],horizonMinutes:5},p);expect(parsed.decision).toBe(decision);expect(parsed.direction).toBe(direction);expect(parsed.acceptablePriceRange!.min).toBeLessThanOrEqual(parsed.acceptablePriceRange!.max);});
  it.each([85,'85%','0.85'])('normalizes only unambiguous confidence protocol values',async(confidence)=>{const p=await packet();const parsed=brainParse({...base(p),confidence,direction:'SHORT',decision:'PLACE_SHORT',idealPrice:p.market.quote.last,acceptablePriceRange:{min:p.microstructure.reachableBand1m[0],max:p.microstructure.reachableBand1m[1]},horizonMinutes:5},p);expect(parsed.confidence).toBe(.85);});
  it('does not manufacture a missing executable price range',async()=>{const p=await packet();expect(()=>brainParse({...base(p),direction:'SHORT',decision:'PLACE_SHORT',idealPrice:p.market.quote.last,acceptablePriceRange:null,horizonMinutes:5},p)).toThrow();});
  it('accepts a directionless reject without inventing PLACE',async()=>{const p=await packet();const reject=brainParse({...base(p),decision:'REJECT_CANDIDATE',idealPrice:null,acceptablePriceRange:null,horizonMinutes:null},p);expect(reject.tradeSide).toBeNull();expect(reject.direction).toBeNull();expect(()=>brainParse('not-json',p)).toThrow();});
  it('computes 15m direction without creating an execution decision',async()=>{const p=await packet();expect(['LONG','SHORT']).toContain(fifteenMinuteDirection(p));});
  it('rejects every counter-direction PLACE in a 300-fixture direction/timing/permission matrix',async()=>{
    const source=await packet();let accepted=0,blockedViolations=0;
    for(let i=0;i<300;i++){
      const p=structuredClone(source) as any,phase=i%3,trend=phase===0?'UP':phase===1?'DOWN':'RANGE',direction=trend==='DOWN'?'SHORT':'LONG';
      p.market.technical['15m'].trend=trend;p.market.technical['15m'].isClosed=true;p.market.technical['15m'].asOf=p.createdAt-1;
      p.portfolioIntelligence.allowedDirections=['LONG','SHORT'];
      const place=trend!=='RANGE'&&i%2===0,decision=trend==='RANGE'?'NO_DIRECTION_EDGE':place?`PLACE_${direction}`:'WAIT_FOR_PRICE';
      const q=p.market.quote.mark,valid={action:'FINAL',decision,direction,confidence:.7,idealPrice:place?q:null,acceptablePriceRange:place?{min:q*.999,max:q*1.001}:null,horizonMinutes:place?3:null,waitCondition:decision==='WAIT_FOR_PRICE'?{operator:direction==='LONG'?'LTE':'GTE',price:q,validForMinutes:3}:null,directionReason:`confirmed 15m ${trend}`,timingReason:'bounded live-price timing with a material counterpoint',reason:'facts and permissions agree',entryInvalidation:'confirmed 15m direction changes',longException:false,longExceptionReason:null,altLongQuality:null,supportingEvidenceRefs:['technical.15m.confirmed','permissions.direction']};
      expect(entryDecisionParse(valid,p).decision).toBe(decision);accepted++;
      if(trend!=='RANGE'){
        const wrongDirection=direction==='LONG'?'SHORT':'LONG',invalid={...valid,decision:`PLACE_${wrongDirection}`,direction:wrongDirection,idealPrice:q,acceptablePriceRange:{min:q*.999,max:q*1.001},horizonMinutes:3,waitCondition:null};
        expect(()=>entryDecisionParse(invalid,p)).toThrow(/15m direction/);blockedViolations++;
      }
    }
    expect({accepted,blockedViolations}).toEqual({accepted:300,blockedViolations:200});
  });
});

import { afterEach,describe,expect,it } from 'vitest';
import { EngineRuntime } from '../runtime/appRuntime.js';
import { brainParse, entryDecisionParse, fifteenMinuteDirection, rawIntent } from './aiFabric.js';
import { parseSingleJsonDecision } from '../adapters/ai/OpenAiCompatibleClient.js';
import { mkdtemp,rm } from 'node:fs/promises';import os from 'node:os';import path from 'node:path';

const runtimes:EngineRuntime[]=[],dirs:string[]=[];
async function packet(){const dataDir=await mkdtemp(path.join(os.tmpdir(),'zdj-ai-'));dirs.push(dataDir);const runtime=await EngineRuntime.createTestHarness({configDir:'../../config',dataDir});runtimes.push(runtime);await runtime.market.refresh(20);runtime.universe.refresh();runtime.runtimeControl.evaluate(true);return runtime.eip.build('BTCUSDT');}
afterEach(async()=>{for(const runtime of runtimes.splice(0))runtime.stop();await Promise.all(dirs.splice(0).map(x=>rm(x,{recursive:true,force:true})));});
const analysis=(p:any)=>({trend1m:p.market.technical['1m'].trend,trend5m:p.market.technical['5m'].trend,trend15m:p.market.technical['15m'].trend,trend4h:p.market.technical['4h'].trend,trend1d:p.market.technical['1d'].trend,trend1w:p.market.technical['1w'].trend,weightedConclusion:'market evidence only'});
const base=(p:any)=>({action:'FINAL',schemaVersion:'V3.9.3',confidence:.7,reachability:.8,directionAnalysis:analysis(p),entryInvalidation:'authorization expires or market facts change',supportingEvidence:[],contradictions:[],missingEvidence:[],evidenceRefs:[],evidenceRequests:[],reason:'model intent'});
const placeFields=(p:any)=>{const q=p.market.quote.last;return{quantityUnits:Math.max(1,Math.ceil(Math.max(p.market.quote.minQty,p.market.quote.minNotional/q)/p.market.quote.stepSize)),idealPrice:q,acceptablePriceRange:{min:q*.999,max:q*1.001},horizonMinutes:5,profitTakePlan:{targetPrice:q*1.003,acceptableTargetRange:{min:q*1.002,max:q*1.004},targetHorizonMinutes:15,targetReason:'positive net target',evidenceRefs:['technical.15m.confirmed']}}};

describe('Primary decision fail-closed normalization',()=>{
  it('fails closed on ambiguous multi-output and never selectively extracts a fenced decision',()=>{const raw='{"action":"FINAL","decision":"NO_DIRECTION_EDGE"}\n```json\n{"action":"FINAL","decision":"WAIT_FOR_PRICE"}\n```';expect(()=>parseSingleJsonDecision(raw)).toThrow('AI_OUTPUT_INVALID');expect(rawIntent(JSON.stringify({choices:[{message:{content:raw}}]}))).toBeNull();});
  it('keeps raw and normalized decisions on the same parsed source',()=>{const source={action:'FINAL',decision:'NO_DIRECTION_EDGE',direction:'SHORT'};const wrapped={choices:[{message:{content:JSON.stringify(source)}}],__zdjParsedDecision:source};expect(rawIntent(JSON.stringify(wrapped))).toStrictEqual(source);});
  it('normalizes a reject without inventing an executable side',async()=>{const p=await packet();const parsed=brainParse({...base(p),direction:'LONG',decision:'REJECT_CANDIDATE',idealPrice:123,acceptablePriceRange:{min:1,max:2},horizonMinutes:5},p);expect(parsed.direction).toBeNull();expect(parsed.tradeSide).toBeNull();expect(parsed.structureDirection).toBeNull();expect(parsed.decision).toBe('REJECT_CANDIDATE');expect(parsed.idealPrice).toBeNull();});
  it('repairs reject formatting without restoring a trade side or direction authority',async()=>{const p=await packet();const parsed=brainParse({...base(p),direction:'LONG',decision:'REJECT_CANDIDATE',directionAnalysis:'DOWN; evidence only',evidenceRequests:[{id:'invalid'}]},p);expect(parsed.direction).toBeNull();expect(parsed.tradeSide).toBeNull();expect(parsed.decision).toBe('REJECT_CANDIDATE');expect(parsed.directionAnalysis.weightedConclusion).not.toContain('authority');expect(parsed.evidenceRequests).toEqual([]);});
  it.each([['PLACE_LONG','LONG'],['PLACE_SHORT','SHORT']] as const)('preserves raw %s including autonomous quantity',async(decision,direction)=>{const p=await packet();const parsed=brainParse({...base(p),direction,decision,...placeFields(p)},p);expect(parsed.decision).toBe(decision);expect(parsed.direction).toBe(direction);expect(parsed.quantityUnits).toBeGreaterThan(0);expect(parsed.acceptablePriceRange!.min).toBeLessThanOrEqual(parsed.acceptablePriceRange!.max);});
  it.each([85,'85%','0.85'])('normalizes only unambiguous confidence protocol values',async(confidence)=>{const p=await packet();const parsed=brainParse({...base(p),confidence,direction:'SHORT',decision:'PLACE_SHORT',...placeFields(p)},p);expect(parsed.confidence).toBe(.85);});
  it('does not manufacture a missing executable price range',async()=>{const p=await packet();expect(()=>brainParse({...base(p),direction:'SHORT',decision:'PLACE_SHORT',...placeFields(p),acceptablePriceRange:null},p)).toThrow();});
  it('repairs only a frozen candidate target range after the model selects its exact target',async()=>{
    const p=await packet() as any,q=p.market.quote.last,target=q*1.003;
    p.executionEnvelope={LONG:{planCandidates:[{candidateId:'frozen-one',targetPrice:target,targetHorizonMinutes:15,acceptableTargetRange:{min:q*1.002,max:q*1.004}}]}};
    const raw={action:'FINAL',schemaVersion:'V3.9.7',decision:'PLACE_LONG',tradeSide:'LONG',structureDirection:'LONG',selectedCandidateId:'frozen-one',quantityUnits:null,opportunityType:'TREND_RESUMPTION',marketRegime:'TREND',confidence:.7,idealPrice:q,acceptablePriceRange:{min:q*.999,max:q*1.001},horizonMinutes:5,waitCondition:null,directionReason:'market trend',timingReason:'bounded timing',entryLocationReason:'maker location',reason:'selected exact candidate',entryInvalidation:'authorization expires',supportingEvidenceRefs:[],profitTakePlan:{targetPrice:target,acceptableTargetRange:{min:q*1.004,max:q*1.005},targetHorizonMinutes:15,targetReason:'net positive',evidenceRefs:[]},rejectLayer:'NONE',blockingCondition:'',releaseCondition:'',timingEvent:null};
    const parsed=entryDecisionParse(raw,p);
    expect(parsed.profitTakePlan?.acceptableTargetRange).toEqual({min:q*1.002,max:q*1.004});
    expect((parsed as any).__protocolNormalization.fields.map((field:any)=>field.rule)).toContain('FROZEN_CANDIDATE_TARGET_RANGE');
    expect(()=>entryDecisionParse({...raw,profitTakePlan:{...raw.profitTakePlan,targetPrice:target*2}},p)).toThrow();
  });
  it('accepts a directionless reject without inventing PLACE',async()=>{const p=await packet();const reject=brainParse({...base(p),decision:'REJECT_CANDIDATE',idealPrice:null,acceptablePriceRange:null,horizonMinutes:null},p);expect(reject.tradeSide).toBeNull();expect(reject.direction).toBeNull();expect(()=>brainParse('not-json',p)).toThrow();});
  it('computes 15m structure evidence without creating an execution decision',async()=>{const p=await packet();expect(['LONG','SHORT']).toContain(fifteenMinuteDirection(p));});
  it('accepts both AI sides regardless of 15m trend when protocol fields are valid',async()=>{
    const source=await packet();let checked=0;
    for(const trend of ['UP','DOWN'] as const){
      const p=structuredClone(source) as any;p.market.technical['15m'].trend=trend;p.market.technical['15m'].isClosed=true;p.market.technical['15m'].asOf=p.createdAt-1;
      for(const direction of ['LONG','SHORT'] as const){const valid={action:'FINAL' as const,schemaVersion:'V3.9.3' as const,decision:`PLACE_${direction}` as const,direction,tradeSide:direction,structureDirection:direction,...placeFields(p),confidence:.7,directionReason:`AI selected ${direction} from market facts`,timingReason:'bounded maker timing',entryLocationReason:'reachable maker range',opportunityType:'TREND_RESUMPTION' as const,marketRegime:'TREND' as const,waitCondition:null,reason:'model intent',entryInvalidation:'authorization expires or market facts change',longException:false,longExceptionReason:null,altLongQuality:null,supportingEvidenceRefs:['technical.15m.confirmed'],rejectLayer:'NONE' as const,blockingCondition:'',releaseCondition:'',timingEvent:null};const parsed=entryDecisionParse(valid,p);expect(parsed.tradeSide).toBe(direction);expect(parsed.decision).toBe(`PLACE_${direction}`);checked++;}
    }
    expect(checked).toBe(4);
  });
});

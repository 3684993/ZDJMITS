import {afterEach,expect,it,vi} from 'vitest';
import {ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,EntryDecisionFactBoundJsonSchema} from '@zdj/contracts';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';
import {harness} from './tradingQualityTestHarness.js';
import {now,referenceFixture} from '../testing/candidateReferenceFixture.js';
import {factBoundWire} from '../testing/factBoundReferenceFixture.js';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('sends bounded native R2 JSON, freezes its menu and archives the engine resolution separately from raw model output',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(now+1);
  const h=harness(),{packet:offered,wire:legacyWire}=referenceFixture(),packet={...h.packet,packetId:offered.packetId,
    symbol:offered.symbol,createdAt:now,executionEnvelope:offered.executionEnvelope};
  const wire=factBoundWire(packet,legacyWire);
  h.state.settings.aiResources=h.state.settings.aiResources.map(resource=>resource.role==='PRIMARY_BRAIN'
    ?{...resource,baseUrl:'http://127.0.0.1:1234/v1',model:'qwen/qwen3.8-27b',enabled:true}:resource);
  h.state.aiResources=loadAiResources(h.state.settings);
  const ai=new AiFabric(h.state,h.bus,{} as never),original=structuredClone(packet.executionEnvelope!.LONG.planCandidates![0]);
  const calls:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:any,init:any)=>{
    if(String(input).endsWith('/props'))return new Response('{}',{status:200});
    if(!String(input).endsWith('/chat/completions'))throw new Error('NETWORK_FORBIDDEN');
    calls.push(JSON.parse(init.body));
    packet.executionEnvelope!.LONG.planCandidates![0].targetPrice=999; // Caller mutation while request is in flight.
    packet.market.technical['1d'].macdHistogram=-123;
    packet.market.technical['1d'].trend='DOWN';
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}],
      usage:{prompt_tokens:100,completion_tokens:50,completion_tokens_details:{reasoning_tokens:0}}}),{status:200});
  }));
  const result=await ai.decide(packet);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({reasoning_effort:'none',max_tokens:900,stream:false,
    response_format:{type:'json_schema',json_schema:{name:'EntryDecisionV392',strict:true,schema:EntryDecisionFactBoundJsonSchema}}});
  expect(calls[0].messages[0].content).toContain('schemaVersion=V3.9.7-R2');
  expect(result.decision.profitTakePlan!.targetPrice).toBe(original.targetPrice);
  expect(result.decision.directionResolution?.facts.trend1dRole).toBe('SUPPORTS_LONG');
  expect(result.decision.directionResolution?.factChecks).toContainEqual({factId:'technical.1d.confirmed',field:'macdHistogram',value:'POSITIVE'});
  expect(result.decision.candidateReferenceResolution).toMatchObject({packetId:offered.packetId,targetPrice:original.targetPrice});
  const run=h.state.aiRuns.find(row=>row.id===result.runId)!;
  expect(run.outputContractVersion).toBe(ENTRY_FACT_BOUND_REFERENCE_PROTOCOL);
  expect(run).toMatchObject({settingsVersion:h.state.settings.settingsVersion,scoutMode:'DIRECT',rawDirection:'LONG',rawDecision:'PLACE_LONG',parserRepaired:false});
  expect(JSON.parse(run.inputPreview!).packet.executionEnvelope.LONG.planCandidates[0].targetPrice).toBe(original.targetPrice);
  expect(JSON.parse(run.normalizedPreview!).candidateReferenceResolution.source).toBe('SYSTEM_FROZEN_CANDIDATE');
  const raw=JSON.parse(run.outputPreview!).__zdjParsedDecision;
  expect(raw).toEqual(wire);expect(raw).not.toHaveProperty('profitTakePlan');expect(raw).not.toHaveProperty('quantityUnits');
  expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
});

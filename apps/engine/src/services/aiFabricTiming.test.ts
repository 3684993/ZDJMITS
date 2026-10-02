import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AiRunSchema} from '@zdj/contracts';
import {AiFabric} from './aiFabric.js';
import {loadAiResources} from '../config/aiResourceLoader.js';
import {harness} from './tradingQualityTestHarness.js';
import {now,referenceFixture} from '../testing/candidateReferenceFixture.js';
import {factBoundWire} from '../testing/factBoundReferenceFixture.js';

function fixture(){
  const h=harness(),offered=referenceFixture();
  h.state.settings.ai.scoutEnabled=true;h.state.settings.ai.decisionTimeoutMs=180_000;
  h.state.settings.aiResources=h.state.settings.aiResources.map(resource=>({...resource,enabled:true,
    baseUrl:resource.role==='PRIMARY_BRAIN'?'http://127.0.0.1:1234/v1':'http://independent.invalid/v1',
    model:resource.role==='PRIMARY_BRAIN'?'qwen/qwen3.8-27b':resource.model}));
  h.state.aiResources=loadAiResources(h.state.settings);
  const packet={...h.packet,packetId:offered.packet.packetId,symbol:offered.packet.symbol,createdAt:now,
    executionEnvelope:offered.packet.executionEnvelope};
  return{...h,packet,wire:factBoundWire(packet,offered.wire),fabric:new AiFabric(h.state,h.bus,{} as never)};
}
function mockFetch(completion:(init:RequestInit)=>Promise<Response>|Response){
  const requests:RequestInit[]=[];
  const fetch=vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
    if(String(url).endsWith('/props'))return Promise.resolve(new Response('{}'));
    if(!String(url).endsWith('/chat/completions'))throw new Error('NETWORK_FORBIDDEN');
    requests.push(init!);return Promise.resolve(completion(init!));
  });
  vi.stubGlobal('fetch',fetch);return{fetch,requests};
}
const envelope=(wire:unknown)=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}],usage:{prompt_tokens:200,completion_tokens:100}});
const annotation={symbol:'TESTUSDT',summary:'Observation only',keyEvidence:[],contradictions:[],missingEvidence:[],attentionScore:.5};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('AI run lifecycle audit',()=>{
  it('archives the caller request id and measured preparation separately from transport and preserves R2 output',async()=>{
    const h=fixture(),controller=new AbortController(),context={signal:controller.signal,requestId:'entry-context-1',
      preRequestTiming:{slotWaitMs:11,scoutMs:12,prepareMs:13}};
    let startedAudit:any;h.bus.on('AI_RUN_STARTED',event=>{startedAudit=structuredClone(event.payload);});
    const transport=mockFetch(async()=>{
      await new Promise(resolve=>setTimeout(resolve,5));
      return new Response(new ReadableStream({start(stream){setTimeout(()=>{stream.enqueue(new TextEncoder().encode(envelope(h.wire)));stream.close();},15);}}));
    });
    const pending=h.fabric.decide(h.packet,null,36,undefined,context);await vi.advanceTimersByTimeAsync(20);const result=await pending;
    expect(startedAudit).toMatchObject({requestContextId:'entry-context-1',timing:{slotWaitMs:11,scoutMs:12,prepareMs:13,
      requestMs:null,responseHeadersMs:null,responseBodyMs:null,parseMs:null}});
    expect(h.state.aiRuns[0]).toMatchObject({requestContextId:'entry-context-1',status:'COMPLETED',outputContractVersion:'V3.9.7-R2',
      inputTokens:200,outputTokens:100,timing:{queueMs:36,slotWaitMs:11,scoutMs:12,prepareMs:13,promptBuildMs:0,
        requestMs:20,responseHeadersMs:5,responseBodyMs:15,parseMs:0,retryMs:0,transportAttempts:1,totalMs:20,
        clientElapsedMs:20,firstTokenMs:null,serverQueueMs:null,prefillMs:null,decodeMs:null}});
    expect(result.decision.candidateReferenceResolution?.source).toBe('SYSTEM_FROZEN_CANDIDATE');
    expect(JSON.parse(String(transport.requests[0]?.body))).toMatchObject({reasoning_effort:'none',max_tokens:900,
      response_format:{type:'json_schema',json_schema:{name:'EntryDecisionV392',strict:true}}});
    expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
    expect(AiRunSchema.parse(h.state.aiRuns[0]).timing).toEqual(h.state.aiRuns[0]!.timing);
  });

  it.each(['CALLER','DEADLINE'] as const)('persists a partial-body %s failure with real timing and unknown backend cancellation state',async source=>{
    const h=fixture(),controller=new AbortController(),cancelled=vi.fn();
    mockFetch(()=>new Response(new ReadableStream({cancel:cancelled})));
    const pending=h.fabric.decide(h.packet,null,0,undefined,{signal:controller.signal,requestId:'entry-body',
      deadlineAt:now+60,preRequestTiming:{slotWaitMs:4,prepareMs:7}}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(40);if(source==='CALLER')controller.abort();else await vi.advanceTimersByTimeAsync(20);
    const error=await pending,elapsed=source==='CALLER'?40:60;
    expect(error).toMatchObject({errorCode:source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT',runId:h.state.aiRuns[0]!.id});
    expect(h.state.aiRuns[0]).toMatchObject({status:'FAILED',inputTokens:null,outputTokens:null,
      timing:{slotWaitMs:4,scoutMs:null,prepareMs:7,requestMs:elapsed,responseHeadersMs:0,responseBodyMs:elapsed,
        parseMs:null,retryMs:0,totalMs:elapsed,clientElapsedMs:elapsed,firstTokenMs:null,prefillMs:null,decodeMs:null},
      failure:{failureStage:'RESPONSE_BODY',errorCode:source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT',
        timeout:source==='DEADLINE',cancelled:source==='CALLER',schemaValidation:false,retryCount:0,
        cancellation:{source,requestedAt:now+elapsed,backendStatus:'UNKNOWN'}}});
    expect(cancelled).toHaveBeenCalledOnce();expect(h.fabric.circuitStatus().failureStreak).toBe(source==='CALLER'?0:1);
    expect(h.fabric.hasCapacity('PRIMARY_BRAIN')).toBe(true);expect(h.events.some(event=>event.type==='AI_RUN_COMPLETED')).toBe(false);
    expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
    expect(AiRunSchema.parse(h.state.aiRuns[0]).failure?.cancellation?.backendStatus).toBe('UNKNOWN');
  });

  it('records actual token usage for schema failure without reclassifying transport or inventing retries',async()=>{
    const h=fixture();mockFetch(()=>new Response(envelope({...h.wire,horizonMinutes:6})));
    await expect(h.fabric.decide(h.packet)).rejects.toMatchObject({stage:'PARSE',errorCode:'AI_SCHEMA_INVALID'});
    expect(h.state.aiRuns[0]).toMatchObject({inputTokens:200,outputTokens:100,timing:{requestMs:0,parseMs:0,transportAttempts:1},
      failure:{failureStage:'SCHEMA_VALIDATION',errorCode:'AI_SCHEMA_INVALID',schemaValidation:true,timeout:false,cancelled:false,retryCount:0}});
    expect(h.fabric.circuitStatus().failureStreak).toBe(0);
  });

  it('leaves unreported timing and retry count unknown for failures outside the transport',async()=>{
    const h=fixture();vi.spyOn((h.fabric as any).openAi,'runJson').mockRejectedValue(new Error('local adapter failed'));
    await expect(h.fabric.decide(h.packet)).rejects.toThrow('local adapter failed');
    expect(h.state.aiRuns[0]).toMatchObject({timing:{requestMs:null,responseHeadersMs:null,responseBodyMs:null,parseMs:null,
      retryMs:null,clientElapsedMs:null,totalMs:0},failure:{schemaValidation:false,timeout:false,retryCount:null}});
  });

  it('refuses a late adapter result even when that adapter ignored the caller signal',async()=>{
    const h=fixture(),controller=new AbortController();
    vi.spyOn((h.fabric as any).openAi,'runJson').mockImplementation(async(args:any)=>{
      controller.abort();return{value:args.parse(h.wire),raw:{__zdjParsedDecision:h.wire},inputTokens:200,outputTokens:100,
        finishReason:'stop',modelIdentity:null,timing:{requestMs:10,parseMs:0,retryMs:0,transportAttempts:1}};
    });
    await expect(h.fabric.decide(h.packet,null,0,undefined,{signal:controller.signal})).rejects.toMatchObject({errorCode:'AI_CANCELLED'});
    expect(h.state.aiRuns[0]).toMatchObject({status:'FAILED',decision:null,inputTokens:200,outputTokens:100,
      timing:{requestMs:10},failure:{errorCode:'AI_CANCELLED',cancelled:true,schemaValidation:false}});
    expect(h.events.some(event=>event.type==='AI_RUN_COMPLETED'||event.type==='PRIMARY_DECISION_NORMALIZED')).toBe(false);
    expect(h.fabric.circuitStatus().failureStreak).toBe(0);
  });

  it('does not dispatch when the caller cancels at the AI_RUN_STARTED audit boundary',async()=>{
    const h=fixture(),controller=new AbortController(),transport=mockFetch(()=>new Response(envelope(h.wire)));
    h.bus.on('AI_RUN_STARTED',()=>controller.abort());
    await expect(h.fabric.decide(h.packet,null,0,undefined,{signal:controller.signal})).rejects.toMatchObject({errorCode:'AI_CANCELLED'});
    expect(transport.fetch).not.toHaveBeenCalled();
    expect(h.state.aiRuns[0]).toMatchObject({timing:{requestMs:null,transportAttempts:0},failure:{cancelled:true}});
  });

  it('rejects a context invalidated during completion auditing while retaining the completed model fact and run id',async()=>{
    const h=fixture(),controller=new AbortController();mockFetch(()=>new Response(envelope(h.wire)));
    h.bus.on('AI_RUN_COMPLETED',()=>controller.abort());
    await expect(h.fabric.decide(h.packet,null,0,undefined,{signal:controller.signal})).rejects.toMatchObject({errorCode:'AI_CANCELLED',runId:h.state.aiRuns[0]?.id??expect.any(String)});
    expect(h.state.aiRuns[0]).toMatchObject({status:'COMPLETED',terminalStage:'SCHEMA_VALID',inputTokens:200,outputTokens:100});
    expect(h.events.some(event=>event.type==='PRIMARY_DECISION_NORMALIZED')).toBe(false);
    expect(h.state.entryIntents.size).toBe(0);expect(h.state.entryOrders.size).toBe(0);
  });

  it.each(['scout','observeScout'] as const)('propagates caller context through %s without changing its duty budget',async method=>{
    const h=fixture(),controller=new AbortController();
    const runJson=vi.spyOn((h.fabric as any).openAi,'runJson').mockImplementation(async(args:any)=>({value:args.parse(annotation),
      raw:{__zdjParsedDecision:annotation},inputTokens:1,outputTokens:1,finishReason:'stop',modelIdentity:null,timing:{requestMs:1,parseMs:0,retryMs:0}}));
    await h.fabric[method](h.packet,{signal:controller.signal,requestId:'scout-context',preRequestTiming:{prepareMs:5}});
    expect(runJson.mock.calls[0]![0]).toMatchObject({context:{signal:controller.signal,requestId:'scout-context'},
      timeoutMs:method==='observeScout'?30_000:180_000,maxOutputTokens:600});
    expect(h.state.aiRuns[0]).toMatchObject({requestContextId:'scout-context',requestSource:method==='observeScout'?'SHADOW':'ENTRY',
      scoutHandoff:method==='scout',timing:{prepareMs:5}});
  });

  it('preserves legacy archive timing and accepts explicit unknown timings in new failures',()=>{
    const legacy={id:'legacy',symbol:'TESTUSDT',resourceId:'primary',model:'model',role:'PRIMARY_BRAIN',startedAt:now,
      completedAt:now+100,latencyMs:100,inputTokens:null,outputTokens:null,status:'FAILED',direction:null,decision:null,packetId:null,error:'timeout',
      timing:{queueMs:10,promptBuildMs:0,requestMs:0,retryMs:0,parseMs:0,totalMs:100},
      failure:{failureStage:'MODEL_REQUEST',errorCode:'AI_TIMEOUT',errorMessage:'timeout',httpStatus:null,timeout:true,schemaValidation:false,retryCount:0,rawOutput:null}};
    expect(AiRunSchema.parse(legacy).timing).toEqual(legacy.timing);
    const updated={...legacy,timing:{...legacy.timing,requestMs:100,parseMs:null,responseBodyMs:null},failure:{...legacy.failure,retryCount:null}};
    expect(AiRunSchema.parse(updated).timing?.parseMs).toBeNull();expect(AiRunSchema.parse(updated).failure?.retryCount).toBeNull();
  });
});

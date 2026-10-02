import {afterEach,describe,expect,it,vi} from 'vitest';
import {EntryDecisionJsonSchema,EntryDecisionV370Schema,ScoutAnnotationJsonSchema,ScoutAnnotationSchema} from '@zdj/contracts';
import {AiRequestError,OpenAiCompatibleClient} from './OpenAiCompatibleClient.js';
import nativeEmptyFinal from './fixtures/scout-empty-final-20261001.json';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

const MODEL='qwen/qwen3.5-9b';
const annotation={symbol:'BTCUSDT',summary:'Closed candles are available; entry judgment belongs to Primary.',
  keyEvidence:['technical.15m.confirmed'],contradictions:[],missingEvidence:[],attentionScore:0.75};
const defaults={baseUrl:'http://127.0.0.1:1234/v1',model:MODEL,schemaName:'ScoutAnnotation',
  jsonSchema:ScoutAnnotationJsonSchema as unknown as Record<string,unknown>,maxOutputTokens:600};
type Patch=Partial<Omit<typeof defaults,'jsonSchema'>>&{jsonSchema?:Record<string,unknown>};

/** All requests stay inside this mock; only other backends may query /props. */
function reply(message:Record<string,unknown>={content:JSON.stringify(annotation)},finishReason='stop'){
  const completions:Array<{url:string;body:any;headers:any}>=[];
  const calls=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const target=String(url);
    if(target.endsWith('/props'))return new Response(JSON.stringify({model_alias:MODEL}));
    if(!target.endsWith('/chat/completions'))throw new Error(`Unexpected mocked endpoint: ${target}`);
    completions.push({url:target,body:JSON.parse(String(init?.body)),headers:init?.headers});
    return new Response(JSON.stringify({choices:[{finish_reason:finishReason,message}],
      usage:{prompt_tokens:3623,completion_tokens:361,completion_tokens_details:{reasoning_tokens:360}}}));
  });
  vi.stubGlobal('fetch',calls);
  return{calls,completions};
}

function run(patch:Patch={},parse:(value:unknown)=>unknown=value=>ScoutAnnotationSchema.parse(value)){
  return new OpenAiCompatibleClient('test-only-key').runJson({...defaults,...patch,
    prompt:'Original facts: asOf=1790812800000; bid=99.99; ask=100.01; no order authority.',
    timeoutMs:1_000,parse});
}

describe('local LM Studio 9B Scout request compatibility',()=>{
  it.each(['http://127.0.0.1:1234/v1','http://localhost:1234/v1/','http://[::1]:1234/v1'])
  ('requests final JSON on %s without changing facts, schema or output budget',async baseUrl=>{
    const f=reply(),result=await run({baseUrl});
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0]!.body).toEqual({model:MODEL,reasoning_effort:'none',
      messages:[{role:'user',content:'Original facts: asOf=1790812800000; bid=99.99; ask=100.01; no order authority.'}],
      temperature:0.1,stream:false,max_tokens:600,
      response_format:{type:'json_schema',json_schema:{name:'ScoutAnnotation',strict:true,schema:ScoutAnnotationJsonSchema}}});
    expect(result.value).toEqual(annotation);
    expect(result.raw).toMatchObject({__zdjParsedDecision:annotation,__zdjRequestOverrides:{reasoning_effort:'none'}});
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(result.modelIdentity).toBeNull();
    expect(f.calls.mock.calls.some(([url])=>/\/(models|health|props)$/.test(String(url)))).toBe(false);
  });

  it.each<Patch>([
    {model:'qwen/qwen3.8-27b'},
    {model:'qwen/qwen3.5-9b-alias'},
    {model:'qwen3.5:9b'},
    {schemaName:'EntryDecisionV392'},
    {schemaName:'ExternalResearchFacts'},
    {schemaName:'PositionReviewV396'},
    {baseUrl:'http://127.0.0.1:11434/v1'},
    {baseUrl:'https://remote-provider.test/v1'},
    {baseUrl:'http://127.0.0.1:1234/v1/unverified'},
    {jsonSchema:undefined},
  ])('does not change unverified models, duties or endpoints: %j',async patch=>{
    const f=reply(),result=await run(patch);
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(f.completions[0]!.body).not.toHaveProperty('chat_template_kwargs');
    expect(f.completions[0]!.body.max_tokens).toBe(600);
    expect(result.raw).not.toHaveProperty('__zdjRequestOverrides');
    if('jsonSchema' in patch)expect(f.completions[0]!.body.response_format).toEqual({type:'json_object'});
  });
});

describe('Scout final JSON remains strict and fail-closed',()=>{
  it('replays the sanitized native 2026-10-01 response without accepting reasoning as final output',async()=>{
    const envelope=nativeEmptyFinal.response,choice=envelope.choices[0]!;
    const calls=vi.fn(async(url:RequestInfo|URL)=>new Response(JSON.stringify(String(url).endsWith('/props')?{}:envelope)));
    vi.stubGlobal('fetch',calls);
    const parse=vi.fn(value=>ScoutAnnotationSchema.parse(value));
    await expect(run({},parse)).rejects.toMatchObject({
      message:'AI_OUTPUT_INVALID: final content is empty (reasoning-only response)',rawOutput:'',
      usage:{inputTokens:3633,outputTokens:361},responseDiagnostics:{finishReason:'stop',contentCharacters:0,
        reasoningCharacters:choice.message.reasoning_content.length,reasoningTokens:360},
    });
    expect(parse).not.toHaveBeenCalled();
    expect(calls.mock.calls.filter(([url])=>String(url).endsWith('/chat/completions'))).toHaveLength(1);
  });

  it('rejects empty final content even when reasoning is valid Scout JSON; retains counts, not reasoning text',async()=>{
    const reasoning=JSON.stringify({...annotation,summary:'private-reasoning-must-not-become-output'});
    const f=reply({content:'',reasoning_content:reasoning}),parse=vi.fn(value=>ScoutAnnotationSchema.parse(value));
    const error=await run({},parse).catch(error=>error);
    expect(error).toBeInstanceOf(AiRequestError);
    expect(error).toMatchObject({message:'AI_OUTPUT_INVALID: final content is empty (reasoning-only response)',
      stage:'PARSE',rawOutput:'',usage:{inputTokens:3623,outputTokens:361},
      responseDiagnostics:{finishReason:'stop',contentCharacters:0,reasoningCharacters:reasoning.length,reasoningTokens:360}});
    expect(JSON.stringify(error)).not.toContain('private-reasoning-must-not-become-output');
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it.each([null,undefined])('rejects missing final content %s without exposing reasoning',async content=>{
    const f=reply({content,reasoning_content:'private-reasoning'});
    const error=await run().catch(error=>error);
    expect(error).toMatchObject({stage:'PARSE',rawOutput:null,
      responseDiagnostics:{finishReason:'stop',contentCharacters:null,reasoningCharacters:17}});
    expect(JSON.stringify(error)).not.toContain('private-reasoning');
    expect(f.completions).toHaveLength(1);
  });

  it('rejects whitespace-only content without pretending reasoning was supplied',async()=>{
    const f=reply({content:'  \n'}),error=await run().catch(error=>error);
    expect(error).toMatchObject({message:'AI_OUTPUT_INVALID: final content is empty',
      responseDiagnostics:{contentCharacters:3,reasoningCharacters:0}});
    expect(f.completions).toHaveLength(1);
  });

  it('uses only final content when reasoning contains a conflicting annotation',async()=>{
    const f=reply({content:JSON.stringify(annotation),reasoning_content:JSON.stringify({...annotation,symbol:'ETHUSDT',attentionScore:1})});
    const parse=vi.fn(value=>ScoutAnnotationSchema.parse(value)),result=await run({},parse);
    expect(result.value).toEqual(annotation);
    expect(parse).toHaveBeenCalledExactlyOnceWith(annotation);
    expect(f.completions).toHaveLength(1);
  });

  it('rejects length-truncated output before schema parsing even if final JSON looks valid',async()=>{
    const f=reply({content:JSON.stringify(annotation)},'length'),parse=vi.fn(value=>value);
    await expect(run({},parse)).rejects.toMatchObject({message:'AI_OUTPUT_INVALID: output token limit reached',
      stage:'PARSE',usage:{outputTokens:361},responseDiagnostics:{finishReason:'length'}});
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it.each(['{"a":1}{"b":2}','[]','null','{"a":1} trailing','```json\n{"a":1}\n```\n{"b":2}'])
  ('rejects ambiguous or non-object final output without repairing or retrying: %s',async content=>{
    const f=reply({content}),parse=vi.fn(value=>value);
    await expect(run({},parse)).rejects.toMatchObject({stage:'PARSE',rawOutput:content,
      usage:{inputTokens:3623,outputTokens:361},responseDiagnostics:{finishReason:'stop'}});
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it.each([-0.01,1.01])('preserves the actual Scout schema refusal for attentionScore=%s',async attentionScore=>{
    const content=JSON.stringify({...annotation,attentionScore}),f=reply({content});
    await expect(run()).rejects.toMatchObject({stage:'PARSE',rawOutput:content,
      usage:{outputTokens:361},responseDiagnostics:{finishReason:'stop'}});
    expect(f.completions).toHaveLength(1);
  });

  it('preserves the strict Scout prohibition on order fields',async()=>{
    const content=JSON.stringify({...annotation,decision:'PLACE_LONG'}),f=reply({content});
    await expect(run()).rejects.toMatchObject({stage:'PARSE',rawOutput:content});
    expect(f.completions).toHaveLength(1);
  });
});

const primaryModel='qwen/qwen3.8-27b';
const primaryPrompt='Original entry facts: event.time=1790812800000; expiresAt=1790813100000; bid=99.99; ask=100.01; candidateId=candidate-long-1; quantity is engine-owned.';
const primaryDecision={action:'FINAL',schemaVersion:'V3.9.7',decision:'PLACE_LONG',
  structureDirection:'LONG',tradeSide:'LONG',selectedCandidateId:'candidate-long-1',quantityUnits:null,
  opportunityType:'TREND_RESUMPTION',marketRegime:'TREND',confidence:.8,
  trend1dRole:'SUPPORTS_LONG',trend4hRole:'SUPPORTS_LONG',trend15mRole:'SUPPORTS_LONG',alignmentClass:'ALIGNED_LONG',
  counterTrendException:false,counterTrendReason:null,idealPrice:100,acceptablePriceRange:{min:99.99,max:100.01},
  horizonMinutes:3,waitCondition:null,directionReason:'Closed trend aligned.',timingReason:'Confirmed original event.',
  entryLocationReason:'Inside configured band.',reason:'Selected the configured candidate.',entryInvalidation:'Original event expiry.',
  supportingEvidenceRefs:['technical.15m.confirmed'],profitTakePlan:{targetPrice:101,acceptableTargetRange:{min:100.9,max:101.1},
    targetHorizonMinutes:15,targetReason:'Positive configured net target.',evidenceRefs:['technical.15m.confirmed']},
  rejectLayer:'NONE',blockingCondition:'',releaseCondition:'',
  timingEvent:{id:'original-event-1',status:'COMPLETED',time:1790812800000,anchorPrice:100,timeframe:'1m',provenance:'closed_bar'},
};

function runPrimary(patch:Patch={},parse:(value:unknown)=>unknown=value=>EntryDecisionV370Schema.parse(value)){
  return new OpenAiCompatibleClient('test-only-key').runJson({...defaults,model:primaryModel,schemaName:'EntryDecisionV392',
    jsonSchema:EntryDecisionJsonSchema as unknown as Record<string,unknown>,maxOutputTokens:900,...patch,
    prompt:primaryPrompt,timeoutMs:180_000,parse});
}

describe('local LM Studio 27B entry request compatibility',()=>{
  it.each(['http://127.0.0.1:1234/v1','http://localhost:1234/v1/','http://[::1]:1234/v1'])
  ('requests final JSON on %s while preserving V3.9.7 facts, candidate schema and token budget',async baseUrl=>{
    const f=reply({content:JSON.stringify(primaryDecision)}),result=await runPrimary({baseUrl});
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0]!.body).toEqual({model:primaryModel,reasoning_effort:'none',
      messages:[{role:'user',content:primaryPrompt}],temperature:.1,stream:false,max_tokens:900,
      response_format:{type:'json_schema',json_schema:{name:'EntryDecisionV392',strict:true,schema:EntryDecisionJsonSchema}}});
    expect(result.value).toMatchObject(primaryDecision);
    expect(result.raw).toMatchObject({__zdjParsedDecision:primaryDecision,__zdjRequestOverrides:{reasoning_effort:'none'}});
    expect(result.timing?.transportAttempts).toBe(1);
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(result.modelIdentity).toBeNull();
    expect(f.calls.mock.calls.some(([url])=>/\/(models|health|props)$/.test(String(url)))).toBe(false);
  });

  it.each<Patch>([
    {model:'qwen3.8:27b'},
    {model:'qwen/qwen3.8-27b-alias'},
    {model:'qwen/qwen3.5-9b'},
    {schemaName:'ScoutAnnotation'},
    {schemaName:'PositionReviewV396'},
    {schemaName:'ExternalResearchFacts'},
    {baseUrl:'http://127.0.0.1:11434/v1'},
    {baseUrl:'https://remote-provider.test/v1'},
    {baseUrl:'http://localhost.remote-provider.test:1234/v1'},
    {baseUrl:'http://127.0.0.1:1234/v1/unverified'},
    {jsonSchema:undefined},
  ])('does not change unverified 27B model/duty/endpoint combinations: %j',async patch=>{
    const f=reply({content:JSON.stringify(primaryDecision)}),result=await runPrimary(patch);
    expect(f.completions).toHaveLength(1);
    expect(f.completions[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(f.completions[0]!.body).not.toHaveProperty('chat_template_kwargs');
    expect(f.completions[0]!.body.max_tokens).toBe(900);
    expect(result.raw).not.toHaveProperty('__zdjRequestOverrides');
    if('jsonSchema' in patch)expect(f.completions[0]!.body.response_format).toEqual({type:'json_object'});
  });

  it('keeps the caller 180-second deadline and does not retry after it is exhausted',async()=>{
    vi.useFakeTimers();
    const started=1790812800000;
    vi.setSystemTime(started);
    let completionCalls=0,abortedAt:number|undefined,settled=false;
    vi.stubGlobal('fetch',vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith('/props'))return Promise.resolve(new Response('{}'));
      if(!String(url).endsWith('/chat/completions'))throw new Error('Unexpected mocked endpoint');
      completionCalls++;
      return new Promise<Response>((_resolve,reject)=>{
        init!.signal!.addEventListener('abort',()=>{abortedAt=Date.now();reject(new DOMException('Aborted','AbortError'));},{once:true});
      });
    }));
    const outcome=runPrimary().then(value=>{settled=true;return value;},error=>{settled=true;return error;});
    await vi.advanceTimersByTimeAsync(179_999);
    expect(settled).toBe(false);
    expect(abortedAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({name:'AiRequestError',stage:'REQUEST'});
    expect(abortedAt).toBe(started+180_000);
    expect(completionCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the existing two-attempt transport ceiling for retriable HTTP failures',async()=>{
    vi.useFakeTimers();
    const bodies:Record<string,unknown>[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith('/props'))return new Response('{}');
      if(!String(url).endsWith('/chat/completions'))throw new Error('Unexpected mocked endpoint');
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('unavailable',{status:503,headers:{'retry-after':'0'}});
    }));
    const outcome=runPrimary().catch(error=>error);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({name:'AiRequestError',stage:'REQUEST'});
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({reasoning_effort:'none',max_tokens:900});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('27B final JSON still obeys the current strict candidate contract',()=>{
  it('never accepts reasoning-only JSON as an entry decision or adds a semantic retry',async()=>{
    const reasoning=JSON.stringify({...primaryDecision,reason:'private reasoning must never become a decision'});
    const f=reply({content:'',reasoning_content:reasoning}),parse=vi.fn(value=>EntryDecisionV370Schema.parse(value));
    const error=await runPrimary({},parse).catch(error=>error);
    expect(error).toMatchObject({name:'AiRequestError',stage:'PARSE',rawOutput:'',
      message:'AI_OUTPUT_INVALID: final content is empty (reasoning-only response)',
      responseDiagnostics:{finishReason:'stop',contentCharacters:0,reasoningCharacters:reasoning.length}});
    expect(JSON.stringify(error)).not.toContain('private reasoning');
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it('ignores a contradictory reasoning decision when final content is valid',async()=>{
    const f=reply({content:JSON.stringify(primaryDecision),reasoning_content:JSON.stringify({...primaryDecision,tradeSide:'SHORT'})});
    expect((await runPrimary()).value).toMatchObject(primaryDecision);
    expect(f.completions).toHaveLength(1);
  });

  it('rejects token truncation before parsing even if the response happens to be valid JSON',async()=>{
    const f=reply({content:JSON.stringify(primaryDecision)},'length'),parse=vi.fn(value=>EntryDecisionV370Schema.parse(value));
    await expect(runPrimary({},parse)).rejects.toMatchObject({stage:'PARSE',
      message:'AI_OUTPUT_INVALID: output token limit reached',responseDiagnostics:{finishReason:'length'}});
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it.each(['',undefined,JSON.stringify(primaryDecision)+JSON.stringify(primaryDecision),JSON.stringify(primaryDecision).slice(0,-1)])
  ('rejects missing, incomplete or multiple final objects without semantic retry: %#',async content=>{
    const f=reply({content}),parse=vi.fn(value=>EntryDecisionV370Schema.parse(value));
    await expect(runPrimary({},parse)).rejects.toMatchObject({stage:'PARSE'});
    expect(parse).not.toHaveBeenCalled();
    expect(f.completions).toHaveLength(1);
  });

  it.each([
    {confidence:1.01},
    {quantityUnits:25},
    {selectedCandidateId:null},
    {profitTakePlan:null},
    {tradeSide:'SHORT'},
    {trend1dRole:null},
    {approveOrder:true},
  ])('preserves schema refusal without repair or retry: %j',async patch=>{
    const content=JSON.stringify({...primaryDecision,...patch}),f=reply({content});
    await expect(runPrimary()).rejects.toMatchObject({stage:'PARSE',rawOutput:content,
      responseDiagnostics:{finishReason:'stop'},usage:{inputTokens:3623,outputTokens:361}});
    expect(f.completions).toHaveLength(1);
  });
});

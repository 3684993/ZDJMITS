import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AiRequestError,OpenAiCompatibleClient,type AiCallContext} from './OpenAiCompatibleClient.js';

const started=1_790_812_800_000;
const wire=JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"decision":"WAIT"}'}}],usage:{prompt_tokens:123,completion_tokens:9}});
const defaults={baseUrl:'http://mock.invalid/v1',model:'model-a',prompt:'facts remain unchanged',schemaName:'OfflineTest',timeoutMs:180_000,parse:(value:unknown)=>value};
type RequestPatch=Partial<typeof defaults>&{context?:AiCallContext};
const run=(patch:RequestPatch={},client=new OpenAiCompatibleClient())=>client.runJson({...defaults,...patch});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function mockTransport(completion:(init:RequestInit)=>Promise<Response>|Response,props:()=>Promise<Response>|Response=()=>new Response('{}')){
  const calls=vi.fn((url:RequestInfo|URL,init?:RequestInit)=>{
    if(String(url).endsWith('/props'))return Promise.resolve(props());
    if(String(url).endsWith('/chat/completions'))return Promise.resolve(completion(init!));
    throw new Error(`NETWORK_FORBIDDEN: ${String(url)}`);
  });
  vi.stubGlobal('fetch',calls);return calls;
}
function delayedBody(ms:number,body=wire){
  let timer:ReturnType<typeof setTimeout>;
  const cancelled=vi.fn(()=>clearTimeout(timer));
  const stream=new ReadableStream<Uint8Array>({start(controller){timer=setTimeout(()=>{controller.enqueue(new TextEncoder().encode(body));controller.close();},ms);},cancel:cancelled});
  return{response:new Response(stream),cancelled};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(started);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('bounded provider lifecycle and measured stages',()=>{
  it('measures headers, complete body and parsing separately without claiming server phases',async()=>{
    mockTransport(async()=>{await sleep(10);return delayedBody(40).response;});
    const outcome=run({parse:value=>{vi.setSystemTime(Date.now()+7);return value;}});
    await vi.advanceTimersByTimeAsync(50);
    expect((await outcome).timing).toEqual({requestMs:50,responseHeadersMs:10,responseBodyMs:40,parseMs:7,retryMs:0,
      transportAttempts:1,responseBytes:new TextEncoder().encode(wire).byteLength,clientElapsedMs:57,
      firstTokenMs:null,serverQueueMs:null,prefillMs:null,decodeMs:null,cachedInputTokens:null,providerTimingSource:null});
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['CALLER','DEADLINE'] as const)('bounds the entire response body on %s and does not classify it as schema failure',async source=>{
    const controller=new AbortController(),body=delayedBody(500),parse=vi.fn(value=>value),completions=vi.fn(()=>body.response);
    mockTransport(completions);
    const outcome=run({timeoutMs:100,context:{signal:controller.signal,requestId:'request-body'},parse}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(40);
    if(source==='CALLER')controller.abort();else await vi.advanceTimersByTimeAsync(60);
    const elapsed=source==='CALLER'?40:100,error=await outcome;
    expect(error).toBeInstanceOf(AiRequestError);
    expect(error).toMatchObject({stage:'RESPONSE_BODY',errorCode:source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT',
      cancelled:source==='CALLER',timeout:source==='DEADLINE',requestContextId:'request-body',usage:null,
      cancellation:{source,requestedAt:started+elapsed,backendStatus:'UNKNOWN'},
      timing:{requestMs:elapsed,responseHeadersMs:0,responseBodyMs:elapsed,parseMs:null,retryMs:0,transportAttempts:1,responseBytes:0,clientElapsedMs:elapsed}});
    expect(completions).toHaveBeenCalledOnce();expect(parse).not.toHaveBeenCalled();expect(body.cancelled).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();expect(vi.getTimerCount()).toBe(0);
  });

  it('records a body stream failure as RESPONSE_BODY, including received bytes, without retrying',async()=>{
    const parse=vi.fn(value=>value),completions=vi.fn(()=>new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('{'));
      setTimeout(()=>controller.error(new Error('body socket closed')),30);
    }})));
    mockTransport(completions);const outcome=run({parse}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(30);
    expect(await outcome).toMatchObject({stage:'RESPONSE_BODY',errorCode:'AI_RESPONSE_BODY_ERROR',timeout:false,cancelled:false,
      timing:{requestMs:30,responseBodyMs:30,parseMs:null,transportAttempts:1,responseBytes:1}});
    expect(completions).toHaveBeenCalledOnce();expect(parse).not.toHaveBeenCalled();
  });

  it('measures both failed transport attempts and the actual backoff',async()=>{
    const completions=vi.fn(async()=>{await sleep(10);throw new Error('connection closed');});mockTransport(completions);
    const outcome=run().catch(error=>error);await vi.advanceTimersByTimeAsync(270);
    expect(await outcome).toMatchObject({stage:'REQUEST',errorCode:'AI_RUN_FAILED',
      timing:{requestMs:20,responseHeadersMs:20,responseBodyMs:null,parseMs:null,retryMs:250,transportAttempts:2,clientElapsedMs:270}});
    expect(completions).toHaveBeenCalledTimes(2);
  });

  it('cancels during Retry-After without sending a second request',async()=>{
    const controller=new AbortController(),completions=vi.fn(()=>new Response('busy',{status:429,headers:{'retry-after':'2'}}));
    mockTransport(completions);const outcome=run({context:{signal:controller.signal}}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(75);controller.abort();
    expect(await outcome).toMatchObject({stage:'RETRY_WAIT',errorCode:'AI_CANCELLED',timeout:false,
      timing:{requestMs:0,responseBodyMs:0,parseMs:null,retryMs:75,transportAttempts:1,clientElapsedMs:75}});
    expect(completions).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });

  it('does not probe, dispatch, retry or parse an already-cancelled request',async()=>{
    const controller=new AbortController();controller.abort();const calls=mockTransport(()=>new Response(wire)),parse=vi.fn(value=>value);
    await expect(run({context:{signal:controller.signal},parse})).rejects.toMatchObject({errorCode:'AI_CANCELLED',
      timing:{requestMs:null,responseHeadersMs:null,responseBodyMs:null,parseMs:null,transportAttempts:0}});
    expect(calls).not.toHaveBeenCalled();expect(parse).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });

  it.each([50,500_000])('honors earlier deadlines without extending the configured inference budget: %d',async deadlineOffset=>{
    const completions=vi.fn(()=>new Promise<Response>(()=>{}));mockTransport(completions);
    const outcome=run({context:{deadlineAt:started+deadlineOffset}}).catch(error=>error),elapsed=Math.min(deadlineOffset,180_000);
    await vi.advanceTimersByTimeAsync(elapsed);
    expect(await outcome).toMatchObject({stage:'REQUEST',errorCode:'AI_TIMEOUT',
      timing:{requestMs:elapsed,responseBodyMs:null,parseMs:null,transportAttempts:1,clientElapsedMs:elapsed}});
    expect(completions).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an ignored-signal late transport response and never parses it',async()=>{
    let resolve!:(response:Response)=>void;const parse=vi.fn(value=>value),completions=vi.fn(()=>new Promise<Response>(done=>{resolve=done;}));
    mockTransport(completions);const outcome=run({timeoutMs:100,parse}).catch(error=>error);
    await vi.advanceTimersByTimeAsync(100);expect(await outcome).toMatchObject({errorCode:'AI_TIMEOUT'});
    const cancelled=vi.fn();resolve(new Response(new ReadableStream({cancel:cancelled})));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toHaveBeenCalledOnce();expect(parse).not.toHaveBeenCalled();expect(completions).toHaveBeenCalledOnce();
  });

  it.each(['CALLER','DEADLINE'] as const)('rejects cancellation/deadline during synchronous schema parsing: %s',async source=>{
    const controller=new AbortController();mockTransport(()=>new Response(wire));
    const error=await run({timeoutMs:100,context:{signal:controller.signal},parse:()=>{
      if(source==='CALLER')controller.abort();else vi.setSystemTime(started+101);
      return{decision:'MUST_NOT_ESCAPE'};
    }}).catch(error=>error);
    expect(error).toMatchObject({stage:'PARSE',errorCode:source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT',
      usage:{inputTokens:123,outputTokens:9},timing:{parseMs:source==='CALLER'?0:101,transportAttempts:1}});
  });

  it.each([
    {body:'not JSON',parse:()=>null,stage:'RESPONSE_JSON',errorCode:'AI_RESPONSE_JSON_INVALID',usage:null},
    {body:wire,parse:()=>{throw new Error('invalid decision field');},stage:'PARSE',errorCode:'AI_SCHEMA_INVALID',usage:{inputTokens:123,outputTokens:9}},
  ])('distinguishes envelope JSON and decision schema failures: $stage',async test=>{
    const completions=vi.fn(()=>new Response(test.body));mockTransport(completions);
    await expect(run({parse:test.parse})).rejects.toMatchObject({stage:test.stage,errorCode:test.errorCode,usage:test.usage,
      timing:{requestMs:0,responseBodyMs:0,parseMs:0,transportAttempts:1}});
    expect(completions).toHaveBeenCalledOnce();
  });
});

describe('bounded identity metadata cache',()=>{
  it('separates endpoint/model keys and expires successful metadata after 60 seconds',async()=>{
    const client=new OpenAiCompatibleClient(),props=vi.fn(()=>new Response('{"model_alias":"served-model"}'));
    mockTransport(()=>new Response(wire),props);
    const a=await run({},client),b=await run({model:'model-b'},client);
    expect(a.modelIdentity).toMatchObject({requestedModel:'model-a'});expect(b.modelIdentity).toMatchObject({requestedModel:'model-b'});
    await run({baseUrl:'http://mock.invalid/v1/'},client);expect(props).toHaveBeenCalledTimes(2);
    await run({baseUrl:'http://other.invalid/v1'},client);expect(props).toHaveBeenCalledTimes(3);
    vi.setSystemTime(started+60_000);await run({},client);expect(props).toHaveBeenCalledTimes(4);
    expect((client as any).identities.size).toBe(1);
  });

  it('does not let an empty-model health probe populate a named-model identity',async()=>{
    const props=vi.fn(()=>new Response('{}')),client=new OpenAiCompatibleClient();
    vi.stubGlobal('fetch',vi.fn((url:RequestInfo|URL)=>String(url).endsWith('/props')?Promise.resolve(props()):
      String(url).endsWith('/health')?Promise.resolve(new Response('ok')):
      String(url).endsWith('/chat/completions')?Promise.resolve(new Response(wire)):Promise.reject(new Error('NETWORK_FORBIDDEN'))));
    expect((await client.probe(defaults.baseUrl)).identity).toMatchObject({requestedModel:''});
    expect((await run({},client)).modelIdentity).toMatchObject({requestedModel:'model-a'});expect(props).toHaveBeenCalledTimes(2);
  });

  it('expires failed metadata after five seconds and bounds cache cardinality',async()=>{
    const props=vi.fn(()=>new Response('unavailable',{status:503})),client=new OpenAiCompatibleClient();mockTransport(()=>new Response(wire),props);
    await run({},client);await run({},client);expect(props).toHaveBeenCalledOnce();
    vi.setSystemTime(started+5_000);await run({},client);expect(props).toHaveBeenCalledTimes(2);
    for(let i=0;i<70;i++)await run({model:`different-model-${i}`},client);
    expect((client as any).identities.size).toBe(64);
    await run({},client);expect(props).toHaveBeenCalledTimes(73);
  });

  it('does not hold a successful decision behind an unresponsive diagnostic identity lookup',async()=>{
    const client=new OpenAiCompatibleClient(),props=vi.fn(()=>new Promise<Response>(()=>{}));mockTransport(()=>new Response(wire),props);
    const result=await run({},client);expect(result.value).toEqual({decision:'WAIT'});expect(result.modelIdentity).toBeNull();
    expect(result.timing.clientElapsedMs).toBe(0);expect(props).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);expect(vi.getTimerCount()).toBe(0);
  });
});

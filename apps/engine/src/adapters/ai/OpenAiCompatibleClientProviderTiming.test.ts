import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OpenAiCompatibleClient} from './OpenAiCompatibleClient.js';

const started=1_790_952_000_000;
const defaults={baseUrl:'http://127.0.0.1:8083/v1',model:'Qwen3.8-27B-4bit',prompt:'unchanged frozen facts',
  schemaName:'OfflineTimingTest',timeoutMs:180_000,parse:(value:unknown)=>value};
// Only response usage is transcribed from airun_mur54xd2_v7oxecj4. No archived
// decision is replayed into an entry coordinator or an exchange adapter.
const nativeUsage={prompt_tokens:13020,completion_tokens:722,total_tokens:13742,input_tokens:13020,output_tokens:722,
  prompt_tokens_details:{cached_tokens:0},time_to_first_token:67.43,total_time:107.02,
  prompt_eval_duration:67.43,generation_duration:39.59,prompt_tokens_per_second:193.1,generation_tokens_per_second:18.24};

function reply(usage:unknown,content='{"decision":"WAIT"}',finishReason='stop'){
  const raw={choices:[{finish_reason:finishReason,message:{content}}],usage};
  const calls=vi.fn(async(url:RequestInfo|URL)=>{
    if(String(url).endsWith('/props'))return new Response('{}');
    if(String(url).endsWith('/chat/completions'))return new Response(JSON.stringify(raw));
    throw new Error(`NETWORK_FORBIDDEN: ${String(url)}`);
  });
  vi.stubGlobal('fetch',calls);return{calls,raw};
}
const run=(patch:Partial<typeof defaults>={})=>new OpenAiCompatibleClient().runJson({...defaults,...patch});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(started);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('explicit provider usage measurements',()=>{
  it.each(['http://127.0.0.1:8083/v1','http://localhost:8083/v1/','http://[::1]:8083/v1'])
  ('preserves native oMLX seconds as provider milliseconds on %s',async baseUrl=>{
    const {raw}=reply(nativeUsage),result=await run({baseUrl});
    expect(result.timing).toMatchObject({prefillMs:67_430,decodeMs:39_590,firstTokenMs:67_430,cachedInputTokens:0,
      providerTimingSource:'OMLX_USAGE_SECONDS',serverQueueMs:null,requestMs:0,clientElapsedMs:0});
    expect(result.inputTokens).toBe(13020);expect(result.outputTokens).toBe(722);
    expect(result.raw).toMatchObject(raw);
  });

  it('keeps independently reported phases separate from each other and client elapsed time',async()=>{
    reply({...nativeUsage,prompt_eval_duration:3.0006,generation_duration:5.0014,time_to_first_token:6.75,total_time:100});
    const result=await run({parse:value=>{vi.setSystemTime(started+17);return value;}});
    expect(result.timing).toMatchObject({prefillMs:3001,decodeMs:5001,firstTokenMs:6750,
      clientElapsedMs:17,parseMs:17,requestMs:0,serverQueueMs:null});
  });

  it.each([
    {usage:{prompt_eval_duration:0},expected:{prefillMs:0,decodeMs:null,firstTokenMs:null,providerTimingSource:'OMLX_USAGE_SECONDS'}},
    {usage:{generation_duration:0.0004},expected:{prefillMs:null,decodeMs:0,firstTokenMs:null,providerTimingSource:'OMLX_USAGE_SECONDS'}},
    {usage:{time_to_first_token:2.5},expected:{prefillMs:null,decodeMs:null,firstTokenMs:2500,providerTimingSource:'OMLX_USAGE_SECONDS'}},
    {usage:{total_time:100,prompt_tokens_per_second:100,generation_tokens_per_second:10},expected:{prefillMs:null,decodeMs:null,firstTokenMs:null,providerTimingSource:null}},
    {usage:undefined,expected:{prefillMs:null,decodeMs:null,firstTokenMs:null,providerTimingSource:null}},
  ])('does not invent missing phase data: $usage',async({usage,expected})=>{
    reply(usage);expect((await run()).timing).toMatchObject({...expected,serverQueueMs:null});
  });

  it.each([-1,'67.43',true,null,{},[],Number.MAX_VALUE])('rejects malformed or overflowing phase values: %j',async value=>{
    reply({prompt_eval_duration:value,generation_duration:value,time_to_first_token:value});
    expect((await run()).timing).toMatchObject({prefillMs:null,decodeMs:null,firstTokenMs:null,providerTimingSource:null});
  });

  it.each(['http://127.0.0.1:1234/v1','http://127.0.0.1:8084/v1','http://127.0.0.1:8083/v1/unverified','https://provider.invalid/v1'])
  ('does not assume an unverified provider uses oMLX time units: %s',async baseUrl=>{
    reply(nativeUsage);
    expect((await run({baseUrl})).timing).toMatchObject({prefillMs:null,decodeMs:null,firstTokenMs:null,
      providerTimingSource:null,cachedInputTokens:0,serverQueueMs:null});
  });

  it.each([
    {prompt:100,cached:40,expected:40},{prompt:100,cached:0,expected:0},{prompt:100,cached:100,expected:100},
    {prompt:100,cached:101,expected:null},{prompt:100,cached:-1,expected:null},{prompt:100,cached:1.5,expected:null},
    {prompt:100,cached:'40',expected:null},{prompt:100,cached:undefined,expected:null},
    {prompt:undefined,cached:40,expected:40},{prompt:100,cached:Number.MAX_SAFE_INTEGER+1,expected:null},
  ])('validates cache counters without defaulting unknown to zero: $prompt/$cached',async({prompt,cached,expected})=>{
    reply({prompt_tokens:prompt,prompt_tokens_details:{cached_tokens:cached}});
    expect((await run()).timing.cachedInputTokens).toBe(expected);
  });

  it.each([-1,'100',true,1.5,Number.MAX_SAFE_INTEGER+1])('normalizes malformed token counters to unknown: %j',async value=>{
    reply({prompt_tokens:value,completion_tokens:value});
    const result=await run();expect(result.inputTokens).toBeNull();expect(result.outputTokens).toBeNull();
  });

  it.each([{content:'{',finishReason:'stop'},{content:'{"decision":"WAIT"}',finishReason:'length'}])
  ('retains provider measurements for rejected final output: $finishReason/$content',async({content,finishReason})=>{
    reply(nativeUsage,content,finishReason);
    await expect(run()).rejects.toMatchObject({stage:'PARSE',errorCode:'AI_SCHEMA_INVALID',usage:{inputTokens:13020,outputTokens:722},
      timing:{prefillMs:67_430,decodeMs:39_590,cachedInputTokens:0,providerTimingSource:'OMLX_USAGE_SECONDS'}});
  });

  it('does not turn a truncated transport body into provider evidence',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).endsWith('/props'))return new Response('{}');
      return new Response(new ReadableStream({start(controller){
        controller.enqueue(new TextEncoder().encode('{"usage":{"prompt_eval_duration":1},'));
        setTimeout(()=>controller.error(new Error('socket closed')),10);
      }}));
    }));
    const outcome=run().catch(error=>error);await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toMatchObject({stage:'RESPONSE_BODY',usage:null,timing:{prefillMs:null,decodeMs:null,
      firstTokenMs:null,cachedInputTokens:null,providerTimingSource:null,clientElapsedMs:10}});
  });
});

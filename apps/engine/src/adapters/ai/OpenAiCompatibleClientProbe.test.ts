import {afterEach,describe,expect,it,vi} from 'vitest';
import {OpenAiCompatibleClient} from './OpenAiCompatibleClient.js';

const model='qwen/qwen3.5-9b';
const lmStudio='http://127.0.0.1:1234/v1';
const directory={object:'list',data:[{object:'model',id:model,owned_by:'organization_owner'}]};
const wire=JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"decision":"WAIT"}'}}]});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('verified local LM Studio health protocol',()=>{
  it.each(['http://127.0.0.1:1234/v1','http://localhost:1234/v1','http://[::1]:1234/v1'].flatMap(url=>[url,`${url}/`]))
  ('checks the configured model only through /v1/models on %s',async baseUrl=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL)=>new Response(JSON.stringify(directory)));vi.stubGlobal('fetch',fetcher);
    expect(await new OpenAiCompatibleClient().probe(baseUrl,2_000,model)).toEqual({ok:true,identity:null,reason:null});
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${baseUrl.replace(/\/+$/,'')}/models`);
  });

  it.each([
    {error:'Unexpected endpoint or method'},
    {...directory,error:null},
    {object:'list'},
    {data:directory.data},
    {object:'list',data:{}},
    {object:'list',data:[null]},
    {object:'list',data:[{id:model}]},
    {object:'list',data:[{object:'model',id:42}]},
    {object:'list',data:[{object:'model',id:'  '}]},
    {object:'list',data:[...directory.data,{object:'unexpected',id:'other-model'}]},
    null,[],
  ])('rejects HTTP 200 malformed/error bodies: %#',async body=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(body)));vi.stubGlobal('fetch',fetcher);
    expect(await new OpenAiCompatibleClient().probe(lmStudio,2_000,model)).toEqual({ok:false,identity:null,reason:'AI model list invalid response structure'});
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects invalid JSON without falling back to /health or /props',async()=>{
    const fetcher=vi.fn(async()=>new Response('not JSON'));vi.stubGlobal('fetch',fetcher);
    expect(await new OpenAiCompatibleClient().probe(lmStudio)).toEqual({ok:false,identity:null,reason:'AI model list invalid JSON'});
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{data:[]},{data:[{object:'model',id:`${model}-alias`}]},{data:[{object:'model',id:'QWEN/QWEN3.5-9B'}]}])
  ('requires an exact configured model id: %#',async({data})=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({object:'list',data}))));
    expect(await new OpenAiCompatibleClient().probe(lmStudio,2_000,model)).toEqual({ok:false,identity:null,reason:`AI configured model unavailable: ${model}`});
  });

  it('allows a validated model directory without claiming loaded inference or identity',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(directory))));
    expect(await new OpenAiCompatibleClient().probe(lmStudio)).toEqual({ok:true,identity:null,reason:null});
  });

  it('preserves the HTTP failure even when the body is a valid directory',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(directory),{status:503})));
    expect(await new OpenAiCompatibleClient().probe(lmStudio,2_000,model)).toEqual({ok:false,identity:null,reason:'AI model list HTTP 503'});
  });

  it.each(['headers','body'] as const)('bounds the complete %s read to two seconds even when transport ignores abort',async stage=>{
    vi.useFakeTimers();let requestSignal:AbortSignal|undefined,resolveLate:(value:any)=>void=()=>{};
    const pending=new Promise<any>(resolve=>{resolveLate=resolve;});
    const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>{
      requestSignal=init?.signal??undefined;
      return stage==='headers'?pending:Promise.resolve({ok:true,text:()=>pending} as Response);
    });vi.stubGlobal('fetch',fetcher);
    let settled=false;const outcome=new OpenAiCompatibleClient().probe(lmStudio,2_000,model).then(result=>{settled=true;return result;});
    await vi.advanceTimersByTimeAsync(1_999);expect(settled).toBe(false);expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);const result=await outcome;
    expect(result.ok).toBe(false);expect(result.reason).toBeTruthy();expect(requestSignal?.aborted).toBe(true);
    resolveLate(stage==='headers'?new Response(JSON.stringify(directory)):JSON.stringify(directory));
    await vi.runAllTimersAsync();expect(result.ok).toBe(false);expect(fetcher).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a failed response body as unavailable and clears its deadline',async()=>{
    vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>{throw new Error('body read failed');}} as unknown as Response)));
    expect(await new OpenAiCompatibleClient().probe(lmStudio)).toEqual({ok:false,identity:null,reason:'body read failed'});
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accept a body that crosses the deadline before its timer callback executes',async()=>{
    vi.useFakeTimers();const start=Date.now();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>{vi.setSystemTime(start+2_001);return JSON.stringify(directory);}} as unknown as Response)));
    expect((await new OpenAiCompatibleClient().probe(lmStudio)).ok).toBe(false);expect(vi.getTimerCount()).toBe(0);
  });

  it('also checks the deadline after synchronous directory validation',async()=>{
    vi.useFakeTimers();const start=Date.now(),parse=JSON.parse;
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(directory))));
    vi.spyOn(JSON,'parse').mockImplementation(text=>{
      const value=parse(text);
      Object.defineProperty(value.data[0],'id',{get:()=>{vi.setSystemTime(start+2_001);return model;}});
      return value;
    });
    expect((await new OpenAiCompatibleClient().probe(lmStudio,2_000,model)).ok).toBe(false);expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['http://127.0.0.1:1234/v1','http://localhost:1234/v1/','http://[::1]:1234/v1'])
  ('never probes health, props or models during inference at %s',async baseUrl=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL)=>new Response(wire));vi.stubGlobal('fetch',fetcher);
    const client=new OpenAiCompatibleClient();
    const result=await client.runJson({baseUrl,model,prompt:'facts unchanged',schemaName:'OtherDuty',timeoutMs:180_000,parse:value=>value});
    expect(result.value).toEqual({decision:'WAIT'});expect(result.modelIdentity).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${baseUrl.replace(/\/+$/,'')}/chat/completions`);
    expect((client as any).identities.size).toBe(0);
  });
});

describe('other backends retain their existing health and identity protocol',()=>{
  it.each(['http://127.0.0.1:8083/v1','http://localhost:8083/v1/','http://127.0.0.1:11434/v1',
    'http://localhost.remote.test:1234/v1','https://localhost:1234/v1','http://127.0.0.1:1234/v1/unverified'])
  ('does not identify %s as the verified LM Studio endpoint',async baseUrl=>{
    const root=baseUrl.replace(/\/+$/,'').replace(/\/v1$/,''),fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url)===`${root}/health`)return new Response('ok');
      if(String(url)===`${root}/props`)return new Response(JSON.stringify({model_alias:'served-model',model_ftype:'4bit'}));
      throw new Error(`Unexpected mocked endpoint: ${String(url)}`);
    });vi.stubGlobal('fetch',fetcher);
    const result=await new OpenAiCompatibleClient().probe(baseUrl,2_000,'configured-model');
    expect(result).toMatchObject({ok:true,reason:null,identity:{requestedModel:'',modelAlias:'served-model',quantization:'4bit'}});
    expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual([`${root}/health`,`${root}/props`]);
  });

  it('keeps oMLX inference metadata asynchronous and separate from the empty-model health identity',async()=>{
    const baseUrl='http://127.0.0.1:8083/v1',model='Qwen3.8-27B-4bit',fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).endsWith('/health'))return new Response('ok');
      if(String(url).endsWith('/props'))return new Response(JSON.stringify({model_alias:model}));
      if(String(url).endsWith('/chat/completions'))return new Response(wire);
      throw new Error('Unexpected mocked endpoint');
    });vi.stubGlobal('fetch',fetcher);
    const client=new OpenAiCompatibleClient();expect((await client.probe(baseUrl,2_000,model)).identity).toMatchObject({requestedModel:''});
    const result=await client.runJson({baseUrl,model,prompt:'facts unchanged',schemaName:'EntryDecisionV392',timeoutMs:180_000,parse:value=>value});
    expect(result.modelIdentity).toMatchObject({requestedModel:model,modelAlias:model});
    expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/props'))).toHaveLength(2);
    expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/models'))).toBe(false);
  });
});

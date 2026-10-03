import {afterEach,describe,expect,it,vi} from 'vitest';
import {OpenAiCompatibleClient} from './OpenAiCompatibleClient.js';

afterEach(()=>vi.unstubAllGlobals());

describe('review inference request',()=>{
  it('disables thinking only for the bounded review call',async()=>{
    const bodies:Record<string,unknown>[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
      if(String(input).endsWith('/props'))return new Response('{}',{status:200});
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"decision":"HOLD"}'}}],usage:{prompt_tokens:10,completion_tokens:8}}),{status:200});
    }));
    const client=new OpenAiCompatibleClient();
    const base={baseUrl:'http://127.0.0.1:8083/v1',model:'qwen/qwen3.8-27b',prompt:'review',schemaName:'Review',timeoutMs:5_000,maxOutputTokens:600,parse:(value:unknown)=>value};
    await client.runJson({...base,disableThinking:true});
    await client.runJson({...base,disableThinking:false});
    expect(bodies[0]).toMatchObject({max_tokens:600,chat_template_kwargs:{enable_thinking:false}});
    expect(bodies[1]).not.toHaveProperty('chat_template_kwargs');
  });
});

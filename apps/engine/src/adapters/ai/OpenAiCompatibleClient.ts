import type { ModelRunResult } from '../../types.js';
import { createHash } from 'node:crypto';

export interface AiCallContext {
  signal?:AbortSignal;
  requestId?:string;
  /** Optional earlier inference deadline; never extends the configured per-request budget. */
  deadlineAt?:number;
  preRequestTiming?:{slotWaitMs?:number|null;scoutMs?:number|null;prepareMs?:number|null};
}
export type AiRequestStage='REQUEST'|'RESPONSE_BODY'|'RESPONSE_JSON'|'PARSE'|'RETRY_WAIT';
export type AiClientTiming=ModelRunResult<unknown>['timing'];
export interface AiCancellation {source:'CALLER'|'DEADLINE';requestedAt:number;backendStatus:'UNKNOWN';}
/** Response metadata only. Reasoning text is never a fallback decision. */
export interface AiResponseDiagnostics {
  finishReason:string|null;contentCharacters:number|null;reasoningCharacters:number;reasoningTokens:number|null;
}
export class AiRequestError extends Error {
  timing:AiClientTiming|null=null;
  errorCode:string;
  cancelled=false;
  timeout=false;
  cancellation:AiCancellation|null=null;
  requestContextId?:string;
  constructor(message:string,readonly stage:AiRequestStage,readonly rawOutput:string|null=null,
    readonly httpStatus:number|null=null,readonly usage:{inputTokens:number|null;outputTokens:number|null}|null=null,
    readonly responseDiagnostics:AiResponseDiagnostics|null=null){
    super(message);this.name='AiRequestError';this.errorCode=httpStatus?`AI_HTTP_${httpStatus}`:stage==='PARSE'?'AI_SCHEMA_INVALID':stage==='RESPONSE_JSON'?'AI_RESPONSE_JSON_INVALID':stage==='RESPONSE_BODY'?'AI_RESPONSE_BODY_ERROR':'AI_RUN_FAILED';
  }
}

/** A transport or mock that ignores AbortSignal cannot return a late accepted result. */
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const aborted=()=>{cleanup();reject(signal.reason??new Error('Aborted'));};
    const cleanup=()=>signal.removeEventListener('abort',aborted);
    if(signal.aborted){work.catch(()=>{});aborted();return;}
    signal.addEventListener('abort',aborted,{once:true});
    work.then(value=>{cleanup();signal.aborted?reject(signal.reason):resolve(value);},error=>{cleanup();reject(error);});
  });
}
const emptyTiming=():AiClientTiming=>({requestMs:null,responseHeadersMs:null,responseBodyMs:null,parseMs:null,retryMs:0,
  transportAttempts:0,responseBytes:null,clientElapsedMs:0,firstTokenMs:null,serverQueueMs:null,prefillMs:null,decodeMs:null,
  cachedInputTokens:null,providerTimingSource:null});
export function cancelledAiCall(context:AiCallContext|undefined,stage:AiRequestStage='REQUEST'):AiRequestError|null {
  const source=context?.signal?.aborted?'CALLER':context?.deadlineAt!==undefined&&Date.now()>=context.deadlineAt?'DEADLINE':null;
  if(!source)return null;
  const error=new AiRequestError(`${source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT'}: ${stage}`,stage);
  error.errorCode=source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT';error.cancelled=source==='CALLER';error.timeout=source==='DEADLINE';
  error.cancellation={source,requestedAt:Date.now(),backendStatus:'UNKNOWN'};error.requestContextId=context?.requestId;
  return error;
}

export function parseSingleJsonDecision(text:string):Record<string,unknown>{let trimmed=text.trim();if(!trimmed)throw new AiRequestError('AI_OUTPUT_INVALID: exactly one JSON object is required','PARSE',text);const fenced=trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fenced)trimmed=fenced[1]!.trim();if(!trimmed||trimmed.includes('```'))throw new AiRequestError('AI_OUTPUT_INVALID: exactly one JSON object is required','PARSE',text);let value:unknown;try{value=JSON.parse(trimmed);}catch{throw new AiRequestError('AI_OUTPUT_INVALID: exactly one JSON object is required','PARSE',text);}if(!value||typeof value!=='object'||Array.isArray(value))throw new AiRequestError('AI_OUTPUT_INVALID: decision must be one JSON object','PARSE',text);return value as Record<string,unknown>;}
interface IdentityEntry {expiresAt:number;value:Record<string,unknown>|null;promise:Promise<Record<string,unknown>|null>;}
/** Only these verified LM Studio endpoints use the model-list health protocol. */
const isLocalLmStudio=(baseUrl:string)=>['http://127.0.0.1:1234/v1','http://localhost:1234/v1','http://[::1]:1234/v1']
  .includes(baseUrl.replace(/\/+$/,''));
const isLocalOmlx=(baseUrl:string)=>['http://127.0.0.1:8083/v1','http://localhost:8083/v1','http://[::1]:8083/v1']
  .includes(baseUrl.replace(/\/+$/,''));
const tokenCount=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const secondsToMilliseconds=(value:unknown):number|null=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const milliseconds=Math.round(value*1_000);
  return Number.isSafeInteger(milliseconds)?milliseconds:null;
};
function applyProviderUsage(timing:AiClientTiming,baseUrl:string,providerUsage:any,inputTokens:number|null){
  const cached=tokenCount(providerUsage?.prompt_tokens_details?.cached_tokens);
  timing.cachedInputTokens=cached!==null&&(inputTokens===null||cached<=inputTokens)?cached:null;
  // Verified oMLX Usage extensions are seconds. Keep their provenance separate
  // from client wall/transport measurements; do not infer queue time or TTFT from
  // body arrival, rates, token counts, total_time or missing phase durations.
  if(!isLocalOmlx(baseUrl))return;
  timing.prefillMs=secondsToMilliseconds(providerUsage?.prompt_eval_duration);
  timing.decodeMs=secondsToMilliseconds(providerUsage?.generation_duration);
  timing.firstTokenMs=secondsToMilliseconds(providerUsage?.time_to_first_token);
  timing.providerTimingSource=[timing.prefillMs,timing.decodeMs,timing.firstTokenMs].some(value=>value!==null)?'OMLX_USAGE_SECONDS':null;
}
export class OpenAiCompatibleClient {
  private identities=new Map<string,IdentityEntry>();
  constructor(private apiKey='local'){}
  private identity(baseUrl:string,requestedModel:string){
    // LM Studio has no /props endpoint. A model directory cannot prove quantization,
    // loaded context, template or server build, so leave diagnostic identity unknown.
    if(isLocalLmStudio(baseUrl))return{expiresAt:0,value:null,promise:Promise.resolve(null)} satisfies IdentityEntry;
    const root=baseUrl.replace(/\/+$/,'').replace(/\/v1$/,''),key=JSON.stringify([root,requestedModel]),now=Date.now();
    for(const [name,entry] of this.identities)if(entry.expiresAt<=now)this.identities.delete(name);
    const prior=this.identities.get(key);if(prior)return prior;
    while(this.identities.size>=64)this.identities.delete(this.identities.keys().next().value!);
    const entry:IdentityEntry={expiresAt:now+60_000,value:null,promise:Promise.resolve(null)};
    entry.promise=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2_000);
      try{const response=await abortable(fetch(`${root}/props`,{signal:controller.signal}),controller.signal);
        if(!response.ok)return null;
        const p:any=JSON.parse(await abortable(response.text(),controller.signal)),template=typeof p.chat_template==='string'?p.chat_template:'';
        return {requestedModel,modelAlias:p.model_alias??null,modelPath:p.model_path??null,quantization:p.model_ftype??null,
          contextTokens:p.default_generation_settings?.n_ctx??null,reasoningFormat:p.default_generation_settings?.params?.reasoning_format??null,
          templateSha256:template?createHash('sha256').update(template).digest('hex'):null,serverBuild:p.build_info??null,observedAt:Date.now()};
      }catch{return null;}finally{clearTimeout(timer);}
    })().then(value=>{entry.value=value;if(!value)entry.expiresAt=Math.min(entry.expiresAt,Date.now()+5_000);return value;});
    this.identities.set(key,entry);return entry;
  }
  /** Read-only bounded probe. Its empty-model identity cannot populate a named-model cache entry. */
  async probe(baseUrl:string,timeoutMs=2_000,requestedModel?:string):Promise<{ok:boolean;identity:Record<string,unknown>|null;reason:string|null}>{
    const root=baseUrl.replace(/\/+$/,'').replace(/\/v1$/,''),localLmStudio=isLocalLmStudio(baseUrl),deadlineAt=Date.now()+timeoutMs,
      controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const response=await abortable(fetch(`${root}/${localLmStudio?'v1/models':'health'}`,{signal:controller.signal}),controller.signal);
      if(localLmStudio){
        if(!response.ok)return{ok:false,identity:null,reason:`AI model list HTTP ${response.status}`};
        const text=await abortable(response.text(),controller.signal);
        let value:unknown;try{value=JSON.parse(text);}catch{return{ok:false,identity:null,reason:'AI model list invalid JSON'};}
        if(Date.now()>=deadlineAt){controller.abort();throw controller.signal.reason;}
        const list=value as {object?:unknown;data?:unknown;error?:unknown}|null;
        if(!list||typeof list!=='object'||Array.isArray(list)||'error' in list||list.object!=='list'||!Array.isArray(list.data)||
          !list.data.every(model=>model&&typeof model==='object'&&!Array.isArray(model)&&model.object==='model'&&typeof model.id==='string'&&model.id.trim().length>0))
          return{ok:false,identity:null,reason:'AI model list invalid response structure'};
        if(requestedModel!==undefined&&!list.data.some(model=>model.id===requestedModel))
          return{ok:false,identity:null,reason:`AI configured model unavailable: ${requestedModel}`};
        if(Date.now()>=deadlineAt){controller.abort();throw controller.signal.reason;}
        // Directory availability does not prove that a model is loaded or can infer.
        return{ok:true,identity:null,reason:null};
      }
      if(!response.ok)return{ok:false,identity:null,reason:`AI health HTTP ${response.status}`};
      await abortable(response.text(),controller.signal);
      return{ok:true,identity:await abortable(this.identity(baseUrl,'').promise,controller.signal),reason:null};
    }catch(error){return{ok:false,identity:null,reason:error instanceof Error?error.message:String(error)};}finally{clearTimeout(timer);}
  }
  async runJson<T>(args:{baseUrl:string;model:string;prompt:string;schemaName:string;timeoutMs:number;jsonSchema?:Record<string,unknown>;maxOutputTokens?:number;context?:AiCallContext;parse:(value:unknown)=>T}):Promise<ModelRunResult<T>>{
    // Preserve the verified local 9B/27B final-JSON mode and all output limits.
    const localEntryJson=Boolean(args.jsonSchema)&&
      ['http://127.0.0.1:1234/v1','http://localhost:1234/v1','http://[::1]:1234/v1'].includes(args.baseUrl.replace(/\/$/,''))&&
      ((args.schemaName==='ScoutAnnotation'&&args.model==='qwen/qwen3.5-9b')||
       (args.schemaName==='EntryDecisionV392'&&args.model==='qwen/qwen3.8-27b'));
    const requestOverrides=localEntryJson?{reasoning_effort:'none' as const}:{},startedAt=Date.now();
    const deadline=Math.min(startedAt+args.timeoutMs,args.context?.deadlineAt??Infinity),controller=new AbortController(),timing=emptyTiming();
    let stage:AiRequestStage='REQUEST',cancellation:AiCancellation|null=null,usage:AiRequestError['usage']=null,diagnostics:AiResponseDiagnostics|null=null;
    const abort=(source:AiCancellation['source'])=>{if(!controller.signal.aborted){cancellation={source,requestedAt:Date.now(),backendStatus:'UNKNOWN'};controller.abort(new Error(source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT'));}};
    const onCallerAbort=()=>abort('CALLER');args.context?.signal?.addEventListener('abort',onCallerAbort,{once:true});
    const timer=setTimeout(()=>abort('DEADLINE'),Math.max(0,deadline-Date.now()));
    const check=()=>{if(args.context?.signal?.aborted)abort('CALLER');if(Date.now()>=deadline)abort('DEADLINE');if(controller.signal.aborted)throw controller.signal.reason;};
    const timed=async<R>(field:'responseHeadersMs'|'responseBodyMs'|'parseMs'|'retryMs',work:()=>Promise<R>|R):Promise<R>=>{
      const start=Date.now();timing[field]??=0;
      try{return await work();}finally{const duration=Math.max(0,Date.now()-start);timing[field]!+=duration;
        if(field==='responseHeadersMs'||field==='responseBodyMs')timing.requestMs=(timing.requestMs??0)+duration;}
    };
    const readBody=async(response:Response)=>{
      stage='RESPONSE_BODY';
      return timed('responseBodyMs',async()=>{
        timing.responseBytes??=0;
        const reader=response.body?.getReader();if(!reader)return '';
        const decoder=new TextDecoder();let text='';
        try{while(true){check();const chunk=await abortable(reader.read(),controller.signal);check();if(chunk.done)break;
          timing.responseBytes!+=chunk.value.byteLength;text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();
        }finally{if(controller.signal.aborted)void reader.cancel().catch(()=>{});else reader.releaseLock();}
      });
    };
    const retryWait=async(delay:number)=>{
      stage='RETRY_WAIT';check();
      await timed('retryMs',()=>new Promise<void>((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(waitTimer);controller.signal.removeEventListener('abort',onAbort);};
        const onAbort=()=>{cleanup();reject(controller.signal.reason);};
        const waitTimer=setTimeout(()=>{cleanup();resolve();},Math.min(delay,Math.max(0,deadline-Date.now())));
        controller.signal.addEventListener('abort',onAbort,{once:true});
        if(controller.signal.aborted)onAbort();
      }));check();
    };
    try{
      check();const identity=this.identity(args.baseUrl,args.model);
      let response:Response|undefined,body='';
      for(let attempt=0;attempt<2;attempt++){
        stage='REQUEST';check();timing.transportAttempts!++;
        try{
          response=await timed('responseHeadersMs',()=>abortable(fetch(`${args.baseUrl.replace(/\/$/,'')}/chat/completions`,{
            method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${this.apiKey}`},
            body:JSON.stringify({model:args.model,...requestOverrides,messages:[{role:'user',content:args.prompt}],temperature:.1,stream:false,
              max_tokens:args.maxOutputTokens??900,response_format:args.jsonSchema?{type:'json_schema',json_schema:{name:args.schemaName,strict:true,schema:args.jsonSchema}}:{type:'json_object'}}),signal:controller.signal,
          }).then(candidate=>{if(controller.signal.aborted)void candidate.body?.cancel().catch(()=>{});return candidate;}),controller.signal));
          check();
        }catch(error){check();if(attempt===0){await retryWait(250);continue;}throw error;}
        body=await readBody(response);check();
        if(response.ok)break;
        const httpError=new AiRequestError(`AI HTTP ${response.status}: ${body}`,'REQUEST',body,response.status);
        if(attempt===0&&(response.status>=500||response.status===429)){
          const value=response.headers.get('retry-after'),seconds=value===null?NaN:Number(value);
          await retryWait(Number.isFinite(seconds)&&seconds>=0?seconds*1_000:250);continue;
        }
        throw httpError;
      }
      stage='RESPONSE_JSON';check();
      const result=await timed('parseMs',()=>{
        let raw:any;try{raw=JSON.parse(body);}catch(error){throw new AiRequestError(`AI response JSON parse failed: ${error instanceof Error?error.message:String(error)}`,'RESPONSE_JSON');}
        stage='PARSE';check();
        const finishReason=typeof raw?.choices?.[0]?.finish_reason==='string'?raw.choices[0].finish_reason:null;
        const content=raw?.choices?.[0]?.message?.content,reasoning=raw?.choices?.[0]?.message?.reasoning_content;
        usage={inputTokens:tokenCount(raw?.usage?.prompt_tokens),outputTokens:tokenCount(raw?.usage?.completion_tokens)};
        applyProviderUsage(timing,args.baseUrl,raw?.usage,usage.inputTokens);
        const reasoningTokens=raw?.usage?.completion_tokens_details?.reasoning_tokens;
        diagnostics={finishReason,contentCharacters:typeof content==='string'?content.length:null,reasoningCharacters:typeof reasoning==='string'?reasoning.length:0,
          reasoningTokens:Number.isInteger(reasoningTokens)&&reasoningTokens>=0?reasoningTokens:null};
        const parseError=(message:string)=>new AiRequestError(message,'PARSE',typeof content==='string'?content:null,null,usage,diagnostics);
        if(finishReason==='length')throw parseError('AI_OUTPUT_INVALID: output token limit reached');
        if(typeof content!=='string')throw parseError('AI response content missing');
        if(!content.trim())throw parseError(diagnostics.reasoningCharacters>0?'AI_OUTPUT_INVALID: final content is empty (reasoning-only response)':'AI_OUTPUT_INVALID: final content is empty');
        let parsed:Record<string,unknown>,value:T;
        try{parsed=parseSingleJsonDecision(content);value=args.parse(parsed);}catch(error){check();throw parseError(error instanceof Error?error.message:String(error));}
        check();timing.clientElapsedMs=Math.max(0,Date.now()-startedAt);
        // Diagnostic identity lookup never delays a completed decision; an unresolved lookup remains unknown.
        return{value,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,finishReason,modelIdentity:identity.value,
          raw:{...raw,__zdjParsedDecision:parsed,...(localEntryJson?{__zdjRequestOverrides:requestOverrides}:{})},timing};
      });
      check();timing.clientElapsedMs=Math.max(0,Date.now()-startedAt);return result;
    }catch(error){
      // A synchronous parser/body failure can outrun the timer callback; the absolute
      // deadline and caller signal still decide whether this result is usable.
      if(args.context?.signal?.aborted)abort('CALLER');if(Date.now()>=deadline)abort('DEADLINE');
      const source=cancellation?.source;
      const failure=source?new AiRequestError(`${source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT'}: ${stage}`,stage,null,null,usage,diagnostics)
        :error instanceof AiRequestError?error:new AiRequestError(error instanceof Error?error.message:String(error),stage,null,null,usage,diagnostics);
      if(source){failure.errorCode=source==='CALLER'?'AI_CANCELLED':'AI_TIMEOUT';failure.cancelled=source==='CALLER';failure.timeout=source==='DEADLINE';failure.cancellation=cancellation;}
      timing.clientElapsedMs=Math.max(0,Date.now()-startedAt);failure.timing={...timing};failure.requestContextId=args.context?.requestId;throw failure;
    }finally{clearTimeout(timer);args.context?.signal?.removeEventListener('abort',onCallerAbort);}
  }
}

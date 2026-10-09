import {createHash} from 'node:crypto';

export interface PromptBudget {
  status:'READY'|'UNAVAILABLE'|'EXCEEDED';
  inputTokens:number|null;
  inputBudget:number|null;
  contextTokens:number|null;
  outputReserve:number;
  templateSafetyReserve:number;
  modelAlias:string|null;
  templateSha256:string|null;
  promptSha256:string;
  reason:string|null;
  actualUsageInputTokens?:number|null;
  actualUsageOutputTokens?:number|null;
  usageDelta?:number|null;
}
export class PromptBudgetError extends Error {
  constructor(readonly budget:PromptBudget){super(`PROMPT_BUDGET_UNAVAILABLE:${budget.reason}`);this.name='PromptBudgetError';}
}

/** Native llama template/tokenizer only. Character counts never authorize inference. */
export async function measurePromptBudget(args:{baseUrl:string;model:string;prompt:string;maxOutputTokens:number;timeoutMs:number;disableThinking?:boolean}):Promise<PromptBudget>{
  const root=args.baseUrl.replace(/\/$/,'').replace(/\/v1$/,'');
  const signal=AbortSignal.timeout(Math.max(1,Math.min(args.timeoutMs,10_000)));
  const budget:PromptBudget={status:'UNAVAILABLE',inputTokens:null,inputBudget:null,contextTokens:null,outputReserve:args.maxOutputTokens,templateSafetyReserve:512,modelAlias:null,templateSha256:null,promptSha256:createHash('sha256').update(args.prompt).digest('hex'),reason:null};
  const read=async(path:string,body?:unknown)=>{const response=await fetch(`${root}${path}`,{signal,...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});if(!response.ok)throw new Error(`${path}:HTTP_${response.status}`);return await response.json() as any;};
  try{
    const props=await read('/props');
    budget.contextTokens=props.default_generation_settings?.n_ctx;
    budget.modelAlias=props.model_alias??null;
    if(!Number.isSafeInteger(budget.contextTokens)||Number(budget.contextTokens)<=0||budget.modelAlias!==args.model||typeof props.chat_template!=='string'||!props.chat_template)throw new Error('MODEL_CONTEXT_OR_ALIAS_OR_TEMPLATE_UNVERIFIED');
    budget.templateSha256=createHash('sha256').update(props.chat_template).digest('hex');
    budget.inputBudget=Math.min(28_000,Number(budget.contextTokens)-budget.outputReserve-budget.templateSafetyReserve);
    const rendered=await read('/apply-template',{messages:[{role:'user',content:args.prompt}],add_generation_prompt:true,...(args.disableThinking?{chat_template_kwargs:{enable_thinking:false}}:{})});
    if(typeof rendered.prompt!=='string'||!rendered.prompt)throw new Error('CHAT_TEMPLATE_UNAVAILABLE');
    const result=await read('/tokenize',{content:rendered.prompt,add_special:true,parse_special:true});
    if(!Array.isArray(result.tokens)||!result.tokens.length||!result.tokens.every((token:unknown)=>Number.isSafeInteger(token)))throw new Error('TOKENIZER_UNAVAILABLE');
    budget.inputTokens=result.tokens.length;
    budget.status=budget.inputTokens!<=budget.inputBudget ? 'READY':'EXCEEDED';
    budget.reason=budget.status==='READY'?null:'INPUT_EXCEEDS_VERIFIED_BUDGET';
    // Recheck template/context after tokenization; never accept a switched server identity.
    const after=await read('/props');
    if(after.model_alias!==budget.modelAlias||after.default_generation_settings?.n_ctx!==budget.contextTokens||createHash('sha256').update(String(after.chat_template??'')).digest('hex')!==budget.templateSha256)throw new Error('MODEL_IDENTITY_CHANGED');
  }catch(error){budget.status='UNAVAILABLE';budget.reason=error instanceof Error?error.message:String(error);}
  if(budget.status!=='READY')throw new PromptBudgetError(budget);
  return budget;
}

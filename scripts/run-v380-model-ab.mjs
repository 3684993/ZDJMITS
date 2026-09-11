import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const endpoint=process.env.ZDJ_AB_ENDPOINT??'http://127.0.0.1:8083/v1';
const sampleCount=300,batchSize=10;
const modes=[
  {id:'reasoning_off',thinking:false,maxTokens:512},
  {id:'thinking_cap_512',thinking:true,maxTokens:512},
  {id:'thinking_cap_1024',thinking:true,maxTokens:1024},
];
const trends=['UP','DOWN','RANGE'],timings=['REACHABLE','WAIT'];
const fixtures=Array.from({length:sampleCount},(_,i)=>{const trend=trends[i%3],timing=timings[Math.floor(i/3)%2],counter=trend==='UP'?'DOWN':trend==='DOWN'?'UP':i%2?'UP':'DOWN',imbalance=[-.35,0,.35][Math.floor(i/6)%3];return{id:`F${String(i+1).padStart(3,'0')}`,closed15m:trend,timing1m:counter,timing5m:i%4<2?counter:trend,priceTiming:timing,imbalance,allowedDirections:['LONG','SHORT']};});
const expected=f=>f.closed15m==='RANGE'?{direction:null,decision:'NO_DIRECTION_EDGE'}:{direction:f.closed15m==='UP'?'LONG':'SHORT',decision:f.priceTiming==='REACHABLE'?`PLACE_${f.closed15m==='UP'?'LONG':'SHORT'}`:'WAIT_FOR_PRICE'};
const itemSchema={type:'object',additionalProperties:false,required:['id','direction','decision'],properties:{id:{type:'string'},direction:{enum:['LONG','SHORT']},decision:{enum:['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE','NO_DIRECTION_EDGE']}}};
const report={protocol:'V3.8.0',endpoint,sampleCount,batchSize,startedAt:new Date().toISOString(),modes:{},fixturesShaInput:'deterministic-v1'};
const root=endpoint.replace(/\/$/,'').replace(/\/v1$/,'');
try{const props=await(await fetch(`${root}/props`)).json();report.server={modelAlias:props.model_alias,modelPath:props.model_path,quantization:props.model_ftype,contextTokens:props.default_generation_settings?.n_ctx,reasoningFormat:props.default_generation_settings?.params?.reasoning_format,build:props.build_info};}catch{report.server=null;}

async function persist(){await mkdir(path.resolve('docs/reports'),{recursive:true});await writeFile(path.resolve('docs/reports/v380-model-ab-current.json'),JSON.stringify(report,null,2));}
for(const mode of modes){
  const result={validJson:0,semanticPass:0,finishStop:0,failed:0,inputTokens:0,outputTokens:0,latencyMs:0,batches:[]};report.modes[mode.id]=result;
  for(let offset=0;offset<fixtures.length;offset+=batchSize){
    const cases=fixtures.slice(offset,offset+batchSize),schema={type:'array',minItems:cases.length,maxItems:cases.length,items:itemSchema};
    const prompt=`Protocol V3.8.0 deterministic audit. For every case: confirmed closed 15m is the sole direction authority; UP=LONG, DOWN=SHORT, RANGE=NO_DIRECTION_EDGE. 1m/5m and imbalance are timing/context only. If direction exists and priceTiming=REACHABLE choose matching PLACE; if WAIT choose WAIT_FOR_PRICE. Return all IDs exactly once as the schema array. CASES:${JSON.stringify(cases)}`;
    const body={model:'qwen/qwen3.8-27b',messages:[{role:'user',content:prompt}],temperature:0,seed:380,response_format:{type:'json_schema',json_schema:{name:'v380_batch',strict:true,schema}},chat_template_kwargs:{enable_thinking:mode.thinking},max_tokens:mode.maxTokens};
    const started=Date.now(),batch={offset,count:cases.length,status:'FAILED',finish:null,valid:0,semantic:0,error:null};
    try{
      const response=await fetch(`${endpoint.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180_000)}),raw=await response.text();
      if(!response.ok)throw new Error(`HTTP_${response.status}:${raw.slice(0,300)}`);const json=JSON.parse(raw),choice=json.choices?.[0],content=choice?.message?.content;batch.finish=choice?.finish_reason??null;if(batch.finish==='stop'){result.finishStop+=cases.length;}
      const values=JSON.parse(content);if(!Array.isArray(values)||values.length!==cases.length)throw new Error('OUTPUT_COUNT_MISMATCH');
      const byId=new Map(values.map(v=>[v?.id,v]));for(const f of cases){const v=byId.get(f.id);if(v&&['LONG','SHORT'].includes(v.direction)&&['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE','NO_DIRECTION_EDGE'].includes(v.decision)){batch.valid++;result.validJson++;const e=expected(f);if((e.direction===null||v.direction===e.direction)&&v.decision===e.decision){batch.semantic++;result.semanticPass++;}}}
      result.inputTokens+=Number(json.usage?.prompt_tokens??0);result.outputTokens+=Number(json.usage?.completion_tokens??0);batch.status='COMPLETED';
    }catch(error){batch.error=error instanceof Error?error.message:String(error);result.failed+=cases.length;}
    const elapsed=Date.now()-started;batch.latencyMs=elapsed;result.latencyMs+=elapsed;result.batches.push(batch);await persist();console.log(JSON.stringify({mode:mode.id,completed:offset+cases.length,...batch}));
  }
}
report.completedAt=new Date().toISOString();for(const result of Object.values(report.modes)){result.validJsonRate=result.validJson/sampleCount;result.semanticPassRate=result.semanticPass/sampleCount;result.finishStopRate=result.finishStop/sampleCount;result.meanLatencyMs=result.latencyMs/(sampleCount/batchSize);}await persist();console.log(JSON.stringify({done:true,report:path.resolve('docs/reports/v380-model-ab-current.json'),modes:report.modes},null,2));

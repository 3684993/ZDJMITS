import { createHash } from 'node:crypto';
import { AiRunSchema, EntryDecisionV370Schema, EntryDecisionJsonSchema, ScoutAnnotationJsonSchema, BrainDecisionSchema, ScoutAnnotationSchema, type AiResource, type AiRun, type BrainDecision, type EntryIntelligencePacket, type ScoutAnnotation } from '@zdj/contracts';
import { buildCompactBrainPrompt, buildScoutPrompt, compactFactIds, clamp, uid } from '@zdj/core';
import { AiRequestError, OpenAiCompatibleClient, parseSingleJsonDecision } from '../adapters/ai/OpenAiCompatibleClient.js';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import type { EipService } from './eipService.js';
import { redactAudit } from '../api/projections.js';
import { normalizeAiProtocol, type ProtocolNormalization } from './aiProtocolNormalizer.js';
import type {ExternalIntelligenceSnapshot} from './externalIntelligenceService.js';
import {buildExternalResearchPrompt,externalResearchJsonSchema,verifyExternalResearch,materializeExternalResearch} from './externalResearchQuality.js';
import {buildPositionReviewPrompt,parsePositionReview,type PositionReviewRequest,type PositionReviewVerdict} from './positionReviewPrompt.js';

interface ResourceLoad {
  active:number; totalRuns:number; failures:number; lastLatencyMs:number|null;
  currentSymbol:string|null; currentRunId:string|null; currentStartedAt:number|null;
  lastCompletedAt:number|null; lastDirection:'LONG'|'SHORT'|null;
  lastDecision:BrainDecision['decision'];
  idleReason:string|null; nextStep:string; queueDepth:number;
}
const textList=(value:unknown)=>Array.isArray(value)?value.map(item=>typeof item==='string'?item:typeof item==='object'&&item!==null?String((item as any).text??(item as any).value??(item as any).evidence??JSON.stringify(item)):String(item)):[];
const finite=(value:unknown,fallback:number)=>Number.isFinite(Number(value))?Number(value):fallback;
const scoutParse=(value:unknown)=>{const normalized=normalizeAiProtocol(value,['attentionScore']),v=normalized.value as any;return ScoutAnnotationSchema.parse({...v,keyEvidence:textList(v?.keyEvidence).slice(0,6),contradictions:textList(v?.contradictions).slice(0,4),missingEvidence:textList(v?.missingEvidence).slice(0,4)});};
export type ExternalResearchFact={field:string;value:string|number|boolean|null;unit:string|null;observedAt:number;evidenceLocation:string;conflict:string|null};
export type ExternalResearchResult={sourceId:string;entities:string[];facts:ExternalResearchFact[];conflicts:string[]};
export const ExternalResearchJsonSchema={type:'object',additionalProperties:false,required:['sourceId','entities','facts','conflicts'],properties:{sourceId:{type:'string'},entities:{type:'array',maxItems:12,items:{type:'string'}},facts:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['field','value','unit','observedAt','evidenceLocation','conflict'],properties:{field:{type:'string'},value:{type:['string','number','boolean','null']},unit:{type:['string','null']},observedAt:{type:'integer'},evidenceLocation:{type:'string'},conflict:{type:['string','null']}}}},conflicts:{type:'array',maxItems:5,items:{type:'string'}}}} as unknown as Record<string,unknown>;
export function parseExternalResearch(value:unknown,sourceId:string):ExternalResearchResult{
  const v=value as any;if(!v||typeof v!=='object'||v.sourceId!==sourceId||!Array.isArray(v.facts)||v.facts.length>5)throw new Error('RESEARCH_OUTPUT_INVALID');
  const facts=v.facts.map((fact:any)=>{if(!fact||typeof fact.field!=='string'||(!['string','number','boolean'].includes(typeof fact.value)&&fact.value!==null)||!Number.isFinite(Number(fact.observedAt))||typeof fact.evidenceLocation!=='string')throw new Error('RESEARCH_FACT_INVALID');return{field:fact.field.slice(0,80),value:fact.value,unit:typeof fact.unit==='string'?fact.unit.slice(0,30):null,observedAt:Number(fact.observedAt),evidenceLocation:fact.evidenceLocation.slice(0,300),conflict:typeof fact.conflict==='string'?fact.conflict.slice(0,300):null};});
  return{sourceId,entities:textList(v.entities).slice(0,12),facts,conflicts:textList(v.conflicts).slice(0,5)};
}

/** Diagnostic display only. Never used to choose or reject Primary tradeSide. */
export function fifteenMinuteDirection(packet:EntryIntelligencePacket):'LONG'|'SHORT'|null{
  const trend=packet.market.technical['15m'].trend;return trend==='UP'?'LONG':trend==='DOWN'?'SHORT':null;
}

export function entryDecisionParse(value:unknown,packet:EntryIntelligencePacket):BrainDecision {
  const normalized=normalizeAiProtocol(value,['confidence']);
  const raw:any={...(normalized.value as any)}, legacyDirection=raw.direction, place=String(raw.decision??'').startsWith('PLACE_');
  raw.tradeSide=raw.tradeSide??(place?(legacyDirection??String(raw.decision).replace('PLACE_','')):null);
  // structureDirection is model-owned compatibility metadata. Never inject 15m as an answer key.
  raw.structureDirection=raw.structureDirection??(place?raw.tradeSide:null);
  raw.profitTakePlan=place?(raw.profitTakePlan??null):null;
  raw.rejectLayer=raw.rejectLayer??(raw.decision==='WAIT_FOR_PRICE'?'TIMING':raw.decision==='NO_DIRECTION_EDGE'?'TIMING':'NONE');
  raw.blockingCondition=raw.blockingCondition??(place?'':String(raw.reason??''));raw.releaseCondition=raw.releaseCondition??'';raw.timingEvent=raw.timingEvent??null;
  raw.direction=place?raw.tradeSide:null; const d=EntryDecisionV370Schema.parse(raw);
  // Parser validates protocol/factual integrity only. Direction permissions and
  // deterministic opportunity side are execution concerns; they must never
  // rewrite or invalidate the model's directional conclusion.
  const validIds=new Set(compactFactIds(packet));
  if(d.supportingEvidenceRefs.some(id=>!validIds.has(id)))throw new Error('AI_OUTPUT_INVALID: unknown supportingEvidenceRefs');
  const prose=`${d.directionReason} ${d.timingReason} ${(d as any).entryLocationReason??''} ${d.reason}`;
  if(packet.microstructure.imbalance<-.05&&/bid (?:dominance|imbalance)|buyer(?:s)? dominant/i.test(prose))throw new Error('AI_OUTPUT_INVALID: order-book imbalance sign misread');
  if(packet.microstructure.imbalance>.05&&/ask (?:dominance|imbalance)|seller(?:s)? dominant/i.test(prose))throw new Error('AI_OUTPUT_INVALID: order-book imbalance sign misread');
  const result=BrainDecisionSchema.parse({...d,direction:place?d.tradeSide:null,protocolVersion:'V3.9.3',reachability:0,
    directionAnalysis:{trend1m:d.timingReason,trend5m:d.timingReason,trend15m:d.directionReason,trend4h:d.directionReason,trend1d:d.directionReason,trend1w:d.directionReason,weightedConclusion:d.directionReason},
    supportingEvidence:[],contradictions:[],missingEvidence:[],evidenceRefs:d.supportingEvidenceRefs,evidenceRequests:[]});
  (result as any).__protocolNormalization=normalized.normalization;
  return result;
}

export function brainParse(value:unknown,packet?:EntryIntelligencePacket):BrainDecision{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Brain output must be a JSON object');
  const normalized=normalizeAiProtocol(value),v={...(normalized.value as any)};
  if(['PLACE_LONG','PLACE_SHORT','REJECT_CANDIDATE'].includes(v.action)){v.decision=v.action;v.action='FINAL';}
  v.action=v.action??'FINAL';
  if(typeof v.direction==='string')v.direction=v.direction.toUpperCase();
  for(const key of ['supportingEvidence','contradictions','missingEvidence','evidenceRefs','supportingEvidenceRefs'])v[key]=textList(v[key]);
  v.longException=Boolean(v.longException);v.longExceptionReason=typeof v.longExceptionReason==='string'?v.longExceptionReason:null;v.altLongQuality=v.altLongQuality==null?null:Math.max(0,Math.min(100,finite(v.altLongQuality,0)));
  if(!Array.isArray(v.evidenceRequests))v.evidenceRequests=[];
  if(v.action==='FINAL')v.evidenceRequests=[];
  const analysis=v.directionAnalysis,required=['trend1m','trend5m','trend15m','trend4h','trend1d','trend1w','weightedConclusion'];
  if(packet&&(!analysis||typeof analysis!=='object'||required.some(key=>typeof analysis[key]!=='string'))){const rawAnalysis=typeof analysis==='string'?analysis:analysis?JSON.stringify(analysis):'';v.directionAnalysis={trend1m:`${packet.market.technical['1m'].trend}; evidence only`,trend5m:`${packet.market.technical['5m'].trend}; evidence only`,trend15m:`${packet.market.technical['15m'].trend}; evidence only`,trend4h:`${packet.market.technical['4h'].trend}; evidence only`,trend1d:`${packet.market.technical['1d'].trend}; evidence only`,trend1w:`${packet.market.technical['1w'].trend}; evidence only`,weightedConclusion:rawAnalysis||String(v.reason??'MODEL_DIRECTION_UNMODIFIED')};}
  if(Array.isArray(v.acceptablePriceRange)&&v.acceptablePriceRange.length>=2){const a=Number(v.acceptablePriceRange[0]),b=Number(v.acceptablePriceRange[1]);if(Number.isFinite(a)&&Number.isFinite(b))v.acceptablePriceRange={min:Math.min(a,b),max:Math.max(a,b)};}
  if(v.action==='FINAL'&&v.decision==='REJECT_CANDIDATE'){
    v.confidence=finite(v.confidence,0);v.idealPrice=null;v.acceptablePriceRange=null;v.horizonMinutes=null;v.reachability=finite(v.reachability,0);
    v.entryInvalidation=typeof v.entryInvalidation==='string'?v.entryInvalidation:'Candidate rejected by Primary Brain';
    v.reason=typeof v.reason==='string'?v.reason:'PRIMARY_BRAIN rejected candidate';
  }
  const isPlace=v.decision==='PLACE_LONG'||v.decision==='PLACE_SHORT';
  v.tradeSide=v.tradeSide??(isPlace?(v.direction??String(v.decision).replace('PLACE_','')):null);
  v.structureDirection=v.structureDirection??(isPlace?v.tradeSide:null);
  v.direction=isPlace?v.tradeSide:null;
  if(!isPlace){v.profitTakePlan=null;v.idealPrice=null;v.acceptablePriceRange=null;v.horizonMinutes=null;}
  v.rejectLayer=v.rejectLayer??(v.decision==='WAIT_FOR_PRICE'?'TIMING':v.decision==='NO_DIRECTION_EDGE'||v.decision==='REJECT_CANDIDATE'?'TIMING':'NONE');
  v.blockingCondition=v.blockingCondition??String(v.reason??'');v.releaseCondition=v.releaseCondition??'';v.timingEvent=v.timingEvent??null;
  if(v.action==='FINAL'&&(v.decision==='PLACE_LONG'||v.decision==='PLACE_SHORT')){
    // A price/range is executable intent supplied by the model. Do not infer it.
    v.confidence=finite(v.confidence,NaN);v.reachability=finite(v.reachability,NaN);
  }
  const decision=BrainDecisionSchema.parse(v);
  (decision as any).__protocolNormalization=normalized.normalization;
  return decision;
}

export function rawIntent(outputPreview:string|undefined){
  try{
    const wrapper=JSON.parse(outputPreview??'{}');if(wrapper?.__zdjParsedDecision&&typeof wrapper.__zdjParsedDecision==='object')return wrapper.__zdjParsedDecision;const content=wrapper?.choices?.[0]?.message?.content??(typeof wrapper==='string'?wrapper:undefined);
    if(content===undefined&&wrapper&&typeof wrapper==='object')return wrapper;
    if(typeof content!=='string')return null;
    return parseSingleJsonDecision(content);
  }catch{return null;}
}

export class AiFabric {
  private load=new Map<string,ResourceLoad>();
  private openAi=new OpenAiCompatibleClient();
  private primaryFailureStreak=0;
  private primaryCircuitOpenUntil=0;
  private primaryCircuitReason:string|null=null;
  private primaryCircuitState: 'AVAILABLE' | 'OPEN' | 'PROBING' | 'HALF_OPEN' = 'AVAILABLE';
  private primaryProbe:Promise<boolean>|null=null;
  constructor(private state:RuntimeState,private events:EventBus,private eipService:EipService){
    for(const r of state.aiResources)this.load.set(r.id,{active:0,totalRuns:0,failures:0,lastLatencyMs:null,currentSymbol:null,currentRunId:null,currentStartedAt:null,lastCompletedAt:null,lastDirection:null,lastDecision:null,idleReason:'WAITING_CANDIDATE',nextStep:'等待动态交易池候选',queueDepth:0});
  }

  private endpointHealth=new Map<string,{available:boolean;checkedAt:number;reason:string|null}>();
  private healthFlight:Promise<void>|null=null;
  async probeResources(){
    if(this.healthFlight)return this.healthFlight;
    this.healthFlight=Promise.all(this.state.aiResources.map(async r=>{
      const result=await this.openAi.probe(r.baseUrl,2000).catch(error=>({ok:false,reason:String(error)}));
      const previous=this.endpointHealth.get(r.id),next={available:result.ok,checkedAt:Date.now(),reason:result.reason};this.endpointHealth.set(r.id,next);
      if(previous?.available!==next.available)this.events.publish('AI_RESOURCE_HEALTH_CHANGED',{resourceId:r.id,role:r.role,...next,entryRequired:r.role==='PRIMARY_BRAIN'});
    })).then(()=>{}).finally(()=>{this.healthFlight=null;});return this.healthFlight;
  }
  private resourceHealth(r:any):any{
    const h=this.endpointHealth.get(r.id),fresh=h&&Date.now()-h.checkedAt<60000;
    const connectionStatus=!fresh?'UNKNOWN':h.available?'ONLINE':'OFFLINE';
    return {connectionStatus,healthCheckedAt:h?.checkedAt??null,healthReason:h?.reason??null,...(connectionStatus==='ONLINE'?{}:{status:connectionStatus==='OFFLINE'?'OFFLINE':'DEGRADED'}),...(connectionStatus==='OFFLINE'?{currentStatus:'DEGRADED',idleReason:r.role==='PRIMARY_BRAIN'?'PRIMARY_MODEL_OFFLINE':'OPTIONAL_RESEARCH_OFFLINE',nextStep:r.role==='PRIMARY_BRAIN'?'Primary 模型离线；新建仓等待，订单与持仓维护继续':'研究模型离线；单 Primary 可独立建仓'}:{})};
  }
  private endpointAvailable(id:string){const h=this.endpointHealth.get(id);return !h||h.available&&Date.now()-h.checkedAt<60000;}
  resourceMetrics(){const now=Date.now(),paused=this.state.runtimeControl.mode!=='RUNNING';return this.state.aiResources.map(r=>{const m=this.load.get(r.id)!;if(r.role==='SCOUT'){const enabled=this.state.settings.externalIntelligence.researchEnabled,dutyStatus=!enabled?'DISABLED':m.active?'RUNNING':m.idleReason==='RESEARCH_FAILED'?'FAILED':m.queueDepth>0?'QUEUED':'WAITING_SHARED_EVENT';return{...r,active:m.active,totalRuns:m.totalRuns,failures:m.failures,lastLatencyMs:m.lastLatencyMs,currentStatus:dutyStatus,currentSymbol:m.currentSymbol,currentRunId:m.currentRunId,currentRunSeconds:m.currentStartedAt?Math.max(0,Math.floor((now-m.currentStartedAt)/1000)):0,lastCompletedAt:m.lastCompletedAt,lastDirection:null,lastDecision:null,idleReason:dutyStatus,nextStep:!enabled?'研究职责未启用':dutyStatus==='RUNNING'?`正在抽取 ${m.currentSymbol}`:dutyStatus==='QUEUED'?'等待共享事件研究队列':'等待新的共享外部事件',queueDepth:enabled?m.queueDepth:0};}return{...r,active:m.active,totalRuns:m.totalRuns,failures:m.failures,lastLatencyMs:m.lastLatencyMs,currentStatus:m.active?'ANALYZING':paused?'PAUSED':m.failures&&m.lastCompletedAt&&now-m.lastCompletedAt<60_000?'DEGRADED':'IDLE',currentSymbol:m.currentSymbol,currentRunId:m.currentRunId,currentRunSeconds:m.currentStartedAt?Math.max(0,Math.floor((now-m.currentStartedAt)/1000)):0,lastCompletedAt:m.lastCompletedAt,lastDirection:m.lastDirection,lastDecision:m.lastDecision,idleReason:m.active?null:paused?this.state.runtimeControl.reasonText:m.idleReason,nextStep:m.active?`正在处理 ${m.currentSymbol}`:paused?'等待运行恢复':m.nextStep,queueDepth:m.queueDepth};}).map(row=>({...row,...this.resourceHealth(row)}));}
  setResearchQueue(depth:number){for(const r of this.state.aiResources.filter(x=>x.role==='SCOUT')){const m=this.load.get(r.id)!;m.queueDepth=depth;m.idleReason=depth?'RESEARCH_QUEUED':'WAITING_SHARED_EVENT';m.nextStep=depth?'等待共享事件事实抽取':'等待新的共享外部事件';}}
  setIdleContext(reason:string,queueDepth:number,nextStep:string){for(const r of this.state.aiResources.filter(x=>x.role==='PRIMARY_BRAIN')){const m=this.load.get(r.id)!;m.idleReason=reason;m.queueDepth=queueDepth;m.nextStep=nextStep;}}
  isCircuitOpen(role: 'SCOUT' | 'PRIMARY_BRAIN') {
    return role === 'PRIMARY_BRAIN' && (this.primaryCircuitState === 'OPEN' || this.primaryCircuitState === 'PROBING' || this.primaryCircuitOpenUntil > Date.now());
  }
  circuitStatus(){return{state:this.primaryCircuitState,failureStreak:this.primaryFailureStreak,nextProbeAt:this.primaryCircuitOpenUntil,reason:this.primaryCircuitReason};}
  /** Performs at most one bounded GET /health probe when the circuit is due.
   * It does not create an authorization, completion, or Engine lifecycle action. */
  async probePrimaryIfDue(now=Date.now()):Promise<boolean>{
    if(this.primaryCircuitState==='AVAILABLE'||this.primaryCircuitState==='HALF_OPEN')return this.primaryCircuitState==='HALF_OPEN';
    if(this.primaryCircuitState==='OPEN'&&now<this.primaryCircuitOpenUntil)return false;
    if(this.primaryProbe)return this.primaryProbe;
    const resource=this.state.aiResources.find(r=>r.role==='PRIMARY_BRAIN'&&r.status!=='OFFLINE');
    if(!resource)return false;
    this.primaryCircuitState='PROBING';
    this.primaryProbe=this.openAi.probe(resource.baseUrl,2_000).then(result=>{
      if(result.ok){this.primaryCircuitState='HALF_OPEN';this.events.publish('AI_PRIMARY_CIRCUIT_HALF_OPEN',{resourceId:resource.id,identity:result.identity,nextStep:'one fresh Primary only'});return true;}
      this.recordPrimaryFailure(result.reason??'AI health probe failed',true);return false;
    }).finally(()=>{this.primaryProbe=null;});
    return this.primaryProbe;
  }
  private recordPrimaryFailure(message:string,probe=false){
    this.primaryFailureStreak++;
    if(this.primaryFailureStreak<3){this.primaryCircuitState='AVAILABLE';return;}
    const backoffMs=Math.min(300_000,30_000*2**Math.min(this.primaryFailureStreak-3,4));
    this.primaryCircuitOpenUntil=Date.now()+backoffMs;this.primaryCircuitReason=message.slice(0,160);this.primaryCircuitState='OPEN';
    this.events.publish('AI_PRIMARY_CIRCUIT_OPEN',{failureStreak:this.primaryFailureStreak,backoffMs,reason:this.primaryCircuitReason,probe,dispatchPaused:true});
  }
  hasCapacity(role:'SCOUT'|'PRIMARY_BRAIN'){
    if(this.isCircuitOpen(role))return false;
    if(role==='PRIMARY_BRAIN'&&this.primaryCircuitState==='HALF_OPEN'&&this.load.get(this.state.aiResources.find(r=>r.role==='PRIMARY_BRAIN')?.id??'')?.active)return false;
    return this.state.aiResources.some(r=>r.role===role&&r.status!=='OFFLINE'&&this.endpointAvailable(r.id)&&(this.load.get(r.id)?.active??0)<r.maxConcurrency);
  }
  private choose(role:'SCOUT'|'PRIMARY_BRAIN',excludeId?:string):AiResource{
    const choices=this.state.aiResources.filter(r=>r.role===role&&r.status!=='OFFLINE'&&this.endpointAvailable(r.id)&&r.id!==excludeId&&(this.load.get(r.id)?.active??0)<r.maxConcurrency);if(!choices.length)throw new Error(`AI_RESOURCE_BUSY:${role}`);
    return [...choices].sort((a,b)=>(this.load.get(a.id)?.active??0)-(this.load.get(b.id)?.active??0)||(this.load.get(a.id)?.lastLatencyMs??0)-(this.load.get(b.id)?.lastLatencyMs??0))[0]!;
  }
  private async run<T>(args:{resource:AiResource;symbol:string;packet:EntryIntelligencePacket;role:'SCOUT'|'PRIMARY_BRAIN'|'REVIEW_BRAIN';prompt:string;schemaName:string;parse:(v:unknown)=>T;queueMs?:number;triggerReason?:string}):Promise<{value:T;run:AiRun}>{
    const startedAt=Date.now(),runId=uid('airun'),load=this.load.get(args.resource.id)!;load.active++;load.currentSymbol=args.symbol;load.currentRunId=runId;load.currentStartedAt=startedAt;args.resource.status='BUSY';
    let run:AiRun=AiRunSchema.parse({id:runId,symbol:args.symbol,resourceId:args.resource.id,model:args.resource.model,role:args.role,startedAt,completedAt:null,latencyMs:null,inputTokens:null,outputTokens:null,finishReason:null,status:'RUNNING',direction:null,decision:null,packetId:args.packet.packetId,error:null,inputPreview:redactAudit({prompt:args.prompt,packet:args.packet},Infinity),requestSource:args.role==='REVIEW_BRAIN'?'REVIEW':'ENTRY',inputContractHash:createHash('sha256').update(JSON.stringify(args.packet)).digest('hex'),promptHash:createHash('sha256').update(args.prompt).digest('hex'),outputContractVersion:'V3.9.3',timing:{queueMs:args.queueMs??0,promptBuildMs:0,requestMs:0,retryMs:0,parseMs:0,totalMs:0},failure:null});const lifecycle=this.state.candidateLifecycle.get(args.symbol);Object.assign(run,{triggerReason:args.triggerReason??lifecycle?.confirmation?.trigger??lifecycle?.triggerReason??'FIRST_REVIEW',previousRunId:lifecycle?.previousRunId??null,runKind:args.role==='SCOUT'?'SCOUT_ENTRY_INFERENCE':args.role==='REVIEW_BRAIN'?'POSITION_REVIEW_RUN':'PRIMARY_INFERENCE_RUN',recordKind:args.role==='REVIEW_BRAIN'?'POSITION_REVIEW_RUN':'PRIMARY_INFERENCE_RUN',marketOpportunityEpisodeId:args.packet.opportunityEvidence?.opportunityId??null,opportunityVersion:args.packet.opportunityEvidence?.version??null});this.state.addAiRun(run);this.events.publish('AI_RUN_STARTED',run,args.symbol);
    try{
    const isEntry=args.schemaName==='EntryDecisionV392';
      const result=await this.openAi.runJson({baseUrl:args.resource.baseUrl,model:args.resource.model,prompt:args.prompt,schemaName:args.schemaName,timeoutMs:this.state.settings.ai.decisionTimeoutMs,jsonSchema:isEntry?EntryDecisionJsonSchema as unknown as Record<string,unknown>:args.role==='SCOUT'?ScoutAnnotationJsonSchema as unknown as Record<string,unknown>:undefined,maxOutputTokens:isEntry?900:600,parse:args.parse});const completedAt=Date.now();
      if(args.role==='PRIMARY_BRAIN'){this.primaryFailureStreak=0;this.primaryCircuitOpenUntil=0;this.primaryCircuitReason=null;this.primaryCircuitState='AVAILABLE';}
      const protocolNormalization=(result.value as any)?.__protocolNormalization as ProtocolNormalization|undefined;
      if((result.value as any)?.__protocolNormalization)delete (result.value as any).__protocolNormalization;
      const raw=rawIntent(JSON.stringify(result.raw));
      run={...run,rawDirection:raw?.direction??null,rawDecision:raw?.decision??raw?.action??null,terminalStage:'SCHEMA_VALID',completedAt,latencyMs:completedAt-startedAt,inputTokens:result.inputTokens,outputTokens:result.outputTokens,finishReason:result.finishReason,modelIdentity:result.modelIdentity,status:'COMPLETED',decision:(result.value as any)?.decision??null,direction:(result.value as any)?.direction??null,outputPreview:redactAudit(result.raw,Infinity),normalizedPreview:redactAudit(result.value,50000),protocolNormalization,scoutHandoff:args.role==='SCOUT',timing:{queueMs:args.queueMs??0,promptBuildMs:0,...result.timing,totalMs:completedAt-startedAt}};Object.assign(this.state.aiRuns.find(x=>x.id===runId)!,run);load.totalRuns++;load.lastLatencyMs=run.latencyMs;load.lastCompletedAt=completedAt;this.events.publish('AI_RUN_COMPLETED',run,args.symbol);if(protocolNormalization?.applied)this.events.publish('AI_PROTOCOL_NORMALIZED',{runId,normalization:protocolNormalization},args.symbol);return{value:result.value,run};
    }catch(error){
      const completedAt=Date.now(),message=error instanceof Error?error.message:String(error),known=error instanceof AiRequestError,http=known?error.httpStatus:Number(message.match(/AI HTTP (\d+)/)?.[1]??0)||null,schema=known?error.stage==='PARSE':/valid JSON|Zod|expected|required/i.test(message);
      const raw=known?rawIntent(error.rawOutput??undefined):null;
      run={...run,rawDirection:raw?.direction??null,rawDecision:raw?.decision??raw?.action??null,terminalStage:schema?'AI_OUTPUT_INVALID':'AI_FAILED',inputTokens:known?error.usage?.inputTokens??null:null,outputTokens:known?error.usage?.outputTokens??null:null,completedAt,latencyMs:completedAt-startedAt,status:'FAILED',error:message,timing:{queueMs:args.queueMs??0,promptBuildMs:0,requestMs:0,retryMs:0,parseMs:0,totalMs:completedAt-startedAt},failure:{failureStage:schema?'SCHEMA_VALIDATION':'MODEL_REQUEST',errorCode:http?`AI_HTTP_${http}`:/abort|timeout/i.test(message)?'AI_TIMEOUT':schema?'AI_SCHEMA_INVALID':'AI_RUN_FAILED',errorMessage:message,httpStatus:http,timeout:/abort|timeout/i.test(message),schemaValidation:schema,retryCount:0,rawOutput:known?redactAudit(error.rawOutput,Infinity):null}};Object.assign(this.state.aiRuns.find(x=>x.id===runId)!,run);load.failures++;load.lastCompletedAt=completedAt;
      if(args.role==='PRIMARY_BRAIN'){
        if(schema)this.primaryFailureStreak=0;
        else this.recordPrimaryFailure(message);
      }
      this.events.publish('AI_RUN_FAILED',run,args.symbol);if(error&&typeof error==='object')Object.assign(error,{runId});throw error;
    }finally{load.active=Math.max(0,load.active-1);if(!load.active){load.currentSymbol=null;load.currentRunId=null;load.currentStartedAt=null;}args.resource.status=load.active?'BUSY':'ONLINE';}
  }
  async scout(packet:EntryIntelligencePacket):Promise<ScoutAnnotation|null>{if(!this.state.settings.ai.scoutEnabled)return null;const resource=this.choose('SCOUT');const {value}=await this.run({resource,symbol:packet.symbol,packet,role:'SCOUT',prompt:buildScoutPrompt(packet),schemaName:'ScoutAnnotation',parse:scoutParse});return value;}
  async researchExternal(snapshot:ExternalIntelligenceSnapshot):Promise<ExternalResearchResult>{
    if(!this.state.settings.externalIntelligence.researchEnabled)throw new Error('EXTERNAL_RESEARCH_DISABLED');
    const resource=this.choose('SCOUT'),load=this.load.get(resource.id)!,startedAt=Date.now(),runId=`research_${snapshot.contentHash.slice(0,20)}`;
    load.active++;load.currentSymbol=snapshot.sourceId;load.currentRunId=runId;load.currentStartedAt=startedAt;resource.status='BUSY';
    const prompt=buildExternalResearchPrompt(snapshot);
    try{const result=await this.openAi.runJson({baseUrl:resource.baseUrl,model:resource.model,prompt,schemaName:'ExternalResearchFacts',jsonSchema:externalResearchJsonSchema(snapshot),timeoutMs:this.state.settings.ai.decisionTimeoutMs,maxOutputTokens:900,parse:value=>parseExternalResearch(materializeExternalResearch(snapshot,value),snapshot.sourceId)}),quality=verifyExternalResearch(snapshot,result.value,Date.now());load.totalRuns++;load.lastLatencyMs=Date.now()-startedAt;load.lastCompletedAt=Date.now();load.idleReason='WAITING_SHARED_EVENT';load.nextStep='等待新的共享外部事件';this.events.publish('EXTERNAL_RESEARCH_COMPLETED',{runId,sourceId:snapshot.sourceId,contentHash:snapshot.contentHash,model:resource.model,latencyMs:load.lastLatencyMs,factCount:quality.result.facts.length,rejectedFactCount:quality.rejectedFactCount,qualityIssues:quality.issues,entryPermission:false});return quality.result;}
    catch(error){load.failures++;load.lastLatencyMs=Date.now()-startedAt;load.lastCompletedAt=Date.now();load.idleReason='RESEARCH_FAILED';this.events.publish('EXTERNAL_RESEARCH_FAILED',{runId,sourceId:snapshot.sourceId,contentHash:snapshot.contentHash,model:resource.model,latencyMs:load.lastLatencyMs,reason:error instanceof Error?error.message:String(error),entryPermission:false});throw error;}
    finally{load.active=Math.max(0,load.active-1);if(!load.active){load.currentSymbol=null;load.currentRunId=null;load.currentStartedAt=null;}resource.status=load.active?'BUSY':'ONLINE';}
  }
  private async primaryOnce(packet:EntryIntelligencePacket,scout:ScoutAnnotation|null,excludeId?:string,role:'PRIMARY_BRAIN'|'REVIEW_BRAIN'='PRIMARY_BRAIN',extra:Record<string,unknown>={},queueMs=0):Promise<{decision:BrainDecision;run:AiRun;resource:AiResource}>{
    const resource=this.choose('PRIMARY_BRAIN',excludeId);if(this.primaryCircuitState==='OPEN'||this.primaryCircuitState==='PROBING')throw new Error('AI_PRIMARY_CIRCUIT_OPEN');let result=await this.run({resource,symbol:packet.symbol,packet,role,prompt:buildCompactBrainPrompt(packet,extra.confirmation,(packet as any).externalContext,scout),schemaName:'EntryDecisionV392',parse:value=>entryDecisionParse(value,packet),queueMs}),decision=result.value;
    if(decision.action!=='FINAL')throw new Error('AI_PROTOCOL_INCOMPLETE: evidence request did not converge to FINAL');
    const raw=rawIntent(result.run.outputPreview),stored=this.state.aiRuns.find(x=>x.id===result.run.id),rawDirection=typeof raw?.direction==='string'?raw.direction.toUpperCase():null,rawAction=typeof raw?.action==='string'?raw.action:null,rawDecision=typeof raw?.decision==='string'?raw.decision:['PLACE_LONG','PLACE_SHORT','REJECT_CANDIDATE'].includes(rawAction??'')?rawAction:null,parserRepaired=rawDirection!==decision.direction||rawDecision!==decision.decision;
    Object.assign(result.run,{direction:decision.direction,decision:decision.decision,rawDirection,rawDecision,normalizedPreview:redactAudit(decision,50000),parserRepaired});if(stored)Object.assign(stored,result.run);
    const load=this.load.get(resource.id)!;load.lastDirection=decision.direction;load.lastDecision=decision.decision;load.nextStep=decision.decision==='REJECT_CANDIDATE'?'候选进入单币冷却，继续下一候选':'等待 Entry Manager 校验';
    this.events.publish('PRIMARY_DECISION_NORMALIZED',{runId:result.run.id,rawDirection,rawDecision,normalizedDirection:decision.direction,normalizedDecision:decision.decision,parserRepaired,reason:decision.reason},packet.symbol);
    this.events.publish('AI_RUN_TERMINAL',result.run,packet.symbol);
    return{decision,run:result.run,resource};
  }
  /**
   * S07-A: the position review brain's only entry point. It runs on the same 27B endpoint as the entry
   * Primary but under its own run role, so the usage ledger can tell the two apart and a review that
   * cannot reach the model costs review budget rather than tripping the entry circuit breaker.
   */
  async review(packet:EntryIntelligencePacket,request:PositionReviewRequest):Promise<{verdict:PositionReviewVerdict;run:AiRun;promptHash:string}>{
    const prompt=buildPositionReviewPrompt(packet,request),resource=this.choose('PRIMARY_BRAIN');
    const {value,run}=await this.run({resource,symbol:packet.symbol,packet,role:'REVIEW_BRAIN',prompt,schemaName:'PositionReviewV396',
      parse:parsePositionReview,triggerReason:`POSITION_REVIEW:${request.triggerKey}:n${request.reviewNumber}`});
    return{verdict:value,run,promptHash:run.promptHash??'missing-prompt-hash'};
  }
  async decide(packet:EntryIntelligencePacket,_scout:ScoutAnnotation|null=null,queueMs=0,confirmation?:unknown):Promise<{decision:BrainDecision;runId:string}> {
    try {const first=await this.primaryOnce(packet,_scout,undefined,'PRIMARY_BRAIN',{confirmation},queueMs);return {decision:first.decision,runId:first.run.id};}
    catch(error){this.events.publish('AI_FAILED_NO_INTENT',{stage:'PRIMARY_BRAIN',message:error instanceof Error?error.message:String(error),policy:'FAIL_CLOSED'},packet.symbol);throw error;}
  }
}

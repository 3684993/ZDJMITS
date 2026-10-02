import { z } from 'zod';

export const EntryDispositionSchema=z.enum(['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE','RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID']);
export const WaitConditionSchema=z.object({operator:z.enum(['LTE','GTE']),price:z.number().finite().positive(),validForMinutes:z.number().int().min(1).max(5)}).strict();
export const OpportunityTypeSchema=z.enum(['TREND_PULLBACK','TREND_RESUMPTION','BREAKOUT_CONFIRMATION','RANGE_BOUNDARY_REVERSAL','NONE']);
export const MarketRegimeSchema=z.enum(['TREND','RANGE','TRANSITION','EXTREME','UNKNOWN']);
export const TrendDirectionRoleSchema=z.enum(['SUPPORTS_LONG','SUPPORTS_SHORT','NEUTRAL']);
export const AlignmentClassSchema=z.enum(['ALIGNED_LONG','ALIGNED_SHORT','MIXED','COUNTER_TREND_REVERSAL']);
export const ProfitTakePlanSchema=z.object({targetPrice:z.number().finite().positive(),acceptableTargetRange:z.object({min:z.number().finite().positive(),max:z.number().finite().positive()}).strict(),targetHorizonMinutes:z.number().int().min(1).max(1440),targetReason:z.string().min(1).max(240),evidenceRefs:z.array(z.string().max(120)).max(4).default([])}).strict().superRefine((p,c)=>{if(p.acceptableTargetRange.min>p.acceptableTargetRange.max||p.targetPrice<p.acceptableTargetRange.min||p.targetPrice>p.acceptableTargetRange.max)c.addIssue({code:'custom',path:['acceptableTargetRange'],message:'target must be inside range'});});
/** P5: the authorized take-profit target, named so the guardian and the plan share one contract type. */
export type ProfitTakePlan=z.infer<typeof ProfitTakePlanSchema>;

export const EntryDecisionV370Schema=z.object({
  action:z.literal('FINAL'),schemaVersion:z.enum(['V3.9.2','V3.9.3','V3.9.7']).default('V3.9.7'),decision:EntryDispositionSchema,
  structureDirection:z.enum(['LONG','SHORT']).nullable(),tradeSide:z.enum(['LONG','SHORT']).nullable(),direction:z.enum(['LONG','SHORT']).nullable().optional(),
  selectedCandidateId:z.string().min(1).max(120).nullable().default(null),
  /** Legacy archive compatibility only. V3.9.7 PLACE decisions must leave this null. */
  quantityUnits:z.number().int().positive().nullable().default(null),
  opportunityType:OpportunityTypeSchema.default('NONE'),marketRegime:MarketRegimeSchema.default('UNKNOWN'),confidence:z.number().finite().min(0).max(1),
  trend1dRole:TrendDirectionRoleSchema.nullable().default(null),trend4hRole:TrendDirectionRoleSchema.nullable().default(null),trend15mRole:TrendDirectionRoleSchema.nullable().default(null),alignmentClass:AlignmentClassSchema.nullable().default(null),counterTrendException:z.boolean().default(false),counterTrendReason:z.string().min(1).max(240).nullable().default(null),
  idealPrice:z.number().finite().positive().nullable(),acceptablePriceRange:z.object({min:z.number().finite().positive(),max:z.number().finite().positive()}).strict().nullable(),horizonMinutes:z.number().int().min(1).max(5).nullable(),waitCondition:WaitConditionSchema.nullable(),
  directionReason:z.string().min(1).max(160),timingReason:z.string().min(1).max(160),entryLocationReason:z.string().min(1).max(160).default('Location conclusion unavailable'),reason:z.string().min(1).max(160),entryInvalidation:z.string().min(1).max(400),
  // Legacy audit fields are accepted but are not part of the Primary output grammar.
  longException:z.boolean().default(false),longExceptionReason:z.string().max(400).nullable().default(null),altLongQuality:z.number().min(0).max(100).nullable().default(null),supportingEvidenceRefs:z.array(z.string().max(120)).max(12).default([]),
  profitTakePlan:ProfitTakePlanSchema.nullable().default(null),rejectLayer:z.enum(['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']).default('NONE'),blockingCondition:z.string().max(240).default(''),releaseCondition:z.string().max(240).default(''),
  timingEvent:z.object({id:z.string().max(120),status:z.enum(['COMPLETED','PENDING','NONE']),time:z.number().int().nullable(),anchorPrice:z.number().finite().positive().nullable(),timeframe:z.enum(['1m','5m','15m']).nullable(),provenance:z.string().max(120)}).nullable().default(null),
}).strict().superRefine((d,c)=>{
  const place=d.decision==='PLACE_LONG'||d.decision==='PLACE_SHORT';
  const candidateProtocol=d.schemaVersion==='V3.9.7';
  if(candidateProtocol&&(!d.trend1dRole||!d.trend4hRole||!d.trend15mRole||!d.alignmentClass))c.addIssue({code:'custom',path:['alignmentClass'],message:'V3.9.7 requires machine-readable 1D/4H/15m direction roles'});
  if(d.counterTrendException&&(!d.counterTrendReason||d.alignmentClass!=='COUNTER_TREND_REVERSAL'))c.addIssue({code:'custom',path:['counterTrendException'],message:'counter-trend exception requires class and reason'});
  if(!d.counterTrendException&&d.alignmentClass==='COUNTER_TREND_REVERSAL')c.addIssue({code:'custom',path:['counterTrendException'],message:'counter-trend class requires explicit exception'});
  if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null||d.profitTakePlan===null))c.addIssue({code:'custom',path:['selectedCandidateId'],message:'PLACE requires candidate, explicit price/range/horizon and TP'});
  if(place&&candidateProtocol&&d.selectedCandidateId===null)c.addIssue({code:'custom',path:['selectedCandidateId'],message:'V3.9.7 PLACE requires selectedCandidateId'});
  if(place&&candidateProtocol&&d.quantityUnits!==null)c.addIssue({code:'custom',path:['quantityUnits'],message:'V3.9.7 model cannot author quantityUnits'});
  if(place&&!candidateProtocol&&d.quantityUnits===null)c.addIssue({code:'custom',path:['quantityUnits'],message:'Legacy PLACE requires quantityUnits'});
  if(place&&d.tradeSide!==d.decision.replace('PLACE_',''))c.addIssue({code:'custom',path:['tradeSide'],message:'PLACE side must match tradeSide'});
  if(d.acceptablePriceRange&&(d.acceptablePriceRange.min>d.acceptablePriceRange.max||(d.idealPrice!==null&&(d.idealPrice<d.acceptablePriceRange.min||d.idealPrice>d.acceptablePriceRange.max))))c.addIssue({code:'custom',path:['acceptablePriceRange'],message:'min <= idealPrice <= max required'});
  if(!place&&(d.selectedCandidateId!==null||d.quantityUnits!==null||d.idealPrice!==null||d.acceptablePriceRange!==null||d.horizonMinutes!==null||d.tradeSide!==null||d.profitTakePlan!==null))c.addIssue({code:'custom',path:['selectedCandidateId'],message:'Non-PLACE carries no executable authorization'});
  if((d.decision==='WAIT_FOR_PRICE')!==(d.waitCondition!==null))c.addIssue({code:'custom',path:['waitCondition'],message:'Only WAIT requires a bounded price trigger'});
  if(d.decision==='NO_DIRECTION_EDGE'&&d.opportunityType!=='NONE')c.addIssue({code:'custom',path:['opportunityType'],message:'NO_DIRECTION_EDGE requires NONE opportunity type'});
});

const range={type:'object',additionalProperties:false,required:['min','max'],properties:{min:{type:'number',exclusiveMinimum:0},max:{type:'number',exclusiveMinimum:0}}};
const wait={type:'object',additionalProperties:false,required:['operator','price','validForMinutes'],properties:{operator:{enum:['LTE','GTE']},price:{type:'number',exclusiveMinimum:0},validForMinutes:{type:'integer',minimum:1,maximum:5}}};
const timing={type:['object','null'],additionalProperties:false,required:['id','status','time','anchorPrice','timeframe','provenance'],properties:{id:{type:'string',maxLength:120},status:{enum:['COMPLETED','PENDING','NONE']},time:{type:['integer','null']},anchorPrice:{type:['number','null'],exclusiveMinimum:0},timeframe:{type:['string','null'],enum:['1m','5m','15m',null]},provenance:{type:'string',maxLength:120}}};
const profitTake={type:'object',additionalProperties:false,required:['targetPrice','acceptableTargetRange','targetHorizonMinutes','targetReason','evidenceRefs'],properties:{targetPrice:{type:'number',exclusiveMinimum:0},acceptableTargetRange:range,targetHorizonMinutes:{type:'integer',minimum:1,maximum:1440},targetReason:{type:'string',minLength:1,maxLength:240},evidenceRefs:{type:'array',maxItems:4,items:{type:'string',maxLength:120}}}};
const shared={action:{const:'FINAL'},schemaVersion:{const:'V3.9.7'},structureDirection:{type:['string','null'],enum:['LONG','SHORT',null]},tradeSide:{type:['string','null'],enum:['LONG','SHORT',null]},selectedCandidateId:{type:['string','null'],maxLength:120},quantityUnits:{type:'null'},opportunityType:{enum:['TREND_PULLBACK','TREND_RESUMPTION','BREAKOUT_CONFIRMATION','RANGE_BOUNDARY_REVERSAL','NONE']},marketRegime:{enum:['TREND','RANGE','TRANSITION','EXTREME','UNKNOWN']},confidence:{type:'number',minimum:0,maximum:1},trend1dRole:{enum:['SUPPORTS_LONG','SUPPORTS_SHORT','NEUTRAL']},trend4hRole:{enum:['SUPPORTS_LONG','SUPPORTS_SHORT','NEUTRAL']},trend15mRole:{enum:['SUPPORTS_LONG','SUPPORTS_SHORT','NEUTRAL']},alignmentClass:{enum:['ALIGNED_LONG','ALIGNED_SHORT','MIXED','COUNTER_TREND_REVERSAL']},counterTrendException:{type:'boolean'},counterTrendReason:{type:['string','null'],minLength:1,maxLength:240},directionReason:{type:'string',minLength:1,maxLength:160},timingReason:{type:'string',minLength:1,maxLength:160},entryLocationReason:{type:'string',minLength:1,maxLength:160},reason:{type:'string',minLength:1,maxLength:160},entryInvalidation:{type:'string',minLength:1,maxLength:400},supportingEvidenceRefs:{type:'array',maxItems:12,items:{type:'string',maxLength:120}},profitTakePlan:profitTake,rejectLayer:{enum:['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']},blockingCondition:{type:'string',maxLength:240},releaseCondition:{type:'string',maxLength:240},timingEvent:timing};
const required=['action','schemaVersion','decision','structureDirection','tradeSide','selectedCandidateId','quantityUnits','opportunityType','marketRegime','confidence','trend1dRole','trend4hRole','trend15mRole','alignmentClass','counterTrendException','counterTrendReason','idealPrice','acceptablePriceRange','horizonMinutes','waitCondition','directionReason','timingReason','entryLocationReason','reason','entryInvalidation','supportingEvidenceRefs','profitTakePlan','rejectLayer','blockingCondition','releaseCondition','timingEvent'];
const variant=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required,properties:{...shared,...properties}});
export const EntryDecisionJsonSchema={oneOf:[
  variant({decision:{const:'PLACE_LONG'},tradeSide:{const:'LONG'},selectedCandidateId:{type:'string',minLength:1,maxLength:120},quantityUnits:{type:'null'},idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:range,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  variant({decision:{const:'PLACE_SHORT'},tradeSide:{const:'SHORT'},selectedCandidateId:{type:'string',minLength:1,maxLength:120},quantityUnits:{type:'null'},idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:range,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  variant({decision:{const:'WAIT_FOR_PRICE'},tradeSide:{type:'null'},selectedCandidateId:{type:'null'},quantityUnits:{type:'null'},idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:wait,profitTakePlan:{type:'null'}}),
  variant({decision:{enum:['RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID']},tradeSide:{type:'null'},selectedCandidateId:{type:'null'},quantityUnits:{type:'null'},idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:{type:'null'},profitTakePlan:{type:'null'}}),
]};

/** Wire-only R1: executable quantities and TP numbers are never model-authored. */
export const ENTRY_CANDIDATE_REFERENCE_PROTOCOL='V3.9.7-R1' as const;
export const EntryDecisionReferenceSchema=EntryDecisionV370Schema.innerType().omit({
  direction:true,quantityUnits:true,profitTakePlan:true,longException:true,longExceptionReason:true,altLongQuality:true,
}).extend({
  schemaVersion:z.literal(ENTRY_CANDIDATE_REFERENCE_PROTOCOL),
  candidateSetHash:z.string().min(1).max(160).nullable(),
  candidateSetFactVersion:z.string().min(1).max(160).nullable(),
}).strict();
export type EntryDecisionReference=z.infer<typeof EntryDecisionReferenceSchema>;
export const ENTRY_REFERENCE_REQUIRED_FIELDS=[...required.filter(key=>key!=='quantityUnits'&&key!=='profitTakePlan'),'candidateSetHash','candidateSetFactVersion'];
const referenceShared=Object.fromEntries(Object.entries(shared).filter(([key])=>key!=='quantityUnits'&&key!=='profitTakePlan'));
const referenceVariant=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,
  required:ENTRY_REFERENCE_REQUIRED_FIELDS,properties:{...referenceShared,schemaVersion:{const:ENTRY_CANDIDATE_REFERENCE_PROTOCOL},...properties}});
const referenceBinding={selectedCandidateId:{type:'string',minLength:1,maxLength:120},
  candidateSetHash:{type:'string',minLength:1,maxLength:160},candidateSetFactVersion:{type:'string',minLength:1,maxLength:160}};
const noReferenceBinding={selectedCandidateId:{type:'null'},candidateSetHash:{type:'null'},candidateSetFactVersion:{type:'null'}};
export const EntryDecisionReferenceJsonSchema={oneOf:[
  referenceVariant({decision:{const:'PLACE_LONG'},tradeSide:{const:'LONG'},...referenceBinding,
    idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:range,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  referenceVariant({decision:{const:'PLACE_SHORT'},tradeSide:{const:'SHORT'},...referenceBinding,
    idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:range,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  referenceVariant({decision:{const:'WAIT_FOR_PRICE'},tradeSide:{type:'null'},...noReferenceBinding,
    idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:wait}),
  referenceVariant({decision:{enum:['RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID']},tradeSide:{type:'null'},...noReferenceBinding,
    idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:{type:'null'}}),
]};

/** R2 separates frozen objective facts from the model's market opinion. R1 stays archive-compatible. */
export const ENTRY_FACT_BOUND_REFERENCE_PROTOCOL='V3.9.7-R2' as const;
export const isEntryReferenceProtocol=(version:unknown):boolean=>
  version===ENTRY_CANDIDATE_REFERENCE_PROTOCOL||version===ENTRY_FACT_BOUND_REFERENCE_PROTOCOL;
export const EntryFactCheckSchema=z.object({
  factId:z.enum(['technical.1d.confirmed','technical.4h.confirmed','technical.15m.confirmed']),
  field:z.enum(['macdHistogram','emaSlope21','trend']),
  value:z.enum(['POSITIVE','NEGATIVE','ZERO','UNKNOWN','UP','DOWN','RANGE']),
}).strict();
export const FrozenEntryDirectionFactsSchema=z.object({
  version:z.string().min(1).max(200),packetId:z.string().min(1),
  trend1dRole:TrendDirectionRoleSchema,trend4hRole:TrendDirectionRoleSchema,trend15mRole:TrendDirectionRoleSchema,
  strategicConsensus:z.enum(['LONG','SHORT']).nullable(),
  baseAlignmentClass:z.enum(['ALIGNED_LONG','ALIGNED_SHORT','MIXED']),
}).strict();
export const EntryDirectionResolutionSchema=z.object({
  source:z.literal('SYSTEM_FROZEN_DIRECTION_FACTS'),facts:FrozenEntryDirectionFactsSchema,
  factChecks:z.array(EntryFactCheckSchema).min(3).max(6),
}).strict();
const factBoundRemoved=['trend1dRole','trend4hRole','trend15mRole','alignmentClass','counterTrendException',
  'directionReason','timingReason','entryLocationReason','blockingCondition','releaseCondition','timingEvent'];
export const EntryDecisionFactBoundSchema=EntryDecisionReferenceSchema.omit({
  trend1dRole:true,trend4hRole:true,trend15mRole:true,alignmentClass:true,counterTrendException:true,
  directionReason:true,timingReason:true,entryLocationReason:true,blockingCondition:true,releaseCondition:true,timingEvent:true,
}).extend({
  schemaVersion:z.literal(ENTRY_FACT_BOUND_REFERENCE_PROTOCOL),
  directionFactsVersion:z.string().min(1).max(200),timingEventId:z.string().min(1).max(120).nullable(),factChecks:z.array(EntryFactCheckSchema).min(3).max(6),
  counterTrendReason:z.string().min(1).max(160).nullable(),entryInvalidation:z.string().min(1).max(160),
}).strict();
export const ENTRY_FACT_BOUND_REQUIRED_FIELDS=[...ENTRY_REFERENCE_REQUIRED_FIELDS.filter(key=>!factBoundRemoved.includes(key)),
  'directionFactsVersion','factChecks','timingEventId'];
const factBoundProperties={...Object.fromEntries(Object.entries(referenceShared).filter(([key])=>!factBoundRemoved.includes(key))),
  schemaVersion:{const:ENTRY_FACT_BOUND_REFERENCE_PROTOCOL},decision:{enum:EntryDispositionSchema.options},
  selectedCandidateId:{type:['string','null'],minLength:1,maxLength:120},
  candidateSetHash:{type:['string','null'],minLength:1,maxLength:160},candidateSetFactVersion:{type:['string','null'],minLength:1,maxLength:160},
  idealPrice:{type:['number','null'],exclusiveMinimum:0},acceptablePriceRange:{...range,type:['object','null']},
  horizonMinutes:{type:['integer','null'],minimum:1,maximum:5},waitCondition:{...wait,type:['object','null']},
  counterTrendReason:{type:['string','null'],minLength:1,maxLength:160},entryInvalidation:{type:'string',minLength:1,maxLength:160},
  directionFactsVersion:{type:'string',minLength:1,maxLength:200},timingEventId:{type:['string','null'],minLength:1,maxLength:120},factChecks:{type:'array',minItems:3,maxItems:6,items:{
    type:'object',additionalProperties:false,required:['factId','field','value'],properties:{
      factId:{enum:EntryFactCheckSchema.shape.factId.options},field:{enum:EntryFactCheckSchema.shape.field.options},value:{enum:EntryFactCheckSchema.shape.value.options}}}},
};
/** xgrammar 0.2.3 ignores root properties beside oneOf. Every branch must be complete.
 * Pool repeated property definitions with supported $ref, never drop the required-field constraints.
 */
function factBoundJsonSchema(){
  const branchKeys=['decision','tradeSide','selectedCandidateId','candidateSetHash','candidateSetFactVersion',
    'idealPrice','acceptablePriceRange','horizonMinutes','waitCondition'];
  const branches=EntryDecisionReferenceJsonSchema.oneOf.map(branch=>({type:'object',additionalProperties:false,
    required:ENTRY_FACT_BOUND_REQUIRED_FIELDS,properties:{...factBoundProperties,...Object.fromEntries(
      Object.entries(branch.properties).filter(([key])=>branchKeys.includes(key)))}}));
  const counts=new Map<string,number>();
  for(const branch of branches)for(const value of Object.values(branch.properties)){
    const serialized=JSON.stringify(value);counts.set(serialized,(counts.get(serialized)??0)+1);
  }
  const definitions:Record<string,unknown>={},references=new Map<string,{$ref:string}>();
  for(const [serialized,count] of counts){
    const name=`p${Object.keys(definitions).length}`,reference={$ref:`#/$defs/${name}`},value=JSON.parse(serialized);
    if(count>1&&count*serialized.length>JSON.stringify({[name]:value}).length+count*JSON.stringify(reference).length){
      definitions[name]=value;references.set(serialized,reference);
    }
  }
  return{$defs:definitions,oneOf:branches.map(branch=>({...branch,properties:Object.fromEntries(
    Object.entries(branch.properties).map(([key,value])=>[key,references.get(JSON.stringify(value))??value]))}))};
}
export const EntryDecisionFactBoundJsonSchema=factBoundJsonSchema();

/** Engine-created proof; excluded from the model's strict wire schema. */
export const CandidateReferenceResolutionSchema=z.object({
  source:z.literal('SYSTEM_FROZEN_CANDIDATE'),protocol:z.enum([ENTRY_CANDIDATE_REFERENCE_PROTOCOL,ENTRY_FACT_BOUND_REFERENCE_PROTOCOL]),
  packetId:z.string().min(1),symbol:z.string().min(1),side:z.enum(['LONG','SHORT']),
  selectedCandidateId:z.string().min(1).max(120),candidateSetHash:z.string().min(1).max(160),candidateSetFactVersion:z.string().min(1).max(160),
  envelopeCreatedAt:z.number().int().nonnegative(),envelopeExpiresAt:z.number().int().positive(),resolvedAt:z.number().int().nonnegative(),
  targetPrice:z.number().finite().positive(),acceptableTargetRange:z.object({min:z.number().finite().positive(),max:z.number().finite().positive()}).strict(),
  targetHorizonMinutes:z.number().int().min(1).max(1440),
}).strict();
export type CandidateReferenceResolution=z.infer<typeof CandidateReferenceResolutionSchema>;

export const AiResourceSchema=z.object({id:z.string(),role:z.enum(['SCOUT','PRIMARY_BRAIN']),baseUrl:z.string(),model:z.string(),maxConcurrency:z.number().int().positive(),gpu:z.string(),status:z.enum(['ONLINE','BUSY','DEGRADED','OFFLINE']).default('ONLINE'),active:z.number().int().nonnegative().optional(),totalRuns:z.number().int().nonnegative().optional(),failures:z.number().int().nonnegative().optional(),lastLatencyMs:z.number().int().nonnegative().nullable().optional(),currentStatus:z.enum(['ANALYZING','WAITING_CANDIDATE','WAITING_MARKET','WAITING_SCOUT','WAITING_PRIMARY','DECISION_READY','ENTRY_PENDING','BLOCKED','IDLE','PAUSED','DEGRADED','DISABLED','WAITING_SHARED_EVENT','QUEUED','RUNNING','FAILED']).optional(),currentSymbol:z.string().nullable().optional(),currentRunId:z.string().nullable().optional(),currentRunSeconds:z.number().int().nonnegative().optional(),lastCompletedAt:z.number().int().nullable().optional(),lastDirection:z.enum(['LONG','SHORT']).nullable().optional(),lastDecision:z.string().nullable().optional(),idleReason:z.string().nullable().optional(),nextStep:z.string().optional(),queueDepth:z.number().int().nonnegative().optional()});
export type AiResource=z.infer<typeof AiResourceSchema>;
export const ScoutAnnotationSchema=z.object({symbol:z.string().min(1).max(32),summary:z.string().max(240),keyEvidence:z.array(z.string().max(160)).max(6),contradictions:z.array(z.string().max(160)).max(4),missingEvidence:z.array(z.string().max(160)).max(4),attentionScore:z.number().min(0).max(1)}).strict();
export type ScoutAnnotation=z.infer<typeof ScoutAnnotationSchema>;
export const ScoutAnnotationJsonSchema={type:'object',additionalProperties:false,required:['symbol','summary','keyEvidence','contradictions','missingEvidence','attentionScore'],properties:{symbol:{type:'string',minLength:1,maxLength:32},summary:{type:'string',maxLength:240},keyEvidence:{type:'array',maxItems:6,items:{type:'string',maxLength:160}},contradictions:{type:'array',maxItems:4,items:{type:'string',maxLength:160}},missingEvidence:{type:'array',maxItems:4,items:{type:'string',maxLength:160}},attentionScore:{type:'number',minimum:0,maximum:1}}} as const;
export const EvidenceRequestSchema=z.object({tool:z.enum(['GET_MULTITIMEFRAME','GET_DERIVATIVES','GET_ORDERBOOK','GET_GLOBAL_REGIME','GET_PORTFOLIO_CONTEXT','GET_EXPERIENCE','GET_REACHABLE_BAND']),reason:z.string()});
export type EvidenceRequest=z.infer<typeof EvidenceRequestSchema>;

export const BrainDecisionSchema=z.object({action:z.enum(['FINAL','NEED_EVIDENCE']).default('FINAL'),structureDirection:z.enum(['LONG','SHORT']).nullable(),tradeSide:z.enum(['LONG','SHORT']).nullable(),direction:z.enum(['LONG','SHORT']).nullable().default(null),decision:z.union([EntryDispositionSchema,z.literal('REJECT_CANDIDATE')]).nullable(),selectedCandidateId:z.string().min(1).max(120).nullable().default(null),candidateSetHash:z.string().min(1).max(160).nullable().optional(),candidateSetFactVersion:z.string().min(1).max(160).nullable().optional(),candidateReferenceResolution:CandidateReferenceResolutionSchema.nullable().optional(),directionResolution:EntryDirectionResolutionSchema.nullable().optional(),quantityUnits:z.number().int().positive().nullable().default(null),waitCondition:WaitConditionSchema.nullable().optional(),protocolVersion:z.string().optional(),confidence:z.number().min(0).max(1),trend1dRole:TrendDirectionRoleSchema.nullable().default(null),trend4hRole:TrendDirectionRoleSchema.nullable().default(null),trend15mRole:TrendDirectionRoleSchema.nullable().default(null),alignmentClass:AlignmentClassSchema.nullable().default(null),counterTrendException:z.boolean().default(false),counterTrendReason:z.string().min(1).max(240).nullable().default(null),idealPrice:z.number().positive().nullable(),acceptablePriceRange:z.object({min:z.number().positive(),max:z.number().positive()}).nullable(),horizonMinutes:z.number().int().min(1).max(5).nullable(),reachability:z.number().min(0).max(1),directionAnalysis:z.object({trend1m:z.string(),trend5m:z.string(),trend15m:z.string(),trend4h:z.string(),trend1d:z.string(),trend1w:z.string(),weightedConclusion:z.string()}),supportingEvidence:z.array(z.string()).max(12),contradictions:z.array(z.string()).max(12),missingEvidence:z.array(z.string()).max(10),evidenceRefs:z.array(z.string()).max(30),entryInvalidation:z.string(),reason:z.string(),longException:z.boolean().default(false),longExceptionReason:z.string().nullable().default(null),altLongQuality:z.number().min(0).max(100).nullable().default(null),supportingEvidenceRefs:z.array(z.string()).max(30).default([]),evidenceRequests:z.array(EvidenceRequestSchema).max(3).default([]),schemaVersion:z.string().optional(),opportunityType:OpportunityTypeSchema.optional(),marketRegime:MarketRegimeSchema.optional(),entryLocationReason:z.string().optional(),profitTakePlan:ProfitTakePlanSchema.nullable().default(null),rejectLayer:z.enum(['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']).default('NONE'),blockingCondition:z.string().default(''),releaseCondition:z.string().default(''),timingEvent:z.any().nullable().default(null)}).superRefine((v,c)=>{if(v.action!=='FINAL')return;const place=v.decision==='PLACE_LONG'||v.decision==='PLACE_SHORT',referenceProtocol=isEntryReferenceProtocol(v.schemaVersion)||isEntryReferenceProtocol(v.protocolVersion),candidateProtocol=referenceProtocol||v.schemaVersion==='V3.9.7'||v.protocolVersion==='V3.9.7';if(referenceProtocol&&v.schemaVersion&&v.protocolVersion&&v.schemaVersion!==v.protocolVersion)c.addIssue({code:'custom',path:['protocolVersion'],message:'Reference protocol versions must agree'});if((v.schemaVersion===ENTRY_FACT_BOUND_REFERENCE_PROTOCOL||v.protocolVersion===ENTRY_FACT_BOUND_REFERENCE_PROTOCOL)&&!v.directionResolution)c.addIssue({code:'custom',path:['directionResolution'],message:'R2 requires frozen direction fact proof'});if(referenceProtocol&&place&&(!v.candidateSetHash||!v.candidateSetFactVersion||!v.candidateReferenceResolution))c.addIssue({code:'custom',path:['candidateReferenceResolution'],message:'Reference PLACE requires engine resolution proof and candidate binding'});if(referenceProtocol&&!place&&(v.candidateSetHash!=null||v.candidateSetFactVersion!=null||v.candidateReferenceResolution!=null))c.addIssue({code:'custom',path:['candidateReferenceResolution'],message:'Reference non-PLACE cannot carry candidate authorization'});if(!v.decision)c.addIssue({code:'custom',path:['decision'],message:'FINAL requires decision'});if(candidateProtocol&&(!v.trend1dRole||!v.trend4hRole||!v.trend15mRole||!v.alignmentClass))c.addIssue({code:'custom',path:['alignmentClass'],message:'V3.9.7 direction contract required'});if(v.counterTrendException&&(!v.counterTrendReason||v.alignmentClass!=='COUNTER_TREND_REVERSAL'))c.addIssue({code:'custom',path:['counterTrendException'],message:'counter-trend exception requires class and reason'});if(!v.counterTrendException&&v.alignmentClass==='COUNTER_TREND_REVERSAL')c.addIssue({code:'custom',path:['counterTrendException'],message:'counter-trend class requires explicit exception'});if(v.decision==='PLACE_LONG'&&v.tradeSide!=='LONG')c.addIssue({code:'custom',path:['tradeSide'],message:'PLACE_LONG requires LONG'});if(v.decision==='PLACE_SHORT'&&v.tradeSide!=='SHORT')c.addIssue({code:'custom',path:['tradeSide'],message:'PLACE_SHORT requires SHORT'});if(place&&(v.idealPrice===null||!v.acceptablePriceRange||v.horizonMinutes===null||v.profitTakePlan===null))c.addIssue({code:'custom',path:['selectedCandidateId'],message:'PLACE requires candidate/price/range/horizon/TP'});if(place&&candidateProtocol&&v.selectedCandidateId===null)c.addIssue({code:'custom',path:['selectedCandidateId'],message:'V3.9.7 PLACE requires selectedCandidateId'});if(place&&candidateProtocol&&v.quantityUnits!==null)c.addIssue({code:'custom',path:['quantityUnits'],message:'V3.9.7 model cannot author quantityUnits'});if(place&&!candidateProtocol&&v.quantityUnits===null)c.addIssue({code:'custom',path:['quantityUnits'],message:'legacy PLACE requires quantityUnits'});if(!place&&(v.selectedCandidateId!==null||v.quantityUnits!==null||v.tradeSide!==null||v.direction!==null||v.profitTakePlan!==null))c.addIssue({code:'custom',path:['selectedCandidateId'],message:'non-PLACE cannot carry executable fields'});});
export type BrainDecision=z.infer<typeof BrainDecisionSchema>;

/** Measured zero is distinct from a stage that was never observed. Older numeric archives remain valid. */
const measuredMs=z.number().int().nonnegative().nullable();
export const AiRunTimingSchema=z.object({
  queueMs:measuredMs,promptBuildMs:measuredMs,requestMs:measuredMs,retryMs:measuredMs,parseMs:measuredMs,totalMs:z.number().int().nonnegative(),
  slotWaitMs:measuredMs.optional(),scoutMs:measuredMs.optional(),prepareMs:measuredMs.optional(),
  responseHeadersMs:measuredMs.optional(),responseBodyMs:measuredMs.optional(),clientElapsedMs:measuredMs.optional(),
  transportAttempts:z.number().int().nonnegative().optional(),responseBytes:z.number().int().nonnegative().nullable().optional(),
  cachedInputTokens:z.number().int().nonnegative().nullable().optional(),providerTimingSource:z.enum(['OMLX_USAGE_SECONDS']).nullable().optional(),
  firstTokenMs:measuredMs.optional(),serverQueueMs:measuredMs.optional(),prefillMs:measuredMs.optional(),decodeMs:measuredMs.optional(),
});
export type AiRunTiming=z.infer<typeof AiRunTimingSchema>;
export const AiCancellationSchema=z.object({source:z.enum(['CALLER','DEADLINE']),requestedAt:z.number().int().nonnegative(),backendStatus:z.literal('UNKNOWN')});
export const AiRunSchema=z.object({id:z.string(),symbol:z.string(),resourceId:z.string(),model:z.string(),role:z.enum(['SCOUT','PRIMARY_BRAIN','REVIEW_BRAIN']),startedAt:z.number().int(),completedAt:z.number().int().nullable(),latencyMs:z.number().int().nonnegative().nullable(),inputTokens:z.number().int().nonnegative().nullable(),outputTokens:z.number().int().nonnegative().nullable(),status:z.enum(['RUNNING','COMPLETED','FAILED']),direction:z.enum(['LONG','SHORT']).nullable().default(null),decision:z.string().nullable(),requestSource:z.enum(['ENTRY','SHADOW','RESEARCH','REVIEW']).optional(),requestContextId:z.string().optional(),inputContractHash:z.string().optional(),promptHash:z.string().optional(),outputContractVersion:z.string().optional(),settingsVersion:z.number().int().positive().optional(),scoutMode:z.enum(['SERIAL','DIRECT','PARALLEL_SHADOW','SAMPLED_SHADOW']).optional(),finishReason:z.string().nullable().optional(),modelIdentity:z.record(z.unknown()).nullable().optional(),terminalStage:z.string().optional(),rawDirection:z.string().nullable().optional(),rawDecision:z.string().nullable().optional(),normalizedPreview:z.string().optional(),parserRepaired:z.boolean().optional(),protocolNormalization:z.object({applied:z.boolean(),fields:z.array(z.object({field:z.string(),raw:z.unknown(),normalized:z.number(),rule:z.string()})).max(12),repairAttempted:z.boolean().default(false)}).optional(),scoutHandoff:z.boolean().optional(),packetId:z.string().nullable(),error:z.string().nullable(),inputPreview:z.string().optional(),outputPreview:z.string().optional(),timing:AiRunTimingSchema.optional(),failure:z.object({failureStage:z.string(),errorCode:z.string(),errorMessage:z.string(),httpStatus:z.number().int().nullable(),timeout:z.boolean(),schemaValidation:z.boolean(),retryCount:z.number().int().nonnegative().nullable(),rawOutput:z.string().nullable(),cancelled:z.boolean().optional(),cancellation:AiCancellationSchema.nullable().optional()}).nullable().optional()});
export type AiRun=z.infer<typeof AiRunSchema>;

import { z } from 'zod';

export const EntryDispositionSchema=z.enum(['PLACE_LONG','PLACE_SHORT','WAIT_FOR_PRICE','RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID']);
export const WaitConditionSchema=z.object({operator:z.enum(['LTE','GTE']),price:z.number().finite().positive(),validForMinutes:z.number().int().min(1).max(5)}).strict();
export const OpportunityTypeSchema=z.enum(['TREND_PULLBACK','TREND_RESUMPTION','BREAKOUT_CONFIRMATION','RANGE_BOUNDARY_REVERSAL','NONE']);
export const MarketRegimeSchema=z.enum(['TREND','RANGE','TRANSITION','EXTREME','UNKNOWN']);
export const ProfitTakePlanSchema=z.object({targetPrice:z.number().finite().positive(),acceptableTargetRange:z.object({min:z.number().finite().positive(),max:z.number().finite().positive()}).strict(),targetHorizonMinutes:z.number().int().min(1).max(1440),targetReason:z.string().min(1).max(240),evidenceRefs:z.array(z.string().max(120)).max(4).default([])}).strict().superRefine((p,c)=>{if(p.acceptableTargetRange.min>p.acceptableTargetRange.max||p.targetPrice<p.acceptableTargetRange.min||p.targetPrice>p.acceptableTargetRange.max)c.addIssue({code:'custom',path:['acceptableTargetRange'],message:'target must be inside range'});});
export const EntryDecisionV370Schema=z.object({
  action:z.literal('FINAL'),schemaVersion:z.literal('V3.9.2').default('V3.9.2'),decision:EntryDispositionSchema,
  /** Structure is descriptive; only tradeSide can authorize PLACE. */
  structureDirection:z.enum(['LONG','SHORT']).nullable(),tradeSide:z.enum(['LONG','SHORT']).nullable(),direction:z.enum(['LONG','SHORT']).nullable().optional(),
  opportunityType:OpportunityTypeSchema.default('NONE'),marketRegime:MarketRegimeSchema.default('UNKNOWN'),
  confidence:z.number().finite().min(0).max(1),
  idealPrice:z.number().finite().positive().nullable(),
  acceptablePriceRange:z.object({min:z.number().finite().positive(),max:z.number().finite().positive()}).strict().nullable(),
  horizonMinutes:z.number().int().min(1).max(5).nullable(),waitCondition:WaitConditionSchema.nullable(),
  directionReason:z.string().min(1).max(160),timingReason:z.string().min(1).max(160),entryLocationReason:z.string().min(1).max(160).default('Legacy location reason unavailable'),reason:z.string().min(1).max(160),entryInvalidation:z.string().min(1).max(400),
  longException:z.boolean().default(false),longExceptionReason:z.string().max(400).nullable().default(null),altLongQuality:z.number().min(0).max(100).nullable().default(null),supportingEvidenceRefs:z.array(z.string().max(120)).max(4).default([]),
  profitTakePlan:ProfitTakePlanSchema.nullable().default(null),
  rejectLayer:z.enum(['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']).default('NONE'),blockingCondition:z.string().max(240).default(''),releaseCondition:z.string().max(240).default(''),
  timingEvent:z.object({id:z.string().max(120),status:z.enum(['COMPLETED','PENDING','NONE']),time:z.number().int().nullable(),anchorPrice:z.number().finite().positive().nullable(),timeframe:z.enum(['1m','5m','15m']).nullable(),provenance:z.string().max(120)}).nullable().default(null),
}).strict().superRefine((d,c)=>{
  const place=d.decision==='PLACE_LONG'||d.decision==='PLACE_SHORT';
  if(place&&(!d.acceptablePriceRange||d.idealPrice===null||d.horizonMinutes===null))c.addIssue({code:'custom',path:['idealPrice'],message:'PLACE requires explicit price/range/horizon'});
  if(place&&d.tradeSide!==d.decision.replace('PLACE_',''))c.addIssue({code:'custom',path:['tradeSide'],message:'PLACE side must match tradeSide'});
  if(d.acceptablePriceRange&&(d.acceptablePriceRange.min>d.acceptablePriceRange.max||(d.idealPrice!==null&&(d.idealPrice<d.acceptablePriceRange.min||d.idealPrice>d.acceptablePriceRange.max))))c.addIssue({code:'custom',path:['acceptablePriceRange'],message:'min <= idealPrice <= max required'});
  if(!place&&(d.idealPrice!==null||d.acceptablePriceRange!==null||d.horizonMinutes!==null))c.addIssue({code:'custom',path:['idealPrice'],message:'Non-PLACE carries no executable authorization'});
  if(!place&&(d.tradeSide!==null||d.profitTakePlan!==null))c.addIssue({code:'custom',path:['tradeSide'],message:'Non-PLACE carries no trade side or TP'});
  if((d.decision==='WAIT_FOR_PRICE')!==(d.waitCondition!==null))c.addIssue({code:'custom',path:['waitCondition'],message:'Only WAIT requires a bounded price trigger'});
  if(d.decision==='NO_DIRECTION_EDGE'&&d.opportunityType!=='NONE')c.addIssue({code:'custom',path:['opportunityType'],message:'NO_DIRECTION_EDGE requires NONE opportunity type'});
});

/** Complete top-level variants are deliberate: llama.cpp enforces oneOf, while
 * conditional if/then branches are not reliably reflected in its grammar. */
const entryRangeSchema={type:'object',additionalProperties:false,required:['min','max'],properties:{min:{type:'number',exclusiveMinimum:0},max:{type:'number',exclusiveMinimum:0}}};
const entryWaitSchema={type:'object',additionalProperties:false,required:['operator','price','validForMinutes'],properties:{operator:{enum:['LTE','GTE']},price:{type:'number',exclusiveMinimum:0},validForMinutes:{type:'integer',minimum:1,maximum:5}}};
const entryTimingEventSchema={type:['object','null'],additionalProperties:false,required:['id','status','time','anchorPrice','timeframe','provenance'],properties:{id:{type:'string',maxLength:120},status:{enum:['COMPLETED','PENDING','NONE']},time:{type:['integer','null']},anchorPrice:{type:['number','null'],exclusiveMinimum:0},timeframe:{type:['string','null'],enum:['1m','5m','15m',null]},provenance:{type:'string',maxLength:120}}};
const entrySharedProperties={action:{const:'FINAL'},schemaVersion:{const:'V3.9.2'},structureDirection:{type:['string','null'],enum:['LONG','SHORT',null]},tradeSide:{type:['string','null'],enum:['LONG','SHORT',null]},opportunityType:{enum:['TREND_PULLBACK','TREND_RESUMPTION','BREAKOUT_CONFIRMATION','RANGE_BOUNDARY_REVERSAL','NONE']},marketRegime:{enum:['TREND','RANGE','TRANSITION','EXTREME','UNKNOWN']},confidence:{type:'number',minimum:0,maximum:1},directionReason:{type:'string',minLength:1,maxLength:160},timingReason:{type:'string',minLength:1,maxLength:160},entryLocationReason:{type:'string',minLength:1,maxLength:160},reason:{type:'string',minLength:1,maxLength:160},entryInvalidation:{type:'string',minLength:1,maxLength:400},longException:{type:'boolean'},longExceptionReason:{type:['string','null'],maxLength:400},altLongQuality:{type:['number','null'],minimum:0,maximum:100},supportingEvidenceRefs:{type:'array',maxItems:4,items:{type:'string',maxLength:120}},profitTakePlan:{type:['object','null'],additionalProperties:false,required:['targetPrice','acceptableTargetRange','targetHorizonMinutes','targetReason','evidenceRefs'],properties:{targetPrice:{type:'number',exclusiveMinimum:0},acceptableTargetRange:entryRangeSchema,targetHorizonMinutes:{type:'integer',minimum:1,maximum:1440},targetReason:{type:'string',minLength:1,maxLength:240},evidenceRefs:{type:'array',maxItems:4,items:{type:'string',maxLength:120}}}},rejectLayer:{enum:['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']},blockingCondition:{type:'string',maxLength:240},releaseCondition:{type:'string',maxLength:240},timingEvent:entryTimingEventSchema};
const entryRequired=['action','schemaVersion','decision','structureDirection','tradeSide','opportunityType','marketRegime','confidence','idealPrice','acceptablePriceRange','horizonMinutes','waitCondition','directionReason','timingReason','entryLocationReason','reason','entryInvalidation','longException','longExceptionReason','altLongQuality','supportingEvidenceRefs','profitTakePlan','rejectLayer','blockingCondition','releaseCondition','timingEvent'];
const entryVariant=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:entryRequired,properties:{...entrySharedProperties,...properties}});
export const EntryDecisionJsonSchema={oneOf:[
  entryVariant({decision:{const:'PLACE_LONG'},tradeSide:{const:'LONG'},idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:entryRangeSchema,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  entryVariant({decision:{const:'PLACE_SHORT'},tradeSide:{const:'SHORT'},idealPrice:{type:'number',exclusiveMinimum:0},acceptablePriceRange:entryRangeSchema,horizonMinutes:{type:'integer',minimum:1,maximum:5},waitCondition:{type:'null'}}),
  entryVariant({decision:{const:'WAIT_FOR_PRICE'},tradeSide:{type:'null'},idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:entryWaitSchema,profitTakePlan:{type:'null'}}),
  entryVariant({decision:{enum:['RESELECT_SYMBOL','NO_DIRECTION_EDGE','DATA_ERROR','AI_OUTPUT_INVALID']},tradeSide:{type:'null'},idealPrice:{type:'null'},acceptablePriceRange:{type:'null'},horizonMinutes:{type:'null'},waitCondition:{type:'null'},profitTakePlan:{type:'null'}}),
]};

export const AiResourceSchema = z.object({
  id: z.string(),
  role: z.enum(['SCOUT', 'PRIMARY_BRAIN']),
  baseUrl: z.string(),
  model: z.string(),
  maxConcurrency: z.number().int().positive(),
  gpu: z.string(),
  status: z.enum(['ONLINE','BUSY','DEGRADED','OFFLINE']).default('ONLINE'),
  active: z.number().int().nonnegative().optional(),
  totalRuns: z.number().int().nonnegative().optional(),
  failures: z.number().int().nonnegative().optional(),
  lastLatencyMs: z.number().int().nonnegative().nullable().optional(),
  currentStatus: z.enum(['ANALYZING','WAITING_CANDIDATE','WAITING_MARKET','WAITING_SCOUT','WAITING_PRIMARY','DECISION_READY','ENTRY_PENDING','BLOCKED','IDLE','PAUSED','DEGRADED','DISABLED','WAITING_SHARED_EVENT','QUEUED','RUNNING','FAILED']).optional(),
  currentSymbol: z.string().nullable().optional(),
  currentRunId: z.string().nullable().optional(),
  currentRunSeconds: z.number().int().nonnegative().optional(),
  lastCompletedAt: z.number().int().nullable().optional(),
  lastDirection: z.enum(['LONG','SHORT']).nullable().optional(),
  lastDecision: z.string().nullable().optional(),
  idleReason: z.string().nullable().optional(),
  nextStep: z.string().optional(),
  queueDepth: z.number().int().nonnegative().optional(),
});
export type AiResource = z.infer<typeof AiResourceSchema>;

export const ScoutAnnotationSchema = z.object({
  symbol: z.string(),
  summary: z.string(),
  keyEvidence: z.array(z.string()).max(10),
  contradictions: z.array(z.string()).max(8),
  missingEvidence: z.array(z.string()).max(8),
  attentionScore: z.number().min(0).max(1),
});
export type ScoutAnnotation = z.infer<typeof ScoutAnnotationSchema>;

export const EvidenceRequestSchema = z.object({
  tool: z.enum(['GET_MULTITIMEFRAME','GET_DERIVATIVES','GET_ORDERBOOK','GET_GLOBAL_REGIME','GET_PORTFOLIO_CONTEXT','GET_EXPERIENCE','GET_REACHABLE_BAND']),
  reason: z.string(),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

export const BrainDecisionSchema = z.object({
  action: z.enum(['FINAL', 'NEED_EVIDENCE']).default('FINAL'),
  structureDirection:z.enum(['LONG','SHORT']).nullable(),
  tradeSide:z.enum(['LONG','SHORT']).nullable(),
  /** Deprecated audit alias. Always null for non-PLACE. */
  direction: z.enum(['LONG', 'SHORT']).nullable().default(null),
  decision: z.union([EntryDispositionSchema,z.literal('REJECT_CANDIDATE')]).nullable(),
  waitCondition:WaitConditionSchema.nullable().optional(),
  protocolVersion:z.string().optional(),
  confidence: z.number().min(0).max(1),
  idealPrice: z.number().positive().nullable(),
  acceptablePriceRange: z.object({ min: z.number().positive(), max: z.number().positive() }).nullable(),
  horizonMinutes: z.number().int().min(1).max(5).nullable(),
  reachability: z.number().min(0).max(1),
  directionAnalysis: z.object({
    trend1m: z.string(), trend5m: z.string(), trend15m: z.string(), trend4h: z.string(), trend1d: z.string(), trend1w: z.string(),
    weightedConclusion: z.string(),
  }),
  supportingEvidence: z.array(z.string()).max(12),
  contradictions: z.array(z.string()).max(12),
  missingEvidence: z.array(z.string()).max(10),
  evidenceRefs: z.array(z.string()).max(30),
  entryInvalidation: z.string(),
  reason: z.string(),
  longException:z.boolean().default(false),
  longExceptionReason:z.string().nullable().default(null),
  altLongQuality:z.number().min(0).max(100).nullable().default(null),
  supportingEvidenceRefs:z.array(z.string()).max(30).default([]),
  evidenceRequests: z.array(EvidenceRequestSchema).max(3).default([]),
  schemaVersion:z.string().optional(),
  opportunityType:OpportunityTypeSchema.optional(),
  marketRegime:MarketRegimeSchema.optional(),
  entryLocationReason:z.string().optional(),
  profitTakePlan:ProfitTakePlanSchema.nullable().default(null),
  rejectLayer:z.enum(['STRUCTURE','TIMING','LOCATION','ECONOMIC','PERMISSION','DATA','NONE']).default('NONE'),blockingCondition:z.string().default(''),releaseCondition:z.string().default(''),timingEvent:z.any().nullable().default(null),
}).superRefine((value, ctx) => {
  if (value.action === 'FINAL') {
    if (!value.decision) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'FINAL requires decision' });
    if (value.decision === 'PLACE_LONG' && value.tradeSide !== 'LONG') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tradeSide'], message: 'PLACE_LONG requires LONG tradeSide' });
    if (value.decision === 'PLACE_SHORT' && value.tradeSide !== 'SHORT') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tradeSide'], message: 'PLACE_SHORT requires SHORT tradeSide' });
    if (value.decision === 'PLACE_LONG' || value.decision === 'PLACE_SHORT') {
      if (value.idealPrice == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['idealPrice'], message: 'entry decision requires idealPrice' });
      if (!value.acceptablePriceRange) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptablePriceRange'], message: 'entry decision requires acceptablePriceRange' });
      if (value.horizonMinutes == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['horizonMinutes'], message: 'entry decision requires horizonMinutes' });
    }
    if(value.decision!=='PLACE_LONG'&&value.decision!=='PLACE_SHORT'&&(value.tradeSide!==null||value.direction!==null||value.profitTakePlan!==null))ctx.addIssue({code:z.ZodIssueCode.custom,path:['tradeSide'],message:'non-PLACE cannot carry executable fields'});
  }
});
export type BrainDecision = z.infer<typeof BrainDecisionSchema>;

export const AiRunSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  resourceId: z.string(),
  model: z.string(),
  role: z.enum(['SCOUT','PRIMARY_BRAIN','REVIEW_BRAIN']),
  startedAt: z.number().int(),
  completedAt: z.number().int().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  status: z.enum(['RUNNING','COMPLETED','FAILED']),
  direction: z.enum(['LONG','SHORT']).nullable().default(null),
  decision: z.string().nullable(),
  requestSource:z.enum(['ENTRY','SHADOW','RESEARCH']).optional(),
  inputContractHash:z.string().optional(),
  promptHash:z.string().optional(),
  outputContractVersion:z.string().optional(),
  finishReason:z.string().nullable().optional(),
  modelIdentity:z.record(z.unknown()).nullable().optional(),
  terminalStage:z.string().optional(),
  rawDirection: z.string().nullable().optional(),
  rawDecision: z.string().nullable().optional(),
  normalizedPreview: z.string().optional(),
  parserRepaired: z.boolean().optional(),
  protocolNormalization: z.object({
    applied: z.boolean(),
    fields: z.array(z.object({ field:z.string(), raw:z.unknown(), normalized:z.number(), rule:z.string() })).max(12),
    repairAttempted: z.boolean().default(false),
  }).optional(),
  scoutHandoff: z.boolean().optional(),
  packetId: z.string().nullable(),
  error: z.string().nullable(),
  inputPreview: z.string().optional(),
  outputPreview: z.string().optional(),
  timing: z.object({ queueMs:z.number().int().nonnegative(), promptBuildMs:z.number().int().nonnegative(), requestMs:z.number().int().nonnegative(), retryMs:z.number().int().nonnegative(), parseMs:z.number().int().nonnegative(), totalMs:z.number().int().nonnegative() }).optional(),
  failure: z.object({ failureStage:z.string(), errorCode:z.string(), errorMessage:z.string(), httpStatus:z.number().int().nullable(), timeout:z.boolean(), schemaValidation:z.boolean(), retryCount:z.number().int().nonnegative(), rawOutput:z.string().nullable() }).nullable().optional(),
});
export type AiRun = z.infer<typeof AiRunSchema>;

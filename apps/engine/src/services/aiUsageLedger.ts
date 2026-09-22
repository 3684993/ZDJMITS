import {createHash} from 'node:crypto';

/**
 * S07-E: one ledger of every model request the Engine made, including the ones that failed.
 *
 * The point of keeping the failures is that a budget is only real if it counts them, and the point of
 * `UNKNOWN` usage is that a saving is only real if the rows that report nothing stay visible. A
 * missing `usage` from the server is never turned into a zero, so a total that cannot be computed is
 * reported as not computable instead of flattering someone's dashboard.
 */

export type AiUsageRole='ENTRY'|'REVIEW'|'SCOUT'|'EXTERNAL_RESEARCH';
export type AiUsageStatus='COMPLETED'|'FAILED'|'TIMEOUT'|'TRUNCATED'|'RUNNING';

export type AiUsageRow={
  eventId:string;
  requestKey:string;
  role:AiUsageRole;
  attempt:number;
  status:AiUsageStatus;
  usageStatus:'EXACT'|'UNKNOWN';
  inputTokens:number|null;
  outputTokens:number|null;
  latencyMs:number|null;
  finishReason:string|null;
  truncated:boolean;
  promptHash:string;
  modelIdentity:string|null;
  triggerReason:string;
  cacheHit:boolean;
  symbol:string;
  scope:string|null;
  cycleId:string|null;
  planRef:string|null;
  errorCode:string|null;
  startedAt:number;
  completedAt:number|null;
  /** Transport attempts inside this request, or null when the client could not prove the count. */
  transportAttempts:number|null;
  /** Which decision consumed this row, so a review budget can be proven rather than estimated. */
  budgetKey:string|null;
};

export type AiUsageTotals={rows:number;computable:boolean;inputTokens:number|null;outputTokens:number|null;
  totalTokens:number|null;unknownUsage:number;failures:number;transportAttempts:number|null;rowsWithUnprovenAttempts:number;
  /** Rows the window had to drop. Non-zero means these totals describe a window, not a history. */
  droppedRows:number;completeHistory:boolean;
  byRole:Record<string,{rows:number;tokens:number|null;failures:number}>};

const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const idOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);

export function aiUsageEventIdOf(input:{requestKey:string;attempt:number}){return `usage_${idOf(input)}`;}

/** The request identity a review reservation opens and its answer later finalizes. One row each. */
export function reviewRequestKeyOf(triggerKey:string,reviewNumber:number){return `review:${triggerKey}:${reviewNumber}`;}

export function reviewOpeningRowOf(input:{triggerKey:string;reviewNumber:number;scope:string;cycleId:string;planRef:string;budgetKey:string;
  trigger:string;startedAt:number}):AiUsageRow{
  return aiUsageRowOf({requestKey:reviewRequestKeyOf(input.triggerKey,input.reviewNumber),role:'REVIEW',status:'RUNNING',
    promptHash:'not-yet-answered',triggerReason:`TRIGGER_${input.trigger}`,symbol:'',scope:input.scope,cycleId:input.cycleId,
    planRef:input.planRef,startedAt:input.startedAt,budgetKey:input.budgetKey});
}

/**
 * One row per request attempt. Retries are separate rows on purpose: the budget and the failure
 * attribution both need to see that two requests happened, not one merged average.
 */
export function aiUsageRowOf(input:{
  requestKey:string;attempt?:number;role:AiUsageRole;status:AiUsageStatus;
  inputTokens?:number|null;outputTokens?:number|null;latencyMs?:number|null;finishReason?:string|null;
  promptHash:string;modelIdentity?:string|null;triggerReason:string;cacheHit?:boolean;
  symbol:string;scope?:string|null;cycleId?:string|null;planRef?:string|null;errorCode?:string|null;
  startedAt:number;completedAt?:number|null;budgetKey?:string|null;transportAttempts?:number|null;
}):AiUsageRow{
  const attempt=Math.max(1,Math.trunc(Number(input.attempt??1)));
  const reported=input.inputTokens!=null||input.outputTokens!=null;
  const exact=reported&&Number.isSafeInteger(Number(input.inputTokens??-1))&&Number(input.inputTokens)>=0
    &&Number.isSafeInteger(Number(input.outputTokens??-1))&&Number(input.outputTokens)>=0;
  return{eventId:aiUsageEventIdOf({requestKey:input.requestKey,attempt}),requestKey:input.requestKey,role:input.role,attempt,
    status:input.status,usageStatus:exact?'EXACT':'UNKNOWN',
    inputTokens:exact?Number(input.inputTokens):null,outputTokens:exact?Number(input.outputTokens):null,
    latencyMs:finite(input.latencyMs)?Number(input.latencyMs):null,finishReason:input.finishReason??null,
    truncated:input.finishReason==='length'||input.status==='TRUNCATED',
    promptHash:String(input.promptHash||'missing-prompt-hash'),modelIdentity:input.modelIdentity??null,
    triggerReason:String(input.triggerReason||'UNSTATED'),cacheHit:input.cacheHit===true,
    symbol:String(input.symbol||''),scope:input.scope??null,cycleId:input.cycleId??null,planRef:input.planRef??null,
    errorCode:input.errorCode??null,startedAt:input.startedAt,completedAt:input.completedAt??null,
    transportAttempts:finite(input.transportAttempts)&&Number(input.transportAttempts)>=1?Math.trunc(Number(input.transportAttempts)):null,
    budgetKey:input.budgetKey??null};
}

export function aiUsageTotals(rows:AiUsageRow[],droppedRows=0):AiUsageTotals{
  const unique=new Map(rows.map(row=>[row.eventId,row]));
  const list=[...unique.values()];
  const dropped=Math.max(0,Math.trunc(Number(droppedRows)||0));
  const computable=list.length>0&&dropped===0&&list.every(row=>row.usageStatus==='EXACT');
  const proven=list.filter(row=>finite(row.transportAttempts));
  const byRole:Record<string,{rows:number;tokens:number|null;failures:number}>={};
  for(const row of list){
    const bucket=byRole[row.role]??{rows:0,tokens:0,failures:0};
    bucket.rows++;
    bucket.tokens=computable?Number(bucket.tokens??0)+Number(row.inputTokens)+Number(row.outputTokens):null;
    if(row.status==='FAILED'||row.status==='TIMEOUT'||row.status==='TRUNCATED')bucket.failures++;
    byRole[row.role]=bucket;
  }
  return{rows:list.length,computable,
    inputTokens:computable?list.reduce((sum,row)=>sum+Number(row.inputTokens),0):null,
    outputTokens:computable?list.reduce((sum,row)=>sum+Number(row.outputTokens),0):null,
    totalTokens:computable?list.reduce((sum,row)=>sum+Number(row.inputTokens)+Number(row.outputTokens),0):null,
    unknownUsage:list.filter(row=>row.usageStatus==='UNKNOWN').length,
    failures:list.filter(row=>row.status==='FAILED'||row.status==='TIMEOUT'||row.status==='TRUNCATED').length,
    // A count is only reported when every row proved it; otherwise the total would be a guess.
    transportAttempts:proven.length===list.length&&list.length>0?proven.reduce((sum,row)=>sum+Number(row.transportAttempts),0):null,
    rowsWithUnprovenAttempts:list.length-proven.length,droppedRows:dropped,completeHistory:dropped===0&&list.length>0,byRole};
}

/** The identity of a frozen event set: the exact rows, not a count of them. */
export function aiUsageEventSetHash(rows:AiUsageRow[]){return `set_${idOf(rows.map(row=>[row.eventId,row.status,row.usageStatus,row.inputTokens,row.outputTokens]).sort())}`;}

/**
 * The comparison the stage has to answer: did bounded review reduce token use? The answer is only
 * allowed when both sides are complete, untruncated, and were computed over the same frozen event
 * set. Anything else is NOT_MEASURED, never an invented percentage.
 */
export function tokenSavingRatio(baseline:AiUsageRow[],bounded:AiUsageRow[],frozenEventSet:{baselineHash:string;boundedHash:string;
  baselineDroppedRows?:number;boundedDroppedRows?:number}){
  const baseDropped=Math.max(0,Math.trunc(Number(frozenEventSet.baselineDroppedRows)||0));
  const boundDropped=Math.max(0,Math.trunc(Number(frozenEventSet.boundedDroppedRows)||0));
  const base=aiUsageTotals(baseline,baseDropped),bound=aiUsageTotals(bounded,boundDropped);
  if(baseDropped||boundDropped)return{status:'NOT_MEASURED',reason:'EVENT_SET_TRUNCATED',baselineTokens:null,boundedTokens:null,savingPct:null,
    baselineDroppedRows:baseDropped,boundedDroppedRows:boundDropped};
  const sameSet=frozenEventSet.baselineHash===frozenEventSet.boundedHash;
  if(!sameSet)return{status:'NOT_MEASURED',reason:'EVENT_SET_NOT_FROZEN',baselineTokens:null,boundedTokens:null,savingPct:null};
  if(!base.computable||!bound.computable)
    return{status:'NOT_MEASURED',reason:'USAGE_UNREPORTED',baselineTokens:base.totalTokens,boundedTokens:bound.totalTokens,savingPct:null,
      baselineUnknown:base.unknownUsage,boundedUnknown:bound.unknownUsage};
  if(!base.totalTokens)return{status:'NOT_MEASURED',reason:'BASELINE_HAS_NO_TOKENS',baselineTokens:base.totalTokens,boundedTokens:bound.totalTokens,savingPct:null};
  const savingPct=(base.totalTokens-bound.totalTokens)/base.totalTokens*100;
  return{status:savingPct>=30?'PASS':'FAIL',reason:savingPct>=30?'TOKEN_SAVING_ABOVE_30_PERCENT':'TOKEN_SAVING_BELOW_30_PERCENT',
    baselineTokens:base.totalTokens,boundedTokens:bound.totalTokens,savingPct:Math.round(savingPct*100)/100};
}

/**
 * Durable collection of usage rows, kept on RuntimeState and checkpointed like the other entities.
 *
 * It is a window, not an archive: once the newest `capacity` rows are held, older finalized rows are
 * dropped and the drop is counted. A caller may then say "every request in this window" truthfully,
 * and can never mistake a truncated tail for complete history.
 */
export class AiUsageLedger {
  static readonly DEFAULT_CAPACITY=5_000;
  constructor(private readonly store:{aiUsage:Map<string,AiUsageRow>;aiUsageDroppedRows:number},
    readonly capacity:number=AiUsageLedger.DEFAULT_CAPACITY){}
  record(row:AiUsageRow){
    const existing=this.store.aiUsage.get(row.eventId);
    // A completed row is never overwritten by a late duplicate; a RUNNING row is finalized once.
    if(existing&&existing.status!=='RUNNING'&&row.status==='RUNNING')return{written:false,reason:'USAGE_EVENT_ALREADY_FINALIZED',row:existing};
    this.store.aiUsage.set(row.eventId,row);
    this.prune();
    return{written:true,row};
  }
  finalize(input:AiUsageRow){return this.record(input);}
  rows(){return [...this.store.aiUsage.values()].sort((a,b)=>a.startedAt-b.startedAt||a.eventId.localeCompare(b.eventId));}
  /** Rows whose request began inside the window. Used to freeze an event set before comparing it. */
  rowsBetween(from:number,to:number){return this.rows().filter(row=>row.startedAt>=from&&row.startedAt<=to);}
  forBudget(budgetKey:string){return this.rows().filter(row=>row.budgetKey===budgetKey);}
  totals(){return aiUsageTotals(this.rows(),this.droppedRows());}
  droppedRows(){return Math.max(0,Math.trunc(Number(this.store.aiUsageDroppedRows)||0));}
  truncated(){return this.droppedRows()>0;}
  private prune(){
    const overflow=this.store.aiUsage.size-Math.max(1,Math.trunc(this.capacity));
    if(overflow<=0)return;
    const evictable=this.rows().filter(row=>row.status!=='RUNNING').slice(0,overflow);
    for(const row of evictable)this.store.aiUsage.delete(row.eventId);
    if(evictable.length)this.store.aiUsageDroppedRows=this.droppedRows()+evictable.length;
  }
}

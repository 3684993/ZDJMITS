import type {TradeRecord, ExecutionFill} from '@zdj/contracts';
import {exitQuantityUnits, parseExitScope, type ExitTask} from './s04ExitCoordinator.js';
import {normalizeExitOrderFact, type VerifiedExitOrderFact} from './exitOrderFact.js';

/**
 * P0/P1/P2 data repair, as two deterministic plans and one rule: a row changes only when a durable
 * exchange fact proves the new value.
 *
 * The audit found two kinds of stale state. Durable exit tasks still WORKING with an ACTIVE quantity
 * claim while the exchange had already filled the order (R3), and TradeRecords booked per Entry order
 * while their aggregated take-profit closed the whole physical holding (R4). Both can be repaired -
 * but only where the evidence exists, and never by writing a terminal or zero value to make a
 * dashboard look clean. Anything this module cannot prove is reported as UNKNOWN and left alone.
 */

export const ACCEPTED_EXIT_EVIDENCE=['BINANCE_EXACT_ORDER_TERMINAL','USER_DATA_WS_CUMULATIVE_FILL','EXCHANGE_AUDIT_CUMULATIVE_FILL','OPEN_ORDERS_ABSENT_TERMINAL'] as const;
export type ExitEvidenceSource=typeof ACCEPTED_EXIT_EVIDENCE[number];

export type ExitRepairRow={
  clientOrderId:string;taskId:string;scope:string;cycleId:string;
  taskState:string;claimStatus:string;claimUnits:number;
  action:'CONVERGE_TERMINAL'|'CONVERGE_NON_TERMINAL'|'KEEP_UNKNOWN'|'NO_OP';
  evidence:{source:string;observedAt:number;executedQty:number;originalQty:number}|null;
  reason:string;
  affectedScope:string|null;
};

export type ExitEvidence={clientOrderId:string;source:ExitEvidenceSource;exchangeOrderId:string|null;symbol:string;positionSide:'LONG'|'SHORT'|'BOTH';
  originalQty:number;executedQty:number;exchangeStatus:string;observedAt:number};

const terminalExchange=new Set(['FILLED','CANCELED','EXPIRED','REJECTED']);

/**
 * Decides what may change for one non-terminal task.
 *
 * A local order row that merely says FILLED is not in the accepted set: that is precisely the state
 * combination that broke, so trusting it would assume the conclusion. What does count is an exact
 * order read or a cumulative fill the exchange reported, and only when its symbol and quantity
 * identity still match the task - a mismatch is left unproven rather than released.
 */
export function planExitClaimConvergence(input:{tasks:ExitTask[];claims:Array<{id:string;scope:string;status:string;quantityUnits:number;clientOrderId?:string|null}>;evidence:ExitEvidence[];environment:string;accountId:string}):{rows:ExitRepairRow[];summary:Record<string,number>}{
  const byClient=new Map<string,ExitEvidence>();
  for(const row of input.evidence)if(row?.clientOrderId)byClient.set(String(row.clientOrderId),row);
  const claimFor=new Map(input.claims.map(claim=>[claim.id,claim]));
  const rows:ExitRepairRow[]=[];
  for(const task of input.tasks){
    const claim=claimFor.get(`claim:${task.taskId}`);
    const base={clientOrderId:task.clientOrderId,taskId:task.taskId,scope:task.scope,cycleId:task.cycleId,
      taskState:task.state,claimStatus:claim?.status??'ABSENT',claimUnits:Number(claim?.quantityUnits??0),affectedScope:task.scope};
    if(!['WORKING','PARTIALLY_FILLED','SUBMITTING','UNKNOWN'].includes(task.state)){rows.push({...base,action:'NO_OP' as const,evidence:null,reason:'TASK_ALREADY_TERMINAL'});continue;}
    const evidence=byClient.get(task.clientOrderId);
    if(!evidence){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence:null,reason:'NO_ACCEPTED_EXCHANGE_EVIDENCE'});continue;}
    if(!ACCEPTED_EXIT_EVIDENCE.includes(evidence.source)){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence:null,reason:`UNACCEPTED_EVIDENCE_SOURCE:${evidence.source}`});continue;}
    const scope=parseExitScope(task.scope);
    if(!scope){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence:null,reason:'TASK_SCOPE_UNPARSEABLE'});continue;}
    if(scope.environment!==input.environment||scope.account!==input.accountId){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence:null,reason:'EVIDENCE_SCOPE_MISMATCH'});continue;}
    if(String(evidence.symbol??'').trim().toUpperCase()!==scope.symbol){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence:null,reason:`EVIDENCE_SYMBOL_MISMATCH:${evidence.symbol}`});continue;}
    const units=(quantity:number)=>exitQuantityUnits(quantity,task.stepSize);
    const originalUnits=units(Number(evidence.originalQty));
    if(!(originalUnits>0)||originalUnits!==task.quantityUnits){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence,reason:`QUANTITY_IDENTITY_MISMATCH:${originalUnits}!=${task.quantityUnits}`});continue;}
    const executedUnits=Math.max(0,units(Number(evidence.executedQty)));
    if(executedUnits>task.quantityUnits){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence,reason:'OVER_FILL_NOT_RECONCILABLE'});continue;}
    const status=String(evidence.exchangeStatus??'').trim().toUpperCase();
    if(!terminalExchange.has(status)&&!['NEW','PARTIALLY_FILLED'].includes(status)){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence,reason:`UNSUPPORTED_EXCHANGE_STATUS:${status||'EMPTY'}`});continue;}
    // A FILLED whose own arithmetic does not show the whole order is a contradiction, not evidence:
    // the same rule the live normalizer applies (FILLED_WITHOUT_FULL_FILL_FACT), so a repair can
    // never claim a state the exchange report itself does not support.
    if(status==='FILLED'&&executedUnits!==task.quantityUnits){rows.push({...base,action:'KEEP_UNKNOWN' as const,evidence,reason:`FILLED_WITHOUT_FULL_FILL_UNITS:${executedUnits}!=${task.quantityUnits}`});continue;}
    const terminal=status==='FILLED'||['CANCELED','EXPIRED','REJECTED'].includes(status);
    rows.push({...base,action:terminal?'CONVERGE_TERMINAL' as const:'CONVERGE_NON_TERMINAL' as const,
      evidence:{source:evidence.source,observedAt:Number(evidence.observedAt),executedQty:Number(evidence.executedQty),originalQty:Number(evidence.originalQty)},
      reason:terminal?`EXCHANGE_TERMINAL_${status}`:`EXCHANGE_NON_TERMINAL_${status}`});
  }
  // Every action is counted, including zero: an operator readback must not lose a category just
  // because nothing fell into it this time.
  const summary:Record<string,number>={CONVERGE_TERMINAL:0,CONVERGE_NON_TERMINAL:0,KEEP_UNKNOWN:0,NO_OP:0};
  for(const row of rows)summary[row.action]=(summary[row.action]??0)+1;
  return{rows,summary:{...summary,total:rows.length}};
}

/**
 * Turns an approved repair row back into the one fact shape every reader uses, by rebuilding the
 * exchange report and sending it through the same normalizer a live query would use. A repair
 * therefore cannot create a second, weaker write path around the reducer: anything the normalizer or
 * the reducer refuses simply does not happen.
 */
export function exitFactsForRepair(rows:ExitRepairRow[],tasks:ExitTask[],evidence:ExitEvidence[],identity:{environment:string;accountId:string}):VerifiedExitOrderFact[]{
  const byTask=new Map(tasks.map(task=>[task.taskId,task]));
  const evidenceByClient=new Map(evidence.map(row=>[String(row.clientOrderId),row]));
  const facts:VerifiedExitOrderFact[]=[];
  for(const row of rows){
    if(row.action!=='CONVERGE_TERMINAL'&&row.action!=='CONVERGE_NON_TERMINAL')continue;
    const task=byTask.get(row.taskId),source=evidenceByClient.get(row.clientOrderId);
    if(!task||!source)continue;
    const fact=normalizeExitOrderFact({source:'STARTUP_RECOVERY',environment:identity.environment,accountId:identity.accountId,
      order:{symbol:source.symbol,clientOrderId:source.clientOrderId,exchangeOrderId:source.exchangeOrderId,positionSide:source.positionSide,
        status:source.exchangeStatus,originalQuantity:source.originalQty,executedQuantity:source.executedQty,updateTime:source.observedAt},
      observedAt:Number(source.observedAt)||Date.now(),
      reportId:`REPAIR:${task.taskId}:${source.source}:${task.version}`});
    if(fact&&fact.coverage.proof)fact.coverage.proof.push(`REPAIR_PLAN:${row.action}`);
    if(fact)facts.push(fact);
  }
  return facts;
}

export type CycleAssignment={fillId:string;tradeId:string;physicalCycleId:string;entryLotId:string|null;openedAt:number;boundaryProven:boolean;reason:string|null};

export type CycleBackfillPlan={
  assignments:CycleAssignment[];
  superseded:Array<{oldTradeId:string;oldCycleId:string;newPhysicalCycleId:string;reason:string}>;
  unproven:Array<{symbol:string;side:string;tradeId:string|null;reason:string}>;
  inconsistent:Array<{symbol:string;side:string;physicalCycleId:string;remainingQty:number;fillId:string}>;
  summary:{fills:number;assigned:number;cycles:number;unproven:number;inconsistent:number};
};

/**
 * Rebuilds the physical holding of one symbol and side from the exchange fills alone.
 *
 * A cycle opens at the first fill after a proven zero and closes when the running quantity returns to
 * zero on fill evidence. A stretch that never returns to zero, or that goes negative, is reported
 * rather than guessed at: only a credible boundary may start a new cycle, because inventing one would
 * split an open holding into two closed trades. The original record ids are kept as `superseded`
 * mappings so the previous accounting stays auditable instead of being deleted.
 */
export function planCycleBackfill(input:{fills:ExecutionFill[];records:TradeRecord[];environment?:string;accountId?:string}):CycleBackfillPlan{
  const bySymbolSide=new Map<string,ExecutionFill[]>();
  for(const fill of input.fills){
    const direction=fill.direction??(fill.side==='BUY'?'LONG':'SHORT');
    const key=`${fill.symbol}:${direction}`;
    const list=bySymbolSide.get(key)??[];list.push(fill);bySymbolSide.set(key,list);
  }
  const assignments:CycleAssignment[]=[],unproven:CycleBackfillPlan['unproven']=[],inconsistent:CycleBackfillPlan['inconsistent']=[],superseded:CycleBackfillPlan['superseded']=[];
  let cycles=0;
  for(const [key,list] of [...bySymbolSide.entries()].sort()){
    const [symbol,side]=key.split(':') as ['string','LONG'|'SHORT'];
    const ordered=[...list].sort((a,b)=>a.executionTime-b.executionTime||String(a.tradeId).localeCompare(String(b.tradeId)));
    let running=0,cycleId:string|null=null,openedAt=0,boundaryProven=true,untrusted:string|null=null;
    for(const fill of ordered){
      const entrySide=side==='LONG'?'BUY':'SELL';
      const delta=fill.side===entrySide?Number(fill.qty):-Number(fill.qty);
      // Once the running quantity for a symbol and side contradicts itself, every later fill in that
      // group is unattributable: guessing a boundary would split one holding into two closed trades.
      if(untrusted){unproven.push({symbol,side,tradeId:fill.tradeId,reason:`LEDGER_UNTRUSTED_AFTER:${untrusted}`});continue;}
      const previousRunning=running;
      const opening=previousRunning===0&&cycleId==null&&delta>0;
      running+=delta;
      if(cycleId==null){
        if(running<=-1e-12){
          unproven.push({symbol,side,tradeId:fill.tradeId,reason:'EXIT_WITHOUT_OPENING_FILL'});
          untrusted='EXIT_WITHOUT_OPENING_FILL';continue;
        }
        cycleId=`pcycle_${symbol}_${side}_${String(fill.tradeId)}`;openedAt=fill.executionTime;cycles++;boundaryProven=true;
      } else if(running<-1e-9){
        inconsistent.push({symbol,side,physicalCycleId:cycleId,remainingQty:running,fillId:fill.fillId});
        untrusted='NEGATIVE_RUNNING_QUANTITY';unproven.push({symbol,side,tradeId:fill.tradeId,reason:'EXIT_LARGER_THAN_RUNNING_QUANTITY'});
        continue;
      }
      const eps=Math.max(1e-10,Math.abs(previousRunning)*1e-8);
      const closed=Math.abs(running)<=eps;
      assignments.push({fillId:fill.fillId,tradeId:fill.tradeId,physicalCycleId:cycleId,
        entryLotId:fill.side===entrySide?(fill.entryLotId??fill.orderId??null):null,openedAt,boundaryProven,
        reason:closed?'CYCLE_CLOSED_ON_THIS_FILL':opening?'CYCLE_OPENED_ON_THIS_FILL':null});
      if(closed){cycleId=null;openedAt=0;running=0;continue;}
      boundaryProven=true;
    }
    if(cycleId!=null&&!untrusted)unproven.push({symbol,side,tradeId:null,reason:'HOLDING_STILL_OPEN_AT_LAST_FILL'});
  }
  for(const record of input.records){
    const target=assignments.find(row=>row.tradeId&&record.linkedFillIds?.includes(row.fillId));
    if(!target)continue;
    // Already keyed - either the record carries the physical id itself, or a previous apply wrote
    // `positionCycleId`. A re-run must then be a no-op instead of churn.
    if(target.physicalCycleId===record.cycleId||record.positionCycleId===target.physicalCycleId)continue;
    superseded.push({oldTradeId:record.tradeId,oldCycleId:String(record.cycleId??'null'),newPhysicalCycleId:target.physicalCycleId,
      reason:record.remainingQty!=null&&record.remainingQty<0?'QUANTITY_NEGATIVE_UNDER_ENTRY_ORDER_KEYING':'ENTRY_ORDER_KEYED_RECORD_SPANS_ONE_PHYSICAL_HOLDING'});
  }
  const order=(a:{symbol?:string;side?:string;tradeId?:string|null;oldTradeId?:string;fillId?:string;reason?:string},
    b:{symbol?:string;side?:string;tradeId?:string|null;oldTradeId?:string;fillId?:string;reason?:string})=>
    `${a.symbol??''}|${a.side??''}|${a.tradeId??a.oldTradeId??a.fillId??''}|${a.reason??''}`.localeCompare(`${b.symbol??''}|${b.side??''}|${b.tradeId??b.oldTradeId??b.fillId??''}|${b.reason??''}`);
  return{assignments,superseded:superseded.sort(order),unproven:unproven.sort(order),inconsistent:inconsistent.sort(order),
    summary:{fills:input.fills.length,assigned:assignments.length,cycles,unproven:unproven.length,inconsistent:inconsistent.length}};
}

/** The audit record a repair apply writes: what changed, on what evidence, and what was left alone. */
export function repairAuditRecord(input:{job:string;preview:boolean;environment:string;accountId:string;plan:Record<string,unknown>;applied?:Record<string,unknown>|null;identityKeys:string[];leftUnknown:string[]}){
  return{kind:'V396_TRADING_LOOP_REPAIR',job:input.job,mode:input.preview?'PREVIEW':'APPLY',at:Date.now(),
    environment:input.environment,account:input.accountId,identityKeys:input.identityKeys,leftUnknown:input.leftUnknown,
    plan:input.plan,applied:input.applied??null,
    idempotencyKey:`${input.job}:${input.environment}:${input.accountId}:${input.identityKeys.slice(0,64).join('|')}`};
}

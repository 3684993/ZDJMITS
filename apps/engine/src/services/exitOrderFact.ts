import type {ExitTaskState} from './s04ExitCoordinator.js';

/**
 * A single fact about one exit order as the exchange reported it.
 *
 * Before V3.9.7 each writer (WS, exact-order query, open-order reconciliation, startup recovery,
 * TP cancel/replace) updated only the slice of state it happened to own, so a TP could be FILLED
 * in the order book while its durable task and quantity claim stayed WORKING/ACTIVE forever.
 * Every one of those paths now produces this shape and hands it to one idempotent reducer.
 */
export type ExitFactSource='USER_DATA_WS'|'EXACT_ORDER'|'OPEN_ORDERS'|'STARTUP_RECOVERY'|'CANCEL_RESULT'|'REPLACE_RESULT'|'REJECTED_AT_SUBMIT'|'TP_SUBMIT_RESULT'|'TP_RECOVERY_QUERY';

export type VerifiedExitOrderFact={
  environment:string;
  accountId:string;
  symbol:string;
  positionSide:'LONG'|'SHORT'|'BOTH';
  clientOrderId:string;
  exchangeOrderId:string|null;
  originalQty:number;
  executedQty:number;
  /** Raw exchange status string, kept verbatim so the projection can show what was actually said. */
  exchangeStatus:string;
  state:ExitTaskState;
  /** Stable per-report identity: the same exchange report must never be applied twice. */
  eventId:string;
  sequence:number|null;
  source:ExitFactSource;
  observedAt:number;
  /** How much of the exchange answer is trusted: a partial report cannot prove a terminal state. */
  coverage:{proven:boolean;proof:string[];reason?:string};
};

export const EXCHANGE_TERMINAL_STATUS=['FILLED','CANCELED','EXPIRED','REJECTED'] as const;
export const EXIT_TERMINAL_STATES:ExitTaskState[]=['FILLED','CANCELED','REJECTED','EXPIRED'];

const rawStatus=(value:unknown)=>String(value??'').trim().toUpperCase();

/** Maps an exchange status plus its fill arithmetic onto the task vocabulary. */
export function exitStateFromExchange(input:{status:unknown;executedQty:number;originalQty:number}):{state:ExitTaskState|null;reason:string|null}{
  const status=rawStatus(input.status);
  if(status==='FILLED')return input.executedQty>0&&input.executedQty+1e-12>=input.originalQty
    ?{state:'FILLED',reason:null}
    :{state:null,reason:'FILLED_WITHOUT_FULL_FILL_FACT'};
  if(status==='CANCELED'||status==='EXPIRED'||status==='REJECTED')return{state:status as ExitTaskState,reason:null};
  if(status==='PARTIALLY_FILLED')return input.executedQty>0?{state:'PARTIALLY_FILLED',reason:null}:{state:'WORKING',reason:null};
  if(status==='NEW'||status==='WORKING')return{state:'WORKING',reason:null};
  return{state:null,reason:`UNSUPPORTED_EXCHANGE_STATUS:${status||'EMPTY'}`};
}

/**
 * Builds the one fact shape from whatever a reader returned. Identity is checked here rather than
 * left to each caller: a report whose symbol, client id or quantity contradicts the durable task
 * is not evidence, and applying it would free a claim that the exchange never released.
 */
export function normalizeExitOrderFact(input:{
  source:ExitFactSource;
  environment:string;accountId:string;
  order:{symbol?:unknown;clientOrderId?:unknown;exchangeOrderId?:unknown;positionSide?:unknown;status?:unknown;originalQuantity?:unknown;executedQuantity?:unknown;updateTime?:unknown;sequence?:unknown};
  observedAt?:number;
  reportId?:string;
}):VerifiedExitOrderFact|null{
  const order=input.order;
  const symbol=String(order.symbol??'').trim().toUpperCase(),clientOrderId=String(order.clientOrderId??'').trim();
  const environment=String(input.environment??'').trim(),accountId=String(input.accountId??'').trim();
  if(!symbol||!clientOrderId||!environment||!accountId)return null;
  const originalQty=Number(order.originalQuantity??0),executedQty=Number(order.executedQuantity??0);
  if(!Number.isFinite(originalQty)||originalQty<=0||!Number.isFinite(executedQty)||executedQty<0||executedQty>originalQty+1e-12)return null;
  const positionSide=String(order.positionSide??'').trim().toUpperCase();
  if(!['LONG','SHORT','BOTH'].includes(positionSide))return null;
  const mapped=exitStateFromExchange({status:order.status,executedQty,originalQty});
  const observedAt=Number(input.observedAt??Date.now());
  const exchangeOrderId=String(order.exchangeOrderId??'').trim()||null;
  const sequence=Number.isSafeInteger(Number(order.sequence))?Number(order.sequence):null;
  const proof=[input.source,`STATUS_${rawStatus(order.status)||'EMPTY'}`,exchangeOrderId?'EXCHANGE_ORDER_ID_PRESENT':'EXCHANGE_ORDER_ID_ABSENT'];
  if(!mapped.state)return null;
  return{
    environment,accountId,symbol,positionSide:positionSide as 'LONG'|'SHORT'|'BOTH',clientOrderId,exchangeOrderId,
    originalQty,executedQty:Math.min(executedQty,originalQty),exchangeStatus:rawStatus(order.status),state:mapped.state,
    eventId:input.reportId??`EXIT_FACT:${JSON.stringify([environment,accountId,symbol,clientOrderId,mapped.state,Math.round(executedQty*1e8),rawStatus(order.status)])}`,
    sequence,source:input.source,observedAt:Number.isFinite(observedAt)?observedAt:Date.now(),
    coverage:{proven:true,proof},
  };
}

/** A terminal fact is only trusted when its own coverage says so and the identity is complete. */
export function exitFactProvesTerminal(fact:VerifiedExitOrderFact){
  return EXIT_TERMINAL_STATES.includes(fact.state)&&fact.coverage.proven===true&&fact.coverage.reason==null;
}

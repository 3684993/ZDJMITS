import type { LineageEvent } from './runExecutionOutcome.js';

export const ORDER_LIFECYCLE_EVENTS = [
  'ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED','ENTRY_SUBMIT_RESPONSE_RECOVERED',
  'ENTRY_ORDER_SUBMISSION_UNKNOWN','ENTRY_ORDER_USER_DATA_CONFIRMED','ORDER_FILL_RECONCILED',
  'ENTRY_FILLED','ENTRY_ORDER_TERMINAL_RECONCILED','ENTRY_ORDER_TTL_CLOSED',
  'ENTRY_ORDER_CANCELED_MANUAL','ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_CANCEL_UNVERIFIED',
  'PENDING_ENTRY_REVIEW_COMPLETED','PENDING_ENTRY_REVIEW_ACTION_CONVERGED',
  'PENDING_ENTRY_REVIEW_ACTION_UNVERIFIED','ENTRY_ORDER_REPRICED',
] as const;
const terminal = new Set(['FILLED','CANCELED','EXPIRED','REJECTED']);
const active = new Set(['NEW','WORKING','PARTIALLY_FILLED']);
const normalized = (status: unknown) => status === 'NEW' ? 'WORKING' : String(status ?? 'UNKNOWN');
const number = (value: unknown) => value != null && Number.isFinite(Number(value)) ? Number(value) : null;

/** Pure, read-only identity join. Never uses symbol or temporal proximity to assign ownership. */
export function entryOrderHistory(orders: any[], events: LineageEvent[], now = Date.now()) {
  const rows = new Map<string, any>();
  for (const order of orders) rows.set(order.id, {...order, decisionRunId: order.decisionChainId ?? null,
    lifecycleStatus:'UNKNOWN', statusAuthority:'LOCAL_ONLY', lastExchangeVerifiedAt:null,
    terminalAt:null, canceledAt:null, firstFillAt:null, lastFillAt:null, terminalReason:null,
    wasSubmitted:Boolean(order.submittedAt), review:[], orderAttempts:[], repriceHistory:[], evidenceIncomplete:false});
  const ordered = [...events].sort((a,b)=>a.ts-b.ts);
  // Introducers establish ownership before Review events (whose runId is a different model run).
  for (const e of ordered) {
    const p:any=e.payload??{}, o=p.order??{};
    if(e.type!=='ENTRY_ORDER_CREATED')continue;
    const id=o.id??p.orderId;if(!id)continue;
    const run=o.decisionChainId??p.brainRunId??p.decisionChainId??p.intent?.brainRunId;
    if(!rows.has(id))rows.set(id,{...o,decisionRunId:run??null,lifecycleStatus:'UNKNOWN',statusAuthority:'LOCAL_ONLY',lastExchangeVerifiedAt:null,terminalAt:null,canceledAt:null,firstFillAt:null,lastFillAt:null,terminalReason:null,wasSubmitted:true,review:[],orderAttempts:[],repriceHistory:[],evidenceIncomplete:false});
    const row=rows.get(id)!;
    if(run&&row.decisionRunId&&run!==row.decisionRunId){row.evidenceIncomplete=true;row.ownershipConflict=true;continue;}
    row.decisionRunId??=run??null;
  }
  for(const e of ordered){
    const p:any=e.payload??{},o=p.order??{},id=p.orderId??o.id;
    let row=id?rows.get(id):null;
    if(!row&&p.clientOrderId){const matches=[...rows.values()].filter(r=>r.clientOrderId===p.clientOrderId);if(matches.length===1)row=matches[0];}
    if(!row)continue;
    // A mismatched exact identity cannot change this order's status, even under the same run.
    const client=p.clientOrderId??o.clientOrderId, exchange=p.exchangeOrderId??o.exchangeOrderId;
    const introduced=e.type==='ENTRY_ORDER_CREATED'||e.type==='ENTRY_SUBMIT_RESPONSE_RECOVERED';
    const knownAttempt=row.orderAttempts.some((a:any)=>exchange&&String(a.exchangeOrderId)===String(exchange)&&(!client||a.clientOrderId===client));
    if(!introduced&&exchange&&row.exchangeOrderId&&String(exchange)!==String(row.exchangeOrderId)&&!knownAttempt){row.evidenceIncomplete=true;continue;}
    const attemptKey=exchange??client??row.exchangeOrderId??row.clientOrderId;
    let attempt=row.orderAttempts.find((a:any)=>a.identity===attemptKey || (exchange&&String(a.exchangeOrderId)===String(exchange)) || (client&&a.clientOrderId===client&&(!a.exchangeOrderId||!exchange)));
    if(attempt&&exchange&&!attempt.exchangeOrderId){attempt.exchangeOrderId=exchange;attempt.identity=exchange;}
    if(!attempt&&attemptKey){attempt={identity:attemptKey,clientOrderId:client??row.clientOrderId??null,exchangeOrderId:exchange??null,submittedAt:null,lifecycleStatus:'UNKNOWN',filledQuantity:null,terminalAt:null,lastExchangeVerifiedAt:null};row.orderAttempts.push(attempt);}
    if(client&&row.clientOrderId&&client!==row.clientOrderId&&!introduced&&!knownAttempt){row.evidenceIncomplete=true;continue;}
    if(e.type==='ENTRY_ORDER_CREATED'||e.type==='ENTRY_SUBMIT_RESPONSE_RECOVERED'){
      row.wasSubmitted=true;row.submittedAt??=number(o.submittedAt)??e.ts;
      if(attempt)attempt.submittedAt??=number(o.submittedAt)??e.ts;
    }
    if(e.type==='PENDING_ENTRY_REVIEW_COMPLETED')row.review.push({at:e.ts,decision:p.decision,reviewRunId:p.runId??null,reason:p.reason??null});
    if(e.type==='PENDING_ENTRY_REVIEW_ACTION_CONVERGED'){row.review.push({at:e.ts,decision:p.decision,reason:p.reason??null,confirmed:p.confirmed===true});row.terminalReason=p.reason??row.terminalReason;}
    if(e.type==='ENTRY_ORDER_REPRICED'){row.repriceHistory.push({at:e.ts,from:p.from,to:p.to,reason:p.reason??null});if(!exchange&&!client){row.evidenceIncomplete=true;row.lifecycleStatus='UNKNOWN';row.statusAuthority='REPRICE_IDENTITY_UNAVAILABLE';}}
    if(e.type==='ENTRY_ORDER_TTL_CLOSED'){row.terminalReason=p.reason??null;row.localTtlExpiredAt=e.ts;if(p.remoteExactLookup==='ABSENT'||p.exchangeTerminalStatus==='UNKNOWN'){row.lifecycleStatus='UNKNOWN';row.statusAuthority='LOCAL_ONLY';}}
    const status=normalized(p.exchangeTerminalStatus??p.exchangeStatus??p.status??o.status??(e.type==='ENTRY_FILLED'?'FILLED':undefined));
    const proven = e.type==='ENTRY_ORDER_USER_DATA_CONFIRMED'&&Boolean(client&&exchange)
      ||e.type==='ENTRY_ORDER_CREATED'&&Boolean(o.exchangeOrderId&&o.clientOrderId)
      ||e.type==='ENTRY_SUBMIT_RESPONSE_RECOVERED'&&Boolean(exchange&&client)
      ||e.type==='PENDING_ENTRY_REVIEW_ACTION_CONVERGED'&&p.confirmed===true
      ||e.type==='ENTRY_ORDER_TTL_CLOSED'&&terminal.has(String(p.exchangeTerminalStatus))
      ||e.type==='ENTRY_ORDER_TERMINAL_RECONCILED'&&Boolean(exchange&&client)&&p.exchangeTerminalStatus!=='UNKNOWN'
      ||e.type==='ENTRY_ORDER_CANCELED_MANUAL'&&Boolean(exchange&&client)&&p.confirmed===true
      ||['ORDER_FILL_RECONCILED','ENTRY_FILLED'].includes(e.type)&&Boolean((exchange??row.exchangeOrderId)&&(client??row.clientOrderId));
    if(proven&&(active.has(status)||terminal.has(status))){
      const rank=e.type==='ENTRY_ORDER_USER_DATA_CONFIRMED'||p.source==='BINANCE_EXACT_ORDER'?3:2;
      if(attempt&&Number(attempt.statusAuthorityRank??0)>rank)continue;
      const qty=number(p.filledQuantity??o.filledQuantity);
      // Terminal evidence is sticky against delayed active snapshots for the same exchange attempt.
      if(attempt&&terminal.has(attempt.lifecycleStatus)&&active.has(status))continue;
      if(attempt){attempt.statusAuthorityRank=rank;attempt.lifecycleStatus=status;attempt.filledQuantity=qty??attempt.filledQuantity;attempt.lastExchangeVerifiedAt=e.ts;if(terminal.has(status))attempt.terminalAt=e.ts;}
      const currentIdentity=!row.exchangeOrderId||!exchange||String(exchange)===String(row.exchangeOrderId);
      if(currentIdentity){
        if(Number(row.statusAuthorityRank??0)>rank)continue;
        row.statusAuthorityRank=rank;row.lifecycleStatus=status;row.statusAuthority=e.type==='ENTRY_ORDER_USER_DATA_CONFIRMED'?'BINANCE_USER_DATA_WS':'DURABLE_EXACT_ORDER';row.lastExchangeVerifiedAt=e.ts;row.filledQuantity=qty??row.filledQuantity;
        if(terminal.has(status)){row.terminalAt=e.ts;if(status==='CANCELED')row.canceledAt=e.ts;}
        if(Number(qty)>0){row.firstFillAt??=e.ts;row.lastFillAt=e.ts;}
      }
    }else if(['ENTRY_ORDER_SUBMISSION_UNKNOWN','ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_CANCEL_UNVERIFIED','PENDING_ENTRY_REVIEW_ACTION_UNVERIFIED'].includes(e.type)&&!terminal.has(row.lifecycleStatus)){
      row.lifecycleStatus='UNKNOWN';row.statusAuthority='REMOTE_UNVERIFIED';row.terminalReason=p.reason??null;
    }
  }
  for(const row of rows.values()){
    if(row.lastExchangeVerifiedAt==null&&row.exchangeTerminalStatus&&terminal.has(row.exchangeTerminalStatus)&&row.clientOrderId&&row.exchangeOrderId){row.lifecycleStatus=row.exchangeTerminalStatus;row.statusAuthority='DURABLE_RECONCILED_RECORD';row.lastExchangeVerifiedAt=number(row.verifiedAt??row.updatedAt);row.terminalAt=row.lastExchangeVerifiedAt;}
    if(['BINANCE_EXACT_ORDER','BINANCE_USER_DATA_WS','BINANCE_OPEN_ORDERS'].includes(row.factSource)&&row.clientOrderId&&row.exchangeOrderId&&number(row.verifiedAt)!=null&&Number(row.verifiedAt)>Number(row.lastExchangeVerifiedAt??0)){
      const status=normalized(row.status);if(!(terminal.has(row.lifecycleStatus)&&active.has(status))&&(active.has(status)||terminal.has(status))){row.lifecycleStatus=status;row.statusAuthority=row.factSource;row.statusAuthorityRank=3;row.lastExchangeVerifiedAt=Number(row.verifiedAt);if(terminal.has(status)){row.terminalAt=number(row.updatedAt);if(status==='CANCELED')row.canceledAt=row.terminalAt;}}
    }
    if(row.factSource==='LOCAL_NOT_SUBMITTED'&&!row.wasSubmitted){row.lifecycleStatus='REJECTED';row.statusAuthority='LOCAL_NOT_SUBMITTED';row.terminalAt=number(row.updatedAt);}
    if(row.localTtlExpiredAt&&row.lifecycleStatus==='UNKNOWN')row.lifecycleStatus='LOCAL_TTL_EXPIRED_REMOTE_UNKNOWN';
    if(row.ownershipConflict){row.lifecycleStatus='UNKNOWN';row.statusAuthority='OWNERSHIP_CONFLICT';row.terminalAt=null;}
    row.filledQuantity=number(row.filledQuantity);
    if(row.clientOrderId&&row.exchangeOrderId&&!row.orderAttempts.some((a:any)=>String(a.exchangeOrderId)===String(row.exchangeOrderId))){row.orderAttempts.push({identity:row.exchangeOrderId,clientOrderId:row.clientOrderId,exchangeOrderId:row.exchangeOrderId,submittedAt:Number(row.repriceCount??0)>0?null:row.submittedAt??null,lifecycleStatus:row.lifecycleStatus,filledQuantity:row.filledQuantity,terminalAt:row.terminalAt,lastExchangeVerifiedAt:row.lastExchangeVerifiedAt});}
    row.attemptFilledQuantity=row.orderAttempts.length&&row.orderAttempts.every((a:any)=>a.filledQuantity!=null)?row.orderAttempts.reduce((sum:number,a:any)=>sum+Number(a.filledQuantity),0):null;
    row.timestampAuthority='DURABLE_EVENT_OBSERVATION';
    const fills=row.verifiedExchangeFills??[];if(fills.length){row.firstFillAt=Math.min(...fills.map((f:any)=>f.executionTime));row.lastFillAt=Math.max(...fills.map((f:any)=>f.executionTime));row.timestampAuthority='BINANCE_TRADE_EXECUTION';}
    row.remainingQuantity=row.filledQuantity==null?null:Math.max(0,Number(row.quantity)-row.filledQuantity);
    if(row.lifecycleStatus==='CANCELED'&&Number(row.filledQuantity)>0)row.lifecycleStatus='CANCELED_PARTIAL_FILL';
    row.freshness=row.lastExchangeVerifiedAt==null?'UNKNOWN':terminal.has(row.lifecycleStatus)||row.lifecycleStatus==='CANCELED_PARTIAL_FILL'?'TERMINAL':now-row.lastExchangeVerifiedAt<=30_000?'FRESH':'STALE';
  }
  return [...rows.values()].sort((a,b)=>Number(b.createdAt??0)-Number(a.createdAt??0)||String(a.id).localeCompare(String(b.id)));
}

export function entryHistoryPage(rows:any[],query:Record<string,unknown>,now=Date.now()){
  const bounded=(value:unknown,fallback:number,min:number,max:number)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.trunc(Number(value)))):fallback;
  const days=bounded(query.days,7,1,30),limit=bounded(query.limit,50,1,100),offset=bounded(query.offset,0,0,1_000_000),since=now-days*86400000;
  const window=rows.filter(r=>Number(r.createdAt??0)>=since);
  const filtered=window.filter(r=>!query.status||query.status==='ALL'||r.lifecycleStatus===query.status);
  return {items:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,since,until:now,olderHiddenCount:rows.length-window.length,readOnly:true};
}

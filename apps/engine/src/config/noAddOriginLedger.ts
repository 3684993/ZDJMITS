import type {DatabaseSync} from 'node:sqlite';
import type {OriginAuthorization} from '../services/noSeparateAdd.js';
const key=(environment:string,account:string,symbol:string,side:string)=>JSON.stringify([environment,account,symbol,side]);
export function createNoAddOriginSchema(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS v398_entry_origins(intent_id TEXT PRIMARY KEY,subject_key TEXT NOT NULL,client_order_id TEXT NOT NULL,quantity REAL NOT NULL CHECK(quantity>0),created_at INTEGER NOT NULL,released_at INTEGER NOT NULL DEFAULT 0);
 CREATE UNIQUE INDEX IF NOT EXISTS v398_entry_origin_active_subject ON v398_entry_origins(subject_key) WHERE released_at=0;`);
}
export function readNoAddOrigin(db:DatabaseSync,environment:string,account:string,symbol:string,side:string):OriginAuthorization|null{
 const row=db.prepare('SELECT intent_id,client_order_id,quantity,created_at FROM v398_entry_origins WHERE subject_key=? AND released_at=0').get(key(environment,account,symbol,side)) as any;
 return row?{intentId:row.intent_id,clientOrderId:row.client_order_id,quantity:row.quantity,createdAt:row.created_at}:null;
}
/** Caller owns BEGIN IMMEDIATE together with the exact submission journal claim. No network here. */
export function claimNoAddOrigin(db:DatabaseSync,input:{environment:string;account:string;symbol:string;side:string;intentId:string;clientOrderId:string;quantity:number;now:number}):string|null{
 if(input.environment!=='TESTNET'||!['LONG','SHORT'].includes(input.side)||!input.symbol||!input.account||!input.intentId||!input.clientOrderId||!Number.isFinite(input.quantity)||input.quantity<=0||!Number.isSafeInteger(input.now)||input.now<=0)return'NO_ADD_ORIGIN_FACT_UNPROVEN';
 const own=db.prepare('SELECT * FROM v398_entry_origins WHERE intent_id=?').get(input.intentId) as any;
 if(own){
  if(own.released_at>0)return'NO_ADD_ORIGIN_RELEASED_IDENTITY';
  if(own.subject_key!==key(input.environment,input.account,input.symbol,input.side)||own.client_order_id!==input.clientOrderId||Math.abs(own.quantity-input.quantity)>1e-10)return'NO_ADD_ORIGIN_IDENTITY_OR_QUANTITY_CONFLICT';
  return null;
 }
 if(readNoAddOrigin(db,input.environment,input.account,input.symbol,input.side))return'NO_SEPARATE_ADD_ORIGIN_AUTHORIZATION_EXISTS';
 db.prepare('INSERT INTO v398_entry_origins(intent_id,subject_key,client_order_id,quantity,created_at) VALUES(?,?,?,?,?)').run(input.intentId,key(input.environment,input.account,input.symbol,input.side),input.clientOrderId,input.quantity,input.now);
 return null;
}
export type NoAddFlatSnapshot={environment:string;account:string;requestedAt:number;observedAt:number;fullOrderScan:boolean;positions:Array<{symbol:string;side:string;quantity:number}>;openOrders:Array<{symbol:string;side:string;positionSide?:string;quantity?:number}>};
/** Release is conservative and bounded; a missing archive/terminal/closed quantity never grants Entry. */
export function releaseFlatNoAddOrigins(db:DatabaseSync,snapshot:NoAddFlatSnapshot){
 if(snapshot.environment!=='TESTNET'||!snapshot.fullOrderScan||!Number.isSafeInteger(snapshot.requestedAt)||snapshot.requestedAt<=0||snapshot.observedAt<snapshot.requestedAt||snapshot.observedAt-snapshot.requestedAt>30_000||snapshot.observedAt>Date.now()+1000||!Array.isArray(snapshot.positions)||!Array.isArray(snapshot.openOrders))return 0;
 const rows=db.prepare('SELECT * FROM v398_entry_origins WHERE released_at=0 LIMIT 257').all() as any[];
 if(rows.length>256)return 0;
 let released=0;
 for(const row of rows){
  let scope:string[];try{scope=JSON.parse(row.subject_key);}catch{continue;}
  const [environment,account,symbol,side]=scope;
  if(environment!==snapshot.environment||account!==snapshot.account||snapshot.requestedAt<=row.created_at)continue;
  if(snapshot.positions.some(p=>p.symbol===symbol&&p.side===side&&(!(Number.isFinite(p.quantity))||p.quantity>0)))continue;
  // Open-order ambiguity is occupied, including opposite-role/unknown side orders for this symbol.
  if(snapshot.openOrders.some(o=>o.symbol===symbol))continue;
  const task=db.prepare('SELECT payload FROM entry_execution_tasks WHERE intent_id=?').get(row.intent_id) as any;
  let record:any;try{record=JSON.parse(task?.payload??'null');}catch{continue;}
  const order=record?.order;
  if(!order||order.clientOrderId!==row.client_order_id||order.symbol!==symbol||order.side!==side||!['FILLED','CANCELED','EXPIRED','REJECTED'].includes(order.exchangeTerminalStatus)||!Number.isFinite(order.filledQuantity)||order.filledQuantity<0||order.filledQuantity>row.quantity+1e-9||!Number.isFinite(order.updatedAt)||order.updatedAt>snapshot.requestedAt)continue;
  if(order.filledQuantity>0){
   const trade=db.prepare('SELECT payload FROM trade_records WHERE trade_id=?').get(`trade_cycle_entry_${row.intent_id}`) as any;
   let cycle:any;try{cycle=JSON.parse(trade?.payload??'null');}catch{continue;}
   if(!cycle||cycle.symbol!==symbol||cycle.direction!==side||cycle.entryIntentId!==row.intent_id||cycle.status!=='CLOSED'||cycle.ledgerConservation!=='CONSERVED'||!Number.isFinite(cycle.entryQty)||cycle.entryQty<order.filledQuantity-1e-9||cycle.entryQty>row.quantity+1e-9||!Number.isFinite(cycle.exitQty)||Math.abs(cycle.exitQty-cycle.entryQty)>1e-9||cycle.remainingQty!==0||!Number.isFinite(cycle.closedAt)||cycle.closedAt>snapshot.requestedAt||cycle.closedAt<row.created_at)continue;
  }
  released+=Number(db.prepare('UPDATE v398_entry_origins SET released_at=? WHERE intent_id=? AND released_at=0').run(snapshot.observedAt,row.intent_id).changes);
 }
 return released;
}

import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {claimNoAddOrigin,createNoAddOriginSchema,readNoAddOrigin,releaseFlatNoAddOrigins} from './noAddOriginLedger.js';
const input=(intentId='origin',side='LONG')=>({environment:'TESTNET',account:'local',symbol:'ETHUSDT',side,intentId,clientOrderId:`client_${intentId}`,quantity:10,now:Date.now()-1000});
it('the same SQLite subject survives restart and excludes concurrent independent intents atomically',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'v398-no-add-')),file=path.join(dir,'journal.sqlite');
 let a=new DatabaseSync(file),b=new DatabaseSync(file);
 try{
  createNoAddOriginSchema(a);a.exec('BEGIN IMMEDIATE');expect(claimNoAddOrigin(a,input())).toBeNull();
  expect(()=>b.exec('BEGIN IMMEDIATE')).toThrow();a.exec('COMMIT');
  b.exec('BEGIN IMMEDIATE');expect(claimNoAddOrigin(b,input('racing'))).toBe('NO_SEPARATE_ADD_ORIGIN_AUTHORIZATION_EXISTS');b.exec('COMMIT');
  a.close();a=new DatabaseSync(file);
  expect(readNoAddOrigin(a,'TESTNET','local','ETHUSDT','LONG')).toMatchObject({intentId:'origin',quantity:10});
  expect(claimNoAddOrigin(a,{...input(),quantity:11})).toBe('NO_ADD_ORIGIN_IDENTITY_OR_QUANTITY_CONFLICT');
  expect(claimNoAddOrigin(a,{...input(),clientOrderId:'another'})).toBe('NO_ADD_ORIGIN_IDENTITY_OR_QUANTITY_CONFLICT');
  expect(claimNoAddOrigin(a,input())).toBeNull();expect(claimNoAddOrigin(a,input('short','SHORT'))).toBeNull();
  expect(claimNoAddOrigin(a,{...input('production'),environment:'PRODUCTION'})).toBe('NO_ADD_ORIGIN_FACT_UNPROVEN');
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
it('UNKNOWN, partial fills, active positions, open orders and unclosed lots cannot release origin authority',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  createNoAddOriginSchema(db);db.exec('CREATE TABLE entry_execution_tasks(intent_id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE trade_records(trade_id TEXT PRIMARY KEY,payload TEXT)');
  const original=input();claimNoAddOrigin(db,original);
  const order={clientOrderId:original.clientOrderId,symbol:original.symbol,side:original.side,exchangeTerminalStatus:'UNKNOWN',filledQuantity:4,updatedAt:original.now,quantity:10,exchangeOrderId:'exchange',factSource:'BINANCE_EXACT_ORDER',verifiedAt:original.now,verifiedExchangeFills:[{symbol:'ETHUSDT',orderId:'exchange',clientOrderId:original.clientOrderId,qty:4}]};
  const save=()=>db.prepare('INSERT OR REPLACE INTO entry_execution_tasks VALUES(?,?)').run(original.intentId,JSON.stringify({order}));save();
  const snapshot={environment:'TESTNET',account:'local',requestedAt:Date.now()-10,observedAt:Date.now(),fullOrderScan:true,positions:[],openOrders:[]} as any;
  expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);
  order.exchangeTerminalStatus='CANCELED';save();expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);
  const cycle={symbol:'ETHUSDT',direction:'LONG',entryIntentId:'origin',status:'CLOSED',ledgerConservation:'CONSERVED',entryQty:4,exitQty:4,remainingQty:0,closedAt:original.now+100};
  db.prepare('INSERT INTO trade_records VALUES(?,?)').run('trade_cycle_entry_origin',JSON.stringify(cycle));
  expect(releaseFlatNoAddOrigins(db,{...snapshot,positions:[{symbol:'ETHUSDT',side:'LONG',quantity:1}]})).toBe(0);
  expect(releaseFlatNoAddOrigins(db,{...snapshot,openOrders:[{symbol:'ETHUSDT',side:'SELL'}]})).toBe(0);
  expect(releaseFlatNoAddOrigins(db,{...snapshot,fullOrderScan:false})).toBe(0);
  order.quantity=11;save();expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);order.quantity=10;
  order.factSource='LOCAL_LABEL';save();expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);order.factSource='BINANCE_EXACT_ORDER';
  order.verifiedExchangeFills[0]!.qty=3;save();expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);order.verifiedExchangeFills[0]!.qty=4;
  order.verifiedExchangeFills[0]!.orderId='other';save();expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(0);order.verifiedExchangeFills[0]!.orderId='exchange';save();
  expect(releaseFlatNoAddOrigins(db,snapshot)).toBe(1);
  expect(readNoAddOrigin(db,'TESTNET','local','ETHUSDT','LONG')).toBeNull();
  expect(claimNoAddOrigin(db,input())).toBe('NO_ADD_ORIGIN_RELEASED_IDENTITY');
  expect(claimNoAddOrigin(db,input('new-cycle'))).toBeNull();
 }finally{db.close();}
});

import {describe,it,expect} from 'vitest';
import {TradeRecordSchema} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {PositionService} from './positionService.js';
import {TradeRecordSyncService} from './tradeRecordSyncService.js';
import {accountCycle,exactCycleRecord} from './cycleAccounting.js';

const settings={portfolio:{maxPositions:4,maxPendingEntries:4},takeProfit:{enabled:true,quantityPercent:100}} as any;
function fixture(side:'LONG'|'SHORT'='LONG'){
 const state=new RuntimeState(settings),service=new PositionService(state,new EventBus());
 const order:any={id:'entry',cycleId:'cycle-entry',exchangeOrderId:'100',clientOrderId:'ml_entry',symbol:'BTCUSDT',side,quantity:1,price:100,filledQuantity:0,leverage:10,status:'WORKING',createdAt:1,updatedAt:1,intentId:'i',fills:[]};state.entryOrders.set(order.id,order);
 const fill=(id:string,exit=false,qty=1):any=>({fillId:id,tradeId:id,symbol:'BTCUSDT',orderId:exit?'200':'100',clientOrderId:exit?'tp_exit':'ml_entry',positionSide:'BOTH',side:exit?(side==='LONG'?'SELL':'BUY'):(side==='LONG'?'BUY':'SELL'),executionTime:exit?86_400_002:1,qty,price:exit?102:100,realizedPnl:exit?2*qty:0,commission:.1*qty,commissionAsset:'USDT',commissionUsd:.1*qty,maker:true});
 service.recordExchangeFill(fill('entry-fill'));
 const record=()=>[...state.tradeRecords.values()][0]!;
 state.tpOrders.set('tp',{id:'tp',cycleId:record().cycleId,positionId:'p',symbol:'BTCUSDT',exchangeOrderId:'200',clientOrderId:'tp_exit',side:side==='LONG'?'SELL':'BUY',quantity:1,price:102,status:'WORKING',createdAt:2,updatedAt:2});
 return{state,service,fill,record};
}
describe('durable cycle accounting',()=>{
 it('Entry → TP → COMPLETE CLOSED with exact funding',()=>{const f=fixture();f.state.tradeRecords.set(f.record().tradeId,{...f.record(),funding:0,fundingAttributionStatus:'EXACT'});f.service.recordExchangeFill(f.fill('exit',true));expect(f.record()).toMatchObject({status:'CLOSED',classification:'COMPLETE',entryQty:1,exitQty:1,remainingQty:0,netPnl:expect.closeTo(1.8)});});
 it('partial TP then full TP preserves entry quantity and timestamps',()=>{const f=fixture();f.service.recordExchangeFill(f.fill('x1',true,.4));expect(f.record()).toMatchObject({status:'PARTIALLY_CLOSED',closedAt:null,entryQty:1,exitQty:.4,remainingQty:.6});f.service.recordExchangeFill(f.fill('x2',true,.6));expect(f.record()).toMatchObject({status:'CLOSED',exitFillCount:2,entryQty:1,remainingQty:0});});
 it('multiple exit fills conserve independent cycle quantity',()=>{const f=fixture();for(let i=0;i<10;i++)f.service.recordExchangeFill(f.fill(`x${i}`,true,.1));expect(f.record().remainingQty).toBe(0);expect(f.record().exitFillCount).toBe(10);});
 it('yesterday Entry → today TP preview uses retained exact facts without writes',()=>{const f=fixture(),sync=new TradeRecordSyncService(f.state,f.service),before=JSON.stringify(f.state.serialize());const preview=sync.preview({source:'BINANCE_TESTNET_PRIVATE',fetchedAt:86_400_003,window:{startTime:86_400_000,endTime:86_400_003},fills:[f.fill('x',true)],orders:[],income:[],positions:[],openOrders:[]},100,{repairPartial:true});expect(preview.cyclePlans[0]).toMatchObject({entryFills:1,exitFills:1,closed:true,action:'REPAIR_PARTIAL'});expect(JSON.stringify(f.state.serialize())).toBe(before);});
 it('restart → TP retains exact ownership',()=>{const f=fixture(),state=new RuntimeState(settings);state.restore(f.state.serialize());new PositionService(state,new EventBus()).recordExchangeFill(f.fill('x',true));expect([...state.tradeRecords.values()][0]).toMatchObject({cycleId:'cycle-entry',status:'CLOSED'});});
 it('CLOSED same symbol/side re-entry creates a new cycle',()=>{const f=fixture();f.service.recordExchangeFill(f.fill('x',true));const old=structuredClone(f.record());f.state.entryOrders.set('new',{...f.state.entryOrders.get('entry')!,id:'new',cycleId:'cycle-new',exchangeOrderId:'300',clientOrderId:'ml_new',fills:[],filledQuantity:0});f.service.recordExchangeFill({...f.fill('new-fill'),orderId:'300',clientOrderId:'ml_new'});expect(f.state.tradeRecords.size).toBe(2);expect(f.state.tradeRecords.get(old.tradeId)).toEqual(old);});
 it('CLOSED records never revive on partial fact replay',()=>{const f=fixture();f.service.recordExchangeFill(f.fill('x',true));const closed=f.record();const next=accountCycle(closed,f.state.executionFills.filter(x=>x.side==='BUY'));expect(next.status).toBe('CLOSED');expect(next.closedAt).toBe(closed.closedAt);expect(next.classification).toBe('PARTIAL');});
 it('excess exit quantity fails conservation and cannot complete',()=>{const f=fixture();f.service.recordExchangeFill(f.fill('x',true,1.1));expect(f.record().classification).toBe('PARTIAL');expect(f.record().status).not.toBe('CLOSED');expect(f.record().missingFacts).toContain('EXCHANGE_FILL_CONSERVATION');});
 it('orphan TP uses exchange ID even without EntryOrder lookup',()=>{const f=fixture();f.state.entryOrders.clear();f.service.recordExchangeFill({...f.fill('x',true),clientOrderId:''});expect(f.record().exitFillCount).toBe(1);});
 it.each(['LONG','SHORT'] as const)('positionSide=BOTH respects %s exit ownership',side=>{const f=fixture(side);f.service.recordExchangeFill(f.fill('x',true));expect(f.record()).toMatchObject({direction:side,status:'CLOSED',entryQty:1,exitQty:1});});
 it('incomplete fee remains PARTIAL without replacing null with zero',()=>{const f=fixture();f.service.recordExchangeFill({...f.fill('x',true),commissionUsd:null});expect(f.record()).toMatchObject({classification:'PARTIAL',exitFee:null,netPnl:null});});
 it('UNKNOWN funding is not zero or canonical net',()=>{const f=fixture();f.service.recordExchangeFill(f.fill('x',true));expect(f.record()).toMatchObject({funding:null,fundingAttributionStatus:'UNKNOWN',netPnl:null,tradingNetPnlExFunding:expect.closeTo(1.8),pnlBasis:'CANONICAL_NET_WITH_FUNDING_UNKNOWN'});});
 it('reconciliation close before delayed fill stays unfinalized until exact exit',()=>{const f=fixture();const pos:any={id:'p',cycleId:f.record().cycleId,symbol:'BTCUSDT',side:'LONG',quantity:1,entryPrice:100,leverage:10};f.service.onReconciledClose(pos);expect(f.record()).toMatchObject({status:'INCOMPLETE',closedAt:null,exitAveragePrice:null});f.service.recordExchangeFill(f.fill('x',true));expect(f.record()).toMatchObject({status:'CLOSED',classification:'COMPLETE'});});
 it('duplicate user data fills are idempotent',()=>{const f=fixture();const x=f.fill('x',true);f.service.recordExchangeFill(x);const before=JSON.stringify(f.record());f.service.recordExchangeFill(x);expect(JSON.stringify(f.record())).toBe(before);expect(f.state.executionFills).toHaveLength(2);});
 it('ambiguous reused position ID never chooses a cycle',()=>{const f=fixture();f.state.tradeRecords.set('conflict',TradeRecordSchema.parse({...f.record(),tradeId:'conflict',cycleId:'other',exitOrderIds:['200']}));expect(exactCycleRecord(f.state,f.fill('x',true))).toBeUndefined();});
});

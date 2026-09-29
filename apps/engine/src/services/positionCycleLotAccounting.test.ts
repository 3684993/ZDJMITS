import {describe,expect,it} from 'vitest';
import type {EntryOrder, ExecutionFill} from '@zdj/contracts';
import {RuntimeState} from '../state/runtimeState.js';
import {EventBus} from '../events/eventBus.js';
import {PositionService} from './positionService.js';
import {accountCycle,allocateExitLotsFifo,cycleFills,exactCycleRecord} from './cycleAccounting.js';

/**
 * P2 acceptance: physical position cycles, Entry lots, exit attribution and Closed Trade.
 *
 * The shapes come from the V3.9.6 audit (R4/R5): several add-ons to the same symbol and side, one
 * aggregated take-profit closing the whole holding, and system exit fills labelled external because
 * origin was inferred from a client-id prefix instead of a durable record.
 */

const settings={portfolio:{maxPositions:4,maxPendingEntries:4},takeProfit:{enabled:true,quantityPercent:100}} as any;
const any=(value:unknown)=>value as any;

function harness(side:'LONG'|'SHORT'='LONG'){
  const state=new RuntimeState(settings);
  const service=new PositionService(state,new EventBus());
  let sequence=0;
  const addEntryLot=(symbol:string,quantity:number,price:number,at:number):EntryOrder=>{
    const intentId=`intent_${symbol}_${at}`,id=`entry_${intentId}`;
    const order:any={id,cycleId:`cycle_${id}`,exchangeOrderId:`oe_${++sequence}`,clientOrderId:`ml_${id}`,symbol,side,quantity,price,filledQuantity:quantity,leverage:10,status:'FILLED',createdAt:at,updatedAt:at,intentId,fills:[]};
    state.entryIntents.set(intentId,{id:intentId,symbol,side,brainRunId:`run_${intentId}`,allocationPlan:{planId:`plan_${intentId}`}} as never);
    state.entryOrders.set(id,order);
    service.recordExchangeFill(any({fillId:`fill_${id}`,tradeId:`trade_${id}`,symbol,orderId:order.exchangeOrderId,clientOrderId:order.clientOrderId,positionSide:side,
      side:side==='LONG'?'BUY':'SELL',executionTime:at,qty:quantity,price,realizedPnl:0,commission:quantity*price*0.0004,commissionAsset:'USDT',commissionUsd:quantity*price*0.0004,maker:true}));
    return order;
  };
  const exitAll=(symbol:string,quantity:number,price:number,at:number,tpId='tp_agg')=>{
    const tp:any={id:tpId,cycleId:null,positionId:`pos_${symbol}_${side}`,symbol,exchangeOrderId:`xe_${tpId}`,clientOrderId:`v396x${tpId}`,
      side:side==='LONG'?'SELL':'BUY',quantity,price,status:'FILLED',createdAt:at-1,updatedAt:at};
    state.tpOrders.set(tpId,tp);
    service.recordExchangeFill(any({fillId:`fill_${tpId}`,tradeId:`trade_${tpId}`,symbol,orderId:tp.exchangeOrderId,clientOrderId:tp.clientOrderId,positionSide:side,
      side:side==='LONG'?'SELL':'BUY',executionTime:at,qty:quantity,price,realizedPnl:(side==='LONG'?price-100:100-price)*quantity,
      commission:quantity*price*0.0004,commissionAsset:'USDT',commissionUsd:quantity*price*0.0004,maker:false}));
  };
  const records=()=>[...state.tradeRecords.values()];
  const record=()=>records().find(row=>row.symbol==='BRUSDT')??records()[0];
  return{state,service,records,record,addEntryLot,exitAll};
}

describe('P2 physical cycle with multiple entry lots',()=>{
  it('6 + 6 + 6 entry then one aggregated 18 exit conserves and closes',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.addEntryLot('BRUSDT',6,100,2_000);
    h.addEntryLot('BRUSDT',6,100,3_000);
    // One holding, not three: an add-on must not open another physical cycle.
    expect(h.records().filter(row=>row.symbol==='BRUSDT')).toHaveLength(1);
    h.exitAll('BRUSDT',18,101,4_000);
    const record=h.record();
    expect(record).toMatchObject({entryQty:18,exitQty:18,remainingQty:0,status:'CLOSED',ledgerConservation:'CONSERVED',entryFillCount:3,exitFillCount:1});
    expect(record.integrityFlags).not.toContain('LEDGER_INCONSISTENT');
    expect(record.entryLots).toHaveLength(3);
    expect(record.entryLots.map(lot=>lot.quantity)).toEqual([6,6,6]);
    expect(record.entryLots.map(lot=>Number(lot.exitAllocatedQuantity))).toEqual([6,6,6]);
    expect(record.lotAllocationMethod).toBe('FIFO');
    // The exchange fill is stored once; the lot rows are an apportionment, not three copies of it.
    expect(h.state.executionFills.filter(fill=>fill.tradeId==='trade_tp_agg')).toHaveLength(1);
  });

  it('2 + 2 + 2 entry then 6 exit closes the same way',()=>{
    const h=harness('SHORT');
    h.addEntryLot('BRUSDT',2,100,1_000);h.addEntryLot('BRUSDT',2,100,2_000);h.addEntryLot('BRUSDT',2,100,3_000);
    h.exitAll('BRUSDT',6,99,4_000);
    expect(h.record()).toMatchObject({direction:'SHORT',entryQty:6,exitQty:6,remainingQty:0,status:'CLOSED',ledgerConservation:'CONSERVED'});
    expect(h.record().entryLots.reduce((sum,lot)=>sum+Number(lot.exitAllocatedQuantity),0)).toBe(6);
  });

  it('fee and realised pnl allocation cannot create or destroy value',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);h.addEntryLot('BRUSDT',6,100,2_000);h.addEntryLot('BRUSDT',41,100,3_000);
    h.exitAll('BRUSDT',53,102,4_000);
    const record=h.record();
    expect(record.entryLots).toHaveLength(3);
    const sum=(values:(number|null)[])=>values.reduce((total,value)=>total+Number(value??0),0);
    expect(sum(record.entryLots.map(lot=>lot.allocatedEntryFee))).toBeCloseTo(Number(record.entryFee!),6);
    expect(sum(record.entryLots.map(lot=>lot.allocatedExitFee))).toBeCloseTo(Number(record.exitFee!),6);
    expect(sum(record.entryLots.map(lot=>lot.allocatedGrossRealizedPnl))).toBeCloseTo(Number(record.grossRealizedPnl!),6);
    expect(sum(record.entryLots.map(lot=>lot.exitAllocatedNotional))).toBeCloseTo(Number(record.exitGrossNotional),6);
    expect(sum(record.entryLots.map(lot=>lot.exitAllocatedQuantity))).toBe(53);
  });

  it('partial close, add-on, then full close keeps one cycle and conserves',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',10,100,1_000);
    h.exitAll('BRUSDT',4,101,2_000,'tp_part');
    expect(h.record()).toMatchObject({status:'PARTIALLY_CLOSED',entryQty:10,exitQty:4,remainingQty:6});
    const openedAt=h.record().openedAt,firstCycle=h.record().cycleId;
    h.addEntryLot('BRUSDT',6,100,3_000);
    h.exitAll('BRUSDT',12,101,4_000,'tp_rest');
    const record=h.record();
    expect(record).toMatchObject({status:'CLOSED',entryQty:16,exitQty:16,remainingQty:0,ledgerConservation:'CONSERVED'});
    expect(record.openedAt).toBe(openedAt);
    expect(record.cycleId).toBe(firstCycle);
    expect(record.entryLots).toHaveLength(2);
  });

  it('a credible zero followed by a new entry starts a new physical cycle',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const first=h.record();
    expect(first.status).toBe('CLOSED');
    // The position book is the credible zero: reconciliation closing it is what arms a new cycle.
    h.state.positions.set('pos_bridge',any({id:'pos_bridge',symbol:'BRUSDT',side:'LONG',quantity:0.000001,entryPrice:100,markPrice:101,leverage:10,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:2_000,firstObservedAt:2_000,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE',tpEconomics:null,profitTakePlan:null,profitTakePlanSource:null,economicAdmission:null,lossHandoff:{cycleId:'lh',lastClosedBarAt:null,consecutiveLossBars:0,status:'ACTIVE'}}));
    h.service.onReconciledClose(any({id:'pos_bridge',symbol:'BRUSDT',side:'LONG',quantity:0,entryPrice:100,leverage:10,cycleId:first.cycleId}));
    h.state.positions.delete('pos_bridge');
    h.addEntryLot('BRUSDT',5,100,5_000);
    const reopened=h.records().filter(row=>row.symbol==='BRUSDT');
    expect(reopened).toHaveLength(2);
    expect(new Set(reopened.map(row=>row.cycleId)).size).toBe(2);
    expect(reopened.find(row=>row.cycleId===first.cycleId)!.status).toBe('CLOSED');
  });

  it('long and short on the same symbol stay separate cycles',()=>{
    const longs=harness('LONG'),shorts=harness('SHORT');
    longs.addEntryLot('BRUSDT',6,100,1_000);shorts.addEntryLot('BRUSDT',4,100,1_500);
    expect(longs.record().direction).toBe('LONG');
    expect(shorts.record().direction).toBe('SHORT');
    expect(longs.record().cycleId).not.toBe(shorts.record().cycleId);
  });

  it('an exit beyond the entry quantity is LEDGER_INCONSISTENT, not a normal partial close',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',18,101,2_000);
    const record=h.record();
    expect(record.remainingQty).toBeLessThan(0);
    expect(record.ledgerConservation).toBe('LEDGER_INCONSISTENT');
    expect(record.integrityFlags).toContain('LEDGER_INCONSISTENT');
    expect(record.status).toBe('INCOMPLETE');
    expect(record.classification).not.toBe('COMPLETE');
  });

  it('the audited BR shape 6+? entries with an 18-unit exit no longer reports -12 remaining',()=>{
    // ROOT_CAUSE_REPORT 4/R4: cycle_entry_intent_mukxjzol_q8q1s20j booked 6 entry against 18 exit.
    const h=harness('SHORT');
    h.addEntryLot('BRUSDT',6,1.9,1_000);
    h.state.entryOrders.set('entry_add',any({id:'entry_add',cycleId:'cycle_entry_add',exchangeOrderId:'oe_add',clientOrderId:'ml_entry_add',symbol:'BRUSDT',side:'SHORT',quantity:12,price:1.9,filledQuantity:12,leverage:10,status:'FILLED',createdAt:1_500,updatedAt:1_500,intentId:'intent_add',fills:[]}));
    h.service.recordExchangeFill(any({fillId:'fill_add',tradeId:'trade_add',symbol:'BRUSDT',orderId:'oe_add',clientOrderId:'ml_entry_add',positionSide:'SHORT',side:'SELL',executionTime:1_500,qty:12,price:1.9,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true}));
    h.exitAll('BRUSDT',18,1.88,2_000);
    const record=h.record();
    expect(record).toMatchObject({entryQty:18,exitQty:18,remainingQty:0,status:'CLOSED'});
    expect(record.entryLots.map(lot=>lot.quantity)).toEqual([6,12]);
  });

  it('funding unknown still closes a conserved cycle with net left UNKNOWN',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const record=h.record();
    expect(record.status).toBe('CLOSED');
    expect(record.funding).toBeNull();
    expect(record.netPnl).toBeNull();
    expect(record.tradingNetPnlExFunding).not.toBeNull();
    expect(record.pnlBasis).toBe('CANONICAL_NET_WITH_FUNDING_UNKNOWN');
  });

  it('a re-imported exit trade does not count the same quantity twice',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const before=h.record();
    h.service.recordExchangeFill(any({fillId:'fill_tp_agg_reimported',tradeId:'trade_tp_agg',symbol:'BRUSDT',orderId:'xe_tp_agg',clientOrderId:'v396xtp_agg',positionSide:'LONG',
      side:'SELL',executionTime:2_000,qty:6,price:101,realizedPnl:6,commission:0.0024,commissionAsset:'USDT',commissionUsd:0.0024,maker:false}));
    const after=h.record();
    expect(after.exitQty).toBe(before.exitQty);
    expect(after.exitFillCount).toBe(before.exitFillCount);
    expect(after.status).toBe('CLOSED');
    expect(after.remainingQty).toBe(0);
    expect(h.state.executionFills.filter(fill=>fill.tradeId==='trade_tp_agg')).toHaveLength(1);
  });
});

describe('P2 system exit fill provenance',()=>{
  it('a v396x exit fill is system-attributed from the durable TP row',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const fill=h.state.executionFills.find(row=>row.clientOrderId==='v396xtp_agg')!;
    expect(fill.attributionStatus).toBe('SYSTEM_ATTRIBUTED');
    expect(fill.provenanceSource).toBe('DURABLE_ORDER_TABLE');
    expect(fill.fillRole).toBe('EXIT');
  });

  it('a v396x id with no durable record stays unproven instead of being trusted by prefix',()=>{
    const state=new RuntimeState(settings),service=new PositionService(state,new EventBus());
    service.recordExchangeFill(any({fillId:'f1',tradeId:'t1',symbol:'BRUSDT',orderId:'999',clientOrderId:'v396xunknownidentity',positionSide:'LONG',
      side:'SELL',executionTime:1_000,qty:1,price:100,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:false}));
    const fill=state.executionFills[0];
    expect(fill.attributionStatus).toBe('EXTERNAL_OR_UNLINKED');
    expect(fill.provenanceSource).toBe('UNPROVEN');
  });

  it('the order registry alone proves a fill whose order row is no longer in memory',()=>{
    const state=new RuntimeState(settings);
    const registered=new Map<string,{symbol:string;role:string}>();
    state.orderProvenance=any({
      record:(input:{symbol:string;clientOrderId:string;role:string})=>{registered.set(input.clientOrderId,{symbol:input.symbol,role:input.role});return{recorded:true,conflict:null};},
      resolve:(input:{symbol:string;clientOrderId?:string|null})=>{
        const row=registered.get(String(input.clientOrderId??''));
        return row&&row.symbol===input.symbol?any({status:'SYSTEM_PROVEN',proof:[`REGISTRY_ROLE_${row.role}`]}):any({status:'UNRESOLVED',rows:[],proof:['PROVENANCE_REGISTRY_HAS_NO_MATCH']});
      },
    });
    const service=new PositionService(state,new EventBus());
    service.recordExchangeFill(any({fillId:'f2',tradeId:'t2',symbol:'BRUSDT',orderId:'777',clientOrderId:'ml_remote_only',positionSide:'LONG',
      side:'BUY',executionTime:1_000,qty:1,price:100,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true}));
    expect(state.executionFills[0].attributionStatus).toBe('EXTERNAL_OR_UNLINKED');
    state.orderProvenance!.record({symbol:'BRUSDT',clientOrderId:'ml_remote_only',role:'ENTRY',source:'unit-test'});
    service.recordExchangeFill(any({fillId:'f3',tradeId:'t3',symbol:'BRUSDT',orderId:'778',clientOrderId:'ml_remote_only',positionSide:'LONG',
      side:'BUY',executionTime:1_500,qty:1,price:100,realizedPnl:0,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true}));
    const last=state.executionFills.find(row=>row.fillId==='f3')!;
    expect(last.attributionStatus).toBe('SYSTEM_ATTRIBUTED');
    expect(last.provenanceSource).toBe('ORDER_REGISTRY');
  });
});

describe('P2 lot attribution primitives',()=>{
  const lot=(lotId:string,quantity:number,filledAt:number)=>any({lotId,intentId:null,orderId:null,exchangeOrderId:null,quantity,averagePrice:100,filledAt,exitAllocatedQuantity:0,exitAllocatedNotional:0,allocatedEntryFee:null,allocatedExitFee:null,allocatedGrossRealizedPnl:null,allocationSource:'UNALLOCATED'});
  const exit=(fillId:string,qty:number,executionTime:number,realizedPnl=qty):ExecutionFill=>any({fillId,tradeId:fillId,symbol:'X',orderId:'o',clientOrderId:'c',positionSide:'LONG',side:'SELL',executionTime,qty,price:101,realizedPnl,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:false});

  it('FIFO fills the earliest lot first and preserves totals',()=>{
    const result=allocateExitLotsFifo([lot('a',6,1),lot('b',6,2),lot('c',6,3)],[exit('x1',10,4,10),exit('x2',8,5,8)]);
    expect(result.method).toBe('FIFO');
    expect(result.lots.map(row=>row.exitAllocatedQuantity)).toEqual([6,6,6]);
    expect(result.lots.reduce((sum,row)=>sum+row.exitAllocatedQuantity,0)).toBe(18);
    expect(result.lots.reduce((sum,row)=>sum+Number(row.allocatedGrossRealizedPnl??0),0)).toBeCloseTo(18,9);
    expect(result.lots.every(row=>row.allocationSource==='FIFO')).toBe(true);
  });

  it('an over-exit stays visible instead of vanishing',()=>{
    const result=allocateExitLotsFifo([lot('a',6,1),lot('b',6,2)],[exit('x',18,3,18)]);
    expect(result.lots.reduce((sum,row)=>sum+row.exitAllocatedQuantity,0)).toBe(18);
  });

  it('an empty lot set is UNKNOWN, never silently complete',()=>{
    expect(allocateExitLotsFifo([],[]).method).toBe('UNKNOWN');
  });

  it('exactCycleRecord will not guess between two candidate cycles',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const record=h.record();
    h.state.tradeRecords.set('conflict',any({...record,tradeId:'conflict',cycleId:'other',positionCycleId:'other',linkedFillIds:[...record.linkedFillIds],exitOrderIds:[...new Set([...record.exitOrderIds,'xe_tp_agg'])]}));
    expect(exactCycleRecord(h.state,any({symbol:'BRUSDT',orderId:'xe_tp_agg',clientOrderId:'v396xtp_agg',tradeId:'unknown-trade'}))).toBeUndefined();
  });

  it('cycleFills returns each exchange trade exactly once',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);
    h.exitAll('BRUSDT',6,101,2_000);
    const fills=cycleFills(h.state,h.record());
    expect(new Set(fills.map(fill=>fill.tradeId)).size).toBe(fills.length);
    expect(fills.map(fill=>fill.tradeId).sort()).toEqual(['trade_entry_intent_BRUSDT_1000','trade_tp_agg']);
  });

  it('accountCycle is stable when replayed over the same fills',()=>{
    const h=harness();
    h.addEntryLot('BRUSDT',6,100,1_000);h.addEntryLot('BRUSDT',6,100,2_000);
    h.exitAll('BRUSDT',12,101,3_000);
    const once=accountCycle(h.record(),cycleFills(h.state,h.record()));
    const twice=accountCycle(once,cycleFills(h.state,once));
    expect(JSON.parse(JSON.stringify(twice.entryLots))).toEqual(JSON.parse(JSON.stringify(once.entryLots)));
    expect(twice.remainingQty).toBe(0);
  });
});

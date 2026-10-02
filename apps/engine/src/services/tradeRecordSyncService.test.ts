import { describe, expect, it } from 'vitest';
import { TradeRecordSchema } from '@zdj/contracts';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { PositionService } from './positionService.js';
import { TradeRecordSyncService } from './tradeRecordSyncService.js';
import type { TradeAuditSnapshot } from '../types.js';

const settings={portfolio:{maxPositions:4,maxPendingEntries:4},takeProfit:{enabled:true,quantityPercent:100}} as any;
const audit:TradeAuditSnapshot={source:'BINANCE_TESTNET_PRIVATE',fetchedAt:30,window:{startTime:0,endTime:30},positions:[],openOrders:[],orders:[{symbol:'BTCUSDT',orderId:'entry-order',clientOrderId:'entry_test',side:'BUY',positionSide:'LONG',status:'FILLED',type:'LIMIT',origQty:1,executedQty:1,avgPrice:100,updateTime:10},{symbol:'BTCUSDT',orderId:'tp-order',clientOrderId:'tp_test',side:'SELL',positionSide:'LONG',status:'FILLED',type:'LIMIT',origQty:1,executedQty:1,avgPrice:102,updateTime:20}],fills:[{symbol:'BTCUSDT',side:'BUY',positionSide:'LONG',orderId:'entry-order',clientOrderId:'entry_test',tradeId:'entry-fill',executionTime:10,qty:1,price:100,realizedPnl:0,commission:.1,commissionAsset:'USDT',maker:true},{symbol:'BTCUSDT',side:'SELL',positionSide:'LONG',orderId:'tp-order',clientOrderId:'tp_test',tradeId:'exit-fill',executionTime:20,qty:1,price:102,realizedPnl:2,commission:.1,commissionAsset:'USDT',maker:true}],income:[{symbol:'BTCUSDT',incomeType:'COMMISSION',income:-.1,asset:'USDT',time:10,info:null,tradeId:'entry-fill',transactionId:null},{symbol:'BTCUSDT',incomeType:'COMMISSION',income:-.1,asset:'USDT',time:20,info:null,tradeId:'exit-fill',transactionId:null}]};

const seed=(state:RuntimeState,symbol='BTCUSDT',direction='LONG',entryOrder='entry-order',exitOrder='tp-order')=>{
 const row=TradeRecordSchema.parse({tradeId:'durable',cycleId:'cycle-durable',symbol,direction,openedAt:1,closedAt:null,durationMs:null,entryQty:1,entryAveragePrice:100,exitAveragePrice:null,funding:null,grossRealizedPnl:null,netPnl:null,closeReason:null,status:'OPEN',entryRunId:null,entryIntentId:'entry',entryOrderIds:[entryOrder],exitOrderIds:[exitOrder],source:'SYSTEM',regime:null,createdAt:1,updatedAt:1,firstObservedAt:1});state.tradeRecords.set(row.tradeId,row);
};
describe('TradeRecord manual sync',()=>{
 it('does not turn an unproven closing fill or a TP-shaped client id into MANUAL/TP',()=>{
  const state=new RuntimeState(settings);seed(state);const service=new TradeRecordSyncService(state,new PositionService(state,new EventBus()));
  const result=service.apply(audit,500,{repairPartial:true});expect(result.records[0].closeReason).toBe('UNKNOWN');
 });
 it('keeps a proven TP closing source independently of maker/taker execution',()=>{
  const state=new RuntimeState(settings);seed(state);state.orderProvenance={resolve:()=>({status:'SYSTEM_PROVEN',rows:[{role:'TP',cycleId:'cycle-durable'}],proof:[]})} as any;
  const service=new TradeRecordSyncService(state,new PositionService(state,new EventBus()));
  const result=service.apply({...audit,fills:audit.fills.map(fill=>({...fill,maker:false}))},500,{repairPartial:true});expect(result.records[0].closeReason).toBe('TP');
 });
 it('previews without mutation and repeats explicit apply idempotently with durable identity',()=>{
  const state=new RuntimeState(settings);seed(state);const service=new TradeRecordSyncService(state,new PositionService(state,new EventBus())),before=JSON.stringify(state.serialize());
  expect(service.preview(audit,500,{repairPartial:true}).repairablePartial).toBe(1);expect(JSON.stringify(state.serialize())).toBe(before);
  const first=service.apply(audit,500,{repairPartial:true});expect(first.repaired).toBe(1);expect(first.records[0]).toMatchObject({classification:'COMPLETE',status:'CLOSED',netPnl:null,funding:null});expect(first.experienceCreated).toBe(0);
  const second=service.apply(audit,500,{repairPartial:true});expect(second.skipped).toBe(1);expect(second.repaired).toBe(0);expect(state.tradeRecords.size).toBe(1);
 });
 it('refuses symbol/time-only reconstruction when no durable owner exists',()=>{const state=new RuntimeState(settings),service=new TradeRecordSyncService(state,new PositionService(state,new EventBus()));const preview=service.preview(audit,500,{});expect(preview.cyclesDetected).toBe(0);expect(preview.unclosable).toBe(2);expect(state.tradeRecords.size).toBe(0);});
 it('conserves all five EC1 manual reduce fills using exact order links',()=>{
  const state=new RuntimeState(settings);seed(state,'BTCUSDT','SHORT','e','x');const service=new TradeRecordSyncService(state,new PositionService(state,new EventBus()));
  const entries=[11,10,15,16,5].map((qty,i)=>({...audit.fills[0]!,side:'SELL' as const,positionSide:'SHORT' as const,orderId:'e',tradeId:`e${i}`,qty,clientOrderId:'ml_entry',executionTime:i+1}));
  const exits=[9,12,15,16,5].map((qty,i)=>({...audit.fills[1]!,side:'BUY' as const,positionSide:'SHORT' as const,orderId:'x',tradeId:`x${i}`,qty,clientOrderId:'ec1_exit',executionTime:i+10}));
  const result=service.apply({...audit,orders:[],income:[],fills:[...entries,...exits]},100,{repairPartial:true});expect(result.records[0]).toMatchObject({entryQty:57,exitQty:57,remainingQty:0,entryFillCount:5,exitFillCount:5,classification:'COMPLETE'});
 });
});

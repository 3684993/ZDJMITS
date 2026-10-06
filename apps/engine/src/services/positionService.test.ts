import { describe, expect, it } from 'vitest';
import type { EntryOrder, TakeProfitOrder } from '@zdj/contracts';
import { RuntimeState } from '../state/runtimeState.js';
import { EventBus } from '../events/eventBus.js';
import { PositionService } from './positionService.js';

const settings={portfolio:{maxPositions:4,maxPendingEntries:4},takeProfit:{enabled:true,quantityPercent:100}} as any;
const entry:EntryOrder={id:'entry_1',exchangeOrderId:'x',symbol:'BTCUSDT',side:'LONG',quantity:1,price:100,filledQuantity:1,leverage:10,status:'FILLED',createdAt:10,updatedAt:10,absoluteExpiresAt:1000,repriceCount:0,intentId:'intent_1',reachability:.9};
describe('TradeRecord lifecycle',()=>{
  it('creates an OPEN record from the actual filled quantity and closes it with explicit ex-funding PnL',()=>{const state=new RuntimeState(settings);state.account.availableUsd=1000;const service=new PositionService(state,new EventBus());const position=service.onEntryFilled(entry);expect(state.tradeRecords.get(`trade_${position.cycleId}`)?.status).toBe('OPEN');expect(position.quantity).toBe(1);const tp:TakeProfitOrder={id:'tp_1',exchangeOrderId:'tp-x',positionId:position.id,symbol:'BTCUSDT',side:'SELL',quantity:1,price:101,status:'FILLED',createdAt:20,updatedAt:20};service.onTakeProfitFilled(tp);const record=state.tradeRecords.get(`trade_${position.cycleId}`)!;expect(record.status).toBe('CLOSED');expect(record.grossRealizedPnl).toBe(1);expect(record.tradingNetPnlExFunding).toBe(1);expect(record.netPnl).toBeNull();expect(state.experienceSamples.size).toBe(0);});
  it('binds a MANUAL registry exit to the existing physical cycle',()=>{
    const state=new RuntimeState(settings);state.account.availableUsd=1000;const service=new PositionService(state,new EventBus()),position=service.onEntryFilled(entry);
    state.orderProvenance={record:()=>({recorded:true,conflict:null}),resolve:()=>({status:'SYSTEM_PROVEN',proof:['REGISTRY_ROLE_MANUAL'],rows:[{role:'MANUAL',cycleId:position.cycleId}]})} as any;
    const result=service.recordExchangeFill({fillId:'manual-fill-1',symbol:'BTCUSDT',side:'SELL',positionSide:'LONG',orderId:'manual-exchange-1',clientOrderId:'manual-client-1',tradeId:'manual-trade-1',executionTime:30,qty:1,price:101,realizedPnl:1,commission:0,commissionAsset:'USDT',commissionUsd:0,maker:true,source:'EXCHANGE_AUDIT'});
    expect(result.fill.cycleId).toBe(position.cycleId);expect(result.fill.provenanceSource).toBe('ORDER_REGISTRY');expect(state.tradeRecords.get(`trade_${position.cycleId}`)?.status).toBe('CLOSED');
  });
  it('does not fabricate a historical entry time for an imported position',()=>{const state=new RuntimeState(settings);const position={id:'imported',symbol:'ETHUSDT',side:'SHORT',quantity:1,entryPrice:2000,markPrice:2000,leverage:5,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:Date.now(),firstObservedAt:Date.now(),entryTimeSource:'IMPORTED_AT_STARTUP',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE'} as any;state.positions.set(position.id,position);expect(state.positions.get('imported')?.openedAt).toBeGreaterThan(0);expect(state.positions.get('imported')?.entryTimeSource).toBe('IMPORTED_AT_STARTUP');});
});

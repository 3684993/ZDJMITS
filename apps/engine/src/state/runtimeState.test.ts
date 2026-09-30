import { describe, expect, it } from 'vitest';
import { RuntimeState } from './runtimeState.js';
import { installDeterministicAdmission } from '../testing/deterministicRiskAdmission.js';

const settings:any={portfolio:{maxPositions:2},riskGovernance:{reservationTtlSeconds:300,lockLeaseSeconds:120,maxConcurrentReservations:8}};
function fresh(state:RuntimeState){installDeterministicAdmission(state);const now=Date.now();state.account={...state.account,status:'READY',asOf:now,assets:[{asset:'USDT',walletBalance:1000,availableBalance:1000,crossWalletBalance:1000,unrealizedPnl:0,usdValue:1000,marginEligible:true}]};state.runtimeControl={...state.runtimeControl,capital:{...state.runtimeControl.capital,generation:3,evaluatedAt:now,capitalVersion:'capital-fixture',nextRecheckAt:now+120_000}};return state;}

describe('RuntimeState entry reservations',()=>{
  it('allows only one concurrent reservation for the same underlying',()=>{
    const state=fresh(new RuntimeState(settings));
    const args={underlying:'ETH',quoteAsset:'USDT' as const,marginUsd:100,notionalUsd:2000,planId:'p1',maxPositions:2,ttlSeconds:300,leaseSeconds:120,maxConcurrentReservations:8};
    const first=state.reserveEntry(args),second=state.reserveEntry({...args,planId:'p2'});
    expect(first.ok).toBe(true);expect(second).toMatchObject({ok:false,reason:'UNDERLYING_LOCKED'});state.releaseEntryReservation(first.ok?first.reservationId:'');expect(state.reserveEntry({...args,planId:'p2'}).ok).toBe(true);
  });
  it('counts reservations against max positions and releases them',()=>{
    const state=fresh(new RuntimeState(settings));
    const args={underlying:'BTC',quoteAsset:'USDT' as const,marginUsd:100,notionalUsd:2000,planId:'p1',maxPositions:1,ttlSeconds:300,leaseSeconds:120,maxConcurrentReservations:8};const first=state.reserveEntry(args);expect(first.ok).toBe(true);const second=state.reserveEntry({...args,underlying:'SOL',planId:'p2'});expect(second).toMatchObject({ok:false,reason:'MAX_POSITIONS_REACHED'});if(first.ok)state.releaseEntryReservation(first.reservationId);expect(state.reserveEntry({...args,underlying:'SOL',planId:'p2'}).ok).toBe(true);
  });
  it('releases expired WORKING reservations only when no live exchange order owns them',()=>{const state=new RuntimeState(settings),now=Date.now();state.entryReservations.set('stale',{id:'stale',underlying:'BTC',status:'WORKING',expiresAt:now-1});state.entryReservations.set('live',{id:'live',underlying:'ETH',status:'WORKING',expiresAt:now-1});state.entryOrders.set('o',{reservationId:'live',status:'WORKING'});state.cleanupReservations(now);expect(state.entryReservations.get('stale').status).toBe('RELEASED');expect(state.entryReservations.get('live').status).toBe('WORKING');});
});
it('quarantines a persisted TP-only phantom position during restore',()=>{
 const state=new RuntimeState(settings);state.restore({runtimeControl:{},positions:[['phantom',{tpStatus:'PROTECTED',tpOrderId:'tp-only'}]]});
 expect(state.positions.has('phantom')).toBe(false);expect([...state.positionSymbols()]).toEqual([]);
});
it('counts unresolved submissions, deduplicates quotes/reservations, and keeps partial fills in one slot',()=>{
 const state=new RuntimeState(settings);state.positions.set('p',{symbol:'BTCUSDT'});
 state.entryOrders.set('a',{id:'a',symbol:'BTCUSDT',status:'PARTIALLY_FILLED'});
 state.entryOrders.set('b',{id:'b',symbol:'ETHUSDT',status:'UNKNOWN'});state.entryOrders.set('c',{id:'c',symbol:'ETHUSDC',status:'SUBMITTING'});
 state.entryReservations.set('r',{id:'r',underlying:'ETH',status:'WORKING',expiresAt:Date.now()+10000});
 expect(state.entryCapacity()).toMatchObject({positions:1,inFlight:1,reserved:0,used:2,max:2});
});

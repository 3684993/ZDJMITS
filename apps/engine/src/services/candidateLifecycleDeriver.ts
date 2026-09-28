import { testnetFundsOnlyEntry } from '@zdj/core';
import { resolveUnderlying } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import { entryOrderOccupiesRisk } from './entryRiskOccupancy.js';

const ACTIVE_AI=new Set(['SCOUT_QUEUED','SCOUT_RUNNING','SCOUT_DONE','PRIMARY_QUEUED','PRIMARY_RUNNING','PLACE_READY']);
const COOLDOWN=new Set(['REJECT_COOLDOWN','AI_FAILURE_COOLDOWN','TECHNICAL_COOLDOWN','QUARANTINED','COOLDOWN']);

/**
 * The lifecycle states that mean "the scheduler may put this symbol in front of the model". It is one
 * predicate on purpose: the margin-tier coverage universe has to be priced for exactly this set, and a
 * second copy drifting behind the dispatcher is what turned real routed candidates into
 * `MARGIN_TIER_SYMBOL_UNPROVEN` refusals on the live account.
 */
export const PIPELINE_ROUTABLE_LIFECYCLE = new Set(['READY', ...ACTIVE_AI]);
export const isPipelineRoutableLifecycle = (status: unknown) => PIPELINE_ROUTABLE_LIFECYCLE.has(String(status ?? ''));

/** Rebuilds occupancy states from live facts. Historical lifecycle rows are never an occupancy source. */
export function reconcileCandidateLifecycles(state:RuntimeState,events?:EventBus,reason='FACT_RECONCILIATION',now=Date.now()){
  state.cleanupReservations(now);
  const positionSymbols=state.positionSymbols(),activeOrders=[...state.entryOrders.values()].filter((row:any)=>entryOrderOccupiesRisk(row,now)),activeOrderSymbols=new Set(activeOrders.map((row:any)=>String(row.symbol).toUpperCase()));
  const activeReservations=[...state.entryReservations.values()].filter((row:any)=>['RESERVED','WORKING'].includes(row.status)&&row.expiresAt>now),activeIntentIds=new Set(activeReservations.map((row:any)=>row.intentId).filter(Boolean));
  const activeAiSymbols=new Set(state.aiRuns.filter((row:any)=>row.status==='RUNNING').map((row:any)=>String(row.symbol).toUpperCase()));
  const reservedSymbols=new Set([...state.entryIntents.values()].filter((row:any)=>activeIntentIds.has(row.id)).map((row:any)=>String(row.symbol).toUpperCase()));
  const occupiedUnderlyings=new Set<string>();
  for(const symbol of [...positionSymbols,...activeOrderSymbols,...reservedSymbols])occupiedUnderlyings.add(resolveUnderlying(symbol));
  for(const reservation of activeReservations)occupiedUnderlyings.add(String(reservation.underlying).toUpperCase());
  const symbols=new Set<string>([...state.candidateLifecycle.keys(),...state.universe.map((row:any)=>String(row.symbol).toUpperCase())]);
  let migrated=0;
  for(const symbol of symbols){
    const previous=state.candidateLifecycle.get(symbol),oldStatus=previous?.status as string|undefined,cooldown=state.rejectionCooldown.get(symbol),underlying=resolveUnderlying(symbol);
    let status:string|undefined,derivedReason:string|undefined;
    if(!testnetFundsOnlyEntry(state.settings)&&positionSymbols.has(symbol)){status='POSITION_HELD';derivedReason='ACTIVE_POSITION_FACT';}
    else if(!testnetFundsOnlyEntry(state.settings)&&activeOrderSymbols.has(symbol)){status='ENTRY_WORKING';derivedReason='ACTIVE_ENTRY_ORDER_FACT';}
    else if(oldStatus==='WAIT_EXECUTION_RANGE'&&previous?.executionWait&&activeIntentIds.has(previous.executionWait.intentId)&&(!testnetFundsOnlyEntry(state.settings)||!activeOrders.some((order:any)=>order.intentId===previous.executionWait.intentId&&['UNKNOWN','SUBMITTING'].includes(order.status)))){status='WAIT_EXECUTION_RANGE';derivedReason=previous.reason;}
    else if(!testnetFundsOnlyEntry(state.settings)&&reservedSymbols.has(symbol)){status='ENTRY_WORKING';derivedReason='ACTIVE_RESERVATION_FACT';}
    else if(oldStatus==='WAIT_FOR_PRICE'&&previous?.waitContext&&(!previous.waitContext.expiresAt||previous.waitContext.expiresAt>now)){status='WAIT_FOR_PRICE';derivedReason=previous.reason;}
    else if(cooldown&&cooldown.until>now){status=COOLDOWN.has(oldStatus??'')?oldStatus:'COOLDOWN';derivedReason=cooldown.reason;}
    else if(ACTIVE_AI.has(oldStatus??'')&&activeAiSymbols.has(symbol)){status=oldStatus;derivedReason=previous.reason;}
    else if(!testnetFundsOnlyEntry(state.settings)&&occupiedUnderlyings.has(underlying)){status='EXCLUDED_UNDERLYING';derivedReason='UNDERLYING_OCCUPIED_BY_FACT';}
    else if(['ENTRY_WORKING','WAIT_EXECUTION_RANGE','HELD','POSITION_HELD','PENDING_ENTRY','POSITION','EXCLUDED_UNDERLYING','PRIMARY_COMPLETED',...ACTIVE_AI].includes(oldStatus??'')){status='READY';derivedReason='OCCUPANCY_RELEASED';}
    else continue;
    if(status===oldStatus)continue;
    const next={...previous,symbol,status,reason:derivedReason,from:oldStatus??null,updatedAt:now,...(status==='READY'?{nextEligibleAt:null,executionWait:null}:{}),derivedFromFacts:true};
    state.candidateLifecycle.set(symbol,next);migrated++;
    events?.publish('CANDIDATE_LIFECYCLE_REDERIVED',{symbol,previousState:oldStatus??null,nextState:status,reason:derivedReason,trigger:reason,occupancy:{position:positionSymbols.has(symbol),activeEntryOrder:activeOrderSymbols.has(symbol),reservation:reservedSymbols.has(symbol),underlyingOccupied:occupiedUnderlyings.has(underlying)}},symbol);
  }
  return{checked:symbols.size,migrated,positions:positionSymbols.size,activeEntryOrders:activeOrderSymbols.size,activeReservations:activeReservations.length};
}

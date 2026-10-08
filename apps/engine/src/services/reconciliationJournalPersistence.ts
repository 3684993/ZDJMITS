import type {DomainEvent} from '../events/eventBus.js';
import type {RuntimeState} from '../state/runtimeState.js';
import {reconciliationTiming} from './reconciliationTiming.js';
/** Uses the cycle's precise change set. Save callbacks remain synchronous. */
export function persistReconciliationJournals(event:DomainEvent,state:RuntimeState,saveEntry:(v:any)=>void,saveManual:(v:any)=>void){
  const p=event.payload as any,changed=p?.executionChanges;
  if(event.type!=='RECONCILIATION_COMPLETED')return;
  if(!changed||!Array.isArray(changed.entryOrderIds)||!Array.isArray(changed.manualOrderIds))throw Error('RECONCILIATION_EXECUTION_CHANGE_SET_MISSING');
  reconciliationTiming.measure('entry.persistenceFanout',()=>{for(const id of new Set<string>(changed.entryOrderIds)){const order=state.entryOrders.get(id),intent=order&&state.entryIntents.get(order.intentId);if(order&&intent)saveEntry({intent,order,reservation:order.reservationId?state.entryReservations.get(order.reservationId):undefined});}});
  reconciliationTiming.measure('manual.persistenceFanout',()=>{for(const id of new Set<string>(changed.manualOrderIds)){const order=state.manualOrders.get(id),intent=order&&state.manualIntents.get(order.intentId);if(order&&intent)saveManual({intent,order});}});
}

/** Failed-write retries read the latest identity, so a stale captured packet cannot overwrite new facts. */
export function latestEntryRecord(state:RuntimeState,id:string){const order=state.entryOrders.get(id),intent=order&&state.entryIntents.get(order.intentId);if(!order||!intent)throw Error('ENTRY_RETRY_FACT_UNAVAILABLE');return{intent,order,reservation:order.reservationId?state.entryReservations.get(order.reservationId):undefined};}
export function latestManualRecord(state:RuntimeState,id:string){const order=state.manualOrders.get(id),intent=order&&state.manualIntents.get(order.intentId);if(!order||!intent)throw Error('MANUAL_RETRY_FACT_UNAVAILABLE');return{intent,order};}

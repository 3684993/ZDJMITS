import {isDeepStrictEqual} from 'node:util';
import type {RuntimeState} from '../state/runtimeState.js';
/** Exact before/after snapshots only for touched identities, never entire execution history. */
export class ReconciliationChanges {
  private entry=new Map<string,unknown>();private manual=new Map<string,unknown>();
  constructor(private state:RuntimeState){}
  private entryValue(id:string){const order=this.state.entryOrders.get(id);return{order,intent:order&&this.state.entryIntents.get(order.intentId),reservation:order?.reservationId?this.state.entryReservations.get(order.reservationId):undefined};}
  private manualValue(id:string){const order=this.state.manualOrders.get(id);return{order,intent:order&&this.state.manualIntents.get(order.intentId)};}
  private touchEntry(id:string){if(!this.entry.has(id))this.entry.set(id,structuredClone(this.entryValue(id)));}
  private touchManual(id:string){if(!this.manual.has(id))this.manual.set(id,structuredClone(this.manualValue(id)));}
  setEntry(id:string,row:any){if(!isDeepStrictEqual(this.state.entryOrders.get(id),row))this.touchEntry(id);this.state.entryOrders.set(id,row);}
  setManual(id:string,row:any){if(!isDeepStrictEqual(this.state.manualOrders.get(id),row))this.touchManual(id);this.state.manualOrders.set(id,row);}
  observeEntry(id:string|undefined,work:()=>unknown){if(id)this.touchEntry(id);return work();}
  reservation(id:string,work:()=>unknown){const before=this.state.entryReservations.get(id);const result=work();if(!isDeepStrictEqual(before,this.state.entryReservations.get(id)))for(const order of this.state.entryOrders.values())if(order.reservationId===id){if(!this.entry.has(order.id)){const value=this.entryValue(order.id);this.entry.set(order.id,structuredClone({...value,reservation:before}));}}return result;}
  cleanupReservations(){const before=new Map(this.state.entryReservations);const result=this.state.cleanupReservations();if(result)for(const [id,row]of before)if(!isDeepStrictEqual(row,this.state.entryReservations.get(id)))for(const order of this.state.entryOrders.values())if(order.reservationId===id&&!this.entry.has(order.id))this.entry.set(order.id,structuredClone({...this.entryValue(order.id),reservation:row}));return result;}
  setManualIntent(id:string,next:any,orderId:string){const previous=this.state.manualIntents.get(id),defined=(row:any)=>Object.fromEntries(Object.entries(row??{}).filter(([,value])=>value!==undefined));if(isDeepStrictEqual(defined(previous),defined({...next,updatedAt:previous?.updatedAt})))return;this.touchManual(orderId);this.state.manualIntents.set(id,next);}
  payload(){return{entryOrderIds:[...this.entry].filter(([id,before])=>!isDeepStrictEqual(before,this.entryValue(id))).map(([id])=>id),manualOrderIds:[...this.manual].filter(([id,before])=>!isDeepStrictEqual(before,this.manualValue(id))).map(([id])=>id)};}
}

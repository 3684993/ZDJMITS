import {reconciliationTiming} from '../services/reconciliationTiming.js';
import { EventEmitter } from 'node:events';
export interface DomainEvent { id:string; type:string; ts:number; symbol?:string; payload?:unknown; }
export class EventBus extends EventEmitter {
  private seq=0;
  onMeasured(group:string,listener:(event:DomainEvent)=>void){const wrapped=(event:DomainEvent)=>reconciliationTiming.measure(`listener.${group}.${event.type==='RECONCILIATION_COMPLETED'?'Completion':'Other'}`,()=>listener(event));this.on('event',wrapped);return wrapped;}

  publish(type:string,payload?:unknown,symbol?:string){ const event:DomainEvent={id:`evt_${Date.now()}_${++this.seq}`,type,ts:Date.now(),payload,...(symbol?{symbol}:{})}; reconciliationTiming.measure('eventBus.genericListeners',()=>this.emit('event',event)); reconciliationTiming.measure('eventBus.typedListeners',()=>this.emit(type,event)); return event; }
}

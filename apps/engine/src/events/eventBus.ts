import { EventEmitter } from 'node:events';
export interface DomainEvent { id:string; type:string; ts:number; symbol?:string; payload?:unknown; }
export class EventBus extends EventEmitter {
  private seq=0;
  publish(type:string,payload?:unknown,symbol?:string){ const event:DomainEvent={id:`evt_${Date.now()}_${++this.seq}`,type,ts:Date.now(),payload,...(symbol?{symbol}:{})}; this.emit('event',event); this.emit(type,event); return event; }
}

import {randomUUID} from 'node:crypto';
import type { ExecutionFill } from '@zdj/contracts';
import type { PositionLifecycleState, RuntimeState } from '../state/runtimeState.js';

export type LifecycleTransition='OPEN'|'INCREASE'|'REDUCE'|'CLOSE'|'UNCHANGED';
export class PositionLifecycleTracker {
  constructor(private readonly state:RuntimeState){}
  key(symbol:string,side:'LONG'|'SHORT'){return `${symbol}:${side}`;}
  observe(input:{symbol:string;side:'LONG'|'SHORT';quantity:number;openedAt?:number;firstObservedAt?:number;source:PositionLifecycleState['source']}):{transition:LifecycleTransition;lifecycle:PositionLifecycleState}{
    const key=this.key(input.symbol,input.side),now=Date.now(),previous=this.state.lifecycles.get(key);
    if(!previous||previous.status==='CLOSED'){
      const lifecycle:PositionLifecycleState={cycleId:`cycle_${input.symbol}_${input.side}_${randomUUID()}`,key,symbol:input.symbol,side:input.side,previousQty:0,currentQty:input.quantity,openedAt:input.openedAt??now,firstObservedAt:input.firstObservedAt??now,entryOrderIds:[],entryTradeIds:[],exitOrderIds:[],exitTradeIds:[],source:input.source,lastReconciledAt:now,status:'OPEN'};
      this.state.lifecycles.set(key,lifecycle);return{transition:'OPEN',lifecycle};
    }
    const delta=input.quantity-previous.currentQty,transition=Math.abs(delta)<1e-10?'UNCHANGED':delta>0?'INCREASE':'REDUCE';
    const lifecycle={...previous,previousQty:previous.currentQty,currentQty:input.quantity,lastReconciledAt:now,status:transition==='REDUCE'?'REDUCED':'OPEN' as 'OPEN'|'REDUCED'};
    this.state.lifecycles.set(key,lifecycle);return{transition,lifecycle};
  }
  close(symbol:string,side:'LONG'|'SHORT',source:PositionLifecycleState['source']){
    const key=this.key(symbol,side),previous=this.state.lifecycles.get(key),now=Date.now();
    if(!previous)return null;
    const lifecycle={...previous,previousQty:previous.currentQty,currentQty:0,lastReconciledAt:now,status:'CLOSED' as const,source};this.state.lifecycles.set(key,lifecycle);return lifecycle;
  }
  attachFill(fill:ExecutionFill,stage:'ENTRY'|'EXIT'){
    const lifecycle=this.state.lifecycles.get(this.key(fill.symbol,fill.direction));if(!lifecycle)return;
    const ids=stage==='ENTRY'?{order:'entryOrderIds',trade:'entryTradeIds'}:{order:'exitOrderIds',trade:'exitTradeIds'};
    const next={...lifecycle,[ids.order]:[...new Set([...lifecycle[ids.order],fill.orderId])],[ids.trade]:[...new Set([...lifecycle[ids.trade],fill.tradeId])]} as PositionLifecycleState;this.state.lifecycles.set(lifecycle.key,next);
  }
}

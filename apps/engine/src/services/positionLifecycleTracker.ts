import {randomUUID} from 'node:crypto';
import type { ExecutionFill } from '@zdj/contracts';
import type { PositionLifecycleState, RuntimeState } from '../state/runtimeState.js';

export type LifecycleTransition='OPEN'|'INCREASE'|'REDUCE'|'CLOSE'|'UNCHANGED';

/**
 * The physical position cycle: one continuous non-zero holding of
 * environment + account + symbol + positionSide.
 *
 * This class is the only authority for that identity (P2). An add-on produces a new Entry lot and
 * keeps the cycle; a partial close keeps the cycle and its `openedAt`; only a proven return to zero
 * followed by a new open starts another cycle. Before this split, the engine keyed a TradeRecord by
 * the individual Entry order, so a take-profit placed over the aggregated position was booked
 * against whichever single Entry happened to own that cycle id and the ledger showed a negative
 * remaining quantity (R4).
 *
 * Within one engine process the environment and account are fixed and enforced by the write scope,
 * so the in-memory key is `symbol:side`; the persisted cycle carries the full scope.
 */
export class PositionLifecycleTracker {
  constructor(private readonly state:RuntimeState){}
  key(symbol:string,side:'LONG'|'SHORT'){return `${symbol}:${side}`;}
  observe(input:{symbol:string;side:'LONG'|'SHORT';quantity:number;cycleId?:string|null;openedAt?:number;firstObservedAt?:number;source:PositionLifecycleState['source'];lotId?:string|null;at?:number}):{transition:LifecycleTransition;lifecycle:PositionLifecycleState}{
    const key=this.key(input.symbol,input.side),now=Number(input.at??Date.now()),previous=this.state.lifecycles.get(key);
    if(!previous||previous.status==='CLOSED'){
      const lifecycle:PositionLifecycleState={cycleId:(input.cycleId!==previous?.cycleId?input.cycleId:null)??`cycle_${input.symbol}_${input.side}_${randomUUID()}`,key,symbol:input.symbol,side:input.side,
        previousQty:0,currentQty:input.quantity,openedAt:input.openedAt??now,firstObservedAt:input.firstObservedAt??now,
        lastAddAt:input.quantity>0?now:null,addCount:0,entryOrderIds:[],entryTradeIds:[],exitOrderIds:[],exitTradeIds:[],entryLotIds:input.lotId?[input.lotId]:[],
        source:input.source,lastReconciledAt:now,status:'OPEN'};
      this.state.lifecycles.set(key,lifecycle);return{transition:'OPEN',lifecycle};
    }
    const delta=input.quantity-previous.currentQty,transition=Math.abs(delta)<1e-10?'UNCHANGED':delta>0?'INCREASE':'REDUCE';
    // An increase is a new lot inside the same physical cycle: openedAt, firstObservedAt and the
    // cycle id all survive, which is what makes the aggregated exit conserve and the hold duration
    // keep counting from the first fill.
    const lifecycle={...previous,previousQty:previous.currentQty,currentQty:input.quantity,lastReconciledAt:now,
      ...(transition==='INCREASE'?{lastAddAt:now,addCount:Number(previous.addCount??0)+1,...(input.lotId&&!previous.entryLotIds?.includes(input.lotId)?{entryLotIds:[...new Set([...(previous.entryLotIds??[]),input.lotId])]}:{})}:{}),
      status:transition==='REDUCE'?'REDUCED':'OPEN' as 'OPEN'|'REDUCED'};
    this.state.lifecycles.set(key,lifecycle);return{transition,lifecycle};
  }
  close(symbol:string,side:'LONG'|'SHORT',source:PositionLifecycleState['source']){
    const key=this.key(symbol,side),previous=this.state.lifecycles.get(key),now=Date.now();
    if(!previous)return null;
    const lifecycle={...previous,previousQty:previous.currentQty,currentQty:0,closedAt:now,lastReconciledAt:now,status:'CLOSED' as const,source};this.state.lifecycles.set(key,lifecycle);return lifecycle;
  }
  /** The cycle a fill belongs to, creating one only when a credible non-zero holding is observed. */
  cycleFor(symbol:string,side:'LONG'|'SHORT'){return this.state.lifecycles.get(this.key(symbol,side))??null;}
  attachFill(fill:ExecutionFill,stage:'ENTRY'|'EXIT'){
    const lifecycle=this.state.lifecycles.get(this.key(fill.symbol,fill.direction));if(!lifecycle||!fill.cycleId||fill.cycleId!==lifecycle.cycleId)return;
    const ids=stage==='ENTRY'?{order:'entryOrderIds',trade:'entryTradeIds'}:{order:'exitOrderIds',trade:'exitTradeIds'};
    const next={...lifecycle,[ids.order]:[...new Set([...lifecycle[ids.order],fill.orderId])],[ids.trade]:[...new Set([...lifecycle[ids.trade],fill.tradeId])],
      ...(stage==='ENTRY'&&fill.entryLotId?{entryLotIds:[...new Set([...(lifecycle.entryLotIds??[]),fill.entryLotId])]}:{})} as PositionLifecycleState;this.state.lifecycles.set(lifecycle.key,next);
  }
}

import type { EntryOrder, ManualOrder, Position, Quote, TakeProfitOrder } from '@zdj/contracts';
import type { ExchangeTradeAdapter } from '../../types.js';

export class MockExchangeAdapter implements ExchangeTradeAdapter {
  private entries=new Map<string,EntryOrder>(); private tps=new Map<string,TakeProfitOrder>(); private manualOrders=new Map<string,ManualOrder>(); private positions=new Map<string,Position>();
  async placeEntry(order:EntryOrder){const next={...order,status:'WORKING' as const,updatedAt:Date.now(),exchangeOrderId:`mock_${order.id}`};this.entries.set(next.id,next);return next;}
  async findEntryByClientOrderId(order:EntryOrder){return [...this.entries.values()].find(row=>row.symbol===order.symbol&&row.clientOrderId===order.clientOrderId)??null;}
  async cancelEntry(order:EntryOrder){const next={...order,status:'CANCELED' as const,updatedAt:Date.now()};this.entries.set(next.id,next);return next;}
  async replaceEntry(order:EntryOrder,newPrice:number){const next={...order,price:newPrice,repriceCount:order.repriceCount+1,updatedAt:Date.now(),status:'WORKING' as const};this.entries.set(next.id,next);return next;}
  async placeTakeProfit(order:TakeProfitOrder){const next={...order,status:'WORKING' as const,updatedAt:Date.now(),exchangeOrderId:`mock_${order.id}`};this.tps.set(next.id,next);return next;}
  async placeManualOrder(request:{clientOrderId:string;internalOrderId?:string;symbol:string;side:'BUY'|'SELL';positionSide?:'LONG'|'SHORT';type:'LIMIT'|'MARKET';quantity:number;price?:number;reduceOnly:boolean;postOnly:boolean}){const now=Date.now(),id=request.internalOrderId??request.clientOrderId,next:ManualOrder={id,intentId:id,clientOrderId:request.clientOrderId,exchangeOrderId:`mock_${request.clientOrderId}`,positionId:'',symbol:request.symbol,side:request.side,positionSide:request.positionSide??'BOTH',type:request.type,quantity:request.quantity,price:request.price??null,reduceOnly:request.reduceOnly,postOnly:request.postOnly,status:request.type==='MARKET'?'FILLED':'WORKING',filledQuantity:request.type==='MARKET'?request.quantity:0,createdAt:now,updatedAt:now};this.manualOrders.set(next.id,next);return next;}
  async cancelManualOrder(order:ManualOrder){const next={...order,status:'CANCELED' as const,updatedAt:Date.now()};this.manualOrders.set(order.id,next);return next;}
  async findTakeProfitByClientOrderId(order:TakeProfitOrder){return this.tps.get(order.id)??null;}
  async cancelTakeProfit(order:TakeProfitOrder){const next={...order,status:'CANCELED' as const,updatedAt:Date.now()};this.tps.set(next.id,next);return next;}
  async fetchOpenOrders(symbol?:string){return[...this.entries.values(),...this.tps.values()].filter(o=>(!symbol||o.symbol===symbol)&&(o.status==='WORKING'||('status'in o&&o.status==='PARTIALLY_FILLED')));}
  async fetchPositions(){return[...this.positions.values()];}
  async setLeverage(_symbol:string,_leverage:number){return;}
  async tick(quotes:Map<string,Quote>){
    const filledEntries:EntryOrder[]=[],filledTakeProfits:TakeProfitOrder[]=[];
    for(const [id,o] of this.entries){if(o.status!=='WORKING')continue;const q=quotes.get(o.symbol);if(!q)continue;const hit=o.side==='LONG'?q.ask<=o.price:q.bid>=o.price;if(hit){const filled={...o,status:'FILLED' as const,filledQuantity:o.quantity,updatedAt:Date.now()};this.entries.set(id,filled);filledEntries.push(filled);const now=Date.now();const position:Position={id:`pos_${o.id}`,symbol:o.symbol,side:o.side,quantity:o.quantity,entryPrice:o.price,markPrice:q.mark,leverage:o.leverage,unrealizedPnl:0,unrealizedPnlPercent:0,openedAt:now,firstObservedAt:now,entryTimeSource:'SYSTEM_FILL',managementStatus:'AUTO_MANAGED',humanManagedAt:null,tpStatus:'PENDING',tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE'};this.positions.set(position.id,position);}}
    for(const [id,o] of this.tps){if(o.status!=='WORKING')continue;const q=quotes.get(o.symbol);if(!q)continue;const pos=this.positions.get(o.positionId);if(!pos)continue;const hit=pos.side==='LONG'?q.bid>=o.price:q.ask<=o.price;if(hit){const filled={...o,status:'FILLED' as const,updatedAt:Date.now()};this.tps.set(id,filled);filledTakeProfits.push(filled);this.positions.delete(pos.id);}}
    for(const [id,p] of this.positions){const q=quotes.get(p.symbol);if(!q)continue;const move=p.side==='LONG'?q.mark-p.entryPrice:p.entryPrice-q.mark;const pnl=move*p.quantity;this.positions.set(id,{...p,markPrice:q.mark,unrealizedPnl:pnl,unrealizedPnlPercent:(move/p.entryPrice)*p.leverage*100});}
    return{filledEntries,filledTakeProfits};
  }
}

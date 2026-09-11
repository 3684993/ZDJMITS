import type { ExchangeTradeAdapter } from '../types.js';
import type { RuntimeState } from '../state/runtimeState.js';
import type { MarketDataHub } from './marketDataHub.js';
import type { PositionService } from './positionService.js';
import type { TpGuardian } from './tpGuardian.js';
import type { EventBus } from '../events/eventBus.js';
import { reconcileCandidateLifecycles } from './candidateLifecycleDeriver.js';
export class ExchangeLoop {
  constructor(private adapter:ExchangeTradeAdapter,private state:RuntimeState,private market:MarketDataHub,private positions:PositionService,private tp:TpGuardian,private events:EventBus){}
  async tick(){if(!this.adapter.tick){this.positions.updateMarks();return;}const result=await this.adapter.tick(this.market.quotes());for(const filled of result.filledEntries){const pos=this.positions.onEntryFilled(filled);if(filled.reservationId)this.state.commitEntryReservation(filled.reservationId);await this.tp.ensure(pos);this.events.publish('ENTRY_FILLED',{order:filled,positionId:pos.id},filled.symbol);}for(const filled of result.filledTakeProfits){this.state.tpOrders.set(filled.id,filled);this.positions.onTakeProfitFilled(filled);this.events.publish('TP_FILLED',filled,filled.symbol);}reconcileCandidateLifecycles(this.state,this.events,'EXCHANGE_FILL');this.positions.updateMarks();}
}

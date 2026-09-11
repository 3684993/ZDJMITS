import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';

/** Deterministic closed-bar observer. It never calls AI, closes a position, or alters its TP. */
export class LossHandoffService {
  constructor(private state:RuntimeState,private events:EventBus){}
  tick(){const threshold=this.state.settings.positionManagement?.lossHandoffBars??4;for(const position of this.state.positions.values()){
    const card:any=this.state.snapshots.get(position.symbol)?.technical?.['15m'],closedAt=Number(card?.barCloseTime),closedPrice=Number(card?.lastClosedBar?.close),now=Date.now();
    if(!card||card.isClosed!==true||!Number.isFinite(closedAt)||!Number.isFinite(closedPrice)||closedPrice<=0||card.lastClosedBar?.closeTime!==closedAt||closedAt>now||now-closedAt>2_000_000||closedAt<=position.openedAt){const prior:any=position.lossHandoff;if(prior?.status==='ACTIVE')this.state.positions.set(position.id,{...position,lossHandoff:{...prior,status:'UNKNOWN'}});continue;}
    const prior:any=position.lossHandoff??{cycleId:position.id,lastClosedBarAt:null,consecutiveLossBars:0,status:'ACTIVE'};
    if(prior.status==='HUMAN_HANDOFF'||prior.lastClosedBarAt===closedAt)continue;
    if(prior.lastClosedBarAt!==null&&closedAt<prior.lastClosedBarAt){this.state.positions.set(position.id,{...position,lossHandoff:{...prior,status:'UNKNOWN'}});continue;}
    if(prior.lastClosedBarAt!==null&&closedAt-prior.lastClosedBarAt!==900_000){this.state.positions.set(position.id,{...position,lossHandoff:{...prior,status:'UNKNOWN'}});continue;}
    const loss=position.side==='LONG'?closedPrice<position.entryPrice:closedPrice>position.entryPrice,count=loss?prior.consecutiveLossBars+1:0,next={...prior,lastClosedBarAt:closedAt,consecutiveLossBars:count,status:'ACTIVE'};
    if(count>=threshold){this.state.positions.set(position.id,{...position,managementStatus:'HUMAN_MANAGED',humanManagedAt:Date.now(),lossHandoff:{...next,status:'HUMAN_HANDOFF'}});this.events.publish('POSITION_HUMAN_HANDOFF',{positionId:position.id,reason:'LOSS_HANDOFF_BARS',lossHandoffBars:count,closedBarAt:closedAt,tpRetained:true},position.symbol);}else this.state.positions.set(position.id,{...position,lossHandoff:next});
  }}
}

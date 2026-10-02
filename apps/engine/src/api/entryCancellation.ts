import type {EntryOrder} from '@zdj/contracts';
import type {RuntimeState} from '../state/runtimeState.js';
import type {EventBus} from '../events/eventBus.js';
import {entryCancelEligibility} from './entryCancelEligibility.js';
import {exchangeOrderIdentityMatch,ORDER_TERMINAL_STATUSES,type OpenOrderReadback} from '../services/currentOpenOrders.js';

/** Used only by the explicit user cancel route. No retries, new orders, or TP mutations. */
export class EntryCancellation {
  private readonly inFlight=new Set<string>();
  constructor(private readonly state:RuntimeState,private readonly events:EventBus,
    private readonly current:()=>OpenOrderReadback<any>|null|undefined,private readonly cancel:(order:EntryOrder)=>Promise<EntryOrder>,
    private readonly persist:(order:EntryOrder)=>void=()=>{}){}
  async execute(id:string) {
    const fail=(status:number,code:string,message:string)=>({status,body:{error:{code,message}}});
    if(this.inFlight.has(id))return fail(409,'ENTRY_CANCEL_IN_PROGRESS','该订单的取消结果正在核验，请勿重复发送。');
    const order=this.state.entryOrders.get(id),eligibility=entryCancelEligibility(order,this.current());
    if(!eligibility.allowed)return fail(eligibility.status,eligibility.code,eligibility.message);
    this.inFlight.add(id);
    try{
      let result:EntryOrder|null=null,error:unknown;
      try{result=await this.cancel(order!);}catch(caught){error=caught;}
      const latest=this.state.entryOrders.get(id)??order!;
      const matches=result&&exchangeOrderIdentityMatch(order,result);
      // Concurrent fill/terminal evidence must not regress when a delayed cancel result arrives.
      const latestTerminal=ORDER_TERMINAL_STATUSES.has(String(latest.status));
      const newerTerminal=latestTerminal&&(latest.status==='FILLED'||!matches||Number(latest.updatedAt)>=Number(result?.updatedAt??0));
      let saved:EntryOrder;
      if(newerTerminal)saved=latest;
      else if(matches){
        const status=ORDER_TERMINAL_STATUSES.has(String(result!.status))?result!.status:'UNKNOWN';
        saved={...latest,...result!,id:order!.id,intentId:order!.intentId,cycleId:order!.cycleId,reservationId:order!.reservationId,
          createdAt:order!.createdAt,absoluteExpiresAt:order!.absoluteExpiresAt,
          decisionCompletedAt:latest.decisionCompletedAt,decisionExecutionExpiresAt:latest.decisionExecutionExpiresAt,
          opportunityAuthorization:latest.opportunityAuthorization,selectedCandidateId:latest.selectedCandidateId,candidateSetHash:latest.candidateSetHash,
          filledQuantity:Math.max(Number(latest.filledQuantity??0),Number(result!.filledQuantity??0)),
          status,exchangeTerminalStatus:ORDER_TERMINAL_STATUSES.has(status)?status:'UNKNOWN',activeRiskExposure:!ORDER_TERMINAL_STATUSES.has(status),activeRiskEvidence:null} as EntryOrder;
      }else saved={...latest,status:'UNKNOWN',exchangeTerminalStatus:'UNKNOWN',activeRiskExposure:true,activeRiskEvidence:null,updatedAt:Date.now()} as EntryOrder;
      const confirmed=ORDER_TERMINAL_STATUSES.has(String(saved.status));
      this.state.entryOrders.set(id,saved);
      if(order!.reservationId){if(confirmed)this.state.releaseEntryReservation(order!.reservationId);else this.state.markEntryReservationWorking(order!.reservationId,order!.intentId,{orderId:id,reason:'CANCEL_RESULT_UNVERIFIED'});}
      this.persist(saved);
      const eventType=!confirmed?'ENTRY_CANCEL_UNVERIFIED':saved.status==='CANCELED'?'ENTRY_ORDER_CANCELED_MANUAL':'ENTRY_CANCEL_TERMINAL_CONFIRMED';
      this.events.publish(eventType,{
        orderId:id,status:saved.status,cancelRequested:true,occupancyReleased:confirmed,
        reason:confirmed?'EXCHANGE_TERMINAL_CONFIRMED':error?String(error):matches?'CANCEL_RESULT_NOT_TERMINAL':'CANCEL_RESULT_IDENTITY_UNVERIFIED'},order!.symbol);
      return confirmed?{status:200,body:saved}:fail(502,'ENTRY_CANCEL_RESULT_UNVERIFIED','取消结果未确认；订单保持 UNKNOWN，资金占用保留，等待对账。');
    }finally{this.inFlight.delete(id);}
  }
}

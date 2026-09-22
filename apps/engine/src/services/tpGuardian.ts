import type { Position, TakeProfitOrder } from '@zdj/contracts';
import { estimateTradingCost, takeProfitTarget, uid, roundToTick } from '@zdj/core';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import type { ExchangeTradeAdapter } from '../types.js';
import { binanceClientOrderIdFactory } from './binanceClientOrderIdFactory.js';
import { confirmedTpSubmissionRejection } from './tpSubmissionOutcome.js';
import { V396ExitRuntime, exitSubjectFromPosition } from './v396ExitRuntime.js';

export class TpGuardian {
  private retry=new Map<string,{attempt:number;nextAt:number;lastError:string}>();private repairing=new Set<string>();private suspendedPositions=new Set<string>();
  private unknownAbsenceProof=new Map<string,{firstAt:number;lastAt:number;observations:number}>();private crossedVerificationAt=new Map<string,number>();
  suspend(positionId:string){this.suspendedPositions.add(positionId);}
  resume(positionId:string){this.suspendedPositions.delete(positionId);}
  async cancel(order:TakeProfitOrder){
    const canceled=await this.exchange.cancelTakeProfit(order);
    const task=order.clientOrderId?this.exitRuntime.task(order.clientOrderId):null;
    if(task)this.converge(task.clientOrderId,canceled,task.stepSize);
    return canceled;
  }
  /**
   * C3: the only way a TP reaches the exchange. A durable mandate must exist and not be revoked,
   * the reduction must be proven against live positions, and PREPARED must be persisted with the
   * coordinator's own clientOrderId before the submit. A lost ACK is re-proved by that same ID.
   */
  async place(order:TakeProfitOrder,context?:{stepSize:number;tickSize?:number}){
    const now=Date.now(),position=this.state.positions.get(order.positionId);
    const positionSide=((position?.side ?? (order.side==='SELL'?'LONG':'SHORT'))==='SHORT'?'SHORT':'LONG') as 'LONG'|'SHORT';
    const subject=exitSubjectFromPosition({symbol:order.symbol,side:positionSide,cycleId:position?.cycleId??order.cycleId??null,openedAt:position?.openedAt??null} as any);
    const stepSize=Number(context?.stepSize??0),tickSize=Number(context?.tickSize??context?.stepSize??0);
    if(!Number.isFinite(stepSize)||stepSize<=0||!Number.isFinite(tickSize)||tickSize<=0)throw new Error('TP_STEP_SIZE_UNPROVEN');
    const quantityUnits=V396ExitRuntime.quantityUnitsOf(order.quantity,stepSize);
    if(!quantityUnits)throw new Error(`TP_QUANTITY_STEP_INVALID: ${order.quantity}/${stepSize}`);
    if(this.exchange.proveReduction===undefined||this.exchange.findExitByClientOrderId===undefined)throw new Error('REDUCTION_PROOF_UNAVAILABLE');
    const cycleId=String(subject.cycleId??'').trim();
    if(!cycleId){this.events.publish('TP_REPAIR_BLOCKED_CYCLE_UNKNOWN',{positionId:order.positionId,symbol:order.symbol},order.symbol);throw new Error('TP_CYCLE_ID_REQUIRED');}
    const durable=this.exitRuntime.mandate(subject);
    if(durable?.revokedAt!=null){this.events.publish('TP_REPAIR_BLOCKED_MANDATE_REVOKED',{positionId:order.positionId,scope:this.exitRuntime.scope(subject),cycleId,revokedAt:durable.revokedAt},order.symbol);throw new Error('TP_REPAIR_BLOCKED_MANDATE_REVOKED');}
    // J1: an exit order that exists locally or remotely without a complete identity holds the
    // quantity conservatively. Adoption is proved before anything is prepared or persisted, so a
    // refused TP can never leave a dangling PREPARED claim that would free capacity later.
    const unadopted=this.unadoptedExitUnits(position,order.id,stepSize);
    if(!unadopted.adopted){
      this.events.publish('TP_REPAIR_BLOCKED_UNADOPTED_EXIT',{positionId:order.positionId,scope:this.exitRuntime.scope(subject),cycleId,blockers:unadopted.blockers},order.symbol);
      throw new Error(`TP_EXIT_ADOPTION_REQUIRED: ${unadopted.blockers.join('|')}`);
    }
    const mandate=this.exitRuntime.ensureGuardianMandate(subject,order.price,now);
    const proof=await this.exchange.proveReduction({symbol:order.symbol,positionSide,quantity:order.quantity});
    const liveUnits=V396ExitRuntime.quantityUnitsOf(proof.liveQuantity,stepSize),positionUnits=V396ExitRuntime.quantityUnitsOf(Number(position?.quantity??order.quantity),stepSize)||quantityUnits;
    const requestKey=JSON.stringify(['TP',cycleId,mandate.version,order.id]);
    const prepared=await this.exitRuntime.prepareTakeProfit({requestKey,subject,quantityUnits,limitPrice:order.price,now:Date.now(),
      positionVersion:Math.trunc(Number((position as any)?.updatedAt??position?.firstObservedAt??position?.openedAt??0))||1,
      settingsVersion:Number((this.state.settings as any).settingsVersion??0),riskGeneration:Number(this.state.runtimeControl.capital.generation??0),
      availableReduceUnits:Math.min(liveUnits,quantityUnits),remainingUnits:positionUnits,minNotional:Number(position?.minNotional??0),tickSize,stepSize,
      proof:{kind:proof.kind,checkedAt:proof.checkedAt,positionSide:proof.positionSide},});
    if(!prepared.clientOrderId)throw new Error(`TP_EXIT_CLIENT_ORDER_ID_MISSING: ${prepared.reasons.join('|')}`);
    if(!prepared.accepted&&!prepared.submitRequired)throw new Error(`TP_EXIT_PREPARE_REFUSED: ${prepared.reasons.join('|')}`);
    const submitted:TakeProfitOrder={...order,clientOrderId:prepared.clientOrderId};
    this.state.tpOrders.set(order.id,{...submitted,status:'UNKNOWN'});
    this.events.publish('TP_SUBMISSION_PREPARED',{positionId:order.positionId,order:{...submitted,status:'UNKNOWN'}},order.symbol);
    if(!this.exitRuntime.transitionByClientOrderId(prepared.clientOrderId,'SUBMITTING',Date.now(),'TP_SUBMIT_SENT'))throw new Error('TP_EXIT_PREPARED_STATE_LOST');
    const jit=this.exitRuntime.jitBeforeSubmit({subject,clientOrderId:prepared.clientOrderId,proofCheckedAt:proof.checkedAt,now:Date.now()});
    if(!jit.allowed)throw new Error(`TP_EXIT_JIT_RECHECK_FAILED: ${jit.blockers.join('|')}`);
    try{
      const placed=await this.exchange.placeTakeProfit(submitted);
      this.converge(prepared.clientOrderId,placed,stepSize);
      return placed;
    }catch(error){
      if(confirmedTpSubmissionRejection(error)){
        this.exitRuntime.observe({eventId:`TP_REJECTED:${prepared.clientOrderId}`,clientOrderId:prepared.clientOrderId,state:'REJECTED',filledUnits:0,positionVersion:this.exitRuntime.task(prepared.clientOrderId)!.positionVersion});
        throw error;
      }
      let fact:Awaited<ReturnType<NonNullable<ExchangeTradeAdapter['findExitByClientOrderId']>>>|null=null;
      try{fact=await this.exchange.findExitByClientOrderId({symbol:submitted.symbol,clientOrderId:prepared.clientOrderId});}catch{fact=null;}
      if(fact?.state==='FOUND'&&fact.order){
        const executed=Number(fact.order.executedQuantity??0),original=Number(fact.order.originalQuantity??submitted.quantity)||submitted.quantity;
        const adopted={...submitted,exchangeOrderId:String(fact.order.exchangeOrderId??''),filledQuantity:executed,status:(executed>=original-1e-12?'FILLED':executed>0?'PARTIALLY_FILLED':'WORKING') as TakeProfitOrder['status'],updatedAt:Date.now()} as TakeProfitOrder;
        this.converge(prepared.clientOrderId,adopted,stepSize);
        this.events.publish('TP_ORDER_RECOVERED_BY_CLIENT_ID',{positionId:submitted.positionId,clientOrderId:prepared.clientOrderId,status:adopted.status},submitted.symbol);
        return adopted;
      }
      this.exitRuntime.markSubmitUncertain(prepared.clientOrderId,Date.now());
      this.events.publish('TP_SUBMIT_UNACKED_QUERY_BY_CLIENT_ID',{positionId:submitted.positionId,clientOrderId:prepared.clientOrderId,reason:String(error instanceof Error?error.message:error),retryForbidden:true},submitted.symbol);
      throw error;
    }
  }
  /** J1: every other live exit row for this position must carry a full identity, or be adopted. */
  private unadoptedExitUnits(position:any,currentOrderId:string,stepSize:number){
    const subject=exitSubjectFromPosition(position);
    const rows=[...this.state.tpOrders.values()].filter((row:any)=>row.positionId===position?.id&&row.id!==currentOrderId
      &&['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(String(row.status)));
    let blockers:string[]=[],adopted=true;
    for(const row of rows){
      const units=V396ExitRuntime.quantityUnitsOf(Number(row.quantity),stepSize);
      const complete=Boolean(String(row.clientOrderId??'').trim())&&Boolean(String(row.cycleId??'').trim())&&units>0;
      if(complete)continue;
      const outcome=this.exitRuntime.adoptRemoteExit({subject,clientOrderId:row.clientOrderId??null,quantityUnits:units,source:'TP',evidenceRef:row.exchangeOrderId??null});
      adopted=adopted&&outcome.adopted;blockers=blockers.concat(outcome.blockers);
    }
    return{adopted,blockers:[...new Set(blockers)]};
  }

  private converge(clientOrderId:string,order:TakeProfitOrder,stepSize:number){
    const filledUnits=V396ExitRuntime.quantityUnitsOf(Number((order as any).filledQuantity??0),stepSize);
    const state=order.status==='FILLED'?'FILLED':order.status==='CANCELED'?'CANCELED':order.status==='REJECTED'?'REJECTED':order.status==='EXPIRED'?'EXPIRED':filledUnits>0?'PARTIALLY_FILLED':'WORKING';
    return this.exitRuntime.observe({eventId:`TP:${clientOrderId}:${state}:${filledUnits}`,clientOrderId,state,filledUnits,positionVersion:Math.trunc(Number(order.updatedAt??Date.now()))||1});
  }
  economicsFor(position:Position,exitPrice:number){const settings=this.state.settings.takeProfit,exitRate=settings.exitFeeAssumption==='MAKER'?settings.makerFeeRate:settings.takerFeeRate;return estimateTradingCost({entryPrice:position.entryPrice,qty:position.quantity,direction:position.side,leverage:position.leverage,entryFeeRate:settings.entryFeeRate,expectedExitFeeRate:exitRate,expectedSlippagePct:settings.slippageBufferPct,feeSafetyBufferPct:settings.feeSafetyBufferPct,minNetProfitUsd:settings.minNetProfitUsd,minNetProfitRoiPct:settings.minNetProfitRoiPct},exitPrice);}
  constructor(private state:RuntimeState,private exchange:ExchangeTradeAdapter,private events:EventBus,private readonly exitRuntime:V396ExitRuntime){}
  metrics(){const positions=[...this.state.positions.values()],active=[...this.state.tpOrders.values()].filter(order=>order.status==='WORKING'),byPosition=new Map<string,number>();for(const order of active)byPosition.set(order.positionId,(byPosition.get(order.positionId)??0)+1);const orphanTp=active.filter(order=>!this.state.positions.has(order.positionId)).length,duplicateTp=[...byPosition.values()].filter(count=>count>1).reduce((sum,count)=>sum+count-1,0),qtyMismatch=active.filter(order=>{const pos=this.state.positions.get(order.positionId);return Boolean(pos&&Math.abs(order.quantity-pos.quantity)>Math.max(1e-10,pos.quantity*.000001));}).length,wrongSide=active.filter(order=>{const pos=this.state.positions.get(order.positionId);return Boolean(pos&&order.side!==(pos.side==='LONG'?'SELL':'BUY'));}).length;const covered=(p:Position)=>active.some(o=>o.positionId===p.id&&o.symbol===p.symbol&&o.side===(p.side==='LONG'?'SELL':'BUY')&&Math.abs(o.quantity-p.quantity)<=Math.max(1e-10,p.quantity*1e-6));return{unverifiedTp:[...this.state.tpOrders.values()].filter(o=>o.status==='UNKNOWN').length,required:positions.length,protected:positions.filter(p=>covered(p)).length,missing:positions.filter(p=>!covered(p)).length,repairing:positions.filter(p=>p.tpStatus==='REPAIRING').length,repairFailed:positions.filter(p=>p.tpStatus==='REPAIR_FAILED').length,manualReviewRequired:positions.filter(p=>p.tpStatus==='MANUAL_REVIEW_REQUIRED').length,orphanTp,duplicateTp,qtyMismatch,wrongSide,tpMissing:positions.filter(p=>!covered(p)).length,retryQueue:[...this.retry.values()].filter(x=>x.nextAt>Date.now()).length};}
  async ensure(position:Position,force=false){
    if(this.suspendedPositions.has(position.id))return;
    if(!this.state.settings.takeProfit.enabled)return;const current=this.state.positions.get(position.id);if(!current||this.repairing.has(current.id))return;
    let existing=current.tpOrderId?this.state.tpOrders.get(current.tpOrderId):undefined;
    existing=[...this.state.tpOrders.values()].find(o=>o.positionId===current.id&&o.symbol===current.symbol&&o.status==='WORKING'&&o.side===(current.side==='LONG'?'SELL':'BUY')&&Math.abs(o.quantity-current.quantity)<=Math.max(1e-10,current.quantity*1e-6))??existing;
    existing??=[...this.state.tpOrders.values()].find(o=>o.positionId===current.id&&o.status==='UNKNOWN');
    if(existing?.status==='UNKNOWN'){
      const proof=this.unknownAbsenceProof.get(existing.id),now=Date.now();
      if(proof&&now-proof.lastAt<15_000)return;
      try{
        const verified=await this.exchange.findTakeProfitByClientOrderId?.(existing);
        if(verified?.status==='UNKNOWN')return;
        if(!verified){
          const next={firstAt:proof?.firstAt??now,lastAt:now,observations:(proof?.observations??0)+1};this.unknownAbsenceProof.set(existing.id,next);
          this.events.publish('TP_UNKNOWN_ABSENCE_OBSERVED',{positionId:current.id,orderId:existing.id,clientOrderId:existing.clientOrderId??null,observations:next.observations,firstAt:next.firstAt,checkedAt:now,source:'BINANCE_EXACT_ORDER_NOT_FOUND',repairReleased:false},current.symbol);
          if(next.observations<2||now-next.firstAt<15_000)return;
          const terminal={...existing,status:'REJECTED' as const,updatedAt:now};this.state.tpOrders.set(existing.id,terminal);this.unknownAbsenceProof.delete(existing.id);existing=terminal;
          this.events.publish('TP_UNKNOWN_CONFIRMED_ABSENT',{positionId:current.id,orderId:terminal.id,clientOrderId:terminal.clientOrderId??null,compatibilityTerminalStatus:'REJECTED',evidence:['BINANCE_EXACT_ORDER_NOT_FOUND_TWICE'],firstObservedAt:next.firstAt,confirmedAt:now,repairReleased:true},current.symbol);
        }else{
          this.unknownAbsenceProof.delete(existing.id);const retained={...verified,id:existing.id,cycleId:existing.cycleId,positionId:existing.positionId};this.state.tpOrders.set(existing.id,retained);existing=retained;if(verified.status==='FILLED')return;
        }
      }catch(error){this.events.publish('TP_UNKNOWN_VERIFY_FAILED',{positionId:current.id,orderId:existing.id,clientOrderId:existing.clientOrderId??null,message:error instanceof Error?error.message:String(error),repairReleased:false,failClosed:true},current.symbol);return;}
    }
    const durableMandate=current.cycleId?this.exitRuntime.mandate(exitSubjectFromPosition(current)):null;
    if(durableMandate?.revokedAt!=null){this.events.publish('TP_REPAIR_BLOCKED_MANDATE_REVOKED',{positionId:current.id,revokedAt:durableMandate.revokedAt},current.symbol);return;}
    const humanPrice=durableMandate?.source==='HUMAN'?durableMandate.allowedPrice:null;
    const market=this.state.snapshots.get(current.symbol);
    if(existing?.status==='WORKING'&&Math.abs(existing.quantity-current.quantity)<=Math.max(1e-10,current.quantity*1e-6)&&existing.side===(current.side==='LONG'?'SELL':'BUY')){
      const crossed=Boolean(market&&(current.side==='LONG'?market.quote.bid>=existing.price:market.quote.ask<=existing.price));
      if(crossed&&this.exchange.findTakeProfitByClientOrderId){
        const now=Date.now(),last=this.crossedVerificationAt.get(existing.id)??0;if(now-last<30_000){this.state.positions.set(current.id,{...current,tpStatus:'PENDING',tpOrderId:existing.id});return;}this.crossedVerificationAt.set(existing.id,now);
        try{
          const verified=await this.exchange.findTakeProfitByClientOrderId(existing),checkedAt=Date.now();
          this.events.publish('TP_CROSSED_BUT_POSITION_STILL_OPEN',{positionId:current.id,orderId:existing.id,clientOrderId:existing.clientOrderId??null,tpPrice:existing.price,bid:market!.quote.bid,ask:market!.quote.ask,verifiedStatus:verified?.status??'NOT_FOUND',checkedAt},current.symbol);
          if(!verified){this.state.tpOrders.set(existing.id,{...existing,status:'UNKNOWN',updatedAt:checkedAt});this.state.positions.set(current.id,{...current,tpStatus:'PENDING',tpOrderId:existing.id,tpLastVerifiedAt:null});return;}
          const retained={...verified,id:existing.id,cycleId:existing.cycleId,positionId:existing.positionId};this.state.tpOrders.set(existing.id,retained);this.state.positions.set(current.id,{...current,tpStatus:'PENDING',tpOrderId:existing.id,tpLastVerifiedAt:checkedAt});return;
        }catch(error){this.state.positions.set(current.id,{...current,tpStatus:'PENDING',tpOrderId:existing.id});this.events.publish('TP_CROSSED_VERIFY_FAILED',{positionId:current.id,orderId:existing.id,clientOrderId:existing.clientOrderId??null,tpPrice:existing.price,bid:market!.quote.bid,ask:market!.quote.ask,message:error instanceof Error?error.message:String(error),failClosed:true},current.symbol);return;}
      }
      this.state.positions.set(current.id,{...current,tpStatus:'PROTECTED',tpOrderId:existing.id});return;
    }
    const retry=this.retry.get(current.id);if(!force&&retry&&retry.nextAt>Date.now())return;
    if(!market){this.state.positions.set(current.id,{...current,tpStatus:'MISSING',tpCoverageSource:'NONE'});return;}
    this.repairing.add(current.id);this.state.positions.set(current.id,{...current,tpStatus:'REPAIRING'});const attempt=(retry?.attempt??0)+1;this.events.publish('TP_REPAIR_STARTED',{positionId:current.id,attempt,source:'DETERMINISTIC_POSITION_FACTS'},current.symbol);
    const decimals=Math.max(0,(String(market.quote.stepSize).split('.')[1]??'').length);
    const rawQty=current.quantity*this.state.settings.takeProfit.quantityPercent/100;
    const qty=Number((Math.floor((rawQty+1e-12)/market.quote.stepSize)*market.quote.stepSize).toFixed(decimals));
    if(qty<market.quote.minQty){this.state.positions.set(current.id,{...current,tpStatus:'MANUAL_REVIEW_REQUIRED',tpOrderId:null,tpCoverageSource:'NONE'});this.repairing.delete(current.id);this.events.publish('TP_UNPROTECTED_DUST',{positionId:current.id,quantity:current.quantity,minQty:market.quote.minQty},current.symbol);return;}

    const now=Date.now(),tick=market.quote.tickSize,liveMark=market.quote.mark,sideReachable=(price:number)=>current.side==='LONG'?price>Math.max(liveMark,market.quote.ask):price<Math.min(liveMark,market.quote.bid),economic=(price:number)=>{try{return this.economicsFor(current,price);}catch{return null;}},economicallyValid=(price:number)=>{const e=economic(price);return Boolean(e&&e.expectedNetProfit>=e.requiredNetProfit);};
    const ai=current.profitTakePlan,card:any=market.technical?.['15m'],roundedAi=ai?roundToTick(ai.targetPrice,tick,current.side==='LONG'?'ceil':'floor'):null,fullPosition=current.quantity>0&&qty/current.quantity>=.999,canaryMinMovePct=fullPosition?1.2:0,v395EconomicValidated=current.economicAdmission?.version==='V3.9.5'&&current.economicAdmission.mode==='ENFORCE'&&current.economicAdmission.passed===true&&current.economicAdmission.blockers.length===0,aiMinMovePct=v395EconomicValidated?0:canaryMinMovePct,movePct=(price:number)=>Math.abs(price-current.entryPrice)/Math.max(current.entryPrice,1e-12)*100;
    const aiHorizonValid=Boolean(ai&&current.openedAt>0&&now<=current.openedAt+ai.targetHorizonMinutes*60_000);
    const aiEvidenceValid=Boolean(ai&&Array.isArray(ai.evidenceRefs)&&ai.evidenceRefs.some(ref=>/15m/i.test(String(ref)))&&card?.isClosed===true&&Number.isFinite(card?.barCloseTime)&&card?.lastClosedBar?.closeTime===card?.barCloseTime&&now-card.barCloseTime<=1_805_000);
    const aiDistanceValid=Boolean(ai&&roundedAi&&Number.isFinite(card?.atrPercent)&&movePct(roundedAi)>=aiMinMovePct&&movePct(roundedAi)<=Math.max(this.state.settings.takeProfit.structureMaxMovePercent,card.atrPercent*6));
    const aiRangeValid=Boolean(ai&&roundedAi&&roundedAi>=ai.acceptableTargetRange.min&&roundedAi<=ai.acceptableTargetRange.max);
    const aiShapeValid=Boolean(ai&&roundedAi&&Number.isFinite(roundedAi)&&roundedAi>0&&aiHorizonValid&&aiEvidenceValid&&aiDistanceValid&&aiRangeValid&&sideReachable(roundedAi)&&(current.side==='LONG'?roundedAi>current.entryPrice:roundedAi<current.entryPrice));
    const aiValid=Boolean(aiShapeValid&&economicallyValid(roundedAi!));

    const structureRaw=takeProfitTarget(current,tick,{...this.state.settings,takeProfit:{...this.state.settings.takeProfit,mode:'STRUCTURE_15M'}} as any,market,now),structurePrice=structureRaw.source==='STRUCTURE_15M'?structureRaw.price:null;
    const structureValid=Boolean(structurePrice&&Number.isFinite(structurePrice)&&structurePrice>0&&movePct(structurePrice)>=canaryMinMovePct&&sideReachable(structurePrice)&&economicallyValid(structurePrice));

    const fixedMovePercent=Math.max(this.state.settings.takeProfit.targetPriceMovePercent,canaryMinMovePct),fixedRaw=takeProfitTarget(current,tick,{...this.state.settings,takeProfit:{...this.state.settings.takeProfit,mode:'PRICE_MOVE_PERCENT',targetPriceMovePercent:fixedMovePercent}} as any,market,now).price,fixedBaseEconomics=economic(fixedRaw);
    let fixedPrice=fixedRaw;
    if(fixedBaseEconomics){const floor=roundToTick(fixedBaseEconomics.minProfitableExitPrice,tick,current.side==='LONG'?'ceil':'floor');fixedPrice=current.side==='LONG'?Math.max(fixedRaw,floor,market.quote.ask+tick,liveMark+tick):Math.min(fixedRaw,floor,market.quote.bid-tick,liveMark-tick);fixedPrice=roundToTick(fixedPrice,tick,current.side==='LONG'?'ceil':'floor');}
    const fixedEconomics=economic(fixedPrice),fixedValid=Boolean(Number.isFinite(fixedPrice)&&fixedPrice>0&&movePct(fixedPrice)>=canaryMinMovePct&&sideReachable(fixedPrice)&&fixedEconomics&&fixedEconomics.expectedNetProfit>=fixedEconomics.requiredNetProfit);

    const target=durableMandate?.source==='HUMAN'?{price:humanPrice??NaN,source:'HUMAN' as const,reason:'DURABLE_HUMAN_MANDATE'}:aiValid?{price:roundedAi!,source:'AI' as const,reason:ai!.targetReason}:structureValid?{price:structurePrice!,source:'STRUCTURE_15M' as const,reason:structureRaw.reason}:{price:fixedPrice,source:'FIXED_PROFITABLE' as const,reason:structurePrice?'STRUCTURE_BELOW_NET_OR_MARKET_FLOOR':structureRaw.reason};
    this.events.publish('TP_TARGET_SELECTED',{positionId:current.id,...target,aiPlanPresent:Boolean(ai),aiPlanValid:aiValid,aiHorizonValid,aiEvidenceValid,aiRangeValid,structureValid,fixedValid,fullPositionCanaryMinMovePct:canaryMinMovePct,aiMinMovePct,v395EconomicValidated},current.symbol);
    let price=target.price,economics=economic(price),status:'TP_OK'|'TP_TARGET_BELOW_NET_FLOOR'|'TP_TARGET_UNREALISTIC'='TP_OK';
    const finalAiRangeValid=target.source!=='AI'||Boolean(ai&&price>=ai.acceptableTargetRange.min&&price<=ai.acceptableTargetRange.max),selectedMinMovePct=target.source==='AI'?aiMinMovePct:canaryMinMovePct;
    const finalValid=Boolean(fixedValid||target.source!=='FIXED_PROFITABLE')&&Number.isFinite(price)&&price>0&&Math.abs(price/tick-Math.round(price/tick))<1e-7&&movePct(price)>=selectedMinMovePct&&sideReachable(price)&&finalAiRangeValid&&economics&&economics.expectedNetProfit>=economics.requiredNetProfit;
    if(!finalValid||!economics){status=economics&&economics.expectedNetProfit<economics.requiredNetProfit?'TP_TARGET_BELOW_NET_FLOOR':'TP_TARGET_UNREALISTIC';const exhausted=attempt>=5,delay=Math.min(15*60_000,60_000*2**Math.min(attempt-1,4)),nextAt=Date.now()+delay,fallbackEconomics=economics??fixedEconomics;if(!fallbackEconomics){this.state.positions.set(current.id,{...current,tpStatus:'MANUAL_REVIEW_REQUIRED',tpOrderId:null,tpLastVerifiedAt:Date.now(),tpCoverageSource:'NONE'});this.retry.set(current.id,{attempt,nextAt:Date.now()+15*60_000,lastError:'TP_ECONOMICS_UNAVAILABLE'});this.events.publish('TP_MANUAL_REVIEW_REQUIRED',{positionId:current.id,attempt,price,markPrice:liveMark,reason:'TP_ECONOMICS_UNAVAILABLE'},current.symbol);this.repairing.delete(current.id);return;}const blocked={...current,tpStatus:exhausted?'MANUAL_REVIEW_REQUIRED' as const:'REPAIR_FAILED' as const,tpOrderId:null,tpLastVerifiedAt:Date.now(),tpCoverageSource:'NONE' as const,tpEconomics:{currentTpPrice:Number.isFinite(price)&&price>0?price:null,expectedGrossProfit:fallbackEconomics.expectedGrossProfit,expectedFees:fallbackEconomics.estimatedTotalFee+fallbackEconomics.slippageBuffer+fallbackEconomics.feeSafetyBuffer,expectedNetProfit:fallbackEconomics.expectedNetProfit,requiredNetProfit:fallbackEconomics.requiredNetProfit,breakEvenPrice:fallbackEconomics.breakEvenPrice,minProfitableExitPrice:fallbackEconomics.minProfitableExitPrice,status}};this.state.positions.set(current.id,blocked);this.retry.set(current.id,{attempt,nextAt:exhausted?Date.now()+15*60_000:nextAt,lastError:status});this.events.publish(exhausted?'TP_MANUAL_REVIEW_REQUIRED':'TP_TARGET_UNREALISTIC',{positionId:current.id,attempt,price,markPrice:liveMark,reason:status,source:target.source,requiredNetProfit:fallbackEconomics.requiredNetProfit,expectedNetProfit:fallbackEconomics.expectedNetProfit,nextRetryAt:exhausted?Date.now()+15*60_000:nextAt},current.symbol);this.repairing.delete(current.id);return;}

    const tpEconomics={currentTpPrice:price,expectedGrossProfit:economics.expectedGrossProfit,expectedFees:economics.estimatedTotalFee+economics.slippageBuffer+economics.feeSafetyBuffer,expectedNetProfit:economics.expectedNetProfit,requiredNetProfit:economics.requiredNetProfit,breakEvenPrice:economics.breakEvenPrice,minProfitableExitPrice:economics.minProfitableExitPrice,status:'TP_OK' as const};this.state.positions.set(current.id,{...current,tpEconomics,profitTakePlanSource:target.source});const order:TakeProfitOrder={id:uid('tp'),clientOrderId:null,exchangeOrderId:null,cycleId:current.cycleId,positionId:current.id,symbol:current.symbol,side:current.side==='LONG'?'SELL':'BUY',quantity:Math.max(market.quote.minQty,qty),price,status:'WORKING',createdAt:now,updatedAt:now};
    try{if(existing?.status==='WORKING'){const canceled=await this.cancel(existing);if(!['CANCELED','EXPIRED','REJECTED'].includes(canceled.status))throw new Error('TP_REPLACEMENT_CANCEL_UNVERIFIED');this.state.tpOrders.set(existing.id,canceled);}const placed=await this.place(order,{stepSize:Number(market.quote.stepSize),tickSize:Number(market.quote.tickSize)});this.state.tpOrders.set(placed.id,placed);this.state.positions.set(current.id,{...this.state.positions.get(current.id)!,tpStatus:placed.status==='WORKING'?'PROTECTED':'PENDING',tpOrderId:placed.id,tpLastVerifiedAt:Date.now(),tpCoverageSource:'SYSTEM_CREATED'});this.retry.delete(current.id);this.events.publish('TP_PROTECTED',{positionId:current.id,order:placed,repairAttempt:attempt,tpEconomics},current.symbol);}
    catch(error){const message=error instanceof Error?error.message:String(error);const submitted=this.state.tpOrders.get(order.id),rejected=submitted?.status==='UNKNOWN'&&confirmedTpSubmissionRejection(error);if(rejected){this.state.tpOrders.set(order.id,{...submitted,status:'REJECTED',updatedAt:Date.now()});this.events.publish('TP_ORDER_REJECTED',{positionId:current.id,orderId:order.id,clientOrderId:submitted?.clientOrderId??order.clientOrderId,exchangeCode:-2022,message},current.symbol);}const exhausted=attempt>=5,delay=Math.min(15*60_000,60_000*2**Math.min(attempt-1,4)),nextAt=Date.now()+delay;this.retry.set(current.id,{attempt,nextAt:exhausted?Date.now()+15*60_000:nextAt,lastError:message});const latest=this.state.positions.get(current.id);if(latest)this.state.positions.set(current.id,{...latest,tpStatus:exhausted?'MANUAL_REVIEW_REQUIRED':'REPAIR_FAILED',tpOrderId:null,tpLastVerifiedAt:Date.now(),tpCoverageSource:'NONE'});this.events.publish(exhausted?'TP_MANUAL_REVIEW_REQUIRED':'TP_REPAIR_FAILED',{positionId:current.id,orderId:order.id,clientOrderId:submitted?.clientOrderId??order.clientOrderId,submissionOutcome:rejected?'REJECTED':submitted?'UNKNOWN':'NOT_ATTEMPTED',message,attempt,nextRetryAt:exhausted?Date.now()+15*60_000:nextAt},current.symbol);}
    finally{this.repairing.delete(current.id);}
  }
  async sweep(){for(const position of this.state.positions.values())await this.ensure(position);}
}

import { ManualIntentSchema, ManualOrderSchema, type ManualAction, type ManualIntent, type ManualOrder, type Position, type TakeProfitOrder } from '@zdj/contracts';
import { uid } from '@zdj/core';
import type { MarketDataHub } from './marketDataHub.js';
import type { RuntimeState } from '../state/runtimeState.js';
import type { EventBus } from '../events/eventBus.js';
import type { ExchangeTradeAdapter } from '../types.js';
import type { TpGuardian } from './tpGuardian.js';
import { AccountExecutor } from './accountExecutor.js';
import { binanceClientOrderIdFactory } from './binanceClientOrderIdFactory.js';
import { activeOrderStatus, executionScope, manualOrderFor, manualIntentFromOrder, type ManualExecutionJournal } from './executionLifecycle.js';

type Request={action:ManualAction;quantity?:unknown;price?:unknown;confirm?:unknown;idempotencyKey?:unknown;reason?:unknown};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const decimals=(step:number)=>Math.max(0,(String(step).split('.')[1]??'').replace(/0+$/,'').length);
const floorStep=(value:number,step:number)=>Number((Math.floor((value+1e-12)/step)*step).toFixed(decimals(step)));
const align=(value:number,step:number)=>Math.abs(value/step-Math.round(value/step))<1e-7;

export class ManualPositionService {
  private readonly executor:AccountExecutor; private readonly pending=new Map<string,Promise<unknown>>();
  constructor(private readonly state:RuntimeState,private readonly market:MarketDataHub,private readonly exchange:ExchangeTradeAdapter,private readonly tp:TpGuardian,private readonly events:EventBus,private readonly reconcile:()=>Promise<void>,private readonly journal?:ManualExecutionJournal){this.executor=new AccountExecutor(exchange);}
  private async quote(position:Position,cacheOnly=false){const cached=this.market.snapshot(position.symbol)?.quote;if(cached&&Date.now()-cached.ts<=15_000)return{quote:cached,source:'WS' as const};if(cacheOnly)throw new Error('MARKET_DATA_UNAVAILABLE: cached quote stale or missing');try{const quote=await this.market.freshQuote(position.symbol);if(!quote||Date.now()-quote.ts>15_000)throw new Error('REST quote stale');return{quote,source:'REST' as const};}catch(error){throw new Error(`MARKET_DATA_UNAVAILABLE: ${error instanceof Error?error.message:String(error)}`);}}
  private projectedNet(position:Position,price:number,qty:number){const gross=(position.side==='LONG'?price-position.entryPrice:position.entryPrice-price)*qty,fee=price*qty*.0004*2;return{gross,projectedFees:fee,projectedNet:gross-fee};}
  async preview(positionId:string,cacheOnly=false){const p=this.state.positions.get(positionId);if(!p)throw new Error('POSITION_NOT_FOUND: 持仓不存在或已被对账关闭');const {quote:q,source}=await this.quote(p,cacheOnly),reducePrice=p.side==='LONG'?q.bid:q.ask,addPrice=p.side==='LONG'?q.ask:q.bid,emergency=this.projectedNet(p,reducePrice,p.quantity),available=this.state.account.availableUsd??0,expiresAt=q.ts+15_000;const base={symbol:p.symbol,currentQty:p.quantity,mark:p.markPrice,bestBid:q.bid,bestAsk:q.ask,bid:q.bid,ask:q.ask,tickSize:q.tickSize,stepSize:q.stepSize,minQty:q.minQty,minNotional:q.minNotional,availableMargin:available,leverage:p.leverage,quoteSource:source,quoteAt:q.ts,expiresAt};return{...base,reduce:{side:p.side==='LONG'?'SELL':'BUY',positionSide:p.side,currentQty:p.quantity,defaultQty:p.quantity,priceMode:'AUTO_COUNTERPARTY',defaultPrice:reducePrice,estimatedNotional:p.quantity*reducePrice,warnings:['提交时服务端会重新读取持仓与盘口']},add:{side:p.side==='LONG'?'BUY':'SELL',positionSide:p.side,currentQty:p.quantity,priceMode:'AUTO_COUNTERPARTY',defaultPrice:addPrice,estimatedNotional:p.quantity*addPrice,warnings:['补仓必须由 HUMAN 确认']},limit:{defaultQty:p.quantity,priceMode:'AUTO_COUNTERPARTY_LIMIT',defaultPrice:addPrice,estimatedNotional:p.quantity*addPrice,warnings:[]},emergency:{phase:'PHASE1_COUNTERPARTY_LIMIT',defaultQty:p.quantity,defaultPrice:reducePrice,positionQty:p.quantity,side:p.side==='LONG'?'SELL':'BUY',limitPrice:reducePrice,tickSize:q.tickSize,projectedFees:emergency.projectedFees,projectedNet:emergency.projectedNet,quoteSource:source,quoteAt:q.ts,expiresAt,warnings:['HUMAN ONLY：确认后按最新盘口提交 reduce-only LIMIT；不会提交 Market']}};}
  async execute(positionId:string,input:Request){
    if(input.action==='EMERGENCY_CLOSE'&&input.confirm===true&&!this.state.manualExitGoals.has(positionId)){
      const p=this.state.positions.get(positionId);if(p){const goal={positionId,symbol:p.symbol,side:p.side,rootKey:typeof input.idempotencyKey==='string'?input.idempotencyKey:uid('human_exit'),attempt:0,createdAt:Date.now(),nextAttemptAt:0,lastReason:null};this.state.manualExitGoals.set(positionId,goal);this.events.publish('MANUAL_EXIT_GOAL_QUEUED',{goal,actor:'HUMAN'},p.symbol);}
    }
    const prior=this.pending.get(positionId);
    const task=(async()=>{if(prior)await prior.catch(()=>{});return this.executeLocked(positionId,input);})();
    this.pending.set(positionId,task);
    try{return await task;}finally{if(this.pending.get(positionId)===task)this.pending.delete(positionId);}
  }
  /** Continue only explicitly requested human close goals; never create a strategy exit. */
  private goalWorkerBusy=false;
  async resumeExitGoals(){
    if(this.goalWorkerBusy)return;this.goalWorkerBusy=true;
    try{for(const [key,goal] of this.state.manualExitGoals){
      if(this.pending.has(key)||Date.now()<goal.nextAttemptAt)continue;
      let unlock!:()=>void;const lock=new Promise<void>(resolve=>{unlock=resolve;});this.pending.set(key,lock);
      try{
        const positions=await this.exchange.fetchPositions(),position=positions.find(p=>p.symbol===goal.symbol&&p.side===goal.side);
        if(!position){this.state.manualExitGoals.delete(key);this.events.publish('MANUAL_EXIT_GOAL_COMPLETED',{positionId:key,goalKey:goal.rootKey,positionQuantity:0},goal.symbol);continue;}
        // Cancel outstanding entry risk before chasing a user-requested full close.
        let uncertain=false;
        for(const order of this.state.entryOrders.values())if(order.symbol===goal.symbol&&order.side===goal.side&&activeOrderStatus(order.status)){
          const result=await this.exchange.cancelEntry(order);this.state.entryOrders.set(order.id,result);
          if(activeOrderStatus(result.status))uncertain=true;else if(order.reservationId)this.state.releaseEntryReservation(order.reservationId);
        }
        const working=[...this.state.manualOrders.values()].find(o=>o.symbol===goal.symbol&&(o.positionSide===goal.side||o.positionSide==='BOTH')&&activeOrderStatus(o.status));
        if(working){const intent=this.state.manualIntents.get(working.intentId);
          if(intent?.action==='EMERGENCY_CLOSE'&&working.status!=='UNKNOWN'&&Date.now()-working.createdAt<30000)continue;
          if(!this.exchange.cancelManualOrder)uncertain=true;
          else{const result=await this.exchange.cancelManualOrder(working);this.state.manualOrders.set(working.id,result);if(intent){const next=manualIntentFromOrder(intent,result,true);this.state.manualIntents.set(next.id,next);this.journal?.save({intent:next,order:result});}if(activeOrderStatus(result.status))uncertain=true;}
        }
        if(uncertain){goal.lastReason='WAITING_EXACT_CANCEL_CONFIRMATION';goal.nextAttemptAt=Date.now()+5000;continue;}
        await this.reconcile();
        const existingAttempt=[...this.state.manualIntents.values()].find(i=>i.idempotencyKey===`${goal.rootKey}:attempt:${goal.attempt}`);
        if(existingAttempt&&['COMPLETED','CANCELED','EXPIRED','REJECTED'].includes(existingAttempt.status))goal.attempt++;
        goal.nextAttemptAt=Date.now()+5000;goal.lastReason='REFRESH_REAL_REMAINDER';
        this.events.publish('MANUAL_EXIT_GOAL_PROGRESS',{goal},goal.symbol);
        await this.executeLocked(key,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:`${goal.rootKey}:attempt:${goal.attempt}`,reason:'CONTINUE_EXPLICIT_HUMAN_CLOSE'});
      }catch(error){goal.lastReason=String(error);goal.nextAttemptAt=Date.now()+10000;this.events.publish('MANUAL_EXIT_GOAL_WAITING',{goal,reason:goal.lastReason},goal.symbol);}
      finally{if(this.pending.get(key)===lock)this.pending.delete(key);unlock();}
    }}finally{this.goalWorkerBusy=false;}
  }
  private async executeLocked(positionId:string,input:Request){
    const existingKey=typeof input.idempotencyKey==='string'?input.idempotencyKey.trim():'';
    if(existingKey){const prior=[...this.state.manualIntents.values()].find(x=>x.positionId===positionId&&x.action===input.action&&x.idempotencyKey===existingKey);if(prior)return{intent:prior,order:manualOrderFor(prior,this.state.manualOrders.values())??null,replayed:true};}
    let position=this.state.positions.get(positionId);
    if(!position&&input.action==='EMERGENCY_CLOSE'){
      const actual=await this.exchange.fetchPositions();position=actual.find(p=>p.id===positionId||`exchange_${p.symbol}_${p.side}`===positionId);
      if(!position)return{intent:null,order:null,replayed:true,goalSatisfied:true,reason:'POSITION_ALREADY_CLOSED'};
      this.state.positions.set(position.id,position);
    }
    if(!position)throw new Error('POSITION_NOT_FOUND: 持仓不存在或已被对账关闭');
    const occupied=[...this.state.manualOrders.values()].find(order=>order.symbol===position!.symbol&&(order.positionSide===position!.side||order.positionSide==='BOTH')&&activeOrderStatus(order.status));
    if(occupied&&!['REBUILD_TP','REPLACE_TP'].includes(input.action)){const prior=this.state.manualIntents.get(occupied.intentId);if(prior)return{intent:prior,order:occupied,replayed:true,reason:input.action==='EMERGENCY_CLOSE'&&prior.action!=='EMERGENCY_CLOSE'?'EXIT_QUEUED_BEHIND_ACTIVE_TASK':'EXISTING_POSITION_TASK'};throw new Error('UNLINKED_ACTIVE_POSITION_TASK');}
    const remote=await this.exchange.fetchPositions(),fresh=remote.find(x=>x.symbol===position!.symbol&&x.side===position!.side);if(!fresh||fresh.quantity<=0)return{intent:null,order:null,replayed:true,goalSatisfied:true,reason:'POSITION_ALREADY_CLOSED'};position={...position,quantity:fresh.quantity,entryPrice:fresh.entryPrice,markPrice:fresh.markPrice,leverage:fresh.leverage};this.state.positions.set(position.id,position);
    const action=input.action,now=Date.now(),id=uid('manual_intent'),key=existingKey||id,client=binanceClientOrderIdFactory.create(action==='REDUCE'?'MR':action==='ADD'?'MA':action==='PLACE_LIMIT'?'ML':action==='EMERGENCY_CLOSE'?'EC1':'MC',id);
    let intent=ManualIntentSchema.parse({id,idempotencyKey:key,positionId,symbol:position.symbol,side:position.side,action,quantity:null,price:null,reduceOnly:action!=='ADD',postOnly:!['EMERGENCY_CLOSE','REBUILD_TP','REPLACE_TP'].includes(action),status:'RECEIVED',reason:typeof input.reason==='string'?input.reason.slice(0,240):null,exchangeOrderId:null,clientOrderId:client,createdAt:now,updatedAt:now});
    this.state.manualIntents.set(id,intent);this.events.publish('MANUAL_INTENT_CREATED',{intent,actor:'HUMAN'},position.symbol);let protectionCleared=false,submissionAttempted=false;
    try{
      if(this.state.settings.connections.executionMode!=='TESTNET_ENABLED')throw new Error('TRADING_BLOCKED: 人工写操作仅允许 Testnet');
      if(this.state.account.status!=='READY')throw new Error(`TRADING_BLOCKED: 私有账户未就绪（${this.state.account.status}）`);
      if(action==='EMERGENCY_CLOSE'&&input.confirm!==true)throw new Error('CONFIRMATION_REQUIRED: 紧急平仓必须二次确认');
      const quote=await this.quote(position),q=quote.quote,numericQty=finite(input.quantity)?Number(input.quantity):null,numericPrice=finite(input.price)?Number(input.price):null,isTp=action==='REPLACE_TP'||action==='REBUILD_TP';
      if(isTp){if(!numericPrice||!align(numericPrice,q.tickSize))throw new Error(`VALIDATION_PRICE_PRECISION: TP 价格必须符合 tickSize ${q.tickSize}`);if(position.side==='LONG'&&numericPrice<=position.markPrice)throw new Error('VALIDATION_TP_SIDE: LONG TP 必须高于 Mark');if(position.side==='SHORT'&&numericPrice>=position.markPrice)throw new Error('VALIDATION_TP_SIDE: SHORT TP 必须低于 Mark');}
      const qty=floorStep(action==='EMERGENCY_CLOSE'?position.quantity:numericQty??position.quantity,q.stepSize);if(qty<q.minQty)throw new Error(`VALIDATION_MIN_QTY: 数量不得小于 ${q.minQty}`);
      const side:'BUY'|'SELL'=action==='ADD'?(position.side==='LONG'?'BUY':'SELL'):(position.side==='LONG'?'SELL':'BUY'),defaultPrice=action==='REDUCE'||action==='EMERGENCY_CLOSE'?(position.side==='LONG'?q.bid:q.ask):action==='ADD'||action==='PLACE_LIMIT'?(position.side==='LONG'?q.ask:q.bid):numericPrice!,price=isTp?numericPrice!:action==='EMERGENCY_CLOSE'?defaultPrice:finite(input.price)?numericPrice!:defaultPrice;
      if(price<=0||!align(price,q.tickSize))throw new Error(`VALIDATION_PRICE_PRECISION: 价格必须符合 tickSize ${q.tickSize}`);if(['REDUCE','EMERGENCY_CLOSE'].includes(action)&&qty>position.quantity+1e-9)throw new Error('VALIDATION_QTY_EXCEEDS_POSITION: 不能超过真实持仓');if(qty*price<q.minNotional)throw new Error(`VALIDATION_MIN_NOTIONAL: 名义价值不得小于 ${q.minNotional}`);
      const projected=action==='EMERGENCY_CLOSE'?this.projectedNet(position,price,qty):null;intent=ManualIntentSchema.parse({...intent,quantity:qty,price,status:'VALIDATED',updatedAt:Date.now()});this.state.manualIntents.set(id,intent);this.events.publish('MANUAL_INTENT_VALIDATED',{intent,quote:{bid:q.bid,ask:q.ask,source:quote.source,quoteAt:q.ts},freshPositionQty:position.quantity,projected,lossIsInformational:true},position.symbol);
      if(isTp){const order=await this.replaceTakeProfit(position,intent,qty,price);return this.complete(intent,order);}
      const pendingOrder=ManualOrderSchema.parse({id:`manual_order_${id}`,intentId:id,clientOrderId:client,exchangeOrderId:null,positionId:position.id,symbol:position.symbol,side,positionSide:position.side,type:'LIMIT',quantity:qty,price,reduceOnly:action!=='ADD',postOnly:false,status:'UNKNOWN',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()});
      intent={...intent,status:'UNKNOWN',reason:'SUBMISSION_PREPARED'};
      const claimed=this.journal?.claim(executionScope(this.state.settings.connections.exchange.environment,this.state.settings.connections.exchange.credentialRef,position.symbol,position.side),{intent,order:pendingOrder})??{intent,order:pendingOrder};
      this.state.manualIntents.set(claimed.intent.id,claimed.intent);this.state.manualOrders.set(claimed.order.id,claimed.order);
      if(claimed.intent.id!==id){this.state.manualIntents.delete(id);return{intent:claimed.intent,order:claimed.order,replayed:true,reason:'DURABLE_POSITION_TASK'};}
      this.events.publish('MANUAL_SUBMISSION_PREPARED',{intent,order:pendingOrder},position.symbol);
      const rebalanceTp=['REDUCE','EMERGENCY_CLOSE'].includes(action);if(rebalanceTp){protectionCleared=true;await this.clearProtectionForExit(position);}
      const request={clientOrderId:client,internalOrderId:`manual_order_${id}`,symbol:position.symbol,side,positionSide:position.side,type:'LIMIT' as const,quantity:qty,price,reduceOnly:action!=='ADD',postOnly:false};let order:ManualOrder;
      try{submissionAttempted=true;order=await this.submitOrder(position,intent,request);}catch(submitError){let recovered:ManualOrder|null=null;try{recovered=await this.exchange.findManualByClientOrderId?.({...request,internalOrderId:request.internalOrderId,positionId:position.id})??null;}catch{}if(recovered){order=recovered;this.events.publish('MANUAL_ORDER_RECOVERED_BY_CLIENT_ID',{intentId:id,clientOrderId:client,exchangeOrderId:order.exchangeOrderId,status:order.status},position.symbol);}else{order=ManualOrderSchema.parse({id:request.internalOrderId,intentId:id,clientOrderId:client,exchangeOrderId:null,positionId:position.id,symbol:position.symbol,side,positionSide:position.side,type:'LIMIT',quantity:qty,price,reduceOnly:request.reduceOnly,postOnly:false,status:'UNKNOWN',filledQuantity:0,createdAt:Date.now(),updatedAt:Date.now()});intent=ManualIntentSchema.parse({...intent,status:'UNKNOWN',reason:`SUBMIT_RESULT_UNKNOWN: ${submitError instanceof Error?submitError.message:String(submitError)}`,updatedAt:Date.now()});this.events.publish('MANUAL_ORDER_SUBMIT_UNKNOWN',{intentId:id,clientOrderId:client,reason:intent.reason,retryForbidden:true},position.symbol);}}
      const stored=ManualOrderSchema.parse({...order,positionId:position.id,intentId:id,clientOrderId:client});this.state.manualOrders.set(stored.id,stored);if(stored.status==='REJECTED'||stored.status==='CANCELED')throw new Error(`EXCHANGE_ORDER_${stored.status}: clientOrderId=${client}`);intent=ManualIntentSchema.parse({...intent,status:stored.status==='UNKNOWN'?'UNKNOWN':'SUBMITTED',exchangeOrderId:stored.exchangeOrderId,reason:stored.status==='UNKNOWN'?intent.reason??'SUBMIT_RESULT_UNKNOWN':intent.reason,updatedAt:Date.now()});this.state.manualIntents.set(id,intent);this.events.publish('MANUAL_ACTION_SUBMITTED',{intent,order:stored,submissionComplete:true,positionCloseComplete:false},position.symbol);if(rebalanceTp)this.tp.resume(position.id);
      this.journal?.save({intent,order:stored});
      try{await this.reconcile();const remaining=this.state.positions.get(position.id),latest=this.state.manualOrders.get(stored.id)??stored;intent=manualIntentFromOrder(intent,latest,Boolean(remaining));this.state.manualIntents.set(id,intent);if(intent.status==='COMPLETED')this.events.publish('MANUAL_ACTION_COMPLETED',{intent,order:latest,positionCloseComplete:!remaining},position.symbol);if(remaining)await this.tp.ensure(remaining,true);}catch(error){const remaining=this.state.positions.get(position.id);if(remaining)await this.tp.ensure(remaining,true).catch(()=>{});this.events.publish('MANUAL_PROTECTION_COORDINATION_FAILED',{intentId:id,clientOrderId:client,reason:error instanceof Error?error.message:String(error),retryOrderForbidden:true},position.symbol);}
      const latest=this.state.manualOrders.get(stored.id)??stored;this.journal?.save({intent,order:latest});return{intent,order:latest,replayed:false};
    }catch(error){const message=error instanceof Error?error.message:String(error);if(protectionCleared){this.tp.resume(position.id);await this.reconcile().catch(()=>{});const remaining=this.state.positions.get(position.id);if(remaining)await this.tp.ensure(remaining,true).catch(()=>{});}let latest=[...this.state.manualOrders.values()].find(row=>row.intentId===id);
      if(latest&&!submissionAttempted){latest={...latest,status:'REJECTED',updatedAt:Date.now()};this.state.manualOrders.set(latest.id,latest);}
      intent=ManualIntentSchema.parse({...intent,status:submissionAttempted&&latest&&activeOrderStatus(latest.status)?'UNKNOWN':'REJECTED',reason:message,updatedAt:Date.now()});
      this.state.manualIntents.set(id,intent);if(latest)this.journal?.save({intent,order:latest});this.events.publish('MANUAL_ACTION_FAILED',{intent,reason:message},position.symbol);throw new Error(message);}
  }
  private complete(intent:ManualIntent,order:TakeProfitOrder){const done=ManualIntentSchema.parse({...intent,status:'COMPLETED',exchangeOrderId:order.exchangeOrderId,updatedAt:Date.now()});this.state.manualIntents.set(done.id,done);this.events.publish('MANUAL_ACTION_COMPLETED',{intent:done,order},done.symbol);return{intent:done,order,replayed:false};}
  private async submitOrder(position:Position,intent:ManualIntent,request:Parameters<AccountExecutor['submit']>[0]){this.state.positions.set(position.id,{...position,managementStatus:'HUMAN_MANAGED',humanManagedAt:Date.now()});this.events.publish('CLIENT_ORDER_ID_GENERATED',{intentId:intent.id,clientOrderId:request.clientOrderId,action:intent.action},position.symbol);const order=await this.executor.submit(request);this.events.publish('MANUAL_ORDER_SUBMITTED',{intentId:intent.id,order},position.symbol);return order;}
  private async replaceTakeProfit(position:Position,intent:ManualIntent,quantity:number,price:number){this.tp.suspend(position.id);try{for(const current of [...this.state.tpOrders.values()].filter(x=>x.positionId===position.id&&x.status==='WORKING')){const canceled=await this.tp.cancel(current);this.state.tpOrders.set(current.id,canceled);if(!['CANCELED','EXPIRED','REJECTED'].includes(canceled.status))throw new Error('TP_EXIT_COORDINATION_PENDING: reconcile TP terminal result before another order');}const order:TakeProfitOrder={id:`tp_manual_${intent.id}`,clientOrderId:binanceClientOrderIdFactory.create('TP',intent.id),exchangeOrderId:null,positionId:position.id,symbol:position.symbol,side:position.side==='LONG'?'SELL':'BUY',quantity,price,status:'WORKING',createdAt:Date.now(),updatedAt:Date.now()};const placed=await this.tp.place(order);this.state.tpOrders.set(placed.id,placed);this.state.positions.set(position.id,{...position,managementStatus:'HUMAN_MANAGED',humanManagedAt:Date.now(),tpStatus:'PROTECTED',tpOrderId:placed.id,tpLastVerifiedAt:Date.now(),tpCoverageSource:'SYSTEM_CREATED'});return placed;}finally{this.tp.resume(position.id);}}
  private async clearProtectionForExit(position:Position){this.tp.suspend(position.id);try{for(const current of [...this.state.tpOrders.values()].filter(x=>x.positionId===position.id&&x.status==='WORKING')){const canceled=await this.tp.cancel(current);this.state.tpOrders.set(current.id,canceled);if(!['CANCELED','EXPIRED','REJECTED'].includes(canceled.status))throw new Error('TP_EXIT_COORDINATION_PENDING: reconcile TP terminal result before another order');}this.state.positions.set(position.id,{...position,tpStatus:'MISSING',tpOrderId:null,tpLastVerifiedAt:Date.now(),tpCoverageSource:'NONE'});}catch(error){this.tp.resume(position.id);throw error;}}
  async cancelLimits(symbol:string){const adapter=this.exchange as ExchangeTradeAdapter&{cancelSymbolOrders?:(symbol:string,conditional:boolean)=>Promise<any>};this.events.publish('MANUAL_CANCEL_LIMITS_REQUESTED',{symbol,actor:'HUMAN'},symbol);const result=adapter.cancelSymbolOrders?await adapter.cancelSymbolOrders(symbol,false):{canceled:0,scope:'SYMBOL_ORDINARY_LIMIT'};await this.reconcile();return result;}
  async cancelConditionals(symbol:string){const adapter=this.exchange as ExchangeTradeAdapter&{cancelSymbolOrders?:(symbol:string,conditional:boolean)=>Promise<unknown>};this.events.publish('MANUAL_CANCEL_CONDITIONALS_REQUESTED',{symbol,actor:'HUMAN'},symbol);const result=adapter.cancelSymbolOrders?await adapter.cancelSymbolOrders(symbol,true):{canceled:0,scope:'SYMBOL_CONDITIONAL'};await this.reconcile();return result;}
}

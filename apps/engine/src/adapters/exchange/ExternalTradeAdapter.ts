import {createHistoryReadBudget, readHistoryWindows} from './historyWindow.js';
import { createHmac } from 'node:crypto';
import type { EntryOrder, ManualOrder, Position, TakeProfitOrder } from '@zdj/contracts';
import type { ExchangeTradeAdapter, TradeAuditSnapshot, ExchangeTradeFill, ExchangeIncomeFact, ExchangeOrderFact } from '../../types.js';
import { BinanceTransport } from '../binance/BinanceTransport.js';
import { BinanceUserDataStream } from '../binance/BinanceUserDataStream.js';
import { binanceClientOrderIdFactory } from '../../services/binanceClientOrderIdFactory.js';
import { positionLeverageFact } from '../../services/positionRiskFacts.js';
type Credentials={apiKey:string;apiSecret:string}|null;
/** An exchange field that is absent, empty or non-numeric stays null; a reported zero stays zero. */
const numberOrNull=(value:unknown)=>Number.isFinite(Number(value))&&value!=null&&String(value)!==''?Number(value):null;

export class ExternalTradeAdapter implements ExchangeTradeAdapter {
  private userStream:BinanceUserDataStream|null=null;private positionMode:{hedge:boolean;checkedAt:number}|null=null;private openTimeCache=new Map<string,{openedAt:number;source:Position['entryTimeSource'];checkedAt:number}>();private leverageCache=new Map<string,number>();private leverageFlights=new Map<string,Promise<number>>();private serverTime:{offset:number;fetchedAt:number}|null=null;private exactOrderCache=new Map<string,{expiresAt:number;row:any}>();private exactOrderFlights=new Map<string,Promise<any>>();private writeStats={testnetWrites:0,productionWrites:0,blockedProductionWriteAttempts:0,lastWriteAt:null as number|null,lastWritePath:null as string|null};
  constructor(private transport:BinanceTransport,private credentials:Credentials,private recvWindowMs=5000){}
  hasCredentials(){return Boolean(this.credentials);}
  setCredentials(credentials:Credentials){this.stopUserData();this.credentials=credentials;this.enrichmentGeneration++;this.enrichmentFlight=null;this.enrichment={income:null,incomeAsOf:null,prices:new Map(),pricesAsOf:null,lastAttempt:0,lastError:null};this.positionMode=null;this.openTimeCache.clear();this.leverageCache.clear();this.leverageFlights.clear();this.exactOrderCache.clear();this.exactOrderFlights.clear();this.serverTime=null;}
  private creds(){if(!this.credentials)throw new Error('TRADING_BLOCKED: credentials unavailable from SecretStore');if(this.transport.environment()!=='TESTNET'){this.writeStats.blockedProductionWriteAttempts++;throw new Error('TESTNET_ONLY_WRITE_LOCK: production private writes disabled');}return this.credentials;}
  private serverTimeFlight:Promise<void>|null=null;
  private async refreshServerTime(){if(this.serverTime&&Date.now()-this.serverTime.fetchedAt<=30_000)return;if(!this.serverTimeFlight)this.serverTimeFlight=this.transport.json<{serverTime:number}>('/fapi/v1/time').then(server=>{if(!Number.isFinite(server.serverTime))throw new Error('BINANCE_CLOCK_INVALID');this.serverTime={offset:server.serverTime-Date.now(),fetchedAt:Date.now()};}).finally(()=>{this.serverTimeFlight=null;});await this.serverTimeFlight;}
  private async signed<T>(method:string,path:string,params:Record<string,string|number|boolean>={},purpose?:string,source?:string){const write=method!=='GET';if(write){try{this.transport.assertTestnetExchangeWrite();this.writeStats.testnetWrites++;this.writeStats.lastWriteAt=Date.now();this.writeStats.lastWritePath=path;}catch(error){this.writeStats.blockedProductionWriteAttempts++;throw error;}}const c=this.creds();await this.refreshServerTime();const timestamp=Date.now()+(this.serverTime?.offset??0),q=new URLSearchParams();for(const[k,v]of Object.entries({...params,recvWindow:Math.min(60_000,Math.max(this.recvWindowMs,60_000)),timestamp}))q.set(k,String(v));const payload=q.toString();q.set('signature',createHmac('sha256',c.apiSecret).update(payload).digest('hex'));return this.transport.json<T>(`${path}?${q}`,{method,purpose,source,headers:{'X-MBX-APIKEY':c.apiKey}});}
  /** Shared rolling allowance for exhaustive history reads; exhaustion is fail-closed, never partial. */
  private readonly historyReadCap=24;
  private readonly historyBudget=createHistoryReadBudget({capacity:45,intervalMs:60_000});
  historyBudgetMetrics(){return{used:this.historyBudget.used(),capacity:this.historyBudget.capacity(),rejected:this.historyBudget.rejected(),perReadCap:this.historyReadCap};}
  private exactOrderKey(params:Record<string,string|number|boolean>){return `${String(params.symbol??'')}|${String(params.origClientOrderId??'')}|${String(params.orderId??'')}`;}
  private async exactOrderFact(params:Record<string,string|number|boolean>){const key=this.exactOrderKey(params),now=Date.now(),cached=this.exactOrderCache.get(key);if(cached&&cached.expiresAt>now)return cached.row;let flight=this.exactOrderFlights.get(key);if(!flight){flight=this.signed<any>('GET','/fapi/v1/order',params,'EXACT_ORDER_FACT').then(row=>{this.exactOrderCache.set(key,{expiresAt:Date.now()+1500,row});return row;}).finally(()=>this.exactOrderFlights.delete(key));this.exactOrderFlights.set(key,flight);}return flight;}
  invalidateOrderFact(symbol:string,exchangeOrderId?:string|null,clientOrderId?:string|null){const s=String(symbol??'');for(const key of [...this.exactOrderCache.keys()]){const [ks,kc,ko]=key.split('|');if(ks!==s)continue;if(exchangeOrderId&&ko&&ko!==String(exchangeOrderId))continue;if(clientOrderId&&kc&&kc!==String(clientOrderId))continue;this.exactOrderCache.delete(key);} }
  writeBoundaryMetrics(){return{environment:this.transport.environment(),executionMode:this.transport.executionMode(),lockedToTestnet:true,...this.writeStats};}
  /** Layer A of the egress fail-closed chain: the same truth the write boundary enforces, read before any AI, reservation, leverage or submit attempt. */
  entryAdmissionBlockReason(){return this.transport.entryBlockReason();}
  async fetchRealizedPnlSince(startTime:number,endTime=Date.now()){const rows=await this.signed<any[]>('GET','/fapi/v1/income',{incomeType:'REALIZED_PNL',startTime,endTime,limit:1000});return rows.reduce((sum,row)=>sum+Number(row.income??0),0);}
  private async hedgeMode(){if(this.positionMode&&Date.now()-this.positionMode.checkedAt<60_000)return this.positionMode.hedge;const value=await this.signed<{dualSidePosition:boolean}>('GET','/fapi/v1/positionSide/dual');this.positionMode={hedge:Boolean(value.dualSidePosition),checkedAt:Date.now()};return this.positionMode.hedge;}
  /**
   * C3: the capability matrix a coordinated exit must trust is read from the exchange, never
   * declared by the caller. cancelReplaceAtomic stays false because this adapter has no
   * cancel-replace endpoint: a replace is cancel-then-place and must be treated as a gap.
   */
  async exitCoordinationCapabilities(){const hedge=await this.hedgeMode();return{
    oneWayReduceOnly:!hedge,hedgePositionSide:hedge,cancelReplaceAtomic:false,partialFillExpected:true,
    supportsTimeInForce:['GTC','GTX'],positionMode:hedge?'HEDGE' as const:'ONE_WAY' as const,
  };}
  /**
   * C3: prove a reduce cannot become an increase from live exchange positions only. A missing or
   * smaller live position is a refusal, so a caller cannot size an exit from its own bookkeeping.
   */
  async proveReduction(input:{symbol:string;positionSide:'LONG'|'SHORT';quantity:number}){
    const symbol=String(input.symbol??'').trim().toUpperCase(),side=input.positionSide,quantity=Number(input.quantity);
    if(!symbol||!['LONG','SHORT'].includes(side)||!Number.isFinite(quantity)||quantity<=0)throw new Error('REDUCTION_PROOF_INPUT_INVALID');
    const hedge=await this.hedgeMode(),rows=await this.signed<any[]>('GET','/fapi/v2/positionRisk',{symbol});
    const live=rows.filter(row=>String(row.symbol??'').toUpperCase()===symbol&&Number(row.positionAmt)!==0);
    if(hedge){
      const match=live.find(row=>String(row.positionSide??'').toUpperCase()===side);
      const available=Number(match?.positionAmt??0);
      if(!match||!Number.isFinite(available)||available<=0)throw new Error(`REDUCTION_PROOF_NO_LIVE_POSITION:${symbol}:${side}`);
      if(quantity>available+1e-12)throw new Error(`REDUCTION_PROOF_EXCEEDS_LIVE_POSITION:${symbol}:${side}:${quantity}>${available}`);
      return{kind:'HEDGE_POSITION_SIDE' as const,checkedAt:Date.now(),positionSide:side,liveQuantity:available};
    }
    const net=live.reduce((sum,row)=>sum+Number(row.positionAmt??0),0);
    const derived=net>0?'LONG':net<0?'SHORT':null;
    if(derived!==side)throw new Error(`REDUCTION_PROOF_NO_LIVE_POSITION:${symbol}:ONE_WAY_NET:${derived??'FLAT'}`);
    const available=Math.abs(net);
    if(quantity>available+1e-12)throw new Error(`REDUCTION_PROOF_EXCEEDS_LIVE_POSITION:${symbol}:${side}:${quantity}>${available}`);
    return{kind:'ONE_WAY_REDUCE_ONLY' as const,checkedAt:Date.now(),positionSide:side,liveQuantity:available};
  }
  /**
   * C3: tri-state exact read. ABSENT is only ever returned for the exchange's own "no such order"
   * codes; every other failure throws, so a caller can never mistake an unreachable query for an
   * order that does not exist.
   */
  async findExitByClientOrderId(input:{symbol:string;clientOrderId:string}){
    const clientOrderId=String(input.clientOrderId??'').trim();
    if(!clientOrderId)throw new Error('EXIT_QUERY_IDENTITY_MISSING');
    try{
      const row=await this.exactOrderFact({symbol:String(input.symbol).toUpperCase(),origClientOrderId:clientOrderId});
      return{state:'FOUND' as const,order:{symbol:String(row.symbol??input.symbol).toUpperCase(),clientOrderId:String(row.clientOrderId??clientOrderId),exchangeOrderId:String(row.orderId??''),status:String(row.status??''),type:String(row.type??''),originalQuantity:Number(row.origQty??0),executedQuantity:Number(row.executedQty??0),price:Number(row.price??0),positionSide:['LONG','SHORT'].includes(String(row.positionSide??'').toUpperCase())?String(row.positionSide).toUpperCase() as 'LONG'|'SHORT':'BOTH',reduceOnly:row.reduceOnly===true||String(row.reduceOnly)==='true',updateTime:Number(row.updateTime??Date.now()),createTime:Number(row.time??Date.now())}};
    }catch(error){
      const message=String(error);
      if(message.includes('-2013')||message.includes('-2011'))return{state:'ABSENT' as const,reason:message};
      throw error;
    }
  }
  async placeEntry(order:EntryOrder){const hedge=await this.hedgeMode(),clientOrderId=binanceClientOrderIdFactory.assert(order.clientOrderId??binanceClientOrderIdFactory.create('ML',order.id)),params:Record<string,string|number|boolean>={symbol:order.symbol,side:order.side==='LONG'?'BUY':'SELL',type:'LIMIT',timeInForce:'GTX',quantity:order.quantity,price:order.price,newClientOrderId:clientOrderId};if(hedge)params.positionSide=order.side;const result=await this.signed<any>('POST','/fapi/v1/order',params,'NEW_ENTRY');return{...order,clientOrderId,exchangeOrderId:String(result.orderId),status:'WORKING' as const,updatedAt:Date.now()};}
  async findEntryByClientOrderId(order:EntryOrder){try{const clientOrderId=String(order.clientOrderId??'').trim(),exchangeOrderId=String(order.exchangeOrderId??'').trim();if(!clientOrderId&&!exchangeOrderId)return null;const query=clientOrderId?{symbol:order.symbol,origClientOrderId:binanceClientOrderIdFactory.assert(clientOrderId)}:{symbol:order.symbol,orderId:exchangeOrderId};const row=await this.exactOrderFact(query);const executed=Number(row.executedQty??0),status=executed>=order.quantity-1e-10?'FILLED':executed>0&&['NEW','PARTIALLY_FILLED'].includes(String(row.status))?'PARTIALLY_FILLED':String(row.status)==='NEW'?'WORKING':String(row.status);let verifiedExchangeFills:any[]=[];if(executed>0){try{const rows=await this.signed<any[]>('GET','/fapi/v1/userTrades',{symbol:order.symbol,orderId:String(row.orderId),limit:1000});verifiedExchangeFills=rows.filter(fill=>String(fill.orderId)===String(row.orderId)).map(fill=>({symbol:String(fill.symbol??order.symbol),side:String(fill.side)==='BUY'?'BUY':'SELL',positionSide:['LONG','SHORT'].includes(String(fill.positionSide))?String(fill.positionSide):'BOTH',orderId:String(fill.orderId),clientOrderId:String(fill.clientOrderId??row.clientOrderId??clientOrderId),tradeId:String(fill.id??fill.tradeId),executionTime:Number(fill.time??row.updateTime??Date.now()),qty:Number(fill.qty??0),price:Number(fill.price??0),realizedPnl:Number(fill.realizedPnl??0),commission:Number(fill.commission??0),commissionAsset:String(fill.commissionAsset??''),maker:Boolean(fill.maker)})).filter(fill=>fill.qty>0&&fill.price>0);}catch{/* Exact order truth remains authoritative; fill detail is retried by the audit/sync path. */}}return{...order,clientOrderId:String(row.clientOrderId??order.clientOrderId??''),exchangeOrderId:String(row.orderId),quantity:Number(row.origQty??order.quantity),price:Number(row.price??order.price),filledQuantity:executed,status,statusSource:'BINANCE_EXACT_ORDER',updatedAt:Number(row.updateTime??Date.now()),orderType:String(row.type??'LIMIT'),timeInForce:String(row.timeInForce??'UNKNOWN'),maker:String(row.timeInForce??'')==='GTX',factSource:'BINANCE_EXACT_ORDER',verifiedAt:Date.now(),verifiedExchangeFills} as EntryOrder;}catch(error){if(String(error).includes('-2013')||String(error).includes('-2011'))return null;throw error;}}
  async cancelEntry(order:EntryOrder){
    try{await this.signed('DELETE','/fapi/v1/order',{symbol:order.symbol,origClientOrderId:order.clientOrderId??order.id});this.invalidateOrderFact(order.symbol,order.exchangeOrderId,order.clientOrderId);}
    catch(error){if(!String(error).includes('-2011'))throw error;}
    const verified=await this.findEntryByClientOrderId(order);
    return verified??{...order,status:'UNKNOWN' as const,updatedAt:Date.now()};
  }
  async replaceEntry(order:EntryOrder,price:number){
    // Native amend preserves exchange identity and cumulative fills; cancel/recreate could duplicate filled quantity.
    await this.signed('PUT','/fapi/v1/order',{symbol:order.symbol,origClientOrderId:order.clientOrderId??order.id,side:order.side==='LONG'?'BUY':'SELL',quantity:order.quantity,price},'NEW_ENTRY');this.invalidateOrderFact(order.symbol,order.exchangeOrderId,order.clientOrderId);
    const verified=await this.findEntryByClientOrderId(order);
    if(!verified)return{...order,status:'UNKNOWN' as const,updatedAt:Date.now()};
    return{...verified,repriceCount:order.repriceCount+1,absoluteExpiresAt:order.absoluteExpiresAt,createdAt:order.createdAt};
  }
  async placeTakeProfit(order:TakeProfitOrder){const hedge=await this.hedgeMode(),clientOrderId=binanceClientOrderIdFactory.assert(order.clientOrderId??binanceClientOrderIdFactory.create('TP',order.id)),params:Record<string,string|number|boolean>={symbol:order.symbol,side:order.side,type:'LIMIT',timeInForce:'GTC',quantity:order.quantity,price:order.price,newClientOrderId:clientOrderId};if(hedge)params.positionSide=order.side==='SELL'?'LONG':'SHORT';else params.reduceOnly=true;const result=await this.signed<any>('POST','/fapi/v1/order',params);return{...order,clientOrderId,exchangeOrderId:String(result.orderId),status:'WORKING' as const,updatedAt:Date.now()};}
  async placeManualOrder(request:{clientOrderId:string;internalOrderId?:string;symbol:string;side:'BUY'|'SELL';positionSide?:'LONG'|'SHORT';type:'LIMIT'|'MARKET';quantity:number;price?:number;reduceOnly:boolean;postOnly:boolean;positionId?:string}){const hedge=await this.hedgeMode(),clientOrderId=binanceClientOrderIdFactory.assert(request.clientOrderId),params:Record<string,string|number|boolean>={symbol:request.symbol,side:request.side,type:request.type,quantity:request.quantity,newClientOrderId:clientOrderId};if(request.type==='LIMIT'){params.price=request.price!;params.timeInForce=request.postOnly?'GTX':'GTC';}if(request.reduceOnly&&!hedge)params.reduceOnly=true;if(hedge&&request.positionSide)params.positionSide=request.positionSide;const result=await this.signed<any>('POST','/fapi/v1/order',params);const now=Date.now(),id=request.internalOrderId??`manual_order_${now}`;return{id,intentId:request.internalOrderId??id,clientOrderId,exchangeOrderId:String(result.orderId),positionId:String(request.positionId??id),symbol:request.symbol,side:request.side,positionSide:hedge?(request.positionSide??null):'BOTH',type:request.type,quantity:request.quantity,price:request.price??null,reduceOnly:request.reduceOnly,postOnly:request.postOnly,status:(result.status==='FILLED'?'FILLED':'WORKING') as 'FILLED'|'WORKING',filledQuantity:Number(result.executedQty??0),createdAt:now,updatedAt:now} as ManualOrder;}
  async findManualByClientOrderId(request:{symbol:string;clientOrderId:string;internalOrderId:string;positionId:string;side:'BUY'|'SELL';positionSide:'LONG'|'SHORT';quantity:number;price:number;reduceOnly:boolean;postOnly:boolean}){try{const row=await this.exactOrderFact({symbol:request.symbol,origClientOrderId:binanceClientOrderIdFactory.assert(request.clientOrderId)}),executed=Number(row.executedQty??0),raw=String(row.status),status=executed>=request.quantity-1e-10?'FILLED':executed>0&&['NEW','PARTIALLY_FILLED'].includes(raw)?'PARTIALLY_FILLED':['NEW','PARTIALLY_FILLED'].includes(raw)?'WORKING':raw==='CANCELED'?'CANCELED':raw==='EXPIRED'?'EXPIRED':raw==='REJECTED'?'REJECTED':'UNKNOWN',now=Date.now();return{id:request.internalOrderId,intentId:request.internalOrderId,clientOrderId:String(row.clientOrderId??request.clientOrderId),exchangeOrderId:String(row.orderId),positionId:request.positionId,symbol:request.symbol,side:request.side,positionSide:(String(row.positionSide??request.positionSide) as any),type:'LIMIT' as const,quantity:Number(row.origQty??request.quantity),price:Number(row.price??request.price),reduceOnly:request.reduceOnly,postOnly:request.postOnly,status,filledQuantity:executed,createdAt:Number(row.time??now),updatedAt:Number(row.updateTime??now)} as ManualOrder;}catch(error){if(String(error).includes('-2013')||String(error).includes('-2011'))return null;throw error;}}
  async cancelManualOrder(order:ManualOrder){
    try{await this.signed('DELETE','/fapi/v1/order',{symbol:order.symbol,orderId:order.exchangeOrderId?Number(order.exchangeOrderId):undefined,origClientOrderId:order.clientOrderId});this.invalidateOrderFact(order.symbol,order.exchangeOrderId,order.clientOrderId);}
    catch(error){if(!String(error).includes('-2011'))throw error;}
    const verified=await this.findManualByClientOrderId({symbol:order.symbol,clientOrderId:order.clientOrderId!,internalOrderId:order.id,positionId:order.positionId,side:order.side,positionSide:order.positionSide==='LONG'||order.positionSide==='SHORT'?order.positionSide:order.side==='SELL'?'LONG':'SHORT',quantity:order.quantity,price:order.price??0,reduceOnly:order.reduceOnly,postOnly:order.postOnly});
    return verified?{...verified,intentId:order.intentId,createdAt:order.createdAt}:{...order,status:'UNKNOWN' as const,updatedAt:Date.now()};
  }
  async findTakeProfitByClientOrderId(order:TakeProfitOrder){
    try{const row=await this.exactOrderFact({symbol:order.symbol,origClientOrderId:order.clientOrderId??order.id});const raw=String(row.status),executed=Number(row.executedQty??0),quantity=Number(row.origQty??order.quantity);
      const status:TakeProfitOrder['status']=executed>=quantity-1e-10?'FILLED':['NEW','PARTIALLY_FILLED'].includes(raw)?'WORKING':['FILLED','CANCELED','EXPIRED','REJECTED'].includes(raw)?raw as TakeProfitOrder['status']:'UNKNOWN';
      return{...order,exchangeOrderId:String(row.orderId),quantity:Math.max(0,quantity-executed),filledQuantity:executed,price:Number(row.price??order.price),status,updatedAt:Number(row.updateTime??Date.now())};
    }catch(error){if(String(error).includes('-2013')||String(error).includes('-2011'))return null;throw error;}
  }
  async cancelTakeProfit(order:TakeProfitOrder){
    try{await this.signed('DELETE','/fapi/v1/order',{symbol:order.symbol,origClientOrderId:order.clientOrderId??order.id});this.invalidateOrderFact(order.symbol,order.exchangeOrderId,order.clientOrderId);}catch(error){if(!String(error).includes('-2011'))throw error;}
    const verified=await this.findTakeProfitByClientOrderId(order);if(!verified||verified.status==='UNKNOWN'||verified.status==='WORKING')throw new Error('TP_CANCEL_RESULT_UNVERIFIED');return verified;
  }
  async cancelSymbolOrders(symbol:string,conditional:boolean){const rows=await this.signed<any[]>('GET','/fapi/v1/openOrders',{symbol}),conditionalTypes=new Set(['STOP','STOP_MARKET','TAKE_PROFIT','TAKE_PROFIT_MARKET','TRAILING_STOP_MARKET']);let canceled=0,skipped=0;for(const row of rows){const type=String(row.type),isConditional=conditionalTypes.has(type)||String(row.clientOrderId??'').startsWith('tp_');if(isConditional!==conditional){skipped++;continue;}try{await this.signed('DELETE','/fapi/v1/order',{symbol,orderId:Number(row.orderId)});canceled++;}catch(error){if(String(error).includes('-2011')){canceled++;continue;}throw error;}}return{symbol,conditional,canceled,skipped,scope:conditional?'SYMBOL_CONDITIONAL':'SYMBOL_ORDINARY_LIMIT'};}
  async fetchOpenOrders(symbol?:string){const verifiedAt=Date.now(),rows=await this.signed<any[]>('GET','/fapi/v1/openOrders',symbol?{symbol}:undefined);return rows.map(row=>String(row.clientOrderId).startsWith('tp_')?({id:String(row.clientOrderId),clientOrderId:String(row.clientOrderId??''),exchangeOrderId:String(row.orderId),positionId:'exchange-unknown',positionSide:String(row.positionSide??'BOTH'),symbol:String(row.symbol),side:row.side,quantity:Math.max(0,Number(row.origQty)-Number(row.executedQty??0)),price:Number(row.price),status:'WORKING',createdAt:Number(row.time??Date.now()),updatedAt:Number(row.updateTime??Date.now()),factSource:'BINANCE_OPEN_ORDERS',verifiedAt} as TakeProfitOrder):({id:String(row.clientOrderId||`${row.symbol}:${row.orderId}`),clientOrderId:String(row.clientOrderId??''),exchangeOrderId:String(row.orderId),symbol:String(row.symbol),side:row.side==='BUY'?'LONG':'SHORT',quantity:Number(row.origQty),price:Number(row.price),filledQuantity:Number(row.executedQty),leverage:1,status:row.status==='NEW'?'WORKING':row.status,createdAt:Number(row.time??Date.now()),updatedAt:Number(row.updateTime??Date.now()),absoluteExpiresAt:Number.MAX_SAFE_INTEGER,repriceCount:0,intentId:'exchange-recovered',reachability:0,orderType:String(row.type??'LIMIT'),timeInForce:String(row.timeInForce??'UNKNOWN'),maker:String(row.timeInForce??'')==='GTX',factSource:'BINANCE_OPEN_ORDERS',verifiedAt} as EntryOrder));}
  private async pagedIncome(startTime:number,endTime:number,symbol?:string,source='BACKGROUND_AUDIT'){const out:any[]=[];for(let page=1;page<=50;page++){const rows=await this.signed<any[]>('GET','/fapi/v1/income',{...(symbol?{symbol}:{}),startTime,endTime,page,limit:1000},'TRADE_AUDIT_INCOME',source);out.push(...rows);if(rows.length<1000)break;if(page===50)throw new Error('INCOME_HISTORY_PAGE_LIMIT');}return out.filter(row=>Number(row.time??0)>=startTime&&Number(row.time??0)<=endTime);}
  /**
   * Account-level external cash flow for the portfolio risk snapshot. `complete` is only true when
   * every page came back inside the window, so a truncated read is reported as an unknown coverage
   * rather than as "no deposits happened".
   */
  async fetchCashFlowFacts(startTime:number,endTime=Date.now()):Promise<{facts:Array<{id:string;amountUsd:number;asset:string;time:number}>;complete:boolean;windowStart:number;windowEnd:number}>
  {
    const kinds=new Set(['TRANSFER','WITHDRAW','DEPOSIT']);
    const facts:Array<{id:string;amountUsd:number;asset:string;time:number}>=[];let complete=true;
    for(let page=1;page<=10;page++){
      const rows=await this.signed<any[]>('GET','/fapi/v1/income',{incomeType:'TRANSFER',startTime,endTime,page,limit:1000},'TRADE_AUDIT_INCOME','PORTFOLIO_RISK_CASH_FLOW');
      for(const row of rows){
        const time=Number(row.time??0),income=Number(row.income??0),asset=String(row.asset??'').trim().toUpperCase();
        if(!Number.isFinite(time)||!Number.isFinite(income)||!asset)continue;
        if(!kinds.has(String(row.incomeType??'').toUpperCase()))continue;
        facts.push({id:`income:${asset}:${time}:${income}:${page}`,amountUsd:income,asset,time});
      }
      if(rows.length>=1000&&page===10){complete=false;break;}
      if(rows.length<1000)break;
    }
    return{facts:facts.sort((a,b)=>a.time-b.time),complete,windowStart:startTime,windowEnd:endTime};
  }
  /**
   * The shared budget binds the per-Entry risk proof, which repeats every minute while any
   * UNKNOWN exists and fans out one request per sub-window over an old order's life. The
   * account trade audit runs once per sweep over a narrow window and is bounded by its own
   * linearity test, so it is deliberately not throttled by this budget.
   */
  private historyWindowBudget(source:string){return source==='ORDER_VERIFICATION'?{cap:this.historyReadCap,budget:this.historyBudget}:{cap:200,budget:undefined};}
  private async pagedUserTrades(symbol:string,startTime:number,endTime:number,source='BACKGROUND_AUDIT'){const allowance=this.historyWindowBudget(source);return readHistoryWindows<any>(startTime,endTime,(start,end)=>this.signed<any[]>('GET','/fapi/v1/userTrades',{symbol,startTime:start,endTime:end,limit:1000},'TRADE_AUDIT_USER_TRADES',source),row=>String(row.id??''),allowance.cap,allowance.budget);}
  private async pagedAllOrders(symbol:string,startTime:number,endTime:number,source='BACKGROUND_AUDIT'){const allowance=this.historyWindowBudget(source);return readHistoryWindows<any>(startTime,endTime,(start,end)=>this.signed<any[]>('GET','/fapi/v1/allOrders',{symbol,startTime:start,endTime:end,limit:1000},'TRADE_AUDIT_ALL_ORDERS',source),row=>String(row.orderId??''),allowance.cap,allowance.budget);}
  async fetchRecentTradeAudit(startTime:number,endTime:number,maxFills=500,additionalSymbols:string[]=[]):Promise<TradeAuditSnapshot>{
    const [incomeRows,positions,openOrders]=await Promise.all([
      this.pagedIncome(startTime,endTime),
      this.fetchPositions(),this.fetchOpenOrders(),
    ]);
    const income=incomeRows.map(row=>({symbol:String(row.symbol??''),incomeType:String(row.incomeType??'UNKNOWN'),income:Number(row.income??0),asset:String(row.asset??''),time:Number(row.time??0),info:row.info==null?null:String(row.info),tradeId:row.tradeId==null?null:String(row.tradeId),transactionId:row.tranId==null?null:String(row.tranId)})).filter(row=>row.time>=startTime&&row.time<=endTime);
    const symbols=[...new Set([...income.map(row=>row.symbol),...positions.map(row=>row.symbol),...openOrders.map(row=>row.symbol),...additionalSymbols.map(symbol=>String(symbol).toUpperCase())].filter(symbol=>/^[A-Z0-9]{3,20}(USDT|USDC|BUSD)$/.test(String(symbol))))];
    const fills:TradeAuditSnapshot['fills']=[],orders:TradeAuditSnapshot['orders']=[];
    for(const symbol of symbols){
      const [trades,allOrders]=await Promise.all([
        this.pagedUserTrades(symbol,startTime,endTime),
        this.pagedAllOrders(symbol,startTime,endTime),
      ]);
      for(const row of trades)fills.push({symbol:String(row.symbol),side:String(row.side)==='BUY'?'BUY':'SELL',positionSide:['LONG','SHORT'].includes(String(row.positionSide))?String(row.positionSide) as 'LONG'|'SHORT':'BOTH',orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),tradeId:String(row.id??row.tradeId??''),executionTime:Number(row.time??0),qty:Number(row.qty??0),price:Number(row.price??0),realizedPnl:Number(row.realizedPnl??0),commission:Number(row.commission??0),commissionAsset:String(row.commissionAsset??''),maker:Boolean(row.maker)});
      for(const row of allOrders)orders.push({symbol:String(row.symbol),orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),side:String(row.side),positionSide:String(row.positionSide??'BOTH'),status:String(row.status),type:String(row.type),origQty:Number(row.origQty??0),executedQty:Number(row.executedQty??0),avgPrice:Number(row.avgPrice??row.price??0),updateTime:Number(row.updateTime??row.time??0)});
    }
    const orderById=new Map(orders.map(row=>[row.orderId,row]));for(const fill of fills){const order=orderById.get(fill.orderId);if(order)fill.clientOrderId=order.clientOrderId;}
    fills.sort((a,b)=>a.executionTime-b.executionTime);const selected=fills.slice(Math.max(0,fills.length-Math.max(1,Math.min(1000,maxFills))));
    const selectedOrders=new Set(selected.map(fill=>fill.orderId));return{window:{startTime,endTime},source:'BINANCE_DEMO_PRIVATE',fetchedAt:Date.now(),fills:selected,income,orders:orders.filter(order=>selectedOrders.has(order.orderId)||order.updateTime>=startTime),positions,openOrders};
  }
  async fetchSymbolTradeFacts(symbol:string,startTime:number,endTime:number):Promise<{fills:ExchangeTradeFill[];income:ExchangeIncomeFact[];orders:ExchangeOrderFact[];coverageComplete:boolean;coverageStart:number;coverageEnd:number}>{const [incomeRows,trades,allOrders]=await Promise.all([this.pagedIncome(startTime,endTime,symbol),this.pagedUserTrades(symbol,startTime,endTime),this.pagedAllOrders(symbol,startTime,endTime)]);return{fills:trades.map(row=>({symbol:String(row.symbol),side:(String(row.side)==='BUY'?'BUY':'SELL') as 'BUY'|'SELL',positionSide:(['LONG','SHORT'].includes(String(row.positionSide))?String(row.positionSide):'BOTH') as 'LONG'|'SHORT'|'BOTH',orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),tradeId:String(row.id??row.tradeId??''),executionTime:Number(row.time??0),qty:Number(row.qty??0),price:Number(row.price??0),realizedPnl:Number(row.realizedPnl??0),commission:Number(row.commission??0),commissionAsset:String(row.commissionAsset??''),maker:Boolean(row.maker)})),income:incomeRows.map(row=>({symbol:String(row.symbol??symbol),incomeType:String(row.incomeType??'UNKNOWN'),income:Number(row.income??0),asset:String(row.asset??''),time:Number(row.time??0),info:row.info==null?null:String(row.info),tradeId:row.tradeId==null?null:String(row.tradeId),transactionId:row.tranId==null?null:String(row.tranId)})),orders:allOrders.map(row=>({symbol:String(row.symbol),orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),side:String(row.side),positionSide:String(row.positionSide??'BOTH'),status:String(row.status),type:String(row.type),origQty:Number(row.origQty??0),executedQty:Number(row.executedQty??0),avgPrice:Number(row.avgPrice??row.price??0),updateTime:Number(row.updateTime??row.time??0)})),coverageComplete:startTime>=Date.now()-80*86_400_000,coverageStart:startTime,coverageEnd:endTime};}
  async fetchSymbolRiskFacts(symbol:string,startTime:number,endTime:number):Promise<{fills:ExchangeTradeFill[];orders:ExchangeOrderFact[];coverageComplete:boolean;coverageStart:number;coverageEnd:number}>{const [trades,allOrders]=await Promise.all([this.pagedUserTrades(symbol,startTime,endTime,'ORDER_VERIFICATION'),this.pagedAllOrders(symbol,startTime,endTime,'ORDER_VERIFICATION')]);return{fills:trades.map(row=>({symbol:String(row.symbol),side:(String(row.side)==='BUY'?'BUY':'SELL') as 'BUY'|'SELL',positionSide:(['LONG','SHORT'].includes(String(row.positionSide))?String(row.positionSide):'BOTH') as 'LONG'|'SHORT'|'BOTH',orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),tradeId:String(row.id??row.tradeId??''),executionTime:Number(row.time??0),qty:Number(row.qty??0),price:Number(row.price??0),realizedPnl:Number(row.realizedPnl??0),commission:Number(row.commission??0),commissionAsset:String(row.commissionAsset??''),maker:Boolean(row.maker)})),orders:allOrders.map(row=>({symbol:String(row.symbol),orderId:String(row.orderId),clientOrderId:String(row.clientOrderId??''),side:String(row.side),positionSide:String(row.positionSide??'BOTH'),status:String(row.status),type:String(row.type),origQty:Number(row.origQty??0),executedQty:Number(row.executedQty??0),avgPrice:Number(row.avgPrice??row.price??0),updateTime:Number(row.updateTime??row.time??0)})),coverageComplete:startTime>=Date.now()-80*86_400_000,coverageStart:startTime,coverageEnd:endTime};}
  private async recoverOpenedAt(symbol:string,side:'LONG'|'SHORT',_quantity:number){const key=`${symbol}:${side}`,cached=this.openTimeCache.get(key);if(cached&&Date.now()-cached.checkedAt<6*60*60_000)return cached;const result={openedAt:0,source:'UNKNOWN' as const,checkedAt:Date.now()};this.openTimeCache.set(key,result);return result;}
  /**
   * Position risk truth: USDⓈ-M Position Information **V3**, and only V3, because V3 is the contract
   * that states a position's own `marginAsset`, `maintMargin`, `notional` and `liquidationPrice`. The
   * retired V2 read asked for `maintMarginAmt` / `maintenanceMargin`, which the endpoint does not
   * return, so every live position arrived without a maintenance margin or margin asset and PortfolioRisk
   * refused every candidate at every size — an availability gap that looked like a risk decision.
   *
   * A V2 fallback exists for one job only: keep knowing *which positions exist* if V3 is unavailable,
   * so exits and reconciliation still see the book. It never claims a risk fact: the fields stay null,
   * which the risk layer reports as unproven instead of letting anyone synthesise them.
   */
  private static readonly POSITION_RISK_ENDPOINT = '/fapi/v3/positionRisk';
  async fetchPositions(){
    const magnitudeOrNull=(value:unknown)=>{const n=numberOrNull(value);return n===null?null:Math.abs(n);};
    const mapRow=(row:any,source:'V3_VERIFIED'|'V2_EXISTENCE_ONLY')=>({
      id:`exchange_${row.symbol}_${row.positionSide}`,symbol:String(row.symbol),side:Number(row.positionAmt)>0?'LONG' as const:'SHORT' as const,
      quantity:Math.abs(Number(row.positionAmt)),entryPrice:Number(row.entryPrice),markPrice:Number(row.markPrice),
      leverage:positionLeverageFact({leverage:row.leverage,notional:row.notional??row.markValue,initialMargin:row.initialMargin}).leverage,
      unrealizedPnl:Number(row.unrealizedProfit??row.unRealizedProfit??0),unrealizedPnlPercent:0,openedAt:0,firstObservedAt:null,
      /** Margin composition is carried exactly as the exchange reported it; a missing field stays null. */
      liquidationPrice:numberOrNull(row.liquidationPrice),marginAsset:String(row.marginAsset??'').trim().toUpperCase()||null,
      notionalUsd:magnitudeOrNull(row.notional??row.markValue),
      maintenanceMarginUsd:magnitudeOrNull(row.maintMargin??row.maintMarginAmt??row.maintenanceMargin),
      positionRiskSource:source,entryTimeSource:'UNKNOWN' as const,managementStatus:'AUTO_MANAGED' as const,humanManagedAt:null,
      tpStatus:'PENDING' as const,tpOrderId:null,tpLastVerifiedAt:null,tpCoverageSource:'NONE' as const} as Position);
    let rows:any[]|null=null,source:'V3_VERIFIED'|'V2_EXISTENCE_ONLY'='V3_VERIFIED';
    try{rows=await this.signed<any[]>('GET',ExternalTradeAdapter.POSITION_RISK_ENDPOINT,{},'POSITION_RISK_V3','PRIVATE_STATE');}
    catch(error){
      // Existence only. The caller cannot tell a proven risk fact from this row, and neither can we.
      this.lastPositionRiskError=`${ExternalTradeAdapter.POSITION_RISK_ENDPOINT}:${String(error instanceof Error?error.message:error).slice(0,160)}`;
      rows=await this.signed<any[]>('GET','/fapi/v2/positionRisk',{},'POSITION_RISK_V2_EXISTENCE','PRIVATE_STATE');source='V2_EXISTENCE_ONLY';
    }
    const nonzero=(Array.isArray(rows)?rows:[]).filter(row=>Number(row.positionAmt)!==0);
    return Promise.all(nonzero.map(async row=>{
      const amount=Number(row.positionAmt),direction:'LONG'|'SHORT'=amount>0?'LONG':'SHORT';
      const time=await this.recoverOpenedAt(String(row.symbol),direction,Math.abs(amount));
      return{...mapRow(row,source),openedAt:time.openedAt,entryTimeSource:time.source};
    }));
  }
  /** The last position-risk read failure, so a V2 existence fallback is visible instead of silent. */
  lastPositionRiskError:string|null=null;
  positionRiskEndpoint(){return ExternalTradeAdapter.POSITION_RISK_ENDPOINT;}
  private enrichmentGeneration=0;
  private enrichmentFlight:Promise<void>|null=null;
  private enrichment={income:null as number|null,incomeAsOf:null as number|null,prices:new Map<string,number>(),pricesAsOf:null as number|null,lastAttempt:0,lastError:null as string|null};
  async fetchAccountSnapshot(){
    const account=await this.signed<any>('GET','/fapi/v2/account');
    const nonzero=(account.assets??[]).filter((row:any)=>Math.abs(Number(row.walletBalance??0))>0||Math.abs(Number(row.availableBalance??0))>0),prices=new Map<string,number>();
    for(const [asset,price] of (Date.now()-(this.enrichment.pricesAsOf??0)<120_000?this.enrichment.prices:new Map<string,number>()))prices.set(asset,price);
    if(!this.enrichmentFlight&&Date.now()-this.enrichment.lastAttempt>=60_000){
      this.enrichment.lastAttempt=Date.now();const generation=this.enrichmentGeneration,cache=this.enrichment;
      this.enrichmentFlight=Promise.allSettled([
        this.signed<any[]>('GET','/fapi/v1/income',{incomeType:'REALIZED_PNL',startTime:Date.now()-24*60*60_000,limit:1000}).then(rows=>{cache.income=rows.reduce((sum,row)=>sum+Number(row.income??0),0);cache.incomeAsOf=Date.now();}),
        ...nonzero.filter((row:any)=>!['USDT','USDC','BUSD'].includes(String(row.asset))).map(async(row:any)=>{const quote=await this.transport.json<any>(`/fapi/v1/premiumIndex?symbol=${row.asset}USDT`);const price=Number(quote.markPrice);if(!Number.isFinite(price)||price<=0)throw new Error('VALUATION_PRICE_INVALID');cache.prices.set(String(row.asset),price);cache.pricesAsOf=Date.now();})
      ]).then(results=>{cache.lastError=results.some(r=>r.status==='rejected')?'ENRICHMENT_PARTIAL_FAILURE':null;}).finally(()=>{if(generation===this.enrichmentGeneration)this.enrichmentFlight=null;});
    }
    const assets=nonzero.map((row:any)=>{const asset=String(row.asset),wallet=Number(row.walletBalance??0),stable=['USDT','USDC','BUSD'].includes(asset),price=stable?1:prices.get(asset);return{asset,walletBalance:wallet,availableBalance:Number(row.availableBalance??0),crossWalletBalance:row.crossWalletBalance==null?null:Number(row.crossWalletBalance),unrealizedPnl:Number(row.unrealizedProfit??0),usdValue:Number.isFinite(price)?wallet*price!:null,marginEligible:Boolean(row.marginAvailable??asset==='USDT')};});
    const usdt=assets.find(row=>row.asset==='USDT'),equity=assets.reduce((sum,row)=>sum+(row.usdValue??0),0)+Number(account.totalUnrealizedProfit??0);
    return{walletBalanceUsd:assets.reduce((sum,row)=>sum+(row.usdValue??0),0),availableUsd:Number(usdt?.availableBalance??account.availableBalance),equityUsd:assets.some(row=>row.usdValue===null)&&account.totalMarginBalance!=null&&Number.isFinite(Number(account.totalMarginBalance))?Number(account.totalMarginBalance):equity,unrealizedPnlUsd:Number(account.totalUnrealizedProfit??0),realizedPnlUsd24h:Date.now()-(this.enrichment.incomeAsOf??0)<120_000?this.enrichment.income:null,assets,enrichment:{incomeAsOf:this.enrichment.incomeAsOf,valuationAsOf:this.enrichment.pricesAsOf,error:this.enrichment.lastError,pending:Boolean(this.enrichmentFlight)},asOf:Date.now()};
  }
  async validatePrivate(){const account=await this.fetchAccountSnapshot(),orders=await this.fetchOpenOrders(),positions=await this.fetchPositions();return{status:'BINANCE DEMO PRIVATE READY',endpoint:this.transport.effectiveBaseUrl(),accountAvailable:Number.isFinite(account.walletBalanceUsd),openOrders:orders.length,positions:positions.length};}
  /**
   * Read-only field-presence probe over the *same* endpoint and mapping the runtime trades against. A
   * probe that reads a different version could certify fields the position sync never sees, which is
   * exactly how the V2 gap stayed invisible. Non-zero rows are reported verbatim so "field absent" and
   * "exchange reported 0" stay distinguishable in evidence. Nothing here is persisted and no writer is
   * reachable.
   */
  async probePositionRiskFields():Promise<{environment:string;endpoint:string;observedAt:number;rowCount:number;fieldNames:string[];rows:Record<string,unknown>[];readError:string|null}>{
    const environment=this.transport.environment();
    if(environment!=='TESTNET')throw new Error(`POSITION_PROBE_REQUIRES_TESTNET:${environment}`);
    const endpoint=ExternalTradeAdapter.POSITION_RISK_ENDPOINT;
    let rows:any[]=[],readError:string|null=null;
    try{rows=await this.signed<any[]>('GET',endpoint,{},'POSITION_FACT_PROBE','PRIVATE_STATE')??[];}
    catch(error){readError=String(error instanceof Error?error.message:error).slice(0,200);}
    const list=Array.isArray(rows)?rows:[];
    return {environment,endpoint,observedAt:Date.now(),rowCount:list.length,readError,
      fieldNames:[...new Set(list.flatMap(row=>Object.keys(row??{})))].sort(),
      rows:list.filter(row=>Math.abs(Number(row?.positionAmt??0))>0).slice(0,40).map(row=>Object.fromEntries(Object.entries(row??{})
        .filter(([key])=>/amt|amount|asset|ratio|margin|notional|leverage|liquidation|price|symbol|side/i.test(key))
        .map(([key,value])=>[key,typeof value==='string'?value:String(value).slice(0,24)])))};
  }
  /**
   * The only margin-tier read the PortfolioRisk profile is allowed to trust. Purely GET: it never
   * reuses setLeverage (which POSTs /fapi/v1/leverage), never touches a writer, and refuses to run
   * anywhere but Testnet, so a production read can never mint Testnet activation authority. One
   * request per required symbol, bounded in flight, because each /leverageBracket call weighs 30.
   */
  async fetchMaintenanceMarginBrackets(symbols:string[],options:{maxInFlight?:number;credentialRef?:string}={}){
    const environment=this.transport.environment();
    if(environment!=='TESTNET')throw new Error(`MARGIN_AUTHORITY_REQUIRES_TESTNET:${environment}`);
    const required=[...new Set((symbols??[]).map(symbol=>String(symbol).trim().toUpperCase()).filter(Boolean))].sort();
    if(!required.length)throw new Error('MARGIN_AUTHORITY_COVERAGE_EMPTY');
    const limit=Math.max(1,Math.min(4,Number(options.maxInFlight??4)||4));
    const collected:{symbol:string;brackets:unknown[]}[]=[],failures:{symbol:string;reason:string}[]=[];
    let cursor=0;
    const worker=async()=>{
      while(cursor<required.length){
        const symbol=required[cursor++];
        try{
          const rows=await this.signed<any[]>('GET','/fapi/v1/leverageBracket',{symbol},'MARGIN_TIER_AUTHORITY_READ','PRIVATE_STATE');
          const list=Array.isArray(rows)?rows:[];
          const row=list.find(item=>String(item?.symbol??'').toUpperCase()===symbol)??(list.length===1?list[0]:null);
          const brackets=Array.isArray(row?.brackets)?row.brackets:null;
          if(!brackets?.length){failures.push({symbol,reason:'BRACKET_SET_EMPTY'});continue;}
          collected.push({symbol,brackets});
        }catch(error){failures.push({symbol,reason:String(error instanceof Error?error.message:error).slice(0,160)});}
      }
    };
    await Promise.all(Array.from({length:Math.min(limit,required.length)},()=>worker()));
    return {environment,credentialRef:String(options.credentialRef??''),observedAt:Date.now(),
      symbols:collected.sort((a,b)=>a.symbol.localeCompare(b.symbol)),
      failures:failures.sort((a,b)=>a.symbol.localeCompare(b.symbol))};
  }
  async setLeverage(symbol:string,requested:number){let maximum=this.leverageCache.get(symbol);if(!maximum){let flight=this.leverageFlights.get(symbol);if(!flight){flight=this.signed<any[]>('GET','/fapi/v1/leverageBracket',{symbol}).then(rows=>{const bracket=Array.isArray(rows)?rows[0]:rows,value=Math.max(1,Number(bracket?.brackets?.[0]?.initialLeverage??requested));this.leverageCache.set(symbol,value);return value;}).finally(()=>this.leverageFlights.delete(symbol));this.leverageFlights.set(symbol,flight);}maximum=await flight;}const leverage=Math.min(requested,maximum);await this.signed('POST','/fapi/v1/leverage',{symbol,leverage});}
  startUserData(onEvent:(event:any)=>void){if(!this.credentials||this.transport.environment()!=='TESTNET')return null;this.userStream=new BinanceUserDataStream(this.transport,this.credentials.apiKey,onEvent);this.userStream.start();return this.userStream;}
  stopUserData(){this.userStream?.stop();this.userStream=null;}
  userDataMetrics(){return this.userStream?.metrics()??{state:'GATED'};}
}

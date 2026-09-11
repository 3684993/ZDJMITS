import type { BrainDecision, Candle, DerivativesSnapshot, EntryOrder, ManualOrder, MarketSymbolSnapshot, OrderBook, Position, Quote, TakeProfitOrder, Timeframe } from '@zdj/contracts';

export interface MarketDataProvider {
  listSymbols(limit:number, prioritySymbols?:string[]):Promise<string[]>;
  getSnapshot(symbol:string):Promise<MarketSymbolSnapshot>;
  getCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>;
  getQuote(symbol:string):Promise<Quote>;
  getOrderBook(symbol:string):Promise<OrderBook>;
  getDerivatives(symbol:string):Promise<DerivativesSnapshot>;
  tick?():Promise<void>|void;
  hydrateLiveMarket?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  hydrateLiveTechnical?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  hydrateLive?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  streamMetrics?():unknown;
  setLiveSymbols?(symbols:string[]):void;
  collectionCoverage?():Array<{requested:string;symbol:string|null;status:'COLLECTED'|'UNAVAILABLE';reason:string|null}>;
  stop?():void;
}

export interface ExchangeTradeAdapter {
  placeEntry(order:EntryOrder):Promise<EntryOrder>;
  findEntryByClientOrderId(order:EntryOrder):Promise<EntryOrder|null>;
  cancelEntry(order:EntryOrder):Promise<EntryOrder>;
  replaceEntry(order:EntryOrder,newPrice:number):Promise<EntryOrder>;
  placeTakeProfit(order:TakeProfitOrder):Promise<TakeProfitOrder>;
  findTakeProfitByClientOrderId?(order:TakeProfitOrder):Promise<TakeProfitOrder|null>;
  cancelTakeProfit(order:TakeProfitOrder):Promise<TakeProfitOrder>;
  fetchOpenOrders():Promise<Array<EntryOrder|TakeProfitOrder>>;
  fetchPositions():Promise<Position[]>;
  setLeverage(symbol:string,leverage:number):Promise<void>;
  placeManualOrder(request:{clientOrderId:string;internalOrderId?:string;symbol:string;side:'BUY'|'SELL';positionSide?:'LONG'|'SHORT';type:'LIMIT'|'MARKET';quantity:number;price?:number;reduceOnly:boolean;postOnly:boolean}):Promise<ManualOrder>;
  findManualByClientOrderId?(request:{symbol:string;clientOrderId:string;internalOrderId:string;positionId:string;side:'BUY'|'SELL';positionSide:'LONG'|'SHORT';quantity:number;price:number;reduceOnly:boolean;postOnly:boolean}):Promise<ManualOrder|null>;
  cancelManualOrder?(order:ManualOrder):Promise<ManualOrder>;
  tick?(quotes:Map<string,Quote>):Promise<{filledEntries:EntryOrder[];filledTakeProfits:TakeProfitOrder[]}>;
  fetchRecentTradeAudit?(startTime:number,endTime:number,maxFills?:number):Promise<TradeAuditSnapshot>;
  fetchSymbolTradeFacts?(symbol:string,startTime:number,endTime:number):Promise<{fills:ExchangeTradeFill[];income:ExchangeIncomeFact[];orders:ExchangeOrderFact[]}>;
}

export interface ExchangeTradeFill {
  symbol:string; side:'BUY'|'SELL'; positionSide:'LONG'|'SHORT'|'BOTH'; orderId:string; clientOrderId:string; tradeId:string;
  executionTime:number; qty:number; price:number; realizedPnl:number; commission:number; commissionAsset:string; maker:boolean;
}
export interface ExchangeIncomeFact {symbol:string; incomeType:string; income:number; asset:string; time:number; info:string|null; tradeId:string|null; transactionId:string|null;}
export interface ExchangeOrderFact {symbol:string; orderId:string; clientOrderId:string; side:string; positionSide:string; status:string; type:string; origQty:number; executedQty:number; avgPrice:number; updateTime:number;}
export interface TradeAuditSnapshot {
  window:{startTime:number;endTime:number}; source:'BINANCE_TESTNET_PRIVATE'; fetchedAt:number;
  fills:ExchangeTradeFill[]; income:ExchangeIncomeFact[]; orders:ExchangeOrderFact[]; positions:Position[]; openOrders:Array<EntryOrder|TakeProfitOrder>;
}

export interface ModelRunResult<T> { value:T; inputTokens:number|null; outputTokens:number|null; finishReason:string|null; modelIdentity:Record<string,unknown>|null; raw:unknown; timing:{requestMs:number;parseMs:number;retryMs:number}; }
export interface AiModelClient {
  runJson<T>(args:{baseUrl:string;model:string;prompt:string;schemaName:string;timeoutMs:number;jsonSchema?:Record<string,unknown>;maxOutputTokens?:number;parse:(value:unknown)=>T}):Promise<ModelRunResult<T>>;
}

export interface EvidenceToolContext { symbol:string; }
export type EvidenceToolResolver = (requests:BrainDecision['evidenceRequests'], context:EvidenceToolContext)=>Promise<Record<string,unknown>>;

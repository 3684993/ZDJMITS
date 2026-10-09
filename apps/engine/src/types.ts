import type { BrainDecision, Candle, DerivativesSnapshot, EntryOrder, ManualOrder, MarketSymbolSnapshot, OrderBook, Position, Quote, TakeProfitOrder, Timeframe } from '@zdj/contracts';

export interface MarketDataProvider {
  listSymbols(limit:number, prioritySymbols?:string[]):Promise<string[]>;
  /** Lightweight discovery must not mutate WS subscriptions. Providers that support bounded retention should implement this. */
  discoverSymbols?(limit:number, prioritySymbols?:string[]):Promise<string[]>;
  getSnapshot(symbol:string):Promise<MarketSymbolSnapshot>;
  getCandles(symbol:string,timeframe:Timeframe,limit:number):Promise<Candle[]>;
  /** Targeted closed-candle reload for one frame, used to heal a WebSocket sequence gap. */
  repairCandles?(symbol:string,timeframe:Timeframe):Promise<{ok:boolean;missing:number;duplicates:number;closedCount:number;latestClosedAtBoundary:boolean}>;
  cachedCandles?(symbol:string,timeframe:Timeframe,limit:number):Candle[];
  getQuote(symbol:string):Promise<Quote>;
  /** Zero-I/O quote assembled only from already-cached live market facts and contract metadata. */
  cachedQuote?(symbol:string):Quote|undefined;
  /** Static exchange filters do not require a live price. Used by explicit human limit actions. */
  cachedContractRules?(symbol:string):Pick<Quote,'tickSize'|'stepSize'|'minQty'|'minNotional'>|undefined;
  getContractRules?(symbol:string):Promise<Pick<Quote,'tickSize'|'stepSize'|'minQty'|'minNotional'>>;
  getOrderBook(symbol:string):Promise<OrderBook>;
  getDerivatives(symbol:string):Promise<DerivativesSnapshot>;
  tick?():Promise<void>|void;
  hydrateLiveMarket?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  hydrateLiveTechnical?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  hydrateLive?(snapshot:MarketSymbolSnapshot):MarketSymbolSnapshot;
  streamMetrics?():unknown;
  /** Authoritative online WS set when supplied by the runtime retention owner. */
  setLiveSymbols?(symbols:string[]):void;
  collectionCoverage?():Array<{requested:string;symbol:string|null;status:'COLLECTED'|'UNAVAILABLE';reason:string|null}>;
  stop?():void;
}

export interface ExchangeTradeAdapter {
  placeEntry(order:EntryOrder):Promise<EntryOrder>;
  /** Layer A egress/budget admission truth, read from the transport that will actually carry the write. */
  entryAdmissionBlockReason?():string|null;
  findEntryByClientOrderId(order:EntryOrder):Promise<EntryOrder|null>;
  cancelEntry(order:EntryOrder):Promise<EntryOrder>;
  replaceEntry(order:EntryOrder,newPrice:number):Promise<EntryOrder>;
  placeTakeProfit(order:TakeProfitOrder):Promise<TakeProfitOrder>;
  findTakeProfitByClientOrderId?(order:TakeProfitOrder):Promise<TakeProfitOrder|null>;
  cancelTakeProfit(order:TakeProfitOrder):Promise<TakeProfitOrder>;
  /** A symbol-scoped query is weight 1; the unscoped exchange-wide safety scan is weight 40. */
  fetchOpenOrders(symbol?:string):Promise<Array<EntryOrder|TakeProfitOrder>>;
  fetchPositions():Promise<Position[]>;
  invalidateOrderFact?(symbol:string,exchangeOrderId?:string|null,clientOrderId?:string|null):void;
  setLeverage(symbol:string,leverage:number):Promise<void>;
  /**
   * Read-only margin-tier authority: one signed GET per symbol, bounded, and never a writer.
   * The PortfolioRisk profile may only claim a proven bracket table that this produced.
   */
  fetchMaintenanceMarginBrackets?(symbols:string[],options?:{maxInFlight?:number;credentialRef?:string}):Promise<import('./services/portfolioRiskAuthority.js').MarginBracketAuthorityRead>;
  /** Read-only field-presence probe of the per-position risk facts. */
  probePositionRiskFields?():Promise<{environment:string;endpoint:string;observedAt:number;rowCount:number;fieldNames:string[];rows:Record<string,unknown>[]}>;
  placeManualOrder(request:{clientOrderId:string;internalOrderId?:string;symbol:string;side:'BUY'|'SELL';positionSide?:'LONG'|'SHORT';type:'LIMIT'|'MARKET';quantity:number;price?:number;reduceOnly:boolean;postOnly:boolean;positionId?:string}):Promise<ManualOrder>;
  /** C3: the capability matrix a coordinated exit trusts, read from the exchange itself. */
  exitCoordinationCapabilities?():Promise<{oneWayReduceOnly:boolean;hedgePositionSide:boolean;cancelReplaceAtomic:boolean;partialFillExpected:boolean;supportsTimeInForce:string[];positionMode:'ONE_WAY'|'HEDGE'}>;
  /** C3: prove from live positions that a reduce cannot become an increase. */
  proveReduction?(input:{symbol:string;positionSide:'LONG'|'SHORT';quantity:number}):Promise<{kind:'ONE_WAY_REDUCE_ONLY'|'HEDGE_POSITION_SIDE';checkedAt:number;positionSide:'LONG'|'SHORT';liveQuantity:number}>;
  /** C3: tri-state exact read; ABSENT only for the exchange's own no-such-order codes. */
  findExitByClientOrderId?(input:{symbol:string;clientOrderId:string}):Promise<{state:'FOUND';order:any}|{state:'ABSENT';reason:string}>;
  findManualByClientOrderId?(request:{symbol:string;clientOrderId:string;internalOrderId:string;positionId:string;side:'BUY'|'SELL';positionSide:'LONG'|'SHORT';quantity:number;price:number;reduceOnly:boolean;postOnly:boolean}):Promise<ManualOrder|null>;
  cancelManualOrder?(order:ManualOrder):Promise<ManualOrder>;
  tick?(quotes:Map<string,Quote>):Promise<{filledEntries:EntryOrder[];filledTakeProfits:TakeProfitOrder[]}>;
  fetchRecentTradeAudit?(startTime:number,endTime:number,maxFills?:number,additionalSymbols?:string[]):Promise<TradeAuditSnapshot>;
  fetchSymbolTradeFacts?(symbol:string,startTime:number,endTime:number):Promise<{fills:ExchangeTradeFill[];income:ExchangeIncomeFact[];orders:ExchangeOrderFact[];coverageComplete?:boolean;coverageStart?:number;coverageEnd?:number}>;
  /** Lean UNKNOWN-risk proof: identity and fill truth only; never pays the heavy income endpoint cost. */
  fetchSymbolRiskFacts?(symbol:string,startTime:number,endTime:number):Promise<{fills:ExchangeTradeFill[];orders:ExchangeOrderFact[];coverageComplete?:boolean;coverageStart?:number;coverageEnd?:number}>;
  /** Account-level external transfers, used only by the portfolio risk snapshot. */
  fetchCashFlowFacts?(startTime:number,endTime?:number):Promise<{facts:Array<{id:string;amountUsd:number;asset:string;time:number}>;complete:boolean;windowStart:number;windowEnd:number}>;
}

export interface ExchangeTradeFill {
  symbol:string; side:'BUY'|'SELL'; positionSide:'LONG'|'SHORT'|'BOTH'; orderId:string; clientOrderId:string; tradeId:string;
  executionTime:number; qty:number; price:number; realizedPnl:number; commission:number; commissionAsset:string; maker:boolean;
}
export interface ExchangeIncomeFact {symbol:string; incomeType:string; income:number; asset:string; time:number; info:string|null; tradeId:string|null; transactionId:string|null;}
export interface ExchangeOrderFact {symbol:string; orderId:string; clientOrderId:string; side:string; positionSide:string; status:string; type:string; origQty:number; executedQty:number; avgPrice:number; updateTime:number;}
export interface TradeAuditSnapshot {
  window:{startTime:number;endTime:number}; source:'BINANCE_TESTNET_PRIVATE'|'BINANCE_DEMO_PRIVATE'; fetchedAt:number;
  fills:ExchangeTradeFill[]; income:ExchangeIncomeFact[]; orders:ExchangeOrderFact[]; positions:Position[]; openOrders:Array<EntryOrder|TakeProfitOrder>;
}

export interface ModelRunResult<T> { value:T; inputTokens:number|null; outputTokens:number|null; finishReason:string|null; modelIdentity:Record<string,unknown>|null; raw:unknown; timing:{requestMs:number;parseMs:number;retryMs:number;transportAttempts?:number}; }
export interface AiModelClient {
  runJson<T>(args:{baseUrl:string;model:string;prompt:string;schemaName:string;timeoutMs:number;jsonSchema?:Record<string,unknown>;maxOutputTokens?:number;requireContextBudget?:boolean;onContextBudget?:(budget:import('./adapters/ai/promptBudget.js').PromptBudget)=>void;parse:(value:unknown)=>T}):Promise<ModelRunResult<T>>;
}

export interface EvidenceToolContext { symbol:string; }
export type EvidenceToolResolver = (requests:BrainDecision['evidenceRequests'], context:EvidenceToolContext)=>Promise<Record<string,unknown>>;

import { buildOpportunityEvidence, qualityPolicy } from './opportunityEvidence.js';
import { buildQuantityHorizonCandidates } from './quantityHorizonCandidates.js';
import { assembleTradePlan, planFactVersionOf } from './tradePlanService.js';
import {binanceEntryBlockReason} from '../adapters/binance/requestBudget.js';
import {privateAccountFresh} from './privateAccountReadiness.js';
import { nearMarketPrice } from './nearMarketPrice.js';
import { activeOrderStatus, terminalOrderStatus, executionScope, type EntryExecutionJournal } from './executionLifecycle.js';
import { remoteFactAuditDeferred } from './entryRiskOccupancy.js';
import { waitingContext, waitTrigger } from './entryWaiting.js';
import { entryDataError } from './entryFacts.js';
import type { EntryIntent, EntryOrder } from "@zdj/contracts";
import {
  classifyAsset,
  chooseMakerPrice,
  isOnlineAsset,
  priceReachability,
  resolveUnderlying,
  uid,
} from "@zdj/core";
import type { RuntimeState } from "../state/runtimeState.js";
import type { EventBus } from "../events/eventBus.js";
import type { ExchangeTradeAdapter } from "../types.js";
import type { EipService } from "./eipService.js";
import type { AiFabric } from "./aiFabric.js";
import { binanceClientOrderIdFactory } from "./binanceClientOrderIdFactory.js";
import { computeExecutableRiskHeadroom, portfolioCapacityVisibility } from "./riskReadiness.js";
import { candidateCapitalCapacity, entryTradingCapital, leverageFactOf } from "./capitalCapacity.js";
import { collectPendingEntryRiskExposures, entryOrderOccupiesRisk } from './entryRiskOccupancy.js';
import { candidateCapitalFromState } from './capitalCapacity.js';
import { isPipelineRoutableLifecycle, reconcileCandidateLifecycles } from './candidateLifecycleDeriver.js';
import type { MarketDataHub } from './marketDataHub.js';
import { decisionContextKey, decisionContextPermissions, decisionSettingsContext, nextClosedFiveMinute, noEdgeReleaseReason, noEdgeReviewFacts } from './decisionContext.js';
import { evaluatePreflightFeasibility } from './preflightFeasibility.js';
import { buildPreAiExecutionEnvelope } from './preAiExecutionEnvelope.js';
import { evaluatePreAiPlanFeasibility } from './preAiPlanFeasibility.js';
import { acquireExecutionLease, releaseExecutionLease, validateExecutionLease } from './executionLease.js';
import { materializeAiQuantityAllocation } from './aiQuantityAllocation.js';
import { buildHistoricalTpReachability } from './historicalTpReachability.js';
import { evaluateEconomicEntryFeasibility } from './economicEntryFeasibility.js';

/** How long the latest deterministic admission refusal may still be called the current first cause. */
export const RISK_ADMISSION_VERDICT_TTL_MS = 5 * 60_000;

export class EntryCoordinator {
  private active = new Set<string>();
  private primaryWaiters = new Set<string>();
  private lastReview = 0;
  private lastDispatched=new Map<string,number>();
  constructor(
    private state: RuntimeState,
    private eip: EipService,
    private ai: AiFabric,
    private exchange: ExchangeTradeAdapter,
    private events: EventBus,
    private market?:MarketDataHub,
    private journal?:EntryExecutionJournal,
  ) {}
  private analysisStartedAt=Date.now();
  private lastAnalysisHeartbeat=0;
  private analysisFacts={lastTickAt:null as number|null,lastAttemptAt:null as number|null,lastRequestAt:null as number|null,lastSuccessAt:null as number|null,lastFailureAt:null as number|null,lastBlockedReason:null as string|null};
  private analysisOnly(){return this.state.settings.connections?.executionMode==='READ_ONLY'&&this.state.settings.connections?.exchange?.environment==='TESTNET';}
  /**
   * The last pre-model readiness verdict, pushed by the runtime every scheduler tick. A model call is
   * a cost the pipeline may only pay when the book could act on the answer, so the reason it refuses
   * belongs to the same object that reports the silence.
   */
  private executionGate:{intent:boolean;ready:boolean;blockers:string[];firstBlocker:string|null;text:string;at:number;lastReadyAt:number}|null=null;
  private modelSpendPermitted(){const gate=this.executionGate;return gate===null||gate.ready||!gate.intent;}
  noteExecutionReadiness(readiness:{intent:boolean;ready:boolean;blockers:string[];firstBlocker:string|null;text:string;executableCandidateCount:number}){
    const now=Date.now(),lastReadyAt=readiness.ready?now:(this.executionGate?.lastReadyAt??0);
    const previouslyBlocked=this.executionGate!==null&&!this.executionGate.ready&&this.executionGate.intent;
    this.executionGate={intent:readiness.intent,ready:readiness.ready,blockers:readiness.blockers,firstBlocker:readiness.firstBlocker,text:readiness.text,at:now,lastReadyAt};
    if(readiness.ready||!readiness.intent){
      if(previouslyBlocked)this.events.publish('EXECUTION_READINESS_RESUMED',{at:now,lastReadyAt});
      return;
    }
    this.analysisFacts.lastTickAt=now;
    this.analysisFacts.lastBlockedReason=readiness.firstBlocker??'EXECUTION_FACTS_BLOCKED';
    this.ai.setIdleContext(readiness.firstBlocker??'EXECUTION_FACTS_BLOCKED',readiness.executableCandidateCount,readiness.text);
    if(!previouslyBlocked)this.events.publish('EXECUTION_READINESS_BLOCKED',{firstBlocker:readiness.firstBlocker,blockers:readiness.blockers,executableCandidateCount:readiness.executableCandidateCount,at:now});
  }
  noteAnalysisBlocked(reason:string){this.analysisFacts.lastTickAt=Date.now();this.analysisFacts.lastBlockedReason=reason;}
  /** The transport that would carry the write answers for itself; the readiness gate must not guess. */
  writeAdmissionBlockReason(){return this.writeAdmissionBlock();}

  analysisDiagnostics(){
    const now=Date.now(),f=this.analysisFacts,capital=this.state.runtimeControl.capital.executableCandidateCount??0;
    const model=this.state.aiResources.find((r:any)=>r.role==='PRIMARY_BRAIN') as any;
    const gate=this.executionGate;
    let reason=f.lastBlockedReason??'ANALYSIS_READY';
    // The pre-model gate is the strongest statement available: it names the fact that made the model
    // call worthless, so no supply or capacity guess may replace it.
    if(gate?.intent&&!gate.ready)reason=gate.firstBlocker??'EXECUTION_FACTS_BLOCKED';
    else if(!privateAccountFresh(this.state.account))reason='FACTS_BLOCKED';
    else if(this.state.runtimeControl.mode!=='RUNNING'||this.state.executionGovernance?.mode!=='AUTO_RUNNING'||this.state.settings.riskGovernance?.entrySafetyMode!=='AUTO')reason='POLICY_DISABLED';
    else if(model?.status==='OFFLINE')reason='MODEL_UNREACHABLE';
    else if(!f.lastTickAt||now-f.lastTickAt>30_000)reason='SILENCE_UNKNOWN';
    else if(!this.state.universe.some((x:any)=>x.eligible))reason='NO_SUPPLY';
    else if(capital===0)reason='CAPACITY_BLOCKED';
    else if(this.active.size===0&&now-Number(f.lastAttemptAt??this.analysisStartedAt)>30*60_000)reason='DISPATCH_STALLED';
    return{mode:this.analysisOnly()?'ANALYSIS_ONLY':'EXECUTION_ENABLED',...f,reason,capitalExecutableCount:capital,
      active:this.active.size,silenceMs:now-(f.lastSuccessAt??this.analysisStartedAt),observationStartedAt:this.analysisStartedAt,
      execution:{intent:gate?.intent??false,ready:gate?.ready??true,blockers:gate?.blockers??[],firstBlocker:gate?.firstBlocker??null,lastReadyAt:gate?.lastReadyAt||null,readinessText:gate?.text??null},
      text:`${this.analysisOnly()?'ANALYSIS_ONLY：仅分析，交易写锁定':'分析管线'}；${reason}`};
  }
  private admissionBlockReason:string|null=null;
  /** Layer A: ask the transport that will carry the write, so an unproven egress stops Entry before AI, reservation, leverage or submit. */
  private writeAdmissionBlock(){return this.exchange.entryAdmissionBlockReason?.()??binanceEntryBlockReason(this.state.settings.connections?.exchange?.environment);}
  private noteWriteAdmission(reason:string|null){
    if(reason===this.admissionBlockReason)return;
    const previous=this.admissionBlockReason;this.admissionBlockReason=reason;
    this.events.publish(reason?'ENTRY_ADMISSION_BLOCKED':'ENTRY_ADMISSION_RESUMED',{reason,previousReason:previous,poolSize:this.state.pool.list().length,at:Date.now()});
  }
  async processPool() {
    this.analysisFacts.lastTickAt=Date.now();
    if(Date.now()-this.lastAnalysisHeartbeat>=30_000){this.lastAnalysisHeartbeat=Date.now();this.events.publish('ANALYSIS_DISPATCH_HEARTBEAT',this.analysisDiagnostics());}
    const admissionBlock=this.writeAdmissionBlock();
    if(admissionBlock){this.noteAnalysisBlocked(admissionBlock);this.noteWriteAdmission(admissionBlock);return;}
    this.noteWriteAdmission(null);
    if (
      this.state.executionGovernance?.mode !== "AUTO_RUNNING" ||
      this.state.runtimeControl.mode !== "RUNNING"
    ) {
      this.ai.setIdleContext(
        "PAUSED",
        this.state.pool.list().length,
        this.state.executionGovernance?.reason ??
          this.state.runtimeControl.reasonText,
      );
      return;
    }
    const now = Date.now();
    for(const [symbol,row] of this.state.candidateLifecycle) {
      if(row?.status!=='WAIT_FOR_PRICE'||!row.waitContext)continue;
      const market=this.state.snapshots.get(symbol);if(!market)continue;
      const currentOpportunity=qualityPolicy(this.state.settings).mode==='ENFORCE'?buildOpportunityEvidence(market,this.state.settings,now):null;
      const trigger=waitTrigger(row.waitContext,market,now)??(currentOpportunity?.disposition==='ALLOW'&&currentOpportunity.version!==row.waitContext.opportunityVersion?'OPPORTUNITY_EVENT_CHANGED':null);
      if(trigger){this.transition(symbol,'READY',trigger,{confirmation:{...row.waitContext,trigger},waitContext:null,nextEligibleAt:null});this.events.publish('ENTRY_WAIT_TRIGGERED',{runId:row.waitContext.runId,trigger,orderAuthorization:false},symbol);}
    }
    if(!this.analysisOnly())await this.resumeExecutionWaits(now);
    this.state.pool.replenish(this.state.universe);
    for(const [symbol,row] of this.state.candidateLifecycle)
      if(row?.status==='SCOUT_QUEUED'&&!this.active.has(symbol)) this.transition(symbol,'READY','SCOUT_REQUEUE_AFTER_LEASE');
    for (const [symbol, row] of this.state.rejectionCooldown)
      if (row.until <= now) {
        const lifecycle=this.state.candidateLifecycle.get(symbol);
        if(!lifecycle?.decisionContextKey||lifecycle.decisionContextKey!==this.currentDecisionContext(symbol,lifecycle.confirmation)){
          this.state.rejectionCooldown.delete(symbol);
          this.transition(symbol, "READY", "DECISION_CONTEXT_CHANGED");
        }
      }
    const pending = this.state.activeEntrySymbols().size,
      routes = new Map(this.state.runtimeControl.capital.routedCandidates.map(item=>[item.symbol,item]));
    this.state.pool.refreshReadyView(new Set(this.state.universe.filter((candidate:any)=>candidate.eligible&&candidate.pipelineEligible!==false&&this.objectiveCapacity(candidate.symbol)).map((candidate:any)=>candidate.symbol)));
    const ready = this.state.pool
        .readyList()
        .filter(
          (x) => {
            const directionExecutable=this.objectiveCapacity(x.symbol);
            if(!directionExecutable)this.events.publish('PRIMARY_SKIPPED_EXECUTION_CAPACITY',{reason:'NO_OBJECTIVE_EXECUTION_CAPACITY',primaryRequested:false},x.symbol);
            return x.state === "READY" &&
            directionExecutable &&
            this.eipDependenciesPresent(x.symbol) &&
            !this.primaryOccupancyBlock(x.symbol) &&
            !this.active.has(x.symbol) &&
            !this.state.rejectionCooldown.has(x.symbol) &&
            this.lifecycleRunnable(x.symbol);
          },
        ).sort((a,b)=>(this.lastDispatched.get(a.symbol)??0)-(this.lastDispatched.get(b.symbol)??0)||this.primaryReadinessScore(b.symbol,b.score)-this.primaryReadinessScore(a.symbol,a.score)||a.symbol.localeCompare(b.symbol));
    if (pending >= this.state.settings.portfolio.maxPendingEntries) {
      this.ai.setIdleContext(
        "ENTRY_BACKPRESSURE",
        ready.length,
        "等待活动挂单释放容量",
      );
      return;
    }
    const primaryCapacity = this.state.aiResources.filter((r:any) => r.role === "PRIMARY_BRAIN").reduce((n:number,r:any) => n + r.maxConcurrency, 0);
    if(this.active.size>=Math.max(1,primaryCapacity)) {this.analysisFacts.lastBlockedReason='AI_RESOURCE_BUSY';this.ai.setIdleContext('AI_RESOURCE_BUSY',ready.length,'等待 Primary 完成本次决策');return;}
    // A model call is a cost, not a status report: with an armed AUTO_RUNNING intent the Primary is
    // only worth asking when the answer could actually be executed. Everything above this point is
    // deterministic supply maintenance, so the first ready tick resumes without a warm-up cycle.
    if (!this.modelSpendPermitted()) return;
    await this.ai.probePrimaryIfDue(now);
    if(!this.ai.hasCapacity('PRIMARY_BRAIN')) {
      this.analysisFacts.lastBlockedReason='BUDGET_OR_COOLDOWN';
      this.ai.setIdleContext('AI_PRIMARY_CIRCUIT_OPEN',ready.length,'Primary 请求连续失败，等待退避窗口后再尝试');
      return;
    }
    if (!ready.length) {
      this.analysisFacts.lastBlockedReason='NO_RUNNABLE_CANDIDATE';
      // A book with candidates and no new-risk headroom must never read as "still waiting for a
      // candidate". But headroom is not the same as one saturated side: LONG and SHORT are
      // independent, so only a projected exhaustion verdict may say the cap is used up, and only
      // when the capital pre-check itself found nothing executable — otherwise something else
      // (occupancy, facts, cooldown) is the real first cause and must not be masked.
      const capacity = portfolioCapacityVisibility(this.state.entryCapacity(), this.state.runtimeControl.capital.directionBudget, {funding:this.state.runtimeControl.capital.funding??entryTradingCapital(this.state),routes:this.state.runtimeControl.capital.routedCandidates??[]});
      const demand = routes.size > 0 || this.state.universe.some((candidate: any) => candidate.eligible);
      const executable = this.state.runtimeControl.capital.executableCandidateCount ?? 0;
      const capacityBlocked = demand && executable === 0 && capacity.exhaustedForNewRisk;
      const reason = capacityBlocked || !routes.size ? 'WAITING_EXECUTION_CAPACITY' : this.state.pool.readyList().length ? 'WAITING_NEW_FACTS' : 'WAITING_CANDIDATE';
      const usd = (value: number) => `$${value.toFixed(2)}`;
      const nextStep = capacityBlocked
        ? `新增风险额度已用尽：${capacity.exhaustedReason === 'BOTH_DIRECTIONS' ? 'LONG 与 SHORT 双向额度均满' : capacity.exhaustedReason}（首因 ${capacity.entryCapacity.LONG.firstBindingConstraint}/${capacity.entryCapacity.SHORT.firstBindingConstraint}，槽位 ${capacity.limits.slots.used}/${capacity.limits.slots.max}；组合名义 ${usd(capacity.exposure.gross.notionalUsd)}，其政策为 ${capacity.exposure.gross.mode}）；继续供给与订单维护`
        : reason === 'WAITING_EXECUTION_CAPACITY' ? '当前无资本可执行路由；继续供给与订单维护'
        : reason === 'WAITING_NEW_FACTS' ? '等待新的候选事实，避免重复推理'
        : '暂无可派发候选；继续供给与订单维护';
      this.ai.setIdleContext(reason, 0, nextStep);
      return;
    }
    this.ai.setIdleContext(
      "WAITING_PRIMARY",
      ready.length - 1,
      `准备分析 ${ready[0]!.symbol}`,
    );
    const symbol=ready.find(item=>!this.active.has(item.symbol))!.symbol;
    this.analysisFacts.lastAttemptAt=now;this.analysisFacts.lastBlockedReason=null;
    this.events.publish('ANALYSIS_DISPATCH_INTENT',{mode:this.analysisOnly()?'ANALYSIS_ONLY':'EXECUTION_ENABLED',at:now},symbol);
    this.lastDispatched.set(symbol,now);
    this.transition(symbol,"PRIMARY_QUEUED","SCHEDULER_DISPATCH");
    void this.analyze(symbol);
  }
  cadenceReady(_now = Date.now()) { return true; }
  private primaryReadinessScore(symbol:string,fallback:number){const candidate:any=this.state.universe.find((x:any)=>x.symbol===symbol),card:any=this.state.snapshots.get(symbol)?.technical?.['15m'],now=Date.now();if(card?.isClosed!==true||!Number.isFinite(card?.barCloseTime)||card.barCloseTime>now)return Number(candidate?.schedulerPriority??fallback);const trend=Number(card.trendStrength??0),momentum=Math.abs(Number(card.macdHistogramSlope??0)),volume=Math.max(0,Number(card.volumeZScore??0));return Number(candidate?.schedulerPriority??fallback)+Math.min(1,Math.max(0,trend*.6+Math.min(.25,momentum)+Math.min(.15,volume*.05)));}
  /** EIP consumes the candidate plus BTC/ETH regime facts; do not spend a Primary lease before all three exist. */
  private eipDependenciesPresent(symbol:string){return [symbol,'BTCUSDT','ETHUSDT'].every(required=>this.state.snapshots.has(required));}
  /** Read-only feasibility before Primary. Post-AI allocation/reservation/final guards remain authoritative. */
  private preflight(symbol:string){return evaluatePreflightFeasibility(this.state,symbol,this.market?.primaryReadyReasons(symbol,Date.now())??[]);}
  private objectiveCapacity(symbol:string){try{const envelope=buildPreAiExecutionEnvelope(this.state,symbol);return envelope.LONG.executable||envelope.SHORT.executable;}catch{return false;}}
  private primaryOccupancyBlock(symbol:string){
    const now=Date.now(),underlying=resolveUnderlying(symbol),sameUnderlying=(value:string)=>resolveUnderlying(value)===underlying;
    if([...this.state.positions.values()].some(row=>sameUnderlying(row.symbol)))return'UNDERLYING_POSITION_EXISTS';
    if([...this.state.entryOrders.values()].some(row=>sameUnderlying(row.symbol)&&entryOrderOccupiesRisk(row,now)))return'UNDERLYING_ENTRY_EXISTS';
    if([...this.state.entryReservations.values()].some((row:any)=>row.underlying===underlying&&['RESERVED','WORKING'].includes(row.status)&&row.expiresAt>now))return'UNDERLYING_RESERVATION_EXISTS';
    return null;
  }
  private stopPrimaryForOccupancy(symbol:string,stage:string){
    const reason=this.primaryOccupancyBlock(symbol);if(!reason)return false;
    this.transition(symbol,'ENTRY_WORKING',reason);
    this.events.publish('PRIMARY_SKIPPED_OCCUPANCY',{reason,stage,primaryRequested:false,intentCreated:false,orderCreated:false},symbol);
    return true;
  }
  private executionHardBlock(intent:EntryIntent, order?:EntryOrder){
    const qp=qualityPolicy(this.state.settings),qm=this.state.snapshots.get(intent.symbol);
    if(qp.mode==='ENFORCE'&&(this.state as any).tradingQualityEvidenceReady===false)return'TRADING_QUALITY_STORAGE_UNAVAILABLE';
    const budgetBlock=this.writeAdmissionBlock();if(budgetBlock)return budgetBlock;
    if([...this.state.manualExitGoals.values()].some(g=>resolveUnderlying(g.symbol)===resolveUnderlying(intent.symbol)))return 'HUMAN_EXIT_GOAL_ACTIVE';
    const now=Date.now(),symbol=intent.symbol,reservation=intent.reservationId?this.state.entryReservations.get(intent.reservationId):null,candidate=this.state.universe.find((x:any)=>x.symbol===symbol),snapshot=this.state.snapshots.get(symbol),plan=intent.allocationPlan;
    if(now>=Number(intent.aiAuthorizationExpiresAt??intent.absoluteExpiresAt)||now>=intent.absoluteExpiresAt)return'AI_AUTHORIZATION_EXPIRED';
    if(!reservation||!['RESERVED','WORKING'].includes(reservation.status)||now>=reservation.expiresAt)return'RESERVATION_INVALID';
    if(this.state.runtimeControl.mode!=='RUNNING'||this.state.executionGovernance?.mode!=='AUTO_RUNNING'||this.state.settings.connections.executionMode!=='TESTNET_ENABLED'||!privateAccountFresh(this.state.account))return'EXECUTION_PERMISSION_CHANGED';
    const canonical=(value:string)=>String(value??'').trim().normalize('NFKC').replace(/[\s/_-]+/g,'').toUpperCase(),underlying=resolveUnderlying(symbol),quality=this.state.settings.selection.marketQuality;
    if(new Set(quality.symbolBlacklist.map(canonical)).has(canonical(symbol)))return'SYMBOL_BLACKLISTED';
    if(new Set(quality.underlyingBlacklist.map(canonical)).has(canonical(underlying)))return'UNDERLYING_BLACKLISTED';
    if(!isOnlineAsset(classifyAsset(symbol,this.state.settings,now)))return'ASSET_NOT_ADMITTED';
    if(!candidate)return'CANDIDATE_FACT_MISSING';
    const admissionReasons=new Set(['USER_EXCLUDED','NOT_IN_CUSTOM_SYMBOLS','LOW_24H_QUOTE_VOLUME','SPREAD_TOO_WIDE','DATA_INCOMPLETE','MARKET_QUALITY_TIER_POLICY','MARKET_QUALITY_LIQUIDITY_TOP_N']);
    if(candidate.marketQuality?.admitted===false||candidate.exclusionReasons.some((reason:string)=>reason.startsWith('MARKET_QUALITY_')||admissionReasons.has(reason)))return'MARKET_QUALITY_NOT_ADMITTED';
    if(!plan)return'ALLOCATION_PLAN_MISSING';
    const quoteAsset=String(plan.quoteAsset??reservation.quoteAsset??''),available=Number(this.state.account.assets.find((asset:any)=>asset.asset===quoteAsset)?.availableBalance??0),otherReserved=[...this.state.entryReservations.values()].filter((row:any)=>row.id!==reservation.id&&['RESERVED','WORKING'].includes(row.status)&&row.expiresAt>now&&row.quoteAsset===quoteAsset).reduce((sum:number,row:any)=>sum+Number(row.marginUsd??0),0);
    if(quoteAsset!=='UNKNOWN'&&available-otherReserved+1e-8<Number(reservation.marginUsd??plan.marginUsd??0))return'INSUFFICIENT_AVAILABLE_MARGIN';
    if(!snapshot)return'MARKET_DATA_MISSING';const dataError=entryDataError(snapshot);if(dataError)return dataError;
    if(this.market?.primaryReadyReasons(symbol,now).length)return'MARKET_DATA_STALE';
    if([...this.state.positions.values()].some(p=>String(p.symbol).replace(/(USDT|USDC|BUSD)$/,'')===underlying))return'UNDERLYING_POSITION_EXISTS';
    if([...this.state.entryOrders.values()].some(x=>x.id!==order?.id&&entryOrderOccupiesRisk(x,now)&&String(x.symbol).replace(/(USDT|USDC|BUSD)$/,'')===underlying))return'UNDERLYING_ENTRY_EXISTS';
    if(this.state.entryCapacity(order?.id,reservation.id).used>=this.state.settings.portfolio.maxPositions)return'RISK_MAX_POSITIONS';
    if(order){const q=snapshot.quote,frozenUnits=Number(intent.quantityUnits),frozenEnvelope=intent.executionEnvelope,expectedQuantity=frozenUnits*q.stepSize;
      // The frozen authorization is re-verified at execution against the same published interval: outside
      // either bound the order is refused, and a mutated quantity is never accepted as "close enough".
      if(!Number.isInteger(frozenUnits)||frozenUnits<=0||!frozenEnvelope)return'AI_QUANTITY_EXCEEDS_ENVELOPE';
      if(frozenUnits>Number(frozenEnvelope[intent.side].maxQuantityUnits))return'AI_QUANTITY_EXCEEDS_ENVELOPE';
      if(frozenUnits<Number(frozenEnvelope[intent.side].minQuantityUnits??1))return'AI_QUANTITY_BELOW_ENVELOPE';
      if(Math.abs(order.quantity-expectedQuantity)>Math.max(1e-12,q.stepSize*1e-9))return'AI_QUANTITY_MUTATED_AFTER_DECISION';if(order.quantity*order.price>Number(frozenEnvelope[intent.side].maxNotionalUsd)+1e-8)return'AI_QUANTITY_EXCEEDS_ENVELOPE';const tickUnits=order.price/q.tickSize,stepUnits=order.quantity/q.stepSize,rangeEpsilon=Math.max(Number.EPSILON*Math.max(1,Math.abs(intent.acceptablePriceRange.min),Math.abs(intent.acceptablePriceRange.max))*8,q.tickSize*1e-9);if(order.price+rangeEpsilon<intent.acceptablePriceRange.min||order.price-rangeEpsilon>intent.acceptablePriceRange.max)return'ORDER_PRICE_OUTSIDE_AUTHORIZATION';if(order.quantity+1e-12<q.minQty||order.quantity*order.price+1e-9<q.minNotional)return'EXCHANGE_MINIMUM_NOT_MET';if(!Number.isFinite(tickUnits)||Math.abs(tickUnits-Math.round(tickUnits))>1e-7||!Number.isFinite(stepUnits)||Math.abs(stepUnits-Math.round(stepUnits))>1e-7)return'EXCHANGE_PRECISION_INVALID';}
    if(order&&intent.profitTakePlan&&intent.executionEnvelope&&this.state.settings.tradeEconomics.admissionMode==='ENFORCE'){
      const economic=evaluateEconomicEntryFeasibility({state:this.state,market:this.market,symbol,side:intent.side,quantityUnits:Number(intent.quantityUnits),acceptablePriceRange:{min:Number(intent.acceptablePriceRange.min),max:Number(intent.acceptablePriceRange.max)},profitTakePlan:intent.profitTakePlan,envelope:intent.executionEnvelope,actualEntryPrice:order.price,now});
      if(!economic.passed)return economic.blockers[0]??'ECONOMIC_ADMISSION_FAILED';
    }
    const pendingRiskExposures=collectPendingEntryRiskExposures(this.state,{now,excludeReservationId:reservation.id,excludeOrderId:order?.id??null,priorityReservationId:reservation.id}),actualNotional=order?order.quantity*order.price:Number(plan?.notionalUsd??0),minimumNotional=Math.max(1,Number(snapshot.quote.minNotional??0)),risk=computeExecutableRiskHeadroom({settings:this.state.settings,equity:Number(this.state.account.equityUsd??0),positions:[...this.state.positions.values()],pendingRiskExposures,symbol,side:intent.side,plannedNotional:actualNotional,expectedAdverseMovePct:Math.max(.001,snapshot.technical['15m'].atrPercent/100),dailyDrawdownPct:Number(this.state.account.riskBaseline?.riskDrawdownPct??0),capital:candidateCapitalCapacity({quoteAsset,availableBalanceUsd:available,reservedMarginUsd:otherReserved,executionLeaseMarginUsd:0,leverage:intent.leverage,leverageFact:leverageFactOf(intent.leverage),minimumNotionalUsd:minimumNotional}),minimumNotional});
    this.events.publish('FINAL_ORDER_RISK_EVALUATED',{stage:'FINAL_ORDER',factVersion:risk.factVersion,equity:risk.equity,clusterKey:risk.clusterKey,remaining:risk.remaining,plannedNotional:Number(plan?.notionalUsd??0),actualNotional,pendingRiskNotionalUsd:risk.pendingRiskNotional,blocker:risk.executable&&actualNotional<=risk.finalNotional+1e-8?'PASS':risk.reason==='PASS'?'FINAL_NOTIONAL_EXCEEDS_HEADROOM':risk.reason},symbol);
    if(!risk.executable)return`RISK_${risk.reason}`;
    return actualNotional<=risk.finalNotional+1e-8?null:'RISK_FINAL_NOTIONAL_EXCEEDS_HEADROOM';
  }
  private preparedOrder(intent:EntryIntent,quantity:number,price:number,reachability:number,now=Date.now()){
    const existing=[...this.state.entryOrders.values()].find(x=>x.intentId===intent.id&&['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(x.status));
    if(existing)return existing;
    const id=`entry_${intent.id}`;
    const order:EntryOrder={id,cycleId:`cycle_${id}`,clientOrderId:binanceClientOrderIdFactory.stable('ML',intent.id),exchangeOrderId:null,symbol:intent.symbol,side:intent.side,quantity,price,filledQuantity:0,leverage:intent.leverage,status:'NEW',createdAt:now,updatedAt:now,absoluteExpiresAt:intent.absoluteExpiresAt,repriceCount:0,intentId:intent.id,reachability,reservationId:intent.reservationId,decisionChainId:intent.decisionChainId??intent.brainRunId};
    this.state.entryOrders.set(id,order);return order;
  }
  private async submitExactlyOnce(intent:EntryIntent,order:EntryOrder,resumedFrom?:string){
    if(order.status==='UNKNOWN'||order.status==='SUBMITTING'){
      const found=await this.exchange.findEntryByClientOrderId(order);if(found)return found;
      throw new Error('ENTRY_SUBMISSION_UNKNOWN_PENDING_RECONCILIATION');
    }
    const block=this.executionHardBlock(intent,order);if(block){if(order.status==='NEW'){const rejected={...order,status:'REJECTED' as const,factSource:'LOCAL_NOT_SUBMITTED',updatedAt:Date.now()};this.state.entryOrders.set(order.id,rejected);this.journal?.save({intent,order:rejected});}throw new Error(`JIT_BLOCKED:${block}`);}
    const submitting={...order,status:'SUBMITTING' as const,updatedAt:Date.now()};this.state.entryOrders.set(order.id,submitting);
    if(this.journal){
      const scope=executionScope(this.state.settings.connections.exchange.environment,this.state.settings.connections.exchange.credentialRef,resolveUnderlying(order.symbol),'ENTRY');
      const claim=this.journal.claim(scope,{intent,order:submitting,reservation:order.reservationId?this.state.entryReservations.get(order.reservationId):undefined},resumedFrom==='POST_ONLY_REPRICE');
      if(!claim.acquired){
        this.state.entryOrders.set(claim.record.order.id,claim.record.order);
        if(claim.record.order.id!==order.id){this.state.entryOrders.delete(order.id);if(order.reservationId)this.state.releaseEntryReservation(order.reservationId);}
        this.state.entryIntents.set(claim.record.intent.id,claim.record.intent);
        throw new Error('ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS');
      }
    }
    try{this.events.publish('ENTRY_SUBMIT_ATTEMPTED',{brainRunId:intent.brainRunId,intentId:intent.id,orderId:order.id,clientOrderId:order.clientOrderId,environment:'TESTNET',resumedFrom:resumedFrom??null},intent.symbol);}catch(error){
      // No exchange call has occurred yet. Retire the durable claim as locally unsent instead of
      // leaving SUBMITTING to be mistaken for an exchange-UNKNOWN outcome.
      const rejected={...order,status:'REJECTED' as const,factSource:'LOCAL_NOT_SUBMITTED',updatedAt:Date.now()};
      this.state.entryOrders.set(order.id,rejected);this.journal?.save({intent,order:rejected});
      throw new Error(`ENTRY_SUBMISSION_ABORTED_BEFORE_EXCHANGE:${error instanceof Error?error.message:String(error)}`);
    }
    try{const placed=await this.exchange.placeEntry(submitting);const accepted={...placed,submittedAt:placed.submittedAt??Date.now()};this.journal?.save({intent,order:accepted});return accepted;}catch(error){
      try{const found=await this.exchange.findEntryByClientOrderId(submitting);if(found){const recoveredOrder={...found,submittedAt:found.submittedAt??submitting.updatedAt};this.journal?.save({intent,order:recoveredOrder});this.events.publish('ENTRY_SUBMIT_RESPONSE_RECOVERED',{brainRunId:intent.brainRunId,intentId:intent.id,orderId:order.id,clientOrderId:order.clientOrderId,submittedAt:recoveredOrder.submittedAt},intent.symbol);return recoveredOrder;}}catch(queryError){this.events.publish('ENTRY_SUBMIT_QUERY_FAILED',{intentId:intent.id,message:queryError instanceof Error?queryError.message:String(queryError)},intent.symbol);}
      const reason=error instanceof Error?error.message:String(error);
      if(reason.includes('-5022')){this.journal?.save({intent,order:{...order,status:'REJECTED'}});this.state.entryOrders.set(order.id,{...order,status:'NEW',updatedAt:Date.now()});throw error;}
      this.state.entryOrders.set(order.id,{...submitting,status:'UNKNOWN',updatedAt:Date.now()});throw new Error(`ENTRY_SUBMISSION_UNKNOWN:${reason}`);
    }
  }
  private terminateExecutionWait(symbol:string,row:any,intent:EntryIntent|undefined,reservation:any,reason:string){
    const waitingIntentId=intent?.id??row?.executionWait?.intentId;const active=[...this.state.entryOrders.values()].find(o=>o.intentId===waitingIntentId&&(['SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(o.status)||Boolean(o.exchangeOrderId)&&o.status==='NEW'));
    if(active){this.events.publish('ENTRY_EXECUTION_WAIT_UNRESOLVED',{intentId:intent?.id,orderId:active.id,reason,occupancyReleased:false},symbol);return;}
    const now=Date.now(),cooldownMs=Math.max(1_000,this.aiFailureCooldownSeconds()),order=intent?[...this.state.entryOrders.values()].find(x=>x.intentId===intent.id&&['NEW','SUBMITTING'].includes(x.status)):undefined,market=this.state.snapshots.get(symbol);
    if(order)this.state.entryOrders.set(order.id,{...order,status:'REJECTED',updatedAt:now});
    if(reservation)this.state.releaseEntryReservation(reservation.id);
    this.state.rejectionCooldown.set(symbol,{until:now+cooldownMs,reason:`EXECUTION_WAIT_TERMINATED:${reason}`,rank:this.state.universe.find(x=>x.symbol===symbol)?.rank??9999,at:now});
    this.transition(symbol,'REJECT_COOLDOWN',`EXECUTION_WAIT_TERMINATED:${reason}`,{runId:intent?.brainRunId??row?.runId,executionWait:null,nextEligibleAt:now+cooldownMs});
    this.events.publish('ENTRY_EXECUTION_WAIT_TERMINATED',{intentId:intent?.id??row?.executionWait?.intentId,brainRunId:intent?.brainRunId??row?.runId,reason,terminalStage:'ENTRY_EXECUTION_WAIT_TERMINATED',entryOrderCreated:Boolean(order),exchangeOrderId:order?.exchangeOrderId??null,actual:{bid:market?.quote.bid??null,ask:market?.quote.ask??null,mark:market?.quote.mark??null,availableQuote:intent?.allocationPlan?.quoteAsset?this.state.account.assets.find((x:any)=>x.asset===intent.allocationPlan?.quoteAsset)?.availableBalance??null:null},limit:{acceptablePriceRange:intent?.acceptablePriceRange??row?.executionWait?.acceptablePriceRange??null,authorizationExpiresAt:intent?.aiAuthorizationExpiresAt??row?.executionWait?.expiresAt??null}},symbol);
  }
  private completeExecutionWait(symbol:string,intent:EntryIntent,reservation:any,placed:EntryOrder,recovered=false){
    const terminal=['FILLED','CANCELED','EXPIRED','REJECTED'].includes(placed.status);if(terminal)this.state.releaseEntryReservation(reservation.id);else this.state.markEntryReservationWorking(reservation.id,reservation.intentId);this.state.entryOrders.set(placed.id,placed);this.journal?.save({intent,order:placed});this.transition(symbol,placed.status==='FILLED'?'POSITION_OPEN':terminal?'READY':'ENTRY_WORKING',recovered?'EXECUTION_SUBMISSION_RECOVERED':'EXECUTION_RANGE_REACHED',{runId:intent.brainRunId,executionWait:null});this.state.pool.remove(symbol);this.events.publish('ENTRY_ORDER_CREATED',{order:placed,intent,brainRunId:intent.brainRunId,decisionChainId:intent.brainRunId,resumedFrom:'WAIT_EXECUTION_RANGE',recovered},symbol);
  }
  private async resumeExecutionWaits(now:number){
    for(const [symbol,row] of this.state.candidateLifecycle){
      if(row?.status!=='WAIT_EXECUTION_RANGE'||!row.executionWait)continue;
      const intent=this.state.entryIntents.get(row.executionWait.intentId),reservation=this.state.entryReservations.get(row.executionWait.reservationId),market=this.state.snapshots.get(symbol);
      if(!intent||!reservation){this.terminateExecutionWait(symbol,row,intent,reservation,'WAIT_FACT_MISSING');continue;}
      const uncertain=[...this.state.entryOrders.values()].find(order=>order.intentId===intent.id&&['UNKNOWN','SUBMITTING'].includes(order.status));
      if(uncertain){try{const found=await this.exchange.findEntryByClientOrderId(uncertain);if(found){this.completeExecutionWait(symbol,intent,reservation,found,true);continue;}}catch(error){this.events.publish('ENTRY_SUBMIT_QUERY_FAILED',{intentId:intent.id,message:error instanceof Error?error.message:String(error)},symbol);continue;}continue;}
      const initialBlock=this.executionHardBlock(intent);if(initialBlock){this.terminateExecutionWait(symbol,row,intent,reservation,initialBlock);continue;}
      if(!market){this.terminateExecutionWait(symbol,row,intent,reservation,'MARKET_DATA_MISSING');continue;}
      const maker=nearMarketPrice(intent,market,this.state.settings.entry);if(!maker.reachable)continue;
      const plan=intent.allocationPlan,quantity=Number(intent.quantityUnits)*market.quote.stepSize;if(quantity<=0||quantity*maker.price>plan.notionalUsd+1e-8){this.terminateExecutionWait(symbol,row,intent,reservation,'EXCHANGE_MINIMUM_EXCEEDS_AUTHORIZED_ALLOCATION');continue;}
      const existing=[...this.state.entryOrders.values()].find(order=>order.intentId===intent.id&&['NEW','SUBMITTING','UNKNOWN'].includes(order.status)),prepared=this.preparedOrder(intent,quantity,maker.price,maker.reachability,now),order=existing?{...prepared,quantity,price:maker.price,reachability:maker.reachability,updatedAt:now}:prepared;this.state.entryOrders.set(order.id,order);
      const pre=this.executionHardBlock(intent,order);if(pre){this.terminateExecutionWait(symbol,row,intent,reservation,pre);continue;}
      try{await this.exchange.setLeverage(symbol,intent.leverage);}catch(error){this.events.publish('ENTRY_EXECUTION_WAIT_RETRY_FAILED',{intentId:intent.id,message:error instanceof Error?error.message:String(error),stage:'SET_LEVERAGE'},symbol);continue;}
      const post=this.executionHardBlock(intent,order);if(post){this.terminateExecutionWait(symbol,row,intent,reservation,post);continue;}
      try{const placed=await this.submitExactlyOnce(intent,order,'WAIT_EXECUTION_RANGE');this.completeExecutionWait(symbol,intent,reservation,placed);}catch(error){const hard=this.executionHardBlock(intent,order);if(hard){this.terminateExecutionWait(symbol,row,intent,reservation,hard);continue;}this.events.publish('ENTRY_EXECUTION_WAIT_RETRY_FAILED',{intentId:intent.id,message:error instanceof Error?error.message:String(error),stage:'SUBMIT'},symbol);}
    }
  }
  private async analyze(symbol: string) {
    if(this.stopPrimaryForOccupancy(symbol,'BEFORE_ANALYSIS'))return;
    let terminalRunId:string|undefined,executionLeaseId:string|undefined,executionEnvelope:ReturnType<typeof buildPreAiExecutionEnvelope>|null=null;
    this.active.add(symbol);
    this.state.pool.markAnalyzing(symbol);
    this.events.publish("POOL_ANALYSIS_STARTED", { lifecycle:"PRIMARY_QUEUED" }, symbol);
    try {
      if(this.market?.primaryReadyReasons(symbol).length){await this.market.refreshSymbols([symbol]);const remaining=this.market.primaryReadyReasons(symbol);if(remaining.length)throw new Error(`MARKET_DATA_STALE: ${remaining.join(',')}`);}
      let packet = this.eip.build(symbol);
      if (
        packet.evidenceCompleteness <
          this.state.settings.riskGovernance.requiredEvidenceCompleteness &&
        this.state.settings.riskGovernance.failClosedOnMissingEvidence
      ) {
        this.events.publish("ENTRY_DECISION_BLOCKED",{stage:"EIP",reason:"EVIDENCE_INCOMPLETE_FAIL_CLOSED",evidenceCompleteness:packet.evidenceCompleteness,required:this.state.settings.riskGovernance.requiredEvidenceCompleteness},symbol);
        this.reject(symbol, "EVIDENCE_INCOMPLETE_FAIL_CLOSED");
        return;
      }
      if (packet.evidenceCompleteness < this.state.settings.ai.minEvidenceCompleteness)
        this.events.publish("EIP_CONTEXTUAL_EVIDENCE_INCOMPLETE",{evidenceCompleteness:packet.evidenceCompleteness,policy:"FAIL_CLOSED_FOR_ENTRY"},symbol);
      if (this.state.executionGovernance?.mode !== "AUTO_RUNNING" || this.state.runtimeControl.mode !== "RUNNING" || !this.state.settings.riskGovernance.entrySafetyMode || this.state.settings.riskGovernance.entrySafetyMode !== "AUTO") {
        this.events.publish("ENTRY_ANALYSIS_PAUSED",{stage:"BEFORE_PRIMARY",reason:this.state.executionGovernance?.reason ?? this.state.runtimeControl.reasonText,safetyMode:this.state.settings.riskGovernance.entrySafetyMode,executionMode:this.state.executionGovernance?.mode},symbol);
        return;
      }
      this.transition(symbol,"PRIMARY_QUEUED","WAITING_PRIMARY_SLOT");
      const primaryQueuedAt=this.state.candidateLifecycle.get(symbol)?.updatedAt??Date.now();
      await this.waitForPrimary(symbol);
      if(this.stopPrimaryForOccupancy(symbol,'AFTER_PRIMARY_SLOT'))return;
      this.transition(symbol,"PRIMARY_RUNNING","PRIMARY_START");
      if(this.market?.primaryReadyReasons(symbol).length){await this.market.refreshSymbols([symbol]);const remaining=this.market.primaryReadyReasons(symbol);if(remaining.length)throw new Error(`MARKET_DATA_STALE: ${remaining.join(',')}`);}
      if(this.stopPrimaryForOccupancy(symbol,'AFTER_MARKET_REFRESH'))return;
      const reachability=this.market?buildHistoricalTpReachability({candles:(timeframe,limit)=>this.market!.cachedCandles(symbol,timeframe,limit),lookbackBars:this.state.settings.tradeEconomics.reachabilityLookbackBars,minSamples:this.state.settings.tradeEconomics.reachabilityMinSamples}):undefined;
      executionEnvelope=buildPreAiExecutionEnvelope(this.state,symbol,Date.now(),reachability);
      this.events.publish('PRE_AI_EXECUTION_ENVELOPE_CREATED',{executionEnvelope},symbol);
      if(!executionEnvelope.LONG.executable&&!executionEnvelope.SHORT.executable){
        // Name what actually denied the side. A symbol with no verified margin bracket is refused here,
        // before Primary is called, and the refusal is about that symbol alone.
        const constraint=[executionEnvelope.LONG,executionEnvelope.SHORT].map((side:any)=>String(side.firstBindingConstraint??'')).find(Boolean)??'PRE_AI_NO_EXECUTABLE_CAPACITY';
        this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'PRE_AI_EXECUTION_ENVELOPE',reason:constraint,
          reasons:[...new Set([executionEnvelope.LONG,executionEnvelope.SHORT].flatMap((side:any)=>side.riskHeadroom?.blockers??[]))].slice(0,12),
          sideAuthorization:executionEnvelope.sideAuthorization,modelCallConsumed:false},symbol);
        this.reject(symbol,constraint);return;}
      // The envelope says a side has capital; it does not say a plan can be written for it. This probe
      // answers the plan question - does any exchange-legal quantity on this side clear its own hard
      // profit floor - with the same functions the plan layer uses, so a refusal here is a refusal the
      // plan would have made anyway, settled without spending a model run. Statistics are excluded:
      // in SHADOW they must not veto, and they are the model's judgement to argue with.
      const planFeasibility=evaluatePreAiPlanFeasibility({symbol,now:Date.now(),envelope:executionEnvelope,settings:this.state.settings});
      this.events.publish('PRE_AI_TRADE_PLAN_FEASIBILITY',{checkedAt:planFeasibility.checkedAt,noHardExecutableSide:planFeasibility.noHardExecutableSide,sides:planFeasibility.sides},symbol);
      if(planFeasibility.noHardExecutableSide){
        this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'PRE_AI_TRADE_PLAN',reason:'PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE',
          reasons:[...new Set(['LONG','SHORT'].flatMap((side:'LONG'|'SHORT')=>planFeasibility.sides[side].reasons))],sides:planFeasibility.sides},symbol);
        this.reject(symbol,'PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE');return;
      }
      const lease=acquireExecutionLease(this.state,{symbol,quoteAsset:executionEnvelope.quoteAsset,reservedMarginUsd:executionEnvelope.leaseRequiredMarginUsd,ttlMs:executionEnvelope.expiresAt-Date.now()});
      if(lease.ok===false){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'EXECUTION_LEASE',reason:lease.reason},symbol);this.reject(symbol,lease.reason);return;}
      executionLeaseId=lease.lease.id;
      packet=this.eip.build(symbol,{...executionEnvelope,leaseId:lease.lease.id,leaseExpiresAt:lease.lease.expiresAt});
      const confirmation=this.state.candidateLifecycle.get(symbol)?.confirmation;
      const contextKey=this.currentDecisionContext(symbol,confirmation);
      const quality=qualityPolicy(this.state.settings);
      if(quality.mode==='ENFORCE'&&(this.state as any).tradingQualityEvidenceReady===false)throw new Error('TRADING_QUALITY_STORAGE_UNAVAILABLE');
      const opportunity=quality.mode==='OFF'?undefined:buildOpportunityEvidence(this.state.snapshots.get(symbol)!,this.state.settings);
      if(opportunity){
        this.events.publish('TRADING_QUALITY_OPPORTUNITY',{opportunity,packetId:packet.packetId,stage:'BEFORE_PRIMARY',candidate:this.state.universe.find(x=>x.symbol===symbol)},symbol);
        }
      const scout = this.state.settings.ai.scoutEnabled ? await this.ai.scout(packet) : null;
      this.analysisFacts.lastRequestAt=Date.now();
      const result = await this.ai.decide(packet, scout, Date.now()-primaryQueuedAt, confirmation);
      if(opportunity)this.events.publish('TRADING_QUALITY_PRIMARY_LINK',{runId:result.runId,packetId:packet.packetId,opportunity,decision:result.decision},symbol);

      this.transition(symbol,'PRIMARY_COMPLETED','PRIMARY_TERMINAL',{confirmation:null,runId:result.runId,decisionContextKey:contextKey,lastDecision:result.decision.decision,nextReviewAt:nextClosedFiveMinute()});
      terminalRunId=result.runId;
      const d = result.decision;
      this.analysisFacts.lastSuccessAt=Date.now();
      if(this.analysisOnly()){
        this.completeReadOnlyAnalysis({symbol,d,result,executionEnvelope});
        this.cooldown(symbol,'ANALYSIS_ONLY_COMPLETED',Math.max(60_000,nextClosedFiveMinute()-Date.now()));
        return;
      }
      if (d.decision === 'REJECT_CANDIDATE' || !d.decision) { this.reject(symbol,d.reason,result.runId,d.tradeSide??undefined); return; }
      if(d.decision==='WAIT_FOR_PRICE') {this.persistWaitPlan({symbol,side:(d.structureDirection??d.tradeSide??'LONG') as 'LONG'|'SHORT',d,result,executionEnvelope});const market=this.state.snapshots.get(symbol),error=entryDataError(market);if(error)throw new Error(error);const wait={...waitingContext(d,result.runId,market!),opportunityVersion:opportunity?.version??null};this.transition(symbol,'WAIT_FOR_PRICE',d.reason,{waitContext:wait,nextEligibleAt:null});this.state.pool.remove(symbol);this.state.pool.replenish(this.state.universe);this.events.publish('ENTRY_WAIT_SAVED',{runId:result.runId,wait,entryIntentCreated:false},symbol);return;}
      if(d.decision!=='PLACE_LONG'&&d.decision!=='PLACE_SHORT') {const caps=this.routeCapabilities(symbol),facts=noEdgeReviewFacts({market:this.state.snapshots.get(symbol)!,...caps}),ttl=Math.max(60_000,(this.state.settings.ai.highFrequency?.retryCooldownSeconds??25)*4_000),noEdgeReview={structureDirection:d.structureDirection,rejectLayer:d.rejectLayer,blockingCondition:d.blockingCondition,releaseCondition:d.releaseCondition,facts,createdAt:Date.now(),expiresAt:Date.now()+ttl,invalidation:'15M_STRUCTURE_OR_PERMISSION_OR_ECONOMIC_SPACE_CHANGE'};this.events.publish('PRIMARY_NO_ENTRY',{runId:result.runId,decision:d.decision,reason:d.reason,rejectLayer:d.rejectLayer,blockingCondition:d.blockingCondition,releaseCondition:d.releaseCondition,noEdgeReview,entryIntentCreated:false},symbol);this.cooldown(symbol,d.reason,ttl,d.decision==='DATA_ERROR'||d.decision==='AI_OUTPUT_INVALID'?'AI_FAILURE_COOLDOWN':'REJECT_COOLDOWN',{noEdgeReview});return;}
      const decisionSide=(d.tradeSide??d.direction??(d.decision==='PLACE_LONG'?'LONG':'SHORT')) as 'LONG'|'SHORT';
      const marketForPolicy=this.state.snapshots.get(symbol)!;
      const dataError=entryDataError(marketForPolicy);if(dataError){this.events.publish('ENTRY_DATA_ERROR',{runId:result.runId,reason:dataError},symbol);this.reject(symbol,dataError,result.runId,d.tradeSide??undefined);return;}
      const fingerprint=JSON.stringify({bar15:(marketForPolicy.technical['15m'] as any).updatedAt??(marketForPolicy.technical['15m'] as any).close??marketForPolicy.quote.last,priceAtr:Math.round(marketForPolicy.quote.last/Math.max(.000001,marketForPolicy.technical['15m'].atr14)),regime:(packet as any).globalRegime?.regime,trend4h:marketForPolicy.technical['4h'].trend,spread:Math.round((marketForPolicy.quote.ask-marketForPolicy.quote.bid)/marketForPolicy.quote.last*10000)});
      const previous=this.state.directionDecisionStates.get(symbol),nextDecision=d.decision;
      if(previous?.fingerprint===fingerprint&&((previous.decision==='REJECT_CANDIDATE'&&nextDecision==='PLACE_LONG')||(previous.direction==='SHORT'&&d.tradeSide==='LONG')))this.events.publish('DIRECTION_STABILITY_SHADOW',{runId:result.runId,previous,next:{decision:nextDecision,direction:d.tradeSide},wouldBlock:true,orderAuthorization:false},symbol);
      this.state.directionDecisionStates.set(symbol,{fingerprint,decision:nextDecision,direction:d.tradeSide,updatedAt:Date.now(),materialDecisionChange:previous?.fingerprint!==fingerprint});
      this.events.publish('MATERIAL_DECISION_CHANGE',{fingerprint,materialDecisionChange:previous?.fingerprint!==fingerprint,policy:'AI_AUTONOMOUS_DIRECTION',decision:nextDecision,direction:d.tradeSide},symbol);
      if (!d.acceptablePriceRange || d.idealPrice == null || d.horizonMinutes == null) {this.reject(symbol, "Brain returned incomplete entry intent");return;}
      const range = d.acceptablePriceRange,deterministicInvalid = range.min > range.max || d.idealPrice < range.min || d.idealPrice > range.max || (d.decision === "PLACE_LONG" && decisionSide !== "LONG") || (d.decision === "PLACE_SHORT" && decisionSide !== "SHORT");
      if (deterministicInvalid) {this.events.publish("ENTRY_DECISION_BLOCKED",{stage:"POST_AI_VERIFY",reason:"DETERMINISTIC_POST_AI_VERIFY_FAILED",idealPrice:d.idealPrice,acceptablePriceRange:range,direction:d.tradeSide,decision:d.decision},symbol);this.reject(symbol,"DETERMINISTIC_POST_AI_VERIFY_FAILED",result.runId,d.tradeSide??undefined);return;}
      if (d.missingEvidence.length > 0 || d.contradictions.length > 3)this.events.publish("ENTRY_PROTECTION_SHADOW",{decision:d.decision,confidence:d.confidence,missingEvidence:d.missingEvidence.length,contradictions:d.contradictions.length,postAiVeto:false},symbol);
      this.transition(symbol,"PLACE_READY","PRIMARY_PLACE_READY",{runId:result.runId});
      const side = decisionSide,market = this.state.snapshots.get(symbol)!,candidate = this.state.universe.find((x) => x.symbol === symbol);
      if (!candidate) {this.reject(symbol,"PORTFOLIO_CANDIDATE_MISSING",result.runId,d.tradeSide??undefined);return;}
      if (this.state.executionGovernance?.mode !== "AUTO_RUNNING" || this.state.runtimeControl.mode !== "RUNNING" || !this.state.runtimeControl.entrySafetyMode || this.state.runtimeControl.entrySafetyMode !== "AUTO") {this.events.publish("ENTRY_ANALYSIS_PAUSED",{stage:"AFTER_PRIMARY",reason:this.state.executionGovernance?.reason ?? this.state.runtimeControl.reasonText,runId: result.runId,executionMode:this.state.executionGovernance?.mode},symbol);return;}
      if(!executionEnvelope)throw new Error('PRE_AI_EXECUTION_ENVELOPE_MISSING');
      const leaseCheck=validateExecutionLease(this.state,executionLeaseId,symbol);if(!leaseCheck.ok){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'POST_AI_EXECUTION_LEASE',reason:leaseCheck.reason},symbol);this.reject(symbol,leaseCheck.reason,result.runId,d.tradeSide??undefined);return;}
      const sideEnvelope=executionEnvelope[side];
      if(!sideEnvelope.executable){this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'POST_PRIMARY_EXECUTION_ENVELOPE',reason:'AI_DIRECTION_NOT_EXECUTABLE',violation:'MODEL_SELECTION_OUTSIDE_EXECUTABLE_ENVELOPE',envelopeAuthorization:executionEnvelope.sideAuthorization?.[side]??null,executableSides:executionEnvelope.executableSides??null,brainRunId:result.runId,direction:side},symbol);this.reject(symbol,'AI_DIRECTION_NOT_EXECUTABLE',result.runId,d.tradeSide??undefined);return;}
      const quantityUnits=Number(d.quantityUnits);if(!Number.isInteger(quantityUnits)||quantityUnits<=0){this.reject(symbol,'AI_QUANTITY_UNITS_INVALID',result.runId,d.tradeSide??undefined);return;}
      if(quantityUnits>sideEnvelope.maxQuantityUnits){this.events.publish('AI_SIZING_ERROR',{brainRunId:result.runId,reason:'AI_QUANTITY_EXCEEDS_ENVELOPE',quantityUnits,maxQuantityUnits:sideEnvelope.maxQuantityUnits,direction:side},symbol);this.reject(symbol,'AI_QUANTITY_EXCEEDS_ENVELOPE',result.runId,d.tradeSide??undefined);return;}
      // The floor is stated by the envelope and enforced here with the same numbers: a quantity that cannot
      // legally be filled is refused by name, never rounded up or clamped into an order.
      if(quantityUnits<Number(sideEnvelope.minQuantityUnits??1)){this.events.publish('AI_SIZING_ERROR',{brainRunId:result.runId,reason:'AI_QUANTITY_BELOW_ENVELOPE',quantityUnits,minQuantityUnits:Number(sideEnvelope.minQuantityUnits??1),maxQuantityUnits:sideEnvelope.maxQuantityUnits,legalQuantityRangeUnits:sideEnvelope.legalQuantityRangeUnits??null,minimumLegalNotionalUsd:sideEnvelope.minimumLegalNotionalUsd??null,direction:side},symbol);this.reject(symbol,'AI_QUANTITY_BELOW_ENVELOPE',result.runId,d.tradeSide??undefined);return;}
      const plan=materializeAiQuantityAllocation({state:this.state,candidate,snapshot:market,side,quantityUnits,authorizationMaxPrice:d.acceptablePriceRange.max,envelope:executionEnvelope});
      const economicAdmission=evaluateEconomicEntryFeasibility({state:this.state,market:this.market,symbol,side,quantityUnits,acceptablePriceRange:{min:Number(d.acceptablePriceRange.min),max:Number(d.acceptablePriceRange.max)},profitTakePlan:d.profitTakePlan,envelope:executionEnvelope});
      this.events.publish('ENTRY_ECONOMIC_ADMISSION_EVALUATED',{brainRunId:result.runId,mode:economicAdmission.mode,passed:economicAdmission.passed,wouldBlock:!economicAdmission.passed,expectedNetProfit:economicAdmission.expectedNetProfit,requiredNetProfit:economicAdmission.requiredNetProfit,reachProbability:economicAdmission.reachProbability,historicalHardMaxMovePercent:economicAdmission.historicalHardMaxMovePercent,targetMovePercent:economicAdmission.targetMovePercent,notionalUsd:economicAdmission.notionalUsd,blockers:economicAdmission.blockers,quantityMutated:false,targetMutated:false},symbol);
      if(economicAdmission.mode==='ENFORCE'&&!economicAdmission.passed){const reason=economicAdmission.blockers[0]??'ECONOMIC_ADMISSION_FAILED';this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'ECONOMIC_ADMISSION',reason,reasons:economicAdmission.blockers,brainRunId:result.runId},symbol);this.recordRiskAdmissionVerdict('ECONOMIC_ADMISSION',reason,economicAdmission.blockers,[],symbol,result.runId,null);this.reject(symbol,reason,result.runId,d.tradeSide??undefined);return;}
      this.state.allocationPlans.set(plan.planId, plan);
      if (plan.admission.startsWith("REJECT_")) {this.events.publish("PORTFOLIO_ADMISSION_REJECTED",{ plan, brainRunId: result.runId },symbol);this.reject(symbol,`PORTFOLIO_${plan.admission}: ${plan.reasons.join(",")}`,result.runId,d.direction);return;}
      // J2: one authoritative portfolio admission decides both the read-only pre-check and the
      // in-transaction claim. Without it there is no route to a reservation at all.
      const admission=(this.state as any).riskAdmission;
      const admissionCandidate={symbol,side,quoteAsset:plan.quoteAsset,notionalUsd:plan.notionalUsd,marginUsd:plan.marginUsd,
        leverage:Number(plan.leverage??0),markPrice:Number(market?.quote?.mark??market?.quote?.last??0),planId:plan.planId,intentId:null};
      if(!admission?.admit||!admission?.gate){
        this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'PORTFOLIO_RISK_ADMISSION',reason:'RISK_ADMISSION_UNPROVEN',reasons:['PORTFOLIO_RISK_ADMISSION_NOT_INSTALLED'],brainRunId:result.runId,allocationPlanId:plan.planId},symbol);
        this.recordRiskAdmissionVerdict('PORTFOLIO_RISK_ADMISSION','RISK_ADMISSION_UNPROVEN',['PORTFOLIO_RISK_ADMISSION_NOT_INSTALLED'],[],symbol,result.runId,plan.planId);
        this.reject(symbol,'RISK_ADMISSION_UNPROVEN',result.runId,d.direction);return;
      }
      const admissionDecision=admission.admit(admissionCandidate,Date.now());
      this.events.publish('PORTFOLIO_RISK_ADMISSION_EVALUATED',{brainRunId:result.runId,allocationPlanId:plan.planId,allowed:admissionDecision.allowed,
        reasons:admissionDecision.reasons,limits:admissionDecision.limits,riskGeneration:admissionDecision.ticket?.riskGeneration??null,
        snapshotHash:admissionDecision.ticket?.snapshotHash??null,factCoverage:admissionDecision.ticket?.coverage??null,
        grossNotionalUsd:admissionDecision.snapshot.grossNotionalUsd,capitalAtRiskUsd:admissionDecision.snapshot.capitalAtRiskUsd,
        drawdownPct:admissionDecision.snapshot.drawdownPct,locked:false},symbol);
      const riskTicket=admissionDecision.ticket;
      if(!admissionDecision.allowed||!riskTicket){
        const reason=admissionDecision.reasons[0]??'PORTFOLIO_ADMISSION_BLOCKED';
        this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'PORTFOLIO_RISK_ADMISSION',reason,reasons:admissionDecision.reasons,limits:admissionDecision.limits,brainRunId:result.runId,allocationPlanId:plan.planId},symbol);
        this.recordRiskAdmissionVerdict('PORTFOLIO_RISK_ADMISSION',reason,admissionDecision.reasons,admissionDecision.limits??[],symbol,result.runId,plan.planId);
        this.reject(symbol,`RISK_${reason}`,result.runId,d.direction);return;
      }
      // The most recent decision is the only one the authoritative first cause may describe: a cycle
      // that gets through admission clears the previous refusal instead of leaving it on screen.
      this.state.lastRiskAdmissionVerdict=null;
      // S06: the plan is assembled from system-generated candidates and written durably before any
      // reservation exists. A plan that cannot be stored must not become an order.
      const intentId=uid('intent'),cycleIdOfIntent=`cycle_entry_${intentId}`;
      const planOutcome=this.buildAndPersistTradePlan({symbol,side,market,d,result,executionEnvelope,admission,allocation:plan,cycleId:cycleIdOfIntent});
      if(!planOutcome.plan){
        this.events.publish('ENTRY_DECISION_BLOCKED',{stage:'TRADE_PLAN',reasons:planOutcome.refusals,warnings:planOutcome.warnings,brainRunId:result.runId},symbol);
        this.reject(symbol,planOutcome.refusals[0]??'TRADE_PLAN_UNPROVEN',result.runId,d.tradeSide??undefined);return;
      }
      const tradePlan=planOutcome.plan;
      this.events.publish('TRADE_PLAN_PERSISTED',{brainRunId:result.runId,planId:tradePlan.planId,planVersion:tradePlan.planVersion,cycleId:tradePlan.cycleId,
        selectedCandidateId:tradePlan.selectedCandidateId,quantityUnits:tradePlan.quantityUnits,targetPrice:tradePlan.targetPrice,
        entryTtlMinutes:tradePlan.entryTtlMinutes,targetHorizonMinutes:tradePlan.targetHorizonMinutes,managementDurationMs:tradePlan.managementDurationMs,
        candidateSetHash:tradePlan.provenance.candidateSetHash,factVersion:tradePlan.provenance.factVersion,riskSnapshotHash:tradePlan.risk?.snapshotHash??null,
        warnings:planOutcome.warnings,reservationCreated:false},symbol);
      const reservation = this.state.reserveEntry({underlying:plan.underlying,quoteAsset:plan.quoteAsset,marginUsd:plan.marginUsd,notionalUsd:plan.notionalUsd,planId:plan.planId,maxPositions:this.state.settings.portfolio.maxPositions,ttlSeconds:this.state.settings.riskGovernance.reservationTtlSeconds,leaseSeconds:this.state.settings.riskGovernance.lockLeaseSeconds,riskGeneration:riskTicket.riskGeneration,riskTicket,admissionCandidate,riskCapitalVersion:String(this.state.runtimeControl.capital.capitalVersion??''),maxConcurrentReservations:this.state.settings.riskGovernance.maxConcurrentReservations});
      if (!reservation.ok) {this.events.publish("ENTRY_DECISION_BLOCKED",{stage:"RESERVATION",reason:reservation.reason,allocationPlanId:plan.planId,planId:tradePlan.planId,cycleId:tradePlan.cycleId,intentId,brainRunId:result.runId},symbol);this.reject(symbol,`RESERVATION_${reservation.reason}`,result.runId,d.direction);return;}
      const reservationId = reservation.reservationId,leverage = plan.leverage,now = Date.now();releaseExecutionLease(this.state,executionLeaseId);executionLeaseId=undefined;
      // The reservation is the first fact that consumes capital, so it is recorded with the whole
      // lineage in one event: without it the funnel could only infer that a plan became a booking.
      this.events.publish('ENTRY_RESERVATION_CREATED',{brainRunId:result.runId,decisionChainId:result.runId,planId:tradePlan.planId,planVersion:tradePlan.planVersion,cycleId:tradePlan.cycleId,
        intentId,reservationId,quoteAsset:plan.quoteAsset,marginUsd:plan.marginUsd,notionalUsd:plan.notionalUsd,riskGeneration:riskTicket.riskGeneration},symbol);
      const intent: EntryIntent = {id:intentId,symbol,side,planId:tradePlan.planId,planVersion:tradePlan.planVersion,planCycleId:tradePlan.cycleId,planWarnings:planOutcome.warnings,confidence:d.confidence,idealPrice:d.idealPrice,acceptablePriceRange:d.acceptablePriceRange,horizonMinutes:d.horizonMinutes,leverage,createdAt:now,aiAuthorizationExpiresAt:now+d.horizonMinutes*60_000,configuredOrderTtlExpiresAt:now+(this.state.settings.entry.nearMarket?.enabled?this.state.settings.entry.nearMarket.ttlSeconds*1000:this.state.settings.entry.absoluteTtlMinutes*60_000),absoluteExpiresAt:Math.min(now+d.horizonMinutes*60_000,now+(this.state.settings.entry.nearMarket?.enabled?this.state.settings.entry.nearMarket.ttlSeconds*1000:this.state.settings.entry.absoluteTtlMinutes*60_000)),packetId:packet.packetId,brainRunId:result.runId,decisionChainId:result.runId,allocationPlan:plan,reservationId,protectionMode:this.state.settings.riskGovernance.protectionMode,profitTakePlan:d.profitTakePlan,economicAdmission:economicAdmission.mode==='OFF'?null:{version:'V3.9.5',mode:economicAdmission.mode,passed:economicAdmission.passed,validatedAt:economicAdmission.validatedAt,expectedNetProfit:economicAdmission.expectedNetProfit,requiredNetProfit:economicAdmission.requiredNetProfit,reachProbability:economicAdmission.reachProbability,historicalHardMaxMovePercent:economicAdmission.historicalHardMaxMovePercent,blockers:economicAdmission.blockers},};
      intent.quantityUnits=Number(d.quantityUnits);intent.executionEnvelope=executionEnvelope;
      const reservationRisk=computeExecutableRiskHeadroom({settings:this.state.settings,equity:Number(this.state.account.equityUsd??0),positions:[...this.state.positions.values()],pendingRiskExposures:collectPendingEntryRiskExposures(this.state,{now,excludeReservationId:reservationId,priorityReservationId:reservationId}),symbol,side,plannedNotional:plan.notionalUsd,expectedAdverseMovePct:Math.max(.001,market.technical['15m'].atrPercent/100),dailyDrawdownPct:Number(this.state.account.riskBaseline?.riskDrawdownPct??0),capital:candidateCapitalFromState(this.state,{symbol,quoteAsset:plan.quoteAsset,leverage,leverageFact:leverageFactOf(leverage),minimumNotionalUsd:Math.max(1,market.quote.minNotional),now}),minimumNotional:Math.max(1,market.quote.minNotional)});
      this.events.publish("LIVE_RISK_ENVELOPE_EVALUATED",{brainRunId:result.runId,allocationPlanId:plan.planId,riskEnvelope:{...reservationRisk,status:reservationRisk.executable&&plan.notionalUsd<=reservationRisk.finalNotional+1e-8?'PASS':reservationRisk.reason,reasons:reservationRisk.blockers}},symbol);
      if (!reservationRisk.executable||plan.notionalUsd>reservationRisk.finalNotional+1e-8) {this.state.releaseEntryReservation(reservationId);const reason=reservationRisk.reason==='PASS'?'FINAL_NOTIONAL_EXCEEDS_HEADROOM':reservationRisk.reason;this.events.publish("ENTRY_DECISION_BLOCKED",{stage:"LIVE_RISK_ENVELOPE",reason,reasons:reservationRisk.blockers,brainRunId:result.runId,decisionChainId:result.runId,allocationPlanId:plan.planId,planId:tradePlan.planId,intentId,reservationId},symbol);this.reject(symbol,`RISK_${reason}:${reservationRisk.blockers.join(",")}`,result.runId,d.direction);return;}
      const maker = nearMarketPrice(intent,market,this.state.settings.entry);
      if (!maker.reachable) {const reason=`UNREACHABLE_MAKER: ${maker.reason}`;this.state.entryIntents.set(intent.id,intent);this.state.attachReservationToIntent(reservationId,intent.id);this.transition(symbol,'WAIT_EXECUTION_RANGE','PLACE_AUTHORIZED_WAITING_REACHABILITY',{runId:result.runId,executionWait:{intentId:intent.id,reservationId,reason,startedAt:Date.now(),expiresAt:intent.aiAuthorizationExpiresAt,acceptablePriceRange:intent.acceptablePriceRange}});this.events.publish('ENTRY_INTENT_CREATED',{intent,normalizedDecision:d.decision,decisionChainId:result.runId},symbol);this.events.publish('ENTRY_EXECUTION_WAITING',{brainRunId:result.runId,intentId:intent.id,reason,allocationPlanId:plan.planId,actual:{bid:market.quote.bid,ask:market.quote.ask,mark:market.quote.mark,makerPrice:maker.price,reachability:maker.reachability},limit:{acceptablePriceRange:intent.acceptablePriceRange,authorizationExpiresAt:intent.aiAuthorizationExpiresAt},acceptablePriceRange:intent.acceptablePriceRange,expiresAt:intent.aiAuthorizationExpiresAt},symbol);return;}
      for (const [id, old] of this.state.entryIntents)if (old.symbol === symbol && ![...this.state.entryOrders.values()].some((order) => order.intentId === id))this.state.entryIntents.delete(id);
      this.state.entryIntents.set(intent.id, intent);this.state.attachReservationToIntent(reservationId, intent.id);this.events.publish("ENTRY_INTENT_CREATED",{intent,normalizedDecision:d.decision,decisionChainId:result.runId},symbol);
      if (this.state.settings.connections.executionMode !== "TESTNET_ENABLED" || !privateAccountFresh(this.state.account)) {const reason=this.state.settings.connections.executionMode !== "TESTNET_ENABLED"?"EXECUTION_MODE_READ_ONLY":this.state.account.status==='READY'?'PRIVATE_DATA_STALE':`PRIVATE_DATA_${this.state.account.status}`;this.state.releaseEntryReservation(reservationId);this.events.publish("ENTRY_ORDER_BLOCKED",{ intentId: intent.id, brainRunId:result.runId,decisionChainId:result.runId,planId:tradePlan.planId,reservationId,stage:'EXECUTION_PERMISSION',reason },symbol);this.cooldown(symbol, reason, 60_000);return;}
      const quantity = Number(intent.quantityUnits)*market.quote.stepSize;
      if(quantity<=0||quantity*maker.price>plan.notionalUsd+1e-8) {this.state.releaseEntryReservation(reservationId);this.events.publish('ENTRY_ORDER_BLOCKED',{intentId:intent.id,planId:tradePlan.planId,reservationId,brainRunId:result.runId,decisionChainId:result.runId,stage:'ORDER',reason:'MINIMUM_SIZE_EXCEEDS_ALLOCATION'},symbol);this.cooldown(symbol,'MINIMUM_SIZE_EXCEEDS_ALLOCATION',60_000);return;}
      try {await this.exchange.setLeverage(symbol, leverage);} catch (error) {const reason=error instanceof Error?error.message:String(error);this.state.releaseEntryReservation(reservationId);this.events.publish("ENTRY_ORDER_BLOCKED",{intentId:intent.id,planId:tradePlan.planId,reservationId,brainRunId:result.runId,decisionChainId:result.runId,reason,stage:"SET_LEVERAGE"},symbol);this.cooldown(symbol, reason, 60_000);return;}
      const order: EntryOrder = {cycleId:(intent as any).planCycleId??`cycle_entry_${intent.id}`,id:`entry_${intent.id}`,clientOrderId:binanceClientOrderIdFactory.stable("ML", intent.id),exchangeOrderId:null,symbol,side:intent.side,quantity,price:maker.price,filledQuantity:0,leverage,status:"NEW",createdAt:now,updatedAt:now,absoluteExpiresAt:intent.absoluteExpiresAt,repriceCount:0,intentId:intent.id,reachability:maker.reachability,reservationId};
      this.state.entryOrders.set(order.id,order);
      try {
        const latest=this.state.snapshots.get(symbol),dataError=entryDataError(latest);if(dataError||Date.now()>=intent.absoluteExpiresAt)throw new Error(`JIT_BLOCKED:${(dataError??'AI_AUTHORIZATION_EXPIRED').replace(/^DATA_ERROR:\s*/,'')}`);if(this.state.runtimeControl.mode!=='RUNNING'||this.state.executionGovernance.mode!=='AUTO_RUNNING'||this.state.settings.connections.executionMode!=='TESTNET_ENABLED')throw new Error('JIT_BLOCKED:EXECUTION_PERMISSION_CHANGED');
        let placed:EntryOrder;
        try{placed=await this.submitExactlyOnce(intent,order);}catch(error){const reason=error instanceof Error?error.message:String(error),beforeTs=latest?.quote.ts??0;if(!reason.includes('-5022'))throw error;await new Promise(resolve=>setTimeout(resolve,150));const refreshed=this.state.snapshots.get(symbol),retryDataError=entryDataError(refreshed),retryMaker=refreshed?nearMarketPrice(intent,refreshed,this.state.settings.entry):null;if(retryDataError||!refreshed||refreshed.quote.ts<=beforeTs||Date.now()>=intent.aiAuthorizationExpiresAt||!retryMaker?.reachable||retryMaker.price<intent.acceptablePriceRange.min||retryMaker.price>intent.acceptablePriceRange.max)throw new Error(`POST_ONLY_RETRY_BLOCKED:${retryDataError??'QUOTE_NOT_REFRESHED_OR_OUTSIDE_AUTHORIZATION'}`);const retryQuantity=Number(intent.quantityUnits)*refreshed.quote.stepSize;if(retryQuantity<=0||retryQuantity*retryMaker.price>plan.notionalUsd+1e-8)throw new Error('POST_ONLY_RETRY_BLOCKED:EXCHANGE_MINIMUM_EXCEEDS_AUTHORIZED_ALLOCATION');this.events.publish('ENTRY_POST_ONLY_RETRY',{brainRunId:result.runId,intentId:intent.id,orderId:order.id,reason:'BINANCE_-5022',from:order.price,to:retryMaker.price,attempt:1},symbol);const retryOrder={...order,quantity:retryQuantity,price:retryMaker.price,status:'NEW' as const,updatedAt:Date.now()};this.state.entryOrders.set(order.id,retryOrder);placed=await this.submitExactlyOnce(intent,retryOrder,'POST_ONLY_REPRICE');}
        this.state.markEntryReservationWorking(reservationId);this.state.entryOrders.set(placed.id, placed);const candidate = this.state.universe.find((x) => x.symbol === symbol);if (candidate) {candidate.eligible = false;candidate.rank = 0;if (!candidate.exclusionReasons.includes("ACTIVE_ENTRY_ORDER"))candidate.exclusionReasons.push("ACTIVE_ENTRY_ORDER");}this.transition(symbol,"ENTRY_WORKING","ENTRY_SUBMITTED",{runId:result.runId});this.state.pool.remove(symbol);this.state.pool.replenish(this.state.universe);this.events.publish("ENTRY_ORDER_CREATED",{order:placed,intent,brainRunId:result.runId,decisionChainId:result.runId},symbol);
      } catch (error) {const reason=error instanceof Error?error.message:String(error);if(reason.startsWith('ENTRY_SUBMISSION_UNKNOWN')||['SUBMITTING','UNKNOWN'].includes(this.state.entryOrders.get(order.id)?.status??'')){this.events.publish('ENTRY_ORDER_SUBMISSION_UNKNOWN',{intentId:intent.id,planId:tradePlan.planId,reservationId,brainRunId:result.runId,orderId:order.id,clientOrderId:order.clientOrderId,reason},symbol);this.transition(symbol,'WAIT_EXECUTION_RANGE','SUBMISSION_UNKNOWN_RECONCILIATION',{runId:result.runId,executionWait:{intentId:intent.id,reservationId,reason,startedAt:Date.now(),expiresAt:intent.aiAuthorizationExpiresAt,acceptablePriceRange:intent.acceptablePriceRange}});return;}const unsent=this.state.entryOrders.get(order.id);if(unsent?.status==='NEW')this.state.entryOrders.set(order.id,{...unsent,status:'REJECTED',factSource:'LOCAL_NOT_SUBMITTED',updatedAt:Date.now()});this.state.releaseEntryReservation(reservationId);this.events.publish("ENTRY_ORDER_BLOCKED",{intentId:intent.id,planId:tradePlan.planId,reservationId,orderId:order.id,clientOrderId:order.clientOrderId,brainRunId:result.runId,decisionChainId:result.runId,reason,stage:reason.startsWith('JIT_BLOCKED:')?'JIT':'BINANCE_SUBMIT'},symbol);this.cooldown(symbol, reason, 60_000);}
    } catch (error) {
      this.analysisFacts.lastFailureAt=Date.now();
      const reason = error instanceof Error ? error.message : String(error);
      this.analysisFacts.lastBlockedReason=reason;
      if(reason.startsWith('EIP_EVIDENCE_STALE')){this.events.publish('PRIMARY_DATA_ERROR',{stage:'EIP_STALE',reason,entryIntentCreated:false},symbol);this.cooldown(symbol,'EIP_STALE',this.aiFailureCooldownSeconds(),'TECHNICAL_COOLDOWN');return;}
      this.events.publish("ENTRY_ANALYSIS_FAILED",{ runId:terminalRunId??(error as any)?.runId,message: reason, intentCreated:terminalRunId?[...this.state.entryIntents.values()].some(x=>x.brainRunId===terminalRunId):false, policy: 'FAIL_CLOSED' },symbol);this.cooldown(symbol, reason, this.aiFailureCooldownSeconds(), "AI_FAILURE_COOLDOWN");
    } finally {
      releaseExecutionLease(this.state,executionLeaseId);
      this.active.delete(symbol);
      if(['PRIMARY_QUEUED','PRIMARY_RUNNING','PRIMARY_COMPLETED'].includes(this.state.candidateLifecycle.get(symbol)?.status)) {this.transition(symbol,'READY','ANALYSIS_LEASE_RELEASED');this.state.pool.markReady(symbol);}
    }
  }
  private lifecycleRunnable(symbol:string){
    if([...this.state.manualExitGoals.values()].some(g=>resolveUnderlying(g.symbol)===resolveUnderlying(symbol)))return false;
    const row=this.state.candidateLifecycle.get(symbol);
    if(!row||row.status!=='READY')return !row;
    if(!row.decisionContextKey)return true;
    const current=this.currentDecisionContext(symbol,row.confirmation);
    if(row.decisionContextKey===current)return false;
    if(row.confirmation)return true;
    if(row.noEdgeReview){const market=this.state.snapshots.get(symbol);if(!market)return false;const release=noEdgeReleaseReason(row.noEdgeReview,noEdgeReviewFacts({market,...this.routeCapabilities(symbol)}));if(!release)return false;row.triggerReason=release;return true;}
    const prior=decisionContextPermissions(row.decisionContextKey),next=decisionContextPermissions(current);
    if(prior.longExecutable!==next.longExecutable||prior.shortExecutable!==next.shortExecutable)return true;
    return !row.nextReviewAt||Date.now()>=row.nextReviewAt;
  }

  /** The facts a plan was computed from, so a reviewer can tell a re-plan from a replay. */
  private planFactVersion(symbol:string,side:'LONG'|'SHORT'|'WAIT',riskSnapshotHash:string,envelopeExpiresAt:number){
    const market=this.state.snapshots.get(symbol) as any,card=market?.technical?.['15m'];
    return planFactVersionOf({symbol,side,quote:{bid:market?.quote?.bid??null,ask:market?.quote?.ask??null,ts:market?.quote?.ts??null},
      bar:card?.isClosed===true?{closeTime:card?.barCloseTime??null,close:card?.lastClosedBar?.close??null}:null,
      riskSnapshotHash,envelopeExpiresAt,settingsVersion:Number((this.state.settings as any).settingsVersion??0),
      marginTier:String((this.state.settings.riskGovernance as any)?.portfolioRisk?.marginTierVersion??'')});
  }

  private planScopeOf(symbol:string,side:'LONG'|'SHORT'|'WAIT'){
    const exchange=this.state.settings.connections.exchange;
    return executionScope(String(exchange.environment),String(exchange.credentialRef),symbol,side==='WAIT'?'ENTRY':side);
  }

  /** Evidence is resolved against the market hub; an unusable reference is reported, never dropped. */
  private evaluatePlanEvidenceRefs(refs:string[],symbol:string,now:number){
    const facts:{symbol:string;timeframe:string;isClosed:boolean;barCloseTime:number;maxAgeMs:number;appliesToSymbol:string}[]=[];
    const windows:{[key:string]:number}={'1m':90_000,'5m':360_000,'15m':1_805_000,'1h':5*3_600_000,'4h':18*3_600_000};
    for(const timeframe of Object.keys(windows)){
      const rows=(this.market?.cachedCandles?.(symbol,timeframe as never,4)??[]) as any[];
      const last=rows[rows.length-1];
      if(last&&Number.isFinite(Number(last.closeTime)))
        facts.push({symbol,timeframe,isClosed:Number(last.closeTime)<=now,barCloseTime:Number(last.closeTime),maxAgeMs:windows[timeframe],appliesToSymbol:symbol});
    }
    return refs.map(ref=>{
      const text=String(ref).trim(),match=/^(?:bar|struct|ev|15m|5m|1h)[:_\-]?([A-Z0-9]*)[:_\-]?([0-9]+)?/i.exec(text);
      const refSymbol=(match?.[1]??'').toUpperCase();
      if(refSymbol&&refSymbol!==symbol.toUpperCase().replace(/(USDT|USDC|BUSD)$/,'')&&refSymbol!==symbol.toUpperCase())
        return {ref,reason:`PLAN_EVIDENCE_SYMBOL_MISMATCH:${refSymbol}`};
      const timeframe=/1h|60m/i.test(text)?'1h':/4h/i.test(text)?'4h':/5m/i.test(text)?'5m':/1m/i.test(text)?'1m':'15m';
      const fact=facts.find(row=>row.timeframe===timeframe);
      if(!fact)return {ref,reason:'PLAN_EVIDENCE_TIMEFRAME_MISSING'};
      if(!fact.isClosed)return {ref,reason:'PLAN_EVIDENCE_BAR_NOT_CLOSED'};
      if(now-fact.barCloseTime>fact.maxAgeMs)return {ref,reason:'PLAN_EVIDENCE_STALE'};
      return {ref,reason:''};
    });
  }

  private completeReadOnlyAnalysis(input:{symbol:string;d:any;result:any;executionEnvelope:any}){
    const admission=(this.state as any).riskAdmission;
    const observation=admission?.observe?.()??{allowed:false,reasons:['PORTFOLIO_RISK_ADMISSION_NOT_INSTALLED'],scope:'CURRENT_BOOK'};
    this.events.publish('PORTFOLIO_RISK_ADMISSION_EVALUATED',{...observation,brainRunId:input.result.runId,analysisOnly:true,locked:false},input.symbol);
    // The model output stays in its immutable run. A system WAIT records the independent write lock,
    // not a fabricated model PLACE/WAIT and not a reservation or ownership claim.
    const reasons=['EXCHANGE_WRITE_LOCKED',...observation.reasons];
    this.persistWaitPlan({...input,side:input.d.tradeSide==='SHORT'?'SHORT':'LONG',systemWait:true,
      factVersion:planFactVersionOf({runId:input.result.runId,observation,settingsVersion:(this.state.settings as any).settingsVersion}),
      d:{...input.d,reason:`Model ${input.d.decision}: ${input.d.reason??''}`,releaseCondition:reasons.join('|'),blockingCondition:'SYSTEM_ANALYSIS_ONLY'}});
    this.analysisFacts.lastBlockedReason='EXCHANGE_WRITE_LOCKED';
    this.events.publish('ANALYSIS_ONLY_COMPLETED',{brainRunId:input.result.runId,modelDecision:input.d.decision,reasons,reservationCreated:false,orderCreated:false},input.symbol);
  }

  private buildAndPersistTradePlan(input:{symbol:string;side:'LONG'|'SHORT';market:any;d:any;result:any;executionEnvelope:any;admission:any;allocation:any;cycleId:string}){
    const now=Date.now(),warnings:string[]=[],settings=this.state.settings as any;
    const facts=input.admission?.preTradeFacts?.(now);
    if(!facts||facts.complete!==true)return{plan:null,refusals:[...((facts?.blockers??['RISK_SNAPSHOT_UNPROVEN']) as string[])].slice(0,8),warnings};
    const sideEnvelope=input.executionEnvelope[input.side],quote=input.market?.quote??{};
    const candidateSet=buildQuantityHorizonCandidates({
      symbol:input.symbol,side:input.side,now,
      quote:{bid:Number(quote.bid),ask:Number(quote.ask),tickSize:Number(quote.tickSize),stepSize:Number(quote.stepSize),
        minQty:Number(quote.minQty),minNotional:Number(quote.minNotional)},
      leverage:Number(input.executionEnvelope.leverage??0),envelope:sideEnvelope,envelopeExpiresAt:Number(input.executionEnvelope.expiresAt??now),
      factVersion:String(this.planFactVersion(input.symbol,input.side,String(facts.snapshotHash),Number(input.executionEnvelope.expiresAt??now))),
      risk:{capitalAtRiskUsd:Number(facts.capitalAtRiskUsd),grossNotionalAfterUsd:Number(facts.grossNotionalUsd),longNotionalAfterUsd:Number(facts.longNotionalUsd),
        shortNotionalAfterUsd:Number(facts.shortNotionalUsd),clusterNotionalAfterUsd:Number(facts.clusterNotionalUsd),
        limitingConstraints:(input.allocation?.reasons??[]).filter((row:string)=>String(row).startsWith('REJECT_')),riskGeneration:Number(facts.riskGeneration),
        snapshotHash:String(facts.snapshotHash),profileVersion:String(facts.profileVersion),humanSlotsAfter:Number(facts.humanSlots)},
      settings:{takeProfit:settings.takeProfit,tradeEconomics:settings.tradeEconomics} as never,
      candles:(timeframe:string,count:number)=>(this.market?.cachedCandles?.(input.symbol,timeframe as never,count)??[]) as never,
      managementDurationMs:Math.max(60_000,Number(settings.positionManagement?.humanHandoffAfterMinutes??0)*60_000),
      fundingEstimate:{amountUsd:null,status:'UNPROVEN' as const,sourceId:null},
      // The model's own triple is handed to the generator, which decides whether it is legal at all.
      selection:{quantityUnits:Number(input.d.quantityUnits??0),targetPrice:Number(input.d.profitTakePlan?.targetPrice??0),
        targetHorizonMinutes:Number(input.d.profitTakePlan?.targetHorizonMinutes??0)},
    });
    const refs=[...(input.d.profitTakePlan?.evidenceRefs??[]),...(input.d.supportingEvidenceRefs??[])].map(String);
    const evidence=this.evaluatePlanEvidenceRefs(refs,input.symbol,now);
    const usable=evidence.filter(row=>!row.reason).map(row=>row.ref);
    warnings.push(...evidence.filter(row=>row.reason).map(row=>`${row.reason}:${row.ref}`));
    if(!usable.length)warnings.push('PLAN_EVIDENCE_UNRESOLVED');
    const enforce=String(settings.tradeEconomics?.admissionMode??'OFF')==='ENFORCE';
    if(enforce&&!usable.length)return{plan:null,refusals:['PLAN_EVIDENCE_UNRESOLVED'],warnings};
    const level=input.side==='LONG'?Number(input.d.acceptablePriceRange?.min??0):Number(input.d.acceptablePriceRange?.max??0);
    const outcome=assembleTradePlan({
      selection:{decision:input.d.decision,side:input.side,quantityUnits:Number(input.d.quantityUnits??0),
        targetPrice:Number(input.d.profitTakePlan?.targetPrice??Number.NaN),targetHorizonMinutes:Number(input.d.profitTakePlan?.targetHorizonMinutes??0),
        horizonMinutes:Number(input.d.horizonMinutes??0),thesis:[input.d.directionReason,input.d.reason].filter(Boolean).join(' / ')||null,
        invalidationPredicate:level>0&&usable.length?'CLOSED_BAR_BREAKS_LEVEL':'NO_PREDICATE',
        predicateLevel:level>0?level:null,predicateEvidenceRefs:usable,counterEvidenceRefs:(input.d.missingEvidence??[]).map(String),
        releaseCondition:null,modelRunId:input.result?.runId??null,promptVersion:input.result?.promptVersion??null,modelConfidence:Number(input.d.confidence??Number.NaN)},
      candidateSet,scope:this.planScopeOf(input.symbol,input.side),cycleId:input.cycleId,symbol:input.symbol,
      leverage:Number(input.executionEnvelope.leverage??0),minNetProfitUsd:Number(settings.takeProfit.minNetProfitUsd??0),
      maxRealizedLossUsd:Number(settings.riskGovernance?.exitCoordination?.aiExitLossLimitUsd??0),factVersion:candidateSet.factVersion,now,
      planVersion:this.state.plansForCycle(input.cycleId).length+1,source:'AI',
    });
    if(!outcome.plan)return{plan:null,refusals:outcome.refusals,warnings:[...warnings,...outcome.warnings]};
    const stored=this.state.putTradePlan(outcome.plan);
    if(!stored.written&&!stored.identical)return{plan:null,refusals:[String(stored.reason??'PLAN_PERSISTENCE_FAILED')],warnings};
    if(stored.identical)warnings.push('PLAN_ALREADY_PERSISTED_FOR_IDENTICAL_FACTS');
    return{plan:outcome.plan,refusals:[] as string[],warnings:[...warnings,...outcome.warnings]};
  }

  /** A WAIT leaves an auditable plan behind and nothing else: no reservation, no intent, no order. */
  private persistWaitPlan(input:{symbol:string;side:'LONG'|'SHORT';d:any;result:any;executionEnvelope:any;systemWait?:boolean;factVersion?:string}){
    const now=Date.now(),settings=this.state.settings as any,cycleId=`cycle_wait_${input.result?.runId??now}`;
    const release=[input.d.releaseCondition,input.d.waitCondition?`${input.d.waitCondition.operator} ${input.d.waitCondition.price}`:null].filter(Boolean).join(' / ');
    const outcome=assembleTradePlan({
      selection:{decision:'WAIT',side:'WAIT',thesis:[input.d.blockingCondition,input.d.reason].filter(Boolean).join(' / ')||null,
        invalidationPredicate:'NO_PREDICATE',predicateEvidenceRefs:[],counterEvidenceRefs:(input.d.missingEvidence??[]).map(String),
        releaseCondition:release||null,modelRunId:input.result?.runId??null,promptVersion:input.result?.promptVersion??null,
        modelConfidence:Number(input.d.confidence??Number.NaN),quantityUnits:0,targetPrice:null,targetHorizonMinutes:0},
      candidateSet:{schemaVersion:'V396-PLAN-CANDIDATE-SET-1',symbol:input.symbol,side:input.side,createdAt:now,
        expiresAt:Math.max(now+1,Number(input.executionEnvelope?.expiresAt??now)),factVersion:input.factVersion??'wait',candidateSetHash:input.factVersion??'wait',candidates:[],
        noTradeReasons:[String(input.d.decision)],quantityLadder:[],horizonLadder:[],rejectedCombinations:0},
      scope:this.planScopeOf(input.symbol,'WAIT'),cycleId,symbol:input.symbol,leverage:Number(input.executionEnvelope?.leverage??1),
      minNetProfitUsd:Number(settings.takeProfit.minNetProfitUsd??0),maxRealizedLossUsd:Number(settings.riskGovernance?.exitCoordination?.aiExitLossLimitUsd??0),
      factVersion:input.factVersion??'wait',now,planVersion:this.state.plansForCycle(cycleId).length+1,source:input.systemWait?'SYSTEM':'AI',
    });
    if(!outcome.plan){this.events.publish('TRADE_PLAN_WAIT_REFUSED',{brainRunId:input.result?.runId??null,reasons:outcome.refusals},input.symbol);return null;}
    const stored=this.state.putTradePlan(outcome.plan);
    if(!stored.written&&!stored.identical)throw new Error('ANALYSIS_PLAN_PERSISTENCE_FAILED');
    this.events.publish('TRADE_PLAN_PERSISTED',{brainRunId:input.result?.runId??null,planId:outcome.plan.planId,planVersion:outcome.plan.planVersion,cycleId,
      side:'WAIT',quantityUnits:0,reservationCreated:false,written:stored.written,releaseCondition:outcome.plan.releaseCondition},input.symbol);
    return outcome.plan;
  }

  private routeCapabilities(symbol:string){const route=this.state.runtimeControl.capital.routedCandidates.find((x:any)=>x.symbol===symbol);return{longExecutable:Boolean(route?.longExecutable),shortExecutable:Boolean(route?.shortExecutable)};}
  private currentDecisionContext(symbol:string,confirmation?:unknown){const market=this.state.snapshots.get(symbol);if(!market)return'MARKET_MISSING';return decisionContextKey({market,settingsContext:decisionSettingsContext(this.state.settings),confirmation,...this.routeCapabilities(symbol)});}
  private transition(symbol:string,status:string,reason:string,extra:Record<string,unknown>={}){const now=Date.now(),previous=this.state.candidateLifecycle.get(symbol),primaryLease=['PRIMARY_QUEUED','PRIMARY_RUNNING'].includes(status),runReset=primaryLease&&!Object.prototype.hasOwnProperty.call(extra,'runId')?{previousRunId:previous?.runId??previous?.previousRunId??null,runId:null}:{},next={...previous,...runReset,...extra,symbol,status,reason,triggerReason:status==='READY'?String(extra.triggerReason??reason):String(extra.triggerReason??previous?.triggerReason??(previous?.reason&&previous.reason!=='SCHEDULER_DISPATCH'?previous.reason:'FIRST_REVIEW')),updatedAt:now,from:previous?.status??null};this.state.candidateLifecycle.set(symbol,next);const candidate=this.state.universe.find((x:any)=>x.symbol===symbol);if(candidate){candidate.lifecycle=status;candidate.lifecycleReason=reason;candidate.nextEligibleAt=next.nextEligibleAt??null;candidate.pipelineEligible=isPipelineRoutableLifecycle(status);}this.events.publish('CANDIDATE_LIFECYCLE_CHANGED',next,symbol);return next;}
  private aiFailureCooldownSeconds(){return (this.state.settings.ai.highFrequency?.retryCooldownSeconds??25)*1000;}
  private async waitForPrimary(symbol:string){this.primaryWaiters.add(symbol);try{while(!this.ai.hasCapacity('PRIMARY_BRAIN')){if(this.ai.isCircuitOpen('PRIMARY_BRAIN'))throw new Error('AI_PRIMARY_CIRCUIT_OPEN');await new Promise(resolve=>setTimeout(resolve,100));}}finally{this.primaryWaiters.delete(symbol);}}
  private cooldown(symbol: string, reason: string, duration: number, lifecycle:string="TECHNICAL_COOLDOWN",extra:Record<string,unknown>={}) {const candidate = this.state.universe.find((x) => x.symbol === symbol),now = Date.now();const previous=this.state.candidateLifecycle.get(symbol),failureCount=lifecycle==='AI_FAILURE_COOLDOWN'?(Number(previous?.failureCount??0)+1):0,quarantineAfter=this.state.settings.ai.highFrequency?.quarantineAfterFailures??3,status=lifecycle==='AI_FAILURE_COOLDOWN'&&failureCount>=quarantineAfter?'QUARANTINED':lifecycle,finalDuration=status==='QUARANTINED'?(this.state.settings.ai.highFrequency?.quarantineSeconds??300)*1000:duration;this.state.rejectionCooldown.set(symbol,{until:now+finalDuration,reason,rank:candidate?.rank??9999,at:now});const snapshot=this.state.snapshots.get(symbol),fingerprint=JSON.stringify({trend:snapshot?.technical?.['15m']?.trend,atr:Math.round((snapshot?.quote?.last??0)/Math.max(.0000001,snapshot?.technical?.['15m']?.atr14??1)),spread:Math.round(candidate?.spreadBps??0)});this.transition(symbol,status,reason,{nextEligibleAt:now+finalDuration,failureCount,fingerprint,...extra});this.state.pool.remove(symbol,"REJECTED");this.state.pool.replenish(this.state.universe);}
  private reject(symbol:string,reason:string,brainRunId?:string,direction?:"LONG"|"SHORT") {const now=Date.now(),until=now+(this.state.settings.ai.highFrequency?.retryCooldownSeconds??25)*1000;this.cooldown(symbol,reason,until-now,"REJECT_COOLDOWN");this.events.publish("CANDIDATE_REJECTED",{reason,cooldownUntil:until,brainRunId,direction,decision:"REJECT_CANDIDATE",entryIntentCreated:false},symbol);}
  /**
   * Problem A: remember *which* deterministic admission decision stopped the most recent Entry cycle, so
   * the authoritative first cause can name it instead of reporting a healthy pipeline. Only the two
   * admission gates that refuse new risk write this, and only a cycle that passes them clears it.
   */
  private recordRiskAdmissionVerdict(stage:string,code:string,reasons:string[],limits:string[],symbol:string,brainRunId:string|null,allocationPlanId:string|null){
    this.state.lastRiskAdmissionVerdict={at:Date.now(),symbol,stage,code,reasons:[...new Set((reasons??[]).map(String))].slice(0,12),
      limits:(limits??[]).map(String).slice(0,12),brainRunId,allocationPlanId};
  }
  /** The current risk-admission refusal, or null once it is no longer the newest word on Entry. */
  riskAdmissionVerdict(now:number,ttlMs=RISK_ADMISSION_VERDICT_TTL_MS){
    const verdict=this.state.lastRiskAdmissionVerdict;
    if(!verdict||!Number.isFinite(Number(verdict.at))||now-Number(verdict.at)>ttlMs)return null;
    return {...verdict,ageMs:now-Number(verdict.at)};
  }
  private reviewBusy=false;
  async reviewPending() {
    const now=Date.now(),policy=this.state.settings.entry.nearMarket,interval=(policy?.enabled?policy.reviewSeconds:this.state.settings.entry.reviewIntervalSeconds)*1000;if(this.reviewBusy||now-this.lastReview<interval)return;this.reviewBusy=true;this.lastReview=now;
     try{for(const [id,initial] of this.state.entryOrders){if(!activeOrderStatus(initial.status))continue;let order=initial;try{if(['UNKNOWN','NEW','SUBMITTING'].includes(order.status)){if(remoteFactAuditDeferred(order,now))continue;const verified=await this.exchange.findEntryByClientOrderId(order);if(!verified){this.state.entryOrders.set(id,{...order,status:'UNKNOWN'});continue;}order={...order,...verified,id:order.id,intentId:order.intentId,createdAt:order.createdAt,absoluteExpiresAt:order.absoluteExpiresAt};this.state.entryOrders.set(id,order);if(terminalOrderStatus(order.status)){if(order.reservationId)this.state.releaseEntryReservation(order.reservationId);reconcileCandidateLifecycles(this.state,this.events,'EXACT_ORDER_TERMINAL');continue;}}const deadline=policy?.enabled?Math.min(order.absoluteExpiresAt,order.createdAt+Math.min(120,policy.ttlSeconds)*1000):order.absoluteExpiresAt;if(now>=deadline){const canceled=await this.exchange.cancelEntry(order),confirmed=terminalOrderStatus(canceled.status),saved:EntryOrder={...order,...canceled,status:confirmed?canceled.status:'UNKNOWN',exchangeTerminalStatus:confirmed?canceled.status:'UNKNOWN',activeRiskExposure:!confirmed,activeRiskEvidence:null,createdAt:order.createdAt,absoluteExpiresAt:order.absoluteExpiresAt} as any;this.state.entryOrders.set(id,saved);if(order.reservationId){if(confirmed)this.state.releaseEntryReservation(order.reservationId);else{this.state.markEntryReservationWorking(order.reservationId);}}if(confirmed)reconcileCandidateLifecycles(this.state,this.events,'ENTRY_TTL_TERMINAL_CONFIRMED');this.events.publish(confirmed?'ENTRY_ORDER_TTL_CLOSED':'ENTRY_CANCEL_UNVERIFIED',{orderId:id,status:saved.status,exchangeTerminalStatus:confirmed?canceled.status:'UNKNOWN',filledQuantity:canceled.filledQuantity,occupancyReleased:confirmed,reason:'ABSOLUTE_TTL'},order.symbol);continue;}const intent=this.state.entryIntents.get(order.intentId),market=this.state.snapshots.get(order.symbol);if(!intent)continue;if(!market||entryDataError(market))continue;const max=policy?.enabled?policy.maxReprices:this.state.settings.entry.maxReprices;if(order.repriceCount>=max||now-order.updatedAt<(policy?.repriceIntervalSeconds??5)*1000)continue;const next=nearMarketPrice(intent,market,this.state.settings.entry,now);if(!next.reachable)continue;if(Math.abs(next.price-order.price)>=market.quote.tickSize*2){const nextQuantity=Number(intent.quantityUnits)*market.quote.stepSize,candidateOrder={...order,quantity:nextQuantity,price:next.price};if(nextQuantity<=0||this.executionHardBlock(intent,candidateOrder)){this.events.publish('ENTRY_ORDER_REPRICE_BLOCKED',{orderId:id,from:order.price,to:next.price,reason:'FINAL_ORDER_RISK_OR_EXCHANGE_FILTER'},order.symbol);continue;}const replaced=await this.exchange.replaceEntry(candidateOrder,next.price);this.state.entryOrders.set(id,{...replaced,id:order.id,intentId:order.intentId,reservationId:order.reservationId,createdAt:order.createdAt,absoluteExpiresAt:order.absoluteExpiresAt,repriceCount:Math.max(order.repriceCount+1,replaced.repriceCount),reachability:next.reachability});this.events.publish('ENTRY_ORDER_REPRICED',{orderId:id,from:order.price,to:next.price,reason:next.reason},order.symbol);}}catch(error){this.state.entryOrders.set(id,{...order,status:'UNKNOWN',updatedAt:Date.now()});this.events.publish('ENTRY_ORDER_MANAGEMENT_UNVERIFIED',{orderId:id,reason:String(error),occupancyReleased:false},order.symbol);}}}finally{this.reviewBusy=false;}
  }
}

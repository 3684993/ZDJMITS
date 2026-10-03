import { resolveQuoteAsset, testnetFundsOnlyEntry } from '@zdj/core';
import type {TradingQualityRuntimeObserver} from '../services/tradingQualityRuntimeObserver.js';
import { TradingQualityCollector } from '../services/tradingQualityCollector.js';
import { privateAccountFresh } from '../services/privateAccountReadiness.js';
import { portfolioCapacityVisibility } from '../services/riskReadiness.js';
import { bookAdmissionSummary } from '../services/admissionCapacityReader.js';
import { entrySideCapacityTraces } from '../services/entryCapacityTrace.js';
import { entryTradingCapital } from '../services/capitalCapacity.js';
import { executionReadiness } from '../services/executionReadiness.js';
import { PrivateAccountSync } from '../services/privateAccountSync.js';
import { recoverUnsubmittedEntry } from '../services/unsubmittedEntryRecovery.js';
import {RuntimeWriteBuffer} from '../services/runtimeWriteBuffer.js';
import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { RuntimeState } from "../state/runtimeState.js";
import { EventBus } from "../events/eventBus.js";
import { SettingsStore } from "../config/settingsStore.js";
import { loadAiResources } from "../config/aiResourceLoader.js";
import { BinancePublicMarketDataProvider } from "../adapters/market/BinancePublicMarketDataProvider.js";
import { ExternalTradeAdapter } from "../adapters/exchange/ExternalTradeAdapter.js";
import { MarketDataHub } from "../services/marketDataHub.js";
import { UniverseCoordinator } from "../services/universeCoordinator.js";
import { buildSupplyHealth } from '../services/supplyHealth.js';
import { ExperienceService } from "../services/experienceService.js";
import { EipService } from "../services/eipService.js";
import { AiFabric } from "../services/aiFabric.js";
import { EntryCoordinator } from "../services/entryCoordinator.js";
import { PositionService } from "../services/positionService.js";
import { TpGuardian } from "../services/tpGuardian.js";
import { primaryBrainHealth } from "../services/aiResourceHealth.js";
import { primaryObservation } from "../services/s01TruthAccountingObservability.js";
import { ExchangeLoop } from "../services/exchangeLoop.js";
import { ReconciliationService } from "../services/reconciliationService.js";
import { BinanceTransport, verifyBinanceTransportEgress } from "../adapters/binance/BinanceTransport.js";
import type { ExchangeTradeAdapter, TradeAuditSnapshot } from "../types.js";
import { ManualPositionService } from "../services/manualPositionService.js";
import { TradeRecordIntegrityService } from "../services/tradeRecordIntegrityService.js";
import { TradeRecordSyncService } from "../services/tradeRecordSyncService.js";
import { RuntimeControlService } from "../services/runtimeControlService.js";
import { ShadowRunner } from "../services/shadowRunner.js";
import { ShadowReadinessService } from "../services/shadowReadiness.js";
import { TestnetLowLossCleanupService } from "../services/testnetLowLossCleanupService.js";
import { currentLanIps, type RuntimeIdentity } from "./runtimeIdentity.js";
import { entryFundingEligibleSymbol, RELEASE_VERSION, type Position, type TradePlan } from "@zdj/contracts";
import { TemporalIntelligenceService } from "../services/temporalIntelligenceService.js";
import { LiveValidationService } from "../services/liveValidationService.js";
import {ExternalIntelligenceService} from "../services/externalIntelligenceService.js";
import {ExternalResearchService} from "../services/externalResearchService.js";
import { AssetGovernanceCoordinator } from '../services/assetGovernanceCoordinator.js';
import { ProductionAssetResearchService } from '../services/productionAssetResearch.js';
import { MarketCohort } from '../services/marketCohort.js';
import { marketDataIsolation, marketDataStaleReason } from '../services/marketDataStaleness.js';
import { authoritativePipelineVerdict } from '../services/pipelineVerdict.js';
import { LossHandoffService } from '../services/lossHandoff.js';
import { attachOwnershipRuntime, type OwnershipRuntime } from '../services/ownershipRuntime.js';
import { V396ExitRuntime, exitSubjectFromPosition } from '../services/v396ExitRuntime.js';
import { accountCycle, cycleFills } from '../services/cycleAccounting.js';
import { FundingIncomeLedger, cycleFundingFact } from '../services/fundingIncomeLedger.js';
import { V396AiExitRunner } from '../services/v396AiExitRunner.js';
import { AiExitAuthorityService } from '../services/aiExitAuthority.js';
import { PortfolioRiskAdmission } from '../services/portfolioRiskLedger.js';
import { canonicalizeMarginBrackets, portfolioRiskAuthorityCompile, type PortfolioRiskAuthorityFacts } from '../services/portfolioRiskAuthority.js';
import { applyGovernancePatch, governanceFieldOf, PORTFOLIO_RISK } from '../config/governanceSettingsMatrix.js';
import { aiExitPlanFactsOf, executedPlanRecord } from '../services/tradePlanService.js';
import { AiUsageLedger, aiUsageRowOf } from '../services/aiUsageLedger.js';
import { PositionReviewScheduler, type ReviewTicket } from '../services/positionReviewScheduler.js';
import { PositionReviewRunner, type ReviewAnswer, type ReviewTickReport } from '../services/positionReviewRunner.js';
import { reviewMemoryFor, tradeMemoryVersionOf } from '../services/tradeMemoryService.js';
import type { PositionReviewRequest } from '../services/positionReviewPrompt.js';
import { isPipelineRoutableLifecycle } from '../services/candidateLifecycleDeriver.js';
import { ENTRY_CONVERSION_EVENT_TYPES, entryConversionReport } from '../services/runExecutionOutcome.js';

/**
 * How many margin brackets one authority commit is allowed to price. Each read weighs 30 against a
 * 6,000-per-minute Testnet budget and the collector runs four at a time, so 96 rows (~2,880 weight) is
 * the most a single explicit commit should spend. Past it a commit is refused by name — the alternative
 * is truncation, and truncation is what made real candidates unpriceable in the first place.
 */
const MARGIN_AUTHORITY_COVERAGE_CEILING = 96;

export class EngineRuntime {
  readonly writes=new RuntimeWriteBuffer();
  readonly state!: RuntimeState;
  readonly settingsStore!: SettingsStore;
  readonly market!: MarketDataHub;
  readonly universe!: UniverseCoordinator;
  readonly experience!: ExperienceService;
  readonly eip!: EipService;
  readonly ai!: AiFabric;
  readonly entry!: EntryCoordinator;
  readonly positions!: PositionService;
  readonly tp!: TpGuardian;
  readonly exchangeLoop!: ExchangeLoop;
  readonly reconciliation!: ReconciliationService;
  readonly manual!: ManualPositionService;
  readonly tradeRecordIntegrity!: TradeRecordIntegrityService;
  readonly runtimeControl!: RuntimeControlService;
  readonly shadow!: ShadowRunner;
  shadowReadiness!: ShadowReadinessService;
  cleanup!: TestnetLowLossCleanupService;
  temporal!: TemporalIntelligenceService;
  liveValidation!: LiveValidationService;
  externalIntelligence!: ExternalIntelligenceService;
  externalResearch!: ExternalResearchService;
  assetGovernance!: AssetGovernanceCoordinator;
  cohort!: MarketCohort;
  lossHandoff!: LossHandoffService
  ownership?: OwnershipRuntime;  exitRuntime?: V396ExitRuntime;  fundingIncome?: FundingIncomeLedger | null;  aiExitAuthority?: AiExitAuthorityService;  aiExitRunner?: V396AiExitRunner;
  portfolioRisk?: PortfolioRiskAdmission;
  aiUsage?: AiUsageLedger;
  positionReviewScheduler?: PositionReviewScheduler;
  positionReviewRunner?: PositionReviewRunner;
  /** What the last review pass actually did, for the operator readback. Never a claimed intention. */
  reviewTickReport:ReviewTickReport|null=null;
  cashFlowFacts: () => Array<{ id: string; amountUsd: number; factStatus: 'VERIFIED' }> = () => [];
  refreshCashFlowFacts: (now?: number) => Promise<{ rows: number; complete?: boolean; asOf: number } | null> = async () => null;
  /**
   * The durable PortfolioRisk authority this process last verified, plus any bracket drift it has
   * observed. Drift is a diagnosis only: a fresh collection can never replace these facts, because
   * only an explicit operator commit decides which dataset the account trades against.
   */
  portfolioRiskAuthority: {
    facts: PortfolioRiskAuthorityFacts | null; reasons: string[]; loadedAt: number; staleObservedContentHash: string | null;
  } = { facts: null, reasons: ['AUTHORITY_NOT_LOADED'], loadedAt: 0, staleObservedContentHash: null };
  /** The last drift inspection this process ran, for the operator readback. A diagnosis, never authority. */
  portfolioRiskAuthorityDriftReport: {status: string; reasons?: string[]; committedMarginTierVersion?: string; observedMarginTierVersion?: string; inspectedAt: number} | null = null;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private ready = false;
  public qualityObserver:TradingQualityRuntimeObserver|null=null;
  public tradingQuality: TradingQualityCollector | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private trade: ExternalTradeAdapter | null = null;
  /** The last funding-income pass, so an empty ledger can be told apart from a reader that never ran. */
  private lastFundingSync: {at:number|null;rows:number;failures:number;symbolsScanned:number;skipped:string|null} | null = null;
  /** Why the continuous exit-convergence walk did or did not poll on its last turn. */
  private convergenceGate: {at?:number;reason?:string;due?:boolean;attempted?:number;inFlight?:boolean} | null = null;
  private tradeRecordAutoSyncStartedAt: number | null = null;
  private tradeRecordAutoSyncLastEndAt: number | null = null;
  private tradeRecordAutoSyncFlight: Promise<void> | null = null;
  private tradeRecordAutoSync = {
    status: "NOT_STARTED" as "NOT_STARTED" | "WAITING_FOR_PRIVATE_DATA" | "RUNNING" | "ACTIVE" | "COMPLETE" | "ERROR",
    startedAt: null as number | null,
    windowStart: null as number | null,
    windowEnd: null as number | null,
    lastAttemptAt: null as number | null,
    lastSuccessAt: null as number | null,
    lastWindow: null as { startTime: number; endTime: number } | null,
    lastResult: null as Record<string, number> | null,
    lastError: null as string | null,
  };
  private runtimeIdentity: RuntimeIdentity | null = null;
  private constructor(
    public readonly events: EventBus,
    state: RuntimeState,
    store: SettingsStore,
    market: MarketDataHub,
    universe: UniverseCoordinator,
    experience: ExperienceService,
    eip: EipService,
    ai: AiFabric,
    entry: EntryCoordinator,
    positions: PositionService,
    tp: TpGuardian,
    exchangeLoop: ExchangeLoop,
    reconciliation: ReconciliationService,
    manual: ManualPositionService,
    runtimeControl: RuntimeControlService,
    shadow?: ShadowRunner,
    tradeRecordIntegrity?: TradeRecordIntegrityService,
  ) {
    Object.assign(this, {
      state,
      settingsStore: store,
      market,
      universe,
      experience,
      eip,
      ai,
      entry,
      positions,
      tp,
      exchangeLoop,
      reconciliation,
      manual,
      runtimeControl,
      shadow: shadow ?? new ShadowRunner(state, market, store, this.events),
      tradeRecordIntegrity,
    });
  }
  static async create(opts: { configDir: string; dataDir: string }) {
    return this.createInternal(opts, false);
  }
  static async createTestHarness(opts: { configDir: string; dataDir: string }) {
    return this.createInternal(opts, true);
  }
  private static async createInternal(
    opts: { configDir: string; dataDir: string },
    testHarness: boolean,
  ) {
    const store = new SettingsStore(opts.configDir, opts.dataDir);
    const loadedSettings = await store.load();
    store.startOperationalMonitor();
    // Synthetic fixtures do not model exchange listing age or executable depth.
    // Quality admission itself is covered by deterministic core contracts; keep
    // unrelated runtime/EIP tests focused on their own invariants.
    const settings = testHarness
      ? { ...loadedSettings, selection: { ...loadedSettings.selection, marketQuality: { ...loadedSettings.selection.marketQuality, enabled: false } } }
      : loadedSettings;
    const state = new RuntimeState(settings);
    state.restore(store.loadRuntime());
    // J4: the usage ledger is a view over the durable RuntimeState rows, so it exists before the first
    // request can be made and comes back from a restart already holding the rows it wrote.
    const aiUsage = new AiUsageLedger(state as any);
    state.entryReservationTransaction=(revision:number,work:()=>unknown)=>store.mutateEntryReservations(revision,()=>{const result=work();store.persistRuntime(state.serialize());return result;});
    for(const saved of store.loadManualExecutions(state.executionFills)) {
      const existing=state.manualOrders.get(saved.order.id);if(existing&&existing.updatedAt>saved.order.updatedAt){store.saveManualExecution({intent:state.manualIntents.get(saved.intent.id)??saved.intent,order:existing});continue;}
      state.manualIntents.set(saved.intent.id,saved.intent);
      state.manualOrders.set(saved.order.id,saved.order);
    }
    const durableEntries=store.loadEntryExecutions();
    for(const saved of durableEntries) {
      const existing=state.entryOrders.get(saved.order.id);if(existing&&existing.updatedAt>saved.order.updatedAt){store.saveEntryExecution({intent:state.entryIntents.get(saved.intent.id)??saved.intent,order:existing});continue;}
      state.entryIntents.set(saved.intent.id,saved.intent);state.entryOrders.set(saved.order.id,saved.order);
      if(saved.reservation)state.upsertRecoveredEntryReservation(saved.reservation as any);
    }
    const unverifiedUnsent=[...state.entryOrders.values()].filter(o=>o.status==='UNKNOWN'&&!o.exchangeOrderId&&o.filledQuantity===0&&!durableEntries.some(d=>d.intent.id===o.intentId));
    if(unverifiedUnsent.length){const evidence=store.runtimeEvents(Math.min(...unverifiedUnsent.map(o=>o.createdAt)),['ENTRY_ORDER_BLOCKED','ENTRY_SUBMIT_ATTEMPTED'],5000),durableIds=new Set(durableEntries.map(d=>d.intent.id));for(const order of unverifiedUnsent){const recovered=recoverUnsubmittedEntry(order,durableIds,evidence);if(recovered){state.entryOrders.set(order.id,recovered);if(order.reservationId)state.releaseEntryReservation(order.reservationId);}}}
    // C2/D3: reservations are merged through the atomic API first, then provably expired ones are
    // released in one durable mutation so the memory revision stays equal to the stored revision.
    state.cleanupReservations();
    // Testnet entry safety is AUTO, while persisted operator/risk pauses remain
    // authoritative across restart. Only the obsolete no-candidate pause migrates.
    if (
      !testHarness &&
      settings.connections.exchange.environment === "TESTNET" &&
      settings.connections.executionMode === "TESTNET_ENABLED"
    ) {
      const next = structuredClone(settings);
      next.riskGovernance.entrySafetyMode = "AUTO";
      // Testnet Entry Safety is already AUTO on every legitimate restart, so asking the store to write
      // that again used to mint a settings version per start. Only a real difference is persisted.
      if (settings.riskGovernance.entrySafetyMode !== "AUTO") {
        const saved = await store.save(next);
        state.setSettings(saved);
      }
      const obsoleteNoCandidatePause=state.runtimeControl.mode==='PAUSED_NO_EXECUTABLE_CONTRACT';
      state.runtimeControl = {...state.runtimeControl,...(obsoleteNoCandidatePause?{mode:"RUNNING" as const,reasonCode:"NO_EXECUTABLE_CONTRACT" as const,reasonText:"持续扫描中：当前没有合格可执行机会",pausedAt:null,pauseSource:"NONE" as const,autoResume:true}:{}),entrySafetyMode:"AUTO"};
      if(!['AUTO_PAUSED_USER','AUTO_PAUSED_RISK'].includes(state.executionGovernance.mode))state.executionGovernance = {mode:"AUTO_RUNNING",changedAt:Date.now(),reason:"TESTNET_CAPITAL_AVAILABLE_AUTO",capitalEpochId:state.executionGovernance?.capitalEpochId??null,validationId:null};
      store.persistRuntime(state.serialize());
    }
    for (const record of store.listTradeRecords())
      if (record?.tradeId) state.tradeRecords.set(record.tradeId, record);
    for (const sample of store.listExperienceSamples())
      if (sample?.sampleId)
        state.experienceSamples.set(sample.sampleId, sample);
    if (!testHarness) {
      state.account = {
        status: "NOT_CONFIGURED",
        source: "BINANCE_TESTNET_PRIVATE",
        asOf: null,
        reason: "Binance Testnet credentials are not configured",
        equityUsd: null,
        availableUsd: null,
        walletBalanceUsd: null,
        unrealizedPnlUsd: null,
        realizedPnlUsd24h: null,
        assets: [],
        riskBaseline: null,
      };
    }
    state.aiResources = loadAiResources(settings);
    const events = new EventBus();
    const transport = new BinanceTransport(settings.connections),
      ref = settings.connections.exchange.credentialRef;
    let apiKey: string | null = null,
      apiSecret: string | null = null;
    try {
      [apiKey, apiSecret] = await Promise.all([
        store.getSecret(`${ref}:apiKey`),
        store.getSecret(`${ref}:apiSecret`),
      ]);
    } catch {}
    const testAdapters = testHarness
      ? (await import("../testing/createTestAdapters.js")).createTestAdapters(
          Math.max(120, settings.selection.universeTopN + 20),
        )
      : null;
    const provider =
        testAdapters?.provider ??
        new BinancePublicMarketDataProvider(transport),
      trade =
        testAdapters?.trade ??
        new ExternalTradeAdapter(
          transport,
          apiKey && apiSecret ? { apiKey, apiSecret } : null,
          settings.connections.exchange.recvWindowMs,
        );
    // C3: one durable exit-coordination store, sharing v396-ownership.sqlite with OwnershipRuntime.
    // It owns scope/cycle/ownerVersion/mandate/quantity truth for MANUAL, TP and future AI exits, and
    // it owns no exchange writer: a caller may submit only with the clientOrderId this returns.
    const exitRuntime = new V396ExitRuntime(
      path.join(store.dataDirectory(), 'v396-ownership.sqlite'),
      () => ({ environment: String(settings.connections.exchange.environment), account: String(settings.connections.exchange.credentialRef) }),
      async () => {
        if (!(trade as any)?.exitCoordinationCapabilities) throw new Error('ADAPTER_CAPABILITIES_UNPROVEN');
        return await (trade as any).exitCoordinationCapabilities();
      },
      // J1: AI exit authority is read from settings on every use and defaults to OFF.
      () => {
        const coordination = (state.settings.riskGovernance as any)?.exitCoordination ?? {};
        return {
          aiExitAuthority: coordination.aiExitAuthority ?? 'OFF',
          intervalMs: coordination.convergenceIntervalMs,
          batchLimit: coordination.convergenceBatchLimit,
          continuousEnabled: coordination.continuousConvergenceEnabled,
        };
      },
    );
    const market = new MarketDataHub(provider, state, events),
      universe = new UniverseCoordinator(state, events),
      experience = new ExperienceService(state),
      externalIntelligence=new ExternalIntelligenceService(state,store,events),
      eip = new EipService(state, experience,externalIntelligence),
      ai = new AiFabric(state, events, eip),
      positions = new PositionService(state, events),
      tp = new TpGuardian(state, trade, events, exitRuntime),
      entry = new EntryCoordinator(state, eip, ai, trade, events,market,{claim:(scope,value,retry,isolation)=>store.claimEntryExecution(scope,value,retry,isolation),save:value=>store.saveEntryExecution(value)}),
      exchangeLoop = new ExchangeLoop(
        trade,
        state,
        market,
        positions,
        tp,
        events,
      ),
      reconciliation = new ReconciliationService(
        trade,
        state,
        events,
        tp,
        positions,
        ()=>store.entryExecutionClaimStats(),
        exitRuntime,
      ),
      runtimeControl = new RuntimeControlService(state, events);
    let runtime!: EngineRuntime;
    const manual = new ManualPositionService(
      state,
      market,
      trade,
      tp,
      events,
      async () => { await reconciliation.whenSettled(); await reconciliation.run(); },
      { claim: (scope,value) => store.claimManualExecution(scope,value), save: value => store.saveManualExecution(value) },
      exitRuntime,
    );
    runtime = new EngineRuntime(
      events,
      state,
      store,
      market,
      universe,
      experience,
      eip,
      ai,
      entry,
      positions,
      tp,
      exchangeLoop,
      reconciliation,
      manual,
      runtimeControl,
    );
    runtime.cohort=new MarketCohort(state,market,events);
    runtime.lossHandoff=new LossHandoffService(state,events);
    // Durable ownership facts only. The journal runs in its own file, grants no AI
    // authority, and its failure must never block a human exit or a TP sweep (I07).
    runtime.ownership=attachOwnershipRuntime(events, path.join(store.dataDirectory(), 'v396-ownership.sqlite'),
      positionId=>{const position=state.positions.get(positionId);return position?{symbol:position.symbol,positionSide:position.side,cycleId:position.cycleId??null}:null;},
      ()=>({environment:state.settings.connections.exchange.environment,account:state.settings.connections.exchange.credentialRef}));
    runtime.shadowReadiness = new ShadowReadinessService(state, store);
    // J2: one authoritative portfolio admission. It reads only facts the Engine already keeps plus a
    // bounded external-transfer coverage read, and it is the single source of a reservation's risk
    // binding: no snapshot, no claim. Ownership lookups never invent an AI owner - a journal miss is
    // UNKNOWN risk, which keeps occupying capacity.
    const cashFlow:{rows:Array<{id:string;amountUsd:number;asset:string;time:number}>;complete:boolean;asOf:number;windowStart:number;windowEnd:number;inFlight:boolean;lastError:string|null}
      = {rows:[],complete:false,asOf:0,windowStart:0,windowEnd:0,inFlight:false,lastError:null};
    runtime.portfolioRisk = new PortfolioRiskAdmission({
      state,
      identity: () => ({ environment: String(state.settings.connections.exchange.environment), account: String(state.settings.connections.exchange.credentialRef) }),
      ownerOf: (scope, cycleId) => {
        const service = runtime.ownership?.ownershipService();
        if (!service) return null;
        try {
          const row = service.ownership(scope, cycleId);
          return row ? { ownerState: row.ownerState as any, handoffAt: Number(row.transitionedAt) || null, acknowledgedAt: row.acknowledgedAt == null ? null : Number(row.acknowledgedAt) } : null;
        } catch { return null; }
      },
      cashFlows: () => runtime.cashFlowFacts(),
      coverageWatch: () => runtime.portfolioRiskRequiredSymbols(),
      authority: () => ({facts: runtime.portfolioRiskAuthority.facts, staleObservedContentHash: runtime.portfolioRiskAuthority.staleObservedContentHash}),
      profile: () => (state.settings.riskGovernance as any)?.portfolioRisk ?? {},
    });
    runtime.portfolioRisk.restore(state.riskLedger);
    // The authority is a fact read from the same durable store the profile points at, so it has to be
    // verified before this process can call anything "READY" - including on a cold boot.
    void runtime.refreshPortfolioRiskAuthority().then(read=>{
      if(read.facts)events.publish('PORTFOLIO_RISK_AUTHORITY_LOADED',{marginTierVersion:read.facts.margin.version,coverageSymbols:read.facts.margin.coverageSymbols.length,
        derivedMaintenanceMarginRatePct:read.facts.margin.maintenanceMarginRatePct,settingsVersion:state.settings.settingsVersion});
      else events.publish('PORTFOLIO_RISK_AUTHORITY_UNAVAILABLE',{reasons:read.reasons});
    });
    (state as any).riskAdmission = runtime.portfolioRisk;
    events.publish('ENTRY_RESOURCE_POLICY_LOADED',{mode:testnetFundsOnlyEntry(state.settings)?'TESTNET_FUNDS_ONLY':'LEGACY_RISK_ENFORCED',portfolioRiskVeto:!testnetFundsOnlyEntry(state.settings),productionPolicyChanged:false});
    state.entryRiskGate = (input: any) => {
      const decision = runtime.portfolioRisk!.gate(input);
      state.riskLedger = runtime.portfolioRisk!.serialize();
      return decision;
    };
    runtime.cashFlowFacts = () => {
      const profile = (state.settings.riskGovernance as any)?.portfolioRisk ?? {};
      const maxAge = Number(profile.cashFlowMaxAgeMs ?? 900_000);
      if (!cashFlow.complete || !cashFlow.asOf || Date.now() - cashFlow.asOf > maxAge) return [];
      // A complete read with no transfer is a proven zero for that window; an unread window is
      // reported as no facts at all so the snapshot stays incomplete.
      return cashFlow.rows.length
        ? cashFlow.rows.map(row => ({ id: row.id, amountUsd: row.amountUsd, factStatus: 'VERIFIED' as const }))
        : [{ id: `cashflow-coverage:${cashFlow.windowStart}:${cashFlow.windowEnd}`, amountUsd: 0, factStatus: 'VERIFIED' as const }];
    };
    runtime.refreshCashFlowFacts = async (now = Date.now()) => {
      const adapter = runtime.trade as any, profile = (state.settings.riskGovernance as any)?.portfolioRisk ?? {};
      if (!adapter?.fetchCashFlowFacts || cashFlow.inFlight) return null;
      if (state.settings.connections.executionMode !== 'TESTNET_ENABLED' || !privateAccountFresh(state.account as never, now)) return null;
      if (now - cashFlow.asOf < Math.max(60_000, Number(profile.cashFlowMaxAgeMs ?? 900_000) / 3)) return cashFlow.complete ? { rows: cashFlow.rows.length, asOf: cashFlow.asOf } : null;
      cashFlow.inFlight = true;
      try {
        const windowMs = Math.max(60_000, Number(profile.cashFlowWindowMs ?? 86_400_000));
        const read = await adapter.fetchCashFlowFacts(now - windowMs, now);
        cashFlow.rows = Array.isArray(read?.facts) ? read.facts : [];
        cashFlow.complete = read?.complete === true;
        cashFlow.windowStart = Number(read?.windowStart ?? 0); cashFlow.windowEnd = Number(read?.windowEnd ?? 0);
        cashFlow.asOf = cashFlow.complete ? now : cashFlow.asOf;
        cashFlow.lastError = null;
        if (!cashFlow.complete) events.publish('PORTFOLIO_CASH_FLOW_COVERAGE_INCOMPLETE', { rows: cashFlow.rows.length, windowStart: cashFlow.windowStart, windowEnd: cashFlow.windowEnd }, 'V396');
        return { rows: cashFlow.rows.length, complete: cashFlow.complete, asOf: cashFlow.asOf };
      } catch (error) {
        cashFlow.complete = false; cashFlow.asOf = 0;
        cashFlow.lastError = error instanceof Error ? error.message : String(error);
        events.publish('PORTFOLIO_CASH_FLOW_READ_FAILED', { reason: cashFlow.lastError, failClosed: true }, 'V396');
        return null;
      } finally { cashFlow.inFlight = false; }
    };
    runtime.temporal = new TemporalIntelligenceService(
      store.dataDirectory(),
      events,
    );
    runtime.liveValidation = new LiveValidationService(
      state,
      store,
      events,
      trade instanceof ExternalTradeAdapter ? trade : null,
      eip,
      market,
      reconciliation,
      tp,
      ai,
      store.dataDirectory(),
    );
    runtime.externalIntelligence=externalIntelligence;
    runtime.externalResearch=new ExternalResearchService(state,store,ai,events);
    runtime.assetGovernance = new AssetGovernanceCoordinator({
      getSettings: () => runtime.state.settings,
      review: (settings) => ProductionAssetResearchService.fromSettings(
        settings.connections,
        settings.selection.assetDirectory.approvedLiquid,
      ).review(),
      publish: (settings, expectedVersion) => runtime.updateSettingsIfVersion(settings, expectedVersion),
      emit: (type, payload) => events.publish(type, payload),
    });
    externalIntelligence.setResearchSink(snapshot=>runtime.externalResearch.enqueue(snapshot));
    runtime.cleanup = new TestnetLowLossCleanupService(
      state,
      market,
      trade,
      tp,
      events,
      () => reconciliation.run(),
      exitRuntime,
      store,
    );
    if (trade instanceof ExternalTradeAdapter) runtime.trade = trade;
    // P6: the funding income ledger shares the ownership file so an income row and the cycle it
    // settles cannot be committed in two databases that may disagree.
    let fundingIncome: FundingIncomeLedger | null = null;
    try { fundingIncome = new FundingIncomeLedger(path.join(store.dataDirectory(), 'v396-ownership.sqlite'), () => ({ environment: String(settings.connections.exchange.environment), account: String(settings.connections.exchange.credentialRef) })); }
    catch (error) { events.publish('FUNDING_LEDGER_UNAVAILABLE', { reason: String(error instanceof Error ? error.message : error) }, 'V396'); }
    runtime.fundingIncome = fundingIncome;
    runtime.exitRuntime = exitRuntime;
    // P2: fill attribution reads system origin from the durable registry instead of a client-id prefix.
    state.orderProvenance = exitRuntime.provenance as any;
    runtime.aiExitAuthority = new AiExitAuthorityService(exitRuntime, () => {
      const coordination = (state.settings.riskGovernance as any)?.exitCoordination ?? {};
      return coordination.aiExitAuthority ?? 'OFF';
    });
    // J4: bounded review of cycles already under AI management. The scheduler owns the trigger
    // identity and the budget, the ledger owns the record of what was asked, and this is the only
    // path by which a model answer becomes exit evidence. Entry inference and review share an
    // endpoint but never share a budget.
    runtime.aiUsage = aiUsage;
    const reviewSettings = () => {
      const coordination = (state.settings.riskGovernance as any)?.exitCoordination ?? {};
      return {
        normalReviewsPerPlan: Number(coordination.normalReviewsPerPlan ?? 2),
        exceptionReviewsPerPlan: Number(coordination.exceptionReviewsPerPlan ?? 1),
        failureBudget: Number(coordination.reviewFailureBudget ?? 2),
        minIntervalMs: Number(coordination.reviewMinIntervalMs ?? 300_000),
        authorityTtlMs: Number(coordination.reviewAuthorityTtlMs ?? 20_000),
      };
    };
    runtime.positionReviewScheduler = new PositionReviewScheduler({
      ledger: aiUsage,
      settings: reviewSettings,
      ownerOf: (scope, cycleId) => {
        const owner = exitRuntime.ownerOfScope(scope, cycleId);
        return owner ? { ownerState: String(owner.ownerState), ownerVersion: Number(owner.ownerVersion), deadline: owner.deadline ?? null } : null;
      },
    });
    runtime.positionReviewScheduler.restore([...(state as any).reviewBudgets.values()]);
    runtime.positionReviewRunner = new PositionReviewRunner({
      state,
      events,
      exitRuntime,
      scheduler: runtime.positionReviewScheduler,
      settings: () => (state.settings.riskGovernance as any)?.exitCoordination ?? {},
      evidenceVersion: symbol => String((state.snapshots.get(symbol) as any)?.technical?.['15m']?.asOf ?? 0),
      memoryVersion: () => tradeMemoryVersionOf([...state.tradeRecords.values()]),
      review: input => runtime.reviewPosition(input),
      // P6: a review that is owed declares the debt so the shared Primary endpoint gives it its
      // bounded share instead of being permanently taken by a continuously queued Entry chain.
      noteOwed: (at: number) => ai.noteReviewOwed?.(at),
      reviewAvailable: () => ai.reviewAvailable(),
      clearOwed: () => ai.clearReviewOwed(),
    });
    // J1: the AI exit door has exactly one production consumer. Its plan port returns null until a
    // durable TradePlan exists for the cycle, so even ENFORCE refuses with AI_PLAN_UNPROVEN rather
    // than inventing an invalidation signal from a position label (I01, I06).
    runtime.aiExitRunner = new V396AiExitRunner({
      state,
      events,
      exitRuntime,
      authority: runtime.aiExitAuthority,
      adapter: trade as ExchangeTradeAdapter,
      // S06: the AI exit is bound to the durable plan of its own cycle through the one reader that
      // resolves it. A cycle with no plan gets no AI authority, whatever its position label says.
      planOf: (position: any, scope: string, cycleId: string) => {
        const facts = aiExitPlanFactsOf([...state.tradePlans.values()], {
          scope,
          cycleId,
          now: Date.now(),
          markPrice: Number((state.snapshots.get(position.symbol) as any)?.quote?.bid ?? Number.NaN),
          firstFillAt: Number(position.openedAt ?? 0) || null,
          latestClosedBar: (() => {
            const card = (state.snapshots.get(position.symbol) as any)?.technical?.['15m'];
            return card?.isClosed === true && Number.isFinite(Number(card?.barCloseTime))
              ? { timeframe: '15m', closeTime: Number(card.barCloseTime), close: Number(card?.lastClosedBar?.close ?? card?.close ?? Number.NaN) }
              : null;
          })(),
        });
        if (!facts) return null;
        // A review counts as evidence only while it is still the answer about this exact plan
        // version, and only for as long as the next review would have been owed.
        return PositionReviewRunner.planFactsWithReview(facts, PositionReviewRunner.usableVerdict(state, {
          cycleId,
          planRef: facts.planRef,
          planVersion: facts.planVersion,
          maxAgeMs: reviewSettings().minIntervalMs,
          now: Date.now(),
        }));
      },
      identity: () => ({ environment: String(settings.connections.exchange.environment), account: String(settings.connections.exchange.credentialRef) }),
      // P6: the funding ledger and the non-base quote conversion are both optional inputs to the exit
      // facts. Without a ledger row plus enclosing coverage, funding stays UNKNOWN; without a
      // timestamped rate, a USDC contract's costs stay UNKNOWN rather than being read as USDT.
      fundingLedger: fundingIncome,
      fxRateProvider: (asset, at) => {
        const quote = asset === 'USDC' ? state.snapshots.get('USDCUSDT') : undefined;
        const rate = Number((quote as any)?.quote?.last ?? Number.NaN);
        const observedAt = Number((quote as any)?.quote?.ts ?? 0);
        return Number.isFinite(rate) && rate > 0 && observedAt > 0 ? { rate, observedAt, source: 'USDCUSDT_QUOTE_LAST' } : null;
      },
    });
    // C3: restart re-proves stored exits by their original clientOrderId before anything else. This
    // path is read-only by construction; a failed or absent answer leaves the task unacked.
    void runtime.convergeRecoveredExits();
    (state as any).tradingQualityEvidenceReady=false;
    try{runtime.tradingQuality = new TradingQualityCollector(path.join(opts.dataDir,"trading-quality.sqlite"),state,events);}catch(error){events.publish('TRADING_QUALITY_STORAGE_UNAVAILABLE',{reason:String(error)});}
    events.on("event", (event) => {
      if(runtime.persistenceClosed)return;
      // J4: the usage ledger is fed from the same event stream the audit uses, so a request that
      // failed before the caller ever saw an answer is still on the record.
      runtime.observeModelUsage(event);
      const requiredBeforeWrite=['ENTRY_SUBMIT_ATTEMPTED','MANUAL_SUBMISSION_PREPARED','TP_SUBMISSION_PREPARED'];
      if(requiredBeforeWrite.includes(event.type))store.recordRuntimeEvent(event);else runtime.writes.apply(`event:${event.id}`,()=>store.recordRuntimeEvent(event));
      if(event.type==='RECONCILIATION_COMPLETED'||event.type==='ENTRY_ORDER_TTL_CLOSED'||event.type==='ENTRY_ORDER_REPRICED'){
        for(const order of state.entryOrders.values()){const intent=state.entryIntents.get(order.intentId);if(intent)runtime.writes.apply(`entry:${order.id}`,()=>store.saveEntryExecution({intent,order,reservation:order.reservationId?state.entryReservations.get(order.reservationId):undefined}));}
      }
      if(['ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED','ENTRY_ORDER_MANAGEMENT_UNVERIFIED','MANUAL_SUBMISSION_PREPARED','TP_SUBMISSION_PREPARED','TP_ORDER_REJECTED','MANUAL_EXIT_GOAL_QUEUED','MANUAL_EXIT_GOAL_PROGRESS','MANUAL_EXIT_GOAL_COMPLETED'].includes(event.type))store.persistRuntime(state.serialize());
      if(event.type.startsWith('MANUAL_')||event.type==='RECONCILIATION_COMPLETED') {
        for(const order of state.manualOrders.values()) {
          const intent=state.manualIntents.get(order.intentId);
          if(intent)runtime.writes.apply(`manual:${order.id}`,()=>store.saveManualExecution({intent,order}));
        }
      }
      const a = state.activity,
        now = event.ts;
      if (event.type === "PRIMARY_DECISION_NORMALIZED") {
        a.lastPrimaryRunAt = now;
        a.primaryRunsSinceLastPlace++;
        a.primaryCount30m++;
        const decision = String(
          (event.payload as any)?.normalizedDecision ?? "",
        );
        if (decision.startsWith("PLACE_")) {
          a.lastPlaceDecisionAt = now;
          a.primaryRunsSinceLastPlace = 0;
          a.uniqueSymbolsSinceLastPlace = 0;
          a.consecutiveRejects = 0;
          a.placeCount30m++;
        } else {
          a.consecutiveRejects++;
          a.rejectCount30m++;
        }
        a.uniqueSymbolsSinceLastPlace = new Set([
          ...state.aiRuns
            .filter(
              (run) =>
                run.role === "PRIMARY_BRAIN" &&
                run.startedAt > now - 30 * 60_000,
            )
            .map((run) => run.symbol),
        ]).size;
      }
      if (event.type === "ENTRY_INTENT_CREATED") {
        a.lastEntryIntentAt = now;
        a.entryIntentCount30m++;
      }
      if (event.type === "ENTRY_ORDER_CREATED") {
        a.lastEntrySubmittedAt = now;
        a.submitCount30m++;
      }
      if (event.type === "ENTRY_FILLED") {
        a.lastEntryFilledAt = now;
        a.fillCount30m++;
        // J1: the management deadline is bound in the same synchronous event turn as the fill, so a
        // TP repair that only needs a protection owner can never record the cycle first as legacy.
        runtime.fixCycleDeadlineFromEvent(event.payload, now);
      }
      if (event.type === "POSITION_OPENED") runtime.fixCycleDeadlineFromEvent(event.payload, now);
      if (
        event.type === "TRADE_RECORD_OPENED" ||
        event.type === "TRADE_RECORD_CLOSED" ||
        event.type === "TRADE_RECORD_REPAIRED"
      ) {
        new TradeRecordIntegrityService(state).classifyAll();
        for(const candidate of state.tradeRecords.values()){
          runtime.writes.apply(`trade:${candidate.tradeId}`,()=>store.upsertTradeRecord(candidate));
          if(candidate.classification!=="COMPLETE")runtime.writes.apply(`sample-delete:${candidate.tradeId}`,()=>store.deleteExperienceSample(`sample_${candidate.tradeId}`));
        }
        const record = state.tradeRecords.get(
          String((event.payload as any)?.tradeId),
        );
        if (record) runtime.writes.apply(`trade:${record.tradeId}`,()=>store.upsertTradeRecord(record));
      }
      if (event.type === "EXPERIENCE_SAMPLE_CREATED") {
        const sample = state.experienceSamples.get(
          String((event.payload as any)?.sampleId),
        );
        if (sample) runtime.writes.apply(`sample:${sample.sampleId}`,()=>store.upsertExperienceSample(sample));
      }
      if (runtime.stopped) return;
      if (runtime.persistTimer) return;
      runtime.persistTimer = setTimeout(() => {
        runtime.writes.apply('runtime-checkpoint',()=>store.persistRuntime(state.serialize()));
        runtime.persistTimer = null;
      }, 1000);
    });
    // Recovery must run after the durable event/checkpoint consumers are attached. Persist the
    // rebuilt trade-record projection as one batch as well as the runtime checkpoint.
    const cycleRecovery = positions.rebuildProvenCycleAccounting();
    if (cycleRecovery.rebound || cycleRecovery.rebuilt)
      events.publish('TRADE_RECORD_REPAIRED', {source: 'PROVEN_CYCLE_ACCOUNTING_REBUILD', ...cycleRecovery});
    if (trade instanceof ExternalTradeAdapter) {
      events.once("RUNTIME_STOPPED", () => trade.stopUserData());
      runtime.startUserDataIfConfigured();
    }
    return runtime;
  }
  private every(ms: number, fn: () => Promise<void> | void, options: { allowOverlap?: boolean } = {}) {
    let running = false;
    const t = setInterval(async () => {
      if (this.stopped || (!options.allowOverlap && running)) return;
      if (options.allowOverlap) {
        try { await fn(); } catch (error) { this.events.publish("RUNTIME_TASK_FAILED", { message: error instanceof Error ? error.message : String(error) }); }
        return;
      }
      running = true;
      try {
        await fn();
      } catch (error) {
        this.events.publish("RUNTIME_TASK_FAILED", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        running = false;
      }
    }, ms);
    this.timers.push(t);
  }
  private marketSymbolLimit() {
    const occupied = new Set([
        ...this.state.positionSymbols(),
        ...this.state.activeEntrySymbols(),
      ]).size,
      reserve = Math.max(32, this.state.settings.selection.poolTarget * 4);
    return Math.min(
      this.state.settings.selection.universeTopN,
      Math.max(
        24,
        this.state.settings.selection.poolMax,
        this.state.settings.selection.poolTarget + occupied + reserve,
      ),
    );
  }
  async bootstrap() {
    // Account readiness must not wait behind a full-universe market download.
    await this.syncPrivate();
    if (
      this.state.executionGovernance.mode === "AUTO_RUNNING" &&
      this.state.executionGovernance.reason === "TESTNET_CAPITAL_AVAILABLE_AUTO"
    )
      this.state.rejectionCooldown.clear();
    try {
      // Discovery must remain discovery-only.  The cohort is the sole owner
      // of retained symbols, so bootstrap hydrates its bounded batch instead
      // of turning the whole discovery set into REST and WS work.
      await this.cohort.tick("BOOTSTRAP");
    } catch (error) {
      this.events.publish("MARKET_BOOTSTRAP_FAILED", {
        message: error instanceof Error ? error.message : String(error),
        retry: "COHORT_BOOTSTRAP",
      });
    }
    this.universe.refresh();
    if (this.state.account.status === "READY") {
      await this.refreshPositionMarkets();
      await this.reconciliation.run();
    }
    // Reconcile may expose protected owners after the first cohort pass.
    // Refresh membership without expanding it to the discovery universe.
    await this.cohort.tick("POST_RECONCILIATION_BOOTSTRAP");
    this.universe.refresh();
    this.ready = true;
    this.runtimeControl.evaluate(true);
    if (
      this.state.settings.connections.exchange.environment === "TESTNET" &&
      this.runtimeControl.canDispatch()
    )
      void this.entry.processPool().catch((error) =>
        this.events.publish("ENTRY_ANALYSIS_FAILED", {
          message: error instanceof Error ? error.message : String(error),
          scope: "BOOTSTRAP",
        }),
      );
  }
  /** The pre-model cost gate: read the facts the write path itself will check, before paying for them. */
  executionReadinessSnapshot(now = Date.now()) {
    return executionReadiness({
      settings: this.state.settings,
      account: this.state.account,
      runtimeControlMode: this.state.runtimeControl.mode,
      executionGovernanceMode: this.state.executionGovernance?.mode ?? '',
      writeAdmissionBlock: this.entry.writeAdmissionBlockReason(),
      executableCandidateCount: this.state.runtimeControl.capital.executableCandidateCount ?? 0,
      executableCandidateSymbols: (this.state.runtimeControl.capital.routedCandidates ?? [])
        .filter((route: any) => route?.longExecutable || route?.shortExecutable)
        .map((route: any) => String(route?.symbol ?? '')),
      sizingWatchSymbols: this.portfolioRiskRequiredSymbols(),
      portfolioRiskAuthority: {facts: this.portfolioRiskAuthority.facts, staleObservedContentHash: this.portfolioRiskAuthority.staleObservedContentHash},
      authorityScope: this.authorityScope(),
      now,
    });
  }
  async dispatchAnalysisTick(){
    const permitted=this.state.settings.connections.exchange.environment==='TESTNET'&&this.runtimeControl.canDispatch();
    if(!permitted){this.entry.noteSchedulerTick?.();this.entry.noteAnalysisBlocked?.('POLICY_OR_FACT_GATE');return;}
    // The verdict is pushed, not polled: the tick that changes it is the tick that must stop paying
    // for a model, and the deterministic supply maintenance inside processPool keeps running.
    this.entry.noteExecutionReadiness?.(this.executionReadinessSnapshot());
    await this.entry.processPool();
  }

  async start() {
    this.stopped = false;
    const tradeRecordAutoSyncStartedAt = Date.now();
    this.every(15_000, async () => this.syncPrivate());
    await this.ai.probeResources();
    this.every(15_000, async () => this.ai.probeResources());
    await verifyBinanceTransportEgress();
    this.every(15 * 60_000, async () => verifyBinanceTransportEgress());
    await this.bootstrap();
    this.startTradeRecordAutoSync(tradeRecordAutoSyncStartedAt);
    if (this.state.runtimeControl.entrySafetyMode === "SAFETY_REVIEW_PAUSED")
      this.state.runtimeControl.entrySafetyMode = "SHADOW_READY";
    this.shadow.start();
    this.temporal.start();
    await this.externalIntelligence.tick(true);
    this.every(15 * 60_000, async () => {
      await this.market.tick();
      await this.cohort.tick('PERIODIC_15M');
      this.universe.refresh();
    });
    this.every(60_000, async () => {
      await this.cohort.tick('PERIODIC_60S');
      // Protected owners still receive field updates while cohort refill is suppressed.
      await this.market.refreshSymbols([...this.cohort.protectedSymbols()]);
      await this.market.refreshSlowFields(this.market.retentionSymbols());
      this.lossHandoff.tick();
      this.universe.refresh();
    });
    this.every(10_000, async () => {
      const freshness = this.market.freshness();
      if (freshness.stale.length) {
        this.events.publish("MARKET_FRESHNESS_RECOVERY", {
          stale: freshness.stale,
        });
        await this.market.recoverStale();
        this.universe.refresh();
      }
    });
    this.every(1_000, async () => {
      await this.market.tick();
      if (this.state.settings.connections.executionMode === "TESTNET_ENABLED")
        await this.exchangeLoop.tick();
    });
    this.every(2_500, async () => {
      this.runtimeControl.evaluate(true);
      await this.dispatchAnalysisTick();
    });
    // Model latency must never delay order TTL, cancellation or repricing.
    this.every(2_000,async()=>{
      if(this.state.settings.connections.executionMode==='TESTNET_ENABLED')await this.entry.reviewPending();
    });
    this.every(2_000,async()=>{if(this.state.settings.connections.executionMode==='TESTNET_ENABLED')await this.manual.resumeExitGoals();});
    this.every(1_000,()=>this.writes.flush());
    this.every(5_000,()=>{this.ownership?.pump();this.fixFirstFillDeadlines();void this.convergeExitsPeriodically();void this.aiExitRunner?.tick();});
    // J2: the external-transfer coverage read is only attempted when a human configured the
    // portfolio profile and the adapter can answer it; otherwise it costs no request at all.
    this.every(60_000,async()=>{
      if((this.state.settings.riskGovernance as any)?.portfolioRisk?.configured===true)await this.refreshCashFlowFacts().catch(()=>null);
    });
    // J4: bounded review runs on its own slow cadence and never overlaps itself. When the switch is
    // off (the default) the tick costs nothing at all; when the model is unreachable it spends review
    // budget and stops, while the deadline, the TP sweep, reconciliation and the handoff keep running.
    this.every(60_000,async()=>{
      const runner=this.positionReviewRunner;
      if(!runner)return;
      try{this.reviewTickReport=await runner.tick();}
      catch(error){this.reviewTickReport={enabled:true,considered:0,reserved:0,deduplicated:0,refused:['REVIEW_TICK_FAILED'],completed:0,discarded:0,failed:1,zeroRoutineCalls:0};
        this.events.publish('POSITION_REVIEW_TICK_FAILED',{reason:error instanceof Error?error.message:String(error),orderSent:false});}
    });
    this.every(1_000,()=>this.tradingQuality?.tick());
    this.every(5_000,()=>this.qualityObserver?.tick());
    this.every(5_000, async () => this.tp.sweep());
    this.every(15_000, async () => {
      if (this.state.account.status === "READY") {
        await this.refreshPositionMarkets();
        await this.reconciliation.run();
      }
      this.runtimeControl.evaluate();
      (this.state as any).temporalSnapshot = this.temporal.snapshot();
    });
    this.every(this.state.settings.externalIntelligence.refreshSeconds*1000,async()=>this.externalIntelligence.tick());
    this.every(2_000,async()=>this.externalResearch.tick());
    this.every(30_000,()=>{this.externalResearch.enqueueMarketChanges();});
    this.every(1_000,()=>{this.settingsStore.backfillAiRunSummaries(25,8);});
    // P6: funding is a scheduled income event, so the ledger is pulled on a slow cadence with an
    // explicit coverage window. A failed pull records nothing, which leaves attribution UNKNOWN rather
    // than implying "no funding happened".
    this.every(10*60_000,()=>{void this.syncFundingIncome();},{allowOverlap:true});
    this.every(45_000,()=>{void this.attributeCycleFunding();});
    this.every(5_000,()=>{this.writes.apply('storage-retention',()=>{this.settingsStore.maintainRetention();});});
    // Do not await long research in the scheduler: coordinator single-flight owns
    // publication while every tick still observes expiry during a hung request.
    this.every(1_000, () => this.assetGovernance.tick(), { allowOverlap: true });
    // Private account reconciliation must keep running even if the non-critical
    // validation/reporting work is delayed by storage or source inspection.
    this.every(15_000, async () => {
      await this.liveValidation.tick();
    });
    this.every(
      this.state.settings.runtimeControl.capitalCheckIntervalSeconds * 1000,
      async () => {
        this.runtimeControl.evaluate(true);
      },
    );
    this.events.publish("RUNTIME_STARTED", {
      dataMode: "BINANCE",
      aiMode: "OPENAI_COMPATIBLE",
    });
  }
  private persistenceClosed=false;
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events.publish("RUNTIME_STOPPING",{reason:"MANUAL_OR_FATAL_SHUTDOWN"});
    this.ready = false;
    this.shadow.stop();
    this.temporal.stop();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.market.stop();
    try{this.settingsStore.persistRuntime(this.state.serialize());this.events.publish("RUNTIME_STOPPED");this.settingsStore.checkpoint();}
    finally{this.persistenceClosed=true;this.qualityObserver?.close();this.tradingQuality?.close();this.exitRuntime?.close();this.fundingIncome?.close();this.ownership?.close();this.settingsStore.close();}
  }
  private async applySavedSettings(next:any) {
    this.state.setSettings(next);
    this.state.pool = new (await import("@zdj/core")).DynamicPool(next);
    this.events.publish("SETTINGS_UPDATED", {generation:this.state.generation,settingsVersion:next.settingsVersion});
    this.universe.refresh();
    this.runtimeControl.evaluate(true);
    return next;
  }
  async updateSettings(input: unknown) {return this.applySavedSettings(await this.settingsStore.save(input));}
  async updateSettingsIfVersion(input:unknown,expectedVersion:number){return this.applySavedSettings(await this.settingsStore.saveIfVersion(input,expectedVersion));}
  async updateResourceSettings(input:unknown,expectedVersion:number,mutation:{kind:"exchange"|"proxy"|"ai";operation:"SAVE"|"DELETE";id:string;value?:unknown}){return this.applySavedSettings(await this.settingsStore.saveResourceIfVersion(input,expectedVersion,mutation));}
  private authorityScope(){
    const exchange=this.state.settings.connections.exchange;
    return {environment:String(exchange.environment??'').toUpperCase(),accountScope:String(exchange.credentialRef??'')};
  }
  /** Reload and verify the durable authority rows; a half-written or hand-edited set yields none. */
  async refreshPortfolioRiskAuthority(){
    const read=await this.settingsStore.readPortfolioRiskAuthority();
    this.portfolioRiskAuthority={facts:read.facts,reasons:read.reasons,loadedAt:Date.now(),
      staleObservedContentHash:read.facts?this.portfolioRiskAuthority.staleObservedContentHash:null};
    this.mirrorMarginTierCoverage(read.facts);
    return read;
  }
  /**
   * The read-only coverage mirror the pipeline consults before it spends a model call. The committed
   * dataset stays the only authority over margin tiers; this copy answers exactly one question —
   * "is this symbol inside it" — so a symbol that admission would refuse by name never reaches Primary.
   */
  private mirrorMarginTierCoverage(facts: PortfolioRiskAuthorityFacts | null){
    this.state.marginTierCoverage=facts?{symbols:[...facts.margin.coverageSymbols].map(symbol=>String(symbol).trim().toUpperCase()).sort(),
      version:facts.margin.version,contentHash:facts.margin.contentHash,loadedAt:Date.now()}:null;
  }
  /**
   * The symbols a committed margin dataset has to cover: what the account holds, what is already in
   * flight, what the pool can route, and the top of the eligible universe those candidates come from.
   *
   * The universe part is the point. Coverage of only "what capital happened to route this second"
   * makes a one-shot snapshot chase a set that changes every tick, so the profile keeps flipping
   * between usable and unusable and the account silently stops trading. A commit is an explicit
   * operator action, so it can afford to price the whole sized universe once.
   */
  portfolioRiskRequiredSymbols(){
    // §E: the coverage demand and the Entry funding universe are the same set of symbols, read from the
    // one contract constant. A BUSD/FDUSD contract can no longer both be unroutable and require a bracket.
    const quoteable=(symbol:string)=>entryFundingEligibleSymbol(symbol);
    const held=[...this.state.positionSymbols(),...this.state.activeEntrySymbols()];
    const symbols=new Set<string>(held);
    for(const row of Array.isArray(this.state.pool?.readyList?.())?this.state.pool.readyList():[])symbols.add(String(row?.symbol??'').toUpperCase());
    // The routing ledger, not the pool snapshot, is what "can be routed" means: a symbol whose
    // lifecycle says it may reach the model can also reach admission, and if its bracket was never
    // priced the refusal reads MARGIN_TIER_SYMBOL_UNPROVEN — which is how six real PLACE_LONG decisions
    // (WLDUSDT, TAOUSDT, NEARUSDT, PENGUUSDT, UNIUSDT, DOGEUSDC) were lost on the live account.
    for(const [symbol,row] of this.state.candidateLifecycle ?? new Map<string,unknown>())if(isPipelineRoutableLifecycle((row as {status?:unknown})?.status))symbols.add(String(symbol).toUpperCase());
    // Budget bound. The ranked shortlist the pipeline draws from is poolMax-sized and twice that is
    // already ahead of rotation, but actual demand always fits: the shortlist may only top up what
    // holdings, the pool and the routing ledger have not already claimed, never displace them.
    const demand=symbols.size;
    const cap=Math.max(Math.max(8,2*(Number(this.state.settings?.selection?.poolMax??24)||24)),Math.min(demand,MARGIN_AUTHORITY_COVERAGE_CEILING));
    const ranked=(this.state.universe??[]).filter((row:any)=>row?.eligible&&Number(row?.rank)>0)
      .sort((a:any,b:any)=>Number(a.rank)-Number(b.rank)).map((row:any)=>String(row?.symbol??'').toUpperCase());
    // Insertion order is the bound: holdings first, then the pool, then the routing ledger, then the
    // best-ranked universe members. Sorting before truncating would keep the alphabetically-first
    // symbols instead of the ones the pipeline is actually using.
    for(const symbol of ranked){if(symbols.size>=cap)break;symbols.add(symbol);}
    return [...new Set([...symbols].filter(symbol=>quoteable(symbol)))].sort();
  }
  /**
   * The set an authority commit — or a drift comparison against one — has to price: this tick's sized
   * universe plus every symbol the already-committed authority covers. Coverage may widen but may not
   * narrow silently, and a drift check that priced a narrower set than the commit did would report the
   * exchange's unchanged bracket table as moved.
   */
  portfolioRiskCoverageUniverse(){
    const carried=(this.portfolioRiskAuthority.facts?.margin.coverageSymbols ?? [])
      .map(symbol=>String(symbol ?? '').trim().toUpperCase()).filter(Boolean);
    return [...new Set([...this.portfolioRiskRequiredSymbols(),...carried])].sort();
  }
  /**
   * The bound the conservative maintenance rate is allowed to consider. Any single new entry is capped
   * by the operator's own gross notional limit, so brackets above it cannot describe this account's
   * risk - and the field's own schema bound comes from the governance matrix, not from a copy here.
   */
  private portfolioRiskSizingBound(limitsRow:Record<string,unknown>){
    const gross=Number(limitsRow?.maxGrossNotionalUsd);
    const bound=governanceFieldOf(`${PORTFOLIO_RISK}.maintenanceMarginRatePct`)?.max;
    return {maxEntryNotionalUsd:Number.isFinite(gross)&&gross>0?gross:null,maintenanceRateBound:Number.isFinite(bound as number)?Number(bound):null};
  }
  private async collectPortfolioRiskMarginBrackets(requiredSymbols:string[]){
    const adapter=this.trade;
    if(!adapter?.fetchMaintenanceMarginBrackets)throw new Error('MARGIN_BRACKET_COLLECTOR_UNAVAILABLE');
    if(!requiredSymbols.length)throw new Error('MARGIN_AUTHORITY_COVERAGE_EMPTY');
    return adapter.fetchMaintenanceMarginBrackets(requiredSymbols,{credentialRef:this.authorityScope().accountScope});
  }
  /**
   * The only channel that can create or replace a PortfolioRisk authority.
   *
   * A client supplies numeric limits and the two operator-declared datasets; it never supplies margin
   * brackets, a version, or a maintenance rate. Those are read from the exchange by this process and
   * hashed here, so the version in Settings is always an identity this server derived. Everything
   * lands in one SQLite transaction with the Settings row that names it.
   */
  async commitPortfolioRiskAuthority(input:{limits:Record<string,unknown>;clusters:unknown;scenarios:unknown;acks?:string[];expectedSettingsVersion:number;operator?:string}){
    const scope=this.authorityScope();
    if(scope.environment!=='TESTNET')throw new Error(`PORTFOLIO_RISK_AUTHORITY_REQUIRES_TESTNET:${scope.environment}`);
    if(!scope.accountScope)throw new Error('PORTFOLIO_RISK_AUTHORITY_ACCOUNT_SCOPE_MISSING');
    const patch:Record<string,unknown>={};
    for(const [key,value] of Object.entries(input.limits??{})) patch[`riskGovernance.portfolioRisk.${key}`]=value;
    const staged=applyGovernancePatch(this.state.settings,patch,{acks:input.acks??[]});
    if(staged.refusals.length){const error=new Error('PORTFOLIO_RISK_LIMITS_REFUSED') as Error&{refusals?:unknown};error.refusals=staged.refusals;throw error;}
    // A refresh may only widen or hold coverage. `portfolioRiskRequiredSymbols()` is a per-tick view of
    // a rotating pool, so replacing the committed set silently drops symbols the pipeline sized
    // earlier — on the live account that turned a real PLACE_LONG into
    // `MARGIN_TIER_SYMBOL_UNPROVEN:NEARUSDT`, an availability artifact expressed as a risk refusal.
    // Carrying a name forward never carries its data forward: every symbol below is re-read from the
    // exchange, and if any of them cannot be priced the whole commit is refused rather than truncated.
    const requiredSymbols=this.portfolioRiskCoverageUniverse();
    if (requiredSymbols.length > MARGIN_AUTHORITY_COVERAGE_CEILING) throw new Error(`MARGIN_AUTHORITY_COVERAGE_TOO_WIDE:${requiredSymbols.length}>${MARGIN_AUTHORITY_COVERAGE_CEILING}`);
    const bracketRead=await this.collectPortfolioRiskMarginBrackets(requiredSymbols);
    const compiled=portfolioRiskAuthorityCompile({environment:scope.environment,accountScope:scope.accountScope,bracketRead,requiredSymbols,
      clusters:input.clusters,scenarios:input.scenarios,credentialRef:scope.accountScope,committedAt:Date.now(),
      sizingBound:this.portfolioRiskSizingBound((staged.settings.riskGovernance as any)?.portfolioRisk??{})});
    if(!compiled.ok){const error=new Error(`PORTFOLIO_RISK_AUTHORITY_UNPROVEN:${compiled.blockers.join(',')}`) as Error&{blockers?:string[]};error.blockers=compiled.blockers;throw error;}
    const next=structuredClone(staged.settings) as any;
    Object.assign(next.riskGovernance.portfolioRisk,compiled.profileFacts);
    const {settings,authority}=await this.settingsStore.commitPortfolioRiskAuthority({facts:compiled.facts,settings:next,
      expectedSettingsVersion:input.expectedSettingsVersion,provenance:{operator:String(input.operator??'operator').slice(0,80)}});
    await this.applySavedSettings(settings);
    this.portfolioRiskAuthority={facts:authority,reasons:[],loadedAt:Date.now(),staleObservedContentHash:null};
    this.mirrorMarginTierCoverage(authority);
    this.events.publish('PORTFOLIO_RISK_AUTHORITY_COMMITTED',{settingsVersion:settings.settingsVersion,environment:authority.environment,accountScope:authority.accountScope,
      marginTierVersion:authority.margin.version,marginContentHash:authority.margin.contentHash,coverageSymbols:authority.margin.coverageSymbols.length,
      derivedMaintenanceMarginRatePct:authority.margin.maintenanceMarginRatePct,rateDerivation:authority.margin.derivation,
      correlationVersion:authority.correlation.version,scenarioVersion:authority.scenarios.version,scenarioCount:authority.scenarios.scenarios.length});
    return {settingsVersion:settings.settingsVersion,authority,readback:this.portfolioRiskAuthorityReadback()};
  }
  /** The operator projection: what the durable rows say, never a re-derivation in the page. */
  portfolioRiskAuthorityReadback(requiredSymbols:string[]=[]){
    return this.portfolioRisk?.profileReadback(requiredSymbols)??null;
  }
  /**
   * A read-only look at what a commit *would* say: the same GET-only collection and the same compiler,
   * with nothing persisted. Without this an operator facing a refusal can only guess which bracket the
   * server considered, and guessing invites hand-editing the database.
   */
  async collectPortfolioRiskAuthorityPreview(input:{limits:Record<string,unknown>;clusters:unknown;scenarios:unknown}){
    const scope=this.authorityScope();
    // The same universe the commit will price: a preview that names a narrower set than the commit
    // would let the operator approve a hash they are not actually about to get.
    const requiredSymbols=this.portfolioRiskCoverageUniverse();
    const sizingBound=this.portfolioRiskSizingBound({...input.limits});
    const bracketRead=await this.collectPortfolioRiskMarginBrackets(requiredSymbols);
    const compiled=portfolioRiskAuthorityCompile({environment:scope.environment,accountScope:scope.accountScope,bracketRead,requiredSymbols,
      clusters:input.clusters,scenarios:input.scenarios,credentialRef:scope.accountScope,committedAt:0,sizingBound});
    const canonical=canonicalizeMarginBrackets(bracketRead);
    return {
      collectedAt:Date.now(),environment:scope.environment,accountScope:scope.accountScope,requiredSymbols,
      collectionFailures:bracketRead.failures,sizingBound,
      perSymbol:canonical.dataset.map(row=>{
        const considered=row.tiers.filter(tier=>!sizingBound.maxEntryNotionalUsd||tier.notionalFloor<sizingBound.maxEntryNotionalUsd);
        return {symbol:row.symbol,tierCount:row.tiers.length,
          consideredTiers:considered.map(tier=>({bracket:tier.bracket,notionalFloor:tier.notionalFloor,notionalCap:tier.notionalCap,maintenanceMarginRatio:tier.maintenanceMarginRatio,initialLeverage:tier.initialLeverage})),
          highestConsideredRatio:considered.length?Math.max(...considered.map(tier=>tier.maintenanceMarginRatio)):null,
          highestAnyTierRatio:Math.max(...row.tiers.map(tier=>tier.maintenanceMarginRatio))};
      }),
      ok:compiled.ok,blockers:compiled.blockers,
      /** What the exchange actually reports per open position: the fact layer admission depends on. */
      positionRiskProbe:await this.trade?.probePositionRiskFields?.()??null,
      wouldCommit:compiled.ok?{marginTierVersion:compiled.facts.margin.version,contentHash:compiled.facts.margin.contentHash,
        derivedMaintenanceMarginRatePct:compiled.facts.margin.maintenanceMarginRatePct,derivation:compiled.facts.margin.derivation,
        coverageSymbols:compiled.facts.margin.coverageSymbols,correlationVersion:compiled.facts.correlation.version,scenarioVersion:compiled.facts.scenarios.version}:null,
    };
  }
  /**
   * Detect bracket drift against the committed authority. Finding a different table marks it stale,
   * which refuses new risk; it never adopts the new hash, because that would let the exchange move
   * the goalposts under an operator-approved profile.
   */
  async inspectPortfolioRiskAuthorityDrift(requiredSymbols=this.portfolioRiskCoverageUniverse()){
    const committed=this.portfolioRiskAuthority.facts;
    if(!committed)return {status:'NOT_COMMITTED' as const,reasons:this.portfolioRiskAuthority.reasons};
    let report:{status:string;reasons?:string[];committedMarginTierVersion?:string;observedMarginTierVersion?:string};
    try{
      const read=await this.collectPortfolioRiskMarginBrackets(requiredSymbols);
      const compiled=portfolioRiskAuthorityCompile({environment:this.authorityScope().environment,accountScope:this.authorityScope().accountScope,
        bracketRead:read,requiredSymbols,clusters:committed.correlation.clusters,scenarios:committed.scenarios.scenarios,
        credentialRef:this.authorityScope().accountScope,committedAt:committed.committedAt,reachability:committed.reachability,sizingBound:committed.sizingBound});
      if(!compiled.ok){this.portfolioRiskAuthority.staleObservedContentHash=`unproven:${compiled.blockers[0]??'UNKNOWN'}`;report={status:'UNPROVEN',reasons:compiled.blockers};}
      else{
        const moved=compiled.facts.margin.contentHash!==committed.margin.contentHash;
        this.portfolioRiskAuthority.staleObservedContentHash=moved?compiled.facts.margin.contentHash:null;
        report={status:moved?'STALE':'MATCHED',committedMarginTierVersion:committed.margin.version,observedMarginTierVersion:compiled.facts.margin.version};
      }
    }catch(error){
      const reason=String(error instanceof Error?error.message:error).slice(0,160);
      this.portfolioRiskAuthority.staleObservedContentHash=`unreadable:${reason}`;
      report={status:'UNREADABLE',reasons:[reason]};
    }
    this.portfolioRiskAuthorityDriftReport={...report,inspectedAt:Date.now()};
    if(report.status==='STALE')this.events.publish('PORTFOLIO_RISK_AUTHORITY_STALE',{committedMarginTierVersion:report.committedMarginTierVersion,observedMarginTierVersion:report.observedMarginTierVersion});
    return report;
  }
  pauseNewEntries(reason?: string) {
    return this.runtimeControl.pauseManual(reason);
  }
  resumeNewEntries() {
    return this.runtimeControl.resumeManual();
  }
  manualRiskPausePreview() {
    this.runtimeControl.evaluate(true);
    const control=this.state.runtimeControl,risk:any=this.state.account.riskBaseline??{},write=this.trade?.writeBoundaryMetrics(),physical={
      testnet:this.state.settings.connections.exchange.environment==='TESTNET'&&this.state.settings.connections.executionMode==='TESTNET_ENABLED',
      privateReady:this.state.account.status==='READY',marketReady:this.state.snapshots.size>0,
      entrySafetyAuto:control.entrySafetyMode==='AUTO',
      // Physical capacity excludes only the daily gate being explicitly reviewed.
      // Route dispatch and Preflight retain that gate; other blockers never qualify.
      executableCandidates:control.capital.routedCandidates.filter((route:any)=>route.longExecutable||route.shortExecutable||route.physicalCapacity?.LONG||route.physicalCapacity?.SHORT).length>=this.state.settings.runtimeControl.minExecutableCandidates,
    },reasons=Object.entries(physical).filter(([,pass])=>!pass).map(([name])=>name),workingOrders=[...this.state.entryOrders.values()].filter((order:any)=>['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(order.status));
    return {canOverride:control.mode==='PAUSED_DAILY_RISK_LIMIT'&&this.state.executionGovernance.mode==='AUTO_PAUSED_RISK'&&physical.testnet,physical:{...physical,ready:reasons.length===0,reasons},pauseReason:control.reasonText,runtimeMode:control.mode,executionMode:this.state.executionGovernance.mode,riskMetrics:{capitalEpochRealizedPnlUsd:Number(risk.capitalEpochRealizedPnlUsd??0),calendarDayRealizedPnlUsd:Number(risk.calendarDayRealizedPnlUsd??0),riskDrawdownPct:Number(risk.riskDrawdownPct??0),equityUsd:Number(this.state.account.equityUsd??0)},availableCapital:{usdt:control.capital.usdtAvailable,usdc:control.capital.usdcAvailable},executableCandidates:control.capital.executableCandidateCount,currentPositions:[...this.state.positions.values()].map((position:any)=>({symbol:position.symbol,side:position.side,quantity:position.quantity,markPrice:position.markPrice})),workingOrders:workingOrders.map((order:any)=>({id:order.id,symbol:order.symbol,side:order.side,status:order.status,quantity:order.quantity})),override:this.runtimeControl.manualRiskOverrideStatus(),writeBoundary:write};
  }
  manualRiskPauseOverride(reason?:string) {
    const preview=this.manualRiskPausePreview();
    if(!preview.canOverride)throw new Error('MANUAL_RISK_OVERRIDE_NOT_AVAILABLE');
    if(!preview.physical.ready)throw new Error(`MANUAL_RISK_OVERRIDE_PHYSICAL_BLOCKED:${preview.physical.reasons.join(',')}`);
    const override=this.runtimeControl.activateManualRiskOverride({environment:this.state.settings.connections.exchange.environment,executionMode:this.state.settings.connections.executionMode,executionGovernanceMode:this.state.executionGovernance.mode,reason:(reason??'Testnet 日内风险人工复核').slice(0,240)});
    this.state.executionGovernance={...this.state.executionGovernance,mode:'AUTO_RUNNING',changedAt:Date.now(),reason:'MANUAL_RISK_OVERRIDE_ACTIVE'};
    this.runtimeControl.evaluate(true);
    if(!this.runtimeControl.canDispatch())throw new Error('MANUAL_RISK_OVERRIDE_RECHECK_BLOCKED');
    const result={status:'AUTO_RUNNING',override,runtimeControl:this.runtimeControlStatus(),preview:this.manualRiskPausePreview()};
    this.events.publish('MANUAL_RISK_PAUSE_OVERRIDE',{reason:override.reason,previousState:override.previousState,operatorAction:override.operatorAction,riskMetrics:override.riskMetrics,timestamp:override.activatedAt,sessionScope:{riskCycleKey:override.riskCycleKey,expiresAt:override.expiresAt},availableCapital:preview.availableCapital,executableCandidates:preview.executableCandidates,currentPositions:preview.currentPositions,workingOrders:preview.workingOrders});
    this.settingsStore.persistRuntime(this.state.serialize());
    return result;
  }
  /**
   * J1: the FIRST_FILL management deadline is written exactly once, from the fill that opened the
   * cycle. A late partial fill, a restart or a re-observed position can never move it, and a cycle
   * without a durable plan is recorded without AI authority rather than inheriting the legacy
   * AUTO_MANAGED label (I01, I06).
   */
  private fixCycleDeadline(position: Position, now = Date.now()) {
    const exitRuntime = this.exitRuntime;
    if (!exitRuntime) return null;
    const cycleId = String(position.cycleId ?? '').trim();
    const firstFillAt = Number(position.openedAt ?? 0);
    const minutes = Number((this.state.settings as any).positionManagement?.humanHandoffAfterMinutes ?? 0);
    if (!cycleId || !Number.isFinite(firstFillAt) || firstFillAt <= 0 || firstFillAt > now) return null;
    if (!Number.isSafeInteger(minutes) || minutes <= 0) {
      this.events.publish('AI_MANAGEMENT_DEADLINE_UNPROVEN', { positionId: position.id, cycleId, reason: 'HANDOFF_DURATION_UNCONFIGURED' }, position.symbol);
      return null;
    }
    const subject = exitSubjectFromPosition(position);
    if (this.exitRuntime!.owner(subject)) return null;
    const written = exitRuntime.fixManagementDeadline(subject, minutes * 60_000, firstFillAt, position.profitTakePlan ? `plan:${cycleId}` : null);
    if (written) this.events.publish('AI_MANAGEMENT_DEADLINE_FIXED', { positionId: position.id, scope: exitRuntime.scope(subject), cycleId, ownerState: written.ownerState, deadline: written.deadline, planRef: written.planRef, source: 'FIRST_FILL' }, position.symbol);
    return written;
  }

  /**
   * J4: one bounded review request, assembled from the exact plan the budget was spent for. Nothing
   * here decides an exit: it turns the model's structured answer into a row that the exit path may
   * read only if the same authority still stands when it comes back.
   */
  private async reviewPosition(input:{ticket:ReviewTicket;position:any;plan:TradePlan}):Promise<ReviewAnswer>{
    const owner=this.exitRuntime?.ownerOfScope(input.ticket.scope,input.ticket.cycleId);
    const reviewOnly=input.ticket.reviewOnly===true;
    if(!owner||(reviewOnly?owner.ownerState!=='HUMAN_MANAGED':owner.ownerState!=='AI_ACTIVE'))throw new Error(`REVIEW_OWNER_NOT_REVIEWABLE_AT_CALL:${String(owner?.ownerState??'UNTRACKED')}`);
    if(Number(owner.ownerVersion)!==Number(input.ticket.ownerVersion))throw new Error('REVIEW_OWNER_VERSION_DRIFT_AT_CALL');
    const num=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;
    const coordination=(this.state.settings.riskGovernance as any)?.exitCoordination??{};
    const snapshot=this.state.snapshots.get(input.position.symbol) as any;
    const memory=reviewMemoryFor([...this.state.tradeRecords.values()],{
      direction:input.plan.side==='SHORT'?'SHORT':'LONG',excludeCycleId:input.ticket.cycleId});
    const request:PositionReviewRequest={
      symbol:input.position.symbol,cycleId:input.ticket.cycleId,positionId:input.position.id,
      planRef:input.plan.planId,planVersion:input.plan.planVersion,reviewNumber:input.ticket.reviewNumber,
      at:Date.now(),ownerVersion:input.ticket.ownerVersion,triggerKey:input.ticket.triggerKey,
      factsHash:String(snapshot?.technical?.['15m']?.asOf??0),
      position:{side:String(input.position.side),entryPrice:num(input.position.entryPrice)??0,quantity:num(input.position.quantity)??0,
        markPrice:num(snapshot?.quote?.mark??input.position.markPrice),unrealizedPnlUsd:num(input.position.unrealizedPnl),
        openedAt:num(input.position.openedAt)??0,managementDeadlineAt:reviewOnly?null:num(owner.deadline),
        remainingMs:reviewOnly||num(owner.deadline)==null?null:Math.max(0,Number(owner.deadline)-Date.now())},
      plan:{side:input.plan.side,quantityUnits:input.plan.quantityUnits,entryReferencePrice:input.plan.entryReferencePrice,
        targetPrice:input.plan.targetPrice,targetHorizonMinutes:input.plan.targetHorizonMinutes,thesis:input.plan.thesis,
        invalidationPredicate:input.plan.invalidationPredicate,predicateEvidenceRefs:[...input.plan.predicateEvidenceRefs],
        minNetProfitUsd:input.plan.minNetProfitUsd,maxRealizedLossUsd:input.plan.maxRealizedLossUsd,
        economicMandate:input.plan.economicMandate??null},
      budget:{normalReviewsPerPlan:Number(coordination.normalReviewsPerPlan??2),exceptionReviewsPerPlan:Number(coordination.exceptionReviewsPerPlan??1),
        used:Math.max(0,input.ticket.reviewNumber-1)},
      memory:memory.status==='READY'?memory.entries:{status:memory.status,reasons:memory.reasons},
    };
    const startedAt=Date.now();
    // Existing positions can outlive the current entry universe. Review needs the durable plan
    // and observed market facts, not an entry candidate or entry execution envelope.
    const reviewPacket={packetId:`position-review:${input.ticket.triggerKey}`,symbol:input.position.symbol,
      createdAt:Date.now(),market:snapshot??null,referenceMarkets:{btc:this.state.snapshots.get('BTCUSDT')??null,
        eth:this.state.snapshots.get('ETHUSDT')??null}} as unknown as import('@zdj/contracts').EntryIntelligencePacket;
    const {verdict,run,promptHash}=await this.ai.review(reviewPacket,request);
    return{decision:verdict.decision,runId:run.id,usage:{inputTokens:num(run.inputTokens),outputTokens:num(run.outputTokens)},
      finishReason:run.finishReason??null,modelIdentity:run.modelIdentity?JSON.stringify(run.modelIdentity):String(run.model??''),
      promptHash,latencyMs:num(run.latencyMs)??Math.max(0,Date.now()-startedAt),transportAttempts:num((run.timing as any)?.transportAttempts)};
  }

  /**
   * J4: the ledger sees every model request the Engine makes, failures and timeouts included. Review
   * rows are written by the scheduler because they carry the budget key, so REVIEW_BRAIN runs are
   * deliberately skipped here and no request is ever counted twice.
   */
  observeModelUsage(event:{id?:string;type:string;ts:number;payload:any}){
    const ledger=this.aiUsage;
    if(!ledger)return;
    const payload=event.payload??{};
    const num=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;
    if(event.type.startsWith('AI_RUN_')&&event.type!=='AI_RUN_TERMINAL'){
      if(payload.role==='REVIEW_BRAIN'||!payload.id||!Number(payload.startedAt))return;
      const status=event.type==='AI_RUN_FAILED'?'FAILED':event.type==='AI_RUN_STARTED'?'RUNNING':'COMPLETED';
      ledger.record(aiUsageRowOf({requestKey:String(payload.id),role:payload.role==='SCOUT'?'SCOUT':'ENTRY',status,
        inputTokens:payload.inputTokens,outputTokens:payload.outputTokens,latencyMs:payload.latencyMs,
        finishReason:payload.finishReason,promptHash:String(payload.promptHash??'missing-prompt-hash'),
        modelIdentity:payload.modelIdentity?JSON.stringify(payload.modelIdentity):String(payload.model??''),
        triggerReason:String(payload.triggerReason??'UNSTATED'),symbol:String(payload.symbol??''),
        errorCode:status==='FAILED'?String(payload.failure?.errorCode??'AI_RUN_FAILED'):null,
        startedAt:Number(payload.startedAt),completedAt:payload.completedAt,
        transportAttempts:num(payload.timing?.transportAttempts)}));
      return;
    }
    if(event.type==='EXTERNAL_RESEARCH_COMPLETED'||event.type==='EXTERNAL_RESEARCH_FAILED'){
      // The research endpoint reports no token usage at all, so these rows are UNKNOWN by fact. They
      // keep the request visible without ever letting a total be computed from a number nobody gave.
      const completedAt=num(event.ts)??Date.now();
      ledger.record(aiUsageRowOf({requestKey:String(payload.runId??`${event.type}:${completedAt}`),role:'EXTERNAL_RESEARCH',
        status:event.type==='EXTERNAL_RESEARCH_FAILED'?'FAILED':'COMPLETED',promptHash:'missing-prompt-hash',
        modelIdentity:payload.model?String(payload.model):null,triggerReason:`EXTERNAL_RESEARCH:${String(payload.sourceId??'')}`,
        symbol:'',latencyMs:payload.latencyMs,errorCode:event.type==='EXTERNAL_RESEARCH_FAILED'?'EXTERNAL_RESEARCH_FAILED':null,
        startedAt:completedAt-Math.max(0,num(payload.latencyMs)??0),completedAt}));
    }
  }

  /**
   * S06-E: a fill is recorded beside the plan it executed. The plan itself is never edited to match
   * the outcome, so a later review can still tell the prediction apart from what happened.
   */
  recordPlanExecutionFromFacts(payload: any, now = Date.now()) {
    const orderId = String(payload?.orderId ?? payload?.order?.id ?? '');
    const order: any = this.state.entryOrders.get(orderId) ?? [...this.state.entryOrders.values()].find((row: any) => row.id === orderId || row.exchangeOrderId === orderId);
    const intentId = String(order?.intentId ?? payload?.intentId ?? '');
    const intent: any = this.state.entryIntents.get(intentId);
    if (!intent?.planId) return null;
    const plan: any = this.state.tradePlans.get(String(intent.planId));
    if (!plan) return null;
    const stepSize = Number((this.state.snapshots.get(intent.symbol) as any)?.quote?.stepSize ?? 1);
    const filled = Number(order?.filledQuantity ?? payload?.filledQuantity ?? 0);
    const price = Number(order?.price ?? intent.idealPrice ?? 0);
    const record = executedPlanRecord({
      plan,
      intentId,
      reservationId: order?.reservationId ?? intent.reservationId ?? null,
      orderId: orderId || null,
      actualEntryPrice: Number.isFinite(price) && price > 0 ? price : null,
      executedQuantityUnits: V396ExitRuntime.quantityUnitsOf(filled, stepSize),
      feeActualUsd: null,
      source: filled > 0 && filled + 1e-12 >= Number(order?.quantity ?? filled) ? 'SYSTEM_FILL' : 'PARTIAL_FILL',
      now,
    });
    this.state.recordPlanExecution(record);
    this.events.publish('TRADE_PLAN_EXECUTION_RECORDED', { planId: plan.planId, cycleId: plan.cycleId, intentId, orderId: orderId || null,
      plannedEntryPrice: record.plannedEntryPrice, actualEntryPrice: record.actualEntryPrice, priceDeviationUsd: record.priceDeviationUsd,
      quantityDeviationUnits: record.quantityDeviationUnits, predictionMutated: false }, intent.symbol);
    return record;
  }

  /** Backstop for cycles that were already open when this process started. */
  fixFirstFillDeadlines(now = Date.now()) {
    let fixed = 0;
    for (const position of [...this.state.positions.values()]) if (this.fixCycleDeadline(position, now)) fixed++;
    return { fixed, candidates: this.state.positions.size };
  }

  /** Resolves the position a fill event speaks about; an unresolvable event is simply not a fill. */
  fixCycleDeadlineFromEvent(payload: any, now = Date.now()) {
    const position = this.state.positions.get(String(payload?.positionId ?? payload?.id ?? ''));
    return position ? this.fixCycleDeadline(position, now) : null;
  }

  /**
   * J1: continuous, bounded and read-only. Every pass re-proves a limited set of non-terminal exit
   * tasks against their stored clientOrderId; nothing here may submit, and the cadence plus the
   * batch size come from settings so the loop can never become unbounded polling.
   */
  async convergeExitsPeriodically(now = Date.now()) {
    const adapter = this.trade as any;
    if (!this.exitRuntime || !adapter?.findExitByClientOrderId) {
      // A silent early return here once hid a stopped convergence walk for hours: the reason belongs
      // in the readback, next to the queue it is keeping from draining.
      this.convergenceGate = { at: now, reason: !this.exitRuntime ? 'EXIT_RUNTIME_NOT_ATTACHED' : 'EXIT_ORDER_READER_UNAVAILABLE' };
      return this.convergenceGate;
    }
    const due = this.exitRuntime.convergenceDue(now);
    if (!due.due) { this.convergenceGate = { at: now, ...due }; return due; }
    // Marked before the await as well: a pass that is still running is a different fact from one that
    // never started, and the operator should be able to tell them apart without waiting for it to end.
    this.convergenceGate = { at: now, due: true as const, inFlight: true as const };
    const converged = await this.exitRuntime.convergePeriodically((input) => adapter.findExitByClientOrderId(input), now);
    this.convergenceGate = { at: now, due: true as const, attempted: converged.attempted };
    for (const task of (converged.converged ?? []).filter((row: any) => String(row.outcome).startsWith('EXCHANGE_FACT_')||String(row.outcome).startsWith('OBSERVE_REFUSED'))) {
      this.events.publish('EXIT_TASK_CONVERGED', { clientOrderId: task.clientOrderId, outcome: task.outcome, state: task.state }, undefined);
    }
    // P1 fairness readback: the queue depth and the age of the least-serviced order are published on
    // every pass, so starvation is a number an operator can watch rather than a guess.
    if ((converged as any).stats) this.events.publish('EXIT_CONVERGENCE_QUEUE', { ...((converged as any).stats), attempted: converged.attempted }, undefined);
    return converged;
  }

  /** P1: the exit-convergence projection used by the diagnostics readback. */
  exitConvergenceHealth(){
    if(!this.exitRuntime)return {available:false,reason:'EXIT_RUNTIME_NOT_ATTACHED'};
    const stats=this.exitRuntime.convergenceStats();
    return {available:true,...stats,unreleasedClaims:this.exitRuntime.recoveryPlan().mustQuery.length,
      // Why the walk is or is not running right now, in the operator's own words.
      passGate:this.convergenceGate??{reason:'NOT_YET_ATTEMPTED'}};
  }

  /**
   * P6: pull funding income into the durable ledger with its coverage window.
   *
   * The reader is the same paged income audit the trade-record sync uses. A row is only recorded for
   * a window whose pages all arrived, and a failed or short read records nothing at all: an empty
   * ledger is honest, a "zero funding" row invented from a missing read is not.
   */
  async syncFundingIncome(now=Date.now()){
    const ledger=this.fundingIncome;
    if(!ledger){this.lastFundingSync={at:now,rows:0,failures:0,symbolsScanned:0,skipped:'LEDGER_UNAVAILABLE'};return this.lastFundingSync;}
    // The outcome is kept for the operator readback: a funding ledger that proves nothing must say
    // whether it was read and found nothing, or never read at all. Silence is how an unattached
    // reader hides behind "UNKNOWN".
    const reader=(this.trade as any)?.fetchFundingIncome;
    if(typeof reader!=='function'){this.lastFundingSync={at:now,rows:0,failures:0,symbolsScanned:0,skipped:'INCOME_READER_UNAVAILABLE'};return this.lastFundingSync;}
    // The window starts at what the ledger already proved, rolled back one funding interval so an
    // income row that straddles the boundary is still re-read (the insert is idempotent by income id).
    const covered=Number(ledger.coverageSummary().coveredUntilMs??0);
    const since=covered>0?covered-2*3600_000:Math.max(0,now-48*3600_000);
    // One account-level read per pass: /fapi/v1/income returns every symbol at once, so a 40-symbol
    // book no longer costs 120 signed requests every ten minutes.
    let inserted=0,failures=0,assets:string[]=[],pages=0,complete=false,symbols=0;
    try{
      const facts=await reader.call(this.trade,since,now);
      const income=Array.isArray(facts?.rows)?facts.rows:[];
      complete=facts?.complete===true&&Number.isFinite(Number(facts?.coverageStart))&&Number(facts?.coverageStart)<=since&&Number(facts?.coverageEnd??0)>=now;
      pages=Math.max(0,Number(facts?.pages??0));
      symbols=new Set(income.map(row=>String(row.symbol??''))).size;
      const imported=ledger.recordRows(income.map(row=>({...row,observedAt:now,source:'FUNDING_INCOME_READ'})));inserted=imported.inserted;if(imported.rejected.length)complete=false;
      const seen=new Set<string>();
      for(const row of income){const asset=String((row as any)?.asset??'').trim().toUpperCase();if(asset)seen.add(asset);}
      assets=[...seen];
      for(const asset of new Set(['USDT','USDC',...assets]))ledger.recordCoverage({asset,sinceMs:since,untilMs:now,pages:Math.max(1,pages),
        rows:income.filter(row=>String(row.asset)===asset).length,complete,reason:complete?null:'INCOME_COVERAGE_INCOMPLETE'});
      if(!complete)this.events.publish('FUNDING_INCOME_COVERAGE_INCOMPLETE',{since,until:now,pages,rows:income.length},undefined);
    }catch(error){
      failures++;
      this.events.publish('FUNDING_INCOME_READ_FAILED',{reason:String(error instanceof Error?error.message:error)},undefined);
    }
    const summary={asOf:now,rows:inserted,assets,failures,pages,complete,symbols,symbolsScanned:symbols,coverage:ledger.coverageSummary()};
    this.lastFundingSync={at:now,rows:inserted,failures,symbolsScanned:symbols,skipped:null};
    if(inserted||failures)this.events.publish('FUNDING_INCOME_SYNCED',{rows:inserted,assets:assets.length,failures,pages,complete,symbols},undefined);
    return summary;
  }

  /** P6: fund cycles the ledger can prove, and leave the rest UNKNOWN. */
  attributeCycleFunding(now=Date.now()){
    const ledger=this.fundingIncome;
    if(!ledger)return {attributed:0,unknown:0};
    let attributed=0,unknown=0;
    for(const record of [...this.state.tradeRecords.values()] as any[]){

      const openedAt=Number(record.openedAt??0);
      if(!(openedAt>0)){unknown++;continue;}
      const fact=cycleFundingFact(ledger,record,[...this.state.tradeRecords.values()],now);
      if(fact.status!=='EXACT'){unknown++;if(record.fundingAttributionStatus==='EXACT')this.state.tradeRecords.set(record.tradeId,accountCycle({...record,funding:null,fundingAttributionStatus:'UNKNOWN',fundingCoverage:null},cycleFills(this.state,record)));continue;}
      if(record.fundingAttributionStatus==='EXACT'&&record.funding===fact.fundingUsd&&record.fundingCoverage?.untilMs===fact.coverage?.untilMs)continue;
      this.state.tradeRecords.set(record.tradeId,accountCycle({...record,funding:fact.fundingUsd,fundingAttributionStatus:'EXACT',
        fundingCoverage:{sinceMs:fact.coverage?.sinceMs??null,untilMs:fact.coverage?.untilMs??null,observedRows:fact.observedFundingRows,attributedAt:now},
        updatedAt:now},cycleFills(this.state,record)));
      attributed++;
      this.events.publish('TRADE_RECORD_FUNDING_ATTRIBUTED',{tradeId:record.tradeId,cycleId:record.cycleId,funding:fact.fundingUsd,observedRows:fact.observedFundingRows,coverage:fact.coverage},record.symbol);
    }
    return {attributed,unknown};
  }

  fundingIncomeCoverage(){const summary=this.fundingIncome?.coverageSummary?.()??null;
    return summary?{...summary,lastSync:this.lastFundingSync??{at:null,rows:0,failures:0,symbolsScanned:0,skipped:'NEVER_RAN'}}:null;}

  /**
   * C3: startup convergence for non-terminal exit tasks. Query only - it never resubmits, and an
   * ABSENT/unverified answer keeps the claim occupied as UNKNOWN so a later writer cannot fork it.
   */
  async convergeRecoveredExits(){
    const exitRuntime=this.exitRuntime,adapter=this.trade as any;
    if(!exitRuntime)return [];
    if(!adapter?.findExitByClientOrderId){this.events.publish('EXIT_RECOVERY_QUERY_UNAVAILABLE',{tasks:this.exitRuntime.tasksNeedingQuery().length},undefined);return [];}
    try{
      const converged=await exitRuntime.convergeRecoveredTasks((input)=>adapter.findExitByClientOrderId(input));
      // Legacy TP rows classified a known pre-wire egress refusal as ACK loss. Require both the
      // durable original error bound to this exact identity and today's authoritative ABSENT query.
      const absent=new Set(converged.filter(row=>row.outcome==='EXCHANGE_ABSENT_STAYS_UNACKED').map(row=>row.clientOrderId));
      if(absent.size){
        const evidence=this.settingsStore.runtimeEvents(0,['TP_SUBMIT_UNACKED_QUERY_BY_CLIENT_ID'],20000);
        for(const row of evidence){
          const payload=row.payload as any,clientOrderId=String(payload?.clientOrderId??''),task=exitRuntime.task(clientOrderId);
          if(!absent.has(clientOrderId)||!task||row.ts<task.createdAt||row.symbol!==V396ExitRuntime.parseScope(task.scope)?.symbol)continue;
          if(!exitRuntime.abortTpNotSent(clientOrderId,payload.reason,`runtime_events:${row.id}`))continue;
          for(const [id,order] of this.state.tpOrders)if(order.clientOrderId===clientOrderId&&!order.exchangeOrderId&&['UNKNOWN','REJECTED'].includes(order.status))this.state.tpOrders.set(id,{...order,status:'REJECTED',updatedAt:Date.now()});
          this.events.publish('TP_NOT_SENT_RECOVERY',{clientOrderId,evidenceId:row.id,reason:payload.reason,exactOrder:'ABSENT',exchangeWrites:0},row.symbol??undefined);
        }
      }
      if(converged.length)this.events.publish('EXIT_RECOVERY_CONVERGED',{tasks:converged},undefined);
      return converged;
    }catch(error){this.events.publish('EXIT_RECOVERY_FAILED',{reason:String(error instanceof Error?error.message:error)},undefined);return [];}
  }

  runtimeControlStatus() {
    return {
      ...this.state.runtimeControl,
      reservations: this.state.reservationSummary(),
      riskGovernance: this.state.settings.riskGovernance,
      shadowRunner: this.shadow.status(),
      executionGovernance: this.state.executionGovernance,
      capitalEpoch: this.liveValidation.getCapitalEpoch(),
      weeklyLiveValidation: this.liveValidation.getValidation(),
      manualRiskOverride: this.runtimeControl.manualRiskOverrideStatus(),
    };
  }
  setRuntimeIdentity(identity: RuntimeIdentity) {
    this.runtimeIdentity = identity;
    this.entry.setSchedulerInstanceId(identity.instanceId??null);
  }
  writeBoundaryMetrics(){return this.trade?.writeBoundaryMetrics()??{lockedToTestnet:true,productionWrites:0,blockedProductionWriteAttempts:0};}
  runtimeStatus() {
    const identity = this.runtimeIdentity,
      dataDir = this.settingsStore.dataDirectory(),
      probeCandidates = [
        path.join(dataDir, "runtime", "lan-supervisor-state.json"),
        path.resolve("data", "runtime", "lan-supervisor-state.json"),
        path.resolve(
          "..",
          "..",
          "data",
          "runtime",
          "lan-supervisor-state.json",
        ),
      ];
    let probe: any = null,
      probePath = probeCandidates[0];
    for (const candidate of probeCandidates) {
      try {
        probe = JSON.parse(
          readFileSync(candidate, "utf8").replace(/^\uFEFF/, ""),
        );
        probePath = candidate;
        break;
      } catch {}
    }
    const lanIps = currentLanIps();
    return {
      instanceId: identity?.instanceId ?? null,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      host: identity?.host ?? "0.0.0.0",
      port: identity?.port ?? 8080,
      version: identity?.version ?? RELEASE_VERSION,
      buildId: identity?.buildId ?? null,
      lanIps,
      lanUrls: lanIps.map((ip) => `http://${ip}:${identity?.port ?? 8080}`),
      listener: {
        alive: true,
        host: identity?.host ?? "0.0.0.0",
        port: identity?.port ?? 8080,
        ownerPid: process.pid,
      },
      lastRestartAt: identity?.startedAt ?? null,
      lastRestartReason: identity?.startReason ?? null,
      restartCount: identity?.restartCount ?? 0,
      runtimeDataDir: dataDir,
      supervisorProbePath: probePath,
      networkProfile: probe?.networkProfile ?? null,
      firewallRuleState: probe?.firewallRuleState ?? null,
      loopbackProbe: probe?.local ?? probe?.loopbackProbe ?? null,
      lanProbe: probe?.lan ?? probe?.lanProbe ?? null,
      supervisor: probe?.supervisor ?? { status: "NOT_RUNNING" },
      shadow: {
        status: this.shadow.status(),
        validObservationStartedAt:
          this.state.shadowRunner.validObservationStartedAt ?? null,
        validObservationRequiredUntil:
          this.state.shadowRunner.validObservationRequiredUntil ?? null,
      },
      autoResume: this.state.executionGovernance.mode === "AUTO_RUNNING",
      autoFrozen: this.state.executionGovernance.mode !== "AUTO_RUNNING",
    };
  }
  async prepareAutoReady() {
    const epoch = this.liveValidation.ensureCapitalEpoch();
    await this.liveValidation.refreshRiskBaseline(true);
    this.state.executionGovernance = {
      mode: "AUTO_READY",
      changedAt: Date.now(),
      reason: "PHASE_A_PREFLIGHT",
      capitalEpochId: epoch.capitalEpochId,
      validationId: null,
    };
    this.state.settings.riskGovernance.entrySafetyMode = "SAFETY_REVIEW_PAUSED";
    this.state.runtimeControl.entrySafetyMode = "SHADOW_READY";
    this.settingsStore.persistRuntime(this.state.serialize());
    this.events.publish("AUTO_READY_PREFLIGHT_STARTED", {
      capitalEpochId: epoch.capitalEpochId,
    });
    return this.liveValidation.snapshot();
  }
  async enableAutoForWeeklyValidation(authorization: string) {
    if (authorization !== "ENABLE_AUTO_FOR_7D_TESTNET_VALIDATION")
      throw new Error("EXPLICIT_AUTHORIZATION_REQUIRED");
    await this.liveValidation.refreshRiskBaseline(true);
    const readiness = this.liveValidation.readiness();
    if (!readiness.ready)
      throw new Error(
        `PHASE_A_NOT_READY:${readiness.blockingReasons.join(",")}`,
      );
    const next = structuredClone(this.state.settings);
    next.riskGovernance.entrySafetyMode = "AUTO";
    await this.updateSettings(next);
    this.state.runtimeControl.entrySafetyMode = "AUTO";
    this.state.runtimeControl = {
      ...this.state.runtimeControl,
      mode: "RUNNING",
      reasonCode: "MANUAL_RESUME",
      reasonText: "7-Day Testnet AUTO validation",
      pausedAt: null,
      pauseSource: "NONE",
      autoResume: true,
      lastTransitionAt: Date.now(),
    };
    const validation =
      await this.liveValidation.startWeeklyValidation(authorization);
    this.settingsStore.persistRuntime(this.state.serialize());
    return { validation, readiness: this.liveValidation.readiness() };
  }
  async enableCapitalAvailableAuto(confirmTestnetOnly: boolean) {
    if (!confirmTestnetOnly)
      throw new Error("TESTNET_ONLY_CONFIRMATION_REQUIRED");
    const write = this.trade?.writeBoundaryMetrics();
    if (
      this.state.settings.connections.exchange.environment !== "TESTNET" ||
      this.state.settings.connections.executionMode !== "TESTNET_ENABLED" ||
      !write?.lockedToTestnet
    )
      throw new Error('TESTNET_ONLY_WRITE_LOCK_REQUIRED');
    if (this.state.account.status !== "READY")
      throw new Error(`PRIVATE_DATA_${this.state.account.status}`);
    this.runtimeControl.evaluate(true);
    const capital = this.state.runtimeControl.capital;
    if (capital.usdtAvailable <= 0 && capital.usdcAvailable <= 0)
      throw new Error("NO_AVAILABLE_MARGIN_BALANCE");
    if (capital.executableCandidateCount < 1)
      throw new Error("NO_EXECUTABLE_CAPITAL_ROUTE");
    const epoch = this.liveValidation.ensureCapitalEpoch(
      "CAPITAL_AVAILABLE_AUTO_ENABLED",
    );
    const next = structuredClone(this.state.settings);
    next.riskGovernance.entrySafetyMode = "AUTO";
    const saved = await this.settingsStore.save(next);
    this.state.setSettings(saved);
    this.state.pool.updateSettings(saved);
    this.events.publish("SETTINGS_UPDATED", {
      generation: this.state.generation,
      scope: "ENTRY_SAFETY_ONLY",
    });
    this.universe.refresh();
    this.runtimeControl.evaluate(true);
    this.state.runtimeControl.entrySafetyMode = "AUTO";
    this.state.executionGovernance = {
      mode: "AUTO_RUNNING",
      changedAt: Date.now(),
      reason: "TESTNET_CAPITAL_AVAILABLE_AUTO",
      capitalEpochId: epoch.capitalEpochId,
      validationId: null,
    };
    this.settingsStore.persistRuntime(this.state.serialize());
    this.events.publish("TESTNET_CAPITAL_AVAILABLE_AUTO_ENABLED", {
      capitalEpochId: epoch.capitalEpochId,
      available: { usdt: capital.usdtAvailable, usdc: capital.usdcAvailable },
      executableCandidates: capital.executableCandidateCount,
    });
    void this.entry.processPool().catch((error) =>
      this.events.publish("ENTRY_ANALYSIS_FAILED", {
        message: error instanceof Error ? error.message : String(error),
        scope: "CAPITAL_AUTO_ENABLE",
      }),
    );
    return {
      executionGovernance: this.state.executionGovernance,
      runtimeControl: this.runtimeControlStatus(),
      writeBoundary: write,
    };
  }
  private startUserDataIfConfigured() {
    if (!this.trade?.hasCredentials()) return;
    this.state.account = {
      ...this.state.account,
      status: "SYNCING",
      reason: null,
    };
    this.trade.startUserData((raw) => {
      this.applyUserData(raw);
      this.events.publish("BINANCE_USER_DATA", {
        eventType: raw.e,
        transactionTime: raw.T ?? raw.E,
        symbol: raw.o?.s,
      });
      void this.syncPrivate('USER_DATA').catch((error) =>
        this.events.publish('PRIVATE_SYNC_CALLBACK_FAILED', {
          message: error instanceof Error ? error.message : String(error),
          trigger: 'USER_DATA',
        }),
      );
    });
  }
  private liveMarketSymbols() {
    return [
      ...new Set([
        ...this.state.pool.list().map((x) => x.symbol),
        ...this.state.positionSymbols(),
        ...this.state.activeEntrySymbols(),
      ]),
    ];
  }
  private syncLiveMarketSymbols() {
    if(this.cohort){this.market.setRetentionSymbols(this.cohort.runtimeRetentionSymbols());return;}
    this.market.setLiveSymbols(this.liveMarketSymbols());
  }
  private async refreshPositionMarkets() {
    this.syncLiveMarketSymbols();
    const missing = [...this.state.positionSymbols()].filter(
      (symbol) => !this.state.snapshots.has(symbol),
    );
    if (missing.length) {
      // Reconciliation can legitimately take many minutes when it has a large historical claim
      // inventory. Loading a single symbol before that serialized pass leaves every later position
      // without the quote/filter facts that TP repair needs for the whole reconciliation duration.
      // The market hub already bounds request concurrency and defers the remainder when the shared
      // request budget is pressured, so hand it the complete currently-missing position set here.
      await this.market.refreshSymbols(missing);
      this.universe.refresh();
      this.events.publish("POSITION_MARKETS_REFRESHED", {
        requested: missing.length,
        loaded: missing.filter((symbol) => this.state.snapshots.has(symbol))
          .length,
      });
    }
  }
  async validatePrivateCredentials(apiKey: string, apiSecret: string) {
    const candidate = new ExternalTradeAdapter(
      new BinanceTransport(this.state.settings.connections),
      { apiKey, apiSecret },
      this.state.settings.connections.exchange.recvWindowMs,
    );
    return candidate.validatePrivate();
  }
  async installSavedCredentials() {
    if (!this.trade) throw new Error("Private exchange adapter unavailable");
    const ref = this.state.settings.connections.exchange.credentialRef;
    const [apiKey, apiSecret] = await Promise.all([
      this.settingsStore.getSecret(`${ref}:apiKey`),
      this.settingsStore.getSecret(`${ref}:apiSecret`),
    ]);
    if (!apiKey || !apiSecret)
      throw new Error("Saved credentials are unavailable from SecretStore");
    this.trade.setCredentials({ apiKey, apiSecret });
    this.startUserDataIfConfigured();
    await this.syncPrivate();
    if (this.state.account.status === "READY") await this.reconciliation.run();
  }
  private privateAccountSync:PrivateAccountSync|null=null;
  privateSyncHealth(){return this.privateAccountSync?.health()??{inFlight:false,lastSuccessAt:null};}
  async syncPrivate(trigger='POLL') {
    this.privateAccountSync??=new PrivateAccountSync({configured:()=>Boolean(this.trade?.hasCredentials()),generation:()=>this.state.settings.settingsVersion,read:()=>this.trade!.fetchAccountSnapshot(),get:()=>this.state.account,set:value=>{this.state.account=value;},emit:(type,payload)=>this.events.publish(type,payload)});
    await this.privateAccountSync.sync(trigger);
  }
  private startTradeRecordAutoSync(startedAt: number) {
    const day = 24 * 60 * 60_000;
    this.tradeRecordAutoSyncStartedAt = startedAt;
    this.tradeRecordAutoSyncLastEndAt = null;
    this.tradeRecordAutoSync = {
      status: "WAITING_FOR_PRIVATE_DATA",
      startedAt,
      windowStart: startedAt - day,
      windowEnd: startedAt + day,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastWindow: null,
      lastResult: null,
      lastError: null,
    };
    // The initial read covers the full 24 hours before startup, including the
    // previous calendar day. Later reads overlap briefly to catch delayed facts.
    void this.runTradeRecordAutoSync();
    this.every(5 * 60_000, () => this.runTradeRecordAutoSync());
  }
  tradeRecordAutoSyncStatus() {
    return structuredClone(this.tradeRecordAutoSync);
  }
  private runTradeRecordAutoSync(): Promise<void> {
    if (this.tradeRecordAutoSyncFlight) return this.tradeRecordAutoSyncFlight;
    const flight = this.performTradeRecordAutoSync().finally(() => {
      if (this.tradeRecordAutoSyncFlight === flight)
        this.tradeRecordAutoSyncFlight = null;
    });
    this.tradeRecordAutoSyncFlight = flight;
    return flight;
  }
  private async performTradeRecordAutoSync() {
    const startedAt = this.tradeRecordAutoSyncStartedAt,
      day = 24 * 60 * 60_000;
    if (startedAt == null || this.stopped) return;
    const windowStart = startedAt - day,
      windowEnd = startedAt + day,
      now = Date.now();
    if (
      now >= windowEnd &&
      this.tradeRecordAutoSyncLastEndAt != null &&
      this.tradeRecordAutoSyncLastEndAt >= windowEnd
    ) {
      this.tradeRecordAutoSync.status = "COMPLETE";
      return;
    }
    const trade = this.trade as (ExternalTradeAdapter & { hasCredentials?: () => boolean }) | null;
    if (
      this.state.settings.connections.exchange.environment !== "TESTNET" ||
      !trade?.hasCredentials?.()
    ) {
      this.tradeRecordAutoSync.status = "WAITING_FOR_PRIVATE_DATA";
      return;
    }
    const finalAudit = now >= windowEnd,
      endTime = finalAudit ? windowEnd : now,
      fullAudit = finalAudit || this.tradeRecordAutoSyncLastEndAt == null,
      startTime = fullAudit
        ? windowStart
        : Math.max(windowStart, this.tradeRecordAutoSyncLastEndAt! - 5 * 60_000);
    if (endTime <= startTime) return;
    const maxFills = 1000,
      options = {
        includeExternal: false,
        repairPartial: true,
        fillFees: true,
        recalcNet: true,
      };
    this.tradeRecordAutoSync.status = "RUNNING";
    this.tradeRecordAutoSync.lastAttemptAt = now;
    this.tradeRecordAutoSync.lastError = null;
    try {
      const audit = await this.auditTradeRecordWindow(startTime, endTime, maxFills),
        syncFillLimit = maxFills * Math.max(1, Math.ceil((endTime - startTime) / day)),
        backupDir =
          process.env.ZDJ_TRADE_SYNC_BACKUP_DIR ??
          path.join(
            process.env.LOCALAPPDATA ?? process.cwd(),
            "ZDJ-MITS",
            "trade-sync-backups",
          );
      await mkdir(backupDir, { recursive: true });
      const backupPath = await this.settingsStore.tradeSyncBaseline(backupDir),
        service = new TradeRecordSyncService(this.state, this.positions),
        beforeRecords = new Map(this.state.tradeRecords),
        beforeSamples = new Map(this.state.experienceSamples),
        beforeFills = [...this.state.executionFills],
        beforeGeneration = this.state.generation,
        syncId = `auto_trade_sync_${startedAt}_${startTime}_${endTime}`;
      let result!: ReturnType<TradeRecordSyncService["apply"]>;
      try {
        await this.settingsStore.transaction(() => {
          result = service.apply(audit, syncFillLimit, options);
          for (const record of this.state.tradeRecords.values()) {
            if (JSON.stringify(beforeRecords.get(record.tradeId)) === JSON.stringify(record))
              continue;
            this.settingsStore.upsertTradeRecord(record);
            if (record.classification !== "COMPLETE")
              this.settingsStore.deleteExperienceSample(`sample_${record.tradeId}`);
          }
          for (const sample of result.samples)
            if (this.state.experienceSamples.has(sample.sampleId))
              this.settingsStore.upsertExperienceSample(sample);
          this.settingsStore.recordTradeSyncHistory({
            syncId,
            status: "APPLIED",
            source: "RUNTIME_AUTO",
            createdAt: Date.now(),
            options: { ...options, maxFills: syncFillLimit, window: audit.window, fullAudit },
            preview: result.preview,
            result: {
              created: result.created,
              repaired: result.repaired,
              skipped: result.skipped,
              newComplete: result.newComplete,
              newPartial: result.newPartial,
              experienceCreated: result.experienceCreated,
            },
            backupPath,
          });
        }, { timeoutMs: 5_000, label: "TRADE_RECORD_AUTO_SYNC" });
      } catch (error) {
        this.state.tradeRecords = beforeRecords;
        this.state.experienceSamples = beforeSamples;
        this.state.executionFills = beforeFills;
        this.state.generation = beforeGeneration;
        throw error;
      }
      this.tradeRecordAutoSyncLastEndAt = Math.max(
        this.tradeRecordAutoSyncLastEndAt ?? 0,
        endTime,
      );
      this.tradeRecordAutoSync.status = finalAudit ? "COMPLETE" : "ACTIVE";
      this.tradeRecordAutoSync.lastSuccessAt = Date.now();
      this.tradeRecordAutoSync.lastWindow = { startTime, endTime };
      this.tradeRecordAutoSync.lastResult = {
        systemFills: result.preview.systemFills,
        cyclesDetected: result.preview.cyclesDetected,
        created: result.created,
        repaired: result.repaired,
        complete: result.newComplete,
        partial: result.newPartial,
        unclosable: result.preview.unclosable,
      };
      this.events.publish(
        "TRADE_SYNC_AUTO_COMPLETED",
        {
          syncId,
          window: audit.window,
          fullAudit,
          ...this.tradeRecordAutoSync.lastResult,
        },
        "TRADE_RECORD",
      );
    } catch (error) {
      this.tradeRecordAutoSync.status = "ERROR";
      this.tradeRecordAutoSync.lastError = String(error).slice(0, 240);
      this.events.publish(
        "TRADE_SYNC_AUTO_FAILED",
        {
          message: this.tradeRecordAutoSync.lastError,
          window: { startTime, endTime },
        },
        "TRADE_RECORD",
      );
    }
  }
  private async auditTradeRecordWindow(startTime: number, endTime: number, maxFills: number) {
    const day = 24 * 60 * 60_000,
      chunks: Array<{ startTime: number; endTime: number }> = [];
    for (let cursor = startTime; cursor < endTime; ) {
      const chunkEnd = Math.min(endTime, cursor + day);
      chunks.push({ startTime: cursor, endTime: chunkEnd });
      cursor = chunkEnd;
    }
    const audits = [];
    for (const window of chunks)
      audits.push(await this.auditRecentTrades(24, maxFills, window.startTime, window.endTime));
    const fillMap = new Map<string, TradeAuditSnapshot["fills"][number]>(),
      orderMap = new Map<string, TradeAuditSnapshot["orders"][number]>(),
      incomeMap = new Map<string, TradeAuditSnapshot["income"][number]>();
    for (const audit of audits) {
      for (const fill of audit.fills) fillMap.set(`${fill.symbol}:${fill.tradeId}`, fill);
      for (const order of audit.orders) orderMap.set(`${order.symbol}:${order.orderId}`, order);
      for (const income of audit.income)
        incomeMap.set(`${income.symbol}:${income.tradeId}:${income.transactionId}:${income.time}`, income);
    }
    const latest = audits.at(-1);
    if (!latest) throw new Error("TRADE_AUDIT_WINDOW_EMPTY");
    return {
      ...latest,
      window: { startTime, endTime },
      fills: [...fillMap.values()].sort((a, b) => a.executionTime - b.executionTime),
      orders: [...orderMap.values()],
      income: [...incomeMap.values()],
    };
  }
  async auditRecentTrades(
    hours = 5,
    maxFills = 500,
    startTime?: number,
    endTime?: number,
  ) {
    if (!this.trade?.fetchRecentTradeAudit)
      throw new Error("PRIVATE_TRADE_AUDIT_UNAVAILABLE");
    const safeHours = Math.min(24, Math.max(1, Number(hours) || 5)),
      end = endTime ?? Date.now(),
      start = startTime ?? end - safeHours * 60 * 60_000,
      provenanceSymbols = [
        ...new Set(
          [...this.state.entryOrders.values()]
            .filter((order) => order.createdAt <= end && order.updatedAt >= start)
            .map((order) => String(order.symbol).toUpperCase())
            .filter((symbol) => /^[A-Z0-9]{3,20}(USDT|USDC|BUSD)$/.test(symbol)),
        ),
      ];
    // V3.9.4: the adapter owns the complete union and reads income globally plus
    // userTrades/allOrders once per symbol. Do not run a second per-symbol pass.
    return this.trade.fetchRecentTradeAudit(
      start,
      end,
      Math.min(1000, Math.max(100, Number(maxFills) || 500)),
      provenanceSymbols,
    );
  }
  async repairRecentSystemTradeRecords(hours = 5) {
    const audit = await this.auditRecentTrades(hours, 500),
      service = new TradeRecordSyncService(this.state, this.positions),
      result = service.apply(audit, 500, {
        repairPartial: true,
        fillFees: true,
        recalcNet: true,
      });
    for (const record of result.records)
      this.settingsStore.upsertTradeRecord(record);
    for (const sample of result.samples)
      this.settingsStore.upsertExperienceSample(sample);
    return {
      audit,
      repair: {
        cyclesDetected: result.preview.cyclesDetected,
        cyclesRepaired: result.created + result.repaired,
        completeCycles: result.newComplete,
        partialCycles: result.newPartial,
        repaired: result.records,
      },
    };
  }
  applyUserData(raw: any) {
    if (raw?.e === "ACCOUNT_UPDATE") {
      if(raw.a?.m==='FUNDING_FEE')this.events.publish('TRADING_QUALITY_FUNDING_FACT',{transactionTime:raw.T??raw.E,balances:raw.a.B??[],positions:raw.a.P??[],attribution:'ACCOUNT_FACT_NOT_EPISODE_ALLOCATION'});

      // ACCOUNT_UPDATE is a delta, not a complete available-margin snapshot.
      const at=Number(raw.T??raw.E);
      if(Number.isFinite(at)&&at>0&&at<=Date.now()+5000)for(const row of raw.a?.P??[]){
        const amount=Number(row.pa),symbol=String(row.s??''),ps=String(row.ps??'');
        if(!symbol||!Number.isFinite(amount)||!['LONG','SHORT','BOTH'].includes(ps))continue;
        for(const side of ps==='BOTH'?['LONG','SHORT']:[ps]){
          const key=symbol+':'+side;
          if(at<=(this.state.positionFactTimes.get(key)??0))continue;
          this.state.positionFactTimes.set(key,at);
          for(const position of [...this.state.positions.values()] as any[]){
            if(position.symbol!==symbol||position.side!==side||at<Number(position.openedAt??0))continue;
            const quantity=ps==='BOTH'&&((side==='LONG'&&amount<0)||(side==='SHORT'&&amount>0))?0:Math.abs(amount);
            if(quantity===0){this.positions.onReconciledClose(position,'RECONCILIATION');this.state.positions.delete(position.id);this.events.publish('POSITION_CLOSED_USER_DATA',{positionId:position.id,transactionTime:at},symbol);}
            else {const price=Number(row.ep),pnl=Number(row.up);this.state.positions.set(position.id,{...position,quantity,...(price>0?{entryPrice:price}:{}),...(Number.isFinite(pnl)?{unrealizedPnl:pnl}:{}),tpStatus:quantity===position.quantity?position.tpStatus:'PENDING'});}
          }
        }
      }
    }

    if (raw?.e === "ORDER_TRADE_UPDATE" && raw.o) {
      const o = raw.o;
      this.trade?.invalidateOrderFact?.(String(o.s??""),o.i==null?null:String(o.i),o.c==null?null:String(o.c));
      // P1: an order state change is an exit-order fact whether or not it carried a fill this tick.
      // WS used to update only the order projections, which is how a FILLED take-profit left its
      // durable task and quantity claim at WORKING/ACTIVE.
      const updateAt=Number(o.T ?? raw.T ?? Date.now());
      this.exitRuntime?.recordExitOrderReport('USER_DATA_WS',{
        symbol:String(o.s??''),clientOrderId:String(o.c??''),exchangeOrderId:String(o.i??''),
        positionSide:['LONG','SHORT'].includes(String(o.ps)) ? String(o.ps) : 'BOTH',
        status:String(o.X??''),originalQuantity:Number(o.o??0),executedQuantity:Number(o.z??0),updateTime:updateAt,
      },Number.isFinite(updateAt)?updateAt:Date.now());
      const
        qty = Number(o.l ?? 0);
      if (qty > 0) {
        const positionSide = ["LONG", "SHORT"].includes(String(o.ps))
          ? String(o.ps)
          : "BOTH";
        try {
          this.positions.recordExchangeFill({
            fillId: `exchange_${String(o.s)}_${String(o.t ?? o.T ?? raw.T ?? Date.now())}`,
            symbol: String(o.s),
            side: String(o.S) === "BUY" ? "BUY" : "SELL",
            positionSide: positionSide as "LONG" | "SHORT" | "BOTH",
            orderId: String(o.i),
            clientOrderId: String(o.c ?? ""),
            tradeId: String(o.t ?? o.T ?? raw.T ?? Date.now()),
            executionTime: Number(o.T ?? raw.T ?? Date.now()),
            qty,
            price: Number(o.L ?? o.ap ?? 0) || Number(o.p ?? 0),
            realizedPnl: Number(o.rp ?? 0),
            commission: Math.abs(Number(o.n ?? 0)),
            commissionAsset: String(o.N ?? "USDT"),
            commissionUsd: ["USDT", "USDC", "BUSD"].includes(
              String(o.N ?? "").toUpperCase(),
            )
              ? Math.abs(Number(o.n ?? 0))
              : null,
            maker: Boolean(o.m),
            source: "USER_DATA_WS",
          });
        } catch (error) {
          this.events.publish(
            "EXECUTION_FILL_REJECTED",
            { message: error instanceof Error ? error.message : String(error) },
            String(o.s),
          );
        }
      }
    }
  }
  readinessProjection() {
    const privateDataStatus = this.state.account.status;
    const marketReady = this.state.snapshots.size > 0;
    const overall = !marketReady
      ? "OFFLINE"
      : privateDataStatus === "READY"
        ? "READY"
        : privateDataStatus === "NOT_CONFIGURED"
          ? "READ_ONLY"
          : "DEGRADED";
    return {
      overall,
      privateDataStatus,
      reason: this.state.account.reason,
      entrySafetyMode: this.state.runtimeControl.entrySafetyMode,
      executionMode: this.state.executionGovernance.mode,
      shadowRunner: this.shadow.status(),
      userDataWs: this.trade?.userDataMetrics() ?? { state: "NOT_CONFIGURED" },
      reconciliation: this.reconciliation.health(),
    };
  }
  supplyHealth(poolItems=this.state.pool.list()) {
    return buildSupplyHealth({universe:this.state.universe,pool:poolItems,snapshots:this.state.snapshots,positions:this.state.positionSymbols(),activeEntries:this.state.activeEntrySymbols(),capacity:this.state.entryCapacity(),runtimeControl:this.state.runtimeControl,aiResources:this.ai.resourceMetrics(),target:Math.min(this.state.settings.selection.poolMax,this.state.settings.selection.poolTarget),lowWatermark:4});
  }
  pipelineStatus() {
    const now = Date.now(),
      eligible = this.state.universe.filter(
        (x) => x.eligible && x.rank > 0,
      ).length,
      positions = this.state.positions.size,
      pending = this.state.activeEntrySymbols().size,
      poolItems = this.state.pool.list(),
      freshness = this.market.freshness(),
      stream:any = this.market.metrics(),
      primary = this.state.aiRuns.filter((x) => x.role === "PRIMARY_BRAIN"),
      latestPrimary = primary[0],
      marketInsufficient =
        freshness.fresh <
        Math.min(
          this.state.settings.selection.poolTarget,
          Math.max(1, Math.floor(freshness.total * 0.5)),
        ),
      cooldown = this.state.universe.filter((x) =>
        x.exclusionReasons.includes("REJECT_COOLDOWN"),
      ).length,
      excluded = this.state.universe.filter(
        (x) =>
          x.exclusionReasons.includes("ACTIVE_POSITION") ||
          x.exclusionReasons.includes("ACTIVE_ENTRY_ORDER"),
      ).length;
    const slotCapacity = this.state.entryCapacity();
    // G3: the symbols the pipeline could actually dispatch next are the ones whose data matters. A broken
    // candle sequence on one of them isolates that symbol; the rest keep their Entry cycle.
    const marketIsolation = marketDataIsolation({
      candidateSymbols: [
        ...poolItems.map((item: any) => String(item.symbol)),
        ...(this.state.runtimeControl?.capital?.routedCandidates ?? []).map((row: any) => String(row.symbol)),
      ],
      readinessReasons: (symbol: string) => this.market.primaryReadyReasons(symbol, now),
    }),
      marketDataReason = marketDataStaleReason({
        freshness,
        marketInsufficient,
        streamState: stream.state,
        streamError: stream.lastError,
        isolation: marketIsolation,
      }),
      pipelineState = marketDataReason ? "PAUSED_MARKET_DATA_UNAVAILABLE" : "RUNNING";
    const supply=this.supplyHealth(poolItems),{qualifiedSupply,readySupply,target,targetGap,supplyShortage,refillFailure}=supply;
    let poolStatus = supplyShortage ? "POOL_SUPPLY_SHORTAGE" : refillFailure ? "POOL_REFILL_FAILURE" : "POOL_READY";
    if (!poolItems.length&&!supplyShortage&&!refillFailure) {
      if (marketInsufficient) poolStatus = "POOL_EMPTY_MARKET_DEGRADED";
      else if (cooldown && cooldown + excluded >= this.state.universe.length)
        poolStatus = "POOL_EMPTY_ALL_COOLDOWN";
      else if (excluded && excluded >= this.state.universe.length)
        poolStatus = "POOL_EMPTY_ALL_EXCLUDED";
      else if (!eligible) poolStatus = "POOL_EMPTY_NO_ELIGIBLE";
      else poolStatus = "POOL_REFILLING";
    }
    let noEntryReason: string | null = null;
    if (!this.ready) noEntryReason = "SCHEDULER_STOPPED";
    else if (this.state.executionGovernance.mode !== "AUTO_RUNNING")
      noEntryReason = this.state.executionGovernance.mode;
    else if (this.state.runtimeControl.mode !== "RUNNING")
      noEntryReason = this.state.runtimeControl.reasonText;
    else if (marketDataReason)
      noEntryReason = pipelineState;
    else if (
      this.state.account.status !== "READY" ||
      this.state.settings.connections.executionMode !== "TESTNET_ENABLED"
    )
      noEntryReason = "ENTRY_BLOCKED";
    else if (!testnetFundsOnlyEntry(this.state.settings)&&pending >= this.state.settings.portfolio.maxPendingEntries)
      noEntryReason = "ENTRY_BACKPRESSURE";
    else if (!poolItems.length) noEntryReason = poolStatus;
    else if(!testnetFundsOnlyEntry(this.state.settings)&&slotCapacity.used>=this.state.settings.portfolio.maxPositions)noEntryReason='POSITION_CAPACITY_FULL';
    else if(this.state.runtimeControl.capital.executableCandidateCount===0)noEntryReason='WAITING_EXECUTION_CAPACITY';
    const primaryHealth=this.ai.resourceMetrics().find(r=>r.role==='PRIMARY_BRAIN');
    if(this.ready&&this.state.executionGovernance.mode==='AUTO_RUNNING'&&this.state.runtimeControl.mode==='RUNNING'){
    if(!primaryHealth||primaryHealth.connectionStatus==='OFFLINE')noEntryReason='PRIMARY_MODEL_OFFLINE';
    else if(primaryHealth.connectionStatus==='UNKNOWN')noEntryReason='PRIMARY_MODEL_HEALTH_UNKNOWN';
    else if(!privateAccountFresh(this.state.account))noEntryReason='PRIVATE_DATA_UNAVAILABLE';
    }
    const resources = this.ai.resourceMetrics(),
      paused = !this.runtimeControl.canDispatch(),
      activeResource = resources.find((x) => x.currentStatus === "ANALYZING"),
      lastDirection = latestPrimary?.direction ?? null,
      lastDecision = latestPrimary?.decision ?? null,
      lastPrimaryAge = latestPrimary ? now - latestPrimary.startedAt : null,
      primaryIdleReason = resources.find((x) => x.role === "PRIMARY_BRAIN")?.idleReason ?? null,
      // Supply-side idleness is not a model fault: the primary had nothing dispatchable, or its
      // single slot was busy. Only an unexplained gap stays DEGRADED.
      primaryBrainState = primaryBrainHealth({
        paused,
        ready: this.ready,
        eligible,
        executableCandidates: this.state.runtimeControl.capital.executableCandidateCount,
        poolResidents: poolItems.length,
        pendingEntries: pending,
        maxPendingEntries: this.state.settings.portfolio.maxPendingEntries,
        modelOnline: resources.some((x) => x.role === "PRIMARY_BRAIN" && x.status !== "OFFLINE"),
        lastRunAgeMs: lastPrimaryAge,
        idleReason: primaryIdleReason,
      }),
      unexplainedIdle = primaryBrainState.unexplainedIdle,
      primaryObservationState = primaryObservation({runtimePaused:paused,marketOpen:!marketDataReason,resourceFault:primaryBrainState.status==='DEGRADED'||primaryBrainState.status==='UNAVAILABLE',idleReason:primaryIdleReason,lastRunAt:latestPrimary?.startedAt??null,now,maxIdleMs:10*60_000});
    const activityBase = this.state.activity,
      since = now - 30 * 60_000,
      recentEvents = this.settingsStore.runtimeEvents(
        since,
        [
          "PRIMARY_DECISION_NORMALIZED",
          "ENTRY_INTENT_CREATED",
          "ENTRY_ORDER_CREATED",
          "ENTRY_FILLED",
        ],
        5000,
      ),
      recentPrimary = recentEvents.filter(
        (event) => event.type === "PRIMARY_DECISION_NORMALIZED",
      ),
      recentPlace = recentPrimary.filter((event) =>
        String((event.payload as any)?.normalizedDecision ?? "").startsWith(
          "PLACE_",
        ),
      ),
      recentReject = recentPrimary.filter(
        (event) =>
          String((event.payload as any)?.normalizedDecision ?? "") ===
          "REJECT_CANDIDATE",
      ),
      activity = {
        ...activityBase,
        primaryCount30m: recentPrimary.length,
        placeCount30m: recentPlace.length,
        rejectCount30m: recentReject.length,
        entryIntentCount30m: recentEvents.filter(
          (event) => event.type === "ENTRY_INTENT_CREATED",
        ).length,
        submitCount30m: recentEvents.filter(
          (event) => event.type === "ENTRY_ORDER_CREATED",
        ).length,
        fillCount30m: recentEvents.filter(
          (event) => event.type === "ENTRY_FILLED",
        ).length,
      },
      lifecycleRows=[...this.state.candidateLifecycle.values()],
      lifecycleCounts=lifecycleRows.reduce((counts:any,row:any)=>{counts[row.status]=(counts[row.status]??0)+1;return counts;},{}),
      aiEvents=this.settingsStore.runtimeEvents(since,["AI_RUN_COMPLETED","AI_RUN_FAILED","AI_PROTOCOL_NORMALIZED","CANDIDATE_LIFECYCLE_CHANGED"],5000),
      aiFailures=aiEvents.filter(event=>event.type==="AI_RUN_FAILED"),
      recentAiHealth=this.settingsStore.aiRunHealthSummary(since),
      consecutiveAiFailures=recentAiHealth.consecutiveFailures,
      aiHealth={
        completed:recentAiHealth.completed,
        failed:aiFailures.length,
        dataError:aiEvents.filter((event:any)=>!event.payload||event.payload?.dataError||event.payload?.auditTruncated).length,
        rawPlaceFailed:aiFailures.filter((event:any)=>['PLACE_LONG','PLACE_SHORT'].includes(event.payload?.rawDecision)).length,
        schemaInvalid:aiFailures.filter((event:any)=>event.payload?.failure?.errorCode==="AI_SCHEMA_INVALID").length,
        normalized:aiEvents.filter(event=>event.type==="AI_PROTOCOL_NORMALIZED").length,
        timeout:aiFailures.filter((event:any)=>event.payload?.failure?.timeout).length,
        cooldown:(lifecycleCounts.REJECT_COOLDOWN??0)+(lifecycleCounts.AI_FAILURE_COOLDOWN??0)+(lifecycleCounts.TECHNICAL_COOLDOWN??0),
        quarantine:lifecycleCounts.QUARANTINED??0,
        topError:[...aiFailures.reduce((m:Map<string,number>,event:any)=>m.set(event.payload?.failure?.errorCode??"AI_RUN_FAILED",(m.get(event.payload?.failure?.errorCode??"AI_RUN_FAILED")??0)+1),new Map()).entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null,
        consecutiveFailures:consecutiveAiFailures,
        alert:consecutiveAiFailures>=3?"AI_CONSECUTIVE_FAILURE":null,
      },
      entryConversion = entryConversionReport((since) => this.settingsStore.runtimeEvents(since, [...ENTRY_CONVERSION_EVENT_TYPES], 20_000), now, {fundsOnly: testnetFundsOnlyEntry(this.state.settings), economicAdmissionMode: this.state.settings.tradeEconomics?.admissionMode ?? 'OFF'}),
      stagnated = Boolean(
        this.ready &&
        eligible > 0 && this.state.runtimeControl.capital.executableCandidateCount>0 &&
        poolItems.length &&
        resources.some(
          (x) => x.role === "PRIMARY_BRAIN" && x.status !== "OFFLINE",
        ) &&
        activity.consecutiveRejects >=
          Math.max(10, this.state.settings.selection.poolTarget) &&
        (!activity.lastEntryIntentAt ||
          now - activity.lastEntryIntentAt > 10 * 60_000),
      );
    // One computation site each for the capacity view, the readiness snapshot and the market freshness
    // block, so the authoritative verdict and the fields it describes can never drift apart.
    const freshMarkets = {
        status: marketInsufficient ? "DEGRADED" : freshness.stale.length ? "RECOVERING" : "FRESH",
        count: freshness.fresh,
        stale: freshness.stale,
        quoteFreshRatio: freshness.quoteFreshRatio,
        klineFreshRatio: freshness.klineFreshRatio,
        sequenceInvalid: freshness.sequenceInvalid,
      },
      admissionBookSummary = bookAdmissionSummary(this.state, now),
      capacityView = portfolioCapacityVisibility(slotCapacity,this.state.runtimeControl.capital.directionBudget,{
        // Read the funding block from the live account at projection time: the durable route summary can
        // lag a build behind, and a stale ledger array must never zero out the money the account has.
        funding:entryTradingCapital(this.state,now),
        routes:this.state.runtimeControl.capital.routedCandidates??[],
        // One read of the committing gate serves both the per-candidate rows and the book verdict, so the
        // page cannot show room the gate refuses and cannot name a cause the gate did not give.
        admission:admissionBookSummary,
        traces:(()=>{const built=entrySideCapacityTraces(this.state,this.state.runtimeControl.capital.routedCandidates??[],{coverageSymbols:this.portfolioRiskAuthority?.facts?.margin.coverageSymbols??null,now,admission:admissionBookSummary});return [...built.LONG,...built.SHORT];})(),
      }),
      eligibilityView = {status: eligible ? "READY" : "BLOCKED", count: eligible, cooldown, excluded},
      executionReadinessView = this.executionReadinessSnapshot(now),
      analysisView = this.entry.analysisDiagnostics(),
      authoritativeBlocker = authoritativePipelineVerdict({now, noEntryReason, pipelineState, marketDataReason,
        marketIsolation, executionReadiness: executionReadinessView, capacityVisibility: capacityView,
        slots: {used: slotCapacity.used, max: slotCapacity.max}, eligibility: eligibilityView,
        executableCandidateCount: this.state.runtimeControl.capital.executableCandidateCount, poolStatus,
        analysisReason: analysisView?.reason ?? null, idleReason: primaryIdleReason,
        pendingEntries: pending, maxPendingEntries: this.state.settings.portfolio.maxPendingEntries, freshMarkets,
        riskAdmission: this.entry.riskAdmissionVerdict(now)});
    return {
      runtimeControl: this.state.runtimeControl,
      asOf:now,observationVersion:`${this.state.marketGeneration}:${this.state.runtimeControl.capital.generation}:${this.state.account.asOf}`,
      capacity:slotCapacity,privateSync:this.privateSyncHealth(),
      capacityVisibility: capacityView,
      entryResourcePolicy:{mode:testnetFundsOnlyEntry(this.state.settings)?'TESTNET_FUNDS_ONLY':'LEGACY_RISK_ENFORCED',portfolioRiskVeto:!testnetFundsOnlyEntry(this.state.settings),fundingSource:'EXCHANGE_AVAILABLE_BALANCE',executionCorrectnessEnforced:true},
      // G4: what is stopping a new Entry right now, and the action that matches it. Pages render this and
      // nothing else as the first cause; every other status field is a subordinate diagnostic.
      authoritativeBlocker,
      pipelineState,
      marketDataReason,
      // The isolated symbols stay visible as facts about themselves, whether or not the pipeline paused.
      marketDataIsolation: {
        candidateCount: marketIsolation.candidateCount,
        isolatedCount: marketIsolation.isolated.length,
        healthyCandidates: marketIsolation.healthyCandidates,
        isolated: marketIsolation.isolated.slice(0, 12),
      },
      marketDataDetail: marketDataReason ? { streamState: stream.state, streamError: stream.lastError ?? null, quotesFresh: freshness.quoteFresh, orderBooksFresh: freshness.orderBookFresh, healthyCandidates: marketIsolation.healthyCandidates } : null,
      market: {
        status: this.state.snapshots.size ? "READY" : "OFFLINE",
        count: this.state.snapshots.size,
      },
      freshMarkets,
      pool: {
        target,qualifiedSupply,readySupply,ready:supply.readyCount,display:poolItems.length,targetGap,supplyShortage,refillFailure,health:supply,
        status: poolStatus,
        current: poolItems.length,
      },
      universe: {
        status: this.state.universe.length ? "READY" : "SYNCING",
        count: this.state.universe.length,
      },
      eligibility: eligibilityView,
      scout: {
        status: paused
          ? "PAUSED"
          : resources.some((x) => x.role === "SCOUT" && x.status !== "OFFLINE")
            ? "READY"
            : "UNAVAILABLE",
        runs: resources.find(x=>x.role==="SCOUT")?.totalRuns??0,
        historicalRuns:this.state.aiRuns.filter(x=>x.role==="SCOUT").length,
        resource: resources.find((x) => x.role === "SCOUT"),
      },
      primaryBrain: {
        status: primaryBrainState.status,
        observation: primaryObservationState,
        alert: primaryObservationState==='RESOURCE_FAULT'?'PRIMARY_RESOURCE_FAULT':primaryObservationState==='RUNTIME_PAUSED'?null:primaryObservationState==='MARKET_PAUSE'?null:null,
        runs: resources.find(x=>x.role==="PRIMARY_BRAIN")?.totalRuns??0,
        historicalRuns:primary.length,
        resource: resources.find((x) => x.role === "PRIMARY_BRAIN"),
        lastRunAgeMs: lastPrimaryAge,
        idleReason: primaryIdleReason,
        healthReason: primaryBrainState.reason,
      },
      existingPositions: { status: "FACT", count: positions },
      excludedSymbols: {
        status: "FACT",
        count: this.state.positionSymbols().size + pending,
      },
      pendingEntries: {
        status: "FACT",
        count: pending,
        max: this.state.settings.portfolio.maxPendingEntries,
      },
      entryPermission: {
        status: noEntryReason ? "BLOCKED" : "READY",
        executionMode: this.state.settings.connections.executionMode,
        autoExecutionMode: this.state.executionGovernance.mode,
      },
      binancePrivate: { status: this.state.account.status,asOf:this.state.account.asOf,reason:this.state.account.reason,...this.privateSyncHealth() },
      reconciliation: {
        status: this.reconciliation.health().lastError||this.reconciliation.health().unresolvedDriftCount ? "DEGRADED" : "READY",
        ...this.reconciliation.health(),
      },
      takeProfit: {
        status:
          this.tp.metrics().missing ||
          this.tp.metrics().repairFailed ||
          this.tp.metrics().orphanTp ||
          this.tp.metrics().duplicateTp ||
          this.tp.metrics().qtyMismatch ||
          this.tp.metrics().wrongSide
            ? "DEGRADED"
            : "READY",
        ...this.tp.metrics(),
      },
      analysis: analysisView,
      portfolioRiskProfile: this.portfolioRisk?.profileReadback?.()??null,
      executionReadiness:executionReadinessView,
      scheduler: {
        status: paused ? "PAUSED" : this.ready ? "RUNNING" : "STOPPED",
      },
      work: {
        current: activeResource
          ? `${activeResource.role} 正在分析 ${activeResource.currentSymbol}`
          : (resources.find((x) => x.role === "PRIMARY_BRAIN")?.idleReason ??
            "等待候选"),
        recentDecision: latestPrimary
          ? {
              symbol: latestPrimary.symbol,
              direction: lastDirection,
              decision: lastDecision,
              at: latestPrimary.completedAt,
            }
          : null,
        next:
          activeResource?.nextStep ??
          resources.find((x) => x.role === "PRIMARY_BRAIN")?.nextStep ??
          "等待调度",
      },
      entryActivity: activity,
      entryConversion,
      candidateLifecycle:{counts:lifecycleCounts,nextCandidate:poolItems.find(item=>item.state==="READY")?.symbol??null,primaryWaiters:[...this.state.candidateLifecycle.values()].filter((row:any)=>row.status==="PRIMARY_QUEUED").map((row:any)=>row.symbol)},
      aiHealth,
      stagnation: stagnated
        ? {
            status: "建仓停滞",
            reason:
              activity.consecutiveRejects >=
              Math.max(10, this.state.settings.selection.poolTarget)
                ? "候选连续拒绝，需检查 1m/5m 时机与可达 Maker 区间"
                : "长时间没有 Entry Intent",
          }
        : null,
      noEntryReason,
    };
  }
  health() {
    const rec = this.reconciliation.health(),
      persistence = this.settingsStore.operationalMetrics();
    return [
      {
        id: "trading-network",
        label: "Trading Network Gate",
        status:
          this.state.settings.connections.executionMode === "TESTNET_ENABLED" &&
          this.state.account.status !== "READY"
            ? "DEGRADED"
            : "HEALTHY",
        detail:
          this.state.settings.connections.executionMode === "TESTNET_ENABLED"
            ? "Testnet writes remain gated by credentials and private readiness"
            : "Read-only public market mode",
        updatedAt: Date.now(),
      },
      {
        id: "market",
        label: "Market Data Hub",
        status: this.state.snapshots.size ? "HEALTHY" : "OFFLINE",
        detail: `${this.state.snapshots.size} snapshots; stream=${JSON.stringify({ ...this.market.metrics(), ...this.market.freshness() })}`,
        updatedAt: Date.now(),
      },
      {
        id: "pool",
        label: "Dynamic Trading Pool",
        status: this.state.pool.list().length ? "HEALTHY" : "DEGRADED",
        detail: `${this.state.pool.list().length}/${this.state.settings.selection.poolTarget} active`,
        updatedAt: Date.now(),
      },
      {
        id: "ai",
        label: "AI Fabric",
        status: this.state.aiResources.some((x) => x.status !== "OFFLINE")
          ? "HEALTHY"
          : "OFFLINE",
        detail: `${this.state.aiResources.length} resources`,
        updatedAt: Date.now(),
      },
      {
        id: "reconciliation",
        label: "Reconciliation",
        status: rec.lastError ? "DEGRADED" : "HEALTHY",
        detail: rec.lastError ?? `drift=${rec.driftCount}`,
        updatedAt: rec.lastRun || Date.now(),
      },
      {
        id: "tp",
        label: "TP Guardian",
        status:
          this.tp.metrics().missing ||
          this.tp.metrics().repairFailed ||
          this.tp.metrics().positionFactUnresolved ||
          this.tp.metrics().qtyMismatch ||
          this.tp.metrics().wrongSide
            ? "DEGRADED"
            : "HEALTHY",
        detail: JSON.stringify(this.tp.metrics()),
        updatedAt: Date.now(),
      },
      {
        id: "persistence",
        label: "Persistence / Audit",
        status: persistence.integrity ? "HEALTHY" : "OFFLINE",
        detail: JSON.stringify(persistence),
        updatedAt: Date.now(),
      },
    ] as const;
  }
  readiness() {
    const database = this.settingsStore.operationalMetrics();
    const projection = this.readinessProjection();
    return {
      status: this.ready ? projection.overall : "STARTING",
      ready: this.ready && projection.overall !== "OFFLINE",
      checks: {
        database,
        marketSnapshots: this.state.snapshots.size,
        reconciliation: this.reconciliation.health(),
        marketStream: this.market.metrics(),
        privateData: this.state.account,
      },
    };
  }
}

import type {TradingQualityRuntimeObserver} from '../services/tradingQualityRuntimeObserver.js';
import { TradingQualityCollector } from '../services/tradingQualityCollector.js';
import { privateAccountFresh } from '../services/privateAccountReadiness.js';
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
import { RELEASE_VERSION } from "@zdj/contracts";
import { TemporalIntelligenceService } from "../services/temporalIntelligenceService.js";
import { LiveValidationService } from "../services/liveValidationService.js";
import {ExternalIntelligenceService} from "../services/externalIntelligenceService.js";
import {ExternalResearchService} from "../services/externalResearchService.js";
import { AssetGovernanceCoordinator } from '../services/assetGovernanceCoordinator.js';
import { ProductionAssetResearchService } from '../services/productionAssetResearch.js';
import { MarketCohort } from '../services/marketCohort.js';
import { marketDataStaleReason } from '../services/marketDataStaleness.js';
import { LossHandoffService } from '../services/lossHandoff.js';

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
  lossHandoff!: LossHandoffService;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  private ready = false;
  public qualityObserver:TradingQualityRuntimeObserver|null=null;
  public tradingQuality: TradingQualityCollector | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private trade: ExternalTradeAdapter | null = null;
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
    for(const saved of store.loadManualExecutions()) {
      const existing=state.manualOrders.get(saved.order.id);if(existing&&existing.updatedAt>saved.order.updatedAt){store.saveManualExecution({intent:state.manualIntents.get(saved.intent.id)??saved.intent,order:existing});continue;}
      state.manualIntents.set(saved.intent.id,saved.intent);
      state.manualOrders.set(saved.order.id,saved.order);
    }
    const durableEntries=store.loadEntryExecutions();
    for(const saved of durableEntries) {
      const existing=state.entryOrders.get(saved.order.id);if(existing&&existing.updatedAt>saved.order.updatedAt){store.saveEntryExecution({intent:state.entryIntents.get(saved.intent.id)??saved.intent,order:existing});continue;}
      state.entryIntents.set(saved.intent.id,saved.intent);state.entryOrders.set(saved.order.id,saved.order);
      if(saved.reservation){const reservation=saved.reservation as any;state.entryReservations.set(reservation.id,reservation);}
    }
    const unverifiedUnsent=[...state.entryOrders.values()].filter(o=>o.status==='UNKNOWN'&&!o.exchangeOrderId&&o.filledQuantity===0&&!durableEntries.some(d=>d.intent.id===o.intentId));
    if(unverifiedUnsent.length){const evidence=store.runtimeEvents(Math.min(...unverifiedUnsent.map(o=>o.createdAt)),['ENTRY_ORDER_BLOCKED','ENTRY_SUBMIT_ATTEMPTED'],5000),durableIds=new Set(durableEntries.map(d=>d.intent.id));for(const order of unverifiedUnsent){const recovered=recoverUnsubmittedEntry(order,durableIds,evidence);if(recovered){state.entryOrders.set(order.id,recovered);if(order.reservationId)state.releaseEntryReservation(order.reservationId);}}}
    // Testnet entry safety is AUTO, while persisted operator/risk pauses remain
    // authoritative across restart. Only the obsolete no-candidate pause migrates.
    if (
      !testHarness &&
      settings.connections.exchange.environment === "TESTNET" &&
      settings.connections.executionMode === "TESTNET_ENABLED"
    ) {
      const next = structuredClone(settings);
      next.riskGovernance.entrySafetyMode = "AUTO";
      const saved = await store.save(next);
      state.setSettings(saved);
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
    const market = new MarketDataHub(provider, state, events),
      universe = new UniverseCoordinator(state, events),
      experience = new ExperienceService(state),
      externalIntelligence=new ExternalIntelligenceService(state,store,events),
      eip = new EipService(state, experience,externalIntelligence),
      ai = new AiFabric(state, events, eip),
      positions = new PositionService(state, events),
      tp = new TpGuardian(state, trade, events),
      entry = new EntryCoordinator(state, eip, ai, trade, events,market,{claim:(scope,value,retry)=>store.claimEntryExecution(scope,value,retry),save:value=>store.saveEntryExecution(value)}),
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
    runtime.shadowReadiness = new ShadowReadinessService(state, store);
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
      store,
    );
    if (trade instanceof ExternalTradeAdapter) runtime.trade = trade;
    (state as any).tradingQualityEvidenceReady=false;
    try{runtime.tradingQuality = new TradingQualityCollector(path.join(opts.dataDir,"trading-quality.sqlite"),state,events);}catch(error){events.publish('TRADING_QUALITY_STORAGE_UNAVAILABLE',{reason:String(error)});}
    events.on("event", (event) => {
      if(runtime.persistenceClosed)return;
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
      }
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
      this.state.settings.connections.executionMode === "TESTNET_ENABLED" &&
      this.runtimeControl.canDispatch()
    )
      void this.entry.processPool().catch((error) =>
        this.events.publish("ENTRY_ANALYSIS_FAILED", {
          message: error instanceof Error ? error.message : String(error),
          scope: "BOOTSTRAP",
        }),
      );
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
      if (this.state.settings.connections.executionMode === "TESTNET_ENABLED") {
        if (this.runtimeControl.canDispatch()) await this.entry.processPool();
      }
    });
    // Model latency must never delay order TTL, cancellation or repricing.
    this.every(2_000,async()=>{
      if(this.state.settings.connections.executionMode==='TESTNET_ENABLED')await this.entry.reviewPending();
    });
    this.every(2_000,async()=>{if(this.state.settings.connections.executionMode==='TESTNET_ENABLED')await this.manual.resumeExitGoals();});
    this.every(1_000,()=>this.writes.flush());
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
    finally{this.persistenceClosed=true;this.qualityObserver?.close();this.tradingQuality?.close();this.settingsStore.close();}
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
    ).slice(0,1);
    if (missing.length) {
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
    const marketDataReason = marketDataStaleReason({
      freshness,
      marketInsufficient,
      streamState: stream.state,
      streamError: stream.lastError,
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
    else if (pending >= this.state.settings.portfolio.maxPendingEntries)
      noEntryReason = "ENTRY_BACKPRESSURE";
    else if (!poolItems.length) noEntryReason = poolStatus;
    else if(this.state.entryCapacity().used>=this.state.settings.portfolio.maxPositions)noEntryReason='POSITION_CAPACITY_FULL';
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
      unexplainedIdle = Boolean(
        !paused &&
        this.ready &&
        eligible > 0 && this.state.runtimeControl.capital.executableCandidateCount>0 &&
        poolItems.length &&
        pending < this.state.settings.portfolio.maxPendingEntries &&
        resources.some(
          (x) => x.role === "PRIMARY_BRAIN" && x.status !== "OFFLINE",
        ) &&
        lastPrimaryAge !== null &&
        lastPrimaryAge > 10 * 60_000,
      );
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
    return {
      runtimeControl: this.state.runtimeControl,
      asOf:now,observationVersion:`${this.state.marketGeneration}:${this.state.runtimeControl.capital.generation}:${this.state.account.asOf}`,
      capacity:this.state.entryCapacity(),privateSync:this.privateSyncHealth(),
      pipelineState,
      marketDataReason,
      marketDataDetail: marketDataReason ? { streamState: stream.state, streamError: stream.lastError ?? null, quotesFresh: freshness.quoteFresh, orderBooksFresh: freshness.orderBookFresh } : null,
      market: {
        status: this.state.snapshots.size ? "READY" : "OFFLINE",
        count: this.state.snapshots.size,
      },
      freshMarkets: {
        status: marketInsufficient
          ? "DEGRADED"
          : freshness.stale.length
            ? "RECOVERING"
            : "FRESH",
        count: freshness.fresh,
        stale: freshness.stale,
        quoteFreshRatio: freshness.quoteFreshRatio,
        klineFreshRatio: freshness.klineFreshRatio,
        sequenceInvalid: freshness.sequenceInvalid,
      },
      pool: {
        target,qualifiedSupply,readySupply,ready:supply.readyCount,display:poolItems.length,targetGap,supplyShortage,refillFailure,health:supply,
        status: poolStatus,
        current: poolItems.length,
      },
      universe: {
        status: this.state.universe.length ? "READY" : "SYNCING",
        count: this.state.universe.length,
      },
      eligibility: {
        status: eligible ? "READY" : "BLOCKED",
        count: eligible,
        cooldown,
        excluded,
      },
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
        status: paused
          ? "PAUSED"
          : unexplainedIdle
            ? "DEGRADED"
            : resources.some(
                  (x) => x.role === "PRIMARY_BRAIN" && x.status !== "OFFLINE",
                )
              ? "READY"
              : "UNAVAILABLE",
        runs: resources.find(x=>x.role==="PRIMARY_BRAIN")?.totalRuns??0,
        historicalRuns:primary.length,
        resource: resources.find((x) => x.role === "PRIMARY_BRAIN"),
        lastRunAgeMs: lastPrimaryAge,
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

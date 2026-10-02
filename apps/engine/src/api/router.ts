import { filterFormalOutcome, projectTradeRecordRow, projectTradeRecordSummary } from '../services/tradeRecordReadModel.js';
function tradeCloseProvenance(record:any,runtime:EngineRuntime){
  if(!Number.isFinite(record.closedAt))return'OPEN';
  const ids=new Set((record.exitOrderIds??[]).map((id:unknown)=>String(id)));
  const fills=runtime.state.executionFills.filter((fill:any)=>fill.symbol===record.symbol&&
    (ids.has(String(fill.orderId??''))||ids.has(String(fill.clientOrderId??''))));
  const roles=new Set<string>();let externalExchangeFact=false;
  for(const fill of fills){
    const proof=runtime.state.orderProvenance?.resolve?.({symbol:fill.symbol,clientOrderId:fill.clientOrderId,exchangeOrderId:fill.orderId});
    for(const item of proof?.rows??[])roles.add(String(item.role));
    if(fill.attributionStatus==='EXTERNAL_OR_UNLINKED'&&['EXCHANGE_AUDIT','USER_DATA_WS'].includes(String(fill.source)))externalExchangeFact=true;
  }
  if(roles.has('TP')&&roles.size===1)return'TP';
  if(roles.has('EXIT')&&roles.size===1)return'SYSTEM_EXIT';
  if(roles.has('MANUAL')&&roles.size===1)return'SYSTEM_MANUAL';
  if(roles.size>0)return'CONFLICT';
  if(externalExchangeFact||record.source==='EXTERNAL')return'EXCHANGE_CLOSE';
  return'UNKNOWN';
}
import { binanceRequestBudgetsHealth } from '../adapters/binance/requestBudget.js';
import { Router } from "express";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { EngineRuntime } from "../runtime/appRuntime.js";
import { binanceTransportGovernance } from "../adapters/binance/BinanceTransport.js";
import { dashboardProjection } from "./projections.js";
import { TradeRecordIntegrityService } from "../services/tradeRecordIntegrityService.js";
import { TradeRecordSyncService } from "../services/tradeRecordSyncService.js";
import type { TradeAuditSnapshot } from "../types.js";
import { resolveUnderlying } from '@zdj/core';
import { canonicalBlacklistValue } from '../services/universeCoordinator.js';
import { ProductionAssetResearchService } from '../services/productionAssetResearch.js';
import { archivedPacket, projectBrainRun } from '../services/brainRunArchive.js';
import { p0EntryIntegrity } from '../services/p0EntryIntegrity.js';
import { byClosedAtDesc, byOpenedAtDesc } from './chronologicalSort.js';
import { entryObservation } from '../services/entryObservation.js';
import { ENTRY_CONVERSION_EVENT_TYPES, EXECUTION_LINEAGE_GRACE_MS, projectRunExecutionOutcomes } from '../services/runExecutionOutcome.js';
import { projectHumanManaged } from '../services/humanManagedProjection.js';
import { candidateAnalysisEligibility, entryPermissionReadback } from '../services/entryPermissionModel.js';
import { portfolioScopeObservation } from '../services/entrySubmissionIdentity.js';
import { activeExecutionLeaseMargin } from '../services/executionLease.js';
import { bookAdmissionSummary } from '../services/admissionCapacityReader.js';
import { testnetFundsOnlyEntry } from '@zdj/core';
import { exitSubjectFromPosition } from '../services/v396ExitRuntime.js';
import { entryCancelEligibility } from './entryCancelEligibility.js';

/**
 * Attach the Engine's execution answer to one page of run rows.
 *
 * The page is folded from the durable journal in a single pass, so the list and the detail view read
 * the same authority. Scout rows get `execution: null` - they never had an order to place, and a
 * dash in that column is a fact rather than a missing one.
 */
export function withExecutionOutcomes(runtime: EngineRuntime, items: any[]) {
  const rows = Array.isArray(items) ? items : [];
  const primaries = rows.filter((row) => row?.role === 'PRIMARY_BRAIN' && row?.id);
  if (!primaries.length) return rows.map((row) => ({...row, execution: null}));
  const ends = primaries.map((row) => Number(row.completedAt ?? row.startedAt ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
  const since = Math.min(...ends) - 60_000;
  const until = Math.max(...ends) + EXECUTION_LINEAGE_GRACE_MS;
  const events = runtime.settingsStore
    .runtimeEvents(since, [...ENTRY_CONVERSION_EVENT_TYPES], 20_000)
    .filter((event: any) => Number(event.ts) <= until);
  const outcomes = projectRunExecutionOutcomes(events, primaries.map((row) => ({
    brainRunId: String(row.id),
    symbol: row.symbol ?? null,
    decision: row.decision ?? null,
    direction: row.direction ?? null,
    decidedAt: Number(row.completedAt ?? row.startedAt ?? Date.now()),
  })));
  return rows.map((row) => ({
    ...row,
    execution: row?.role === 'PRIMARY_BRAIN' ? outcomes.get(String(row.id)) ?? null : null,
  }));
}

export function createApiRouter(runtime: EngineRuntime) {
  const r = Router();
  r.get('/observability/trading-quality',(_req,res)=>res.json({health:runtime.tradingQuality?.health()??{status:'UNAVAILABLE'},policy:runtime.state.settings.tradingQuality??{mode:'OFF'},report:runtime.tradingQuality?.report()??null,v393:runtime.qualityObserver?.report()??{status:'UNAVAILABLE'}}));
  r.get('/observability/entry',(req,res)=>{const identity=runtime.runtimeStatus(),start=Number(identity.lastRestartAt??Date.now()),requested=Number(req.query.since??start),since=Number.isFinite(requested)?Math.max(start,requested):start,untilValue=Number(req.query.until??Date.now()),until=Number.isFinite(untilValue)?Math.min(Date.now(),Math.max(since,untilValue)):Date.now(),archived=runtime.settingsStore.listEntryObservationRuns(since,until,10001),runs=[...new Map([...archived,...runtime.state.aiRuns].filter(r=>r.startedAt>=since&&r.startedAt<=until&&r.role==='PRIMARY_BRAIN').map(r=>[r.id,r])).values()].map(r=>r.completedAt&&r.completedAt>until?{...r,status:'RUNNING',decision:null}:r),adapterEvents=runtime.settingsStore.runtimeEvents(since,['ENTRY_ADAPTER_REQUEST_FACTS','ENTRY_ADAPTER_RESPONSE_FACTS'],100000).filter((event:any)=>event.ts<=until);res.json({...entryObservation({runs,intents:[...runtime.state.entryIntents.values()],orders:[...runtime.state.entryOrders.values()],fills:runtime.state.executionFills.filter(f=>f.executionTime<=until),adapterEvents,runtime:identity}),window:{since,until,truncated:archived.length>=10001,source:'DURABLE_PRIMARY_ARCHIVE'}});});
  let snapshotVersion=0,publishTimer:NodeJS.Timeout|null=null,stopping=false;
  r.use((_q,res,next)=>stopping?res.status(503).json({error:{message:"ENGINE_STOPPING"}}):next());
  const publishSnapshot=()=>{
    const asOf=Date.now(),reconciliation=runtime.reconciliation.health();
    publishedSnapshot=Object.freeze({...dashboardProjection(runtime),snapshotVersion:++snapshotVersion,asOf,observationVersion:`${runtime.state.marketGeneration}:${runtime.state.runtimeControl.capital.generation}:${runtime.state.account.asOf}`,reconciliation:{state:(reconciliation as any).running?'RUNNING':(reconciliation as any).lastError?'DEGRADED':'SETTLED',verifiedOrderFactMismatchCount:Number((reconciliation as any).verifiedOrderFactMismatchCount??0)}});
  };
  let publishedSnapshot:any;
  publishSnapshot();
  runtime.events.on('event',event=>{if(event.type==='RUNTIME_STOPPING'||event.type==='RUNTIME_STOPPED'){stopping=true;if(publishTimer)clearTimeout(publishTimer);publishTimer=null;return;}if(stopping||publishTimer)return;publishTimer=setTimeout(()=>{publishTimer=null;if(!stopping)publishSnapshot();},250);publishTimer.unref();});
  const normalizeRecords = () => {
    const summary = new TradeRecordIntegrityService(
      runtime.state,
    ).classifyAll();
    for (const record of runtime.state.tradeRecords.values()) {
      runtime.settingsStore.upsertTradeRecord(record);
      if (record.classification !== "COMPLETE")
        runtime.settingsStore.deleteExperienceSample(`sample_${record.tradeId}`);
    }
    return summary;
  };
  const syncInput = (body: any) => {
    const range = String(body?.range ?? "5h"),
      hours =
        range === "1h"
          ? 1
          : range === "24h"
            ? 24
            : range === "custom"
              ? Math.max(
                  1,
                  Math.min(
                    24,
                    (Number(body?.endTime ?? Date.now()) -
                      Number(body?.startTime ?? Date.now() - 5 * 60 * 60_000)) /
                      60 /
                      60_000,
                  ),
                )
              : 5,
      maxFills = Math.min(1000, Math.max(100, Number(body?.maxFills ?? 500)));
    const startTime = range === "custom" ? Number(body?.startTime) : undefined,
      endTime = range === "custom" ? Number(body?.endTime) : undefined;
    if (
      range === "custom" &&
      (!Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        endTime <= startTime)
    )
      throw new Error("SYNC_CUSTOM_RANGE_INVALID");
    return {
      range,
      hours,
      maxFills,
      startTime,
      endTime,
      includeExternal: Boolean(body?.includeExternal),
      repairPartial: body?.repairPartial !== false,
      fillFees: body?.fillFees !== false,
      recalcNet: body?.recalcNet !== false,
    };
  };
  r.get('/diagnostics/storage',(_req,res)=>res.json({...runtime.writes.health(),checkpoint:runtime.settingsStore.checkpointMetrics()}));
  r.get('/diagnostics/closeout',(_req,res)=>{const asOf=Date.now(),status=runtime.runtimeStatus();res.json({asOf,observationVersion:`${runtime.state.marketGeneration}:${runtime.state.runtimeControl.capital.generation}:${runtime.state.account.asOf}`,runtime:{pid:process.pid,...status},persistence:runtime.settingsStore.operationalMetrics(),pipeline:runtime.pipelineStatus(),hot:runtime.market.hotFreshnessDiagnostics(asOf),productionWriteBoundary:runtime.writeBoundaryMetrics()});});
  r.get("/snapshot", (_q, res) => res.json(publishedSnapshot));
  r.get("/universe", (_q, res) =>
    res.json({
      generation: runtime.state.generation,
      candidates: runtime.state.universe,
    }),
  );
  r.get("/pool", (_q, res) => res.json({ items: runtime.state.pool.list() }));
  r.post('/universe/blacklist',async(req,res,next)=>{try{const scope=String(req.body?.scope??''),reason=String(req.body?.reason??'');if(!['SYMBOL','UNDERLYING'].includes(scope)||reason!=='USER_BLACKLIST')throw new Error('INVALID_BLACKLIST_REQUEST');const symbol=canonicalBlacklistValue(req.body?.symbol??''),candidate=runtime.state.universe.find((row:any)=>canonicalBlacklistValue(row.symbol)===symbol),underlying=canonicalBlacklistValue(req.body?.underlying??candidate?.underlyingAsset??(symbol?resolveUnderlying(symbol):''));if(scope==='SYMBOL'&&(!symbol||!candidate))throw new Error('INVALID_BLACKLIST_SYMBOL');if(scope==='UNDERLYING'&&!underlying)throw new Error('INVALID_BLACKLIST_UNDERLYING');const current=runtime.state.settings,next={...current,selection:{...current.selection,marketQuality:{...current.selection.marketQuality,symbolBlacklist:[...current.selection.marketQuality.symbolBlacklist],underlyingBlacklist:[...current.selection.marketQuality.underlyingBlacklist]}}};const list=scope==='SYMBOL'?next.selection.marketQuality.symbolBlacklist:next.selection.marketQuality.underlyingBlacklist,value=scope==='SYMBOL'?symbol:underlying;if(!list.map(canonicalBlacklistValue).includes(value))list.push(value);const saved=await runtime.updateSettings(next);runtime.universe.refresh();runtime.events.publish('USER_BLACKLIST_APPLIED',{symbol:scope==='SYMBOL'?symbol:null,underlying,scope,reason,settingsVersion:saved.settingsVersion},scope==='SYMBOL'?symbol:undefined);res.json({ok:true,symbol:scope==='SYMBOL'?symbol:null,underlying,scope,reason,settingsVersion:saved.settingsVersion});}catch(error){next(error);}});
  r.post('/universe/asset-research/refresh',async(_req,res,next)=>{try{const directory=runtime.state.settings.selection.assetDirectory;const facts=await ProductionAssetResearchService.fromSettings(runtime.state.settings.connections,directory.approvedLiquid).refresh();runtime.events.publish('PRODUCTION_ASSET_RESEARCH_REFRESHED',{sourceDomain:'PRODUCTION_PUBLIC_RESEARCH',executionDomain:'TESTNET_EXECUTION',count:facts.length,executionSnapshotsChanged:false});res.json({sourceDomain:'PRODUCTION_PUBLIC_RESEARCH',executionSnapshotsChanged:false,facts});}catch(error){next(error);}});
  r.post('/universe/asset-directory/review',async(req,res,next)=>{try{const apply=req.body?.apply===true,result=apply?await runtime.assetGovernance.tick(true,'MANUAL'):await runtime.assetGovernance.preview('MANUAL');res.json({status:result.status,rawReview:result.review??null,publishedDirectory:apply?result.directory??null:null,previewDirectory:apply?null:result.directory??null,applied:apply,settingsVersion:result.settings?.settingsVersion??result.settingsVersion??runtime.state.settings.settingsVersion,retryAt:result.retryAt??null,executionWrites:0});}catch(error){next(error);}});
  r.post("/pool/refresh", async (_q, res, next) => {
    try {
      runtime.universe.refresh();
      await runtime.entry.processPool();
      res.json({ ok: true, items: runtime.state.pool.list() });
    } catch (e) {
      next(e);
    }
  });
  r.get("/brain/resources", (_q, res) =>
    res.json(runtime.ai.resourceMetrics()),
  );
  r.get("/brain/runs", (req, res) => {
    const q = req.query as Record<string, string | undefined>,
      page = Math.max(1, Number(q.page ?? 1)),
      limit = Math.min(100, Math.max(1, Number(q.limit ?? 20)));
    const summary = runtime.settingsStore.listAiRunSummaries({from:Math.max(0,Number(q.from??Date.now()-90*24*60*60_000)),to:q.to?Number(q.to):undefined,symbol:q.symbol,role:q.role,status:q.status,decision:q.decision,model:q.model,page,limit});
    res.json({...summary, items: withExecutionOutcomes(runtime, summary.items)});
  });
  r.get("/brain/runs/:id", (req, res) => {
    const run =
      runtime.state.aiRuns.find((x) => x.id === req.params.id) ??
      runtime.settingsStore.getAiRun(req.params.id);
    if (!run)
      return res.status(404).json({ error: { message: "AI run not found" } });
    const related = runtime.state.aiRuns.filter(
        (x) => x.packetId === run.packetId,
      ),
      scout = related.find((x) => x.role === "SCOUT"),
      primary = related.find((x) => x.role === "PRIMARY_BRAIN") ?? run;
    const packet=archivedPacket(run.inputPreview);let normalizedDecision: any = run.normalizedPreview ?? null;
    try {
      if (typeof normalizedDecision === "string")
        normalizedDecision = JSON.parse(normalizedDecision);
    } catch {}
    const chain=runtime.settingsStore.getDecisionChain(run.id),
      execution = projectRunExecutionOutcomes(
        [...(chain?.events ?? [])].sort((a: any, b: any) => Number(a.ts ?? 0) - Number(b.ts ?? 0)),
        [{brainRunId: run.id, symbol: run.symbol ?? null, decision: run.decision ?? null, direction: run.direction ?? null, decidedAt: Number(run.completedAt ?? run.startedAt ?? Date.now())}],
        Date.now(),
        run.id,
      ).get(run.id) ?? null,
      projection=projectBrainRun(run,chain,[...runtime.state.entryOrders.values()],runtime.state.executionFills,Date.now(),execution),finalEvent=projection.timeline.at(-1);
    res.json({
      run,
      execution,
      summary: projection.summary,
      temporalMemory: runtime.settingsStore.getDecisionEpisodeByRun(run.id),
      eip:packet,
      archivedFactsStatus:packet?'ARCHIVED':'UNAVAILABLE',
      historicalCompactFacts:packet?{packetId:packet.packetId,symbol:packet.symbol,selection:packet.selection,market:packet.market,contradictions:packet.contradictions,evidenceCompleteness:packet.evidenceCompleteness}:null,
      scoutInput: scout?.inputPreview ?? null,
      scoutRawOutput: scout?.outputPreview ?? null,
      scoutNormalizedOutput: scout?.normalizedPreview ?? null,
      primaryInput: primary.inputPreview ?? null,
      rawModelOutput: run.outputPreview ?? run.failure?.rawOutput ?? null,
      normalizedDecision,
      timeline:projection.timeline,
      orderFact:projection.orderFact,
      finalEvent:finalEvent??null,
      rawAudit: {
        input: run.inputPreview ?? null,
        output: run.outputPreview ?? null,
        normalized: run.normalizedPreview ?? null,
        failure: run.failure ?? null,
      },
    });
  });
  r.get("/audit/entry-chain", (req, res) => {
    const since = Math.max(
        0,
        Number(req.query.since ?? Date.now() - 3 * 60 * 60_000),
      ),
      types = [
        "PRIMARY_DECISION_NORMALIZED",
        "AI_FAILED_NO_INTENT",
        "CANDIDATE_REJECTED",
        "ENTRY_DECISION_BLOCKED",
        "ENTRY_INTENT_CREATED",
        "ENTRY_ORDER_BLOCKED",
        "ENTRY_ORDER_CREATED",
        "ENTRY_ORDER_TERMINAL_RECONCILED",
        "ENTRY_ORDER_EXPIRED",
        "ENTRY_RANGE_INVALIDATED",
        "ENTRY_ORDER_REPRICED",
      ];
    res.json({
      since,
      items: runtime.settingsStore.runtimeEvents(since, types, 5000),
    });
  });
  r.get("/decision-chains", (req, res) => {
    const since = Math.max(
        0,
        Number(req.query.since ?? Date.now() - 24 * 60 * 60_000),
      ),
      limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({
      since,
      items: runtime.settingsStore.listDecisionChains(since, limit),
    });
  });
  r.get("/decision-chains/:id", (req, res) => {
    const chain = runtime.settingsStore.getDecisionChain(req.params.id);
    if (!chain)
      return res
        .status(404)
        .json({ error: { message: "decision chain not found" } });
    res.json(chain);
  });
  r.get("/audit/replay", (req, res) => {
    const since = Math.max(
        0,
        Number(req.query.since ?? Date.now() - 24 * 60 * 60_000),
      ),
      chains = runtime.settingsStore.listDecisionChains(since, 1000),
      events = chains.flatMap((chain: any) => chain.events ?? []),
      count = (type: string) =>
        events.filter((event: any) => event.type === type).length;
    res.json({
      since,
      mode: "READ_ONLY_DETERMINISTIC_REPLAY",
      chainCount: chains.length,
      eventCount: events.length,
      decisions: count("PRIMARY_DECISION_NORMALIZED"),
      blocked: count("ENTRY_DECISION_BLOCKED") + count("ENTRY_ORDER_BLOCKED"),
      intents: count("ENTRY_INTENT_CREATED"),
      orders: count("ENTRY_ORDER_CREATED"),
      fills: count("ENTRY_FILLED"),
      rejections: count("CANDIDATE_REJECTED"),
      chains,
    });
  });
  r.get("/audit/replay/metrics", (req, res) => {
    const since = Math.max(
        0,
        Number(req.query.since ?? Date.now() - 90 * 24 * 60 * 60_000),
      ),
      chains = runtime.settingsStore.listDecisionChains(since, 10000);
    res.json({
      mode: "READ_ONLY_COUNTERFACTUAL_REPLAY",
      since,
      chains: chains.map((chain: any) => {
        const events = chain.events ?? [],
          shadow = events.find((e: any) => e.type === "SHADOW_SAMPLE_RECORDED")
            ?.payload?.protectionShadow;
        return {
          chainId: chain.chainId,
          symbol: chain.symbol,
          status: chain.status,
          eventCount: events.length,
          return15m: null,
          return1h: null,
          return4h: null,
          return24h: null,
          mfe: shadow?.mfe ?? null,
          mae: shadow?.mae ?? null,
          wouldTriggerInvalidation: shadow?.status === "WOULD_TRIGGER",
          counterfactuals: {
            original: "UNKNOWN",
            hardGate: "READ_ONLY",
            shadowInvalidation: "READ_ONLY",
            noTrade: "READ_ONLY",
            oppositeDirection: "READ_ONLY",
          },
        };
      }),
    });
  });
  r.get("/shadow/readiness", (_q, res) =>
    res.json(runtime.shadowReadiness.readiness()),
  );
  r.get("/shadow/metrics", (_q, res) =>
    res.json(runtime.shadowReadiness.metrics()),
  );
  r.get("/market-intelligence", (_q, res) =>
    res.json({...runtime.temporal.snapshot(),liveStructure:runtime.state.pool.list().map(row=>{const s=runtime.state.snapshots.get(row.symbol);return{symbol:row.symbol,asOf:s?.technical?.['15m']?.asOf??null,trend15m:s?.technical?.['15m']?.trend??'UNKNOWN',trend5m:s?.technical?.['5m']?.trend??'UNKNOWN',trend1m:s?.technical?.['1m']?.trend??'UNKNOWN',reasons:runtime.market.primaryReadyReasons(row.symbol)};})}),
  );
  r.get('/market-intelligence/external-research',(_q,res)=>res.json({providers:runtime.externalIntelligence.status(),research:runtime.externalResearch.metrics()}));
  r.get('/diagnostics/private-sync',(_q,res)=>res.json({sync:runtime.privateSyncHealth(),requests:binanceRequestBudgetsHealth()}));
  r.get('/diagnostics/binance-governance',(_q,res)=>res.json({asOf:Date.now(),routes:binanceTransportGovernance(),budgets:binanceRequestBudgetsHealth()}));
  r.get('/diagnostics/logging',(_q,res)=>res.json((runtime as any).operationalLogHealth?.()??{status:'NOT_ATTACHED'}));
  r.get('/diagnostics/supply',(_q,res)=>res.json({health:runtime.supplyHealth(),residentTarget:runtime.state.settings.selection.poolTarget,residents:runtime.state.pool.list(),capacity:runtime.runtimeControl.capacityDiagnostics(),reserve:runtime.state.universe.filter(c=>(c.residentEligible??c.eligible)&&!runtime.state.pool.has(c.symbol)).slice(0,40).map(c=>({symbol:c.symbol,rank:c.rank,components:c.components,assetAdmission:c.assetAdmission,pipelineEligible:c.pipelineEligible}))}));
  // P4: the three layers the Entry chain now answers with, side by side, plus the fund/lease facts the
  // cockpit was previously inventing its own version of.
  r.get('/diagnostics/entry-permission',(req,res)=>{
    const now=Date.now(),symbol=String(req.query.symbol??'').trim().toUpperCase();
    const pool=runtime.state.pool.list(),target=symbol||(pool[0]?.symbol??'');
    const underlying=target?target.replace(/(USDT|USDC|BUSD)$/,''):null;
    res.json({
      asOf:now,
      mode:{environment:runtime.state.settings.connections.exchange.environment,executionMode:runtime.state.settings.connections.executionMode,
        fundsOnly:testnetFundsOnlyEntry(runtime.state.settings)},
      // One source of fund truth per asset, with the four numbers that used to be conflated separated.
      capital:runtime.state.account.assets.map((asset:any)=>({asset:asset.asset,exchangeAvailableUsd:asset.availableBalance??null,
        uncommittedReservationUsd:[...runtime.state.entryReservations.values()].filter((row:any)=>row.quoteAsset===asset.asset&&['RESERVED','WORKING'].includes(row.status)&&Number(row.expiresAt)>now).reduce((sum:number,row:any)=>sum+Number(row.marginUsd??0),0),
        analysisEarmarkUsd:activeExecutionLeaseMargin(runtime.state,asset.asset,now),
        executableForNewReservationUsd:Math.max(0,Number(asset.availableBalance??0)-activeExecutionLeaseMargin(runtime.state,asset.asset,now))})),
      admission:bookAdmissionSummary(runtime.state,now),
      observation:entryPermissionReadback(runtime.state,target??'--',underlying??'--',now),
      eligibility:target?candidateAnalysisEligibility(runtime.state,target,now,{modelAvailable:runtime.ai.resourceMetrics().length>0,dataNotReadyReasons:runtime.market.primaryReadyReasons(target,now)}):null,
      scopeObservation:underlying?portfolioScopeObservation({settings:runtime.state.settings,environment:runtime.state.settings.connections.exchange.environment,
        accountId:runtime.state.settings.connections.exchange.credentialRef,underlying,side:'BOTH',
        historicalUnknownRows:runtime.state.entryOrders? [...runtime.state.entryOrders.values()].filter((row:any)=>row.status==='UNKNOWN').length:0,
        activeClaimRows:runtime.settingsStore.entryExecutionClaimStats().activeClaims}):null,
      exitConvergence:runtime.exitConvergenceHealth(),
    });
  });
  r.post("/market-intelligence/rebuild", (_q, res) =>
    res.status(202).json({
      accepted: runtime.temporal.request("API_REQUEST"),
      mode: "BACKGROUND_READ_ONLY",
    }),
  );
  r.get("/shadow/violations", (_q, res) =>
    res.json(runtime.shadowReadiness.violations()),
  );
  r.get("/shadow/daily-summary", (_q, res) =>
    res.json(runtime.shadowReadiness.dailySummary()),
  );
  r.get("/shadow/root-causes", (_q, res) =>
    res.json(runtime.shadowReadiness.rootCauseAudit()),
  );
  r.get("/shadow/mark-series", (req, res) =>
    res.json({
      coverage: runtime.shadowReadiness.readiness().markSeriesCoverage,
      items: runtime.settingsStore.listShadowMarkSeries(
        Math.max(0, Number(req.query.since ?? Date.now() - 24 * 60 * 60_000)),
        typeof req.query.symbol === "string"
          ? String(req.query.symbol).toUpperCase()
          : undefined,
        Math.min(10000, Math.max(1, Number(req.query.limit ?? 1000))),
      ),
    }),
  );
  r.get("/diagnostics/trade-audit", async (req, res, next) => {
    try {
      const hours = Math.min(5, Math.max(1, Number(req.query.hours ?? 5)));
      res.json(await runtime.auditRecentTrades(hours));
    } catch (e) {
      next(e);
    }
  });
  r.post("/diagnostics/trade-audit/repair", async (req, res, next) => {
    try {
      const hours = Math.min(5, Math.max(1, Number(req.body?.hours ?? 5)));
      res.json(await runtime.repairRecentSystemTradeRecords(hours));
    } catch (e) {
      next(e);
    }
  });
  r.get("/brain/diagnostics", (_q, res) => {
    const since = Date.now() - 3 * 60 * 60_000,
      rows = runtime.state.aiRuns.filter(
        (x) => x.role === "PRIMARY_BRAIN" && x.startedAt >= since,
      ),
      done = rows.filter((x) => x.status === "COMPLETED"),
      rejects = done.filter((x) => x.decision === "REJECT_CANDIDATE");
    const reasons = new Map<string, number>();
    for (const run of rejects) {
      let reason = "REJECT_CANDIDATE";
      try {
        const raw = JSON.parse(run.outputPreview ?? "{}"),
          content = raw?.choices?.[0]?.message?.content;
        const parsed =
          typeof content === "string"
            ? JSON.parse(content.replace(/^```json\s*|```$/g, "").trim())
            : content;
        reason = String(parsed?.reason ?? parsed?.reasoning ?? reason)
          .replace(/\s+/g, " ")
          .slice(0, 220);
      } catch {}
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    const unique = new Set(done.map((x) => x.symbol)).size,
      repeat = rejects.length - new Set(rejects.map((x) => x.symbol)).size;
    res.json({
      windowHours: 3,
      primaryRuns: rows.length,
      uniqueSymbols: unique,
      rejects: rejects.length,
      placeLong: done.filter((x) => x.decision === "PLACE_LONG").length,
      placeShort: done.filter((x) => x.decision === "PLACE_SHORT").length,
      repeatRejectRate: rejects.length ? repeat / rejects.length : 0,
      rejectionReasonDistribution: [...reasons]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
      candidateTurnover: {
        cooldownActive: runtime.state.rejectionCooldown.size,
        pool: runtime.state.pool.list().length,
      },
    });
  });
  r.get('/diagnostics/p0-entry-integrity',(_q,res)=>{const since=Number(runtime.runtimeStatus().lastRestartAt??Date.now()),events=runtime.settingsStore.runtimeEvents(since,['ENTRY_ORDER_ACTIVE_RESTORED','ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','CANDIDATE_LIFECYCLE_CHANGED','ENTRY_SUBMIT_ATTEMPTED','ENTRY_ORDER_CREATED'],100000),primaryRuns=runtime.settingsStore.listAiRuns(since,100000).filter((run:any)=>run.role==='PRIMARY_BRAIN');res.json({since,...p0EntryIntegrity({since,entryOrders:[...runtime.state.entryOrders.values()],entryIntents:[...runtime.state.entryIntents.values()],fills:runtime.state.executionFills,primaryRuns,events,verifiedOrderFactMismatchCount:runtime.reconciliation.health().verifiedOrderFactMismatchCount}),durableClaims:runtime.settingsStore.entryExecutionClaimStats()});});
  r.get("/human-managed", (_q, res) => res.json(projectHumanManaged(runtime.state)));
  r.post("/positions/:id/human-managed/acknowledge", (req, res) => {
    const position=runtime.state.positions.get(req.params.id);
    if(!position)return res.status(404).json({error:{message:"position not found"}});
    if(position.managementStatus!=="HUMAN_MANAGED")return res.status(409).json({error:{message:"POSITION_NOT_HUMAN_MANAGED"}});
    const note=typeof req.body?.note==="string"?req.body.note.trim().slice(0,240):"";
    const acknowledgedAt=Date.now();
    runtime.events.publish("HUMAN_MANAGED_ACKNOWLEDGED",{positionId:position.id,acknowledgedAt,note,exchangeWrite:false,tpChanged:false,managementStatus:"HUMAN_MANAGED"},position.symbol);
    res.json({positionId:position.id,status:"ACKNOWLEDGED",acknowledgedAt,note,exchangeWrite:false,tpChanged:false});
  });
  r.get("/positions", (_q, res) =>
    res.json([...runtime.state.positions.values()].sort(byOpenedAtDesc)),
  );
  r.get("/positions/:id", async (req, res, next) => {
    try {
      const position = runtime.state.positions.get(req.params.id);
      if (!position)
        return res
          .status(404)
          .json({ error: { message: "position not found" } });
      const tp = position.tpOrderId
        ? runtime.state.tpOrders.get(position.tpOrderId)
        : null;
      const timeframes = ["1m", "5m", "15m", "4h"] as const;
      const candles = Object.fromEntries(timeframes.map(tf=>[tf,runtime.market.cachedCandles(position.symbol,tf,120)]));
      const snapshot = runtime.market.snapshot(position.symbol);
      const types = [
        "MANUAL_INTENT_CREATED",
        "MANUAL_INTENT_VALIDATED",
        "MANUAL_ORDER_SUBMITTED",
        "MANUAL_ACTION_COMPLETED",
        "MANUAL_VALIDATION_FAILED",
        "TP_PROTECTED",
        "TP_REPAIR_FAILED",
        "POSITION_CLOSED_RECONCILED",
      ];
      res.json({
        position,
        tp,
        tradeRecord:
          [...runtime.state.tradeRecords.values()].find(
            (record) => record.tradeId === `trade_${position.id}`,
          ) ?? null,
        market: {
          quote: snapshot?.quote ?? null,
          technical: snapshot?.technical ?? {},
          candles,
        },
        activeOrders: [...runtime.state.entryOrders.values()].filter(
          (o) =>
            o.symbol === position.symbol &&
            ["NEW", "SUBMITTING", "UNKNOWN", "WORKING", "PARTIALLY_FILLED"].includes(o.status),
        ),
        manualOrders: [...runtime.state.manualOrders.values()].filter(
          (o) =>
            o.positionId === position.id &&
            ["NEW", "SUBMITTING", "UNKNOWN", "WORKING", "PARTIALLY_FILLED"].includes(o.status),
        ),
        manualIntents: [...runtime.state.manualIntents.values()]
          .filter((o) => o.positionId === position.id)
          .slice(-50),
        audit: runtime.settingsStore.runtimeEvents(
          position.openedAt,
          types,
          500,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  r.get("/positions/:id/manual-preview", async (req, res, next) => {
    try {
      const preview = await runtime.manual.preview(req.params.id, true);
      res.json(preview);
    } catch (e) {
      next(e);
    }
  });
  r.post("/positions/:id/manual", async (req, res, next) => {
    try {
      const allowed = [
        "REDUCE",
        "ADD",
        "EMERGENCY_CLOSE",
        "PLACE_LIMIT",
        "REPLACE_TP",
        "REBUILD_TP",
      ];
      if (!allowed.includes(String(req.body?.action)))
        return res.status(400).json({ error: { message: "人工操作类型无效" } });
      res.json(
        await runtime.manual.execute(req.params.id, {
          ...req.body,
          action: String(req.body.action) as any,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  r.post("/positions/:id/cancel-limits", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res
          .status(409)
          .json({ error: { message: "CONFIRMATION_REQUIRED" } });
      const position = runtime.state.positions.get(req.params.id);
      if (!position)
        return res
          .status(404)
          .json({ error: { message: "position not found" } });
      res.json(await runtime.manual.cancelLimits(position.symbol));
    } catch (e) {
      next(e);
    }
  });
  r.post("/positions/:id/cancel-conditionals", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res
          .status(409)
          .json({ error: { message: "CONFIRMATION_REQUIRED" } });
      const position = runtime.state.positions.get(req.params.id);
      if (!position)
        return res
          .status(404)
          .json({ error: { message: "position not found" } });
      res.json(await runtime.manual.cancelConditionals(position.symbol));
    } catch (e) {
      next(e);
    }
  });
  r.get("/risk/shadow", (_q, res) => res.json(runtime.shadow.status()));
  r.get("/testnet/cleanup/preview", async (_q, res, next) => {
    try {
      res.json(await runtime.cleanup.preview());
    } catch (e) {
      next(e);
    }
  });
  r.post("/testnet/cleanup/run", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res
          .status(409)
          .json({ error: { message: "HUMAN_CONFIRMATION_REQUIRED" } });
      res.json(
        await runtime.cleanup.execute(true, {
          waitMs:
            typeof req.body?.waitMs === "number"
              ? Math.max(0, Math.min(60_000, req.body.waitMs))
              : 60_000,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  r.get("/testnet/cleanup/audit", async (req, res, next) => {
    try {
      const symbol = String(req.query.symbol ?? "").toUpperCase();
      if (!symbol)
        return res
          .status(400)
          .json({ error: { message: "symbol is required" } });
      const adapter = runtime.cleanup as any;
      const trade = (runtime as any).trade;
      if (!trade?.fetchSymbolTradeFacts)
        return res
          .status(503)
          .json({ error: { message: "SYMBOL_TRADE_AUDIT_UNAVAILABLE" } });
      res.json(
        await trade.fetchSymbolTradeFacts(
          symbol,
          Number(req.query.startTime ?? Date.now() - 24 * 60 * 60_000),
          Number(req.query.endTime ?? Date.now()),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  r.post("/testnet/cleanup/repair-record", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res
          .status(409)
          .json({ error: { message: "HUMAN_CONFIRMATION_REQUIRED" } });
      const symbol = String(req.body?.symbol ?? "").toUpperCase();
      if (!symbol)
        return res
          .status(400)
          .json({ error: { message: "symbol is required" } });
      res.json(
        await runtime.cleanup.repairTradeRecord(
          symbol,
          Number(req.body?.startTime ?? Date.now() - 24 * 60 * 60_000),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  r.get("/orders", (_q, res) => {
    const now=Date.now(),historyCutoff=now-24*60*60_000;
    const current=runtime.reconciliation?.currentOpenEntryOrders?.()??{status:'UNAVAILABLE',verifiedAt:null,items:[]};
    const manualCurrent=runtime.reconciliation?.currentOpenManualOrders?.()??{status:'UNAVAILABLE',verifiedAt:null,items:[]};
    const allHistoricalUnknown=[...runtime.state.entryOrders.values()].filter(order=>order.status==='UNKNOWN'||( ['FILLED','CANCELED','EXPIRED','REJECTED'].includes(order.status)&&(order as any).exchangeTerminalStatus==='UNKNOWN'));
    const historicalUnknown=allHistoricalUnknown.filter(order=>Number(order.createdAt??0)>=historyCutoff);
    res.json({entry:current.items,entryReadback:{status:current.status,verifiedAt:current.verifiedAt,count:current.items.length},historicalUnknown,
      historicalUnknownWindow:{since:historyCutoff,until:now,visibleCount:historicalUnknown.length,olderHiddenCount:allHistoricalUnknown.length-historicalUnknown.length},
      takeProfit:[...runtime.state.tpOrders.values()],manual:manualCurrent.items,manualReadback:{status:manualCurrent.status,verifiedAt:manualCurrent.verifiedAt,count:manualCurrent.items.length}});
  });
  r.get("/eip/:symbol", (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
      res.json({
        status: "READY",
        packet: runtime.state.eips.get(symbol) ?? runtime.eip.build(symbol),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stale = message.startsWith("EIP_EVIDENCE_STALE");
      res.status(stale ? 200 : 422).json({
        status: stale ? "STALE" : "UNAVAILABLE",
        symbol,
        reason: message,
        recovering: stale,
      });
    }
  });
  r.get("/settings", (_q, res) => res.json(runtime.state.settings));
  r.get("/settings/readiness", (_q, res) =>
    res.json(runtime.readinessProjection()),
  );
  r.get("/auto-readiness", (_q, res) =>
    res.json(runtime.liveValidation.readiness()),
  );
  r.get("/capital-epoch", (_q, res) =>
    res.json(runtime.liveValidation.getCapitalEpoch()),
  );
  r.get("/usdc-router/audit", (_q, res) =>
    res.json(runtime.liveValidation.usdcAudit()),
  );
  r.get("/validation/weekly", (_q, res) =>
    res.json(runtime.liveValidation.snapshot()),
  );
  r.post("/auto-readiness/prepare", async (_q, res, next) => {
    try {
      res.json(await runtime.prepareAutoReady());
    } catch (error) {
      next(error);
    }
  });
  r.post("/validation/weekly/start", (_req, res) =>
    res
      .status(410)
      .json({
        error: { message: "7_DAY_TESTNET_AUTO_AUTHORIZATION_DISABLED_BY_USER" },
      }),
  );
  r.post("/runtime/capital-auto/enable", async (req, res, next) => {
    try {
      res.json(
        await runtime.enableCapitalAvailableAuto(
          req.body?.confirmTestnetOnly === true,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  r.get("/pipeline", (_q, res) => res.json({...runtime.pipelineStatus(),restBudget:binanceRequestBudgetsHealth()}));
  r.get("/runtime/trading-control", (_q, res) =>
    res.json(runtime.runtimeControlStatus()),
  );
  r.get("/ops/runtime", (_q, res) => res.json(runtime.runtimeStatus()));
  r.get("/ops/lan", (_q, res) => res.json(runtime.runtimeStatus()));
  r.post("/ops/lan/event", (req, res) => {
    const allowed = [
      "LAN_AVAILABLE",
      "LAN_LISTENER_DOWN",
      "LAN_LOOPBACK_HTTP_DOWN",
      "LAN_INTERFACE_HTTP_DOWN",
      "LAN_IP_CHANGED",
      "LAN_FIREWALL_PROFILE_CHANGED",
      "LAN_PORT_OWNERSHIP_CHANGED",
      "LAN_ENGINE_PROCESS_EXITED",
      "LAN_FRONTEND_ASSET_FAILURE",
      "LAN_API_ORIGIN_FAILURE",
      "LAN_WEBSOCKET_CLIENT_FAILURE",
      "SUPERVISOR_RESTART",
    ];
    const type = String(req.body?.type ?? "");
    if (!allowed.includes(type))
      return res
        .status(400)
        .json({ error: { message: "unsupported LAN event" } });
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    )
      return res
        .status(403)
        .json({ error: { message: "LAN event endpoint is local-only" } });
    res.json(runtime.events.publish(type, req.body?.payload ?? {}, "LAN"));
  });
  r.post("/runtime/trading-control/pause", (req, res) =>
    res.json(
      runtime.pauseNewEntries(
        typeof req.body?.reason === "string" ? req.body.reason : undefined,
      ),
    ),
  );
  r.post("/runtime/trading-control/resume", (_q, res) =>
    res.json(runtime.resumeNewEntries()),
  );
  r.get("/runtime/risk-pause/preview", (_q, res) =>
    res.json(runtime.manualRiskPausePreview()),
  );
  r.post("/runtime/risk-pause/override", (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res.status(400).json({ error: { message: "MANUAL_RISK_OVERRIDE_CONFIRMATION_REQUIRED" } });
      const reason=typeof req.body?.reason==='string'?req.body.reason:'Testnet 日内风险人工复核';
      if (!reason.trim() || reason.length>240)
        return res.status(400).json({ error: { message: "MANUAL_RISK_OVERRIDE_REASON_INVALID" } });
      res.json(runtime.manualRiskPauseOverride(reason));
    } catch (error) { next(error); }
  });
  r.get("/account/assets", (_q, res) =>
    res.json({
      status: runtime.state.account.status,
      source: runtime.state.account.source,
      asOf: runtime.state.account.asOf,
      assets: runtime.state.account.assets,
    }),
  );
  r.get("/themes", (_q, res) =>
    res.json([
      "BINANCE_NOIR",
      "INSTITUTIONAL_BLUE",
      "DARK_TRUFFLE",
      "BULLION_GOLD",
      "DUNHUANG_FINANCE",
      "AUTUMN_MAILLARD",
      "MORANDI_QUANT",
      "LONDON_GRAPHITE",
      "QUIET_MORNING",
      "BURGUNDY_EDITORIAL",
    ]),
  );
  r.get("/settings/connections", async (_q, res, next) => {
    try {
      const ref = runtime.state.settings.connections.exchange.credentialRef;
      const [key, secret] = await Promise.all([
        runtime.settingsStore.secretStatus(`${ref}:apiKey`),
        runtime.settingsStore.secretStatus(`${ref}:apiSecret`),
      ]);
      res.json({
        connections: runtime.state.settings.connections,
        aiResources: runtime.state.settings.aiResources,
        credentials: {
          configured: key.configured && secret.configured,
          masked: key.last4,
          backend: key.backend,
          status: key.configured && secret.configured ? "READY" : key.status,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  r.post("/settings/exchange/private/test", async (req, res, next) => {
    try {
      const { apiKey, apiSecret } = req.body as {
        apiKey?: unknown;
        apiSecret?: unknown;
      };
      if (
        typeof apiKey !== "string" ||
        typeof apiSecret !== "string" ||
        !apiKey.trim() ||
        !apiSecret.trim()
      )
        return res
          .status(400)
          .json({ error: { message: "apiKey and apiSecret are required" } });
      res.json(await runtime.validatePrivateCredentials(apiKey, apiSecret));
    } catch (e) {
      next(e);
    }
  });
  r.put("/settings/exchange/credentials", async (req, res, next) => {
    try {
      const { apiKey, apiSecret } = req.body as {
        apiKey?: unknown;
        apiSecret?: unknown;
      };
      if (
        typeof apiKey !== "string" ||
        typeof apiSecret !== "string" ||
        !apiKey.trim() ||
        !apiSecret.trim()
      )
        return res
          .status(400)
          .json({ error: { message: "apiKey and apiSecret are required" } });
      const validation = await runtime.validatePrivateCredentials(
        apiKey,
        apiSecret,
      );
      const ref = runtime.state.settings.connections.exchange.credentialRef;
      const stored = await runtime.settingsStore.setCredentialPair(
        `${ref}:apiKey`,
        apiKey,
        `${ref}:apiSecret`,
        apiSecret,
      );
      await runtime.installSavedCredentials();
      res.json({
        configured: stored.key.configured && stored.secret.configured,
        masked: stored.key.last4,
        backend: stored.key.backend,
        status: "READY",
        validation,
        readiness: runtime.readinessProjection(),
      });
    } catch (e) {
      next(e);
    }
  });
  r.post("/trade-records/sync/preview", async (req, res, next) => {
    try {
      const options = syncInput(req.body),
        audit = await runtime.auditRecentTrades(
          options.hours,
          options.maxFills,
          options.startTime,
          options.endTime,
        ),
        preview = new TradeRecordSyncService(
          runtime.state,
          runtime.positions,
        ).preview(audit, options.maxFills, options);
      res.json({
        syncId: `sync_${Date.now()}`,
        status: "PREVIEW",
        options,
        preview,
      });
    } catch (error) {
      next(error);
    }
  });
  r.post("/trade-records/sync/apply", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res
          .status(409)
          .json({ error: { message: "SYNC_CONFIRM_REQUIRED" } });
      const options = syncInput(req.body),
        syncId = String(req.body?.syncId ?? `sync_${Date.now()}`);
      const prior = runtime.settingsStore.getTradeSyncHistory(syncId);
      if (prior?.status === "APPLIED")
        return res.json({
          syncId,
          status: "APPLIED_REPLAYED",
          replayed: true,
          ...prior.result,
        });
      const audit = await runtime.auditRecentTrades(
          options.hours,
          options.maxFills,
          options.startTime,
          options.endTime,
        ),
        // Sync is fail-closed until a full SQLite backup exists.  The live
        // database can exceed the workspace volume's remaining headroom, so
        // use the local application-data volume unless an operator supplies
        // an explicit durable backup directory.
        backupDir =
          process.env.ZDJ_TRADE_SYNC_BACKUP_DIR ??
          path.join(
            process.env.LOCALAPPDATA ?? process.cwd(),
            "ZDJ-MITS",
            "trade-sync-backups",
          );
      await mkdir(backupDir, { recursive: true });
      const backupPath = await runtime.settingsStore.tradeSyncBaseline(backupDir),
        service = new TradeRecordSyncService(runtime.state, runtime.positions);
      let result!: ReturnType<TradeRecordSyncService["apply"]>;
      await runtime.settingsStore.transaction(() => {
        result = service.apply(audit, options.maxFills, options);
        normalizeRecords();
        for (const record of runtime.state.tradeRecords.values())
          runtime.settingsStore.upsertTradeRecord(record);
        for (const sample of result.samples)
          if (runtime.state.experienceSamples.has(sample.sampleId))
            runtime.settingsStore.upsertExperienceSample(sample);
        runtime.settingsStore.recordTradeSyncHistory({
          syncId,
          status: "APPLIED",
          createdAt: Date.now(),
          options,
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
      }, { timeoutMs: 5_000, label: "TRADE_SYNC_APPLY" });
      runtime.events.publish(
        "TRADE_SYNC_APPLIED",
        {
          syncId,
          preview: result.preview,
          created: result.created,
          repaired: result.repaired,
          skipped: result.skipped,
          newComplete: result.newComplete,
          newPartial: result.newPartial,
          experienceCreated: result.experienceCreated,
        },
        "TRADE_RECORD",
      );
      res.json({
        syncId,
        status: "APPLIED",
        backupPath,
        ...result,
        records: result.records.map((record) => record.tradeId),
        samples: result.samples.map((sample) => sample.sampleId),
      });
      void runtime.reconciliation.run().catch((error) =>
        runtime.events.publish(
          "TRADE_SYNC_RECONCILIATION_FAILED",
          {
            syncId,
            code: "TRADE_SYNC_RECONCILIATION_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
          "TRADE_RECORD",
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  r.post("/trade-records/sync/recover-persisted", async (req, res, next) => {
    try {
      if (req.body?.confirm !== true)
        return res.status(409).json({ error: { message: "SYNC_CONFIRM_REQUIRED" } });
      const options = syncInput(req.body),
        syncId = String(req.body?.syncId ?? `sync_recovery_${Date.now()}`),
        symbol = String(req.body?.symbol ?? "").trim();
      if (!symbol) throw new Error("SYNC_RECOVERY_SYMBOL_REQUIRED");
      const prior = runtime.settingsStore.getTradeSyncHistory(syncId);
      if (prior?.status === "APPLIED")
        return res.json({ syncId, status: "APPLIED_REPLAYED", replayed: true, ...prior.result });
      const startTime = options.startTime ?? Date.now() - options.hours * 60 * 60_000,
        endTime = options.endTime ?? Date.now(),
        fills = runtime.settingsStore.listPersistedExchangeFillFacts(symbol, startTime, endTime);
      if (!fills.length)
        return res.status(404).json({ error: { message: "PERSISTED_EXCHANGE_FILL_FACTS_NOT_FOUND" } });
      const audit: TradeAuditSnapshot = {
        source: "BINANCE_TESTNET_PRIVATE",
        fetchedAt: Date.now(),
        window: { startTime, endTime },
        fills,
        income: [],
        orders: [],
        positions: [],
        openOrders: [],
      };
      const backupDir = process.env.ZDJ_TRADE_SYNC_BACKUP_DIR ?? path.join(process.env.LOCALAPPDATA ?? process.cwd(), "ZDJ-MITS", "trade-sync-backups");
      await mkdir(backupDir, { recursive: true });
      const backupPath = await runtime.settingsStore.tradeSyncBaseline(backupDir),
        service = new TradeRecordSyncService(runtime.state, runtime.positions);
      let result!: ReturnType<TradeRecordSyncService["apply"]>;
      await runtime.settingsStore.transaction(() => {
        result = service.apply(audit, options.maxFills, options);
        normalizeRecords();
        for (const record of runtime.state.tradeRecords.values()) runtime.settingsStore.upsertTradeRecord(record);
        for (const sample of result.samples) if (runtime.state.experienceSamples.has(sample.sampleId)) runtime.settingsStore.upsertExperienceSample(sample);
        runtime.settingsStore.recordTradeSyncHistory({ syncId, status: "APPLIED", createdAt: Date.now(), options, recoverySource: "PERSISTED_EXCHANGE_FILL_FACTS", preview: result.preview, result: { created: result.created, repaired: result.repaired, skipped: result.skipped, newComplete: result.newComplete, newPartial: result.newPartial, experienceCreated: result.experienceCreated }, backupPath });
      }, { timeoutMs: 5_000, label: "TRADE_SYNC_PERSISTED_RECOVERY" });
      runtime.events.publish("TRADE_SYNC_APPLIED", { syncId, recoverySource: "PERSISTED_EXCHANGE_FILL_FACTS", preview: result.preview, created: result.created, repaired: result.repaired, skipped: result.skipped, newComplete: result.newComplete, newPartial: result.newPartial, experienceCreated: result.experienceCreated }, "TRADE_RECORD");
      res.json({ syncId, status: "APPLIED", recoverySource: "PERSISTED_EXCHANGE_FILL_FACTS", backupPath, ...result, records: result.records.map((record) => record.tradeId), samples: result.samples.map((sample) => sample.sampleId) });
      void runtime.reconciliation.run().catch((error) => runtime.events.publish("TRADE_SYNC_RECONCILIATION_FAILED", { syncId, code: "TRADE_SYNC_RECONCILIATION_FAILED", message: error instanceof Error ? error.message : String(error) }, "TRADE_RECORD"));
    } catch (error) {
      next(error);
    }
  });
  r.get("/trade-records/sync/history", (req, res) =>
    res.json({
      items: runtime.settingsStore.listTradeSyncHistory(
        Math.min(500, Math.max(1, Number(req.query.limit ?? 50))),
      ),
    }),
  );
  r.get('/trade-records',(req,res)=>{
    const q=req.query as Record<string,string|undefined>,page=Math.max(1,Number(q.page??1)),limit=Math.min(100,Math.max(1,Number(q.limit??20)));
    const records=[...runtime.state.tradeRecords.values()],summary=projectTradeRecordSummary({records,...runtime.qualityObserver?.readContext()}),integrity=new TradeRecordIntegrityService(runtime.state).summary();
    let rows=records.map(record=>projectTradeRecordRow(record,runtime.qualityObserver?.readContext())).sort((a,b)=>byClosedAtDesc(a,b)||a.tradeId.localeCompare(b.tradeId));
    const category=q.category??'COMPLETE';
    rows=category==='ISSUES'?rows.filter(row=>['DUPLICATE','CONFLICT','INVALID'].includes(row.classification)):rows.filter(row=>row.classification===category);
    if(q.symbol)rows=rows.filter(row=>row.symbol.toUpperCase().includes(q.symbol!.toUpperCase()));
    if(q.direction)rows=rows.filter(row=>row.direction===q.direction);
    if(q.status)rows=rows.filter(row=>row.status===q.status);
    if(q.closeReason)rows=rows.filter(row=>row.closeReason===q.closeReason);
    rows=filterFormalOutcome(rows,q.outcome);
    if(q.search)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(q.search!.toLowerCase()));
    const total=rows.length;
    const items=rows.slice((page-1)*limit,page*limit).map(row=>({...row,closeProvenance:tradeCloseProvenance(row,runtime)}));
    res.json({page,limit,total,items,autoSync:runtime.tradeRecordAutoSyncStatus(),summary:{...summary,
      partiallyClosed:records.filter(row=>row.status==='PARTIALLY_CLOSED').length,
      unknownCount:records.filter(row=>row.classification!=='COMPLETE'||row.fundingAttributionStatus!=='EXACT').length,
      grossIncome:null,lossExpense:null,totalFees:null,floatingPnl:runtime.state.account.unrealizedPnlUsd??0,
      counts:{total:integrity.total,complete:integrity.complete,partial:integrity.partial,imported:integrity.imported,external:integrity.external,duplicate:integrity.duplicate,conflict:integrity.conflict,invalid:integrity.invalid,invalidClosed:integrity.invalidClosed,missingExit:integrity.missingExit,missingFee:integrity.missingFee,missingMargin:integrity.missingMargin},
    }});
  });
  r.get('/trade-records/:id',(req,res)=>{
    const raw=runtime.state.tradeRecords.get(req.params.id);if(!raw)return res.status(404).json({error:{message:'trade record not found'}});
    const record=projectTradeRecordRow(raw,runtime.qualityObserver?.readContext()),entryRuns=raw.entryRunId?runtime.state.aiRuns.filter(run=>run.id===raw.entryRunId):[];
    res.json({record,rawRecord:raw,experience:record.economicEligibility.canonicalPnlEligible?([...runtime.state.experienceSamples.values()].find(sample=>sample.tradeId===raw.tradeId)??null):null,
      linkedFills:runtime.state.executionFills.filter(fill=>fill.symbol===raw.symbol&&(raw.linkedFillIds.includes(fill.fillId)||raw.entryOrderIds.includes(fill.orderId)||raw.exitOrderIds.includes(fill.orderId))),entryRuns,
      entryOrders:raw.entryOrderIds.map(id=>runtime.state.entryOrders.get(id)).filter(Boolean),exitOrders:raw.exitOrderIds.map(id=>runtime.state.tpOrders.get(id)).filter(Boolean),
      rawAudit:runtime.settingsStore.runtimeEvents(raw.createdAt,['TRADE_RECORD_OPENED','TRADE_RECORD_CLOSED','TRADE_RECORD_REPAIRED','EXPERIENCE_SAMPLE_CREATED'],500)});
  });
  r.get('/experience',(_req,res)=>{
    const projected=[...runtime.state.tradeRecords.values()].map(record=>projectTradeRecordRow(record,runtime.qualityObserver?.readContext())).filter(row=>row.economicEligibility.canonicalPnlEligible),ids=new Set(projected.map(row=>row.tradeId));
    const samples=[...runtime.state.experienceSamples.values()].filter(sample=>ids.has(sample.tradeId)).sort((a,b)=>b.createdAt-a.createdAt),wins=samples.filter(x=>x.winLoss==='WIN').length,losses=samples.filter(x=>x.winLoss==='LOSS').length;
    res.json({samples,records:projected,summary:{completed:samples.length,wins,losses,winRate:samples.length?wins/samples.length:null,avgNetPnl:projected.length?projected.reduce((n,row)=>n+(row.formalNetPnl??0),0)/projected.length:null,avgHoldingDurationMs:projected.length?projected.reduce((n,row)=>n+(row.durationMs??0),0)/projected.length:null,avgFillDelayMs:samples.length?samples.reduce((n,row)=>n+(row.fillDelayMs??0),0)/samples.length:null,status:projected.length?'ELIGIBLE':'NO_ELIGIBLE_SAMPLES'}});
  });
  r.get("/operations/health", (_q, res) =>
    res.json({
      services: runtime.health(),
      reconciliation: runtime.reconciliation.health(),
    }),
  );
  r.post("/entry/:id/cancel", async (req, res, next) => {
    try {
      const order = runtime.state.entryOrders.get(req.params.id);
      const current=(runtime.reconciliation as any)?.currentOpenEntryOrders?.();
      const eligibility=entryCancelEligibility(order,current);
      if(!eligibility.allowed)return res.status(eligibility.status).json({error:{code:eligibility.code,message:eligibility.message}});
      const adapter = (runtime as any).entry["exchange"];
      const canceled = await adapter.cancelEntry(order);
      if(!['CANCELED','EXPIRED','REJECTED','FILLED'].includes(String(canceled?.status)))return res.status(502).json({error:{code:'ENTRY_CANCEL_RESULT_UNVERIFIED',message:`交易所取消结果未确认（${String(canceled?.status??'UNKNOWN')}）；该订单保持待核验状态。`}});
      runtime.state.entryOrders.set(order.id, canceled);
      if (order.reservationId)
        runtime.state.releaseEntryReservation(order.reservationId);
      runtime.events.publish(
        "ENTRY_ORDER_CANCELED_MANUAL",
        { orderId: order.id },
        order.symbol,
      );
      res.json(canceled);
    } catch (e) {
      next(e);
    }
  });
  r.post("/tp/:positionId/repair", async (req, res, next) => {
    try {
      const pos = runtime.state.positions.get(req.params.positionId);
      if (!pos) return res.status(404).json({ error: "position not found" });
      const exitRuntime = (runtime as any).exitRuntime;
      if (exitRuntime) {
        // C3: a human revoke is durable and binding. Only an explicit confirmRearm, which writes a
        // HUMAN mandate the guardian may never overwrite, may bring automatic protection back.
        const mandate = exitRuntime.mandate(exitSubjectFromPosition(pos));
        if (mandate?.revokedAt != null) {
          if (req.body?.confirmRearm !== true)
            return res.status(409).json({ error: "TP_REPAIR_BLOCKED_MANDATE_REVOKED", revokedAt: mandate.revokedAt });
          const rearmPrice = Number(req.body?.rearmPrice ?? pos.tpEconomics?.currentTpPrice ?? 0);
          if (!exitRuntime.rearmProtectionByHuman(exitSubjectFromPosition(pos), rearmPrice))
            return res.status(409).json({ error: "TP_MANDATE_REARM_UNPROVEN", rearmPrice });
        }
      }
      runtime.state.positions.set(pos.id, { ...pos, tpStatus: "MISSING" });
      await runtime.tp.ensure(runtime.state.positions.get(pos.id)!, true);
      res.json(runtime.state.positions.get(pos.id));
    } catch (e) {
      next(e);
    }
  });
  r.post("/tp/:positionId/revoke", async (req, res, next) => {
    try {
      const pos = runtime.state.positions.get(req.params.positionId);
      if (!pos) return res.status(404).json({ error: "position not found" });
      if (req.body?.confirm !== true) return res.status(400).json({ error: "CONFIRMATION_REQUIRED" });
      const exitRuntime = (runtime as any).exitRuntime;
      if (!exitRuntime) return res.status(503).json({ error: "EXIT_COORDINATION_UNAVAILABLE" });
      // The durable revoke comes first: even if the cancel below ends UNKNOWN the guardian must not
      // rebuild protection automatically, and the outcome is reported honestly.
      const mandate = exitRuntime.revokeProtectionByHuman(exitSubjectFromPosition(pos));
      const results: Array<{ orderId: string; status: string; reason?: string }> = [];
      for (const order of [...runtime.state.tpOrders.values()].filter((row) => row.positionId === pos.id && row.status === "WORKING")) {
        try {
          const canceled = await runtime.tp.cancel(order);
          runtime.state.tpOrders.set(canceled.id, canceled);
          results.push({ orderId: order.id, status: canceled.status });
        } catch (error) {
          results.push({ orderId: order.id, status: "UNKNOWN", reason: String(error instanceof Error ? error.message : error) });
        }
      }
      runtime.events.publish("TP_PROTECTION_REVOKED_BY_HUMAN", { positionId: pos.id, mandate, orders: results }, pos.symbol);
      res.json({ revoked: mandate, orders: results, canceled: results.every((row) => ["CANCELED", "EXPIRED", "REJECTED"].includes(row.status)), unknown: results.some((row) => row.status === "UNKNOWN") });
    } catch (e) {
      next(e);
    }
  });
  return r;
}

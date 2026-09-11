// @ts-nocheck
import { DynamicPool, resolveUnderlying } from '@zdj/core';
export type PositionLifecycleState = any;
export type AccountState = any;
export class RuntimeState {
    settings;
    generation = 1;
    marketGeneration = 1;
    universe = [];
    snapshots = new Map();
    eips = new Map();
    externalIntelligence = new Map();
    externalProviderStatus = new Map();
    positions = new Map();
    positionFactTimes = new Map<string,number>();
    entryIntents = new Map();
    entryOrders = new Map();
    tpOrders = new Map();
    aiResources = [];
    aiRuns = [];
    rejectionCooldown = new Map();
    candidateLifecycle = new Map();
    directionDecisionStates = new Map();
    tradeOutcomes = [];
    tradeRecords = new Map();
    manualExitGoals = new Map<string,{positionId:string;symbol:string;side:string;rootKey:string;attempt:number;createdAt:number;nextAttemptAt:number;lastReason:string|null}>();
    manualIntents = new Map();
    manualOrders = new Map();
    experienceSamples = new Map();
    executionFills = [];
    lifecycles = new Map();
    allocationPlans = new Map();
    entryReservations = new Map();
    underlyingLocks = new Map();
    shadowRunner = { status: 'STOPPED', startAt: null, requiredUntil: null, samples: 0, violations: 0, dataQualityBlocks: 0, exposureBlocks: 0, reviewBlocks: 0, wouldStops: 0, duplicateUnderlyingAttempts: 0, reservationConflicts: 0, snapshotInvalidations: 0, lastSampleAt: null, validityEpochAt: null, validObservationStartedAt: null, validObservationRequiredUntil: null, validObservationStreak: 0, shadowOnlyRuns: 0, shadowOnlyPlaceDecisions: 0, shadowOnlyErrors: 0 };
    runtimeControl = { mode: 'RUNNING', reasonCode: 'NONE', reasonText: '运行中', pausedAt: null, pauseSource: 'NONE', autoResume: true, lastTransitionAt: Date.now(), nextCapitalCheckAt: null, entrySafetyMode: 'SAFETY_REVIEW_PAUSED', manualRiskOverride: null, capital: { evaluatedAt: 0, generation: 0, directionBudget:{longAvailableNotionalUsd:0,shortAvailableNotionalUsd:0,grossAvailableNotionalUsd:0,evaluatedAt:0}, executableCandidateCount: 0, usdtAvailable: 0, usdcAvailable: 0, usdtExecutableUnderlyings: 0, usdcExecutableUnderlyings: 0, noUsdtMargin: 0, noUsdcMargin: 0, noUsdcContract: 0, liquidityRejected: 0, exposureRejected: 0, minMarginRejected: 0, marketNotFresh: 0, underlyingBlocked: 0, reasonCounts: {}, routedCandidates: [], nextRecheckAt: null } };
    executionGovernance = { mode: 'SHADOW_ONLY', changedAt: Date.now(), reason: 'SAFE_DEFAULT', capitalEpochId: null, validationId: null };
    activity = { lastPrimaryRunAt: null, lastPlaceDecisionAt: null, lastEntryIntentAt: null, lastEntrySubmittedAt: null, lastEntryFilledAt: null, primaryRunsSinceLastPlace: 0, uniqueSymbolsSinceLastPlace: 0, consecutiveRejects: 0, placeCount30m: 0, rejectCount30m: 0, primaryCount30m: 0, entryIntentCount30m: 0, submitCount30m: 0, fillCount30m: 0 };
    account = { status: 'NOT_CONFIGURED', source: 'BINANCE_TESTNET_PRIVATE', asOf: null, reason: 'Binance Testnet credentials are not configured', equityUsd: null, availableUsd: null, walletBalanceUsd: null, unrealizedPnlUsd: null, realizedPnlUsd24h: null, assets: [], riskBaseline: null };
    pool;
    constructor(settings) {
        this.settings = settings;
        this.pool = new DynamicPool(settings);
    }
    setSettings(settings) { this.settings = settings; this.pool.updateSettings(settings); this.generation++; }
    activeEntrySymbols() { return new Set([...this.entryOrders.values()].filter(o => ['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(o.status)).map(o => o.symbol.toUpperCase())); }
    positionSymbols() { return new Set([...this.positions.values()].map(p => p.symbol.toUpperCase())); }
    addAiRun(run) { this.aiRuns.unshift(run); if (this.aiRuns.length > 200)
        this.aiRuns.length = 200; }
    cleanupReservations(now = Date.now()) { for (const [id, reservation] of this.entryReservations) {
        const activeOrder=[...this.entryOrders.values()].some(order=>order.reservationId===id&&['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(order.status));
        if (reservation.expiresAt <= now && (reservation.status === 'RESERVED' || (reservation.status === 'WORKING'&&!activeOrder)))
            this.releaseEntryReservation(id); } for (const [key, lock] of this.underlyingLocks)
        if (lock.leaseUntil <= now)
            this.underlyingLocks.delete(key); }
    entryCapacity(ignoreOrderId=null,ignoreReservationId=null) {
        const held=new Set([...this.positions.values()].map(p=>resolveUnderlying(p.symbol))),orders=[...this.entryOrders.values()].filter(o=>o.id!==ignoreOrderId&&['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(o.status));
        const inFlight=new Set(orders.map(o=>resolveUnderlying(o.symbol)).filter(u=>!held.has(u))),reservations=[...this.entryReservations.values()].filter(r=>r.id!==ignoreReservationId&&['RESERVED','WORKING'].includes(r.status)&&r.expiresAt>Date.now()&&!held.has(r.underlying)&&!inFlight.has(r.underlying));
        const reserved=new Set(reservations.map(r=>r.underlying));return {positions:this.positions.size,inFlight:inFlight.size,reserved:reserved.size,used:this.positions.size+inFlight.size+reserved.size,max:this.settings.portfolio.maxPositions};
    }
    reserveEntry(input) { this.cleanupReservations(); const underlying = input.underlying.toUpperCase(), lock = this.underlyingLocks.get(underlying); if (lock && lock.leaseUntil > Date.now())
        return { ok: false, reason: 'UNDERLYING_LOCKED' }; const reserved = [...this.entryReservations.values()].filter(x => x.status === 'RESERVED'); if (reserved.length >= input.maxConcurrentReservations)
        return { ok: false, reason: 'RESERVATION_CAPACITY' }; if (this.entryCapacity().used >= input.maxPositions)
        return { ok: false, reason: 'MAX_POSITIONS_REACHED' }; const available = this.account.assets.find(x => x.asset === input.quoteAsset)?.availableBalance ?? 0; const committed = [...this.entryReservations.values()].filter(x => x.status === 'RESERVED' && x.quoteAsset === input.quoteAsset).reduce((n, x) => n + x.marginUsd, 0); if (input.quoteAsset !== 'UNKNOWN' && available - committed < input.marginUsd)
        return { ok: false, reason: 'RESERVED_QUOTE_MARGIN' }; const now = Date.now(), id = `reserve_${now}_${Math.random().toString(36).slice(2, 8)}`; this.entryReservations.set(id, { id, underlying, quoteAsset: input.quoteAsset, marginUsd: input.marginUsd, notionalUsd: input.notionalUsd, planId: input.planId, intentId: null, createdAt: now, expiresAt: now + input.ttlSeconds * 1000, status: 'RESERVED' }); this.underlyingLocks.set(underlying, { reservationId: id, leaseUntil: now + input.leaseSeconds * 1000 }); return { ok: true, reservationId: id }; }
    attachReservationToIntent(id, intentId) { const reservation = this.entryReservations.get(id); if (reservation)
        this.entryReservations.set(id, { ...reservation, intentId, status: 'WORKING' }); }
    releaseEntryReservation(id) { const reservation = this.entryReservations.get(id); if (!reservation)
        return; this.entryReservations.set(id, { ...reservation, status: 'RELEASED' }); const lock = this.underlyingLocks.get(reservation.underlying); if (lock?.reservationId === id)
        this.underlyingLocks.delete(reservation.underlying); }
    commitEntryReservation(id) { const reservation = this.entryReservations.get(id); if (!reservation)
        return; this.entryReservations.set(id, { ...reservation, status: 'COMMITTED' }); const lock = this.underlyingLocks.get(reservation.underlying); if (lock?.reservationId === id)
        this.underlyingLocks.delete(reservation.underlying); }
    reservationSummary() { this.cleanupReservations(); const active=[...this.entryReservations.values()].filter(x => ['RESERVED', 'WORKING'].includes(x.status)),locks=[...this.underlyingLocks.entries()].map(([underlying, value]) => ({ underlying, ...value })),activeById=new Map(active.map(row=>[row.id,row])),orphanLocks=locks.filter(lock=>{const reservation=activeById.get(lock.reservationId);return !reservation||reservation.underlying!==lock.underlying;}); return { active, locks, orphanLocks, expiredLocks:locks.filter(lock=>lock.leaseUntil<=Date.now()) }; }
    recordExecutionFill(fill) { const index = this.executionFills.findIndex(row => row.fillId === fill.fillId||(row.symbol===fill.symbol&&String(row.tradeId)===String(fill.tradeId))); if (index >= 0)
        this.executionFills[index] = fill;
    else
        this.executionFills.unshift(fill); if (this.executionFills.length > 5000)
        this.executionFills.length = 5000; }
    serialize() { return { generation: this.generation, marketGeneration: this.marketGeneration, positions: [...this.positions], entryIntents: [...this.entryIntents], entryOrders: [...this.entryOrders], tpOrders: [...this.tpOrders], manualExitGoals:[...this.manualExitGoals], manualIntents: [...this.manualIntents], manualOrders: [...this.manualOrders], allocationPlans: [...this.allocationPlans], entryReservations: [...this.entryReservations], underlyingLocks: [...this.underlyingLocks], runtimeControl: this.runtimeControl, executionGovernance: this.executionGovernance, shadowRunner: this.shadowRunner, aiRuns: this.aiRuns, rejectionCooldown: [...this.rejectionCooldown], candidateLifecycle:[...this.candidateLifecycle], directionDecisionStates:[...this.directionDecisionStates], tradeOutcomes: this.tradeOutcomes, tradeRecords: [...this.tradeRecords], experienceSamples: [...this.experienceSamples], executionFills: this.executionFills, lifecycles: [...this.lifecycles], activity: this.activity, account: this.account }; }
    restore(value) { if (!value || typeof value !== 'object')
        return; this.generation = Number(value.generation) || 1; this.marketGeneration = Number(value.marketGeneration) || this.generation; for (const [key, target] of [['positions', this.positions], ['entryIntents', this.entryIntents], ['entryOrders', this.entryOrders], ['tpOrders', this.tpOrders], ['manualExitGoals',this.manualExitGoals], ['manualIntents', this.manualIntents], ['manualOrders', this.manualOrders], ['allocationPlans', this.allocationPlans], ['tradeRecords', this.tradeRecords], ['experienceSamples', this.experienceSamples], ['rejectionCooldown', this.rejectionCooldown], ['candidateLifecycle', this.candidateLifecycle], ['lifecycles', this.lifecycles], ['entryReservations', this.entryReservations], ['underlyingLocks', this.underlyingLocks]])
        if (Array.isArray(value[key]))
            for (const [id, source] of value[key]) {
                const row = key === 'positions' ? { entryTimeSource: 'UNKNOWN', managementStatus: 'AUTO_MANAGED', humanManagedAt: null, tpLastVerifiedAt: null, tpCoverageSource: 'NONE', firstObservedAt: null, ...source } : source;
                target.set(id, row);
            } for(const [symbol,row] of this.candidateLifecycle){if(['SCOUT_QUEUED','SCOUT_RUNNING','SCOUT_DONE','PRIMARY_QUEUED','PRIMARY_RUNNING','PRIMARY_COMPLETED','PLACE_READY'].includes(row?.status)){this.candidateLifecycle.set(symbol,{...row,status:'READY',reason:'ENGINE_RESTART_RECOVERY',nextEligibleAt:null,updatedAt:Date.now()});}} if (value.runtimeControl && typeof value.runtimeControl.mode === 'string')
        if (Array.isArray(value.directionDecisionStates)) for (const [id,row] of value.directionDecisionStates) this.directionDecisionStates.set(id,row); this.runtimeControl = { ...this.runtimeControl, ...value.runtimeControl, entrySafetyMode: value.runtimeControl.entrySafetyMode ?? this.runtimeControl.entrySafetyMode, manualRiskOverride: value.runtimeControl.manualRiskOverride ?? null, capital: { ...this.runtimeControl.capital, ...value.runtimeControl.capital } }; if (value.executionGovernance && typeof value.executionGovernance.mode === 'string') this.executionGovernance = value.executionGovernance; if (value.shadowRunner && typeof value.shadowRunner === 'object')
        this.shadowRunner = { ...this.shadowRunner, ...value.shadowRunner }; this.cleanupReservations(); if (Array.isArray(value.executionFills))
        this.executionFills = value.executionFills.slice(0, 5000); if (Array.isArray(value.aiRuns)) {
        const recoveredAt = Date.now();
        this.aiRuns = value.aiRuns.slice(0, 200).map((run) => run.status === 'RUNNING' ? { ...run, status: 'FAILED', completedAt: recoveredAt, latencyMs: Math.max(0, recoveredAt - run.startedAt), error: 'ENGINE_RESTART_INTERRUPTED', failure: { failureStage: 'RUNTIME_RECOVERY', errorCode: 'ENGINE_RESTART_INTERRUPTED', errorMessage: 'AI run was interrupted by engine restart', httpStatus: null, timeout: false, schemaValidation: false, retryCount: 0, rawOutput: null } } : run);
    } if (Array.isArray(value.tradeOutcomes))
        this.tradeOutcomes = value.tradeOutcomes.slice(0, 1000); if (value.activity && typeof value.activity === 'object')
        this.activity = { ...this.activity, ...value.activity }; if (value.account && typeof value.account.status === 'string')
        this.account = value.account; }
}


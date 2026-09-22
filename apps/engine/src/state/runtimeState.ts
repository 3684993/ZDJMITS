// @ts-nocheck
import { DynamicPool, resolveUnderlying } from '@zdj/core';
import { entryOrderOccupiesRisk } from '../services/entryRiskOccupancy.js';
import { privateAccountFresh } from '../services/privateAccountReadiness.js';
export type PositionLifecycleState = any;
export type AccountState = any;
const RESERVATION_NO_CHANGE='RESERVATION_NO_CHANGE';
const RESERVATION_TERMINAL_STATUS=new Set(['RELEASED','COMMITTED']);
const RESERVATION_KNOWN_STATUS=new Set(['RESERVED','WORKING','RELEASED','COMMITTED']);
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
    entryReservationRevision = 0;
    entryReservationTransaction = null;
    entryRiskGate = null;
    /** Serialized portfolio risk ledger (generation + last content hash). Never an authority by itself. */
    riskLedger = null;
    private reservationMutationActive = false;
    private reservationMapsChanged(reservations,locks) {
        const same=(left,right)=>left.size===right.size&&[...left].every(([key,value])=>right.has(key)&&JSON.stringify(value)===JSON.stringify(right.get(key)));
        return !same(reservations,this.entryReservations)||!same(locks,this.underlyingLocks);
    }
    /** Any status the ledger has not positively terminalised still occupies risk while it is inside its ttl. */
    reservationOccupiesRisk(row,now=Date.now()) { return !RESERVATION_TERMINAL_STATUS.has(String(row?.status))&&Number(row?.expiresAt??0)>now; }
    /** An expired row that no mutation has terminalised yet keeps pinning quote margin and its slot. */
    reservationHoldsRisk(row) { return !RESERVATION_TERMINAL_STATUS.has(String(row?.status)); }
    private reservationNoChange(result) { const error=new Error(RESERVATION_NO_CHANGE);error.code=RESERVATION_NO_CHANGE;error.reservationResult=result;return error; }
    private mutateReservations(work) {
        if(this.reservationMutationActive)return work();
        const reservations=new Map(this.entryReservations),locks=new Map(this.underlyingLocks),revision=this.entryReservationRevision;
        const apply=()=>{this.reservationMutationActive=true;try{const value=work();if(!this.reservationMapsChanged(reservations,locks))throw this.reservationNoChange(value);this.entryReservationRevision++;return value;}finally{this.reservationMutationActive=false;}};
        try{return this.entryReservationTransaction?this.entryReservationTransaction(revision,apply):apply();}
        catch(error){this.entryReservations=reservations;this.underlyingLocks=locks;this.entryReservationRevision=revision;if(error&&error.code===RESERVATION_NO_CHANGE)return error.reservationResult;throw error;}
    }
    underlyingLocks = new Map();
    shadowRunner = { status: 'STOPPED', startAt: null, requiredUntil: null, samples: 0, violations: 0, dataQualityBlocks: 0, exposureBlocks: 0, reviewBlocks: 0, wouldStops: 0, duplicateUnderlyingAttempts: 0, reservationConflicts: 0, snapshotInvalidations: 0, lastSampleAt: null, validityEpochAt: null, validObservationStartedAt: null, validObservationRequiredUntil: null, validObservationStreak: 0, shadowOnlyRuns: 0, shadowOnlyPlaceDecisions: 0, shadowOnlyErrors: 0 };
    runtimeControl = { mode: 'RUNNING', reasonCode: 'NONE', reasonText: '运行中', pausedAt: null, pauseSource: 'NONE', autoResume: true, lastTransitionAt: Date.now(), nextCapitalCheckAt: null, entrySafetyMode: 'SAFETY_REVIEW_PAUSED', manualRiskOverride: null, capital: { evaluatedAt: 0, generation: 0, capitalVersion:'0', directionBudget:{longAvailableNotionalUsd:0,shortAvailableNotionalUsd:0,grossAvailableNotionalUsd:0,evaluatedAt:0}, executableCandidateCount: 0, usdtAvailable: 0, usdcAvailable: 0, usdtExecutableUnderlyings: 0, usdcExecutableUnderlyings: 0, noUsdtMargin: 0, noUsdcMargin: 0, noUsdcContract: 0, liquidityRejected: 0, exposureRejected: 0, minMarginRejected: 0, marketNotFresh: 0, underlyingBlocked: 0, reasonCounts: {}, routedCandidates: [], nextRecheckAt: null } };
    executionGovernance = { mode: 'SHADOW_ONLY', changedAt: Date.now(), reason: 'SAFE_DEFAULT', capitalEpochId: null, validationId: null };
    activity = { lastPrimaryRunAt: null, lastPlaceDecisionAt: null, lastEntryIntentAt: null, lastEntrySubmittedAt: null, lastEntryFilledAt: null, primaryRunsSinceLastPlace: 0, uniqueSymbolsSinceLastPlace: 0, consecutiveRejects: 0, placeCount30m: 0, rejectCount30m: 0, primaryCount30m: 0, entryIntentCount30m: 0, submitCount30m: 0, fillCount30m: 0 };
    account = { status: 'NOT_CONFIGURED', source: 'BINANCE_TESTNET_PRIVATE', asOf: null, reason: 'Binance Testnet credentials are not configured', equityUsd: null, availableUsd: null, walletBalanceUsd: null, unrealizedPnlUsd: null, realizedPnlUsd24h: null, assets: [], riskBaseline: null };
    pool;
    constructor(settings) {
        this.settings = settings;
        this.pool = new DynamicPool(settings);
    }
    setSettings(settings) { this.settings = settings; this.pool.updateSettings(settings); this.generation++; }
    activeEntrySymbols() { const now=Date.now();return new Set([...this.entryOrders.values()].filter(o => entryOrderOccupiesRisk(o,now)).map(o => o.symbol.toUpperCase())); }
    positionSymbols() { return new Set([...this.positions.values()].map(p => p.symbol.toUpperCase())); }
    addAiRun(run) { this.aiRuns.unshift(run); if (this.aiRuns.length > 200)
        this.aiRuns.length = 200; }
    private cleanupReservationsAtomic(now) {
        let changed=false;
        for (const [id,reservation] of this.entryReservations) {
            const activeOrder=[...this.entryOrders.values()].some(order=>order.reservationId===id&&entryOrderOccupiesRisk(order,now));
            if(reservation.expiresAt<=now&&!RESERVATION_TERMINAL_STATUS.has(String(reservation.status))&&!activeOrder){
                this.entryReservations.set(id,{...reservation,status:'RELEASED'});changed=true;
                if(this.underlyingLocks.get(reservation.underlying)?.reservationId===id){this.underlyingLocks.delete(reservation.underlying);changed=true;}
            }
        }
        for(const [key,lock] of this.underlyingLocks)if(lock.leaseUntil<=now){this.underlyingLocks.delete(key);changed=true;}
        return changed;
    }
    private reservationCleanupNeeded(now) {
        if(!Number.isFinite(now))return false;
        for(const [id,reservation] of this.entryReservations){
            if(reservation.expiresAt>now||RESERVATION_TERMINAL_STATUS.has(String(reservation.status)))continue;
            const activeOrder=[...this.entryOrders.values()].some(order=>order.reservationId===id&&entryOrderOccupiesRisk(order,now));
            if(!activeOrder)return true;
        }
        return [...this.underlyingLocks.values()].some(lock=>lock.leaseUntil<=now);
    }
    cleanupReservations(now = Date.now()) {
        if(!this.reservationCleanupNeeded(now))return false;
        try{return this.mutateReservations(()=>this.cleanupReservationsAtomic(now));}
        catch{return false;}
    }
    entryCapacity(ignoreOrderId=null,ignoreReservationId=null,now=Date.now()) {
        const held=new Set([...this.positions.values()].map(p=>resolveUnderlying(p.symbol))),orders=[...this.entryOrders.values()].filter(o=>o.id!==ignoreOrderId&&entryOrderOccupiesRisk(o,now));
        const inFlight=new Set(orders.map(o=>resolveUnderlying(o.symbol)).filter(u=>!held.has(u))),reservations=[...this.entryReservations.values()].filter(r=>r.id!==ignoreReservationId&&this.reservationOccupiesRisk(r,now)&&!held.has(String(r.underlying).toUpperCase())&&!inFlight.has(String(r.underlying).toUpperCase()));
        const reserved=new Set(reservations.map(r=>String(r.underlying).toUpperCase()));return {positions:this.positions.size,inFlight:inFlight.size,reserved:reserved.size,used:this.positions.size+inFlight.size+reserved.size,max:this.settings.portfolio.maxPositions};
    }
    reserveEntry(input) {
        try{return this.mutateReservations(()=>this.reserveEntryAtomic(input));}
        catch{return {ok:false,reason:'RESERVATION_DURABILITY_FAILED'};}
    }
    private reserveEntryAtomic(input) {
        if(!input||typeof input.underlying!=='string'||!input.underlying.trim()||!['USDT','USDC'].includes(input.quoteAsset)||
           ['marginUsd','notionalUsd','ttlSeconds','leaseSeconds'].some(key=>typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<=0)||
           ['maxPositions','maxConcurrentReservations'].some(key=>!Number.isSafeInteger(input[key])||input[key]<=0))return {ok:false,reason:'RESERVATION_FACTS_INVALID'};
        const now=Date.now();this.cleanupReservationsAtomic(now);
        const underlying=input.underlying.toUpperCase(),lock=this.underlyingLocks.get(underlying);
        if(lock&&lock.leaseUntil>now)return {ok:false,reason:'UNDERLYING_LOCKED'};
        const reserved=[...this.entryReservations.values()].filter(x=>this.reservationHoldsRisk(x));
        if(reserved.some(x=>String(x.underlying).toUpperCase()===underlying))return {ok:false,reason:'UNDERLYING_LOCKED'};
        if(reserved.length>=input.maxConcurrentReservations)return {ok:false,reason:'RESERVATION_CAPACITY'};
        if(this.entryCapacity(null,null,now).used>=input.maxPositions)return {ok:false,reason:'MAX_POSITIONS_REACHED'};
        const available=this.account.assets.find(x=>x.asset===input.quoteAsset)?.availableBalance;
        const committed=reserved.filter(x=>x.quoteAsset===input.quoteAsset).reduce((n,x)=>n+Math.max(0,Number(x.marginUsd)),0);
        if(!Number.isFinite(available)||!Number.isFinite(committed)||available-committed<input.marginUsd)return {ok:false,reason:'RESERVED_QUOTE_MARGIN'};
        // C2/D1: the authoritative facts are re-read and enforced inside this BEGIN IMMEDIATE window.
        if(!privateAccountFresh(this.account,now))return {ok:false,reason:`PRIVATE_ACCOUNT_${this.account?.status==='READY'?'STALE':String(this.account?.status??'UNKNOWN')}`};
        const capital=this.runtimeControl?.capital;
        if(!Number.isSafeInteger(capital?.generation)||capital.generation<=0)return {ok:false,reason:'CAPITAL_GENERATION_REQUIRED'};
        if(!Number.isFinite(capital?.evaluatedAt)||capital.evaluatedAt>now)return {ok:false,reason:'CAPITAL_EVALUATION_UNPROVEN'};
        const capitalVersion=String(capital?.capitalVersion??'').trim();
        if(!capitalVersion||capitalVersion==='0')return {ok:false,reason:'CAPITAL_VERSION_REQUIRED'};
        if(!Number.isFinite(capital?.nextRecheckAt)||capital.nextRecheckAt<=now)return {ok:false,reason:'CAPITAL_FACTS_EXPIRED'};
        if(input.riskCapitalVersion!==undefined&&input.riskCapitalVersion!==null&&String(input.riskCapitalVersion).trim()!==capitalVersion)return {ok:false,reason:'CAPITAL_VERSION_STALE'};
        // J2: the portfolio admission is the only source of a risk binding. There is no default
        // binding computed from the capital route, and no selection generation standing in for a
        // risk generation - without a snapshot of what the account actually holds, no new risk.
        if(typeof this.entryRiskGate!=='function')return {ok:false,reason:'RISK_ADMISSION_UNPROVEN'};
        const risk=this.entryRiskGate({...input,now,riskGeneration:capital.generation,capitalVersion});
        if(!risk||risk.allowed!==true)return {ok:false,reason:risk?.reason??'PORTFOLIO_ADMISSION_BLOCKED'};
        const binding=risk.binding;
        if(!Number.isSafeInteger(binding?.riskGeneration)||binding.riskGeneration<=0||typeof binding.snapshotHash!=='string'||!/^v396r[0-9a-f]{32,}$/.test(binding.snapshotHash)||
           !Number.isFinite(binding.evaluatedAt)||binding.evaluatedAt>now||!Number.isFinite(binding.expiresAt)||binding.expiresAt<=now||!String(binding.profileVersion??'').trim())
            return {ok:false,reason:'RISK_BINDING_INVALID'};
        if(input.riskGeneration!==undefined&&input.riskGeneration!==null&&input.riskGeneration!==binding.riskGeneration)return {ok:false,reason:'RISK_GENERATION_STALE'};
        const id=`reserve_${now}_${Math.random().toString(36).slice(2,8)}`;
        this.entryReservations.set(id,{id,underlying,quoteAsset:input.quoteAsset,marginUsd:input.marginUsd,notionalUsd:input.notionalUsd,planId:input.planId,intentId:null,createdAt:now,expiresAt:now+input.ttlSeconds*1000,status:'RESERVED',riskBinding:binding});
        this.underlyingLocks.set(underlying,{reservationId:id,leaseUntil:now+input.leaseSeconds*1000});
        return {ok:true,reservationId:id};
    }
    /**
     * The only legal way to occupy a reservation again. An ordinary retry may only move a live
     * RESERVED row to WORKING; a row that is RELEASED or already past its ttl comes back only when
     * a remote order fact is supplied, and a COMMITTED row never comes back at all.
     */
    markEntryReservationWorking(id,intentId=null,exchangeFact=null){return this.mutateReservations(()=>{
        const reservation=this.entryReservations.get(id);if(!reservation)return false;
        const now=Date.now(),status=String(reservation.status),orderId=String(exchangeFact?.orderId??'').trim(),reason=String(exchangeFact?.reason??'').trim();
        const proven=Boolean(orderId)&&Boolean(reason);
        if(status==='COMMITTED')return false;
        if(status==='WORKING'){if(!reservation.intentId&&intentId)this.entryReservations.set(id,{...reservation,intentId});return true;}
        if(status==='RESERVED'&&Number(reservation.expiresAt)>now){this.entryReservations.set(id,{...reservation,intentId:intentId??reservation.intentId,status:'WORKING'});return true;}
        if(!proven)return false;
        this.entryReservations.set(id,{...reservation,intentId:intentId??reservation.intentId,status:'WORKING',reopenedBy:'EXCHANGE_FACT',reopenedFromStatus:status,reopenOrderId:orderId,reopenReason:reason,reopenedAt:now});return true;
    });}
    attachReservationToIntent(id,intentId){return this.markEntryReservationWorking(id,intentId);}
    /** Startup merge of a durable reservation fact; an unrecognised status stays occupied, never free capacity. */
    upsertRecoveredEntryReservation(row){
        const id=String(row?.id??'').trim(),underlying=String(row?.underlying??'').trim().toUpperCase(),expiresAt=Number(row?.expiresAt),marginUsd=Number(row?.marginUsd);
        if(!id||!underlying||!Number.isFinite(expiresAt)||!Number.isFinite(marginUsd))return false;
        const rawStatus=String(row?.status??''),status=RESERVATION_KNOWN_STATUS.has(rawStatus)?rawStatus:'WORKING';
        return this.mutateReservations(()=>{
            const existing=this.entryReservations.get(id);
            if(existing&&RESERVATION_TERMINAL_STATUS.has(String(existing.status))&&!RESERVATION_TERMINAL_STATUS.has(status))return false;
            const merged={...row,id,underlying,status,expiresAt,marginUsd};
            if(rawStatus!==status)merged.recoveryReason='RESERVATION_STATUS_UNKNOWN';
            if(existing&&JSON.stringify(existing)===JSON.stringify(merged))return false;
            this.entryReservations.set(id,merged);return true;
        });
    }
    releaseEntryReservation(id){return this.mutateReservations(()=>{
        const reservation=this.entryReservations.get(id);if(!reservation||!['RESERVED','WORKING'].includes(reservation.status))return false;
        if([...this.entryOrders.values()].some(order=>order.reservationId===id&&entryOrderOccupiesRisk(order,Date.now())))return false;
        this.entryReservations.set(id,{...reservation,status:'RELEASED'});
        if(this.underlyingLocks.get(reservation.underlying)?.reservationId===id)this.underlyingLocks.delete(reservation.underlying);
        return true;
    });}
    commitEntryReservation(id){return this.mutateReservations(()=>{const reservation=this.entryReservations.get(id);if(!reservation||!['RESERVED','WORKING'].includes(reservation.status))return false;this.entryReservations.set(id,{...reservation,status:'COMMITTED'});if(this.underlyingLocks.get(reservation.underlying)?.reservationId===id)this.underlyingLocks.delete(reservation.underlying);return true;});}
    /** C2/D4: a pure read. Expiry is reported as diagnostics and released only by a mutation path. */
    reservationSummary(now = Date.now()) { const active=[...this.entryReservations.values()].filter(x => this.reservationHoldsRisk(x)),locks=[...this.underlyingLocks.entries()].map(([underlying, value]) => ({ underlying, ...value })),activeById=new Map(active.map(row=>[row.id,row])),orphanLocks=locks.filter(lock=>{const reservation=activeById.get(lock.reservationId);return !reservation||reservation.underlying!==lock.underlying;}),expiredReservations=active.filter(row=>Number(row.expiresAt)<=now).map(row=>({id:row.id,underlying:row.underlying,status:row.status,expiresAt:row.expiresAt})); return { active, locks, orphanLocks, expiredReservations, expiredLocks:locks.filter(lock=>lock.leaseUntil<=now) }; }
    recordExecutionFill(fill) { const index = this.executionFills.findIndex(row => row.fillId === fill.fillId||(row.symbol===fill.symbol&&String(row.tradeId)===String(fill.tradeId))); if (index >= 0)
        this.executionFills[index] = fill;
    else
        this.executionFills.unshift(fill); if (this.executionFills.length > 5000)
        this.executionFills.length = 5000; }
    serialize() { return { entryReservationRevision:this.entryReservationRevision, riskLedger:this.riskLedger, generation: this.generation, marketGeneration: this.marketGeneration, positions: [...this.positions], entryIntents: [...this.entryIntents], entryOrders: [...this.entryOrders], tpOrders: [...this.tpOrders], manualExitGoals:[...this.manualExitGoals], manualIntents: [...this.manualIntents], manualOrders: [...this.manualOrders], allocationPlans: [...this.allocationPlans], entryReservations: [...this.entryReservations], underlyingLocks: [...this.underlyingLocks], runtimeControl: this.runtimeControl, executionGovernance: this.executionGovernance, shadowRunner: this.shadowRunner, aiRuns: this.aiRuns, rejectionCooldown: [...this.rejectionCooldown], candidateLifecycle:[...this.candidateLifecycle], directionDecisionStates:[...this.directionDecisionStates], tradeOutcomes: this.tradeOutcomes, tradeRecords: [...this.tradeRecords], experienceSamples: [...this.experienceSamples], executionFills: this.executionFills, lifecycles: [...this.lifecycles], activity: this.activity, account: this.account }; }
    restore(value) { if (!value || typeof value !== 'object')
        return; this.entryReservationRevision=Number.isSafeInteger(value.entryReservationRevision)?value.entryReservationRevision:0; this.riskLedger=value.riskLedger&&typeof value.riskLedger==='object'?value.riskLedger:null; this.generation = Number(value.generation) || 1; this.marketGeneration = Number(value.marketGeneration) || this.generation; for (const [key, target] of [['positions', this.positions], ['entryIntents', this.entryIntents], ['entryOrders', this.entryOrders], ['tpOrders', this.tpOrders], ['manualExitGoals',this.manualExitGoals], ['manualIntents', this.manualIntents], ['manualOrders', this.manualOrders], ['allocationPlans', this.allocationPlans], ['tradeRecords', this.tradeRecords], ['experienceSamples', this.experienceSamples], ['rejectionCooldown', this.rejectionCooldown], ['candidateLifecycle', this.candidateLifecycle], ['lifecycles', this.lifecycles], ['entryReservations', this.entryReservations], ['underlyingLocks', this.underlyingLocks]])
        if (Array.isArray(value[key]))
            for (const [id, source] of value[key]) {
                const row = key === 'positions' ? { entryTimeSource: 'UNKNOWN', managementStatus: 'AUTO_MANAGED', humanManagedAt: null, tpLastVerifiedAt: null, tpCoverageSource: 'NONE', firstObservedAt: null, ...source } : source;
                target.set(id, row);
            } for(const [symbol,row] of this.candidateLifecycle){if(['SCOUT_QUEUED','SCOUT_RUNNING','SCOUT_DONE','PRIMARY_QUEUED','PRIMARY_RUNNING','PRIMARY_COMPLETED','PLACE_READY'].includes(row?.status)){this.candidateLifecycle.set(symbol,{...row,status:'READY',reason:'ENGINE_RESTART_RECOVERY',nextEligibleAt:null,updatedAt:Date.now()});}} if (value.runtimeControl && typeof value.runtimeControl.mode === 'string')
        if (Array.isArray(value.directionDecisionStates)) for (const [id,row] of value.directionDecisionStates) this.directionDecisionStates.set(id,row); this.runtimeControl = { ...this.runtimeControl, ...value.runtimeControl, entrySafetyMode: value.runtimeControl.entrySafetyMode ?? this.runtimeControl.entrySafetyMode, manualRiskOverride: value.runtimeControl.manualRiskOverride ?? null, capital: { ...this.runtimeControl.capital, ...value.runtimeControl.capital } }; if (value.executionGovernance && typeof value.executionGovernance.mode === 'string') this.executionGovernance = value.executionGovernance; if (value.shadowRunner && typeof value.shadowRunner === 'object')
        this.shadowRunner = { ...this.shadowRunner, ...value.shadowRunner }; if (Array.isArray(value.executionFills))
        this.executionFills = value.executionFills; if (Array.isArray(value.aiRuns)) {
        const recoveredAt = Date.now();
        this.aiRuns = value.aiRuns.slice(0, 200).map((run) => run.status === 'RUNNING' ? { ...run, status: 'FAILED', completedAt: recoveredAt, latencyMs: Math.max(0, recoveredAt - run.startedAt), error: 'ENGINE_RESTART_INTERRUPTED', failure: { failureStage: 'RUNTIME_RECOVERY', errorCode: 'ENGINE_RESTART_INTERRUPTED', errorMessage: 'AI run was interrupted by engine restart', httpStatus: null, timeout: false, schemaValidation: false, retryCount: 0, rawOutput: null } } : run);
    } if (Array.isArray(value.tradeOutcomes))
        this.tradeOutcomes = value.tradeOutcomes.slice(0, 1000); if (value.activity && typeof value.activity === 'object')
        this.activity = { ...this.activity, ...value.activity }; if (value.account && typeof value.account.status === 'string')
        this.account = value.account; }
}
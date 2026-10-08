# Source call graph
Commit `3242a79bb480db81d7bd5fba9bd3a7300e8256e5`. Line numbers generated directly from this checkout.

Universe / market → pre-AI envelope → frozen quantity/horizon/target set → Primary candidate ID → allocation → immutable TradePlan → capital reservation → intent → durable journal identity claim → JIT/funds/environment check → exact adapter submit → WS/exact recovery → fills → physical cycle / TP / owner → per-lot lineage.

TESTNET funds-only bypasses old occupancy and portfolio-risk vetoes; submission identity remains per intent. A deterministic NO-SEPARATE-ADD policy is absent in this baseline. `addCount` increments quantity transitions and is not a count of independent orders. Historical owners and order histories are not inferred from current source.

| Source | Exact line | Excerpt |
|---|---:|---|
| `apps/engine/src/services/entryCoordinator.ts` | 192 | `!this.primaryOccupancyBlock(x.symbol) &&` |
| `apps/engine/src/services/entryCoordinator.ts` | 259 | `private objectiveCapacity(symbol:string){try{const envelope=buildPreAiExecutionEnvelope(this.state,symbol);return envelope.LONG.executable /  / envelope.SHORT.executable;}catch{return false;}}` |
| `apps/engine/src/services/entryCoordinator.ts` | 260 | `private primaryOccupancyBlock(symbol:string){` |
| `apps/engine/src/services/entryCoordinator.ts` | 261 | `if(testnetFundsOnlyEntry(this.state.settings))return null;` |
| `apps/engine/src/services/entryCoordinator.ts` | 269 | `const reason=this.primaryOccupancyBlock(symbol);if(!reason)return false;` |
| `apps/engine/src/services/entryCoordinator.ts` | 341 | `private async submitExactlyOnce(intent:EntryIntent,order:EntryOrder,resumedFrom?:string){` |
| `apps/engine/src/services/entryCoordinator.ts` | 360 | `const isolation=entrySubmissionIsolation(this.state.settings,{environment,accountId:account,intentId:intent.id,underlying,kind:'ENTRY'});` |
| `apps/engine/src/services/entryCoordinator.ts` | 427 | `try{const mandate=intent.economicMandate,requestFacts={schemaVersion:'V397-ENTRY-ADAPTER-REQUEST-1',intentId:intent.id,mandateId:mandate?.mandateId??null,orderId:submitting.id,clientOrderId:submitting.clientOrderId,symbol:submitting.symbol,side:submitting.side` |
| `apps/engine/src/services/entryCoordinator.ts` | 474 | `try{await this.exchange.setLeverage(symbol,intent.leverage);}catch(error){this.events.publish('ENTRY_EXECUTION_WAIT_RETRY_FAILED',{intentId:intent.id,message:error instanceof Error?error.message:String(error),stage:'SET_LEVERAGE'},symbol);continue;}` |
| `apps/engine/src/services/entryCoordinator.ts` | 525 | `executionEnvelope=buildPreAiExecutionEnvelope(this.state,symbol,Date.now(),reachability);` |
| `apps/engine/src/services/entryCoordinator.ts` | 547 | `const candidateBuild=this.buildPreAiCandidateSets(symbol,executionEnvelope);` |
| `apps/engine/src/services/entryCoordinator.ts` | 688 | `const plan=materializeCandidateQuantityAllocation({state:this.state,candidate,snapshot:market,side,quantityUnits,authorizationMaxPrice:frozenEntryRange.max,envelope:selectedExecutionEnvelope});` |
| `apps/engine/src/services/entryCoordinator.ts` | 744 | `const planOutcome=this.buildAndPersistTradePlan({symbol,side,market,d:authorizedDecision,result,executionEnvelope:selectedExecutionEnvelope,admission,allocation:plan,cycleId:cycleIdOfIntent,candidateSet});` |
| `apps/engine/src/services/entryCoordinator.ts` | 755 | `const reservation = this.state.reserveEntry({underlying:plan.underlying,quoteAsset:plan.quoteAsset,marginUsd:plan.marginUsd,notionalUsd:plan.notionalUsd,planId:plan.planId,maxPositions:this.state.settings.portfolio.maxPositions,ttlSeconds:this.state.settings.r` |
| `apps/engine/src/services/entryCoordinator.ts` | 792 | `try {await this.exchange.setLeverage(symbol, leverage);} catch (error) {const reason=error instanceof Error?error.message:String(error);this.state.releaseEntryReservation(reservationId);this.events.publish("ENTRY_ORDER_BLOCKED",{intentId:intent.id,planId:trade` |
| `apps/engine/src/services/entryCoordinator.ts` | 903 | `private buildPreAiCandidateSets(symbol:string,executionEnvelope:ReturnType<typeof buildPreAiExecutionEnvelope>){` |
| `apps/engine/src/services/entryCoordinator.ts` | 981 | `private buildAndPersistTradePlan(input:{symbol:string;side:'LONG' / 'SHORT';market:any;d:any;result:any;executionEnvelope:any;admission:any;allocation:any;cycleId:string;candidateSet:CandidateSet}){` |
| `apps/engine/src/services/entryCoordinator.ts` | 1087 | `if(testnetFundsOnlyEntry(this.state.settings))return null;` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 3 | `export function leverageChoices(policyMaximum:number,exchangeMaximum:number):number[]{` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 15 | `export function minimumQuantityForTarget(input:FrozenSizingInput){` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 23 | `const notionalFloor=Math.max(input.exchangeMinimumNotional,input.businessMinimumNotional,` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 26 | `const ceilingUnits=Math.floor(input.availableMarginQuote*leverage/(entryPrice*stepSize)+1e-9);` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 34 | `if(!profitable(ceilingUnits))return null;` |
| `apps/engine/src/services/v397FrozenSizing.ts` | 36 | `while(lo<hi){const mid=Math.floor((lo+hi)/2);if(profitable(mid))hi=mid;else lo=mid+1;}` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 51 | `export function quantityLadder(minUnits:number,maxUnits:number,stepSize:number,entryPrice:number,minNotional:number){` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 119 | `export function buildQuantityHorizonCandidates(input:{` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 157 | `const quantityCeiling=Math.min(Number(envelope.maxQuantityUnits??0),Number(envelope.maxNotionalUsd??0)/(quote.stepSize*entryPrice),` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 194 | `const solved=minimumQuantityForTarget({quoteAsset,side,entryPrice,targetPrice:target,stepSize:quote.stepSize,minQty:quote.minQty,` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 261 | `const risk:TradePlanRisk / null=input.risk?{capitalAtRiskUsd:round(input.risk.capitalAtRiskUsd+margin,6),grossNotionalAfterUsd:round(input.risk.grossNotionalAfterUsd+notional,6),` |
| `apps/engine/src/services/quantityHorizonCandidates.ts` | 267 | `const sizingProof=input.candidateSchemaVersion==='V397-PLAN-CANDIDATE-1'?{` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 58 | `positionCapacity:{used:number;max:number;slotAvailable:boolean;sameUnderlyingOccupied:boolean};` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 91 | `export function buildPreAiExecutionEnvelope(state:RuntimeState,symbol:string,now=Date.now(),reachability?:HistoricalTpReachabilityEnvelope):PreAiExecutionEnvelope {` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 94 | `const equityUsd=Number(state.account.equityUsd??0),availableBalance=Number(state.account.assets.find((asset:any)=>asset.asset===quoteAsset)?.availableBalance??0);` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 96 | `const leverageTiers=state.marginTierCoverage?.tiersBySymbol?.[symbol]??[],fundsOnlyPolicy=testnetFundsOnlyEntry(state.settings),` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 99 | `leverage0=fundsOnlyPolicy?Math.max(1,leverageOptions.at(-1)??0):Math.min(Number(p.globalMaxLeverage??1),Number(candidate?.recommendedLeverage??p.globalMaxLeverage??1)),` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 102 | `const privateReady=privateAccountFresh(state.account,now),capacity=state.entryCapacity(),sameUnderlyingOccupied=[...state.positions.values()].some(row=>resolveUnderlying(row.symbol)===underlying) /  / [...state.entryOrders.values()].some(row=>resolveUnderlying` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 103 | `const slotAvailable=testnetFundsOnlyEntry(state.settings) /  / (capacity.used<state.settings.portfolio.maxPositions&&!sameUnderlyingOccupied);` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 125 | `const fundsOnly=testnetFundsOnlyEntry(state.settings);` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 131 | `const maxNotionalUsd=slotAvailable&&(fundsOnly /  / risk.executable)` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 132 | `?Math.max(0,fundsOnly?quoteNotionalCapacity:Math.min(quoteNotionalCapacity,risk.finalNotional)):0,` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 145 | `const executable=(!fundsOnly /  / leverageOptions.length>0)&&businessMinimumConfigured&&marginTierProven&&privateReady&&slotAvailable&&!humanHardBlock&&maxNotionalUsd+1e-8>=Math.max(minimumNotional,businessMinimumNotional)&&legalMaxQuantityUnits>=minQuantityUn` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 146 | `const blockers=[...(fundsOnly?[]:risk.blockers),...(humanHardBlock?['HUMAN_MANAGED_EXPOSURE_LIMIT']:[]),...(marginTierProven?[]:[`MARGIN_TIER_SYMBOL_UNPROVEN:${symbol}`]),...(minimumInitialMarginQuote===null?['BUSINESS_MINIMUM_INITIAL_MARGIN_UNCONFIGURED']:[])` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 158 | `const firstBindingConstraint=fundsOnly` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 171 | `const LONG=sideCapacity('LONG'),SHORT=sideCapacity('SHORT'),` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 182 | `const fundsOnly=testnetFundsOnlyEntry(state.settings),operatorMaxInitialMarginQuote=fundsOnly?null:Number.isFinite(Number(p.maxMarginPerPositionUsd))&&Number(p.maxMarginPerPositionUsd)>=0?Number(p.maxMarginPerPositionUsd):null,` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 183 | `operatorMaxEquityPct=fundsOnly?null:Number.isFinite(Number(p.maxEquityPct))&&Number(p.maxEquityPct)>=0?Number(p.maxEquityPct):null,` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 185 | `operatorCapApplied=!fundsOnly&&maxInitialMarginQuote+1e-8<Number(capital.executableMarginUsd??0),` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 188 | `availableInitialMarginQuote:Number(capital.availableBalanceUsd??0),committedInitialMarginQuote:Number(reservedMarginUsd)+Number(executionLeaseMarginUsd),` |
| `apps/engine/src/services/preAiExecutionEnvelope.ts` | 191 | `return {version:'V3.9.3_PRE_AI_EXECUTION_ENVELOPE',resourcePolicy:fundsOnly?'TESTNET_FUNDS_ONLY':'LEGACY_RISK_ENFORCED',symbol,underlying,quoteAsset,executableSides,noExecutableSide:executableSides.length===0,sideAuthorization,entryCapitalBudget,createdAt:now,` |
| `apps/engine/src/services/entrySubmissionIdentity.ts` | 52 | `export function entrySubmissionIsolation(settings:any,identity:{environment:string;accountId:string;intentId:string;underlying:string;kind?:'ENTRY' / 'EXIT'}):EntrySubmissionIsolation{` |
| `apps/engine/src/services/entrySubmissionIdentity.ts` | 56 | `mode:fundsOnly?'SUBMISSION_ONLY':'UNDERLYING_LEGACY',` |
| `apps/engine/src/services/entrySubmissionIdentity.ts` | 60 | `isolationKey:key([identity.environment,identity.accountId,String(identity.underlying??'').trim().toUpperCase(),kind]),` |
| `apps/engine/src/config/settingsStore.ts` | 304 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 319 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 334 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 349 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 364 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 425 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 468 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 671 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 738 | `* and the rows holding those datasets land in one `BEGIN IMMEDIATE`, so there is never a Settings` |
| `apps/engine/src/config/settingsStore.ts` | 970 | `this.db.exec('BEGIN IMMEDIATE');` |
| `apps/engine/src/config/settingsStore.ts` | 1154 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/config/settingsStore.ts` | 1210 | `claimEntryExecution(scope:string,value:EntryExecutionRecord,retryRejected=false,isolation?:{mode:'SUBMISSION_ONLY' / 'UNDERLYING_LEGACY';submissionKey:string;isolationKey:string} / null):EntryClaimOutcome{` |
| `apps/engine/src/config/settingsStore.ts` | 1242 | `if(mode==='UNDERLYING_LEGACY'){` |
| `apps/engine/src/config/settingsStore.ts` | 1267 | `this.db.exec('BEGIN IMMEDIATE');this.transactionActive=true;` |
| `apps/engine/src/config/settingsStore.ts` | 1272 | `saveEntryExecution(value:EntryExecutionRecord){return reconciliationTiming.measure('journal.entry',()=>this.saveEntryExecutionRecord(value));}` |
| `apps/engine/src/config/settingsStore.ts` | 1273 | `private saveEntryExecutionRecord(value:EntryExecutionRecord){` |
| `apps/engine/src/config/settingsStore.ts` | 1407 | `this.db.exec("BEGIN IMMEDIATE");` |
| `apps/engine/src/services/entryLineage.ts` | 6 | `export function projectEntryLineage(record:TradeRecord, context:EntryLineageContext) {` |
| `apps/engine/src/services/entryLineage.ts` | 16 | `if(!lotFills.length /  / Math.min(...lotFills.map(f=>f.executionTime))!==lot.filledAt /  / Math.abs(qty-lot.quantity)>Math.max(1e-8,lot.quantity*1e-8) /  / lot.averagePrice==null /  / Math.abs(cost/qty-lot.averagePrice)>Math.max(1e-8,lot.averagePrice*1e-8))rea` |
| `apps/engine/src/services/entryLineage.ts` | 20 | `if(!plan /  / plan.provenance?.modelRunId!==intent?.brainRunId /  / plan.symbol!==record.symbol /  / plan.planVersion!==intent?.planVersion /  / plan.cycleId!==(intent?.planCycleId??record.cycleId))reasons.push('LOT_PLAN_CHAIN_UNPROVEN');` |
| `apps/engine/src/services/entryLineage.ts` | 21 | `if(!run /  / run.role!=='PRIMARY_BRAIN' /  / run.status!=='COMPLETED' /  / run.symbol!==record.symbol /  / run.requestSource!=='ENTRY')reasons.push('ORIGIN_PRIMARY_RUN_UNPROVEN');` |
| `apps/engine/src/services/entryLineage.ts` | 44 | `const complete=lotQuantityConserved&&lots.length>0&&lots.every(l=>l.status==='EXACT')&&!duplicateRunForIndependentLots;` |
| `apps/engine/src/services/positionLifecycleTracker.ts` | 32 | `lastAddAt:input.quantity>0?now:null,addCount:0,entryOrderIds:[],entryTradeIds:[],exitOrderIds:[],exitTradeIds:[],entryLotIds:input.lotId?[input.lotId]:[],` |
| `apps/engine/src/services/positionLifecycleTracker.ts` | 41 | `...(transition==='INCREASE'?{lastAddAt:now,addCount:Number(previous.addCount??0)+1,...(input.lotId&&!previous.entryLotIds?.includes(input.lotId)?{entryLotIds:[...new Set([...(previous.entryLotIds??[]),input.lotId])]}:{})}:{}),` |
| `apps/engine/src/services/positionService.ts` | 17 | `* close, `lastAddAt`/`addCount` describe the add-ons, and `physicalCycleKey` makes the identity` |
| `apps/engine/src/services/positionService.ts` | 25 | `position.addCount=Math.max(0,Number(lifecycle?.addCount??position.addCount??0));` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 18 | `private userStream:BinanceUserDataStream / null=null;private positionMode:{hedge:boolean;checkedAt:number} / null=null;private openTimeCache=new Map<string,{openedAt:number;source:Position['entryTimeSource'];checkedAt:number}>();private leverageCache=new Map<s` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 33 | `private async signed<T>(method:string,path:string,params:Record<string,string / number / boolean>={},purpose?:string,source?:string){` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 122 | `async placeEntry(order:EntryOrder){const hedge=await this.hedgeMode(),clientOrderId=binanceClientOrderIdFactory.assert(order.clientOrderId??binanceClientOrderIdFactory.create('ML',order.id)),params:Record<string,string / number / boolean>={symbol:order.symbol,` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 130 | `async replaceEntry(order:EntryOrder,price:number){` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 252 | `async fetchPositions(){` |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 355 | `async setLeverage(symbol:string,requested:number){` |
| `apps/engine/src/state/runtimeState.ts` | 125 | `entryReservations = new Map();` |
| `apps/engine/src/state/runtimeState.ts` | 134 | `return !same(reservations,this.entryReservations) /  / !same(locks,this.underlyingLocks);` |
| `apps/engine/src/state/runtimeState.ts` | 143 | `const reservations=new Map(this.entryReservations),locks=new Map(this.underlyingLocks),revision=this.entryReservationRevision;` |
| `apps/engine/src/state/runtimeState.ts` | 146 | `catch(error){this.entryReservations=reservations;this.underlyingLocks=locks;this.entryReservationRevision=revision;if(error&&error.code===RESERVATION_NO_CHANGE)return error.reservationResult;throw error;}` |
| `apps/engine/src/state/runtimeState.ts` | 169 | `for (const [id,reservation] of this.entryReservations) {` |
| `apps/engine/src/state/runtimeState.ts` | 172 | `this.entryReservations.set(id,{...reservation,status:'RELEASED'});changed=true;` |
| `apps/engine/src/state/runtimeState.ts` | 181 | `for(const [id,reservation] of this.entryReservations){` |
| `apps/engine/src/state/runtimeState.ts` | 195 | `const inFlight=new Set(orders.map(o=>resolveUnderlying(o.symbol)).filter(u=>!held.has(u))),reservations=[...this.entryReservations.values()].filter(r=>r.id!==ignoreReservationId&&this.reservationOccupiesRisk(r,now)&&!held.has(String(r.underlying).toUpperCase()` |
| `apps/engine/src/state/runtimeState.ts` | 198 | `reserveEntry(input) {` |
| `apps/engine/src/state/runtimeState.ts` | 209 | `const reserved=[...this.entryReservations.values()].filter(x=>this.reservationHoldsRisk(x));` |
| `apps/engine/src/state/runtimeState.ts` | 239 | `if(testnetFundsOnlyEntry(this.settings)&&input.planId&&[...this.entryReservations.values()].some(row=>row.planId===input.planId))return {ok:false,reason:'PLAN_ALREADY_RESERVED'};` |
| `apps/engine/src/state/runtimeState.ts` | 241 | `this.entryReservations.set(id,{id,underlying,quoteAsset:input.quoteAsset,marginUsd:input.marginUsd,notionalUsd:input.notionalUsd,planId:input.planId,intentId:null,createdAt:now,expiresAt:now+input.ttlSeconds*1000,status:'RESERVED',riskBinding:binding});` |
| `apps/engine/src/state/runtimeState.ts` | 251 | `const reservation=this.entryReservations.get(id);if(!reservation)return false;` |
| `apps/engine/src/state/runtimeState.ts` | 255 | `if(status==='WORKING'){if(!reservation.intentId&&intentId)this.entryReservations.set(id,{...reservation,intentId});return true;}` |
| `apps/engine/src/state/runtimeState.ts` | 256 | `if(status==='RESERVED'&&Number(reservation.expiresAt)>now){this.entryReservations.set(id,{...reservation,intentId:intentId??reservation.intentId,status:'WORKING'});return true;}` |
| `apps/engine/src/state/runtimeState.ts` | 258 | `this.entryReservations.set(id,{...reservation,intentId:intentId??reservation.intentId,status:'WORKING',reopenedBy:'EXCHANGE_FACT',reopenedFromStatus:status,reopenOrderId:orderId,reopenReason:reason,reopenedAt:now});return true;` |
| `apps/engine/src/state/runtimeState.ts` | 267 | `const existing=this.entryReservations.get(id);` |
| `apps/engine/src/state/runtimeState.ts` | 272 | `this.entryReservations.set(id,merged);return true;` |
| `apps/engine/src/state/runtimeState.ts` | 276 | `const reservation=this.entryReservations.get(id);if(!reservation /  / !['RESERVED','WORKING'].includes(reservation.status))return false;` |
| `apps/engine/src/state/runtimeState.ts` | 278 | `this.entryReservations.set(id,{...reservation,status:'RELEASED'});` |
| `apps/engine/src/state/runtimeState.ts` | 282 | `commitEntryReservation(id){return this.mutateReservations(()=>{const reservation=this.entryReservations.get(id);if(!reservation /  / !['RESERVED','WORKING'].includes(reservation.status))return false;this.entryReservations.set(id,{...reservation,status:'COMMITT` |
| `apps/engine/src/state/runtimeState.ts` | 284 | `reservationSummary(now = Date.now()) { const active=[...this.entryReservations.values()].filter(x => this.reservationHoldsRisk(x)),locks=[...this.underlyingLocks.entries()].map(([underlying, value]) => ({ underlying, ...value })),activeById=new Map(active.map(` |
| `apps/engine/src/state/runtimeState.ts` | 290 | `serialize() { return { entryReservationRevision:this.entryReservationRevision, riskLedger:this.riskLedger, aiUsageDroppedRows:this.aiUsageDroppedRows, generation: this.generation, marketGeneration: this.marketGeneration, positions: [...this.positions], entryIn` |
| `apps/engine/src/state/runtimeState.ts` | 308 | `restore(value) { if (!value  /  /  typeof value !== 'object')` |
| `apps/engine/src/state/runtimeState.ts` | 309 | `return; this.entryReservationRevision=Number.isSafeInteger(value.entryReservationRevision)?value.entryReservationRevision:0; this.riskLedger=value.riskLedger&&typeof value.riskLedger==='object'?value.riskLedger:null; this.aiUsageDroppedRows=Math.max(0,Math.tru` |
| `apps/engine/src/services/aiQuantityAllocation.ts` | 21 | `export function materializeCandidateQuantityAllocation(input:{state:RuntimeState;candidate:UniverseCandidate;snapshot:MarketSymbolSnapshot;side:ExecutionEnvelopeSide;quantityUnits:number;authorizationMaxPrice:number;envelope:PreAiExecutionEnvelope}):Allocation` |
| `apps/engine/src/services/aiQuantityAllocation.ts` | 22 | `const {state,candidate,snapshot,side,envelope}=input,units=Number(input.quantityUnits),step=snapshot.quote.stepSize;` |
| `apps/engine/src/services/aiQuantityAllocation.ts` | 30 | `const quantity=units*step,price=Number(input.authorizationMaxPrice),notionalUsd=quantity*price;` |
| `apps/engine/src/services/aiQuantityAllocation.ts` | 41 | `export const materializeAiQuantityAllocation=materializeCandidateQuantityAllocation;` |
| `apps/engine/src/services/executionLease.ts` | 8 | `reservedMarginUsd:number;` |
| `apps/engine/src/services/executionLease.ts` | 14 | `const prune=(state:RuntimeState,now=Date.now())=>{const value=store(state);for(const [id,lease] of value)if(now>=lease.expiresAt)value.delete(id);return value;};` |
| `apps/engine/src/services/executionLease.ts` | 16 | `export function activeExecutionLeaseMargin(state:RuntimeState,quoteAsset:string,now=Date.now(),excludeId?:string){return [...prune(state,now).values()].filter(row=>row.id!==excludeId&&row.quoteAsset===quoteAsset).reduce((sum,row)=>sum+Math.max(0,row.reservedMa` |
| `apps/engine/src/services/executionLease.ts` | 17 | `export function acquireExecutionLease(state:RuntimeState,input:{symbol:string;quoteAsset:string;reservedMarginUsd:number;ttlMs:number},now=Date.now()):{ok:true;lease:ExecutionLease} / {ok:false;reason:string}{` |
| `apps/engine/src/services/executionLease.ts` | 18 | `const requested=Math.max(0,Number(input.reservedMarginUsd));if(!Number.isFinite(requested) /  / requested<=0)return{ok:false,reason:'EXECUTION_LEASE_NO_CAPACITY'};` |
| `apps/engine/src/services/executionLease.ts` | 21 | `const id=`execlease_${input.symbol}_${now}_${Math.random().toString(36).slice(2,9)}`,lease:ExecutionLease={id,symbol:input.symbol,quoteAsset:input.quoteAsset,reservedMarginUsd:requested,createdAt:now,expiresAt:now+Math.max(1_000,input.ttlMs)};store(state).set(` |
| `apps/engine/src/services/executionLease.ts` | 23 | `export function validateExecutionLease(state:RuntimeState,id:string / undefined,symbol:string,now=Date.now()){if(!id)return{ok:false as const,reason:'EXECUTION_LEASE_MISSING'};const lease=prune(state,now).get(id);if(!lease)return{ok:false as const,reason:'EXEC` |
| `apps/engine/src/services/executionLease.ts` | 24 | `export function releaseExecutionLease(state:RuntimeState,id:string / undefined){if(id)store(state).delete(id);}` |
| `apps/engine/src/services/tpGuardian.ts` | 34 | `const quantityUnits=V396ExitRuntime.quantityUnitsOf(order.quantity,stepSize);` |
| `apps/engine/src/services/tpGuardian.ts` | 35 | `if(!quantityUnits)throw new Error(`TP_QUANTITY_STEP_INVALID: ${order.quantity}/${stepSize}`);` |
| `apps/engine/src/services/tpGuardian.ts` | 42 | `// quantity conservatively. Adoption is proved before anything is prepared or persisted, so a` |
| `apps/engine/src/services/tpGuardian.ts` | 50 | `const proof=await this.exchange.proveReduction({symbol:order.symbol,positionSide,quantity:order.quantity});` |
| `apps/engine/src/services/tpGuardian.ts` | 51 | `const liveUnits=V396ExitRuntime.quantityUnitsOf(proof.liveQuantity,stepSize),positionUnits=V396ExitRuntime.quantityUnitsOf(Number(position?.quantity??order.quantity),stepSize) /  / quantityUnits;` |
| `apps/engine/src/services/tpGuardian.ts` | 53 | `const prepared=await this.exitRuntime.prepareTakeProfit({requestKey,subject,quantityUnits,limitPrice:order.price,now:Date.now(),` |
| `apps/engine/src/services/tpGuardian.ts` | 56 | `availableReduceUnits:Math.min(liveUnits,quantityUnits),remainingUnits:positionUnits,minNotional:Number(position?.minNotional??0),tickSize,stepSize,` |
| `apps/engine/src/services/tpGuardian.ts` | 91 | `const identityMatches=fact.order.symbol===submitted.symbol&&fact.order.clientOrderId===prepared.clientOrderId&&String(fact.order.exchangeOrderId??'').trim().length>0&&['','BOTH',positionSide].includes(String(fact.order.positionSide??''))&&V396ExitRuntime.quant` |
| `apps/engine/src/services/tpGuardian.ts` | 92 | `const fillUnits=executed===0?0:V396ExitRuntime.quantityUnitsOf(executed,stepSize);` |
| `apps/engine/src/services/tpGuardian.ts` | 115 | `const units=V396ExitRuntime.quantityUnitsOf(Number(row.quantity),stepSize);` |
| `apps/engine/src/services/tpGuardian.ts` | 118 | `const outcome=this.exitRuntime.adoptRemoteExit({subject,clientOrderId:row.clientOrderId??null,quantityUnits:units,source:'TP',evidenceRef:row.exchangeOrderId??null});` |
| `apps/engine/src/services/tpGuardian.ts` | 126 | `// same reducer keeps the durable task, the quantity claim and this order row agreeing, instead` |
| `apps/engine/src/services/tpGuardian.ts` | 131 | `status:order.status,originalQuantity:order.quantity,executedQuantity:Number((order as any).filledQuantity??0),updateTime:order.updatedAt??Date.now(),` |
| `apps/engine/src/services/tpGuardian.ts` | 134 | `economicsFor(position:Position,exitPrice:number){const settings=this.state.settings.takeProfit,exitRate=settings.exitFeeAssumption==='MAKER'?settings.makerFeeRate:settings.takerFeeRate;return estimateTradingCost({entryPrice:position.entryPrice,qty:position.qua` |
| `apps/engine/src/services/tpGuardian.ts` | 141 | `if(Math.min(Math.abs(order.quantity-fact.originalQty),Math.abs(order.quantity-remaining))>tolerance /  / Number(order.filledQuantity??0)>fact.executedQty+tolerance)continue;` |
| `apps/engine/src/services/tpGuardian.ts` | 142 | `this.state.tpOrders.set(id,{...order,status:fact.state as TakeProfitOrder['status'],quantity:remaining,filledQuantity:fact.executedQty,updatedAt:fact.observedAt});` |
| `apps/engine/src/services/tpGuardian.ts` | 153 | `metrics(){const positions=[...this.state.positions.values()],active=[...this.state.tpOrders.values()].filter(order=>order.status==='WORKING'),byPosition=new Map<string,number>();for(const order of active)byPosition.set(order.positionId,(byPosition.get(order.po` |
| `apps/engine/src/services/tpGuardian.ts` | 162 | `existing=[...this.state.tpOrders.values()].find(o=>o.positionId===current.id&&o.symbol===current.symbol&&o.status==='WORKING'&&o.side===(current.side==='LONG'?'SELL':'BUY')&&Math.abs(o.quantity-current.quantity)<=Math.max(1e-10,current.quantity*1e-6))??existin` |
| `apps/engine/src/services/tpGuardian.ts` | 194 | `if(existing?.status==='WORKING'&&Math.abs(existing.quantity-current.quantity)<=Math.max(1e-10,current.quantity*1e-6)&&existing.side===(current.side==='LONG'?'SELL':'BUY')){` |
| `apps/engine/src/services/tpGuardian.ts` | 211 | `const rawQty=current.quantity*this.state.settings.takeProfit.quantityPercent/100;` |
| `apps/engine/src/services/tpGuardian.ts` | 213 | `if(qty<market.quote.minQty){this.state.positions.set(current.id,{...current,tpStatus:'MANUAL_REVIEW_REQUIRED',tpOrderId:null,tpCoverageSource:'NONE'});this.repairing.delete(current.id);this.events.publish('TP_UNPROTECTED_DUST',{positionId:current.id,quantity:c` |
| `apps/engine/src/services/tpGuardian.ts` | 249 | `const tpEconomics={currentTpPrice:price,expectedGrossProfit:economics.expectedGrossProfit,expectedFees:economics.estimatedTotalFee+economics.slippageBuffer+economics.feeSafetyBuffer,expectedNetProfit:economics.expectedNetProfit,requiredNetProfit:economics.requ` |
| `apps/engine/src/services/tpGuardian.ts` | 262 | `const exhausted=attempt>=5,delay=Math.min(15*60_000,60_000*2**Math.min(attempt-1,4)),nextAt=Date.now()+delay;this.retry.set(current.id,{attempt,nextAt:exhausted&&!contradiction?Date.now()+15*60_000:nextAt,lastError:message});const latest=this.state.positions.g` |
| `apps/engine/src/services/tpGuardian.ts` | 282 | `originalQuantity:Math.max(order.quantity,retained.quantity+Number(retained.filledQuantity??0)),` |
| `apps/engine/src/services/manualPositionService.ts` | 15 | `type Request={action:ManualAction;quantity?:unknown;price?:unknown;confirm?:unknown;idempotencyKey?:unknown;reason?:unknown};` |
| `apps/engine/src/services/manualPositionService.ts` | 24 | `private async quote(position:Position,options:{cacheOnly?:boolean;allowStaleStatic?:boolean}={}){` |
| `apps/engine/src/services/manualPositionService.ts` | 41 | `private async executionQuote(position:Position,explicitLimitPrice:number / null){` |
| `apps/engine/src/services/manualPositionService.ts` | 52 | `async preview(positionId:string,cacheOnly=false){const p=this.state.positions.get(positionId);if(!p)throw new Error('POSITION_NOT_FOUND: 持仓不存在或已被对账关闭');const {quote:q,source,stale}=await this.quote(p,{cacheOnly}),reducePrice=p.side==='LONG'?q.bid:q.ask,addPric` |
| `apps/engine/src/services/manualPositionService.ts` | 53 | `async execute(positionId:string,input:Request){` |
| `apps/engine/src/services/manualPositionService.ts` | 54 | `if(input.action==='EMERGENCY_CLOSE'&&input.confirm===true&&!this.state.manualExitGoals.has(positionId)){` |
| `apps/engine/src/services/manualPositionService.ts` | 58 | `const task=(async()=>{if(prior)await prior.catch(()=>{});return this.executeLocked(positionId,input);})();` |
| `apps/engine/src/services/manualPositionService.ts` | 64 | `async resumeExitGoals(){` |
| `apps/engine/src/services/manualPositionService.ts` | 80 | `if(intent?.action==='EMERGENCY_CLOSE'&&working.status!=='UNKNOWN'&&Date.now()-working.createdAt<30000)continue;` |
| `apps/engine/src/services/manualPositionService.ts` | 90 | `await this.executeLocked(key,{action:'EMERGENCY_CLOSE',confirm:true,idempotencyKey:`${goal.rootKey}:attempt:${goal.attempt}`,reason:'CONTINUE_EXPLICIT_HUMAN_CLOSE'});` |
| `apps/engine/src/services/manualPositionService.ts` | 95 | `private async executeLocked(positionId:string,input:Request){` |
| `apps/engine/src/services/manualPositionService.ts` | 99 | `if(!position&&input.action==='EMERGENCY_CLOSE'){` |
| `apps/engine/src/services/manualPositionService.ts` | 101 | `if(!position)return{intent:null,order:null,replayed:true,goalSatisfied:true,reason:'POSITION_ALREADY_CLOSED'};` |
| `apps/engine/src/services/manualPositionService.ts` | 106 | `if(occupied&&!['REBUILD_TP','REPLACE_TP'].includes(input.action)){const prior=this.state.manualIntents.get(occupied.intentId);if(prior)return{intent:prior,order:occupied,replayed:true,reason:input.action==='EMERGENCY_CLOSE'&&prior.action!=='EMERGENCY_CLOSE'?'E` |
| `apps/engine/src/services/manualPositionService.ts` | 107 | `const remote=await this.exchange.fetchPositions(),fresh=remote.find(x=>x.symbol===position!.symbol&&x.side===position!.side);if(!fresh /  / fresh.quantity<=0)return{intent:null,order:null,replayed:true,goalSatisfied:true,reason:'POSITION_ALREADY_CLOSED'};posit` |
| `apps/engine/src/services/manualPositionService.ts` | 108 | `const action=input.action,now=Date.now(),id=uid('manual_intent'),key=existingKey /  / id,client=binanceClientOrderIdFactory.create(action==='REDUCE'?'MR':action==='ADD'?'MA':action==='PLACE_LIMIT'?'ML':action==='EMERGENCY_CLOSE'?'EC1':'MC',id);let clientForSub` |
| `apps/engine/src/services/manualPositionService.ts` | 110 | `let intent=ManualIntentSchema.parse({id,idempotencyKey:key,positionId,symbol:position.symbol,side:position.side,action,quantity:null,price:null,reduceOnly:action!=='ADD',postOnly:!['EMERGENCY_CLOSE','REBUILD_TP','REPLACE_TP'].includes(action),status:'RECEIVED'` |
| `apps/engine/src/services/manualPositionService.ts` | 115 | `if(action==='EMERGENCY_CLOSE'&&input.confirm!==true)throw new Error('CONFIRMATION_REQUIRED: 紧急平仓必须二次确认');` |
| `apps/engine/src/services/manualPositionService.ts` | 116 | `const numericQty=finite(input.quantity)?Number(input.quantity):null,numericPrice=finite(input.price)?Number(input.price):null,isTp=action==='REPLACE_TP' /  / action==='REBUILD_TP',` |
| `apps/engine/src/services/manualPositionService.ts` | 117 | `explicitLimit=action!=='EMERGENCY_CLOSE'&&numericPrice!==null,` |
| `apps/engine/src/services/manualPositionService.ts` | 121 | `const qty=floorStep(action==='EMERGENCY_CLOSE'?position.quantity:numericQty??position.quantity,q.stepSize);if(qty<q.minQty)throw new Error(`VALIDATION_MIN_QTY: 数量不得小于 ${q.minQty}`);` |
| `apps/engine/src/services/manualPositionService.ts` | 122 | `const side:'BUY' / 'SELL'=action==='ADD'?(position.side==='LONG'?'BUY':'SELL'):(position.side==='LONG'?'SELL':'BUY'),defaultPrice=action==='REDUCE' /  / action==='EMERGENCY_CLOSE'?(position.side==='LONG'?q.bid:q.ask):action==='ADD' /  / action==='PLACE_LIMIT'?` |
| `apps/engine/src/services/manualPositionService.ts` | 123 | `if(price<=0 /  / !align(price,q.tickSize))throw new Error(`VALIDATION_PRICE_PRECISION: 价格必须符合 tickSize ${q.tickSize}`);if(['REDUCE','EMERGENCY_CLOSE'].includes(action)&&qty>position.quantity+1e-9)throw new Error('VALIDATION_QTY_EXCEEDS_POSITION: 不能超过真实持仓');if(` |
| `apps/engine/src/services/manualPositionService.ts` | 124 | `const projected=action==='EMERGENCY_CLOSE'?this.projectedNet(position,price,qty):null;intent=ManualIntentSchema.parse({...intent,quantity:qty,price,status:'VALIDATED',updatedAt:Date.now()});this.state.manualIntents.set(id,intent);this.events.publish('MANUAL_IN` |
| `apps/engine/src/services/manualPositionService.ts` | 126 | `const pendingOrder=ManualOrderSchema.parse({id:`manual_order_${id}`,intentId:id,clientOrderId:client,exchangeOrderId:null,cycleId:position.cycleId,positionId:position.id,symbol:position.symbol,side,positionSide:position.side,type:'LIMIT',quantity:qty,price,red` |
| `apps/engine/src/services/manualPositionService.ts` | 133 | `const rebalanceTp=['REDUCE','EMERGENCY_CLOSE'].includes(action);if(rebalanceTp){protectionCleared=true;await this.clearProtectionForExit(position);}` |
| `apps/engine/src/services/manualPositionService.ts` | 135 | `if(['REDUCE','EMERGENCY_CLOSE'].includes(action)){const prepared=await this.prepareExitClaim(position,qty,price,q as any,key);clientForSubmit=prepared.clientOrderId;coordinatedProof={checkedAt:prepared.checkedAt};coordinatedExit=true;}` |
| `apps/engine/src/services/manualPositionService.ts` | 136 | `const request={clientOrderId:clientForSubmit,internalOrderId:`manual_order_${id}`,symbol:position.symbol,side,positionSide:position.side,type:'LIMIT' as const,quantity:qty,price,reduceOnly:action!=='ADD',postOnly:false};let order:ManualOrder;` |
| `apps/engine/src/services/manualPositionService.ts` | 142 | `try{submissionAttempted=true;order=await this.submitOrder(position,intent,request);if(coordinatedExit)this.convergeExit(clientForSubmit,order,q.stepSize);}catch(submitError){let recovered:ManualOrder / null=null;try{recovered=await this.exchange.findManualByCl` |
| `apps/engine/src/services/manualPositionService.ts` | 154 | `private async prepareExitClaim(position:Position,quantity:number,price:number,quote:{stepSize:number;tickSize:number;minNotional:number},requestKey:string){` |
| `apps/engine/src/services/manualPositionService.ts` | 156 | `const quantityUnits=V396ExitRuntime.quantityUnitsOf(quantity,stepSize);` |
| `apps/engine/src/services/manualPositionService.ts` | 157 | `if(!quantityUnits)throw new Error(`MANUAL_QUANTITY_STEP_INVALID: ${quantity}/${stepSize}`);` |
| `apps/engine/src/services/manualPositionService.ts` | 159 | `const proof=await this.exchange.proveReduction({symbol:position.symbol,positionSide:position.side,quantity});` |
| `apps/engine/src/services/manualPositionService.ts` | 160 | `const liveUnits=V396ExitRuntime.quantityUnitsOf(proof.liveQuantity,stepSize);` |
| `apps/engine/src/services/manualPositionService.ts` | 161 | `const prepared=await this.exitRuntime.prepareManual({requestKey,subject:exitSubjectFromPosition(position),quantityUnits,limitPrice:price,now:Date.now(),` |
| `apps/engine/src/services/manualPositionService.ts` | 170 | `const filledUnits=V396ExitRuntime.quantityUnitsOf(Number(order.filledQuantity??0),Number(stepSize));` |
| `apps/engine/src/services/manualPositionService.ts` | 175 | `private async submitOrder(position:Position,intent:ManualIntent,request:Parameters<AccountExecutor['submit']>[0]){this.state.positions.set(position.id,{...position,managementStatus:'HUMAN_MANAGED',humanManagedAt:Date.now()});this.events.publish('CLIENT_ORDER_I` |
| `apps/engine/src/services/manualPositionService.ts` | 176 | `private async replaceTakeProfit(position:Position,intent:ManualIntent,quantity:number,price:number,quote:{stepSize:number;tickSize:number}){this.tp.suspend(position.id);try{for(const current of [...this.state.tpOrders.values()].filter(x=>x.positionId===positio` |
| `apps/engine/src/services/manualPositionService.ts` | 177 | `private async clearProtectionForExit(position:Position){this.tp.suspend(position.id);try{for(const current of [...this.state.tpOrders.values()].filter(x=>x.positionId===position.id&&x.status==='WORKING')){const canceled=await this.tp.cancel(current);this.state` |
| `apps/engine/src/services/manualPositionService.ts` | 178 | `async cancelLimits(symbol:string){const adapter=this.exchange as ExchangeTradeAdapter&{cancelSymbolOrders?:(symbol:string,conditional:boolean)=>Promise<any>};this.events.publish('MANUAL_CANCEL_LIMITS_REQUESTED',{symbol,actor:'HUMAN'},symbol);const result=adapt` |
| `apps/engine/src/services/manualPositionService.ts` | 179 | `async cancelConditionals(symbol:string){const adapter=this.exchange as ExchangeTradeAdapter&{cancelSymbolOrders?:(symbol:string,conditional:boolean)=>Promise<unknown>};this.events.publish('MANUAL_CANCEL_CONDITIONALS_REQUESTED',{symbol,actor:'HUMAN'},symbol);co` |
| `apps/engine/src/services/positionReviewRunner.ts` | 19 | `at:number;runId:string / null;ownerVersion:number;triggerKey:string};` |
| `apps/engine/src/services/positionReviewRunner.ts` | 47 | `return{planVersion:plan.planVersion,planRef:plan.planId,ownerVersion:Number(this.ports.exitRuntime.owner({symbol:position.symbol,side:position.side,cycleId,openedAt:position.openedAt})?.ownerVersion??0),` |
| `apps/engine/src/services/positionReviewRunner.ts` | 55 | `/** One bounded pass over AI-managed cycles and review-only HUMAN_MANAGED evidence subjects. */` |
| `apps/engine/src/services/positionReviewRunner.ts` | 66 | `const reviewOnly=owner?.ownerState==='HUMAN_MANAGED';` |
| `apps/engine/src/services/positionReviewRunner.ts` | 89 | `if(reviewOnly)this.ports.events.publish('POSITION_REVIEW_ONLY_AUTHORITY',{cycleId,scope,ownerVersion:ticket.ownerVersion,executionAuthority:false,reason:'HUMAN_MANAGED_REVIEW_EVIDENCE_ONLY'},position.symbol);` |
| `apps/engine/src/services/positionReviewRunner.ts` | 100 | `reason:applied.reason,at:Date.now(),runId:answer.runId,ownerVersion:ticket.ownerVersion,triggerKey:ticket.triggerKey};` |
| `apps/engine/src/services/positionReviewRunner.ts` | 114 | `reason:'REVIEW_CALL_FAILED',at:Date.now(),runId:null,ownerVersion:ticket.ownerVersion,triggerKey:ticket.triggerKey});` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 8 | `* handoff-pending cycles never get a routine call, HUMAN_MANAGED cycles get review-only tickets, and a model answer that` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 14 | `export type ReviewVersions={planVersion:number;planRef:string;ownerVersion:number;positionVersion:number;settingsVersion:number;` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 18 | `ownerVersion:number;reviewOnly:boolean;planRef:string;reservedAt:number;expiresAt:number;reasons:string[]};` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 29 | `return `trg_${hash([input.scope,input.cycleId,v.planVersion,v.planRef,v.ownerVersion,v.positionVersion,v.settingsVersion,v.riskGeneration,` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 44 | `ownerOf:(scope:string,cycleId:string)=>{ownerState:string;ownerVersion:number;deadline:number / null;reviewEligible?:boolean} / null;` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 89 | `const reviewOnly=owner.ownerState==='HUMAN_MANAGED';` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 91 | `if(owner.ownerVersion!==input.versions.ownerVersion)return{granted:false,reason:'OWNER_VERSION_DRIFT'} as const;` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 113 | `scope:input.scope,cycleId:input.cycleId,ownerVersion:input.versions.ownerVersion,reviewOnly,planRef:input.versions.planRef,` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 145 | `if(ticket.reviewOnly?owner.ownerState!=='HUMAN_MANAGED':owner.ownerState!=='AI_ACTIVE')return{usable:false,reason:`OWNER_AUTHORITY_CHANGED:${owner.ownerState}`,archived:true,row:usage.row};` |
| `apps/engine/src/services/positionReviewScheduler.ts` | 146 | `if(owner.ownerVersion!==ticket.ownerVersion)return{usable:false,reason:'OWNER_VERSION_CHANGED_DURING_MODEL_CALL',archived:true,row:usage.row};` |

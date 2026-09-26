import {buildPortfolioRiskSnapshot, canonicalRiskUnderlying, stableRiskHash, type PortfolioAssetFact, type PortfolioCashFlowFact, type PortfolioOwnerState, type PortfolioPendingRiskFact, type PortfolioPositionFact, type PortfolioRiskSnapshot} from './portfolioRiskSnapshot.js';
import {evaluatePortfolioStress, type PortfolioStressResult} from './portfolioStress.js';
import {evaluateHumanCapacity, type HumanCapacityDecision} from './humanCapacityPolicy.js';
import {executionScope} from './executionLifecycle.js';
import {privateAccountFresh} from './privateAccountReadiness.js';
import {collectPortfolioPendingRiskFacts} from './entryRiskOccupancy.js';
import {liquidationBufferFact} from './positionRiskFacts.js';
import {portfolioRiskAuthorityBlockers, portfolioRiskAuthorityReadback, type PortfolioRiskAuthorityFacts} from './portfolioRiskAuthority.js';
import type {RuntimeState} from '../state/runtimeState.js';

export type PortfolioRiskProfileAuthorityContext={facts:PortfolioRiskAuthorityFacts|null;staleObservedContentHash?:string|null;environment:string;accountScope:string;requiredSymbols?:string[]};

const PROFILE_LIMIT_KEYS=['maxCapitalAtRiskUsd','maxStressLossUsd','maxGrossNotionalUsd','maxDirectionNotionalUsd','maxClusterNotionalUsd',
  'maxHumanNotionalUsd','maxDrawdownPct','minMarginBufferPct','minLiquidationBufferPct','maxHumanPositions','maxPendingHandoffs','maxAckAgeMs','snapshotTtlMs'] as const;

/**
 * The profile facts the admission needs before it can issue a risk ticket. Exported because the
 * pre-model readiness gate must answer with exactly these codes: a cockpit that invents its own
 * list of "what is missing" is a second authority over the same settings row.
 *
 * `authority` is the durable dataset the versions in Settings claim to name. The runtime always
 * supplies it, and an unlisted version then produces no blocker at all is precisely the bug that
 * made a typed string look like proof; omitting the argument is only for the pure shape layer.
 */
export function portfolioRiskProfileBlockers(profile:Record<string,unknown>|null|undefined,authority?:PortfolioRiskProfileAuthorityContext):string[]{
  const row=profile??{};
  if(row.configured!==true)return['RISK_PROFILE_UNCONFIGURED'];
  const blockers:string[]=[];
  const missing=PROFILE_LIMIT_KEYS.filter(key=>row[key]==null);
  if(missing.length)blockers.push(`RISK_PROFILE_FIELDS_MISSING:${missing.join(',')}`);
  if(!String(row.marginTierVersion??'').trim()||!finite(row.maintenanceMarginRatePct))blockers.push('MARGIN_TIER_UNPROVEN');
  if(!String(row.correlationVersion??'').trim())blockers.push('CORRELATION_VERSION_UNPROVEN');
  if(!Array.isArray(row.scenarios)||!row.scenarios.length||!String(row.scenarioVersion??'').trim())blockers.push('STRESS_SCENARIO_SET_UNPROVEN');
  if(authority)blockers.push(...portfolioRiskAuthorityBlockers({...authority,profile:row as Record<string,unknown>}));
  return blockers;
}

/** Three states, so a page can never render an unapproved profile as `READY`. */
export function portfolioRiskProfileStatus(profile:Record<string,unknown>|null|undefined,authority?:PortfolioRiskProfileAuthorityContext):'PROFILE_NOT_CONFIGURED'|'PROFILE_FACTS_UNPROVEN'|'READY'{
  if((profile??{}).configured!==true)return 'PROFILE_NOT_CONFIGURED';
  return portfolioRiskProfileBlockers(profile,authority).length?'PROFILE_FACTS_UNPROVEN':'READY';
}

/**
 * J2: the single authoritative portfolio admission for new risk.
 *
 * One object owns the answer: a versioned snapshot of what the account actually holds, the stress
 * evaluation of that snapshot with the candidate added, and the human-capacity evaluation. The
 * snapshot is recomputed inside the reservation transaction, and its content hash is what a claim
 * is bound to, so a second candidate that was pre-checked before the first one reserved is refused
 * because the facts moved - not because a counter happened to be reused. A missing or unverified
 * fact is a refusal; no branch of this code turns absent evidence into a tradable headroom.
 */

export type RiskFactCoverage={assets:'VERIFIED'|'UNVERIFIED';marginTier:'VERIFIED'|'UNPROVEN';cashFlow:'VERIFIED'|'UNPROVIDED';ownership:'VERIFIED'|'PARTIAL';account:'VERIFIED'|'UNPROVEN'};

export type RiskTicket={riskGeneration:number;snapshotHash:string;profileVersion:string;evaluatedAt:number;expiresAt:number;candidateKey:string;coverage:RiskFactCoverage;limits:string[];reasons:string[]};

export type AdmissionCandidate={symbol:string;side:'LONG'|'SHORT';quoteAsset:string;notionalUsd:number;marginUsd:number;leverage:number;markPrice:number;planId:string;intentId?:string|null};

export type AdmissionDecision={allowed:boolean;reason:string;reasons:string[];limits:string[];ticket:RiskTicket|null;
  snapshot:PortfolioRiskSnapshot;stress:PortfolioStressResult;capacity:HumanCapacityDecision;
  firstBinding:AdmissionFirstBinding|null;gates:AdmissionGateFact[]};

export type PortfolioLedgerState={generation:number;contentHash:string|null;snapshotHash:string|null;profileVersion:string|null;evaluatedAt:number;expiresAt:number;peakEquityUsd:number};

/** One committed limit, stated as the numbers the human has to act on: what it allows, what is used, what more fits. */
export type AdmissionGateFact={name:string;reason:string;unit:'NOTIONAL_USD'|'MARGIN_USD'|'LOSS_USD';limitUsd:number;usedUsd:number;
  maxAdditionalUsd:number;maxAdditionalUsdBySide?:{LONG:number;SHORT:number}|null;clusterKey?:string|null};

/** The gate that actually decides this cycle, with its own arithmetic attached. */
export type AdmissionFirstBinding={kind:'EVIDENCE'|'SUMMARY'|'SIZE_INDEPENDENT'|'NOTIONAL'|'OTHER';code:string;gate:string|null;
  limitUsd:number|null;usedUsd:number|null;headroomUsd:number|null;shortfallUsd:number|null;detail:string};

/** What the book, with no candidate in it, can still admit. Derived from the same evaluations `admit` runs. */
export type AdmissionCapacityFacts={evaluatedAt:number;profileVersion:string;riskGeneration:number;complete:boolean;
  gates:AdmissionGateFact[];evidenceBlockers:string[];sizeIndependentRefusals:string[];
  maxNewRiskNotionalUsd:number;maxNewRiskNotionalUsdBySide:{LONG:number;SHORT:number};admitsAnyPositiveNotional:boolean;
  firstBinding:AdmissionFirstBinding;bookGrossNotionalUsd:number;pendingNotionalUsd:number;claimGrossNotionalUsd:number;
  humanHandoffNotionalUsd:number;overdueHandoffs:number;oldestOverdueHours:number|null};

/** One decision pass asks many readers; this bounds how long they may share a computed ceiling. */
const ADMISSION_CAPACITY_MEMO_MS=5_000;

/** The codes that refuse a candidate of any size: a policy or count fact, not a dollar comparison. */
const SIZE_INDEPENDENT_CODES=['HUMAN_ACK_OVERDUE','HUMAN_PENDING_HANDOFF_LIMIT','HUMAN_POTENTIAL_SLOT_LIMIT','HUMAN_CAPACITY_PROFILE_INVALID','HUMAN_CAPACITY_TIME_INVALID',
  'STRESS_LIMIT:MAX_DRAWDOWN','STRESS_LIMIT:MIN_MARGIN_BUFFER','STRESS_LIMIT:MIN_LIQUIDATION_BUFFER'];
/** `complete=false` is a restatement of the concrete per-row blockers above it, never a gate of its own. */
const SUMMARY_CODES=['PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE'];
const NOTIONAL_GATE_REASONS=['STRESS_LIMIT:MAX_GROSS_NOTIONAL','STRESS_LIMIT:MAX_DIRECTION_NOTIONAL','STRESS_LIMIT:MAX_CLUSTER_NOTIONAL','HUMAN_POTENTIAL_NOTIONAL_LIMIT',
  'STRESS_LIMIT:MAX_CAPITAL_AT_RISK','STRESS_LIMIT:MIN_MARGIN_BUFFER','STRESS_LIMIT:MIN_LIQUIDATION_BUFFER','STRESS_LIMIT:MAX_DRAWDOWN','STRESS_LIMIT:MAX_STRESS_LOSS'];
/**
 * Two ceilings breached by the same dollar amount are one fact about one book, not a coin toss. The order
 * here is which question an operator can answer first: the whole book, then the human-managed share of it,
 * then the correlation bucket, then one direction, then margin at risk.
 */
const NOTIONAL_PRECEDENCE=['STRESS_LIMIT:MAX_GROSS_NOTIONAL','HUMAN_POTENTIAL_NOTIONAL_LIMIT','STRESS_LIMIT:MAX_CLUSTER_NOTIONAL',
  'STRESS_LIMIT:MAX_CAPITAL_AT_RISK','STRESS_LIMIT:MAX_DIRECTION_NOTIONAL','STRESS_LIMIT:MIN_MARGIN_BUFFER','STRESS_LIMIT:MIN_LIQUIDATION_BUFFER',
  'STRESS_LIMIT:MAX_DRAWDOWN','STRESS_LIMIT:MAX_STRESS_LOSS'];

/**
 * The reported first cause is the gate whose own arithmetic denied the candidate, not the alphabetically
 * first label in a sorted set. Precedence is fixed and documented: an unproven fact outranks any policy
 * reading of it; a policy that denies at every size outranks a dollar ceiling that a smaller order could
 * clear; and among dollar ceilings the tightest one binds. Every code stays in the returned list - the
 * ordering changes which one is named, never what was seen.
 */
export function rankAdmissionReasons(input:{reasons:string[];gates:AdmissionGateFact[];candidateNotionalUsd?:number}):{ordered:string[];firstBinding:AdmissionFirstBinding|null}{
  const seen=new Set(input.reasons),candidate=input.candidateNotionalUsd??0;
  const evidence=[...seen].filter(code=>!SIZE_INDEPENDENT_CODES.includes(code)&&!SUMMARY_CODES.includes(code)&&!NOTIONAL_GATE_REASONS.includes(code)).sort();
  const summary=[...seen].filter(code=>SUMMARY_CODES.includes(code));
  const sizeIndependent=SIZE_INDEPENDENT_CODES.filter(code=>seen.has(code));
  const byName=new Map(input.gates.map(gate=>[gate.reason,gate]));
  const notional=[...seen].filter(code=>NOTIONAL_GATE_REASONS.includes(code)).sort((a,b)=>{
    const left=byName.get(a),right=byName.get(b);
    // A ceiling the ledger could not attach numbers to is reported after the ones it could.
    if(!left)return right?1:0;
    if(!right)return -1;
    return left.maxAdditionalUsd-right.maxAdditionalUsd||NOTIONAL_PRECEDENCE.indexOf(a)-NOTIONAL_PRECEDENCE.indexOf(b);
  });
  const known=new Set([...evidence,...summary,...sizeIndependent,...notional]);
  const other=[...seen].filter(code=>!known.has(code)).sort();
  const ordered=[...evidence,...summary,...sizeIndependent,...notional,...other];
  const first=ordered[0];
  if(!first)return{ordered:[],firstBinding:null};
  const kind:AdmissionFirstBinding['kind']=evidence.includes(first)?'EVIDENCE':summary.includes(first)?'SUMMARY':sizeIndependent.includes(first)?'SIZE_INDEPENDENT':notional.includes(first)?'NOTIONAL':'OTHER';
  const gate=byName.get(first)??null;
  const shortfallUsd=gate?Math.max(0,gate.usedUsd+candidate-gate.limitUsd):null;
  const detail=gate
    ? `${gate.name} 上限 ${gate.limitUsd.toFixed(2)} ${gate.unit}，已用 ${gate.usedUsd.toFixed(2)}，可新增 ${gate.maxAdditionalUsd.toFixed(2)}${shortfallUsd&&shortfallUsd>0?`，缺口 ${shortfallUsd.toFixed(2)}`:''}`
    : `${first}（与名义规模无关的拒因，或本层无数值可归属的账本事实）`;
  return{ordered,firstBinding:{kind,code:first,gate:gate?.name??null,limitUsd:gate?.limitUsd??null,usedUsd:gate?.usedUsd??null,
    headroomUsd:gate?.maxAdditionalUsd??null,shortfallUsd,detail}};
}

/** Which correlation bucket one symbol's new risk lands in — the committed map's own answer, never a guess. */
export function correlationClusterOf(symbol:string,correlation:{clusters?:Record<string,string>|null}){
  const assigned=String(correlation?.clusters?.[canonicalRiskUnderlying(String(symbol??'').trim())]??'').trim();
  return assigned||'UNMAPPED_CORRELATED';
}

/** An unprovable number is a refusal, never a zero: every use below distinguishes "absent" from "none". */
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
const candidateKeyOf=(candidate:AdmissionCandidate)=>JSON.stringify([String(candidate.planId),String(candidate.symbol).toUpperCase(),candidate.side,String(candidate.quoteAsset).toUpperCase(),Number(candidate.notionalUsd),Number(candidate.marginUsd)]);
/**
 * The identity of a snapshot's *inputs*. Derived from the facts rather than from the built snapshot
 * so that a change in any single input - one more transfer, one different owner - moves it, while
 * the clock and the generation itself never do.
 */
const contentHashOf=(inputs:{now:number;peakEquityUsd:number;assets:PortfolioAssetFact[];cashFlows:PortfolioCashFlowFact[];positions:PortfolioPositionFact[];pending:PortfolioPendingRiskFact[]})=>
  stableRiskHash({peakEquityUsd:inputs.peakEquityUsd,assets:inputs.assets,cashFlows:inputs.cashFlows,positions:inputs.positions,pending:inputs.pending});

export class PortfolioRiskAdmission {
  private ledger:PortfolioLedgerState={generation:0,contentHash:null,snapshotHash:null,profileVersion:null,evaluatedAt:0,expiresAt:0,peakEquityUsd:0};
  private lastSnapshot:PortfolioRiskSnapshot|null=null;
  private lastDeny:{at:number;candidateKey:string;reasons:string[];limits:string[]}|null=null;
  private capacityMemo=new Map<string,AdmissionCapacityFacts>();
  private capacityMemoBucket=Math.floor(Date.now()/ADMISSION_CAPACITY_MEMO_MS);

  constructor(private readonly ports:{
    state:RuntimeState;
    identity:()=>{environment:string;account:string};
    /** The durable owner of one cycle. A journal miss is UNKNOWN, never AI_ACTIVE. */
    ownerOf:(scope:string,cycleId:string)=>{ownerState:PortfolioOwnerState;handoffAt:number|null;acknowledgedAt:number|null}|null;
    /** Verified external transfer facts (deposit/withdraw). Empty means "not provided", not zero. */
    cashFlows:()=>PortfolioCashFlowFact[];
    /** Symbols the pipeline may want next. Informational in the readback; never an authority. */
    coverageWatch?:()=>string[];
    profile:()=>Record<string,any>;
    /**
     * The durable dataset those versions claim to name. The runtime always wires this; a profile whose
     * version has no committed dataset behind it is never proven, however well the string looks.
     */
    authority?:()=>{facts:PortfolioRiskAuthorityFacts|null;staleObservedContentHash?:string|null};
  }){}

  private authorityContext(requiredSymbols:string[]=[]){
    if(!this.ports.authority)return undefined;
    const identity=this.ports.identity(),read=this.ports.authority();
    return{facts:read?.facts??null,staleObservedContentHash:read?.staleObservedContentHash??null,
      environment:identity.environment,accountScope:identity.account,requiredSymbols:requiredSymbols.filter(Boolean)};
  }

  serialize():PortfolioLedgerState{return {...this.ledger};}
  restore(value:Partial<PortfolioLedgerState>|null|undefined){
    const row=value??{};
    // A restart keeps the ordering of generations but never a live authority: the snapshot has to
    // be recomputed from fresh facts before any claim can be bound to it.
    this.ledger={generation:Number.isSafeInteger(row.generation)&&Number(row.generation)>0?Number(row.generation):0,
      contentHash:typeof row.contentHash==='string'?row.contentHash:null,snapshotHash:null,profileVersion:null,evaluatedAt:0,expiresAt:0,
      peakEquityUsd:finite(row.peakEquityUsd)&&Number(row.peakEquityUsd)>0?Number(row.peakEquityUsd):0};
    this.lastSnapshot=null;
  }
  state(){return {...this.ledger};}
  snapshot(){return this.lastSnapshot;}
  denies(){return this.lastDeny;}

  private profileSettings(requiredSymbols:string[]=[]){
    const row=this.ports.profile()??{};
    const numbers=['maxCapitalAtRiskUsd','maxStressLossUsd','maxGrossNotionalUsd','maxDirectionNotionalUsd','maxClusterNotionalUsd','maxHumanNotionalUsd','maxDrawdownPct','minMarginBufferPct','minLiquidationBufferPct','maxHumanPositions','maxPendingHandoffs','maxAckAgeMs','snapshotTtlMs'];
    const authority=this.authorityContext(requiredSymbols);
    return{row,missing:numbers.filter(key=>row[key]==null),blockers:portfolioRiskProfileBlockers(row as Record<string,unknown>,authority),profileVersion:stableRiskHash(row),
      provenance:{source:'SETTINGS',settingsVersion:(this.ports.state.settings as any).settingsVersion??null,
        path:'riskGovernance.portfolioRisk',configured:row.configured===true,contentHash:stableRiskHash(row)}};
  }

  profileReadback(requiredSymbols:string[]=[]){
    const p=this.profileSettings(requiredSymbols),authority=this.authorityContext(requiredSymbols);
    const status=portfolioRiskProfileStatus(p.row as Record<string,unknown>,authority);
    // Symbols the pipeline might want next, reported as information only: a candidate outside the
    // committed coverage is refused by admission, by name, and must never be a global veto that
    // re-decides whether the profile is proven every tick.
    const watch=[...new Set((this.ports.coverageWatch?.()??[]).map(symbol=>String(symbol).trim().toUpperCase()).filter(Boolean))].sort();
    const covered=authority?.facts?.margin.coverageSymbols??[];
    const uncovered=authority?watch.filter(symbol=>!covered.includes(symbol)):[];
    return{...p.provenance,status,version:p.profileVersion,values:p.row,missingFields:p.missing,blockers:p.blockers,
      // The cockpit may only render this projection; a page that hashed a dataset itself would be a
      // second authority over the same fact.
      // `authorityStatus` says whether the committed dataset matches the approved profile. It is not a
      // claim that every symbol the pipeline might route is inside that dataset, so the lag is reported
      // beside it instead of being hidden behind a MATCHED verdict.
      authority:authority?{...portfolioRiskAuthorityReadback({...authority,profile:p.row as Record<string,unknown>,operatorStatus:status}),uncoveredCoverageCandidates:uncovered,
        coverageLag:uncovered.length?{uncoveredCandidates:uncovered,marginTierVersion:authority.facts?.margin.version??null,committedAt:authority.facts?.committedAt??null,
          action:'re-collect and commit the margin-tier authority for these symbols; until then each is refused by name before a model call'}:null}:null};
  }

  /** Position, order, reservation, ownership and account facts, mapped into the snapshot inputs. */
  private inputs(now:number,plannedPositions:PortfolioPositionFact[]){
    const state=this.ports.state,identity=this.ports.identity(),settings=state.settings as any;
    const riskSettings=settings?.riskGovernance??{};
    const profile=this.profileSettings([...new Set(plannedPositions.map(row=>String(row.symbol??'').toUpperCase()).filter(Boolean))]);
    const blockers:string[]=[...profile.blockers];

    const account:any=state.account??{};
    const accountVerified=account.status==='READY'&&privateAccountFresh(account as never,now);
    if(!accountVerified)blockers.push('PRIVATE_ACCOUNT_NOT_FRESH');
    const valuationAt=Number(account.enrichment?.valuationAsOf??0);
    const freshFx=valuationAt>0&&valuationAt<=now&&now-valuationAt<=120_000;
    const assets:PortfolioAssetFact[]=(Array.isArray(account.assets)?account.assets:[]).map((row:any)=>{
      const asset=String(row?.asset??'').toUpperCase(),stable=['USDT','USDC','BUSD','FDUSD'].includes(asset);
      const wallet=row?.walletBalance;
      // Stable quote convention is explicit; other assets require a fresh observed valuation.
      const rate=stable?1:freshFx&&finite(wallet)&&wallet>0&&finite(row?.usdValue)&&row.usdValue>0?row.usdValue/wallet:null;
      const available=finite(row?.availableBalance)&&finite(rate)?row.availableBalance*rate:null;
      return{asset,equityUsd:finite(row?.usdValue)?row.usdValue:null,availableMarginUsd:available,
        factStatus:finite(row?.usdValue)&&finite(available)&&accountVerified?'VERIFIED' as const:'UNKNOWN' as const};
    });
    if(!assets.length)blockers.push('ACCOUNT_ASSETS_UNPROVEN');

    const cashFlows=this.ports.cashFlows()??[];
    if(!cashFlows.length)blockers.push('CASH_FLOW_COVERAGE_UNPROVIDED');

    const ownershipKnown={count:0,total:0};
    const positions:PortfolioPositionFact[]=[...state.positions.values()].map((position:any)=>{
      const scope=executionScope(identity.environment,identity.account,position.symbol,position.side);
      const cycleId=String(position.cycleId??'').trim();
      const durable=this.ports.ownerOf(scope,cycleId);
      ownershipKnown.total++;if(durable)ownershipKnown.count++;
      const markPrice=finite(position.markPrice)?Number(position.markPrice):Number.NaN;
      // The exchange's own liquidation price, read directionally: never abs(), never an estimate from
      // leverage or the bracket table, and only a reported zero on a long is a proven zero-price
      // boundary (100 %, deliberately not Infinity).
      const liquidation=liquidationBufferFact({symbol:String(position.symbol??''),side:position.side==='SHORT'?'SHORT':'LONG',markPrice,liquidationPrice:finite(position.liquidationPrice)?Number(position.liquidationPrice):null});
      if(liquidation.blocker)blockers.push(liquidation.blocker);
      const buffer=liquidation.bufferPct;
      const marginAsset=String(position.marginAsset??'').trim().toUpperCase();
      if(!marginAsset)blockers.push('POSITION_MARGIN_ASSET_UNPROVEN');
      // C4: a position fact is only VERIFIED on the strength of its own numbers. A READY authority
      // upgrades nothing here, and a row the exchange only confirmed exists (V2 existence fallback)
      // can never carry a proven margin.
      const maintenance=finite(position.maintenanceMarginUsd)&&Number(position.maintenanceMarginUsd)>=0?Number(position.maintenanceMarginUsd):null;
      const exchangeRiskProven=position.positionRiskSource!=='V2_EXISTENCE_ONLY';
      const quantity=finite(position.quantity)?Math.abs(Number(position.quantity)):Number.NaN;
      const verifiedFact=durable&&Boolean(marginAsset)&&quantity>0&&finite(position.markPrice)&&position.markPrice>0&&exchangeRiskProven&&maintenance!=null&&buffer!=null;
      return{scope,cycleId:cycleId||'UNKNOWN_CYCLE',symbol:position.symbol,side:position.side==='SHORT'?'SHORT':'LONG',
        quantity,markPrice,leverage:Number(position.leverage??0),
        quoteAsset:marginAsset,marginAsset,
        ownerState:durable?durable.ownerState:'UNKNOWN' as unknown as PortfolioOwnerState,
        factStatus:verifiedFact?'VERIFIED' as const:'UNKNOWN' as const,
        maintenanceMarginUsd:maintenance,
        liquidationBufferPct:buffer,liquidationPriceFact:liquidation.fact,handoffAt:durable?.handoffAt??null,acknowledgedAt:durable?.acknowledgedAt??null} as PortfolioPositionFact;
    });
    // A cycle the durable journal never saw is UNKNOWN risk, and UNKNOWN keeps occupying capacity.
    const allPositions=[...positions,...plannedPositions];
    const unknownOwners=positions.filter(row=>!String(row.ownerState).match(/AI_ACTIVE|HANDOFF_PENDING|HUMAN_MANAGED|CLOSED/));
    // Which entry lineage still occupies risk is answered in exactly one place: this project the
    // occupancy authority produces. A second status list here would let the risk account disagree
    // with slots, capacity and the remote-release evidence about the same durable order.
    const builtPending:PortfolioPendingRiskFact[]=collectPortfolioPendingRiskFacts(state,{now});
    const equityUsd=finite(account.equityUsd)?Number(account.equityUsd):Number.NaN;
    const baseline:any=account.riskBaseline??{};
    const observedPeak=Math.max(this.ledger.peakEquityUsd,finite(baseline.startingEquityUsd)?Number(baseline.startingEquityUsd):0,finite(equityUsd)?equityUsd:0);
    if(!finite(observedPeak)||observedPeak<=0)blockers.push('PEAK_EQUITY_UNPROVEN');
    const coverage:RiskFactCoverage={assets:assets.length&&assets.every(row=>row.factStatus==='VERIFIED')?'VERIFIED':'UNVERIFIED',
      marginTier:String(profile.row.marginTierVersion??'').trim()&&finite(profile.row.maintenanceMarginRatePct)&&positions.every(row=>row.maintenanceMarginUsd!=null&&row.liquidationBufferPct!=null)?'VERIFIED':'UNPROVEN',
      cashFlow:cashFlows.length&&cashFlows.every(row=>row.factStatus==='VERIFIED')?'VERIFIED':'UNPROVIDED',
      ownership:ownershipKnown.total&&ownershipKnown.count===ownershipKnown.total&&unknownOwners.length===0?'VERIFIED':'PARTIAL',
      account:accountVerified?'VERIFIED':'UNPROVEN'};
    return{inputs:{riskGeneration:this.ledger.generation+1,now,peakEquityUsd:finite(observedPeak)?observedPeak:0,assets,cashFlows,positions:allPositions,pending:builtPending},
      // The version identity covers the facts that already exist. Merely evaluating another
      // candidate must not invalidate a ticket nobody has used yet.
      live:{assets,cashFlows,positions,pending:builtPending},
      blockers,profile,coverage,unknownOwners};
  }

  /** Rebuild the snapshot and advance the durable generation only when the facts moved. */
  refresh(now:number,candidate?:AdmissionCandidate){
    const rawRate=(this.ports.profile()??{}).maintenanceMarginRatePct,rate=finite(rawRate)?rawRate:Number.NaN;
    const identity=this.ports.identity();
    const built=this.inputs(now,candidate?[this.plannedOf(candidate,identity,Number.isFinite(rate)?rate:Number.NaN)]:[]);
    const content=contentHashOf({now,peakEquityUsd:built.inputs.peakEquityUsd,...built.live});
    const generation=content===this.ledger.contentHash&&this.ledger.generation>0?this.ledger.generation:this.ledger.generation+1;
    const snapshot=buildPortfolioRiskSnapshot({...built.inputs,riskGeneration:generation});
    this.ledger={generation,contentHash:content,snapshotHash:snapshot.snapshotHash,profileVersion:built.profile.profileVersion,
      evaluatedAt:now,expiresAt:snapshot.complete?this.authorityExpiry(now,built.profile.row):0,
      peakEquityUsd:Math.max(this.ledger.peakEquityUsd,Number(snapshot.peakEquityUsd)||0)};
    this.lastSnapshot=snapshot;
    return{snapshot,blockers:built.blockers,profile:built.profile,coverage:built.coverage};
  }

  /**
   * The candidate enters the snapshot as a planned position, not as a loose pending number: that is
   * what forces its own maintenance margin and liquidation distance to be proven before it can be
   * admitted. An unproven leverage or bracket leaves the row unverifiable, which refuses admission.
   */
  private plannedOf(candidate:AdmissionCandidate,identity:{environment:string;account:string},maintenanceMarginRatePct:number):PortfolioPositionFact{
    const scope=executionScope(identity.environment,identity.account,candidate.symbol,candidate.side);
    const leverage=Number(candidate.leverage),markPrice=Number(candidate.markPrice);
    const buffer=Number.isSafeInteger(leverage)&&leverage>0&&finite(maintenanceMarginRatePct)?Math.max(0,1/leverage-maintenanceMarginRatePct):null;
    return{scope,cycleId:`plan:${candidate.planId}`,symbol:candidate.symbol,side:candidate.side,
      quantity:finite(markPrice)&&markPrice>0?candidate.notionalUsd/markPrice:Number.NaN,markPrice,leverage,
      quoteAsset:String(candidate.quoteAsset).toUpperCase(),marginAsset:String(candidate.quoteAsset).toUpperCase(),
      ownerState:'AI_ACTIVE',
      factStatus:buffer!=null&&finite(candidate.notionalUsd)&&candidate.notionalUsd>0&&finite(markPrice)&&markPrice>0&&Number.isSafeInteger(leverage)&&leverage>0?'VERIFIED':'UNKNOWN',
      maintenanceMarginRatePct,maintenanceMarginUsd:buffer!=null?candidate.notionalUsd*maintenanceMarginRatePct:null,
      liquidationBufferPct:buffer,liquidationPriceFact:buffer==null?'UNPROVEN':'PROJECTED_FROM_LEVERAGE',handoffAt:null,acknowledgedAt:null} as PortfolioPositionFact;
  }

  /** The authority window is the shortest of every input's own freshness. */
  private authorityExpiry(now:number,profile:Record<string,any>){
    const state=this.ports.state as any,capital=state.runtimeControl?.capital??{};
    const ttl=Math.max(5_000,Math.min(120_000,Number(profile.snapshotTtlMs??20_000)));
    const bounds=[now+ttl,Number(capital.nextRecheckAt??Number.POSITIVE_INFINITY),Number(state.account?.asOf??0)+90_000];
    return Math.floor(Math.min(...bounds));
  }

  /**
   * The account as it stands, with no candidate in it. S06 sizes each option against these numbers,
   * so a plan's risk block describes the book it was computed on rather than a fresh evaluation.
   */
  preTradeFacts(now=Date.now()){
    const built=this.inputs(now,[]);
    const snapshot=buildPortfolioRiskSnapshot({...built.inputs,riskGeneration:this.ledger.generation||1});
    const cluster=Math.max(0,...Object.values(snapshot.exposures.reduce<Record<string,number>>((acc,row)=>{
      const key=String((built.profile.row.clusters??{})[row.underlying]??(row.underlying||'UNMAPPED'));acc[key]=(acc[key]??0)+row.notionalUsd;return acc;},{})));
    const profile=built.profile.row;
    return{snapshotHash:snapshot.snapshotHash,riskGeneration:snapshot.riskGeneration,profileVersion:built.profile.profileVersion,
      capitalAtRiskUsd:snapshot.capitalAtRiskUsd,grossNotionalUsd:snapshot.grossNotionalUsd,longNotionalUsd:snapshot.longNotionalUsd,shortNotionalUsd:snapshot.shortNotionalUsd,
      clusterNotionalUsd:cluster,pendingNotionalUsd:snapshot.pendingNotionalUsd,drawdownPct:snapshot.drawdownPct,
      humanSlots:snapshot.exposures.filter(row=>row.kind==='POSITION'&&row.notionalUsd>0).length,
      complete:snapshot.complete&&built.blockers.length===0,blockers:[...new Set([...built.blockers,...snapshot.blockers])].sort(),
      maxGrossNotionalUsd:Number(profile.maxGrossNotionalUsd??0),maxDirectionNotionalUsd:Number(profile.maxDirectionNotionalUsd??0),
      maxClusterNotionalUsd:Number(profile.maxClusterNotionalUsd??0),maxCapitalAtRiskUsd:Number(profile.maxCapitalAtRiskUsd??0),
      maxHumanPositions:Number(profile.maxHumanPositions??0),createdAt:snapshot.createdAt};
  }

  /** The one composition of denials every surface must read: inputs, snapshot, stress limits, human capacity. */
  private reasonsOf(built:{blockers:string[]},snapshot:PortfolioRiskSnapshot,stress:PortfolioStressResult,capacity:HumanCapacityDecision){
    return[...new Set([...built.blockers,...snapshot.blockers,...stress.blockers,
      ...stress.limitingConstraints.map(limit=>`STRESS_LIMIT:${limit}`),...capacity.blockers])].sort();
  }

  /**
   * Each committed ceiling with the number that binds it. A candidate's own contribution is subtracted so
   * `usedUsd` is always the book and the shortfall is always what a human would have to free; a negative
   * `maxAdditionalUsd` is reported as zero room, never as room.
   */
  private gateFacts(snapshot:PortfolioRiskSnapshot,stress:PortfolioStressResult,capacity:HumanCapacityDecision,profile:Record<string,any>,
    options:{candidateNotionalUsd?:number;candidateMarginUsd?:number;candidateSide?:'LONG'|'SHORT'|null;clusterKey?:string|null}={}){
    const amount=(value:unknown)=>finite(value)?Number(value):0;
    const candidate=options.candidateNotionalUsd??0,candidateMargin=options.candidateMarginUsd??0;
    const gross=amount(snapshot.grossNotionalUsd)-candidate;
    const long=amount(snapshot.longNotionalUsd)-(options.candidateSide==='LONG'?candidate:0);
    const short=amount(snapshot.shortNotionalUsd)-(options.candidateSide==='SHORT'?candidate:0);
    const clusters=stress.clusterNotional??{},bucket=options.clusterKey??(Object.entries(clusters).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0]??null);
    const clusterUsed=amount(bucket==null?0:Number(clusters[bucket]??0))-candidate;
    const humanUsed=amount(capacity.potentialHandoffNotionalUsd)-candidate;
    const capitalUsed=amount(snapshot.capitalAtRiskUsd)-candidateMargin;
    const gate=(name:string,reason:string,unit:AdmissionGateFact['unit'],limitUsd:number,usedUsd:number,extra:Partial<AdmissionGateFact>={})=>
      ({name,reason,unit,limitUsd,usedUsd,maxAdditionalUsd:Math.max(0,limitUsd-usedUsd),...extra});
    const directionLimit=amount(profile.maxDirectionNotionalUsd);
    return[
      gate('MAX_GROSS_NOTIONAL','STRESS_LIMIT:MAX_GROSS_NOTIONAL','NOTIONAL_USD',amount(profile.maxGrossNotionalUsd),gross),
      gate('MAX_DIRECTION_NOTIONAL','STRESS_LIMIT:MAX_DIRECTION_NOTIONAL','NOTIONAL_USD',directionLimit,Math.max(long,short),
        {maxAdditionalUsdBySide:{LONG:Math.max(0,directionLimit-long),SHORT:Math.max(0,directionLimit-short)}}),
      gate('MAX_CLUSTER_NOTIONAL','STRESS_LIMIT:MAX_CLUSTER_NOTIONAL','NOTIONAL_USD',amount(profile.maxClusterNotionalUsd),clusterUsed,{clusterKey:bucket}),
      gate('MAX_CAPITAL_AT_RISK','STRESS_LIMIT:MAX_CAPITAL_AT_RISK','MARGIN_USD',amount(profile.maxCapitalAtRiskUsd),capitalUsed),
      // Stress loss is measured in loss dollars, not notional: adding risk can only make it worse, so a
      // book that already breaches it admits nothing — but it is never converted into a fake notional room.
      gate('MAX_STRESS_LOSS','STRESS_LIMIT:MAX_STRESS_LOSS','LOSS_USD',amount(profile.maxStressLossUsd),amount(stress.maxStressLossUsd)),
      gate('HUMAN_POTENTIAL_NOTIONAL','HUMAN_POTENTIAL_NOTIONAL_LIMIT','NOTIONAL_USD',amount(profile.maxHumanNotionalUsd),humanUsed),
    ];
  }

  private stressProfileOf(profile:Record<string,any>){
    return{maxCapitalAtRiskUsd:profile.maxCapitalAtRiskUsd,maxDrawdownPct:profile.maxDrawdownPct,maxStressLossUsd:profile.maxStressLossUsd,
      maxGrossNotionalUsd:profile.maxGrossNotionalUsd,maxDirectionNotionalUsd:profile.maxDirectionNotionalUsd,maxClusterNotionalUsd:profile.maxClusterNotionalUsd,
      minMarginBufferPct:profile.minMarginBufferPct,minLiquidationBufferPct:profile.minLiquidationBufferPct};
  }

  private humanProfileOf(profile:Record<string,any>){
    return{maxHumanPositions:profile.maxHumanPositions,maxHumanNotionalUsd:profile.maxHumanNotionalUsd,
      maxPendingHandoffs:profile.maxPendingHandoffs,maxAckAgeMs:profile.maxAckAgeMs};
  }

  /**
   * What this book could still admit with no candidate in it. `admit` decides one submission; every surface
   * that decides whether to *ask* — routing, the pre-AI envelope, the cockpit's capacity view — reads its
   * ceilings here, so a page can never publish executable room the gate would refuse. The symbol is named
   * because the cluster ceiling is that symbol's own correlation bucket, not the book's widest one.
   *
   * A five-second memo serves the many readers of one decision pass; the claim itself never reads it,
   * because `admit` recomputes from live facts. A number this stale can therefore only ever delay a
   * dispatch, never authorise one.
   */
  capacityFacts(now=Date.now(),symbol:string|null=null):AdmissionCapacityFacts{
    const bucket=Math.floor(now/ADMISSION_CAPACITY_MEMO_MS);
    if(bucket!==this.capacityMemoBucket){this.capacityMemoBucket=bucket;this.capacityMemo.clear();}
    const memoKey=String(symbol??'').trim().toUpperCase();
    const cached=this.capacityMemo.get(memoKey);
    if(cached)return cached;
    const facts=this.computeCapacityFacts(now,symbol);
    if(this.capacityMemo.size>256)this.capacityMemo.clear();
    this.capacityMemo.set(memoKey,facts);
    return facts;
  }

  private computeCapacityFacts(now:number,symbol:string|null):AdmissionCapacityFacts{
    const built=this.inputs(now,[]);
    const snapshot=buildPortfolioRiskSnapshot({...built.inputs,riskGeneration:this.ledger.generation||1});
    const profile=built.profile.row;
    const correlation={version:String(profile.correlationVersion??''),clusters:profile.clusters??{}};
    const stress=evaluatePortfolioStress({snapshot,profile:this.stressProfileOf(profile) as any,correlation,
      scenarios:Array.isArray(profile.scenarios)?profile.scenarios:[]});
    const capacity=evaluateHumanCapacity({snapshot,profile:this.humanProfileOf(profile) as any,now});
    const reasons=this.reasonsOf(built,snapshot,stress,capacity);
    const clusterKey=symbol?correlationClusterOf(String(symbol),correlation):null;
    const gates=this.gateFacts(snapshot,stress,capacity,profile,{clusterKey});
    const ranked=rankAdmissionReasons({reasons,gates});
    const maxAckAgeMs=finite(profile.maxAckAgeMs)?Number(profile.maxAckAgeMs):0;
    const overdue=snapshot.exposures.filter(row=>row.kind==='POSITION'&&row.ownerState==='HANDOFF_PENDING'&&row.acknowledgedAt==null
      &&finite(row.handoffAt)&&now-Number(row.handoffAt)>maxAckAgeMs);
    // The size-independent denials get their own measurements too: "an ack is late" is not actionable,
    // "22 handoffs are past the 24h limit, the oldest by 175h" is.
    const oldestOverdueHours=overdue.length?Math.max(...overdue.map(row=>now-Number(row.handoffAt)))/3_600_000:null;
    const binding=ranked.firstBinding;
    if(binding&&binding.kind==='SIZE_INDEPENDENT'&&binding.code==='HUMAN_ACK_OVERDUE'&&overdue.length)
      binding.detail=`HUMAN_ACK_OVERDUE：${overdue.length} 行人工交接未确认，超过上限 ${Math.round(maxAckAgeMs/3_600_000)/10} 小时，最旧 ${oldestOverdueHours?.toFixed(1)} 小时 —— 任意名义均拒，只能由人工确认`;
    // A missing fact or a policy that denies at every size leaves no room for any candidate; a dollar
    // ceiling leaves exactly its own headroom, and only for the side that ceiling is measured on.
    // Direction is excluded from the any-size test because one saturated side never denies the other.
    const deniesAtAnySize=reasons.some(code=>SIZE_INDEPENDENT_CODES.includes(code))
      ||reasons.some(code=>!SIZE_INDEPENDENT_CODES.includes(code)&&!NOTIONAL_GATE_REASONS.includes(code)&&!SUMMARY_CODES.includes(code))
      ||gates.some(gate=>gate.name!=='MAX_DIRECTION_NOTIONAL'&&gate.maxAdditionalUsd<=0);
    const ceilingFor=(side:'LONG'|'SHORT')=>{
      if(deniesAtAnySize)return 0;
      const notional=gates.filter(gate=>gate.unit==='NOTIONAL_USD'&&gate.name!=='MAX_DIRECTION_NOTIONAL').map(gate=>gate.maxAdditionalUsd);
      const direction=gates.find(gate=>gate.name==='MAX_DIRECTION_NOTIONAL')?.maxAdditionalUsdBySide?.[side]??0;
      return Math.max(0,Math.min(direction,...notional));
    };
    const maxNewRiskNotionalUsdBySide={LONG:ceilingFor('LONG'),SHORT:ceilingFor('SHORT')};
    return{evaluatedAt:now,profileVersion:built.profile.profileVersion,riskGeneration:snapshot.riskGeneration,complete:snapshot.complete&&built.blockers.length===0,
      gates,evidenceBlockers:reasons.filter(code=>!SIZE_INDEPENDENT_CODES.includes(code)&&!NOTIONAL_GATE_REASONS.includes(code)&&!SUMMARY_CODES.includes(code)),
      sizeIndependentRefusals:reasons.filter(code=>SIZE_INDEPENDENT_CODES.includes(code)),
      maxNewRiskNotionalUsd:Math.max(maxNewRiskNotionalUsdBySide.LONG,maxNewRiskNotionalUsdBySide.SHORT),maxNewRiskNotionalUsdBySide,
      admitsAnyPositiveNotional:maxNewRiskNotionalUsdBySide.LONG>0||maxNewRiskNotionalUsdBySide.SHORT>0,
      firstBinding:ranked.firstBinding??{kind:'OTHER',code:'NONE',gate:null,limitUsd:null,usedUsd:null,headroomUsd:null,shortfallUsd:null,detail:'当前无候选时组合准入没有拒因'},
      bookGrossNotionalUsd:snapshot.exposures.filter(row=>row.kind==='POSITION').reduce((sum,row)=>sum+row.notionalUsd,0),
      pendingNotionalUsd:snapshot.pendingNotionalUsd,claimGrossNotionalUsd:snapshot.grossNotionalUsd,
      humanHandoffNotionalUsd:capacity.potentialHandoffNotionalUsd,overdueHandoffs:overdue.length,oldestOverdueHours};
  }

  /** Observe the existing book without inventing a proposed trade or a risk ticket. */
  observe(now=Date.now()){
    const built=this.refresh(now),p=built.profile.row,snapshot=built.snapshot;
    const stress=evaluatePortfolioStress({snapshot,profile:p as any,correlation:{version:String(p.correlationVersion??''),clusters:p.clusters??{}},scenarios:p.scenarios??[]});
    const capacity=evaluateHumanCapacity({snapshot,profile:p as any,now});
    const reasons=this.reasonsOf(built,snapshot,stress,capacity);
    return{allowed:reasons.length===0,reasons,snapshotHash:snapshot.snapshotHash,riskGeneration:snapshot.riskGeneration,
      profileVersion:built.profile.profileVersion,provenance:built.profile.provenance,coverage:built.coverage,scope:'CURRENT_BOOK',ticket:null};
  }

  /** Read-only pre-check. It locks nothing; the claim only happens through the gate. */
  admit(candidate:AdmissionCandidate,now=Date.now()):AdmissionDecision{
    const invalid=this.emptySnapshot(now);
    if(!candidate||!String(candidate.symbol??'').trim()||!['LONG','SHORT'].includes(candidate.side)||!String(candidate.quoteAsset??'').trim()||
      !finite(candidate.notionalUsd)||candidate.notionalUsd<=0||!finite(candidate.marginUsd)||candidate.marginUsd<=0||!String(candidate.planId??'').trim())
      return{allowed:false,reason:'ADMISSION_CANDIDATE_INVALID',reasons:['ADMISSION_CANDIDATE_INVALID'],limits:[],ticket:null,
        snapshot:invalid,stress:this.emptyStress(invalid),capacity:this.emptyCapacity(invalid),firstBinding:null,gates:[]};
    const built=this.refresh(now,candidate);
    const {snapshot,coverage}=built;
    const profile=built.profile.row;
    const correlation={version:String(profile.correlationVersion??''),clusters:profile.clusters??{}};
    const stress=evaluatePortfolioStress({snapshot,profile:this.stressProfileOf(profile) as any,correlation,
      scenarios:Array.isArray(profile.scenarios)?profile.scenarios:[]});
    const capacity=evaluateHumanCapacity({snapshot,profile:this.humanProfileOf(profile) as any,now,candidateNotionalUsd:0,candidateAlreadyCounted:true});
    const reasons=this.reasonsOf(built,snapshot,stress,capacity);
    // The candidate is inside this snapshot, so its own numbers are subtracted to describe the book it
    // arrived at; that is what lets the same gate facts serve a denial and a granted claim alike.
    const gates=this.gateFacts(snapshot,stress,capacity,profile,{candidateNotionalUsd:candidate.notionalUsd,candidateMarginUsd:candidate.marginUsd,
      candidateSide:candidate.side,clusterKey:correlationClusterOf(String(candidate.symbol),correlation)});
    const ranked=rankAdmissionReasons({reasons,gates,candidateNotionalUsd:candidate.notionalUsd});
    if(reasons.length){
      const ordered=ranked.ordered;
      this.lastDeny={at:now,candidateKey:candidateKeyOf(candidate),reasons:ordered,limits:stress.limitingConstraints};
      return{allowed:false,reason:ordered[0],reasons:ordered,limits:stress.limitingConstraints,ticket:null,snapshot,stress,capacity,
        firstBinding:ranked.firstBinding,gates};
    }
    const expiresAt=this.ledger.expiresAt;
    if(!(finite(expiresAt)&&expiresAt>now)){
      this.lastDeny={at:now,candidateKey:candidateKeyOf(candidate),reasons:['RISK_TICKET_EXPIRED'],limits:[]};
      return{allowed:false,reason:'RISK_TICKET_EXPIRED',reasons:['RISK_TICKET_EXPIRED'],limits:[],ticket:null,snapshot,stress,capacity,
        firstBinding:{kind:'EVIDENCE',code:'RISK_TICKET_EXPIRED',gate:null,limitUsd:null,usedUsd:null,headroomUsd:null,shortfallUsd:null,detail:'风险权威窗口已过期，必须按当前事实重新评估'},gates};
    }
    return{allowed:true,reason:'PORTFOLIO_ADMISSION_AUTHORISED',reasons:[],limits:[],
      ticket:{riskGeneration:this.ledger.generation,snapshotHash:String(this.ledger.snapshotHash),profileVersion:String(this.ledger.profileVersion),
        evaluatedAt:now,expiresAt,candidateKey:candidateKeyOf(candidate),coverage,limits:stress.limitingConstraints,reasons:[]},snapshot,stress,capacity,
      firstBinding:null,gates};
  }

  private emptySnapshot(now:number):PortfolioRiskSnapshot{
    const snapshot=buildPortfolioRiskSnapshot({riskGeneration:0,now,peakEquityUsd:0,assets:[],cashFlows:[],positions:[],pending:[]});
    return{...snapshot,blockers:[...new Set([...snapshot.blockers,'ADMISSION_CANDIDATE_INVALID'])],complete:false};
  }
  private emptyStress(snapshot:PortfolioRiskSnapshot):PortfolioStressResult{
    return evaluatePortfolioStress({snapshot,profile:{maxCapitalAtRiskUsd:0,maxDrawdownPct:0,maxStressLossUsd:0,maxGrossNotionalUsd:0,maxDirectionNotionalUsd:0,maxClusterNotionalUsd:0,minMarginBufferPct:0,minLiquidationBufferPct:0},correlation:{version:'',clusters:{}},scenarios:[]});
  }
  private emptyCapacity(snapshot:PortfolioRiskSnapshot):HumanCapacityDecision{
    return evaluateHumanCapacity({snapshot,profile:{maxHumanPositions:0,maxHumanNotionalUsd:0,maxPendingHandoffs:0,maxAckAgeMs:0},now:Date.now()});
  }

  /**
   * The production `entryRiskGate`. Runs inside the reservation transaction: it rebuilds the
   * snapshot from the facts as they are at that instant and refuses unless the caller's ticket still
   * describes that exact state.
   */
  gate(input:any){
    const now=Number(input?.now??Date.now());
    const ticket=input?.riskTicket as RiskTicket|undefined;
    const candidate=input?.admissionCandidate as AdmissionCandidate|undefined;
    if(!candidate||!ticket)return{allowed:false,reason:'RISK_TICKET_REQUIRED'};
    if(!(finite(ticket.expiresAt)&&ticket.expiresAt>now))return{allowed:false,reason:'RISK_TICKET_EXPIRED'};
    if(ticket.candidateKey!==candidateKeyOf(candidate))return{allowed:false,reason:'RISK_TICKET_CANDIDATE_MISMATCH'};
    const built=this.refresh(now,candidate);
    const profile=built.profile.row;
    const stress=evaluatePortfolioStress({snapshot:built.snapshot,
      profile:{maxCapitalAtRiskUsd:profile.maxCapitalAtRiskUsd,maxDrawdownPct:profile.maxDrawdownPct,maxStressLossUsd:profile.maxStressLossUsd,
        maxGrossNotionalUsd:profile.maxGrossNotionalUsd,maxDirectionNotionalUsd:profile.maxDirectionNotionalUsd,maxClusterNotionalUsd:profile.maxClusterNotionalUsd,
        minMarginBufferPct:profile.minMarginBufferPct,minLiquidationBufferPct:profile.minLiquidationBufferPct},
      correlation:{version:String(profile.correlationVersion??''),clusters:profile.clusters??{}},scenarios:Array.isArray(profile.scenarios)?profile.scenarios:[]});
    const capacity=evaluateHumanCapacity({snapshot:built.snapshot,profile:{maxHumanPositions:profile.maxHumanPositions,maxHumanNotionalUsd:profile.maxHumanNotionalUsd,
      maxPendingHandoffs:profile.maxPendingHandoffs,maxAckAgeMs:profile.maxAckAgeMs},now,candidateNotionalUsd:0,candidateAlreadyCounted:true});
    const blockers=[...new Set([...built.blockers,...built.snapshot.blockers,...stress.blockers,
      ...stress.limitingConstraints.map(row=>`STRESS_LIMIT:${row}`),...capacity.blockers])].sort();
    if(blockers.length){
      this.lastDeny={at:now,candidateKey:candidateKeyOf(candidate),reasons:blockers,limits:stress.limitingConstraints};
      return{allowed:false,reason:blockers[0]};
    }
    if(ticket.snapshotHash!==built.snapshot.snapshotHash)return{allowed:false,reason:'RISK_SNAPSHOT_CHANGED'};
    if(ticket.riskGeneration!==this.ledger.generation)return{allowed:false,reason:'RISK_GENERATION_STALE'};
    if(ticket.profileVersion!==this.ledger.profileVersion)return{allowed:false,reason:'RISK_PROFILE_VERSION_CHANGED'};
    const expiresAt=Math.min(Number(ticket.expiresAt),this.ledger.expiresAt);
    if(!(finite(expiresAt)&&expiresAt>now))return{allowed:false,reason:'RISK_TICKET_EXPIRED'};
    return{allowed:true,reason:'PORTFOLIO_ADMISSION_AUTHORISED',binding:{riskGeneration:this.ledger.generation,snapshotHash:this.ledger.snapshotHash,
      evaluatedAt:this.ledger.evaluatedAt,expiresAt,profileVersion:this.ledger.profileVersion,factCoverage:built.coverage,
      limitingConstraints:stress.limitingConstraints,scenarioSet:stress.scenarios.map(row=>row.id)}};
  }
}

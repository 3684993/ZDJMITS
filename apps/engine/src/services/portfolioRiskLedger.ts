import {buildPortfolioRiskSnapshot, stableRiskHash, type PortfolioAssetFact, type PortfolioCashFlowFact, type PortfolioOwnerState, type PortfolioPendingRiskFact, type PortfolioPositionFact, type PortfolioRiskSnapshot} from './portfolioRiskSnapshot.js';
import {evaluatePortfolioStress, type PortfolioStressResult} from './portfolioStress.js';
import {evaluateHumanCapacity, type HumanCapacityDecision} from './humanCapacityPolicy.js';
import {executionScope} from './executionLifecycle.js';
import {privateAccountFresh} from './privateAccountReadiness.js';
import {collectPortfolioPendingRiskFacts} from './entryRiskOccupancy.js';
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
  snapshot:PortfolioRiskSnapshot;stress:PortfolioStressResult;capacity:HumanCapacityDecision};

export type PortfolioLedgerState={generation:number;contentHash:string|null;snapshotHash:string|null;profileVersion:string|null;evaluatedAt:number;expiresAt:number;peakEquityUsd:number};

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
      authority:authority?{...portfolioRiskAuthorityReadback({...authority,profile:p.row as Record<string,unknown>,operatorStatus:status}),uncoveredCoverageCandidates:uncovered}:null};
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
      const liquidation=finite(position.liquidationPrice)&&Number(position.liquidationPrice)>0?Number(position.liquidationPrice):null;
      const buffer=liquidation!=null&&finite(markPrice)&&markPrice>0?Math.max(0,Math.abs(markPrice-liquidation)/markPrice):null;
      const marginAsset=String(position.marginAsset??'').trim().toUpperCase();
      if(!marginAsset)blockers.push('POSITION_MARGIN_ASSET_UNPROVEN');
      return{scope,cycleId:cycleId||'UNKNOWN_CYCLE',symbol:position.symbol,side:position.side==='SHORT'?'SHORT':'LONG',
        quantity:Math.abs(Number(position.quantity??0)),markPrice,leverage:Number(position.leverage??0),
        quoteAsset:marginAsset,marginAsset,
        ownerState:durable?durable.ownerState:'UNKNOWN' as unknown as PortfolioOwnerState,
        factStatus:durable&&Boolean(marginAsset)&&finite(position.quantity)&&finite(position.markPrice)&&position.markPrice>0?'VERIFIED' as const:'UNKNOWN' as const,
        maintenanceMarginUsd:finite(position.maintenanceMarginUsd)?Number(position.maintenanceMarginUsd):null,
        liquidationBufferPct:buffer,handoffAt:durable?.handoffAt??null,acknowledgedAt:durable?.acknowledgedAt??null} as PortfolioPositionFact;
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
      liquidationBufferPct:buffer,handoffAt:null,acknowledgedAt:null} as PortfolioPositionFact;
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

  /** Observe the existing book without inventing a proposed trade or a risk ticket. */
  observe(now=Date.now()){
    const built=this.refresh(now),p=built.profile.row,snapshot=built.snapshot;
    const stress=evaluatePortfolioStress({snapshot,profile:p as any,correlation:{version:String(p.correlationVersion??''),clusters:p.clusters??{}},scenarios:p.scenarios??[]});
    const capacity=evaluateHumanCapacity({snapshot,profile:p as any,now});
    const reasons=[...new Set([...built.blockers,...snapshot.blockers,...stress.blockers,...stress.limitingConstraints.map(x=>`STRESS_LIMIT:${x}`),...capacity.blockers])].sort();
    return{allowed:reasons.length===0,reasons,snapshotHash:snapshot.snapshotHash,riskGeneration:snapshot.riskGeneration,
      profileVersion:built.profile.profileVersion,provenance:built.profile.provenance,coverage:built.coverage,scope:'CURRENT_BOOK',ticket:null};
  }

  /** Read-only pre-check. It locks nothing; the claim only happens through the gate. */
  admit(candidate:AdmissionCandidate,now=Date.now()):AdmissionDecision{
    const invalid=this.emptySnapshot(now);
    if(!candidate||!String(candidate.symbol??'').trim()||!['LONG','SHORT'].includes(candidate.side)||!String(candidate.quoteAsset??'').trim()||
      !finite(candidate.notionalUsd)||candidate.notionalUsd<=0||!finite(candidate.marginUsd)||candidate.marginUsd<=0||!String(candidate.planId??'').trim())
      return{allowed:false,reason:'ADMISSION_CANDIDATE_INVALID',reasons:['ADMISSION_CANDIDATE_INVALID'],limits:[],ticket:null,
        snapshot:invalid,stress:this.emptyStress(invalid),capacity:this.emptyCapacity(invalid)};
    const built=this.refresh(now,candidate);
    const {snapshot,coverage}=built;
    const profile=built.profile.row;
    const stress=evaluatePortfolioStress({snapshot,
      profile:{maxCapitalAtRiskUsd:profile.maxCapitalAtRiskUsd,maxDrawdownPct:profile.maxDrawdownPct,maxStressLossUsd:profile.maxStressLossUsd,
        maxGrossNotionalUsd:profile.maxGrossNotionalUsd,maxDirectionNotionalUsd:profile.maxDirectionNotionalUsd,maxClusterNotionalUsd:profile.maxClusterNotionalUsd,
        minMarginBufferPct:profile.minMarginBufferPct,minLiquidationBufferPct:profile.minLiquidationBufferPct},
      correlation:{version:String(profile.correlationVersion??''),clusters:profile.clusters??{}},
      scenarios:Array.isArray(profile.scenarios)?profile.scenarios:[]});
    const capacity=evaluateHumanCapacity({snapshot,profile:{maxHumanPositions:profile.maxHumanPositions,maxHumanNotionalUsd:profile.maxHumanNotionalUsd,
      maxPendingHandoffs:profile.maxPendingHandoffs,maxAckAgeMs:profile.maxAckAgeMs},now,candidateNotionalUsd:0,candidateAlreadyCounted:true});
    const reasons=[...new Set([...built.blockers,...snapshot.blockers,...stress.blockers,
      ...stress.limitingConstraints.map(limit=>`STRESS_LIMIT:${limit}`),...capacity.blockers])].sort();
    if(reasons.length){
      this.lastDeny={at:now,candidateKey:candidateKeyOf(candidate),reasons,limits:stress.limitingConstraints};
      return{allowed:false,reason:reasons[0],reasons,limits:stress.limitingConstraints,ticket:null,snapshot,stress,capacity};
    }
    const expiresAt=this.ledger.expiresAt;
    if(!(finite(expiresAt)&&expiresAt>now)){
      this.lastDeny={at:now,candidateKey:candidateKeyOf(candidate),reasons:['RISK_TICKET_EXPIRED'],limits:[]};
      return{allowed:false,reason:'RISK_TICKET_EXPIRED',reasons:['RISK_TICKET_EXPIRED'],limits:[],ticket:null,snapshot,stress,capacity};
    }
    return{allowed:true,reason:'PORTFOLIO_ADMISSION_AUTHORISED',reasons:[],limits:[],
      ticket:{riskGeneration:this.ledger.generation,snapshotHash:String(this.ledger.snapshotHash),profileVersion:String(this.ledger.profileVersion),
        evaluatedAt:now,expiresAt,candidateKey:candidateKeyOf(candidate),coverage,limits:stress.limitingConstraints,reasons:[]},snapshot,stress,capacity};
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

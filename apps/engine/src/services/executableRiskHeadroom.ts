import { testnetFundsOnlyEntry } from '@zdj/core';
import type { Position, Side, SystemSettings } from '@zdj/contracts';
import type { PendingEntryRiskExposureList } from './entryRiskOccupancy.js';
import type { CapitalCapacityFact } from './capitalCapacity.js';
import {ENTRY_GATE_TAXONOMY_VERSION,entryGateDecision} from './entryGateTaxonomy.js';

// OTHER describes missing classification, not a shared correlation factor.
export function riskUnderlying(symbol:string){return symbol.toUpperCase().replace(/(USDT|USDC|BUSD|FDUSD)$/,'').replace(/^1000(?=[A-Z])/,'');}
export function clusterFor(symbol:string){
  const asset=riskUnderlying(symbol);
  const groups:Record<string,string[]>={BTC:['BTC'],ETH_L1:['ETH'],MEME:['DOGE','SHIB','PEPE','BONK','BOME','FLOKI','MEME'],AI:['FET','RNDR','RENDER','TAO','WLD','AI'],DEFI:['UNI','AAVE','MKR','CRV','LDO'],EXCHANGE:['BNB','OKB','LEO','KCS']};
  return Object.keys(groups).find(key=>groups[key].includes(asset))??'OTHER';
}
export function riskClusterKey(symbol:string){const cluster=clusterFor(symbol);return cluster==='OTHER'?`OTHER:${riskUnderlying(symbol)}`:cluster;}

/**
 * Whether a notional ratio may veto new Entry risk at all. `OBSERVE` keeps computing and publishing
 * the ratio as a portfolio fact and takes the veto away; it never raises or deletes the configured
 * percentage, and it never applies to a dimension the deployment has not chosen to relax.
 */
export type ExposureEnforcement='ENFORCE'|'OBSERVE';
export type ExposureCapacityPolicy={gross:ExposureEnforcement;direction:ExposureEnforcement;cluster:ExposureEnforcement};
export const DEFAULT_EXPOSURE_CAPACITY_POLICY:ExposureCapacityPolicy={gross:'ENFORCE',direction:'ENFORCE',cluster:'ENFORCE'};
const mode=(value:unknown):ExposureEnforcement=>value==='OBSERVE'?'OBSERVE':'ENFORCE';
export function exposureCapacityPolicy(settings:SystemSettings):ExposureCapacityPolicy{
  if(testnetFundsOnlyEntry(settings))return {gross:'OBSERVE',direction:'OBSERVE',cluster:'OBSERVE'};
  const policy=(settings?.riskGovernance as {exposureCapacityPolicy?:Partial<ExposureCapacityPolicy>}|undefined)?.exposureCapacityPolicy;
  return {gross:mode(policy?.gross),direction:mode(policy?.direction),cluster:mode(policy?.cluster)};
}

/** The one dimension that denies new Entry risk right now, whatever every other side still allows. */
export type BindingConstraint='RISK_FACTS'|'DAILY_DRAWDOWN'|'SIDE_PLAN_ABSENT'|'PLANNED_NOTIONAL_ZERO'|'FINAL_NOTIONAL_ZERO'|'BELOW_EXCHANGE_MIN_NOTIONAL'|'EXCHANGE_FILTERS_UNPROVEN'|'PORTFOLIO_RISK_DENIED'|'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE'|'GROSS_ENFORCED'|'DIRECTION_ENFORCED'|'CLUSTER'|'CLUSTER_DIRECTION'|'PER_TRADE_RISK'|'AVAILABLE_MARGIN'|'LEVERAGE_UNPROVEN'|'MARGIN_POLICY_CAP'|'MINIMUM_NOTIONAL'|'PLANNED_NOTIONAL'|'EXECUTABLE_HEADROOM'|'RISK_ADMISSION_CEILING'|'NONE'|(string & {});

const CONSTRAINT_BY_BLOCKER:Record<string,BindingConstraint>={
  RISK_FACTS_INVALID:'RISK_FACTS',REJECT_DAILY_DRAWDOWN:'DAILY_DRAWDOWN',REJECT_GROSS_EXPOSURE:'GROSS_ENFORCED',REJECT_DIRECTION_EXPOSURE:'DIRECTION_ENFORCED',
  REJECT_CORRELATED_CLUSTER:'CLUSTER',REJECT_CLUSTER_DIRECTION_EXPOSURE:'CLUSTER_DIRECTION',REJECT_RISK_PER_TRADE:'PER_TRADE_RISK',QUOTE_ASSET_NOT_ENTRY_ELIGIBLE:'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE',
  BELOW_MINIMUM_NOTIONAL:'MINIMUM_NOTIONAL',RISK_SIZING_CLAMP:'PER_TRADE_RISK',REJECT_RISK_ADMISSION_CEILING:'RISK_ADMISSION_CEILING',
};
const CONSTRAINT_BY_DIMENSION:Record<string,BindingConstraint>={gross:'GROSS_ENFORCED',direction:'DIRECTION_ENFORCED',cluster:'CLUSTER',clusterDirection:'CLUSTER_DIRECTION',riskSizing:'PER_TRADE_RISK',quote:'AVAILABLE_MARGIN',admission:'RISK_ADMISSION_CEILING'};

export type HeadroomInput={settings:SystemSettings;equity:number;positions:Pick<Position,'symbol'|'side'|'quantity'|'markPrice'>[];pendingRiskExposures?:PendingEntryRiskExposureList;symbol:string;side:Side;plannedNotional:number;expectedAdverseMovePct:number;dailyDrawdownPct:number;capital?:CapitalCapacityFact;minimumNotional?:number;now?:number;strictPlannedNotional?:boolean;
  /** The most this side could add and still pass portfolio admission, as the admission ledger itself computes it.
   *  Absent means "this layer has no verdict", which is never the same as "unlimited". */
  riskAdmissionCeilingUsd?:number|null;
  /** A denial the gate issues regardless of size — no amount of shrinking the order can clear it. */
  riskAdmissionRefusal?:string|null;
  /** Which committed ceiling that verdict came from, carried through so a reader need not re-derive it. */
  riskAdmissionNote?:{gate:string|null;detail:string|null}|null;};

/** Pure capacity calculation shared by routing, pre-Primary JIT and final risk validation. */
export function computeExecutableRiskHeadroom(input:HeadroomInput){
  const fundsOnly=testnetFundsOnlyEntry(input.settings);
  const g=input.settings.riskGovernance,equity=input.equity,cluster=clusterFor(input.symbol),clusterKey=riskClusterKey(input.symbol),pending=input.pendingRiskExposures??[];
  const exposures=[
    ...input.positions.map(p=>({id:`position:${p.symbol}:${p.side}`,symbol:p.symbol,side:p.side as Side|'BOTH',notionalUsd:Math.abs(p.quantity*p.markPrice),source:'POSITION'})),
    ...pending.map(p=>({id:p.id,symbol:p.symbol,side:p.side,notionalUsd:Math.abs(p.notionalUsd),source:p.source})),
  ];
  const sum=(predicate:(p:typeof exposures[number])=>boolean)=>exposures.filter(predicate).reduce((n,p)=>n+p.notionalUsd,0);
  const gross=sum(()=>true),long=sum(p=>p.side==='LONG'||p.side==='BOTH'),short=sum(p=>p.side==='SHORT'||p.side==='BOTH'),clusterNow=sum(p=>riskClusterKey(p.symbol)===clusterKey),clusterDirectionNow=sum(p=>riskClusterKey(p.symbol)===clusterKey&&(p.side===input.side||p.side==='BOTH'));
  const move=Math.max(.0001,input.expectedAdverseMovePct),perTradeRiskUsd=equity*g.perTradeRiskPctEquity;
  const limits={gross:equity*g.maxGrossExposurePct,direction:equity*g.maxDirectionExposurePct,cluster:equity*g.maxClusterExposurePct,clusterDirection:equity*g.maxClusterDirectionExposurePct};
  // The admission ledger's own ceiling is a dimension of its own, so a page that reads "how much room is
  // left" cannot miss the limit that will actually refuse the order. No verdict from that ledger is
  // rendered as unlimited room: it is simply not part of this calculation then.
  const ceilingSupplied=!fundsOnly&&input.riskAdmissionCeilingUsd!=null&&Number.isFinite(Number(input.riskAdmissionCeilingUsd));
  const refusal=fundsOnly?null:input.riskAdmissionRefusal??null;
  // A refusal that holds at every size is expressed as zero room rather than as an extra capacity blocker:
  // the money arithmetic stays in this layer's own vocabulary, while the refusal is still the named cause.
  const admission=refusal?0:ceilingSupplied?Math.max(0,Number(input.riskAdmissionCeilingUsd)):null;
  const remaining={gross:Math.max(0,limits.gross-gross),direction:Math.max(0,limits.direction-(input.side==='LONG'?long:short)),cluster:Math.max(0,limits.cluster-clusterNow),clusterDirection:Math.max(0,limits.clusterDirection-clusterDirectionNow),riskSizing:perTradeRiskUsd/move,quote:input.capital?.executableNotionalUsd??Number.MAX_VALUE,admission:admission??Number.MAX_VALUE};
  const minimum=Math.max(1,input.minimumNotional??1),blockers:string[]=[];
  const policy=exposureCapacityPolicy(input.settings),capital=input.capital;
  const enforced={gross:policy.gross==='ENFORCE',direction:policy.direction==='ENFORCE',cluster:policy.cluster==='ENFORCE'};
  // Per-trade risk sizing and real funding are never "observed": they are money and loss facts.
  const checks:[keyof typeof remaining,string][]=[];
  if(enforced.gross)checks.push(['gross','REJECT_GROSS_EXPOSURE']);
  if(enforced.direction)checks.push(['direction','REJECT_DIRECTION_EXPOSURE']);
  if(enforced.cluster)checks.push(['cluster','REJECT_CORRELATED_CLUSTER'],['clusterDirection','REJECT_CLUSTER_DIRECTION_EXPOSURE']);
  const quoteReason=!capital?'QUOTE_CAPACITY_UNPROVEN':capital.bindingConstraint==='QUOTE_ASSET_NOT_ENTRY_ELIGIBLE'?'QUOTE_ASSET_NOT_ENTRY_ELIGIBLE':capital.leverageFact==='UNPROVEN'?'LEVERAGE_UNPROVEN':'INSUFFICIENT_AVAILABLE_MARGIN';
  if(!fundsOnly)checks.push(['riskSizing','REJECT_RISK_PER_TRADE']);
  checks.push(['quote',quoteReason]);
  if(admission!=null)checks.push(['admission','REJECT_RISK_ADMISSION_CEILING']);
  const valid=fundsOnly ? Number.isFinite(input.plannedNotional)&&input.plannedNotional>=0&&Boolean(capital?.factsComplete)&&Number.isFinite(remaining.quote)&&remaining.quote>=0 : equity>0&&Number.isFinite(equity)&&Number.isFinite(input.plannedNotional)&&input.plannedNotional>=0&&Number.isFinite(move)&&Number.isFinite(input.dailyDrawdownPct)&&Object.values(limits).every(Number.isFinite)&&Object.values(remaining).every(v=>Number.isFinite(v)&&v>=0)&&exposures.every(p=>Number.isFinite(p.notionalUsd)&&p.notionalUsd>=0&&Boolean(p.symbol));
  if(!valid)blockers.push('RISK_FACTS_INVALID');
  if(!fundsOnly&&input.dailyDrawdownPct>g.maxDailyDrawdownPct)blockers.push('REJECT_DAILY_DRAWDOWN');
  for(const [key,reason] of checks)if(remaining[key]+1e-8<minimum)blockers.push(reason);
  // Routing/preflight are capacity calculations and may clamp an oversized
  // recommendation. Final-order JIT snapshots are strict: the already
  // authorized actual/planned notional must fit every remaining limit now.
  if(((pending as PendingEntryRiskExposureList).strictPlannedNotional||input.strictPlannedNotional)&&valid)for(const [key,reason] of checks)if(input.plannedNotional>remaining[key]+1e-8&&!blockers.includes(reason))blockers.push(reason);
  const binding=(key:keyof typeof remaining)=>remaining[key];
  const finalNotional=valid?Math.max(0,Math.min(input.plannedNotional,...checks.map(([key])=>binding(key)))):0;
  if(finalNotional+1e-8<minimum&&!blockers.length)blockers.push('BELOW_MINIMUM_NOTIONAL');
  const firstBindingConstraint=firstBinding({valid,blockers,checks,remaining,plannedNotional:input.plannedNotional,capital,finalNotional,refusal});
  const observed={
    policy,enforced,
    gross:{mode:policy.gross,enforced:enforced.gross,notionalUsd:gross,limitUsd:limits.gross,remainingUsd:remaining.gross,usedPct:limits.gross>0?gross/limits.gross:0},
    direction:{mode:policy.direction,enforced:enforced.direction,side:input.side,notionalUsd:input.side==='LONG'?long:short,limitUsd:limits.direction,remainingUsd:remaining.direction,usedPct:limits.direction>0?(input.side==='LONG'?long:short)/limits.direction:0},
    directionBoth:{LONG:{notionalUsd:long,remainingUsd:Math.max(0,limits.direction-long)},SHORT:{notionalUsd:short,remainingUsd:Math.max(0,limits.direction-short)}},
    cluster:{mode:policy.cluster,enforced:enforced.cluster,clusterKey,notionalUsd:clusterNow,limitUsd:limits.cluster,remainingUsd:remaining.cluster},
    clusterDirection:{mode:policy.cluster,enforced:enforced.cluster,notionalUsd:clusterDirectionNow,limitUsd:limits.clusterDirection,remainingUsd:remaining.clusterDirection},
    // The committed gate's own number, published beside the ratio dimensions so a page never has to
    // reconstruct it. Null means this calculation ran without the gate's verdict, not that room is infinite.
    admission:{ceilingUsd:admission,refusal:input.riskAdmissionRefusal??null,gate:input.riskAdmissionNote?.gate??null,detail:input.riskAdmissionNote?.detail??null},
  };
  const gateDecisions={
    gross:entryGateDecision('REJECT_GROSS_EXPOSURE',{disposition:enforced.gross?'ENFORCE':'OBSERVE',mutatesQuantity:enforced.gross}),
    direction:entryGateDecision('REJECT_DIRECTION_EXPOSURE',{disposition:enforced.direction?'ENFORCE':'OBSERVE',mutatesQuantity:enforced.direction}),
    cluster:entryGateDecision('REJECT_CORRELATED_CLUSTER',{disposition:enforced.cluster?'ENFORCE':'OBSERVE',mutatesQuantity:enforced.cluster}),
    clusterDirection:entryGateDecision('REJECT_CLUSTER_DIRECTION_EXPOSURE',{disposition:enforced.cluster?'ENFORCE':'OBSERVE',mutatesQuantity:enforced.cluster}),
    stress:entryGateDecision('STRESS_LIMIT',{disposition:fundsOnly?'OBSERVE':'ENFORCE',mutatesQuantity:false}),
    positionCap:entryGateDecision('POSITION_CAPACITY_FULL',{disposition:fundsOnly?'OBSERVE':'ENFORCE',mutatesQuantity:false}),
    perTradeRisk:entryGateDecision('REJECT_RISK_PER_TRADE',{disposition:fundsOnly?'OBSERVE':'ENFORCE',mutatesQuantity:!fundsOnly}),
    availableMargin:entryGateDecision(quoteReason,{disposition:'ENFORCE',mutatesQuantity:true}),
    admission:entryGateDecision('REJECT_RISK_ADMISSION_CEILING',{disposition:fundsOnly?'OBSERVE':'ENFORCE',mutatesQuantity:!fundsOnly}),
  };
  const factVersion=JSON.stringify({gateTaxonomyVersion:ENTRY_GATE_TAXONOMY_VERSION,equity,side:input.side,symbol:input.symbol,exposures:exposures.map(p=>[p.id,p.symbol,p.side,Number(p.notionalUsd.toFixed(8))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),limits,exposureCapacityPolicy:policy,capital:capital?[capital.quoteAsset,Number(capital.availableBalanceUsd.toFixed(8)),Number(capital.reservedMarginUsd.toFixed(8)),Number(capital.executionLeaseMarginUsd.toFixed(8)),Number(capital.leverage.toFixed(4)),capital.leverageFact,Number(capital.executableNotionalUsd.toFixed(8))]:null,dailyDrawdownPct:input.dailyDrawdownPct,expectedAdverseMovePct:move,riskAdmission:[admission==null?null:Number(admission.toFixed(8)),input.riskAdmissionRefusal??null]});
  return {factVersion,equity,cluster,clusterKey,gross,long,short,clusterNow,clusterDirectionNow,pendingRiskNotional:pending.reduce((n,p)=>n+Math.max(0,p.notionalUsd),0),limits,remaining,observed,gateDecisions,exposureCapacityPolicy:policy,capital:capital??null,firstBindingConstraint,perTradeRiskUsd,expectedAdverseMovePct:move,plannedNotional:input.plannedNotional,finalNotional:blockers.length?0:finalNotional,minimumNotional:minimum,executable:!blockers.length,reason:blockers[0]??'PASS',blockers};
}

/**
 * Exactly one name for what binds. A denial reports its own first blocker; an accepted plan reports
 * either the plan size itself or the narrowest enforced ceiling, so no surface has to infer a cause
 * from a blocker list — and an observed dimension can never be named as the reason.
 */
function firstBinding(input:{valid:boolean;blockers:string[];checks:[string,string][];remaining:Record<string,number>;plannedNotional:number;capital:CapitalCapacityFact|undefined;finalNotional:number;refusal:string|null}):BindingConstraint{
  if(!input.valid)return 'RISK_FACTS';
  const fromBlocker=(reason:string):BindingConstraint=>{
    if(reason==='LEVERAGE_UNPROVEN'||reason==='QUOTE_ASSET_NOT_ENTRY_ELIGIBLE')return reason;
    if(reason==='INSUFFICIENT_AVAILABLE_MARGIN'||reason==='QUOTE_CAPACITY_UNPROVEN')return input.capital?.bindingConstraint==='MARGIN_POLICY_CAP'?'MARGIN_POLICY_CAP':'AVAILABLE_MARGIN';
    return CONSTRAINT_BY_BLOCKER[reason]??'NONE';
  };
  // The gate's own size-independent denial is the name, quoted verbatim: relabelling it as a generic
  // "portfolio risk denied" is what let a cockpit point at capacity while the refusal was an ack.
  if(input.refusal)return input.refusal;
  if(input.blockers.length){const named=input.blockers.map(fromBlocker).find(reason=>reason!=='NONE');return named??'NONE';}
  const tightest=input.checks.map(([key])=>({key,value:input.remaining[key]})).sort((a,b)=>a.value-b.value)[0];
  if(input.plannedNotional<= (tightest?.value??Number.MAX_VALUE)+1e-8)return 'PLANNED_NOTIONAL';
  return CONSTRAINT_BY_DIMENSION[tightest?.key??'']??'EXECUTABLE_HEADROOM';
}

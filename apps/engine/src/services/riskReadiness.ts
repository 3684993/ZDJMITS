import type { MarketSymbolSnapshot, Position, Side, SystemSettings } from '@zdj/contracts';
import { uid } from '@zdj/core';
import { computeExecutableRiskHeadroom, exposureCapacityPolicy, type BindingConstraint, type HeadroomInput } from './executableRiskHeadroom.js';

import type { EntryTradingCapital } from './capitalCapacity.js';
import { entrySideStatus } from './entryCapacityTrace.js';
export { clusterFor, computeExecutableRiskHeadroom } from './executableRiskHeadroom.js';

export type DataQualityStatus='GOOD'|'DEGRADED'|'UNTRUSTED';
export type InvalidationType='PRICE_LEVEL'|'ATR_BREAK'|'STRUCTURE_BREAK'|'TIME_EXPIRY'|'DATA_INVALIDATED'|'NONE';
export interface EntryInvalidationSpec { id:string; type:InvalidationType; triggerPrice:number|null; referencePrice:number; timeframe:string; expiryAt:number|null; maxLossUsd:number|null; maxLossPctEquity:number|null; atrDistance:number|null; reasonCode:string; evidenceRefs:string[]; generatedAt:number; snapshotId:string; }
export interface ProtectionShadowResult { status:'ARMED'|'WOULD_TRIGGER'|'EXPIRED'|'INVALID_DATA'|'NOT_APPLICABLE'; wouldTriggerAt:number|null; theoreticalExitPrice:number|null; theoreticalGrossPnl:number|null; estimatedFees:number|null; theoreticalNetPnl:number|null; mfe:number|null; mae:number|null; }
export interface MarketQualityResult { id:string; status:DataQualityStatus; reasons:string[]; checkedAt:number; snapshotId:string; }
export interface RiskEnvelope { id:string; status:'PASS'|'REJECT_GROSS_EXPOSURE'|'REJECT_DIRECTION_EXPOSURE'|'REJECT_CORRELATED_CLUSTER'|'REJECT_CLUSTER_DIRECTION_EXPOSURE'|'RISK_FACTS_INVALID'|'REJECT_LIQUIDATION_BUFFER'|'REJECT_DAILY_DRAWDOWN'|'REJECT_RISK_PER_TRADE'|'REJECT_AVAILABLE_MARGIN'; firstBindingConstraint:BindingConstraint; equity:number; grossNotional:number; grossNotionalPct:number; longNotional:number; shortNotional:number; longExposurePct:number; shortExposurePct:number; cluster:string; clusterExposurePct:number; quoteAssetMarginUsage:number; maxPositions:number; reservedIntents:number; workingOrders:number; liquidationBufferEstimate:number; perTradeRiskUsd:number; perTradeRiskPctEquity:number; dailyDrawdownPct:number; expectedAdverseMovePct:number; riskLimitedNotional:number; finalNotional:number; reasons:string[]; createdAt:number; }

export function marketDataQuality(snapshot:MarketSymbolSnapshot, now=Date.now()):MarketQualityResult {
  const q=snapshot.quote, reasons:string[]=[];
  if(!Number.isFinite(q.bid)||!Number.isFinite(q.ask)||q.bid<=0||q.ask<=0||q.bid>q.ask)reasons.push('QUOTE_BID_ASK_INVALID');
  if(!Number.isFinite(q.mark)||!Number.isFinite(q.last)||q.mark<=0||q.last<=0)reasons.push('QUOTE_MARK_INVALID');
  if(q.mark>0&&q.last>0&&Math.abs(q.mark-q.last)/q.last>.03)reasons.push('MARK_LAST_DIVERGENCE');
  if(q.tickSize<=0||q.stepSize<=0||q.minQty<=0||q.minNotional<=0)reasons.push('FILTERS_INVALID');
  if(now-q.ts>15_000||now-snapshot.orderBook.ts>15_000)reasons.push('QUOTE_OR_BOOK_STALE');
  const book=[...snapshot.orderBook.bids,...snapshot.orderBook.asks];
  if(book.some(([price,qty])=>price<=0||qty<=0||!Number.isFinite(price)||!Number.isFinite(qty)))reasons.push('BOOK_LEVEL_INVALID');
  if(snapshot.orderBook.bids.length<2||snapshot.orderBook.asks.length<2)reasons.push('BOOK_TOO_SHALLOW');
  const d=snapshot.derivatives;
  if(d.openInterest===null||d.openInterestChange5m===null||d.fundingRate===null||d.globalLongShortRatio===null)reasons.push('DERIVATIVE_FIELD_MISSING');
  if(d.fundingRate!==null&&Math.abs(d.fundingRate)>.05)reasons.push('FUNDING_OUT_OF_RANGE');
  if(snapshot.dataCompleteness<.86)reasons.push('SNAPSHOT_INCOMPLETE');
  return {id:uid('dq'),status:reasons.some(x=>/INVALID|OUT_OF_RANGE|DIVERGENCE/.test(x))?'UNTRUSTED':reasons.length?'DEGRADED':'GOOD',reasons,checkedAt:now,snapshotId:`market_${snapshot.symbol}_${snapshot.quote.ts}`};
}

export function weightedEvidence(domains:Partial<Record<'quote'|'technical'|'derivatives'|'book'|'globalRegime'|'portfolio'|'riskEnvelope'|'experience'|'invalidation',number>>){
  const weights={quote:.16,technical:.16,derivatives:.12,book:.12,globalRegime:.08,portfolio:.1,riskEnvelope:.12,experience:.06,invalidation:.08};
  let total=0,weight=0;for(const [key,w] of Object.entries(weights)){const value=domains[key as keyof typeof weights];if(value===undefined)continue;total+=Math.max(0,Math.min(1,value))*w;weight+=w;}
  return {score:weight?total/weight:0,coveredWeight:weight,missing:Object.keys(weights).filter(key=>domains[key as keyof typeof weights]===undefined)};
}

export function buildInvalidation(snapshot:MarketSymbolSnapshot, side:Side, equity:number, snapshotId:string, now=Date.now()):EntryInvalidationSpec {
  const t=snapshot.technical['15m'], atr=Math.max(t.atr14,snapshot.quote.last*.001), trigger=side==='LONG'?Math.max(t.recentSwingLow,snapshot.quote.last-2*atr):Math.min(t.recentSwingHigh,snapshot.quote.last+2*atr);
  const maxLossUsd=Math.max(0,equity*.01), qtyRisk=Math.abs(snapshot.quote.last-trigger), maxQty=qtyRisk>0?maxLossUsd/qtyRisk:0;
  return {id:uid('inv'),type:Number.isFinite(trigger)&&trigger>0?'PRICE_LEVEL':'DATA_INVALIDATED',triggerPrice:Number.isFinite(trigger)&&trigger>0?trigger:null,referencePrice:snapshot.quote.last,timeframe:'15m',expiryAt:now+4*60*60_000,maxLossUsd,maxLossPctEquity:equity>0?maxLossUsd/equity:null,atrDistance:2,reasonCode:'STRUCTURE_ATR_SHADOW',evidenceRefs:[snapshotId,`riskQty:${maxQty}`],generatedAt:now,snapshotId};
}

export function evaluateProtectionShadow(position:Pick<Position,'side'|'entryPrice'|'quantity'|'markPrice'|'openedAt'>, spec:EntryInvalidationSpec, now=Date.now()):ProtectionShadowResult {
  if(spec.type==='NONE')return{status:'NOT_APPLICABLE',wouldTriggerAt:null,theoreticalExitPrice:null,theoreticalGrossPnl:null,estimatedFees:null,theoreticalNetPnl:null,mfe:null,mae:null};
  if(spec.type==='DATA_INVALIDATED'||spec.triggerPrice===null)return{status:'INVALID_DATA',wouldTriggerAt:null,theoreticalExitPrice:null,theoreticalGrossPnl:null,estimatedFees:null,theoreticalNetPnl:null,mfe:null,mae:null};
  if(spec.expiryAt!==null&&now>spec.expiryAt)return{status:'EXPIRED',wouldTriggerAt:null,theoreticalExitPrice:spec.triggerPrice,theoreticalGrossPnl:null,estimatedFees:null,theoreticalNetPnl:null,mfe:null,mae:null};
  const hit=position.side==='LONG'?position.markPrice<=spec.triggerPrice:position.markPrice>=spec.triggerPrice, gross=(position.side==='LONG'?spec.triggerPrice-position.entryPrice:position.entryPrice-spec.triggerPrice)*position.quantity, fees=Math.abs(spec.triggerPrice*position.quantity)*.0008;
  return {status:hit?'WOULD_TRIGGER':'ARMED',wouldTriggerAt:hit?now:null,theoreticalExitPrice:spec.triggerPrice,theoreticalGrossPnl:gross,estimatedFees:fees,theoreticalNetPnl:gross-fees,mfe:Math.max(0,position.side==='LONG'?position.markPrice-position.entryPrice:position.entryPrice-position.markPrice)*position.quantity,mae:Math.min(0,position.side==='LONG'?position.markPrice-position.entryPrice:position.entryPrice-position.markPrice)*position.quantity};
}

/**
 * The one book-level gross/direction computation. Admission gates and the cockpit read the same object.
 *
 * Each dimension reports its own remaining amount: a spent gross ratio must not be rendered as "LONG has
 * no room", and a full LONG side must not be rendered as "the book has no room". Whether a ratio may veto
 * at all is the deployment's policy, and it travels with the numbers so no surface has to know it.
 */
export function directionBudget(settings:SystemSettings,equityInput:number,positions:Position[],evaluatedAt=Date.now()){
  const equity=Math.max(1,equityInput),gross=positions.reduce((n,p)=>n+Math.abs(p.quantity*p.markPrice),0),long=positions.filter(p=>p.side==='LONG').reduce((n,p)=>n+p.quantity*p.markPrice,0),short=positions.filter(p=>p.side==='SHORT').reduce((n,p)=>n+p.quantity*p.markPrice,0),grossLimit=equity*settings.riskGovernance.maxGrossExposurePct,directionLimit=equity*settings.riskGovernance.maxDirectionExposurePct,grossAvailable=Math.max(0,grossLimit-gross);
  return{
    equityUsd:equity,grossLimitUsd:grossLimit,directionLimitUsd:directionLimit,
    grossNotionalUsd:gross,longNotionalUsd:long,shortNotionalUsd:short,
    remainingGrossUsd:grossAvailable,grossUsedPct:grossLimit>0?gross/grossLimit:0,
    longAvailableNotionalUsd:Math.max(0,directionLimit-long),shortAvailableNotionalUsd:Math.max(0,directionLimit-short),
    longUsedPct:directionLimit>0?long/directionLimit:0,shortUsedPct:directionLimit>0?short/directionLimit:0,
    grossAvailableNotionalUsd:grossAvailable,policy:exposureCapacityPolicy(settings),evaluatedAt,
  };
}

export type PositionCapacity={positions:number;inFlight:number;reserved:number;used:number;max:number};
export type GrossDirectionBudget=ReturnType<typeof directionBudget>;
export type CapacityBlocker='POSITION_CAPACITY'|'RISK_ADMISSION'|'RISK_ADMISSION_UNAVAILABLE'|'GROSS'|'DIRECTION_LONG'|'DIRECTION_SHORT'|'NOT_EVALUATED'|'NONE';
/** The dimension that denies new Entry risk on its own, whatever the other side still allows. */
export type ExhaustedReason='POSITION_CAPACITY'|'RISK_ADMISSION'|'RISK_ADMISSION_UNAVAILABLE'|'GROSS'|'BOTH_DIRECTIONS'|'AVAILABLE_MARGIN';

/**
 * The best executable Entry notional one side can get right now, with the single reason it is limited.
 * The amounts come from the Engine's own per-route headroom and the constraint from that route's
 * capacity trace, so this only reads the verdict — and a side whose candidates were never sized is
 * reported as such instead of as an exchange-minimum problem.
 */
export function bestExecutableSide(routes:any[],side:'LONG'|'SHORT',traces:any[]=[]){
  const key=side==='LONG'?'longFeasibleNotionalUsd':'shortFeasibleNotionalUsd';
  const traceBySymbol=new Map(traces.filter(row=>row?.side===side).map(row=>[String(row.symbol).toUpperCase(),row]));
  const constraintOf=(route:any):string=>{
    const trace=traceBySymbol.get(String(route?.symbol??'').toUpperCase());
    if(trace?.firstBindingConstraint)return String(trace.firstBindingConstraint);
    return String(route?.riskHeadroom?.[side]?.firstBindingConstraint??'');
  };
  const open=routes.filter(route=>Number(route?.[key]??0)>0).sort((a,b)=>Number(b[key])-Number(a[key]));
  if(open.length){
    const best=open[0];
    return{executableNotionalUsd:Number(best[key]),quoteAsset:String(best.quoteAsset??'UNKNOWN'),symbol:String(best.symbol??'UNKNOWN'),
      firstBindingConstraint:(constraintOf(best)||'EXECUTABLE_HEADROOM') as BindingConstraint,executableRoutes:open.length,
      minimumLegalNotionalUsd:traceBySymbol.get(String(best.symbol).toUpperCase())?.minimumLegalNotionalUsd??null,
      candidates:traces.filter(row=>row?.side===side).sort((a,b)=>Number(b.finalNotionalBeforeRoundingUsd??0)-Number(a.finalNotionalBeforeRoundingUsd??0)).slice(0,12)};
  }
  const counted=new Map<string,number>();
  for(const route of routes){const constraint=constraintOf(route);if(!constraint||constraint==='EXECUTABLE_HEADROOM')continue;counted.set(constraint,(counted.get(constraint)??0)+1);}
  const named=[...counted.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  return{executableNotionalUsd:0,quoteAsset:null,symbol:null,
    firstBindingConstraint:(named??(routes.length?'NO_FEASIBLE_ROUTE':'NO_CAPITAL_ROUTE')) as BindingConstraint,executableRoutes:0,
    minimumLegalNotionalUsd:null,candidates:traces.filter(row=>row?.side===side).sort((a,b)=>Number(Boolean(b.executable))-Number(Boolean(a.executable))).slice(0,12)};
}

/**
 * Which capacity gate binds first, composed from the already-computed headroom, the slot count, the real
 * funding ledger and the per-route executable verdicts. It never recomputes exposure: a page that
 * re-derived the risk ledger could disagree with the gate that actually refused the Entry.
 *
 * A ratio dimension the deployment only observes is reported as a fact and never as a blocker.
 */
export function portfolioCapacityVisibility(capacity:PositionCapacity,budget:GrossDirectionBudget,facts:{funding?:EntryTradingCapital;routes?:any[];traces?:any[];admission?:{status?:'AVAILABLE'|'UNAVAILABLE'|'NOT_APPLICABLE';hasVerdict?:boolean;exhausted?:boolean;code?:string|null;gate?:string|null;detail?:string|null;evaluatedAt?:number;ceilingUsdBySide?:{LONG:number;SHORT:number};overdueHandoffs?:number;oldestOverdueHours?:number|null}|null}={}){
  const evaluated=budget.evaluatedAt>0,policy=budget.policy??{gross:'ENFORCE' as const,direction:'ENFORCE' as const,cluster:'ENFORCE' as const},routes=facts.routes??[],traces=facts.traces??[];
  const fundingBlock=facts.funding??{quoteAssets:[],totalExecutableMarginUsd:0,proven:false,excludedAssets:[],accountEquityUsd:null};
  const executable={LONG:bestExecutableSide(routes,'LONG',traces),SHORT:bestExecutableSide(routes,'SHORT',traces)};
  const fundableMarginUsd=Number(fundingBlock.totalExecutableMarginUsd??0),marginProven=fundingBlock.proven===true&&fundingBlock.quoteAssets.length>0;
  const slotsFull=capacity.used>=capacity.max,grossFull=policy.gross==='ENFORCE'&&budget.remainingGrossUsd<=0,longFull=policy.direction==='ENFORCE'&&budget.longAvailableNotionalUsd<=0,shortFull=policy.direction==='ENFORCE'&&budget.shortAvailableNotionalUsd<=0,marginFull=marginProven&&fundableMarginUsd<=0;
  // Permission and money are different questions, and only the committing gate answers the first. Without
  // its verdict here, a page reading an OBSERVE ratio could publish "both sides executable" beside a gate
  // that refuses every order — which is precisely the contradiction this projection exists to prevent.
  const gate=facts.admission??null,admissionUnavailable=gate?.status==='UNAVAILABLE',admissionExhausted=gate?.exhausted===true,
    admissionDenied=admissionUnavailable||admissionExhausted;
  const admission={status:gate?.status??(gate?.hasVerdict?'AVAILABLE':'NOT_APPLICABLE'),exhausted:admissionExhausted,hasVerdict:gate?.hasVerdict===true,code:gate?.code??null,gate:gate?.gate??null,
    detail:gate?.detail??null,evaluatedAt:Number(gate?.evaluatedAt)||0,ceilingUsdBySide:gate?.ceilingUsdBySide??{LONG:0,SHORT:0},
    overdueHandoffs:Number(gate?.overdueHandoffs??0),oldestOverdueHours:gate?.oldestOverdueHours??null};
  const firstBlocker:CapacityBlocker=!evaluated?'NOT_EVALUATED':slotsFull?'POSITION_CAPACITY':admissionUnavailable?'RISK_ADMISSION_UNAVAILABLE':admissionExhausted?'RISK_ADMISSION':grossFull?'GROSS':longFull?'DIRECTION_LONG':shortFull?'DIRECTION_SHORT':'NONE';
  const blockingDimensions=[slotsFull&&evaluated?'POSITION_CAPACITY':null,admissionUnavailable?'RISK_ADMISSION_UNAVAILABLE':null,admissionExhausted?'RISK_ADMISSION':null,grossFull&&evaluated?'GROSS':null,longFull&&evaluated?'DIRECTION_LONG':null,shortFull&&evaluated?'DIRECTION_SHORT':null].filter(Boolean) as Exclude<CapacityBlocker,'NONE'|'NOT_EVALUATED'>[];
  const exhaustedReason:ExhaustedReason|null=!evaluated?null:slotsFull?'POSITION_CAPACITY':admissionUnavailable?'RISK_ADMISSION_UNAVAILABLE':admissionExhausted?'RISK_ADMISSION':marginFull?'AVAILABLE_MARGIN':grossFull?'GROSS':longFull&&shortFull?'BOTH_DIRECTIONS':null;
  const sideStatus=entrySideStatus(executable,routes.length,admissionDenied,admissionUnavailable?'RISK_ADMISSION_UNAVAILABLE':'RISK_ADMISSION_EXHAUSTED');
  return{
    funding:{quoteAssets:fundingBlock.quoteAssets,totalExecutableMarginUsd:fundableMarginUsd,proven:marginProven,excludedAssets:fundingBlock.excludedAssets??[],accountEquityUsd:fundingBlock.accountEquityUsd??null},
    exposure:{
      gross:{notionalUsd:budget.grossNotionalUsd,limitUsd:budget.grossLimitUsd,remainingUsd:budget.remainingGrossUsd,usedPct:budget.grossUsedPct,mode:policy.gross,enforced:policy.gross==='ENFORCE'},
      LONG:{notionalUsd:budget.longNotionalUsd,limitUsd:budget.directionLimitUsd,remainingUsd:budget.longAvailableNotionalUsd,usedPct:budget.longUsedPct??0,mode:policy.direction,enforced:policy.direction==='ENFORCE'},
      SHORT:{notionalUsd:budget.shortNotionalUsd,limitUsd:budget.directionLimitUsd,remainingUsd:budget.shortAvailableNotionalUsd,usedPct:budget.shortUsedPct??0,mode:policy.direction,enforced:policy.direction==='ENFORCE'},
    },
    limits:{slots:{used:capacity.used,max:capacity.max,positions:capacity.positions,inFlight:capacity.inFlight,reserved:capacity.reserved},policy},
    entryCapacity:executable,sideStatus,admission,
    firstBlocker,blockingDimensions,exhaustedReason,exhaustedForNewRisk:exhaustedReason!==null,evaluatedAt:budget.evaluatedAt,
  };
}

export function buildRiskEnvelope(input:HeadroomInput&{reservedIntents:number;workingOrders:number;quoteMarginUsage:number}):RiskEnvelope {
  const now=input.now??Date.now(), h=computeExecutableRiskHeadroom({...input,strictPlannedNotional:true}), equity=input.equity,
    current=h.gross,long=h.long,short=h.short,gross=current+input.plannedNotional,
    cluster=h.cluster,clusterPct=(h.clusterNow+input.plannedNotional)/equity,
    perTradeRiskUsd=h.perTradeRiskUsd,move=h.expectedAdverseMovePct,riskLimitedNotional=h.remaining.riskSizing,
    finalNotional=h.finalNotional;
  const statusOf:(reason:string)=>RiskEnvelope['status']=(reason)=>reason==='INSUFFICIENT_AVAILABLE_MARGIN'||reason==='QUOTE_CAPACITY_UNPROVEN'?'REJECT_AVAILABLE_MARGIN':reason==='BELOW_MINIMUM_NOTIONAL'||reason==='REJECT_RISK_PER_TRADE'?'REJECT_RISK_PER_TRADE':reason==='PASS'?'PASS':reason as RiskEnvelope['status'];
  const status=h.blockers.length?statusOf(h.blockers[0]):'PASS';
  const reasons=[...h.blockers];
  if(!h.blockers.length&&input.plannedNotional>riskLimitedNotional)reasons.push('RISK_SIZING_CLAMP');
  return {id:uid('risk'),status,equity,grossNotional:gross,grossNotionalPct:gross/equity,longNotional:long,longExposurePct:(input.side==='LONG'?long+input.plannedNotional:long)/equity,shortNotional:short,shortExposurePct:(input.side==='SHORT'?short+input.plannedNotional:short)/equity,cluster,clusterExposurePct:clusterPct,quoteAssetMarginUsage:input.quoteMarginUsage,maxPositions:input.settings.portfolio.maxPositions,reservedIntents:input.reservedIntents,workingOrders:input.workingOrders,liquidationBufferEstimate:Math.max(0,1-gross/equity),perTradeRiskUsd,perTradeRiskPctEquity:perTradeRiskUsd/equity,dailyDrawdownPct:input.dailyDrawdownPct,expectedAdverseMovePct:move,riskLimitedNotional,finalNotional,reasons,createdAt:now,firstBindingConstraint:h.firstBindingConstraint};
}

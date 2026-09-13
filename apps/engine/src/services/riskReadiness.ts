import type { MarketSymbolSnapshot, Position, Side, SystemSettings } from '@zdj/contracts';
import { uid } from '@zdj/core';
import { computeExecutableRiskHeadroom } from './executableRiskHeadroom.js';
export { clusterFor, computeExecutableRiskHeadroom } from './executableRiskHeadroom.js';

export type DataQualityStatus='GOOD'|'DEGRADED'|'UNTRUSTED';
export type InvalidationType='PRICE_LEVEL'|'ATR_BREAK'|'STRUCTURE_BREAK'|'TIME_EXPIRY'|'DATA_INVALIDATED'|'NONE';
export interface EntryInvalidationSpec { id:string; type:InvalidationType; triggerPrice:number|null; referencePrice:number; timeframe:string; expiryAt:number|null; maxLossUsd:number|null; maxLossPctEquity:number|null; atrDistance:number|null; reasonCode:string; evidenceRefs:string[]; generatedAt:number; snapshotId:string; }
export interface ProtectionShadowResult { status:'ARMED'|'WOULD_TRIGGER'|'EXPIRED'|'INVALID_DATA'|'NOT_APPLICABLE'; wouldTriggerAt:number|null; theoreticalExitPrice:number|null; theoreticalGrossPnl:number|null; estimatedFees:number|null; theoreticalNetPnl:number|null; mfe:number|null; mae:number|null; }
export interface MarketQualityResult { id:string; status:DataQualityStatus; reasons:string[]; checkedAt:number; snapshotId:string; }
export interface RiskEnvelope { id:string; status:'PASS'|'REJECT_GROSS_EXPOSURE'|'REJECT_DIRECTION_EXPOSURE'|'REJECT_CORRELATED_CLUSTER'|'REJECT_CLUSTER_DIRECTION_EXPOSURE'|'RISK_FACTS_INVALID'|'REJECT_LIQUIDATION_BUFFER'|'REJECT_DAILY_DRAWDOWN'|'REJECT_RISK_PER_TRADE'; equity:number; grossNotional:number; grossNotionalPct:number; longNotional:number; shortNotional:number; longExposurePct:number; shortExposurePct:number; cluster:string; clusterExposurePct:number; quoteAssetMarginUsage:number; maxPositions:number; reservedIntents:number; workingOrders:number; liquidationBufferEstimate:number; perTradeRiskUsd:number; perTradeRiskPctEquity:number; dailyDrawdownPct:number; expectedAdverseMovePct:number; riskLimitedNotional:number; finalNotional:number; reasons:string[]; createdAt:number; }

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


export function directionBudget(settings:SystemSettings,equityInput:number,positions:Position[],evaluatedAt=Date.now()){
  const equity=Math.max(1,equityInput),gross=positions.reduce((n,p)=>n+Math.abs(p.quantity*p.markPrice),0),long=positions.filter(p=>p.side==='LONG').reduce((n,p)=>n+p.quantity*p.markPrice,0),short=positions.filter(p=>p.side==='SHORT').reduce((n,p)=>n+p.quantity*p.markPrice,0),grossAvailable=Math.max(0,equity*settings.riskGovernance.maxGrossExposurePct-gross),directionLimit=equity*settings.riskGovernance.maxDirectionExposurePct;
  return{longAvailableNotionalUsd:Math.max(0,Math.min(grossAvailable,directionLimit-long)),shortAvailableNotionalUsd:Math.max(0,Math.min(grossAvailable,directionLimit-short)),grossAvailableNotionalUsd:grossAvailable,evaluatedAt};
}

export function buildRiskEnvelope(input:{settings:SystemSettings;equity:number;positions:Position[];symbol:string;side:Side;plannedNotional:number;reservedIntents:number;workingOrders:number;dailyDrawdownPct:number;expectedAdverseMovePct:number;quoteMarginUsage:number;now?:number}):RiskEnvelope {
  const now=input.now??Date.now(), h=computeExecutableRiskHeadroom(input), equity=input.equity,
    current=h.gross,long=h.long,short=h.short,gross=current+input.plannedNotional,
    cluster=h.cluster,clusterPct=(h.clusterNow+input.plannedNotional)/equity,
    perTradeRiskUsd=h.perTradeRiskUsd,move=h.expectedAdverseMovePct,riskLimitedNotional=h.remaining.riskSizing,
    finalNotional=Math.min(input.plannedNotional,riskLimitedNotional),reasons:string[]=[],g=input.settings.riskGovernance;
  let status:RiskEnvelope['status']='PASS';
  if(h.reason==='RISK_FACTS_INVALID'){status='RISK_FACTS_INVALID';reasons.push(status);}
  else if(input.plannedNotional>h.remaining.gross+1e-8){status='REJECT_GROSS_EXPOSURE';reasons.push('GROSS_EXPOSURE_LIMIT');}
  else if(input.plannedNotional>h.remaining.direction+1e-8){status='REJECT_DIRECTION_EXPOSURE';reasons.push('DIRECTION_EXPOSURE_LIMIT');}
  else if(input.plannedNotional>h.remaining.cluster+1e-8){status='REJECT_CORRELATED_CLUSTER';reasons.push('CLUSTER_EXPOSURE_LIMIT');}
  else if(input.plannedNotional>h.remaining.clusterDirection+1e-8){status='REJECT_CLUSTER_DIRECTION_EXPOSURE';reasons.push('CLUSTER_DIRECTION_EXPOSURE_LIMIT');}
  else if(input.dailyDrawdownPct>g.maxDailyDrawdownPct){status='REJECT_DAILY_DRAWDOWN';reasons.push('DAILY_DRAWDOWN_LIMIT');}
  else if(input.plannedNotional>riskLimitedNotional){reasons.push('RISK_SIZING_CLAMP');}
  if(input.plannedNotional>0&&finalNotional<1){status='REJECT_RISK_PER_TRADE';reasons.push('RISK_NOT_EXECUTABLE');}
  return {id:uid('risk'),status,equity,grossNotional:gross,grossNotionalPct:gross/equity,longNotional:long,longExposurePct:(input.side==='LONG'?long+input.plannedNotional:long)/equity,shortNotional:short,shortExposurePct:(input.side==='SHORT'?short+input.plannedNotional:short)/equity,cluster,clusterExposurePct:clusterPct,quoteAssetMarginUsage:input.quoteMarginUsage,maxPositions:input.settings.portfolio.maxPositions,reservedIntents:input.reservedIntents,workingOrders:input.workingOrders,liquidationBufferEstimate:Math.max(0,1-gross/equity),perTradeRiskUsd,perTradeRiskPctEquity:perTradeRiskUsd/equity,dailyDrawdownPct:input.dailyDrawdownPct,expectedAdverseMovePct:move,riskLimitedNotional,finalNotional,reasons,createdAt:now};
}

import type { EntryIntelligencePacket, MarketSymbolSnapshot, Position, SystemSettings, UniverseCandidate, EntryOrder, Timeframe } from '@zdj/contracts';
import { directionWeights } from './profiles.js';
import { safeDiv, clamp, uid } from './math.js';
import { tradingCostSnapshot } from './tradingCost.js';

export interface ExperienceSummary {
  sampleSize:number;
  sameSymbolWinRate:number|null;
  sameRegimeWinRate:number|null;
  averageFillMinutes:number|null;
  recentLessons:string[];
  /** Records excluded from the performance denominator because canonical net PnL is unavailable. */
  coverage?: { eligible:number; closedComplete:number; excludedNetUnknown:number; excludedOther:number };
}
export interface EipContext {
  candidate: UniverseCandidate;
  snapshot: MarketSymbolSnapshot;
  btc: MarketSymbolSnapshot;
  eth: MarketSymbolSnapshot;
  positions: Position[];
  pendingEntries: EntryOrder[];
  experience: ExperienceSummary;
  settings: SystemSettings;
  now?: number;
}
function depthUsd(levels: Array<readonly [number, number, ...unknown[]]>, n=5){ return levels.slice(0,n).reduce((sum,[p,q])=>sum+p*q,0); }
function microPrice(s:MarketSymbolSnapshot){ const b=s.orderBook.bids[0], a=s.orderBook.asks[0]; if(!b||!a)return s.quote.last; const bidQty=b[1],askQty=a[1]; return safeDiv(a[0]*bidQty+b[0]*askQty,bidQty+askQty,s.quote.last); }
function trendCode(v:string){return v==='UP'?1:v==='DOWN'?-1:0;}
function globalRegime(btc:MarketSymbolSnapshot,eth:MarketSymbolSnapshot){
  const score=trendCode(btc.technical['15m'].trend)+trendCode(btc.technical['4h'].trend)+trendCode(eth.technical['15m'].trend)+trendCode(eth.technical['4h'].trend);
  const vol=(btc.technical['15m'].atrPercent+eth.technical['15m'].atrPercent)/2;
  if(vol>2.5)return 'HIGH_VOLATILITY' as const; if(vol<0.25)return 'LOW_VOLATILITY' as const; if(score>=2)return 'RISK_ON' as const; if(score<=-2)return 'RISK_OFF' as const; return 'MIXED' as const;
}
function profitableRatio(pos:Position[], side:'LONG'|'SHORT'){ const x=pos.filter(p=>p.side===side); return x.length?x.filter(p=>p.unrealizedPnl>0).length/x.length:0; }
function notional(pos:Position[], side:'LONG'|'SHORT'){return pos.filter(p=>p.side===side).reduce((s,p)=>s+p.quantity*p.markPrice,0);}
const referenceMarket=(s:MarketSymbolSnapshot)=>({symbol:s.symbol,quote:s.quote,technical:s.technical,derivatives:s.derivatives,orderBook:s.orderBook,recentTradedPrices:s.recentTradedPrices});
export function buildEip(ctx:EipContext):EntryIntelligencePacket {
  const now=ctx.now??Date.now(), s=ctx.snapshot, t1=s.technical['1m'],t5=s.technical['5m']; const mid=(s.quote.bid+s.quote.ask)/2; const spreadBps=safeDiv(s.quote.ask-s.quote.bid,mid,0)*10000;
  const atr1=t1.atr14, atr5=t5.atr14; const band1:[number,number]=[Math.max(s.quote.tickSize,s.quote.last-atr1*0.8),s.quote.last+atr1*0.8]; const band5:[number,number]=[Math.max(s.quote.tickSize,s.quote.last-atr5*1.15),s.quote.last+atr5*1.15];
  const bidDepth=depthUsd(s.orderBook.bids), askDepth=depthUsd(s.orderBook.asks); const imbalance=safeDiv(bidDepth-askDepth,bidDepth+askDepth,0); const reach=clamp(1-spreadBps/40+Math.min(0.2,t1.atrPercent/5),0,1);
  const evidence=[] as EntryIntelligencePacket['evidence'];
  const add=(id:string,category:any,label:string,value:unknown,ts=now)=>evidence.push({id,category,label,value:String(value),ts});
  add('price.last','PRICE','Last price',s.quote.last,s.quote.ts); add('price.mark','PRICE','Mark price',s.quote.mark,s.quote.ts); add('price.spread','MICROSTRUCTURE','Spread bps',spreadBps,s.quote.ts);
  for(const tf of ['1m','5m','15m','1h','4h','1d','1w'] as Timeframe[]){ const t=s.technical[tf]; add(`tech.${tf}.trend`,'TECHNICAL',`${tf} trend`,`${t.trend}/${t.trendStrength.toFixed(2)}`,t.asOf); add(`tech.${tf}.macd`,'TECHNICAL',`${tf} MACD`,`${t.macdLine.toPrecision(5)}/${t.macdSignal.toPrecision(5)}/${t.macdHistogram.toPrecision(5)}`,t.asOf); add(`tech.${tf}.bb`,'TECHNICAL',`${tf} BB position`,t.bbPosition.toFixed(3),t.asOf); }
  add('derivatives.oi15','DERIVATIVES','OI change 15m',s.derivatives.openInterestChange15m??'missing',s.derivatives.ts); add('derivatives.taker','DERIVATIVES','Taker buy/sell 5m',s.derivatives.takerBuySellRatio5m??'missing',s.derivatives.ts);
  const contradictions:string[]=[]; const t15=s.technical['15m']; const higher=[s.technical['4h'],s.technical['1d'],s.technical['1w']]; if(higher.some(t=>t.trend!==t15.trend&&t.trend!=='RANGE')) contradictions.push('Higher-timeframe trend conflicts with 15m direction.'); if(t15.trend==='UP'&&imbalance<-0.25) contradictions.push('Order-book imbalance opposes 15m bullish structure.'); if(t15.trend==='DOWN'&&imbalance>0.25) contradictions.push('Order-book imbalance opposes 15m bearish structure.');
  const weights=directionWeights(ctx.settings.directionReference);
  const tp=ctx.settings.takeProfit,cost=tradingCostSnapshot({entryFeeRate:Number(tp.entryFeeRate??0),makerFeeRate:Number(tp.makerFeeRate??0),
    takerFeeRate:Number(tp.takerFeeRate??0),exitFeeAssumption:tp.exitFeeAssumption??'TAKER',slippageBufferPct:Number(tp.slippageBufferPct??0),
    feeSafetyBufferPct:Number(tp.feeSafetyBufferPct??0)}),makerFeeBps=Number(tp.makerFeeRate??0)*10_000,takerFeeBps=Number(tp.takerFeeRate??0)*10_000;
  const configuredTargetMoveBps=tp.targetPriceMovePercent*100,px=s.quote.last;
  const longSpace=t15.recentSwingHigh>px?(t15.recentSwingHigh/px-1)*10_000:null, shortSpace=t15.recentSwingLow>0&&t15.recentSwingLow<px?(1-t15.recentSwingLow/px)*10_000:null;
  return {
    version:'3.0',packetId:uid('eip'),symbol:s.symbol,createdAt:now,expiresAt:now+90_000,
    selection:{rank:ctx.candidate.rank,score:ctx.candidate.score,components:ctx.candidate.components,selectionMode:ctx.settings.selection.mode},
    market:{quote:s.quote,technical:s.technical,derivatives:s.derivatives,orderBook:s.orderBook,recentTradedPrices:s.recentTradedPrices},
    referenceMarkets:{btc:referenceMarket(ctx.btc),eth:referenceMarket(ctx.eth)},
    microstructure:{spreadBps,bidDepthUsd5:bidDepth,askDepthUsd5:askDepth,microPrice:microPrice(s),imbalance,reachableBand1m:band1,reachableBand5m:band5,reachabilityScore:reach},
    economic:{costVersion:cost.costVersion,entryFeeBps:cost.entryFeeBps,expectedExitFeeBps:cost.expectedExitFeeBps,makerFeeBps,takerFeeBps,
      roundTripCostBps:cost.feeRoundTripBps,slippageBufferBps:cost.slippageBufferBps,safetyMarginBps:cost.uncertaintyBufferBps,
      allInCostBps:cost.allInCostBps,configuredTargetMoveBps,minimumEconomicEdgeBps:cost.allInCostBps,
      minimumEconomicEdgeDefinition:'ALL_IN_BREAK_EVEN_COST_ONLY',longSpaceToResistanceBps:longSpace,shortSpaceToSupportBps:shortSpace,
      provenance:'V3.9.7_CANONICAL_COST_SNAPSHOT+CONFIRMED_15M_SWINGS'},
    globalRegime:{btc:{symbol:ctx.btc.symbol,trend15m:ctx.btc.technical['15m'].trend,trend4h:ctx.btc.technical['4h'].trend,trend1d:ctx.btc.technical['1d'].trend,trend1w:ctx.btc.technical['1w'].trend,change24hPercent:ctx.btc.quote.priceChangePercent24h},eth:{symbol:ctx.eth.symbol,trend15m:ctx.eth.technical['15m'].trend,trend4h:ctx.eth.technical['4h'].trend,trend1d:ctx.eth.technical['1d'].trend,trend1w:ctx.eth.technical['1w'].trend,change24hPercent:ctx.eth.quote.priceChangePercent24h},regime:globalRegime(ctx.btc,ctx.eth)},
    portfolio:{activePositions:ctx.positions.length,pendingEntries:ctx.pendingEntries.filter(o=>['NEW','SUBMITTING','UNKNOWN','WORKING','PARTIALLY_FILLED'].includes(o.status)).length,longPositions:ctx.positions.filter(p=>p.side==='LONG').length,shortPositions:ctx.positions.filter(p=>p.side==='SHORT').length,longProfitableRatio:profitableRatio(ctx.positions,'LONG'),shortProfitableRatio:profitableRatio(ctx.positions,'SHORT'),longNotionalUsd:notional(ctx.positions,'LONG'),shortNotionalUsd:notional(ctx.positions,'SHORT')},
    experience:ctx.experience,
    directionPolicy:{reference:ctx.settings.directionReference,weights,hardConstraints:['1D is strategic regime; 4H is setup direction; 15m is tactical trigger.','A side opposing same-direction 1D+4H consensus requires an explicit counter-trend reversal exception.','1m/5m are execution timing evidence only.','SHORT bias may break a mixed tie but is never a direction command.']},
    evidenceCompleteness:clamp(s.dataCompleteness*.84+(s.orderBook.bids.length&&s.orderBook.asks.length ? .16 : 0),0,1),contradictions,evidence,
  };
}

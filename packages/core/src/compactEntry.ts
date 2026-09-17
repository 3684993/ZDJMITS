import type {EntryIntelligencePacket,ScoutAnnotation} from '@zdj/contracts';

const decisionFrames=['1m','5m','15m','1h','4h','1d','1w'] as const;
const referenceFrames=['15m','1h','4h','1d','1w'] as const;

export function compactFactIds(p:EntryIntelligencePacket):string[]{
  const ids=['quote.top','microstructure.book5','execution.envelope','execution.recentTrades','economics.entry','portfolio.context','experience.context'];
  for(const tf of decisionFrames)if(p.market.technical[tf])ids.push(`technical.${tf}.confirmed`);
  for(const name of ['btc','eth'] as const)for(const tf of referenceFrames)if((p as any).referenceMarkets?.[name]?.technical?.[tf])ids.push(`${name}.${tf}.confirmed`);
  return ids;
}

const technicalFacts=(technical:any,frames:readonly string[],createdAt:number,prefix='technical')=>Object.fromEntries(frames.flatMap(tf=>{
  const t=technical?.[tf];if(!t)return [];
  return [[tf,{factId:`${prefix}.${tf}.confirmed`,role:tf==='1m'||tf==='5m'?'TIMING':'MARKET_STRUCTURE',observedAt:createdAt,asOf:t.asOf,...(t.barOpenTime!==undefined?{barOpenTime:t.barOpenTime}:{}),barCloseTime:t.barCloseTime??t.asOf,receivedAt:t.receivedAt??createdAt,isClosed:t.isClosed!==false&&t.asOf<=createdAt,source:t.source??'UNKNOWN',trend:t.trend,trendStrength:t.trendStrength,ema8:t.ema8,ema21:t.ema21,ema55:t.ema55,emaSlope21:t.emaSlope21,macdLine:t.macdLine,macdSignal:t.macdSignal,macdHistogram:t.macdHistogram,macdHistogramSlope:t.macdHistogramSlope,macdCrossDirection:t.macdCrossDirection,macdCrossAgeBars:t.macdCrossAgeBars,bbPosition:t.bbPosition,bbBandwidth:t.bbBandwidth,bbUpper:t.bbUpper,bbMiddle:t.bbMiddle,bbLower:t.bbLower,atr14:t.atr14,atrPercent:t.atrPercent,volumeZScore:t.volumeZScore,swingLow:t.recentSwingLow,swingHigh:t.recentSwingHigh,higherHighs:t.higherHighs,higherLows:t.higherLows,lowerHighs:t.lowerHighs,lowerLows:t.lowerLows,...(t.lastClosedBar?{lastClosedBar:t.lastClosedBar}:{missingClosedBarAnchor:true}),...(t.inProgressBar?{inProgressBar:t.inProgressBar}:{})}]];
}));

export function compactEntryFacts(p:EntryIntelligencePacket) {
  const q=p.market.quote,[bandA,bandB]=p.microstructure.reachableBand1m as [number,number],refs=(p as any).referenceMarkets??{};
  const envelope=(p as any).executionEnvelope;if(!envelope)throw new Error('PRE_AI_EXECUTION_ENVELOPE_MISSING');
  const symbolFacts={identity:{symbol:p.symbol,underlying:p.symbol.replace(/(USDT|USDC|BUSD)$/,''),venue:'BINANCE_USDM',packetId:p.packetId,observedAt:p.createdAt,expiresAt:p.expiresAt},quote:{factId:'quote.top',unit:'QUOTE_ASSET_PER_BASE',source:'BINANCE_EXECUTION_MARKET',receivedAt:q.ts,bid:q.bid,ask:q.ask,last:q.last,mark:q.mark},technical:technicalFacts(p.market.technical,decisionFrames,p.createdAt),derivatives:p.market.derivatives,orderBook:{factId:'microstructure.book5',source:'BINANCE_EXECUTION_ORDERBOOK',receivedAt:p.market.orderBook.ts,bids:p.market.orderBook.bids.slice(0,5),asks:p.market.orderBook.asks.slice(0,5),spreadBps:p.microstructure.spreadBps,bidDepthUsd5:p.microstructure.bidDepthUsd5,askDepthUsd5:p.microstructure.askDepthUsd5,imbalance:p.microstructure.imbalance,imbalanceFormula:'(bidDepthUsd5-askDepthUsd5)/(bidDepthUsd5+askDepthUsd5)',imbalanceMeaning:'positive=greater resting bid depth; negative=greater resting ask depth; not trade flow'},recentTrades:{factId:'execution.recentTrades',recentTradedPrices:p.market.recentTradedPrices??[],windowSeconds:300,missingRecentTradeEvidence:!p.market.recentTradedPrices?.length},makerReachableBand1m:{min:Math.min(bandA,bandB),max:Math.max(bandA,bandB)}};
  const reference=(name:'btc'|'eth')=>{const m=refs[name];return m?{symbol:m.symbol,quote:{last:m.quote?.last,mark:m.quote?.mark,change24hPercent:m.quote?.priceChangePercent24h,ts:m.quote?.ts},technical:technicalFacts(m.technical,referenceFrames,p.createdAt,name)}:{missing:true};};
  return {contract:'V3.9.3-AUTONOMOUS-DIRECTION-SIZING',MARKET_FACTS:{symbol:symbolFacts,BTC:reference('btc'),ETH:reference('eth'),economics:{factId:'economics.entry',unit:'BPS',...p.economic},portfolio:{factId:'portfolio.context',...p.portfolio},experience:{factId:'experience.context',...p.experience},externalContext:(p as any).externalContext??[]},EXECUTION_ENVELOPE:{...envelope,notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.'},validFactIds:compactFactIds(p)};
}

export function buildCompactBrainPrompt(packet:EntryIntelligencePacket,confirmation?:unknown,_externalContext?:unknown,scout?:ScoutAnnotation|null):string {
  const facts=compactEntryFacts(packet);
  return `You are the single autonomous Entry Primary under protocol V3.9.3. Use only the supplied MARKET_FACTS and EXECUTION_ENVELOPE. You have no tools and no order-write permission.
EXECUTION FACTS ARE NOT MARKET SIGNALS. Capacity asymmetry, leverage, margin, maxNotional, maxQuantityUnits, position slots, permissions and risk headroom may constrain execution but MUST NOT select LONG or SHORT.
Independently test BOTH LONG and SHORT hypotheses from MARKET_FACTS. 15m is the tactical focus, not a direction command. 1m/5m are timing evidence. 1h/4h/1d/1w are context. BTC and ETH reference markets are evidence only. Evaluate EMA, MACD, Bollinger, ATR, volume, swing/HH/HL/LH/LL, order book, recent trades and derivatives without treating any derived trend label as an answer key.
Return exactly one unfenced JSON object matching the provided schema. For PLACE_LONG or PLACE_SHORT you must autonomously choose tradeSide, quantityUnits, idealPrice, acceptablePriceRange, horizonMinutes and profitTakePlan. quantity = quantityUnits * EXECUTION_ENVELOPE.exchange.stepSize. quantityUnits must be a positive integer no greater than the chosen side maxQuantityUnits. Do not choose direction because one side has more capacity.
For PLACE, idealPrice must be inside acceptablePriceRange and the range must remain compatible with objective maker reachability. If your independently chosen side has zero executable capacity, do not flip to the other side merely because it is executable; return a non-PLACE decision and state the execution conflict.
Deterministic opportunity evidence is NON_AUTHORITATIVE about direction and cannot veto or flip your side. It may support timing/location only when it matches your independently chosen side. Scout content is also non-authoritative.
Cite supplied fact IDs in supportingEvidenceRefs. State at least one material counterpoint. Never expose hidden reasoning; provide concise conclusions and evidence references only. Never invent evidence, prices, permissions, fills or probabilities. entryInvalidation is ENTRY_ONLY and never authorizes a close, reversal, market order or risk expansion.
${scout?`SCOUT_FACTS_NON_AUTHORITATIVE:${JSON.stringify(scout)}\n`:''}INPUT:${JSON.stringify(facts)}${confirmation?`\nPREVIOUS_WAIT_RECONFIRMATION:${JSON.stringify(confirmation)}\nReassess from fresh facts; the previous decision is context, not authorization or direction.`:''}`;
}

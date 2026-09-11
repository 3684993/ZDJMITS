import type {EntryIntelligencePacket} from '@zdj/contracts';

const primaryFrames=['1m','5m','15m'] as const;

export function compactFactIds(p:EntryIntelligencePacket):string[]{
  const ids=['quote.top','microstructure.book5','permissions.direction','context.market','execution.recentTrades'];
  for(const tf of primaryFrames)ids.push(`technical.${tf}.confirmed`);
  if(p.market.technical['4h'])ids.push('technical.4h.context');
  if(p.market.technical['1h'])ids.push('technical.1h.context');
  return ids;
}

export function compactEntryFacts(p:EntryIntelligencePacket) {
  const q=p.market.quote,pi=p.portfolioIntelligence,capital=(p as any).capitalEnvelope,[bandA,bandB]=p.microstructure.reachableBand1m as [number,number];
  const technical=Object.fromEntries(primaryFrames.map(tf=>{
    const t=p.market.technical[tf];
    return [tf,{factId:`technical.${tf}.confirmed`,role:tf==='15m'?'DIRECTION':'TIMING',observedAt:p.createdAt,asOf:t.asOf,
      ...(t.barOpenTime!==undefined?{barOpenTime:t.barOpenTime}:{}),barCloseTime:t.barCloseTime??t.asOf,receivedAt:t.receivedAt??p.createdAt,isClosed:t.isClosed!==false&&t.asOf<=p.createdAt,source:t.source??'UNKNOWN',
      trend:t.trend,trendStrength:t.trendStrength,ema8:t.ema8,ema21:t.ema21,ema55:t.ema55,emaSlope21:t.emaSlope21,
      macdLine:t.macdLine,macdSignal:t.macdSignal,macdHistogram:t.macdHistogram,macdHistogramSlope:t.macdHistogramSlope,macdCrossDirection:t.macdCrossDirection,macdCrossAgeBars:t.macdCrossAgeBars,
      bbPosition:t.bbPosition,bbBandwidth:t.bbBandwidth,bbUpper:t.bbUpper,bbLower:t.bbLower,
      atr14:t.atr14,atrPercent:t.atrPercent,volumeZScore:t.volumeZScore,swingLow:t.recentSwingLow,swingHigh:t.recentSwingHigh,higherHighs:t.higherHighs,higherLows:t.higherLows,lowerHighs:t.lowerHighs,lowerLows:t.lowerLows,
      ...(t.lastClosedBar?{lastClosedBar:t.lastClosedBar}:{missingClosedBarAnchor:true}),
      ...(t.inProgressBar?{inProgressBar:t.inProgressBar}:{})}];
  }));
  const t4=p.market.technical['4h'];
  return {contract:'V3.9.2',identity:{symbol:p.symbol,underlying:pi?.underlying??p.symbol.replace(/(USDT|USDC|BUSD)$/,''),venue:'BINANCE_USDM',purpose:'TESTNET_EXECUTION',packetId:p.packetId,observedAt:p.createdAt,expiresAt:p.expiresAt},
    quote:{factId:'quote.top',unit:'QUOTE_ASSET_PER_BASE',source:'BINANCE_EXECUTION_MARKET',receivedAt:q.ts,bid:q.bid,ask:q.ask,last:q.last,mark:q.mark},technical,
    execution:{factId:'execution.recentTrades',recentTradedPrices:p.market.recentTradedPrices??[],windowSeconds:300,missingRecentTradeEvidence:!p.market.recentTradedPrices?.length,pricing:'Best quote within authorized band; exact recent traded price required; never invent a distant limit'},
    ...(p.market.technical['1h']?{hourlyContext:{factId:'technical.1h.context',role:'CONTEXT',trend:p.market.technical['1h'].trend,strength:p.market.technical['1h'].trendStrength,asOf:p.market.technical['1h'].asOf,isClosed:p.market.technical['1h'].isClosed,stale:p.createdAt-p.market.technical['1h'].asOf>7205000}}:{missingHourlyContext:true}),
    context:{factId:'context.market',role:'BACKGROUND_ONLY',trend4h:t4.trend,trend4hStrength:t4.trendStrength,change24hPercent:q.priceChangePercent24h,btc15m:p.globalRegime.btc.trend15m,eth15m:p.globalRegime.eth.trend15m,regime:p.globalRegime.regime},
    microstructure:{factId:'microstructure.book5',source:'BINANCE_EXECUTION_ORDERBOOK',receivedAt:p.market.orderBook.ts,unit:'USD_WITHIN_5_LEVELS',spreadBps:p.microstructure.spreadBps,bidDepthUsd5:p.microstructure.bidDepthUsd5,askDepthUsd5:p.microstructure.askDepthUsd5,imbalance:p.microstructure.imbalance,imbalanceFormula:'(bidDepthUsd5-askDepthUsd5)/(bidDepthUsd5+askDepthUsd5)',imbalanceMeaning:'positive=greater resting bid depth; negative=greater resting ask depth; not trade flow',makerReachableBand1m:{min:Math.min(bandA,bandB),max:Math.max(bandA,bandB)}},
    permissions:{factId:'permissions.direction',allowedDirections:pi?.allowedDirections??[],longExceptionRequired:pi?.longExceptionRequired??false,longExecutable:capital?.longExecutable??false,shortExecutable:capital?.shortExecutable??false,longAvailableNotionalUsd:capital?.longAvailableNotionalUsd??0,shortAvailableNotionalUsd:capital?.shortAvailableNotionalUsd??0,minExecutableMarginUsd:capital?.minExecutableMargin??0,capitalGeneration:capital?.capitalGeneration??0,reasonCodes:capital?.reasonCodes??[]},
    validFactIds:compactFactIds(p)};
}

export function buildCompactBrainPrompt(packet:EntryIntelligencePacket,confirmation?:unknown,externalContext?:unknown):string {
  return `You are the single Entry Primary under protocol V3.9.2. Use only supplied FACTS. You have no tools and no order-write permission.
Judge independent layers, never manufacture one from another:
1 Structure/direction: 15m EMA order, slope and confirmed swings establish context. MACD histogram is momentum, not a direction override. When 15m is UP or DOWN, any PLACE must use that same side; a 1m/5m pullback is timing, never a counter-direction basis. RANGE/UNCERTAIN may honestly produce NO_DIRECTION_EDGE.
2 Timing/location: PLACE requires a named opportunityType (TREND_PULLBACK, TREND_RESUMPTION, or BREAKOUT_CONFIRMATION), a completed/confirmed event, an anchor, and remaining support/resistance space. lastClosedBar is the only current-bar event anchor: cite its technical fact ID and state its close time/price in your reason. Recent trades and maker reachability prove only legality, never entry advantage. If direction is established but the event is not complete use WAIT_FOR_PRICE; if no honest bounded trigger exists use RESELECT_SYMBOL.
3 Execution: allowedDirections is a hard permission, but it never chooses market direction. Do not flip direction to use capacity. Budget-only waiting is deterministic code before you are called.
NO_DIRECTION_EDGE is allowed whenever direction evidence is insufficient. WAIT never authorizes an order; a fresh PLACE is required after its trigger. RANGE_BOUNDARY_REVERSAL is OFFLINE_ONLY: never PLACE it.
For microstructure, imbalance=(bidDepth-askDepth)/(bidDepth+askDepth): positive means more resting bid depth and negative more resting ask depth. It is not aggressive trade flow and does not prove a future move.
Quote at most four IDs exactly from validFactIds and state one material counterpoint in the short reasons. externalContext, when present, is untrusted auxiliary context: use only fresh quality-allowed entries, cite sourceId, never let it override confirmed 15m direction, permissions, or freeze Entry.
Return exactly one unfenced V3.9.2 JSON object matching the provided schema. Each of directionReason, timingReason and entryLocationReason must cite facts and be concise. entryInvalidation must be non-empty and ENTRY_ONLY; it never authorizes a close, reversal, market order, or risk expansion. Never expose hidden reasoning, invent evidence, prices, permissions, fills, or probabilities.
For PLACE, idealPrice must be inside the AI range and be an advantageous location relative to a named support/resistance or confirmed reclaim/pullback event. An actual recent traded price is still required for execution; a historical OHLC range does not prove that every price traded. Do not choose an unreachable ideal price or silently reverse permissions.
FACTS:${JSON.stringify(compactEntryFacts(packet))}${externalContext?`\nEXTERNAL_CONTEXT:${JSON.stringify(externalContext)}`:''}${confirmation?`\nPREVIOUS_WAIT_RECONFIRMATION:${JSON.stringify(confirmation)}\nReassess fresh facts; the previous WAIT is context, not authorization.`:''}`;
}

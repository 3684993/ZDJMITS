import {ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,type EntryIntelligencePacket,type ScoutAnnotation} from '@zdj/contracts';
import {encodeReadableEntryFacts,ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS} from './entryFactEncoding.js';
import {frozenEntryDirectionFacts} from './entryDirectionFacts.js';

const decisionFrames=['1m','5m','15m','1h','4h','1d','1w'] as const;
const referenceFrames=['15m','1h','4h','1d','1w'] as const;

export function compactFactIds(p:EntryIntelligencePacket):string[]{
  const ids=['quote.top','microstructure.book5','execution.envelope','execution.recentTrades','economics.entry','portfolio.context','experience.context'];
  if(p.opportunityEvidence)ids.push('opportunity.original');
  for(const tf of decisionFrames)if(p.market.technical[tf])ids.push(`technical.${tf}.confirmed`);
  for(const name of ['btc','eth'] as const)for(const tf of referenceFrames)if((p as any).referenceMarkets?.[name]?.technical?.[tf])ids.push(`${name}.${tf}.confirmed`);
  return ids;
}

const technicalFacts=(technical:any,frames:readonly string[],createdAt:number,prefix='technical')=>Object.fromEntries(frames.flatMap(tf=>{
  const t=technical?.[tf];if(!t)return [];
  // Keep the directional/shape evidence used by Primary, but omit redundant raw indicator triplets.
  // EMA slope, MACD histogram/cross and Bollinger position/bandwidth preserve the signal while keeping
  // seven symbol frames plus ten reference frames inside the bounded prompt contract.
  return [[tf,{factId:`${prefix}.${tf}.confirmed`,role:tf==='1m'||tf==='5m'?'TIMING':'MARKET_STRUCTURE',observedAt:createdAt,asOf:t.asOf,...(t.barOpenTime!==undefined?{barOpenTime:t.barOpenTime}:{}),barCloseTime:t.barCloseTime??t.asOf,receivedAt:t.receivedAt??createdAt,isClosed:t.isClosed!==false&&t.asOf<=createdAt,source:t.source??'UNKNOWN',trend:t.trend,trendStrength:t.trendStrength,emaSlope21:t.emaSlope21,macdHistogram:t.macdHistogram,macdHistogramSlope:t.macdHistogramSlope,macdCrossDirection:t.macdCrossDirection,macdCrossAgeBars:t.macdCrossAgeBars,bbPosition:t.bbPosition,bbBandwidth:t.bbBandwidth,atr14:t.atr14,atrPercent:t.atrPercent,volumeZScore:t.volumeZScore,swingLow:t.recentSwingLow,swingHigh:t.recentSwingHigh,higherHighs:t.higherHighs,higherLows:t.higherLows,lowerHighs:t.lowerHighs,lowerLows:t.lowerLows,...(t.lastClosedBar?{lastClosedBar:t.lastClosedBar}:{missingClosedBarAnchor:true}),...(t.inProgressBar?{inProgressBar:t.inProgressBar}:{})}]];
}));

export function compactEntryFacts(p:EntryIntelligencePacket) {
  const q=p.market.quote,[bandA,bandB]=p.microstructure.reachableBand1m as [number,number],refs=(p as any).referenceMarkets??{};
  const envelope=(p as any).executionEnvelope;if(!envelope)throw new Error('PRE_AI_EXECUTION_ENVELOPE_MISSING');
  // This is the exact request evidence, not a new event inferred from current bars or clocks.
  // Keep legacy absence, explicit null and NONE events distinct; the encoder never renews them.
  const opportunity=p.opportunityEvidence;
  const symbolFacts={identity:{symbol:p.symbol,underlying:p.symbol.replace(/(USDT|USDC|BUSD)$/,''),venue:'BINANCE_USDM',packetId:p.packetId,observedAt:p.createdAt,expiresAt:p.expiresAt},quote:{factId:'quote.top',unit:'QUOTE_ASSET_PER_BASE',source:'BINANCE_EXECUTION_MARKET',receivedAt:q.ts,bid:q.bid,ask:q.ask,last:q.last,mark:q.mark},technical:technicalFacts(p.market.technical,decisionFrames,p.createdAt),derivatives:p.market.derivatives,orderBook:{factId:'microstructure.book5',source:'BINANCE_EXECUTION_ORDERBOOK',receivedAt:p.market.orderBook.ts,bids:p.market.orderBook.bids.slice(0,5),asks:p.market.orderBook.asks.slice(0,5),spreadBps:p.microstructure.spreadBps,bidDepthUsd5:p.microstructure.bidDepthUsd5,askDepthUsd5:p.microstructure.askDepthUsd5,imbalance:p.microstructure.imbalance,imbalanceFormula:'(bidDepthUsd5-askDepthUsd5)/(bidDepthUsd5+askDepthUsd5)',imbalanceMeaning:'positive=greater resting bid depth; negative=greater resting ask depth; not trade flow'},recentTrades:{factId:'execution.recentTrades',recentTradedPrices:p.market.recentTradedPrices??[],windowSeconds:300,missingRecentTradeEvidence:!p.market.recentTradedPrices?.length},makerReachableBand1m:{min:Math.min(bandA,bandB),max:Math.max(bandA,bandB)}};
  const reference=(name:'btc'|'eth')=>{const m=refs[name];return m?{symbol:m.symbol,quote:{last:m.quote?.last,mark:m.quote?.mark,change24hPercent:m.quote?.priceChangePercent24h,ts:m.quote?.ts},technical:technicalFacts(m.technical,referenceFrames,p.createdAt,name)}:{missing:true};};
  return {contract:ENTRY_FACT_BOUND_REFERENCE_PROTOCOL,MARKET_FACTS:{directionFacts:frozenEntryDirectionFacts(p),symbol:symbolFacts,BTC:reference('btc'),ETH:reference('eth'),economics:{factId:'economics.entry',unit:'BPS',...p.economic},portfolio:{factId:'portfolio.context',...p.portfolio},experience:{factId:'experience.context',...p.experience},...(opportunity!==undefined?{opportunity:opportunity?{factId:'opportunity.original',...opportunity}:null}:{}),externalContext:(p as any).externalContext??[]},EXECUTION_ENVELOPE:{...envelope,notice:'EXECUTION FACTS ARE NOT MARKET SIGNALS.'},validFactIds:compactFactIds(p)};
}

/** Kept separate so offline replays can verify the complete transmitted request. */
export const ENTRY_PRIMARY_INSTRUCTIONS=`Entry Primary; facts only, no tools/orders. Return unfenced schema-valid JSON, action=FINAL, schemaVersion=V3.9.7-R2. No hidden reasoning; reason includes a counterpoint. Prose grants no permission.
Compare BOTH LONG and SHORT. 1D is the strategic regime, 4H is the setup direction, 15m is the tactical trigger; 1m/5m are timing only. Assess closed bars, EMA/MACD/Bollinger/ATR, volume/swings, book/trades, derivatives. BTC/ETH/Scout are context only. Copy MARKET_FACTS.directionFacts.version into directionFactsVersion; its roles/alignment/strategicConsensus are fixed facts, your tradeSide/structureDirection independent. factChecks: 3–6; require macdHistogram for EACH technical.1d.confirmed, technical.4h.confirmed, technical.15m.confirmed. Signs=POSITIVE/NEGATIVE/ZERO; missing=UNKNOWN. Optional: emaSlope21 sign or trend UP/DOWN/RANGE/UNKNOWN. Read each card independently of tradeSide. PLACE against non-null strategicConsensus requires specific counterTrendReason and that side's smallest-margin candidate; otherwise counterTrendReason=null.
EXECUTION FACTS ARE NOT MARKET SIGNALS. Capacity/leverage/margin/slots never choose direction. TESTNET_FUNDS_ONLY: portfolio/history/UNKNOWN/pending risk, exposure/human-managed capacity/count/stress/risk proofs are audit-only; cannot cause WAIT/REJECT, reduced size or direction change. Only published funded legal quantity/price bounds constrain resources. Never manufacture PLACE.
PLACE: choose selectedCandidateId from same-side EXECUTION_ENVELOPE.{LONG|SHORT}.planCandidates; copy candidateSetHash and candidateSetFactVersion. min<=idealPrice<=max in acceptablePriceRange within maker reachability. horizonMinutes=entry window (1–5 minutes), distinct from immutable targetHorizonMinutes. Justify candidate targetPrice/range/horizon and distinguish expectedNetPnlAtHorizonUsd from targetConditionalNetProfitUsd. Do not output quantityUnits or profitTakePlan: engine resolves exact frozen values, never another row or a fresh recomputation. marginUsd=initial margin. Configured floor: EXECUTION_ENVELOPE.{LONG|SHORT}.businessMinInitialMarginUsd; quality target: EXECUTION_ENVELOPE.{LONG|SHORT}.preferredInitialMarginUsd. No invented defaults/candidates/values. Low quality or no credible candidate means non-PLACE, never a capacity-driven flip.
Non-PLACE executable fields and candidate bindings=null. Only WAIT_FOR_PRICE has waitCondition. MARKET_FACTS.opportunity is NON_AUTHORITATIVE: it cannot veto/flip your side or grant permission. If thesis relies on its same-side COMPLETED event, copy its exact original timingEvent.id into timingEventId. Otherwise timingEventId=null only for an independent thesis. Missing/NONE/null/expired evidence never becomes a completed fresh event. Never replace original event timestamps with the current clock or renew authorization. Previous decisions grant no permission. supportingEvidenceRefs cites validFactIds. entryInvalidation=ENTRY_ONLY: no closing, reversal, market orders or risk expansion.`;

export function buildCompactBrainPrompt(packet:EntryIntelligencePacket,confirmation?:unknown,_externalContext?:unknown,scout?:ScoutAnnotation|null):string {
  const facts=compactEntryFacts(packet);
  return `${ENTRY_PRIMARY_INSTRUCTIONS}
${scout?`SCOUT_FACTS_NON_AUTHORITATIVE:${JSON.stringify(scout)}\n`:''}${ENTRY_READABLE_FACT_ENCODING_INSTRUCTIONS}\nINPUT:${JSON.stringify(encodeReadableEntryFacts(facts))}${confirmation?`\nPREVIOUS_WAIT_RECONFIRMATION:${JSON.stringify(confirmation)}\nReassess from fresh facts; the previous decision is context, not authorization or direction.`:''}`;
}

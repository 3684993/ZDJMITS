import {createHash} from 'node:crypto';
import {TradingQualityPolicySchema, type TradingQualityPolicy, type OpportunityEvidence, type MarketSymbolSnapshot, type SystemSettings} from '@zdj/contracts';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export const qualityPolicy=(settings:SystemSettings)=>TradingQualityPolicySchema.parse(settings.tradingQuality??{});

/** Only closed, received, internally consistent bars may create an event. */
function closed(card:any,now:number,period:number){
  const b=card?.lastClosedBar;
  return Boolean(card?.isClosed===true&&b&&positive(b.close)&&positive(b.low)&&positive(b.high)&&positive(b.open)&&
    b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close)&&b.openTime<b.closeTime&&
    b.closeTime===card.barCloseTime&&b.closeTime<=now&&now-b.closeTime<=period+10000&&
    (!card.receivedAt||card.receivedAt<=now));
}

/** Deterministic opportunity evidence is execution/timing evidence, never an AI direction answer. */
export function buildOpportunityEvidence(m:MarketSymbolSnapshot,settings:SystemSettings,now=Date.now()):OpportunityEvidence {
  const p=qualityPolicy(settings),t=m.technical['15m'],direction=t?.trend==='UP'?'LONG':t?.trend==='DOWN'?'SHORT':null;
  const sign=direction==='LONG'?1:-1,blockers:string[]=[],freshStructure=closed(t,now,900000);
  if(!direction)blockers.push('NO_15M_STRUCTURE_HINT');
  if(!freshStructure||!positive(t?.atr14))blockers.push('STRUCTURE_UNVERIFIED');
  const structureAnchor=freshStructure&&positive(t?.atr14)&&direction?{barCloseTime:t.barCloseTime!,price:t.ema21,target:direction==='LONG'?t.recentSwingHigh:t.recentSwingLow}:null;
  let timingEvent:OpportunityEvidence['timingEvent']={id:'NONE',status:'NONE',time:null,anchorPrice:null,timeframe:null,provenance:'CLOSED_BAR_RECLAIM_V1'};
  let setupType:OpportunityEvidence['setupType']='NONE';
  for(const [tf,period] of [['1m',60000],['5m',300000]] as const){
    const card=m.technical[tf],bar=card?.lastClosedBar;
    if(!direction||!closed(card,now,period)||!bar||!positive(card.ema8))continue;
    const completed=direction==='LONG'?bar.low<=card.ema8&&bar.close>card.ema8&&bar.close>bar.open:
      bar.high>=card.ema8&&bar.close<card.ema8&&bar.close<bar.open;
    if(completed&&now-bar.closeTime<p.eventTtlMs){
      setupType='TREND_PULLBACK';
      timingEvent={id:`reclaim_${tf}_${bar.closeTime}_${hash(bar).slice(0,16)}`,status:'COMPLETED',time:bar.closeTime,anchorPrice:bar.close,timeframe:tf,provenance:`technical.${tf}.confirmed`};break;
    }
  }
  if(timingEvent.status!=='COMPLETED')blockers.push('TIMING_EVENT_NOT_COMPLETED');
  const target=structureAnchor&&positive(structureAnchor.target)?structureAnchor.target:null,anchor=timingEvent.anchorPrice;
  const atr=positive(t?.atr14)?t.atr14:null,px=direction==='LONG'?m.quote.bid:m.quote.ask;
  const costs={entryFeeBps:settings.takeProfit.makerFeeRate*10000,exitFeeBps:settings.takeProfit.takerFeeRate*10000,
    bufferBps:settings.takeProfit.slippageBufferPct*100+(settings.takeProfit.makerFeeRate+settings.takeProfit.takerFeeRate)*10000*settings.takeProfit.feeSafetyBufferPct/100};
  const executablePriceBand=anchor&&atr?{min:Math.max(m.quote.tickSize,anchor-atr*p.maxLocationAtr),max:anchor+atr*p.maxLocationAtr}:null;
  const payoffSpaceBps=direction&&target&&positive(px)?sign*(target/px-1)*10000:null;
  if(!target||payoffSpaceBps===null||payoffSpaceBps<=costs.entryFeeBps+costs.exitFeeBps+costs.bufferBps+p.minNetSpaceBps)blockers.push('PAYOFF_INSUFFICIENT');
  if(!executablePriceBand||px<executablePriceBand.min||px>executablePriceBand.max)blockers.push('LOCATION_OUTSIDE_BAND');
  if(!positive(px)||m.quote.bid>m.quote.ask||now-m.quote.ts>15000||m.quote.ts>now||now-m.orderBook.ts>15000||m.orderBook.ts>now)blockers.push('EXECUTION_DATA_STALE');
  const structuralKey={symbol:m.symbol,direction,structureAnchor};
  const materialFactFingerprint=hash({structuralKey,timingEvent,executablePriceBand,costs,policy:p});
  return {opportunityId:`opp_${hash({...structuralKey,event:timingEvent.id}).slice(0,32)}`,version:materialFactFingerprint,policyVersion:p.policyVersion,
    symbol:m.symbol,direction,setupType,structureAnchor,timingEvent,eventTtlMs:p.eventTtlMs,authorizationTtlMs:p.authorizationTtlMs,
    positionObservationHorizonMs:p.positionObservationHorizonMs,locationFacts:{distanceAtr:anchor&&atr?sign*(px-anchor)/atr:null,atr},
    executablePriceBand,structuralTarget:target,payoffSpaceBps,costs,disposition:blockers.length?(direction&&freshStructure?'WAIT':'REJECT'):'ALLOW',blockers,
    releaseCondition:'FRESH_CLOSED_RECLAIM_AND_PRICE_IN_BAND_WITH_POSITIVE_NET_SPACE',observedAt:now,
    expiresAt:Math.min(now+p.authorizationTtlMs,(timingEvent.time??now)+p.eventTtlMs),
    eventExpiresAt:timingEvent.time===null?null:timingEvent.time+p.eventTtlMs,materialFactFingerprint};
}

/** Shared by first submit, execution waiting and every replacement. Never renews an old TTL. */
export function revalidateOpportunity(e:OpportunityEvidence|undefined,m:MarketSymbolSnapshot,settings:SystemSettings,price:number,now=Date.now(),quantity?:number):string|null{
  if(!e)return'OPPORTUNITY_MISSING';
  const p=qualityPolicy(settings);
  if(e.symbol!==m.symbol||e.policyVersion!==p.policyVersion)return'OPPORTUNITY_POLICY_OR_SYMBOL_CHANGED';
  if(now<e.observedAt||now>=e.expiresAt||e.timingEvent.time===null||now>=e.timingEvent.time+e.eventTtlMs)return'OPPORTUNITY_EXPIRED';
  const current=buildOpportunityEvidence(m,settings,now);
  const sealed=hash({structuralKey:{symbol:e.symbol,direction:e.direction,structureAnchor:e.structureAnchor},timingEvent:e.timingEvent,executablePriceBand:e.executablePriceBand,costs:e.costs,policy:p});
  if(sealed!==e.version||current.opportunityId!==e.opportunityId||current.materialFactFingerprint!==e.materialFactFingerprint||current.version!==e.version)return'OPPORTUNITY_MATERIAL_CHANGE';
  if(current.blockers.includes('EXECUTION_DATA_STALE'))return'OPPORTUNITY_EXECUTION_DATA_STALE';
  if(e.disposition!=='ALLOW'||e.timingEvent.status!=='COMPLETED')return'OPPORTUNITY_NOT_ALLOWED';
  if(!positive(price)||!e.executablePriceBand||price<e.executablePriceBand.min||price>e.executablePriceBand.max)return'OPPORTUNITY_PRICE_OUTSIDE_BAND';
  const space=e.structuralTarget?(e.direction==='LONG'?1:-1)*(e.structuralTarget/price-1)*10000:null;
  if(space===null||space<=e.costs.entryFeeBps+e.costs.exitFeeBps+e.costs.bufferBps+p.minNetSpaceBps)return'OPPORTUNITY_PAYOFF_INSUFFICIENT';
  if(quantity!==undefined){
    const levels=e.direction==='LONG'?m.orderBook.asks:m.orderBook.bids;
    const depth=levels.slice(0,5).reduce((sum,l)=>sum+l[0]*l[1],0);
    if(!positive(quantity)||!positive(depth)||quantity*price>depth)return'OPPORTUNITY_DEPTH_INSUFFICIENT';
  }
  return null;
}

/** A deterministic side mismatch is execution-evidence absence, not an invalid AI decision. */
export function validateOpportunityDecision(d:any,e:OpportunityEvidence):string|null{
  if(!String(d.decision).startsWith('PLACE_'))return null;
  if(d.tradeSide!==e.direction)return null;
  if(e.disposition!=='ALLOW'||d.opportunityType!==e.setupType)return'PRIMARY_OPPORTUNITY_MISMATCH';
  if(JSON.stringify(d.timingEvent)!==JSON.stringify(e.timingEvent)){
    if(!d.timingEvent||Object.entries(e.timingEvent).some(([k,v])=>d.timingEvent[k]!==v))return'PRIMARY_EVENT_NOT_VERIFIED';
  }
  const b=d.acceptablePriceRange;
  if(!b||!e.executablePriceBand||b.min<e.executablePriceBand.min||b.max>e.executablePriceBand.max)return'PRIMARY_BAND_OUTSIDE_OPPORTUNITY';
  return null;
}

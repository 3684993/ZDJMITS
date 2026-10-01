import { createHash } from 'node:crypto';
import { EntryEconomicMandateSchema, type EntryEconomicMandate, type TradePlan } from '@zdj/contracts';
import { evaluateTargetReachability } from './historicalTpReachability.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const direction = (value: unknown): 'UP'|'DOWN'|'RANGE'|'UNKNOWN' => value === 'UP' || value === 'DOWN' || value === 'RANGE' ? value : 'UNKNOWN';
const freshness: Record<'1d'|'4h'|'15m', number> = { '1d': 26*60*60_000, '4h': 5*60*60_000, '15m': 20*60_000 };

export function buildEntryEconomicMandate(input: {
  plan: TradePlan;
  environment: string;
  quoteAsset: string;
  minimumInitialMarginQuote: number;
  minimumOrderNotionalQuote: number;
  quoteFxToUsd: {rate:number;observedAt:number;source:string}|null;
  exchangeMinimumNotionalQuote: number;
  settingsVersion: number;
  entryFeeRate: number;
  exitFeeRate: number;
  slippageBufferPct: number;
  market: any;
  candles: (timeframe: '1m'|'5m'|'15m', limit: number) => any[];
  now: number;
}): EntryEconomicMandate {
  if (input.environment !== 'TESTNET') throw new Error('V397_ECONOMIC_MANDATE_TESTNET_ONLY');
  const timeframeFacts = (['1d','4h','15m'] as const).map(timeframe => {
    const card = input.market?.technical?.[timeframe];
    const bar = card?.lastClosedBar;
    const closedAt = Number.isFinite(Number(bar?.closeTime)) && Number(bar.closeTime) <= input.now ? Number(bar.closeTime) : null;
    const facts = bar && closedAt !== null ? { openTime: bar.openTime, closeTime: bar.closeTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close } : null;
    const age = closedAt === null ? null : input.now-closedAt;
    return { timeframe, closedAt, direction: direction(card?.trend), status: closedAt === null ? 'MISSING' as const : age! > freshness[timeframe] ? 'STALE' as const : 'FRESH' as const,
      evidenceHash: facts ? hash(facts) : null };
  });
  if(timeframeFacts.some(fact=>fact.status!=='FRESH'))throw new Error('ENTRY_DIRECTION_FACTS_NOT_FRESH');
  const plan = input.plan;
  if(input.quoteAsset==='USDC'&&(!input.quoteFxToUsd||input.now-input.quoteFxToUsd.observedAt>60_000||input.quoteFxToUsd.observedAt>input.now))throw new Error('ENTRY_USDC_FX_NOT_PROVEN');
  const sizing = { minimumInitialMarginQuote: input.minimumInitialMarginQuote, minimumOrderNotionalQuote: input.minimumOrderNotionalQuote,
    exchangeMinimumNotionalQuote: input.exchangeMinimumNotionalQuote, selectedInitialMarginQuote: plan.marginUsd,
    selectedNotionalQuote: plan.notionalUsd, quantityUnits: plan.quantityUnits,
    quantity: plan.quantityUnits*Number(input.market.quote.stepSize), leverage: plan.leverage,
    entryPrice: Number(plan.entryReferencePrice), stepSize: Number(input.market.quote.stepSize), priceTick: Number(input.market.quote.tickSize) };
  const targetMovePercent = Math.abs(Number(plan.targetPrice)/Number(plan.entryReferencePrice)-1)*100;
  const oneHour = evaluateTargetReachability({ rows: input.candles('5m', 300), side: plan.side as 'LONG'|'SHORT', horizonMinutes: 60,
    targetMovePercent, lookbackBars: 120, minSamples: 30, now: input.now });
  const factsHash = hash({ schemaVersion: 'V397-ENTRY-ECONOMIC-MANDATE-1', planId: plan.planId, quoteAsset: input.quoteAsset,
    settingsVersion: input.settingsVersion, directionFacts: timeframeFacts, sizing, targetPrice: plan.targetPrice,
    targetHorizonMinutes: plan.targetHorizonMinutes, fees: [input.entryFeeRate,input.exitFeeRate,input.slippageBufferPct], quoteFxToUsd:input.quoteFxToUsd, costVersion: plan.costs?.costVersion });
  const fx = input.quoteFxToUsd?.rate ?? (input.quoteAsset==='USDT'?1:null);
  return EntryEconomicMandateSchema.parse({ schemaVersion:'V397-ENTRY-ECONOMIC-MANDATE-1',
    mandateId:`mandate_${hash({planId:plan.planId,factsHash}).slice(0,32)}`, environment:'TESTNET', quoteAsset:input.quoteAsset,
    settingsVersion:input.settingsVersion, factsHash, createdAt:input.now, expiresAt:Math.min(plan.provenance.envelopeExpiresAt,input.now+plan.entryTtlMinutes*60_000),
    side:plan.side, directionFacts:timeframeFacts, sizing,
    economics:{ entryFeeQuote:plan.costs?.entryFeeUsd??0, expectedExitFeeQuote:plan.costs?.exitFeeUsd??0,
      slippageBufferQuote:plan.costs?.slippageUsd??0, fundingQuote:plan.costs?.fundingEstimateUsd==null?null:plan.costs.fundingEstimateUsd/Number(fx??1),
      fundingStatus:plan.costs?.fundingStatus??'UNPROVEN', fxToUsd:fx,
      fxStatus:input.quoteAsset==='USDT'?'NOT_REQUIRED':fx===null?'UNPROVEN':'VERIFIED', minimumNetProfitQuote:plan.minNetProfitUsd/Number(fx??1),
      targetPrice:Number(plan.targetPrice), targetHorizonMinutes:plan.targetHorizonMinutes,
      targetConditionalNetQuote:plan.economics?.targetConditionalNetProfitUsd==null?null:plan.economics.targetConditionalNetProfitUsd/Number(fx??1),
      expectedNetQuote:plan.economics?.expectedNetPnlAtHorizonUsd==null?null:plan.economics.expectedNetPnlAtHorizonUsd/Number(fx??1),
      oneHourReachability:oneHour.reachProbability,
      oneHourReachabilityStatus:oneHour.status==='READY'?'VERIFIED':oneHour.status==='STALE'?'STALE':'INSUFFICIENT_SAMPLE',
      costVersion:plan.costs?.costVersion??'UNPROVEN' }, rationale:plan.thesis });
}

export function entryThesisFactsStillCurrent(mandate: EntryEconomicMandate, market: any, now=Date.now()) {
  return mandate.directionFacts.every(fact => {
    const card = market?.technical?.[fact.timeframe], bar = card?.lastClosedBar;
    if (!bar || !Number.isFinite(Number(bar.closeTime)) || Number(bar.closeTime) > now) return false;
    return Number(bar.closeTime) === fact.closedAt && direction(card?.trend)===fact.direction && hash({openTime:bar.openTime,closeTime:bar.closeTime,open:bar.open,high:bar.high,low:bar.low,close:bar.close}) === fact.evidenceHash;
  });
}

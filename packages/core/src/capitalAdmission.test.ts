import { describe, expect, it } from 'vitest';
import { PortfolioIntelligenceSettingsSchema } from '@zdj/contracts';
import { evaluateCapitalAdmission } from './capitalAdmission.js';

const p=PortfolioIntelligenceSettingsSchema.parse({});
const card=(last:number)=>({timeframe:'15m',asOf:Date.now(),sampleSize:80,lastPrice:last,trend:'RANGE',trendStrength:.4,ema8:last,ema21:last,ema55:last,emaSlope21:0,macdLine:0,macdSignal:0,macdHistogram:0,macdHistogramSlope:0,macdCrossDirection:'NONE',macdCrossAgeBars:0,bbUpper:last*1.02,bbMiddle:last,bbLower:last*.98,bbPosition:.5,bbBandwidth:.04,atr14:last*.005,atrPercent:.5,volumeZScore:0,recentSwingHigh:last*1.01,recentSwingLow:last*.99,higherHighs:2,higherLows:2,lowerHighs:1,lowerLows:1,freshnessMs:0});
const snap=(symbol:string)=>{const last=100;return{symbol,quote:{symbol,last,mark:last,bid:last-.01,ask:last+.01,tickSize:.01,stepSize:.01,minQty:.01,minNotional:5,quoteVolumeUsd24h:100_000_000,priceChangePercent24h:0,tradeCount24h:10000,ts:Date.now()},orderBook:{symbol,bids:[[99.99,100000]],asks:[[100.01,100000]],ts:Date.now()},derivatives:{symbol,openInterest:1_000_000,openInterestChange5m:0,openInterestChange15m:0,fundingRate:0,takerBuySellRatio5m:1,globalLongShortRatio:1,topTraderPositionRatio:1,ts:Date.now()},technical:{'1m':card(last),'5m':card(last),'15m':card(last),'4h':card(last),'1d':card(last),'1w':card(last)},dataCompleteness:1} as any;};
const candidate=(symbol='ETHUSDT')=>({symbol,rank:1,score:90,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:90,tradingActivity:90,capitalActivity:80,technicalOpportunity:80,executionReachability:90,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'ETH',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH',locationScore:80} as any);
const settings={portfolio:{entryMarginUsd:200},portfolioIntelligence:p} as any;
const assets=(usdt:number,usdc:number)=>[{asset:'USDT',availableBalance:usdt,usdValue:usdt},{asset:'USDC',availableBalance:usdc,usdValue:usdc}];

describe('Capital Admission pre-gate',()=>{
  it('uses the already-qualified USDC contract selected by Universe before AI when USDT is empty',()=>{const selected={...candidate('ETHUSDC'),quoteAsset:'USDC'};const result=evaluateCapitalAdmission({candidates:[selected],snapshots:[snap('ETHUSDT'),snap('ETHUSDC')],settings,positions:[],assets:assets(0,500),poolSymbols:new Set(['ETHUSDC'])});expect(result.summary.executableCandidateCount).toBe(1);expect(result.decisions[0]?.quoteAsset).toBe('USDC');expect(result.summary.usdcExecutableUnderlyings).toBe(1);});
  it('rejects the whole pool when both quote assets are empty',()=>{const result=evaluateCapitalAdmission({candidates:[candidate()],snapshots:[snap('ETHUSDT'),snap('ETHUSDC')],settings,positions:[],assets:assets(0,0)});expect(result.summary.executableCandidateCount).toBe(0);expect(result.summary.noUsdtMargin).toBeGreaterThan(0);});
  it('explains USDC balance without a usable same-underlying contract',()=>{const result=evaluateCapitalAdmission({candidates:[candidate()],snapshots:[snap('ETHUSDT')],settings,positions:[],assets:assets(0,500)});expect(result.summary.executableCandidateCount).toBe(0);expect(result.decisions[0]?.reason).toBe('NO_USDC_CONTRACT');});
  it('computes LONG and SHORT admission independently without a 15m direction prefilter',()=>{const result=evaluateCapitalAdmission({candidates:[candidate()],snapshots:[snap('ETHUSDT')],settings,positions:[],assets:assets(500,0)});expect(result.summary.routedCandidates[0]).toMatchObject({longExecutable:true,shortExecutable:true});expect(result.summary.routedCandidates[0]?.longRecommendedNotionalUsd).toBeGreaterThan(0);expect(result.summary.routedCandidates[0]?.shortRecommendedNotionalUsd).toBeGreaterThan(0);});
});

it('reports position capacity independently of sufficient quote balances',()=>{const positions=Array.from({length:14},(_,i)=>({symbol:`OLD${i}USDT`,side:'LONG' as const,quantity:.001,markPrice:1,leverage:1})),result=evaluateCapitalAdmission({candidates:[candidate()],snapshots:[snap('ETHUSDT')],settings:{...settings,portfolio:{...settings.portfolio,maxPositions:12}},positions,assets:assets(100000,100000)});expect(result.decisions[0]?.reason).toBe('POSITION_CAPACITY_FULL');expect(result.summary.reasonCounts.POSITION_CAPACITY_FULL).toBe(1);expect(result.decisions[0]?.longPlan?.reasons).toContain('MAX_POSITIONS');});

// §A: Entry funding is the product's own whitelist, so a quote leg the exchange happily reports as
// margin-eligible still cannot reserve, lease, route or size an Entry here.
describe('the Entry routing universe is only USDT and USDC', () => {
  const assets = (over: Record<string, number> = {}) => [
    {asset: 'USDT', availableBalance: 10_000, walletBalance: 10_000, usdValue: 10_000},
    {asset: 'USDC', availableBalance: 10_000, walletBalance: 10_000, usdValue: 10_000},
    {asset: 'BUSD', availableBalance: 10_000, walletBalance: 10_000, usdValue: 10_000},
    {asset: 'FDUSD', availableBalance: 10_000, walletBalance: 10_000, usdValue: 10_000},
    {asset: 'BTC', availableBalance: 5, walletBalance: 5, usdValue: 500_000}, ...[over]].filter(Boolean) as any[];
  const run = (symbol: string) => evaluateCapitalAdmission({candidates: [candidate(symbol)], snapshots: [snap(symbol)], settings: {portfolioIntelligence: p, portfolio: {maxPositions: 10}} as any,
    positions: [], assets: assets(), now: Date.now()});

  it.each(['ETHBUSD', 'BNBFDUSD'])('QA-12 refuses %s with its own named reason, not a margin shortage', (symbol) => {
    const {decisions, summary} = run(symbol);
    expect(decisions[0].executable).toBe(false);
    expect(decisions[0].reason).toBe('QUOTE_ASSET_NOT_ENTRY_ELIGIBLE');
    expect(summary.reasonCounts.QUOTE_ASSET_NOT_ENTRY_ELIGIBLE).toBe(1);
    // The BUSD/FDUSD balance is real and is not spent: those assets never enter the routing ledger.
    expect(summary.usdtAvailable).toBe(10_000);
    expect(summary.usdcAvailable).toBe(10_000);
    expect(JSON.stringify(summary)).not.toContain('BUSD');
  });

  it('QA-13 still routes an eligible USDT symbol with the same asset book', () => {
    const {decisions} = run('ETHUSDT');
    expect(decisions[0].executable, JSON.stringify(decisions[0])).toBe(true);
    expect(decisions[0].quoteAsset).toBe('USDT');
  });
});

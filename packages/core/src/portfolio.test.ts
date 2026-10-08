import { describe, expect, it } from 'vitest';
import { AllocationPlanSchema, PortfolioIntelligenceSettingsSchema } from '@zdj/contracts';
import { buildAllocationPlan, decorateUniverse, directionPolicy, locationScore, resolveUnderlying, routeContract, riskTier } from './portfolio.js';

const p=PortfolioIntelligenceSettingsSchema.parse({});
const card=(last:number,overrides:any={})=>({timeframe:'15m',asOf:Date.now(),sampleSize:80,lastPrice:last,trend:'RANGE',trendStrength:.6,ema8:last,ema21:last,ema55:last,emaSlope21:0,macdLine:0,macdSignal:0,macdHistogram:0,macdHistogramSlope:0,macdCrossDirection:'NONE',macdCrossAgeBars:0,bbUpper:last*1.02,bbMiddle:last,bbLower:last*.98,bbPosition:.5,bbBandwidth:.04,atr14:last*.005,atrPercent:.5,volumeZScore:0,recentSwingHigh:last*1.01,recentSwingLow:last*.99,higherHighs:2,higherLows:2,lowerHighs:1,lowerLows:1,freshnessMs:0,...overrides});
const snap=(symbol:string,overrides:any={})=>{const last=100;return{symbol,quote:{symbol,last,mark:last,bid:last-.01,ask:last+.01,tickSize:.01,stepSize:.01,minQty:.01,minNotional:5,quoteVolumeUsd24h:100_000_000,priceChangePercent24h:0,tradeCount24h:10000,ts:Date.now()},orderBook:{symbol,bids:[[99.99,100000]],asks:[[100.01,100000]],ts:Date.now()},derivatives:{symbol,openInterest:1_000_000,openInterestChange5m:0,openInterestChange15m:0,fundingRate:0,takerBuySellRatio5m:1,globalLongShortRatio:1,topTraderPositionRatio:1,ts:Date.now()},technical:{'1m':card(last),'5m':card(last),'15m':card(last),'4h':card(last),'1d':card(last),'1w':card(last)},dataCompleteness:1,...overrides} as any;};
// riskGovernance is present on every real SystemSettings, so the fixture carries it: the direction veto has
// exactly one authority, and tests that want another policy say so explicitly.
const settings={portfolio:{entryMarginUsd:200},portfolioIntelligence:p,riskGovernance:{maxDirectionExposurePct:.5,exposureCapacityPolicy:{gross:'ENFORCE',direction:'ENFORCE',cluster:'ENFORCE'}}} as any;
const governed=(over:Record<string,any>={})=>({riskGovernance:{maxDirectionExposurePct:over.directionPct??.5,exposureCapacityPolicy:{gross:over.grossMode??'ENFORCE',direction:over.directionMode??'ENFORCE',cluster:'ENFORCE'}}});

describe('Portfolio Intelligence',()=>{
  it('resolves underlyings and routes USDT=0 to a healthy USDC contract',()=>{expect(resolveUnderlying('ETHUSDT')).toBe('ETH');expect(resolveUnderlying('ETHUSDC')).toBe('ETH');const usdc=snap('ETHUSDC'),usdt=snap('ETHUSDT');const selected=routeContract('ETH',[usdt,usdc],{...p,quoteAssetPolicy:'AUTO'},[{asset:'USDT',availableBalance:0,usdValue:0},{asset:'USDC',availableBalance:500,usdValue:500}] as any);expect(selected?.symbol).toBe('ETHUSDC');});
  it('qualifies each contract before routing so a rejected USDC market cannot eliminate healthy USDT',()=>{const base={rank:1,score:80,lifecycle:'SHORTLIST',components:{liquidity:80,tradingActivity:80,capitalActivity:80,technicalOpportunity:80,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:1e8,spreadBps:1,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now()},usdt:any={...base,symbol:'ETHUSDT',eligible:true,exclusionReasons:[]},usdc:any={...base,symbol:'ETHUSDC',eligible:false,exclusionReasons:['MARKET_QUALITY_D']};const rows=decorateUniverse([usdt,usdc],[snap('ETHUSDT'),snap('ETHUSDC')],settings,[{asset:'USDT',availableBalance:500,usdValue:500},{asset:'USDC',availableBalance:1000,usdValue:1000}] as any,[]);expect(rows.find(row=>row.selectedContract==='ETHUSDT'&&row.symbol==='ETHUSDT')).toBeTruthy();expect(rows.find(row=>row.symbol==='ETHUSDC')?.eligible).toBe(false);});
  it('assigns objective risk tiers and direction policy overrides',()=>{expect(riskTier(snap('BTCUSDT',{quote:{...snap('BTCUSDT').quote,quoteVolumeUsd24h:2_000_000_000}}),p)).toBe('CORE');expect(directionPolicy('DOGEUSDT','SPECULATIVE',{...p,symbolDirectionPolicies:{DOGEUSDT:'SHORT_ONLY'}})).toBe('SHORT_ONLY');});
  it('records overextended location in shadow without duplicating Primary timing as a veto',()=>{const s=snap('ALTUSDT',{technical:{...snap('ALTUSDT').technical,'15m':card(100,{ema21:90,bbPosition:.97,atr14:1,atrPercent:1,trend:'UP'})}});expect(locationScore(s,'LONG')).toBeLessThan(45);const plan=buildAllocationPlan({candidate:{symbol:'ALTUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'ALT',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH',locationScore:20} as any,snapshot:s,direction:'LONG',confidence:.8,settings,positions:[],assets:[{asset:'USDT',availableBalance:1000,usdValue:1000}] as any});expect(plan.admission).toBe('ALLOW');expect(plan.locationWouldBlock).toBe(true);expect(plan.marginUsd).not.toBe(200);});
  it('fails closed when exposure room is below the executable minimum instead of forcing min margin',()=>{const s=snap('BTCUSDT');const current=[{symbol:'ETHUSDT',side:'LONG' as const,quantity:50,markPrice:100,leverage:10}];const plan=buildAllocationPlan({candidate:{symbol:'BTCUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'BTC',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH'} as any,snapshot:s,direction:'LONG',confidence:.8,settings:{...settings,portfolioIntelligence:{...p,maxLongExposurePct:.5}} as any,positions:current,assets:[{asset:'USDT',availableBalance:1000,usdValue:1000}] as any});expect(plan.admission).toBe('REJECT_EXPOSURE_LIMIT');expect(plan.reasons).toContain('REJECT_EXPOSURE_LIMIT');});
  it('hard blocks max positions including working and reserved capacity',()=>{const s=snap('BTCUSDT');const plan=buildAllocationPlan({candidate:{symbol:'BTCUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'BTC',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH'} as any,snapshot:s,direction:'LONG',confidence:.8,settings:{...settings,portfolio:{entryMarginUsd:200,maxPositions:1,maxPendingEntries:2}} as any,positions:[],admissionContext:{reservedIntents:1,workingEntryOrders:0},assets:[{asset:'USDT',availableBalance:1000,usdValue:1000}] as any});expect(plan.admission).toBe('REJECT_MAX_POSITIONS');});

  // §B3: a side sized to zero has to arrive with the one number that bound it, because "REJECT_EXPOSURE_LIMIT"
  // alone is still a label. The room is the minimum over the capacities sizing actually consumed.
  const sized=(direction:'LONG'|'SHORT',over:Record<string,any>)=>buildAllocationPlan({candidate:{symbol:'BTCUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'BTC',quoteAsset:'USDT',riskTier:'LIQUID_ALT',directionPolicy:'BOTH'} as any,snapshot:snap('BTCUSDT'),direction,confidence:.8,settings,positions:[],assets:[{asset:'USDT',availableBalance:5_000,usdValue:5_000},{asset:'USDC',availableBalance:5_000,usdValue:5_000}] as any,...over} as any);
  it('reports true zero-funded TESTNET rejection without aborting diagnostics or permitting zero admitted size',()=>{
    const plan=sized('LONG',{settings:{...settings,connections:{exchange:{environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}} as any,
      assets:[{asset:'USDT',availableBalance:0,usdValue:0},{asset:'USDC',availableBalance:5000,usdValue:5000}] as any});
    expect(plan).toMatchObject({admission:'REJECT_QUOTE_MARGIN',marginUsd:0,notionalUsd:0});
    expect(plan.reasons).toContain('TESTNET_FUNDS_ONLY_ENTRY');expect(AllocationPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    for(const admission of ['ALLOW','ALLOW_REDUCED_SIZE'])expect(AllocationPlanSchema.safeParse({...plan,admission}).success).toBe(false);
    expect(AllocationPlanSchema.safeParse({...plan,marginUsd:-1}).success).toBe(false);
    expect(AllocationPlanSchema.safeParse({...plan,notionalUsd:-1}).success).toBe(false);
    const funded=sized('LONG',{settings:{...settings,connections:{exchange:{environment:'TESTNET'},executionMode:'TESTNET_ENABLED'}} as any});
    expect(funded.admission).toBe('ALLOW');expect(funded.marginUsd).toBeGreaterThan(0);
  });
  it('CR-01 names the direction cap and its used/ceiling numbers when sizing a side comes out zero',()=>{
    const plan=sized('SHORT',{positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:70,markPrice:100,leverage:10}]});
    expect(plan.admission).toBe('REJECT_EXPOSURE_LIMIT');
    expect(plan.capacityRoom).toMatchObject({source:'SHORT_EXPOSURE',ceilingUsd:5_000,usedUsd:7_000,roomUsd:0,limitPct:.5,usedPct:.7,
      enforced:true,authority:'riskGovernance.maxDirectionExposurePct + exposureCapacityPolicy.direction'});
    expect(plan.marginUsd).toBe(plan.minExecutableMarginUsd);
  });
  it('CR-02 attributes a quote-asset squeeze to the quote margin, not to exposure',()=>{
    const plan=sized('LONG',{assets:[{asset:'USDT',availableBalance:0,usdValue:0},{asset:'USDC',availableBalance:5_000,usdValue:5_000}] as any});
    expect(plan.admission).toBe('REJECT_QUOTE_MARGIN');
    expect(plan.capacityRoom).toMatchObject({source:'QUOTE_ASSET_MARGIN',ceilingUsd:0,usedUsd:0,roomUsd:0});
  });
  it('CR-03 reports the room that would bind first even when the plan is allowed',()=>{
    const plan=sized('LONG',{});
    expect(plan.admission).not.toMatch(/^REJECT_/);
    expect(plan.capacityRoom).toMatchObject({source:'QUOTE_ASSET_MARGIN',ceilingUsd:4_000,roomUsd:4_000});
    expect(plan.capacityRoom!.roomUsd).toBeCloseTo(Math.min(plan.capacityRoom!.ceilingUsd-plan.capacityRoom!.usedUsd,plan.capacityRoom!.roomUsd),8);
  });
  it('CR-04 keeps a speculative cap visible when it is the tighter of the two exposure rooms',()=>{
    const plan=sized('SHORT',{settings:{...settings,portfolioIntelligence:{...p,maxSpeculativeExposurePct:.1,symbolOverrides:{DOGEUSDT:{riskTier:'SPECULATIVE'}}}} as any,
      candidate:{symbol:'BTCUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'BTC',quoteAsset:'USDT',riskTier:'SPECULATIVE',directionPolicy:'BOTH'} as any,
      positions:[{symbol:'DOGEUSDT',side:'LONG' as const,quantity:100,markPrice:100,leverage:10}]});
    expect(plan.capacityRoom).toMatchObject({source:'SPECULATIVE_EXPOSURE',ceilingUsd:1_000,usedUsd:10_000,roomUsd:0});
    expect(plan.admission).toBe('REJECT_EXPOSURE_LIMIT');
  });

  // G1: direction exposure has exactly one authority. The same ratio may not veto a side twice, and an
  // observed-only ratio must stop refusing while still reporting its numbers.
  it('G1-01 observes direction without letting the intelligence tier veto the same ratio a second time',()=>{
    // Book at 70% SHORT against the authoritative 100% cap, while the legacy tier cap still says 50%.
    const plan=sized('SHORT',{settings:{...settings,...governed({directionPct:1,directionMode:'OBSERVE'})} as any,
      positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:70,markPrice:100,leverage:10}]});
    expect(plan.admission).not.toBe('REJECT_EXPOSURE_LIMIT');
    expect(plan.reasons).not.toContain('REJECT_EXPOSURE_LIMIT');
    expect(plan.notionalUsd).toBeGreaterThan(0);
    // The room that binds is now the quote-margin usage, not the observed direction ratio.
    expect(plan.capacityRoom).toMatchObject({source:'QUOTE_ASSET_MARGIN',enforced:true,authority:'portfolioIntelligence.maxQuoteAssetMarginUsagePct',limitPct:.8});
  });
  it('G1-02 still refuses on the authoritative direction cap when the gate keeps its veto',()=>{
    const plan=sized('SHORT',{settings:{...settings,...governed({directionPct:.5,directionMode:'ENFORCE'})} as any,
      positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:70,markPrice:100,leverage:10}]});
    expect(plan.admission).toBe('REJECT_EXPOSURE_LIMIT');
    expect(plan.reasons).toContain('REJECT_EXPOSURE_LIMIT');
    expect(plan.capacityRoom).toMatchObject({source:'SHORT_EXPOSURE',enforced:true,limitPct:.5,roomUsd:0});
  });
  it('G1-03 the tighter legacy tier cap no longer binds once the authoritative cap allows it',()=>{
    // portfolioIntelligence says 10%, governance (ENFORCE) says 50%, the book sits at 30%.
    const plan=sized('SHORT',{settings:{...settings,...governed({directionPct:.5,directionMode:'ENFORCE'})} as any,
      positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:30,markPrice:100,leverage:10}]});
    expect(plan.admission).not.toBe('REJECT_EXPOSURE_LIMIT');
    expect(plan.capacityRoom).toMatchObject({source:'SHORT_EXPOSURE',limitPct:.5,usedPct:.3,enforced:true});
  });
  it('G1-04 OBSERVE on direction removes only the direction veto, never quote or tier capacity',()=>{
    const quoteSqueezed=sized('LONG',{settings:{...settings,...governed({directionPct:1,directionMode:'OBSERVE'})} as any,
      assets:[{asset:'USDT',availableBalance:0,usdValue:0},{asset:'USDC',availableBalance:5_000,usdValue:5_000}] as any});
    expect(quoteSqueezed.admission).toBe('REJECT_QUOTE_MARGIN');
    expect(quoteSqueezed.capacityRoom).toMatchObject({source:'QUOTE_ASSET_MARGIN',enforced:true,roomUsd:0});
    const tierSqueezed=sized('SHORT',{settings:{...settings,...governed({directionPct:1,directionMode:'OBSERVE'}),portfolioIntelligence:{...p,maxSpeculativeExposurePct:.1,symbolOverrides:{DOGEUSDT:{riskTier:'SPECULATIVE'}}}} as any,
      candidate:{symbol:'BTCUSDT',rank:1,score:80,lifecycle:'SHORTLIST',eligible:true,exclusionReasons:[],components:{liquidity:80,tradingActivity:70,capitalActivity:60,technicalOpportunity:70,executionReachability:80,dataQuality:100},quoteVolumeUsd24h:100_000_000,spreadBps:2,lastPrice:100,change24hPercent:0,dataCompleteness:1,selectionGeneration:1,updatedAt:Date.now(),underlyingAsset:'BTC',quoteAsset:'USDT',riskTier:'SPECULATIVE',directionPolicy:'BOTH'} as any,
      positions:[{symbol:'DOGEUSDT',side:'LONG' as const,quantity:100,markPrice:100,leverage:10}]});
    expect(tierSqueezed.admission).toBe('REJECT_EXPOSURE_LIMIT');
    expect(tierSqueezed.capacityRoom).toMatchObject({source:'SPECULATIVE_EXPOSURE',enforced:true,roomUsd:0,authority:'portfolioIntelligence.maxSpeculativeExposurePct'});
  });
  it('G1-05 the throttle follows the same authoritative ratio, so one ratio is read once',()=>{
    const observed=sized('SHORT',{settings:{...settings,...governed({directionPct:1,directionMode:'OBSERVE'})} as any,
      positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:70,markPrice:100,leverage:10}]});
    const enforced=sized('SHORT',{settings:{...settings,...governed({directionPct:.5,directionMode:'ENFORCE'})} as any,
      positions:[{symbol:'ETHUSDT',side:'SHORT' as const,quantity:70,markPrice:100,leverage:10}]});
    // Same book, same intelligence tier: only the authoritative ratio differs, and the tighter one still
    // shrinks the side. Nothing here widens a risk limit — it stops the second cap from vetoing.
    expect(observed.marginUsd).toBeGreaterThan(enforced.marginUsd);
    expect(observed.admission).not.toBe('REJECT_EXPOSURE_LIMIT');
    expect(enforced.admission).toBe('REJECT_EXPOSURE_LIMIT');
    expect(enforced.capacityRoom).toMatchObject({source:'SHORT_EXPOSURE',limitPct:.5,enforced:true});
  });
});

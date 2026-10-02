import { describe, expect, it } from 'vitest';
import { harness } from './tradingQualityTestHarness.js';
import { captureEntryThesis, directionFacts, entryThesisDrift, validateDirectionContract } from './entryDirectionContract.js';

const decision=(over:Record<string,unknown>={})=>({tradeSide:'LONG',direction:'LONG',trend1dRole:'SUPPORTS_LONG',trend4hRole:'SUPPORTS_LONG',trend15mRole:'SUPPORTS_LONG',alignmentClass:'ALIGNED_LONG',counterTrendException:false,counterTrendReason:null,...over}) as any;

describe('V3.9.7 direction and thesis contract',()=>{
  it('requires an explicit counter-trend branch against 1D+4H consensus',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.technical['1d'].trend='UP';market.technical['4h'].trend='UP';market.technical['15m'].trend='DOWN';
    expect(directionFacts(market)).toMatchObject({strategicConsensus:'LONG',baseAlignmentClass:'MIXED'});
    expect(validateDirectionContract(market,decision({tradeSide:'SHORT',direction:'SHORT',trend15mRole:'SUPPORTS_SHORT',alignmentClass:'MIXED'}))).toMatchObject({ok:false,reason:'COUNTER_TREND_EXCEPTION_REQUIRED',minimumCandidateRequired:true});
    expect(validateDirectionContract(market,decision({tradeSide:'SHORT',direction:'SHORT',trend15mRole:'SUPPORTS_SHORT',alignmentClass:'COUNTER_TREND_REVERSAL',counterTrendException:true,counterTrendReason:'15m reversal with explicit invalidation'}))).toMatchObject({ok:true,counterTrend:true,minimumCandidateRequired:true});
  });

  it('rejects copied or factually wrong timeframe roles',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.technical['1d'].trend='UP';market.technical['4h'].trend='DOWN';market.technical['15m'].trend='RANGE';
    expect(validateDirectionContract(market,decision({trend4hRole:'SUPPORTS_LONG',trend15mRole:'NEUTRAL',alignmentClass:'MIXED'}))).toMatchObject({ok:false,reason:'DIRECTION_TIMEFRAME_ROLE_MISMATCH'});
  });

  it('invalidates a plan when a contracted closed bar changes during inference',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    const before=captureEntryThesis(market,1);
    market.technical['15m'].asOf+=15*60_000;
    expect(entryThesisDrift(before,market)).toMatchObject({ok:false,reasons:expect.arrayContaining(['MATERIAL_CLOSED_BAR_CHANGED'])});
  });

  it('archives independent quote/bar/role snapshots with stable factual fingerprints',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.technical['15m'].lastClosedBar={openTime:1,closeTime:2,open:99,high:101,low:98,close:100,volume:10};
    const before=captureEntryThesis(market,1000),sameFacts=captureEntryThesis(market,2000);
    expect(before.factFingerprint).toBe(sameFacts.factFingerprint);
    expect(before.quote).toEqual({last:market.quote.last,mark:market.quote.mark,bid:market.quote.bid,ask:market.quote.ask,ts:market.quote.ts});
    expect(before.roles).toEqual(directionFacts(market));
    market.quote.ask+=1;market.technical['15m'].lastClosedBar.close=101;
    expect(before.bars!['15m'].lastClosedBar!.close).toBe(100);
    expect(captureEntryThesis(market,2000).factFingerprint).not.toBe(before.factFingerprint);
  });

  it.each([{beforeAtr:10,currentAtr:20,delta:7,blocked:false},
    {beforeAtr:10,currentAtr:20,delta:7.01,blocked:true},
    {beforeAtr:20,currentAtr:10,delta:7,blocked:false},
    {beforeAtr:20,currentAtr:10,delta:-7.01,blocked:true},
    {beforeAtr:0,currentAtr:0,delta:100,blocked:false}])('keeps the original max-ATR and strict threshold: %j',test=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.quote.last=100;market.technical['15m'].atr14=test.beforeAtr;
    const before=captureEntryThesis(market,1000);
    market.quote.last+=test.delta;market.technical['15m'].atr14=test.currentAtr;
    const drift=entryThesisDrift(before,market,null,2000),price=drift.diagnostics.price;
    expect(drift.reasons.includes('ENTRY_LOCATION_DRIFT_GT_0_35_ATR')).toBe(test.blocked);
    expect(price.atrUsed).toBe(Math.max(test.beforeAtr,test.currentAtr));
    expect(price.thresholdPrice).toBe(.35*price.atrUsed);
    expect(price.exceeded).toBe(price.enabled&&price.absoluteDelta>price.thresholdPrice);
    expect(drift.diagnostics.elapsedMs).toBe(1000);
    expect(drift.current.capturedAt).toBe(2000);
  });

  it('makes all five original rejection classes reproducible from the archived evidence',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.quote.last=100;market.technical['15m'].atr14=2;
    const before=captureEntryThesis(market,1000);
    market.technical['15m'].asOf+=900000;market.technical['4h'].trend=before.trend4h==='UP'?'DOWN':'UP';
    market.technical['1m'].trend=before.trend1m==='UP'?'DOWN':'UP';
    Object.assign(market.quote,{last:102,bid:102,ask:102.1,ts:2000});
    const drift=JSON.parse(JSON.stringify(entryThesisDrift(before,market,{min:99,max:101},2000)));
    expect(drift.reasons).toEqual(['MATERIAL_CLOSED_BAR_CHANGED','MATERIAL_STRUCTURE_TREND_CHANGED',
      'EXECUTION_TIMING_TREND_CHANGED','ENTRY_LOCATION_DRIFT_GT_0_35_ATR','MARKET_LEFT_AUTHORIZED_ENTRY_RANGE']);
    expect(drift.diagnostics).toMatchObject({changedClosedBarTimeframes:['15m'],changedStructureTimeframes:['4h'],changedTimingTimeframes:['1m'],
      price:{beforeLast:100,currentLast:102,beforeAtr15m:2,currentAtr15m:2,atrUsed:2,thresholdPrice:.7,absoluteDelta:2,deltaAtr:1},
      authorizedRange:{min:99,max:101},beforeInsideAuthorizedRange:true,currentSpreadOutsideAuthorizedRange:true,marketLeftAuthorizedRange:true});
    expect(drift.current.quote.ts).toBe(2000);
  });

  it('preserves spread intersection and the before-inside condition of the authorized-range check',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!;
    market.quote.last=100;market.technical['15m'].atr14=100;
    const before=captureEntryThesis(market,1000);
    Object.assign(market.quote,{last:101.1,bid:101,ask:101.2});
    expect(entryThesisDrift(before,market,{min:99,max:101}).reasons).not.toContain('MARKET_LEFT_AUTHORIZED_ENTRY_RANGE');
    market.quote.bid=101.01;
    expect(entryThesisDrift(before,market,{min:99,max:101}).reasons).toContain('MARKET_LEFT_AUTHORIZED_ENTRY_RANGE');
    expect(entryThesisDrift({...before,last:98},market,{min:99,max:101}).reasons).not.toContain('MARKET_LEFT_AUTHORIZED_ENTRY_RANGE');
  });

  it('continues to evaluate an old thesis without manufacturing missing before quote evidence',()=>{
    const h=harness(),market=h.state.snapshots.get(h.packet.symbol)!,snapshot=captureEntryThesis(market,1000);
    const {evidenceVersion,symbol,factFingerprint,quote,roles,bars,...legacy}=snapshot;
    const drift=entryThesisDrift(legacy,market,null,2000);
    expect(drift.ok).toBe(true);expect(drift.before).toEqual(legacy);expect(drift.before.quote).toBeUndefined();
    expect(drift.diagnostics.price.beforeLast).toBe(legacy.last);
  });
});

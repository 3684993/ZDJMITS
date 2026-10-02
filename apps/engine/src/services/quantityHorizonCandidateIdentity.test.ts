import {describe,expect,it} from 'vitest';
import {TradePlanCandidateSchema,TradePlanCandidateTargetSchema,TradePlanSchema} from '@zdj/contracts';
import {buildQuantityHorizonCandidates,type CandleRow} from './quantityHorizonCandidates.js';

const NOW=2_000_000_000_000;
type Input=Parameters<typeof buildQuantityHorizonCandidates>[0];

function input(side:'LONG'|'SHORT'='SHORT',tailMove=2):Input{
  return{symbol:'TESTUSDT',side,now:NOW,
    quote:{bid:100,ask:100,tickSize:.01,stepSize:.001,minQty:.001,minNotional:5},leverage:10,
    envelope:{executable:true,minQuantityUnits:1,maxQuantityUnits:30_000,maxNotionalUsd:3_000,maxMarginUsd:300},
    envelopeExpiresAt:NOW+120_000,factVersion:'fixed-facts-1',risk:null,
    settings:{takeProfit:{entryFeeRate:.0004,makerFeeRate:.0004,takerFeeRate:.0004,exitFeeAssumption:'TAKER',
      slippageBufferPct:0,feeSafetyBufferPct:10,minNetProfitUsd:1,minNetProfitRoiPct:0},
      tradeEconomics:{admissionMode:'SHADOW',historicalTpReachabilityEnabled:true,reachabilityLookbackBars:180,reachabilityMinSamples:30},
      portfolioIntelligence:{businessMinInitialMarginUsd:100,preferredInitialMarginUsd:200}},
    candles:(timeframe)=>{
      const period=timeframe==='1m'?60_000:timeframe==='5m'?300_000:900_000;
      return Array.from({length:300},(_,i)=>({openTime:NOW-(300-i)*period,closeTime:NOW-(299-i)*period-1,
        high:100+(i<240?1:tailMove),low:100-(i<240?1:tailMove),close:100})) as CandleRow[];
    },targetHorizons:[15,60,240],managementDurationMs:86_400_000};
}

const first=(args:Input=input())=>{
  const set=buildQuantityHorizonCandidates(args);
  expect(set.candidates.length,set.noTradeReasons.join(',')).toBeGreaterThan(0);
  return{set,candidate:set.candidates[0]!};
};

describe('versioned candidate target range and immutable authority',()=>{
  it.each(['LONG','SHORT'] as const)('offers ascending, profitable %s ranges across ticks and horizons',side=>{
    for(const tickSize of [.1,.01,.001]){
      const args=input(side);args.quote.tickSize=tickSize;
      const {set}=first(args);
      expect(set.schemaVersion).toBe('V397-PLAN-CANDIDATE-SET-2');
      expect(set.candidateSetHash).toMatch(/^cset_v2_[a-f0-9]{24}$/);
      expect(new Set(set.candidates.map(row=>row.targetHorizonMinutes))).toEqual(new Set([15,60,240]));
      for(const candidate of set.candidates){
        expect(candidate.schemaVersion).toBe('V397-PLAN-CANDIDATE-2');
        expect(candidate.candidateId).toMatch(/^cand_v2_[a-f0-9]{24}$/);
        expect(TradePlanCandidateSchema.safeParse(candidate).success).toBe(true);
        expect(candidate.acceptableTargetRange.min).toBeLessThanOrEqual(candidate.targetPrice);
        expect(candidate.acceptableTargetRange.max).toBeGreaterThanOrEqual(candidate.targetPrice);
        expect((side==='LONG'?1:-1)*(candidate.targetPrice-candidate.entryReferencePrice)).toBeGreaterThan(0);
        expect(candidate.economics.targetConditionalNetProfitUsd).toBeGreaterThanOrEqual(1);
        expect(candidate.quantityUnits).toBeLessThanOrEqual(args.envelope.maxQuantityUnits);
        expect(candidate.marginUsd).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('keeps the archived SOL inverted range byte-for-byte in V1, while V2 refuses it',()=>{
    const {candidate}=first();
    const archived={...candidate,schemaVersion:'V396-PLAN-CANDIDATE-1',candidateId:'cand_d0b1f41e120469f34cffcbcb',
      targetPrice:116.53,acceptableTargetRange:{min:116.53,max:115.7},targetHorizonMinutes:240};
    const original=JSON.stringify(archived);
    expect(TradePlanCandidateSchema.parse(archived)).toEqual(archived);
    expect(JSON.stringify(archived)).toBe(original);
    const {schemaVersion,...withoutVersion}=archived;
    expect(TradePlanCandidateSchema.parse(withoutVersion)).toEqual(archived);
    expect(TradePlanCandidateSchema.safeParse({...archived,schemaVersion:'V397-PLAN-CANDIDATE-2'}).success).toBe(false);
    expect(candidate.candidateId).not.toBe(archived.candidateId);
  });

  it('does not tighten or rewrite persisted historical trade-plan ranges',()=>{
    const {candidate}=first();
    const archived={schemaVersion:'V396-TRADE-PLAN-1',planId:'plan_old_sol',planVersion:1,supersedesPlanId:null,
      cycleId:'cycle_old_sol',scope:'TESTUSDT:SHORT',symbol:candidate.symbol,side:'SHORT',selectedCandidateId:'cand_old_sol',
      quantityUnits:candidate.quantityUnits,notionalUsd:candidate.notionalUsd,marginUsd:candidate.marginUsd,leverage:10,
      entryReferencePrice:117.3,targetPrice:116.53,acceptableTargetRange:{min:116.53,max:115.7},
      entryTtlMinutes:2,targetHorizonMinutes:240,managementDurationMs:86_400_000,thesis:'Historical record, no new authorization',
      invalidationPredicate:'NO_PREDICATE',predicateLevel:null,predicateEvidenceRefs:[],counterEvidenceRefs:[],releaseCondition:null,
      costs:candidate.costs,economics:candidate.economics,risk:null,minNetProfitUsd:1,maxRealizedLossUsd:0,
      provenance:{modelRunId:'archived_run',promptVersion:'V3.9.7',factVersion:'old-facts',envelopeExpiresAt:NOW-1,
        candidateSetHash:'old_candidate_set',createdAt:NOW-120_000,source:'AI'},persistedAt:NOW-100_000,immutable:true};
    expect(TradePlanSchema.parse(archived)).toEqual(archived);
  });

  it.each([
    {targetPrice:116.53,acceptableTargetRange:{min:116.53,max:115.7}},
    {targetPrice:117,acceptableTargetRange:{min:115.7,max:116.53}},
    {targetPrice:Number.NaN,acceptableTargetRange:{min:115,max:116}},
    {targetPrice:116,acceptableTargetRange:{min:115,max:Number.POSITIVE_INFINITY}},
  ])('rejects malformed new target authority %#',target=>{
    expect(TradePlanCandidateTargetSchema.safeParse(target).success).toBe(false);
    const {candidate}=first();
    expect(TradePlanCandidateSchema.safeParse({...candidate,...target}).success).toBe(false);
  });

  it('accepts a one-price target range without widening it',()=>{
    const target={targetPrice:116.53,acceptableTargetRange:{min:116.53,max:116.53}};
    expect(TradePlanCandidateTargetSchema.parse(target)).toEqual(target);
  });

  it('refuses non-finite quote and exchange values before generating authority',()=>{
    for(const key of ['bid','stepSize','tickSize'] as const){
      const args=input();args.quote[key]=Number.POSITIVE_INFINITY;
      const set=buildQuantityHorizonCandidates(args);
      expect(set.candidates).toEqual([]);
      expect(set.noTradeReasons[0]).toMatch(/CANDIDATE_(MARKET_FACT_INVALID|ENTRY_PRICE_UNPROVEN)/);
    }
  });

  it('changes candidate and menu identity when the same target receives a different authorized range',()=>{
    const a=first(input('SHORT',2)),b=first(input('SHORT',3));
    const left=a.set.candidates.find(row=>row.economics.targetBasis==='P50')!;
    const right=b.set.candidates.find(row=>row.quantityUnits===left.quantityUnits&&row.targetHorizonMinutes===left.targetHorizonMinutes&&row.economics.targetBasis==='P50')!;
    expect(right.targetPrice).toBe(left.targetPrice);
    expect(right.costs).toEqual(left.costs);
    expect(right.acceptableTargetRange).not.toEqual(left.acceptableTargetRange);
    expect(right.candidateId).not.toBe(left.candidateId);
    expect(b.set.candidateSetHash).not.toBe(a.set.candidateSetHash);
  });

  it.each(['factVersion','costVersion','expiry','stepSize','riskVersion','profitPolicy'] as const)(
    'binds %s into candidate and menu authority',changed=>{
      const original=input(),next=input();
      if(changed==='factVersion')next.factVersion='fixed-facts-2';
      if(changed==='costVersion')next.settings.takeProfit.feeSafetyBufferPct=20;
      if(changed==='expiry')next.envelopeExpiresAt+=1;
      if(changed==='stepSize')next.quote.stepSize=.002;
      if(changed==='profitPolicy')next.settings.takeProfit.minNetProfitUsd=.9;
      if(changed==='riskVersion')next.risk={capitalAtRiskUsd:0,grossNotionalAfterUsd:0,longNotionalAfterUsd:0,shortNotionalAfterUsd:0,
        clusterNotionalAfterUsd:0,limitingConstraints:[],riskGeneration:2,snapshotHash:`v396r${'a'.repeat(32)}`,profileVersion:'profile2',humanSlotsAfter:0};
      const a=first(original),b=first(next);
      expect(b.candidate.candidateId).not.toBe(a.candidate.candidateId);
      expect(b.set.candidateSetHash).not.toBe(a.set.candidateSetHash);
      if(changed==='costVersion')expect(b.candidate.costs.costVersion).not.toBe(a.candidate.costs.costVersion);
    });

  it('has stable identities for repeated equivalent facts without mutating the input',()=>{
    const args=input(),before=JSON.stringify(args);
    const a=first(args),b=first(args);
    expect(b.set).toEqual(a.set);
    const reordered=input();
    reordered.settings.takeProfit=Object.fromEntries(Object.entries(reordered.settings.takeProfit).reverse()) as Input['settings']['takeProfit'];
    expect(first(reordered).set.candidateSetHash).toBe(a.set.candidateSetHash);
    expect(first(reordered).candidate.candidateId).toBe(a.candidate.candidateId);
    expect(JSON.stringify(args)).toBe(before);
  });

  it('keeps a rejected menu versioned and distinct across fact versions',()=>{
    const a=input(),b=input();a.envelope.executable=false;b.envelope.executable=false;b.factVersion='later-facts';
    const left=buildQuantityHorizonCandidates(a),right=buildQuantityHorizonCandidates(b);
    expect(left.candidates).toEqual([]);
    expect(left.schemaVersion).toBe('V397-PLAN-CANDIDATE-SET-2');
    expect(left.candidateSetHash).not.toBe(right.candidateSetHash);
  });
});

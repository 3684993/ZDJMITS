import {describe,expect,it} from 'vitest';
import type {TradeRecord,TradingQualityExperimentManifest} from '@zdj/contracts';
import {canonicalPnlEligible,entryMetricEligible,ledgerClosedComplete,legacyEconomicInconsistency,prospectiveCohortMember} from './tradingQualityEligibility.js';

const record=(overrides:Partial<TradeRecord>={}):TradeRecord=>({
  tradeId:'tr1',symbol:'BTCUSDT',direction:'LONG',openedAt:1_000,closedAt:2_000,durationMs:1_000,
  entryQty:1,exitQty:1,remainingQty:0,entryAveragePrice:100,exitAveragePrice:101,entryFee:.04,exitFee:.04,totalFee:.08,funding:null,
  entryGrossNotional:100,exitGrossNotional:101,marginUsed:10,netRoiOnMargin:null,netReturnOnNotional:null,entryFillCount:1,exitFillCount:1,feeBreakdown:[],
  grossRealizedPnl:1,tradingNetPnlExFunding:.92,netPnl:null,pnlBasis:'CANONICAL_NET_WITH_FUNDING_UNKNOWN',fundingAttributionStatus:'UNKNOWN',
  closeReason:'TP',status:'CLOSED',entryRunId:'r1',entryIntentId:'i1',entryOrderIds:['o1'],exitOrderIds:['x1'],source:'SYSTEM',regime:null,
  feeCompleteness:'COMPLETE',recordCompleteness:'COMPLETE',classification:'COMPLETE',canonical:true,duplicateOf:null,cycleId:'cy1',repairSource:null,linkedFillIds:['f1','f2'],missingFacts:[],integrityFlags:[],
  createdAt:1_000,updatedAt:2_000,firstObservedAt:1_000,observedClosedAt:2_000,positionId:'p1',...overrides,
});
const manifest:TradingQualityExperimentManifest={experimentId:'e1',environment:'TESTNET',accountScope:'acct',codeHead:'abcdef123',configHash:'config123',policyVersion:'p1',metricVersion:'m1',ruleHash:'rules123',analysisPlanHash:'plan1234',decisionStartAt:100,entryEnrollmentEndAt:200,followupEndAt:500,authoritativeClock:'EXCHANGE_EVENT_TIME',enrollmentRuleVersion:'1',transitionalRule:'BASELINE_PREEXISTING_ORDER_IS_TRANSITIONAL',exclusionReasons:[],runtimeSessions:[],createdAt:90};
const enrollment={decisionAt:120,intentCreatedAt:121,cycleCreatedAt:122,source:'NEW_DECISION' as const,environment:'TESTNET',accountScope:'acct',codeHead:'abcdef123',configHash:'config123',policyVersion:'p1',metricVersion:'m1',ruleHash:'rules123'};

describe('V3.9.3 eligibility contract',()=>{
  it('keeps funding UNKNOWN independent from ledger CLOSED COMPLETE',()=>{
    const r=record();expect(ledgerClosedComplete(r).eligible).toBe(true);expect(canonicalPnlEligible(r).eligible).toBe(false);
  });
  it('requires durable funding evidence and authoritative net consistency',()=>{
    const r=record({funding:.1,fundingAttributionStatus:'EXACT',pnlBasis:'CANONICAL_NET_WITH_FUNDING',netPnl:1.02});
    expect(canonicalPnlEligible(r).eligible).toBe(false);
    expect(canonicalPnlEligible(r,{accountScope:'acct',fundingEvidence:{attributionStatus:'EXACT',factIds:['income-1'],coverageStartAt:1_000,coverageEndAt:2_000,accountScope:'acct',cycleId:'cy1',verifiedAt:2_100}}).eligible).toBe(true);
    expect(canonicalPnlEligible({...r,netPnl:99},{accountScope:'acct',fundingEvidence:{attributionStatus:'EXACT',factIds:['income-1'],coverageStartAt:1_000,coverageEndAt:2_000,accountScope:'acct',cycleId:'cy1',verifiedAt:2_100}}).reasons).toContain('AUTHORITATIVE_NET_PNL_INCONSISTENT');
  });
  it('quarantines legacy net values without promoting funding',()=>expect(legacyEconomicInconsistency(record({netPnl:4.2,fundingAttributionStatus:undefined,pnlBasis:undefined}))).toBe(true));
  it('freezes cohort membership against restart/late discovery semantics',()=>{
    expect(prospectiveCohortMember(manifest,enrollment).eligible).toBe(true);
    expect(prospectiveCohortMember(manifest,{...enrollment,source:'TRANSITIONAL_EXISTING_ORDER'}).eligible).toBe(false);
    expect(prospectiveCohortMember(manifest,{...enrollment,decisionAt:99,intentCreatedAt:150,cycleCreatedAt:151}).eligible).toBe(false);
    expect(prospectiveCohortMember(undefined,enrollment).reasons).toContain('MANIFEST_MISSING');
  });
  it('does not spread funding UNKNOWN into price metrics',()=>{
    const base={exactEntryAttribution:true,anchorKnown:true,horizonMature:true,pathComplete:true};
    expect(entryMetricEligible('PRICE_MARKOUT',base).eligible).toBe(true);
    expect(entryMetricEligible('EXECUTABLE_EX_FUNDING',{...base,executableQuoteComplete:true,entryCostComplete:true,exitCostBoundComplete:true,fundingHorizonComplete:false}).eligible).toBe(true);
    expect(entryMetricEligible('EXECUTABLE_WITH_FUNDING',{...base,executableQuoteComplete:true,entryCostComplete:true,exitCostBoundComplete:true,fundingHorizonComplete:false}).reasons).toContain('FUNDING_HORIZON_INCOMPLETE');
  });
});

it('does not accept a funding coverage fragment or another account',()=>{const r=record({funding:0,fundingAttributionStatus:'EXACT',pnlBasis:'CANONICAL_NET_WITH_FUNDING',netPnl:.92}),e={attributionStatus:'EXACT' as const,factIds:['fact'],coverageStartAt:1000,coverageEndAt:2000,verifiedAt:2100,cycleId:'cy1',accountScope:'acct'};expect(canonicalPnlEligible(r,{fundingEvidence:e,accountScope:'other'}).eligible).toBe(false);expect(canonicalPnlEligible(r,{fundingEvidence:{...e,coverageEndAt:1500},accountScope:'acct'}).eligible).toBe(false);});
it('rejects a late-created Entry even with an in-window decision',()=>expect(prospectiveCohortMember(manifest,{...enrollment,cycleCreatedAt:201}).eligible).toBe(false));

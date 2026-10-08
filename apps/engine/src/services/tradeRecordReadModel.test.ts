import {describe,expect,it} from 'vitest';
import type {TradeRecord} from '@zdj/contracts';
import {filterFormalOutcome,projectTradeRecordRow,projectTradeRecordSummary} from './tradeRecordReadModel.js';

const row=(overrides:Partial<TradeRecord>={}):TradeRecord=>({tradeId:'t',symbol:'BTCUSDT',direction:'LONG',openedAt:1,closedAt:2,durationMs:1,entryQty:1,exitQty:1,remainingQty:0,entryAveragePrice:100,exitAveragePrice:101,entryFee:.04,exitFee:.04,totalFee:.08,funding:null,entryGrossNotional:100,exitGrossNotional:101,marginUsed:10,netRoiOnMargin:null,netReturnOnNotional:null,entryFillCount:1,exitFillCount:1,feeBreakdown:[],grossRealizedPnl:1,tradingNetPnlExFunding:.92,netPnl:null,closeReason:'TP',status:'CLOSED',entryRunId:'r',entryIntentId:'i',entryOrderIds:['o'],exitOrderIds:['x'],source:'SYSTEM',regime:null,feeCompleteness:'COMPLETE',recordCompleteness:'COMPLETE',classification:'COMPLETE',canonical:true,duplicateOf:null,cycleId:'cy',repairSource:null,linkedFillIds:['f1','f2'],missingFacts:[],integrityFlags:[],createdAt:1,updatedAt:2,firstObservedAt:1,fundingAttributionStatus:'UNKNOWN',pnlBasis:'CANONICAL_NET_WITH_FUNDING_UNKNOWN',...overrides});

describe('A2 trade record read model',()=>{
  it('does not call funding-only incompleteness ledger reconciliation',()=>{const summary=projectTradeRecordSummary({records:[row()],asOf:3});expect(summary.closedCompleteCount).toBe(1);expect(summary.awaitingReconciliation).toBe(0);expect(summary.fundingUnknownCount).toBe(1);expect(summary.completed).toBe(0);expect(summary.canonicalNetPnl).toBeNull();expect(summary.canonicalNetPnlStatus).toBe('NO_ELIGIBLE_SAMPLES');expect(summary.tradingNetExFunding).toBe(.92);});
  it('keeps missing manifest unknown instead of reporting a complete zero cohort',()=>expect(projectTradeRecordSummary({records:[row()]}).prospective).toMatchObject({status:'MANIFEST_UNAVAILABLE',entryCycleCount:null,closedCycleCount:null}));
  it('quarantines legacy raw net from formal row display and WIN/LOSS filtering',()=>{const legacy=row({netPnl:4.2,fundingAttributionStatus:undefined,pnlBasis:undefined});const projected=projectTradeRecordRow(legacy);expect(projected.rawNetPnl).toBe(4.2);expect(projected.netPnl).toBeNull();expect(projected.formalNetPnl).toBeNull();expect(projected.formalNetPnlStatus).toBe('LEGACY_ECONOMIC_SEMANTICS_INCONSISTENT');expect(filterFormalOutcome([projected],'WIN')).toHaveLength(0);});
  it('separates ledger failures from funding unknown',()=>{const incomplete=row({classification:'PARTIAL',recordCompleteness:'PARTIAL',exitFillCount:0,exitQty:0,remainingQty:1,exitAveragePrice:null,totalFee:null});const summary=projectTradeRecordSummary({records:[incomplete]});expect(summary.closedCompleteCount).toBe(0);expect(summary.awaitingReconciliation).toBe(1);expect(summary.fundingUnknownCount).toBe(0);});
  it('sums only proven local closed cycles even while funding is unknown',()=>{
    const records=[row(),row({tradeId:'external',cycleId:'e',source:'EXTERNAL',tradingNetPnlExFunding:.92}),row({tradeId:'duplicate',cycleId:'d',canonical:false,duplicateOf:'t'}),row({tradeId:'open',cycleId:'o',status:'OPEN'}),row({tradeId:'fee',cycleId:'f',feeCompleteness:'UNKNOWN',totalFee:null}),row({tradeId:'unlinked',cycleId:'u',linkedFillIds:[]})];
    const result=projectTradeRecordSummary({records});
    expect(result.localAccounting).toMatchObject({exFundingNet:.92,completeCycles:1,confirmedFunding:null,confirmedAllInNet:null,confirmedAllInCycles:0,fundingUnknownCycles:1,allInUnconfirmedCycles:1,fundingExactEvidencePendingCycles:0,coverage:{external:1,duplicate:1,feeMissing:1}});
  });
  it('quarantines ambiguous canonical cycle collisions and unconserved rows',()=>{
    const records=[row(),row({tradeId:'t2'}),row({tradeId:'u',cycleId:'u',ledgerConservation:'UNCONSERVED'})];
    expect(projectTradeRecordSummary({records}).localAccounting).toMatchObject({exFundingNet:null,completeCycles:0,coverage:{cycleCollision:2,cycleUnconserved:1}});
  });
  it('confirms funding and all-in net only with exact scoped evidence',()=>{
    const exact=row({funding:.1,fundingAttributionStatus:'EXACT',pnlBasis:'CANONICAL_NET_WITH_FUNDING',netPnl:1.02});
    const evidence={attributionStatus:'EXACT' as const,factIds:['income-1'],coverageStartAt:0,coverageEndAt:2,verifiedAt:3,cycleId:'cy',accountScope:'testnet-account'};
    const result=projectTradeRecordSummary({records:[exact],accountScope:'testnet-account',fundingEvidenceByCycle:{cy:evidence}});
    expect(result.localAccounting).toMatchObject({exFundingNet:.92,confirmedFunding:null,confirmedAllInNet:null,confirmedAllInCycles:0,fundingUnknownCycles:0,allInUnconfirmedCycles:1,fundingExactEvidencePendingCycles:1});
    expect(projectTradeRecordSummary({records:[exact]}).localAccounting).toMatchObject({confirmedFunding:null,confirmedAllInNet:null,fundingUnknownCycles:0,allInUnconfirmedCycles:1,fundingExactEvidencePendingCycles:1});
  });
});

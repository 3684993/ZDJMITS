import {projectTradeLearningFacts,type TradeLearningContext,type TradeLearningFacts} from './tradeLearningFacts.js';
import type {TradeRecord,TradingQualityEnrollmentEvidence,TradingQualityExperimentManifest,TradingQualityFundingEvidence} from '@zdj/contracts';
import {canonicalPnlEligible,ledgerClosedComplete,legacyEconomicInconsistency,prospectiveCohortMember} from './tradingQualityEligibility.js';

export type TradeRecordReadModelInput={records:TradeRecord[];accountScope?:string;fundingEvidenceByCycle?:Record<string,TradingQualityFundingEvidence|undefined>;experimentManifest?:TradingQualityExperimentManifest;enrollmentByCycle?:Record<string,TradingQualityEnrollmentEvidence|undefined>;asOf?:number;learningContext?:TradeLearningContext;learningFactsByCycle?:Record<string,TradeLearningFacts|undefined>;};

export function projectTradeRecordRow(record:TradeRecord,input:Omit<TradeRecordReadModelInput,'records'>={}){
  const p=record.learningFundingProof;
  const fundingEvidence=(record.cycleId?input.fundingEvidenceByCycle?.[record.cycleId]:undefined)??(p?{attributionStatus:'EXACT' as const,factIds:p.coverageIds.concat(p.allocations.map(a=>a.incomeId)),accountScope:p.accountScope,cycleId:p.cycleId,coverageStartAt:p.from,coverageEndAt:p.to,verifiedAt:p.verifiedAt}:undefined);
  const learningFacts=record.cycleId?input.learningFactsByCycle?.[record.cycleId]??(input.learningContext?projectTradeLearningFacts(record,input.learningContext):undefined):undefined;
  const ledger=ledgerClosedComplete(record),canonical=canonicalPnlEligible(record,{fundingEvidence,accountScope:input.learningContext&&learningFacts?.funding?.status==='EXACT'?p?.accountScope??input.accountScope:input.accountScope,learningFacts});
  const cohort=record.cycleId?prospectiveCohortMember(input.experimentManifest,input.enrollmentByCycle?.[record.cycleId]):{eligible:false,reasons:['CYCLE_ID_MISSING']};
  const legacyEconomicInconsistent=legacyEconomicInconsistency(record),rawNetPnl=record.netPnl;
  return {...record,rawEntryRunId:record.entryRunId,entryRunId:learningFacts?.entry.originRunId??null,...(learningFacts?.exit??{}),entryLineage:learningFacts?.entry??{complete:false,lots:[],reasons:['ENTRY_LINEAGE_NOT_EVALUATED']},factLedgers:learningFacts?.fillLedger??null,moneyAsset:record.symbol.endsWith('USDC')?'USDC':record.symbol.endsWith('USDT')?'USDT':null,rawNetPnl,
    // Compatibility `netPnl` is the formal display value. Raw source remains available as rawNetPnl/rawRecord without mutating state.
    netPnl:canonical.eligible?rawNetPnl:null,netRoiOnMargin:canonical.eligible?record.netRoiOnMargin:null,netReturnOnNotional:canonical.eligible?record.netReturnOnNotional:null,
    economicEligibility:{ledgerClosedComplete:ledger.eligible,canonicalPnlEligible:canonical.eligible,prospectiveCohortMember:cohort.eligible,ledgerReasons:ledger.reasons,canonicalReasons:canonical.reasons,cohortReasons:cohort.reasons,legacyEconomicInconsistent},
    formalNetPnl:canonical.eligible?rawNetPnl:null,
    formalOutcome:canonical.eligible&&rawNetPnl!=null?(rawNetPnl>0?'WIN':rawNetPnl<0?'LOSS':'FLAT'):null,
    formalNetPnlStatus:canonical.eligible?'ELIGIBLE':legacyEconomicInconsistent?'LEGACY_ECONOMIC_SEMANTICS_INCONSISTENT':'INELIGIBLE',
  };
}

export function projectTradeRecordSummary(input:TradeRecordReadModelInput){
  const asOf=input.asOf??Date.now(),rows=input.records.map(record=>projectTradeRecordRow(record,input));
  const observedClosed=rows.filter(row=>row.closedAt!=null||row.observedClosedAt!=null),ledger=rows.filter(row=>row.economicEligibility.ledgerClosedComplete),exFunding=ledger.filter(row=>Number.isFinite(row.tradingNetPnlExFunding));
  const linked=exFunding.filter(row=>['SYSTEM','LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT'].includes(row.source)&&row.entryOrderIds.length>0&&row.exitOrderIds.length>0&&row.linkedFillIds.length>0&&!['UNCONSERVED','LEDGER_INCONSISTENT','UNKNOWN'].includes(row.ledgerConservation??'')),
    cycleCounts=new Map<string,number>();
  for(const row of linked)cycleCounts.set(row.cycleId!, (cycleCounts.get(row.cycleId!)??0)+1);
  const local=linked.filter(row=>cycleCounts.get(row.cycleId!)===1),
    localExact=local.filter(row=>row.economicEligibility.canonicalPnlEligible&&Number.isFinite(row.funding)&&Number.isFinite(row.formalNetPnl));
  const accountingCoverage={
    external:rows.filter(row=>row.source==='EXTERNAL').length,
    duplicate:rows.filter(row=>row.canonical===false||row.duplicateOf!=null).length,
    noncanonical:rows.filter(row=>row.canonical===false||row.duplicateOf!=null).length,
    feeMissing:rows.filter(row=>row.status==='CLOSED'&&row.feeCompleteness!=='COMPLETE').length,
    cycleInconsistent:rows.filter(row=>row.ledgerConservation==='LEDGER_INCONSISTENT'||row.integrityFlags.includes('LEDGER_INCONSISTENT')).length,
    cycleUnconserved:rows.filter(row=>row.ledgerConservation==='UNCONSERVED').length,
    cycleUnproven:rows.filter(row=>row.ledgerConservation==='UNKNOWN'||row.ledgerConservation==null).length,
    localFundingUnknown:local.filter(row=>row.fundingAttributionStatus!=='EXACT').length,
    localAllInUnconfirmed:local.filter(row=>!row.economicEligibility.canonicalPnlEligible).length,
    localFundingExactEvidencePending:local.filter(row=>row.fundingAttributionStatus==='EXACT'&&!row.economicEligibility.canonicalPnlEligible).length,
    excludedClosed:rows.filter(row=>row.status==='CLOSED'&&!local.includes(row)).length,
    cycleCollision:[...cycleCounts.values()].filter(count=>count>1).reduce((sum,count)=>sum+count,0),
  };
  const prospective=input.experimentManifest?rows.filter(row=>row.economicEligibility.prospectiveCohortMember):null,prospectiveClosed=prospective?.filter(row=>row.economicEligibility.ledgerClosedComplete)??null,prospectiveCanonical=prospective?.filter(row=>row.economicEligibility.canonicalPnlEligible)??null;
  const quoteAsset=(r:TradeRecord)=>r.symbol.endsWith('USDC')?'USDC':r.symbol.endsWith('USDT')?'USDT':'UNKNOWN';
  const nativeAssets=[...new Set(local.map(quoteAsset))];
  const byAsset=Object.fromEntries(nativeAssets.map(asset=>{const group=local.filter(r=>quoteAsset(r)===asset),exact=localExact.filter(r=>quoteAsset(r)===asset);return [asset,{completeCycles:group.length,exFundingNet:group.reduce((n,r)=>n+(r.tradingNetPnlExFunding??0),0),canonicalEligible:exact.length,confirmedFunding:exact.length?exact.reduce((n,r)=>n+(r.funding??0),0):null,canonicalNetPnl:exact.length?exact.reduce((n,r)=>n+(r.formalNetPnl??0),0):null}];}));
  const aggregateProven=nativeAssets.length<=1&&!nativeAssets.includes('UNKNOWN');
  const canonicalNet=localExact.reduce((sum,row)=>sum+(row.formalNetPnl??0),0);
  const summary={semanticsVersion:'V3.9.3-A2-1',asOf,observedClosed:observedClosed.length,closedCompleteCount:ledger.length,completeClosed:ledger.length,
    ledgerReconciliationPending:observedClosed.filter(row=>!row.economicEligibility.ledgerClosedComplete).length,awaitingReconciliation:observedClosed.filter(row=>!row.economicEligibility.ledgerClosedComplete).length,
    fundingUnknownCount:ledger.filter(row=>row.fundingAttributionStatus!=='EXACT').length,legacyEconomicInconsistentCount:rows.filter(row=>row.economicEligibility.legacyEconomicInconsistent).length,identityOrLedgerIssueCount:rows.filter(row=>!row.economicEligibility.ledgerClosedComplete&&row.status==='CLOSED').length,
    tradingNetExFundingEligibleCount:local.length,tradingNetExFunding:local.reduce((sum,row)=>sum+(row.tradingNetPnlExFunding??0),0),canonicalPnlEligibleCount:localExact.length,canonicalNetPnl:localExact.length?canonicalNet:null,canonicalNetPnlStatus:localExact.length?'ELIGIBLE':'NO_ELIGIBLE_SAMPLES',canonicalCoverage:{eligible:localExact.length,ledgerClosedComplete:local.length,ratio:local.length?localExact.length/local.length:null},
    localAccounting:{exFundingNet:local.length?local.reduce((sum,row)=>sum+(row.tradingNetPnlExFunding??0),0):null,completeCycles:local.length,confirmedFunding:localExact.length?localExact.reduce((sum,row)=>sum+(row.funding??0),0):null,confirmedAllInNet:localExact.length?localExact.reduce((sum,row)=>sum+(row.formalNetPnl??0),0):null,confirmedAllInCycles:localExact.length,fundingUnknownCycles:accountingCoverage.localFundingUnknown,allInUnconfirmedCycles:accountingCoverage.localAllInUnconfirmed,fundingExactEvidencePendingCycles:accountingCoverage.localFundingExactEvidencePending,coverage:accountingCoverage},
    prospective:input.experimentManifest?{status:'AVAILABLE',experimentId:input.experimentManifest.experimentId,entryCycleCount:prospective!.length,closedCycleCount:prospectiveClosed!.length,canonicalPnlEligibleCount:prospectiveCanonical!.length}:{status:'MANIFEST_UNAVAILABLE',experimentId:null,entryCycleCount:null,closedCycleCount:null,canonicalPnlEligibleCount:null},
    completed:localExact.length,netPnl:localExact.length?canonicalNet:0};
  return {...summary,byAsset,aggregateAsset:aggregateProven?nativeAssets[0]??null:null,aggregateStatus:aggregateProven?'SINGLE_NATIVE_ASSET':'FX_UNPROVEN',tradingNetExFunding:aggregateProven?summary.tradingNetExFunding:null,canonicalNetPnl:aggregateProven?summary.canonicalNetPnl:null,netPnl:aggregateProven?summary.netPnl:null,localAccounting:{...summary.localAccounting,byAsset,exFundingNet:aggregateProven?summary.localAccounting.exFundingNet:null,confirmedFunding:aggregateProven?summary.localAccounting.confirmedFunding:null,confirmedAllInNet:aggregateProven?summary.localAccounting.confirmedAllInNet:null}};
}

export function filterFormalOutcome<T extends ReturnType<typeof projectTradeRecordRow>>(rows:T[],outcome:string|undefined):T[]{if(outcome==='WIN')return rows.filter(row=>row.formalOutcome==='WIN');if(outcome==='LOSS')return rows.filter(row=>row.formalOutcome==='LOSS');return rows;}

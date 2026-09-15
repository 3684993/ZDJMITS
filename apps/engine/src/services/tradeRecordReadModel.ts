import type {TradeRecord,TradingQualityEnrollmentEvidence,TradingQualityExperimentManifest,TradingQualityFundingEvidence} from '@zdj/contracts';
import {canonicalPnlEligible,ledgerClosedComplete,legacyEconomicInconsistency,prospectiveCohortMember} from './tradingQualityEligibility.js';

export type TradeRecordReadModelInput={records:TradeRecord[];accountScope?:string;fundingEvidenceByCycle?:Record<string,TradingQualityFundingEvidence|undefined>;experimentManifest?:TradingQualityExperimentManifest;enrollmentByCycle?:Record<string,TradingQualityEnrollmentEvidence|undefined>;asOf?:number;};

export function projectTradeRecordRow(record:TradeRecord,input:Omit<TradeRecordReadModelInput,'records'>={}){
  const fundingEvidence=record.cycleId?input.fundingEvidenceByCycle?.[record.cycleId]:undefined;
  const ledger=ledgerClosedComplete(record),canonical=canonicalPnlEligible(record,{fundingEvidence,accountScope:input.accountScope});
  const cohort=record.cycleId?prospectiveCohortMember(input.experimentManifest,input.enrollmentByCycle?.[record.cycleId]):{eligible:false,reasons:['CYCLE_ID_MISSING']};
  const legacyEconomicInconsistent=legacyEconomicInconsistency(record),rawNetPnl=record.netPnl;
  return {...record,rawNetPnl,
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
  const observedClosed=rows.filter(row=>row.closedAt!=null||row.observedClosedAt!=null),ledger=rows.filter(row=>row.economicEligibility.ledgerClosedComplete),exFunding=ledger.filter(row=>Number.isFinite(row.tradingNetPnlExFunding)),canonical=rows.filter(row=>row.economicEligibility.canonicalPnlEligible&&Number.isFinite(row.formalNetPnl));
  const prospective=input.experimentManifest?rows.filter(row=>row.economicEligibility.prospectiveCohortMember):null,prospectiveClosed=prospective?.filter(row=>row.economicEligibility.ledgerClosedComplete)??null,prospectiveCanonical=prospective?.filter(row=>row.economicEligibility.canonicalPnlEligible)??null;
  const canonicalNet=canonical.reduce((sum,row)=>sum+(row.formalNetPnl??0),0);
  return{semanticsVersion:'V3.9.3-A2-1',asOf,observedClosed:observedClosed.length,closedCompleteCount:ledger.length,completeClosed:ledger.length,
    ledgerReconciliationPending:observedClosed.filter(row=>!row.economicEligibility.ledgerClosedComplete).length,awaitingReconciliation:observedClosed.filter(row=>!row.economicEligibility.ledgerClosedComplete).length,
    fundingUnknownCount:ledger.filter(row=>row.fundingAttributionStatus!=='EXACT').length,legacyEconomicInconsistentCount:rows.filter(row=>row.economicEligibility.legacyEconomicInconsistent).length,identityOrLedgerIssueCount:rows.filter(row=>!row.economicEligibility.ledgerClosedComplete&&row.status==='CLOSED').length,
    tradingNetExFundingEligibleCount:exFunding.length,tradingNetExFunding:exFunding.reduce((sum,row)=>sum+(row.tradingNetPnlExFunding??0),0),canonicalPnlEligibleCount:canonical.length,canonicalNetPnl:canonical.length?canonicalNet:null,canonicalNetPnlStatus:canonical.length?'ELIGIBLE':'NO_ELIGIBLE_SAMPLES',canonicalCoverage:{eligible:canonical.length,ledgerClosedComplete:ledger.length,ratio:ledger.length?canonical.length/ledger.length:null},
    prospective:input.experimentManifest?{status:'AVAILABLE',experimentId:input.experimentManifest.experimentId,entryCycleCount:prospective!.length,closedCycleCount:prospectiveClosed!.length,canonicalPnlEligibleCount:prospectiveCanonical!.length}:{status:'MANIFEST_UNAVAILABLE',experimentId:null,entryCycleCount:null,closedCycleCount:null,canonicalPnlEligibleCount:null},
    completed:canonical.length,netPnl:canonical.length?canonicalNet:0};
}

export function filterFormalOutcome<T extends ReturnType<typeof projectTradeRecordRow>>(rows:T[],outcome:string|undefined):T[]{if(outcome==='WIN')return rows.filter(row=>row.formalOutcome==='WIN');if(outcome==='LOSS')return rows.filter(row=>row.formalOutcome==='LOSS');return rows;}

import type {TradeRecord} from '@zdj/contracts';
import {projectTradeRecordRow,type TradeRecordReadModelInput} from './tradeRecordReadModel.js';
import {ledgerClosedComplete} from './tradingQualityEligibility.js';

const DAY_MS=86_400_000;
type ProjectedRow=ReturnType<typeof projectTradeRecordRow>;
type AssetName='USDT'|'USDC'|'UNKNOWN';
const assetOf=(row:ProjectedRow):AssetName=>row.moneyAsset==='USDT'?'USDT':row.moneyAsset==='USDC'?'USDC':'UNKNOWN';
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const settledIn=(row:ProjectedRow,from:number,to:number)=>
  row.status==='CLOSED'&&finite(row.closedAt)&&row.closedAt>=from&&row.closedAt<to;
const provenLocal=(row:TradeRecord)=>
  ledgerClosedComplete(row).eligible&&finite(row.tradingNetPnlExFunding)&&
  ['SYSTEM','LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT'].includes(row.source)&&
  Boolean(row.cycleId)&&row.entryOrderIds.length>0&&row.exitOrderIds.length>0&&
  row.linkedFillIds.length>0&&!['UNCONSERVED','LEDGER_INCONSISTENT','UNKNOWN'].includes(row.ledgerConservation??'');
type MoneyBreakdown={
  asset:AssetName;cycles:number;winningCycles:number;losingCycles:number;flatCycles:number;
  grossProfit:number|null;grossLoss:number|null;netExFunding:number|null;
  entryFees:number|null;exitFees:number|null;totalFees:number|null;
  allInConfirmedCycles:number;allInConfirmedNet:number|null;fundingUnknownCycles:number;
};
const initial=(asset:AssetName):MoneyBreakdown=>({asset,cycles:0,winningCycles:0,losingCycles:0,flatCycles:0,
  grossProfit:null,grossLoss:null,netExFunding:null,entryFees:null,exitFees:null,totalFees:null,
  allInConfirmedCycles:0,allInConfirmedNet:null,fundingUnknownCycles:0});
function breakdown(rows:ProjectedRow[],asset:AssetName):MoneyBreakdown{
  const result=initial(asset);
  if(!rows.length)return result;
  const values=rows.map(row=>row.tradingNetPnlExFunding).filter(finite);
  if(values.length!==rows.length)return result;
  const entries=rows.map(row=>row.entryFee),exits=rows.map(row=>row.exitFee),fees=rows.map(row=>row.totalFee);
  result.cycles=rows.length;
  result.winningCycles=values.filter(v=>v>0).length;
  result.losingCycles=values.filter(v=>v<0).length;
  result.flatCycles=values.filter(v=>v===0).length;
  result.grossProfit=values.filter(v=>v>0).reduce((s,v)=>s+v,0);
  result.grossLoss=values.filter(v=>v<0).reduce((s,v)=>s-Math.abs(v),0);
  result.netExFunding=values.reduce((s,v)=>s+v,0);
  result.entryFees=entries.every(finite)?entries.reduce((s,v)=>s+Number(v),0):null;
  result.exitFees=exits.every(finite)?exits.reduce((s,v)=>s+Number(v),0):null;
  result.totalFees=fees.every(finite)?fees.reduce((s,v)=>s+Number(v),0):null;
  const exact=rows.filter(row=>row.economicEligibility.canonicalPnlEligible&&finite(row.formalNetPnl));
  result.allInConfirmedCycles=exact.length;
  result.allInConfirmedNet=exact.length?exact.reduce((s,row)=>s+row.formalNetPnl!,0):null;
  result.fundingUnknownCycles=rows.filter(row=>row.fundingAttributionStatus!=='EXACT').length;
  return result;
}

/** 24h close-time economics, never wallet deltas. Read-only and independent of formal funding eligibility.
 *  Unique physical cycles are required; a partial exit is not counted as a new closed cycle.
 *  All native quote assets remain separate. Unknown FX is never fabricated.
 */
export function projectTrade24hReadModel(input:{
  records:TradeRecord[];asOf?:number;autoSync?:{status?:string;lastSuccessAt?:number|null};
} & Omit<TradeRecordReadModelInput,'records'|'asOf'>){
  const asOf=input.asOf??Date.now(),from=asOf-DAY_MS;
  // Prune outside the 24h window before constructing expensive per-cycle proof projections.
  // Only lightweight ledger eligibility is needed to quarantine cross-window cycle collisions.
  const cycleCounts=new Map<string,number>();
  for(const record of input.records)if(provenLocal(record))
    cycleCounts.set(record.cycleId!, (cycleCounts.get(record.cycleId!)??0)+1);
  const closed=input.records.filter(record=>settledIn(record as ProjectedRow,from,asOf))
    .map(record=>projectTradeRecordRow(record,input));
  const eligible=closed.filter(row=>provenLocal(row)&&cycleCounts.get(row.cycleId!)===1);
  const excluded=closed.filter(row=>!eligible.includes(row));
  const byAsset={
    USDT:breakdown(eligible.filter(row=>assetOf(row)==='USDT'),'USDT'),
    USDC:breakdown(eligible.filter(row=>assetOf(row)==='USDC'),'USDC'),
  };
  const unknownAssetCycles=eligible.filter(row=>assetOf(row)==='UNKNOWN').length;
  const windowStatus=!input.autoSync?.lastSuccessAt?'SYNC_COVERAGE_UNCONFIRMED':
    input.autoSync.status==='ERROR'?'SYNC_ERROR':'RETAINED_LEDGER_ONLY';
  return{
    asOf,window:{from,to:asOf,durationMs:DAY_MS,basis:'CLOSED_AT_SETTLED_LEDGER_HALF_OPEN'},
    status:windowStatus,
    source:'ENGINE_RETAINED_CLOSED_COMPLETE_LINKED_CYCLES',
    accountingBasis:'TRADING_NET_EX_FUNDING_NATIVE_QUOTE_ASSET',
    assetPolicy:'USDT_AND_USDC_NOT_CONVERTED_OR_SUMMED',
    byAsset,coverage:{
      closedRows:closed.length,eligibleClosedCycles:eligible.length,excludedClosedRows:excluded.length,
      completeClosedRows:closed.filter(row=>row.economicEligibility.ledgerClosedComplete).length,
      ledgerUnprovenClosedRows:closed.filter(row=>!row.economicEligibility.ledgerClosedComplete).length,
      cycleCollisionRows:closed.filter(row=>provenLocal(row)&&cycleCounts.get(row.cycleId!)!==1).length,
      unknownAssetCycles,
      closedObservedWithoutSettledAt:input.records.filter(row=>row.status!=='CLOSED'&&finite(row.observedClosedAt)&&row.observedClosedAt>=from&&row.observedClosedAt<asOf).length,
      lastSyncSuccessAt:input.autoSync?.lastSuccessAt??null,
      syncStatus:input.autoSync?.status??'UNKNOWN',
    },
    aggregate:{status:unknownAssetCycles?'UNKNOWN_ASSET':
      byAsset.USDT.cycles&&byAsset.USDC.cycles?'MULTIPLE_NATIVE_ASSETS_NO_FX':
      eligible.length===0?'NO_ELIGIBLE_CYCLES':'SINGLE_NATIVE_ASSET',
      asset:unknownAssetCycles?null:byAsset.USDT.cycles&&byAsset.USDC.cycles?null:
        byAsset.USDT.cycles?'USDT':byAsset.USDC.cycles?'USDC':null,
      netExFunding:unknownAssetCycles||byAsset.USDT.cycles&&byAsset.USDC.cycles?null:
        byAsset.USDT.cycles?byAsset.USDT.netExFunding:byAsset.USDC.cycles?byAsset.USDC.netExFunding:null,
    },
    policy:{readOnly:true,exchangeRequests:0,backfillRequests:0,mutations:0,windowMayBeIncomplete:windowStatus!=='RETAINED_LEDGER_ONLY'},
  };
}

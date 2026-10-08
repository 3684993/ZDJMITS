import type {TradeRecord} from '@zdj/contracts';

/** Read-only diagnostics; never repair history or promote economic eligibility. */
export function tradeRecordDiagnostics(record:TradeRecord){
  const lots=record.entryLots??[],lotQuantity=lots.reduce((sum,lot)=>sum+lot.quantity,0);
  const entryKnown=typeof record.entryQty==='number'&&Number.isFinite(record.entryQty),lotsKnown=lots.every(l=>typeof l.quantity==='number'&&Number.isFinite(l.quantity));
  const tolerance=entryKnown?Math.max(1e-8,Math.abs(record.entryQty)*1e-8):1e-8;
  const entryLotMismatch=entryKnown&&lotsKnown?Math.abs(lotQuantity-record.entryQty)>tolerance:null;
  const remainingKnown=typeof record.remainingQty==='number'&&Number.isFinite(record.remainingQty),exitKnown=typeof record.exitQty==='number'&&Number.isFinite(record.exitQty);
  const negativeRemaining=remainingKnown?record.remainingQty! < -tolerance:null;
  const times=lots.map(l=>l.filledAt).filter((at):at is number=>Number.isSafeInteger(at)&&Number(at)>0);
  const observedClosedAt=record.observedClosedAt??null;
  return {recordedOpenedAt:record.openedAt,recordedDurationMs:record.durationMs,firstRetainedLotFillAt:times.length?Math.min(...times):null,
    timeCoverage:'RETAINED_FACTS_ONLY' as const,observedClosedAt,settledClosedAt:record.closedAt,
    lifecycleStatus:record.status==='CLOSED'?'RECORDED_CLOSED':observedClosedAt?'OBSERVED_FLAT_AWAITING_LEDGER':'LEDGER_OPEN_OR_INCOMPLETE',
    quoteAsset:record.symbol.endsWith('USDC')?'USDC':record.symbol.endsWith('USDT')?'USDT':'UNKNOWN',
    quantity:{entryQuantity:record.entryQty,retainedLotQuantity:lotsKnown?lotQuantity:null,exitQuantity:record.exitQty,remainingQuantity:record.remainingQty,entryLotMismatch,negativeRemaining,status:!entryKnown||!lotsKnown||!remainingKnown||!exitKnown?'UNKNOWN':entryLotMismatch||negativeRemaining?'INCONSISTENT_OR_INCOMPLETE':'NO_DETECTED_ARITHMETIC_MISMATCH'},
    pnlExtrema:{status:'UNKNOWN' as const,maxFloatingProfit:null,maxFloatingLoss:null,maxProfitAt:null,maxLossAt:null,coverage:'NO_VERIFIED_LIFECYCLE_INVENTORY_PRICE_PATH',scope:'FULL_POSITION_LIFECYCLE'}};
}

export function filterTradeRecordCategory<T extends {classification?:string}>(rows:T[],category:string){
  if(category==='ALL')return rows;
  return category==='ISSUES'?rows.filter(row=>['DUPLICATE','CONFLICT','INVALID'].includes(row.classification??'')):rows.filter(row=>row.classification===category);
}

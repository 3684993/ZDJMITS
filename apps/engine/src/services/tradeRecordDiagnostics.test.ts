import {expect,it} from 'vitest';
import {tradeRecordDiagnostics,filterTradeRecordCategory} from './tradeRecordDiagnostics.js';
it('exposes AVAX historical quantity disagreement without changing raw values, status or eligibility',()=>{
 const r:any={symbol:'AVAXUSDT',openedAt:1,closedAt:null,durationMs:null,observedClosedAt:90,status:'INCOMPLETE',classification:'PARTIAL',entryQty:288,exitQty:0,remainingQty:288,entryLots:[{quantity:1074,filledAt:3}]},before=JSON.stringify(r);const d=tradeRecordDiagnostics(r);expect(d.quantity).toMatchObject({entryQuantity:288,retainedLotQuantity:1074,entryLotMismatch:true});expect(d.lifecycleStatus).toBe('OBSERVED_FLAT_AWAITING_LEDGER');expect(d.settledClosedAt).toBeNull();expect(d.firstRetainedLotFillAt).toBe(3);expect(d.recordedOpenedAt).toBe(1);expect(d.pnlExtrema).toMatchObject({status:'UNKNOWN',maxFloatingLoss:null,maxLossAt:null});expect(JSON.stringify(r)).toBe(before);
});
it('does not turn a CLOSED label or price-only MFE into verified accounting/extrema',()=>{
 const d=tradeRecordDiagnostics({symbol:'ETHFIUSDC',status:'CLOSED',openedAt:1,closedAt:3,entryQty:1,exitQty:6,remainingQty:-5,entryLots:[]} as any);expect(d.quoteAsset).toBe('USDC');expect(d.quantity.negativeRemaining).toBe(true);expect(d.lifecycleStatus).toBe('RECORDED_CLOSED');expect(d.pnlExtrema.status).toBe('UNKNOWN');
});
it('ALL preserves incomplete, imported, external and issue histories independently of category',()=>{
 const rows=['COMPLETE','PARTIAL','IMPORTED','EXTERNAL','DUPLICATE','CONFLICT','INVALID'].map(classification=>({classification}));expect(filterTradeRecordCategory(rows,'ALL')).toHaveLength(7);expect(filterTradeRecordCategory(rows,'PARTIAL')).toEqual([rows[1]]);expect(filterTradeRecordCategory(rows,'ISSUES')).toHaveLength(3);expect(filterTradeRecordCategory(rows,'unknown')).toHaveLength(0);
});

it('missing historical quantity is UNKNOWN, not a zero or a successful reconciliation',()=>expect(tradeRecordDiagnostics({symbol:'ETHUSDT',status:'INCOMPLETE',entryQty:null,exitQty:null,remainingQty:null,entryLots:[]} as any).quantity.status).toBe('UNKNOWN'));

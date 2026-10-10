import {describe,expect,it} from 'vitest';
import {projectExitProvenance} from './exitProvenance.js';
import type {TradeRecord,ExecutionFill} from '@zdj/contracts';

const cycle={tradeId:'cycle-1',symbol:'WLDUSDT',direction:'LONG',cycleId:'cy-1',closedAt:10000,
  status:'CLOSED',exitQty:3,exitFillCount:1,exitOrderIds:['E1'],linkedFillIds:['fill-1']} as unknown as TradeRecord;
const fill={fillId:'fill-1',tradeId:'T1',symbol:'WLDUSDT',side:'SELL',orderId:'E1',clientOrderId:'C1',
  qty:3,price:1,executionTime:9000,cycleId:'cy-1'} as unknown as ExecutionFill;
describe('exit source conflict evidence',()=>{
  it('labels one exact TP exit as TP, never creates a conflict from fill completion',()=>{
    const x=projectExitProvenance(cycle,{executionFills:[fill],manualOrders:new Map(),
      tpOrders:new Map([['tp',{symbol:'WLDUSDT',clientOrderId:'C1',exchangeOrderId:'E1',cycleId:'cy-1'}]])});
    expect(x).toMatchObject({closeProvenance:'TP',identityConflict:false,quantityConflict:false,conflictReasons:[],provenanceEvidenceStatus:'PROVEN'});
  });
  it('keeps conflicting manual/TP evidence red with actionable reason, not a silently reassigned TP',()=>{
    const x=projectExitProvenance(cycle,{executionFills:[fill],
      manualOrders:new Map([['manual',{symbol:'WLDUSDT',clientOrderId:'C1',exchangeOrderId:'E1',reduceOnly:true,cycleId:'cy-1'}]]),
      tpOrders:new Map([['tp',{symbol:'WLDUSDT',clientOrderId:'C1',exchangeOrderId:'E1',cycleId:'cy-1'}]])});
    expect(x.closeProvenance).toBe('CONFLICT');
    expect(x.conflictReasons).toContain('SAME_FILL_MULTIPLE_EXIT_ROLES');
  });
  it('keeps registry identity conflict and cycle mismatch visible',()=>{
    const x=projectExitProvenance(cycle,{executionFills:[fill],manualOrders:new Map(),tpOrders:new Map(),
      orderProvenance:{resolve:()=>({status:'UNRESOLVED',proof:['PROVENANCE_ROLE_CONFLICT'],rows:[]})}});
    expect(x.identityConflict).toBe(true);
    expect(x.conflictReasons).toContain('PROVENANCE_ROLE_CONFLICT');
  });
  it('keeps uncovered fills UNKNOWN instead of inventing a role',()=>{
    const x=projectExitProvenance(cycle,{executionFills:[fill],manualOrders:new Map(),tpOrders:new Map()});
    expect(x).toMatchObject({closeProvenance:'UNKNOWN',identityConflict:false,provenanceEvidenceStatus:'INCOMPLETE_OR_UNKNOWN'});
  });
});

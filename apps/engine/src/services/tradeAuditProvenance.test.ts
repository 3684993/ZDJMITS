import {expect,it} from 'vitest';
import {tradeAuditProvenanceSymbols} from './tradeAuditProvenance.js';

it('selects real in-window order and fill provenance without sweeping old orders touched by reconciliation',()=>{
  const start=1_000,end=2_000;
  const orders=[
    {symbol:'OLDUSDT',createdAt:100,updatedAt:1_900},
    {symbol:'NEWUSDT',createdAt:1_100},
  ];
  expect(tradeAuditProvenanceSymbols(orders,[
    {symbol:'LATEUSDC',executionTime:1_800},
    {symbol:'OLDUSDT',executionTime:100},
  ],start,end)).toEqual(['NEWUSDT','LATEUSDC']);
});

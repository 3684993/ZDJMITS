import {describe,expect,it} from 'vitest';
import {tradeClosePresentation} from './tradeClosePresentation.js';
describe('trade close display uses provenance, never taker as a proxy',()=>{
  it('labels external exchange close facts as exchange close',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'EXCHANGE_CLOSE'}).label).toBe('交易所平仓'));
  it('keeps a system taker exit labeled system when its order provenance says EXIT',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'SYSTEM_EXIT',maker:false}).label).toBe('系统主动平仓'));
  it('does not guess when identity provenance is absent',()=>expect(tradeClosePresentation({closedAt:2,maker:false}).label).toBe('未知来源'));
  it('distinguishes mixed proved closes from conflicting identity',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'MIXED'}).label).toBe('多种已证实来源'));
  it('sort timestamp absence remains an open holding label',()=>expect(tradeClosePresentation({closedAt:null,closeProvenance:'EXCHANGE_CLOSE'}).label).toBe('持仓中'));
});

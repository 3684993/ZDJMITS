import {describe,expect,it} from 'vitest';
import {tradeClosePresentation} from './tradeClosePresentation.js';
it('labels TP plus exact manual exits without a conflict label',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'MIXED_TP_MANUAL'}).label).toBe('止盈＋人工平仓'));
describe('trade close display uses provenance, never taker as a proxy',()=>{
  it('labels external exchange close facts as exchange close',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'EXCHANGE_CLOSE'}).label).toBe('交易所平仓'));
  it('keeps a system taker exit labeled system when its order provenance says EXIT',()=>expect(tradeClosePresentation({closedAt:2,closeProvenance:'SYSTEM_EXIT',maker:false}).label).toBe('系统主动平仓'));
  it('does not guess when identity provenance is absent',()=>expect(tradeClosePresentation({closedAt:2,maker:false}).label).toBe('未知来源'));
  it('missing close time does not prove a current physical holding',()=>expect(tradeClosePresentation({closedAt:null,closeProvenance:'EXCHANGE_CLOSE'}).label).toBe('账本未闭合'));
});

it('labels an observed flat cycle independently of exact settlement',()=>expect(tradeClosePresentation({closedAt:null,observedClosedAt:20}).label).toBe('零仓待对账'));

it('shows exact proven reasons rather than silently replacing a conflict with TP',()=>{
  const result=tradeClosePresentation({closedAt:2,closeProvenance:'CONFLICT',conflictReasons:['SAME_FILL_MULTIPLE_EXIT_ROLES']});
  expect(result.label).toBe('来源冲突');
  expect(result.hint).toContain('SAME_FILL_MULTIPLE_EXIT_ROLES');
});

import { describe,expect,it } from 'vitest';
import { financialClass, pageItems, toggleExpanded } from './positionModel';

describe('position financial semantics and inline expansion model',()=>{
  it('maps positive, negative, zero, null, undefined and NaN without theme dependence',()=>{expect(financialClass(12.45)).toBe('financial-profit');expect(financialClass(-1.84)).toBe('financial-loss');expect(financialClass(0)).toBe('financial-neutral');expect(financialClass(null)).toBe('financial-neutral');expect(financialClass(undefined)).toBe('financial-neutral');expect(financialClass(Number.NaN)).toBe('financial-neutral');});
  it('keeps semantic class stable independently of theme names',()=>{for(const theme of ['BINANCE_NOIR','DUNHUANG_FINANCE','INSTITUTIONAL_BLUE','QUIET_MORNING','BURGUNDY_EDITORIAL']){expect(financialClass(-148.19)).toBe('financial-loss');expect(financialClass(12.45)).toBe('financial-profit');}});
  it('allows only one expanded symbol and supports close/reopen',()=>{expect(toggleExpanded(null,'PNUTUSDT')).toBe('PNUTUSDT');expect(toggleExpanded('PNUTUSDT','ZECUSDT')).toBe('ZECUSDT');expect(toggleExpanded('ZECUSDT','ZECUSDT')).toBeNull();});
  it('pages positions deterministically',()=>{const rows=Array.from({length:25},(_,i)=>i);expect(pageItems(rows,1,10)).toEqual(rows.slice(0,10));expect(pageItems(rows,3,10)).toEqual(rows.slice(20));});
});

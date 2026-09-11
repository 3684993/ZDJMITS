import { describe, expect, it } from 'vitest';
import { cleanupLimitPrice, isEligibleCleanupPnl } from './testnetLowLossCleanupService.js';
describe('Testnet low-loss cleanup guards',()=>{
  it('uses the strict open interval -10 < pnl < 0',()=>{expect(isEligibleCleanupPnl(-9.99)).toBe(true);expect(isEligibleCleanupPnl(-10)).toBe(false);expect(isEligibleCleanupPnl(0)).toBe(false);expect(isEligibleCleanupPnl(1)).toBe(false);});
  it('uses side-correct LIMIT prices',()=>{const q={bid:99,ask:101};expect(cleanupLimitPrice('LONG',true,q)).toBe(101);expect(cleanupLimitPrice('LONG',false,q)).toBe(99);expect(cleanupLimitPrice('SHORT',true,q)).toBe(99);expect(cleanupLimitPrice('SHORT',false,q)).toBe(101);});
});

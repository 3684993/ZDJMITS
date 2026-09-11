import {describe,expect,it} from 'vitest';
import {classifyAsset,isOnlineAsset} from './assetAdmission.js';

const now=Date.now(),settings:any={selection:{assetDirectory:{version:'V3.9.1',methodVersion:'V3.9.1-LIQUIDITY-30D-V4',reviewedAt:now-1000,nextReviewAt:now+100_000,evidenceHash:'hash',approvedLiquid:['SOL'],excluded:['BAD'],approvals:{SOL:{reviewedAt:now,quoteVolumeUsd24h:30_000_000,medianDailyQuoteVolumeUsd30d:30_000_000,tradeCount24h:30_000,openInterestUsd:6_000_000,listingAgeDays:200,liquidityComposite:.5}}}}};
describe('asset directory admission',()=>{
  it('keeps BTC and ETH core while unknown assets are research-only',()=>{expect(classifyAsset('BTCUSDT',settings).classification).toBe('CORE');expect(classifyAsset('ETHUSDC',settings).classification).toBe('CORE');expect(classifyAsset('UNKNOWNUSDT',settings).classification).toBe('RESEARCH_ONLY');});
  it('allows traceably approved assets and excludes explicit entries',()=>{expect(isOnlineAsset(classifyAsset('SOLUSDT',settings))).toBe(true);expect(classifyAsset('BADUSDT',settings).classification).toBe('EXCLUDED');});
  it('does not grandfather a name-only or expired legacy approval',()=>{const legacy=structuredClone(settings);legacy.selection.assetDirectory.methodVersion='V3.7.3-LIQUIDITY-30D-V3';expect(classifyAsset('SOLUSDT',legacy,now).reason).toBe('LEGACY_DIRECTORY_METHOD');legacy.selection.assetDirectory.methodVersion='V3.9.1-LIQUIDITY-30D-V4';legacy.selection.assetDirectory.nextReviewAt=now-1;expect(classifyAsset('SOLUSDT',legacy,now).reason).toBe('ASSET_APPROVAL_EXPIRED');});
});

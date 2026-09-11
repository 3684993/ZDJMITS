import { describe, expect, it, vi } from 'vitest';
import { AssetGovernanceCoordinator } from './assetGovernanceCoordinator.js';

const approval = (graceUntil = 200) => ({ symbol: 'SOLUSDT', reason: 'old', reviewedAt: 1, validUntil: 100, graceUntil, lkgSourceFailed: true, quoteVolumeUsd24h: 30_000_000, medianDailyQuoteVolumeUsd30d: 30_000_000, tradeCount24h: 30_000, openInterestUsd: 6_000_000, listingAgeDays: 200, liquidityComposite: .5 });
const settings = (version = 1, directory: any = { approvedLiquid: [], excluded: [], approvals: {}, nextReviewAt: 100 }) => ({ settingsVersion: version, selection: { assetDirectory: directory } });
const review = (evidence: any[] = [], reviewedAt = 100, nextReviewAt = 10_000): any => ({ version: 'r', reviewedAt, nextReviewAt, sourceDomain: 'PRODUCTION_PUBLIC_RESEARCH', methodVersion: 'V4', evidenceHash: 'new', approvedLiquid: [], approvals: {}, evidence });

describe('asset governance coordinator', () => {
  it('does not request before due and single-flights manual with scheduled research', async () => {
    let now = 0, current: any = settings(), release!: () => void;
    const wait = new Promise<void>(resolve => release = resolve), research = vi.fn(async () => { await wait; return review(); });
    const c = new AssetGovernanceCoordinator({ getSettings: () => current, review: research, publish: async (next: any) => current = { ...next, settingsVersion: 2 }, emit: () => {}, now: () => now });
    expect((await c.tick()).status).toBe('NOT_DUE'); now = 100;
    const scheduled = c.tick(), manual = c.tick(true, 'MANUAL'); expect(scheduled).toBe(manual);
    release(); expect((await scheduled).status).toBe('PUBLISHED'); expect(research).toHaveBeenCalledOnce();
  });
  it('backs off top-level failures and retries source failures before a distant directory refresh', async () => {
    let now = 100, current: any = settings(), events: any[] = [], topLevelAttempts = 0;
    const failing = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => { topLevelAttempts++; if (topLevelAttempts < 3) throw new Error(topLevelAttempts === 1 ? 'TICKER_FAILED' : 'EXCHANGE_INFO_FAILED'); return review(); }, publish: async (next: any) => current = { ...next, settingsVersion: 2 }, emit: (t, p) => events.push([t, p]), now: () => now });
    expect((await failing.tick()).status).toBe('FAILED'); expect((await failing.tick()).status).toBe('NOT_DUE'); now += 30_000; expect((await failing.tick()).status).toBe('FAILED'); now += 60_000; expect((await failing.tick()).status).toBe('PUBLISHED'); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_DEGRADED')).toHaveLength(1); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_RECOVERED')).toHaveLength(1);
    now = 0; current = settings(1, { approvedLiquid: ['SOL'], excluded: [], approvals: { SOL: approval(86_400_000) }, nextReviewAt: 7 * 86_400_000 }); let calls = 0;
    const partial = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => { calls++; return review([{ symbol: 'SOLUSDT', evidenceStatus: 'SOURCE_FAILED' }], now, now + 7 * 86_400_000); }, publish: async (next: any) => current = { ...next, settingsVersion: 2 }, emit: (t, p) => events.push([t, p]), now: () => now });
    const result: any = await partial.tick(true); expect(result.retryAt).toBe(30_000); expect(current.selection.assetDirectory.lkgAssets).toEqual(['SOL']); const published=events.filter(([type])=>type==='ASSET_DIRECTORY_PUBLISHED').at(-1)?.[1]; expect(published).toMatchObject({rawReview:{approvedCount:0,evidenceHash:'new'},publishedDirectory:{approvedCount:1,lkgAssets:['SOL'],evidenceHash:'new'}}); expect((await partial.tick()).status).toBe('NOT_DUE'); now = 30_000; await partial.tick(); expect(calls).toBe(2);
  });
  it('expires an LKG once while research is hung', async () => {
    let now = 100, current: any = settings(1, { approvedLiquid: ['SOL'], excluded: [], approvals: { SOL: approval(150) }, nextReviewAt: 100 }), release!: () => void;
    const wait = new Promise<void>(resolve => release = resolve), events: any[] = [];
    const c = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => { await wait; return review(); }, publish: async (next: any) => current = next, emit: (t, p) => events.push([t, p]), now: () => now });
    const inFlight = c.tick(); now = 151; expect(c.tick()).toBe(inFlight); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_EXPIRED')).toHaveLength(1); c.tick(); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_EXPIRED')).toHaveLength(1); release(); await inFlight;
  });
  it('deduplicates normal-approval expiry and emits recovery after a fresh publication', async () => {
    let now = 20, current: any = settings(1, { approvedLiquid: ['SOL'], excluded: [], nextReviewAt: 10, approvals: { SOL: { ...approval(10), lkgSourceFailed: false, validUntil: 10 } } }); const events: any[] = [];
    const fresh: any = review([], now, now + 100); fresh.approvedLiquid = ['SOL']; fresh.approvals = { SOL: { ...approval(now + 100), lkgSourceFailed: false, validUntil: now + 100 } };
    const c = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => fresh, publish: async (next: any) => current = { ...next, settingsVersion: 2 }, emit: (type, payload) => events.push([type, payload]), now: () => now });
    expect((await c.tick(true)).status).toBe('PUBLISHED'); c.observeExpiry(); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_EXPIRED')).toHaveLength(1); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_RECOVERED')).toHaveLength(1);
  });
  it('does not force-publish a stale review after a CAS conflict', async () => {
    let now = 100, current: any = settings(), events: any[] = [];
    const c = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => review(), publish: async () => { current = settings(2); throw new Error('SETTINGS_VERSION_CONFLICT'); }, emit: (t, p) => events.push([t, p]), now: () => now });
    expect((await c.tick()).status).toBe('CONFLICT'); expect(current.settingsVersion).toBe(2); expect((await c.tick()).status).toBe('NOT_DUE'); expect(events.filter(([type]) => type === 'ASSET_DIRECTORY_PUBLISH_CONFLICT')).toHaveLength(1);
  });
  it('keeps preview read-only even when an explicit apply starts concurrently', async () => {
    let current: any = settings(), releasePreview!: () => void, releaseApply!: () => void, calls = 0, publishes = 0;
    const previewWait = new Promise<void>(resolve => releasePreview = resolve), applyWait = new Promise<void>(resolve => releaseApply = resolve);
    const c = new AssetGovernanceCoordinator({ getSettings: () => current, review: async () => { calls++; await (calls === 1 ? previewWait : applyWait); return review(); }, publish: async (next: any) => { publishes++; return current = { ...next, settingsVersion: 2 }; }, emit: () => {}, now: () => 100 });
    const preview = c.preview(), apply = c.tick(true, 'MANUAL');
    releasePreview(); await preview; expect(publishes).toBe(0);
    releaseApply(); expect((await apply).status).toBe('PUBLISHED'); expect(publishes).toBe(1); expect(calls).toBe(2);
  });
});

import { mergeAssetDirectoryReview, type AssetDirectoryReview } from './productionAssetResearch.js';

type Settings = any;
type Trigger = 'SCHEDULE' | 'MANUAL';
type GovernanceStatus = 'HEALTHY' | 'DEGRADED' | 'EXPIRED';

/** The sole review-to-CAS-publication path; a captured version prevents stale research from overwriting an edit. */
export class AssetGovernanceCoordinator {
  private inFlight: Promise<any> | null = null;
  private retryAt = 0;
  private failures = 0;
  private status: GovernanceStatus = 'HEALTHY';

  constructor(private readonly deps: {
    getSettings: () => Settings;
    review: (settings: Settings) => Promise<AssetDirectoryReview>;
    publish: (settings: Settings, expectedVersion: number) => Promise<Settings>;
    emit: (type: string, payload: any) => void;
    now?: () => number;
  }) {}

  private clock() { return this.deps.now?.() ?? Date.now(); }
  private lkgDeadline(directory: any) {
    const values = Object.values(directory.approvals ?? {}).filter((a: any) => a.lkgSourceFailed).map((a: any) => Number(a.graceUntil ?? NaN)).filter(Number.isFinite);
    return values.length ? Math.min(...values) : Infinity;
  }
  /** Must run even while an I/O request is pending. */
  observeExpiry(trigger: Trigger = 'SCHEDULE') {
    const directory = this.deps.getSettings().selection.assetDirectory, now = this.clock();
    const approvals = Object.entries(directory.approvals ?? {}), expiredApprovals = approvals.filter(([, a]: any) => { const validUntil=Number(a.validUntil ?? directory.nextReviewAt ?? NaN), effectiveUntil=Number(a.lkgSourceFailed ? a.graceUntil ?? validUntil : validUntil); return Number.isFinite(effectiveUntil) && effectiveUntil < now; }).map(([asset]) => asset), expiredLkg = approvals.filter(([asset]) => expiredApprovals.includes(asset) && (directory.approvals as any)[asset].lkgSourceFailed).map(([asset]) => asset);
    if (!approvals.length && Number(directory.nextReviewAt ?? Infinity) < now) expiredApprovals.push(...(directory.approvedLiquid ?? []));
    const next: GovernanceStatus = expiredApprovals.length ? 'EXPIRED' : this.failures ? 'DEGRADED' : 'HEALTHY';
    if (next === this.status) return;
    const previous = this.status;
    this.status = next;
    if (next === 'HEALTHY') this.deps.emit('ASSET_DIRECTORY_RECOVERED', { trigger, previousStatus: previous });
    else if (next === 'EXPIRED') this.deps.emit('ASSET_DIRECTORY_EXPIRED', { trigger, expiredApprovals, expiredLkg, retryAt: this.retryAt || null });
    else this.deps.emit('ASSET_DIRECTORY_DEGRADED', { trigger, retryAt: this.retryAt || null });
  }
  private nextDue(directory: any) {
    // A retry deadline remains the next request deadline even after it passes.
    if (this.retryAt) return this.retryAt;
    return Math.min(Number(directory.nextReviewAt ?? 0), this.lkgDeadline(directory));
  }
  private scheduleRetry(now: number) {
    this.failures++;
    this.retryAt = now + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(this.failures - 1, 5));
  }
  private reviewHasSourceFailure(review: AssetDirectoryReview) { return review.evidence.some((row: any) => row.evidenceStatus === 'SOURCE_FAILED'); }

  /** Read-only research. It never shares or promotes the publishing flight. */
  async preview(trigger: Trigger = 'MANUAL') {
    const initial = this.deps.getSettings(), review = await this.deps.review(initial), directory = mergeAssetDirectoryReview(initial.selection.assetDirectory, review, this.clock());
    this.deps.emit('ASSET_DIRECTORY_PREVIEWED', { trigger, settingsVersion: initial.settingsVersion, rawReview: { approvedCount: review.approvedLiquid.length, evidenceHash: review.evidenceHash }, previewDirectory: { approvedCount: directory.approvedLiquid.length, lkgAssets: directory.lkgAssets, evidenceHash: directory.evidenceHash } });
    return { status: 'PREVIEW', review, directory, settingsVersion: initial.settingsVersion };
  }

  tick(force = false, trigger: Trigger = 'SCHEDULE') {
    this.observeExpiry(trigger);
    if (this.inFlight) return this.inFlight;
    const initial = this.deps.getSettings();
    if (!force && this.clock() < this.nextDue(initial.selection.assetDirectory)) return Promise.resolve({ status: 'NOT_DUE', retryAt: this.retryAt || null });
    // Assignment precedes review(), making timer/manual calls one single flight.
    this.inFlight = (async () => {
      try {
        const review = await this.deps.review(initial);
        const directory = mergeAssetDirectoryReview(initial.selection.assetDirectory, review, this.clock());
        const saved = await this.deps.publish({ ...initial, selection: { ...initial.selection, assetDirectory: directory } }, initial.settingsVersion);
        if (this.reviewHasSourceFailure(review)) this.scheduleRetry(this.clock());
        else { this.failures = 0; this.retryAt = 0; }
        this.observeExpiry(trigger);
        this.deps.emit('ASSET_DIRECTORY_PUBLISHED', { trigger, settingsVersion: saved.settingsVersion, rawReview: { approvedCount: review.approvedLiquid.length, evidenceHash: review.evidenceHash }, publishedDirectory: { approvedCount: directory.approvedLiquid.length, lkgAssets: directory.lkgAssets, evidenceHash: directory.evidenceHash }, retryAt: this.retryAt || null });
        return { status: 'PUBLISHED', settings: saved, review, directory, retryAt: this.retryAt || null };
      } catch (error) {
        const now = this.clock(), message = error instanceof Error ? error.message : String(error);
        if (message === 'SETTINGS_VERSION_CONFLICT') {
          this.retryAt = now + 60_000; // newer human/governance settings win; no retry storm
          this.deps.emit('ASSET_DIRECTORY_PUBLISH_CONFLICT', { trigger, retryAt: this.retryAt });
          return { status: 'CONFLICT', retryAt: this.retryAt };
        }
        this.scheduleRetry(now);
        this.observeExpiry(trigger);
        return { status: 'FAILED', error: message, retryAt: this.retryAt };
      } finally { this.inFlight = null; }
    })();
    return this.inFlight;
  }
}

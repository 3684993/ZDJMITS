// Read-only G1 attribution: list AllocationPlans whose side exposure already exceeds the legacy
// portfolioIntelligence.maxLong/ShortExposurePct, and show whether the direction authority vetoed them.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const dataDir = process.argv[2] ?? 'data';
const base = process.argv[3] ?? 'http://127.0.0.1:8080/api/v3';
const since = Number(process.argv[4] ?? 0);
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const response = await fetch(`${base}/settings`);
if (!response.ok) throw new Error(`/settings -> HTTP ${response.status}`);
const raw = await response.json();
const settings = raw.settings ?? raw;
const legacy = {LONG: settings.portfolioIntelligence?.maxLongExposurePct, SHORT: settings.portfolioIntelligence?.maxShortExposurePct};
const authoritative = {maxDirectionExposurePct: settings.riskGovernance?.maxDirectionExposurePct,
  directionPolicy: settings.riskGovernance?.exposureCapacityPolicy?.direction};

const plans = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='allocationPlans'").all()
  .map((r) => JSON.parse(r.payload)).filter((p) => Number(p.createdAt ?? 0) >= since)
  .map((p) => {
    const before = Number(p.exposureBefore?.[p.direction === 'LONG' ? 'longExposurePct' : 'shortExposurePct']);
    const after = Number(p.exposureAfter?.[p.direction === 'LONG' ? 'longExposurePct' : 'shortExposurePct']);
    return {symbol: p.symbol, direction: p.direction, admission: p.admission, reasons: p.reasons, notionalUsd: p.notionalUsd,
      marginUsd: p.marginUsd, locationWouldBlock: p.locationWouldBlock ?? null, minExecutableMarginUsd: p.minExecutableMarginUsd ?? null,
      legacyDirectionLimitPct: legacy[p.direction], exceedsLegacyLimit: after > legacy[p.direction],
      exposureBeforePct: before, exposureAfterPct: after,
      rejectedByLegacyThreshold: p.admission === 'REJECT_EXPOSURE_LIMIT' && after > legacy[p.direction]};
  });
const pipeline = await (await fetch(`${base}/pipeline`)).json();
const exposure = pipeline.capacityVisibility?.exposure ?? {};

console.log(JSON.stringify({
  authorities: {legacyPortfolioIntelligence: legacy, authoritativeRiskGovernance: authoritative,
    note: 'legacy values are read-only diagnostics once exposureCapacityPolicy.direction is OBSERVE; the Engine never vetoes on them'},
  liveExposureBlock: {gross: exposure.gross, LONG: exposure.LONG, SHORT: exposure.SHORT},
  sideStatus: pipeline.capacityVisibility?.sideStatus ?? null,
  totals: {plans: plans.length, aboveLegacyLimit: plans.filter((p) => p.exceedsLegacyLimit).length,
    admittedAboveLegacyLimit: plans.filter((p) => p.exceedsLegacyLimit && p.admission === 'ALLOW').length,
    vetoedByLegacyThreshold: plans.filter((p) => p.rejectedByLegacyThreshold).length},
  plans,
}, null, 1));

// §B2 read-only forensics: why each historical UNKNOWN still occupies (or does not occupy) pending risk.
// Nothing here writes: the durable rows, their status and their audit history are only read.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const dataDir = process.argv[2] ?? 'data';
const days = Number(process.argv[3] ?? 7);
const since = Date.now() - days * 86_400_000;
const {entryOrderOccupiesRisk, hasVerifiedNoActiveRisk, historicalNoRiskEligible, remoteFactAuditClass, UNKNOWN_RISK_EVIDENCE_TIER_MS} =
  await import(pathToFileURL(path.resolve('apps/engine/dist/services/entryRiskOccupancy.js')).href);

const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const rows = db.prepare("SELECT entity_id id, payload FROM runtime_entities WHERE kind='entryOrders'").all()
  .map((row) => ({id: row.id, order: JSON.parse(row.payload)}))
  .filter((row) => row.order.status === 'UNKNOWN');

const blockerEvents = db.prepare("SELECT json_extract(payload,'$.reason') reason, json_extract(payload,'$.symbol') symbol, ts FROM runtime_events WHERE type='ENTRY_DECISION_BLOCKED' AND ts>=? AND json_extract(payload,'$.reason') LIKE 'PENDING_RISK_UNVERIFIED%'").all(since);
const proofEvents = db.prepare("SELECT json_extract(payload,'$.orderId') orderId, json_extract(payload,'$.reason') reason, json_extract(payload,'$.occupancyReleased') released, json_extract(payload,'$.evidence.checkedAt') proofFrom, json_extract(payload,'$.evidence.validUntil') proofUntil, json_extract(payload,'$.auditTier') tier, ts FROM runtime_events WHERE ts>=? AND type IN ('ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT','ENTRY_ORDER_REMOTE_STATUS_RENEWED','ENTRY_ORDER_RISK_FACT_COVERAGE_INCOMPLETE','ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED','ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED','ENTRY_ORDER_IDENTITY_CONFLICT','ENTRY_ORDER_ACTIVE_RESTORED') ORDER BY ts ASC").all(since);
const probeErrors = db.prepare("SELECT json_extract(payload,'$.orderId') orderId, json_extract(payload,'$.message') message, COUNT(*) n FROM runtime_events WHERE ts>=? AND type IN ('ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED','ENTRY_ORDER_HISTORICAL_VERIFY_FAILED','ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED') GROUP BY orderId, message ORDER BY n DESC LIMIT 400").all(since);

const inconclusiveCauses = db.prepare("SELECT json_extract(payload,'$.orderId') orderId, type, ts FROM runtime_events WHERE ts>=? AND type IN ('ENTRY_ORDER_RISK_FACT_COVERAGE_INCOMPLETE','ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED','ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED') ORDER BY ts ASC").all(since);
// Which inconclusive sub-branch produced each block inside a proof window decides what a renewal may
// safely preserve: an unobserved window keeps the old proof, a newly attributed position must not.
const causeNearBlock = (id, at) => {
  const near = inconclusiveCauses.filter((row) => row.orderId === id && Math.abs(Number(row.ts) - at) <= 90_000).at(-1);
  return near?.type ?? 'NO_NAMED_CAUSE';
};
const now = Date.now();
// Proof timeline, rebuilt only from durable event facts: a release event opens the window its own
// payload names ([evidence.checkedAt, evidence.validUntil]), and any later non-release re-probe
// closes the window that is still open at that instant. That is exactly what the live predicate
// sees, so a block inside an open window is a genuine second authority rather than a lapse.
const proofTimelines = new Map();
for (const event of proofEvents) {
  if (!event.orderId) continue;
  const timeline = proofTimelines.get(event.orderId) ?? [];
  proofTimelines.set(event.orderId, timeline);
  if (String(event.released) === '1' && Number.isFinite(Number(event.proofFrom)) && Number(event.proofUntil) > Number(event.proofFrom)) {
    timeline.push({from: Number(event.proofFrom), until: Number(event.proofUntil), tier: Number(event.tier) || 0, interrupted: null});
    continue;
  }
  if (String(event.released) === '0') {
    const open = timeline.find((window) => Number(event.ts) > window.from && Number(event.ts) < window.until);
    if (open) open.interrupted = {at: Number(event.ts), reason: event.reason ?? null};
  }
}
const proofWindowAt = (id, at) => (proofTimelines.get(id) ?? []).find((window) => at >= window.from && (window.interrupted ? at < window.interrupted.at : at <= window.until)) ?? null;
const renewalGaps = (id) => {
  const windows = (proofTimelines.get(id) ?? []).slice().sort((a, b) => a.from - b.from);
  const gaps = [];
  for (let i = 1; i < windows.length; i++) {
    const previousClose = windows[i - 1].interrupted ? windows[i - 1].interrupted.at : windows[i - 1].until;
    gaps.push(Math.round((windows[i].from - previousClose) / 1000));
  }
  return {renewals: windows.length, lateRenewals: gaps.filter((gap) => gap > 0).length, maxLatenessSec: gaps.length ? Math.max(...gaps) : 0};
};
const interruptedProofs = [...proofTimelines.values()].flat().filter((window) => window.interrupted).length;
const bucketOf = (order) => {
  const evidence = order.activeRiskEvidence ?? null;
  const fresh = hasVerifiedNoActiveRisk(order, now);
  const occupying = entryOrderOccupiesRisk(order, now);
  const blocked = blockerEvents.filter((row) => String(row.reason ?? '').endsWith(`order:${order.id}`));
  const lastBlock = blocked.at(-1);
  const proofValid = Number(evidence?.validUntil ?? 0) > now;
  const proofExists = evidence?.status === 'VERIFIED_NO_ACTIVE_RISK';
  const conflicting = evidence?.status === 'CONFLICT' || (evidence?.sources ?? []).some((source) => /PRESENT|REAPPEARED|ATTRIBUTED/.test(String(source)));
  const identityTombstone = `ENTRY:${String(order.symbol).toUpperCase()}:${String(order.clientOrderId ?? order.exchangeOrderId ?? order.id)}`;
  const identityMismatch = Boolean(evidence?.identityTombstone) && evidence.identityTombstone !== identityTombstone;
  const realFill = Number(order.filledQuantity ?? 0) > 0 || (order.fills ?? []).length > 0;
  const remoteOrder = Boolean(order.exchangeOrderId);
  // `historicalNoRiskEligible` is the code's own definition of "every remote source proved absence",
  // including the variant where a position exists but is proven to belong to another cycle. Re-deriving
  // that test here from source names would put a row in the wrong bucket and misreport the root cause.
  const fullyProven = historicalNoRiskEligible(order, now);
  // A released row that was still blocked *inside a proof window that had already been opened and
  // not yet invalidated* is a second status-only authority. Blocks that fall in a gap between
  // windows are the other failure mode: the proof had lapsed and had not been renewed yet.
  const blockedWhileProven = blocked.filter((row) => proofWindowAt(order.id, Number(row.ts)) !== null).length;
  if (!occupying && blocked.length) {
    if (blockedWhileProven) return {bucket: 'E', why: `PENDING_RISK_UNVERIFIED emitted ${blockedWhileProven}x while an unexpired VERIFIED_NO_ACTIVE_RISK window already covered that instant`, lastBlock, blockedWhileProven};
    return {bucket: 'B', why: `every block fell in a proof gap: renewal arrived after the window closed (current TTL ${Math.round((Number(evidence?.validUntil ?? 0) - Number(evidence?.checkedAt ?? 0)) / 60000)} min, tier ${order.remoteAudit?.tier ?? 0})`, lastBlock, blockedWhileProven};
  }
  if (occupying && fresh) return {bucket: 'E', why: 'occupiesRisk=true while hasVerifiedNoActiveRisk=true', lastBlock, blockedWhileProven};
  if (realFill || remoteOrder) return {bucket: 'D', why: remoteOrder ? 'recorded exchangeOrderId' : 'recorded fill quantity', lastBlock};
  if (fullyProven && proofValid) return {bucket: 'A', why: 'fresh VERIFIED_NO_ACTIVE_RISK across every remote source, does not occupy risk', lastBlock};
  if (conflicting) return {bucket: 'C', why: `positive exchange risk fact: ${(evidence?.sources ?? []).join(',')}`, lastBlock};
  if (identityMismatch) return {bucket: 'C', why: 'identity tombstone no longer matches the row', lastBlock};
  if (!proofExists) return {bucket: 'C', why: 'no VERIFIED_NO_ACTIVE_RISK evidence row at all (probe still inconclusive: coverage gap or ambiguous position)', lastBlock};
  {
    const lapsedMin = lastBlock ? Math.round((Number(lastBlock.ts) - Number(evidence.checkedAt ?? 0)) / 60000) : null;
    return {bucket: 'B', why: `proof lapsed before renewal (TTL ${Math.round((Number(evidence.validUntil ?? 0) - Number(evidence.checkedAt ?? 0)) / 60000)} min, tier ${order.remoteAudit?.tier ?? 0}); last block ${lapsedMin} min after the last proof`, lastBlock};
  }
};

const buckets = {};
const detailed = [];
for (const {id, order} of rows) {
  const verdict = bucketOf(order);
  const events = proofEvents.filter((row) => row.orderId === id);
  const releases = events.filter((row) => String(row.released) === '1').length;
  const holds = events.filter((row) => String(row.released) === '0').length;
  const key = verdict.bucket;
  buckets[key] = buckets[key] ?? {count: 0, oldestDays: 0, blocks: 0, duplicateAudits: 0, ids: [], reasons: new Set()};
  buckets[key].count++;
  buckets[key].oldestDays = Math.max(buckets[key].oldestDays, Math.round((now - Number(order.createdAt ?? now)) / 86_400_00));
  buckets[key].blocks += blockerEvents.filter((row) => String(row.reason ?? '').endsWith(`order:${id}`)).length;
  buckets[key].duplicateAudits += events.length;
  buckets[key].ids.push(id);
  buckets[key].reasons.add(verdict.why);
  detailed.push({id, symbol: order.symbol, status: order.status, createdAt: order.createdAt, ageDays: Math.round((now - Number(order.createdAt ?? now)) / 86_400_0),
    exchangeOrderId: order.exchangeOrderId ?? null, filledQuantity: order.filledQuantity, activeRiskExposure: order.activeRiskExposure ?? null,
    evidenceStatus: order.activeRiskEvidence?.status ?? null, evidenceCheckedAt: order.activeRiskEvidence?.checkedAt ?? null,
    evidenceValidUntil: order.activeRiskEvidence?.validUntil ?? null, evidenceTtlMin: order.activeRiskEvidence ? Math.round((Number(order.activeRiskEvidence.validUntil) - Number(order.activeRiskEvidence.checkedAt)) / 60000) : null,
    auditTier: order.remoteAudit?.tier ?? null, consecutive: order.remoteAudit?.consecutive ?? null, nextAuditAt: order.remoteAudit?.nextAuditAt ?? null,
    occupiesRisk: entryOrderOccupiesRisk(order, now), historicalNoRiskEligible: historicalNoRiskEligible(order, now), auditClass: remoteFactAuditClass(order),
    proofEvents7d: events.length, releaseProofs7d: releases, holdProofs7d: holds, blocks7d: blockerEvents.filter((row) => String(row.reason ?? '').endsWith(`order:${id}`)).length,
    lastBlockAt: verdict.lastBlock ? Number(verdict.lastBlock.ts) : null, blockedWhileProven: verdict.blockedWhileProven ?? 0,
    inWindowBlockCauses: blockerEvents.filter((row) => String(row.reason ?? '').endsWith(`order:${id}`) && proofWindowAt(id, Number(row.ts)) !== null).map((row) => causeNearBlock(id, Number(row.ts))),
    ...renewalGaps(id), bucket: key, why: verdict.why});
}

const topErrors = probeErrors.slice(0, 12);
console.log(JSON.stringify({
  generatedAt: new Date(now).toISOString(), windowDays: days, unknownRows: rows.length,
  tierLadderMs: [...UNKNOWN_RISK_EVIDENCE_TIER_MS],
  buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, {count: value.count, oldestDays: Math.round(value.oldestDays / 10),
    pendingRiskBlocks7d: value.blocks, remoteAuditEvents7d: value.duplicateAudits, distinctReasons: [...value.reasons].slice(0, 6), sampleIds: value.ids.slice(0, 6)}])),
  occupyingNow: detailed.filter((row) => row.occupiesRisk).length,
  notOccupyingButBlocked: detailed.filter((row) => !row.occupiesRisk && row.blocks7d > 0).map((row) => ({id: row.id, symbol: row.symbol, blocks7d: row.blocks7d, lastBlockAt: row.lastBlockAt, blockedWhileProven: row.blockedWhileProven, bucket: row.bucket})),
  blocksInsideProofWindow: detailed.reduce((n, row) => n + row.blockedWhileProven, 0),
  inWindowBlockCauseTally: Object.fromEntries(detailed.flatMap((row) => row.inWindowBlockCauses).reduce((map, cause) => map.set(cause, (map.get(cause) ?? 0) + 1), new Map())),
  proofWindows7d: [...proofTimelines.values()].flat().length,
  proofWindowsInterruptedByInconclusiveProbe: interruptedProofs,
  renewalLateness: (() => {
    const all = detailed.filter((row) => row.renewals > 1);
    const late = all.reduce((n, row) => n + row.lateRenewals, 0);
    return {rowsWithRenewals: all.length, windowToWindowTransitions: all.reduce((n, row) => n + row.renewals - 1, 0), lateRenewals: late, maxLatenessSec: all.length ? Math.max(...all.map((row) => row.maxLatenessSec)) : 0};
  })(),
  ttlSpread: Object.fromEntries(detailed.filter((row) => row.evidenceTtlMin != null).reduce((map, row) => map.set(row.evidenceTtlMin, (map.get(row.evidenceTtlMin) ?? 0) + 1), new Map())),
  nextAuditSpreadMin: detailed.filter((row) => row.nextAuditAt).map((row) => Math.round((Number(row.nextAuditAt) - now) / 60000)).sort((a, b) => a - b).slice(0, 10),
  topProbeErrors: topErrors,
  rows: detailed.sort((a, b) => b.blocks7d - a.blocks7d).slice(0, 25),
}, null, 2));
db.close();

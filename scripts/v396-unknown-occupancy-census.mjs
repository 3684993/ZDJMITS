// Phase 1 read-only census: which durable entry orders still occupy portfolio risk, and why.
// The predicate mirror is entryRiskOccupiesRisk/hasVerifiedNoActiveRisk in
// apps/engine/src/services/entryRiskOccupancy.ts; nothing here writes to the live database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const live = process.argv[2] ?? 'D:/MITS/data/zdj-settings.sqlite';
const out = process.argv[3] ?? 'D:/MITS-WORKTREES/v396-final-convergence-20260922/docs/evidence/v396/place-to-submit-root-cause-20260926/a03-unknown-occupancy-census.json';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdj-occupancy-'));
const copy = path.join(dir, 'c.sqlite');
fs.copyFileSync(live, copy);
for (const ext of ['-wal', '-shm']) if (fs.existsSync(live + ext)) fs.copyFileSync(live + ext, copy + ext);
const db = new DatabaseSync(copy, {readOnly: true});
const now = Date.now();

const rows = db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='entryOrders'").all().map((row) => ({id: row.entity_id, ...JSON.parse(row.payload)}));

const ACTIVE = new Set(['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED']);
const TERMINAL = new Set(['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED']);
// The same four absence sources historicalNoRiskEligible() demands before a row may be promoted.
const ABSENCE = ['BINANCE_EXACT_ORDER_NOT_FOUND', 'BINANCE_OPEN_ORDERS_IDENTITY_ABSENT', 'BINANCE_USER_TRADES_IDENTITY_ABSENT', 'BINANCE_ALL_ORDERS_IDENTITY_ABSENT'];
const tombstone = (o) => `ENTRY:${String(o.symbol).toUpperCase()}:${String(o.clientOrderId ?? o.exchangeOrderId ?? o.id)}`;
const verifiedNoActiveRisk = (o) => {
  const e = o.activeRiskEvidence;
  return o.activeRiskExposure === false && e?.status === 'VERIFIED_NO_ACTIVE_RISK'
    && Number.isFinite(Number(e.checkedAt)) && Number(e.validUntil) > now && e.identityTombstone === tombstone(o);
};
const occupies = (o) => ACTIVE.has(o.status)
  ? (o.status === 'UNKNOWN' ? !verifiedNoActiveRisk(o) : true)
  : (TERMINAL.has(o.status) && o.exchangeTerminalStatus === 'UNKNOWN' && !verifiedNoActiveRisk(o));

const buckets = {};
const occupying = [];
for (const order of rows) {
  const live_ = occupies(order);
  const key = `${order.status}|proof=${verifiedNoActiveRisk(order) ? 'valid' : (order.activeRiskEvidence?.status === 'VERIFIED_NO_ACTIVE_RISK' ? 'expired' : order.activeRiskEvidence ? 'other' : 'none')}`;
  buckets[key] = (buckets[key] ?? 0) + 1;
  if (!live_) continue;
  const notional = Math.max(0, Number(order.quantity ?? 0) - Number(order.filledQuantity ?? 0)) * Number(order.price ?? 0);
  const audit = order.remoteAudit ?? null;
  const evidence = order.activeRiskEvidence ?? null;
  occupying.push({
    id: order.id, symbol: order.symbol, side: order.side, status: order.status,
    exchangeTerminalStatus: order.exchangeTerminalStatus ?? null, exchangeOrderId: order.exchangeOrderId ?? null,
    reservationId: order.reservationId ?? null, occupancyNotionalUsd: Number(notional.toFixed(2)),
    proofStatus: evidence?.status ?? null, proofCheckedAt: evidence?.checkedAt ?? null, proofValidUntil: evidence?.validUntil ?? null,
    proofAgeMs: evidence?.checkedAt ? now - Number(evidence.checkedAt) : null,
    proofRemainingMs: evidence?.validUntil ? Number(evidence.validUntil) - now : null,
    auditTier: audit?.tier ?? null, auditConsecutive: audit?.consecutive ?? null,
    auditNextAt: audit?.nextAuditAt ?? null, auditDeferredMs: audit?.nextAuditAt ? Number(audit.nextAuditAt) - now : null,
    // The row occupies risk while its proof is expired even though its own audit cadence says the next
    // re-probe is still in the future: that gap is the phantom occupancy this census measures.
    occupiesOnlyBecauseProofExpired: Boolean(evidence?.status === 'VERIFIED_NO_ACTIVE_RISK' && (ABSENCE.every((source) => (evidence?.sources ?? []).includes(source)) && ((evidence?.sources ?? []).includes("BINANCE_LONG_SHORT_POSITION_ZERO") || (evidence?.sources ?? []).includes("POSITION_PRESENT_PROVEN_OTHER_CYCLE"))) && Number(audit?.tier ?? 0) > 0 && Number(audit?.nextAuditAt ?? 0) > now),
  });
}
occupying.sort((a, b) => b.occupancyNotionalUsd - a.occupancyNotionalUsd);
const phantom = occupying.filter((row) => row.occupiesOnlyBecauseProofExpired);

// Every UNKNOWN row, occupying or not: the question is how long each row's own proof stays valid against
// the cadence that granted it, because the gap is the window in which the row re-occupies risk unprobed.
const unknownRows = rows.filter((order) => order.status === 'UNKNOWN').map((order) => {
  const evidence = order.activeRiskEvidence ?? null, audit = order.remoteAudit ?? null;
  const validUntil = Number(evidence?.validUntil ?? 0), nextAuditAt = Number(audit?.nextAuditAt ?? 0);
  return {
    id: order.id, symbol: order.symbol,
    notionalUsd: Number((Math.max(0, Number(order.quantity ?? 0) - Number(order.filledQuantity ?? 0)) * Number(order.price ?? 0)).toFixed(2)),
    proofStatus: evidence?.status ?? null, proofComplete: Boolean(evidence?.status === 'VERIFIED_NO_ACTIVE_RISK' && (ABSENCE.every((source) => (evidence?.sources ?? []).includes(source)) && ((evidence?.sources ?? []).includes("BINANCE_LONG_SHORT_POSITION_ZERO") || (evidence?.sources ?? []).includes("POSITION_PRESENT_PROVEN_OTHER_CYCLE")))),
    validUntil, validMsLeft: validUntil ? validUntil - now : null,
    tier: Number(audit?.tier ?? 0), consecutive: Number(audit?.consecutive ?? 0), nextAuditAt,
    gapToNextAuditMs: validUntil && nextAuditAt ? nextAuditAt - validUntil : null,
    occupiesAfterProofExpiry: Boolean(validUntil && nextAuditAt && nextAuditAt > validUntil),
  };
});
const gapped = unknownRows.filter((row) => row.occupiesAfterProofExpiry);
const result = {
  at: new Date(now).toISOString(), durableEntryOrders: rows.length,
  statusAndProofBuckets: buckets,
  occupyingCount: occupying.length,
  occupyingNotionalUsd: Number(occupying.reduce((n, row) => n + row.occupancyNotionalUsd, 0).toFixed(2)),
  proofExpiredButAuditNotDue: {
    rows: phantom.length, notionalUsd: Number(phantom.reduce((n, row) => n + row.occupancyNotionalUsd, 0).toFixed(2)),
    tiers: [0, 1, 2].map((tier) => ({tier, rows: phantom.filter((row) => row.auditTier === tier).length})),
  },
  unknownRows: {
    total: unknownRows.length,
    withCompleteAbsenceProof: unknownRows.filter((row) => row.proofComplete).length,
    proofValidNow: unknownRows.filter((row) => row.validUntil > now).length,
    // Rows whose proof expires before the cadence that granted it re-probes: each one occupies risk,
    // inflates pending notional and adds PENDING_RISK_UNVERIFIED for that gap on every cycle.
    proofExpiresBeforeNextAudit: gapped.length,
    notionalExposedToThatGapUsd: Number(gapped.reduce((n, row) => n + row.notionalUsd, 0).toFixed(2)),
    gapMsByTier: [0, 1, 2].map((tier) => {
      const group = gapped.filter((row) => row.tier === tier), gaps = group.map((row) => row.gapToNextAuditMs).filter(Boolean).sort((a, b) => a - b);
      return {tier, rows: group.length, minGapMs: gaps[0] ?? null, medianGapMs: gaps[Math.floor(gaps.length / 2)] ?? null, maxGapMs: gaps[gaps.length - 1] ?? null};
    }),
    sample: gapped.slice(0, 8),
  },
  rows: occupying.slice(0, 60),
};
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({...result, rows: `${occupying.length} rows, first 60 written to ${path.basename(out)}`}, null, 1));
db.close();
fs.rmSync(dir, {recursive: true, force: true});

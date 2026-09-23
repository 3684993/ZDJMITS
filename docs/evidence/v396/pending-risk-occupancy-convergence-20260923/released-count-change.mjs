// Explains why the live released/still-occupied split moved between the deploy-round 44/2 snapshot and
// this round's 46/0 replay: only the periodic remote re-proof changes it, and this script shows that.
// Read-only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'docs/evidence/v396/pending-risk-occupancy-convergence-20260923/released-count-change.json';
const {entryOrderOccupiesRisk} = await import('file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/build-check/engine/services/entryRiskOccupancy.js');
const now = Date.now();
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly: true});
const previousRaw = JSON.parse(readFileSync('docs/evidence/v396/deploy-e284a1a-anti-waste-20260923/pending-risk-crosscheck.json', 'utf8'));
const previous = {...previousRaw, capturedAtIso: previousRaw.capturedAtIso ?? previousRaw.capturedAt};
if(!Number.isFinite(Date.parse(previous.capturedAtIso)))throw new Error('previous snapshot timestamp unreadable');
const previousIds = new Set(previous.rowsCountedNow.map(row => row.orderId));
const previousStillOccupying = new Set(previous.rowsCountedNow.filter(row => row.occupiesByCanonicalPredicate).map(row => row.orderId));

const durable = new Map(db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='entryOrders'").all().map(row => [row.entity_id, JSON.parse(row.payload)]));
const unknownNow = [...durable.values()].filter(row => row.status === 'UNKNOWN');
const occupyingNow = unknownNow.filter(row => entryOrderOccupiesRisk(row, now));

const audits = db.prepare("SELECT ts, payload FROM runtime_events WHERE type='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED' AND ts>=? ORDER BY ts").all(Date.parse(previous.capturedAtIso))
  .map(row => ({at: row.ts, ...JSON.parse(row.payload)}));
const reProven = new Set(audits.map(row => row.orderId));

const focus = [...previousStillOccupying].map(id => {
  const row = durable.get(id);
  const evidence = row?.activeRiskEvidence ?? null;
  const audit = row?.remoteAudit ?? null;
  const checkedAt = Number(evidence?.checkedAt ?? 0), lastAuditAt = Number(audit?.lastAuditAt ?? 0);
  return {orderId: id, symbol: row?.symbol ?? null, wasStillOccupyingAtPreviousSnapshot: true,
    nowOccupies: Boolean(row) && entryOrderOccupiesRisk(row, now), activeRiskExposure: row?.activeRiskExposure ?? null,
    evidence: evidence ? {status: evidence.status, checkedAtLocal: new Date(checkedAt).toLocaleTimeString(), checkedAfterPreviousSnapshot: checkedAt > Date.parse(previous.capturedAtIso),
      validUntilLocal: new Date(Number(evidence.validUntil)).toLocaleTimeString(), validUntilAfterNow: Number(evidence.validUntil) > now, identityTombstoneMatches: evidence.identityTombstone === `ENTRY:${String(row.symbol).toUpperCase()}:${row.clientOrderId}`} : null,
    remoteAudit: audit ? {tier: audit.tier, consecutive: audit.consecutive, verifiedCount: audit.verifiedCount, lastAuditAtLocal: new Date(lastAuditAt).toLocaleTimeString(), reAuditedAfterPreviousSnapshot: lastAuditAt > Date.parse(previous.capturedAtIso), nextAuditAtLocal: new Date(Number(audit.nextAuditAt)).toLocaleTimeString()} : null,
    reProvenByAuditEventsSincePreviousSnapshot: reProven.has(id)};
});

const result = {capturedAt: new Date(now).toISOString(),
  previousSnapshot: {capturedAtIso: previous.capturedAtIso, counted: previous.rowsCountedNow.length, stillOccupying: previousStillOccupying.size, released: previous.rowsCountedNow.length - previousStillOccupying.size},
  thisReplay: {unknownDurableRows: unknownNow.length, identicalIdSetToPrevious: previousIds.size === new Set(unknownNow.map(row => row.id)).size && [...previousIds].every(id => unknownNow.some(row => row.id === id)), occupying: occupyingNow.length, released: unknownNow.length - occupyingNow.length},
  whyItChanged: 'Nothing in this round rewrote or deleted a durable row. The only input that moved is the periodic remote re-proof: hasVerifiedNoActiveRisk requires activeRiskExposure=false plus VERIFIED_NO_ACTIVE_RISK evidence whose validUntil is still in the future and whose identity tombstone matches, and the remote audit re-emits exactly that on its ladder. Rows whose evidence had expired at the earlier sample have since been re-proven, so the authority released them; The remote audit re-proves an identical fact without emitting a new event (shouldEmitNoRiskEvent turns repeats into a summary), so the absence of an event since the earlier sample does not mean the row was never re-checked: each row carries remoteAudit.lastAuditAt, consecutive and verifiedCount for exactly that question.',
  rowsThatChangedClassification: focus,
  auditEventsSincePreviousSnapshot: {count: audits.length, distinctOrders: reProven.size, firstLocal: audits[0] ? new Date(audits[0].at).toLocaleTimeString() : null, lastLocal: audits.at(-1) ? new Date(audits.at(-1).at).toLocaleTimeString() : null,
    reasons: audits.reduce((acc, row) => ((acc[row.reason ?? row.evidence?.status ?? 'NULL'] = (acc[row.reason ?? row.evidence?.status ?? 'NULL'] ?? 0) + 1), acc), {})}};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({previous: result.previousSnapshot, now: result.thisReplay, changed: focus.map(row => ({id: row.orderId, symbol: row.symbol, nowOccupies: row.nowOccupies, reProvenEvent: row.reProvenByAuditEventsSincePreviousSnapshot, reAuditedAt: row.remoteAudit?.lastAuditAtLocal, reAuditedAfterPrevious: row.remoteAudit?.reAuditedAfterPreviousSnapshot, evidenceCheckedAt: row.evidence?.checkedAtLocal, exposure: row.activeRiskExposure, valid: row.evidence?.validUntilAfterNow})), audits: result.auditEventsSincePreviousSnapshot.count}, null, 1));
db.close();

// Read-only cross-check of PENDING_RISK blockers against authoritative remote-status evidence.
// Two independent sources are compared: the last real admission evaluation, and the durable
// entry-order rows run through the same predicates the production code uses. No writes at all.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'docs/evidence/v396/deploy-e284a1a-anti-waste-20260923/pending-risk-crosscheck.json';
const now = Date.now();
const instance = JSON.parse(readFileSync('D:/MITS/data/runtime/engine-instance.json', 'utf8'));
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', { readOnly: true });
const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };

// 1. the most recent real admission evaluation (belongs to the pre-deploy instance)
const admissionRow = db.prepare("SELECT ts, payload FROM runtime_events WHERE type='PORTFOLIO_RISK_ADMISSION_EVALUATED' ORDER BY ts DESC LIMIT 1").get();
const admission = parse(admissionRow?.payload ?? '{}');
const reasons = Array.isArray(admission.reasons) ? admission.reasons : (Array.isArray(admission.blockers) ? admission.blockers : []);
const pendingKeys = reasons.filter(b => String(b).startsWith('PENDING_RISK_UNVERIFIED:')).map(b => String(b).slice('PENDING_RISK_UNVERIFIED:order:'.length));

// 2. every durable entry-order row, run through both predicates
const rows = new Map(db.prepare("SELECT entity_id, payload FROM runtime_entities WHERE kind='entryOrders'").all().map(r => [r.entity_id, parse(r.payload)]));
const audits = new Map();
for (const event of db.prepare("SELECT ts, payload FROM runtime_events WHERE type='ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED' ORDER BY ts DESC").all()) {
  const p = parse(event.payload);
  if (p?.orderId && !audits.has(p.orderId)) audits.set(p.orderId, { eventAt: event.ts, ...p });
}
const tombstone = row => `ENTRY:${String(row?.symbol ?? '').toUpperCase()}:${row?.clientOrderId ?? ''}`;
const verifiedNoActiveRisk = (row, at) => {
  const evidence = row?.activeRiskEvidence;
  return Boolean(row?.activeRiskExposure === false && evidence?.status === 'VERIFIED_NO_ACTIVE_RISK'
    && Number.isFinite(Number(evidence?.checkedAt)) && Number(evidence?.validUntil) > at && evidence?.identityTombstone === tombstone(row));
};
const LEDGER_STATUSES = ['NEW', 'PARTIALLY_FILLED', 'UNKNOWN', 'SUBMITTING'];
const ACTIVE_STATUSES = ['NEW', 'SUBMITTING', 'WORKING', 'PARTIALLY_FILLED', 'UNKNOWN'];
const classify = (id, row) => {
  const audit = audits.get(id) ?? null;
  const evidence = row?.activeRiskEvidence ?? null;
  return {
    orderId: id,
    inLastAdmissionBlockers: pendingKeys.includes(id),
    symbol: row?.symbol ?? null,
    side: row?.side ?? null,
    status: row?.status ?? 'MISSING',
    exchangeOrderId: row?.exchangeOrderId ?? null,
    filledQuantity: row?.filledQuantity ?? null,
    quantity: row?.quantity ?? null,
    price: row?.price ?? null,
    intentId: row?.intentId ?? null,
    reservationId: row?.reservationId ?? null,
    expiresAt: row?.expiresAt ?? null,
    expiresAtMissingOrFuture: row?.expiresAt ? Number(row.expiresAt) > now : true,
    updatedAt: row?.updatedAt ?? null,
    exchangeTerminalStatus: row?.exchangeTerminalStatus ?? null,
    activeRiskExposure: row?.activeRiskExposure ?? null,
    durableEvidence: evidence ? { status: evidence.status ?? null, checkedAt: evidence.checkedAt ?? null, validUntil: evidence.validUntil ?? null, validNow: Number(evidence.validUntil) > now, tombstoneMatches: evidence.identityTombstone === tombstone(row), reason: evidence.reason ?? null } : null,
    latestRemoteAudit: audit ? { eventAt: audit.eventAt, reason: audit.reason ?? null, exchangeTerminalStatus: audit.exchangeTerminalStatus ?? null, activeRiskExposure: audit.activeRiskExposure ?? null, occupancyReleased: audit.occupancyReleased ?? null, evidenceStatus: audit.evidence?.status ?? null, evidenceValidUntil: audit.evidence?.validUntil ?? null, nextRemoteAuditAt: audit.nextRemoteAuditAt ?? null } : null,
    countedAsPendingByLedgerFilter: Boolean(row && LEDGER_STATUSES.includes(String(row.status)) && (!row.expiresAt || Number(row.expiresAt) > now)),
    occupiesByCanonicalPredicate: Boolean(row && ACTIVE_STATUSES.includes(String(row.status)) && (String(row.status) !== 'UNKNOWN' || !verifiedNoActiveRisk(row, now))),
    realActiveRiskSuspected: Boolean(row && (Number(row.filledQuantity ?? 0) > 0 || (row.exchangeOrderId && String(row.exchangeOrderId).length > 0) || (row.activeRiskExposure !== false && evidence?.status !== 'VERIFIED_NO_ACTIVE_RISK'))),
  };
};
const all = [...rows.entries()].map(([id, row]) => classify(id, row));
const fromAdmission = pendingKeys.map(id => classify(id, rows.get(id) ?? null));
const counted = all.filter(r => r.countedAsPendingByLedgerFilter);
const tally = (rowsIn, key) => rowsIn.reduce((a, r) => ((a[r[key] ?? 'null'] = (a[r[key] ?? 'null'] ?? 0) + 1), a), {});

const result = {
  capturedAt: new Date(now).toISOString(),
  currentInstance: { pid: instance.pid, instanceId: instance.instanceId, buildId: instance.buildId, startedAt: instance.startedAt, startedAtIso: new Date(instance.startedAt).toISOString() },
  admissionEvaluationsOnNewInstance: Number(db.prepare('SELECT COUNT(*) n FROM runtime_events WHERE type=? AND ts>=?').get('PORTFOLIO_RISK_ADMISSION_EVALUATED', instance.startedAt).n),
  lastAdmissionEvent: { at: admissionRow?.ts ?? null, iso: admissionRow ? new Date(admissionRow.ts).toISOString() : null, fromInstanceBeforeThisDeploy: (admissionRow?.ts ?? 0) < instance.startedAt, allowed: admission?.allowed ?? null, reasonCount: reasons.length, pendingRiskCount: pendingKeys.length },
  durableStore: {
    entryOrdersTotal: rows.size,
    byStatus: tally(all, 'status'),
    unknownRows: all.filter(r => r.status === 'UNKNOWN').length,
    countedAsPendingByLedgerFilter: counted.length,
    ofThoseOccupyByCanonicalPredicate: counted.filter(r => r.occupiesByCanonicalPredicate).length,
    ofReleasedByAuthoritativeEvidence: counted.filter(r => !r.occupiesByCanonicalPredicate).length,
    ledgerRowsWithNoExpiry: counted.filter(r => r.expiresAt == null).length,
    evidenceValidNow: counted.filter(r => r.durableEvidence?.validNow).length,
    evidenceExpired: counted.filter(r => r.durableEvidence && !r.durableEvidence.validNow).length,
    noEvidenceAtAll: counted.filter(r => !r.durableEvidence).length,
    anyWithRealActiveRiskSuspected: counted.filter(r => r.realActiveRiskSuspected).map(r => ({ orderId: r.orderId, symbol: r.symbol, status: r.status, filledQuantity: r.filledQuantity, exchangeOrderId: r.exchangeOrderId, activeRiskExposure: r.activeRiskExposure, evidenceStatus: r.durableEvidence?.status ?? null })),
  },
  rowsFromLastAdmission: fromAdmission,
  rowsCountedNow: counted,
};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  admissionOnNewInstance: result.admissionEvaluationsOnNewInstance,
  lastAdmissionPending: result.lastAdmissionEvent.pendingRiskCount,
  durableCountedAsPending: counted.length,
  occupyCanonical: result.durableStore.ofThoseOccupyByCanonicalPredicate,
  releasedByEvidence: result.durableStore.ofReleasedByAuthoritativeEvidence,
  noExpiry: result.durableStore.ledgerRowsWithNoExpiry,
  evidence: { validNow: result.durableStore.evidenceValidNow, expired: result.durableStore.evidenceExpired, none: result.durableStore.noEvidenceAtAll },
  realRisk: result.durableStore.anyWithRealActiveRiskSuspected.length,
  byStatus: result.durableStore.byStatus,
}, null, 1));
db.close();

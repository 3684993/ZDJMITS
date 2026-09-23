// Read-only before/after reconciliation over the live durable entry rows.
// "before" is a verbatim transcription of the predicate removed from portfolioRiskLedger.ts at commit
// 0c87cf2 (lines 153-163); "after" calls the real authority compiled to the isolated build-check dir.
// Nothing here writes to the database, to Settings, or to any exchange.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const OUT = 'docs/evidence/v396/pending-risk-occupancy-convergence-20260923/reconciliation-live-durable.json';
const {collectPortfolioPendingRiskFacts, entryOrderOccupiesRisk} = await import('file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/build-check/engine/services/entryRiskOccupancy.js');
const now = Date.now();
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly: true});
const rows = (kind) => db.prepare('SELECT entity_id, payload FROM runtime_entities WHERE kind=?').all(kind)
  .map(row => ({...JSON.parse(row.payload), id: row.payload.id ?? row.entity_id}));
const asMap = list => new Map(list.map(row => [row.id, row]));

const state = {entryOrders: asMap(rows('entryOrders')), entryReservations: asMap(rows('entryReservations')), entryIntents: asMap(rows('entryIntents')), allocationPlans: asMap(rows('allocationPlans'))};
const tombstone = (row) => `ENTRY:${String(row.symbol).toUpperCase()}:${String(row.clientOrderId ?? row.exchangeOrderId ?? row.id)}`;

/** Verbatim legacy projection, for the arithmetic comparison only. */
function legacyPending() {
  return [
    ...[...state.entryReservations.values()].filter((row) => ['RESERVED', 'WORKING'].includes(String(row.status)) && Number(row.expiresAt) > now).map((row) => ({
      id: `reservation:${row.id}`, symbol: row.underlying, side: 'BOTH', notionalUsd: Number(row.notionalUsd), marginUsd: Number(row.marginUsd),
      quoteAsset: String(row.quoteAsset).toUpperCase(), source: 'RESERVATION'})),
    ...[...state.entryOrders.values()].filter((row) => ['NEW', 'PARTIALLY_FILLED', 'UNKNOWN', 'SUBMITTING'].includes(String(row.status)) && (!row.expiresAt || Number(row.expiresAt) > now)).map((row) => ({
      id: `order:${row.id}`, symbol: row.symbol, side: row.side === 'SELL' ? 'SHORT' : 'LONG', notionalUsd: Number(row.quantity ?? 0) * Number(row.price ?? 0),
      marginUsd: Number(row.leverage ?? 0) > 0 ? Number(row.quantity ?? 0) * Number(row.price ?? 0) / Number(row.leverage) : Number.NaN,
      quoteAsset: 'USDT', source: String(row.status) === 'UNKNOWN' ? 'UNKNOWN' : 'ORDER'})),
  ];
}

const before = legacyPending();
const after = collectPortfolioPendingRiskFacts(state, {now});
const beforeOrderIds = new Set(before.filter(row => row.id.startsWith('order:')).map(row => row.id.slice(6)));
const afterOrderIds = new Set(after.filter(row => row.id.startsWith('order:')).map(row => row.id.slice(6)));
const released = [...beforeOrderIds].filter(id => !afterOrderIds.has(id)).map(id => {
  const row = state.entryOrders.get(id);
  const evidence = row?.activeRiskEvidence ?? null;
  return {orderId: id, symbol: row?.symbol ?? null, status: row?.status ?? null, expiresAtField: row?.expiresAt ?? null, absoluteExpiresAt: row?.absoluteExpiresAt ?? null,
    exchangeOrderId: row?.exchangeOrderId ?? null, filledQuantity: row?.filledQuantity ?? null, notionalUsd: Number(row?.quantity ?? 0) * Number(row?.price ?? 0),
    proof: {evidenceStatus: evidence?.status ?? null, checkedAt: evidence?.checkedAt ?? null, validUntil: evidence?.validUntil ?? null, validNow: Number(evidence?.validUntil ?? 0) > now,
      identityTombstoneMatches: evidence?.identityTombstone === tombstone(row), activeRiskExposure: row?.activeRiskExposure ?? null},
    occupiesByAuthority: entryOrderOccupiesRisk(row, now)};
});
const stillOccupying = [...afterOrderIds].map(id => {
  const row = state.entryOrders.get(id);
  const evidence = row?.activeRiskEvidence ?? null;
  const reason = row?.status !== 'UNKNOWN' ? `ACTIVE:${row?.status}`
    : !evidence ? 'NO_EVIDENCE'
      : evidence.status !== 'VERIFIED_NO_ACTIVE_RISK' ? `EVIDENCE_NOT_VERIFIED:${evidence.status}`
        : Number(evidence.validUntil) <= now ? 'EVIDENCE_EXPIRED'
          : evidence.identityTombstone !== tombstone(row) ? 'TOMBSTONE_MISMATCH'
            : row.activeRiskExposure !== false ? 'ACTIVE_RISK_EXPOSURE_FLAG_TRUE' : 'PROVEN_BUT_STILL_COUNTED';
  return {orderId: id, symbol: row?.symbol ?? null, status: row?.status ?? null, side: row?.side ?? null, exchangeOrderId: row?.exchangeOrderId ?? null,
    filledQuantity: row?.filledQuantity ?? null, remainingNotionalUsd: Math.max(0, Number(row?.quantity ?? 0) - Number(row?.filledQuantity ?? 0)) * Number(row?.price ?? 0),
    reservationId: row?.reservationId ?? null, reason, evidenceStatus: evidence?.status ?? null, evidenceValidUntil: evidence?.validUntil ?? null};
});
const sum = list => list.reduce((total, row) => total + (Number.isFinite(row.notionalUsd) ? row.notionalUsd : 0), 0);
const bucket = list => list.reduce((acc, row) => {
  const asset = row.quoteAsset ?? 'UNPROVEN';
  acc[asset] = (acc[asset] ?? 0) + (Number.isFinite(row.notionalUsd) ? row.notionalUsd : 0);
  return acc;
}, {});
// Lineage double counting: the same reservation appearing as both a reservation row and an order row.
const lineagesOf = list => new Set(list.map(row => String(row.id).replace(/^(order|reservation):/, '')));
const orderReservationIds = new Set([...state.entryOrders.values()].map((row) => row.reservationId).filter(Boolean));
const doubleCountedBefore = [...state.entryReservations.values()].filter((row) => ['RESERVED', 'WORKING'].includes(String(row.status)) && Number(row.expiresAt) > now && orderReservationIds.has(row.id)).map((row) => row.id);

const usdcLineages = [...state.entryOrders.values()].filter((row) => String(row.symbol).toUpperCase().endsWith('USDC') && beforeOrderIds.has(row.id) || String(row.symbol).toUpperCase().endsWith('USDC') && afterOrderIds.has(row.id));
const unknownDurable = [...state.entryOrders.values()].filter((row) => row.status === 'UNKNOWN');

const result = {
  capturedAt: new Date(now).toISOString(),
  liveInstance: {note: 'read-only durable replay; the running build predates this patch', pid: 50996, buildId: '3.9.6-dc8fb58b578c25d10726'},
  legacyPredicateSource: 'verbatim transcription of portfolioRiskLedger.ts lines 153-163 at commit 0c87cf2 (removed by this patch)',
  durableCounts: {
    entryOrders: state.entryOrders.size, entryReservations: state.entryReservations.size, entryIntents: state.entryIntents.size, allocationPlans: state.allocationPlans.size,
    unknownEntryOrders: unknownDurable.length,
    unknownWithExpiresAtFieldNull: unknownDurable.filter((row) => row.expiresAt == null).length,
    unknownWithFutureAbsoluteExpiresAt: unknownDurable.filter((row) => Number(row.absoluteExpiresAt) > now).length,
  },
  pendingCounts: {before: before.length, after: after.length, beforeOrders: beforeOrderIds.size, afterOrders: afterOrderIds.size,
    releasedOrderCount: released.length, stillOccupiedOrderCount: stillOccupying.length},
  notional: {beforeUsd: +sum(before).toFixed(2), afterUsd: +sum(after).toFixed(2), releasedUsd: +sum(released.map(row => ({notionalUsd: row.notionalUsd}))).toFixed(2),
    stillOccupiedUsd: +sum(stillOccupying.map(row => ({notionalUsd: row.remainingNotionalUsd}))).toFixed(2),
    grossDeltaUsd: +(sum(after) - sum(before)).toFixed(2)},
  quoteAssetBuckets: {before: bucket(before), after: bucket(after),
    usdcOrdersSeenAsUsdtByLegacy: usdcLineages.filter((row) => beforeOrderIds.has(row.id)).length,
    usdcOrdersInAfter: usdcLineages.filter((row) => afterOrderIds.has(row.id)).map((row) => ({orderId: row.id, symbol: row.symbol, quoteAsset: after.find(f => f.id === `order:${row.id}`)?.quoteAsset ?? null}))},
  lineageDoubleCount: {
    reservationsBeforeThatAlsoHadAnOrder: doubleCountedBefore.length,
    reservationIds: doubleCountedBefore,
    beforeDistinctLineageKeys: new Set([...lineagesOf(before), ...[...state.entryReservations.values()].map(() => '')]).size,
    afterKeys: after.map(row => row.id),
    afterReservationOnlyKeys: after.filter(row => row.id.startsWith('reservation:')).map(row => row.id),
    afterOrderKeysSharingAReservation: after.filter(row => row.id.startsWith('order:') && (state.entryOrders.get(row.id.slice(6)) )?.reservationId).length,
  },
  released,
  stillOccupying,
  failClosedProperties: {
    anyReleasedRowStillOccupiesAuthority: released.some(row => row.occupiesByAuthority),
    anyReleasedWithoutVerifiedEvidence: released.filter(row => row.proof.evidenceStatus !== 'VERIFIED_NO_ACTIVE_RISK' || !row.proof.validNow || !row.proof.identityTombstoneMatches).length,
    anyReleasedWithExchangeOrderId: released.filter(row => row.exchangeOrderId).length,
    anyReleasedWithFill: released.filter(row => Number(row.filledQuantity) > 0).length,
  },
};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({durable: result.durableCounts, pending: result.pendingCounts, notional: result.notional, buckets: result.quoteAssetBuckets, lineage: {...result.lineageDoubleCount, reservationIds: `${result.lineageDoubleCount.reservationIds.length} ids`}, failClosed: result.failClosedProperties}, null, 1));
db.close();

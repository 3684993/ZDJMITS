// Post-deploy read-only replay: does the RUNNING payload still invent its own entry occupancy?
// "before" is the verbatim predicate removed at commit 0c87cf2; "after" calls the module that the
// deployed apps/engine/dist actually contains. Importing from live dist is read-only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'docs/evidence/v396/deploy-d570bef-pending-risk-live-20260923/pending-risk-live-replay.json';
const DIST = 'file:///D:/MITS-WORKTREES/v396-final-convergence-20260922/apps/engine/dist';
const deployed = await import(`${DIST}/services/entryRiskOccupancy.js`);
const {collectPortfolioPendingRiskFacts, entryOrderOccupiesRisk} = deployed;
const now = Date.now();
const db = new DatabaseSync('D:/MITS/data/zdj-settings.sqlite', {readOnly: true});
const rows = kind => db.prepare('SELECT payload FROM runtime_entities WHERE kind=?').all(kind).map(r => JSON.parse(r.payload));
const asMap = list => new Map(list.map(r => [r.id ?? r.entity_id, r]));
const state = {entryOrders: asMap(rows('entryOrders')), entryReservations: asMap(rows('entryReservations')), entryIntents: asMap(rows('entryIntents')), allocationPlans: asMap(rows('allocationPlans'))};
const tombstone = row => `ENTRY:${String(row.symbol).toUpperCase()}:${String(row.clientOrderId ?? row.exchangeOrderId ?? row.id)}`;

// Verbatim legacy order branch, to quantify what the deployed build replaced.
const legacy = [...state.entryOrders.values()]
  .filter(row => ['NEW', 'PARTIALLY_FILLED', 'UNKNOWN', 'SUBMITTING'].includes(String(row.status)) && (!row.expiresAt || Number(row.expiresAt) > now))
  .map(row => ({id: `order:${row.id}`, symbol: row.symbol, notionalUsd: Number(row.quantity ?? 0) * Number(row.price ?? 0), quoteAsset: 'USDT'}));
const authority = collectPortfolioPendingRiskFacts(state, {now});
const sum = list => +list.reduce((t, row) => t + (Number.isFinite(row.notionalUsd) ? row.notionalUsd : 0), 0).toFixed(2);
const unknown = [...state.entryOrders.values()].filter(row => row.status === 'UNKNOWN');
const unproven = unknown.filter(row => entryOrderOccupiesRisk(row, now));

const ledgerSource = readFileSync('apps/engine/dist/services/portfolioRiskLedger.js', 'utf8');
const artifactProof = {
  liveLedgerStillContainsStatusOnlyOrderFilter: /\['NEW',\s*'PARTIALLY_FILLED',\s*'UNKNOWN',\s*'SUBMITTING'\]/.test(ledgerSource),
  liveLedgerCallsSingleAuthority: ledgerSource.includes('collectPortfolioPendingRiskFacts'),
  liveLedgerHardcodesUsdtForPendingOrders: /quoteAsset:\s*'USDT'/.test(ledgerSource),
  deployedExportExists: typeof collectPortfolioPendingRiskFacts === 'function',
};

const released = legacy.filter(row => !authority.some(a => a.id === row.id));
const result = {capturedAt: new Date(now).toISOString(), artifactProof,
  durable: {entryOrders: state.entryOrders.size, unknownRows: unknown.length, unknownWithActiveRisk: unproven.length,
    activeReservations: [...state.entryReservations.values()].filter(r => ['RESERVED', 'WORKING'].includes(String(r.status)) && Number(r.expiresAt) > now).length},
  pendingOrders: {legacy: legacy.length, authority: authority.filter(row => row.id.startsWith('order:')).length, released: released.length},
  notionalUsd: {legacy: sum(legacy), authority: sum(authority), releasedPhantom: sum(released),
    stillOccupiedRows: unproven.map(row => ({orderId: row.id, symbol: row.symbol, remainingNotionalUsd: Math.max(0, Number(row.quantity) - Number(row.filledQuantity ?? 0)) * Number(row.price),
      reason: !row.activeRiskEvidence ? 'NO_EVIDENCE' : Number(row.activeRiskEvidence.validUntil) <= now ? 'EVIDENCE_EXPIRED' : row.activeRiskEvidence.identityTombstone !== tombstone(row) ? 'TOMBSTONE_MISMATCH' : row.activeRiskExposure !== false ? 'EXPOSURE_FLAG_TRUE' : `EVIDENCE_${row.activeRiskEvidence.status}`}))},
  failClosed: {releasedWithoutValidProof: released.filter(row => {const r = state.entryOrders.get(row.id.slice(6)); const e = r?.activeRiskEvidence; return !(r?.activeRiskExposure === false && e?.status === 'VERIFIED_NO_ACTIVE_RISK' && Number(e.validUntil) > now && e.identityTombstone === tombstone(r));}).length,
    releasedWithExchangeOrderId: released.filter(row => state.entryOrders.get(row.id.slice(6))?.exchangeOrderId).length,
    releasedWithFill: released.filter(row => Number(state.entryOrders.get(row.id.slice(6))?.filledQuantity ?? 0) > 0).length,
    unknownRowsStillOccupyingAreCounted: unproven.every(row => authority.some(a => a.id === `order:${row.id}`)),
    everyAuthorityRowHasProvenOrUnknownSource: authority.every(row => ['RESERVATION', 'ORDER', 'UNKNOWN'].includes(row.source))},
  note: 'With executionMode still READ_ONLY the runtime performs no portfolio admission, so no PORTFOLIO_RISK_ADMISSION_EVALUATED event exists on this instance. This replay drives the same durable rows through the deployed module the runtime itself calls.'};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({artifactProof, durable: result.durable, pending: result.pendingOrders, notional: {legacy: result.notionalUsd.legacy, authority: result.notionalUsd.authority, releasedPhantom: result.notionalUsd.releasedPhantom}, failClosed: {...result.failClosed, releasedWithoutValidProof: result.failClosed.releasedWithoutValidProof}}, null, 1));
db.close();

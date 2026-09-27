#!/usr/bin/env node
/**
 * S00_READ_ONLY_AUDIT: emit a bounded v396 risk/UNKNOWN projection from a supplied SQLite snapshot.
 * Opens SQLite read-only, enables query_only, uses a read transaction, and rolls it back.
 * No HTTP, exchange, Engine lifecycle, settings writes, or output-file writes are performed.
 * Usage: node scripts/audit-v396-root-cause-plan.mjs --db=<snapshot.sqlite>
 */
import { DatabaseSync } from 'node:sqlite';

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const database = arg('db');
if (!database) throw new Error('READ_ONLY_DATABASE_ARGUMENT_REQUIRED');
const db = new DatabaseSync(database, { readOnly: true });
const parse = (value) => JSON.parse(value);
const sum = (rows, selector) => rows.reduce((total, row) => total + Number(selector(row) || 0), 0);
try {
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
  const runtimeUpdatedAt = Number(db.prepare('SELECT updated_at FROM runtime_state WHERE id=1').get()?.updated_at ?? 0);
  const settingsRow = db.prepare('SELECT version,updated_at,payload FROM settings ORDER BY updated_at DESC LIMIT 1').get();
  if (!settingsRow) throw new Error('SETTINGS_ROW_MISSING');
  const settings = parse(settingsRow.payload);
  const entities = (kind) => db.prepare('SELECT entity_id,payload FROM runtime_entities WHERE kind=? ORDER BY entity_id').all(kind)
    .map((row) => ({ id: row.entity_id, ...parse(row.payload) }));
  const now = Date.now();
  const positions = entities('positions');
  const entries = entities('entryOrders');
  const manual = entities('manualOrders');
  const takeProfit = entities('tpOrders');
  const reservations = entities('reservations');
  const identity = (order) => `ENTRY:${String(order.symbol).toUpperCase()}:${String(order.clientOrderId ?? order.exchangeOrderId ?? order.id)}`;
  const proofValid = (order) => order.activeRiskExposure === false
    && order.activeRiskEvidence?.status === 'VERIFIED_NO_ACTIVE_RISK'
    && Number.isFinite(Number(order.activeRiskEvidence?.checkedAt))
    && Number(order.activeRiskEvidence?.validUntil) > now
    && order.activeRiskEvidence?.identityTombstone === identity(order);
  const occupiesEntryRisk = (order) => {
    if (['NEW', 'SUBMITTING', 'UNKNOWN', 'WORKING', 'PARTIALLY_FILLED'].includes(order.status))
      return order.status === 'UNKNOWN' ? !proofValid(order) : true;
    return ['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(order.status)
      && order.exchangeTerminalStatus === 'UNKNOWN' && !proofValid(order);
  };
  const pending = entries.filter(occupiesEntryRisk).map((order) => ({
    id: order.id, symbol: order.symbol, side: order.side,
    remainingQuantity: Math.max(0, Number(order.quantity) - Number(order.filledQuantity ?? 0)),
    price: Number(order.price), notionalUsd: Math.max(0, Number(order.quantity) - Number(order.filledQuantity ?? 0)) * Number(order.price),
    status: order.status, reservationId: order.reservationId ?? null,
  }));
  const activeReservations = reservations.filter((row) => ['RESERVED', 'WORKING'].includes(String(row.status)) && Number(row.expiresAt) > now);
  const profiles = settings.riskGovernance?.portfolioRisk ?? {};
  const entryClaims = db.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN active=1 AND json_extract(payload,'$.order.status')='UNKNOWN' THEN 1 ELSE 0 END) AS activeUnknown,
      sum(CASE WHEN released_at>0 AND json_extract(payload,'$.order.status')='UNKNOWN' THEN 1 ELSE 0 END) AS releasedUnknown
    FROM entry_execution_tasks`).get();
  const manualClaims = db.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN active=1 AND json_extract(payload,'$.order.status')='UNKNOWN' THEN 1 ELSE 0 END) AS activeUnknown
    FROM execution_tasks`).get();
  const unknownEntries = entries.filter((row) => row.status === 'UNKNOWN');
  const unresolvedEntryOrders = entries.filter(occupiesEntryRisk);
  const proofAges = unknownEntries.filter(proofValid).map((row) => Math.max(0, now - Number(row.activeRiskEvidence.checkedAt))).sort((a, b) => a - b);
  const unknownManual = manual.filter((row) => row.status === 'UNKNOWN');
  const unknownTp = takeProfit.filter((row) => row.status === 'UNKNOWN');
  const positionGross = sum(positions, (row) => row.notionalUsd);
  const pendingGross = sum(pending, (row) => row.notionalUsd);
  const gross = positionGross + pendingGross;
  const limit = Number(profiles.maxGrossNotionalUsd);
  const output = {
    schema: 'V396_ROOT_CAUSE_READ_ONLY_REPLAY_V1',
    classification: 'S00_READ_ONLY_AUDIT',
    capturedAt: new Date(now).toISOString(),
    capturedAtEpochMs: now,
    runtimeStateUpdatedAtEpochMs: runtimeUpdatedAt,
    settings: {
      version: Number(settingsRow.version), updatedAtEpochMs: Number(settingsRow.updated_at),
      grossLimitUsd: limit, directionLimitUsd: Number(profiles.maxDirectionNotionalUsd),
      clusterLimitUsd: Number(profiles.maxClusterNotionalUsd), humanLimitUsd: Number(profiles.maxHumanNotionalUsd),
      stressLossLimitUsd: Number(profiles.maxStressLossUsd), maxHumanPositions: Number(profiles.maxHumanPositions),
      correlationClusters: profiles.clusters ?? {}, tradeEconomicsMode: settings.tradeEconomics?.admissionMode ?? null,
      minNetProfitUsd: Number(settings.takeProfit?.minNetProfitUsd), minNetProfitRoiPct: Number(settings.takeProfit?.minNetProfitRoiPct),
    },
    positions: {
      count: positions.length, grossNotionalUsd: positionGross,
      longNotionalUsd: sum(positions.filter((row) => row.side === 'LONG'), (row) => row.notionalUsd),
      shortNotionalUsd: sum(positions.filter((row) => row.side === 'SHORT'), (row) => row.notionalUsd),
      humanManagedCount: positions.filter((row) => row.managementStatus === 'HUMAN_MANAGED').length,
      humanManagedNotionalUsd: sum(positions.filter((row) => row.managementStatus === 'HUMAN_MANAGED'), (row) => row.notionalUsd),
    },
    pendingEntryRisk: { count: pending.length, notionalUsd: pendingGross, rows: pending,
      activeUnexpiredReservationCount: activeReservations.length },
    grossReplay: { usedUsd: gross, limitUsd: limit, headroomUsd: Math.max(0, limit - gross),
      shortfallUsd: Math.max(0, gross - limit), overLimit: gross > limit },
    unknownReconciliation: {
      entryUnknownHistoryRows: unknownEntries.length,
      entryUnknownWithCurrentlyValidNoRiskProof: unknownEntries.filter(proofValid).length,
      entryOrdersOccupyingRisk: unresolvedEntryOrders.length,
      validEntryProofAgeMs: proofAges.length ? { min: proofAges[0], median: proofAges[Math.floor(proofAges.length / 2)], max: proofAges.at(-1) } : null,
      manualUnknownRows: unknownManual.length,
      takeProfitUnknownRows: unknownTp.length,
      closeoutFormulaCount: unknownEntries.length + unknownManual.length + unknownTp.length,
      p0EntryClaims: { total: Number(entryClaims.total ?? 0), activeUnknown: Number(entryClaims.activeUnknown ?? 0),
        releasedUnknown: Number(entryClaims.releasedUnknown ?? 0) },
      manualExecutionClaims: { total: Number(manualClaims.total ?? 0), activeUnknown: Number(manualClaims.activeUnknown ?? 0) },
      manualUnknownDetails: unknownManual.map((row) => ({ id: row.id, intentId: row.intentId, symbol: row.symbol, side: row.side,
        quantity: Number(row.quantity), price: Number(row.price), reduceOnly: row.reduceOnly === true,
        positionId: row.positionId ?? null, status: row.status })),
    },
    arithmetic: {
      pendingEntryOrderNotional: 'max(0, quantity - filledQuantity) * order.price',
      reservationDeduplication: 'one active order per reservation; reservation excluded when its order is included',
      occupancyPredicate: 'UNKNOWN occupies unless activeRiskExposure=false and VERIFIED_NO_ACTIVE_RISK proof is unexpired and identity tombstone matches',
      grossHeadroom: 'max(0, approvedGrossLimit - canonicalPositionGross - includedPendingEntryGross)',
      grossShortfall: 'max(0, canonicalPositionGross + includedPendingEntryGross - approvedGrossLimit)',
    },
    boundary: 'One SQLite read transaction; readOnly=true; PRAGMA query_only=ON; rolled back at end. Captures persisted projections, not a live exchange query or proof of running source identity.',
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  try { db.exec('ROLLBACK'); } catch {}
  db.close();
}

// Read-only stop-line facts: which frozen human-capacity limits are exhausted right now, and by how much.
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const dataDir = process.argv[2] ?? 'data';
const base = process.argv[3] ?? 'http://127.0.0.1:8080/api/v3';
const db = new DatabaseSync(path.join(dataDir, 'zdj-settings.sqlite'), {readOnly: true});
const now = Date.now();
const profile = (await (await fetch(`${base}/pipeline`)).json()).portfolioRiskProfile?.values ?? {};
const positions = db.prepare("SELECT payload FROM runtime_entities WHERE kind='positions'").all()
  .map((r) => JSON.parse(r.payload));
const handoffs = positions.filter((r) => r.lossHandoff?.status === 'HUMAN_HANDOFF');
const overdue = handoffs.filter((r) => now - Number(r.lossHandoff.lastClosedBarAt ?? 0) > Number(profile.maxAckAgeMs ?? 0));
const gross = positions.reduce((n, r) => n + Math.abs(Number(r.quantity) * Number(r.markPrice)), 0);

console.log(JSON.stringify({
  asOf: new Date(now).toISOString(),
  profile: {maxHumanPositions: profile.maxHumanPositions, maxHumanNotionalUsd: profile.maxHumanNotionalUsd,
    maxPendingHandoffs: profile.maxPendingHandoffs, maxAckAgeMs: profile.maxAckAgeMs, maxGrossNotionalUsd: profile.maxGrossNotionalUsd,
    maxDirectionNotionalUsd: profile.maxDirectionNotionalUsd, maxClusterNotionalUsd: profile.maxClusterNotionalUsd},
  facts: {positions: positions.length, humanHandoffPositions: handoffs.length,
    unacknowledgedBeyondMaxAckAge: overdue.length,
    unacknowledgedHours: overdue.map((r) => `${r.symbol}:${r.side}:${((now - Number(r.lossHandoff.lastClosedBarAt)) / 3_600_000).toFixed(1)}h`),
    grossNotionalUsd: Number(gross.toFixed(2))},
  stopLine: {humanNotionalHeadroomUsd: Number((Number(profile.maxHumanNotionalUsd ?? 0) - gross).toFixed(2)),
    grossHeadroomUsd: Number((Number(profile.maxGrossNotionalUsd ?? 0) - gross).toFixed(2)),
    slotsUsed: positions.length, slotsMax: profile.maxHumanPositions ?? null},
  reading: 'A negative headroom means no new Entry risk exists at any size: the only release is a human closing notional. Acknowledging an overdue handoff removes HUMAN_ACK_OVERDUE but not the notional limit.',
}, null, 1));

// §H(6)(7): sample natural Primary traffic after the controlled restart, non-blocking for the operator.
// Read-only: HTTP GETs plus a read-only sqlite handle. No lifecycle, no writes.
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';

const outDir = process.argv[2] ?? 'docs/evidence/v396/entry-quote-asset-minimum-notional-20260925';
const rounds = Number(process.argv[3] ?? 7);
const everyMs = Number(process.argv[4] ?? 180_000);
const rows = [];
for (let index = 0; index < rounds; index++) {
  const label = `flow-${index + 1}`;
  const run = spawnSync('node', ['scripts/v396-quote-minnotional-sample.mjs', 'http://127.0.0.1:8080/api/v3', 'data', label], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  const file = `${outDir}/live-sample-${label}.json`;
  writeFileSync(file, run.stdout ?? '');
  let parsed = null;
  try { parsed = JSON.parse(run.stdout ?? ''); } catch { parsed = null; }
  rows.push({
    at: new Date().toISOString(), label, ok: Boolean(parsed),
    uptimeMin: parsed ? Math.round(Number(parsed.uptimeMs ?? 0) / 60_000) : null,
    buildId: parsed?.identity?.buildId ?? null,
    productionWrites: parsed?.permission?.productionWrites ?? null,
    fundingTotal: parsed?.entryFunding?.totalExecutableMarginUsd ?? null,
    sumCheck: parsed?.entryFunding?.sumCheck ?? null,
    sideStatus: parsed?.capacity?.sideStatus?.code ?? null,
    shortCause: parsed?.capacity?.entryCapacitySummary?.SHORT?.firstBindingConstraint ?? null,
    routed: parsed?.capacity?.routedCount ?? null,
    envelopes: parsed?.envelopeFacts?.events ?? null,
    envelopeAuth: (parsed?.envelopeFacts?.latest ?? []).slice(0, 3).map((row) => `${row.symbol ?? '?'}:${row.ts}:${row.longAuth}/${row.shortAuth}`),
    events: parsed?.eventsSinceRestart ?? null,
    blockedReasons: parsed?.blockedSinceRestart?.reasons ?? null,
    violations: parsed?.blockedSinceRestart?.violations ?? null,
    conversion: parsed?.conversion?.funnel ?? parsed?.conversion ?? null,
  });
  writeFileSync(`${outDir}/live-flow-timeline.json`, JSON.stringify({capturedAt: new Date().toISOString(), rounds: rows}, null, 2));
  if (index + 1 < rounds) await new Promise((resolve) => setTimeout(resolve, everyMs));
}
console.log(JSON.stringify({done: rows.length, last: rows.at(-1)}, null, 2));

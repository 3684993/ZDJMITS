const API = 'http://127.0.0.1:8080';
const L = (t) => (t ? new Date(Number(t) + 288e5).toISOString().replace('T', ' ').slice(5, 19) : '-');
const samples = [];
for (let i = 0; i < 9; i++) {
  const started = Date.now();
  const p = await (await fetch(API + '/api/v3/pipeline', { signal: AbortSignal.timeout(30_000) })).json();
  const r = p.reconciliation;
  samples.push({
    atUtc8: L(p.asOf),
    activeRiskUnresolved: r.activeRiskUnresolvedCount,
    verifiedNoActiveRisk: r.verifiedNoActiveRiskUnknownCount,
    historicalUnknown: r.historicalUnknownCount,
    drift: r.driftCount,
    unresolvedDrift: r.unresolvedDriftCount,
    lastAuditUtc8: L(r.unknownRiskLastAuditAt),
    nextAuditUtc8: L(r.unknownRiskNextAuditAt),
    capacityInFlight: p.capacity.inFlight,
    positions: p.capacity.positions,
    aiIdleReason: p.primaryBrain.resource.idleReason,
    lastRunAgeMinutes: Number((p.primaryBrain.lastRunAgeMs / 60000).toFixed(1)),
  });
  const wait = 25_000 - (Date.now() - started);
  if (i < 8 && wait > 0) await new Promise((res) => setTimeout(res, wait));
}
console.log(JSON.stringify({ samples, activeRiskUnresolvedValues: [...new Set(samples.map((s) => s.activeRiskUnresolved))], inFlightValues: [...new Set(samples.map((s) => s.capacityInFlight))] }, null, 1));

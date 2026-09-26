// Read-only live probe for the A-D closeout: the authoritative verdict, TP protection progress, and write attribution.
const base = process.argv[2] ?? 'http://127.0.0.1:8080/api/v3';
const get = async (u) => { const r = await fetch(`${base}${u}`); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.json(); };
const [closeout, pipeline, positions] = await Promise.all([get('/diagnostics/closeout'), get('/pipeline'), get('/positions')]);
const rows = Array.isArray(positions) ? positions : (positions.positions ?? []);
const tally = rows.reduce((a, r) => (a[r.tpStatus] = (a[r.tpStatus] ?? 0) + 1, a), {});
const b = pipeline.authoritativeBlocker ?? closeout.pipeline?.authoritativeBlocker ?? {};
console.log(JSON.stringify({
  at: new Date().toISOString(),
  identity: {pid: closeout.runtime.pid, buildId: closeout.runtime.buildId, restartCount: closeout.runtime.restartCount, startReason: closeout.runtime.lastRestartReason},
  writes: closeout.productionWriteBoundary,
  tp: {tally, metrics: {required: pipeline.takeProfit?.required, protected: pipeline.takeProfit?.protected, missing: pipeline.takeProfit?.missing,
    positionFactUnresolved: pipeline.takeProfit?.positionFactUnresolved ?? 0, unverifiedTp: pipeline.takeProfit?.unverifiedTp},
    unprotected: rows.filter(r => r.tpStatus !== 'PROTECTED').map(r => `${r.symbol}:${r.side}:${r.tpStatus}:${r.tpCoverageSource}`)},
  authoritativeBlocker: b,
  marketDataIsolation: pipeline.marketDataIsolation,
  authority: {status: pipeline.portfolioRiskProfile?.authority?.authorityStatus, missingSymbols: pipeline.portfolioRiskProfile?.authority?.missingSymbols,
    uncoveredCount: (pipeline.portfolioRiskProfile?.authority?.uncoveredCoverageCandidates ?? []).length,
    coverageLag: pipeline.portfolioRiskProfile?.authority?.coverageLag ?? null},
  funnel30m: {place: pipeline.entryConversion?.thirtyMinutes?.place, riskAllowed: pipeline.entryConversion?.thirtyMinutes?.riskAllowed,
    topDrop: pipeline.entryConversion?.thirtyMinutes?.topDropReason, blocked: pipeline.entryConversion?.thirtyMinutes?.blocked},
  analysis: {reason: pipeline.analysis?.reason, idleReason: pipeline.primaryBrain?.idleReason ?? null},
}, null, 1));

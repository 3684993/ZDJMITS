const API = 'http://127.0.0.1:8080';
const samples = [];
let dispatched = null;
for (let i = 0; i < 10; i++) {
  const started = Date.now();
  try {
    const p = await (await fetch(API + '/api/v3/pipeline', { signal: AbortSignal.timeout(20_000) })).json();
    const a = p.analysis ?? {};
    const m = p.primaryBrain?.resource ?? {};
    samples.push({
      utc8: new Date(p.asOf + 288e5).toISOString().slice(11, 19),
      reason: a.reason,
      mode: a.mode,
      capitalExec: a.capitalExecutableCount,
      blocked: a.lastBlockedReason,
      lastAttemptAt: a.lastAttemptAt ? new Date(a.lastAttemptAt + 288e5).toISOString().slice(11, 19) : null,
      lastSuccessAt: a.lastSuccessAt ? new Date(a.lastSuccessAt + 288e5).toISOString().slice(11, 19) : null,
      silenceMin: Number((a.silenceMs / 60000).toFixed(1)),
      model: m.status,
      queueDepth: m.queueDepth,
      runs: m.totalRuns,
      failures: m.failures,
      poolReady: p.pool?.ready,
      pipelineReady: p.pool?.health?.counts?.potentialReadySymbols,
    });
    if (a.lastAttemptAt && !dispatched) dispatched = samples.at(-1);
  } catch (error) {
    samples.push({ error: error instanceof Error ? error.message : String(error) });
  }
  const wait = 45_000 - (Date.now() - started);
  if (i < 9 && wait > 0) await new Promise((r) => setTimeout(r, wait));
}
console.log(JSON.stringify({ samples, firstDispatchAttempt: dispatched }, null, 1));

# Engine native crash analysis — foreground 2026-10-06 09:07:15

## Status

Incident remains **open**. The foreground run reproduced the same native Windows fail-fast:

- exit decimal: `-1073740791`
- exit hex: `0xC0000409`
- process duration: `227.885s`
- `RUNTIME_STARTED`: 09:10:23.264
- native exit: 09:11:03.201
- runtime-after-ready lifetime: about **39.94s**

No automatic restart is introduced. No production write policy, exchange boundary, trading history, SQLite contents, 8083, or 8084 lifecycle behavior is changed.

## Evidence timeline

1. 09:07:15.316 — foreground process launch, Node v22.23.1 / V8 12.4.254.21-node.56 / `--no-maglev`.
2. 09:07:53.508 — Engine runtime object created.
3. 09:07:55.782 — HTTP 8080 listening.
4. 09:08:04–09:10:22 — normal startup recovery/reconciliation continues, including private sync, historical entry verification, position/trade repair and TP recovery.
5. 09:10:23.264 — `RUNTIME_STARTED`.
6. 09:10:31.360 — execution readiness reports physical/fact blockers normally.
7. 09:10:34.449–09:10:34.756 — large but successful V396 ownership outbox burst.
8. 09:10:38–09:10:59 — candidate, TTL and market/private work continues.
9. 09:11:01.999 — Binance HTTP incident recovery for `/fapi/v1/userTrades`.
10. 09:11:02.076 — last successfully mirrored Engine event: `V396_OWNERSHIP_OUTBOX`, BTCUSDT LONG exit task still `WORKING`.
11. 09:11:03.201 — foreground wrapper observes native `0xC0000409`; there is no JS fatal handler, graceful shutdown, or ordinary exception before it.

Gap from the last successful event to native exit: about **1.125s**.

## What the evidence rules down

- This run is **not** a bootstrap-only failure. Runtime reached `RUNTIME_STARTED` and continued for ~40 seconds.
- `--no-maglev` is again present, so Maglev is not an established root cause.
- The SQLite experimental warning alone is not causal evidence.
- The operational SQLite health worker is created during `EngineRuntime.create()`, not at `RUNTIME_STARTED`. Its first read/quick-check happens immediately and the process survives for minutes afterward. The crash therefore does not line up with a first health-worker activation.
- Post-ready 45s and 60s timers had not yet reached their first scheduled boundary at the crash time. They are lower priority for the next capture.
- The final `V396_OWNERSHIP_OUTBOX` event proves that path completed far enough to publish; it does **not** prove the ownership subsystem caused the fail-fast.

## Highest-value remaining boundaries

The crash occurs ~39.94s after timer registration, so the strongest scheduled candidates are the 1-second / 2-second recurring paths that would have run around 09:11:02:

- `MARKET_EXCHANGE_TICK`
- `WRITE_BUFFER_FLUSH`
- `TRADING_QUALITY_TICK`
- `AI_RUN_SUMMARY_BACKFILL`
- `ASSET_GOVERNANCE_TICK`
- pending-entry/manual-exit/research 2s paths

A second independent path is still in flight: startup calls `startTradeRecordAutoSync()` immediately after bootstrap. That path performs historical `userTrades/allOrders/income` reads and, after the audit, creates a SQLite baseline backup before applying repairs. The 09:11:01.999 `/userTrades` recovery is temporally consistent with this sync still doing audit work, but the old log does **not** show whether it had reached audit end, SQLite backup, or apply. Therefore it is a priority diagnostic boundary, not yet a proven cause.

Node's documented `sqlite.backup()` contract explicitly allows mutations from the same connection during backup, so merely seeing backup in this code is not enough to call it an application bug. Current Node documentation still labels `node:sqlite` Stability 1.2 (release candidate), and recent upstream native-crash fixes/issues show that this subsystem can fail below the JS exception boundary. We therefore need exact local phase evidence before changing storage semantics.

## Change made

Commit `bbc2a3d8382f3631a1a583a4d6eaf737cf686400` adds foreground-only boundary tracing:

- `SCHEDULED_TASK_BEGIN`
- `SCHEDULED_TASK_END`
- `SCHEDULED_TASK_FAILED`

for the crash-relevant scheduler paths.

It also records startup TradeRecord auto-sync phases:

- `AUDIT_BEGIN` / `AUDIT_END`
- `BASELINE_BEGIN` / `BASELINE_END`
- `APPLY_BEGIN` / `APPLY_END`

These traces go through the existing process-lifecycle append-only file/foreground console path, **not** through the Engine SQLite event journal. Normal non-foreground operation does not emit the new high-frequency trace.

## Next evidence rule

On the next foreground reproduction:

- If the last lifecycle row is `SCHEDULED_TASK_BEGIN` without its matching END, inspect that named subsystem first.
- If the last TradeRecord phase is `BASELINE_BEGIN`, isolate/replace the backup path next.
- If it is `APPLY_BEGIN`, inspect transaction/SQLite apply work.
- If all named tasks close cleanly before the fail-fast, extend the same boundary mechanism to the remaining unnamed timer(s); do not switch V8 flags.

No code path should auto-restart the Engine after the fail-fast.

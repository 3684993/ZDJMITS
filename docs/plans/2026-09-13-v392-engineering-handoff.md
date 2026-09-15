# ZDJ-MITS V3.9.2 Engineering Handoff — 2026-09-13

This file is the canonical handoff for the next ChatGPT/Codex session. Read it before making changes and verify the current GitHub branch HEAD and CI status instead of assuming this snapshot is still current.

## Baseline

Repository: `3684993/ZDJMITS`
Branch: `gpt56-optimize-v392-20260912`
Last fully verified code HEAD before this documentation commit: `f016d15fd4f41666485c566264641a9428a44e78`
CI: `V3.9.2 Final Verify #80` passed for `f016d15`.
Local workspace: `D:\MITS`.

The current release is V3.9.2. Do not redesign the architecture. Preserve the validated direction, risk, reconciliation, exactly-once, TP protection, rate-limit and production-boundary contracts.

## Completed work

### Binance proxy boundary

`BinanceTransport` is now proxy-only for Binance network traffic. REST and WebSocket paths use the configured SOCKS proxy. Missing/disabled proxy fails closed with `PROXY_REQUIRED`; legacy DIRECT values are no longer honored by the transport.

The persisted settings/API can still expose legacy values such as:

- `forceBinanceRest=false`
- `forceBinanceWs=false`
- `binanceRestRoute=DIRECT`

Those values are now display/persistence debt and must be migrated so Settings/API/UI reflect the real runtime policy.

### REST/rate-limit work already completed

- Testnet skips the four `/futures/data/*` endpoints previously returning 301.
- `/fapi/v1/openInterest` and `/fapi/v1/premiumIndex` remain available.
- Derivatives are cached per symbol for five minutes with single-flight behavior.
- Healthy global `/fapi/v1/openOrders` scans are limited to a five-minute cadence, with abnormal-state verification still available.
- Private synchronization remains on its safety cadence.
- RequestBudget has a bounded 512-row dispatch ledger and persists P0 evidence on 418/429.
- Blocked attempts no longer overwrite real exchange-response timestamps.
- The hard request-weight threshold remains 2200 and must not be increased merely to hide traffic problems.

### Storage

The Testnet SQLite database was rebuilt schema-only while retaining static configuration and secrets. Runtime/history data was cleared. The remaining large `.legacy` SQLite file is the final rollback copy and should remain until stable validation is complete.

Capacity states remain: 512 MiB WARNING, 768 MiB PRESSURED, 1024 MiB SHEDDING, 1280 MiB ENTRY_BLOCKED, 1792 MiB HARD_RESERVE.

### Theme

The intended default theme is `BURGUNDY_EDITORIAL`. Existing explicit user theme choices should remain persistent.

## Historical 418 investigation

An earlier Binance response reported banned IP `15.158.242.74`. The prior process recorded no local 429 before the 418, so historical/out-of-process IP state remains plausible, while the old REST traffic pattern was also a material amplifier. Do not claim a fixed relationship between that historical IP and the current SOCKS egress without evidence.

Latest manual proxy verification on 2026-09-13:

- SOCKS endpoint: `127.0.0.1:20081`
- observed SOCKS public egress: `172.104.186.174`
- Testnet `/fapi/v1/time`: HTTP 200
- `x-mbx-used-weight-1m: 1`

During the latest application startup, no new 418, 429, banned, `PROXY_REQUIRED`, or `direct-none` log match was observed.

## Latest startup finding

The most recent validation exposed a different problem: `BINANCE_REQUEST_QUEUE_TIMEOUT` during cold start.

Health at the time showed:

- Trading Network Gate: HEALTHY
- market WebSocket: LIVE, no reconnect/gap issue
- market snapshots: 0
- dynamic pool: 0/20
- AI Fabric: HEALTHY
- Reconciliation: DEGRADED due to request queue timeout
- TP Guardian: required 11, protected 10, missing 1
- Persistence: HEALTHY

The internal proxy test also returned `BINANCE_REQUEST_QUEUE_TIMEOUT`. This does not prove proxy failure; it indicates the test request did not obtain a RequestBudget dispatch slot within the queue expiry window.

Before another runtime validation, verify that the previous engine instance is stopped. Preserve its logs for diagnosis.

## Root cause currently identified

RequestBudget currently uses bounded concurrency/start-rate controls and a five-second queue expiration.

`BinancePublicMarketDataProvider.getSnapshot(symbol)` still constructs a large parallel request fan-out: quote, order book, derivatives and multiple candle timeframes. Some of those calls fan out again internally. Cold-start MarketCohort hydration can process two symbols, multiplying the burst. This can fill RequestBudget and expire queued requests before useful snapshots are established.

`EngineRuntime.bootstrap()` also still performs two reconciliation runs around `refreshPositionMarkets()`, adding unnecessary startup pressure.

## Next implementation scope

Only three closeout items should be implemented unless new evidence requires a narrowly related fix.

### A. Remove cold-start snapshot REST burst

Refactor snapshot loading into controlled phases instead of one large `Promise.all`. Preserve caches and single-flight behavior. Critical private/order/TP/clock work must keep priority over market bootstrap. Cold-start cohort hydration should progress conservatively rather than creating an immediate multi-symbol fan-out. Do not solve this by simply increasing the 2200 hard limit or greatly extending queue timeout.

### B. Reduce bootstrap reconciliation to one full startup pass

Remove the unconditional second full startup reconciliation while preserving abnormal-state verification, UNKNOWN recovery, TP integrity and exactly-once behavior.

### C. Finish Settings single-source-of-truth cleanup

`SystemSettings` should be the runtime truth. Migrate old proxy values so persisted/API/UI state reflects proxy-only execution (`CONFIGURED`, REST/WS forced, DNS through proxy, fail closed). Remove misleading DIRECT/fallback UI semantics.

Audit Proxy and AI resource CRUD/test flows so add/edit/delete/enable/test actions update the configuration actually consumed by runtime services. Resource catalog tables may remain for compatibility/indexing but must not present a separate effective-state truth. Remove UI/schema fields or roles that the runtime does not actually support instead of leaving inert options. Local AI endpoints must remain local and independent of the Binance proxy.

Ensure `BURGUNDY_EDITORIAL` is the default theme while preserving explicit user choices.

## Verification requirements

Add or retain tests for proxy-only REST/WS behavior, fail-closed proxy absence, legacy settings migration, bounded cold-start request scheduling, priority of critical exchange state over market bootstrap, a single startup full reconciliation, five-minute healthy global open-order cadence, abnormal-state verification, Testnet derivatives suppression/cache, TP alias integrity, exactly-once/UNKNOWN recovery, Settings-to-runtime resource behavior, and production write boundaries.

Run the repository's full `npm run verify`. A new runtime validation should happen only after the latest branch HEAD has a successful `V3.9.2 Final Verify`.

## New-session procedure

1. Read this file first.
2. Fetch the latest HEAD of `gpt56-optimize-v392-20260912`.
3. Check the latest `V3.9.2 Final Verify` result.
4. Compare newer commits against this handoff so completed work is not repeated.
5. Confirm the previous local engine instance is stopped before any later runtime validation.
6. Continue with the three closeout items above, using minimal changes and preserving existing safety contracts.

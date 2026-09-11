# ZDJ MITS V3.9.2 final implementation report

Date: 2026-09-10 (Asia/Shanghai)

## Final status

- **DONE — engineering closeout:** source contracts, AI failure isolation, closed-candle readiness, indicator semantics, entry-location evidence, ideal-first Maker selection, reconciliation/TP/幂等 boundaries, and version alignment are implemented and verified.
- **BLOCKED/PENDING — runtime artifact cutover:** PID 21908 is V3.9.2 but still carries the old artifact/source hashes. The one explicitly authorised manual switch was attempted; the prescribed script stopped the old process, then returned `Access denied` at its LAN firewall-rule step before starting the new build. The elevated retry was rejected by the execution quota, so the latest disk artifact is not loaded and no second lifecycle action was taken.
- **PENDING/NO-GO — online/Testnet evidence:** 8081/8084 now genuinely listen and pass model/completion probes, while the loaded runtime remains old and strict market readiness is still blocked (fresh-market count 0, current pool 11/20 qualified, 0 ready). The pipeline is `PAUSED_MARKET_DATA_UNAVAILABLE` with `MARKET_QUOTES_STALE`. Therefore latest-artifact proof, 8084 recovery SLO, WAIT/Maker natural samples, 100 natural entries (LONG/SHORT minimums), 24-hour and 100-lifecycle evidence, and OOS acceptance remain genuinely PENDING.
- **BLOCKED — Production Read-Only/Canary:** an independently authorised Production read-only credential, account/mode/limits and exit plan were not supplied. Production write remains locked; no Production write was enabled or attempted.

The Engine was switched once through the explicitly authorised manual path; no further lifecycle action was taken by this task. No live Settings, SQLite positions, orders, TP protection, or risk limits were changed.

## Implemented P0/P1/P2 closeout

- **P0 AI 8084 circuit:** bounded request-body deadline, retry/backoff, explicit AVAILABLE → OPEN → PROBING → HALF_OPEN → AVAILABLE state machine, one bounded health probe, failure-class recording, and entry-only blocking. TP/private sync/reconciliation paths are not gated by Primary AI.
- **P0 facts and readiness:** strict closed-candle filtering, exchange-boundary/grace handling, duplicate/gap rejection, 240-bar 15m supply, and EMA55 warm-up readiness.
- **P0 authorization/attribution:** existing stable capability preview and canonical order/fill attribution boundaries are preserved; no new write path was added.
- **P1 decision contract:** V3.9.2 fact/prompt/output fields distinguish structural `TREND_DIRECTION` from `MOMENTUM_STATE`; opportunity types, market regime, location reason, invalidation and evidence references are explicit. `NO_DIRECTION_EDGE` is a valid no-entry outcome; direction is not mechanically rewritten from a single timeframe.
- **P1 execution:** legal recent-trade/range candidates are sorted by distance to the ideal price first, with WAIT deadlines and duplicate-Primary protection retained.
- **P1 quality evidence:** entry/mark/bid/ask anchors and MAE/MFE quality fields remain available for natural-sample collection; unknown gaps are not imputed.
- **P2 Production boundary:** read-only preflight/collector boundary remains separate and default-canary-disabled.

## Online fact acceptance

- Runtime `/health`: HTTP 200 READY; V3.9.2; PID 21908; listener `0.0.0.0:8080`.
- Current loaded artifact is internally self-consistent with its runtime identity. The disk build after the online P0 fix is newer (`artifact 0f01c1475839574166bb4caeb7907bb63cf082f6d1917141ce7b39fdd8f69cc6`, `source cd66aa1558ba6fa7e401eb4d663ad91908e7561519e3daedce44b692a3d92379`) and is **not loaded** because no second lifecycle action is authorised.
- Binance Testnet account/private sync is READY; reconciliation drift=0, unresolved drift=0, verified order-fact mismatch=0; six existing positions have six protected TP records.
- P0 entry-integrity endpoint: `passed=true`; cross-symbol mismatch=0, active-remote-with-new-Primary=0, unverified-terminal-release=0, Brain-run misattribution=0.
- 8084 and 8081 direct probes: both now return HTTP 200 health/model responses and real `OK` completions. The runtime resource rows are consistent with those listeners, but this does not prove latest-artifact loading; no new natural V3.9.2 Entry cohort exists.
- Strict closed-bar diagnostics are functioning: 1m/5m/15m bars are marked closed, while missing latest bars and 15m warm-up are surfaced as blocking reasons. No threshold was relaxed.
- Candidate supply is safety-preserving but below target: latest snapshot 11/20 active residents (11 qualified, 0 ready), no reserve candidates; no low-quality assets were added. The global state is `PAUSED_MARKET_DATA_UNAVAILABLE` because quotes are stale. This is a safety block, not a forced-PLACE or global Engine shutdown.

## Files changed

Version and contract alignment: `package.json`, `package-lock.json`, `apps/engine/package.json`, `apps/dashboard/package.json`, `packages/contracts/package.json`, `packages/core/package.json`, `packages/contracts/src/version.ts`, `packages/contracts/src/ai.ts`.

Runtime/quality changes: `apps/engine/src/adapters/ai/OpenAiCompatibleClient.ts`, `apps/engine/src/services/aiFabric.ts`, `apps/engine/src/services/entryCoordinator.ts`, `apps/engine/src/adapters/market/BinancePublicMarketDataProvider.ts`, `apps/engine/src/adapters/market/MockMarketDataProvider.ts`, `apps/engine/src/services/marketDataHub.ts`, `apps/engine/src/services/nearMarketPrice.ts`, `packages/core/src/indicators.ts`, `packages/core/src/compactEntry.ts`.

Tests/fixtures corrected for the new semantics: `packages/core/src/selection.test.ts`, `apps/engine/src/services/v370Decision.test.ts`, `apps/engine/src/services/aiFabric.test.ts`, `apps/engine/src/services/temporalAlgorithms.test.ts`, `apps/engine/src/services/marketDataHub.test.ts`.

## Verification

- `npm run typecheck` — PASS (contracts/core/dashboard/engine).
- `npm test` — PASS: 334 tests (core 39/39, dashboard 15/15, engine 280/280).
- `npm run build` — PASS (all workspaces; dashboard Vite production bundle built).
- `npm run verify` — PASS (typecheck + build + all 334 tests).

The repository has no usable Git metadata at `D:\MITS`; a Git diff/status claim is therefore not made. The failed `npm install --package-lock-only` was not needed and made no source change; the lockfile was aligned locally without enabling network/private-registry writes.

## Entry-quality before/after

The plan's historical baseline is 172 exactly linked orders (LONG 92, SHORT 80), with 63/172 invalid timestamps. Sampled MAE/MFE values were recorded as observations, not performance claims (for example LONG 5m MAE 44.68 bps and SHORT 5m MAE 22.68 bps). The implementation now supplies structural trend, separate momentum, closed/gap-safe multi-timeframe facts, explicit location/invalidation reasons, and ideal-first legal Maker selection. No new natural V3.9.2 entry cohort exists yet, so an after-quality uplift is **PENDING**, not fabricated.

The pre-cutover read-only evidence identified V3.9.0; it is retained as historical context only. The post-cutover instance is V3.9.2 as stated above. Other captured snapshots show degraded 27B/9B periods; those are retained as facts and are not relabelled as recovery.

## Remaining Canary hard gates

1. One successful manual launch of the built V3.9.2 artifact with exact runtime/build-hash proof (the authorised attempt was blocked at the script firewall step).
2. At least 2h stable 8084 circuit/recovery observation with no Primary loop, while TP/private/reconciliation remain healthy.
3. At least 100 natural new entries with LONG ≥30 and SHORT ≥30, plus WAIT/Maker and attribution/MAE/MFE quality reports.
4. 24h and 100-lifecycle evidence, including reconciliation, TP protection, idempotency and no unexplained drift.
5. Binance Testnet OOS acceptance on a fixed sample.
6. Independent Production read-only authentication and account/mode/limit/exit-plan gates (currently BLOCKED).
7. Production Canary write remains hard-locked until every preceding gate is evidenced and separately authorised.

## Split acceptance decision

- ENGINEERING PASS: **PASS** (source, contracts, tests, build and verify).
- TESTNET ONLINE PASS: **NO-GO/PENDING** (model listeners now pass, but latest artifact/hash loading and market-ready pool are not proven).
- ENTRY QUALITY OOS PASS: **PENDING** (zero post-cutover natural Entries).
- 24H/100 LIFECYCLE PASS: **PENDING**.
- PRODUCTION READ-ONLY PASS: **BLOCKED** (independent Production RO credentials and account boundary not supplied).
- CANARY: **NO-GO** until the hard gates above are evidenced; Production write stays LOCKED.

## Latest online recovery attempt (2026-09-10 15:47 +08:00)

- 8081 is genuinely listening and returns `/health` HTTP 200 plus model `qwen3.5:9b`; the current real `/v1/chat/completions` probe returned `OK` in 580 ms.
- 8084 is genuinely listening and returns `/health` HTTP 200 plus model `qwen/qwen3.8-27b`; the current real `/v1/chat/completions` probe returned `OK` in 434 ms.
- The running Engine remains PID 21908, V3.9.2, build `3.9.2-9e5cbb74ffd4abba1576`, artifact `9e5cbb74ffd4abba15767e84b73932ffd6c4d5451e701995fcebce6b58ca517f`, source `48bb0e74ee4a409609b117973eb4e6ecec3874ac28367069b74524fd08b84b52`. The authorized manual start script returned `Access denied` at its LAN firewall-rule step; the elevated retry was rejected by execution quota. The latest disk build is artifact `335742dc68e97d804bf44c9030a5bb04f03553de34c874a6d6eabc1387bd8c91`, source `a35e1a390c0f230c45d02d3289dd4d9f84337ba2817dec7829720e6c2f773e95`; it is **not loaded**. No alternate launch, hot replacement, supervisor, or retry loop was used.
- The root market fault is confirmed: the loaded artifact still requests only 240 15m bars, so closed-only filtering leaves 239 and emits `TECHNICAL_15m_WARMING`; the same old path has no one-bar headroom on 5m and reports `TECHNICAL_5m_MISSING_LATEST_CLOSED`. The disk fix now requests 81 bars for 1m/5m and 241 for 15m, while the symbol-level hydrate isolation prevents one gap from aborting the global tick.
- Current online facts after model recovery: Engine `/health` READY; Primary successful runs 3; Scout runs 121; AI failure streak 0; Private Sync consecutive failures 0; reconciliation drift 0; TP required/protected 3/3; P0 integrity remains zero-count. Market remains `PAUSED_MARKET_DATA_UNAVAILABLE`, fresh=0, pool=11/20 with ready=0 because strict freshness and old-artifact candle headroom remain unresolved. No new Entry intent or fill was created.

## Artifact delivery status

Per the user's latest instruction, delivery is **LOCAL-ONLY**. The formal report, JSON, and online evidence are complete and stored under `D:\MITS\docs\reports\final-entry-audit-20260910\`. No further Google Drive upload or retry is part of this delivery; the earlier connector limit is retained only as historical context.

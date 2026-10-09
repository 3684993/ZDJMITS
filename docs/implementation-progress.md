# V3 Implementation Progress

## V3.9.8 P0 local continuation — 2026-10-09 22:14+08

Source `0399eff5e601723c249ff6f6b70c59a23cb8dd22` full `npm run verify` PASS: exit0, 251 Vitest files / 2157 tests, scripts/S00/type/build gates. PR20 regression repaired; lane telemetry uses one observation time. Eight existing ZDJ task actions hidden, original triggers/principal/status and safety observers preserved; natural task runs returned0. See [execution receipt](./reports/v398-proxy-network-p0-20261009/LOCAL_EXECUTION_RECEIPT_20261009.md) and [project memory](./project-memory.md).

Release **NO-GO**: old live PID18100, stale private facts/SOCKS timeout, latest signed TP and Binance eligibility not proven. No lifecycle, Settings or manual exchange writes; existing Production writes0. `CADENCE_90MIN=NOT_STARTED`, retrospective Primary0 is not new-build acceptance. Main exact7d698a5 CI SUCCESS, PR20 hosted CI not triggered; no workflow mutation or unsafe dispatch. GitHub final source/docs SHA and evidence hashes must be read back independently.

| Stage | Status | Date | Commit | Evidence | Go/No-Go |
|---|---|---|---|---|---|
| 0 基线完整性 | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | `npm run verify` through typecheck/test/build; Mock Engine 10m trace at `127.0.0.1:18080`: 120 universe, 30 recent AI runs, 101 entries, 49 TP orders, 39 completed outcomes; six smoke endpoints PASS; engine stderr 0 lines | GO |
| 1 持久化与审计 | COMPLETE / EXTERNAL GATE | 2026-08-23 | N/A（交付目录不含 Git metadata） | SQLite WAL settings + runtime facts + 10k redacted event audit + backup/restart tests PASS; DPAPI invocation bugs fixed, but CurrentUser Protect is rejected because this execution profile is not loaded for the thread | GO for local runtime; external credential gate |
| 2 Market Data Hub | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Binance REST + one shared USD-M WS through the same SOCKS5H agent; ticker/mark/book/1m cache, heartbeat, exponential reconnect, depth sequence-gap REST backfill tests; full `npm run verify` PASS | GO |
| 3 Universe / Pool | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Five modes, percentile components, Top N/generation, target/max/replacement and position/active-entry eviction covered by 9 Core tests; full verify PASS | GO |
| 4 EIP | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | EIP 3.0 six-timeframe/market/derivatives/global/portfolio/experience packet; freshness, critical-missing and completeness fail-closed gates; indicator and prompt-budget tests; full verify PASS | GO |
| 5 三GPU AI | COMPLETE (single-brain topology) | 2026-08-23 | N/A | 8081 Scout and 8084 Primary `/models` and JSON completion smoke PASS; Engine real-AI trace 28 completed / 0 failed | GO |
| 6 Binance写Adapter | COMPLETE / EXTERNAL GATE | 2026-08-23 | N/A | TESTNET-only HMAC GTX entry/TP/cancel/replace/leverage/query adapter plus SOCKS5H listenKey User Data WS, keepalive/heartbeat/backoff and reconciliation trigger tests PASS | Code GO; private trace gated by DPAPI/Testnet credentials |
| 7 Entry Manager | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Maker/band 500-case property test, sizing, partial-fill/TTL plus SQLite restart recovery of intents/orders PASS | GO |
| 8 Position / TP / Reconciliation | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Exchange-truth order/position merge, server-verified TP side/qty/price, missing TP single repair and convergence test; auto-stop execution scan 0 | GO |
| 9 Dashboard | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Nine API/WS-driven routes; schema-validated backend snapshot projection; redacted bounded AI audit previews; four-zone server-round-trip settings; WS backoff + 5s REST recovery; full verify PASS | GO |
| 10 Resilience / Security | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Fail-closed evidence/network/credential gates, truthful readiness, DB/audit/stream/reconciliation health, structured JSON events, 40-file guardian rotation, restart and WS recovery tests; full verify PASS | GO |
| 11 Endurance | COMPLETE | 2026-08-23 | N/A（交付目录不含 Git metadata） | Independent `scripts/run-3h-endurance.ps1` defaults to 180m and owns process restart/sampling/evidence/summary; 0.2m harness smoke: 4 READY samples, 0 restarts, 12 max entries, 176 audit events; static acceptance + full verify PASS | GO to run unattended 3h; credentialed Testnet duration remains external gate |

## Stage 1–5 continuation — 2026-08-23

### Implemented evidence

- `data/zdj-settings.sqlite` is now the settings source of truth. It uses WAL, `BEGIN IMMEDIATE` transactions, settings versioning, redacted audit rows, connection profile persistence, integrity check, backup, and restart-read test coverage.
- Persistent settings now carry SOCKS5H proxy policy, TESTNET/production URLs, AI topology and execution modes. The default topology is `8081 qwen3.5:9b` Scout plus `8084 qwen/qwen3.8-27b` PRIMARY_BRAIN; review is OFF.
- `WindowsDpapiSecretStore` writes only ciphertext to SQLite, and secret APIs return only configured/masked status. In the current restricted execution profile, DPAPI Protect fails and the write endpoint fails closed; no supplied credential has been written in plaintext or logged.
- `BinanceTransport` is the REST path for public Binance market requests, enforces the configured SOCKS5H agent and rejects non-Binance hosts. Testnet server-time probe succeeded through SOCKS5H (590ms).
- Backend AI resource probes passed for 8081 and 8084. Engine real-AI trace recorded 28 completed runs and zero failed runs using the single PRIMARY_BRAIN topology.
- Corrected Engine startup so HTTP health/read APIs bind before long-running AI bootstrap; `/health` is available while model work is in progress. Increased the persisted model timeout to 120 seconds after observing EIP-sized Scout requests exceed the former 45-second limit.

### External gates / unimplemented production scope

- DPAPI command construction and assembly loading are fixed, but CurrentUser Protect still fails because this execution thread has no loaded Windows user profile. No credential row or plaintext was retained; this is the sole credential external gate.
- Signed Testnet REST and User Data WS are implemented, but their credentialed private trace remains externally gated. `executionMode` remains MOCK; no external order was created.

## Stage 2 — 2026-08-23

- Added a single multiplexed Binance USD-M market socket for all selected symbols. Binance WS and REST share the configured fail-closed SOCKS5H `127.0.0.1:20081` transport; local AI paths are unchanged.
- The shared stream caches 24h ticker, mark price, book ticker, partial depth and 1m klines. REST remains bootstrap/backfill and stale-cache fallback, rather than creating per-symbol sockets.
- Heartbeat terminates stale connections, reconnect uses bounded exponential backoff with jitter, and `pu` sequence gaps trigger one de-duplicated REST depth/kline recovery per symbol.
- Evidence: `BinanceMarketStream.test.ts` covers event merging and gap recovery; Engine 4 tests and full workspace typecheck/test/build all PASS.

## Stage 3 — 2026-08-23

- Validated all five selection modes with six explainable percentile components and the 35% comprehensive liquidity bias; Top N and generation semantics are tested.
- Fixed Dynamic Pool event reconciliation: any candidate that becomes ineligible because of a position or active Entry is evicted immediately even while analyzing, ranks/scores/generation update in place, max is enforced, and expired capacity refills in the same cycle.
- Changed candidate rank validation to allow explicit rank `0` for blocked/outside-Top-N rows.
- Evidence: Core suite 9 tests PASS; full workspace typecheck/test/build PASS.

## Stage 4 — 2026-08-23

- EIP 3.0 now refuses stale quote, order book, derivatives, timeframe cards and BTC/ETH regime context using category/timeframe-specific age limits.
- Critical OI/funding/taker evidence and configured completeness are fail-closed before any Scout/Brain call. Six timeframe cards, microstructure, BTC/ETH, portfolio and experience remain structured rather than substituted prose.
- Added independent constant-series reconciliation for EMA8/21/55, MACD 12-26-9, BB20-2, ATR14, volume z-score and freshness; EIP tests cover all six timeframes, missing/stale rejection and a <30k-character Brain prompt budget.
- Evidence: Core 10 tests, Engine 6 tests and full workspace typecheck/test/build PASS.

## Stage 7–8 — 2026-08-23

- Entry sizing is now a deterministic tested boundary for tick/step/minQty/minNotional. A 500-case maker property test proves LONG never exceeds bid, SHORT never falls below ask, and final prices remain inside the AI band.
- Fixed absolute TTL so cancellation still occurs when market snapshots disappear. Fixed partial fills so positions, margin and TP use executed quantity instead of original order quantity.
- Reconciliation now merges exchange order/position truth instead of merely counting array lengths. It closes disappeared local orders/positions, adopts external positions, and server-verifies every TP by id/side/quantity/price.
- Missing or mismatched TP is marked missing and repaired once; the next reconciliation converges without duplication. Source scan found zero automatic-stop execution path (the sole `stop-loss` text is an AI prohibition).
- Evidence: Core 12 tests, Engine tests and full workspace typecheck/test/build PASS; restart persistence was subsequently completed in Stage 10.

## Stage 9 — 2026-08-23

- Centralized `/snapshot` in a contract-validated backend projection. AI Run input/output audit previews are capped at 8,000 characters and redact credential/signature/authorization fields before entering runtime projection.
- Rebuilt Settings as four server-owned zones: strategy/execution, Binance environment/credentials, mandatory SOCKS5H policy, and the two local AI resources (8081 Scout, 8084 Primary). Saves always reload server truth; credential inputs clear immediately and never round-trip.
- Dashboard WS now reconnects with bounded exponential backoff; the existing five-second REST refresh continues while degraded and restores all projections after disconnect/browser refresh.
- Evidence: projection/redaction test PASS; Dashboard production build and full workspace typecheck/test/build PASS.

## Stage 10 and restart recovery — 2026-08-23

- SQLite now persists runtime Entry intents/orders, positions, TP orders, AI runs, experience outcomes and account facts; every domain event enters a capped 10,000-row redacted audit. Shutdown flushes, checkpoints and closes cleanly; restart recovery tests restore every fact class.
- `/health` is now truthful STARTING/503 until bootstrap completes, then READY/200 with DB integrity, audit/runtime timestamp, snapshot count, market stream and reconciliation details.
- Added structured JSON event output and a hidden Windows guardian that restarts failures and retains the newest 40 log files. SQLite uses a 5s busy timeout for safe guardian handoff/concurrent readers.
- Added TESTNET User Data WS using the mandatory SOCKS5H agent: listenKey keepalive, heartbeat, bounded backoff and private order/account events immediately trigger server reconciliation.
- DPAPI was retried after fixing two real invocation defects (PowerShell argument construction and missing `System.Security` load). CurrentUser Protect then reached Windows DPAPI and was rejected because this execution thread has no loaded user profile, so private acceptance remains an external gate.
- Evidence: Core 12 tests, Engine 13 tests, full typecheck/test/build PASS.

## Stage 11 — 2026-08-23

- Added `scripts/acceptance-static.ps1` for full verify, forbidden `.env`, automatic-stop execution scan, exact SOCKS5H policy, exact two-model topology and TESTNET-only production-write guard.
- Added `scripts/run-acceptance.ps1` as the combined static + short endurance acceptance entry point.
- Added independent `scripts/run-3h-endurance.ps1` with a 180-minute default. It starts the built Engine hidden, records STARTING/READY transitions, restarts crashes, samples snapshot/health/reconciliation/TP/AI/audit growth to JSONL, captures structured stdout/stderr and writes a machine-readable final summary. The Codex session does not need to wait.
- Harness smoke evidence: `data/endurance/20260823-124008/summary.json` — 4 READY samples, 1 truthful startup failure sample, 0 restarts, max 12 Entry orders, 176 audit events, summary PASS. Static acceptance and full workspace verify PASS.
- The unattended 3-hour run can now be launched separately. Credentialed TESTNET private-write evidence remains the DPAPI/user-profile external gate and is never replaced by mock evidence.

## Stage 0 — 2026-08-23

## V3.1.1 — 2026-08-23

- Added server-side AI Run Trace pagination (20/page), role/symbol/status/decision/model/time filtering and redacted per-run detail endpoints. Dashboard now exposes a click-through audit view with Summary, Input, Evidence, Output, Tools and structured Errors.
- AI run persistence now records queue, prompt-build, request, retry, parse and total timings plus input/output tokens; failures carry stage, code, HTTP/timeout/schema indicators and retry count without exposing secrets.
- Rebuilt Intelligent Market as a human-readable EIP page with prices/order book, multi-timeframe indicators, derivatives/orderflow, regime, portfolio/experience and evidence diagnostics; raw JSON is collapsed audit-only and a stale symbol is locally degraded.
- Corrected shared market stream subscription reconciliation and global-array event merging. Freshness now becomes DEGRADED only when fresh symbols cannot sustain the configured pool, rather than blocking entries for isolated stale symbols.
- Verification: root typecheck, test (28 test cases) and build PASS. A post-start stable window observed Engine READY, TESTNET private READY, WS LIVE, zero gap/backfill/reconnect and active Scout/Primary runs.

### 真实缺口与修复

- 安装工作区依赖，并修复首次基线校验的 TypeScript/Vue SFC 语法与类型错误。
- 修复 `resolveLeverage` 缺失及 `10X` / `20X` 枚举映射。
- 将 Express 5 不兼容的 Dashboard fallback `*` 路由改为 `/{*path}`；修复后 Engine 可实际启动。
- 确认端口 8080 被既有进程占用，因此在隔离端口 18080 验证本项目，避免误将其他服务的响应作为证据。

### 验证证据

- Node v22.23.1、npm 10.9.8；依赖已安装。
- `npm run typecheck` PASS；`npm run test` PASS（Core 5、Dashboard 2、Engine 1；Contracts 无测试且显式允许空测试）；Dashboard production build PASS；Engine build PASS。
- `GET /health`、`/api/v3/snapshot`、`/api/v3/universe`、`/api/v3/pool`、`/api/v3/brain/resources`、`/api/v3/operations/health` 全部 200。
- 约 10 分钟 Mock trace 已覆盖 Universe → Pool → EIP → Scout/Brain → Entry → Fill → Position → TP → Experience；最后观测为 120 Universe、30 最近 AI runs、101 Entry、49 TP、10 active positions、39 outcomes；Engine stderr 为 0 行。

### 当前结论

- 所有普通开发 Stage 已完成；仅保留明确标注的 Windows CurrentUser DPAPI / credentialed TESTNET private trace external gate。独立 3 小时采集脚本已交付，可脱离 Codex 会话运行。

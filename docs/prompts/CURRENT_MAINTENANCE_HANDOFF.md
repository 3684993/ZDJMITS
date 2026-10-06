# J-MITS V3.9.7 — CURRENT MAINTENANCE HANDOFF

> Stable handoff entrypoint for a new ChatGPT maintenance conversation.
> Last refreshed: 2026-10-06 (+08:00)
> Repository: `3684993/ZDJMITS`
> Current baseline main: `e8d90808786efd095b6bc871412aa4a9b4d547d0`
> GitHub Actions baseline: #495 SUCCESS

## 0. Instructions to the next ChatGPT conversation

You are continuing maintenance of the user's real local J-MITS V3.9.7 TESTNET trading system.

Do **not** ask the user to restate historical context that is already in this handoff or in GitHub.

At the beginning of the new conversation:

1. Read this handoff from GitHub.
2. Inspect current GitHub `main`, recent commits, current CI status, and any files referenced below.
3. The user will upload the latest foreground Engine crash log, expected filename:
   - `engine.foreground.20261006-090715.log`
4. Read the uploaded log completely enough to reconstruct the startup/crash timeline. Prefer direct evidence over theories.
5. Compare the crash timestamps/events with:
   - `data/runtime-logs/engine-process-lifecycle.jsonl` if included in an uploaded handoff/log bundle,
   - `data/runtime-logs/engine-launch-lifecycle.jsonl`,
   - Engine source scheduling/runtime code on current GitHub main.
6. Continue fixing/maintaining the GitHub project directly when evidence supports a change.
7. Run/inspect GitHub Actions after edits and leave `main` green.
8. Do not tell the user to wait for background work. Complete the current step in the same turn as far as tools allow.
9. Prefer decisive, evidence-based changes over repeated diagnostic flag experiments.

### Critical operating rule

**Never stop, restart, reload, or otherwise disturb the user's 8083 and 8084 llama-server models without explicitly telling the user first and obtaining their awareness/approval for that lifecycle action.**

Current logical services:
- 8081: Scout
- 8083: `HARNESS_ADVISOR` / review model, normally physical Vulkan1 / RX 7900 XTX
- 8084: `ZDJ_PRIMARY_BRAIN`, normally physical Vulkan2 / RX 7900 XTX
- 8080: J-MITS Engine + Dashboard

Ordinary Engine maintenance/restart must touch **8080 only**.

Production writes must remain exactly **0** until the user explicitly transitions to real production.

---

## 1. User preferences and working conventions

- Language: Chinese preferred.
- Be implementation-oriented and decisive.
- Avoid repeatedly asking questions already answered by repository state or this handoff.
- User prefers complete runnable scripts/files rather than fragmented diffs when local files are needed.
- Local project root: `D:\MITS`.
- Local helper scripts: preferably `D:\MITS\scripts\`.
- Reports/evidence: preferably under `D:\MITS\docs\reports\...`.
- TESTNET restart of Engine is allowed when needed.
- 8083/8084 model lifecycle actions require explicit notice as stated above.
- Do not reintroduce fixed/static expected egress-IP security gating.

---

## 2. Product/runtime baseline

Formal version: **J-MITS V3.9.7**

Environment:
- Binance USDⓈ-M Futures TESTNET / Demo
- REST target: `demo-fapi.binance.com`
- Windows local Engine + web dashboard
- Node currently observed locally: v22.23.1
- V8: 12.4.254.21-node.56

Entry authority architecture:
- Primary chooses from frozen executable candidates.
- Once a valid Primary `PLACE_LONG/PLACE_SHORT` selects a legal frozen candidate, deterministic strategy/economics/history/risk observations must not re-judge or veto it afterward.
- Post-PLACE blockers are physical/execution facts only: funds, exchange filters/precision, identity corruption, idempotency, persistence, TESTNET AUTO disabled, private data unavailable/stale, Binance rejection, submit UNKNOWN requiring exact clientOrderId recovery.
- Initial margin floor >= 100 USDT/USDC.
- Frozen Entry leverage authority is 10x–20x.
- BTCUSDT business floor 150 quote.
- No tiny fallback order merely to become exchange-legal.

Preserve:
- proxy and TESTNET environment fail-closed,
- exact clientOrderId recovery/idempotency,
- private-data freshness,
- production writes = 0.

---

## 3. Static egress rule already removed

User explicitly ordered:
- 禁止验证出口IP安全性
- 禁止绑定预期出口IP

Therefore:
- no expectedStaticEgressIp authority,
- no static egress proof write gate,
- no NET-003/NET-004 active incidents,
- no `BINANCE_EGRESS_*` / `TESTNET_WRITE_EGRESS_NOT_VERIFIED` blockers,
- do not bring back `checkip.amazonaws.com` authorization logic.

Still preserve proxy configuration, TESTNET host/environment isolation, transport failures, HTTP 418/429/451, Binance business rejects, and submit UNKNOWN handling.

---

## 4. Account and PnL semantics already agreed

### Total assets

Top account total = **USDT + USDC only** from the same signed snapshot.

Exclude BTC and BUSD unless the user later changes the requirement.

Important fields include:
- `usdtMarginEquityUsd`
- `usdcMarginEquityUsd`
- `combinedStablecoinMarginEquityUsd`
- `usdtWalletUsd`
- `usdcWalletUsd`
- `combinedStablecoinWalletUsd`
- `combinedStablecoinAvailableUsd`
- `excludedAssets`

Do not present Binance V2 top-level `totalMarginBalance` as account-wide combined equity when `multiAssetsMargin=false`.

### Deterministic local accounting

GPU AI is **not** accounting authority.

Primary deterministic local realized metric:
**本地已实现交易净收益（不含资金费）**

Eligibility requires local/system-owned, canonical, nonduplicate, CLOSED, quantity conservation/ledger proof, locally attributable fills, complete fees, finite `tradingNetPnlExFunding`.

Funding UNKNOWN:
- must never be coerced to zero,
- must not block exact ex-funding local realized PnL,
- all-in confirmed PnL is shown only for exact coverage.

The dashboard now distinguishes:
- true Funding UNKNOWN,
- all-in unconfirmed cycles,
- Funding EXACT but other authoritative evidence still incomplete.

---

## 5. New performance tracking work already merged before current crash investigation

The user wants two complementary performance views rather than treating old local-accounting coverage as the only “profit” number.

User baseline after account reset:
- initial USDT wallet = 5000
- initial USDC wallet = 5000

Example wallet values supplied by user:
- USDT 5806.75955113
- USDC 5002.1741335

Therefore baseline wallet gain at that moment:
`(5806.75955113 - 5000) + (5002.1741335 - 5000) = 808.93368463`

Architecture implemented on GitHub before the crash investigation:
1. **Baseline wallet gain** from configurable initial USDT/USDC balances.
2. **Rolling 7-day Binance trading performance** using exchange income facts.
3. **Rolling 7-day local TradeRecord performance**, shown separately from Binance.
4. Do not add local and Binance values together.
5. Binance rolling view separates:
   - REALIZED_PNL
   - COMMISSION
   - FUNDING_FEE
   - cash flow / transfers separately
6. Rolling window default = 7 days.
7. Settings already have/now expose performance baseline and rolling-day configuration.
8. TradeRecord exchange sync/backfill was extended toward rolling 7-day coverage.

Relevant commits include the performance-tracking series ending at:
- `d0144d1372c3f9c24d146e3c8cc2d2a1f35076db`

When reviewing this area later, preserve distinction:
- baseline wallet gain answers “account balance since reset/baseline”,
- recent 7-day exchange/local performance answers recent trading attribution/reconciliation,
- deposits/withdrawals/transfers must not silently masquerade as trading PnL.

---

## 6. Dashboard first-navigation lag already fixed on GitHub

User reported first click of never-opened routes such as:
`http://127.0.0.1:8080/brain`
felt unresponsive, causing repeated clicks.

Root cause found:
- every route component used lazy `()=>import(...)`,
- Vue Router did not visibly switch until first chunk download/parse completed,
- users saw the old page and interpreted the click as ignored.

Merged fixes:
- cached dashboard route chunk loader,
- idle background preload,
- hover/focus/pointerdown preloading,
- immediate route transition feedback/skeleton,
- route pending state,
- tests for immediate first-click feedback.

Commits:
- `1a002b6...` add route preloader
- `e049b76...` cached route chunks
- `a470c8a...` immediate navigation feedback + warm routes
- `55b4a41...` transition styles
- `125928b...` regression test

Actions #488 succeeded at `125928bf2f3e9234c657bcbc62cef40dacb3fc7b`.

---

## 7. Critical current incident: Engine native crash

The prior 24h TESTNET soak is **FAILED / interrupted** because Engine stopped automatically.

Do not continue the old soak timer.

Historical native failure evidence includes Windows process exit:
- decimal: `-1073740791`
- hex: `0xC0000409`

Known lifecycle examples:
- PID 37632: `0xC0000409`
- PID 2844: after `--no-maglev`, still `0xC0000409`
- PID 10988: after start, about ~100 seconds, `0xC0000409`
- PID 29748: after start, about ~95 seconds, `0xC0000409`

This proves:
- `--no-maglev` did **not** solve the root cause.
- Do not treat Maglev as the established cause.
- Ordinary JS exceptions are not visible in stderr at the native-crash boundary.

Observed stderr around the crash only contained:
`ExperimentalWarning: SQLite is an experimental feature and might change at any time`

That warning alone does **not** prove SQLite is the cause.

### Prior diagnostic dead ends — do not repeat mechanically

A manual `--jitless` run failed before meaningful Engine startup because Node 22's built-in undici/fetch needed WebAssembly:
- `ReferenceError: WebAssembly is not defined`
- ordinary code 1
- therefore that result did NOT test the real crash.

A later manual `--no-turbofan --no-maglev` attempt was started, but the user correctly objected that repeated flag experiments were becoming a diagnostic loop.

The new strategy is:
**run the normal Engine startup path in the foreground and capture the real last events before the crash.**

---

## 8. New foreground observation mode — current baseline

The project has now been changed so the normal Windows Engine startup path supports a foreground observation mode.

Current latest main:
`e8d90808786efd095b6bc871412aa4a9b4d547d0`

GitHub Actions:
**#495 SUCCESS**

Relevant commits:
- `1cd5960...` add foreground observe startup mode
- `def556e...` Windows PowerShell compatibility
- `ae513c5...` expose `-Foreground` from `scripts/windows/start-engine.ps1`
- `6a07982...` foreground startup contract tests
- `26d3192...` foreground event mirroring enable
- `9370b89...` mirror redacted operational events to foreground console
- `e8d9080...` mirror process lifecycle milestones to foreground console

Expected local invocation after pull/build:

```powershell
Set-Location D:\MITS
git fetch --all --prune
git merge --ff-only origin/main
npm run build

powershell -NoProfile -ExecutionPolicy Bypass -File "D:\MITS\scripts\windows\start-engine.ps1" -Foreground
```

Foreground mode:
- uses the formal Engine startup environment,
- leaves node.exe attached to the current PowerShell,
- uses the conservative normal runtime guard (`--no-maglev` if exposed),
- does **not** use `--jitless`,
- does not touch 8081/8083/8084,
- mirrors redacted operational events to console,
- mirrors process lifecycle milestones,
- timestamps console lines,
- writes a dedicated log such as:
  `D:\MITS\data\runtime-logs\engine.foreground.YYYYMMDD-HHmmss.log`
- writes crash-report output under:
  `D:\MITS\docs\reports\crash\foreground-YYYYMMDD-HHmmss`
- on exit prints decimal exit code, hex exit code, runtime duration, log/report locations, and last log lines.

The user reports the important crash log to analyze next is expected to be:
**`engine.foreground.20261006-090715.log`**

The next conversation should treat this foreground log as the primary evidence for the incident.

---

## 9. How to analyze the foreground crash log

Do not begin with another theory.

First reconstruct a strict timeline:

1. PROCESS_START
2. BOOTSTRAP_STARTED
3. runtime/database creation
4. HTTP_LISTENING
5. runtime.start phases
6. private sync
7. market/cohort refreshes
8. reconciliation
9. AI probe / AI runs
10. storage retention/checkpoint events
11. TradeRecord sync/performance sync if they start
12. last successfully emitted event
13. exact gap between last event and native exit
14. foreground footer/exit code if present

Then inspect source code for the exact subsystem(s) scheduled at the last timestamp.

Important scheduler facts in current source:
- private sync: every 15s
- AI resource probe: every 15s
- market tick / exchange loop: every 1s
- analysis dispatch: every 2.5s
- pending review/manual exits: every 2s
- ownership/exits/AI-exit: every 5s
- cohort/market slow refresh: every 60s
- position review: every 60s
- trading quality tick: every 1s
- quality observer: every 5s
- TP sweep: every 5s
- reconciliation: every 15s
- external research: every 2s
- AI-run summary backfill: every 1s
- storage retention: every 5s
- funding attribution: every 45s
- SQLite operational health worker: every 30s
- rolling exchange performance sync: every 15 min
- TradeRecord auto sync: every 5 min

SQLite facts:
- Engine heavily uses Node `node:sqlite` `DatabaseSync`.
- Main SettingsStore uses `zdj-settings.sqlite`.
- An operational health Worker opens the same DB read-only and periodically performs:
  - event count,
  - runtime_state read,
  - periodic `PRAGMA quick_check(1)`.
- Trading quality also has its own SQLite evidence stores.
- Do not disable or rewrite these merely because they are suspicious; use foreground evidence to decide.

If the log shows a repeatable subsystem immediately preceding native termination, prefer a small diagnostic isolation switch for that subsystem over more V8 flag experiments.

Never “fix” the incident by auto-restarting the Engine. Auto restart would hide a native crash and invalidate soak evidence.

---

## 10. Previous native-crash mitigation already present

The Engine host inspects Node/V8 options and currently adds `--no-maglev` when exposed.

Important new observation from the user's local `node --v8-options`:
- Node reports `--maglev` default as `--no-maglev` on this runtime.
- Therefore explicitly supplying `--no-maglev` may be redundant on this exact Node version.
- Do not claim the flag itself was a meaningful mitigation without evidence.

The crash still reproduced after the host recorded:
- Node v22.23.1
- V8 12.4.254.21-node.56
- nodeFlags [`--no-maglev`]

Therefore the current root cause is still **unknown**.

---

## 11. 8083 / 8084 model state rule

The user manually started:

8083:
- role: HARNESS_ADVISOR
- model: Qwen3.8-27B
- API: `http://127.0.0.1:8083/v1`
- normally Vulkan1 RX 7900 XTX

8084:
- role: ZDJ_PRIMARY_BRAIN
- model: Qwen3.8-27B
- API: `http://127.0.0.1:8084/v1`
- normally Vulkan2 RX 7900 XTX

The user explicitly complained that they were previously stopped without being told.

From now on:
**Do not stop/restart/reload 8083 or 8084 without explicitly notifying the user first.**

Engine scripts should not manage those model processes.

---

## 12. Soak requirements after the crash is truly fixed

Do not restart the 24h soak until:
- the native crash cause is fixed or a well-supported mitigation is in place,
- Engine survives foreground/normal observation without native exit,
- 8080/8081/8083/8084 are healthy,
- Production writes = 0,
- no static-egress gate returns,
- proxy/TESTNET boundary remains intact,
- positions/orders/TP reconcile,
- signed/private facts recover after network/VPN errors,
- accounting semantics remain correct.

Once a final code/build change is deployed, soak timer starts from the final READY runtime timestamp.

Soak hard failures include:
- Engine native crash/restart,
- duplicate submit,
- Production write,
- persistent missing TP,
- persistent remote/local position mismatch,
- submit UNKNOWN followed by duplicate order.

Network/VPN timeout alone is not a soak failure if system safely pauses and recovers.

---

## 13. Expected next user action in the new conversation

The user will upload:
**`engine.foreground.20261006-090715.log`**

When it arrives:
- acknowledge the upload,
- inspect the file contents directly,
- do not ask the user to reproduce already captured output,
- identify the last successful Engine events before termination,
- map them to source code,
- determine whether the failure is during startup, periodic scheduling, DB/worker work, network work, AI work, or another subsystem,
- patch GitHub only when evidence warrants it,
- keep CI green,
- then give the user a single simple restart/observe command.

If additional evidence is truly needed, prefer extending the foreground logger/start script so the next normal run captures it automatically rather than asking the user to manually run a growing list of diagnostics.

---

## 14. Repository files likely relevant next

- `scripts/windows/start-engine.ps1`
- `scripts/start-zdj-lan.ps1`
- `scripts/start-zdj-engine-host.ps1`
- `scripts/start-zdj-engine-host.test.ps1`
- `apps/engine/src/main.ts`
- `apps/engine/src/runtime/appRuntime.ts`
- `apps/engine/src/runtime/processLifecycleTelemetry.ts`
- `apps/engine/src/services/operationalLogger.ts`
- `apps/engine/src/config/settingsStore.ts`
- `apps/engine/src/workers/sqliteHealthWorker.ts`
- `apps/engine/src/services/tradingQualityCollector.ts`
- `apps/engine/src/services/tradingQualityV393EvidenceStore.ts`
- `apps/engine/src/services/tradeRecordSyncService.ts`
- `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts`

---

## 15. Short prompt the user can paste into a new ChatGPT chat

Use the following:

> 继续维护我的 GitHub 项目 `3684993/ZDJMITS`。请先通过 GitHub 读取 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`，把它作为当前完整上下文和约束，不要让我重复之前的历史。我会上传最新的 Engine 前台崩溃日志 `engine.foreground.20261006-090715.log`。请以日志证据为主，继续定位 Engine 自动停止/0xC0000409 的真实触发路径，并直接维护、修复、优化 GitHub 项目；每次修改后检查 CI。不要再陷入反复更换 V8 参数猜原因。8083/8084 两个模型未经提前明确告知禁止停止、重启或重新加载；Production writes 必须保持 0。


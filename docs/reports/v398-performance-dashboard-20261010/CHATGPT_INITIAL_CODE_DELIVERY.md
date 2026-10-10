# ChatGPT D0–D2 first implementation receipt — 2026-10-10 Beijing

> **GitHub main 更新（提交 b55f427eeda1，2026-10-10 09:36+08）：** `main` 已将原24h验收终止原始证据同步到 `docs/reports/v398-engine-cutover-20261010/acceptance/state.json`（现为 `ABORTED_SAFETY_FAILURE`）及 [ACCEPTANCE_ABORT_RECEIPT_20261010.md](https://github.com/3684993/ZDJMITS/blob/main/docs/reports/v398-engine-cutover-20261010/ACCEPTANCE_ABORT_RECEIPT_20261010.md)。本功能分支始于更早main 662d7f3，若本分支文件仍有旧08:24 `RUNNING`，是尚未同步main的历史遗留，不能据此推翻最新权威已中止状态。Codex必须先核对最新main的验收事实和PR #31合并基线，避免旧文档覆盖新证据。该更新是文档证据同步，不是重启或新24h开始。


## Status
`SOURCE_COMMITTED_TO_GITHUB_BRANCH / UNIT_TESTS_NOT_YET_EXECUTED / CI_NOT_YET_CONFIRMED / NOT_DEPLOYED`

Base main `662d7f3b34c11bb62ca7e028d1b98c32acbeb647`; isolated branch `chatgpt/v398-performance-real-metrics-d0-d2-20261010`. All files and this receipt live on GitHub, not on the operator's local `D:\MITS`; no Engine/model/proxy/TP/Settings or trading runtime changed. Frontend status values and times in this PR are sourced from pre-existing Engine diagnostics plus a new read-only Node sampler, not mock values.

Code paths:
- `apps/engine/src/services/hostPerformanceSampler.ts` and `.test.ts` — native OS CPU delta / physical memory + Engine RSS/heap, UNKNOWN cold start, bounded 10s snapshot cache
- `apps/engine/src/api/router.ts` — `GET /api/v3/observability/performance/host`
- `apps/dashboard/src/utils/performanceFacts.ts` + `.test.ts` — evidence-based red/yellow/green/grey lamps and bounded AI p95
- `apps/dashboard/src/components/PerformanceTrend.vue` — ECharts5 true nullable historical points, chart dispose
- `apps/dashboard/src/views/PerformanceView.vue` — independent /performance page, 15s visible-only requests, dual desktop/mobile nav
- `apps/dashboard/src/{router.ts,navigation.ts,routePreload.ts,layouts/AppShell.vue,api/client.ts}` — route, lazy view import, clientGET, menu

**Source-level findings:** fixed duty routes allow Entry only on8084 and Review only on8083. `aiFabric.ts` Review pump counts `reviewActive` while `run()` also maintains `load.active`; cross-duty routing without unified lease may oversubscribe. Therefore this PR **does not turn on GPU borrowing, adjust model concurrency, invent GPU load or launch extra reviews**. It is an instrumented first step. True physical GPU→PID→8083/8084 mapping and true GPU utilization are unverified and rendered UNKNOWN.

**Safety-state correction from original evidence:** PR#25 branch `docs/reports/v398-network-optimization-20261010/acceptance-aborted.json` and `acceptance-abort-checkpoint.json` explicitly show 2026-10-10 08:34:00.270+08 ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED, local TP14/15 with one missing; original main state.json at08:24 RUNNING is stale. Later local cachedTP17/17 does not prove current fresh signed TP. Original24h is not PASS and not resumed. This branch makes no runtime change.

Known partial-implementation limits:
1. Node native CPU/RAM metrics are REAL when query succeeds; cold CPU reading deliberately UNKNOWN. GPU percentages/VRAM physical mappings, model tokens/s and SSH wire bytes are placeholders explicitly labelled UNKNOWN, **not an actual GPU sampler yet**.
2. Host sampler ring has a short finite length and only samples as visited; 6h/24h/7d cannot claim complete historical time coverage.
3. 100-row `brain/runs` pagination is NOT complete full-window history, so any displayed queue p95 is an explicitly limited recent sample, not service SLO proof.
4. Proxy route throughProxy is config evidence only, not signed end-to-end TCP/SSH proof. PRIVATE snapshot is not an independently signed full TP proof. The dashboard cannot act on orders.
5. Model compatibility across two 27B servers is not confirmed; GPU lease future PR must require equivalence proof and safe resource concurrency.

**Verification ledger:** No local npm/Windows command performed by this ChatGPT GitHub-only session. Engine, dashboard, full verify, ECharts screenshot, low-overhead baseline and physical mapping MUST be run by Codex, commit sanitized evidence to this GitHub report folder, update Issue#30, then review exact-head GitHub Actions. Do not turn this receipt into a false PASS; preserve initial red failures and fixes. Link for instructions: `docs/prompts/CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010.md`.

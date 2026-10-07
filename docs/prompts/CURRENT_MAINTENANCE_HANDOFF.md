# J-MITS V3.9.7 — CURRENT MAINTENANCE HANDOFF

## 2026-10-07 audit remediation followup — current authority
## Followup deployment and new observation window

Verified implementation e034c20 deployed manually to 8080 at 18:37:58 +08:00. Run lifecycle total: two deliberate stop/MANUAL_START deployments; no automatic retry. PID 37952, instance 285c4ece-93d9-4be8-9393-839cbf47fb9b, restart counter 263. Build 3.9.7-8b758a2b18ba8b6abe90; source d9626b0f51ae679283d93b7b2bb9c6355322d3f65cbd7010b40d9aec57c9565e; artifact 8b758a2b18ba8b6abe90eec9fef05d374d47192f7fbf98a4f226a2c5fcf393b2. Branch identity closes 6/6. Loading ECONNREFUSED and STARTING/503 evidence is preserved, followed by followup-readiness-ready.json READY/200. Private truth READY and TP protection 9/9; no TP mismatch/orphan/duplicate/unknown in readiness samples. Model PIDs/creation times match baseline. Settings version247 and every Settings/resource payload hash exactly match the pre-run fingerprint.

New independent localhost observer PID 35268 started 2026-10-07T18:41:12.1564572+08:00; nominal 6h checkpoint 2026-10-08T00:41:12.1564572+08:00, 12h endpoint 2026-10-08T06:41:12.1564572+08:00. Use actual first/last samples for duration. The first failed window is excluded. Do not claim NET-002 eradication or stability before data review; natural TP terminal cases remain UNKNOWN absent events. All collected windows must be archived losslessly and pushed to GitHub. F04/F10/F11 remain deferred.


This supersedes prior one-deployment and old observation deadline statements. The first deployment's 24 samples over 0.382815h failed stability: four private UNAVAILABLE samples, recurrent NET-002 and local queue congestion. The owned observer was stopped for a followup deployment; its lossless initial-window-final evidence is archived under docs/reports/v397-audit-remediation-20261007/.

The isolated followup checkout is D:\MITS-WORKTREES\v397-audit-remediation-final-20261007. Full local verify passes 1969 tests/231 files plus release/scripts/S00/typecheck/build. It adds background/hydration lane isolation, current account/quote admission priorities, FIFO, and exact TP identity/quantity/durable convergence checks. F01/F02/F03/F05/F06/F07/F08 code/regression work is implemented; 6–12h runtime acceptance is PENDING. Do not combine builds or treat tests as live acceptance.

Only 8080 may be manually deployed in this continuous run. 8081/8083/8084, Settings, proxy, strategy parameters and databases must remain untouched. Preserve dirty D:\MITS. No automatic restart, manufactured order/sample or exchange write by observation tools. New observer identity and deadlines will be recorded after readiness/identity closure. All checkpoint reports and lossless evidence must go directly to GitHub by ordinary fast-forward, preserving unrelated changes. F04/F10/F11 are deferred pending the fact-layer stability decision. Natural terminal TP recovery remains UNKNOWN without a natural sample.

> **Current Codex execution mode:** use `docs/prompts/CODEX_FULL_COMPLETION_RUN.md` for one continuous completion run through final 8080 restart and acceptance preparation; do not stop for staged approval.

> Stable handoff entrypoint for a new ChatGPT maintenance conversation.
> Last refreshed: 2026-10-07 (+08:00)
> Repository: `3684993/ZDJMITS`
> Upstream `origin/main` baseline before this completion run: `5784154367838266e630ceb0b2bcca9c30f82853`
> Final verified implementation candidate: `f634ca4c4b1f363f604c937c42d79ca2075d68bf`
> Last user-confirmed green verification: **V3.9.x Verify #655 GREEN**
> Last upstream implementation baseline after that green run: `ae5e0c9e6ef6e03872d16aca9f0f9ea2dbd40194` (`fix: throttle exact-order recovery and prefer user data`).

## 0. Instructions to the next ChatGPT conversation

You are continuing maintenance of the user's real local J-MITS V3.9.7 Binance USDⓈ-M Futures TESTNET system.

At the beginning:

1. Read this file from GitHub first.
2. Inspect current `main`, recent commits, and the latest GitHub Actions run.
3. Do not ask the user to repeat history already documented here.
4. Directly maintain GitHub when evidence supports a change.
5. **Do not wait/poll GitHub Actions to completion.** The user explicitly asked to avoid message timeout. After pushing a fix, report the commit/run number and let the user notify you of the CI result.
6. Keep responses concise and implementation-oriented.
7. Local project root is `D:\MITS`.
8. Local user prefers scripts/files committed to GitHub, then only sync/execute commands.
9. If local evidence is needed, generate one file/ZIP rather than many manual commands.
10. Never auto-restart Engine to hide a crash.

### Critical service rule

Never stop/restart/reload 8083 or 8084 without explicitly informing the user first and obtaining awareness/approval.

Logical services:
- 8080: J-MITS Engine + Dashboard
- 8081: Scout
- 8083: HARNESS_ADVISOR / REVIEW_BRAIN
- 8084: ZDJ_PRIMARY_BRAIN / PRIMARY_BRAIN

Ordinary maintenance may touch **8080 only**.

Production writes must remain **0**.

---

## 1. User working preferences

- Chinese.
- Extremely concise; avoid long explanations unless requested.
- Prefer direct implementation over repeated diagnosis loops.
- Do not repeatedly ask questions already answered by repository state/logs.
- Do not tell the user to wait.
- Do not sit polling Actions; user reports green/red.
- When changing local scripts, commit complete files to GitHub.
- When local output is needed, produce one report/ZIP for upload.
- Do not reintroduce static egress-IP security checks.

---

## 2. Hard project constraints

Preserve:
- TESTNET-only execution.
- Production writes = 0.
- proxy-only Binance route / fail-closed environment boundary.
- private fact truth.
- exact clientOrderId identity/idempotency.
- exchange filters/precision.
- durable persistence.
- unresolved submit UNKNOWN must never duplicate-submit.

Do **not** restore:
- `expectedStaticEgressIp`
- static egress authorization gates
- checkip-style authorization
- NET-003/NET-004 static IP authority

Primary Entry authority:
- Primary chooses from frozen executable candidates.
- After valid Primary PLACE, deterministic observations do not re-judge the trade.
- Post-PLACE blockers should be physical/execution facts only.

---

## 3. Current baseline / resolved #651 regression

The old #651 failure is resolved.

- Fix commit: `f95c116d6679addaeed6b087c155c84e3b6ba662`
- User-confirmed result: **V3.9.x Verify #655 GREEN**
- Root cause was only a stale SettingsStore migration test fixture: it created `brain-review-test` even though the configured enabled Review resource was already `brain-7900-review`.
- Production Review routing was not changed to satisfy the old literal.

Upstream UNKNOWN recovery baseline:
`ae5e0c9e6ef6e03872d16aca9f0f9ea2dbd40194`

That commit makes UNKNOWN/SUBMITTING Entry recovery prefer Binance User Data WS and throttles exact `/fapi/v1/order` recovery for the same clientOrderId. It also applies the same discipline to the durable `mustQueryFirst` branch and post-ACK-loss recovery. Unresolved UNKNOWN remains non-resubmittable.

Local continuation commit `7fdadad6a95fa6bfa658a1a1edb06e91dba8f38a` completes the first exact-order call-site audit batch:
- adapter-level single-flight now also shares an explicit Binance `-2013` / `-2011` absence for 15 seconds across Entry, reconciliation and action-boundary readers;
- transport timeouts, queue pressure and other uncertain failures are never cached;
- the UNKNOWN recovery contract now proves that the cooldown blocks an immediate duplicate REST probe, then recovers the same identity after the cooldown without a second wire submit;
- two malformed Dashboard test stubs were corrected so invalid-template warnings no longer hide real Vue warnings.

Local evidence for that candidate:
- workspace typecheck: PASS;
- workspace formal build: PASS;
- Engine: 198 files / 1,760 tests PASS;
- targeted Dashboard warning regression: 2 files / 27 tests PASS;
- no Engine or auxiliary service restart; no runtime or exchange write was performed.

### 2026-10-07 continuous completion result

The remaining A-H maintenance scope was audited against current code and completed on top of the exact-order batch:
- candidate-local executable market health now prevents optional REST market fallback latency from creating `NET-002` while at least one candidate remains healthy, even when unrelated retained symbols keep the aggregate freshness view in `RECOVERING`;
- `/fapi/v1/income` latency is treated as historical enrichment telemetry rather than current private-truth failure; runtime evidence proved account/private truth remained `READY` while this endpoint alone created the prior alert;
- active proxy deletion is rejected by the API, so deletion cannot silently perform a live route switch; the operator must save/test and explicitly activate another proxy first;
- the Dashboard-to-API explicit manual LIMIT path is regression-tested with preview market data unavailable and retains the user-entered price;
- the Windows Engine host probes Node through `System.Diagnostics.Process`, so harmless inherited Node stderr warnings no longer abort the safe launcher under `ErrorActionPreference=Stop`;
- exact-order/UNKNOWN, required market-data gating, Settings resource boundaries, bounded Review/Research, reconciliation budgets and storage/crash protections were re-audited and retained.

Final local gate on implementation commit `f634ca4c4b1f363f604c937c42d79ca2075d68bf`:
- `npm run verify`: PASS;
- release identity: `V397_RELEASE_IDENTITY_PASS`;
- S00 T01-T06: PASS, network not used, exchange writes 0, lifecycle not used;
- workspace typecheck and production build: PASS;
- Contracts 1 file / 2 tests, Core 8 / 58, Dashboard 24 / 123, Engine 198 / 1,762: PASS;
- GitHub Actions was not used as a decision or acceptance dependency.

Runtime acceptance on integrated code/main baseline `171024bbcf9379636ab479a0db7e291fd29038f0`:
- only 8080 was restarted with `MANUAL_START`; PID `50704`, instance `c14f2328-1ccf-49dd-bac6-5263cbecba3f`, `/health` 200 `READY`;
- runtime source/artifact hashes matched independent disk recomputation; build id `3.9.7-00e1112122c1665b5b51`;
- TESTNET + `TESTNET_ENABLED`, `lockedToTestnet=true`, Production writes 0, TESTNET writes during acceptance 0;
- market WS `LIVE`, private account `READY`, pipeline `RUNNING`, scheduler `RUNNING`, TP 10/10 protected and active operational incidents 0;
- Exchange/Proxy/AI resources loaded at Settings version 247; active proxy remained `binance-proxy` with no destructive migration;
- SQLite integrity remained true with existing history retained. Historical UNKNOWN risk claims remain visible/fail-closed and keep reconciliation `DEGRADED`; they were not erased or manufactured away;
- 8081/8083/8084 retained PIDs `12732` / `17468` / `51124` and were not restarted.

For Codex/local continuation, use:
`docs/prompts/CODEX_MAINTENANCE_CONTINUATION.md`

Codex should use the local checkout and local tests as the primary implementation loop rather than waiting on GitHub Actions.

---

## 4. Recent known-good milestones

User explicitly reported:

- #623 GREEN
  - commit `4f3d823a389157aee0235906e78c758932fa7a01`
  - `test: align private clock cache expectation to five minutes`

- #633 GREEN
  - commit `76438cae81ff92de440ecbcec1d81f74cd54642e`
  - `ui: keep explicit manual limit form usable without preview quote`

The latter matters because manual limit operations had been failing with:
`MARKET_DATA_UNAVAILABLE: cached quote stale or missing`

The intended UX is:
- an explicit manual limit order should remain usable when the user supplies a legal explicit limit price,
- stale preview quote must not be incorrectly treated as a hard prerequisite for an explicit user limit price,
- exchange legality/risk facts still remain fail-closed.

---

## 5. Binance network architecture — current direction

A dedicated Singapore SSH dynamic SOCKS proxy has been deployed by the user.

Local proxy:
`socks5://127.0.0.1:20091`

A direct test through the tunnel succeeded against:
`https://demo-fapi.binance.com/fapi/v1/time`

Therefore:
- do not keep treating ordinary latency as proof the VPN is broken,
- design for normal Internet/Testnet latency,
- WS should carry continuous market/order state,
- REST should be necessary reads/recovery, not continuous duplicate truth polling.

### NET-002 design direction

User observed many warnings:
- `BINANCE_TRANSPORT_BLOCKED: Binance request timed out`
- `BINANCE_REQUEST_QUEUE_TIMEOUT`
- `/fapi/v1/openInterest`
- `/fapi/v1/premiumIndex`
- `/fapi/v1/ticker/bookTicker`
- `/fapi/v1/order`
- `/fapi/v1/time`

Already implemented direction:
- isolated one/two REST timeouts should be telemetry, not a global incident,
- require sustained critical timeout evidence before NET-002,
- if WS market facts are FRESH, REST market fallback timeouts should not globally block NEW_ENTRY,
- derivatives/context endpoints such as openInterest/premiumIndex are advisory and should not be Entry-hard blockers,
- private account LKG may tolerate a small number of transient failures while still within freshness TTL,
- exact-order recovery should be deduplicated/throttled and not double-counted as multiple network incidents.

Do not weaken:
- submit UNKNOWN identity recovery,
- private fact staleness limits,
- exchange reject handling.

### Official-interface principle

Keep Binance architecture aligned with official semantics:
- User Data WebSocket preferred for order status/state changes.
- Market WebSocket preferred for live quote/book/kline state.
- REST exact-order lookup is fallback/recovery.
- REST context endpoints should not be treated as continuous mandatory execution facts.

---

## 6. WebSocket split routing work already done

2026 Binance futures WebSocket routing was migrated from the legacy single endpoint model to split routes.

Current intended architecture:
- PUBLIC socket: bookTicker + depth
- MARKET socket: ticker + markPrice + kline + aggTrade
- User Data socket remains private-order/account stream

There were earlier URL corrections while matching Binance's split WS behavior. Do not re-open that work unless runtime evidence shows a current WS handshake/control failure.

At one point old routing produced:
`Unexpected server response: 404`

That was corrected.

---

## 7. Manual operations / provenance

A dashboard manual limit close previously appeared as “未知来源”.

Root cause identified:
- manual intent/order path existed,
- but close-cycle provenance did not always inherit durable MANUAL order identity.

Implemented direction:
- Dashboard manual intent -> clientOrderId/exchangeOrderId -> fill -> physical cycle -> `SYSTEM_MANUAL`
- historical manually-created exits may recover provenance only by exact durable identity, never maker/taker guessing.

Preserve this.

---

## 8. USDC routing

User has significant USDC capital and asked why USDC contracts are underused.

Current agreed architecture:
- USDT and USDC are both valid funded quote assets.
- Entry funding must use real exchange availableBalance.
- candidate discovery must expose USDT/USDC alternates for leading underlyings.
- contract routing may use available quote capital when market quality is otherwise acceptable.
- do not blindly prefer USDC; market quality/exchange legality still matter.

---

## 9. Native crash / 0xC0000409

Native fail-fast remains a separate incident from network latency.

Observed Windows exit:
- decimal: `-1073740791`
- hex: `0xC0000409`

Important findings from 2026-10-07 crash analysis:
- `POSITION_RECONCILIATION` was frequently taking 5–9 minutes despite a 15s scheduling cadence.
- one observed reconciliation run lasted ~521s.
- the next reconciliation remained open until native fail-fast.
- other named tasks around the crash were closing normally.
- network timeout was an amplifier, not proof of native root cause.

Mitigation already implemented:
- reconciliation remote-audit per-run budget,
- exact Entry remote queries bounded,
- heavy no-active-risk proof bounded,
- deferred items remain risk-bearing and are retried later,
- no unsafe release just because a run budget expired,
- phase tracing around position-market refresh and reconciliation.

Foreground launcher also captures Windows Application Error/WER information on future `0xC0000409`.

Do not return to V8 flag guessing.

---

## 10. Disk/storage incident already addressed

One Engine stop was caused by disk exhaustion while PowerShell foreground logging called `AppendAllText`.

That was distinct from native crash.

Storage work already implemented:
- foreground log bounded/rotated,
- foreground file-write failure does not kill Engine,
- low disk guard before launch,
- TradeRecord baseline sidecars cleaned,
- runtime logs capped,
- scheduler BEGIN/END disk amplification reduced,
- Trading Quality/V393 WAL and retention bounded,
- storage audit script added.

The user later reported other disks recovered; large usage concentrated under:
`D:\MITS\data`

Do not manually delete live SQLite `-wal/-shm` files while Engine is running.

---

## 11. Proxy resource/UI redesign — current active work

User explicitly requested standard human-friendly CRUD UX for all Settings tabs.

Proxy requirements:
- multiple saved proxy resources,
- adding a new proxy must not silently overwrite/delete the old proxy,
- resource fields: name/type/url/enabled,
- save draft,
- cancel edits,
- test selected proxy,
- explicitly set one proxy ACTIVE,
- deleting inactive resources allowed,
- deleting active/last required resource protected,
- active proxy change hot-applies,
- test should test the selected proxy itself.

General Settings interaction rule:
- ordinary settings: clear Save / Cancel.
- managed resources: list -> select -> edit -> Save -> Test -> Activate (where applicable) -> Delete.
- do not show ambiguous global Save simultaneously with resource-level Save.
- Exchange, Proxy, AI resources, Governance should follow consistent edit boundaries.

Recent work before #651 included:
- multi-proxy resource registry,
- explicit proxy activation endpoint/UI,
- resource-manager layout,
- proxy test against selected resource,
- transient latency hysteresis,
- private REST transient tolerance,
- manual limit form improvement.

There were Vue template warnings:
`Template compilation error: Invalid end tag.`

Although tests still passed at that point, the next conversation should inspect current `SettingsView.vue` for malformed markup if not already fixed on current main.

---

## 12. Three-model resource utilization

User reports:
- PRIMARY_BRAIN is usually busy/analyzing.
- REVIEW_BRAIN is often idle.
- 9B RESEARCH often waits for shared event.
- user wants the second GPU / Review model to provide more useful work without duplicating Primary authority.

Current roles:
- Primary: trading decision authority.
- Review: must not become a second Entry veto authority.
- Research: external/shared-event research, currently sparse workload.

Optimization direction:
- Review GPU can handle asynchronous/non-authoritative work:
  - pending Entry review,
  - position/exit review,
  - trade-quality postmortem,
  - candidate evidence compression,
  - anomaly/execution-quality review,
  - queued non-authoritative analysis.
- Research can be fed bounded research/pre-analysis tasks when there are meaningful shared events/candidate needs.
- Do not make Review a hidden second Entry Primary.
- Do not let extra AI work delay live trading.
- preserve explicit duty routing in settings.

This remains unfinished and should be planned after #651 and current network/UI regressions are green.

---

## 13. Common current warnings and how to classify them

### `MARKET-DATA-001 / MARKET_QUOTES_STALE`
Real only if current WS/cached market truth is actually stale/missing.
Do not trigger merely because optional REST context timed out while WS facts are fresh.

### `EX-SUBMIT-UNKNOWN / ENTRY_SUBMIT_UNKNOWN`
Real execution-safety condition.
Must not duplicate-submit.
Prefer User Data WS identity/status confirmation; exact REST lookup is fallback.

### `NET-002`
Should represent sustained critical REST degradation, not one slow request.
Deduplicate one physical timeout so it does not appear as both transport and queue incidents.

### Binance `-5022`
Real exchange business reject:
Post-Only/GTX would immediately execute, so Binance rejected it.
This is not a network error.
Correct handling is fresh maker price/reprice on the next legal attempt; do not display as WORKING.

### `PRIVATE_ACCOUNT_UNAVAILABLE`
Real only when private truth is stale/unavailable beyond allowed LKG freshness tolerance.
Do not flip READY -> UNAVAILABLE on one transient timeout if a fresh signed private snapshot still exists.

### manual `MARKET_DATA_UNAVAILABLE`
Explicit manual LIMIT with a user-specified legal price should not require a live preview quote solely to render/submit the explicit limit.
Do not bypass exchange/risk legality.

---

## 14. Current test/CI workflow rule

The user explicitly requested:

**After pushing a GitHub change, do not keep waiting/polling Actions.**

Correct behavior:
1. inspect code/logs,
2. fix,
3. push,
4. state commit + Actions number,
5. stop,
6. user reports green/red later.

This avoids chat/tool timeout.

---

## 15. Immediate next task order

1. Finish Binance latency compatibility / NET-002 sustained-failure semantics without weakening private truth. The first UNKNOWN/exact-order call-site audit batch is locally complete at `7fdadad...` but is not yet on `origin/main`.
2. Verify MARKET-DATA-001 is derived from real required WS/cache freshness and continuity, not optional REST context timeouts.
3. Audit SettingsView markup and finish standard CRUD/save/cancel/test/activate/delete boundaries.
4. Verify true multi-resource proxy persistence and explicit active-resource switching.
5. Re-verify explicit manual LIMIT usability when preview quote is stale while preserving exchange/risk fail-closed facts.
6. Improve Review/Research useful asynchronous utilization without creating a second Entry veto authority.
7. Preserve reconciliation budgets, storage/I/O convergence and native crash protections.

Codex may propose a different implementation when it is demonstrably better, but it must pair disagreement with a concrete safer/simpler replacement and tests; critique-only responses are not acceptable.

---

## 16. Important files

Likely relevant:
- `apps/engine/src/config/settingsStore.ts`
- `apps/engine/src/config/settingsStore.test.ts`
- `apps/engine/src/services/operationalIncidents.ts`
- `apps/engine/src/services/operationalIncidents.test.ts`
- `apps/engine/src/services/privateAccountSync.ts`
- `apps/engine/src/services/entryCoordinator.ts`
- `apps/engine/src/services/reconciliationService.ts`
- `apps/engine/src/adapters/binance/BinanceTransport.ts`
- `apps/engine/src/adapters/binance/requestBudget.ts`
- `apps/engine/src/api/runtimeSettingsResources.ts`
- `apps/dashboard/src/views/SettingsView.vue`
- `apps/dashboard/src/settings-closeout.css`
- `packages/contracts/src/settings.ts`
- `config/settings.default.json`

---

## 17. Short prompt for a new ChatGPT web conversation

> 继续维护我的 GitHub 项目 `3684993/ZDJMITS`。先读取 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` 和 `docs/prompts/CODEX_MAINTENANCE_CONTINUATION.md`，以当前代码和本地测试为事实基线，不要让我重复历史。当前上游 `origin/main` 是 `5784154367838266e630ceb0b2bcca9c30f82853`；本地候选 `7fdadad6a95fa6bfa658a1a1edb06e91dba8f38a` 已完成首批 UNKNOWN/exact-order 去重并通过本地验证。继续网络延迟/NET-002、MARKET-DATA-001、Settings 标准 CRUD、人工限价与三模型异步利用率优化。不要依赖或等待 GitHub Actions。8083/8084 未经提前明确告知禁止停止/重启；Production writes 必须保持 0；不要恢复静态出口 IP gate。

## Permanent artifact retention rule

**All Codex/ChatGPT project-maintenance artifacts must be stored in GitHub, not left only in local paths.**

This includes audit reports, question/answer reports, evidence bundles, diagnostic reports, generated scripts, reproduction outputs, manifests, handoff notes, and any other file that future maintainers may need.

Requirements:
- Commit durable artifacts into this repository under an appropriate `docs/reports/`, `docs/evidence/`, `docs/prompts/`, or `scripts/` path before declaring the work complete.
- Do not report a local-only path such as `C:\\Users\\...\\outputs\\...` as the sole location of a deliverable.
- When an artifact is generated locally, upload/commit it to GitHub during the same maintenance run.
- Update this handoff with the GitHub paths and relevant commit SHA so the next maintainer can retrieve them without asking the user to re-upload or repeat history.
- If a binary artifact cannot be uploaded directly through the available connector, store a lossless GitHub-hosted representation (for example split base64 plus SHA256 and reconstruction instructions) rather than leaving it only on disk.

Current independent audit artifacts are archived under `docs/reports/system-audit-20261007/`.

Archived files:
- `docs/reports/system-audit-20261007/SYSTEM_AUDIT_20261007.md`
- `docs/reports/system-audit-20261007/AUDIT_QUESTIONS_255_20261007.md`
- `docs/reports/system-audit-20261007/AUDIT_EVIDENCE_20261007.zip`
- ZIP SHA256: `956781234f105f383a0379537263e7dabd882ddd12924bb42c9f11e0fb3335ca`

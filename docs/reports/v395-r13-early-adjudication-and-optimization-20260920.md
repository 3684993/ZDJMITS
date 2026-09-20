# ZDJ-MITS V3.9.5｜R13 提前裁决 → historical UNKNOWN 复核风暴治理（实施+部署+验收）

标记：**`R13_EARLY_ADJUDICATION_AT_4H`**（授权发生在约 4.1 h；实际连续观察 **6.07 h / 33 轮**后执行裁决）
诚实口径：**本轮不是 10 小时稳定性 PASS。** 10 h 窗口（`00:31:52 → 10:31:52`）未跑满，用户在约 4.1 h 明确授权终止等待、提前进入 Phase C/D。裁决与实施期间 Engine 未暂停交易。

- 提前裁决报告：`docs/reports/v395-r13-early-adjudication-20260920.md`
- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-R13-4小时提前裁决-UNKNOWN复核风暴治理-Codex提示词-2026-09-20.md`（分支 `docs/v395-r13-early-adjudication-20260920`）
- 代码提交：`3835332`（fix(v395): tier the historical UNKNOWN remote risk audit …），分支 `v395-economics-human-managed-20260919`

---

## A. 提前裁决时间与实际观察时长

| 项 | 值 |
| --- | --- |
| R13_BASELINE | `2026-09-20 00:31:52`（HEAD `0b29562`、buildId `3.9.5-9a67d9f72261f548890b`、PID 2320、restartCount 162、settingsVersion 185） |
| 原计划窗口 | 10 h（至 `10:31:52`） |
| 用户授权提前裁决 | 约 4.1 h 处（2026-09-20 04:4x） |
| 实际裁决时刻 | `06:35:51` ⇒ **已连续观察 6.07 h**、33 轮 12-min 轻量采样、6 次小时级 durable 收割 |
| 期间 Engine 生命周期 | **0 次重启**（PID 2320 / restartCount 162 全程不变） |
| 期间交易 | **未暂停**（`RUNTIME_CONTROL_CHANGED` 事件 0） |
| 采集器 | 本机只读脚本；期间修复了自身两处缺陷（`sqlite3.Row.items()` 崩溃、`orphanTp` 过度敏感告警），见裁决报告 |

## B. 为什么终止 10 h 等待

10 h 的意义在于拿到三类"短窗口可能永远不发生"的真实事件；6.1 h 内三类全部到手（C/D/F），继续等待只会按同一模式线性放大浪费（该风暴自身每小时制造 ~880 条重复事件与 ~2,700 次远端请求，并把真实事件挤出 ~2 h 滚动保留窗）。因此提前裁决在信息量/代价上成立；**代价是长尾风险（夜间更慢的漂移类故障）未被覆盖，本报告不宣称长窗稳定性。**

## C. K 线 self-healing 真实 live 证据（补齐 R12 未演练项）

01:27:00.309 → 01:32:02.424（5 分 02 秒）：`reconnects 1`、**`gapsByType.kline 126`**（旧 build 恒 0）、114 个标的、401 条 `1m closed candle gap`、**单标的最多 6 条即止**、`MARKET_KLINE_SEQUENCE_REPAIRED 112`（全 `ok:true/missing:0`）、`_REPAIR_FAILED 1`（`ASTERUSDT` `BINANCE_REQUEST_QUEUE_TIMEOUT` ⇒ 冷却后 01:30:11 同 key 自动成功）、`MARKET_KLINE_SEQUENCE_INVALID 0`、`MARKET_RECOVERY_FAILED 0`、事后 `klineFreshRatio 1.0`、`pipelineState` 33/33 轮 RUNNING、无人工干预、无 backfill。证据：`r13/gap-0127-evidence.json`。

## D. egress fail-closed 证据

03:39–04:14 `UNAVAILABLE`：`TP_REPAIR_FAILED ... submissionOutcome=NOT_ATTEMPTED message=TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE`、`ENTRY_ORDER_BLOCKED ... stage=SET_LEVERAGE`、候选 `TECHNICAL_COOLDOWN`；04:14:52 自动 `VERIFIED`；期间 `required == protected` 未破。⇒ 无 fail-open。

## E. TP / HUMAN 安全（6.1 h）

33/33 轮 TP 全覆盖；`missing/orphanTp/duplicateTp/qtyMismatch/wrongSide/repairFailed` 全程 0；8 次自然 TP 成交按交易所事实归因；`POSITION_HUMAN_HANDOFF 9` 全部 `tpRetained=true`；自动亏损平仓 0；historical UNKNOWN 20 → 25 单调不删；durable claims `active=0`、无饥饿。

## F. UNKNOWN storm 定量（治理前）

| 指标 | 实测 |
| --- | --- |
| `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` | 5,372 条 / 6.11 h = **879 条/h** |
| 涉及订单 | **26 个** ⇒ 平均每单被复核 **206.6 次**（最高 234） |
| 同一结论占比 | `EXACT_QUERY_NOT_FOUND_VERIFIED_NO_ACTIVE_RISK` **5,352 / 5,372 = 99.63%** |
| 事件污染 | 占窗口内全部 `runtime_events` 的 **25.9%**（5,372 / 20,731） |
| REST（自启动 7.40 h 累计，`requestBudget.attribution`） | `ORDER_VERIFICATION /fapi/v1/order` **20,454**、`ORDER_VERIFICATION /fapi/v1/userTrades` **9,035**（权重 45,175）、`RECONCILIATION /fapi/v1/allOrders` **9,009**（权重 45,045）⇒ 合计 **38,498 请求 / 110,674 权重**，即 **~5,202 请求/h**，占同期全引擎 admitted（63,448）的 **60.7%** |
| 增长性 | 20 → 25 → 26（每笔自然平仓 +1），**无界累积** |

## G. UNKNOWN 分类模型（实现采用的判据）

- **A. FRESH / ACTIVE-UNCERTAIN**：`status==='UNKNOWN'` 但证据缺失/过期、或 tombstone 不匹配、或来源不全 ⇒ **永不延迟**（tier 0 = 现有 5 min，且 `remoteRiskAuditDeferred` 要求 `tier>0`）。
- **B. HISTORICAL VERIFIED-NO-RISK**（`historicalNoRiskEligible()`）：`status UNKNOWN` + `entryClaimReleasedByExchangeFacts`（无 `exchangeOrderId`、`filledQuantity===0`、证据有效、tombstone 一致）+ 四个"不存在"来源齐全（`EXACT_ORDER_NOT_FOUND`、`OPEN_ORDERS_IDENTITY_ABSENT`、`USER_TRADES_IDENTITY_ABSENT`、`ALL_ORDERS_IDENTITY_ABSENT`）+ 仓位侧证明为零或属于其他 durable cycle。只有 B 可进入 15 min / 30 min 档。
- **C. REACTIVATED / CONFLICT**：远端订单重现、迟到成交、可归因仓位、identity/tombstone 变化、证据获取失败 ⇒ `resetRemoteRiskAudit()` 立即回 tier 0（`nextAuditAt=now`，事件即刻发出）。

## H. 当前 vs candidate cadence replay（改代码前先测）

用 6.05 h 真实 per-order 审计时间戳重放（`r13/replay-tiered-unknown.json`）：

| 指标 | 当前策略 | 候选分档（5m→15m→30m，连续 3 次相同才升档） |
| --- | --- | --- |
| 深度审计次数 | 5,420 | **404（−92.5%）** |
| 审计速率 | 896/h | **67/h** |
| 远端请求（×3 fan-out） | ~2,687/h | **~200/h（−92.5%）** |
| 估算权重（×11） | ~9,851/h | **~734/h** |
| 事件条数 | 5,420 | 404 上限，实测进一步压到"状态变化 + 每小时心跳"（见 O） |
| 最坏主动风险发现延迟 | 3.14 min（实测最大间隔） | **≤30 min**（tier 上限；replay 实测 31.78 min 含 1 s 推进余量） |
| 活跃订单重现发现延迟 | ≤60 s | **≤60 s（未改：`fullOrderScanDue` 与 openOrders 身份比对节奏保持原样）** |
| 对 FRESH/在途 UNKNOWN 的影响 | — | **0**（tier 0 恒等于原 5 min TTL；`consecutive<3` 或 `tier===0` 一律不延迟） |
| identity 匹配的迟到事实 | 0 / 6.05 h | 无需依赖延迟，重现即回档 |

被否掉的更"省事"方案：直接把 `UNKNOWN_RISK_EVIDENCE_TTL_MS` 全局改成 60 min —— 会让新鲜/在途 UNKNOWN 也失去 5 min 内的风险复核，违反硬边界。同样被拒的还有"每标的批量合并 userTrades/allOrders"（26 单跨 19 标的仅再省 ~27%，却引入跨订单共享时间窗的语义风险），故未实施。

## I. 选定实施项

1. **historical UNKNOWN 远端审计分层 + 相同事实不再重发事件**（主项）。
2. **`sequenceInvalid` 暴露到 `/api/v3/pipeline` 的 `freshMarkets` 投影**（R12 V-1 附属项）。
3. **不做**：Primary DEGRADED 与 risk headroom 仅记证据不改行为（见 S/T）。

## J. 代码改动

- `apps/engine/src/services/entryRiskOccupancy.ts`（+63 行，纯函数）：`UNKNOWN_RISK_EVIDENCE_TIER_MS=[5m,15m,30m]`、`UNKNOWN_RISK_AUDIT_PROMOTE_AFTER=3`、`RemoteRiskAudit` 类型与 `remoteRiskAudit/historicalNoRiskEligible/remoteRiskAuditDeferred/riskFactHash/advanceRemoteRiskAudit/resetRemoteRiskAudit/shouldEmitNoRiskEvent`。**`hasVerifiedNoActiveRisk`、`entryOrderOccupiesRisk`、`entryClaimReleasedByExchangeFacts`、`durableEntryClaimActive` 四个风险谓词一字未改。**
- `apps/engine/src/services/reconciliationService.ts`（+29/−8）：
  - 延迟判据接入：`hasVerifiedNoActiveRisk(local,now) && (!fullOrderScan || remoteRiskAuditDeferred(local,now))` ⇒ 修复"升级节奏使原跳过分支永不生效"的泄漏；
  - 审计成功后 `advanceRemoteRiskAudit()` 计算 tier，`validUntil` 与 `nextAuditAt` 同档推进；**identity/tombstone 变化 ⇒ 以 `null` 前态重开链条**；
  - 远端订单重现（`remoteActive`）或状态改变 ⇒ `resetRemoteRiskAudit(now)`；
  - 相同 verdict+factHash+tier 不再发 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`，改发 `UNKNOWN_RISK_AUDIT_SUMMARY`（≤每 5 min 一条，含 `deferred/suppressedEvents/auditsByTier/tierIntervalMs/nextAuditAt`）；
  - `health()` 增加 `unknownRiskAuditTierIntervalsMs / unknownRiskAuditsByTier / unknownRiskLastAuditAt / unknownRiskNextAuditAt`。
- `apps/engine/src/runtime/appRuntime.ts`（+1 行）：`freshMarkets.sequenceInvalid`。
- 未改：任何 Settings 参数、风险限额、TTL 常量语义、durable claim fail-closed、事件订阅方（`p0EntryIntegrity` 的 release 证据仍来自同一条事件，字段不变并新增 `auditTier/nextRemoteAuditAt`）。

## K. Tests

新增 `apps/engine/src/services/unknownRiskAuditTiering.test.ts`：**18 个 deterministic test 全绿**，逐条对应提示词第七节 15 项：

| 提示词要求 | 覆盖 test |
| --- | --- |
| 1 新鲜 UNKNOWN 仍高频 | `audits a fresh UNKNOWN on every pass at the existing cadence` + `keeps tier 0 equal to the pre-tiering five minute evidence TTL` |
| 2 历史 VERIFIED_NO_RISK 可 backoff | `promotes a repeatedly identical historical no-risk proof …`、`does not spend a remote audit … before its next audit is due` |
| 3 证据不完整不得 backoff | `never promotes a proof whose remote sources are incomplete` |
| 4 tombstone 不符立即回 Fresh | `reloads to fail-closed high frequency when the tombstone no longer matches` |
| 5 远端订单出现立即回 Fresh + fail-closed | `reactivates fail-closed when the identity reappears in open orders while deferred` |
| 6 userTrade 出现立即回 Fresh | `reactivates fail-closed when a late user trade matches the deferred identity` |
| 7 position 出现立即回 Fresh | `reactivates fail-closed when a position becomes attributable to the deferred entry cycle` |
| 8 hash 未变不重复灌事件 | `emits one audit event per state change instead of one per identical pass` |
| 9 verdict 变化必须立即 emit | `publishes immediately when the verdict changes to conflict` |
| 10 重启后不得 fail-open | `cannot fail open after a restart when a persisted audit window outlives the proof` |
| 11 durable claim release 不回归 | `keeps releasing the durable claim for a deferred historical UNKNOWN` |
| 12 historical UNKNOWN 一条不删 | `never drops a historical UNKNOWN row while deferring its audit` |
| 13 新订单身份不被旧 UNKNOWN 混淆 | `audits a current submission at full frequency beside a deferred historical UNKNOWN` |
| 14 budget defer 不成 retry storm | `bounds retries when the audit request itself is blocked by the budget` |
| 15 主动风险发现延迟有明确上界 | `caps the worst-case active-risk detection latency at the highest tier interval` |
| （附加）纯函数状态机 | `exposes the audit state machine as pure predicates for the reconciliation caller` |

回归：既有 `reconciliationUnknownRisk(10)`、`reconciliationService(15)`、`p0EntryIntegrity(4)`、`finalRiskConvergence(5)`、`reconciliationRequestBudget(1)`、`activeEntryProjection(1)` **36/36 全绿且一字未改**（含"下一个 bounded risk scan 仍能在迟到事实出现时回 fail-closed"那条）。

## L. 本地 exact HEAD CI 替代门禁（Phase E/F）

全新 worktree `D:\MITS-worktrees\v395-localci-3835332`，checkout `3835332bc3bdf18587754ed723e7f506fc56610f`，初始 clean（0 行）、无继承 `node_modules`、锁文件未改；按 workflow 步序（Node v22.23.1 / npm 10.9.8）：

| 步骤 | exit | 用时 |
| --- | --- | --- |
| `git diff --check 08487ca..HEAD` | 0 | 0 s |
| `npm ci` | 0 | 8 s |
| build `@zdj/contracts` | 0 | 3 s |
| build `@zdj/core` | 0 | 3 s |
| `npm run verify:scripts` | 0 | 8 s |
| `npm run typecheck` | 0 | 16 s |
| `npm test` | 0 | 25 s |
| `npm run build` | 0 | 25 s |
| `npm run verify` | 0 | 66 s |

测试合计 **134 files / 720 tests**（engine 118 files、core 8/17、dashboard 8/46；engine 计数由 117→118 文件、639→657 用例，即本笔新增 1 文件 / 18 用例），`skipped 0`、无 retry/only、无断言削弱；结束后 worktree 仍 clean（`final_untracked_or_dirty_lines=0`）。日志：`D:\MITS-WORKTREES\v395-localci-3835332-20260920.log` / `.exit`。

按授权不使用远端 Actions（budget=0）：未 rerun、未 dispatch、workflow 文件未改。

## M. 是否部署

**是**，一次受控 restart（Phase F）：`stop-zdj-lan.ps1`（身份三重校验后才 Stop-Process）→ 备份 `D:\MITS-WORKTREES\backup-live-dist-r14-20260920-0659`（832 文件）→ 安装四棵已验证 dist（835 文件，多出的 3 个是本笔新增测试的编译产物）→ 重算 hash → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`。

- **未做 entry-only 暂停**（R12 的教训：`PAUSED_MANUAL` 会全局阻断 cohort hydrate）。改为在停服前确认 `pendingEntries.count=0`、`capacity.inFlight=0`。
- 身份闭环：worktree dist `artifactHash b48e7b022bcf41dcfb847987f371c70ea240cacb1f2185c98fde29782b59791b` == 安装到 `D:\MITS` 后重算值 == live 自报 `buildId 3.9.5-b48e7b022bcf41dcfb84`。
- 未动：8081、8084、`127.0.0.1:20081` 代理、`data/` 运行时 DB、Settings 业务参数。

## N. 部署后请求量变化

稳态窗口取 **07:40:00 → 08:11:00（31 min，全部 26 单已升档之后）**，与部署前同一口径对比（`r14/window-0740.json`）：

| UNKNOWN 审计路径 | 部署前 | 部署后稳态 | 变化 |
| --- | --- | --- | --- |
| 深度审计次数/h（= 事件数） | 879 | **134.6** | **−84.7%** |
| 每单被复核次数（窗口内） | 206.6 / 6.1 h | **4 / 31 min** | 断崖下降 |
| `ORDER_VERIFICATION /fapi/v1/userTrades` | ~1,221 次/h（4,395/h 按 replay 折算） | **606.5 次/h**（权重 4,045） | **−84.7%** |
| `RECONCILIATION /fapi/v1/allOrders` | ~1,217 次/h | **606.5 次/h**（权重 4,030） | **−84.7%** |
| 审计路径合计请求/h（×3 fan-out） | ~2,687（replay 实测） | **~404** | **−85%** |
| 审计路径权重/h（×11） | ~9,851 | **~1,481** | **−85%** |
| 全引擎 admitted/h | 8,574 | ~7,900–8,000 | 仅 −7%（见下） |

两点必须讲清：

1. **fan-out 端点的降幅与审计次数降幅完全一致（−84.7%）**：31 min 内 69 次审计 × 约 5 页 = 346 次，与实测 `userTrades=346 / allOrders=346` 精确吻合 ⇒ 这两个端点确实就是被治理的那条路径，没有偷换口径。
2. **总请求量只降 ~7%，因为还剩一条更大的同类风暴未被本轮覆盖**：`/fapi/v1/order` 在稳态窗口是 **3,435.5 次/h**（权重 3,373），其中只有 ~135 次/h 来自 UNKNOWN 审计，其余来自 `reconciliationService.ts:61` 的**历史终态订单复核批**（`entryOrders` 383 行中约 353 行为终态，每轮取 8 单、每单 5 min 节流）。本轮刻意不动它（见 V-2/V-3）。

`http429/418` 未增、lane `blocked/timeout=0`，说明削减的是纯浪费流量而非在跟预算搏斗。

## O. event spam 变化

| 指标 | 部署前（6.1 h 窗口） | 部署后稳态（31 min） |
| --- | --- | --- |
| `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` | 879 条/h，占全部事件 **25.9%** | **134.6 条/h，占 10.0%** |
| `runtime_events` 总量 | 3,393 条/h | **1,342 条/h（−60.5%）** |
| 替代性汇总事件 `UNKNOWN_RISK_AUDIT_SUMMARY` | 不存在 | 6 条 / 31 min（≤每 5 min 一条，含 `deferred/suppressedEvents/auditsByTier/tierIntervalMs/nextAuditAt`） |
| verdict 分布 | 99.63% 同一结论 | 稳态窗口 50 条同一结论 + 19 条 `EXACT_QUERY_NOT_FOUND`（AMBIGUOUS 仓位归属，见下） |

取证能力实际改善：同样 ~2 h 的滚动保留窗，现在能装下约 **2.5 倍**时长的事件（3,393 → 1,342 条/h），本轮 01:27 缺口证据"必须抢在裁剪前抢救"的情况应不再出现。

残留噪声第一名换人为 `CANDIDATE_LIFECYCLE_REDERIVED`（稳态窗口 488 条 = 940/h，占 70.9%）—— 这是另一条与本轮无关的派生事件流水，已记入下一轮候选。

**新观测到的副作用（必须披露）**：因为 26 个 UNKNOWN 是在启动后同一轮被集中首次证明的，它们的有效期彼此同步，于是每到过期点会出现一次"多单同时缺有效证明"的短时窗：08:10:45 采到 `activeRiskUnresolvedCount=16 / reconciliation.status=DEGRADED`，65 秒后（08:11:56）自行回到 `2 / 24 verified / tiers [0,3,23]`。方向上是**更严格（fail-closed 虚占风险）而非 fail-open**，且 `reconciliation.status` 只是投影诊断字段（`appRuntime.ts:1477`，由 `unresolvedDriftCount` 推导），不参与 Entry 门禁。根治办法是给 `nextAuditAt` 加一个按 `orderId` 的确定性抖动（2 行改动 + 1 条测试），本轮**不为它再做一次重启**，与 V-2 的 deferral 上移合并到下一轮。

## P. historical UNKNOWN 是否零删除

**零删除。** 部署前 26 个（治理窗口内 20→25→26）；部署后 `reconciliation.historicalUnknownCount` 恒为 **26**，`unknownRiskAuditsByTier` 三档求和亦为 26（07:33 `[18,5,3]` → 07:36 `[0,23,3]` → 08:11 `[0,3,23]`）⇒ 全部记录仍在册、仍为 `status='UNKNOWN'`、tombstone 未被改写。`verifiedNoActiveRiskUnknownCount` 在 24–26 之间抖动（同步过期短窗，见 O 末段），但**没有任何一条被删除或改写成终态**。`entryOrders` 总行数只增不减（379 → 383，随新 Entry 增长）。测试第 12 项 `never drops a historical UNKNOWN row while deferring its audit` 把这条钉成回归门槛。

## Q. durable claims / reconciliation

- `entry_execution_tasks` 按 `active` 分组：`{0: 307}` ⇒ **没有任何 active claim 悬挂**（部署前 `{0:292}`，新增 15 条全部正常落终态）；`durableClaims={durableTasks:307, activeClaims:0, activeUnknownClaims:0, releasedClaims:25, releasedUnknownClaims:25}` ⇒ 未出现 DURABLE_TASK_EXISTS 类饥饿
- 08:15:44 稳态读数：`reconciliation={status:READY, driftCount:0, unresolvedDriftCount:0, historicalUnknownCount:26, activeRiskUnresolvedCount:0, verifiedNoActiveRiskUnknownCount:26, verifiedOrderFactMismatchCount:0}`，tiers `[0,1,25]`
- 部署后 28 min 内出现 1 次 `unresolvedDriftCount=4 / DEGRADED`（07:30，新 Entry 在途 + 同一批 WS 缺口重叠），另有一次同步过期短窗（08:10:45 → 08:11:56，见 O 末段）；两者都在下一轮采样自行归零 ⇒ 属既有 fail-closed 占用，**方向是更严格而不是放松**
- `p0EntryIntegrity.passed=true`、`crossSymbolOrderMismatchCount=0`、`activeRemoteEntryWithNewPrimaryCount=0`、`unverifiedRemoteTerminalReleasedOccupancyCount=0`；`verifiedNoActiveRiskReleaseCount=168`（该计数含义已因去重改变，见 V-5）
- TP：`required=protected=35`（部署期间由 33 → 35，均为窗口内自然新开仓），`missing/orphanTp/duplicateTp/qtyMismatch/wrongSide/repairFailed` 全 0；部署前后 33 个旧仓逐字段无损

## R. 429 / 418

`http429=17`、`http418=3` ⇒ **与部署前完全相同，零新增**；`status=AVAILABLE`、`blockedUntil=0`、`egress=VERIFIED`。治理窗口 28 min 内 `decisions.blocked=2 / queueTimeout=2`，与部署前同量级（部署前 7.4 h 为 13/13），仍全部落在低优先级 `BACKGROUND_AUDIT /fapi/v1/income` lane；`MARKET_PUBLIC / EXECUTION / PRIVATE_TRUTH / CONTROL` 四 lane `blocked=0 / timeout=0 / deferred=0`。**未调整任何请求预算参数。**

## S. Primary DEGRADED 最终判定

判定为**诊断语义**问题而非模型服务故障：窗口内 8081/8084 `/health` 33/33 全 200 `{"status":"ok"}`；`aiHealth.failed=0 / timeout=0 / schemaInvalid=0 / quarantine=0 / consecutiveFailures=0 / topError=null`；`AI_RUN_TERMINAL=65`、`AI_RUN_FAILED=0`、`PRIMARY_DECISION_NORMALIZED=65`、`primary.lastLatencyMs≈50.8 s`；而 `primary.status` 在 `READY/DEGRADED` 间摆动并与 `eligibility`、`dispatchReady` 塌缩同步。⇒ "长时间没有可执行候选"被标成 DEGRADED。**未为此制造 AI 调用**；本轮不改其行为，留作下一轮诊断标签工作项。

## T. risk headroom 最终判定

`EXPECTED_RISK_CAPACITY_BLOCK`（合法用尽，非 bug）。06:40 实测：`equity 10,881.54`、方向上限 5,440.77、`directionBudget = {long 1,792.59, short 26.45, gross 1,819.04}`、持仓 33（LONG 20 / SHORT 12）；`supplyHealth = {governanceBlocked 83, occupiedUnderlyings 32, freeResidentUnderlyings 0, poolReady 0, dispatchReady 0}`、`eligibility {status:BLOCKED,count:0,excluded:32}`、`noEntryReason WAITING_EXECUTION_CAPACITY`。SHORT 侧预算耗尽 + 同一 underlying 单仓 + tier 方向偏好 ⇒ 无可执行组合。**未提高任何风险限额、未自动处置 HUMAN_MANAGED、未绕过 fail-closed。**

## U. 是否建议下一轮重跑 ENFORCE Canary

**建议：市场数据前置条件已满足，可以进入下一轮的只读 Stage 1 复评；但本轮不切 ENFORCE，且必须先解决两个非行情前提。**

已满足（本提示词第七节全部 9 条）：市场数据稳定（`klineFreshRatio` 恒 1.0、`freshMarkets` 33/33 轮 FRESH）；K 线自愈 live 两次真实验证（01:27 与部署后 07:20）；429/418 无异常新增；durable claim 正常；pipeline 33/33 轮 RUNNING；eligibility 有持续供应（33 轮采样中仅最后 2 轮为 0，且与 SHORT 预算耗尽同时发生而非行情缺失）；旧仓 TP / HUMAN 语义无损；至少一个方向有真实 headroom（LONG 1,792.59）；candidate 有充足 economics/reachability 样本（截至 04:45 收割已累计 58 次 SHADOW 评估）。

仍需在下一轮先做（不在本轮动）：

1. **HUMAN cap 仍是 100% 阻断**：58/58 次评估都带 `HUMAN_MANAGED_EXPOSURE_LIMIT` ⇒ 不重开"受控 cap 例外 + allowlist 隔离"就看不到正向 pass 腿（这是 R7/R8 的既有配方，不是 bug）；
2. **SHORT 侧方向预算只剩 26.45 USDT** ⇒ 若要观察 SHORT 正向链路必须等自然释放，不得放宽限额；
3. R9 冻结的预选注册表已过期，必须重新只读注册后再进 ENFORCE。

## V. 对当前架构与本提示词的反驳/补充

1. **本项优化的真实危害是"可诊断性"，不是请求预算。** 治理前该风暴权重 ~15,000/h，而窗口上限是 6,000/min ⇒ 360,000/h（约占 4%）；它真正造成的破坏是：占满 `runtime_events` 的 25.9%，使 ~2 h 滚动保留窗把真实故障证据（01:27 那次缺口）提前挤掉。**我拒绝把本轮写成"挽救了 Binance 配额"**：正确表述是"削减 60.7% 的无价值请求量并恢复取证能力"。
2. **延迟判定被放在 exact-order 查询之后，因此 UNKNOWN 路径自身的 `/fapi/v1/order` 并未省下。** 实测 28 min：UNKNOWN 审计相关精确查询 110 次，而同端点总量 1,245 次 ⇒ 把 deferral 上移到 `reconciliationService.ts:62` 之前只能再省该端点约 9%，**不足以再冒一次受控重启的代价**，故本轮刻意不做，留作一行改动 + 一条测试的后续项（"延迟订单零远端调用"）。
3. **顺带量到更大的同类风暴，且它不是 UNKNOWN。** `/fapi/v1/order` 的主力是**历史终态订单复核批**：`reconciliationService.ts:61` 对 `factSource!=='BINANCE_EXACT_ORDER' || verifiedAt<updatedAt || fillFactsIncomplete` 的终态订单每轮取 8 单、每单 5 min 节流；本实例 `entryOrders` 共 383 行，其中终态 ≈353 行 ⇒ 稳态实测 **3,435.5 次/h**（权重 3,373/h；部署前该端点为 2,764 次/h，差异来自窗口长短与新开仓节奏）。与本轮同一病灶（历史记录被永久高频重探），建议列为下一轮第一优先，但**必须同样先 replay 再动手**。
4. **第二个 live 自愈样本（部署后）**：07:20–07:29 `reconnects=2`、`gapsByType.kline=91`、91 条 `1m closed candle gap`，`MARKET_KLINE_SEQUENCE_REPAIRED=49`（36 个标的）、`_REPAIR_FAILED=0`，`klineFreshRatio` 保持 1.0，`pipelineState` 全程 RUNNING ⇒ 冷启动/重连场景下的自愈在**新构建**上再次成立，且修复零失败。
5. **`verifiedNoActiveRiskReleaseCount` 的语义被本次去重改变**（从"重复计数"变成"真实释放次数"），没有任何门禁消费它（已 grep 确认 `passed` 不依赖），但人肉基线会掉约两个数量级，后续看诊断时不要误判为回归。
6. **`reconciliationService.health()` 的 `unknownRiskLastAuditAt` 在首次审计前返回 0**，导致"距今多少秒"的算法算出荒谬值；应改为 `null`。属可观测性小缺陷（P3），未单独为它重启。
7. **对本提示词的反驳**：它要求 10 h 连续窗口，而实际按用户授权在 6.07 h 提前裁决；同时它在 §五 建议的 60 min tier 上限被我压到 30 min —— 理由是"迟到成交"只能靠 per-order 深度审计或 user-data 流发现，而 tier 越长该窗口越大；30 min 已足以把该路径请求量降到 replay 的 67 次/h（−92.5%），额外一档 60 min 的边际收益小、风险敞口翻倍。分层判据也不应只用于"降频"，必须同时决定"证据有效期"，否则过期证据会让历史 UNKNOWN 虚占风险额度、反向压低 eligibility（这一点提示词未展开）。

---

## 附：下一轮工作清单（按本轮证据排序，含具体落点）

1. **历史终态订单复核批治理**（`reconciliationService.ts:61`，实测 ~3,436 次/h、权重 3,373/h）：与本轮同一病灶、同一套分类/分档方法，先 replay 再动手。
2. **deferral 上移到 exact-order 查询之前**（`reconciliationService.ts:62` vs `:73`）+ **"延迟订单零远端调用"测试**（省 UNKNOWN 路径自身残余 ~135 次/h）。
3. **`nextAuditAt` 加按 orderId 的确定性抖动**，消除同步过期短窗造成的 `DEGRADED` 抖动与虚占风险尖峰（O 末段）。
4. **`health().unknownRiskLastAuditAt` 无审计时应返回 `null`**（V-6）。
5. **`CANDIDATE_LIFECYCLE_REDERIVED` 降噪**（现为事件量第一，940/h、占 70.9%）。
6. **Primary DEGRADED 诊断语义**：区分"连接/探针/模型可用/队列健康"与"无可执行候选 idle"（S 节）。
7. 之后再评估**正向 ENFORCE Canary**（U 节三个前提）。

## 附：回滚基线

- 旧 dist（R12 构建 `3.9.5-9a67d9f72261f548890b`）完整备份：`D:\MITS-WORKTREES\backup-live-dist-r14-20260920-0659`（832 文件）
- R12 之前版本的备份链仍在：`D:\MITS-WORKTREES\backup-live-dist-r12-20260919-2319`
- 回滚方式即四棵 dist 树整体换回 + 一次 `MANUAL_START` 启动；DB / Settings / 仓位 / TP 不受影响
- 本轮验收未出现任何需要回滚的风险识别延迟或 fail-open 迹象

## 附：停止点

按提示词第十四节：本轮**未切 ENFORCE**，保持 `SHADOW` + `humanManagedAdmissionCapsEnabled=true` + `minNetProfitUsd=1` + `minHistoricalReachProbability=0.50` + 原风险限额 + Testnet only；交易全程未暂停，Engine 仅因部署重启 1 次（restartCount 162 → 163）。

# V3.9.6 部署轮：`e284a1a` Anti-Waste 闸上线 + Pending Risk 只读根因（2026-09-23）

权威计划：`docs/plans/v396/CODEX-V396-DEPLOY-E284A1A-ANTI-WASTE-20260923.md`。
结果：**DEPLOYED AND ACCEPTED — 无新 P0/P1；Anti-Waste 闸在线上按设计工作；写仍为 0/0；§5 矛盾根因已定清（需要下一轮产品修补，但方向是过度计数风险，不是漏计）。**

## 1. 身份与生命周期

| 项 | 值 |
| --- | --- |
| 执行时 HEAD | `374218e`（= 授权文档提交） |
| 产品源码基线 | `e284a1a`，`git diff --name-only e284a1a..HEAD` 仅 1 个 `docs/plans/**` 文件 → 产品源码与已验收基线逐字节一致 |
| 构建退出码 | `build-01-verify-deps=0`、`build-02-engine=0`、`build-03-dashboard=0` |
| 期望构建身份 | `expectedBuildId=3.9.6-dc8fb58b578c25d10726`，`artifactHash=dc8fb58b578c…6bad`，`sourceHash=84cecf6b2497…1897` |
| 新进程自写身份 | `buildId=3.9.6-dc8fb58b578c25d10726`、同 `artifactHash`、同 `sourceHash` → **期望值与进程自己写的值双向闭合** |
| 旧实例 | PID `33432`，`3.9.6-50d14dbd22d1ea5ed7d2`（`e890ed5` 构建） |
| 新实例 | PID **`50996`**，HOST_PID `42040`，launchId `e635a90192b2405788f5ce5a18d05a9c`，instanceId `dc5c58b8-3c9a-4414-8f02-b00d3b1005fb`，`startReason=MANUAL_START`，startedAt `2026-09-23 21:30:09`，restartCount 172 |
| stop / start 次数 | 各 **1 次**：`stop-zdj-lan.ps1` → `ZDJ-MITS stopped; port 8080 is free`（exit 0，`netstat` 0 监听、`tasklist` 无 PID 33432）→ `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`（exit 0）。无热重载、无 watchdog、无二次重启、无重试循环 |
| 就绪 | 6 次轮询内 `STARTING → DEGRADED → READY`；`/health` READY、`database.integrity=true / HEALTHY`、`marketStream=LIVE`、日志 `fatal/uncaught/unhandled` 匹配 **0** |

构建产物含新闸的直接证明：`apps/engine/dist/services/executionReadiness.js` 存在；`runtime/appRuntime.js` 含 `executionReadinessSnapshot`×3；`services/entryCoordinator.js` 含 `noteExecutionReadiness` / `modelSpendPermitted` / `EXECUTION_READINESS_BLOCKED`；`services/portfolioRiskLedger.js` 含 `PROFILE_NOT_CONFIGURED`；`apps/dashboard/dist/assets/OverviewView-8EwoX9dR.js` 含 `data-execution-readiness` 与 `PROFILE_NOT_CONFIGURED`。

本轮期间的既成事实（如实记录）：按计划顺序 构建→停止→启动，新 dashboard 资源自 21:25 起即被仍运行的旧进程按请求从磁盘提供，旧引擎尚未投影 `executionReadiness`，因此该几分钟内新 UI 的就绪行显示 `NOT_EVALUATED`（缺投影时的既定行为，未伪造 READY）。

## 2. executionReadiness 线上真实值（§3.2）

`/api/v3/pipeline.executionReadiness`（`execution-readiness-readback.json`）：

```json
{"intent":true,"ready":false,"modelSpendPermitted":false,
 "blockers":["EXECUTION_WRITE_LOCKED","RISK_PROFILE_UNCONFIGURED","NO_EXECUTABLE_CANDIDATE"],
 "firstBlocker":"EXECUTION_WRITE_LOCKED","profileStatus":"PROFILE_NOT_CONFIGURED",
 "privateFresh":true,"writeLocked":true,"executableCandidateCount":0,
 "mode":"EXECUTION_BLOCKED",
 "text":"执行事实未齐：EXECUTION_WRITE_LOCKED · RISK_PROFILE_UNCONFIGURED · NO_EXECUTABLE_CANDIDATE；已停止调用模型，避免产生无法执行的决策"}
```

计划预期逐项核对：`intent=true`、`ready=false`、`modelSpendPermitted=false`、blockers 含 `EXECUTION_WRITE_LOCKED`、`firstBlocker` 为写锁、`profileStatus=PROFILE_NOT_CONFIGURED`（`portfolioRiskProfile.status` 同值，无笼统 READY）——**全部为 true**。blocker 顺序与代码既定谓词顺序一致（脚本 `blockerOrderMatchesCodePredicate` 断言）。
`lastReadyAt` 在 `analysisDiagnostics().execution` 中投影（本实例为 `null` → 驾驶舱显示"本实例暂无"）；`/api/v3/pipeline.executionReadiness` 本身不带该字段，因为每次读都是新鲜求值，不存在需要解释的陈旧就绪时刻。

blockers 集合随事实变化且无需重启：21:34（t0，资本候选 0）为三项，21:44（浏览器读，资本候选 3）只剩两项，21:51（`execution-readiness-readback.json`，候选回到 0）第三项又出现——同一进程，无重启、无 Settings 写。

## 3. 模型消耗归零（§3.3，只按新实例时间窗计数）

`no-model-spend-window.json`（正式窗口 21:44:56–21:48:57，5 个采样；`no-model-spend-window-first-round.json` 为 21:36:45–21:41:46 的首轮，同一"模型调用 0"结论，但其市场新鲜度探针取错了路径导致 `supplyMaintenanceStillRunning` 无法判定，故换用 `/health.marketStream.lastMessageAt` 重跑）与 `post-deploy-runtime-snapshot-t-late.json`（21:53:32）一致给出：

- `ai_runs_archive WHERE started_at >= 21:30:09` → **0 行**（PRIMARY_BRAIN 与 SCOUT 都为 0）。全库最近一条 PRIMARY 是 21:28:25 起、21:29:24 完成，属旧实例。
- 自实例启动以来的相关事件：`AI_RUN_TERMINAL=0`、`ANALYSIS_ONLY_COMPLETED=0`、`PRIMARY_DECISION_NORMALIZED=0`、`TRADE_PLAN_PERSISTED=0`、`ENTRY_ORDER_SUBMIT=0`、`ENTRY_DECISION_BLOCKED=0`。
- `EXECUTION_READINESS_BLOCKED=1`（状态变更才写一次，不刷屏；尚无 `EXECUTION_READINESS_RESUMED`，因为从未就绪过）。
- `ANALYSIS_DISPATCH_HEARTBEAT=18`（窗口末 21:48:57）→ `28`（t-late 21:53:32）仍在走——这是 `processPool` 前半段的确定性心跳，不是模型支出。
- 30 分钟混合窗口仍会显示 PRIMARY≈4 / SCOUT≈4，那些全部落在 21:29:30 之前；旧实例历史不得当新实例结论（计划 §3.3 明确要求排除）。
- 旧行为 `PLACE_* → ANALYSIS_ONLY_COMPLETED → EXCHANGE_WRITE_LOCKED` 在新实例上 0 次出现。部署前该模式实测每 30 分钟 18–23 次（`pre-deploy-runtime-snapshot.json`）。

## 4. 供给未被冻结（§3.4）

`supply-maintenance-readback.json`：同窗口 `CANDIDATE_LIFECYCLE_REDERIVED=115`、`CANDIDATE_SUPPLY_HEALTH=19`、`MARKET_COHORT_REFILLED=5`、`RECONCILIATION_FAILED=4`、市场 `lastMessageAt` 由 `1790171097599` 推进到 `1790171337731`（订阅 88→仍在收报价），槽位 `14/50`、`inFlight=0`、`reserved=0` 持续来自同一次资本计算。**verdict：`supplyMaintenanceStillRunning=true`。**

本轮仍是 READ_ONLY，因此即使 `privateFresh=true`、候选存在，也**不应**调用模型——写锁 blocker 仍在，这正是预期。

## 5. 私有事实抖动（§4，只读观察）

`private-data-flap-readback.json`（自实例启动 20.4 分钟窗口）：`PRIVATE_SYNC_FAILED=27`、`PRIVATE_SYNC_RECOVERED=15`，`errorCode` 全为 `TIMEOUT`，单次 `durationMs` 区间 **1,233–23,524 ms**，`consecutiveFailures` 最大 **5**（旧实例同窗为恒 1），采样时刻 `binancePrivate.status=READY`、`snapshotAgeMs≈2.5s`、`consecutiveFailures=0`。

判定：仍是代理路由上的私有 REST 超时抖动，能自行恢复，未构成"连续不可恢复失败"，因此不按 §4 的 P1 停止线处理；未放宽 60 秒新鲜度、未调 timeout、未使用缓存事实放行写。新实例上 `consecutiveFailures` 达到 5（≈75 秒以上陈旧）是**比旧实例观测更差**的事实，已如实登记；重启是否改善未知，且不得为把它做绿而改网络/代理配置。

## 6. 写边界与存量事实（§3.5）

`environment=TESTNET`、`executionMode=READ_ONLY`、`lockedToTestnet=true`、**`testnetWrites=0`、`productionWrites=0`**、`blockedProductionWriteAttempts=0`、`lastWriteAt=null`、`lastWritePath=null`（累计结构，本实例亦为 0，因为整轮无任何写路径进入）。
`settingsVersion=191` 未变；本轮 **零 Settings 写**：`executionMode`、`riskGovernance.portfolioRisk`、两个敞口上限、`maxPositions`、60 秒新鲜度、REST timeout、reachability、UNKNOWN 规则、`aiExitAuthority` 全部未触碰；未创建/撤销/替换任何交易所订单，未产生新 reservation/entry intent/entry order/submit。
持仓 14（cycleId 与部署前一致）、TP **14/14 PROTECTED**、`unverifiedTp=0`、`missing/repairFailed/orphanTp/duplicateTp/qtyMismatch/wrongSide=0`；所有权账本 27 行 / 27 cycle / 0 `AI_ACTIVE` / outbox 待发 0；`reconciliation.activeRiskUnresolvedCount=0`；无 fatal。

## 7. §5 Pending Risk 逐条根因（只读，本轮未改该逻辑）

计数与关联见 `pending-risk-crosscheck.json`，结论见 `pending-risk-root-cause.json`：

1. **当前数量**：上一次真实准入评估（21:29:25，属旧实例）含 **46** 条 `PENDING_RISK_UNVERIFIED`；新实例上准入评估发生 **0** 次（模型没被调用，风险准入自然没跑）。按持久层重放账本自身谓词，同样恰好是 **46** 条。
2. **逐条 durable 事实**：515 条 `entryOrders` 中 46 条 `status=UNKNOWN`；这 46 条全部 `exchangeOrderId=null`、`filledQuantity=0`、**`expiresAt=null`**（46/46），各自带 `intentId`/`reservationId`（逐条字段见 `rowsCountedNow`）。
3. **远端证据**：45 条带当前有效（`validUntil>now`、tombstone 匹配）的 `VERIFIED_NO_ACTIVE_RISK` 证据，1 条证据已过期等待下一次 `nextRemoteAuditAt` 复核；0 条完全无证据。`activeRiskExposure=false` 且证据有效者 44 条。
4. **仍把它们计入 pending 的模块**：`apps/engine/src/services/portfolioRiskLedger.ts` → `PortfolioRiskAdmission.inputs()` 的 `builtPending`，谓词是自带的一份
   `['NEW','PARTIALLY_FILLED','UNKNOWN','SUBMITTING'].includes(status) && (!row.expiresAt || Number(row.expiresAt) > now)`。
   由于 `expiresAt` 恒为 `null`，`!row.expiresAt` 永真 → **永久计入**。
5. **是否 stale projection**：是，且机制明确。权威占用谓词 `apps/engine/src/services/entryRiskOccupancy.ts:23 entryOrderOccupiesRisk()` 对 `UNKNOWN` 取 `!hasVerifiedNoActiveRisk(order, now)`（同文件 :10），所以槽位/容量/同标的排斥/候选生命周期这套账只算 **2** 条；风险账本另起一套只按 status 的账，算 **46** 条。一条 `BTCUSDT` 甚至同时具备 `activeRiskExposure=true` 与有效释放证据（该标志未被推进），保守方向。
6. **是否存在真实 active 风险**：0 条。无 `exchangeOrderId`、无 `filledQuantity`、无 `activeRiskExposure≠false 且无释放证据` 的行。UNKNOWN 没有被任何一面转成 0——释放判定逐条来自该自己的 `activeRiskEvidence` 且要求 `validUntil` 未过期、tombstone 匹配。**没有真实风险被错误释放，故不构成部署轮 P0。**
7. **精确根因与最小修补（本轮不做）**：`builtPending` 的 entry-order 分支改为复用 `entryOrderOccupiesRisk(row, now)`，删除第二套 status/expiry 判定；不改写 UNKNOWN 行本身、不缩短证据 TTL、不加第三个 pending 账。必须配套的敌意测试：有效释放证据的 UNKNOWN 既不产 blocker 也不计名义；证据过期仍计；`activeRiskExposure=true` 仍计；有 `exchangeOrderId` 或 `filledQuantity>0` 无条件仍计；gross/direction/cluster 合计只减掉被释放行。

**次生后果（这才是它重要的原因）**：`buildPortfolioRiskSnapshot()` 把每条 pending 行 push 进 `exposures` 并汇总 `grossNotionalUsd/long/short/capitalAtRiskUsd`，于是 44 条已释放行贡献 **$30,629.41** 幻影名义敞口（合法占用仅 $606.92），约为当前净值 $10.6k 的 3 倍。

## 8. §8 十问直答

1. HEAD `374218e` / 产品基线 `e284a1a` / buildId `3.9.6-dc8fb58b578c25d10726` / 新 PID `50996` / instanceId `dc5c58b8-3c9a-4414-8f02-b00d3b1005fb` / startedAt `2026-09-23 21:30:09`。
2. 是：stop 恰 1 次、start 恰 1 次，端口与旧 PID 已验证释放后才启动；无任何自动重启机制被引入。
3. 见 §2 逐字段原值：`EXECUTION_BLOCKED`、`intent=true`、`ready=false`、`modelSpendPermitted=false`、`firstBlocker=EXECUTION_WRITE_LOCKED`、`profileStatus=PROFILE_NOT_CONFIGURED`。
4. **是，0**：自实例启动 `ai_runs_archive` 新增 0 行（PRIMARY 与 SCOUT 均 0），`AI_RUN_TERMINAL/ANALYSIS_ONLY_COMPLETED/TRADE_PLAN_PERSISTED/ENTRY_ORDER_SUBMIT` 均 0；混合 30 分钟窗口里的 4/4 属旧实例历史，已排除。
5. **是**：候选生命周期 115 次重derive、供给健康 19 次、cohort refill 5 次、市场报价持续推进（`lastMessageAt` 前进 240 秒），派发心跳 18→28 次；闸只拒绝模型支出。
6. 私有 REST `TIMEOUT` 抖动：20.4 分钟 27 失败 / 15 恢复，1.2–23.5 秒，`consecutiveFailures` 最大 5，采样时刻已 `READY`；阈值与 timeout 未动，缓存事实未用于放行写。
7. `testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null`（本实例同为 0/0/null），`lockedToTestnet=true`、`executionMode=READ_ONLY`。
8. TP 14/14 `PROTECTED`、`unverifiedTp=0`、无 orphan/dup/qty/side 异常；所有权 27 行 / 27 cycle / 0 `AI_ACTIVE` / outbox 0；`persistence HEALTHY`、`integrity=true`；日志 fatal/uncaught 匹配 0。
9. 46 条（新实例上准入未跑，故按持久层重放同为 46）；根因＝`PortfolioRiskAdmission.inputs()` 的 `builtPending` 自带 status-only 谓词且 `expiresAt` 恒 null，未复用 `entryOrderOccupiesRisk`；其中 44 条已被权威证据释放却仍计，附带 $30,629.41 幻影名义敞口进入风险快照求和。
10. **需要产品修补**：修 `builtPending` 谓词应在批准 PortfolioRisk profile 之前完成，否则 profile 一旦配置，`STRESS_LIMIT:MAX_GROSS_NOTIONAL` 会先被这 $30.6k 幻影敞口撞住，看起来像"配了还是不能交易"的新谜题。批准 profile 仍是必要前置，但不再是充分条件。

## 9. 状态与下一步（含明确不做的）

状态：`V396_TESTNET_ACTIVE_ANALYSIS_ONLY` —— 交易写权限意义下仍是 ANALYSIS_ONLY；**必须同时标注：在 AUTO 执行意图下，`executionReadiness` 未满足，模型支出已被 Anti-Waste 硬闸抑制（这是正常工作，不是模型故障）**。

1. 下一轮离线红→绿修 `builtPending`（复用 `entryOrderOccupiesRisk`）+ 5 条敌意测试，并复跑全仓门禁。
2. 该修补部署后，只读复验幻影 pending 与 $30.6k 是否从风险快照求和消失。
3. 由操作者人工批准 `riskGovernance.portfolioRisk`（Agent 不代填、不猜值）。
4. profile 齐备且私有事实稳定后，才讨论 `READ_ONLY → TESTNET_ENABLED` 与第一笔自然建仓链上线上验收。
5. **不做**：不提高 `maxGrossExposurePct`/`maxDirectionExposurePct`/`maxPositions`；不调松 60 秒 FRESH 窗或私有 REST timeout；不把 UNKNOWN 记 0 或缩短证据有效期来"清"46 条；不绕过 Anti-Waste 闸去"看到模型运行"；不切 `aiExitAuthority=ENFORCE`；不改本次已部署产品源码后再重启取绿。

# V3.9.6 部署轮：`d570bef` pending-risk 单一占用事实源上线（2026-09-24）

授权范围：一次正常 stop + 一次正常 `MANUAL_START`，部署后仅只读验收与证据归档。禁止项（Settings 写、PortfolioRisk 配置、ENFORCE、任何 testnet/production 写、额外重启）**全部遵守**。

**结论：DEPLOYED AND ACCEPTED — 运行 payload 已改用单一 entry 占用事实源，46 行幻影 pending 风险与 $31,236.33 幻影名义在部署产物上重放为 0；Anti-Waste 继续有效（新实例模型调用 0）；写边界 0/0/null；无新 P0/P1。**

## 1. 身份、构建与生命周期

| 项 | 值 |
| --- | --- |
| 部署产品提交 | `d570befca02e952bf174d3e1f42b93cf241285a3`（= 执行时 HEAD，`git fetch` 后 `merge --ff-only` 显示 Already up to date，工作树 0 项） |
| 构建退出码 | `build-01-verify-deps=0`、`build-02-engine=0`、`build-03-dashboard=0` |
| 期望构建身份 | `3.9.6-eaaabc52c682cc1ce56a`，`artifactHash=eaaabc52c682cc1ce56afaa9301fd18aa64c6a51ab99ebfe3c770949660d2786`，`sourceHash=189b3326304c1cc6684337abe19ce7f1de2fd358d6ef7f1dbf7c9055a0b812a5` |
| 新实例自写身份 | PID **`34196`**、HOST_PID `43236`、launchId `50ecd3e0ad624e9fbe68af1e1d97edac`、instanceId 见 `post-deploy-continuity.json`、`startReason=MANUAL_START`、`restartCount=173` |
| 溯源闭合 | 期望 buildId/artifactHash/sourceHash 与新进程自己写入的值 **逐字段相等**（`provenanceClosed: true`） |
| 停止 | `scripts/stop-zdj-lan.ps1` 1 次，exit 0，`ZDJ-MITS stopped; port 8080 is free`，8080 监听数 0，旧 PID 50996 已退出 |
| 启动 | `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` 1 次，exit 0；6 次轮询内 `STARTING → READY` |
| 未做 | 热重载、watchdog、supervisor、autostart、计划任务、二次重启、重试循环 |

旧实例为 PID `50996` / `3.9.6-dc8fb58b578c25d10726`（`e284a1a` 构建，21:30:09 启动，连续运行 9.1 小时）。

## 2. 部署产物确实含本补丁（artifact 级证明）

对**运行中的 live dist** 直接检查（`pending-risk-live-replay.json` 的 `artifactProof`）：

- `liveLedgerStillContainsStatusOnlyOrderFilter = false` —— 旧的 `['NEW','PARTIALLY_FILLED','UNKNOWN','SUBMITTING']` 判定在 live `portfolioRiskLedger.js` 中已不存在；
- `liveLedgerCallsSingleAuthority = true`（`collectPortfolioPendingRiskFacts`）；
- `liveLedgerHardcodesUsdtForPendingOrders = false`；
- `deployedExportExists = true`，`entryRiskOccupancy.js` 内含 `portfolioRiskSide`。

## 3. Pending risk 在部署产物上的真实数据重放

对同一批 live durable 行、同一 `now`，把"被删除的旧谓词"与"部署产物里的新权威"并排跑：

| 指标 | 旧 status-only 谓词 | 部署后的单一权威 |
| --- | --- | --- |
| pending order 数 | **46** | **0** |
| pending 名义 | **$31,236.33** | **$0**（幻影消除量 $31,236.33） |
| durable `UNKNOWN` 行数 | 46 | 46（一条未删、未改写） |
| 其中权威判定仍占风险 | —— | 0（当前全部具备有效证明） |
| 活跃 reservation | 0 | 0 |

fail-closed 复核：46 条被释放行中，缺有效 `VERIFIED_NO_ACTIVE_RISK` 证明的 **0** 条、带 `exchangeOrderId` 的 **0** 条、有成交量的 **0** 条；`unknownRowsStillOccupyingAreCounted=true`（若某行仍无有效证明，权威必然计入并给 `PENDING_RISK_UNVERIFIED`）；每条权威行的 `source` 只在 `RESERVATION/ORDER/UNKNOWN` 内。

**本轮线上未能证明的一点（如实标注）**：`executionMode` 仍是 `READ_ONLY`，预模型闸使 Primary/SCOUT 完全不派发，因此组合准入在新实例上**一次也没有运行**，看不到真实的 `PORTFOLIO_RISK_ADMISSION_EVALUATED` 事件。上面的数字来自"部署产物自身模块 + live durable 行"的重放，与运行时调用的是同一段代码，但它不等于一次真实准入求值。真实准入证据只能在 profile 获批、`modelSpendPermitted` 变 true 之后取得。

## 4. Anti-Waste 与供给（新实例，按实例启动时间计数）

`no-model-spend-window.json`（06:43–06:48，5 个采样）：`modelCallsObserved = 0`（PRIMARY_BRAIN 与 SCOUT 全 0）、`AI_RUN_TERMINAL=0`、`ANALYSIS_ONLY_COMPLETED=0`、`TRADE_PLAN_PERSISTED=0`、`ENTRY_ORDER_SUBMIT=0`、`EXECUTION_READINESS_BLOCKED=1`；同时 `CANDIDATE_LIFECYCLE_REDERIVED=90`、`CANDIDATE_SUPPLY_HEALTH=18`、`MARKET_COHORT_REFILLED=5`、市场 `lastMessageAt` 由 `1790203427572` 推进到 `1790203734503`、派发心跳 11 次。`zeroModelCallsOnNewInstance=true`、`supplyMaintenanceStillRunning=true`。

`executionReadiness` 线上真值：`intent=true`、`ready=false`、`modelSpendPermitted=false`、`blockers=[EXECUTION_WRITE_LOCKED, RISK_PROFILE_UNCONFIGURED]`、`firstBlocker=EXECUTION_WRITE_LOCKED`、`profileStatus=PROFILE_NOT_CONFIGURED`；六项预期（含 blocker 顺序）全部为 true。

## 5. 私有事实与写边界（新实例）

`private-data-and-boundary-readback.json`（窗口 7.9 分钟）：`PRIVATE_SYNC_FAILED=0`、`PRIVATE_SYNC_RECOVERED=0`、`binancePrivate.status=READY`、`snapshotAgeMs=8`、`consecutiveFailures=0`、`lastError=null`。上一实例 9 小时内曾出现 114 次超时抖动 —— 本轮窗口内一次未发生，说明它是间歇性的传输层现象，未做任何 timeout/新鲜度放宽。

写边界（**按实例计数**）：`environment=TESTNET`、`executionMode=READ_ONLY`、`lockedToTestnet=true`、`testnetWrites=0`、`productionWrites=0`、`blockedProductionWriteAttempts=0`、`lastWriteAt=null`。旧实例结束时 `blockedProductionWriteAttempts=1`，其成因已在 `pre-deploy-safety-notes.json` 查清：00:02:10 `ORPHAN_TP_CANCEL_FAILED`（`tp_mu8ha11f_013bdf4`）被 `BinanceTransport.assertTestnetExchangeWrite()` 因 `executionMode!=TESTNET_ENABLED` 拒绝 —— 是 READ_ONLY 写锁正常工作，且该字段对任何被拒交易所写都递增，命名带 "production" 但本次与生产端点无关。历史计数与实例计数不得混用。

## 6. 持仓、TP、所有权连续性

13 个持仓全部 `PROTECTED`、全部 `HUMAN_MANAGED`、每个 cycleId 都在所有权账本中有行（`ownerRowsMissing=0`）；`takeProfit: required=13, protected=13, orphan=0, unverified=0, duplicate=0, qtyMismatch=0, wrongSide=0`；所有权账本 `27 rows / 27 cycles / 0 AI_ACTIVE / outbox 待发 0`，与部署前逐项相同；`reconciliation.status=READY`、`historicalUnknown=46`、`verifiedNoActiveRisk=46`、`activeRiskUnresolved=0`；`/health` READY、`database.integrity=true`；日志 fatal/uncaught 匹配 **0**。

## 7. 本轮之前、非本轮造成的两项现场漂移（只登记，未回写）

1. `settingsVersion` 191 → **197**：06:04:25–06:28:26 六次 `source=cas` 写入（`settings_audit`）。受保护值未变：`executionMode=READ_ONLY`、`entrySafetyMode=AUTO`、`aiExitAuthority=SHADOW`、caps `1 / 0.8 / 50`、`portfolioRisk.configured=false`。本轮零 Settings 写。
2. 持仓 14 → **13**：操作者手工平掉一个仓（发生在上一轮 21:42 之后、本轮之前），其余 13 个 cycleId 与保护状态未受影响。

## 8. Dashboard 只读 readback

见 `dashboard-readback.json` 与 `dashboard-after-deploy.png`：就绪行显示 `EXECUTION_BLOCKED` + 首因 `EXECUTION_WRITE_LOCKED` + "已停止调用模型"；档案行显示 `PROFILE_NOT_CONFIGURED`；容量卡 13/50、Gross `$9,238.36 / $10,814.92`，数字全部来自 Engine 同一投影；页面上不存在"正在分析"字样。本轮未改 Dashboard 源码，故不重复 UI 行为验收。

## 9. 下一步（停止线）

1. 可以进入 **PortfolioRisk profile 的人工数值审批**：幻影 pending 风险已在运行 payload 上消除，它不再是前置 blocker。
2. profile 获批后必须再做一次只读验收，取**真实** `PORTFOLIO_RISK_ADMISSION_EVALUATED`：确认 `PENDING_RISK_UNVERIFIED` 不再出现、pending/gross 求和只含权威占用集合、仓位级事实（margin tier / maintenance / liquidation / ownership 读回）是否全部转 `VERIFIED`。**不得承诺"批完 profile 就能建仓"**。
3. 只有上述真实准入通过，才讨论 `READ_ONLY → TESTNET_ENABLED` 与第一笔自然 PLACE 的 reservation→intent→order submit 线上验收。
4. 仍不处理：两个敞口上限与 `maxPositions`、`aiExitAuthority`、私有 timeout/60 秒新鲜度、proxy/egress、P3 文案、24h soak 结论（该 soak 已在 21:30:09 起算，属另一议题）。
5. 命名问题独立登记：`blockedProductionWriteAttempts` 实际语义是"被拒交易所写"，READ_ONLY 拒绝也计数 —— 不在本轮改，避免在部署轮顺手改产品代码。

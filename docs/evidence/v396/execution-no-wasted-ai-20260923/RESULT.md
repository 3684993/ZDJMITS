# V3.9.6 §A–§I 结果：不可执行时不再烧模型（2026-09-23）

权威计划：`docs/plans/v396/CODEX-V396-EXECUTION-NO-WASTED-AI-20260923.md`（HEAD `5879182`）。
基线：分支 `codex/v396-final-convergence-20260922`，起点 `5879182`（其上是 `e890ed5` 产品源码）。
本轮动作：只读现场核验 + 离线修补 + 离线门禁 + 证据落盘 + push。**零 Engine 生命周期动作、零 Settings 写入、零交易所写。**

## 1. 现场事实（§A，只读）

| 事实 | 值 | 来源 |
| --- | --- | --- |
| 运行实例 | PID `33432`，instanceId `8835e95d-…`，`buildId=3.9.6-50d14dbd22d1ea5ed7d2`（即 `e890ed5` 构建，18:19:40 人工启动） | `data/runtime/engine-instance.json`、`/api/v3/diagnostics/closeout` |
| 边界 | `environment=TESTNET`、`executionMode=READ_ONLY`、`lockedToTestnet=true`、`testnetWrites=0`、`productionWrites=0`、`lastWriteAt=null` | closeout `productionWriteBoundary` |
| 策略 | `settingsVersion=191`、`entrySafetyMode=AUTO`、`executionGovernance=AUTO_RUNNING`、`aiExitAuthority=SHADOW`、`gross=1`、`direction=0.8`、`maxPositions=50` | `settings` 表单行 + `/api/v3/settings` |
| 私有事实 | `binancePrivate.status=UNAVAILABLE`、`noEntryReason=PRIVATE_DATA_UNAVAILABLE`、`snapshotAgeMs≈41s` | `/api/v3/pipeline` |
| 容量 | 持仓 14/50、`inFlight=0`、`reserved=0`、资本可执行候选 7、`capacityVisibility.firstBlocker=NONE` | `/api/v3/pipeline` |
| 浪费实测（30 分钟窗口 20:15–20:45） | `AI_RUN_TERMINAL=23`（全部 `PRIMARY_BRAIN:COMPLETED`）、`ANALYSIS_ONLY_COMPLETED=23`、`TRADE_PLAN_PERSISTED=23`、`ENTRY_ORDER_SUBMIT=0`、`testnetWrites=0` | `runtime_events` 只读聚合 |

结论：驾驶舱显示的 PLACE 数量全部被只读路径吞掉。运行中的构建没有预模型闸，所以**直到本轮代码被部署，浪费仍在继续**（§H 不授权启停，故未部署）。

`live-facts-A.json`、`private-facts-root-cause-D.json`、`risk-admission-facts-E.json`、`live-settings-boundary.json` 为逐值证据。

## 2. §B 预模型执行就绪闸（已实现）

新文件 `apps/engine/src/services/executionReadiness.ts`：`executionReadiness()` 判定计划要求的 7 项硬事实

`ENVIRONMENT_NOT_TESTNET` → `EXECUTION_WRITE_LOCKED` → `PRIVATE_DATA_UNAVAILABLE` → 写侧 egress `writeAdmissionBlock` → `RUNTIME_NOT_RUNNING`/`POLICY_NOT_AUTO` → `portfolioRiskProfileBlockers(...)` → `NO_EXECUTABLE_CANDIDATE`，

返回 `{intent, ready, modelSpendPermitted, blockers, firstBlocker, profileStatus, mode, text, ...}`。`intent` 只在 `executionGovernance=AUTO_RUNNING` 且 `entrySafetyMode=AUTO`（即操作者要求交易）时为真；真而 `ready=false` 时 `modelSpendPermitted=false`。显式研究态（`SHADOW_ONLY` 等）仍为 `RESEARCH_ONLY`，保留 ANALYSIS_ONLY 研究用途——这正是计划要求的区分。

接线（三处，不新增第二套判定）：

- `appRuntime.dispatchAnalysisTick()` 每调度 tick 计算一次并 `entry.noteExecutionReadiness(...)` 推送；
- `entryCoordinator.processPool()` 在 `await this.ai.probePrimaryIfDue(now)` **之前** `if (!this.modelSpendPermitted()) return;`；
- 投影：`analysisDiagnostics().execution`（含 `blockers/firstBlocker/lastReadyAt`）与 `pipelineStatus().executionReadiness`。

**设计裁决（与计划字面的差异，主动说明）**：闸没有放在"整轮 tick 直接 return"，而是放在 `processPool` 的模型派发点上。原因：`processPool` 前半段是确定性供给维护（候选生命周期迁移、`pool.replenish`、`refreshReadyView`、 scout 重排），若在 tick 入口就返回，长时间 READ_ONLY 会让候选池冻结、恢复时先经历一段冷启动假象。放在派发点上，模型调用为 0，而供给保持温热，`facts 恢复后下一调度 tick 自动恢复` 更强。`executionReadiness.test.ts` 用第 4 例把这条钉住（拒模型时 `pool.readyList().length>0`）。

阻断时写 `EXECUTION_READINESS_BLOCKED` 事件（首个真因 + blockers + 候选数），恢复时写 `EXECUTION_READINESS_RESUMED`，状态切换才写，不刷屏。

## 3. §C PLACE 执行不变式（已证明，离线）

`TESTNET_ENABLED` + 私有新鲜 + profile 齐备时，真实协调器走完整链：`PORTFOLIO_RISK_ADMISSION_EVALUATED allowed=true` → `TRADE_PLAN_PERSISTED` → reservation（1 条，非 `RELEASED`）→ `entryIntents=1` → `entryOrders=1` → `placeEntry` **恰一次**，方向与价格逐值等于决策；且无 `ENTRY_DECISION_BLOCKED`。LONG/SHORT 各一例。

post-AI 自相矛盾的 PLACE（价格三元组冲突）→ `ENTRY_DECISION_BLOCKED stage=POST_AI_VERIFY reason=DETERMINISTIC_POST_AI_VERIFY_FAILED`，不 submit，同一事实第二次 tick **不再买模型**（`decide` 仍为 1 次）。没有伪造 fill。

## 4. §D PRIVATE_DATA_UNAVAILABLE 根因

30 分钟内 `PRIVATE_SYNC_FAILED=16`、`PRIVATE_SYNC_RECOVERED=17`，`errorCode` 全为 `TIMEOUT`，`lastError=BINANCE_TRANSPORT_BLOCKED: Binance request timed out`，单次 `durationMs` 15.0–20.4 秒（私有 REST 轮询超时上限），`consecutiveFailures` 恒为 1。

机制：私有轮询每 15 秒一次，一次代理路由超时就把 `account.status` 立刻置 `UNAVAILABLE`，下一次轮询成功即恢复；因此这是**每 ~2 分钟一次、数十秒自愈的抖动**，不是断线未恢复，也不是凭证/时钟/egress 失效（egress 当前 `VERIFIED`，市场/TP/对账健康）。

按计划处理：允许正常恢复逻辑；不用旧缓存事实放行订单（`privateAccountFresh` 仍要求 `READY` 且 `asOf` 年龄 ≤60 秒，闸与准入共用）；本轮不改超时、不放宽新鲜度。根因不在 Engine 代码内（出口路由/上游响应时间），已如实保留证据。

## 5. §E PortfolioRisk profile 权威状态

`profileReadback()` 为权威：**`configured=false`**，11 个上限全为 `0`，`marginTierVersion/correlationVersion/scenarioVersion` 全为空串，`maintenanceMarginRatePct=null`，`settingsVersion=191`。

- 未伪造任何默认值，未替操作者决定风险参数。
- `portfolioRiskLedger.ts` 新增单一真源 `portfolioRiskProfileBlockers()` / `portfolioRiskProfileStatus()`，`profileReadback()` 现在带 `status`（`PROFILE_NOT_CONFIGURED` / `PROFILE_FACTS_UNPROVEN` / `READY`）、`blockers`、`missingFields`。
- 驾驶舱 `OverviewView.vue` 新增两行只读事实：`执行就绪判定`（Engine 投影的 `mode`/`firstBlocker`/`lastReadyAt`/文本）与 `组合风险档案（权威 readback）`（`status` + blockers + 缺失字段）。缺投影时显示 `NOT_EVALUATED`，**不会自行写成 READY**。Vue 不重算任何风险账。
- 当前 30 分钟窗口内 23 次 `PORTFOLIO_RISK_ADMISSION_EVALUATED` 全部 `allowed=false`，其中包含 `RISK_PROFILE_UNCONFIGURED`、`MARGIN_TIER_UNPROVEN`、`CORRELATION_VERSION_UNPROVEN`、`STRESS_SCENARIO_SET_UNPROVEN`，部分窗口另有 `PRIVATE_ACCOUNT_NOT_FRESH`。

## 6. §F 执行模式切换：**未执行**

前置条件真实未满足（`EXECUTION_WRITE_LOCKED` 只是当前设定，真正硬缺的是 `RISK_PROFILE_UNCONFIGURED`，并且私有新鲜在抖动）。此时把 `READ_ONLY → TESTNET_ENABLED` 等于在没有任何组合风险权威的情况下解锁写路径，计划明确禁止。因此本轮**没有发起任何 Settings 写**，边界仍为 `READ_ONLY`、`testnetWrites=0`、`productionWrites=0`。

操作者若批准建仓，需要的是人工在设置边界填 `riskGovernance.portfolioRisk`（`configured=true` + 11 个上限 + 三个版本串 + `maintenanceMarginRatePct`），随后按 §F 单次切换 `executionMode`。这两步都不在本轮授权范围内。

## 7. §G 敌意回归映射（7/7）

| 计划要求 | 测试 |
| --- | --- |
| 1 READ_ONLY+AUTO_RUNNING+可执行候选 → Primary 0 次 | `asks the Primary zero times under READ_ONLY while candidates are executable` |
| 2 PRIVATE_DATA_UNAVAILABLE → 0 次，恢复后下一 tick 自动续 | `blocks on stale private facts and resumes on the next tick without a restart` |
| 3 `configured=false` → 0 次且显示 `PROFILE_NOT_CONFIGURED` | Engine `spends nothing while the risk profile is unconfigured…` + Dashboard `labels an unapproved risk profile PROFILE_NOT_CONFIGURED and never a generic READY` |
| 4 TESTNET_ENABLED+新鲜+allowed+PLACE_LONG → reservation→intent→order submit，`placeEntry` 恰一次 | `LONG reserves, creates intent and order, and submits exactly once` |
| 5 同上 SHORT | `SHORT reserves, creates intent and order, and submits exactly once` |
| 6 post-AI 硬门失败 → 不 submit、有 stage/reason、同一事实不重烧 | `reports a post-AI refusal with its stage and reason instead of a vague WAIT, and spends no second call` |
| 7 production 永远 0 写 | `never spends a model outside Testnet…` + `does not evaluate readiness at all when the environment is not Testnet` + 既有 `isProductionExchangeEnvironment`/写边界门禁 |
| 附加：拒模型不得冻结供给 | `keeps deterministic supply maintenance running while the model is refused` |
| 附加：投影不得自造 READY | `reports NOT_EVALUATED rather than inventing a ready state when the Engine projection is absent`、`shows the profile as configured once the readback says so, with its version` |

`finalActivation.test.ts` 的旧语义（READ_ONLY 下 tick 必达 `processPool`）就地改写并加注释：研究态（无 AUTO 意图）仍派发，武装交易意图的浪费由新闸负责——是语义更正，不是删除覆盖。

## 8. 门禁（§H，离线，真实退出码）

`gates/exit-codes.txt`：`s00-static / storage-coverage / script-syntax / engine-typecheck / engine-tests / engine-build-scratch / dashboard-typecheck / dashboard-tests / dashboard-build-scratch / core-typecheck / core-tests / contracts-typecheck / contracts-tests / git-diff-check` **全部 =0**。
计数：Engine 154 files / **1183** tests，Dashboard 12 files / **44** tests，core 8 files / 46 tests，contracts `--passWithNoTests`（0 例覆盖不得写成已覆盖）。
构建一律落到 `build-check/` 临时 outDir：运行中的 Engine 直接消费 `apps/engine/dist` 与 `apps/dashboard/dist`，原地构建等于未授权的部分部署。跳过 `verify:scripts` 内的 PowerShell rollout 自检（会触达生命周期脚本），改为 `node --check` 语法门，原因记于此。

## 9. 登记但不修的观察

1. `risk-admission-facts-E.json` 显示准入 blockers 里有 **47 条 `PENDING_RISK_UNVERIFIED:order:entry_intent_*`**，而同批 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 事件对这些同一 orderId 给出 `evidence.status=VERIFIED_NO_ACTIVE_RISK`、`occupancyReleased=true`、`activeRiskExposure=false`。两个面在同一批事实上结论相反（风险账本仍计未证 pending 风险）。这不是本轮授权范围，且 profile 未配置时它不影响结果；即使配置好 profile 它很可能仍单独致 `allowed=false`。**因此不要假定"配置 profile 就能下单"。**
2. 窗口内另有 `RECONCILIATION_FAILED=14`、`TRADE_SYNC_AUTO_FAILED=4`、`UNKNOWN_RISK_AUDIT_SUMMARY=6`。
3. 边界漂移（非本轮）：`maxDirectionExposurePct` 由 `0.5` 变 `0.8`，来自 19:16:53 一次 `source=cas` 写入（`settings_audit id=75`），晚于 `e890ed5` 部署证据的三次 0.5 快照。本轮只记录，未回写（计划禁止改这两个上限）。

## 10. §I 八问直答

1. **24 PLACE / 0 submit 的直接根因是否已关闭**：代码层已关闭（预模型闸 + 就绪投影 + 7 例红→绿，门禁全绿），**线上未生效**——运行实例仍是 `e890ed5` 构建，没有预模型闸。关闭需要一次部署，本轮不授权启停。
2. **PRIVATE_DATA_UNAVAILABLE 根因与是否恢复**：私有 REST 轮询经代理路由 15.0–20.4 秒超时，30 分钟 16 次、每次下一次轮询即恢复（`consecutiveFailures` 恒 1），非凭证/时钟/egress 故障；已恢复但呈周期性抖动。未用缓存事实放行任何写。
3. **portfolioRisk profile 真实 configured 状态**：`configured=false`，11 上限为 0、三个版本串为空、`maintenanceMarginRatePct=null`。未伪造。
4. **executionMode 最终值**：`READ_ONLY`（未切换）。
5. **第一个自然 PLACE 是否真实进入 reservation/intent/order submit**：线上 `NOT_OBSERVED_ON_LIVE`（写仍锁定，`testnetWrites=0`）；离线在真实协调器上已证明 LONG/SHORT 各一次完整链且 `placeEntry` 恰一次。
6. **testnetWrites / productionWrites**：`0 / 0`，`lastWriteAt=null`，`blockedProductionWriteAttempts=0`，`lockedToTestnet=true`。
7. **是否还存在"不可执行却继续调用大模型"的路径**：本轮修补后没有——`intent && !ready` 在 `probePrimaryIfDue` 之前返回，SCOUT 与 Primary 都不派发；显式研究态（非 AUTO 意图）仍允许 ANALYSIS_ONLY，这是计划允许并保留的模式。**但这条修补只在离线代码中成立，线上要等部署。**
8. **若仍不能交易，唯一剩余硬 blocker**：`RISK_PROFILE_UNCONFIGURED` —— 需要操作者人工批准 `riskGovernance.portfolioRisk`。次一等级待验证项是 §9.1 的 47 条 `PENDING_RISK_UNVERIFIED`，它在 profile 配置后极可能成为下一个首因。

## 11. 停止线（下一轮只列 5 项，含不该做的）

1. 一次经授权的部署，把预模型闸带上运行实例；部署后只读回 `pipelineStatus().executionReadiness`。
2. 操作者填 `portfolioRisk` profile（Agent 不代填、不猜值），填完再单点评估 §9.1 的 47 条 pending 风险是否为第二硬 blocker。
3. 若 profile 齐备且私有事实稳定，才讨论 §F 的 `executionMode` 切换。
4. 登记 `PENDING_RISK_UNVERIFIED` vs `VERIFIED_NO_ACTIVE_RISK` 的双面矛盾为独立问题并取证，不在部署轮顺手改。
5. **不做**：不提高 `maxGrossExposurePct`/`maxDirectionExposurePct`/`maxPositions`；不为凑成交放宽 0.5 reachability、economics 或任何 UNKNOWN 门；不把私有超时阈值/FRESH 窗口调松；不伪造 profile 字段；不切 `aiExitAuthority=ENFORCE`；不在无人授权时启停 Engine。

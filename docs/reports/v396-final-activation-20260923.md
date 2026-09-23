# V3.9.6 最终正式启用：`V396_TESTNET_ACTIVE_ANALYSIS_ONLY`（2026-09-23）

按计划 [CODEX-V396-FINAL-ACTIVATION-20260923](../plans/v396/CODEX-V396-FINAL-ACTIVATION-20260923.md) 执行，权威输入为 `v396-shadow-advanced-audit-20260923.md`。已 fetch 并 `merge --ff-only` 到 `b5512f5`，无 rebase/squash/force，PR #9 未动。

**最终状态：`V396_TESTNET_ACTIVE_ANALYSIS_ONLY`。** V3.9.6 已正式启用并作为当前 Testnet 主运行版本；AI 分析与计划/风险链工作；交易所写仍因独立安全边界保持锁定。不再使用 `READY_FOR_*` 表述。

## 1. HEAD / buildId / PID

| 项 | 值 |
|---|---|
| 分支 HEAD | `b5512f5`（合并后本地；本轮证据与报告在其上追加） |
| 运行 buildId | `3.9.6-17b70933748fb230d5b7` |
| PID / 实例 | **31776** / `0e210c2f…`，`startReason=MANUAL_START`，13:22:20 启动 |
| 上一实例 | 26896（`3.9.6-e8b14777527e28bd3b80`），本轮受控停止 |
| artifactHash / sourceHash | 见 `runtime-acceptance.json`，由运行时对四个 dist 树与四个 src 树自算 |

生命周期动作用尽：一次 `stop-zdj-lan.ps1`（`port 8080 is free`，复验监听 0、引擎进程 0）+ 一次 `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`。无热重载、无自动重启、无 watchdog/autostart。

## 2. 三个 P1 的修复与红→绿

上游 `b5512f5` 已实现三个 P1（红测与转录在其 `docs/evidence/v396/final-activation-20260923/` 的 `red.txt`/`immutable-red.txt`/`green-targeted.txt`/`green-integration.txt`/`full-tests-final.txt`/`s00-final.txt`/`egress-regression.txt`）。我逐行审阅源码差异并按仓根独立重跑门禁，未采信转录。

- **P1-1 分析与写许可解耦**：`appRuntime.dispatchAnalysisTick()` 的门改为 `exchange.environment==='TESTNET' && canDispatch()`，不再要求 `executionMode==='TESTNET_ENABLED'`；启动路径同样放开。`EntryCoordinator.analysisDiagnostics()` 产出 `mode/reason/lastTickAt/lastAttemptAt/lastRequestAt/lastSuccessAt/lastFailureAt/lastBlockedReason/capitalExecutableCount/silenceMs`，七态齐备（FACTS_BLOCKED → POLICY_DISABLED → MODEL_UNREACHABLE → SILENCE_UNKNOWN → NO_SUPPLY → CAPACITY_BLOCKED → DISPATCH_STALLED）；`ANALYSIS_DISPATCH_HEARTBEAT` 每 30 s、派发前发 `ANALYSIS_DISPATCH_INTENT`；`OverviewView` 显示 `analysis.text` 与最近调度/最近成功/静默分钟/资本候选。READ_ONLY 下 `resumeExecutionWaits` 被跳过，AI 决策终点走 `completeReadOnlyAnalysis`。
- **P1-2 profile 权威**：`profileVersion` 改为对整行 `stableRiskHash(row)`（含 correlation/scenario/marginTier 版本与维护费率），新增 `provenance{source:SETTINGS,settingsVersion,path,configured,contentHash}` 与 `profileReadback()`，并经 pipeline 暴露。现网回读：`configured=false`、12 项限额全 0、三个版本字段空串、`maintenanceMarginRatePct=null`、`contentHash=v396r38485931236…`。**未填写任何"能过"的默认值**，未配置即 fail-closed。
- **P1-3 币种与单位**：`marginAsset` 不再默认 `'USDT'`，为空即 `POSITION_MARGIN_ASSET_UNPROVEN` 且该持仓 `factStatus=UNKNOWN`；资产侧稳定币走显式 1:1 约定，非稳定币只有在 `valuationAsOf` 新鲜（≤120 s）时才按 `usdValue/walletBalance` 折算，否则 `availableMarginUsd=null`。红→绿证据：BTC `availableBalance=0.01, usdValue=870` 得 **870**（不是 `$0.01`）；估值过期时资产覆盖为 `UNVERIFIED`；USDT/USDC 保持 90。
- 不可变性补强：`putTradePlan` 对同 `planId` 不同内容改为 `PLAN_ID_IMMUTABLE` 拒写（原先会静默 `superseded`）；`planId` 由 `factVersion+candidateSetHash+side+selection` 内容派生，新事实自然产生新 id，因此这是反篡改而非阻断正常改版；`persistWaitPlan` 的 `factVersion` 由字面量 `'wait'` 改为真实内容哈希，且 `expiresAt` 取 `max(now+1, envelope)` 避免过去期。

**我本轮未新增产品代码改动**：审阅后未发现计划三个 P1 的未闭合缺口，故没有伪造"我也改了点什么"的差额。

## 3. 门禁（仓根裸命令，真实 exit code）

| 门禁 | exit | 结果 |
|---|---:|---|
| `npm run verify` | 0 | deps+scripts+typecheck+build+test；**engine 1,155 tests / 152 files**、core 46 / 8、dashboard 25 / 9 |
| `node scripts/v396-s00-static-check.mjs` | 0 | `blockers: []` |
| `node scripts/v396-storage-coverage.mjs --check` | 0 | `S08_STORAGE_COVERAGE_PASS` |
| `git diff --check` | 0 | 无空白问题 |

测试数 1,142 → 1,155（+13）来自上游 `finalActivation.test.ts`。未删断言、未放宽阈值、未把 UNKNOWN 记 0、未填默认事实。

## 4. 当前实例的 PRIMARY / TradePlan / PortfolioRiskAdmission 证据

诚实结论：**本轮观察窗内没有出现自然资本可执行候选，因此这三条链在当前实例上还没有真实一次运行**；但派发通路被证明是开的，且其终点行为有离线集成测试覆盖。

- 11 分钟、10 次采样：`mode=ANALYSIS_ONLY` 全程；首因在 `NO_SUPPLY`（`pipelineReady=0` 时）与 `CAPACITY_BLOCKED`（`pipelineReady=1~2` 且 `capitalExec=0` 时）之间如实切换 —— 这正是旧版做不到、审计 P1-1 要求的事。
- `ANALYSIS_DISPATCH_HEARTBEAT` 累计 **22** 次（30 s 节奏），`lastTickAt` 持续新鲜，`lastBlockedReason=NO_RUNNABLE_CANDIDATE`（候选选择阶段，而非权限/事实闸），说明 `processPool()` 真的在 READ_ONLY 下运行到了派发判定。
- 模型 `ONLINE`、`queueDepth=0`、本实例 `totalRuns=0`；`silenceMs` 以**本实例** `observationStartedAt` 起算（不再冒充 04:55 的历史成功）。
- 计划允许："若自然候选暂时不存在，只要 scheduler/dispatch/模型健康/首因事实可证，V3.9.6 仍保持正式运行"。不强造候选、不调宽 `maxGrossExposurePct`/`maxDirectionExposurePct`、不改 0.15 单位。
- 终点路径离线证据：以真实 `PLACE_LONG`/`WAIT_FOR_PRICE`/`REJECT_CANDIDATE` 决策驱动，断言 `ANALYSIS_ONLY_COMPLETED`、`PORTFOLIO_RISK_ADMISSION_EVALUATED{allowed:false,analysisOnly:true}`、恰好 1 条 `side:WAIT, quantityUnits:0, source:SYSTEM, immutable` 计划、改写与升版篡改均 `written:false`、`entryReservations/entryIntents/entryOrders` 均 0、`placeEntry/cancelEntry/setLeverage` 均未被调用。

## 5. 写边界与稳定性

`productionWriteBoundary = { environment: TESTNET, executionMode: READ_ONLY, lockedToTestnet: true, testnetWrites: **0**, productionWrites: **0**, blockedProductionWriteAttempts: 0, lastWriteAt: **null**, lastWritePath: null }`；自本次启动起订单生命周期类事件 **0**；`ENGINE_FATAL_ERROR/RUNTIME_STOP*` **0**；`persistence=HEALTHY integrity=true`。档位保持 `settingsVersion=190`、`READ_ONLY`、`aiExitAuthority=SHADOW`（**未切 ENFORCE**）、`positionReviewEnabled=false`、`tradeEconomics.admissionMode=SHADOW`。

## 6. TP / ownership / UNKNOWN / 真值

27 笔持仓、`unprotected=[]`、27 张 `WORKING` 止盈单且符号集合与持仓一一对应；`notionalUsd` 负值 0、空值 0；46 笔非终态 Entry 订单全部 `VERIFIED_NO_ACTIVE_RISK`（缺证据 0）、`activeRiskUnresolved=0`。所有权账本：27 行 / 27 周期 / **双行 0 / AI_ACTIVE 0**、`25 HUMAN_MANAGED + 2 HANDOFF_PENDING`、claims/mandates 0、`integrity_check=ok`，重启后与重建时一致 —— 引擎沿用同一把 `positionSide` 键读写，没有再生成并行行。

## 7. 残余与未声称

`ENFORCE` 未授予；有限 Testnet 写回合 `NOT_RUN`；24h soak 计时**未启动**（本授权不含，且旧 `health.shadow` 计数仍属历史实例，不得充当 V3.9.6 合格时长）；本轮不声称任何盈利/经济改善或契约级覆盖。审计的 P1-4（计时与层级计数混用）、P2（cohort/retention API 缺口、3 个 zombie snapshot、budget `observationTrust=INCONSISTENT`、observer manifest mismatch、`aiExitAllowSmallLoss` 与"论点失效可平 0–10 小亏"目标的差异）保持开放。

## 8. 下一轮需要单独授权

1. PortfolioRiskAdmission profile 的**显式审批取值**（capital-at-risk/压力损失/相关性簇/场景/维持保证金档位版本）——属人的决策，代码只保证不填默认即 fail-closed。
2. `ENFORCE` 与有限 Testnet 写回合（H-AUTHORITY 独立一层）。
3. 绑定当前实例/build/settings/账本版本的 24h soak 采集。

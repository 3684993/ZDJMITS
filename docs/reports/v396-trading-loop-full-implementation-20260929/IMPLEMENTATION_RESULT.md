# V3.9.6/V3.9.7 交易闭环一次性完整实施结果（2026-09-29）

任务书：`docs/prompts/v396-trading-loop-full-implementation-20260929.md`
分析依据：`docs/reports/v396-trading-loop-root-cause-audit-20260929/ROOT_CAUSE_REPORT.md`、`IMPLEMENTATION_PLAN.md`
本轮性质：一次性完整实施（P1–P7 代码 + schema/migration + repair 工具 + 测试 + 构建 + TESTNET 运行核验 + 报告），不逐阶段征求确认。

---

## 1. 起始 SHA / 最终 SHA

| 项 | SHA |
| --- | --- |
| 起始（`main` 在开始实施时） | `19cf609` docs: add full trading-loop implementation prompt [skip ci] |
| 最后一段代码提交 | `2a64977`（见 §14 完整提交链） |
| 本报告提交与最终 `main` HEAD | 见 §14 |

本轮全部提交（`git log --oneline 19cf609..HEAD`，14 个提交，含本报告提交；§14 的记录提交为其后一个纯文档提交）：`67a7932` P1 → `dcf8aab` P2/P3 → `4566d12` P4/P5 → `6b62ce2` P6 → `c9c286e` P0 repair + P7 UI → `ee80625` readback 失真修正 → `e6e04c0` 守恒标签 → `efe59c1` 迁移索引复活崩溃 → `aa9c6de` repair 双份持久 + 收敛登记出处 → `d8bb19c` 资金费整账户读取 + lastSync → `e949d27` tpEconomics 枚举/出处声明 → `b489865` 挂死查询不得冻结收敛 → `2a64977` passGate 轮内可见 → `61cc97d` 本报告。

规模：`git diff --shortstat 19cf609..61cc97d` = **83 files changed, 7048 insertions(+), 204 deletions(-)**（含测试、压缩后的 repair 决策摘要与本报告）。

## 2. 实际修改文件清单（按区域）

**引擎服务（38）**
- 新增：`exitOrderFact.ts`、`orderProvenanceRegistry.ts`、`entrySubmissionIdentity.ts`、`entryPermissionModel.ts`、`tpTargetContract.ts`、`orderBookDepth.ts`、`fundingIncomeLedger.ts`、`quoteFxPolicy.ts`、`tradingLoopRepair.ts`
- 修改：`s04ExitCoordinator.ts`、`v396ExitRuntime.ts`、`reconciliationService.ts`、`tpGuardian.ts`、`positionService.ts`、`positionLifecycleTracker.ts`、`cycleAccounting.ts`、`entryCoordinator.ts`、`admissionCapacityReader.ts`、`humanManagedProjection.ts`、`runExecutionOutcome.ts`、`preAiExecutionEnvelope.ts`、`aiFabric.ts`、`positionReviewScheduler.ts`、`positionReviewRunner.ts`、`v396AiExitRunner.ts`、`executionLifecycle.ts`、`riskReadiness.ts`、`runtimeState.ts`
- 适配器/存储：`adapters/exchange/ExternalTradeAdapter.ts`、`config/settingsStore.ts`、`runtime/appRuntime.ts`

**API / 契约（7）**：`api/projections.ts`、`api/router.ts`、`packages/contracts/src/{trading,api,settings,ai}.ts`

**Dashboard（16）**：新增 `utils/holdingDuration.ts`、`utils/useNow.ts`、`testing/dashboardSnapshotFixture.ts` + 各自测试；修改 `views/OverviewView.vue`、`PositionsView.vue`、`HumanManagedView.vue`、`components/PositionConsole.vue`、`styles.css`；新增测试 `OverviewView.executionTruth.test.ts`、`{PositionsView,HumanManagedView,PositionConsole}.holding.test.ts`

**脚本 / 证据（3）**：`scripts/repair-v396-trading-loop.mjs`（manual lifecycle entrypoint）、`scripts/v396-durable-schema-roundtrip.mjs`（只读回读校验）、`docs/evidence/v396/S00/20260921T145000Z/entrypoint-review.json`（重新生成）

**测试文件（引擎新增 9 + 修改 6）**：`exitConvergenceFairness`、`positionCycleLotAccounting`、`entrySubmissionIdentity.integration`、`entryPermissionModel`、`exitFactsAndFunding`、`tradingLoopRepair`、`api/positionCycleSnapshot`、`api/executionTruthSplit`、`adapters/exchange/ExternalTradeAdapterFunding`；修改 `j1ExitTruthHostile`、`c3RuntimeWiringHostile`、`tpGuardianEconomics`、`j1AiExitConsumer`、`grossRiskCapacityVisibility`

## 3. schema / migration

`data/zdj-settings.sqlite`（`schema_migrations` 版本推进到 **11**）
- 新增列 `entry_execution_tasks.{submission_key,isolation_key,isolation_mode}`；
- 回填：`isolation_key=scope`；`submission_key=json_array(env, account, COALESCE(payload.intent.id,intent_id), side)`；`isolation_mode = TESTNET→'SUBMISSION_ONLY' / 其它→'UNDERLYING_LEGACY'`；
- **删除** `entry_execution_scope`（按底层 scope 的部分唯一索引 = R6 的第二权威），并显式不再重建（`efe59c1`：旧代码在 `open()` 里 `CREATE UNIQUE INDEX IF NOT EXISTS` + 之后 `DROP`，下一次启动会在合法的多行同 scope ACTIVE 数据上重建索引 → `UNIQUE constraint failed: entry_execution_tasks.scope` → 引擎无法启动）；
- 新建 `entry_execution_submission (submission_key) WHERE active=1` 与 `entry_execution_underlying_isolation (isolation_key) WHERE active=1 AND isolation_mode='UNDERLYING_LEGACY'`，另加非唯一历史索引 `entry_execution_scope_history`。

`data/v396-ownership.sqlite`（`PRAGMA user_version` 保持 **1**，故意不 bump，保留回滚窗口；布局以列存在性检查）
- `v396_exit_tasks` 增加 `last_attempt_at / next_eligible_at / attempt_count` + `v396_exit_task_service` 索引（公平轮转的持久载体）；
- 终态 claim 释放留痕：`releasedAt / releasedBy / quantityUnitsAtRelease`；
- 新表 `v396_order_provenance`（PK environment,account_id,client_order_id）、`v396_funding_income`（PK 交易所 income id）、`v396_funding_coverage`。

契约（zod）新增/扩展：`PositionSchema.{physicalCycleKey,lastAddAt,addCount,lastReviewAt,nextReviewAt}`、`EntryLotSchema`、`TradeRecordSchema.{positionCycleId,entryLots,lotAllocationMethod,ledgerConservation}`、`ExecutionFillSchema.{positionCycleId,entryLotId,fillRole,provenanceSource}`、`EntryExecutionEnvelopeSchema.leaseBudget`、`takeProfit.{fullPositionMinMovePercent,authorizedTargetProfitFloorDisposition}`、`api.positionCycleFacts / exitConvergence(+passGate) / executionTruth(+conserved/openConserved/unproven, fundingCoverage.lastSync, reviewAuthority.lastOutcome 结构化)`、`riskGovernance.exitCoordination`；`tpEconomics.status` 增加 `TP_LOW_NET_TARGET_KEPT` 并声明 `economicWarning/targetProvenance`（`e949d27`：未声明的状态值会让下一次 load 直接拒绝解析）。

## 4. P1–P7 实际实现

**P1 退出终态统一传播 + 公平收敛（`67a7932`）**
所有退出订单读者（WS `ORDER_TRADE_UPDATE`、exact-order、open-orders 对账、cancel/replace 结果、启动恢复、repair）统一经 `normalizeExitOrderFact` → `PositionExitCoordinator.applyVerifiedFacts` 单一幂等 reducer：终态单调不回退、身份（symbol/environment/account/quantity）不符即拒、部分成交按余量更新、claim 只在“身份 + 终态”被自身覆盖证明时释放，且先归档 `v396_claims_history` 再释放。连续收敛改为持久公平队列 `WHERE state IN(open) AND next_eligible_at<=? ORDER BY next_eligible_at,last_attempt_at,id`，失败仅对单个订单指数退避；`convergenceStats` 发布 `openTasks/eligibleNow/neverPolled/oldestUnpolledAgeMs/terminalUnreleasedClaims/batchLimit/intervalMs/maxServiceIntervalMs/rounds/fairness`。
补充修正（`b489865` + `2a64977`）：一次永不返回的签名查询会把 `converging` 永久置真、令收敛静默停摆（实测发生）；现在每条查询带截止（间隔的一半，5s–30s，可注入），超时记 `QUERY_DEADLINE_STAYS_UNACKED` 并只对该单退避；轮内/轮外状态通过 `exitConvergence.passGate` 可见。

**P2 物理持仓周期 / Entry lot / 退出归属 / Closed Trade（`dcf8aab`）**
`positionCycleId` 为连续物理持仓，`entryLots` 为周期内的每笔 Entry 成交；`cycleAccounting.allocateExitLotsFifo` 按比例把退出数量/名义/手续费/realizedPnl 分摊到 lot，**总量守恒**（不复制成交）；`positionService.cycleForFill` 按证据顺序（owner record → 活跃 lifecycle → position/entry order 种子）绑定 fill，`restart / WS 先于 ACK / 迟到历史 fill / 重复导入` 均不产生第二个周期；`ledgerConservation`（`e6e04c0` 修正为一致性判据：OPEN 持仓有余量是 CONSERVED，只有自称 CLOSED 却未归零才是 UNCONSERVED，负数量为 LEDGER_INCONSISTENT）；`positionCycleFacts` 与 `executionTruth.fillCycleConservation` 上界面（并修正其在快照 schema 中的声明层级）。

**P3 Entry 提交身份与底层隔离分离（`dcf8aab` + `efe59c1`）**
`entrySubmissionIsolation` 给出 `SUBMISSION_ONLY`（TESTNET funds-only）/ `UNDERLYING_LEGACY`（Production）两种模式；claim 结果改为带类型的 `EntryClaimOutcome{cause,conflict,maySubmit,mustQueryFirst}`；已释放身份永不被复用（无 retryRejected 例外）；Production  legacy 隔离逐字保留（第二行同底层仍被拒）；`submitExactlyOnce` 保留 `ENTRY_SUBMISSION_*` 首因而不再退化为 `RESERVATION_INVALID`；真实二次 open 仍被 unique 索引拒（`entrySubmissionIdentity.integration.test.ts`）。

**P4 三层 Entry 权限模型 + 资金/容量投影（`4566d12`）**
`candidateAnalysisEligibility`（不涉钱）／`evaluateEntryExecutionPermit`（资金事实 + JIT 事实 → 唯一首因）／`portfolioRiskObservation`（`enforced:false`，仅观察）；`preAiExecutionEnvelope` 的 lease 预算化（`leaseRequiredMarginUsd=min(max(LONG,SHORT),candidateBudget)` + `leaseBudget{requestedUsd,cappedBy,budgetUsd}`）；`admissionCapacityReader.ceilingUsdBySide` 在 NOT_APPLICABLE/UNAVAILABLE 时为 **null**（不再伪造 0），`capacityVisibility` 原样透传（`ee80625` 消除 “0 与 NOT_APPLICABLE 并存” 矛盾）；`humanManagedProjection.newEntryBlockedByCaps` 仅在非 funds-only 生效并附 `humanCapsDisposition/humanCapsEnforced`；新增 `GET /diagnostics/entry-permission`；Dashboard 侧明确标注每个容量数字的权威来源（`c9c286e`）。

**P5 TP 与持仓退出的职责契约（`4566d12`）**
`tpTargetContract.authorizedTargetFacts/assembleTargetSelection`：授权目标只受 horizon/15m 证据/区间/可达侧/距离上限约束；利润地板默认 **WARN_AND_KEEP**（不再把授权目标改写成 $1 地板），移动地板改为显式配置 `fullPositionMinMovePercent`（默认 0，废除 1.2% 隐藏 canary）；`targetProvenance`（authorizedPresent/Price/Valid/fellBackFrom/refusals/economics/profitFloorDisposition/minMoveFloorSource/parameterVersion）+ `economicWarning` 一并持久；chosen 顺序 HUMAN→AI→STRUCTURE→FIXED。

**P6 资金费 / FX / 盘口深度 / Review 资源（`6b62ce2`）**
`FundingIncomeLedger`（income 行 + coverage 窗口，EXACT 只在完整覆盖窗口包住周期时给出，全窗口无行=已证明为 0，否则 UNKNOWN）；`quoteFxPolicy.convertToBaseUnit`（USDT 为 `BASE_UNIT_IDENTITY`，非基础资产必须带时间戳汇率，否则 `RATE_ABSENT/RATE_STALE` 且不写金额）；`orderBookDepth.executableDepth`（真实盘口在界内逐档累计，未知深度不是无限深度，具名拒绝原因）；`aiFabric` Review 公平份额（`reviewCapacitySharePercent` 上界、`AI_PRIMARY_HELD_FOR_REVIEW`、`reviewFairness` 读回）与调度器 `lastSkippedReason/reviewReadback/dueCount`；资金费拉取改为**整账户一次分页读**（`d8bb19c`，原先 40 symbol × 3 分页 = 120+ 签名请求/轮），断页即 `complete=false` 不记录覆盖，Production 私有读继续 fail-closed；`lastSync` 进 readback。

**P7 持仓累计时长 / 健康拆分 / 审计 UI（`c9c286e` + dashboard）**
`utils/holdingDuration.ts` 给出 `连续持有 X天X小时` / `至少 X（首次观察）` / `未知`，key 含 environment+account+symbol+side+cycle；PositionsView / HumanManagedView / PositionConsole（移动端卡片）/ 持仓详情统一显示，并附 `openedAt/source、last add time、last review time、human handoff time`；`executionTruthProjection` 把笼统 HEALTHY/SETTLED 拆成 exchange ingestion、order terminal parity、exit claim convergence、TP coverage、position coverage、fill-cycle conservation、funding coverage、review authority 八项，活动委托四分（remote-confirmed Entry / remote-confirmed TP / manual / local unresolved UNKNOWN），历史 UNKNOWN 不再冒充真实活动委托。

## 5. 与原实施计划不同的设计决定及原因

1. **收敛调度列不 bump `user_version`**：布局以列存在性检查 + `schedulingColumnsPresent` 上报，故意保持 journal 版本不变，使回滚窗口不被关掉。
2. **owner 状态机不放宽**：`HANDOFF_PENDING/HUMAN_MANAGED` 不降级为终态，仅停止新 AI 决策并释放退出权（I01/I06 原语义保持）。
3. **repair 只改派生字段**：不重写金额；周期重定钥匙以 `positionCycleId`（新增列）落地并保留旧 `cycleId` + `repairSource` 标记，旧账目仍可审计，绝不删除。
4. **退出 claim 收敛不自动查交易所**：CLI 不内置签名查询，证据必须来自运维捕获的 bundle；无 bundle 时 45 条 open 任务全部 `KEEP_UNKNOWN`（实测），避免用本地状态自我确认。
5. **资金费改整账户一次读**（原计划逐 symbol）：请求预算是本项目的既有硬约束（R15/R16 史），一次分页更弱耦合且覆盖语义更强。
6. **查询截止而非 watchdog**：修复根因（挂死 await 冻结 `converging`），不新增定时器或自动重启。
7. **守恒标签重定义为一致性判据**：实盘 133 条 OPEN 记录被旧规则误判，噪声会掩埋真实矛盾。

## 6. 历史数据 repair 实际执行范围

工具：`scripts/repair-v396-trading-loop.mjs`（preview 只读、apply 需 `--apply --confirm=TESTNET-REPAIR` 且引擎进程必须已停止；环境非 TESTNET 直接拒绝；无交易所写路径）。审计日志写入 `--out-dir`（本次落在仓库外临时目录，仓库内保留压缩后的决策摘要 `docs/reports/v396-trading-loop-full-implementation-20260929/repair/`）。

在真实 TESTNET 台账（`environment=TESTNET`、`account=binance-primary`、settingsVersion 219）上执行：

| job | preview | apply 实际结果 | 再跑一次 |
| --- | --- | --- | --- |
| `exit-claims` | 163 任务：`CONVERGE_TERMINAL 0 / CONVERGE_NON_TERMINAL 0 / KEEP_UNKNOWN 45 / NO_OP 118` | **0 释放**（`NO_PROVEN_FACT_TO_WRITE`，无被接受的证据 bundle，`APPLIED_WITH_EVIDENCE_ISSUES`） | 同前，幂等 |
| `cycle-backfill` | 4206 fills → 279 物理周期；385 条记录可重定钥匙；53 组持仓仍未闭合 | `POSITION_CYCLE_ASSIGNED 385`（1 个事务，`exchangeWrites 0`） | `superseded 0`（幂等） |
| `conservation-label` | 385 → 386 条记录 | `RELABELLED 385`（仅 `ledgerConservation` 一字段）→ 之后 `CLOSED/CONSERVED 192、OPEN/CONSERVED 158、INCOMPLETE/UNCONSERVED 25、PARTIALLY_CLOSED LEDGER_INCONSISTENT 10 / UNCONSERVED 1、unproven 0` | `alreadyCorrect 386、relabelled 0` |
| 全部 | durable 两份副本 `agreed 386` | `transactions 2`、`exchangeWrites 0`；两份持久副本（`runtime_entities` + `trade_records`）同事务成对写 | 幂等 |

apply 前留一份全量备份：`data/backups/v397-trading-loop-20260929T022759Z/`（在引擎停止之后复制 `zdj-settings.sqlite`、`v396-ownership.sqlite`、`engine-instance.json`；后续每次 apply 之前引擎都处于停止状态，repair 本身按 exact identity 幂等，可重跑）。

## 7. 无法安全 repair 的 UNKNOWN 清单（保留原状）

1. **45–47 条非终态退出任务及其 ACTIVE 数量 claim**：交易所终态未被接受证据证明（bundle 缺失），`terminalUnreleasedClaims=0` 说明没有“终态未释放”堆积，但这些 claim 仍如实占用可减数量。
2. **53 组 `HOLDING_STILL_OPEN_AT_LAST_FILL`**：按成交事实到窗口末尾仍未归零，物理周期边界不可证明 → 不虚构闭合。
3. **10 条 `LEDGER_INCONSISTENT` + 25 条 `INCOMPLETE/UNCONSERVED` + 1 条 `PARTIALLY_CLOSED/UNCONSERVED`**：交易所填充与记录声明状态互相矛盾（含审计点名的 9 条负剩余），只报告不改写。
4. **资金费历史覆盖**：`v396_funding_income` 自本轮才有表，48h 窗口内已拉取 310 行并证明 `coverageComplete=true`、9 条记录 EXACT；其余 **377 条记录 funding 仍为 UNKNOWN**（窗口之外没有可证明的覆盖行）。
5. **83 条历史 UNKNOWN 委托**：保持 `localUnresolvedUnknown=83` 的原标签，不再被算作交易所真实活动委托，也不批量改写。
6. **既有持久行的契约不合规（本轮之前遗留，只读脚本 `v396-durable-schema-roundtrip.mjs` 检出）**：`tpOrders` 288 条 `quantity=0`、`manualOrders` 12 条 `side` 用了 positionSide 词表、`entryIntents` 3 条 `planWarnings=""`。这些 kind 在启动 hydration 时不经 schema 解析，因此不阻塞启动；要改写需要交易所原始数量/方向事实，本轮不做猜测式修复。
7. **`Position.openedAt` 仍为非空整数**（0 表示未证明），未做破坏性 schema 变更。

## 8. targeted / full tests 数量与结果

| 范围 | 结果 |
| --- | --- |
| `@zdj/contracts` + `@zdj/core` | 8 files / 58 tests 通过 |
| `@zdj/dashboard` | 21 files / 110 tests 通过 |
| `@zdj/engine` | 186 files / 1616 tests 通过 |
| **合计** | **215 files / 1784 tests，0 失败** |

针对根因的新增/改写定向套件：`tradingLoopRepair`(24)、`exitConvergenceFairness`(14，含 55 任务尾部饥饿、BR/NEAR/WLD 审计形状回放、挂死查询截止)、`positionCycleLotAccounting`(20)、`entrySubmissionIdentity.integration`(9，真实 SQLite 唯一索引/重启二次 open)、`entryPermissionModel`(14)、`exitFactsAndFunding`(18)、`ExternalTradeAdapterFunding`(6)、`api/executionTruthSplit`(5)、`api/positionCycleSnapshot`(1)、`tpGuardianEconomics`(13，含“写入的行必须能过 PositionSchema”)、改写 `j1ExitTruthHostile`/`c3RuntimeWiringHostile`（拒绝原因变具体但保留安全断言）、`grossRiskCapacityVisibility`（$0≠无判决）。

## 9. typecheck / build / verify / S00 / storage / diff

- `npm run verify`（`verify:deps` → `verify:scripts` → `typecheck` → `build` → 全 workspace `test`）：**exit 0**
- `npx tsc -p apps/engine/tsconfig.json --noEmit`、contracts/core/dashboard `vue-tsc`：**无 error**
- `npm run build`：contracts/core/engine/dashboard 全部成功
- `node scripts/v396-s00-build-entry-review.mjs` + `node scripts/v396-s00-static-check.mjs`：`entryCount 143`（新增脚本已重新生成入册），`blockers: []`，`engineTestIsolation{testFiles 186, openingAStore 18+, everyStoreOpeningTestIsolated true, repositoryDataDirReferences 0, productionPortReferences 0}`
- `node scripts/v396-storage-coverage.mjs --check`：`STORAGE_COVERAGE_CHECK_PASS gate=S08_STORAGE_COVERAGE_PASS`
- `git diff --check`：clean（仅有 LF→CRLF 提示，非空白错误）
- `node scripts/v396-durable-schema-roundtrip.mjs`：positions / entryOrders / tradeRecords / trade_records / executionFills **0 invalid**；遗留行见 §7.6（脚本因此 `DURABLE_SCHEMA_MISMATCH`，属如实上报而非掩盖）
- `node scripts/v396-governance-closeout-verify.mjs`：`authorityStatus MATCHED`、`profileStatus READY`、marginTier 71 覆盖、7 个候选未覆盖（ARBUSDC/AVAXUSDC/BCHUSDC/BNBUSDT/ENAUSDC/LTCUSDC/ZECUSDC，按名拒绝，模型调用前拦截）

## 10. TESTNET runtime identity

- 最终运行实例：`pid=37624`，`buildId=3.9.6-6f186489834dfa4acc73`，`restartCount=204`（会话开始时为 194，本轮 +10 次进程启动），`startReason=MANUAL_START`
- 全部为人工 `scripts/stop-zdj-lan.ps1` + `scripts/start-zdj-lan.ps1`；未安装 watchdog/autostart/守护进程，未出现自动重启（今日 10 次 PROCESS_START 中含 1 次因 §11 所述枚举缺失导致的启动失败，修复后重新加载）
- 备份：`data/backups/v397-trading-loop-20260929T022759Z/`（stop 之后复制，含两份 SQLite + 实例身份文件）
- push 后执行 `node scripts/v396-g1-g4-identity-closure.mjs` → **verdict `IDENTITY_CLOSED`**，六项全 true：`remoteHeadEqualsLocalHead`、`committedSourceTreeMatchesRuntimeSourceHash`（sourceHash `35021327184b6753…`）、`workingDistMatchesRuntimeArtifactHash`（artifactHash `6f186489834dfa4a…`）、`buildIdDerivedFromArtifactHash`、`runtimeApiMatchesInstanceFile`、`sourceTreeCleanForHashedFolders` —— 正在运行的 TESTNET 实例就是已推送的这份源码。

## 11. 运行 readback 与自然证据

**加载新代码后的权威 readback（`/snapshot`、`/pipeline`、`/diagnostics/entry-permission`）**

```
exitConvergence  openTasks 47 eligibleNow 39 neverPolled 0 terminalUnreleasedClaims 0
                 batch 8 interval 120000 maxService 720000 rounds 6
                 fairness PERSISTED_ROUND_ROBIN_NEXT_ELIGIBLE_THEN_LAST_ATTEMPT
                 passGate {due:false,reason:"CONVERGENCE_NOT_DUE"}  最近一次轮询 = 32s 前
executionTruth   exchangeIngestion HEALTHY · orderTerminalParity HEALTHY(mismatch 0)
                 exitClaimConvergence 见上 · takeProfitCoverage required 52 / protected 51 / missing 1 / unresolved 0
                 positionCoverage local 52 = remote 52（实例内首轮对账后）
                 fillCycleConservation conserved 350（open 158 / closed 192）inconsistent 10 unconserved 26 unproven 0
                 fundingCoverage HEALTHY incomeRows 310 coverageComplete true · 9 EXACT / 377 UNKNOWN
                 reviewAuthority DISABLED（positionReviewEnabled=false，见 §13）
activeCommissions remoteEntry 0 · remoteTP 51 · manual 0 · localUnresolvedUnknown 83
admission         status NOT_APPLICABLE · ceilingUsdBySide null · enforced false
entry-permission  mode {TESTNET, TESTNET_ENABLED, fundsOnly true}; USDT 可执行 4007.10 / USDC 4963.35
                  observation {riskStage OBSERVED, basis TESTNET_FUNDS_ONLY_OBSERVATION, enforced false}
                  positionCount {used 55, max 50, enforced false}
capacityVisibility policy {gross OBSERVE, direction OBSERVE, cluster OBSERVE}（OBSERVE 仅展示，不否决）
tp 目标 provenance 实例：1 条仓位带 `TP_LOW_NET_TARGET_KEPT` + economicWarning + targetProvenance
order provenance  `v396_order_provenance` 0 → 48 行（EXIT 45 / TP 3），退出成交出处不再是 UNPROVEN 前缀推断
repair readback    见 §6（幂等、0 交易所写）
```

**自然 TESTNET 证据（本轮真实发生的）**
- 收敛轮转（今日 00:00Z 起累计，含本轮各次加载前后）：`EXIT_TASK_CONVERGED` 808 次（`EXCHANGE_FACT_WORKING` 806、`EXCHANGE_FACT_FILLED` 2）、`EXIT_CONVERGENCE_QUEUE` 28 次、`EXIT_RECOVERY_CONVERGED` 8 次；连续 20 分钟窗口内即有 160 次收敛。
- 队列健康度轨迹：首次加载时 46 条任务 `neverPolled`、最久未轮询按纪元计（1.79e12 ms，读数无意义）；修正后 `neverPolled=0`、最近一轮轮询距今 32 s，最久等待回落到 0.95M ms（约 16 分钟，受本窗口私有请求超时影响，见 §13.5）；`terminalUnreleasedClaims` 全程为 0，open 任务 52 → 45/47。
- TP 保护：`required 52 / protected 49 → 51 / missing 3 → 1`，`retryQueue` 归零；审计点名的 BR/NEAR/WLD 中，NEAR/WLD 的 `TP_MANUAL_REVIEW_REQUIRED: TP_EXIT_CLIENT_ORDER_ID_MISSING: QUANTITY_BUDGET_EXCEEDED`（attempt 25）正是陈旧 ACTIVE claim 的形状，claim 随终态事实释放后可重新维护。
- `NEARUSDT SHORT / WLDUSDT SHORT` 保持 `HUMAN_MANAGED`、`BTCUSDT SHORT` 为 `AUTO_MANAGED + PENDING`：AI 未自动接管任何人工处置位（`reviewAuthority.aiActiveCycles` 与 ownership 读回一致）。
- Entry 真实链路（30 分钟窗口）：primaryCompleted 16 → place 16 → tradePlanReady 15 → reservation 15 → intent 15 → submitAttempted 5 → orderSubmitted 4 → entryFilled 2；`riskAllowed` 阶段语义 `NOT_REQUIRED`、经济地板 `OBSERVED`（funds-only 正确降级）。
- 真实拒绝仍然生效（未被本轮放宽）：`CANDIDATE_QUANTITY_BELOW_LEGAL_MINIMUM:units=258<259`（交易所最小名义）、`JIT_BLOCKED:MARKET_DATA_STALE`、`JIT_BLOCKED:MARKET_QUALITY_NOT_ADMITTED`、`AI_AUTHORIZATION_EXPIRED`、`RESERVATION_INVALID`、`eligibility DATA_ERROR: QUOTE_STALE → disposition WAIT`。
- 退出事实链的具名拒绝：今日 `AI_EXIT_FACTS_INCOMPLETE` 6155 次；实测 20 分钟窗口内 1040 次，blockers 计数 `FUNDING_ATTRIBUTION_UNKNOWN 332 / EXIT_DEPTH_INSUFFICIENT 252 / EXIT_DEPTH_UNPROVEN:ORDER_BOOK_ABSENT 80 / PROJECTED_EXIT_UNPRICED 80 / QUOTE_NOT_YET_AVAILABLE 80 / STEP_SIZE_INVALID 80 …`——即“缺事实就 BLOCKED_FACTS”，绝不写零。
- 自然成交侧：今日新增 fills 22 笔（Entry 与退出混合），但**没有新的 CLOSED 记录**（`closedAt>=00:00Z` 计数 0），也没有自然 AI 退出下单（权威为 SHADOW）；2 次 `EXCHANGE_FACT_FILLED` 证明退出终态确实经 reducer 落账。按任务书要求，闭合/终态路径改由 `exitConvergenceFairness`、`positionCycleLotAccounting`、`entrySubmissionIdentity.integration`、`tradingLoopRepair` 等确定性 replay/integration 证据证明，自然观察如实记录为“窗口内未发生”。

**本轮运行核验期间发现并当场修掉的三个部署级缺陷**（都属于“测试全绿但实盘加载即坏”）
1. `efe59c1` 迁移后 `entry_execution_scope` 索引在第二次 open 复活 → 引擎启动即崩（真实 TESTNET 数据确有 3 组同 scope 多行 ACTIVE：TUT/WLD/ZRO）。
2. `e949d27` `TP_LOW_NET_TARGET_KEPT` 未进 PositionSchema → 新 build 启动时解析 positions 直接抛错退出。
3. `b489865`/`2a64977` 一次挂死的签名查询把 `converging` 永久置真 → 47 条任务的 `last_attempt_at` 冻结 39 分钟无任何事件；补查询截止与轮内 passGate。

## 12. Production writes = 0 的确认

- 全程 `productionWriteBoundary`：`{environment TESTNET, executionMode TESTNET_ENABLED, lockedToTestnet true, testnetWrites ≤ 自然建仓, productionWrites 0, blockedProductionWriteAttempts 0}`；`/diagnostics/closeout` 与本轮所有 readback 采样均为 **productionWrites: 0**。
- 没有对 Production 数据目录、Production store 或 Production 凭证做过任何读写；repair/preview/apply 全部指向 `data/`（TESTNET 实例目录），并在环境不为 `TESTNET` 时以 `PRODUCTION_OR_UNKNOWN_ENVIRONMENT_IS_NEVER_REPAIRED` 拒绝（`repair-v396-trading-loop.mjs`）。
- repair 与只读脚本的 `exchangeWrites: 0` 字段由审计日志逐条记录；repair apply 只写本地两份持久副本 + `runtime_events` 审计行。
- 本轮未安装任何 autostart/watchdog/服务/启动项；引擎仅在人工许可的 TESTNET 加载窗口被 stop/start。

## 13. 当前仍存在的已知限制

1. **AI 退出权威仍为 SHADOW，AI exit 不会真实下单**；`ENFORCE` 路径由单元/集成证据证明，运行期未自然产生 AI 退出成交。
2. **`positionReviewEnabled=false`**：Review tick 在本实例配置下不运行，`reviewAuthority=DISABLED`，因此“Review 不被 Entry 饿死”只有 `aiFabric.reviewFairness` + 单测证据与 readback 字段（`reviewOwedWaitMs/reviewCapacitySharePercent/heldForReview`），没有自然 serve 样本。
3. **资金费历史不可追证**：48h 窗口外没有 income 覆盖，377 条记录 funding 保持 UNKNOWN；本轮不重拉远端历史，因此不声称已修复“192 条”旧观察。
4. **45–47 条退出任务的 claim 仍未释放**：需要运维提供 exact-order/累积成交证据 bundle 才能 repair（工具按证据规则执行，无 bundle 时如实 KEEP_UNKNOWN）。
5. **私有请求通道在本环境有队列超时**（`BINANCE_REQUEST_QUEUE_TIMEOUT` 出现在 `TRADE_AUDIT_USER_TRADES` 探测中），导致部分窗口内 exact-order 查询超时退避、`oldestUnpolledAgeMs` 一度超过 `2×maxServiceIntervalMs` 而显示 DEGRADED；这是环境观察，不是收敛逻辑的失败，且现在有截止与 passGate 可见。
6. **行情新鲜度窗口敏感**：`MARKET_QUOTES_STALE / MARKET_TECHNICAL_STALE` 会令 Entry 暂停（`SCHEDULER_STOPPED/PERMISSION`），`positionCoverage` 在实例首轮对账前显示 UNKNOWN。
7. **margin-tier 覆盖缺 7 个候选**（ARBUSDC 等）：仍按名拒绝，不阻塞其余路由；需再采集并提交权威数据集。
8. **`v396_order_provenance` 只覆盖本轮之后被证明的订单**：历史 4211 条 fills 的 `provenanceSource/fillRole` 仍为空（诚实为空，不回填伪造出处）。
9. **遗留持久行不合规**（§7.6）与 `Position.openedAt=0` 语义未做破坏性迁移。
10. **版本标签**：`package.json` 仍为 `3.9.6`，本轮按任务书命名（v396 trading-loop）实施，未改版本号以免扰动 buildId 身份链。

## 14. 最终 GitHub commit SHA

- 代码链最后一个提交：`2a64977` fix(v396): 收敛轮次状态在轮询前后都可见，单次查询截止取间隔一半
- 本报告提交：`61cc97d86e53c5501e4e7824ce15f4152939133a`，已 push，push 时 `origin/main == HEAD == 61cc97d8…`
- 记录本节的纯文档提交（`docs(v396): 记录最终 SHA 与身份闭合判定`）是本轮最后一次提交；其 SHA 由 `git log -1` / `git rev-parse HEAD origin/main` 现场核对。文档提交不改动参与身份哈希的源码目录（`apps/*/src`、`packages/*/src`），因此 §10 的 `IDENTITY_CLOSED` 判定继续成立。

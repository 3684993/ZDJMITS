# V3.9.6 Testnet 切换报告：在 D 段被真实 P0 中止（2026-09-23）

按 [CODEX-V395-AUDIT-TO-V396-TESTNET-CUTOVER-20260923](../plans/v396/CODEX-V395-AUDIT-TO-V396-TESTNET-CUTOVER-20260923.md) 执行。**最终状态：A/B/C 完成，D 段失败，E/F/G 未执行。** 授权文件第 5 条要求在切换阶段遇到真实 P0/P1 时立即停止后续步骤并保留现场，本报告即为该停止线的应用；不得以放宽阈值、删断言、补默认事实或反复重启换取 PASS——本轮四项均未做。

裁决：**V3.9.6 不得进入 E 段有限写回合；本次切换判定 FAIL（P0）。** 不签 `ACCEPTED`，不称 `READY`。

## 1. V3.9.5 最近 10 小时运行与交易摘要

见 [v395-runtime-audit-20260923](./v395-runtime-audit-20260923.md)。要点：窗口 21:33→07:33 内 PRIMARY 完成 130 / 失败 5、SCOUT 完成 136；开仓 5、平仓 14（合计 tradingNetPnlExFunding **+27.2714 USDT**，费用 0.2750 USDT，**funding = INSUFFICIENT_EVIDENCE**，14/14 记录 `fundingAttributionStatus=UNKNOWN`，不填 0）；持仓 38→29，浮亏 **−915.37 USDT**，27 笔已转人工、2 笔 AUTO_MANAGED，29/29 由交易所侧 `WORKING` 止盈单保护；46 笔 UNKNOWN 全部 `VERIFIED_NO_ACTIVE_RISK`，无换新 ID 重发。

## 2. 04:55:28 之后 AI 停止分析的根因

`CONFIRMED`：**AI 之前的资金/风险容量闸把每个候选都判为不可执行**。29 笔存量持仓名义敞口 10,724.70 USDT 超过 `equity × maxGrossExposurePct(1.0)` = 10,412.13，`remaining.gross = 0`、`directionBudget` 三项皆 0；`capitalExecutableCount` 自 04:54:53 起连续 156.9 分钟为 0；窗口内 61 次候选拒绝理由 100% 为 `REJECT_GROSS_EXPOSURE`。派发链本身存活（shadow 采样 20 s 内 +29；13 个池成员被 `refreshReadyView` 持续降为 `WAITING`）。模型 ONLINE、私有账户 READY、行情 FRESH、无队列/冷却/隔离/预算阻断、事件循环正常 → 逐项 `RULED_OUT`。放大因素：敞口上限按权益动态计算，AVAX/ZEC 两笔空头深亏（−143% / −158% 保证金）压低了上限。证据等级与逐假设裁决见 `v395-10h-audit/ai-silence-verdict.json`。

## 3. 驾驶舱是否把异常静默显示成正常无机会

是，且是**结构性**的：`runtimeControlService.ts:128` 仅在 `slots.used>=slots.max`（29<50 不成立）时换成容量文案，否则一律"持续扫描中：当前没有合格可执行机会"；`aiResourceHealth.ts:29-32` 的 `DEGRADED_UNEXPLAINED_IDLE` 需要 `executableCandidates>0`，而那正是被卡住的项，所以任意长的 AI 静默都判为健康 `READY / IDLE_NO_DISPATCHABLE_CANDIDATE`。>30 分钟告警所需事实（`lastRunAgeMs`、`AI_RUN_TERMINAL`、`riskHeadroom.remaining`、`directionBudget`）**已存在**，缺的是解耦判定与"无候选 / 被规则筛除 / 容量阻断 / 调度停滞 / 模型不可达"五态区分。本轮未临时伪造任何告警事件。

## 4. V3.9.5 停止时间与 PID

人工 `scripts/stop-zdj-lan.ps1`，PID **10540**（实例 `939b2020`，3.9.5 / buildId `3.9.5-8b7cc98ccaaa6c06456c`，连续运行 67.87 h），端口 8080 释放并复验 0 监听、0 个 `dist/main.js` 进程；未安装任何自启动或看门狗。详见 `runtime-cutover-20260923/lifecycle.json`。

## 5. 迁移演练与当前 Testnet 数据迁移判定

- **C1 隔离副本演练：PASS**（runbook 七步全绿：preview 不写且 `wouldMutateExisting=0`；备份逐表指纹与源完全相等、`integrity_check=ok`；apply；readback `missing=[]`；restore 逐字节一致；重跑 `created=0/preserved=29`；新版本账本被旧运行时以 `OWNERSHIP_SCHEMA_NEWER_THAN_RUNTIME` 拒绝且未写 DDL）。
- **C2 当前 Testnet 数据迁移：PASS**。`D:/MITS/data/v396-ownership.sqlite` 入账 29 个周期：**27 HUMAN_MANAGED + 2 HANDOFF_PENDING + 0 AI_ACTIVE**，未伪造任何 quantity claim / mandate（0 行），readback 无缺失；settings 库逐表指纹与 `settingsVersion` 在迁移中保持不变（32 表 / 116,149 行，188→188）。
- D0 启动档位经 `SettingsStore.saveIfVersion` CAS 写入（189→190），变更路径只有 `riskGovernance.exitCoordination.aiExitAuthority: OFF→SHADOW`；限额与损失权限线未放宽（`maxGrossExposurePct=1`、`maxPositions=50`、`aiExitLossLimitUsd=10`、`aiExitMinNetProfitUsd=0.2`、`aiExitAllowSmallLoss=false`）。

## 6. V3.9.6 启动版本 / commit / PID / 档位

构建自收敛分支 `1e97b69`，`npm run verify` 退出码 0（deps+scripts+typecheck+build+test；四个包均 3.9.6，engine 149 文件 / 1,135 测试通过，core 8、dashboard 9 文件通过）。启动方式 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`，**PID 29340**，实例 `a9c88bb1`，`version 3.9.6` / `apiVersion V3.9.6` / `buildId 3.9.6-fe1c9ae7ce59ad675e10`。档位实读：TESTNET + `executionMode=READ_ONLY` + `aiExitAuthority=SHADOW` + `positionReviewEnabled=false` + `tradeEconomics.admissionMode=SHADOW`，`settingsVersion=190`。

## 7. SHADOW 写请求计数与关键事件计数

**`NOT_RUN`（不得写成 PASS）。** 进程在启动后 **199.2 秒**（08:04:21→08:07:41）致命退出，未形成可评估的 SHADOW 观察窗。可确证的是：整个窗口 `executionMode=READ_ONLY`、`aiExitAuthority=SHADOW`，**生产写入次数 0，Testnet 交易所写入次数 0**（无任何 `ENTRY_SUBMIT_ATTEMPTED`/下单类事件产生于 V3.9.6 运行期）。窗口内事件总量 46 条，主要为 `CANDIDATE_LIFECYCLE_REDERIVED`(7)、`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`(22)、`ENTRY_ORDER_HISTORICAL_VERIFY_FAILED`(3)。D1 要求的事件计数（`AI_EXIT_SHADOW_DECISION`、`AI_MANAGEMENT_DEADLINE_FIXED`、`POSITION_FACT_UNVERIFIED`、`RISK_*`、`TRADE_PLAN_PERSISTED`、台账 `usageStatus=UNKNOWN` 比例）全部 **NOT_RUN**。

## 8. 有限 Testnet 写链证据

未执行（E 段被 P0 阻断）。既非 `TESTNET_WRITE_NOT_EXERCISED_NO_ADMISSIBLE_CANDIDATE`，也非 PASS——状态为 `NOT_RUN_BLOCKED_BY_P0`。

## 9. P0 / P1 / P2

**P0（V3.9.6 新代码缺陷，本次切换失败的唯一直接原因）**

启动后 199 s 致命退出：`uncaughtException ← ZodError`，10 条违规路径全部是 `positions[i].notionalUsd`，恰好对应 10 笔 SHORT 持仓。

- 冲突点：`packages/contracts/src/trading.ts:125` 声明 `notionalUsd: z.number().nonnegative().nullable()`，而 V3.9.6 的私有账户同步把**带符号**名义值写进持仓行（实测 29/29 现在带该字段，10 笔 SHORT 为负，例：AVAXUSDT SHORT `notionalUsd=-4516.2005` 而 `|qty|×mark=4516.20`；LONG 全为正，无一反例）。停机前这些字段不存在——即矛盾由 V3.9.6 引入，不是迁移带入。
- 抛出点：`apps/engine/src/api/projections.ts:128` 的 `DashboardSnapshotSchema.parse({... positions: [...s.positions.values()] ...})`（:189 原样透传）。
- 自触发：`apps/engine/src/api/router.ts:34-35` 在建路由时立即 `publishSnapshot()`，并在**每条运行时事件后 250 ms** 去抖再跑一次。因此该崩溃不需要任何操作员请求，只要存在一笔空头持仓即确定性复现。
- 后果放大：`apps/engine/src/main.ts:33` 的 `uncaughtException` 处理器按 fail-closed 设计直接 `shutdown(UNCAUGHT_EXCEPTION, exitCode 1)`，于是**一个只读投影的字段语义分歧足以杀死整个引擎**。
- 语义问题未解决：`notionalUsd` 到底表示"带方向的风险敞口"还是"无向幅度"，仓库内两种用法并存。修复必须先做语义裁决（含 J2 组合敞口求和是否会因符号而互相抵消），不得简单把 `.nonnegative()` 改成允许负数来换取启动。

**P1**
- V3.9.5：AI 空闲告警与 `executableCandidates>0` 耦合 + 文案不分"敞口耗尽/无机会/分析链停摆"（见 §3 与审计报告 P1-1）。
- V3.9.5：窗口内 5/135 次 PRIMARY 分析因 `AI_OUTPUT_INVALID: output token limit reached` 作废。
- V3.9.6 测试缺口：1,135 个测试全绿却漏掉"含空头持仓的运行时状态能否通过仪表盘快照契约"。说明投影层缺少以真实持久化形态（带符号 notional）为输入的用例，绿灯不代表契约与生产者一致。

**P2**：归因口径不一致（`rootBlocker` / `blockerCategories` / `reasonCounts` 三套答案）、派发 tick 无心跳字段、`activeRiskUnresolved` 因证据 TTL 在 10 分钟内取值 0/1/2 使单点门禁不稳定、UNKNOWN 5 来源重审产生 879 条窗口内事件、1 次 `ORPHAN_TP_CANCEL_FAILED` 已自愈、funding 全缺、V3.9.5 构建产物在文件层不可复现（仅 dashboard dist 在启动后被重建）。

## 10. 当前 Engine 是否在运行，24h soak 起点

**没有 Engine 在运行**：8080 监听数 0，无 `dist/main.js` 进程，V3.9.5 未被自动恢复，V3.9.6 未被反复重启（仅授权的那一次启动）。24h soak **未开始**，无起点可记，状态 `NOT_RUN`；`PENDING_WINDOW_INCOMPLETE` 都不适用，因为连窗口都未建立。

停机期间的风险：29 笔 Testnet 持仓的止盈单在停机时全部为交易所侧 `WORKING`，不依赖引擎存活；46 笔 UNKNOWN 均为已验证无活跃风险；账户不再被主动管理（新候选、复核、TP 修复、私有账户刷新均停止）。这是 Testnet 环境，风险限于演示资金。

## 11. 生产写入确认

**生产环境交易所写入次数：0。** 全程 environment=TESTNET、REST `demo-fapi.binance.com`、WS `stream.binancefuture.com`、`credentialRef=binance-primary`、`executionMode` 在 V3.9.6 运行期为 `READ_ONLY`；未使用任何生产端点，未启用生产写能力。Engine 生命周期动作只有两次且均在本授权范围内：停止 V3.9.5（PID 10540）、启动 V3.9.6（PID 29340）。未安装自启动/看门狗，未做热重载，未 `watch`。

## 需要用户裁决的下一步（本轮不自行执行）

1. 是否授权我修 V3.9.6 的 notional 语义冲突（需先裁决"带符号 vs 无向幅度"并同步 J2 敞口求和、契约与投影三处，再补一条以真实持久化空头为输入的红测），修完重新走门禁后再申请第二次启动；
2. 或者先回滚到 V3.9.5（冷镜像 `D:/MITS-backups/cutover-20260923/cold/zdj-settings.sqlite`，settingsVersion 189，sha256 前缀 `88c8ed2e…`）——注意回滚会丢弃已生成的 `v396-ownership.sqlite` 与 189→190 的档位变更，且需要一次新的启动授权；
3. 或者保持现状（引擎停止、持仓由交易所侧止盈单保护）等待进一步指示。

现场已完整保留：`data/runtime-logs/engine-process-lifecycle.jsonl`、`zdj-settings.sqlite` 中的 `ENGINE_FATAL_ERROR`、`phase-d-incident/crash-forensics.json`。

---

# 追加：D 段第二次启动结果（2026-09-23 10:04 起，用户新授权）

修复 `eaf0382` 后按新授权单独启动一次（PID 51008）。

**P0 已在真实路径确认修复**：进程越过上次 199 秒死亡点，7.0 分钟时 `status=READY`，本轮 `ENGINE_FATAL_ERROR` 计数 **0**；启动后持仓 28 条全部带 `notionalUsd` 且**负值 0 条**（原为 10 条），`quantity`/`side` 不变。

**D1 判据通过**：`productionWriteBoundary = { environment: TESTNET, executionMode: READ_ONLY, lockedToTestnet: true, testnetWrites: 0, productionWrites: 0, blockedProductionWriteAttempts: 0, lastWriteAt: null }`，且自启动起订单生命周期类事件计数 **0**。SHADOW 事件：`AI_EXIT_PLAN_UNPROVEN` 336、`AI_MANAGEMENT_DEADLINE_FIXED` 28、`V396_OWNERSHIP_OUTBOX` 105（全部 delivered），`AI_EXIT_SHADOW_DECISION` / `TRADE_PLAN_PERSISTED` / `POSITION_FACT_UNVERIFIED` / `RISK_*` 均为 0——因为敞口上限仍使 `capitalExecutableCount=0`，AI 未被派发，没有可影子决策的提案（`lastRunAge` 已 318 分钟，驾驶舱仍显示"持续扫描中：当前没有合格可执行机会"，P1-1 在 V3.9.6 上同样成立）。

## 新发现 P1：所有权 scope 键与运行时不一致（由我在 C2 引入）

账本现有 **57 行 / 29 个周期**，其中 **28 个周期各有 2 条所有权行，6 个周期同时主张 `HUMAN_MANAGED` 与 `AI_ACTIVE`**：

| scope 第四元 × ownerState | 行数 |
|---|---:|
| `ENTRY × HUMAN_MANAGED` | 27 |
| `ENTRY × HANDOFF_PENDING` | 2 |
| `LONG × HANDOFF_PENDING` | 11 |
| `SHORT × HANDOFF_PENDING` | 10 |
| `LONG × AI_ACTIVE` | 7 |

机制：我在 C2 用 `executionScope(env, cred, SYMBOL, 'ENTRY')` 生成迁移主体，而运行时按 `ownershipRuntime.ts:35` 的 `subject.positionSide`（LONG/SHORT）推导 scope。两把键永不相撞，所以运行时看不到任何迁移结果，转而从首次成交重新初始化所有权（`reason: FIRST_FILL_PLAN`，`transitionedAt` 等于持仓开仓时刻，带 `plan:cycle_*` 与约 48 小时期限）。讽刺的是 `executionLifecycle.ts:10-13` 的注释正是在警告这件事："改了键会静默孤立所有已占用的 claim"——我从反方向踩中了它。

C2 当时报告的"0 个 AI_ACTIVE、27 个 HUMAN_MANAGED 保持"并非虚假：它在**迁移自己写入的那把键**上确实成立。它没有、也不可能检测到运行时会用另一把键重建权威，所以我把该不变式的验证做窄了，这是我在 C 段判断上的失误，不是数据被篡改。

后果边界：`READ_ONLY` 下没有发生任何交易所写入，错误权威目前未变成实际动作；但一旦把 `aiExitAuthority` 切到 `ENFORCE`，这 7 条 `AI_ACTIVE` 就会对 6 笔人工持仓给出 AI 退出权威，直接违反"HUMAN_MANAGED 不得回到 AI_ACTIVE"。因此按停止线与 H-AUTHORITY（SHADOW / Testnet 执行 / 实盘是独立权限，前一层通过不自动解锁后一层），**E 段不执行**。

另一个需知晓的后果：`READ_ONLY` 同时意味着引擎无法补挂失效的止盈单，当前保护依赖切换前已存在的 28 张交易所侧 `WORKING` 单（停机期间有 1 笔持仓已平掉，29→28）。

证据：`phase-d-shadow/ownership-scope-divergence.json`。

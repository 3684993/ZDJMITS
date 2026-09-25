# V3.9.6 Testnet：资金容量解耦 + 历史 UNKNOWN 收敛 + 驾驶舱真值统一（2026-09-25）

最终状态：`V396_TESTNET_ACTIVE_EXECUTION_CAPACITY_MODEL_CLOSED`

容量模型、UNKNOWN 占用单一真源与驾驶舱四块真值已在 Engine 与在线 Testnet 同时闭合；两处仍属"需要更长
自然窗口"的观察项（§7 第 8 条：重启窗口内尚无新的自然提交，`ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED`
尚未在线上出现）在本报告中按原样标出，不折算成已通过。

计划：`docs/plans/v396/CODEX-V396-CAPITAL-CAPACITY-UNKNOWN-CONVERGENCE-20260925.md`
提交：`c2d3022`（§A/§B2 证据）→ `daf7149`（§B3 修复）→ `fa9a721`（§C/§D 模型）→ `54ebc96`（部署与迁移证据）
证据目录：`docs/evidence/v396/capital-capacity-unknown-convergence-20260925/`
运行身份：部署前 pid 39252 / buildId `3.9.6-e802da247ee8e861e1c4` / instanceId ffcc26bb / restartCount 184；
部署后 pid 36780 / buildId `3.9.6-169693874541082bb325` / instanceId 1ffc6b98 / restartCount 185 / MANUAL_START。
Production 写：`productionWrites=0`，`blockedProductionWriteAttempts=0`（部署后每次采样均为 0）。

---

## 1. §A 冻结基线（09:40 采集，之后未再修改）

| 项 | 值 |
| --- | --- |
| settingsVersion | 213 |
| 权限 | TESTNET / TESTNET_ENABLED / entrySafety AUTO / aiExitAuthority SHADOW |
| 写边界 | productionWrites 0，blockedProductionWriteAttempts 0 |
| equity | 10,728.748015 |
| USDT | 钱包 5,473.133262 / 可用 3,861.560262（marginEligible） |
| USDC | 钱包 4,981.175512 / 可用 4,972.875697（marginEligible） |
| BTC | 0.01（847.129，marginEligible，非计价资产） |
| 仓位 | 持仓 17 / 在途 0 / 预留 0，maxPositions 50 |
| entryOrders | 525（FILLED 208 / CANCELED 161 / UNKNOWN 47 / REJECTED 109） |
| 组合名义 | gross 10,820.94，LONG 3,675.88 / SHORT 7,145.06 |
| caps | gross 1、direction 1、cluster 0.35、clusterDirection 0.35、perTrade 0.01、maxConcurrentReservations 6、drawdown 0.05、minNetProfit `$1`/`0.15`、admissionMode SHADOW、globalMaxLeverage 20 |
| PortfolioRisk | READY，version `v396r2dc9bae…`（maxGrossNotionalUsd 10,811.957、maxDirectionNotionalUsd 8,649.565） |
| 容量投影 | remainingGross 0、usedPct 1.0086、firstBlocker GROSS、exhaustedForNewRisk true、executableCandidateCount 0 |
| 首因 | `executionReadiness.firstBlocker=NO_EXECUTABLE_CANDIDATE` |

基线文件原先被 node 的 SQLite 实验警告污染了 stdout 前两行，已在 `54ebc96` 中仅剥离警告行恢复为可解析
JSON；身份字段（pid/buildId/instanceId/restartCount）与冻结值逐字一致，事实未重新采集。

`maxDirectionExposurePct` 在基线里已经是 1（0.8 是 settingsVersion 207 的旧值，由 00:38–01:29 的
`api`/`cas` 写入变更）。本轮没有、也不会去"修正"它。

## 2. §B2 历史 UNKNOWN 分桶（47 条，7 天窗口）

用 `entryRiskOccupancy` 自己的谓词分桶（不重新推导证明是否完整），并从事件流按
`[evidence.checkedAt, evidence.validUntil]` 重建每条行的证明窗口时间线：

| 桶 | 行数 | 7 天 pending 阻断 | 说明 |
| --- | --- | --- | --- |
| A | 33 | 0 | 全源 `VERIFIED_NO_ACTIVE_RISK` 且未过期，当前不占 pending；16,731 次审计事件 |
| B | 3 | 5 | 阻断落在两次证明之间的空隙（续证晚于窗口关闭） |
| C | 0 | 0 | 交易所给出正向风险事实 / 身份不符 / 完全无证明 |
| D | 0 | 0 | 真实在途或已有成交 |
| E | 11 | 44（其中 29 次在**自己未过期的证明窗口内**） | 已被证明确实无活动风险，仍被写回占用 |

- 当前时刻占用 pending 的行数：0（冻结时为 1，说明占用在反复抖动）。
- TTL 分布：5 min ×1、15 min ×2、30 min ×44；7 天内 21,465 个证明窗口，其中 **344 个被一次"不确定复探"
  打断**；4,393 次窗口衔接是晚于上一窗口关闭才续上（最大迟到 10,629 s）。
- 事件量：`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 23,645（55 行）、`POSITION_ATTRIBUTION_UNRESOLVED` 36/17、
  `NO_ACTIVE_RISK_EVIDENCE_FAILED` 102/36、`ACTIVE_RESTORED` 68/59。

根因（单一位置，`reconciliationService.ts` 的"证据不确定"分支）：该分支把行写回
`activeRiskExposure=true`、`activeRiskEvidence=`（本趟循环早先捕获的旧副本里的）旧证据、并把审计层级重置
为 0，且用的是 pass 开始时固定的 `now`。因此在两种情况下都会撤销一份仍然有效的证明：

1. 复探本身什么都没看到（覆盖不完整 / 请求失败），但旧证明窗口尚未过期；
2. 等待交易所期间另一个 pass 已经写入新证明，本趟用旧副本回写把它抹掉（丢更新）。

APTUSDT `entry_intent_mu5xqmou_9hr5l6ur` 的原始 8 行时间线（`unknown-proof-invalidation-timeline-APTUSDT.txt`）
把第 2 种情况写得很清楚：17:05:53 rel=false → 17:06:13 rel=true 新证明（17:06:08→17:11:08）→
17:06:41 rel=false 且回显的是 16:35:42→17:05:42 这份**早已过期**的旧证据 → 17:06:43 准入阻断
`PENDING_RISK_UNVERIFIED:order:entry_intent_mu5xqmou_9hr5l6ur`。

## 3. §B3 修复：确定性的无活动风险续证与单一占用真源

新增 `retainedNoActiveRiskProof(order, inconclusiveBecause, now)`（`entryRiskOccupancy.ts`）作为所有
"把 UNKNOWN 写回占用"的必经规则；`noActiveRiskEvidence` 除证据外还必须报告它为什么没证明出来。

占用判定现在只对"交易所确实没给出新信息"保留证据：

- 可保留：`RISK_FACT_COVERAGE_INCOMPLETE`、`RISK_FACT_READER_FAILED`；
- 必须立即失效并 fail-closed：`ALL_ORDERS_IDENTITY_PRESENT`、`USER_TRADES_IDENTITY_PRESENT`、
  `POSITION_ATTRIBUTED_TO_ENTRY`、`REMOTE_ORDER_REAPPEARED`，以及 `POSITION_ATTRIBUTION_UNRESOLVED`
  （同一 symbol/side 出现了无法排除归属的持仓 = 新事实，不是"没看到"）；
- 证据自然过期后照常回到占用；写入统一按 `this.state.entryOrders.get(id)` 的**活行**判断并保留
  `tier/consecutive/factHash/verifiedCount`，只把 `nextAuditAt` 重排到最快档（`jitteredNextAuditAt(now, 5 min)`），
  因而续证频率不下降、抖动消失。

durable `status='UNKNOWN'` 一律不改写，不删除，不把 UNKNOWN 当 0；新增事件
`ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED`（经 `shouldEmitNoRiskEvent` 去重）让在线可对账。

测试 `unknownNoActiveRiskProofRenewal.test.ts` NR-01…NR-08：先跑出 5 红 4 绿（绿的正是四条必须继续
fail-closed 的护栏），实现后 9/9 绿。引擎全仓 165→167 files、1315→1330 tests 全绿。

## 4. §C 模型：CapitalCapacity / RiskCapacity / ExecutableEntryCapacity

新模块 `capitalCapacity.ts`：按计价资产给出
`availableBalanceUsd − reservedMarginUsd − executionLeaseMarginUsd = executableMarginUsd`，
再乘该候选**自己已验证的杠杆**（`leverageFact ∈ CANDIDATE_RECOMMENDED / POSITION_RECORDED / POLICY_MAX / UNPROVEN`）
并扣 0.5% 缓冲得到 `executableNotionalUsd`；杠杆不可证 ⇒ 容量不可证（`LEVERAGE_UNPROVEN`），不使用任何全局
假杠杆。路由、pre-AI 包络、preflight、JIT 四处原先各自内联的保证金算式全部删除，改为同一个对象
（`candidateCapitalFromState` / `quoteAssetCapitalLedgers`）。

`ExecutableEntryCapacity = min(CapitalCapacity, RiskCapacity)`，其中 RiskCapacity 继续由
cluster / cluster-direction、per-trade risk、daily drawdown、PortfolioRisk 压力、槽位与全部事实门构成。

§C1 的红测（`capitalCapacityModel.test.ts` CC-01…CC-10）用冻结基线的真实数字钉死：equity 10,728.75、
gross 10,820.94（>1×equity）、可用保证金 3,861.56 + 4,972.88、仓位 17/50、profile READY：
ENFORCE 默认行为逐字保留（`remaining.gross=0`、`REJECT_GROSS_EXPOSURE`、`firstBindingConstraint=GROSS_ENFORCED`），
而 margin-driven 策略下同一事实集不再把容量压成几十美元，并分别命名 AVAILABLE_MARGIN / MARGIN_POLICY_CAP /
LEVERAGE_UNPROVEN / CLUSTER / PER_TRADE_RISK / DAILY_DRAWDOWN / PLANNED_NOTIONAL。

### §C3 OBSERVE / ENFORCE 政策

新增 `riskGovernance.exposureCapacityPolicy.{gross,direction,cluster}`：schema 枚举 + 三项默认
`ENFORCE` + settingsStore 字段级回填 + governance matrix 三行（enum、`effectiveAt=NEXT_ENTRY_CYCLE`、
`ack=EXPOSURE_CAPACITY_OBSERVE` 且仅在 OBSERVE 需要确认）+ `PATCH /settings/governance` 写入 + 设置页三个
独立选择器 + 测试。约束落实方式：

- 默认全部 ENFORCE：既有文档升级后行为不变，Production 未被暗改（`exposureCapacityPolicyMigration.test.ts`
  3 例：无字段→全 ENFORCE；已选 OBSERVE→跨重启保留且比例逐项不变；非法值→拒绝而非默认放开）；
- OBSERVE 只取消该比例的否决权，仍按 `equity × 上限` 计算并展示（`observed.*` / `exposure.*`），
  不改数值、不引入 Infinity；
- Testnet 的迁移是一次经确认位的显式写入：`PATCH /settings/governance` + ack，
  `settingsVersion 214 → 215`，脚本在任一比例发生变化时直接拒绝执行（`ratiosUnchangedByPolicyWrite=true`）。

### §C4 50 个槽位重新有意义

槽位仍是硬上限（`limits.slots`），但在保证金充足时不再被隐含的 `gross ≤ 1×equity` 永远挡在 17。
迁移后在线读回：3 条路由可执行（此前 1 条），LONG 最终可执行新增名义 254.38 且首因已是
`PLANNED_NOTIONAL`（分配器自己的单仓建议规模），不再是 `GROSS_ENFORCED`。

## 5. §D 单一真源与驾驶舱四块

- `directionBudget`：单向余量恢复为**只看该方向上限**（原先 `min(grossAvailable, directionLimit−side)` 会让
  gross 满时 LONG 显示 0），新增 `longUsedPct/shortUsedPct/policy`；gross 余量单列 `remainingGrossUsd`。
  `maxDirectionExposurePct=0.8` 的一致性由新增用例钉住：Engine 计算、`/pipeline` 投影、驾驶舱三处读到的是
  同一个 `equity × 0.8`，gross 上限不再冒充方向上限。
- `portfolioCapacityVisibility(capacity, budget, {funding, routes})` 输出四块：
  1 `funding`（每个计价资产的可用/预留/租约/可执行保证金）、
  2 `exposure`（gross、LONG、SHORT 名义与上限 + `mode`/`enforced`，标题明确写"事实，不等于可用资金"）、
  3 `limits`（槽位 + 三项政策档位）、
  4 `entryCapacity`（LONG/SHORT 最终可执行新增名义、路由 symbol/quoteAsset、**唯一** `firstBindingConstraint`）。
- `firstBlocker` / `exhaustedReason` 变为政策感知：只观测的维度永不成为 blocker；资金耗尽时
  `exhaustedReason=AVAILABLE_MARGIN`，与"名义比例满了"区分开。
- `buildRiskEnvelope` 不再从 `remaining` 自行重推状态（那是第二套真源，会让被观测的维度从另一道门复活成
  一票否决），改为消费同一次 headroom 裁决；新增 `REJECT_AVAILABLE_MARGIN` 状态与 `firstBindingConstraint`。
- Entry 空闲文案不再把 gross 余额称作"新增风险额度"：改为
  `新增风险额度已用尽：<原因>（首因 X/Y，槽位 n/50；组合名义 $… ，其政策为 …）`。
- 驾驶舱测试：`OverviewView.capacity.test.ts` 11 例（四块分离、OBSERVE 下不宣称用尽、ENFORCE 下点名首因、
  单边满不宣称全局用尽、渲染给定投影不重算、资金事实缺失时明说）+ `SettingsView.exposure.test.ts` 7 例。

## 6. 门禁

`verify:deps` PASS；全仓 `typecheck` PASS（contracts/core/engine/dashboard）；
引擎 167 files / 1330 tests PASS；dashboard 14 files / 57 tests PASS；
`verify:scripts` PASS（含 4 个 PowerShell 契约测试与 16 项 node 测试）；
S00 静态检查 `blockers=[]`，S00_T01…T06 全 PASS（隔离性：16 个开库测试全部隔离，仓库 dataDir 引用 0，
生产端口引用 0）；storage coverage 门禁 `S08_STORAGE_COVERAGE_PASS`；`git diff --check` 干净。

## 7. 部署与在线验收

一次受控 `stop-zdj-lan.ps1` + 一次 `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`，对应
`daf7149` + `fa9a721` 两组已提交的红→绿修补；无 watchdog、无 autostart、无热重载、无 `npm run dev`。
重启后 uptime 从 9.7 s 起持续健康，未复现历史启动期致命退出。

同一账户、同一构建、只切换政策的在线前后对照（`live-post-deploy-before-migration.json` 与
`live-sample-post-migration-1.json`）：

| | BEFORE（全 ENFORCE） | AFTER（gross/direction OBSERVE） |
| --- | --- | --- |
| 组合名义 gross / 上限 | 10,705.28 / 10,797.70（余 92.42，ENFORCE） | 10,703.80 / 10,790.59（余 86.79，**OBSERVE**） |
| LONG / SHORT 名义余量 | 7,144.23 / 3,745.88 | 7,137.43 / 3,739.95（方向自身，不再被 gross 遮蔽） |
| 资金容量（可执行保证金） | 8,921.28（USDT 3,948.16 + USDC 4,973.12） | 8,912.32（USDT 3,939.21 + USDC 4,973.12） |
| 路由资金容量 / 杠杆 | 3,980 @ lev 8 | 3,980 @ lev 8 |
| 最终 LONG 可执行新增名义 | **92.42**，首因 `GROSS_ENFORCED`，可执行路由 1 | **254.38**，首因 `PLANNED_NOTIONAL`，可执行路由 3 |
| 最终 SHORT 可执行新增名义 | 0，`NO_FEASIBLE_ROUTE` | 0，首因 `MINIMUM_NOTIONAL`（真实交易所最小名义约束） |
| executableCandidateCount | 1 | 3 |

验收条目逐条：

1. Production 写 0（每次采样均为 0），权限仍 TESTNET_ENABLED / AUTO_RUNNING / aiExitAuthority SHADOW。
2. 已证明无活动风险的历史 UNKNOWN 不再制造 `PENDING_RISK_UNVERIFIED`：重启后 47 条 durable UNKNOWN，
   **占用 pending 的行数 0**。自 `lastRestartAt` 起 `ENTRY_DECISION_BLOCKED` 只有 2 条，
   两条都是 `HUMAN_POTENTIAL_NOTIONAL_LIMIT`，**`PENDING_RISK_UNVERIFIED` 为 0 条**；同窗口 10 次远程审计
   事件全部为 `occupancyReleased=true` 的正常续证，无一次冲突或不确定回写。冻结时该集合里还有 1 行在占用，
   7 天窗口内该类行制造 49 次阻断（其中 29 次落在未过期证明窗口内）。
   30 分钟漏斗里仍能看到 `PENDING_RISK_UNVERIFIED:order:entry_intent_muga3hgh_dukt59f4` ×2，那是滚动窗口
   覆盖到的**重启前**事件；该行此刻的状态是 `status=UNKNOWN`、`activeRiskExposure=false`、
   `VERIFIED_NO_ACTIVE_RISK` 有效至 03:22:47Z、tier 1，并在重启后完成两次成功续证（t+82 s、t+347 s），
   不再出现"证明尚在有效期内却被写回占用"的抖动。
3. 资金容量与组合名义暴露在 Engine（`funding` / `exposure` 两个对象）和驾驶舱（1、2 两块）中明确分离，
   gross 余量不再被称作"新增风险额度"。
4. 方向上限与 live settings 一致：`storedDirectionLimitEqualsSettings=true`
   （`directionLimitUsd 10,790.59 = equity × maxGrossExposurePct(1)`，且 0.8 场景由测试钉住）。
5. `firstBindingConstraint` 只有一个值且来自 Engine 同一次 headroom；`capital.firstBindingConstraint` 与
   `capacityVisibility.entryCapacity` 在同一次响应内逐字段相等（同一函数、同一时刻）。
6. 钱包与风险事实允许时，新增 Entry 容量不再被 `gross ≈ 1×equity` 压成几十美元：92.42 → 254.38，
   且限制已改由真实分配规模（PLANNED_NOTIONAL）与交易所最小名义（MINIMUM_NOTIONAL）点名。
7. 上一轮的 PLACE→TradePlan→Reservation→Intent→JIT→Submit 全链与 Run 级执行结果保留：30 分钟窗口
   18 Primary / 18 PLACE / 7 风险通过 / 4 TradePlan / 4 Reservation / 4 Intent / 1 提交尝试 / 1 已提交，
   并继续精确归因（含重启前的 `JIT_BLOCKED:RISK_REJECT_GROSS_EXPOSURE`、
   `PENDING_RISK_UNVERIFIED:order:entry_intent_muga3hgh_dukt59f4` ×3——本轮修的正是这两类，重启后为 0）。
8. 重启后约 11 分钟自然流量窗口（截至最后一次采样，uptime 660 s）：4 次派发、3 次 AI Run 终止、
   2 次 PORTFOLIO_RISK 准入评估、2 次准入阻断，两条阻断的理由都被 Run 级事实精确点名：
   `HUMAN_POTENTIAL_NOTIONAL_LIMIT`（人工持仓名义上限，非本轮改动、也不在允许放宽的清单内）；
   `PENDING_RISK_UNVERIFIED` 在该窗口为 0。两点必须说清楚，不用短窗口冒充长结论：
   该窗口内没有出现新的 reservation/intent/submit，因此"所有硬门 PASS 即提交"未被本窗口自然覆盖，
   由同日上午（旧构建、同账户）的 4 Reservation / 4 Intent / 1 交易所接受提交证明链路仍在工作；
   `ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED` 在该窗口也为 0——重启后尚未发生一次"不确定复探打断有效
   证明"的场景，因此保留路径目前只有 9 条单测与 7 天 344 次历史打断的支持，其在线出现频率列入下一步第 1 项。

## 8. 本轮新暴露的真实首要阻断（未放宽，只点名）

迁移把"名义比例挡路"这一层揭掉后，自然流量里更靠前的真实约束显形为
`PORTFOLIO_RISK:MARGIN_TIER_SYMBOL_UNPROVEN:<symbol>`（JUPUSDT、COTIUSDT、WIFUSDT、RAYSOLUSDT、WIFUSDC 等），
即这些 symbol 在 canonical margin-tier 权威里没有 bracket 行；按 §0 的禁令，本轮**不**为其伪造
margin/leverage/maintenance 事实，也**不**放宽保证金权威覆盖。另有 `TP_REPAIR_FAILED`
（`REDUCTION_PROOF_NO_LIVE_POSITION:<symbol>:<side>`）在重启前后速率相同（08:00 3、09:00 20、10:00 12、11:00 3），
属既有保护链状态，不在本轮改动范围内。

## 9. 停止线：本轮不再做的事

1. 不再优化 UNKNOWN 的**请求数量**（R17 已判定计数与行数相关性 0.002）；本轮只改占用语义。
2. 不为提高成交率放宽 `$1`/`0.15`、private freshness、egress、JIT、完整性、TP/保护、PortfolioRisk 事实门。
3. 不改 `maxGrossExposurePct`/`maxDirectionExposurePct` 数值，不引入 Infinity，也不把 OBSERVE 当默认值发布。
4. 不删除、不改写、不"清理"durable UNKNOWN 与其审计历史。
5. 不重启 24h soak 计时，也不以 soak 为由停止本轮已授权的红→绿；本轮明确不等 soak。

## 10. 下一步（不超过 5 项，按价值排序）

1. 用 2–4 h 自然流量确认：`ENTRY_ORDER_NO_ACTIVE_RISK_PROOF_RETAINED` 是否按预期出现在不确定复探处，
   `PENDING_RISK_UNVERIFIED` 是否持续为 0（本轮窗口只有 ~15 min，尚不足以下 7 天级结论）。
2. 补 margin-tier 权威对 `MARGIN_TIER_SYMBOL_UNPROVEN` 那批 symbol 的真实 bracket 采集（只采集，不推断）。
3. 若确认容量瓶颈已转移到分配规模，再单独评估 `maxMarginPerPositionUsd` / 分配建议的**显式**政策调整，
   仍然走 governance + ack，不改默认。
4. 驾驶舱第 3 块补 PortfolioRisk 压力余量与维持保证金/强平距离的逐项读数（目前只有 profile 状态与政策档）。
5. `TP_REPAIR_FAILED: REDUCTION_PROOF_NO_LIVE_POSITION` 单独立项，属保护链域，勿与本轮混合。

# V3.9.6 — 部署 PortfolioRisk Authority 并正式激活 Testnet Entry（2026-09-24）

执行计划：`docs/plans/v396/CODEX-V396-DEPLOY-ACTIVATE-AUTHORITY-265F2F7-20260924.md`
起点 HEAD：`63f23c4`（= 上一轮 `265f2f7` + 本轮计划）

## 0. 结论：`V396_TESTNET_RISK_AUTHORITY_COMMITTED__ENTRY_BLOCKED_ON_P1_FACT_LAYER`

本轮**真正完成了**：authority plumbing 部署、真实 Testnet 保证金档位采集、原子 authority 提交、PortfolioRisk `READY`、CAS 切 `TESTNET_ENABLED`、以及**真实执行链跑到 JIT 组合风险准入**（5 个自然 `PLACE_SHORT` 全部走完 SCOUT→Primary→经济门→PortfolioRiskAdmission，并在风险层被点名拒绝）。

本轮**没有达成**首单 submit，原因是一个实证暴露的真实 P1（持仓级风险事实不可得），并且它对**所有**候选一视同仁地成立——不是资金大小或市场问题。据此我按 §E1 的规则把 `executionMode` 作为**明确记录的 P1 缓解**回退到 `READ_ONLY`（不是静默降级，见 §6），并停止继续用模型调用换零结果。

当前持久状态（提交后只读实测）：

```text
environment            = TESTNET
executionMode          = READ_ONLY      （P1 缓解；authority/profile 全部保留）
executionGovernance    = AUTO_RUNNING
entrySafetyMode        = AUTO
aiExitAuthority        = SHADOW
portfolioRisk.configured = true
portfolioRisk profileStatus = READY     （durable authority：MATCHED，missing[]，blockers[]）
lockedToTestnet        = true           productionWrites = 0
testnetWrites          = 6              blockedProductionWriteAttempts = 0
```

## 1. §I 23 项验收事实

| # | 项 | 事实 | 证据 |
| --- | --- | --- | --- |
| 1 | 最终 HEAD / 产品提交 / 证据提交 | 产品：`d82949c`（派生率界，**已部署**）、`423262c` + `9c24796`（覆盖宇宙 + 探针 + 预模型闸，**未部署**；`9c24796` 补的是 `423262c` 漏提的一个文件）；文档 `68ba1be` 及本提交 | `git log` |
| 2 | 部署前后身份 | 旧：PID 34196 / `3.9.6-eaaabc52c682cc1ce56a` / instanceId `1c10189b…`；新（第一轮部署）：PID 24412 / `3.9.6-3d04c580bac4cdc355a5` / `8fe7ec9f…`；P1 修复重部署后：PID 14200 / `3.9.6-65ee704a8b14cbc18f70` / `8ef62368-28c4-43d4-abf9-6193e3c7e199` | `00`、`01`、`02`、`07` |
| 3 | stop/start 次数 | **2 次 stop + 2 次 MANUAL_START**（计划允许的 1 次部署 + P1 修复的 1 次额外部署；无第三次） | `02`、`07`、§7 |
| 4 | requiredSymbols / coverage / missing | 首次提交 13 → 覆盖刷新后 14；含 USDC 计价的 `BNBUSDC`；readback `missingSymbols=[]` | `08`、`09`、`16` |
| 5 | margin contentHash / version / 派生率 / derivation | `469b06d3…`（首次，version `TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_469b06d3…`）；刷新后 `c8ac0070d479834c…`；`derivedMaintenanceMarginRatePct = 0.025`；`derivation = ENTRY_BOUND_TIERS` | `08`、`09`、`16` |
| 6 | correlation / scenario hash | `TESTNET_CORRELATION_CLUSTERS_V1_SHA256_d7ada0f6…`（`{}` 的 canonical 身份）；`TESTNET_STRESS_SCENARIO_SET_V1_SHA256_3b9c0161…`（3 个工程场景，按 id 规范化） | `09` |
| 7 | authority 前后 settingsVersion | 197 → 198（首次）；199 → 200（覆盖刷新）；每次恰 +1 | `09`、`16` |
| 8 | profile READY | 是：`profileStatus=READY`、`blockers=[]`、`authorityStatus=MATCHED` | `21` |
| 9 | executionMode CAS 前后版本 | 198 → 199（`READ_ONLY → TESTNET_ENABLED`），**变更路径仅 2 条**（settingsVersion 与 executionMode） | `10` |
| 10 | 最终四元组 | 激活期间确实达到 `TESTNET_ENABLED / AUTO_RUNNING / AUTO / SHADOW`；现因 P1 缓解回 `READ_ONLY`，其余三项不变 | `10`、`11`、`19`、`21` |
| 11 | executionReadiness | 激活后实测 `ready=true, blockers=[], modelSpendPermitted=true, mode=EXECUTION_READY, executableCandidateCount=6` | `11`、`15` |
| 12 | 第一个自然 PLACE 的 lineage | 5 个自然 PLACE_SHORT：DOGEUSDC、XRPUSDC、TAOUSDT、NEARUSDC、UNIUSDT（本地 GPU 真实推理，54–60 s，约 19k 输入 / 0.8k 输出 token），全部经 `ANALYSIS_DISPATCH_INTENT → PRE_AI_EXECUTION_ENVELOPE_CREATED → PRIMARY_DECISION_NORMALIZED → AI_RUN_TERMINAL → ENTRY_ECONOMIC_ADMISSION_EVALUATED → PORTFOLIO_RISK_ADMISSION_EVALUATED → ENTRY_DECISION_BLOCKED → CANDIDATE_REJECTED` | `17`、`18`、`20` |
| 13 | reservation/intent/order/submit/fill 计数 | 全部 **0**（`entryIntentCount30m=0`、`submitCount30m=0`、`fillCount30m=0`）：链在 admission 处真实拒绝，未创建 reservation/intent/order | `15` |
| 14 | Binance Testnet orderId/clientOrderId | **无 AI 订单**。6 次交易所写全部可归因（见 #20），均为人工 reduce-only 平仓与确定性 TP 维护 | `20` |
| 15 | 若成交则 ownership/TP | 不适用（无 AI 开仓） | — |
| 16 | 现有 HUMAN 持仓与 TP | 13 → 12（操作员人工 EMERGENCY_CLOSE 掉 XRPUSDT，10 单位，`POSITION_CLOSED_USER_DATA` + 交易记录 `CLOSED`）；其余 12 仓全部 `PROTECTED`，`humanManaged=12`、`aiOwned=0`；XRP 在减仓后 TP 链自动重建（`TP_REPAIR_STARTED → TP_TARGET_SELECTED → TP_SUBMISSION_PREPARED → TP_PROTECTED`） | `00`、`20`、`21` |
| 17 | pending-risk phantom 是否仍为 0 | 是：`activeRiskUnresolvedCount` 在激活前后为 0，历史 durable UNKNOWN 由 46 → 47（新增一条是**人工**平 XRP 的 manual order 远程状态尚未核验完成，按 fail-closed 继续占用；持仓与交易记录均已关闭）。46 条旧 UNKNOWN 全部保持 `VERIFIED_NO_ACTIVE_RISK`，未被改写 | `21` |
| 18 | private / egress / integrity / persistence | private `READY`（age <60 s，equity 10,807–10,821 USD）；egress `VERIFIED`（`proxy-a087cc91667b`，期望出口 IP 172.104.186.174 = 实测）；`integrity=true`、`status=HEALTHY`、`error=null`；一次 `PRIVATE_SYNC_FAILED → RECOVERED` 抖动，无 fatal/uncaught | `03`、`21` |
| 19 | 写计数 | `testnetWrites=6`、`productionWrites=0`、`blockedProductionWriteAttempts=0`、`lastWritePath=/fapi/v1/order` | `21` |
| 20 | duplicate submit / stale fact / wrong side / qty mismatch | 无重复提交（6 次写 = 2 次人工 EMERGENCY_CLOSE attempt 0/1 + 2 次 TP 重建/提交 + 该两次的人工取消残留），`reduceOnly=true`、`side=SELL` 对 `positionSide=LONG`、数量与持仓 10 单位一致；私有数据在写时均为 fresh | `20` |
| 21 | fatal / integrity / persistence | 无 fatal、无未捕获异常、DB integrity true、health `READY` | `21` |
| 22 | 是否自动退回 READ_ONLY | **是，一次**，作为 §E1 要求的显式 P1 缓解（含理由、CAS 变更面证明），非静默降级；authority 与 profile 完整保留 | `19` |
| 23 | 唯一第一真实 blocker | `MAINTENANCE_MARGIN_UNPROVEN:<12 个持仓全部>` + `POSITION_MARGIN_ASSET_UNPROVEN` + `LIQUIDATION_BUFFER_UNPROVEN:<3 个多头>` ⇒ `POSITION_FACT_INVALID/UNVERIFIED` 覆盖全部持仓 ⇒ `PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE`。**分类：基础设施/产品事实层缺陷（P1），不是资金或仓位大小的正常阻断**——因为它对任意候选、任意大小恒成立。次级 blocker（属正常资金约束）：`HUMAN_POTENTIAL_NOTIONAL_LIMIT`、`STRESS_LIMIT:MAX_GROSS_NOTIONAL`、`STRESS_LIMIT:MAX_CLUSTER_NOTIONAL`、`STRESS_LIMIT:MIN_MARGIN_BUFFER` | `18`（47 条完整 reasons）、`17` |

## 2. 真实采集到的保证金档位（首次进入 durable 权威）

`GET /api/v3/settings/portfolio-risk-authority` 与 preview 取证（13–14 symbol，每币一次签名 GET，并发 ≤4，写 0）：

```text
每币全部档位的最高 maintenance ratio = 0.5（11 个币）或 0.25（DOT/LTC）
在账户自身 gross 上限 E×G = 10,808 USDT 之内可达档位的最高值 = 0.025
（AVAXUSDT / ENAUSDT / FETUSDT / ONDOUSDT 的第二档）
派生结果：maintenanceMarginRatePct = 0.025，derivation = ENTRY_BOUND_TIERS
```

这就是 `d82949c` 的实证依据：上一轮"不可证 sizing ⇒ 取全部已覆盖档最大值"的退化，在多 symbol universe 上会取到 0.5，而该字段的 schema 上界是 0.2 —— 第一次真实提交因此被最终 `SystemSettingsSchema.parse` 拒绝（HTTP 400），**且原子性表现正确：settingsVersion、authority 行、写计数全部未变**。修复只做两件事：把候选档位限制在账户可达名义区间内（仍取最大值，绝不平均、不 clamp），并在界内仍超界时点名 `<bound>:<symbol>` 拒绝。明确否决的替代方案是放宽 0.2 这个驱动保证金计算的域约束。

## 3. 激活期间真实跑通的执行链（第一原因展开）

`PORTFOLIO_RISK_ADMISSION_EVALUATED`（WLDUSDT，11:40:00）返回 47 条 reasons，去重归类：

- `MAINTENANCE_MARGIN_UNPROVEN:<position>` ×12 —— 全部持仓的 `maintenanceMarginUsd` 为空；
- `POSITION_MARGIN_ASSET_UNPROVEN` / `MARGIN_ASSET_UNVERIFIED:` —— 全部持仓 `marginAsset` 为空；
- `LIQUIDATION_BUFFER_UNPROVEN:<3 个多头>` —— 交易所对这几个多头返回 `liquidationPrice=0`；
- `POSITION_FACT_INVALID / POSITION_FACT_UNVERIFIED` ×12 —— 由上面三项推出；
- `MARGIN_TIER_SYMBOL_UNPROVEN:WLDUSDT` —— 该候选不在已提交覆盖内（正确的点名拒绝）；
- `HUMAN_POTENTIAL_NOTIONAL_LIMIT` + `STRESS_LIMIT:MAX_GROSS_NOTIONAL / MAX_CLUSTER_NOTIONAL / MIN_MARGIN_BUFFER`；
- `PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE`。

`MARGIN_TIER_UNPROVEN`、`PROFILE_*`、`RISK_PROFILE_UNCONFIGURED`、`AUTHORITY_NOT_COMMITTED` **一条都没有出现**：authority plumbing 本身在真实数据上闭环了。剩下挡路的两层，一层是持仓级事实缺失（P1），一层是外层 gross 上限的真实数学（13 仓时 human 名义额已用掉 100% equity 上限的约 84%）。

## 4. 本轮修复（红→绿）

| 提交 | 缺陷 | 修复 | 是否已部署 |
| --- | --- | --- | --- |
| `d82949c` | 派生率取到账户不可达档位 ⇒ 必然被 schema 域拒绝；`requiredSymbols` 漏掉 USDC 计价 symbol | 界约束派生 + `ENTRY_BOUND_TIERS` 命名 + `MAINTENANCE_RATE_EXCEEDS_PROFILE_BOUND` 点名拒绝 + USDC/BUSD/FDUSD 纳入覆盖 + 只读 preview 通道 | **是**（`3.9.6-65ee704a…`） |
| `423262c` | 覆盖集只取"这一 tick 路由到的 symbol" ⇒ profile 在 MISMATCH/MATCHED 间摆动、模型支出被自造门反复切断；池内未覆盖 symbol 被当作 profile 级硬门 | 覆盖扩到持仓∪在途∪池∪有界排名宇宙（上限 2×poolMax，按插入顺序而非字母截断）；readiness 仅在整个可 sized 宇宙都无覆盖时停止支出；单候选仍由 admission 点名；`uncoveredCoverageCandidates` 降为信息位 | 否（需再一次受控部署） |
| `423262c` | 无法自证"交易所没给 maintenance/marginAsset"还是"字段名读错" | 新增 `probePositionRiskFields()`（同一签名 GET，只读，非 TESTNET 直接拒绝，测试锁定写 0），经 preview 输出真实字段名与逐仓样本 | 否 |

测试：Engine 全仓 **157 files / 1239 tests EXIT=0**；本轮新增 R1–R5 + 探针 GET-only + preview 不持久化等 12 项断言；`tsc --noEmit` 干净；core 46 tests；contracts **0 tests**（不称 contract coverage）；S00 静态、storage coverage、`verify:deps`、`verify:scripts`、`git diff --check` 全部 EXIT=0（见 `gates/`）。

## 5. 未部署代码与运行实例的关系（不污染现场）

`423262c` 与 `9c24796` 只提交、不部署。为证明没有半部署：全部门禁后重新计算内容树 hash，live 四棵 dist 树仍是 `65ee704a8b14cbc18f70…`（与运行中 buildId 逐字节一致），`gates/13-live-dist-identity.txt`；隔离构建只写到 `build-check/`（已删除），`gates/03`。所有 isolated test 使用 `mkdtemp` 独立 dataDir、`listen(0)` 随机端口、假 transport。

## 6. 为什么回退 READ_ONLY（以及为什么这不是"停在 READ_ONLY"）

激活后 9 分钟内出现 5 个自然 PLACE_SHORT 决策（另有 1 个 Primary 运行未出 PLACE），全部因**同一条确定性事实层 blocker** 在 admission 被拒（不是市场/大小原因，任意候选任意数量都不能通过），即 §F1/§G 所定义的"同一确定性事实缺口反复造成模型白跑"。继续 `TESTNET_ENABLED` 的净效果只是每 ~90 秒消耗一次本地 GPU 大模型调用而执行概率为 0。§E1 允许把回退作为真实 P1 的缓解，并要求显式记录：

- CAS 变更面实测只有 2 条路径（`settingsVersion`、`connections.executionMode`），见 `19-…`；
- authority、profile、limits、`AUTO_RUNNING`、`AUTO`、`SHADOW`、`lockedToTestnet` 全部保留；
- 恢复执行不需要重建任何权威：部署 `423262c` 并把事实层修好后，一次 CAS 即可回到 `TESTNET_ENABLED`。

## 7. 需要用户裁决的两件事（本轮刻意不自作决定）

1. **再一次受控部署的生命周期授权**（1 stop + 1 MANUAL_START）。计划只预授权了 2 次，我已用完（部署 + 第一个 P1 的修复），因此不擅自进行第三次。部署内容：`423262c`（覆盖宇宙 + 探针 + readback 一致性）。部署后即可用 `POST /settings/portfolio-risk-authority/preview` 一次拿到 `/fapi/v2/positionRisk` 的真实字段名，从而判定 maintenance/marginAsset 到底能否从交易所直接读到。
2. **`liquidationPrice = 0` 的语义裁决**（风险语义，不该由执行层替操作者决定）：现在按"未证明"fail-closed，结果是这 3 个多头使组合风险永远无法放行；另一种读法是"交易所明示该杠杆下不存在强平价 ⇒ 缓冲无界"。我倾向前者保持，除非操作者明确授权把它当作后者，或改用交易所自身的其它权威字段。

## 8. 停止线：本轮之后**不该**做什么

1. 不要用 `maintenanceMarginRatePct × notional` 或档位表最大率合成 `maintenanceMarginUsd` 来"清掉" §3 的 blocker —— 那是 §G 明令禁止的伪证。
2. 不要为了放行而放宽 0.2 域界、`maxGrossExposurePct=1`、`maxDirectionExposurePct=0.8`、`maxPositions=50`、cluster 0.35、freshness、egress、`0.15`、reachability `0.5`、`aiExitAuthority=SHADOW`。
3. 不要做 coverage 的自动授予或后台自动 commit：drift/新 symbol 只能标记，授权必须是显式 operator 动作（§F2）。
4. 不要在事实层修好之前重开 `TESTNET_ENABLED` 并期待首单 —— 那只会继续白跑模型。
5. 下一轮优先修的**不是**请求数（46→47 的 manual UNKNOWN 审计噪声、以及每币 weight-30 的采集量），而是持仓级风险事实的可得性；请求数属于 R15/R17 已经裁定过"别再优化"的那条线。

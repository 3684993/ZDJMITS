# ZDJ-MITS V3.9.5 精准优化与收益经济性升级实施计划

**日期：2026-09-19**
**项目：3684993/ZDJMITS**
**基线分支：`v394-binance-governance-settings-20260918`**
**核验基线 HEAD：`d013d334f67e6cc32fa6276b3af838e948d73dc9`**
**状态：调查完成 / 仅实施计划 / 未修改 V3.9.4 正在验收的运行代码与参数**

---

## 0. 执行边界

V3.9.5 不是重构版。必须冻结并保持以下已验证语义：

- AI 自主 `side`
- AI 自主 `quantityUnits`
- AI 自主 `acceptablePriceRange`
- Maker Entry
- side-neutral PreAiExecutionEnvelope
- deterministic TP authority
- Testnet-only boundary
- Binance request governance
- UNKNOWN / reconciliation / exactly-once 安全语义
- 唯一退出链：`ExitIntent → ExitDispatcher → AccountExecutor`

本计划完成前、V3.9.4 12H/24H acceptance 运行期间，不修改运行代码、参数或数据库，不重跑 Stage6/7/8，不以降低标准换取 PASS。

---

# 1. V3.9.4 当前验收状态

## 1.1 GitHub 最新事实

已核验远端分支最新 HEAD：

`d013d334f67e6cc32fa6276b3af838e948d73dc9`

对应 GitHub Actions：

- Workflow：`V3.9.x Verify`
- run number：326
- event：push
- exact `head_sha=d013d334...`
- conclusion：`success`

因此后续代码调查均以 `d013d33` 为最新远端基线，不使用旧 HEAD 替代。

GitHub/Drive 连接器无法读取用户 Windows 主机当前本地 `git status`，因此本计划不伪称“当前本地工作树 clean”。远端分支 HEAD 与 exact-HEAD CI 已确认；本机工作树状态必须在实施前由本机再次执行 `git status --short` 取证。

## 1.2 Stage 状态

已确认：

- Stage6：PASS，冻结，不重跑
- Stage7：PASS
  - ETHUSDT LONG 自然成交
  - AI side / quantityUnits / acceptablePriceRange 完整存活
  - sideMismatch=0
  - quantityMismatch=0
  - rangeMismatch=0
  - policyLeak=0
  - TP 自动保护成功
- Stage8：PASS
  - executionMode=TESTNET_ENABLED
  - runtimeMode=RUNNING
  - executionGovernance=AUTO_RUNNING
  - maxPositions=50
  - entryMarginUsd=200
  - dynamicMarginEnabled=true
  - 固定出口 172.104.186.174
  - Account READY / WS LIVE / Reconciliation SETTLED

## 1.3 12H / 24H

Stage8 报告证明 12H acceptance 于 **2026-09-19 04:51** 开始，采样间隔 60 秒，要求真实连续 720 分钟。

目前能够远程核实到的最新 checkpoint 事实来自 06:56 的 closeout report：

- accept12h = RUNNING
- 约 100 / 720 分钟
- breaks=0
- HTTP 429 增量=0
- HTTP 418 增量=0
- readiness violations=0
- accept24h 尚未开始

当前无法从 GitHub/Drive 读取 Windows 本机 `data/rollout/v394-stage7-9/checkpoint.json` 的实时内容，因此**不得按墙钟时间推算为连续有效验收时间，也不得声明 12H PASS**。

后续纪律：

1. 12H 必须由 checkpoint + summary 证明真实满 720 分钟且所有硬门禁为 0；
2. 12H PASS 后按现有编排器进入 24H，不重跑 Stage7/8；
3. 24H 必须真实满 1440 分钟；
4. 仅 24H PASS 后才允许声明：

`V3.9.4 Binance API Governance Stable`

---

# 2. TP economics 当前调用链代码级复核

## 2.1 当前链路

当前核心流程：

`AI PLACE decision + profitTakePlan`
→ EntryIntent 冻结
→ AI quantityUnits 由 `aiQuantityAllocation.ts` 精确物化
→ Maker Entry
→ Fill / Reconciliation
→ Position
→ `TpGuardian.ensure()`
→ AI TP / STRUCTURE_15M / FIXED_PROFITABLE 三选一
→ 经济学检查
→ TP 下单与保护

## 2.2 1.2% 的真实语义

`apps/engine/src/services/tpGuardian.ts` 当前对“整仓 TP”计算：

`fullPositionCanaryMinMovePct = 1.2`

并同时用于：

1. AI TP 最低距离验证；
2. STRUCTURE_15M TP 最低距离验证；
3. FIXED_PROFITABLE fallback 最低距离；
4. 最终 `finalValid` 验证。

因此 1.2% **不是单纯 fallback 参数，而是当前 AI TP 的硬 veto/floor**。

代码事实与运行统计一致：

- TP_TARGET_SELECTED 169 条
- FIXED_PROFITABLE 135（79.9%）
- AI 30（17.8%）
- STRUCTURE_15M 4（2.4%）
- AI 提供 TP 132 笔
- aiPlanValid=false 102（约 77%）
- 其中 89 笔主要因 `STRUCTURE_OUTSIDE_CONFIGURED_DISTANCE`

结论：当前固定距离规则确实反向压过了 27B 的结构化 TP。

## 2.3 当前 economics 已有能力

TP Guardian 已通过统一 `estimateTradingCost()` 计算：

- entry fee
- expected exit fee
- slippage buffer
- fee safety buffer
- expected gross profit
- expected net profit
- required net profit
- break-even price
- min profitable exit price

当前 Settings：

- `minNetProfitUsd` 默认仅 0.01
- `minNetProfitRoiPct` 默认 0.15%
- makerFeeRate 默认 0.02%
- takerFeeRate 默认 0.04%
- exitFeeAssumption 默认 TAKER
- feeSafetyBufferPct 默认 10%

因此问题不是“系统没有成本模型”，而是经济门槛过低且固定 1.2% 又承担了不合理的 AI TP 否决职责。

## 2.4 必须前移到 Entry 前的原因

若要求：

> 经济上不可行时 Entry fail-closed，而不是成交后再制造一个不现实的 TP

则仅修改 TP Guardian 不够。

TP Guardian 工作时仓位已经成交。此时如果才发现：

- AI quantity 太小，净收益达不到门槛；
- AI TP 超出历史可达区间；
- 目标与仓位组合无可行解；

系统已经承担了持仓风险。

因此 V3.9.5 必须新增：

`Pre-AI objective economics facts`
→ 27B 自主选择 quantity + TP
→ `Post-AI JIT Economic Feasibility Validator`
→ 只有可行才允许冻结/执行 Entry

TP Guardian 保留为**成交后的保护与恢复 authority**，而不继续作为正常情况下的策略性 1.2% veto。

---

# 3. minNetProfitUsd + reachability + quantity + risk envelope 数学闭环

## 3.1 定义

设：

- `E` = 保守入场价格
- `T` = AI targetPrice
- `m = |T/E - 1|` = 目标价格移动率
- `N` = 名义仓位
- `c_eff` = 统一成本率
- `P_min` = Settings 的 `minNetProfitUsd`
- `P_net` = 预期净利润
- `N_max_env` = PreAiExecutionEnvelope 对该 side 的最大名义容量

简化表达：

`P_net = N × (m - c_eff)`

正式实现不得复制一套费用算法，必须调用现有 `estimateTradingCost()` 作为唯一 canonical economics。

## 3.2 经济可行性

必须满足：

`P_net >= P_min`

等价于在 `m > c_eff` 时：

`N >= N_min_econ = P_min / (m - c_eff)`

但执行层**不得**据此把 AI quantity 向上 clamp。

正确语义：

- 执行层向 AI 提供 `P_min / costs / N_max / reachability`；
- AI 自主输出 `quantityUnits` 和 TP；
- JIT validator 用 AI 原值校验；
- AI quantity 太小 → reject；
- AI quantity 太大 → reject；
- 不允许自动放大或缩小 AI quantity。

## 3.3 历史可达性

不得简单用 ATR 或固定 1.2% 代替可达性。

建议新增只读客观服务 `HistoricalTpReachability`，只使用已收盘 K 线，对 LONG / SHORT 和 horizon 分别计算：

- sampleCount
- lookbackStart / lookbackEnd
- favorable excursion 分布
- `hardReachableMaxMovePct(H)`
- `reachProbability(move,H)`
- p50 / p75 / p90 favorable excursion
- dataFreshness / coverage

硬约束：

1. `m <= hardReachableMaxMovePct(H)`
2. 只使用历史已发生的 favorable excursion；
3. 数据不足、过期或 horizon 无足够样本 → fail-closed；
4. 禁止 target 放到历史样本从未触达的区域；
5. 分位数只作为 AI 的客观概率事实，不作为系统方向建议。

建议把 `minHistoricalReachProbability` 设计成可配置 admission 参数，而非硬编码。是否启用及数值由用户最终选择。

## 3.4 数量与客观容量

现有 `aiQuantityAllocation.ts` 已具备正确语义：

- quantityUnits 必须是正整数；
- `quantity = quantityUnits × stepSize`
- 超 `maxQuantityUnits` → reject
- 超 `maxNotionalUsd` → reject
- 超 `maxMarginUsd` → reject
- 不进行 confidence resizing
- 不进行 direction-policy resizing

该文件建议**不修改，只新增回归测试**。

JIT economics 进一步要求：

`N_ai <= N_max_env`

且：

`P_net(N_ai,T) >= P_min`

任何不满足均拒绝 Entry，不 clamp。

## 3.5 风险包络

当前真实配置不是独立 `perTradeRiskUsd`，而是：

`riskGovernance.perTradeRiskPctEquity`

schema 默认 1%。

因此运行时派生：

`perTradeRiskUsd = equityUsd × perTradeRiskPctEquity`

现有 PreAiExecutionEnvelope 已把：

- free margin
- maxMarginPerPositionUsd
- maxEquityPct
- leverage
- expected adverse move（15m ATR）
- direction exposure
- gross exposure
- cluster exposure

纳入 `computeExecutableRiskHeadroom()`。

V3.9.5 不再造第二套风险真相；economics feasibility 只消费该 envelope 的最终容量。

## 3.6 HUMAN_MANAGED 尾部风险约束

无自动止损时，`perTradeRiskUsd` 不是严格“最大亏损”，它只是场景预算。真正尾部风险可能远高于该值。

因此必须新增**只阻止新增风险、不自动平仓**的 Human Managed portfolio envelope，例如：

- `maxHumanManagedPositions`
- `maxHumanManagedNotionalUsd` 或 `maxHumanManagedNotionalPctEquity`
- `maxHumanManagedMarginUsd` 或 pct equity
- `maxSingleHumanManagedNotionalPctEquity`

作用：

- HUMAN_MANAGED 累积超过上限 → 新 Entry fail-closed；
- 已存在 HUMAN_MANAGED 仓位保持人工扛单；
- 不触发 stop-loss；
- 不触发 timeout-close；
- 不触发 panic-close。

这正是避免“为了多赚 2 USDT，把尾部风险放大几十倍”的核心保护。

---

# 4. 三套联合参数候选档位

以下仅作为 Testnet / 回放起始候选，不自动选择、不直接写入当前 Settings。

| 参数 | 保守 | 默认候选 | 激进 |
|---|---:|---:|---:|
| minNetProfitUsd | 1.00 | 2.00 | 3.00 |
| baseMarginUsd | 100 | 150 | 200 |
| maxMarginPerPositionUsd | 200 | 300 | 500 |
| perTradeRiskPctEquity | 0.25% | 0.50% | 0.75% |
| globalMaxLeverage | 8x | 10x | 15x |
| maxPositions | 10 | 20 | 30 |
| minHistoricalReachProbability | 60% | 50% | 40% |
| maxHumanManagedPositions | 2 | 4 | 6 |
| maxHumanManagedNotionalPctEquity | 10% | 20% | 30% |

注意：

1. 当前 schema 的 `baseMarginUsd=200`、`maxMarginPerPositionUsd=500`、`globalMaxLeverage=20`；当前运行 `maxPositions=50`。
2. “激进”不等于允许执行层放大 quantity；仍必须由 27B 自主输出且在 envelope 内。
3. 杠杆不会直接提高固定名义仓位的 TP 美元利润，只降低所需保证金并缩短尾部清算缓冲，因此不能用提高杠杆“解决” `minNetProfitUsd`。
4. 最终档位必须经历史回放 + Testnet economics admission 分布决定，不能直接以本表落生产默认值。

---

# 5. PreAiExecutionEnvelope V3.9.5 扩展

保持 side-neutral，只增加客观事实，不增加方向建议。

建议新增：

`economics`：

- minNetProfitUsd
- minNetProfitRoiPct
- estimatedRoundTripCosts
- maker/taker assumptions
- slippage buffer
- fee safety buffer
- canonical calculator version

`reachability`：

- supported horizons
- sampleCount
- long favorable-excursion distribution
- short favorable-excursion distribution
- hard historical max
- reach probability curve
- freshness

LONG / SHORT capacity 增加：

- maxNotionalUsd（保留）
- maxQuantityUnits（保留）
- maxMarginUsd（保留）
- humanManagedExposureHeadroom
- economicsFeasible=true/false
- objective blockers

禁止输出：

- preferred side
- recommended side
- deterministic target
- deterministic quantity
- “为了达到 2 USD 应买多少”的执行命令

可输出客观数学边界，例如：

- 若 move=0.5%，达到当前 P_min 所需最低名义
- 若 move=0.8%，所需最低名义
- 对应历史 reachProbability

最终选择仍属于 27B。

---

# 6. Post-AI JIT Economic Feasibility Validator

建议新增独立服务，不把逻辑塞进 `aiQuantityAllocation.ts`。

输入：

- frozen AI side
- frozen quantityUnits
- frozen acceptablePriceRange
- profitTakePlan
- 当前 JIT quote
- PreAiExecutionEnvelope
- 最新 closed-bar reachability facts
- canonical trading-cost calculator

校验顺序：

1. side 在对应 envelope executable；
2. quantityUnits 未超 maxQuantityUnits；
3. acceptablePriceRange 仍与 Maker/JIT 客观范围兼容；
4. targetPrice 在 AI 自己 acceptableTargetRange 内；
5. targetHorizonMinutes 的 reachability 数据有效；
6. target move 未超历史 hard reachable max；
7. reach probability 不低于 Settings 门槛（若启用）；
8. AI quantity 对应 notional 未超 envelope；
9. canonical expectedNetProfit >= minNetProfitUsd；
10. Human Managed exposure headroom 未超限。

失败原因必须明确，例如：

- `ECONOMIC_MIN_NET_PROFIT_UNMET`
- `TP_HISTORICAL_REACHABILITY_UNMET`
- `TP_REACHABILITY_DATA_STALE`
- `AI_QUANTITY_EXCEEDS_ENVELOPE`
- `HUMAN_MANAGED_EXPOSURE_LIMIT`

失败处理：

- 当前 Entry fail-closed；
- 不改 AI 原 quantity；
- 不把 target 推远；
- 不创建替代方向；
- 不制造第二套策略；
- 后续新事实/新 AI run 可重新决策。

---

# 7. TP Guardian V3.9.5 语义方案（冻结核心，需明确授权）

当前建议：

### 正常新仓

经济可行性在 Entry 前已经通过。

TP Guardian 对 AI TP 只验证硬约束：

- side 正确
- target range 正确
- horizon/evidence 新鲜
- historical reachability
- canonical economics
- exchange tick/side reachability
- position quantity coverage

**不再因为固定 1.2% 最低距离否决一个经济有效、历史可达的 AI TP。**

### Recovery / Legacy position

TP Guardian 仍必须保留 deterministic protection fallback。

原因：重启恢复、历史持仓或异常数据下，仓位已存在，系统不能因为“新 Entry 本来应该拒绝”就让现有仓位无 TP。

因此：

- 正常 Entry：AI plan 应是主要来源；
- post-fill recovery：deterministic fallback 仍是安全网；
- fallback 使用必须打明确 reason / source；
- 不得静默越过 AI range 后假装 AI TP。

### 明确冻结

`apps/engine/src/services/tpGuardian.ts` 属冻结核心。

在用户明确批准 V3.9.5 **实施且特别授权改变 TP Guardian 1.2% veto 语义**前：

**不修改。**

---

# 8. HUMAN_MANAGED 人工处置中心

## 8.1 定位

新增 Dashboard：

`Human Managed / 待人工处置`

它是人工风险可见性与操作入口，不是自动风险管理器。

## 8.2 必须显示

每笔至少：

- symbol
- side
- qty
- entry
- mark
- unrealized PnL
- unrealized PnL %
- notional
- margin / leverage
- openedAt
- HUMAN_MANAGED since
- TP status
- TP price
- distance to TP
- TP source
- funding impact
- funding attribution status：EXACT / ESTIMATED / UNKNOWN
- severity
- portfolio exposure contribution
- underlying concentration
- gross exposure contribution

## 8.3 Severity

Severity 仅用于排序/提示，**不得驱动自动平仓**。

建议由以下事实组合：

- unrealized loss as % equity
- notional / equity
- margin / equity
- TP distance
- funding drag
- concentration
- HUMAN_MANAGED exposure contribution

时间可以显示，但不允许因“持仓太久”升级成自动退出动作。

## 8.4 人工操作

### 保持持仓

记录：

`HUMAN_MANAGED_ACKNOWLEDGED`

只写审计/备注，不向交易所发请求，不改变 TP，不重置损失计数，不自动降 severity。

### 修改 / 重建 TP

复用现有 PositionConsole：

- `REPLACE_TP`
- `REBUILD_TP`

### Reduce

复用现有 `REDUCE` manual action。

### Emergency Close

复用现有 `EMERGENCY_CLOSE`：

- explicit human confirm
- reduce-only
- 继续走唯一 ExitIntent / Dispatcher / AccountExecutor
- 不新增 Market panic path

严禁新增：

- stop-loss
- timeout-close
- loss-size auto close
- panic-close
- 第二套 exit manager

---

# 9. V3.9.5 分阶段实施计划

## Phase 0 — V3.9.4 Acceptance Gate

前置条件：

- accept12h = PASS
- accept24h = PASS
- exact acceptance HEAD / CI 证据完成
- 输出 V3.9.4 final acceptance / handoff report

在此前：

- 只允许文档与离线分析；
- 不改正在运行的 V3.9.4 代码和参数。

## Phase 1 — Economics / Reachability Observe-Only

新增纯读服务与 telemetry：

- canonical economics projection
- horizon reachability
- historical MFE distribution
- hypothetical admission verdict

不参与实际 Entry/TP。

对最近历史 AI decisions 回放：

- 原 AI TP
- expectedNetProfit
- reachProbability
- wouldPass/wouldReject
- 所需最低名义
- envelope 最大名义
- feasible-set 是否为空

验收：零交易语义改变。

## Phase 2 — Settings + Envelope Facts

新增可配置 Settings：

- minNetProfitUsd（已有字段，保留）
- minHistoricalReachProbability
- reachabilityLookback
- reachabilityMinSamples
- Human Managed exposure caps

扩展 PreAiExecutionEnvelope，仅增加客观事实。

验证 prompt 中无方向政策泄漏。

## Phase 3 — JIT Economic Admission

新增独立 `EconomicEntryFeasibilityValidator`。

只增加 fail-closed 硬约束：

- net profit
- reachability
- quantity/envelope
- Human Managed headroom

不修改 AI side/qty/range。

先 Shadow，再 TESTNET enforcement。

## Phase 4 — TP Guardian 精准语义调整

**需要用户单独明确授权。**

目标：

- 移除固定 1.2% 对正常 AI TP 的最低距离 veto；
- 改由 economics + historical reachability 作为硬验证；
- 保留 recovery deterministic fallback；
- 保留 TP coverage / exactly-once / reconciliation。

## Phase 5 — Human Managed Center

新增 read projection + Dashboard queue。

复用现有 manual action 链。

不增加自动退出权限。

## Phase 6 — Regression + Testnet Canary

至少验证：

- side mismatch=0
- quantity mismatch=0
- acceptable range mismatch=0
- policy leak=0
- quantity clamp=0
- Maker authorization violation=0
- TP coverage完整
- productionWrites=0
- 429/418 增量=0

并验证 economics / reachability admission。

## Phase 7 — V3.9.5 Acceptance

验收重点不是强求实现盈利，而是证明：

- 每个被允许的新 Entry 在授权时满足配置经济底线；
- TP 位于客观历史可达域；
- 执行层没有放大 quantity；
- Human Managed 尾部敞口不会通过新增 Entry 无界扩大；
- 人工处置入口完整；
- 原 V3.9.4 基础设施与自主授权 invariants 无回退。

---

# 10. 预计修改文件

## 10.1 可新增/常规修改

建议：

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/portfolio.ts`（若 Human Managed cap 放 portfolio intelligence）
- `apps/engine/src/services/preAiExecutionEnvelope.ts`
- 新增 `apps/engine/src/services/historicalTpReachability.ts`
- 新增 `apps/engine/src/services/economicEntryFeasibility.ts`
- Settings store/default/migration 对应文件
- EIP / Primary context 组装点（仅注入客观 economics/reachability facts）
- API read projection / router
- `apps/dashboard/src/views/PositionsView.vue`
- `apps/dashboard/src/components/PositionConsole.vue`
- `apps/dashboard/src/api/client.ts`
- 可新增 `HumanManagedView.vue` 或在 PositionsView 增独立 tab
- 对应 tests

## 10.2 建议不修改，只加回归测试

- `apps/engine/src/services/aiQuantityAllocation.ts`
- BinanceTransport / RequestBudget / Demo routing
- Stage6/7/8 已验收编排逻辑
- legacy DirectionPolicy 生产语义

## 10.3 冻结/高风险，需明确授权

- `apps/engine/src/services/tpGuardian.ts`
  - 原因：改变 1.2% AI TP veto 属 TP 核心语义变化。
- Entry core integration point（如必须改 `entryCoordinator.ts`）
  - 只允许最小接线调用新 validator；
  - 禁止重写 Entry 架构、调度、方向、数量或 Maker 语义。
- Loss handoff policy
  - 不改变 HUMAN_MANAGED = 人工扛单；
  - HUMAN_MANAGED since 优先从已有事件/状态投影，不为 UI 需求重写退出政策。

---

# 11. P2 技术债登记，不升级范围

仅登记：

- DirectionPolicyService dead import / reachability
- portfolioIntelligence legacy direction fields
- capitalAdmission longPlan/shortPlan
- 10 笔 UNKNOWN 每 60 秒 private REST 复核
- CI Windows SQLite / harness 5000ms flake
- fundingUnknown / ledger reconciliation presentation

除非新增 runtime 证据证明其实际改变：

- AI side
- AI quantity
- AI acceptable range
- Maker authorization
- TP authority

否则不得升级为 P0。

---

# 12. 测试矩阵

## Economics

- maker→taker
- maker→maker
- fee safety buffer
- slippage buffer
- minNetProfitUsd 边界
- m <= c_eff
- minProfitableExitPrice
- LONG / SHORT 对称性
- canonical calculator parity

## Reachability

- closed bars only
- 禁止 future leakage
- 1m/5m/15m horizon 映射
- LONG/SHORT favorable excursion
- insufficient samples fail-closed
- stale data fail-closed
- hard max boundary
- reach probability boundary
- extreme outlier 不被误写成“高概率”

## Quantity / Envelope

- quantityUnits exact materialization
- units > max → reject
- no clamp
- maxNotional
- maxMargin
- minQty/minNotional
- acceptable range
- side-neutral LONG/SHORT

## Joint economics

- N_min_econ <= N_ai <= N_max_env → pass
- N_ai too small → reject
- N_ai too large → reject
- target unreachable → reject
- target reachable but profit insufficient → reject
- profitable target but Human Managed cap full → reject
- feasible set empty → fail-closed

## TP Guardian（授权后）

- AI TP <1.2% 但 economics+reachability valid → AI TP 可保留
- AI TP economics invalid → 不正常放行
- AI TP unreachable → 不正常放行
- restart legacy position → deterministic recovery fallback 仍可保护
- orphan / duplicate / wrong side / qty mismatch = 0
- existing TP 不因版本切换被无意义 cancel/recreate

## HUMAN_MANAGED

- handoff 后进入待办中心
- Hold 仅 audit，无 exchange write
- Replace/Rebuild TP 走现有链
- Reduce 走现有链
- Emergency Close 走现有链
- severity 不触发自动退出
- age 不触发自动退出
- 浮亏扩大不触发自动退出
- funding UNKNOWN 明确显示 UNKNOWN
- portfolio exposure contribution 正确

## Regression

- AI side autonomy
- AI quantity freeze
- acceptable range
- Maker Entry
- side-neutral envelope
- Testnet-only
- productionWrites=0
- Binance Demo host
- static egress
- request governance
- reconciliation
- UNKNOWN occupancy
- exact-head CI
- build / typecheck / verify / diff-check

---

# 13. 回滚方案

## 13.1 部署原则

所有新配置必须 additive、默认保持 V3.9.4 行为，直到 V3.9.5 feature gate 明确启用。

建议开关：

- `economicEntryAdmissionEnabled`
- `historicalTpReachabilityEnabled`
- `humanManagedAdmissionCapsEnabled`

不得通过关闭 V3.9.4 request governance 回滚。

## 13.2 代码回滚

若 economics admission 异常：

- 关闭 V3.9.5 admission feature；
- 恢复 V3.9.4 Entry 行为；
- 保留 Demo REST / static egress / request governor。

若 TP Guardian 新语义异常：

- 回退代码到 V3.9.4 guardian；
- **不得为了回滚主动取消已在交易所有效的 TP**；
- 先以交易所真实 TP/reconciliation 为准。

Dashboard 可独立回滚，不影响交易事实。

## 13.3 数据

- schema 仅 additive
- 不删除 trade/order/history
- 不改 UNKNOWN 历史事实
- 不重置 SecretStore
- 不清空 Human Managed 仓位
- 不为了测试清理真实 Testnet 持仓，除非用户显式授权

---

# 14. 风险

1. **利润门槛诱导放大名义仓位**
   通过 AI 原量校验 + envelope 上限 + Human Managed exposure cap 解决，禁止执行层自动扩容。

2. **历史最大值被误当作高概率目标**
   同时提供 hard max 与 empirical reachProbability；最大值只用于“从未达到”硬边界。

3. **TP validator 前移后拒单率升高**
   这是经济约束的真实结果，不得通过降低标准伪造通过；先 Shadow 统计 feasible-set。

4. **TP Guardian 去除 1.2% 后 TP 过近**
   由 canonical net-profit floor + reachability + minNetProfitRoiPct 控制，而不是再引入另一固定距离常数。

5. **无止损条件下尾部敞口累积**
   Human Managed cap 只阻止新增风险，不自动平老仓。

6. **双重经济真相**
   所有成本计算复用 `estimateTradingCost()`，禁止另写独立 fee 公式成为第二真相源。

7. **V3.9.5 干扰 V3.9.4 acceptance**
   Phase0 强制等待 V3.9.4 24H 完成；当前只交付计划，不部署。

---

# 15. V3.9.5 验收标准

必须同时满足：

### 自主授权不回退

- sideMismatch=0
- quantityMismatch=0
- rangeMismatch=0
- policyLeak=0
- quantityClamp=0
- Maker authorization violation=0

### Economics

- 所有被 admission 的新 Entry：`expectedNetProfit >= configured minNetProfitUsd`
- 所有被 admission 的 TP：历史 reachability hard constraint PASS
- reachability 数据不足 → reject，不猜
- 无执行层自动扩大 quantity
- 无为凑利润把 target 推到历史未触达区域

### Risk

- AI notional <= PreAiExecutionEnvelope
- Human Managed cap 超限时只阻断新风险
- 无新增自动 stop-loss / timeout-close / panic-close
- leverage 不被作为利润放大器自动提升

### TP

- protection coverage 完整
- orphan=0
- duplicate=0
- wrongSide=0
- qtyMismatch=0
- recovery fallback 可用
- 正常 AI TP 不再被无关固定 1.2% 距离规则系统性 veto（仅在用户明确授权后实施）

### Human Managed

- 100% HUMAN_MANAGED 仓位可在专用中心看见
- 必需字段完整
- Hold/TP/Reduce/Emergency Close 均有审计
- 所有退出操作沿唯一退出链
- severity 仅提示，不自动退出

### Infrastructure

- environment=TESTNET
- productionWrites=0
- REST host=demo-fapi.binance.com
- fixed egress verified
- HTTP 429 delta=0
- HTTP 418 delta=0
- Account READY
- WS LIVE
- Reconciliation SETTLED

---

# 16. 最终裁决

V3.9.5 应解决的是：

> **让 27B 在客观成本、历史可达性和风险容量明确的边界内，自主选择真正有经济价值的 quantity + TP；不可行就不建仓，而不是由执行层替 AI 放大仓位或把 TP 推到不现实的位置。**

同时：

> **HUMAN_MANAGED 继续是人工扛单政策，但从“静默状态”升级为可见、可排序、可人工处置且不产生第二套退出链的风险中心。**

V3.9.5 不应重新设计 Entry/AI/TP 大架构，也不应以“提高收益”为理由破坏 V3.9.4 已经机器证明的自主授权、Maker 执行、side-neutral envelope、Testnet boundary 和 Binance request governance。

**实施启动条件：V3.9.4 真实 24H PASS + 用户明确批准 V3.9.5 实施；涉及 `tpGuardian.ts` 1.2% veto 语义变化时，再取得明确授权。**

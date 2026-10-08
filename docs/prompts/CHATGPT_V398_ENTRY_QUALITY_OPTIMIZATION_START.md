# ChatGPT New Conversation Start — V3.9.8 建仓质量优化

建议对话标题：**v3.9.8建仓质量优化**

继续维护 GitHub 项目 `3684993/ZDJMITS`。

## 0. 先读取 GitHub，不要让我重新解释历史

开始前必须先读取：

1. `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`
2. `docs/reports/v397-trade-entry-exit-quality-review-20261008/TRADE_ENTRY_EXIT_QUALITY_REVIEW.md`
3. `docs/plans/V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md`

当前已知 main 基线：
`b65883d5e6435071acacd81e57d1921fc35a3574`

该 commit 对应 GitHub Actions **V3.9.x Verify SUCCESS**。

如果 main 已经继续推进，以最新 main 为准，但必须先比较最新改动和上述基线，不能覆盖/回退其他已完成工作。

不要让我重新复制以前聊天内容。GitHub handoff、报告、plans、tests、evidence 是当前项目记忆和维护上下文的权威来源。

---

# 1. 当前项目状态与不能丢失的进度

## 1.1 Engine Reactivity

此前已经完成多轮结构修复：

- SSH/SOCKS 已独立证明可完成 CONNECT/TLS/Binance TESTNET HTTP，不再作为当前默认根因。
- runtime checkpoint 全历史高频持久化已结构优化。
- Trading Quality 历史工作已移出主线程。
- private reconciliation all-row fan-out 已修复：
  - entry journal 每轮调用约 `2622 -> 1–4`
  - manual `141 -> 4`
  - claim stats `457–523ms -> 0.12–6.92ms`
  - completion publish `1460–1885ms -> 520–638ms`

但整体 Reactivity **仍 FAIL**：

- event-loop max 仍约 6.14 秒
- REQUIRED_MARKET 仍出现关键 timeout
- market freshness 未持续稳定
- 6.14 秒 stall 的唯一调用链仍 UNKNOWN

因此：

**Reactivity 专项目前 PAUSED。**

本次 V3.9.8 新主题不要顺带修 Reactivity，不要重新打开 SSH/SOCKS，也不要用调整交易参数去掩盖事实层不稳定。

## 1.2 Trade / Entry / Exit 质量复盘

最近已经完成只读交易质量复盘：

- AAVEUSDT LONG：更支持 BAD_ENTRY / DIRECTION_WRONG_EARLY，而不是简单“TP 太远”。
- ETHFIUSDC LONG：实际是 TP 部分成交 + 最终 MANUAL 平仓；当前 cycle-level provenance 聚合语义过粗，不能把 mixed exit 误解成真正 identity conflict。
- 当前开放持仓样本中曾观察到 19/21 已超过原 target horizon。
- 大量长期仓位已经 HUMAN_MANAGED，不能直接把“超 horizon”变成自动退出许可。
- 最近滚动周 closed records 的 funding 大量 UNKNOWN，canonical formal net 样本资格不足/为零，不能直接把这些收益结果喂给 Qwen 当训练真值。
- Qwen/PRIMARY 的 context age / run latency 有明显偏大现象，但尚不能直接推断 JIT 下单使用旧行情。
- `V397_ENTRY_EXIT_TP_QUALITY_OPTIMIZATION_PLAN_20261008.md` 定义了 P0–P4。
- P0 事实层纠错目前仍是后续重要工作，但本对话的新主题是 **V3.9.8 仓位数量与高周期方向位置质量**，先研究和设计，不要无意中把 P0/P1/P2/P3 全部一起实施。

---

# 2. 新主题：V3.9.8 建仓质量优化

我要解决一个新的、比“TP 太远”更基础的问题：

> 系统在周线级别已经处于明显高位时，仍可能大仓位建 LONG；
> 在周线级别已经处于明显低位时，仍可能大仓位建 SHORT。
>
> 一旦发生突然反向行情，错误方向的高杠杆/大仓位会把亏损迅速放大。
>
> 长时间持仓本身可以接受，但**巨大亏损和错误方向的过量仓位不可接受**。

本次重点不是先讨论 TP，而是：

**如何根据大周期位置、趋势、波动、方向、组合暴露和已有仓位动态决定“允许建多少仓”，而不是只有 PLACE / BLOCK 两种结果。**

---

# 3. 两个必须作为案例研究的真实持仓

## 案例 A — ETHUSDT LONG

- cycle first fill：2026-10-05 14:57:18
- 最近补仓：2026-10-06 23:44:23
- 累计补仓：5 次
- 进入 HUMAN_MANAGED：2026-10-05 18:00:51
- side：LONG
- 当前保护：PROTECTED / BINANCE_OPEN_ORDER
- 用户观察时浮亏约：`-$261.65`
- ROI 约：`-65.76%`

核心问题：

> 在更大周期可能已经处于较高位置的情况下，为什么系统允许 LONG 累积到如此大的风险暴露？
> 单次建仓或补仓是不是没有看到“周线位置已经很高 + 当前组合已经偏多”的事实？

## 案例 B — AVAXUSDT SHORT

- cycle first fill：2026-09-20 00:10:45
- 最近补仓：2026-10-08 12:15:44
- 累计补仓：25 次
- 进入 HUMAN_MANAGED：2026-09-20 01:16:05
- side：SHORT
- 当前保护：PROTECTED / BINANCE_OPEN_ORDER
- 曾经最大亏损约：`-$1000 USDT`
- 用户观察时已经恢复至约：`-$298.59`
- ROI 约：`-22.54%`

核心问题：

> 在周线级别低位区域，为什么允许 SHORT 继续扩大，而且累计补仓 25 次？
> 即使最终价格重新回落，期间巨大浮亏和资本占用也说明仓位预算可能缺少大周期方向/位置约束。

---

# 4. 第一阶段必须先收集事实，不要先提出固定参数

首先从当前 TESTNET 和 GitHub 代码中，完整、只读地收集：

## 4.1 当前全部持仓

每个 position 至少需要：

- symbol
- side
- quote asset
- first fill / openedAt
- holding duration
- origin Entry run / model identity
- current owner: AUTO / HUMAN / HANDOFF
- quantity
- leverage
- entry VWAP
- current executable price（仅 fresh 时）
- current notional
- approximate / exact margin facts（严格区分）
- unrealized PnL
- realized PnL / fees / funding status
- add count
- 每次 add 的时间、价格、数量、决策 run
- 当前 TP / protection
- target horizon
- position age / horizon ratio

尤其要重建：

**origin lot + 每一次 add lot**

不能用最终 VWAP 反推早期仓位，也不能把后续未来 quantity 用来计算早期风险。

## 4.2 当前 Entry / add-on 逻辑

检查：

- Primary candidate 的 quantity 是如何产生的
- allocation / sizing / leverage / margin / available funds 路径
- quote asset routing
- add-on / averaging 是否共享同一 cycle risk budget
- 每次补仓是否把已有 position risk 计算进去
- 是否存在“每次单独看来合法，但累计 25 次以后风险过大”的结构缺陷
- HUMAN_MANAGED 后是否仍可由自动逻辑继续增加风险，如有必须查明 authority
- 当前有哪些硬上限、软偏好、capital-at-risk、gross/notional、margin 规则被保留/取消

不要恢复此前已经明确取消的旧式 arbitrary veto。这里研究的是 **size scaling / exposure budgeting**，不是重新堆一套 PLACE veto。

## 4.3 历史交易与仓位路径

优先使用：

- TradeRecord
- execution fills
- entry orders
- allocation plans
- trade plans
- PRIMARY runs
- position reviews
- TQ facts
- available weekly/daily/4h/1h/15m closed bars
- MFE/MAE / holding / add histories
- quote asset utilization

区分 canonical / noncanonical / funding UNKNOWN。

没有资格的数据可以做诊断，但不能当正式收益训练标签。

---

# 5. 大周期“位置风险”必须研究，但不能只用一个指标

我要专门解决：

- 周线高位大仓位 LONG
- 周线低位大仓位 SHORT
- 趋势末端仍持续加仓
- 逆大周期方向补仓导致累积风险
- 同方向组合暴露过大

请设计并比较多种可以用于 **position sizing** 而非简单 veto 的技术方案。

至少研究以下维度：

## 5.1 Weekly / higher-timeframe location score

不要简单写“RSI > 70 不做多”。

应研究组合特征，例如：

- rolling 26w / 52w price percentile
- weekly close 在 rolling high-low range 的 percentile
- distance from weekly EMA20 / EMA50 / VWAP-like anchor
- weekly return z-score
- weekly ATR normalized extension
- Bollinger / robust z-score location
- distance from recent swing high / swing low
- realized volatility regime
- trend slope / ADX / directional persistence
- drawdown from rolling high
- rally from rolling low

形成一个可解释的：

`HigherTimeframeLocationScore`

以及方向相关的：

`DirectionalExtremityRisk`

例如：

- LONG 越接近周线极端高位，size multiplier 越低
- SHORT 越接近周线极端低位，size multiplier 越低
- 但强趋势 breakout 不能被“高位”机械当成反转，因此必须同时考虑 trend strength / regime

## 5.2 Trend × location 二维模型

重点比较：

- 高位 + 强上涨趋势
- 高位 + 趋势衰减
- 低位 + 强下跌趋势
- 低位 + 趋势衰减
- range high / range low
- breakout / trend continuation / mean reversion

不能把“高位”和“低位”本身当做方向真值。

目标是：

**位置决定风险尺寸，趋势/Setup 决定方向质量。**

## 5.3 Volatility-targeted sizing

分析是否应该按波动率缩放仓位：

`size ∝ riskBudget / expectedAdverseMove`

例如使用：

- weekly ATR
- daily ATR
- realized volatility
- downside semivolatility
- robust stress move

高波动时期相同名义仓位产生更大的美元风险，因此 size 应下降。

不要先拍脑袋选一个 ATR 倍数；先用历史分布校准。

## 5.4 Stress-loss / adverse-move budget

因为当前系统允许较长时间持仓，而且不一定以固定 stop loss 为主要机制，因此单纯：

`risk = stopDistance × qty`

可能不适用。

请研究一个更适合当前架构的：

**Stress Loss Budget**

例如：

`MaxAllowedNotional = CycleLossBudget / StressMovePct`

其中 StressMovePct 可来自：

- weekly downside quantile
- historical MAE distribution
- expected shortfall / CVaR
- regime-conditioned adverse move
- symbol volatility

这样即使没有固定 stop，也能限制一次错误方向大行情造成的损失。

## 5.5 Cycle-level cumulative risk budget

必须重点解决 AVAX “25 次补仓”的问题。

每个 cycle / underlying 应有一个总风险预算：

`CycleRiskUsed = Σ lot incremental stress risk`

每次 add 只能使用剩余预算：

`RemainingCycleRiskBudget = CycleRiskLimit - CycleRiskUsed`

不能每一次 add 都按“当前余额还够”重新获得完整仓位许可。

研究：

- add-on diminishing schedule
- risk-budget consumption
- max cumulative stress loss
- position age 对新增风险的惩罚
- adverse excursion 越大时是否应该禁止/极度缩小继续 averaging
- favorable move / confirmed edge 是否允许有限 scale-in

但不要直接恢复简单“亏损不能补仓”的硬 veto；先用事实和实验比较。

## 5.6 Portfolio / directional exposure budget

不仅看单一 symbol。

需要统计：

- total LONG notional
- total SHORT notional
- long-short net exposure
- gross exposure
- quote-asset exposure
- correlated exposure
- BTC/ETH beta exposure
- same-direction cluster exposure
- weekly-extreme same-direction exposure

例如多个 altcoin LONG 在周线高位可能本质上是一笔放大的 crypto beta LONG。

研究：

`PortfolioDirectionalRiskBudget`

和：

`CorrelationAdjustedExposure`

目标不是固定“最多 N 个仓位”，而是限制相同宏观风险因子的累计损失放大。

---

# 6. 不要只比较“平均降低仓位 / 线性降低 / 总额度”

我要比较至少这些 sizing 架构：

1. **Uniform haircut**
   - 所有仓位统一降低 X%
   - 作为最简单 baseline
   - 很可能浪费低风险机会

2. **Linear extremity scaling**
   - size 根据高周期位置线性降低

3. **Non-linear scaling**
   - sigmoid / piecewise / convex penalty
   - 接近极端区域时更快收缩 size

4. **Volatility targeting**
   - 固定风险而不是固定 notional

5. **Stress-loss budgeting**
   - 按 adverse move / CVaR 控制最大损失

6. **Cycle cumulative risk budget**
   - origin + all adds 共用一个风险桶

7. **Portfolio directional budget**
   - 控制 LONG/SHORT/相关性 cluster 总暴露

8. **Hybrid sizing**
   - 推荐重点研究：
   `
   FinalSize =
     BaseOpportunitySize
     × HigherTimeframeLocationMultiplier
     × VolatilityMultiplier
     × CycleRiskRemainingMultiplier
     × PortfolioExposureMultiplier
     × DataConfidenceMultiplier
   `

但不要把这个公式直接实现成最终答案。

先根据真实历史数据检验：
- 哪些 multiplier 真正有解释力
- 是否重复惩罚同一个风险
- 哪些应该作为 model input
- 哪些必须 deterministic
- 哪些只能是 soft preference

---

# 7. 关键原则：优先“缩量”，不是简单拒绝交易

当前 Primary Entry authority 必须保留。

这次设计优先目标是：

> 当模型方向可能仍有交易价值，但高周期位置/波动/组合风险明显不利时，
> **允许 Primary PLACE，但自动把可执行 quantity 缩小到与风险匹配的水平。**

只有真实物理/交易所/资金/授权事实才继续作为硬 fail-closed。

研究输出需要明确区分：

- HARD physical constraint
- deterministic max-risk bound
- soft sizing multiplier
- model-context evidence
- experiment-only feature

不要重新把 Direction / Cluster / historical claim / vague stress 等恢复成旧式 veto。

---

# 8. 重点研究“仓位数量”，而不是只研究杠杆

不要把“降低 leverage”误当成唯一解决方案。

必须分别讨论：

- quantity
- notional
- leverage
- margin usage
- liquidation distance
- stress loss
- portfolio gross exposure

在永续合约中，降低 leverage 不一定降低同样 notional 的价格风险；真正影响方向性 PnL 放大的核心是 **position notional / quantity**。

所以本 V3.9.8 主题优先设计：

**quantity / notional sizing engine**

杠杆是保证金与清算风险参数，不能代替仓位数量控制。

---

# 9. 对 ETH 和 AVAX 做逐 lot 反事实复盘

必须利用真实 lot 历史回答：

## ETHUSDT LONG

如果当时使用：

- 周线位置缩放
- volatility targeting
- cycle risk budget
- portfolio LONG exposure budget

origin 和 5 次 add 分别会得到多少 quantity？

对比：

- 实际最终 notional
- 实际最大/当前浮亏
- counterfactual 最大 stress loss
- 是否仍允许参与上涨机会
- 是否只是“少亏”，还是会导致明显 opportunity loss

## AVAXUSDT SHORT

同样逐 lot 重建 25 次 add。

特别回答：

> 为什么一个 cycle 可以积累 25 次 add？

比较：

- uniform haircut
- linear location sizing
- non-linear location sizing
- cycle risk budget
- stress-loss budget
- hybrid sizing

分别会在第几次 add 开始显著缩量，以及最终累计 notional / stress loss 会降到什么水平。

不要用未来价格调整过去参数；严格 point-in-time / no-lookahead。

---

# 10. 科学评估要求

不能只看“亏损少了”。

每套 sizing policy 至少评估：

- net PnL
- max drawdown
- position-level MAE
- portfolio MAE
- worst 1% / 5% stress loss
- expected shortfall / CVaR
- capital turnover
- margin utilization
- opportunity loss
- winning-trade size reduction
- losing-trade loss reduction
- long/short asymmetry
- weekly-extreme exposure
- number of adds
- cumulative cycle notional
- time under water
- human intervention rate

必须防止：

- lookahead
- survivorship bias
- 用最终 VWAP 回填早期
- 用未来 quantity 计算过去损失
- 多个 add 当成独立样本
- 同一趋势周期重复计数
- funding UNKNOWN 被补 0

建议采用：

- chronological / purged walk-forward
- regime stratification
- block bootstrap
- out-of-sample time block
- shadow sizing

---

# 11. 第一轮输出：先讨论与形成设计，不直接改线上策略

这次新对话第一阶段请先：

1. 从 GitHub 和 TESTNET 当前只读事实收集数据；
2. 复原当前 sizing / add / allocation 架构；
3. 对 ETH LONG、AVAX SHORT 做逐 lot 案例分析；
4. 对全部当前/近期仓位统计 higher-timeframe location、方向、size、MAE；
5. 比较 uniform / linear / nonlinear / volatility / stress / cycle / portfolio / hybrid 八类方案；
6. 给出推荐架构；
7. 形成 V3.9.8 实施计划。

先不要直接部署。

建议生成：

`docs/reports/v398-entry-sizing-quality-review/ENTRY_SIZING_QUALITY_REVIEW.md`

`docs/plans/V398_ENTRY_SIZING_RISK_BUDGET_PLAN.md`

如需要中间 JSON / CSV / scripts / logs，也全部放在：

`docs/reports/v398-entry-sizing-quality-review/`

或仓库中合适的 `scripts/` 路径。

---

# 12. 本地文件与日志规则 —— 必须遵守

如果需要我在 Windows 本机 `D:\MITS` 配合执行命令：

- 不要让我复制长控制台输出；
- 给我 PowerShell 命令，将完整 stdout+stderr 保存为 `.log` / `.txt` / `.json` / `.csv`;
- 推荐：
  `<command> *>&1 | Tee-Object -FilePath <path>`
- 我只上传生成的文件；
- 你读取后，凡属于项目维护证据、分析数据、报告、脚本、profile、测试结果的文件，最终都必须提交回 GitHub 项目；
- 不能让关键证据只留在本地聊天或临时目录；
- 涉及密钥、token、私钥、cookie、账号秘密时必须脱敏，绝不能提交秘密。

如果使用独立 worktree，最终也要把有价值的产物普通 commit/FF/cherry-pick 回适当 GitHub branch/main，不留下只有本地才存在的结果。

---

# 13. 项目硬约束

必须继续遵守：

- TESTNET only
- Production writes = 0
- 不删除/reset SQLite / TradeRecord / execution history
- unresolved submit UNKNOWN 不允许 duplicate submit
- User Data WS 为优先 order truth
- public WS 为优先 quote/book/kline truth
- REST exact-order 仅 fallback/recovery
- 不恢复 static egress-IP authorization / NET-003 / NET-004
- Primary 仍是 Entry authority
- Primary 已给出有效 PLACE 后，后置模块不能重新以主观“质量”否决；本主题的 sizing 必须在 frozen executable candidate / quantity 形成阶段进入，或作为已授权 deterministic quantity bound，而不是 PLACE 后二次审判
- 真实资金、交易所合法性、授权、环境隔离、订单 identity/idempotency 保持 fail-closed
- UNKNOWN 不得乐观解释
- REVIEW_BRAIN 不成为第二 Entry veto
- HUMAN_MANAGED 不得被自动 TP/Exit/加仓逻辑越权
- F04/F10/F11 暂停状态保持，除非本次有明确新授权
- Reactivity 6.14s stall 问题保持独立，不在本轮顺便修改

---

# 14. 新对话的第一条回复要求

不要直接给最终参数。

先：

1. 读取上述 GitHub 文件；
2. 报告最新 main / CI / 当前运行与数据可用性；
3. 用当前代码指出 quantity / allocation / add-on / portfolio exposure 的实际决策链；
4. 告诉我为了回答“周线高位 LONG / 周线低位 SHORT 如何缩量”还缺哪些事实；
5. 直接开始只读收集，不要求我重新解释项目；
6. 然后给出第一版架构讨论，重点回答：

> 这个问题最适合用“平均降低仓位”、线性缩量、非线性缩量、总仓位额度、stress-loss budget、cycle risk budget、portfolio directional budget，还是混合方案？

任何结论都必须把“方向质量”和“仓位大小风险”分开。

目标不是让系统永远不在高位做多、低位做空，而是：

**即使方向判断错了，也不能因为高周期极端位置 + 大仓位 + 多次补仓，把错误放大成无法接受的巨大亏损。**

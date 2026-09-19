# ZDJ-MITS V3.9.5｜ENFORCE 正向闭环 Canary V2｜Codex 实施提示词

你现在继续执行 ZDJ-MITS V3.9.5 下一轮：**ENFORCE 正向闭环 Canary V2**。

## 最高原则：自主推理，允许反驳

本文件给出的候选筛选、20 次尝试、25 USDT margin 都是基于现有证据的实验设计，不是要求你“必须制造 passed=true”。

你必须以：
- 当前源码；
- 当前 live runtime；
- 当前账户敞口；
- 当前真实 SHADOW / ENFORCE evidence；
- Binance Testnet 客观事实

为最高依据。

如果事实证明本实验此刻不可执行、不安全、统计设计无效，**直接反驳并停止**。禁止为了完成任务降低安全阈值或人为制造正向样本。

---

## 已验证事实

上一轮报告：

`docs/reports/v395-enforce-positive-path-canary-20260919.md`

已确认：

- 8 条真实 ENFORCE evaluation；
- 0 passed=true；
- 7/8 大尺寸样本的 `expectedNetProfit >= $1`；
- `historicalHardMaxMove` 8/8 不是 blocker；
- 实际主要 blocker 已收敛为 `TP_REACH_PROBABILITY_UNMET`；
- `minHistoricalReachProbability=0.50` 未被改动；
- 旧仓/TP/UNKNOWN/durable claim/429/418/egress 全部无异常；
- Canary 自动恢复成功；
- 25 USDT margin 已被 live 证明足够给 AI 提供约 $200 notional 包络；
- AI 自主决定真实 quantity，margin 只是上限；
- 上一轮 VVV 历史联合通过概率约 25%，8 次全拒并不罕见；
- 正向链仍缺：
  `passed=true → EntryIntent → JIT economics → Maker submit → fill/Position → economicAdmission → economic TP`。

上一轮明确流程修正：

`maxPositions` 必须按 **`entryCapacity().used + 1`** 设置，不得按 position count + 1 猜。

---

# Stage 1｜只读实时可执行性门禁

先不改 Settings。

读取：

- exact HEAD / buildId / PID / instanceId
- settingsVersion
- equity
- gross / LONG / SHORT notional
- gross / LONG / SHORT remaining headroom
- current `entryCapacity().used`
- positions / pending / reservations
- HUMAN_MANAGED / AUTO_MANAGED
- active durable claims
- unresolved risk
- 429/418
- egress
- 当前候选池

### 必须满足

至少存在一个方向的客观剩余 headroom，可以容纳约 $200 新 notional。

**不要因为 SHORT headroom 很低而人工处置 SHORT。**

只要 LONG 或 SHORT 任一方向有足够客观容量，Pre-AI side-neutral envelope 应把客观容量给 AI，由 AI 自主选择。

如果两个方向都不足：

`POSITIVE_CANARY_NOT_EXECUTABLE_NOW`

直接报告并停止。

禁止修改：

- `maxGrossExposurePct`
- `maxDirectionExposurePct`
- 任何现有仓位
- HUMAN_MANAGED

---

# Stage 2｜预先冻结候选排名，禁止结果驱动选币

在进入 ENFORCE **之前**，用当前已有历史 evidence 对“当前无持仓、无 pending、无 active claim、market quality admitted”的候选做排名。

核心排序指标：

`P(reachProbability >= 0.50 AND expectedNetProfit >= 1 at realistic AI size)`

同时考虑：

- 样本数；
- market quality；
- spread 稳定性；
- liquidity；
- historical hard reach；
- 当前 objective side capacity。

输出 top candidates 和统计依据。

### 预注册规则

Canary 开始前就确定：

- 首选标的；
- 备用标的（最多 1 个）；
- 每个标的最大尝试数；
- 总尝试数上限。

禁止看到 ENFORCE 结果后不断换标的“追 passed=true”。

建议总 attempt budget：

**最多 20 条真实 `ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}`**

建议分配：

- 首选最多 12 次；
- 若首选因 spread/market quality 长时间不可用，或 12 次均未通过，则最多切一次到预先选好的备用标的；
- 备用最多占剩余 8 次。

你可以根据历史通过概率反驳 12+8，但必须在 ENFORCE 开始前固定方案。

---

# Stage 3｜Canary margin

默认使用：

- `entryMarginUsd=25`
- `maxMarginPerPositionUsd=25`
- `dynamicMarginEnabled=false`

理由：上一轮已 live 证明在自然 AI 大尺寸下，约 $198 notional 的 7/7 样本均通过 $1 净利门槛。

你可以基于最新成本和目标位移重新计算并反驳 25，但：

- hard max margin = **25 USDT**
- 不得提高 leverage
- 不得降低 `minNetProfitUsd=1`
- 不得人为增加 quantityUnits
- 不得移动 target

如果 25 在当前事实下仍不足，停止实验，不突破上限。

---

# Stage 4｜隔离

继续复用已 live 验证的：

`selection.mode=CUSTOM_SYMBOLS`

一次只开放当前 Canary 标的。

必须先验证：

- 非 Canary 标的 Entry path events = 0；
- Position / TP / reconciliation / account / WS 继续正常。

不要使用 entry-only pause，因为它会连 Canary 一起冻结。

设置：

- `maxPositions = entryCapacity().used + 1`
- `maxPendingEntries=1`

注意：在真正 PUT 前重新读取一次 `entryCapacity().used`，避免旧值。

---

# Stage 5｜临时 HUMAN cap 例外

只有隔离验证成功后才允许：

`humanManagedAdmissionCapsEnabled=false`

随后：

`tradeEconomics.admissionMode=ENFORCE`

保持：

- `maxHumanManagedPositions=4`
- `maxHumanManagedNotionalPctEquity=0.20`
- `minNetProfitUsd=1`
- `minHistoricalReachProbability=0.50`
- `parameterProfile=CUSTOM`

HUMAN cap 例外只用于隔离历史人工仓对本次新 Entry economics 的干扰。

---

# Stage 6｜核心目标

优先获取第一条真实：

`ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE, passed:true}`

### passed=false

正常记录：

- expectedNetProfit
- requiredNetProfit
- reachProbability
- historicalHardMaxMovePercent
- blockers
- AI side / quantity / range / target / horizon

禁止调参重试。

### passed=true

立即完整跟踪：

`passed=true`
→ `ENTRY_INTENT_CREATED`
→ JIT economics
→ `FINAL_ORDER_RISK_EVALUATED` 或 `ENTRY_ORDER_BLOCKED`
→ durable task
→ Maker submit
→ exchange order

---

# Stage 7｜JIT 是本轮第一验收目标

必须验证实际 Maker 价格下的 economics。

对首条 passed=true：

### 情形 A：JIT 通过

看到：

- passed=true admission
- EntryIntent
- `FINAL_ORDER_RISK_EVALUATED`
- `ENTRY_SUBMIT_ATTEMPTED`

证明实际委托价仍满足 economics。

### 情形 B：JIT fail-closed

看到：

- passed=true admission
- EntryIntent
- `ENTRY_ORDER_BLOCKED{stage:'BINANCE_SUBMIT', reason:<economic blocker>}`
- 无 `FINAL_ORDER_RISK_EVALUATED`
- 无交易所 submit

这同样是**有效 PASS**，因为它证明价格变化不能绕过 ENFORCE。

禁止为了让 JIT 通过改 Maker 价、target、quantity 或门槛。

---

# Stage 8｜Maker / fill / Position 是第二验收目标

如果 JIT 通过并提交：

记录：

- new intentId
- new durable task identity
- new clientOrderId
- Maker price
- quantity
- order status

不要求强制成交。

若自然成交形成 Position，则继续验证：

`economicAdmission` 必须持久化：

- version = V3.9.5
- mode = ENFORCE
- passed = true
- blockers = []
- expectedNetProfit
- requiredNetProfit
- reachProbability
- historicalHardMaxMovePercent

---

# Stage 9｜economic-validated TP

仅当新 ENFORCE Position 自然形成时验证。

检查：

- TP 是否使用 AI profitTakePlan；
- 若 AI TP < legacy 1.2%，只有带有效 ENFORCE economicAdmission 的新仓才允许；
- 不代表必须低于 1.2%；
- target/range 不得被无理由改写；
- economics 必须仍满足；
- 旧仓仍使用 legacy 规则；
- 旧仓 TP 零影响。

如果订单未成交：

TP 正向腿标记 `NOT_OBSERVED`，不得伪造 PASS。

---

# Stage 10｜尝试预算与停止条件

总 ENFORCE economic evaluation：

**最多 20 次。**

提前停止条件：

1. 已取得一条 passed=true 并完成 JIT 结论；
2. 若 JIT 通过并已提交 Maker order，可结束主要实验，不必为了成交长时间等待；
3. gross / direction headroom 不再足够；
4. egress 非 VERIFIED；
5. 429/418 持续新增；
6. old TP 出现异常；
7. reconciliation / active risk 异常；
8. 预注册候选全部因真实 market quality 不再适用。

不要固定等待几小时。

如果 20 次仍 0 passed=true：

这是有效统计结果。

必须输出：

- 实际 blocker 分布；
- 20 次 reachProbability 分布；
- 根据预注册历史通过率计算“20 次全拒”的概率；
- 判断是样本偏差、候选画像变化，还是 0.50 阈值在当前市场确实过严。

**不要因此自动降低 0.50。**

---

# Stage 11｜恢复

必须放在 finally。

恢复全部原值：

- `admissionMode=SHADOW`
- `humanManagedAdmissionCapsEnabled=true`
- selection.mode
- customSymbols
- maxPositions
- maxPendingEntries
- entryMarginUsd
- dynamicMarginEnabled
- maxMarginPerPositionUsd
- minNetProfitUsd=1
- minHistoricalReachProbability=0.50

逐字段验证。

恢复后必须确认：

- normal Entry 调度恢复
- old positions/TP 正常
- Account READY
- WS LIVE
- reconciliation READY/SETTLED
- egress VERIFIED
- productionWrites=0
- 429/418 无异常增长

---

# Stage 12｜本轮明确不做

不要：

- 人工处理 SHORT 仓位；
- 修改 gross/direction 风险限额；
- 调低 reachability 0.50；
- 调低 $1；
- 提高 leverage；
- 调整 HUMAN cap 数值；
- 自动平 HUMAN_MANAGED；
- 改 notional/margin 语义；
- 改 AI 自主权；
- 改唯一退出链；
- 删除 historical UNKNOWN；
- 为拿 passed=true 做结果驱动选币。

---

# Stage 13｜Codex 自主反驳

你可以反驳：

- 20 次是否足够；
- 12+8 的候选分配；
- 25 USDT 是否仍最合适；
- VVV 是否还应入选；
- 当前是否值得执行 Canary。

但任何反驳都必须在 **ENFORCE 开始前**给出证据和替代实验设计。

不得反驳硬安全边界。

---

# 最终报告

只输出：

A. 实验前 gross/LONG/SHORT headroom  
B. `entryCapacity().used` 与 maxPositions 计算  
C. 预注册候选 top 排名与联合通过概率  
D. 最终 attempt budget / 分配 / 理由  
E. Canary margin 与经济性计算  
F. ENFORCE evaluation 总数  
G. passed=true / false 数量  
H. blocker 分布  
I. reachProbability 分布  
J. 是否得到 passed=true  
K. AI side / quantity / range / target 是否保持自主  
L. EntryIntent 是否创建  
M. JIT economics 结果  
N. FINAL_ORDER_RISK_EVALUATED 是否出现  
O. Maker submit/order/fill 结果  
P. 若形成 Position：economicAdmission 持久化结果  
Q. economic TP 是否观测  
R. old TP 是否零影响  
S. durable claims / UNKNOWN  
T. 429/418 / egress  
U. 是否完整恢复 SHADOW + HUMAN cap + 原 Settings  
V. 若 20 次仍全拒：全拒概率与原因分析  
W. 是否已经具备进入“正式 ENFORCE 参数/策略裁决”的证据条件  
X. Codex 对当前设计或本实验方案的反驳与建议

报告保存：

`docs/reports/v395-enforce-positive-loop-canary-v2-20260919.md`

提交 GitHub。

完成后停止并执行：

`D:\MITS\scripts\notify.ps1`

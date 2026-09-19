# ZDJ-MITS V3.9.5｜ENFORCE 正向链路 Canary 实施提示词

你现在继续执行 ZDJ-MITS V3.9.5 下一轮：**受控验证 ENFORCE 的正向执行链路**。

## 最高原则：允许自主推理和反驳

下面给出的 15–25 USDT、候选标的、执行顺序都只是**当前假设，不是不可违背的结论**。

你必须以：
- 当前源码；
- 当前 live runtime；
- 当前账户/敞口；
- 当前真实 SHADOW/ENFORCE evidence；
- Binance Testnet 客观事实

为最高依据。

如果事实证明我的建议不合理、不安全、数学上不成立或无法形成有效实验：

**直接反驳建议并停止，不要为了完成任务强行制造 passed=true。**

你可以在本提示词安全边界内自主调整：
- Canary 标的；
- Canary 保证金（但不得超过本文件定义的上限）；
- Canary 时机；
- Canary maxPositions = 当前持仓数 + 1；
- 数据采样方式；
- 是否执行 Canary。

不需要为了这些范围内的调整再询问。

---

## 当前已验证事实

上一轮受控 ENFORCE Canary：

- 报告：`docs/reports/v395-controlled-enforce-canary-20260919.md`
- ENFORCE evaluation 真实发生 3 次；
- 3/3 `passed=false`，真实 fail-closed；
- 0 EntryIntent / 0 submit / 0 order / 0 fill；
- AI side / quantityUnits / acceptablePriceRange / target 未被覆盖；
- durable claim 正常；
- 旧仓 TP 零影响；
- 429/418 零新增；
- egress 全程 VERIFIED；
- 结束后自动恢复 SHADOW + HUMAN cap。

上一轮没有验证到的唯一关键正向链：

`passed=true → EntryIntent → JIT economics → Maker order → fill/position → economicAdmission persistence → V3.9.5 TP`

两个已知约束：

1. 当时组合 gross / direction exposure 无 headroom，导致大量候选在 economics 前就被拒绝。
2. 5 USDT × 约 8x 只有约 40 USDT notional；在 `minNetProfitUsd=1` 下，AI 自然 0.68%–1.72% target move 通常不足以满足净利门槛。

---

# Stage 1｜先做正向 Canary 可行性裁决

**先只读，不改 Settings。**

读取当前 live：

- exact HEAD / buildId / PID / instanceId
- settingsVersion
- positions / pending entries
- gross notional
- long notional
- short notional
- equity
- `maxGrossExposurePct`
- `maxDirectionExposurePct`
- gross remaining headroom
- LONG remaining headroom
- SHORT remaining headroom
- HUMAN_MANAGED / AUTO_MANAGED
- historical UNKNOWN
- active durable claims
- current candidate pool
- 最近全部 SHADOW economics evidence
- 最近 ENFORCE Canary evidence

必须先回答：

**现在是否存在不修改 gross/direction risk limits 就可以新增一笔 Canary 的真实 headroom？**

如果答案是否：

- 不修改 `maxGrossExposurePct`；
- 不修改 `maxDirectionExposurePct`；
- 不减仓；
- 不自动平 HUMAN_MANAGED；
- 不等待数小时；

直接判定：

`POSITIVE_CANARY_NOT_EXECUTABLE_NOW`

并写报告后停止。

不要为了拿正向样本放宽组合风险预算。

---

# Stage 2｜自主计算 Canary 最小可行保证金

15–25 USDT 只是上一轮建议，你必须重新计算。

基于：

- `minNetProfitUsd=1`
- 当前 maker/taker/有效交易成本
- 当前 leverage
- 当前真实 AI target move 分布
- 当前 acceptablePriceRange
- 当前 reachability
- 当前风险 headroom

计算：

`requiredNotional(targetMove, fees, minNetProfitUsd)`

以及：

`requiredMargin = requiredNotional / leverage`

至少用近期真实 AI 目标位移分位数：

- p25
- p50
- p75

分别计算最低保证金。

然后决定本轮 Canary 保证金。

### 安全限制

本轮 Canary 保证金：

- 优先在 **15–25 USDT** 中选最小可行值；
- **硬上限 25 USDT**；
- 如果客观计算表明 25 USDT 仍不足以让合理的自然 AI target 有机会达到 $1 净利，则不要突破 25，直接停止并反驳“15–25 可行”的建议。

禁止：

- 通过增加 leverage 弥补 economics；
- 通过扩大 AI target 弥补 economics；
- 通过增加 AI quantityUnits 超出 envelope；
- 通过降低 $1 门槛；
- 通过降低 reachability 0.50。

---

# Stage 3｜自主选择 Canary 标的

从当前真实候选中选择 1 个 underlying。

选择条件：

- 当前无持仓；
- 无 pending entry；
- 无 active durable claim；
- 无 unresolved risk；
- market data READY；
- market quality admitted；
- 有 gross/direction headroom；
- 近期 SHADOW evidence 中 economics/reachability 相对合理；
- 不要求历史上固定使用 FILUSDT。

你可以反驳 FILUSDT。

**不得人工指定方向。**

Primary AI 继续自主决定：

- LONG / SHORT
- quantityUnits
- acceptablePriceRange
- idealPrice
- targetPrice
- target range
- horizon

---

# Stage 4｜隔离方式继续复用已验证机制

复用上一轮已经 live 验证通过的隔离：

`selection.mode = CUSTOM_SYMBOLS`

`selection.customSymbols = [唯一 Canary 标的]`

不要使用 entry-only pause，因为已经证明它会冻结 Canary 本身。

Canary 期间：

- 普通 Entry 必须为 0；
- Position / TP / reconciliation / market / account / WS 正常运行。

`maxPositions` 应动态设置为：

`当前持仓数 + 1`

而不是固定 1。

`maxPendingEntries = 1`

`dynamicMarginEnabled = false`

`entryMarginUsd = 自主计算出的 Canary margin`

`maxMarginPerPositionUsd = 同一 Canary margin`

---

# Stage 5｜临时 HUMAN cap 例外

当前 HUMAN_MANAGED 历史账本仍可能超过 20%。

只有在：

**CUSTOM_SYMBOLS 隔离已经客观验证生效**

之后，才允许 Canary 窗口临时：

`humanManagedAdmissionCapsEnabled=false`

这只是为了剥离历史 HUMAN 账本对“新 economics 正向链”的干扰。

禁止改：

- `maxHumanManagedPositions=4`
- `maxHumanManagedNotionalPctEquity=0.20`

Canary 后必须恢复：

`humanManagedAdmissionCapsEnabled=true`

---

# Stage 6｜进入 ENFORCE

设置：

- `admissionMode=ENFORCE`
- `parameterProfile=CUSTOM`
- `minNetProfitUsd=1`
- `minHistoricalReachProbability=0.50`
- `historicalTpReachabilityEnabled=true`

优先热应用，不为实验主动重启 Engine。

如代码事实证明必须重启才能生效，允许一次受控重启，但必须重新验证 startup egress。

---

# Stage 7｜实验目标：优先拿到 passed=true，但绝不强求

本轮首要观察：

`ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}`

如果 `passed=false`：

- 记录真实 blocker；
- 不调参数；
- 不重复调用直到碰巧通过；
- 可以继续等待系统**自然**产生少量后续 AI 决策，但不要长期等待。

如果出现 `passed=true`：

立即完整追踪：

`ENFORCE passed=true`
→ `ENTRY_INTENT_CREATED`
→ JIT execution/economics
→ durable claim
→ Maker submit
→ exchange order
→ fill / no fill
→ Position
→ economicAdmission
→ TP Guardian

---

# Stage 8｜必须验证 JIT economics

这是上一轮没有 live 证明的重点。

对 `passed=true` 样本：

记录 Pre-AI / Post-AI economics 与最终 Maker order price。

确认 JIT 使用**实际委托价**重新计算：

- expectedNetProfit
- requiredNetProfit
- reachability
- hardMaxMove
- blockers

结果必须满足：

- JIT 若失败 → 不提交/停止执行；
- JIT 若通过 → 才允许交易所写入；
- 不修改 AI quantity；
- 不修改 AI target；
- 不修改 AI direction。

如果 Pre-AI passed=true，但 JIT 因价格变化变为 fail：

这是一个有效且重要的 PASS（证明 JIT fail-closed），不要认为 Canary 失败。

---

# Stage 9｜若形成新 Position，验证 V3.9.5 economic TP

如果订单自然成交并形成 Position：

确认 Position 持久化：

- `economicAdmission.version=V3.9.5`
- `mode=ENFORCE`
- `passed=true`
- blockers empty
- expected/required profit
- reachProbability
- historicalHardMaxMovePercent

然后验证 TP：

- AI TP 可以在 economics 合法时低于 legacy 1.2% floor；
- 不得因此强制低于 1.2%；
- 仍必须在 AI target/range 内；
- economics 必须满足；
- 旧仓没有 ENFORCE evidence 的继续 legacy 规则；
- 旧仓 TP 不得被重建/拉远。

如果新仓未成交，则 TP 正向腿记为未观测，不得伪造 PASS。

---

# Stage 10｜实验停止条件

满足任一即结束 Canary：

1. 获得 1 条完整 `passed=true` 并完成 JIT 结论；
2. 获得 1 条 `passed=true` 且订单成功提交；
3. 连续获得足够事实证明当前候选仍全部被 economics/reachability 拒绝；
4. 当前 gross/direction headroom 消失；
5. 出现任何 safety anomaly；
6. 429/418 出现持续新增；
7. egress 失去 VERIFIED；
8. 旧仓 TP 出现异常。

不要固定等待几小时。

---

# Stage 11｜自动恢复

无论任何结果，finally 必须恢复：

- `admissionMode=SHADOW`
- `humanManagedAdmissionCapsEnabled=true`
- 原 selection.mode
- 原 customSymbols
- 原 maxPositions
- 原 maxPendingEntries
- 原 entryMarginUsd
- 原 dynamicMarginEnabled
- 原 maxMarginPerPositionUsd
- `minNetProfitUsd=1`
- `minHistoricalReachProbability=0.50`

逐字段核对恢复值。

恢复后：

- normal Entry 调度恢复；
- old positions/TP 正常；
- Account READY；
- WS LIVE；
- reconciliation READY/SETTLED；
- egress VERIFIED；
- productionWrites=0。

---

# Stage 12｜Codex 有权反驳的范围

你可以基于证据明确反驳以下建议：

- “15–25 USDT 一定足够”；
- “FILUSDT 仍是最佳 Canary 标的”；
- “现在一定有 exposure headroom”；
- “必须拿到成交才算成功”；
- “必须继续等待直到 passed=true”。

如果反驳，必须给：

- 源码依据；
- runtime 数据；
- 算术；
- 更安全/更有效的替代方案。

但不得反驳以下硬边界：

- 不改 gross/direction risk limits；
- 不自动处理 HUMAN_MANAGED；
- 不改 $1；
- 不改 reachability 0.50；
- 不改 AI 自主权；
- 不进入生产；
- Canary 后恢复 SHADOW + HUMAN cap。

---

# 最终报告

只输出：

A. 当前 gross / long / short headroom
B. 是否具备正向 Canary 客观条件
C. 是否反驳 15–25 USDT 建议；计算依据
D. 最终 Canary margin 与理由
E. Canary 标的与理由
F. ENFORCE evaluations 数量
G. passed=true / passed=false 数量与 blockers
H. 是否出现 `passed=true`
I. 若 passed=true：AI 原始 side / quantity / range / target
J. JIT economics 结果
K. 是否创建 EntryIntent
L. 是否提交 Maker order
M. 是否建单/成交/形成 Position
N. economicAdmission 是否持久化
O. TP 是否进入 V3.9.5 economic-validated 路径
P. 旧仓 TP 是否零影响
Q. durable claims / UNKNOWN 是否正常
R. 429/418 / egress
S. 是否完整恢复 SHADOW + HUMAN cap + 原 Settings
T. 是否已经具备进入“正式 ENFORCE 策略参数决策”的证据条件
U. Codex 对现行设计/我的建议有哪些反驳或改进建议

报告保存：

`docs/reports/v395-enforce-positive-path-canary-20260919.md`

提交 GitHub。

完成后停止，并执行：

`D:\MITS\scripts\notify.ps1`

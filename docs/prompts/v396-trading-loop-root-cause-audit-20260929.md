# V3.9.6 交易闭环与 Entry 权限复杂度根因审计

基准仓库：`3684993/ZDJMITS`
基准分支：`main`
已知基准 SHA：`417694b68742e1c5be4a4eb22391f9506ebaa21d`

## 任务性质

本轮只做审计、根因定位和后续实施计划，不修改业务代码、运行配置或交易参数。

必须阅读当前 `main` 的真实代码、测试、运行报告、驾驶舱实现和可用运行证据，核实下面现象是否真实存在。不要把本文件中的怀疑当作结论。

根因确认后，请独立提出解决方案并形成实施计划文件，供人工审核和后续其他模型实施。本轮不执行该计划。

## 需要核实的问题

### 1. 平仓频率明显低于建仓频率

当前驾驶舱显示：持仓 55、活动委托 67；最近 1 小时 Entry fills=12，但 Exit fills=0、Closed trades=0；浮动盈亏约 -$681。

核实系统是否存在“持续建仓、退出闭环不足”的结构性问题，并定位问题实际发生于哪一层：Exit 决策、止盈/止损参数、持仓复核、保护单、reduce-only 下单、订单维护、成交归因、reconciliation、Closed Trade 生成或其他环节。

同时核实是否真实发生过 Exit fill，但没有被正确归因为平仓。

### 2. 止盈/退出参数是否导致持仓时间异常增长

驾驶舱当前显示 `止盈保护=DEGRADED`。

核实：
- 当前 TP/SL/动态退出参数的实际生成逻辑和分布。
- 是否存在目标距离长期脱离实际波动、长期无法触发或反复 reprice 后仍无法成交。
- 是否有持仓缺少有效 Exit/TP/SL，或订单被取消、过期、失联、未补建、未关联、长期 WORKING。
- 长持仓是否与止盈参数、波动、方向、浮盈亏存在明显关联。

不要预设止盈一定有问题，以证据为准。

### 3. AI 决策质量是否造成长期持仓

核实：
- Entry AI 与 Exit/持仓管理 AI 的分析链、模型、上下文、触发频率、资源优先级是否不同。
- AI 是否持续产生 Entry，却很少产生主动 Exit/Reduce。
- 已建仓后是否有足够频率重新评估原始交易假设是否失效。
- 是否存在长期亏损或长期横盘仍持续维持的持仓。
- 是否出现 AI 已决定退出，但后续执行链没有执行。
- 用历史决策、持仓时长、Entry/Exit reasoning 和实际 PnL 区分“模型决策问题”与“确定性执行问题”。

### 4. 持仓生命周期缺少累计持有时间可视化

核实待人工处置/持仓界面是否缺少清晰的当前 lifecycle 持有时间，例如 `3小时`、`1天6小时`、`7天`。

核实当前数据是否已有可靠的 openedAt / firstFillAt / lifecycle start；多次加仓、部分平仓、重新开仓、同 symbol 多 lifecycle 时是否能准确计算当前持仓持续时间。

核实长持仓是否与低 Exit 频率存在直接关系。

如果问题确认存在，后续实施计划需覆盖该 UI 需求，但本轮不要修改 UI。

### 5. 新建仓执行权限是否过度复杂

当前新建仓权限同时暴露多个层级和概念，包括：自动执行模式、分析管线、Entry Safety、execution readiness、portfolio risk profile、资金/保证金、route、lease/reservation、gross/direction/cluster、slot/pending、authoritative blocker、planned notional、candidate capacity、policy/exposure/location/allocation/AI/Entry、authorization、identity、private facts、exchange legality 等。

V3.9.6 已将多项 portfolio/history 风险在 TESTNET funds-only 模式下降级为观察，但代码、状态机和驾驶舱仍保留大量旧概念。

核实：
- 当前真正能够阻止 TESTNET Entry 的条件到底有多少个。
- 哪些字段只是观察值，哪些仍真实参与 veto。
- 是否多个模块重复判断同一事实。
- 是否旧门禁已经失去 veto 权限，但仍存在于代码、状态机、指标或 UI 准入路径。
- Capital Admission、Risk、Readiness、Reservation、Final Submit 是否对同一事实重复判定。
- 是否存在不同模块对同一 Entry 得出互相矛盾状态。
- 当前复杂度是否与 authorization 过期、排队、状态漂移或维护困难有关。

必须形成“真实 Entry veto 图谱”：每个实际 veto 的代码路径、输入、输出、调用顺序、TESTNET/Production 作用范围。

### 6. 遗留、重复或语义已经改变的门禁

重点核实以下概念现在是否仍参与 Entry 或 Exit 的真实阻断：
UNKNOWN、pending/history risk、Gross、Direction、Cluster、Human Potential、Stress、Capital-at-Risk、position count、pending entry count、slot、historical claim、risk proof、risk admission unavailable、duplicate underlying、active position、reservation/lease 重复限制、portfolio risk profile generation/snapshot/ticket。

对每项只做事实分类：
- 执行正确性/交易所合法性/真实资金所必需的控制；
- 仅用于观察或诊断；
- 已失去 veto 权限但仍残留在路径；
- 与其他阶段重复实现；
- 可能错误影响 Exit/Reduce/TP/SL/Cancel-Replace/Reconciliation。

可以在后续实施计划中提出架构简化或合并建议，但不得削弱真实资金与保证金约束、交易所合法性、私有数据真实性与新鲜度、订单身份与幂等、授权有效性、TESTNET/Production 环境隔离等执行正确性边界。

### 7. 驾驶舱 Entry 状态互相矛盾

当前同时出现：
- 槽位 56/50，但首个饱和硬维度 NONE；
- LONG/SHORT 最终新增容量均 $0 / PLANNED_NOTIONAL；
- 同时显示“LONG 与 SHORT 均可新增”；
- 同时显示“仍有空间”；
- USDT 一处显示 lease 占用后可执行保证金为 $0，另一处又显示约 $4,006；
- LONG/SHORT 逐候选容量为空白。

核实这些字段的 source-of-truth、快照时间、计算路径，并判断哪些只是展示错误、哪些会真实影响交易。

### 8. Entry 漏斗语义矛盾

当前 30 分钟漏斗：Primary 21、PLACE 21、风险准入通过 0、TradePlan 19、Reservation 19、Intent 19、Submit 8、Fill 8；最大流失 `AI_AUTHORIZATION_EXPIRED=4`。

核实：
- 风险准入通过为何为 0，却继续进入后续阶段。
- 这是 funds-only 后的正常语义变化还是漏斗失真。
- 是否旧阶段虽不再具有 veto 权限仍被计入漏斗。
- `AI_AUTHORIZATION_EXPIRED` 的真实根因来自 AI 耗时、排队、共享资源、授权生命周期、状态机等待或其他原因。

### 9. Entry 与 Exit 是否存在调度/模型资源竞争

当前可观察到 `AI_BUSY`、`PRIMARY_RESOURCE_BUSY`，Primary 持续处理候选。

核实：
- 新 Entry 分析是否长期占用模型、scheduler 或共享资源。
- Exit、持仓复核、TP维护是否拥有独立调度保障。
- 候选持续不断时，已有持仓的退出分析是否可能被饿死或频率显著下降。
- 是否形成“开仓活跃、平仓迟钝”的调度结构。

### 10. Exchange reconciliation 与资金费状态异常

驾驶舱当前显示 `交易所对账=DEGRADED`，并有 `192 笔资金费未确认`。

核实：
- 资金费长期未确认是否属于真实对账缺口。
- Exit fill、部分成交、reduce-only、订单终态、position lifecycle 是否可能因相同 reconciliation 问题没有正确闭环。
- 是否存在交易所事实已发生，但本地状态未推进。

### 11. 55 持仓 / 67 活动委托的结构是否健康

核实：
- 每个持仓对应多少活动 Exit/Protection/Entry 订单。
- 是否存在 orphan、stale、重复 protection/TP、无持仓订单、有持仓无保护单。
- 67 个活动委托中 Entry 与 Exit 的实际构成。
- pending Entry 是否长期占据资金 lease，并造成资金读数异常。

## 必须产出的审计文件

本轮仅新增文档，不修改业务代码。

### A. 根因报告

创建：
`docs/reports/v396-trading-loop-root-cause-audit-20260929/ROOT_CAUSE_REPORT.md`

至少包含：已确认问题、被证伪问题、直接证据、代码路径/函数/状态机、运行或存储证据、根因、受影响交易阶段、严重程度、相关门禁当前实际权限、Entry 实际 veto 图谱、Exit 实际执行链、长持仓分布与 Exit 频率分析。

### B. 后续实施计划

创建：
`docs/reports/v396-trading-loop-root-cause-audit-20260929/IMPLEMENTATION_PLAN.md`

根据根因报告独立提出后续解决方案和分阶段实施计划，供人工审核及其他模型实施。本轮不执行。

计划中需分别处理：
- Entry 权限复杂度及重复/遗留控制的简化方向；
- 低平仓频率在止盈设计、AI 决策、调度、执行、订单维护、reconciliation 各层的责任；
- 已确认的持仓累计时间 UI 需求；
- 回归验证与 Production/Testnet 边界。

## 证据要求

尽可能把以下链路连通：

`驾驶舱现象 → authoritative state → event/readback → storage → engine path → exchange/reconciliation path`

不要因为旧报告称某门禁已经解除就默认所有路径正确，必须核实当前代码与运行事实。

不要因为某字段显示 DEGRADED 就直接定为根因，必须证明其与交易闭环之间存在关联。

最终提交只允许包含根因报告、实施计划和必要的审计文档，不得混入业务代码修改。
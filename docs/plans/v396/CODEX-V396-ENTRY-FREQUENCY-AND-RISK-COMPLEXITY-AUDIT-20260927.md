# ZDJ-MITS V3.9.6 — Entry Frequency & Risk Complexity Audit

状态目标：`V396_ENTRY_FREQUENCY_ROOT_CAUSE_AND_MINIMAL_RISK_CHAIN`

## 背景

V3.9.6 已完成 mainline promotion 与 runtime identity closure。当前不是继续增加风险门，而是回答两个问题：

1. 为什么 AI/候选分析频繁运行，但真实 Entry / reservation / intent / submit / fill 频率偏低？
2. 当前风险管理是否存在重复、过期、错误作用域、telemetry-as-veto、同一事实多次审核，导致风险链过度复杂？

本轮目标不是“强迫交易”，也不是预设“风险越多越安全”。目标是用运行事实得到 **最小充分硬门集合（minimum sufficient hard-gate set）**：每一道 hard veto 都必须有独立、不可被其他门替代的安全或执行正确性价值；否则不得继续作为硬阻断。

## 模型建议

本任务优先使用 GPT-6 Astra（Codex，High/XHigh/Max reasoning）完成跨仓库架构分析、运行证据归因和最终裁决；若 Astra 配额不足，使用 GPT-6 Sol High/XHigh。GPT-6 Luna 只适合并行做日志抽取、分类、重复性证据整理，不作为最终架构裁决者。

## Phase 1 — 只读穷尽，不改行为

先分析最近至少 12 小时；如样本不足，扩展到 24–72 小时。不得先改阈值、确认 handoff、删除 UNKNOWN、制造 PLACE、制造成交或重启。

对完整链路逐层计数并给出转化率与 dwell time：

`Market → Universe → Eligible → Scout → Primary → PLACE/REJECT → Pre-AI/Execution Envelope → Risk Admission → TradePlan → Reservation → Intent → Submit → Exchange Accepted → Fill`

至少输出：

- 每层输入数、输出数、drop 数、drop rate；
- 每个拒因的次数、占全部机会比例、涉及 symbol 数；
- 每道拒绝发生时的真实数值、limit、used、headroom、shortfall、TTL/age；
- 同一次机会被多少道门重复拒绝；
- 每个拒绝是否规模相关：把 planned notional 从交易所最小合法 notional 开始逐 step 增加，计算该候选第一次从 ALLOW→BLOCK 的精确临界值；
- 若任意合法最小订单规模都被拒绝，指出真正的第一道 hard gate；
- 若更小合法规模可以通过而当前 planned notional 被拒绝，指出“可执行临界规模”，不得把“整笔计划不通过”误报为“完全无容量”；
- AI_RESOURCE_BUSY、队列、cooldown、symbol exclusion、market-data isolation、margin-tier、minQty/stepSize/minNotional、price band、资金路由、slot、ownership、人类 handoff、UNKNOWN occupancy、gross/direction/cluster、stress、economic admission、JIT、reservation collision、idempotency、exchange REST budget 等全部纳入，但不得假设任何一项一定是问题。

必须抽取最近所有 `PLACE_* -> no submit` 样本逐笔 replay，直到不存在未解释的 drop。

## Phase 2 — 风险链复杂度审计

列出 Entry 路径上的每一个 hard veto，形成表格：

`gate | owner/source of truth | input fact | formula | scope | hard/advisory | upstream/downstream duplicate | independent protection value | observed hit-rate | false/overlap evidence | proposed disposition`

每道 gate 只允许归入以下一种类型：

### A. 交易所/协议硬合法性

例如 symbol 可交易、真实余额/保证金、minQty、stepSize、minNotional、price/tick/percent band、真实 leverage/margin tier、reduce/position mode 等。

这些不是“策略审核”，而是订单是否合法的事实。保留，但只计算一次并形成统一 execution envelope。

### B. 执行正确性硬门

例如环境锁、Production write lock、owner/version/JIT/expiresAt/idempotency、reservation/qty collision、stale private fact、订单域冲突。

只有能防止错误账户/错误数量/重复订单/过期事实/写错环境的门可以保留。重复检查应合并到单一权威结果。

### C. 资本/偿付能力硬门

只允许保留能回答“这笔最小合法订单是否有真实资金/保证金支持”的单一权威容量计算。不得用 Gross exposure、历史计划上限、统计 allocation ceiling 等第二套数字再次冒充资金余额。

### D. 策略/组合风险门

对 gross / human / direction / cluster / stress / handoff ack / economic admission 等逐一证明其独立价值。

要求：

- 同一底层风险事实不得经过多条等价公式重复 veto；
- OBSERVE 必须真正不 veto；
- telemetry / warning / governance health 不得伪装成 execution veto；
- 已由更强上游权威完全覆盖的下游 gate 应删除 hard veto 或降为 diagnostic；
- 纯“时间到了但事实没变”的状态（例如 age/ack）如果没有独立的即时资金或执行风险，必须论证为什么能阻止一笔新订单；不能仅因为历史设计如此就保留；
- 如果某 gate 只影响推荐 sizing，应输出 max executable size，而不是把整个候选判为 0；
- hard gate 数量不是质量指标。优先减少串联审核、重复解释和多套 capacity authority。

## Phase 3 — 得到最小充分硬门集合

给出两个版本的链路：

1. `CURRENT_HARD_GATE_CHAIN`
2. `MINIMUM_SUFFICIENT_HARD_GATE_CHAIN`

对于拟删除/降级的每一道 gate，必须说明：

- 被哪个权威事实覆盖；
- 删除 hard veto 后仍由什么防止真实错误；
- replay 中多少次机会将从 BLOCK 变为 ALLOW；
- 是否只是恢复原本有资金且交易所合法的机会，而不是人为提高 leverage/风险预算。

最终必须回答：

- 建仓频率低主要是 **机会少、AI 不下单、模型吞吐、资金不足、订单最小值、风险政策、重复风险门、人工状态门、执行基础设施** 中哪几类，按实际 drop 数排序；
- 挂单频率低的第一、第二、第三实际原因；
- 在不改市场机会和 AI 决策的情况下，当前系统理论上每小时最多能产生多少合法 submit；
- 当前实际 submit/h 与理论上限差多少；
- 若只移除“无独立保护价值”的冗余 gate，预计 submit/h 会变化多少；
- 每个方向、每个 quote asset、典型候选的最小合法下单额、当前 max executable notional、真正的阻断临界值。

## Phase 4 — 先报告，再实现

先提交根因/复杂度报告，禁止边分析边大规模删门。

只有证据充分后才实施：

- 合并重复 capacity authority；
- 把 advisory/telemetry 从 hard veto 链移出；
- 删除错误作用域、过期状态、重复公式造成的 hard veto；
- 对“可缩量通过”的门改为输出真实 `maxExecutableNotional/maxQuantity`，而不是全候选 BLOCK；
- 保证 Dashboard、Brain audit、pipeline verdict、entry conversion 使用同一权威 blocker/capacity fact；
- 不允许通过偷偷提高 leverage、伪造余额、修改交易所规则、把 UNKNOWN 当 0、关闭 Production lock、跳过 JIT/idempotency 来提高频率。

## 验收

所有测试、typecheck、verify、formal build 只在本地执行；GitHub Actions 记录 `NOT_RUN_BILLING_LIMIT`。

部署前必须有对照 replay；部署后观察真实 Testnet 行为，至少证明：

- 同一机会不会被多套等价风险门重复否决；
- Brain `PLACE` 后若资金和交易所合法性满足，审计能明确给出唯一的 hard blocker，或进入 reservation→intent→submit；
- 存在可缩量执行空间时，不得显示 0 capacity；
- 不再出现 telemetry/advisory 状态阻断下单；
- Production writes=0；
- Testnet 写入逐笔可归因；
- TP/exit/UNKNOWN/ownership/JIT/idempotency 等既有执行真值不得被破坏；
- runtime/source/build identity 闭环。

不要把“产生更多订单”本身当 PASS。PASS 条件是：**所有未提交订单都有一个必要、独立、可量化的真实 hard blocker；不存在冗余/重复/错误状态门；一旦没有真实 blocker，执行链能够自然进入 submit。**

最终报告状态建议：`V396_ENTRY_FREQUENCY_ROOT_CAUSE_AND_MINIMAL_RISK_CHAIN_COMPLETE`。

# S03：退出成本估值与 10 USDT 权限闸

状态 NOT_STARTED；terra 主体，luna 边界夹具。前置 S02；后继 S04、S06。重点 EX3、DA1；涉及 I01/I04/I05/I08。

## 范围与当前入口

只实现可复算估值和纯权限判定，不发订单。复用 services/cycleAccounting.ts、economicEntryFeasibility.ts、manualPositionService.ts 的事实入口；核对 packages/core 成本函数。当前 manualPositionService 的粗略 projectedNet 不能直接成为 AI 亏损闸真源，人工预览与 AI 正式估值要明确区分。

拟新增 exitCostEstimator.ts、aiExitPolicy.ts；contracts 增加 CONTRACTS 所列 ExitEstimate/Verdict。输入来自 S01 会计事实与 S02 ownership，输出给 S04，不让模型自行提供“已过风控”值。

## 实施步骤

1. **S03-A 会计估值。** 读取原 cycle 的已实现毛损益、所有已发生费用、已分配 funding、剩余 qty。以退出方向盘口/深度和限价边界计算剩余毛收益及预计手续费；币种折算保留时点/来源。
2. 列出每一项成本是否已经发生、预计或误差缓冲；未知有可信上界时标 CONSERVATIVE_BOUND，无界时 UNKNOWN。资金费已付/应计/未来情景不得重复扣；funding 已知值用有符号量。
3. 生成包含全部事实/配置版本的 estimateHash、quoteAt/expiresAt；数量/手续费/价差变化导致旧估值失效。mark 用于风险监测，不作为可成交价。
4. **S03-B 决策树。** 按 CONTRACTS 优先级实现 owner/期限→事实→深亏→论点失效小亏→微利→HOLD。深亏条件早于任何“模型高信心”。到期和人工状态不能因当前盈利而重新授权。
5. 结构化失效证据来自冻结 plan 的谓词；模型可以解释或提出复核，但一段“感觉不对”不构成有效谓词。小亏开关已设计为 true，运行 feature 仍 OFF，不改 live Settings。
6. **S03-C 可执行价格界。** 求使保守周期净利不低于目标的价格边界；LONG 卖价下限向有利于保守性的 tick 上取整，SHORT 买价上限向下取整，再复算。余额/数量太小、价界不可达、流动性不足均明确返回不可执行，禁止 market fallback。
7. 分离授权时的最大容许亏损与实现结果；实际成交超界记录 execution variance，不把保护限价说成强平/费用风险保证。部分成交后计算剩余整周期损益，不能新开 10 USDT 预算。

## 数值例子（仅离线 fixture）

原周期已有毛损益 -2，已发生费 1，funding -0.5，剩余退出毛损益 -5，预计退出费 0.5，buffer 0.2，则 N_all=-9.2；论点失效且有效期内可允许。若剩余退出毛损益变 -6，则 N_all=-10.2，必须 HANDOFF。

微利 fixture：N_all=0.8、门槛 0.5、退出条件成立时 ALLOW；不以毛浮盈 0.8 替代净值。N_all=0 且门槛正数时 HOLD，除非以后另行设计不亏退出规则。

## 必测用例

| ID | 场景 | 结果 |
|---|---|---|
| S03-T01 | -9.99/-10/-10.01，含同一成本口径 | 前两者在其它条件满足时允许，最后 HANDOFF |
| S03-T02 | 小亏但论点未失效 / 缺原证据 | HOLD / BLOCKED_FACTS，不见亏即砍 |
| S03-T03 | 正毛盈但手续费后为负 | 不走微利分支 |
| S03-T04 | 入场费/过去部分退出费/funding 重复输入 | 幂等守恒，不重复计入；冲突阻断 |
| S03-T05 | USDC/非稳定币费用、折算价格陈旧 | 有界保守值或 UNKNOWN，不能当 1:1/0 |
| S03-T06 | 盈利但 owner 已人工或 now==deadline | 拒绝/交接，不能授权 |
| S03-T07 | tick 四舍五入会越过亏损线 | 使用保守方向取整并最终复验 |
| S03-T08 | 部分成交后重试、不同仓盈利 | 原周期累计；不能重置或跨仓抵扣 |
| S03-T09 | 深度不足/quote 过期/NaN/负费用异常 | 明确拒绝，不返回 ALLOW |

性质测试：成本变高不能让同一退出从禁止变允许；可成交价恶化不能提高 N_all；相同事实哈希重复调用一致。精度策略需有 decimal/整数单位边界测试，不能以 epsilon 容忍 -10.01。

## 验收、回退与交接

ACCEPTED：公式可独立重算、边界和不变量全过，未引入交易写。资金/报价无法证明时停止可写集成，保留 BLOCKED_FACTS 路径。

此阶段回退只移除未启用的纯模块/新读模型，不修改已有持仓 TP 或人工权。移交 S04：价格界、估值 hash、错误码、时效规则与 fixture；移交 S06：同一成本口径，禁止另造净利定义。

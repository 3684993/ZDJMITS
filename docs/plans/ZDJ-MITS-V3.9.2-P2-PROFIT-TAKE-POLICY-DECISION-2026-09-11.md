# ZDJ-MITS V3.9.2 P2 收益止盈与 AI 持仓权限裁决

日期：2026-09-11
状态：USER-DIRECTED DESIGN DECISION
适用：后续 P2 实施与 Codex 验证。本文件对源码最终审计报告中原 P2「持续持仓 AI / 智能退出」建议作收敛，以本文件为准。

## 1. 核心原则

P2 不建设持续占用 AI 的“持仓交易员”。AI 的主要职责仍然是：

1. 发现并分析高质量建仓机会；
2. 决定 LONG/SHORT 与入场区间；
3. 在建仓决策时同时推理一个科学、尽可能提高收益且具备合理成交概率的止盈目标；
4. 成交后由确定性 TP 系统立即挂 reduce-only 止盈单。

禁止 AI 为了结束管理、释放资源、趋势反转或超时而主动亏损平仓。

## 2. 亏损持仓处理边界

- AI 自动退出必须满足“预计净退出收益 > 0”；亏损状态不得由 AI 发起平仓。
- 持仓进入亏损后，不进行高频 AI 复盘。
- 若亏损持续超过配置的管理周期（以闭合 15m bar 数表达，而不是 wall-clock 随意计时），状态转为 `HUMAN_HANDOFF`。
- `HUMAN_HANDOFF` 后，该 symbol 不再进入 Position AI 推理队列，不再消耗 27B/9B 资源；后续减仓、亏损平仓、补仓等由人工决定。
- 转人工时不得因为 handoff 自动撤销一个仍合法、reduce-only、位于盈利侧的既有 TP；人工可以后续修改/撤销。
- Exchange liquidation、人工紧急平仓与独立风险治理属于不同权限域，不得伪装为 AI 策略退出。本裁决只规定 AI/自动收益管理权限。

`lossHandoffBars` 应为可配置参数。建议初始回放候选值为 4 个闭合 15m 周期（约 60 分钟），最终默认值必须由 Codex 使用历史/Testnet replay 比较后确定，不直接凭主观写死。

## 3. 单次 AI TP 目标，而不是持续追价

P2 第一阶段不实现持续盈利时反复移动 TP。建仓 Primary 在 PLACE 时一次性输出 `ProfitTakePlan`，入场成交后 TP Guardian 校验并挂单。

建议最小输出：

- `targetPrice`
- `acceptableTargetRange.min/max`
- `targetHorizonMinutes`
- `targetReason`
- `evidenceRefs[]`
- `expectedMoveAtr`
- `nearestStructureLevel`
- `netProfitFloorSatisfied`

AI 不应简单使用固定百分比。目标价格应综合：

- 15m 主方向与趋势强度；
- 最近确认 swing high/low、阻力/支撑和结构空间；
- ATR/波动率与当前价格位置；
- 5m/15m 布林位置与趋势延续空间；
- 当前 spread、tick、流动性和可成交性；
- 交易费用后的最低净收益；
- 该入场 thesis 的合理时间窗口。

目标不是数学意义上的“最高价格”，而是在当前证据下选择**预期净收益与成交概率权衡后最高的合理 TP**。禁止为追求名义利润设置明显不可达目标。

## 4. Deterministic TP Guard

AI 只决定目标意图，最终挂单继续由确定性代码负责。Guard 至少检查：

- LONG TP > entry / SHORT TP < entry；
- 预计净收益必须 > 0，并满足费用安全底线；
- tickSize、minQty、quantity 与 reduce-only 合法；
- TP 位于 AI 授权 target range 内；
- 不使用过期行情/结构事实；
- 不允许 AI 修改仓位方向、增加仓位或产生亏损退出。

若 AI TP 输出无效，回退到确定性 `STRUCTURE_15M`，再失败才回退 fixed profitable TP；不得因为 AI 失败导致持仓无 TP 保护。

## 5. 暂缓的动态功能

以下功能暂不进入 P2 在线执行：

- 每分钟/每根 K 线持续调用 AI 管理所有持仓；
- AI 自动止损；
- AI 在亏损状态主动退出；
- 持续追高/追低重挂 TP；
- 自动补仓或摊平；
- AI 直接拥有交易所平仓权限。

未来若要研究“盈利持续时上移/下移 TP”，先以 Shadow 方式记录 counterfactual，不影响真实 TP；只有回放证明净收益改善且不会显著降低兑现率后再考虑。

## 6. 推荐状态机

```text
ENTRY_AI_PLACE
   -> ENTRY_FILLED
   -> TP_PLAN_VALIDATE
      -> AI_TP_VALID -> TP_WORKING
      -> AI_TP_INVALID -> STRUCTURE_15M_FALLBACK -> FIXED_PROFIT_FALLBACK

TP_WORKING
   -> TP_FILLED -> CLOSED_PROFIT
   -> POSITION_NEGATIVE
        -> loss duration < handoff bars -> KEEP_EXISTING_PROFIT_TP / NO_AI_LOOP
        -> loss duration >= handoff bars -> HUMAN_HANDOFF
   -> HUMAN_ACTION -> manual path
```

该状态机的核心是：**AI 把计算资源集中在“选对币、选对方向、选对入场、一次性选好 TP”，而不是长期守着亏损仓位。**

## 7. Codex 验证要求

P2 实施前后至少验证：

1. AI 不存在任何负净收益自动平仓路径；
2. loss handoff 到期后该 symbol 不再触发 Position AI 请求；
3. handoff 不会自动撤销合法盈利 TP；
4. AI TP、STRUCTURE_15M fallback、fixed fallback 均能创建合法 reduce-only TP；
5. TP target replay 对比当前固定 0.45%：净收益、TP 命中率、平均持仓时间、MFE 捕获率、未兑现率；
6. 测试 AI 输出极端远价、错误方向、过期事实、低于费用底线时必须 fail closed/fallback；
7. `npm run verify` 全部通过。

## 8. 与 P0/P1 的关系

实施顺序不变：P0 候选供应与配置真实性 -> P1 Entry 链收敛与 Primary readiness -> P2 AI ProfitTakePlan + loss handoff。

P2 不应反过来扩大 Entry 复杂度，也不应新增第二套平仓执行链。最终 TP 写入仍由现有 TpGuardian / Exchange adapter 的唯一执行路径负责。
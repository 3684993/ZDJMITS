# Astra 实例实施计划参考摘要（跨实例仅作问题假设）

> 来源：另一台新部署 TESTNET 实例生成的 `IMPLEMENTATION_PLAN.md`。
>
> 本文件只保留可跨实例复核的代码/架构问题，不保留也不转移该实例的订单、余额、持仓、端口、Settings 实际值、统计窗口、请求数量、成交结果等运行数据。

## 使用原则

同一代码版本不等于同一运行事实。

当前旧电脑实例使用本文件时，只能把以下内容当成“待重新验证的问题假设”。任何结论都必须由当前实例自己的 source/build/settings、SQLite、AI archive、readback 和自然运行事实证明。

## 可跨实例重新核实的核心问题

1. **Sizing authority 是否唯一**
   - portfolio sizing、execution envelope、Primary、TradePlan、reservation、JIT 是否存在多个数量权威；
   - 模型是否可以在过宽的合法区间内自主选择极小 quantity；
   - 后续链路是重新计算数量，还是只冻结模型选择。

2. **业务最低建仓金额是否真正存在于执行契约**
   - 业务最低初始保证金、偏好保证金、notional、exchange minQty/minNotional 是否被混用；
   - 是否存在 UI/Settings 有概念但最终订单链没有消费的情况；
   - 是否存在 fallback 退化到交易所最低可成交值。

3. **仓位、TP、费用、最低净收益是否使用同一经济事实**
   - 模型输入、候选构建、最终经济校验、TP 管理是否使用同一手续费/滑点/funding/价格版本；
   - 最低净收益和目标收益是否被混为一个概念；
   - 低经济意义订单是否可能通过执行链。

4. **方向事实与方向权威是否一致**
   - 1D/4H/15m 是否只是 prompt 信息，还是形成可机读、可审计的方向关系；
   - 固定 LONG/SHORT bias 是否可能抢占多周期趋势证据；
   - 是否能区分趋势方向判断与短周期入场触发。

5. **推理时效是否会破坏原始方向判断**
   - Scout/Primary 的排队和推理时间是否使计划在真正 submit 时已经过时；
   - event TTL 是否只是让旧计划继续“合法”，而没有证明其仍然有效；
   - JIT 是否只校验价格/账户事实，而没有重新确认原始市场论点。

6. **决策后验链是否完整**
   - Candidate/Scout/Primary/TradePlan/Intent/Order/Fill/Position 是否有单一 trace identity；
   - 是否能把一次 AI 决策与后续 15m/1h/4h 的 MFE/MAE、target hit、entry drift、最终结果关联；
   - 如果没有后验标签，系统无法证明方向、时机、TP 或 Scout 是否真正提高质量。

7. **TP 保护与 TP 经济性是否混淆**
   - 有 reduce-only TP 不代表 TP 目标经济合理；
   - 核实目标价格与仓位大小、成本、可达时间、机会成本是否闭环；
   - 核实低收益仓位是否长期占用持仓和分析资源。

8. **退出效率是否缺少明确职责**
   - 持仓复核、趋势失效、时间性复核、TP、AI Exit、人工接管之间是否存在职责空白或重叠；
   - 不复制另一实例的持仓时间或退出样本，只在当前实例重新量化。

9. **风险/门禁是否重复成为数量或方向 authority**
   - 区分执行正确性检查与策略观察；
   - 核实 Gross/Direction/Cluster/Stress/position caps 等是否在当前 TESTNET 路径实际改变 quantity/direction；
   - 不因为另一实例观察到某 gate，就假设当前实例也被同一 gate 阻断。

10. **Scout → Primary 串行依赖是否有可证明价值**
    - Scout 是否真正减少无效 Primary、提高方向/入场/TP 后验质量；
    - 延迟成本是否超过筛选增益；
    - 必须使用当前实例自己的请求、后验和时延数据重新判断。

11. **源码、部署 build、Settings 是否漂移**
    - 当前实例必须独立证明 Git commit/sourceHash/artifactHash/settingsVersion 与运行实例一致；
    - dirty overlay、旧 artifact 或不同 Settings 可能制造与另一实例完全不同的运行结果。

## 当前实例应该怎样使用本摘要

对每个问题输出：

`问题 | 当前实例证据 | CONFIRMED / NOT_REPRODUCED / UNKNOWN | 代码级还是实例级 | 对当前实施计划的影响`

不要复制 Astra 实例中的具体数字作为当前实例证据。

最终当前实例计划必须由本机事实重新排序优先级；Astra 的阶段顺序、参数、样本结论均不是当前实例的默认答案。

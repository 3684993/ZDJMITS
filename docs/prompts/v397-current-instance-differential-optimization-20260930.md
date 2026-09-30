# V3.9.7 当前实例差异化优化审计提示词

## 任务性质

当前存在两个独立 TESTNET 实例：

- Astra 高级模型审计的是另一台新部署实例；
- 你现在处理的是旧电脑上的当前实例。

两者使用同一代码版本/同一项目，但运行数据、数据库、Settings、生效 build、AI archive、订单、成交、持仓、余额、时间窗口和部署状态彼此独立。

因此，另一实例的 `IMPLEMENTATION_PLAN.md` 只能作为**架构问题参考和假设清单**，绝不能作为当前实例的运行证据。

## 证据规则

对当前实例的任何结论，必须重新读取并验证当前本机：

- 当前 Git HEAD / sourceHash / artifactHash / buildId / settingsVersion；
- 当前 Engine readback；
- 当前 SQLite；
- 当前 AI archive / decision episodes；
- 当前 Candidate → Scout → Primary → TradePlan → Reservation → Intent → JIT → order/fill → position → TP/Exit 链；
- 当前自然运行产生的事实。

禁止把另一实例中的端口、余额、交易对、订单数量、成交数量、延迟统计、持仓数据、Settings 数值、时间窗口、TP/Exit 结果等直接复制到当前实例结论。

## 如何使用 Astra 计划

把 Astra 计划中的问题仅作为待核实的“系统级假设”，逐项标记：

- `CONFIRMED_CURRENT_INSTANCE`：当前实例独立证据证明同样存在；
- `SAME_LOGIC_DIFFERENT_RUNTIME_EVIDENCE`：代码逻辑相同，但当前实例运行证据不同；
- `NOT_REPRODUCED_CURRENT_INSTANCE`：当前实例未复现；
- `UNKNOWN`：当前实例证据不足。

不得因为两个实例版本相同，就假设运行表现、参数值或数据分布相同。

## 必须重新核实的系统问题

重点核实这些“逻辑/环节”问题，而不是复制另一实例的具体交易数据：

1. **建仓数量权威是否唯一**：Primary、portfolio sizing、execution envelope、TradePlan、reservation、JIT 是否存在多个 sizing authority；最终数量究竟由谁决定；是否存在模型选择极小合法数量后被系统直接冻结执行的路径。
2. **业务最低建仓金额是否真正进入最终订单契约**：系统业务 floor、偏好目标、交易所 minQty/minNotional、初始保证金、notional、杠杆是否被混用；是否存在业务最低金额缺失或只停留在 Settings/UI 的情况。
3. **仓位数量与最低净收益是否闭环**：size、entry price、leverage、双边费用、slippage、funding、TP、required net、expected net 是否来自同一事实版本和同一成本口径。
4. **低经济价值订单是否仍可能产生**：是否存在订单虽然交易所合法，但预期净收益过低、TP 经济意义弱、长期占用一个 position/TP/AI/对账生命周期资源的问题。
5. **1D / 4H / 15m 是否真正形成方向契约**：这些周期是仅进入 prompt，还是有可机读、可验证、可回测的方向关系；是否存在固定 LONG/SHORT bias 抢占趋势证据。
6. **方向错误与入场过时是否能区分**：Primary/Scout 推理时延、事件 TTL、行情变化和 JIT 之间是否导致“原判断可能合理，但最终入场已过时”。
7. **AI 决策到结果的后验链是否闭合**：是否能把一次决策与 15m/1h/4h 后的 MFE/MAE、target hit、entry drift、最终净结果关联；若不能，当前系统就无法判断 AI 是方向错、时机错还是目标错。
8. **TP 保护与 TP 经济性是否被混为一谈**：有 TP 不代表 TP 合理；核实 TP 与仓位规模、费用、可达时间、机会成本的关系。
9. **平仓效率是否存在结构性问题**：核实长期持仓、低收益占用、Review/AI Exit/Time-based review 的职责与运行状态，但不要把另一实例的持仓时长样本直接复制过来。
10. **风险/门禁是否仍在重复干预 sizing 或方向**：仅核实哪些模块重复修改 quantity、capacity、direction 或 economic decision；重点是重复 authority 和逻辑冲突，不要重新扩张 Gross/Direction/Cluster/Stress 等组合风险体系。
11. **Scout → Primary 串行链的价值是否可证明**：比较其延迟成本与实际后验质量增益；不要沿用另一实例的请求数量和延迟数字。
12. **源码、Settings、运行 build 是否一致**：如果当前实例存在 dirty overlay、旧 build、未部署 main 或 settings 漂移，必须单独列为部署身份问题，不能把它与算法逻辑混在一起。

## 差异化审计输出

先生成“当前实例 vs Astra 参考”的差异矩阵：

`问题 | Astra 参考结论 | 当前实例证据 | 当前实例裁决 | 是否系统性代码问题 | 是否实例特有问题`

注意：Astra 一列只能写“参考结论摘要”，不能把其运行数字当成本机证据。

然后基于当前实例重新排序根因，回答：

- 当前实例最影响高质量建仓的前三个根因是什么；
- 当前实例最影响科学 sizing / 最低净收益闭环的根因是什么；
- 当前实例最影响方向质量的根因是什么；
- 当前实例最影响 TP / 平仓效率的根因是什么；
- 哪些问题是代码级系统问题，两个实例都可能存在；
- 哪些问题只是另一实例特有，当前实例不应照搬。

## 生成新的当前实例实施计划

最终生成：

`docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`

这份计划必须完全基于当前旧电脑实例的独立证据重新制定。

要求：

- 可以借鉴 Astra 的模块划分和问题分类；
- 不得照抄 Astra 的运行数据、参数结论或阶段优先级；
- 所有优先级必须由当前实例自己的根因证据决定；
- 每个阶段写清：当前实例证据、目标、涉及模块、验收方式、依赖关系、未知项；
- 明确区分“源码需要改”“Settings 需要调整”“部署身份需要修复”“只需要继续观察”四类工作；
- 不为了与 Astra 计划保持一致而修改当前实例；
- 当前实例没有证据的问题保持 UNKNOWN；
- 不人为制造交易样本或用另一实例的数据补齐当前实例缺失的数据；
- TESTNET 事实不能自动外推 Production。

本轮只重新审计和生成当前实例实施优化计划，不直接实施交易策略修改。

## 最终汇报

完成后一次性汇报：

1. 当前实例 source/build/settings 身份；
2. Astra 参考问题中哪些在当前实例被确认；
3. 哪些没有复现或证据不足；
4. 当前实例重新排序后的核心根因；
5. 新计划文件路径；
6. 最终 GitHub SHA。

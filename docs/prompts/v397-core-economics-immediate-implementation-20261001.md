# V3.9.7 核心收益闭环立即实施指令

> 本轮性质：**立即实施，不再等待进一步样本、A/B、Shadow、长期观察或人工阶段确认。**
>
> 当前实例已经完成前几轮架构、身份、账本、TP 保护和执行正确性收尾。本轮只解决用户已经明确发现、且直接影响系统经济价值的三个核心问题：
>
> 1. **建仓金额 / 保证金 / 交易量过低，出现大量经济意义很低的微小仓位；**
> 2. **TP 的费用后净收益过低，即使成交也无法满足用户设置的收益目标；**
> 3. **低收益仓位长期占用资金、仓位和 AI/维护资源，长期持有却难以完成有效平仓。**
>
> 不要扩展任务范围到新的组合风险体系，不要重新把 Gross / Direction / Cluster / Stress / Human exposure / position count / 历史 UNKNOWN 等观察项变成新的 Entry veto。本轮核心是**交易经济性、合理仓位规模和可完成的退出闭环**。

---

## 0. 当前基线

以当前 GitHub `main` 和当前旧电脑 TESTNET 实例为唯一实施对象。

必须先阅读：

1. `docs/reports/v397-current-instance-full-implementation-20261001/IMPLEMENTATION_RESULT.md`
2. `docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`
3. `docs/reports/v397-core-trading-quality-final-audit-20260929/ROOT_CAUSE_REPORT.md`
4. 当前 `main` 的 Settings schema、EntryEconomicMandate、Entry/TP/Review/Exit 主链、Dashboard/readback 和当前 TESTNET 数据。

已知当前实施结果：

- 新的 per-quote 最低初始保证金和可选最低订单 notional 字段已存在，但当前仍为 `null`；
- 旧 `entryMarginUsd/baseMarginUsd` 仍只是资本规划值，并没有自动变成最终业务下限；
- 新 build 启动后尚未产生新的自然 Entry，因此新版经济 sizing 尚未被自然交易证明；
- TP 保护可以达到全覆盖，但存在 `TP_LOW_NET_TARGET_KEPT`，即“有 TP”不代表“经济上值得持有”；
- 历史 UNKNOWN 小单仍保留在审计数据中，不能把它们当成当前 build 新订单，但新的自动 Entry 绝不能继续产生同类微小经济仓位。

---

# 1. 本轮只解决这三个问题

## 1.1 低建仓金额 / 低保证金 / 低交易量

当前系统不能再允许“交易所合法最小值”自然退化为“业务上可接受的建仓规模”。

必须立即解决：

- 用户已经设置或明确表达的最低建仓保证金 / 最低资金使用要求没有真正成为最终 Entry 合同；
- 新增的 quote-specific minimum 字段虽然存在，但为 `null` 时系统实际上仍没有业务 floor；
- Primary、candidate、TradePlan、reservation、JIT、Adapter 之间必须有唯一、可读回的最终仓位规模权威；
- 不允许任何 fallback 在经济条件不满足时退回到交易所 minimum、极小 quantity 或几美元 notional；
- 不允许为了“至少有一笔交易”而创建低经济价值的小仓；
- 每笔新自动 Entry 必须能够说明最终 quantity、notional、initial margin、leverage 分别是多少，以及为什么满足用户当前的资金使用要求；
- 用户设置的最低建仓保证金、最低交易金额、目标资本使用值三种语义不得混淆；
- USDT / USDC 各自使用明确的 quote 语义，不允许在缺少证据时混为同一个单位。

**要求：本轮不能因为“字段尚未配置”而继续等待。实现模型必须根据当前系统已经存在的用户配置语义，完成可运行的 TESTNET Settings 激活与迁移，并在报告中写明最终生效值和来源。不要向用户停下来询问是否继续。**

---

## 1.2 TP 费用后净收益太低

当前系统出现了“TP 已保护，但预计净收益只有极小金额”的情况。这不是可接受的最终状态。

必须立即解决：

- `TP protected` 与 `TP economically valid` 必须彻底分开；
- 新 Entry 不能在已知费用后净收益明显低于用户设置的最低收益目标时仍正常进入；
- 不能通过极小仓位 + 极近 TP 形成几美分收益；
- 也不能通过极小仓位 + 极远 TP 去“凑”绝对收益，导致目标长期不可达；
- quantity、initial margin、leverage、entry price、TP price、双边费用、slippage、funding/FX 可证明部分、最低净收益目标、目标 horizon 必须在同一个经济合同中闭合；
- 新 Entry 在最终 submit 价格重新计算后仍必须满足当前用户的最低费用后净收益目标；
- 如果当前市场条件下无法以合理仓位和合理目标实现最低净收益，应明确不建仓，而不是降级成微小单；
- 历史已有仓位不得因为旧数据不完整而伪造收益事实，但当前仍长期占用且经济价值很低的仓位必须进入明确的复核 / 退出处理流程，不能永久静默持有。

本轮不要求证明长期盈利，也不要求等待大量 OOS 样本；要求的是：**系统不能明知费用后目标收益极低，仍把它作为正常自动 Entry/TP 结果。**

---

## 1.3 长期持仓、低收益、无法有效平仓

用户观察到的核心问题不是单纯“TP 有没有挂上”，而是：

- 小仓位占用很长时间；
- 绝对收益很低；
- 达到目标需要很久；
- 长时间没有形成有效退出；
- 仓位、模型、TP、对账、Review 等服务成本与潜在收益严重不匹配。

必须立即解决：

- 新仓不能在没有明确目标期限、复核期限和退出责任的情况下无限期持有；
- TP 目标必须和仓位规模、最低净收益、目标时间窗口共同成立；
- 低收益、长期未达到目标的仓位必须拥有明确的 review / reduce / exit / handoff 结果，而不是永远 HOLD；
- AI Exit / Review 当前若仍不能形成真实在线闭环，本轮必须把造成“长期无法平仓”的实际断点补齐到可运行状态；
- HUMAN/HANDOFF 历史仓位保持身份边界，但不能让自动管理仓因权限状态或 Review 未运行而无限期停滞；
- 平仓后必须继续满足现有 physical cycle、fill attribution、claim convergence、reduce-only、TP identity 和账本守恒要求；
- 不允许为了提高平仓率伪造成交、删除 UNKNOWN 或修改交易所历史事实。

**目标不是强制每仓短时间盈利，而是禁止“低经济价值仓位 + 无限等待”的结构继续存在。**

---

# 2. 本轮明确不等待的事项

本轮实现过程中：

- 不等待更多自然 Entry 样本；
- 不等待 7 天/100 笔/OOS 统计；
- 不等待 Scout A/B；
- 不等待 Hosted CI；
- 不等待额外人工确认；
- 不因为经济合同字段当前为 null 而停止；
- 不因为暂时没有新市场机会而停止代码、配置和部署完成；
- 不把“继续 Shadow 收集数据”作为本轮核心问题的最终答案。

可以保留观测数据继续积累，但**不能把观测样本数量作为本轮修复低交易金额、低净收益和长期持仓问题的前置条件。**

---

# 3. 仍必须保留的执行正确性边界

本轮虽然不再等待策略条件，但不得破坏以下底层正确性：

- TESTNET / Production 隔离；
- Production writes 必须始终为 0；
- 真实 available funds / margin；
- exchange minQty / minNotional / tick / step / positionSide 等合法性；
- private account / quote / order / position 的真实性与身份；
- exact-once / idempotency / UNKNOWN submit recovery；
- reservation / durable storage / schema migration；
- reduce-only、Exit identity、position cycle 和账本守恒；
- 无法证明的历史事实继续保持 UNKNOWN。

这些只是执行正确性，不允许重新扩张成新的组合风险 sizing authority。

---

# 4. 实施方式

这是一次性实施任务，不是新的审计轮。

你需要直接完成：

- 当前 `main` 代码修改；
- Settings/schema/migration；
- Entry economic mandate / sizing / TP / Review / Exit 相关实现；
- API/Dashboard/readback；
- 单元、集成、回归测试；
- typecheck/build/verify/S00/storage/schema roundtrip；
- commit + push `main`；
- stop/start/restart 当前旧电脑 TESTNET 实例；
- 确认运行实例加载最新 build；
- identity closure 6/6；
- Production writes=0；
- 最终运行 readback。

允许根据实现需要多次重启当前 TESTNET；不需要逐次向用户申请。

如果自然市场在本轮窗口内没有生成新 Entry，不要为了制造样本而强行下单；但不能因此推迟本轮实施完成。必须至少证明：

- 生效 Settings 已非 null/空策略；
- 新经济合同在 deterministic/integration 测试中拒绝微小经济仓位；
- 低净收益不能继续走正常新 Entry 路径；
- 长持仓 Review/Exit 在线链路能够运行；
- 当前实例已经加载这些代码和配置。

---

# 5. 最终验收要求

完成后必须至少满足：

1. 当前 TESTNET 新 Entry 不再允许落到没有经济意义的极小仓位；
2. 用户设置的最低建仓保证金 / 最低资金使用政策真正进入最终 Entry 合同和 JIT 校验；
3. 新 Entry 的 quantity、notional、initial margin、leverage、TP、最低净收益、目标 horizon 可以从同一 mandate 完整重算；
4. 新 Entry 不允许 `expected net < 当前最低净收益目标` 后仍正常提交；
5. 低收益不能通过极远 TP 被掩盖；
6. 长持仓有真实在线 Review / Exit 生命周期，不再只有 TP 保护而没有退出责任；
7. 历史 UNKNOWN 小单与“当前远端真实活动 Entry”在 Dashboard/readback 中明确分开；
8. 原有 P1–P7 的 TP protection、exit convergence、physical cycle、submission identity、账本和 restart idempotency 不回归；
9. 当前运行 build 与 GitHub `main` identity 6/6；
10. Production writes=0。

本轮结束后不要再以“需要更多样本才能实施”为结论。样本不足只允许影响**收益预测可信度**，不能阻止上述核心经济机制上线。

---

# 6. 最终报告

生成并提交：

`docs/reports/v397-core-economics-immediate-implementation-20261001/IMPLEMENTATION_RESULT.md`

报告必须写清：

- 最终 SHA；
- 当前运行 build / PID / instance；
- 最终生效的最低建仓保证金、最低订单金额和最低净收益相关 Settings；
- 这些值的配置来源和单位；
- Entry sizing / TP / Review / Exit 实际修改；
- 测试和 migration 结果；
- restart / identity closure；
- Production writes；
- 是否观察到自然新 Entry；若没有，只陈述没有，不把它作为阻塞；
- 当前历史 UNKNOWN 如何与真实活动订单分离；
- 仍存在但与本轮三个核心问题无关的 UNKNOWN。

全部完成后一次性向用户汇报，不要中途征求是否继续。
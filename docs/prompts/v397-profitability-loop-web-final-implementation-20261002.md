# V3.9.7 盈利闭环 + Web 一次性修复实施任务

> 本轮性质：**立即实施**。不是重新做长期研究，也不是继续扩大风险门禁。
> 目标只解决当前已经明确暴露的核心交易质量问题和 Web 产品问题，并在完成后重启当前 TESTNET 实例加载最新代码。
> 本文件只定义问题、解决方向、侧重点和验收目标；具体代码、schema、迁移、Settings、API/UI 方案由 Codex 根据当前 `main`、当前本机数据库、交易所真实状态、运行 readback 和测试自行决定。

## 0. 执行方式

从 GitHub `3684993/ZDJMITS` 当前 `main` 开始，先读取最近以下结果与当前代码：

- `docs/reports/v397-current-instance-full-implementation-20261001/IMPLEMENTATION_RESULT.md`
- `docs/reports/v397-core-economics-immediate-implementation-20261001/IMPLEMENTATION_RESULT.md`
- `docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`

这些文件是背景，不是不可修改的设计。以**当前实例真实事实**为最终权威。

本轮要求：

1. 直接完成必要的源码、Settings、schema/migration、API、Dashboard、测试和数据投影修复；
2. 不逐阶段等待人工确认；
3. 不等待更多自然样本、长期 soak、A/B、Hosted CI 或额外研究条件；
4. 完成后 commit + push `main`；
5. 允许按需要 stop/start/restart 当前 TESTNET 实例，最终必须加载最新 push build；
6. Production writes 必须保持 0；
7. 不得通过伪造交易所订单、成交、收益或删除无法证明的历史事实来“通过验收”。

---

# 1. 第一主线：彻底解决建仓数量/交易金额过低

当前已确认旧系统长期存在大量几美元级微小 Entry；上一轮已增加经济 mandate 和最低订单金额，但自然运行主要表现为候选被拒绝，并没有证明系统能够持续形成**高质量、经济上有意义的建仓规模**。

本轮不要继续把问题定义为“如何增加更多 gate”。必须回答并解决：

- 当前最终 `quantity` / `notional` / `initial margin` 的真正 authority 是谁；
- 为什么合格候选仍可能落在最低合法数量附近；
- 用户设置的最低初始保证金、最低订单金额、最低净收益之间是否真正形成联合约束；
- 当前最低订单金额满足后，是否仍会出现保证金过低、绝对收益过低的订单；
- 当前最低初始保证金若仍过低，是否会让 `$200` notional 在高杠杆下只占用极少保证金，从而继续形成经济价值不足的交易；
- size、leverage、price、fee、slippage、minimum net profit、TP distance、target horizon 是否在同一个经济合同中共同求解；
- 系统是否仍然先得到一个很小的 quantity，再检查它能否赚钱；
- 系统是否应该先确定方向和可达价格空间，再根据最低净收益反推出所需规模；
- 当某个候选无法在合理时间/价格空间内实现最低净收益时，是否明确 NO_TRADE，而不是缩成微小单或把 TP 拉得极远；
- rounding / reprice / quantity step / leverage 变化以后，最终远端订单是否仍满足同一业务经济要求；
- 任何 fallback 是否会重新退回 exchange minimum 或模型最小量；
- 当前 Dashboard 是否能够直接显示并核对：最终 quantity、order notional、initial margin、leverage、最低要求、预计净收益、TP 目标、目标期限。

**侧重点：**

本轮最重要的不是“拒绝更多订单”，而是让系统对于真正值得交易的机会能够形成**足够的建仓规模**，并能解释为什么是这个数量。

验收目标：

- 新 Entry 不得再出现经济上无意义的微小单；
- 每一笔新 Entry 必须能证明其最终远端 quantity/notional/margin 与用户最低要求和最低净收益目标一致；
- 不能通过扩大 TP 距离来掩盖规模不足；
- 没有合格规模时必须明确不交易，而不是退化为小单。

---

# 2. 第二主线：最低净收益必须真正驱动 Entry 数量和 TP

上一轮已经有最低 TP 净收益，但出现了大量历史仓位 `TP economic quality UNKNOWN`，并且自然候选主要因为经济条件不满足被拒绝。

本轮必须解决：

- 最低净收益目前到底只是 validator，还是已经参与 quantity / margin / TP / horizon 的联合生成；
- 是否存在“先定 size，再检查净收益”的逆向流程；
- 是否应该根据目标时间窗口内合理可达的价格空间，反推出满足最低净收益所需要的最小有效 size；
- 费用、滑点、maker/taker、funding、quote asset 等是否使用同一版本事实；
- TP 保护覆盖和 TP 经济合理性必须继续分开，不能 100% protected 就宣称退出质量良好；
- TP 不能明知预计净收益低于用户目标仍作为正常新仓计划；
- TP 不能因为想达到绝对收益目标而被推到统计上明显不可达的远处；
- 目标期限必须成为计划的一部分，不能无限延长持仓等待一个理论 TP；
- Dashboard/API 必须能直接看到 required net、expected net、target move、target horizon 以及经济质量状态。

**侧重点：**

经济目标要从“后置告警/拒绝条件”升级成“前置建仓规模与目标价格的共同设计依据”。

---

# 3. 第三主线：解决长期持仓、无法平仓和低周转

当前 TP 保护不等于退出闭环。历史上存在大量长时间仓位；当前仍可能由 TP 长期等待、Review/Exit 责任不清、HUMAN_MANAGED 无自动处置等造成资金长期占用。

必须解决：

- 当前新仓从 Entry 时是否已经拥有明确的目标期限、Review 时点和退出责任；
- TP 长时间无法到达时，系统下一步到底是什么；
- 哪些仓位永远只能 HUMAN_MANAGED，为什么；
- 当前 Review / AI Exit / deterministic Exit / handoff 是否形成真实在线生命周期，而不是仅记录状态；
- 低收益或已失去原建仓逻辑的仓位是否会无限 HOLD；
- 是否存在达到 review/time limit 后仍没有任何 actionable outcome 的状态；
- 自动管理的新仓必须有明确的 HOLD / REDUCE / EXIT / HANDOFF 结果和下一个时间点；
- 退出时需要考虑当前可实现净收益、剩余 edge、手续费和市场事实，但不能因为等待完美条件而无限持有；
- 手工交易所平仓、TP、系统主动退出、人工处置必须有清晰 provenance；
- 历史 HUMAN/HANDOFF 仓位不要被错误自动接管，但新自动仓位不能继续无期限沉积。

**侧重点：**

本轮不是要求保证每笔都盈利，而是要求：每一笔自动 Entry 都必须有**可执行的生命周期终点**，不能长期占用资金和一个仓位却只有几分钱潜在收益。

---

# 4. 方向质量：只解决与盈利闭环直接相关的问题

继续检查 1D / 4H / 15m 与当前 Entry 方向的关系，但本轮不要重新引入复杂组合风险门禁。

必须关注：

- 1D / 4H / 15m 是否只是输入文本，还是对最终 side 有可审计作用；
- 方向判断完成到真正下单之间的时延是否让有效信号变旧；
- JIT 是否只验证交易合法性，而没有验证原市场论点是否仍成立；
- LONG/SHORT 是否仍受旧 bias 或默认先验不合理影响；
- 高周期方向、15m trigger、执行时点之间是否有清晰职责；
- 不要因为方向不确定而把仓位缩成微小单；不确定时应明确 NO_TRADE / WAIT，而不是低金额试探单。

本轮方向质量只服务于：**避免入场即逆向、避免旧信号、提高可达 TP 的概率。**

---

# 5. Web 问题一：`/orders` 建仓委托显示 113，但交易所真实挂单为 0

当前页面：`http://127.0.0.1:8080/orders`

用户确认交易所当前已经不存在任何挂单/限价订单，但页面仍显示 `建仓委托（113）`，其中大量是历史 UNKNOWN。

必须审计并解决：

- `/orders` 的“建仓委托”到底表示交易所真实 open Entry orders，还是本地历史 unresolved records；
- 页面标题和数量是否把历史 UNKNOWN 错当成当前挂单；
- 当交易所 open orders=0 时，当前活动建仓委托主列表是否应该为 0；
- 历史 UNKNOWN 是否应该移动到独立的“历史未确认/审计记录”区域，而不是继续显示为当前委托；
- 交易所已经证明不存在的订单是否能够被本地状态正确收敛；
- 必须避免靠直接删除历史记录解决，需要保留审计事实与 provenance；
- Entry、TP、manual、historical UNKNOWN 的 UI 语义和计数必须彻底分开；
- 页面刷新、重启后不得重新把旧 UNKNOWN 恢复成“活动委托”。

## 5.1 取消按钮无效

当前“取消”按钮点击无效。

必须审计：

- 点击事件是否真的调用后端；
- 后端取消 API 是否收到正确 order identity；
- 对交易所真实存在的活动订单必须可以取消，并最终显示交易所确认的终态；
- 对交易所已经不存在、只是本地历史 UNKNOWN 的记录，按钮不能伪装成“可以取消交易所订单”；应给出与真实状态一致的行为/提示，并触发正确的本地事实收敛流程；
- UI 不得出现点击无反应、无 loading、无结果、无错误的状态；
- 取消失败必须显示具名原因；
- 成功取消后列表和数量必须实时/确定性更新。

验收至少覆盖：真实远端活动单、远端不存在的历史 UNKNOWN、取消请求超时/UNKNOWN、已终态订单、重复点击。

---

# 6. Web 问题二：浏览器控制台 EventEmitter / ObjectMultiplex 报错

打开 Web 页面时观察到：

```text
contentscript.js:14083 MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added. Use emitter.setMaxListeners() to increase limit
contentscript.js:14083 ObjectMultiplex - orphaned data for stream "background-liveness"
```

必须先验真错误来源，然后解决当前应用自身能解决的部分：

- 判断 `contentscript.js` 是 Dashboard 自己打包的脚本、注入脚本，还是浏览器扩展 content script；
- 不要直接用 `setMaxListeners()` 提高上限掩盖 listener 泄漏；
- 如果应用自身存在重复挂 listener / subscription / reconnect / provider bridge，找到实际生命周期问题并修复；
- 页面路由切换、组件 mount/unmount、WebSocket/reconnect、任何 provider/multiplex 初始化不得重复累加监听；
- 如果该错误只来自第三方浏览器扩展，必须用“无扩展/干净 profile”和正常环境对照证明来源，并确认应用没有重复触发该扩展连接；
- 应用自己产生的 console error/warning 必须清零；外部扩展错误不得被错误归因并在项目里加入无效 workaround。

验收：连续刷新、路由切换、停留运行后 listener 数量不持续增长；无应用侧内存泄漏证据。

---

# 7. Web 问题三：交易记录时间顺序与平仓来源显示

交易记录页面需要调整：

1. 当前“建仓/平仓”信息中，**平仓时间放在上面，建仓时间放在下面**；
2. 整个交易记录默认按**平仓时间倒序**；最新完成平仓的交易排第一；
3. 未平仓记录不得用假的 close time 参与已平仓排序；
4. 排序必须基于权威 close timestamp，而不是页面字符串或列表插入顺序；
5. 分页/刷新以后顺序保持一致。

## 7.1 手工交易所平仓分类

用户通过交易所界面手工平仓时通常会形成 taker/吃单成交。当前页面需要把这类记录清晰标为“交易所平仓”。

必须审计和完善分类：

- 不要仅凭 `taker=true` 就把所有系统主动 taker Exit 错标为人工交易所平仓；
- 优先使用 order provenance、clientOrderId、系统 exit identity、manual/external source 等真实事实；
- 对没有系统 Exit provenance、确认为交易所侧/人工产生的 taker close，可显示为“交易所平仓”；
- 如果 provenance 不足，保持 UNKNOWN/外部平仓等诚实状态，不要伪造来源；
- UI 应能区分：TP 平仓、系统主动平仓、交易所/人工平仓、未知来源。

同时检查当前交易记录中“平仓收益特别小”的问题是否只是历史微小仓造成，还是新 economic mandate 仍可能产生低收益完整周期；不要把历史结果误判为新 build 行为。

---

# 8. 不要重新扩大风险门禁

本轮不要重新把 Gross / Direction / Cluster / Stress / Human exposure / position count / 历史 UNKNOWN 等组合指标变成 Entry veto 或 sizing authority。

它们可以继续显示、审计，但不能再次成为微小单或低资本使用的原因。

继续保留的执行正确性边界：

- 真实可用资金/保证金；
- 交易所 minQty/minNotional/step/tick/合法价格数量；
- fresh quote/account/private facts；
- identity/idempotency/reservation；
- TESTNET/Production 隔离；
- 未知提交状态的 exact recovery；
- reduce-only/退出订单 identity。

---

# 9. 最终验收

实施完成后必须：

- 全量 typecheck/build/test/verify；
- 对新增关键路径补针对性测试；
- 检查 schema/migration 可重复加载；
- push `main`；
- 允许直接 stop/start/restart 当前 TESTNET 实例，不需要逐次向用户申请；
- 最终实例必须运行最新 push build，并完成 source/artifact/build/runtime identity closure；
- Production writes=0；
- `/health=READY`、scheduler 状态真实可见；
- `/orders` 主活动 Entry 列表必须与交易所真实 open Entry orders 一致；若交易所为 0，主活动委托不能继续显示 113 个历史 UNKNOWN；
- 取消按钮在真实活动订单与历史 UNKNOWN 两种场景下都有正确、可观察的结果；
- Web 应用自身无持续 listener 累积；若 console 报错来自扩展，给出隔离证明；
- 交易记录平仓时间在上、建仓时间在下，按平仓时间倒序；
- 交易所手工平仓来源分类有 provenance 依据；
- 新 Entry 的 margin/notional/net/TP/horizon 可直接审计，不能再退化为低经济价值微小单；
- 自动 Entry 必须具有明确 Review/Exit 生命周期，不得无限期低收益 HOLD。

最终生成：

`docs/reports/v397-profitability-loop-web-final-implementation-20261002/IMPLEMENTATION_RESULT.md`

报告至少说明：

1. 最终 SHA / 运行 build / identity；
2. 建仓 sizing 和最低净收益闭环实际如何变化；
3. 最低 margin/notional/net Settings 最终生效值及来源；
4. 长持仓 Review/Exit 生命周期实际状态；
5. `/orders` 113 历史记录问题的根因和最终读回；
6. 取消按钮根因和验证；
7. `contentscript.js` / ObjectMultiplex 错误的真实来源及处理结果；
8. 交易记录排序、时间展示和“交易所平仓”分类结果；
9. 全量测试结果；
10. 仍然 UNKNOWN 的事实。

完成全部事项后一次性汇报，不要中途停下来等待阶段批准。

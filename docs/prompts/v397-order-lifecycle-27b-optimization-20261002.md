# V3.9.7 当前实例订单生命周期与 27B 角色优化：审计、计划并立即实施

> 目标：基于 **当前旧电脑 TESTNET 实例的实时事实**，一次性解决：
>
> 1. 本地/WEB 长期残留大量不存在于交易所的建仓订单、历史 UNKNOWN、取消按钮无效、订单生命周期无限残留；
> 2. 重新审计当前 27B 模型在系统中的真实职责，并判断、设计、实施它在 **建仓决策、待成交建仓订单管理、持仓 Review/Exit** 中的合理角色。
>
> 本任务不是复制旧报告数据。必须先生成当前实例专属实施计划，然后 **不等待用户再次批准**，直接按计划实施、验证、重启 TESTNET、提交最终结果。

---

## 0. 基线与证据规则

从 GitHub `3684993/ZDJMITS` 当前 `main` 开始。

必须先阅读：

- `docs/reports/v397-profitability-loop-web-final-implementation-20261002/IMPLEMENTATION_RESULT.md`
- `docs/reports/v397-core-economics-immediate-implementation-20261001/IMPLEMENTATION_RESULT.md`
- `docs/reports/v397-current-instance-full-implementation-20261001/IMPLEMENTATION_RESULT.md`
- 当前与 Orders、reconciliation、Entry lifecycle、open-order readback、AI Primary、Position Review、AI Exit、model routing、settings、runtime readback 相关的真实源码和持久化结构。

### 重要时间差

2026-10-02 09:14 左右上一轮部署报告曾读到：
- 23 个活动 Entry；
- 24 个持仓；
- 24 个 TP。

但用户在本任务发起时观察到：
- 交易所约 17 个实际持仓；
- 17 个止盈委托；
- **交易所没有其他活动建仓挂单/限价单**；
- Web 却仍显示类似：
  - 交易所活动建仓：16；
  - 止盈委托：17；
  - 人工委托：0；
  - 历史未确认：175。

**不得把上午报告的数据当作当前状态。**
执行任务时必须重新读取交易所、Engine API、SQLite、reconciliation/open-order readback，以任务执行当时事实为准。

所有“当前有多少订单/持仓/TP”的结论都必须带采样时间和来源。

---

# 1. 问题 A：为什么交易所没有 Entry，但 Web/本地仍长期存在大量订单

必须先完整验真，不要直接假设是 UI bug。

回答：

1. Web“交易所活动建仓”使用的权威来源是什么？
2. 当前交易所完整 open-orders snapshot 实际是多少？
3. 本地 Entry order、Entry intent、execution task、claim、runtime projection、reconciliation snapshot 各有多少？
4. 哪一层第一次把“远端已经不存在的订单”继续当成 active？
5. 是否存在：
   - snapshot 过期；
   - complete snapshot 没有覆盖旧 identity；
   - UNKNOWN 被错误归入 active；
   - cancellation 状态没有传播；
   - exact-order 查询没有使 projection 收敛；
   - restart hydration 重新复活历史 ACTIVE；
   - claim 与 order terminal state 分离；
   - API/UI 使用的“活动”定义与 reconciliation 不一致；
   - 当前 remote snapshot 已经为 0，但旧 snapshot 仍缓存；
   - 已验证 remote ABSENT/terminal 后本地状态仍未释放。
6. “历史未确认 175”分别是什么：
   - 真正未知 remote state；
   - 已经能由完整 open-order snapshot 证明不活动；
   - 只有历史审计价值；
   - 仍影响 claim/资金/Entry 权限；
   - 仅 UI 展示残留。
7. 为什么取消按钮会无效：
   - 页面按钮实际调用了什么 API；
   - API 是否收到请求；
   - 是因为 remote order 已不存在、identity 缺失、状态不允许、前端静默失败、错误没有展示，还是其他原因；
   - 对“远端不存在但本地仍显示”的记录，用户真正需要的动作是远端 cancel、local reconcile、dismiss/archive、还是 lifecycle close，必须按事实区分。

---

# 2. 用户要求的 Entry 订单生命周期

这是明确的产品目标，Codex 需要结合当前架构决定正确实现方式，但最终行为必须可验证。

## 2.1 未成交建仓单不能无限存在

对自动 Entry 建仓委托：

- 一个建仓订单如果 **超过 1 小时仍未成交**，不得继续无限保持活动状态。
- 到期后必须对交易所真实状态做最终核验。
- 如果远端仍然是活动订单，应进入确定性终止/取消生命周期。
- 如果远端已经不存在，应使本地 order / intent / task / claim / projection 收敛到不再占用“活动建仓”状态。
- 不能因为历史 UNKNOWN 而永久占用活动建仓列表、资金/身份占用或用户认知。
- 不允许为了“清理界面”伪造成交、伪终态或删除真实远端订单。

请审计当前 TTL、order age、maker wait/reprice、UNKNOWN recovery、cancel/reconciliation 的所有时间定义，找出为什么会产生几十小时甚至数天残留。

## 2.2 历史未成交 Entry 只保留 24 小时

用户要求：

- **未成交的历史建仓订单/委托记录仅保留最近 24 小时作为可见历史。**
- 超过 24 小时的“未成交 Entry 历史”不得继续出现在正常 Orders 页面，也不得继续膨胀活动/历史未确认计数。
- 必须区分：
  - 实际成交/部分成交记录；
  - 已形成持仓/交易周期的记录；
  - TP / Exit；
  - 真正未成交的历史 Entry。
- **不得清理真实成交 fill、持仓、Closed Trade、TP/Exit 审计链、PnL、资金费等交易事实。**

Codex 根据当前 storage 架构自行判断：
- 什么应该终态化；
- 什么应该从 active projection 移除；
- 什么只需要做 24h retention；
- 是否需要 compact/archive；
- 哪些表不能物理删除。

最终用户页面要清楚区分：
1. 当前交易所真实活动 Entry；
2. 当前 TP；
3. 人工活动订单；
4. 最近 24h 的未成交历史；
5. 更老的审计数据不进入普通 Orders 页面和计数。

## 2.3 定时维护

检查是否需要建立持续 lifecycle maintenance。

目标：
- 无需用户手工清理；
- Engine 正常运行时定期使 remote/open-order truth 与本地 lifecycle 收敛；
- restart 后也不能复活已经证明不活动的旧 Entry；
- 当前交易所 Entry=0 时，Web 的“交易所活动建仓”最终必须稳定为 0；
- 计数必须来自新鲜且完整的 remote truth，而不是历史本地行数。

具体 scheduler、事务、索引、retention job、API 设计由 Codex 根据代码事实决定。

---

# 3. 问题 B：现有 27B 模型到底已经在哪里使用

不要假定需要新增一个 27B。

必须先画出当前实际模型角色图，至少核实：

- Scout 使用哪个模型/endpoint；
- Primary 使用哪个模型；
- Position Review 使用哪个模型；
- AI Exit 使用哪个模型；
- 是否存在共享 model pool / concurrency / queue；
- 27B 当前 model id / endpoint / role；
- 27B 是否已经是 Primary；
- Position Review / Exit 是否已经复用同一个 27B；
- 是否存在重复调用、串行等待、资源竞争；
- 当前 Review enabled + Exit ENFORCE 是否真的会调用 27B；
- 为什么上一轮仍出现 `AI_EXIT_FACTS_INCOMPLETE`；
- 是模型没有调用、模型输出失败，还是进入模型前的事实链不完整。

最终报告必须明确：
**27B 当前真实职责是什么，而不是仅从配置名或历史设计推断。**

---

# 4. 27B 是否适合管理“建仓订单”

用户希望利用额外/现有 27B 能力改善待成交 Entry 的质量。

Codex 必须评估：

1. 已经产生 TradePlan/Intent、但 maker order 尚未成交时：
   - 当前系统谁决定继续等待；
   - 谁决定 reprice；
   - 谁决定 cancel；
   - 谁判断原方向/TP/thesis 已失效。
2. 这些动作是否完全机械，导致一个已经失去价值的 Entry 仍等待很久？
3. 27B 是否能在不破坏 exact-once/order identity 的前提下承担：
   - KEEP；
   - CANCEL；
   - REPLAN；
   - WAIT；
   - thesis invalidation；
   - 重新评估 1D/4H/15m 与目标收益空间。
4. 如果 27B 已经承担 Primary，是否应该复用原始 decision context，而不是重新全量推理？
5. 订单生命周期 1 小时上限与 27B 复核之间应是什么关系？
6. 27B 判断“计划失效”后，怎样与 deterministic order coordinator、cancel、terminal convergence 协同？
7. 模型不得直接绕开 clientOrderId、idempotency、exchange filters 和当前订单真实状态。

本任务的重点是：
**让高成本模型只负责判断机会/论点是否仍成立，确定性代码负责真实订单操作和身份。**

具体角色划分由 Codex 根据当前架构决定。

---

# 5. 27B 是否适合处理持仓

重新审计当前 Position Review / AI Exit 实际运行。

用户希望 27B 能用于：

- 当前持仓是否继续持有；
- 方向论点是否失效；
- TP 是否仍合理；
- 是否应减少持仓；
- 是否应退出；
- 是否已经长期占用资金但收益空间不足。

必须核实：

1. Review 当前是否真正在线；
2. 27B 是否真实收到持仓 review 请求；
3. 输入是否包含足够的新鲜事实：
   - 1D / 4H / 15m；
   - 当前价/成本价；
   - TP；
   - 持仓时间；
   - MFE/MAE 或可达性；
   - 当前经济空间；
   - fee/funding/depth。
4. 为什么已有持仓仍全部/大量停留 HUMAN_MANAGED，或者无法自然 Exit；
5. HANDOFF、HUMAN_MANAGED、AI_ACTIVE 当前状态机是否阻止 27B 管理；
6. 当前 Exit authority=ENFORCE 是否真正有可执行的 AI-owned position；
7. `AI_EXIT_FACTS_INCOMPLETE` 的首因分布是什么；
8. 是否应该让 27B 同时承担 Entry Primary 和 Position Review，还是角色/队列必须隔离；
9. 如何防止 Position Review 被大量 Entry 推理饿死。

不要预设“27B 一定能解决平仓问题”，必须用当前实例事实证明现有断点。

---

# 6. 不要把任务重新变成风险门禁工程

本轮不要重新增加：

- Gross veto
- Direction cap
- Cluster veto
- Stress veto
- Human exposure veto
- position count veto
- 历史 UNKNOWN veto

这些可以继续做观察。

本轮真正解决：

1. 真实远端订单与本地订单生命周期不一致；
2. 历史未成交 Entry 无限保留；
3. cancel UX/语义错误；
4. 27B 模型职责不清晰或未充分利用；
5. 待成交 Entry 计划长期不复核；
6. 持仓 Review / Exit 不能有效利用 27B 或事实链不完整。

继续保留执行正确性：
- TESTNET / Production 隔离；
- exchange filters；
- private/account/market truth；
- exact-once/idempotency；
- order identity；
- reduce-only；
- 持久化和远端终态证明。

---

# 7. 第一阶段：必须先生成当前实例 IMPLEMENTATION_PLAN.md

在任何业务修改前，先完成当前实时审计并提交：

`docs/reports/v397-order-lifecycle-27b-optimization-20261002/IMPLEMENTATION_PLAN.md`

计划至少包含：

1. 当前 source/build/settings/instance identity；
2. 当前交易所实际 position/open Entry/TP/manual counts；
3. 本地对应各类 order/task/claim/UNKNOWN counts；
4. Web 计数与 exchange truth 差异根因；
5. 取消按钮根因；
6. 1h Entry lifecycle 当前缺口；
7. 24h 未成交历史 retention 当前缺口；
8. restart hydration 是否复活旧订单；
9. 27B 当前真实角色图；
10. Primary / pending Entry review / Position Review / Exit 的职责现状；
11. `AI_EXIT_FACTS_INCOMPLETE` 根因分布；
12. 需要修改的模块和数据迁移/清理范围；
13. 定时 lifecycle maintenance 方案；
14. 27B 接入或重构方案；
15. 测试矩阵；
16. TESTNET 部署、重启、readback 验收；
17. 回滚方案；
18. 明确列出不能安全删除的数据。

计划内容必须基于当前实例实时证据，不得复制 09:14 的运行数字。

---

# 8. 第二阶段：生成计划后立即实施

**不要停下来等待用户批准。**

IMPLEMENTATION_PLAN.md 完成后立即按它实施：

- 代码；
- schema/migration（如实际需要）；
- retention / lifecycle maintenance；
- reconciliation/order truth；
- cancel API/UI；
- 27B model routing / role wiring；
- pending Entry review（若计划证明需要）；
- Position Review / Exit（若计划证明需要）；
- API/readback；
- Dashboard；
- tests；
- build/verify；
- TESTNET restart/load；
- 最终 runtime readback。

允许按需要 stop/start/restart 当前 TESTNET 实例。

不得产生 Production 写入。

如果迁移或清理本地数据库，必须先备份，并保证：
- remote active order 不会被误删；
- fill/trade/position/TP/Exit 审计事实不丢；
- cleanup 可审计；
- retry/restart 幂等。

---

# 9. 最终验收目标

至少验证：

### Orders

- 当前交易所 Entry=0 时，Web 活动 Entry 最终=0；
- 本地不存在被错误归类为 exchange-active 的旧 Entry；
- 超过 1h 未成交的新 Entry 能自动进入终止生命周期；
- remote active 时能正确 cancel；
- remote 不存在时能正确收敛/清理本地 lifecycle；
- cancel 按钮有明确成功/失败结果，不再“点击无反应”；
- 普通 Orders 页面未成交历史只保留 24h；
- >24h 的未成交 Entry 不进入普通历史计数；
- restart 不复活已终结旧 Entry。

### 27B

- 明确显示 27B 的 model id / endpoint / role；
- 不重复执行无意义的相同推理；
- 若用于 pending Entry review，结果可追踪到 order identity；
- 若用于 Position Review，结果可追踪到 physical cycle；
- AI 只给决策，确定性 coordinator 执行订单动作；
- Review/Exit 不被 Primary 永久饿死；
- `AI_EXIT_FACTS_INCOMPLETE` 有明确且可追踪的剩余原因；
- 若当前架构证明 27B 不适合某角色，允许不接入，但必须给出代码证据和替代职责方案。

### 安全和部署

- full tests / typecheck / build / verify 通过；
- identity closure 6/6；
- runtime 使用最终 push 的 build；
- Production writes=0；
- local/remote main clean；
- 当前 exchange truth 与 Dashboard readback 一致。

---

# 10. 最终报告

完成实施后生成：

`docs/reports/v397-order-lifecycle-27b-optimization-20261002/IMPLEMENTATION_RESULT.md`

一次性汇报：

- 最终 SHA；
- 运行 build；
- 当前交易所真实 Entry/TP/position/manual 数；
- 本地 active/history/UNKNOWN 数；
- 1h lifecycle/24h retention 实际策略；
- 清理了多少历史未成交 Entry；
- cancel 行为验证；
- 27B 当前/最终职责；
- 是否接入 pending Entry review；
- 是否接入/完善 Position Review/Exit；
- `AI_EXIT_FACTS_INCOMPLETE` 剩余首因；
- tests/build/verify；
- identity closure；
- Production writes；
- 仍然 UNKNOWN 的事项。

除 Production 安全、真实远端订单保护和数据完整性外，不要因为“还需更多样本”而停止本轮工程实施。

# ZDJ-MITS V3.9.6 — PLACE → Submit 根因穷尽与临界值闭合（2026-09-26）

## 本轮原则

先分析，后执行。不要先改阈值，不要先重启，不要只依据驾驶舱汇总 reason。

当前事实：Brain 连续产生 `PLACE_LONG/PLACE_SHORT`，但最近窗口 `PLACE > 0`、`risk admission pass = 0`、`submit = 0`，高频首因是 `PORTFOLIO_RISK · HUMAN_ACK_OVERDUE`，并伴随 `HUMAN_POTENTIAL_NOTIONAL_LIMIT / STRESS_LIMIT:*`。

目标不是“把数字调大让它通过”，而是把 PLACE 到 Submit 之间的所有实际 veto 全部找齐、计算每道门的真实临界值，并区分：

1. 交易所/资金/执行正确性所必需的约束；
2. 合法且当前真实生效的风险约束；
3. 重复权威、过期状态、错误作用域、错误归因或实现 bug；
4. 仅应 telemetry/alert，却意外成为 veto 的条件。

只修第 3/4 类。第 1/2 类不得通过 Infinity、默认值、UNKNOWN→0、silent clamp 或跳过 JIT 来绕过。

GitHub Actions 不使用，记 `NOT_RUN_BILLING_LIMIT`；所有测试/build/在线验证在本机完成。PR #9 不动。

---

## Phase 1 — 根因穷尽（只读，不改产品、不重启）

### A. Brain 决策逐笔回放

从 `http://127.0.0.1:8080/brain`、Engine events、SQLite durable state、pipeline/readback API 抽取最近至少 6 小时全部 Primary `PLACE_LONG/PLACE_SHORT`；若不足，扩到 12 小时。

对每个 PLACE 建立完整链：

`AI raw → normalized → executable envelope → allocation/plan → portfolio/risk admission → reservation → intent → JIT → submit`

逐笔输出：

- runId / cycleId / symbol / side / quoteAsset
- AI quantity / planned quantity / planned notional
- minQty / stepSize / minNotional / minimumLegalNotional
- verified leverage / margin tier
- quote available / reserved / lease / executable margin
- capitalMaximumExecutableNotional
- current gross / long / short / cluster / human notional
- 所有 risk reasons
- 第一真实 veto
- file:function/event type
- 是否到达 reservation / intent / submit

禁止只写 `PORTFOLIO_RISK` 这种总类；必须追到具体判断。

### B. 静态 + 动态穷尽全部 PLACE 后 veto

搜索 PLACE 之后到 exchange submit 之前所有 `REJECT/BLOCK/DENY/NO_TRADE/NOT_EXECUTABLE/return false/throw` 路径。

至少核对但不限于：

- HUMAN_ACK_OVERDUE
- HUMAN_POTENTIAL_NOTIONAL_LIMIT
- MAX_GROSS_NOTIONAL
- MAX_CLUSTER_NOTIONAL
- direction / clusterDirection
- max positions / inflight / reservation
- capital/margin
- minQty/stepSize/minNotional
- leverage/tier/filter proof
- market/private freshness
- ownership/domain conflicts
- JIT/version/idempotency
- UNKNOWN occupancy
- economic admission
- stale risk verdict / stale handoff facts

最终产出“所有 veto 点”清单：file:line/function、运行 reason、过去 6/12h 命中次数、属于上述 1/2/3/4 哪一类。

### C. 计算挂单临界值

对最近实际 PLACE 候选做只读 counterfactual replay；LONG/SHORT 至少各 3 个，USDT/USDC 均覆盖。

固定当时真实 exchange facts，求：

- exchangeMinimumLegalNotional
- capitalMaximumExecutableNotional
- 每一道 risk/policy gate 的 pass/fail 临界值
- 当前 planned notional 与各临界值的距离
- 哪一道 gate 是真正 first binding constraint
- 如果移除错误/重复/过期 veto 后，下一个真实 binding constraint 是什么

若某 gate 当前 headroom 为负，必须给出公式与实际数值；不能只给 reason code。

### D. 先提交分析报告，再动代码

生成：

`docs/reports/v396-place-to-submit-root-cause-analysis-20260926.md`

必须回答：

1. 为什么最近大量 AI PLACE 仍 0 submit？
2. 每个 veto 过去 6/12h 拦了多少次？
3. `HUMAN_ACK_OVERDUE` 是独立 veto、组合 veto，还是遮蔽了后续 veto？
4. HUMAN/GROSS/CLUSTER 的实际临界值是多少？
5. Dashboard 显示“LONG/SHORT 可执行新增名义 > 0”与 Risk Admission 0% 是否来自两个不同权威/不同语义？若是，具体哪两处？
6. 当前资金充足时，哪些 PLACE 仍会因为合法风险约束被拒？
7. 哪些阻断属于 stale/duplicate/bug/telemetry-as-veto？
8. 如果修完错误阻断，下一个真正会阻止 Submit 的条件是什么？

Phase 1 完成后直接进入 Phase 2，不等待用户选方案。

---

## Phase 2 — 只修错误阻断，直到真实 first blocker 唯一且可解释

根据 Phase 1 证据：

- 删除/合并重复权威；
- stale handoff/risk verdict 必须按真实生命周期自清除，不能永久阻断；
- telemetry/alert 不得误入 veto；
- Dashboard 的“可执行容量”必须与最终 risk admission 使用同一语义，不能一边显示可下单、一边 100% 被另一套隐藏权威拒绝；
- reason attribution 必须显示真实 first blocker，不能让前置标签遮蔽后续实际门；
- 若某 policy 在设计上仅 OBSERVE，则不得在 submit 路径硬 veto；
- 若某约束确为 ENFORCE/真实风险权威，则保留，并让容量/临界值在 AI 调用前显式体现，避免模型连续产生注定无法执行的 PLACE。

不得为了获得 submit 而：

- 把阈值改为 Infinity/超大值；
- 把 UNKNOWN 当 0；
- 伪造可用保证金；
- 绕过 exchange filters/tier/leverage；
- silent clamp AI 数量；
- 自动翻 LONG/SHORT；
- 跳过 JIT/version/idempotency；
- 解锁 Production。

### 测试必须覆盖

1. 可执行容量显示与最终 risk admission 不再互相矛盾；
2. OBSERVE 条件不 veto；
3. ENFORCE 条件真实 veto，并在 pre-AI envelope 就体现；
4. stale risk/handoff 状态按生命周期清除；
5. telemetry-only reason 永不 veto；
6. funds insufficient 必须拒绝；
7. below exchange minimum 必须拒绝；
8. filter/tier/leverage unproven 必须拒绝；
9. JIT/version/domain conflict 必须拒绝；
10. 修完一个 blocker 后能够正确暴露下一个 blocker，而不是错误显示 PASS。

跑 targeted、engine/core/dashboard 全量、typecheck、verify:deps、verify:scripts、S00、storage coverage、`git diff --check`、formal build。全部本地执行。

---

## 部署与在线验收

全部测试与 formal build 绿色后，允许必要的一次受控 `stop → MANUAL_START`；禁止循环重启、watchdog、hot reload。

部署后观察自然 Brain 流量：

- 对自然 `PLACE_LONG/PLACE_SHORT`，逐笔跟踪到真实 first blocker；
- 若 blocker 属错误/重复/stale/telemetry-as-veto，继续修；
- 若到达 reservation/intent/submit，记录第一个成功 submit 的 runId/cycleId/symbol/side/qty/notional/clientOrderId/exchangeOrderId；fill 不是 PASS 必要条件；
- 若仍由真实 ENFORCE 风险权威拒绝，必须给出**明确数值临界值**以及达到可执行所需的真实 headroom，而不是继续模糊写“风险限制”；
- 不强造 AI PLACE，不强造成交。

最终报告：

`docs/reports/v396-place-to-submit-root-cause-closeout-20260926.md`

最终状态只能二选一：

- `V396_PLACE_TO_SUBMIT_ROOT_CAUSE_CLOSED`：错误/重复/stale/telemetry veto 已清零，执行链与容量语义一致；或
- `V396_PLACE_TO_SUBMIT_BLOCKED_BY_VALID_ENFORCED_RISK`：剩余 blocker 已证明是当前真实 ENFORCE 权威，并给出精确临界值与所需 headroom。

必须保持 `productionWrites=0`、`lockedToTestnet=true`、PR #9 untouched。

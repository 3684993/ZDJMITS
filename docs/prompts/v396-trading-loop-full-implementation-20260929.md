# V3.9.6 交易闭环一次性完整实施指令

> 目标：基于已完成的根因审计与实施计划，一次性完成交易闭环相关 P1–P7 的代码实施、迁移、测试、构建、TESTNET 验证与最终实施报告。实施过程中**不要逐阶段向用户征求确认**。用户只在全部实施完成后进行最终验证与审核。

## 0. 必须先读的文件

实施前完整阅读并以其为主要依据：

1. `docs/reports/v396-trading-loop-root-cause-audit-20260929/ROOT_CAUSE_REPORT.md`
2. `docs/reports/v396-trading-loop-root-cause-audit-20260929/IMPLEMENTATION_PLAN.md`
3. 当前 `main` 的相关源码、schema、tests、runtime/readback。

审计报告是已验证的问题清单，实施计划是设计基线；**当前源码与当前 schema 才是最终事实**。若当前 main 已发生变化，应重新确认对应代码路径，不得机械套用旧行号。

---

# 1. 本轮授权与工作方式

这是一次**完整实施批次**，不是审计轮。

你需要自行完成：

- 代码修改
- schema/migration
- 必要的数据修复工具
- 单元/集成/回归测试
- API/readback/UI 修改
- 构建与正式验证
- TESTNET 运行验证
- 最终实施报告
- commit + push GitHub `main`

## 不要做的事

- 不要每完成 P1/P2/P3… 就询问用户是否继续。
- 不要把问题重新转回“需要用户决定”而停止实施。
- 不要只写方案、不落代码。
- 不要只修 Dashboard 表象而不修事实源。
- 不要以删数据、伪造状态、把 UNKNOWN 写成 0/成功来获得绿色结果。
- 不要用“提高 Entry/Exit 比率”代替闭环正确性。
- 不要因测试困难而跳过真实 SQLite/schema/identity 路径。

若遇到报告中的多种可选设计，基于以下原则自行选取：

1. 最小化破坏性；
2. 保持幂等、账本守恒和可恢复；
3. TESTNET_FUNDS_ONLY 目标优先；
4. 不削弱 Production 安全边界；
5. 不让 portfolio risk 通过其他字段重新变成 TESTNET Entry 隐性 veto；
6. 不扩大 HUMAN/HANDOFF 仓的自动处置权限；
7. 无法证明的数据保持 UNKNOWN。

你可以使用多个内部 commit，但不要把每个阶段当成需要用户批准的批次。全部完成后统一 push，并给出最终 SHA。

---

# 2. 永久保留的安全/执行边界

任何“简化权限/移除门禁”都不得删除以下约束：

- 真实可用资金/保证金；
- exchange filters：tick/step/minQty/minNotional/合法杠杆/交易所拒绝；
- private account / position / market facts 的真实性、新鲜度与身份；
- 同一 Intent / clientOrderId / payload 的 exactly-once 与 UNKNOWN submit 恢复；
- durable storage / transaction / outbox / schema correctness；
- 模型授权的数量、方向、价格范围、有效期；
- Exit 必须是可信的 reduction，只减仓不反向加仓；
- hedge/one-way positionSide 正确性；
- TESTNET / Production 环境和 transport 写隔离；
- Production 原有保护不得因 TESTNET_FUNDS_ONLY 被旁路。

本轮所有运行验证必须限定于 TESTNET。不得产生 Production 写入。

---

# 3. 一次性总体实施顺序

内部按以下依赖顺序实施，但连续完成，不等待用户：

1. P0 基线与测试 fixture
2. P1 Exit 终态传播 + 公平收敛
3. P2 positionCycle / Entry lot / Exit attribution / Closed Trade
4. P3 Entry claim / historical veto 与 submission identity 分离
5. P4 Entry admission 与资金/容量投影简化
6. P5 TP 与持仓退出职责重构
7. P6 funding / FX / depth / Review facts 与资源保障
8. P7 持仓时长、健康、审计 UI
9. migration / deterministic TESTNET repair
10. 全量验证、构建、运行核验、最终报告、push

如果后续阶段暴露前面阶段遗漏，直接回修并继续，不要停下来征求确认。

---

# 4. P0 — 建立可重放基线

先记录：

- 起始 main SHA；
- source/artifact/build identity；
- Settings 版本/hash；
- schema 版本；
- 当前 TESTNET engine instance/build；
- 当前两份 SQLite 的 schema/关键统计；
- 当前 positions/orders/claims/TP/closed-trade/readback 快照。

建立脱敏 fixture，至少覆盖：

- BRUSDT / NEARUSDT / WLDUSDT：TP 已 FILLED，但 durable Exit task/claim 仍 WORKING/ACTIVE；
- 多次同 symbol/side 加仓 + 单个聚合全仓 TP；
- 完全归零后重新建仓；
- historical UNKNOWN/claim 阻断新 Intent；
- NOT_APPLICABLE risk ceiling=0 但资金真实可用；
- slot 超限但 funds-only 应仅观察；
- analysis lease 占满 quote；
- WAIT_EXECUTION_RANGE 后 authorization 过期；
- system `v396x...` Exit fill 被误记 EXTERNAL_OR_UNLINKED。

所有新增核心逻辑都必须用这些真实形状做回归，而不是只构造理想 happy path。

---

# 5. P1 — Exit 终态传播与 claim 公平收敛

## 目标

解决：TP 已成交但 durable task/claim 不释放、固定前 8 项导致尾部饥饿、新周期无法补建 TP。

## 实施要求

### 5.1 统一 Exit order fact

建立统一的 `VerifiedExitOrderFact`（名称可按代码风格调整），至少包含：

- environment/account
- symbol/positionSide
- clientOrderId/exchangeOrderId
- originalQty/executedQty
- exchange status
- event/sequence identity
- source
- observedAt
- coverage/proof

WS、exact-order、普通 reconciliation、startup recovery、TP cancel/replace 都进入同一个幂等 reducer，不再各自独立更新一部分状态。

### 5.2 终态规则

- FILLED/CANCELED/EXPIRED/REJECTED 等终态只能前进，不能被晚到 WORKING 回滚；
- partial fill 更新剩余量；
- claim 只有在 identity + terminal proof 充分时释放；
- 当前 position 是否仍存在不得阻止旧 cycle 的 order/task 收敛；
- 不允许“本地标记 FILLED”直接无证据释放全部 claim。

### 5.3 公平 convergence

删除/替换固定 `slice(0,8)` 或等价逻辑。

实现持久或确定性的公平调度：

- lastAttemptAt / nextEligibleAt；
- round-robin cursor 或 priority queue；
- retry backoff 只影响当前失败项；
- 队列必须保证尾部 eventual service；
- readback 输出 queue length、oldest unpolled age、terminal-unreleased count。

### 5.4 验收

必须证明：

- >51 open tasks 时，前 8 项持续 WORKING 不会饿死尾部 terminal task；
- BR/NEAR/WLD 对应旧 claim 在证据充分后收敛；
- claim 收敛后，新周期 TP 可以创建；
- partial fill / cancel / WS乱序 / restart / query timeout / ABSENT UNKNOWN 全部幂等；
- 不产生重复 Exit，不产生净加仓 Exit。

---

# 6. P2 — positionCycle、Entry lot、Exit attribution 与 Closed Trade

## 目标

解决加仓 cycle 与整仓退出 cycle 不一致、数量不守恒、系统 Exit fill 变 EXTERNAL、Closed Trade 缺失。

## 数据模型

明确拆成两个身份：

### Physical Position Cycle

表示同一：

`environment + account + symbol + positionSide`

从可信 0 → 非0 开始，到可信归零结束的连续物理持仓周期。

### Entry Lot / Execution Plan

表示每次独立 Entry intent/authorization/fill。

加仓：产生新 lot，不自动产生新的 physical position cycle。

只有可信归零后再次开仓才创建新的 physical cycle。

## 实施要求

- schema 显式保存 `positionCycleId` 与 `entryLotId/planId`；
- fill 绑定必须支持：并发首次成交、WS先于ACK、重启恢复；
- 聚合 TP 针对真实物理仓数量；
- Exit fill 只保存一份真实 exchange fill；
- lot 会计分摊使用确定性规则。若现有策略没有合法定义，默认采用 FIFO 作为会计分摊，但策略 attribution 单独保存；
- `sum(entry qty) - sum(exit qty) == remaining remote position`（允许 exchange step tolerance）；
- fee/PnL 分摊总和必须保持账户总额不变；
- 数量归零即可 CLOSED；funding 未知时 net PnL 可以 UNKNOWN，不得因此伪造为未平仓；
- 负 remaining qty 必须进入 `LEDGER_INCONSISTENT`/等价显式异常，不得当正常 partial close。

## 系统订单 provenance

不要只依赖 client ID 前缀。

建立/使用 durable order registry，按：

- environment/account
- symbol
- clientOrderId
- exchangeOrderId
- intent/order identity

证明系统来源。

`v396x...` 但无法从 registry 证明的记录保持 UNRESOLVED；已证明系统生成的 Exit fill 不再落入 EXTERNAL_OR_UNLINKED。

## 历史迁移

提供 migration/backfill：

- 按环境/账户/symbol/side + exchange tradeId + 可信 position zero boundary 重建；
- 保留原始记录和旧→新 mapping；
- 无法证明的 cycle boundary 标 UNKNOWN/coverage gap；
- 不物理删除历史记录；
- 不把 HUMAN/HANDOFF owner 重置成 AI_ACTIVE。

---

# 7. P3 — 移除 TESTNET_FUNDS_ONLY 残留历史 Entry veto

## 目标

彻底分离：

- “同一提交 exactly-once”
- “历史 underlying/scope 风险占用”

历史 UNKNOWN/旧 claim 不得再作为新 Intent 的隐性风险 veto。

## 实施

定义类似：

### `SubmissionIdentity`

`env/account/intentId/clientOrderId/payloadHash`

负责 exactly-once、lost ACK、UNKNOWN submit recovery。

### `PortfolioScopeObservation`

underlying/方向/历史订单/风险信息，仅作为 funds-only 的 OBSERVATION。

TESTNET_FUNDS_ONLY 下：

- 不同 Intent 的旧 UNKNOWN/proof expired/历史 claim 不得阻断新 Intent；
- same Intent UNKNOWN 必须 exact-query，不允许重复 wire submit；
- same client + different payload 必须拒绝；
- 并发进程同 Intent 只能一个 submit；
- 已 RELEASED 的旧 submission identity 不可被复活；
- Production 旧策略若仍需 scope 排他，应显式限定 Production，不得共享索引无意作用到 TESTNET_FUNDS_ONLY。

必须检查 SQLite unique index/schema。不能只在 service 层加 if，而底层唯一索引继续跨 Intent veto。

错误原因保持 typed cause：journal/claim conflict 不要再次被包装成 `RESERVATION_INVALID` 或 generic `SUBMISSION_UNKNOWN`。

---

# 8. P4 — Entry 权限模型简化

## 目标

把目前复杂且互相矛盾的 Capital Admission / Risk / Readiness / Reservation / Final Submit 门禁收敛成清晰的三层事实。

### 8.1 `CandidateAnalysisEligibility`

只回答：是否值得/能够进入分析。

包括：

- market data availability/freshness
- model/scheduler resource
- basic symbol eligibility

它不是下单许可。

### 8.2 `EntryExecutionPermit`

这是 TESTNET_FUNDS_ONLY 唯一权威执行许可。

仅由以下事实组成：

- 精确环境/模式；
- fresh private account/position facts；
- actual available funds/margin；
- 未提交真实 reservation/commitment；
- exchange filters；
- valid model authorization；
- direction/qty/price bounds；
- submission identity/idempotency；
- durable storage；
- final JIT revalidation。

### 8.3 `PortfolioRiskObservation`

仅观察：

- Gross
- Direction
- Cluster
- Stress
- Human Potential
- Capital-at-Risk
- position count/slot
- historical/pending risk
- risk profile/readiness

在 `TESTNET && TESTNET_ENABLED && TESTNET_FUNDS_ONLY` 下必须明确：

`enforced=false`

不得再通过：

- zero ceiling
- fallback false
- missing risk proof
- UNKNOWN
- slot count
- legacy risk admission
- historical claim scope

间接变成 Entry veto。

## 资金/lease

修复分析 lease 占用整个 quote balance 的问题。

- lease/earmark 使用候选预算或可承担上界，不独占全部 available；
- model 结果返回后，原子 reservation 决定真实下单规模；
- one owner/one debit；
- current intent 的 lease/reserve 不得自我重复扣减；
- readback 明确 exchange available / reservation / earmark / executable-for-new-reservation。

## UI/funnel

- `NOT_APPLICABLE` 使用 null/absent，不得当成 `0 capacity`；
- `PLANNED_NOTIONAL` 是 sizing factor，不是风险阻断；
- slots/human/gross 等 funds-only 显示 OBSERVE；
- risk stage 在 funnel 中使用 `NOT_REQUIRED/OBSERVED`，不得继续显示“risk admission passed=0”却下游成功的假漏斗；
- 原始 primary cause 不得被后续 generic error 覆盖；
- 同一 readback 尽量携带统一 `asOf`，多源必须分别显示时间。

---

# 9. P5 — TP 与持仓退出职责重构

## 目标

修正固定 `$1` 净利润目标导致小仓 TP 过远、TradePlan 与 Guardian 目标不一致、长持仓没有有效复核的问题。

## TP 规则

### 必须删除/取消的行为

- 不允许隐藏 hard-coded `$1` 目标把模型授权 TP 强行推远；
- 不允许隐藏 1.2% floor 覆盖已配置/已授权目标；
- 不允许为了满足 `$1` 利润而反向放大仓位；
- 不允许所有仓统一“拉近 TP”而丢失原策略来源。

### 新契约

TradePlan 必须保存：

- 原模型目标/目标范围；
- 目标生成版本；
- expected fees/cost state；
- target validity/horizon；
- management/review deadline；
- owner/authority；
- TP mandate。

Guardian 应优先执行**当前仍有效的已授权 TradePlan 目标**。

若必须 fallback：

- 使用已有显式配置/市场结构逻辑；
- fallback 必须记录原目标、最终目标、原因、参数版本；
- “最小净利润目标”改成可观察的经济性信息/soft warning，不能偷偷把 TP 推远；
- 不新增 portfolio risk veto。

## 长持仓管理

不要仅依赖 TP 无限等待。

每个可自动管理的 AI_ACTIVE cycle 应有：

- target horizon
- next review time
- max management/review deadline
- HOLD / REDUCE / EXIT / HANDOFF 的明确决策记录

到 horizon/deadline 时重新评估，不允许静默无限延期。

HUMAN/HANDOFF 仓仍不得被自动接管。

## AI Exit

完成 P1/P2/P6 后，使 AI Exit 路径真正可工作：

- Review 可以针对合法 AI_ACTIVE position 调度；
- 决策必须基于完整、可证明的 costs/funding/depth/owner facts；
- result 返回后必须重新核 owner/deadline/fact versions；
- reduce order 必须走统一 ExitCoordinator 与 reduction proof；
- TP/reconciliation 不能依赖 AI 才运行。

不要通过扩大授权 TTL 来掩盖事实过期。

本轮不要自动把 HUMAN/HANDOFF 转为 AI_ACTIVE。

---

# 10. P6 — funding / FX / depth / Review facts

## Funding

建立真实 funding income ledger：

- environment/account/asset
- unique income identity
- pagination coverage
- positive/negative funding
- observed range
- cycle/lot attribution

无法 exact attribution 时保持 UNKNOWN。

不要再把“192 closed cycles”写成“192 funding fees unconfirmed”这种混合口径。

## FX

USDT/USDC 等 quote 的 PnL/fee/funding 必须有明确本位币契约。

- 能证明 FX 时使用带时间戳 FX；
- 不能证明时保持 UNKNOWN；
- 不允许 `fx=null` 然后默认当 1 USD 而不声明。

## Depth

真实从 order book 计算与 direction/qty/price bound 对应的 executable depth，带 source/time/sequence。

不得使用不存在字段或常量填充通过门禁。

## Review 资源

Review 与 Primary 共用模型资源时实现有界公平：

- priority/aging/reserved opportunity；
- Entry 持续排队不能永久饿死持仓 Review；
- 保持单模型最大并发限制；
- TP Guardian / reconciliation 不等待模型。

输出：

- last review
- next due
- failure count
- skipped reason
- authority state

---

# 11. P7 — 持仓累计时间、人工处置 UI 与健康状态

## 持仓累计时间

在：

- Position 列表
- 待人工处置/Human Managed 列表
- mobile card
- position detail

显示：

`连续持有 X天X小时`

并同时提供：

- openedAt/source
- last add time
- last review time
- human handoff time（如有）

计算基于可信 physical positionCycle.openedAt。

规则：

- 加仓不重置；
- 部分平仓不重置；
- 可信归零后重新建仓才重置；
- 若只能证明首次观察时间，显示“至少 X天X小时（首次观察）”；
- 无法证明时显示未知；
- key 必须包含 account/environment/symbol/side/cycle，不能只用 symbol。

## 健康状态拆分

不要再用一个笼统 HEALTHY/SETTLED。

至少拆分：

- exchange ingestion
- order terminal parity
- exit claim convergence
- TP protection coverage
- position coverage
- fill-cycle conservation
- funding coverage
- Review authority/health

活动委托统计要区分：

- remote-confirmed Entry
- remote-confirmed TP
- manual
- local unresolved/history UNKNOWN

历史 UNKNOWN 风险记录不能伪装成交易所真实 active order。

---

# 12. 数据 migration / repair

代码必须提供可重跑的：

- preview
- apply
- audit log

所有 repair 必须按 exact identity 和 evidence 执行。

允许在 TESTNET 对**证据充分、确定性**的数据进行修复；以下情况不得自动改写：

- 远端状态 UNKNOWN；
- cycle boundary 无法证明；
- fill provenance 无法证明；
- funding coverage 不完整；
- 会导致删除/覆盖原始事实。

这些保留 UNKNOWN，并写入最终报告。

Production 数据不得自动 repair。

---

# 13. 测试要求

新增/更新测试必须真实覆盖报告中的根因，不只验证类型。

至少包含：

### Exit

- >51 task 公平收敛
- terminal tail starvation
- partial fill
- cancel/expired/rejected
- lost ACK
- duplicate/out-of-order WS
- restart
- exact-order timeout
- claim release proof
- no duplicate reduce submit

### Lifecycle/Lot

- 6+6+6 entry → 18 exit
- 2+2+2 → 6
- 多次加仓 + partial close + 再加仓 + full close
- zero → reopen
- hedge long/short 同 symbol
- external/manual fill
- late historical fill
- duplicate import
- fee/PnL conservation

### Entry

- funds-only + old UNKNOWN claim → 新 Intent 不被历史风险 veto
- same Intent replay exactly-once
- same client/different payload reject
- concurrent submit one wire call
- insufficient margin reject
- stale private reject
- invalid exchange filter reject
- Production legacy isolation

### TP/Review

- authorized TP 不被 `$1`/1.2% 隐性覆盖
- fallback 有 provenance
- horizon 到期触发 review
- HUMAN/HANDOFF 不自动接管
- AI_ACTIVE review 公平调度
- funding/depth/FX unknown 不伪造

### UI

- duration 加仓/partial close 不重置
- zero/reopen 重置
- unknown/first-observed 文案
- NOT_APPLICABLE != 0
- OBSERVE 风险不显示 Entry blocker
- active order 分类正确

必须使用真实 SettingsStore/SQLite schema 的集成测试验证关键 unique index/claim/migration，不得全部 mock 掉。

---

# 14. 全量验证

全部实施完成后一次性执行并修到通过：

- targeted tests
- full test suite
- typecheck
- formal build
- full verify
- S00
- storage/schema/migration tests
- diff check
- secret/config scope check

若仓库已有标准验证脚本，以仓库现行脚本为准并全部执行。

不得因为一次失败就提交“部分完成”。继续定位并修复直到全套达到可审核状态。

---

# 15. TESTNET 运行验证

在确认构建与身份正确后，对 TESTNET 进行最终运行验证。

允许必要的 TESTNET engine 手动重启/加载以验证本轮代码，但：

- 不安装 watchdog/autostart；
- 不触碰 Production；
- 不为制造证据而强行制造真实市场成交；
- 可以使用 fixture/replay 证明确定性路径；
- 自然 TESTNET 行为用于证明实例已加载新代码和链路正常。

运行 readback 至少确认：

- source/artifact/runtime identity 一致；
- Exit oldest-unpolled age 有界；
- terminal-unreleased claims 不再长期堆积；
- TP missing 有明确原因且可被轮转维护；
- fill-cycle conservation 正常；
- CLOSED trade 可随真实退出形成；
- system Exit fill provenance 正确；
- Entry historical risk observation 不再 veto 新 Intent；
- 真实资金不足/private stale/filter invalid 仍拒绝；
- Gross/Direction/Cluster/slot 等只 OBSERVE；
- capacity/readback 无 0/NOT_APPLICABLE 矛盾；
- Review 不被 Entry 永久饿死；
- Human/Handoff 未被自动接管；
- duration UI 正确。

若自然市场窗口没有 Exit fill，不把“没有自然成交”当失败；必须用 replay/integration evidence 证明代码路径，再如实记录自然观察结果。

---

# 16. 最终交付文件

全部完成后新增：

`docs/reports/v396-trading-loop-full-implementation-20260929/IMPLEMENTATION_RESULT.md`

内容必须包括：

1. 起始 SHA / 最终 SHA
2. 实际修改文件清单
3. schema/migration
4. P1–P7 每项实际实现
5. 与原实施计划不同的设计决定及原因
6. 历史数据 repair 实际执行范围
7. 无法安全 repair 的 UNKNOWN 清单
8. targeted/full tests 数量与结果
9. typecheck/build/verify/S00/storage/diff 结果
10. TESTNET runtime identity
11. 运行 readback/自然证据
12. Production writes = 0 的确认
13. 当前仍存在的已知限制
14. 最终 GitHub commit SHA

不要创建一堆阶段性报告；最终以这一份实施结果报告为主。

---

# 17. Definition of Done

只有同时满足以下条件才算本轮完成：

- P1–P7 全部有实际代码实现；
- schema/migration 已实现并测试；
- Exit terminal/claim starvation 根因关闭；
- positionCycle/lot/Closed Trade 守恒模型落地；
- TESTNET funds-only historical claim veto 被移除；
- Entry 权限模型与 Dashboard 投影统一；
- `$1`/隐藏 TP floor 不再无授权重写目标；
- AI_ACTIVE 的 Review/Exit facts 链可工作；
- HUMAN/HANDOFF 未越权；
- 持仓累计时间显示完成；
- full verification 全部通过；
- TESTNET 新 build 已完成最终运行验证；
- Production writes 为 0；
- 工作树干净；
- local/remote `main` 最终一致；
- `IMPLEMENTATION_RESULT.md` 已提交；
- 最终 commit 已 push 到 GitHub `main`。

实施过程中不要再询问用户“是否进入下一阶段”。全部完成后一次性汇报结果，交由用户最终审核。
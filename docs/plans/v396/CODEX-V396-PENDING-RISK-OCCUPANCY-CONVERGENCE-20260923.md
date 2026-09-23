# V3.9.6 Pending Risk 单一占用事实源收敛修补（2026-09-23）

## 0. 任务性质与边界

这是一次**离线产品修补轮**，目标是闭合 `PortfolioRiskAdmission` 对 durable Entry pending risk 的错误过度计数，让 PortfolioRisk 与系统已经存在的权威 Entry 风险占用语义完全一致。

当前基线分支：`codex/v396-final-convergence-20260922`。
执行前必须 `fetch` 并 `merge --ff-only` 到最新 convergence；本任务创建前远端产品/部署基线为 `32feb031969c5ee4f530df9b43688a7c8b29269a`，其中 Anti-Waste 已在线部署并验收。若最新 HEAD 仅多 docs/evidence，则继续；若存在未审产品代码变更，先逐项核对，不得覆盖或回退。

本轮**不授权**：

- Engine stop/start/restart、热重载、watchdog、自启动、计划任务；
- 构建覆盖线上 `apps/engine/dist` / `apps/dashboard/dist`；
- 任何 Settings 写入；
- `READ_ONLY -> TESTNET_ENABLED`；
- PortfolioRisk profile 填值或 `configured=true`；
- Testnet/Production 交易所写；
- 修改 `maxGrossExposurePct`、`maxDirectionExposurePct`、`maxPositions`、private freshness 60s、timeout、reachability、经济/风险阈值、`aiExitAuthority`；
- 删除、改写、伪装历史 UNKNOWN durable order 来让风险通过；
- 将 UNKNOWN 一律视为 0 风险。

PR #9 不得触碰；历史只允许 fast-forward，不 rebase/squash/force。

---

## 1. 已证明的线上根因，不要重新猜

部署 `e284a1a` 后，新实例 PID 50996 已证明 Anti-Waste 正常：当 execution readiness 未满足时 PRIMARY/SCOUT 新调用均为 0，而候选/行情供给继续刷新。

当前 PortfolioRisk pending-risk 的独立缺陷已通过线上持久层重放证明：

1. durable Entry order 中仍有 46 条 `status=UNKNOWN`、`expiresAt=null`；
2. `PortfolioRiskAdmission.inputs()` 当前用自建 status-only 过滤：`NEW/PARTIALLY_FILLED/UNKNOWN/SUBMITTING` + expiresAt，从而 46 条几乎永久进入 `builtPending`；
3. 系统权威占用谓词 `entryOrderOccupiesRisk(order, now)` 已存在于 `entryRiskOccupancy.ts`，UNKNOWN 只有在**没有**新鲜、身份匹配的 `VERIFIED_NO_ACTIVE_RISK` 证据时才占风险；
4. 同批 46 条中，权威谓词仅认为 2 条仍占风险；44 条已有 `VERIFIED_NO_ACTIVE_RISK` + identity tombstone 匹配 + 证据未过期；0 条有已证明的真实 active exchange risk；
5. 旧 PortfolioRisk 因此制造约 `$30,629.41` phantom pending notional，而权威占用集合约 `$606.92`；
6. 如果先配置 PortfolioRisk profile，这些 phantom rows 很可能先触发 `STRESS_LIMIT:MAX_GROSS_NOTIONAL`，形成“profile 配了仍不交易”的假 blocker。

这属于**过度计数 / authority divergence**，不是漏计风险；修复必须继续 fail-closed。

---

## 2. 单一事实源要求（核心）

### 2.1 禁止第二套 active-order 判断

`PortfolioRiskAdmission` 不得再维护自己的状态枚举来决定 Entry order 是否占风险。

权威代码已在：

`apps/engine/src/services/entryRiskOccupancy.ts`

其中至少包括：

- `hasVerifiedNoActiveRisk()`
- `entryOrderOccupiesRisk()`
- `entryClaimReleasedByExchangeFacts()`
- `collectPendingEntryRiskExposures()`

优先设计：让 PortfolioRisk 的 pending exposure 构造**消费 `collectPendingEntryRiskExposures()` 或同一模块提供的单一权威投影**，不要复制其条件表达式到 `portfolioRiskLedger.ts`。

如现有 `collectPendingEntryRiskExposures()` 缺少 PortfolioRisk 所需字段，可在 `entryRiskOccupancy.ts` 做最小、通用、可测试的扩展；不要在 PortfolioRisk 中重新实现 active-status/UNKNOWN-release 判断。

### 2.2 UNKNOWN 必须继续 fail-closed

必须保持：

- `UNKNOWN` + 无有效证明 => 仍占风险；
- `UNKNOWN` + 证据过期 => 仍占风险；
- `UNKNOWN` + tombstone/identity 不匹配 => 仍占风险；
- `UNKNOWN` + 证据不完整/非 VERIFIED => 仍占风险；
- 只有当前 `hasVerifiedNoActiveRisk()` 判定为真时，UNKNOWN 才能从 active pending exposure 中释放；
- 绝不能因为 `exchangeOrderId=null` / `filledQuantity=0` 单独判定无风险；这些只是证明链的一部分，不是充分条件。

不要删除 UNKNOWN durable row。其历史审计价值保留，只改变“它现在是否占新风险容量”的权威解释。

---

## 3. 同一 lineage 不得 reservation/order 双计

`PortfolioRiskSnapshot` 的契约已经写明：**Same reservation/order lineage must share one dedupeKey**。

当前 `PortfolioRiskAdmission.inputs()` 却给 reservation 用 `reservation:<id>`，order 用 `order:<id>`，这可能让同一 lineage 同时成为两个 pending exposure。

修复后必须满足：

- 一个 active reservation 尚未形成 order：只计一次 reservation 风险；
- order 已代表同一 reservation：order 事实优先，reservation 不再另计一份；
- partial fill：pending 只计**剩余未成交数量**对应的风险，已成交部分应由 position/exchange facts 承担，不得 full order + position 双计；
- 无 reservation 的 active order 仍 fail-closed 计入；
- lineage identity 必须稳定、可审计、重启后相同；
- PortfolioRisk 使用的 `dedupeKey` 必须与上述 lineage 语义一致，不可再制造 reservation/order 两个互不相干的 key。

优先复用 `collectPendingEntryRiskExposures()` 已实现的“orders win over reservation / remaining quantity / unreserved active order”语义。

---

## 4. quoteAsset / marginUsd 映射一并收敛

当前 `portfolioRiskLedger.ts` 对 pending Entry order 写死 `quoteAsset:'USDT'`。系统真实路由同时存在 USDT 与 USDC，该写法不允许保留。

要求：

1. quote/margin asset 必须从该 order 的**权威 lineage**读取：reservation / intent allocation plan / durable order 已证明字段中的单一来源；不得仅靠字符串猜测，除非现有契约明确把 symbol suffix 定义为最终 fallback，且 fallback 必须测试并有 reason；
2. USDC order 必须保持 USDC，不得落入 USDT bucket；
3. `marginUsd` 必须与该 pending exposure 的**剩余 notional**相匹配：
   - 对 order，若可证明 leverage > 0，应按剩余 notional / leverage 或现有权威 order/reservation 语义得到；
   - 对纯 reservation，继续使用其经过契约验证的 margin/notional；
   - 缺失/矛盾时宁可 `UNKNOWN/CONFLICT` 阻断，不得填 0、不得虚构默认杠杆；
4. 不改变 `Position.notionalUsd` 的冻结语义：仍为 unsigned absolute magnitude；方向仅由 side 表达。

如果为了做正确映射需要新增一个小型纯函数，应放在 Entry risk occupancy / mapping 语义附近，并由测试锁定；不要创建第二套 PortfolioRisk-specific 订单事实模型。

---

## 5. 必须先写红测，至少覆盖这些敌意案例

在旧实现上先证明失败，再修绿。至少覆盖以下 7 类：

### T1 UNKNOWN + 有效 no-active-risk proof

- status=`UNKNOWN`
- `activeRiskExposure=false`
- evidence.status=`VERIFIED_NO_ACTIVE_RISK`
- checkedAt/validUntil 有效
- identityTombstone 精确匹配

期望：

- `entryOrderOccupiesRisk=false`；
- PortfolioRisk pending 不再包含该 order；
- 不出现该 order 的 `PENDING_RISK_UNVERIFIED`；
- durable order 本身仍保留 UNKNOWN，不被改写/删除。

### T2 UNKNOWN 无证明

期望：仍占风险，PortfolioRisk fail-closed；不得释放。

### T3 UNKNOWN 证明过期 / identity 不匹配 / evidence 非 VERIFIED

三种至少参数化覆盖；期望全部继续占风险。

### T4 reservation → order lineage 去重

同一 reservation 已产生 active order：snapshot pending exposure 只能 1 份，order 优先；不得 reservation + order 双计。

### T5 partial fill

有真实 partial fill 时，pending notional 只计 remaining quantity；不得把 full order 重复计入，同时不能吞掉已成交的 position 风险。

### T6 USDC 映射

构造 USDC Entry lineage，PortfolioRisk pending 的 `quoteAsset/marginAsset` 必须为 USDC；不得硬编码 USDT。

### T7 线上型 46 行回归

构造等价 fixture：46 条 historical UNKNOWN，其中 44 条满足有效 `VERIFIED_NO_ACTIVE_RISK`，2 条仍未证明。

期望：

- PortfolioRisk active pending order count 与 `entryOrderOccupiesRisk` 逐行完全一致；
- 只保留 2 条风险占用；
- snapshot pendingNotional/gross 只增加权威占用集合的 notional，不再增加 46 条总和；
- 测试明确证明“释放 44 条不是 UNKNOWN=>0，而是 verified absence-of-risk proof 生效”。

最好再增加一个 invariant/property-style 测试：对任意测试集合，PortfolioRisk order pending membership 必须等于 `entryOrderOccupiesRisk(order, now)` 的 true 集合（考虑 reservation lineage 去重后）。

---

## 6. 只读现场对账证据

允许对当前 PID 50996 做**只读**查询，不允许改 DB/Settings/订单。

修补完成后，用当前持久层数据或其只读导出生成离线 before/after 对账：

- durable UNKNOWN 总数；
- `entryOrderOccupiesRisk=true/false` 数；
- 旧 status-only PortfolioRisk pending 数；
- 新权威 pending 数；
- 被释放的 orderId 清单及每条 proof：evidence status、validUntil、tombstone match、activeRiskExposure；
- 仍占风险的 orderId 与具体原因；
- old pending notional vs new pending notional；
- old gross vs new gross 的差值来源；
- reservation/order lineage 是否存在双计以及修复后数量；
- USDT/USDC pending 分桶是否与真实 lineage 一致。

注意：不要为得到“漂亮数字”去刷新、伪造或延长证据；采样时证据若自然过期，按当时真实 `now` fail-closed，并解释与此前 44/2 快照为何变化。

---

## 7. 不允许顺手修的事项

本轮不要处理：

- PortfolioRisk profile 参数取值；
- `configured=true`；
- executionMode；
- private REST timeout / proxy 路由抖动；
- egress；
- P3 驾驶舱文案；
- maxGross/maxDirection/maxPositions；
- ENFORCE / aiExitAuthority；
- 24h soak 结论。

这些均不能成为本轮把 scope 扩大的理由。

---

## 8. 门禁与资源纪律

完成红→绿后至少执行：

- 受影响 Engine 测试；
- Engine 全仓 tests；
- Engine typecheck；
- core/contracts 相关门禁（contracts 0 tests 时必须继续明确“不代表覆盖”）；
- `verify:deps`；
- S00 静态；
- storage coverage；
- `git diff --check`。

构建若需要，只能输出到隔离 `build-check/`，随后删除；**不得写 live dist**。

不需要为了本任务重复跑无关 UI 浏览器验收，除非代码实际修改 Dashboard（原则上不应需要）。

---

## 9. 提交与报告

证据目录：

`docs/evidence/v396/pending-risk-occupancy-convergence-20260923/`

报告：

`docs/reports/v396-pending-risk-occupancy-convergence-20260923.md`

最终 fast-forward push，工作树 clean，PR #9 不变。

最终回复必须明确回答：

1. 最终 HEAD；
2. 是否彻底删除 PortfolioRisk 自建的 status-only occupancy 判定；
3. PortfolioRisk 是否复用 `entryOrderOccupiesRisk` / `collectPendingEntryRiskExposures` 的单一事实源；
4. 线上型 46 条 fixture/只读事实下，old count / authoritative count / released count / still-occupied count；
5. old/new pending notional 与 phantom notional 消除量；
6. reservation/order 是否还有双计；
7. partial fill 是否只计 remaining risk；
8. USDC 是否仍会被误标成 USDT；
9. UNKNOWN 无证明/过期/身份不匹配时是否继续 fail-closed；
10. 所有门禁 exit code；
11. 是否做了任何 Engine 生命周期动作、Settings 写、exchange 写（预期全部否）；
12. 下一步是否已经可以进入 PortfolioRisk profile 人工审批，还是还有新的事实一致性 blocker。

若发现新的 P0/P1 数据一致性缺陷：本轮可以在**同一个 pending-risk authority scope** 内用最小修复闭合；若超出本 scope，不要改，记录并报告。

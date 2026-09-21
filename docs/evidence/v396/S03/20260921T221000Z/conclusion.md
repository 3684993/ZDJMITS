# S03 结论：READY_FOR_REVIEW（不自签 ACCEPTED）

阶段：S03 退出成本估值与 10 USDT 权限闸。runId `20260921T221000Z`。
base：`2b502ec`（PR #9 冻结 head，未改动）；分支 `codex/v396-s03-exit-cost-policy-20260921`。
范围：**纯离线函数与测试**。未接任何发单路径、未接 S04 `reserve`、未部署、未启停 Engine、未访问交易所或外网、未改现网 Settings 或数据库、未做现网迁移。这些约束由 `s03ExitCostPolicy.test.ts` 的纯度与消费者扫描强制（模块内无一条非类型 import，`src` 下除本测试外无人引用）。

## 实现

- `s03ExitCostEstimator.ts`：`buildExitEstimate`（CONTRACTS §5 全字段 + `estimateHash` + `quoteAt/expiresAt/quoteFresh`）、`deriveProjectedExit`（按退出方向盘口/滑点带推导剩余毛收益与预计费用）、`exitPriceBound`（可执行限价边界）、`stableHash`。
- `s03AiExitPolicy.ts`：`decideAiExit`，优先级严格为 owner/期限 → 事实完整性 → 深亏 → 论点失效小亏 → 微利 → HOLD；输出 `reasonCodes/evidenceRefs/ownerVersion/planVersion/estimateHash/authorizationExpiresAt/boundaryPrice`，`orderType:'LIMIT'`、`marketFallbackAllowed:false` 为字面常量。
- 十进制策略：金额一律整数 milli（1/1000 计价币种），亏损线用整数精确比较，**不存在 epsilon 容忍**。

## S03-T01～T09 逐项证据（`s03-tests.json`：14 项全通过）

| ID | 证据 |
|---|---|
| T01 | 同口径成本下 `-9.99 / -10.00 → ALLOW`，`-10.01 → HANDOFF`；`netIfAllClosed` 精确等于三者；阶段文件工作样例 `-9.2` 复算一致 |
| T02 | 未失效论点 → HOLD（`NO_PERMITTED_EXIT_CONDITION`）；缺谓词或缺证据 → `BLOCKED_FACTS` + `THESIS_INVALIDATION_EVIDENCE_MISSING`；`allowSmallLoss=false` → HOLD，不见亏即砍 |
| T03 | 剩余毛 +3、剩余费 3.4 → 净 `-0.4`，即使 `exitConditionMet` 也不进微利分支；净额 +2.6 且条件成立才 ALLOW，条件不成立 → `PROFIT_EXIT_CONDITION_NOT_MET` |
| T04 | 同 id 重复（含跨 kind 复用同 id）被丢弃且净额不变、`DUPLICATE_COST_ITEM` 计数 2；入场费 + 前次退出费各自只计一次（`incurredFees=1.4`）；`CONFLICT` 事实 → 净额 null → `BLOCKED_FACTS` |
| T05 | USDC 费用经新鲜汇率 0.98 折算为 `-0.98` 且 `EXACT`，同时记 `SEPARATE_STABLE_ASSET`；汇率过期 → `UNKNOWN`、净额 null、`UNCONVERTED_COST`、判定 `COST_CURRENCY_UNCONVERTED`；完全无汇率同样 `UNKNOWN`；任何情况都不当 1:1 或 0 |
| T06 | 盈利净额 +1.8 时 `HUMAN_MANAGED / CLOSED / HANDOFF_PENDING` 一律 HOLD 且 `authorizationExpiresAt=null`；`now == deadline` → `HANDOFF`（`AI_MANAGEMENT_EXPIRED`）；deadline 缺失 → `HANDOFF`（`AI_MANAGEMENT_DEADLINE_UNKNOWN`） |
| T07 | LONG 卖价下限向 tick 上取整、SHORT 买价上限向下取整：限价落在 tick 网格上、复验净额 ≥ 目标，且**再降一个 tick 就破线**（证明取整方向只会更保守）；不可达 / 名义额过小 / tick 非法 分别返回 `BOUND_UNREACHABLE / BOUND_NOTIONAL_TOO_SMALL / BOUND_MARKET_INPUT_INVALID`；边界不可执行时判定只能是 HOLD（`EXECUTION_BOUND_UNAVAILABLE`），全程无 market 分支 |
| T08 | 部分成交累计：已实现 -6 + 前次退出费 0.4 + 入场费 0.3 + 剩余 -4 -0.2 -0.1 → 净额 `-11.0` → HANDOFF，**本轮腿本身很小也不新开户预算**；同 cycle 外的 +50 与跨 scope 的 +80 均被 `FOREIGN_CYCLE_FACT` 丢弃，净额与结论不变（不能跨仓抵扣） |
| T09 | 报价过期 → `QUOTE_EXPIRED_NO_AUTHORITY` + `QUOTE_STALE_FOR_AUTHORITY`；NaN 金额、负费用 → `CONFLICT` + `NEGATIVE_COST`；漏传剩余费用投影 → `MISSING_PROJECTION` 且视为 `UNKNOWN`（**缺失投影不当 0**）；tick 非有限、`minNetProfitUsd=NaN`、`lossLimit=11`、`authorizationTtlMs=0` 全部拒绝且不返回 ALLOW |

## 性质测试

1. **成本单调**：150 组随机事实下提高任一成本项，`conservativeNet` 不升，且原本非 ALLOW 的判定**绝不变为 ALLOW**（违反即 throw）。
2. **价格单调**：150 组随机报价下，LONG 卖价恶化 / SHORT 买价恶化不会提高剩余毛收益或降低费用；带滑点时结果只能是 `CONSERVATIVE_BOUND`，其保守端 ≤ 面值；非法价格 → `UNKNOWN`。
3. **哈希一致与敏感**：相同事实（含对象键序重排）→ 同一 `estimateHash`；数量、positionVersion、costVersion、报价窗口、以及四类金额任一单项变动 → 哈希必变；`stableHash` 与键序无关。
4. **判定携带身份**：ALLOW 输出必须带 `estimateHash`、`boundaryPrice`、`authorizationExpiresAt = min(now+ttl, quoteExpiry, deadline)`，且 `orderType:'LIMIT'`、`marketFallbackAllowed:false`；owner/plan 与估值 cycle 不一致或版本非法 → HOLD 且无授权。

## 构建过程中发现并修掉的真实缺陷

`UNCERTAINTY_BUFFER` 原先未被归入减项，导致**缓冲被加到净额上而不是扣除**（-9.99 被测成 -9.59、-0.2 被测成 +0.2）。由 T01/T06 的期望值暴露后修复：现在减项集合含 buffer，估计字段按契约语义报告正幅度、净额按带符号贡献求和，且缓冲不与有界毛收益里已含的滑点重复扣。该缺陷若非用具体金额断言就会被「测试全绿」掩盖。

## 剩余缺口（S03 不上调为 ACCEPTED 的原因）

1. **未接任何消费者**：估值与判定目前只被测试调用，`manualPositionService` 的人工预览仍走自己的粗算 `projectedNet`；两者口径未合并，人工预览不得被当作 AI 亏损闸真源（已在文档中显式区分）。
2. `estimateHash` 未与 settingsVersion / riskGeneration / factsStatus 的**权威版本源**绑定（S04 需要在提交前复验版本一致），当前仅覆盖估值自身输入。
3. 报价与深度来自调用方传入，未接 `MarketDataHub` 真实盘口新鲜度；滑点带来源（`slippageBufferPct` 等）未与设置项建立回读链，属 S08。
4. 费用率假设为常数 `feeRate`，未接入按符号/ maker-taker / 档位变化的真实费率与**费用币种**清单（部分交易以非 USDT 收费），S04 前必须补。
5. 强平价距、清算与保证金影响未纳入本阶段（属 S05）；execution variance 记录（步骤 7）需 S04 的成交回执才能计算，目前只有净额与边界。
6. `tickSize/stepSize/minNotional` 来自输入参数，未验证与交易所 symbol info 的真实来源绑定，故「可执行」结论目前只在给定市场参数下成立。

## 门禁复跑

`build -w @zdj/contracts`、`build -w @zdj/core` 通过；`typecheck -w @zdj/engine` 0 错误；全仓 Engine **134 文件通过 / 0 失败 / 退出码 0**；S03 套件 14 项全通过；S00 静态门禁 6 项 PASS（入口规则表未改，108 条推导记录）；`git diff --check` 干净。

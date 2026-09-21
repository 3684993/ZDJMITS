# S03 独立审查（第 2 批：确定性 P0/P1 修复）

输入：S03 head `b09de2d`（base 为 PR #9 冻结的 `2b502ec`，未改动）。范围：仅审查与修确定性缺陷；未接人工预览、MarketDataHub、Settings、真实费率或 symbolInfo；未接 S04、未部署、未启停 Engine、未访问交易所或外网、未改现网。

方法：每项发现先写成红色断言并确认失败，再改代码。7 项新断言修复前 **全部失败**，修复后 S03 套件 **21/21 通过**（见 `s03-tests.json`）。

| 编号 | 修复前的事实 | 处置 |
|---|---|---|
| **P0-1** 结构缺陷不参与 fail-closed | `tickSize=NaN`、`stepSize=0`、`entryPrice<0`、报价窗口倒置、`minNotional=0`、`scope` 为空、剩余数量为 0、side 非 LONG/SHORT、`positionVersion=0`、`costVersion` 为空、bid 缺失 —— 净额仍被判 `EXACT` 并可直接产出 ALLOW，即用坏行情参数定价 | `INTEGRITY_REASON_CODES` + `integrityFailure()`：命中即 `factsStatus=CONFLICT`、净额 null；`decideAiExit` 独立复查同一清单（`ESTIMATE_INTEGRITY_FAILED`），使「把 estimate 对象改个标签」也无法换来 ALLOW |
| **P1-2** 跨周期/跨仓位事实被静默丢弃 | 别处的 `+50` 只留一条 reason，估值照算：调用方作用域传错不会暴露 | `FOREIGN_CYCLE_FACT` 纳入完整性失败 → 整份估值 `CONFLICT` 并 `BLOCKED_FACTS`；同 id 幂等重投仍守恒且**不**算冲突。T08 断言按更强口径更新（原为「不抵扣」，现为「拒绝」） |
| **P1-3** tick 归一化留浮点残渣 | LONG 边界价返回 `100.55000000000001`；交给下单路径必被交易所拒绝或被下游静默再取整 | 按 tick 的十进制位数对齐整数 tick 后再复验；断言价格匹配 `^\d+(\.\d{1,4})?$` 且 `round(price·10^4) % (tick·10^4) == 0`；LONG 低一格破线、SHORT 高一格破线，两侧取整方向都固定为保守 |
| **P1-4** 授权窗口可以为空 | `now == expiresAt` 时仍 ALLOW，等于签发即失效的授权 | `authorizeAt=min(now+ttl, quoteExpiry, deadline)`；不严格大于 now 则 HOLD + `AUTHORIZATION_WINDOW_EMPTY`，且不回填边界价 |
| **P1-5** `estimateHash` 不覆盖决策要素 | 同一份估值在 `lossLimit=10 vs 5`、`allowSmallLoss` 开关、ownerVersion 抬版、deadline 移动、失效证据更换、planVersion 递增下会得出**不同授权**，但产物只有 `estimateHash` 可核对，消费端无法判断授权来自哪套口径 | 新增 `decisionHash`：覆盖 outcome、reasonCodes、estimateHash、owner（状态/版本/cycle/scope/deadline）、plan（版本/论点/谓词/证据/条件/微利门槛）、policy（限额/开关/ttl）、now、边界价。断言任一变动必换 hash，且 `decisionHash ≠ estimateHash` |
| P2-6 时钟旁路 | 未来时点的报价被视为新鲜事实 | `QUOTE_NOT_YET_AVAILABLE` 结构检查并入完整性失败 |
| P2-7 微利门槛可为 0 | 等于「不亏即出」，与阶段文件「N=0 且门槛为正时另行设计」不符 | `minNetProfitUsd > 0` 必需，否则 `POLICY_CONFIG_INVALID_PROFIT_FLOOR`；包含性不变（0.5≥0.5 允许、0.499 拒绝） |

## 复核确认没有问题的部分

- 金额符号与减项集合（含 buffer 的上一轮修复）在 21 项断言下自洽；`incurredFees` 报正幅度、净额按带符号贡献求和。
- 重复扣费：同 id（含跨 kind 复用同 id）幂等丢弃、净额守恒；入场费与前次退出费各自只计一次。
- funding 符号：有符号量入净额，未知或冲突不入。
- 深亏边界包含性：`-10.00` 允许、`-10.01` 交接，整数比较无 epsilon。
- UNKNOWN/CONSERVATIVE_BOUND 无错误升级路径：`CONSERVATIVE_BOUND` 只把保守端交给授权，边界内不存在任何把 null 或 UNKNOWN 变 EXACT 的分支。
- 非有限数、负费用、缺报价、过期汇率全部 fail-closed。
- 纯度护栏：两个模块的唯一依赖只有彼此（`s03ExitCostEstimator.js`），`src` 下除本测试外无消费者。

## 未修（按指示留给后续阶段）

人工预览与 AI 正式估值的口径合并；盘口与深度真实来源与新鲜度；设置回读链；分档/maker-taker 真实费率与费用币种；`tickSize/stepSize/minNotional` 与交易所 symbol info 的来源绑定；execution variance 记录；S04 提交前的版本复验。

## 门禁复跑（本批）

contracts/core build 通过；engine typecheck **0 错误**；全仓 Engine **134 文件 / 0 失败 / 退出 0**；S03 **21/21 通过**；S00 静态门禁 6 项 PASS（108 条推导记录）；`git diff --check` 干净。S03 仍为 **READY_FOR_REVIEW**，未自签 ACCEPTED。

# V3.9.7 高质量建仓 / 仓位 / TP / 退出独立再审计实施计划

状态：READY_FOR_IMPLEMENTATION

审计日期：2026-10-03

本文件是对 GitHub 3684993/ZDJMITS 当前 main、当前 8096 TESTNET 实例、Settings、AI archive、真实 Entry/TP/Exit 数据、上一轮实施结果与 Astra 问题清单的重新验真。本轮没有修改业务代码、Settings、订单、仓位或交易凭据，也没有发起交易所写入。

## 0. 独立结论

当前不能直接沿用旧实施路线，原因不是某个参数尚未调好，而是存在五个更基础的问题：

1. **源码真相分裂。** GitHub main 的业务代码审计基线为 134f4fa7da1d154d4fe18031875daac8718bf203；审计结束时 8096 运行的是本地 release/v3.9.7 提交 4cf92c1145c7b33aa533b2d45952ec39276218be。两者不是同一构建，main 的行为不能由 8096 自然样本证明，8096 的行为也不能冒充 main 已验收。
2. **Sizing authority 分裂。** 当前 main 的提示词要求模型选择 quantityUnits，但 entryCoordinator 随后忽略模型数量，按 notional 从小到大自动选择第一个可执行经济候选，权威标记为 SYSTEM_ECONOMIC_CANDIDATE_SOLVER。当前 8096 则让 Primary 选择 selectedCandidateId，系统只物化该冻结候选。这两条路线不能同时被称为“当前设计”。
3. **100/200 的语义并不统一。** main 把 100/200 定义成订单 notional 的 schema 下限/默认值，而当前 8096 的 release 代码把 100/200 定义成初始保证金 floor/preferred 默认值；真实持久 Settings 又明确覆盖为 25/25。旧字段 entryMarginUsd 仍为 25。任何自动迁移或 UI 文案若不区分 margin 与 notional，都会再次制造单位错误。
4. **经济性与约一小时收益尚未闭环。** 稳定样本中 30 个完整 Entry 订单有 24 个选择 240 分钟目标、仅 6 个选择 60 分钟目标；当前没有一个 60 分钟成熟样本。5 个本来会因历史 TP 触达概率不足而阻断的订单，因为 tradeEconomics.admissionMode=SHADOW 仍然成交。当前构建还没有完整闭合交易周期，不能证明 TP、净收益或平仓效率。
5. **方向质量与执行时效尚未被可靠分解。** 1D/4H/15m 已结构化进入决策，但稳定样本 30 个完整 Entry 中只有 4 个 ALIGNED_LONG，26 个为 MIXED；10 个 SHORT 全部与 1D 的 SUPPORTS_LONG 相反。短窗结果样本小且相互冲突，没有证据支持简单禁止 MIXED、反转方向或机械放大高置信度仓位。

因此，最高优先级不是继续增加风险门禁，也不是把所有订单机械放大到 100/200，而是先收敛唯一源码、唯一金额语义和唯一 sizing authority，再把方向、时效、费用、约一小时可达性与退出闭环放进同一份不可变交易授权。

## 1. 证据回执与边界

### 1.1 源码与运行身份

| 对象 | 冻结事实 | 用途 |
| --- | --- | --- |
| GitHub main 业务代码基线（报告提交前） | 134f4fa7da1d154d4fe18031875daac8718bf203 | 本计划的代码审计权威 |
| 8096 稳定样本构建 | adbfd3e7a0bfddf0954a25e6c891ff4bb2b40866，build 3.9.7-26f8cede1457e63a7caf | 2026-10-03 11:57:37–13:05:33 CST 的自然样本 |
| 8096 当前构建 | 4cf92c1145c7b33aa533b2d45952ec39276218be，build 3.9.7-0da37a0a0f75b6d5d4ca | 2026-10-03 13:07:54 后的当前实例 |
| 当前实例状态 | READY，PID 38960，PPID 1，Settings version 34，database epoch 未变化 | 仅证明当前本地 TESTNET 运行身份 |

8096 在本轮审计中途被外部重新加载；本轮未触发该重启。4cf92c1 相对 adbfd3e 的主要变化是 MACD fact coverage 和 bounded entry price preference，sizing 候选权威、25/25/50 资金结构和 SHADOW 经济策略没有被这次提交重写。因此：

- 重启前样本可用于审计该 sizing 架构的既有自然行为；
- 不能用重启前样本宣称 4cf92c1 的 MACD 修复已在线证明；
- 重启后 canary 必须单列，不与前一构建混成一个版本样本。

### 1.2 冻结数据快照

本轮对以下三个非凭据 SQLite 做了在线只读 backup，并对六份冻结副本执行 PRAGMA integrity_check，结果均为 ok：

- data/zdj-settings.sqlite
- data/trading-quality.sqlite
- data/v396-ownership.sqlite

没有读取 secrets 表，没有读取或输出 API 密钥、签名、token 或会话凭据。

两个统计边界：

1. **稳定窗口：** 1790999857559–1791003933419，即 11:57:37–13:05:33 CST，运行提交 adbfd3e。
2. **当前 canary：** 1791004074004–1791004541189，即 13:07:54–13:15:41 CST，运行提交 4cf92c1。

13:18:03 CST 另做一次最终 API 点时读回，只用于报告实时库存，不用于计算前述窗口的比率。系统持续自然运行，所以报告中的比率只使用冻结快照。

最终 push 只会以本文档提交推进 main HEAD；不会改变上述业务代码审计基线。

### 1.3 可用性分级

| 数据 | 质量判断 | 影响 |
| --- | --- | --- |
| GitHub main 源码 | 高 | 可确认代码级权威和默认值 |
| 8096 runtime identity | 高 | 可确认本地运行构建，但不能验证 main |
| 完整 Entry 订单与 candidate identity | 高 | 30/30 的 plan→intent→order candidateId 一致 |
| executionFills | 中 | 稳定窗口 437 行对应 31 个订单身份；fill 行不能当交易周期 |
| 1D/4H/15m direction contract | 中高 | 可分组，但策略后验样本不足 |
| 5m/15m/30m markout | 中 | 有成熟子样本；覆盖不均、不是完整净收益 |
| 60m markout/TP hit | 不足 | 当前稳定窗口没有 60m 成熟样本 |
| TradeRecord 闭合收益 | 不足 | 当前两个构建均为 0 个完整闭合自然周期 |
| AI archive | 中 | 有完整时延/token；7 个陈旧 Primary 与 2 个陈旧 Scout RUNNING 行未终态化，另有 1 个当期 Primary 正在运行 |
| leverage provenance | 中低 | 30 个完整 Entry 中仅 16 个 order.leverage 与 intent 一致，14 个 order 行残留 1；不能据此断言交易所杠杆错误 |
| TP coverage provenance | 中低 | 最终 22 个 PROTECTED 中 21 个 tpCoverageSource 仍为 NONE |

## 2. 当前 main、当前 8096 与 Settings 的真实差异

### 2.1 金额字段

| 概念 | GitHub main | 当前 8096 release 源码 | 当前持久 Settings v34 |
| --- | --- | --- | --- |
| 最低初始保证金 | entry.minimumInitialMarginByQuote，默认 USDT/USDC=1 | portfolioIntelligence.businessMinInitialMarginUsd，默认 100 | 25 |
| 偏好初始保证金 | 无同名权威 | preferredInitialMarginUsd，默认 200 | 25 |
| 最低订单 notional | entry.minimumOrderNotionalByQuote，schema 最低 100、默认 200 | 没有同义的主权威；由保证金×杠杆形成候选下限 | 无该字段 |
| 旧 entryMarginUsd | migration 可被解释为 notional | 旧资本规划字段 | 25 |
| 单仓保证金上限 | main funds-only 主要由 quote 可用资金决定 | preAiExecutionEnvelope 仍取 maxMarginPerPositionUsd 与 maxEquityPct 的更小值 | 50 与 0.5% equity |
| 杠杆 | envelope/市场候选决定 | 动态上限 20；实际样本 10 或 19 | global max 20 |

main 的 settingsStore 还会在旧 economicPolicyVersion 缺失时自动启用经济 ENFORCE、Position Review 和 AI Exit ENFORCE。当前 8096 的真实设置则是：

- tradeEconomics.admissionMode=SHADOW；
- historicalTpReachabilityEnabled=true，最低概率 0.5，最少样本 30；
- positionReviewEnabled=false；
- aiExitAuthority=OFF；
- humanHandoffAfterMinutes=1440；
- decisionTimeoutMs=180000；
- Scout=SAMPLED_SHADOW。

这说明 main 的 migration 不能被当成当前用户配置的等价重放。实施时必须先给出字段级迁移 diff 并要求显式确认，禁止把旧 entryMarginUsd 自动解释成 notional 或把 25 自动改成 100/200。

### 2.2 当前 main 的 sizing 权威矛盾

代码证据：

- packages/core/src/compactEntry.ts:36–37 要求 Primary 自主选择 quantityUnits 与 TP；
- apps/engine/src/services/entryCoordinator.ts:761–768 生成候选后按 notional 升序取第一个 executable；
- apps/engine/src/services/entryCoordinator.ts:575–588 将权威记录为 SYSTEM_ECONOMIC_CANDIDATE_SOLVER，并覆盖模型数量；
- apps/engine/src/services/preAiExecutionEnvelope.ts:112–151 把业务 floor、资金与最终数量区间组合为执行 envelope；
- apps/engine/src/services/entryCoordinator.ts:525–530 已把 Scout 改成异步、非阻塞观察者。

因此 current main 的真实行为不是“模型决定仓位”，而是：

Candidate facts → Primary 决定方向/论点并给出数量建议 → 系统生成经济候选 → 系统自动选择最小 executable → plan/intent/order 冻结该系统选择。

这会系统性地把仓位锚在业务 floor，且提示词与真实权威不一致。即使订单不再小到约 5 USDT，也可能持续形成“刚好过线、与机会质量无关”的仓位。

### 2.3 当前 8096 的 sizing 权威

当前 8096 的 V3.9.7-R2 路线更清楚：

Candidate set → Primary 选择同方向 selectedCandidateId → 系统验证 candidateId/hash → 系统物化该候选的 quantity/TP → plan/intent/order 保留同一 identity。

稳定窗口 30 个完整 Entry 的 candidateId 全链一致。Primary 不直接输出 raw quantity；quantityAuthoredBy 为 SYSTEM_CANDIDATE_SET。这个设计优于 main 的“自动取最小候选”，因为模型至少在有限合法前沿中表达规模选择。

但它仍不是完整的科学 sizing：

- 候选保证金集中在 25、约 37.5、50；
- preAiExecutionEnvelope 的 50 与 0.5% equity 上限仍直接收窄候选，而不是只做观察；
- 逆 1D+4H 战略共识时会强制只能选最小候选，这是隐式 sizing 干预；
- confidence 与平均保证金不单调：小于 0.60 为 42.71，0.60–0.69 为 36.39，0.70–0.79 为 39.97，大于等于 0.80 为 47.87，n=66；
- 候选菜单没有证明“该机会为什么值 25、37.5 或 50”，也没有校准 size 与后验收益/MAE 的关系。

目标架构应保留“系统生成合法、经济候选；Primary 选择 candidateId；执行层只验真”的方向，不应把 main 的自动最小 solver 当成最终答案。

## 3. 真实 TESTNET Entry 审计

### 3.1 稳定窗口 adbfd3e

| 指标 | 结果 |
| --- | --- |
| Primary 完成 | 81：43 LONG、38 SHORT |
| Primary 失败 | 27；终态调用失败率 25.0% |
| Scout 完成 | 8，平均 10.904 秒，SAMPLED_SHADOW |
| 完整 FILLED Entry 订单 | 30 |
| execution fill 行 | 437，涉及 31 个订单 identity |
| Entry 方向 | 20 LONG、10 SHORT |
| 方向分组 | 4 ALIGNED_LONG、26 MIXED；全部 SHORT 为 MIXED |
| 计划保证金 | 25.01–49.99，平均 38.38 |
| 计划 notional | 250.15–948.93，平均 458.78 |
| 杠杆 | 10–19 |
| 目标期限 | 6 个 60m、24 个 240m |
| 当前构建闭合周期 | 0 |

当前构建没有重现约 5 USDT 的新小单。约 5/几十 USDT 的历史仓属于旧构建，不应归因给当前 R2。当前问题已经从“exchange minimum 微小单”转成“25–50 初始保证金候选是否与机会质量和一小时经济性匹配”。

经济 admission 共 71 个：

- 62 个通过；
- 9 个 wouldBlock，其中 6 个 TP_REACH_PROBABILITY_UNMET、3 个 ECONOMIC_MIN_NET_PROFIT_UNMET；
- 30 个完整成交中，25 个通过，5 个 wouldBlock；这 5 个全部是 TP 触达概率不足，但因 SHADOW 仍成交。

### 3.2 当前 canary 4cf92c1

13:07:54–13:15:41 的短窗口：

- Primary 完成 13：3 LONG、9 SHORT、1 WAIT；另有 1 RUNNING；
- Scout 完成 1；
- Primary 失败 0，但样本太小，不能宣称 MACD/schema 故障已消失；
- 4 个完整 FILLED Entry，另有 1 个有 fill 的非完整订单；
- 1 LONG MIXED、3 SHORT MIXED；
- 保证金 25.05–49.93，notional 250.48–948.76；
- 4 个 economic admission 均通过；
- 1 个 60m、3 个 240m；
- 仅 1 个有 5m 成熟 markout，15m/60m 均为 0；
- 新开 TradeRecord 1 个，闭合 0 个。

该 canary 只能证明当前构建能自然完成 Entry/TP 物化，不能证明方向质量、1h 可达性、净收益或退出效率。

## 4. 建仓方向：1D / 4H / 15m 的实际作用

当前 R2 已明确：

- 1D 为 strategic regime；
- 4H 为 setup；
- 15m 为 tactical trigger；
- 1m/5m 只做 timing；
- 必须复制 1D/4H/15m 的 MACD sign 与 direction fact；
- 逆 1D+4H 同向共识时必须声明 counter-trend 例外。

稳定窗口完整成交的主要组合：

- 12 个 LONG：1D LONG、4H SHORT、15m LONG；
- 4 个 ALIGNED_LONG：1D/4H/15m 均 LONG；
- 10 个 SHORT：1D 全部 LONG，4H 为 SHORT 或 NEUTRAL，15m 为 SHORT 或 NEUTRAL；
- 其余 LONG 也是 MIXED。

成熟 markout 结果如下。signed endpoint 为按交易方向计的价格收益，不含手续费、资金费与退出滑点：

| 窗口 | 分组 | n | 平均 signed endpoint | 胜率 | 平均 MFE | 平均 MAE | 目标触达 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5m | ALIGNED_LONG | 4 | -0.0475% | 50.0% | 0.0404% | -0.0352% | 0 |
| 5m | MIXED LONG | 15 | 0.0381% | 53.3% | 0.1047% | -0.0375% | 0 |
| 5m | MIXED SHORT | 9 | 0.1053% | 77.8% | 0.1042% | -0.0797% | 0 |
| 15m | ALIGNED_LONG | 2 | -0.1734% | 0.0% | 0.0230% | -0.1818% | 0 |
| 15m | MIXED LONG | 9 | -0.1664% | 44.4% | 0.1271% | -0.1797% | 0 |
| 15m | MIXED SHORT | 3 | -0.1223% | 33.3% | 0.2080% | -0.0816% | 0 |
| 30m | MIXED LONG | 4 | -0.3114% | 25.0% | 0.1532% | -0.4711% | 0 |
| 30m | MIXED SHORT | 3 | -0.0725% | 33.3% | 0.2498% | -0.0816% | 0 |
| 60m | 全部 | 0 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

结论：

- 不能证明三周期全一致优于 MIXED；ALIGNED_LONG 样本太少。
- 不能证明 SHORT 应被禁止；5m 看似较好，但 15m/30m 并未保持，且 n 很小。
- 不能证明模型方向本身是主要损失来源；maker fill 延迟与信号衰减仍可能改变结果。
- 当前最合理的方向策略是保留结构化 1D/4H/15m 证据和冲突说明，把 alignment 当作后验分层变量；在足够样本前，不新增“必须三周期一致”的硬门。
- 1D+4H 同向共识的 counter-trend 规则可以保留为显式策略实验，但“强制最小 candidate”应先降为 SHADOW 标签，避免方向规则暗中成为 sizing authority。

## 5. AI 推理时效与事实新鲜度

### 5.1 稳定窗口时延

| 阶段 | n | P50 | P95 | P99/最大 |
| --- | ---: | ---: | ---: | ---: |
| Primary 完整成交子集 | 30 | 32.228s | 34.472s | 35.183s |
| 模型完成→intent | 30 | 0.134s | 0.161s | 0.168s |
| intent→submit | 24 | 1.507s | 7.112s | 8.254s |
| submit→first fill | 24 | 14.507s | 61.327s | 82.771s |
| AI start→first fill | 30 | 45.414s | 97.061s | 116.104s |

全部 81 个成功 Primary 的 P50/P95/P99 为 32.538s/35.183s/105.301s，平均输入 16,269 tokens，平均输出 594 tokens。27 个失败中：

- 15 个缺 1D MACD fact check；
- 7 个 entry price range schema 不合法；
- 2 个 1D MACD 不一致；
- 1 个 4H EMA slope 不一致；
- 1 个缺 15m MACD；
- 1 个取消。

4cf92c1 正在修复其中 MACD coverage 与 entry range 约束；当前 13 个完成、0 失败只是 canary，不足以判定已解决。

### 5.2 JIT freshness

稳定窗口 78 次 ENTRY_THESIS_FRESHNESS_EVALUATED 中 7 次失败，主要原因：

- execution timing trend changed：4；
- material closed bar changed：3；
- 另有价区离开、结构改变等并发原因。

候选拒绝包括 7 次 JIT_MARKET_THESIS_DRIFT、2 次 order book stale、1 次 quote stale。它们是有证据的“旧授权已不再成立”，不属于应删除的风险门禁。

Astra 的“9B→27B 串行造成约 122–175 秒”在当前 main 与当前 8096 **没有重现**：

- main 的 Scout 是异步非阻塞；
- 8096 为 SAMPLED_SHADOW；
- 稳定窗口只有 8 个 Scout 对 81 个 Primary。

但 Astra 关于“慢决策会损坏短寿命机会”的原则仍成立。当前瓶颈已从 Scout 串行转为：

- Primary 约 16k token 的输入成本；
- P99 长尾；
- maker 等待使 AI start→first fill P95 接近 100 秒；
- 旧机会时钟、模型时钟、submit 时钟和 fill 时钟必须共同进入后验。

## 6. 100 / 200、杠杆、币价、手续费与最低净收益

### 6.1 必须固定的定义

后续合同必须同时存在且禁止互相 fallback：

1. minimumInitialMarginQuote：该 Entry 最少占用的初始保证金，quote 单位。
2. preferredInitialMarginQuote：高质量机会的偏好保证金，不是硬 floor。
3. minimumOrderNotionalQuote：系统业务允许的最小 Qty×Price。
4. exchangeMinimumNotionalQuote 与 minQty：交易所合法性下限。
5. selectedInitialMarginQuote 与 selectedOrderNotionalQuote：本次候选实际值。

独立意见：**100/200 不应同时作为所有币种的保证金和 notional，也不应成为固定下单目标。**

建议语义：

- 100 只作为 minimumOrderNotionalQuote 的 schema 绝对下界；
- 200 作为默认业务 notional floor 或 BTC 的明确 hard floor，是否启用必须由 operator 按 quote 显式确认；
- 如果用户真正希望“初始保证金最低 100、偏好 200”，必须写入另一组同名字段，并同步提高单仓 budget；不得通过旧 entryMarginUsd 推断；
- 实际 selected notional 应取“业务 floor、交易所 floor、最低净收益可行 notional、约一小时可达约束”共同形成的候选，而不是永远等于 100/200。

### 6.2 当前费用关系

当前 Settings：

- 最低净收益 1 USDT；
- ROI floor 为初始保证金的 0.15%；
- Entry fee 4 bps、Taker exit fee 4 bps；
- fee safety buffer 10%；
- slippage buffer 0，funding 仍需按持有窗口证明。

令初始保证金 M、杠杆 L、notional N=M×L。忽略 funding/slippage 时：

- 双边费用加缓冲约为 0.00088×N；
- required net=max(1,0.0015×M)；
- 最低毛价格移动约为 required net/N + 0.00088。

M 小于约 666.67 时，1 USDT floor 始终比 0.15% margin ROI 更严格。示例：

| N | 仅覆盖 1 USDT + 8.8bps 的最低毛移动 |
| ---: | ---: |
| 100 | 1.088% |
| 200 | 0.588% |
| 250 | 0.488% |
| 500 | 0.288% |
| 950 | 0.193% |
| 1000 | 0.188% |
| 2000 | 0.138% |

这解释了为什么 100/200 notional 虽然不再是约 5 USDT 微小单，却未必适合“一小时至少净赚 1 USDT”的低波动机会。反过来，100/200 若被定义为保证金，在 10x 下是 1,000/2,000 notional，经济门槛明显更可达，但风险暴露与清算距离也更高。

杠杆不会创造 alpha。固定 M 时，提高 L：

- 提高 N；
- 同时提高手续费绝对值；
- 降低固定 1 USDT 对应的价格百分比；
- 增加清算和错误方向暴露。

币价本身不决定经济门槛；同 notional 下收益百分比相同。币价只通过 qty、step、tick、rounding 和盘口深度影响最终可执行性。当前没有证据表明高/低币价是新构建仓位过小的根因。

## 7. 约一小时可达性、TP 经济性与平仓效率

### 7.1 当前一小时结论

- 稳定窗口 30 个完整 Entry 中只有 6 个选择 60m，24 个选择 240m；
- 60m 成熟样本为 0；
- 当前 canary 4 个完整 Entry 中 1 个为 60m，但 60m 仍未成熟；
- 已成熟的 5m/15m/30m 分组中，没有一个触达其冻结 TP；
- 5 个 reachability wouldBlock 仍成交，证明 SHADOW 不能提供经济拒绝闭环。

所以当前系统不能宣称已经评估“未来约一小时可达最低净收益”。240 分钟目标也不能被统计成一小时目标。

### 7.2 TP 与退出点时事实

13:18:03 CST 的最终 API 点时读回：

- 23 个交易所同步持仓；
- 22 个 PROTECTED、1 个 MISSING；
- 22 个 WORKING TP；
- 22 个 PROTECTED 中 21 个 tpCoverageSource=NONE，只有 1 个 SYSTEM_CREATED；
- 当前开放 Entry 远端快照 count=0；
- TP 历史累计另有 34 CANCELED、10 EXPIRED、7 FILLED、1 REJECTED。

稳定窗口冻结库中出现 17 次 TP_REPAIR_FAILED，主要是：

- 7 次 mandate 要求 full remaining；
- 10 次 quantity claim/budget 冲突。

TP 保护率高不等于 TP 经济性好，也不等于可审计归属完整。当前 coverageSource 与 PROTECTED 状态矛盾，必须先修 provenance/readback。

### 7.3 平仓率根因

当前两个构建均为 0 个完整闭合自然周期，不能给出诚实的根因百分比。只能给证据等级：

| 假设 | 当前证据等级 | 判断 |
| --- | --- | --- |
| TP 未触达 | STRONG OBSERVATION | 已成熟短窗 0 hit，但没有 60m成熟样本 |
| 方向/时机错误 | SUGGESTIVE | 多数 15m/30m均值偏负，但样本很小 |
| 目标期限过长 | CONFIRMED CONFIGURATION | 24/30 选择 240m |
| sizing 与净收益错配 | CONFIRMED MECHANISM | 固定 1 USDT floor 对 250 notional 要求约 0.488% 毛移动 |
| Position Review 未运行 | CONFIRMED | positionReviewEnabled=false |
| AI Exit 未运行 | CONFIRMED | aiExitAuthority=OFF |
| TP/claim/reconciliation 阻塞 | CONFIRMED OPERATIONAL | 17 次 repair failure、coverage provenance 缺失 |
| 新仓持续堆积 | CONFIRMED | maxPositions=3 仅观察，点时已有 23 个持仓 |

唯一观察到的 POSITION_CLOSED_USER_DATA 事件没有形成当前构建的完整闭合 TradeRecord，不能把它计作自然完整周期。

## 8. 哪些门禁仍在干预智能建仓

### 8.1 必须保留的执行正确性

- TESTNET/Production 环境隔离与写路径锁；
- 真实 quote 可用余额与已经承诺的 reservation；
- private account、quote、order book、closed-bar freshness；
- minQty/minNotional、tick/step、价格范围与杠杆档位；
- candidate/hash/plan/intent/order identity；
- 幂等 clientOrderId、持久化、unknown order fail-closed；
- JIT thesis drift 与授权 TTL；
- 最终实际 Qty×Price、margin、fee/economic mandate 的再验真。

这些不是“多余风控”，而是保证当前订单真实、合法、未过期。

### 8.2 应保持 OBSERVE 的组合策略

稳定窗口 71 次 PORTFOLIO_RISK_ADMISSION_EVALUATED 全部 allowed=false 但 entryVetoEnforced=false；295 次 FINAL_ORDER_RISK_EVALUATED 全部 PASS。最终 permit 显示 position count 已超过设置 3 仍可 Entry。当前没有重现 Gross/Direction/Cluster/Stress/position count 对 TESTNET submit 的 veto。

因此以下内容应继续只做 posterior/审计，不进入 Primary 的核心方向或数量权威：

- Gross、Direction、Cluster、Stress；
- 历史 drawdown 与历史 UNKNOWN；
- Human position count/cap；
- maxPositions 与同底层仓位数量；
- 旧 portfolio direction bias。

### 8.3 仍在隐藏干预 sizing 的项目

1. 当前 8096 的 maxMarginPerPositionUsd=50 与 maxEquityPct=0.5% 直接截断 pre-AI candidate 上限；它们不是纯观察。
2. counter-trend 规则会强制最小 candidate；它把方向风险规则变成 sizing 规则。
3. 当前 main 自动选择最小 executable candidate；这是最强的 floor anchoring。
4. legacy entryMarginUsd、businessMinInitialMarginUsd、minimumOrderNotionalByQuote 在两条代码线含义不同，migration 可间接改变可选数量。
5. reservation/lease 本身应只预占所选候选资金；若用 route budget 预先收窄候选，就会成为第二 sizing authority。

解决方案不是完全取消资本上限，而是把它改名为显式、模型可见、唯一的 entryCapitalBudgetQuote，由可用资金和 operator 预算共同决定；任何变化都生成新 candidateSetHash，不允许后置静默 min/clamp。

## 9. Astra 11 项逐项验真

| 问题 | 当前实例证据 | 结论 | 层级 | 对计划的影响 |
| --- | --- | --- | --- | --- |
| 1. Sizing authority 是否唯一 | main 为系统最小 solver；8096 为模型 candidateId | CONFIRMED：不唯一且代码线不同 | 代码级 | P0/P1 先收敛唯一 authority |
| 2. 业务最低金额是否进入执行契约 | main 是 notional 100/200；8096 是 margin 25/25 | CONFIRMED：语义分裂 | 代码+实例 | 禁止自动迁移，拆分字段 |
| 3. 仓位/TP/费用是否同一事实 | candidate 内有成本，但 SHADOW 允许 5 个 reachability fail 成交 | CONFIRMED：闭环未 enforce | 实例级 | 构建统一 economic mandate |
| 4. 方向事实与权威是否一致 | 1D/4H/15m 已结构化，26/30 为 MIXED | CONFIRMED：事实可审计，质量 UNKNOWN | 代码+实例 | 先 posterior，不加硬一致门 |
| 5. 推理时效损坏方向 | AI→fill P95 97.061s，7 次 JIT drift | CONFIRMED | 实例级 | 缩 prompt、保留 JIT |
| 6. 后验链是否完整 | candidate identity 完整，但 60m=0、fill 碎片化 | CONFIRMED：短窗有、长窗不足 | 数据级 | P2 建全量时钟/标签 |
| 7. TP保护与经济性混淆 | 22 protected 但 21 coverageSource NONE，0 完整闭合周期 | CONFIRMED | 实例级 | 分开 protection/economics |
| 8. 退出职责是否缺口 | Review OFF、AI Exit OFF、TP repair failure 17 | CONFIRMED | 配置+运行 | 先 SHADOW exit posterior |
| 9. 风险门是否重复成为 authority | Gross等 veto 未重现；50/.5% cap 与 countertrend min 仍干预 | CONFIRMED（局部） | 代码+配置 | 删除隐藏 clamp，保留 correctness |
| 10. Scout串行价值 | main 异步、8096 sampled；稳定窗口 8 Scout/81 Primary | NOT_REPRODUCED；质量价值 UNKNOWN | 代码+实例 | 保持 sampled async |
| 11. source/build/settings 漂移 | main 134f4fa、runtime 4cf92c1，审计中途重启 | CONFIRMED | 发布级 | P0 必须先 identity closure |

## 10. 上一轮实施结果逐项复核

| 旧结果/路线 | 当前验真 | 处理 |
| --- | --- | --- |
| 旧 replan 称 Primary quantityUnits 为唯一 sizing authority | 当前 main 已变成系统最小 solver；8096 变成 candidateId | 废弃该描述 |
| 旧 replan 称 Scout 串行 | main 已异步；8096 为 SAMPLED_SHADOW | 不再把 Scout 串行列为首要根因 |
| core economics 报告实现 quote floors/mandate | main 源码存在；当前 8096 未运行同一实现 | 代码存在，在线验证 UNKNOWN |
| current-instance 报告曾有 null floor、无自然 Entry | 已被当前 25/25 与自然 Entry 样本取代 | 仅保留历史边界 |
| order lifecycle 报告称 notional floor 200、经济 ENFORCE | 与当前 8096 的 margin 25、SHADOW 不一致 | 不能作当前实例验收 |
| profitability-loop 报告称 system solver、Review/AI Exit ENFORCE | 符合当前 main 的部分代码，不符合当前 8096 Settings | 必须先 source/settings convergence |
| R2 candidateId 实施结果 | 当前 8096 30/30 candidate identity 一致 | 作为目标 authority 的可复用基础 |
| MACD/range 最新修复 | 当前 canary 13 完成、0 失败 | 样本不足，保持 UNKNOWN |

旧报告并非“错误”，而是分别描述了不同提交、不同机器或不同 Settings。问题在于没有一个最新的 source/runtime/settings 三者闭合版本可作为唯一验收基线。

## 11. 重新排序后的完整实施计划

### P0 — 收敛唯一源码与运行身份

目标：在改策略前先保证“正在审计的代码就是正在运行的代码”。

实施：

1. 以 GitHub main 为唯一交付主线，对 4cf92c1 与 134f4fa 做逐文件 convergence matrix；逐项选择 main、release 或重新实现，禁止整文件覆盖。
2. 优先合入 R2 candidate reference、structured 1D/4H/15m facts、MACD coverage、decision clock、lot/posterior 修复；明确拒绝 main 的自动最小 candidate 作为最终 sizing authority。
3. 生成 Settings migration dry-run：旧值、目标字段、单位、是否改变行为、需要的 operator acknowledgement。
4. 合并后要求 local main、origin/main、runtime gitCommit、sourceHash、artifactHash、instance file、Settings version 全部一致。
5. 未达到 identity closure 前，运行样本只能标为 external release evidence，不能用于 main 验收。

验收：

- 6/6 identity closure；
- git worktree clean；
- runtime Settings version 等于 durable latest；
- migration 不自动把 25、100、200 改义；
- rollback commit 与数据库备份可重放。

### P1 — 建立唯一 EntrySizingMandate 与候选权威

目标：只保留一个 sizing authority，且每一层不再重算。

设计：

1. 确定性引擎基于可用资金、交易所 filters、杠杆、成本与时间可达性生成 3–5 个离散可行候选。
2. Primary 只输出同方向 selectedCandidateId 与 sizeRationale，不输出 raw qty。
3. 引擎验证 candidateId/hash 后冻结：
   - quantityUnits；
   - initial margin；
   - notional；
   - leverage；
   - entry price range；
   - target price/range/horizon；
   - fees/funding/FX status；
   - target conditional net 与 probability-weighted expected net。
4. plan、reservation、intent、JIT、adapter、remote readback 必须消费同一 mandate。若价格/资金变化使其不可行，只能 reject/replan，不能静默缩量、放大、改 TP 或换候选。
5. 删除 current main 的“按 notional 取最小 executable”默认；没有明确选择则 NO_TRADE。

验收：

- candidateId/hash/qty/notional/margin/leverage/target 全链逐字段相等；
- 任何 divergence 都有唯一 first cause；
- confidence 只作为模型证据，不直接线性映射仓位；
- 高质量不足时 NO_TRADE，不回退到 floor。

### P2 — 统一金额语义与 migration

目标：100/200 不再靠上下文猜测。

实施：

1. 在 contract、Settings、API、Dashboard、prompt、TradePlan、adapter 统一五个 quote 字段。
2. 删除从 entryMarginUsd、minMarginUsd 自动推断新字段的迁移。
3. 对 USDT/USDC 分别设置；需要统一 USD 时必须有 timestamped FX，缺失为 UNKNOWN。
4. final JIT 在真实价格和 rounding 后重验 notional 与 margin 两个 floor。
5. operator 显式选择：
   - 方案 A：100/200 是 notional floor/default；
   - 方案 B：100/200 是 initial margin floor/preferred；
   - 两者均设置时分别生效，不能复用同一字段。

推荐默认采用方案 A，并让经济候选在需要时自动高于 200；只有明确要求每单投入 100/200 保证金时才启用方案 B。

### P3 — 把方向质量与时效分开

目标：区分“判断错”与“判断正确但成交晚”。

实施：

1. 固化 closed 1D/4H/15m 的 barCloseTime、receivedAt、source、hash、EMA/MACD/structure。
2. Primary 输出 strategicRegime、setupDirection、tacticalTrigger、conflictResolution、invalidation。
3. opportunity 起点、Primary start/end、intent、submit、first/complete fill 全部保留。
4. JIT 继续验证 entry range、closed bar、structure 与 timing；失效则 replan。
5. alignment/countertrend 先做 SHADOW cohort，不硬编码三周期一致，也不通过“最小候选”惩罚。

验收：

- 每个 Entry 都能重放其 1D/4H/15m facts；
- 方向 posterior 按 alignment、side、regime、延迟桶分组；
- 至少每个主要分组 30 个独立完整 Entry 且 60m 覆盖不低于 95% 后，才允许把方向规则升级为 ENFORCE；
- 报告同时给置信区间，不以单点胜率决策。

### P4 — 降低推理长尾，Scout 保持异步研究

目标：减少 15m 信号在 submit/fill 前衰减。

实施：

1. 把可确定计算的技术事实、费用、候选经济指标在模型前完成。
2. 缩减 Primary 的重复历史/风险文本，目标输入 token 明显低于当前约 16k。
3. Scout 保持 SAMPLED_SHADOW/async，只研究 Primary 没有的新事实；不把其结果设为同步前置条件。
4. 建有/无 Scout 的时间分块对照，衡量延迟、失败率、方向后验和 target hit。
5. 为 Primary 和 maker fill 分别设延迟预算，不通过简单延长 TTL 掩盖过期。

验收：

- Primary P95 目标不高于 30s，P99 长尾有可归因原因；
- AI start→submit P95 与 AI start→first fill P95 分开报告；
- JIT drift rate下降但 gate 不放宽；
- Scout 只有在质量增益有统计证据时才扩大采样。

### P5 — 建立一小时经济可达性合同

目标：从“算术上能净赚 1 USDT”升级为“在约一小时内有证据可达”。

实施：

1. 明确区分：
   - targetConditionalNetProfit：目标成交时的条件净收益；
   - expectedNetPnlAtHorizon：概率加权期望净收益；
   - minimumRequiredNetProfit：业务 floor。
2. 候选生成必须同时满足：
   - 费用/滑点/funding/FX 状态；
   - 60m 的可达价格域；
   - 历史 reach probability 和样本覆盖；
   - 尾部 MAE/不利先发生概率；
   - 资金与交易所合法性。
3. 240m 计划明确标成中期持有，不计入一小时成功率。
4. 无足够 60m 样本、费用 UNKNOWN 或 expected net 不正时保持 SHADOW/NO_TRADE，不用更远 TP 补算术利润。
5. admissionMode 从 SHADOW 升级前，先做 shadow wouldBlock 的反事实后验。

验收：

- 60m 成熟覆盖至少 95%；
- 每个候选可解释最低毛移动与所有成本；
- wouldBlock 与实际成交严格一致于所选 mode；
- 不存在 reachability fail 在 ENFORCE 下继续提交；
- 不承诺一小时盈利，只证明一小时约束被一致计算。

### P6 — TP、Review、Time Stop 与 Exit 闭环

目标：把远端保护、经济目标与主动退出分开。

实施：

1. 每个 physical position cycle 保存 Entry mandate、lot、TP provenance、远端 order identity。
2. Dashboard 分开显示：
   - remote protected；
   - economic target valid；
   - 60m reachability；
   - target expired；
   - review/exit owner。
3. 修复 PROTECTED 但 coverageSource=NONE 的投影，以及 full remaining/quantity claim repair 冲突。
4. Position Review 与 Time Stop 先以 SHADOW 输出 HOLD/REDUCE/EXIT/HANDOFF，并保存反事实。
5. AI Exit 只有在身份、数量 claim、费用后收益和失败预算都闭合后才能 ENFORCE。
6. 人工接管不自动释放 TP 或改写 cycle。

验收：

- 所有当前仓位 TP provenance 可追溯；
- 0 个 PROTECTED/NONE；
- 退出 claim 数量守恒；
- 至少 20 个新构建自然闭合周期后评估净收益与持有时长；
- 未达到样本时明确 UNKNOWN，不用历史 repair 时间冒充 closedAt。

### P7 — 拆分执行正确性与组合风险

目标：风险事实不再通过别名回流到方向或 sizing。

实施：

1. API 与代码类型拆成 ExecutionCorrectness、EconomicSelection、PortfolioObservation 三类结果。
2. TESTNET funds-only 下 Gross/Direction/Cluster/Stress/position count/historical risk 永久 OBSERVE。
3. 将 maxMarginPerPosition、maxEquityPct、countertrend-min、route margin budget 改成显式 EntryCapitalBudget；若 operator 未授权，不得隐藏收窄 candidate。
4. reservation 只预占已选 candidate；analysis lease 不能预先拿走别的候选容量。
5. Primary 核心 prompt 不含当前亏损/历史 drawdown/人类仓位作为拒绝或缩量权威；可在经验附件中引用，但必须标记 non-authoritative。

验收：

- 属性测试随机改变 Gross/Cluster/Human/历史事实时，候选数量和 submit permit 不变；
- 改变真实余额、filters、freshness、identity 时必须按 first cause 拒绝；
- 所有 gate 均声明 canVeto 与 mutatesQuantity；
- mutatesQuantity 必须为 false，变化只能产生新 mandate。

### P8 — 修复证据链和 rollout

目标：让“高质量建仓”可被证伪。

实施：

1. 终态化 stale AI RUNNING 行；防止失败 run 被复活。
2. 把 fill row 聚合为 order lot/physical cycle，禁止用 fill 行当交易数。
3. 修复 order leverage provenance；区分 exchange leverage、intent leverage 和 stale local projection。
4. 保存所有 PLACE/WAIT/REJECT/过期/未成交机会的 5m/15m/30m/60m 反事实。
5. 每次发布固定 source/settings/build/cutoff manifest。
6. 先离线 replay，再 TESTNET SHADOW，再小范围 ENFORCE；任何阶段不制造订单作为验收样本。

验收：

- npm verify、typecheck、build、targeted hostile tests 全过；
- SQLite migration 可重复、回滚不删除真实 fills；
- 当前 main 与 8096 identity closure；
- Production writes=0；
- 自然样本达到 DoD 后再决定是否扩大资金或启用主动退出。

## 12. 删除、降级、保留清单

### 删除或禁止

- main 自动选择最小 executable candidate；
- legacy 金额字段自动改义；
- post-AI 静默 clamp/round 到另一候选；
- exchange minimum 作为业务 sizing 目标；
- 为满足 1 USDT 而把 TP 推出一小时可达域；
- 用 fill 行、repair updatedAt 或本地孤儿记录冒充自然闭合交易。

### 降级为 SHADOW / OBSERVE

- 三周期必须一致；
- countertrend 强制最小仓位；
- confidence 直接放大仓位；
- Gross/Direction/Cluster/Stress/maxPositions/Human/history 对 TESTNET Entry 的策略 veto；
- Scout 的同步依赖；
- AI Review/Exit 的自动执行，直到后验闭合。

### 必须保留

- 环境隔离、真实余额、private freshness；
- exchange filters、tick/step、杠杆档位；
- candidate/plan/order identity 与幂等；
- JIT thesis freshness；
- 费用、FX、funding UNKNOWN 的 fail-closed；
- TP 远端保护与数量 claim 守恒；
- 原始 AI request/response 的脱敏 archive。

## 13. Definition of Done

1. GitHub main、部署源码、artifact、运行 identity 与 Settings version 完全一致。
2. Primary 只选择 candidateId；系统不自动选最小，也不在后续修改 qty/TP。
3. margin、notional、exchange minimum、100/200 的单位在 contract/UI/API/adapter 完全一致。
4. 所有 candidate 同时给出费用后净收益、60m reachability、MFE/MAE 与时效。
5. 1D/4H/15m facts 和机会时钟可重放，方向质量与延迟分开统计。
6. TESTNET 非资金组合风险既不 veto 也不隐藏缩量。
7. TP protection、TP economics、Review/Exit owner 三者分栏且 provenance 完整。
8. AI archive 无永久 RUNNING；order leverage 与 TP coverage 不再矛盾。
9. 至少 20 个新构建自然完整闭合周期，并有完整费用/资金费/退出事实；不足时不宣称盈利或平仓改善。
10. 60m 主要 cohort 至少 30 个独立成熟 Entry、覆盖不低于 95%，报告 90% 置信区间和尾部风险。
11. 所有验证来自自然 TESTNET，不强行下单、不制造成交、不触碰 Production。

## 14. 最终十问

1. **微小单根因是什么？** 当前新构建没有重现约 5 USDT 小单；历史微小单不能继续归因。当前的主要问题是 25–50 margin 候选上限与 main 自动最小 solver 造成 floor anchoring。
2. **100/200 是什么？** main 是 notional floor/default；8096 release 默认把它当 margin floor/preferred，但真实 Settings 是 25/25。必须拆字段并显式选择。
3. **谁是 sizing authority？** main 是 SYSTEM_ECONOMIC_CANDIDATE_SOLVER；8096 是 Primary selectedCandidateId。目标应采用后者并消灭第二权威。
4. **最低净收益闭环了吗？** 没有。1 USDT 计算存在，但 SHADOW 允许 reachability 不足成交，且无当前完整闭合周期。
5. **1D/4H/15m 真正决定方向了吗？** 它们已是结构化事实，但多数真实成交是 MIXED；目前是模型解释权威，不是三周期硬规则。
6. **亏损更像方向错还是执行晚？** 尚不能分配比例。短窗 markout偏弱与 AI→fill P95 约 97 秒同时存在。
7. **为什么 TP 低效、持仓久？** 240m 目标占 24/30、Review/AI Exit 关闭、固定 1 USDT 对小 notional 要求较大移动，以及 TP provenance/claim 故障共同作用。
8. **系统是否真的判断了一小时可达收益？** 有 reachability 计算，但当前没有 60m成熟样本，且 5 个 wouldBlock 仍成交；答案是尚未闭环。
9. **哪些风险仍不必要干预？** Gross等已无 TESTNET veto；真正仍干预的是 50/.5% candidate cap、countertrend-min、main 自动最小 solver 与 legacy 金额迁移。
10. **下一步先做什么？** 先完成 source/runtime convergence，再实现唯一 candidateId sizing mandate；随后补齐 60m经济 posterior，最后才考虑经济 ENFORCE、Review/AI Exit 或扩大仓位。

## 15. 回退与证据保全

每个阶段独立 commit，可普通 revert，禁止 force push。migration 必须幂等并保留旧字段、raw archive、订单、fills、positions、TP 与 UNKNOWN。部署前在 Engine 停止后备份 SQLite 主文件及 WAL/SHM 和 runtime identity；回退不得覆盖部署期间自然成交。任何 Production credential、transport 或写路径访问均为硬失败。

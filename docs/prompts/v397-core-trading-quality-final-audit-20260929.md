# V3.9.7 核心交易质量最终审计提示词（只提出问题，不预设修法）

> 本轮性质：**最终核心交易质量审计**。目标是确认当前系统最核心的交易问题是否真实存在、发生在哪一层、根因是什么，并由审计模型自行形成后续解决方案与实施计划。
>
> 本提示词**只定义问题和必须回答的问题**，不提供解决方法，不指定代码改法，不要求沿用任何假设。审计模型必须用当前代码、当前配置、当前数据库、当前运行 readback、真实 TESTNET 订单/成交事实自行验真。

## 0. 必须先阅读

完整阅读：

1. `docs/reports/v396-trading-loop-full-implementation-20260929/IMPLEMENTATION_RESULT.md`
2. `docs/reports/v396-trading-loop-root-cause-audit-20260929/ROOT_CAUSE_REPORT.md`
3. `docs/reports/v396-trading-loop-root-cause-audit-20260929/IMPLEMENTATION_PLAN.md`
4. `docs/prompts/v396-trading-loop-full-implementation-20260929.md`
5. 当前 `main` 全部相关源码、Settings/schema、runtime/readback、订单/成交/position/AI archive。

上一轮 P1–P7 的实施结果只能作为背景，**不得把“测试通过”当成交易质量已经正确**。

---

# 1. 本轮核心目标

只围绕以下四个最终交易问题做深入审计：

1. **建仓数量 / 建仓总价值是否严重不科学**；
2. **止盈收益是否过低，且与建仓规模、机会成本不匹配**；
3. **平仓率是否过低、持仓时间是否过长**；
4. **AI 入场方向判断质量是否低，或 AI 的方向/仓位决策是否在后续链路被扭曲**。

本轮不要把重点重新转移到 Gross / Direction / Cluster / slot / Human cap 等组合风险门禁。

需要核实的是：**智能决策出来以后，为什么最终形成了当前这种仓位规模、收益结构、退出效率和方向结果。**

---

# 2. 第一优先级：大量新建仓约等于 5 USDT，是否为系统性错误

当前驾驶舱出现大量极小建仓委托。以下是部分直接样本：

| Symbol | Qty | Maker Price | Qty×Price 约值 |
|---|---:|---:|---:|
| SUIUSDC | 4.4 | 1.1403 | 5.02 |
| FILUSDT | 4.8 | 1.0469 | 5.03 |
| ZROUSDT | 3.3 | 1.5456 | 5.10 |
| WIFUSDT | 21.7 | 0.2315 | 5.02 |
| INJUSDT | 0.7 | 7.37 | 5.16 |
| VIRTUALUSDT | 6.3 | 0.8032 | 5.06 |
| CRVUSDT | 14.2 | 0.3526 | 5.01 |
| ARBUSDT | 24.2 | 0.2075 | 5.01 |
| OPUSDT | 36.8 | 0.1361 | 5.01 |

同时还存在约 20、40、50、80、160 USDT 等较小委托，但大量新订单明显聚集在约 **5 USDT notional**。

用户声称系统当前存在“最低交易金额 200 USDT”的交易设置，同时当前可执行 USDT / USDC 资金均约 4,000+ USDT。

审计必须先验证这些事实本身，再回答：

- 当前配置中是否真的存在“最低交易金额 200 USDT”？具体字段、作用域、环境、单位是什么？
- 这个 200 表示：订单 notional、保证金、授权预算、候选预算、目标仓位价值，还是别的概念？
- 真实新 Entry 从 AI 输出到交易所委托，在哪一层首次变成约 5 USDT？
- 是否存在稳定的 `$5`、`5 USDT`、canary、fallback、default、test size、probe size、minimum executable size、fixed margin、candidate budget 或类似隐式常量？
- 是否存在“AI 决定较大仓位，但后续 TradePlan / reservation / leverage / quantity conversion / rounding / JIT / exchange adapter 将它缩成约 5 USDT”的情况？
- 是否存在把“保证金”误当“notional”，或把“notional”误当“保证金”的单位混淆？
- 是否存在 leverage 换算重复、漏乘或除错，导致最终仓位价值缩小一个数量级？
- `leaseBudget`、candidateBudget、plannedNotional、authorized qty、reservation amount、final quantity、exchange notional 之间是否一致？
- AI 是否实际上没有被允许决定仓位规模，只决定 PLACE/方向，最终数量由一个固定机械值生成？
- 如果 AI 有数量/资金建议，该建议是否真正传递到 TradePlan 和最终 order？
- 如果 AI 没有数量建议，当前系统的 sizing 权威到底是谁？是否与系统设置冲突？
- 是否存在多个 sizing authority 相互覆盖，导致最终值取最小值？
- 是否存在旧的测试/灰度/canary 逻辑残留在真实 TESTNET 自动建仓路径？
- 是否存在为了满足交易所 minQty/minNotional 而“刚刚够合法”地下单，而不是满足系统自身的最小交易金额？
- `CANDIDATE_QUANTITY_BELOW_LEGAL_MINIMUM` 等拒绝是否说明系统先生成极小仓位，再被交易所最小限制否决？
- 这些约 5 USDT 订单是偶发样本，还是当前版本新订单的主要分布？按最近 1h/6h/24h 分布验证。
- 不同 symbol、quote asset、方向、杠杆、价格区间下是否都稳定落在相似美元价值，证明存在统一上游 sizing 干预？
- 旧订单与当前 build 的新订单是否混在一起？必须按 build/时间/intent 分层，不能把历史行为误算为当前行为。

最终必须回答：**为什么大量订单最终只有约 5 USDT，而不是仅仅指出它们很小。**

---

# 3. 最低交易金额是否真正成为最终执行契约

用户要求核实：系统设置的最低交易金额是否被真正执行。

必须回答：

- “最低 200 USDT”是否存在唯一权威来源，还是多个页面/配置含义不同？
- 从 Candidate → Primary → TradePlan → Reservation → Intent → JIT → ExchangeAdapter，每一层看到的最低金额是否一致？
- 是否只有 UI/配置展示为 200，而执行路径根本没有消费该字段？
- 是否在某一步被另一个更小的 fallback/default 覆盖？
- 是否在 quantity rounding 后跌破 200，却没有重新验证最终 notional？
- 是否在 maker price 更新/reprice 后跌破最低值，却仍允许 submit？
- 是否有“计划 notional ≥200，但实际 exchange order notional <200”的真实样本？
- 是否有“可用资金充足，但 sizing 仍被固定压缩”的真实样本？
- 最低金额检查发生在模型前、模型后还是 submit 前？是否存在检查对象和最终对象不是同一个数量的情况？
- 当前 Dashboard 对 Qty、Price、Notional、Margin、Leverage 的展示是否会误导对真实仓位价值的判断？

不要假设 200 一定正确；先确认它是不是当前真实业务设置及其定义，然后确认执行是否与其一致。

---

# 4. 可用资金 4,000+，为什么资本实际部署极低

当前 readback 曾显示 USDT / USDC 均有约 4,000+ 可执行资金，但大量订单只有约 5 USDT notional。

必须核实：

- 当前系统真实资本部署率是多少？最近 1h/6h/24h 的新 Entry notional 与可用资金比是多少？
- 是否存在“资金可用”与“允许单笔部署规模”完全脱节？
- AI 是否能看到真实可用资金、当前仓位、候选机会和剩余资本？
- AI 得到的资金上下文是否过期、被裁剪、单位错误或缺失？
- Primary 输出是否表现出希望使用更大资金，但执行层缩小？
- 或 Primary 本身就持续输出极小仓位？如果是，为什么？
- 是否存在每候选平均分配、固定 candidate budget、固定单位、静态测试规模或默认值，把可用资金切碎到失去经济意义？
- position count 已经很高时，系统是否仍用极小订单占用新的 position/cycle，造成“仓位数量多、资本使用率低”？
- 是否出现一个 5 USDT 仓位占用与 200/500 USDT 仓位近似相同的 AI 分析、TP、对账、Review、订单生命周期资源？
- 当前系统是否在经济上存在“分析成本/持仓槽位/生命周期成本远高于该仓位潜在收益”的结构性问题？
- 当前实际 sizing 是否让高质量信号和低质量信号几乎获得相同的小仓位，从而使 AI 的置信度/机会质量无法反映到资本配置？

本节必须把“可用资金很多”与“应该全部用掉”区分开。问题不是强迫满仓，而是确认**资本配置是否有明确、可解释、与 AI 质量相关的 sizing 机制**。

---

# 5. AI 的仓位数量决策是否真正存在、是否被执行链篡改

必须完整追踪至少 20 个当前 build 的自然 Entry 样本：

`Candidate facts → Scout/Primary input → Primary raw output → normalized decision → TradePlan → reservation → intent → JIT → adapter request → exchange order`

对每个样本回答：

- AI 输入里有哪些与仓位规模有关的事实？
- AI 输出里是否明确表达 qty/notional/margin/size/conviction？
- normalized schema 是否丢弃了 AI 的 sizing 字段？
- TradePlan 是否重新计算并覆盖模型数量？
- Reservation 是否再次缩放？
- JIT 是否再次缩放？
- Adapter 是否做最后一次换算？
- 最终交易所 Qty 与 AI 原始意图之间是否可追溯？
- 若发生变化，第一次变化发生在哪一层，变化比例是多少，原因字段是什么？
- 是否存在“AI 只决定方向，机械 sizing 却被误认为 AI 决策”的架构错觉？
- 是否存在旧 schema / compatibility fallback 导致新模型输出的 sizing 信息被丢弃？

要求明确区分：**模型决策质量问题** 与 **执行链修改模型决策的问题**。

---

# 6. 止盈收益为什么低

上一轮已经修改 TP target contract，但当前仍需重新从真实新仓验证经济结果。

必须回答：

- 当前 build 新建仓的 TP 目标实际分布是多少？按绝对 USD、百分比、距离、预期净利润分层。
- 大量约 5 USDT 仓位的目标净收益是多少？扣手续费/资金费后是否具有经济意义？
- 是否出现“仓位过小，因此即使 TP 成交也只能赚极少金额”的系统性现象？
- `TP_LOW_NET_TARGET_KEPT` 在真实新仓中占比多少？
- `economicWarning` 是否只是记录，还是说明系统明知收益过低仍持续占用一个仓位？
- AI 原始目标与最终 TP 之间是否仍有明显偏移？
- 哪一类目标来源（HUMAN / AI / STRUCTURE / FIXED）在当前新仓中占主导？
- 当前 TP 是否与仓位规模、波动率、持有周期、手续费、maker/taker 成本和资金费相匹配？
- 是否存在低 notional + 极近 TP，导致毛利润/净利润过小？
- 是否存在低 notional + 极远 TP，导致收益仍小但持有时间极长？
- 是否存在“为了不改 AI 授权目标而接受经济上无意义的仓位/TP 组合”？
- 最近真实 TP 成交的净收益分布如何？中位数、P10/P90、持有时间与占用资本分别是什么？

必须找出“低收益”到底主要来自：**仓位过小、目标过近、目标过远、成本过高、方向错误、持有时间过长，还是多个因素叠加。**

---

# 7. 平仓率低 / 持仓时间长是否仍是核心问题

上一轮修复了 Exit 执行闭环，但当前报告仍显示：

- AI Exit authority = SHADOW；
- `positionReviewEnabled=false`；
- 自然窗口内没有新的 CLOSED record；
- Exit facts 仍有大量 incomplete blockers。

必须重新核实现状，而不是沿用旧采样。

回答：

- 当前 1h/6h/24h Entry fills、Exit fills、Closed cycles 的真实比率是多少？
- 当前持仓年龄分布是多少？中位数/P90/最大值？
- 新 build 建立的仓位是否也开始进入长持有，而不是只有历史旧仓？
- 平仓少的主因现在是 TP 未触达、AI Exit 不执行、Review 关闭、方向错误、目标设置、订单执行，还是别的原因？
- TP 已全部保护是否只是“有挂单”，而非“挂单经济上合理且可达到”？
- ACTIVE TP 的距离分布与真实市场可达性如何？
- 长持仓是否集中在特定方向、特定波动率、特定 sizing bucket 或特定 TP 来源？
- 小额仓位是否因为预期利润极低，却同样长期占用生命周期资源？
- SHADOW / Review disabled 是当前预期设计，还是已经成为真实平仓率过低的主要原因？
- 当前系统实际上依赖什么机制完成自然平仓？这一机制在最近 24h 是否有效？
- “有 TP 保护”与“能够高质量退出”是否被 Dashboard 混为一谈？

要求给出平仓低频的**根因排序和证据强度**，不要再次简单归因于模型或市场。

---

# 8. AI 入场方向质量是否真的低

本轮必须第一次把“方向质量”与“执行质量”分开验真。

必须回答：

- 最近足够样本内，LONG 与 SHORT 的入场后方向表现分别如何？
- 在 15m / 1h / 4h / 12h / 24h 等可用窗口，入场后价格是否朝预测方向运行？
- 每个 Entry 的 MFE / MAE、方向命中、最终 realized/unrealized、持有时间如何？
- Primary 的置信度/理由/预期 horizon 是否与实际后续走势有关联？
- 高置信度信号是否比低置信度信号表现更好？如果没有，模型输出的 conviction 是否没有实际信息价值？
- LONG/SHORT 是否存在系统性偏置？
- 某些市场 regime 下方向明显更差吗？
- Scout 与 Primary 是否经常意见冲突？最终采用谁？冲突样本表现如何？
- 模型拿到的 market facts 是否在决策时已经 stale？
- AI decision 到真实 submit/fill 的延迟是否足以使方向信号失效？
- maker price 等待是否让正确方向的信号在成交时已经变质？
- `AI_AUTHORIZATION_EXPIRED` 是否意味着模型方向有效期与执行等待不匹配？
- 是否有“模型方向正确，但最终没有成交”；反之“成交的恰好是质量较差/较慢的信号”的 selection bias？
- 当前只看已成交仓位是否会错误评价 AI 方向质量？
- AI 的方向输出是否在 normalization、fallback 或 execution policy 中被改变？
- 是否存在同一 symbol 短时间 LONG/SHORT 反复切换，说明方向判断不稳定？

最终要回答：**方向质量差究竟是模型判断本身、输入事实、决策延迟、成交选择偏差，还是执行链改变了模型意图。**

---

# 9. “一个很小的仓位浪费一个仓位”是否真实成立

用户提出：小仓位不仅收益低，还可能浪费分析资源和仓位机会。

不要直接接受这个结论，必须验证：

- 当前 position/cycle 的固定运行成本有哪些？
- 5 USDT 仓位和 200+ USDT 仓位在 TP、reconciliation、funding、Review、UI、private API 请求、AI资源上是否消耗近似相同？
- 小仓是否增加 position count、active TP、cycle/accounting、claim、private-query 等固定负载？
- 当前系统是否存在 max position / scheduler / candidate lifecycle 等资源，即使在 funds-only 下不 veto，也会因大量小仓造成实际竞争？
- 小仓是否降低后续高质量候选的资本、分析或执行机会？
- 小仓是否导致“55 个仓位但总资本部署仍很低”的结构？
- 如果没有真实机会成本，也要明确证伪用户假设。

---

# 10. 当前 UNKNOWN 建仓委托是否掩盖真实问题

当前界面仍显示大量历史 UNKNOWN Entry 委托，且部分已有数小时/数天。

本轮不以“清理 UNKNOWN”作为风险治理任务，但必须确认它们是否影响核心交易质量判断：

- 这些 UNKNOWN 中哪些仍真实占用资金、reservation、submission identity、candidate lifecycle 或 position resources？
- 哪些只是审计记录？
- Dashboard 当前“只显示仍占用活动交易风险”的定义是否与真实执行层一致？
- 历史 UNKNOWN 是否参与 sizing、available capital、candidate budget 或位置计数？
- 是否因此让新建仓数量被压小？
- 是否因此让可用 4,000+ 的 readback 与实际 sizing authority 使用的可用资金不同？

只追究其是否影响**仓位规模、资本利用、执行选择和交易质量**，不要把本轮重新变成 UNKNOWN 清理项目。

---

# 11. 必须建立统一的“交易经济事实链”审计

当前系统不能再只证明“订单合法提交”。必须核实每笔真实新 Entry 是否能完整回答：

- AI 为什么选这个方向？
- AI/系统原本想投入多少钱？
- 最终实际投入多少钱？
- 中间为什么变化？
- 占用了多少保证金与 notional？
- 计划赚多少钱？
- 最终 TP 计划赚多少钱？
- 实际赚/亏多少钱？
- 持有多久？
- 最大有利/不利移动是多少？
- 为什么最终退出或为什么一直没退出？

审计当前代码是否已经能把这些事实按同一个 intent/lot/positionCycle 串起来；若不能，指出断点。

---

# 12. 本轮明确不作为主目标的问题

除非它们直接导致 sizing / TP / exit / direction 质量异常，否则不要再次把大量时间投入：

- Gross cap
- Direction cap
- Cluster cap
- slot count
- Human cap
- Stress / Capital-at-Risk
- portfolio risk observation
- 已经 OBSERVE/NOT_REQUIRED 的旧风险门禁

不得为了“解决小仓位”重新引入这些风险 veto。

执行正确性事实（资金真实性、交易所合法性、identity、幂等、环境隔离等）可以作为证据检查，但不是本轮核心优化对象。

---

# 13. 审计方法要求

必须同时使用：

- 当前 `main` 源码；
- 当前 Settings/schema；
- 当前运行实例 readback；
- SQLite 真实记录；
- AI raw archive / normalized decision；
- TradePlan / reservation / intent；
- exchange order/fill facts；
- positionCycle / entryLot / TP provenance；
- 最近自然 TESTNET 数据。

禁止：

- 只看 Dashboard 截图得结论；
- 只看 unit tests 得结论；
- 用旧报告代替当前事实；
- 把用户猜测直接写成 PROVEN；
- 因为发现 5 USDT 聚类就直接假设某个常量是根因；
- 本轮直接修改业务代码。

证据分级继续使用：`PROVEN / STRONG_EVIDENCE / UNKNOWN`。

---

# 14. 必须产出的文件

本轮只做审计与设计，不实施代码。

在：

`docs/reports/v397-core-trading-quality-final-audit-20260929/`

提交至少：

## `ROOT_CAUSE_REPORT.md`

必须包含：

1. 建仓 notional 分布与约 5 USDT 聚类是否真实；
2. 200 USDT 最低交易设置的真实定义和执行链；
3. 从 AI 输出到 exchange order 的 sizing 全链差异；
4. 资本利用率与 sizing authority；
5. TP 收益分布与低收益根因；
6. Entry/Exit/Closed/holding-time 当前事实；
7. AI 方向质量及与执行延迟的拆分；
8. 小仓位的真实机会成本；
9. UNKNOWN 是否干扰 sizing/资本事实；
10. 每个核心问题的根因、严重度、证据等级、代码路径；
11. 哪些用户假设被证实，哪些被证伪；
12. 当前最核心的 3–8 个根因，不要列几十个次要问题稀释结论。

## `SOLUTION_AND_IMPLEMENTATION_PLAN.md`

由你根据审计结果**独立提出**完整解决方案和一次性实施计划。

计划必须以最终解决：

- 建仓数量/金额不科学；
- 最低交易金额未落实（如果被证实）；
- 资本利用与 AI 机会质量脱节；
- TP 经济收益低；
- 平仓率低/持仓过久；
- AI 入场方向质量或执行扭曲；

为目标。

本提示词不规定你的解决方式。方案必须从审计证据推导，不得机械沿用上一轮 P1–P7。

---

# 15. 最终输出要求

本轮：

- **不要修改业务代码**；
- 不改 Settings；
- 不 repair 数据；
- 不重启 Engine；
- 不产生交易所写入；
- 只读审计；
- 生成两份报告；
- commit + push GitHub `main`；
- 最终汇报 SHA。

最终汇报只需简洁说明：

1. 约 5 USDT 建仓是否被证实以及根因；
2. 200 USDT 设置是否真实生效；
3. 止盈收益低的首要根因；
4. 平仓率低的首要根因；
5. AI 入场方向质量问题是否被证实；
6. 已提交的两份报告路径；
7. 最终 SHA。

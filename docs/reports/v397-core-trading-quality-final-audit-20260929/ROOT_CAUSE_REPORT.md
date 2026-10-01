# V3.9.7 核心交易质量最终审计

审计日期：2026-09-29 起，时间戳以证据文件的 UTC / epoch ms 为准。本报告同时执行原提示词与补充指令，冲突以后者为准。业务修改仅补完上一轮 P1–P7；新的 sizing、200 最低 notional、方向及退出策略没有上线。审计开始时 Settings version=219；运行中的资产目录研究刷新使版本自动递增至最终的 228，业务交易参数未人工改动。

## 1. 结论与证据边界

**大量约 5 的订单是真实、系统性的。主要首次出现在 Primary 原始 `quantityUnits`，不是交易适配器把大单缩小。所谓 200 配置是保证金基准，不是订单最低名义金额。小额仓位配合正常百分比 TP，自然只能产生几美分收益；历史远 TP 与被关闭的主动退出机制共同形成持仓长尾。可观测方向短窗表现偏弱，但全体 AI 方向质量差尚不能证明。**

证据等级：`PROVEN` 指源码和直接事实一致；`STRONG_EVIDENCE` 指样本支持但不能排除混杂；`UNKNOWN` 指未记录、覆盖不足或不能安全重建。没有把提示词中的猜测当结论，没有把单测通过等同交易质量通过。

本轮代码提交依次为 `9129f91`、`0ff6cdaca678886b16209b04c66f09ada499eb7f`、`924059eceb2e6de9e3b9d57ffa3307465366f714`、`c2a2da8`、`99a684a`、`88cee97b6cc65dd7497263f236086c328de2e614`、`46553b21cf5c4a84502a4ee01a960b5b4e39d45c`、`6c991df`、`f68901a`、`f1700bc` 和 `768c287`。中间运行 build `3.9.6-82c738addfc0201d23cf` 保留了约 4.7h 的自然 cohort；第三批 build `3.9.6-4c431bc0404277f1d700` 后的长窗口复验及后续 P2/P5 验收见文末。**中间 cohort 不冒充最终 build 样本。** 1h/6h/24h 为滚动窗口，可能包含多个 build；订单创建时间、intent/run 关联与实例启动时间用于分层。

## 2. 上一轮 P1–P7 重新审计与修复

| 项目 | 发现的遗漏 / 回归 | 本轮补完和实际边界 |
|---|---|---|
| P1 Exit convergence | `ceil(open/batch)*interval` 忽略查询耗时，上一轮实测超过所谓上界；轮末时间沿用旧值 | 服务上界显式计入 batch × queryDeadline 与 5s 调度余量，另保留 nominal 字段和 basis；轮末使用真实时间。按 eligible/backoff 语义解释，不能保证任意事件循环停顿下的绝对 SLA |
| P2 cycle/lot/CLOSED | 退出超量分配可能重复整笔 fee/PnL；远端 position 合并覆盖刚更新的 lots；恢复 cycle identity 丢失；小于 1 的成交均价分母错误；one-way BOTH/manual ADD 的角色分类错误 | 分配按实际剩余比例；保留最新 lots；使用 durable cycle/positionCycle identity；真实 fill quantity 分母；TP/manual reduceOnly 与证据联合定角色。历史无法证明的零边界继续 UNKNOWN |
| P3 submission identity | 相同身份不同 payload、跨账户 client id、旧 slash scope / 非 JSON payload、WORKING/PARTIAL replay 的真实 SQLite 路径不足 | 同一 intent 不允许变 symbol/side/qty/price/client id；跨环境账户 claim 拒绝；兼容 scope 且不在坏 JSON 上崩溃；已有远端身份只查询不重发。二次 open / replay 测试通过 |
| P4 Entry permission | 新 permission primitive 未完整进入真正 submit；自 reservation 可能重复扣；同 symbol 持仓仍可在候选层跳过 | 实际 JIT 调用 `evaluateEntryExecutionPermit` 并产生日志，排除自身 reservation，严格 TESTNET + TESTNET_ENABLED、finite positive margin；funds-only 不因已有持仓跳过。风险观察不恢复 veto |
| P5 TP provenance/economics | WARN_AND_KEEP 对 fallback/source 分支不一致；SHADOW quantity-horizon 某分支仍拒绝低净收益；模型 target range 被派生范围覆盖；terminal TP quantity=0 schema 不接受 | AI/STRUCTURE/FIXED 一致保留合法授权、显式经济警告；只有明确 fallback 才解目标；SHADOW 警告不拒绝、ENFORCE 保持显式含义；raw acceptableTargetRange 原样校验传递；只允许终态零剩余 |
| P6 funding/FX/depth/Review | incomeId 未按 account/env 隔离；覆盖窗口并集不完整；EXACT 不会降级；同 symbol 重叠周期与 USDC FX 被过度确信；Review 先扣预算后发现资源不可用 | 事务迁移复合主键，374 行及合计 25.91113508 保持；完整窗口连通并集，拒绝行不能算覆盖；每轮刷新含 EXACT→UNKNOWN；歧义/FX 缺失保守 UNKNOWN；真实 depth/blockers、fee buffer 按费用计算；资源检查先于 Review 预算、债务生命周期修正 |
| P7 readback/schema | funding 有 income coverage 就显示 HEALTHY，即使多数 cycle UNKNOWN；manualOrders 的 BUY/SELL 被 LONG/SHORT 覆盖；恢复 runtime 副本后又被 execution journal 旧副本覆盖；warnings 真值超 schema 上限 | funding PARTIAL 明示；方向只用匹配 durable intent + fill 身份恢复并保留 sideRecovery 审计，两份恢复入口共用函数；不猜方向；warnings 接受实际字符串列表；最终 durable schema round-trip 全 kind 0 invalid |

关键源码：`apps/engine/src/services/{s04ExitCoordinator,v396ExitRuntime,cycleAccounting,entryCoordinator,entryPermissionModel,quantityHorizonCandidates,aiExitFacts,aiFabric}.ts`、`apps/engine/src/config/settingsStore.ts`、`apps/engine/src/api/projections.ts`、相关 contracts schemas。具体差异以上述及第9节后续提交为准，避免用宽泛“完成”隐藏实改。

### 上一轮 11 条已知限制重新分类

1. AI Exit SHADOW：**明确策略开关**，没有伪称自然 ENFORCE 成交；本轮计划提出分阶段验证。
2. Review disabled：**明确策略开关**；公平性接线属于工程问题已补，运行 serve 仍未观察，不能以测试冒充。
3. 历史 funding：**不可安全恢复事实 + 工程问题**。窗口/隔离/降级已补，旧周期 attribution/FX 不编造。
4. 45–47 个 claim：**观察/历史证据问题**；WORKING 活跃 TP claim 不能见到未释放就删除。中间 readback terminalUnreleasedClaims=0；终态 release 与活跃 claim 分开验真。
5. 私有请求排队超时：**工程资源与核心执行质量问题**，不是一句“环境观察”就免责。bounded query 已有；Entry TTL 与旧 UNKNOWN 串行竞争仍纳入后续执行质量计划。
6. 行情新鲜度：**正确性条件 + 核心延迟问题**，保留真实行情检查，不把它取消来制造订单。
7. margin-tier 缺项：**交易所合法性证据缺失**，不能虚构杠杆档位；未覆盖 symbol 按名限制，非全局风险 veto。
8. 旧 fills provenance 为空：**历史不可追证**；本轮新分类修正，但不向全部旧 fills 猜填角色。
9. durable schema：**上一轮工程未完成**，不能统称历史不可恢复。合法终态零剩余、warnings、可凭 intent/fill 恢复的 manual side 已处理；openedAt=0 仍明确未知。
10. 3.9.6 标签：**版本标识观察项**，用完整 source/artifact/build 身份闭合，不靠改显示版本验收。
11. convergence 上界失真：**工程 readback 缺陷**，已补真实计算项，未放大 batch/缩短周期掩盖排队成本。

### 分支与本地 gates

已 fetch 并枚举相关本地/远端 codex 分支，见 [branches.json](evidence/branches.json)。指定五分支相对审计基线 main 均无 unique commit：cycle-accounting-final behind 564；entry-frequency-risk-audit behind 50；final-convergence behind 54；design-completion behind 182；astra-handoff behind 170。其内容已是 main 祖先，**本轮没有需要机械 merge/cherry-pick 的有效未合入代码**。没有删除旧分支、force push、rebase 或 squash。补查非 codex 的 trading-quality-stage1-3-20260914（local/remote behind574/572）及 gpt56-final-convergence-20260913（behind576），相对99a684a均 unique=0，见 evidence/branches-additional.json。

第三批本地 `npm run verify` exit 0，包含 deps/scripts/typecheck/formal build/full workspace tests：215 files / 1800 tests（engine 186/1632，core 8/58，dashboard 21/110）。定向回归已通过；S00 blockers=[]，186 engine tests 中 19 个开 store 的测试均隔离；storage PASS；diff check clean。canonical 正式 build 成功，真实库 schema 全 0 invalid。早期失败已修复后重新完整运行，没有跳过 gate。未运行 GitHub Actions。

## 3. 约 5 notional 的分布与第一变化点

以下冻结中间 cohort 的 asOf=1790696392567，原始证据 [summary-build82.json](evidence/summary-build82.json)。这些是创建订单，包括拒绝/UNKNOWN，并非全部成交或资本投入；价格字段可能被 exact fill VWAP 更新，因此不能把 `qty*price` 一律称原始 maker 请求金额。USDT/USDC 分币统计见证据，合并数只是近美元描述，不代表已证明 FX=1。

| 窗口 | orders | 4.9–5.5 | 中位 notional | notional 合计 | Entry fills / Exit fills / CLOSED |
|---|---:|---:|---:|---:|---|
| 1h | 17 | 16 | 5.06892 | 86.80158 | 15 / 10 / 4 |
| 6h | 133 | 115 | 5.05538 | 1718.937795 | 63 / 34 / 19 |
| 24h | 484 | 416 | 5.07615 | 7716.994379 | 205 / 56 / 26 |
| 中间 build ~4.7h | 101 | 88 | 5.06770 | 1532.960777 | 46 / 34 / 19 |

fills 为成交片段数，旧缺角色行使用 side/direction 推断且保留其限制；CLOSED 是 canonical records 去重后终态数。**56/205=27.3% 只是片段计数比，不是同一 Entry cohort 的最终平仓率**。同理不得把 26/484 称策略平仓成功率。

该 build 101 个订单中，100 个 raw quantityUnits 恰好等于 input legal minimum，raw→normalized→plan→intent units、units×step→final quantity、raw side→final side 比较均无变化。存在 raw 主动选择较高值的反例 `airun_mumq5zqt_8ofzse3k`：quantityUnits=100，而 min=1/max=2871，notional≈903.4。这直接证伪“AI 没有数量权”“适配器统一锁死 5”。样本全链见 [natural-entry-traces-build82.json](evidence/natural-entry-traces-build82.json)，最终 build 独立样本在文末。

**第一处小额值是模型 raw 输出。** `preAiExecutionEnvelope.ts:118` 的最小 units 来自 exchange minQty/minNotional / step，绝大部分 exchange minimum≈5，ETH≈20、BTC≈50；`compactEntry.ts:32` 要求模型在 min/max 内自选整数 units；`aiQuantityAllocation.ts:7` 只 materialize units×step，notional=qty×授权价格、margin=notional/leverage，明确 NO_CONFIDENCE_RESIZING。Reservation 是占用事实，JIT 校验实际价量，不缩量；ExternalTradeAdapter 发 quantity/price，不再乘除杠杆。不存在这批样本“先大于 200，后 rounding/reprice 变成 5”的证据。

原因分两层：**PROVEN** 是模型持续选择合法最小值、合同没有系统订单最低金额；**STRONG_EVIDENCE** 是上下文强调可执行最小值而缺少明确资本配置目标/预算理由，导致小额合法解持续出现。无法读取模型心理，因此“模型被锚定”的心理因果不是 PROVEN。quantity-horizon 梯子虽存在，但实际选项验证允许模型选择自己的 units，并非强行取梯子第一档；未发现当前路径 canary/test-size 常量覆盖 raw 数量。

## 4. “200”设置、资金、单位与实际 sizing authority

Settings version 219 中 `portfolio.entryMarginUsd=200`（UI 建仓保证金 USD），`portfolioIntelligence.baseMarginUsd=200`（动态基准保证金），`minMarginUsd=1`。没有独立、最终订单消费的 minimumOrderNotional=200 配置。`packages/core/src/portfolio.ts:380` 从 entryMargin/baseMargin 乘 tier/liquidity/volatility/confidence/exposure 等因子形成路由预算；当前 funds-only AI envelope 上限按真实 quote available 形成，leaseBudget 是候选占用预算，不是必须投入或最低订单金额。

因此“200 最低金额已经设置但失效”的表述不准确：**最低 notional 200 这个业务契约尚未存在；现有 200 的单位与用户理解不同**。不是 rounding 后漏检查 200，也不是另一个 fallback 把 200 覆盖为 5。Candidate/Primary/TradePlan/Reservation/Intent/JIT/Adapter 共享交易所 minimum、frozen qty 和合法价格约束，没有任何一层实施系统 notional 200 floor。UI 将 margin 与订单 notional 混读会误导；同一个 order.price 还可能在成交 readback 变为 VWAP，需后续显式分列 originalLimitPrice/fillVWAP。

真实账户示例：审计初段 ETH quote available=3385.407，leverage=18，maxNotional≈60937.327；min units=8，raw=8，qty=.008，约 21.7，leaseBudget=114.8。不是实际资金只够约 20。后续 USDT available≈3468.44、USDC≈4955.01：用户“两者均 4000+”在该采样点不成立。最终余额见文末，以 private account 时间为准，不跨时点硬比。

AI 输入实际含 account.available/free/reserved、两方向合法区间、exchange filters、leverage、fees、经济目标与市场事实；数量权为 Primary raw quantityUnits。不能将 leaseBudget 当实际 order margin，也不能把全账户 equity 当该 quote 可用保证金。当前合同既允许全资金上限也允许只取 exchange minimum，**资金可用与资本配置理由脱节**；这不意味着应满仓。中间 61 仓总 notional≈10536.96、估算保证金≈1051.10，但 3 个历史大仓支配总额，中位仓位≈14.72、中位 margin≈1.26；分币和成交实际投入的补充统计见文末证据。新建订单 notional 流量/当前 available 仅是流量比，不是账户时点资金利用率或净占用增量。

## 5. TP 经济性与退出事实

中间 asOf=1790696784709：61 仓均有 TP；source=46 FIXED_PROFITABLE / 9 AI / 6 STRUCTURE_15M。11 个该 build 新建且仍开仓者=1 FIXED / 7 AI / 3 STRUCTURE，不能拿全量旧 FIXED 分布说明新模型仍统一生成远目标。

匹配所有 61 仓与真实 tpOrders，目标相对 entry 的移动中位 3.38677%，距离当前 mark 中位 6.47372%；以双边 taker 0.0004、费用 buffer 10%、不计 funding 的显式假设重算，目标净收益中位≈1.000205，21/61 小于 1。见 [tp-facts.json](evidence/tp-facts.json)。**此估算不是 EXACT net，也不是未来收益预测**；USDC 的精确美元转换未证明。

API tpEconomics 仅覆盖 5/61，2/5 带 low-target warning；新仓只有 2 条该 telemetry，净收益估计 .0384453/.042576，目标移动 .837%/.920%。不能把 2/61 或 2/11 称完整 TP_LOW_NET_TARGET_KEPT 发生率；缺字段不等于无警告。新 build 完整持仓/事件采样见后附。这暴露经济链 readback 覆盖不足，而非证明所有 TP 都不经济。

24h canonical CLOSED=26：排除 funding 的交易净收益中位 .047189，P10 .022109 / P90 .093651，最大 .381959；有 EXACT funding 的仅 8 条，净收益中位 .037123、合计 .522346，另 18 条 funding UNKNOWN。闭合仓 notional 中位 5.1425，持有中位 1.21256h、P90 8.82705h、最长 25.78035h。见 [economic-metrics.json](evidence/economic-metrics.json)。不是“全是零平仓”，也不能把 26 条都报成精确含资金费净利润。

根因排序：

1. **PROVEN，主要低绝对收益原因**：约 5 的投入 × 常见不足 1% 目标，扣费用自然只有美分。单独拉远 TP 到 $1 会需要不合理百分比移动；单独提高 qty 而不校准质量也不能保证盈利。
2. **PROVEN 机制 / STRONG_EVIDENCE 经济影响**：WARN_AND_KEEP 保留合法原目标，允许收益很低的组合继续运行；仅记录警告没有形成联合 size/target/持有期限的资本决策理由。保留授权正确，不代表组合经济性正确。
3. **STRONG_EVIDENCE，长持仓主因**：历史 FIXED / $1 类远目标加上相对当前 mark 的较大距离；行情不触达时 TP 不会退出。TP coverage 是有合法挂单，不是可达性或盈利能力。
4. **PROVEN 开关，反事实效应 UNKNOWN**：AI Exit=SHADOW、Review=false，使当前没有主动 AI 平仓机制；自然退出依赖 TP/既有人工退出。不能无样本宣称直接切 ENFORCE 必定提高收益或闭合率。

全 61 仓年龄中位21.397h / P90 229.989h / 最大250.793h；该 build 11 仓年龄中位1.020h、最大3.369h。**十天长尾主要历史仓，不能归罪运行不足五小时的新 build**。43/61 仓 notional<20，部分小仓也长期持有；大仓历史长持有同样存在，不能只用小额单一解释。当前自然 TP 闭合已有效发生，收益低/退出慢是质量问题，不等于 reducer 完全没工作。

## 6. 方向质量与延迟拆分

方向独立观察使用最近 72h PRIMARY archive，model completedAt 后第一条≤120s mark 作基点，15m/1h/4h/12h/24h 同样使用≤120s endpoint；`tq_marks` 与 shadow marks 源/时间逐行保留。未成交 PLACE 也进入分母；WAIT 且 direction=NONE 不可定义方向收益，不被伪分成 LONG/SHORT。见 [direction-evidence.json](evidence/direction-evidence.json)，其中 null 明确表示未成熟或无覆盖。观察窗口跨 build，不是最终新 build 24h 业绩。

| 已成交 cohort | 15m 有效 n / 命中 / signed mean | 1h 有效 n / 命中 / signed mean |
|---|---|---|
| LONG | 85 / 45.88% / -0.05725% | 26 / 23.08% / -0.76842% |
| SHORT | 138 / 44.20% / -0.12296% | 29 / 34.48% / -0.37627% |

4h 已成交 LONG n17 命中64.7%但 mean -0.2229%；SHORT n15 命中40% mean -1.162%。12h LONG4/SHORT12，24h LONG1/SHORT14，不能用这些小样本证明总体方向。未成交1h LONG n36 命中27.78%、mean -.23064%；SHORT n8 命中75%、mean +.73642%，提示成交选择偏差值得验证，样本不足不能称因果。完整 horizon/分层统计均在 JSON，不能只取有利分组。

最近 cohort SHORT 多于 LONG 是输出比例事实，不等于错误方向政策；101 个订单未见 raw→final side 翻转。高 confidence≥.7 可用15m只有 LONG1/SHORT4，conviction 信息价值 UNKNOWN，不能以此自动加杠杆。regime/confidence 缺失与覆盖偏倚在原行保留；Scout handoff 缺失时冲突 UNKNOWN，不凭最终方向倒造 Scout 意见。

市场输入 quote age 中位15.513s、model耗时中位71.010s/P90 75.809s，decision→submit ACK 中位14.732s/P90 19.906s；quote 在 wire 时可已约100s。170 个可解析 raw 的 entry horizon 均1分钟，TP horizon 15m/60m。decision→fill 中位49.012s、P90 265.991s、最大624.639s。**延迟与短 horizon 明显不匹配（STRONG_EVIDENCE），但不能只靠延迟数字证明每个方向已经失效。** ACK 时间不是 wire 调用起点。

15 个成交在 local absoluteExpiresAt 后约6–564s，见 [late-fill-observations.json](evidence/late-fill-observations.json)。这证明“成交可能晚于本地有效期”，不证明“首次下单晚于授权”或交易所异常。`entryCoordinator.ts:839` reviewPending 按 map 串行 exact-query UNKNOWN，后续才轮到活跃订单 TTL cancel；其旧 UNKNOWN 排队与局部 now 固定的机制会延迟处理。后续计划优先已提交活单的期限管理、限制后台历史查询批次并测 queue latency，不扩展授权/放宽价量。

MFE/MAE 只对具备窗口起止覆盖的 marks 计算；内部是否连续未证明，标 `ENDPOINT_COVERED_INTERNAL_GAPS_NOT_PROVEN`，因此数值仅采样极值，不是完整市场最大 excursion。逐 Entry realized/unrealized 与 lot/cycle join 仍有历史多次同 symbol 和未定 funding 的断点，不能把当前 position PnL 归给每个模型决策。**结论：短窗观测偏弱成立；“全体 AI 普遍低质量”UNKNOWN；执行链翻转方向在样本中被证伪；输入延迟和成交选择偏差必须先独立测量。**

## 7. 小仓固定成本、UNKNOWN 与经济事实链

TP、reconciliation、claim/cycle、funding、UI 与 Review 资源多数按订单/仓位计，5 与200 notional 同样占一个生命周期，43/61 小仓确有固定负载。未取得“某个高质量机会因小仓被挤掉”的反事实，故机会利润损失 UNKNOWN；不能把 position cap 重新变成风险 veto。高低置信度几乎都取最低 units，没有证明资本按有效机会质量分配。

中间 UNKNOWN=109，其中14为该 build 新单、26带某种 proof；不能把有 proof 直接等同当前未过期。reservation RELEASED2521 / WORKING86；`reservationDebitsAvailableFunds` 在 funds-only 只扣未过期 RESERVED 且未提交的本地承诺，已被交易所接受的订单资金占用由 private available 反映，UNKNOWN 不再机械二次扣全部旧预算。历史 UNKNOWN 会继续占 submission identity / 查询资源，但没有证据它把这批 raw qty 从大压成5。未精确匹配远端的单不能断言仍占或不占真实资金。Dashboard active-risk 筛选是兼容投影，必须同时显示 remote confirmed 与 local unresolved；不能将 UNKNOWN 总数当可用资金扣减数。

可接通的链：run→plan→intent→reservation→order/clientId→fill→lot/cycle→TP。断点：缺明确 size经济理由、原始 wire bytes/response origQty 没有独立 durable archive、部分 order.price 后续被 VWAP覆盖、旧 fill role/cycle边界未知、funding/FX不完整、所有决策独立 marks 覆盖不足、TP经济 telemetry 仅部分持仓。读取代码可证明 adapter不缩量；不能假装已有每笔逐字 wire archive。后续计划补这些事实，不把“订单合法提交”当完整经济决策链。

## 8. 核心根因、反驳与后续方案

| 根因 | 严重度 / 等级 | 解决方向 |
|---|---|---|
| Primary持续选择交易所最小 units，缺资本部署经济理由 | 高 / raw选择PROVEN；提示锚定解释STRONG_EVIDENCE | 联合 quantity/TP/horizon 选择、记录预算理由；不做静默机械放大 |
| 200是保证金基准，系统最低notional契约不存在 | 高 / PROVEN | 新建明确quote单位的唯一minimum契约，UI→model→JIT一致；旧200不自动改义 |
| 小额规模与TP绝对利润脱节 | 高 / PROVEN | 联合规模、费用、可达性和期限评估；不为了凑$1拉远TP |
| 历史远TP、SHADOW Exit、Review关闭形成被动退出结构 | 高 /机制PROVEN；收益反事实UNKNOWN | 先验证退出事实/ownership与shadow反事实，再评估启用；不接管人工仓 |
| 短信号与输入/model/成交延迟，UNKNOWN查询竞争TTL | 高 /事实PROVEN，方向损失STRONG_EVIDENCE | 分段时钟、live TTL优先、后台有界、期限重评；不延长旧授权 |
| 方向结果/完整经济链覆盖偏倚，无法校准conviction | 高 / PROVEN | 全决策独立行情、分层结果、lot/cycle实收益、原始wire事实 |

证实：5聚类、小仓收益低、历史持仓长尾、固定生命周期成本、配置/认知单位冲突。证伪：本采样“没有新CLOSED”；“AI没有数量权”；“执行层统一把大单缩成5”；“两quote采样时均4000+”；“有TP就经济合理”。证据不足：所有AI方向差、高confidence更优、全量小仓造成机会损失、未知旧单全部仍占资金、未知funding=0。

完整独立方案见 [SOLUTION_AND_IMPLEMENTATION_PLAN.md](SOLUTION_AND_IMPLEMENTATION_PLAN.md)。本轮没有上线该新策略，没有改200含义、强制方向、扩大预算或制造成交。

## 9. 长窗口复验发现的第四批 P1/P5 补丁

2026-09-30 06:22 +08，`4c431b` 实例 READY 运行约6.5h：123订单、51 FILLED、14 CANCELED、45 REJECTED、13 UNKNOWN；119/123 raw选minimum，数量/units/方向差异均0，65条有exchangeId及真实JITpermit，可完整提取20条。见 `evidence/*-build4c.json`。但 TP coverage=52/58，不具备“上一轮已闭合”的条件，因此没有在此停止。

新增调查发现：

- `TESTNET_WRITE_EGRESS_NOT_VERIFIED:UNAVAILABLE` 明确在 order transport 调用前抛出，却被 guardian 记为 ACK lost，进入持久 UNKNOWN。随后本地两次 ABSENT 把 projection 改成 REJECTED，**durable claim 仍未释放**，持续 TP_BLOCKED_BY_UNACKNOWLEDGED_EXIT。
- 增仓后旧 TP 数量不足，失败修复清空 position.tpOrderId；查找只找“数量完全匹配”的 WORKING，因此遗漏仍有效的旧小单，新的全量 TP 再次撞 quantity claim。该问题是退出维护接线缺陷，与新 Entry 风险 veto 无关。

提交 `c2a2da8` 及 outcome 一致性补丁 `99a684a` 修复：确定本地未发送的错误记录独立 `LOCAL_NOT_SENT`，不冒充交易所拒单，原 task/claim 保留审计并终结；启动恢复仅接受**原 durable 错误事件 + exact clientId 当前 ABSENT + 同账户 TESTNET scope + 零成交且从无已确认工作事实**的联合证据，普通超时、旧UNKNOWN和单纯查询不到均不得释放。补齐 JIT 拒绝的本地未发送路径，正向查询通过统一 reducer；旧数量不足 TP 在指针丢失时仍先取消并取得终态，再准备新单。没有删除历史订单/claim、重放不确定提交或绕过真实减仓数量证明。

补丁全量 verify 再次 exit0：215 files / **1803 tests**（engine 186/1635），typecheck、正式 build、S00、storage、diff 通过。新增测试证明 pre-wire 拒绝可恢复、timeout 不可冒充、已有 WORKING 不能被本地错误释放、SQLite 二次打开保留证明、空指针下先 cancel 旧小 TP。

该窗口 `blockedProductionWriteAttempts=8` **不能按字段名解释为八次 Production 下单**：ExternalTradeAdapter 的 catch 同时计数 TESTNET egress 校验失败；对应事件显示 TESTNET_WRITE_EGRESS_NOT_VERIFIED，实际 productionWrites=0、environment=TESTNET。这个历史计数名称有歧义，报告没有把它隐去或写成0。

此时 cycle inconsistent=20、unconserved=27，全部相关记录 openedAt 在最终补丁加载前；新 build cycle failures=0。funding EXACT10/UNKNOWN430，仍 PARTIAL。旧周期不通过删除或伪补 funding 清零。

### 9.1 独立方向观察和资本事实补采

asOf=1790721171425，最近72h有1489条带方向的已完成 Primary；[direction-final.json](evidence/direction-final.json) 保留全部逐行数据。这不是最终实例的72h业绩。已成交 cohort 的最新可观测结果如下，百分比为按模型方向签名的价格变化，未扣费用：

| horizon | LONG n / 命中 / mean | SHORT n / 命中 / mean |
|---|---|---|
| 15m | 92 / 48.91% / -0.03567% | 165 / 44.85% / -0.10031% |
| 1h | 21 / 28.57% / -0.44778% | 37 / 37.84% / -0.23435% |
| 4h | 6 / 66.67% / -0.44050% | 24 / 45.83% / -0.55276% |
| 12h | 20 / 15.00% / -1.97831% | 15 / 66.67% / +1.29892% |
| 24h | 8 / 37.50% / -1.60104% | 18 / 66.67% / +0.43738% |

未成交 PLACE 为 LONG366/SHORT813，但可观察1h仅17/33，mean分别-.05328%/+.12892%，4h及以上未成交覆盖为0。**SHORT长窗正收益与短窗负收益并存，不能报告“AI所有方向都差”。** 新旧采样有效 n 不单调，因为短期 shadow marks 会被容量维护裁剪，而不是研究样本自动越积越全。

源码证实覆盖偏差：`tradingQualityCollector.ts:148–159` 仅为 firstFillAt 已证明且 observation window 活跃的 episodes 记录 tq_marks；无成交机会本来不在此采集集合。`storageCapacityGuard.ts:7,34–40` 将 shadow marks 限至20000行、raw AI payload保留最近1000个terminal runs，旧 payload清空但保留archive元数据。故 998/1489 regime UNKNOWN，不能把它们默认 RANGE。已知regime分层见 [quality-supplement-build4c.json](evidence/quality-supplement-build4c.json)，不能以不等覆盖组的均值排名策略。

同symbol相邻方向决策间隔≤30min的可观测对仅8对，1次翻转（ENAUSDT LONG→SHORT，2.81min），不足证明普遍摇摆。该 build 212次 scoutHandoff=false、4次字段缺失，缺少 Scout 原始方向配对，不能把 raw structureDirection 误当 Scout 结论。逐 run→cycle links 已列入补充文件；多lot周期的总PNL不复制给每一个 Entry作为其独立收益。

资本分quote补采（asOf约06:22 +08，见 readback-build4c）：USDT available3119.4322、持仓名义12215.0172/估算margin1252.7634；USDC available4956.4721、持仓名义217.4764/估算margin23.1256。窗口已成交订单金额不是全部新建委托金额：USDT 1h/6h/24h分别57.2291/1896.9191/2647.7274，估算margin6.7292/201.2518/328.2107；USDC分别5.06264/45.8979/182.29159，估算margin.63283/8.85418/38.04937。相对该时点available的notional流量比USDT1.83%/60.81%/84.88%，USDC.10%/.93%/3.68%；它们不等于净资本部署率，不跨quote相加冒充精确USD。

此 build 新开且仍持有6仓，年龄中位3.08h、P90 3.97h，source=AI2/STRUCTURE1/FIXED3。新仓开始延长持有但尚不能等同十天历史长尾。完整窗口保留在 summary-build4c，与前一窗口分开。

### 9.2 最终加载前追加的 P2 周期归属修复

09-30 11:25 +08，e5 实例 READY，TP17/17，终态未释放claim=0；103个订单中101个raw选择最小量，执行units/qty/side差异均0。但长窗口已出现12个本实例新建的非守恒周期，故不能沿用上一窗口“新周期全部正常”的结论。证据保留在 evidence/*-builde5.json。

根因由真实fills、records和源码共同证明：同一exchangeOrderId被fallback lot和正式lot重复表示；ACCOUNT_UPDATE仓位归零先于退出TRADE更新时，旧cycleForFill把无本地订单身份的EXIT当作新周期起点，后续Entry加入这个周期；广义order aliases也可能覆盖同tradeId的既存归属。该项属于上一轮P2工程回归，不属于可忽略的历史UNKNOWN。

提交88cee97修复：按同exchangeOrderId聚合lot且优先显式身份；同symbol+tradeId唯一归属优先；EXIT永远不创建新生命周期，只能加入身份明确的cycle或已知时间区间，否则cycleId=null；ensureOpenRecord优先传入的物理cycleId。启动对重复lot投影重算，对同账户order registry唯一退出身份修复错误绑定，并记录before/after事件；不修改交易所原始数量、费用或删除历史fill。

真实数据只读内存回放曾发现113条重复lot投影可重建，而12条旧混合周期无精确registry退出身份，不能安全自动重归属，仍保留不一致及证据。不用新的正确代码追认旧错误账本为CONSERVED。修复后自然新增周期另在最终节检查；历史修复与未来预防明确区分。

新增5个回归测试覆盖lot别名计量、registry精确回绑与二次幂等、tradeId优先、归零先于退出成交、无身份退出不新建持仓。最终verify15：215files/1808tests，其中engine186files/1640tests；typecheck、正式build、S00、storage、diff通过。canonical正式build通过后第六次手动加载。

### 9.3 启动恢复持久化顺序收尾

第六次加载复核又发现：`rebuildProvenCycleAccounting()` 位于 durable event/checkpoint listener 注册之前。内存投影虽然已重建，但修复事件不能进入 `runtime_events`，独立 `trade_records` 副本也可能在下次启动重新覆盖恢复结果。这是 P2 的启动接线遗漏，不能只靠当前内存正确结案。

提交 `46553b2` 将重建移到 listener 注册之后；只在 `rebound/rebuilt` 非零时发布批量 `TRADE_RECORD_REPAIRED`，由既有单一持久化入口同时更新全部 trade records 和 runtime checkpoint。新增真实临时 SQLite 三次打开测试：第一次制造同exchangeOrderId的重复lot，第二次启动修复内存及独立trade_records并保存证据，第三次不重复修复且仍只有一个lot。最终 verify17：215 files / **1809 tests**（engine 186/1641、core 8/58、dashboard 21/110），typecheck、formal build、S00、storage及diff check通过；第七次手动加载用于最终运行验收。

### 9.4 最终实例发现的持仓行情补载饥饿

第七次加载在 `READY` 后出现 TP 28/31、missing=3、qtyMismatch=2。真实订单和事件证明 RAYSOLUSDT/HYPEUSDT 增仓、SUIUSDC 新开仓后，TP guardian 并非被风险门阻断；它们缺少生成合法 TP 所需的 snapshot。根因是 `refreshPositionMarkets()` 每次只补一个 symbol，而紧随其后的历史 claim reconciliation 在该实例约耗时18分钟。串行循环会让余下持仓在整个 reconciliation 期间拿不到 quote/tick/step，5秒 TP sweep只能保持 `MISSING`，且 retryQueue=0。该行为会把暂时行情缺口放大为长期未保护窗口。

提交 `6c991df` 删除单 symbol 截断，把当前全部缺失持仓交给既有 MarketDataHub；Hub 仍用并发2和共享请求预算做有界请求，遇到预算压力会显式 defer。新增回归测试证明一次 reconciliation 前传入全部缺失 position symbols。verify18 全部通过：215 files / **1810 tests**（engine 186/1642、core 8/58、dashboard 21/110），typecheck、formal build、S00、storage 和 diff check 均通过。随后 GitHub 新增的两个文档提交先并入，形成代码加载基线 `25155e7`；第八次明确授权的 TESTNET 手动加载用于最终 readback。该修复只恢复既有 TP 执行正确性，不修改 sizing、方向、最低金额或新策略。

### 9.5 TP 提交与仓位关闭竞态收尾

第八次加载证明批量补载成功：`POSITION_MARKETS_REFRESHED requested=23/loaded=23`，无 budget defer 或 symbol error。长 reconciliation 末尾，TIAUSDC 仓位恰在 reduce-only TP 等待 ACK 时关闭；旧 guardian 在 ACK 后以 `...state.positions.get(id)` 更新保护状态。此时 map 已无该仓位，spread `undefined` 仍生成只含 TP 字段的 phantom position。Dashboard projection 随后对 `side=undefined` 构造 execution scope，触发 `EXECUTION_SCOPE_SIDE_UNSUPPORTED`，fatal handler 持久化并有序退出。该失败由进程栈、SQLite phantom 行、TP_PROTECTED 和 lifecycle 事件共同证明，不是健康探测误判。

提交 `f68901a` 在 TP ACK 后重新读取 position：若已关闭，绝不重建持仓，尝试取消孤儿 TP、保留取消失败事件并交回 reconciliation；恢复路径隔离缺 symbol/side/positive quantity 的 TP-only phantom；projection 对瞬时坏行也不再抛出。新增3个回归测试覆盖提交中关闭、重启隔离和 projection 不崩溃。verify19：215 files / **1813 tests**（engine 186/1645、core 8/58、dashboard 21/110），typecheck、formal build、S00、storage 和 diff check 全部通过。第九次手动加载只用于加载该确定性竞态修复。

### 9.6 真实订单写入的十进制精度缺陷

第九次加载到 READY 后，资金与交易所条件允许的自然 BTCUSDT Entry 已完整经过 Primary → TradePlan → Reservation → Intent → JIT permit → submit；同一条链上的 portfolio admission 明确 `allowed=false`、`entryVetoEnforced=false`，Gross/Direction/Cluster/Human/PENDING_RISK_UNVERIFIED 只留审计。交易所实际拒绝原因为 `-1111 Precision is over the maximum defined for this asset`。SQLite intent 为6 units，stepSize=0.0001，业务数量应为0.0006；源码把 JavaScript 乘积 `.0006000000000000001` 直接 `String()` 写入签名 query。这是交易所合法下单正确性缺陷，不是风险门、资金不足或模型缩量。

提交 `f1700bc` 在全部 Binance 签名写路径统一规范 quantity/price/stopPrice/activationPrice/callbackRate：先消除 IEEE-754 尾数，再展开科学计数法为普通十进制；Entry、replace、TP 和 manual order 共用同一规则，避免保留等价缺陷。测试直接复现 `6 * 0.0001`，并验证 `0.0006`、`0.00000001` 和正常价格的 wire query。verify20：215 files / **1814 tests**（engine 186/1646、core 8/58、dashboard 21/110），typecheck、formal build、S00、storage 和 diff check 全部通过。第十次手动加载用于最终 TESTNET 验收。

### 9.7 零数量旧 lifecycle 污染新周期

第十次加载获得20个自然 exchange-accepted Entry 后，周期 readback 发现 DOGEUSDC LONG 被标成同实例新增 `IMPORTED_OPEN_POSITION`。真实 fill 与事件证明：21小时前的外部 EXIT 在旧代码下留下 `currentQty=0`、状态却非 CLOSED 的 lifecycle；本实例新 Entry 精确成交53单位后复用了该 lifecycle，旧 EXIT 与新 ENTRY 被错误组成 CLOSED record，远端仍存在的新仓随后才被 reconciliation 作为 imported。这个结果反驳“新 build 所有新周期守恒”，属于上一轮 P2 的遗留兼容缺陷。

提交 `768c287` 将零数量且收到正数量 Entry 的非 CLOSED lifecycle 视作已证明的平仓边界，强制创建新物理周期；既有同方向非零持仓仍保持 add-on 语义。回归测试构造旧 EXIT-only lifecycle 和已绑定旧 fill，证明新 Entry 使用新 cycle、exitQty=0、remainingQty=6，旧 fill 不进入新 record。历史错误行、外部 fill 和 imported record不删除、不伪改资金事实，报告保留其来源；新代码只阻止再次污染。verify21：215 files / **1815 tests**（engine 186/1647、core 8/58、dashboard 21/110），typecheck、formal build、S00、storage 和 diff check 全部通过。第十一次手动加载用于最终 readback 与自然链验收。

## 10. 最终 build 自然证据与交付闭合


最终读回时间：2026-10-01T02:30:44.171Z。代码 HEAD=768c2873b281187ba31c80d3a54f3143219521ce，GitHub main=768c2873b281187ba31c80d3a54f3143219521ce（报告提交前的代码 SHA；报告最终 SHA 由提交本报告的 Git 记录给出）。运行 PID=36164，instance=f708a5cc-2faa-4628-890e-69e90960f474，MANUAL_START / restartCount=215，启动于 2026-10-01T00:04:21.802Z。

- build：`3.9.6-cb7ee5240691050a5370`
- sourceHash：`4d09a29cc66f48f2f7bf3ec56937092b948ac73a1594efb7308c706a7489b257`
- artifactHash：`cb7ee5240691050a5370ff3955bd55796f33663c0415e1f527a5cc5559e1e527`
- health=READY；identity=IDENTITY_CLOSED，六项全部 true；schema=DURABLE_SCHEMA_ROUNDTRIP_OK，全部 kind 0 invalid；最终 Settings version=228（审计开始为219；期间仅资产目录研究刷新自动递增，业务交易参数未人工改动）。
- pipeline=RUNNING，scheduler=RUNNING，authoritative blocker=NONE；TESTNET funds-only，旧 portfolio admission 仅观察。普通合法性、资金真实性、身份/幂等、行情/授权有效性、持久化正确性仍保留。
- TP 31/31，missing=0；终态未释放 claim=0，neverPolled=0，queue=29，oldest=434974ms，nominal=480000ms，含查询 deadline 的 bound=1460000ms。
- 新周期非守恒记录=0；历史 fillCycleConservation/funding/position parity 的当前值完整保留在 readback，不宣称历史未知全修复。AI Exit仍SHADOW，Review仍disabled。
- productionWrites=0，blockedProductionWriteAttempts=4，lockedToTestnet=true；自然testnetWrites=93。审计没有强制候选/订单/成交，没有启用autostart/watchdog，未改变Production。

最终实例 63 个 Primary归档、38 个可读raw且有订单样本；36 个raw选minimum。units差异=0，数量差异=0，方向差异=0。其中 22 个具有exchange identity和真实JITpermit，按时间选取末20个完整自然样本，详见 [natural-entry-traces-final.json](evidence/natural-entry-traces-final.json)。逐层保留输入packet/filter/available/lease、raw、normalized、TradePlan、reservation、intent、JIT事件、order/filled facts；adapter request字节没有既存归档，仍明确UNKNOWN，不伪补。代码直传qty及远端订单事实共同支持“执行未缩量”，并不声称抓包。

| runId | symbol / side | raw units | step | final quantity | exchange order / status |
|---|---|---:|---:|---:|---|
| airun_muosnykm_u3zm7c7w | ZECUSDT LONG | 4 | 0.001 | 0.004 | 2975965720 / FILLED |
| airun_muosyxjc_gorwh661 | CRVUSDC LONG | 127 | 0.1 | 12.7 | 141945920 / FILLED |
| airun_muot3hxa_5nxd6s2q | ARBUSDT SHORT | 248 | 0.1 | 24.8 | 339778610 / FILLED |
| airun_muot62kx_x952lz52 | WLDUSDC LONG | 93 | 0.1 | 9.3 | 167300269 / FILLED |
| airun_muotas93_3h5uaubi | ETHFIUSDT LONG | 65 | 0.1 | 6.5 | 217502712 / FILLED |
| airun_muothcqb_t9lhvem3 | FILUSDT LONG | 48 | 0.1 | 4.8 | 336209160 / FILLED |
| airun_muotpx08_fulsdlar | VIRTUALUSDT LONG | 63 | 0.1 | 6.3 | 244394444 / FILLED |
| airun_muotsj3v_hdo6lwv0 | DOGEUSDC LONG | 53 | 1 | 53 | 370421149 / CANCELED |
| airun_muotvef5_3r6xb35l | VVVUSDT SHORT | 19 | 0.01 | 0.19 | 772484950 / FILLED |
| airun_muotxwxe_ioll7ao9 | INJUSDT LONG | 7 | 0.1 | 0.7000000000000001 | 310814945 / FILLED |
| airun_muou50fc_fr0zj5v3 | SOLUSDT SHORT | 5 | 0.01 | 0.05 | 4214557831 / FILLED |
| airun_muou7gw8_zsf0ghc0 | TAOUSDT SHORT | 17 | 0.001 | 0.017 | 676740027 / FILLED |
| airun_muou9yrf_lqmc60d8 | ADAUSDC LONG | 203 | 0.1 | 20.3 | 181757302 / FILLED |
| airun_muoum3tp_e7qksvml | RAYSOLUSDT SHORT | 26 | 0.1 | 2.6 | 274641231 / FILLED |
| airun_muov7lok_4tbktkrq | WIFUSDT LONG | 202 | 0.1 | 20.2 | 330011065 / FILLED |
| airun_muova24c_bt0hdhi7 | ETHFIUSDT LONG | 65 | 0.1 | 6.5 | 217516477 / FILLED |
| airun_muovcn3x_yptn9k9y | CRVUSDT LONG | 127 | 0.1 | 12.7 | 311222622 / FILLED |
| airun_muowua6c_qlxwu83q | ZROUSDT SHORT | 30 | 0.1 | 3 | 259608173 / FILLED |
| airun_muowwook_q6asxpfy | CRVUSDC LONG | 127 | 0.1 | 12.700000000000001 | 141973601 / FILLED |
| airun_muowz2t2_pnafykcm | HBARUSDT SHORT | 49 | 1 | 49 | 317521557 / FILLED |

最终滚动窗口（跨build窗口保留标签，currentBuild只含本实例；fills片段数不是周期关闭率）：

| window | orders | 4.9–5.5 | median notional | Entry fills / Exit fills / CLOSED |
|---|---:|---:|---:|---|
| h1 | 13 | 11 | 5.050080 | 7 / 7 / 2 |
| h6 | 68 | 52 | 5.056120 | 45 / 10 / 4 |
| h24 | 259 | 204 | 5.071440 | 172 / 99 / 30 |
| currentBuild | 38 | 29 | 5.050080 | 22 / 10 / 4 |

按quote资本/成交投入、未执行样本与first-cause、全部raw/order比较见 [readback-final.json](evidence/readback-final.json)、[summary-final.json](evidence/summary-final.json)、[entry-comparisons-final.json](evidence/entry-comparisons-final.json)。阶段样本量和历史未知保留，没有把没提交的样本排除后声称全系统无失败。

本轮共十一次明确授权的手动加载；九次加载前保存了settings/ownership SQLite及WAL/SHM和实例身份，备份路径见 evidence/release-evidence.json。第八次加载持仓行情批量补载修复；该实例随后因真实 TP ACK/仓位关闭竞态触发 fatal 并完成有序持久化退出。第九次加载确定性竞态修复，真实自然提交暴露 Binance 十进制 wire 精度缺陷；第十次加载统一精度修复并收集20条自然接受链，随后readback发现旧零数量lifecycle污染新周期；保存第九份备份并停止后，第十一次加载该P2兼容修复。全程没有因 health STARTING 自动重启。最后一次之后只读等待 READY 及自然样本；期间交易所egress短暂不可用，scheduler保持RUNNING，恢复后系统自行完成WIFUSDT TP repair并超过20条自然接受样本。报告文档提交不改变参与 source/artifact hash 的目录，push 后再次核对 identity、health 和 ref 一致。

最终 fetch 后复核 29 个相关本地/远端引用，`origin/main..ref` 均无 unique commit，因此没有遗漏的有效代码需要 merge/cherry-pick；详见 [branches-final.json](evidence/branches-final.json)。

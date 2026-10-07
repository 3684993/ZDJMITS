# 审计问题逐项回答：255/255

审计SHA `66f61d08391ed39713521365f421536e443e05b7`；2026-10-07。本附件必须结合[优先级审计报告](SYSTEM_AUDIT_20261007.md)理解。F编号指报告发现，S/R/T/C/H编号指末尾证据索引。PROVEN离线路径并不声明本实例交易实际受到损害。UNKNOWN回答列明需要补充的证据，未给虚构金额或概率。

问题保留原英文原文，答案为中文；本轮无代码/参数/服务/交易写操作。模型档位无法由本会话工具保证。

## 系统整体

### Q1. What assumptions does the current architecture make that are not actually enforced by code or tests?

PROVEN：共享 quote.ts 等于所有报价字段新鲜、FOUND 等于活跃 TP、reachability 等于成交概率，均未被实现保证。F01/F02/F04。

### Q2. Which important invariants are implemented in more than one place and can drift apart?

PROVEN：行情 freshness、账户 readiness、候选经济检查、订单状态归一化在多处实现；出现共享报价时间戳、premiumIndex 分类与 TP 恢复语义漂移。S01/S02/S04/S06。

### Q3. Which subsystem can currently report a healthy state while another dependent subsystem is actually stale, blocked or degraded?

PROVEN：/health ready=true、market.count=8、TP PROTECTED 与 PRIVATE_DATA_UNAVAILABLE/零新鲜候选同时存在；analysis.execution 还保留上次 ready=true。F09。

### Q4. Are there states where the dashboard says RUNNING/READY while the trading path is materially unable to create, manage or close trades?

PROVEN：15:10 的服务 RUNNING/ready=true，实际 executionReadiness.ready=false、禁止模型花费与新 Entry；不能把进程可响应解释为能交易。R01/R02。

### Q5. Are there states where the system is conservative for reasons that no longer correspond to real execution risk?

PROVEN：关闭历史可达性开关后，带历史样本的自定义目标仍受统计上界拒绝；正常 V397 冻结候选是否受影响未证明。F12。

### Q6. Are there hidden global blockers caused by a local/candidate-specific problem?

STRONG_EVIDENCE：候选级行情隔离已有实现；共享代理、REST 槽位、账户事实仍是全局依赖。局部修复风暴可消耗共享容量，不能因低交易所权重排除本地压力。F05/F06。

### Q7. Are there local/candidate-specific blockers incorrectly suppressed because a global subsystem appears healthy?

PROVEN：候选隔离不以全局 WS LIVE 作为足够条件，这是正确边界；但共享 quote.ts 会让候选内部旧字段漏过新鲜度判断。F01。

### Q8. Which failure modes can survive current tests because tests mock away timing, concurrency, persistence, network or exchange behavior?

PROVEN：当前离线反例覆盖了已有测试未排除的乱序、分字段过期、单次私有超时、恢复事件重复、断续 K 线。T01；未复现真实网络写入。

### Q9. What important runtime behavior is not covered by an end-to-end or integration-level assertion?

UNKNOWN：没有本次独立验证的长时间“代理劣化→拥塞→私有补事实→决策取消→恢复”全链路；也未证明异常 TP 恢复正确处理远端终态。F02/F05。

### Q10. Which recent fixes solved symptoms but may still leave a deeper architectural cause?

PROVEN：NET-002 的候选隔离/advisory 排除修复存在；私有分支绕过 burst 门槛、报价 REST 扇出、后台 lane 误分类仍在。对账软预算未解决遍历公平性。F03/F05/F06/F07。

## Entry质量

### Q11. Does the current candidate-selection and Primary decision pipeline optimize for actual post-fee, post-slippage trading quality, or can it prefer statistically attractive but economically weak entries?

PROVEN：排名主要用流动性/活跃/技术/数据/可达性，非风险调整净收益；候选 EV 的失败收益是假设值，可能使经济弱候选显得有吸引力。F04/S07。

### Q12. Which inputs have the greatest influence on entry quality, and are any of them noisy, stale, redundant or insufficiently validated?

PROVEN：盘口、波动/闭合 K 线、统计可达性、可用资金、Primary 文本均影响 Entry；报价时间戳及断续历史是已确认弱点。F01/F04；实际变量重要性尚未校准。

### Q13. Are candidate ranking, executable filtering and final Primary selection aligned to the same economic objective?

PROVEN：排名、经济 executable、Primary 候选选择没有统一经验证的目标函数；费用合法性一致不等于最大化真实期望收益。S07/S08。

### Q14. Can a candidate receive a high rank while its achievable maker price, spread, liquidity or short-horizon reachability makes the trade unattractive?

INFERENCE：可以；排名没有显式队列成交概率，maker 排队与深度冲击也未直接进入期望值。需要按排名分组的未成交/成交后净收益反证。F04/F10。

### Q15. Are expected profit, fee burden, funding, spread, slippage and fill probability combined consistently throughout the pipeline?

PROVEN：明确计算入场/出场手续费和 buffer；funding UNPROVEN、滑点配置为零、成交概率未独立建模，不能称全成本期望值一致。S07/C01。

### Q16. Is there any double-counting or omission of costs between candidate selection, Primary reasoning, economic admission and final execution checks?

PROVEN：未发现核心费用公式重复扣费；发现 funding 未纳入、滑点默认零及失败收益被最低利润替代。后两者不能用“保守 taker 费”补足。F04。

### Q17. Does the system distinguish correctly between a good market thesis and a good executable entry?

PROVEN：冻结 executable candidate、TradePlan、资金/交易所过滤与 JIT 将观点和可执行性分开；盘口缓存缺陷仍可污染这两层。S08/F01。

### Q18. Are there circumstances where the system enters too late because confirmation requirements consume the useful edge?

STRONG_EVIDENCE：过去 24h 已完成 Primary 平均约 101 秒，远长于短盘口优势；是否因此晚入场需要 packet→决策→提交价格轨迹，不可直接断言损失。R04/F10。

### Q19. Are there circumstances where the system enters too early because the decision framework rewards direction confidence more than execution timing?

UNKNOWN：没有已校准的 confidence 或入场时机收益曲线；PLACE 集中度提供检验线索，不能证明“过早”。需条件化事件后的 MAE/MFE、成交时差。R04/R05。

### Q20. Are trend, volatility, order-book, microstructure and recent-trade signals used in a way that can become mutually contradictory without the system noticing?

PROVEN：不同频率行情组成 snapshot，缺少所有字段共同的时间水位；盘口更新可掩盖旧 mark/last，构成输入矛盾而无检测的路径。F01/S05。

### Q21. Does the current system adapt entry standards to market regime, or does one threshold structure behave poorly across trending, ranging, low-volatility and high-volatility regimes?

PROVEN：技术/结构输入会随市场变动，但净利润、buffer、margin floor 等阈值主要固定；未发现逐 regime 的样本校准证据。C01/S07。

### Q22. Are long and short entries treated symmetrically where they should not be?

PROVEN：公式支持 LONG/SHORT 对称变换；实际本实例 PLACE 为 1 LONG/16 SHORT，24h 为108/148。方向不平衡不是偏置证明，须对候选供应与市场 regime 条件化。R04。

### Q23. Are USDT and USDC markets treated equivalently where liquidity/fee/funding characteristics differ materially?

PROVEN：资金路由按 quote asset 区分，USDT 可用0与USDC约4409分别展示；费用参数却共享固定值，未证明两市场实际费率/盘口质量相等。C01/R02。

### Q24. Which current entry filters likely improve win rate but reduce expected value or opportunity frequency too much?

UNKNOWN：5bps near-market、最低100 margin、统计上界可能损失机会；当前硬阻塞是私有/行情事实，不能推断放宽质量阈值会提高收益。F10/F12。

### Q25. Which current filters likely increase trade frequency but reduce expected value?

INFERENCE：TESTNET funds-only、不强制组合风险、固定低净利润目标可提高参与率，但提高频率是否稀释收益未验证。政策授权不是统计收益证据。F11/C01。

### Q26. Which variables should be evaluated empirically from TradeRecord/history before changing any entry logic?

建议先量化：成交率、决策/提交延迟、真实 maker/taker 费、按 symbol/regime 的 MAE/MFE、净收益与资金占用、人工接管后的全周期收益；完整分母见 F10。

### Q27. What evidence in existing trade history would falsify the current entry-quality assumptions?

可证伪条件：高分/VERIFIED-EV 组扣全成本后负收益；命中 TP 概率与报告值系统偏离；短预测跨度却长期持仓；同组低分候选反事实更好。现有 canonical 覆盖不足。F04/F10。

## 频率与机会损失

### Q28. Is the current entry frequency primarily constrained by genuine lack of opportunity, AI throughput, scheduler cadence, market-data gating, risk occupancy, stale UNKNOWN identities, cooldowns, candidate lifecycle or another bottleneck?

PROVEN：15:10 主因 PRIVATE_DATA_UNAVAILABLE 与全部候选行情过期；调度心跳仍前进。健康时 AI约101s为明显瓶颈候选，历史 UNKNOWN 间接消耗 REST。R02/F07。

### Q29. Which bottleneck currently dominates during normal healthy operation?

UNKNOWN：没有分离健康/退化时段的端到端吞吐基线；24h Primary 延迟与本实例慢请求显示候选瓶颈，但不足确定所有健康阶段主因。R04/F05。

### Q30. Are there independent candidates that are unnecessarily serialized?

PROVEN：Primary 容量按模型资源串行管理；不同 symbol snapshot 有单飞并行。扩大独立决策并发是否安全，需资金租约、关联标的与 JIT 冲突回放。S05/S08。

### Q31. Is Primary capacity being spent on candidates that deterministic filters could reject earlier?

PROVEN：已有先 executable/filter 后 Primary 的路径；仍给候选带入未校准统计经济标签。未证实大规模把确定性不可执行候选送给模型。S07/S08。

### Q32. Are useful candidates waiting because of global cooldown or resource ownership rules that could safely be candidate-scoped?

INFERENCE：资源与底层标的占用会压候选供应；15:10 不能把 waiting 原因归为 cooldown，因为主要是事实缺失。需每候选 blocker 持续时间，而非全局 RUNNING。R02。

### Q33. Are cooldown durations evidence-based or arbitrary relative to market half-life?

UNKNOWN：90s near-market TTL、20s review、60min absolute TTL 等配置可核实，但没有相应市场半衰期估计支持。C01/R05。

### Q34. Do retry/quarantine policies suppress valid opportunities after transient AI/schema/network faults?

INFERENCE：schema/网络故障 quarantine 会暂时压供应，代码有恢复；实际误杀率需故障后恢复候选与随后轨迹。不能用少成交直接判 quarantine 过严。S08/R02。

### Q35. Can a stale historical UNKNOWN claim reduce practical entry frequency even when it no longer represents live exchange risk?

STRONG_EVIDENCE：当前资金-only 不以历史 UNKNOWN 作组合 veto，但重复核查前三条消耗私有 REST/对账时间，间接压低可用性。F07/F05。

### Q36. Does the current risk-occupancy model distinguish sufficiently between live risk, unresolved identity risk and historical observation?

PROVEN：scoped UNKNOWN、no-risk proof、历史/活跃字段已有区分；兼容 aggregate/pendingEntries48 仍易被看成48真实挂单。当前 exchangeOpenEntryOrders0也是有时效的快照。F09/R02。

### Q37. Are there scheduler timing windows where a candidate can repeatedly miss its optimal entry because review/dispatch intervals are misaligned with market dynamics?

INFERENCE：101s Primary 与2s near-market review/90s TTL 存在时标张力；冻结 packet 到提交的 JIT 可拒绝过期事实。需记录拒绝年龄与错失价格窗口。F10/S08。

### Q38. Is the configured candidate pool size appropriate for actual Primary throughput?

PROVEN：pool target20，15:10 实际供应5、新鲜0；增大 pool 不会修复账户/网络事实。健康时20候选对101s吞吐是否合适需按轮换年龄测量。C01/R02。

### Q39. Is the current maximum pending-entry count economically justified relative to capital, correlation and order-management capacity?

UNKNOWN：maxPendingEntries6 与 maxPositions50 是运营参数，未找到资本/相关性/管理成本的经验推导；不能把历史 pending48 当实时违反6。C01/F09。

### Q40. Can multiple simultaneously valid opportunities be handled without increasing duplicate-order, stale-fact or reconciliation risk?

PROVEN：租约、clientOrderId、journal/JIT 提供并发防重边界；共享网络和资金仍可能拥塞。未独立验证多机会同时提交的真实异常恢复闭环。S08/S09。

### Q41. What is the estimated opportunity cost of current hard/soft gates, and which gate should be measured first before changing anything?

UNKNOWN：无法可靠给金额；先测“已可执行候选因私人事实/本地排队延迟失去资格”的时间与反事实净收益，随后再测 Primary 延迟。F05/F10。

## Sizing与持仓数

### Q42. Is position sizing based on a coherent risk model or mainly on available funds/leverage/limits?

PROVEN：当前 sizing 以可用 quote funds、最低 margin、10–20倍候选、交易所约束为核心，不是按固定最大损失分配。TESTNET funds-only 是明确政策。F11/S08。

### Q43. Does sizing account for volatility, stop distance, expected adverse excursion, liquidity and correlation consistently?

PROVEN：盘口/交易所限制参与合法性，波动参与候选观点；没有统一 stop-distance/MAE/相关性风险预算绑定到 quantity。F11。

### Q44. Can the same nominal risk allocation produce materially different real risk across symbols?

PROVEN：相同 margin/杠杆在不同波动、深度和期限下可产生不同损失，源码未提供等风险保证；现有 AVAX 长期浮亏体现未及时退出，不证明唯一 sizing 根因。R03/F11。

### Q45. Does the system size trades differently enough when volatility regimes change?

UNKNOWN：候选随行情变化，但未证明 quantity 对 regime 足够自适应；按同 margin 的波动分位和 MAE 分布可检验。S07/S08。

### Q46. Is the maximum number of open positions scientifically related to capital, correlation and risk budget, or is it effectively a static operational limit?

PROVEN：50 是配置静态槽位限制；当前组合风险维度 OBSERVE、不强制，不能称为科学损失预算。C01/R02。

### Q47. Are portfolio limits too restrictive for low-correlation opportunities or too permissive for highly correlated opportunities?

INFERENCE：funds-only 可容许高度相关持仓；强制组合 cap 又可能误挡低相关机会。当前政策不是确认代码缺陷，先测相关性损失/资本占用。F11。

### Q48. Is correlation/cluster exposure measured using information sufficiently current for short-horizon futures trading?

UNKNOWN：组合诊断有 cluster/exposure，但未证明动态短周期相关性估计经过样本验证；不可把静态标的分组当实时相关矩阵。S08/R02。

### Q49. Can multiple positions on different symbols still create the same underlying directional beta without being recognized?

INFERENCE：不同币共同市场 beta 可叠加，OBSERVE 不约束它；需要持仓收益协方差与市场因子归因，不能仅按 symbol count 判断分散。F11。

### Q50. Does pending-entry exposure reserve capital/risk realistically before fills occur?

PROVEN：Reservation/ExecutionLease 按 margin 占用并在执行前重核 funds；真实待成交与历史UNKNOWN需分开。资金冻结正确性不能由历史 claim 数推导。S08/R02。

### Q51. Does partial fill handling reserve/release capital proportionally and safely?

PROVEN：代码有 partial fill 归因、剩余 quantity、租约释放与对账补真值；本次未制造部分成交，崩溃跨写与远端延迟组合正确性未独立证明。S09/S10。

### Q52. Are quantity rounding, minimum notional and exchange filters capable of distorting the intended risk amount enough to matter?

PROVEN：tick/step/minNotional 与最低 margin 能使小量变成更大量或不可执行；量化偏差需逐候选 rounding前后 notional、margin 比较。S08/C01。

### Q53. Are small accounts or small residual balances treated in a way that creates systematic under-sizing or no-trade behavior?

PROVEN：最低100 quote margin/200 notional 属业务下限，小余额会无候选；不是 Binance 全局最低要求。当前USDT0是路由资金事实，USDC有余额也不能绕过 privateFresh。C01/R02。

### Q54. Is there a better empirical metric than fixed position count for controlling portfolio complexity and risk?

建议使用“可核实管理工作量＋相关敞口＋流动性退出成本＋资本占用时长”，以本系统 REST/Review/对账吞吐为容量依据；仅50个槽位不足表达真实风险。F05/F07/F11。

## 杠杆

### Q55. What economic objective is current leverage selection optimizing?

PROVEN：杠杆主要用于在资金约束内构建 margin/notional 候选；未发现以实际风险调整收益或 liquidation safety 校准的目标。S08/F11。

### Q56. Is leverage fixed, model-selected, rule-selected or indirectly determined by margin constraints?

PROVEN：配置 defaultValue20，但 V397 冻结候选支持10–20选择，并非每单固定20；实际某些持仓10。必须看 TradePlan/订单链，而非设置面板单值。C01/S08/R03。

### Q57. Does leverage adapt to volatility, liquidity, expected holding time and stop/exit structure?

UNKNOWN：经济候选有 horizon 与 leverage 组合，未发现基于 MAE、流动性退出损失与无SL结构的经验证自适应规则。S07/S08。

### Q58. Can higher leverage currently increase risk without improving capital efficiency in practice?

INFERENCE：同 margin 更高杠杆扩大 notional/费用/潜在亏损；未成交或长时间人工持有时资本效率未必改善。需要全生命周期归因。F11/R03。

### Q59. Can lower leverage unnecessarily suppress valid trades because of margin reservation rules?

PROVEN：更低杠杆需更多 margin，合法资金 gate 会拒绝；是否“不必要”只能在等损失/资本约束下比较，不能为提高频率放宽真实资金校验。S08。

### Q60. Are liquidation distance and maintenance margin considered where necessary?

PROVEN：适配器读 leverageBracket 并检查 maximum；没有看到用完整分档 maintenance margin/实际清算距离约束当前候选的等风险保证。F13/F11。

### Q61. Is the leverage used in economic modeling guaranteed to match the leverage actually configured at the exchange before order submission?

PROVEN：提交前调用 setLeverage，但 POST 成功响应的实际 leverage 未与请求值核对；因此仅凭请求完成不构成端到端相等保证。F13。

### Q62. Can exchange-side leverage drift from local assumptions after restart, manual intervention or symbol-level changes?

INFERENCE：手工改杠杆/重启/外部客户端可改变 exchange 值；账户同步提供观测，但永久 bracket cache 和不核对 ACK 留下漂移风险。F13。

### Q63. Are leverage-change REST calls safely bounded and verified?

PROVEN：走受限 execution lane，校验整数和 maximum；返回正文未校验、bracket cache 无TTL，因此“ bounded 且 verified”只成立一部分。F13/S03。

### Q64. Is there historical evidence that current leverage levels improve or harm realized risk-adjusted return?

UNKNOWN：693 TradeRecord 中只有12 netPnl非空，完整分组杠杆风险收益尚未建立；不能从现存10倍/20倍比例判优劣。F10/R05。

### Q65. Which leverage-related parameter should be estimated from actual MAE/MFE distributions rather than chosen statically?

建议先估计 horizon 内 MAE高分位相对于清算缓冲、退出滑点/费用和 margin 使用；无有限止损时不能仅以 MFE 推高杠杆。F11/F10。

## TP与退出

### Q66. Is take-profit placement derived from expected edge, volatility and market structure, or primarily from fixed thresholds?

PROVEN：V397 优先 durable TradePlan 授权目标；旧/导入持仓可用结构或固定0.45% fallback。不是所有 TP 都由同一统计边际导出。S09/C01。

### Q67. Is the TP distance appropriate relative to fees, funding, spread and typical short-horizon price movement?

UNKNOWN：费用门槛有计算；funding/零滑点/统计缺口使“与实际移动兼容”未证实。需要按实际 maker/taker 和期限校验 target-hit 分布。F04/F10。

### Q68. Does the system distinguish between a high-probability small TP and a lower-probability large TP using expected value rather than raw profit target?

PROVEN：有历史 reachability 与条件净利润，但失败收益是假设、无独立 fill probability，所以不能称完整EV比较。F04。

### Q69. Are TP levels adapted after partial fills, average entry changes or changing position size?

PROVEN：TP quantity/side/position version、partial fill 与 durable mandate 都参与维护；ACK异常终态误映射可破坏保护状态。F02/S09。

### Q70. Does the current TP logic handle different volatility regimes without becoming either unreachable or economically trivial?

UNKNOWN：结构目标/候选 horizon 有动态输入，固定利润 floor 仍存在；缺按 volatility/regime 的命中、耗时和亏损分布验证。C01/F10。

### Q71. Can TP orders remain technically protected while being economically poor?

PROVEN：WARN_AND_KEEP 允许授权目标经济警告下保留；PROTECTED 表示技术覆盖，不是目标有吸引力或远端事实当前已复核。S09/F09。

### Q72. Are there situations where a position should be exited or repriced before TP because the original thesis has invalidated?

INFERENCE：论点失效、价格路径不利时可能应退出；当前四亏损bar→交人工与Review提议分别处理，不能由审计未经授权替代决策。F11/S11。

### Q73. Does Review/Primary/exit logic have enough authority separation to avoid turning advisory AI output into unsafe deterministic action?

PROVEN：Review 基于市场＋既有TradePlan，HUMAN_MANAGED 为观察，无任意Entry sizing/改计划权；退出仍需 durable mandate、JIT reduction proof。这是有效边界。S09/S11。

### Q74. Is there any path where exit review latency can materially increase realized loss?

STRONG_EVIDENCE：Review约15–32s，positions最短review间隔300s，代理劣化还能拖退出补事实；实际因此新增亏损金额UNKNOWN。R04/S11/F05。

### Q75. Are maker/taker assumptions in exit economics consistent with actual order behavior?

PROVEN：Entry GTX maker，退出收益模型配置TAKER更保守；不是据此证明真实费率一致，人工退出/重报价需用成交 maker 字段对账。C01/S09/R05。

### Q76. Does the system measure realized execution quality of TP orders versus intended economics?

PROVEN：TQ episodes 保存订单/fill/执行价/费用/路径等；全周期 canonical 净收益完整性不足，不能用覆盖不全的均值验收 TP 经济效果。F10/R05。

### Q77. Are missed TP opportunities or near-miss reversals visible in current telemetry?

PROVEN：有 path/firstFillPath/timeToPositive 等原料；最新500 episodes仅188有path，近失/反转分析必须报告覆盖、观测窗口与未成交分母。R05。

### Q78. Does trade history suggest TP should be symbol-specific, regime-specific or horizon-specific?

UNKNOWN：现有样本未完成按 symbol/regime/horizon 的合格净收益对比，不能给“应当改TP”的实证结论。F10。

### Q79. Is the current minimum net-profit requirement statistically compatible with observed win rate and holding time?

UNKNOWN：1USD/0.15% margin ROI 最低净利润可核实，兼容实际胜率/持有期尚未证明；命中率不能替代失败端大损失。C01/F04/F11。

## 亏损控制

### Q80. What is the real maximum loss mechanism for an Entry if no explicit stop-loss is used?

PROVEN：无固定价格SL；四根亏损15m闭合bar/管理deadline移交人工、保留TP，不强制平仓。真正损失上限依赖人工/交易所清算及账户保证金。F11。

### Q81. Is downside bounded by a deterministic rule, AI review, time-based exit, liquidation distance or another mechanism?

PROVEN：这些规则界定自动管理权限与交接时机，不提供有限净亏损保证；AI退出 boundedLoss 上限也只是允许动作范围。F11/S11。

### Q82. Are expected loss assumptions in the entry model consistent with actual worst adverse excursions?

PROVEN：Entry EV 将非命中收益取负 requiredNetProfit，未使用实际 MAE或最终退出分布；与可长期人工持仓的结构不相容。F04/F11。

### Q83. Can a trade with small expected profit remain open long enough to accumulate disproportionately large downside?

PROVEN：LKG 12持仓中10人工管理，AVAX SHORT约17天、浮亏943.55；这说明路径存在，不等于所有当前策略新单具有相同表现。R03。

### Q84. Are time-to-live and exit timing scientifically related to the original forecast horizon?

PROVEN：候选 horizon、pending TTL、管理deadline 是不同时钟；deadline首次fill后固定交接而非预测到期强制退出。未发现联合期限收益校准。C01/S08/S11。

### Q85. Does the system learn anything from trades that were directionally correct but executed at a poor price?

PROVEN：TQ保存理想价/成交价/事件年龄/路径，具备诊断原料；未证明根据这些结果自动更新已校准策略参数。R05/S12。

### Q86. Does it distinguish strategy error, timing error, execution error and market-regime error in postmortem data?

PROVEN：有immediateNegativeAttribution、execution/provenance等；记录覆盖及因果对照不足以可靠分离全部损失原因。F10/R05。

### Q87. Which loss-control parameter most strongly affects expected value and should be validated from historical outcomes first?

优先验证非命中/交接后损失尾部及持有时长，其次再优化最低利润或TP距离；当前EV缺失败收益，单独改胜率阈值容易误判。F04/F11。

## Binance REST/WS

### Q88. For every market/private fact used by the trading path, is the preferred source (market WS, user-data WS, REST, cache) appropriate?

PROVEN：市场WS优先，REST恢复；私有WS触发/融合并由signed account补完整资金，这是合理分工。共享quote时间戳与REST扇出仍削弱来源可信性。S02/S05/F01。

### Q89. Are any facts still polled by REST even though an authoritative fresh WS source already exists?

PROVEN：fresh quote/depth 有WS短路；失效时 getQuote 同时要24hr/premium/book，snapshot再要depth与多周期K线；可重复补取得到一部分但仍缺另一部分的事实。F05。

### Q90. Are any critical facts trusted from WS without sufficient sequence/freshness/identity validation?

PROVEN：bid/ask新消息可以让旧last/mark共享fresh时间；报价未拒绝乱序patch。depth/kline有部分序列校验，不能替quote担保。F01/S05。

### Q91. Can REST fallback overwrite newer WS truth with an older snapshot?

PROVEN：quote patch无单字段水位，REST seed/旧事件存在覆盖路径；离线已证旧WS报价覆盖新报价。真实REST→WS回退次数未计量。F01/S05。

### Q92. Can WS reconnect/replay ordering cause state regression?

PROVEN：较旧bookTicker可覆盖新bid/ask；private WS另有generation处理，不能笼统说全部流都有同一缺陷。F01/S06。

### Q93. Are event timestamps, exchange update times and local receive times distinguished correctly?

PROVEN：quote.ts及部分kline receivedAt采用exchange E，另用Date.now；单字段exchange/update/receive三个时间并未普遍分离。S05/F01。

### Q94. Is clock skew handled consistently for signed requests and freshness judgments?

PROVEN：signed serverTime offset/重试存在；报价future/fieldfresh判断与签名时钟不是统一协议。recvWindow始终60000也掩盖配置含义。F14/S06。

### Q95. Are all Binance REST endpoints classified correctly as critical, recovery, advisory or historical?

PROVEN：premiumIndex 在incident层一律advisory，但getQuote Promise.all将它作必需；source BACKGROUND实际落MARKET_PUBLIC lane。F06。

### Q96. Can an advisory endpoint still indirectly block entry via a derived readiness object?

PROVEN：premiumIndex失败可让整个getQuote拒绝，间接阻塞snapshot，而incident分类将其排除。optional derivatives修复未覆盖这个调用上下文。F06。

### Q97. Are request weights and endpoint-specific limits represented accurately enough for normal latency and burst recovery?

UNKNOWN：本轮未逐endpoint/每档limit完成官方权重表核对；已证明本地槽位排队在weight低时饱和，不能将其误判交易所限频。F05/S03。

### Q98. Can retry behavior create synchronized bursts after network recovery?

INFERENCE：共享固定恢复间隔/批量hydration可在网络恢复后同时重新请求；队列、缓存、单飞已有缓解，真实burst需按route/generation时间图验证。S03/S05。

### Q99. Are Retry-After and exchange ban windows respected across all callers?

PROVEN：transport/budget有429/418/retryAfter/blockedUntil处理；未证明所有异常格式与路由热切换场景均正确。当前实例没有相应418/429证据。R03/S03。

### Q100. Are transport timeout, admission timeout, queue timeout and exchange processing timeout distinguishable in telemetry?

PROVEN：queue timeout含requestId/endpoint/source；private同步又归类TIMEOUT。端到端queue/DNS/SOCKS/TLS/firstByte/socket/EventLoop分解不足，不能归因所有timeout给Binance。F05/F09。

### Q101. Can one physical timeout still appear as multiple incidents/counters elsewhere in the system?

PROVEN：HTTP route、private health、任务错误可能重复描述同一物理失败；恢复事件历史重复发布又放大计数。F03/F08。

### Q102. Are exact-order queries deduplicated across all callers, processes and timing windows where they need to be?

PROVEN：adapter内同一key singleflight与FOUND1.5s/ABSENT15s缓存有效；不是跨adapter/进程/客户端ID与exchangeID别名的全局去重。S06/F15。

### Q103. Is a 15-second ABSENT cache appropriate for every exact-order recovery context, or are there contexts with different correctness requirements?

INFERENCE：ABSENT只来自明确不存在码，15s避免风暴；传播延迟/旧历史不可查不同，缓存必须配合UNKNOWN与禁重复提交，不能把ABSENT直接当安全释放证据。S06/S10。

### Q104. Can Binance return states that current order-status mapping mishandles?

PROVEN：TP异常恢复FOUND忽略CANCELED/EXPIRED/REJECTED，按executedQty映成WORKING或PARTIAL，这是明确终态映射缺陷。F02。

### Q105. Are partial fills and userTrades retrieval robust to REST lag after exact-order truth?

PROVEN：exact订单成交量可先独立权威确认，userTrades失败后补详单，不制造fills；经济合格性可能长期缺手续费/归属，应保持UNKNOWN。S06/F10。

### Q106. Can user-data WS temporarily miss an event without the system detecting the gap?

INFERENCE：user-data delta不是完整状态，重连可能丢事件，账户poll/reconciliation是必要兜底；没看到能凭WS每条顺序证明“无间隙”的协议。S06。

### Q107. Is listen-key lifecycle/reconnect behavior sufficient under long-running operation?

PROVEN：listen-key建/keepalive/reconnect存在；长时网络劣化下keepalive与私有真值恢复未通过本次soak验证。S06/R01。

### Q108. Can private WS reconnect produce a period where the account looks READY while order state is incomplete?

INFERENCE：账户与order scan分别更新，READY不是全订单身份闭合证明；本实例也有account失效而TP本地protected的时段。S06/S10/F09。

### Q109. Is market WS continuity validation strong enough for kline/depth streams under reconnect?

PROVEN：闭合bar、最新closed、间隙/深度更新检测有专门实现；reachability读取cachedCandles另缺逐时间连续检查，不能把总体技术ready扩展为所有统计输入可靠。F04/S05。

### Q110. Are depth/book facts locally consistent enough for maker-price calculations?

PROVEN：partialdepth与bookTicker来自不同消息，时刻可能不同；当前价计算有tick和maker JIT，仍缺单字段水位与统一盘口一致性。F01/S05/S08。

### Q111. Which Binance communication path is currently most likely to become a hidden latency amplifier?

STRONG_EVIDENCE：WS劣化后的snapshot REST扇出与historical exact核查共享budget，最易把局部缺口放大成private真值缺失。F05/F07。

## 代理

### Q112. Is proxy health evaluated by real Binance route behavior or by generic connectivity?

PROVEN：transport记录实际Binance routeIdentity错误；代理测试不是完整signed/write通路证明。活动标记只是选择状态。R03/S03/S06。

### Q113. Can a proxy remain marked ACTIVE while its Binance latency/error profile has degraded materially?

PROVEN：route proxy-05d851d4af74仍被使用且有queue/Proxy connection timeout；ACTIVE不能等同Binance可用。R03。

### Q114. Is active-proxy hot switching race-safe for in-flight REST and WS connections?

PROVEN：applyRoute替换agent/budget，未销毁旧agent；在途callback通过可变this.budget写观察，存在跨generation归因/资源风险，未发现本次发生切换。F14。

### Q115. What happens to existing WS sessions after active proxy changes?

PROVEN：重配置会重建相关stream连接；旧REST仍可能在途。需要generation隔离与旧session释放证据，不能仅以新socket创建判旧链路结束。S05/S06/F14。

### Q116. Can different subsystems temporarily use different proxy generations/configurations?

INFERENCE：各adapter/stream重配非单一原子事务，可出现短暂旧/新route混用；真正使用路径需请求generation关联验证。F14。

### Q117. Is DNS resolution behavior consistent with the intended SOCKS5H semantics?

UNKNOWN：使用SocksProxyAgent；socks5与socks5h行为取决实际URL scheme/库版本。当前输出不公开代理凭据，本轮没有DNS抓包或代理端日志。S03。

### Q118. Are proxy test results representative of the actual signed/private/write path?

PROVEN：公共connectivity测试不能证明signed时钟、credential、account或reduce/write可行；本轮未发送测试订单或主动exchange探测。R01/S06。

### Q119. Could normal Singapore-route latency still trigger any false operational gate not covered by current tests?

PROVEN：private单次timeout即可NET002是逻辑反例；普通地区延迟是否触发本地queue实害需路由分段时延。不能把“新加坡”作为免责或根因。F03/F05。

### Q120. Is there enough telemetry to distinguish exchange slowness, proxy slowness, local queue pressure and local CPU/event-loop delay?

PROVEN：request/endpoint/lane/route与queue counters可区分一部分；缺DNS、SOCKS、TLS、first-byte、event-loop同钟记录，外部根因仍UNKNOWN。F05/F09。

## 调度/并发

### Q121. Which scheduled job has the highest worst-case duration relative to its interval?

STRONG_EVIDENCE：private同步观测61492ms，15s对账调度在历史证据中过长；新30s remoteAuditDeadline只是软预算，初始positions/orders和manual/TP阶段不受硬总时限。F07/R02。

### Q122. Can any recurring task overlap with itself?

PROVEN：every默认按任务防重入，部分任务显式allowOverlap/fire-and-forget；不能说全局完全禁止overlap。需分别看funding/自动sync的inFlight保护。S13。

### Q123. Are overlapping tasks prevented by one global mutex where a narrower lock would be safer/faster?

PROVEN：reconciliation有自身running，snapshot按symbol单飞，private同步单飞；不是全系统一把mutex。进一步拆锁须保持共享资金租约与订单身份原子性。S05/S10/S13。

### Q124. Can one slow reconciliation/audit task starve market processing, order management or AI dispatch?

STRONG_EVIDENCE：异步网络等待不直接锁事件循环，但占REST槽位、running周期和同步SQLite/序列化会间接挤出其它任务。F05/F07/F15。

### Q125. Are all async fire-and-forget tasks bounded and observable?

UNKNOWN：关键入口有任务失败事件/单飞保护；未完成所有void promise的形式化覆盖证明，不能承诺所有旁路均有统一timeout/取消。S13。

### Q126. Can rejected promises disappear without affecting health state?

INFERENCE：任务级catch可能记录错误而不使service OFFLINE，旁路失败也可不影响execution；正确性依赖scope，必须看具体purpose，不应所有错误全局封锁。S13/F09。

### Q127. Are queues bounded by count, time and memory?

PROVEN：REST queue上限512、lane TTL、ledger有限，runtimeWriteBuffer5000；exactOrderCache及部分实体Map无按过期主动删除，socket body也无显式大小上限。F15/S03/S14。

### Q128. Can AI queue backlog create stale decisions that are still accepted later?

PROVEN：冻结snapshot与JIT存在age/physical检查；共享quote时间戳使部分字段年龄漏检。长AI延迟仍可能使决策经济论点过时但物理可执行。F01/F10/S08。

### Q129. Is model capacity reservation fair between live Entry work and advisory Review/Research work?

PROVEN：模型按resource分配与任务预算分开；advisory CPU/SQLite/REST并未因此隔离。实际公平性需队列wait/run/cancel分位，不能靠GPU分开推定。S11/S13。

### Q130. Can Review/Research consume CPU, memory, network or event-loop capacity even when GPU resources are separate?

PROVEN：Review/Research会读取packet、日志、SQLite与网络，独立GPU仍共享Engine事件循环/内存和REST。F15/S11。

### Q131. Are long synchronous SQLite or serialization operations possible on latency-sensitive paths?

PROVEN：DatabaseSync、JSON序列化、retention/checkpoint在进程内同步；已有约585ms checkpoint诊断，可能推高时延，但不能据此归因native crash。F15/S14。

### Q132. Does the system have any unbounded Map/array/cache keyed by symbols/orders/events that can grow indefinitely?

PROVEN：exactOrderCache无expiry删除，tradePlans/allocationPlans等Map随历史恢复增长；DB retention不等于内存retention。实际长时泄漏幅度UNKNOWN。F15。

### Q133. Are cleanup policies correct after restart and long uptime?

PROVEN：日志/存储有保留上限与启动恢复；旧cache/跨store实体/schema恢复仍需长时验证。当前原生崩溃未关闭。S14/H01。

### Q134. What concurrency bug is most likely to escape current deterministic tests?

INFERENCE：在途route重配、旧WS消息与新报价混合、ACK丢失时TP终态恢复最可能逃过固定顺序mock。F01/F02/F14。

## 对账与UNKNOWN

### Q135. What exact conditions keep reconciliation DEGRADED today?

PROVEN：历史UNKNOWN289（entry287/manual2），no-risk证明0、active claims285；另有行情/账户退化。aggregate不是289当前exchange挂单。R01/R02/F07。

### Q136. Which historical UNKNOWN claims are genuinely unresolved exchange risk versus durable historical uncertainty?

UNKNOWN：没有逐历史clientID完整exchange归档无法区分每条真实旧风险与永久缺史；当前snapshot零新Entry也不足替每条身份释放。R02/S10。

### Q137. Can current reconciliation ever prove old UNKNOWN identities safe without unbounded historical REST work?

PROVEN：有多来源no-risk证据与TTL/tier、每轮限额；交换所旧订单查询可无记录，因此单靠反复exact不能保证收敛。F07/S10。

### Q138. Is remote-audit budgeting sufficient to make progress over time, or can deferred items starve forever?

STRONG_EVIDENCE：当前204失败集中固定三个ID，预算有限但无公平游标/失败退避；后续项存在饥饿路径。F07。

### Q139. Can one permanently unprovable historical row keep a global degraded state indefinitely?

PROVEN：保留未证风险可使DEGRADED长期存在；这是诚实状态，不应伪造证明消掉它。问题在远端工作公平性与历史/当前作用域。F07/F09。

### Q140. Does DEGRADED have any current effect on Entry, operator behavior or resource usage?

PROVEN：funds-only下不自动作portfolio veto，但增加操作负担、REST核查和解释成本；private事实真正失效仍阻止Entry。R02/F07。

### Q141. Is there a distinction between "historical unresolved evidence" and "current unsafe execution state" everywhere it matters?

PROVEN：scoped字段与NOT_APPLICABLE已区分；pendingEntries兼容值、TP保护与service ready仍易误解，不是全面一致。F09。

### Q142. Can risk-bearing UNKNOWN rows ever be released without authoritative evidence?

PROVEN：不能凭超时/ABSENT一次释放所有未知风险；源码保持风险并要求组合权威证明。审计没有清理/删除历史。S10。

### Q143. Can authoritative no-risk evidence expire too quickly or too slowly?

PROVEN：no-risk TTL300s和tier5/15/30min存在；对永久identity tombstone与易变position事实混用同TTL是否合理需逐proofClass验证。S10/R01。

### Q144. Are reconciliation proofs durable across restart?

PROVEN：订单proof/identity/runtime持久化存在；跨store snapshot明确BEST_EFFORT，不是全局原子快照，重启恢复组合需崩溃回放。S10/S14。

### Q145. Is there a safe convergence strategy for historical UNKNOWN that does not delete history or fabricate certainty?

建议：保留UNKNOWN/tombstone，按活跃风险优先＋公平游标＋来源完整性＋可重试/永久缺史分类，统计验证覆盖；对永久缺史标不可证明，而非多查就变确定。F07。

### Q146. Which metrics would show whether reconciliation is actually converging during a 24-hour run?

需看唯一身份覆盖率、proof有效数/过期数、各tier/deferred年龄、最老待审项、REST花费与每轮duration；UNKNOWN总数单独不足证明收敛。F07/R01。

## SQLite/存储

### Q147. Which writes occur on the hottest runtime paths?

PROVEN：reservation/intent/order身份、fills、ownership/outbox、runtime checkpoint、TQ事件均写存储；不是只有低频settings更新。S08/S14。

### Q148. Can SQLite locking/blocking delay trading-sensitive tasks?

PROVEN：DatabaseSync/WAL/busy250ms仍同步等待，checkpoint/retention和JSON序列化能拖事件循环；当前没有长时wait分位足以量化影响。F15。

### Q149. Are transaction boundaries correct for order identity, reservation, position and provenance updates?

PROVEN：单store journal事务与状态防重存在；order/reservation/runtime/ownership/TQ不是一笔跨库事务，不能称全链原子。S08/S09/S14。

### Q150. Can a crash between two durable writes create an impossible but recoverable state?

INFERENCE：journal已prepare但runtime未反映、order已提交但fill/provenance未持久化等可发生；稳定clientID/UNKNOWN补真值是正确恢复手段，本次未模拟crash。S09/S14。

### Q151. Which state transitions are not atomic but should be?

潜在风险：跨库ownership/outbox、执行事实与runtime projection的组合更新需可回放一致性；不是未经设计就要求一个巨大事务。S14。

### Q152. Are WAL checkpoint/retention policies safe under sustained write load?

PROVEN：WAL/同步FULL、retention、buffer上限提供保护；长期写负载和实际空闲磁盘仍需监控，当前启动健康值不能验收24h。S14/R01。

### Q153. Could bounded logs still fill disk faster than cleanup under an abnormal loop?

STRONG_EVIDENCE：恢复事件5458/激活123的放大可使有界日志更快轮换、丢必要调查窗口；磁盘填满速度未测。F08/F15。

### Q154. Are low-disk protections early enough to preserve SQLite integrity?

PROVEN：启动/容量guard存在；运行期容量边界不等价物理空闲磁盘充足。需live free bytes/WAL growth/写失败预警证据。S14/H02。

### Q155. Can failed telemetry/log writes still cascade into runtime instability?

PROVEN：buffer flush错误/overflow有failclosed健康处理；第一失败阻住后续队列与错误事件放大仍有级联可能。当前buffer pending0/failure0不能排除将来。S14/F08。

### Q156. Are there durable records whose schema evolution can silently reinterpret old data?

PROVEN：历史schema/provenance存在降级/迁移；历史invalid intent修复证据说明真实资料并非测试干净样本。不能无验证把旧missing字段当新版false/zero。H02/S14。

### Q157. Is startup migration safe with large real historical data?

UNKNOWN：当前启动已完成，历史迁移测试存在；最大实库迁移耗时/内存/断电恢复未由本次验证。禁止为审计重启。R01/H02。

### Q158. Which persistence path is most likely to contribute to a native crash or process memory pressure?

UNKNOWN：native SQLite大序列化/checkpoint、WS/TLS/SOCKS缓冲均有可能；旧0xC0000409没有native dump，本轮不能指定SQLite为根因。F15/H01。

## 进程稳定性

### Q159. Which remaining code paths invoke native Node/SQLite/WebSocket/crypto/compression functionality heavily enough to be plausible contributors to process-level failure?

PROVEN：DatabaseSync/backup、WS、TLS/SOCKS、crypto签名、序列化热点均调用native组件；只是候选贡献者，不是已确认crash归因。H01/S14。

### Q160. Is there any evidence of memory growth over long uptime that unit tests cannot reveal?

STRONG_EVIDENCE：历史Windows低虚拟内存事件与AI context上升记录存在；另有未匹配内存事件的crash，当前单实例短窗口无8–24h斜率证明。H01/H02。

### Q161. Are buffers, sockets, timers, event listeners and intervals always released on reconnect/reload/shutdown?

PROVEN：stream有close/reconnect管理，但transport换agent不destroy、exactcache无清理；不满足所有资源生命周期闭合的强保证。F14/F15。

### Q162. Can repeated WS reconnects leak listeners or sockets?

INFERENCE：旧socket/generation重连可能保留资源或旧消息；目前仅静态路径，需activeHandles/sockets/listeners与reconnect次数长时曲线。F14/F15。

### Q163. Can repeated AI requests leak request state or large prompt/result objects?

UNKNOWN：AI context与runtime archive有上限，部分实体历史Map增长；需每run retained bytes/heap与GC曲线验证，不能把历史commit改善当当前没有泄漏。H02/F15。

### Q164. Can reconciliation retain large remote result sets longer than necessary?

PROVEN：对账加载并映射runtime全量entryOrders、executionFills等，数据规模越大CPU/临时对象越多；remote实体生命周期是否泄漏未实测。S10/F15。

### Q165. Are foreground observation logs sufficient to identify the last successful subsystem before a future native crash?

PROVEN：foreground phase/lastSuccessfulTask增强了最后成功步骤可见性；日志最后一行不证明faulting native模块，仍需dump、栈、OS资源记录。H01/S13。

### Q166. Are health checks sensitive to event-loop stalls, memory pressure and scheduler lag, or only logical subsystem states?

PROVEN：heartbeat/tick/内存等部分可见；/health ready依然允许DEGRADED，数据库checkedAt可为启动缓存，不能替代实时event-loop与durability验证。F09/R01。

### Q167. What 6-hour, 12-hour and 24-hour runtime metrics should be compared to detect gradual degradation before a crash?

建议按6/12/24h比较：RSS/heap/external/commit、event-loop p95/p99、DB/WAL/空闲盘、任务duration、REST各lane年龄/失败率、WS重连、唯一对账进展与经济覆盖；同时固定instance/route。F15/F05/F07。

## AI决策

### Q168. Is Primary provided with the minimum sufficient facts, or is prompt context unnecessarily large/noisy?

PROVEN：Primary含多周期技术、冻结候选和经济/执行事实；历史64K→32K修复说明上下文成本实际相关。当前约101s延迟，最小充分packet尚未通过消融验证。S08/H02/R04。

### Q169. Are any important execution/economic facts omitted from Primary input?

PROVEN：有成本/资金/quantity/target/horizon，但EV缺真实失败收益/排队成交概率，funding/FX可能UNPROVEN；字段存在不等于事实已证。F04/S07。

### Q170. Can stale facts remain in a Primary packet after newer market state arrives?

PROVEN：packet冻结后新行情不会改旧观点，JIT只重核物理事实；共享quote freshness使旧字段也可能看似fresh。是否经济观点过期需要路径回放。F01/S08。

### Q171. Is the frozen-candidate snapshot internally time-consistent?

PROVEN：有factVersion/envelopeExpiresAt，不等于多WS字段与各timeframe原子同刻；时间水位不完整是明确限制。F01/S05/S08。

### Q172. Does Primary output schema allow ambiguous decisions that deterministic code interprets incorrectly?

PROVEN：schema/candidateId/计划校验限制自由输出，协议失败确实被拒；旧schema历史与缺字段回填不能保证全部语义无歧义。S08/H02/R04。

### Q173. Are model confidence values used as if they were calibrated probabilities?

PROVEN：经济字段明确modelConfidenceIsAuthority=false，没有将模型confidence直接当资金/概率权威；reachProbability的VERIFIED标签反而缺校准。S07/F04。

### Q174. Has confidence calibration ever been validated against realized outcomes?

UNKNOWN：没有检出的当前instance confidence可靠度/ECE/Brier与实现净收益联合校准报告；不能把confidence分数当命中概率。R05。

### Q175. Can prompt wording systematically bias toward PLACE, WAIT or REJECT?

STRONG_EVIDENCE：过去24h256完成Primary全PLACE，不能忽略选择/prompt偏置假设；输入已被筛选也能产生同结果，需含WAIT/REJECT可能性的固定packet盲回放。R04。

### Q176. Are there duplicated instructions that reduce model compliance or consume context without adding information?

INFERENCE：系统政策、schema与候选字段重复可能增加token，尚未做token-by-section/消融；不能直接删除安全合同来缩短时延。S08/H02。

### Q177. Does Primary see enough counter-evidence to avoid confirmation bias?

UNKNOWN：多周期与历史/订单事实提供反证材料，但风险OBSERVE和候选供应先筛选可能造成偏置；需packet内counter-evidence与输出引用对照。S08/R04。

### Q178. Does Review add unique information or mostly repeat Primary reasoning?

PROVEN：Review面向pending/持仓市场＋已有Plan，任务不同于EntryPrimary；实测有CANCEL/HANDOFF等输出，增量收益仍未知。S11/R04。

### Q179. Is Research fed into decisions at a horizon compatible with this trading system?

INFERENCE：Research可作异步事件/行情背景，长研究horizon不能自动转为短线Entry veto；当前事件TTL和实际消费年龄需共同验证。S11/C01。

### Q180. Can external-event research become stale before it is consumed?

PROVEN：研究/外部事件有时间/TTL语义，但队列等待＋Primary约101s会增加消费年龄；当前具体失效消费次数UNKNOWN。S11/R04。

### Q181. Are model failures/circuit-breakers/cooldowns tuned to actual model latency and reliability?

STRONG_EVIDENCE：Primary平均101s已接近120s timeout；参数未见基于实测延迟分布自校准。提高timeout可能加重观点老化，先看p95与取消阶段。C01/R04。

### Q182. Can model-side variability reduce reproducibility enough to complicate postmortem analysis?

PROVEN：packet/output/archive/runId允许postmortem；随机模型输出仍会使同packet决策变化，需固定参数多次回放估分歧，不以单次模型回答证明策略。S08/R05。

### Q183. Which parts of trading quality are currently delegated to AI but could be measured deterministically?

可确定性量化：盘口价差/深度、fill率/延迟、成交maker率、实际费/资金费、路径MAE/MFE、目标到达与资本占用；模型叙述不能替代这些测量。F10。

### Q184. Which deterministic thresholds are currently hard-coded but would be better treated as empirically calibrated priors?

PROVEN：利润floor、margin100、90s near-market、5bps距离、20s review、loss4bar、cap50等主要静态；可用完整样本估计先验，身份/资金合法性不得统计优化掉。C01/F10。

## Review/Research

### Q185. Are Review and Research doing work that changes measurable post-trade or risk outcomes?

UNKNOWN：实际Review过去24h132次（含12无decision），证明有工作；不能证明减损或增加收益。需proposal→accepted/action→同期对照的完整链。R04/S11。

### Q186. Is their utilization low because there is genuinely no useful work or because routing/scheduling is too restrictive?

PROVEN：并非Review长期完全闲置；最短300s、按plan预算/failure预算及人工managed仅观察可限制利用率。Research当前分配效果需fresh queue证据。S11/R04。

### Q187. Are there bounded asynchronous tasks that could increase decision quality without becoming Entry vetoes?

建议只读shadow做成交概率/费用校准、拥塞归因、missed-target分析，保留预算/TTL/独立优先级，提供建议而不成为新的Entry veto。F10/F06。

### Q188. Is pending-entry review early enough to be useful but late enough to avoid noise?

UNKNOWN：pending20s和near-market2s可核实，相对90s订单TTL是否合适需proposal到取消/成交的年龄与收益路径；不能单凭秒数判早晚。C01/S11。

### Q189. Does position review occur at intervals compatible with actual position horizons?

PROVEN：positionReview最小300s与管理horizon相关但不同；若短15min观点遇急波动可反应偏慢，实际伤害需反事实退出价格。S11/F11。

### Q190. Can Review identify deteriorating execution quality before deterministic rules notice?

INFERENCE：Review可以提出CANCEL/REDUCE/HANDOFF，独立盘口/市场事实可能较deterministic loss4bar更早；目前未证明其预测精度和行动收益。R04/S11。

### Q191. Does Research have clear freshness/TTL semantics?

PROVEN：external事件/Research有时间和TTL合同；TTL合格不保证内容适用当前horizon，应报告生成/排队/消费age及已过期丢弃。S11/C01。

### Q192. Are AI resource queues and latency visible enough to distinguish idle from blocked?

PROVEN：有task/resource/queue/lastRun诊断，/brain小响应不足代表全调度；需等待年龄分位、预算耗尽和明确idleReason才能判断idle与blocked。R02/S11。

### Q193. Can Review/Research failures ever indirectly suppress Primary throughput?

INFERENCE：隔离GPU不隔离CPU/DB/REST；失败重试/大packet可占共享资源。不能把所有Review故障升级全局Primary veto。S11/F15。

### Q194. Is GPU/model resource assignment optimal for task complexity, latency and context size?

UNKNOWN：没有同packet任务质量×GPU×context×延迟的对比基准；当前101s Primary与15–32sReview值得测量，但不能未经授权换模型。R04/H02。

## 经济有效性

### Q195. Are expected net profit calculations dimensionally and economically correct across all quote assets and leverage levels?

PROVEN：手续费/notional/margin公式单位基本一致；quoteUSD换算/funding可标UNPROVEN。最大问题是条件TP收益被扩展成VERIFIED-horizon-EV，非纯单位错误。F04/S07。

### Q196. Are fees modeled using the actual maker/taker path likely for each order type?

PROVEN：固定entry fee .0004、exitTAKER .0004、maker .0002配置存在；GTX实际maker与账户VIP/quote费率须以fills核对，不能假定配置就是实际费。C01/R05。

### Q197. Is funding relevant at the actual holding horizons, and if so is it modeled consistently?

PROVEN：deadline交接后仍持仓，资金费可能跨多个结算，模型只标fundingEstimate null/UNPROVEN；短预测horizon不能为长实际持仓免除funding。F11/F04。

### Q198. Is slippage modeled where a maker order may become a taker or require repricing?

PROVEN：slippageBufferPct=0；Entry GTX能避免直接taker入场却不能避免机会成本、排队、重报价及退出冲击。当前零值不是实测零滑点。C01/S07。

### Q199. Is fill probability explicitly modeled or only implied by reachability?

PROVEN：reachability是历史高/低触及概率，未显式估订单队列成交概率；touch≠fill，也未建实际Entry价条件概率。F04。

### Q200. Is reachability calibrated against actual filled/not-filled historical entries?

UNKNOWN：已有机会/订单/成交原料，但未找到reachability对filled/not-filled的当前校准；断续bar计算已证可能误标READY。F04/R05。

### Q201. Are opportunity cost and queue waiting time part of the economic decision?

PROVEN：TTL与队列计时用于工程控制，未并入候选经济收益函数；Primary约101s与REST排队可实质消耗edge。F10/R04。

### Q202. Can a trade with positive modeled expected value still be inferior to WAIT because capital is scarce?

INFERENCE：可能；候选收益缺失败损失和资金占用效用，当前可用funds gate不负责比较“等待更优机会”。不能用PLACE频率证明优于WAIT。F04/S08。

### Q203. Does the system compare simultaneous candidate expected values on a common risk-adjusted basis?

PROVEN：同一基本成本单位可比较，但没有统一真实loss/holdingtime/correlation的risk-adjusted EV；rank score不是该指标。S07/F11。

### Q204. Are expected profit and risk estimates calibrated per symbol/regime or globally?

PROVEN：按symbol/horizon历史range计算，fee/floor等共享；不存在已验证的逐regime风险/净收益概率模型。S07/C01。

### Q205. What historical sample size is needed before changing any threshold scientifically?

无法给统一N：滚动样本重叠、symbol/regime分层、尾部与未成交选择偏差决定有效样本量；应先定义最小可检测效应/置信区间与独立out-of-sample，不把minSamples30当充分性。F04/F10。

### Q206. Which parameters can be estimated from existing data now, and which currently lack enough observations?

现在可估request/AI延迟、order/fill数量和部分maker/path；全成本合格净收益、长期交接尾部、WAIT对照和confidence校准仍缺完整链接/覆盖。R04/R05/F10。

### Q207. Are backfilled/historical metrics subject to selection bias because only executed trades are observed?

PROVEN：不止成交交易，保存351020opportunities/2486101observations；依然有candidate预筛、无fill及有限观察窗口选择偏差，不能只看693TradeRecord。R05。

### Q208. Does the system record rejected/waited candidate outcomes well enough to estimate missed-opportunity cost?

PROVEN：有机会轨迹、collector、Primary links，可做部分shadow；24h完成Primary全PLACE且canonical缺口大，可靠WAIT/REJECT金额损失尚未可直接计算。R04/R05/F10。

### Q209. Can the current data distinguish whether low profitability comes from selection, entry timing, sizing, leverage, TP, exits or execution friction?

PROVEN：多表有plan/order/fill/path/ownership原料；当前连接/economicEligibility不完整，无法可靠完整因果拆分全部693交易。F10。

## 指标

### Q210. Which key business outcome is currently impossible to calculate from stored data?

UNKNOWN：代表性全策略、全成本、含人工尾部与未成交机会成本的风险调整净收益目前不能可靠给出；latest500episode canonical合格0/500说明缺口，非系统没有任何收益数据。F10。

### Q211. Can the system compute per-entry expected-vs-realized edge?

部分可以：需join frozen candidate/TradePlan→identity→fills→canonical trade；当前TradeRecord预计收益字段缺失，TQ大部分未闭合，必须报告paired覆盖。R05/F10。

### Q212. Can it compute fill latency and fill probability by symbol, volatility and distance from market?

部分可以：order/fill/opportunity时间/价格具备原料，须排除unknown/canceled和观察截尾、按regime分母；本次未完成全库校准。R05。

### Q213. Can it compute maker/taker realization rate?

部分可以：fills maker字段/commission已存；GTX声明不是实际maker证据。缺filled事实的episodes不能计入分母。S06/R05。

### Q214. Can it compute MAE/MFE for each position?

部分可以：TQ path/firstFillPath具备价格轨迹，latest500仅188有path；TradeRecord mae/mfe空不等于其它表无轨迹，需完整时间覆盖才可算每仓。R05。

### Q215. Can it compute expected-vs-realized holding horizon?

部分可以：TradePlan horizon/deadline与firstFill/closed可join；大量INCOMPLETE/OPEN与人工接管需右截尾，不直接求均值。R05/F11。

### Q216. Can it compute TP reach probability and time-to-TP?

部分可以：closed bars/路径与target可算触及/耗时，touch与makerfill应分开；断续历史与missingpath需显式unknown。F04/R05。

### Q217. Can it compute opportunity loss from WAIT/REJECT decisions?

UNKNOWN：opportunity数据提供基础，但WAIT/REJECT对照、队列与资金约束反事实没有完整校准；不能按之后上涨金额直接算可赚利润。R04/R05。

### Q218. Can it attribute a losing trade to model selection, market regime, execution or exit?

部分诊断可以：identity/执行摩擦/即时负收益归因可分；model vs regime vs exit 因果还需条件化对照，不用自然语言标签当证据。R05/F10。

### Q219. Are operational incidents correlated with trading outcomes?

可以join部分：requestId/instance/time/order链已有；incident重复与不同scope不能当独立事故，先去重为物理episode。F03/F08/R03。

### Q220. Are AI latency and network latency correlated with missed entries?

可研究未验证：join packet→decision→queue→submit→fill与机会path，按network/AI健康分层；当前101s与queue压力只是线索。R03/R04。

### Q221. Can the dashboard expose enough truth to diagnose low entry frequency without reading logs?

PROVEN：pipeline有authoritativeBlocker/heartbeat/隔离候选、资金route，能够解释本次低频；analysis旧readiness、marketcount、pending48等仍误导。F09/R02。

### Q222. Which five metrics would most improve future scientific tuning of entry frequency, leverage, size and TP?

最有用五项：全成本合格pair期望vs实绩；未成交/拒绝候选反事实收益；horizon内及交接后MAE尾部；端到端决策/网络年龄→fill率；收益÷margin占用时间。都必须附完整分母。F10/F11。

### Q223. Which existing metrics are easy to misinterpret or currently lack a clear denominator?

PROVEN：ready=true、TP PROTECTED、pendingEntries48、AVAILABLE/usedWeight54、recovered5458、VERIFIED-EV各有不同或失真分母/时效，不能互相替代验收。F04/F05/F08/F09。

## 测试与现实

### Q224. Which high-value behaviors are only unit-tested with mocks?

PROVEN：mock交易所ACK/exactQuery/时间/WS、syntheticbars、固定预算pump测试无法覆盖真实Socks握手、乱序、多库崩溃和身份缺史。T01/S09/S10。

### Q225. Which tests assert implementation details rather than economic/runtime invariants?

INFERENCE：断言候选字段有值/VERIFIED、exact调用次数少、任务健康字符串，不保证实际EV/公平覆盖/终态正确；本轮反例显示这些业务不变量未封闭。T01/F02/F04/F07。

### Q226. Which tests could stay green while a real Binance behavior changes?

PROVEN：端点状态/费率/limit/历史保留变化会让mock仍绿；必须绑定官方契约与真实只读抓取fixture，不能以本次历史测试数替代。S06/S03/W01。

### Q227. Which tests could stay green while a long-running memory/resource leak exists?

PROVEN：短单测不能检测agent/exactcache/entityMap随uniqueID增长，也不能证明8–24h无nativefail。F14/F15/H01。

### Q228. Which tests could stay green while scheduler latency grows from seconds to minutes?

PROVEN：伪时钟/promise即时完成不含proxy handshake、DatabaseSync/大JSON/GC等尾延迟，30ssoft预算测试也不保证总duration。F07/F15。

### Q229. Which tests could stay green while trade frequency collapses?

PROVEN：mock市场fresh/账户ready/模型瞬返时可通过；实际privateUnavailable、pool0ready、101sPrimary会令频率下降。R02/R04。

### Q230. Which tests could stay green while trading quality deteriorates?

PROVEN：身份/安全和最低利润断言可全绿，失败收益/资金费/人工长期尾部仍使策略亏损；软件通过不等于经济成立。F04/F11。

### Q231. Which tests rely on synthetic market data that is too clean compared with Binance reality?

PROVEN：连续闭合bars、同刻完整quotes、无重连乱序是过于干净的样本；离线断续bars/字段过期反例已暴露缺口。T01/F01/F04。

### Q232. What read-only shadow/replay tests would expose hidden issues without submitting orders?

建议只读回放：按真实消息时间重排WS/REST、单字段超龄；private一次timeout/连续timeout分开；TP ACK丢失后各种终态；对账前三条失败持续轮次；全成本shadow与覆盖断言。T01。

### Q233. What production-like TESTNET experiment would have the highest information value with the lowest execution risk?

最低风险是保持现有运行不干预，采集24h只读route分段延迟/队列/逐字段age/决策链，并离线shadow替代fallback/lane/公平队列；无须造单或改参数。F05/F07/F10。

## 参数科学

### Q234. Which current thresholds appear to be engineering defaults rather than empirically calibrated trading parameters?

PROVEN：30samples/120lookback、100margin、5bps/90s、profit1/ROI.15%、50slots、4lossbars等可核实但缺校准推导；法律/交易所合法性不是可优化默认值。C01/S07。

### Q235. Which parameters interact strongly enough that tuning them one at a time would be misleading?

强交互：杠杆×margin×notional×费用；TP×失败损失×horizon；pool×AI latency×TTL；REST concurrency×fallback fanout×recoveryinterval。单项调优可能把成本移到另一层。F04/F05/F11。

### Q236. Which parameters should be symbol-specific?

候选可测后分symbol：tick/step/filters、深度/价差/实际费率、fill概率/距离、MAE/目标触及时长；不是给每币随意造阈值。S07/S08/R05。

### Q237. Which should be volatility/regime-specific?

可测后分regime：波动/MAE缓冲、目标跨度/管理期限、排队fill先验与机会价值；目前固定minSamples与近市场距离不足表达这些。F04/F10。

### Q238. Which should be account-size-specific?

账户相关：业务marginfloor、同时管理复杂度、quote资金路线、保证金占用；交易所最小量与身份防重不可随账户偏好弱化。C01/S08。

### Q239. Which should remain global invariants?

应固定：身份唯一/不可重复submit、UNKNOWN不伪造、资金事实fresh、订单合法、退出只减仓证明、持久化先后与TESTNET/PRODUCTION边界。S08/S09/S10。
### Q240. Are current entry frequency, leverage, position count and TP settings jointly coherent?

PROVEN：执行政策清晰但经济联合校准不完整；短horizon/小利润与无有限loss/长人工持有存在实质张力，static50与吞吐也未科学绑定。F04/F11/F05。

### Q241. Could increasing trade frequency lower total expected return because of fees/edge dilution?

INFERENCE：会有这种可能，fixedfee/fill摩擦与EV估计缺口支持检验；没有合格完整收益分母，不能直接预测增频后金额。F04/F10。

### Q242. Could reducing trade frequency improve expected value but underutilize capital?

INFERENCE：也可能，过严业务floor/统计上界降低参与，但当前主要事实缺失不能用放宽交易门槛解决。F12/R02。

### Q243. What objective function should be used to tune the system: absolute PnL, risk-adjusted PnL, drawdown, capital efficiency, hit rate, expected log growth or another measure?

建议以合格全成本净收益与资本占用为目标，并约束drawdown/尾部损失与事实可靠性；hit率/PLACE次数/TP保护率均不足作为单目标。F04/F10/F11。

### Q244. What constraints should be held fixed before optimizing that objective?

先固定：只读实验、TESTNET边界、真实资金/合法性、身份/退出保证、数据覆盖规则与不完整样本排除；保留当前参数作对照，不自行扩大风险。S08/S09/R01。

### Q245. What minimum historical evidence should be required before changing a live parameter?

需可重建同instance/config、完整closed economics、费用/资金费/人工尾部、未成交分母、多regime独立out-of-sample与置信区间；30重叠bars或12netPnl不足。F10/R05。

### Q246. Which current parameters should not be optimized from the available sample because of overfitting risk?

当前不宜直接优化：symbol分组杠杆、TP概率阈值、loss4bar、position50与confidence，因为有效经济样本/尾部分布缺失，复杂分组更易过拟合。F10。

## 对抗式审计

### Q247. If the system loses money while remaining technically healthy, what are the five most plausible causes?

五个候选原因：EV失败端假设错误；小TP/大长期人工尾部；fill/timing friction；过时/不一致packet；fee/funding漏计。前两项机制已证，实际亏损归因仍需合格逐单数据。F01/F04/F10/F11。

### Q248. If entry frequency is much lower than expected while all health checks are green, what are the five most plausible causes?

五个候选原因：service-ready≠execution-ready；Primary约101s；候选pool供给不足；盘口/私有真值过期；历史核查占共享REST。当前事实阻塞已证，其余要按健康时段测。R02/R04/F05/F07。

### Q249. If entry frequency is high but realized returns are poor, what are the five most plausible causes?

五个候选原因：PLACE/选择偏置；targettouch≠fill；低净利润被手续费吃掉；高notional与相关beta；移交后亏损未计入短期成绩。不能把这些全部宣布本实例亏损根因。F04/F10/F11/R04。

### Q250. If the Engine crashes after 8–24 hours despite passing all tests, what are the five most plausible causes?

五个待证方向：nativeSQLite/backup；V8/native fault；socket/agent资源累积；大prompt/JSON/实体Map导致commit pressure；恢复事件/定时任务风暴。已有0xC0000409，具体模块仍UNKNOWN。H01/F15。

### Q251. If Binance communication degrades intermittently without producing incidents, where could evidence be lost?

PROVEN：advisory/control排除、recent64/ledger512轮换、只存聚合、route切换归因以及重复recovery污染都可损失证据。不得将incident0等同网络0故障。F06/F08/F14/S03。

### Q252. If NET-002/MARKET-DATA-001 never appear again, could the system still be silently trading on stale or incomplete facts?

PROVEN：可以，quote单ts掩盖旧mark/last与旧packet语义；incident排除premiumIndex不阻止事实缺口。告警安静不能证明字段fresh或账户/订单已闭合。F01/F06/F09。

### Q253. If reconciliation remains DEGRADED for days, what practical harm could occur even if live trading appears healthy?

STRONG_EVIDENCE：长期重复前三条、资源占用、operator误解、历史经济归属无法闭合；funds-only时不是自动Entry veto，也不授权删除未知历史。F07/F10。

### Q254. What single hidden coupling currently has the highest potential to cause both lower trade quality and lower system stability?

STRONG_EVIDENCE：共享REST容量把WS恢复、历史对账、私有资金与执行补真值耦合；拥塞同时延迟决策/管理并增加重试/日志/同步存储工作。F05/F07/F08。

### Q255. What single assumption in the current design should be challenged first because it has the largest expected impact if wrong?

最先挑战“可触及小TP＋最低利润可代表正期望交易”这个假设；当前失败收益未建模且移交不止损，经济影响可能大于频率调参收益。实现可靠性优先同时处理F01/F02。F04/F11。

## 固定SHA源码与历史证据索引

- **S01**：[apps/engine/src/api/router.ts:95](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/api/router.ts#L95)。
- **S02**：[apps/engine/src/adapters/market/BinancePublicMarketDataProvider.ts:87](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/market/BinancePublicMarketDataProvider.ts#L87)。
- **S03**：[apps/engine/src/adapters/binance/requestBudget.ts:22](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/binance/requestBudget.ts#L22)；[apps/engine/src/adapters/binance/BinanceTransport.ts:33](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/binance/BinanceTransport.ts#L33)。
- **S04**：[apps/engine/src/services/operationalIncidents.ts:76](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/operationalIncidents.ts#L76)。
- **S05**：[apps/engine/src/adapters/market/BinanceMarketStream.ts:53](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/market/BinanceMarketStream.ts#L53)；[apps/engine/src/services/marketDataHub.ts:23](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/marketDataHub.ts#L23)。
- **S06**：[apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts:19](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts#L19)；[apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts:110](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts#L110)；[apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts:355](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts#L355)；[apps/engine/src/adapters/binance/BinanceUserDataStream.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/adapters/binance/BinanceUserDataStream.ts#L1)。
- **S07**：[apps/engine/src/services/quantityHorizonCandidates.ts:234](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/quantityHorizonCandidates.ts#L234)；[apps/engine/src/services/historicalTpReachability.ts:60](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/historicalTpReachability.ts#L60)；[packages/core/src/tradingCost.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/packages/core/src/tradingCost.ts#L1)。
- **S08**：[apps/engine/src/services/tradePlanService.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/tradePlanService.ts#L1)；[apps/engine/src/services/v397FrozenSizing.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/v397FrozenSizing.ts#L1)。
- **S09**：[apps/engine/src/services/tpGuardian.ts:82](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/tpGuardian.ts#L82)；[apps/engine/src/services/tpGuardian.ts:159](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/tpGuardian.ts#L159)；[apps/engine/src/services/v396ExitRuntime.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/v396ExitRuntime.ts#L1)。
- **S10**：[apps/engine/src/services/reconciliationService.ts:113](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/reconciliationService.ts#L113)；[apps/engine/src/services/entryRiskOccupancy.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/entryRiskOccupancy.ts#L1)。
- **S11**：[apps/engine/src/services/lossHandoff.ts:37](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/lossHandoff.ts#L37)；[apps/engine/src/services/positionReviewRunner.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/positionReviewRunner.ts#L1)；[apps/engine/src/services/positionReviewScheduler.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/positionReviewScheduler.ts#L1)。
- **S12**：[apps/engine/src/services/tradingQualityRuntimeObserver.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/tradingQualityRuntimeObserver.ts#L1)。
- **S13**：[apps/engine/src/runtime/appRuntime.ts:841](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/runtime/appRuntime.ts#L841)；[apps/engine/src/runtime/appRuntime.ts:926](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/runtime/appRuntime.ts#L926)。
- **S14**：[apps/engine/src/config/settingsStore.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/config/settingsStore.ts#L1)；[apps/engine/src/services/runtimeWriteBuffer.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/runtimeWriteBuffer.ts#L1)；[apps/engine/src/services/storageCapacityGuard.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/services/storageCapacityGuard.ts#L1)；[apps/engine/src/state/runtimeState.ts:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/state/runtimeState.ts#L1)。
- **S15**：[apps/engine/src/server.ts:14](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/server.ts#L14)；[apps/engine/src/main.ts:12](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/main.ts#L12)；[apps/engine/src/api/router.ts:552](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/api/router.ts#L552)；[apps/engine/src/api/router.ts:1167](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/apps/engine/src/api/router.ts#L1167)；[scripts/start-zdj-lan.ps1:18](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/scripts/start-zdj-lan.ps1#L18)。
- **C01**：[config/settings.default.json:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/config/settings.default.json#L1)；[packages/contracts/src/settings.ts:17](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/packages/contracts/src/settings.ts#L17)。
- **H01**：[docs/reports/crash/ENGINE_NATIVE_CRASH_20261006_FOREGROUND_ANALYSIS.md:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/docs/reports/crash/ENGINE_NATIVE_CRASH_20261006_FOREGROUND_ANALYSIS.md#L1)。
- **H02**：[docs/reports/v397-final-system-closeout-20261003/FINAL_CLOSEOUT_RESULT.md:1](https://github.com/3684993/ZDJMITS/blob/66f61d08391ed39713521365f421536e443e05b7/docs/reports/v397-final-system-closeout-20261003/FINAL_CLOSEOUT_RESULT.md#L1)。

运行与反例索引（证据包内路径）：

- **R01**：health.json / closeout.json / extra.json：实例、readiness、scoped reconciliation、最后阶段。
- **R02**：closeout.json.pipeline / entry.json：15:10 pipeline、execution、funding、scheduler。
- **R03**：governance.json / private.json / positions.json / log-summary.json / extra.json：请求与账户、LKG仓位、精确日志。
- **R04**：db-summary.json.recentArchive：24h分角色decision/latency；null不自动算成功。
- **R05**：db-summary.json / extra.json.episodeLatest500 / trading-quality.sqlite.schema.json：只读经济覆盖与schema。
- **T01**：repros.json / scripts/audit_repros.mjs：实际源码的行情、incident、统计与开关反例；禁止真实网络。
- **T02**：tp-repro.json / scripts/tp_repro.mjs：实际TpGuardian.place，外部执行/存储依赖用内存stub；BACKGROUND实际映射。
- **R06**：firewall-readback.json：只读Windows防火墙/网络profile核查。
- **W01**：report的Binance官方链接：本次浏览核对的USD-M接口语义。
# ZDJ-MITS V3.9.2 AI 决策链深层根因报告

日期：2026-09-13。审查 HEAD：`4e72b6b99f0b64ca4b6fe5d31cb140848d4f7857`。

## 核心结论

**当前主要问题是低波动市场中的机会复审机制、决策语义和经济事实没有形成一致合同，而不是已经证明 27B 过度保守，也不是少了一张工作的显卡。** 27B 确实参与实际 Entry，但现在运行的是关闭 reasoning 的受约束 JSON 决策模式；这批数据能评价此部署的行为，不能证明模型完整推理能力已经发挥。

最有价值的新发现：

1. 421 条正常拒绝中，199 条输入及 `directionReason` 明确为 15m DOWN，最终 `direction` 却是 LONG；另有 96 条 RANGE 也全部填 LONG。直接按该字段做方向胜率或反事实，会污染结论。
2. 27B 的活跃调用密度约 **158.2 次/小时**，不是 76.8。请求时间占活跃观察跨度约 **79.4%**。但模型内部 queue P95 只有 17ms，不能据此宣称吞吐不足，也不能把它当作候选等待时间。
3. 去重和冷却已经存在，但 410 对相邻成功决策中 **101 对仅上下文键的 bar5/bar15 时间边界变化**。432 对同币相邻调用中 118 对满足本报告的小变化筛选，105 对前一结果是 NO_EDGE。这是需要离线检验的复用机会，尚不是可直接删除的调用数。
4. 22 次模型失败全部是原始 NO_EDGE 附带 TP 零值；它们不能解释为 22 个交易机会丢失。另有 3 次前置 EIP 缺失。
5. 27B 看不到手续费、最低净收益、配置目标的明确经济事实。10 次 PLACE 中 6 次带 AI TP，目标距离为 0.82–38.40bps，全部低于配置 45bps 的价格目标；其中 3 次甚至低于 8bps 的保守往返费用假设。后置 TP 经济检查会处理不合格目标，但这意味着 Entry 与后续目标选择可能并非同一个交易假设。
6. 9B 的 Entry Scout 调用链已断开，开关不是根因。最终裁决 **REDESIGN**，当前 Entry 角色继续不接入。新增在线 27B 裁决 **NO**。

## 1. 范围、复现与上一轮结论修正

仅只读查询 `D:/MITS/data/zdj-settings.sqlite`；使用短读事务冻结本轮抽取，之后网络分析完全离线于 Engine。行情只访问 Binance TESTNET 的公开 GET `/fapi/v1/klines`，不访问账户接口、不下单、不操作 Engine 或模型生命周期。

严格使用基线窗口 `2026-09-12 23:47:27Z` 至 `2026-09-13 05:47:27Z`。本轮可复现 460 条 Primary archive / PRIMARY_START，421 NO_EDGE、7 WAIT、10 PLACE、22 最终 FAILED。最后一条 start 为 05:47:26.945Z，失败完成在窗口结束后。基线的 461 比本次精确秒级窗口多一条；没有上一轮冻结的原始 ID 清单，不能强行把额外一条纳入。421 条目标拒绝全部恢复。

最早本窗口调用是 02:53:21.072Z，最后 start 05:47:26.945Z：实际调用集中约 174 分钟。这里只修正活跃分母，不调查前半窗口为何没有归档调用，也不将其猜测为 GPU 故障或 Engine 停机。

|上一轮判断|本轮裁定|
|---|---|
|执行链已经能真实建仓，Gate 不是主要数量瓶颈|保留，不重审执行基础设施|
|27B 已发挥作用|保留：有实际输入、结构化结果、Entry 关联；不等于模型能力评测通过|
|低频第一根因是 AI 主动拒绝|只是漏斗描述；拒绝是否合理必须看机会分母、经济空间和反事实|
|明显偏保守、应先优化 Prompt|证据不足；反事实不支持普遍放松，且拒绝方向字段失真|
|77 次/小时且无明显 queue|全窗口均值成立；活跃约158次/小时；queue 只反映已调度请求|
|Scout 因 `scoutEnabled=false` 不工作|不能作为根因：当前 SQLite 为 true，Entry 无调用且 Primary 不消费 Scout|
|episode 空，所以不能反事实|推翻：保留完整 input/output，加同市场公开历史 K 线可重建有边界的研究结果|
|5.4% schema/evidence 失败|比例量级成立；必须细分为22个 NO_EDGE 非法TP和3个无模型调用的 EIP缺失|
|暂不增加27B|保留，但理由是缺乏可归因的机会排队损失，不是 GPU 不忙|

复现脚本：`scripts/analyze-v392-deep-root-cause.py`、`scripts/analyze-v392-anomalies.py`。数据目录：`data/reports/v392-deep-root-cause/`，含冻结 runs/events、28 个 symbol 的同源1m行情、逐对变化、逐条反事实、失败和异常清单。脚本仅写此分析目录。第二次运行默认复用已下载行情，保留采样时的未成熟窗口，不悄悄改变标签。

## 2. 独立机会还是重复分析

460次不是460个独立机会，而是 **28个symbol、24个underlying** 的重复评估；ARB/NEAR/UNI/WLD 的 USDT 与 USDC 合约分别受评估，不能直接算作独立资产机会。相同 underlying 的不同合约也不应简单合并，其交易价格/流动性可能不同。

432对同币相邻调用：间隔中位数320.79s，P95 1159.19s，最短47.66s。前一次为NO_EDGE且本窗口内再调用的398对，拒绝完成→下次start中位304.36s、P95 1075.76s、最短76.68s。窗口尾部没有下一次调用的23条拒绝是右删失，不能按“永不复审”处理。

实际变化：249/432对处于同一15m闭合bar，195对选定15m数值完全一致；15对同5m bar，10对15m+5m选定指标完全相同。价格绝对变化中位7.10bps（0.211 ATR），P95 37.87bps（0.815 ATR）；15m EMA21变化中位约1.1e-10 ATR，MACD柱变化中位约4.7e-9 ATR。微小浮点差不代表经济状态改变。

**确有反复评估低增量上下文，但不能声称绝大多数输入完全不变。** 1m/5m更新可能产生真实择时事件。同15m bar本身不是浪费证据。

本报告“小变化”定义：1m/5m/15m、1h/4h、BTC/ETH趋势及regime不变，报价变化<0.25旧15m ATR，15m EMA21与MACD柱变化均<0.1旧ATR。118/432对满足，其中105对前次NO_EDGE。这是候选复用筛选，不覆盖orderbook、短周期事件、权限、可交易价格等全部必要信息，不能直接推导安全节省25.7%的GPU。

以真实生命周期 `decisionContextKey` 复核，410对相邻成功终态：bar5改变405、bar15改变181、priceAtrBucket改变285、trend5改变44、trend15改变21、confirmation改变9；字段重叠。**101对只改变bar边界，结构趋势与价格分桶不变**。这些比“reason文字一样”更直接地证明时间更新本身在推动复审。

## 3. 为什么反复回池，以及调用是否过多

代码路径：`entryCoordinator.ts:71` 冷却到期且context变化→READY；`:94` 过滤active/cooldown/lifecycle；`:270` 调用Primary；`:272` 保存context、将nextReviewAt设为下一5m闭合边界；`:277` NO_EDGE进入REJECT_COOLDOWN、移出池并补池；`:334` 下次比较context。

`decisionContext.ts:7` 的key包含bar15、bar5、trend15、trend5、四分之一ATR价格桶、settings哈希、权限、confirmation。已有 symbol 去重、25秒冷却、5m边界和变化键，故“完全没有去重/冷却”不成立。现在的不足是 **变化键不表达拒绝所依据的条件是否被解除**。没有针对“缺少回撤确认”“空间不足”等结果的有效期与解除事件；新bar即可满足变化条件。

另发现 `entryCoordinator.ts:346` 构建key时没有传入longExecutable/shortExecutable，两者在key内固定false。`lifecycleRunnable`中权限变化提前唤醒分支因此不能从该调用点获得真实权限变化。这是具体代码缺陷；外侧route过滤仍存在，所以不是越权交易漏洞，也没有本窗口直接错失机会数量。

本轮裁决：**27B有被当作约5分钟一次的全量复审器使用的倾向，调用量存在优化空间；不是毫秒级无条件轮询器。** 不可用77次/小时合理化现状，也不能因为忙就加实例。

建议的后续触发合同（本轮未实现）：首次独立机会调用；返回结构方向、拒绝层、可观测解除条件、有效期；同条件未变化时复用；completed timing event、空间跨过经济门槛、结构失效、权限实变才重算；5m边界只负责检查，不自动付出27B成本；保留有界TTL兜底和WAIT新PLACE授权。保留确定性轻量比较，不要求9B逐次读同样指标。

## 4. 421次拒绝的离线反事实

### 方法与边界

行情来源与输入一致：**Binance USD-M TESTNET**，不是主网价格。已有成功样本中可对齐的437条1m已闭合OHLC全部与重新下载行情一致（包含失败输入的扩展核对为459/459）。因此本轮不将行情错源或大面积stale作为主因。此结果不应外推到主网真实成交质量。

方向必须先校正语义：325条有明确15m UP/DOWN；每条 `directionReason` 用可复现的显式15m趋势表达抽取，均与输入结构方向一致。**主表使用该方向，不使用受污染的最终direction字段。** 其余96条15m RANGE没有可定义的15m方向，归D；不为它们事后选一条赚钱方向。归档保留原始direction用于敏感性对照，绝不改生产记录。

时间锚：使用模型completedAt所在1m bar的收盘价作为最早可一致取得的后置价格锚，保留anchorAt；只考察随后完整闭合1m bar，5/15/30/60m分别要求4/14/29/59根连续bar。排除决定分钟前半段行情，也因此遗漏completedAt至该分钟结束最多60秒的运动。**这是延后不到1分钟的机会存在性研究，不是精确成交时刻回测。** 不把inputPrice和completedAt混作同一时刻。

MFE/MAE采用对应方向的逐bar high/low，相对锚价计算，单位bps，负的有利/不利极值裁为0。每条保存输入报价年龄、锚价、覆盖根数、MFE、MAE、终点收益及首次跨阈值时间。未成熟/缺bar不补零。

主阈值55bps = 配置价格目标45bps + 10bps研究费用/滑点余量。当前设置entryFeeRate=4bps、takerFeeRate=4bps、安全余量10%，合计保守8.8bps，向上取10bps；这是研究情景，非逐单精确费用，也非改变TP。45bps目标本身是gross price move，55bps是“覆盖目标另加成本”的较严格标准；另列10/45/65bps敏感性，避免只挑有利阈值。

- A 正确拒绝的代理：该时限内正反两边均未触及55bps。只表示没有发现目标量级的运动，不表示交易必然不盈利。
- B 错过明显机会的代理：有利55bps先于不利55bps触及。不能据此保证当时可成交、一定有合格入场事件或能持仓至目标。
- C 避免明显错误方向的代理：不利55bps先触及。不是止损策略回测，系统并未授权这样的止损。
- D 无法判断：无15m方向、覆盖不完整、或同bar正反同时触及无法排序。

因此，以下是**可复现的条件标签，不是交易胜率/模型正确率**。相邻拒绝重叠，同一波行情可给多条B，不能将它们相加当作独立可做交易。

|时限|A|B|C|D|完整行情覆盖|MFE中位bps*|MAE中位bps*|
|---|---:|---:|---:|---:|---:|---:|---:|
|5m|322|2|1|96|421/421|5.07|5.40|
|15m|302|11|12|96|421/421|10.55|14.04|
|30m|268|18|31|104|408/421|13.88|21.25|
|60m|187|23|55|156|337/421|15.98|28.35|

*MFE/MAE汇总包含有行情但RANGE方向未定义的记录（按raw字段仅作机械计算），不能作为325个有方向样本的专属分布；逐条D保留，下面另给有方向分布。

有方向且行情完整 5m：n=325，MFE中位=4.27bps，MAE中位=5.07bps。
有方向且行情完整 15m：n=325，MFE中位=8.70bps，MAE中位=14.22bps。
有方向且行情完整 30m：n=317，MFE中位=11.51bps，MAE中位=22.01bps。
有方向且行情完整 60m：n=265，MFE中位=13.53bps，MAE中位=32.89bps。

15m阈值敏感性（研究情景，不是修改交易参数）：

|阈值bps|A|B|C|D|
|---|---:|---:|---:|---:|
|10|62|109|149|101|
|45|285|16|24|96|
|55|302|11|12|96|
|65|308|7|10|96|

15m可判方向的325条中，302 A、11 B、12 C：A约92.9%；存在局部漏判，但不支持“普遍过度保守”。11条B只涉及6个symbol，仍有同波重复。60m内B增加到23，也有55个C及156个D，不能把后来出现行情追认成当时应该PLACE。

11条15m B首次达到55bps的时间中位6.66分钟；23条60m B中位17.60分钟。若A后在更长时限出现B，其间可能先经逆向波动/趋势变化；保存的首次有利阈值时间仅为机会运动的时间，不是合格交易事件形成时刻。缺少完整事件检测状态，无法严谨回答每条“等多久才首次可执行”，应保留UNKNOWN而不是把MFE发生时间当作可入场时间。

原始direction字段的15m统计会得到B12/C11，60m为B38/C40；修正15m语义后为B11/C12、B23/C55。即使汇总有时差很小，逐条方向仍严重错配。使用raw direction的研究结论不可继续沿用。

### 最小 observation / episode 方案

无需修改生产策略即可先采用本轮离线重建。后续若获批持久化，最小记录：runId、symbol/underlying/venue、candidate/episodeId、输入时间/报价时间、开始/完成/授权时间、完整不可变输入输出及hash、model/build/template身份、15m结构方向与model认可方向分开、tradeSide可null、拒绝层、completedEventId/时间/成立状态、economicFloor和各分项单位、contextKey前后差异、triggerReason、expiresAt/invalidation、schema错误路径。独立结果表记录同venue报价/1m OHLC、每时限覆盖、锚价时刻、MFE/MAE、跨阈值先后、未成熟/不确定原因；非PLACE没有假造entry/TP。

`temporalIntelligenceService.ts:14` 明确研究worker只能在独立数据库、`ZDJ_OFFLINE_RESEARCH=1`下运行；episode为空是当前隔离设计结果，不是可据此判定生产采集全丢。不要为了补episode向live DB启动该worker。

## 5. NO_DIRECTION_EDGE的真实决定因素

正常成功结果438条中，96条15m RANGE全部NO_EDGE；其余342条明确方向中325条NO_EDGE、17条PLACE/WAIT。以下仅比较342条有方向样本，避免RANGE混入对照。现象高度相关且存在symbol/时间自相关，**不是因果贡献率**。

|因素|存在时NO_EDGE/总数|拒绝率|不存在时NO_EDGE/总数|拒绝率|
|---|---:|---:|---:|---:|
|1m结构趋势反向|139/140|99.3%|186/202|92.1%|
|5m结构趋势反向|33/33|100.0%|292/309|94.5%|
|1m MACD柱斜率反向|147/156|94.2%|178/186|95.7%|
|5m MACD柱反向|217/222|97.7%|108/120|90.0%|
|4h趋势反向|64/67|95.5%|261/275|94.9%|
|1h趋势反向|27/33|81.8%|298/309|96.4%|
|BTC或ETH 15m反向|127/140|90.7%|198/202|98.0%|
|orderbook imbalance反向|114/122|93.4%|211/220|95.9%|
|当前价至同向15m BB边界<45bps|218/233|93.6%|107/109|98.2%|
|位置不好：文本代理|306/312|98.1%|19/30|63.3%|
|缺少完成事件：文本代理|259/260|99.6%|66/82|80.5%|

闭合bar锚缺失0；1h stale=0；recentTrades缺失2/438，均NO_EDGE。其他required evidence的前置缺失见failure章节。

1m趋势反向的拒绝率99.3%，无反向92.1%，有明显关联；5m趋势反向33/33拒绝，但样本小且不是唯一因素。5m MACD柱反向217/222拒绝，短周期动量确有被提升为方向否决的迹象。不能把MACD反向与结构反向混为同一变量。

“缺少事件”是解释文本中最接近决策的关联：有方向样本260条命中，259拒绝；没有此表达82条仍有66拒绝。真实closed-bar锚缺失为0，因此“没有行情事实”和“模型认为没有合格完成事件”是两件事。当前未保存completedEvent结构化字段，无法凭一个lastClosedBar证明回撤/突破已经完成；文本关键词只是代理，具体模式在脚本中公开。

位置问题文本306条有方向拒绝；BB剩余空间<45bps有218条拒绝，但该条件缺失时仍107/109拒绝。**仅用BB空间不能解释决策，模型也没有得到经济门槛，不能断言它正在正确执行手续费检查。**

全局“15m+1m+5m+1h+4h+BTC/ETH必须一致才交易”被反例推翻：PROMUSDT `airun_mtzd05fx_mphcerne` 在1m DOWN、15m UP、负book imbalance时PLACE_LONG；BTCUSDT `airun_mtz8ft4k_bm9zm3go` 在1h/4h背景反向仍PLACE_LONG。反过来，95条NO_EDGE即使这些趋势全部无反向仍拒绝。

所以最强结论是：**部分短周期冲突被误写为方向不足，缺少完成事件/位置优势被合并为NO_EDGE；并非所有背景因素统一一票否决。** 例ENAUSDT `airun_mtz81vtt_bhj1d5o9` 明确说15m DOWN、1m UP，因此方向冲突阻止PLACE；按合同应分别表达“方向存在但择时未到”，不能把无法成立WAIT的情况统统伪装为没方向。此处语义需改，但不自动代表应增加交易。

## 6. 9B退出的根因与裁决

开关消费点只有 `aiFabric.ts:184` 的 `scout()`；默认文件 `config/settings.default.json:45` 为false，初始提交c1527b9中已是false。本仓库历史以此初始快照开始，无法证明更早谁何时为何改为false。settings_audit仅有api/迁移、版本、泛化summary，未保存该字段old/new或操作者身份，不能据此杜撰设置历史。

当前SQLite读取为true；较早本地 `data/reports/v392-final-snapshot.json:3241` 也为true。因此上一轮“运行false”的证据不足，可能混淆默认与运行状态。无论开关真伪都不是当前Entry无9B的充分解释。

决定性代码：Entry `ai.decide(packet, null, ...)`；`AiFabric.decide` 参数命名 `_scout`；`primaryOnce`只构建compact prompt；`aiPrompts.ts:12`兼容buildBrainPrompt也忽略`_scout`。全库没有生产Entry调用`.scout()`的路径。因此启用开关既不减少27B调用，也不为其提供增量证据。

Scout原职责：attention、缺失事实、矛盾、异常资本活动、短周期关注点，明确不决定方向/订单。此角色的大量输入来自现成指标。当前另一条9B路径是external research，不写ai_runs_archive；仅查SCOUT calls=0也不足以证明GPU没做研究。本轮进一步查询：external_research_tasks为空，窗口EXTERNAL_RESEARCH事件为0；external enabled=false、researchEnabled=true、feedToPrimary=false，`externalResearchService.ts:21`禁止无消费者的本地重复指标研究。当前没有可证据化的9B有效产出。

**最终四选一：REDESIGN。** 不是ENABLE，也不立即REMOVE整个模型资源。旧Entry Scout摘要角色没有可证据化价值；若今后仍仅重述指标，应删除该角色。可保留为隔离的共享事件抽取/反例标注实验，但必须先定义新信息来源、provenance、TTL、消费者及净增益指标。验收应是保持机会召回、降低Primary调用/标注错误，而不是让B580利用率升高。当前不接入Entry，不改现有开关。

## 7. 5.4% failure逐条根因

本轮冻结事件中有24条ENTRY_ANALYSIS_FAILED：21条TP schema、3条XRPUSDC EIP缺失。第22条模型schema失败是窗口末start、窗口外完成的 `airun_mtze6tlt_4fwt6h35`，因此事件时间口径少一条。按启动cohort统计22+3=25个失败链，约5.43%/460；按已发起模型调用本身是22/460=4.78%，其余3条没有调用模型。不能混用分母。

|类别|独立链数量|责任与解释|
|---|---:|---|
|schema / TP=0|22|原始NO_EDGE带profitTakePlan.targetPrice=0，model输出与schema/protocol分支合同不一致|
|TP range=0|22|与上行重叠，同一对象min/max=0，不重复计数|
|entry range=0|0|未发现|
|missing evidence|3|XRPUSDC在EIP构建前失败；evidence builder/readiness，不是模型保守|
|stale evidence|0|本批恢复失败无此类，不应延用上一轮混称|
|JSON语法/多对象问题|0|本批恢复失败无此类|
|inference / timeout / HTTP|0|本批恢复失败无此类|
|normalization失败|0|没有独立证据；不将TP零值归因于normalization|
|其他|0|以恢复原始记录为边界|

`packages/contracts/src/ai.ts:32`所有分支共享可非null TP对象，即NO_EDGE也可走对象分支；number exclusiveMinimum=0交给后端，但llama.cpp公开文档说明数值min/max语法约束只支持integer、不支持number。实际后端build应固定验证，不能把当前上游文档当作已验证本机内部实现；本机输出零值、Zod positive拒绝是确定证据。参见[llama.cpp grammar限制](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)。

因果链：无交易也允许TP对象→模型用0表示“不适用”→后端给出合法JSON但数值不合法→Zod失败→整次decision丢入失败冷却。正确修复方向是非PLACE明确无执行/TP授权、用null表达不适用，保持数值验证；不是默认填TP价格，更不是把失败强行改PLACE。22条原始全是NO_EDGE，修复至多先恢复22条有效拒绝记录及正常复审语义，不能预期多22单。

3条EIP缺失发生在02:52附近，尚未PRIMARY_START；说明前置依赖存在检查与EIP实际需要的candidate/快照事实并不完全等价。这里只报告直接AI影响，不追查底层网络。见附录逐条ID。

## 8. 未在提问中明确列出的重要问题

### 8.1 方向字段污染，置信度没有稳定语义

421正常NO_EDGE：UP→LONG50，DOWN→SHORT76，DOWN→LONG199，RANGE→LONG96。325条有方向解释全部与15m事实吻合，199条最终side却相反。Zod要求每个分支必须LONG/SHORT，只有PLACE检查与15m同向。不能称之为199次实际逆向订单，但**用该字段给拒绝标注方向已不可靠**。

363/421条正常拒绝confidence=0；同时21条拒绝confidence≥0.85。它可能在不同输出里指交易信心、方向信心或拒绝信心。没有校准实验，也没有明确confidence事件定义，不应拿平均confidence评价模型能力或筛交易。

### 8.2 严格JSON成功掩盖解释截断和语义缺验

460原始结果（含失败raw）中 directionReason长度恰160的395条、timingReason251条、entryLocationReason115条、reason183条。代码maxLength=160，实例中大量在“but ”、“prevent a ”处终止。客户端未对这些短句做截断，输出完成通常stop而非length，因此这不是网络截断证据；更像受约束解码下无法完成短句的合同问题。不能把短reason当完整推理过程。

PLACE Prompt要求引用lastClosedBar close time/price，但10条PLACE的timingReason都没有其毫秒closeTime原值，多数只写价格；这不证明它们完全没有其他格式的时间表达，却证明现有结构输出没有可机验eventTime。parser只验证引用ID、side及简单book符号，不验证事件成立、引用数值属于哪个周期、经济空间。`SCHEMA_VALID`只表示结构校验通过。

BTC `airun_mtz7yxio_ykg707rg`的entryInvalidation称77262.6为15m swing low，实际15m swingLow=77178，77262.6属于1m/5m swing low及15m末bar low。**合法fact ID不保证数值语义正确。** BTC PLACE `airun_mtz8ft4k_bm9zm3go`的失效价77250也需按其声称的15m BB lower核对，不应因为给了数字就认定事实已被正确使用。

`compactFactIds`提供`technical.4h.context`，实际compact payload没有该factId对象，4h只嵌在`context.market`；这是引用注册表与载荷对象不对齐，尚未证明导致本批失败。应在输入合同验证，而不是靠模型猜引用关系。

### 8.3 经济目标输入缺失，PLACE与TP假设不一致

真实发送模型的是 `inputPreview.prompt` 中compact FACTS，不是同字段旁边保存的完整packet。上一轮把packet的portfolio/experience等全部当作模型读到的输入，依据不足。compact FACTS没有手续费、目标move、净收益floor、完整portfolio/history。模型不能凭未提供的数据判断“够不够覆盖实际成本”。

6条非null AI TP相对idealPrice：ONDO7.20bps、NEAR38.40、SUI5.54、BTC0.82、APT30.42、ARB21.05；4条PLACE无AI TP。配置45bps不是一切策略必须遵循的绝对硬门槛，但模型自己的目标与系统经济门槛应明确对齐。ONDO/SUI/BTC的目标连保守8bps费率情景都覆盖不了，是可见的质量问题。

只读查看`tpGuardian.ts:37`后的目标验证确认经济检查仍在：无效AI目标会转后续结构/经济目标；本轮不修改TP、不把此问题描述为TP基础设施失效。真正问题是Entry可能按非常近的目标解释“有优势”，实际仓位随后需要更远目标才有净收益。缺少一致的净收益空间，不是多加模型能够解决。

### 8.4 “已有深度推理模型”不等于此链正在深度推理

运行进程与状态文件确认：B580加载Qwen3.5-9B Q4_K_M（8081、32k context、physical Vulkan0）；27B加载`qwen/qwen3.8-27b` Q4_K_M（8084、64k context、physical Vulkan2、7900XTX）。两个子进程都显示Vulkan0是各自隔离后的编号，不能据此判定用错同一GPU。第二张7900XTX没有当前Entry模型资源。

两服务命令均`--reasoning off --no-reasoning-preserve`；27B归档reasoningFormat=none，客户端temperature=.1、max_tokens默认900、强制json_schema。本批输出是短结构化判定，不是充分评测过的reasoning模式。禁止从显式推理关闭反推“模型没有任何内部推理”；只能说未测试开启推理的质量增益及延迟成本。也不能根据模型文件名认证基础模型血统或相较9B的能力优势。

### 8.5 当前regime样本单一，等待时间与延迟证据不足

所有460条输入globalRegime都是LOW_VOLATILITY；模型输出424 RANGE、36 TREND。没有不同regime的受控对照，无法将拒绝归因为“周末模型失灵”，也不能外推到趋势日。原始输入DOWN295/UP62/RANGE103，输出LONG372/SHORT88的表面多头偏置主要受非PLACEside语义污染；实际PLACE5/5，样本太小。

成功调用报价在模型完成时年龄中位18.79s、最大32.59s。输入1m/5m/15m bar年龄最大约61.5/302.0/901.9s，接近各自正常闭合边界，没有大面积stale。分析期间市场当然可变，但未保存所有候选就绪时间以及逐秒机会窗口，不能证明延迟导致多少漏单。queueMs只在waitForPrimary附近计时，调度前的池等待不包含在内；**“没有queue”不是已证明没有候选等待**。

## 9. 根因优先级与Prompt裁决

不编造因果百分比。没有随机消融、独立episode和同regime对照，无法将421次拒绝按A–F分摊成加总100%的根因贡献。可量化的是触发101/410仅bar变化、325/421方向存在仍拒绝、199/421side矛盾、22个TP schema失败、11/325个15m方向性B代理。

|根因类别|优先级|裁定|
|---|---|---|
|B Candidate/trigger|P1|直接可证实的低增量复审；并非机制全缺失|
|D schema/protocol|P1|方向/拒绝层/TP空值/解释长度语义不一致，损害归因与稳定性|
|C Evidence质量|P1|行情主体新鲜，但经济事实缺失、factId对象不齐、事件不可验证|
|A Prompt|P2|有语义冲突和表达压力；应在合同明确后定向改，不做宽泛放松|
|E 模型能力|P2待实验|有错引用及一致性问题；未做模型/推理开关受控比较，不能单独定罪|
|F Execution|本轮非主因|保留基线执行事实；只指出Entry经济假设与后续目标不一致|
|G 多因素|最终归类|低波动机会少 + B/C/D共同放大调用与错误解释|

**Prompt最终裁决：需要定向修改，但排在协议/证据定义之后；不要以提高PLACE为目标。** 后续明确structureDirection与tradeSide、directionEdge与timingEvent、RESELECT与NO_EDGE区分、给经济事实、消除160字符下同时引用/事件/反证的表达冲突。保持权限、事实、非强制交易；不把1h/4h全部删掉，也不让所有短周期冲突自动通过。

## 10. 第三张显卡与新增27B裁决

**新增在线27B：NO，本轮不实施。** 活跃79.4%请求时间占比说明Primary确实在工作，但没有持续内部排队或可归因的机会丢失证据；先证明哪些调用值得发生，收益比复制当前缺陷更明确。这个比例是请求占用估计，不是GPU硬件利用率。

闲置7900XTX若未来要用，最合理用途是**与交易完全隔离的离线盲测**：冻结本轮去重后的episode及后验隐藏标签，对比当前27B非reasoning、同模型reasoning、9B；固定输入、经济合同和schema，按symbol/时间块切分，报告正确拒绝、误拒、方向一致性、合法输出率、校准及端到端延迟。评估器不得读未来行情生成决策；评分阶段才看后验。独立端口/目录，不注册Engine，不做投票双写。只有证明质量增益且不会破坏时效，再另行授权部署。

这只是使用方案，本轮没有加载新模型、改变reasoning开关或启动任何实例。9B当前无有效样本，无法给出能力高低分；27B也不能因参数较大直接获得交易优势认证。

## 11. 下一步最多5项修改（均未实施）

1. **机会复审状态合同**：一次拒绝绑定episode、拒绝层、触发解除条件和TTL；5m边界检查条件，不自动调用27B；记录key差异和候选ready时间；修正key未传真实权限的问题。先用118个小变化对和101个边界对离线验证，报告节省调用与B类召回变化；任何减少调用方案不能隐藏新完成事件。
2. **决策协议一致性**：结构方向独立、非交易side可null；明确NO_EDGE/WAIT/RESELECT；非PLACE TP=null；保留严格数值验证；改进短句/事件结构，使160字符截断不再吞核心理由。用22个失败raw和199个side矛盾样本作回归，目标为语义正确，不是更多PLACE。
3. **Entry经济和事件事实**：给模型实际费用/净收益/目标空间单位和来源，结构化completedEvent/anchor；校验factId对应实体和数值周期；检验6个小空间PLACE是否仍有合理净收益假设。后置TP保护保持原样。
4. **最小离线episode与质量评测**：沉淀本轮421个标签及数据缺口，补更长时限成熟行情、逐秒锚价、episode去重，跨regime复验；不要因episode为空向live启动研究worker。
5. **隔离模型/Prompt实验**：在上述合同稳定后才做9B REDESIGN和27B reasoning对照；闲置7900可作为研究设备，须后续显式批准模型启动。未见等待窗口损失前不扩在线Primary。

## 如果只能改一件事

**改“NO_EDGE之后何时值得重新分析”的机会复审状态合同。** 将方向、择时/位置阻碍、可观测解除事件及失效时间存成同一episode，基于实质变化再调用27B，并记录触发原因。它同时纠正重复机会分母、给拒绝质量可验证的语义、减少低增量调用，且无需强迫PLACE。仅延长冷却或增加GPU都没有解决这个问题。协议空值和经济事实是紧随其后的明确缺陷；本报告不承诺仅此修改会提高盈利或成交数。

## 最后一轮“仍无法解释的异常”检查

已回头检查原始direction反转、raw vs normalized、reason长度、quote/bar时效、同源OHLC一致性、全趋势一致却拒绝的反例、非全一致却PLACE的反例、TP空间、外部研究旁路、GPU实际映射以及时间口径。

剩余不能闭合：为何某些同样低增量输入被选PLACE而其他被NO_EDGE；模型对completed event的精确判据；每条A后首次可执行机会时间；调度前等待导致的损失；开启reasoning/9B的净质量增益；设置false的历史操作者；60m未成熟样本。它们需要上文最小记录和受控实验，不用叙事补齐。结论因此是“存在可修复的语义/触发/经济合同问题，普遍过度保守尚未证实”。

## 附录A：每symbol调用与间隔

|symbol|Primary|NO_EDGE|相邻start中位秒|P95秒|
|---|---:|---:|---:|---:|
|1000SHIBUSDT|2|2|355.58|355.58|
|APTUSDT|9|7|354.28|1530.02|
|ARBUSDC|25|24|293.02|1021.84|
|ARBUSDT|8|7|734.04|3184.86|
|AVAXUSDT|23|21|331.80|731.23|
|BTCUSDT|37|32|296.72|372.89|
|DOTUSDT|12|11|360.42|5081.62|
|ENAUSDT|31|31|307.95|616.20|
|ETHFIUSDT|9|9|348.22|666.05|
|FILUSDT|1|1|0.00|0.00|
|HYPEUSDT|7|7|1312.31|3069.75|
|INJUSDT|28|25|300.42|450.64|
|LINKUSDT|11|10|336.87|408.21|
|LTCUSDT|27|23|301.82|836.49|
|NEARUSDC|26|23|322.90|638.83|
|NEARUSDT|13|13|747.62|1390.21|
|ONDOUSDT|10|9|325.43|2654.13|
|OPUSDT|10|10|303.05|796.09|
|PENGUUSDT|20|20|333.14|2023.92|
|PROMUSDT|4|0|863.62|1277.43|
|SUIUSDT|20|18|307.88|567.00|
|UNIUSDC|15|15|366.74|1347.57|
|UNIUSDT|18|18|378.04|1430.41|
|VIRTUALUSDT|2|2|335.64|335.64|
|WLDUSDC|25|24|315.54|598.47|
|WLDUSDT|10|10|503.12|1167.28|
|XMRUSDT|23|19|318.11|623.59|
|XRPUSDC|34|30|312.91|355.65|

FIL仅1次，间隔0表示无相邻样本，不是零间隔调用。

## 附录B：逐条失败归属

|runId或eventId|symbol|责任|原始决策|
|---|---|---|---|
|airun_mtz9rigz_42vlkq68|DOTUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtz9vr3l_ahbsborp|LTCUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzad52d_9h13nwn9|INJUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzaf6p8_jv74v6jl|BTCUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzak27b_fqiu97dq|XMRUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzaqrtj_m60vzr0l|WLDUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzbaj4g_oc1thi3z|NEARUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzbb2g0_66noonc4|XRPUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzbbjt1_u4fxh0ma|ARBUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzbs2vn_i466fqop|SUIUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzbszoh_vm32x0gp|LINKUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzc38mz_qir5egnl|XRPUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzcibm2_yjqun80z|XMRUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzcmzun_ccmrfh5i|APTUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzcp3ag_mtekmfka|XMRUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzcxb35_e60fjhc2|INJUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzda2yn_7cg4tap7|BTCUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzde034_yqbm6aoj|INJUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzdng57_f5oygnmf|AVAXUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzdvzas_fyodh4b3|AVAXUSDT|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtzdypvs_kzdb3ssu|XRPUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|airun_mtze6tlt_4fwt6h35|XRPUSDC|schema/model非PLACE TP零值；range也为0|NO_DIRECTION_EDGE|
|evt_1789267930965_83|XRPUSDC|evidence builder；2026-09-13T02:52:10.965000+00:00|无调用|
|evt_1789267956006_136|XRPUSDC|evidence builder；2026-09-13T02:52:36.006000+00:00|无调用|
|evt_1789267981050_185|XRPUSDC|evidence builder；2026-09-13T02:53:01.050000+00:00|无调用|

## 附录C：421条拒绝反事实明细

每格为 `标签 MFE/MAE bps`；缺覆盖写D；RANGE即使有机械数值也归D。完整锚价、时刻、覆盖、原始side与方向解释见counterfactual.json。原始市场数据已冻结；主表没有给D补造结果。

|runId|symbol|15m方向|5m|15m|30m|60m|
|---|---|---|---|---|---|---|
|airun_mtz7yxio_ykg707rg|BTCUSDT|UP|A 0.3/1.0|A 1.5/1.0|A 1.5/1.0|A 1.5/12.0|
|airun_mtz7zue6_iedwmcd1|ENAUSDT|DOWN|A 28.3/0.0|A 35.3/0.0|B 63.6/0.0|B 98.9/0.0|
|airun_mtz812u1_zdvtiwr2|BTCUSDT|UP|A 1.3/0.0|A 2.5/0.0|A 2.5/0.0|A 2.5/10.9|
|airun_mtz81gdb_ohdrf9f5|SUIUSDT|UP|A 0.0/9.6|A 1.4/16.5|A 1.4/38.5|C 1.4/75.7|
|airun_mtz81vtt_bhj1d5o9|ENAUSDT|DOWN|A 14.2/7.1|A 21.2/14.2|A 49.5/14.2|B 84.9/14.2|
|airun_mtz82f58_im3efr2x|NEARUSDC|DOWN|A 25.4/0.0|A 42.3/12.7|B 80.3/12.7|B 114.1/12.7|
|airun_mtz8741r_26w3qr7g|XRPUSDC|UP|A 0.0/2.9|A 8.0/3.7|A 8.0/12.4|A 8.0/40.2|
|airun_mtz87hki_zb1outmr|BTCUSDT|UP|A 1.9/0.1|A 2.4/0.1|A 2.4/0.1|A 2.4/11.1|
|airun_mtz8bem4_adymvpb5|XRPUSDC|UP|A 11.0/0.0|A 11.0/9.5|A 11.0/22.7|A 11.0/37.3|
|airun_mtz8cbil_3uczpq0b|ENAUSDT|DOWN|A 21.2/0.0|B 63.6/0.0|B 98.9/0.0|B 98.9/0.0|
|airun_mtz8dlve_bzdubiez|SUIUSDT|UP|A 2.8/11.0|A 2.8/37.1|C 2.8/74.3|C 2.8/74.3|
|airun_mtz8eipj_jgw29bqd|XRPUSDC|UP|A 0.0/5.1|A 0.0/16.1|A 0.0/31.4|A 0.0/43.9|
|airun_mtz8ewam_lmplaavh|NEARUSDC|DOWN|A 16.9/38.1|B 55.1/38.1|B 72.0/38.1|B 89.0/38.1|
|airun_mtz8fdpl_4wbl7rkc|ENAUSDT|DOWN|A 14.2/21.2|A 42.5/21.2|B 77.9/21.2|B 77.9/21.2|
|airun_mtz8hsm0_nmxl0xap|UNIUSDT|UP|A 1.6/7.8|A 1.6/39.2|C 1.6/75.2|C 1.6/75.2|
|airun_mtz8ix6f_b0ixr1iq|NEARUSDT|RANGE|D|D|D|D|
|airun_mtz8k3o9_id4kw8zy|WLDUSDT|DOWN|A 2.5/5.0|A 35.3/47.9|A 50.4/47.9|A 50.4/47.9|
|airun_mtz8kj57_yajo61ya|SUIUSDT|UP|A 13.8/12.4|A 13.8/26.2|C 13.8/63.4|C 13.8/63.4|
|airun_mtz8kwo0_9ff5yri9|XRPUSDC|UP|A 2.2/8.0|A 2.2/11.7|A 2.2/32.2|A 2.2/39.5|
|airun_mtz8lc4t_sp921syh|BTCUSDT|UP|A 2.1/0.5|A 2.1/0.5|A 2.1/9.4|A 2.1/11.4|
|airun_mtz8lrkb_0l44q7qi|ARBUSDC|DOWN|A 14.3/0.0|C 14.3/93.0|C 28.6/128.8|C 28.6/143.1|
|airun_mtz8m708_n6g2396s|UNIUSDT|UP|A 0.0/12.5|A 0.0/40.7|C 0.0/76.7|C 0.0/76.7|
|airun_mtz8moeu_jtae7s8u|ENAUSDT|DOWN|A 42.5/21.2|A 42.5/21.2|B 77.9/21.2|B 77.9/21.2|
|airun_mtz8oi35_yje61fpc|DOTUSDT|DOWN|A 14.8/28.7|A 14.8/28.7|A 20.8/28.7|A 54.4/28.7|
|airun_mtz8p76d_xh2m4xk7|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz8qt56_7z61r1wb|UNIUSDC|UP|A 0.0/28.2|A 0.0/31.4|C 0.0/65.9|C 9.4/65.9|
|airun_mtz8r8l4_nby2ayb4|WLDUSDT|DOWN|A 32.8/0.0|A 32.8/0.0|A 47.9/0.0|A 47.9/0.0|
|airun_mtz8rm42_80yi8e6t|XRPUSDC|UP|A 0.0/2.2|A 8.8/2.2|A 8.8/22.7|A 8.8/30.0|
|airun_mtz8rzmk_hkopm6tw|LTCUSDT|RANGE|D|D|D|D|
|airun_mtz8sf3i_qt19h41a|NEARUSDC|DOWN|A 0.0/8.5|A 17.0/21.3|A 34.1/21.3|A 42.6/21.3|
|airun_mtz8ssl4_o06v4y6z|BTCUSDT|UP|A 2.5/0.0|A 2.5/0.0|A 2.5/10.9|A 2.5/11.2|
|airun_mtz8t830_v80snune|ARBUSDC|DOWN|A 0.0/42.8|C 35.7/107.1|C 50.0/107.1|C 50.0/121.3|
|airun_mtz8tlkj_u3xxctq7|WLDUSDC|DOWN|A 12.6/5.1|A 12.6/22.8|A 20.2/22.8|A 20.2/25.3|
|airun_mtz8u10z_vcecf4zv|HYPEUSDT|DOWN|A 4.8/4.0|A 20.0/11.0|A 31.5/11.0|A 38.3/11.0|
|airun_mtz8uggs_y0h09qz4|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz8vup9_wbltswez|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtz8w86r_wk88hwxq|DOTUSDT|DOWN|A 0.0/8.9|A 9.9/23.8|A 14.9/23.8|A 44.6/23.8|
|airun_mtz8wnnm_yzl4hgqv|SUIUSDT|UP|A 6.9/1.4|A 34.5/42.8|A 34.5/42.8|A 34.5/42.8|
|airun_mtz8x33x_ucs9ssv0|ENAUSDT|DOWN|A 0.0/49.7|A 49.7/49.7|A 49.7/49.7|A 49.7/49.7|
|airun_mtz8xikg_2dir7gs2|XRPUSDC|UP|A 1.5/0.7|A 8.8/17.6|A 8.8/29.3|A 8.8/30.0|
|airun_mtz8xy0x_cspb2c5u|LTCUSDT|RANGE|D|D|D|D|
|airun_mtz8ybiy_34kz61ew|XMRUSDT|UP|A 23.1/5.0|A 34.9/8.3|A 35.0/37.4|C 35.0/62.7|
|airun_mtz8yqzy_2i8ef60r|ONDOUSDT|DOWN|A 2.9/5.8|A 11.5/14.4|A 11.5/14.4|A 11.5/14.4|
|airun_mtz8z6gg_alrjl697|NEARUSDC|DOWN|A 4.3/12.8|A 34.0/12.8|A 42.5/12.8|A 51.0/12.8|
|airun_mtz8zjyh_xccmrzsn|ARBUSDT|DOWN|A 0.0/49.8|C 85.3/64.0|C 85.3/64.0|C 85.3/85.3|
|airun_mtz8zzev_y7ycb1rf|BTCUSDT|UP|A 2.5/0.0|A 2.5/9.0|A 2.5/10.9|A 2.5/11.2|
|airun_mtz90cxk_wlgoy7xr|WLDUSDC|DOWN|A 0.0/15.2|A 25.3/15.2|A 27.8/15.2|A 27.8/17.7|
|airun_mtz90ub2_evndstbr|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz917tw_ldh5psnl|INJUSDT|DOWN|A 13.6/5.1|A 15.3/23.8|A 25.5/23.8|A 25.5/30.6|
|airun_mtz91na7_bfsywl1j|UNIUSDC|UP|A 12.6/7.9|A 12.6/45.6|A 12.6/45.6|A 29.9/45.6|
|airun_mtz920sp_w3zpair5|WLDUSDT|DOWN|A 30.2/2.5|A 45.4/2.5|A 45.4/2.5|A 45.4/2.5|
|airun_mtz92g90_ax87l2ey|ARBUSDC|DOWN|A 14.2/49.7|B 106.5/49.7|B 106.5/49.7|B 106.5/63.9|
|airun_mtz92vpv_zecx1lnd|HYPEUSDT|DOWN|A 12.0/3.8|A 33.9/3.8|A 40.8/3.8|A 45.5/3.8|
|airun_mtz93b61_i0ybcg9l|DOTUSDT|DOWN|A 17.8/4.9|A 28.7/4.9|A 42.5/4.9|B 76.1/4.9|
|airun_mtz93qmj_7alx9w92|SUIUSDT|UP|A 30.4/16.6|A 30.4/46.9|A 30.4/46.9|A 30.4/46.9|
|airun_mtz9446c_538fzaar|XRPUSDC|UP|A 8.1/1.5|A 8.1/23.4|A 8.1/30.7|A 8.1/30.7|
|airun_mtz94hv5_8pqxp6e1|LTCUSDT|RANGE|D|D|D|D|
|airun_mtz94v8n_79afcni1|XMRUSDT|UP|A 6.6/12.7|A 9.0/37.9|C 9.0/68.3|C 9.0/97.9|
|airun_mtz958qs_15zla7ma|ONDOUSDT|DOWN|A 25.9/0.0|A 25.9/0.0|A 25.9/0.0|A 25.9/0.0|
|airun_mtz95o6u_w5tg2yy1|NEARUSDC|DOWN|A 29.8/0.0|A 46.8/0.0|B 55.3/0.0|B 55.3/8.5|
|airun_mtz961q8_2lyhdez5|BTCUSDT|UP|A 2.5/0.0|A 2.5/10.8|A 2.5/10.9|A 2.5/11.2|
|airun_mtz96fap_jxapl4jc|INJUSDT|DOWN|A 17.0/22.1|A 17.0/22.1|A 27.2/22.1|A 27.2/34.0|
|airun_mtz96uox_obr8b4di|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtz97a4o_kwxx27c2|WLDUSDC|DOWN|A 20.2/0.0|A 27.8/0.0|A 27.8/10.1|A 27.8/17.7|
|airun_mtz97nn9_buotq59y|UNIUSDC|UP|A 0.0/36.2|A 0.0/37.8|A 18.9/37.8|A 37.8/37.8|
|airun_mtz98166_twgn48mx|ARBUSDC|DOWN|B 120.4/0.0|B 127.5/0.0|B 127.5/42.5|B 127.5/42.5|
|airun_mtz98ikm_todv7cqj|NEARUSDT|DOWN|A 17.0/0.0|A 21.3/0.0|A 29.8/4.3|A 29.8/34.1|
|airun_mtz9a2k9_08ai3kkr|DOTUSDT|DOWN|A 4.0/29.7|A 5.0/29.7|A 17.8/29.7|A 51.5/29.7|
|airun_mtz9ai0g_vjtth96x|XRPUSDC|UP|A 0.0/4.4|A 0.0/9.5|A 0.0/16.9|A 3.7/16.9|
|airun_mtz9avk5_g45w2kxk|ENAUSDT|DOWN|A 7.1/14.3|A 7.1/35.7|A 7.1/42.8|C 7.1/78.5|
|airun_mtz9bcy1_c5sva4g6|LTCUSDT|DOWN|A 1.9/5.6|A 3.7/7.5|A 11.2/7.5|A 11.2/20.5|
|airun_mtz9cwzq_hplbdmkl|BTCUSDT|UP|A 2.5/8.6|A 2.5/10.6|A 2.5/10.6|A 2.5/10.8|
|airun_mtz9daiu_0byh9d7s|INJUSDT|DOWN|A 0.0/22.1|A 10.2/22.1|A 20.4/22.1|A 20.4/42.5|
|airun_mtz9dpzg_v929edfn|ARBUSDC|DOWN|A 0.0/21.5|C 0.0/93.3|C 0.0/172.2|C 0.0/172.2|
|airun_mtz9e3hf_uon0pou6|NEARUSDT|DOWN|A 0.0/8.5|A 8.5/17.1|A 17.1/17.1|A 17.1/46.9|
|airun_mtz9eiya_0v3l42y8|WLDUSDT|DOWN|A 0.0/17.7|A 0.0/27.8|A 0.0/32.9|A 0.0/40.5|
|airun_mtz9f0cp_sgn4u85x|SUIUSDT|RANGE|D|D|D|D|
|airun_mtz9g4w6_0qcrqg21|UNIUSDT|UP|A 0.0/12.6|B 63.0/12.6|B 63.0/12.6|B 63.0/12.6|
|airun_mtz9gij3_ydjm04ep|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz9gu49_386x3m1f|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtz9h7mu_mf63zlnh|NEARUSDC|DOWN|A 25.6/0.0|A 29.8/0.0|A 38.3/0.0|A 38.3/25.6|
|airun_mtz9hn2y_3f0j0934|WLDUSDC|DOWN|A 12.6/5.1|A 12.6/25.3|A 12.6/30.4|A 12.6/32.9|
|airun_mtz9i0m0_db6y79iz|XRPUSDC|UP|A 0.7/0.7|A 3.7/7.3|A 7.3/8.1|A 12.5/8.1|
|airun_mtz9ie4e_zxx8lf8t|LTCUSDT|DOWN|A 3.7/1.9|A 5.6/7.5|A 11.2/7.5|A 11.2/20.5|
|airun_mtz9irnq_wqhf3j0x|BTCUSDT|UP|A 0.0/1.8|A 0.0/2.0|A 0.0/2.0|A 0.0/2.2|
|airun_mtz9j73o_jrexjo27|ENAUSDT|DOWN|A 35.6/0.0|A 35.6/14.2|A 35.6/28.4|C 35.6/56.9|
|airun_mtz9jmko_01bznb6b|INJUSDT|DOWN|A 13.6/0.0|A 25.5/5.1|A 30.6/8.5|A 30.6/32.3|
|airun_mtz9k20t_45jabiv2|NEARUSDT|DOWN|A 8.5/8.5|A 17.1/17.1|A 17.1/17.1|A 17.1/46.9|
|airun_mtz9khhb_ivwdl71j|SUIUSDT|RANGE|D|D|D|D|
|airun_mtz9lg90_grjsa114|DOTUSDT|DOWN|A 3.0/8.9|A 15.9/31.7|A 22.8/31.7|A 49.5/31.7|
|airun_mtz9ltqw_cisj1v2f|XMRUSDT|UP|A 9.4/4.8|A 14.8/34.5|A 14.8/34.5|C 14.8/121.3|
|airun_mtz9m7av_q3v8uost|ARBUSDC|DOWN|A 0.0/28.6|C 0.0/114.4|C 0.0/143.1|C 0.0/143.1|
|airun_mtz9mybf_dxelj5z9|UNIUSDT|UP|A 25.2/1.6|B 72.6/1.6|B 72.6/1.6|B 72.6/1.6|
|airun_mtz9ndry_dhhzat90|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz9nt7u_opn96y49|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtz9oq28_pc0nu19h|WLDUSDC|DOWN|A 2.5/22.8|A 10.1/22.8|A 10.1/27.8|A 10.1/30.3|
|airun_mtz9p3l3_3ok659v4|XRPUSDC|UP|A 4.4/0.0|A 4.4/7.3|A 8.1/7.3|A 13.2/7.3|
|airun_mtz9ph2z_a6dp3m37|LTCUSDT|DOWN|A 7.5/3.7|A 14.9/3.7|A 14.9/9.3|A 14.9/16.8|
|airun_mtz9pumn_mcopenn6|BTCUSDT|UP|A 1.1/0.3|A 1.1/0.3|A 1.1/0.3|A 1.1/0.5|
|airun_mtz9qa2m_k3o59we2|ENAUSDT|DOWN|A 21.3/14.2|A 35.6/14.2|A 35.6/28.4|C 35.6/56.9|
|airun_mtz9qnkr_mr00ule7|INJUSDT|DOWN|A 13.6/13.6|A 20.4/13.6|A 20.4/35.7|A 20.4/42.5|
|airun_mtz9r31e_uc3sz9wr|SUIUSDT|RANGE|D|D|D|D|
|airun_mtz9rzv2_1redb65b|XMRUSDT|UP|A 8.5/4.8|A 8.5/40.8|A 8.5/40.8|C 8.5/207.9|
|airun_mtz9sde9_3s97zdwv|ARBUSDC|DOWN|A 0.0/42.8|C 0.0/114.1|C 0.0/114.1|C 0.0/114.1|
|airun_mtz9sqvy_tfvmlljg|DOTUSDT|DOWN|A 15.8/22.8|A 24.7/22.8|A 45.5/22.8|B 58.4/22.8|
|airun_mtz9te41_ckg1372t|UNIUSDT|UP|A 48.8/23.6|A 48.8/23.6|A 48.8/23.6|A 48.8/23.6|
|airun_mtz9ttjh_dh9sdvoj|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtz9u73n_mqkwxg17|UNIUSDC|RANGE|D|D|D|D|
|airun_mtz9ukmb_8pfwy0bx|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtz9uy5f_fupliwyb|WLDUSDC|DOWN|A 10.1/0.0|A 17.7/17.7|A 17.7/22.7|A 17.7/22.7|
|airun_mtz9vbnb_qgp81zzt|XRPUSDC|UP|A 5.1/2.2|A 9.5/2.9|A 17.6/2.9|A 17.6/2.9|
|airun_mtz9w8hq_vtuq7o1u|BTCUSDT|UP|A 1.3/0.0|A 1.3/0.0|A 1.4/0.2|A 1.4/0.2|
|airun_mtz9wm03_1ztj5e3j|ENAUSDT|DOWN|A 35.6/7.1|A 35.6/14.2|A 35.6/35.6|C 35.6/56.9|
|airun_mtz9wzjm_u4dzjjpu|INJUSDT|DOWN|A 11.9/11.9|A 11.9/25.5|A 11.9/44.3|A 11.9/51.1|
|airun_mtz9xd2e_9kciapop|SUIUSDT|DOWN|A 9.7/0.0|A 9.7/16.6|A 9.7/22.2|A 9.7/22.2|
|airun_mtz9xsit_nr5vofbw|XMRUSDT|UP|A 0.0/36.0|A 5.4/36.0|A 5.4/46.5|C 5.4/203.2|
|airun_mtz9y61a_sb0xwidp|ARBUSDC|DOWN|A 0.0/21.3|A 0.0/49.6|A 28.3/49.6|A 28.3/49.6|
|airun_mtz9ylip_jvop9iei|LTCUSDT|DOWN|A 5.6/1.9|A 5.6/5.6|A 5.6/26.2|A 5.6/50.4|
|airun_mtz9ztxa_3m4esqz9|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtza07g6_9vlq5vvj|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtza0mx5_tbwam09m|WLDUSDC|DOWN|A 7.6/12.6|A 7.6/30.4|A 7.6/32.9|A 7.6/32.9|
|airun_mtza12eh_bp8gepe6|WLDUSDT|DOWN|A 5.1/15.2|A 5.1/20.2|A 5.1/27.8|A 5.1/27.8|
|airun_mtza1huw_0q7mj58c|DOTUSDT|DOWN|A 1.0/18.8|A 1.0/42.7|A 25.8/42.7|A 38.7/42.7|
|airun_mtza1xb6_mc0pcvgm|UNIUSDC|RANGE|D|D|D|D|
|airun_mtza2atl_kwiskt98|XRPUSDC|UP|A 11.0/0.0|A 14.7/0.0|A 19.8/0.0|A 19.8/0.0|
|airun_mtza2odo_p09au7pi|BTCUSDT|UP|A 1.3/0.0|A 1.4/0.0|A 1.4/0.2|A 1.4/0.2|
|airun_mtza33t1_smgzqasx|ENAUSDT|DOWN|A 7.1/7.1|A 7.1/35.6|C 7.1/56.9|C 7.1/64.1|
|airun_mtza3hck_nskvwe92|INJUSDT|DOWN|A 0.0/20.4|A 8.5/34.1|A 8.5/47.7|A 8.5/54.5|
|airun_mtza3uux_wcd27wzx|SUIUSDT|DOWN|A 0.0/11.1|A 5.5/16.6|A 5.5/22.2|A 5.5/22.2|
|airun_mtza4aao_r1n8moyx|ARBUSDC|DOWN|A 0.0/42.5|A 21.2/42.5|A 35.4/42.5|A 35.4/42.5|
|airun_mtza4pr4_0qtrki17|LTCUSDT|DOWN|A 3.7/5.6|A 5.6/11.2|A 5.6/26.2|A 5.6/50.4|
|airun_mtza67ux_nony7w3v|XMRUSDT|UP|A 20.5/20.9|A 20.5/20.9|A 20.5/50.6|C 20.5/190.9|
|airun_mtza6ncc_24ud99fj|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtza70vh_ulutbgn4|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtza7edp_ux1e5zhm|WLDUSDC|DOWN|A 17.7/7.6|A 27.8/10.1|A 27.8/12.6|A 27.8/12.6|
|airun_mtza7rwl_1x9ay3vw|DOTUSDT|DOWN|A 4.0/36.7|A 26.8/36.7|A 44.6/36.7|A 44.6/36.7|
|airun_mtza85ey_9e0ig2d5|UNIUSDC|RANGE|D|D|D|D|
|airun_mtza8iyw_tdx7j18d|XRPUSDC|UP|A 1.5/3.7|A 6.6/4.4|A 9.5/4.4|A 9.5/4.4|
|airun_mtza8wgl_s2l3hcwx|NEARUSDT|DOWN|A 8.5/4.3|A 17.0/8.5|A 17.0/34.1|A 34.1/34.1|
|airun_mtza9a02_h7p4e10y|BTCUSDT|UP|A 1.3/0.1|A 1.3/0.1|A 1.3/0.3|A 1.3/0.3|
|airun_mtza9pgo_k4m1hfe3|ENAUSDT|DOWN|A 7.1/21.4|A 7.1/42.7|C 7.1/56.9|C 7.1/64.1|
|airun_mtzaa4wc_ayp2dbho|SUIUSDT|DOWN|A 15.2/6.9|A 15.2/12.5|A 15.2/12.5|A 15.2/12.5|
|airun_mtzaaieq_pxsyj62j|ARBUSDC|DOWN|A 35.3/0.0|B 63.6/0.0|B 63.6/0.0|B 63.6/0.0|
|airun_mtzaaxvg_xlxvh92c|LTCUSDT|DOWN|A 1.9/9.3|A 1.9/28.0|A 1.9/29.9|A 1.9/54.2|
|airun_mtzac0i8_i8zcwn4m|NEARUSDC|DOWN|A 25.6/8.5|A 25.6/12.8|A 25.6/38.4|A 25.6/38.4|
|airun_mtzace15_7ks2peqn|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzacrj6_phwn5zk6|WLDUSDT|DOWN|A 7.6/17.7|A 7.6/25.3|A 7.6/25.3|A 7.6/25.3|
|airun_mtzadmg8_pgq6fg87|XMRUSDT|UP|A 4.6/8.7|A 10.5/15.4|A 10.5/47.2|C 10.5/188.4|
|airun_mtzadzyv_fftfkmdz|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzaedh8_io9x8pz9|PENGUUSDT|DOWN|A 5.5/13.8|A 5.5/23.4|A 5.5/28.9|A 5.5/33.1|
|airun_mtzaesx2_el6qzoii|XRPUSDC|DOWN|A 1.5/7.3|A 1.5/12.5|A 1.5/12.5|A 1.5/12.5|
|airun_mtzaflx8_882jxjkh|SUIUSDT|DOWN|A 2.8/19.4|A 2.8/24.9|A 2.8/24.9|A 2.8/24.9|
|airun_mtzag1c9_om2hw86w|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzagewl_6l73gykg|NEARUSDT|DOWN|A 8.5/12.8|A 8.5/38.4|A 8.5/42.6|A 25.6/42.6|
|airun_mtzagsev_44f2ndec|LTCUSDT|DOWN|A 11.2/5.6|A 11.2/20.5|A 11.2/20.5|A 11.2/44.8|
|airun_mtzah5y5_z13wqr9t|INJUSDT|DOWN|A 23.8/18.7|A 23.8/32.3|A 23.8/39.1|C 23.8/61.2|
|airun_mtzahjgb_8fnfeb0o|BTCUSDT|RANGE|D|D|D|D|
|airun_mtzaitt1_7sayvku8|DOTUSDT|DOWN|A 20.8/42.7|A 25.8/42.7|A 38.7/42.7|A 38.7/42.7|
|airun_mtzaj7as_ivzn7hjq|NEARUSDC|DOWN|A 8.5/4.3|A 29.8/34.1|A 29.8/34.1|A 29.8/34.1|
|airun_mtzajmqu_vpv9avgp|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzakjkx_clcd4hwb|XRPUSDC|DOWN|A 0.0/1.5|A 6.6/6.6|A 6.6/6.6|A 6.6/6.6|
|airun_mtzakx32_t9nqg0wn|SUIUSDT|DOWN|A 4.2/6.9|A 9.7/12.5|A 13.8/12.5|A 13.8/12.5|
|airun_mtzalciy_18bcw7vq|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzalq31_fm801r1d|LINKUSDT|DOWN|A 0.0/15.7|A 0.0/19.2|A 0.0/19.2|A 0.0/19.2|
|airun_mtzam5iw_y5opqbkx|ENAUSDT|DOWN|A 28.4/7.1|A 28.4/35.5|A 28.4/42.6|A 28.4/42.6|
|airun_mtzamkzb_orcmbnjt|FILUSDT|UP|A 48.4/0.0|A 50.8/14.9|B 179.8/14.9|B 179.8/14.9|
|airun_mtzan0i3_6jfoq6lg|WLDUSDT|DOWN|A 2.5/20.2|A 2.5/20.2|A 2.5/20.2|A 7.6/20.2|
|airun_mtzanfz9_5m0obe0k|PENGUUSDT|DOWN|A 2.8/23.4|A 2.8/29.0|A 2.8/31.7|A 2.8/45.5|
|airun_mtzanvfa_ah9qs33e|LTCUSDT|DOWN|A 16.8/14.9|A 16.8/14.9|A 16.8/14.9|A 16.8/39.2|
|airun_mtzaoavp_fk0glmsu|INJUSDT|DOWN|A 39.1/17.0|A 39.1/18.7|A 39.1/23.8|A 39.1/47.6|
|airun_mtzaoqd6_8iyb1x70|BTCUSDT|RANGE|D|D|D|D|
|airun_mtzap7qj_nzlfobey|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzaplao_eiw9g6jq|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzapyt8_6u40ij58|NEARUSDC|DOWN|A 25.6/12.8|A 25.6/38.4|A 25.6/38.4|A 25.6/38.4|
|airun_mtzaqcd8_r1dvmu5z|XMRUSDT|UP|A 16.1/9.1|A 16.1/35.7|C 16.1/95.7|C 16.1/182.9|
|airun_mtzarb4g_q5fkp0v3|XRPUSDC|DOWN|A 10.3/2.9|A 10.3/2.9|A 10.3/2.9|A 10.3/2.9|
|airun_mtzarqkj_uh9tcluk|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzas61z_6ii7b4zy|SUIUSDT|DOWN|A 22.1/0.0|A 23.5/0.0|A 26.3/0.0|A 26.3/0.0|
|airun_mtzaslhm_888g5mep|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzasyzl_5m9de0ms|LINKUSDT|DOWN|A 11.3/2.6|A 11.3/2.6|A 11.3/2.6|A 11.3/12.2|
|airun_mtzateft_meuwzbx7|PENGUUSDT|DOWN|A 4.1/11.0|A 9.6/13.8|A 9.6/15.1|A 9.6/48.2|
|airun_mtzattwf_pb9bbati|NEARUSDT|DOWN|A 0.0/25.6|A 0.0/29.8|A 17.0/29.8|A 42.6/29.8|
|airun_mtzau9d0_qr7xrqcf|LTCUSDT|DOWN|A 20.5/11.2|A 20.5/11.2|A 20.5/11.2|A 20.5/41.0|
|airun_mtzauotn_d0ikj4t4|BTCUSDT|RANGE|D|D|D|D|
|airun_mtzav2cb_wc8ru45w|WLDUSDC|DOWN|A 0.0/10.1|A 7.6/20.2|A 7.6/20.2|A 12.6/35.4|
|airun_mtzavtey_c6qikvds|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzaw90w_ayme5hlq|INJUSDT|DOWN|A 13.6/6.8|A 13.6/18.7|A 42.4/20.4|C 42.4/56.0|
|airun_mtzawocp_w3ko03zl|HYPEUSDT|DOWN|A 1.0/37.0|A 1.0/37.0|A 11.3/37.0|A 12.5/37.0|
|airun_mtzax3s8_k3ok1pez|ONDOUSDT|DOWN|A 0.0/17.3|A 2.9/17.3|A 5.8/17.3|A 8.6/20.1|
|airun_mtzaxj9y_b5dh242j|NEARUSDC|DOWN|A 0.0/8.5|A 17.0/8.5|A 34.0/8.5|B 55.3/8.5|
|airun_mtzay6gf_82q28qlw|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzayly7_n8k5sax5|XRPUSDC|DOWN|A 0.0/2.2|A 4.4/2.9|A 6.6/2.9|A 6.6/10.3|
|airun_mtzayzga_xu9ymruj|SUIUSDT|DOWN|A 4.2/8.3|A 8.3/8.3|A 11.1/8.3|A 11.1/22.1|
|airun_mtzazczm_6u22az02|ENAUSDT|DOWN|A 28.3/0.0|A 28.3/0.0|A 28.3/7.1|A 28.3/28.3|
|airun_mtzazsga_feeyntb7|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzb05y5_61ktmwlw|LINKUSDT|DOWN|A 8.7/1.7|A 8.7/3.5|A 8.7/5.2|A 8.7/19.1|
|airun_mtzb0jhu_vo818tiq|PENGUUSDT|DOWN|A 16.5/2.8|A 16.5/6.9|A 16.5/8.3|A 16.5/45.4|
|airun_mtzb0x06_j6g2dwm4|LTCUSDT|DOWN|A 16.8/1.9|A 16.8/1.9|A 16.8/28.0|A 16.8/41.0|
|airun_mtzb1ajz_mg3xx7bs|BTCUSDT|DOWN|A 0.0/1.6|A 0.0/1.6|A 0.0/1.6|A 0.0/6.0|
|airun_mtzb1q0r_gov2tscr|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzb23jo_qatkhn1g|WLDUSDC|DOWN|A 7.6/10.1|A 7.6/20.2|A 12.6/20.2|A 12.6/35.4|
|airun_mtzb2h32_sthtkr0s|INJUSDT|DOWN|A 17.0/11.9|A 17.0/13.6|A 49.2/13.6|A 49.2/49.2|
|airun_mtzb2umm_pw22j9rm|ONDOUSDT|DOWN|A 5.8/11.5|A 8.6/11.5|A 11.5/14.4|A 11.5/17.3|
|airun_mtzb3a3h_rukm2hdo|NEARUSDC|DOWN|A 17.0/4.3|A 17.0/8.5|A 51.0/8.5|B 55.3/8.5|
|airun_mtzb3pj9_p5p0lfq7|XMRUSDT|UP|A 8.5/3.0|A 12.1/41.6|C 12.1/141.3|C 12.1/150.6|
|airun_mtzb433g_s881ffys|XRPUSDC|DOWN|A 4.4/2.9|A 4.4/2.9|A 6.6/2.9|A 6.6/15.4|
|airun_mtzb4glp_2rs443wf|SUIUSDT|DOWN|A 4.2/11.1|A 6.9/11.1|A 6.9/11.1|A 6.9/27.7|
|airun_mtzb4w3f_2wovwl9b|ENAUSDT|DOWN|A 0.0/21.3|A 0.0/28.4|A 0.0/28.4|A 0.0/49.6|
|airun_mtzb5bjt_ka9dkwup|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzb5p39_f5npxnq2|LINKUSDT|DOWN|A 0.0/10.5|A 0.0/13.9|A 0.0/13.9|A 0.0/30.5|
|airun_mtzb64it_6b5emgem|LTCUSDT|DOWN|A 0.0/9.3|A 0.0/9.3|A 0.0/37.3|C 0.0/125.0|
|airun_mtzb6i1c_0bxh1mnj|BTCUSDT|DOWN|A 1.6/0.0|A 1.6/0.0|A 1.6/0.0|A 1.6/4.6|
|airun_mtzb6xis_0doyn0w5|PENGUUSDT|DOWN|A 12.4/11.0|A 12.4/11.0|A 12.4/12.4|A 12.4/49.5|
|airun_mtzb7cyt_0kthm3hk|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzb8t6n_4zldsoaz|WLDUSDC|DOWN|A 7.6/0.0|A 15.1/0.0|A 32.8/0.0|A 32.8/15.1|
|airun_mtzb98o5_gtbi4qo1|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzb9m8t_5uz5932d|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzba3nw_whipok53|ONDOUSDT|DOWN|A 0.0/2.9|A 11.5/11.5|A 14.4/14.4|A 14.4/14.4|
|airun_mtzbc16l_b5viax4n|WLDUSDT|DOWN|A 2.5/5.0|A 7.6/7.6|A 20.2/7.6|A 20.2/22.7|
|airun_mtzbcgmx_bc5vd8vp|NEARUSDT|DOWN|A 8.5/0.0|A 42.5/0.0|B 63.7/0.0|B 68.0/0.0|
|airun_mtzbcu53_rujnpdfx|INJUSDT|DOWN|A 11.9/11.9|A 50.9/11.9|A 50.9/25.4|A 50.9/47.5|
|airun_mtzbd7mo_badr4l3y|XMRUSDT|UP|A 16.0/9.1|C 16.0/133.4|C 16.0/146.8|C 16.0/146.8|
|airun_mtzbdl68_p9yda53i|SUIUSDT|DOWN|A 5.5/1.4|A 13.8/1.4|A 13.8/1.4|A 13.8/20.8|
|airun_mtzbe0m7_jms5xs0v|ENAUSDT|DOWN|A 0.0/7.1|A 0.0/14.2|A 14.2/14.2|A 14.2/35.4|
|airun_mtzbeg2c_km3c25ts|LINKUSDT|DOWN|A 8.7/3.5|A 8.7/5.2|A 8.7/5.2|A 8.7/23.5|
|airun_mtzbeviy_hc8agll3|LTCUSDT|DOWN|A 3.7/1.9|A 3.7/3.7|A 3.7/29.8|C 3.7/156.6|
|airun_mtzbfb0i_gxh28u36|BTCUSDT|DOWN|A 1.6/0.0|A 1.6/0.0|A 1.6/0.0|A 1.6/4.6|
|airun_mtzbfqfr_nf4twg93|PENGUUSDT|DOWN|A 5.5/4.1|A 6.9/6.9|A 8.3/9.6|A 17.9/44.0|
|airun_mtzbg5vt_ts7trdyj|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzbgjek_hgzh0u12|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzbgyuz_kvmh2n2y|ONDOUSDT|DOWN|A 11.5/0.0|A 11.5/11.5|A 14.4/14.4|A 14.4/14.4|
|airun_mtzbhg9s_oww6ayu5|NEARUSDC|DOWN|A 17.0/0.0|A 34.0/0.0|A 51.0/0.0|B 55.3/0.0|
|airun_mtzbhvpj_347fnpri|XRPUSDC|DOWN|A 1.5/0.0|A 5.9/0.0|A 5.9/0.0|A 5.9/19.1|
|airun_mtzbib6o_nm2m6isr|WLDUSDT|DOWN|A 2.5/5.0|A 17.7/5.0|A 22.7/5.0|A 22.7/20.2|
|airun_mtzbisin_f0z15szw|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzbj9y0_bqp5mw7g|INJUSDT|DOWN|A 5.1/20.4|A 37.4/20.4|A 37.4/47.6|C 37.4/61.2|
|airun_mtzbjphb_ux7rwyan|WLDUSDC|DOWN|A 0.0/5.0|A 12.6/5.0|A 25.2/5.0|A 25.2/22.7|
|airun_mtzbk4wy_7qlgrohp|SUIUSDT|DOWN|A 11.1/2.8|A 11.1/2.8|A 11.1/4.2|A 11.1/27.7|
|airun_mtzbkieq_zuagvdv7|ENAUSDT|DOWN|A 14.1/0.0|A 21.2/0.0|A 28.3/0.0|A 28.3/21.2|
|airun_mtzbkxwc_c4o8umno|LINKUSDT|DOWN|A 7.0/0.0|A 13.9/0.0|A 13.9/0.0|A 13.9/32.2|
|airun_mtzbmaah_djyllyfa|APTUSDT|DOWN|A 42.1/0.0|A 42.1/0.0|A 47.1/0.0|A 47.1/21.9|
|airun_mtzbmnsn_kq91m3ya|LTCUSDT|DOWN|A 3.7/0.0|A 3.7/29.8|A 3.7/29.8|C 3.7/156.6|
|airun_mtzbn39l_ah7l05rg|BTCUSDT|DOWN|A 1.6/0.0|A 1.6/0.0|A 1.6/0.7|A 1.6/9.7|
|airun_mtzbngqk_joato242|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzbnua0_sfbung8w|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzbo9q4_9jvowtnl|NEARUSDC|DOWN|A 12.8/0.0|A 29.8/0.0|A 29.8/4.3|A 34.1/4.3|
|airun_mtzbon7w_eiqlevwk|HYPEUSDT|DOWN|A 11.8/36.0|A 13.4/36.0|A 13.5/36.0|A 13.5/36.2|
|airun_mtzbp2ny_khgt7uos|PENGUUSDT|DOWN|A 2.8/11.0|A 2.8/11.0|A 13.8/22.0|A 13.8/48.2|
|airun_mtzbpi4u_o843i9rh|XRPUSDC|DOWN|A 2.9/0.7|A 2.9/0.7|A 2.9/5.9|A 2.9/30.1|
|airun_mtzbpxkb_qj507ejz|WLDUSDT|DOWN|A 2.5/2.5|A 15.1/2.5|A 15.1/12.6|A 15.1/27.8|
|airun_mtzbqd1o_ye1egciv|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzbqshu_csjh7vfc|INJUSDT|DOWN|A 1.7/28.9|A 1.7/34.0|C 28.9/57.8|C 28.9/69.7|
|airun_mtzbr7z0_sdf9axtn|WLDUSDC|DOWN|A 2.5/5.1|A 17.7/5.1|A 17.7/12.6|A 17.7/30.3|
|airun_mtzbrpbj_ug15p19g|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzbsk8c_45po1cdl|ENAUSDT|DOWN|A 0.0/7.1|A 14.2/7.1|A 14.2/21.2|A 14.2/42.5|
|airun_mtzbth4e_glwkwn4l|ONDOUSDT|DOWN|A 5.8/0.0|A 8.6/20.1|A 8.6/20.1|A 11.5/20.1|
|airun_mtzbtwis_fqbund9w|APTUSDT|DOWN|A 3.4/5.1|A 23.6/5.1|A 23.6/30.4|A 23.6/47.2|
|airun_mtzbubyb_mwp9intv|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzbupg9_0q0vosso|LTCUSDT|DOWN|A 0.0/33.6|A 0.0/33.6|A 0.0/35.4|C 0.0/160.4|
|airun_mtzbv2zm_tr4d88lw|BTCUSDT|DOWN|A 0.4/0.5|A 0.4/1.2|A 0.4/2.0|A 0.4/10.9|
|airun_mtzbvghb_woclxknl|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzbvu3e_uixa1iix|NEARUSDC|DOWN|A 8.5/4.3|A 21.3/4.3|A 25.6/12.8|A 25.6/12.8|
|airun_mtzbw7k6_n4d5no30|PENGUUSDT|DOWN|A 9.6/1.4|A 13.7/4.1|A 23.4/34.4|A 23.4/38.5|
|airun_mtzbwl2z_6o903lvz|XRPUSDC|DOWN|A 0.7/0.7|A 0.7/2.9|A 0.7/12.5|A 0.7/32.3|
|airun_mtzbx0ir_07xbeo5d|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzbxfyt_kuhntnwl|INJUSDT|DOWN|A 1.7/8.5|A 6.8/27.1|A 49.2/49.2|C 49.2/57.7|
|airun_mtzbxvfk_4hnte3r8|WLDUSDC|DOWN|A 12.6/2.5|A 20.2/5.1|A 20.2/27.8|A 20.2/27.8|
|airun_mtzbyw53_kgpvwczn|ENAUSDT|DOWN|A 21.2/0.0|A 21.2/0.0|A 21.2/28.3|A 21.2/35.4|
|airun_mtzbzblp_15g3l333|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzbzr34_xeimqvf7|LINKUSDT|DOWN|A 2.6/0.9|A 3.5/1.7|A 3.5/20.9|A 3.5/49.6|
|airun_mtzc06ig_tz3xjakm|ONDOUSDT|DOWN|A 2.9/0.0|A 2.9/25.9|A 2.9/25.9|A 5.8/25.9|
|airun_mtzc0k2r_qwr98j7k|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzc0xka_e261ozn5|LTCUSDT|DOWN|A 5.6/0.0|A 5.6/1.9|A 5.6/13.0|C 5.6/128.3|
|airun_mtzc207k_4ke6zdnb|APTUSDT|DOWN|A 20.2/0.0|A 20.2/27.0|A 20.2/47.2|A 20.2/50.6|
|airun_mtzc2foi_ni2yc4ed|NEARUSDC|DOWN|A 8.5/0.0|A 8.5/17.1|A 12.8/25.6|A 12.8/25.6|
|airun_mtzc2t84_jllceln7|PENGUUSDT|DOWN|A 11.0/0.0|A 20.6/6.9|A 20.6/41.2|A 20.6/41.2|
|airun_mtzc3ryu_yvdpkyxx|OPUSDT|DOWN|A 0.0/10.5|A 0.0/21.0|C 0.0/63.0|C 0.0/83.9|
|airun_mtzc4oue_iw2adip2|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzc52gj_1m12q0kh|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzc5hr0_bjfz72og|INJUSDT|DOWN|A 5.1/15.3|B 56.0/28.8|B 56.0/42.4|B 56.0/100.0|
|airun_mtzc5vbl_nealxovt|WLDUSDC|DOWN|A 0.0/2.5|A 0.0/25.3|A 0.0/43.0|A 0.0/53.1|
|airun_mtzc68tj_bxjgugn6|NEARUSDT|DOWN|A 8.5/4.3|A 8.5/29.9|A 12.8/29.9|A 12.8/34.2|
|airun_mtzc6ob2_4vo5dhxr|ENAUSDT|DOWN|A 0.0/7.1|A 0.0/28.4|A 0.0/49.6|C 0.0/70.9|
|airun_mtzc71vs_7f0l8yy1|LINKUSDT|DOWN|A 0.9/1.7|A 0.9/7.8|A 0.9/24.4|C 0.9/57.5|
|airun_mtzc7fem_vvwnn09o|ONDOUSDT|DOWN|A 0.0/2.9|A 0.0/28.8|A 0.0/28.8|A 2.9/28.8|
|airun_mtzc7uu5_vwf5tb2v|LTCUSDT|DOWN|A 0.0/5.6|A 0.0/5.6|C 0.0/55.8|C 0.0/132.0|
|airun_mtzc8aav_v3868goy|BTCUSDT|DOWN|A 0.0/1.6|A 0.0/2.4|A 0.0/6.2|A 0.0/13.7|
|airun_mtzc8nry_eswjlsyk|ETHFIUSDT|DOWN|A 33.5/2.9|A 33.5/51.0|C 33.5/113.6|C 33.5/113.6|
|airun_mtzc9u9l_er44vstf|PENGUUSDT|DOWN|A 4.1/6.9|A 20.6/16.5|A 20.6/41.2|A 20.6/44.0|
|airun_mtzca7td_f1xfaut9|XRPUSDC|DOWN|A 0.0/2.2|A 0.0/7.3|A 0.0/23.5|A 0.0/31.5|
|airun_mtzcbebw_84netaqh|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzcc5ki_ibn01yhd|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzccmwe_x1lzxjhw|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzcd0fs_yvcegt22|WLDUSDC|DOWN|A 0.0/10.1|A 0.0/17.7|A 0.0/32.9|A 0.0/53.1|
|airun_mtzcddy4_wox632c9|NEARUSDT|DOWN|A 17.1/0.0|A 21.3/21.3|A 21.3/21.3|A 21.3/25.6|
|airun_mtzcdri6_gn8fkm8h|ENAUSDT|DOWN|A 7.1/0.0|A 7.1/14.2|A 7.1/28.3|A 7.1/49.5|
|airun_mtzce4yk_i93lqzir|OPUSDT|DOWN|A 10.5/10.5|A 10.5/31.4|C 10.5/62.9|C 10.5/83.9|
|airun_mtzcemdt_94e63m19|INJUSDT|DOWN|B 71.1/10.2|B 71.1/22.0|B 71.1/27.1|B 71.1/106.7|
|airun_mtzcf1uf_k3ebs991|LINKUSDT|DOWN|A 0.9/4.4|A 0.9/20.9|A 0.9/27.0|C 0.9/58.3|
|airun_mtzcffb8_rqco41w0|LTCUSDT|DOWN|A 0.0/3.7|A 1.9/9.3|C 1.9/130.2|C 1.9/130.2|
|airun_mtzcfsup_rh4mlz8g|BTCUSDT|DOWN|A 0.0/1.5|A 0.0/2.3|A 0.0/6.1|A 0.0/13.6|
|airun_mtzcg8ax_66qof5xh|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzcgnq8_kwowqdfv|APTUSDT|DOWN|A 5.1/28.7|A 5.1/47.3|A 5.1/50.6|C 5.1/67.5|
|airun_mtzch19o_wkx6o1xr|PENGUUSDT|DOWN|A 22.0/11.0|A 22.0/39.9|A 22.0/39.9|A 22.0/42.6|
|airun_mtzchgpx_ascch443|XRPUSDC|DOWN|A 0.7/5.1|A 0.7/13.9|A 0.7/22.0|A 0.7/30.1|
|airun_mtzchw6n_isgbypay|AVAXUSDT|DOWN|A 0.0/21.6|A 0.0/35.2|A 0.0/43.3|C 0.0/81.2|
|airun_mtzciuxp_jb8cy9p7|NEARUSDC|DOWN|A 0.0/12.8|A 21.3/17.1|A 21.3/17.1|A 21.3/17.1|
|airun_mtzcj8ff_ectkwp3o|WLDUSDC|DOWN|A 0.0/7.6|A 0.0/25.3|A 0.0/25.3|A 0.0/45.5|
|airun_mtzcjptx_jx15cwfw|ETHFIUSDT|DOWN|A 0.0/30.6|C 0.0/109.2|C 0.0/109.2|C 0.0/109.2|
|airun_mtzck5ag_8uavqa6v|ENAUSDT|DOWN|A 0.0/7.1|A 0.0/28.3|A 0.0/28.3|A 0.0/49.5|
|airun_mtzckkrm_vfz3nzjn|OPUSDT|DOWN|A 10.5/0.0|A 10.5/52.4|C 10.5/62.9|C 10.5/83.9|
|airun_mtzckyad_9maws6es|INJUSDT|DOWN|A 5.1/3.4|A 5.1/15.2|A 8.5/15.2|C 10.1/108.2|
|airun_mtzcldt2_oefyunpq|LINKUSDT|DOWN|A 0.9/4.4|A 0.9/18.3|A 0.9/28.7|A 0.9/54.0|
|airun_mtzclrdw_9n27nxgh|LTCUSDT|RANGE|D|D|D|D|
|airun_mtzcm4vy_uaff20l2|BTCUSDT|DOWN|A 0.0/0.3|A 0.0/3.2|A 0.0/9.2|A 0.0/11.7|
|airun_mtzcmkdj_ppijb7ve|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzcnwso_56iooszu|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzcoc9p_yrni2p32|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzcopr1_ln4ziumm|XRPUSDC|DOWN|A 0.0/1.5|A 0.0/11.7|A 0.0/17.6|A 0.0/24.9|
|airun_mtzcpmlq_i4lf2wdz|NEARUSDC|DOWN|A 34.1/0.0|A 34.1/0.0|A 34.1/0.0|A 34.1/4.3|
|airun_mtzcq21m_et5cdi3j|WLDUSDC|DOWN|A 0.0/5.0|A 0.0/20.2|A 0.0/20.2|A 0.0/40.4|
|airun_mtzcqldx_hzsuj6jp|ETHFIUSDT|DOWN|C 0.0/62.3|C 31.9/62.3|C 43.5/62.3|C 47.8/62.3|
|airun_mtzcqyu2_62iqadmi|ENAUSDT|DOWN|A 0.0/7.1|A 0.0/21.2|A 0.0/21.2|A 0.0/42.4|
|airun_mtzcreb3_yp85kuhe|INJUSDT|DOWN|A 0.0/11.8|A 0.0/16.9|A 8.5/16.9|C 8.5/109.9|
|airun_mtzcrtrp_ravm2sg8|LTCUSDT|RANGE|D|D|D|D|
|airun_mtzcs7ca_43e75tao|AVAXUSDT|DOWN|A 1.3/13.5|A 1.3/20.2|A 1.3/32.4|C 1.3/60.7|
|airun_mtzcskts_g98fj2ih|OPUSDT|DOWN|A 0.0/31.4|A 0.0/52.4|A 0.0/52.4|C 0.0/73.3|
|airun_mtzct0aq_r0d6dgy3|BTCUSDT|DOWN|A 0.3/0.6|A 0.3/3.8|A 0.3/8.9|A 0.3/11.7|
|airun_mtzctfsf_n74du8oo|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzctv8h_s8jqd5ez|APTUSDT|DOWN|A 38.7/13.5|A 38.7/16.8|A 38.7/18.5|A 38.7/33.6|
|airun_mtzcu8t2_f6001f40|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzcuo9m_0f61yu2r|XRPUSDC|DOWN|A 0.0/6.6|A 0.0/14.7|A 0.0/22.7|A 0.0/22.7|
|airun_mtzcv3pv_kkb41301|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzcw0q7_xk3wjmbr|WLDUSDC|DOWN|A 0.0/5.0|A 10.1/5.0|A 15.1/5.0|A 15.1/25.2|
|airun_mtzcwg6a_5p0hbn84|ETHFIUSDT|DOWN|A 15.9/20.2|B 85.1/20.2|B 85.1/20.2|B 99.6/20.2|
|airun_mtzcwvlz_ctuxmxkt|ENAUSDT|DOWN|A 0.0/7.1|A 14.1/7.1|A 14.1/14.1|A 14.1/28.2|
|airun_mtzcxsg3_gqe50d04|LTCUSDT|RANGE|D|D|D|D|
|airun_mtzcy600_w6624ess|AVAXUSDT|DOWN|A 10.8/0.0|A 10.8/8.1|A 10.8/20.2|D|
|airun_mtzcylgg_agyiqphd|OPUSDT|DOWN|A 0.0/10.4|A 10.4/20.9|A 20.9/20.9|D|
|airun_mtzcyyzt_v28r1yzs|BTCUSDT|DOWN|A 0.9/2.3|A 0.9/3.3|A 0.9/8.3|D|
|airun_mtzczcip_08cqhp6l|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzczq08_pv1qz32d|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzd0qqr_nma1zoo7|INJUSDT|DOWN|A 5.1/0.0|A 15.2/8.4|A 16.9/23.7|D|
|airun_mtzd1834_gqilj2ke|XRPUSDC|DOWN|A 0.7/3.7|A 0.7/8.8|A 0.7/16.8|D|
|airun_mtzd1nki_bno6vhi5|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzd2157_rnw456x7|ETHFIUSDT|DOWN|A 27.4/24.5|B 80.8/24.5|B 80.8/24.5|D|
|airun_mtzd2emd_yv0czfe6|ENAUSDT|DOWN|A 7.1/0.0|A 14.1/0.0|A 14.1/14.1|D|
|airun_mtzd3bj0_rav1zyzh|NEARUSDC|DOWN|A 4.3/17.1|A 4.3/21.3|A 4.3/21.3|D|
|airun_mtzd3p0c_5ywdtyl8|OPUSDT|DOWN|A 10.4/10.4|A 31.3/10.4|A 31.3/10.4|D|
|airun_mtzd42kq_234qg46e|BTCUSDT|DOWN|A 0.7/0.9|A 0.7/6.0|A 0.7/7.5|D|
|airun_mtzd574j_ieg42v44|HYPEUSDT|DOWN|A 4.4/4.5|A 9.3/4.7|A 9.3/7.9|D|
|airun_mtzd5ml6_2iz2tdf6|APTUSDT|DOWN|A 5.0/8.4|A 47.1/8.4|A 47.1/10.1|D|
|airun_mtzd621f_u8wuh0ox|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzd76n3_7bvluylb|NEARUSDT|DOWN|A 0.0/12.8|A 21.3/12.8|A 21.3/25.6|D|
|airun_mtzd7m30_kbvjqnzd|INJUSDT|DOWN|A 6.8/5.1|A 20.3/5.1|C 20.3/62.5|D|
|airun_mtzd81kb_wr94luti|XRPUSDC|DOWN|A 0.0/2.9|A 2.2/3.7|A 2.2/11.0|D|
|airun_mtzd8h0n_rtj0zzdq|ENAUSDT|DOWN|A 14.1/0.0|A 14.1/7.1|A 14.1/28.2|D|
|airun_mtzd8ui9_a8k1s1lz|WLDUSDC|DOWN|A 7.6/2.5|A 12.6/2.5|A 12.6/20.2|D|
|airun_mtzd99xz_2ef0156c|NEARUSDC|DOWN|A 4.3/8.5|A 17.1/8.5|A 17.1/12.8|D|
|airun_mtzd9ni0_22h4qnk0|OPUSDT|DOWN|A 31.3/0.0|A 41.7/0.0|A 41.7/10.4|D|
|airun_mtzdakay_jh4o373v|HYPEUSDT|DOWN|A 3.3/8.2|A 5.8/8.2|A 5.8/13.7|D|
|airun_mtzdazri_h0qgxw24|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzdbdbx_bt0hpjem|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzdbssj_k9v5nebf|ETHFIUSDT|DOWN|A 5.8/2.9|A 5.8/32.0|A 5.8/53.8|D|
|airun_mtzdc88h_4aykfb7a|BTCUSDT|DOWN|A 0.0/0.1|A 0.0/5.1|A 0.0/7.6|D|
|airun_mtzdehhy_ndytdx15|XRPUSDC|DOWN|A 2.2/0.0|A 2.2/11.0|A 2.2/11.0|D|
|airun_mtzdewy5_7u9qi5hq|ENAUSDT|DOWN|A 7.1/0.0|A 7.1/21.2|A 7.1/35.3|D|
|airun_mtzdfcea_xtj0rs46|WLDUSDC|DOWN|A 2.5/2.5|A 2.5/7.6|A 2.5/37.9|D|
|airun_mtzdfpvx_oahw2ju8|NEARUSDC|DOWN|A 12.8/0.0|A 12.8/8.5|A 12.8/17.1|D|
|airun_mtzdg5c2_pwlsus7l|OPUSDT|DOWN|A 10.4/10.4|A 10.4/20.9|A 10.4/52.2|D|
|airun_mtzdgivc_wn6ujpg9|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzdgybn_zm07e4y8|ETHFIUSDT|DOWN|A 8.7/8.7|A 8.7/39.3|A 8.7/53.8|D|
|airun_mtzdhfos_627xx4sk|BTCUSDT|DOWN|A 0.1/5.1|A 0.1/5.1|A 0.1/7.5|D|
|airun_mtzdhv4g_7mmnld3b|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzdi8p2_ifgr38ev|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzdim6f_zlitw5yf|INJUSDT|DOWN|A 8.5/0.0|A 8.5/13.5|C 8.5/96.4|D|
|airun_mtzdjd8i_z3x6e6ai|NEARUSDT|DOWN|A 21.3/8.5|A 21.3/8.5|A 21.3/25.6|D|
|airun_mtzdjqt5_mbds80ef|DOTUSDT|DOWN|A 6.9/18.8|A 6.9/18.8|A 6.9/50.5|D|
|airun_mtzdke1c_s1h0btqm|ENAUSDT|DOWN|A 0.0/14.1|A 0.0/21.2|A 0.0/35.3|D|
|airun_mtzdl8z2_qufffjs1|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzdlogf_8gb3p96l|XRPUSDC|DOWN|A 0.0/11.0|A 0.0/11.0|A 0.0/11.0|D|
|airun_mtzdm3vw_1np08tlu|WLDUSDC|DOWN|A 2.5/5.0|A 2.5/10.1|A 2.5/37.9|D|
|airun_mtzdmldf_080a31ot|NEARUSDC|DOWN|A 4.3/8.5|A 12.8/8.5|A 12.8/17.1|D|
|airun_mtzdmyt5_be8901w6|BTCUSDT|DOWN|A 5.1/0.1|A 5.1/1.5|A 5.1/2.5|D|
|airun_mtzdnxkk_0m7qswwe|INJUSDT|DOWN|A 0.0/6.8|C 0.0/66.0|C 0.0/113.3|D|
|airun_mtzdoexo_hsuprzbk|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtzdosjs_ra7ucp28|OPUSDT|DOWN|A 10.4/0.0|A 20.9/31.3|A 20.9/41.8|D|
|airun_mtzdp5zt_52hgd6ub|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzdqty8_q0daki73|ENAUSDT|DOWN|A 0.0/7.1|A 7.1/21.2|A 7.1/21.2|D|
|airun_mtzdr9ec_j3wiw1sf|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzdrots_pxm8fl9y|XRPUSDC|DOWN|A 3.7/0.0|A 4.4/4.4|A 4.4/5.9|D|
|airun_mtzds2bu_r15zu8i7|XMRUSDT|RANGE|D|D|D|D|
|airun_mtzdshs1_v0onrjv8|WLDUSDC|DOWN|A 2.5/2.5|A 2.5/25.2|A 2.5/32.8|D|
|airun_mtzdsz73_qd3jr2fv|NEARUSDC|DOWN|A 4.3/4.3|A 8.5/21.3|A 8.5/21.3|D|
|airun_mtzdten6_486hxaaj|UNIUSDC|RANGE|D|D|D|D|
|airun_mtzdts3i_4ydt8egd|BTCUSDT|DOWN|A 0.0/0.0|A 0.0/2.5|A 0.0/2.8|D|
|airun_mtzdu5nm_d161bdrw|INJUSDT|DOWN|A 0.0/15.2|C 0.0/77.8|C 0.0/111.6|D|
|airun_mtzduupx_zq46tw9w|VIRTUALUSDT|DOWN|A 3.2/3.2|A 3.2/17.8|A 47.0/19.5|D|
|airun_mtzdv895_zgjfsi9v|ETHFIUSDT|DOWN|A 13.1/34.9|A 13.1/46.5|A 27.6/49.4|D|
|airun_mtzdvltt_fclxnskr|UNIUSDT|RANGE|D|D|D|D|
|airun_mtzdwgqf_6hphxtja|ARBUSDT|RANGE|D|D|D|D|
|airun_mtzdx02m_od55eavb|AVAXUSDT|RANGE|D|D|D|D|
|airun_mtzdxfix_h1w722xv|ENAUSDT|DOWN|A 0.0/7.1|A 0.0/28.2|A 14.1/28.2|D|
|airun_mtzdxuyp_qsryk8pv|1000SHIBUSDT|DOWN|A 7.6/0.0|A 7.6/19.0|A 7.6/24.7|D|
|airun_mtzdyaf1_z3kwie6i|ARBUSDC|RANGE|D|D|D|D|
|airun_mtzdz97q_jv83lhl8|WLDUSDC|DOWN|A 2.5/5.0|A 2.5/32.8|A 5.0/32.8|D|
|airun_mtzdzmpz_tdaabyr6|NEARUSDC|DOWN|A 8.5/4.3|A 8.5/21.3|A 21.3/21.3|D|
|airun_mtze00aj_pef8016l|BTCUSDT|DOWN|A 0.0/1.5|A 0.0/2.5|D|D|
|airun_mtze0dsb_dyienxg3|INJUSDT|DOWN|A 6.8/32.1|C 6.8/82.8|C 6.8/96.3|D|
|airun_mtze0t7k_8zd99xg6|DOTUSDT|DOWN|A 0.0/20.8|A 0.0/47.5|D|D|
|airun_mtze18o7_ijfrlats|PENGUUSDT|RANGE|D|D|D|D|
|airun_mtze1o4f_776v2i0w|XMRUSDT|RANGE|D|D|D|D|
|airun_mtze21pa_lxaqhsqv|VIRTUALUSDT|DOWN|A 0.0/13.0|A 0.0/17.8|D|D|
|airun_mtze2f5s_kfij6k3j|APTUSDT|DOWN|A 38.7/20.2|A 38.7/33.6|D|D|
|airun_mtze2um2_64zdb5jj|HYPEUSDT|DOWN|A 6.0/5.0|A 6.0/12.1|D|D|
|airun_mtze3a2h_sz557ac3|ETHFIUSDT|DOWN|A 2.9/17.4|A 2.9/30.5|D|D|
|airun_mtze3pj1_k9mkr7te|UNIUSDT|RANGE|D|D|D|D|
|airun_mtze4q9t_7uqa1eds|NEARUSDT|DOWN|A 21.3/25.6|A 21.3/25.6|D|D|
|airun_mtze53r1_9t9tfb05|ENAUSDT|RANGE|D|D|D|D|
|airun_mtze5hbz_0a1vl96o|1000SHIBUSDT|DOWN|A 0.0/17.1|A 5.7/20.9|D|D|
|airun_mtze5uta_qyko000x|OPUSDT|RANGE|D|D|D|D|

## 数据来源与校验

- 基线：docs/plans/2026-09-13-v392-ai-decision-quality-review.md；本报告独立核验其关键推断。
- 同一HEAD下源文件和只读SQLite归档，runId/eventId均可回查。
- [Binance USD-M Kline接口文档](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data)；实际请求URL、fetch时间见klines/*.json。
- [llama.cpp grammar限制](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md)，仅用于解释结构化解码的已知边界，现场错误以raw输出为准。
- 脚本验证：421个唯一拒绝ID、每时限标签和为421、325个方向解释与15m结构一致；原始行情与已归档闭合OHLC对齐；代码/配置未修改。

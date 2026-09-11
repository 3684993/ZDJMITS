# ZDJ-MITS V3.9.2 Final Closure：最小实施计划

审计：2026-09-10，Asia/Shanghai；固定统计截止 **17:08:10**，并于手动部署后持续更新。状态：**DEPLOYMENT-READY / NATURAL-ACCEPTANCE-RUNNING**。

本轮保持当前 V3.9.2 build 与交易逻辑不变，仅进行已授权的 Testnet 生命周期切换、只读观测和文档更新；未修改 Settings、Production 权限或交易事实，未执行 Production 写入、防火墙或网络安全策略变更。遵守 `AGENTS.md`；当前工作区没有可用 Git 元数据。

## 1. 当前真实状态

| 项目 | 当前证据与判断 |
|---|---|
| 版本与实例 | package/workspace、HTTP 均 V3.9.2；当前 PID **16776**，实例 `b6ee5cb2-bdf4-430a-aabe-e8d4bb6cd47e`，手动启动。现场重算 artifact=`84d58ba7d91508e3fa7b109e266121947ddb84b21f39dcda3baf4216b06bf389`、source=`2d4ec930c75fc42a9fa6c7a9b14d27d05d8d8ef15727257bff1df0b204a9c118`，与运行身份一致。 |
| 运行 | `/health` 200 READY，约31ms；scheduler RUNNING；Private READY、失败连续数0；3仓、TP 3/3、drift及未解决差异0；P0五项计数0。仅证明采样时状态，本构建没有新 Entry，不能据此宣布执行回归全部通过。 |
| 配置 | SQLite Settings **v105**，TESTNET_ENABLED；maxPositions=50、maxPendingEntries=6；UniverseTopN=100、Pool目标20/上限24；V4目录已批准54 underlying。现有风控与这些额度均不调整。Production写边界锁定，当前实例计数0。 |
| 供给 | 17:08采样155快照、149 Universe行、Pool17/20，qualifiedSupply17、readySupply10、池READY9；Hot技术/报价诊断17/17 READY。17:07另一次采样Pool19，含1个缺最新1m闭合条。**数据新鲜不等于生命周期可调度，Universe行数也不等于独立获批资产数。** |
| AI | 单27B，maxConcurrency=1；9B独立研究，无第二审批。本实例74个Primary归档：72 COMPLETED、1 FAILED、1 RUNNING，覆盖30个symbol。完成率72/73=98.63%（排除运行中），72个完成结果全部NO_DIRECTION_EDGE；PLACE/WAIT均0。中位延迟16.788秒，范围14.766～19.789秒。启动至采样29.06分钟，调用约2.55次/分钟；稳态吞吐另测。 |
| 测试与质量 | 最新报告记录334测试及verify通过，**本轮没有复跑，状态为历史工程证据**。阅读当前测试发现语义验收名实不符，见P0-A。新构建自然成交、入场质量、连续24h/生命周期证据仍PENDING；生产账户/预算/退出边界验证BLOCKED。 |

已完成且应保留：闭合K线/缺口拒绝、15m 240条就绪门与241条请求余量、81条1m/5m请求；结构趋势与MACD动量分离；唯一Primary、WAIT重确认、方向预算前置；Maker合法集合内ideal优先；幂等提交、UNKNOWN占用、partial/TTL、TP及reconciliation。代码存在不等于自然样本验收完成。

## 2. 五个最重要问题

1. **Primary语义退化嫌疑最大，尚未证明其唯一根因。** 72个完成结果全为NO_DIRECTION_EDGE/RANGE/LONG，而输入15m为64 DOWN、7 RANGE、1 UP，72个包都允许LONG/SHORT。BTC样本把5m MACD冲突用于否定方向；DOGE样本只讨论为何不能做多，未形成做空/等待分析。这不是“需要强制SHORT/PLACE”的证据；需要区分真实无机会、缺少触发事实、Prompt与本地结构化解码偏置。当前契约只提供聚合指标/极值，却要求“已确认事件”，缺少事件发生次序与时间锚。
2. **1m时机被旧调度粒度限制。** `decisionContextKey`含15m/5m bar、趋势、ATR价格桶，不含1m触发；`nextClosedFiveMinute`和`lifecycleRunnable`要求下一5m复核（权限/WAIT确认例外）。本样本简化context复算未发现同symbol重复键，不能声称存在无条件重复推理；但新1m触发可漏调，且USDT/USDC切换仍按symbol独立记忆。
3. **行情恢复仍有局部缺口和重复工作。** 截止时间内SQLite记录17,099条 `LIVE_HYDRATE / 1m closed candle gap`。`hydrateLive`构建1m卡抛错会使同次quote/book更新一起丢失；Hub按symbol catch已避免全局中断，却每tick重算同一坏序列。真实缺口来源尚待定位，不能归咎交易所。冷/热快照仍全量tick，供给17～19有波动。
4. **漏斗和质量验收会误导收尾判断。** API同时显示rejectCount30m=0与consecutiveRejects=75、并称“候选连续拒绝”；NO_DIRECTION_EDGE未单独汇总。当前`aiFabric.test.ts`名为“zero semantic violations”的矩阵却接受反向PLACE，并增加`rejectedViolations`计数；它不能证明方向正确。现有`observedOutcome`从15m起算、明确NO_FILL_ASSUMED，不是成交后1m/5m逆向选择报告。
5. **历史后置风控浪费已证实，但当前残余必须做同事实对照。** 当前前置能力路由已实现，不能重建一套风险引擎。旧混合构建窗口仍显示大量cluster/方向/容量阻断；当前无PLACE，无法验证前后门是否完全一致，也无法测当前Maker损耗。生产准入与连续质量证据仍未完成。

### 漏斗：明确分母，禁止跨版本冒充提升

当前实例：74尝试 → 72合法完成（语义质量UNKNOWN） → 0 PLACE / 0 WAIT → 0新Intent → 0新Order → 0新Fill。**PLACE→Intent、Order→Fill为N/A，不能写0%或100%。** 当前后置风控不是已证主瓶颈。

SQLite重新计算的历史混合构建窗口：09-08 08:00至09-10 17:08，8,187 Primary归档，3,113完成、5,066失败、8 RUNNING遗留；PLACE 2,898 → 按brainRunId+symbol匹配Intent 128（4.42%）→ 本地Order 118（92.19%）→ 有exchangeOrderId 110 → 有累计成交证据80（占本地Order关联链67.80%）。这些是**run级关联链数**，不是成交碎片数；80基于订单累计成交及可关联fill，不把本地Order直接当交易所已接受订单。

历史阻断事件：cluster 1,956、方向容量293、portfolio admission 212、方向权限154、方向暴露107；事件数可能重叠，不能相加为唯一失败链。当前无同简化context重复；历史失败原因/构建须另分组，不把历史5,066失败归给新熔断器。

## 3. 链路与职责边界

| 链路 | 当前入口与最终职责 |
|---|---|
| Market→Universe/HotPool | `BinancePublicMarketDataProvider` / `MarketDataHub` → `UniverseCoordinator` / core `selection,pool`：合格资产、闭合事实与可调度候选；持仓管理不受候选短缺影响。 |
| EIP→Primary | `eipService.ts` → core `compactEntry.ts` → `aiFabric.ts`：15m结构决定方向依据，1m/5m决定触发和位置；高周期背景不得悄悄成为第二方向审批。EIP仍检查4h/1d/1w新鲜度，须区分实际风险依赖与纯展示依赖后才精简。 |
| WAIT/PLACE→Intent | `entryCoordinator.ts` / `entryWaiting.ts`：WAIT无订单权限，触发后复核；PLACE必须通过同一事实下的容量/权限和提交时的新鲜风险复验。禁止把拒绝或等待改写成PLACE。 |
| Intent→Maker→Order | `nearMarketPrice.ts` / `executionLifecycle.ts` / `ExternalTradeAdapter.ts`：只在AI区间、tick、近价限制和实际成交价证据交集中选ideal最近价；交集为空进入有期限执行等待；不追出授权范围。 |
| Order→Fill→Position→TP | 私有流/REST对账→`positionService.ts` / lifecycle tracker→TP服务：以交易所订单、成交和仓位事实为准，保留归属、幂等与保护。 |
| TP/退出→Outcome | `tradeRecordSyncService.ts`及TradeRecord/Experience形成费用闭环；`decisionEpisodeFacts.ts`是采样市场结果，需与真实fill质量区分。 |

## 4. 最后必要工作（按优先级）

### P0-A：先纠正决策语义证据，再改最小事实/Prompt/Schema

- **现状证据 →** 72个完成结果均NO_DIRECTION_EDGE/RANGE/LONG；64个DOWN输入；`compactEntry.ts:15–47`提供指标而非确认事件序列；`aiFabric.test.ts:25–41`矩阵接受反向PLACE。
- **根因 →** 已证模型输出没有稳定体现分层职责；“无方向”和“有方向但未触发”混用。事实不足、Prompt与schema解码顺序影响仍UNKNOWN，不预先指定模型故障。
- **最小修改 →** 先修测试名称/断言与七类决策统计；用存档事实构造已知方向、未完成/已完成触发、无优势、缺数据的对称LONG/SHORT回放。再按复现结果在现有compact事实补最少闭合bar/事件锚（时间、价格、确认/失效），精简重复提示并说明方向与时机独立；Schema若与本地解码不兼容只修兼容层。保留无优势不下单，禁止增加审批模型或自动翻方向。
- **验证方法 →** 隔离无交易适配器先测parser/契约，再对冻结的真实输入用同模型做有界离线回放；不与在线Primary争抢资源，真实模型回放安排在独立资源/获准窗口。人工核验抽样的directionReason、触发、位置引用；收益标签不泄漏到输入。
- **PASS标准 →** 契约正反例全通过；明确DOWN但只有1m回抽的样例不能被当作做多依据；未完成触发不得PLACE，缺事实不得伪造事件；所有PLACE都有可回读方向/触发/位置依据，违规0。无法判定样例为UNKNOWN；不以PLACE比例上升为PASS。
- **回滚方案 →** 按事实/Prompt/schema哈希回退该小变更；保留原始AI输出和新交易账本。部署/回退涉及Engine动作必须另获指令。

### P0-B：修单symbol行情更新失败的耦合与报错风暴

- **现状证据 →** 17,099次1m gap；`marketDataHub.ts:17–27`逐tick catch，provider `hydrateLive`返回对象内计算技术卡时抛错。
- **根因 →** 一个坏K线序列同时阻止quote/book更新，失败未绑定序列版本；当前局部隔离还不完整。REST与WS序列合并/补洞原因待复现。
- **最小修改 →** 分开提交新鲜quote/book与严格技术卡；坏K线仍阻止Entry但不阻断管理行情。按symbol+周期+序列指纹去重计算/错误，复用现有单飞与退避恢复；保留首发/恢复事件及累计次数。优先管理集合和Hot，逐标的成功立即提交，避免批次尾部等待。
- **验证方法 →** 隔离复现缺一bar、乱序、重复、断流、闭合边界与REST回补；检查book仍推进、技术门仍拒绝、其他symbol不受阻。
- **PASS标准 →** 同坏序列不每秒重复计算/落关键错误；恢复后一个调度周期内重新评估；缺口/未闭合/未来条进入Primary为0。连续2h Hot必需闭合1m/5m/15m新鲜率≥99%（既有边界宽限内），分母含所有当时Hot及缺数据项；失败符号退出池不能抹掉历史失败。
- **回滚方案 →** 仅撤回行情更新/去重小变更，保留严格Entry门与旧单飞恢复；不通过放宽新鲜度回滚，不重启掩盖故障。

### P1-A：让新1m触发唤醒，去重仍按真实变化

- **现状证据 →** `decisionContext.ts:7–15`无1m；`entryCoordinator.ts:760–772`受nextReviewAt限制；当前简化context无重复，30个symbol对应26个underlying，多quote独立缓存。
- **根因 →** 旧5m节拍与新1m触发目标不完全相容；symbol键可使同资产换quote后再次解释同一方向事实。
- **最小修改 →** 复用现有context，加入有意义的1m触发/失效指纹；只让新触发越过5m等待，不按每tick价格重跑。方向事实按underlying去重，合约盘口/费用/权限变化保留独立执行指纹；继续单Primary。并行只用于候选准备与IO，先不提高模型并发。
- **验证方法 →** 同事实、闭合新1m但无触发、新触发、触发失效、换quote、权限变化、WAIT恢复与已有活动单场景。
- **PASS标准 →** 同决策事实Primary重复0；新合格触发在下一调度周期入队，不再无条件等5m；队列耗时可观测，不宣称单模型保证瞬时处理所有候选；已有活动订单/UNKNOWN仍禁止新Primary。
- **回滚方案 →** 回退context/唤醒规则，保留WAIT及占用状态；不清空去重历史制造机会。

### P1-B：对齐前后风控，删除重复判断而非风险门

- **现状证据 →** 历史PLACE→Intent仅4.42%；`runtimeControlService.ts:66–80`已做资本/方向预算，`entryCoordinator`仍做POST_PRIMARY_DIRECTION_CAPACITY、allocation与buildRiskEnvelope。
- **根因 →** 历史前置覆盖不足已证；当前是否仍有同事实、同预算的判断差异PENDING，不能把正常提交前重验当浪费。
- **最小修改 →** 增加前后事实版本、方向、预算和阻断原因对照；仅将复现到的稳定必拒条件复用到Primary前置。相同计算共用现有函数；保留提交前对私有状态、占用、额度与价格变化复验。
- **验证方法 →** 冻结同一账户/仓位/行情/Settings，覆盖cluster、方向/总暴露、日损失、保证金、最小名义及并发预留；再注入AI期间事实变化。
- **PASS标准 →** 同事实稳定必拒场景不调用Primary；前后结果不一致0；变化引发的后置拒绝100%有版本及原因；风险额度和拒绝集合不放宽。
- **回滚方案 →** 撤回前置缓存/复用优化，仍以原提交门为准；不撤销已有合法挂单或TP。

### P1-C：补成交质量与连续验收，冻结同构建基线

- **现状证据 →** 当前新Fill=0；`decisionEpisodeFacts.ts:21–46`最短15m且NO_FILL_ASSUMED；旧334 PASS及P0零值不能证明高质量自然建仓。
- **根因 →** 解析成功、无交易的安全零值与真实成交质量被混作完成；缺少直接回答“入场即亏损”的短周期证据。
- **最小修改 →** 复用现有fill/quote记录与报告脚本，补真实fill锚、fill时mark/bid/ask、1m/5m/15m MAE/MFE、点差/费用/滑点、等待/成交延迟和退出净值；分LONG/SHORT、机会类型、行情状态。缺采样标UNKNOWN，不新增Shadow系统。
- **验证方法 →** exact run→intent→clientOrderId/exchangeOrderId→fill→position/cycle→TP/exit链关联；固定前后/OOS窗口，区分部分成交、无成交TTL、恢复仓和人工单；先完成针对性隔离测试，业务变化后才跑必要全量检查。
- **PASS标准 →** 新系统Entry归属完整率100%、重复提交/错误方向/未核实释放占用/漏管TP均0；连续24h且≥100个已提交订单终态生命周期、至少20个自然成交与5个完整退出闭环。质量另需≥100个自然新Entry（LONG/SHORT各≥30），1m/5m可测覆盖≥95%；分层样本的MAE中位/P90不劣于冻结可比基线，费用后结果无显著退化。基线或样本不足PENDING；不强制凑数，不保证每笔立即盈利。2h AI恢复观察纳入24h窗口，不重复另建监控体系。
- **回滚方案 →** 撤回统计变更并保留原始事实；报告版本化，不覆盖失败样本；质量未达标不放行扩容/生产，不自动关停Engine。

### P2-A：生产只读签收与最终归档

- **现状证据 →** 当前TESTNET写边界；独立生产只读账户、预算和退出签收证据未提供。`server.ts:21`已有Production管理写鉴权，旧报告“完全无鉴权”不能直接复用。
- **根因 →** 测试网工程状态与生产账户事实是不同验收层，当前后者BLOCKED。
- **最小修改 →** 不新增生产写能力；复用现有productionReadOnlyPreflight，待明确授权及独立只读凭据齐备后核对账户/模式/规格/费用/已有仓单/退出边界，归档构建与验收矩阵。此项P2仅表示执行顺序，仍是Canary硬门。
- **验证方法 →** 独立GET白名单采集，不实例化会维护TP的Production Engine；管理面授权与环境隔离离线测试。
- **PASS标准 →** 所需账户事实完整、零生产写、无未归属仓单、退出方案及具体Canary预算单独签收；未齐备BLOCKED。即使通过也不自动获得Canary写授权。
- **回滚方案 →** 停用只读采集任务及其临时凭据引用，保留审计；不修改运行Engine权限，不触碰交易所仓单。

## 5. 保留 / 修改 / 删除与最终形态

- **保留：** 单Engine、单Primary、成熟订单/持仓/TP/reconciliation、严格闭合K线、风险门、WAIT与Maker授权区间、手动启动策略。
- **修改：** P0语义验收与最小事实契约、局部行情更新；随后1m事件唤醒、前后风险同源、成交质量统计。54个获批资产已完成V4迁移，不再重做旧83项迁移；供给不足先查可采集/可调度原因，不加低质币补20。
- **删除/合并：** 伪“语义违规已拒绝”测试计数、把所有无PLACE称拒绝的诊断；同坏序列重复错误和已证明同输入重复计算；后续验证无依赖后才移除纯背景周期的Entry硬耦合。保留必要高周期风险上下文，不盲删现有规则。
- **明确反驳旧设计：** 让第二模型复批不能解决当前72次无方向；固定5m复核不能完整服务1m触发；池数量/AI利用率/测试数量不能代表有效建仓；近盘口并不证明好位置，不能取消AI区间提高成交；旧报告产物未加载、AI全离线、市场fresh=0不再是当前事实。

**V3.9.2最终形态：** 合格且新鲜的候选持续供应 → 新15m结构或有意义1m/5m触发唤醒唯一Primary → 明确WAIT/无优势/PLACE → 复用同一风险事实 → 授权区间内Maker → 交易所事实闭环 → 短周期入场质量反馈。高频来自减少等待和无效工作，质量来自方向、触发与位置证据，不设最低交易次数KPI。

**建议开始最终实施，但第一批只做P0-A与P0-B；不重构执行内核。** 先修可验证的统计/测试错误与行情局部耦合，再凭回放结果调整Prompt/事实，不先调低门槛。P1-A/B紧随其后，连续验收通过前不宣布Final PASS；发布须提供具体变更与隔离验收结果后，另获该次手动Engine操作指令。

## 7. 实施进度：P0-A + P0-B（2026-09-10）

状态：**P0-A PASS；P0-B PASS（隔离工程验收）**。没有停止、重启、热加载当前 Engine，没有 Production 写入，也没有发起离线真实模型请求。

- P0-A：冻结的当前 Primary 输入回放确认，旧输入缺少 `lastClosedBar` 事件锚，因此模型无法引用刚刚闭合的价格/时间事件；这是真实事实契约缺口，而非提高 PLACE 率的理由。技术卡现输出严格闭合的最后一根 OHLCV；Prompt 明确 15m 定方向、1m/5m 仅定时机/位置；解析层拒绝与明确 15m UP/DOWN 相反的 PLACE。修正原来把反向 PLACE 计入“已拒绝违规”的 300 矩阵测试，新增 LONG/SHORT 对称和冻结回放。NO_DIRECTION/WAIT/PLACE 的自然运行分布仍待新 build 隔离运行验证，不能从本轮离线结果推断改善。
- P0-B：Binance live 更新拆成 `hydrateLiveMarket`（quote/book/recent trades）与 `hydrateLiveTechnical`（严格 1m 闭合卡）两段。坏 K 线不再回滚管理行情；技术卡失败仍使 Entry 不能取得新技术事实。错误和计算按 `symbol + timeframe + 完整闭合 OHLCV 序列` 去重，序列变化会重新报告一次；单标的异常不会阻塞其他 Hot 标的。
- 验证：定向测试 14/14、core 定向 8/8；`npm run verify` PASS（59 engine files、285 engine tests；core 39；dashboard 15）。完整构建完成。自然 2h freshness、当前运行实例的 gap 对比、实际 Primary 语义分布与成交漏斗均为 **PENDING**，必须在获授权的隔离部署后观察；P1-A/P1-B/P1-C 尚未开始，避免把未部署源码当作运行事实。

### P0 最小补强（同日）

状态：**DONE-ENGINEERING / DEPLOYMENT-PENDING**。`hydrateLiveTechnical` 现在先计算完整闭合 OHLCV 序列，再比较指纹；相同 closeTime 的交易所修订不会被跳过。MarketDataHub 将已知失败序列列为 `TECHNICAL_<tf>_SEQUENCE_INVALID`，旧卡不能再伪装 READY；成功产生新技术卡才清除阻断。失败/去重缓存分别上限 128/512，并允许新序列重新验证。quote/book/成交价更新维持独立。全量 verify PASS：286 Engine tests。

## 6. 可复核证据

- 本轮固定原始API/配置/SQLite摘要及哈希：`../reports/final-closure-audit-20260910/evidence.json`。
- 72次完成结果原文及输入：同目录`primary-detail.json`；分组/历史漏斗：`analysis.json`、`historical-join.json`；只读复算脚本：`audit.mjs`、`analysis.mjs`。各API/SQL顺序采样有毫秒差，未声称跨接口原子快照。
- 当前日志：`data/runtime-logs/engine-2026-09-10-59967f10-d10f-43a7-92c0-f3af7bfce9d2-0.jsonl`；SQLite通过readOnly+query_only访问，无checkpoint/VACUUM/迁移。
- OS级`Get-NetTCPConnection`返回拒绝访问；没有提权重试。PID/监听身份由HTTP与身份文件交叉确认，系统级唯一进程枚举未验证；不把累计restartCount当成自动重启证据。
- 优先阅读并对照：`docs/reports/final-entry-audit-20260910/final-implementation-report-20260910.md`、`docs/ZDJ-MITS-FINAL-ENTRY-QUALITY-AND-PRODUCTION-READINESS-PLAN.md`、`docs/V3.9.x-FINAL-CLOSEOUT-AND-PRODUCTION-ADMISSION-PLAN.md`与两份V3.9.0进度。旧报告仅作历史背景；本计划阈值是拟验收标准，均不是已取得PASS。

## 8. V3.9.2 Testnet deployment and natural-acceptance baseline (2026-09-10)

Status: **DEPLOYMENT-READY / NATURAL-ACCEPTANCE-PENDING**. The verified V3.9.2 artifact was started manually on Testnet with `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`; no Windows Firewall rule or network security setting was read or changed.

- Pre-deploy state was preserved in `data-backups/v392-before-deploy-20260910-1837` and the stopped-state SQLite/WAL/SHM backup in `data-backups/v392-before-deploy-stopped-20260910-1837`.
- Runtime identity: PID `16776`, instanceId `b6ee5cb2-bdf4-430a-aabe-e8d4bb6cd47e`, buildId `3.9.2-84d58ba7d91508e3fa7b`. Runtime `artifactHash` `84d58ba7d91508e3fa7b109e266121947ddb84b21f39dcda3baf4216b06bf389` and `sourceHash` `2d4ec930c75fc42a9fa6c7a9b14d27d05d8d8ef15727257bff1df0b204a9c118` exactly match local tree-hash recomputation.
- Immediate smoke/readiness: `/health=READY`, scheduler `RUNNING`, private `READY`, market WS `LIVE`, 157 snapshots, reconciliation drift `0`, unresolved `0`, four positions with four protected TP orders, and zero active entry orders. Configuration is `TESTNET` / `TESTNET_ENABLED`; Production write remains `0`.
- Natural baseline is observation-only: the latest read-only funnel reports 199 completed and 1 RUNNING Primary run; `PLACE_LONG=2`, `PLACE_SHORT=1`, `WAIT_FOR_PRICE=2`, `RESELECT_SYMBOL=0`, `NO_DIRECTION_EDGE=193`, `DATA_TECHNICAL_BLOCK=0`, `AI_PROTOCOL_FAILURE=1`. Exchange fill facts are retained only as observed chain evidence; short-horizon quality and complete exits remain `PENDING`/`UNKNOWN` until attributable natural samples are complete.
- Continue collecting 1m/5m/15m closed freshness, sequence errors/recovery, quote/book continuity during technical blocks, the seven mutually exclusive decision categories, and exact Primary→Intent→Order→Fill→Position→TP/Exit links. Do not start P1-A/P1-B or alter any trading boundary from this baseline.
- A detached read-only collector is running as PID `19076` (`scripts/run-v392-natural-acceptance.ps1`, 60s interval, 120-minute window), writing only redacted evidence under `data/reports/v392-natural-acceptance-*`. It has no Engine lifecycle or trading-state permissions. P1-A/P1-B remain gated on the completed 2h evidence and will be decided explicitly afterward.
- Initial collector sample: quote/book freshness 100% across 20 Hot symbols; strict closed-frame freshness 1m 35%, 5m 40%, 15m 45%, with missing-latest-closed reasons retained as data evidence. This low initial technical coverage is not a reason to relax freshness or trigger P1-A; the 2h window must establish persistence and recovery behavior first.

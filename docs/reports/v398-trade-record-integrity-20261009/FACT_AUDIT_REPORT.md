# V3.9.8 交易记录完整性专项事实审查

Phase C补充：本报告Phase A固定快照及其证据不等于最终live状态；23:38Z completion不可连接、PID8524已不在、Settings250→253，来源/停止原因UNKNOWN。本任务零生命周期/Settings/live历史写入。实施与历史限制见IMPLEMENTATION_REPORT.md；fixed replay301system/16external/3可修复LONG预览，原AVAX SHORT仍UNCLOSABLE，1000+极值仍UNKNOWN。

2026-10-09；Phase A 完成，Phase C 尚未开始。分类严格使用 PROVEN / PARTIAL / CONTRADICTED / UNKNOWN。固定原始证据在 evidence/；失败日志一并保留。源代码基线 `855362ecd42acb820dc88807b09575a4becf605c`，行号索引见 required-reading-source-map.json。

## 当前真实性与边界

GitHub最新main为855362e，当前main Actions SUCCESS；明确核查37853581957 job/status/conclusion均SUCCESS，head_sha为5fe95a8。API回执在github-actions.json，不把此前1cd6d75的canceled描述为成功。

本轮独立health/closeout GET：Engine8524，3.9.8，build3.9.8-7271c941c2cdec049610，READY，TESTNET_ENABLED且TESTNET锁定，生产写0。运行源码仍在上一轮worktree，最新main新增文档不等于Engine已部署本轮代码。快照Engine自然TESTNET计数71不是任务交易；本轮人工交易/部署/生命周期/Settings/live DB写均0。D:/MITS旧HEAD ea531b5及六项dirty保留；新隔离目录D:/MITS-worktrees/v398-trade-integrity-20261009。

原生当前与历史共16个GET，包括时钟、hedge mode、positions、openOrders及AVAX/ETH/UNIUSDC六个固定6日窗口的fills/orders。每窗limit1000，均未饱和；未饱和不证明交易所永远保留全部历史。限28请求、单请求8/12秒、总240秒。SQLite mode=ro/query_only，主实体采集约数秒，2000记录/各kind限额/18秒VM中断边界。未创建私有备份、未重试删除此前私有备份。一次遗漏复合索引scope的辅助positions查询在5秒被中断，随后绑定现有scope读取129个位置identity；失败保留。

## AVAX：物理仓位、历史记录与页面必须分开

**PROVEN 物理SHORT已结束。** 当前原生positionRisk和openOrders均无AVAXUSDT条目；不以缺条目单独证明退出，而以历史1263累计ENTRY和1263精确EXIT互相守恒：

|事件|独立证据|结论|
|---|---|---|
|2026-09-20 00:10:45.678 +08起|首笔SHORT SELL真实trade time；native-orders-derived.json|原始物理周期起点，非今日成本反填|
|截至10/5 00:00 +08|10个ENTRY orders、9独立追加、49 fill stages|固定日初统计，不等于全天|
|截至10/6 00:00 +08|14个ENTRY orders、13独立追加、92 fill stages|10/5全天结束确有13独立追加；用户原观测时刻/口径UNKNOWN|
|后续截至退出|18个ENTRY orders、17独立追加，累计1263|与上一轮1263重现；partial stages不等于独立授权|
|退出order540405465|BUY/SHORT/LIMIT/reduceOnly/FILLED，1263@10.441，trade67893172，executionTime1791472362824|真实退出成交时间由该毫秒时间戳换算，不能用启动恢复时间|
|TP身份|clientOrderId v396x886c70c48aac64e399dba540931142，local tp_muz0y4ll_rlt4oyac，durable provenance role TP，同cycle|PROVEN TP退出身份；不是人工exit或伪造平仓|
|本地生命周期|cycle_entry_intent_mu8l1mm0_rcobpxad，CLOSED/currentQty0/closedAt1791497311314/addCount25|closedAt为恢复时本地零仓观察，晚于交易所成交，非精准退出时间|

**CONTRADICTED 整段历史从数据库/API消失。** 9/20记录`trade_cycle_entry_intent_mu8l1mm0_rcobpxad`仍存在：openedAt1789834245678、observedClosedAt1791497311314、status INCOMPLETE、classification PARTIAL、raw entryQty288/exitQty0/remaining288、17 retained lots合计1074、funding UNKNOWN、ledger UNCONSERVED。原生ENTRY1263重现，旧288/1074/1263差异仍存在，没有重写任何原值。另有9/28同side旧记录entryQty100，属于本地不同cycle证据，不能自动并入/删除。

**PROVEN 默认分类遗漏。** TradeRecordsView.vue:13默认COMPLETE，router.ts:1056起默认COMPLETE并分类精确过滤。AVAX接口COMPLETE返回3条均其他LONG周期，PARTIAL返回7条含9/20SHORT；数据库AVAX10条中2条SHORT。不是API没有返回能力；也未观察用户当时浏览器选择，故“用户当时具体filter”为UNKNOWN。当前物理持仓不在、历史账本待对账、默认tab看不见三个现象同时成立。

**PROVEN 同步识别缺陷；PARTIAL 历史欠账完整因果。** tradeRecordSyncService.ts:11 systemClient正则只识别entry_/ml_/tp_/manual_/ma_/mr_/mc_/ec等，不识别当前v396e/v396x。:19–22直接据此把真实v396x TP划为external；durable owner/provenance已经证明是TP。隔离生产preview回放整个固定AVAX历史：268 system /49 external /0 repairablePartial，原始records不变。默认自动sync includeExternal=false，appRuntime.ts:1893–1927默认滚动7天，9/20原始entry不在此窗口；全周期修复还需原始fills/唯一cycle身份/费用。前缀缺陷、窗口、retention与历史lot差异不能被合并成单一已证实根因。关闭实体与账本CLOSED分开属于正确fail-closed，不通过改status伪装账本闭合。

addCount25是positionLifecycleTracker.ts:44附近每次非零quantity INCREASE transition的累计，不是25个独立订单；18/17是exchangeOrderId单位，13是10/5日终单位。本轮证明时间窗可解释13→17；用户原统计没有精确as-of，不能宣称已经证明是同一份统计。

## 生命周期盈利亏损极值

**PROVEN 没有可展示的完整持仓周期极值。** TradeRecord合同没有生命周期最大浮动PnL及其发生时间；TradeRecordsView当前展示结算/费用/净值，不显示这类极值。decisionEpisodeFacts的MFE/MAE是固定决策价格锚的市场路径收益，不是随持仓数量变化的USDT/USDC PnL。portfolio peak/drawdown是账户口径，不能移植到交易周期。

**UNKNOWN AVAX 1000+精确峰值、最差时刻与当时库存。** tq_marks留存AVAX5781点、区间1791327872898–1791447310543；缺9/20起的大段早期，且price-only、没有同时刻quantity/cost/funding保证。tq_facts positions按identity覆盖更新，仅129个position identity，所取相关AVAX观测-48.63478925与-298.58687202不是连续完整轨迹。更早报告的-439.15属于指定时点旧快照，不是1000+峰值证明。没有用今日1263或VWAP反填过去，不插值。缺点不证明从未亏过1000。

最大浮亏=观察或完整覆盖下的unrealized PnL最低值；累计实现盈亏、ex-funding净收益、费用资金费全口径权益、MAE价格/保证金百分比、峰谷回撤均不同。USDT/USDC分资产，不额外乘杠杆。开放周期必须标“截至as-of”；关闭结算不是历史极值。持续采集、历史补齐与线上迁移本轮IMPLEMENTATION_BLOCKED，只实现诚实UNKNOWN的读模型/展示，不先创建采集器或伪精确极值表。

## 全项目固定分母与影响

768条TradeRecord，694 PARTIAL、67 COMPLETE、7 IMPORTED；491 CLOSED、124 OPEN、139 INCOMPLETE、14 PARTIALLY_CLOSED；277无closedAt与18物理持仓是不同分母。763 funding UNKNOWN、5 EXACT；14无origin run reference，但“有run引用”不代表archive完备。未见同symbol/side/cycle重复组（0/768），不据此宣称没有其他订单/交易身份冲突。

逐行原值算术诊断：242/768 entryLots数量合计≠entryQty，51/768 negative remaining，合并285/768至少一项（重叠8）。entry-exit-remaining算术不等/close-before-open在本次定义下均0。这些是可复现异常或留存差异，不自动认定真实交易所错误。all-record-anomalies.json列出所有ID/方向/分类/数值；全部记录及固定entities脱敏gzip可回放。

ETH有独立追加、两方向、长期库存；近期AAVE/ETHFI的TP+MANUAL、canonical/funding不足沿用当前事实层严格资格，不扩展成资金费用回填。保留已关闭/HUMAN/部分退出/历史ADD事实；V398禁止未来same-side独立补仓不意味着删除旧历史。TradeRecord表持久保存，不存在本轮证明的统一删除规则；executionFills持久实体上限5000、AI archive14日正文压缩为空、shadow marks/事件retention和自动7日window不满足永久全链历史需求。完整archive未来保全需要另行证据与存储方案，不能从0重复推出永久可追溯。

学习污染：显示字段不等于canonical合格。funding UNKNOWN、lot lineage缺档、未闭合cycle继续拒绝正式收益/学习标签；新增展示必须不改变classification/canonical/fee/funding/owner/P0计分资格。全项目“真实完整交易所数量”的一致率UNKNOWN：仅对AVAX/ETH/UNIUSDC取有界native history，未超范围拉全项目多年历史。

## UNIUSDC真实持仓与AI authority

原生hedge dualSidePosition=true，UNIUSDC SHORT168@7.341；本地cycle_entry_intent_mv04bo29_v4anyi1j，openedAt1791499145663，source SYSTEM_FILL。scope为本次TESTNET同凭证命名空间（私有account不上传），不得混UNIUSDT或反向LONG。

PROVEN noSeparateAddBlock对真实sanitized UNI SHORT返回NO_SEPARATE_ADD_POSITION_EXISTS，LONG返回null；这仅证明no-add政策没有symbol级封锁，不能替代资金/filter/account mode合法性。preAiExecutionEnvelope.ts:117侧向先过滤，:148无side执行候选，funds-only slotAvailable不会因sameUnderlyingOccupied封锁反向。合法反向保留Primary选择；同向候选不重新送入AI扩大权限。

PROVEN AI具体库存/年龄不可见：EipService生成portfolio总数，不生成具体cycle持仓起点；compactEntry.ts:27的funds-only排除portfolio，且呈现envelope没有entryAuthorizationPolicy。955个留存关联run的packet结构核查无existingPositionContext；最新10个真实rendered INPUT独立解析（仅结构/hash，不上传私有prompt）均无CURRENT_POSITION_CONTEXT，全部TESTNET_FUNDS_ONLY。模型“已理解”UNKNOWN，不能由后台字段或测试代替真实自然输出。

安全缺口可离线解决：携带同symbol两方向的有界只读事实，scope/as-of/source/quantity/owner/cycle与时间来源明确；first retained fill不同于已证明完整最初fill，缺失/过期/未来/冲突为UNKNOWN或PARTIAL，不用最近add或updatedAt冒充。当前first-fill provenance需要精确同cycle/side/ENTRY fill匹配；缺档不推算年龄。该上下文为执行事实，不是第二方向veto或Review authority，反向不因相反库存而被拒绝。

## 问题优先级与阶段门禁

P1 PROVEN：当前身份被sync当external；默认分类埋藏未闭合历史；AI缺具体持仓/时间事实。P1 PROVEN：数量诊断与物理/账本状态展示没有明确分层。P2 PROVEN：完整极值没有留存/展示条件；历史数据补齐NEEDS_EVIDENCE、live migration IMPLEMENTATION_BLOCKED。全项目285算术差异只交付审计/诊断，不批量写回；跨重启真实AI新上下文接受仍UNKNOWN。计划在Phase B先推送和fetch/hash核验，之后仅隔离源码/测试；任何部署、历史修复apply或账户动作均不在授权内。

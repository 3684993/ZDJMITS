# ZDJMITS 最新 main 独立只读系统审计

审计日期：2026-10-07，Asia/Shanghai。审计基线 `66f61d08391ed39713521365f421536e443e05b7`，开始与复核时远端 main 相同。报告包含优先级发现、NET-002 专项诊断、运行与经济证据限制；另附原问题文件全部 **255 项逐题回答**。

**结论：上一轮修复并非未部署；它覆盖了部分告警分类和局部阻塞，未关闭共享 REST 拥塞及若干旁路。当前既有真实账户事实失效，也有告警语义缺陷。同时发现行情字段新鲜度、TP 终态恢复、对账公平性及交易期望值标记的实质问题。不能将测试通过、TP 覆盖或服务 READY 等同于可靠交易、正期望或长期稳定。**

没有足够证据认定 P0 已发生、生产环境下单、重复成交、原生崩溃具体根因或策略总体亏损根因。P1 表示应优先处置/验证的高影响问题，未观测发生的缺陷明确注明。报告不授权实现、部署、服务操作或调参。

## 审计范围与身份

先完整读取问题文件与 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`，再检查最新 main 的源码、默认配置、测试、近期提交、历史结案/崩溃证据及本实例只读诊断。采用独立审计副本，保留 `D:\MITS` 的既有脏文件原状。

| 项目 | 核查结果 |
|---|---|
| 远端/审计副本 | `66f61d08391ed39713521365f421536e443e05b7` |
| 本地运行 checkout | `ea531b5f51e717f0ead322733765f2d6de30b4cb` |
| 两者差异 | 仅新增审计问题文档，368行；实现代码相同。不能以两SHA不同断言漏部署 |
| 进程 | PID50704，`node.exe --no-maglev D:\MITS\apps\engine\dist\main.js`，13:17:42创建 |
| 实例/build | `c14f2328-1ccf-49dd-bac6-5263cbecba3f` / `3.9.7-00e1112122c1665b5b51` |
| 配置 | Settings247；TESTNET；当前 Entry政策 TESTNET_FUNDS_ONLY，组合风险 OBSERVE/不veto |
| 观测 | 约15:08–15:21的诊断；本实例日志13:18:20–15:20:32。各endpoint非原子采集，时间分别保留 |
| 边界 | 只读GET localhost、文件/Git读取、SQLite `mode=ro`＋`query_only`；未调用写API、改代码/参数、重启、造单、清状态或直连交易所测试 |
| 测试 | 对实际审计源码执行安全离线反例；未重跑全套测试/build、未使用GitHub Actions。历史测试通过数不是本次独立验收 |
| 模型要求 | 本会话工具不能核实/切换模型或推理档位；无法保证已使用用户指定GPT-6.1 Sol/Medium，未借此冒充独立模型复核 |

本实例自主运行产生的交易/存储变化不属于审计发起的写操作。诊断读取仍会产生正常HTTP统计和资源开销，不能声称对活跃进程完全零影响。没有对运行artifact逐文件重建完整6/6身份闭环；build/instance与handoff相符，源码差异核验成立，长期运行验收不在本次权限中。

证据标签：**PROVEN**＝源码确定逻辑或可重复离线反例/直接观测；**STRONG_EVIDENCE**＝多来源支持但因果链未完全闭合；**INFERENCE**＝有机制支持的推断；**UNKNOWN**＝不能下结论。PROVEN 的离线“可发生”不自动等于线上“已发生”。

## 优先级总表

| ID | 优先级 | 类别 | 核心发现 | 证据强度 / 当前影响 |
|---|---|---|---|---|
| F17 | P1 | 管理面可靠性/权限风险 | 0.0.0.0监听、全来源防火墙；TESTNET交易/TP管理写操作无身份认证 | PROVEN；网络外部可达范围UNKNOWN |
| F01 | P1 | 确认缺陷 | 新报价让旧mark/last复用新鲜时间，旧book事件可覆盖新报价 | PROVEN离线；线上交易污染未量化 |
| F02 | P1 | 确认缺陷 | TP ACK异常恢复将远端终态映为WORKING/PARTIAL并回写退出状态 | PROVEN离线；本实例触发UNKNOWN |
| F05 | P1 | 已观测可靠性问题 | 共享REST槽位/恢复扇出与代理劣化并存，account补真值实际失败 | PROVEN故障，STRONG_EVIDENCE放大机制；外部根因UNKNOWN |
| F04 | P1 | 经济模型/统计缺陷 | 假设失败收益、touch当概率；断续历史仍READY，期望值标VERIFIED | PROVEN；真实EV/损失归因UNKNOWN |
| F11 | P1研究 | 交易质量弱点/既有政策 | 无有限亏损界，四亏损bar/期限只交人工，长亏损尾部与小TP不对称 | PROVEN结构/LKG；应先测，不自行加SL |
| F07 | P2 | 确认缺陷/可靠性风险 | 对账软预算未保证总时限/公平进展，204失败仅三个历史ID | PROVEN机制，STRONG_EVIDENCE饥饿 |
| F06 | P2 | 确认缺陷 | BACKGROUND落公共lane；premiumIndex既advisory又quote硬依赖 | PROVEN离线/源码 |
| F03 | P2 | 确认缺陷/可观测性 | 私有UNAVAILABLE旁路不执行NET002 burst门槛；weight低不代表无队列压力 | PROVEN离线/源码 |
| F08 | P2 | 确认缺陷 | 每轮恢复发布同incidentId的旧history，恢复事件大幅重复 | PROVEN离线/线上 |
| F09 | P2 | 可观测缺陷 | analysis旧ready与当前false并存；service/TP/pending/weight时效易误解 | PROVEN源码/线上 |
| F10 | P2 | 经济可观测盲区/机会假设 | 合格净收益覆盖低，101sPrimary与机会损失缺完整校准 | PROVEN覆盖/延迟；机会金额UNKNOWN |
| F13 | P2 | 潜在执行风险 | 杠杆POST成功正文未核对，bracket缓存无TTL | PROVEN实现缺口；实际漂移UNKNOWN |
| F14 | P2 | 配置缺陷/并发风险 | recvWindow永为60s；热切换可变budget归因、旧agent未显式销毁 | PROVEN逻辑；本实例切换触发UNKNOWN |
| F15 | P2 | 潜在稳定性风险 | 同步SQLite/序列化、exactcache和历史Map增长、体积边界欠缺 | PROVEN实现；泄漏/崩溃因果UNKNOWN |
| F12 | P3 | 开关语义缺陷/机会损失 | 禁用历史可达性仍拒绝有历史的超上界自定义目标 | PROVEN离线；V397正常路径影响UNKNOWN |
| F16 | P1验证 | 尚未解决的历史风险 | 0xC0000409仍无native fault归因或长期稳定证据 | 历史PROVEN，当前崩溃原因UNKNOWN |

## NET-002：为什么仍然出现

### 已确认的这次故障

用户提供的私有requestId `82dea881-fcf1-44d0-8280-5e5bee42f721` 在本实例日志精确命中。15:04:34.862 `PRIVATE_SYNC_FAILED`，请求 `/fapi/v2/account`，耗时11221ms，`consecutiveFailures=3`；上次成功15:03:24.165，快照已70.697秒，超过60秒有效期。原始错误 `BINANCE_REQUEST_QUEUE_TIMEOUT`，route `proxy-05d851d4af74`。**这不是仅凭一条孤立慢请求导致的错误交易暂停：资金/账户事实确实已失效。**

用户给出的bookTicker requestId `0883f9aa-09df-45a0-b885-f3cf30a77694` 未在当前结构化日志窗口精确找到。因此只能引用用户告警与端点统计作为证据，不能声称已证明它对应的一次wire请求时长、代理握手阶段或是否真正发往Binance。有限recent/ledger与日志聚合不能用“找不到”反证请求没有发生。

15:10快照中，publicActive4/总active6、queued5；预算status AVAILABLE，usedWeight1m54，但已过时、admissionObservedWeight1m为null，estimated19，limit6000。实例累计queued7458、queueTimeout3755。端点归因（累计attempt级，非独立事故、非当前一分钟）：

| Endpoint/source | 尝试 | admitted | blocked/排队失败 |
|---|---:|---:|---:|
| bookTicker | 959 | 39 | 920 |
| depth | 1049 | 300 | 747 |
| klines | 897 | 372 | 523 |
| ticker24hr | 1015 | 402 | 613 |
| premiumIndex | 1040 | 316 | 724 |
| account | 308 | 303 | 5 |
| exact order | 714 | 710 | 4 |

bookTicker约95.9%未获admission。weight限频低、私有admitted比例高，都不能否定关键时刻账户在队列里超时；长在途网络请求占槽会压低吞吐。队列TTL到期主要发生在本地dispatch之前，不能从错误码翻译成“Binance服务器连续响应慢”。同时观测到 `Proxy connection timed out`，但尚无代理/隧道/交易所与本地事件循环同钟证据，外部根因不能指定为交易所或某地区路线。

15:08时WS仍LIVE、账户UNAVAILABLE；15:10时市场WS CONNECTING、quote全部stale。15:20:43复读中private依旧UNAVAILABLE，但asOf已有新成功时间，说明期间有恢复/再次失效，不能描述成整段持续不曾恢复。低频当时的权威原因是账户/候选事实，不是scheduler死亡或组合风险veto。

### 修复已经存在，但范围不足

上轮候选局部隔离、healthy候选下过滤fallback告警、optional derivatives/income advisory、exact-order去重等实际存在。main与运行checkout实现相同；不能归咎“最新修复没合入”。额外核对实际dist的operationalIncidents.js，包含advisory排除、timeoutFacts≥3及private旁路，与源码相符；其修改时间13:17:38早于本进程13:17:42启动。这支持告警修复已经在当前artifact内，仍不能代替完整身份闭环。handoff的短期private READY/WS LIVE/incident0证明某一窗口恢复，未验证长时间拥塞不会复发。

仍留下：

1. WS缺口时snapshot同时要quote（三个REST）、depth、多周期candles。已有symbol单飞，仍无法免除一次snapshot的fanout及独立历史核查。
2. 关键private facts与exact-order等共享总请求槽位；旧UNKNOWN固定前三条反复核查，新soft预算没有公平轮转。
3. `source:'BACKGROUND'`未登记成background，advisory请求仍用公共lane/优先级。
4. `premiumIndex`只在告警分类层排除，getQuote仍要求它成功，可能使“没有NET002”的时候snapshot仍失败。
5. route分支执行“60秒≥3”，account UNAVAILABLE分支则直接分类，绕过门槛。
6. NET002的lowPressure只比较权重，遗漏active槽位、queue age、代理连接时延，因而拥塞也可被写成纯响应延迟。

正确处理顺序是修复调度/分类/事实新鲜度，补足分阶段证据；不能用关告警、放宽账户TTL或增加交易频率来宣称网络已经解决。

## 逐项发现及处置依据

### F17 — TESTNET管理面缺少调用者身份边界

**类别：确认的认证缺口＋潜在可靠性/交易控制风险；P1；PROVEN配置与源码，外部利用UNKNOWN。**

S15：main默认host0.0.0.0；server只在PRODUCTION检查management token，TESTNET仅检查“若带Origin则须同host”，无Origin直接next。router包含人工ADD/REDUCE/EMERGENCY_CLOSE、取消orders、TP撤销、credentials/settings等写路由。确认字段是用户交互防误触，不能认证调用者。实时防火墙 `ZDJ-MITS Engine 8080` Enabled/Inbound/Allow，Domain/Private/Public，RemoteAddress Any；当前网络Public。

影响：任何实际可达该端口的客户端可能控制TESTNET交易、保护或配置；settings/诊断读取也无身份限制。生产写token存在，不能扩大结论为生产下单绕过。当前proxy URL未含userinfo，未发现本次凭据泄露。局域网/公网可达性取决其它网络控制，未做扫描或写验证。

**行动：优先修复/评审管理面身份与暴露范围。**进一步证据仅需网络边界/可信客户端访问日志与离线路由授权测试；不需要真实下单来证明缺口。不得在本审计中自行改防火墙、绑定或服务。

### F01 — 行情字段的新鲜度和单调性不成立

**确认缺陷；P1；PROVEN离线复现。**S05 `BinanceMarketStream.ts:53–59` 将24hr、mark与bookTicker patch合并到同一quote.ts，无per-field timestamp、更新水位或旧patch拒绝。T01：先注入60秒旧last/mark，再fresh book，返回quote整体fresh且旧字段保留；再注入较旧book，bid100降为98、ask101降为99。

影响Entry论点、maker计算、Review、估值与行情恢复；即使WS LIVE和NET002消失，仍可能信任不一致事实。depth/kline部分序列保护是有效实现，不能替quote担保。真实错误执行数量/损失UNKNOWN。

**行动：优先修复；**验证应按字段区分exchange/update/receive时间、乱序与REST seed/重连generation。后续只读回放记录原始patch及每字段年龄才能量化线上影响，不能只看global quoteAge。

### F02 — TP异常恢复把远端终态“复活”为活跃状态

**确认缺陷；P1；PROVEN真实类离线调用。**S09 `tpGuardian.ts:82–89` 的ACK异常恢复忽略 `fact.order.status`，仅按executedQty/originalQty返回FILLED/PARTIALLY_FILLED/WORKING。S06适配器已返回真实status。T02逐一FOUND CANCELED/EXPIRED/REJECTED、executed0，`TpGuardian.place`全部返回WORKING，`recordExitOrderReport`也写WORKING。

影响：将失效TP误视活跃、错误占用退出quantity claim，推迟repair；`ensure`对quantity/side吻合WORKING可直接PROTECTED。已有真实终态恢复/交叉价格验证不能纠正异常分支当下的错误。线上曾触发与否UNKNOWN，不能据当前12/12PROTECTED认定12单有缺口。

**行动：优先修复；**覆盖每种exchange终态、部分成交后撤销、ACK丢失与重启replay，确认projection/durable task/claim一致。纯离线足够，不需试下单。

### F05 — REST容量耗尽与恢复扇出放大真实私有事实失效

**已观测可靠性问题；P1；PROVEN失败，STRONG_EVIDENCE放大因果。**S02/S03/S05、R02/R03。WS fresh短路存在；stale时getQuote Promise.all、getSnapshot多请求，6总槽/4public与lane TTL是本地瓶颈。account有singleflight与coalescing，仍出现exact用户request queue timeout和随后的UNAVAILABLE。

影响Entry停滞、私有仓位核验、管理/退出补真值延迟、低吞吐及CPU/日志负担。现有private槽位保留有缓解，但private truth读之间也竞争。没有证据授权放宽资金freshness或跳过订单身份。

**行动：优先解决可用性；**先按purpose观察queue wait/active占用/握手/首字节/取消，比较健康与劣化窗口；验证仅补缺失字段、有界恢复和真正优先private current facts能否减少失效。外部代理根因仍需代理/隧道端日志，不能靠调TTL证明修复。

### F04 — “VERIFIED期望净收益”不具备其标称的经济/统计保证

**确认公式/输入校验缺陷＋交易质量弱点；P1；PROVEN实现，真实EV未知。**S07 `quantityHorizonCandidates.ts:246–247`：

`EV = p × TP条件净利润 + (1-p) × (-requiredNetProfit)`，只要p已知就标VERIFIED。

requiredNetProfit是利润要求，不是未命中后的损失/最终退出分布；历史high/low触及概率不是Entry排队成交概率，也不是现entry价条件下的净收益概率。funding UNPROVEN、slippage0、跨quote FX UNPROVEN进一步限制含义。基础手续费公式未发现重复扣费；应保留“授权目标条件收益”的有效部分，而不是宣布所有经济计算错误。

`historicalTpReachability.ts:60–83` 按行数推horizon，只检最新closed freshness，不检查每段bar间距/连续性。cachedCandles旁路可返回live系列；T01把10分钟间隔的bar当1m，15分钟horizon65重叠样本、p1、READY。主技术gate另有连续性校验，未证明所有Entry绕过它；缺陷在此统计函数不提供宣称的保证。

影响模型选择、目标距离、quantity/杠杆判断和运营者信心。样本max不代表绝对可达边界，重叠样本也不能当65独立观测。

**行动：优先修复字段语义/数据合同；经济参数先测。**需要填充完整的未命中/人工接管后净收益分布、实际fill/费用/资金费和独立out-of-sample；不能将minSamples30或VERIFIED标签当正期望证明。

### F11 — 小目标与开放亏损尾部的结构不对称

**交易质量弱点/既有政策；P1研究；PROVEN机制，收益因果UNKNOWN。**S11/S08：四根连续亏损15m bar→HUMAN_MANAGED、TP retained；管理期限从first fill固定但到期交接不强制退出；Review退出的boundedLoss限制允许动作，不是持仓最大亏损。当前政策无明确固定价格SL。不得把人工接管等同止损，或据此擅自加SL/收紧风险。

R03 LKG12仓、10人工、2自动，稳定币wallet10960.88/equity9143.58/unrealized-1817.30；AVAX SHORT1066、entry10.38554、mark11.27067、浮亏943.55，opened约9/20。数值来自旧已知快照，不保证交易所当前真值；这些仓多数缺新版TradePlan，不能当V397新策略代表样本。后来新快照浮亏变化，不混算成审计造成的损失。

**行动：先测全周期尾部。**最重要验证是短horizon利润与交接后持有损失/资金费是否合计仍正期望；若只统计自动阶段命中/小TP，会遗漏最大的风险来源。有限loss policy属于后续用户决策。

### F07 — 对账有预算但无公平进展，软时限不覆盖整轮

**确认进展缺口＋潜在时延风险；P2；STRONG_EVIDENCE实害。**S10 `reconciliationService.ts:113–143` 每轮exact3/riskProof1、softdeadline30s，却按Map固定序遍历；需要风险核查的旧UNKNOWN失败后仍优先，既无轮转游标也无对应失败退避。当前204 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 分配104/54/46到同三个ID，289UNKNOWN证明数0、tier0记录空。

初始fetchPositions/fetchOpenOrders、前置refreshPositionMarkets及manual/TP阶段不被deadline硬截断；30s不是整任务最大30s。限额确实降低每轮历史远端量，不应否认修复，但不能保证后续identity收到服务或整轮及时完成。

**行动：修公平进展与时限合同；**量测unique IDs coverage、oldest deferred age、重试类别与total run duration。永远缺历史证据的identity必须保留UNKNOWN，不能删除/合成确定性。资金-only下历史不直接veto Entry，但资源间接损失已具机制。

### F06 — Advisory分类与执行依赖不一致

**确认缺陷；P2；PROVEN源码/离线。**S02 `getDerivativesContext`以source BACKGROUND发optional3s请求，S03背景source集合没有BACKGROUND；T02实际返回MARKET_PUBLIC。注释“background lane”不成立，影响优先级/资源隔离。`operationalIncidents.ts:76`把premiumIndex一概advisory排除，但provider `getQuote:87–94` await premiumIndex、ticker24hr、bookTicker全成功，premium失败导致quote拒绝。

影响：非必要背景任务参与公开恢复竞争；告警安静仍可无snapshot。premium/mark在某上下文可能确实必需，不能按endpoint统一定义全部场景的critical/advisory。

**行动：优先修source契约与按purpose分类。**验证各字段必需性/替代源，单独让optional失败的只读回放仍保留所需新鲜事实，不额外扩大Entry veto。

### F03 — NET002私有旁路绕过burst门槛，权重压力代替队列压力

**确认告警语义缺陷；P2；PROVEN。**S04 `operationalCandidates:94–107` route需60秒3个unique timeout，底部account.UNAVAILABLE直接classify无同门槛。T01仅一个私有timeout、无route history，也NET002；因此告警文案“孤立慢请求只遥测”没有全路径保证。

lowPressure比较weight，甚至回落到过时usedWeight1m；active槽满/等待超TTL仍可被当低压力“连续响应慢”。重复private/HTTP scope也可能对同事件计数。**本次实际private快照失效是另一件已证事实，不能因告警分类错就撤销安全阻塞。**

**行动：修说明与事实分类；**分开request admission/transport、burst incident与private-freshness blocker，unique requestId去重，保留首因/恢复时效。

### F08 — 恢复事件重复发布整段旧历史

**确认缺陷；P2；PROVEN线上与离线。**S01 router.ts:95 以before/after active incidentId过滤整个history；同identity再次恢复，旧历史也匹配。T01重复5轮得到恢复发布1/2/3/4/5，正确应每次1。本实例13:18–15:20 `OPERATIONAL_INCIDENT_RECOVERED5458`，ACTIVATED123，不是5458次独立网络恢复。

影响调查统计、事件存储/日志保留、WS invalidation与同步工作；实际CPU/磁盘成本需测，不能归因此native crash。

**行动：修exact transition/event去重；**按发生序列标识恢复，验收重复循环不会放大，统计回算需保留原证据而非删日志。

### F09 — 多层ready/protected与旧projection容易制造假健康

**确认局部projection缺陷＋可观测盲区；P2；PROVEN。**S13 appRuntime.ts:841–845 gate早return时未推新的execution readiness，R02 `.analysis.execution.ready=true`与当下`.executionReadiness.ready=false`同时存在。service /health HTTP200 ready=true允许DEGRADED，这本身可作为liveness语义，但不是execution-ready。market.count8≠fresh8；TP PROTECTED基于localorders≠本次account/orders已fresh核验。

pendingEntries48是兼容/历史占用，exchangeOpenEntryOrders0是另一有时效口径；USDT availableUsd0≠USDC没有funds。weight AVAILABLE≠REST槽位畅通。R02 heartbeat继续、nexteval2.5s说明暂停有明确gate，不是DISPATCH_STALLED。

**行动：修旧execution projection，强调每指标scope/asOf/denominator。**不建议将所有DEGRADED全局OFFLINE，也不应把所有绿灯直接解读可执行。

### F10 — 经济覆盖不足、机会成本和AI延迟未形成科学闭环

**已确认可观测盲区＋交易质量/机会损失假设；P2。**R05:693 TradeRecord，COMPLETE45/PARTIAL641/IMPORTED7；netPnl非空12，funding非空14。这是字段覆盖，**不是12笔全部可作canonical合格样本**。TQ并非没有证据：3844episodes、12965fills、351020opportunities、2486101observations等；latest500episodes中40 ledger合格、canonical合格0、188有path、312 TRADE_RECORD_UNKNOWN。样本按updated_at取，不代表全历史净收益覆盖率。

当前无法可靠给策略总EV、胜率、risk-adjusted return、人工尾部/WAIT机会金额；应完成plan/candidate→order/fill→trade→fullcost join，并报告缺失/观察截尾。TradeRecord mae/mfe字段全空不等于系统其它表无可计算轨迹。

R04过去24h Primary完成256，全PLACE（108LONG/148SHORT），平均约101s；20无decision平均83s。Review132含12无decision，CANCEL55/HOLD51/HANDOFF7/KEEP6/REDUCE1，证明Review在工作，不能复用旧“零自然Review”结论。全PLACE可能来自预筛选/提示/策略，方向与PLACE偏置均未因果确定。

**行动：先测。**补合格pair、fill概率与决策年龄、按regime反事实；禁止凭低成交数调高频率、缩短quality gate或由少量净收益拟合杠杆。

### F13 — 杠杆ACK未闭合

**潜在执行风险；P2；PROVEN实现缺口，实际漂移UNKNOWN。**S06 setLeverage校验integer/maximum并提交POST，但忽略返回leverage/maxNotionalValue，bracket只取首档maximum且cache无TTL。调用先于Entry submit是正确顺序，仍不保证建模杠杆与exchange最终状态一致。配置20不等于V397每单20；冻结候选10–20，有真实10倍持仓。

**行动：值得修/验证。**用离线差异ACK和不同notional档fixture确认合同；只读ACCOUNT_CONFIG_UPDATE/账户事实可量化实际变化，审计不POST杠杆。

### F14 — recvWindow配置被覆盖及route重配代际风险

**确认配置缺陷＋潜在并发风险；P2。**S06 line37 `Math.min(60000,Math.max(recvWindowMs,60000))`在合法配置范围始终60000；默认/当前5000无效。60s本身可合法，但面板配置不能表达实际签名窗口，不能把长窗口当保持经济/资金新鲜的许可。

S03 transport.applyRoute替换agent和budget、未显式destroy旧agent；json在途回调通过可变this.budget observeResponse，可能旧route响应更新新route budget。元数据旧routeIdentity并不足以证明budget对象写入正确。当前同一route未证明切换，不能归因本次timeout给热切换。

**行动：修配置函数与generation捕获，补切换时的只读race fixture。**不能为验证而切真实代理。

### F15 — 内存/同步持久化与长期资源风险

**潜在稳定性风险；P2，不能自称已确认泄漏。**S06 exactOrderCache到期失效但不主动删除unique key；S14 runtime恢复大量实体：tradePlans3340/allocationPlans5939/reservations4330/orders2367等，部分Map无相应内存retention。transport response累计string无明确body cap，route预算/agent生命周期也有缺口。

DatabaseSync、JSON全量checkpoint、retention和多表投影同步运行；WAL/FULL/busy250ms不能免除event-loop等待，观测约585ms checkpoint提示尾时延值得量测。runtimeWriteBuffer5000/日志2GiB上限与flush失败保护存在；F08会加速日志轮换。启动容量guard/healthy DB缓存不能证明运行期物理disk足够。

**行动：先测RSS/heap/external/commit、unique缓存项、GC/loop延迟、checkpoint与DB/WAL/空闲盘斜率；**确定资源增长后修具体生命周期，不按猜测批量清理历史或归因SQLite崩溃。

### F12 — 关闭历史可达性未完全关闭相应拒绝语义

**确认开关语义缺陷/机会损失；P3。**S07有些检查受historicalTpReachabilityEnabled控制，selection目标超统计上界的refusal未同样控制。T01 disabled+无历史仍有12可执行候选（因此“缺史一律veto”假说被反证）；disabled+有历史、target110/bound102.01仍CANDIDATE_TARGET_BEYOND_STATISTICAL_BOUND拒绝。

**行动：先澄清合同再修。**当前ENFORCE/开关false使差异具有现实配置相关性，但V397正常candidateId选择是否实际经过该自定义selection分支UNKNOWN，不能计算机会损失或声称全部Entry被错误拒绝。

### F16 — 原生崩溃仍为开放问题

**历史高影响稳定性风险；P1验证；根因UNKNOWN。**H01已有0xC0000409，--no-maglev同样出现过；无dump/native stack无法锁定SQLite/V8/WS/crypto或系统内存。H02另有Windows虚拟内存事件与AI context缩短背景，但未匹配内存事件的崩溃也存在。最近一次ready/测试通过或本轮PID存活都不构成8–24h稳定验收。

**行动：保留不确定性，后续授权的观测应采6/12/24h资源、阶段task和OS事件/native dump。**不能在只读审计里重启/注入崩溃/移除native模块或承诺根因已解决。

## 默认与当前配置差异

| 配置 | main默认 | 当前Settings247 | 审计解释 |
|---|---|---|---|
| tradeEconomics admission | SHADOW | ENFORCE | 不能把schema默认当运行行为 |
| historicalTpReachabilityEnabled | true | false | F12必须考虑实际开关；不是全部缺历史都veto |
| targetPriceMovePercent | 1.2% | 0.45% | V397优先授权TradePlan目标；fallback值不是每仓真实TP |
| portfolio limits | positions50/pending6/margin200 | 同值 | policy资金-only，组合诊断OBSERVE |
| leverage default | 20 | 20 | 冻结候选支持10–20，不推断所有订单20 |
| minInitialMargin quote | USDT/USDC100 | 同值 | 业务floor，非交易所统一最小保证金 |
| nearMarket | 5bps/90s/2sreview/6reprices | 同值 | 缺市场半衰期/净收益校准 |
| minNetProfit/buffer/slippage | 1USD/.15%ROI/10%/0 | 同值 | 不是完整EV证据 |
| lossHandoff/human期限 | 4bars/1440min | 同值 | 权限交接而非最大损失/强制退出 |
| recvWindowMs | 5000 | 5000 | signed代码实际60000，F14 |
| Primary decisionTimeout | 45000ms | 120000ms | 当前明显偏离默认；24h完成平均101s，先量测尾延迟 |

## 保留的正确实现与已反证猜测

候选级行情隔离、snapshot按symbol/epoch单飞、私有singleflight/coalescing、WS优先、账户delta不冒充全部可用保证金、stable clientOrderId/submit UNKNOWN禁重发、durable exit mandate/JIT reduction proof、GTX与交易所过滤、Review权限分离、多scope UNKNOWN/funds-only nonveto均应保留。

本轮未证明“最新实现没有运行”“低频必然scheduler stall”“历史289UNKNOWN=289活跃挂单”“USDT available0=没有USDC资金”“PROTECTED=经济好”“Review完全没有用”“无历史且开关false仍全部拒绝”“收益表没有任何轨迹数据”“所有timeout=交易所限频”“SQLite导致原生崩溃”。这些说法不能写成缺陷结论。

## 推荐的后续顺序（本轮未实施）

1. 先评审管理面身份/F17与行情字段/F01、TP终态/F02的确定性修复合同；全部可先离线验收。
2. 修REST分类/拥塞观察/F03/F05/F06、对账公平性/F07与恢复事件/F08，保留freshness/真实资金/身份failclosed。
3. 纠正VERIFIED-EV语义/F04，建立合格完整经济数据/F10，先测开放尾部/F11；不要先调交易频率、杠杆、槽位或TP。
4. 在另行授权的自然运行窗口做24h只读soak：unique对账进展、privateFresh占比、逐字段age、各lane排队/握手分段、AI决策年龄、loop/heap/DB/WAL/盘及native事件。保持instance/config/route可追溯，不造单、不制造样本。

明确完成标准是：异常终态不会标活跃；旧/过期字段不会借其它字段刷新；单次与burst告警一致；劣化后关键事实恢复且历史审计公平前进；合格经济样本与缺口可重建。全套测试绿、短时incident0或多PLACE均不能替代这些证据。

## 证据与复核限制

源码定位见下文S索引，所有链接固定到审计SHA；R/T摘录及离线脚本在脱敏证据包，含SHA256 manifest。原始交易所credentials和代理地址不作为报告交付内容。没有请求外部账号访问、未建立网络连通性扫描，也未测试写接口的实际未授权效果。

官方Binance资料仅用于接口语义：账户WS余额/持仓更新是变化事件而非完整账户margin快照，不能因此移除REST可用资金核验；订单查询的旧记录保留限制意味着“查不到”不等于“从未存在”；杠杆接口响应提供实际杠杆值，可用于核验。来源分别为 [ACCOUNT_UPDATE](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams/Event-Balance-and-Position-Update)、[USD-M Trade REST](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)。没有把其它产品线搜索结果当USD-M契约。

255项回答是基于本轮证据的审计意见；标UNKNOWN的项列明了缺哪类样本/链路，不能把建议指标当已测出的结果。没有全量逐行阅读所有repo文件；覆盖了问题所需关键运行/执行/行情/经济/存储/管理路径，既有全套测试的历史结果只作为背景。

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
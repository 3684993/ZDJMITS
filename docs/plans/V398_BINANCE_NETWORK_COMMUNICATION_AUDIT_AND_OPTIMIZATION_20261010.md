# V3.9.8 Binance 网络通信分层审计与优化实施方案

日期：2026-10-10。性质：**基于 GitHub main=11ab47eda93e81cf3dde2dcdd5c3833100e2ed60 的静态代码审计 + Binance 官方接口规范对照 + 已提交部署回执复核。** 非现网新测量、非已经实施的优化。交付 Codex 分阶段离线实现、测试、举证；未经新一轮发布授权，不在运行中改连接。

## 0. 发布与冻结边界

- 已正式发布 TESTNET Engine PID23688、宿主PID26576、build 3.9.8-bb45c11acbe9819a3456、身份6/6；既有代理PID18300，AI模型端口8081/8083/8084不变。
- 当前24h验收：北京时间2026-10-10 08:16:49.685至2026-10-11 08:16:49.685，已开始但**尚未验收通过**。最新仓库回执最初20个有界GET均200、451/502为0；这是采样窗口而非长期无故障保证。发布前签名TP12/12；稍后本地缓存13/13不能替代新签名核对。
- 先完成只读观测、设计、离线PR、回归与CI；**禁止为了通信优化中断现有24h、动态改现网Settings/环境变量/WS地址、重启Engine或代理，禁止干扰持仓TP。** 后续如果用户明确要求上线，先判定此次24h需中止并完整重新开始，执行现有签名TP/6-of-6/合法运行权限准入流程。
- 严禁第二次独立补仓，初始订单部分成交仅可在同一immutable origin数量上限内；保持Primary独立Entry、HUMAN_MANAGED、签名TP、UNKNOWN fail-closed、仅TESTNET、Production writes=0、真实订单双ID幂等以及原有准入限制。HTTP451**不能被强制解释成代理损坏**，不得通过改变出口地区/DNS/交易所域名规避。

## 1. 首先澄清三个不同维度

1. **公用 vs 私有**是交易所端点安全类型，不是必须直连与代理的区别。公用市场行情通常不需要签名；账户/订单/持仓为签名私有；listenKey维护为API-key授权。
2. **REST vs WebSocket**是请求式与持续推送式的通信机制，均可承载公用信息；用户数据WS是**私有信息推送**。REST做首次快照/缺口修复/权威签名读回/订单写入；WS做实时变更提示和增量行情，不能拿没有收到WS事件直接推断“没有成交”。
3. **代理 vs 本机**是网络边界。当前代码的BinanceTransport.assertProxy()要求**全部Binance REST和WS使用配置的SOCKS代理**，Windows 127.0.0.1:20091经SSH:22091到Ubuntu，由Ubuntu连接Demo。包括不签名的公共行情，也不能绕过当前代理执行“直连兜底”；本机localhost的AI模型和Dashboard→Engine API不应经过交易所代理。当前技术上能通过新加坡出口访问，不代表每次451一定是客户端代理BUG。

## 2. 现状路线/接口归属矩阵（源码已实查）

| 流量/用途 | 公/私、安全级别 | 当前协议/实际代码 | 建议与约束 |
|---|---|---|---|
| 合约清单/精度/限额 | 公共exchangeInfo | REST GET /fapi/v1/exchangeInfo；MarketDataProvider.info约15分钟缓存，Transport还能用来发现RATE_LIMIT_CONTROL | 保留REST缓存+single-flight；优先复用，在变更或明确失效时回读。保留配置的权重限制，不用每个调用方重复获取 |
| 全市场筛选流动性/24h成交 | 公共24h ticker | REST GET /fapi/v1/ticker/24hr 无symbol，discoveryTicker约60s single-flight；WS MARKET !ticker@arr | REST只做低频全市场发现；高频决策只读取被保留symbol最新WS快照。评估移除高带宽全市场WS广播前必须证明selection仍有供给 |
| 最优买卖价/微观报价 | 公共bookTicker | WS PUBLIC !bookTicker 全市场；REST /fapi/v1/depth?symbol=...&limit=20 缺口兜底 | 候选/在仓/挂单symbol优先按symbol@bookTicker订阅，不需要全市场推全部BBO；持续测量范围变化与事件丢失 |
| Mark/指数/合约价格 | 公共markPrice | WS MARKET !markPrice@arr@1s全市场；REST /fapi/v1/premiumIndex?symbol=... 关键缺失补足 | 优先按必要symbol@markPrice@1s；标价不可由最后成交价代替；REST只在字段过期或恢复时有限次使用 |
| 逐笔聚合成交 | 公共aggTrade | WS MARKET symbol@aggTrade | 只对实际需要短期成交趋势的候选订阅；缩小retention范围和过期窗口；无有效数据则UNKNOWN |
| 深度top20 | 公共depth | WS PUBLIC symbol@depth20@500ms；REST /fapi/v1/depth?symbol=...&limit=20用于恢复 | 先审查partial snapshot与diff-sequence算法是否一致，再决定保留top20 snapshot或采用标准diff+snapshot缓冲；不能把深度空缺视为价格流继续可靠 |
| 1m/5m/15m K线 | 公共klines | WS MARKET symbol@kline_1m/5m/15m；REST /fapi/v1/klines用于冷启动与缺口补齐 | 保持WS优先、REST补洞；避免全池多时框REST放大。验证单symbol缺口与冷启动并发和取消 |
| 1h历史与指标、OI、funding | 公共慢速衍生品信息 | REST /fapi/v1/klines 1h缓存到整点、/openInterest、/fundingRate、/premiumIndex；BACKGROUND_AUDIT部分降级 | 低优先级缓存、按保留symbol和时段单飞，系统拥堵时主动延后/弃取；不可消耗TP和私有同步预算 |
| 时钟及交易对限速权重 | 公共 | REST /fapi/v1/time、/exchangeInfo | 时钟只做签名偏移与有界健康，避免频繁无意义probe；本地估算不可代替交易所响应头 |
| 账户权益和交易权限 | 私有签名USER_DATA | REST /fapi/v2/account；PrivateAccountSync每15秒单飞，V2 canTrade字段已在发布核验使用 | 保留权威签名REST和60s私有事实TTL；WS账户变更作为提前刷新信号，不以WS替代刚性读回 |
| 仓位数量及持仓风险 | 私有签名USER_DATA | REST /fapi/v3/positionRisk；错误时有有限V2 existence fallback；reconciliation每15秒进入周期 | 不把存在性fallback当完整字段证明；与本地/WS增量对账，缓存不能用于推断不存在 |
| 活动挂单、TP、Algo订单 | 私有签名USER_DATA | REST /fapi/v1/openOrders (整账户或symbol)；发布审核另用/openAlgoOrders；reconciliation整账户扫描间隔约5分钟、缺TP按symbol定向约60s | 当前持仓TP应以签名实时positions+orders合并双ID/qty/side/reduceOnly/price精确匹配；禁止只是看到openOrders 200或本地PROTECTED就认为完整。权重与按symbol检查分开预算 |
| 订单状态及历史成交 | 私有签名USER_DATA | REST /fapi/v1/order、/allOrders、/userTrades、/income；可追踪历史UNKNOWN订单与funding | orderId/clientOrderId定向优先、历史按窗限额与取消；超时/503 UNKNOWN不做盲目二次POST，先询问WS/精确GET |
| 真实订单增删改、TP和杠杆 | 私有签名TRADE写入 | REST POST/PUT/DELETE /fapi/v1/order，POST /fapi/v1/leverage，参见ExternalTradeAdapter | 保留仅TESTNET、Primary权限、原始client ID幂等、TP保护和优先级。**交易写入不能自动切成WS交易API**，未经端到端审查不改变正式出口写入协议 |
| 订单/账户/保证金事件 | 私有用户数据WS | BinanceUserDataStream：POST/PUT /fapi/v1/listenKey + configuredWsUrl/ws/listenKey；处理ORDER_TRADE_UPDATE、ACCOUNT_UPDATE、MARGIN_CALL | 优先校验与迁移到官方PRIVATE路由；WS增量不能单独覆盖REST强一致核验；恢复连接须有带身份/时间的定向REST reconciliation |
| 前台界面和三GPU模型 | 本地内部服务 | Dashboard浏览器→Engine :8080 /api/v3、WS；Engine→8081/8083/8084本机模型 | 不经过交易所代理。Dashboard不应各组件直接并发新建交易所WS/REST；统一使用Engine已发布快照 |
| 代理服务自身探活 | 本地管理+公共GET | Windows代理脚本-Status 进行有界SOCKS+TLS+公共/time，Watch约30秒周期；Ubuntu脚本--check可用管理员身份诊断 | 独立于Engine signed private/TP；不要以公共探活成功取代私有数据成功；严格保护已有SSH/PID与超时预算 |

特别说明：上述“公网公共接口”仍经过固定SOCKS；项目并不存在官方允许的自动“公共直连/私有代理”分流策略，也不得因加速而新增代理外的交易所路由。

## 3. 代码定位及风险清单

### P0-A：WS官方路由与Demo主机兼容性——有直接源码证据，高优先级
- config/settings.default.json: testnetWsBaseUrl = wss://stream.binancefuture.com/ws；官方USDⓈ-M文档列示TESTNET WS基础地址 wss://demo-fstream.binance.com。BinanceTransport.configuredWsUrl()默认测试地址也仍是旧域名。
- BinanceTransport.splitWsRoot()在检测到 stream.binancefuture.com 时改写为 fstream.binancefuture.com，生成 /public/ws 与 /market/ws。官方新分流为/public、/market、/private，尤其/private用户数据。
- BinanceUserDataStream.connect()使用 effectiveWsUrl()（未指定lane），拼接 /listenKey，因而看不到 PRIVATE 路由显式绑定。2026-10-09官方迁移通知明确历史无路由连接只保证PUBLIC频道、MARKET/PRIVATE不推送。
- **要求：** 在不操作现网的独立离线用例中实现endpoint resolver（分别TESTNET vs Production、REST vs WS、PUBLIC/MARKET/PRIVATE），拒绝生产/测试net跨环境，严格原有SOCKS；用官方当前Demo路由的有限、只读授权连接探针确认是否支持该路由（官方主机文档与Demo实测分开记录）；不要直接把生产地址替换成测试网地址。用户流需要真实ORDER_TRADE_UPDATE/ACCOUNT_UPDATE事件或安全模拟事件验证，而非只看WebSocket OPEN。
- 明确保留现运行连接行为直到新PR通过测试且经正式24h重新发布；不能在24h运行时“热修复”或换地理出口。

### P0-B：全市场WS广播流有显著带宽/SSH排队风险——已证实订阅结构，未量化现场实际字节
- BinanceMarketStream.desired(): PUBLIC = !bookTicker + 每symbol depth20@500ms；MARKET = !ticker@arr、!markPrice@arr@1s + 每symbol 3种kline + aggTrade。
- 即便onEvent过滤 symbol，**未保留币种的数据也已经通过远端公网、SSH隧道到本机并被JSON解析**。两个WS通道的逻辑分隔，不代表SSH底层独立拥塞窗口：二者经同一SSH隧道时仍有潜在TCP层队首阻塞。当前每秒×60桶 streamTraffic仅统计解码后WS应用消息/字节，明确 NOT_SSH_WIRE_BYTES。
- **先取证再修改：** 连续多个稳定窗口只读GET /api/v3/diagnostics/market-stream-traffic，收集PUBLIC/MARKET各类payload bytes/messages，retainedSymbols、requestedGlobalStreams、quoteFreshRatio、gaps、reconnects，并与允许主机的ss -tinp相邻时刻对齐，不得从WS payload推断SSH raw byte精确值。后续优先消除 !bookTicker 与 !markPrice@arr@1s 全市场流，!ticker@arr是否需要保留取决于当前发现流量/供给与REST缓存（先验收对照）。按【在仓+挂单+候选+必要发现名单】动态按symbol订阅，并设symbol总量/更新节流/删订阅和原子保留集保护，避免取消TP所需标的。
- 目标用baseline→shadow replay→offline A/B衡量：WS decoded bytes下降而行情的field-freshness(5s)、1m kline连续性、candidate supply、Primary有效节奏、TP都不退化；不凭空设绝对节省百分比。

### P1-C：用户数据WS的真实可用性与事件/心跳语义
- BinanceUserDataStream.ts每15s ping、约50分钟PUT listenKey、45s“活动”阈值；on('pong')也会刷新lastMessageAt，所以一个会pong的空连接可能被标记LIVE但没有任何真实私有事件。metrics只有state/reconnect/lastMessageAt/lastError，缺少lastAccountEvent/lastOrderEvent/lastListenKeyRenew/lastAuthorizedSnapshot等来源分离；无手动交易不能用零事件当作断线证据。
- 独立记录socket OPEN、ping/pong、每种事件、server E/T、lastSuccessfulKeepalive、listenKey到期、事件延迟、连接断点。ORDER_TRADE_UPDATE按order+trade唯一身份幂等入库，ACCOUNT_UPDATE触发受控refresh；事件中断时REST权威UNKNOWN并有序补齐，拒绝凭消息到达时间猜填价格、剩余量或手工管理权。

### P1-D：REST队列与连接池共享、故障隔离
- BinanceTransport.ts通过同一代理 agent、maxSockets=6/maxFreeSockets=6、超时默认15s并分阶段记录SOCKS/TLS/response；BoundedSocksProxyAgent.connect()使用临时delegate agent实现单连接deadline，需检验并发情况下实际keep-alive/reusedSocket与泄露/过量握手，不能仅因代码存在keepAlive就断言使用成功。
- requestBudget.ts现有集中管理、限速响应头解析、优先级EXECUTION/PRIVATE_TRUTH/CONTROL/MARKET_PUBLIC/BACKGROUND、队列TTL与429/418冷却、背景容量限制（保留）；多Transport实例的agent是否共享“真实网络插槽”需要用实际socket/请求ID基准验证。
- 网络高负载时先降全市场广播/REST慢速背景/批量历史读取，不允许牺牲签名私有和TP或绕过锁；区分实际HTTP451（来自交易所还是中间层）、HTTP429/418、502/503、SOCKS_CONNECT_REPLY、TLS、AGENT_QUEUE、READ_BUDGET_ABORT。对429尊重Retry-After、对5xx未知订单走精确clientOrderId查询；**不得统一自动重试交易POST**。
- 复核binanceRequestWeight()静态权重表与当前官方各endpoint实值、rateLimits发现、返回Headers，尤其中高权重整账户openOrders、历史income和positionSide/dual；不要盲目调高并发或延长60秒私有事实TTL。
- ExternalTradeAdapter.signed()目前从源码看recvWindow采用 Math.min(60000, Math.max(this.recvWindowMs, 60000))，**无论配置均变为60000**；比官方默认5000更宽。此为需验证的代码级网络/签名时序风险（独立测试真实业务期望，离线纠正，不在24h现场突然改变）。

### P1-E：快照+增量契约、深度与恢复读放大
- BinanceMarketStream订阅的是partial depth20@500ms，onEvent用pu/U/u校验连续并将每次event bids/asks替换为完整book数组；要与官方“partial depth”和“diff-depth + REST snapshot buffered delta”两种独立模式核对，不能混用校验算法或把diff当完整快照。
- recover(symbol)已有60秒cooldown与in-flight去重，回退REST depth20+1m klines；应逐symbol测试WS gap、乱序、断线、大量symbols同时恢复、订阅ACK缺失/控制队列取消的实际REST请求上限、复核全部价格字段是否仍满足<=5s。补洞期间决策fail-closed，不得回填人为推断行情。
- BinanceMarketStream.subscribeLane()在发送SUBSCRIBE后即设置lane.subscribed=desired；health声明“LOCAL_REQUESTED_NOT_EXCHANGE_ACKED”。下一步需区分 desired/sent/acknowledged/current，并处理NAK、重连和旧控制队列；UI不可把请求过当成功订阅。

### P2-F：周期任务合并与后台REST负载
- appRuntime.ts每15s private sync、每15s reconciliation；每秒行情tick，慢字段、标的清单刷新、背景funding/交易历史；reconciliationService.ts全量openOrders约5分钟，缺TP定向约60s，历史unknown审计已有deadline/window budget。
- BinancePublicMarketDataProvider.info()15min缓存、ticker24hForDiscovery()60s缓存且single-flight，premiumIndexFact()和derivatives有缓存/单飞，但多个入口合并、统一可观测、挤压情况需要量化。不要简单把15秒私有同步调成60秒，或将每次reconciliation改成整账户重查询。
- 建议按当前code实际请求source/purpose权重数据，建立“业务周期、真实请求量、权重、99线响应、独立阻断原因”表；未知费率、未证实持仓、挂单风险仍为UNKNOWN，不能用缓存替代新鲜真相。

### P2-G：账户/权限、451与错误状态
- PUBLIC REST 200证明对应只读接口响应可用；签名 /fapi/v2/account 200 + canTrade=true只证明当时技术交易权；二者都不是永远不会451的证明，也不等于独立官方地区资格。451按原始HTTP来源/业务限制含义处理，不能仅凭“VPS公共/time=200”重标为SOCKS故障。
- 禁止通过切换Ubuntu出口、地理轮转、备用地区代理、冒用生产REST、降低权限/策略或替代API主机规避受限访问。能被证明的纯技术缺陷（SOCKS握手、重连、积压、超时）才允许在受控离线PR修复两个VPN脚本。不得更改现有 MaxSessions0 专用转发账户的无shell安全边界。

## 4. Codex必须按以下阶段交付，不能直接改运行中Engine

| Phase | 具体交付 | 验收与证据 |
|---|---|---|
| N0 只读基线 | 新旧两次运行快照对比，枚举实际RestTransport/WS连接/关键source/purpose权重、终点host、WS userData状态、HTTP451/502/429/418/timeout及SSH socket backlog，记录当前instance | 本地只读、请求预算明确、无私钥/原始SQLite/订单ID上传；写NETWORK_BASELINE.md和sanitized JSON |
| N1 P0接口契约 | 解析REST/WS三lane TESTNET endpoint；补官方路由与私有用户流连接的单元/契约测试；检查LIVE是否收到真实事件、Demo支持情况 | 连接路径测试含测试/生产隔离、WS握手/ACK/私有事件/credential fail-closed；不得做生产写入或路由绕过 |
| N2 压缩无关WS | 解码窗口测量和保留集映射，离线消除可证实的冗余全市场广播；验证PRICE_LAST/MARK/BID/ASK四字段新鲜度、TP/保护标的 | 证明真实decoded流量下降且没有持续quoteFresh、候选供给、Kline完整性退化；官方订阅限额/消息频率不得超 |
| N3 恢复/拥堵 | REST读写优先级、连接池/超时、订阅ACK、partial-vs-diff depth、recovery波峰抑制；无交易所POST重试；完善451/502/503类与代理阶段 | 专项慢SOCKS/HTTP451/503-UNKNOWN/429/418/断WS/TP在仓压力测试、订阅风暴测试，不绕过原有预算 |
| N4 完整质量门 | npm ci && npm run verify、PowerShell VPN回环测试、S00、CI，结合当前24h验收状态做不同环境影子对照 | 完整原有 tests 251/2157作为历史下限，实际最终源重新测试；代码不部署、不改现网任务/授权/代理 |
| N5 可选发布 | 当前24h结束并复核，或用户明确中止后重新准入，执行独立安全发布 | 新构建审批+6/6身份、fresh signed TP every current position、Production0、私有<=60s、无451、持仓订单双ID、启动后新24h T0。任何安全状态UNKNOWN不放行 |

## 5. 具体测试覆盖最低要求

- A：Demo REST host固定demo-fapi.binance.com、Demo WS官方地址及PUBLIC/MARKET/PRIVATE路由，Production完全隔离；未授权直连立刻拒绝；错误配置不能fallback到其它host。
- B：全市场流与symbol流事件对照、保留在仓标的直到仓位/挂单确切解除、tombstone避免重新补仓；订阅顺序、重连、NAK、ACK超时、限额与处理幂等。
- C：WS私有listenKey创建/PUT延期/过期/401/451/503，Event E/T、乱序/重复/断流及一笔部分成交和真实第二独立Entry的区分；不再把pong当作私有成交。
- D：queue saturation、testnet账户同步波动、TP风险命中、REST深度恢复风暴；不同lane不饿死close/TP/private truth；已接收但未知回应的订单不能盲重下。
- E：HTTP451/429/418/502/503和SOCKS超时分别保留证据字段并产生不同处理决策；451拒绝不得重试到其他地区出口。
- F：签名recvWindow实际请求参数、timestamp偏移、response/header限速权重，安全预算边界锁定，不在现场测试时用手工真实订单触发。
- G：WS应用字节、SSH wire bytes、Socks connect queue latency三种单位严格区分；测试跨秒60桶一致性。
- H：禁止补仓Origin身份、HUMAN_MANAGED/TP/订单双ID/Production0/Primary Authority全部通过，新24h不混旧PR19 90min样本。

## 6. 不应做的“伪优化”

- 不因某一条451就修改VPN服务器出口地区、切换备用IP、伪造DNS/HTTP响应、改其他域名或屏蔽真实状态码。
- 不把公共行情从固定代理绕到Windows直连；不允许浏览器直连Binance私有API/接收Secret。
- 不以延长signed private TTL、调宽TP确认阈值、移除UNKNOWN或取消人工管理保护来解决代理拥堵。
- 不以改变REST 15s private sync为每分钟或关闭签名TP读回“降低带宽”；先实测更可控的全市场WS噪声。
- 不把原有PR19 90min、旧PID 18100、最新PID 23688和新24h混为一轮验收。
- 不以修改当前TS源码文件后立即reload/kill服务来追求效果；所有优化先PR并有可重复压力测试，且独立经授权部署。

## 7. 原始资料与可追溯引用

GitHub：
- docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md
- docs/reports/v398-engine-cutover-20261010/NETWORK_PROXY_451_RELEASE_LESSONS_20261010.md
- docs/reports/v398-engine-cutover-20261010/acceptance/baseline.json
- apps/engine/src/adapters/binance/{BinanceTransport.ts,requestBudget.ts,BinanceUserDataStream.ts}
- apps/engine/src/adapters/market/{BinanceMarketStream.ts,BinancePublicMarketDataProvider.ts}
- apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts
- apps/engine/src/services/{privateAccountSync.ts,reconciliationService.ts,marketDataHub.ts}
- scripts/vpn/{zdj-trade-proxy-client-windows.ps1,zdj-trade-proxy-server-ubuntu.sh}
- config/settings.default.json

Binance USDⓈ-M 官方文档（核查时间2026-10-10）：
- Testnet REST/WS地址与signed timing：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info
- WS PUBLIC/MARKET/PRIVATE新路由：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect
- 2026-10-09迁移公告：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice
- 私有listenKey路由、事件顺序与超时：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/user-data-streams
- 订单簿diff/snapshot算法：https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly
- REST接口分类与权重（需在实施时重新比对单端点）：https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data

**审计最终结论：当前的最优先事项不是把SOCKS超时调得更大，而是：验证Demo WS主机与私有路由 → 用实时解码流量证实/删除无关全市场广播 → 用保留现有PRIVATE/TP与REST预算的方式降低SSH积压。** 尚未获得对当前实例的60秒真实流量、SSH wire bytes及所有成交/账户WS事件独立采样，不得虚报节省指标或已修复451。
## 2026-10-10 N3 independent REST timing/weight repair — offline only

分支codex/v398-network-n3-recvwindow独立基于main3cb72de，未依赖N1 PR25。实际签名查询回归复现recvWindow恒60000：17项中10fail/7pass；修复为遵守合法配置，非法值在clock/network/write boundary前拒绝，5s默认不再被静默放宽。官方USD-M leverageBracket=1、commissionRate=20，而代码都30；weight回归2fail/4pass后仅修正两个估算，保持预算上限/并发/PRIVATE/TP reserve/响应头权威和429/418约束。451/429/418/502/503 unknown/SOCKS8000ms均为内存mock单次POST失败，无真实交易所/数据库操作、无盲重试/出口fallback。

最终本分支npm ci/full verify PASS253files/2180tests，专项4files/54tests，S00/VPN回环PASS；精确PR CI待独立核验。原失败、timing-only完整pass与最后完整日志全部保留。报告docs/reports/v398-network-rest-window-20261010/REST_TIMING_REPORT.md。原24h已08:34因TP gate中止，未恢复或重启，N1样本17/17是本地缓存而非新签名证明；现网/代理/授权/TP保护及禁补仓全不变。N2实际降噪/真实负载A/B及余下N3 ACK/depth/private-event/socket共享仍待下一独立阶段，不能宣称整个网络优化完成。
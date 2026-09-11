# 智多金多币种智能交易系统 V3 — 完整项目架构设计

版本：3.0.0  
日期：2026-08-23  
定位：多币种智能机会竞争、专业 AI 入场判断、确定性 Maker 执行、持仓隔离与 TP 守护

## 1. 产品目标

V3 的核心不是让每个交易对各自循环，也不是让 AI 直接控制交易所。系统持续维护一个有限的“高价值候选工作集”，把 GPU 算力集中到当前最值得研究的标的，再由 27B PRIMARY_BRAIN 输出入场方向与可接受价格区间，最终订单价格、数量、杠杆、Maker 合规、TTL、TP 与对账全部由确定性代码负责。

最终闭环：

```text
Market Data Hub
  -> Universe Selector
  -> Eligibility Gate
  -> Opportunity Ranking
  -> Dynamic Trading Pool
  -> B580 / 9B Scout
  -> Entry Intelligence Packet (EIP)
  -> 7900-A / 27B PRIMARY_BRAIN
  -> 7900-B / 27B PRIMARY_BRAIN / selective review
  -> PLACE_LONG | PLACE_SHORT | REJECT_CANDIDATE
  -> Entry Intent: ideal price + acceptable band + 1–5m horizon
  -> Entry Manager: final Maker price
  -> PENDING_ENTRY
  -> POSITION
  -> TP Guardian
  -> CLOSED
  -> symbol becomes eligible again
```

## 2. 不可违背的系统原则

1. **默认综合选币偏主流流动性。** 流动性权重最高，热点与资金活跃只是竞争加分，不让低流动性币因为短时剧烈波动占用主脑。
2. **持仓、活动 Entry 委托、交易池互斥。** 同一 symbol 不能同时属于多个交易阶段。
3. **15m 是默认方向主证据。** 1m/5m 主要解决时机与价格；4h/1d/1w 仅提高相应证据权重，不构成硬方向封锁。
4. **AI 只负责入场判断。** AI 不拥有 place/cancel/close/change leverage 等交易写工具。
5. **AI 决定价格区间，Entry Manager 决定最终 Maker 价格。** 模型不直接构造交易所订单。
6. **禁止在线 HOLD。** 业务决策协议只有 PLACE_LONG / PLACE_SHORT / REJECT_CANDIDATE。
7. **订单绝对 TTL 默认 60 分钟。** TTL 是硬上限；期间允许确定性 KEEP/REPRICE/CANCEL，但必须基于价格区间、可达性和事实失效，而不是简单“等了几分钟”。
8. **自动 TP，人工止损。** 自动执行链不创建止损订单，也不会因亏损、回撤、AI意见自动平仓。
9. **历史经验进入证据，不直接变成永久方向偏置。** 经验以统计和近期教训进入 EIP。
10. **浏览器无交易权限。** Dashboard 只访问 Engine API/WS；模型端口、交易所密钥和写权限只在服务器侧。

## 3. 系统分层

### 3.1 Data Plane

职责：交易所行情、K 线、盘口、标记价格、OI、Funding、Taker Buy/Sell、Long/Short、BTC/ETH 全局行情。

生产目标：WS 为主、REST 补洞；所有数据统一时间戳、freshness、source、completeness。

基础包：
- MockMarketDataProvider：完整模拟 120+ 标的。
- BinancePublicMarketDataProvider：公共 REST 证据适配，适合功能验证；生产需升级为集中式 WS + 缓存。

### 3.2 Intelligence Plane

职责：指标、选币、EIP、9B Scout、27B PRIMARY_BRAIN、只读补证据。

关键输出：EntryIntent，不是 ExchangeOrder。

### 3.3 Execution Plane

职责：Maker 定价、数量合法化、杠杆、挂单、改价、撤单、TTL、成交、持仓、TP、对账。

### 3.4 Experience Plane

职责：交易结果结构化、Symbol/Regime/Execution 经验、平均成交等待、胜率和失败模式。

### 3.5 Presentation Plane

职责：Vue Finance Workspace。页面只消费 `/api/v3` read model 与审计命令，不复制交易算法。

## 4. 智能选币

### 4.1 五种内置模式

| 模式 | 产品含义 | 核心排序 |
|---|---|---|
| 默认·综合 | 默认推荐，明显偏主流高流动性 | Liquidity 35%、Trading Activity 18%、Capital Activity 12%、Technical 18%、Reachability 12%、Data Quality 5% |
| 交易所排名 | 优先主流成交额和交易所排名 | Liquidity 62% + 基本活跃/可达性过滤 |
| 交易活跃 | 偏短周期成交与波动机会 | Trading Activity 40% |
| 资金活跃 | 偏新增资金与衍生品变化 | Capital Activity 40% |
| 自定义交易对 | 仅在用户白名单内部竞争 | 使用默认综合权重，仍执行全部硬过滤 |

### 4.2 Universe Top N

默认 100。它只是观察范围，不等于送入 AI 的数量。

流程：

```text
全市场有效 USDT 永续
 -> 模式排序
 -> Top N (默认100)
 -> Eligibility Gate
 -> Shortlist
 -> Pool Target (默认8)
 -> Pool Max (默认12)
```

### 4.3 Eligibility Gate

以下任一成立直接排除，不允许用低分“勉强通过”：
- 已有真实持仓；
- 已有 NEW / WORKING / PARTIALLY_FILLED Entry；
- 用户排除；
- 自定义模式下不在白名单；
- 24h quote volume 低于阈值；
- spread 超阈值；
- 数据完整度低于阈值；
- 交易规则未知、数量/名义价值无法合法化（生产适配阶段补齐）；
- 行情 stale 或合约不可交易（生产适配阶段补齐）。

### 4.4 六维机会评分

**Liquidity**：24h quote volume、spread、盘口深度。  
**Trading Activity**：trade count、5m/15m volume acceleration、ATR%。  
**Capital Activity**：OI Δ、OI value、taker buy/sell、funding、拥挤度。  
**Technical Opportunity**：15m trend strength、MACD、BB、结构、位置。  
**Execution Reachability**：spread、1m/5m ATR、盘口、未来 1–5m 可达带。  
**Data Quality**：freshness、缺失率、同步状态。

分数只回答“谁值得占用 AI 算力”，不直接决定 LONG/SHORT。

## 5. 动态交易池

默认：Pool Target=8，Pool Max=12，27B 最大并行分析=2。

事件驱动补池：
- POSITION_OPENED：立即剔除；
- ENTRY_ORDER_CREATED：移入 PENDING_ENTRY；
- ENTRY_CANCELED/EXPIRED：恢复候选资格并重新评分；
- POSITION_CLOSED：恢复候选资格；
- CANDIDATE_REJECTED：立即补下一名；
- SETTINGS_UPDATED：selectionGeneration +1，重新建立候选集合；
- DATA_RECOVERED：重新评估；
- 更强候选超过池尾 replacementDelta 时，可替换 READY 池尾。

状态机：

```text
AVAILABLE -> SHORTLIST -> POOL -> ANALYZING
                  ^        |          |
                  |        | reject   | approve
                  |        v          v
                  +---- AVAILABLE   PENDING_ENTRY
                                      | fill
                                      v
                                   POSITION
                                      | TP filled
                                      v
                                    CLOSED
                                      |
                                      +----> AVAILABLE
```

## 6. 建仓质量与频率

| 预设 | Pool 目标 | 候选门槛 | Evidence | 二次主脑 | 目标 |
|---|---:|---:|---:|---|---|
| 默认·平衡 | 8 | 中等 | 0.86 | 选择性 | 质量/频率平衡 |
| 频率优先 | 11 | 更宽 | 0.75 | 少量 | 更多机会与挂单 |
| 质量优先 | 5 | 更严 | 0.93 | 更积极 | 更高证据密度、较低频率 |
| 自定义 | 用户配置 | 用户配置 | 用户配置 | 用户配置 | 高级控制 |

AI 自报 confidence 不是“质量”的唯一来源。最终还看 evidence completeness、timeframe conflict、reachability 与复核一致性。

## 7. 多周期方向权重

默认权重：
- 1m: 0.10
- 5m: 0.20
- 15m: 1.00
- 4h: 0.35
- 1d: 0.20
- 1w: 0.10

用户选择“15分钟趋势”时提高 15m 权重；选择 4h/日线/周线时只提高对应权重，绝不写成“相反方向禁止入场”。

BTC 与 ETH 构造 Global Regime Card：RISK_ON / RISK_OFF / MIXED / HIGH_VOLATILITY / LOW_VOLATILITY，作为所有候选共享的市场背景。

## 8. 技术指标事实层

V3 核心指标全部提供实际数值与变化，不只给标签：
- EMA 8/21/55 + EMA21 slope；
- MACD 12/26/9：line、signal、histogram、hist slope、last cross direction/age；
- Bollinger 20/2：upper/middle/lower、position、bandwidth；
- ATR14 / ATR%；
- HH/HL/LH/LL 与 recent swing high/low；
- Volume Z-Score；
- 当前 last/mark/bid/ask/spread/tickSize/stepSize/minQty/minNotional。

## 9. Entry Intelligence Packet (EIP)

每个 Final 判断前构建版本化 EIP 3.0。目标是高密度、可审计、可引用，而不是长篇自然语言。

EIP 八层：
1. Selection：rank、score、六维构成、selection mode；
2. Market：Quote + 1m/5m/15m/4h/1d/1w 技术卡；
3. Microstructure：spread、top depth、microprice、imbalance、1m/5m reachable band；
4. Derivatives：OI、OI Δ、Funding、Taker Ratio、Long/Short、Top Trader；
5. Global Regime：BTC/ETH 多周期；
6. Portfolio：LONG/SHORT 数量、名义敞口、盈利比例、Pending；
7. Experience：同币/同环境样本、胜率、平均成交等待、近期 lessons；
8. Evidence：evidenceRefs、completeness、contradictions。

典型 27B 输入预算建议 3K–7K tokens；异常复核 8K–12K。避免固定多轮长链。

## 10. 三 GPU AI Fabric

### B580 / Qwen3.5-9B

职责：Scout。输出 summary、keyEvidence、contradictions、missingEvidence、attentionScore。没有任何建仓或交易权限。

### RX 7900 XTX #1 / Qwen3.8-27B

PRIMARY_BRAIN，对候选输出最终 Entry Intent。

### RX 7900 XTX #2 / Qwen3.8-27B

PRIMARY_BRAIN，与 #1 对称并行。正常情况下同时分析不同 symbol；只有以下情况选择性复核同一候选：
- contradictions >= 2；
- evidence completeness 低于目标；
- confidence 处于中间模糊区；
- missing evidence 较多；
- 用户设置 ALWAYS。

若两个主脑方向冲突，确定性裁决为 REJECT_CANDIDATE，而不是投票强行开仓。

## 11. AI 决策协议

唯一最终决策：
- PLACE_LONG
- PLACE_SHORT
- REJECT_CANDIDATE

PLACE 必须同时返回：
- confidence
- idealPrice
- acceptablePriceRange.min/max
- horizonMinutes（1–5）
- reachability
- directionAnalysis（六周期）
- supportingEvidence[]
- contradictions[]
- missingEvidence[]
- evidenceRefs[]
- entryInvalidation
- reason

允许最多 1 轮、每轮最多 2 个只读补证据请求。允许工具仅为市场/持仓/经验读取；不提供交易写工具。

## 12. Entry Manager

AI 的价格结论不是交易所 price。Entry Manager 每次使用最新盘口执行：

LONG：最终 Maker Buy 必须 `<= bestBid` 且位于 AI acceptable range。  
SHORT：最终 Maker Sell 必须 `>= bestAsk` 且位于 AI acceptable range。

生产 Binance 适配应使用交易所 Post-Only 语义（USDⓈ-M 文档当前列出 GTX / Good Till Crossing）并遵守 PRICE_FILTER、LOT_SIZE、MIN_NOTIONAL 等规则。

如果当前 Maker 价格无法落在 AI 区间或 reachability 低于阈值，Entry Manager 拒绝这个 Entry Intent，不替 AI 扩大价格区间。

数量：

```text
notional = configured entryMarginUsd × leverage
quantity = notional / makerPrice
-> stepSize floor
-> minQty / minNotional correction
```

## 13. Pending Entry 生命周期

- 创建后从 Trading Pool 移除；
- 定期复核 reachability 与最新 Maker price；
- 价格仍在 AI 区间且改善成交概率时允许 REPRICE；
- AI 区间明显失效且 reachability 极低时 CANCEL；
- 到 60 分钟绝对 TTL 必须 EXPIRE；
- 成交立即进入 POSITION；
- 取消/过期后重新评分，不直接原位回池。

## 14. 持仓与 TP Guardian

持仓一旦建立：
- Universe/Pool 立即排除该 symbol；
- Position Service 只维护真实数量、方向、均价、mark、PnL、leverage；
- TP Guardian 检查 TP 是否存在、数量是否匹配；
- 缺失则创建/修复 TP；
- TP 成交后记录结果、释放保证金、恢复候选资格。

默认 TP：`PRICE_MOVE_PERCENT`，基础包给出可配置示例值；生产参数必须由用户在测试网与历史结果上确认。

**没有自动止损模块。**

## 15. Experience Memory

只记录结构化结果，不把完整历史对话塞给模型：
- symbol / side / entry / exit / pnl；
- regime；
- fillMinutes；
- sameSymbolWinRate；
- sameRegimeWinRate；
- averageFillMinutes；
- recentLessons。

经验默认不加入 Universe 主评分，只进入 EIP；避免系统长期锁定历史赢家。

## 16. Vue Dashboard 信息架构

视觉定位：主流专业金融 SaaS，浅灰工作区 + 白色金融卡片 + 海军蓝导航；避免工业监控、霓虹、HUD、终端正文。

页面：
1. **总览**：权益、可用资金、未实现PnL、Pool、GPU、异常、持仓；
2. **智能选币**：Pool / Universe Top N、六维评分、候选画像；
3. **市场智能**：完整 EIP、多周期矩阵、资金、盘口、BTC/ETH、反方证据；
4. **AI 大脑**：三GPU资源、模型职责、Run Trace、tokens/latency/decision；
5. **持仓**：Position 与 TP 一致性；
6. **订单**：Entry TTL/Reprice/Reachability、TP；
7. **交易记忆**：结构化完成样本；
8. **运行中心**：Market/Pool/AI/Reconciliation/TP 健康；
9. **系统设置**：完整用户偏好与执行参数。

## 17. 系统设置

### 智能选币
- Selection Mode：综合 / 交易所排名 / 交易活跃 / 资金活跃 / 自定义；
- Universe Top N：默认100；
- Pool Target：默认8；
- Pool Max：默认12；
- replacementDelta；
- customSymbols / excludeSymbols；
- minQuoteVolume / maxSpread / minDataCompleteness。

### 建仓质量与频率
- 默认·平衡；
- 频率优先；
- 质量优先；
- 自定义。

### 方向参考
- 默认；
- 15分钟趋势；
- 4小时趋势；
- 日线趋势；
- 周线趋势；
- 自定义。

所有选项都只是权重策略，没有长周期硬方向否决。

### 杠杆
- 默认；
- 10X；
- 20X；
- 自定义；
- symbol override 在生产适配阶段扩展。

### Entry / TP
- entryMarginUsd；
- absolute TTL；
- review interval；
- max reprices；
- min reachability；
- TP price move %；
- TP quantity %。

## 18. API / WS

基础 API：
- GET `/api/v3/snapshot`
- GET `/api/v3/universe`
- GET `/api/v3/pool`
- POST `/api/v3/pool/refresh`
- GET `/api/v3/brain/resources`
- GET `/api/v3/brain/runs`
- GET `/api/v3/eip/:symbol`
- GET `/api/v3/positions`
- GET `/api/v3/orders`
- GET `/api/v3/experience`
- GET/PUT `/api/v3/settings`
- GET `/api/v3/operations/health`
- POST `/api/v3/entry/:id/cancel`
- POST `/api/v3/tp/:positionId/repair`
- WS `/ws`

WS 是实时提示，不是唯一真相；Dashboard 继续周期性 REST reconcile。

## 19. 基础包运行能力

`ZDJ_DATA_MODE=mock` + `ZDJ_AI_MODE=mock` 时，系统不依赖交易所、不依赖GPU模型，也能完整运行：
- 120+ mock symbols；
- 真实指标计算；
- 五种选币模式；
- Top N / Pool；
- EIP；
- 9B mock scout；
- 双27B mock brain pool；
- 选择性复核；
- Maker定价；
- Pending / Reprice / TTL；
- mock fill；
- Position；
- TP；
- Outcome / Experience；
- REST/WS；
- Vue 9 页工作台。

## 20. 生产必须补齐的外部依赖

以下内容已经有接口或适配位置，但不能在没有目标账户、测试网和真实模型服务的情况下假装完成：
1. Binance 私有交易写适配器：签名、持仓模式、GTX/Post-Only、leverage、Entry/Cancel/Replace、TP；
2. Binance WS Market Data Hub：集中订阅、断线重连、序列校验、REST补洞、限频；
3. 交易所真实 reconciliation：positions/orders/fills/account；
4. SQLite/PostgreSQL 持久化：settings、orders、positions、AI runs、experience、audit；
5. Secret Provider：API key/secret 不落前端、不明文日志；
6. 三 GPU 真实 OpenAI-compatible endpoints 的模型/JSON协议/性能验证；
7. 生产进程守护、日志轮转、备份恢复、24h/72h endurance；
8. 精确 TP 参数与 account sizing 生产校准。

这些项目全部在 Codex Terra 实施计划中有独立阶段和退出条件。

## 21. 安全与审计

- 前端不保存 API Secret；
- 模型端口只允许 localhost / 内网；
- AI Run 记录 packetId、resourceId、model、latency、token、decision；
- Entry Intent 记录 brainRunId / packetId；
- Exchange Order 记录 intentId；
- Position 记录 Entry Order；
- TP 记录 positionId；
- 生产所有写命令必须具有 idempotency key 与 auditId；
- 日志不得输出密钥。

## 22. 测试体系

### Unit
指标、选币权重、Eligibility、Pool、EIP、方向权重、Maker定价、quantity rules、TP price。

### Contract
EIP 3.0、BrainDecision、REST、WS、Model JSON。

### Integration
Market -> Universe -> Pool -> EIP -> Brain -> Entry -> Fill -> Position -> TP -> Close。

### Failure
AI timeout、GPU offline、WS断线、数据 stale、exchange reject、TP missing、reconciliation drift。

### Endurance
24h shadow；72h simulation；资源泄漏、队列等待、token、数据库增长、日志增长。

## 23. 生产验收指标

- Universe Top N 与设置一致；
- position / active entry symbol 绝不出现在 Pool；
- Pool 自动补充，无长期空槽；
- 每个 PLACE 决策都有 EIP / evidenceRefs；
- 27B Final input 证据完整，不再只有简单标签；
- PLACE 必须有 1–5m price band；
- 最终订单价由 Entry Manager 产生且 Post-Only 合规；
- 60m TTL 100% 生效；
- TP missing 自动修复；
- 自动止损执行次数永远为 0；
- 双7900有并行吞吐，B580不持有建仓权限；
- AI/交易所故障时系统 fail closed，不凭空构造订单；
- Dashboard 与 Engine read model 同源。

## 24. 外部技术依据

- Vue 官方 TypeScript 指南：`https://vuejs.org/guide/typescript/overview`
- Vue Router 官方：`https://router.vuejs.org/`
- Binance USDⓈ-M Futures 开发文档：`https://developers.binance.com/en/docs/catalog`
- Binance USDⓈ-M 公共定义与交易规则（PRICE_FILTER / LOT_SIZE / MIN_NOTIONAL / GTX 等），2026-06-30 修订页面：`https://developers.binance.com/zh-CN/docs/products/derivatives-trading-usds-futures/common-definition`

生产接入必须以实施当天的官方接口文档和目标账户实测为准。

# V3.9.7 Binance 链路 / 行情数据 / 私有接口全面诊断与加固计划

> Status: **APPROVED — PHASE A DIAGNOSTIC CAPTURE ACTIVE**
> Date: 2026-10-06
> Scope: TESTNET only. 本文件仅制定计划；本次提交不实施运行时代码修改。

## 0. 硬约束

- 不停止、重启或重载 8083 / 8084。
- Production writes 必须始终为 0。
- 不重新引入固定/静态出口 IP gate。
- 不用自动重启掩盖 Engine native crash。
- 不删除或重置 SQLite、TradeRecord、持仓、订单或交易历史。

## 1. 本次问题归类

### P1 — MARKET-DATA-001 / MARKET_QUOTES_STALE 高频出现

- 同一批 Symbol 会在 READY 与 QUOTE_STALE / ORDER_BOOK_STALE / 1m、5m 技术卡过期之间切换。
- 告警可自动恢复，说明是间歇性数据输送/新鲜度问题，不是行情涨跌趋势判断。
- 当前代码在 15 秒 quote/book 新鲜度阈值下，一旦 WebSocket 缺流，会进入 REST recovery。

### P2 — Binance REST / 私有同步 / 写接口不稳定

- 出现 NET-002 / HTTPS timeout。
- 私有同步出现 BINANCE_TRANSPORT_BLOCKED: Binance request timed out，并退回最后已知持仓。
- POST /fapi/v1/leverage 多次出现 Binance -1000 UNKNOWN。
- 目前没有证据证明这些等同于普通订单参数或账户条件拒绝。

### P3 — 前台日志中文乱码

- JSON 结构正常，但中文在 foreground 日志中已经变成 mojibake。
- 当前 PowerShell 只在写文件时指定 UTF-8；没有先固定外部进程 stdout/stderr 的 PowerShell/Console 解码。

### P4 — Market Intelligence 显示 STARTING / OFFLINE_ONLY

- OFFLINE_ONLY 是当前 Temporal 隔离策略的预期结果：不允许在线研究 worker 直接使用 live trading DB。
- STARTING 应只作为真正的短暂初始化状态；策略状态已知后不应反复造成“市场周期故障”的错觉。

## 2. 当前最高置信代码问题：WebSocket 路由架构已过时

当前仓库默认值仍是：

- Production: wss://fstream.binance.com/ws
- Testnet: wss://stream.binancefuture.com/ws

当前 Binance USDⓈ-M WebSocket 已按数据类型拆分为 Public / Market / Private。旧的未分流 URL 在迁移完成后不再承担全部流类型。

当前 BinanceMarketStream 却在一个 socket 上混合订阅：

- Public 类：bookTicker、depth
- Market 类：ticker、markPrice、kline、aggTrade

BinanceUserDataStream 又从同一个 generic effectiveWsUrl() 拼接 listenKey。

### 影响假设

如果当前连接只收到部分数据类，则：

1. Market 类缺流会让 last / mark / kline 逐渐过期；
2. Public 类缺流会让 book/depth 逐渐过期；
3. marketDataHub 每 10 秒尝试 REST recovery；
4. REST recovery 会增加代理与 Binance REST 压力；
5. 随后更容易出现 HTTPS timeout、NET-002、private sync timeout，形成“WebSocket 缺流 → REST 放大 → 链路更差”的反馈。

这是目前优先级最高、最值得先验证的代码级假设，但必须先用独立诊断脚本做 A/B 证明，再改 Engine。

## 3. 当前不能直接下结论的三类原因

### 3.1 不能直接说“请求太频繁”

需要至少一类明确证据：

- HTTP 429 / 418；
- Binance -1003 / -1008 等限流错误；
- X-MBX-USED-WEIGHT / ORDER-COUNT 接近交易所上限；
- 本地 requestBudget 明确 SATURATED / queue timeout 且 attribution 对应。

普通 HTTPS read timeout 本身不是限流证据。

### 3.2 不能直接说“VPN/代理有问题”

需要证明：

- 低频、单请求、同一代理路径仍出现 connect/TLS/read timeout；
- 多类 endpoint 同时异常，而 Binance request weight 仍有明显余量；
- 或 WebSocket heartbeat/reconnect 在低负载下仍持续失败。

### 3.3 不能直接说“请求格式不规范”

需要确定性的 Binance endpoint-specific 证据，例如：

- timestamp/signature/auth 错误；
- -11xx / -1013 / -40xx 等参数、精度、filter 错误；
- WebSocket SUBSCRIBE 返回明确 {code,msg}；
- test-order 在健康链路下仍稳定失败。

## 4. 第一阶段：只开发独立诊断脚本，不改 Engine 行为

计划新增：

- scripts/binance-link-audit.mjs
- scripts/windows/test-binance-link.ps1

建议调用：

    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\test-binance-link.ps1 -Symbol ETCUSDC

默认必须是：TESTNET + READ_ONLY + 与 Engine 相同的 SOCKS 代理配置。

诊断脚本不得从命令行参数读取 API Secret；应复用现有 SecretStore/安全配置路径或受保护环境。

## 5. ETCUSDC 交易对前置检查

1. 先读取 Testnet exchangeInfo。
2. 检查 ETCUSDC 是否存在且 status=TRADING。
3. 若不存在：
   - 明确输出 SYMBOL_UNAVAILABLE；
   - 不得假装 ETCUSDC 已测试；
   - 仅在显式 -AutoFallbackSymbol 参数下选择一个当前可交易 Symbol。
4. 任何可写测试前必须额外证明：
   - 该 Symbol 无持仓；
   - 无普通/Algo 活动委托；
   - 环境确为 TESTNET；
   - Production write counter = 0。

## 6. Public REST 全面矩阵

按顺序、低频、通过与 Engine 相同代理测试：

- GET /fapi/v1/time
- GET /fapi/v1/exchangeInfo
- GET /fapi/v1/ticker/24hr?symbol=...
- GET /fapi/v1/ticker/bookTicker?symbol=...
- GET /fapi/v1/premiumIndex?symbol=...
- GET /fapi/v1/depth?symbol=...&limit=20
- GET /fapi/v1/klines 1m / 5m / 15m
- GET /fapi/v1/openInterest?symbol=...
- GET /fapi/v1/fundingRate?symbol=...

每个请求记录：

- route identity；
- connect/read/total latency（能取得时）；
- HTTP status；
- Binance code/msg；
- used-weight / order-count headers；
- response bytes；
- 返回时间戳新鲜度；
- timeout / retry 分类。

任何输出必须脱敏 signature、apiKey、authorization。

## 7. 当前 WebSocket 路由的原样测试

诊断脚本首先完全按当前 Engine 配置连接，不做修正。

分别证明以下流是否真正收到消息：

- !bookTicker
- <symbol>@depth20@500ms
- !ticker@arr
- !markPrice@arr@1s
- <symbol>@kline_1m
- <symbol>@kline_5m
- <symbol>@kline_15m
- <symbol>@aggTrade

每个流记录：

- SUBSCRIBE request id；
- ACK / error；
- first-message latency；
- 60 秒 message count；
- 最后 event timestamp；
- 最大 inter-message gap。

订阅完成后执行 LIST_SUBSCRIPTIONS 校验。

如果 Public 类持续有消息，而 Market 类没有消息，则可以直接证明“旧未分流 WebSocket 路由”是 MARKET_QUOTES_STALE 的根因之一。

## 8. 新 split WebSocket 架构 A/B 测试

在不改 Engine 的前提下，由脚本测试 Binance 当前分流架构：

### Public socket
- bookTicker
- depth

### Market socket
- ticker
- markPrice
- kline
- aggTrade

### Private socket
- user-data / listenKey

注意：Production 官方路径可用于规范依据，但 Testnet 的实际 host/path 必须由脚本实时探测并固化证据，不能凭猜测直接写入运行代码。

比较 current-vs-split：

- handshake success；
- first-event latency；
- message continuity；
- 缺失 stream class；
- reconnect count；
- proxy/TLS/read error。

## 9. Signed Private REST 全面矩阵

低频串行测试：

- account / balance；
- V2 / V3 positionRisk；
- openOrders；
- openAlgoOrders；
- leverageBracket；
- commissionRate；
- multiAssetsMargin；
- positionSide/dual；
- 若存在安全的既有订单身份，再测试 exact-order lookup；
- userTrades / allOrders / income 只使用窄时间窗口。

必须区分：

- NETWORK_CONNECT_TIMEOUT
- NETWORK_READ_TIMEOUT
- LOCAL_REQUEST_BUDGET_QUEUE_TIMEOUT
- BINANCE_HTTP_ERROR
- BINANCE_BUSINESS_CODE
- RESPONSE_SCHEMA_OR_PARSE_ERROR。

## 10. 请求格式验证：不创建真实订单

若当前 USDⓈ-M Testnet 支持，使用 POST /fapi/v1/order/test。

测试订单必须从实时 exchangeInfo filter 构造，不硬编码精度。

验证：

- timestamp / signature / recvWindow；
- hedge / one-way positionSide；
- stepSize；
- tickSize；
- minimum quantity / notional；
- LIMIT + GTX 参数；
- clientOrderId 规范。

该阶段不得产生真实挂单。

## 11. 可选 TESTNET 写测试 — 默认禁用

只有用户再次明确批准后，才允许诊断脚本开启写模式。

可选测试：

- POST /fapi/v1/leverage 使用已证明合法的杠杆值；
- 可选最小 create → exact query → cancel 生命周期。

保护条件：

- TESTNET only；
- Production writes = 0；
- 所选 Symbol 无持仓/活动委托；
- 严格串行；
- 最大请求次数固定；
- 订单身份必须 exact verification；
- 必须验证 cleanup；
- 不允许自动 retry storm。

这一阶段重点回答：-1000 在“孤立单次 leverage 请求”下是否仍出现，还是只在 Engine 并发负载下出现。

## 12. 受控负载分离测试

不是压力测试，只做小规模分离：

- sequential；
- 1 request/s；
- 2 requests/s；
- 4 requests/s。

遇到 429 / 418 立即停止。

判定规则：

- 单请求也失败 → proxy/network/Testnet service 优先；
- 单请求稳定、低权重并发失败 → proxy/concurrency bottleneck 优先；
- weight 接近上限或出现 429/418 → RATE_LIMIT_PRESSURE；
- 单个 endpoint 稳定返回 deterministic 4xx → REQUEST_FORMAT/API_COMPATIBILITY。

## 13. 诊断证据输出

每次运行创建独立目录：

    docs/reports/binance-link-audit-YYYYMMDD-HHMMSS/
      summary.json
      diagnosis.md
      rest-public.jsonl
      rest-private.jsonl
      websocket-current.jsonl
      websocket-split.jsonl
      request-budget.json
      environment-redacted.json

diagnosis.md 只能使用有证据的标签：

- WS_ROUTING_OBSOLETE
- PROXY_OR_NETWORK_UNSTABLE
- RATE_LIMIT_PRESSURE
- REQUEST_FORMAT_INCOMPATIBLE
- BINANCE_TESTNET_TRANSIENT
- APP_RECOVERY_AMPLIFICATION
- NO_FAULT_REPRODUCED

可以多标签，但每个标签必须有独立证据。

## 14. 第二阶段：拿到诊断证据后才实施 Engine 修复

### 14.1 拆分 WebSocket ownership

- BinanceMarketStream 拆成 Public 与 Market 两条明确连接。
- 不再在一个 socket 混合 Public / Market stream classes。
- 每条 lane 独立暴露 state、connectedAt、lastMessageAt、subscriptions、ACK/error、reconnects、gaps、lastError。

### 14.2 User Data 明确走 Private

- BinanceUserDataStream 使用独立 Private endpoint。
- 不再从 generic market socket base 拼接 listenKey。

### 14.3 修正 defaults + saved-resource 迁移

需要同时修改：

- config/settings.default.json；
- contracts 默认值；
- settingsStore compatibility migration；
- exchange resource normalization。

必须识别并迁移已有 legacy 值，而不是只改默认值，否则旧数据库保存的 URL 会继续覆盖新默认值。

### 14.4 降低 REST recovery 放大

当 source-level WebSocket lane 不健康时：

- 先修复/重连对应 lane；
- 不要每 10 秒反复 full hydrate 大量 stale symbols；
- quote/book/candle 分类型做最小恢复；
- 私有 truth 与 execution lane 保持更高优先级；
- bounded concurrency + exponential backoff。

单 Symbol candle hole 继续使用 targeted repair。

### 14.5 Rate-limit 真相独立展示

Dashboard/diagnostic 分开显示：

- exchange observed weight；
- discovered limit；
- local estimated weight；
- queue depth / queue timeout；
- HTTP 429 / 418；
- Binance throttle code。

普通 HTTPS timeout 不得显示成“请求太频繁”。

### 14.6 Operational Incident 去重与分类

用户层面区分：

- NETWORK / PROXY；
- RATE LIMIT；
- WS ROUTING / SUBSCRIPTION；
- REQUEST FORMAT；
- BINANCE TRANSIENT；
- PRIVATE DATA STALE。

同一路由/同根因重复错误聚合为一个 incident，详情保留 endpoint/requestId/raw evidence，避免告警刷屏。

### 14.7 修复 foreground UTF-8

在启动 Node 之前统一：

- Console InputEncoding = UTF-8；
- Console OutputEncoding = UTF-8；
- PowerShell OutputEncoding = UTF-8；
- foreground log 继续使用 UTF-8 no BOM。

增加包含中文 incident 文本的回归测试。

### 14.8 Market Intelligence 状态语义

保持现有安全隔离：

- 不让 online research worker 写 live DB；
- 不自动启动研究 worker。

但应：

- 未启用离线研究时立即稳定报告 OFFLINE_ONLY；
- 已知策略状态后不再反复显示 STARTING；
- Hot market structure 与 Temporal research 状态完全独立。

## 15. 必须增加的测试

1. Public / Market / Private URL routing。
2. stream-class ownership。
3. SUBSCRIBE ACK/error + LIST_SUBSCRIPTIONS。
4. 单 lane failure/reconnect 不拖死健康 lane。
5. legacy settings migration。
6. TESTNET / PRODUCTION origin isolation。
7. Production writes 保持 0。
8. WS lane down 时 REST recovery 不形成 storm。
9. private sync 不被 public-market recovery 饥饿。
10. incident classification + dedupe。
11. foreground 中文 UTF-8。
12. Temporal OFFLINE_ONLY / STARTING 语义。

随后跑完整：typecheck、build、engine tests、dashboard tests、V3.9.x Verify。

## 16. 验收标准

### Market Data
- 官方 split WebSocket 路由被实测证明。
- 健康链路下 retained symbols 的 quote/book age 稳定小于阈值。
- 1m/5m/15m closed-candle continuity 稳定。
- 不再因为缺失 stream class 频繁触发 MARKET_QUOTES_STALE。

### REST / Private
- 诊断报告可以区分 proxy/network、Binance Testnet、request format、rate-limit。
- 正常验收窗口无 429/418。
- private sync 有持续的新鲜成功快照，不长期依赖 last-known positions。

### Execution
- /fapi/v1/leverage 的 -1000 行为被独立测试解释。
- test-order 格式验证通过。
- 任何真实 TESTNET write probe 都必须显式开启且有完整 cleanup。
- Production writes = 0。

### UX
- foreground 无中文乱码。
- Market Intelligence 稳定表达 OFFLINE_ONLY。
- 行情数据链路错误不再与“市场趋势不好”混淆。

### Safety
- 8083 / 8084 untouched。
- no auto-restart。
- no history/database reset。
- no static-egress-IP gate。

## 17. 批准闸门

用户已明确批准本计划。当前只进入 Phase A 诊断采集；Engine 运行时代码修复仍以诊断证据为输入。\n\n已加入：`scripts/windows/test-binance-link.ps1`，负责采集当前 8080 runtime / Binance governance / incidents / universe / EIP / signed account readback / 最新 foreground log，并自动打包 ZIP。

用户批准后的推荐顺序：

1. 先实现 READ_ONLY audit harness。
2. 在当前代理/TESTNET 下运行并保存证据。
3. 根据证据确定 root-cause labels。
4. 再实施 WebSocket / transport / recovery 修复。
5. 跑 focused + full CI。
6. 仅在明确告知用户后重启 Engine 8080。
7. 继续 foreground 观察，对比修复前后 incident 频率。

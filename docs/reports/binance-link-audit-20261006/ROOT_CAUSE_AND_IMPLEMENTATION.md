# Binance 链路诊断：根因与第一阶段修复

Date: 2026-10-06

## 结论

本次现场证据不支持“当前请求权重超限”作为主要原因。

采集时：
- REQUEST_WEIGHT: 136 / 6000 (2.27%)
- local sliding estimate: 241 / min
- current status: AVAILABLE
- ORDERS: 1 / 300 (10s), 1 / 1200 (1m)
- 当前没有 418/429；历史计数为 3 / 17，lastLimitedAt 早于本次窗口
- 但 request budget 累计 queueTimeout = 421
- MARKET_PUBLIC timeout = 12
- PRIVATE_TRUTH timeout = 1
- BACKGROUND timeout = 8

最近 53 个已完成请求的网络执行时间：
- median ≈ 4043 ms
- p95 ≈ 11663 ms
- max ≈ 15553 ms

说明当前瓶颈是网络/代理/Testnet 链路高延迟 + REST fallback 放大，而不是当下 Binance weight ceiling。

## WebSocket 根因

运行时仍配置：
- wss://stream.binancefuture.com/ws

Binance 2026 USDⓈ-M WebSocket 已拆分：
- Public: /public
- Market: /market
- Private: /private

旧 URL 于 2026-04-23 进入退役边界。

当前 Engine 在一个旧 socket 混合：
- Public: bookTicker, depth
- Market: ticker, markPrice, kline, aggTrade

现场表现与“Market/Public 分类缺流 → quote/book/kline 老化 → REST recovery”一致：
- MARKET_QUOTES_STALE 日志命中 558 次
- MARKET_TECHNICAL_STALE 71 次
- MARKET_FRESHNESS_RECOVERY 82 次
- BINANCE_REQUEST_QUEUE_TIMEOUT 391 次
- Binance request timed out 990 次
- operational incident history:
  - MARKET-DATA-001: 34
  - NET-002: 126
  - EX-BINANCE-1000: 3 incident windows / 154 aggregated occurrences

## 私有链路

signed account readback 在 2026-10-06T03:56:41Z 成功：
- host = demo-fapi.binance.com
- exchangeWrites = 0
- positions = 13
- openOrders = 13

userDataWs:
- state = LIVE
- reconnects = 2
- lastError = null

因此 Private 并非永久不可用，但 REST private sync 受到相同高延迟链路影响。

## leverage -1000

/fapi/v1/leverage：
- 14 requests
- all admitted
- no local budget block
- recent failures are Binance HTTP 400 code -1000
- observed request weight around failure远低于 6000/min
- ordinary order endpoint meanwhile has successful 200 responses

因此 -1000 不能归因于 rate-limit。当前仍按 Binance Testnet transient / generic processing failure fail-closed 处理；保留一次同值 bounded retry，不增加重试风暴。

## Native crash

10:35:58 → 11:56:41 foreground capture:
- 无 FOREGROUND_EXIT
- 无 0xC0000409
- Engine 持续运行约 80 分钟

这次没有复现 native crash。

## 第一阶段已实施

1. BinanceTransport 派生 2026 split routes：
   - Testnet PUBLIC -> wss://fstream.binancefuture.com/public/stream
   - Testnet MARKET -> wss://fstream.binancefuture.com/market/stream
2. BinanceMarketStream 拆为两个独立共享 socket：
   - PUBLIC: !bookTicker + depth
   - MARKET: ticker + markPrice + 1m/5m/15m kline + aggTrade
3. 两 lane 独立：
   - subscription queue
   - reconnect/backoff
   - heartbeat
   - control error
   - metrics
4. 暂不改 UserData private socket：现场仍为 LIVE，避免在未做 Private A/B 之前同时扩大变更面。
5. foreground PowerShell 强制 UTF-8 console / output encoding。

## 下一验收

部署后观察：
- MARKET_QUOTES_STALE 是否显著下降/消失
- freshMarkets stale count
- requestBudget queueTimeout 增速
- REST median/p95
- NET-002 次数
- Market/Public lane state/reconnect/lastMessageAt
- -1000 leverage 是否仍出现

若 Market/Public 修复后 REST 仍持续 4–15 秒，则第二阶段重点是代理/VPN/Testnet 网络路径，而不是继续增加 Binance 请求预算。

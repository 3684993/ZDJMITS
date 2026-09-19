# ZDJ-MITS V3.9.5｜1m K线缺口自愈修复｜Codex 实施提示词

立即处理当前 1m closed candle gap 导致的市场数据全局降级。允许自主推理和反驳；以源码、live runtime、Binance Testnet 客观事实为准。

## 已知事实
- quotes 仍约 100–104/104 新鲜，但 1m closed candle gap 持续约 2.3 小时。
- MARKET_SYMBOL_ERROR 中该错误占约 99%，触发 TECHNICAL_1m_STALE → eligibility≈0 → PAUSED_MARKET_DATA_UNAVAILABLE。
- 429/418 未新增，egress VERIFIED，因此没有证据支持 Binance 整体行情不可用。
- 本轮禁止先重启 Engine/代理/模型服务，也禁止全量 104 symbols REST backfill。

## 优先验证的根因假设
当前 BinancePublicMarketDataProvider.getCandles() 对 1m/5m/15m live cache 主要检查“数量够 + 最新 closed candle 已到当前边界”，但没有先验证中间 closed candle 连续性。
WS 短暂断线漏一根后，后续 K 线恢复会让 latest 再次变新鲜；hydrateLiveTechnical/buildTechnicalCard 正确发现中间 gap，但 recoverStale→getSnapshot→getCandles 可能再次返回同一段有洞的 live cache，从而绕开 REST，形成永久自保持。
同时 BinanceMarketStream 对 depth 有 sequence gap recover，但 kline 分支没有 closed-kline continuity 检测和 targeted backfill。

## Stage 1｜只读取证
选择至少 3 个当前报 gap 的标的 + 1 个健康对照，逐个比较：
- stream candle cache 最近至少 120 根 1m：openTime/closeTime/isClosed/source/receivedAt；
- current technical card：asOf/barCloseTime/sampleSize；
- Binance REST 同窗口 /fapi/v1/klines?interval=1m；
- WS metrics：connectedAt/reconnects/gaps/gapsByType/subscriptions/lastMessageAt；
- quote freshness。
明确列出 cache 缺哪一分钟、REST 是否有该分钟、cache latest 是否已经追到当前、gap 后 candles 是否继续增长。
若 REST 也缺同一 candle，停止代码修改并报告外部供给问题。
若 REST 有、cache 中间缺、latest 已新鲜且 quote/WS 正常，则确认 LOCAL_KLINE_SEQUENCE_RECOVERY_BUG。

## Stage 2｜先写失败测试
在改实现前，用 deterministic test 构造 t0,t1,t2,t4,t5...latest，且 rows>=limit、last closed=current expected close。
必须证明当前路径错误信任该 live cache。
覆盖：1m middle gap；连续 1m 不走 REST；REST 完整后 seed 修复；request budget defer 时保持 fail-closed；5m/15m 同语义。

## Stage 3｜最小核心修复
实现单一可复用 closed-candle continuity validator：
- openTime 按 timeframe period 严格递增；
- closeTime/boundary 合法；
- 无重复 openTime；
- requested closed window 无缺口；
- latest closed 满足 expected boundary/freshness。
修改 BinancePublicMarketDataProvider.getCandles()：live cache 只有在“数量足够 + latest 正确 + closed window 连续”时才可直接返回；任何 gap 必须 fall through 到 REST loadCandles()。
REST 成功后用现有 seedCandles 合并，并再次验证 continuity；不能未经验证就标恢复。

## Stage 4｜targeted repair，禁止全量 snapshot 风暴
审计 MarketDataHub.recoverStale()：若单纯 1m sequence gap 会触发完整 getSnapshot()（quote/book/1m/5m/15m/高周期/derivatives），改为最小 targeted technical repair。
复用 BinanceTransport、request governor、candle flight/single-flight、seedCandles。不要新建第二套 HTTP client。
只修坏掉的 symbol + timeframe；per symbol/timeframe single-flight + cooldown + bounded concurrency；budget deferred 时延后。
优先级：position > active entry > pool/candidate > BTC/ETH > 其他 retained。

## Stage 5｜主动 kline gap 检测
审计 BinanceMarketStream.onEvent(kline)。当新 closed candle 与上一 closed candle 边界不连续时：
- gaps++；gapsByType.kline++；
- 记录 symbol/timeframe/expected/actual；
- 标记 targeted repair。
不要每个 gap 无节制发 REST；必须由 single-flight/cooldown/request budget 控制。
如果现有 technicalBlocked 足以驱动修复，复用它，不新增复杂状态机。

## Stage 6｜blocked 清理语义
只有 continuity validator PASS + buildTechnicalCard PASS + 新 technical card 已写入 state 后，才能清除 TECHNICAL_<tf>_SEQUENCE_INVALID。
quote 新鲜、收到一根新 kline、latest 变新均不能单独清 blocked。

## Stage 7｜修正诊断但不降低门禁
当前 kline freshness 不足可能被 pipeline 统称 MARKET_QUOTES_STALE。若源码确认，最小区分 MARKET_QUOTES_STALE / MARKET_TECHNICAL_STALE / MARKET_KLINE_SEQUENCE_INVALID。
只修诊断真实性；技术序列不可信时仍必须 PAUSED_MARKET_DATA_UNAVAILABLE。

## Stage 8｜测试与请求治理
至少覆盖：1m/5m/15m gap；WS reconnect 漏 closed candle；repair 成功清 blocked；repair 失败保留 blocked；budget defer 无请求风暴；多 symbol concurrency 有界；quote fresh+kline gap 的诊断正确；429/418/request-governance 不回归。
执行 git diff --check、typecheck、full test、build、npm run verify；GitHub Actions 必须全绿。

## Stage 9｜部署前模拟
用 deterministic harness/副本模拟“大量 symbol 中间 1m gap + latest 已当前 + quote fresh”。
要求 targeted REST 数量有界、逐步恢复 technical READY/eligibility，不需要用重启清缓存。
如无法证明无 REST storm，不部署。

## Stage 10｜受控部署与 live 验收
只有 CI 全绿才部署。允许因部署新代码做一次受控 Engine restart，但 restart 不能被当作修复手段。
部署前保存 gap/error rate、freshMarkets、klineFreshRatio、eligibility、positions/TP、429/418、egress、request governor、buildId。
部署后不人工全量 backfill，观察 targeted repair 自愈。
必须看到：1m closed candle gap 新增速率显著下降并接近 0；targeted repair success；stale/blocked symbols 下降；klineFreshRatio 恢复；freshMarkets DEGRADED→RECOVERING/FRESH；eligibility>=1；pipelineState=RUNNING。
同时保持：WS LIVE、positions/TP 无损、historical UNKNOWN 不删、durable claims 正常、429/418 不持续新增、egress VERIFIED、productionWrites=0。
若 repair 导致 429/418 或 request queue 激增，立即停止扩散并保持 fail-closed。

## Stage 11｜本轮不要重跑 ENFORCE Canary
行情恢复后保持 SHADOW、HUMAN cap=true、原 Settings。先汇报给 ChatGPT，再决定是否重跑正向 Canary。

## 最终报告
只输出：
A. 根因最终判定（外部供给/本地恢复闭环）；
B. 3+1 标的 cache vs REST 证据；
C. getCandles 为什么会/不会绕过 REST；
D. continuity validator 规则；
E. targeted repair 实现；
F. kline gap 主动检测；
G. REST 请求上界/concurrency/cooldown；
H. tests/CI/exact HEAD；
I. 是否部署 live、新 buildId/PID/instanceId；
J. 1m gap rate 前后；
K. klineFreshRatio/freshMarkets 前后；
L. eligibility/pipelineState 前后；
M. 429/418 前后；
N. positions/TP 是否无损；
O. 是否无需人工 restart/backfill 即可持续自愈；
P. 是否恢复到可重新进行 ENFORCE Canary 的数据条件；
Q. 对本提示词根因假设的反驳/补充。

报告保存：docs/reports/v395-1m-kline-gap-recovery-20260919.md
提交 GitHub。完成后停止，并执行 D:\MITS\scripts\notify.ps1。
# 智多金 V3 — Codex 5.6 Terra 继续完善实施计划

## 0. 使用方式

把 V3 基础包解压成唯一开发主线。Codex 每次只执行一个阶段；阶段未通过退出条件，不进入下一阶段。

每个阶段必须遵循：

```text
调查当前真实代码/配置/运行事实
-> 对照 V3 hard principles
-> 找出缺口/风险
-> 实施
-> 定向测试
-> typecheck/test/build
-> 真实运行 trace
-> 更新 implementation-progress.md
```

禁止只写计划不实施；禁止为了赶进度伪造“已完成”；外部依赖无法验证时必须保留 fail-closed，并明确证据。

## V3 Hard Principles

1. 综合选币偏主流流动性；
2. position / active entry / pool symbol 互斥；
3. 15m 默认主方向，4h/1d/1w只加权；
4. AI 只有 PLACE_LONG / PLACE_SHORT / REJECT_CANDIDATE；
5. AI给价格区间，Entry Manager给最终Maker价；
6. B580/9B无建仓权限；双7900/27B对称 PRIMARY_BRAIN；
7. 交易写权限只在确定性 server-side adapter；
8. Entry绝对TTL默认60分钟；
9. 自动TP；自动止损执行链不存在；
10. Dashboard不推断交易事实。

## Stage 0 — 基线完整性与可运行性

目标：确认 V3 解压后的 workspace 可安装、typecheck、test、build、Mock 全链路可启动。

工作：
- 核验 Node/npm 与 workspace；
- `npm install`；
- 修复所有 TypeScript/Vue/build/test 错误；
- 启动 mock Engine + Dashboard；
- 调用 smoke endpoints；
- 运行至少 10 分钟模拟，证明 Universe/Pool/EIP/AI/Entry/Position/TP/Experience 事件发生；
- 建立 `docs/implementation-progress.md`。

退出：所有脚本 PASS；无静默 exception；Dashboard 9页可打开。

## Stage 1 — 持久化、配置版本与审计

目标：运行重启后不丢失关键事实。

实现：
- SQLite（建议 node:sqlite 或经验证驱动）；
- settings version；
- AI runs / EIP metadata / intents / orders / positions / TP / trade outcomes / audit；
- WAL、transaction、checkpoint、启动完整性检查、备份/恢复；
- secret 字段绝不进入 DB/log；
- repository 层替代直接 Map 为唯一事实持久化边界。

退出：强制终止后重启，状态可恢复；数据库 integrity PASS；备份/恢复 PASS。

## Stage 2 — 生产 Market Data Hub

目标：把实时行情从 REST 拉取样例升级成集中式行情底座。

实现：
- Binance USDⓈ-M WS：ticker/book/mark/kline/agg trade 等实际需要流；
- REST bootstrap/backfill；
- BTC/ETH共享 Regime；
- OI/Funding/Taker/LongShort 缓存；
- freshness / source / data completeness；
- reconnect、sequence/时间校验、代理/DNS/TLS自检；
- 所有 symbol worker 禁止各自重复开 WS/REST 回补。

退出：100个候选数据持续新鲜；断网/代理恢复后自动收敛；rate-limit稳定。

## Stage 3 — 真实智能选币与动态交易池

目标：让五种模式使用真实市场数据并能解释排名。

实现：
- 真实 quoteVolume、spread、depth、trade activity、OI变化、taker ratio；
- percentile normalization；
- 综合模式35% liquidity权重；
- Top N 默认100；
- Pool Target/Max；
- 持仓/Entry硬排除；
- 事件驱动补池与池尾替换；
- selectionGeneration；
- 自定义白名单/排除名单。

退出：设置切换后排名变化符合模式；任何 position/active entry symbol 在 pool 中出现次数=0。

## Stage 4 — EIP 专业证据质量

目标：确保27B收到专业、可验证、不过度膨胀的证据。

实现/核验：
- EMA/MACD/BB/ATR/Swing/Volume 计算准确性；
- 1m/5m/15m/4h/1d/1w；
- current/mark/bid/ask/orderbook；
- derivatives；
- BTC/ETH Global Regime；
- portfolio exposure / same-direction profitable ratio；
- experience summary；
- evidenceRefs / contradictions / completeness；
- EIP token budget；
- 数据 stale 时 fail closed。

退出：随机抽20个 EIP 与独立计算对账；27B Final 默认约3K–7K输入而不是空洞标签。

## Stage 5 — 三 GPU 真实模型接入

目标：真实启用 B580 9B Scout + 双7900 27B Brain。

实现：
- 8081/8082/8083健康检查；
- 模型名称、context、temperature、JSON输出协议实测；
- 资源队列与 timeout；
- least-loaded dispatch；
- 两块7900并行不同 symbol；
- selective review；
- 9B 输出不能截断27B原始证据；
- malformed JSON / timeout / endpoint down fail closed；
- token/latency/queue/tok-s telemetry。

退出：真实 trace 证明9B没有建仓权限、27B是 Final Authority；双7900同时有业务吞吐。

## Stage 6 — Binance 私有交易 Adapter（先测试网）

目标：把 MockExchangeAdapter 替换成可审计的真实 USDⓈ-M 交易写适配器。

实现：
- SecretProvider；
- server time/recvWindow/signature；
- exchangeInfo rules cache；
- position mode；
- leverage；
- Maker LIMIT Post-Only/GTX；
- query/cancel/replace；
- TP；
- account/positions/openOrders/fills；
- error taxonomy、retry/idempotency；
- 所有请求审计，密钥不入日志。

退出：测试网完整 Entry->Fill->Position->TP->Close trace；重复命令不产生重复订单。

## Stage 7 — Entry Manager 生产一致性

目标：确保AI价格带与真实Maker订单之间的边界不可绕过。

核验/强化：
- LONG <= bestBid；SHORT >= bestAsk；
- final price 必须在 AI range；
- tick/step/minQty/minNotional；
- quantity = margin × leverage / price；
- reachability；
- reprice不扩大AI区间；
- range invalidation；
- 60m absolute TTL；
- partial fill；
- process restart恢复 pending order；
- 无任何 AI 直接 place/cancel path。

退出：属性测试 + 测试网边界样本全部PASS。

## Stage 8 — Position / TP / Reconciliation

目标：真实持仓只有一个事实源，TP始终可验证。

实现：
- positions/orders/fills reconciliation；
- TP exists/qty/side/price一致性；
- TP missing repair；
- 重启后恢复；
- position opened立即从候选池剔除；
- position closed重新获得资格；
- 自动止损路径扫描结果=0。

退出：故意删除TP能自动恢复；重启/断网后状态收敛；没有重复TP。

## Stage 9 — Dashboard 生产读模型与设置

目标：9页UI完全由真实API/WS驱动。

实现：
- 统一 read projection；
- settings optimistic UI 禁止，保存后以server事实回读；
- EIP详情；
- AI Run raw input/output可审计但敏感字段脱敏；
- GPU telemetry；
- Entry TTL/reachability；
- Position/TP；
- Experience；
- WS断开显式 degraded；
- REST定期 reconciliation；
- 金融SaaS视觉一致性与响应式。

退出：浏览器刷新/断WS后状态恢复；所有核心数字与server一致。

## Stage 10 — 安全、故障与可观测性

目标：系统面对网络、GPU、数据和进程故障不会错误交易。

实现：
- fail-closed matrix；
- structured logs；
- metrics；
- health/readiness；
- DNS/TLS/proxy诊断；
- model outage；
- exchange rate limit；
- data stale；
- disk/database；
- process supervisor；
- log rotation；
- backup jobs；
- security audit。

退出：注入故障测试通过；不存在“数据不确定但继续开仓”。

## Stage 11 — 24h/72h 运行验收

目标：证明 V3 作为系统而非单次 demo 可以稳定工作。

24h Shadow：真实行情 + 真实AI + 禁止交易写，观察选币/EIP/决策。  
72h Testnet：真实行情 + 真实AI + 测试网 Entry/TP。

收集：
- candidate turnover；
- pool utilization；
- decision frequency；
- REJECT ratio；
- 9B/27B latency/tokens；
- dual-brain utilization；
- Maker reachability/fill latency/reprice/TTL；
- TP repair；
- reconciliation drift；
- memory/db/log增长；
- crash/restart。

最终 Go 条件：全部硬原则有自动化证据；所有 P0/P1 缺陷清零；build/test/typecheck PASS；生成完整 provenance。

## 当前交付环境验证说明

本交付环境中 `npm install --ignore-scripts` 因外部依赖下载超时，没有获得完整 node_modules，因此这里不能声称 workspace 已完成真实 `vue-tsc/vitest/vite build`。已执行 TypeScript 语法级解析检查并通过。Stage 0 的第一职责就是在目标 Windows 开发环境完成真实依赖安装、typecheck、test、build 和 Mock 运行闭环；任何错误必须在该阶段修复，不允许跳过。

# 智多金多币种智能交易系统 V3
## Codex 5.6 Terra 逐步实施计划与提示词

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


---
# 可直接逐阶段复制给 Codex 5.6 Terra 的提示词


---

# Codex 5.6 Terra — V3 主执行提示词

你正在继续实现“智多金多币种智能交易系统 V3”。当前仓库就是唯一主线和架构基线。

先读取：
- `docs/00-project-architecture.md`
- `docs/01-implementation-status.md`
- `docs/03-production-implementation-plan.md`
- 当前阶段对应的 `docs/codex-terra/*.md`

必须先调查当前真实代码、配置、依赖、运行日志和测试，再实施。不要根据文件名或计划假设功能已经完成。架构硬原则不可改；具体实现可以基于证据优化。

不可改原则：综合选币偏主流流动性；15m默认主方向而4h/1d/1w仅加权；AI只有PLACE_LONG/PLACE_SHORT/REJECT_CANDIDATE；AI给价格区间而Entry Manager给最终Maker价；B580 9B无建仓权限；双7900 27B对称主脑；position/active-entry/pool互斥；60m绝对TTL；自动TP；自动止损执行链不存在；浏览器无交易权限。

执行方式：调查 -> 找出阶段缺口 -> 实施 -> 定向测试 -> 全量typecheck/test/build -> 真实运行trace -> 更新`docs/implementation-progress.md`。不要只写计划。不要大范围重写已经满足V3 contract的模块。失败时给出证据并fail closed。

最终报告只包含：本阶段发现的真实缺口、实际修改、关键trace、tests/typecheck/build、运行状态、未完成项和进入下一阶段的Go/No-Go。


---

# Stage 0：V3基线完整性

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

完成依赖安装、workspace修复、typecheck/test/build、Mock Engine+Dashboard启动和10分钟全链路运行。必须证明Universe->Pool->EIP->Scout->Brain->Entry->Fill->Position->TP->Experience至少各出现一次。建立implementation-progress.md。不要连接真实交易写。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 1：持久化与审计

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

在不改变领域状态机的前提下引入生产级持久化。先调查Node版本和现有依赖，选择可靠SQLite实现。orders/positions/TP/AI runs/EIP metadata/intents/outcomes/settings/audit必须事务化；WAL/完整性检查/备份恢复必须有测试。运行Map只能做缓存，不能成为重启后的唯一事实。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 2：生产行情底座

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

把MarketDataProvider生产实现升级成集中Market Data Hub。先核验Binance USDⓈ-M最新官方接口、目标代理和DNS/TLS。实现WS主流+REST bootstrap/backfill、100个候选共享连接、K线/盘口/mark/ticker/derivatives缓存、freshness/completeness、断线恢复和限频。禁止每symbol各自建立重复WS或回补。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 3：真实智能选币与交易池

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

用真实行情验证五种Selection Mode、Top100、Eligibility、六维percentile评分、综合模式Liquidity=35%偏置、Pool Target/Max、selectionGeneration、事件补池和池尾替换。任何持仓或活动Entry交易对不得出现在Pool。设置切换要有可解释排名变化和自动化测试。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 4：EIP证据质量

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

逐项独立校验EMA/MACD12-26-9/BB20-2/ATR/Swing/Volume、六周期、盘口、OI/Funding/Taker、BTC/ETH、Portfolio、Experience。EIP不得用看似专业但实际替代计算的字段。随机20个symbol与独立计算对账。测token预算、freshness和missing evidence，stale时fail closed。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 5：三GPU真实AI

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

连接8081 B580 9B、8082/8083两块7900 27B。先实测OpenAI-compatible协议、模型名、JSON、context和超时。实现健康、队列、least-loaded dispatch、并行不同symbol、selective review、malformed output fail closed、tokens/latency/tok-s。真实trace必须证明9B无建仓授权且27B是Final Authority。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 6：Binance测试网交易写Adapter

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

查最新Binance USDⓈ-M私有API后实现ExternalTradeAdapter。包括SecretProvider、签名/time sync、exchangeInfo规则、position mode、leverage、LIMIT Post-Only/GTX、query/cancel/replace、TP、positions/orders/fills/account、error taxonomy、retry/idempotency/audit。只在测试网验证，未通过不得启用生产。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 7：Entry Manager生产一致性

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

围绕AI price band建立属性测试和测试网验证：LONG Maker<=bid、SHORT Maker>=ask、final price永远在AI区间、tick/step/minQty/minNotional正确、quantity sizing、reachability、reprice不扩大区间、range invalidation、partial fill、60m absolute TTL、重启恢复。搜索并消除任何AI直接下单/撤单路径。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 8：持仓、TP与对账

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

把真实exchange positions/orders/fills变成可恢复事实。TP必须server-verified exists/qty/side/price；缺失自动repair且不重复。position opened立即排除候选，closed重新获得资格。模拟删除TP、断网、重启、外部人工操作并验证reconciliation收敛。扫描自动止损执行路径必须为0。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 9：Dashboard生产化

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

让Vue 9页全部由真实/api/v3和WS驱动。补projection与脱敏的AI Run输入输出；EIP、GPU、TTL/reachability、TP、Experience一致。设置保存必须server round-trip。WS断线显式degraded且REST恢复。保持金融SaaS视觉，不把业务规则复制到前端。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 10：故障、安全与可观测性

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

建立fail-closed矩阵，覆盖GPU offline/timeout、JSON错误、行情stale、Binance限频、代理DNS/TLS、DB/disk、WS断线、进程重启。完成structured logs、metrics、health/readiness、密钥脱敏、日志轮转、备份、进程守护。故障注入必须证明不会在事实不确定时新建Entry。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。


---

# Stage 11：24h/72h验收

先执行 `docs/codex-terra/00-master.md` 的总规则。

## 本阶段任务

执行24h真实行情+真实AI Shadow和72h测试网。收集候选周转、Pool利用率、决策频率、REJECT、tokens/latency、双7900利用、Maker可达率/成交时间/Reprice/TTL、TP repair、reconciliation drift、DB/log增长、crash/restart。只有硬原则自动化证据全部通过、P0/P1清零才Go。

## 执行要求

- 先读取并运行当前阶段相关代码，不凭计划猜测。
- 保留V3 contracts与状态机语义；若实现细节需要调整，必须用测试/真实trace证明更好。
- 只修改本阶段必要范围；不要顺手大改无关模块。
- 阶段结束执行定向测试 + 全量 `npm run typecheck`、`npm run test`、`npm run build`。
- 更新 `docs/implementation-progress.md`：日期、commit、改动、证据、未完成、Go/No-Go。
- 不要只输出建议，直接实施。

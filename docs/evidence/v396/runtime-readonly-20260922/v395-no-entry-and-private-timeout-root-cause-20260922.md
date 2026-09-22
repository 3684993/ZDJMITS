# 9 月 22 日连续无新建仓与私有账户超时：只读取证报告

取证时间：2026-09-22 09:30–09:36，北京时间。对象：现网 V3.9.5；未启停 Engine、修改交易设置或发单。

## 结论

**四小时停止分析的主因是合格、未占用且可执行的候选耗尽；不是 V3.9.6 代码上线，也没有本次遭遇交易所限频/封禁的证据。**

“私有账户事实待刷新”则来自另外发生的 **15 秒 REST 请求超时**，会短暂关闭新增建仓门，但不能解释整个四小时。两种原因被页面同时展示，容易误认为持续网络故障。

取证期间无需任何干预，**09:34:15 Primary 已自动恢复分析 NEARUSDT，09:35:11 完成，决策 PLACE_LONG**。这是模型分析恢复的证明，不代表订单已提交或成交。

## 关键时间线

| 时间 | 已证明的事实 |
|---|---|
| 09-20 11:48:10 | 当前 Engine PID 10540 启动；一直运行同一实例 |
| 09-22 05:23:39 | XRPUSDT 一次决策被 `REJECT_GROSS_EXPOSURE` 拒绝 |
| 05:25:42 | XRPUSDT 最后一次 Primary 分析完成，PLACE_LONG |
| 05:26:15 / 05:26:19 | 提交 XRPUSDT；20.6 XRP、1.5208、LONG 成交，exchangeOrderId `3506908056` |
| 05:27–09:30 | 389 条候选供给观测中，`capitalExecutableCount` 和 `executionReadyCount` 均无一次大于零 |
| 07:05:37 | 05:27 后首条超时相关事件，来自对账；比停止分析晚约 100 分钟 |
| 07:23:10、08:33:33、09:19:41、09:21:13、09:22:13 | 私有账户同步分别超时，均为单次失败计数 1，不是连续四小时断开 |
| 09:31 左右 | 账户 READY、行情 LIVE、模型 ONLINE、对账无错误；仍没有可执行候选 |
| 09:34:15–09:35:11 | NEAR 重新合格后，Primary 自动分析并完成 |

## 为什么没有合格机会

1. **持仓占用了此前能通过准入的标的。** 09:32 左右 Universe 有 87 个候选、`eligible=0`；32 个带 `ACTIVE_POSITION`。16 个 `residentEligible=true` 的候选均带持仓排除理由。池中能看见标的不等于允许再建仓，resident 本就允许保留已持仓标的。
2. **其余标的被资产治理或市场质量排除。** 37 个带 `ASSET_RESEARCH_ONLY`，26 个 `MARKET_QUALITY_D`，17 个 `MARKET_QUALITY_C`，另有价差/成交量/深度等理由。计数相互重叠，不能相加当总数。
3. **NEAR 是直接反例验证。** 第一份 Universe 中 NEAR 为 `SPREAD_TOO_WIDE`、rank 0、eligible false；随后价差约 2.27 bps，变为 eligible true、rank 1，执行候选数变为 1，模型自动启动。调度器没有卡死。
4. **保证金余额不等于可新增风险额度。** 09:31 快照为 32/50 仓位、无在途 Entry；权益约 10,498.84 USDT，总名义敞口约 10,425.84 USDT，总风险余量仅约 73 USDT，空头新增余量为 0。尚有 USDT/USDC 余额也不意味着允许继续增加同等规模仓位。此项是额外约束，不能替代“eligible=0”这一直接原因。

源码链：`packages/core/src/selection.ts:33` 产生资格/排除理由 → `services/universeCoordinator.ts:41` 保留可驻留标的 → `services/runtimeControlService.ts:76` 只把 eligible 且 rank>0 的标的交资本路由 → 无可执行标的时显示 `NO_EXECUTABLE_CONTRACT`。`pipeline` 中 Primary 为 `IDLE_NO_DISPATCHABLE_CANDIDATE / WAITING_EXECUTION_CAPACITY`，不是模型离线。

不同 API 在不同秒采样，池中 18 个与 Universe 中 16 个 resident 的数量不能作为同一事务快照比较。

## 超时是否因请求太多

**未发现本次 429/418 限频证据。** 运行计数 `http429=17/http418=3` 是历史累计，`lastLimitedAt` 是 **09-18 09:24:59**；当前 `blockedUntil=0`，预算 AVAILABLE、队列 0。取证时计量权重 257/6000（约 4.28%），本地一分钟估算 209，PRIVATE_TRUTH 通道未显示阻断或队列超时。权重观测有 INCONSISTENT 标记，因此不把单点比例当成全窗口峰值证明。

`BinanceTransport.ts:45` 在请求超时/Abort 时生成 `BINANCE_TRANSPORT_BLOCKED`，与 HTTP 429/418、预算队列拒绝是不同路径。私有同步失败约 15,015–15,044 ms，符合配置的 15 秒传输超时。`privateAccountSync.ts:30` 随即将账户标 UNAVAILABLE；成功同步后自动恢复 READY；`privateAccountReadiness.ts` 另有 60 秒事实新鲜度检查。

05:27–09:30 的日志心跳还记录了 **942 次 PRIVATE_SYNC_COMPLETED**，明确否证“私有同步连续四小时全部失败”。取证时最近失败后 `consecutiveFailures=0`、`lastError=null`、快照年龄约 8–11 秒。

REST 和 WS 均经配置的本地 SOCKS 代理；出口检查当时 VERIFIED。**现有日志只能定位到代理通道上的 REST 传输超时，不能判定是本机代理、上游链路还是 Binance 服务端哪一跳延迟。** 没有 TCP/TLS/代理分段耗时证据，不能把它进一步写成确定的“代理故障”或“服务器限流”。

## 与 V3.9.6 实施是否有关

**未部署的新代码不是直接原因，证据明确：**

- 现网仍为 V3.9.5，buildId `3.9.5-8b7cc98ccaaa6c06456c`，实例 `939b2020-73de-4a94-9f4d-2e927c72d3c9`；PID/启动时间与 09-20 一致。
- 运行入口为 `D:\MITS\apps\engine\dist\main.js`，入口产物时间 09-20 11:46:15；此次 V3.9.6 工作使用独立 worktree。
- SQLite 设置审计最后一笔为 09-20 11:48:12、版本 188；本故障窗口无新设置提交。
- 未重启/改设置，NEAR 条件恢复后自行恢复推理。

以上不等于证明所有宿主资源竞争都不可能发生；当前没有证据把间歇超时归因于离线实施负载。

## 需要改进的地方

1. **先改善解释，不为恢复交易放宽风控。** 页面分别显示“候选资格为零”“风险余量不足”“私有事实临时不可用”，带开始时间、最近恢复时间；不能只给“无机会”。
2. **持仓维护与新机会池分开计数。** 显示“已持仓维护 32 / 新仓合格 0 / 研究或质量排除”，避免池满却无分析的错觉。
3. **消除资格口径冲突。** 本次同时见到 `lifecycle=SHORTLIST/pipelineEligible=true` 与 `eligible=false/ACTIVE_POSITION`；`supplyHealth` 显示 GOVERNANCE，而 candidateSupply 显示 SUPPLY。现有执行门仍拒绝，但诊断应收敛到同一事实与原因优先级。
4. **补网络分段证据。** 记录不含密钥的 endpoint、SOCKS 建连、TCP/TLS、首字节、总耗时与恢复时点；再依据连续证据决定是否维修代理或优化请求。不能据单次 timeout 扩大超时、关闭闸门或自动重启。
5. **保留尾部风险限制。** 当前总名义敞口接近权益上限；扛单导致可选标的与风险预算逐步耗尽，是结构性现象。不能以提高建仓频率为由自动解除人工持仓占用或扩大权限。

## 证据与范围

原始读取材料保存在 `D:\MITS\data\reports\v396-no-entry-20260922\`：`snapshot.json`、`pipeline.json`、`universe.json`、`governance.json`、`private-sync.json`、`runtime.json`、`db-summary.json`、`events-window.json`、复查快照及 `summary.json`。`manifest.json` 保存 SHA-256。

日志来源为当前实例 09-21 压缩日志和 09-22 JSONL；原始日志按 UTC 文件日滚动，报告时间统一转换为北京时间。数据库以 `mode=ro` 和 `PRAGMA query_only=ON` 打开，只读现网 GET 接口；未调用交易所补查询。仅新增报告和证据文件，未更改应用代码、Settings、运行数据库、现有仓位或 TP。

09:31 的保护快照为 required=32、protected=32、missing=0，另有 orphanTp=1；这只是该时点的保护观测，不等于额外签发全窗口安全验收。

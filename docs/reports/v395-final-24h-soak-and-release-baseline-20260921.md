# ZDJ-MITS V3.9.5｜24 小时 Soak 最终全面复盘与后续优化评审（R17）

- 审计执行时间：2026-09-21 09:22（本地时区 UTC+8）
- 审计性质：**只读审计 + 裁决建议**。本轮未修改任何 application code、未修改 Settings、未重启 Engine、未切换 ENFORCE、未人为开平仓。
- 审计方法：durable 文件（`soak-baseline.json` / `soak-samples.jsonl` / `soak-hourly.jsonl` / `soak-alerts.md`）+ 原始运行日志（`.jsonl` 与轮转 `.jsonl.gz`）+ `mode=ro` SQLite + 只读 HTTP GET + 冻结候选 worktree（`HEAD e70e33e`）源码逐行核对。
- 原则：证据优先。不为 PASS 找证据，也不为发现问题制造问题。凡与既有报告（R13–R16）或本轮提示词前提冲突之处，一律以本次实测为准并在 §20 单列异议。
- **文件说明**：本路径在 R16 轮曾承载《R16 最终安全收尾 + 24 小时正式稳定运行验收》。R17 报告按提示词 Stage 17 要求写在本路径，故 R16 原文已完整迁至 `docs/reports/v395-r16-egress-fail-closed-and-soak-baseline-20260920.md`（内容逐字节未改，仅换名；亦保留于 git 历史 `HEAD:docs/reports/v395-final-24h-soak-and-release-baseline-20260921.md` @ `65e390e`）。本轮的 egress 裁决、冻结身份与 soak 偏差记录在该文与本文 §3/§7 中均可追溯。

---

## 1. Executive Summary

**先说结论，再说理由。**

1. **24h 窗口在落笔时尚未走完。** Soak 基线冻结于 2026-09-20 11:59:00，24h 应在 2026-09-21 11:59:00 结束。本次审计可用数据截至 09:20:42，即 **连续 21.36h / 129 个采样，覆盖率 88.9%，尚缺 2.64h**。因此提示词开头"24 小时 soak 已结束"这一前提**不成立**，本报告不出具 `V3.9.5_24H_SOAK_PASS`，出具的是 **`PENDING_WINDOW_INCOMPLETE`**（非缺陷导致的未完成，见 §19）。
2. **窗口内没有真实 P0。** 监控器在 17:49:11 与 20:39:22 两次打出 `P0 EGRESS FAIL-OPEN RISK`，**两次均已被证明是采集器自身的采样竞态假阳性**，不是引擎放行越权写。证据链闭合（§7）：引擎写计数器 `testnetWrites` 只在通过 `assertTestnetExchangeWrite()` 之后自增，而整个窗口 `blockedProductionWriteAttempts` 恒为 0、`productionWrites` 恒为 0；两次告警对应的最后一笔写分别发生在闸门关闭（`ENTRY_ADMISSION_BLOCKED`）前 **26 秒**和 **59 秒**。
3. **egress fail-closed 是真成立的，不是"没出事所以算对"。** 24h 内 4 次出口探测失败（全部为 `The operation was aborted`），每次都精确对应一次 `ENTRY_ADMISSION_BLOCKED{BINANCE_EGRESS_UNAVAILABLE}` 与一次 `RESUMED`，即 R16 新增的早期准入闸**在生产环境被真实触发了 4 次并全部正确闭合**。同时穷举了全部签名路径：只有 2 处 `createHmac`，其中一处是 GET-only 且路径白名单；所有下单/改单/撤单/杠杆方法均走 `signed()`。**无任何写路径绕过闸门。**
4. **发现 1 项真正的 P1（代码可证、且已在日历上倒计时）**：UNKNOWN 风险审计存在 **7 天回溯硬悬崖**（`reconciliationService.ts:16,40`）。行龄一旦超过 `UNKNOWN_RISK_MAX_LOOKBACK_MS`，`noActiveRiskEvidence()` 永久返回 `null`，该行被强制 `activeRiskExposure:true` 且审计 tier 重置为 0，**永久无法再次自证无风险**。最老的一行 `entry_intent_mu4op8x2_3pwywucr`（XRPUSDC，建于 09-17 06:40:33）将在 **2026-09-24 06:40 触发**，即 soak 结束后约 3 天。方向是"过度报告风险"而非"漏报"，不伤本金，但它会永久占用敞口额度、永久拉高私有 lane 请求量、并把 `liveValidationService` 的 `RECONCILIATION_HEALTHY` 永久钉成 FAIL —— 也就是**把 ENFORCE 的客观就绪度永久锁死**。
5. **发现 1 项采集器系统性错误（P2，但污染了本轮判据）**：`r16-soak.py:248-256` 用 `previous = samples[-2]`（10 分钟前的采样）做分子、用约 1 小时做分母，导致 `requestsPerHour` / `exactOrderPerHour` / `writesThisHour` / `peakUsedWeight1m` **全部系统性低估约 6.03 倍**。真实值不是"约 900 req/h"，而是 **5,573 req/h 与 1,258 次 `/fapi/v1/order` 精确查询/h**。此结论由两条独立路径分别复现（主审计与请求治理子审计分别得到 6.03 与 5.85 的比值）。**任何引用 soak 小时均值的既有结论都必须重算。**
6. **市场数据自愈是本轮最强的能力证据**：24h 内 4 次 gap 风暴、1,634 条 gap 事实、**381 次 `MARKET_KLINE_SEQUENCE_REPAIRED`、19 次 repair 失败、16 次 `MARKET_RECOVERY_FAILED`**，全部在 3–15s 内靶向自愈，**无人工介入、无重启**（`restartCount` 恒 165），修复有界（每 symbol 21h 内最多 5 次、60s cooldown 生效 3 次、每事件每 symbol 1 次 REST、全程无 snapshot 风暴）。唯一残留问题：`PAUSED_MARKET_DATA_UNAVAILABLE` 只发生 1 次（22:49:37），且根因是**报价**新鲜度崩塌（quoteFreshRatio 0.0115）而非 K 线。
7. **安全链硬门全部通过**：129/129 采样 `tp.status=READY` 且 `protected==required`，`missing/qtyMismatch/wrongSide/tpMissing/orphanTp/duplicateTp/repairFailed/manualReviewRequired/retryQueue` 全窗口恒 0；5 次 `POSITION_HUMAN_HANDOFF` 全部 `reason:LOSS_HANDOFF_BARS` 且 `tpRetained:true`；22 个浮亏仓位合计 **−998.65 USD 无一被引擎自动平仓**。**但提示词点名的 `ExitDispatcher` 在本构建中根本不存在**（§12）。
8. **ENFORCE 客观结论：`NOT_READY`**（§18）。窗口内 45 次 SHADOW 经济性评估 **0 次 passed**，其中 45/45 带 `HUMAN_MANAGED_EXPOSURE_LIMIT`，仅 **8/45（17.8%）** 是被该 cap 单独挡住；`reachProbability≥0.50` 为 14/45（31.1%）。历史上 3 轮 canary 从未观测到 `passed=true`。本轮**未切换、未提出立即切换建议**。现网 `/auto-readiness` 独立列出 **7 条 blockingReasons**，其中 `CAPITAL_EPOCH_VALID` 的原因是 `capital_epochs` 表 **0 行**（capital epoch 从未建立）。
9. **反事实检查抓到了一个"假警报与真故障同框"的实例（本轮最有价值的一条）**：09-20 20:39:22 这一个采样，既是 `P0 EGRESS FAIL-OPEN`（假）的触发时刻，也是全窗口**唯一一次真实 Primary 故障**（`primary.status=PAUSED`、`healthReason=RUNTIME_PAUSED`、`idleReason=AI_RESOURCE_BUSY`）的唯一时刻。监控器对前者报警、对后者**完全沉默** —— 因为 `r16-soak.py` 没有任何 `primary.status != READY` 规则，且非 RUNNING 需要连续 3 个采样才升级。**"24h 没事故"确实不等于"机制正确"，但方向与预期相反：被漏掉的是真故障，被报警的是假故障。**
10. **是否冻结 V3.9.5**：建议 **完成剩余 2.64h 时钟后判定"代码基线冻结、但权限不扩大"**。理由是 P1 属于"下一轮必须处理否则不建议扩大交易权限"，它不要求改动已冻结构建、也不要求重启，因此与代码冻结兼容；但按用户自设规则（无 P0/P1 才冻结为 STABLE_BASELINE），**`V3.9.5_STABLE_BASELINE` 不应在带着一个已知 P1 的情况下无条件宣告**。

---

## 2. 精确窗口与连续性

| 项 | 值 |
|---|---|
| 起点 | 2026-09-20 11:59:00（`soak-baseline.json` `startMs 1789876740904`） |
| 本次可用终点 | 2026-09-21 09:20:42 |
| 已观测连续时长 | **21.36 h**（129 个采样，采样间隔 600s，无 >11 分钟空洞） |
| 距 24h 还差 | 2.64 h（应于 2026-09-21 11:59:00 收口） |
| 进程启动 | 09-20 11:48（`uptimeMs` 与 `MANUAL_START` 一致），`restartCount` 全程 165 |
| 时钟是否被打断 | **未被真实事件打断**。两次 `P0` 与一次 `P1` 告警均为观测侧产物（§7、§9、§12）；Engine、8081、8084、proxy 全程未重启、未改 Settings（`settingsVersion` 恒 188） |

窗口完整性结论：**采样链完整、身份链完整、无窗口拼接**。唯一缺陷是"尚未满 24h"。

## 3. 代码 / 构建身份闭环（Stage 1）

**冻结候选（运行中）**
- `exactHEAD = e70e33e23c6c114853391e757eefdd0c3e9e17fb`，分支 `v395-economics-human-managed-20260919`，冻结时 `trackedFilesDirty=false`
- `buildId = 3.9.5-8b7cc98ccaaa6c06456c`
- `artifactHash = 8b7cc98ccaaa6c06456cb7d06e7ff3254ae9fabd99fdaaa43a537fc128e219c0`
- `sourceHash = 3ec075a1b5ab6a5de3c0e84c2218fe06dcc09b40b10058afd3d49f0aa884ad35`
- `pid 10540` / `instanceId 939b2020-73de-4a94-9f4d-2e927c72d3c9` / `restartCount 165` / `settingsVersion 188`

**运行策略（全程未变）**：`admissionMode=SHADOW`、`minHistoricalReachProbability=0.5`、`minNetProfitUsd=1`、`maxGrossExposurePct=1.0`、`maxDirectionExposurePct=0.5`、`executionMode=TESTNET_ENABLED`、`lockedToTestnet=true`、`expectedStaticEgressIp=172.104.186.174`、Binance Testnet（`restRoute().host` 为已配置 testnet host，`failClosed=true`）。

**当前仓库 HEAD 与运行代码的区分（硬要求）**

`e70e33e..HEAD(65e390e)` 共 5 个提交，其中 3 个纯 docs，**2 个非 docs**：

```
65e390e docs(v395): 记录 soak 期间仪表盘资产偏差…      (docs)
ba0b3ea feat(v395): 交易记录表增加平仓类型…            ← 非 docs：apps/dashboard/src/{styles.css,views/TradeRecordsView.vue}
cda475b docs(v395) / 9e4f2b6 docs(v395) / 19fe575 docs(v395)
```

`ba0b3ea` **不是 docs commit**，它是 dashboard 的 UI 变更（提交类型 `feat`）。因此"soak 期间只有 docs commit"的说法不成立，必须按产物树分开陈述。我用文件级内容哈希独立复核了"运行产物是否等于冻结候选"（对 `D:/MITS` 与冻结候选 worktree `v395-localci-r16b` 逐树比对）：

| 产物树 | 运行中 | 冻结候选 | 结论 |
|---|---|---|---|
| `apps/engine/dist`（708 文件） | `903e0bca3ccf2ec4` | `903e0bca3ccf2ec4` | **一致** |
| `packages/core/dist`（72） | `630daf718578b867` | `630daf718578b867` | **一致** |
| `packages/contracts/dist`（45） | `dbd019e4671a11f8` | `dbd019e4671a11f8` | **一致** |
| `apps/dashboard/dist`（22） | `a5a10ffa5cc1e96d` | `a7deecd78a9de2ff` | **不一致** |

**裁决：交易/风控相关的执行代码（engine + core + contracts）与冻结候选逐文件等价；仅展示层 dashboard 在 09-20 17:21 换成了 `ba0b3ea` 构建（用户事先批准）。Engine 从未因此重启。** 故 soak 的"代码不变"约束在**语义执行路径**上成立，在**展示层**上是一次已记录、已批准、不改变任何交易语义的偏差。回滚点：`D:/MITS-WORKTREES/backup-live-dist-ui1-20260920/20260920-172141/apps/dashboard/dist`。

## 4. Engine 与 Pipeline 稳定性（Stage 2）

- **uptime**：末次采样 `uptimeMs` = 21.54h；`crash = 0`、`restart = 0`、`ENGINE_INSTANCE_STARTED` 仅 1 次（11:48:13 `MANUAL_START`，在窗口之前）。启动恢复：`STARTUP_POSITION_REATTRIBUTED` 8 次，均为新成交的归因，非重启恢复（本窗口无重启）。
- **pipelineState**：`RUNNING` 128/129，仅 `2026-09-20 22:49:37` 一次 `PAUSED_MARKET_DATA_UNAVAILABLE`，下一个采样即自行恢复，未人工介入。
- **noEntryReason 分布**：`WAITING_EXECUTION_CAPACITY` 104、`null` 22、`PRIVATE_DATA_UNAVAILABLE` 1、`PAUSED_MARKET_DATA_UNAVAILABLE` 1。**每一次非 RUNNING 都有明确原因且都自动恢复。**
- **静默饥饿（silent starvation）检查 —— 发现一处标签错误**：104 次 `WAITING_EXECUTION_CAPACITY` 中，**104/104 的 `capacity.used` 都在 31–34 之间，而 `capacity.max=50`，全窗口 `used==max` 出现 0 次**。源码 `appRuntime.ts:1302` 表明该标签的实际判据是 `capital.executableCandidateCount===0`，`entryCoordinator.ts:128` 另一处则用 `routes.size===0`。也就是说**"执行容量"这个名字描述的是"没有可执行候选/没有敞口余量"，而不是仓位槽位耗尽**。这是一处会把运维引向错误结论的诊断标签失真（P2），不是安全缺陷。
- **内存/CPU：无可用的采样器。** 38,935 行日志中不存在任何 rss/heap/cpu 字段 —— 本报告按"该指标不可得"记录，**不伪造、不估算**。
- **数据库**：`persistence.integrity` 全程 `true`、`error=null`、无 lock/WAL/write 错误、无 `STORAGE_PRESSURE`；`integrity_check='ok'`、`journal_mode=wal`、DB 334.8 MB vs `warningBytes` 512 MiB ⇒ 容量 `AVAILABLE` 127/127，`/diagnostics/storage` pendingWrites 0 / failures 0 / overflow 0。
- **队列/背压**：窗口内 `blocked +157`、`queueTimeout +157`。二者**按构造恒等**（`requestBudget.ts:93` 在队列 TTL 到期时同时自增两个计数；lane TTL 5–15s），即**所有 blocked 都是排队超时而非闸门拒绝**，占比 0.134%。其中 80 次落在 08:00–08:10，与同期 kline gap 风暴（380 `MARKET_SYMBOL_ERROR`、254 `TRADE_RECORD_REPAIRED`）同窗 ⇒ **判定为良性的本地自限流**；但"后期升至 9.5/h"应作为 V3.9.6 观察项。子审计核对失败 lane 为 MARKET_PUBLIC / BACKGROUND 的 5s 刷新（klines 72、income 35、premiumIndex 16、openInterest 15、ticker/24hr 12），**未丢失 PRIVATE_TRUTH lane**。
- **两条"永远不会亮"的告警探针（新发现）**：`WATCH_TYPES` 包含 `ENGINE_ERROR` 与 `STORAGE_PRESSURE`，但**这两个事件类型在本构建中根本没有任何发布点（grep 0 命中）**。也就是说监控器对"引擎级错误"与"存储压力"的检测是**死信号**，看起来在跑、实际不可能触发（P2）。
- **注意一个"看似活着其实是启动值"的字段**：`persistence.runtimePersistedAt=1789876054184`（11:47:34）与 `checkedAt=1789876092445`（11:48:12）在**整个窗口的采样里字节级恒定，且在现网 `/auto-readiness` 里仍然是这两个值** ⇒ 已陈旧 21.5h 且**两者都早于窗口起点**。原因是 `settingsStore.ts:1418 seedOperationalMetrics()` 只把 `checkedAt` 写入 `operationalCache` 一次。因此 `integrity:true` 是**启动时刻**的缓存读数，不是持续监测的事实，存储完整性目前不具备窗口内可证性（P2 observability）。

## 5. AI 健康度（Stage 2 / Stage 10，并回答"idle 是否被误报成故障"）

- **窗口内 AI 运行统计（`ai_runs_archive`）**：`PRIMARY_BRAIN` 95 次 = 93 COMPLETED + **2 FAILED**；`SCOUT` 95 次 COMPLETED、0 失败。**latency（ms）**：primary p50 **59,244** / p95 63,045 / p99 85,152；scout p50 11,344 / p95 15,543 / p99 23,982。129 个采样中 **timeout = 0**。
- `aiHealth` 为**进程累计**计数，全程仅两组非零：09-20 12:09–12:29 与 17:19–17:39，均为 `failed=1, schemaInvalid=1, timeout=0`，其中 17:19:08 出现过 `quarantine=1`。**整个 24h 窗口：1 次失败、1 次 schema 失败、1 次隔离、0 次超时。** 无连续失败累积。
- **8081/8084 可用性抖动是本地传输造成的，不是模型故障**：`AI_RESOURCE_HEALTH_CHANGED` 共 38 次跃迁（18 offline / 20 online），且**两个资源同时抖动**，原因为 `This operation was aborted`（首次 16:34:18）与一次 `fetch failed`（09-21 08:32:45）。**这与 §7 的出口探测 abort、§8 的队列超时同源，都指向本机 proxy/VPN 传输，而不是 GPU/模型不可用。**
- **Primary 状态分类（用户点名要求区分）**：129 采样中 **127 次健康 idle + 1 次真实故障 + 1 次市场暂停**。
  - `healthReason` = `IDLE_NO_DISPATCHABLE_CANDIDATE` 90、`READY` 34、`IDLE_WAITING_CANDIDATE` 3、`RUNTIME_PAUSED` 1；`idleReason` = `WAITING_CANDIDATE` 71、`WAITING_EXECUTION_CAPACITY` 41、`AI_RESOURCE_BUSY` 2、`WAITING_NEW_FACTS` 6。
  - **唯一一次真实故障被监控器漏报**：`2026-09-20 20:39:22` `primary.status=PAUSED`、`idleReason=AI_RESOURCE_BUSY`、`healthReason=RUNTIME_PAUSED`。`r16-soak.py` **不存在任何 `primary.status != READY` 的告警规则**，因此它没有触发任何告警；同一样本恰恰是第二条**假** P0 的触发时刻（§7.2）。
  - "模型健康但没有可执行候选" 在引擎侧被正确归类为 `READY + IDLE_NO_DISPATCHABLE_CANDIDATE`（90 次），**未被误报成故障**；本窗口 `healthReason` 也从未出现 `DEGRADED`。
  - 但**监控器自身的 `pipeline not RUNNING` P1 规则不足以覆盖这类问题**：它只在 `pipelineState != RUNNING` 时累计 streak（且需连续 ≥3 次），所以 (a) 22:49:37 的 1 采样 `PAUSED_MARKET_DATA_UNAVAILABLE` 未告警，(b) 20:39 的 Primary `RUNTIME_PAUSED` 结构上不可能告警。真故障与假 idle 在本套告警里**不可区分** —— 本次侥幸没被误读，因为 idle 确实健康。真正的失真来自 §4 的 `WAITING_EXECUTION_CAPACITY` 标签与上一条漏报。
- 窗口内 `AI_RUN_TERMINAL` 93 次、`PRE_AI_EXECUTION_ENVELOPE_CREATED` 95 次，均正常收尾；`ENTRY_ANALYSIS_FAILED` 20 次。

## 6. 市场数据 / K 线自愈最终复盘（Stage 3，重点）

V3.9.5 真正 live 验证过的核心能力。本节把**"本窗口已验证"**与**"本窗口未触发、沿用 R13/R14 已获真实样本"**严格分开。

### 6.1 gap 与自愈总量

| 指标 | 本窗口实测 | 说明 |
|---|---|---|
| `MARKET_SYMBOL_ERROR` | 1,827 | 123 个不同 symbol；载荷 `scope=LIVE_HYDRATION`、`auditTruncated:true` |
| 其中 `1m closed candle gap` | 1,469 | **`__kline_closed_candle_gap__` = 1,634，占 `MARKET_SYMBOL_ERROR` 的 89.4%** |
| 其中 `5m closed candle gap` | 18 | 说明 gap 不只发生在 1m |
| 非 gap 项 | 150× `1w WARMING requires >=20 closed candles`（`TARGETED_REFRESH`，良性冷启动）+ ~48 超时 | **R13/R15 时代的"99.1% 都是 gap"这一比例已不再成立** —— gap 没有消失，是**混合构成变了**（被良性项稀释） |
| `MARKET_KLINE_SEQUENCE_REPAIRED` | **381** | 自愈成功的直接证据 |
| `MARKET_KLINE_SEQUENCE_REPAIR_FAILED` | **19** | 见 6.3 归因 |
| `MARKET_RECOVERY_FAILED` | 16 | 全部 `dataType=QUOTE_KLINE` |
| `MARKET_KLINE_SEQUENCE_INVALID` / `MARKET_KLINE_INVALID` | **0** | 未出现"修不好还留下非法序列"的情况 |
| gap 风暴 | **4 次**：17:19–17:29（564）、20:33–20:37（277）、21:18–21:24（320）、08:34–08:39（326） | 与出口探测 abort、队列超时同窗 |

### 6.2 自愈链条（用户要求证明的完整闭环）

**`WS/REST 断供 → gap 检测（1m closed candle gap）→ `recoverStale()` 靶向 `/fapi/v1/klines?interval=1m` → `MARKET_KLINE_SEQUENCE_REPAIRED{frames, repaired, outcome[].ok}` → 技术指标重建 → 新鲜度回升 → 全程无人工、无重启。**

- 逐 symbol 实测 detect→repair：**3–15 秒**（例：XRPUSDT gap@17:19:00 → repair@17:19:03 = 3s）；每次风暴在其 5–10 分钟带内自愈完毕，下一个 10 分钟采样即回到 `klineFreshRatio` 0.9→1.0。修复后载荷 `missing:0`。
- **`restartCount` 恒 165、pid 恒 10540、窗口内 `ENGINE_INSTANCE_STARTED` 0 次** ⇒ 自愈**没有任何一次依赖重启**。
- 事件载荷不含时延字段（`durationMs:null`），上述时延是**由相邻事件时间戳推得**，非仪器直读。

### 6.3 是否存在隐藏 repair storm —— 不存在，且有界性可证

- 381 次修复分布在 **122 个 symbol**，**单 symbol 21h 内最多 5 次** ≈ 每风暴一次。
- 同 symbol 相邻修复间隔：先 ~160–280 s，随后跳到 ~11,200 s / ~2,800 s / ~40,500 s —— **无紧重复、无循环**。
- `REPAIR_COOLDOWN` 原因出现 3 次 ⇒ 60s 冷却闸门**在真实拦截**。代码上界：`recoveryCooldown.set(symbol, now+60_000)` + `backfillInFlight` 去重 ⇒ **每 symbol 每 60 秒至多 1 次恢复**。
- 19 次 repair 失败全部归因于**外部传输或软失败**，无一为逻辑失败：9× `BINANCE_REQUEST_QUEUE_TIMEOUT`、6× `STILL_DISCONTINUOUS`、3× `REPAIR_COOLDOWN`、1× transport。
- **靶向 REST vs 全量 snapshot**：修复**全部为靶向**，每事件每 symbol **上界 1 次 `/fapi/v1/klines`**；`getSnapshot`（全量快照）在被测代码路径中**从不因修复而调用**（`klineTargetedRepair.test.ts` / `klineRecoverySimulation.test.ts` 断言：总 reload 次数 ≤ `SYMBOLS.length+1`、`max(perSymbol)==1`、`interval` 恒 `1m`、轮次 ≤ 24），现网心跳亦无 snapshot 风暴迹象。窗口内 `/fapi/v1/klines` 共 7,196 次、weight 8,514，量级与"靶向"一致。

### 6.4 新鲜度与 eligibility（129 采样）

| 指标 | p50 | p95 | min |
|---|---|---|---|
| `klineFreshRatio` | 1.0 | 1.0 | **0.2553**（09-20 21:19:24，即第 3 次风暴中） |
| `quoteFreshRatio` | 1.0 | 1.0 | **0.0115**（09-20 22:49:37） |
| `fresh` | 104 | 115 | 1（max 120） |
| `sequenceInvalid` | 0 | — | **max 79** |

- 仅 **4/129** 采样新鲜度下降；`sequenceInvalid` 峰值 79 但**从未产生 `MARKET_KLINE_INVALID` 事件**（该计数器与事件不是同一判据，需下一轮澄清）。
- `eligibility`：READY 104 / BLOCKED 24。**其中 23 次 BLOCKED 的原因是 `WAITING_EXECUTION_CAPACITY`（敞口/经济，非市场数据），只有 1 次由市场数据造成。**
- 唯一一次 `PAUSED_MARKET_DATA_UNAVAILABLE`（22:49:37）的根因是**报价**新鲜度崩塌（0.0115）且与同刻出口 `UNAVAILABLE` 共窗 ⇒ **不是 K 线自愈失效**，而是本机 proxy/VPN 传输抖动；下一采样自行恢复。
- **对比 R13/R15 的旧失效模式**：当时 `TECHNICAL_1m_STALE` 使 104 个 symbol 中仅 4–9 个通过严格新鲜度、`eligibility.count=0`、`PAUSED_MARKET_DATA_UNAVAILABLE` 长期驻留、完全无法取得 ENFORCE 评估样本。**本窗口该模式未再出现**（`freshMarkets.status=FRESH`、`klineFreshRatio` p50=1.0）。

### 6.5 无法作答的一项（诚实记录）

**提示词 Stage 3 的第一项"WS reconnects 次数"在本窗口客观不可测。** `BinanceMarketStream.ts` 的 `StreamMetrics` 含 `reconnects`、`gapsByType.websocketConnection/quote/bookTicker/depthSequence/kline/eventTimestamp/subscription`、`backfills`、`recoverySuccess/Failure`、`state`（`CONNECTING/LIVE/BACKOFF`），**但全部只是进程内存 gauge：既无事件发布，也无 API 暴露**（`metrics()` 仅被 `appRuntime.ts:1250` 内部消费，`/api/v3/pipeline` 响应中不存在 `stream` 键 —— 我已实测确认）。重连逻辑确实存在且完备（`socket.on('close') → schedule()`，指数退避 `min(30_000, 500·2^min(attempt,6))`），但**24h 内发生了多少次重连，没有任何 durable 证据可回答**。仅有下游指纹可间接推断：`BINANCE_TRANSPORT_BLOCKED: Socket closed` 1 次、route `proxy-a087cc91667b` 上 ~48 次 `BINANCE_REQUEST_QUEUE_TIMEOUT`。**⇒ 这是 V3.9.5 发布前客观存在的能力缺口，不能因"自愈表现好"而豁免（P2-6）。**

## 7. egress fail-closed 最终安全审计（Stage 4，最高优先级）

### 7.1 时间线（24h 全量）

`egress.status` 只有 `VERIFIED ↔ UNAVAILABLE` 两种转换，**全窗口 0 次 `MISMATCH`、0 次 `UNVERIFIED`**：

| # | 转 UNAVAILABLE | 转 VERIFIED | 时长 | 引擎错误 | 闸门事件 |
|---|---|---|---|---|---|
| 1 | 09-20 15:03:23 | 09-20 15:18:18 | 14.9 min | The operation was aborted | `BLOCKED` 15:03:23.742 → `RESUMED` 15:18:18.488 |
| 2 | 09-20 17:48:41 | 09-20 18:03:39 | 15.0 min | The operation was aborted | `BLOCKED` 17:48:41.039 → `RESUMED` 18:03:39.052 |
| 3 | 09-20 20:33:49 | 09-20 20:48:42 | 14.9 min | The operation was aborted | `BLOCKED` 20:33:49.801 → `RESUMED` 20:48:42.355 |
| 4 | 09-20 22:48:50 | 09-20 23:03:46 | 14.9 min | The operation was aborted | `BLOCKED` 22:48:50.709 → `RESUMED` 23:03:46.565 |

4 次出口失效 ↔ 4 对 `ENTRY_ADMISSION_BLOCKED{reason:BINANCE_EGRESS_UNAVAILABLE}` / `RESUMED`，**一一对应、无一遗漏、无一误放行**。这就是 R16 补上的早期准入闸在真实生产环境的第一次可证触发。每次持续时长恰为一个 15 分钟探测周期（`appRuntime.ts:501` `this.every(15*60_000, verifyBinanceTransportEgress)`），说明网络抖动本身可能远短于 15 分钟，只是状态刷新是离散的。

### 7.2 两次 P0 告警的裁决：采集器竞态假阳性（证明闭合）

告警判据（`r16-soak.py:151`）：

```python
if sample['egress']['status'] != 'VERIFIED' and sample['writes']['testnetWrites'] > streaks['lastWrites']:
    → 'EGRESS FAIL-OPEN RISK: testnetWrites advanced while egress=UNAVAILABLE'
```

它把**跨越 10 分钟采样间隔的计数器增量**与**采样瞬间的一次性状态读数**直接相与。二者时间尺度不同，因此只要"写发生在 VERIFIED 期间、探活在写之后失败"，就必然误报。

引擎侧事实（`ExternalTradeAdapter.signed()`）：

```ts
if(write){ try{ this.transport.assertTestnetExchangeWrite();
  this.writeStats.testnetWrites++; … }          // ← 只有闸门放行后才自增
  catch(error){ this.writeStats.blockedProductionWriteAttempts++; throw error; } }
```

- 计数器**只在闸门通过之后**自增；闸门拒绝走另一个计数器并抛异常。
- 全窗口 `blockedProductionWriteAttempts = 0`、`productionWrites = 0` ⇒ **不存在任何一次"闸门关闭时写成功"**。
- 时间序（关键）：
  - P0#1：最后一笔写 `lastWriteAt 17:48:15.434`；闸门 `BLOCKED 17:48:41.039` ⇒ **写早于闸门关闭 25.6 秒**。
  - P0#2：最后一笔写 `20:32:51`；闸门 `BLOCKED 20:33:49.801` ⇒ **写早于闸门关闭 58.8 秒**。
- 结论：**引擎无越权写，告警为监控器缺陷。** 该 P0 不构成时钟中断（但按 R16 规则它已经"写断了时钟标记"，这是流程代价，见 P2-1）。

### 7.3 写路径绕过穷举

- 全仓库签名点只有 2 处：`ExternalTradeAdapter.signed()`（全部私有 GET + 全部写）与 `productionReadOnlyPreflight.ts`（`method:'GET'` 硬编码 + `allowedSigned` 白名单，越界抛 `PRODUCTION_READ_ONLY_PATH_BLOCKED`）。后者不可能产生写。
- 全部 mutating 方法均经 `signed()`：`placeEntry`(POST /order)、`amendEntry`(PUT /order)、`cancelEntry`/`cancelOrder`/`cancelTakeProfit`(DELETE /order)、`placeTakeProfit`(POST /order)、`placeManualOrder`(POST /order)、`cancelSymbolOrders`(DELETE /order)、`setLeverage`(POST /leverage)。
- 非 GET 且不经 `signed()` 的交易所调用只有 **1 个**：`BinanceUserDataStream.listenKey('POST'|'PUT')` → `/fapi/v1/listenKey`。这是 R16 已记录的**有意例外**：它不签名、不创建订单、不增加风险，却是实时成交/风险事实的投递通道；把它也封掉会在出口抖动时**主动切断风险可见性**，风险严格更大。维持现状，并在此明确其边界。
- **`assertTestnetExchangeWrite()` 无 TTL、无宽限**：`verifyEgressIp()` 一旦失败立刻把 `status` 置 `UNAVAILABLE`（保留 `lastVerifiedEgressIp/lastVerifiedAt` 仅作记录），闸门 `verified = !expected || status==='VERIFIED'` 随即闭合。

**残余设计风险（不是本次缺陷，但必须记录）**：闸门读取的是**最近一次探测**的结果。若真实出口 IP 在两次探测之间发生变化，引擎最长可在 15 分钟内继续使用过期的 `VERIFIED` 事实。独立反证：窗口内所有成功探测返回的 IP 恒为 `172.104.186.174`（= expected），0 次 `MISMATCH`，且日志中**不存在任何** `-1000/-1021/-1022`、`Invalid API-key`、IP 白名单类交易所拒绝。故本窗口无假阳性证据；但"探测周期 ≫ 写周期"这一点应作为下一轮的可选项（多源回声探测在 R16 已明确列入未做清单）。

### 7.4 出口失效期间的裸仓与 TP 缺口

4 次失效的全部相邻采样（含每一次 `UNAVAILABLE` 采样）：`tp.status=READY`、`protected==required`（33/33 或 34/34）、`missing/qtyMismatch/wrongSide/orphanTp/duplicateTp/repairFailed/repairing/retryQueue/manualReviewRequired` 全 0，`capacity.inFlight=0`。

**结论：egress 失效期间未出现裸仓、未出现 TP 保护缺口。** 同时必须诚实说明另一半：`blockedProductionWriteAttempts` 全程 0，意味着**"保护性写入被出口闸挡住"这一已知设计取舍在 24h 内一次都没有实际发生**（因为无需补挂）。所以它是**代码里存在、窗口内未触发**的风险，不是已观测损害 —— 这直接影响候选 A 的排序（§17）。

## 8. Binance 请求治理最终复盘（Stage 5）

### 8.1 先修正度量，再谈治理

`r16-soak.py` 小时均值 bug（§1 第 5 条）导致 `soak-hourly.jsonl` 中所有 `*PerHour` 字段与 `writesThisHour` 系统性低估约 6 倍。**以下全部为用累计计数器独立重算的真实值**（repro：对 `soak-samples.jsonl` 首尾求差 ÷ 21.36h）：

| 指标 | 窗口真实值 | 速率 | 备注 |
|---|---|---|---|
| 总请求 | +119,042 | **5,573 /h**（p50 瞬时 5,533；区间 3,971–7,077） | 监控器报 ~918 |
| `/fapi/v1/order` 精确查询 | +26,867 | **1,258 /h**（区间 731–1,745） | 监控器报 ~200 |
| testnet 写 | +61 | 2.85 /h | 监控器 `writesThisHour` 求和仅 7 |
| **429 / 418** | **0 / 0** | — | 绝对值冻结在 17/3（均为 soak 之前） |
| peak `usedWeight1m` | **283** / `requestWeightLimit1m` 6,000 | **4.7%** | p50 132 |
| blocked / queueTimeout | +157 / +157 | 7.4 /h | 全部为市场/后台 lane 的 5s 刷新超时 |

按端点（进程生命周期归因，含 11:48:50–11:59 的 0.86% 窗口外部分）：`/fapi/v1/order` 27,039、`/fapi/v1/premiumIndex` 24,265、`/fapi/v1/openInterest` 21,850、`/fapi/v1/userTrades` 10,794（weight 53,970）、`/fapi/v1/allOrders` 10,769（weight 53,845）、`/fapi/v1/klines` 7,196、`/fapi/v2/account` 5,051、`/fapi/v2/positionRisk` 4,546、`/fapi/v1/openOrders` 1,257（weight 50,280）、`/fapi/v1/income` 1,409（weight 42,270）、`depth` 367、`listenKey` 27。总 weight 352,173。

### 8.2 `/fapi/v1/order` 六源分解（headline）

| 来源 | 归因 | 依据 |
|---|---|---|
| 1. 历史 UNKNOWN 审计 | **≈26,700 / 26,741（≥99.8%）** | 全部为 `source=ORDER_VERIFICATION, purpose=EXACT_ORDER_FACT`，节奏与 `appRuntime.ts:545` 的 `every(2_000, reviewPending())` 一致 |
| 2. terminal audit | **0** | `tiers.terminal` 在 128/128 采样恒为 `[0,0,5]`，5 行全部 tier 2，`nextAuditAt` 落在 30–60 min 阶梯 |
| 3. Entry / JIT | ≤43（写侧） | 写请求合计 61，`ENTRY_SUBMIT_RESPONSE_RECOVERED` 0 次 |
| 4. TP maintenance | **0** | `TP_UNKNOWN_ABSENCE_OBSERVED / TP_UNKNOWN_CONFIRMED_ABSENT / TP_CROSSED_BUT_POSITION_STILL_OPEN / TP_CROSSED_VERIFY_FAILED` 全 0 事件 |
| 5. reconciliation | `/order` **0**，但独占 weight：allOrders+userTrades 21,563 req / 107,815 weight = **总 weight 的 30%**，而 `/order` 仅占 **7.6%** |
| 6. other | 少量 | — |

**回答"R14/R15 之后剩余最大来源究竟是什么"：不是 6 类并列，而是单一来源 —— `entryCoordinator.reviewPending()` 对历史 UNKNOWN 行的 `exactOrderFact` 逐行探针，独占 `/order` 的 99.8%、约 1,258/h。**

并且该探针是**结构性空转**：子审计在实时 ledger 上观测到 **23/23 次已完成探针返回 HTTP 400**（即 `-2013` 订单不存在），而 `exactOrderCache` 的 TTL 只有 **1,500 ms**，短于 2,000 ms 的 tick ⇒ **缓存永不命中**。这些行的最终事实早已确定（`verifiedNoActiveRiskUnknownCount = 30 = historicalUnknownCount`，即全部 30 行都已判为无活跃风险），却仍以 1,258/h  Forever 重查一个必然得到同一个否定答案的端点。

### 8.3 对 R15 两条根因的复评

- **R15 主张 (a)（~2s 串行探针把端点钉在 1,700/h）：机制成立，数字与归因被否。** 直测 `admittedAt→completedAt`：`/fapi/v1/order` 中位 **1,567 ms**、均值 1,939 ms、最大 5,130 ms，`queueAgeMs` 64/64 为 0（未被预算阻塞）⇒ 串行、延迟受限这一机制为真。但**速率与被探针行数无关**：`corr(exactOrder/h, 非 deferred UNKNOWN 行数) = 0.002`（n=128），且在 `deferred == total`（全部延迟）的 7 个采样里速率仍是 1,265/h。观测 1,258/h = 每 2.87s 一次探针（≈0.7 次/tick），既不是 R15 的 1,700/h，也不是"1 行 × 2s"。**⇒ R15 把根因归给"历史 UNKNOWN 常驻行"是错的；驱动者是一个不受 tier 阶梯管辖的常驻行类别**（`remoteFactAuditClass` 对非 UNKNOWN 的 active 状态返回 null ⇒ 永不 defer），子审计的最强假设是 1 行 `SUBMITTING`（现网 `entry rows 411, UNKNOWN 29/30, SUBMITTING 1`）。此点证据尚不足以定名到具体 orderId（dispatch ledger 不含 `orderId/symbol`），**标记为"机制已定位、个体未归因"**。
- **R15 主张 (b)（因缺证据而降级）：代码为真，但影响不显著。** `reconciliationService.ts:39`（非 full scan 时 `return null`）与 `entryRiskOccupancy.ts:121`（`tier<=0 → false`）确实构成"因缺证据降级"。但 tiering 整体在工作：tier 2 均值 27.3 行、tier 1 均值 1.59、tier 0 均值 **0.66**，阶梯 `[300000, 900000, 1800000]` 生效，`tiers` 求和与 `historicalUnknownCount` 0/129 失配。**它无法解释 1,258/h 这个平坦速率。**

### 8.4 停止建议（明确）

`/order` 请求数**不应再优化**：1,258/h × weight 1 = 总 weight 的 7.6%，peak weight 仅为上限的 4.7%，`budget.status` 129/129 `AVAILABLE`，`blockedUntil` 恒 0，**新增 429/418 为 0**。以"数字还能更低"为由继续削减属于过度工程。**若下一轮要动请求侧，正确目标不是"降 `/order` 数量"，而是"消灭一个永不收敛的空转探针"（§17 候选 2）** —— 那是正确性问题，恰好也省请求，但省请求不是理由。

## 9. UNKNOWN / terminal / reconciliation 完整复盘（Stage 6）

- **historical UNKNOWN：28 → 30**。增长原因可精确归因到 2 条新行：09-20 16:50:02 `ZECUSDT ml_740c6b7ba8361a6f334478fe4155` 与 16:51:36 `TUTUSDT ml_19dd3142e048c94e1b5ef5e05e05`，二者均为 `ENTRY_SUBMISSION_UNKNOWN: Binance HTTP 400 {"code":-1111,"msg":"Precision is over the maximum defined for this asset."}`。**把一次无法确认的 400 记成 UNKNOWN 是正确方向（fail-closed）**；真正的问题是**引擎提交了精度非法的订单**（订单构造侧缺陷，见 P2-3），且这类行一旦产生就永久驻留 —— 它们是 §8 空转探针和 §9 的 7 天悬崖的**人口生成器**。
- **目标 A（历史 UNKNOWN 不删除）：达成。** `historicalUnknownCount` 全窗口从未下降；released claims（`claims` 键 `"0"`）由 315 单调增至 329，`entry_execution_tasks` 现网 `active=0` 329 行、`active=1` 0 行。
- **目标 B（活跃/新事实立即提升优先级）：达成，有正例。** `ENTRY_ORDER_ACTIVE_RESTORED` 1 次 —— 09-20 17:48:10 XPLUSDT `entry_intent_mu9msow2_djcw93qj`，`previousStatus:CANCELED → status:WORKING`（一笔已撤单在交易所侧重新可见），引擎立刻 `occupancyReleased:false` + tier 重置为 0 高频复审；另有 `ENTRY_ORDER_FILL_ATTRIBUTION_REVISED` 15 次、`ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED` 于 20:32:13（VVVUSDT，`POSITION_PRESENT_WITHOUT_DURABLE_ENTRY_PROVENANCE`）出现并在 21:29 前解决。**迟到的事实被看见了，这是这套审计最有价值的一条正向证据。**
- **目标 C（稳定 terminal 不无限高频轮询）：达成。** 5 条 terminal 全 tier 2、`nextAuditAt` 30–60 min、`deferredTerminal` 恒 5；`neverSubmitted` 82 行 tiers `[0,0,0]`、deferred 0，在 `reconciliationService.ts:62` 被跳过，**零请求成本**；`UNKNOWN_RISK_AUDIT_SUMMARY` 250 次中 `suppressedUnknown ≤ 3`。
- **新反模式 #1 —— 证据有效期与复审时刻零安全余量（P2，但它是本轮唯一持续抖动的来源）**：`ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED{reason:EXACT_QUERY_NOT_FOUND}` 475 次 vs `…_VERIFIED_NO_ACTIVE_RISK` 1,078 次。载荷显示 `validUntil = now + UNKNOWN_RISK_EVIDENCE_TIER_MS[tier]` 与 `jitteredNextAuditAt` 用**同一个上界**，因此 **465/468（99.4%）的复审必然落在证据过期之后**；实测过期中位 57s、p90 211s、max 605s。所有 475 行均 `auditTier:0, failClosed:true, occupancyReleased:false` ⇒ **引擎是"过度报告风险"，绝不漏报**；自愈中位 37s、p90 67s、max 140.6s，`NO_ACTIVE_RISK_CONFLICT = 0`、`IDENTITY_CONFLICT = 0`。这正是 02:29 P1 的成因（§12）。
- **新反模式 #2 —— 7 天回溯悬崖（真正的 P1，见 §16）**：`UNKNOWN_RISK_MAX_LOOKBACK_MS = 7*24*60*60_000`；`noActiveRiskEvidence()` 在 `age > 7d` 时 `return null`；else 分支（`reconciliationService.ts:89`）把该行写回 `status:'UNKNOWN', exchangeTerminalStatus:'UNKNOWN', activeRiskExposure:true`，`nextEvidence` 只保留 CONFLICT 情形，并 `resetRemoteRiskAudit(now)` ⇒ **tier 归 0**。后果可代码推定且日期确定：永久 `activeRiskUnresolvedCount≥1`、永久 phantom 敞口计入 `collectPendingEntryRiskExposures`、永久 tier-0 高频探针、`liveValidationService` 的 `RECONCILIATION_HEALTHY`（判据 `!rec.lastError && rec.driftCount===0`）永久 FAIL。触发日 **2026-09-24 06:40**（XRPUSDC 行），另有 3 行已超过 4 天。
- **restart 后状态**：本窗口无重启 ⇒ 重启恢复路径（`reconciliationService.ts:94` 仓位重归因）**在本窗口不可测**，属客观缺口，不假装通过。

## 10. 事件噪声最终复盘（Stage 7）

以 **durable 小时聚合**（`soak-hourly.jsonl` 的 `events` map，21 行、合计 37,252 条）为准，Top 12 占比：

| 事件类型 | 数量 | 占比 |
|---|---|---|
| `CANDIDATE_LIFECYCLE_REDERIVED` | 23,175 | **62.2%** |
| `MARKET_SYMBOL_ERROR` | 1,827 | 4.9% |
| `__kline_closed_candle_gap__`（聚合派生） | 1,634 | 4.4% |
| `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` | 1,540 | 4.1% |
| `CANDIDATE_SUPPLY_HEALTH` | 1,243 | 3.3% |
| `TRADE_RECORD_REPAIRED` | 949 | 2.5% |
| `EXCHANGE_FILL_ATTRIBUTED` | 942 | 2.5% |
| `ORDER_FILL_RECONCILED` | 930 | 2.5% |
| `MARKET_COHORT_RETIRED` | 703 | 1.9% |
| `BINANCE_USER_DATA` | 667 | 1.8% |
| `CANDIDATE_LIFECYCLE_CHANGED` | 624 | 1.7% |
| `MARKET_COHORT_REFILLED` | 455 | 1.2% |

原始日志侧独立复算：`CANDIDATE_LIFECYCLE_REDERIVED` 23,638 / 38,714 条日志，`UNKNOWN_RISK_AUDIT_SUMMARY` 249 条（对比 R15 之前的 25.9% 占比 —— **UNKNOWN 审计噪声已被成功驯服**）。

判断（按用户要求先找消费者，不因数字大就删）。合计 37,252 条 / 74 种类型，Top-20 占 96.98%，且**无 mix shift**（`CANDIDATE_LIFECYCLE_REDERIVED` 在全部 21 小时均排第一，占比仅在 34.5%–86.0% 之间波动，在 kline gap 小时被稀释）：

| 事件类型 | 数量 | 占比 | **消费者（grep 实证）** | 分级 |
|---|---|---|---|---|
| `CANDIDATE_LIFECYCLE_REDERIVED` | 23,175 | 62.21% | **无行为消费者**（仅出现在 `remoteFactAuditIntegration.test.ts:122-127`） | 可 summary 化 |
| `MARKET_SYMBOL_ERROR` | 1,827 | 4.90% | `marketDataHub.ts:104/117/131` + 测试 | 仅 observability |
| `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` | 1,540 | 4.13% | `p0EntryIntegrity.ts:23`、`brainRunArchive.ts:12` | **不可减**（重复可去） |
| `CANDIDATE_SUPPLY_HEALTH` | 1,243 | 3.34% | 无；每 refresh 1 条（`universeCoordinator.ts:49`） | 仅 observability |
| `TRADE_RECORD_REPAIRED` / `EXCHANGE_FILL_ATTRIBUTED` / `ORDER_FILL_RECONCILED` | 949/942/930 | 7.58% | `settingsStore.ts:695,936` | **不可减** |
| `CANDIDATE_LIFECYCLE_CHANGED` | 624 | 1.7% | **`appRuntime.ts:1373` 读的是 CHANGED，不是 REDERIVED** | 不可减 |
| `UNKNOWN_RISK_AUDIT_SUMMARY` | 246 | 0.66% | `entryRiskOccupancy.ts:47` 已做节流（1h + factHash） | **健康，非噪声源**（R15 之战已赢） |

- **lifecycle "双写"从假设升级为已证实（本轮新结论）**：现存 15,318 条 REDERIVED 中 **15,071 条（98.4%）是完全相同的 `READY→POSITION_HELD / ACTIVE_POSITION_FACT`**，至少 6 个 symbol 各自恰好 851 条；BTCUSDT 在 08:20:19–08:27:49 的 6 分钟内发布 **13 条完全相同事件**，触发源在 `RECONCILIATION_TERMINAL`（15s，`appRuntime.ts:552`）与 `UNIVERSE_REFRESH` 之间交替。机理：`universeCoordinator.ts:29-33` 把 `status:'READY'` 写入时**不带任何持仓守卫也不发布事件**，随后 `candidateLifecycleDeriver.ts:24,37` 依据仓位事实改写为 `POSITION_HELD` 并发布 —— **每个持仓 symbol 每一轮 pass 产生一条噪声，且永不停止**。
- **该项的实际损害已被量化（不是"数字难看"）**：它独占非保护分区 77% 配额，直接把同分区内 `POSITION_*`、`MARKET_KLINE_SEQUENCE_*`、`ENTRY_ECONOMIC/ADMISSION` 的有效留存压到 ~7.3h，并导致 4 个事件类型被彻底抹除（§14）。**因此它不是 P3，而是有实测损害的 P2。**
- `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED` 1,540 条只覆盖 **30 个不同 orderId**（单行最多 144 条），且 `VERIFIED_NO_ACTIVE_RISK` 证据未变 ⇒ 是**重复**而非重复事实，正确修法是 §17 候选 2 的 TTL 余量，不是砍事件。
- `MARKET_SYMBOL_ERROR` / gap 类：是 §6 自愈证据链的原始记录，**不能减**。

## 11. Entry funnel / 经济性 / ENFORCE readiness（Stage 8）

**窗口全链路（durable 小时聚合 + 原始日志）**：97 `POOL_ANALYSIS_STARTED` → 95 `PRE_AI_EXECUTION_ENVELOPE_CREATED` → 95 次 primary run（93 成 / 2 败）→ 45 `PLACE_LONG` / 48 `PLACE_SHORT` → **45 `ENTRY_ECONOMIC_ADMISSION_EVALUATED`** → 27 `ENTRY_INTENT_CREATED` → 13 `ENTRY_EXECUTION_WAITING` / 15 `ENTRY_SUBMIT_ATTEMPTED` → 12 `ENTRY_ORDER_CREATED` → 7 `ENTRY_FILLED` → 6 `ENTRY_ORDER_TTL_CLOSED` → 10 `POSITION_LIFECYCLE_TRANSITION`。旁路：`FINAL_ORDER_RISK_EVALUATED` 195、`ENTRY_DECISION_BLOCKED` 48、`CANDIDATE_REJECTED` 50、`ENTRY_ORDER_BLOCKED` 3、`POSITION_CLOSED_USER_DATA` 8、`POSITION_HUMAN_HANDOFF` 5。`entryRows` 394→411（+17，净 +1 仓位 ⇒ 约 16 次平/开周转，非新增风险），claims 315→329。

**经济评估之前还有一层被砍掉的漏斗（关键补充）**：`AI_DIRECTION_NOT_EXECUTABLE`（SHORT）30、`RISK_REJECT_GROSS_EXPOSURE`（LONG）14、`REJECT_DIRECTION_EXPOSURE`（SHORT）4。**⇒ 45 次经济评估本身已是被敞口/方向闸过滤后的子集**，敞口闸门在上游就已经在真实生效。

**策略参数逐字（live 确认，`settingsVersion 188` 未变）**：`admissionMode:"SHADOW"`、`minHistoricalReachProbability:0.5`、`minNetProfitUsd:1`、`maxGrossExposurePct:1`、`maxDirectionExposurePct:0.5`、**`maxHumanManagedPositions:4`**、**`maxHumanManagedNotionalPctEquity:0.2`**、`entry.minReachability:0.48`。

**09-21 09:15 实测余量（`/auto-readiness` + `/human-managed`）**：equity **$10,016.28**；gross 敞口 **100.23% of cap（已超 0.23pp）**；LONG 37.87%（余 12.13pp）；SHORT **62.37%（超限 12.37pp）**；**人工仓簿 29 个仓位 / $9,600.14 notional，而配置上限是 4 个 / $2,003.26 ⇒ 超限 7.2 倍**（且这 29 个全部不可自动退出：`automaticStopLoss:false`、`timeoutClose:false`、`panicClose:false`、`humanHandoffAfterMinutes:1440`）。

**45 次 SHADOW 经济性评估的结果分布（本窗口最重要的一组数字）**：

- `passed = true`：**0**；`wouldBlock = true` 全部；`mode` 全部 `SHADOW`。
- **AI 的 side / quantity / target 在整个窗口从未被改写**（`quantityMutated / targetMutated` 全 false）⇒ SHADOW 的"只观察不干预"语义是**真成立**的，这是 ENFORCE 前必须有的前提性证据。
- blocker 分布：`HUMAN_MANAGED_EXPOSURE_LIMIT` **45/45（100%）**、`TP_REACH_PROBABILITY_UNMET` 31/45（68.9%）、`ECONOMIC_MIN_NET_PROFIT_UNMET` 16/45（35.6%）、`TP_HISTORICAL_REACHABILITY_UNMET` 4/45（8.9%）。
- **精确组合**：`cap+reach` 17、`net+cap+reach` 10、**`cap` 单独 8**、`net+cap` 6、`cap+hardreach+reach` 4。
- 分布统计：`reachProbability` p25 0.08 / p50 0.27 / p75 0.60 / max 0.86，**≥0.50 者 14/45 = 31.1%**；`expectedNetProfit` min $0.02 / p50 $4.25 / max $83.64；`notionalUsd` min $7 / p50 $457 / max $1,788。

**逐条回答**：

1. **为什么 SHADOW 仍大量 `passed=0`？** 机理是 `economicEntryFeasibility.ts:81` 的 `passed = blockers.length===0` —— 只要有一条 blocker 即 `false`，而 SHADOW 只记录不阻断。当前 45/45 都带 `HUMAN_MANAGED_EXPOSURE_LIMIT`，因此**在人工仓簿维持现状时，通过是算术上不可能的**，与经济判据本身是否合理无关。
2. **HUMAN cap 是结构性阻断还是当前真实暴露造成？** **是真实暴露造成，但当前被硬锁死。** `:21-29` 是对 live `managementStatus==='HUMAN_MANAGED'` 行的纯函数（不是写死的开关），故属"后果"而非"结构"；但由于 29 个 HUMAN 仓**全部不具备任何自动退出条件**（`automaticStopLoss/timeoutClose/panicClose` 均 false、`humanHandoffAfterMinutes:1440`），它**在实践中等同永久阻断** —— 只有人工减仓能解除。实测口径：人工簿 $9,600.14 / 上限 $2,003.26 = **超限 7.2 倍**。cap-only 阻断 8/45 = 17.8%，与历史 25/126 = 19.8% 高度一致。
3. **`reachability=0.50` 是否有足够 out-of-sample 证据？** **一致性充分、独立性不足。** 四次测量：216 样本 32.9%、58 样本 29.3%、本窗口 45 样本 **31.1%**（median 0.274）、`decision_chains` 全量去重（3,439 链 / 09-17→09-21，**422 观测、median 0.392、≥0.50 者 140 = 33.2%**，与 32.9% 仅差 0.3pp）。**但 422 条与历史 216 条来自同一连续 3 天、同一 model、同一 regime ⇒ 它是"同一母本的更大样本"，不是 out-of-sample。** 结论：足以证明"0.50 砍掉约七成候选"，**不足以**为调参提供依据。
4. **`minNetProfitUsd=1` 是否仍被真实成交结果支持？** **证据不足，且比较基准本身带未知误差项。** (a) 本窗口 `$1` 作为 co-blocker 命中 **16/45 = 35.6%**（`expectedNetProfit` 最小 $0.02）⇒ 与上一轮"`$1` 近似惰性（75/76 通过）"**冲突**，差异可由 notional 分布解释（本窗口 p50 $457，历史需 ≥$210 才易通过）。(b) 已实现结果反验：135 条 CLOSED 行 `netPnl` 全为 `null`；改用 `tradingNetPnlExFunding` 后全样本 median **$1.333**、62% ≥$1，**但与 canary 同量级的小额组（`entryGrossNotional` 10–40，n=20）median 仅 $0.466、只有 45% ≥$1、最差 −$1.06**；严格 15–25 带 n=8 = `[0.23,0.25,0.25,0.27,1.01,1.01,1.01,1.01]`，**赢家贴地板聚集**。(c) 根本缺陷：**135/135 行 `fundingAttributionStatus=UNKNOWN` 且 `pnlBasis=CANONICAL_NET_WITH_FUNDING_UNKNOWN`** ⇒ 每一次 `$1` 比较都含未量化误差项。**判定：`$1` 既未被证明有效、也未被证明惰性，当前不可判定（P2-7）。**
5. **是否存在"市场有候选，但 capacity/risk 使其不可执行"的正常稳态？** **存在，且就是本窗口的常态**：98 个新鲜快照、pool 16/20、93 次决策，但 gross 已达 cap 的 100.23%、SHORT 超限 12.37pp；`executableCandidateCount=0` ⇒ 104/129 采样报 `WAITING_EXECUTION_CAPACITY`；实时 `/api/v3/pipeline` 为 `runtimeControl.mode=RUNNING, reasonCode=NO_EXECUTABLE_CONTRACT, pauseSource=NONE, autoResume=true`，且 `freshMarkets.status=FRESH`。**这是授权结构 + 敞口/经济门槛的合成结果，不是故障。**（提示词 Stage 6 关注的"误报成故障"：在 Primary 侧未发生（§5），在 reason-code 标签侧确实发生（§4）。）

## 12. TP / Position / HUMAN 安全最终审计（Stage 9）

**硬门（全部通过）**

| 硬要求 | 结果 |
|---|---|
| 不得存在自动亏损平仓 HUMAN_MANAGED | **通过（代码 + 现网双证）**。22 个浮亏仓位、合计 **−998.65 USD**（最差 AVAXUSDT −845.18）全部保持 open 且 `tpStatus=PROTECTED`；5 次 `POSITION_HUMAN_HANDOFF` 全部 `LOSS_HANDOFF_BARS` + `tpRetained:true`、无一平仓。代码侧 `LossHandoffService`（`lossHandoff.ts`）仅 import `RuntimeState` + `EventBus`，文件头注释即"never calls AI, closes a position, or alters its TP" |
| 不得存在 TP safety regression | **通过**。129/129 采样 `protected==required`（33/33→34/34），全部缺陷计数器恒 0；现网 34/34 `PROTECTED` |
| 不得存在第二套 exit chain | **需重新表述**：不存在第二套"策略性退出"链；`ExitDispatcher` 这一组件名在本构建中不存在（见下） |
| 不得存在 position/risk accounting 漂移 | **通过**。15 次仓位计数变化 100% 对应到具体事件（含时间戳逐一核对，零未解释移动）；`unresolvedDriftCount` ∈ {0,1,2}，其值恒由 §9 的探针竞态贡献，`remoteEntries=0 & remoteTps=0`（`reconciliationService.ts:107`）⇒ 从未检出未管控交易所订单或孤儿 TP |

**必须纠正提示词的一个前提**：提示词 Stage 9 与用户清单里的 **`ExitDispatcher` 在 V3.9.5 冻结构建中不存在**（`find`/`grep` 均无该文件或符号）。可下单面恰好三个：`entryCoordinator.ts:227 placeEntry`（开仓）、`tpGuardian.ts:15 placeTakeProfit`（`reduceOnly`/`positionSide`，只朝盈利方向）、`accountExecutor.ts:7 placeManualOrder`（人工路径，`api/router.ts:453`）。另存在一个**人工门控的减仓提交器**：`appRuntime.ts:547` 每 2s 轮询 `manual.resumeExitGoals()`，其 goal 只能由 HTTP `action==='EMERGENCY_CLOSE' && confirm===true` 播种；窗口内 `manualExitGoals=0`、`MANUAL_EXIT_GOAL_QUEUED / MANUAL_ACTION_SUBMITTED / MANUAL_ORDER_SUBMITTED` **0 事件**。它不是亏损平仓路径，但**是**一个自动化提交的减仓通道，应被点名纳入 V3.9.6 的 exit-path 文档。

**唯一一次 TP 补挂抖动（透明记录）**：WLDUSDC 08:32:59→08:35:28，3 笔快速 INCREASE 成交触发 `TP_MISMATCH_CANCEL_RESULT{QTY_MISMATCH_BEFORE_REPAIR}` 与一次 `TP_REPAIR_FAILED{submissionOutcome:NOT_ATTEMPTED, BINANCE_TRANSPORT_BLOCKED, nextRetryAt}`，随后 `TP_PROTECTED`（qty 555）**29 秒自愈**。注意：`soak-samples.jsonl` 全程 `repairFailed=0` —— 因为该事件只持续 29s，10 分钟采样的监控器**不可能看到它**。这是 §15 反事实 #3 的实例。

## 13. 资源与调度效率（Stage 10）

- 8081/8084：24h 内累计仅 1 次失败 + 1 次 schema 失败 + 1 次隔离，无超时、无队列堆积；`AI_RUN_TERMINAL` 93 次 ⇒ 平均约 21.6 min/次决策周期。**AI 侧没有资源瓶颈，也没有无意义空转**（`IDLE_NO_DISPATCHABLE_CANDIDATE` 是 90/129，属正常 idle）。
- Engine lane：单路由 `proxy-a087cc91667b`；peak weight 283/6,000 = **4.7%**，`budget.status` 恒 AVAILABLE ⇒ 吞吐余量极大。
- 重复扫描 / 无意义等待：两处确认存在 ——(a) §8.2 的 `/order` 空转探针（1,258/h，缓存 1.5s < tick 2s，永不命中）；(b) `CANDIDATE_LIFECYCLE_REDERIVED` 周期性重推导（62.2% 事件量）。两者都是**计算/记录成本**，不是风险。
- 单线程 ~2s remote call 顶住请求量的问题：**机制仍在（中位 1,567 ms）、但"顶住请求量"的结论已被否**（速率与被扫行数相关性 0.002）。因此不应以"并行化 reviewPending 以降请求数"为理由去改交易侧代码 —— 那是在优化一个不受约束的量。
- **明确不建议**为提升 GPU 利用率而增加 AI 请求。

## 14. 数据库 / 数据保留 / 证据能力（Stage 11）

- `runtime_events` 的裁剪**不是单一 70,000 行全局 FIFO**，而是**两个分区各自的上限**：`protected` 50,000 + `non-protected` 20,000，各按 `ts ASC, rowid ASC` 全局 FIFO、每 5 秒批量删 250 行（`storageCapacityGuard.ts:20,38-39` + `appRuntime.ts:564`）。实测三值精确为 50,000 / 20,000 / 70,001。
- **致命设计缺口：受保护性是"事件名分类"决定的，而 `POSITION_*`、`MARKET_KLINE_SEQUENCE_*`、`ENTRY_ECONOMIC/DECISION/ADMISSION` 落在**非保护**分区，而 `TP_*`、`*ORDER*`、`*FILL*` 落在保护分区。** 而非保护分区已被单一噪声类型占满：
  - `CANDIDATE_LIFECYCLE_REDERIVED` 独占非保护分区 **15,318 / 20,000 = 77%** ⇒ **该分区内其它所有类型的有效留存被压到约 7.3 小时**。
  - 表壁钟看似覆盖 73.4h（09-18 07:52 → 09-21 09:15），但**窗口内 37,252 条事件只有 25,264 条还在表里 —— 约 32% 已被删除**。

| 事件类型 | 现存 | 窗口真值 | 已丢失 | 最早留存时刻 |
|---|---|---|---|---|
| `ENTRY_ADMISSION_BLOCKED` / `RESUMED` | 各 2 | 各 4 | **各 2（15:03、17:48 已滚出）** | 09-20 20:33 |
| `MARKET_KLINE_SEQUENCE_REPAIRED` | 262 | 381 | 119（8.57h） | 09-20 20:33 |
| `MARKET_KLINE_SEQUENCE_REPAIR_FAILED` | 15 | 19 | 4 | 09-20 20:35 |
| `MARKET_SYMBOL_ERROR` | 1,139 | 1,827 | 687 | 09-20 19:2x |
| `POSITION_HUMAN_HANDOFF` | 2 | 5 | **3（10.61h）** | 09-20 22:35 |
| `POSITION_LIFECYCLE_TRANSITION` | 8 | 10 | 2 | 09-20 20:3x |
| `ENTRY_ECONOMIC_ADMISSION_EVALUATED` | 31 | 45 | 14 | 09-20 19:29 |
| `BINANCE_USER_DATA` / `CANDIDATE_SUPPLY_HEALTH` / `UNKNOWN_RISK_AUDIT_SUMMARY` | 402 / 851 / 165 | 667 / 1,243 / 249 | 265 / 392 / 84 | ~09-20 19:2x |
| **`AI_RUN_FAILED`(2)、`AI_FAILED_NO_INTENT`(2)、`ENTRY_POST_ONLY_RETRY`(1)、`DIRECTION_STABILITY_SHADOW`(1)** | **0** | 2/2/1/1 | **全部 4 个类型被彻底抹除** | — |
| `TP_PROTECTED` / `ENTRY_INTENT_CREATED` / `ENTRY_ORDER_BLOCKED` / 全部 `TP_*` / 成交类 | 103 / 396 / 56 / 42 | 同值 | **0（保护分区窗口内 100% 留存）** | 早于窗口 |

- **R13 教训在本窗口部分重演，且性质比"看起来没事"更严重**：证明两次 P0 假阳性所**必需**的那两条 `ENTRY_ADMISSION_BLOCKED`（15:03、17:48）**在审计开始时已不在 DB 中**；`POSITION_HUMAN_HANDOFF` 也丢了 3 条。它们之所以还能被引用，唯一原因是磁盘运行日志 `data/runtime-logs/engine-<date>-<instanceId>-<part>.jsonl`（含 08:00 的 gz 归档）仍完整镜像该实例全生命周期。**若只依赖 DB，本轮将无法推翻 P0、也无法复原 5 次人工接管。** 这不是理论风险，是已经发生的一次近失；而**单次发生的关键事实（两条 `AI_RUN_FAILED`）已永久不可恢复**。
- 小时聚合完整性：`soak-hourly.jsonl` 21 行，02:59:59→04:00:04 间隔 3,605 s（< 3,700），**无缺失小时、无丢失采样**；"看起来缺 03:00"是 600s 采样 + 处理耗时造成的小时戳漂移，属显示问题。
- **采集器对 Engine 的影响**：`r16-soak.py` 严格 `GET` + `mode=ro`，自身不产生交易所请求，窗口内未观测其对 Engine 的影响。已记录的过程教训依然有效：窗口内跑一次本机全量 CI 等价构建曾诱发 2 次最低优先级 `TRADE_SYNC_AUTO_FAILED` 超时 —— 本窗口 `TRADE_SYNC_AUTO_FAILED` 共 23 次（≈1.1/h），属后台 lane 抖动，未影响 PRIVATE_TRUTH lane。
- **小时聚合与原始日志存在约 8% 的量差**（1,827/1,634 vs 1,682/1,487）：两者一个是聚合器写盘、一个是磁盘离散事件，来源不同 ⇒ "权威记录"的 provenance 需要在下一轮说明或对齐（P3）。

## 15. 反事实检查：我们可能误判了什么（Stage 12）

| # | 命题 | 证据 | 反证 | 置信度 | 是否需下一轮实验 |
|---|---|---|---|---|---|
| 1 | 把"没事故"当成"机制正确"？ | 本次**主动做了反向证明**：egress 闸被 4 次真实触发（§7.1），自愈被 381 次真实修复验证（§6），SHADOW 不干预被 45 次 `wouldBlock=true` 且 AI 参数零改写验证（§11） | **两处"没事故"绝不可记为"已验证"**：出口失效下保护性写入被挡（`blockedProductionWriteAttempts` 恒 0 ⇒ 从未发生）与重启归因（0 次重启）。**更严重的是反向实例：20:39:22 有一次真实 Primary `RUNTIME_PAUSED` 故障，因监控器无 `primary.status` 规则而被完全静默 —— 同一样本恰恰触发了假 P0** | 高 | 是：需受控验证 listenKey/TP 在 UNAVAILABLE 下的行为与重启归因；并补告警规则（§17 候选 3） |
| 2 | 有事件被 retention 吃掉？ | **确凿为"是"且比预想严重**：`ENTRY_ADMISSION_BLOCKED` 4→2、`POSITION_HUMAN_HANDOFF` 5→2、kline 修复 381→262，**4 个事件类型被彻底抹除**，窗口内 32% 事件已删（§14） | 磁盘轮转日志与 gz 归档仍在，关键事实可重建 | 高 | 否；改为"结论必须写进 durable 文件"的规程 |
| 3 | 采集器存在盲区？ | **四处**：(a) 小时率低估 6.03×；(b) `persistence.checkedAt` 全程冻结，`integrity:true` 实为启动值；(c) 29s 的 `TP_REPAIR_FAILED` 因 600s 采样永远进不了 `soak-samples`；(d) `ENGINE_ERROR` / `STORAGE_PRESSURE` 为**无发布点的死探针**，且无 `primary.status != READY` 规则 | 本轮所有裁决已改用 durable 文件 + 原始日志双源，未被这些盲区误导 | 高 | 是（collector 与告警规则侧，不需重启 Engine） |
| 4 | 低频状态长期未触发？ | **是**：`blockedProductionWriteAttempts>0`（0 次）、`MISMATCH`（0 次）、`terminal` 降级探针（0 次）、重启归因（0 次）、`listenKeyExpired`（0 次） | 未触发≠有缺陷；但**"未触发"绝不能记为"已验证"** | 高 | 是 |
| 5 | egress proof 会否假阳性？ | **已排除**：所有成功探测返回 IP ≡ expected；0 次 MISMATCH；日志无 `-1000/-1021/-1022`/API-key/IP 白名单类拒绝 ⇒ 无"证明 VERIFIED 但其实走错出口"的迹象 | **但存在结构性假阴性通道**：闸门读最近探测结果，探测周期 15 min ≫ 写周期 ⇒ 真实 IP 变更最长 15 min 不可见；窗口内未发生不等于机制免疫 | 中-高（对"本窗口无假阳性"高；对"机制无假阳性"中） | 是（多源回声探测，R16 已列入未做清单） |
| 6 | K 线自愈是否只对特定 reconnect 类型有效？ | 自愈对 4 次风暴（17:19/20:33/21:18/08:34）全部有效，detect→repair 3–15s，19 次失败的归因全为**外部传输**（9 队列超时、6 `STILL_DISCONTINUOUS`、3 `REPAIR_COOLDOWN`、1 transport），无逻辑性失败 | **无法评估 WS 层**：`StreamMetrics.reconnects / gapsByType.websocketConnection` 只存在内存 gauge，从未发布为事件、也无 API 暴露 ⇒ **24h 的 WS 重连次数在证据上不可测**（提示词 Stage 3 第 1 项客观无法作答） | 对自愈高；对"覆盖所有 reconnect 类型"**低（不可测）** | 是：需先补 reconnect 可观测性 |
| 7 | UNKNOWN 审计会否漏掉迟到事实？ | **否，且有正例**：`ENTRY_ORDER_ACTIVE_RESTORED`（CANCELED→WORKING）与 15 次 `FILL_ATTRIBUTION_REVISED` 均被捕获并即刻重置 tier 0 复审；`IDENTITY_CONFLICT=0` | 检测依赖 5 源严格证明 + openOrders 全扫 + user-data WS；`noActiveRiskEvidence` 要求 `fullOrderScan`，非全扫 pass 返回 null ⇒ **降级而非升级**，方向保守 | 高 | 否 |
| 8 | terminal tier 会否掩盖 late fill？ | **未发现掩盖**：5 条 terminal 恒 tier 2、`nextAuditAt` 30–60min、`suppressedUnknown≤3`；其风险事实主要由 WS user-data 与全扫兜底，不依赖 tier | 理论上 tier 2 的 30min 窗口内 late fill 依赖 WS 可用性；窗口内 `listenKeyExpired=0`，故未验证失效场景 | 中 | 是（与 #4 合并） |
| 9 | Entry capacity 存在方向性饥饿？ | 历史上（R15 06:40）SHORT 余量 ~26 USDT vs LONG ~1,792 ⇒ **方向性饥饿真实存在过**；本窗口 gross/direction 被人工仓吃满，45/45 阻断，因此**无法区分"方向饥饿"与"总量饥饿"** —— cap 是 100% 主因，方向项被掩盖 | 现有遥测未导出 LONG/SHORT 分项余量时间序列（仅 `/pipeline` 的 `capital` 快照） | 中 | 是：需 LONG/SHORT headroom 时间序列才能裁决 |
| 10 | SHADOW 证据足以支撑 ENFORCE？ | **不足以支撑"通过侧"**：窗口 45 评估 0 通过、3 轮 canary 0 通过 ⇒ **`passed=true` 端到端从未被观测过哪怕一次** | 足以支撑"结构侧"：SHADOW 不干预语义、blocker 分布、cap-only 17.8% 三点跨样本一致，说明 ENFORCE 一旦放行必然产生真实订单且闸门可用 | 高 | 是（§17 候选 5） |

## 16. 最终风险分级（Stage 13）

### P0 —— 无

两条 `P0 EGRESS FAIL-OPEN` 告警经证据推翻（§7.2）；`productionWrites` 恒 0；TP 保护 129/129 完整；亏损平仓零发生；无存储完整性错误。**窗口内不存在必须立即修复才能继续运行的缺陷。**

### P1 —— 1 项（阻止权限扩大，不要求改动已冻结构建）

**P1-1｜UNKNOWN 风险审计 7 天回溯悬崖。** 证据：`reconciliationService.ts:16`（常量 `7*24*60*60_000`）与 `:40`（`age>7d → return null`）+ `:89` else 分支强制 `activeRiskExposure:true` 并 `resetRemoteRiskAudit()`；最老行 XRPUSDC `entry_intent_mu4op8x2_3pwywucr` 建于 09-17 06:40:33 ⇒ **2026-09-24 06:40 确定触发**，另有 3 行 >4 天。影响：永久 phantom 敞口占用额度、永久 `DEGRADED`、`RECONCILIATION_HEALTHY` 永久 FAIL 从而**永久阻断 ENFORCE 就绪认证**、永久 tier-0 探针增加 §8 负载。风险：方向为过度报告（不伤本金），但它是自我扩群的（UNKNOWN 只增不减，ENFORCE 后更快）。**是否需重启：需（改引擎代码）。是否改交易语义：是（风险归属判定）。是否需重跑 24h：是。**

### P2 —— 值得修，不影响稳定运行（7 项）

- **P2-1｜soak 采集器小时率 6.03× 低估**（`r16-soak.py:248-256`：`previous=samples[-2]` 的 10 分钟增量除以约 1 小时）。影响：本轮所有引用 `soak-hourly` 的判据（含与 R15 的对比），并因窗口错配制造 2 次假 P0（按 R16 规则每次都会"打断时钟"）。修复在采集器侧，**不需重启 Engine、不需重跑 soak**。
- **P2-2｜UNKNOWN 证据有效期与复审时刻零安全余量**（`reconciliationService.ts:84` 与 `entryRiskOccupancy.ts:127-132` 共用同一上界 ⇒ **99.4%（465/468）复审必然落在证据过期之后**；475 次虚假 UNVERIFIED、22/129 采样 `DEGRADED`，自愈中位 37s）。方向保守，但它是本窗口唯一持续抖动源，并会淹没真信号。
- **P2-3｜提交前精度校验缺失，持续制造永久 UNKNOWN 人口**。2 条新 UNKNOWN 的唯一成因是 `-1111 Precision is over the maximum`（ZECUSDT 16:50:02、TUTUSDT 16:51:36）。fail-closed 记录本身正确，但**订单构造应在提交前按 symbol stepSize/precision 过滤**；这类行同时是 §8 空转探针与 P1-1 悬崖的输入。
- **P2-4｜`WAITING_EXECUTION_CAPACITY` 语义失真**（`appRuntime.ts:1302` 判据为 `executableCandidateCount===0`，却命名"执行容量"；104/104 采样 `used 31–34 < max 50`）。会把"无经济/敞口候选"读成"槽位耗尽"，诱使运维错误放宽 `maxPositions`。
- **P2-5｜`persistence.checkedAt / runtimePersistedAt` 一次性写入**（`settingsStore.ts:1418 seedOperationalMetrics()`）⇒ `integrity:true` 是 21.5h 前的启动读数且**早于窗口起点**，存储完整性在窗口内不可证。
- **P2-6｜WS 层可观测性为零 + 两条死告警探针（复合缺陷，本轮实测损害已成）**：(a) `StreamMetrics.reconnects/gapsByType/backfills/recovery*` 仅进程内 gauge，无事件、无 API 暴露 ⇒ Stage 3 的"WS reconnects"客观不可答；(b) `ENGINE_ERROR`、`STORAGE_PRESSURE` **在本构建无任何发布点**，监控器的对应探针永远不可能触发；(c) 监控器**没有 `primary.status != READY` 规则** ⇒ 20:39 的真实 `RUNTIME_PAUSED` 被静默；(d) `CANDIDATE_LIFECYCLE_REDERIVED` 双写（98.4% 完全相同、`appRuntime.ts:1373` 只消费 `CANDIDATE_LIFECYCLE_CHANGED`）独占非保护分区 77%，把 `POSITION_*` / `MARKET_KLINE_SEQUENCE_*` / `ENTRY_ECONOMIC/ADMISSION` 的有效留存压到 ~7.3h 并**彻底抹除 4 个事件类型**（含 2 条 `AI_RUN_FAILED`）。**⇒ 原列为 P3 的"lifecycle 双写"因损害已被量化而上调为 P2。**
- **P2-7｜`$1` 净利判据的比较基准不完整**：**135/135** 条 CLOSED 交易记录 `fundingAttributionStatus=UNKNOWN`、`pnlBasis=CANONICAL_NET_WITH_FUNDING_UNKNOWN`、`netPnl=null` ⇒ 任何"$1 是否达成"的判定都带未量化误差项；小额组实测 median 仅 $0.466。这使 Stage 8 问 4 目前**不可判定**。

### P3 —— 纯 observability / 性能 / 清理

- `soak-hourly` 与原始日志约 8% 量差（1,827/1,634 vs 1,682/1,487）的 provenance 对齐。
- `sequenceInvalid` 计数器（max 79）与 `MARKET_KLINE_INVALID` 事件（0 次）判据不一致，需澄清何者为真。
- `ENTRY_ORDER_TTL_CLOSED` 对同一 orderId 16 秒内重复发布 2 次（XPLUSDT 17:48:03 / 17:48:19）。
- `EXCHANGE_FILL_ATTRIBUTED` 942 / `ORDER_FILL_RECONCILED` 930 / `TRADE_RECORD_REPAIRED` 949 相对 7 次关闭明显偏高，需核对消费者后决定 summary 化。
- 小时行以 `hourEnd` 为键造成"看起来缺 03:00"的显示歧义。
- `runtime_events` 保护/非保护双分区的保底比例（20,000 那侧被单类型霸占）应可配置。

**明确不予升格**（遵守提示词禁令）：`/order` 请求数仍可降、事件数仍可减、代码仍可美化 —— **均不列 P1**。§8.4 已给出"停止继续优化"的量化理由。

## 17. 下一阶段优化建议：最多 5 项（Stage 14）

**排序原则**：先解除已知硬阻断，再消灭持续抖动源，再补证据完整性，最后才是权限扩大。不预设任何一项"必须实施"。

| # | 优化项 | 问题 → 证据 | 影响 | 风险 | 实施复杂度 | 需重启 | 需改交易语义 | 需重跑 24h |
|---|---|---|---|---|---|---|---|---|
| **1** | **UNKNOWN 审计的"有界回溯 + 终局分类"**：为超过 lookback 的行引入**显式终局态**（保留身份墓碑与原证据，无需再次取得交易所证据即可维持"已验证无活跃风险"），而不是退回 `activeRiskExposure:true` + tier 0 | **P1-1**；`reconciliationService.ts:16/:40/:89`；**09-24 06:40 确定触发**；另有 3 行 >4d；22/129 采样已 `DEGRADED` | 解除 ENFORCE 的永久阻断；消除永久 phantom 敞口与永久 tier-0 负载 | **高**：直接改风险归属语义。不变式必须是"只允许更保守、不允许更乐观"——终局态需绑定 `身份墓碑 + openOrders 全扫 pass + WS 无冲突` 三条件，且需回归 4 次真实出口失效场景 | 中-高 | **是** | **是** | **是** |
| **2** | **UNKNOWN 审计收敛性包（一并做完，避免分次重启）**：(a) `validUntil` 与 `nextAuditAt` 解耦留出安全余量；(b) 把 `-2013 / EXACT_ORDER_NOT_FOUND` 当作可缓存的否定事实（cache TTL 1,500ms → > 2s tick），或让已 `verifiedNoActiveRisk` 的行按阶梯跳过 exact 探针；(c) 提交前按 symbol `stepSize/precision` 与 filters 校验，并把 `-1111` 归为"确定未成单"而非 UNKNOWN；(d) **先归因**那个不受 tier 管辖的常驻行（`remoteFactAuditClass` 对 active 非 UNKNOWN 返回 null ⇒ 永不 defer） | P2-2 / P2-3 / §8.2（1,258/h、23/23 返回 400、cache 1.5s < tick 2s、corr=0.002）/ §9（1,540 条重复只覆盖 30 个 orderId） | 去掉约 30k 请求/日；把 `DEGRADED` 抖动从 22/129 压到接近 0；**从源头停止制造永久 UNKNOWN** | 低-中：全部位于**只读查询与参数构造**路径，不触碰写闸门与风险判定；(c) 需回归 entry/TP 两侧数量与价格格式 | 低-中 | 是 | (a)(b)(d) 否；(c) 仅参数构造 | 是（因需重启） |
| **3** | **观测完整性包（决定下一轮 24h 能不能被相信）**：修 collector 6.03× 小时率；补 `primary.status != READY` 告警规则并把非 RUNNING 的 streak 门槛降为 1 次采样 + 持续时长；**删除或真正实现 `ENGINE_ERROR` / `STORAGE_PRESSURE` 两个死探针**；把 WS `reconnects / gapsByType / recovery*` 发布为事件或 API 字段；`persistence.checkedAt` 周期刷新；修 lifecycle 双写（`universeCoordinator.ts:29-33` 加持仓守卫或 `candidateLifecycleDeriver` 去重发布）；`WAITING_EXECUTION_CAPACITY` 改名或补 `LONG/SHORT headroom` 时间序列 | P2-1/4/5/6；§5 的 20:39 漏报；§6.5 不可测；§14 的 4 类型被抹除与 32% 窗口事件丢失 | 消除"假警报 + 真漏报"并存；把非保护分区从单类型 77% 占用中释放，使 `POSITION_*`/`ENTRY_ADMISSION_*` 具备 24h 可证性 | **极低（对交易语义）**：纯遥测、告警规则与读模型；但"删事件"前必须先核对消费者（本报告 §10 已核对：REDERIVED 无行为消费者） | 低-中 | collector 侧**否**；引擎侧改动可与 #2 合并一次重启 | 否 | **否**（若仅 collector）/ 与 #2 合并时共用同一次 |
| **4** | **HUMAN exposure / capacity 与 PNL 基准的证据化**：为 `maxHumanManagedPositions=4 / maxHumanManagedNotionalPctEquity=0.2` 与实际人工簿 **29 仓 / $9,600.14（超限 7.2×）** 之间的巨大落差建立可审计口径（含 LONG/SHORT 分项 headroom 时间序列）；补齐 funding 归因使 `netPnl` 不再是 135/135 `UNKNOWN`；重建 `capital_epochs`（**当前 0 行**，直接导致 `CAPITAL_EPOCH_VALID` FAIL） | §11 实测；P2-4 / P2-7；§18 的 7 条 blockingReasons；Stage 8 问 2/4 | 使"cap 该不该调、`$1` 该不该留"从**意见**变成**证据**；解除 ENFORCE 前置校验中的三项非风险类 FAIL | 中：**若顺手去放宽 cap 或改 `$1`，就会污染已验证基线** ⇒ 本项定义为"只建立口径与补齐基准，不改参数值" | 低-中 | 视改动位置（多数为读模型/记账） | 记账与归因，**不改风险语义** | 否（若不改参数） |
| **5** | **受控 ENFORCE 正向 Canary（唯一真正解锁权限的一步）** | §11 + 反事实 #10：`passed=true` 端到端**从未被观测**；cap-only 17.8%；`reach≥0.5` 31.1% | 只有它能回答"ENFORCE 的放行侧是否真的可用" | 中：需真实下单。严格沿用两阶段（先 `CUSTOM_SYMBOLS` 白名单 + 实测 0 非 canary entry 事件，之后才 `caps=false + ENFORCE`） | 低（S1–S3 三轮教训已成文） | 否 | 否（不改参数） | 否 |

**前置依赖**：#5 必须在 #1 与 #4 之后 —— 否则 `RECONCILIATION_HEALTHY` 与 `CAPITAL_EPOCH_VALID` 会把 Canary 结果解释成"失败"，而实际是记账缺陷。

### 明确写"暂不优化"（附理由）

- **`/fapi/v1/order` 总量的进一步压降**：1,258/h 仅占总 weight 7.6%，peak 4.7%，新增 429/418 = 0。**以数字为理由的优化停止**（§8.4）。
- **`minHistoricalReachProbability=0.50` 的 out-of-sample 再校准**：四次测量一致收敛于 ~31–33%，**当前不存在支持调参的证据**；调参反而污染 ENFORCE 判据。等 #4 的口径建立后再议。
- **lifecycle / runtime event 的单纯降噪**：REDERIVED 无行为消费者，但**它的修复价值在于释放留存配额（已并入 #3），不在于把数字做小**；除此之外不做额外削减。
- **保护性写入与新增风险写入的 egress gate 分层（R16 候选 A）**：**本窗口证据把它下调** —— `blockedProductionWriteAttempts` 恒 0 意味着 24h 内从未有保护性写入真的被闸挡住。这是**代码里存在、窗口内未发生**的风险；而它是本轮所有候选中唯一要动安全闸的一项，风险最高、实证最薄。**建议与 #1 合并设计**（两者都要改风险归属判定路径），且必须先给出"拆分后的完整安全边界"：允许 risk-reducing 写入穿过未验证出口的前提，是同时具备（i）该写入的目标仓位与 clientOrderId 已被本地 durable 事实证明、（ii）失败可回滚、（iii）审计日志不可缺失。
- **多源出口回声探测（R16 候选）**：仅作为 §7.3 残余设计风险的低优先级缓解项，等 #1/#2 落地后视 15 分钟探测窗口的实际暴露再议。

## 18. ENFORCE 客观结论（Stage 15）

**`NOT_READY`。**

客观 blockers（不含建议、不含主观倾向）：

1. **放行侧从未被观测**：3 轮受控 canary（09-19）0/11、0/8 `passed=true`；本 24h 窗口 45 次 SHADOW 评估 `passed=0/45`。`passed=true → intent → reservation → submit → created → fill` 的完整正向闭环至今**没有任何一次真实样本**。
2. **`/api/v3/auto-readiness` 现网独立列出 7 条 blockingReasons**：`CAPITAL_EPOCH_VALID`（`capital_epochs` 表 **0 行** —— capital epoch 从未建立）、`DAILY_DRAWDOWN_COMPLIANT`、`GROSS_EXPOSURE_COMPLIANT`（实测 100.23%，已超）、`DIRECTION_EXPOSURE_COMPLIANT`（SHORT 62.37% vs 50% 上限）、`EXECUTABLE_CANDIDATES`（=0）、`BINANCE_TESTNET_CONFIRMED`、`NO_FATAL_RUNTIME_CONDITION`（count 11）。**其中至少 3 条与引擎正确性无关，属记账/授权口径未建立（见 §17 候选 4）。**
3. **`RECONCILIATION_HEALTHY` 将在 09-24 起永久 FAIL**（P1-1：`driftCount` 永久 ≥1），使 ENFORCE 前置校验在结构上不可能通过。
4. **授权结构未解除**：`HUMAN_MANAGED_EXPOSURE_LIMIT` 命中 45/45；仅 8/45（17.8%）为 cap 单独阻断 ⇒ 不授予 cap 例外几乎不可能产生放行样本。
5. **`$1` 判据的实证基准不完整**（P2-7：135/135 funding UNKNOWN、`netPnl=null`、小额组实测 median $0.466）⇒ ENFORCE 所依赖的净利地板目前**不可证**。
6. **两类客观不可测**：WS 重连无任何 durable 证据（§6.5）；重启恢复与"出口失效下的保护性写入"在本窗口 0 次触发（反事实 #1/#4）。

**即使后续判定 READY，也仅提出下一轮 Canary 条件、不执行切换**：白名单 `CUSTOM_SYMBOLS=[X]` → 实测隔离（0 非 canary entry 事件）→ 才 `caps=false + admissionMode=ENFORCE`；margin **16–25 USDT**（`$1` 地板在 8x 下最低需 16 USDT）；`maxPositions = entryCapacity().used + 1`（不是仓位数 +1）；样本量 **≥16–20 次尝试**（≈30–40 min）后方可把"无通过"当作证据；PUT 时做事实驱动的重验证（无持仓 / 无 pending / 无活跃 claim / eligible，且目标 symbol 1m/5m/15m `asOf` 在 TTL 内）；预注册统计量**必须在注册时刻落盘**（`runtime_events` 非保护分区实测仅 ~7.3h 有效留存）；判据侧沿用 S3 教训 —— `FINAL_ORDER_RISK_EVALUATED` 发布于 JIT 复检之后，故 `passed=true` + 该事件 = JIT 在实际下单价上接受，而 `ENTRY_ORDER_BLOCKED{stage:BINANCE_SUBMIT}` 无该事件 = JIT fail-closed。**本轮未切 ENFORCE、未改任何参数。**

## 19. V3.9.5 最终收尾裁决（Stage 16）

### `V3.9.5_24H_SOAK` → **`PENDING_WINDOW_INCOMPLETE`**（不得宣告 PASS，亦不得宣告 FAIL）

依据（严格对齐提示词"只有真正连续 24h 且所有硬安全条件满足才能 PASS"）：

- **硬安全条件全部满足**：无真实 P0、`productionWrites=0`、egress 闸 4 次真实闭合、TP 129/129 完整、亏损零自动平仓、无裸仓、无存储完整性错误、无新增 429/418、身份/Settings/模式全程未漂移。
- **但连续窗口仅 21.36h / 24h（88.9%）**。缺的不是"没采到"，而是**时钟本身还没走到 11:59**。以不完整窗口签发 PASS 即为"为 PASS 找证据"，故不签。
- 同时**不构成 FAIL**：窗口未被打断 —— 造成 `soak-interrupted.json` 与 `soak-P0.flag` 的两条 P0 已被证明为采集器竞态假阳性，02:29 的 P1 为基线即存在、中位 37s 自愈、方向保守的探针竞态（§9/§12），**都不是引擎缺陷**。

**收口动作（不需任何代码改动）**：让已在运行的时钟自然走完至 2026-09-21 11:59:00，确认最后 2.64h 无新增 P0/P1 级真实事件，即可基于"§19 硬安全条件全部满足 + 连续 24h 达成"签发 `V3.9.5_24H_SOAK_PASS`。

### `V3.9.5_STABLE_BASELINE` → **建议：冻结代码，但不带"无遗留风险"的含义**

按用户自设规则"无 P0/P1 才冻结"，**本轮存在 P1-1，因此不宣告无条件 STABLE_BASELINE**。同时必须区分两件事，避免把决策做反：

- **应当冻结 V3.9.5 的 application code**（engine/core/contracts 三树已哈希证明等价于 `e70e33e`）。P1-1 与全部 P2 都不要求改动已验证构建、都不要求重启，因此冻结与修复不冲突；继续留在 V3.9.5 内做优化只会污染已证基线。
- **不应当以 STABLE_BASELINE 之名扩大权限**：`admissionMode` 保持 `SHADOW`、HUMAN cap 保持现状、P1-1 修完并重跑 24h 之前不进入 ENFORCE 讨论。

建议裁决文案：`V3.9.5_FROZEN_AS_SHADOW_BASELINE — PASS-pending-clock, authority NOT expanded, P1-1 gating ENFORCE`。

**转 V3.9.6 backlog（本轮一律不动）**：§17 的 5 项 + P3 全部清理项 + §7.3 的多源出口回声探测 + 保护性/新增风险写入分层（待 P1-1 后设计）。

## 20. Codex 异议与替代解释（Stage 21）

以下是本次实测与**既有报告 / 本轮提示词前提 / 我自己早期假设**不一致之处，按用户要求一律以实测为准：

1. **提示词前提"24 小时 soak 已结束"不成立** —— 审计时刻仅 21.36h，时钟要到 11:59 才走完。这不是吹毛求疵：它直接决定能否签发 PASS。
2. **提示词 Stage 9 点名的 `ExitDispatcher` 在本构建中不存在**（`find` 与 `grep` 均无该文件/符号）。真实的可下单面恰好三个：`entryCoordinator.ts:227 placeEntry`、`tpGuardian.ts:15 placeTakeProfit`、`accountExecutor.ts:7 placeManualOrder`；另有人工门控的 `appRuntime.ts:547 → manual.resumeExitGoals()` 2s 轮询器（只能由 `EMERGENCY_CLOSE && confirm===true` 播种，窗口内 0 事件）。安全结论不变（无第二套策略退出链、无自动亏损平仓，且 `LossHandoffService` 在结构上无下单能力），但**审计对象的名称必须改正**，否则后续报告会围绕一个不存在的组件建立"已审计"的错觉。
3. **两条 P0 是假的，而"24h 没事故所以可疑"这个叙述本身也被污染了**：真实情况不是"有事故被掩盖"，而是"监控器把正常时序读成事故、同时对真事故沉默"。**本轮最重要的方法论收获**：一个只检查 `pipelineState` 与计数器阈值的观察者，会同时产生假阳性和假阴性，而两者都表现为"窗口很安静"。
4. **R15 的量化与归因需要更正**（不是否定 R15 的工作）：`/order` 既不是 ~1,700/h（真测 1,258/h），其"一条常驻历史 UNKNOWN 行把端点钉死"的归因也被 **corr = 0.002** 与"全部 deferred 时速率仍 1,265/h"直接否证。**机制（串行、~1.6–1.9s 延迟受限）为真，被钉的对象判断错了。** 由于 R15 也使用同一族遥测，我**推测**其 1,700/h 亦带采集口径误差 —— 但这一点**无法证明**（未复查 R15 当时的脚本），仅作可能性陈述，不写入结论。
5. **"`minNetProfitUsd=1` 近似惰性"在本窗口不成立**（35.6% 命中），且更根本的是**该比较的基准本身缺 funding 归因（135/135 UNKNOWN）**。必须改写为："在实际下单尺寸分布下 `$1` 是活跃约束，但其成效目前**不可判定**"。
6. **"lifecycle 双写"从 R16 的可选项清单里的模糊条目，升级为已证实机理**（`universeCoordinator.ts:29-33` 无守卫写 READY、`candidateLifecycleDeriver.ts:24,37` 再写 POSITION_HELD 并发布；98.4% 载荷完全相同；BTCUSDT 6 分钟 13 条）。它的实际代价是**留存配额被单类型占用 77%**，因此我把它从 P3 上调为 P2 —— 这是对**我自己报告初稿**的更正，不是因为数字大，而是因为损害可计量。
7. **R16 候选 A（保护性/新增风险写入分层）的紧迫性被本窗口证据下调**：`blockedProductionWriteAttempts` 恒 0 ⇒ 24h 内从未有保护性写入真的被闸挡住（上一轮记录到的 03:45 真实案例未在本窗口重演）。它是**代码里存在、窗口内未发生**的风险；把本轮风险最高的一项改动排在首位，证据基础是薄的。
8. **未解决的开放项（拒绝伪装成结论）**：1,258/h 探针的**具体驱动行至今未能归因** —— dispatch ledger 不含 `orderId/symbol`，因此"哪一行在每 2s 被探针扫到"仍是**推断而非测量**。若下一轮要执行 §17 候选 2，第一步是补归因证据（在 ledger 中记录 orderId），而不是先改代码。
9. **一处我无法证实也无法否证的项**：`/brain/diagnostics` 显示近 3h `placeShort:0`，而 21h 窗口有 48 次 `PLACE_SHORT`。由于 3 小时边界无法回溯重建，**不能判断这是真实的时段行为偏移还是口径差异**，留作下一轮观察项，本轮不下结论。

## 附：复现命令清单（全部只读）

```bash
# 窗口/身份/计数器（真值，勿用 soak-hourly 的 *PerHour）
python - <<'PY'
import json
S=[json.loads(l) for l in open('D:/MITS-WORKTREES/dryrun/r16/soak-samples.jsonl',encoding='utf-8')]
f,m=S[0],S[-1]; d=(m['at']-f['at'])/3_600_000
print(m['ts'],'%.2fh'%d, 'req/h=%.0f'%((m['requestsTotal']-f['requestsTotal'])/d),
      'order/h=%.0f'%((m['exactOrder']-f['exactOrder'])/d),
      'writes=%d'%m['writes']['testnetWrites'],
      'blockedAttempts=%d'%m['writes']['blockedProductionWriteAttempts'],
      'identity-constant=%s'%(len(set((s['pid'],s['instanceId'],s['restartCount'],s['buildId']) for s in S))==1))
PY

# P0 时间序裁决：写 vs 闸门关闭
grep -o '"event": *"ENTRY_ADMISSION_\(BLOCKED\|RESUMED\)"[^}]*' \
  /d/MITS/data/runtime-logs/engine-2026-09-20-939b2020-*.jsonl*   # 需 gunzip -c

# 闸门语义（唯一真源）
sed -n 17p /d/MITS-WORKTREES/v395-localci-r16b/apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts   # signed(): 计数仅在闸门之后
sed -n 39p /d/MITS-WORKTREES/v395-localci-r16b/apps/engine/src/adapters/binance/BinanceTransport.ts        # assertTestnetExchangeWrite()
grep -n 'UNKNOWN_RISK_MAX_LOOKBACK_MS\|noActiveRiskEvidence' \
  /d/MITS-WORKTREES/v395-localci-r16b/apps/engine/src/services/reconciliationService.ts                    # P1-1

# 端点归因 / weight
curl -s http://127.0.0.1:8080/api/v3/diagnostics/binance-governance
curl -s http://127.0.0.1:8080/api/v3/pipeline | head -c 2000   # freshMarkets / reconciliation / takeProfit / capacity / runtimeControl
```

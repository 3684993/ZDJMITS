# ZDJ-MITS V3.9.2 运行效率、存储与限流整体优化实施计划

基线：`4cf9f95b9163aa537a49ef281eda9d2d2937bc6d`
优化分支：`gpt56-optimize-v392-20260912`
环境：Binance Futures Testnet

## 目标

不重构已经验证可工作的交易框架，只做减法和可观测性增强：降低 Binance REST、WS retention、AI 空转、SQLite 写放大、重复旁路工作和 Dashboard 副作用，同时保留 Preflight、Reservation、Risk、Final Guard、Exactly-once、Private Sync、Reconciliation、TP Guardian、RequestBudget 等安全机制。

目标主链：

`Market/WS → Deterministic Admission → Executable Candidate → [optional 9B Scout] → 27B Primary → Final Execution Guard → Maker → Exactly-once Entry → Fill → TP`

## 已确认事实

- 2026-09-12 19:03:04～21:51:04 连续运行，最终因新的 Binance HTTP 418 主动停机。
- 418 时间 21:41:50.427，Binance 报告 banned IP `15.158.242.74`；此前启动验收记录的新加坡代理出口为 `172.104.186.174`，出口身份不一致必须纳入启动验收。
- data 28.95GB；backups 18.95GB；当前 SQLite 10.44GB。
- SQLite WAL 约 19.8MB，freelist 仅 149 pages，10.44GB 不是 WAL/空闲页假膨胀。
- 最大逻辑数据：runtime_events 3.768GB / decision_chains 1.749GB / decision_snapshots 1.592GB / ai_runs_archive 1.111GB / runtime_entities 0.293GB。
- runtime_events 共 4,070,108 rows；其中历史 SHADOW_SAMPLE_RECORDED、POOL_UPDATED、POSITION_LIFECYCLE_TRANSITION 等写入量巨大。
- 当前源码已经把一部分 telemetry 排除出 runtime_events，但大量历史数据仍存在；非 telemetry 的 UNCHANGED lifecycle、AI事件等仍有进一步收敛空间。
- 9B External Research 持续运行，但当前 Entry 直接 `ai.decide(packet, null)`，真实 Entry Scout 为 0。
- 27B Primary 可自然形成 PLACE→Intent→Order→Fill→TP，但 WAIT material trigger 可能过于敏感。
- Dashboard `GET /positions/:id` 当前可能通过 `market.candles()` 访问 provider，违反 Dashboard read-only 目标。
- Luna运行采样曾见 usedWeight1m=2958、queue=14；最终仍发生418。418前5分钟 Private Sync、Reconciliation、Market refresh 等多个 timer 并行，但现有日志缺 endpoint/source/weight admission 级归因。

## P0：下一次启动前必须完成

### P0-1 Binance Dispatch 可审计化与统一预算入口

所有 Binance HTTP 请求必须经过唯一 Transport/RequestBudget 准入点；为每个 dispatch 记录：

- requestId
- environment
- endpoint/path
- method
- source/service
- caller/purpose
- estimatedWeight
- observedUsedWeight1m（response header）
- localEstimatedUsedWeight1m
- queueDepth
- priority
- budgetDecision（ADMIT/QUEUE/BLOCK/RECOVERY_PROBE）
- HTTP status
- Retry-After
- blockedUntil
- durationMs

任何没有 source/purpose 的 Binance dispatch 在开发/测试阶段视为缺陷。

### P0-2 出口身份约束

- RequestBudget persistence key 不再只有 TESTNET/PRODUCTION；至少包含 execution environment + configured proxy identity/egress identity。
- 启动验收记录 expected/observed egress identity。
- 若配置了固定预期出口且观测不一致，Private Entry fail-closed；只读 Dashboard/本地状态仍可工作。
- 418/429 payload 中的 Binance-observed IP 必须记录并与本轮 egress identity 对比。
- 禁止把旧IP的 cooldown 无条件迁移到新IP，也禁止在同一未知/共享IP上通过删除状态绕过 cooldown。

### P0-3 Exchange request lane 收敛

当前独立 timer 包括 Private Sync、Reconciliation、TP、Market recovery/slow fields、LiveValidation 等。保留业务职责，但所有 REST 工作进入中央 lane：

1. EXECUTION_CRITICAL：order query/submit/cancel、TP
2. PRIVATE_STATE：account/positions/openOrders
3. RECONCILIATION
4. MARKET_RECOVERY
5. BACKGROUND_VALIDATION

高优先级仍必须遵守 hard weight；低优先级在 weight 高水位自动延后。禁止多个 timer 在同一15秒边界同时直接打 REST。

## P1：存储治理

### P1-1 retention policy

建立集中 `StorageRetentionPolicy`，所有历史表必须有明确用途、保留期和压缩方式。

建议基线（实施前用测试验证依赖）：

- `runtime_events`
  - 交易关键事件（order/fill/TP/manual/critical failure）：保留 90 天或转入轻量审计表。
  - 普通运行事件：保留 7 天。
  - 高频 telemetry：不进入 lossless DB；聚合到 heartbeat/counter。
- `ai_runs_archive`
  - 完整 raw prompt/output payload：7 天。
  - 结构化 summary columns：90 天；过期后清空大 payload，而不是失去 summary。
- `decision_chains`：完整链 14 天；长期统计由 `decision_episodes`/summary 承担。
- `decision_snapshots`：完整快照 7 天；长期只保留 outcome/feature summary。
- `decision_episodes`：90 天或更长，保持紧凑。
- `runtime_entities`
  - 只保留 active/current state 和有界最近历史。
  - completed `aiRuns` 不允许无限累积在 runtime checkpoint。
- `shadow_mark_series`：维持有界 retention；不得无限增长。
- `external_research_tasks`：completed/failed 7 天，长期仅保存结构化研究统计。

### P1-2 消除写放大

- `POSITION_LIFECYCLE_TRANSITION=UNCHANGED` 改 telemetry counter，不持久化为业务 transition。
- `CAPITAL_ROUTE_EVALUATED` 对事实 fingerprint 去重；无变化不重复写大 payload。
- `CANDIDATE_LIFECYCLE_CHANGED` 同状态/同上下文去重。
- `AI_RUN_STARTED/COMPLETED/FAILED` 与 `ai_runs_archive` 避免双份完整 payload；runtime event 只保留最小元数据。
- runtime checkpoint 不应重复保存可从专表恢复的大型历史数组。

### P1-3 历史数据库安全清理

先修源码防止重新膨胀，再执行一次性 cleanup。

顺序：

1. Engine保持停止。
2. `PRAGMA integrity_check` 当前 DB 与最新有效 backup。
3. 保留一份确认可恢复的 pre-cleanup backup；确认另一份不是唯一证据后删除/压缩。
4. cleanup 工具先 dry-run，输出每表将删除/压缩的 row/bytes。
5. 按小批 transaction 删除/压缩过期历史，避免长事务。
6. 完成后 integrity_check。
7. 使用 `VACUUM INTO` 生成 compact DB，而不是直接覆盖原文件。
8. 对 compact DB 再 integrity_check + schema/关键row验证。
9. 原子替换数据库。
10. 保留短期 rollback copy；验收通过后按 retention 清理。

目标不是固定某个绝对大小，但 active DB 应从 10.44GB 大幅下降，且持续运行增长率可预测、有上限。

### P1-4 backups

禁止版本/重启时无限复制整个10GB DB。

- 自动备份必须有 max count + max age + max total bytes。
- pre-migration backup 与日常 backup 分离命名。
- 正常运行只保留少量、可验证的一致性快照。
- DB 已收敛后再生成新基线 backup。
- backup 清理必须保留至少一个最近、完整、通过 integrity_check 的恢复点。

## P1：Market / Pool / WS

### P1-5 retention owner 可解释

任何 retained symbol 必须能够回答 owner：

`POSITION / ACTIVE_ENTRY / WAIT / COHORT / BTC_ETH_CONTEXT / RECOVERY`

Dashboard/diagnostics 暴露：symbol → owner(s) → subscribed streams → last used at。

### P1-6 供给充足时停止扩张

当 dispatch-ready >= readyLowWatermark 且没有 stale rotation 必要时：

- 不主动 refill/hydrate 新 symbol；
- refill 只在真实 supply shortage、消费、过期或质量淘汰时触发；
- protected owner 不占 reusable cohort inventory；
- WS subscription 应与 retention owner 同步释放。

验收禁止再次出现“50 snapshots/253 subscriptions，但实际ready只有5～7且没有明确owner理由”的不可解释状态。

## P1：Dashboard read-only

- `GET /positions/:id` 不得直接 provider REST 拉 candles。
- UI detail 只读 runtime cache / 本地 candle cache / SQLite。
- 若本地没有数据，返回 `DATA_NOT_CACHED` 或部分数据，不因为浏览页面访问 Binance。
- 对所有 GET API 建测试：调用前后 Binance transport request count 必须不增加。

## P1：AI利用率

### P1-7 WAIT event gate

WAIT_FOR_PRICE 后不允许周期性重新问 Primary。

只有以下事件可重新进入：

- 明确 price trigger；
- 新15m closed bar；
- 定义清晰的 material change；
- WAIT expiration 后重新资格审查。

1m/5m轻微 fingerprint 翻转不能自动等价为 material change。增加 debounce/hysteresis，并记录 waitTrigger → subsequent Primary provenance。

### P1-8 9B职责二选一

优先方案：真正 Candidate Scout。

`Executable Candidate → 9B ScoutAnnotation → 27B Primary`

9B只输出：关键证据、反证、缺失事实、attention/quality，不授权交易，不生成下单价格。

如果A/B验证不能提高27B效率/质量，则关闭高频local-market External Research，改成真正外部事件驱动研究。

禁止继续“9B持续高频工作但Entry没有消费者”。

## P2：旁路服务和UI效率

- Temporal 从独立15s polling 改成订阅共享 market/runtime facts；页面读取缓存。
- Dashboard Snapshot 使用 version/delta/conditional fetch，避免多个页面重复序列化整个大对象。
- Memory/Temporal/Intelligence 只有新事实才计算/写盘。
- Operational monitor 与 trading audit 分离；monitor只记录变化/告警/heartbeat。

## AI Decision Quality Scorecard

不让AI管理仓位，仅离线评价 Entry 决策。

对每个 PLACE/WAIT/NO_DIRECTION_EDGE 记录：

- context fingerprint
- direction/confidence
- idealPrice/range
- Maker/Fill
- 5m/15m/30m/1h return
- MFE/MAE
- TP reachability/命中耗时
- invalidation
- WAIT是否得到更优价格

30～50自然Fill后评价27B；如启用9B Scout，做 `with-scout vs without-scout` A/B。

## 清理后测试矩阵

必须通过：

- typecheck/build/all tests
- storage retention unit tests
- cleanup dry-run / idempotency / crash recovery
- compact DB integrity + reopen test
- Dashboard GET zero-Binance-request tests
- RequestBudget endpoint/source attribution tests
- 418/429 simulation + durable recovery tests
- proxy/egress mismatch fail-closed tests
- private/reconciliation/TP concurrency tests
- WAIT trigger debounce tests
- cohort/retention ownership tests
- 9B optional/offline不影响27B安全交易

## 再启动 Testnet 验收条件

禁止在以下条件完成前重启交易 Engine：

1. 418 dispatch attribution 已实现；
2. egress identity 可观测且符合预期；
3. SQLite retention + cleanup 已实现并验证；
4. 至少一个有效 rollback backup；
5. Dashboard GET 不增加 Binance REST；
6. Pool/WS retention owner 可解释；
7. RequestBudget simulation PASS；
8. 全量测试 PASS。

启动后第一阶段只做受控 Testnet：

- 30分钟：0个418/429；REST queue可恢复；Private/Recon/TP READY。
- 6小时：无持续weight堆积；SQLite增长率可控；WS retention稳定；自然交易链完整。
- 30～50 Fill：AI quality scorecard 正式验收。

## 明确禁止

- 不为了成交率降低门槛或强制PLACE。
- 不删除 Final Guard / Reservation / Reconciliation / TP。
- 不通过删除 cooldown 文件绕过同一出口IP的 Binance ban。
- 不直接对10.44GB原DB盲目 VACUUM。
- 不把 data、SQLite、backups 提交 Git。
- 不再做大范围架构重写。

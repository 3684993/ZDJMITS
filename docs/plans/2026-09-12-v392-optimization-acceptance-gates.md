# V3.9.2 Runtime Optimization Acceptance Gates

优化版不得以“能启动”作为通过标准。以下全部是启动前/运行期硬验收门。

## A. 启动前

- `npm run verify` 全绿。
- Engine 停止时原 DB `PRAGMA integrity_check=ok`。
- storage cleanup 必须先 dry-run，并明确预计删除行数/保留窗口。
- 至少一个恢复点完成 SQLite integrity_check；未验证 recovery point 禁止 apply cleanup。
- Compact DB 使用 `VACUUM INTO`，独立 `integrity_check=ok` 后才允许人工原子替换；脚本不得直接覆盖原 DB。
- Production write boundary 测试必须为 0。

## B. Binance / 限流

- 每个 HTTP dispatch 可看到 `requestId/source/endpoint/estimatedWeight/priority`。
- Budget scope = environment + routeIdentity；不同代理/直连不共享 ban state。
- `usedWeight1m >= hardWeight` 时状态绝不能为 AVAILABLE。
- 背景/Market 请求在 soft ceiling 排队；Private/Order/TP 仍保留关键 lane，但所有 lane 都服从 hard ceiling。
- 429/418 后只允许 single recovery probe；3次成功后才 AVAILABLE。
- 418/429 body 中若存在 banned IP，必须保存为 `lastObservedBanIp`。
- 如果 observed weight 与本进程 estimated weight 长时间显著不一致，标记共享出口/旁路风险并暂停新增 Entry。
- Testnet 长测目标：418=0、429=0。

## C. Market / Pool / WS

- retention owner 对每个订阅 symbol 可解释。
- WS subscriptions 应接近 `5 * retainedSymbols + global streams`，不得单调泄漏。
- ready supply >= low watermark 时，不因 cohort target gap 继续 hydrate 新币。
- refill/recovery 使用 single-flight + backoff。
- Market error 不得触发全局并发恢复洪峰。

## D. AI

- WAIT_FOR_PRICE：1m/5m trend 噪声不得重新唤醒 Primary。
- WAIT 重进只允许 price trigger / 新15m闭合或15m实质状态变化 / expiry。
- 当前 `feedToPrimary=false` 时，本地 market-change 不得制造9B research任务。
- 外部新事件研究可继续，但必须可看到 consumer provenance；长期 consumer=0 后续自动降频。
- 27B Schema失败不得被 parser 改造成 PLACE。
- PLACE方向仍受15m角色与 allowedDirections 硬校验。
- AI质量至少50个自然PLACE后才形成初始评分；不得为了样本降低门槛。

## E. 存储 / 日志

- 高速 telemetry 不进入 lossless `runtime_events`；使用 heartbeat/counter聚合。
- Entry/Order/Fill/TP/Manual/Exchange fill 等关键交易审计仍保留。
- 历史 cleanup：telemetry 1d、ordinary runtime 7d、critical audit 90d；decision snapshot 7d；chain 14d；AI full payload 14d，compact summary 90d。
- DB 每小时/每天增长必须有 bytes/hour 可观测值；异常增长可触发 Entry fail-closed before disk critical。
- backup 有 count/age/total-byte 上限；不再无界保存完整10GB副本。
- 目标：清理后 active DB 显著低于当前10.44GB，并在24h长测中不呈线性GB级增长。

## F. UI / 旁路

- GET dashboard route 不允许增加 Binance transport request counter。
- Temporal research 不写 live DB；当前实现保持隔离 worker/offline-only语义。
- Monitor 不直接调用 Binance。
- UI大型 snapshot 后续采用 version/cache/delta；不得影响 Engine event loop。

## G. 交易安全

以下机制必须保留：

- Preflight deterministic admission
- post-AI direction/capacity validation
- allocation + reservation
- live risk envelope
- final execution hard block
- stable clientOrderId + exactly-once recovery
- Private freshness
- Reconciliation verified facts
- TP Guardian
- Production write lock

任何“性能优化”若绕过上述机制，验收直接 FAIL。

## H. 长测门槛

### 2小时冒烟
- 418/429=0
- Private READY
- Reconciliation drift=0
- TP protected=required
- queue 无持续堆积
- DB/日志增长率无异常
- no production write

### 6小时持续
- 以上全部持续成立
- WS无不可解释subscription增长
- 每个retained symbol有owner
- 9B/27B调用量有消费者/候选原因
- WAIT重复唤醒显著低于旧基线
- REST source/endpoint weight分布可完整解释

### 交易质量
- 不要求强制Fill
- 达到30~50自然Fill后评估 MFE/MAE、方向收益、TP/失效先后、confidence calibration

# V3.9.5 停机前最近 10 小时运行审计证据

生成时间：2026-09-23 07:27:51（UTC+8），审计窗口 2026-09-22 21:27:51 → 2026-09-23 07:27:51（UTC+8）。
运行实例：`939b2020` / PID 10540 / 版本 3.9.5 / buildId `3.9.5-8b7cc98ccaaa6c06456c` / 连续运行 67.7 h。

## 采集方式（全部只读）

- `data/zdj-settings.sqlite` 以 `DatabaseSync(..., { readOnly: true })` 打开。WAL 模式下只读连接不加写锁、不触发 checkpoint 截断，运行中的 Engine 不受影响。
- 只读 HTTP：`/health`、`/api/v3/pipeline`、`/api/v3/diagnostics/supply`、`/api/v3/positions`、`/api/v3/orders`、`/api/v3/settings`、`/api/v3/trade-records`、`/api/v3/diagnostics/private-sync`、`/api/v3/diagnostics/binance-governance`、`/api/v3/diagnostics/closeout`、`/api/v3/ops/runtime`。
- 未启动、未停止、未重启、未热重载 Engine；未修改 Settings 或数据库；未向交易所发出任何请求（读或写）——所有交易所事实来自 Engine 已有的只读投影。
- 证据中不含 API key、secret、签名、代理地址或出口 IP；只保留 `credentialRef` 名称与环境标识，用于确认 Testnet 身份。

复现：`node gen-evidence.mjs <输出目录>`（需 Engine 正在运行且可访问 `127.0.0.1:8080`）。`oscillation-probe.mjs` 复现 §停机判据 中的抖动观测。

## 文件

| 文件 | 内容 |
|---|---|
| `timeline-hourly.json` | 逐小时事件矩阵（按层分组）、每类事件窗口内首次/末次时间、`runtime_events` 留存完整性、事件循环存活双读数证明 |
| `ai-silence-verdict.json` | 04:55:28 之后 AI 静默的根因裁决、逐假设 `CONFIRMED / CONTRIBUTING / RULED_OUT`、风险余量算术、驾驶舱文案来源与代码行号 |
| `trade-and-position-summary.json` | 窗口内开平仓、持仓与浮盈亏、费用/funding 证据状态、订单与 UNKNOWN 清单 |
| `observability-fact-inventory.json` | 已存在的可观测事实 vs 缺失事实（最后一次 AI 请求/成功/进入 AI/连续失败/模型健康/调度 heartbeat） |
| `stopline-samples.json` | 停机判据的三次采样原始值（UNKNOWN 订单无风险证据 TTL 抖动的直接证据） |
| `stopline-snapshot.json` | 停机前身份冻结、环境身份、风险快照与 A2 判据结论 |

## 留存完整性（影响计数的解释）

`runtime_events` 由 `storageCapacityGuard.maintainStorageBounds()` 按 `criticalRuntimeEvents=50000` / `nonCriticalRuntimeEvents=20000` 修剪，且只删最旧行。当前表 70,000 行，非关键类最早一条为 2026-09-22 18:49:41（早于窗口起点 21:27:51），因此**窗口内的事件计数是完整值，不是下界**；同时窗口内 04:56 之后的空档不可能是修剪造成的（修剪不会删掉较新的行）。

## 停机判据口径

单次读取 `reconciliation.activeRiskUnresolvedCount` 不能用于放行停机：UNKNOWN 订单的"无活跃风险"证据带 TTL（`unknownRiskEvidenceTtlMs=300000`）并按 5/15/30 分钟阶梯重审，因此该值会在 0↔1 之间抖动（`stopline-samples.json` 与 `oscillation-probe.mjs` 均记录到）。本证据改用三条同时成立的事实：`capacity.inFlight` 恒为 0、全部 46 笔非终态 Entry 订单在每次采样中都带 `VERIFIED_NO_ACTIVE_RISK`、且 29 笔持仓全部有交易所侧 `WORKING` 止盈单。

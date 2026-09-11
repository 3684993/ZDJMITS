# V3.9.0 收尾验收报告

状态时间：2026-09-09 20:18（Asia/Shanghai）。本报告是证据化收尾，**不是实盘准入或引擎生命周期指令**。

## 结论

隔离存储压测、自然 LONG/SHORT 方向守恒、部分/完整成交、追价、TTL 撤单回收、UNKNOWN 恢复、TP 与对账均有通过证据。V3.9.0 仍不能宣称完全收尾：20 池的历史观察未满足连续闭合 K 线新鲜率 ≥99%，24 小时与 100 生命周期样本仍不足，生产准入继续禁止。

未做事项：未启动、停止、重启或热重载 Engine；未强制 PLACE；未改变现有仓位或 TP；未扩大除已授权 `maxPositions=50` 外的风险限制；未解锁生产写入。

## 源码 / 构建 / 进程基线

| 项目 | 结果 |
|---|---|
| 进程 | PID 8044，`node.exe D:\\MITS\\apps\\engine\\dist\\main.js`，2026-09-09 14:46:35 启动，`MANUAL_START` |
| 监听 | `0.0.0.0:8080`（仅确认监听，不代表 HTTP 健康） |
| 版本 / build | `3.9.0` / `3.9.0-ced174726ecf9fc9205c` |
| artifactHash | `ced174726ecf9fc9205cfc1330ac00c6006b3819015944548fd7912a35351d5a` |
| sourceHash | `9e0370f89af7ef93f32acb01786bbff39091cba1deef19091d4735fa8828f60a` |
| 现场重算 | artifactHash 与 sourceHash 均与运行身份文件一致 |
| 设置回读 | SQLite settings v92；`portfolio.maxPositions=50`；审计 `12 → 50`；环境 TESTNET |
| 测试基线 | 用户提供的最新事实：319 项测试与 verify 已通过；本轮没有源码改动，未重复执行。旧 `v390-admission-summary.json` 的 318 计数属于较早快照。 |

## 隔离存储压测：PASS

`docs/reports/v390-admission-soak.json` 已为 `COMPLETE`：

- 时长 7,200,986.83ms（超过两小时）
- 270,160 events、6,754 critical
- failures=0、droppedOperational=0、writeFailures=0
- checkpoint 435,917 bytes / 54ms；checkpoint P99 103.54ms，audit P99 9.35ms，event-loop P99 68.81ms
- 隔离目录、生产写入=0、交易所调用=0

## 在线自然样本：通过部分

| 验收项 | 证据 | 状态 |
|---|---|---|
| SHORT 方向守恒及完整成交 | BULLAUSDT 15:06:16 PRIMARY/normalized 均为 `SHORT`；订单 `SHORT`，clientOrderId `ml_0ffdaaf22add35f89e1b5b693545`；15:06:21 部分成交 71/4203，15:06:22 FILLED 4203，随后 `ENTRY_FILLED`。 | DONE |
| LONG 方向守恒与部分成交 | TAOUSDT 的入场订单为 `LONG`；同一 clientOrderId 的部分成交从 0.35 递增至 0.57。 | DONE |
| Maker/追价 | BULLAUSDT post-only 在 0.07724 被拒后只追至 0.07725；全运行记录 9 次 `ENTRY_ORDER_REPRICED`。 | DONE |
| TTL 撤单与容量回收 | 全运行记录 18 次 `ENTRY_ORDER_TTL_CLOSED`，取消终态记录 `occupancyReleased=true`。 | DONE |
| UNKNOWN/恢复守恒 | 3 次 remote-status-unverified；示例 FETUSDT 未释放占用，随后恢复为 `PARTIALLY_FILLED`。 | DONE |
| TP 与对账 | 最新日志对账：21 positions、21 exchangeOrders、drift=0、orphanTp=0、verifiedOrderFactMismatch=0、activeEntryOrders=0、activeReservations=0。 | DONE（日志范围） |
| P0 五项 | 91 个在线观察样本中 cross-symbol、active-remote/new-primary、unverified-terminal/released、brain attribution、verified-order-fact mismatch 的最大值均为 0。 | DONE（观察范围） |
| 私有数据 | 当前日志仍有成功 private sync；最近一笔 643ms，随后继续对账。 | DONE（日志范围） |
| 9B/27B 事实提取 | 9B 处于 `WAITING_SHARED_EVENT`；27B 持续自然分析/提取事实。无空跑或人为造样本。 | DONE（观察范围） |

## 未通过 / 阻塞

1. **启动窗口说明。** 早期 PowerShell HTTP 客户端超时不是服务端无响应；原始 TCP 直连 LAN 地址确认 `/`、`/api/v3/snapshot`、`/api/v3/diagnostics/storage` 均为 200。新手动实例在 bootstrap 中 `/health` 返回 503/STARTING；其后 `RUNTIME_STARTED` 出现，`/health` 为 200、`ready=true`，耗时约六分钟。不要在此窗口重复启动。
2. **20 池闭合 K 线连续新鲜度 PENDING。** `v390-online-observation.json` 91 样本的池数始终为 20、fully fresh 池为 20，但全局 K 线新鲜率最低 58.86%，最高 100%，不符合连续 ≥99% 的门槛。
3. **24h/100 生命周期 PENDING。** 现有自然样本不足；不得靠强制交易或扩大风险补齐。
4. **生产准入 BLOCKED。** 仍为 TESTNET，未进行生产账户/密钥隔离、资金/风险与退出规则的专项只读核验，也未获得生产写入授权。

## 后续动作

在用户单独授权的维护窗口中，先用独立数据目录和端口复现 HTTP 无响应并定位原因；修复后运行必要回归及 verify，并经明确人工启动后再进行新的在线验收。不得通过重启、热替换 dist、清仓、取消既有 TP、强制 PLACE 或解锁生产来“获得通过”。

# ZDJ-MITS 运行故障预测与预防登记表

用途：V3.9.x 后续实现和验收必须覆盖这些“尚未发生或尚未完整证明”的故障。原则是提前观测、局部降级、Entry fail-closed，持仓/TP维护尽可能继续。

| 预测故障 | 早期信号 | 预计影响 | 自动处理 | Entry |
|---|---|---|---|---|
| Binance 出口IP漂移/代理旁路 | routeIdentity变化；418 reported IP 与 expected egress 不一致 | 本地预算与真实IP预算失配，突然418 | 标记 EGRESS_MISMATCH；暂停新增Entry；保留Private/TP最低必要请求 | BLOCK |
| 同出口被其他进程/应用共享 | Binance observed weight 显著高于本进程 estimated weight | 无法靠进程内预算完全控速 | externalWeightGap 告警；背景REST全部暂停；只保留关键lane | BLOCK/RECOVERY |
| Binance endpoint权重规则变化 | 单请求后 usedWeight 增量持续高于 estimate | 预算系统低估 | endpoint estimator discrepancy；自动使用 observed multiplier | BLOCK background |
| 429 后重试风暴 | queue突增、多个timer同时恢复 | 429升级418 | durable cooldown + single recovery probe + jittered release | BLOCK |
| SOCKS/DNS误路由 | TLS SNI/目标host异常、证书不匹配 | WS/REST冻结或错误主机 | fail-closed；禁止fallback direct | BLOCK |
| User Data ListenKey失效 | WS auth流断开、Private事件长时间不更新 | fill/position事实延迟 | 单例续期/重建；Reconciliation低频兜底 | BLOCK until fresh |
| WS订阅泄漏 | subscribed symbols > retention owners；subscription持续单调增长 | 内存/网络/解析负担，行情延迟 | owner reconciliation；释放无owner symbol | ALLOW if fresh |
| Pool refill震荡 | refill/failed/deferred高频，ready长期高于low watermark | REST/WS浪费 | ready充足时停止扩张；失败退避 | ALLOW |
| Market stale recovery风暴 | MARKET_SYMBOL_ERROR/recovery failed集中增长 | REST洪峰 | per-symbol exponential backoff + global recovery budget | affected symbols BLOCK |
| Private Sync 与 Reconciliation重复获取相同事实 | 同endpoint短窗重复source | REQUEST_WEIGHT浪费 | shared private snapshot/cache；single-flight | ALLOW if fresh |
| Position detail/UI触发交易所请求 | GET API导致 transport counter变化 | 浏览UI影响交易预算 | GET zero-exchange contract test | ALLOW after fix |
| SQLite快速膨胀 | DB日增长超过阈值；event bytes/hour异常 | 磁盘满、checkpoint延迟、启动变慢 | retention + telemetry aggregate + storage alert | BLOCK before disk critical |
| WAL异常增长 | WAL超过阈值且checkpoint长期失败 | 磁盘/锁问题 | checkpoint诊断；禁止盲删WAL | DEGRADED |
| 磁盘空间不足 | free disk <10GB 或 <10% | SQLite写失败、审计丢失 | 先停止非关键写入/Research；Entry fail-closed | BLOCK |
| Backup复制放大 | backup total > cap 或单次复制巨型DB | data目录再次20GB+ | count/age/total-byte retention；只保留已验证恢复点 | ALLOW |
| cleanup中断 | cleanup process crash / compact DB incomplete | DB一致性风险 | 原DB不覆盖；VACUUM INTO；integrity_check 后原子替换 | Engine stopped |
| runtime checkpoint过大 | checkpointBytes持续增长 | 1s checkpoint写放大 | active-state only；历史专表恢复 | ALLOW then degrade |
| AI 9B研究无消费者 | research runs增长但 consumer provenance=0 | GPU/CPU/DB空耗 | 自动降频/停local-market research | ALLOW |
| Scout阻塞Primary | 9B latency/error导致Candidate停滞 | Entry频率下降 | Scout optional timeout/fail-open-to-primary（不降低Primary安全门） | ALLOW Primary only |
| Primary 27B拥塞 | queueMs/latency持续上升 | Candidate过期、价格失真 | context去重；expired candidate不排队；单flight | ALLOW bounded |
| WAIT唤醒震荡 | WAIT→Primary间隔过短且无15m/price material trigger | 推理空耗 | 15m/price event gate + hysteresis | ALLOW |
| 模型Schema漂移 | AI_SCHEMA_INVALID连续增长 | 无法形成Intent | circuit + fail-closed；禁止parser强行造交易字段 | BLOCK candidate |
| 模型上下文超限 | token utilization逼近窗口、请求失败 | Primary不可用 | compact facts；固定token预算；拒绝无界历史注入 | BLOCK candidate |
| AI健康探针过密 | probe requests增长 | 本地模型无意义负载 | health cache / backoff / state-change only | ALLOW |
| 15m事实与1m/5m职责反转 | PLACE方向与15m不一致 | 策略语义破坏 | deterministic role guard 保留 | BLOCK decision |
| EIP证据时间穿越/未来时间 | timestamps > now | 错误决策 | freshness/time-bound validation | BLOCK candidate |
| BTC/ETH全局上下文stale | regime context超龄 | 方向背景失真 | context advisory stale标识，不伪造fresh | candidate policy |
| Reservation泄漏 | RESERVED长期无intent/order | 容量虚占 | TTL + owner reconciliation | block affected capacity |
| Exactly-once身份丢失 | SUBMITTING/UNKNOWN无稳定clientOrderId | 重复订单风险 | stable clientOrderId + query-before-retry | BLOCK retry |
| PostOnly -5022循环 | retry次数>1 / quote未刷新 | 请求浪费/价格追逐 | bounded one retry；否则回WAIT | ALLOW later |
| TP Guardian事实分叉 | position无TP / local protected但remote无单 | 裸仓风险 | remote verify；repair；Entry可按protection policy暂停 | BLOCK new Entry if required |
| Reconciliation误删本地事实 | remote timeout被当作empty | 仓位/订单状态错误 | UNKNOWN != empty；verified fact only | BLOCK |
| 时间偏差/NTP异常 | server offset突变、recvWindow错误 | signed请求失败 | cached time with jump detection；Entry暂停 | BLOCK |
| Production边界回归 | productionWrites>0 / env不一致 | 严重安全事故 | hard testnet write lock + CI test | FATAL BLOCK |
| Dashboard snapshot巨大/轮询风暴 | serialization ms、response bytes、GET QPS上升 | Node event loop延迟 | versioned snapshot/delta/conditional fetch | ALLOW |
| Temporal/Memory旁路抢资源 | 无新事实仍持续CPU/SQLite增长 | 主链延迟 | event-driven; unchanged no-op | ALLOW/degrade |
| 日志本身成为IO瓶颈 | logger queue/drop/write latency增加 | event loop/磁盘压力 | bounded async logger + aggregate + rotation | ALLOW critical audit |
| 监控任务失效 | monitor sample stale >2 periods | 失去告警 | monitor self-staleness; OS task状态独立检查 | ALLOW but alert |

## 验收原则

1. 每项故障必须至少具备：可观测信号、明确状态、恢复条件。
2. “READY”只能表示事实满足，不允许没有数据却显示READY。
3. Dashboard/monitor故障不能反向制造交易所请求风暴。
4. Entry可以停止；持仓事实、TP保护和必要对账不能因Entry停止而停止。
5. 所有自动恢复必须有 single-flight/backoff，禁止多个timer同时洪峰恢复。
6. 任何降级不得通过强制PLACE、伪造方向、降低证据门槛获得“活跃度”。

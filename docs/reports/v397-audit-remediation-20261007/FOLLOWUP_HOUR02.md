# 第2小时：私有事实持续失效，稳定性未通过

冻结窗口18:41:16–20:43:12 +08:00：123份样本、2.032296h；尚不足6h/12h，但已PROVEN事实层不稳定。与首小时相同实例，未合并旧失败窗口或隔离候选。

| 事实 | 累计结果 | 证据边界 |
|---|---|---|
| private | READY75 / 明确UNAVAILABLE26 / 观测缺失22；年龄最大1231684ms、p95931655ms | 明确不可用增加23份，不能把22份缺失也写成私有失败 |
| NET-002 | 36份样本活动（首小时9份） | 是样本活动数，不是事故次数 |
| queue | 105份样本活动；admitted3616、queued6508、queueTimeout2883 | route全请求aggregate增量，非全是关键请求 |
| 本机HTTP | health/closeout/governance各22次读取超时；间隔max74.191s，无>90s | 有观测缺口；不能证明连续零故障 |
| TP诊断 | missing12、qtyMismatch1、orphan22份；22份缺失 | 私有/对账陈旧时不能把local protected数当成远端复核 |
| Production | 可见101份均0，未知22份 | 完整窗口零写仍有缺口；TESTNET runtime自然写入是既有服务行为 |
| F07/F08 | 182个不同未验证Entry身份；激活379/恢复378 | 轮转可见、当前恢复次数未见旧历史放大；边界差1不算bug |
| 自然TP | TP_PROTECTED4、TP_REPAIR_FAILED6、孤儿FILLED收敛2 | F02 lost-ACK CANCELED/EXPIRED/REJECTED自然验收仍UNKNOWN |

20:44:05额外当前快照：health DEGRADED，private UNAVAILABLE且consecutiveFailures25、age1283036ms（21.38分钟），错误Proxy connection timed out。TP DEGRADED：required9/protected9、orphan1；此protected值不能当作已实时复核。Production0，TESTNET锁定。该当前快照不纳入冻结123份统计。

8080/collector及8081/8083/8084 PID、创建时间保持原值；SSH40308/本地20091仍监听，stderr尾部为空。监听/进程存活不能证明隧道或远端访问正常，外部网络根因UNKNOWN，未切换代理/重启任何服务/调用交易写API/改变参数。

## 新确认缺陷：admitted timeout不能及时结束代理握手

线上bounded timing中AGENT_OR_SOCKET_ACQUISITION失败227项；最长admittedNetworkMs303353ms，含事件循环延迟，不能全归为网络。离线只连接自建loopback SOCKS fixture的复现：timeoutMs100，直到500ms人为关闭fixture才返回，actualSettledMs517；独立于外部交易所/SSH状态证明当前HTTPS ClientRequest signal并未及时结束等待async agent的promise/槽位。

在既有隔离候选codex/rest-connection-reuse-20261007追加最小修复：JSON请求显式按abort/deadline单次结算并释放budget、清理监听；真实SOCKS连接建立绑定同一请求剩余期限，避免仍采用库默认30s并长期占用pending连接。每次connect使用独立delegate，避免并发修改共享agent.timeout；WS沿用原连接语义；不扩大TTL/并发/速率、不新增交易自动重试。当前候选的keep-alive/socket上限6继续保留。早期context取消可先释放逻辑budget，但物理握手最多到本请求期限才收敛，不能宣称即时物理取消。

代码只在无live data junction的隔离checkout，完整verify和精确候选SHA稍后记录；没有部署或提升main源码。原12h观察继续，06:41终点按真实失败给出NOT_STABLE/INCOMPLETE，F04/F10/F11暂停。

证据：followup-hour02-{summary,samples.jsonl.gz,events.jsonl,detailed-events.jsonl,current,processes,identity}，gzip保留实际完整原始样本；保留日志及bounded sampled ledger不是全量wire普查。隔离修复及reproduction/verify证据将保留在GitHub候选分支的docs/reports/v397-rest-connection-reuse-20261007/。

## Second hourly checkpoint — 20:43 +08:00

Current runtime is NOT_STABLE, original12h duration still pending. Frozen123samples/2.032296h: private READY75 / explicit UNAVAILABLE26 / observation gaps22, maxage1231684ms; NET-00236 active samples, queue105; TP missing12/orphan22/mismatch1. At20:44 current private UNAVAILABLE25 consecutive failures, age1283036ms, Proxy connection timed out; TP DEGRADED9/9 plusorphan1, not current exchange proof. Models/Engine/collector/SSH listener identities unchanged, Settings247/resource hashes identical, runtime identity6/6. No observer lifecycle/proxy/config/exchange action. Read FOLLOWUP_HOUR02.md and frozen raw gzip/events/detail/current/process evidence under docs/reports/v397-audit-remediation-20261007/.

Additional confirmed async SOCKS deadline bug has a loopback reproduction:100ms request settled517ms only afterfixture close500ms. Updated isolated candidate 0737e6649dd9c0754c4238bc3a860ec786487a0a (codex/rest-connection-reuse-20261007) adds per-request bounded proxy negotiation and direct single-settlement cancellation; repeat100ms request settled118ms, no pending proxy sockets after150ms grace. Complete verify1974tests/232files all gatesgreen; source/reproduction/logs GitHub candidate docs/reports/v397-rest-connection-reuse-20261007/. This supersedes a9e5b88 as candidate tip. Candidate NOT_DEPLOYED; current main/live code unchanged. Do not automatically deploy during heartbeat or mix candidate into this observation. External failure rootcause remains UNKNOWN; no strategyparameteroptimization. Continue6h/12h closeout with actualfailed data.

# 第1小时检查：事实层仍不稳定

观察窗口：2026-10-07 18:41:16–19:43:28 +08:00，63份样本，1.036706小时。本窗口继续采集，不满足6小时验收条件；已经证实存在运行失败，不能宣布基础层稳定，F04/F10/F11仍暂停。

| 事实 | 实际结果 | 解释与证据强度 |
|---|---|---|
| 私有事实 | READY48 / 明确UNAVAILABLE3 / 观测缺失12；最大年龄161302ms，p9577894ms | PROVEN；缺失不能算READY，也不能改写成私有同步已失败 |
| NET-002 | 9个样本活动 | PROVEN复发；样本占比不是事故次数或持续时长 |
| 本地队列 | 60个样本活动；route admission计数增量：admitted2222、queued3863、queueTimeout1634 | PROVEN仍拥塞；这些是整体请求计数，不能都归为关键请求 |
| TP | missing10个样本、qtyMismatch1、orphan2；12份TP观测缺失 | PROVEN暂时失配；按分钟采样无法精确推导保护缺口时长 |
| 自然TP恢复 | 4次TP_REPAIR_FAILED、2次TP_PROTECTED；2次孤儿终态FILLED收敛 | PROVEN上述路径发生；F02 lost-ACK CANCELED/EXPIRED/REJECTED恢复仍UNKNOWN，没有该路径自然样本 |
| 历史轮转 | 135个不同未验证Entry身份被尝试 | PROVEN未再卡在固定前三个；未知风险不得人为清除 |
| F08事件 | 激活215、恢复215；各incident差值最多1 | PROVEN当前窗口无旧历史恢复重放放大；边界差值不算bug |
| 接口响应 | health/closeout/governance各12次采样超时；最大样本间隔74.191秒，无>90秒间隔 | PROVEN本机可观测性失效，网络阶段时间可能含事件循环停顿 |
| 生产边界 | 51份可见Production writes均0，12份未知 | 有缺口，不能表述完整窗口零写证明；运行TESTNET自身自然写入27，不是observer下单 |

当前额外单次快照：private READY，TP8/8，零missing/qtyMismatch/orphan/unknown，说明已经恢复到该时点，不证明持续稳定。reconciliation仍DEGRADED并保留OPEN_ORDERS队列失败及历史UNKNOWN。8080 PID37952/collector35268及三个模型服务PID、创建时间均与本窗口起点一致；identity再核对6/6。没有启停任何服务或修改Settings、代理、策略参数。

## 归因边界与后续实现调查

在有完成networkTiming的账户请求样本中，127项都ADMITTED且reusedSocket=false，最长账户队列等待5110ms。当前BinanceTransport显式创建SocksProxyAgent却未开启keepAlive；安装包Agent继承Node http.Agent的默认值。重复隧道/TLS建立的存在有代码与运行证据，是否是私有161秒陈旧的主要原因仍是INFERENCE，需要独立回归/对照；不能据阶段时间直接断言交易所或SSH隧道故障。最大wire时间与本机接口超时也提示事件循环贡献需进一步实测，不能把所有耗时算成纯网络延迟。

TP修复失败包括exact GET排队失败、reconciliation read deadline取消必要准备读取和真实传输超时；未尝试写入时保留NOT_ATTEMPTED。之后修复及FILLED收敛成功。此处保留安全暂停，不扩大read TTL或制造订单。

下一步继续原12h只读窗口，另在隔离checkout证明REST连接复用缺口并准备最小修复/完整verify；不修改当前运行源码、不自动部署重启。6h/12h按真实失败和缺口给出NOT_STABLE/INCOMPLETE，不能把代码或测试通过改称运行根治。

证据：followup-hour01-summary.json、lossless followup-hour01-samples.jsonl.gz、events.jsonl、detailed-events.jsonl、detail.json、current.json、identity.json、processes.json。原始样本SHA256：108046c2b6e60f6299710b44f88b9a27e2fdcccced454041756e36d17177d725。详细事件仅包含该冻结窗口的当前实例保留日志；bounded ledger非完整请求普查。

## 2026-10-07 19:52 +08:00 — additional isolated candidate (NOT DEPLOYED)

First-hour runtime remains NOT_STABLE. Bounded account timing evidence and a real loopback SOCKS reproduction prove connections are reopened instead of reused. Minimal candidate a9e5b8819cbb1facc856dd766d5727718c5a1498 on codex/rest-connection-reuse-20261007 enables bounded keep-alive and retires old idle routes while preserving captured requests. Complete local verify passes1972 tests/232 files (Engine1789). Candidate source, reproduction failures, targeted77 tests and full verify logs are on GitHub at https://github.com/3684993/ZDJMITS/tree/codex/rest-connection-reuse-20261007/docs/reports/v397-rest-connection-reuse-20261007 . This is LOCAL_VERIFY_PASS / NOT_DEPLOYED / RUNTIME_ACCEPTANCE_UNKNOWN.

No candidate code is in current main or live PID37952. Main still matches live source d9626b0f51ae679283d93b7b2bb9c6355322d3f65cbd7010b40d9aec57c9565e. Current heartbeat forbids lifecycle actions; do not automatically deploy/restart, infer runtime improvements from isolated tests, or silently count the ongoing window toward a future candidate deployment. Continue original collector35268 to the actual6h/12h checkpoints, report NOT_STABLE/INCOMPLETE honestly, preserve all evidence on GitHub. F04/F10/F11 remain deferred. Candidate checkout D:\MITS-WORKTREES\v397-rest-connection-reuse-20261007 has no live data junction; preserve its clean branch for subsequent authorized deployment context.

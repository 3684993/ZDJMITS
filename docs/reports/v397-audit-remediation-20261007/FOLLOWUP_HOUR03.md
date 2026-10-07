# 第3小时：private持续失效，新建仓安全暂停

冻结窗口：2026-10-07T10:41:16.397158+00:00–2026-10-07T13:43:13.356878+00:00，183样本、3.032489h。实际不到6h，但事实层NOT_STABLE已经证实；12h完整观察仍PENDING。原窗口未重启/混入任何候选build。

| 累计指标 | 结果 | 边界 |
|---|---|---|
| private | READY75 / 明确UNAVAILABLE86 / 观测缺失22 | 比第二小时增加60份明确UNAVAILABLE；第三小时60份均不可用，无新的诊断HTTP缺失 |
| private年龄 | max4832029ms、p954352121ms | 不是持续恢复；当前额外快照年龄4882496ms（81.37分钟） |
| NET-002 / queue | 96 / 147份样本活动 | 累计样本活动数，不是事故频率或时长 |
| route计数增量 | admitted4314、queued8134、queueTimeout3812 | 全请求aggregate，并非都为关键请求 |
| TP诊断 | missing12、qtyMismatch1、orphan82份；观测缺失22 | 保护事实可能陈旧，不能等同实际远端保护正确 |
| 生产边界 | 可见161份Production0，缺失22 | 不能宣称全窗口连续零写；第三小时自然TESTNET计数仍32 |
| 时间完整性 | max间隔74.191秒，无>90秒间隔 | 六个端点并非原子快照，bounded ledger/保留日志不构成全wire普查 |

额外current快照2026-10-07T13:44:03.830234+00:00：health DEGRADED，private UNAVAILABLE，连续失败98，reason `BINANCE_TRANSPORT_BLOCKED: Binance request timed out`，lastSuccessAt仍1791375760928。TP DEGRADED：required8/protected8、orphan2；这个protected值不是实时交易所复核。新建仓BLOCKED，executionReadiness.ready=false / privateFresh=false / modelSpendPermitted=false，第一阻断PRIVATE_DATA_UNAVAILABLE；这是真实事实不足的安全暂停，不是凭Primary调用年龄认定scheduler卡死。

PUBLIC和MARKET WS当前均LIVE，reconnects分别3/19，行情连续性仍有无效K线候选；WS存活不能刷新账户事实，也不能把fresh book冒充last/mark新鲜。staleByField来自所有保留symbol；有陈旧字段的样本数不能用作全部可执行候选过期比例。

当前实例/Engine PID37952/collector35268、8081/8083/8084进程与创建时间未变，identity6/6。TCP20091监听/连接状态单独存档，不能据此推断外部代理/SSH/交易所故障归因。observer没有启停服务、切换代理、修改Settings/参数或调用交易写入。源代码未变，隔离候选0737e66仅本地1974测试及GitHub候选分支通过，NOT_DEPLOYED。

自然TP事件累计与第二小时相同：TP_PROTECTED4、TP_REPAIR_FAILED6、孤儿FILLED终态收敛2；F02 lost-ACK CANCELED/EXPIRED/REJECTED自然样本仍UNKNOWN。历史未验证Entry身份182，第三小时未增加；当前私有事实/初始读失败时不能说轮转已完成，也不得解除UNKNOWN风险。

确认运行失败、已确认代码缺陷、外部根因假设严格分开：private/NET-002复发PROVEN；重复握手和async proxy deadline缺陷已在隔离候选修复/完整verify；该候选在当前外部网络状态下是否恢复事实层仍UNKNOWN。F04/F10/F11禁止进入。继续原6h/12h窗口，不自动部署，不提前宣布完成。

本轮证据：followup-hour03-summary.json、lossless samples.jsonl.gz、events.jsonl、detailed-events.jsonl、current.json、processes.json、identity.json、proxy-local-states.json。原样本SHA256 1c5e13ec963e4b339b60a962abca35b5ec5347d48008050424f0bed2dcc248f4；上述文件均随报告提交GitHub main。

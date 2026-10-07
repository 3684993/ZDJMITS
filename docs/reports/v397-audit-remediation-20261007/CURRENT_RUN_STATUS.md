# 本轮 remediation 当前状态

模型：GPT-6.1 Sol（gpt-6.1-sol），Medium。

F01/F02/F03/F05/F06/F07/F08 的代码修复和回归检查已实现，完整本地 verify 通过 1,969 项测试、231 个测试文件及 release/scripts/S00/typecheck/build。实施证据见 REMEDIATION_REPORT.md；这不代表长时间运行稳定。

首轮运行 24 个样本、约23分钟，私有事实1个样本明确不可用、3个样本观测缺失，NET-002在4个样本中活动，队列事故贯穿样本。该窗口不通过；已保留 lossless gzip、持久化事件和摘要。随后修复后台/补数占槽、账户/关键行情 admission 优先级、同级FIFO，并强化TP响应身份、步长数量和持久化终态收敛。

仅8080在本轮手动部署两次；当前PID37952，instance 285c4ece-93d9-4be8-9393-839cbf47fb9b，build 3.9.7-8b758a2b18ba8b6abe90，restartCount263。实际branch/main身份6/6闭合。8081/8083/8084进程及创建时间未变，Settings版本247及全部资源指纹未变。未调整策略参数、代理或重置数据库，未制造交易。

新观测从2026-10-07 18:41:12 +08:00开始，collector PID35268。6小时检查点为10月8日00:41:12，12小时终点06:41:12；具体跨度以实际样本为准。每分钟只读采集；同一线程每小时自动回访，于检查点将lossless原始数据、事件、摘要和报告提交GitHub。采样缺口及自然TP终态恢复无样本必须明确披露。启动短窗口中仍有BINANCE-QUEUE-001，不能提前宣布拥塞/NET-002根治。

当前结论：代码/本地验证完成，长窗口验收 PENDING。F04/F10/F11尚未开始，须事实层稳定后另行进入科学优化。外部代理/隧道/交易所根因未经相关证据验证，不做归因。

诊断采样缺失与私有状态已分开：运行中collector早期汇总默认值把缺失写作UNAVAILABLE，验收应使用修正后的analyze_stability.py及原始端点值。新窗口首4份样本为3份READY、1份观测缺失，无明确私有UNAVAILABLE；缺失不算通过，也不能断言私有同步已失效。

第一小时证实仍不稳定：private明确不可用3份、诊断缺失12份，最长private年龄161秒，NET-002复发，TP出现暂时保护缺口；当前单次快照已恢复TP8/8。详见FOLLOWUP_HOUR01.md。12h采集继续，参数优化暂停。

## 2026-10-07 19:52 +08:00 — additional isolated candidate (NOT DEPLOYED)

First-hour runtime remains NOT_STABLE. Bounded account timing evidence and a real loopback SOCKS reproduction prove connections are reopened instead of reused. Minimal candidate a9e5b8819cbb1facc856dd766d5727718c5a1498 on codex/rest-connection-reuse-20261007 enables bounded keep-alive and retires old idle routes while preserving captured requests. Complete local verify passes1972 tests/232 files (Engine1789). Candidate source, reproduction failures, targeted77 tests and full verify logs are on GitHub at https://github.com/3684993/ZDJMITS/tree/codex/rest-connection-reuse-20261007/docs/reports/v397-rest-connection-reuse-20261007 . This is LOCAL_VERIFY_PASS / NOT_DEPLOYED / RUNTIME_ACCEPTANCE_UNKNOWN.

No candidate code is in current main or live PID37952. Main still matches live source d9626b0f51ae679283d93b7b2bb9c6355322d3f65cbd7010b40d9aec57c9565e. Current heartbeat forbids lifecycle actions; do not automatically deploy/restart, infer runtime improvements from isolated tests, or silently count the ongoing window toward a future candidate deployment. Continue original collector35268 to the actual6h/12h checkpoints, report NOT_STABLE/INCOMPLETE honestly, preserve all evidence on GitHub. F04/F10/F11 remain deferred. Candidate checkout D:\MITS-WORKTREES\v397-rest-connection-reuse-20261007 has no live data junction; preserve its clean branch for subsequent authorized deployment context.

## Second hourly checkpoint — 20:43 +08:00

Current runtime is NOT_STABLE, original12h duration still pending. Frozen123samples/2.032296h: private READY75 / explicit UNAVAILABLE26 / observation gaps22, maxage1231684ms; NET-00236 active samples, queue105; TP missing12/orphan22/mismatch1. At20:44 current private UNAVAILABLE25 consecutive failures, age1283036ms, Proxy connection timed out; TP DEGRADED9/9 plusorphan1, not current exchange proof. Models/Engine/collector/SSH listener identities unchanged, Settings247/resource hashes identical, runtime identity6/6. No observer lifecycle/proxy/config/exchange action. Read FOLLOWUP_HOUR02.md and frozen raw gzip/events/detail/current/process evidence under docs/reports/v397-audit-remediation-20261007/.

Additional confirmed async SOCKS deadline bug has a loopback reproduction:100ms request settled517ms only afterfixture close500ms. Updated isolated candidate 0737e6649dd9c0754c4238bc3a860ec786487a0a (codex/rest-connection-reuse-20261007) adds per-request bounded proxy negotiation and direct single-settlement cancellation; repeat100ms request settled118ms, no pending proxy sockets after150ms grace. Complete verify1974tests/232files all gatesgreen; source/reproduction/logs GitHub candidate docs/reports/v397-rest-connection-reuse-20261007/. This supersedes a9e5b88 as candidate tip. Candidate NOT_DEPLOYED; current main/live code unchanged. Do not automatically deploy during heartbeat or mix candidate into this observation. External failure rootcause remains UNKNOWN; no strategyparameteroptimization. Continue6h/12h closeout with actualfailed data.

## Third hourly checkpoint — 21:43 +08:00

183 samples/3.032489h: private READY75 / explicit UNAVAILABLE86 / observation gaps22; all60 added third-hour samples explicit UNAVAILABLE. Max age4832029ms; current extra snapshot4882496ms/98 consecutive failures, entry blocked/model spend disabled. NET-00296 active samples, queue147, TP orphan82 sample occurrences; current TP DEGRADED8/8 plus2orphans is not fresh exchange proof. No new natural TP lost-ACK terminal recovery sample. Runtime/model/collector identities unchanged, identity6/6; no lifecycle/proxy/config/parameter/exchange action. See docs/reports/v397-audit-remediation-20261007/FOLLOWUP_HOUR03.md and lossless hour03 evidence. Status NOT_STABLE, final12h duration PENDING. Candidate0737e66 remains NOT_DEPLOYED; do not repeat already completed1974-test candidate verification without changes, or automatically deploy during observation. F04/F10/F11 deferred.

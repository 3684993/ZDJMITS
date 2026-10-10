# G1 physical model-service capacity lease validation
独立 worktree D:/MITS-WORKTREES/v398-model-capacity-lease，branch codex/v398-model-capacity-lease，从 main b55f427 创建；不混 PR31 的仪表盘代码，不部署。

## Confirmed defect / RED
原 aiFabric reviewActive 与 load.active 分离，同一 localhost/127.0.0.1:port alias 可让 Primary 和 queued Review 同时进模型。lease-original-competition-red.log 在原 main aiFabric 上实际 max2，期望1失败；独立 scheduler 不是只新增 dutyRoute。
lease-red.log 为中间编辑缺 reviewActive 失败，保留但不算原版证据。完整 lease-verify-ci.log 还发现旧 exitFactsAndFunding 测试直接改 load.active；修复为实际占用/释放租约测试，未放松 ceiling。
最终 targeted/full verify 日志与 hosted CI 独立留档。

## Implementation
AiPhysicalResourceScheduler canonicalizes loopback aliases/protocol/port; /v1与斜杠同服务，slot=1；同物理serviceId也共享容量。symbol token lease，所有角色 run/research/queue统一 acquire/finally release；重复旧token release 不能删新lease。无效endpoint拒绝容量，不改变熔断/Entry协议。家庭端口优先；只有明确 policy.borrowIdle、唯一签名身份、相同 model/template/context/output-contract/generation-config hashes、最新端点健康、另一物理服务空闲且没有到期Review/Primary等待冲突才能借用。当前 constructor 默认 borrowing disabled，生产没有安装身份policy：live activation deliberately blocked until approved equivalence provisioning exists。Review remains REVIEW_BRAIN，Primary stays PRIMARY_BRAIN even on borrowed resource；这不创建 Entry授权。

Review队列最大128，等待 TTL<=min(60s,decisionTimeout)；取消/到期出队不延长订单TTL。请求双ID或 position trigger/plan/number dedupe，owner/plan事实的动作验证仍在既有coordinator。队列slot在出队前占用；取消不能提前释放仍运行的模型请求，timeout finally清理。只有 actual work 和空槽才借用，无人工推理。

## Evidence
core/integration tests覆盖同端口alias、同physicalID、两服务都忙、重复release、context/generation不兼容、OFFLINE、owed review、timeout、到期、预取消、队列取消/重复identity。共享原aiFabric suites/fairness和整个verify:ci覆盖原安全约束。Half-open borrowing disabled，保留原Primary失败锁。
lease-offline-replay.json由实际scheduler运行100个合成任务、无socket/model/Engine；fixed-home vs approved-equivalent借用：
- Primary80/Review20、完成100相同；Primary queue P95 4140→1520ms，降63.3%。
- Review queue P95 0→0ms、overdue0→0、failure0→0。
- exchangeWrites0→0、Entry authorizations0→0。该数字是无授权能力回放，不是历史真实授权验证或线上性能保证。
真实自然基线/模型身份在PR31 report；27B当前reasoning/output不同，output契约等价UNKNOWN，不能安装borrow policy。完整授权历史回放、在线borrowP95、Review预算/全体deadline效果仍未验证。Policy持久配置/正式运行接线必须下一轮有批准等价证明后实现，禁止默认开启。

## Safety / handoff
Primary唯一建仓、NO_SEPARATE_ADD、HUMAN_MANAGED与TP保护源码不改；网络PR25/27/29不合入。没有实际TP改价/交换调用或Engine/model/proxy重启。旧24h ABORTED，发布门禁不闭合，CI通过不代表验收通过。

GitHub PR #33: https://github.com/3684993/ZDJMITS/pull/33
Exact hosted GREEN source/evidence HEAD 57874460e4ef743d4f9b1eb65dd5bd4fa037192c: https://github.com/3684993/ZDJMITS/actions/runs/38017514666 (completed/success). Archived job log and exact-head JSON included. Subsequent archival commit changes documentation/evidence only; its final HEAD CI must also be read back, never inferred from this result.
Related independent PR31 dashboard, PR33 lease, PR32 TP SHADOW; no merge/deploy. Local full verification counts in verification-local.json.

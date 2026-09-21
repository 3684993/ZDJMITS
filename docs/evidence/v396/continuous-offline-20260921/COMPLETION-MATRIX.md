# V3.9.6 continuous offline completion matrix

基线：`cf231f7ec98d95bf49be208368de6f392d55e029`。实施提交：`1d7d68ffdb79e64b9bef1fe181e9fb5a8bf725ca`。worktree：`D:\MITS-WORKTREES\v396-offline-implementation-20260921`。

| 阶段 | 本轮离线结果 | 状态/边界 |
|---|---|---|
| S00 | 从既有 ACCEPTED 基线复核；入口清单因新增脚本更新为 108 条，S00-T01..T06 PASS | 继承 `ACCEPTED`，仅规格/隔离基线 |
| S01 | F1–F5 修复：真实对账去除七天硬退化并检查覆盖；UNKNOWN freshness/归属冲突 fail-closed；collector 持久样本分段/回退/峰值；Primary 分类接入 pipeline；资金费/资本基准函数与真实测试映射补齐 | `READY_FOR_REVIEW`，外部账户事实仍 `NOT_RUN_EXTERNAL` |
| S02 | canonical ExecutionScope、ownership CAS、人工交接写入 ownership 版本与 deadline 接口 | `READY_FOR_REVIEW`，完整 durable outbox/崩溃事务仍需总设计复核 |
| S03 | signed funding、费用 UNKNOWN、-10 USDT 决策树、0.15 按 0.15% 的离线判定 | `READY_FOR_REVIEW`，无真实费用/盘口经济证明 |
| S04 | AI/manual/TP 共享 quantity claim 原语与既有 manual/TP 协调路径回归 | `READY_FOR_REVIEW`，交易所 ACK 丢失/双模式真实参数均 `NOT_RUN_EXTERNAL` |
| S05 | human book 保留账户风险、portfolio snapshot 缺事实阻断、scope/claim 聚合 | `READY_FOR_REVIEW`，实时保证金/清算档位未取外部事实 |
| S06 | TradePlan identity/quantity/deadline/evidence 校验与拒绝测试 | `READY_FOR_REVIEW`，模型 ENFORCE 保持关闭 |
| S07 | token ledger UNKNOWN 用量、角色/重试台账原语 | `READY_FOR_REVIEW`，实时模型/服务端 usage 未运行 |
| S08 | 既有服务端健康/只读 projection 接线保留；风险快照进入人工 projection | `READY_FOR_REVIEW`，浏览器/真实 Settings 回读未运行 |
| S09 | availableAt 回放过滤、manifest hash、离线 experiment 原语 | `READY_FOR_REVIEW`，正式样本外统计与压力数据不足 |
| S10 | release readiness、hash/外部状态材料与迁移演练说明 | `READY_FOR_REVIEW`；canary、部署、Engine 生命周期均 `NOT_RUN_EXTERNAL` |

所有阶段均未自签 `ACCEPTED`；表中 READY_FOR_REVIEW 仅表示本轮离线交付范围可审计，不表示 G1–G5 通过。

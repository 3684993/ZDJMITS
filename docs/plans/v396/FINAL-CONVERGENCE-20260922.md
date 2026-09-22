# V3.9.6 最终完善与验收实施计划

总设计接手；2026-09-22。核验基线 cbea69483035e0d19efbdd83180bc1f9950ea5ba，唯一实施分支 codex/v396-final-convergence-20260922。附件进度截至 S05-A～D；全部完成的结论不成立。

## 执行顺序

| 批次 | 文件/接缝 | 实施与必须证据 |
|---|---|---|
| C1 事实加固 | portfolioRiskSnapshot / humanCapacityPolicy / portfolioStress | 红测缺交接时间、矛盾 pending 身份、重复事实保守性、非法枚举、哈希碰撞风险；缺身份仍展示风险，不能悄悄删除；生产消费者必须检查 complete |
| C2 原子风险 | RuntimeState.reserveEntry / SettingsStore / 风险快照 | 版本、新鲜度、持久预留在同一事务；并发候选只允许额度内一个成功；UNKNOWN 不释放；不以陈旧账户重新放行 |
| C3 退出接线 | s04ExitCoordinator / accountExecutor / manualPositionService / tpGuardian / reconciliation | 审计所有写及重试；统一 canonical scope、持仓模式、mandate、期限、版本、数量；PREPARED 持久化在写前，UNKNOWN 按原 ID 查实；人工/TP 保护保留；默认 AI 新退出 OFF |
| C4 计划 | contracts / quantityHorizonCandidates / tradePlanEvaluator / entryCoordinator | 引用真实证据、q/T/目标/失效谓词；WAIT 无数量；三个期限分开；原预测不可改写；计划保存到实际 intent/fill；缺统计拒绝新经济 ENFORCE |
| C5 模型与记忆 | positionReviewScheduler / aiUsageLedger / tradeMemoryRetriever / aiFabric | 人工仓零例行推理；调用前后撤权；重复事实合并；失败/重试预算；服务端 usage UNKNOWN 不造零；正反例、未完成周期和人工结果保留 |
| C6 设置与运维 | settings schema/API/UI、ownership/mandate 读端、备份恢复 | 设置逐字段消费/回读；隔离数据库备份恢复；fee/symbolInfo/MarketDataHub 真源，不能只接展示；无需运行现网即可编写并测试接线 |
| C7 回放与发布 | replay runner / stress / release manifest | 冻结输入、availableAt、成本和消融、无样本伪盈利；生成只读 preview 与人工执行清单；真实生命周期/交易写/迁移/部署停在 READY_FOR_TESTNET_AUTHORIZATION |

## 方法与验收

每批先写能暴露确定缺陷的测试，保存红测摘要，再修复、targeted hostile review；通过阶段测试、全 Engine、typecheck、contracts/core build、S00 static 和 diff check 后独立提交。已有冻结历史不改写、不 force，不修改 PR #9。源代码接线不等于执行现网操作。

不为全绿降低测试断言、不把 characterisation 当安全验收、不将普通离线缺口标 NOT_RUN_EXTERNAL。S04/G2、S05/G3 在真实调用链未验证前仍未达成；S09 经济优势未证明；S10 G5 未运行。实现人可以提供测试结论，不能用自己的补丁给整个版本自签 ACCEPTED。

## 进度记录

- 初始：C1 IN_PROGRESS；C2–C7 NOT_STARTED。本计划只声明待办，不能充当实现证据。
- 现网边界：不启停/热重载 Engine，不改 live Settings/DB，不部署、不发单。允许隔离 worktree 的代码、测试、临时 DB 和文档；通知脚本按用户要求执行。

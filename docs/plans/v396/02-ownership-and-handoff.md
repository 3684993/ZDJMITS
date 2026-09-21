# S02：管理权、硬期限与人工交接

状态 NOT_STARTED；主实施 terra。前置 S01/G1；后继 S03、S05。重点 EX1、RI3、AI2；涉及 I01/I02/I06/I08/I10/I11。

## 目标与文件

将现在 AUTO_MANAGED/HUMAN_MANAGED 与 lossHandoff 升级为可恢复的授权状态机。不能等到人点击确认才撤销 AI 权限。

已有：packages/contracts/src/{trading,settings}.ts；apps/engine/src/services/{lossHandoff,positionService,positionLifecycleTracker,manualPositionService,executionLifecycle}.ts；state/runtimeState.ts；config/settingsStore.ts；runtime/appRuntime.ts。

拟新增 ownershipService.ts、handoffService.ts 及独立测试；优先复用 existing scope/journal，不再造另一份仓位真源。PlanIdentity 使用 CONTRACTS，S06 前只用冻结夹具，不依赖模型接口。

## 实施子序列

1. **S02-A 存储与兼容。** 新增 ownership 版本、planRef、deadline、事实不确定标志与通知 outbox；旧字段先作兼容投影。所有权 CAS、状态变更事实、outbox 同一事务；事件消费者幂等。
2. **S02-B 转移规则。** 实现 AI_ACTIVE→HANDOFF_PENDING→HUMAN_MANAGED→CLOSED。触发源包括到期、人工指令、旧亏损 K 线条件、未来 S03 的深亏/失效信号；触发原因分开记录。到期由确定性时钟触发，无需模型在线。
3. 首次成交固化 deadline，部分成交/恢复不续期；expiry 采用 `now>=deadline`。旧 AUTO 缺计划/期限进入人工审阅，新功能默认不为其补新权限。现存 HUMAN 原样保留。
4. **S02-C 撤权与排他。** 同域人工动作先撤 AI 权限、更新 ownerVersion 再走现有人工执行；不因撤单失败恢复 AI。AI 迟到回答、已排队任务、自动重试都必须验证 ownerVersion。
5. 交接包保存原计划、剩余仓位、费用/funding、预计净退出值、TP mandate、在途单/UNKNOWN、强平风险和触发证据；人工 ack 只表示已阅。交易事实仍由对账服务确认。
6. 人工未响应时发幂等告警/升级待办，是否阻断新仓由 S05 配置；不能自动替人深亏退出。交接后的例行模型任务取消/去重，底层保护和私有事实订阅继续。
7. **S02-D 维护权限。** 明确 TP 原价恢复/数量适配与人工主动撤改单指令的优先级；保存 mandate 版本，Guardian 不得撤销人工决策。S04 再统一订单协调，此阶段先形成接口和拒绝旧版本能力。

## 接口和事件

拟议 `transitionOwnership(expectedOwnerVersion, trigger, facts)` 返回已提交的新记录或 VERSION_CONFLICT；`requestHandoff()` 幂等；`ackHandoff()` 不扩大权限；`authorizeAiManagement()` 需要明确人工授权与新计划，不擦除 cycle 历史。

输出 OWNERSHIP_CHANGED、HANDOFF_CREATED/ACKNOWLEDGED、PROTECTION_MANDATE_CHANGED。通知 outbox 的投递失败单独记录，不影响核心状态。

## 测试矩阵

| ID | 场景 | 预期 |
|---|---|---|
| S02-T01 | now 为 deadline−1 / deadline / deadline+1 | 精确边界，到期不可新发 AI 写 |
| S02-T02 | 模型回答与人工操作同时到达 | 只有持有正确 ownerVersion 的路径可提交 |
| S02-T03 | 部分成交后补成交，进程恢复 | deadline 不延长，原 cycle 不重置 |
| S02-T04 | 提交状态后崩溃，通知未投递 | 恢复仍已撤权，outbox 可重投且无重复待办 |
| S02-T05 | 人工无响应或仓位恢复盈利 | 不恢复 AI；风险/保护仍运行 |
| S02-T06 | 不明外部加减仓，同 scope 数量变化 | 人工/不确定状态，失效旧授权 |
| S02-T07 | 人工撤 TP 后 Guardian tick | 不复活已撤 mandate；实际无保护状态明确告警 |
| S02-T08 | 旧数据无期限、HUMAN、已平仓 | 无静默新授权；已平仓不能复活 |

增加事务崩溃边界、事件重复和时钟回拨测试；重启测试仅创建隔离测试实例或重建服务对象。

## 验收与回退

迁移必须 preview、保留旧字段及原始 plan，隔离副本验证读回与重跑幂等。未获用户明确迁移指令，不批量处理现网仓位。

ACCEPTED 条件：撤权不依赖 AI/通知、人类账归属和 TP mandate 可恢复、S02-T 全过。不能因通知“发出”就声称人工已接管确认。

回退优先关闭新授权并保留 ownership；旧执行器不能理解新状态时禁止直接降级运行。移交 S03/S04：owner/mandate API、版本与到期拒绝夹具；S05：人工/待交接风险状态与时间。

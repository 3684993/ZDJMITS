# S02 结论：READY_FOR_REVIEW（不自签 ACCEPTED）

阶段：S02 管理权、硬期限与人工交接。runId `20260921T190000Z`。审查人：总设计（本提交不作 ACCEPTED，依 README 第 5 节与运行规则第 6 节）。
范围：完全离线。未部署、未启停 Engine、未访问网络与交易所、未读写现网 Settings/数据库、未发单、未迁移现网仓位。

## S02-T01…T08 逐项证据

全部在 `apps/engine/src/services/ownershipS02Acceptance.test.ts`（11 例）与 `ownership-tests.json`（6 文件 / 62 项，0 失败）。

| ID | 断言的事实 | 结果 |
|---|---|---|
| S02-T01 | `deadline−1` 不撤权且 AI claim 仍被接受；`deadline` 当刻 `expire()` 返回 1 并转为 HANDOFF_PENDING；`deadline+1` 不再重复计数，且迟到 AI claim 抛 `AI_AUTHORITY_REVOKED` | PASS |
| S02-T02 | 两个连接竞争同一 `scope/cycle`：人工先落地并抬版，持旧 `ownerVersion` 的 AI 路径抛 `OWNER_VERSION_CONFLICT`；只有当前版本可提交 | PASS |
| S02-T03 | 首笔成交固化 deadline；重开文件后以「更晚补成交 + 更长时长」再 initialize 返回原记录，cycle 不重置、deadline 不延长、版本不变 | PASS |
| S02-T04 | 状态提交后崩溃（丢弃句柄、未投递）：重开仍为 HUMAN_MANAGED（撤权不依赖通知）；outbox 仍待投；投递失败时不标记、成功后 pending=0；再次 drain 为 no-op，`pendingTasks()` 不产生重复待办 | PASS |
| S02-T05 | `acknowledge` 只写 `acknowledgedAt`（重复调用保留首次时间戳、幂等）；HUMAN_MANAGED→AI_ACTIVE 抛 `HUMAN_REAUTHORIZATION_REQUIRED`；回拨时钟的 ack 抛 `INVALID_ACK_CLOCK`；无任何「价格恢复」入口可翻转状态 | PASS |
| S02-T06 | 同域数量漂移（claim 100 > 观测 50）→ 转 HANDOFF_PENDING，原因 `CLAIMED_UNITS_EXCEED_POSITION`，旧版本 claim 立刻被拒；观测来源为 UNKNOWN → `POSITION_FACT_UNVERIFIED` 撤权；无主 cycle 只上报 `unownedCycles`，绝不静默收养 | PASS |
| S02-T07 | mandate 版本 CAS（旧版本写抛 `MANDATE_VERSION_CONFLICT`）；人工撤销后 Guardian 再写抛 `MANDATE_HUMAN_REVOKED`；撤销期间 `unprotected()` 明确列出无保护 cycle；人工可用新版本重建 mandate；Guardian 无价格的 mandate 被拒 | PASS |
| S02-T08 | 迁移 apply 三类旧数据：无计划旧 AUTO→HANDOFF_PENDING（不补期限/权限）、现存 HUMAN 原样保留 HUMAN_MANAGED、带计划者才 AI_ACTIVE；CLOSED 后任何复活抛 `CLOSED_OWNER_IMMUTABLE`；reconcile 对已平仓与人工仓不改动 | PASS |

## 本批另外钉住的性质

- 事务与崩溃边界：`initialize` 每笔独立提交；`recordTakeoverFromHuman` 中途崩溃只会停在 HANDOFF_PENDING（已撤权态），即「崩溃只能少授权，不能多授权」。
- 时钟回拨：`INVALID_TRANSITION_CLOCK`、`INVALID_ACK_CLOCK`、`MANDATE_CLOCK_ROLLBACK` 三处拒绝过去时间戳。
- outbox 与状态同事务：`OWNERSHIP_CHANGED` / `HANDOFF_ACKNOWLEDGED` / `PROTECTION_MANDATE_CHANGED` 落同一库、同一 `BEGIN IMMEDIATE`；投递失败只记 `failed`，不回滚已提交的撤权。
- 记账不得阻塞交易：journal 打不开时 `recordHumanTakeover`/`acknowledge` 返回 false 且 `recorded` 计数不增，仅发 `V396_OWNERSHIP_JOURNAL_DEGRADED{affectsTradingPath:false,authorityGranted:false}`。本批修掉一处该文件早期的静默成功缺陷：`?.` 使「无 journal 时的记录」被当作成功返回 true。
- 迁移可复现：`preview` 只读（断言落库前后 owner 数为 0）；`rehearsal` 在隔离副本上跑两遍，第二遍 `created=0/preserved=N`；`backupTo` 使用 SQLite online backup 并拒绝备份到自身路径；备份→复制→`verify`→在原句柄上重放 apply，全部为幂等 no-op。
- 撤权原因命名优先：journal 的 `transition` 现在先抛 `CLOSED_OWNER_IMMUTABLE` / `HUMAN_REAUTHORIZATION_REQUIRED`，再落到泛化 `INVALID_OWNER_TRANSITION`（此前两者都被泛化错误吞掉，证据不可辨）。
- S04-A 仅原语：claim 崩溃后仍在、幂等键同 id 返回原 claim、改数量抛 `IDEMPOTENCY_CONFLICT`、无正向终局证明的释放抛 `CLAIM_RELEASE_UNPROVEN`、释放幂等。**未接入任何下单路径**。

## 尚未完成（S02 保持 PARTIAL 的原因）

1. 读端消费者缺：ownership 目前不被 runtime 投影、API、快照或对账读取，仪表盘与 `tradeRecords` 看不到 ownerState/ownerVersion/deadline（阶段文件要求的「不再造第二份仓位真源」需以读端合并来证明）。
2. 交接包（阶段文件 §5）未组装：原计划、剩余仓位、费用/funding、预计净退出值、TP mandate、在途单/UNKNOWN、强平风险与触发证据的单一持久包仍未实现；现有只是其组成部分。
3. 人工失联的幂等告警/升级待办（§6）未实现；是否阻断新仓属 S05 配置，本批未触碰准入。
4. 交接后取消/去重例行模型任务（§6）未实现（涉及 AI 调度，与 S07 预算耦合）。
5. `authorizeAiManagement()` 这条**授予**权限的路径刻意不做：需要明确人工授权 + 新计划（S06）+ S03 成本口径，且不得擦除 cycle 历史。
6. 兼容投影仍是双轨：`managementStatus`/`humanManagedAt` 是既有真源，本批只写入 ownership，未做双读一致性校验与降级顺序定义。
7. 生产迁移：无 preview→现网 apply 的授权与执行，`v396-ownership.sqlite` 在现网不存在；隔离副本演练不等于迁移完成，回退仍按「关闭新授权并保留 ownership」。
8. S03 未开始：`ExitEstimate`/`estimateHash`/报价过期/完整 fee+funding/`-9.99·-10·-10.01`/tick 取整/UNKNOWN 与 CONSERVATIVE_BOUND/部分成交累计周期损益与性质测试都还没有，因此任何退出判定与 G2 都不成立。

## 全仓验证

- 全仓 Engine 测试：132 文件通过、0 失败、退出码 0。
- `npm run typecheck -w @zdj/engine`：通过。
- S00 静态门禁：6 项 PASS，108 条内容推导记录（98 禁止 / 9 边界可用 / 1 执行），规则表未放宽；`s00-static-gate.json` 为本轮输出。
- `git diff --check`：干净。工作树在提交后应无未跟踪产品文件残留。

# Codex V3.9.6 单轮最终闭环执行令

本任务是 V3.9.6 **最后一轮离线实施闭环**。不要再拆成下一轮、不要逐阶段询问是否继续、不要因为已有原语/测试通过就提前结束。你负责从当前唯一 convergence 分支连续完成剩余 J1→J6，直到所有可离线实现、测试、迁移预演、回放工具、发布材料与证据全部收口。

## 0. 唯一基线与不可变边界

仓库：`3684993/ZDJMITS`

唯一实施分支：`codex/v396-final-convergence-20260922`

执行前：

1. `git fetch`；
2. checkout 上述分支；
3. `git merge --ff-only origin/codex/v396-final-convergence-20260922`；
4. 确认历史包含 `51e7e1e5af06510a95bca3f075da94ececd2b06c` 及本执行令提交；
5. 工作树必须 clean；
6. PR #9 保持冻结，不修改其 base/head/内容；
7. 禁止 rebase / squash / force-push / history rewrite。

权威材料：

- `docs/reports/v396-final-convergence-audit-20260922.md`
- `docs/plans/v396/FINAL-REMAINING-IMPLEMENTATION-20260922.md`
- DESIGN-1 / CONTRACTS / I01–I12 及 S00–S10 冻结规格。

冲突时：冻结设计与 CONTRACTS 优先，本执行令只规定连续实施方式，不改变语义。

### 绝对禁止

未经用户另行明确授权，不得：

- 启动/停止/重启/热重载 Engine；
- 部署；
- 修改 live Settings、live DB、生产文件；
- 执行真实迁移；
- 访问交易所写接口或发单；
- 运行需要真实 Testnet 写入的步骤；
- 将缺失运行证据伪造成 PASS。

允许：隔离 worktree、临时 SQLite、mock/fake adapter、离线 replay、静态迁移 preview、构建/测试/typecheck、只读源码/已有证据分析。

---

# 1. 总执行纪律：这一轮必须收尾

按 **J1 → J2 → J3 → J4 → J5 → J6** 连续执行，不要完成一个 J 就停下来汇报等待确认。

每个 J 必须走同一门：

1. 先写 hostile/red tests，证明当前缺口；
2. 实施源码；
3. 跑该 J 定向测试；
4. 跑 Engine 全仓及关联 workspace tests；
5. 从**仓库根目录**运行 typecheck/build，并检查真实 exit code；
6. 跑 S00 静态门禁；
7. `git diff --check`；
8. 写机器可读 evidence + RESULT.md；
9. 独立 commit；
10. `git push` 只允许 fast-forward；
11. 自动进入下一个 J。

不要再次出现“在错误目录执行 workspace 命令导致假绿”。

只有一种情况允许中止整轮：发现一个真实 P0/P1，且在当前离线仓库内无法安全解决、继续会扩大风险或需要被禁止的现网动作。此时必须给出确定性复现和最小 blocker；普通编译错误、测试红、设计缺口、需要新增模块都不是停止条件，必须自行修完继续。

不得通过删除测试、放宽断言、把 UNKNOWN 变成 0、用默认 50% 概率、把 selection generation 冒充 riskGeneration、把模型 confidence 冒充经济概率、或关闭功能来换取全绿。

---

# 2. J1：退出真源、持续收敛、真实成本/JIT

目标：关闭 S02/S03/S04 仍存在的生产链缺口；AI exit 代码可以完成接线和离线验证，但**默认保持 OFF，不产生真实写权限**。

必须完成：

- `v396ExitRuntime` 不再只 startup query；建立有界、去重、低频的持续 exact-query/已确证事件收敛，使 WORKING/PARTIALLY_FILLED/UNKNOWN 最终只能由真实交易所事实变为终态并释放 claim。
- 取消/成交竞态、部分成交后取消、ACK lost、重启、WS 重排/重复、外部人工数量变化全部 fail-closed；没有终局事实不释放 quantity claim。
- 旧 TP/人工在途单 adoption：先核对 account/environment/full symbol/positionSide/cycle/clientOrderId/实际 qty；身份不完整则保守占用+告警，禁止先发新单再补 ledger。
- `FIRST_FILL` 固定 management deadline；迟到 fill/partial fill/restart 不延长；deadline 与 graceDeadline/执行等待分离；到期只撤 AI authority，不撤保护。
- Ownership/outbox/read-side 真正被运行逻辑消费；旧 AUTO 不能等价 AI_ACTIVE。
- S03 AI 路径使用真实 accounting/cycle fee/funding/quote/depth/FX/symbol filter/settings version；UNKNOWN/CONFLICT 不得 ALLOW。MANUAL/TP synthetic verdict 不能被 AI 复用。
- AI exit 的 production consumer 可实现，但必须有明确 feature/authority OFF gate；测试必须证明 OFF 时 0 次 exchange submit。
- JIT 紧邻 submit 再读：ownerVersion、planVersion、positionVersion、settingsVersion、riskGeneration、decisionHash/estimateHash、deadline、quote freshness、filters/fees、remaining qty、claim/reservation。

J1 红测至少覆盖 FINAL-REMAINING 中全部条目，并补：旧单身份缺失、终态事实晚到、ownerVersion 在最后一次 await 后变化、mandate 在最后一次 await 后 revoke、partial fill 后原 10 USDT cycle budget 不重置。

完成标准：S04 实际消费者 G2 矩阵全绿；不再靠源码字符串包含函数名证明接线。

---

# 3. J2：单一权威 Portfolio Risk Admission

目标：把 S05 纯模型真正接成 **EntryCoordinator 的唯一组合准入真源**，并与 C2 durable reservation 同一事务绑定。

必须完成：

- 建立版本化 `PortfolioRiskSnapshot`：真实账户资产/可用保证金/权益、AI/HANDOFF/HUMAN/UNKNOWN 持仓、working/UNKNOWN orders、entry reservations、exit quantity claims、margin asset/tier、liquidation/headroom、underlying cluster/correlation、cash flow、人工潜在接管容量。
- 缺 FX、margin tier、maintenance margin、ownership/cycle、correlation/profile/version/fact coverage → incomplete/fail-closed；不得造安全 headroom。
- 同一 exposure/reservation/order 必须 dedupe；HUMAN_MANAGED/HANDOFF_PENDING/UNKNOWN 继续占风险，人工接管不能释放 capacity。
- `evaluatePortfolioStress` + `evaluateHumanCapacity` 成为生产 admission consumer；candidate 加入后的簇/方向/尾部/保证金币种压力统一判断。
- 明确 profile 所有限额与单位；无配置不得自动填“可交易”的数值。
- snapshotHash + **真正 S05 riskGeneration** + evaluatedAt/expiresAt/factCoverage 与 `RuntimeState.reserveEntry` 在同一 `BEGIN IMMEDIATE` 窗口 JIT 重验；废除 selection generation 充当风险版本。
- 预检查不锁钱；只有 JIT 通过才 durable reserve。
- 更新 `s05ConsumerBoundary.test.ts` 为明确唯一允许消费者白名单，而不是删除它。

必须验证：S05-T01–T08、两候选共用旧 generation 只能一个成功、人工接管风险不减、UNKNOWN 不释放、外部现金流不掩盖 drawdown、同 underlying 聚合、压力更坏不能提高准入、重启后 risk binding 保守恢复。

完成标准：生产 EntryCoordinator 的 allow/deny + durable reservation 有行为证据，G3 才能进入复审状态。

---

# 4. J3：完整不可变 TradePlan / q / T / 目标候选

目标：完成 S06，不再只剩原语。

必须完成：

- contracts 新增/完善正式 TradePlan schema：cycle/scope、planVersion、方向、候选 qty、entry TTL、target horizon、management deadline、thesis predicates/invalidation、risk consumption、cost/evidence refs、经济分布字段及 provenance。
- 系统生成 q/T/target 候选；模型只可在候选中选择或 WAIT，不能自行扩大 qty/期限/价格权限。
- WAIT => qty=0。
- 方向不能因另一方向 capacity 更大而偷偷翻转。
- 每个候选含完整 cost/stress/capital usage 与统计来源。
- `targetConditionalNetProfit` 与 `expectedNetPnlAtHorizon` 分离；没有经济样本/概率就 UNKNOWN，不默认 50%，不拿 model confidence 代替概率。
- entry TTL、目标期限、AI 管理期限三个独立字段。
- 原计划 durable persist **先于 reservation**；fill 只记录实际差异，绝不重写原预测。
- add/reduce/partial/restart 不重置原 cycle loss budget；planVersion 只能走显式允许 transition。
- quantity 必须服从 J2 真实 risk headroom + exchange min/max/step/notional。

执行 S06-T01–T09，并增加从 model output → plan → intent → reservation → fill linking 的集成测试；经济 ENFORCE 在证据不足时必须拒绝。

---

# 5. J4：有限 review scheduler + token usage ledger + memory

目标：完成 S07 的真实消费者闭环，并证明“人工管理零例行模型调用”。

必须完成：

- `positionReviewScheduler`：调用前原子占 review/failure budget；trigger key 覆盖 owner/plan/position/settings/risk/fact versions；同事实不重复调用。
- 回调后 JIT 再校验 owner/deadline/version；迟到结果只归档，绝不能恢复 authority。
- `aiUsageLedger`：ENTRY/REVIEW/SCOUT/EXTERNAL_RESEARCH 每次请求、重试、失败、timeout 均记录；服务端 usage 缺失写 UNKNOWN，禁止写 0。
- 预算耗尽/AI 断网时 deterministic ownership/deadline/reconciliation/TP/alerts 仍运行。
- HUMAN_MANAGED 与 HANDOFF_PENDING = 0 routine model calls。
- `tradeMemoryRetriever` / experience：同 cycle 正/负案例、右删失/未闭合、人工接管后的增量；Top-3 不足明确 INSUFFICIENT，不重复、不能只选赢家。
- model 输出只能 advisory/structured evidence，永远不能越过 deterministic ownership/risk/cost/order gates。
- 冻结同一事件集做 token 对照；若具备可重复离线事件，计算节省比例；达不到 30% 如实 FAIL，不得调口径。若缺必要真实 usage，则工具完成、指标写 `NOT_MEASURED/INSUFFICIENT_EVIDENCE`，不能伪造。

执行 S07-T01–T09 + 失败/late callback/owner revoke/UNKNOWN usage/人工零调用 hostile tests。

---

# 6. J5：Settings / API / UI / migration / backup / restore

目标：完成 S08 的真实消费者和运维闭环。

必须完成：

- 做完整字段矩阵：schema → default → persistence → API → UI → runtime consumer → 单位 → 生效时点 → readback。
- `humanHandoffAfterMinutes` 必须消费到真实 FIRST_FILL deadline 后才允许编辑。
- 新增独立 AI `minNetProfit` / `maxRealizedLoss` 权限字段；10 USDT 含义仍为 AI realized net-loss permission line，不是账户损失上限。
- 旧 TP `0.15` 必须继续解释为 **0.15%**；禁止隐式变 15%，禁止把 TP floor 偷换为 AI policy。
- 页面/API 显示真实 owner/state/version、plan、budget、UNKNOWN/inflight、protection mandate、handoff ack、reason/evidence，不用本地 UI 假状态覆盖服务端真值。
- 人工操作后必须服务端 readback；不能前端乐观标 FILLED。
- ownership sqlite 正式进入 backup/restore/retention；`storage-coverage.json` 从 blocker 变 PASS。
- 隔离临时数据库完成 preview → migrate → readback → restore → rerun/idempotence；不得碰 live DB。
- 新 writer/旧 writer 版本不兼容必须 fail-closed；旧仓不因 migration 获得新 AI authority。
- 删除/废弃模块只能在证明无消费者、无必要事实后做。

Dashboard/API/contracts/engine 对应 tests/build/typecheck 全跑。

---

# 7. J6：冻结 replay / 样本外验证 / 统计 / release package

目标：完成 S09 + S10 所有**可离线**内容，并明确外部运行证据的边界。

必须完成：

- 建隔离 replay runner + event/cost simulator + preregistered experiment manifest + result generator。
- 冻结 `availableAt`，明确 train/validation/out-of-sample 时间边界，阻止未来信息泄漏。
- 模拟/回放必须计 fees/slippage/funding、manual delay、UNKNOWN、ACK lost、partial fills、WS reorder、duplicate、crash/restart、deep loss、delisting、liquidation-before-target、correlated tail。
- 所有预注册消融组都输出，失败组不能删除。
- 输出收益/回撤/尾部/资本占用/全账户净值、bootstrap CI、样本数/coverage；CI 跨 0、成本不全、样本不足都保持 `INSUFFICIENT_EVIDENCE`。
- token 对照结果并入同一实验报告；若真实 usage 不足，保持 NOT_MEASURED。
- 生成 release manifest：source/build/settings/prompt/schema/experiment hashes；统一实际 package/release identity 到 3.9.6，前提是源码与 schema 已完成，不允许只改版本号冒充完成。
- 完整 migration preview、rollback、canary/SHADOW/Testnet/24h soak 操作清单和证据模板。
- **不得实际执行** canary、Testnet write、Engine lifecycle、部署、live migration。

运行期项统一标：`NOT_RUN` / `INSUFFICIENT_EVIDENCE` / `PENDING_WINDOW_INCOMPLETE`，绝不能伪 PASS。

---

# 8. 最终一次性验收门

J1–J6 全部完成后再执行一次整仓 final gate：

- Engine 全仓 tests；
- core tests；
- dashboard tests；
- contracts tests（如果仍为 0 tests，必须明确写 0，不冒充覆盖）；
- contracts/core/engine/dashboard build；
- engine/dashboard typecheck；
- S00 T01–T06；
- V3.9.6 S02–S09 targeted matrices；
- `git diff --check`；
- 工作树 clean；
- 检查 PR #9 完全未变化。

然后更新：

1. `docs/reports/v396-final-convergence-audit-20260922.md` 为最终实施后审计；
2. `docs/plans/v396/FINAL-REMAINING-IMPLEMENTATION-20260922.md` 将 J1–J6 标注实际闭环状态；
3. 新建最终 evidence index / release manifest；
4. 重评 20 项 scorecard，每项必须给 evidence ref 与 `PASS/FAIL/INSUFFICIENT_EVIDENCE/NOT_RUN`；
5. 六个硬门 H-SAFETY/H-TRUTH/H-RISK/H-ECONOMICS/H-OPS/H-AUTHORITY 给精确状态与依据；
6. 列出唯一剩余的“需要用户明确运行授权”的项目。

实现者 **不得自签 `ACCEPTED`**。如果全部离线实现与离线验收已闭环，应把代码/阶段状态推进到 `READY_FOR_REVIEW`；若只有真实 Testnet/Engine lifecycle/live migration/canary/24h soak 等外部运行证据未执行，则最终项目状态写：

`READY_FOR_TESTNET_AUTHORIZATION`

这代表“离线实现收尾完成、等待明确运行授权”，不是发布/盈利/实盘授权。

---

# 9. 提交与最终回报

每个 J 保持独立 commit；允许为跨模块编译修复追加同 J fix commit，但不要 squash。每个门全绿后 fast-forward push，再继续下一 J。

本轮最终回报只允许在 J1–J6 全部处理完，或遇到前述真正不可离线解决的 P0/P1 时发送。不要中途逐阶段请求确认。

最终只报告：

- final HEAD SHA；
- J1–J6 commits；
- 每个 J 的实现摘要；
- 红测→修复的 P0/P1；
- tests/build/typecheck/S00/diff-check 精确结果；
- 20 项 scorecard；
- 六硬门；
- 最终项目状态；
- 仍需用户明确授权的运行项；
- PR #9 unchanged；
- worktree clean。

如果某项因真实外部数据不足只能 `INSUFFICIENT_EVIDENCE`，仍要把相应代码、工具、实验框架、manifest、证据结构全部实现并测试完；**“缺外部经济证据”不能成为停止剩余离线实施的理由。**

# S05 本地验收结论（组合与尾部风险 / 人工承载能力）

- 运行时间：2026-09-22T01:30Z；角色：**仅本地验收**，不主导设计、不改主实现。
- 状态：`READY_FOR_REVIEW`（不自签 ACCEPTED，裁决权在用户/指定审查者）。
- 三个主源码文件 `portfolioRiskSnapshot.ts` / `portfolioStress.ts` / `humanCapacityPolicy.ts` **本轮零改动**；本轮只新增 1 个测试文件与本证据目录。

## 基线核验与历史完整性

| 项 | 结果 |
|---|---|
| 需求远端 HEAD | `46b66fd8647e1204cf16819deac007131eb34f40` |
| `git ls-remote` 实测 | 精确一致 |
| 本地推进方式 | `git merge --ff-only origin/codex/v396-final-convergence-20260922`，`0fd0834 → 46b66fd` |
| rebase / squash / force | 无 |
| 工作树（验收前） | clean，0 项未提交 |

## 门禁（全部在测试文件落地后复跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 契约/核心构建 | `npm run build -w @zdj/contracts && npm run build -w @zdj/core` | exit 0，无错误 |
| Engine 类型检查（第一阶段，源码原样） | `npm run typecheck -w @zdj/engine` | exit 0，`error TS` 0 条 |
| Engine 类型检查（加入测试后） | `npm run typecheck -w @zdj/engine` | exit 0 |
| S05 敌意测试 | `npx vitest run src/services/s05PortfolioTailRisk.test.ts` | **76 passed / 0 failed** |
| 全仓 Engine | `npx vitest run` | **136 文件 / 882 测试全绿** |
| S00 静态门禁 | `node scripts/v396-s00-static-check.mjs` | T01–T06 PASS，blockers 0，`testFiles 136` |
| 空白/行尾 | `git diff --check` | exit 0 |

第一阶段编译结论：**三个新源码可编译，未触发“停止并上报”的分支**，因此进入第二阶段。

## 必测矩阵覆盖

| ID | 本轮 | 依据 |
|---|---|---|
| S05-T01 | PASS | `AI_ACTIVE→HANDOFF_PENDING→HUMAN_MANAGED` 仅改 ownerState：`grossNotionalUsd`/`notionalUsd`/`marginUsd`/`capitalAtRiskUsd` 逐项相等，压力损失与准入结论不变；同时断言 `snapshotHash` 必须变化（转手不可被当作同一事实重放） |
| S05-T02 | PASS | BTCUSDT+BTCUSDC 合并为单一 `BTC` underlying 且多空毛额分别保留；同 `dedupeKey` 的 reservation+order 只计一次且取较大事实；`UNKNOWN` pending 仍占额度并让快照 `complete=false` |
| S05-T03 | **NOT_RUN** | 属 S05-E 原子 JIT 与 `RuntimeState.reserveEntry()`，本轮明确排除 |
| S05-T04 | PASS | 8 条单边变坏轴 + 80 步确定性扫描（LCG，无时钟/模型随机）：压力损失不减、准入不得由 false 变 true；新增更坏场景不降低已报最坏损失 |
| S05-T05 | PASS | 26 条 fail-closed 行：档案缺字段/越界/NaN、场景集空/重复 id/空 id/越界、相关性版本缺失、维持保证金与清算缓冲缺失或为负、保证金币种无账户事实、账户资产 UNKNOWN/重复/零权益、现金流未验证、riskGeneration、时间、峰值权益、身份缺失、事实冲突 |
| S05-T06 | PASS | 三种 ownerState 各占 1 个潜在交接名额（AI 预扣自己的最坏情况名额）；待交接数、名额数、名义额上限与 ack 超时均阻断新增风险；`protectionAllowed` 在所有拒绝分支仍为 `true` |
| S05-T07 | PASS | peak 100 → 真实亏到 90，充值 +100 后权益 190：`flowAdjustedEquityUsd=90`、回撤 10%，与“无充值”账本逐位一致；`MAX_DRAWDOWN` 仍在剥离充值后触发 |
| S05-T08 | **NOT_RUN** | 需要 S04 退出任务与额度释放接线（S05-E 拥有），本轮无接线代码可测 |

额外敌意断言（全部通过）：`CLOSED` 覆盖非零数量 → `CLOSED_POSITION_HAS_RISK` 且数量仍按 1 000 计；同 scope+cycle 两条矛盾事实 → `POSITION_FACT_CONFLICT` 且按较大量 1 200 计（不取小）；未映射标的统一落入单个 `UNMAPPED_CORRELATED`（不散落、不当独立资产）；数组/对象键序改变而事实相同 → `snapshotHash` 不变，且任一实质事实改变 → hash 变；加风险或收紧预算只让准入变差（含 6 仓触发 `MAX_GROSS/CLUSTER/DIRECTION/CAPITAL_AT_RISK`）；S05 三模块仍为纯函数且**除彼此与本测试外无消费者**。

## 发现的源码缺陷

**P0：0；P1：0。** 未出现“事实不足却宣称安全”的判定，也未出现只改 ownerState 就释放风险的路径；所有缺信息分支都进 `blockers` 并使 `admissionAllowed/executable` 为 false。

5 条 P2 边界观察（都不阻断本轮，接线时必须处理，已逐条落测或落名）：

1. `PENDING_DEDUPE_KEY_MISSING` 的行被 `continue` 丢弃，`grossNotionalUsd/capitalAtRiskUsd` 不含它——只有 `complete=false` 挡住下游。**S05-E 读端必须先断言 `complete` 再取聚合量**，否则一个缺 key 的在途单会静默少算风险。
2. `materiallyDifferent()` 不比较 `maintenanceMarginUsd / liquidationBufferPct / handoffAt / acknowledgedAt`。两条只在这些字段冲突的事实不会标 `CONFLICT`；当前取值方向保守（维持保证金取 max、清算缓冲取 min、杠杆取 min→保证金取 max），故不释放风险，但冲突不被看见。
3. `HANDOFF_PENDING` 且 `handoffAt==null` 时永不逾期（`overdue` 需要 `handoffAt!=null`），ack 超时闸对该形状失效；快照侧也不缺这个字段。**本轮判 P2（模块未接线，无生产路径产生该形状），接线后即 P1**：建议 builder 对 `HANDOFF_PENDING && handoffAt==null` 直接产出 blocker。已用一条 characterization 测试钉住当前行为，避免被误读成“已覆盖”。
4. `snapshotHash` 有意排除 `createdAt`：同一事实在不同墙钟时刻 hash 相同。这对幂等/去重正确，但**不可当作新鲜度或水位证明**；S05-E 的 JIT 必须绑 `riskGeneration` + 显式时效，而不是只比 hash。
5. `PortfolioPositionFact.scope` 是自由字符串，模块不校验 canonical。现存 `humanManagedProjection.ts` 仍用非 canonical 的 `${symbol}:${side}`，并由 `v396OfflineStages.ts` 暴露一个同名函数 `portfolioRiskSnapshot`（与新模块无关）。若接线时把非 canonical scope 喂进权威快照，同一仓位会静默分裂成两个身份。**建议 S05-E 入口强制 canonical scope**，并把同名旧函数改名或标注 deprecated。

## 剩余缺口（不上调为 ACCEPTED 的原因）

- S05-A～D 仍是**未接线的离线纯模块**：无消费者、无生产事实来源，`G2 = NOT_ACHIEVED`，RI 提分尚无真实账户基准（需 S05-E/S10 的冻结数据或 Testnet 证据）。
- S05-T03、S05-T08 本轮 `NOT_RUN`（越出用户设定的本轮边界）。
- 风险档案（`PortfolioRiskProfile`）与相关性映射目前只来自调用方，**未写任何默认实盘值**；上线前需用户确定资本与值守安排。
- 未做 S05-E、未改 `RuntimeState.reserveEntry()`、未进入 S06。

## 移交

给 S05-E：canonical scope 强校验、`complete` 前置断言、`HANDOFF_PENDING` 时间戳缺口、hash 不作水位。
给 S09：冻结风险档案 + 相关性版本 + 无人响应（ack 超时）场景的重放基线。
给 S10：真实资本限额、保证金币种/跨模式支持边界、人工容量与账户隔离的现网准入证据。

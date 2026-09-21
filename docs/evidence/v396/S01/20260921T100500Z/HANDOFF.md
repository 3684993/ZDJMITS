# S01 handoff

阶段/子 PR：S01-A/B/C；实施：luna（独立离线实施，S01-A 核心 UNKNOWN 语义不委派）；状态：`READY_FOR_REVIEW`。

## 1. 身份与范围

- base SHA：`1b7e38f8d40a9ad11f1c0bff68cb9cf3c5e87a95`；head SHA：见本交付提交；worktree：`D:\MITS-WORKTREES\v396-s01-20260921`。
- 依赖 ACCEPTED 证据：`docs/evidence/v396/S00/20260921T145000Z/conclusion.md`，范围仅为 S00 规格与隔离基线。
- 解决：UNKNOWN 风险事实不能被旧缓存或 `-2013` 推成永久无风险；账本收益未知不入绩效分母；采集速率按同身份真实时间段计算，重启分段且峰值使用 max。
- 改动：`apps/engine/src/services/experienceService.ts`、`apps/engine/src/services/s01TruthAccountingObservability.ts` 及其测试、`packages/core/src/eip.ts`；无迁移版本。证据与迁移说明见本目录。
- 未改但保留的后续风险：Entry/manual/TP 统一 scope 与数量预算仍属 S02/S04；S01 不解决该边界。`minNetProfitRoiPct=0.15` 仍按 0.15% 解释，未改配置。
- 网络/交换写/Settings 修改/生命周期动作：均无。未启动、停止、重启或热重载 Engine，未发单，未部署。

## 2. 契约与设计

- CONTRACTS：`V396-C1`；涉及 I01/I02/I04/I05/I06/I07/I09/I11/I12；测试映射见 `test-results.md`。
- 新输出：`ExperienceSummary.coverage` 与纯投影 `RiskFactCoverage`、`CollectorWindowSummary`、Primary 状态分类；默认只读，不改变执行开关。
- UNKNOWN/部分成交/重启：缺少历史覆盖、身份冲突、资金费或费用归属时保持 UNKNOWN/PARTIAL；重启形成新 collector segment，不跨段计算速率；原始事实不删除。

## 3. 验证结果

详见 `test-results.md`：新增与回归测试合计 135 项 PASS；contracts/core build、engine typecheck、S00 静态基线复验 PASS。

- 账本守恒：cycle quantity conservation、费用缺失、资金费 UNKNOWN 与 canonical net 资格测试 PASS；未知费用/资金费未填零。
- 风险不变式：未知终态、迟到成交、WS gap、无历史覆盖均不释放占用；fresh current-no-risk 证据带 validUntil。
- 经济证据：只消费已有 canonical net；资金费不明确时 `netPnl=null`，不进入经验统计分母。

## 4. 迁移与回退

无数据库迁移、无备份、无不可恢复项；`coverage` 为可选字段，旧 reader 兼容。详见 `migration-notes.md`。

## 5. 结论与下一阶段输入

- 自评：工程合格，提交 `READY_FOR_REVIEW`；不能代替独立审计的 `ACCEPTED`。
- 未决：独立审计需核对 S01-T06/T08/T09 的实际持久化来源与全量入口边界，并复核本提交没有把纯投影误当成运行时授权。S02/S04 的共享 scope/quantity budget 不得因本交付提前进入。
- 下一阶段输入：`RiskFactCoverage`/`CollectorWindowSummary` 类型与测试，`ExperienceSummary.coverage`；在 S01 审计通过前不得进入 S02。
- 总设计裁决问题：无；按用户约束等待独立审计。

审查者：待 terra 独立复核；结论：待定（当前仅 `READY_FOR_REVIEW`）。

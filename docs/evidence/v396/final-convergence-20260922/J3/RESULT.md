# J3 完整不可变 TradePlan、数量/期限/目标候选与提交闭环

输入基线 `7448fbe`。执行令：`docs/plans/v396/CODEX-FINAL-CLOSEOUT-20260922.md` §4；规格：`docs/plans/v396/06-trade-plan-sizing-horizon.md`。机器可读结果：[manifest.json](manifest.json)。

## 必须先说的环境更正（影响前两轮门禁可信度）

本 worktree 的 `node_modules/@zdj/{contracts,core,engine,dashboard}` 是指向**另一个 worktree**（`v396-design-completion-20260921`）的符号链接。也就是说 J1/J2 的门禁部分解析到陈旧的 contracts 包（那份 `riskGovernance.ts` 里没有 `exitCoordination`/`portfolioRisk`）。已把四个链接重指到本 worktree 内的真实包目录（junction；`node_modules` 被 `.gitignore` 忽略，未改任何仓库文件），并在修正后的环境中复跑全部门禁：J1 22 项、J2 15 项与 J3 16 项以及整仓 145 文件 1029 项一起重新通过。J1/J2 的结论不变，但其数字现在是在正确解析下测得的。

这也解释了 J3 里最刺眼的现象：新导出 `TradePlanSchema` 后 `tsc` 报「no exported member」——不是代码问题，而是解析目标错了。

## 之前的事实

`v396OfflineStages.ts` 里只有一个 `TradePlan` 记录类型与 `validateTradePlan`（仅测试调用）；数量、期限、目标价全部由模型输出直接进入 intent；`entryCoordinator` 只做“是否在 envelope 内、是否达到经济地板”的判断，没有可复算的计划、没有计划与预留的先后关系、成交后没有原计划与实际的差异记录。J1 的 AI 退出端口 `planOf` 恒为 null。

## 现在的事实

- **契约**：`packages/contracts/src/tradePlan.ts` 的 `TradePlanSchema`/`TradePlanCandidateSchema`/`ExecutedPlanRecordSchema` 全部 `.strict()`；WAIT ⇒ 数量=0 且无 target/候选；PLACE 必须绑定系统解析出的 `candidateId`；`entryTtlMinutes ≤ targetHorizonMinutes` 且 `managementDurationMs ≥ targetHorizonMinutes*60_000`；`modelConfidenceIsAuthority` 只能是 `false`。
- **候选**：`quantityHorizonCandidates.ts` 从交易所 `minNotional/minQty` 起算最小合法数量（旧实现从 1 步起算，会在低价币上造出低于最小名义价值的假候选）；利润地板取“计算后真正满足 net≥required 的第一个 tick”（求解器有容差，对齐一次不可信）；统计上限只用已闭合样本的 `hardMaxMovePercent`，无样本就没有上限，也没有概率。
- **模型只能选**：模型给出（数量、目标、期限）与理由/证据引用，生成器验证并重算出唯一 `candidateId`。伪造 id ⇒ `PLAN_CANDIDATE_ID_FORGED`；复述不同数字 ⇒ `PLAN_PARAMETER_OUTSIDE_CANDIDATE`；期限不在档位 ⇒ `CANDIDATE_HORIZON_UNSUPPORTED`；谓词是代码 ⇒ `PLAN_PREDICATE_UNSUPPORTED`。
- **NO_TRADE 规则**：最小合法数量达不到自身利润地板即 `NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY`，不提供“更大数量”作为出路（S06-T02）。
- **持久化顺序**：原计划写一次（`putTradePlan` 幂等、版本单调）进 `runtime_entities(kind='tradePlans')`，随运行时检查点在同一事务落库；**计划落库在 `reserveEntry` 之前**，计划被拒时不留 intent/order；成交只追加 `planExecutions`，`predictionMutated:false`（S06-T07）。
- **AI 退出闭环**：J1 留下的 `AI_PLAN_UNPROVEN` 缺口关闭——`aiExitPlanFactsOf` 是唯一读取 AI 退出计划事实的入口，`appRuntime` 的 `planOf` 端口调用它；无计划、WAIT 计划、跨 scope 一律 null，AI 权限不来自任何持仓标签。

## 红测（S06-T01–T09）

见 manifest 的 `redTests`。全部先在 `j3TradePlanHostile.test.ts` 复现再修，16 项通过。

## 门禁（仓库根目录执行，环境修正后）

Engine 1029/1029（145 文件，J2 后基线 1013/144）；core 46/46；dashboard 17/17；contracts 0 用例（exit 0，不计为契约覆盖）；contracts/core/engine/dashboard build 均 exit 0；engine/dashboard typecheck exit 0；S00 T01–T06 PASS、108 入口、0 blockers、145 测试文件全部隔离、0 仓库 dataDir 引用、0 生产端口引用；`git diff --check` exit 0。

## 已知未闭合（不伪造）

1. 候选的 `fundingEstimateUsd` 目前恒为 `UNPROVEN`：没有 S01 资金费归因就不编造费率。
2. AI `minNetProfitUsd`/`maxRealizedLossUsd` 的编辑面、字段矩阵与页面回读属 J5。
3. 计划的复核预算与 token 记账属 J4。

## 实际边界

只在隔离 worktree 内以临时/mock SQLite 与 mock adapter 运行；没有启动/停止/重启/热重载 Engine，没有部署，没有交易所写接口调用，没有修改现网 Settings/DB/dist。

# V3.9.6 最终收敛审计与验收报告

2026-09-22；总设计审查，**实施后重评**。**结论：J1–J6 可离线项全部闭环，整仓门禁全绿；项目状态 `READY_FOR_TESTNET_AUTHORIZATION`。** 这不代表 `ACCEPTED`、不代表盈利、不代表部署或交易所写权限；`ACCEPTED` 只由独立验收方签署。

- 唯一分支 `codex/v396-final-convergence-20260922`；HEAD `1f2643e`；父链含基线 `51e7e1e5af06510a95bca3f075da94ececd2b06c`（`git merge-base --is-ancestor` 退出 0）。
- **PR #9 未改**：远端 `refs/pull/9/head = 2b502ec6a71a2079a273773a9b029f0ae24c9b42`，本轮所有 push 只 fast-forward 到 convergence 分支，无 rebase / squash / force / 历史重写。
- 逐 J 证据：[J1](../evidence/v396/final-convergence-20260922/J1/RESULT.md)、[J2](../evidence/v396/final-convergence-20260922/J2/RESULT.md)、[J3](../evidence/v396/final-convergence-20260922/J3/RESULT.md)、[J4](../evidence/v396/final-convergence-20260922/J4/RESULT.md)、[J5](../evidence/v396/final-convergence-20260922/J5/RESULT.md)、[J6](../evidence/v396/final-convergence-20260922/J6/RESULT.md)；身份材料 [release-manifest.json](../evidence/v396/final-convergence-20260922/J6/release-manifest.json)、[experiment-manifest.json](../evidence/v396/final-convergence-20260922/J6/experiment-manifest.json)、[storage-coverage.json](../evidence/v396/final-convergence-20260922/J5/storage-coverage.json)。

## 1. 本轮实际完成（先红测，后修复，再复跑全仓）

| J | commit | 关掉的具体缺口 |
|---|---|---|
| J1 | `5688478` | 收敛只在启动时跑一次 → 持续收敛有界跑；旧 TP/人工单先证采纳再准备（原顺序会先备好减仓单再发现未采纳）；FIRST_FILL 一次性写死管理期限；AI 退出走 OFF/SHADOW/ENFORCE 三档且 OFF 零提交；真实成本装配（缺 FX/funding/深度即拒） |
| J2 | `7448fbe` | `selectionGeneration` 冒充 riskGeneration → 组合准入成为新增风险唯一真源并绑进 C2 `BEGIN IMMEDIATE` 同一事务；`reserveEntry` 无票据即 `RISK_ADMISSION_UNPROVEN`；白名单由文件内容重建 |
| J3 | `29878f3`/`26e64c1` | 模型数字直进 intent → 系统计算 q/T/目标候选 + 不可变计划；计划落库严格先于预留；成交只追加差异（`predictionMutated:false`）；sub-1 价格阶梯与 `minNotional` 修正 |
| J4 | `a5dcf27` | 有原语无消费者 → 有限复核调度器 + 用量台账 + 交易记忆全部接上生产路径；`REVIEW_BRAIN` 从只有类型变成真实调用；迟到回答只归档；usage 缺失记 `UNKNOWN` 而非 0 |
| J5 | `a7b022b` | 设置面无单位/消费者/回读 → 治理字段矩阵落到写入边界；`aiExitMinNetProfitUsd` 从死字段变成与计划地板并取高者的真许可线；ownership sqlite 进备份与版本闸门；storage blocker → 推导出的 PASS |
| J6 | `1f2643e` | 无回放/统计/发布材料 → 预注册清单、事件与成本回放器、块自助 bootstrap 与四态判定、结果生成器、release manifest、迁移/canary/soak 运行手册 |

## 2. 整仓门禁（仓库根目录，逐项取真实退出码）

| 检查 | 结果 |
|---|---|
| Engine 全仓 | **1135/1135 PASS**（149 文件），exit 0；起点 975/144 → +160 例 |
| core | 46/46 PASS，exit 0 |
| dashboard | 25/25 PASS（9 文件，本轮新增 8 例），exit 0 |
| contracts tests | **0 用例**，exit 0 —— 明确记为无契约覆盖，不计入成绩 |
| typecheck / build（含 contracts/core/engine/dashboard） | 全部 exit 0 |
| `npm run verify:scripts`（含预检自测） | exit 0 |
| S00 静态门禁 | exit 0；114 入口逐项复核；0 blockers；149 个测试文件全部只开隔离存储；0 仓库 dataDir 引用；0 生产端口引用；`exchangeWrites:0`、`network:NOT_USED`、`engineLifecycle:NOT_USED`、`settingsModified:false` |
| storage coverage | `S08_STORAGE_COVERAGE_PASS`，blockingFiles `[]`（由脚本从仓库推导，非手写） |
| `git diff --check` / 工作树 | exit 0 / clean |

合计 **1,206 个通过用例**（1135+46+25），不重复计反复运行。package/release 身份已统一为 **3.9.6**（`RELEASE_VERSION`、`API_VERSION` 与五个 `package.json` 全等，由脚本强制）。

## 3. 20 项成熟度证据重评

分值（0–5）由独立审查者按 `ACCEPTANCE-SCORECARD.md` 的等级定义给出；本表只给**证据引用 + 状态**。状态语义：`PASS` = 该条目在离线/隔离集成范围内的必测证据闭合；运行期样本外证据另列，不并入 PASS。本轮**不重算总分、不宣布分数提升**，历史 46/100 与扛单 3/10 保留为旧结论。

| ID | 证据引用 | 离线工程状态 | 运行期/样本外状态 |
|---|---|---|---|
| EX1 | J1（`convergePeriodically`、`jitBeforeSubmit`、FIRST_FILL 期限）、J5（schema 版本闸门） | PASS | NOT_RUN（真实并发窗口） |
| EX2 | J1 采纳竞态、S04 T01–T10、`c3RuntimeWiringHostile` | PASS | NOT_RUN |
| EX3 | J1 真实成本装配、J4/J5 的 `aiExitMinNetProfitUsd` 与许可线、S03 R5 身份 | PASS | INSUFFICIENT_EVIDENCE（真实 fee/funding 全链回灌需运行） |
| EX4 | R16 出口双层 fail-closed（既有）、J1 恢复只查询 | PASS | NOT_RUN |
| DA1 | J1/J2 现金流与 FX 事实、J4 usage `UNKNOWN` 语义 | PASS | NOT_RUN |
| DA2 | R17 监测（历史轮）、J4 台账不吞失败 | PASS | PENDING_WINDOW_INCOMPLETE（7 日窗未跑） |
| DA3 | J5 字段矩阵/回读、J6 release manifest 身份 | PASS | NOT_RUN（告警与备份恢复演练需授权） |
| RI1 | J2 单一准入 + C2 同事务、`j2PortfolioAdmissionHostile` 15 例 | PASS | NOT_RUN |
| RI2 | J2 保证金档/相关性/情景版本判定（缺则拒），J6 清算与相关簇情景建模 | PASS | INSUFFICIENT_EVIDENCE（档表需操作者提供；尾部序列未完整建模） |
| RI3 | J2 `humanCapacityPolicy`、J4 人工零调用、J6 人工响应四情景 | PASS | NOT_RUN |
| RI4 | J5 限额逐字段单位与生效时点、J6 预注册风险预算必须来自 S05 | PASS | NOT_RUN |
| ST1 | J6 `detectFutureAvailabilityViolation`、`validateSplitIntegrity`、embargo ≥ 最长评价窗 | PASS | NOT_RUN（真实冻结事件流不存在） |
| ST2 | J6 净值/回撤/尾部/占用/覆盖 + 块自助区间 | PASS（工具与判定） | NOT_RUN |
| ST3 | J6 六组预注册、缺组即 INSUFFICIENT、失败组不得删除 | PASS（机制） | NOT_RUN |
| ST4 | J6 判定函数：CI 跨 0 / 成本不全 / 样本不足 一律 INSUFFICIENT_EVIDENCE | — | **INSUFFICIENT_EVIDENCE（无样本外结果，按定义不得给经济结论）** |
| AI1 | J3 候选复算与证据 DSL、无概率时不默认 50%、confidence 非权威 | PASS | NOT_RUN |
| AI2 | J4 调度器（预算/去重/迟到撤权/HUMAN 零调用）、`s07ConsumerBoundary` | PASS | NOT_RUN |
| AI3 | J4 正反例与右删失、人工接管三数桥、缺点位则不可计算 | PASS | INSUFFICIENT_EVIDENCE（真实样本消融未跑） |
| OP1 | J5 矩阵逐字段消费者断言 + `PATCH/GET /settings/governance` 回读 | PASS | NOT_RUN |
| OP2 | J5 durable 备份指纹与版本闸门、J6 runbook 七步演练模板 | PASS | NOT_RUN |

扛单治理子表：资本承受 / 组合约束 / 人工交接 / 经济可见 / 经验验证五项的**离线机制**均已实现并有测试（AI 许可线与账户线分离、人工容量扣减、未平仓进分母、删失与深亏可见、回放含强平与下架）；运行期与档表供给相关的两项保持不足。

## 4. 六个硬门

| 硬门 | 状态 | 依据 |
|---|---|---|
| H-SAFETY | **离线 PASS / 整门 INSUFFICIENT_EVIDENCE** | 本轮变更涉及的 I01–I12 均有红测→修复→回归；无未处置的离线可复现 P0/P1。运行期并发与恢复窗口未跑，故整门不升格 |
| H-TRUTH | 离线 PASS / 样本外 INSUFFICIENT_EVIDENCE | 未知量一律显式 `UNKNOWN`/null 并进分母（usage、funding、深度、接管点、清算序列）；无“删亏损换绿”的路径；但无真实入选样本可验 |
| H-RISK | INSUFFICIENT_EVIDENCE | 限额、单位、生效时点与拒新风险默认已可配置可审计；**保证金档表、真实相关性/情景集与人工失联残余风险的书面接受仍未由操作者提供** |
| H-ECONOMICS | **INSUFFICIENT_EVIDENCE（按定义）** | 无样本外结果、无 token 对照；本轮只交付并验证了测量工具与诚实出口 |
| H-OPS | INSUFFICIENT_EVIDENCE | ownership 账本进入备份/保留并通过逐表指纹校验；schema 新版本被旧构建拒绝；但真实迁移/回退/canary/soak 演练需 Engine 生命周期授权，未执行 |
| H-AUTHORITY | **PASS（操作边界）** | 未启停 Engine、未部署、未改 live Settings/DB、未调用交易所写接口、未开任何 AI 权限；ENFORCE/SHADOW 与写权限均需显式 ack 且默认 OFF |

## 5. 残余风险、停止线，以及唯一需要的运行授权

需要**明确逐项授权**才可推进的（本轮一项都没做）：

1. 真实库迁移 + 回退演练（先决条件：J5 runbook 第 1 节隔离演练全绿）。
2. SHADOW 观察窗（AI 退出 SHADOW、复核关闭、READ_ONLY）。
3. Testnet 有限写回合（含 `ack=AI_EXIT_ENFORCE_AUTHORITY` 的权限开启）。
4. 24 小时连续 soak（窗口未满即 `PENDING_WINDOW_INCOMPLETE`，重启则重开时钟）。
5. 冻结事件流样本外回放与 token 对照（需真实 usage 的同一事件集）。

明确**不该再优化**的方向（避免把工程分数当经济证据）：

- 不要再动 `0.15`、`aiExitLossLimitUsd=10`、可达性阈值等任何判据去凑 PASS——J5 的单位确认与 ack 正是为堵住这条路而加，任何“看起来更像通过”的阈值改动都按作弊处理。
- 不要为了减少 `UNKNOWN` 数量而给缺失的 funding/FX/深度/token 填 0 或默认值；`UNKNOWN` 占比本身就是需要观测的指标。
- 不要继续扩大模型推理面：本轮的收获是**边界**（默认 OFF、零例行调用、预算与迟到撤权），提高调用量不会补上经济证据缺口。
- 不要再增加离线测试当作进度：离线侧已到收益递减点，缺口全部集中在 1–5 的运行证据上。

本轮没有启动、停止、重启或热重载现网 Engine（期间观测到本机 8080 在监听，预检据此拒绝执行 CLI 分支，未作任何干预）；未改现网 Settings/DB/dist；未部署；未访问交易所写接口；GitHub 推送只含源码/文档/证据，且全部为 fast-forward。

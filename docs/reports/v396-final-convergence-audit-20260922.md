# V3.9.6 最终收敛审计与验收报告

2026-09-22；总设计审查。**结论：本轮补丁验证通过；V3.9.6 尚未全部实施，整体 NOT_ACCEPTED / NOT_READY_FOR_TESTNET_AUTHORIZATION。** 不是实盘发布结论。

规格基准 `d3f6d262f3bcc05dbd3d9b793f8a3f41da7e5fee`，逐文件核实 **16 份、944 行**。最新远端输入 `e1ed854`；本轮代码提交 `d77a62a`（Round1.1）、`abc158c74367d351fcf7cb4d4cd65db05de6aac0`（最终加固）。唯一分支 `codex/v396-final-convergence-20260922`；冻结父链保留，PR #9 未改。

## 1. 本轮已经实际完成

先执行红测，再修复产品路径，最后跑全仓：

- 人工 TP 的价格作为绑定指令；Guardian 不再另选价格。REPLACE_TP/REBUILD_TP 传真实交易步长，先持久 HUMAN mandate，再持久 claim，再发送。
- 修复跨账户同周期任务 ID 覆盖；整个 scope 内跨周期/外部 UNKNOWN claim 共同占用数量。新 ID 使用 120 位 SHA-256 摘要，已有任务保留原 ID。
- capabilities 异步等待后重验撤权与证明时效；提交前再次检查 owner/mandate，拒绝旧授权。
- UNKNOWN 不能被伪 PREPARED 或零成交 FILLED 释放；本地状态标签不能代替交易所终局事实。恢复验证账户、订单、交易对、数量及状态。
- TP 确认撤单同步 claim；部分成交量保留。提交前把真实 clientOrderId 写入运行投影和事件，回执丢失仍查原 ID。
- 确证 -2022 拒绝允许新 intent 修复；超时、重复、-2013 或未查实仍保守占用，禁止盲目换 ID 重发。

红测/最终 JSON 与复现说明：[C3 最终证据](../evidence/v396/final-convergence-20260922/C3/FINAL-HARDENING/RESULT.md)、[Round1.1](../evidence/v396/final-convergence-20260922/C3/ROUND1-1/RESULT.md)。没有通过删除安全断言换取全绿；旧测试的“本地标 FILLED/CANCELED”改成了确证交易事件。

## 2. 16 份规格对应的真实进度

| 阶段 | 当前证据与裁决 | 尚缺什么 |
|---|---|---|
| S00 | 规格/身份/隔离基线成立，静态复验 PASS | 不代表后续功能通过 |
| S01 | UNKNOWN 当前风险、收益分母、collector 分段、Primary 分类已有实现/回归 | 完整资金费与资本事实桥接、真实 WS/存储/Primary 告警及 R17 监测闭环仍需逐项验收 |
| S02 | durable ownership/CAS/outbox/期限基础、人工接管有离线证据 | 首次真实计划成交→固定 deadline→有限复核→到期接管全链尚未接通；不能用旧 AUTO 标签冒充 AI_ACTIVE |
| S03 | 成本/净亏损权限纯模型与边界测试成立 | `s03AiExitPolicy`/estimator 没有实际 AI 管理消费者；真实 fee/funding/quote 证据接线未完成 |
| S04 | MANUAL/TP 已接 durable coordinator；本轮修复并发/恢复/撤权缺陷 | AI 策略路径仍 OFF；持续对账结果完整回灌、旧在途 TP/adoption、统一 JIT 的全链验证未闭合 |
| S05 | 组合/压力/人工容量纯模型、C2 durable reservation 基础成立 | `evaluatePortfolioStress`/`evaluateHumanCapacity` 没有生产消费者；capital generation 不是 S05 风险快照，G3 未实现 |
| S06 | 仅简化 TradePlan 原语与旧入场功能 | 无完整 q/T/目标候选、证据 DSL、预期分布、原计划到 intent/fill 闭环；不能称完成 |
| S07 | 仅 token 求和原语和既有经验模块 | 无有限 review scheduler、真实全入口 usage ledger、失败预算、双向/删失记忆闭环；节省 ≥30% 未证明 |
| S08 | 既有页面/API 与局部管理接线可构建 | 新设置逐字段消费者/回读/单位、独立 AI 微利阈值、持仓计划/预算页面、全量迁移回退未完成 |
| S09 | 仅 availableAt 过滤与 manifest hash 原语 | 无完整冻结回放/消融/尾部与样本外实验；工程工具缺失和经济样本不足是两回事 |
| S10 | 有规格和早期 readiness 材料 | 完整发布身份/迁移预演包尚不充分；本版本 canary、SHADOW 运行窗、24h soak 均 NOT_RUN |

证据不是仅靠文件名：非测试消费者扫描、源码行号、原规格/当前文件 SHA-256 见 [plan-traceability.json](../evidence/v396/final-convergence-20260922/FINAL-AUDIT/plan-traceability.json)。例如 `humanHandoffAfterMinutes` 仍只有 schema 命中；`validateTradePlan/tokenLedgerTotal/replayAvailable` 的命中为原语定义，没有实际调用链。S05 消费者边界测试也明确固定“尚未接入准入”。

旧 `continuous-offline-20260921/COMPLETION-MATRIX.md` 的 READY_FOR_REVIEW 只描述当轮原语交付，**不采纳为各完整阶段已实施**。不删除旧证据；以本报告为最新整版裁决。

## 3. 验证结果及可信范围

| 检查 | 实测结果 |
|---|---|
| Engine 全仓 | 975/975 PASS |
| core | 46/46 PASS |
| dashboard | 17/17 PASS |
| contracts tests | 0 个用例，命令 exit 0；不算完整契约覆盖 |
| contracts/core/engine/dashboard build | 全部 exit 0 |
| engine/dashboard typecheck | 全部 exit 0 |
| S00 | T01–T06 PASS，108 入口，0 blockers |
| diff check | exit 0 |

共 **1,038 个通过的测试**；不同反复运行不重复计入。构建仍标 package 3.9.4，不能冒称完整 3.9.6 发布身份；等全阶段完成后统一登记，不在审计中只改版本号制造完成。

## 4. 硬门、P0/P1 与评分

| 硬门 | 本次整版裁决 |
|---|---|
| H-SAFETY | INSUFFICIENT_EVIDENCE：本轮可复现缺陷已修，但完整 I01–I12 生产链未交付 |
| H-TRUTH | INSUFFICIENT_EVIDENCE：真实成本、资金流及全周期桥接未完 |
| H-RISK | INSUFFICIENT_EVIDENCE：S05 生产准入缺失，资金/人工值守配置未定 |
| H-ECONOMICS | INSUFFICIENT_EVIDENCE：无合格样本外结果、无 token 对照结果 |
| H-OPS | INSUFFICIENT_EVIDENCE：完整新版本迁移/回退及运行窗未验 |
| H-AUTHORITY | PASS（仅本轮操作边界）：没有扩大交易权限，不代表未来部署授权 |

本轮反证定位的缺陷已通过修复回归。**不能签发“整版 P0/P1 清零”**：S04 持续恢复/原有在途单接入、S05 全账户准入、S06–S08 管理闭环是未关闭的发布阻断，下一计划按 P1 优先处理。不能将“新 AI exit 关闭”计为其功能已经通过。

历史 **46/100、扛单治理 3/10** 保留为历史评估，不是本次新分数。此次未对 20 项成熟度证据完成全部重评，故不伪报 85 分或盈利提升。10 USDT 仍是 AI 实现净亏损权限线，不是账户损失上限；专业级/实盘就绪及盈利改善均未获得本轮证据支持。

## 5. 下一步和边界

具体文件、依赖、红测与完成标准见 [剩余实施闭环计划](../plans/v396/FINAL-REMAINING-IMPLEMENTATION-20260922.md)。顺序：持续退出事实→全账户准入→交易计划→有限复核/token/记忆→设置/运维→回放/发布材料。只有这些离线项完成，才讨论具体 Testnet 授权；不能把离线缺失统称外部等待。

本轮没有启动、停止、重启或热重载现网 Engine，没有改现网 Settings/DB/dist，没有部署或访问交易所写接口。只在隔离 worktree 编译、mock 测试和临时 SQLite 中验证；GitHub 推送只包含源码/文档/证据。通知脚本另按用户要求执行。

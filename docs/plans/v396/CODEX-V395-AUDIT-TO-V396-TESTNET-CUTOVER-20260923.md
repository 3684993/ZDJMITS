# Codex：V3.9.5 审计 → V3.9.6 Testnet 一次性切换授权

本文件记录用户对本次**特定 Engine 生命周期操作和 Testnet 写入**的明确授权。它只适用于本次从当前 V3.9.5 到 V3.9.6 的 Testnet 切换，不构成任何生产环境写权限，也不允许安装自动启动/自动重启。

目标分支：`codex/v396-final-convergence-20260922`。

执行前先 `git fetch`，在 `D:\MITS-worktrees\v396-final-convergence-20260922`（或当前实际 convergence worktree）checkout 该分支并 `git merge --ff-only origin/codex/v396-final-convergence-20260922`。禁止 rebase / squash / force；PR #9 不动。记录实际 HEAD、工作树状态和 release manifest 身份。

权威材料：

- `docs/plans/v396/GPT6-ASTRA-V395-10H-AUDIT-20260923.md`
- `docs/plans/v396/RUNBOOK-S08-S10-OPERATIONS-20260922.md`
- `docs/reports/v396-final-convergence-audit-20260922.md`
- `docs/evidence/v396/final-convergence-20260922/J6/release-manifest.json`
- `AGENTS.md`

用户本次明确授权：

1. **停止当前 V3.9.5 Engine**，但必须在停止前完成并落盘最近 10 小时的运行审计；
2. 在 **Testnet** 环境完成 V3.9.6 的隔离迁移演练、当前 Testnet 数据迁移/切换、手动启动 V3.9.6、SHADOW 检查以及有限 Testnet 写回合；
3. Testnet `aiExitAuthority=ENFORCE` 如按 runbook 需要 `ack=AI_EXIT_ENFORCE_AUTHORITY`，本授权允许在满足前置条件后用于**本次 Testnet 有限写回合**；
4. **禁止任何生产环境交易所写入**；禁止把 environment/base URL/credential 指向生产后继续执行；
5. 遇到 V3.9.6 切换阶段真实 P0/P1，立即停止后续步骤并保留现场，不通过放宽阈值、删断言、填默认事实或反复重启取得 PASS。

---

## A. 停机前：V3.9.5 最近 10 小时只读审计

Engine 此阶段必须保持当前状态运行，不重启、不热重载、不改 live Settings/DB、不发额外交易所写请求。

严格回答 `GPT6-ASTRA-V395-10H-AUDIT-20260923.md` 的问题，尤其查明：

- AI 大脑最后一次明确分析时间 **2026-09-23 04:55:28（UTC+8）** 后为何停止分析；
- 04:55:28 后扫描 heartbeat、候选生成、准入过滤、AI 调度意图、AI 请求、返回、失败、预算/冷却/隔离、模型健康、私有账户和行情新鲜度各自是否仍推进；
- 当前驾驶舱 `RUNNING 持续扫描中：当前没有合格可执行机会。` 是否把“正常无机会”和“AI 链异常静默”混在一起；
- 最近 10 小时的开仓/平仓/持仓、已实现/浮动结果、费用/funding、UNKNOWN/异常订单、保护缺口；缺证据写 `INSUFFICIENT_EVIDENCE`，不得补 0。

候选根因逐项标记 `CONFIRMED / CONTRIBUTING / RULED_OUT / UNKNOWN`。不要先假设“没有机会”就是原因。

### A1. 审计报告必须先落盘

停止 Engine **之前**，生成并保存：

- `docs/reports/v395-runtime-audit-20260923.md`
- `docs/evidence/v396/runtime-cutover-20260923/v395-10h-audit/` 下的机器可读时间线/计数/只读查询结果（敏感 key/signature 不入库）。

报告至少包含：

1. 最近 10 小时时间线与交易摘要；
2. 04:55:28 后 AI 静默的根因裁决；
3. 哪一层最后仍有 heartbeat、哪一层首先停止；
4. >30 分钟 AI 无实际分析时驾驶舱是否能识别，缺哪些事实；
5. P0/P1/P2；
6. 停机前当前持仓、open/UNKNOWN orders、TP/保护状态、私有账户 freshness 的快照摘要。

先 commit/push 该审计报告（fast-forward）。在控制台先打印一段简短摘要，明确“审计已落盘，以下才开始停机”。**不需要等待用户再次确认**，因为本文件已包含后续授权。

### A2. 审计阶段的停止线

V3.9.5 本身发现普通 P1（例如 AI 调度静默缺陷）不自动阻止升级；它应作为 V3.9.5 根因报告的一部分。

只有发现会使立即停机/切换本身不安全的事实才在停机前中止，例如：

- 无法判定的真实活动订单可能造成重复成交；
- 未保护的现有持仓且停止 Engine 会扩大风险；
- 账户/环境身份无法确认，存在误连生产风险；
- 数据库正在损坏或无法生成一致备份。

这种情况保留 V3.9.5 原状态，不停 Engine，报告 blocker 后结束。

---

## B. 切换前现场冻结与停止 V3.9.5

A 完成且没有 A2 blocker 后：

1. 记录 V3.9.5 当前 PID、启动身份、版本、environment、executionMode、credentialRef、Testnet REST/WS 地址、当前 settingsVersion；禁止记录 secret。
2. 对当前 durable SQLite/配置做一致性备份与 hash/逐表行数指纹，记录当前 positions/orders/UNKNOWN/TP 摘要。
3. 使用仓库允许的**人工停止方式**停止当前 V3.9.5 Engine；不得 kill 后自动拉起，不得安装 supervisor/autostart。
4. 确认 8080 的原 Engine PID 已退出且没有第二实例占用。
5. 把生命周期时间、PID、停止结果写入 `docs/evidence/v396/runtime-cutover-20260923/lifecycle.json`。

本次用户明确授权这一次停止，因此满足 `AGENTS.md` 的生命周期授权要求。

---

## C. V3.9.6 隔离迁移演练与 Testnet 当前库切换

严格执行 `RUNBOOK-S08-S10-OPERATIONS-20260922.md`。

### C1. 先在副本做完整 rehearsal

对停机后的一致备份副本执行：preview → backup fingerprint → migrate → readback → restore → rerun/idempotency → newer-schema old-runtime rejection。

任何 runbook 失败信号都停止，不触碰当前 Testnet 原库；证据写到：

`docs/evidence/v396/runtime-cutover-20260923/migration-rehearsal/`

### C2. rehearsal 全绿后迁移当前 Testnet 运行数据

本授权允许迁移**当前 Testnet 使用的数据目录**，不允许生产环境数据库。

迁移前再次确认：

- exchange environment 明确为 TESTNET；
- base URLs 是 Testnet；
- 没有 production write capability 被启用；
- 备份可恢复且 hash/表指纹已落盘。

真实 Testnet 数据迁移必须保持：

- HUMAN_MANAGED 不回到 AI_ACTIVE；
- 无完整计划/期限的旧周期保守为 HANDOFF_PENDING；
- UNKNOWN/open order/quantity claim 不凭迁移释放；
- settingsVersion 单调；
- 失败则按 runbook 从备份恢复。

迁移失败属于 P1，恢复数据副本后**保持 Engine 停止**并结束，不自动启动 V3.9.5 或 V3.9.6。

---

## D. 手动启动 V3.9.6：READ_ONLY + SHADOW

迁移全绿后，从最新 convergence 构建明确的 V3.9.6 artifact。启动前从仓库根目录复核必要门禁及实际 exit code，确认 package/API 身份均为 3.9.6。

按 `AGENTS.md` 使用 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START` 手动启动一次 V3.9.6；本授权明确允许这一次启动。禁止 watch、热重载、自动重启。

启动设置必须先是：

- exchange environment = TESTNET；
- `connections.executionMode=READ_ONLY`；
- `aiExitAuthority=SHADOW`；
- `positionReviewEnabled=false`；
- `tradeEconomics.admissionMode=SHADOW`。

启动后核对 PID、health、版本、数据 readback、ownership/claims、positions/orders、private account status、市场数据、AI 服务状态。

### D1. SHADOW 判据

按 runbook 观察并记录事件计数：

- `AI_EXIT_SHADOW_DECISION`
- `AI_MANAGEMENT_DEADLINE_FIXED`
- `POSITION_FACT_UNVERIFIED`
- `RISK_*`
- `TRADE_PLAN_PERSISTED`
- review/usage ledger 状态和 `usageStatus=UNKNOWN` 比例

SHADOW 期间任何交易所写请求计数 > 0 视为 P0：立即停止 V3.9.6，保留 logs/DB/PID/事件现场，不进入有限写。

同时确认 AI 扫描/调度可观测性：不得仅凭总状态 `RUNNING` 推断 AI 正常。如果最后 AI 实际分析时间持续超过 30 分钟，必须在最终报告中明确这属于需要驾驶舱告警的状态，并区分“无候选 / 候选全被过滤 / 调度阻断 / 模型失败 / 事实 fail-closed”。本次不为了赶上线临时伪造告警事件。

---

## E. 有限 Testnet 写回合

D 全绿后，本授权允许继续，不必再次询问。

只允许 Testnet。切换写权限前再次打印并记录 environment/base URL/executionMode（不得输出 secret）；任何生产地址或身份不一致立即停止。

按 runbook 使用服务端 governance 写入边界启用所需 Testnet 档位；若 `aiExitAuthority=ENFORCE`，允许带 `ack=AI_EXIT_ENFORCE_AUTHORITY`。不得绕过 API/消费者直接改 SQLite。

有限写的目标是验证真实链路，而不是制造交易数量：

- 只接受系统正常准入产生的自然候选；
- 不降低质量/经济/风险阈值，不改 0.15 单位，不放宽 `aiExitLossLimitUsd`，不填缺失风险事实；
- 使用满足当前 Testnet filters 和既有 risk policy 的最小正常规模；
- 至少验证一条实际执行过的 `plan → intent → risk admission → durable reservation → exchange order/fill or verified terminal outcome` 链；若退出链被触发，再验证 coordinator clientOrderId/JIT/claim 收敛；
- 若当前执行窗口没有自然候选，不得强造概率/调参数换成交，报告 `TESTNET_WRITE_NOT_EXERCISED_NO_ADMISSIBLE_CANDIDATE`，保留 V3.9.6 Testnet 运行证据，不把它写成 PASS。

必须记录：`planId/planVersion/candidateId`、riskGeneration/snapshotHash、reservationId、clientOrderId、exchange terminal fact、`predictionMutated=false`、AI usage ledger；没有 usage 就是 UNKNOWN，不记 0。

出现以下任一项视为 P0/P1，立即停止后续测试并保留现场：

- 生产环境写入尝试；
- duplicate order / 双重 quantity claim / UNKNOWN 被错误释放；
- 迁移后 ownership/mandate 反向扩权；
- risk admission 绕过或 stale generation 成功预留；
- ACK 丢失后换新 ID 重发；
- 持仓/订单/DB 真值不可解释；
- Engine 崩溃、持续异常写风暴、无法安全维持 Testnet 状态。

普通“没有候选”“策略拒绝”“正常 UNKNOWN fail-closed”不是 P1，不得为了让测试成交而放宽规则。

---

## F. 成功后的运行状态

如果迁移、V3.9.6 READ_ONLY/SHADOW 和有限 Testnet 写回合均通过且无 P0/P1：

- **保持 V3.9.6 作为当前 Testnet 运行版本**，不要自动回退 V3.9.5；
- 生产环境继续禁止写入；
- 不自签 `ACCEPTED`；
- 24h soak 从这次稳定 V3.9.6 启动/最后一次重启后开始计时，未满仍为 `PENDING_WINDOW_INCOMPLETE`；
- 后续运行期证据继续追加，但不以“24h 未满”为理由恢复 V3.9.5。

不要自动停止一个健康的 V3.9.6 Testnet 实例，仅为了生成报告。

---

## G. 最终统一报告

生成：

- `docs/reports/v396-testnet-cutover-20260923.md`
- `docs/evidence/v396/runtime-cutover-20260923/` 下完整机器可读证据索引。

最终只汇报：

1. V3.9.5 最近 10 小时交易/运行摘要；
2. **2026-09-23 04:55:28 后 AI 停止分析的根因**与证据等级；
3. 驾驶舱是否误把 AI 异常静默显示成正常无机会，以及 >30 分钟告警缺口；
4. V3.9.5 停止时间/PID；
5. migration rehearsal 与当前 Testnet 数据迁移 verdict；
6. V3.9.6 启动版本/commit/PID/设置档位；
7. SHADOW 写请求计数及关键事件计数；
8. 有限 Testnet 写链实际证据，或 `TESTNET_WRITE_NOT_EXERCISED_NO_ADMISSIBLE_CANDIDATE`；
9. P0/P1/P2；
10. 当前 Engine 是否正在运行 V3.9.6，以及 24h soak 起点；
11. 明确确认生产写入次数为 0。

证据/报告可以 commit 并 fast-forward push 到 convergence 分支；不得修改 PR #9，不得 rebase/squash/force。

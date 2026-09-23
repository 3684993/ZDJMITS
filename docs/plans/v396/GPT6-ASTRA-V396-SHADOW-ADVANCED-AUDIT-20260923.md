# GPT-6 Astra：V3.9.6 SHADOW 高级运行审计与状态裁决

当前唯一收敛分支：`codex/v396-final-convergence-20260922`。执行前先 `git fetch` 并确认远端包含 `18a176549417821452ed3f2dc392d57c88805572` 及本任务文件。PR #9 保持冻结，不改写历史。

## 当前事实边界

V3.9.6 已完成离线实现、迁移修复和所有权账本重建，目前实际运行在 **TESTNET + READ_ONLY + aiExitAuthority=SHADOW + positionReviewEnabled=false + tradeEconomics.admissionMode=SHADOW**。最近一次复验：PID 26896，版本 3.9.6，buildId `3.9.6-e8b14777527e28bd3b80`；27 笔持仓与 27 张交易所侧 WORKING TP 一一对应；ownership 为 25 HUMAN_MANAGED + 2 HANDOFF_PENDING + 0 AI_ACTIVE；46 笔 UNKNOWN 均有 VERIFIED_NO_ACTIVE_RISK 证据；账本 integrity ok；Testnet/Production writes 均为 0；fatal/crash 为 0。两次本轮生命周期动作已经用尽。

同时存在两个重要未闭合事实：

1. AI 大脑仍长期静默：`capitalExecutableCount=0`，`lastRunAge` 已达数小时；驾驶舱仍显示“RUNNING 持续扫描中：当前没有合格可执行机会”。V3.9.5 停机前审计已确认，当时静默根因是持仓 gross exposure 超过权益口径上限，使候选在 AI 前被风险容量闸全部过滤，而现有 AI 健康状态把 `executableCandidates=0` 当成正常 idle，无法识别长时间 AI 静默。
2. E 段有限 Testnet 写回合仍 NOT_RUN。当前没有自然资本可执行候选；不能为了“完成 E 段”放宽风险阈值、改变损失线、造默认事实或强行制造交易。

权威材料优先阅读：

- `docs/reports/v396-ownership-ledger-rebuild-20260923.md`
- `docs/reports/v395-runtime-audit-20260923.md`
- `docs/reports/v396-testnet-cutover-20260923.md`
- `docs/evidence/v396/runtime-cutover-20260923/ledger-rebuild/post-start-verification.json`
- `docs/plans/v396/RUNBOOK-S08-S10-OPERATIONS-20260922.md`

本轮是**高级审计、根因分析和设计裁决**，不是机械改代码。不要启动、停止、重启或热重载 Engine；不要改 live Settings/DB；不要切 ENFORCE；不要发任何交易所写请求；不要为了验证而改变风险阈值。允许只读检查本机日志/API/数据库、运行事件、当前源码和既有证据。

## 问题一：AI 长时间静默究竟应该如何判定

请独立审计当前 V3.9.6 的 AI 调度与健康状态，不要只继承 V3.9.5 的结论。回答：

- 当前长时间没有 PRIMARY_BRAIN 分析，是否仍然完全由 `capitalExecutableCount=0` 解释？是否存在 V3.9.6 新增的 PortfolioRiskAdmission、TradePlan、review budget、ownership、fact freshness 等第二层阻断？
- 从市场/候选生成 → 规则过滤 → capital/risk admission → dispatch intent → AI request → AI terminal 的每一层，最近的 heartbeat/时间戳/计数分别是什么？哪一层持续活着，哪一层长期没有工作？
- “没有自然可执行候选”和“AI 调度器/模型服务异常静默”是否能用现有事实确定地区分？如果可以，给出严格状态划分；如果不可以，指出缺失的事实。
- 用户要求：AI 大脑超过 30 分钟没有实际分析时，驾驶舱不能只显示正常扫描文案。请判断 30 分钟应作为“告警触发条件”还是仅作为“进一步分类条件”；重点考虑真正长期无候选时的误报问题。
- 现有 `lastRunAgeMs`、候选最后进入 AI 时间、最后 dispatch intent、最后 AI request/success/failure、模型健康、queue/cooldown/budget、risk headroom、candidate supply heartbeat 是否足够构建状态机？不要为了简单而把不同故障合并成一个 `AI_OFFLINE`。

最终应形成清晰的状态语义，例如至少能区分：正常无候选、候选被规则过滤、组合容量耗尽、调度停滞、模型不可达、预算/冷却阻断、事实不新鲜 fail-closed、未知原因静默。具体名称可由你裁决，但必须互斥或说明优先级。

## 问题二：`capitalExecutableCount=0` 的当前真实根因

不要建议先调低阈值。请用当前 V3.9.6 运行事实做一条完整的“候选漏斗/阻断树”：

- 市场 cohort 中有多少成员；多少通过市场质量/方向/结构层；多少产生候选；多少达到风险预检；多少被 PortfolioRiskAdmission 拒绝；多少因为同 underlying、方向、gross exposure、cluster、margin asset、stress、human capacity、UNKNOWN/incomplete facts 被挡。
- 当前 27 笔持仓的 gross/long/short/underlying/cluster/保证金币种/人工潜在接管容量分别占用了多少预算；哪些限制是真正第一阻断项，哪些只是同时命中。
- `capitalExecutableCount=0` 是否符合冻结设计的保守风险策略，还是存在“旧 V3.9.5 gross exposure 口径被带入 V3.9.6 后过度保守”或重复计数/错误 dedupe/错误单位/错误 freshness 的迹象。
- 是否有某类 `UNKNOWN/incomplete` 长期把全部候选关死，却被驾驶舱归类成“没有机会”。
- 如果完全没有自然可执行候选是正确结果，请明确说明，不得把“无法完成 E 段”误判成版本失败；如果发现产品缺陷，请给 P0/P1/P2 等级和确定性证据。

## 问题三：当前 V3.9.6 SHADOW 的状态应如何裁决

基于已经完成的 P0 修复、账本重建、运行稳定性和当前只读证据，独立判断当前版本最准确的阶段状态。重点回答：

- 是否已经有足够证据称为 `SHADOW_STABLE`？若没有，缺的是运行时间、事件覆盖还是某项关键行为证据？
- 是否可以称为 `READY_FOR_LIMITED_TESTNET_WRITE_WHEN_NATURAL_CANDIDATE_EXISTS`，即“版本与账本已具备有限写前提，但必须等自然候选，不通过放宽阈值制造交易”？
- 当前是否还有任何 P0/P1 会阻止继续保持 V3.9.6 在线 SHADOW 运行？
- 24h soak 应从哪个可信时间点开始计，是否因为之前 P0 崩溃/账本重建必须以 PID 26896 的这次稳定启动重新起算？
- 哪些证据达到后才值得再次申请 ENFORCE/有限 Testnet 写权限？不要把时间流逝本身当成充分条件。

## 额外审计：驾驶舱 P1

请把“驾驶舱把 AI 长时间不工作显示为正常扫描”作为独立产品安全/可观测性问题审计：

- 当前显示文案由哪些字段驱动，为什么会把 exposure/risk capacity exhaustion 与正常无机会混为一谈；
- 用户真正需要看到的最小信息是什么：最后一次 AI 分析时间、静默时长、当前阻断层、最近候选供应 heartbeat、AI 服务健康、是否存在可执行候选等；
- 哪些情况应升级为 WARNING / DEGRADED / CRITICAL，哪些只需要 INFO；
- 是否已有足够事件支持，不需要新增昂贵模型调用即可完成告警。

本轮不要实施代码，只需要给设计裁决与最小修复边界，避免 Astra 在审计中顺手大改架构。

## 最终输出

请只提交一份高密度报告和必要的机器可读证据索引，至少包含：

1. 当前 V3.9.6 SHADOW 总体裁决；
2. AI 静默的当前根因树与证据等级；
3. `capitalExecutableCount=0` 的逐层漏斗和第一阻断项；
4. 驾驶舱 >30 分钟静默告警的状态语义裁决；
5. P0/P1/P2 列表；
6. 是否允许继续保持当前 V3.9.6 SHADOW 运行；
7. 是否达到 `READY_FOR_LIMITED_TESTNET_WRITE_WHEN_NATURAL_CANDIDATE_EXISTS`；
8. 下一步若需改代码，只列最小问题边界与优先级，不实施；
9. 明确确认本轮未使用 Engine 生命周期、未改 live Settings/DB、未切 ENFORCE、未产生交易所写请求。

不要自签 `ACCEPTED`，不要为了“推进阶段”制造自然界不存在的候选或经济证据。
# V3.9.2 AI 决策合同实施记录

基线：`4e72b6b99f0b64ca4b6fe5d31cb140848d4f7857`。

## 当前差异

已修改 10 个受控源码/测试文件：NO_EDGE 语义复审、真实 long/short executable context、经济事实、结构方向与交易方向分离、非 PLACE 清空执行字段、实时 episode 记录。

未触碰交易风险、Prompt 策略、9B、第三 27B、reasoning、TP Guardian、Reconciliation 或 Engine 生命周期。

## 已完成

- NO_EDGE 保存结构方向、拒绝层、阻碍/解除条件、事实快照与 TTL；5m 时间边界自身不再重启 Primary。
- `decisionContextKey` 现在写入 runtime route 的真实 `longExecutable`/`shortExecutable`。
- EIP/compact Primary facts 包含费用、往返成本、安全余量、目标移动、净经济门槛与同向空间（bps、来源）。
- 非 PLACE 归一化为 `tradeSide=null`、无 entry range/TP；保留正数 TP schema。
- `AI_RUN_TERMINAL` 写入 `decision_episodes` 的实时观测字段。

## 测试状态（当前会话）

- PASS：workspace typecheck。
- PASS：contracts build；`v392HistoricalDecisionRegression.test.ts`、`aiFabric.test.ts`、`v370Decision.test.ts`、`v370Contract.test.ts`（60 tests），其中已把旧 `direction` 断言改为 `structureDirection`/`tradeSide` 不变量。
- 新增：冻结数据表驱动 regression，覆盖 101 bar-boundary、118 low-change、199 direction-pollution 与 NO_EDGE+TP=0。
- 数据实证差异：根因报告文字称 22 个 TP=0；其冻结 `summary.json.failureRows` 实际只有 21 条 `TP_ZERO_SCHEMA + NO_DIRECTION_EDGE`。测试以可复现的 21 条源记录为准，未伪造第 22 条。

## 后续步骤

1. 第一次 `npm run verify` 在 Engine 全量测试发现一个旧断言：它禁止任意 `null`，与新增的可用空间事实（未知时合法为 null）冲突。已仅更新该断言为验证经济事实存在。
2. PASS：`v370Decision.test.ts`（9 tests）；随后第二次 `npm run verify` 完整 PASS（npm exit 0）。
3. 已提交：`fix(ai): enforce no-edge decision contract`。可在用户明确的手动 Engine 启动后进行 Testnet 对比观察；本会话未启动、停止或重启 Engine。

下一条命令：`powershell -ExecutionPolicy Bypass -File scripts/start-zdj-lan.ps1`（仅在用户明确要求手动启动时）。

## 本轮最终 Canary 证据与最小修复（2026-09-13 18:04）

证据包：`V392-ai-contract-canary-20260913-174648.zip`。15.02055 分钟，20 Primary（79.89055/h），11 PLACE、8 FAILED、1 窗口末 RUNNING；无 NO_EDGE。正式稳定样本 0，不能作为稳定基线验收。

- P0：7 次失败引用真实 `economics.entry`，该事实已提供却漏入 `compactFactIds`。只补齐已提供事实白名单；继续拒绝未知引用。
- 另一次 TP min/max 颠倒：保留严格拒绝，不自动交换范围、不改变 TP 策略。对应负向回归测试。
- P1：所有 28 个调度 PRIMARY_START 均无 triggerReason（其中 8 个在 preflight 阻断，实际模型调用20）。补齐 READY/WAIT/首次/恢复的触发来源，并随真实 AI_RUN_STARTED 持久化；不把调度事件当模型调用。
- P1：失败run未写 decision_episodes。补记失败证据，明确记录类型为 PRIMARY_INFERENCE_RUN，marketOpportunityEpisodeId 未建立时为 null；本轮无拒绝生命周期证据，不凭空分组或声称机会数。
- NO_EDGE TTL、timing event、细粒度空间变化风险保留待证：本轮没有 NO_EDGE，不据此修改门控，更不能声称已验收。

顺序：最小修改 → targeted机制回归 → 一次 verify。新构建的在线验证需要用户另行明确手动Engine生命周期指令；不能在已有Engine上假称新代码生效。

AI Contract阶段结果：targeted 46 tests PASS；原始8条失败离线重放7条经济引用恢复、1条非法TP范围继续拒绝。最终收敛轮唯一一次完整 `npm run verify` exit 1；后续兼容性修复的 targeted tests、typecheck、build 通过，未重跑完整 verify。不得将最终收敛轮写成完整 verify PASS。最终验收记录见同目录 final-acceptance.md。

2026-09-13 18:38：完成用户授权的一次停止旧PID3420/启动新PID40156，复用原数据。修复后两段5分钟Canary共20个READY/TP READY样本，但37次RISK_HEADROOM_EXHAUSTED preflight阻断、实际Primary=0。结果INCONCLUSIVE，非PASS；不commit/push、不触发新CI，不再重启。完整结果见final-acceptance.md最新章节。

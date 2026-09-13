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

# V3.9.6 正式 Testnet 执行激活轮（2026-09-24）—— 激活被 §B3 定义的采集缺口阻断

计划：`docs/plans/v396/CODEX-V396-FORMAL-TESTNET-EXECUTION-ACTIVATION-20260924.md`
分支：`codex/v396-final-convergence-20260922`，`fetch` 后 `merge --ff-only` 到 `423318c`（相对上一轮 `14be196` 仅多一个 docs/plans 提交）。
运行中的产品基线：`d570bef`（live `buildId=3.9.6-eaaabc52c682cc1ce56a`，与部署轮计算的 artifactHash 一致）。

## 结果

**激活未执行**，原因正是计划 §B3 自己规定的那一类：保证金档位权威事实无法取得，因此**不得把 profile 伪造成 READY**，先把采集缺口登记为激活 blocker。

- 一次 profile CAS 尝试：HTTP **400 `GOVERNANCE_PATCH_REFUSED`**，被拒路径
  `riskGovernance.portfolioRisk.scenarioVersion / .scenarios / .correlationVersion / .clusters`；
  `marginTierVersion` 与 `maintenanceMarginRatePct` 甚至无法提交（无 bracket 采集器）。
- **零 Settings 漂移**：`settingsVersion` 197 → 197，除版本号外整个 settings 对象逐字节等价（脚本断言 `unchanged=true`），`executionMode` 仍 `READ_ONLY`，`profileReadback.status` 仍 `PROFILE_NOT_CONFIGURED`。
- **未切 `TESTNET_ENABLED`**：§E 的前置是 §D 的"profile READY"，该条件不成立；在没有真实风险权威的情况下打开写锁只会更糟（准入仍无票据，但边界保护少了一层）。因此本轮不需要、也没有发生"自动退回 READ_ONLY"——它从未被打开。
- 无任何交易所写、无 Engine 启停、无 DB 写、无矩阵放宽、无占位版本字符串。

## §H 十八项事实

1. **HEAD / live buildId / PID / instanceId**：HEAD `423318c`（+ 本轮证据提交）；`buildId=3.9.6-eaaabc52c682cc1ce56a`；PID `34196`；instanceId `dc5c58b8…`（`post-deploy-continuity.json`，上一轮）；startedAt `2026-09-24 06:41`；`restartCount=173`。
2. **profile 写前/写后 settingsVersion**：`197 / 197`（被拒，未产生新版本）。
3. **E/G/D/P 与 profile 拟写值**：`E=10799.57208649`（`/health checks.privateData.equityUsd`，`status=READY`，`ageMs≈0`，60 秒内新鲜），`G=1`，`D=0.8`，`P=50`；据此拟写 `maxCapitalAtRiskUsd=10799.57208649`、`maxDrawdownPct=1.0`、`maxStressLossUsd=5399.786043245`、`maxGrossNotionalUsd=10799.57208649`、`maxDirectionNotionalUsd=8639.657669192`、`maxClusterNotionalUsd=10799.57208649`、`minMarginBufferPct=0`、`minLiquidationBufferPct=0`、`maxHumanPositions=50`、`maxHumanNotionalUsd=10799.57208649`、`maxPendingHandoffs=50`、`maxAckAgeMs=86400000`、`snapshotTtlMs=20000`、`cashFlowWindowMs=86400000`、`cashFlowMaxAgeMs=900000`（逐值见 `profile-cas-attempt-C.json`；全部未落库）。
4. **margin bracket 来源 / universe 覆盖 / canonical hash / maintenance 上界**：**未取得**。运行中产品没有任何 Testnet bracket 读取路径：唯一的 `/fapi/v1/leverageBracket` 调用点是 `ExternalTradeAdapter.setLeverage()`（下单时只取 `initialLeverage` 一个数、丢弃 bracket 行）与 `productionReadOnlyPreflight`（绑定 `environment=PRODUCTION`）；`/api/v3/api` 无任何暴露档位的端点；`config/settings.default.json` 不含 `riskGovernance.portfolioRisk`。故无法构造 §B3 要求的 canonical snapshot、`sha256` 版本与保守上界维持保证金率。详见 `margin-tier-collector-gap-B3.json`。
5. **profileReadback 是否 READY**：否，`PROFILE_NOT_CONFIGURED`，blockers `RISK_PROFILE_UNCONFIGURED`。
6. **executionMode 最终值**：`READ_ONLY`（未切换；未触发任何 P0/P1，只是前置事实缺口）。
7. **executionReadiness 当前值**：`intent=true`、`ready=false`、`modelSpendPermitted=false`、`blockers=[EXECUTION_WRITE_LOCKED, RISK_PROFILE_UNCONFIGURED]`、`firstBlocker=EXECUTION_WRITE_LOCKED`、`privateFresh=true`、`executableCandidateCount=7`、`mode=EXECUTION_BLOCKED`。
8. **第一个真实 `PORTFOLIO_RISK_ADMISSION_EVALUATED`**：**不存在**。READ_ONLY 下 Anti-Waste 正确阻止模型支出，组合准入路径不运行；本轮 30 分钟窗口 `ai_runs_archive` 新增 0 行、`AI_RUN_TERMINAL=0`、`ANALYSIS_ONLY_COMPLETED=0`、`TRADE_PLAN_PERSISTED=0`、`ENTRY_ORDER_SUBMIT=0`。
9. **46 条 durable UNKNOWN**：仍完整保留 46 条（`status=UNKNOWN`、`expiresAt` 全为 `null`），本轮未删未改；按 `d570bef` 的权威谓词当前 0 条占新风险（上一轮记录的 2 条已在 22:33:27 / 22:35:21 被周期远端复核重新证明）。若某行证明过期，权威会自动重新计入。
10. **第一个自然 PLACE 的 event lineage**：`NOT_OBSERVED` —— 写锁未开、模型未派发，因此无 lineage 可记录。这不是失败隐藏，而是 §E 未执行。
11. **reservation / intent / order / submit / fill 数**：`0 / 0 / 0 / 0 / 0`（`capacity.inFlight=0`、`reserved=0`、`used=13` 全为既有 HUMAN 持仓）。
12. **Binance Testnet order id / client id**：无（未提交任何订单）。
13. **新 AI 仓位 ownership 与 protection/TP**：无新仓；所有权账本仍 `27 rows / 27 cycles / 0 AI_ACTIVE / 0 duplicate`。
14. **写计数**：`testnetWrites=0`、`productionWrites=0`、`blockedProductionWriteAttempts=0`、`lastWriteAt=null`、`lastWritePath=null`、`lockedToTestnet=true`、`environment=TESTNET`。
15. **重复 submit / stale fact 写 / wrong side / qty mismatch**：均无（无任何写发生，因而无此类风险面被触发）。
16. **现有 HUMAN_MANAGED 持仓**：13 个全部保持 `HUMAN_MANAGED`、全部 `PROTECTED`（`required=13 / protected=13 / unverifiedTp=0 / orphanTp=0 / duplicateTp=0 / qtyMismatch=0 / wrongSide=0`）。
17. **fatal / integrity / persistence**：日志 fatal/uncaught 匹配 0；`database.integrity=true`、`status=HEALTHY`、`error=null`；egress `VERIFIED`（`proxy-a087cc91667b`，期望出口 IP `172.104.186.174` 与最近验证一致）。
18. **是否继续正式 Testnet 运行**：保持 `V396_TESTNET_ACTIVE_ANALYSIS_ONLY` 语义 —— Testnet 在线、行情与私有事实运行、Entry 写未启用、Production 写 0/锁定、`aiExitAuthority=SHADOW`、模型支出被 Anti-Waste 抑制（正常工作，非故障）。

## 为什么本轮不"顺手"把矩阵改成能过

四个数据集字段被运行中的服务器判为 `editable:false`，其 `readOnlyReason` 写明：档位表与相关性/情景版本必须随真实数据集一起离线校验，**不能让页面改一个字符串就冒充已证明**。把 `editable` 翻成 true 或用 SQL 直写 settings 行，都正好绕过治理矩阵、`saveIfVersion` 与 `settings_audit` 三层；而 ledger 对 `marginTierVersion` 的校验只是"非空字符串 + 有限费率"，所以一个占位版本会**静默**解锁真实资金路径。这与 §0 的"不得通过编造 Binance margin tier 的权威来源来过门"直接冲突，因此不在本轮单方面执行。

## 要打开正式 Testnet，需要的一次实现（请批准后另起一轮）

1. **Testnet bracket 采集器**：对当前 13 持仓 + 可路由 universe 的每个 underlying 读 `/fapi/v1/leverageBracket`，保留 `symbol/notionalFloor/notionalCap/maintenanceMarginRatio/initialLeverage`，确定性规范化后产出 `{canonicalSnapshot, sha256, maxApplicableMaintenanceRatePct}`；费率取本轮 sizing 区间**可及档位的最大值**（保守上界），不是均值、不是猜测。
2. **数据集整体提交通道**：一条带审计的 whole-profile 校验写入 —— 版本必须哈希自随行的数据集（scenarios ↔ scenarioVersion、clusters ↔ correlationVersion、bracket snapshot ↔ marginTierVersion + rate），不匹配即拒；数值上限继续走现有字段矩阵校验。
3. **敌意测试**：只有版本没有数据集 → 拒；数据集与版本不符 → 拒；缺 bracket 的标的 → fail-closed；档位变化后旧版本失效；PUT 不能写 PATCH 拒过的东西；rate 必须等于最大可及档而非平均。
4. 红→绿 + 全仓门禁 + ff push 后，按既有人工启停规则做一次受控部署；然后才能按计划 §C→§E→§F 顺序真正激活。

**不做**：不提高 `maxGrossExposurePct / maxDirectionExposurePct / maxClusterExposurePct / maxClusterDirectionExposurePct / maxPositions`；不放宽 60 秒新鲜度、egress、UNKNOWN、JIT、reachability/0.15；不人工插候选或伪造 PLACE/fill；不删除历史 UNKNOWN；不改 `aiExitAuthority`；不动 Production；不在本轮二次重启取绿。

# ZDJ-MITS V3.9.4 Stage7-9 一次性收尾实施与验收计划

日期：2026-09-19
仓库：`3684993/ZDJMITS`
工作分支：`v394-binance-governance-settings-20260918`
V3.9.3 冻结基线：`08487ca9f0e9e389cc9de783c2b914630b6e54b9`

## 0. 权威事实源与本轮架构裁决

本轮不得用文档推断覆盖代码事实。事实优先级固定为：

1. 当前 GitHub exact HEAD 的代码 + tests；
2. 当前 Binance Futures Testnet / Engine 运行证据；
3. 《当前权威现状与后续开发基线报告》用于冻结架构边界；
4. 工程扫描、项目分析汇报、对比报告只作为调查线索，不直接授权改代码。

截至本计划本次更新前，已核验 `31eaf2a2fa020f90708216e0d9e006f80359f000`，GitHub Actions `V3.9.x Verify #309` attempt 2 全绿。

### 0.1 side-neutral 当前事实

- `eipService.ts` 中 `portfolioIntelligence.preferredDirection`、`directionPreference`、`allowedDirections` 等旧字段仍存在，但源码明确标注为 compatibility/audit surfaces。
- `packages/core/src/compactEntry.ts` 的 Primary compact prompt 不包含上述字段；Primary 只接收允许的 MARKET_FACTS + fresh EXECUTION_ENVELOPE 等实际 compact facts。
- Primary prompt 明确要求 `Independently test BOTH LONG and SHORT hypotheses`，并明确禁止因为一侧 capacity 更大而选择该方向。
- 因此禁止把“legacy preferredDirection=SHORT 仍存在”直接解释成“Primary 被 SHORT bias 污染”。只有 runtime prompt/evidence 证明该字段实际进入 Primary 并改变决策时，才允许升级为 V3.9.4 P0。

### 0.2 Capital Route 当前事实

- `packages/core/src/capitalAdmission.ts` 仍保留 directionPermissions / longPlan / shortPlan 等历史方向化元数据，属于架构债调查对象。
- 当前生产 Entry 的 Primary 前置客观容量门由 `EntryCoordinator.objectiveCapacity()` 与 fresh `buildPreAiExecutionEnvelope()` 驱动。
- 当前 `EntryCoordinator` 不再引用 `DirectionPolicyService`，也没有 `DIRECTION_NOT_ALLOWED` 后置 veto。
- 禁止仅凭 Capital Route 中的方向化元数据就声称“系统仍偷偷 SHORT_ONLY 限制 AI LONG”。必须沿实际 runtime 调用链证明影响 Primary admission、AI side、quantity 或 Maker authorization。

### 0.3 DirectionPolicyService 当前事实

- `directionPolicyService.ts` 文件仍存在，并仍包含旧 `allows() -> DIRECTION_NOT_ALLOWED` 逻辑。
- 当前已确认 `EntryCoordinator` 不引用它；`tradingQualityTestHarness.ts` 仍有引用。
- V3.9.4 只允许做 read-only runtime reachability / dead-code audit，不因文件存在就删除或重构。
- 若没有生产 runtime reachability 证据，将其登记为 `V3.9.5 cleanup candidate / semantic debt`，V3.9.4 不处理。

### 0.4 Stage6 证据口径

- Stage6 首次有效验收并未降低到 5 分钟。
- `Stage6Minutes < 30` 时，脚本必须先找到一份严格合格的 >=30 分钟历史证据，否则 fail-closed。
- 当前 short recheck 是在既有 >=30 分钟核心门禁全部合格、仅 counter discontinuity 需要代码修正复核时，允许进行 >=5 分钟 targeted recheck。
- 禁止把 `PRIOR_30M_PLUS_TARGETED_RECHECK` 描述成“5 分钟替代 30/60 分钟首次验收”。

### 0.5 V3.9.4 收尾原则

V3.9.4 当前目标是完成真实 Testnet 闭环与验收，不做 legacy 语义大清理。除非出现运行证据证明 legacy 字段真实改变：
- AI direction；
- AI quantityUnits；
- acceptable price range；
- Maker authorization；
- TP authority；

否则 `directionPolicyService / portfolioIntelligence / capitalAdmission` 的残留只登记为 V3.9.5 cleanup candidate，不得阻断 Stage7-9。

## 1. 目标

本计划用于 Codex 接手 V3.9.4 Stage7 之后的全部收尾工作，不再由人工逐个修补门禁。

当前 Stage6 已正式 PASS。下一步必须从真实 Testnet 状态出发，处理当前阻断：
- positions = 1
- activeEntry = 10
- Stage7 报错：`STAGE7_REQUIRES_NO_EXISTING_EXPOSURE`

最终目标：
1. 安全收敛 Binance Futures Testnet 的历史仓位/挂单暴露；
2. Stage7 最小写 Canary PASS；
3. Stage8 Testnet 自动交易启动 PASS；
4. 自动收集 12H Canary / 24H infrastructure acceptance 所需证据；
5. 完成最终验收与交接报告；
6. 全程不得破坏 V3.9.3 已验收 Entry / AI / TP 架构。

## 2. 已确认 Stage6 证据

基础 30 分钟证据：
`data/reports/v394-stage6-readonly-20260918-230603`

5 分钟定向复验证据：
`data/reports/v394-stage6-readonly-20260919-000546`

最终结果：
- executionMode = READ_ONLY
- REST = `demo-fapi.binance.com`
- expected/verified egress = `172.104.186.174`
- routeViolationSamples = 0
- egressViolationSamples = 0
- http429 17 -> 17，delta = 0
- http418 3 -> 3，delta = 0
- falseCounterDiscontinuity = 0
- privateTruthTimeoutDelta = 0
- backgroundTimeoutDelta = 0
- READY / Account READY / WS LIVE / Reconciliation SETTLED = 100%
- `STAGE6_PASS_ENGINE_REMAINS_READ_ONLY=TRUE`

Stage6 不再重复。

## 3. 不可突破的边界

### 3.1 环境
- 只允许 Binance Futures Testnet。
- REST 必须是 `https://demo-fapi.binance.com`。
- 固定代理必须是已配置 SOCKS5H 路由，egress 必须 VERIFIED。
- 禁止切换 Production，禁止 Production 写入。
- 禁止绕过 BinanceTransport / RequestBudget。

### 3.2 V3.9.3 冻结核心
除非发现明确 P0 缺陷且有直接测试证明，否则不得修改：
- `apps/engine/src/services/entryCoordinator.ts`
- `apps/engine/src/services/preAiExecutionEnvelope.ts`
- `apps/engine/src/services/aiFabric.ts`
- `apps/engine/src/services/tpGuardian.ts`
- `packages/core/src/compactEntry.ts`
- `packages/contracts/src/ai.ts`

保持既有原则：
- AI 决定 side / quantity / acceptable price range。
- Entry Manager 决定最终 Maker price。
- TP Guardian 负责确定性 TP。
- 不新增第二套 Entry/Exit/TP 决策链。
- 不直接改 SQLite 伪造订单/仓位/验收结果。

### 3.3 Git / CI
任何代码修改必须：
`修改 -> 本地针对性测试 -> typecheck/test/build -> commit/push -> 当前 exact HEAD 的 V3.9.x Verify SUCCESS -> 才允许本地运行新代码`

禁止用旧 CI PASS 替代新 HEAD。

## 4. Stage7 前置：真实暴露调查与安全收敛

不要因为 Stage7 要求 flat 就直接删数据库、清本地记录或盲目平仓。

先保存完整证据：
- `/api/v3/settings`
- `/health`
- `/api/v3/positions`
- `/api/v3/orders`
- `/api/v3/pipeline`
- `/api/v3/diagnostics/private-sync`
- `/api/v3/diagnostics/binance-governance`
- Binance Testnet exchange truth：open orders / positions / user stream truth
- 对 10 个 active Entry 逐个列出 symbol、local id、exchange order id、status、quantity、price、createdAt/updatedAt。
- 对 1 个 position 列出 symbol、side、size、entry price、unrealized PnL、现有 TP。

将暴露分类：
A. 交易所真实活动订单/仓位；
B. 本地活动但交易所不存在的 stale/phantom；
C. 交易所存在但本地缺失的 reconciliation drift；
D. 已终态但 UI/API 错误计为 active。

按事实分别处理，不允许“一刀切”。

### 4.1 Testnet cleanup 规则

如需真实写操作：
1. Pause Entries；
2. 再次确认 TESTNET + demo-fapi + egress VERIFIED + Account READY + Reconciliation SETTLED；
3. 使用既有正式取消链取消历史 active Entry，不直接 curl Binance、不绕过 AccountExecutor/BinanceTransport；
4. 对真实历史仓位，通过现有合法 ExitIntent -> ExitDispatcher -> AccountExecutor 路径 reduce-only 平仓；不得新增 AI 自动平仓；
5. 若已有 TP/退出单，先按系统正式退出语义处理冲突，禁止造成反向仓位；
6. 等待 User Data Stream + reconciliation 证明 exchange/local 同步；
7. 最终必须达到：
   - positions = 0
   - active Entry = 0
   - 不存在孤儿 TP/退出单
   - Account READY
   - WS LIVE
   - Reconciliation SETTLED
8. 保存 cleanup evidence，之后恢复 Stage7 所需初始状态。

如果 positions=1 / activeEntry=10 实际只是本地 stale truth，则修 reconciliation / active-status 计算，不允许向交易所发送无意义的 cancel/close。

## 4.2 Stage7 前必须增加的方向中立防回归测试

在不改变生产架构的前提下，增加一个精准自动化测试，用机器裁决 legacy SHORT bias 是否还能影响当前 Entry：

场景：
- candidate / compatibility metadata 构造为 `NEW_LISTING`；
- legacy direction surface 构造为 `SHORT_ONLY` / `preferredDirection=SHORT`（按当前真实 schema 能表达的方式）；
- fresh PreAiExecutionEnvelope 明确 LONG / SHORT 两侧都客观 executable；
- Primary 返回 schema-valid `PLACE_LONG`，含自主 `quantityUnits`、合法 `acceptablePriceRange` 与 `profitTakePlan`。

必须验证：
1. compact Primary prompt 不包含 `preferredDirection`、`directionPreference`、`allowedDirections` 等 legacy direction answer key；
2. AI 的 `PLACE_LONG` 不被 legacy DirectionPolicy / Capital Route 翻转成 SHORT；
3. 不以 `DIRECTION_NOT_ALLOWED` 拒绝合法 LONG；
4. `quantityUnits` 不被旧方向策略 clamp；只按 AI quantity + objective envelope 做既有 reject/validate；
5. acceptable price range 不被旧方向策略重写；
6. Maker authorization 继续使用 AI side + fresh execution envelope；
7. 测试不得通过修改 frozen V3.9.3 核心语义来“适配”预期。

若该测试在当前代码无需生产修改即可 PASS，则将“legacy SHORT bias 仍控制当前 Entry”裁定为不成立，并把相关清理延后 V3.9.5。
若失败，必须先证明失败来自真实生产调用链，而不是 test harness 旧 wiring；只有生产 reachability 被证明后才允许最小修复。

该测试属于 Stage7 前的防回归证明，但不得触发 Stage6 重跑。任何新增测试/代码 commit 仍必须 exact HEAD CI 全绿后才能继续 Testnet 写 Canary。

## 5. Stage7：最小 Testnet 写 Canary

Cleanup PASS 后自动继续，不需要用户再次确认。当前用户已明确授权执行 Binance Futures Testnet Stage7/后续 Testnet 验收；该授权绝不扩展到 Production。

Stage7 保持：
- `CanaryMarginUsd = 5`
- `maxPositions = 1`
- `maxPendingEntries = 1`
- dynamic margin disabled
- TESTNET_ENABLED
- 先 PAUSED 完成验证，再 release
- 只接受 AI 的自然新 Entry；禁止为了测试伪造方向/数量/价格或强制制造交易。

验收：
- 新 Canary Entry 与 baseline 隔离；
- AI side mismatch = 0
- quantity mismatch = 0
- price-range mismatch = 0
- policy leak = 0
- POST_ONLY/Maker 规则正确；
- fill 被 User Data Stream / reconciliation 正确确认；
- TP Guardian 生成有效 TP；
- http429Delta = 0
- http418Delta = 0
- fixed egress 仍 VERIFIED
- PASS 后立即 pause new entries；
- 最终 `STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE`。

### 5.1 NO_NATURAL_ENTRY
若观察窗口内无自然 Entry：
- 不允许盲目重新执行 Stage7；
- 自动调查 eligibility、candidate pool、AI invocation、AI decision、Entry Manager gate、portfolio limit、cooldown、market data、15m facts；
- 区分“合理无信号”与“系统阻断”；
- 只有明确系统缺陷才修代码；
- 修复后 exact HEAD CI PASS，再从已 armed 状态安全续跑；
- 不重复 Stage6。

## 6. Stage8：启动正式 Testnet 自动交易

Stage7 PASS 后自动继续：
1. 恢复 Stage7 前正常 Testnet 设置，但保持 `TESTNET_ENABLED`；
2. 保持 V3.9.3 Entry/AI/TP 核心语义；
3. Resume Entries；
4. 要求：
   - runtime trading control = RUNNING
   - execution governance = AUTO_RUNNING
   - Account READY
   - WS LIVE
   - Reconciliation SETTLED
   - egress VERIFIED
   - 429/418 不新增
5. 输出 `STAGE8_AUTO_TRADING_STARTED=...`。

## 7. 12H / 24H 验收自动化

不要让用户盯 PowerShell 手工等待。若仓库尚无可靠的持续验收器，则实现一个可恢复、可中断后续跑的 V3.9.4 acceptance runner。

要求：
- 独立 evidence dir；
- 周期性只读采样；
- 记录 Engine PID / start time，检测重启；
- 固定 route identity / egress；
- REST host；
- Account / WS / Reconciliation；
- REQUEST_WEIGHT / ORDER_COUNT；
- 429/418 delta；
- private/background timeout；
- Entry integrity；
- TP coverage；
- Settings/resource runtime readback drift；
- AI side/quantity/price-range mismatch；
- policy leak；
- 自动写 checkpoint，电脑/会话中断后不能伪装成连续运行；
- 12H 与 24H 必须分别给出真实连续时长；
- 失败时立即保存 failure snapshot，不篡改 PASS。

Stage8 的 12H Canary 通过后继续 Stage9 24H infrastructure acceptance。只有 Stage9 PASS 才可声明：
`V3.9.4 Binance API Governance Stable`

## 8. 一次性执行器

优先实现/完善一个明确的一次性收尾入口，例如：
`scripts/run-v394-stage7-to-stage9.ps1`

职责：
1. Detect current exact HEAD / CI evidence；
2. 复用 Stage6 PASS，不重跑；
3. exposure investigate；
4. Testnet cleanup；
5. flat/readiness verification；
6. Stage7；
7. Stage8；
8. 12H acceptance；
9. 24H acceptance；
10. 最终报告。

必须具备：
- idempotent / resume；
- 已 PASS 阶段不重复；
- 失败停在当前阶段；
- 每阶段 evidence/checkpoint；
- 不因脚本重跑重复下单；
- 不因旧订单重复 cancel；
- 不因旧仓位重复 close；
- 所有写动作带唯一 intent / correlation evidence；
- Production fail-closed。

## 9. 文档与交付

Google Drive `/Google Drive/codex/zdj` 保存：
- 调查报告
- cleanup 报告
- Stage7/8/9 报告
- 12H/24H 验收报告
- 最终交接报告

GitHub 只保存：
- 代码
- 测试
- runtime 必需脚本
- 本实施计划（用户明确要求）

最终交付必须报告：
- final commit / branch
- exact CI run
- exposure 根因与处理
- Stage7 summary
- Stage8 summary
- 12H summary
- 24H summary
- remaining risks
- 是否满足 `V3.9.4 Binance API Governance Stable`

## 10. 执行原则

不要重新讨论架构，不要大改 V3.9.3。
先调查事实，再最小修改。
能用现有链路解决就不新增链路。
测试网历史脏状态必须治理，但不得伪造 flat。
任何失败必须解释“事实 -> 根因 -> 修复 -> 测试 -> CI -> 继续”。
不要每个小步骤等待用户确认；在上述 Testnet 授权边界内持续推进，直到出现必须由用户提供的外部条件、Production 授权（当前禁止），或无法安全自动处理的真实资金/账户风险。
## 11. V3.9.5 延后清理清单

V3.9.4 最终验收完成后再处理，当前不得借机重构：
- DirectionPolicyService runtime reachability 最终审计与 dead-code 删除评估；
- EIP portfolioIntelligence 中 preferredDirection / directionPreference / allowedDirections 的兼容字段去留；
- Capital Admission longPlan / shortPlan / directionPermissions 的语义收敛；
- Trading Quality Harness 与生产 Entry wiring 的去历史化；
- 文档统一：把工程扫描中的 AI 权限、AI disposition、Scout/Primary、TP fallback 等历史描述修正到当前代码事实。

这些事项除非在 Stage7-9 产生直接生产影响证据，否则不得回灌为 V3.9.4 scope。

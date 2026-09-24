# V3.9.6 — PLACE→Submit 转化率与执行可观测性最终闭合轮（2026-09-25）

## 0. 用户授权 / 本轮终点

当前线上已经是正式 Testnet 执行态，不等待 24h soak。本轮直接在当前 convergence 版本继续修补、构建、部署、在线验证并 ff push。

用户明确授权本任务期间为已实证 P0/P1/P2 修补进行必要的受控 lifecycle：允许 `stop-zdj-lan.ps1` → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`，无需再次询问；但禁止 watchdog/autostart/service/hot reload/`npm run dev`/`tsx watch`，禁止没有代码/产物变化或没有新的实证故障就纯重启。每次 restart 都必须能对应一个明确修补或部署变化，并保留 identity/provenance 证据。

终点不是“代码可部署”，而是当前正式 Testnet runtime 上：

1. `TESTNET_ENABLED + AUTO_RUNNING + Entry Safety AUTO + PortfolioRisk READY + executionReadiness READY` 保持；
2. 修复当前 `PLACE → TradePlan` 的错误/过度 veto，使 SHADOW 统计证据不再悄悄成为硬门；
3. **不**通过放宽风险、利润或 exposure 参数制造成交；
4. 每个 Primary Run 在 UI / API / durable event 中立即得到一条明确执行结果：`已挂单 / 未挂单 / 等待价格 / 正在提交 / 已成交`，若未挂单必须点名阻断 stage + reason；
5. 驾驶舱展示 `PLACE → Risk Allowed → TradePlan Ready → Reservation → Intent → Submit → Fill` 漏斗及转化率；
6. 部署后用自然候选验证。若连续自然 PLACE 仍 0 submit，且原因不是本计划允许的真实硬门，则本轮继续红→绿修补并部署，不能以“继续观察/等 24h”结束。

基线先 fetch/ff-only 更新并记录。编写本计划时远端基线为 `92c2fba470e86c4f8df46d390b54c770fcfbbfff`；执行时以 fetch 后实际 HEAD 为准。PR #9 不触碰。

---

## 1. 冻结不变量：绝对禁止为了提高建仓频率而改这些

以下全部保持：

- Testnet only；Production write 永远 0。
- `takeProfit.minNetProfitUsd = 1` 不改。
- `takeProfit.minNetProfitRoiPct = 0.15` 不改。
- 不改 `maxGrossExposurePct / maxDirectionExposurePct / maxClusterExposurePct / maxClusterDirectionExposurePct / maxPositions`。
- 不改 PortfolioRisk authority 的 fail-closed、JIT、private freshness、egress、UNKNOWN、integrity 语义。
- 不人工造候选、PLACE、fill，不手插 reservation/order。
- 不以模型 confidence 当概率，不把 UNKNOWN 当 0。
- 不为了“必须有订单”扩大独立风险分配给出的 q。
- **S06-T02 保留**：如果最小合法 q 本身连硬的最低利润条件都不可满足，则 `NO_TRADE`；不得通过扩大 q 来“凑够 $1”。
- 模型仍只做 advisory selection；确定性层拥有数量合法性、风险、计划、reservation、JIT 与 order authority。

本轮提高的是**正确 PLACE 的执行转化率和可解释性**，不是降低门槛。

---

## 2. 已实证问题（必须按事实修，不重新猜）

当前线上事实：

- 30m Primary 约 26，PLACE 约 26，REJECT 0，Submit 0，Fill 0；Primary 单槽位已经接近持续满载。
- `executionReadiness=READY`、PortfolioRisk 已真实 allowed，多次五层 factCoverage VERIFIED。
- 历史线上记录出现：
  - `ENTRY_ECONOMIC_ADMISSION_EVALUATED mode=SHADOW`
  - `PORTFOLIO_RISK_ADMISSION_EVALUATED allowed=true`
  - 紧接 `ENTRY_DECISION_BLOCKED stage=TRADE_PLAN`
  - `PLAN_SIDE_NOT_EXECUTABLE:*`
  - `CANDIDATE_SET_NO_PROFITABLE_COMBINATION_AT_MINIMUM_QUANTITY`
  - 同时 `ATTAINED_NET_PROFIT_USD > MIN_NET_PROFIT_USD`。

代码事实：`quantityHorizonCandidates.ts` 当前把

`floorBeyondCeiling === true || (enforceEconomics && profitFloorUnmet)`

整体作为 reject 条件。因此**历史/统计 ceiling 在 `tradeEconomics.admissionMode=SHADOW` 时仍然硬拒绝**，与同文件“economic/statistical gates only bind in ENFORCE”的语义、以及 S06-C “SHADOW 仅记录未证明/证据，不硬拒绝”冲突。

另外当前拒绝文案把“已满足净利润但目标超过历史 ceiling”写成 `NO_PROFITABLE_COMBINATION...`，会误导操作员。

---

## 3. 红测先行：先证明当前 bug，再改实现

至少新增以下敌意测试，先在旧实现上红：

### T1 — SHADOW 统计 ceiling 不得硬 veto

给定：
- minimum q 的 `expectedNetProfit >= requiredNetProfit`；
- `floorBeyondCeiling=true`；
- `tradeEconomics.admissionMode=SHADOW`；
- 机械 filters/risk envelope 均合法。

预期：
- candidate set **不能**因 historical ceiling 被清空；
- 必须生成可继续到 TradePlan 的候选；
- economics/reachability 中明确记录 `HISTORICAL_CEILING_EXCEEDED`（名称可按现有契约风格确定）；
- 标记为 SHADOW warning/evidence，不是假称 passed；
- 不改变 target、q、risk envelope。

### T2 — ENFORCE 下同一 ceiling 仍可硬拒绝

同 T1，仅 `admissionMode=ENFORCE`。

预期：明确拒绝 `TP_HISTORICAL_REACHABILITY_UNMET` / 等价确定原因，不能偷放行。

### T3 — 真正 minimum-q 硬利润失败继续 NO_TRADE

最小合法 q 在合法 target 范围内仍无法满足既定最低利润硬条件时：
- `NO_TRADE`；
- 不允许尝试更大 q 来救活；
- `$1` / `0.15` 不变。

### T4 — “利润满足但统计 ceiling 超过”不得再叫“无利润”

断言 reason taxonomy 区分：
- `MIN_PROFIT_FLOOR_UNMET`（或现有等价）
- `HISTORICAL_TARGET_CEILING_EXCEEDED`

不允许 `ATTAINED > MIN` 同时展示 `NO_PROFITABLE_COMBINATION` 这种相反文案。

### T5 — PLACE + 所有硬门通过必须立即进入执行链

冻结事实下：Primary `PLACE_LONG/SHORT` + risk allowed + TradePlan Ready + JIT facts unchanged：
- 原计划先持久化；
- reservation exactly once；
- intent exactly once；
- order exactly once；
- Binance Testnet submit exactly once；
- 无额外“观察/等待人工确认”状态。

### T6 — JIT/事实改变仍 fail-closed

在 PLACE 后人为改变价格/版本/authority/private 等事实，JIT 必须阻止 submit，并释放/处理 reservation，UI 显示 `未挂单 · JIT_BLOCKED:<reason>`。

### T7 — 不能跨 Run 串执行结果

同 symbol 连续两个 AI run，旧 run 的 submit/fill/order id 不得显示到新 run；所有 execution outcome 必须通过 `brainRunId / planId / intentId / orderId` 可追溯绑定。

### T8 — 漏斗计数精确

构造 PLACE→RiskAllowed→TradePlanReady→Reservation→Intent→Submit→Fill 以及各层 blocked 的混合 fixture，30m/1h 计数和 conversion ratio 必须精确，不得用“最后状态猜中间状态”。

### T9 — UI 每个 Primary 完成后立即有 execution result

PLACE 完成后在一个确定性状态更新周期内必须呈现：
- `正在执行`
- 或 `已挂单`
- 或 `未挂单 · <stage> · <reason>`
- 或 `等待价格`

不能长期只显示 PLACE 而不知道有没有下单。

### T10 — 不回归冻结边界

Production writes=0、风险 caps 不变、TP/ownership/integrity 不回归。

---

## 4. 产品修补 A：修正 SHADOW / ENFORCE 语义，不删 minimum-q 安全边界

修改 `quantityHorizonCandidates.ts` 及相关 contracts/tests：

1. 把“机械/资金/硬利润合法性”和“统计/历史触达证据”明确拆开。
2. `floorBeyondCeiling` 本质是历史样本的统计 ceiling，不是 Binance filter，也不是 PortfolioRisk 硬容量。
3. 在 `SHADOW`：
   - 不得仅因 `floorBeyondCeiling` 清空 candidate set；
   - 保留 candidate，记录 warning/status；
   - 不把统计未支持伪装成统计 passed；
   - 让 Primary 已经选择的 PLACE 在其它硬门通过时继续进入 TradePlan。
4. 在 `ENFORCE`：保持统计门硬拒绝。
5. minimum-q 真正硬利润失败继续遵守 S06-T02；不得扩大 q 救活。
6. 所有 reason 必须语义准确：利润、统计触达、机械 filter、资金/风险分别命名。

如果现有 schema 没有足够字段表达 shadow warning，最小扩展契约；不得复用一个错误 reason 省事。

---

## 5. 产品修补 B：减少 27B 白跑，但不能提前替模型选方向

增加 deterministic **pre-AI plan feasibility**，只做“这个候选是否存在任何可能的合法执行路径”的便宜检查：

- 使用当前 pre-AI envelope、Binance filters、独立 risk/capital envelope、本地 candles/stat facts；
- 可以分别评估 LONG/SHORT 的机械/硬门可行性；
- **不能**因为某一侧更容易执行而替模型改方向；
- 两侧都没有任何硬可执行候选时，不调用 Primary，记录 `PRE_AI_TRADE_PLAN_NO_HARD_EXECUTABLE_SIDE` 及逐侧原因；
- SHADOW 的统计 ceiling 不能在这里成为硬阻断；
- 只有真实硬门（资金、槽位、风险、exchange filters、S06-T02 等）才允许省掉模型调用。

这样提高“每次花 55s 27B 推理后确实可能执行”的比例，而不是单纯提高调用频率。

---

## 6. 产品修补 C：PLACE 后没有硬 blocker 就立即 submit

沿现有 `entryCoordinator` 单一路径收敛：

`Primary PLACE`
→ deterministic economic/PortfolioRisk
→ TradePlan persisted
→ reservation
→ intent
→ JIT verify
→ order
→ Binance Testnet submit

要求：

- 不新增人工批准点；
- 不新增固定 sleep/观察窗口；
- 不因“还没达到目标持仓数”之外的 UI 状态停住；
- 已有 WAIT_FOR_PRICE 若是计划本身明确选择/合法近市执行策略则保留，但必须显示为“等待价格”，不能伪装成“已挂单”；
- 任一层失败必须写 durable event，带 `brainRunId` 和完整关联身份；
- submit 成功必须立即回写 clientOrderId/exchangeOrderId/submittedAt。

---

## 7. 产品修补 D：建立 Run→Execution Outcome 一等事实

新增/扩展单一投影（不要在 Dashboard 自己推断）例如：

```ts
{
  brainRunId,
  symbol,
  decision,
  direction,
  decisionAt,
  executionState, // DECISION_ONLY | EXECUTING | WAITING_PRICE | NOT_SUBMITTED | SUBMITTED | PARTIALLY_FILLED | FILLED
  blockStage,     // PRE_AI | ECONOMICS | PORTFOLIO_RISK | TRADE_PLAN | RESERVATION | JIT | ORDER | SUBMIT | null
  blockReasons,
  portfolioRiskAllowed,
  tradePlanId,
  tradePlanReady,
  reservationId,
  intentId,
  orderId,
  clientOrderId,
  exchangeOrderId,
  submittedAt,
  firstFillAt,
  updatedAt
}
```

规则：

- Engine 是唯一权威投影源；Dashboard 不拼接猜测。
- 每次 Primary terminal 之后立即创建/更新 outcome。
- PLACE 但尚未执行时显示 `正在执行`，不能显示“—”。
- 被拒则显示 `未挂单 · <stage> · <首因>`。
- 已 submit 才能显示 `已挂单`。
- Fill 与 submit 分开，不能把挂单等同成交。
- 历史 AI Run 表新增“执行结果”列，详情展开显示全链 ID 和每层时间。

---

## 8. 驾驶舱增加建仓转化漏斗

在“建仓活动状态”显示至少 30m 与 1h：

```text
Primary completed
PLACE
Risk allowed
TradePlan ready
Reservation created
Intent created
Order submitted
Entry filled
```

同时显示：

- PLACE→TradePlan %
- TradePlan→Submit %
- PLACE→Submit %
- Submit→Fill %
- 当前最大流失 stage
- 当前最大流失 reason（带 count）

例如当前真实形状应一眼显示成：

`PLACE 26 → RiskAllowed 26 → TradePlanReady 0 → Submit 0`
`Top drop: TRADE_PLAN / HISTORICAL_TARGET_CEILING_EXCEEDED`

如果 `PLACE >= 5 && Submit = 0` 且同一非资金/非仓位 blocker 占多数，显示 **`ENTRY_CONVERSION_DEGRADED`** 运维告警；它只报警，不自动暂停 Testnet execution。

修复当前 “executionReadiness READY” 与实际 execution outcome 混淆：readiness 只说明有权进入链，不说明已下单。

---

## 9. 在线部署与验收（不等 24h）

完成红→绿、全门禁后立即部署到当前 Testnet：

1. 记录部署前 runtime identity、settings/profile/caps、positions/TP/ownership/write boundary。
2. build live dist，闭合 artifact/source hash。
3. 必要 stop + MANUAL_START；本任务已获用户持续明确授权，无需再次询问。
4. 读回必须仍是：TESTNET / TESTNET_ENABLED / AUTO_RUNNING / AUTO / SHADOW(aiExit) / PortfolioRisk READY。
5. caps、`$1`、`0.15`、profile 数值不得漂移。
6. Production writes 必须保持 0。

### 自然流量验收

不要人工制造 PLACE。部署后观察自然候选，直到：

- 至少捕获 10 个自然 Primary PLACE，**或**已经出现真实 Entry submit（取先到者后继续收集足够归因）；
- 对每个 PLACE 生成 execution outcome；
- SHADOW + historical ceiling-only 的旧 blocker 不得再硬拒；
- 若硬门全部通过，必须出现 `TradePlanReady → Reservation → Intent → Submit`；
- 若仍没有 submit，必须列出所有 PLACE 的 stage/reason 分布。

**不能以“建仓频率低，继续观察”结束。** 若 10 个 PLACE 后仍 0 submit，且主要原因不是资金/仓位容量、真实 exchange filter、S06-T02 真硬利润失败、JIT/private/integrity 等既定硬门，则按本轮授权继续定位 → 红测 → 修补 → 门禁 → 部署，直到问题闭合。

不要求制造 Fill；maker/limit 是否成交由真实市场决定。但必须至少区分：
- 未生成订单；
- 已 submit 未成交；
- 部分成交；
- 已成交。

---

## 10. 全仓门禁

至少执行并记录 exit code：

- Engine affected tests
- Engine full tests
- Engine typecheck
- Engine isolated build-check（清理 scratch）
- Dashboard tests/typecheck/build（按仓库既有脚本）
- core tests/typecheck
- contracts tests/typecheck（0 tests 仍不得宣称有 contract coverage）
- `verify:deps`
- `verify:scripts`
- S00 static blockers
- storage coverage
- `git diff --check`

特别确认：live build/test 不污染 data，测试实例无 exchange writes。

---

## 11. 报告 / 证据 / push

证据目录：

`docs/evidence/v396/entry-conversion-closeout-20260925/`

报告：

`docs/reports/v396-entry-conversion-closeout-20260925.md`

最终必须回答：

1. 产品最终 HEAD、实际运行 buildId/PID/instanceId/sourceHash/artifactHash。
2. SHADOW ceiling 是否已从 hard veto 改为 observation/warning；ENFORCE 是否仍拒绝。
3. S06-T02 是否完整保留，并证明没有扩大 q 凑 `$1`。
4. 部署前后 `$1 / 0.15 / Gross / Direction / Cluster / positions caps` 是否逐值不变。
5. 自然 Primary/PLACE/RiskAllowed/TradePlanReady/Reservation/Intent/Submit/Fill 漏斗（30m、1h）。
6. PLACE→Submit 转化率变化及 Top drop stages/reasons。
7. 每个自然 PLACE 是否都有明确“已挂单/未挂单/等待价格/执行中/成交”结果。
8. 若 submit=0，逐条解释为何每笔都属于真实硬门；不得用“频率低/继续观察”概括。
9. 第一笔真实 submit 的完整 lineage（brainRun→plan→reservation→intent→order→exchangeOrder），若自然流量确实没有合法 submit 则明确不存在，不能伪造。
10. Testnet/Production write 归因；Production 必须 0。
11. lifecycle 清单，每次 stop/start 对应的实际修补；不得有纯重试。
12. TP/ownership/integrity/private/authority 是否无回归。
13. Dashboard 截图或可审计 UI evidence，证明 AI Run 行能直接看到执行结果，驾驶舱能看到完整漏斗。
14. 当前是否已达到 `V396_TESTNET_ACTIVE_EXECUTION_ENTRY_CONVERSION_CLOSED`；若否，唯一剩余 blocker 是什么。

完成后 ff-only push `codex/v396-final-convergence-20260922`，工作树 clean，PR #9 不触碰。

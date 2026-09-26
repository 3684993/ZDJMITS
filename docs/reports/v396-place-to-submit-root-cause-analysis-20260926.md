# ZDJ-MITS V3.9.6 — PLACE → Submit 根因穷尽报告（2026-09-26）

Runbook：`docs/plans/v396/CODEX-V396-PLACE-TO-SUBMIT-ROOT-CAUSE-EXHAUSTION-20260926.md`
阶段：Phase 1（只读穷尽，不改产品、不重启）
基线 HEAD：`83f09eb0e0f9e0dc0aceaf10b9b0a3a2b8a19b8e`（`origin/codex/v396-final-convergence-20260922` 已 fast-forward 至 `83f09eb`）
运行实例：pid 37996 / `buildId 3.9.6-e45d25472c241b412be7` / `sourceHash b2e9f84f794d7b79965fb554a3633337e959283aeccdc0773f110f46e5d379c3` / `settingsVersion 219` / `restartCount 189`
边界事实：`environment=TESTNET`、`entrySafetyMode=AUTO`、`aiExitAuthority=SHADOW`、`tradeEconomics.admissionMode=SHADOW`、Production 写次数 0（本阶段未执行任何写路径）

证据文件（均在 `docs/evidence/v396/place-to-submit-root-cause-20260926/`）：

- `a01-chain-audit-12h.json` ← `scripts/v396-place-to-submit-chain-audit.mjs`（逐笔链回放 + veto 统计 + 临界值）
- `a02-threshold-counterfactual.json` ← `scripts/v396-place-threshold-counterfactual.mjs`（8 个真实候选的反事实门计算）
- `a03-unknown-occupancy-census.json` ← `scripts/v396-unknown-occupancy-census.mjs`（UNKNOWN 占用普查；探针只读临时副本，绝不打开 `data/`）

---

## 0. 结论摘要

1. **链断裂点唯一且明确**：`PORTFOLIO_RISK_ADMISSION`（`entryCoordinator.ts:476-488`）。窗口内 267 次准入评估全部 `allowed=false`，其下游（TRADE_PLAN / RESERVATION / INTENT / JIT / SUBMIT）事件数为 **0**，持久化行新增数也为 **0**。
2. **不是"资金不足"**：候选可用资金 USDT `3,500.82`、USDC `4,969.99`，单候选资本可执行名义上限 `2,508.79–3,639.32`，模型选择的名义只有 `5.008–15.515` 美元——差 2–3 个数量级。拒绝来自**组合上限已被现有 22 个仓位穿透**。
3. **真实权威值（可核对）**：`maxGrossNotionalUsd = maxClusterNotionalUsd = maxHumanNotionalUsd = maxCapitalAtRiskUsd = 10,811.957`；当前书内毛名义 `11,113.54` ⇒ **headroom = −301.59 USD**，任何正名义都被拒。
4. **驾驶舱与准入不是同一套语义**：容量视图 `sideStatus=BOTH_SIDES_EXECUTABLE`、`firstBlocker=NONE`、`exhaustedForNewRisk=false`、LONG 侧最佳可执行 `396.28 USD`。原因是容量层用的是 `equity × 百分比`（且 gross/direction 处于 OBSERVE），而准入层用的是 profile 的**绝对 USD 上限**；更直接的是容量层把 `portfolioRisk.allowed` **硬编码为 true**。
5. **首因被字母序遮蔽**：`reasons` 在 `portfolioRiskLedger.ts:316-317` 被 `.sort()` 后，`entryCoordinator.ts:484` 取 `reasons[0]`。因此报出的 code 是 `HUMAN_ACK_OVERDUE`（261 次）或 `ACCOUNT_ASSET_UNVERIFIED:BTC`（3 次），**与哪道门的数值真正Binding 无关**。
6. **模型 100% 被白烧**：窗口内完成的 Primary 全部是 PLACE（`PLACE_LONG 193 + PLACE_SHORT 75 = 268`，非 PLACE 决策 0 次），输入 token `5,375,533`（另有 scout `973,864`）→ 0 次 reservation。因为 envelope 告诉模型"两侧都可执行"，模型就每次都给出 PLACE。
7. **一条原始假设被证据否证**：UNKNOWN 无活动风险证明的 TTL 与审计节拍**不存在**系统性错配（见 §5），因此 Phase 2 不改 occupancy 判定。

---

## A. Brain 决策逐笔回放

### A.1 窗口与保留边界（诚实标注）

`runtime_events` 存在 **70,000 行滚动上限**（实测恰为 70,000 行，跨度 `2026-09-25T17:29:24Z → 2026-09-26T13:26:47Z`）。所有决策类事件的最早 surviving 时间是 **`2026-09-26T07:49:29Z`**：

| 事件类型 | 保留行数 | 最早时间 |
|---|---|---|
| `AI_RUN_TERMINAL` | 268 | 07:49:29Z |
| `PRIMARY_DECISION_NORMALIZED` | 268 | 07:49:29Z |
| `ENTRY_ECONOMIC_ADMISSION_EVALUATED` | 267 | 07:49:29Z |
| `PORTFOLIO_RISK_ADMISSION_EVALUATED` | 267 | 07:49:29Z |
| `ENTRY_DECISION_BLOCKED` | 267 | 07:49:29Z |
| `TRADE_PLAN_PERSISTED` | **0** | — |
| `ENTRY_RESERVATION_CREATED` | **0** | — |

因此"a01 的 12h 窗口"里真正可枚举的决策链只有 `07:49:29Z → 13:05:36Z`（≈5.3 h）；`last6h` 与 `total` 两列处处相等，**不是巧合，而是被保留窗口截断**。6 h 窗口覆盖度 ≈94%（缺 07:26–07:49 一段）。

### A.2 逐笔链（265 笔，摘要）

a01 脚本对每个 `AI_RUN_TERMINAL(PLACE_*)` 拼装 `runId → normalized → envelope → allocationPlan → economic → portfolioRiskAdmission → reservation/intent/order/fill` 全链。窗口内 265 个 PLACE 的分布：

| 环节 | 命中 |
|---|---|
| 有 `PRIMARY_DECISION_NORMALIZED` | 265/265 |
| 有最近 envelope（±300 s） | 265/265（`envelopesCreated=268`） |
| 有 `allocationPlan` | 265/265（持久化行 `createdInWindow=268`） |
| 有 economic 评估 | 264/265 |
| `allowed=false` 的准入评估 | **264/264** |
| 到达 reservation / intent / submit | **0 / 0 / 0** |

`planToAdmissionCoverage`：窗口内 286 个计划，264 个有配对准入事件，**22 个无配对**——逐条核对后全部落在 `07:12–07:37`，即早于保留窗口的第一笔决策（07:49:29Z）；这是**事件截断产物，不是链上静默断裂**。它们自身的 `admission='ALLOW'`，即 sizing 层放行、随后被风险准入拒绝。

### A.3 每笔链的关键数值（8 个代表候选，LONG/SHORT × USDT/USDC 全覆盖）

| 计划 | 方向 | 计价 | planned 名义 | 交易所最小合法名义 | 合法数量区间(units) | 资本上限名义 | 当时准入 reasons |
|---|---|---|---|---|---|---|---|
| `alloc_ai_muieq69a` WIFUSDC | LONG | USDC | 5.0237 | 5.00 | [202, 146179] | 3,635.99 | ACK_OVERDUE · HUMAN_POTENTIAL · STRESS:CLUSTER · STRESS:GROSS |
| `alloc_ai_muieomnp` AAVEUSDT | LONG | USDT | 15.515 | **15.493** | [1, 161] | 2,508.79 | 同上 |
| `alloc_ai_muiel4ci` WLDUSDC | LONG | USDC | 5.0377 | 5.00 | [103, 74015] | 3,620.17 | 同上 |
| `alloc_ai_muiejfwa` VIRTUALUSDT | LONG | USDT | 5.0317 | 5.00 | [64, 46291] | 3,639.30 | 同上 +2 PENDING_RISK_UNVERIFIED + SNAPSHOT_INCOMPLETE |
| `alloc_ai_muie2428` ZROUSDT | SHORT | USDT | 5.032 | 5.00 | [32, 23149] | 3,639.32 | 同 4 条 |
| `alloc_ai_muidz3hg` CRVUSDC | SHORT | USDC | 5.0199 | 5.00 | [145, 72903] | 2,523.94 | 同 4 条 |
| `alloc_ai_muie2428` CRVUSDC(13:07) | SHORT | USDC | 5.0083 | 5.00 | [144, 72203] | 2,512.81 | 13 条（含 `PRIVATE_ACCOUNT_NOT_FRESH`、`ACCOUNT_EQUITY_UNPROVEN`、`MARGIN_ASSET_UNVERIFIED:*`、`STRESS_LIMIT:MIN_MARGIN_BUFFER`） |
| `alloc_ai_muidgm27` USELESSUSDT | SHORT | USDT | 5.0508 | 5.00（minQty 1） | [18, 12916] | 3,623.88 | 同 4 条 |

**事实性结论**：模型每次给出的都是**该符号交易所合法的 minimum 数量**（`AI_QUANTITY_EXCEEDS/BELOW` 命中 0 次，`aiSizingErrors=0`）。也就是说，AI 侧没有过度索取，拒绝 100% 来自组合层。

---

## B. PLACE 之后 → submit 之前的全部 veto 点

`file:line / 触发 reason / 窗口内命中 / 分类`（分类含义：① 交易所·资金·执行正确性；② 合法且当前真实生效的风险约束；③ 重复权威·过期状态·错误作用域·错误归因·实现缺陷；④ 本应只作 telemetry/alert 却成为 veto）

| # | 环节（file:line） | 运行 reason | 5.6 h 命中 | 分类 |
|---|---|---|---|---|
| V1 | `entryCoordinator.ts:452` POST_AI_EXECUTION_LEASE | `EXECUTION_LEASE_*` | 0 | ① |
| V2 | `entryCoordinator.ts:454` 侧 envelope 不可执行 | `AI_DIRECTION_NOT_EXECUTABLE` | 0（envelope 声称两侧可执行） | 见 V11 |
| V3 | `entryCoordinator.ts:455-459` 数量整数/上下界 | `AI_QUANTITY_UNITS_INVALID / EXCEEDS_ENVELOPE / BELOW_ENVELOPE` | 0 | ① |
| V4 | `economicEntryFeasibility.ts:46-81` → `entryCoordinator.ts:463` | `ECONOMIC_MIN_NET_PROFIT_UNMET` 264、`TP_REACH_PROBABILITY_UNMET` 204、`HUMAN_MANAGED_EXPOSURE_LIMIT` 267、`TP_HISTORICAL_REACHABILITY_UNMET` 15 | **0 次 veto**（`mode=SHADOW`，只在 ENFORCE 才 veto） | 正确未误升为 veto（对照面） |
| V5 | `aiQuantityAllocation` → `entryCoordinator.ts:465` | `PORTFOLIO_ADMISSION_REJECTED`（`plan.admission` REJECT_*） | 0（265/265 为 ALLOW） | — |
| V6 | `entryCoordinator.ts:471-475` 准入未安装 | `RISK_ADMISSION_UNPROVEN` | 0 | ① |
| V7 | **`portfolioRiskLedger.ts:299-321` admit() 总闸** | `allowed=false` → `entryCoordinator.ts:484` 取 `reasons[0]` | **264/264** | 权威本体②；归因方式③ |
| V7a | `humanCapacityPolicy.ts:43,50` | `HUMAN_ACK_OVERDUE` | 264 | ②（保留） |
| V7b | `humanCapacityPolicy.ts:46,54` | `HUMAN_POTENTIAL_NOTIONAL_LIMIT` | 264 | ② + ③（与 gross 同值重述） |
| V7c | `portfolioStress.ts:92` | `STRESS_LIMIT:MAX_GROSS_NOTIONAL` | 264 | ②（真正 Binding） |
| V7d | `portfolioStress.ts:80,94` + `:58-61` | `STRESS_LIMIT:MAX_CLUSTER_NOTIONAL` | 264 | ② 名义上；实际作用域为③（`clusters:{}` ⇒ 单一 `UNMAPPED_CORRELATED` ⇒ 与 gross 恒等） |
| V7e | `humanCapacityPolicy.ts:33` + `portfolioStress.ts:70` | `PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` | 54 | ③（对逐行 blocker 的重述标签，非独立门） |
| V7f | `portfolioRiskSnapshot.ts:235`（← `entryRiskOccupancy.ts:273-276`） | `PENDING_RISK_UNVERIFIED:order:*` | 64 次 / **15 个不同订单** | ①②瞬时 fail-closed；对临界值有 ③ 式放大（见 §5） |
| V7g | `portfolioStress.ts:93,95,114` | `STRESS_LIMIT:MAX_DIRECTION_NOTIONAL` 2、`MIN_MARGIN_BUFFER` 2、`MAX_STRESS_LOSS` 2 | 2/2/2 | ② |
| V7h | 快照证据（`portfolioRiskLedger.ts:282` built/snapshot blockers） | `ACCOUNT_ASSET_UNVERIFIED:BTC/USDC/USDT` 3/2/2、`MARGIN_ASSET_UNVERIFIED:USDT/USDC` 2/2、`ACCOUNT_EQUITY_UNPROVEN` 2、`PRIVATE_ACCOUNT_NOT_FRESH` 2 | 同上 | ①（私有事实新鲜度，保留） |
| V8 | `entryCoordinator.ts:495-499` TRADE_PLAN | `PLAN_PERSISTENCE_FAILED` 等 | 0（从未到达） | ① |
| V9 | `entryCoordinator.ts:506-507` RESERVATION | `RISK_GENERATION_STALE / CAPITAL_VERSION_STALE / CAPITAL_EVALUATION_UNPROVEN / RISK_BINDING_INVALID / STRESS_BUDGET_EXCEEDED / MAX_POSITIONS / MAX_CONCURRENT_RESERVATIONS` | 0（从未到达） | ① |
| V10 | `entryCoordinator.ts:515-517` LIVE_RISK_ENVELOPE（严格 JIT 复算） | `REJECT_GROSS_EXPOSURE / … / FINAL_NOTIONAL_EXCEEDS_HEADROOM` | 0（从未到达） | ①② |
| V11 | **容量层：`entryCapacityTrace.ts:193` 与 `preAiExecutionEnvelope.ts:114` 均硬编码 `portfolioRisk:{allowed:true}`** | 使 `sideStatus`/`entryCapacity`/envelope `executable` 与准入永不相干 | 影响 268 次派发决策 | ③ + ④（"显示可下单"的 telemetry 面成为派发依据） |
| V12 | `pipelineVerdict.ts:71-91`（`RISK_ADMISSION` 阶段） | 驾驶舱首因 code = 上述 `reasons[0]` | 264 | ③（继承 V7 的归因缺陷） |

静态穷尽补充：`preflightFeasibility.ts:34` 的 reason 链、`executionReadiness.ts` 的 firstBlocker、`entryCoordinator.ts:519-521`（maker 可达性 → `ENTRY_EXECUTION_WAITING`，非 veto）、`tpGuardian`（出场侧，不在 Entry 链）均已核对；窗口内除 V7 外无第二个实际 firing 的 veto 点。

---

## C. 临界值与反事实（每道门一个公式 + 真实数值）

样本时刻 `2026-09-26T13:11:15Z`：书内 22 仓 / 毛名义 `11,113.54` / 22 行全部 `HUMAN_HANDOFF` / 22 行 ack 超期 / 最旧 `175.2 h`。

### C.1 门与公式

| 门 | 公式 | 上限 | 已用 | 可新增 | 当前 planned | 判定 |
|---|---|---|---|---|---|---|
| `GROSS_NOTIONAL` | `limit − grossWithCandidate > 0` | 10,811.957 | 11,113.54 | **−301.59** | 5.008–15.515 | FAIL |
| `HUMAN_HANDOFF_NOTIONAL` | `potentialHandoffNotional + planned > maxHumanNotionalUsd ⇒ FAIL` | 10,811.957 | 11,113.54（= 同一求和） | **−301.59** | 同上 | FAIL |
| `CLUSTER_NOTIONAL` | `max(clusterNotional) > maxClusterNotionalUsd ⇒ FAIL`，`clusterKey()` 全落 `UNMAPPED_CORRELATED` | 10,811.957 | 11,113.54 | **−301.59** | 同上 | FAIL（与 gross 恒等） |
| `DIRECTION_NOTIONAL` | `max(long, short) > 8,649.565` | 8,649.565 | LONG 3,637.25 / SHORT 7,476.29 | +5,012.31 / +1,173.27 | 同上 | PASS |
| `CAPITAL_AT_RISK` | `Σ margin > 10,811.957` | 10,811.957 | ≈1,082.6 | ≈+9,729 | — | PASS |
| `ACK_OVERDUE` | 存在 `HANDOFF_PENDING` 且 `now − handoffAt > 86,400,000` ⇒ **任意名义均拒** | 24 h | 22 行超期 | 不适用（与规模无关） | — | FAIL |
| 交易所最小名义 | `max(minNotional, minQty × refPrice)` | 5.00（AAVE 15.493） | — | — | 5.008–15.515 | PASS（模型恰好落在floor） |
| 资本可执行名义 | `min(可用保证金, 政策保证金) × leverage` | 2,508.79–3,639.32 | — | — | 同上 | PASS |

### C.2 距离与"真正 Binding"

- 当前 **first binding constraint（按数值）**：`GROSS_NOTIONAL`，缺口 `−301.59`。
- 每一笔候选要能通过，需要**先由人工减仓**至少：`|headroom| + planned`：
  - `5.008 → 306.60`、`5.024 → 306.61`、`5.032 → 306.62`、`5.038 → 306.63`、`5.051 → 306.64`、`15.515 → 317.10`（USD）
- 但即使减到位，`ACK_OVERDUE` 仍在：它与规模无关，只能由**人工确认（ack）**消除；本轮不得自动 ack（runbook 冻结项）。
- 移除全部 ③ 类（重述、错误归因、快照不完整标签、pending 放大）后，**下一个真实 Binding 约束仍是同一个**：`maxGrossNotionalUsd 10,811.957` 与 `maxHumanNotionalUsd 10,811.957` 同时被 `11,113.54` 穿透，叠加 `HUMAN_ACK_OVERDUE`。这两个是 ② 类，必须保留。

### C.3 容量层给出的"另一套数值"（矛盾的直接来源）

同一天 `13:2x` 实时回读：

```
capacityVisibility.sideStatus        = BOTH_SIDES_EXECUTABLE ("LONG 与 SHORT 均可新增")
capacityVisibility.firstBlocker      = NONE
capacityVisibility.exhaustedForNewRisk = false
entryCapacity.LONG  = 396.28 USD @1000BONKUSDC  constraint=PLANNED_NOTIONAL
entryCapacity.SHORT = 459.48 USD @1000BONKUSDC  constraint=PLANNED_NOTIONAL
exposure.gross  = {notionalUsd 11,083.73, limitUsd 10,422.62, remainingUsd 0, usedPct 1.0634, mode OBSERVE, enforced false}
limits.policy   = {gross: OBSERVE, direction: OBSERVE, cluster: ENFORCE}
逐候选 cluster remainingUsd ≈ 2,527–3,648（OTHER:<underlying> 未映射组）
```

而权威首因同一时刻是 `code=HUMAN_ACK_OVERDUE / stage=RISK_ADMISSION`，`riskAdmissionReasons` 7 条、`riskAdmissionLimits=[MAX_CLUSTER_NOTIONAL, MAX_GROSS_NOTIONAL]`。**"显示可下单 + 100% 被拒"由此同时为真。**

---

## D. 八个必答问题

**1) 为什么大量 AI PLACE 仍 0 submit？**
PLACE 之后唯一实际生效的闸是 `admit()`（V7）。它对**任意正名义**都返回 `allowed=false`，因为现有 22 仓的毛名义 `11,113.54` 已高于 profile 绝对上限 `10,811.957`（−301.59），同时 22 行 handoff 的 ack 已超期 24 h 限值（最旧 175.2 h）。下游（plan/reservation/intent/JIT/submit）事件与持久化行在窗口内均为 0，所以"0 submit"不是执行层故障，而是准入层从未放行。链在更早处也**没有**中断：264 笔都成功建了 allocation plan 并通过 sizing。

**2) 每个 veto 过去 6/12 h 拦了多少次？**
见 §B 表。要点：`admit()` 264/264；其中 4 条 reason（V7a–V7d）各 264 次同时出现；`PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 54 次、`PENDING_RISK_UNVERIFIED` 64 次（15 个订单）、`MAX_DIRECTION_NOTIONAL`/`MAX_STRESS_LOSS`/`MIN_MARGIN_BUFFER` 各 2 次、私有事实类各 2–3 次。6 h 与 12 h 两列相等，因保留窗口只有 ≈5.3 h（§A.1）。

**3) `HUMAN_ACK_OVERDUE` 是独立 veto、组合 veto，还是遮蔽了后续 veto？**
它是**独立的、与规模无关的 veto**（`humanCapacityPolicy.ts:43,50`；只要有一行 `HANDOFF_PENDING` 超 `maxAckAgeMs=24h` 即拒），本轮 264 次全部成立。但它**同时遮蔽了后续门**：`reasons` 被 `.sort()` 后 `reasons[0]` 成为对外 code（`entryCoordinator.ts:484`），字母序使 `H…` 在 `HUMAN_POTENTIAL…`/`STRESS_LIMIT…` 之前，只有 `ACCOUNT_*` 会插到它前面（这正解释 261 vs 3 的分布）。证据：窗口内 **0 次** 出现"只有 ACK、没有任何数值门"的样本 ⇒ 它从不单独出现，却总是被报成首因。

**4) HUMAN / GROSS / CLUSTER 的实际临界值是多少？**
三者当前**同为 10,811.957 USD**（commit 的 profile 绝对值），已用同为 11,113.54（22 行全部是 human handoff，且 `clusters:{}` 使 cluster==gross）⇒ 可新增 **−301.59**。`maxHumanPositions=50`（已用 22，槽位 headroom +28）与 `direction 8,649.565`（LONG +5,012.31 / SHORT +1,173.27）当前都不 Binding。

**5) Dashboard 的"可执行新增名义 > 0"与 Risk Admission 0% 是否来自两个不同权威/语义？具体哪两处？**
是。两处：
- 容量层 `riskReadiness.ts:114-137` + `executableRiskHeadroom.ts:41-84`：`limit = equity × riskGovernance.max{Gross,Direction,Cluster}ExposurePct`，且受 `exposureCapacityPolicy` 支配（现值 gross/direction=**OBSERVE**、cluster=ENFORCE，cluster 组为 `executableRiskHeadroom.ts:9-12` 的**硬编码内置分组**）；
- 准入层 `portfolioRiskLedger.ts:308-317` → `portfolioStress.ts:89-97` + `humanCapacityPolicy.ts:48-55`：**profile 绝对 USD 上限**。
外加机制性根因：容量层两处**写死** `portfolioRisk:{allowed:true}`（`entryCapacityTrace.ts:193`、`preAiExecutionEnvelope.ts:114`），所以它从不调问准入权威。同一个 "gross" 名字在两处是**两个不同的数**（10,422.62 OBSERVE vs 10,811.957 ENFORCE），且两处都判定"未占满"的方式不同。

**6) 当前资金充足时，哪些 PLACE 仍会因合法风险约束被拒？**
窗口内**全部** 264 笔。资金侧从不 Binding（可用保证金 USDT 3,500.82 / USDC 4,969.99；单候选资本上限 2,508.79–3,639.32；planned 仅 5.008–15.515）。合法拒因是两条 ② 类权威：绝对 gross/human 上限 −301.59，与 22 行 ack 超期。另有 3 笔因私有账户新鲜度（`PRIVATE_ACCOUNT_NOT_FRESH` + `ACCOUNT_EQUITY_UNPROVEN` 等）被证据层拒绝——那也属于必须保留的 ① 类。

**7) 哪些阻断属于 stale / duplicate / bug / telemetry-as-veto？**
- **错误归因（bug）**：`reasons[0]` 字母序当作首因（V7 / V12）。
- **重复权威（duplicate）**：`STRESS_LIMIT:MAX_CLUSTER_NOTIONAL` 在 `clusters:{}` ⇒ 单一 `UNMAPPED_CORRELATED` 下与 gross **恒等**（三个 10,811.957 上限实为同一个数）；`HUMAN_POTENTIAL_NOTIONAL_LIMIT` 在"全部持仓都是 handoff"的书上同样恒等于 gross。二者都**该继续 ENFORCE**（删值即放宽政策），但**不该被报成三道独立的门**。
- **重述标签遮蔽真门**：`PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 只是 `snapshot.blockers` 非空的摘要（`portfolioRiskSnapshot.ts:262`），本身不是一道门。
- **临界值被过期瞬时状态放大（stale，仅影响数值不影响判定）**：`PENDING_RISK_UNVERIFIED` 行的名义被计入 `grossNotionalUsd`（`portfolioRiskSnapshot.ts:242`）。例：13:04:53 VIRTUALUSDT 的 claim gross=`11,701.85`，同期书内毛名义 `11,113.54` ⇒ 约 **+588 USD** 的瞬时 pending 计入，使"需人工减仓多少"从 306.6 被报成约 893.5。
- **telemetry-as-veto（④）**：容量层本身没有 veto，但它的 `sideStatus=BOTH_SIDES_EXECUTABLE / 可执行 396.28` 成为**派发模型的依据**，等于把"应只作展示/告警"的判断送进了生产路径（V11）。
- **对照面（正确的 OBSERVE 语义）**：economic 层 267 次全部 `wouldBlock=true`（`ECONOMIC_MIN_NET_PROFIT_UNMET` 264、`HUMAN_MANAGED_EXPOSURE_LIMIT` 267、`TP_REACH_PROBABILITY_UNMET` 204），因 `admissionMode=SHADOW` 而**没有**升级为 veto——这是 runbook 要求的样子，本轮不动。

**8) 如果修完错误阻断，下一个真正会阻止 Submit 的条件是什么？**
两个 ② 类权威，缺一不可由系统自行消除：
1. `HUMAN_ACK_OVERDUE`（22 行，最旧 175.2 h）——与规模无关，**只能人工 ack**；
2. `maxGrossNotionalUsd = maxHumanNotionalUsd = 10,811.957` vs 现有 `11,113.54` ⇒ 需人工减仓使毛名义降到 `10,811.957` 以下，并留出候选名义（≥ `306.60` USD 起，最大一笔 `317.10` USD）。
两者同时满足后才会出现第一笔 reservation。再往后的 veto（TRADE_PLAN / RESERVATION / LIVE_RISK_ENVELOPE / maker 可达性）在本窗口**事件数为 0，属于未观察**，不作任何通过性声称。

---

## 4. 分类汇总（runbook 的 1/2/3/4）

| 类别 | 条目 | 处置 |
|---|---|---|
| ① 交易所/资金/执行正确性 | 交易所 minNotional/minQty/stepSize、leverage & margin-tier 实证、私有账户新鲜度（`ACCOUNT_ASSET_UNVERIFIED`、`PRIVATE_ACCOUNT_NOT_FRESH`）、JIT 严格复算、reservation 幂等/代际 | 保留，不动 |
| ② 合法且真实生效的风险约束 | `maxGrossNotionalUsd/maxHumanNotionalUsd/maxClusterNotionalUsd/maxDirectionNotionalUsd` 绝对上限、`HUMAN_ACK_OVERDUE`、`MIN_MARGIN_BUFFER`、`MAX_STRESS_LOSS` | 保留，不动；但**临界值必须在 AI 调用前显式体现** |
| ③ 重复权威/过期状态/错误作用域/错误归因/实现缺陷 | 字母序 `reasons[0]` 归因；容量层与 envelope 硬编码 `portfolioRisk.allowed=true`；`cluster==gross` 因 `clusters:{}` 而成为第三重述；`PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 作为摘要标签；pending 瞬时计入放大临界值 | **Phase 2 只修这些** |
| ④ 仅应 telemetry 却参与生产决策 | `sideStatus/exhaustedForNewRisk`（OBSERVE 语义）驱动了 268 次模型派发 | 修③时一并闭合 |

---

## 5. 被证据否证的原始假设（不改）

初始假设："`UNKNOWN_RISK_EVIDENCE_TTL_MS = 5 min`（`reconciliationService.ts:17`）短于提升后的审计阶梯 `[5,15,30] min`（`entryRiskOccupancy.ts:45`），因此已证明无风险的行会在每个周期里重新占用 ~25/30 分钟。"

`a03` 普查（539 条持久化 entryOrders 的临时副本）否证了它：

- `status=UNKNOWN` 共 **47** 行，其中 **47/47** 具备完整四源缺失证明（`BINANCE_EXACT_ORDER_NOT_FOUND + OPEN_ORDERS_IDENTITY_ABSENT + USER_TRADES_IDENTITY_ABSENT + ALL_ORDERS_IDENTITY_ABSENT`，并含 `BINANCE_LONG_SHORT_POSITION_ZERO` 或 `POSITION_PRESENT_PROVEN_OTHER_CYCLE`）；
- 层级分布 **tier2=46 / tier0=1**；普查时刻 **47/47 证明仍在有效期**，`occupyingCount=0`、占用名义 `0 USD`；
- 逐行时间自洽：例如 XRPUSDC `checkedAgo=3.5 min`、`validLeft=26.5 min`、`nextAuditIn=20.2 min` ⇒ **证明 TTL 实际等于该行自己的阶梯间隔（≈30 min）**，`nextAuditAt < validUntil` 恒成立，不存在 5 min 常量的错配。

因此 `PENDING_RISK_UNVERIFIED`（15 个订单 / 64 次）是**再证明迟到时的瞬时 fail-closed**（窗口内 `ENTRY_ORDER_REMOTE_UNVERIFIED` 事件 804 次，与 R15/R17 已定的"不再优化请求数"停止线一致）。**本轮不改 occupancy 判定、不延长任何 TTL、不把 UNKNOWN 当 0。**

---

## 6. Phase 2 计划（≤5 项，只修 ③④）

1. **归因唯一化**：`admit()` 返回的 `reason[0]` 改为"按数值 Binding 的门"，并附每道门的 `{limitUsd, usedUsd, headroomUsd}`；对外 code 与驾驶舱 nextAction 引用同一份数字。绝不因归因而放松任何 veto（`HUMAN_ACK_OVERDUE` 仍是 veto，只是不再冒充数值首因）。
2. **容量与准入同一权威**：让 ledger 的**无候选**准入容量事实（绝对上限 headroom + 与规模无关的拒因）成为容量视图与 pre-AI envelope 的输入，取消两处 `portfolioRisk:{allowed:true}` 硬编码；使 `sideStatus / firstBlocker / exhaustedForNewRisk / envelope.executable` 与最终 `admit()` 语义一致，从而**不再为注定被拒的候选派发模型**。
3. **重述标签的呈现**：`STRESS_LIMIT:MAX_CLUSTER_NOTIONAL` 与 `HUMAN_POTENTIAL_NOTIONAL_LIMIT` 保持 ENFORCE，但在事实里携带其作用域（`clusterKey=UNMAPPED_CORRELATED`、`human==gross` 的原因），并把 `PORTFOLIO_RISK_SNAPSHOT_INCOMPLETE` 降为其底层 blocker 的摘要（不是独立门）。
4. **临界值不被瞬时 pending 放大**：在报告面区分"书内毛名义"与"含待证成敞口的 claim 毛名义"，两个数都给出，使"需人工减仓多少"可核对。
5. **测试**：覆盖 runbook 的 10 项（显示与准入不矛盾 / OBSERVE 不 veto / ENFORCE 真 veto 且体现在 pre-AI / 状态按生命周期自清除 / telemetry 永不 veto / 资金不足必拒 / 低于交易所最小必拒 / filter·tier·leverage 未证必拒 / JIT·版本·域冲突必拒 / 修完一个 blocker 能正确暴露下一个而不是假 PASS）。

### 明确不做（停止线）

- 不改任何阈值/上限为 Infinity 或"调大到能过"；不 ack、不删 handoff 行、不减仓、不制造 PLACE/成交。
- 不改 UNKNOWN/`PENDING_RISK_UNVERIFIED` 的 fail-closed 语义，不延长 TTL，不把 UNKNOWN 当 0（§5 已否证该假设）。
- 不"修" `clusters:{}`：填相关性簇会把 cluster 从恒等于 gross 变成真·独立约束，属于**新增风险权威**，需要治理决定，不在本轮。
- 不动 `tradeEconomics.admissionMode=SHADOW`、`minNetProfitUsd=1`、`0.15` reachability、`aiExitAuthority=SHADOW`、Production 锁。
- 不再优化 `/order` 请求数（R15/R17 停止线）。

**目标状态**（Phase 2 结束时二选一）：`V396_PLACE_TO_SUBMIT_ROOT_CAUSE_CLOSED` 或 `V396_PLACE_TO_SUBMIT_BLOCKED_BY_VALID_ENFORCED_RISK`。按 §C/§D 现有证据，若不同步发生人工 ack 与人工减仓，可达到的诚实终态是后者。

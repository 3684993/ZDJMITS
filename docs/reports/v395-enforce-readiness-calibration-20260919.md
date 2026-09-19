# ZDJ-MITS V3.9.5 ENFORCE 就绪度校准报告（silent clamp 修复 + 全量 SHADOW 反事实 replay）

- 时间：2026-09-19 10:05–10:40 (+08:00)
- 本轮边界：只读调查 + 独立分支代码修复；**未切 ENFORCE**、**未动 live Settings**、**未平仓 HUMAN_MANAGED**、**未重启 live Engine**（PID 26520 全程连续运行 49 分钟，未中断）
- 代码分支：`v395-enforce-readiness-20260919`，基线 `0223be94be41c55b8e85d54a9fed489ac5b94764`，HEAD `7beaa0b456ff0cbc19ace07966849270071227d2`
- 数据源：`D:\MITS\data\zdj-settings.sqlite` 的 durable `runtime_events`（**以 mode=ro 只读打开，未写一行**）+ 公开 klines；不使用任何合成样本

---

## A. silent clamp 是否已修复 — **已修复**

`apps/engine/src/config/settingsStore.ts` 迁移分支改判为**按字段事实识别 legacy 文档**：

```ts
const legacyEconomicsDocument = !record(next.tradeEconomics);
const tp=(next.takeProfit??={}) as Record<string,unknown>;
if(legacyEconomicsDocument)tp.minNetProfitUsd=Math.min(20,Math.max(1,Number(tp.minNetProfitUsd??1)));
```

- **判定依据不是 `settingsVersion`**：`tradeEconomics` 缺失 ⇔ 该文档从未被 V3.9.5 迁移过。真实 revision 已是 178，`≤19` 那种门槛永远不成立，这条要求被严格满足。
- 未迁移文档：一次性把 `<1` 抬到 1（0.01 → 1 保持既有正确行为），并补齐 6 个 `tradeEconomics` + 3 个 `positionManagement` 新字段。
- 已迁移文档：**完全不再改写** `minNetProfitUsd`。越界值（0.5、25）交由 `SystemSettingsSchema.parse` 抛出 → `SettingsStore.load()` 拒绝 → 引擎**启动失败（fail-closed）**，而不是静默改成 1/20。与仓库既有约定一致（保存路径同样是 Zod 抛错而非 clamp）。
- 附带修复（同一提交族，均为极小确定改动）：
  1. **启动即验证固定出口** + 每 15 分钟复验（`verifyBinanceTransportEgress()`，`appRuntime.start()` 内 2 行）。审计确认此前**根本不存在**开机或周期性探针：`verifyEgressIp()` 唯一调用者是 `BinanceTransport.health()`，而 `health()` 唯一非测试调用者是人工探针端点。因为 `assertTestnetExchangeWrite` 在 `status!=='VERIFIED'` 时对**每一笔写**抛 `TESTNET_WRITE_EGRESS_NOT_VERIFIED`，每次重启都会造成一段**交易所写阻塞窗口**（本次实测 boot 09:46:27 → 人工探针 09:50:25 = **238 秒**）。这属于 ENFORCE canary 的直接障碍，修复 6 行、不触碰 `requestBudget.ts`、lane、优先级或 deferral。
  2. **期望出口 IP 变更时作废旧证明**（`applyRoute` 内 `carried = prior.expectedEgressIp===expected ? prior : null`）。原实现在只改 `expectedStaticEgressIp` 时会保留 `VERIFIED` + 旧 IP + 旧时间戳 = **fail-open**；现降级为 `UNVERIFIED` 直到重新证明。
- 未改：`settingsVersion` 语义、live 值（仍 `minNetProfitUsd=1`、`version=178`）、任何已验收架构。

## B. migration / 隔离 tests 是否全部 PASS — **是**

新增 5 个 migration 用例 + 2 个旧仓隔离用例（全部按要求的语义写）：

| # | 用例 | 断言 | 结果 |
|---|---|---|---|
| 1 | legacy(无 `tradeEconomics`) + 0.01 | 迁移为 **1**，同时补 `SHADOW`/`CUSTOM`/caps=4 | PASS |
| 2 | 已迁移 + **0.5** | `load()` **reject**；DB 行仍是 **0.5**（未被改成 1）、`version` 仍 177 | PASS |
| 3 | 已迁移 + **25** | `load()` **reject**；DB 行仍是 **25**（未被改成 20） | PASS |
| 4 | 已迁移 + 合法 **1 / 2 / 20** | 三个值原样保留，`settingsVersion` 保持 177 | PASS |
| 5 | 迁移后再连续 `load()` ×3 | 文档逐字节相等、版本不 creep、`minNetProfitUsd` 仍 1 → **幂等** | PASS |
| 6 | 旧仓（无 `economicAdmission`）TP 净利 < $1 且订单 WORKING | `place`/`cancel` **均未被调用**、`PROTECTED` 保持、`tpOrderId` 与价格不变、`HUMAN_MANAGED` 状态不变 | PASS |
| 7 | 旧仓需新建 TP 时 | AI 目标（0.8%）**被 legacy 1.2% 距离门槛拒绝**，回落到 ≥1.2% 的确定性保护 | PASS |

整链验证：`npm run verify`（`verify:deps` → `verify:scripts`（含 4 个 PowerShell 契约测试）→ `typecheck` 4 个 workspace → `build` → `test`）= **`VERIFY_EXIT=0`，Test Files 112 passed / Tests 全通过**；`git diff --check 0223be9..HEAD` 与 whitespace gate **干净**；`0223be9..7beaa0b` 共 **5 个文件、+91/−6**。

## C. 当前累计 SHADOW 样本数量

引擎自 09:46:27 启动至 10:35 采样窗口内（**未等待新窗口，全部为已产生数据**）：

- `ENTRY_ECONOMIC_ADMISSION_EVALUATED`：**23**
- `ENTRY_INTENT_CREATED`：**14**（其中 **14/14 携带 `economicAdmission` 证据** —— 证明 SHADOW 会写证据但不拒单；`economicAdmission` 仅在 `OFF` 时为 null）
- `ENTRY_ORDER_SUBMISSION_UNKNOWN`：**7**，reason **7/7 = `ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS`**
- 自启动至今 **`ENTRY_ORDER_CREATED` = 0**（未产生任何新成交仓位；仓位由 12 → 10 全部因 TP 止盈）
- admission↔intent 关联覆盖 **14/23**（另 9 条无对应 intent，AI 未下 PLACE 决策）；side 分布 **LONG 14 / SHORT 0**（值得单列观察）
- 观测时长 ≈ 49 分钟

Blocker 频次（占 23 条评估）：

| blocker | 数量 | 比例 |
|---|---:|---:|
| `HUMAN_MANAGED_EXPOSURE_LIMIT` | 23 | **100%** |
| `TP_REACH_PROBABILITY_UNMET` | 13 | 56.5% |
| `TP_HISTORICAL_REACHABILITY_UNMET` | 3 | 13.0% |
| `ECONOMIC_MIN_NET_PROFIT_UNMET` | 2 | 8.7% |

共现矩阵（成对计数）：`HUMAN∩REACH_PROB` 13、`HUMAN∩REACH_HARD` 3、`HUMAN∩NET_PROFIT` 2、`REACH_HARD∩REACH_PROB` 3；`wouldBlock` **23/23 = 100%**，`passed` **0/23**。

profit blocker 比例 8.7%；reachability 类（两种合并去重）13/23 = 56.5%；HUMAN_MANAGED 类 100%。

## D. 当前真实配置下的 ENFORCE pass rate — **0 / 23 = 0.0%**

`maxHumanManagedPositions=4`、`maxHumanManagedNotionalPctEquity=0.2`、`minHistoricalReachProbability=0.50`、`minNetProfitUsd=1` 下，**每一个候选都会被拒**。因为人类仓上限以 100% 频率出现，ENFORCE 现在是**全量封死**，不是"部分收紧"。

## E. 忽略 HUMAN_MANAGED cap 后的 pass rate — **8 / 23 = 34.8%**

仅在离线 replay 中忽略该 blocker（live 设置一字未改）：

- 通过的 8 条符号：ZECUSDT ×3、ENAUSDT ×2、ENAUSDC、USELESSUSDT、FILUSDT
- 剩余 blocker 分布：`TP_REACH_PROBABILITY_UNMET` 13、`TP_HISTORICAL_REACHABILITY_UNMET` 3、`ECONOMIC_MIN_NET_PROFIT_UNMET` 2
- 结论：**cap 是第 1 位阻断因子，可达性是第 2 位**；去掉 cap 也只把 pass 率从 0% 抬到 34.8%，即 economics+reachability 自身就会拒掉 65.2%。

## F. Reachability 0.30 / 0.40 / 0.50 / 0.60 对比

以每条样本**引擎在决策时刻记录的** `reachProbability` 复算（该值由 `historicalTpReachability.ts:57` 只用 `isClosed!==false && closeTime<=now` 的已收盘 K 线、并剔除窗口末端 `steps` 根不可作锚点计算 → **不存在未来数据泄漏**；阈值比较是 `p+1e-12 < θ` ⇒ **等于 θ 视为通过**）：

| θ | 含 cap 的 pass | 忽略 cap 的 pass | 忽略 cap 后 bySide |
|---:|---:|---:|---|
| 0.30 | 0 / 23 = 0% | **10 / 23 = 43.5%** | LONG 5, 未关联 5 |
| 0.40 | 0 / 23 = 0% | **8 / 23 = 34.8%** | LONG 4, 未关联 4 |
| 0.50（现值） | 0 / 23 = 0% | **8 / 23 = 34.8%** | LONG 4, 未关联 4 |
| 0.60 | 0 / 23 = 0% | **6 / 23 = 26.1%** | LONG 4, 未关联 2 |

实测 `reachProbability` 23 个值：`0, 0, 0, 0.013, 0.122, 0.128, 0.221, 0.228, 0.28, 0.288, 0.289, 0.322, 0.392, 0.5, 0.583, 0.594, 0.672 …`（分布左尾极重：3 个为 0）。0.40 与 0.50 计数相同，是因为区间内没有落在 `[0.40,0.50)` 的样本，且 0.5 恰好判为通过 —— 这是**样本太少**造成的平台，不是阈值不敏感。

**事后价格核对（诚实结论：目前不足以下判断）**：23 条中只有 **3 条**的 `targetHorizonMinutes` 窗口已走完（11 条仍在窗口内、9 条未关联 intent）。这 3 条的混淆矩阵在四个 θ 下一致：

- `predictedPass & REACHED` = **0**
- `predictedPass & NOT_REACHED` = **1**（false positive）
- `predictedBlock & 会达到`（false negative）= **0**
- `predictedBlock & NOT_REACHED` = **2**

即：**n=3 时没有任何统计资格调 θ**。已按公开 klines 建立可复算管道（每符号 1 次请求、只取决策后已收盘的 bar），但**本轮不建议据此改 `minHistoricalReachProbability`**，需要至少数十条已关闭窗口样本。

## G. HUMAN_MANAGED count / notional cap 的真实语义是否正确 — **是 notional 本意，不是单位错位**

源码与设计文档三方一致：

- 实现（`economicEntryFeasibility.ts:21-29`）：`notionalUsd = Σ|quantity × markPrice|`（只按 `managementStatus==='HUMAN_MANAGED'` 过滤，不分 quote asset、不计杠杆、不取 margin）；`withinLimits = !enabled || (count < maxPositions && notionalUsd < equity × pct − 1e-8)`，两个上限是 **AND**，且都是**严格 `<`**。
- 设计意图（计划 §3.6 :317-322）：原文是"必须新增**只阻止新增风险、不自动平仓**的 Human Managed portfolio envelope"，并**分别列出** `maxHumanManagedNotionalUsd / …PctEquity` 与 `maxHumanManagedMarginUsd / pct equity` 两种候选上限；实现选择了 notional 版，margin 版**从未实现**（`settings.ts:29` 无该字段）。§3.1 :205 定义 `N=名义仓位`、`P_net=N×(m−c_eff)`；:330 "HUMAN_MANAGED 累积超过上限 → 新 Entry fail-closed"；:326/:330 明确目的是避免"为了多赚 2 USDT 把尾部风险放大几十倍"。
- 仓库惯例：所有 `%Equity`/exposure 族上限都是 **notional** 口径（`executableRiskHeadroom.ts:18,24-25`、`liveValidationService.ts:58`、`riskReadiness.ts:52`、`humanManagedProjection.ts` 的 `notionalPctEquity`）；margin 口径一律以 **margin 命名**（`maxMarginPerPositionUsd`、`maxQuoteAssetMarginUsagePct`、`maxEquityPct`）。
- 计划对 `notional = leverage × margin` 这层关系是**沉默**的（只有 :356 "杠杆…只降低所需保证金" 的定性表述）。

⇒ **保持 notional 语义不变，不改单位。** 但必须把下面的量化后果交给决策者（见 H）。

## H. 当前 cap 为什么会造成全局停摆 — 不是 cap 太严，而是它与杠杆/仓位规模在量纲上几乎不可能同时满足

当前账本（10:35 实况）：`count=9`、HUMAN_MANAGED `notionalUsd=$9,691.31`、`equityUsd=$10,646.11`。

- **notional/equity = 91.03%**，而同一批仓位的 **margin/equity ≈ 11.29%**（≈8.5 倍差，正是 8–17x 杠杆的乘积）。
- 上限 `0.2 × equity = $2,129.22`：**单个** BCHUSDT($3,753) 或 UNIUSDC($3,682) 就已经超过整个 HUMAN_MANAGED 名义预算。
- 因此 notional cap 被超出 **4.55 倍**，且它是**唯一绑定约束**：位置数上限 4 目前**根本不参与判定**（先被 notional 否掉）。

cap 灵敏度网格（enforce pass rate，θ=0.5）：

| maxPositions＼pct | 0.2 | 0.5 | 0.9 | 1.0 | 2.0 |
|---|---|---|---|---|---|
| 4 | 0% | 0% | 0% | 0% | 0% |
| 8 | 0% | 0% | 0% | 0% | 0% |
| 10 | 0% | 0% | 0% | **34.8%** | **34.8%** |
| 12 / 20 / 50 | 0% | 0% | 0% | 34.8% | 34.8% |

- 通过所需的最小放宽：**pct ≥ 0.9104**（即当前 notional/equity + ε），或先把 HUMAN_MANAGED 账本降到 1 仓以内。`maxPositions` 单独放大到 50 **完全无效**。
- 语义后果（事实陈述，不代表建议）：按 notional 口径，`pct=0.2` 在 8–17x 杠杆下等价于"HUMAN_MANAGED 只能容纳 ≤1 笔典型仓位"（200 margin × 8x = 1,600 notional = 15% equity，200×17x = 3,400 = 32% 已超）。也就是说这个上限**按设计就是极端保守**：它不是"限制尾部规模"，而是"一旦积累人工扛单就冻结新建仓"。
- count cap 与 notional cap **不互相矛盾**（AND 关系、各自独立），但在当前杠杆结构下 count cap 被 notional cap 完全遮蔽 —— 这是一个可报告的设计张力，**本轮未修改任何阈值**。

## I. `$1` minNetProfit 的实际过滤作用 — 弱但非无效；且旧仓实证被完整豁免

23 条 `expectedNetProfit`（USD，requiredNetProfit 恒为 1）：

- 分位：**p10 1.343 / p25 1.689 / p50 2.023 / p75 6.281 / p90 9.589**
- 区间计数：`<1` **2** 条、`1–2` **9** 条、`2–3` **2** 条、`≥3` **10** 条
- 门槛灵敏度：`<1` 拒 2/23 (8.7%)；`<2` 拒 11/23 (47.8%)；`<3` 拒 13/23 (56.5%)；`<5` 拒 15/23 (65.2%)

结论：$1 **确实过滤了真实存在的负/微利目标**（8.7%，不是"人人天然通过"），但它不是主要 blocker（100% 的阻断来自 HUMAN_MANAGED，56.5% 来自可达性）。**本轮未上调该值**（按要求不自动调），并保留灵敏度表供决策。

**旧仓隔离的运行时实证（比测试更硬）**：WLDUSDT 与 ADAUSDT 两个旧仓的 TP 分别净利仅 0.65 与 0.13（**均低于新 $1 下限**），V3.9.5 运行期间**两者都由交易所按原 TP 价原样成交止盈**（`EXCHANGE_FILL_ATTRIBUTED`，clientOrderId 就是原 TP 单），随后才有 `ORPHAN_TP_CANCELED reason=NO_MATCHING_POSITION` 的平仓后清理。既没被拉远、也没被取消 —— 与 §B 用例 6 一致。

## J. 哪些参数有数据支持可以调，哪些没有

**有数据支持（可谈，但需人工决策）：**

1. `positionManagement.maxHumanManagedNotionalPctEquity` —— 数据说明它在 8–17x 结构下使 cap 相当于 ≤1 仓，且当前被超 4.55×；任何 ENFORCE 之前必须显式决定它到底想约束"尾部名义敞口"还是"已锁定的人工仓位规模"。**但**：放宽它 = 降低安全标准，本轮**不做**，仅呈报。
2. `positionManagement.humanManagedAdmissionCapsEnabled=false`（计划 §3.6 明确支持的开关）—— 只让 `withinLimits` 恒真，可干净地测"纯 economics+reachability"路径（E 段的 34.8% 就是它的预期结果），比改数值更可审计。
3. 非 V3.9.5 的既有问题也压着 throughput，**调 economics 参数不能解决**：7/14 intent 死于 `ENTRY_SUBMISSION_UNKNOWN_DURABLE_TASK_EXISTS`（15 个历史 UNKNOWN 行长期占住 scope-unique claim，饿死同一 underlying 的新建仓），另有 `REJECT_DIRECTION_EXPOSURE` ×9、`AI_DIRECTION_NOT_EXECUTABLE` ×4、`MARKET_QUALITY_NOT_ADMITTED` ×3。

**没有数据支持（本轮明确不调）：**

- `minHistoricalReachProbability`：只有 3 条已关闭结果窗口，1 FP / 0 FN，**任何下调都无依据**。
- `minNetProfitUsd`：$1 已过滤 8.7%，但分布右尾很肥（p75 6.28），是否值得抬到 2/3 取决于目标入场率，当前 23 条样本 + 0 条实际 ENFORCE 结果不足以决定。
- `maxHumanManagedPositions`：目前被遮蔽，单独调它**零效果**（表格已证）。
- notional vs margin 语义：源码+计划+仓库惯例三方一致，**不改**。

## K. 是否已具备进入 ENFORCE Canary 的条件 — **不具备**

1. **零入场**：当前配置 ENFORCE pass rate = **0.0%**（23/23 拒），Canary 会空转到超时。
2. **要恢复入场必须先解 cap**，而解法要么放宽安全阈值（本轮禁止）、要么人工消化 9 个 HUMAN_MANAGED（本轮禁止且需人工决策）。
3. **可达性未被真实结果校准过**（F 段 n=3）→ ENFORCE 会把一个未验证的指标变成硬拒单条件。
4. **durable-claim 饥饿（P2）尚未处理**：即使 ENFORCE pass 率提高，7/14 的 intent 仍会死在同一 underlying 的历史 UNKNOWN 上。
5. SHADOW 时长仅 49 分钟、样本 23 条、side 全为 LONG —— 缺少 SHORT 路径覆盖（ENFORCE 后方向不对称无从判断）。

live 侧唯一"硬"缺口已在本轮修好（重启写阻塞 238 s），其余都需要决策而非代码。

## L. 建议的 Canary 配置（只列事实依据，未应用）

| 项 | 建议值 | 事实依据 |
|---|---|---|
| 前置 A | 由人工把 HUMAN_MANAGED 名义降到 ≤ `0.2×equity`（当前需 ≤$2,129，现 $9,691） | 否则 pass rate 恒 0（D、H） |
| 前置 B（替代 A） | `humanManagedAdmissionCapsEnabled=false`（计划支持的标准开关，不改任何数值语义） | E 段：纯 economics+reachability pass = 34.8% |
| `minHistoricalReachProbability` | **保持 0.50** | F：θ 无结果数据支持；四档 pass 率仅 26.1%–43.5% |
| `minNetProfitUsd` | **保持 1** | I：已过滤 8.7%，右尾 p75=6.28，无依据上调 |
| canary 规模 | 沿用 Stage7 量级（`CanaryMarginUsd=5`、`maxPositions=1`、`maxPendingEntries=1`、dynamic margin off，AI 自然入场） | V3.9.4 已验收的 canary 形态；本轮不发明新配置 |
| 前置 C | 先修或绕开 `DURABLE_TASK_EXISTS` 饥饿（例如 canary 选一个 15 个 UNKNOWN 未占用的 underlying） | 7/14 intent 死于该原因 |
| 观测门禁 | ENFORCE 后要求 `ENTRY_ECONOMIC_ADMISSION_EVALUATED{mode:ENFORCE}` 与真实下单一致，且旧仓 `tpOrderId` 集合不变 | 用例 6/7 + I 段运行时实证 |

**不自动应用任何一项。**

## M. 当前 exact HEAD / CI / Engine 状态

| 项 | 状态 |
|---|---|
| live 运行代码 | `3.9.5-f93676140a441bc0199c`，源码 **`0223be94be41c55b8e85d54a9fed489ac5b94764`**，PID 26520，instanceId `f38e3dec…`，连续运行 49.1 分钟，**本轮未重启、未热重载** |
| live 模式 | `admissionMode=SHADOW`、`parameterProfile=CUSTOM`、`minNetProfitUsd=1`、`settingsVersion=178`、`RUNNING` + `AUTO_RUNNING` |
| live 健康 | `/health READY`、DB `HEALTHY`、WS `LIVE`、recon `READY`、`unresolvedDriftCount=0`、`activeRiskUnresolvedCount=0`、`historicalUnknownCount=15`（未增） |
| live 仓位 | 10 仓（HUMAN 9 / AUTO 1）、**10/10 TP PROTECTED**、`missing=0`、`unverifiedTp=0`、`orphanTp=0`；两次减少均为 TP 自然止盈（WLDUSDT 09:50、ADAUSDT 10:30） |
| live 治理 | `demo-fapi.binance.com`、egress `VERIFIED 172.104.186.174`、`429=17 / 418=3`（零新增）、`productionWrites=0` |
| 本轮代码 | 分支 `v395-enforce-readiness-20260919` @ **`7beaa0b456ff0cbc19ace07966849270071227d2`**（基于 `0223be9`），5 文件 +91/−6，**已推送 origin** |
| 本轮 CI | 本机 `npm run verify` **全绿**（112 test files / 0 fail / whitespace check 干净）。远端 Actions **未对本分支运行**：`V3.9.x Verify` 的 push 触发是显式分支白名单，不含新分支名 —— 需要 ChatGPT 决定是否把该分支加入白名单或合入 `v395-economics-human-managed-20260919`（那会改变已验证 HEAD） |
| 未改动 | live Settings、live dist、42 个 untracked 项、V3.9.4 回滚基线、8081/8084/代理、request governance 架构、AI 自主权、唯一退出链、HUMAN_MANAGED 语义 |

### 遗留与优先级

- **P2**（已在本轮以 6 行修掉的启动写阻塞窗口，若不合入则每次重启仍需人工探针 4 分钟）
- **P2** UNKNOWN 行长期占住 scope-unique durable claim → 同一 underlying 的新 Entry 被 `DURABLE_TASK_EXISTS` 拒绝（7/14 观测）。风险正确 fail-closed（`activeRiskUnresolvedCount=0`），但**吞吐会计缺口真实存在**，且 UNKNOWN↔VERIFIED 抖动不会把 15 行收敛到真正终态。**未重写 UNKNOWN 架构**（按要求）。
- **观察** 49 分钟内 14/14 intent 全为 LONG；可达性 `reachProbability` 有 3 个 0 值 —— 说明 AI 常给出历史几乎不可达的目标，这是 economics 层未来的真正课题，而非阈值。
- **观察** 本轮又新增 1 个 UNKNOWN（entry 状态计数）以外的账本无增长；`historicalUnknownCount` 保持 15。

### 证据

`D:\MITS-WORKTREES\dryrun\`：`shadow-events.json`（23 条 admission + 14 intent + 全部 block 事件的原始 payload）、`enforce-replay.json`（Stage 2/3A/3B/3C/3D/4 全量输出）、`enforce-replay.py`、`harvest-shadow-events.py`、`human-managed.json`、`live-positions-now.json`。日志：`v395-enforce-{npmci,tests,verify}.log`。

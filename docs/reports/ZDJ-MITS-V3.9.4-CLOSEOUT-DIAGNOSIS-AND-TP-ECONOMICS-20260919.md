# ZDJ-MITS V3.9.4 收尾诊断与止盈经济性设计问题清单

生成时间：2026-09-19 06:56（Asia/Shanghai）
分支：`v394-binance-governance-settings-20260918`
仓库：`3684993/ZDJMITS`
用途：供用户制定下一份升级计划文件；本轮之后助手不再改动任何代码或文件。

---

## 1. 当前系统状态（实测）

```
Stage6  PASS（冻结，未重跑）
Stage7  PASS  STAGE7_PASS_ENGINE_REMAINS_PAUSED=TRUE   ETHUSDT LONG 自然成交 + TP 自动保护
Stage8  PASS  STAGE8_AUTO_TRADING_STARTED  RUNNING + AUTO_RUNNING  maxPositions=50 margin=200 dynamic=on
accept12h RUNNING（约 100/720 分钟，breaks=0，429/418 增量 0，就绪违例 0）
accept24h 未开始
```

12H 结束后接 24H；只有真实满 24H 才可声明 `V3.9.4 Binance API Governance Stable`。runner 为分离进程，独立于本会话继续运行并写 checkpoint。

---

## 2. 止盈收益过低：根因已定位（用户提问的核心）

### 2.1 决定性证据：TP 价格不是 AI 定的

`TP_TARGET_SELECTED`（FILUSDT，2026-09-19 05:08:28）：

```
price=0.9282  source=FIXED_PROFITABLE  reason=STRUCTURE_OUTSIDE_CONFIGURED_DISTANCE
aiPlanPresent=true  aiPlanValid=false
aiHorizonValid=true aiEvidenceValid=true aiRangeValid=true
fullPositionCanaryMinMovePct=1.2
```

AI（27B）原始授权（`decision_chains`）：

```
targetPrice=0.9232  acceptableTargetRange=[0.921,0.925]  →  entry 0.9171 上方 +0.665%
系统实际挂单 0.9282 → +1.210%（= entry × (1 + targetPriceMovePercent 1.2%)）
```

全库统计（`runtime_events`，169 条 `TP_TARGET_SELECTED`）：

| 项 | 值 |
|---|---|
| TP 来源分布 | `FIXED_PROFITABLE` **135（79.9%）** / `AI` 30（17.8%） / `STRUCTURE_15M` 4（2.4%） |
| AI 提供了 TP 的样本 | 132 |
| 其中被判 `aiPlanValid=false` | **102（77%）** |
| 判否主因 | `STRUCTURE_OUTSIDE_CONFIGURED_DISTANCE` 89 次 |

**结论：约八成止盈价由固定常数 `targetPriceMovePercent=1.2%` 决定，而非模型判断；模型给出的结构化 TP 有 77% 被系统否决。** 否决理由不是模型算错，而是"离入场价不足 1.2%"——一个与费用、与 ATR、与仓位名义均无关的固定尺子。

### 2.2 绝对收益只有几美分：两个乘数同时过小

`TP_PROTECTED.tpEconomics`（同一笔）：

```
expectedGrossProfit=0.111  expectedFees=0.00811932  expectedNetProfit=0.10288
requiredNetProfit=0.01  breakEvenPrice=0.9179  minProfitableExitPrice=0.9189  status=TP_OK
```

- 名义仅 `10 × 0.9171 = $9.17` → 1.2% × 9.17 = $0.111，扣费后 **$0.107**
- 经济学闸门实测 109 个 TP 的 `requiredNetProfit` 绝大多数落在 **$0.01–$0.10**（最小值即 `minNetProfitUsd=0.01`）

**需要纠正一个常见误判：问题不是"TP 没覆盖成本"。** 系统确实计算了保本价与最低盈利价，往返成本约 0.06%（maker 进 0.02% + taker 出 0.04%），1.2% 是其约 20 倍。真实问题是：

1. **净收益门槛按"几分钱"设定**，因此"一笔交易是否值得做"没有经济判据；
2. **目标距离是与市场结构无关的固定常数**，并且该常数同时充当了"AI TP 是否有效"的否决条件；
3. 系统把 TP 挂得比模型判断**更远**（0.9282 > AI 上限 0.925），这降低成交概率 —— 可能是部分仓位 TP 长期不成交、最终转入 `HUMAN_MANAGED` 的成因之一（此条仅有机制推断，成交率对比未做）。

### 2.3 用户提出的设计方向（最低净收益 2 USDT + 倒推 + 禁止历史未达位）

用户要求：AI 必须客观，禁止低于 2 USDT 的止盈；由"系统动态配置的最低收益金额"倒推，让 27B 依据趋势调整**数量**与 **TP 位置**；但**禁止**为凑够最低收益把 TP 设到历史周期从未到达的位置。

该方向可行，逻辑闭合形式如下（供计划文件采纳/修正）：

```
设 N = 名义，m = TP 相对入场的收益率，c = 往返成本率（含 feeSafetyBuffer、slippageBuffer、exitFeeAssumption）
净收益 P = N × (m − c)
约束1（经济下限）：P ≥ minNetProfitUsd(=2)
   ⇒ N ≥ 2 / (m − c)   且   m > c（必须留净差）
约束2（可达性上限）：m ≤ 可达移动 m_hist
   m_hist = 由 targetHorizonMinutes 内已收盘 K 线分布给出（如 LONG 取 max(high)/entry − 1 的 p95，或 ATR 倍数），且 TP 价必须 ≤ 该窗口内历史最高价
   —— 即"禁止历史未出现的位置"作为硬约束
约束3（客观容量）：N ≤ PreAiExecutionEnvelope[side].maxNotionalUsd，且 ≤ 风险包络 perTradeRiskUsd 预算
可行集非空 ⇔ 存在 (N, m) 同时满足 1/2/3
   若为空 ⇒ fail-closed 拒绝该 Entry（不得为凑收益放大 m 到不可达位，也不得偷偷缩小 N）
```

职责划分必须明确（这是本设计的关键点）：

- **执行层**只负责把 `c`、`m_hist`、`N_max`、`minNetProfitUsd` 作为**客观事实**放进 Pre-AI envelope；
- **27B** 在该边界内自主选 `quantityUnits` 与 `targetPrice`；
- **TP Guardian 不得再因固定距离常数否决 AI 的 TP**（当前 77% 否决率即此问题），fallback 只应发生在 AI 输出违反硬约束（不可达、超容量、净收益不足）时，且必须记录 `aiPlanInvalidReason`。

### 2.4 必须同时决策的风险权衡（不可忽略）

把最低净收益从"几分钱"提到 $2，由约束1可知名义 N 必须放大（在 m 不变时按 20 倍量级）。而当前政策是**无自动止损、亏损转人工扛单**（见 §3）。因此：

> 单笔名义放大 ⇒ 未实现亏损尾部同比放大。

本轮已有实例：`UNIUSDC LONG qty=410`，未实现 **−120.29**，已 `HUMAN_MANAGED` 挂单扛着，系统未平仓。若为凑 $2 净收益把名义系统性抬高，扛单敞口会同步变大。所以 `minNetProfitUsd` 不能单独调，必须与以下参数**一次性联合决定**：

`minNetProfitUsd` / `targetPriceMovePercent` / `baseMarginUsd` / `maxMarginPerPositionUsd` / `perTradeRiskUsd`（现约权益 1%）/ `maxPositions` / 同时扛单上限（**当前不存在该上限**）

---

## 3. 亏损处置政策（本轮已更正，务必写入升级计划）

- `lossHandoff.ts`：连续 `lossHandoffBars=4` 根 15m 亏损收盘 → `HUMAN_MANAGED` + 事件 `POSITION_HUMAN_HANDOFF (tpRetained:true)`；该服务注释即政策："never calls AI, closes a position, or alters its TP"。
- 政策语义（用户 2026-09-19 明确）：**`HUMAN_HANDOFF` = 人工扛单，不计时长的，不得因"挂太久"或"浮亏变大"而平仓。**
- 系统层面无任何自动止损实现（`stopLoss|forceClose|panicClose|lossCut` 无匹配）。
- **设计缺口**：`POSITION_HUMAN_HANDOFF` 的唯一产出是事件 + 状态字段，**没有人工触达出口**（无告警、无待办队列、无摘要）。6 笔历史空头因此在 `HUMAN_MANAGED` 静默积压 28+ 小时、浮亏扩散至 −485。建议升级计划加入"待人工处置清单"呈现与严重度排序。

---

## 4. 本轮已修复的运维/编排缺陷（均未触碰冻结核心文件）

| 缺陷 | 根因 | 修复 |
|---|---|---|
| Stage7 永不通过 | 引擎重启后 egress 真相（进程内 Map）重置为 `UNVERIFIED`，而 `AssertGovernance` 立即要求 `VERIFIED` | arming 内改用既有代理探针 + 3 次重试，判据不变 |
| Stage7 自杀在途单 | 观察到新 Entry 的瞬间 `PauseEntries`，引擎正确地按 fail-closed 拒绝提交该单（`EXECUTION_PERMISSION_CHANGED`，`exchangeOrderId=null`） | 移除抢跑 pause；单仓上限由 `maxPositions=1`+`maxPendingEntries=1` 结构性保证 |
| 长同步写被误判失败 | `POST /testnet/cleanup/run` 客户端 120s 超时杀死 runner，但引擎继续完成平仓 | 超时记录 + 改为轮询真实 flat |
| 编排器挂死 | 子进程 stdout 管道/重定向文件句柄被常驻 Engine 继承 → 父进程永不见 EOF；`-PassThru` 无 `-Wait` 时 `.ExitCode` 不可得 | 由 `cmd.exe` 持有重定向，只等 cmd 进程退出 |
| 授权名拼错传不进子进程 | 编排器传 `-AuthorizeStage8AutoTrading`，子脚本实名 `AuthorizeAutoTrading` | 契约测试改为**从编排器自身赋值解析 flag 名并对照子脚本 param 块**校验（已用注入原拼错的方式做反向验证） |
| 暴露门禁计数错误 | `@(ApiGet '/positions')` 把 6 元素数组算成 1 → `positions=1` 恒为误报；且把已验证无风险的 `UNKNOWN` 计为 active → 永不放行的死锁门禁 | 整数计数 + 消费引擎风险读模型（`activeRiskUnresolvedCount`、`unresolvedDriftCount`），原始状态仅作观测 |
| Stage8 恢复参数是静默空操作 | Stage7 快照 `settings-before.json` 本身已被污染（三份全是 `1/5/false`） | 编排器自持 pre-canary 基线；canary 形状且无基线则拒绝继续 |
| 测试超时 flake | `snapshotReadOnly`/`riskPauseOverride`/`eipService` 依赖 `createTestHarness` 内 `market.refresh(120)`，vitest 默认 5000ms | 本轮**未改测试**，按仓库既有做法 `rerun-failed-jobs` 取 attempt 2 全绿；建议 V3.9.5 显式设超时或复用单例 harness |

---

## 5. 架构与事实核对结论（供后续会话避免误判）

- **side-neutral 已由机器证明成立**：`sideNeutralEntryAuthorization.test.ts` 走真实 `EntryCoordinator.analyze()`，在 `NEW_LISTING` + tier/symbol 双重 `SHORT_ONLY` + `preferredDirection=SHORT` 下，Primary 的 `PLACE_LONG` 完整存活（prompt 无泄漏、side/quantityUnits/acceptablePriceRange 未被改写、超 envelope 仍 reject 不 clamp）。
  **裁决：legacy 方向面不构成生产影响，全部延后 V3.9.5。** 本轮未修改任何冻结核心文件。
- 历史 `DIRECTION_NOT_ALLOWED` 后置否决已由 `f6c6941`（09-17 11:53）移除；`DirectionPolicyService` 在 `tradingQualityTestHarness.ts` 中仅是**未被实例化的死 import**。
- 10 笔历史 `UNKNOWN` entry：`exchangeOrderId=null`、`activeRiskUnresolvedCount=0`、`verifiedNoActiveRiskUnknownCount=10` → 不占风险，**未对其发送任何 cancel、未改状态、未动 SQLite**。但它们是**持续背景成本**：每 60 秒触发一轮 `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`（10 符号 × 私有 REST），建议 V3.9.5 评估退避策略。
- 台账 `awaitingReconciliation=10 / fundingUnknownCount=77` → 界面 `INELIGIBLE` 是**净 PnL 台账资格分类**（资金费证据不精确），与平仓授权无关。

---

## 6. 待用户决定的清单

1. **止盈经济下限设计**：`minNetProfitUsd=2` 及其倒推闭环（§2.3），并联合决定 §2.4 的参数集与"同时扛单上限"。
2. **`aiPlanValid` 判据是否解除固定 1.2% 距离否决权**（涉及 `tpGuardian.ts`，属冻结文件，需明确授权与重新验收）。
3. **`HUMAN_HANDOFF` 的人工触达出口**（Dashboard 待处置清单 + 严重度）。
4. **12H/24H 验收的风险档位**（维持常规参数，还是为凑 $2 净收益调整 sizing）。
5. 35 个未跟踪的 `scripts/v393-*` 取证/部署脚本是否入库（本轮**未提交**，因未经密钥审查，属越权风险）。
6. Drive 交付通道：一次性放置 `client_secret.json` 到 `~/.config/zdj-gdrive/`，即可让 `scripts/upload_to_gdrive.py` 自动上传（详见 §7）。

---

## 7. 交付状态

- 期望位置：Google Drive `/codex/zdj`（folder id `1n5Mh3CuuVBQ2IwBpp5cHNEz-tdesEu7J`，父 `codex` = `1Lfj5MV5wpp9matr9RQo0K6mZzCHMBSKh`）。
- **实际未能自动上传**：Drive 的文件上传必须先由真实指针交互打开"新建"菜单才会生成 `input[type=file]`，而当前受控浏览器视图未附加（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），指针操作被拒；仓库自带 `scripts/upload_to_gdrive.py` 所依赖的 `~/.config/zdj-gdrive/client_secret.json` 不存在（该目录为空）。
- 故按用户预先给出的回落方案，本文件与 `EXPOSURE-INVESTIGATION / EXPOSURE-CLEANUP / STAGE7 / STAGE8` 四份报告一并置于 GitHub `docs/reports/`。

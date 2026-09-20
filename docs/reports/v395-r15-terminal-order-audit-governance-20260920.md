# ZDJ-MITS V3.9.5｜R15 历史终态订单复核风暴治理（实施 + 本地 exact-HEAD 门禁 + 一次受控部署 + 短窗验收）

- 轮次：R15（提示词 `docs/prompts/…R15 历史终态订单复核风暴治理…`，branch `v395-economics-human-managed-20260919`）
- 实施时间：2026-09-20 06:59（R14 验收结束）→ 本报告提交
- 候选 HEAD：`232dd9f2c8360a0b3ca9814980afd1f704110cc1`（实现 `e1ea208` + 类型修正 `232dd9f`）
- 部署前运行构建：`3.9.5-b48e7b022bcf41dcfb84`（R14 构建，PID 24300，07:05:28 启动）
- 部署后运行构建：`3.9.5-74271fd488c868b51a16`（PID 24448，09:21:35 启动，`restartCount` 163 → 164）
- 交易许可：全程 `SHADOW` + HUMAN cap 不变，**未暂停交易**，未新增任何风险限额；Engine 仅因部署重启 1 次

---

## A. terminal audit 风暴根因（含对 R14 报告 V-3 归因的更正）

R14 报告 V-3 把 `/fapi/v1/order` 的主力归给了"历史终态订单复核批（`reconciliationService.ts:61`，8 单/轮 + 每单 5 min 节流）"。**这个归因是错的，本轮用直接测量更正：**

1. `reconciliationService.ts:61` 的终态复核批确实存在，但 `factSource==='LOCAL_NOT_SUBMITTED' && !entryHasUnresolvedExchangeTerminalRisk(...)` 的 77 行在**进入探测之前**就被 `continue` 掉了（该分支是"进单前被本地阻断"的正面证据，从未上过线），终态批的上界只有 `8 单 / 57 s ≈ 505 次/h`；
2. 真实主力是**同一批 26 个历史 UNKNOWN**被**两个调用方各自独立重探**：
   - `reconciliationService`：每轮（实测 57 s）一次精确查询 + 一次多源事实取证；
   - `entryCoordinator.reviewPending()`：对 `activeOrderStatus`（含 `UNKNOWN`）逐单 `await findEntryByClientOrderId`，策略节拍 2 s，但被 `reviewBusy` 串行化后实测单周期 ≈ 34 s ⇒ **每个 UNKNOWN ≈ 107.5 次/h，26 单 ≈ 2,796 次/h**；
3. 部署前 3.05 min 精确窗口实测：`/fapi/v1/order` **3,484 次/h**（`ORDER_VERIFICATION` lane，`lastStatus=400` 占 **95%**），`userTrades` 与 `allOrders` 各 **≈ 688 次/h**（每次权重 5），全 lane 合计 **≈ 7,967 次/h**，事件 **1,176–1,790 条/h**；
4. 分解核对（`r15/replay-terminal-audit.json`，`currentDecomposition`）：`3,436 = verifyBatch ≤505 + UNKNOWN recon 135 + 派生 reviewPending 2,796`，与实测同量级 ⇒ 归因成立。

**第二个根因（下文记作 A-4，本轮新发现，比节拍更关键）**：R14 的分层档位在生产上**住不住**。同一进程内 09:12 → 09:17 实测 `unknownRiskAuditsByTier` 从 `[16,0,10]`（同时 `activeRiskUnresolvedCount=16 / unresolvedDriftCount=16 / status=DEGRADED`）变回 `[0,16,10]`（`unresolved=0 / READY`）；部署后的新构建同样在 `[3,16,7] ↔ [14,5,7]` 之间摆动（`deferredUnknown` 10 ↔ 25）。降档动作只可能来自 `reconciliationService.ts` 的 fail-closed 分支（`resetRemoteRiskAudit()`），而该分支在部署后 09:21:35→09:46（25 min）窗口里发了 **56 条 `EXACT_QUERY_NOT_FOUND`**（另一支 `…_VERIFIED_NO_ACTIVE_RISK` 54 条）。

**本轮对本机制作了一次排除法测量，并且推翻了我自己的第一版假设**：我原以为是"同标的仓位归属未决"导致降档，但部署后窗口内 `ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED=0`、`ENTRY_ORDER_NO_ACTIVE_RISK_CONFLICT=0`、`ENTRY_ORDER_NO_ACTIVE_RISK_EVIDENCE_FAILED=0`，且 26 行的 `createdAt` 年龄 2.7–74.1 h 全部在 `UNKNOWN_RISK_MAX_LOOKBACK_MS=7 d`（`reconciliationService.ts:16`）之内 ⇒ 这三个候选全部排除，剩下的唯一路径是 `noActiveRiskEvidence()` 的第一道门 `if(!fullOrderScan||!reader||…)return null`（`reconciliationService.ts:39`）：**在该轮没有做全量 openOrders 扫描时，任何被探测的行都拿不到证据，于是被"证据不完整"打回 T0**，而不是因为出现了对立事实。⇒ 结论：只要"证据不完整"与"出现对立事实"共用同一个 reset 动作，档位就永远住不住；而复核循环是串行的、单次探测受代理往返支配（实测 ≈1.9–2.1 s/次），**哪怕只剩 1 行在 T0，`/fapi/v1/order` 也会被顶到 ≈1,700 次/h 的饱和值**（实测：`deferredUnknown=25` 的那一段仍是 1,716 次/h）。

因此本轮把 R14 的分层判据抽成两个调用方共用的 remote fact audit policy，并把延迟判定移到任何 per-order 精确查询之前：被延迟的行本轮零远端调用（新增集成测试锁死）。终态行按 neverSubmitted / terminal / unknown 三类分别使用 5m→30m→6h、5m→30m→60m、5m→15m→30m 阶梯，仅在同一事实哈希连续重复 3 次后升档；仍占用风险、有已记录成交、或 `exchangeTerminalStatus` 未决的行一律不降频。**但 A-4 说明：降频的上界由"证据完整性"而不是"阶梯设计"决定，这是下一轮的第一靶子（见 X-2）。**

## B. terminal / UNKNOWN 总体分类（部署前只读清点，`runtime_entities`）

`entryOrders` 持久化行共 383：

| 类别 | 行数 | 判据 | 可否降频 |
|---|---|---|---|
| FILLED（`BINANCE_EXACT_ORDER`，有 `exchangeOrderId`） | 148 | 成交事实完备 | 否（有成交，护栏拒绝） |
| CANCELED（`BINANCE_EXACT_ORDER`，无成交） | 110 | 远端终态已确认 | 可（terminal 阶梯） |
| CANCELED（`BINANCE_EXACT_ORDER`，有成交） | 17 | 部分成交后撤销 | 否（有成交） |
| REJECTED（`LOCAL_NOT_SUBMITTED`） | 77 | 进单前本地阻断正面证据 | 可（neverSubmitted 阶梯；实际在探测前即 `continue`，成本恒 0） |
| REJECTED（`factSource=null`，弱终态） | 5 | 无远端 id、无成交、无正面未提交证据 | 可（terminal 阶梯，部署后 `tiers=[5,0,0]` 已确认在档） |
| UNKNOWN（历史） | 26 | 无 `exchangeOrderId`、无成交、5 源 `VERIFIED_NO_ACTIVE_RISK` | 可（unknown 阶梯） |

年龄：26 个 UNKNOWN 从 2.7 h 到 74.1 h；无一有成交、无一有远端 id。

## C. 部署前 replay（先算账，再动手）

`r15-replay.py` → `r15/replay-terminal-audit.json`（`generatedAt 08:48:18`）：

| 量 | 当前 | 候选（预期上界） |
|---|---|---|
| exact-order 探测 | 3,436 次/h（占全部准入流量 43.3%） | 127 次/h（−96.3%） |
| userTrades / allOrders 扇出 | 606.5 + 606.5 次/h | 52 次/h |
| UNKNOWN 审计事件 | 879 条/h（R14 前） | 每状态变化 1 条 + 周期 summary |
| 峰值瞬时 | `verifyBatch` 505/h 上界、`reviewPending` 政策地板 46,800/h | 抖动错峰后不叠加 |

replay 的 127 次/h 假设 26 个 UNKNOWN 全部住进高档位；A-4 说明生产中住不住，因此**候选值只作为上界参考，验收以实测为准**。

被否决的方案（记录在 `rejected`）：neverSubmitted 只用 60 min（74 h 历史里这 77 行产生 0 条交易所事实、95% 探测回 HTTP 400 ⇒ 6 h 归档档保留兜底又去掉 ≈99% 探测）；彻底移除探测（误分类的"进单前阻断"将永无修正路径）；UNKNOWN 也上 5/30/60（扇出已降到 ≈135 次/h，再翻倍只会拉长迟到成交窗口）。

## D. 最终节拍（三类阶梯 + 升档条件）

`apps/engine/src/services/entryRiskOccupancy.ts`：

```ts
export const REMOTE_FACT_AUDIT_LADDERS_MS = {
  unknown:         [5*60_000, 15*60_000, 30*60_000],   // 26 行历史 UNKNOWN
  terminal:        [5*60_000, 30*60_000, 60*60_000],   // 115 行已确认终态
  neverSubmitted:  [5*60_000, 30*60_000, 6*60*60_000],  // 77 行未上wire
} as const;
export const UNKNOWN_RISK_AUDIT_PROMOTE_AFTER = 3;              // 同一事实哈希连续 3 次才升档
export const UNKNOWN_RISK_AUDIT_SUMMARY_INTERVAL_MS = 60*60_000;
```

- T0 = 与治理前完全相同的 5 min 证据 TTL（`keeps tier 0 equal to the pre-tiering five minute evidence TTL`），**新建/在途行零改变**；
- 升档只在 `advanceRemoteFactAudit` 看到与上次**同一 `riskFactHash`**（源集合 + reason）时 `consecutive++`，`tier = clamp(consecutive-3, 0, ladder-1)`；
- 降档/拒绝：`remoteFactAuditEligible` 对 `entryOrderOccupiesRisk`、`filledQuantity>0`、`exchangeTerminalStatus==='UNKNOWN'` 一律返回 false ⇒ 这些行永远按 T0 走，`never slows a row that still occupies risk, holds a fill, or has an unresolved terminal outcome`。

## E. late-fact 检测上界（没有偷走的保证）

| 事实类型 | 治理前 | 治理后 | 说明 |
|---|---|---|---|
| 订单在 openOrders 复活 | 每轮（治理前实测 57 s） | **不变**：共享 `fetchOpenOrders` 全量扫描从不延迟、从不计入降频，且按 identity 匹配；部署后实测 pass ≈10–25 s、全量扫描 ≈70–76 s（`openOrders` 实测 48–120 次/h，与治理前同量级） | `lets a live identity in open orders break the deferral immediately` |
| 迟到成交 / userTrades 出现 | ≈34 s（REST 重探） | **WS 用户数据流实时 + 仓位采纳轮**；REST 兜底受档位上界约束 | 最坏 REST 延迟 = 该行档位区间：unknown 5/15/30 min、terminal 5/30/60 min、neverSubmitted 5/30 min/6 h |
| 仓位可归属到该 cycle | 每轮 | 不变（`position adoption` 轮 + `LATE_EXCHANGE_RISK_FACT_APPEARED` 立即 reset） | `reactivates fail-closed when a position becomes attributable` |
| 新下单/在途单 | 2 s | **不变**（tier 0 且 `nextAuditAt=0` ⇒ 从不延迟） | `audits a fresh UNKNOWN on every pass` |

⇒ 本轮把"迟到事实"的最坏 REST 兜底延迟从 ≈34 s 放宽到"该行的档位 interval（最大 30 min）"，实时通道（WS / openOrders 全量扫描 / 仓位轮）不受影响；这一取舍与 R14 已验收的语义一致，并写成显式门槛 `caps the worst-case active-risk detection latency at the highest tier interval`。

## F. UNKNOWN 残余 exact-query：延迟判定前移

`reconciliationService.ts`：

```ts
let remote=matches[0]?.[1],remoteKey=matches[0]?.[0];
if(!remote&&remoteFactAuditDeferred(local,now)){ /* 计数 + 释放 durable claim */ continue; }
if(!remote&&(needsRiskVerification||verifyBatch.has(id))){ …findEntryByClientOrderId… }
```

`entryCoordinator.reviewPending()`：

```ts
if(['UNKNOWN','NEW','SUBMITTING'].includes(order.status)){
  if(remoteFactAuditDeferred(order,now))continue;
  const verified=await this.exchange.findEntryByClientOrderId(order); …
```

- 行为差别只有一个：被延迟的行**本轮零远端调用**（`performs zero per-order remote calls for a deferred historical row but still probes a fresh one`、`reviewPending skips the exact query for a deferred UNKNOWN and keeps it for a fresh one`）；`continue` 之后原本要做的 `set(id,{...order,status:'UNKNOWN'})` 也不写，状态保持事实源；
- 复核后行为不变：不在 `!verified` 之外的任何路径上改变 status/reservation/deadline；新下单与在途单从不进入延迟集；治理前该循环 26 行 × 1.9 s ≈ 49 s/轮，部署后 T0 行数下降 ⇒ 单行代价不变但轮次更密（串行饱和特性见 A-4 与 P 节）；
- 部署后即时验证：`remoteFactAuditsByClassAndTier.unknown.deferred = 26`（全部 26 行在档）。

## G. 审计同步抖动（确定性错峰）

```ts
export function jitteredNextAuditAt(now,intervalMs,identity){let hash=0;for(const ch of identity)hash=(hash*31+ch.charCodeAt(0))>>>0;
  const spread=Math.max(1,Math.floor(intervalMs*0.25));return now+intervalMs-(hash%spread);}
```

- 只把到期点向**前**挪，最大 25% 档位长度 ⇒ `nextAuditAt` 始终落在 `(now, now+interval]`，**绝不突破安全 interval 上界**；
- identity = `entryIdentityTombstone(order)`（`ENTRY:SYMBOL:clientOrderId`），因此同一行重启前后、两个调用方看到的错峰完全一致（`spreads audit deadlines deterministically without exceeding the tier interval`、`reloads to fail-closed high frequency when the tombstone no longer matches`）；
- 动机：R14 验收量到 08:10:45–08:11:56 的"同步过期尖峰"（26 行同一秒集体失效，扇出叠加）。

## H. 终态复核事件去重

`ENTRY_ORDER_HISTORICAL_VERIFY_FAILED` 改为按 `shouldEmitNoRiskEvent` 语义发：首次 / 证据状态变化 / 档位变化 / 周期 summary；相同结论的重复复核只累加 `suppressedTerminalEvents`。`UNKNOWN_RISK_AUDIT_SUMMARY` 合并两类计数：

```
{deferred, deferredUnknown, deferredTerminal, suppressedEvents, suppressedUnknown, suppressedTerminal,
 auditsByTier, tierIntervalMs, ladders, nextAuditAt}   // 每 5 min 至多 1 条
```

## I. lifecycle 事件降噪：结论是"不改，但记账"

提示词 Stage 9 要求先判断"是否只是重复派生同一状态"。只读核对：

- `candidateLifecycleDeriver.ts:34` 已是 `if(status===oldStatus)continue;` ⇒ **emit 已经只在真实状态变化时发生**，不存在"同一状态重复派生"的 spam；新增 `emits lifecycle re-derivation only on a real transition` 把这条性质钉成回归门槛；
- 部署前 60 min 窗口（08:21–09:21）实测：`runtime_events` 共 **1,719 条/h**，其中 `CANDIDATE_LIFECYCLE_REDERIVED` **1,433 条/h = 83.4%**，第二名 `CANDIDATE_SUPPLY_HEALTH` 63 条/h，而本轮治理的 UNKNOWN 审计事件只有 83 条/h（R14 分层已生效，治理前是 879 条/h）；
- 另一次 60 min 明细抽样：`(READY→POSITION_HELD) 1,264` 而 `(POSITION_HELD→READY) 仅 1`；`triggers = {RECONCILIATION_TERMINAL:747, UNIVERSE_REFRESH:582}`；25 个参与符号中 22 个"多次出现但方向单一"（AAVEUSDT 66 次全部写入 `POSITION_HELD`）。

⇒ 这是**真实的双写者状态打架**（外部把带仓符号写成 READY，deriver 每轮改回 POSITION_HELD），不是噪声。按提示词"必须保持 candidate lifecycle state 不变 / Dashboard 真相不变"，**拒绝 suppress**，把修复留给下一轮（见 X-2）。同时确认：同一标的不重复开仓的硬护栏不依赖该标签（`candidateSupplyHealth.ts:27` 的 `consumed` 直接来自真实 `positions ∪ activeEntries`，deriver `:31` 另用 `occupiedUnderlyings`），因此当前影响是**事件量与标签真实性**，不是准入漏洞。

## J. Primary DEGRADED 语义

新增 `apps/engine/src/services/aiResourceHealth.ts` → `primaryBrainHealth()`：把"模型健康但没有可派发候选"与"模型/服务故障"分开：

判定按 `aiResourceHealth.ts:25-35` 逐条实现（阈值：`lastRunAgeMs > 10 min` 才算"空闲"；`dispatchable = ready && eligible>0 && executableCandidates>0 && poolResidents>0 && pendingEntries<maxPendingEntries`）：

| 条件（按代码顺序） | status | reason | unexplainedIdle |
|---|---|---|---|
| `paused` | `PAUSED` | `RUNTIME_PAUSED` | false |
| `!modelOnline` | `UNAVAILABLE` | `PRIMARY_MODEL_OFFLINE` | false |
| 空闲 > 10 min **且** `dispatchable` **且** `idleReason` 不在已解释集合 | `DEGRADED` | `DEGRADED_UNEXPLAINED_IDLE` | **true** |
| 空闲 > 10 min 且**不** `dispatchable` | `READY` | `IDLE_NO_DISPATCHABLE_CANDIDATE` | false |
| 空闲 > 10 min 且 `idleReason ∈ {WAITING_CANDIDATE, WAITING_EXECUTION_CAPACITY, AI_RESOURCE_BUSY, AI_PRIMARY_CIRCUIT_OPEN}` | `READY` | `IDLE_<idleReason>` | false |
| 其它（含空闲未超阈值） | `READY` | `READY` | false |

⇒ 关键点：**只有在"确实存在可派发组合"时空闲才是故障**；模型侧的 `failed / timeout / schemaInvalid / quarantine` 计数不进入本判定，它们仍由 `aiHealth` 与 `AI_RUN_FAILED` 独立呈现（本轮实测两者全零，见 V 节），因此没有把任何真实故障洗白成 idle。

`appRuntime.ts` 改为消费该判定（`primaryBrainState.status/reason/unexplainedIdle`），**未为此制造任何 AI 调用**。门槛：`does not report a fault for a healthy model that had nothing dispatchable`、`still reports a real model outage and a genuine unexplained idle`。

## K. observability 小修

`unknownRiskLastAuditAt` / `unknownRiskNextAuditAt` 从无审计时的 `0` / `now+86_400_000` 改为 **`null`**（`counts terminal audit tiers and reports a null last audit until one happens`）；新增 `remoteFactAuditsByClassAndTier`，按类给出 `ladderMs / tiers[3] / deferred`。

注意 `neverSubmitted` 的 `tiers=[0,0,0]、deferred=0` **不代表它在花钱**：这 77 行在探测之前就被 `continue`（B 表），因此永远没有审计状态可分档。

## L. 测试矩阵

R15 新增 **14** 个测试（`remoteFactAuditPolicy.test.ts` 7 + `remoteFactAuditIntegration.test.ts` 7），并保留 R14 的 18 个 UNKNOWN 分层测试（其中 1 个断言按 jitter 语义放宽为"不超过 5 min 档且等于同 identity 的抖动结果"）。该区域合计 32 个用例，对提示词 Stage 12 的 24 项：

| # | 项 | 覆盖用例 |
|---|---|---|
| 1–2 | recent terminal 高频 / stable 升档 | `keeps a recent terminal row at the fresh cadence and only escalates on identical proofs` |
| 3–5 | 有成交 / 归属不全 / 未决漂移 不升档 | `never slows a row that still occupies risk, holds a fill, or has an unresolved terminal outcome` + `does not promote a proof whose remote sources are incomplete` |
| 6–8 | late trade / late fill / remote 复活 立即 reset | `reactivates fail-closed when a late user trade…`、`…a position becomes attributable…`、`…the identity reappears in open orders while deferred` |
| 9 | 重启后 persisted tier 不 fail-open | `treats a persisted audit window that already elapsed as due, never as deferred` + `cannot fail open after a restart when a persisted audit window outlives the proof` |
| 10 | 归档终态仍周期复核 | 同 9 的 due/deferred 判据（6 h 档不做 live 观察，见 X-4） |
| 11 | deferred UNKNOWN = 0 per-order 精确查询 | `performs zero per-order remote calls for a deferred historical row but still probes a fresh one`、`costs nothing at all for a row positively rejected before the wire call` |
| 12 | openOrders / 共享 live risk 可打破 defer | `lets a live identity in open orders break the deferral immediately` |
| 13 | identity 不匹配立即 reset | `reloads to fail-closed high frequency when the tombstone no longer matches` |
| 14 | position 冲突立即 reset | `keeps fail-closed when a current position is durably attributed…` |
| 15–17 | 错峰 / 重启确定性 / 不越上界 | `spreads audit deadlines deterministically without exceeding the tier interval`、`caps the worst-case active-risk detection latency at the highest tier interval` |
| 18–19 | 相同终态证明不 spam / 事实变化立即 emit | `records identical no-fact proofs once per state change instead of once per pass`、`publishes immediately when the verdict changes to conflict` |
| 20–21 | 状态未变不 emit / 变化必须 emit | `emits lifecycle re-derivation only on a real transition` |
| 22–23 | healthy+no candidate 不标故障 / 真实故障仍 DEGRADED | J 表两条用例 |
| 24 | `unknownRiskLastAuditAt` 首次 null | `counts terminal audit tiers and reports a null last audit until one happens` |

全量：`npm test` ⇒ **120 files / 671 tests 全绿，skipped 0，无 retry/only**。

## M. 本地 exact-HEAD CI 替代门禁

GitHub Actions 仍为 budget=0 不可用（未触发、未 rerun）。按提示词 Stage 13 用**全新 worktree + 精确 HEAD + CI 同步序**替代：

- worktree：`D:\MITS-WORKTREES\v395-localci-e1ea208b`，`git worktree add --detach … 232dd9f2c8360a0b3ca9814980afd1f704110cc1`，建立时 `dirty=0`、`node_modules=none`（不复用）；
- 顺序与结果（`v395-localci-e1ea208b-20260920.exit`）：

```
diff_check        0     (git diff --check 08487ca..HEAD)
npm_ci            0
build_contracts   0
build_core        0
verify_scripts    0
typecheck         0
test              0     (120 files / 671 tests, # skipped 0)
build             0
verify            0
ALL_STEPS_PASSED
final_untracked_or_dirty_lines=0
```

第一次门禁尝试在 `typecheck` 失败（rc=2，三类：`(order as any).exchangeTerminalStatus` 不在 `EntryOrder` 契约、新测试传自定义字段需宽类型再转型、mock 无参签名导致 `call[0]` 越界）⇒ 以 `232dd9f` 修正后重跑全新 worktree 才通过。**没有为了让门禁过而跳过或放宽任何一步。**

## N. build / dist identity 闭环

- 候选 dist 四棵树 contentTreeHash（门禁 worktree 内计算）：`74271fd488c868b51a1612c78fbdd1cd1e3b02b53e66b433bf02e16b7eefa257` ⇒ 预期 `buildId = 3.9.5-74271fd488c868b51a16`；
- 部署时把**门禁 worktree 的同一批 dist 文件**整体装入 `D:\MITS`（705 + 72 + 45 + 22 = 844 文件，逐树 `COPY_COUNT_MISMATCH` 校验为 0）；
- 装入后在 `D:\MITS` 重算：`74271fd4…` ⇒ `MATCHES_GATE_CANDIDATE=true`；
- 启动后 `data/runtime/engine-instance.json`：`buildId=3.9.5-74271fd488c868b51a16`、`startReason=MANUAL_START`、`pid=24448`、`restartCount=164` ⇒ **运行构建 == 通过门禁的构建**，逐字节同一。

## O. 是否部署

**是**，一次受控 restart：`stop-zdj-lan.ps1`（identity/binary/commandline 三重校验后才 Stop-Process，PID 24300）→ 备份 `D:\MITS-WORKTREES\backup-live-dist-r15-20260920\20260920-091852`（844 文件 / 3,870,307 B）→ 安装已验证 dist → hash 闭环（N）→ `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`。部署前 `capacity.inFlight=0`、`pendingEntries.count=0`；**未做 entry pause**（R14 的教训：预部署暂停会把 cohort 冻住）；未重启 8081 / 8084 / proxy。

---

## P. 部署前后请求量

同一台机器、同一账户、同一预算参数、同一出口路由，前后各取稳态窗口：

- **部署前**（R14 构建 `b48e7b02`，窗口 09:12:42 → 09:21:00，8.3 min，cohort 46 市场，26 UNKNOWN 中 0–16 行在 T0）
- **部署后**（R15 构建 `74271fd4`，稳态窗口 09:33:04 → 10:03:08，30.0 min，cohort 50→90 市场，T0 行数 0–14）
- 另取部署前 3.05 min 精测窗口与 R14 报告 31 min 稳态窗口作为交叉校验

| 路由（`source` + `endpoint`） | 部署前 req/h | 部署后 req/h | 变化 | 权重 |
|---|---|---|---|---|
| `ORDER_VERIFICATION` `/fapi/v1/order` | 3,094（3 min 精测 3,484；R14 31 min 3,436） | **1,924** | **−38% … −45%** | 权重 1，−1,170 wt/h |
| `ORDER_VERIFICATION` `/fapi/v1/userTrades` | 933 | 676 | −28% | 4,663 → 3,382 wt/h |
| `RECONCILIATION` `/fapi/v1/allOrders` | 933 | 675 | −28% | 4,663 → 3,373 wt/h |
| `RECONCILIATION` `/fapi/v1/openOrders`（从不延迟的安全网） | 51 | 58 | +14% | 2,024 → 2,315 wt/h |
| `MARKET_DATA` `/fapi/v1/klines` | 130 | 794 | +（cohort 46→90 冷启动补齐） | +707 wt/h |
| `MARKET_DATA` `/fapi/v1/premiumIndex` | 1,308 | 956 | −27%（同因，市场组成变化） | −352 wt/h |
| `PRIVATE_STATE` `/fapi/v2/account` | 239 | 243 | ≈0 | 1,193 → 1,217 wt/h |
| `BACKGROUND_AUDIT` `/fapi/v1/income` | — | 66 | — | 1,976 wt/h |
| **合计** | **8,241** | **6,763** | **−18%** | 21,925 → 19,513 wt/h（**−11%**） |

预算占用：`requestWeightLimit1m = 6,000`，部署后 10 轮采样 `usedWeight1m` 峰值 **471 = 7.9%**，`status = AVAILABLE` 10/10，**`decisions.blocked = 0`、`queueTimeout = 0`（10/10 轮）**。

**必须直说：本轮没有达到 replay 预期的 −96%。** 治理的那条路径确实降了（exact-order −38%…−45%、其扇出 −28%），但绝对量仍停在 ≈1,924 次/h，且 **95% 的探测仍然返回 HTTP 400**（`lastStatus=400`）。原因不是"档位不够深"，而是 A-4：稳态窗口末两轮虽已到 `tiers=[0,6,20] → [0,5,21]`、`deferred=25→26/26`（全部离开 T0），但窗口中段实测出现过 `[14,5,7]`（14 行被打回 T0）与 `[3,16,7]`（3 行在 T0）；而复核循环串行、单次往返 ≈1.9–2.1 s，**残余 T0 行数与请求量几乎无关——1 行即可把端点顶到 ≈1,700–2,000 次/h**。三次独立测量互为印证：`deferredUnknown=25` 时 1,716 次/h、`tiers=[4,7,15]` 时 1,980 次/h（60 s 隔离测量）、稳态 30 min 1,924 次/h。

次要且**未归因清楚**的一项：`openOrders` 由 51 → 58 次/h（+14%，权重 40/次 ⇒ +291 wt/h）。该端点同时被私有一致性快照与全量扫描使用，本轮没有把它拆到调用方粒度，记为下一轮待查，不当作已解释。

## Q. 部署前后事件率与取证保留

| 指标 | 部署前（08:21–09:21，1 h） | 部署后稳态（09:33–10:03，0.5 h） |
|---|---|---|
| `runtime_events` 合计 | 1,719 条/h | 2,632 条/h |
| `CANDIDATE_LIFECYCLE_REDERIVED` | 1,433 条/h（83.4%） | 1,948 条/h（74.0%） |
| `CANDIDATE_LIFECYCLE_CHANGED` | 未上榜 | 104 条/h |
| `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`（UNKNOWN 审计） | 83 条/h | 184 条/h |
| `ENTRY_ORDER_HISTORICAL_VERIFY_FAILED`（终态复核） | 0 条/h | ≈20 条/h（首次出现即去重后的结果，见 H） |
| `UNKNOWN_RISK_AUDIT_SUMMARY` | 11 条/h（≈每 5 min 1 条） | 13 条/h |
| `MARKET_SYMBOL_ERROR`（含 1m 缺口） | 19 条/h | 0 条/h |
| `runtime_events` 表内跨度 | 52.5 h | 52.7 h（70,000 行上限，非时间窗） |

**事件率没有下降，反而上升，这是本轮第二个未达标项**，原因可归：

1. lifecycle 双写在窗口内随 cohort 增长而放大（1,433 → 1,948 条/h），本轮按提示词要求**没有动 candidate lifecycle state**（I 节），因此它不受影响；
2. UNKNOWN 审计事件上升是**档位抖动**的副作用：`shouldEmitNoRiskEvent` 对"档位变化"必须发事件，而 A-4 使 16 行反复升档/回退；同窗口 `suppressedUnknown` 计数（09:27 轮 = 2）证明重复的相同证明确实被压掉了，抖动的代价转移成了"状态变化事件"；
3. `ENTRY_ORDER_HISTORICAL_VERIFY_FAILED` 从 0 → 20 条/h 是**新增可见性**（终态行此前从未被纳入降频审计，见 B/H），不是新噪声：只有 5 行弱终态在档，每行每 30–60 min 最多 1 条。

⇒ 只有当 A-4 的抖动被消掉，H/I 两节的降噪设计才会体现在指标上；这也是把 A-4 列为下一轮第一优先的理由。

## R. historical UNKNOWN / terminal 行是否零删除

**零删除。** 部署前 26 个 UNKNOWN、383 个 `entryOrders` 持久化行；部署后 10 轮采样 `reconciliation.historicalUnknownCount` 恒为 **26**，`entryOrders` 行数 383 → **386**（窗口内新开 3 单，只增不减），三档求和恒等于在册 UNKNOWN 总数（`[0,6,20]`、`[3,16,7]`、`[14,5,7]`、`[4,7,15]`、`[0,14,12]`、末轮 `[0,5,21]` 均 = 26）。报告提交后的补充读数（10:26:49）：`historicalUnknownCount` 已因窗口内新开仓自然增长到 **27**（`tiers=[1,2,24]`，求和同样 = 27）⇒ 只增不减的结论继续成立；`unknown + terminal + neverSubmitted` 三类分档之和 = 26 + 5 + 0，与 B 节分类一致 ⇒ 没有任何记录被删除、被改写成终态、或因降频而从读模型消失。回归门槛：`never drops a historical UNKNOWN row while deferring its audit`、`costs nothing at all for a row positively rejected before the wire call`（77 行 `LOCAL_NOT_SUBMITTED` 原地不动）。

## S. durable claims / reconciliation

- `entry_execution_tasks` 按 `active` 分组：`{0: 307}` → `{0: 309}` ⇒ **窗口内 0 条 active claim 悬挂**，新增 2 条全部正常落终态；未出现 `DURABLE_TASK_EXISTS` 类饥饿。
- `verifiedNoActiveRiskUnknownCount` 26 →（抖动轮次 12）→ 25/26；`activeRiskUnresolvedCount` 与 `unresolvedDriftCount` 同步在 0/14/1 之间变化，**方向是更严格的 fail-closed 占用**（证明过期期间该行继续占额、继续高频），不是放宽。
- `correctedDifferenceCount = 0`、`verifiedOrderFactMismatchCount = 0`、`lastError = null`（10/10 轮）；`status` 在 READY/DEGRADED 之间抖动，与上面 `unresolved` 同因。
- 窗口内出现新开仓与平仓各 1 次（`positions 34 → 35 → 34`、`eligibility BLOCKED → READY count 1–2`、`noEntryReason WAITING_EXECUTION_CAPACITY ↔ None`），说明 Entry 行为与快照事实照常，**交易未暂停、cohort 未受抑制**。

## T. TP 覆盖

10/10 轮 `takeProfit = {status:READY, required:34, protected:34, missing:0, repairing:0, repairFailed:0, manualReviewRequired:0, orphanTp:0, duplicateTp:0, qtyMismatch:0, wrongSide:0, tpMissing:0, retryQueue:0}` ⇒ **全仓 TP 全程保护，零缺口**；`required` 与 `positions` 逐轮一致。本轮改动完全不触碰 Exit/TP 链（`git diff cbc5840..HEAD` 的 8 个文件里没有 TP/Exit 模块）。

## U. 429 / 418 / egress / pipeline

- `http429 = 17`、`http418 = 3` ⇒ **与部署前逐条相同，零新增**；`blockedUntil = 0`、`observationTrust = TRUSTED`、`observedWeightAnomaly = false`。
- `egress.status = VERIFIED`（前 9/10 轮，第 10 轮异常见下文），`expectedEgressIp == lastVerifiedEgressIp == 172.104.186.174`，`routeIdentity = proxy-a087cc91667b`，`lastError = null` ⇒ 未重启 proxy，出口指纹闭环。
- `pipelineState = RUNNING` 10/10 轮；`freshMarkets.count` 5 → 97（冷启动补齐），`klineFreshRatio = 1`、`quoteFreshRatio = 1`、`sequenceInvalid = 0` 全程成立，`MARKET_KLINE_SEQUENCE_REPAIRED = 0`（本窗口无真实缺口）、`MARKET_SYMBOL_ERROR = 0`。
- `laneStats`：`EXECUTION / CONTROL` 全程 `blocked = 0 / timeout = 0 / deferred = 0`；`PRIVATE_TRUTH` `blocked = 0`。

**窗口内出现一次真实异常，必须记为事件而非噪声**：`10:08:09` 采集轮显示 `egress.status = UNAVAILABLE`、`lastError = "The operation was aborted"`，最后一次成功证明出口 IP 是 `09:51:40`（`lastVerifiedEgressIp = 172.104.186.174` 与期望值一致）。

- 机制：`BinanceTransport.verifyEgressIp()` 通过代理向外部回显服务 `https://checkip.amazonaws.com/` 发一次 GET，`timeout: 5_000` + `AbortSignal.timeout(5_000)`；`appRuntime.ts:500-501` 只在启动时与**每 15 min**重新证明一次（09:21:38 / 09:36 / 09:51 成功 / 10:06 超时）。
- 判读为"探针侧偶发超时，出口路径未变"的证据：同窗 `requestBudget.status = AVAILABLE`、`blockedUntil = 0`、`decisions.blocked = 0 / queueTimeout = 0`、`admitted` 在 10:03→10:12 从 4,766 增至 5,415（+649 次真实 Binance 请求全部准入）、`privateSync.lastSuccessAt = 10:10:09`（4 s 前成功）、`binancePrivate = READY`、`http429/418` 仍 17/3 ⇒ 走代理的 Binance 私有/公共读持续成功，失败的只是第三方回显站点。结构上也不存在"悄悄换路"的口子：Binance 请求一律经 `applyRoute()` 由 `settings.proxy.url` 构造的 `SocksProxyAgent` 发出，`json()` 再经 `assertBinance(url)` + `BINANCE_ENVIRONMENT_ORIGIN_MISMATCH` 锁定 base URL 与 origin，回显探针访问的是另一个主机（`checkip.amazonaws.com`），它的超时不会改变 Binance 流量的路径。
- **但本轮核查出一个真实缺口（必须在提交前纠正我自己的第一版判断）**：我最初写的是"这一期间下单会被 fail-closed 阻断"，随后按代码逐条核对发现**该门禁没有被接上**。`BinanceTransport.ts:36` 的 `entryBlockReason()`（唯一会返回 `BINANCE_EGRESS_UNAVAILABLE` 的函数）在全仓库**没有任何调用方**；Entry 侧实际用的是 `entryCoordinator.ts:51 / :155` 调用的模块级 `binanceEntryBlockReason(environment)`，它只看执行环境与请求预算状态（`binanceHealthBlocksEntry`：`PRIVATE_ONLY/SATURATED/RATE_LIMITED/RECOVERING/PERSISTENCE_FAILED`），**不看出口 IP 证明状态**。⇒ 出口 IP 未被重新证明时，本轮实测 `entryPermission` 仍能在 `READY/BLOCKED` 之间摆动（摆动原因是 `noEntryReason = WAITING_EXECUTION_CAPACITY`，与出口无关），也就是**出口证明失效不会阻止新仓**。这是既有缺陷（早于 R15，本轮改动之前就在），不是我引入的回归，但它是本轮观察到的最直接安全风险。
- 处置：**未重启 proxy、未重启 Engine、未修改任何网络配置、未改代码**（本轮只授权一次受控 restart，已用于部署；给未接线门禁加逻辑属新行为变更，必须单独立项 + 独立门禁）（提示词绝对禁止项 + AGENTS.md 手工启动约束）；只挂了只读观察器等下一次 15 min 证明（≈10:21）是否自行恢复，结果：`10:21:41` 下一次 15 min 定期证明**自动恢复** `status=VERIFIED`、`lastVerifiedEgressIp=172.104.186.174`（与期望一致）、`lastError=null`；失效区间 = `10:06:38 → 10:21:41`（≈15 min，正好一个证明周期），期间 `admitted` 从 6,001 增至 6,657、`blocked=0`、`429/418` 仍 17/3 ⇒ **无流量丢失、无被拒**，但这 15 min 内下单并未因出口未证明而被阻止（见 X-6）。观察器已正常结束，Engine 未受其影响（`restartCount` 仍 164、`pid` 仍 24448）。


## V. Primary health 最终状态

10/10 轮 `primaryBrain.status = READY`，`healthReason ∈ {IDLE_NO_DISPATCHABLE_CANDIDATE, IDLE_WAITING_CANDIDATE, null}`，`idleReason ∈ {WAITING_EXECUTION_CAPACITY, WAITING_CANDIDATE, null}`；同窗口 `aiHealth = {failed:0, timeout:0, schemaInvalid:0, quarantine:0, consecutiveFailures:0}`，`aiResources.brain-7900-primary.status = ONLINE`，`AI_RESOURCE_HEALTH_CHANGED` 仅在 09:21:37 因 `available` 建立基线各发 1 条（scout / primary，`available:true, reason:null`）。

⇒ 提示词 Stage 8 的目标达成：**"模型健康但长时间没有可派发候选"不再被标成故障性 DEGRADED**，而 `WAITING_EXECUTION_CAPACITY`（真实原因，见 S/W 的容量与 HUMAN cap）仍然如实呈现。未为此制造任何 AI 调用（`AI_RUN_TERMINAL = 16 条/h`，与治理前同一节奏）。

## W. 只读 ENFORCE readiness 复评

只读输入（`r15/enforce-02.json` 与 10:03 轮采样；本轮**未切换任何模式**）：

| 维度 | 实测 |
|---|---|
| 准入模式 | `tradeEconomics.admissionMode = SHADOW`，`riskGovernance.protectionMode = SHADOW`，`entrySafetyMode = AUTO` |
| 冻结参数 | `minNetProfitUsd = 1`、`minNetProfitRoiPct = 0.15`、`minHistoricalReachProbability = 0.50`、`maxGrossExposurePct = 1`、`maxDirectionExposurePct = 0.5`、HUMAN caps `{enabled:true, maxPositions:4, maxNotionalPctEquity:0.20}`、`settingsVersion = 187`（`git diff cbc5840..HEAD` 未触碰 `config/`、settings 或任何策略文件：0 个文件） |
| 权益与风险占用 | `equityUsd = 10,850.72`；`capacity = {positions:34, max:50, inFlight:0, reserved:0, used:34}` |
| HUMAN 暴露 | `count = 31`、`notionalUsd = 9,663.35`、`unrealizedPnl = −202.05`、上限 `maxNotionalUsd = 2,170.47` ⇒ **超出 4.45 倍**，`newEntryBlockedByCaps = true` |
| 供应 / 派发 | `rankedSymbols 17 / residentSymbols 17 / poolReady 0 / dispatchReady 0 / poolWaiting 17 / governanceBlocked 21 / occupiedUnderlyings 34`；`eligibility BLOCKED count 0 excluded 34–36`（09:38 后短暂 `READY count 1–2`）；`noEntryReason WAITING_EXECUTION_CAPACITY` |
| 经济与可达性 | 近 6 h `ENTRY_ECONOMIC_ADMISSION_EVALUATED = 27`，`passed = 0` |
| 行情新鲜度 | `freshMarkets 90`、`klineFreshRatio 1.0`、`quoteFreshRatio 1.0`、`sequenceInvalid 0` ⇒ **数据前置条件继续成立** |
| durable claims | `active claims = 0`（309 条全部 inactive） |
| Primary | `READY / IDLE_NO_DISPATCHABLE_CANDIDATE`，`aiHealth` 全零 |

**结论：`NOT_READY`**，客观原因三条，且都不因本轮治理而改变：

1. **HUMAN 暴露已超 cap 4.45 倍**（31 仓 / 9,663.35 USD vs 4 仓 / 2,170.47 USD），`newEntryBlockedByCaps = true` —— 按提示词绝对禁止项，本轮不自动处置 HUMAN_MANAGED、不放宽 cap；
2. **近 6 h 27 次经济性与可达性评估 `passed = 0`**（`minNetProfitUsd = 1` + `minHistoricalReachProbability = 0.50` 双闸门），且方向预算被 34 个在册持仓占满（`governanceBlocked 21 / occupiedUnderlyings 34`）⇒ 切 ENFORCE 也不会产生可执行候选，只会把 SHADOW 的失败换成 ENFORCE 的失败；
3. **本轮验收未达标（P/Q 两项）**：残余 ≈1,924 次/h 的 exact-order 探测仍 95% HTTP 400，事件率不降反升 ⇒ 现在切 ENFORCE 会向同一条已饱和的 `PRIVATE_TRUTH` lane 增加新 Entry 的复核负载。先解决 A-4，再谈 canary。

**本轮未切 ENFORCE，未改任何限额或模式。**

---

## 成功门槛判定（对照提示词 Stage 16 十条）

| # | 门槛 | 判定 | 证据 |
|---|---|---|---|
| 1 | terminal exact-order audit 显著下降 | **部分达成** | `/fapi/v1/order` 3,094 → 1,924 次/h（−38%，3 min 精测口径 −45%）；远低于 replay 上界 −96% ⇒ 见 A-4/X-2 |
| 2 | UNKNOWN 残余 exact query 在延迟期间接近 0 | **部分达成** | 被延迟的行确实 0 次 per-order 调用（末轮 `deferred=25/26`）；但窗口内 `[14,5,7]` 轮次恢复探测 ⇒ 端点未被清空 |
| 3 | event spam 显著下降 | **未达成** | 1,719 → 2,632 条/h；lifecycle 双写占 74%（本轮按提示词未动 lifecycle state），审计事件因档位抖动上升（83 → 184 条/h） |
| 4 | `runtime_events` 保留能力提升 | **未达成** | 跨度 52.5 → 52.7 h（表为 70,000 行上限而非时间窗；事件率未降 ⇒ 保留能力没有释放） |
| 5 | 活跃风险检测无退化 | **达成** | 共享 openOrders 全量扫描从不延迟：51 → 58 次/h、实测周期 70–76 s；`lets a live identity in open orders break the deferral immediately` 等 4 条 fail-closed 用例 + 用户数据流在位 |
| 6 | 无 fail-open | **达成** | 证明过期即恢复占用：`activeRiskUnresolvedCount` 0 → 14 → 1 → 0 自行回摆；测试项 9/12/13/14 全部覆盖 persisted tier 情形 |
| 7 | historical UNKNOWN / terminal 行零删除 | **达成** | `historicalUnknownCount` 恒 26，`entryOrders` 383 → 385 只增不减（R 节） |
| 8 | TP 全保护 | **达成** | 9/9 轮 `required = protected = 34`，全部缺陷计数 0（T 节） |
| 9 | 429 / 418 无新增 | **达成** | 恒 17 / 3，`decisions.blocked = 0`、`queueTimeout = 0`、`status = AVAILABLE` 9/9（U 节） |
| 10 | Primary idle 不再伪装为 DEGRADED | **达成** | 9/9 轮 `status = READY` + `healthReason = IDLE_*`，`aiHealth` 全零（V 节） |

**本轮判定：部分达成。** 1、2 项有实质下降但幅度只有 −38% 而非 −96%；3、4 项未达成且原因明确。
四项未达/半达全部指向同一根因（A-4：无全量扫描轮次仍被探测 ⇒ 证据必然不完整 ⇒ 档位被打回 T0；以及 `reviewPending` 缺 per-row 节流使端点被单次 2 s 往返锁死）。
按提示词 Stage 16 的要求，本轮**没有继续叠加 backoff**，而是把根因、排除法证据与两条最小修复写进 X-2 交给下一轮。

## X. Codex 对本方案的反驳 / 补充

1. **R14 报告的 V-3 归因是错的，本轮已用测量更正**（A 节）。教训：把"代码里存在的批量探测"当成"流量主力"之前，必须先证明它没有被更早的 `continue` 短路，并且要用两个调用方的视角分别记账。
2. **本轮最有价值的产出不是降频，而是"住不住档位"这个发现，以及我自己第一版解释被测量推翻的过程**（A-4）。
   我第一版写的是"同标的仓位归属未决导致降档"，但排除法查询显示 `ENTRY_ORDER_POSITION_ATTRIBUTION_UNRESOLVED = 0`、
   `NO_ACTIVE_RISK_CONFLICT = 0`、`EVIDENCE_FAILED = 0`、年龄全部在 7 天回看之内 ⇒ 该假设不成立。真实路径是
   `noActiveRiskEvidence()` 的第一道门：本轮没有全量 openOrders 扫描时**根本取不到证据**，而调用方把
   "证据不完整"与"出现对立事实"同样处理（`resetRemoteRiskAudit()`）。实测节拍 pass ≈10–25 s、全量扫描 ≈70–76 s
   ⇒ 约 3/4 的轮次没有取证能力，于是每次到期审计都有 ≈3/4 概率被打回 T0。
   **下一轮的两条最小修复（都不放宽 fail-closed）**：
   (a) 当本轮 `fullOrderScan=false` 时**不要探测该行的精确查询**（探测了也无法产出证据），把审计留给下一个全量轮，
       这样"为拿不到证据而探测"的 400 洪水直接消失，且不改变任何占用判定；
   (b) `reviewPending` 需要一个 per-row 到期节流（复用同一 `nextAuditAt` 判据即可），否则它仍会串行饱和端点 ——
       实测证明：**残余不是行数问题，而是"至少 1 行未延迟 ⇒ 端点被 2 s 往返锁死"**。
   这两条都要新测试 + 独立 exact-HEAD 门禁，因此**本轮故意不带入**（提示词只授权一次受控 restart，且改
   `reconciliationService` 的证据路径属高风险区）。
3. **拒绝用事件抑制来"降指标"**（I 节）：1,433 条/h 的 `READY→POSITION_HELD` 是双写者打架的可见证据，占部署前事件流量 83.4%。suppress 会把 Dashboard 真相和取证能力一起毁掉。`runtime_events` 不是按时间滚动，而是按行数裁剪（`storageCapacityGuard.ts:38-39`：非关键 20,000 行 + 关键 50,000 行，`*ORDER*/*FILL*/TP_*/MANUAL*/TRADE_RECORD*` 算关键），实测跨度 52.7 h；由于 lifecycle 属"非关键"桶，它以 1,433 条/h 单独把该桶的非关键部分压缩到 ≈14 h 量级 ⇒ **降事件率的正确做法是消灭双写，而不是给事件加过滤器**。
4. **replay 的 −96.3% 不能当验收目标**：它假设 26 行全部住进高档，且隐含假设"每行到期时都能拿到证据"。验收只认实测；若实测降幅明显低于 replay，结论应是"根因未清"（见 X-2），而不是"再叠加一层 backoff"。
5. **诚实披露的局限**：(i) 短窗验收（≈50 min）不足以观察 6 h 归档档的真实调度，`neverSubmitted` 档位在窗口内等价于"从未升档"；(ii) 5 行弱终态（`REJECTED/factSource=null`）没有正面未提交证据，只能按 terminal 阶梯慢慢爬；(iii) 迟到成交的最坏 REST 兜底延迟被本方案放宽到档位上界（E 节表格），这是本设计的代价而非免费午餐。

6. **观测器的价值被直接验证了一次**：正因为采集器把 `10:08` 的 `egress.status=UNAVAILABLE` 报成告警（而不是被当成噪声吞掉），顺线核对才发现"出口 IP 未证明时并不阻止下单"这条**未接线的门禁**（U 节）。这属既有缺陷，且是"看起来有安全网、实际没接"的那一类，优先级高于本季度的任何降频工作：修法是把 `entryBlockReason()` 真正接进 Entry 判据（或在 `executionHardBlock` 内联同等条件），并配一条"egress 未 VERIFIED ⇒ 阻单"的回归测试；同时把回显探针做成多源冗余（当前只有 `checkip.amazonaws.com` 一个目标，5 s 超时即整条证明链路失效一个周期）；本轮**故意没有动它**，因为提示词只授权一次部署 restart，且改 Entry 准入判据必须独立门禁。

## 附：回滚与证据位置

- 回滚：把四棵 dist 树整体换回 `backup-live-dist-r15-20260920\20260920-091852` + 一次 `MANUAL_START`；DB / Settings / 仓位 / TP 均不受影响。
- 证据：`D:\MITS-WORKTREES\dryrun\r15\`（`before-A/B/C.json`、`post-NN.json`、`post-samples.jsonl`、`post-alerts.md`、`replay-terminal-audit.json`）、门禁 `D:\MITS-WORKTREES\v395-localci-e1ea208b-20260920.{log,exit}`、脚本 `r15-snapshot.py` / `r15-window.py` / `r15-collect.py` / `r15-replay.py` / `r15-decompose.py` / `r15-idhash.mjs`（scratch，不入库）。

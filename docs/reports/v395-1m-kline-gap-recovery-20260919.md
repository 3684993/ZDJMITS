# ZDJ-MITS V3.9.5｜1m K 线缺口自愈修复报告（2026-09-19）

- 实施依据：`docs/prompts/ZDJ-MITS-V3.9.5-1mK线缺口自愈修复-Codex提示词-2026-09-19.md`（commit `515374c`）
- 提交链：`1df815a`（修复）→ `1b9134a`（流测试）→ `cf7437b`（清行尾空格），分支 `v395-economics-human-managed-20260919`，均已推送
- **未部署 live**：本提示词 Stage 10 的预条件是"只有 CI 全绿才部署"，而远端 Actions 自 22:16 起**因账户欠费/额度用尽无法启动任何 runner**（#388 注解："The job was not started because recent account payments have failed or your spending limit needs to be increased"）。因此 live 仍是修复前构建，且**本轮对运行中的引擎零写入**（`settingsVersion` 保持 184、PID 9680、`buildId 3.9.5-57b2843729dff7a298a9`）。
- 替代证据：在与 CI 完全相同的步序下（diff check → `npm ci` → contracts/core 预构建 → `verify:scripts` → `typecheck` → `npm test` → `build`）在**全新 worktree + `cf7437b`** 上全绿：**117 files / 639 tests**。

---

## A. 根因最终判定

**`LOCAL_KLINE_SEQUENCE_RECOVERY_BUG`（本地恢复闭环缺陷），外部只是触发器。**

- 触发：WebSocket 断线。缺口起点在跨标的上**完全同步**——`21:00`(2,023 次)、`21:19`(465)、`21:23`(208)、`17:54`(102)、`21:10`(66)；`stream.reconnects=4`、`gapsByType.websocketConnection=4`、`connectedAt 20:22:08/20:25:08`。同一分钟在 107 个标的上同时缺失 ⇒ 不是单标的行情缺失。
- 本地闭环（4 个互相咬合的点）：
  1. `getCandles` 旧 fast path 只看**数量够**+**最新 closed 追到当前边界**，从不检查中间连续性；
  2. 断线后新 K 线继续到达 ⇒ 最新边界条件重新成立 ⇒ holey cache 被继续信任；
  3. `recoverStale → loadSnapshot → getCandles` **又取同一段 holey cache** ⇒ REST 永远不被调用 ⇒ 修复自我落空；
  4. `BinanceMarketStream` 的 depth 有 sequence gap 回补，kline 分支完全没有连续性检测与定向回补（`gapsByType.kline` 字段存在但从未递增）。
- 结果：`buildTechnicalCard` 每分钟因新 closed 柱生成新 sequence ⇒ 每分钟对每个受损标的重新报错 ⇒ 缺口率从 ~50/10min 放大到 **790–1,136/10min**。
- 外部供给不是原因：REST 同窗口完整无缺、价格逐分钟对齐、`429/418` 全天未增、egress `VERIFIED`、`status AVAILABLE`、权重 234/6000。

## B. 3+1 标的 cache vs REST 证据

`MARKET_SYMBOL_ERROR.payload.sequence` 里带有引擎当时**实际使用的完整 closed 序列**，因此可比对而不必猜。REST 走**同一固定代理** `socks5h://127.0.0.1:20081` → `demo-fapi.binance.com/fapi/v1/klines?interval=1m`。

| 标的 | cache closed 根数 / 窗口 | cache 缺哪一分钟 | cache latest 是否已追到当前 | 缺口后是否继续增长 | REST 同窗口 | REST 是否有该分钟 | 价格对齐 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LPTUSDT | 85 / 20:00→21:26 | **21:23、21:24**（step=3 min） | 是（`cache latest == REST latest` true） | 是（21:26 仍新增） | 180 根无缺 | **是** | 1.636 = 1.636 |
| SUPERUSDT | 87 / 19:57→21:26 | **21:19** 与 **21:23、21:24** | 是 | 是 | 180 根无缺 | 是 | 0.1378 = 0.1378 |
| 1000BONKUSDT | 89 / 19:55→21:26 | 同上两处 | 是 | 是 | 179 根无缺 | 是 | 0.002991 = 0.002991 |
| ADAUSDC | 91 / 19:54→21:26 | 21:23、21:24 | 是 | 是 | 179 根无缺 | 是 | 0.227 = 0.227 |
| 对照 ETHUSDT（当时仍 eligible） | 296 / 16:25→21:25 | 21:00×2、21:19、21:23 | 卡片尚新（未 stale 到 125 s 外） | 是 | 179 根无缺 | 是 | 2634.78 vs 2634.99（不同时刻） |

对照标的同样含洞，只是其技术卡片尚未跨过 TTL ⇒ 说明 `eligibility` 会随时间继续塌缩（`freshMarkets` 从 FRESH→DEGRADED 4-9/104 即此过程），也解释了 `marketDataReason=MARKET_QUOTES_STALE` 这个**误导性标签**（quotes 实际 99-104/104 新鲜）。

## C. `getCandles` 为什么（以及怎样才不会）绕过 REST

旧代码（`BinancePublicMarketDataProvider.ts:78`）：

```ts
const live=this.stream.candleSeries(symbol,period*2,timeframe),
      closed=live?.filter(c=>c.isClosed===true&&c.closeTime<Date.now());
if(live&&live.length>=limit&&closed?.at(-1)?.closeTime===(Math.floor(Date.now()/period)*period-1))
  return live.slice(-limit);
```

两个条件都只关于**数量与最新边界**，对中间缺口零感知 ⇒ 一旦断线留下洞，条件恒成立 ⇒ 后续所有消费者（`getSnapshot`、`hydrateLiveTechnical` 的恢复回路、`stream.recover()` 的 backfill 闭包）都反复取到同一段坏数据，REST 分支永不执行。

修复后 fast path 必须同时满足：`live.length>=limit` **且** `continuity.closedCount>=limit` **且** `continuity.ok`（无洞/无重复/边界合法）**且** `latestClosedAtBoundary`；任一不满足即落到 `loadCandles()`，且 REST 回来后**再次验证合并结果**才允许返回（见 D/E）。

## D. continuity validator 规则

新增单一可复用实现，并成为卡片计算器与缓存信任决策的**同一真源**（`packages/core/src/indicators.ts`：`CANDLE_PERIOD_MS`、`closedCandles()`、`continuityOfClosed()`、`closedCandleGap()`；`buildTechnicalCard` 改为消费同一份 facts，抛错文案与判定顺序**逐字保持不变**）：

1. `openTime` 按 timeframe period 严格递增，任何 `step>period` 记为 `missing`（并给出 `firstMissingOpenTime`）；
2. `closeTime-openTime+1 >= period`，否则 `boundaryInvalid`；
3. `openTime` 不得重复（`duplicates`）；
4. `closedCount` 为过滤后的 closed 根数（closed 判定沿用原式：`isClosed===true`，或缺省标志时 `closeTime<=now` 且有限）；
5. `latestClosedAtBoundary`：最后一根 closed 的 `openTime == floor(now/period)*period-period`。

`ok = duplicates===0 && !boundaryInvalid && missing===0`。**门禁强度未降**：Entry 侧 `primaryReadyReasons`、`TECHNICAL_*` TTL、`marketInsufficient` 阈值全部原样（Stage 7 只改诊断标签，见 F）。

## E. targeted repair 实现

- `provider.repairCandles(symbol, timeframe)`：**只**取 `1m|5m|15m`；`limit=120`（15m 为 241）；**总是**走 `loadCandles`（REST），再 `seedCandles` 合并，然后对合并结果重新跑 validator，并把连续性事实返回；per symbol+timeframe **single-flight**（`repairFlights`）。复用 `BinanceTransport`/request governor/`seedCandles`，**没有新建第二个 HTTP client**。
- `marketDataHub.repairableSequenceFrames()`：只对"存在 blocked 帧 **且** quote/orderBook 新鲜"的标的走定向修复；缺快照或报价本身坏了 ⇒ 仍走原全量 reload。**关键判定**：技术卡片变 stale 是洞的**必然结果**，不能因此退回全量 reload——否则正是最容易成风暴的时刻（我第一版写严了，被自己的 sim 抓到并改正）。
- `recoverStale()` 内：定向修复优先，每轮 `slice(0,4)` 标的、`mapLimit(...,2)` 并发、帧内串行；修复成功即 `writeTechnical()` **在同一轮重建卡片并释放 blocked**（否则下一轮会把它当"无 blocked 的 stale"再全量 reload 一次）；`recovery.nextRetryAt = now+15 s`（成功）/`60 s`（失败）；失败发 `MARKET_KLINE_SEQUENCE_REPAIR_FAILED`，成功发 `MARKET_KLINE_SEQUENCE_REPAIRED`。
- 优先级沿用既有排序：position > active entry > candidate/pool > BTC/ETH > 其他 retained。

## F. kline gap 主动检测

`BinanceMarketStream.onEvent` kline 分支新增：收到 **closed** 柱时与上一根 closed 的 `openTime` 比较，`openTime > previous+period` 即 `gaps++`、`gapsByType.kline++`（该计数器此前是**死字段**），并记录 `lastKlineGap={symbol,timeframe,expectedOpenTime,actualOpenTime,missingBars,at}`，经 `metrics()` 暴露；`lastKlineClosed` 在 retention 释放时随标的清理。修复动作**不新增状态机**：仍由现有 `technicalBlocked` + `recoverStale` 驱动，检测只负责把事实说清楚并可观测。

## G. REST 请求上界 / concurrency / cooldown

确定性 sim（`klineRecoverySimulation.test.ts`：60 个标的、同一分钟洞、quotes/books 持续新鲜、其余帧连续，真实 provider+hub+validator）实测：

- **每个受损标的恰好 1 次 `/fapi/v1/klines`**：`candleReloads.length === 60`、`max(per-symbol)===1`、全部 `interval=1m`；
- **0 次 `getSnapshot`**（无 quote/book/7 帧/derivatives 全量刷新）；
- 每轮 recoverStale ≤4 标的、并发 ≤2；帧级 cooldown 60 s；`BINANCE_REQUEST_BUDGET_DEFERRED` ⇒ 该帧 cooldown 提到 120 s 且**当轮不再重试**（测试断言 2 轮只发 1 次请求）；
- 全部标的在 ≤24 轮内恢复 `primaryReadyReasons()==[]`，无需重启或清缓存。

另外两个测试锁住上界语义：`does not spend a second request while the per-frame repair cooldown is open`、`keeps at most two symbols repairing at once across a wide stale set`。

## H. tests / CI / exact HEAD

新增 4 个文件级测试面（26 条断言组，全部先写失败测试再改实现）：

| 文件 | 覆盖 |
| --- | --- |
| `adapters/market/klineContinuity.test.ts` | validator 4 条；1m/5m/15m 中段洞必须落 REST；连续时**不**花 REST；REST 后缓存被治愈且不再重复请求；REST 失败保持 fail-closed；hydration 先拒后愈 |
| `adapters/market/klineTargetedRepair.test.ts` | 定向修复 1 次/帧、不做 snapshot；quote/book 坏时仍全量；卡片同时 stale 仍走定向；cooldown；budget defer；并发 ≤2；blocked 仅在重建卡片写入后清除；freshness 事实区分 `sequenceInvalid` |
| `adapters/market/klineRecoverySimulation.test.ts` | Stage 9 全量风暴上界（见 G） |
| `adapters/market/BinanceMarketStream.test.ts`（追加） | 1m/5m 缺口计数与 expected/actual；连续序列与未闭合柱不误报 |
| `services/marketDataStaleness.test.ts`（新） | `MARKET_KLINE_SEQUENCE_INVALID` / `MARKET_TECHNICAL_STALE` / `MARKET_QUOTES_STALE` / WS 两类标签 / 充足时不暂停 |

- 红→绿过程如实记录：初版测试因洞两侧根数 <limit 而"假通过"，把 fixture 调整为**缓存大于请求 limit**（真实形态 ~300 vs 81）后才出现预期红（`expected "spy" to be called 1 times, but got 0`）。
- `npm run verify` 本地全绿；`git diff --check`（工作树）干净；`npm run typecheck` 干净。
- 远端 CI：`#381–#387` 因**行尾空格**（两份 Codex 提示词 markdown 的 Markdown 硬换行，门禁从 `08487ca` 累计 diff 所以污染后续每次提交）失败，已在 `cf7437b` 仅删除行尾空格修掉（**未关闭/未放宽门禁**，text 未改）；此后 `#388` 起 Actions **无法分配 runner（账户欠费/额度）**，故"CI 全绿"当前不可评估。
- 替代验证：全新 worktree @ `cf7437b` 按 CI 步序全绿（`DIFF-CHECK CLEAN` → npm ci 279 pkgs → contracts/core → verify:scripts → typecheck → **117 files / 639 tests** → build）。

## I. 是否部署 live、新 buildId/PID/instanceId

**未部署。** live 保持修复前：`buildId 3.9.5-57b2843729dff7a298a9`、PID 9680、instanceId `1c6cc310-45d8-4edb-9324-df710f98daf1`、`restartCount 161`、`settingsVersion 184`。没有新构建产物被复制进 `D:\MITS`，也没有执行任何受控重启（提示词允许一次，但预条件未满足 ⇒ 不使用）。

## J. 1m gap rate 前后

- **before（= 现状，仍为此）**：`MARKET_SYMBOL_ERROR` 保留 6,671 条，其中 1m 缺口 **6,671-… 占比 99.1%**；今日 6,311 条、涉及 **107 个标的**；每 10 分钟 `20:30 43 / 20:40 49 / 20:50 44 / 21:00 790 / 21:10 1071 / 21:20 750 / 21:30 1136 / 21:40 966 / 21:50 747 / 22:00 633`；最近一条 `22:19:03`（仍在发生）。
- **after**：不适用（未部署）。部署后的验收口径：同一 10 分钟桶内 `closed candle gap` 计数应跌到 ≈0（仅允许修复在途的最后一两个 tick 残留），且 `MARKET_KLINE_SEQUENCE_REPAIRED` 出现次数 ≈ 受影响标的数、`MARKET_RECOVERY_FAILED(dataType=QUOTE_KLINE)` 不因该原因增加。

## K. klineFreshRatio / freshMarkets 前后

before：`freshMarkets.status RECOVERING`、`count 49→59 / 93-99`、**`klineFreshRatio 0.548 → 0.649`**、`quoteFreshRatio 1.0`。当前回升只来自 **cohort 轮换**（受损标的被换出保留集）而非修复，故仍会随新断线复发。after：不适用。

## L. eligibility / pipelineState 前后

before：`eligibility {READY, count 5, excluded 25}`、`pipelineState RUNNING`、`marketDataReason None`、`noEntryReason null`（最坏时段曾为 `DEGRADED 4-9/104`、`PAUSED_MARKET_DATA_UNAVAILABLE`、`eligibility BLOCKED count 0`）。after：不适用。

## M. 429 / 418 / request governor

`http429 17`、`http418 3`、`lastLimitedAt 1789694699483`、`blockedUntil 0`、`status AVAILABLE`、`queued 0`、`estimatedWeight1m 234 / limit 6000`、`usedWeight1m 218`、`observedWeightAnomaly false`、`persistenceError null`。全天零新增；本轮未产生任何额外 REST（修复未上线，且 sim 在进程内完成）。

## N. positions / TP 是否无损

无损，且本轮对 live 无任何写动作：`24 持仓 / 24 TP PROTECTED`（`required 24`）、`missing/repairing/orphan/duplicate/qtyMismatch/wrongSide 0`、`retryQueue 1`（既有排队）、`reconciliation READY`、`historicalUnknownCount 18` 未删、`activeRiskUnresolvedCount 0`、`durableClaims {activeClaims 0, activeUnknownClaims 0, releasedUnknownClaims 17}`、7 个健康子服务 `HEALTHY`、egress `VERIFIED 172.104.186.174`（`lastVerifiedAt 22:00:03`，周期自动重证）、`productionWrites 0`、REST host `demo-fapi.binance.com`、`failClosed true`。

## O. 是否无需人工 restart/backfill 即可持续自愈

**代码路径已证明可以，live 尚未验证。** 证据：G 的确定性 sim 用真实 provider+hub 走完"报洞 → blocked → 定向 1 次 klines → 合并治愈 → 同轮重建卡片 → blocked 清零 → readiness 恢复"，全程无 restart、无缓存清空、无全量 snapshot、每标的 1 次请求。缺的是在真实 Binance Testnet 流上观测一轮（部署后 J/K/L 三项）。

## P. 是否恢复到可重新进行 ENFORCE Canary 的数据条件

**部分具备，但我不建议在部署本修复之前重跑。** 现状 `eligibility 5`、`pipelineState RUNNING`、`noEntryReason null` ⇒ 有可评估窗口；但缺口**仍在每分钟复发**（最近 22:19:03、今日 107 标的）、`klineFreshRatio` 只有 0.649，且上一轮已证明：ENFORCE 正向样本要求标的连续多帧新鲜，任何一次 1m 缺口都会把整轮变成 `PAUSED_MARKET_DATA_UNAVAILABLE` 或 0 次评估。建议顺序：**修复 CI 阻塞 → 部署 → 观测 gap rate 归零 → 再重跑正向 Canary**（沿用已冻结的预注册：首选 ENAUSDC、备用 AVAXUSDT、12+8 预算、25 USDT、`maxPositions=used+1`）。

## Q. 对提示词根因假设的反驳 / 补充

1. **假设成立且比预想多一环。** 提示词指出 `recoverStale→getSnapshot→getCandles` 会再次取到坏 cache——正确；但 `BinanceMarketStream.recover()` 的 backfill 闭包（`provider` 构造第 33 行）同样调用 `getCandles(symbol,'1m',120)`，因此**depth 缺口的回补也无法修好 1m**。修复必须落在"cache 信任判定 + 单一 REST 真源"上，而不是在某个调用点补 fetch——本次即按此实现（`loadCandles` 为唯一 reload 路径，`repairCandles` 与 `getCandles` 共用）。
2. **补充：`hydrateLiveTechnical` 每个 tick 只重建"第一个发生变化"的 frame。** tick 慢于分钟边界时，5m/15m 卡片会被 1m 挤到没机会重建，从而**多帧同时 stale**；我在 sim 第一版（60 s cadence）就复现了这一点——4 个标的退化成全量 snapshot reload。真实 tick 是亚分钟所以不触发，但**修复必须容忍"卡片 stale 而报价新鲜"**，我已据此放宽定向修复的准入（E 节），并把该形态写成回归用例。
3. **反驳"重启可缓解"。** 重启会把 18 个 UNKNOWN 之外的全部 cache 清空成 `SNAPSHOT_MISSING`，触发全量 backfill——恰是本次要禁止的 storm 形态，且掩盖缺陷复发。
4. **门禁未降级的自证**：`buildTechnicalCard` 抛错文案与判定顺序逐字保持；`marketInsufficient` 阈值表达式未动；`primaryReadyReasons` 只增不改（新增 `sequenceInvalid` 计数与更准确的 reason 标签）；`git diff --check` 门禁保持启用。
5. **CI 阻塞需要人来解**：GitHub Actions 因欠费/额度不能启动 runner。可用现有 Credential Manager 里的 token 在修好账单后 `POST /actions/runs/35448243237/rerun-failed-jobs`（或对 `cf7437b` 重新触发），全绿后我再执行一次受控部署 + Stage 10 验收。
6. **改动清单（便于审）**：`packages/core/src/indicators.ts`（validator 抽取，行为不变）、`adapters/market/BinancePublicMarketDataProvider.ts`（cache 信任 + 合并后复验 + `repairCandles`）、`adapters/market/BinanceMarketStream.ts`（kline 缺口计数与 `lastKlineClosed` 保留期）、`services/marketDataHub.ts`（定向修复、同轮重建、`sequenceInvalid` 统计、`writeTechnical` 复用）、`services/marketDataStaleness.ts`（reason 判定纯函数）+ `appRuntime.ts` 调用、`types.ts`（`repairCandles?` 接口）、5 个测试文件、`docs/prompts/*`（仅删行尾空格）。

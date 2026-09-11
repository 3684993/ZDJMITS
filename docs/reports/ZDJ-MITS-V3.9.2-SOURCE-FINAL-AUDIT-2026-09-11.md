# ZDJ-MITS V3.9.2 源码级最终审计报告

日期：2026-09-11  
仓库：`3684993/ZDJMITS` / `main`  
性质：静态源码最终审计；未启动、停止、重启或热加载 Engine；未执行交易写入。动态回放与 Testnet 验证交给 Codex。

## 1. Executive Verdict

**结论：CONDITIONAL GO。**

V3.9.2 的行情、交易所真相、幂等、TP 修复、reconciliation 和风险边界已经较成熟；当前主要问题不再是“大框架缺失”，而是三个收尾级结构问题：

1. **候选供应链把“订阅驻留、资产治理、市场质量、资本可执行、Pool 槽位、AI-ready”混在同一个候选状态上，形成多层串联衰减。** “无币可交易”不能归因于 AI 保守。
2. **EntryCoordinator 同时承担调度、AI 生命周期、方向验证、资本计划、风险授权、预留、Maker、提交、重试、TTL、冷却，职责过重；同一风险/资格事实在前后多处重复计算。**
3. **自动持仓管理几乎没有推理层。** 默认 0.45% 全量固定 TP；即使启用 STRUCTURE_15M，目标也主要在建仓后首次创建时确定，已有有效 WORKING TP 不会因新结构/趋势继续演化。系统没有 AI Position Observer、MFE 驱动、趋势延续、动态利润锁或智能退出链。

本轮不建议推倒重构。建议 P0 先修候选供应和配置语义，P1 收敛 Entry 授权链，P2 再以 Shadow 方式增加持仓智能，不直接给 AI 无保护平仓权。

---

## 2. 当前真实建仓链

```text
Market snapshots
  -> selectUniverse()
     volume/spread/data/freshness/marketQuality
  -> UniverseCoordinator
     blacklist
     assetDirectory
     tier policy
     optional liquidityTopN
     lifecycle/cooldown
     previous capital route
     resident eligibility / rank
  -> DynamicPool.replenish()
     resident selection
     underlying de-dup
     READY / WAITING
  -> RuntimeControl.evaluate()
     evaluateCapitalAdmission()
     balance / contract / direction permission
     allocation plan
     position/exposure/min-margin
     direction budget / gross budget
  -> EntryCoordinator.processPool()
     route + 15m-side executable
     occupancy
     lifecycle/cooldown
     pending capacity
     Primary capacity/circuit
  -> analyze()
     market readiness
     EIP freshness/completeness
     execution governance
     Primary slot
     market refresh + EIP rebuild
     Primary decision
     direction policy
     deterministic output verification
     protection check
     route/direction capacity recheck
     buildAllocationPlan() again
     reserveEntry()
     buildRiskEnvelope()
     Maker reachability
  -> EntryIntent
  -> setLeverage
  -> executionHardBlock()
     permission/admission/quality/margin/data/occupancy/capacity/risk again
  -> submitExactlyOnce()
  -> Binance GTX Maker
  -> reviewPending()/reprice/TTL/recovery
```

审计判断：安全检查本身并非错误；问题是**资格、资本和风险被多个层重复拥有**，导致状态复杂、调试困难、候选衰减不可解释。

---

## 3. 智能选币：为什么会“无币可交易”

### P0-1：Asset Directory 是最强的隐藏供应闸门

`classifyAsset()` 只允许 `CORE`（BTC/ETH）或满足 V4、未过期、证据完整的 `APPROVED_LIQUID` 进入 online。其余全部 `RESEARCH_ONLY`，不能到 Primary。

默认 `settings.default.json` 的 `approvedLiquid=[]`，而 `reviewedAt/nextReviewAt/evidenceHash/approvals` 由 schema 补成空值。因此**新配置或目录丢失/过期时，在线候选理论上可退化到 BTC/ETH**。

仓库已经有 `ProductionAssetResearchService.review()`，能够用 Production Public READ_ONLY 数据生成一周有效的审批目录，但 `EngineRuntime` 当前没有把它实例化成自动治理刷新链。也就是说，动态研究能力存在，资产在线资格却仍依赖外部/历史目录状态。

**裁决：P0。**

最小修复：

- 将 Production Public READ_ONLY asset review 变成独立治理任务，不进入交易行情域，不产生交易权限。
- 成功后原子更新/persist `assetDirectory`；失败保留 last-known-good，不把全体 altcoin 瞬间降为 Research Only。
- 到期进入 `STALE_GOVERNANCE` 告警和有限 grace，而不是静默收缩候选。
- Dashboard 显示：approved / expired / research-only 数量及下一次 review。

### P0-2：DynamicPool 把“驻留候选”和“可执行候选”混成一个容量

`DynamicPool.replenish()` 的 `selectable` 使用 `(residentEligible ?? eligible) && rank>0`。因此 pipeline 不可运行的候选也可以进入 Pool，只是状态为 `WAITING`。

随后：

- Pool `target` 按所有 item 数量计算，不按 READY 数量计算；
- 新增排序没有优先 READY；
- Pool 已满时只有 `weakest.state==='READY'` 才允许分数替换；
- `expiresAt` 到期只续期，不驱逐。

结果是：**20 个高分 WAITING resident 可以占满 target，而较低分但真正 pipeline-ready 的候选无法进入。** 这会直接制造“Pool 有币，但 AI ready=0”。

**裁决：P0。**

最小修复不是删除 resident 概念，而是分离两个概念：

- `ResidentSet`：行情订阅/候选保温，可包含 WAITING；
- `ExecutionReadyQueue`：只按当前 pipeline + capital + occupancy 可执行候选竞争 Primary。

若不想新增结构，至少修改 `replenish()`：READY 优先填目标；WAITING 不占 READY target；READY 候选允许替换 WAITING；保留 resident 仅用于订阅而非执行容量。

### P0-3：previous capital route 反向写回 Universe，存在陈旧路由反馈

`UniverseCoordinator.refresh()` 使用当前 `runtimeControl.capital.routedCandidates`，未被上一轮 route 选中的 candidate 会被标为 `WAITING_CAPITAL_ROUTE`，`pipelineEligible=false`。

但 `RuntimeControl.evaluate()` 又重新根据 ranked Universe 计算新的 route。两者不是同一原子快照。RuntimeControl 每 2.5s 可重新评估，而 Universe 常规 refresh 主要是 60s/恢复事件。

因此新 route 已经恢复时，Pool 上的旧 `pipelineEligible` 仍可能等待下一次 Universe refresh 才恢复。

**裁决：P0/P1 边界，建议按 P0 修。**

修复：Universe 只负责市场/治理资格，不持久化“上一轮资本 route”作为资格；Entry dispatch 直接消费当前 route generation。route 改变时只更新 ExecutionReadyQueue。

### P1-1：当前“智能选币”实质是确定性 percentile ranking，不是 AI opportunity selection

`selection.ts` 的技术分数主要使用 trendStrength、绝对 MACD slope、BB 偏离、结构计数；capital activity 也使用 OI/taker/funding 的绝对变化。它能找“活跃/强变化”的币，但不等价于“当前满足 Primary 入场事件”的币。

Primary 却要求：

- 15m 有可解释方向；
- 1m/5m timing 不能替代方向；
- PLACE 必须有 TREND_PULLBACK / TREND_RESUMPTION / BREAKOUT_CONFIRMATION；
- 必须存在 completed/confirmed event、anchor、剩余支撑阻力空间；
- RANGE_BOUNDARY_REVERSAL 在线禁止。

因此 Selector 优化的是“市场活跃度”，Primary 优化的是“已完成的趋势入场事件”，**目标函数不一致**。这能解释大量高分候选最后变成 `NO_DIRECTION_EDGE / WAIT / RESELECT`。

建议新增确定性的 `primaryReadinessScore`（不是替 AI 决策）：15m direction clarity、closed-bar anchor、1m/5m timing freshness、可达 band、结构空间。它只用于 dispatch priority，不直接授权 PLACE。

### P1-2：用户设置的部分“智能模式”实际没有进入最终决策链

- `directionReference` 在 `buildEip()` 中计算 `directionWeights()`，但 `buildCompactBrainPrompt()` 的 compact facts 没有把这些 weights/reference 作为 Primary 的方向规则；Prompt 仍硬编码 15m 为方向权威。
- `entryProfileParameters()` 定义了频率/质量档位参数，但 `DynamicPool` 虽 import 它却没有使用；Entry cooldown 实际主要读取 `ai.highFrequency.retryCooldownSeconds`。

因此 UI/配置中的“方向参考”“频率/质量档位”与真实运行语义存在偏差。

**裁决：P0 配置真实性问题。** 要么真正接线，要么从 UI 删除/标注为无效，不能保留看似可控但实际上不改变 Primary 行为的设置。

---

## 4. 建仓链路臃肿与重复 Gate

### 必须保留

- Exchange/Private readiness
- Market freshness at final execution time
- one-underlying occupancy
- exchange minQty/minNotional/tick/step
- reservation/position capacity
- gross/direction/cluster/drawdown hard risk
- AI authorization expiry/range
- idempotent clientOrderId / unknown reconciliation
- GTX post-only final check

### 应合并

当前同一事实至少在这些位置重复：

- `evaluateCapitalAdmission()` 已 build long/short allocation plan；
- AI 后再次 `buildAllocationPlan()`；
- 随后 `buildRiskEnvelope()`；
- `executionHardBlock()` 再次检查 asset admission、market quality、balance、market data、underlying、capacity，并再次 `buildRiskEnvelope()`。

建议收敛成三段：

```text
CandidateEligibilitySnapshot
  市场/治理/黑名单/数据完整性
        ↓
CapitalAuthorizationSnapshot
  当前资金、方向预算、仓位/敞口、最小可执行量
        ↓
AI Entry Decision
        ↓
FinalExecutionGuard
  只检查“自授权后发生变化”的事实：
  TTL、最新 quote/book、reservation、balance、occupancy、risk delta、precision、GTX
        ↓
Submit exactly once
```

`FinalExecutionGuard` 必须保留，但不应重新承担整套 Selection/Portfolio 业务判断。

### EntryCoordinator 过载

当前类同时负责 scheduler、wait、Primary slot、AI result、policy、plan、reservation、risk、maker、leverage、submission、retry、cooldown、pending review。建议只做职责拆分，不重写框架：

- `EntryScheduler`：READY queue / fairness / AI slot
- `EntryDecisionAuthorizer`：EIP + Primary + deterministic authorization
- `EntryExecutor`：reservation + final guard + Maker + exactly-once
- `PendingEntryManager`：TTL/reprice/reconciliation

保持现有 state/contracts，优先移动代码而不是重新设计数据结构。

---

## 5. AI 决策空间审计

### 当前真实情况

当前 online Entry 实际只有一个 Primary completion：`AiFabric.decide()` -> `primaryOnce()`。Scout 不在 Entry 必经链，`settings.ai.scoutEnabled=false`；现有 Scout 资源更多用于外部研究。

Primary 的推理空间并非“无限”：

- 15m UP/DOWN 时 PLACE 必须同向；
- RANGE/UNCERTAIN 允许 NO_DIRECTION_EDGE；
- 价格、range、horizon 都必须显式给出；
- actual recent trade + reachable band 只证明执行合法，不能作为交易优势；
- 非 PLACE 不能携带执行授权。

这些约束总体合理，但 Selector 没有专门筛“Primary 能做决定的事件”，所以模型大量时间在证明“当前不够好”。

**建议：不要取消 NO_DIRECTION_EDGE，也不要强制 PLACE。先提升送给 Primary 的候选质量和 ready supply。**

---

## 6. PLACE -> Fill 执行效率

配置里 `entry.absoluteTtlMinutes=60`，但 near-market 默认 enabled、`ttlSeconds=90`；Intent 的 `absoluteExpiresAt` 又取 AI horizon 与 near-market TTL 的最小值，而 AI schema 的 horizon 只有 1~5 分钟。

因此默认 near-market 下，**一个 AI 授权订单的实际生存上限通常约 90 秒，而不是 UI/配置看起来的 60 分钟。** `reviewPending()` 还再次按 near-market TTL 截止。

这不是必然错误，但属于明显配置语义冲突，也会降低 Maker 等待成交概率。

建议拆成三个明确参数：

- `decisionHorizon`：AI 认为该入场 thesis 有效多久；
- `makerWorkingTtl`：一个具体报价允许工作多久；
- `candidateReanalysisDelay`：未成交后多久重新分析。

不得用一个 absolute TTL 同时表达三种语义。

---

## 7. Position / TP / “提前平仓”审计

### 没发现隐藏的自动提前平仓策略

当前自动 Position 路径主要是：Entry fill -> Position -> `TpGuardian.ensure()` -> TP fill -> close。

`ManualPositionService` 明确是 HUMAN action；`TestnetLowLossCleanupService` 注释和实现都明确 one-shot / human-invoked / not registered with scheduler。

因此用户观察到的“提前平仓”，源码上更可能来自**TP 目标过近/过固定**，而不是存在秘密 AI/反转/风险模块自动砍仓。

### 默认 TP 确实过于机械

默认设置：

- `mode=PRICE_MOVE_PERCENT`
- `targetPriceMovePercent=0.45`
- `quantityPercent=100`

`takeProfitPrice()` 对所有 symbol 使用同一个 0.45% entry-price move；不区分 ATR、趋势强度、持仓时长、MFE、结构突破、币种波动率。

### STRUCTURE_15M 也不是动态持仓管理

结构模式会在建 TP 时读取 fresh closed 15m swing high/low，并受 min/max distance + fee floor 约束，这是比固定 0.45% 更合理的 target selection。

但 `TpGuardian.ensure()` 一旦发现已有正确 side/qty 的 WORKING TP，会立即标记 PROTECTED 并 return，**不会因为后续 15m 新结构、趋势延续或 MFE 增长重新计算 target。**

所以 STRUCTURE_15M 是“开仓后的结构化一次性目标”，不是 Dynamic TP。

---

## 8. 收益最大化缺口

当前缺少：

- 持仓后的持续 thesis re-evaluation
- running MFE/MAE high-water/low-water
- 趋势延续评分
- profit target extension
- profit lock / giveback budget
- 结构突破后的新目标迁移
- AI position reasoning
- partial profit + runner（当前 guardian 假设单 TP 为主）

`PositionService.updateMarks()` 只更新 mark/PnL。`riskReadiness.evaluateProtectionShadow()` 能计算理论触发/MFE/MAE，但并未形成真实 Position Intelligence 或自动退出授权。

结论：**当前系统把最强的 27B 主要用于“能不能进”，进入持仓后几乎完全停止推理。** 这确实没有充分发挥 AI 的价值。

---

## 9. 推荐的 AI Position Intelligence / Dynamic Exit

### P2-A：AI Position Observer（先 Shadow）

新增只读 `PositionIntelligenceService`，只在以下事件触发，而不是每秒调用：

- 新 closed 5m / 15m
- 距离当前 TP 进入阈值
- 新 MFE 高点后明显回撤
- 15m 结构/趋势发生变化
- funding/orderflow 出现明显变化

输入：entry、duration、PnL、running MFE/MAE、1m/5m/15m/4h、closed swing、BTC/ETH regime、book/orderflow、当前 TP、费用/净收益 floor。

AI 输出只允许：

```text
HOLD
EXTEND_TARGET
KEEP_TARGET
TIGHTEN_TARGET
PARTIAL_PROFIT_CANDIDATE
EXIT_PROFIT_CANDIDATE
THESIS_INVALIDATED
```

AI **不直接调用交易所**。

### P2-B：Deterministic Exit Guard

如果以后授权自动执行，AI 只能生成 `ExitIntent`，Guard 再检查：

- exchange position truth
- reduce-only / idempotency
- TP cancel/replace exact state
- fee-adjusted net profit
- 最小持仓周期
- 最大 profit giveback
- fresh closed-bar evidence
- liquidity/executable quote
- 不扩大仓位、不反手
- 不因模型失败自动平仓

### P2-C：Hybrid Dynamic TP

第一阶段不要直接引入复杂 multi-leg TP。保留“一仓一主 TP”契约，增加可验证的 target revision：

```text
初始目标 = fixed / structure
      ↓
趋势继续 + 新 closed structure + MFE 扩张
      -> AI/规则建议 EXTEND
      -> Guard 允许向更优目标迁移

趋势衰减 / giveback 增大
      -> KEEP 或 TIGHTEN

费用后已盈利 + thesis 明确失效
      -> ExitIntent candidate
```

这样比直接做多 TP / trailing-stop 大改更适合 V3.9.2 收尾。

---

## 10. P0 / P1 / P2 最小实施清单

### P0 — 必须先修

1. **Asset Directory 自动治理与过期 grace**  
   文件：`assetAdmission.ts`, `productionAssetResearch.ts`, `appRuntime.ts/settingsStore.ts`, dashboard diagnostics。
2. **Pool READY 与 Resident 容量解耦**  
   文件：`pool.ts`, `universeCoordinator.ts`, candidate lifecycle tests。
3. **移除 previous-route 对 Universe pipelineEligible 的陈旧反馈**  
   文件：`universeCoordinator.ts`, `runtimeControlService.ts`, `entryCoordinator.ts`。
4. **修复配置真实性**：`directionReference`、`entryProfile`、TTL 三类 UI/配置要么真正接线，要么明确废弃。  
   文件：`eip.ts`, `compactEntry.ts`, `profiles.ts`, settings/dashboard。

### P1 — 建仓质量/吞吐

1. 新增 `primaryReadinessScore` 作为 dispatch priority，不作为交易 gate。
2. 将 EntryCoordinator 拆成 scheduler / authorizer / executor / pending manager，保持现有 contracts。
3. 合并 CapitalAdmission / Allocation / Risk 的重复所有权，形成一个 authorization snapshot + final race guard。
4. 拆分 decision horizon / maker TTL / reanalysis delay。
5. 增加 funnel 指标：Universe -> OnlineAsset -> MarketQualified -> Resident -> CapitalRouted -> Ready -> Primary -> PLACE -> Intent -> RemoteId -> FirstFill -> FullFill。

### P2 — 收益延续

1. Position running MFE/MAE + closed-bar state。
2. AI Position Observer Shadow。
3. Hybrid Dynamic TP Shadow。
4. ExitIntent + Deterministic Guard，仅通过 replay/Testnet 证明后再讨论 AUTO。

---

## 11. 删除 / 合并 / 保留

### 删除或停止重复拥有

- Universe 不再保存上一轮 capital route 作为市场资格。
- Final execution guard 不再重新承担完整 asset/selection 业务逻辑，只验证授权后发生变化的硬事实。
- 不再让 `entryProfile` / `directionReference` 保持“配置存在但语义不生效”的状态。

### 合并

- CapitalAdmission + Allocation + Risk -> CapitalAuthorizationSnapshot。
- Pool resident 与 ready 概念在数据结构或计算层分离。
- AI 后的 output validation 保持一处 canonical authorizer。

### 必须保留

- Binance/exchange truth
- reconciliation
- exactly-once / clientOrderId
- private readiness
- final market freshness
- position/underlying occupancy
- minQty/minNotional/tick/step
- direction/gross/cluster/drawdown hard risk
- Testnet/Production write boundary
- TP repair idempotency

---

## 12. Codex 最终验证清单

Codex 不重新设计，只按本报告做隔离验证。

### P0 replay

1. Asset Directory：fresh / expired / refresh failed / last-known-good / empty default。
2. Pool：20 WAITING + 5 READY，必须保证 READY 可被 Primary dispatch；WAITING 不得饿死 READY。
3. route generation 改变后，不等 60s Universe refresh 即可恢复 READY。
4. `directionReference` 和 `entryProfile` 每个 UI 值都必须有可观测行为差异，或被删除。

### Entry replay

- `npm run verify`
- 100+ symbol deterministic selection replay
- NO_DIRECTION_EDGE / WAIT / RESELECT 分布
- PLACE -> Intent -> Order -> RemoteId -> Fill funnel
- same-underlying occupancy
- gross/direction/cluster capacity
- 5022 GTX retry
- UNKNOWN reconciliation
- partial fill
- TTL / reprice

### Exit replay

对同一批历史 closed-bar 轨迹比较：

```text
Fixed 0.45%
vs STRUCTURE_15M
vs Hybrid Dynamic TP Shadow
```

指标：net PnL、MFE capture ratio、profit giveback、holding time、exit fee、TP replacement count、missed extension、false early exit。

AI Position Observer 必须先 Shadow，至少证明：

- 不产生 exchange writes
- 不扩大风险
- 无模型时系统维持现有 TP
- 重启可恢复
- 输出可回放/可审计

需要真实 Testnet Engine 生命周期操作时，另行取得用户明确授权。

---

## 13. 最终裁决

**V3.9.2：CONDITIONAL GO。**

当前不建议继续扩展大框架，也不建议通过放宽风险门或强迫 AI PLACE 来提升频率。

优先级应是：

```text
P0 候选供应恢复与配置真实性
        ↓
P1 Entry 链路收敛 + Primary-ready ranking
        ↓
Codex deterministic replay / verify
        ↓
P2 Position Intelligence Shadow
        ↓
Dynamic TP A/B replay
        ↓
Testnet 自然验收
```

最重要的源码结论：

1. **“无币可交易”有明确的非 AI 根因：Asset Directory、Pool WAITING 占槽、陈旧 capital route、Selector 与 Primary 目标函数错位。**
2. **建仓链确实过重，但安全边界不应删；应收敛“谁拥有资格/资本/风险授权”。**
3. **没有发现隐藏自动提前平仓策略；当前提前兑现更符合固定 0.45% / 一次性 TP 目标的行为。**
4. **AI 的推理能力目前几乎只用于 Entry；Position/Exit 是 V3.9.2 最大的智能化缺口。**
5. **下一步应先 P0/P1，再让 AI 以 Shadow Position Observer 进入持仓阶段；不要一步到位给 AI 平仓权。**

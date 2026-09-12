# ZDJ-MITS V3.9.2 候选库存、执行前置治理与退出接续实施方案

日期：2026-09-11
状态：**PLAN ASTRA-REVIEWED / SOURCE IMPLEMENTATION NOT STARTED**
基线：`3684993/ZDJMITS/main`
目标：解决“扫描浪费、候选枯竭、Pool 看似有币但不可交易、非资金原因等待、27B 调用后才发现不能执行”等设计型阻断；P2 收益策略以 `ZDJ-MITS-V3.9.2-P2-PROFIT-TAKE-POLICY-DECISION-2026-09-11.md` 为准。

> 本文件是后续实施断点。任何会话/Agent 中断后，先读本文件，再从“实施检查点”继续；不得重新发明架构。

## 1. 对用户“100 个交易对批次复用”思路的裁决

方向正确，而且比“固定周期反复全量重扫 + 每层重新筛一遍”更符合本系统。

但触发条件不应写死为“80% 已成交”。原因：

- 默认 `maxPositions=50`，而 cohort=100；如果用同时成交占比触发，天然可能与仓位上限冲突。
- 一部分 symbol 会因 `NO_DIRECTION_EDGE / WAIT_FOR_PRICE / cooldown / market quality / direction capacity` 长时间不成交，可能永久锁死下一轮扫描。
- “未成交”不等于仍值得占用执行库存。

因此采用 **候选库存耗尽（inventory depletion）**，而不是单纯成交率。

目标结构：

```text
Cheap Discovery Index
  全市场轻量排名，只更新 ticker / contract metadata
          ↓
Active Cohort（默认约 100）
  只在启动或库存低水位时增量补充完整 snapshot / WS
          ↓
Resident Set
  值得继续维护行情的候选
          ↓
Execution Ready Queue
  此刻通过治理、质量、资金、方向、occupancy、freshness 的候选
          ↓
Primary 27B
          ↓
Entry Authorization -> Maker -> Fill
```

### Cohort 补充触发器

满足任一项才允许补充，不再固定 15 分钟重建 100 个完整 snapshot：

1. `ExecutionReady` 低于低水位（建议初始 6，最终由回放校准）；
2. `ResidentFreeUnderlyings` 低于低水位（建议初始 20）；
3. 当前 cohort 中 `CONSUMED/RETIRED` 比例 >= 70~80%；
4. Asset Directory 新增已批准资产；
5. 用户显式刷新；
6. cohort 数据完整性发生系统性故障，需要恢复。

补充采用 **10~20 个增量 batch**，不是再次销毁/重建全部 100。

`CONSUMED/RETIRED` 建议包括：已有持仓/在途订单、进入 HUMAN_HANDOFF、长期 quarantine、治理撤销、合约不可用。普通 25s cooldown、WAIT_FOR_PRICE 不算永久 consumed。

Cheap Discovery 可以继续周期更新，因为 `/ticker/24hr` 是轻量发现事实；禁止把“更新排名元数据”误写成“重新对 100 个 symbol 完整 REST snapshot/bootstrap”。

---

## 2. 已从源码确认的前置问题（不少于 3 个）

### P0-A — 固定周期完整刷新与 WS 常驻重复工作

证据：`appRuntime.start()` 当前存在：

- 15 分钟：`market.tick()` + `market.refresh(marketSymbolLimit())` + `universe.refresh()`；
- 60 秒：若 snapshots 不足再次 `market.refresh(...)`，否则 targeted refresh live symbols；
- 10 秒：`recoverStale()`；
- 1 秒：`market.tick()`。

`MarketDataHub.refresh()` 又会 `provider.listSymbols()` 后对选中 symbols 执行 `loadSnapshot()`。

`BinancePublicMarketDataProvider.listSymbols()` 每次重新按 24h quote volume 排名，并重设 `baseSymbols` / stream symbols。

问题：发现、完整 bootstrap、WS 常驻和 stale recovery 没有清晰分层。行情已经由 WS 持续维护时，固定完整刷新仍可能产生不必要 REST/技术指标回补、排名抖动和执行状态重算。

**修复：** 将 `refresh()` 拆成 `refreshDiscoveryIndex()` 与 `hydrateCohortDelta()`；运行中 full hydrate 只由 cohort depletion 触发。WS tick、targeted stale recovery 保留。注意：这不等于停止 4h/1d/1w、衍生品和合约规则的字段级更新，详见第 10 节 Astra 复核修正。

### P0-B — Snapshot“墓地”：旧扫描 symbol 没有明确驱逐

证据：`MarketDataHub.refresh()` 对新 snapshot 只执行 `state.snapshots.set()`；当前源码没有对应的 `snapshots.delete()` 生命周期。`tick()`、`freshness()` 又遍历整个 `state.snapshots`。

后果：随着 Top100 成员变化，历史 symbol 可能继续留在内存状态；即使 stream base set 已变化，旧 snapshot 仍参加 freshness/stale/recovery/universe 计算，形成“僵尸候选”。这会让系统运行时间越长，stale 数和恢复工作越可能脱离真正 Active Cohort。

**修复：** 增加 snapshot ownership/retention：仅保留 `ActiveCohort ∪ positions ∪ activeEntries ∪ WAIT_FOR_PRICE ∪ analysis/authorization-in-flight ∪ UNKNOWN orders ∪ HUMAN_HANDOFF-required-market`。离开 retention set 的 symbol 从执行 Universe 和 stale recovery 移除；如需历史研究只能进入冷数据，不得继续成为在线 snapshot。驱逐必须使用 ownership epoch/cancellation 防止旧 hydrate/recovery 完成后把已驱逐 symbol 写回。

### P0-C — Pool 中 WAITING 可以占满 target，READY 候选进不来

证据：`DynamicPool.replenish()`：

- `selectable=(residentEligible ?? eligible)&&rank>0`；
- pipeline 不可执行也可以加入，只是 state=`WAITING`；
- `while(items.size < target)` 按所有 item 计数，不按 READY 计数；
- Pool 满时替换条件要求 `weakest.state==='READY'`；
- expiresAt 到期只续期，不驱逐。

更严重的是 Entry reject/cooldown 会先 `pool.remove()`，随后立即 `pool.replenish()`；该 candidate 仍可能因 `residentEligible=true` 被重新加入为 WAITING。

后果：可能出现 `poolCount=20 / readyCount=0`，系统显示“有候选”但 Primary 没有可运行候选。

**修复：** Resident 与 ExecutionReady 分离。可以仍使用同一候选存储，以两个实时派生视图实现，不强制新增两套持久化队列。WAITING 不消耗 readyTarget；READY 可以替换 WAITING；cooldown candidate 不得通过 resident 立即重新占 execution slot。

### P0-D — 上一轮 Capital Route 反向成为当前 Universe Gate

证据：`UniverseCoordinator.refresh()` 读取 `state.runtimeControl.capital.routedCandidates`，未在上一轮 route 内的候选会得到 `WAITING_CAPITAL_ROUTE` / `pipelineEligible=false`；而 `RuntimeControl.evaluate()` 又基于新的 ranked Universe 重新计算 capital route。

这是两个不同 generation 的反馈环：

```text
Universe(t)
 -> CapitalRoute(t)
 -> Universe refresh(t+1) 用旧 Route(t) 阻断
 -> RuntimeControl 再算 Route(t+1)
```

这主要造成状态滞后与候选饥饿，不应笼统称为永久死锁。现有 capital generation 又沿用 selection generation，资金事实变化未必使它变化。

**修复：** Universe 只拥有市场/治理/质量资格；Capital Route 只属于 ExecutionReady/dispatch。不得把 previous route 写回 resident eligibility。新增独立 `capitalVersion`（或等价版本），至少对余额、持仓、reservation/working order、风险额度/配置变化递增；dispatch 必须消费一致版本。

### P0-E — 扫描 100 个币，不代表 100 个币在线可交易：Asset Directory 可把供应压到 BTC/ETH

证据：`classifyAsset()` 只有 CORE(BTC/ETH) 或满足 V4、未过期、证据可追溯的 `APPROVED_LIQUID` 才 `isOnlineAsset=true`。默认 settings 的 `approvedLiquid=[]`。

因此即使外部扫描/MarketData 成功拿到 100 个 symbol，资产治理目录失效、过期或未持久化时，也可能出现“看起来扫描 100，实际只剩 CORE 可进入 Primary”。

仓库已经存在 `ProductionAssetResearchService.review()`，但当前 Engine Runtime 没形成清晰的 last-known-good 自动治理刷新闭环。

**修复：** Production Public READ_ONLY research 只负责产生治理目录；成功后原子更新；必须区分“取数失败”和“真实治理撤销”。单资产 `SOURCE_FAILED` 不得静默缩小 LKG；按资产保留上次有效审批并设置有期限 grace/告警。明确的真实撤销不得被 LKG 延续。异步 review 发布必须 CAS/版本校验，禁止覆盖期间发生的人工配置变更。扫描规模与治理批准数量必须分别显示。

### P0-F — 贵的 AI 调用之前，仍有部分可前置的确定性失败

当前 `EntryCoordinator.processPool()` 已经做 route/direction/occupancy/cooldown 初筛，这是正确方向；但 Primary 完成之后仍会重新经历：DirectionPolicy、direction capacity、`buildAllocationPlan()`、reservation、`buildRiskEnvelope()`、Maker reachability；最终 `executionHardBlock()` 又复查 admission、balance、market、occupancy、capacity、risk。

最终 Guard 必须保留，因为 27B 请求期间事实会变化；问题是缺少一个明确的“AI 前置可行性快照”。

**修复：** Primary 之前生成 `PreflightFeasibility`（名称避免误解成交易授权）：

```text
candidateGeneration
capitalVersion
marketFreshAt
allowedDirections
long/short feasible notional
occupancyClear
positionCapacityClear
riskHeadroom
minimumExecutableNotional
expiresAt
```

只有 Preflight PASS 才调用 27B。但它**不授予下单权限**。AI 输出的方向、价格区间、期限、证据与具体数量仍须确定性校验、Allocation、原子 Reservation。每次真实 submit/retry 前继续检查 execution permission/governance、freshness、balance、occupancy、risk、precision、GTX 与 authorization expiry。前期优先复用同一套规则函数，待版本覆盖可靠后再优化成增量 drift guard，避免为了“去重”漏掉安全门。

---

## 3. 新的 P0 总体设计

```text
[1] Discovery Index（便宜）
    24h volume / count / contract existence
        |
        | cohort depletion / governance change
        v
[2] Active Cohort ≈ 100（有界库存）
    full bootstrap once + WS ownership
        |
        +--> Field Refresh：衍生品 / 4h / 1d / 1w / rules 独立更新
        |
        v
[3] Resident Market View
    admitted + market quality + selected contract
        |
        v
[4] Preflight Feasibility Filter
    current capital + direction + occupancy + freshness + risk headroom
        |
        v
[5] Execution Ready View（真正给 27B 的队列）
    readyTarget 与 residentCount 完全分开
        |
        v
[6] 27B Primary
        |
        v
[7] Post-AI deterministic authorization
    direction/range/horizon/evidence/allocation/reservation
        |
        v
[8] Final Submit Guard
    permission/freshness/balance/occupancy/risk/precision/GTX/TTL
        |
        v
[9] Maker Order
```

核心原则：**所有可确定的“不可能交易”问题尽量在昂贵步骤之前消灭；Preflight 只证明可行性，不替代 AI 后确定性授权与每次实际提交的最终安全检查。**

---

## 4. 配置建议

先新增语义明确的配置，不沿用含糊的 `universeTopN/poolTarget` 表达全部层：

```json
{
  "candidateInventory": {
    "cohortSize": 100,
    "readyTarget": 20,
    "readyLowWatermark": 6,
    "freeUnderlyingLowWatermark": 20,
    "refillBatchSize": 15,
    "depletionRatio": 0.75,
    "discoveryRefreshSeconds": 900,
    "maxRefillInFlight": 1,
    "refillBackoffSeconds": 60,
    "staleMemberRotationMinutes": 120
  }
}
```

这些是首版回放参数，不是永久最优值。Discovery refresh 只更新轻量 rank；不得每次触发 100-symbol full snapshot。

Refill 触发必须 reason-aware：如果 ready 低的根因是 `NO_CAPITAL / POSITION_CAPACITY_FULL / GLOBAL_RISK_PAUSE / SYSTEMIC_MARKET_FAILURE`，不得连续换币；只有 `SUPPLY_DEPLETED / NO_NEW_EXECUTABLE_CANDIDATE / GOVERNANCE_CHANGE / USER_REFRESH` 等供应类原因才允许 refill。单次 refill single-flight + backoff；若 discovery 没有新增合格资产则停止继续 refill，等待下一次有效触发。长期未 consumed、但持续无机会的 cohort 成员允许按有界年龄轮换，避免库存永远固定。

---

## 5. 实施阶段与断点

### Phase A — 可观测性与语义拆分（先做）

- [ ] 增加 `ActiveCohort / Resident / ExecutionReady / Consumed / ZombieSnapshot` 独立计数。
- [ ] 增加 ready=0 根因分类：SUPPLY / CAPITAL / CAPACITY / RISK / MARKET / GOVERNANCE / AI。
- [ ] `POOL_SUPPLY_HEALTH` 不再用 poolCount 代表 ready supply。
- [ ] Dashboard/Runtime API 能回答“为什么现在没有币给 Primary”。
- [ ] 测试：100 resident、20 WAITING、10 READY 时 readyCount 必须为 10，而不是 0。

### Phase B — Pool/Route 饥饿修复

- [ ] READY 与 WAITING 容量解耦，可使用同一存储的两个派生视图。
- [ ] cooldown remove 后不能立刻以 WAITING 占回 execution target。
- [ ] 删除 previous capital route 对 Universe pipeline eligibility 的反馈；route 只在 dispatch 层消费。
- [ ] 建立独立 capitalVersion；资金/仓位/reservation/risk 事实变化必须可见。

### Phase C — Asset Directory 失败与过期语义

- [ ] research review 与 execution market domain 隔离。
- [ ] 区分 SOURCE_FAILED 与明确治理撤销。
- [ ] 单资产失败保留 LKG + 有期限 grace；明确撤销立即生效。
- [ ] 异步发布使用版本/CAS，禁止覆盖人工变更。
- [ ] UI 分别展示 discovered / approved / resident / ready。

### Phase D — 字段更新与 Snapshot Retention

- [ ] 拆分 cohort membership refresh 与字段 refresh。
- [ ] 1m/5m/15m 继续 WS；4h/1d/1w、derivatives、contract rules 保留独立按需/周期更新。
- [ ] 增加 snapshot ownership/retention 与 zombie eviction。
- [ ] eviction 使用 ownership epoch/cancellation，防止旧异步 hydrate/recovery 写回。
- [ ] position / active order / analysis in-flight / authorization wait / UNKNOWN order / HUMAN_HANDOFF 必须有明确行情保留责任。

### Phase E — Cohort 增量库存

- [ ] 启动时 hydrate cohortSize。
- [ ] 移除固定周期 100-symbol full hydrate；保留 cheap discovery 与字段级 refresh。
- [ ] refill 仅响应供应类 blocker，single-flight + backoff。
- [ ] depletion/low-watermark 时只补 refillBatchSize。
- [ ] discovery 无新增合格资产时停止 refill storm。
- [ ] cohort 满额时定义替换优先级；长期无机会成员有界轮换。

### Phase F — Preflight Before AI

- [ ] 新增 `PreflightFeasibility` 或等价 immutable snapshot。
- [ ] 所有可提前确定的“不可能执行”理由在调用 Primary 前结束。
- [ ] Preflight 不创建 order authorization。
- [ ] AI 后继续校验方向/range/horizon/evidence、allocation 与原子 reservation。
- [ ] 每次 submit/retry 继续校验 permission/freshness/balance/occupancy/risk/precision/GTX/TTL。
- [ ] 先复用统一规则函数，暂缓建立复杂“变化事实追踪框架”。

### Phase G — P1/P2 接续

- [ ] P1 再增加 `primaryReadinessScore`，只调整给 27B 的优先级，不直接授权下单。
- [ ] 暂缓 EntryCoordinator 大规模四类重构；只有前述修复稳定后再按必要性拆职责。
- [ ] P2 按独立裁决文件：Primary PLACE 同时产生科学 ProfitTakePlan；亏损超过配置闭合 15m bars 后 HUMAN_HANDOFF；AI 不进行亏损平仓。
- [ ] P2 计划绑定具体 entry/position cycle，按真实成交均价、数量、费用重新验算；fallback 使用自己的确定性授权，不受无效 AI range 限制。
- [ ] 亏损 bar 计数按唯一 closed 15m bar 持久化，明确转盈重置、缺失 bar 不重复计数；handoff 仅转移决策责任，仓位/保证金/风险/TP maintenance 仍持续。

---

## 6. 必须避免的错误实现

- 不允许“为了永远有币”而绕过 market quality / asset governance / risk。
- 不允许每次 Entry fill 都立即 full scan 100。
- 不允许单纯以 80 fills 作为唯一 refill 条件。
- 不允许 ready 低时不区分 NO_CAPITAL/CAPACITY/RISK 就持续换币。
- 不允许删除 stale recovery；只能把 recovery 限定到 active retention set。
- 不允许删除 4h/1d/1w、derivatives、contract rules 的必要更新链。
- 不允许 position/active order/UNKNOWN/analysis-in-flight 因退出 cohort 而停止必要行情维护。
- 不允许异步旧任务把被 eviction 的 symbol 写回 online snapshots。
- 不允许把 Cheap Discovery 排名结果直接当成 Entry authorization。
- 不允许强制 Primary PLACE。
- 不允许把 Preflight 视为交易授权。
- 不允许为减少重复 gate 删除每次 submit/retry 的最终安全检查。
- 不允许 LKG 掩盖明确治理撤销或覆盖人工配置变更。

---

## 7. Codex 最终验证矩阵

完成源码实施后由 Codex 隔离验证：

1. `npm run verify` 全 PASS；
2. 100-symbol cohort 稳态 2h，禁止固定周期 full hydrate 100；
3. 4h/1d/1w、derivatives、contract rules 仍按设计刷新；
4. depletion 前不 refill，达到供应类阈值后只增量补 batch；
5. NO_CAPITAL / CAPACITY_FULL / RISK_PAUSE / SYSTEMIC_MARKET_FAILURE 不触发 refill storm；
6. discovery 无新增资产时 refill 正确 backoff/停止；
7. 旧 cohort symbol 正确 eviction，且异步旧任务不能写回；snapshot 总数有界；
8. positions / active entries / analysis-in-flight / UNKNOWN / HUMAN_HANDOFF 必须保留必要行情责任；
9. `poolCount>0 && readyCount=0` 时给出真实 blocker；
10. 20 WAITING 不得阻止 READY 候选进入 ExecutionReadyView；
11. cooldown candidate 不得立即重新占 readyTarget；
12. capital route 更新后无需等待下一轮 Universe full refresh；capitalVersion 对资金事实变化生效；
13. asset review 单资产 SOURCE_FAILED 时 LKG 不被误删；明确撤销生效；异步 review 不覆盖人工更新；
14. Preflight BLOCK 的 symbol 不调用 27B；
15. Preflight PASS 不等于 order authorization；AI 后 allocation/reservation 必须继续执行；
16. 27B 返回或 submit retry 时 capital/market/governance drift 必须被最终 Guard 安全阻断；
17. 比较修改前后：REST 请求数、WS symbol 数、snapshot 总数、ready supply、Primary runs、PLACE/intents/orders/fills、AI wasted-run ratio；
18. P2 比较收益时必须纳入未平仓浮亏、资金占用、持仓时间与 MFE capture，而非只看已止盈交易。

---

## 8. 验收指标

本轮不是以“建仓越多越好”为 PASS，而是：

- snapshot / WS / recovery 集合有界且可解释；
- 重型 full hydrate 次数显著下降，同时长期/衍生字段不失真；
- 非资金原因的 `ready=0` 能定位到具体单层 blocker；
- Pool 不再因 WAITING resident 发生执行容量假满；
- refill 只由真实供应耗尽触发，不因资金/仓位/风险阻断制造扫描风暴；
- Primary 调用前通过 deterministic feasibility；
- `AI wasted-run ratio`（Primary 后因调用前已可知 blocker 失败）趋近 0；
- Preflight 不削弱 AI 后 allocation/reservation 与 submit/retry 最终安全边界；
- 不降低现有交易所真相、风险、幂等、Maker 安全边界。

---

## 9. 实施检查点（中断后从这里恢复）

当前状态：**PLAN ASTRA-REVIEWED / SOURCE IMPLEMENTATION NOT STARTED BY THIS PLAN**。

最终固定顺序：

`Phase A 可观测性 -> Phase B Pool/Route -> Phase C Asset Directory -> Phase D 字段更新/Retention -> Phase E Cohort增量库存 -> Phase F Preflight -> P1 -> P2`

每完成一个 Phase：

1. 在第 14 节唯一检查点更新阶段状态；第 5 节核对相应条目，不维护第二套进度；
2. 写明 commit SHA；
3. 写明修改文件；
4. 写明测试状态 `NOT_RUN / PASS / FAIL`；
5. 未完成不得跨阶段继续加功能。

如发生中断，新会话只需读取本文件和最新 commit，即可继续，不需要重新讨论设计。

---

## 10. GPT-6 Astra 实施前复核裁决（2026-09-11）

复核结论：`PASS_WITH_CHANGES`。本方案接受其必要修改，以上正文已合并，不另建平行方案。

采纳项：

- refill 必须 reason-aware、single-flight、backoff，并有“无新增合格资产”停止条件；
- cohort 长期无机会成员需要有界轮换；
- membership 更新与 4h/1d/1w、derivatives、contract rules 字段更新分离；
- snapshot eviction 必须防止异步旧任务写回，并保留 analysis/authorization/UNKNOWN/position 等 owner；
- capitalVersion 不得复用 selection generation；
- Preflight 仅证明 feasibility，不削弱 AI 后 allocation/reservation 或每次 submit/retry 最终 guard；
- Asset Directory LKG 必须区分单资产 SOURCE_FAILED 与明确撤销，并保护人工配置版本；
- P2 handoff 只转移决策责任，不释放真实风险敞口；TP 计划与亏损 closed-bar 计数必须持久化并绑定持仓周期；
- Resident/Ready 优先以同一存储的两个视图实现，暂缓不必要的大规模 EntryCoordinator 重构。

最终裁决：**方案可进入实施；不得在实施中重新扩大范围。**


---

## 11. 本地执行交接说明（Luna / Terra）

整理日期：2026-09-11。目标执行模型：用户指定的 Codex 5.6 Luna 或 Terra，使用高级推理。本文不依赖模型自动记住前文，不要求多 Agent，也不要求模型切换。

### 11.1 权威与基线

- 本文件是唯一接续实施文件；第 1–10 节取自远端提交 `fb49e10a194d00332efa55e9f3b2d25859a42144`（页首状态统一为当前状态），本地追加第 11–15 节把已批准范围细化为执行步骤。
- 原始来源：https://github.com/3684993/ZDJMITS/blob/fb49e10a194d00332efa55e9f3b2d25859a42144/docs/plans/ZDJ-MITS-V3.9.2-Candidate-Supply-And-Exit-Final-Plan.md
- P2 权威来源为同一提交下的 `docs/plans/ZDJ-MITS-V3.9.2-P2-PROFIT-TAKE-POLICY-DECISION-2026-09-11.md`；其必要执行规则已收入下文。原审计报告的持续 Position AI / Dynamic Exit 建议不再是实施任务。
- 当前整理动作只写本文档，不代表源码已实施或任何测试通过。不要沿用旧报告的 PASS 作为新实现证据。
- 整理时本地 HEAD 为 `4f4a83fd4b2eba9c538a8a0075742f103c46bea6`，早于远端方案提交。执行者必须先确认真实源码基线，不能直接假设本地已同步。
- 本地计划包含远端之后的执行细则；准备工作区时保留此文件，不用 checkout/reset 覆盖它。不要另建竞争性方案文件。

### 11.2 授权与运行边界

1. 只有收到用户“按本文件实施”的新指令后才开始源码实施。整理本文件本身不授予 Engine 生命周期操作权限。
2. 遵守工作区 AGENTS.md。禁止启动、停止、重启、热加载真实 Engine；禁止安装 autostart、服务、重启守护；禁止对 live data 执行 dev/watch。
3. 现有持仓、订单、TP、生产配置及凭证保持原有管理链。不得为验证方案修改 live settings、迁移 live SQLite、发送交易写请求。
4. 构建、数据库迁移验证、回放在独立 checkout/worktree、独立测试数据目录执行。测试实例仅可使用独立端口和模拟 exchange adapter，不能产生真实交易所写入。
5. 不把 `npm run acceptance` 当作普通单测直接执行；先阅读脚本及其调用链，确认无真实 Engine 生命周期、live data 或交易写副作用。不得运行启动脚本来“补齐验收”。
6. 真正 Testnet 自然窗口需要用户另行明确授权具体启动动作；若授权，使用 `scripts/start-zdj-lan.ps1` 并复用已有实例。健康探测失败只报告，不自动恢复。
7. 不自动 push、部署或合并 main。源码阶段提交按当次用户授权执行；未提交可用 diff/checkpoint 记录，不编造 commit SHA。

### 11.3 开工与续跑步骤

- 读取 AGENTS.md、本文第 14 节检查点、git status、HEAD 和实际 package scripts。
- 对比当前源码与上述基线的相关差异。远端文档更新不等于源码更新；已有修复先核验，不重复实现。
- 记录基线 typecheck/test 的结果和既有失败。选择隔离工作区时保留用户未提交内容，不清理或覆盖。
- 按 A → B → C → D → E → F → P1 → P2 串行推进；同阶段先补关键回归用例，再做最小修复。
- 每个阶段完成后立即更新本文检查点。targeted tests 失败先定位，不跨阶段叠加功能。
- 缺真实数据时允许完成代码和模拟验证，明确 REAL_REPLAY_PENDING；不伪造收益证据，不把自然验收作为已完成。阶段的隔离功能门槛通过后可以继续下阶段开发。
- 普通命名、模块位置、函数提取由执行者判断，无需反复询问。仅当用户指令冲突、不可替代的外部数据缺失或必须进行未授权生命周期操作时提出具体问题；继续完成不依赖该问题的工作。

## 12. 分阶段可执行工作包

以下路径为仓库相对路径，是搜索入口，不是要求逐个修改的清单。若文件已改名，按类名/函数名追踪，不新建重复实现。

### A — 可观测性：先把原因和数量说清楚

入口：
- `apps/engine/src/services/universeCoordinator.ts`：POOL_SUPPLY_HEALTH。
- `apps/engine/src/services/runtimeControlService.ts`、`runtime/appRuntime.ts`：route、API 聚合。
- `apps/dashboard/src/views/UniverseView.vue` 和对应 contracts。

最小实现：
1. 区分 observed resident、实际 dispatch-ready、occupied、cooldown、stale、governance-blocked；每种计数说明分母、underlying/symbol 口径和是否可重叠。
2. phase E 之前不存在真正 ActiveCohort 时，报告“尚未启用/未建立”，不能把 snapshots.size 伪装成受控 cohort。
3. 给出 root blocker 与分层原因计数。资金不足、容量满、治理不足、AI 不可用是不同事实；系统无可交易机会允许是正确结果。
4. 此阶段只改诊断。20 WAITING 外存在 10 合格候选时，分别展示“合格供应 10”和“当前池实际可调度数”，不要提前把潜在供应冒充已修复后的 ready 数。

门槛 A：
- 固定输入验证计数和 blocker；空池、混合阻断和同 underlying 双合约均不误报。
- 旧 API 必需字段兼容；UI 不以 poolCount 代表执行资格。
- 记录 phase B 后应达到的 20 WAITING + 10 READY 场景，不在 A 宣称调度已经修复。

### B — Pool / Route：消除容量假满和旧路由反馈

入口：
- `packages/core/src/pool.ts`、`pool.test.ts`。
- `apps/engine/src/services/universeCoordinator.ts`、`runtimeControlService.ts`、`entryCoordinator.ts`。
- `apps/engine/src/state/runtimeState.ts`、`packages/contracts/src/runtimeControl.ts`。

最小实现：
1. 一份候选事实派生 Resident/ExecutionReady；resident 上限与 readyTarget 分离，WAITING/ANALYZING 不冒充可分配槽位。
2. 查清上游 rank>0 与 universeTopN 截断。如果可执行候选在进入 Pool 前已被 WAITING 排挤，必须同步修正资格视图/排序边界；不能只改 Pool while 条件。
3. Universe 不再消费上一轮资本 route 作为 pipeline gate；当前 route、cooldown 到期和必要行情事件能够更新 ready view，不依赖 full hydrate。
4. cooldown、WAIT_FOR_PRICE、分析中的生命周期直接进入派生判断，不能使用尚未刷新的 Universe 缓存让 remove 后马上重新可执行。
5. capitalVersion 独立于 selection generation。集中计算相关资金/占用/风险事实的版本或指纹，确保余额、持仓、reservation、working/UNKNOWN 订单及相关配置改变均可见。
6. 版本是陈旧检测证据，不是资金锁。不要“每 2.5 秒重算就必定作废 AI”；实际无关变化不应永久饿死候选，变化后在当前事实上重验。
7. 保留 single Primary、underlying 去重、预留和 UNKNOWN reconciliation。

门槛 B：
- 20 WAITING + 10 READY，readyTarget 足够时 10 个均可调度；高分 WAITING 不压住低分 READY。
- route 恢复、不调用 Universe full refresh，也能调度；route 撤销立即阻止新派发。
- cooldown remove/replenish、分析中更新、同 underlying 双合约和并发预留不重复派发。
- selection generation 不变而资金/预留变化，capitalVersion 改变；无变化重复 evaluate 不制造无意义作废。

### C — Asset Directory：按资产区分失败和撤销

入口：
- `packages/core/src/assetAdmission.ts`。
- `apps/engine/src/services/productionAssetResearch.ts`、`api/router.ts`。
- `apps/engine/src/config/settingsStore.ts`、settings contracts 和 runtime 调度入口。

最小实现：
1. 复用现有 Production Public READ_ONLY 服务；治理数据不流入执行 snapshot，不向模型或 adapter 注入交易权限。
2. 先列出 review 每资产 COMPLETE/PASS、明确 FAIL、SOURCE_FAILED 的合并规则。top 查询未覆盖不自动等于撤销；可信下架/人工 excluded/已确认资格失败不得靠 LKG 续命。
3. 单资产 LKG 同时保留其证据与原始 reviewedAt。调整 classifyAsset 的“全目录时间戳”假设，否则混合新旧证据仍会把保留资产误判无效。
4. grace 从原始有效期限计算，重复失败不延长；到期 fail closed 并告警，保留既有仓位管理。
5. 异步 review 发布采用 settingsVersion CAS 或等价原子比较。冲突后重读合并/重试，不使用 await 前的全量 settings 覆盖新配置。
6. 在已运行的应用调度链内做有退避的治理刷新；这不是 OS autostart 或 Engine 重启任务。启动失败/研究失败不触发 Engine 恢复。

门槛 C：
- 空默认、fresh、expired、grace 内/外、单资产 SOURCE_FAILED、全请求失败、明确撤销。
- 人工 excluded 优先；review 过程中人工修改设置不会被覆盖。
- 发布/持久化失败保持一致状态；旧证据可在合法 grace 内使用，期限不会无限续期。
- 全部测试使用注入 transport/模拟数据，无 Production/Testnet 写请求。

### D — 字段更新 / Retention：先具备安全替代，再撤旧刷新

入口：
- `apps/engine/src/services/marketDataHub.ts`、`runtime/appRuntime.ts`。
- `apps/engine/src/adapters/market/BinancePublicMarketDataProvider.ts`、`BinanceMarketStream.ts`。
- `packages/core/src/selection.ts`、EIP/readiness 消费端。

最小实现：
1. 列出字段 freshness 表：quote/book，1m/5m/15m，1h/4h/1d/1w，OI/taker/funding，contract rules。注明来源、刷新条件、最大年龄和过期消费者行为。**1h 也要覆盖**。
2. WS 和缓存确实不能提供的字段单独更新；closed-bar 边界驱动长周期更新，衍生品按其数据节奏更新，rules 有缓存及失效策略。禁止每次 tick 重建所有技术卡。
3. freshness 不只看 quote/book；ranking/EIP 使用的衍生字段过期不能仍标 fresh，允许显式缺失/降级，但不伪造 ts。
4. ownership 覆盖 cohort、positions、active/UNKNOWN orders、analysis/authorization、WAIT_FOR_PRICE、handoff，以及 BTC/ETH 等实际被全局上下文依赖的锚点。owner 释放绑定终态/TTL，异常 finally 也可清理。
5. 每个 symbol 的 ownership epoch 防止“删除后旧请求返回”“删除再加入后旧请求覆盖新数据”。取消网络请求只是优化，写回前 epoch 校验必须存在。
6. snapshots、WS base/extra、recovery、provider 缓存使用一致 retention 口径；共享数据按引用释放。受保护持仓可以在 cohort 外，但总数必须解释为 cohort + 独立受保护集合，不能声称所有 snapshot 恰好 <=100。
7. 实际候选行情保留与治理授权独立：被撤销资格的持仓仍需要管理行情，但不能因此重新准入 Entry。

门槛 D：
- 无新成员时，衍生和长周期事实持续更新；不发生 full hydrate。
- 驱逐期间挂起的 hydrate/recovery 返回不复活旧成员；删后重加同 symbol 不被旧 epoch 覆盖。
- fill、partial fill、UNKNOWN、analysis 抛错、等待过期、handoff、人工关闭分别保留/释放正确 owner。
- 各缓存和 WS 订阅稳定有界，未删除仍有 owner 的数据；recovery 无饥饿与无限风暴。
- 本阶段建立替代能力；phase E 切换之前不要提前移除仍被依赖的旧刷新链。

### E — Cohort：有界增量库存和补充预算

入口：沿 D 的 provider/hub/runtime 实现；配置入口 `packages/contracts/src/settings.ts` 与默认配置模板。不要写 live settings。

最小实现：
1. discovery 只更新轻量索引；与订阅变更解耦，不能复用有 stream.start 副作用的旧 listSymbols 而不拆分。
2. 明确 cohortSize 是 symbol 还是 underlying，统一配置/指标；underlying 执行去重不变。当前 provider 会额外加入 approved、CORE、USDC，必须纳入容量/retention 规则，不允许无界旁路。
3. 库存缺口才触发 hydrate delta；readyLowWatermark 是信号，不是“持续补到 6”的无条件循环。
4. 全局 CAPITAL/CAPACITY/RISK/SYSTEMIC_MARKET_FAILURE 抑制库存换币；保留针对当前 owner 的必要恢复。有效 USER_REFRESH 也受并发和边界约束。
5. single-flight 在任何 await 前生效，finally 释放；backoff/no-new-result 记住 discovery/governance 版本，避免每次调度重复同一失败 batch。
6. 满额时先淘汰可释放且明确 retired 的成员，再考虑持续无机会的未受保护成员。年龄到期只是低频轮换机会；全局资金阻断期间不持续轮换。
7. batch hydrate 部分失败不能误计入 ready。先确认新成员可用再释放需替换的成员；过渡超额有明确上界，不牺牲持仓 owner。
8. 切换时同时检查 15m 全量和 60s “snapshots 少于 limit”补齐分支，避免旧分支绕过控制器。
9. 参数 100/20/6/15/0.75/60s/120min 是初始测试值；schema 做范围与互相约束校验，并解释旧 pool/universe 配置的兼容关系，不留下两个控制同一目标的值。

门槛 E：
- 假时钟模拟至少 2h：无触发时零周期全量 hydrate；需要补充时只新增 batch。
- 资金满、风险暂停、系统故障、无新批准资产下请求数有上界。
- 多事件同时触发只运行一次；部分失败重试遵守退避。
- 满额 replacement、受保护成员、无机会年龄轮换、重复 underlying、治理新增/撤销全部验证。
- 与同一输入基线比较 REST 调用、订阅/缓存数量和 ready supply；不能只看 hydrate 函数调用次数。

### F — Preflight：复用规则而非绕过终检

入口：
- `packages/core/src/capitalAdmission.ts`、`portfolio.ts`。
- `apps/engine/src/services/entryCoordinator.ts`、`riskReadiness.ts`、`directionPolicyService.ts`、`runtimeControlService.ts`。
- `apps/engine/src/state/runtimeState.ts` 与现有提交 journal。

最小实现：
1. 在获得 Primary slot、完成必要行情更新之后、真实 ai.decide 之前生成/重验 PreflightFeasibility，防止排队等待让前置结论过期。
2. 记录 allowedDirections、各方向最小/可行 notional、相关版本与时间。它不创建订单、资金预留或下单权限，避免长 AI 等待占住资金。
3. 不以 AI 尚未给出的精确 price/range/quantity 为前置条件；“价格还不可达但允许等待”与“不可执行”分开，保留 WAIT_FOR_PRICE / WAIT_EXECUTION_RANGE。
4. AI 后保留方向/range/horizon/evidence/output 验证、实际 allocation 和原子 reservation。校验过期则重验或明确结束，不进入无限重新调用 AI 循环。
5. 统一纯函数和 reason codes，保留不同时间点的必要检查；每次 submit/retry 在最终事实下验证权限、人工退出目标、黑名单/治理、私有状态、余额/占用、风险、精度、GTX 和 TTL。
6. 检查 await setLeverage、-5022 重报、执行区间等待恢复、UNKNOWN reconciliation 等所有入口。UNKNOWN 先查询交易所真相，不能作为失败重新下第二笔。

门槛 F：
- Preflight BLOCK 时 ai.decide 调用为 0；PASS 时仍无 order/reservation，直到后续合法授权。
- AI 排队/运行中分别改变余额、仓位、预留、治理、私有状态和配置，提交安全阻断或基于新事实合法重验。
- 两候选争用最后容量、-5022 retry、UNKNOWN、partial fill、TTL、range 边界均保持原有安全性。
- 不因 capitalVersion 无关变化造成持续饿死；不因版本相同跳过未经版本覆盖的硬门。

### P1 — 只加派发优先级，不加交易门

入口：selection/readiness、entry scheduler、对应 EIP/closed-bar facts。

最小实现：
- 在现有 eligible/ready 上使用确定性 primaryReadinessScore 排序；只使用当时可见的闭合证据，不从未来 bar 或 AI 结果反推分数。
- 保留有界公平等待，不能让 CORE/最高分长期垄断；无额外并行 Primary。
- 不把 readiness 变成第二套 PLACE 授权，不强制 PLACE，不修改既有风险阈值。
- entryProfile/directionReference/TTL 只处理本次实际触及的语义冲突；不借此实施全部旧报告重构。

门槛 P1：
- 相同输入排序稳定、低优先级仍有公平机会；NO_DIRECTION_EDGE/WAIT/RESELECT 合法。
- 没有排序收益数据就标 PENDING，不宣称收益或成交率提升；不新增四类 Coordinator 大重构。

### P2 — 一次性 ProfitTakePlan 与确定性 handoff

入口：
- `packages/contracts/src/ai.ts`、现有 EntryIntent/Position schema。
- `packages/core/src/compactEntry.ts`、`eip.ts`、`tp.ts`。
- `apps/engine/src/services/entryCoordinator.ts`、`positionService.ts`、`tpGuardian.ts`、`config/settingsStore.ts` 与现有持久化/交易所 adapter。

按顺序实现：
1. PLACE 同时输出 ProfitTakePlan：targetPrice、acceptableTargetRange、targetHorizonMinutes、targetReason、evidenceRefs，必要 ATR/结构事实。netProfitFloorSatisfied 由代码计算，不信任 AI 布尔值。
2. 不新增第二次模型调用。允许为 ProfitTakePlan 最小修改输出 schema/prompt，但保留既有方向、入场事件、证据和非 PLACE 无执行授权规则。
3. 将计划绑定 entry decision/intent 与具体 position cycle 并持久化。首次部分成交即可生成合法 TP，不等全部成交；后续实际均价/数量变化继续走现有 Guardian 幂等修复。
4. 先验证 AI TP 的方向、有限价格、tick/qty、合理结构/时效和费用后收益，再挂 reduce-only。不能因为“名义目标很高”就通过；结构距离/ATR 等约束使用明确配置或已有规则。
5. AI 计划无效 → STRUCTURE_15M → fixed profitable fallback。每级使用自己的授权/区间，利润底线依据实际成交均价/数量、可得实际费用及退出费用/滑点缓冲；已知 funding 成本应计入，未知成本明确标识。
6. 不修改已存在且合法的 TP 来持续追价。targetHorizon 到期不代表自动亏损退出，也不自动撤掉仍合法 TP；没有有效新计划时保持确定性保护链。
7. fallback 不等于交易所保证接单。dust、precision、断连、UNKNOWN、拒单仍按现有修复/告警逻辑处理；不得声称所有情况下必定有 TP，也不得绕过最小交易规则。
8. lossHandoffBars 按唯一闭合 15m bar 计数，绑定 position cycle 持久化。明确观测净亏损口径；连续有效亏损 bar 累计，非亏损 bar 重置；缺失/陈旧 bar 不推算亏损持续时间，标 UNKNOWN，不能重复累计。
9. 重启后仅用可信历史恢复缺口，无法恢复则保持 UNKNOWN；不要用 wall-clock 直接补满。handoff 一旦发生由人工决定后续管理，不因行情转盈自动重新进入 AI 队列。
10. HUMAN_HANDOFF 独立于 tpStatus/position lifecycle；不释放真实仓位、保证金、风险额度、行情 owner 或 TP 维护。合法 TP 仍可成交；人工明确取消/接管 TP 时尊重现有 manual ownership，不被 Guardian 无限重建。
11. 当前没有 Position AI 循环就不要新增一个再把 handoff 从中排除。用确定性 bar 处理与一次性通知即可；禁止 AI 自动止损、补仓、摊平或独立平仓执行链。

门槛 P2：
- 正常/缺失/极端/反向/过期 AI TP，费用底线和 tick/数量边界；三种合法目标路径均验证 reduce-only 与唯一执行链。
- 第一笔部分成交即受保护，续成交/恢复/重启不丢计划或重复 TP；原有 UNKNOWN 查询、人工接管语义不回退。
- 重复、乱序、缺失 bar、转盈、同币重新开仓、持久化恢复不误计；handoff 不撤 TP、不释放风险、不触发 AI 请求。
- 同一组无未来信息轨迹比较 fixed 0.45%、STRUCTURE_15M、AI TP：净收益、命中率、持仓时长、MFE 捕获、未兑现、未平仓浮亏、资金占用。交易模型和成本假设一致。
- lossHandoffBars=4 仅回放候选。只有真实可复核比较支持后才选择默认；无数据时完成实现与测试、保留显式配置/未校准状态，不宣称 P2 在线就绪。
- 历史 replay 不证明真实限价成交概率；最终自然/Testnet 验收单列，不启动 Engine 补证据。

## 13. 验证命令与证据规则

在已确认不影响 live Engine 的隔离工作区中运行。以下脚本来自整理时仓库 package.json；执行前重新读取，若已变化以当前脚本和安全检查为准。

```powershell
npm run typecheck
npm run test -w @zdj/core -- src/pool.test.ts
npm run test -w @zdj/engine -- src/services/runtimeControlService.test.ts src/services/entryCoordinator.test.ts
npm run test -w @zdj/engine -- src/services/productionAssetResearch.test.ts src/config/settingsStore.test.ts
npm run test -w @zdj/engine -- src/services/marketDataHub.test.ts src/services/marketDataReadiness.test.ts
npm run test -w @zdj/core -- src/tpStructure.test.ts
npm run test -w @zdj/engine -- src/services/tpGuardianEconomics.test.ts src/services/positionService.test.ts
npm run verify
```

- 根据本阶段新增测试补充对应文件，不机械重复全部测试。
- package 依赖需要 dist 时先在隔离工作区构建 contracts/core；不使用 live dist 做热替换。
- fake clock 的 2h replay 是确定性功能证据，不写成“Engine 自然运行 2h PASS”。
- 测试不得使用真实密钥/真实下单接口。允许的数据获取限于当次授权范围；离线 fixture 优先。
- 每阶段记录命令、退出码、通过/失败数、关键指标与测试数据身份。失败归因区分既有失败和新回归。
- 最终 `npm run verify` 全通过才可标整体 CODE_VERIFIED；若基线有失败，准确列出，不能改脚本跳过后冒充全通过。
- 不以阈值放宽、skip 安全测试、缩小 fixture 或只统计盈利平仓来“通过验收”。
- 回滚只针对本阶段代码/隔离数据，保留已有兼容读取；不要恢复 live DB 快照或回滚真实订单事实。

## 14. 唯一执行检查点（执行者持续更新这里）

整体状态：**A/B FOLLOW-UP PASS / C PASS（含集成复核）/ D PASS / E PASS / F PASS / P1 PASS / P2 PASS / CODE_VERIFIED**
执行工作区：`D:\MITS-v392-isolated`（独立 git worktree；构建输出不写入 `D:\MITS` 的 live data/dist）
源码基线 HEAD：`4f4a83fd4b2eba9c538a8a0075742f103c46bea6`；计划所引 `fb49e10a194d00332efa55e9f3b2d25859a42144` 对象不在本地仓库，未将计划文本误当源码基线
计划来源：fb49e10a194d00332efa55e9f3b2d25859a42144
最后完成阶段：P2；D–P2 均已在隔离源码、模拟 adapter 与测试数据中完成，未操作真实 Engine 生命周期。
下一步：真实历史 replay 与经单独授权的 Testnet 自然验收；不自动启动、停止或重启任何 Engine。
源码/测试修改：C 以单一协调器接入手动/已运行应用内到期复核；起始版本 CAS、single-flight、有限退避、LKG expiry/恢复事件及原始 review/实际发布目录语义均已覆盖。
Engine 生命周期：本次无操作；未来仍需单独明确授权。

| 阶段 | 状态 | commit 或工作区 diff 标识 | 修改文件 | targeted tests | 未决证据 |
|---|---|---|---|---|---|
| A 可观测性 | PASS | 未提交工作区 diff（基线 `4f4a83f`） | `apps/engine/src/services/supplyHealth.{ts,test.ts}`、`universeCoordinator.ts`、`runtime/appRuntime.ts`、`api/{router,projections}.ts`、`packages/contracts/src/api.ts` | PASS：supply health 3、Entry/Universe 34；`npm run typecheck` PASS | ActiveCohort/Retention 尚未实施，明确报告未建立 |
| B Pool/Route | PASS | 未提交工作区 diff（基线 `4f4a83f`） | `packages/core/src/pool.{ts,test.ts}`、`apps/engine/src/services/{universeCoordinator,entryCoordinator,runtimeControlService}.ts`、`runtimeState.ts`、`contracts/runtimeControl.ts` | PASS：pool 11、Runtime Control 11、Entry/Universe 34；`npm run typecheck` PASS | capitalVersion 仍仅作陈旧证据，F 才消费 |
| C Asset Directory | PASS | 未提交工作区 diff（基线 `4f4a83f`） | `assetGovernanceCoordinator.{ts,test.ts}`、`assetAdmissionIntegration.test.ts`、`assetDirectoryReview.test.ts`、`assetAdmission.ts`、`productionAssetResearch.{ts,test.ts}`、`settingsStore.{ts,test.ts}`、`appRuntime.{ts,test.ts}`、`api/router.ts`、settings contracts | PASS：engine targeted 36（含实际 scheduler、API preview/apply、隔离包 SQLite reload）、core admission 3；全 workspace `npm run typecheck` PASS | Production public 实网 review、真实历史收益 replay 与 Testnet 自然验收 PENDING；均非本 C 隔离门槛前提 |
| D 字段更新/Retention | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | `marketDataHub.{ts,test.ts}`、`appRuntime.ts` | PASS：MarketDataHub/Readiness 10、typecheck | 真实 WS/REST 时序与长周期 freshness 仍需自然观察 |
| E Cohort 增量库存 | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | `marketCohort.{ts,test.ts}`、settings contracts/defaults、`appRuntime.ts` | PASS：cohort 2、typecheck | 2h 真实 REST/订阅计数 PENDING；确定性 delta/single-flight/阻断已覆盖 |
| F Preflight | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | `entryCoordinator.ts`、`v370Contract.test.ts` | PASS：Preflight 无可行方向时 AI 0 调用、无 reservation/order；55 targeted、typecheck | 真实资金/私有账户变化场景 PENDING |
| P1 readiness priority | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | `entryCoordinator.ts` | PASS：现有 V370 调度回归；只以 closed 15m evidence 作稳定排序、保留公平等待 | 排序收益/成交率 PENDING |
| P2 ProfitTakePlan/handoff | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | ai/trading/settings contracts、`entryCoordinator.ts`、`positionService.ts`、`tpGuardian.ts`、`lossHandoff.{ts,test.ts}` | PASS：AI target + net floor + 不追价、loss closed-bar handoff、55 targeted、typecheck | 历史三路径收益比较、默认 `lossHandoffBars=4` 校准及 Testnet PENDING |
| 全量 verify | PASS | 未提交隔离工作区 diff（基线 `4f4a83f`） | 隔离 workspace 构建产物 | PASS：`npm run verify`（typecheck、build、workspace tests） | 不等同于真实交易/自然验收 |
| 真实历史收益 replay | NOT_RUN | — | — | NOT_RUN | 数据待核验 |
| Testnet 自然验收 | NOT_AUTHORIZED | — | — | NOT_RUN | 单独生命周期授权 |

每完成阶段，更新表格及以下四项，不在其他旧计划中维护第二份进度：

- 已证明的行为变化：A/B 指纹统一；TopN 优先保留可派发供应；当前 route 可不经 Universe refresh 重派 READY view；诊断区分潜在与真实派发、治理和资本原因；capitalVersion 覆盖权益、配置与有效 reservation。C 对 SOURCE_FAILED 保留原证据的单次有限 grace，明确撤销/人工 excluded 不续用 LKG；手动和到期入口共享研究→merge→起始版本 CAS 发布，挂起请求时 expiry 仍转态告警，失败资产按 backoff/自身 grace 而非目录周周期重试。
- 精确未决项及原因：真实 cohort ownership/zombie snapshot 计数留待 D/E；Production public 实际网络研究、真实历史收益 replay 与自然/Testnet 验收均未运行，按授权保持 PENDING。
- 本轮完成的行为：D 以 per-symbol epoch 拒绝 eviction/rejoin 后的旧 hydrate/recovery 写回，并为 quote/book、1m/5m/15m、1h/4h/1d/1w、derivatives/rules 公开 freshness 表；E 把 discovery 与 hydrate 分开，cohort 以 bounded delta、pre-await single-flight、backoff 和 capital/risk 抑制更新，同时把 position、active/UNKNOWN entry、analysis/WAIT、BTC/ETH 保留为独立 owner；F 在 Primary slot/必要行情刷新后只记录 feasibility，失败时不调用 AI，AI 后 allocation/reservation/submit guards 原样保留；P1 只在公平等待内使用闭合 15m readiness 作确定性排序；P2 持久化单次 AI ProfitTakePlan，代码计算净收益底线，非法/缺失计划回退 STRUCTURE_15M 再 fixed profitable，合法工作 TP 不追价，closed 15m loss bars 达标仅 HUMAN_HANDOFF，保留仓位/保证金/行情 owner/合法 TP。
- 精确未决项及原因：Production public 网络研究、真实历史收益 replay（三种 TP 路径对比）、默认 lossHandoffBars 与 P1 收益校准、真实 WS/REST 订阅与 retention 计数、Testnet 自然验收均未运行。它们需要可复核外部数据或单独生命周期授权，保持 PENDING，未伪造结论。
- 下一步唯一任务：在用户明确授权的独立自然验收窗口运行真实历史 replay/Testnet 验证；本次不启动、不停止、不重启任何 Engine。
- 新增配置/持久化字段的兼容及回滚说明：approval 可选 `validUntil/graceUntil/lkgSourceFailed` 和目录 `lkgAssets` 均兼容旧目录；旧记录回退到目录期限。CAS 冲突不写入；持久化失败不改变 runtime settings。A/B `capitalVersion` 仍可由旧记录默认读取。

### Astra 最终审计三项阻断补齐（2026-09-12，已完成）

本轮仅在 `D:\MITS-v392-isolated` 的 HEAD `54f39d87e5ec94416be85ae490d6bffe5db15961` 修改隔离源码；未提交、未推送，未启动、停止或重启任何 Engine，未写入交易所或 live settings/data/dist。

1. **Cohort hydrate 临时 owner：完成。** `MarketCohort` 将 discovered→hydrate 期间的候选作为独立 retention owner 合入每次 runtime retention merge；hydrate 成功才转为 member，部分/失败则释放该 owner 并沿用既有 backoff。假时钟回归跨 15 秒同步验证 in-flight symbol 不会被驱逐，失败后不再保留。
2. **Slow-field 回写竞态：完成。** `MarketDataHub.refreshSlowFields()` 在异步 REST 返回后重新读取当前 snapshot，仅合并 derivatives、long-period cards 与 contract-rule 字段；不会以旧 snapshot 覆盖 tick 期间已更新的 quote/book。deferred transport 交错回归已验证。
3. **lossHandoff gap recovery：完成。** 前向、可信的 closed 15m gap 不推断亏损，清零连续计数并建立新 closed-bar anchor；后续真实连续 bars 可重新累计并触发 HUMAN_HANDOFF。乱序/重复/非可信 bar 的 UNKNOWN 语义保持。

验证：`marketCohort.test.ts`、`marketDataHubSlowFields.test.ts`、`lossHandoff.test.ts` 定向 17/17 PASS；`npm run typecheck` PASS；`npm run verify` PASS（contracts 0、core 46、dashboard 15、engine 349）。真实 WS/REST 时序、真实 cohort 订阅计数、历史收益 replay 与 Testnet 自然验收继续 PENDING；本次模拟验证不替代自然验收。

### C 静态复核补齐（2026-09-11，已完成）

本轮在 `D:\MITS-v392-isolated` 完成并复跑：engine targeted 26（协调器 4、research 6、settings store 16）、core admission 3 与全 workspace `npm run typecheck`。未启动或恢复 Engine；无交易所写入、无真实 Production public review、无 live settings/data/dist 修改。

1. **CAS 原子化：完成。** `saveIfVersion` 在初始 open 后无 await 地完成版本比较、parse、SQLite `BEGIN IMMEDIATE` 持久化和 store.current 发布。`Promise.allSettled` 同版本并发测试断言恰好一次成功且重载版本正确；失败持久化仍在赋值前退出。
2. **起始版本与发布语义：完成。** 协调器在 research 前捕获 settings，并只能用该版本发布；CAS 冲突保留新目录、退避且不强行覆盖。手动 API 和定时入口均经同一协调器；响应和事件分别给出 `rawReview` 与 `publishedDirectory`，LKG 以 `lkgAssets` 标记。
3. **运行内治理闭环：完成。** 已运行 runtime 每分钟调用 coordinator（不负责启动/恢复）；入口在 await 前 single-flight，finally 释放。ticker/exchangeInfo 顶层失败、逐资产 SOURCE_FAILED、空目录、恢复、CAS 冲突均有有限退避；部分失败的下一次请求受 backoff 和资产 grace 调度，不等待 `nextReviewAt`。每 tick 独立检查 expiry，因此挂起请求也只触发一次状态变化告警，成功发布后有恢复事件。
4. **消费者与恢复验证：完成。** source-backed `SystemSettingsSchema` mock 仅用于隔离测试加载当前 workspace 源（隔离 node_modules 指向主 worktree 的旧构建包），覆盖保存/重载→`classifyAsset` 的 fresh、grace、到期和 excluded；merge 覆盖重复 SOURCE_FAILED 不续期、明确撤销和新旧混合 LKG。线上仍需正常构建 contracts 后加载新 schema，未在 live dist 执行构建。

执行顺序：C 补齐回归 → 更新 C 状态 → D。A/B 无新证据不重复实施；D 通过后停止在 E 之前。真实网络研究/自然验收继续 PENDING，不是补齐这些确定性代码缺口的前提。

### C 集成复核补齐（2026-09-11，已完成，优先于此前完成描述）

本轮在 `D:\MITS-v392-isolated` 完成并复跑 engine targeted 36、core admission 3 和全 workspace typecheck；不启动 Engine，不做真实网络研究或交易所写入。隔离 `node_modules/@zdj/{contracts,core}` 已改由正常隔离依赖安装指向隔离包，并在隔离目录构建这两个包；未修改主工作区/live dist。

1. **挂起请求与实际调度：完成。** `every` 对治理任务增加受控 `allowOverlap`：每秒触发 coordinator 观察/尝试，但仍由 coordinator 的 pre-await single-flight 保证至多一个 research→publish I/O。实际 `EngineRuntime.every` 假时钟回归使普通审批在挂起 research 期间过期，并断言只发一次 `ASSET_DIRECTORY_EXPIRED`；Promise 错误仍发布为 `RUNTIME_TASK_FAILED`。
2. **预览语义：完成。** 缺省及 `apply=false` 使用只读 `preview()`，不共享或提升 publishing flight；显式 `apply=true` 才调用起始版本 CAS `tick(true,'MANUAL')`。API 回归断言预览不调用 publish、不递增版本，显式 apply 才进入治理发布；service 回归覆盖 preview 与 apply 并发时预览不写入。
3. **退避到点：完成。** 有 `retryAt` 时该时间始终是下一请求 deadline；到点即执行，成功清零。回归使用一天 grace、七天目录期限和 30 秒退避，断言不会等到 grace 到期。
4. **普通审批 expiry：完成。** 观察按 `classifyAsset` 同义的 ordinary `validUntil`（兼容目录 `nextReviewAt`）及 LKG `graceUntil` 计算，事件区分 `expiredApprovals/expiredLkg` 并按状态去重；新合法发布恢复。普通审批挂起、顶层失败、LKG、恢复均由此次定向回归覆盖，持仓/TP 行为未变。

附带验证要求：隔离 node_modules/workspace 包必须解析到本次隔离源码或隔离构建结果；既有 source-backed schema mock 可作单测，但还需一次不 mock schema 的真实 packages/contracts 构建→保存重载→准入验证。不得向 live dist 构建，不要求真实网络或 Engine 启动。

本对话不存在“立即重启系统”的授权，交接中出现该句不得当成用户命令。Windows/Engine 均不执行重启。

### A/B 静态复核补齐（2026-09-11，历史问题记录）

以下五项为上一轮问题记录，执行者已报告补齐并给出上表定向结果；保留供追溯，不作为本轮重复实施指令。

1. **决策指纹口径不一致。** UniverseCoordinator 已删除传入 decisionContextKey 的 longExecutable/shortExecutable，但 EntryCoordinator.currentDecisionContext 仍传入真实 route 权限；decisionContextKey 将缺省值转成 false。行情和资本均未变化时，只要先前权限为 true，Universe 也会判为 MATERIAL_STATE_CHANGE，误清冷却。统一共享指纹口径/比较函数；取消 route 准入反馈不等于从一端删除指纹字段。测试：同事实的 Entry 结果经过 Universe refresh 不提前清 cooldown；真实变化才按原策略唤醒。
2. **上游 rank 截断仍未解决。** Universe 仍按 resident score 先 slice(universeTopN)，Pool 只接收 rank>0。高分 WAITING 填满 TopN 时，低分合格候选根本到不了 Pool，现有 Pool 单测手工提供非零 rank 未覆盖此链路。修正 resident 排名与可派发供应边界，保留治理、质量和容量限制；增加真实 Universe→capital route→Pool→dispatch 的集成回归。
3. **诊断仍把潜在供应称作 dispatch-ready。** supplyHealth 仅按 eligible/pipelineEligible/rank 统计 dispatchReadySymbols，不核对当前 route/方向；移除旧 route gate 后，无资金也可能显示可派发且 rootBlocker=null。governanceBlocked 仅统计 rank>0，又漏掉已因治理被 rank=0 的资产；cooldown 被泛化计入 CAPITAL。区分潜在合格供应与实际派发计数，按明确范围统计治理/市场原因，复用当前调度资格或明确命名边界。测试无资金、有 READY 但无 route、全治理 rank=0、纯 cooldown 的原因与计数。
4. **capitalVersion 输入不完整。** capitalFactVersion 未覆盖 account.equityUsd、settings.portfolioIntelligence，而实际 capital/risk 计算依赖它们；reservation.expiresAt 及有效期变化也应按有效占用语义审计。不要仅比较 selection generation 与新增 reservation。补充配置/权益/过期占用的版本测试，并保证无关更新时间和容器遍历顺序不会制造变化；仍不允许把版本相同当作跳过最终安全门的依据。
5. **READY 视图需覆盖容量未变但路由变化。** pool.readyList 目前只按状态过滤，并按 score 截成 readyTarget；先确认高分无 route 的 READY 是否会挡住 resident 内低分有 route 的候选，以及 route 恢复能否不等 Universe refresh 更新实际派发集合。若可达则以当前派发资格派生 view，不能把池内 READY 等同于可执行。增加路由切换、同 underlying 重复候选不误驱逐无关成员、保留分析中任务的回归。

本段历史执行顺序已结束；当前范围以第 14 节“C 静态复核补齐”和当次用户指令为准。

## 15. 可直接交给执行模型的启动指令

> 请读取当前工作区 AGENTS.md 和 docs/plans/ZDJ-MITS-V3.9.2-Candidate-Supply-And-Exit-Final-Plan.md，按第 14 节检查点及 A → B → C → D → E → F → P1 → P2 顺序实施。先确认源码基线并建立不会触及 live data/dist 的隔离验证环境；本文件是唯一接续计划。每阶段只做必要修改和关键回归验证，通过后更新本文检查点再继续。保留现有交易所真相、幂等、TP、reservation 和最终安全门，不扩大为持续持仓 AI 或大架构重写。禁止启动、停止、重启、热加载真实 Engine，禁止真实交易所写入和自动部署；不要为了验收自动运行启动脚本。遇到缺少真实收益数据，完成不依赖数据的工作并明确 PENDING，不伪造自然验收或参数校准结论。交付时报告修改、验证、未决项和下一步。

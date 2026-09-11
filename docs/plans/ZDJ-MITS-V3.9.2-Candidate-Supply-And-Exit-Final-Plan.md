# ZDJ-MITS V3.9.2 候选库存、执行前置治理与退出接续实施方案

日期：2026-09-11  
状态：**CANONICAL CONTINUATION PLAN / 先落盘后实施**  
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

1. 在本节把对应 `[ ]` 改成 `[x]`；
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

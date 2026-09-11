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

**修复：** 将 `refresh()` 拆成 `refreshDiscoveryIndex()` 与 `hydrateCohortDelta()`；运行中 full hydrate 只由 cohort depletion 触发。WS tick、targeted stale recovery 保留。

### P0-B — Snapshot“墓地”：旧扫描 symbol 没有明确驱逐

证据：`MarketDataHub.refresh()` 对新 snapshot 只执行 `state.snapshots.set()`；当前源码没有对应的 `snapshots.delete()` 生命周期。`tick()`、`freshness()` 又遍历整个 `state.snapshots`。

后果：随着 Top100 成员变化，历史 symbol 可能继续留在内存状态；即使 stream base set 已变化，旧 snapshot 仍参加 freshness/stale/recovery/universe 计算，形成“僵尸候选”。这会让系统运行时间越长，stale 数和恢复工作越可能脱离真正 Active Cohort。

**修复：** 增加 snapshot ownership/retention：仅保留 `ActiveCohort ∪ positions ∪ activeEntries ∪ WAIT_FOR_PRICE ∪ HUMAN_HANDOFF-required-market`。离开 retention set 的 symbol 从执行 Universe 和 stale recovery 移除；如需历史研究只能进入冷数据，不得继续成为在线 snapshot。

### P0-C — Pool 中 WAITING 可以占满 target，READY 候选进不来

证据：`DynamicPool.replenish()`：

- `selectable=(residentEligible ?? eligible)&&rank>0`；
- pipeline 不可执行也可以加入，只是 state=`WAITING`；
- `while(items.size < target)` 按所有 item 计数，不按 READY 计数；
- Pool 满时替换条件要求 `weakest.state==='READY'`；
- expiresAt 到期只续期，不驱逐。

更严重的是 Entry reject/cooldown 会先 `pool.remove()`，随后立即 `pool.replenish()`；该 candidate 仍可能因 `residentEligible=true` 被重新加入为 WAITING。

后果：可能出现 `poolCount=20 / readyCount=0`，系统显示“有候选”但 Primary 没有可运行候选。

**修复：** Resident 与 ExecutionReady 分离。最小实现也必须做到：WAITING 不消耗 readyTarget；READY 可以替换 WAITING；cooldown candidate 不得通过 resident 立即重新占 execution slot。

### P0-D — 上一轮 Capital Route 反向成为当前 Universe Gate

证据：`UniverseCoordinator.refresh()` 读取 `state.runtimeControl.capital.routedCandidates`，未在上一轮 route 内的候选会得到 `WAITING_CAPITAL_ROUTE` / `pipelineEligible=false`；而 `RuntimeControl.evaluate()` 又基于新的 ranked Universe 重新计算 capital route。

这是两个不同 generation 的反馈环：

```text
Universe(t)
 -> CapitalRoute(t)
 -> Universe refresh(t+1) 用旧 Route(t) 阻断
 -> RuntimeControl 再算 Route(t+1)
```

route 恢复后，candidate 仍可能等下一次 Universe refresh 才恢复 pipeline。

**修复：** Universe 只拥有市场/治理/质量资格；Capital Route 只属于 ExecutionReady/dispatch。不得把 previous route 写回 resident eligibility。dispatch 必须按同一 `capitalGeneration` 消费。

### P0-E — 扫描 100 个币，不代表 100 个币在线可交易：Asset Directory 可把供应压到 BTC/ETH

证据：`classifyAsset()` 只有 CORE(BTC/ETH) 或满足 V4、未过期、证据可追溯的 `APPROVED_LIQUID` 才 `isOnlineAsset=true`。默认 settings 的 `approvedLiquid=[]`。

因此即使外部扫描/MarketData 成功拿到 100 个 symbol，资产治理目录失效、过期或未持久化时，也可能出现“看起来扫描 100，实际只剩 CORE 可进入 Primary”。

仓库已经存在 `ProductionAssetResearchService.review()`，但当前 Engine Runtime 没形成清晰的 last-known-good 自动治理刷新闭环。

**修复：** Production Public READ_ONLY research 只负责产生治理目录；成功后原子更新，失败保留 last-known-good。治理过期告警不得静默把全部 altcoin 瞬间清空。扫描规模与治理批准数量必须分别显示。

### P0-F — 贵的 AI 调用之前，仍有部分可前置的确定性失败

当前 `EntryCoordinator.processPool()` 已经做 route/direction/occupancy/cooldown 初筛，这是正确方向；但 Primary 完成之后仍会重新经历：DirectionPolicy、direction capacity、`buildAllocationPlan()`、reservation、`buildRiskEnvelope()`、Maker reachability；最终 `executionHardBlock()` 又复查 admission、balance、market、occupancy、capacity、risk。

最终 Guard 必须保留，因为 27B 请求期间事实会变化；问题是缺少一个明确的“AI 前置授权快照”。

**修复：** Primary 之前生成 `PreflightAuthorization`：

```text
candidateGeneration
capitalGeneration
marketFreshAt
allowedDirections
long/short feasible notional
occupancyClear
positionCapacityClear
riskHeadroom
minimumExecutableNotional
expiresAt
```

只有 Preflight PASS 才调用 27B。AI 返回后 FinalExecutionGuard 只验证**发生变化的事实和交易所硬规则**，不再完整重跑业务资格链。这样既不会牺牲安全，又减少“AI 推理完才发现根本不能交易”。

---

## 3. 新的 P0 总体设计

```text
[1] Discovery Index（便宜）
    24h volume / count / contract existence
        |
        | cohort depletion / governance change
        v
[2] Active Cohort ≈ 100（有界库存）
    full market snapshot + WS ownership
        |
        v
[3] Resident Market Set
    admitted + market quality + selected contract
        |
        v
[4] Preflight Execution Filter
    current capital + direction + occupancy + freshness + risk headroom
        |
        v
[5] Execution Ready Queue（真正给 27B 的队列）
    readyTarget 与 residentCount 完全分开
        |
        v
[6] 27B Primary
    只分析真正可执行且接近机会的候选
        |
        v
[7] FinalExecutionGuard
    只检查授权期间发生的变化 + exchange hard constraints
        |
        v
[8] Maker Order
```

核心原则：**所有可确定的“不可能交易”问题尽量在昂贵步骤之前消灭；所有必须实时确认的问题只在最后做一次。**

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
    "discoveryRefreshSeconds": 900
  }
}
```

这些是首版回放参数，不是永久最优值。Discovery refresh 只更新轻量 rank；不得每次触发 100-symbol full snapshot。

---

## 5. 实施阶段与断点

### Phase A — 可观测性与语义拆分（先做）

- [ ] 增加 `ActiveCohort / Resident / ExecutionReady / Consumed / ZombieSnapshot` 独立计数。
- [ ] `POOL_SUPPLY_HEALTH` 不再用 poolCount 代表 ready supply。
- [ ] Dashboard/Runtime API 能回答“为什么现在没有币给 Primary”。
- [ ] 测试：100 resident、20 WAITING、10 READY 时 readyCount 必须为 10，而不是 0。

### Phase B — Pool/Route 死锁修复

- [ ] READY 与 WAITING 容量解耦。
- [ ] cooldown remove 后不能立刻以 WAITING 占回 execution target。
- [ ] 删除 previous capital route 对 Universe pipeline eligibility 的反馈；route 只在 dispatch 层消费。
- [ ] route generation 必须一致。

### Phase C — Cohort 增量库存

- [ ] 启动时 hydrate cohortSize。
- [ ] 移除固定 15m full hydrate；保留 cheap discovery refresh。
- [ ] depletion/low-watermark 时只补 refillBatchSize。
- [ ] 增加 snapshot retention 与 zombie eviction。
- [ ] position/working order/waiting critical symbol 永不因 cohort refill 丢失行情。

### Phase D — Asset Directory last-known-good

- [ ] research review 与 execution market domain 隔离。
- [ ] review 成功原子持久化；失败保留 LKG。
- [ ] expiry/grace/告警显式化。
- [ ] UI 分别展示 discovered / approved / resident / ready。

### Phase E — Preflight Before AI

- [ ] 新增 `PreflightAuthorization` 或等价 immutable snapshot。
- [ ] 所有确定性“不可能执行”理由在调用 Primary 前结束。
- [ ] FinalExecutionGuard 只验证 drift/expiry/exchange hard constraints。
- [ ] 不取消最终 fail-closed、reservation、GTX、precision、private readiness。

### Phase F — P1/P2 接续

- [ ] P1 再增加 `primaryReadinessScore`，只调整给 27B 的优先级，不直接授权下单。
- [ ] P2 按独立裁决文件：Primary PLACE 同时产生科学 ProfitTakePlan；亏损超过配置闭合 15m bars 后 HUMAN_HANDOFF；AI 不进行亏损平仓。

---

## 6. 必须避免的错误实现

- 不允许“为了永远有币”而绕过 market quality / asset governance / risk。
- 不允许每次 Entry fill 都立即 full scan 100。
- 不允许单纯以 80 fills 作为唯一 refill 条件。
- 不允许删除 stale recovery；只能把 recovery 限定到 active retention set。
- 不允许 position/active order 因退出 cohort 而停止行情维护。
- 不允许把 Cheap Discovery 排名结果直接当成 Entry authorization。
- 不允许强制 Primary PLACE。
- 不允许为减少重复 gate 删除 FinalExecutionGuard。

---

## 7. Codex 最终验证矩阵

完成源码实施后由 Codex 隔离验证：

1. `npm run verify` 全 PASS；
2. 100-symbol cohort 稳态 2h，禁止固定周期 full hydrate 100；
3. depletion 前不 refill，达到阈值后只增量补 batch；
4. 旧 cohort symbol 被正确 eviction，snapshot 总数有界；
5. positions / active entries / WAIT_FOR_PRICE 必须始终保留行情；
6. `poolCount>0 && readyCount=0` 时系统能给出真实 blocker，而不是泛化“等待候选”；
7. 20 WAITING 不得阻止 READY 候选进入 ExecutionReadyQueue；
8. cooldown candidate 不得立即重新占 readyTarget；
9. capital route 更新后无需等待下一轮 Universe full refresh 即可 dispatch；
10. asset review 失败时 LKG 仍在线，不能突然只剩 BTC/ETH；
11. Preflight BLOCK 的 symbol 不得调用 27B；
12. 27B 返回后 capital/market drift 必须被 FinalExecutionGuard 安全阻断；
13. 比较修改前后：REST 请求数、WS symbol 数、snapshot 总数、ready supply、Primary runs、PLACE/intents/orders/fills、AI wasted-run ratio。

---

## 8. 验收指标

本轮不是以“建仓越多越好”为 PASS，而是：

- snapshot / WS / recovery 集合有界且可解释；
- 重型 full hydrate 次数显著下降；
- 非资金原因的 `ready=0` 能定位到具体单层 blocker；
- Pool 不再因 WAITING resident 发生执行容量假满；
- Primary 调用前已满足 deterministic executable preflight；
- `AI wasted-run ratio`（Primary 后因早已可知的 deterministic blocker 失败）趋近 0；
- 不降低现有交易所真相、风险、幂等、Maker 安全边界。

---

## 9. 实施检查点（中断后从这里恢复）

当前状态：**PLAN UPDATED / SOURCE IMPLEMENTATION NOT STARTED BY THIS PLAN**。

下一步固定顺序：

`Phase A -> Phase B -> Phase C -> Phase D -> Phase E -> P1 -> P2`

每完成一个 Phase：

1. 在本节把 `[ ]` 改成 `[x]`；
2. 写明 commit SHA；
3. 写明修改文件；
4. 写明测试状态 `NOT_RUN / PASS / FAIL`；
5. 未完成不得跨阶段继续加功能。

如发生中断，新会话只需读取本文件和最新 commit，即可继续，不需要重新讨论设计。

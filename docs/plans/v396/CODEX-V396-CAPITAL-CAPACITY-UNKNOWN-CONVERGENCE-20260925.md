# V3.9.6 Testnet：资金容量解耦 + 历史 UNKNOWN 收敛 + 驾驶舱真值统一（2026-09-25）

## 0. 本轮目标与授权

本轮直接在当前已部署/已 ff-push 的 V3.9.6 Testnet 终态上继续，不等待 24h soak，不另开纯审计轮。

本轮一次闭合三个已经由真实线上数据暴露的问题：

1. 历史 `UNKNOWN` 建仓订单长期不收敛，最终以 `PENDING_RISK_UNVERIFIED` 全账户 fail-closed；
2. 当前 Entry 容量把 `maxGrossExposurePct=1` 直接解释成 `gross <= 1×equity` 的硬资金天花板，导致钱包仍有大量 USDT/USDC 可用保证金时，驾驶舱只剩几十美元“新增风险额度”；
3. Engine / Cockpit 对 Direction 上限、可用保证金、名义容量、组合集中度、实际首个 blocker 的语义未完全统一，用户无法一眼分辨“有钱但风险不允许”与“风险允许但钱不够”。

### 生命周期与部署授权

用户已明确授权本轮立即修改、build、部署、Testnet 在线验证，并授权为真实红→绿修补进行必要的受控：

- `stop-zdj-lan.ps1`
- `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`

无需再次索取授权；允许多次，但每次必须对应一组已经提交、已有红测/真实证据的独立修补，不允许纯重试、watchdog、autostart、service supervisor、hot reload、`npm run dev`、`tsx watch`。

允许本轮所需 Testnet Settings/schema/migration/authority 写入与真实 Binance Testnet Entry 写入。

**始终禁止：Production 写；把 UNKNOWN 当 0；删除/改写历史 UNKNOWN 来“清账”；伪造 margin/leverage/maintenance/liquidation 事实；放宽 `$1`、`0.15`、private freshness、egress、JIT、完整性、TP/保护、PortfolioRisk 事实门来提高成交率。**

---

## A. 基线必须先冻结

以当前远端 HEAD 与 live runtime 为基线，记录：

- runtime identity / buildId / sourceHash / artifactHash / PID / instanceId；
- `TESTNET_ENABLED`、`AUTO_RUNNING`、Entry Safety AUTO、`aiExitAuthority=SHADOW`；
- settingsVersion；
- equity；
- USDT/USDC wallet balance、available balance、margin asset；
- 当前 positions / inFlight / reservations / active entry orders；
- 当前 gross / LONG / SHORT notional；
- `maxPositions`、`maxGrossExposurePct`、`maxDirectionExposurePct`、cluster caps、PortfolioRisk profile/version；
- `PENDING_RISK_UNVERIFIED` 数量与涉及 order ids；
- durable UNKNOWN 总数、其中具有 fresh `VERIFIED_NO_ACTIVE_RISK` 的数量、仍真实占用风险的数量；
- 30m/1h Entry conversion funnel。

基线不允许修改。

---

## B. 历史 UNKNOWN：先证明为什么还在挡，再做确定性收敛

### B1. 不改变冻结语义

`status=UNKNOWN` 的 durable row 保留原样，不删除、不改成 CANCELLED/FILLED/EXPIRED，不通过 SQL 直接修状态。

UNKNOWN 只有在**当前时刻缺少可验证的“无活动风险”证据**时才占用 pending risk；已有 `VERIFIED_NO_ACTIVE_RISK` 且 identity/tombstone/freshness 均有效时不得继续作为 `PENDING_RISK_UNVERIFIED`。

### B2. 只读根因分桶

对当前全部历史 UNKNOWN 分为至少：

- A：exact order query 明确不存在 + open orders 不存在 + fills/trades 无新增 + 无 exchangeOrderId/filledQty=0 + identity 匹配；
- B：曾经有 VERIFIED_NO_ACTIVE_RISK，但 proof TTL 过期；
- C：exchange 返回冲突/timeout/不可证；
- D：存在真实 active/partial fill/remote order；
- E：代码路径把已经 release 的 UNKNOWN 再次按 status-only 计入。

输出每桶数量、最老 age、重复 audit 次数、当前为什么占风险。

### B3. 红→绿修补

如果根因是 proof 失效/未续证：实现**只针对 UNKNOWN active-risk proof 的确定性续证**，复用现有 exact query / open orders / fills / tombstone identity；验证为无活动风险时刷新 `VERIFIED_NO_ACTIVE_RISK` 证据与有效期，但 durable UNKNOWN 状态不变。

如果根因是第二套 status-only authority：删除第二真源，所有 pending risk / PortfolioRisk / cockpit 统一调用 `entryOrderOccupiesRisk` / authoritative collector。

任何网络/身份/成交冲突都必须继续 fail-closed。

验收：历史 UNKNOWN 可以继续存在，但已被当前权威事实证明无活动风险的行不再制造 `PENDING_RISK_UNVERIFIED`；真正不可证明的行继续点名阻断。

---

## C. 资金容量模型：把“真实保证金容量”与“组合名义敞口指标”彻底解耦

### C1. 当前问题必须用测试钉死

现实现：

`grossLimit = equity * maxGrossExposurePct`

且 `ExecutableNotional = min(remainingGross, remainingDirection, cluster, riskSizing, quoteCapacity...)`。

因此当 gross≈equity 时，即使 USDT/USDC 仍有数千美元 available margin，`remainingGross≈0` 会把全部 Entry capacity 压成几十美元。

新增红测：

- equity≈10.7k；existing gross≈10.73k；USDT/USDC available margin 合计≈8.8k；positions 远低于 maxPositions；PortfolioRisk READY；
- 在 Testnet 的 margin-driven Entry capacity 模式下，不得把 `remainingGross≈34` 直接解释为“只有 $34 可用于新建仓”；
- quote available margin / executable leverage / maintenance & liquidation / stress facts 必须实际参与容量上限。

### C2. 新模型

明确分成两个对象：

#### `CapitalCapacity`

由真实资金事实决定：

- 每 quote asset 的 `availableBalance`；
- 可路由 symbol 的 margin asset；
- 已验证 leverage / leverage bracket；
- 当前 reservation / in-flight margin；
- quote-asset 使用政策；
- 必要的 exchange filters。

输出每个 quote asset 的：

- available margin USD；
- reserved/in-flight margin；
- executable margin；
- 可支持的 executable notional（按当前候选自己的已验证 leverage，不用全局假 leverage）。

#### `RiskCapacity`

继续由：

- PortfolioRisk stress；
- maintenance margin；
- liquidation buffer；
- per-trade risk；
- cluster / cluster-direction；
- position slots；
- drawdown / integrity / private / JIT；

等真实风险事实约束。

#### `ExecutableEntryCapacity`

应为：

`min(CapitalCapacity, RiskCapacity)`

而不是默认被 `equity * 1.0 - existingGross` 先压死。

### C3. Gross / Direction 的新角色

不要直接删除字段或篡改现有数值。实现明确 policy 语义：

- 当前 Testnet 采用 **margin-driven capacity**；
- `maxGrossExposurePct` / `maxDirectionExposurePct` 继续作为可观测的组合集中度/安全指标，并在明确的 enforce policy 下才作为 hard cap；
- 不允许把旧 `1.0 / 0.8` 静默改成更大数字来“解决”问题；
- 不允许通过把它们设成 Infinity/999 来绕过；
- 若需要新增 `capacityPolicy` / `grossMode` / `directionMode`，必须 schema、default、migration、settings matrix、API、UI、测试完整闭合；当前 Testnet 迁移到明确的 margin-driven 语义，Production 默认行为不得被暗改。

### C4. 50 个仓位必须具有产品意义

`maxPositions=50` 仍是硬槽位上限；它不保证一定建到 50，但不得再因为一个隐含的 `gross<=1×equity` 旧粗粒度限制，使 50 在正常可用保证金充足时永远不可达。

仍必须受真实 margin、stress、liquidation、cluster、per-trade、exchange filters 等约束。

---

## D. Direction / Cockpit 真值统一

当前 live settings 已记录 `maxDirectionExposurePct=0.8`。如果驾驶舱仍显示 LONG/SHORT limit=100% equity，则必须查清：

- Engine budget 是否错误使用 grossLimit；
- pipeline API 投影是否错字段；
- Dashboard 是否把 gross limit 当 direction limit。

只允许一个 Engine 真源。

驾驶舱重构为四块：

1. **资金/保证金容量**
   - USDT available / executable margin
   - USDC available / executable margin
   - 当前候选/路由可支持名义容量

2. **组合暴露（事实，不等于可用资金）**
   - Gross current
   - LONG current
   - SHORT current
   - cluster current

3. **风险/安全限制**
   - PortfolioRisk stress headroom
   - maintenance/liquidation facts
   - per-trade risk
   - cluster / direction policy（标明 OBSERVE / ENFORCE）
   - slots

4. **最终新增 Entry 容量**
   - LONG executable notional
   - SHORT executable notional
   - quote asset route
   - `firstBindingConstraint`
   - 具体解释：`AVAILABLE_MARGIN` / `PORTFOLIO_STRESS` / `CLUSTER` / `DIRECTION_ENFORCED` / `SLOTS` / `PENDING_RISK_UNVERIFIED` / `JIT` 等。

禁止再用“Gross 剩余”直接命名为“新增风险额度”，除非它确实是当前 enforce 的首个 hard blocker。

---

## E. 与上一轮 Entry conversion 闭环联动

保留上一轮所有改动：

- SHADOW historical ceiling 不硬 veto；
- S06-T02 最小 q 硬利润保护；
- legal target horizons；
- pre-AI hard feasibility；
- Run execution outcome；
- PLACE→TradePlan→Reservation→Intent→Submit→Fill funnel。

本轮完成后用自然流量验证：

1. `TESTNET_ENABLED / EXECUTION_READY / profile READY`；
2. 如果真实可用保证金与风险事实允许，则不应再由旧 `gross≈1×equity` 让所有候选只剩几十美元；
3. 自然 PLACE 在所有硬门 PASS 时立即进入 reservation→intent→JIT→submit；
4. 如果仍不 submit，Run 级执行结果必须准确点名新的真实 first blocker；
5. 不人工造候选、不人工造 fill。

---

## F. 测试与敌意场景

至少覆盖：

- margin 充足 + gross>1×equity + policy=margin-driven → 仍可根据真实 RiskCapacity 建新仓；
- available margin 不足 → `AVAILABLE_MARGIN` 真阻断；
- stress/maintenance/liquidation 不满足 → 风险层阻断，不能被 margin 充足覆盖；
- cluster cap enforce → cluster 阻断；
- direction mode observe 时只展示不 veto；enforce 时严格 veto；
- settings=0.8 时 Engine/API/UI direction limit 一致；
- UNKNOWN 有 fresh no-active-risk proof → 不占 pending；proof 失效/冲突 → fail-closed；
- exact query timeout → 不释放；
- fill/partial fill → 必须占用；
- 不因 UNKNOWN 收敛删除 durable audit history；
- Production 路径不被 Testnet migration 静默改变；
- ENTRY conversion funnel 仍精确归因。

跑全门禁：Engine tests/typecheck、dashboard、core、verify:deps、verify:scripts、S00、storage coverage、`git diff --check`。

---

## G. 部署与在线验收

红→绿后立即 build + 受控部署；不等待 24h soak。

每次部署前后记录 identity/provenance/settings diff/positions/TP/ownership/pending risk/production writes。

在线验收必须至少证明：

- Production writes=0；
- Testnet runtime 健康；
- `PENDING_RISK_UNVERIFIED` 不再由已经证明无活动风险的历史 UNKNOWN 制造；
- 真实资金容量与组合暴露在 UI 上分离；
- Direction limit 与 live settings 一致；
- `firstBindingConstraint` 来自真实 Engine 单一计算；
- 当钱包/风险都允许时，新增 Entry capacity 不再被旧 `gross=1×equity` 人为压到几十美元；
- 至少一批自然 PLACE 重新验证到 submit/fill 或被新的真实硬 blocker 精确解释。

最终状态名：

`V396_TESTNET_ACTIVE_EXECUTION_CAPACITY_MODEL_CLOSED`

如果本轮自然流量又暴露新的确定性 P0/P1，继续同一轮红→绿、提交、部署、验证；无需再次索取生命周期授权。不得以“继续观察”或“等 24h”结束。
# CODEX — V3.9.6 PositionRisk V3 实证修补 + 单次部署 + Testnet 恢复（2026-09-24）

## 0. 本轮目标与新授权

用户已经明确要求继续正式 Testnet 运行，并对本轮给出**新的、一次性的 Engine 生命周期授权**：

- 最多一次 `scripts/stop-zdj-lan.ps1`；
- 最多一次 `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`；
- 禁止第二次 stop/start/restart/hot reload/watchdog/autostart；
- 生命周期动作只在本轮离线修补、测试、正式 build 全部通过后执行；
- 当前 live 的 `READ_ONLY` 是上轮 P1 的临时缓解，不是新的长期运行目标。

本轮成功终态：

```text
TESTNET
AUTO_RUNNING
Entry Safety=AUTO
PortfolioRisk authority/profile READY
executionMode=TESTNET_ENABLED
executionReadiness=EXECUTION_READY（健康窗口）
自然 PLACE 可进入真实 reservation → intent → admission → JIT → Binance Testnet submit
productionWrites=0
```

正常业务上“不建新仓”的理由只接受真实资金/仓位/组合风险容量或没有可执行候选。private/egress/JIT/integrity/authority drift 等安全事实若失败仍必须 fail-closed，但属于异常事实，不得被改写成长期 READ_ONLY/人工审批/观察期暂停；事实恢复后应自动继续。

开始前：

- fetch 最新 `codex/v396-final-convergence-20260922`；
- ff-only；不 rebase/squash/force push；
- 当前已知 HEAD `f25f407f66e410eca0849f8aee7de31413cf41e6`，其父含 `423262c` + `9c24796`；以执行时最新 convergence 为准并记录；
- PR #9 不触碰。

---

## A. 已实证根因：不要先部署探针再等第二次部署

上轮 live 已证明 12 个持仓出现：

- `MAINTENANCE_MARGIN_UNPROVEN`；
- `POSITION_MARGIN_ASSET_UNPROVEN`；
- 其中 3 个 LONG 的 `liquidationPrice=0` 被当前 mapper 当成未证明。

当前产品 `ExternalTradeAdapter.fetchPositions()` 使用 `/fapi/v2/positionRisk`，并尝试从 `maintMarginAmt ?? maintenanceMargin` 读取 maintenance margin；这与 Binance 当前 USDⓈ-M Position Information V3 的权威字段不一致。

Binance 当前官方 V3 契约 `GET /fapi/v3/positionRisk` 明确返回：

- `marginAsset`；
- `initialMargin`；
- `maintMargin`（maintenance margin required）；
- `liquidationPrice`；
- `notional`；
- `positionAmt` / `markPrice` 等。

官方 V3 示例还明确展示一个 `positionAmt=30`、`notional=12.31427700` 的**非零持仓**同时返回：

```text
liquidationPrice = 0
marginAsset = USDT
maintMargin = 0.08004280
```

因此本轮不再把“0”本身当作字段缺失，也不再继续等待一次 live probe 才决定显而易见的字段名问题。

但 probe 仍要保留：部署后用于核对 Testnet 实际 payload 是否与官方契约一致；若 Testnet V3 不支持或真实 payload 缺字段，必须 fail-closed，不得合成。

---

## B. 红测先行：PositionRisk V3 成为唯一持仓风险事实入口

先写红测并保存 transcript，至少锁定旧实现以下缺陷：

1. `fetchPositions()` 仍 GET `/fapi/v2/positionRisk`；
2. 非零持仓的 V3 `maintMargin` 没被映射为 `maintenanceMarginUsd`；
3. V3 `marginAsset` 没形成已证明的 position margin asset；
4. `liquidationPrice='0'` 的非零 LONG 被当前 `>0 ? value : null` 逻辑错误降成 UNKNOWN；
5. 当前 `abs(mark-liquidation)/mark` 会掩盖方向不合理的 liquidation price；
6. 不得用 bracket profile rate × notional 合成 position `maintenanceMarginUsd`；
7. 不得用 entry sizing / profile / leverage 自算 liquidation price。

---

## C. 修复真实 position facts

### C1. 使用 V3

对正式 Testnet position truth：

```text
GET /fapi/v3/positionRisk
```

`fetchPositions()` 与 `probePositionRiskFields()` 应读取同一权威 endpoint，避免 probe 与运行 mapper 看不同版本。

要求：

- signed private GET；
- 走现有 proxy/egress/time-sync/budget 边界；
- 无任何 write；
- 不新增直连 Binance；
- 如果 Testnet 返回 endpoint unsupported / schema 缺失 / 数据歧义，fail-closed 并明确 blocker；不得偷偷回退到合成风险事实。

若为兼容性保留 V2 fallback，fallback 只能用于基础持仓存在性/审计，不得把缺失的 margin/maintenance/liquidation 字段标成 VERIFIED，也不得允许新风险。

### C2. 字段映射

对每个非零 position row，只使用该 row 自己的 exchange facts：

```text
positionAmt -> quantity/side
markPrice -> markPrice
notional -> notionalUsd（取绝对值）
marginAsset -> marginAsset
maintMargin -> maintenanceMarginUsd（取非负有限值）
liquidationPrice -> liquidationPrice 原始 exchange fact
leverage -> leverage
```

禁止：

- `maintenanceMarginRatePct * notional` 合成 `maintenanceMarginUsd`；
- bracket dataset 代替 position `maintMargin`；
- quote suffix 猜 `marginAsset`；
- 缺字段时填 0。

### C3. `liquidationPrice=0` 的本轮确定语义

不要写成“无限缓冲”。采用可审计、有限、方向敏感的规则：

#### 非零 LONG

若同时满足：

- exchange V3 row 的 `positionAmt > 0`；
- `markPrice > 0` 且 finite；
- `liquidationPrice === 0` 是 exchange 明确返回值；
- `marginAsset` 已证明；
- `maintMargin` 为 finite 且 `>=0`；

则 `liquidationPrice=0` 是**已验证 exchange sentinel / zero-price boundary**，不是 missing。

令：

```text
liquidationBufferPct = (markPrice - 0) / markPrice = 1.0
```

即 100% 的“到零价边界距离”；不是 Infinity，也不声称 Binance 永远不会强平。

建议同时保留 provenance，例如：

```text
liquidationPriceFact = EXCHANGE_REPORTED_ZERO
```

以便驾驶舱/证据能区分“exchange 明确报 0”与“字段缺失”。

#### 非零 SHORT

`liquidationPrice=0` **不得**自动按 100% 放行；保持 `LIQUIDATION_BUFFER_UNPROVEN` / 具体方向 blocker，直到 exchange 给出方向合理的正值或另有明确权威语义。

#### 正 liquidation price

不要继续用 `abs()` 掩盖方向错误。

- LONG：要求 `0 < liquidationPrice < markPrice`，buffer=`(markPrice-liquidationPrice)/markPrice`；
- SHORT：要求 `liquidationPrice > markPrice > 0`，buffer=`(liquidationPrice-markPrice)/markPrice`；
- 违反方向关系 => `LIQUIDATION_PRICE_DIRECTION_INVALID:<symbol>:<side>`，fail-closed。

### C4. Position fact 完整性

一个 position 的 PortfolioRisk fact 要成为 VERIFIED，至少要求该仓位自己的：

- nonzero quantity/side；
- markPrice；
- marginAsset；
- maintenanceMarginUsd (`maintMargin`)；
- liquidation buffer 按上面的规则可证明；
- durable ownership/cycle identity。

不要因为 profile authority READY 就自动把 position fact 升级成 VERIFIED。

---

## D. 必须新增的敌意测试

至少覆盖：

1. V3 非零 LONG + `liquidationPrice='0'` + `maintMargin` + `marginAsset` => VERIFIED，buffer=1；
2. V3 非零 SHORT + `liquidationPrice='0'` => fail-closed；
3. LONG 正 liq < mark => 正确 buffer；
4. SHORT 正 liq > mark => 正确 buffer；
5. LONG liq >= mark / SHORT liq <= mark => direction invalid；
6. 缺 `maintMargin` => `MAINTENANCE_MARGIN_UNPROVEN`；
7. 缺 `marginAsset` => `POSITION_MARGIN_ASSET_UNPROVEN`；
8. 不能从 bracket/rate/notional 合成 maintenance margin；
9. probe 与 fetchPositions 使用同一 V3 endpoint；
10. probe/fetch 全程 GET-only；
11. V3 unsupported / malformed => fail-closed，不产生可下单 risk ticket；
12. `423262c + 9c24796` 的 sized-universe coverage 行为继续全绿；
13. authority/profile READY 不覆盖 position-level UNKNOWN；
14. existing 46/47 historical UNKNOWN occupancy 语义无回归；
15. production write 永远 0。

---

## E. 离线门禁后一次性部署（本轮唯一 lifecycle）

完成代码、红→绿、全仓门禁、正式 build 后：

1. 记录部署前 PID/buildId/settingsVersion/executionMode/positions/TP/ownership/write counters；
2. 正式 build 到 live dist；
3. `scripts/stop-zdj-lan.ps1` **一次**；
4. 证明 8080 free、旧 PID 已退出；
5. `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` **一次**；
6. 不得二次 restart；
7. provenance artifact/source hash 与新进程双向闭合。

如果一次启动失败，不允许自动重启；按 AGENTS.md 报告人工干预。

---

## F. 启动后先用真实 probe 验证，不再猜

在仍为 READ_ONLY 的短预检窗口，调用新的只读 preview/probe，必须记录 `/fapi/v3/positionRisk` 的真实：

- endpoint；
- fieldNames；
- 每个非零仓位的 `symbol/positionSide/positionAmt/markPrice/notional/marginAsset/maintMargin/liquidationPrice/leverage`；
- 只读 write counters 不增加。

验收：

- `marginAsset` 对所有非零仓位可证明；
- `maintMargin` 对所有非零仓位 finite >=0；
- 3 个此前 LONG `liquidationPrice=0` 若仍由 exchange 报 0，按 C3 得到 buffer=1；
- 不允许 report 将“字段缺失”与“exchange 报 0”混为一类。

若真实 Testnet payload 与 Binance V3 契约不符，停止激活并给出 P1 事实；本轮 lifecycle 授权已消耗，不再重启。

---

## G. Authority 覆盖刷新/确认

`423262c + 9c24796` 已把 coverage 改为“可 sized 宇宙”而非单 tick 两个路由 symbol。

部署后：

1. 用 preview 确认 required sized universe；
2. 若现有 committed margin authority 已覆盖且 hash/status MATCHED，可复用；
3. 若 requiredSymbols 扩大/档位 hash 变化，调用一次专用 `POST /api/v3/settings/portfolio-risk-authority` 显式重新 commit；
4. numeric limits 沿用当前已批准 profile，不借 refresh 改 exposure/maxPositions/stress/TP/reachability；
5. readback 必须 `profileStatus=READY`、authority=MATCHED、missingSymbols=[]。

任何 drift 不能自动授予新 hash。

---

## H. 恢复正式 Testnet Entry

当且仅当以下真实事实齐备：

- environment=TESTNET；
- private account READY/fresh；
- egress VERIFIED；
- persistence/integrity healthy；
- TP/ownership 对现有仓位正确；
- PortfolioRisk profile READY；
- authority MATCHED；
- position-level marginAsset/maintMargin/liquidation facts VERIFIED；
- production boundary lockedToTestnet=true；

执行一次 CAS：

```text
connections.executionMode: READ_ONLY -> TESTNET_ENABLED
```

只改这一项。

写后立即 readback：

```text
TESTNET_ENABLED
AUTO_RUNNING
Entry Safety=AUTO
aiExitAuthority=SHADOW
productionWrites=0
executionReadiness.ready=true（健康事实窗口）
modelSpendPermitted=true
```

private/egress 短暂抖动时不要自动回 READ_ONLY；安全闸临时 fail-closed，恢复后自动继续。

---

## I. 第一批自然 PLACE 必须验证真实执行链

禁止人工造候选/造 PLACE。

对自然 Primary `PLACE_LONG/PLACE_SHORT`：

若资金/仓位/组合风险容量与所有硬事实通过，必须进入：

```text
PLACE
→ TradePlan persisted
→ reservation
→ intent
→ PORTFOLIO_RISK_ADMISSION_EVALUATED allowed=true
→ JIT
→ EntryOrder persisted
→ Binance Testnet placeEntry 恰一次
→ submit ack
→ 若 fill：position/cycle/ownership/TP protection
```

不得再出现：

- ANALYSIS_ONLY；
- EXCHANGE_WRITE_LOCKED；
- PROFILE_NOT_CONFIGURED；
- 因单 tick coverage 轮动而全局暂停；
- 用 position fields 缺失造成“任意候选任意数量恒拒绝”。

若 admission 拒绝，只接受具体真实原因。资金/仓位类 blocker（Gross/Direction/Cluster/maxPositions/available margin/HUMAN notional 等）属于正常容量约束；其它 blocker 属异常事实，必须明确标记，不能包装成“正常不建仓”。

---

## J. 禁止事项

- 不提高 `maxGrossExposurePct / maxDirectionExposurePct / maxClusterExposurePct / maxClusterDirectionExposurePct / maxPositions`；
- 不放宽 authority maintenance rate 上界 0.2；
- 不改 TP `0.15`、reachability、economics/UNKNOWN/JIT/freshness/egress；
- 不合成 `maintenanceMarginUsd`；
- 不把 `liquidationPrice=0` 写成 Infinity；
- 不对 SHORT 的 0 liquidation 自动放行；
- 不改 `aiExitAuthority=SHADOW`；
- 不碰 Production；
- 不删除历史 UNKNOWN；
- 不做 coverage 自动授予；
- 不为过门人工造 candidate/PLACE/fill。

---

## K. 最终报告必须回答

1. 最终 HEAD / 产品提交 / buildId / PID / instanceId；
2. lifecycle 是否严格 stop=1/start=1；
3. live endpoint 是否已为 `/fapi/v3/positionRisk`；
4. 真实 Testnet 非零仓位 fieldNames；
5. 12/13 个仓位中 `marginAsset` 与 `maintMargin` 实际可证明数量；
6. 每个 `liquidationPrice=0` 的 side、exchange raw value、最终 buffer 语义；
7. 是否仍有 `MAINTENANCE_MARGIN_UNPROVEN / POSITION_MARGIN_ASSET_UNPROVEN / LIQUIDATION_BUFFER_UNPROVEN`；
8. authority profile status/hash/coverage/missingSymbols；
9. executionMode 最终是否 TESTNET_ENABLED；
10. executionReadiness 是否在健康窗口 READY；
11. 第一批自然 PLACE 的 allowed/blocked 原因；
12. 至少第一笔允许的 PLACE 是否到 reservation→intent→submit；
13. testnetWrites 每一笔归因；productionWrites 必须 0；
14. 新仓若成交，ownership/TP/protection 是否完整；
15. 当前剩余唯一 blocker（若仍无新仓），必须是具体事实，不得只写“风险未通过”。

成功状态：`V396_TESTNET_ACTIVE_EXECUTION`。

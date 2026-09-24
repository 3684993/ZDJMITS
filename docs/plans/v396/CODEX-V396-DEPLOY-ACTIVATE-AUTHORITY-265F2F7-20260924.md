# CODEX — V3.9.6 部署 PortfolioRisk Authority 并正式激活 Testnet Entry（2026-09-24）

## 0. 本轮目标与明确授权

用户已明确要求：**本轮必须部署激活，正式进入 Testnet 自动建仓运行；除资金/仓位容量条件外，不允许再以流程性、策略性、人工审批性状态长期暂停建仓。**

本轮不是审计轮，而是一次完整激活轮，必须在当前轮尽可能完成：

1. 部署已验收的 PortfolioRisk authority plumbing；
2. 真实采集 Binance Testnet margin brackets；
3. 原子提交 PortfolioRisk authority + profile；
4. 将 `connections.executionMode` 从 `READ_ONLY` 切换为 `TESTNET_ENABLED`；
5. 保持 `AUTO_RUNNING + entrySafety=AUTO`；
6. 等待第一个自然 `PLACE_LONG / PLACE_SHORT`，并验证真实 reservation → intent → PortfolioRiskAdmission → JIT → Binance Testnet submit；
7. 无真实 P0/P1 时保持 `V396_TESTNET_ACTIVE_EXECUTION` 持续运行，不自动退回 READ_ONLY，不再次询问是否开启。

### 生命周期授权

本文件即为本轮明确生命周期授权：

- 允许为部署本轮已验收产品做 **1 次** `scripts/stop-zdj-lan.ps1`；
- 允许随后做 **1 次** `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`；
- 禁止 hot reload、watch 模式、supervisor、autostart、watchdog；
- 禁止无理由第二次 stop/start；
- 若激活后实证暴露**新的产品级 P0/P1**，允许先离线红→绿修补，并在本轮内**最多额外 1 次**受控 stop + 1 次 MANUAL_START 重新部署该修复；不得把普通资金/仓位不足当作 P1，也不得用重启代替根因修复。

### “禁止暂停建仓”的精确定义

激活成功后，正常业务状态必须保持：

- `environment=TESTNET`
- `executionMode=TESTNET_ENABLED`
- `executionGovernance=AUTO_RUNNING`
- `entrySafetyMode=AUTO`
- `aiExitAuthority=SHADOW`（本轮不改）

以下**不得**作为持续的策略性/人工性建仓暂停：

- `READ_ONLY`
- `PROFILE_NOT_CONFIGURED`
- 人工审批等待
- `SAFETY_REVIEW_PAUSED`
- 因“还想继续观察”而人为暂停模型/Entry
- 因已有 13 个仓位但 `maxPositions=50` 而人为停发候选
- 因模型刚刚给出 PLACE 而把结果重新降级为 ANALYSIS_ONLY

正常业务上允许“不新增仓”的理由主要是资金/仓位风险事实，例如：

- position slots 已满；
- gross/direction/cluster headroom 不足；
- 可用保证金/资本路由不足；
- 当前持仓的真实 maintenance/liquidation 风险事实不满足；
- PortfolioRisk stress/capital limit 被真实当前组合触发；
- 没有满足确定性资格/经济可达性的候选。

另外，private data、egress、JIT、DB integrity、exchange identity、authority drift/missing 等属于**安全事实故障**：发生时必须 fail-closed，不允许伪造或绕过；但它们不得把系统切回一个长期人工“暂停模式”。在 `TESTNET_ENABLED` 保持不变的前提下，Anti-Waste 临时停止模型支出，事实恢复后自动继续。若长期不恢复，登记为基础设施/产品 incident 并查根因，而不是把它称为正常策略暂停。

---

## A. 基线与代码身份

开始时：

1. `git fetch` 最新 `codex/v396-final-convergence-20260922`；
2. `merge --ff-only`；
3. 不 rebase / squash / force push；
4. PR #9 不动；
5. 当前远端基线已知为：
   - HEAD `265f2f7d1273e5905624107bd80e1af7572d35a5`
   - 产品实现提交 `34208fc844a437de151b92121124b6de889b08d8`
6. 若执行时远端 HEAD 已更前，先确认新增提交没有未验收产品逻辑；docs/evidence-only 可继续，产品变化需先说明并跑受影响门禁。

记录部署前 live：

- PID / instanceId / buildId / artifactHash / sourceHash；
- settingsVersion；
- `environment/executionMode`；
- `maxGrossExposurePct/maxDirectionExposurePct/maxPositions`；
- `aiExitAuthority`；
- `portfolioRisk` readback；
- 当前 positions / TP / ownership；
- write-boundary counters；
- private/egress/integrity/persistence；
- 当前 authoritative pending occupancy。

预期旧实例约为 PID 34196 / `3.9.6-eaaabc52c682cc1ce56a`，但必须以执行时 readback 为准，不能硬编码。

---

## B. 正式 build + 一次受控部署

1. 按项目正式生产 build 流程构建到 live `dist`；
2. 构建后计算并保存 expected artifactHash/sourceHash/buildId；
3. build 成功后才允许生命周期动作；
4. `scripts/stop-zdj-lan.ps1` **恰一次**；
5. 证明旧 listener/PID 已退出、8080 已释放；
6. `scripts/start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall` **恰一次**；
7. 等待 `STARTING → READY`；
8. 新实例必须自写 identity 与 expected artifact/source hash 双向闭合；
9. 禁止第二个并行 Engine、禁止 npm dev/tsx watch、禁止 supervisor/autostart。

部署后先不改 Settings，读取：

- `GET /api/v3/settings/portfolio-risk-authority`
- `GET /api/v3/settings/governance`
- health / pipeline / write-boundary

预期在 authority 尚未提交前：

- profile 不是 READY；
- authority readback 显示 `AUTHORITY_NOT_COMMITTED` / `MARGIN_AUTHORITY_MISSING` 或等价明确 blocker；
- 这是部署后的冷启动事实，不得因此停在本轮结束。

---

## C. 构造本轮 Testnet Discovery Profile 数值

所有金额上限必须用**提交前 fresh private account 的实时 Equity E**，不得复制旧的 `$10,799...`。

从同一 fresh settings/readback 获取：

- `E = equityUsd`
- `G = riskGovernance.maxGrossExposurePct`
- `D = riskGovernance.maxDirectionExposurePct`
- `P = portfolio.maxPositions`

必须保持当前 operator caps，不得提高 G / D / P。

构造 limits：

```text
configured = true
maxCapitalAtRiskUsd = E
maxDrawdownPct = 1.0
maxStressLossUsd = E * 0.50
maxGrossNotionalUsd = E * G
maxDirectionNotionalUsd = E * D
maxClusterNotionalUsd = E * G
minMarginBufferPct = 0
minLiquidationBufferPct = 0
maxHumanPositions = P
maxHumanNotionalUsd = E * G
maxPendingHandoffs = P
maxAckAgeMs = 86400000
snapshotTtlMs = 20000
cashFlowWindowMs = 86400000
cashFlowMaxAgeMs = 900000
```

说明：

- 这些是 Testnet discovery profile，不提高外层 gross/direction/maxPositions；
- `maxStressLossUsd=50% E` 继续是实际约束；
- buffer=0 只是不给已有外层再加一层人为门，**不允许**伪造 position maintenance/liquidation facts；
- `maintenanceMarginRatePct`、三个 version、clusters/scenarios identity 全部由 server authority compiler 派生，不得请求携带 forged version/rate/bracket/hash。

Correlation dataset：

```json
{"clusters":{}}
```

其含义是 Testnet conservative unmapped aggregation，不表示“资产无相关性”。

Stress scenarios 使用已经批准的 3 个工程场景：

```json
[
  {"id":"DOWN_10_LIQUIDITY","priceShockPct":-0.10,"spreadWidenPct":0.01,"fundingShockPct":0.005,"markBasisShockPct":-0.01,"depthPenaltyPct":0.02,"exchangeUnavailable":false,"unavailablePenaltyPct":0,"clusterConvergencePct":0.50},
  {"id":"UP_10_LIQUIDITY","priceShockPct":0.10,"spreadWidenPct":0.01,"fundingShockPct":0.005,"markBasisShockPct":0.01,"depthPenaltyPct":0.02,"exchangeUnavailable":false,"unavailablePenaltyPct":0,"clusterConvergencePct":0.50},
  {"id":"EXCHANGE_GAP_15","priceShockPct":-0.15,"spreadWidenPct":0.02,"fundingShockPct":0.005,"markBasisShockPct":-0.02,"depthPenaltyPct":0.03,"exchangeUnavailable":true,"unavailablePenaltyPct":0.03,"clusterConvergencePct":0.75}
]
```

这些只能称 Testnet engineering scenarios，不得称为预测概率。

---

## D. 真实 authority collection + 原子 commit

保持 `READ_ONLY`，先确保：

- private account `READY` 且 <=60s fresh；
- egress `VERIFIED`；
- environment `TESTNET`；
- persistence HEALTHY / integrity true；
- 13 左右现有持仓/TP/ownership 正常；
- write boundary 仍 `testnetWrites=0 / productionWrites=0`（authority 只做 private GET，不是交易写）。

随后调用**一次专用**：

```text
POST /api/v3/settings/portfolio-risk-authority
```

请求只允许携带：

- fresh `expectedSettingsVersion`
- 上述 `limits`
- `correlation.clusters={}`
- 上述 3 个 `scenarios`
- `acks=["PORTFOLIO_RISK_PROFILE_ENABLED"]`
- operator 标识

不得携带：

- bracket/raw bracket；
- marginTierVersion；
- contentHash；
- maintenanceMarginRatePct；
- correlationVersion；
- scenarioVersion；
- credential；
- 任何 server-derived 字段。

服务端必须自己：

1. 从**当前非零 live positions UNION 当前可路由/可执行 Entry symbols**形成 requiredSymbols；
2. 通过已有 proxy/egress/private credentials 做 `/fapi/v1/leverageBracket` GET-only collector；
3. 每 symbol 一次、去重、bounded concurrency；
4. canonicalize；
5. server-side hash；
6. 派生 conservative maintenance rate；当前 sizing reachability 未接真值时允许使用已实现的 `ALL_COVERED_TIERS` 最大值保守退化；
7. canonicalize clusters/scenarios 并算 hash；
8. 单个 SQLite transaction 内 CAS 写 authority rows + complete Settings + settings_audit；
9. settingsVersion 恰 +1；
10. 任一步失败全 rollback。

### D1. Authority commit 失败处理

不能停在“profile 还是未配置”并结束本轮。

若 423/400：

- 先读 response blocker；
- 若是 `MARGIN_TIER_SYMBOL_UNPROVEN:<symbol>`、collector parsing、coverage calculation、hash/store binding 等**产品缺陷**，按红→绿修补；
- 不得删除 required symbol、伪造 bracket、降低 derived maintenance rate、直写 SQLite、把 locked 字段改 editable；
- 若是 Binance Testnet 对某个真实 required symbol 根本无 bracket/接口事实，记录具体 symbol/API 原文；这是无法伪造的 exchange fact blocker。不要用别币档位冒充；但继续判断该 symbol 是否真的“当前可路由/可执行”——若 required-set 算法错误把不可交易 symbol 纳入，则修算法，不是删事实。

本轮目标仍是取得一次真实 committed authority 并继续激活。

### D2. Commit 成功必须 readback

立即确认：

- `profileStatus=READY`；
- `configured=true`；
- durable margin/correlation/scenario authority 均存在；
- settings version/hash 与 durable rows 一致；
- coverageSymbols 覆盖当前 positions + 当前可执行 Entry scope；
- missingSymbols=[]；
- derivedMaintenanceMarginRatePct finite；
- derivation 如为 `ALL_COVERED_TIERS` 必须如实显示；
- `PENDING_RISK_UNVERIFIED` 不因历史 46 UNKNOWN phantom 回归；
- 46 durable UNKNOWN 仍保留，权威 occupancy 仍按 `entryOrderOccupiesRisk`；
- generic PATCH/PUT locked 边界未被绕过。

只有到这里才算真正消掉 `RISK_PROFILE_UNCONFIGURED`。

---

## E. 正式切换 TESTNET_ENABLED

Authority/profile READY 后，使用 fresh settingsVersion 做 CAS，只改：

```text
connections.executionMode: READ_ONLY -> TESTNET_ENABLED
```

不得同时修改：

- environment；
- G / D / cluster caps / maxPositions；
- `aiExitAuthority=SHADOW`；
- private freshness/timeout；
- egress；
- UNKNOWN/JIT；
- reachability `0.5`；
- TP `0.15`；
- 经济门；
- 任何 Production 配置。

写后立即确认：

- `environment=TESTNET`
- `executionMode=TESTNET_ENABLED`
- `lockedToTestnet=true`
- `productionWrites=0`
- `profileStatus=READY`
- `entrySafetyMode=AUTO`
- `executionGovernance=AUTO_RUNNING`
- `aiExitAuthority=SHADOW`

这一步真正消掉 `EXECUTION_WRITE_LOCKED`。

### E1. 不允许再自动退回 READ_ONLY

激活成功后，不因：

- 暂时无候选；
- private/egress 短暂抖动；
- AI idle；
- capacity 当前满；
- 一次 admission 拒绝；

而自动把 Settings 改回 READ_ONLY。

安全事实短暂失败时由每 tick gate/JIT fail-closed，Anti-Waste 停模型；事实恢复后在 `TESTNET_ENABLED` 下自动恢复派发。

只有真实 P0/P1（例如 production 边界破坏、重复 submit、身份错绑、裸仓/保护失效、authority 数据损坏、DB integrity 失败）才允许进入事故处理；若必须回 READ_ONLY，必须把它作为 P0/P1 mitigation 明确记录，不能静默降级。

---

## F. 第一笔自然 PLACE 必须真实执行

禁止人工制造 candidate / PLACE / fill。

在 `executionReadiness.ready=true` 后等待自然链。

对于第一笔自然 `PLACE_LONG` 或 `PLACE_SHORT`：

如果资金/仓位和所有确定性安全事实通过，必须看到：

1. SCOUT（如职责需要）完成；
2. Primary normalized `PLACE_*`；
3. immutable TradePlan persisted；
4. reservation created；
5. intent created；
6. `PORTFOLIO_RISK_ADMISSION_EVALUATED`；
7. snapshot `complete=true`；
8. risk ticket generation/hash/profileVersion/settingsVersion/TTL 正确绑定；
9. JIT facts 未变化；
10. Entry order persisted；
11. Binance **Testnet** `placeEntry` 恰一次；
12. exchange acknowledgement / `ENTRY_ORDER_SUBMIT`；
13. 若成交：fill → position/cycle/ownership；
14. protection / TP 建立并验证，不允许裸仓。

**严禁再次出现**：

```text
PLACE -> ANALYSIS_ONLY -> 0 submit
```

或：

```text
PLACE -> 人工等待/策略暂停 -> 不执行
```

### F1. admission 拒绝如何分类

若真实拒绝，必须给出明确 reason。

以下属于正常资金/仓位业务阻断，可以不建仓而保持 AUTO_RUNNING：

- `POSITION_CAPACITY`
- `MAX_GROSS_NOTIONAL` / gross headroom exhausted
- direction/cluster headroom exhausted
- available margin / capital route insufficient
- current portfolio stress/capital loss limit 确实被当前组合触发
- current position maintenance/liquidation buffer 真实不满足
- 无可执行 candidate

以下若在 authority 已 READY + TESTNET_ENABLED 后持续出现，视为产品/基础设施异常，不得作为常态“暂停建仓”：

- `EXECUTION_WRITE_LOCKED`
- `RISK_PROFILE_UNCONFIGURED`
- `AUTHORITY_NOT_COMMITTED`
- committed authority hash/binding 自己不一致
- 旧 phantom pending 再次抬高 gross
- generic governance path 错误挡住已经合法提交的 profile
- 明明 private/egress READY 却仍被标 unavailable
- PLACE 后无 deterministic reject 也无 submit

---

## G. “50 个最大仓位”的验收口径

不要把 `maxPositions=50` 误解成“系统必须建满 50”。

激活后正常持仓数量仍由多个事实共同决定：

- slots <=50；
- gross/direction/cluster exposure；
- per-trade sizing；
- available capital；
- candidate quality/economics；
- PortfolioRisk stress。

本轮不提高 `maxGrossExposurePct=1`、`maxDirectionExposurePct=0.8` 或 `maxPositions=50`。如果系统恢复真实建仓后在约 15–20 仓附近首先撞到 gross，而不是 slots，这属于当前 sizing × gross 数学关系，必须在后续单独讨论 sizing/capacity product design，不能为了“凑 50 仓”放宽风险上限。

但只要**当前仍有真实 capital/exposure headroom + executable candidate + deterministic gates PASS**，系统不得因为“现在已经有 13 个左右”而主动停止建仓。

---

## H. 持续运行与保护

成功激活后的目标状态：

```text
V396_TESTNET_ACTIVE_EXECUTION
```

必须保持：

- AUTO_RUNNING；
- TESTNET_ENABLED；
- Production 永久 locked；
- aiExitAuthority=SHADOW；
- HUMAN_MANAGED 旧仓继续由原有保护链维护；
- AI 新仓的 ownership/TP/protection 按既有 deterministic authority；
- handoff 不改变 risk；
- 10 USDT 仍只是 AI realized net-loss exit permission threshold，不是账户止损；
- 不改变 0.15 / 0.5 reachability / UNKNOWN / JIT 等冻结语义。

不要为了“必须建仓”降低安全门；正确目标是：**当安全门全部 PASS 时，PLACE 必须执行；当资金/仓位风险不允许时，明确拒绝；当基础设施安全事实临时缺失时，fail-closed 并自动恢复，不进入永久暂停模式。**

---

## I. 最终验收与证据

至少输出并归档：

1. 最终 HEAD / 产品源提交 / evidence 提交；
2. deployment old/new PID、instanceId、buildId、artifactHash/sourceHash；
3. stop/start 次数；
4. authority collection requiredSymbols / coverageSymbols / missingSymbols；
5. margin contentHash/version / derived maintenance rate / derivation；
6. correlation/scenario hashes；
7. authority commit 前后 settingsVersion（恰 +1）；
8. profile readback `READY`；
9. executionMode CAS 前后版本；
10. 最终 `TESTNET_ENABLED / AUTO_RUNNING / AUTO / SHADOW`；
11. executionReadiness `ready/modelSpendPermitted/blockers`；
12. 第一笔自然 PLACE lineage；
13. reservation/intent/admission/order/submit/fill 数；
14. Binance Testnet orderId/clientOrderId（若 submit）；
15. 若 fill：new AI_ACTIVE ownership + TP/protection；
16. 现有 HUMAN positions/TP 是否完整；
17. pending-risk phantom 是否仍为 0；
18. private/egress/integrity/persistence；
19. testnetWrites/productionWrites/lastWriteAt；
20. duplicate submit / stale fact / wrong side / qty mismatch；
21. fatal/uncaught；
22. 是否发生任何自动退回 READ_ONLY；
23. 若最终未 submit，必须给出**唯一第一真实 blocker**及其属于资金/仓位正常阻断还是产品/基础设施异常；不能用“继续观察”结束。

证据目录建议：

```text
docs/evidence/v396/deploy-activate-authority-20260924/
```

报告建议：

```text
docs/reports/v396-deploy-activate-authority-20260924.md
```

完成后全仓门禁，`git diff --check`，提交报告/证据并 `ff-only` push。

---

## J. 本轮完成定义

理想完成态必须同时满足：

```text
runtime payload = 34208fc 产品或其本轮必要 P0/P1 修复后版本
PortfolioRisk authority = COMMITTED + VERIFIED
portfolioRiskProfile = READY
executionMode = TESTNET_ENABLED
executionGovernance = AUTO_RUNNING
entrySafety = AUTO
aiExitAuthority = SHADOW
productionWrites = 0
executionReadiness = EXECUTION_READY（当 private/egress/capital facts 当前健康时）
```

并且至少观测到一个自然 PLACE 的真实执行结果：

- 若资金/仓位/风险 gates PASS：必须 submit 到 Binance Testnet；
- 若未 submit：只能接受有明确、真实、可审计的资金/仓位风险 blocker，或一个被正式登记并修复/上报的基础设施 P0/P1，不能以 READ_ONLY/profile 未配置/继续观察作为结束状态。

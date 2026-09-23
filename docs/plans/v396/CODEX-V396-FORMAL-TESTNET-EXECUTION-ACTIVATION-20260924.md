# CODEX — V3.9.6 正式 Testnet 执行激活（2026-09-24）

## 0. 本轮授权性质

这是一次**正式 Testnet 运行授权**，不是只读审计，也不是 ANALYSIS_ONLY 观察轮。

用户明确要求：必须直接进入正式运行测试网，以真实订单链发现剩余问题。

本轮允许：

1. 在当前运行实例上写入一次经过下述规则构造并验证的 `riskGovernance.portfolioRisk` Testnet profile；
2. 在 profile readback / 私有事实 / egress / ownership / TP / persistence 预检满足后，把 `connections.executionMode` 从 `READ_ONLY` 切为 `TESTNET_ENABLED`；
3. 允许真实 **Binance Testnet** Entry 写链：reservation → intent → JIT PortfolioRiskAdmission → order → `placeEntry` → Testnet submit/fill；
4. 若无 P0/P1，保持 `TESTNET_ENABLED` 持续运行，不在验收后自动切回 READ_ONLY；
5. 若遇到下面定义的 P0/P1，允许立即 CAS 回 `READ_ONLY` 作为 fail-closed，不需要再次询问用户；
6. 本轮不需要为了 Settings 生效重启 Engine；除非发现“设置写入后运行进程不能正确读取”的真实产品缺陷，否则禁止启停当前 PID。

严禁：

- 任何 Production 写；
- 把 environment 改成 Production；
- `aiExitAuthority=ENFORCE`；保持现值（预期 SHADOW）；
- 提高 `maxGrossExposurePct`、`maxDirectionExposurePct`、`maxClusterExposurePct`、`maxClusterDirectionExposurePct`、`maxPositions`；
- 放宽 private-data 60 s freshness、egress、UNKNOWN、JIT、reachability、0.15 等既有安全/经济门；
- 为了制造成交而人工插入候选、伪造模型 PLACE、伪造 fill、绕过风险票据；
- 删除/改写历史 UNKNOWN 订单；
- 使用缓存私有余额替代 fresh private facts；
- 通过编造 Binance margin tier / correlation 的“权威来源”来过门。

当前已知部署基线：产品 `d570befca02e952bf174d3e1f42b93cf241285a3` 已运行在 PID 34196（上一轮证据）；分支在开始本轮时必须先 fetch 最新 convergence 并 `merge --ff-only`，不 rebase/squash/force，PR #9 不动。

---

## A. 开始前只读基线

先保存到 `docs/evidence/v396/formal-testnet-execution-activation-20260924/`：

- HEAD / live buildId / artifactHash / sourceHash / PID / instanceId / startedAt；
- environment / executionMode / lockedToTestnet；
- settingsVersion；
- `riskGovernance` 当前完整 readback；
- fresh equityUsd；
- 当前 `maxGrossExposurePct` / `maxDirectionExposurePct` / `maxClusterExposurePct` / `maxClusterDirectionExposurePct` / `maxPositions`；
- executionReadiness 完整投影；
- private account status + freshness；
- Binance egress；
- 当前 positions / TP protection / ownership / persistence / DB integrity；
- testnetWrites / productionWrites / lastWriteAt / blockedProductionWriteAttempts；
- durable UNKNOWN / pending-risk authoritative projection；
- 最近 30 分钟 AI run / submit / fill 基线。

若当前 live 产品不是已验收的 `d570bef` 内容树，停止并报告身份 P0；不要覆盖运行实例。

---

## B. Testnet Discovery PortfolioRisk Profile

### B1. 目的

这个 profile 是 **Testnet 工程发现 profile**，不是生产投资风险建议。它必须：

- 让 S05/J2 真实运行；
- 不重复制造比当前已获批外层 riskGovernance 更窄的隐形额度；
- 继续要求事实完整；
- 用明确 stress scenarios 做确定性压力求值；
- 不伪造 margin tier。

### B2. 运行期取值

只使用同一次 fresh readback：

- `E = account.equityUsd`，要求 finite、>0、private account READY 且 freshness <= 60 s；
- `G = riskGovernance.maxGrossExposurePct`；
- `D = riskGovernance.maxDirectionExposurePct`；
- `P = portfolio.maxPositions`；

不得修改 G / D / P。

写入 profile：

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

- `maxDrawdownPct=1`、buffer 下限 0、cluster profile 上限等于 gross，是为了让已有外层 deterministic gates 保持主约束，而不是悄悄新增更窄的第二套风险参数；
- `maxStressLossUsd=50% E` 仍然让压力模型有实际约束，而不是无限；
- `maxGrossNotionalUsd` / `maxDirectionNotionalUsd` 必须与当前用户设置的 G / D 对齐，不能自行提高。

### B3. Margin tier — 必须由真实 Binance/Testnet 事实产生

不得硬编码一个“看起来合理”的维持保证金率。

必须读取 Binance Testnet/当前连接可获得的 leverage-bracket / maintenance-margin bracket 权威数据，覆盖：

- 当前 13 个左右持仓；
- 当前可路由 candidate universe；
- 当前 Entry sizing 可能进入的 notional bracket。

构造 canonical bracket snapshot，保存原始/规范化证据，并：

- `marginTierVersion = sha256(canonical bracket snapshot)`（带 `TESTNET_BINANCE_BRACKET_` 前缀可读标识）；
- `maintenanceMarginRatePct = 对本轮覆盖 universe + sizing 区间适用 maintenance rate 的最大值`，即保守上界；
- 若 bracket 权威数据无法取得，本轮**不得伪造** profile 为 READY；先把该事实采集缺口登记为激活 blocker。若只是已有 collector/API 解析缺陷，可在本轮修代码，但必须红测→修复→全门禁→按既有人工启动规则受控部署后继续，最多额外 1 次 stop + 1 次 start，无需再次询问用户。

### B4. Correlation map

这是 Testnet operator-defined discovery model，不冒充统计相关性：

```text
correlationVersion = TESTNET_DISCOVERY_UNMAPPED_CONSERVATIVE_V1
clusters = {}
```

当前 stress engine 会把未映射 underlying 归入 `UNMAPPED_CORRELATED`；这是有意的保守聚合。profile 的 cluster notional 上限设为 gross，不额外制造 35% 第二层限制，但 stress scenario 仍会对同簇多成员加 correlation penalty。

### B5. Stress scenario set

```text
scenarioVersion = TESTNET_DISCOVERY_STRESS_V1
scenarios = [
  {
    id: "DOWN_10_LIQUIDITY",
    priceShockPct: -0.10,
    spreadWidenPct: 0.01,
    fundingShockPct: 0.005,
    markBasisShockPct: -0.01,
    depthPenaltyPct: 0.02,
    exchangeUnavailable: false,
    unavailablePenaltyPct: 0,
    clusterConvergencePct: 0.50
  },
  {
    id: "UP_10_LIQUIDITY",
    priceShockPct: 0.10,
    spreadWidenPct: 0.01,
    fundingShockPct: 0.005,
    markBasisShockPct: 0.01,
    depthPenaltyPct: 0.02,
    exchangeUnavailable: false,
    unavailablePenaltyPct: 0,
    clusterConvergencePct: 0.50
  },
  {
    id: "EXCHANGE_GAP_15",
    priceShockPct: -0.15,
    spreadWidenPct: 0.02,
    fundingShockPct: 0.005,
    markBasisShockPct: -0.02,
    depthPenaltyPct: 0.03,
    exchangeUnavailable: true,
    unavailablePenaltyPct: 0.03,
    clusterConvergencePct: 0.75
  }
]
```

这些是明确标注的 Testnet engineering scenarios，不得在报告中写成“市场概率”或“预测”。

---

## C. Profile 写入：一次 CAS + 立即 readback

允许一次 profile Settings CAS 写入。

要求：

1. 使用写前 `settingsVersion` 做 CAS；
2. 除 `riskGovernance.portfolioRisk` 外，所有 Settings byte/semantic 等价；
3. 写后立即 readback；
4. `configured=true`；
5. `profileReadback.status=READY`；
6. provenance settingsVersion 对应新版本；
7. G / D / maxPositions / aiExitAuthority / entrySafety / protection / tradeEconomics 等均未漂移。

若 CAS 冲突：重新只读 fetch 最新 Settings，确认没有与本轮字段冲突后最多重试一次；不可覆盖其他人工修改。

---

## D. 切写权限前最后预检

仍保持 READ_ONLY，确认：

- private account READY/fresh；
- Binance egress VERIFIED；
- persistence HEALTHY / integrity true；
- positions 与 TP 1:1 protected；
- ownership 无 duplicate、无异常 AI_ACTIVE；
- authoritative pending occupancy 无 phantom；
- production boundary lockedToTestnet=true；
- environment TESTNET；
- profile READY；
- Anti-Waste 仍正常。

这里**不要求**伪造一次 model/admission，因为 READ_ONLY 下 Anti-Waste 正确地阻止模型；下一节打开真实 Testnet 后让自然 candidate/PLACE 首次触发真实 JIT admission。

---

## E. 正式切换到 TESTNET_ENABLED

允许第二次 Settings CAS：

```text
connections.executionMode: READ_ONLY -> TESTNET_ENABLED
```

只改这一项。

不得：

- 改 environment；
- 改 aiExitAuthority；
- 改 exposure/risk 阈值；
- 改模型阈值；
- 改 freshness/egress；
- 启用 production。

写后必须立即 readback：

- environment=TESTNET；
- executionMode=TESTNET_ENABLED；
- lockedToTestnet=true；
- productionWrites 仍 0；
- profile READY；
- executionReadiness 在 private/egress 等临时事实健康时应 `ready=true, modelSpendPermitted=true`。

如果 private/egress 此刻抖动：**不要回退 mode，也不要放宽门**。让 Anti-Waste 暂停模型，等事实自然恢复；恢复后自动进入运行。

---

## F. 第一笔自然 PLACE：必须走真实执行链

禁止人工造候选/造 PLACE。

等待自然候选与模型决策。对于第一个自然 `PLACE_LONG` 或 `PLACE_SHORT`：

### F1. 若所有 deterministic gates 通过

必须看到完整链：

1. Primary normalized PLACE；
2. immutable TradePlan persisted；
3. Entry reservation created；
4. Entry intent created；
5. **真实 `PORTFOLIO_RISK_ADMISSION_EVALUATED`**；
6. snapshot `complete=true`；
7. pending risk 不含那 46 条已证明无 active risk 的历史 UNKNOWN；
8. risk ticket generation/hash/profileVersion/settingsVersion/TTL 正确绑定；
9. JIT facts 未变化；
10. Entry order persisted；
11. `placeEntry` 对 Binance **Testnet** 调用恰一次；
12. `ENTRY_ORDER_SUBMIT`/exchange acknowledgement；
13. 若成交：fill → position/cycle/ownership 正确；
14. 新仓保护链/TP 按现有 deterministic 规则建立；不得出现裸仓。

**PLACE + 所有门通过后，不允许再以 ANALYSIS_ONLY/EXCHANGE_WRITE_LOCKED 静默终止。**

### F2. 若 admission 正确拒绝

这是允许的，但必须记录真实 blocker，例如：

- cash-flow coverage；
- position maintenance/liquidation fact；
- margin asset；
- stress limit；
- human capacity；
- JIT drift；
- private/egress freshness。

不得把真实风险拒绝改成通过。

如果连续 3 次自然 PLACE 都被**同一个确定性基础设施/事实缺口**拒绝（不是市场/经济策略正常拒绝），立即 CAS 回 READ_ONLY，停止模型浪费，把它定级为 P1 并给出精确函数/谓词/证据；不需要向用户再次询问是否回退。

---

## G. 正式 Testnet 持续运行策略

只要没有 P0/P1：

- 保持 `TESTNET_ENABLED`；
- 不在首单后切回 READ_ONLY；
- 允许后续自然 Entry；
- 继续所有既有风控、JIT、TP/保护、ownership、reconciliation；
- `aiExitAuthority` 仍 SHADOW，因此不得把 AI exit ENFORCE 混入本轮；
- 现有 HUMAN_MANAGED 持仓的 owner 不因激活 Entry 而改变。

### P0 — 立即 READ_ONLY + 保留现场

任一即触发：

- production write / production endpoint；
- stale private data 被用于真实写；
- risk admission 未允许却 submit；
- risk ticket/JIT/version 绑定缺失却 submit；
- duplicate Entry submit；
- quantity/side/symbol 错误；
- ownership 双行/错误抢占 HUMAN 持仓；
- 新 AI 仓位在允许保护 grace 后仍无保护；
- DB integrity/fatal/uncaught；
- phantom UNKNOWN 再进入真实 pending risk 且导致错误 risk ticket。

### P1 — 立即 READ_ONLY，允许离线修补，不自动扩大风险

例如：

- 同一确定性事实 blocker 连续造成模型白跑；
- Testnet API/adapter 明显错误导致所有 submit 系统性失败；
- PortfolioRisk snapshot 与权威账本不一致；
- Dashboard/Engine 权威状态严重相反；
- 保护/对账链存在可复现但尚未形成 P0 的缺陷。

若需产品修补：红测→修补→全仓门禁→ff push；本授权允许最多 **1 次额外受控 stop + 1 次 MANUAL_START** 部署修补并继续本轮激活，不需要再次向用户索要生命周期授权。不能无限重启。

普通交易所拒单、价格移动、JIT 合法拒绝、风险上限真实命中不自动算 P1。

---

## H. 必须验收/记录的事实

最终报告至少回答：

1. 最终 HEAD / live buildId / PID / instanceId；
2. profile 写前/写后 settingsVersion；
3. E/G/D/P 与所有 profile 实际数值；
4. margin bracket 数据来源、覆盖 universe、canonical hash/version、maintenance rate 上界；
5. profileReadback 是否 READY；
6. executionMode 是否最终 `TESTNET_ENABLED`；若回退，具体 P0/P1；
7. executionReadiness 当前 blockers/readiness；
8. 第一个真实 `PORTFOLIO_RISK_ADMISSION_EVALUATED`：allowed / blockers / limits / snapshot complete / gross / pending / stress / human capacity；
9. 46 durable UNKNOWN 是否仍保留，且哪些（若有）当前重新占 risk，必须按证据 TTL 如实；
10. 第一个自然 PLACE 的完整 event lineage；
11. reservation / intent / order / submit / fill 数；
12. Binance Testnet order id/client id；
13. 新 AI 仓位 ownership 与 protection/TP；
14. testnetWrites / productionWrites / blockedProductionWriteAttempts / lastWriteAt；
15. 是否存在重复 submit / stale fact write / wrong-side / qty mismatch；
16. 现有 HUMAN_MANAGED 持仓是否保持不变；
17. fatal/integrity/persistence；
18. 当前系统是否继续正式 Testnet 运行。

证据目录：

`docs/evidence/v396/formal-testnet-execution-activation-20260924/`

报告：

`docs/reports/v396-formal-testnet-execution-activation-20260924.md`

完成后独立 commit 并 fast-forward push；工作树 clean；PR #9 不动。

---

## I. 最终状态语言

若成功打开真实 Testnet Entry 并无 P0/P1：

**`V396_TESTNET_ACTIVE_EXECUTION`**

并明确：

- 这是 Testnet，不是 Production；
- Entry 写已启用；
- Production 写仍为 0/锁定；
- AI exit authority 仍为 SHADOW；
- PortfolioRisk profile 为 `TESTNET_DISCOVERY` 工程 profile，不代表生产风险参数获批；
- 不声称盈利能力。

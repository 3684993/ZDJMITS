# CODEX — V3.9.6 Testnet PortfolioRisk 权威数据集收敛（2026-09-24）

## 0. 本轮性质与边界

这是一次**离线产品能力修补轮**，目标是补齐正式 Testnet 激活当前唯一已经实证暴露的产品能力缺口：

1. Binance Testnet 保证金档位 / maintenance-margin bracket 的只读权威采集；
2. `marginTier / correlation / scenarios` 数据集与版本/hash 的原子绑定；
3. PortfolioRisk profile 的运行时权威校验不再信任“非空版本字符串”；
4. 通用 Settings PATCH / PUT 继续不能绕过数据集权威通道。

开始前必须：

- `git fetch` 最新 `codex/v396-final-convergence-20260922`；
- 只允许 `merge --ff-only`；
- 不 rebase / squash / force push；
- PR #9 不动；
- 当前已知 convergence HEAD 基线为 `45aeffd52b7557a76a08559e62ccedb351b5b941`，若开始执行时远端更前，以最新 convergence 为准并记录。

### 本轮禁止

本轮**不是部署轮，也不是激活轮**：

- 不 stop / start / restart Engine；
- 不 hot reload；
- 不写 live `apps/*/dist`；
- 不写 live Settings；
- 不修改 `connections.executionMode`；
- 不切 `TESTNET_ENABLED`；
- 不产生任何 Binance Testnet / Production 交易所写；
- 不直接修改 SQLite live settings 行；
- 不删除或改写历史 UNKNOWN；
- 不改变 `maxGrossExposurePct / maxDirectionExposurePct / maxClusterExposurePct / maxClusterDirectionExposurePct / maxPositions`；
- 不放宽 private-data 60 秒 freshness、egress、UNKNOWN、JIT、reachability、`0.15`、经济门或安全门；
- 不改 `aiExitAuthority=SHADOW`；
- 不为“过门”伪造 bracket / correlation / scenario 版本或数据。

当前 live PID `34196` / build `3.9.6-eaaabc52c682cc1ce56a` 只允许只读观察，不得触碰生命周期。

---

## A. 红测先行：把当前缺陷钉死

先在当前未修产品上写失败测试并保留红测 transcript，至少证明：

1. `ExternalTradeAdapter` 没有可复用的 Testnet bracket authority 只读采集能力；
2. 当前唯一 `/fapi/v1/leverageBracket` 路径位于 `setLeverage()`，只取 `initialLeverage`，丢弃完整 tier 行，并且随后会 POST `/fapi/v1/leverage`，不能作为只读 authority collector；
3. `portfolioRiskProfileBlockers()` 当前只凭：
   - `marginTierVersion` 非空；
   - `maintenanceMarginRatePct` finite；
   - `correlationVersion` 非空；
   - `scenarioVersion` 非空且 scenarios 非空；
   就可能把这些事实视为已证明；若有人绕过治理层直塞占位字符串，运行层缺少真正的数据集绑定；
4. 通用 `PATCH /api/v3/settings/governance` 当前拒绝 `marginTierVersion / correlationVersion / scenarioVersion / scenarios / clusters`，这个拒绝是正确安全边界，修复后仍必须成立；
5. whole-settings PUT 也不能绕过治理矩阵；
6. 2026-09-24 正式激活轮返回 400 `GOVERNANCE_PATCH_REFUSED` 是预期事实，不得把它“修成所有字段 editable=true”。

红测必须真实失败于旧实现，而不是先改代码再补一个永远绿的测试。

---

## B. Testnet 保证金档位只读权威采集器

### B1. 新增独立 read capability

在 Exchange adapter/interface 增加独立只读能力，例如：

```ts
fetchMaintenanceMarginBrackets(symbols: string[]): Promise<MarginBracketAuthorityRead>
```

名称可调整，但语义必须满足：

- 只允许 GET `/fapi/v1/leverageBracket`；
- 不得复用 `setLeverage()` 作为采集器；
- 不得 POST `/fapi/v1/leverage`；
- 不得调用 `placeEntry/cancelEntry/replaceEntry/placeTakeProfit` 等任何 writer；
- 采集本身在 `READ_ONLY` 下可运行；
- 用当前 Binance Testnet private credentials、当前 proxy、当前 egress、当前 request-budget 网络边界；
- 不新增直连 Binance 的第二条网络路径；
- 用现有 signed private GET；
- 对正式 Testnet authority 采集要求 `environment=TESTNET`，PRODUCTION 上不得生成可用于 Testnet 激活的 authority dataset。

### B2. Coverage

每次 authority collection 的 required symbol coverage 必须由运行事实形成，不写死“13 个”：

```text
requiredSymbols =
  当前所有非零 live position symbols
  UNION
  当前 Entry 可路由 / 可执行 candidate universe 中可能进入 sizing 的 symbols
```

要求：

- symbol 大写、去重、稳定排序；
- 同一 symbol 一轮最多请求一次；
- `/leverageBracket` 权重当前是 30，必须有有界串行或严格 bounded concurrency，禁止请求风暴；
- 任一 required symbol 缺失、HTTP 失败、返回空档位或解析含糊 => authority collection `NOT_READY`，不得构造 READY profile；
- 不允许因为某个币“暂时没候选”而遗漏已有 live position 的 bracket。

### B3. Canonical margin dataset

构造确定性的 canonical dataset。至少包含：

```text
schema/version tag
source = BINANCE_TESTNET_LEVERAGE_BRACKET
exchangeEnvironment = TESTNET
account scope / credentialRef identity（不可包含密钥）
coverageSymbols[]
symbols[]:
  symbol
  brackets[]:
    bracket/tier id
    notionalFloor
    notionalCap
    maintenanceMarginRatio
    initialLeverage
    cum（如果 Binance 返回）
```

要求：

- symbols 稳定排序；
- brackets 按 bracket id / floor / cap 稳定排序；
- 精确规范化 Binance 返回字段；如果 Binance 返回字段名为 `maintMarginRatio` 等，统一映射成内部明确字段，但保留来源字段语义；
- 所有数值 finite；notional floor/cap 非负并满足区间关系；maintenance ratio 非负；initial leverage > 0；
- 重叠档、非法倒序、同档冲突、无法证明覆盖的 reachability 区间都 fail-closed；
- `observedAt/fetchedAt` 可以保留在 provenance，但**不得进入 content identity hash**，否则同一档表每次读取都会产生新版本；
- hash 必须包含：schema/source/environment/account scope/coverageSymbols/完整规范化 tier 内容；
- raw response 可保存到证据，不得把密钥或签名写入证据。

### B4. Server-derived version

版本必须由服务端从 canonical dataset 自己计算：

```text
marginTierVersion = TESTNET_BINANCE_BRACKET_SHA256_<sha256(canonical-content)>
```

格式可略调，但必须满足：

- deterministic；
- 同内容同版本；
- bracket 任一有效字段变化 => hash/version 变化；
- 客户端不能只提交一个自称的 version 来解锁；
- 若 API 允许客户端携带 expected hash，只能用于 compare/assert，必须与服务端重算值逐字相同，否则拒绝。

### B5. maintenanceMarginRatePct 必须服务端派生

不能继续把 `maintenanceMarginRatePct` 当成可以独立自由填写的“事实”。

权威规则：

1. 对 required symbol 的 Entry sizing 可达 notional 区间，找到所有**可能实际进入**的 bracket；
2. 取这些可达 bracket 中 `maintenanceMarginRatio` 的**最大值**；
3. 如果 sizing envelope 本身无法被确定性证明，保守退化为 covered symbols 返回的**全部 bracket 中最大 maintenance ratio**；
4. 禁止取均值；
5. 禁止客户端降低这个派生值；
6. 任何缺档或不完整 coverage => 不产生可授权的 rate。

因此建议把治理矩阵里的 `riskGovernance.portfolioRisk.maintenanceMarginRatePct` 也改为 generic PATCH `editable:false`，`readOnlyReason` 明确说明它是 margin authority dataset 的服务端派生事实；如果采用其他等价设计，也必须确保普通 PATCH/PUT 不能自行覆盖该值。

---

## C. 专用 PortfolioRisk Authority 原子提交通道

### C1. 不解锁现有 locked rows

这些通用治理字段继续保持 `editable:false`：

- `marginTierVersion`
- `correlationVersion`
- `scenarioVersion`
- `scenarios`
- `clusters`
- 建议 `maintenanceMarginRatePct` 同样变为 dataset-derived readonly

禁止简单把它们改成 `editable:true`。

### C2. 增加专用整体提交 API / service

例如：

```text
POST /api/v3/settings/portfolio-risk-authority
```

准确路径可以按现有 API 风格调整，但它必须是**专用 authority commit**，不能伪装成普通 patch。

请求语义可类似：

```json
{
  "expectedSettingsVersion": 197,
  "acks": ["PORTFOLIO_RISK_PROFILE_ENABLED"],
  "limits": {
    "configured": true,
    "maxCapitalAtRiskUsd": "...",
    "maxDrawdownPct": "...",
    "maxStressLossUsd": "...",
    "maxGrossNotionalUsd": "...",
    "maxDirectionNotionalUsd": "...",
    "maxClusterNotionalUsd": "...",
    "minMarginBufferPct": "...",
    "minLiquidationBufferPct": "...",
    "maxHumanPositions": "...",
    "maxHumanNotionalUsd": "...",
    "maxPendingHandoffs": "...",
    "maxAckAgeMs": "...",
    "snapshotTtlMs": "...",
    "cashFlowWindowMs": "...",
    "cashFlowMaxAgeMs": "..."
  },
  "authority": {
    "marginTier": { "...canonical collected dataset or collection id...": "..." },
    "correlation": { "clusters": {} },
    "scenarios": { "scenarios": [] }
  }
}
```

精确 DTO 可不同。

### C3. 服务端是唯一 authority compiler

服务端必须：

1. 验证 operator numeric limits 仍使用现有 governance matrix 的 type/range/ack 语义，不复制第二套不同区间；
2. 验证 margin dataset 是当前 TESTNET/account scope 的真实 collector 产物；
3. canonicalize margin dataset；
4. 自己计算 margin hash/version；
5. 自己派生 conservative maintenance rate；
6. canonicalize correlation dataset，自己算 version/hash；
7. canonicalize scenarios，自己算 version/hash；
8. 构造最终完整 `riskGovernance.portfolioRisk`；
9. SystemSettingsSchema 最终 parse；
10. 再原子持久化。

客户端不得拥有“我说这个 version 是什么就是什么”的权限。

---

## D. Correlation / Scenario authority 数据集

### D1. Correlation

继续沿用正式激活计划的 Testnet discovery 语义：

```json
{
  "clusters": {}
}
```

它是**operator-defined Testnet engineering model**，不是统计相关性预测。

当前 stress engine 会把未映射 underlying 归入 `UNMAPPED_CORRELATED`，因此 `{}` 仍是保守聚合，而不是“无相关性”。

不要继续把人为常量 `TESTNET_DISCOVERY_UNMAPPED_CONSERVATIVE_V1` 当真正 authority version；可以保留 label/description，但真正 `correlationVersion` 必须由 canonical `{clusters:{}}` + schema/semantic identity 的 hash 派生。

### D2. Scenario dataset

精确沿用前一轮已经批准用于 Testnet engineering discovery 的 3 个场景：

```json
[
  {
    "id": "DOWN_10_LIQUIDITY",
    "priceShockPct": -0.10,
    "spreadWidenPct": 0.01,
    "fundingShockPct": 0.005,
    "markBasisShockPct": -0.01,
    "depthPenaltyPct": 0.02,
    "exchangeUnavailable": false,
    "unavailablePenaltyPct": 0,
    "clusterConvergencePct": 0.50
  },
  {
    "id": "UP_10_LIQUIDITY",
    "priceShockPct": 0.10,
    "spreadWidenPct": 0.01,
    "fundingShockPct": 0.005,
    "markBasisShockPct": 0.01,
    "depthPenaltyPct": 0.02,
    "exchangeUnavailable": false,
    "unavailablePenaltyPct": 0,
    "clusterConvergencePct": 0.50
  },
  {
    "id": "EXCHANGE_GAP_15",
    "priceShockPct": -0.15,
    "spreadWidenPct": 0.02,
    "fundingShockPct": 0.005,
    "markBasisShockPct": -0.02,
    "depthPenaltyPct": 0.03,
    "exchangeUnavailable": true,
    "unavailablePenaltyPct": 0.03,
    "clusterConvergencePct": 0.75
  }
]
```

要求：

- canonical sort by `id`；
- object keys deterministic；
- scenarioVersion = 服务端 canonical dataset content hash 派生；
- JSON key 顺序变化不应改变 hash；
- 场景任何参数变化必须改变 hash；
- 旧 version + 新 dataset / 新 version + 旧 dataset 都拒绝；
- 报告里只能称 Testnet engineering scenarios，不得写成概率或预测。

---

## E. Durable authority store 与真正原子性

仅把 version/string 写入 Settings 不够。

在 `SettingsStore` SQLite 中增加 durable authority storage（表名可按项目命名），例如：

```text
portfolio_risk_authority
  authority_id / kind
  environment
  account_scope
  schema_version
  content_hash
  canonical_payload
  observed_at / committed_at
  settings_version
  provenance
```

至少保存：

- margin canonical dataset + content hash + coverage + derived maintenance rate；
- correlation canonical dataset + hash；
- scenario canonical dataset + hash；
- TESTNET / account scope；
- settingsVersion binding；
- collector provenance，不含 secret。

### E1. 一次 SQLite 事务

专用 authority commit 必须在**同一个 `BEGIN IMMEDIATE ... COMMIT`** 中完成：

1. CAS 检查 `expectedSettingsVersion`；
2. 校验/写 authority rows；
3. 写新的 complete Settings payload；
4. settingsVersion **只递增一次**；
5. `settings_audit` 写入 hashes/coverage/derived rate 摘要；
6. commit；
7. 任一步失败 => rollback，全都不变。

不能出现：

- authority table 已更新但 Settings 还是旧的；
- Settings profile 已 configured=true 但 authority row 没写进去；
- 一次 authority 提交 settingsVersion 连跳多次。

现有 `saveIfVersion()` 语义应保留；如果新增专用 store 方法，必须同样 CAS 严格。

---

## F. Runtime 必须验证真正 authority，不再信任字符串

当前 `portfolioRiskProfileBlockers(profile)` 只看 profile object，修复后必须把真实 authority readback 纳入 runtime truth。

可以通过新增 `PortfolioRiskAuthorityService` / authority provider 注入 `PortfolioRiskAdmission`，具体结构自定，但必须满足：

### F1. READY 条件

Profile READY 至少同时要求：

- `configured=true`；
- numeric limit fields 完整合法；
- 当前 environment/account scope 存在 committed margin authority；
- Settings `marginTierVersion` == durable margin authority 的 server-derived version；
- Settings `maintenanceMarginRatePct` == durable authority 的 server-derived conservative rate；
- margin authority coverage 对当前 required scope 足够；
- correlation durable dataset 存在且 settings version/hash + clusters 与 durable dataset 一致；
- scenario durable dataset 存在且 settings version/hash + scenarios 与 durable dataset 一致；
- 任一 mismatch / missing / stale => `PROFILE_FACTS_UNPROVEN`，不能 READY。

**非空 version 字符串本身永远不能再生成 READY。**

### F2. Coverage 与新候选

不要把 profile READY 设计成启动时拍一次后永久 READY。

如果当前新 Entry candidate symbol 不在 margin authority coverage：

- fail-closed；
- `executionReadiness` / admission 给出具体如 `MARGIN_TIER_SYMBOL_UNPROVEN:<symbol>`；
- Anti-Waste 在无法执行时停止模型支出；
- 不得自动按“其他币的最大 rate”冒充该 symbol 的 bracket 已证明。

可以设计 coverage refresh workflow，但**观察到新 dataset 不能自动授予新的 authority**：collector 可以检测 drift/new symbols，最终 authority commit 仍需显式 operator action。

### F3. Drift

若之后重新采集到的 bracket canonical content 与当前 committed hash 不同：

- 标记 authority `STALE/MISMATCH`；
- profile readback => `PROFILE_FACTS_UNPROVEN`；
- `executionReadiness.ready=false`；
- `modelSpendPermitted=false`（AUTO intent 下）；
- 不允许新风险；
- 已有持仓/TP/保护/人工退出链继续工作；
- 不自动覆盖 operator-approved authority；
- 不自动切换到一个新 hash 并继续下单。

### F4. Readback

readback 至少暴露：

```text
status
source
environment
accountScope (non-secret)
contentHash/version
coverageSymbols
missingSymbols
derivedMaintenanceMarginRatePct
observedAt
committedAt
settingsVersion binding
mismatch/drift reason
```

Dashboard 如有展示，只能消费 Engine 投影，不能自己重算 hash/rate/READY。

---

## G. 不要误修 position-level 风险事实

特别注意：margin bracket authority **不能替代** live position facts。

`portfolioStress.ts` 当前还明确要求 current position 的：

- `maintenanceMarginUsd`
- `liquidationBufferPct`

这些仍必须来自真实 private position facts。

本轮严禁：

- 用 `maintenanceMarginRatePct * notional` 人工合成 `maintenanceMarginUsd` 再冒充 exchange fact；
- 缺 liquidationPrice 时自己估算 liquidation buffer；
- 用 profile 数据覆盖 live position fact 缺失。

下一次激活若因此出现 `MAINTENANCE_MARGIN_UNPROVEN` / `LIQUIDATION_BUFFER_UNPROVEN`，那是要真实暴露的下一层 blocker，不是本轮要“提前做绿”的东西。

---

## H. 敌意测试清单

至少增加以下测试，必须先有红后有绿：

1. **version-only 无 durable dataset** => profile 不 READY / commit 拒绝；
2. 客户端 forged margin version 与 server hash 不一致 => 拒绝；
3. required symbol 缺 bracket => fail-closed；
4. bracket 数值 NaN/Infinity/负 ratio/非法 floor-cap => fail-closed；
5. relevant tier ranges overlap / conflict / 无法覆盖可达 notional => fail-closed；
6. bracket 任一 tier 漂移 => hash/version 改变，旧 authority 失效；
7. caller 试图把 `maintenanceMarginRatePct` 写得低于 server-derived max => 拒绝或完全忽略客户端值并以 server-derived 值为唯一结果；
8. authority collector 全程 GET-only；断言 `setLeverage/placeEntry/cancelEntry/replaceEntry/placeTakeProfit` 与 transport write calls = 0；
9. generic governance PATCH 继续拒绝 locked authority fields；
10. whole Settings PUT 继续不能绕过；
11. 原子 commit 中任一步模拟失败 => settingsVersion/settings payload/authority rows 全不变；
12. 成功 authority commit => settingsVersion 恰 +1，Settings + authority rows 的 binding 一致；
13. correlation dataset/hash mismatch => 拒绝 / profile 不 READY；
14. scenarios dataset/hash mismatch => 拒绝 / profile 不 READY；
15. scenario JSON key 顺序变化但语义相同 => canonical hash 相同；
16. 46 durable UNKNOWN 仍保留，pending occupancy 继续由 `entryOrderOccupiesRisk` 权威语义决定，无回归；
17. authority missing/stale 时 Anti-Waste：SCOUT=0、Primary=0，但 deterministic Market/Pool/Candidate/Capital 供给继续；
18. Testnet authority collector 在 PRODUCTION context 不能产生可用于 Testnet activation 的 READY authority；
19. requiredSymbols 去重，单 symbol 一轮最多一个 bracket request；
20. request-budget fanout 有界，不能因为 50 个 universe 直接并发 50×weight30；
21. margin rate 必须等于**最大可达档**，不是平均值；
22. sizing envelope 不可证时必须退化到所有 covered tiers 的 max；
23. current candidate symbol 新出现且不在 coverage => specific blocker + model spend 0；
24. bracket drift 只能标记 stale，不能后台自动授予新 authority；
25. generic PATCH 对 `maintenanceMarginRatePct` 若改成 read-only，也必须有拒绝测试。

---

## I. 代码落点建议（不是强制命名）

优先复用现有结构，避免第二套真值：

- `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts`
  - 增加纯 GET bracket collector；
- `apps/engine/src/types.ts`
  - 增加 adapter read capability / DTO；
- 新建类似 `apps/engine/src/services/portfolioRiskAuthority.ts`
  - canonicalization/hash/coverage/derived rate/dataset validation；
- `apps/engine/src/config/settingsStore.ts`
  - durable authority table + atomic CAS commit/read methods；
- `apps/engine/src/api/runtimeSettingsResources.ts`
  - dedicated authority collect/commit/readback endpoint；
- `apps/engine/src/config/governanceSettingsMatrix.ts`
  - 继续锁死 dataset/version rows；必要时把 derived maintenance rate 改 read-only；
- `apps/engine/src/services/portfolioRiskLedger.ts`
  - profile blockers/readback/admission 绑定 durable authority；
- `apps/engine/src/services/executionReadiness.ts`
  - 继续消费同一 profile authority blockers，不自建第二套规则；
- Dashboard 若需要，只显示 server authority projection；不是本轮必须项。

不要新建一个跟现有 `PortfolioRiskAdmission` 平行的第二套 risk admission。

---

## J. 全仓门禁

完成红→绿后至少执行并记录真实 exit code：

1. 新增/受影响 targeted tests；
2. Engine 全仓 tests；
3. Engine typecheck；
4. Engine build **只能输出到隔离 `build-check/`**，不得覆盖 live `apps/engine/dist`；
5. Dashboard 若修改：tests/typecheck/build 同样 scratch output；
6. core typecheck/tests（当前基线约 46 tests，按实际结果报告）；
7. contracts typecheck/tests；若仍 0 tests，只写“0 tests”，不得称 contract coverage；
8. `npm run verify:deps`；
9. `npm run verify:scripts`；
10. `node scripts/v396-s00-static-check.mjs`；
11. `node scripts/v396-storage-coverage.mjs --check`；
12. `git diff --check`。

如果 full `npm run verify` 会覆盖 live dist，不得为了“跑一个总命令”污染当前运行实例；继续采用已接受的 scratch-build 等价门禁，并在报告说明。

本轮所有 isolated test 不得指向 live dataDir / live port / Binance writer。

---

## K. 证据与报告

创建：

```text
docs/reports/v396-testnet-risk-authority-dataset-20260924.md
docs/evidence/v396/testnet-risk-authority-dataset-20260924/
```

至少保存：

- baseline HEAD / live PID/build/settingsVersion（只读）；
- 红测 transcript；
- source changed list；
- sanitized bracket fixture / raw-shape example；
- canonical dataset example；
- deterministic hash derivation；
- derived maximum maintenance ratio proof；
- required symbol coverage proof；
- generic PATCH refusal proof；
- whole PUT bypass refusal proof；
- atomic rollback hostile test；
- successful atomic binding test；
- drift invalidation test；
- Anti-Waste authority-missing/stale test；
- 全部 gate transcripts + exit codes；
- `git diff --check`；
- 明确声明本轮：
  - Engine lifecycle = 0；
  - live dist writes = 0；
  - live Settings writes = 0；
  - exchange writes = 0；
  - executionMode 未改变；
  - Production writes = 0。

不能在本轮报告中声称 live profile READY，因为新产品尚未部署。

---

## L. Git 与提交

- 产品代码独立 commit；
- report/evidence 可再独立 commit；
- 最后 fetch + ff-only push convergence；
- 不 force；
- worktree clean；
- PR #9 untouched。

若本轮范围内发现新的 P0/P1，直接在这一轮离线修完并重新跑门禁；不要再把同一个离线产品问题拆成多个“请批准下一轮”。

但**不要申请/执行 Engine stop/start**：等产品代码与所有门禁全部绿后，下一轮才是一次明确的部署授权，然后再继续既有正式 Testnet 激活计划 §C → §D → §E → §F。

---

## M. 最终必须直答 12 问

1. 最终 HEAD 是什么？相对 `45aeffd` 改了哪些产品文件？
2. Testnet bracket collector 是否纯 GET？是否任何 write call = 0？
3. requiredSymbols 如何形成、去重、限并发？
4. canonical margin dataset 的 schema / hash 输入是什么？时间戳是否排除在 content identity 外？
5. `marginTierVersion` 是否完全 server-derived？伪造 version 是否被拒？
6. `maintenanceMarginRatePct` 是否等于最大可达档；sizing 不可证时是否取全覆盖 tiers 最大值？
7. generic PATCH / PUT 是否仍不能写 dataset/version/derived authority facts？
8. correlation/scenario versions 是否由随行数据集 hash 产生？旧 version + 新数据是否被拒？
9. Settings 与 durable authority 是否真正单事务 CAS，失败是否全回滚，成功 settingsVersion 是否只 +1？
10. runtime profile READY 是否必须验证 durable authority，而不是只看非空字符串？bracket drift/new symbol 未覆盖会发生什么？
11. 46 durable UNKNOWN / pending occupancy / TP / ownership 语义是否完全未回归？所有门禁 exit code 是什么？
12. 当前是否已经具备“可部署 authority plumbing”的条件？如果是，下一轮只需要一次部署后即可重新执行正式 Testnet 激活；如果否，唯一 remaining blocker 是什么？

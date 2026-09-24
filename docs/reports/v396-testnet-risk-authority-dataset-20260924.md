# V3.9.6 — Testnet PortfolioRisk 权威数据集（2026-09-24）

执行计划：`docs/plans/v396/CODEX-V396-TESTNET-RISK-AUTHORITY-DATASET-20260924.md`
基线 HEAD（本轮起点）：`f2b5589877d5245ada7f4dfef83b13d4999a4216`

## 0. 结论

**`V396_TESTNET_ACTIVE_ANALYSIS_ONLY`** —— 本轮交付的是**可部署的 authority plumbing**（纯读采集器 + canonical 数据集 + 单事务 durable 提交 + runtime 真值校验 + 敌意测试 + 全仓门禁）。

本轮**没有**任何 Engine 生命周期动作、没有部署、没有 live Settings 写、没有任何交易所写；因此**不声称 live profile READY**：新产品尚未运行，线上仍是 `d570bef` 内容树的 `3.9.6-eaaabc52c682cc1ce56a` 实例。

零写声明（全部为实测，不是推定）：

| 项目 | 本轮值 | 证据 |
| --- | --- | --- |
| Engine lifecycle（stop/start/restart/hot reload） | **0** | 未执行任何 `scripts/stop-zdj-lan.ps1` / `start-zdj-lan.ps1`；实例仍为 PID 34196 / instanceId `1c10189b…` / startedAt 1790203326563 |
| live dist 写 | **0** | `gates/13-live-dist-identity-after-gates.txt`：全部门禁后 `artifactHash` 仍为 `eaaabc52c682cc1ce56afaa9301fd18aa64c6a51ab99ebfe3c770949660d2786`（与启动时记录逐字节相同） |
| live Settings 写 | **0** | `settingsVersion` 本轮只读观测两次均为 **197**（`02-live-governance-readback.txt`、`06-live-write-boundary.txt`）；未调用任何写路由 |
| 交易所写（Testnet/Production） | **0** | `productionWriteBoundary`：`testnetWrites=0`、`productionWrites=0`、`blockedProductionWriteAttempts=0`、`lastWriteAt=null`；本轮进程内**未发起任何到 Binance 的请求**（含 GET） |
| `connections.executionMode` | **未改变**（`READ_ONLY`） | 同上 |
| Production 边界 | `environment=TESTNET`、`lockedToTestnet=true` | 同上 |
| 历史 UNKNOWN | 未删除、未改写（46 条 `verifiedNoActiveRiskUnknownCount=46`、`activeRiskUnresolvedCount=0`） | `01-live-readonly-baseline.txt` |
| 阈值/freshness/egress/JIT/reachability/0.15/`aiExitAuthority` | **全部未放宽**（`aiExitAuthority=SHADOW`，`maxGross/Direction/Cluster ExposurePct`、`maxPositions` 未动） | `02-live-governance-readback.txt` |

## 1. 红测先行（§A）

两份红测记录在 `red-01-missing-capability.txt`、`red-02-behavioural.txt`，它们给出的是本轮真正要修的两个事实：

1. **能力缺失**：产品内不存在任何 Testnet 保证金档位读取路径。唯一会打 `/fapi/v1/leverageBracket` 的代码是 `setLeverage()` 内部的私有辅助，它紧接着 `POST /fapi/v1/leverage` —— 也就是"读档位"与"写档位"在旧代码里是同一次调用，READ_ONLY 下不可用。
2. **行为红**：`marginTierVersion / correlationVersion / scenarioVersion` 三个非空字符串 + 一个手填 `maintenanceMarginRatePct` 就能让 `portfolioRiskProfileStatus()` 返回 `READY`。函数签名里根本没有"durable 数据集"这个输入，所以任何字符串都等价于证明。这正是 `45aeffd` 那轮激活被 §B3 阻断的根因面。

红测的 400 `GOVERNANCE_PATCH_REFUSED`（数据集字段 locked）是**正确边界**，本轮没有把它修成 `editable=true`：修的是"缺一个专用提交通道"，不是"把锁打开"。

## 2. 改了什么

产品代码（11 个文件已跟踪 + 3 个新文件）：

| 文件 | 作用 |
| --- | --- |
| `apps/engine/src/services/portfolioRiskAuthority.ts` **（新）** | 唯一的 authority 编译器：canonical 化、内容 hash、server-derived version、保守维持保证金率派生、数据集校验、durable 行复验、readback 投影 |
| `apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts` | 新纯读能力 `fetchMaintenanceMarginBrackets(symbols,{maxInFlight,credentialRef})` |
| `apps/engine/src/types.ts` | adapter 读能力 DTO |
| `apps/engine/src/config/settingsStore.ts` | 迁移 `schema_migrations=10` 建 `portfolio_risk_authority`；`commitPortfolioRiskAuthority()`（单 `BEGIN IMMEDIATE` + CAS + 只 +1）；`readPortfolioRiskAuthority()`（读时复验） |
| `apps/engine/src/api/runtimeSettingsResources.ts` | 专用通道 `POST/GET /api/v3/settings/portfolio-risk-authority`；携带 version/rate/brackets/credential 的请求直接 400 |
| `apps/engine/src/config/governanceSettingsMatrix.ts` | `maintenanceMarginRatePct` 改为 `editable:false`（派生事实），五个数据集行继续保持 locked |
| `apps/engine/src/services/portfolioRiskLedger.ts` | profile 校验/`profileReadback` 接入 durable authority；JIT `inputs()` 不再走"只看形状"的弱层，候选 symbol 纳入覆盖检查 |
| `apps/engine/src/services/executionReadiness.ts` | 消费同一个 durable authority（不再是第二套规则）；新增 `MARGIN_TIER_NO_COVERED_CANDIDATE` |
| `apps/engine/src/runtime/appRuntime.ts` | 冷启动即复验 durable authority；`commitPortfolioRiskAuthority`；required-symbol 派生；drift 巡检；readiness 传入 authority 与可执行候选 |
| 4 个测试文件（`testnetRiskAuthority.test.ts` 新、`portfolioRiskAuthorityStore.test.ts` 新、`executionReadiness.test.ts`、`runtimeSettingsResources.test.ts`、`s05ConsumerBoundary.test.ts`） | 敌意测试与夹具 |

Dashboard **未修改**：它没有任何 portfolioRisk 编辑表单（`grep` 只有 1 个测试文件提到该词），且 `governanceReadback` 已经把 `editable` 由服务端下发，`editable:false` 自然生效。§I 也明确 Dashboard 不是本轮必须项。

## 3. 关键实现裁决

- **margin 数据不来自客户端**。`POST /settings/portfolio-risk-authority` 的 body 只有 `limits / correlation.clusters / scenarios / acks / expectedSettingsVersion / operator`。档位表由本进程用当前凭证、当前代理、当前 request budget 去 GET；客户端携带 version、rate、brackets、credential 任一字样一律 400 `PORTFOLIO_RISK_AUTHORITY_FIELD_IS_SERVER_DERIVED`。这样"伪造 version"没有落点：请求里根本没有能承载它的字段。
- **内容身份不含时间**。hash 覆盖 `schema + environment + accountScope + credentialRef + 全部规范化 tier`；`observedAt / committedAt / reachability / operator` 留在 provenance。同一张档位表第二次采集 **不会**生成新 version（已测），任一层数值漂移 **必须**生成新 version（已测）。
- **保守上界，不是平均值**。可证 sizing 区间 → 取可达档位的最大 maintenance ratio；不可证 → 取全部已覆盖档位的最大值。同一份夹具：`REACHABLE=0.005`、`ALL_COVERED=0.025`、"平均"会是 `0.011`（`03-canonical-dataset-derivation.txt`）。
- **读时也复验**：`readPortfolioRiskAuthority()` 用存储的 canonical payload 重算 hash/version/派生率。手工改一个 `maintenanceMarginRatio` 数字 → `AUTHORITY_CONTENT_HASH_MISMATCH:margin` → runtime 视为无 authority，而不是信任存储的 hash。
- **单一 occupancy authority 未动**：`builtPending` 仍是 `d570bef` 那一次 `collectPortfolioPendingRiskFacts(state,{now})` 调用；46 条 durable UNKNOWN 的语义、pending 占用、TP、ownership 全部由既有回归守住。

## 4. 敌意测试映射（§H 1–25）

净新增 **38 项测试**（authority compiler 24 + durable store 6 + executionReadiness 3 + settings routes 5），另有 `s05ConsumerBoundary` 与 shape-layer 断言的强化；四个文件合跑 61 项全绿（`05-hostile-test-inventory.txt`）。Engine 全仓最终 **157 files / 1232 tests**、`tsc --noEmit` 无诊断。

| §H | 位置 |
| --- | --- |
| 1 version-only 无 durable dataset | `H1 a non-empty version triple with no committed authority is never READY`；`H1 spends no model on a profile whose versions name no committed authority`；shape 层断言补 `MARGIN_AUTHORITY_MISSING` |
| 2 客户端伪造 version | `MARGIN_TIER_VERSION_MISMATCH` 用例；store `AUTHORITY_COMMIT_UNVERIFIED:AUTHORITY_CONTENT_HASH_MISMATCH:margin`；route `…FIELD_IS_SERVER_DERIVED` |
| 3 required symbol 缺 bracket | `MARGIN_BRACKET_MISSING:SOLUSDT`；commit 通道 `H3 reports the missing bracket by name and commits nothing` |
| 4 NaN/Infinity/负 ratio/非法 floor-cap | `rejects NaN, Infinity, negative ratios and inverted floor/cap…`（6 个子样） |
| 5 区间重叠/冲突/不可覆盖 | `rejects two tiers that claim the same range…`；`refuses an unprovable tier gap…`；`MARGIN_BRACKET_RANGE_UNCOVERED` |
| 6 任一层漂移 → 新 version | `changes the hash when any tier drifts, and keeps it for observation-time-only differences` |
| 7 调用方不能调低派生率 | `H7/H25 refuses a PATCH that only wants to lower the derived maintenance rate`（`GOVERNANCE_FIELD_READ_ONLY`）+ `MAINTENANCE_RATE_MISMATCH` |
| 8 collector 全程 GET-only | `H8 collects by GET only…`：路径集合恰为 `{/fapi/v1/leverageBracket, /fapi/v1/time}`，`writes=[]`，无 `/fapi/v1/leverage` |
| 9 generic PATCH 继续拒绝 | `H9 refuses to write a dataset version through the patch channel at all` |
| 10 whole PUT 不能绕过 | `H10 keeps refusing a whole-settings PUT that tries to name a dataset version`（4 个 blockedPaths） |
| 11 事务中任一步失败 → 全回滚 | `H11 rolls every byte back when a dataset row write fails mid-transaction`（在第三行注入 `RAISE(ABORT)`，断言 settingsVersion、三行 hash 全不变） |
| 12 成功提交 → version 恰 +1 且绑定一致 | `writes the three dataset rows and the settings row together, bumping the version exactly once` |
| 13/14 correlation / scenario mismatch | `accepts exactly the profile the compiler produced and nothing weaker`（6 个篡改方向） |
| 15 key 顺序无关 | `is insensitive to JSON key order and scenario order…` |
| 16 46 durable UNKNOWN 无回归 | 全仓 1232 tests 绿（含 `pendingRiskOccupancyConvergence`、`j2PortfolioAdmissionHostile`、`finalRiskConvergence`）+ 线上 `historicalUnknownCount=46 / activeRiskUnresolvedCount=0` |
| 17 authority missing/stale → 模型支出 0，供给继续 | `H1 spends no model…`、`H17 stops paying for a PLACE the moment the committed bracket table drifts`（闸在 `processPool()` 之前、`ai.probePrimaryIfDue` 之外，SCOUT 与 Primary 一起停；`processPool` 仍被调用） |
| 18 PRODUCTION 不能铸造 Testnet authority | `H18 refuses a production context…`（compile / adapter / runtime 三层各测） |
| 19 去重、单轮每 symbol 一次 | `issues one signed GET per required symbol…`（`['btcusdt','BTCUSDT','ethusdt']` → 2 次请求） |
| 20 fan-out 有界 | `bounds fan-out…`（40 symbol，峰值并发 ≤4 且 >1） |
| 21/22 max 而非 avg；不可证退化 | `takes the maximum applicable bracket rate, never an average…`、`uses the reachable bracket range when sizing envelopes are provable…` + §3 的 0.025 vs 0.005 vs 0.011 |
| 23 新候选未覆盖 | `H23/H3 a candidate symbol outside the committed coverage fails closed…` + `F2 the admission itself refuses…`（admission 级 `MARGIN_TIER_SYMBOL_UNPROVEN:DOGEUSDT`） |
| 24 drift 只标记 stale，不自动授予 | `H24 marks a drifted bracket table stale and never adopts the new hash`（Settings 里 version 仍是旧值，store 仍只被调用 1 次） |
| 25 PATCH 对 read-only rate 的拒绝测试 | 同 7 |

## 5. 门禁（§J，真实 exit code）

| # | 命令 | EXIT | 结果 |
| --- | --- | --- | --- |
| 1 | targeted（9 文件，含新 30 项） | 0 | 108 passed |
| 2 | Engine 全仓 `vitest run` | 0 | **1232 passed / 157 files** |
| 3 | Engine `tsc --noEmit` | 0 | 无诊断 |
| 4 | Engine build → `build-check/`（用后删除） | 0 | 产出含 `portfolioRiskAuthority.js`；live `apps/engine/dist` 内**无**该文件 |
| 5 | Dashboard | — | 未修改，故未跑其 tests/build（§J5 条件不触发） |
| 6 | core typecheck / tests | 0 / 0 | **46 passed**（与基线一致） |
| 7 | contracts typecheck / tests | 0 / 0 | **0 tests**（`--passWithNoTests`；本轮未新增契约测试，不称 contract coverage） |
| 8 | `npm run verify:deps` | 0 | contracts + core build |
| 9 | `npm run verify:scripts` | 0 | 含 4 个 PowerShell 脚本契约测试 PASS |
| 10 | `node scripts/v396-s00-static-check.mjs` | 0 | `blockers: []`，`repositoryDataDirReferences=0`，`productionPortReferences=0` |
| 11 | `node scripts/v396-storage-coverage.mjs --check` | 0 | `STORAGE_COVERAGE_CHECK_PASS gate=S08_STORAGE_COVERAGE_PASS` |
| 12 | `git diff --check` | 0 | 无空白错误 |

所有 isolated test 使用 `mkdtemp` 的独立 dataDir、随机端口（`listen(0)`）与假 transport：**不指向 live dataDir / live port / Binance writer**。

## 6. 最终 12 问直答（§M）

1. **HEAD / 改了哪些产品文件**：起点 `f2b5589`；产品与测试代码独立 commit `34208fc`，本报告与证据在其后的 docs commit。产品文件 9 改 + 1 新（见 §2 表），另有 5 个测试文件（2 新 3 改）。
2. **collector 是否纯 GET、write=0**：是。`/fapi/v1/leverageBracket` 每 symbol 恰一次 + 至多一次 `/fapi/v1/time` 时钟同步；`assertTestnetExchangeWrite` 命中数 **0**；未复用 `setLeverage`，无 `POST /fapi/v1/leverage`；READ_ONLY 下可用（它不是 writer）。
3. **requiredSymbols 如何形成/去重/限并发**：`state.positionSymbols() ∪ activeEntrySymbols() ∪ pool.readyList()`，大写去重排序；上限由"当前能被执行的集合"决定（持仓槽 + 池 ≤24），不是 universe（默认 `universeTopN=100` 会产生 100×weight30，超预算）；并发 worker 池 `≤4`，且 `Math.min(4,…)` 硬夹。
4. **canonical schema / hash 输入 / 时间排除**：`{schema:TESTNET_BINANCE_LEVERAGE_BRACKET_V1, environment:'TESTNET', accountScope, credentialRef, dataset:[{symbol,tiers:[{bracket,notionalFloor,notionalCap,maintenanceMarginRatio,initialLeverage,cum}]}]}`；`observedAt/committedAt/reachability/operator` 在 provenance，**不进 hash**（已测同表重采 hash 不变）。原始响应只进证据，密钥/签名从不落地。
5. **`marginTierVersion` 是否完全 server-derived、伪造是否被拒**：是，`TESTNET_BINANCE_LEVERAGE_BRACKET_V1_SHA256_<64hex>` 只由编译器产生；请求携带该字段 → 400；伪造 facts 提交 → store 复验抛 `AUTHORITY_COMMIT_UNVERIFIED`；Settings 字符串与 durable version 不等 → `MARGIN_TIER_VERSION_MISMATCH`。
6. **rate 是否等于最大可达档、不可证是否退化到全覆盖最大值**：是；夹具实测 `REACHABLE_TIERS=0.005`、`ALL_COVERED_TIERS=0.025`、平均 0.011（被明确否决）。
7. **generic PATCH / PUT 是否仍不能写数据集与派生事实**：是。`configured/marginTierVersion/correlationVersion/scenarioVersion/scenarios/clusters` 维持 `editable:false`，`maintenanceMarginRatePct` 本轮**新增**为 `editable:false`；PUT 路径 `governanceGuard` 拒绝并列出 blockedPaths（测试断言 4 条）。
8. **correlation/scenario version 是否由随行数据集 hash 产生、旧 version+新数据是否被拒**：是。`TESTNET_CORRELATION_CLUSTERS_V1_SHA256_*` 来自 `{schema,clusters}`，`TESTNET_STRESS_SCENARIO_SET_V1_SHA256_*` 来自按 id 排序的 `{schema,scenarios}`；`{clusters:{}}` 保留 label 语义但 identity 是 hash；数据换而 version 不换 → `*_AUTHORITY_MISMATCH`；key 顺序换而内容不换 → hash 不变。
9. **是否真单事务 CAS、失败是否全回滚、成功是否只 +1**：是。`BEGIN IMMEDIATE`（经 `SettingsStore.transaction()`，含嵌套/异步回调禁令）内做 CAS 复查 → 写 3 行 authority → 写 settings → 写 1 行 `settings_audit`（含 hash/覆盖率计数/派生率）→ 写 connection_profiles → COMMIT。注入第 3 行 `RAISE(ABORT)` 后：settingsVersion、3 行 hash、`settings_audit` 全不变。
10. **runtime READY 是否必须验证 durable authority；drift/新 symbol 未覆盖会怎样**：必须。`facts=null` → `MARGIN_AUTHORITY_MISSING`，`PROFILE_FACTS_UNPROVEN`，`modelSpendPermitted=false`；新候选未覆盖 → admission 级 `MARGIN_TIER_SYMBOL_UNPROVEN:<SYM>`，且当**本 tick 可执行候选全部未覆盖**时预模型闸给 `MARGIN_TIER_NO_COVERED_CANDIDATE` 直接停止模型支出；drift → `MARGIN_AUTHORITY_STALE`，不自动采用新 hash，已有持仓/TP/人工退出链不受影响。
11. **46 durable UNKNOWN / pending / TP / ownership 是否无回归；门禁 exit code**：无回归（§5 全 0；§4 第 16 行）。
12. **是否已具备"可部署 authority plumbing"条件**：**是**。本轮范围内不再有未闭合的产品缺口，下一轮只需一次部署（正式 build + 一次受控 stop + 一次 `MANUAL_START`），即可继续既有正式 Testnet 激活计划 §C→§H。

## 7. 本轮明确没做（停止线）

1. 没有采集任何真实 Testnet 档位数据（本轮禁网禁写部署），因此 `03/04` 号证据里的数值是**合成夹具**，不能当作 coverage 证明。真实 coverage 只能来自部署后的第一次 `POST /settings/portfolio-risk-authority`。
2. 没有为 `reachability`（Entry sizing 区间）接上真值来源，因此当前必然走 `ALL_COVERED_TIERS` 保守退化。**不去**用持仓均值之类的假象把它"做绿"。
3. 没有"修好" `MAINTENANCE_MARGIN_UNPROVEN` / `LIQUIDATION_BUFFER_UNPROVEN`：那是 §G 要求真实暴露的下一层私有事实（`04` 号证据里 admission 测试明确断言它们仍在）。**不**用 `rate × notional` 合成 `maintenanceMarginUsd` 冒充交易所事实。
4. 没做 drift 的自动刷新/自动授予：`inspectPortfolioRiskAuthorityDrift()` 只诊断并标 stale，授予必须再来一次显式 operator commit。**不**加后台自动 commit。
5. 没碰 Dashboard、没改任何 exposure/`maxPositions`/freshness/egress/`aiExitAuthority`，**不**再为"过门"新增第二套 risk admission。

## 8. 证据目录

`docs/evidence/v396/testnet-risk-authority-dataset-20260924/`

```
00-pre-gate-dist-identity.txt        门禁前 live dist 内容树 hash（=启动时 buildId）
01-live-readonly-baseline.txt        HEAD / 实例身份 / /health（46 UNKNOWN 等）
02-live-governance-readback.txt      settingsVersion=197 与 portfolioRisk 全字段只读回读
03-canonical-dataset-derivation.txt  canonical dataset / hash / 三个 version / 派生率 / 漂移与时间语义
04-bracket-raw-shape-synthetic.txt   合成（非实采）bracket 原始形状与 provenance 边界
05-hostile-test-inventory.txt        61 项 verbose 测试清单
06-live-write-boundary.txt           executionMode/边界/写计数（全 0）
red-01-missing-capability.txt        红测：能力缺失
red-02-behavioural.txt               红测：字符串即可 READY
gates/02..13                         §5 全部命令 transcript + 真实 EXIT
```

# ZDJ-MITS V3.9.6 — Final Operational Truth Closeout（2026-09-26）

结论：**V396_FINAL_OPERATIONAL_TRUTH_CLOSED**

A–D 四项已在当前分支作为真实产品提交实现（`07794f2`），本地全部门禁与 formal build 绿色，
本轮唯一一次 `stop → MANUAL_START` 已消费并完成后停止/后启动身份闭环，四项行为在运行实例上在线验收。
Production 写入 0、被拦截的 Production 写尝试 0；Testnet 写入 8 笔全部为真实 reduce-only 止盈保护单并逐笔归因。
本轮没有放宽任何被冻结的经济/风险语义，也没有为了验收制造成交。

- 仓库 `3684993/ZDJMITS`，分支 `codex/v396-final-convergence-20260922`，runbook `docs/plans/v396/CODEX-V396-FINAL-OPERATIONAL-TRUTH-CLOSEOUT-20260926.md`
- 工作树 `D:\MITS-WORKTREES\v396-final-convergence-20260922`
- PR #9：未切换、未评论、未修改
- GitHub Actions / hosted CI：`NOT_RUN_BILLING_LIMIT`，本轮不作为验收路径；所有测试、typecheck、verification、S00、
  存储覆盖、formal build、lifecycle 与在线验收均在本机完成，未因 hosted CI 不可用而降低、删除或替换任何本地门禁

---

## 1. 提交与变更文件

| 提交 | 内容 |
| --- | --- |
| `8fa4cec` | 本轮 runbook（远端，非本地产生） |
| **`07794f2`** | A–D 产品实现：13 个产品文件 + 6 个测试文件 + S00 入口清单派生重算（20 文件，+429/−32） |
| 本报告所在提交 | 只含 `docs/evidence/…` 与 `scripts/…` 只读回采工具，不含产品源码（`apps/`、`packages/` 在 `07794f2` 之后零改动） |

产品文件：`apps/engine/src/adapters/exchange/ExternalTradeAdapter.ts`、`apps/engine/src/config/settingsStore.ts`、
`apps/engine/src/runtime/appRuntime.ts`、`apps/engine/src/services/{entryCoordinator,pipelineVerdict,portfolioRiskLedger,preAiExecutionEnvelope,tpGuardian}.ts`、
`apps/engine/src/state/runtimeState.ts`、`packages/contracts/src/trading.ts`、
`apps/dashboard/src/{stores/system.ts,views/PositionsView.vue}`。
测试：`pipelineVerdict.test.ts`、`entryCoordinator.test.ts`、`preAiExecutableSides.test.ts`、`c3RuntimeWiringHostile.test.ts`、
新增 `tpPositionFactTruth.test.ts`、`settingsStore.test.ts`、`testnetRiskAuthority.test.ts`（入口清单允许列表）。

推送后 `git rev-list --left-right --count origin/… HEAD` = `0 0`，普通 fast-forward push，无 force。

## 2. A — 风险准入的权威首因（根因与最终行为）

根因：G4 的唯一权威裁决只读 `noEntryReason`（管线级阻断）。当管线本身健康、而每一轮 Entry 尝试被
PortfolioRisk 拒绝时，没有任何字段携带"最新一轮的确定性准入裁决"，于是首因诚实地写成 `NONE`，
真实首因只存在于 `entryConversion.topDrop*` 与逐轮事件里。

最终行为（不新增并行权威模型，只补真源缺失的一环）：
- `RuntimeState.lastRiskAdmissionVerdict`：仅由两个会拒绝新增风险的确定性门（`PORTFOLIO_RISK_ADMISSION`、
  `ENFORCE` 模式下的 `ECONOMIC_ADMISSION`）写入；任何一轮通过准入即清空（`entryCoordinator.ts`）。
- `entryCoordinator.riskAdmissionVerdict(now, ttl)`：超过 `RISK_ADMISSION_VERDICT_TTL_MS=5min` 自动失效 → 历史拒绝不会滞留为首因。
- `authoritativePipelineVerdict` 新增 `RISK_ADMISSION` stage：`noEntryReason` 仍优先（管线停着时旧拒绝只是历史）；
  其次才是最新准入拒绝；`evidence` 仅在 stage 为 `RISK_ADMISSION` 时携带准入细节。
- Dashboard 无改动地消费同一对象，未引入任何页面侧排序。

在线证据（`p05`、`p09`、`p12`、`p08`）：驾驶舱首因卡实际渲染
`HUMAN_ACK_OVERDUE · 确定性风险门拒绝新增风险（AAVEUSDT：HUMAN_ACK_OVERDUE · HUMAN_POTENTIAL_NOTIONAL_LIMIT · STRESS_LIMIT:MAX_CLUSTER_NOTIONAL · STRESS_LIMIT:MAX_GROSS_NOTIONAL）；只能由人工减少已有敞口，或经 governance 写入调整权威上限。不放宽阈值、不重启流程、不再调用模型换取放行`；
`authoritativeBlocker.stage=RISK_ADMISSION`、`evidence.riskAdmissionSymbol=WLDUSDT/AAVEUSDT`、`age` 39 s；
启动后 04:44–04:48 四次 `ENTRY_DECISION_BLOCKED{stage:PORTFOLIO_RISK_ADMISSION}` 与之一致；
次级诊断仍标注「3 项（不作为第二个首因）」且全部为 `*_DIAGNOSTIC`。
自清除侧：PV-10 与协调器 TTL 测试钉住"通过即消失、超龄即消失"，在线侧因负额度持续存在故本轮不可能自然观察到放行（见 §8）。

## 3. B — margin-tier 权威覆盖（根因判定与已闭合的软件缺陷）

根因判定为 **(c) routable-universe 同步滞后**，不是交易所无事实：
只读 preview（`p11`，`persisted:false`）用现网已批准 profile 的 limits/clusters/scenarios 原样重算，
`requiredSymbols=71 / returnedByExchange=71 / collectionFailures=[] / compiledOk=true`，
其中 `ZROUSDT、1000BONKUSDC、WIFUSDT、ETHFIUSDT、ETCUSDT、JUPUSDT` 全部 **交易所现在返回 bracket**，
但它们不在 `committedBefore` 集合里 —— 已提交权威的数据集是它们变为可路由之前收集的。
（`docs/evidence/…/margin-tier-collector-gap-B3.json` 与 `08-authority-preview-real-brackets.txt` 也显示历史上无采集失败。）

已闭合的两个软件缺陷：
1. **预模型按名拒绝**：`buildPreAiExecutionEnvelope` 现在读取权威的只读覆盖镜像
   （`RuntimeState.marginTierCoverage`，唯一写入者是 `mirrorMarginTierCoverage`，在加载与提交两处），
   未覆盖 symbol 两侧 `executable=false`，`firstBindingConstraint=MARGIN_TIER_SYMBOL_UNPROVEN:<symbol>`；
   协调器改为以该约束作为拒绝原因并附 `modelCallConsumed:false`，因此在调用 Primary 之前结束，不消费 token。
   镜像缺失（尚无已提交权威）时行为与改动前完全一致，避免把"未提交"误判成"全部拒绝"；单个未覆盖 symbol 绝不全局抑制（EP-10/EP-11）。
   绝不从后缀、全局杠杆、邻近 symbol 或默认值推断 tier/杠杆/维持保证金率。
2. **不再假称完整**：`authorityStatus=MATCHED` 只表达"已提交数据集与已批准档案一致"，过去它旁边写
   `missingSymbols: []` 让 13 个未覆盖的可路由候选隐身。现在同一投影里显式给出
   `coverageLag.uncoveredCandidates`（13 个 symbol，含 marginTierVersion/committedAt）与明确动作说明（`p04`、`p12`）。

**未做（并说明原因）**：把覆盖真正补齐需要一次带 `acks` 的 PortfolioRisk 权威 CAS 提交（会持久化 settings+authority 三行）。
本轮授权只覆盖实现、门禁、一次 lifecycle 与在线只读验收，未授权该治理写入，因此按 runbook 末则回传事实而非擅自执行：
证据已备齐（71/71 可采集、编译通过、13 个 lag 候选已点名），操作者确认后可由既有 `/settings/portfolio-risk-authority` 通道一次原子提交闭合。
**预模型拒因路径本轮 UNOBSERVED**：部署后实际可路由集合为 `WLDUSDT/AAVEUSDT/TAOUSDT/SOLUSDT/BRUSDT` 等已覆盖 symbol，
未出现未覆盖候选被路由的情况，因此没有自然触发该拒绝；行为由 `preAiExecutableSides.test.ts` EP-10/EP-11 钉住，在线证据只到"13 个候选被点名且不再被伪装成完整"。

## 4. C — TP 保护真值与 `NO_LIVE_POSITION`（本轮最高严重度发现）

根因是一个**符号位缺陷**，不是交易所事实缺失：对冲模式下 Binance 把 SHORT 的 `positionAmt` 报为负数，
而 `proveReduction` 的 hedge 分支要求 `available > 0`（one-way 分支用了 `Math.abs`，hedge 分支漏了），
于是**每一个真实的空头持仓都被判成"无 live 仓位"**，reduce-only 止盈保护永远不被提交，
并且以 `MISSING`（=未保护的 live 持仓）+ `TP_REPAIR_FAILED{submissionOutcome:NOT_ATTEMPTED, message:REDUCTION_PROOF_NO_LIVE_POSITION}` 呈现。

停机前只读对照（`c01`，signed GET only，SQLite 以 readOnly 打开且先复制到 OS 临时目录，未触碰 live 数据目录）证明三个事实同时成立：
`/fapi/v2/positionRisk` 与 `/fapi/v3/positionRisk` **都**把 23 个持仓报为 live（`DASHUSDT:SHORT=-0.1`、`PENGUUSDT:SHORT=-36332`…），
`hedgeMode=true`，而 `proveReduction` 对 8 个 SHORT 全部抛出 `REDUCTION_PROOF_NO_LIVE_POSITION`。
即：该拒绝是对事实的错误陈述，且 8 个真实持仓因此裸奔多日。

修复与真值分层：
- `proveReduction` hedge 分支改为按方向符号校验、以绝对量表达可减数量；方向与请求相反的 row 仍判"该侧无 live 仓位"，
  非数值/为零同样 fail-closed（`c3RuntimeWiringHostile.test.ts` C3-6b 三例，含 LONG-with-negative-amt 反例）。
- 三态分离并落为可审计字段：① 已证明有仓且缺 TP → `MISSING`/`REPAIR_*`（可补 TP）；
  ② 权威事实证明无仓 → 由既有对账路径收敛（`POSITION_CLOSED_RECONCILED` 删除行），不在 TP 状态里伪装；
  ③ 证明与仓位账本相互矛盾或证明不可用 → **新增 `POSITION_FACT_UNRESOLVED`**：不提交订单、不计入"未保护持仓"、
  单独计数 `positionFactUnresolved`/`positionFactUnresolvedSymbols`，健康位仍显 DEGRADED（不静默变绿）。
  驾驶舱为 ③ 单列一条警示，不显示"补 TP"按钮，不与 ① 共用危险色（`stores/system.ts`、`PositionsView.vue`、`tpGuardian.metrics()`）。
- 绝不为未证明存在的持仓创建 reduce-only 订单；绝不伪造保护；未删除任何审计历史。

在线证据（`p06`、`p12`）：新实例启动后 `TP_SUBMISSION_PREPARED 8 → TP_PROTECTED 8`，
`TP_REPAIR_FAILED 0`、`TP_POSITION_FACT_UNRESOLVED 0`；持仓 TP 从 **15 PROTECTED / 8 MISSING** 变为 **23 PROTECTED / 0 MISSING**，
`rowsWithTpOrderId=23`。8 笔 Testnet 写逐笔归因（如 `v396x3bc84007bafb807c95c0154dcd968f` BUY 36332 @0.009607 → PENGUUSDT SHORT，
domain `TAKE_PROFIT_REDUCE_ONLY`，endpoint `/fapi/v1/order`，环境 TESTNET，幂等身份=该 clientOrderId）。

## 5. D — 启动语义空操作不再递增 settingsVersion

根因：`SettingsStore.load()` 无条件 `persist(current,'v3.2-migration',sameVersion)`，
且启动时 Entry Safety 归一化块无条件 `store.save(structuredClone(settings))`，而 `save()` 总是 `version+1` + 写审计行。
Testnet 合法重启时 `entrySafetyMode` 本来就是 `AUTO`，于是每次启动白产一行版本与一条虚假变更血缘。

修复：
- 新增 `sameSettingsSemantics()`：剥掉 `settingsVersion` 后做键序无关的规范化比较，两文档只差版本即语义相同。
- `load()`：仅当 migrate 真的改变内容才持久化/审计；真实迁移仍在自身版本上照常审计。
- `save()`：语义相同直接返回当前设置，不产生版本、不写审计行（顺带关闭"旧客户端回提同文档即可刷版本号"）。
- 启动归一化：`entrySafetyMode` 已为 `AUTO` 时不再发起写；运行控制/治理态归一化照常执行（未削弱任何 fail-safe）。
- 未硬编码任何观察到的版本号；CAS（`saveIfVersion`）、治理确认、JIT/版本绑定、PortfolioRisk 权威提交路径未改动。

回归测试：`settingsStore.test.ts` 新增两例（重复保存同文档版本与审计行数不变 + `settingsVersion+99` 回提无效 + 真实改动仍 +1 并审计一次；
迁移首启审计、二次重启不审计）。

在线证据（`p06` 与直接查库）：停机前 `settingsVersion=218`；
本实例（pid 37996）启动后 `settingsVersion=218`、`settings.updated_at=1790389893902` **未变**、
`settings_audit` 中启动之后的新行 **0**（总行数仍为 124）。上一实例的签名是 `migration(217→217)+api(217→218)`，本轮该签名消失。

## 6. 本地门禁与 build

见 `docs/evidence/v396/final-operational-truth-20260926/g00-gate-summary.txt`（每条命令裸跑重定向后读 `$?`，不取管道退出码）。
要点：engine **172 文件 / 1,395 通过**、core 8/58、dashboard 14/60、contracts **0 个测试文件**（如实记录为无覆盖，不称通过）、
typecheck 0 错误、`verify:deps`/`verify:scripts` 0、S00 `T01–T06` 全 PASS 且 `blockers=[]`、
测试隔离 `172 files / 16 开库 / everyStoreOpeningTestIsolated=true / 仓库数据目录引用 0 / 生产端口引用 0`、
存储覆盖 `S08_STORAGE_COVERAGE_PASS`、`git diff --check` 无空白发现、formal build exit 0（提交后再跑一次仍 0）。
新增只读脚本触发 S00 入口清单红线后，用仓库既有确定性机制重算（129→130→131，新脚本全部保守分类 `FORBIDDEN_OR_NOT_RUN`），
规则表与 `SELECTION` 未修改。

## 7. Lifecycle 与身份闭环

| 项 | 值 |
| --- | --- |
| stop / MANUAL_START | 各 **1** 次，无第二次 restart、无 hot reload、无 watchdog/autostart |
| 旧 → 新 PID | 8732 → **37996** |
| 端口释放证据 | 停止脚本输出 `port 8080 is free`；随后 `Get-NetTCPConnection -LocalPort 8080 -State Listen` 计数 0 |
| startReason / restartCount | `MANUAL_START` / 189 |
| buildId | `3.9.6-e45d25472c241b412be7` |
| runtime artifactHash | `e45d25472c241b412be7d3b626fc7a078fd84a3357a679286887d8d9f781236a` |
| runtime sourceHash | `b2e9f84f7868d11ff2b3c7061d27e7d85ca1756068396a54b1cfbdcb8f50ed58` |
| instanceId | 见 `data/runtime/engine-instance.json`（pid 37996，startedAt 2026-09-26T04:37:46.863Z） |
| 闭环结果 | **`IDENTITY_CLOSED`**，6 项检查全 true：远端=本地 HEAD、提交树 `src` 哈希=运行时 sourceHash、工作树 `dist` 哈希=artifactHash、buildId 前缀推导一致、API 与实例文件一致、被哈希目录 clean |

`07794f2` 之后 `apps/`、`packages/` 零改动，因此部署用的 dist 与提交的源码同源（`p10`）。

交工前再次以证据提交所在 HEAD 复跑同一闭环（`p13`，采集时 HEAD `ffd2e90`）：仍为 **`IDENTITY_CLOSED`**、6 项全 true、
buildId/pid/restartCount/startReason 未变。docs-only 提交不进入被哈希目录，因此该性质对任意后续报告提交保持不变。

## 8. 仍存在的真实阻断（属于约束，不属于缺陷）

1. `HUMAN_POTENTIAL_NOTIONAL_LIMIT` + `STRESS_LIMIT:MAX_GROSS_NOTIONAL` + `STRESS_LIMIT:MAX_CLUSTER_NOTIONAL`：
   毛名义 $11,090.07 对 `maxGross/maxHumanNotionalUsd=$10,811.957` → headroom 约 **−$278**，
   任何规模的新 Entry 都不成立；唯一释放方式是人工减仓。
2. `HUMAN_ACK_OVERDUE`（当前权威首因）：23 条全部 `HUMAN_HANDOFF`，其中 12 条超 `maxAckAgeMs=24h`；
   不自动确认（本轮按 §5 保持原语义）。确认只解除本项，不解除第 1 项。
3. margin-tier 覆盖滞后 13 个 symbol（交易所事实可用）：等待操作者确认的 PortfolioRisk 权威 CAS 提交，见 §3。
4. 手动单 `manual_order_manual_intent_mufgan4j_qkas7dya`（XRPUSDT SELL 10 @1.47，`ec1_mufgan4j_001350f`）状态仍 UNKNOWN，
   `activeRiskUnresolvedCount=1`；本轮未强制消解，保守 UNKNOWN 语义保持不变。
5. 措辞冲突（外观，非第二权威）：`OverviewView.vue` 254/75/92 行在不同作用域仍复用「首因」一词
   （执行事实 `firstBlocker`、逐候选 `firstBindingConstraint`），与权威首因卡并列时可能被误读。
   修正需要一次源码改动 + 部署，而本轮 lifecycle 授权已消费，故留到下一授权轮（改法：行级改称「执行事实缺口 / 该候选首因」）。
6. 本轮未自然观察到：新 Entry 的 reservation/submit/fill（被第 1、2 项硬门合法禁止）、
   以及 B 的预模型拒因路径（无未覆盖候选被路由，见 §3）。均按 UNOBSERVED 记录，不记为 PASS。

写入与资产边界：`productionWrites=0`、`blockedProductionWriteAttempts=0`、`environment=TESTNET`、`executionMode=TESTNET_ENABLED`、
`lockedToTestnet=true`、`aiExitAuthority=SHADOW`、`entrySafetyMode=AUTO`；持仓 23 → 23（17 SHORT / 6 LONG，全 HUMAN_MANAGED），
TP 15/8 → 23/0，UNKNOWN 建仓单 47 持久且 47 份活跃无风险续证、0 占用；毛名义 $11,117.52 → $11,090.07，浮动盈亏 −$884 → −$853.54。
除 §4 的 8 笔止盈保护单外无任何交易所写；本轮未改任何阈值。

## 9. 下一步（≤5）与不应继续优化的方向

1. 操作者确认后一次 PortfolioRisk 权威提交，补齐 §3 点名的 13 个 symbol 覆盖（证据与通道均已就绪）。
2. 人工侧裁决：12 条超期 handoff、XRP 手动 UNKNOWN、以及是否减 ≈$278 名义以恢复新增风险能力。
3. 一次性源码+部署小改：消除 §8.5 的「首因」措辞冲突。
4. 观察 A 的自清除：当出现一次通过准入的周期或超过 5 分钟无新拒绝时，首因应回到 `NONE`（本轮因负额度无法自然出现前者）。
5. 若希望观察自然 PLACE→Submit→Fill：必须先由人工释放额度，不改任何阈值、不制造成交。

不应做：不再把请求数/UNKNOWN 行数当作优化目标（R17 结论）；不放宽 $1 净收益、`minNetProfitRoiPct=0.15`、reachability、
`aiExitLossLimitUsd`、human/gross/cluster/slot 上限、JIT/freshness/egress 门；不把 UNKNOWN 折算为 0；
不改 `aiExitAuthority=SHADOW`；不解锁 Production 写入；不为了让首因好看而重命名真实拒绝原因；
不在已消费的单次 lifecycle 之后再改产品源码冒充同一构建。

## 10. 证据清单

`docs/evidence/v396/final-operational-truth-20260926/`
- 门禁：`g00-gate-summary.txt`、`g01-targeted-tests.txt`、`g02-engine-full.txt`、`g03-core-full.txt`、`g04-dashboard-full.txt`、
  `g05-contracts.txt`、`g06-typecheck.txt`、`g07-verify-deps.txt`、`g08-verify-scripts.txt`、`g09-s00.json`、
  `g10-storage-coverage.txt`、`g11-git-diff-check.txt`、`g12-formal-build.txt`
- 停机前：`p01-readback-before-stop.json`（settingsVersion 218、TP 15/8、writes 0/0、authorityStatus MATCHED+13 uncovered）
- C 根因：`c01-position-facts-before-fix.txt`（V2 与 V3 双活、8 条 SHORT 被拒）
- 部署后：`p02-readback-after-deploy.json`、`p03-identity-closure.json`、`p04/p05/p09/p12-live-probe*.json`、
  `p06-c-d-write-attribution.json`（8 笔 TP 写归因 + settingsVersion/审计行不变）、`p07-dashboard-risk-admission-primary.png`、
  `p08-dashboard-dom-proof.json`、`p10-identity-closure-after-build.txt`、`p11-margin-coverage-preview.json`（71/71 可采集）、`p13-identity-closure-at-handoff.json`
- 只读回采工具（GET + readOnly + 临时副本，绝不写 live 数据目录）：`scripts/v396-a-c-d-live-probe.mjs`、
  `scripts/v396-position-fact-compare.mjs`、`scripts/v396-margin-coverage-preview.mjs`（并复用上一轮
  `v396-g1-g4-identity-closure.mjs`、`v396-g1-g4-acceptance-readback.mjs`）
- S00 入口清单派生重算：`docs/evidence/v396/S00/20260921T145000Z/entrypoint-review.json`

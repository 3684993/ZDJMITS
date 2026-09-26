# CODEX V3.9.6 — G1–G4 实现与最终本地验收 runbook（2026-09-26）

仓库 `3684993/ZDJMITS` · 分支 `codex/v396-final-convergence-20260922` · PR #9：禁止触碰
本文件补齐 `CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md` 之后缺失的最终验收 runbook。
产品实现与本文档同轮提交，验收在本地完成：**GitHub Actions / hosted CI 一律不使用**，
账户 Actions 额度或账单问题记为 `NOT_RUN_BILLING_LIMIT`，且不得因此降低、删除或替换任何本地门禁。

## 1. 本轮实现的四项目标

### G1 Direction 单一硬权威
- `packages/core/src/portfolio.ts` 的方向 room、`exposureFactor` 节流与 `REJECT_EXPOSURE_LIMIT`
  裁决全部改读 `settings.riskGovernance.maxDirectionExposurePct` + `exposureCapacityPolicy.direction`。
- `portfolioIntelligence.max{Long,Short}ExposurePct` 只在 governance 字段缺失时作为兜底，
  不再构成第二套独立硬否决；投机档上限与计价资产保证金上限保持原权威与语义（仍可否决）。
- `AllocationCapacityRoom` 新增 `authority` 与 `enforced`：OBSERVE 时 `roomUsd` 仍是真实观测值，
  但 `enforced=false` 且不参与 `min`，因此不会二次否决。
- `riskGovernance.maxDirectionExposurePct` 的 consumers 矩阵新增 `packages/core/src/portfolio.ts`
  （由 `j5SettingsGovernanceHostile.test.ts` 校验消费者真实存在）。
- 测试：`packages/core/src/portfolio.test.ts` G1-01…G1-05（OBSERVE 不二次否决、ENFORCE 仍拒绝、
  更紧的旧 tier 上限不再绑住、只移除方向否决不移除 quote/spec、节流与权威同读一个比值）。

### G2 AI 合法数量完整区间
- `SideExecutionCapacity` 新增 `minQuantityUnits` 与 `legalQuantityRangeUnits`，由真实
  `minQty / stepSize / minNotional / 参考价` 推导；`legalNotionalRangeUsd` 上界改为
  “已发布最大数量在可达价格带上限处的名义”，不再超过授权名义。
- 契约 `EntryExecutionCapacitySchema`（`.strict()`）新增两个可选字段；旧版本持久化 envelope
  缺字段时按 1 兜底，不伪造下界。
- 确定性层双界校验：`aiQuantityAllocation.ts` 与 `entryCoordinator.ts` 越下界 →
  `AI_QUANTITY_BELOW_ENVELOPE`（事件带 min/max/区间/最小名义），越上界 → `AI_QUANTITY_EXCEEDS_ENVELOPE`；
  执行前复核同样双界；**不存在**任何 clamp/改写模型数量的路径。
- prompt 侧：`compactEntry.ts` 指令改为区间表述（低于 `minQuantityUnits` 或高于 `maxQuantityUnits`
  都不能提交，且不会替你取整）。
- 测试：`aiQuantityAllocation.test.ts` QB-01…QB-03、`preAiExecutableSides.test.ts` EP-08/EP-09。

### G3 单 symbol 行情故障只隔离该 symbol
- 新增 `marketDataIsolation({candidateSymbols, readinessReasons})` 与
  `marketDataIsolationReason(...)`：symbol 级隔离事实（含每个 symbol 自己的原因）。
- `marketDataStaleReason` 只在 WS 源故障、quotes 整体失效，或**所有**候选都失去数据时才给出系统级原因；
  仍有健康候选时返回 null，健康候选继续走 Entry 管线。
- `appRuntime` 用 pool + 已路由候选的实际集合计算隔离，并投影 `marketDataIsolation`
  （`candidateCount / isolatedCount / healthyCandidates / isolated[]`），`marketDataDetail` 增加健康计数。
- 测试：`marketDataStaleness.test.ts` ST-01…ST-05（one-bad-one-good 不暂停、all-bad 暂停且点名原因、
  源故障优先、去重与不吞原因、无候选不伪造暂停）。

### G4 唯一 authoritative blocker / next action
- 新增 `apps/engine/src/services/pipelineVerdict.ts`：`authoritativePipelineVerdict(facts)`
  返回 `{code, stage, nextAction, evidence, secondary[], evaluatedAt}`，
  沿用 Engine 既有的单条优先级链作为唯一来源，不新增第二套判断。
- `/api/v3/pipeline` 新增 `authoritativeBlocker`；`capacityVisibility`、`executionReadiness`、
  `eligibility`、`freshMarkets`、`analysis` 改为同一评估内的共享局部量，页面与 verdict 不可能各算一套。
- 驾驶舱删除自建的 `SUPPLY_SIDE_WAITS` / `firstExplanation` 优先级推导，原样渲染
  `code · nextAction` 与 `stage`，隔离事实与次级诊断分别落在 `[data-market-isolation]` 与
  `[data-secondary-diagnostics]`（次级标题明确“不作为第二个首因”）。
- 测试：`pipelineVerdict.test.ts` PV-01…PV-07；`OverviewView.capacity.test.ts`
  「只渲染 Engine 声明的首因」「改 verdict 即改页面，不自行重排」「隔离面板」。

## 2. 不得触碰的硬事实（实现过程中保持不变）
`$1` 与 `0.15`、`maxPositions=50`、Cluster=ENFORCE 否决权、PortfolioRisk 耐久权威/maintenance/
liquidation/stress/JIT/private freshness/egress/integrity、UNKNOWN 不转 0、不伪造概率或行情事实、
`aiExitAuthority=SHADOW`、Testnet-only、Production 0 写；`ACCOUNT_ASSET_UNVERIFIED:BTC` 与
`HUMAN_POTENTIAL_NOTIONAL_LIMIT` 继续作为真实约束；不为了PLACE/Submit/Fill 改任何阈值。

## 3. 本地验证顺序（全部在本机）
1. 定向：`packages/core` `portfolio.test.ts`；`apps/engine`
   `marketDataStaleness.test.ts`、`pipelineVerdict.test.ts`、`preAiExecutableSides.test.ts`、
   `aiQuantityAllocation.test.ts`、`entryCapacityTrace.test.ts`、`grossRiskCapacityVisibility.test.ts`；
   `apps/dashboard` `OverviewView.capacity.test.ts`。
2. 全量：engine / dashboard / core / contracts 测试、`npm run typecheck`、`verify:deps`、`verify:scripts`、
   S00 静态门禁、storage coverage、`git diff --check`。
3. 正式 `npm run build`，随后仅一次受控 `stop-zdj-lan.ps1` → `start-zdj-lan.ps1 -StartReason MANUAL_START -SkipFirewall`。

## 4. 身份闭环与在线只读验收
必须成立：`remote HEAD == local HEAD == 构建所用提交 == 运行实例 buildId 对应产物`。
在线核对（只读）：两侧逐候选 `capacityRoom` 与首因、`authoritativeBlocker` 唯一首因与 next action、
`marketDataIsolation` 隔离计数、G2 区间字段、Entry funding 仅 USDT/USDC 且逐分一致、
持仓/TP/ownership/UNKNOWN 无非预期变化、`productionWrites=0`、`aiExitAuthority=SHADOW`、
Testnet 写逐笔归因；没有自然 PLACE 时如实报告真实 blocker，不强迫成交。

## 5. 回传格式
按 `CODEX-V396-LOCAL-ACCEPTANCE-TAKEOVER-20260926.md` §8 十三项逐条回传，结论取
`V396_G1_G4_LOCAL_ACCEPTANCE_PASS` 或唯一明确失败首因；证据落在
`docs/evidence/v396/g1-g4-implementation-20260926/`（实现轮）与
`docs/evidence/v396/g1-g4-final-acceptance-20260926/`（部署与在线轮）。

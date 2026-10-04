# GPT-6 Sol 一次性实施指令：V3.9.7 Entry sizing / Primary authority / version closeout（2026-10-04）

## 0. 任务目标与授权

仓库：`3684993/ZDJMITS`

这是一次**完整实施任务**，不是再次写计划。你必须自行完成：

`同步 GitHub 当前 main → 保护并审计旧本地 worktree → 只择取仍有效的旧修改 → 正式统一版本到 3.9.7 → 重做 Entry sizing/leverage frozen candidates → 收口 post-Primary authority → 修复上一轮 Candidate/market/AI/Review 等遗留问题 → 全量测试 → GitHub Actions → 构建/迁移 → 重启当前 TESTNET → runtime readback/identity closure → commit + push main → 最终报告`

不要逐阶段向用户询问是否继续。你已获得对版本、架构、迁移、TESTNET stop/start/restart 的实施授权。

**绝对禁止：**
- 切换到 Production；
- 使用 Production credentials / transport / data path；
- 产生任何 Production write；
- 通过删除历史订单、UNKNOWN、claim、数据库记录来“制造通过”；
- 用旧 worktree 覆盖当前 GitHub main；
- 恢复 PR #11 已经移除的 post-Primary 策略 veto。

Production writes 最终必须为 **0**。

---

## 1. ChatGPT 已完成的 GitHub 事实审计：以这些事实作为起点，不要凭旧报告覆盖

### 1.1 当前 GitHub 基线

本文件创建前，`origin/main` 已重新核对为：

`73f026c5aeb18b9a956242bc7ed146fdff984959`

PR #11：

- 标题：`V3.9.7 collapse post-Primary vetoes and make frozen PLACE authoritative`
- merge SHA：`a494a58422c3c74fa43dfcba52e740f80ad6312b`
- 已在上述 main 的祖先链上。

GitHub Actions 已重新核对：

- workflow：`V3.9.x Verify`
- Run #429
- head：`73f026c5aeb18b9a956242bc7ed146fdff984959`
- conclusion：`success`

Run #429 只是本轮修改前的绿色基线。完成新代码后必须取得**新的** GitHub Actions 全绿结果，不能拿 #429 代替新实现验收。

开始工作时必须再次：

```powershell
git fetch --all --prune
git rev-parse origin/main
git status --porcelain=v2
```

本提示词提交本身会使 `origin/main` 前进，所以**实际 START_MAIN_SHA 必须取执行当时最新 origin/main**，并在最终报告记录。它必须包含本提示词且是 `73f026c5...` 的后代；若不是，先审计新提交再继续，绝不能 reset 回旧基线。

### 1.2 3.9.6 / 3.9.7 的真实历史

当前正式 release identity 仍是 **3.9.6**：

- root `package.json` = `3.9.6`
- `packages/contracts/package.json` = `3.9.6`
- `packages/core/package.json` = `3.9.6`
- `apps/engine/package.json` = `3.9.6`
- `apps/dashboard/package.json` = `3.9.6`
- `package-lock.json` workspace identity = `3.9.6`
- `packages/contracts/src/version.ts`：
  - `RELEASE_VERSION = "3.9.6"`
  - `API_VERSION = "V3.9.6"`
- Dashboard `AppShell.vue` 直接显示 `RELEASE_LABEL`
- `apps/engine/src/runtime/runtimeIdentity.ts` 从 `RELEASE_VERSION` 生成：
  - `version`
  - `buildId = ${version}-${artifactHash.slice(0,20)}`

因此本地 runtime 长期显示 `3.9.6-*` 是代码事实，不是显示缓存。

3.9.6 曾在 commit：

`1f2643e626e0a58dcaf4b94ad29c72f92a7fab24`

正式把 package/release identity 统一到 3.9.6，并建立 package/release identity 检查。

而目前能明确追到的 **V3.9.7 最早工作标签** 是 docs commit：

`e45cf9558f12ae9482aa5d271c759915a02795c1`（2026-09-29）

其内容是 `V3.9.7 核心交易质量审计补充指令`，说明 3.9.7 最初是工作阶段/提示词标签，并没有同时升级 package/runtime。

随后已经出现大量真正的行为级 `v397` 修改；第一个明确的代码级 v397 commit 包括：

`9129f9123528e584b7d656bbba3b11901e49a2af`
`fix(v397): close prior trading-loop accounting and execution wiring gaps`

此后又发生 Entry economics、Review、订单生命周期、当前实例收敛、frozen candidate、Primary authority 等行为级改变，并最终合入 PR #11。

现在代码已经出现明显混合身份：

- release/package/build/UI 仍为 3.9.6；
- Primary output contract `packages/contracts/src/ai.ts` 已把 `V3.9.7` 作为默认 schema，并要求 PLACE 选择 `selectedCandidateId`、禁止模型直接 author `quantityUnits`；
- candidate implementation 仍有 `V396-PLAN-CANDIDATE-SET-1` / `V396-PLAN-CANDIDATE-1` 历史 schema 名；
- pre-AI envelope 仍有旧对象版本名，但新增 `V397-ENTRY-CAPITAL-BUDGET-1`。

### 1.3 本轮版本决定：正式升级到 3.9.7

**本轮技术决定已作出：正式把当前系统统一为 3.9.7。**

理由：

1. 当前 main 已经包含明显行为级变化，不再只是文档阶段名；
2. Primary 协议实际上已经是 V3.9.7；
3. PR #11 改变了 Entry authority 的核心执行语义；
4. release 继续叫 3.9.6 会让 runtime、UI、package 与真实协议持续矛盾；
5. 当前 DB schema migration（SettingsStore 已见 1..14）与 release semver 解耦；没有发现“必须保持 release=3.9.6 才能读旧 DB”的耦合；
6. AI schema 已保留 V3.9.2/V3.9.3 legacy archive compatibility；
7. `/api/v3` 是 API 路由代际，不等于 app semver，不需要因为升级 3.9.7 改成别的 URL。

实施要求：

- 统一 root/contracts/core/engine/dashboard/package version、内部 workspace dependency version、lockfile；
- `RELEASE_VERSION` → `3.9.7`；
- `API_VERSION` → `V3.9.7`；
- 更新当前 release name/manifest/verify identity；
- Dashboard 必须显示 V3.9.7；
- runtime restart 后必须真实读到 `buildId=3.9.7-*`；
- 新增/改造当前 V3.9.7 release manifest，不要把新的 3.9.7 结果写回历史 `docs/evidence/v396/**`；
- **不要为了字符串整齐批量重命名历史 durable schema/event/evidence 标签。** 只有当本轮候选契约本身发生结构变化时，才创建新的 V397 candidate schema，并保留旧 V396 reader/compatibility；历史记录必须仍可读；
- 不要改 `/api/v3` 路由；
- DB migration 必须 additive/compatible，禁止 destructive reset。

如果你在真实本地 DB/schema roundtrip 中发现兼容缺口，修复 migration/reader，而不是把 release 又退回 3.9.6。

---

## 2. 旧 worktree / 分支同步策略：当前 main 是唯一代码基座

### 2.1 远端分支审计已有结论

GitHub 比较结果：

- `online/v397-post-ai-authority-collapse-20261004`
  - ahead 0 / behind 2
  - 已被 main 完全吸收
  - **不要再 merge**

- `codex/trade-record-cycle-accounting-final`
  - ahead 0 / behind 658
  - **没有独有提交，不要 merge**

- `codex/v396-entry-frequency-risk-audit-20260927`
  - ahead 0 / behind 144
- `codex/v396-final-convergence-20260922`
  - ahead 0 / behind 148
- `codex/v396-design-completion-20260921`
  - ahead 0 / behind 276
- `codex/v396-astra-handoff-20260922`
  - ahead 0 / behind 264

以上四个旧分支没有 main 缺失的 commit，**不要机械合并**。

真正仍有 GitHub 独有差异的是：

`integrate/8096-main-sync-20261003`

当前比较：

- merge base：`221e7cd50d876d33d12570746ffbb765223cc68a`
- ahead：7
- behind：55
- 与 current main 已严重 diverged
- 它改动 API、reconciliation、Orders UI、package、CI 等。

**严禁直接 merge 这个分支。**

其中仍可能有价值、需要重新移植到 current main 语义上的独有模块包括：

- `apps/engine/src/services/currentOpenOrders.ts`
- `apps/engine/src/api/entryCancellation.ts`
- `apps/engine/src/services/tradeCloseProvenance.ts`
- `apps/dashboard/src/views/orderEconomicsPresentation.ts`
- 以及对应 tests。

这些代码处理的正是“remote current order vs local UNKNOWN/in-flight identity”“取消结果 UNKNOWN”“close provenance”“订单杠杆/initial margin readback”等仍有价值的问题，但必须**重新审计后手工 port/cherry-pick hunk**，不能带回旧 router/reconciliation/Entry authority/CI/package 语义。

`snapshot/8096-2a6b864-20261003` 是旧本地 release source snapshot，ahead 1 / behind 55，并相对 main 删除大量后来文件。它只能做取证参考，**永远不是 merge candidate**。

### 2.2 你必须先保护用户本地未推送工作

GitHub 看不到用户机器上未 push 的 dirty worktree，所以你必须在修改前实际审计本地：

1. 记录 `git status --porcelain=v2 --branch`
2. 记录：
   - `git diff`
   - `git diff --cached`
   - untracked files
   - local branches/worktrees
   - `git log --left-right --cherry-pick origin/main...HEAD`
3. 在任何 reset/rebase 前创建可恢复保护点：
   - rescue branch/tag 或 patch bundle；
   - 保留 untracked 文件；
   - 不覆盖用户旧工作。
4. 用最新 `origin/main` 新建干净实施分支/worktree。
5. 把旧本地独有修改分为：
   - 已被 main/PR #11 等价吸收 → 不取；
   - 与新 Primary-authority 冲突 → 不取旧实现，只重做仍有效目的；
   - 与 Entry authority 无关且仍有效 → 可 cherry-pick；
   - 混合 commit → `cherry-pick -n` / 手工选 hunk，禁止整 commit 污染新架构。
6. 凡冲突触及以下文件，默认以当前 main 语义为权威，绝不能 `theirs` 覆盖整文件：
   - `entryCoordinator.ts`
   - `preAiExecutionEnvelope.ts`
   - `quantityHorizonCandidates.ts`
   - Entry/TradePlan/candidate contracts
   - `runtimeState.ts`
   - `BrainView.vue`
   - PR #11 相关 tests。

最终报告必须列出：
- 本地旧 HEAD；
- rescue 引用；
- unique commits/hunks；
- 取了什么；
- 丢弃什么；
- 为什么。

---

## 3. 当前 sizing 的真实代码差距：不要再从旧描述推断

当前 main 已经有 pre-AI candidate architecture，但仍不满足本轮目标。

已核对：

### 3.1 当前 Settings 仍是旧业务地板

`packages/contracts/src/settings.ts` 当前默认：

- `minimumInitialMarginByQuote = {USDT:1, USDC:1}`
- `minimumOrderNotionalByQuote = {USDT:200, USDC:200}`

`config/settings.default.json` 当前还有：

- `portfolio.entryMarginUsd = 200`
- `portfolioIntelligence.minMarginUsd = 1`
- `portfolioIntelligence.globalMaxLeverage = 20`
- `leverage.defaultValue = 20`

SettingsStore 兼容迁移当前也会从旧 `minMarginUsd/entryMarginUsd` 回填到上述 Entry fields。

这套 **1 USDT initial margin + 200 quote-wide order notional** 的旧语义，本轮必须退出自动 Entry 的权威路径。

### 3.2 当前 leverage 仍是单值，不是 10~20 候选维度

`buildPreAiExecutionEnvelope` 当前用类似：

`min(globalMaxLeverage, candidate.recommendedLeverage ?? globalMaxLeverage)`

得到**一个 leverage**。

`quantityHorizonCandidates.ts` 的 CandidateSet input 也只有单个 `leverage`，因此 Primary 现在只能在“数量/TP/horizon”候选中选，不能在 10~20x 的 leverage 候选中自主选择。

本轮必须让 leverage 成为 frozen candidate identity 的一部分。

---

## 4. 新的 Entry sizing 合同：必须实现，不是 advisory

### 4.1 硬合同

每一笔新的自动 Entry：

- `initialMarginQuote >= 100` USDT/USDC；
- `leverage` 必须在 **10..20** 整数范围内，同时受 symbol 的真实 exchange leverage 约束；
- `orderNotional >= exchangeMinimumNotional`；
- `orderNotional >= configuredBusinessSymbolMinimum`；
- minQty / stepSize / tickSize / NOTIONAL or MIN_NOTIONAL / price precision / quantity precision 必须满足真实 TESTNET exchangeInfo；
- 不得出现为了“能下单”回落到 5、50、200 USDT 小单的 fallback。

注意：100 是**初始保证金下限**，不是 notional。

正常候选应允许例如：

- 100 margin × 10x ≈ 1000 notional；
- 100 margin × 20x ≈ 2000 notional；

实际 notional 还要由净收益、目标移动、费用、stepSize、可用资金等提高。

### 4.2 Exchange minimum 与 Business minimum 必须分离

不要硬编码“Binance BTCUSDT 最低 150 USDT”。

在当前 TESTNET runtime 中读取并保存真实 `exchangeInfo` / filter 证据：

- PRICE_FILTER / tickSize
- LOT_SIZE / stepSize / minQty
- MIN_NOTIONAL 或 NOTIONAL
- 当前 symbol 支持的其它相关限制

对于 BTCUSDT：

- 如果真实 exchange filter 就是约 150，则 150 是 **Exchange Minimum**；
- 如果真实 exchange filter 不是 150，则把 150 作为用户要求的 **BTCUSDT Business Minimum** 存入新的 per-symbol business policy。

建议引入明确字段，例如：

`entry.minimumOrderNotionalBySymbol`

命名可以根据现有 schema 风格调整，但必须是 per-symbol authority。

旧 `minimumOrderNotionalByQuote=200` 不得继续作为 V3.9.7 所有币种的隐式 universal floor。为了兼容可以保留 legacy reader/migration metadata，但新的自动 Entry sizing authority 必须清楚区分：

1. Exchange Minimum
2. Business Symbol Minimum
3. Minimum Initial Margin = 100

Dashboard 和 API readback 三者也必须分开显示。

### 4.3 Settings migration

对已有 Settings：

- `minimumInitialMarginByQuote.USDT/USDC < 100` 必须迁移/归一到 100；
- schema/default 也必须把自动 Entry 的最低值锁在 100；
- 增加 per-symbol business floor；
- 不要把旧 universal 200 偷偷复制成所有 symbol 的 business floor；
- BTCUSDT 按上面的真实 exchange filter 审计决定 150 属于 exchange 还是 business；
- migration 要有 audit/readback；
- 旧 DB / 旧 Settings 文件仍必须可载入；
- schema roundtrip 与 Settings CAS/version 语义必须保持。

---

## 5. Frozen candidate solver：从“太小就 reject”改成“先求可执行解”

不要采用：

`AI 给 quantity → 系统发现太小 → reject`

必须改成在 Primary 前求解。

### 5.1 生成维度

对每个 side，在 Primary 前至少遍历/求解：

- leverage：所有真实可支持的整数 `10..20`；
- quantity；
- initial margin；
- notional；
- target price / acceptable target range；
- target horizon；
- entry executable price envelope。

每个候选都必须是不可变 frozen object，并包含：

- candidateId
- side
- leverage
- quantity / step units
- initialMarginQuote
- notional
- entry reference / executable range
- target
- horizon
- exchange minimum
- business minimum
- fee estimate
- slippage buffer
- funding estimate/status（能证明则计入，不能证明要有明确 policy，不可伪造 0）
- required minimum net profit
- expected target-conditional net profit
- reachability/history facts
- factVersion/candidateSetHash/provenance。

candidate hash 必须覆盖 leverage、quantity、margin、target/horizon 等真正决定执行的字段。

### 5.2 求 quantity 的方向必须反过来

至少要能机械回答：

> 给定 side + target/horizon + leverage，如果方向和目标移动成立，为满足 minimum net profit，需要最少多少 quantity/notional/margin？

先由：

- 可用 USDT/USDC；
- `minimumInitialMargin=100`；
- leverage 10..20；
- exchange filters；
- per-symbol business floor；
- entry price envelope；
- entry+exit fee；
- slippage；
- funding/uncertainty buffer；
- minNetProfitUsd；
- minNetProfitRoiPct；
- target move；

反解 `requiredNotional/requiredQuantity`，再按 stepSize **向上**对齐最小可行量，并重新验证所有约束。

不能先造一个小 quantity 再问“够不够赚钱”。

### 5.3 最低 candidate notional

每个 leverage 的 candidate floor 至少为：

`max(exchangeMinimum, businessSymbolMinimum, 100 * leverage, netProfitRequiredNotional)`

然后经过真实价格与 stepSize rounding 后再次证明：

- initial margin 仍 >=100；
- notional 仍过 exchange/business floor；
- 净收益仍达标；
- available quote funds 足够。

如果由于资金不足无法产生任何 >=100 margin 的候选：

- 在 **Primary 前** 明确 `NO_EXECUTABLE_CANDIDATE`；
- 不调用 27B；
- 不制造一个 5/50/200 小单；
- UI 显示“可用资金不足以形成最低 100 初始保证金的合法候选”。

### 5.4 leverage 的 AI 决策方式

首选方案：

- 系统构造多 leverage frozen candidate；
- EIP 给 Primary 展示每个候选的 side/qty/margin/notional/leverage/target/horizon/economics；
- Primary 只输出 `selectedCandidateId`；
- AI 通过选择 candidate 最终决定 side + quantity + leverage + target + horizon；
- 模型不得直接 author 任意 quantity/leverage 数字。

这样 deterministic legality 在 AI 前完成，同时仍保持 AI 是最终交易选择者。

不要把 leverage 固定 20x，也不要用“低杠杆永远更安全/高杠杆永远更优”的硬编码策略替代模型选择。

---

## 6. PR #11 authority 继续收口：合法 PLACE 后只能有物理执行失败

### 6.1 当前 main 已经正确做到的部分，不得回退

当前代码已经把下列 TESTNET post-AI 逻辑降为 observation/shadow 或冻结 candidate readback：

- post-AI economics re-evaluation；
- portfolio risk/gross/direction/cluster 等 funds-only risk 重新否决；
- market data status；
- direction stability；
- redundant entry location/TP fields；
- evidence ref unresolved（TradePlan 当前有 `PLAN_EVIDENCE_UNRESOLVED_AUDIT_ONLY`）；
- maker reachability；
- AI authorization age；
- JIT market drift（TESTNET observation）。

当前 economics 明确从 frozen selected candidate 读回，而不是用第二套 entry price 再算。

这些都要保留。

### 6.2 本轮必须进一步消灭残余“PLACE 后策略拒绝”

定义要严格：

**只有通过 output schema + selectedCandidateId + frozen candidate identity 校验的 Primary PLACE，才计为 Authorized Primary PLACE。**

如果模型输出不存在的 candidate id、协议字段非法、side 与 candidate 不一致：

- 这是 `AI_OUTPUT_INVALID / MODEL_PROTOCOL_INVALID`；
- 不要先计入 Authorized PLACE 再变成“PLACE 未提交”。

一旦 Authorized PLACE 成立，禁止以下内容再次 veto：

- `ECONOMIC_MIN_NET_PROFIT_UNMET`
- `TP_TARGET_WRONG_SIDE`
- `QUOTE_USD_MISSING`
- `PLAN_EVIDENCE_UNRESOLVED`
- historical probability/reachability
- Gross
- Direction
- Cluster
- Human exposure
- position count
- historical UNKNOWN
- historical claim
- pending risk
- market quality
- evidence completeness
- AI evidence
- AI authorization age
- market drift
- 第二套 economics / alternate entry price
- risk admission replay。

### 6.3 Authorized PLACE 后唯一合法的阻断类别

只有物理上已经无法正确 wire submit 的事实可以阻止：

1. `FUNDS_CHANGED`
   - AI 推理期间真实可用 quote balance 已变化，不足以覆盖 frozen candidate；

2. `EXCHANGE_LEGALITY_CHANGED_OR_INVALID`
   - 真实 filters/precision/symbol status 不再允许该订单；

3. `FROZEN_IDENTITY_CORRUPT`
   - candidateSetHash / candidateId / immutable payload / plan lineage 无法证明一致；

4. `IDEMPOTENCY_UNPROVEN`
   - duplicate submit / clientOrderId identity 无法保证；

5. `DURABLE_PERSISTENCE_FAILED`
   - TradePlan/reservation/intent/journal durable write 失败；

6. `EXECUTION_PERMISSION_CHANGED`
   - Engine 不再 RUNNING/AUTO，或 TESTNET_ENABLED 被关闭；

7. `PRIVATE_ACCOUNT_FACT_UNPROVEN`
   - 私有余额/账户状态 stale/unavailable，不能安全写；

8. `SET_LEVERAGE_FAILED`

9. `BINANCE_SUBMIT_REJECTED`

10. `SUBMISSION_UNKNOWN`
    - 必须 exact clientOrderId reconciliation，绝不能盲目重提。

这些是**物理执行失败**，不是“策略拒绝”。

### 6.4 当前代码需要特别复核的残余点

逐条审计并修：

- TESTNET 下 candidateSet identity mismatch 目前有路径只发 `POST_AI_OBSERVATION_ONLY`。这与本轮“identity corruption 是物理 blocker”不一致：真正的 frozen identity/hash 损坏必须 fail closed；
- `buildAndPersistTradePlan` 的 refusals：确保只剩 selected frozen candidate identity / persistence / structural contract 问题，任何 evidence/economics 都只能 warning；
- `reserveEntry` 的失败原因：分清“实时资金/并发物理变化”和旧风险策略拒绝。TESTNET 不得通过 reservation 把 Gross/Direction/Cluster/Human/history 重新带回；
- `evaluateEntryExecutionPermit`：逐字段审计 firstCause，TESTNET Authorized PLACE 后只能返回上述物理类别；
- `executionHardBlock`：只能验证 frozen quantity/leverage/price precision/funds/identity/permission/idempotency，不能借“再次验证”偷偷重做策略判断；
- post-only retry：不得重新 sizing/换 candidate；若 exact frozen execution 无法合法重试，归为 physical submit failure；
- `setLeverage` 失败是物理执行失败，必须保留真实 Binance reason；
- submit UNKNOWN 必须保持 reservation/identity 并 exact recovery，不得变成普通 reject。

---

## 7. Funnel 与 UI：把“模型差”与“系统没执行模型”彻底分开

AI Brain / Entry 顶层增加明确 funnel：

- Authorized Primary PLACE
- TradePlan
- Reservation
- Intent
- Submit
- Fill
- PLACE → Submit %
- Submit → Fill %

要求：

- 每层使用同一 `brainRunId/decisionChainId/planId/reservationId/intentId/orderId/clientOrderId/exchangeOrderId` lineage；
- 不能用事件数量粗略猜测；
- 每个未 Submit 的 Authorized PLACE 只能有一个**第一原因**；
- 顶层原因只显示人类可读物理类别，例如：
  - 决策后真实资金不足
  - 交易所数量/价格规则变化或不合法
  - 冻结候选身份损坏
  - 持久化失败
  - TESTNET 自动执行已关闭
  - 私有账户数据无法证明
  - 设置杠杆失败
  - Binance 提交拒绝
  - 提交结果未知，等待身份查询
- raw code、actual/limit、fact hash、stack/provenance 放“详细审计”；
- `ECONOMIC_MIN_NET_PROFIT_UNMET`、`PLAN_EVIDENCE_UNRESOLVED` 等不能再作为 Authorized PLACE 未提交的第一层原因。

同页还要清晰显示当前候选/订单的：

- Exchange Minimum
- Business Minimum
- Minimum Initial Margin（100）
- selected leverage
- initial margin
- notional
- quantity
- min net profit / expected target net profit。

---

## 8. 上一轮遗留工作必须继续，但不得恢复 Entry 策略 veto

同步最新 main 后继续处理：

### 8.1 Candidate=0

追完整链：

`universe → data-ready → pre-AI envelope → frozen candidate set → Primary dispatch`

对每轮 Candidate=0 给唯一第一原因。尤其检查新 100 margin 是否因余额不足造成真实无候选；不要把历史 UNKNOWN/pending risk 当原因。

### 8.2 market data stale / backfill

核对并修：

- Binance websocket/REST；
- quote / bookTicker；
- 1m / 5m / 15m / 1h / 4h / 1d；
- stale detection；
- backfill；
- disconnect/reconnect；
- Primary 前 freshness。

Freshness 必须在 Primary **前**成立。Authorized PLACE 后不允许再变成策略 veto。

### 8.3 本机 AI endpoints

实际验证当前配置里的：

- Engine 8080；
- 9B / Scout（例如 8081）；
- Primary 27B（例如 8083）；
- Review（例如 8084）。

端口以当前 Settings 为真，不要硬编码旧电脑事实。

核对：

- health；
- duty routing；
- concurrency；
- timeout/failure budget；
- Primary 长时间不分析；
- Review due → reserved → completed；
- Review budget 恢复与失败回收。

### 8.4 historical UNKNOWN / claim / local in-flight

继续修历史债务与 read model，但：

- historical UNKNOWN 不能冒充 current exchange open order；
- verified no-active-risk 必须解除占用；
- claim/cycle/funding debt 可影响审计与会计，不得重新获得新 Entry strategy veto；
- 优先重新审计 `integrate/8096-main-sync-20261003` 的 `currentOpenOrders` / cancellation / provenance 实现，把仍正确的身份语义移植到 current main；
- current remote open-order view 与 historical ledger 必须分离。

### 8.5 cycle / funding

继续修：

- cycle ownership；
- fill attribution；
- funding nullable/unproven 语义；
- close provenance；
- TradeRecord conservation。

不能为了候选生成把 UNKNOWN funding 静默当 0；要按明确保守 policy 或标记 unavailable，同时不允许 post-PLACE 再否决。

---

## 9. 测试要求：必须先写能失败的回归，再实现

至少增加以下回归矩阵。

### 9.1 Sizing

1. USDT：margin=100, leverage=10 → notional 至少约 1000；
2. USDT：margin=100, leverage=20 → notional 至少约 2000；
3. USDC 同样规则；
4. 99.99 可用资金且最低 margin=100 → 0 executable candidates，Primary 不调用；
5. stepSize rounding 后 margin 仍 >=100；
6. minQty/minNotional/NOTIONAL/tickSize 全部证明；
7. symbol 只支持 max leverage 15 → candidate leverage 只能 10..15；
8. candidate menu 至少存在不同 leverage 候选时，Primary 能通过 candidate id 选择 leverage；
9. min net profit 需要比 margin floor 更大 quantity → solver 自动提高 quantity，而不是 reject；
10. 不能出现 5/50/legacy 200 fallback；
11. legacy quote-wide 200 不再成为所有 symbol universal floor；
12. BTCUSDT exchange min 与 business 150 被分别呈现和验证。

### 9.2 Primary authority

建立 hostile tests：

- pre-AI economics 不满足 → 不调用 Primary；
- pre-AI funds 不足 → 不调用 Primary；
- Authorized PLACE 后把 Gross/Direction/Cluster/Human/history/pending/evidence/reachability 状态改坏 → Submit 仍继续；
- Authorized PLACE 后 market stale / auth age old → observation only；
- post-AI evidence refs unresolved → TradePlan warning only；
- second economics 不存在 veto 路径；
- candidate hash 被篡改 → physical `FROZEN_IDENTITY_CORRUPT`，不 wire；
- balance 在推理期间下降 → physical `FUNDS_CHANGED`；
- exchange filter/precision 真实变化 → physical failure；
- Binance reject → physical submit failure；
- submit ACK 丢失 → UNKNOWN + exact clientOrderId recovery，零 duplicate submit。

### 9.3 Funnel/UI

- Authorized PLACE → TradePlan → Reservation → Intent → Submit → Fill 逐层计数；
- PLACE→Submit / Submit→Fill 算术；
- 每个 no-submit 只有一个 first cause；
- 顶层不出现旧策略 error code；
- detailed audit 仍保留 raw code/facts；
- Exchange Minimum / Business Minimum / Minimum Initial Margin 明确分列。

### 9.4 Version/compatibility

- 所有 package/internal workspace identity = 3.9.7；
- `RELEASE_VERSION=3.9.7`；
- `API_VERSION=V3.9.7`；
- Dashboard release label = V3.9.7；
- runtime identity unit/integration test预期 `3.9.7-<artifact hash>`；
- old Settings（含 margin=1 / quote-notional=200）可迁移；
- old durable DB 不丢数据；
- V3.9.2/V3.9.3 archived AI decisions 仍可读；
- V396 candidate/plan persisted rows 如存在仍可 read/reconcile；
- 若本轮 candidate schema 升到 V397，必须提供 backward reader。

---

## 10. 全量门禁与 GitHub Actions

在干净 worktree 上执行仓库现有真实 gates，至少：

- `git diff --check`
- `npm ci`（若当前仓库标准要求）
- contracts build/test
- core build/test
- engine typecheck/test
- dashboard typecheck/test
- full `npm test`
- `npm run build`
- `npm run verify`
- `npm run verify:scripts`（若现有脚本）
- S00
- storage coverage
- durable schema roundtrip
- release/version identity check
- 新的 targeted sizing/authority/funnel tests。

不得为了绿测试降低真实 production/testnet safety timeout、删 assertion、skip suite。

本地全绿后：

1. commit；
2. push；
3. 触发/等待 GitHub `V3.9.x Verify`；
4. 若 Actions 失败，读取真实 failed job/step/log，修代码或 test harness；
5. 继续直到新的 main SHA 对应 Actions **success**。

---

## 11. TESTNET 部署与 runtime closure

GitHub Actions 全绿之后才做最终 current TESTNET cutover。

### 11.1 部署前

- 记录旧 PID / instanceId / buildId / sourceHash / artifactHash / restartCount；
- 备份所有会被 migration 触及的 SQLite/settings 文件；
- `integrity_check`；
- 记录 Settings version；
- 记录 TESTNET/Production write counters；
- 只读获取真实 exchangeInfo/filter/leverage facts；
- 保存 BTCUSDT minimum 证据，不得凭用户口述写 Binance 规则。

### 11.2 构建与迁移

- 用最终已 push SHA 构建正式 dist；
- 执行 Settings/DB migration；
- migration 后逐表/关键记录 readback；
- 禁止删 historical UNKNOWN/claims；
- Production data path 不得打开写权限。

### 11.3 stop/start

允许按需要 stop/start/restart 当前 **TESTNET** 实例，不需要再次询问用户。

最终必须让运行实例加载最终已 push main。

### 11.4 最终 readback

必须真实证明：

- runtime version = `3.9.7`
- buildId = `3.9.7-*`
- source/artifact/runtime identity closure **6/6**
- Engine RUNNING
- execution environment TESTNET
- AUTO state 符合用户当前授权配置
- Production writes = **0**
- TESTNET write counter如发生真实测试单，逐笔可解释
- 8080 + 当前 AI duty endpoints healthy
- market data fresh
- Candidate 生成恢复
- Primary 能分析
- Authorized PLACE→TradePlan→Reservation→Intent→Submit 链真实可观测
- Submit→Fill 如没有自然 fill，明确写 `NOT_OBSERVED`，不能伪造；
- 所有 no-submit Authorized PLACE 都有唯一 physical first cause；
- 不存在 post-Primary strategy veto。

如果没有自然 PLACE/Fill，可以用 deterministic replay/fixture 证明代码路径；但至少要对真实当前 runtime 的候选/AI/market/exchange readback 给出事实。不要为了制造成交强行操纵 Production 或绕过模型。

---

## 12. 最终报告与交付

最终报告写到：

`docs/reports/v397-entry-sizing-primary-authority-version-closeout-20261004/FINAL_RESULT.md`

报告必须包含：

1. START_MAIN_SHA / FINAL_MAIN_SHA；
2. 旧 worktree/rescue/分支 merge 决策；
3. 3.9.7 版本历史审计与正式升级清单；
4. package/version/build/UI/API identity；
5. DB/schema/Settings compatibility 与 migration 结果；
6. TESTNET exchangeInfo 实测：
   - BTCUSDT exchange minimum
   - business minimum
   - minimum initial margin
7. leverage 10..20 candidate 设计与真实生成样本；
8. “为达到目标净收益需要多少 qty/margin/leverage”的 solver 证据；
9. PR #11 post-Primary audit；
10. 所有残余 post-PLACE blockers 分类；
11. PLACE→TradePlan→Reservation→Intent→Submit→Fill funnel；
12. PLACE→Submit % / Submit→Fill %；
13. no-submit first-cause 聚合；
14. Candidate=0/market stale/8081/8083/8084/Review/UNKNOWN/claim/cycle/funding 遗留项结果；
15. targeted/full tests；
16. GitHub Actions run number + URL + conclusion；
17. TESTNET PID/instanceId/buildId；
18. identity closure 6/6；
19. TESTNET writes；
20. Production writes = 0；
21. 尚无法由当前真实事件证明的项目，明确 `NOT_OBSERVED`/UNKNOWN，不得包装成 PASS。

最后：

- commit 全部源码、tests、必要 migration、UI、报告；
- push `main`；
- 确认 remote main = final commit；
- 当前 TESTNET runtime 必须运行 final main build；
- 不要留下“代码已 push 但本地还跑旧 3.9.6 build”的半闭环状态。

---

## Definition of Done

只有同时满足以下条件才能结束：

- 正式 release/runtime/UI/package identity 全部为 **3.9.7**；
- every auto Entry candidate initial margin >=100 USDT/USDC；
- leverage candidate range = exchange-supported subset of 10..20；
- exchange minimum / business symbol minimum / margin minimum 三者独立；
- sizing 由 pre-AI solver 生成可赚钱、可提交候选，而非 AI 后 reject 小 quantity；
- Primary 通过 candidate id 最终选择 side/qty/leverage/target/horizon；
- Authorized PLACE 后零策略 veto；
- 只有物理执行失败能阻止 submit；
- PLACE→Submit funnel 可审计，正常合法 PLACE conversion 接近 1；
- 旧历史 UNKNOWN/claim 可继续审计但无新 Entry veto 权；
- Candidate/market/AI/Review 遗留问题完成当前事实收口；
- full local gates green；
- 新 GitHub Actions green；
- current TESTNET 已重启到 final build；
- identity closure 6/6；
- Production writes = 0；
- FINAL_RESULT.md 已 commit + push。

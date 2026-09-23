# Codex：V3.9.6 最终正式启用轮（Testnet，交易写锁定）

本轮目标不是继续审计，而是让 V3.9.6 成为当前正式运行的 Testnet 主版本。权威输入为 `docs/reports/v396-shadow-advanced-audit-20260923.md`。先 fetch 并 `merge --ff-only` 最新 `codex/v396-final-convergence-20260922`；禁止 rebase/squash/force，PR #9 不动。

## 本轮必须闭合的三个 P1

1. READ_ONLY 不得等于 AI 大脑完全停摆：把“自动分析/TradePlan/risk admission”和“交易所写许可”拆开。Testnet 写锁定状态下允许 PRIMARY、TradePlan、PortfolioRiskAdmission 的只读运行与证据生成；所有 exchange write 继续必须为 0。驾驶舱要明确显示 `POLICY_DISABLED / ANALYSIS_ONLY` 或等价状态，不能再把零派发显示为“持续扫描中”。补 dispatch heartbeat、lastAttempt/lastSuccess/lastBlockedReason 或等价事实，使 >30 分钟静默可以区分 POLICY_DISABLED、NO_SUPPLY、CAPACITY_BLOCKED、FACTS_BLOCKED、MODEL_UNREACHABLE、DISPATCH_STALLED、SILENCE_UNKNOWN。

2. PortfolioRiskAdmission profile 必须来自显式权威 Settings：不得为了通过而填写宽松默认值。已有治理值保持不变；缺失的必填 profile 字段必须显式配置/回读/版本化，未配置时 fail-closed。correlation/scenario/profile version 和 human-capacity 相关值必须有 provenance。

3. 保证金币种与金额单位必须闭合：UNKNOWN marginAsset 不得默认 USDT；非稳定币 availableBalance 不得未经新鲜 FX/估值直接当 USD margin；maintenance margin/tier/FX 若拿不到必须保持 UNKNOWN 并阻止新增风险。补 USDT、USDC、BTC 等 hostile fixtures，证明 `BTC availableBalance=0.01` 不会被解释成 `$0.01 availableMarginUsd`。

## 实施纪律

三个 P1 都要先红测再修复。完成 targeted、Engine 全仓、core/dashboard/contracts、typecheck/build/verify:scripts、S00 static、storage coverage、`git diff --check`，全部从仓根读取真实 exit code。不得删断言、放宽风险阈值、填默认事实或把 UNKNOWN 记 0。

完成后 fast-forward push。

## 正式启用

离线全绿后，先核验当前持仓/TP/ownership/UNKNOWN 仍安全；若出现裸仓/保护失配则停止并保留现场。

允许为部署本轮修复执行一次受控停止当前 V3.9.6，再人工启动修复后的 V3.9.6。不得自动重启、热重载或安装 watchdog/autostart。

启动后必须保持：TESTNET；生产写永久禁止；exchange write lock 仍开启；`aiExitAuthority` 保持 SHADOW；不切 ENFORCE。

正式运行验收必须证明：
- 当前实例 PRIMARY 在自然可分析候选出现时可以真实运行；
- TradePlan 可以生成并持久化不可变计划证据；
- PortfolioRiskAdmission 会真实执行并明确 ALLOW/BLOCK 及原因；
- `testnetWrites=0`、`productionWrites=0`；
- dashboard 能准确说明当前首因，而不是统一显示“持续扫描中”；
- TP/ownership/UNKNOWN/fatal 状态正常。

不要强造候选、不要调宽阈值。若自然候选暂时不存在，只要 scheduler/dispatch/模型健康/首因事实可证，V3.9.6 仍保持正式运行。

## 最终状态

若无新的 P0/P1，本轮最终状态必须写为：`V396_TESTNET_ACTIVE_ANALYSIS_ONLY`。

这表示：V3.9.6 已正式启用并作为当前 Testnet 主运行版本；AI 分析与计划/风险链工作；交易所写仍因独立安全边界保持锁定。不要再用 `READY_FOR_*` 表述为“尚未启动”。

最终只汇报：HEAD/buildId/PID；三个 P1 的修复与红→绿；PRIMARY/TradePlan/PortfolioRiskAdmission 当前实例证据；testnetWrites/productionWrites；TP/ownership/UNKNOWN/fatal；最终状态。
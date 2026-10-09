# V3.9.8 — AI 已 PLACE 但零建仓的 P0 诊断与受控修复计划

**日期**：2026-10-09 13:32+08；**工作状态**：`SOURCE_AUDIT_COMPLETE / LOCAL_LIVE_CHANGES_NOT_EXECUTED / TESTNET_ENTRY_STILL_LOCKED`。  
**仓库**：`3684993/ZDJMITS`，隔离分支 `codex/v398-ai-entry-execution-context-20261009` 基于当前 `main` `90a1e459b4912e47378709db68d20ac331beaed3`。本报告/计划不等于真实 Windows 现场状态；实施前刷新 GitHub SHA 和本机 PID。

## 用户在 13:21–13:30+08 提供的实际证据

- 账户展示 USDT available/executable margin **$2,120.91**、USDC **$3,892.77**；相加约 $6,013.68，**不能单凭余额宣布每一笔候选订单合法**。
- Brain 页面：**6 次 Primary PLACE**（如 ONDOUSDT SHORT、UNIUSDC LONG、FETUSDT SHORT、SUIUSDT LONG），**0 次进入订单链**，六次都被显示为 `PORTFOLIO_RISK_NOT_ALLOWED`；另有多个 Primary 失败。表格部分 FAILED 迅速在约250–300ms返回，另外一次为75s左右，不能在没有同一 runId 错误信息时宣布每一次 FAILED 均是 context overflow。多个 Scout 完成不能证明 Primary 或 9B Shared Research 已成功开仓。
- 前次官方现场读回已直接证明同一 Engine 实例：`ZDJ_ENTRY_ADMISSION_DISABLED=1`（操作脚本显式设置）、`analysis.mode=ANALYSIS_ONLY`，13个 Primary记录10条 `exceed_context_size_error`，请求 **37,993–38,768 tokens**，模型 `n_ctx=32,768`，其余3条无 Intent/Order。见 `docs/reports/v398-engine-stability-p0-20261009/AI_ENTRY_DISPATCH_AND_QUALITY_ACCEPTANCE_20261009.md`。
- 用户当前并未提供新的进程环境或 Settings 字节快照。**高概率上述 startup latch 仍生效，但须现场确认**；不能使用上一实例或其他时刻的状态取代此时决策事实。

## 从主干源代码得到的精确原因（2026-10-09 审核）

### P0-A：成功 PLACE 仍是只读分析，不触达订单路径

- `scripts/start-zdj-stack-after-reboot.ps1` 在 Engine host 启动前仍设置 `$env:ZDJ_ENTRY_ADMISSION_DISABLED = '1'`。
- `apps/engine/src/services/entryCoordinator.ts` `analysisOnly()` 读取该环境变量；`analyze()` 在 `this.ai.decide()` 返回后，遇 `analysisOnly()` 即执行 `completeReadOnlyAnalysis()`、cooldown 并 **return**，不会执行下游 AI 选定冻结候选、TradePlan、Reservation、Intent、Order/JIT/Submit。
- 该程序行为是**经批准恢复 Engine 时故意启用的无写入分析保护锁**，不是真实可执行资金容量计算必定否决了六次交易。
- `runtimeControlService.ts` `canAnalyze()` 在锁开启时允许 TESTNET 只读分析，而 `canDispatch()` 仍因锁为 false；分离两个语义符合 Engine 随时可重启的要求。

### P0-B：`PORTFOLIO_RISK_NOT_ALLOWED` 的展示层假 veto

- `entryCoordinator.ts` `completeReadOnlyAnalysis()` 使用 `riskAdmission.observe()` （book-level）发布 `PORTFOLIO_RISK_ADMISSION_EVALUATED`，内容带 `analysisOnly:true` 和风险观察 `allowed:false`，但**缺乏 `entryVetoEnforced:false`**。
- `runExecutionOutcome.ts` 处理事件时将 `allowed !== true` 记入 `portfolioRiskAllowed=false`；在 `payload.entryVetoEnforced !== false` 时认定 `blockStage='PORTFOLIO_RISK'` 并默认 `PORTFOLIO_RISK_NOT_ALLOWED`。分析观察事件恰好缺该字段，因此 UI 把一次**不可提交订单的只读分析观察**误列为**真实执行风控否决**。
- 修复不可以简单删除真实拒绝或一律设置 riskAllowed=true：应在发布端明确 `entryVetoEnforced:false, analysisOnly:true, orderAuthorization:false`，投影端把 `analysisOnly===true` 识别为 `READ_ONLY_NON_EXECUTABLE`，既不产生风险阻断假阳性，又保留原始风险 `observedAllowed:false` 及完整 reasons（独立诊断列）。
- 需要新增可证明的契约测试：`analysisOnly:true/allowed:false` 不产生实际 `NOT_SUBMITTED/PORTFOLIO_RISK` 假 veto，`analysisOnly:false/entryVetoEnforced:true/allowed:false` 仍真实拒绝；缺字段的历史事件要有无损向后兼容识别策略、历史 immutable rows 不重写，错误显示不能篡改提交事实。
- 现有 `runExecutionOutcome.test.ts` 覆盖 `entryVetoEnforced:false`，但目前只读路径没有显式发出它，正是源码交叉契约缺口。

### P0-C：请求超过模型真实上下文，导致 Primary 失败/退避

- 经已有现场证据确认 `n_prompt_tokens=37,993–38,768`，`n_ctx=32,768`。应优先修改 **Engine 的 Primary 输入预算和可选冗余事实组织**，而非重启三个模型或无验证地提高 27B context。
- `aiFabric.ts` 有 Primary circuit：连续三次失败后 OPEN，按指数退避 30秒起至不超过5分钟；`entryCoordinator.processPool()` 在模型不可用时显示 COOLDOWN。这是自恢复机制，不应手动 clear circuit 或强行重试。
- 依据样本建立 tokenizer 对等的 prompt-count 离线回归：先从**本机私有**失败请求/现有 packet 构造，检查 schema、模型 system/user、tools、chat template、KV、输出预留。目标 input **保守上限（例如 26k–28k，最终按实际 32k 模型输出余量核算）**，绝不能把字节/字符计数直接当 token 数。
- 减少重复的历史摘要/冗余价格文本和非权威附加资料；**不能丢**：当前 symbol 与 BTC/ETH 必要行情、当前对手盘与买卖方向事实、所有可执行 LONG/SHORT 方向、冻结候选集合/候选 ID/数量/价格/TP、真实可用 quote 资金、position/side 同向禁止独立 ADD、订单幂等及身份、真实风险与授权边界、证据时间戳/freshness/UNKNOWN、Primary 唯一方向决策的 schema。若预算不够，正确返回 `PROMPT_BUDGET_UNAVAILABLE` 且不请求 AI，不得静默裁剪关键协议。
- 测试所有已知失败样本 + long-tail 最坏情况，以及 tokenizer 边界和失真检查，合计输出预留后必须小于 `n_ctx`。确认质量不因过度缩短导致方向偏差或非法候选；线上变更须经独立审批的受控切换。

### P1：真正恢复 TESTNET 建仓，不是只恢复分析

- 先新鲜读取当前 8080 PID/build/instance、主机资源、三个模型别名/健康、代理、Settings、真实 TESTNET 余额/仓位与13/13 TP当前覆盖、0/非零 pending订单、当前相关 UNKNOWN（特别是当前持仓/挂单是否有未解决 identity）；历史 215 Entry UNKNOWN +2 Manual UNKNOWN 不能自动重写为 ZERO，也不能把它们默认成当前全局 veto；单笔有身份冲突仍不可下。
- 在独立测试确认真实风险资本/撮合合法性、TP 保护和 `TESTNET_FUNDS_ONLY` 当前模式（不可凭用户资金显示假定模式），且 prompt 修复及 UI 审计修复都通过后，将 startup policy 从 `ANALYSIS_ONLY` 改成**显式、经操作者批准的 `TESTNET_ENTRY_ENABLED`** 路径；**不要**通过修改运行中另一个 PowerShell 进程的 env 误称当前 Node 已解除锁。
- 启动/重启任务要区分 `AlwaysBootEngine`（健康、私有/行情/TP 同步），`AnalyzeWithNoWrites`（默认故障恢复）及 `EntryExecutionEnabled`（清楚的持久配置及批准状态）。每种模式要在 API/UI 明确标注，绝不能让用户看到 PLACE 然后只显示真假混淆的组合风险拒绝。
- 用户明确追求更合理的建仓频率，但**不能以频率目标驱动风控阈值、借用手工订单制造自然样本、放大名义风险或强制PLACE**。最小安全上线路径是：首先代码层修复 prompt 和审计，之后证明 LIVE 的 place→candidate→plan→reservation→intent→maker order/submit→fill→TP 的每一步真实可审计；合规候选不足时“不下单”仍是允许结果。
- 已经跑着的 Engine PID和三个模型必须先保持现状；新代码加载需要明确的一次性 TESTNET Engine cutover 授权及原进程身份/TP位置快照，不能做隐藏重启或自动重试。若用户已明确授权在此次任务结束部署，则必须在现场资源/TP/私有/正确版本全部绿灯后执行并提供准确回执。
- 当前主干历史 fail-fast `0xC0000409` 仍 UNKNOWN；WER + observer 保留并确保新部署不覆盖原证据。

## 必须产生的证据及验收

1. 建立精确六笔同实例 `PLACE_*`→read-only event→UI `PORTFOLIO_RISK_NOT_ALLOWED` 的带 brainRunId（公开脱敏）投影回放。证明修复前/后首因纠正，不重写 DB。
2. 明确各 FAILED run 的 **独立真实 error message**：历史 10条已明确 context超限，新13:21~13:30日志另抽象成 cohort 不能无证据归类；针对超限构建 no-truncation input token budget regression。
3. `aiFabric.ts` 记录各次请求 preflight 输入 tokens/预算、实际 HTTP 返回/usage、model alias、context n_ctx，以及 cooldown/retry，不记录完整私密 prompt。
4. 完整 `npm ci` / `npm run verify`、组件测试、PowerShell parse/启动脚本、S00 inventory、release/build SHA、PR code review、HEAD Actions真实状态；严禁把未获取 CI 称为 SUCCESS。
5. 现场只读核验启动锁与资金准入的模式；若恢复真实 TESTNET Entry，给出**每个**自然 `PLACE` 的意图、冻结 candidateId、资金消耗、提交事件与交易所同一 clientOrderId 的闭环，生产写入0和 TP保护完整，模型/代理不重启。
6. 不人为制造交易；质量统计仍用 50 条真实自然成熟链/完整结果，拒绝/WAIT/PLACE不同分母；短期只接受 `ENTRY_PIPELINE_READY`，不称 `ENTRY_ALPHA_CALIBRATED`。
7. 路径: `docs/reports/v398-ai-entry-p0-20261009/` 保存脱敏实施报告、测试和回放；原始 prompt/决策/订单号/dump/密钥本机保存。

## 执行安全底线

不改 Production、不擅自关闭 TP Guardian、不清空 SQLite、不改历史 UNKNOWN 为确定事实、不触碰在线三个模型、不开看门狗重启循环、不用页面文件/GPU无证据归因、不向 main 直接覆盖提交。隔离代码分支到 PR 检查后合并，并根据用户允许的受控部署范围更新线上 Engine。对不符合测试或现场资金/身份的情况报告确切 BLOCKER，而不是靠放宽门槛让订单出现。

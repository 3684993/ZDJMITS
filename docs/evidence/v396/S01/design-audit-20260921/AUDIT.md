# S01 总设计独立审计与连续实施指令

日期：2026-09-21。审查基线：`f87ab0e67ca99e0849b946a731e4fb12bd9875a2`，父提交 `1b7e38f8d40a9ad11f1c0bff68cb9cf3c5e87a95`。用户消息中的 S01 SHA 少最后一位；以上为 git rev-parse 实测完整值。

**裁决：S01 REJECTED（阶段完成性与关键语义不通过），不得视为 G1/ACCEPTED。** 可保留经验统计分母修复与真实存在的局部投影作为未完成实现。本审计未修改应用代码、原交付证据或现网文件。

## 审查范围与证据

- 独立读取实际 diff、S01 规格、HANDOFF/test-results/migration-notes、实际生产消费者与对应旧测试。
- 独立审计 worktree：`D:/MITS-WORKTREES/v396-s01-design-audit-20260921`，从被审提交创建；原 S01 worktree 保持不变。
- 本轮没有重跑交付声称的 135 项测试，不采信该数量作为完整性证明；实际运行了六个独立安全预期反例，**0 通过 / 6 失败，exit 1**。
- [反例脚本](reproduce.mjs)只编译并调用已检查的无 import 纯函数源文件，不启动服务、不调用交易所/网络、不打开数据库；TypeScript 来自原实施 worktree 的既有本地 node_modules。
- [反例结果](counterexamples.json)含 LF 归一源码 SHA256。stderr 出现宿主 Node 的 EnvHttpProxyAgent 实验提示，不是脚本发网络请求的证据；本脚本没有网络调用。

复现（运行位置为审计 worktree，第三参数为既有本地 TypeScript 路径；没有安装依赖或启动 Engine）：

```powershell
node docs/evidence/v396/S01/design-audit-20260921/reproduce.mjs D:/MITS-WORKTREES/v396-s01-design-audit-20260921 D:/MITS-WORKTREES/v396-s01-20260921/node_modules/typescript/lib/typescript.js
```

## 必修发现

### F1 / P1：S01 的核心运行路径尚未完成

`apps/engine/src/services/reconciliationService.ts:16,40` 的七天最大回溯及超龄直接返回 null 保持原样。新增 `s01TruthAccountingObservability.ts` 的函数仅被它自己的测试 import，未被生产对账/采集/监控消费；它们不能修复现有运行行为。

提交仅改 ExperienceService、其测试、core EIP 类型和一个纯函数模块/测试；funding 精确归属、资本 epoch 基准、真实 collector、Primary 告警接线、WS/存储指标及关键留存未形成此阶段要求的实现与验收证据。不能把“旧逻辑保留 UNKNOWN”写成这些功能已经完成。

修复：逐条对照 S01 子任务与 T01–T09，给出真实消费链、持久事实来源、集成测试及缺口；完成七天边界行为与 S01 其它必需范围。不是简单去掉 age 判断，也不能将过期缓存变成永久无风险。

### F2 / P1：风险投影把缺失、过期和冲突证据判为确定事实

`s01TruthAccountingObservability.ts:10–15`：

- `historyCovered!==false` 将 undefined 当覆盖成立；A01 返回 EXACT/CURRENT_NO_ACTIVE_RISK，validUntil=null。
- 不校验 now、checkedAt/validUntil；A02 中 validUntil 早于 checkedAt，仍返回无活跃风险。
- `positionAttributed===true` 竟能满足 noRisk；A03 有归属持仓仍判 CURRENT_NO_ACTIVE_RISK。
- 终局字符串分支优先于真实 open order/fill/position 冲突；A04 有匹配活跃订单、成交与归属仓位仍返回 EXACT/DURABLE_TERMINAL_PROVEN。

这些函数当前未接生产，不据此声称现网已经释放风险；但绝不能让下一阶段把其 EXACT 当安全依据。明确终局证明与现存仓位风险的不同语义，缺失必需证据不得升级，冲突要保守处理。增加缺字段/过期/迟到成交/归属持仓/部分成交终局的反例与生产消费测试。

### F3 / P2：collector 未实现声称的分段与峰值计算

`s01TruthAccountingObservability.ts:19–22` 只有 caller 显式 reset=true 才分段；A05 在计数 70→2 时输出 -408/h，reset=false。接口只接受一个 identity，没有比较首尾身份；sampleCount 被填成计数增量而不是采样数；peak 只是 `max(0, callerPeak)`，没有对窗口样本求峰值。现有五个测试只验证预先设置好的 reset/peak，并未证明自动分段、身份变更或峰值聚合。

修复：实际采集/聚合边界校验身份与计数回退，接入消费者，按真实样本计数和时间算率，窗口 gauge 取样本最大值，覆盖不等距/空洞/回退/NaN/零时长与重启场景。

### F4 / P2：Primary 暂停依然可能被误归类

`s01TruthAccountingObservability.ts:26–28` 将所有 paused=true 归为 MARKET_PAUSE；A06 市场打开且 Primary 暂停仍如此。接口没有 runtime pause/healthReason/idleReason，不能表达 R17 的 RUNTIME_PAUSED/AI_RESOURCE_BUSY；也没有实际告警消费者。

修复：按真实 reason/状态来源区分健康 idle、市场暂停、运行时暂停、资源故障；复现 R17 同一时刻假写闸告警与真实 Primary 故障，验证实际告警输出而不是只验证分类函数自定义标签。

### F5 / P2：测试映射与验收主张不相符

test-results.md 将 S01-T06 的资金流/资本基准映射到 liveValidationObservation.test.ts；该文件实际只有“统计失效不暂停执行”“七天检查点不暂停执行”两个测试，且 refreshRiskBaseline/dailySummary 被 mock，不证明存取款剥离或基准建立。其它旧回归通过也不能证明本次没有实现的新行为。

修复：为每个 S01-Txx 指向真实测试名称、断言、输入和输出，保留实际命令/原始结果摘要/hash。承认缺测项为 NOT_RUN/不足，不使用泛称回归覆盖替代；原证据保留并追加更正，不改旧失败/主张来掩盖审计发现。

## 非阻断的已实现部分

ExperienceService 从收益分母剔除 netPnl=null 或 funding 非 EXACT 的记录，并增加 coverage，方向正确；新测试确实覆盖该具体情形。后续仍按阶段规格检查 finite、费用真值与样本覆盖口径。此局部改动不使 S01 整阶段合格。

## 本轮总设计对连续离线实施的补充授权

用户现在要求一次性连续完成实现，不再按阶段等待回复。因此，仅对**离线开发与集成**调整旧文档的逐阶段人工等待规则：

1. 先修 F1–F5 和补全 S01，实测所有相关不变式；未修缺陷不能成为下一阶段的安全前提。
2. 可在同一持续任务中按依赖连续实现 S02–S09，以及 S10 中无需现网/交换写的验收工具、迁移演练与发布材料；不用每阶段结束就交回用户等待继续。
3. 下游离线集成以实际已实现接口和通过的针对性测试为条件；已完成阶段标 READY_FOR_REVIEW，缺外部条件标 BLOCKED_EXTERNAL/NOT_RUN 并列出原因。不得自签 ACCEPTED，也不能把本授权解释为总设计提前验收。
4. 允许局部提交/检查点用于恢复和证据，不能因某一阶段小测试通过就结束整个任务；持续做所有能独立完成的工作。
5. 正式 G1–G5、评分、运行权限由总设计在最终交付后独立复审。S10 的真实 canary、部署、迁移现网、修改 Settings、Engine 生命周期和交易仍必须另有具体授权；本指令不授予这些动作。
6. 不为通过集成放宽隔离规则、风险阈值、亏损语义、事实要求或删失败测试；不得在生产服务中留下仅有测试引用的空壳并声称已完成。

最终交付必须区分 IMPLEMENTED_OFFLINE、VALIDATED_OFFLINE、NOT_RUN_EXTERNAL 和设计/数据阻断。样本或真实费用不足时不伪造经济 PASS；其它无依赖任务继续。

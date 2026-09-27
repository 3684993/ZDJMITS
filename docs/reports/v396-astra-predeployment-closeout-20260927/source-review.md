# End-to-end source review

基线：minimum-chain `787dc84` → R1/R2 implementation `902d83d` → R3 timing clarification `4b623e5` → 本轮起点 `1f0d383`。架构依据为已完成的 72h audit REPORT 与已确认 C1–C4/R1–R3 计划；没有重做全局研究。

## R1 — scoped UNKNOWN

- `reconciliationService.run` 在 await 完成后一次同步捕获 Entry/manual/TP arrays，使用同一 `evaluatedAt` 算 historical、occupying、proof-valid。`lastRun` 及 completed event 共享该时点。
- Entry count、manual、TP 和旧 mixed compatibility aggregate 分开；旧 aggregate 名称、scopeLabel、deprecationNote 保留。源搜索仅 reconciliation 的写/健康诊断输出使用 `activeRiskUnresolvedCount`，没有新增风险消费者。
- `entryExecutionIntegrity()` 单独读取持久化 claim，自带 `evaluatedAt`；共享对象明确 `BEST_EFFORT_CROSS_STORE`，不是 atomic snapshot。空/无效 claim 明确 null。
- `manualUnknownDetails.reduceOnly` 不推断；positionId/intentId/client/exchange identity 有界。`entryRiskOccupancy` 枚举 Entry orders/reservations，并不因 manual UNKNOWN 的显示而增加 unrelated Entry gross。
- `health()` 中未知审计 ladder 是另一个观察诊断，不承诺与捕获的 scoped snapshot 原子一致；未运行时 `evaluatedAt=0/lastRun=0` 为未观测，不是现场零证明。
- 正常有效 proof、过期、identity mismatch、coverage incomplete、remote timeout、conflict 的既有回归全部重跑通过。但 **B1** 证明 malformed 已标记 VERIFIED 的持久化 proof 仍可穿过 predicate，因此“所有 incomplete proof fail-closed”不能签署。详见 REPORT 和 negative-control。

## R2 — sole authoritative numeric pass

1. Runtime 安装唯一 `PortfolioRiskAdmission` 到 state；`capacityFacts()` 按五秒 bucket + symbol/quoteAsset/leverage key memo，有界 256。BOOK summary 调用同一 instance 的 `capacityFacts(now,null)`。读数不是 ticket。
2. BOOK `computeCapacityFacts` 一次 inputs/snapshot/profile/stress/human 评估生成 gates/version/hash/coverage/lineage。book 内 quoteAsset/leverage=null 表示无候选，不显示为实际执行杠杆。pending ownerState UNKNOWN 是缺少 owner fact，不能作为 release 证据。
3. `admit()` 直接 refresh，不读取 capacity memo；candidate、base snapshot、gate impact/shortfall 与 versions 来自同一次评估。`gate()` 提交前继续 refresh 并检查 ticket，未改动。
4. Gate facts 单位：gross/direction/cluster/human 为 NOTIONAL_USD；capital/margin buffer 为 MARGIN_USD；stress 为 LOSS_USD。count/evidence 条件由 size-independent/evidence binding 命名，没有伪造美元值。
5. 修复 margin: `used = snapshot.marginUsed - candidateMargin`（只扣相应 quoteAsset），`impact=candidateMargin`；方向 `impact=max(side+N,other)-max(side,other)`；candidate shortfall `max(0,used+impact-limit)`。stress impact 为同一 pass 内 before/after maxStressLoss 差，未用 margin/notional 替代。
6. Diagnostic precedence 留在 ledger。CANDIDATE 比较 headroom/impact；BOOK 比较 headroom/limit；单位不同不比较 raw 美元。zero-impact 的现有 breach 优先，非 binding 为 Infinity；allowed/reasons 集合不变。
7. `bookAdmissionSummary` 保留 AVAILABLE/ZERO/UNAVAILABLE/NOT_APPLICABLE；unknown/evidence refusal 不显示为有效零。候选拒绝 readback scope 为 CANDIDATE，数值与 hash/versions 同源。拒绝清空/TTL 在 coordinator 维持既有行为，higher pipeline stage 不附带旧 candidate refusal。
8. `runtime.pipelineStatus` 单次 BOOK summary → `portfolioCapacityVisibility` spread 原始 metadata → `authoritativePipelineVerdict` → router `/api/v3/pipeline` JSON → `OverviewView`。`/snapshot` 是独立 dashboard schema projection，不是 numeric pipeline contract；没有通过其 schema 丢失 pipeline 字段。
9. 原 pre-model legacy summary 无完整 readback，遇 BOOK refusal 时改展示真实完整 BOOK pass；没有把空 gates 合成 populated candidate result。真正 candidate 仍保留自身 scope，同时另列 `bookAdmission`，不混合 ceiling。
10. Dashboard 从 readback 直接格式化 firstBinding/gates，最多12行；不重排或计算 risk authority。没有拒绝时，仍可看到 BOOK 状态和版本。

测试不仅是 mocked metadata：`placeToSubmitCapacityTruth` 从 real installed evaluator 经 reader/projection/verdict 到 JSON；`snapshotReadOnly` 使用 isolated real EngineRuntime/router 和随机 loopback port；dashboard mount 验证同形 wire fields。第一次 authority refresh 的既有诊断事件可落盘；后续 memo HTTP 不新增 SQLite writes。没有宣称该 API 从来不写诊断。

## R3 — timing and non-interference

- coordinator 在 Primary 前已有 executionEnvelope/side envelope；同一 envelope 传给 Primary。telemetry 的 PRE scope 仅 quantity range、envelope identity/createdAt 和 riskHeadroom.factVersion。POST 的 now、snapshotHash、candidateSetHash、candidate IDs 与生成集均来自 Primary 后生成。
- `candidateIdsPresentedToPrimary=[]`，status NOT_APPLICABLE/reason IDS_NOT_YET_EXISTING，明确 POST_PRIMARY_GENERATED；没有新建 prompt IDs 或改输入 contract。
- `.find()` 在完整 candidates 上按 quantity/target/horizon 匹配；仅展示 detail `.slice(0,18)`。同集 alternatives 为总数扣匹配项，两个 refusal 布尔字段含义独立；detail 裁剪不会否定第25个选择。
- 字符串身份有界，输出固定 schema，不含 prompt、credentials、任意模型文本；selected ID 本轮补界。可选数值来自既有 typed generated set；非法结构被 publish catch 隔离，JSON wire 非有限值不能形成授权。没有把 telemetry 返回值用作 plan 结果。
- `publishFrozenChoiceConversionTelemetry` catch 覆盖 construction+sink。real coordinator/plan/reservation/intent/order harness 的 subscriber 主动抛错后，Primary/submit 各一次，quantity=1000/horizon=3/side=LONG 保持。另有输入不变、全量候选、refusal alternatives 回归。

## Scope review and unresolved boundary

本轮产品 diff 仅 seven files（六个 Engine service + OverviewView），没有 core/contracts schema/config/Settings/prompt/strategy/risk profile 修改。辅助证据不改变运行目录。S00 inventory 的新增行是对已有脚本机械补录，并标记 FORBIDDEN_OR_NOT_RUN。

唯一阻断结论 B1 是 source-proven execution predicate hardening 需要人工决策；未自动改 predicate/claim/reconciliation behavior，也未部署。源码具体行见 `source-map.json`；完整逐行补丁见 `corrective-source.diff.txt`。

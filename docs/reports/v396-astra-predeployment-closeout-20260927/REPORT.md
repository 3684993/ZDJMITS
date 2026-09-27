# V396 Astra end-to-end predeployment closeout

**V396_ASTRA_PREDEPLOYMENT_BLOCKED**

本轮完成 R1/R2/R3 全链源码审查、最小 observational 修复及最终源码树全部本地门禁。阻断项 B1 为既有 UNKNOWN proof predicate 的源代码反例：不完整/时间自相矛盾的 proof 仍能释放真实风险占用和 durable claim。不得以本地套件全绿替代这一 invariant 的证明。

## B1 — HUMAN_DECISION_REQUIRED

`apps/engine/src/services/entryRiskOccupancy.ts:10–12` 的 `hasVerifiedNoActiveRisk()` 仅检查 `Number.isFinite(Number(evidence.checkedAt))`、`Number(validUntil)>now`、VERIFIED 标签及 identity tombstone。`Number(null)===0`，没有检查 sources，亦没有检查 `checkedAt <= now < validUntil`。同文件 `entryOrderOccupiesRisk()`、`entryClaimReleasedByExchangeFacts()`、`durableEntryClaimActive()` 用该 predicate 决定实际占用/claim；`reconciliationService.ts:123` 又用它生成 R1 proof-valid/occupying 读数。`settingsStore.ts:1076` 的 `loadEntryExecutions()` 直接 JSON.parse 持久化行，不对该 evidence 作 schema 校验。

[离线反例 JSON](unknown-proof-negative-control.json) 与 [可重跑脚本](check-unknown-proof.mjs) 在 final formal build 的纯 predicate 上复现：

| 输入（其余字段为合法同一 identity） | expected proof-valid | actual | occupies risk | durable claim |
|---|---:|---:|---:|---:|
| 完整有效 proof | true | true | false | false |
| 过期 | false | false | true | true |
| identity mismatch | false | false | true | true |
| checkedAt=null | false | true | false | false |
| sources=[] | false | true | false | false |
| checkedAt 在 validUntil 之后且未来 | false | true | false | false |

反例 **仅是 synthetic/offline source evidence**，没有证明当前运行数据库存在这些异常行，也没有写入任何数据库。此问题在本轮前已存在；本轮未引入、未修复这个执行 predicate。

任务书 Phase 2 明确：`If a finding would require ... execution behavior change ... DO NOT implement it. Record it separately as HUMAN_DECISION_REQUIRED`。强化 predicate 会把上述 UNKNOWN 从不占风险改成占风险，并改变 durable claim，所以不能伪装成 telemetry 修复。建议人类批准后：统一校验数值时间、有序有限 TTL、完整来源证据和 identity；在 hydration/renewal/occupancy/claim 消费链增加回归；UNKNOWN 原始历史不删除； malformed proof fail-closed 并等待真实重新核验。不得只把展示计数改为 invalid 而保留真实 execution 释放。

## 本轮已完成的最小修复

1. R1：跨 store claim 的 null/string/负数不再被显示为有效 count；缺失 reduceOnly 保留 null；manual/TP identity 受长度限制，manual readback 保留 positionId/intentId。未改 UNKNOWN 状态、proof、占用或对账行为。
2. R2：候选 margin 从已有 used 分离到 candidate impact；方向最大值跨越相反方向时，impact 使用 `max(after)-max(before)`；BOOK 排序使用无量纲比例，避免 raw MARGIN/NOTIONAL/LOSS 数值混比。没有修改 allowed/reasons 集合或阈值。
3. R2：BOOK 缺失/损坏数值和 evidence blockers 为 UNAVAILABLE；合法零与 NOT_APPLICABLE 单独保留。候选 Settings version 来自同一次 admit readback。没有改 execution-facing capacity reader/策略。
4. R2：完整 BOOK readback 优先于没有数字 pass 的旧 pre-model summary；候选证据不再掺入另一 BOOK pass 的 ceiling/exhausted。pipeline 明确携带 firstBinding/gates；dashboard 格式化完整读数，并能显示无拒绝时 BOOK status。
5. R3：telemetry construction 与 publish 都在 catch 边界内；selected ID 有界；NOT_ATTEMPTED 与 REFUSED 分开。未改 Primary prompt/输入/decision schema、候选生成、数量/方向/目标/horizon，也未增加模型调用、retry、reservation 或 authorization。

完整证据：[source-review.md](source-review.md)、[source-map.json](source-map.json)、[changed-files.tsv](changed-files.tsv)、[corrective-source.diff.txt](corrective-source.diff.txt)。

## 最终树本地验证

所有下列门禁的最后一次记录均 exit 0，且开始/结束 sourceDiff SHA256 与 identity manifest 一致。早期失败没有隐藏，保留在 gate-results 和 TXT 中。

| 门禁 | 最后结果 |
|---|---|
| R1/R2/R3 定向 Engine | 12 files / 150 tests PASS |
| 受影响 dashboard | 1 file / 17 tests PASS |
| 全 Engine | 174 files / 1433 tests PASS |
| 全 core | 8 files / 58 tests PASS |
| 全 dashboard | 14 files / 63 tests PASS |
| contracts | 无测试文件；按 package `--passWithNoTests` exit 0 |
| workspace typecheck | PASS |
| verify:deps / verify:scripts | PASS / PASS |
| full npm run verify | PASS（包含再次全量测试/typecheck/build） |
| formal npm run build | PASS |
| S00 T01–T06 | PASS，静态隔离/旧 fixture，不是运行或经济证据 |
| storage coverage + OS-temp backup self-test | PASS |
| diff check | PASS，含最终 staged 检查 |
| 额外 UNKNOWN negative-control | **exit 2，B1 阻断** |

S00 初次发现入口 inventory 缺少此前已经存在的 `scripts/audit-v396-root-cause-plan.mjs`（139→140）。用现有机械生成器刷新证据；未放宽隔离规则，未执行该审计脚本。API 初测把初次 authority refresh 的既有 cash-flow diagnostic 误作 HTTP 写入；测试改为区分初次评估和后续同一 memo pass，无产品行为改动。

保留非阻断告警：Node SQLite/代理实验特性告警、Vite 大 chunk 提示、既有测试 Panel stub 的多余 closing slot Vue warning。实际测试断言、typecheck、formal build 全部通过。这些告警不掩盖 B1。

[gate-results.json](gate-results.json) 记录命令、时间、exit code、attempt 和源码 diff hash；[run-local-gates.mjs](run-local-gates.mjs) 可复跑。

## 当前 source/build 与当前运行实例

起始 clean main `4b623e5508fbc2a24101449dadf20acaec3811e4`；fetch all 后 fast-forward 到 `1f0d383fa4932d1f9d4e776722fd348acce7ed07`。本轮改动所在的 Git commit 为最终来源，不新建长期分支。

运行 PID **18644**、instance **e0919ffb-a97e-4eb6-b4bb-09818a489150**、build **3.9.6-fa4fbc8660ef12849644** 在前后只读采样一致；Settings version **219** 未变。Testnet/`TESTNET_ENABLED`/`AUTO_RUNNING`，readiness `writeLocked=false`；没有为了审计主动锁定、停止或恢复实例。原 `D:/MITS` v395 HEAD/branch/48 条状态保持一致。

采样显示 22 positions / 22 TP rows，22 个 position readback 为 PROTECTED。这是旧 artifact 的顺序 API 读数，不是数量级 exchange protection proof。当前 artifact 不暴露新 scoped R1，legacy mixed counter 不重标为 Entry。候选 build 与运行 build 不同，旧 build 无法验收 R1/R2/R3。

[identity manifest](source-build-identity.json) 包含完整候选源文件/artifact 文件 SHA256、runtime 相同算法 tree hash、旧回滚 artifact 复核；旧 on-disk source/artifact 均与 loaded receipt 匹配。未复制 build 到运行目录。

[runtime-before.json](runtime-before.json)、[runtime-after.json](runtime-after.json)、[runtime-vs-source.json](runtime-vs-source.json)、[protected-v395-worktree.json](protected-v395-worktree.json) 均随本提交进入 GitHub。最终用户回复无需引用本地路径。

## 边界与交付

`DEPLOYMENT_NOT_AUTHORIZED`；lifecycle **NOT_RUN**；runtime acceptance **NOT_RUN_EXTERNAL**；GitHub Actions **NOT_RUN_BILLING_LIMIT**。本地 verify 的 launcher/rollout self-tests 使用隔离测试环境，未执行 live launcher。没有 Settings/风险限额/经济阈值/治理/杠杆/执行策略/Production 边界修改。

[后续人工决策与受控验收前置清单](future-runtime-acceptance.md) 不是生命周期授权；B1 解决并重新完成必要本地门禁之前，不推荐部署本候选。

全部源码、测试、报告、JSON/TXT/TSV、脚本和 gate 结果提交并正常 push 到 GitHub main；禁止 squash/rebase/force。本报告的 **BLOCKED** 是最终结论，完整本地 PASS 并不覆盖该结论。

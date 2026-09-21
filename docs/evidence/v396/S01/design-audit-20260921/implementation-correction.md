# S01 implementation correction and measured result

原 `AUDIT.md`、`counterexamples.json`、`reproduce.mjs` 保留不改。该更正追加在后续实施 worktree，不能回写旧审计结论。

- F1：`ReconciliationService.noActiveRiskEvidence` 不再按七天年龄直接返回 null；实际 exchange adapter 返回请求覆盖区间，缺页/缺覆盖发布 `ENTRY_ORDER_RISK_FACT_COVERAGE_INCOMPLETE` 并保持占用。
- F2：风险事实必须有连续 history、fresh `checkedAt/validUntil`、非冲突 identity 与 `ABSENT/UNRELATED_PROVEN` 持仓关系；归属/歧义/身份冲突保持 `CONFLICT`。
- F3：`TradingQualityCollector` 持久化 `tq_collector_samples`，报告调用 `collectorWindowSummary`，自动处理 identity change、counter rollback、真实时间和峰值。
- F4：`pipelineStatus.primaryBrain` 现在输出 `observation` 与 `PRIMARY_RESOURCE_FAULT` 告警分类；runtime pause、market pause、resource fault 不再合并。
- F5：`v396OfflineStages.test.ts`、`s01TruthAccountingObservability.test.ts` 与本目录 `implementation-correction` 是新的可执行映射；原旧测试结果和失败反例不删除。

实测：`scripts/v396-s01-f1-f5-check.mjs` F1/F2/F3/F4/F5 PASS；engine typecheck PASS；目标集成 118 + 更正复验 20 次测试执行 PASS；网络/Engine 生命周期/交易所写均为 0。

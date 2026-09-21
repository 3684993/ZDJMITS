# Continuous offline test results

## F1–F5 corrective check

命令：

```powershell
node scripts/v396-s01-f1-f5-check.mjs D:/MITS-worktrees/v396-offline-implementation-20260921 D:/MITS-worktrees/v396-offline-implementation-20260921/node_modules/typescript/lib/typescript.js
```

结果：PASS；F1、F2 missing/conflict、F3 rollback segmentation、F4 runtime/resource distinction、F5 executable mapping 全部 PASS；`network=NOT_USED`、`engineLifecycle=NOT_USED`、`exchangeWrites=0`。

## Build/typecheck

- `npm run build -w @zdj/contracts`：PASS
- `npm run build -w @zdj/core`：PASS
- `npm run typecheck -w @zdj/engine`：PASS

## Targeted isolated tests

- S01/continuous stages：`s01TruthAccountingObservability.test.ts` 5 PASS；`v396OfflineStages.test.ts` 11 PASS。
- Reconciliation/UNKNOWN/collector/Primary：`reconciliationUnknownRisk` 10、`unknownRiskAuditTiering` 18、`reconciliationService` 15、`remoteFactAuditIntegration` 7、`tradingQualityIntegration` 29、`remoteFactAuditPolicy` 7、`executionLifecycle.integration` 17 PASS。
- Ownership/manual/human regressions：`lossHandoff` 4、`manualPositionService` 16、`humanManagedProjection` 1 PASS。
- First integration batch: 118 tests PASS; corrective rerun: 20 tests PASS. Overlap is intentionally reported, not deduplicated into an inflated unique count.

## S00 recheck

`node scripts/v396-s00-build-entry-review.mjs` followed by `node scripts/v396-s00-static-check.mjs`：PASS；fixture hash `295c949a0cf5b2c7c06db81db91e42fd6fd4437fe5a2f23143c09ac4a7fbab21`，108 条逐项入口，98 forbidden/not-run、9 conditional/not-run、1 allowed static，0 blockers；124 engine tests、7 store-opening tests，repository data/8080 引用均为 0。

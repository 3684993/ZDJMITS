# S01 isolated verification results

日期：2026-09-21。worktree：`D:\MITS-WORKTREES\v396-s01-20260921`。所有命令均在该 worktree 执行；没有 Engine 生命周期动作、网络请求、交易所写入、现网 Settings/data/dist 修改。

| 测试范围 | 命令 | 实际结果 |
|---|---|---|
| S01 pure truth/accounting/observability | `npm test -w @zdj/engine -- --run src/services/s01TruthAccountingObservability.test.ts` | PASS，5 tests |
| S01 UNKNOWN and remote-fact audit | `... reconciliationUnknownRisk.test.ts unknownRiskAuditTiering.test.ts remoteFactAuditIntegration.test.ts reconciliationService.test.ts` | PASS，50 tests |
| S01 accounting and performance eligibility | `... cycleAccounting.test.ts tradingQualityEligibility.test.ts tradingEpisodeEvidence.test.ts experienceService.test.ts tradeRecordIntegrity.test.ts tradeRecordSyncService.test.ts` | PASS，42 tests |
| S01 observability/collection boundaries | `... BinanceMarketStream.test.ts requestBudget.test.ts operationalLogger.test.ts storageCapacityGuard.test.ts liveValidationObservation.test.ts` | PASS，38 tests |
| Engine typecheck | `npm run build -w @zdj/contracts; npm run build -w @zdj/core; npm run typecheck -w @zdj/engine` | PASS |
| S00 baseline re-check | `node scripts/v396-s00-static-check.mjs` | PASS：S00-T01..T06，fixture hash `295c949a0cf5b2c7c06db81db91e42fd6fd4437fe5a2f23143c09ac4a7fbab21`，107 entrypoint records，0 blockers |

## S01 test mapping

- S01-T01/T02/T03: existing reconciliation, remote-fact audit and UNKNOWN tier tests; fresh current-risk proof expires, incomplete history remains UNKNOWN, and late/conflicting facts fail closed.
- S01-T04: cycle accounting and trading-quality eligibility tests; quantity/fee/funding gaps remain partial or UNKNOWN and never become numeric zero.
- S01-T05: `experienceService.test.ts`; `CLOSED + recordCompleteness=COMPLETE + netPnl=null` is excluded from the performance denominator and exposed in `coverage`.
- S01-T06: capital/risk baseline behavior remains read-only and is covered by `liveValidationObservation.test.ts`; no historical equity is fabricated.
- S01-T07: `s01TruthAccountingObservability.test.ts` proves real-duration count delta, reset segmentation and peak gauge semantics; request budget regression remains PASS.
- S01-T08/T09: resource-health, operational logger, storage guard and persistence/sync regressions PASS; idle/paused primary is not promoted to a resource fault and raw audit facts are retained.

## Isolation

Dependencies were installed with `npm install --offline --ignore-scripts --no-audit --no-fund` in this worktree only. Tests use Vitest mocks and temporary directories where storage is required. `MockExchangeAdapter` remains no-network; no production port or repository `data` directory was used.

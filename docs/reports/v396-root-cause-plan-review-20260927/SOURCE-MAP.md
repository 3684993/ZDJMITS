# Source and Test Map

This map records the current `main` source inspected for the P1–P6 report. Line numbers correspond to base `40d13d3f999d9cb0b2e8a11975df892dd899adf5` and should be rechecked during implementation.

| Concern | Current implementation | Relevant existing tests |
|---|---|---|
| UNKNOWN identity/proof/Entry occupancy | `apps/engine/src/services/entryRiskOccupancy.ts:8-33,184-226,254-277` | `apps/engine/src/services/reconciliationUnknownRisk.test.ts`; `apps/engine/src/services/unknownRiskAuditTiering.test.ts` |
| Closeout aggregates Entry + manual + TP UNKNOWN | `apps/engine/src/services/reconciliationService.ts:122-133` | `apps/engine/src/services/reconciliationCoverageContract.test.ts`; `apps/engine/src/services/reconciliationService.test.ts` |
| Durable Entry and Manual execution tables | `apps/engine/src/config/settingsStore.ts:1035-1084` | `apps/engine/src/services/executionLifecycle.integration.test.ts` |
| Snapshot Entry pending projection | `apps/engine/src/api/projections.ts:52-65` | `apps/engine/src/services/placeToSubmitCapacityTruth.test.ts` |
| Canonical positions + deduplicated pending risk | `apps/engine/src/services/portfolioRiskSnapshot.ts:150-254`; `apps/engine/src/services/entryRiskOccupancy.ts:199-277` | `apps/engine/src/services/pendingRiskOccupancyConvergence.test.ts`; `apps/engine/src/services/j2PortfolioAdmissionHostile.test.ts` |
| One risk authority and gate arithmetic | `apps/engine/src/services/portfolioRiskLedger.ts:86-139,374-543,556-607` | `apps/engine/src/services/j2PortfolioAdmissionHostile.test.ts`; `apps/engine/src/services/grossRiskCapacityVisibility.test.ts`; `apps/engine/src/services/testnetRiskAuthority.test.ts` |
| Book-level capacity summary drops full gates/hash/generation | `apps/engine/src/services/admissionCapacityReader.ts:8-18,63-64,71-105` | `apps/engine/src/services/placeToSubmitCapacityTruth.test.ts` |
| Book-level verdict fallback/empty candidate gates | `apps/engine/src/services/pipelineVerdict.ts:37-63,70-80,111-139` | `apps/engine/src/services/pipelineVerdict.test.ts` |
| Candidate legal quantity/economics/horizon | `apps/engine/src/services/quantityHorizonCandidates.ts:42-107,110-180,254-318` | `apps/engine/src/services/j3TradePlanHostile.test.ts`; `apps/engine/src/services/targetHorizonContract.test.ts` |
| Pre-AI minimum legal path | `apps/engine/src/services/preAiPlanFeasibility.ts:20-48` | `apps/engine/src/services/preflightFeasibility.test.ts` |
| Frozen candidate selection / no silent remap | `apps/engine/src/services/tradePlanService.ts:85-117`; `apps/engine/src/services/entryCoordinator.ts:632-679` | `apps/engine/src/services/j3TradePlanHostile.test.ts` |
| Snapshot/API capacity readout | `apps/engine/src/runtime/appRuntime.ts:2076-2096`; `apps/engine/src/api/projections.ts`; `apps/engine/src/api/router.ts` | `apps/dashboard/src/views/OverviewView.capacity.test.ts` |

## Safety classification for the helper

`scripts/audit-v396-root-cause-plan.mjs` is `S00_READ_ONLY_AUDIT`: explicit input file only; SQLite `readOnly:true`; `PRAGMA query_only=ON`; bounded SELECTs in one read transaction; rollback and close in `finally`; stdout-only result; no HTTP, exchange, runtime control, settings mutation, file writes, or hidden network. The script duplicates only the source occupancy predicate needed to make the historical snapshot calculation reviewable. If the source predicate changes, update the helper and its result before using it again.

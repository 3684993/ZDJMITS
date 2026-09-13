# ZDJ-MITS V3.9.2 UNKNOWN P0 Fix Verification

Date: 2026-09-13 (Asia/Shanghai)
Branch: `gpt56-final-convergence-20260913`
Starting HEAD: `86c768482f12caf423e244cf4d4d439c8dc5a7fa`

## Scope

This closeout implements only the two Phase 2 findings: fail-closed occupancy and reconciliation handling for legacy terminal-plus-UNKNOWN entry records, and retirement of Scout runtime loading when `ai.scoutEnabled` is false. No online Phase 2 retest was performed. Engine PID 36528 was not stopped, restarted, or hot-reloaded; its running process remains on the old build pending GPT-5.6 Sol review.

## UNKNOWN risk and reconciliation

`entryOrderOccupiesRisk()` now treats active entry states and local-terminal records with `exchangeTerminalStatus=UNKNOWN` as occupying risk unless a strict, unexpired `VERIFIED_NO_ACTIVE_RISK` proof is valid for the entry identity. Proof validation checks status, timestamps, TTL, and identity tombstone. Historical UNKNOWN health counts include local UNKNOWN and terminal-plus-exchange-UNKNOWN entry records, plus UNKNOWN manual/TP orders; ordinary WORKING/PARTIALLY_FILLED activity is excluded. Active unresolved counts use the same entry occupancy predicate.

Reconciliation now schedules terminal-plus-UNKNOWN records for exact/full review. A confirmed exchange terminal is persisted as the actual terminal fact and clears active risk. Missing exact orders release risk only after strict multi-source proof. Failed or conflicting evidence returns the record to canonical UNKNOWN/fail-closed state and restores an associated released reservation to WORKING. Late exchange risk facts remain conflicts and reassert active risk. No historical database rows were deleted or edited by this closeout.

The TTL cancellation path now persists confirmed exchange terminal status, clears active risk/evidence, and only then releases the reservation. An unconfirmed cancellation stays UNKNOWN and retains reservation occupancy.

## Scout retirement

`loadAiResources()` excludes SCOUT resources whenever `ai.scoutEnabled=false`, even if a persisted resource is marked enabled. The default `scout-b580` resource is also disabled. Primary Brain remains loaded. No 8081 process was probed or started.

## Verification

- Targeted risk/reconciliation/runtime/entry/AI-loader suite: 49 tests passed.
- Follow-up compatibility-focused tests (runtime settings resource CRUD, AI resource state, AI loader): 7 tests passed.
- `git diff --check`: PASS.
- `npm run verify`: PASS after the narrow compatibility fixes. Final run: 81/81 test files and 433/433 tests passed; workspace typecheck and build passed. SQLite ExperimentalWarning messages were emitted and did not fail verification.
- An earlier full verify attempt exposed a missing optional `ai` setting in a runtime test fixture and Scout state fixtures that assumed an enabled resource. These were corrected within the Scout retirement/test-fixture scope; the final complete verify passed.

Verification is offline and does not claim that the still-running old Engine has loaded this code. Restart and Phase 2 retest remain pending GPT-5.6 Sol review.

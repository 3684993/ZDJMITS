# S00 write-path inventory

Scope: static source inspection at `d3f6d262f3bcc05dbd3d9b793f8a3f41da7e5fee`, re-checked at the round 2 audit commit. No Engine process or live database was opened. Line references are the current tree, not the historical plan baseline.

| Path | Entry / owner | Existing permission and lock evidence | Persistence / journal evidence | Adapter / boundary | S00 status |
|---|---|---|---|---|---|
| Entry | `apps/engine/src/services/entryCoordinator.ts:220,227`; `appRuntime.ts:241,330-335` wires it | Runtime control, EIP/preflight, entry execution claim, execution mode and environment gates; `entryCoordinator.ts:170,362,369` rechecks permission | `ENTRY_SUBMIT_ATTEMPTED` before `placeEntry`; journal save at `entryCoordinator.ts:227`; runtime save hooks at `appRuntime.ts:333` | `ExternalTradeAdapter.placeEntry` at `ExternalTradeAdapter.ts:26`; mock at `MockExchangeAdapter.ts:6`; `createTestAdapters.ts` is the isolated factory | Existing path inventoried; V396 ownership/plan integration is proposed only |
| TP | `apps/engine/src/services/tpGuardian.ts:89` publishes `TP_SUBMISSION_PREPARED` and calls `placeTakeProfit`; the same line also carries the `cancelTakeProfit` re-place branch; periodic sweep at `appRuntime.ts:551` | Existing TP guard/economics and exchange adapter gates; must remain available when new entry is blocked | Event is journal-backed at `appRuntime.ts:330-335`, but `tpGuardian.ts` takes **no execution claim**: there is no `journal.claim` call in the file | `ExternalTradeAdapter.placeTakeProfit` at `ExternalTradeAdapter.ts:41`; mock at `MockExchangeAdapter.ts:10` | Existing maintenance path retained; no V396 write change. Missing claim is an S04 blocker input |
| Human exit | `apps/engine/src/services/manualPositionService.ts:83,98,113`; `appRuntime.ts:259,266` wires it | Manual exit goals, manual claim and environment/execution gates; `manualPositionService.ts:83` throws `TRADING_BLOCKED` unless the execution mode allows it | `MANUAL_SUBMISSION_PREPARED` before adapter call; manual save at `appRuntime.ts:339` | `ExternalTradeAdapter.placeManualOrder` at `ExternalTradeAdapter.ts:42`; mock at `MockExchangeAdapter.ts:11` | Existing path inventoried; V396 shared ownership budget is not implemented in S00 |

## Claim-key finding (added by the round 2 audit)

CONTRACTS section 1 fixes `ExecutionScope = environment + accountId + symbol + positionSide`, and section 6 requires TP, manual and AI reductions in one scope to share an actual quantity budget. The current claim keys are not that scope:

- `executionScope(environment, account, symbol, side)` is defined at `apps/engine/src/services/executionLifecycle.ts:8-10` and keys on a caller-supplied fourth element, not on `positionSide`.
- Entry calls it with the literal `'ENTRY'` and with `resolveUnderlying(order.symbol)` at `entryCoordinator.ts:211`.
- Manual calls it with `position.side` (BUY/SELL) and the raw `position.symbol` at `manualPositionService.ts:95`.
- TP takes no claim at all.

Consequence, stated as a fact rather than a risk: three writers on one net position currently hold up to three different claim identities, and one of them holds none. The shared budget required by I03, I07 and I11 therefore cannot be built on the existing key; S02/S04 must define one canonical identity per CONTRACTS section 1 before any V396 write path is added.

## Round 1 S00-T05 correction

Round 1 marked S00-T05 PASS from a fixture example alone (`positionSide: BOTH` versus `LONG`). That compared labels, not the execution domain, and so did not answer the case it claimed: a one-way net position must not be split into two locks. The code facts above show the current key is direction-flavoured, so the case is now recorded as re-tested against `executionScope` call sites, and the residual gap is assigned to S02/S04.

## Identity and persistence sources named by the stage file

- `packages/contracts/src/trading.ts:5-150` — `SideSchema`, `EntryExecutionEnvelopeSchema`, `EntryIntent`, `EntryOrder`, `Position`, `TakeProfitOrder`. `Side` is BUY/SELL, which is why the claim key above cannot be read as a position side.
- `packages/contracts/src/ai.ts:3-22` — `EntryDispositionSchema`, `ProfitTakePlanSchema`, `EntryDecisionV` with `quantityUnits`, `horizonMinutes` and `profitTake`; the model-facing shape that must not gain a key or a self-issued authorization (I08).
- `packages/contracts/src/settings.ts:28-29` — zod bounds for `takeProfit` and `positionManagement`, including `humanHandoffAfterMinutes` (default 1440) and `minNetProfitRoiPct` (nonnegative, max 100, default .15).
- `apps/engine/src/config/settingsStore.ts:142-147` — the store opens `zdj-settings.sqlite` under a `dataDir` after `mkdir`; `:76` normalises `minNetProfitRoiPct` to .15. Any test that reaches this file needs a temporary `dataDir`; the verifier now measures that instead of assuming it.
- `apps/engine/src/state/runtimeState.ts:86` — `humanManagedAt` is the only ownership-adjacent timestamp in state today; there is no `ownerState`, `ownerVersion` or `planRef` field, which is the S02 gap in one line.
- `apps/engine/src/services/executionLifecycle.ts:4-7` — `activeOrderStatus` includes `UNKNOWN`, and `terminalOrderStatus` is the only positive terminal set; this is the existing fact that I02 and I05 must extend rather than replace.

Common boundary: `apps/engine/src/runtime/appRuntime.ts` constructs the adapters and hooks event persistence. The source has durable claims and event guards, but S00 does not infer that they satisfy the new V396 ownership contract. S01-S04 must prove CAS, shared quantity claims, recovery and exact event topology.

Static red flags requiring later review:

- `scripts/start-zdj-lan.ps1` intentionally points at the worktree `data` directory and port 8080; it is a manual lifecycle script, not an isolated test entrypoint.
- `scripts/dev.mjs` launches `tsx watch` and is prohibited against live data; it is excluded from the S00 verification command.
- `apps/engine/src/main.ts` defaults `ZDJ_DATA_DIR` to `data` and `ZDJ_PORT` to 8080; isolated tests must set both explicitly and use mock adapters.

The line references above are evidence of current source topology, not proof that the V396 contract is already implemented. The isolated static check additionally asserts the three pre-write event markers, the permission gates, and that `MockExchangeAdapter.ts` contains no network-shaped call.

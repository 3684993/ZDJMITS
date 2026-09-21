# S00 write-path inventory

Scope: static source inspection at `d3f6d262f3bcc05dbd3d9b793f8a3f41da7e5fee`; no Engine process or live database was opened.

| Path | Entry / owner | Existing permission and lock evidence | Persistence / journal evidence | Adapter / boundary | S00 status |
|---|---|---|---|---|---|
| Entry | `apps/engine/src/services/entryCoordinator.ts:220,227`; `appRuntime.ts:241,330-335` wires it | Runtime control, EIP/preflight, entry execution claim, execution mode and environment gates; `entryCoordinator.ts:170,362,369` rechecks permission | `ENTRY_SUBMIT_ATTEMPTED` before `placeEntry`; journal save at `entryCoordinator.ts:227`; runtime save hooks at `appRuntime.ts:333` | `ExternalTradeAdapter.placeEntry` at `ExternalTradeAdapter.ts:26`; mock at `MockExchangeAdapter.ts:6`; `createTestAdapters.ts` is the isolated factory | Existing path inventoried; V396 ownership/plan integration is proposed only |
| TP | `apps/engine/src/services/tpGuardian.ts:89`; periodic sweep in `appRuntime.ts:551` | Existing TP guard/economics and exchange adapter gates; must remain available when new entry is blocked | `TP_SUBMISSION_PREPARED` before `placeTakeProfit`; runtime persistence hook at `appRuntime.ts:330-335` | `ExternalTradeAdapter.placeTakeProfit` at `ExternalTradeAdapter.ts:41`; mock at `MockExchangeAdapter.ts:10` | Existing maintenance path retained; no V396 write change |
| Human exit | `apps/engine/src/services/manualPositionService.ts:83,98,113`; `appRuntime.ts:259,266` wires it | Manual exit goals, manual claim and environment/execution gates | `MANUAL_SUBMISSION_PREPARED` before adapter call; manual save at `appRuntime.ts:339` | `ExternalTradeAdapter.placeManualOrder` at `ExternalTradeAdapter.ts:42`; mock at `MockExchangeAdapter.ts:11` | Existing path inventoried; V396 shared ownership budget is not implemented in S00 |

Common boundary: `apps/engine/src/runtime/appRuntime.ts` constructs the adapters and hooks event persistence. The source has durable claims and event guards, but S00 does not infer that they satisfy the new V396 ownership contract. S01–S04 must prove CAS, shared quantity claims, recovery and exact event topology.

Static red flags requiring later review:

- `scripts/start-zdj-lan.ps1` intentionally points at the worktree `data` directory and port 8080; it is a manual lifecycle script, not an isolated test entrypoint.
- `scripts/dev.mjs` launches `tsx watch` and is prohibited against live data; it is excluded from the S00 verification command.
- `apps/engine/src/main.ts` defaults `ZDJ_DATA_DIR` to `data` and `ZDJ_PORT` to 8080; isolated tests must set both explicitly and use mock adapters.

The line references above are evidence of current source topology, not proof that the V396 contract is already implemented. The isolated static check additionally asserts the three pre-write event markers, the permission gates, and that `MockExchangeAdapter.ts` contains no network-shaped call.

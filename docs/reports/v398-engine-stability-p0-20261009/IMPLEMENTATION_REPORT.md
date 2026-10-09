# V3.9.8 Engine P0 offline diagnostics implementation

**Status:** `DIAGNOSTICS_READY_NOT_DEPLOYED`; `RUNTIME_ACCEPTANCE_PENDING`. This work improves future evidence capture and classification. It does **not** identify or repair the native trigger behind PID 8524's fail-fast exit.

## Changes

- Added `scripts/engine-crash-diagnostics.psm1` with bounded JSONL parsing, exact Windows exit-code formatting, PID-aware crash/normal/unknown/live-HTTP classification, resource-pressure projection, and safe output-root checks.
- Added `scripts/collect-zdj-engine-crash-evidence.ps1`, a Windows-only, explicit-identity, bounded collector. It reads only selected local logs and bounded Application/System event windows; writes raw matching event text only to a fresh directory under `%LOCALAPPDATA%`; emits a public-safe `summary.json` and local manifest. It does not call Engine HTTP, SQLite, exchange, registry, WER configuration, or process lifecycle operations.
- Added `scripts/collect-zdj-engine-crash-evidence.test.ps1` (25 deterministic assertions) and wired it into `verify:scripts`.
- Regenerated both tracked S00 entrypoint review snapshots through the repository generator after the inventory changed from 181 to 184. Existing S00 rules and forbidden classifications were not relaxed.

No `apps/engine` trading, scheduler, Settings, SQLite, worker, or V8/Node configuration was changed. No Engine or exchange action was taken.

## Verification

- Targeted collector fixture suite: PASS, 25 assertions.
- Synthetic end-to-end collector run: PASS. Synthetic launcher receipt classified `PROCESS_EXIT_CRASH` with `0xC0000409`; bounded Windows event queries returned four Event ID 2004 records. A fake PID was used; the live Engine, its database and network interfaces were not accessed.
- `npm run verify`: PASS, exit code 0. This includes dependency builds, script and release checks, S00, typecheck, workspace builds, and **210 test files / 1,899 tests passed**. The command's complete output is preserved locally; a sanitized summary and SHA-256 are in `evidence/R2_OFFLINE_VERIFICATION.json`.
- `git diff --check`: PASS (only Git's CRLF normalization notices for regenerated JSON were emitted).
- Initial full-verification attempts are retained locally. One was blocked by absent `node_modules`; after lockfile-based `npm ci`, another exposed a missing PowerShell hash cmdlet assumption. The helper now uses .NET SHA-256. The next run found stale S00 review counts; both canonical snapshots were regenerated and the final full run passed.

## Runtime status and residual evidence gap

PID 8524's recorded exit remains `0xC0000409`, but its fail-fast subcode, faulting module, stack, and trigger remain `UNKNOWN`. The four system low-virtual-memory events are system-level evidence only; PID 8524 is not listed among their top processes, so causation remains `UNKNOWN`. This diagnostics-only change cannot be represented as a crash fix or stability acceptance.

No deployment, Engine start/stop/restart, watchdog change, WER configuration, or long observation window occurred. A future foreground capture, any WER/dump configuration, verified build deployment/start, and continuous runtime acceptance require separate authorization. Stability remains unaccepted until a user-approved continuous observation window with the specified process, API, event-loop, scheduler, private/market, TP/order identity, SQLite, worker, and resource telemetry is completed.

## Evidence

See [`evidence/R2_OFFLINE_VERIFICATION.json`](evidence/R2_OFFLINE_VERIFICATION.json) for the final command result, test counts, local log locator/hash, synthetic fixture summary, and explicit no-runtime-action boundary. Full logs and raw incident data remain outside the repository under the machine-local incident evidence directory.

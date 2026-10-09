# Reboot orchestration follow-up — 2026-10-09

**Status:** `DIAGNOSTICS_READY_NOT_DEPLOYED`; `RUNTIME_ACCEPTANCE_PENDING`. PID 8524's fail-fast exit is proven, but its triggering component remains `UNKNOWN`; this follow-up does not claim a crash fix or stability acceptance.

## Change

Added `scripts/start-zdj-stack-after-reboot.ps1` for sequential startup after user logon. It starts the three configured local model launchers once with their watchdog switches disabled, validates model API aliases and process ownership, then checks and starts the exact `D:\MITS\scripts\vpn\zdj-trade-proxy-client-windows.ps1` listener on port 20091. Only after proxy readiness does it run a bounded read-only TESTNET current-position protection gate. It can launch the built Engine host exactly once only if that gate passes and port 8080 is empty. It does not restart failed components, kill foreign port owners, alter orders, or change V8 parameters.

`-RegisterAtLogon` installs a separate current-user AtLogOn task, delayed 30 seconds, with multiple-instance suppression and no failure restart action. It does not alter the legacy production-path task. Registration is an explicit switch so the task action can be reviewed before being installed.

The local-only gate helper requires TESTNET and the configured 127.0.0.1:20091 proxy, then performs no more than five signed/public Binance demo GET requests for position mode, positions, ordinary open orders, and conditional algorithm orders. Private JSON output is directed to the caller-specified local diagnostics directory and must not be committed. The gate requires explicit same-symbol and same-position-side TAKE_PROFIT identity for every nonzero position; an arbitrary reduce-only LIMIT order is not accepted as TP proof.

## Current observation

The proxy passed its five-stage local SOCKS/TLS/demo-public-time health probe at 2026-10-09 03:29:45 UTC / 11:29:45 Asia/Shanghai. Model API aliases on ports 8081/8083/8084 matched the configured models. Port 8080 had no listener at that observation. A fresh read-only TESTNET protection check returned `BLOCKED`: nonzero positions were present, while the observed open orders did not establish explicit TP identity coverage and the conditional-algorithm endpoint returned no TP orders. The full private response remains in the local diagnostics directory, not this repository. The Engine was not started.

No order or position was changed. No Engine, model, or proxy restart was performed during this follow-up. The models and proxy that were started after the approved reboot recovery remain available. Current account protection is a hard stop for Engine startup; resolving it requires a separately scoped account/order action and must not be done by the boot script.

## Verification

- `npm ci`: PASS from the committed lockfile.
- `npm run verify`: PASS, exit 0; 210 test files and 1,899 tests passed, with S00 entrypoint count regenerated from 184 to 187 for the three added files.
- `scripts/start-zdj-stack-after-reboot.test.ps1`: PASS; PowerShell parser, ordering, fail-closed, TESTNET and no-retry static contracts.
- Current account gate: `BLOCKED` with `exchangeWrites=0`; this is intentionally not a test pass for live trading readiness.
- No GitHub Actions result is claimed. No deployment or unattended Engine start has occurred.

The launch task is a convenience for starting dependencies and enforcing the same current account gate after logon. It is not a watchdog and cannot turn `UNKNOWN` protection into permission to trade. Continuous live-runtime acceptance still requires a separate authorization and a user-approved observation window.

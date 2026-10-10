# Field baseline, 2026-10-10 (Asia/Shanghai)

Actual fetch: origin/main `0962181c43eb09e007d4b5695193e62dfce92447`; D:/MITS local main `ef00780`, porcelain empty. Existing working tree/data/settings were preserved. Code work uses a separate worktree and branch `codex/v398-network-recovery-field-20261010`.

## Current observations

- Engine 8080: no listener; process scan found no project Engine. No lifecycle signal issued.
- SOCKS 20091: ssh.exe PID12212, created 2026-10-10 21:17:16+08. Same configured Windows SSH -> Ubuntu 22091 -> Binance Demo route. One native curl public/time: HTTP200, 3.096189s. This is instantaneous public connectivity, not private readiness or sustained stability.
- Scout 8081: PID25912, health ok, model qwen3.5:9b, context32768. Real bounded completion returned OK, 2 tokens, 290ms.
- Review 8083: PID22880, health ok, model qwen/qwen3.8-27b, context65536. Real bounded completion returned OK, 2 tokens, 254ms.
- Primary 8084: PID16772, health ok, model qwen/qwen3.8-27b, context65536. Real bounded completion returned OK, 2 tokens, 422ms.
- GPU physical identity: verification pending; internal Vulkan0 command line alone is insufficient because original launchers isolate visible devices.
- Current private account, positions, orders and signed TP: UNKNOWN. No exchange write by this task.

## GitHub refreshed

- PR42 open/draft/mergeable, HEAD c9cd14c572851dda581cc84d66a3ddbfd4d0ed9d; exact-head PR Actions38057726621 completed/success.
- PR41 open/mergeable=false, HEAD f1f5d9c7863d6be3f6aef1a451a4cb90a556ea1d; exact-head PR Actions38055343428 completed/success. Rebased/merged HEAD requires fresh CI.
- PR43 open/mergeable, documentation only, HEAD889c19df16555c59e177077787306e7eda9c29c3.
- Connector commit-workflow query is limited to PR-triggered runs; empty result for main does not establish main CI success.

## First implementation

PR42 review confirms subscription commands are marked subscribed before ACK, ACKs are ignored, and extraordinary cohorts can exceed 1024 streams. A reconnect also clears the in-flight REST recovery set while earlier requests remain active. Implement acknowledged bounded subscriptions, complete cohort coverage across bounded connections and bounded recovery, then run focused/full verification and exact-head CI. Code completion is not deployment.

Historical Engine ON/OFF payload and Send-Q contrast is strong evidence of load correlation. It is not proof of a sole cause. Decoded WS payload is not SSH wire bandwidth. No 30+90 minute window has started.

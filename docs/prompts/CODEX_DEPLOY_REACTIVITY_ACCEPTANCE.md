# Codex — Deploy and Accept Engine Reactivity Fix

Current authoritative main: `ce46b71cf45b2a16eef2c83fb91242619e71a65a`.

This task is **deployment + runtime acceptance only**. Do not redo the previous SSH/SOCKS investigation, do not re-audit the whole repository, and do not return to Trading Quality micro-tuning unless fresh post-deploy profile evidence proves it is again dominant.

## Facts already established

The checkpoint reactivity fix is already merged into main and locally verified.

Local verification evidence:
- targeted RuntimeState + SettingsStore: 44/44 PASS;
- contracts: 2/2 PASS;
- core: 59/59 PASS;
- dashboard: 123/123 PASS;
- engine: 200 files / 1821 tests PASS;
- typecheck/build/release identity/S00 all PASS.

Evidence file:
`docs/reports/v397-ssh-socks-remediation-20261008/reactivity-core-checkpoint-local-verify-20261008.log`

Pre-fix runtime baseline:
- `persistRuntime` inclusive CPU: ~43.28%;
- Trading Quality synchronous capture: ~10.74%;
- maximum event-loop delay: ~6.14s;
- host available commit memory during that sample: ~4.37GB.

## Required execution

1. Pull latest `main` in `D:\MITS` and confirm exact source/build identity.
2. Do not rerun the full repository verify unless source identity unexpectedly differs from `ce46b71cf45b2a16eef2c83fb91242619e71a65a`; the candidate has already passed local full verification.
3. Build/load the latest verified main as required by the existing safe launcher.
4. Restart **8080 only** for this Engine code deployment.
5. Leave SSH/SOCKS unchanged unless the new runtime produces direct fresh evidence of a tunnel failure.
6. Leave 8081/8083/8084 unchanged.
7. Do not modify Settings, Entry/TP/strategy parameters, freshness TTLs, leverage, quote-asset routing or Production permissions.
8. Preserve SQLite, WAL, TradeRecord, historical UNKNOWN and all durable trading identity.

## Fresh runtime acceptance window

Use a fresh **5–10 minute** post-READY window. Do not mix startup samples or pre-deploy samples into acceptance.

Capture at minimum:
- exact Engine PID, host PID, instanceId, source/build/artifact identity;
- private account status, snapshot age and consecutive failure count;
- required market fact freshness;
- REST queue timeout counts split into PRIVATE / EXECUTION / REQUIRED_MARKET / BACKGROUND;
- active request/queue depth if exposed;
- event-loop delay max and p95;
- one bounded CPU profile;
- inclusive CPU attribution for `persistRuntime`;
- inclusive CPU attribution for Trading Quality;
- RSS/heap and host available commit memory;
- TP coverage/protection state;
- active operational incidents;
- TESTNET identity and Production writes=0.

## Acceptance logic

PASS only if the fresh window shows:
- `persistRuntime` CPU materially lower than the ~43.28% baseline;
- no recurring multi-second event-loop stall attributable to the generic runtime checkpoint;
- PRIVATE / EXECUTION / REQUIRED_MARKET lanes do not show repeated queue timeout;
- private account remains READY/fresh;
- required market facts remain fresh;
- TP remains correctly protected/reconciled;
- Production writes remain 0.

BACKGROUND/AUDIT timeouts may be reported separately and do not fail the critical-lane acceptance by themselves.

## If acceptance fails

Do **not** wait another 15 minutes just to collect more of the same failure.

Take one fresh post-deploy profile and classify the dominant remaining synchronous path.

If the generic checkpoint cost has materially fallen but another persistence path is now dominant, perform exactly one second structural remediation focused on that measured path (for example remaining synchronous full checkpoint/reservation persistence), run targeted tests plus one full verify, deploy once, and repeat the 5–10 minute acceptance.

Do not return to broad audit or per-warning patching.

## Output handling

All long command output must be redirected/teed to log files. Do not ask the user to copy console output.

Commit all acceptance logs, profiles, summaries and any second-iteration evidence to GitHub under:
`docs/reports/v397-ssh-socks-remediation-20261008/`

Update:
`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`

Final report must state:
- deployed commit;
- exact before/after reactivity metrics;
- critical lane result;
- private/market freshness result;
- TP result;
- Production writes result;
- whether a second structural iteration was required.

Do not declare success merely because 8080 starts.

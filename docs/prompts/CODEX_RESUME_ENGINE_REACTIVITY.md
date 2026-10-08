# Resume Engine Reactivity Remediation

Read `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` first.

Do not redo the SSH/SOCKS investigation or the earlier Trading Quality micro-tuning. The latest active profile
already moved the dominant hotspot to full runtime checkpoint persistence.

Use candidate branch `chatgpt/reactivity-core-checkpoint-20261008` at
`54cc468960a3ca0eee221915c277427f60de237e`.

Your first task is verification, not redesign:

1. Diff the candidate against current main and ensure main has not gained conflicting runtime persistence changes.
2. Run:
   - `npm --workspace @zdj/engine test -- src/state/runtimeState.test.ts src/config/settingsStore.test.ts`
   - `npm run verify`
3. If green, integrate safely into latest main; no force/rebase over unrelated work.
4. Build and restart only Engine/Dashboard 8080 for this code candidate. Leave SSH/SOCKS and 8081/8083/8084 alone unless new direct evidence requires otherwise.
5. Start a fresh 5–10 minute window and capture:
   - CPU profile;
   - event-loop max/p95 delay;
   - `persistRuntime` and Trading Quality inclusive CPU;
   - REST lane queue timeouts split PRIVATE / EXECUTION / REQUIRED_MARKET / BACKGROUND;
   - private snapshot freshness and required market freshness;
   - host commit memory separately.
6. Compare numerically with the pre-candidate baseline (~43.28% persistRuntime, ~10.74% TQ, max event-loop ~6.14s).
7. If generic checkpoint cost materially falls but a different synchronous persistence path becomes dominant, do exactly one second structural iteration against that measured path. Do not return to per-warning patching.
8. Store every verification log/profile/report in GitHub and update the handoff.

Hard boundaries remain: TESTNET only, Production writes 0, no DB/history reset, no weakening private/market freshness,
no duplicate submit on UNKNOWN, no strategy/TP/Entry parameter tuning during this reactivity task.

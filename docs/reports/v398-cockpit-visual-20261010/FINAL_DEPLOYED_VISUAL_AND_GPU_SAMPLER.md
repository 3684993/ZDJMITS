# v3.9.8 professional finance cockpit and continuous GPU sampler

Execution in isolated worktree `D:/MITS-WORKTREES/v398-pro-cockpit-gpu-20261010`, branch `codex/v398-pro-cockpit-gpu-20261010`. Baseline deployed PR39 source `2c9fec513bd5ba0406015c33b2c7cf9ce420ebaf`; merged PR39 evidence `bbcda235ca1c4c5da07466714e9f015ba5bc6a9b` and main `6fb417d2d72f8643ea565f9278322eac3fd87597`. Selective PR37 frontend integration preserves PR39 model lifecycle authorization, identity and idempotence fixes. No blanket PR37 merge or model restart.

## Implemented source

- Absolute `ZDJ_GPU_SNAPSHOT_PATH`, no cwd fallback; <=64KiB/schema/instance/asOf validation, 10s read coalescing and 45s expiration with null live values. Collector explicit operational `-OutputDirectory`, atomic snapshots and <=361 retained samples, 15s independent OS collection, process-start/executable/port identity checks, busiest PID engine utilization (not card-wide percentage), invalid >100 counters UNKNOWN.
- Single global sampler/supervisor mutex, verified PID/start/executable/script ownership, audited exit, bounded three-exit restart budget with 30s/60s backoff, operator graceful stop flags. Hidden WScript task under SYSTEM at startup; no model, proxy or trading lifecycle capability.
- First-screen SVG native balance structures and exchange income waterfall are immediate. ECharts historical lines only after >=2 real page samples; no fabricated seven-day history. Wallet delta, exchange income and local cycle economics remain separate. Native USDT/USDC thresholds <500 red, [500,1000) amber, >=1000 green; absent/stale/duplicate/unverified/future/nonfinite facts gray/null. BTC preserved in collapsed raw assets, excluded from stablecoin KPIs. No `wallet-available` margin inference.
- Shared passive snapshot refresh coalesces WebSocket storms and periodic reads to 15s; explicit manual refresh remains immediate. Overview account/pipeline poll reduced 3s ->15s, read abort/deadline/unmount guards. No additional exchange REST income queries.

## Evidence status at source freeze

Three-model services remain Scout25912 / Review22880 / Primary16772 and Engine12140. Initial real browser preview (NOT deployed source proof): desktop1440/1920 and mobile390 show immediate finance graphs within viewport, zero page errors, zero NaN/Infinity and no horizontal overflow. It revealed 22–33 snapshot requests in about18s from prior realtime invalidations; the shared limiter addresses this. Exact deployed screenshots, CI, final continuous20min evidence and release gates will be appended after verification. Existing old24h ABORTED; new24h NOT_STARTED, T0=null, awaiting later user instruction.

## Release boundary

One necessary Engine-only release is authorized by the current prompt, conditional on exact source CI, fresh signed all-position TP and order/cycle identities, private age<=30s, TESTNET, Production writes/blocked attempts0, unchanged model/proxy PIDs, consistent backup and rollback, isolated graceful SIGINT proof. No forced restart on a failed gate. No TP edits, averaging/additions, Primary delegation or new24h acceptance.

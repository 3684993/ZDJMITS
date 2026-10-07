# Active Engine reactivity correction, 2026-10-08

SSH scripts and detached tunnel were published in c6090bd. This stage repairs the
real Engine path; it does not treat tunnel success or local tests as runtime acceptance.
The separate 07:23:11–07:34:11 window lasted 11.0045 minutes (23 samples) and is
NOT_HEALTHY: 11 missing health/closeout observations, 12 observed private READY
values, 11 private observation gaps, route queueTimeout delta 221, private age maximum
54,035 ms. Production writes 0 in 12 known samples, UNKNOWN in 11 gaps. No natural
TP terminal recovery event was observed. Its lossless samples/events/summary are
`ssh-repaired-engine-blocked-*`; neither older overnight windows nor the next build
are mixed into it. Analyzer's generic REQUIRES_EVIDENCE_REVIEW is not a PASS.

## Proven blocking paths

Live CPU profile of PID33460 contains 28,646 samples. Inclusive stack evidence puts
32.65% under maintainStorageBounds, including 30.93% under its trim function. This
function previously ran synchronously from storageEntryBlockReason, reached by
pipeline/HTTP queries and Entry admission. HTTP telemetry records event-loop delay
maximum 20,820.525 ms. Independent tunnel guardian health checks continued to pass.
These establish an Engine scheduling defect; they do not prove every individual
SOCKS/TLS error came from it or prove remote exchange service health at every instant.

Additional sampled hot paths are synchronous checkpoint serialization/row existence
reads and TradingQualityCollector.put/captureState. Indexed, two-second-deadline
census shows 5,000 retained runtime fills, 2,420 orders, 2,453 intents, 707 trades,
200 AI runs, and 536,044 durable TQ events. The earlier payload-size GROUP BY census
was explicitly aborted; no count/result from that aborted scan is claimed. Its I/O
could affect overlapping observations. Current DB sizes (~18.6GB evidence, ~1.09GB
settings) are preserved, not reset or vacuumed as a repair.

## Corrections and preserved authority

- Capacity admission now performs the same byte checks without running retention.
  A single coalesced, unreferenced worker performs scheduled maintenance, with a
  30-second deadline and explicit retry outcome in capacity health. Scans precede
  short deletes, bounded COUNT stops at cap+250; deletion rechecks its eligibility.
  Checkpoint-referenced entity deletion still uses BEGIN IMMEDIATE so a simultaneous
  checkpoint cannot lose newly referenced recovery rows. All row/byte caps are unchanged.
- Checkpoints read the covering entity key index once inside their savepoint instead
  of a separate existence call for every retained row. Evicted cached entities are
  still repaired; revision, atomic rollback, and submission fences remain synchronous.
- TQ reuses prepared statements and caches compact SHA256 fingerprints. Unique
  session-qualified events no longer evict retained entity fingerprints. Overflow
  evicts one oldest entry rather than clearing all 30,000 entries. Exact synchronous
  event capture, mutable fill snapshots, mandates, and evidence-failure behavior remain.
  This does not assume current retained state itself exceeds 30,000 entries; the
  reproduced regression is an event burst displacing those retained entries.

Targeted verification: 68 tests passed before worker refinement. Final full local
verify and the independent post-cutover feedback will be recorded below. No Actions,
strategy parameters, TTL widening, Settings/credential writes, synthetic trades,
model-service lifecycle changes, or Production writes are authorized by this correction.
Dirty D:\MITS remains preserved. Cutover/acceptance is PENDING; tests are not runtime proof.

CPU profile is losslessly compressed, with raw/compressed SHA256 receipts. Settings,
credentials, model processes, and the tunnel are compared to actual before/after facts.
The old codex.exe C0000409 WER/Engine-exit correlation does not prove a node.exe native
fault or identify its Job object. IsProcessInJob proves membership only; WMI parentage
alone does not prove Engine child exclusion from every Windows Job.

## Full local verification

npm run verify exited 0 in the isolated offline worktree: 233 files / 1,985 tests
(Engine 1,802; dashboard 123; core 58; contracts 2), typecheck/build/scripts/release/S00
PASS. VITEST_MAX/MIN_THREADS and FORKS were set to 1 for this invocation only because
Windows available commit headroom was ~1.3GB while the three model services stayed
loaded. Test coverage was not reduced. See full-verify-reactivity.log. No Actions.

The supplemental path summary measures checkpoint inclusive 14.58%, captureState
14.15%, materialize 0.65% of the pre-fix profile. These fractions overlap call stacks
and are not wall-clock attribution or proof of a particular network timeout cause.

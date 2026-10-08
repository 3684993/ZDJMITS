# Third active correction: retained TradeRecord write amplification

## Evidence and failed preceding window

Source 5a156fd was loaded as PID10988, instance d0e5cc7a-b745-401e-ac64-9f1be7cac80c.
Loaded identity closed 6/6, private reached READY and TP was observed READY13/13.
Its independent post-write-amplification window nevertheless failed: actual first/last
2026-10-08 08:06:52.424765–08:22:00.370364 +08, 15.132433 minutes, 31 samples.
Private READY30 / OBSERVATION_UNAVAILABLE1; no observed explicit UNAVAILABLE.
Queue incidents appeared in 6 samples, MARKET-DATA-001 in 1, TP observation was missing
in 1. Account age max34,398ms/p95 15,483ms. Aggregate queueTimeout delta159.
Production writes0 in 30 known samples; the missing sample is UNKNOWN, not zero.
These are separate counters/prevalences, not 159 distinct NET-002 incidents.
Audited summary, lossless gzip and selected retained-instance events are under
post-write-amplification/trade-write-amplification-not-healthy-*.

A bounded 20-second main-thread CPU profile contains12,802 samples. Inclusive
upsertTradeRecord4,226 (33.01%), captureState2,710 (21.17%), persistRuntime2,472
(19.31%), saveEntryExecution491 (3.84%), background capture10 (0.078%). These
overlap; percentages are CPU sample attribution, not measured wall-clock time.
The preceding journal correction substantially reduced its CPU path and bounded
background scanning, but did not establish runtime acceptance.

Current retained TradeRecords707. TRADE_RECORD_OPENED/CLOSED/REPAIRED classifies
all records to preserve cross-record duplicate/conservation facts, then unconditionally
upserts all rows and again upserts the named record. SQLite UPDATE always rewrites
payload and updated_at, even when unchanged. The profile records4,150 native run
samples directly below upsertTradeRecord. This is a confirmed amplification defect.
Classification semantics themselves are preserved.

## Correction

The upsert atomically compares durable status/symbol/payload in SQLite. An identical
record does not execute UPDATE or refresh its durable timestamp. Changed facts remain
synchronous; deleted/externally changed rows are repaired from actual current input.
There is no JS-only cache that could falsely suppress recovery writes. All integrity
classification, experience-sample invalidation, risk/trading facts and audit events
continue to run. No history deletion or manufactured fills.

TRADING_QUALITY_OPPORTUNITY and TRADING_QUALITY_PRIMARY_LINK each already synchronously
save their full explicit proof plus the event. Their producers do not mutate execution
ledgers. Only these two proof events cease redundantly capturing all trading history.
Entry/TradeRecord/reconciliation events retain synchronous full-state capture before
maps advance/trim; background history still scans256 current rows/tick and exposes
pending coverage. This does not change ENFORCE proof persistence/failure behavior.

Regression verification checks100 identical upserts cause zero UPDATE triggers,
retains durable timestamp123, persists an actual status/quantity change, restores an
evicted row, and survives reopen. Opportunity/Primary payloads and events survive
reopen without scanning fills, while ENTRY_SUBMIT_ATTEMPTED still captures exact fills
synchronously. Full local verify status and runtime feedback are recorded below.

## Separate host-memory evidence

At08:15 Windows commit125.918GB /126.678GB, headroom0.760GB; kernel paged pool24.580GB,
nonpaged8.793GB; process private sum84.917GB. Free physical memory does not establish
commit availability. A standalone identity CLI explicitly failed with native exit134,
"Committing semi space failed" / "Allocation failed - JavaScript heap out of memory".
The complete original stderr was returned by the tool, not saved as a file; this is
an operator receipt, not a reconstructed raw crash log. A CLI-only bounded heap retry
subsequently closed identity6/6. Engine V8 configuration was not changed.

Kernel pool bytes prove a large allocation, not its driver owner or a leak. Root cause
of that allocation remains UNKNOWN. Earlier nativeC0000409/C00000FD incidents are
separate and remain UNKNOWN; do not attribute them to this explicit memory failure.
After the proven-unhealthy Engine was identity-guarded stopped for this correction,
08:25 commit headroom6.958GB; tunnel remained healthy. No model/OS/pagefile changes.

System-managed D:\\pagefile.sys22,581MB matches approximately the volume/8 cap documented
by [Microsoft page-file guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows).
The relationship is an inference from disk/pagefile readback. Microsoft's
[system commit explanation](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/introduction-to-the-page-file)
supports the commit-limit distinction. Global OS tuning/restart is outside the applied
SSH/Engine correction; none was performed. Exact resource/commit readbacks retained.

## Boundaries and pending runtime verification

PID10988 was explicitly identity-guarded stopped for this confirmed correction,
not recorded as a spontaneous crash. SSH29068/guardian11852 and models8081/12732,
8083/17468,8084/51124 retained. Settings247/resources unchanged, TESTNET-only.
F04/F10/F11 remain paused. Full verification and next independent10–30-minute window
must precede any healthy claim. No6/12h gate, no Actions, no strategy/TTL relaxation.
No natural lost-ACK TP terminal recovery event in the preceding window: UNKNOWN.

## Offline verification and next instance

Full npm run verify exited0:233 files/1,989 tests (Engine1,806/dashboard123/core58/
contracts2), scripts/release/S00/typecheck/build PASS. Full log
trade-record-full-verify.log; offline worktree had no live data junction. No Actions.
Necessary 8080 cutover and new independent feedback remain PENDING at this commit.

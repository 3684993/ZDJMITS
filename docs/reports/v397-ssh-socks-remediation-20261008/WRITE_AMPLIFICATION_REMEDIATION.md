# Active follow-through: journal amplification and background evidence scanning

The 4559d07 build was manually started as PID5424/instance
fbce3561-26fd-4fe4-9b1a-e4c8285401cd. Boot took 68.99 seconds; a pre-listen probe's
ECONNREFUSED did not mean this process died. Identity subsequently closed 6/6.
Startup observations remain separate under post-reactivity. Its background collector
was stopped by proven PID/path ownership to begin the independent post-READY window.

## Runtime verdict for the first correction: NOT_HEALTHY

post-ready's actual 10.06775-minute window contains 21 samples: 18 known private READY,
3 missing closeout/health values, queue incident in 10 samples. Some samples contain
temporary missing/unverified TP protection; these are not silently excluded as normal.
HTTP telemetry already showed main-thread max 9.437s after boot, and a later metrics
GET itself exceeded 8 seconds. Bid/ask/last/mark and latest closed bars remained
unhealthy. This is a failed feedback window despite private recovery and 6/6 identity.
Lossless samples, selected retained-instance events, summary, phase snapshots and
profile are kept under post-ready; it is not combined with any other build/window.

The second profile (28,823 samples, 45-second bounded sample) puts saveEntryExecution
at 30.48%, captureState at 25.97%, persistRuntime at 18.94%, and maintenance at 0.0035%
inclusive. These overlap and are sample attribution, not wall-clock durations. They
prove retention left the main thread, and locate the next blocking paths. Representative
indexed payload samples are small (fills 732 bytes, intents ~1.7–2.1KB); no full 18GB
payload scan was repeated.

## Corrections under verification

TTL close/reprice events name their exact orderId. Their consumer now saves that order,
with conservative full-loop fallback when the event has no identity. Reconciliation
still visits all journals. Entry/manual UPDATEs compare actual durable payload and
active bit before writing. Entry proof validity is re-evaluated on every call; expiry
reactivates UNKNOWN even if the payload bytes have not changed. released_at remains a
historical marker, not a freshness grant; unchanged facts no longer bump that marker.
Changed payloads/proofs/occupancy continue to be saved synchronously.

TQ periodic history scanning processes 256 current records per tick. It resolves each
key against the current map/fill array, so a replaced object cannot overwrite a newer
event's evidence. Scope changes reset the scan. Pending row count/completion time are
reported; background history coverage is incomplete while pending, not declared zero
loss. Domain-event full capture, exact fills, Entry mandates and primary links stay
synchronous before maps advance/trim. No trading quote/account/proof TTL or economic
policy is changed. This bounds observer work rather than relaxing trading readiness.

Targeted 77 tests passed, including proof-expiry reactivation and replacement-safe
background scanning. One initial test fixture used a lowercase tombstone for an
uppercase canonical identity and correctly failed; fixture was corrected, production
validation was not weakened. The first full verify was interrupted with native exit
0xC00000FD during typecheck, with only '#' at the end of its log and ~1.1GB available
Windows commit. Cause is UNKNOWN; do not call it a demonstrated memory or code defect.
Its complete log is full-verify-native-interrupted.log. Full verify is being rerun.

The still-unhealthy PID5424 was explicitly stopped through the identity-guarded 8080
script before that rerun. This is authorized maintenance, not an unexplained crash.
Model ports/processes 8081/12732, 8083/17468, 8084/51124 and SSH29068/guardian11852
remain intact. Settings247/resources/credentials and dirty D:\MITS remain preserved.
Next cutover and independent 10–30-minute feedback are PENDING. F04/F10/F11 stay paused.

Earlier PID33460's spontaneous C0000409 exit at 07:38:10 remains separate and UNKNOWN
in cause; no matching Application crash record was returned in the queried interval.
Windows Job membership does not identify the Job owner or prove the exit cause.

## Final offline verification

npm run verify rerun exited 0: 233 files / 1,987 tests (Engine 1,804, dashboard123,
core58, contracts2), typecheck/build/scripts/release/S00 PASS. Scope regression also
verifies a TTL event saves only its named order among 200 history rows. No Actions.
The same scoped, offline worktree has no live data junction during all verification.
Full log: full-verify-write-amplification.log. Native-interrupted and invalid-fixture
logs remain retained, not replaced by the PASS. Next runtime acceptance is PENDING.

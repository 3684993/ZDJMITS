# V3.9.6 high-frequency Entry root-cause report

**Assessment time:** 2026-09-28 04:04 UTC (12:04 Asia/Shanghai)

**Canonical checkout:** `D:\MITS`, branch `main`, HEAD `17563b493838a0a24a7b4da0832ead53e2857abb`

**Runtime:** TESTNET, PID `49128`, instance `fec33dd5-fcf8-4c12-ba0e-91555c0332cc`, build `3.9.6-fa229146cdacb70a8b10`
**Assessment status:** `ROOT_CAUSE_CONFIRMED`; implementation and local verification are in progress. The captured runtime facts below precede the code changes. No Engine lifecycle action has occurred yet; this is not runtime acceptance.

## Conclusion

The reported `DISPATCH_STALLED` is a **false scheduler-health diagnosis**. The current process continues to tick and publish heartbeats. Its `analysisDiagnostics()` labels the state stalled because no Primary dispatch has happened since this instance started: when `lastAttemptAt` is null, the code uses `analysisStartedAt` as the comparison timestamp and calls the result `DISPATCH_STALLED` after 30 minutes. The heartbeat and tick timestamps are fresh, so this does not meet the attached definition of a scheduler stall.

The actual reason no new Entry is progressing to Primary is **authoritative risk admission unavailable with zero final Entry capacity**. At the captured runtime read, 13 lower-layer candidates were routable, but the BOOK admission was `UNAVAILABLE`, both side ceilings were `$0`, and four pending orders had `PENDING_RISK_UNVERIFIED`. The first binding record was an UNKNOWN INJUSDT order. This is a real fail-closed blocker pending exchange proof; bypassing it, treating UNKNOWN as zero, or forcing a Primary/order would be unsafe.

The dashboard and runtime diagnostics therefore combine a valid `WAITING_EXECUTION_CAPACITY` work state with an invalid `DISPATCH_STALLED` analysis state. The `lastBlockedReason` is also `NO_RUNNABLE_CANDIDATE`, which conflicts with the current capacity verdict. The no-dispatch branch calculates the specific capacity reason for the AI idle context but does not persist that reason into `analysisFacts`, and the heartbeat event lacks the complete structured suppression record and next evaluation time.

## Evidence and scope

All current evidence was read from the running local API, the instance receipt, process/port state and SQLite opened with `mode=ro` plus `query_only`. No Engine lifecycle action, Settings write, trade write or exchange request was initiated by this assessment. Current closeout reports TESTNET locked, 22 active positions, 22 active TP orders, zero Testnet writes and zero Production writes.

| Area | Current evidence | Finding |
|---|---|---|
| Runtime identity | PID 49128; instance `fec33dd5-fcf8-4c12-ba0e-91555c0332cc`; build `3.9.6-fa229146cdacb70a8b10`; `/health` HTTP 200 | Runtime is alive and identity is readable. |
| Scheduler | 116 heartbeat events in the trailing hour; maximum observed heartbeat gap 33.215 seconds; latest `lastTickAt` was under one second old | Scheduler is progressing; no real stall observed in this window. |
| Misreported state | `scheduler.status=RUNNING`, `analysis.reason=DISPATCH_STALLED`, `analysis.lastAttemptAt=null`, `analysis.lastBlockedReason=NO_RUNNABLE_CANDIDATE`; work state `WAITING_EXECUTION_CAPACITY` | Source-level false positive and inconsistent blocker attribution. |
| Primary activity | `primaryCount30m=0`; last Primary timestamp `1790432520868`, before current instance start `1790551711688` | No Primary has run in the current instance. The displayed age is time since this instance began without a success/attempt, not scheduler silence. |
| Candidate/capacity | `capital.executableCandidateCount=13`; authoritative BOOK status `UNAVAILABLE`; LONG/SHORT final ceilings both `$0`; first binding `PENDING_RISK_UNVERIFIED:order:entry_intent_mu8tvnlc_iqw318av` | Routing/funding capacity is a lower-layer candidate fact, not executable final Entry capacity. |
| Pending risk | Four current pending facts are UNKNOWN: INJUSDT (~$1,727.34), XRPUSDC (~$12.21), TUTUSDT (~$71.20), XRPUSDC (~$36.87). Reconciliation read: 47 historical entry UNKNOWN, 41 verified no-active-risk proofs, 6 currently occupying risk; zero verified order-fact mismatches. | The four live admission blockers remain fail-closed. |
| User-specified UNKNOWN orders | `entry_intent_mu8lwayf_o63la8tg` (ZECUSDT) and `entry_intent_mub08xmz_2m9udmpt` (ETHUSDT) remain `UNKNOWN`. ZEC had a fresh no-active-risk proof at the first direct read; ETH's no-active-risk proof had expired, followed by `PROBE_NOT_APPLICABLE`, so its current risk could not be cleared from that evidence. | Do not delete either row or infer that the UNKNOWN exchange terminal status is resolved. Current first binding later moved to other UNKNOWN orders as risk facts refreshed. |
| Market/AI | `executionReadiness=EXECUTION_READY`, private facts fresh, 13 executable route candidates; no Primary completions or PLACE in the trailing 30 minutes | Readiness here means upstream facts/model spend permission. It does not override BOOK admission. |
| Position protection | 22 positions, 22 active TP orders; Production writes 0 | Existing protection remained intact during the read-only audit. |
| Ownership journal | 698 `V396_OWNERSHIP_JOURNAL_DEGRADED` events in the trailing hour; latest errors say `UNIQUE constraint failed: v396_outbox.id` at stage `EXPIRE`, with `affectsTradingPath=false` and `authorityGranted=false` | Separate recurring persistence defect. It is not the Entry admission cause, but it needs a bounded fix and validation because the ownership outbox is not draining cleanly. |

At the later 12:22 UTC pre-load projection, scheduled reconciliation had changed which UNKNOWN orders occupied risk: the specified ZEC and ETH rows then had fresh five-source `VERIFIED_NO_ACTIVE_RISK` proofs, while APTUSDT, a different ETHUSDT order and TUTUSDT had expired proofs and still appeared in pending lineage. BOOK remained unavailable with both final sides at zero. The same projection showed `MAX_GROSS_NOTIONAL` short by `$306.38` and `HUMAN_POTENTIAL_NOTIONAL` short by `$203.16`. See [pending-risk-analysis.json](pending-risk-analysis.json) and [root-cause.md](root-cause.md) for the timestamped facts and lineage. These snapshots show that reconciliation progresses; they do not permit the system to ignore other live admission gates.

The attached `257 minutes` display is consistent with the in-memory `silenceMs` counter starting at `analysisStartedAt` when this instance has no `lastSuccessAt`; at the captured read it was about 276 minutes. It is not evidence that the scheduler loop was silent for that duration. The current instance has its own observation start; the separate persisted `entryActivity.lastPrimaryRunAt` belongs to an earlier time and must not be presented as current-instance scheduler health.

## Pipeline diagnosis

| Stage | Observed state | Root cause or evidence gap |
|---|---|---|
| Market and candidate supply | 116 universe members, 13 lower-layer executable routes; pool reports zero READY and candidates waiting | Supply exists. The exact candidate-to-pool lifecycle transition still needs a bounded per-candidate read in implementation verification. |
| Scheduler | Ticks and heartbeats continue | Not stalled. Existing classification uses dispatch age instead of tick/heartbeat SLA. |
| Primary | Zero starts/completions in 30 minutes | Correctly suppressed before a useful executable answer can be acted on; current BOOK capacity is unavailable/zero. |
| PLACE/admission | Zero PLACE, zero risk-allowed results in 30 minutes | Four UNKNOWN pending exposures make the authoritative admission snapshot incomplete. |
| Plan/reservation/intent/submit/fill | No new stages in 30 minutes | Downstream absence follows upstream suppression; no evidence supports forcing these stages. |
| Position protection | 22/22 active TP orders | Protected exits remain active. |

The separate 2026-09-27 frequency audit also found that historical risk admissions were dominated by overlapping gross/cluster/human limits and incomplete or pending facts. That is a historical cohort result, not a substitute for today's risk snapshot. This report does not authorize removing a limit or increasing a threshold.

## Proven root causes

1. **False `DISPATCH_STALLED`:** `apps/engine/src/services/entryCoordinator.ts` classifies an instance with `lastAttemptAt=null` as stalled once `now - analysisStartedAt` exceeds 30 minutes, despite a fresh `lastTickAt`. The user-facing time measures Primary success age, not scheduler liveness.
2. **Suppression reason is lost:** when `processPool()` has no ready candidate, it derives `WAITING_EXECUTION_CAPACITY` and an explanatory `nextStep`, but leaves `analysisFacts.lastBlockedReason` as `NO_RUNNABLE_CANDIDATE`. Heartbeat payloads therefore disagree with the authoritative `work.current/work.next` verdict and omit candidate count, capacity status, authoritative blocker and next evaluation.
3. **Real current Entry stop:** risk admission was BOOK `UNAVAILABLE` with zero final side ceilings. The binding pending-risk rows changed as fresh proofs expired or renewed; the later 12:22 UTC snapshot had three unverified lineages and also explicit gross and human-potential notional shortfalls. This is an admission stop, not scheduler failure. It remains subject to the current authoritative reconciliation and limits.
4. **Separate ownership outbox failure:** `OwnershipJournal.save()` and `OwnershipService.enqueue()` generated untyped keys from the same `[scope, cycle, version]` tuple. An owner expiry at version 2 collided with an already queued `PROTECTION_MANDATE_CHANGED` version 2 for that scope and cycle, and rolled back. The event says this does not affect the trading path and grants no authority. The source now includes event type in both ID namespaces.

## What this does not establish

- The current observation window is about one hour of heartbeat evidence, not the required post-fix, continuous 120-minute runtime acceptance window.
- The evidence does not prove why each current unknown order lacks exchange proof, nor whether a later scheduled exact verification will resolve it. The exact orders remain UNKNOWN until the authoritative facts do.
- A healthy scheduler and explicit risk suppression do not imply an order should be created. The final Entry capacity is zero/unavailable at this read.
- This report does not certify all historical candidate denominators, all symbols' route transitions, or economic quality.

## Required outcome

The system must report a live scheduler status separately from Primary dispatch age. Every no-dispatch state must carry a current, structured reason and next evaluation time. If the BOOK remains unavailable, the correct state is `RUNNING · WAITING_EXECUTION_CAPACITY`; the risk gate stays closed while existing reconciliation progresses. The recurring ownership outbox failure must be repaired without changing ownership authority or TP/exchange behavior.

## Implementation and local verification (2026-09-28)

The implementation now separates scheduler liveness from Primary activity, stores structured suppression and next-evaluation facts, labels lower-layer candidate capacity as pre-risk in the dashboard, and namespaces ownership and mandate outbox IDs. It does not grant Entry authority or clear any UNKNOWN order. Details and post-load evidence will be added after the authorized manual load and full monitoring window.

Local checks completed: focused scheduler/ownership tests 32/32, dashboard capacity tests 19/19, pending-risk/reconciliation tests 136/136, and `npm run verify` 176 files / 1,497 tests passing with workspace typecheck and build. `node scripts/v396-s00-static-check.mjs` passed S00 T01–T06 with zero blockers after regenerating the derived 141-entry review. The S08 storage coverage gate and backup self-test passed. `git diff --check` passed with only Git's LF-to-CRLF notices. Hosted CI was not run (`NOT_RUN_BILLING_LIMIT`). Runtime identity and the continuous 120-minute observation remain open.

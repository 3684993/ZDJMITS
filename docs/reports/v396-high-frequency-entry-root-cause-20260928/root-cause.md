# Root-cause chain and stage-by-stage disposition

Captured from the TESTNET runtime by read-only API and SQLite reads on 2026-09-28. Exact status can move as scheduled exchange reconciliation refreshes short-lived proofs; the entry gate must always use the latest authoritative verdict.

## Proven blockers

1. **Scheduler health was conflated with Primary activity.** A new instance with `lastAttemptAt = null` used its start time as the “silence” reference and was marked `DISPATCH_STALLED` after 30 minutes even while ticks continued every 2.5 seconds and heartbeats arrived about every 30 seconds. The dashboard showed that Primary had not run as though the scheduler were silent.
2. **Suppression facts were not carried through.** The no-ready branch generated a wait explanation but did not update `analysisFacts.lastBlockedReason`; the current heartbeat could retain `NO_RUNNABLE_CANDIDATE` while BOOK admission was unavailable. This made a live risk wait look stuck and gave no structured next evaluation.
3. **The live admission gate has genuine blockers.** The 12:22 UTC read showed BOOK `UNAVAILABLE`, both final side ceilings `$0`, with three pending UNKNOWN lineages (APTUSDT, ETHUSDT, TUTUSDT). Their no-active-risk proofs existed but had expired at the moment of this projection, so they remained occupying risk. The same verdict reported `MAX_GROSS_NOTIONAL` used `$11,118.34` against `$10,811.96` (shortfall `$306.38`) and `HUMAN_POTENTIAL_NOTIONAL` used `$11,015.12` against `$10,811.96` (shortfall `$203.16`). Directional, capital-at-risk, stress-loss and margin-buffer rows still showed headroom. These limits are authoritative and are not removed by the implementation.
4. **The two specified older UNKNOWN orders had progressed through normal reconciliation.** At the 12:22 UTC read, `entry_intent_mu8lwayf_o63la8tg` (ZECUSDT) had a fresh `VERIFIED_NO_ACTIVE_RISK` proof with five absence/other-cycle sources, tier 0, one consecutive verification. `entry_intent_mub08xmz_2m9udmpt` (ETHUSDT) had the same five-source proof, tier 1, four consecutive verifications. These proofs clear current occupancy only while valid; their terminal exchange status remains UNKNOWN and the rows must remain durable.
5. **Ownership expiry hit an outbox namespace collision.** The outbox primary key encoded `[scope, cycle, version]` without event type. An expiry owner version 2 collided with a `PROTECTION_MANDATE_CHANGED` version 2 on the same scope/cycle. The UNIQUE error rolled back the expiry transaction on every retry. Event fields stated `affectsTradingPath=false` and `authorityGranted=false`. Namespacing IDs by event type makes the two durable streams distinct without changing CAS or owner authority.

## Stage-by-stage

| Stage | Evidence and disposition |
|---|---|
| Runtime tick / heartbeat | Was live during the audit. New diagnostics use current-instance tick age and a 60-second stall SLA; a fresh tick remains RUNNING even if Primary has never dispatched. |
| Universe / routing | Lower-level candidates existed. The UI now labels these `PRE-RISK / NOT EXECUTABLE`; they cannot be confused with final BOOK capacity. |
| Primary | Correctly suppressed when an armed execution intent cannot pass readiness or when there is no final risk capacity. Each suppression records cause, candidate count, capacity, blocker, instance, scheduler cycle and next evaluation. |
| PLACE / BOOK admission | Three expired pending-risk proofs plus gross and human-potential notional limits made final capacity zero at the read. Unknown facts remain risk occupying until renewed proof; no settings or thresholds changed. |
| Plan / reservation / intent / submit / fill | No new pipeline stage may be manufactured to raise activity metrics. These stages continue only when each upstream fact and admission permits them. |
| Position / TP maintenance | Existing 22 positions / 22 active TP orders were preserved at the first read. Monitoring must prove protection after the new artifact loads. |
| Ownership outbox | Event-type namespace collision fixed in source and covered by regression tests. Existing live SQLite data was not edited. |

## User requirement about waits

Every technical wait must name its current cause and next evaluation and must continue its scheduled recheck. `WAITING_EXECUTION_CAPACITY`, `WAITING_CANDIDATE`, `AI_BUSY`, or `COOLDOWN` can therefore be an active progressing state, not a silent hang. A real risk limit or unproven order fact cannot safely be made to disappear to meet a frequency target. No code can promise frequent orders when authoritative capacity is zero; it can promise accurate, recurring evaluation and no fabricated order authority.

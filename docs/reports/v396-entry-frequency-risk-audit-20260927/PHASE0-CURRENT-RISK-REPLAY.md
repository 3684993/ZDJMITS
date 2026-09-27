# V3.9.6 current-time risk replay (Phase 0)

Status: **bounded endpoint replay complete; full authoritative gate replay remains INCOMPLETE**. Captured 2026-09-27 00:18 UTC from the already-running Testnet Engine using read-only GETs. No Engine lifecycle action, Settings write, exchange request, or product-code change was made for this evidence.

Reproduce the committed arithmetic with `python scripts/v396-risk-chain-phase0-replay.py`. Inputs are sanitized projections of `/api/v3/snapshot`, `/api/v3/diagnostics/closeout`, and `/api/v3/diagnostics/p0-entry-integrity`; each retains the SHA-256 of the serialized endpoint response captured immediately before projection. `authoritative-risk-replay-phase0.json` and `authoritative-risk-replay-gates-phase0.csv` are generated outputs.

## Current observation

| Fact | Value |
|---|---:|
| Snapshot timestamp | 1790470722810 |
| Account fact timestamp | 1790470711528 |
| Closeout timestamp | 1790470723160 |
| Visible positions / protected TP | 22 / 22 |
| Visible pending entries / active entry orders | 0 / 0 |
| Published capacity | 22 / 50 positions |
| Settings risk profile | READY, settingsVersion 219 |
| Published current admission | `HUMAN_ACK_OVERDUE`, ceiling LONG=0 / SHORT=0 |
| Candidate projection | 12 candidates per side; every listed candidate has `HUMAN_ACK_OVERDUE` as its risk blocker |
| Handoff ACK state | 2 rows; oldest 48.0h; configured max age 86,400,000ms = 24h |

The message renders the 24h threshold as 2.4h. Source arithmetic divides rounded hours by ten; the configured comparison itself remains 24h. The current runtime's published `riskAdmissionGates` and `riskAdmissionReasons` arrays are empty, despite the nonempty refusal/detail and zero side ceilings, so its selected label cannot be reconciled to a complete numeric gate result from this endpoint.

The HTTP runtime identifies PID 18644, instance `e0919ffb-a97e-4eb6-b4bb-09818a489150`, build `3.9.6-fa4fbc8660ef12849644`, and data directory `D:\MITS-worktrees\v396-final-convergence-20260922\data`. The captured account/position projection and closeout capital version differ in gross by $0.407481 (position row sum $11,214.444594; published capital-version sum $11,214.852075). The endpoint timestamps are close but not atomic. This replay does not claim cryptographic proof of the loaded source or a link from this process to the local SQLite ledger.

## Visible-book arithmetic

The authoritative profile values are unchanged: gross, human notional and cluster limits are each $10,811.957; direction is $8,649.565 per side; capital-at-risk is $10,811.957; stress loss is $5,405.978; human positions and pending handoffs are each capped at 50. The configured correlation map is empty. All 22 visible positions therefore fall in `UNMAPPED_CORRELATED`; they are all marked `HUMAN_MANAGED` and `PROTECTED`.

Gate formula is `headroom=max(0, limit-used)` and existing-book shortfall is `max(0, used-limit)`. The captured visible position set yields:

| Gate | Unit | Used | Limit | Headroom | Visible-book shortfall |
|---|---|---:|---:|---:|---:|
| MAX_GROSS_NOTIONAL | NOTIONAL_USD | 11,214.444594 | 10,811.957 | 0 | 402.487594 |
| HUMAN_POTENTIAL_NOTIONAL_LIMIT | NOTIONAL_USD | 11,214.444594 | 10,811.957 | 0 | 402.487594 |
| MAX_CLUSTER_NOTIONAL (visible unmapped bucket) | NOTIONAL_USD | 11,214.444594 | 10,811.957 | 0 | 402.487594 |
| MAX_DIRECTION_NOTIONAL LONG | NOTIONAL_USD | 3,648.253682 | 8,649.565 | 5,001.311318 | 0 |
| MAX_DIRECTION_NOTIONAL SHORT | NOTIONAL_USD | 7,566.190913 | 8,649.565 | 1,083.374087 | 0 |
| MAX_CAPITAL_AT_RISK (sum visible N/leverage) | MARGIN_USD | 1,088.846882 | 10,811.957 | 9,723.110118 | 0 |
| MAX_STRESS_LOSS, visible book only | LOSS_USD | 4,121.308388 | 5,405.978 | 1,284.669612 | 0 |
| Human position slots | COUNT | 22 | 50 | 28 | 0 |

Stress was recomputed from source formula, not treated as a notional gate. For scenario `j`, `basePct=abs(priceShock)+spread+funding+abs(markBasis)+depth+(unavailable?penalty:0)`, `baseLoss=G*basePct`, and the correlation term is `C_k*abs(priceShock)*convergence` for a bucket with more than one member. The visible-book coefficients are 0.195 for DOWN/UP 10% and 0.3675 for EXCHANGE_GAP_15; the latter binds at $4,121.308388. Candidate incremental loss and live UNKNOWN exposure are not included in that visible-only number.

These numeric comparisons are **not** presented as the runtime's complete admission gates: admission omitted its gate array, and the current source projections conflict. Closeout reconciliation reports `activeRiskUnresolvedCount=1` while P0 integrity reports `activeUnknownClaims=0`; snapshot reports `pendingEntries=0`. Keep the unresolved fact **UNKNOWN**, not zero. Its exact claim identity/notional and whether it is included in either current exposure projection cannot be reconciled here. Historical UNKNOWN remains 48 total / 47 verified no-active-risk.

## Consequence for implementation scope

1. Current runtime has a published zero ceiling on both sides; no order is eligible from this observation. Do not interpret the route-level suggested notionals as executable.
2. The visible book exceeds the unchanged aggregate profile ceiling by at least $402.49. This arithmetic alone does not prove which gate the running binary enforced; the running binary/data provenance is not the audit `main` checkout.
3. Visible gross, human position notional, and the single unmapped cluster are equal for these 22 positions. Pending-risk equality is **not proven** from the inconsistent current projections. Source-level consolidation must preserve pending exposure in the canonical gross ledger; preserve a tighter independent human or mapped-cluster ceiling if configured.
4. ACK age has only a governance timing measurement in this observation; position existence, exposure, and all 22 TP protections remain visible. Retain the handoff/owner/exit work and exposure. Any source change must keep independent pending UNKNOWN fail-closed.
5. Distinct directional caps remain genuinely independent. Stress remains a loss-valued scenario authority; its candidate contribution must be evaluated in loss dollars.

This Phase 0 evidence closes the live published decision and lower-bound arithmetic, but not the missing gate-array / active-UNKNOWN reconciliation. That limitation is carried into the implementation and final acceptance; no runtime acceptance is implied.

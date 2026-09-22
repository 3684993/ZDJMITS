# C3 Round 1 Independent Review — 2026-09-22

Reviewed implementation: `7e32942715aa8a1cab5341a246104aeea8ea5a5f`.
Follow-up safety fixes applied online before local validation: `38a1d985f9047f36fa5d3fb0e7e831ba73b44f65` and `13e7dc7448d44c3ec023f63afe37bf02019bbaa3`.

## Decision

**C3 Round 1 is not yet closed.** The shared durable writer/claim direction is accepted, but three mandate/manual-TP edges require Round 1.1 validation and wiring before this checkpoint can be closed.

### Accepted from Round 1

- MANUAL and TP writes now use the same `v396-ownership.sqlite` exit coordinator and durable quantity claims.
- PREPARED precedes exchange submit, and submit uncertainty is re-queried by the same clientOrderId.
- manual execution fails closed when its legacy execution journal is unavailable.
- runtime constructs `v396_exit_tasks` and restart convergence is query-only.
- adapter exposes tri-state exact exit lookup and a live position reduction proof for ONE_WAY/HEDGE.
- human revoke is consumed by Guardian instead of the old in-memory-only suppression model.

### New P1 findings

1. **Revoke without an existing mandate had no durable tombstone.** `revokeProtectionByHuman()` returned null when a legacy/migrated position had no mandate row, so a later sweep could create a fresh GUARDIAN mandate and rebuild TP. Fixed online by allowing a HUMAN revoked tombstone (`allowedPrice=null`, `FULL_REMAINING`) and ensuring a non-AI owner before revoke.
2. **HUMAN mandate was treated only as “not revoked”, not as a binding instruction.** Guardian could retain a HUMAN mandate while preparing a different TP price. Fixed online at the runtime boundary: TP preparation now requires the mandate price to equal the submitted limit price and enforces its `FULL_REMAINING` rule.
3. **Manual TP modification regression.** `ManualPositionService.replaceTakeProfit()` still calls `TpGuardian.place(order)` without the newly required `stepSize/tickSize`, so `REPLACE_TP/REBUILD_TP` can fail with `TP_STEP_SIZE_UNPROVEN`. It also needs to write/update the HUMAN mandate before placing the explicit human TP.

Round 1.1 must also make automatic Guardian repair honor an active HUMAN mandate price rather than recomputing a different target. It may refuse an invalid HUMAN price, but it may not silently replace it.

No Engine start/stop/restart, deployment, live settings/database mutation, migration, or exchange write is authorized by this review.

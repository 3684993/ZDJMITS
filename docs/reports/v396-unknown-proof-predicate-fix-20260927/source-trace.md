# UNKNOWN proof source trace and final contract

Base `d2ca73334f86d35910283d67b1f2f12fd8e11a02`; the one-pass task supersedes the previous plan-only task. This round explicitly authorizes conservative occupancy/claim changes. No new permission roundtrip is needed.

## Actual producers and supported proof classes

`ReconciliationService.noActiveRiskEvidence` is the only production writer of VERIFIED_NO_ACTIVE_RISK. A full successful open-orders pass and exact lookup absence precede it. It requires complete paginated order/trade coverage of the requested lifetime, checks identity conflicts and position attribution, and produces four common absence sources plus exactly one position source:

- POSITION_ABSENT: BINANCE_EXACT_ORDER_NOT_FOUND + BINANCE_OPEN_ORDERS_IDENTITY_ABSENT + BINANCE_USER_TRADES_IDENTITY_ABSENT + BINANCE_ALL_ORDERS_IDENTITY_ABSENT + BINANCE_LONG_SHORT_POSITION_ZERO.
- POSITION_OTHER_CYCLE: the same four sources + POSITION_PRESENT_PROVEN_OTHER_CYCLE.

CONFLICT is not a release class. S01 POSITION_ZERO proof vocabulary belongs to a separate offline accounting helper, not an activeRiskEvidence release producer. The canonical validator does not accept arbitrary nonempty source labels or assume all position presence is attributable.

Producer now requires a positive numeric createdAt rather than synthesizing a short history window from missing/coerced input. A new proof states typed proofClass and proofTier. Full remote coverage/conflict/position logic is preserved; no remote facts are fabricated.

## Canonical strict validator

`entryRiskOccupancy.validateNoActiveRiskProof(order, now)` is the sole proof contract. It checks exposure false, object/status, positive safe-integer numeric timestamps, checkedAt <= now < validUntil, positive interval, supported 0/1/2 tier and matching explicit/legacy tier, lifetime <= the existing 5/15/30 minute tier ladder, nonempty external identity and exact tombstone, numeric zero filledQuantity, exactly five unique string sources forming one producer-supported class, and consistency of optional explicit proofClass.

The existing tier ladder is unchanged. Legacy records without explicit proofClass/proofTier remain supported only if their full sources, numeric times, and existing remoteAudit tier satisfy the same contract (no tier means tier0). Null is not omission; numeric strings, duplicates, unknown sources and extra mutually exclusive position labels fail closed. No Settings or threshold was changed.

`hasVerifiedNoActiveRisk` delegates to it. Occupancy and durable claims share `entryOrderOccupiesRisk`, including terminal rows whose exchangeTerminalStatus remains UNKNOWN. `entryClaimReleasedByExchangeFacts`, historical eligibility, audit deferral, retained-proof renewal, R1 proof-valid/occupying counters, and P0 event-time release audit use the canonical predicate. P0 validates at event.ts rather than the present time, preserving historical meaning. Exact-query timeout retention now publishes occupancyReleased/proof metadata consistent with the actual retained release, so P0 and R1 see the same fact.

## Renewal, late facts and hydration

Fresh evidence is validated before release. Promotion inherits history only from a structurally valid previous proof, evaluated at its original checkedAt, so ordinary expired-but-valid proofs can renew without treating malformed old history as promotion authority. Promotion TTL remains anchored to the observed/covered time. Inconclusive reads can retain only a still-valid canonical proof; TTL is never extended by an inconclusive outcome.

A successfully queried or timed-out exact order result cannot overwrite a row replaced during its await. A successful absence probe likewise cannot overwrite a newer fill/identity/order row. Coordinator exact recovery clears an older absence proof when remote order state is observed; it cannot later reuse that stale proof after UNKNOWN. All tests use isolated mocks; no live order was queried or written by this repair.

The terminal historical fast path now excludes `needsRiskVerification`: terminal-UNKNOWN with invalid proof must obtain fresh complete evidence or stay fail-closed. The legacy route that merely saw exact-order absence cannot release it.

`SettingsStore.loadRuntime`/`loadEntryExecutions` and RuntimeState.restore retain history verbatim. No migration, deletion, evidence coercion, or load-time trusted flag is added. Consumption validates at the actual decision time. Runtime startup continues to prefer a strictly newer runtime checkpoint order to its durable-task copy; the impact report separately models that established merge rule.

## Durable journal correction and same-scope conflicts

`released_at` remains a historical idempotency marker, never a current proof-valid bit. Save recomputes active state from the canonical consumer. Stats compute effective active claims even when a formerly released row still has a stale inactive bit. Active UNKNOWN claims include terminal-UNKNOWN; storedActiveClaims and reactivatedByProofValidation disclose the difference, and releasedAtSemantics explicitly labels history.

Several old releases can become invalid in a scope already owned by another indexed active row. No schema/index migration is needed: preserve every payload and existing index owner, and inspect all same-scope rows under BEGIN IMMEDIATE before any new claim acquisition. Any stored active or canonically active historical row blocks new acquisition. A conflict does not discard payload or silently unblock risk. Stats report all effective claims; the physical unique active index need not encode multiple reactivated historical risks. Retried proof-released identities never resubmit. Existing verified terminal/reprice behavior remains covered by integration tests.

## Regression proof

The 47-case strict-validator matrix covers legitimate classes/tier TTL and malformed timestamps, identity, source sets, type coercion, exposure/fill facts and terminal-UNKNOWN. The 13 hydration/producer/consumer tests cover old inactive bits, reopen without mutation, expiry without save, same-scope conflicts, natural renewal, R1 agreement, late facts, coordinator recovery, and invalid lifetime input. Existing positive fixtures with abbreviated source lists were upgraded to the real source contract; an impossible 31-minute fixture was corrected to 30 minutes. The prior test pinning permanent post-expiry claim release was changed to require fail-closed reactivation under the new explicit authorization.

Concrete line references and excerpts: source-producer-consumer-map.json. Full patch: corrective-source.diff.txt. No unrelated product refactor, Primary contract change, risk-policy change, deployment, or Engine lifecycle action.

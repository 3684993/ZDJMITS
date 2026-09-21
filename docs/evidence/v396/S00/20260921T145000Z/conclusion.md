# S00 conclusion

Verdict at round 1 (implementer side): `READY_FOR_REVIEW`. The `ACCEPTED` recorded at `58b7888`/`7164f5a` was signed by an implementer role and is void under README section 5 and ENGINEER-RUNBOOK section 6; see `audit-round-2-20260921.md` finding F1.

Verdict at round 2 (master-design review): `ACCEPTED`, limited to the S00 specification and isolation baseline delivered on branch `codex/v396-s00-audit-20260921`. It is not a deployment, Engine, ENFORCE or trading authorization, and it does not raise any scorecard item above `NOT_ASSESSED`.

What is now true that was not true before:

- The entrypoint classification is derived from current file content instead of hand-written labels, and the verifier rejects any mismatch, any new unreviewed entrypoint, and any relaxation of the rule table. 107 entries: 98 forbidden, 8 boundary-eligible, 1 executed. Engine launchers, acceptance runners, source-rewriting patch scripts, the credential helper and the aggregate root commands are no longer presented as runnable after a boundary is proven.
- Engine test isolation is measured, not asserted: 121 test files, the 7 that open a store all use an OS temporary directory or an in-memory database, and none references the repository `data` directory or port 8080.
- Baseline identity is reproducible: five hashes are bound to named files, re-checked on every run, and taken after CRLF-to-LF normalisation because the same committed markdown differed in bytes between two worktrees.
- The fixtures speak the frozen contract vocabulary: `cycleId` everywhere, no invented `ownerState`, all four `FactStatus` values exercised, plus a same-cycle second small-loss case so I04 is representable.
- `write-path-inventory.md` records the real claim keys and shows that today's `executionScope` is not the CONTRACTS scope, with the S00-T05 over-claim in round 1 corrected.

Delivered: actual base/head identity with plan drift recorded; default-settings whitelist; entry/TP/human write-path inventory; initial field-consumer map with line-verified consumers and unit ambiguities named; six isolated, redacted fixture classes plus legacy AUTO/no-plan and three added contract-shaped cases; I01-I12 consumer map with authority sources; and a NOT_CONFIGURED experiment pre-registration skeleton.

No Engine process was started, stopped, restarted or hot-reloaded. No live database, Settings store, network endpoint, AI service, exchange write, deployment or production artifact was touched. The static check reads files and writes one copy below the OS temp directory.

Residual items that do not block G0, restated for the next stage:

1. Runtime build identity was not read; OP2 will need a source for it before S08.
2. The derivation is a conservative over-approximation. If a later stage finds an entrypoint wrongly over-restricted, change the rule table and regenerate — never edit a single label.
3. `apps/engine/vitest.config.ts` still pins no `ZDJ_DATA_DIR` or `ZDJ_PORT`; the isolation guarantee is currently the measured behaviour of individual tests. Introducing a global setup is terra's implementation call in S01, and this stage did not modify a shared integration file on their behalf.
4. Commits are attributable to a branch, not to a named engineer: all three round-1 commits carry the same repository identity.

S01 may start offline against these fixtures and this boundary. S01 must not weaken the rule table, must keep `MockExchangeAdapter` free of network-shaped calls, and must return evidence that the I02, I04, I05 and I06 rows in `invariant-consumer-map.json` are exercised by tests rather than by fixtures alone.

# R3 human-decision review and local verification

Status: `V396_R1_R2_R3_IMPLEMENTED_LOCAL_PASS`

## Decision and scope

Reviewed `docs/plans/v396/CODEX-V396-R3-HUMAN-DECISION-20260927.md` at commit `d971519c618cba19dceaa59d08f2d9dc0a5d9370`, which accepts the real timing boundary and explicitly prohibits changes to Primary prompt/input, decision schema, retry, selection, or execution semantics. R1/R2 were not reimplemented. This follow-up changes only the R3 telemetry schema and its tests, plus reports/gate evidence.

## R3 contract review

Before Primary, telemetry records the pre-existing snapshot/fact identity, side, the same model-visible quantity-unit interval, and the immutable execution-envelope identity composed from its existing version, symbol, creation time, expiry, and side. No candidate IDs are attributed to this scope: `candidateIdsPresentedToPrimary` is empty and explicitly tagged `NOT_APPLICABLE` / `IDS_NOT_YET_EXISTING`.

After Primary returns, telemetry labels `POST_PRIMARY_GENERATED` and records the bounded generated legal candidate IDs and their quantity, target-price, and target-horizon values, together with the model-selected quantity, target price, target horizon, and horizon. On refusal, it records both the count/boolean for other generated legal alternatives in that same set and `postPrimaryAlternativeExistsOnRefusal`, defined as refusal + at least one generated legal candidate + no exact selected-choice mapping. Selection mapping uses the full generated set even though emitted candidate details are bounded to 18. These are observations only.

The event sink remains best effort. Telemetry does not feed quantity, side, target, horizon, model call, retry, reservation, admission, or order authorization. No Settings, thresholds, R1/R2 behavior, or execution strategy changed.

## Validation

- Focused Engine tests: 2 files, 8 tests passed (`frozenChoiceTelemetry.test.ts`, `entryExecutionChain.test.ts`).
- Engine typecheck: passed.
- Engine build: passed.
- `git diff --check`: captured in `git-diff-check.log` after staging.
- Full suite, S00 replay, and 72-hour research were not rerun: the only product changes since `902d83d` are the bounded observational telemetry fields and their focused tests. The prior full local suite/verify evidence remains committed with the implementation report.

No deployment, runtime acceptance, exchange write, Engine lifecycle action, or GitHub Actions run occurred. `DEPLOYMENT_NOT_AUTHORIZED`; runtime acceptance is `NOT_RUN_EXTERNAL`; GitHub Actions are `NOT_RUN_BILLING_LIMIT`.

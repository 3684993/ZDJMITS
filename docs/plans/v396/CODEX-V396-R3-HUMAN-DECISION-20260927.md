# V3.9.6 R3 Human Decision — Preserve Primary Contract

**Decision state:** `R3_REQUIREMENT_REVISED_NO_PROMPT_CONTRACT_CHANGE`

This decision is based on implementation commit `902d83ddca690d10136aa81eaf920a33fd7ec959` and its committed report/evidence.

## Decision

Do **not** modify the Primary prompt, model input contract, model-visible candidate schema, retry behavior, or immutable selection semantics merely to make pre-Primary candidate IDs observable.

The implementation report established a real architecture timing fact: Primary receives a legal quantity/execution interval before candidate IDs exist; the concrete candidate IDs are generated only after Primary returns and post-response validation/materialization runs. Therefore the previous requirement to record "candidate IDs presented to Primary" cannot be satisfied truthfully without changing model-visible behavior.

Changing the prompt/contract solely for telemetry would violate the authorized R3 scope (`observability only`) and could change token use, model behavior, conversion behavior, and future debugging semantics. It would also add complexity without current evidence that such a contract change improves throughput.

## Revised R3 truth contract

R3 is considered complete when telemetry truthfully preserves the two temporal scopes instead of pretending they are one offered set.

### PRE_PRIMARY_VISIBLE
Record only facts that Primary actually receives or that deterministically bound its authorized quantity choice at that moment:
- evaluatedAt / snapshot or fact identity;
- side;
- legal/executable quantity-unit interval visible to Primary (`min`, `max`);
- relevant immutable execution-envelope identity/hash if already available without changing the prompt contract;
- no fabricated candidate IDs.

### POST_PRIMARY_GENERATED
After Primary returns, record the bounded system-generated candidate set produced by the existing deterministic validation/materialization path:
- candidateSetHash;
- generated legal candidate count and bounded candidate IDs;
- generated quantity/horizon intervals;
- model-selected quantity/horizon/target and resolved candidate ID when an exact mapping exists;
- whether the model selection is inside the generated legal set;
- when conversion is refused, whether one or more alternative generated legal candidates existed in that same post-Primary snapshot;
- existing refusal/conversion class.

Telemetry must explicitly expose the timing distinction, for example `offerTiming=POST_PRIMARY_VALIDATION` or an equivalent schema field. An empty `candidateIdsPresentedToPrimary` is acceptable only if it is explicitly documented as `NOT_APPLICABLE / IDS_NOT_YET_EXISTING`, not as evidence that Primary had no legal quantity space.

## Prohibited changes

- Do not add candidate IDs to the Primary prompt in this round.
- Do not change the model decision schema/contract.
- Do not auto-select an alternative generated candidate.
- Do not clamp/resize quantity, switch side, target or horizon.
- Do not trigger a second model call or automatic retry.
- Do not use R3 telemetry as an admission/routing/execution input.
- Do not change Settings, thresholds, governance modes, economics rules, leverage rules, Testnet/Production boundary, or JIT behavior.

## Acceptance interpretation

The purpose of R3 is to measure whether immutable model selection loses conversions, not to require a model-visible candidate-ID architecture that does not currently exist.

A useful later metric is:
`postPrimaryAlternativeExistsOnRefusal = refused && generatedLegalCandidateCount > 0 && selected choice did not map to an accepted generated candidate`

This is observational evidence only. If a later runtime window proves a material conversion-loss rate, any change to Primary input/contract must be proposed as a separate root-cause/implementation plan and receive separate human approval.

## Required next action

Codex should review the existing `902d83d` R3 implementation against this revised contract.

- If the existing telemetry already satisfies the revised temporal truth contract, do not change product behavior; update the committed implementation report/gate status to `V396_R1_R2_R3_IMPLEMENTED_LOCAL_PASS` with evidence.
- If only telemetry field naming/typing/tests are needed to make `NOT_APPLICABLE / POST_PRIMARY_ONLY` unambiguous, make the smallest observational-only change, rerun the required local gates, commit/push all evidence to GitHub `main`, and stop.
- If satisfying this revised contract would require prompt/decision-contract or execution behavior changes, stop as `IMPLEMENTATION_BLOCKED_NEEDS_HUMAN_REVIEW` and explain why.

No deployment, Engine lifecycle action, runtime acceptance, exchange write, GitHub Actions run, or Settings change is authorized by this decision.

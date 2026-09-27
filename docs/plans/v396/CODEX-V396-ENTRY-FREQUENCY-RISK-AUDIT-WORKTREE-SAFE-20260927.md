# V3.9.6 Entry Frequency / Risk Complexity Audit — Worktree-Safe Handoff

## Goal
Analyze why entry/order frequency remains low and whether the current risk/admission chain is over-complex. Preserve execution correctness while converging toward a minimum-sufficient hard-gate chain.

## Critical local preflight: preserve the current dirty worktree
The currently selected local worktree is NOT on `main` and shows about 48 uncommitted files. Treat that worktree as evidence that must not be destroyed or mixed into V3.9.6 mainline work.

Before doing any product analysis or edits:

1. Record the current worktree path, current branch, HEAD, `git status --short`, and the list of modified/untracked files.
2. Do NOT run `git reset --hard`, `git clean`, blanket `git restore`, blanket checkout, rebase, force push, or any command that can discard those 48 local changes.
3. Do NOT blindly `git stash` or blindly commit all 48 files. They may contain generated/runtime/evidence files or stale V3.9.5 work. Preserve them in place first.
4. Do NOT switch the dirty worktree to `main`.
5. Fetch `origin/main`, then create a NEW clean worktree from the latest `origin/main` for this task. Use a new short-lived branch based on `origin/main`, for example `codex/v396-entry-frequency-risk-audit-20260927`.
6. Verify the new worktree is clean and that its base commit equals the latest `origin/main` before any analysis or code change.
7. All audit, implementation, tests, build and any later deployment for this task must happen in the new clean worktree/branch, not in the dirty V3.9.5 worktree.

The 48-file dirty worktree is a separate preservation task. For this round, inventory it only. If any of those local hunks later appear relevant, compare them explicitly against current `main` and port only individually proven unique changes. Never wholesale merge/cherry-pick the dirty state into mainline.

## Phase 1 — read-only root-cause exhaustion
Use GPT-6 Astra with high reasoning. First perform a read-only audit of the last 12–72 hours of candidate → AI decision → risk admission → reservation → intent → exchange submit.

For every drop/veto stage, compute and report:
- exact formula and source of truth;
- current `used`, `limit`, `headroom`, `shortfall`;
- whether the gate is size-dependent or size-independent;
- exact minimum legal order and maximum executable order/notional where applicable;
- hit rate over the audit window;
- whether the gate is independent, redundant, stale, duplicated, or merely diagnostic/telemetry;
- whether the same underlying exposure fact is being vetoed multiple times under different names;
- whether a candidate with a smaller legal quantity could execute but is being collapsed to zero instead;
- whether a human/governance status is being used as an execution veto without an independent safety function.

Do not stop at labels such as `HUMAN_ACK_OVERDUE`, `HUMAN_POTENTIAL_NOTIONAL_LIMIT`, `MAX_GROSS`, `MAX_CLUSTER`, `STRESS_LIMIT`, `RISK_ADMISSION`, etc. Trace each label to its exact code path and numeric threshold.

Produce a stage-by-stage conversion table for at least:
`POOL → ELIGIBLE → SCOUT → PRIMARY → PLACE → RISK_ADMISSION → TRADE_PLAN → RESERVATION → INTENT → SUBMIT → FILL`.

For each stage report counts, drop reasons, and the marginal contribution of each hard gate.

## Phase 2 — complexity audit
The target architecture is NOT “maximum number of checks”. The target is a minimum-sufficient hard-gate chain.

Classify every gate into one of:
1. EXECUTION_CORRECTNESS — exchange legality, real balance/margin, minQty/stepSize/minNotional, symbol availability, JIT/version/owner/idempotency, Testnet/Production lock, stale/unverified market/private data.
2. INDEPENDENT_RISK_AUTHORITY — a single authoritative risk fact that independently prevents unacceptable new exposure.
3. DUPLICATE/DERIVED — repeats another authoritative fact without adding independent protection.
4. TELEMETRY/DIAGNOSTIC — useful for display/monitoring but should not hard-veto execution.
5. STALE/WRONG-SCOPE — historical/human/governance state incorrectly blocking otherwise valid new orders.

Any gate in categories 3–5 must be challenged. Do not preserve it just because tests currently encode it.

Specifically audit:
- `HUMAN_ACK_OVERDUE`: determine whether it has an independent safety function for NEW automated Entry or is an operational/governance state that should be diagnostic instead of hard veto.
- human/gross/direction/cluster/stress layers: identify whether they are multiple names for the same exposure fact or genuinely independent constraints.
- capacity logic: if a requested size exceeds a limit but a smaller legal size fits, the system should expose the exact executable ceiling rather than collapse the candidate to zero unless a truly size-independent blocker exists.
- any telemetry, health, mismatch, historical observation, or dashboard state that accidentally enters execution authority.
- any duplicate authority path between portfolio intelligence, risk governance, admission, capacity, and pre-AI envelope.

## Phase 3 — implementation only after evidence
First commit/push the complete root-cause/complexity report. Only then modify product code.

Implementation goal:
- each non-submitted order should have one necessary, independent, quantitatively explainable primary blocker;
- duplicated/derived hard vetoes should be merged, downgraded to diagnostic, or removed from hard authority;
- size-dependent constraints should compute an executable ceiling/critical value instead of producing a false zero when a smaller legal order is possible;
- if no independent blocker remains and real trading capital/exchange legality are sufficient, the natural flow should proceed to reservation → intent → submit.

Do NOT increase leverage, invent capital, fabricate exchange facts, disable Testnet locks, disable JIT/version/owner/idempotency, or fabricate fills merely to raise order frequency.

## Tests / build / deployment
- GitHub Actions/hosted CI is not an acceptance path; record `NOT_RUN_BILLING_LIMIT`.
- Run targeted tests first, then all relevant local tests, typecheck, repository gates, S00/static/storage checks, `git diff --check`, and formal build locally.
- Do not deploy until all local gates are green.
- Any lifecycle action must be explicitly justified by source/build/runtime identity needs. Do not restart just for telemetry/docs changes.
- Production writes must remain 0. PR #9 untouched.

## Deliverables
1. Dirty-worktree preservation inventory (branch/path/HEAD/status/file list only; no destructive action).
2. Clean-worktree identity proving latest `origin/main` base.
3. Root-cause conversion/drop report over 12–72h.
4. Gate-by-gate complexity matrix with formulas and exact critical values.
5. Proposed minimum-sufficient hard-gate chain.
6. Product changes only after the analysis commit.
7. Local test/build evidence and, if deployed, runtime identity closure plus online validation.
8. Final statement distinguishing:
   - low frequency caused by true independent risk/execution limits;
   - low frequency caused by redundant/over-complex/stale hard vetoes;
   - remaining operator/governance states that should not be misrepresented as execution impossibility.

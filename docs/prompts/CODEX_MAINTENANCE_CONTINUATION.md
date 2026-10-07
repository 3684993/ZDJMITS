# J-MITS V3.9.7 — CODEX MAINTENANCE CONTINUATION

> Repository: `3684993/ZDJMITS`
> Local root: `D:\MITS`
> Prepared: 2026-10-07 (+08:00)
> Observed baseline: `ae5e0c9e6ef6e03872d16aca9f0f9ea2dbd40194`
> Last user-confirmed green verification: V3.9.x Verify #655.

## Mission

Continue real implementation/maintenance from the **actual current checkout**. Read this file and `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` first, then inspect current `main`, recent commits, package scripts, tests and relevant runtime code.

The repository + local test/runtime evidence are the source of truth. If this document is stale relative to code, investigate the delta rather than reverting code to match prose.

You may disagree with previous ChatGPT design choices, but disagreement is only useful when it improves the system. If you reject an existing approach you must:
1. identify the concrete defect or weakness with code/test evidence;
2. propose a safer/simpler/more correct alternative;
3. implement that better alternative where feasible;
4. add/update tests proving the improvement.

Do **not** stop at critique or contradiction.

## Work mode

Use Codex's local checkout and local tooling as the primary loop:
- run targeted tests while changing code;
- run relevant typecheck/build/tests locally before committing;
- broaden local verification when practical;
- do not use GitHub Actions as the debugging/decision loop;
- do not wait for or poll Actions;
- if pushes automatically trigger Actions, ignore them as an implementation dependency and do not edit CI just to suppress them;
- do not ask the user to run diagnostics that Codex can run locally;
- if user-side runtime evidence is truly required, prefer adding one script that emits one report/ZIP.

Commit coherent improvements with clear messages and keep the working tree clean.

## Hard constraints

Preserve all of these:
- TESTNET-only execution.
- Production writes = 0.
- TESTNET/environment isolation remains fail-closed.
- Never restore `expectedStaticEgressIp`, checkip authorization, NET-003/NET-004 static-IP authority, or any static egress-IP gate.
- Exact clientOrderId identity/idempotency remains authoritative.
- Unresolved submit UNKNOWN must never duplicate-submit.
- Exchange filters, precision, legality and real funds/margin remain fail-closed.
- Private account/order truth must never be guessed.
- Do not delete/reset/recreate trading history, SQLite or TradeRecord to fix an issue.
- Preserve reconciliation per-run budgets, storage/I/O convergence, bounded logs/WAL protections and existing `0xC0000409` mitigations.
- Do not return to speculative V8 flag tuning or repeated VPN testing.

Service boundary:
- 8080: Engine + Dashboard
- 8081: Scout
- 8083: HARNESS_ADVISOR / REVIEW_BRAIN
- 8084: ZDJ_PRIMARY_BRAIN / PRIMARY_BRAIN

Never stop/restart/reload 8083 or 8084 without explicit user awareness/approval first. Ordinary maintenance may touch 8080 only.

## Current baseline to validate first

### Resolved SettingsStore regression
Commit `f95c116d6679addaeed6b087c155c84e3b6ba662` fixed the stale migration test that expected `brain-review-test` while the configured enabled Review resource was `brain-7900-review`. The user reported Verify #655 GREEN. Do not alter production Review routing merely to restore the obsolete literal.

### UNKNOWN recovery baseline
Current observed commit:
`ae5e0c9e6ef6e03872d16aca9f0f9ea2dbd40194`
`fix: throttle exact-order recovery and prefer user data`

Intended semantics:
- UNKNOWN/SUBMITTING Entry recovery first consumes same-clientOrderId Binance User Data WS truth.
- Exact `GET /fapi/v1/order` is bounded fallback/recovery, not continuous truth polling.
- Same identity recovery is throttled (currently 15 seconds in EntryCoordinator).
- Durable `mustQueryFirst` recovery prefers WS before REST.
- POST-ACK-loss recovery follows the same discipline.
- No second wire submit while the identity is unresolved.

First run the relevant local tests and inspect all exact-order recovery call sites. If a stronger shared design belongs at adapter/service level (for example existing exactOrderFlights/cache plus a shared recovery budget), you may refactor it, but preserve the safety semantics and prove them.

## Priority A — Binance latency / NET-002

Goal: tolerate ordinary Testnet/Internet latency without masking real sustained outages.

Required semantics:
- one/two isolated REST timeouts are telemetry only;
- NET-002 requires sustained critical timeout evidence;
- one physical timeout is not counted twice as transport + queue failure;
- `/fapi/v1/time` jitter alone does not create NET-002;
- advisory endpoints such as `openInterest`, `premiumIndex` and futures context do not become Entry-hard blockers;
- budget pressure and transport failure remain distinct causes;
- stale private truth still fails closed once real freshness tolerance is exceeded.

Inspect `operationalIncidents.ts`, `BinanceTransport.ts`, `requestBudget.ts` and tests.

## Priority B — EX-SUBMIT-UNKNOWN / exact identity

Goal:
- User Data WS is preferred for order state changes;
- exact REST is bounded fallback;
- same clientOrderId query work is single-flight/deduplicated/throttled;
- UNKNOWN remains risk-bearing and non-resubmittable;
- restart recovery preserves the exact same identity.

Audit **all** `findEntryByClientOrderId` call sites, including reconciliation/review/action boundaries. Avoid fixing only one scheduler while another still hammers the same identity.

## Priority C — MARKET-DATA-001 truth

Do not merely hide the banner. Verify the execution gate itself.

Required semantics:
- fresh required WS/cache quote/book/kline facts are primary market truth;
- optional REST context timeout must not create false global market-data outage when required WS/cache truth is fresh;
- truly stale/missing required market facts still fail closed;
- targeted REST repair may recover gaps;
- operator incident should reflect a persistent real condition, not a brief transient pause.

Audit stream freshness timestamps, cache freshness, continuity, pipeline pause derivation, candidate-vs-global blocking, and incident generation.

## Priority D — manual explicit LIMIT

Preserve:
- user-specified legal LIMIT remains usable when preview quote is stale/missing;
- preview quote is UX assistance, not a hidden submit prerequisite;
- exchange legality/precision/filters, environment, funds/margin and real risk facts remain fail-closed.

Verify Dashboard -> API -> adapter paths and tests.

## Priority E — Settings CRUD UX

All Settings tabs should have conventional, unambiguous interaction.

Managed resources need:
- list/select/add/edit;
- explicit dirty/unsaved state;
- save/cancel;
- test where applicable;
- activate where applicable;
- delete where safe.

Ordinary scalar settings and resource objects must have independent save boundaries.

Audit `apps/dashboard/src/views/SettingsView.vue` for malformed markup/invalid end tags, ambiguous actions, dirty-state loss on selection changes, and resource-vs-global save confusion.

## Priority F — true multi-proxy CRUD

Requirements:
- adding a proxy never overwrites an existing one;
- each resource has distinct identity/name/type/url/enabled;
- selected resource saves/tests independently;
- save != activate;
- active proxy switches explicitly;
- inactive resources can be deleted;
- active/last-required protections remain safe;
- hot-apply follows current architecture;
- proxy test tests the selected resource itself.

Inspect persistence + API + UI + hot-apply together.

## Priority G — useful Review / Research GPU utilization

Use REVIEW_BRAIN and 9B Research for useful bounded asynchronous work such as:
- pending Entry review;
- position/exit review;
- trade-quality postmortem;
- candidate evidence compression;
- anomaly/execution-quality review;
- bounded external/shared-event research.

Hard rules:
- Review/Research are not a hidden second Entry veto authority.
- Primary remains final Entry decision authority over frozen executable candidates.
- extra AI work must be bounded and must not delay live trading.
- optimize for useful work, not synthetic GPU utilization.

## Architectural principles

Binance:
- User Data WS for private order/account state changes.
- Market WS for live market state.
- REST for necessary reads, recovery, exchange legality, exact identity and bounded audit/history.
- Do not continuously duplicate fresh WS truth via REST.

Entry authority:
- Primary chooses from frozen executable candidates.
- valid Primary PLACE is not re-judged by another AI authority.
- post-PLACE blockers are deterministic physical/execution facts.
- Review may advise; deterministic coordinator owns exchange actions.

Fail-closed should protect real facts: environment, identity, available capital, legality, stale private truth and unresolved exchange state. It must not turn optional analytics/context endpoints into hidden mandatory gates.

## Testing expectations

For every behavior change:
- add/update the smallest relevant regression tests;
- cover safe-success and fail-closed branches;
- cover restart/idempotency for identity-sensitive code;
- cover WS/REST race convergence where relevant;
- cover multi-resource persistence independently of active resource state.

Discover and use the repository's existing commands. Do not weaken production behavior to satisfy a stale/flaky test.

Before finalizing a coherent batch, run relevant targeted tests, typecheck, build and broader tests appropriate to the changed area.

## Final report

At the end of a coherent batch report concisely:
1. defects/improvements found;
2. files changed;
3. local tests/typecheck/build actually run and results;
4. remaining known issue/uncertainty;
5. commit SHA(s);
6. whether any service was restarted;
7. confirmation that no Production-write path was enabled and Production writes remain 0;
8. update `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md` if repository state materially changed.

Start now. Read both handoff files, inspect actual current main, validate the `ae5e0c9...` exact-order changes locally, then continue by evidence. Do not wait for Actions and do not stop at critique: improve the code.

# Engine Reactivity deployment and one structural followup

2026-10-08 +08. Authority: current human instruction and CODEX_DEPLOY_REACTIVITY_ACCEPTANCE.md. Old6/12h observation is not a gate. SSH/SOCKS, 8081/8083/8084, Settings247, strategy/Entry/TP/TTL/leverage/quote-routing/Production policy are frozen. This run does not reopen the broad audit. No Actions used as a gate.

## Verified main deployment

Fetched origin/main **c1ed49539a0be24fc4a7d19801d19e64c2102168**. Compared application/packages/scripts/config/package files against **ce46b71cf45b2a16eef2c83fb91242619e71a65a**: identical, only documentation differs. Existing full local verification retained at reactivity-core-checkpoint-local-verify-20261008.log; not rerun for this deployment. Necessary Engine/Dashboard formal builds PASS, logs under reactivity-acceptance/.

Canonical D:\MITS fetch succeeded but ordinary FF refused because the two untracked VPN scripts would be overwritten. Neither was moved/overwritten, no stash/reset/clean. Deployed clean latest-main worktree D:\MITS-WORKTREES\v397-reactivity-deploy-acceptance-20261008 with existing D:\MITS\data junction. Previous unused local checkpoint draft remains isolated in its old worktree, not integrated or deployed. Stop/build/load separated from the running Engine to avoid commit-memory diagnostic contamination. Models and SSH unchanged.

Controlled stop old29620/4b4688e0-3816-49c7-ae47-e4e41aeabfba, then MANUAL_START new **PID3228/host44084/instance31834012-3fd5-4a59-9378-afb5284aab53/restart273**, build3.9.7-3a0232fb2da283b98998, artifact3a0232fb2da283b98998d0308b2e10c04ace1bb58a26d8794321bf3cb405cf02, source67454797e1e5bc6dcf978ef895acee1976d3be9d36514e70e3902276a17c8fd5. Identity6/6 closed. READY/privateREADY first observed12:29:16. Startup samples retained separately.

## First independent acceptance: FAIL

Actual12:29:49.805652–12:35:48.242112, **5.97395minutes/25samples**,15second nominal cadence. Dedicated newly created diagnostic histogram12:29:59.827–12:36:00.272, no reset of application telemetry. Bounded60second CPU profile plus45second failure followup; the second reuses only the PID-verified inspector owned by the first, which subsequently closes it. No tests/build overlap this window.

| Metric | Pre-core checkpoint baseline | Verified main, fresh feedback |
|---|---:|---:|
| persistRuntime inclusive CPU samples |43.2815%|1.7189%|
| persistRuntimeCore |not present|1.8309%|
| TQ captureState |10.7440%|4.2764%|
| TQ materialize |3.5050% in the earlier45s sample|9.2898%; failure followup9.2465%|
| Main idle |10.4803%|45.1207%; failure followup47.3064%|
| Event-loop max |6136.267ms accumulated diagnostic|6417.285ms fresh independent histogram|
| Fresh independent histogram p95 |not captured in baseline|44.761ms|
| PRIVATE / EXECUTION queue timeout identities |baseline not reclassified here|0 /0 observed|
| REQUIRED_MARKET queue timeout identities |baseline not reclassified here|11 observed|
| BACKGROUND/AUDIT queue timeout identities |separate|5 observed; excluded from critical verdict|

CPU sample attribution is inclusive/overlapping, not additive wall time. Baseline histogram was cumulative; new independent histogram explicitly excludes startup. Fresh critical timeout identities are deduplicated and bounded to sample first/last completion times, not differences of sliding laneStats.

Private READY25/25, no endpoint gaps, maxage21785ms/p956119ms, consecutivefailures0. TP no missing/unverified/duplicate/mismatch/orphan/unresolved observation. TESTNET lock25/25, Production0known25/unknown0. Fresh market statesFRESH7/RECOVERING12/DEGRADED6; hot quote age26244ms, book14884ms max, missing latest closed 1m/5m/15m and fourQUOTE_STALE sample facts. Healthy private/TP cannot substitute for necessary market freshness. No sampled active incidents does not imply no failures.

RSSmax2.222GB, heapUsedmax1.918GB; hostcommitheadroom2.771–4.040GB, while physicalavailable is separately recorded. Historical0.5–1.1GB commit shortage is not assumed to explain this fresh sample. Kernel pool owner/cause remains UNKNOWN. No OS/pagefile/model lifecycle change.

## One measured structural iteration

Dominant remaining native SQLite .all path is TQ materialize (8.6257% self-call samples in first profile), then repeated ownership pendingEvents paths (3.9170% plus1.9585%). Profile and inspected code show main-thread historical SQLite work. The evidence proves the expensive paths; it does not prove TQ is the sole cause of every6.42s stall or every network/market failure.

The single followup batch moves TQ episode materialization, evidence retention and evidence-WAL work to a256MB capped Worker. It receives clock/configuration only and reads the existing additive evidence DB: no RuntimeState history clone, adapter, credentials secret, exchange writes or lifecycle authority. One in-flight job plus one coalesced pending clock/configuration. All existing synchronous exact event/mandate/fill capture remains on Engine before maps advance; no evidence/cap/TTL/order identity or execution gate is deleted or widened. Main evidence connection disables automatic WAL checkpoints; history worker performs them. Worker failure exposes degradation without restart or synchronous heavy fallback.

Dirty work now has a durable revision. Concurrent fact/mark updates increment it. A short savepoint acknowledges work and writes the episode only if that revision still matches; stale analysis cannot clear new work or overwrite a newer episode, and failed writes roll the acknowledgment back. Observation-horizon metadata is also revision-fenced. Work remains retryable after worker termination.

Ownership outbox gets a delivered index; pending rows are selected in the same exact rowid order with no cap/drop/ownership-policy change. This avoids scanning delivered history in recurring synchronous delivery reads. Other warnings, K-line boundaries and residual paths remain evidence/backlog unless this single post-fix profile requires discussion; no per-alert expansion.

Targeted4files/53tests PASS; Engine typecheck PASS; S00 re-derived with unchanged rules PASS; formal targeted build PASS. Real compiled Worker smoke PASS in unique OS-temp READ_ONLY TESTNET DB (one synchronous event, one projected episode, authorityNONE, exchangeWrites0); synthetic offline fixture is not natural runtime acceptance. Full npm run verify PASS (exit0): 234 Vitest files / 2010 tests plus 16 script tests, script contracts, S00, release identity, typecheck and formal builds. No live8080 or data junction during verification. Second deployment/feedback pending. At most this one followup implementation is authorized in this run.

## Evidence

reactivity-acceptance/ contains build/controlled-stop/startup/identity/settings/profile/raw samples/lossless gzip+SHA256/audited summary/deduplicated requests and fresh histogram. reactivity-history-isolation/ contains source verification, unit/real Worker smoke, memory isolation and necessary second lifecycle/feedback evidence. Final result and actual deployment identity will be appended after the one full gate and short feedback.

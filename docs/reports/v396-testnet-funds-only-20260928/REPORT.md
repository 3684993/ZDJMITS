# V3.9.6 TESTNET Entry funds-only policy — 2026-09-28

User-authorized change: all non-funding portfolio/history risk loses Entry veto authority in exactly TESTNET + TESTNET_ENABLED. Default READ_ONLY and Production isolation are unchanged. This supersedes the previous risk-enforcement policy specifically in this execution mode. Implementation started from clean main 7a8fcaf7f261effae9d663fcc914d05169e7c36f (equal to origin/main).

## Actual behavior changes

| Layer | Removed or downgraded Entry authority |
| --- | --- |
| Universe and lifecycle | ACTIVE_POSITION, ACTIVE_ENTRY_ORDER, same-underlying inventory/claim exclusion; UNKNOWN in-flight history cannot keep a candidate permanently occupied |
| Capital allocation/routing | max positions, duplicate underlying, direction preference permission, speculative/direction/quote-usage exposure, per-trade loss sizing, per-position equity/margin caps and artificial minimum margin; actual available quote balance and exchange minimum remain |
| Scheduler/cohort/Pre-AI | max pending entries, position slots, reservation count, daily drawdown/loss/circuit-breaker risk pause, Human managed caps, committed risk margin-tier coverage |
| Risk headroom/readiness | Gross, Direction, Cluster/Cluster Direction, per-trade risk, daily drawdown, UNKNOWN/pending risk refusal, missing/unavailable risk admission and risk-profile authority |
| Primary prompt | TESTNET_FUNDS_ONLY explicitly forbids portfolio/history/UNKNOWN/Human risk from causing model veto or risk-driven sizing/direction; market judgment remains autonomous |
| TradePlan | Missing/incomplete/throwing risk snapshot remains null; no fabricated proven ticket or snapshot; plan parameters and durable identity still validated |
| Reservation | No portfolio-risk gate/ticket/binding requirement, generation/profile/snapshot risk veto, historical underlying lock or count limit; atomic fresh private-funds check remains |
| Final submit/reprice | No same-underlying inventory/pending-order veto, position count or human-exit-goal veto; actual funds, filters, frozen authorization, identity and exchange restrictions remain |
| Funding arithmetic | Remote accepted/UNKNOWN historic claims are not a second debit of exchange availableBalance. Live unsubmitted local promises and active model execution leases still reserve real funds. A reservation does not double-debit itself at final headroom. |

Risk ledger, stress, ownership/UNKNOWN history and raw diagnostic verdicts remain available and are not relabeled verified. Observed risk events carry entryVetoEnforced=false. Production retains legacy risk enforcement. New decisions may add to an existing holding; the same Primary run and same plan cannot create duplicate intents/reservations. Same UNKNOWN order identity remains unretryable until reconciliation.

## Retained conditions

The sole Entry *resource* constraint is actual available quote funds/margin, including live unsent local commitments. Exchange symbol/quantity/price filters, supported quote assets, leverage validity and exchange rejection remain. Execution correctness still requires fresh private account/market facts, valid and unexpired model authorization, immutable quantity/price bounds, durable plan/order storage, unique decision/intent/clientOrderId and TESTNET write permission. Manual pause and independent model market decisions are unchanged; no PLACE or fill is manufactured.

## Local verification

- npm run verify: PASS, exit 0. Includes dependency build, scripts/self-tests, workspace typecheck, formal workspace build and all tests.
- Engine: 177 files / 1503 tests; core: 8 / 58; dashboard: 14 / 65.
- New testnetFundsOnlyEntry.test.ts: 9 hostile/positive/negative tests, all pass in full verify. Real EntryCoordinator path to a mocked exchange adapter passes despite a huge existing holding, UNKNOWN historical order/reservation, zero risk caps, missing coverage and denied/missing/throwing risk service. Fresh-funds loss before submit still blocks; stale private facts block; repeated decision identity does not submit twice.
- Legacy risk arithmetic coverage remains in isolated pure non-TESTNET tests; no Production network calls occur.
- S00: PASS, 6 checks, 177 test files, isolated storage-opening tests, no repository live-data/production-port test references. New read-only readback entrypoint was added to the derived inventory (142 entrypoints).
- Storage: S08_STORAGE_COVERAGE_PASS with --verify-backup self-test.
- git diff --check and syntax checks for new/updated readback scripts: PASS.
- GitHub hosted CI: NOT_RUN (local verification only, commit uses skip ci).

Initial failed runs are retained as evidence: failures were legacy TESTNET-veto expectations, an identity retry gap caught after removing occupancy, and missing compiled worker before build. S00 initially identified the new script missing from its inventory; inventory regenerated and passed. Final verify log is authoritative.

## Initial runtime evidence

before.json: actual Engine PID 25520, build 3.9.6-a89009a8d51573218981, scheduler running, capital had 10 routes but capacity first blocker RISK_ADMISSION_UNAVAILABLE; no Pre-AI envelopes in that instance window. This proves route availability alone did not enable Entry.

## Deployment closure

PROVEN loaded: authorized one stop and one MANUAL_START on canonical main. Source commit 673a2c1, evidence-normalization commit a33b94b. Canonical formal build passed. PID 10480, instance 2cac26f8-587d-4757-a631-db0461ca90a4, build 3.9.6-8349d66ab6af161e855d, started 2026-09-28T07:01:55.575Z. Source SHA256 e659b3930457663543093a2f7fbc2302aa8862f1847c8af4be9e54b05b5c534f; artifact SHA256 8349d66ab6af161e855dc23d27abc583d4b2096cf1d7f034903a9735850fc389. Local runtime/source/artifact identity checks pass; remote equality is closed by the subsequent evidence push and identity-closure.json.

Official SQLite backup completed while stopped for both durable databases: integrity checks and per-table counts match. Actual backups stay under ignored data/backups; only verification metadata is committed. The older stage6 preflight refused TESTNET_ENABLED because it requires READ_ONLY; no Settings change was made to bypass it.

Runtime readback: TESTNET_FUNDS_ONLY, portfolioRiskVeto=false, pipeline RUNNING, authoritative blocker NONE, noEntryReason null, both sides executable. Boundary remains TESTNET / TESTNET_ENABLED / lockedToTestnet=true, productionWrites=0. Risk counters remain visible and do not become capacity blockers.

Natural execution evidence at 2026-09-28T12:13:26.635Z: retained current-instance events contain 109 submit attempts across 103 distinct local order IDs and 85 distinct exchange order IDs. These are retained-event observations, not guaranteed full-window totals: live event retention can remove older rows while auditing. No forced candidates/orders or fabricated fills were used. There are 145 retained portfolio-admission observations, all explicitly entryVetoEnforced=false.

Concrete connected chain in runtime-blocker-audit.json: APTUSDT / airun_mul7ego5_7h2mqprt -> PLACE_SHORT -> risk allowed=false with PENDING_RISK_UNVERIFIED, POSITION_FACT_UNVERIFIED, incomplete snapshot and STRESS_LIMIT:MAX_GROSS_NOTIONAL -> observational entryVetoEnforced=false -> plan_de02fcc598b437cddaa6aa07a970a06a -> reservation -> intent_mul7fqbj_h64h7a1t -> TESTNET submit -> exchange order 480536954 WORKING, followed by natural fill-reconciliation events. This proves actual Primary-to-submit execution despite live non-funding risk refusals, beyond mocked tests.

Retained BLOCKED events have no portfolio/history-risk refusal. Reasons are JIT market-quality rejection (21), stale market data (5), exchange Post Only -5022 rejection (3), unavailable private account (2), and quantity below the exchange legal minimum (9 at the later audit; 10 in the earlier snapshot before retention). Market quality is the existing liquidity/spread/asset-selection strategy filter, not a holding-risk alias; it remains alongside independent model market decisions. Fresh private facts, immutable authorization and idempotency remain execution-correctness requirements. No claim is made that every candidate must trade or that future exchange/data failures cannot occur.

Evidence text has trailing whitespace normalized only (command content, outcomes and failures retained). Source diff check passed before commit; staged evidence whitespace was then corrected before main promotion.

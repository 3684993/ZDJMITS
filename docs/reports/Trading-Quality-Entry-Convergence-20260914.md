# Trading Quality: Entry and evidence convergence

## Scope and source gate

Accepted base: `e0e8d6a01428aaeebb38df426a7e05fa88639e82`.
Reviewed Trading Quality starting point: `a9a0623b62cdb0a587427739a8602dd7052c88bb`.
Branch: `trading-quality-stage1-3-20260914`; PR #1 remains Draft.
Work was performed in `D:/MITS-trading-quality-convergence`, a separate worktree.
The accepted checkout, running Engine, exchange orders and real trading SQLite were not changed.

`npm run verify`: PASS (exit 0).

| Check | Result |
|---|---|
| Dependency builds and script syntax | PASS |
| Script tests | 15/15 |
| Workspace typecheck | PASS |
| Workspace build | PASS |
| Core | 8 files, 46/46 tests |
| Dashboard | 7 files, 15/15 tests |
| Engine | 84 files, 463/463 tests |
| New Trading Quality integration suite | 20/20 tests, included above |

Build/tests used this isolated checkout and fixture/temp databases. No natural exchange execution was performed. This is an engineering source gate, not an economic acceptance result.

## Findings and corrections

The starting commit added pure Episode functions and a CLI, but no runtime collector or Opportunity enforcement. Its path code admitted sparse and immature windows to MAE/MFE statistics. Its CLI treated the presence of a mark table as evidence of usable coverage and reconstructed candidate counts without a prospective candidate journal. Completion could be inferred from one FILLED order despite incomplete fill details.

The CLI is replaced with a read-only report over the prospectively populated evidence store. Missing history is not manufactured. Path metrics require horizon maturity and a maximum observed sampling gap of five seconds. Immature/sparse windows retain sample counts and provenance but do not enter complete-window distributions. Full-fill time requires exact cumulative trades for every associated order. First-fill anchoring remains independent of subsequent VWAP.

Position accounting previously aggregated entry fills by symbol/direction and selected closing fills by time range. These evidence joins now use explicit order/fill ownership. Reopened positions with the same remote ID receive distinct persisted cycles; closed records are retained. This is an accounting/evidence correction, not a new position or exit action.

## Actual authorization wiring

1. `EntryCoordinator.analyze` runs existing data, permission and capital preflight.
2. For SHADOW/ENFORCE it builds deterministic `OpportunityEvidence` before calling Primary and emits `TRADING_QUALITY_OPPORTUNITY`.
3. In ENFORCE, the packet and Primary prompt contain the evidence. `entryDecisionParse` verifies the selected setup, direction, exact timing event and contained price band. The coordinator independently verifies the returned choice.
4. WAIT saves no EntryIntent. `processPool` wakes on the bounded price condition or a new allowed event and requests a new Primary decision. A new PLACE is required.
5. An accepted PLACE carries the complete versioned evidence in its persisted EntryIntent and the existing execution journal. Allocation and reservation remain in their original path.
6. `executionHardBlock` adds opportunity checks to the existing final risk checks. It is called by initial submission, authorized execution-range waiting, post-only retry and pending repricing.
7. `reviewPending` additionally cancels stale/invalid opportunity orders even when no further reprices are permitted. Occupancy is released only after confirmed terminal cancellation; UNKNOWN is retained.
8. `submitExactlyOnce` remains the sole Entry placement function. Recovery queries the existing client identity and does not treat expired strategy permission as proof that an earlier submission did not occur.

`WAIT_FOR_PRICE` is a model wait with no order permission. `WAIT_EXECUTION_RANGE` is an already-issued PLACE awaiting execution; it can resume only while its original authorization and opportunity remain valid. They are intentionally not interchangeable.

## Evidence and policy

`packages/contracts/src/opportunity.ts` owns the shared schema. Evidence contains content-derived identity/version, policy version, 15m direction/structure, verified timing event, price band, target, fees/buffer, disposition, release condition and three separate time fields.

The initial machine-verifiable event profile is a closed 1m/5m directional EMA reclaim (`TREND_PULLBACK`). Other model-declared setups cannot authorize entry through ENFORCE without matching deterministic evidence. This is a deliberately limited event profile, not a claim that all market opportunity types have been statistically calibrated.

The policy is `settings.tradingQuality`; absent configuration resolves to `mode=OFF`. Supported modes are OFF, SHADOW, ENFORCE. No settings were enabled in the user's running Engine. Built-in TTL/location/boundary defaults are uncalibrated experimental settings, not approved profitability thresholds. They must be frozen with the acceptance specification before an authorized ENFORCE trial.

The fingerprint includes policy contents, event, structural anchors, band and costs. Revalidation checks the sealed contents and current facts, original expiry, correct planned price, remaining cost-adjusted target space and proposed quantity against observed depth. It never extends old authorization merely because price is repriced.

## Prospective runtime collection

`AppRuntime.createInternal` attaches `TradingQualityCollector`; its runtime timer samples quote facts every second and materializes Episode projections every five seconds. The collector subscribes to real Primary/Entry/fill/trade/reconciliation events. It does not need the report command to produce data.

The additive `dataDir/trading-quality.sqlite` database has its own idempotent migration and WAL. It archives scoped candidate observations, versioned opportunities, Primary links, intent/order/fill identities, cycles, trade records, reservations and sampled quote paths. The scope separates exchange environment and credential reference. Original opportunity versions are immutable; later observations are stored separately. Raw funding account events are also recorded.

Quote exchange timestamps are used for path samples. Repeated reads of a cached quote do not create new observations or fill gaps. No forward paths are synthesized after downtime. Journal-carried opportunity identity survives restart. The evidence archive survives trimming of runtime maps and reopening of the collector database.

An isolated integration test sends actual `PositionService.recordExchangeFill` events through the collector, including duplicates and partial/full completion, samples successive quote timestamps, verifies persisted Episode MAE and first-fill prices, then reopens the database and verifies the original identity.

Storage failure is observable. ENFORCE rejects new entry authorization if collection is unavailable. OFF does not gain a trading veto from this observational service. UNKNOWN/submitting tasks are not released on an evidence failure.

Read-only interfaces:

- `GET /api/observability/trading-quality` (under the application's API mount).
- `npm run audit:trading-quality -- --db=<dataDir>/trading-quality.sqlite`.
- Optional CLI `--scope=<scope>` selects one account/environment scope. No mandatory 30-day wait/window.

The report includes horizon MAE/MFE/markout distributions, observation coverage, first/full-fill evidence, event age at fill, maker-fill count, fill-to-ideal deviation, immediate mark/spread/fee attribution with sampling delay, time-to-positive, source/completeness labels and candidate/Primary/intent/order/filled-order counts. A table's existence is never sufficient for BASELINE_READY.

## Facts intentionally left unavailable

- Historical short paths that were never sampled, event ordering within an OHLC bar, and unproven order/fill/cycle ownership.
- Exact episode funding allocation where the exchange account event does not identify the owning cycle. Account funding facts do not authorize symbol/time-based allocation. Funding UNKNOWN is not zero.
- Cost-adjusted time-to-positive without a complete contemporaneous cost basis; gross/price observations remain separate.
- Exact intratick extrema or maker queue position. Reported excursions are sampled quote/mark observations with an explicit coverage criterion, not continuous exchange-path truth.
- Natural Testnet profitability, adverse-selection improvement and calibrated opportunity thresholds. No new strategy has run on the real Engine during this work.

FETUSDT and other unresolved exchange facts retain their existing fail-closed ownership and risk treatment. Raw/external/unlinked fills remain visible, not silently converted into completed system episodes.

## Safety and next acceptance

No Profit Realization, AUTO_STOP_LOSS, TP strategy change, Turnover Optimization or automatic learning was introduced. Existing 15m direction, risk headroom, final risk checks, unique submission, UNKNOWN, TP and reconciliation regressions passed. Primary remains the only entry model; Scout is not reinstated.

The next operational step requires the user to deploy/start the revised Engine manually under the existing lifecycle policy, initially with SHADOW, confirm prospective collection/coverage, freeze the economic experiment specification, and explicitly authorize a small Testnet ENFORCE trial. Compare actual fill latency, markout, MAE/adverse-first, opportunity expiry, non-inferior effective fills and safety outcomes. Inadequate samples are INCONCLUSIVE. Rollback does not clear the evidence DB, trading DB, journal, orders or UNKNOWN facts.

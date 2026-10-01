# V3.9.7 Core Economics Immediate Implementation Result

Date: 2026-10-01 (Asia/Shanghai)  
Repository: `3684993/ZDJMITS`, `main`  
Current instance: `D:\MITS`, TESTNET  
Implementation code SHA: `6a128fbd7bbb1614aa0cd0eb550a88a614784952`  
Implementation basis: `docs/prompts/v397-core-economics-immediate-implementation-20261001.md` and `docs/reports/v397-current-instance-differential-optimization-20260930/IMPLEMENTATION_PLAN.md`.

## Result

The current mainline implementation now enforces configured quote-specific business floors in the executable envelope and again at final JIT pricing. A below-floor candidate cannot fall back to exchange minimum size. Entry economics, direction facts, TP economics, and bounded online Review/Exit management are wired through the Settings schema/migration, API, dashboard projections, and tests.

The implementation and final JIT repair are pushed to `main`. TESTNET is running the final code build below. Natural readback shows READY service, healthy market/private facts, scheduler heartbeats, 29/29 current positions with TP protection, and zero Production writes. No Entry/TP fill/new Exit was manufactured to satisfy this check. Final-build natural Entry submission/fill and completed Exit remain `UNKNOWN` because this run had no dispatchable executable candidate.

## Implemented

- Added versioned `V397-ENTRY-ECONOMIC-MANDATE-1` sizing/economic facts: quote asset and FX, Settings version, selected units/notional/initial margin/leverage, exchange filters, fee/slippage/funding coverage, direction evidence from closed 1d/4h/15m bars, TP target, horizon, and one-hour reachability evidence.
- TESTNET pre-AI sizing uses the effective user floors to form a finite legal envelope. Quantity, side, price and target remain bound through TradePlan, reservation/intent, JIT and adapter facts. The final JIT check re-evaluates actual quote notional at the intended entry price, initial margin from actual quote notional/leverage, exchange minQty/minNotional, fee-adjusted minimum net profit, and quote/USD conversion. Any unmet floor blocks; the code does not clamp down to exchange minimum or silently resize.
- Added regression cases for price movement below minimum business notional and for insufficient initial margin. The final economic gate blocks expected net profit below the configured `$1` target. USDT uses the declared USD quote policy; USDC requires a fresh timestamped USDCUSDT observation and otherwise fails closed.
- TESTNET migration/schema version 14 added a one-time `economicPolicyVersion` migration. It fills required per-quote Settings from the current TESTNET configuration semantics: `portfolioIntelligence.minMarginUsd=1` supplies the initial-margin floor; `portfolio.entryMarginUsd=200` is treated as the single-entry business notional budget floor, not as initial margin. `baseMarginUsd=200` remains a capital-planning value. Migration enables economic admission, Position Review and enforced AI Exit without rewriting later operator edits.
- Reconciliation exact Entry lookups are limited to eight per pass. Work left outside the pass remains UNKNOWN and risk-bearing until later evidence; the cap avoids serially holding startup behind the entire historic UNKNOWN inventory.
- Scout no longer blocks the Primary path. Primary execution uses structured market facts; higher-timeframe direction facts and their freshness are part of the mandate. Gross/direction/cluster/stress/human/position-count observations are not a TESTNET side/quantity sizing authority.
- TP protection is distinct from TP economic quality. TP selection carries fee/ROI floors, reasonable target structure and horizon/1h reachability facts; protected does not imply economically worthwhile.
- Online lifecycle Settings activate Position Review and enforced AI Exit, with bounded review budgets, reduce/exit/handoff outcomes and 24-hour handoff timing. Existing reduce-only, identity, cycle and reconciliation boundaries remain in force.
- Settings governance/readback and Dashboard projections expose the new per-quote floors, economic admission and the existing TP/position/exit truth fields.

## Live TESTNET Settings and migration readback

Observed at the final API readback (`settingsVersion=228`, `economicPolicyVersion=1`):

| Setting | Effective value | Source/meaning |
|---|---:|---|
| Minimum initial margin | `USDT 1`, `USDC 1` | Existing `minMarginUsd=1`, represented in each quote unit; USDC USD equivalence remains FX-dependent |
| Minimum business order notional | `USDT 200`, `USDC 200` | Existing single-entry `entryMarginUsd=200` budget semantics; this is not the initial-margin floor |
| Minimum net profit | `$1` | Existing `takeProfit.minNetProfitUsd` |
| Minimum net ROI | `0.15%` | Existing `takeProfit.minNetProfitRoiPct` |
| Economic admission | `ENFORCE` | One-time TESTNET migration |
| Position Review | enabled | One-time TESTNET migration |
| AI Exit | `ENFORCE`, small-loss exit allowed | One-time TESTNET migration; loss/handoff limits remain explicit |
| Automatic handoff | `1440 minutes` | Existing `positionManagement.humanHandoffAfterMinutes` |

Schema migration 14 is present in the live Settings database. The quote-specific fields are non-null and returned by `/api/v3/settings`. A fresh USDC conversion is still required per mandate; missing/stale FX blocks that quote instead of assuming exact parity.

## Verification

- `npm run verify`: PASS on code SHA `6a128fbd7bbb1614aa0cd0eb550a88a614784952`; scripts, workspace typechecks, builds and suites passed. Contracts/core: 8 files / 58 tests; Dashboard: 21 files / 110 tests; Engine: 187 files / 1,654 tests.
- `node scripts/v396-s00-static-check.mjs`: PASS, S00 T01–T06; no blockers, no network, no exchange writes, no Settings mutation.
- `node scripts/v396-durable-schema-roundtrip.mjs D:/MITS/data`: `DURABLE_SCHEMA_ROUNDTRIP_OK`, read-only; 29 positions, 1,807 Entry orders, 1,866 intents, 1,019 TP orders, 42 manual orders, 579 trade records and 5,000 execution fills parsed with zero schema issues.
- Hosted CI/GitHub Actions were not run.

## Final runtime identity and natural readback

- Final runtime: PID `40684`, instance `b38149ac-cae6-483e-abd1-cb247e79e2be`, `MANUAL_START`, TESTNET, build `3.9.6-6f8ad9fe2824196a6c31`.
- Runtime artifact SHA-256: `6f8ad9fe2824196a6c31b84314c3dff4f9fa78938d1f60b4ee346f25a0ed5729`; source SHA-256: `761da1681db1923b43b5e763f445ec488b882a20d6a15058818b0e997029d8f9`.
- `/health=READY` (HTTP 200), market stream `LIVE`, private account `READY`, runtime mode `RUNNING`, scheduler `RUNNING`; reconciliation completed. Identity script verdict `IDENTITY_CLOSED`, all six source/artifact/build/runtime/HEAD/clean-tree checks true.
- `/api/v3/diagnostics/closeout`: environment `TESTNET`, `TESTNET_ENABLED`, locked to TESTNET, `productionWrites=0`, blocked Production attempts `0`, `testnetWrites=0` at readback.
- Current position/TP projection: 29 positions local and remote; TP coverage `HEALTHY`, 29/29 protected, 0 missing/unresolved/unverified, 0 quantity/side mismatches, no repair retry backlog.
- Review/Exit projections: Review `HEALTHY` and enabled, AI authority `ENFORCE`; all 29 current exchange positions read `HUMAN_MANAGED`, so this snapshot had 0 automatic review cycles due and does not prove an auto-managed position was exited. There were 28 open exit-convergence tasks (20 eligible at the final projection); these are existing managed/recovery facts, not 28 completed new exits.
- TP readback separates protection from economics: 29/29 are `PROTECTED`; 1 position reports `TP_OK`, while 28 positions have `tpEconomics=null` and therefore economic quality remains UNKNOWN. This readback does not reinterpret missing historical facts as profitable targets.
- Dispatch heartbeat is fresh and scheduler status is `RUNNING`. Its current suppression is ordinary `AI_BUSY` while Primary processes a candidate (the prior cycles reported `NO_EXECUTABLE_CANDIDATE`); heartbeat age is 0 ms at readback and the execution readiness projection is `READY`.
- Final-build natural economics readback after `startedAt=1790869141709`: four completed Primary decisions and one running decision produced four JIT economic admission refusals. ENAUSDT had expected net `$2.63` but notional `$199.297`, so `BUSINESS_MIN_ORDER_NOTIONAL_UNMET`; ETHFIUSDT had expected net `$1.69` but notional `$199.737`, same refusal; ETHUSDT had expected net `$0.948` against `$1`, so `ECONOMIC_MIN_NET_PROFIT_UNMET`; BTCUSDT had expected net `-$0.178` and a wrong-side TP, so both blockers were reported. None created an Entry intent/order/fill. The AAVEUSDT Primary decision was still running at capture and is not counted as complete.
- The final-build observation window has no `ENTRY_ORDER_CREATED`, `ENTRY_ORDER_SUBMITTED`, `ENTRY_FILLED`, `TP_FILLED` or `POSITION_CLOSED_USER_DATA` events. This is not treated as a missing test to be filled artificially: the natural attempts above directly verify the notional and net-profit refusal paths, while current TP readback proves existing protection. No artificial order or fill was created.

## Remaining UNKNOWN

1. A final-build natural Entry → remote fill → TP → Review/Exit completed chain: `UNKNOWN` (natural Entry candidates were correctly refused by the economic contract; no final-window Entry submit/fill or completed exit occurred).
2. Natural final-build TP fill and post-exit ledger/cycle closure: `UNKNOWN`; current readback proves 29/29 TP protection, not a new TP execution.
3. Current portfolio is entirely HUMAN_MANAGED, and 28 current TP economics projections are absent; automatic Review/Exit behavior on a fresh AUTO_MANAGED lifecycle is therefore `UNKNOWN` in this runtime readback. The implemented lifecycle is enabled for eligible automatic cycles and retains the human ownership boundary.
4. Live USDC/USD conversion coverage for a future candidate: fact-dependent; if the fresh USDCUSDT quote is absent/stale, USDC Entry is refused.
5. Historical Entry UNKNOWN: 173 retained; 149 still counted as active risk at final reconciliation readback. One manual UNKNOWN remains; TP UNKNOWN is zero. Evidence-backed no-risk proofs update occupancy, but UNKNOWN history is not deleted or generalized into the new sizing authority.
6. Funding coverage, one-hour empirical reachability and long-horizon profitability remain sample/fact-dependent. They are not used to waive the deterministic `$1` net floor or to manufacture orders.
7. Raw adapter wire bytes remain unavailable; structured request/response identity and exact quantity/side/price readback remain available.

The report commit is a documentation-only descendant of implementation code SHA `6a128fbd7bbb1614aa0cd0eb550a88a614784952`.

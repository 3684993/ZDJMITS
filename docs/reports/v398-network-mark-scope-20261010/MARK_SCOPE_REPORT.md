# N2 retained-symbol mark stream — offline receipt (2026-10-10)

## Result and bounds
Equal-cadence markPrice subscriptions now follow the existing retained-symbol set. PUBLIC all-market bookTicker and MARKET all-market discovery ticker remain unchanged. No live deployment, Engine/proxy/model restart, Settings/authorization/private database/task/observer change, exchange order or TP mutation was performed.

Baseline provenance is PR #25, docs/reports/v398-network-optimization-20261010/NETWORK_BASELINE.md and sanitized JSON. Two disjoint 60-second windows retained 44/46 symbols; global book/mark/ticker classes contributed 79.49%/79.89% of decoded application bytes. This is a class share, **not a savings estimate**. Per-symbol irrelevant-message share, SSH wire bytes/backlog and post-deployment traffic/Primary supply remain UNKNOWN. Do not infer HTTP 451 cause from public HTTP 200.

## Minimal change
BinanceMarketStream.desired(MARKET) requests symbol@markPrice@1s alongside the existing three klines and aggTrade for each retained symbol; ticker remains global. This preserves the official one-second cadence. MARKET count is 5*N+1. For N>204, the pre-existing global mark subscription is retained, with 4*N+2 streams; N=205 is tested at 822 streams. Existing fallback itself exceeds the official 1024-per-connection ceiling above N=255; protected sharding is a remaining requirement, **not claimed solved**. No protected symbols are evicted to meet the limit.

At observed N=44/46, counts become 221/231 MARKET streams. The prior pacing fixture's 175-symbol MARKET count becomes 876 (nine control batches), PUBLIC remains 176. The official limit applies per connection, not to the sum of separate PUBLIC and MARKET connections. The existing <=3 control sends/second/lane test remains enforced.

MarketCohort.runtimeRetentionSymbols() remains the owner: cohort, hydrating, pool residents, positions, operational entries, active candidate lifecycles and BTC/ETH context. This PR changes no admission, origin, TP, candidate TTL, UNKNOWN or private freshness behavior.

## Reproduction and regression
red-before-fix.log records 2 failed/2 passed before source edits: marks were still global and ownership changes did not update mark scope. focused.log records 5 files/48 tests passing, covering stream pacing, retention/ownership, quote facts and slow-field freshness.
Synthetic shadow replay feeds a 64-symbol array versus the two retained individual mark events into the same consumer: retained last/mark/bid/ask facts match and fixture decoded bytes decrease. Six-second-old marks still reject quotes even when book/ticker refresh. Synthetic reduction is **not** measured live savings, SSH wire reduction, a 3–5-minute Primary SLO, or signed TP proof.
The official Demo MARKET symbol@markPrice@1s route received 13 typed events in PR #25's bounded 15-second same-proxy subscription-only probe. Private Demo authenticated event delivery remains unprobed.

Full npm ci / npm run verify outcome is recorded in VALIDATION.json and full-verify.log after completion; exact-head hosted CI receipt is posted on this PR. Four pre-existing dependency advisories (2 moderate, 2 critical) were reported by npm ci; no force upgrade was attempted.

## Actual acceptance state
The original 24-hour observer aborted at 2026-10-10 08:34:00.270+08:00 with ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED, local TP14/15. Later local17/17 cache recovery is not signed exchange-wide proof and does not resume this window. Abort evidence remains immutable in PR #25. This PR does not start a new acceptance window.

## Pending
Post-authorized-release same-route A/B traffic/quoteFresh/Kline/Primary-supply and all-current-position signed TP evidence; authenticated PRIVATE Demo lifecycle/duplicates; ACK/NAK/depth contract and recovery-storm work; shared REST/socket observability; Issue #23 exact partial-fill versus independent-origin attribution. No claim that 451 or all network congestion is fixed.

Official contracts:
- https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect
- https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice

Related independent PRs: #25 official WS routing; #27 recvWindow and official request weights. This PR has no dependency on either source change.


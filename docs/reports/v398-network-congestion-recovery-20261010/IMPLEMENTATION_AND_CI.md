# PR42 field repair and verification

The original head c9cd14c572851dda581cc84d66a3ddbfd4d0ed9d has hosted Actions38057726621 SUCCESS. This success does not apply to the new repair head.

## Source repair

- Separate requested and exchange-confirmed subscriptions; exact request ID/null result ACK advances one bounded control command. Unrelated ACKs do not advance state. A missing ACK tears down the socket and uses existing bounded reconnect backoff.
- Replace unsent churn with the latest target; unsubscribe acknowledged old streams before additions. One outstanding wire command per connection, minimum350ms between controls, batches100.
- Preserve all retained symbols across MARKET connections of160 symbols/960 streams. PUBLIC connections hold at most1023 depth streams plus one global bookTicker on the first connection. No MARKET all-market fallback, silent omission or >1024 subscription.
- Release excess connections on cohort shrink. Traffic remains grouped by PUBLIC/MARKET with per-connection ACK diagnostics. Decoded payload is not SSH wire traffic.
- Depth REST recovery uses maximum2 concurrent calls, minimum500ms between starts, per-symbol deduplication and existing60s cooldown. Reconnect preserves active flight ownership; stop invalidates late results.
- Discovery REST60s cache and single flight, quote per-field timestamps, candidate retention, Primary, NO_ADD, HUMAN_MANAGED and Production boundaries remain intact.

## Local verification

Locked npm ci PASS. Focused stream/provider43 tests PASS, including loopback real WebSocket disconnect/re-subscribe, unmatched/missing ACK, rapid disjoint cohort churn, cohorts160/161/191/192/239/255/256/1024, recovery storm, freshness and discovery.

Full npm run verify:ci EXIT0: S00T01..T06, script regressions, release identity, typecheck, production build; contracts2/core63/dashboard151/Engine2020 =2236 tests across268 files. Full log: full-verify-ci.log (force-added despite repository log ignore). Later diagnostic entrypoints require current S00 recheck.

## Actual bounded same-route WS smoke

Two symbols,20s; PUBLIC3/3 and MARKET12/12 exchange ACKs, no reconnect or control error. MARKET ticker and mark events received; no global MARKET streams. PUBLIC global !bookTicker produced1393 events/233739 decoded bytes; one retained symbol bid/ask stale at snapshot. This is not matched natural Engine load or 30+90 acceptance. Existing configured WS route worked in this sample; no endpoint change is justified by a presumed failure.

## Private gate

Original read-only batch got HTTP200 time/mode/positionRisk/openOrders/openAlgoOrders and HTTP400 account. Sequentially signed5s recvWindow audit then got HTTP200 through openAlgoOrders, but account response body exceeded the8s diagnostic deadline. Gates UNKNOWN; no Engine/automatic Entry started, no TP mutation or task exchange write. Exact order payloads and secrets were kept out of evidence.

Hosted new-head CI, main merge and host deployment: PENDING.

Official contracts reviewed: [1024 streams and split routes](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect), [matching request IDs and null ACKs](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Live-Subscribing-Unsubscribing-to-streams).

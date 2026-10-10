# N3 independent signed-timing repair and congestion regression

Base main3cb72de, separate worktree/branch `codex/v398-network-n3-recvwindow`; no dependency on N1 PR25, no deployment/lifecycle/Settings/authorization/proxy/SSH/private DB mutation. N0 current-runtime baseline remains PR25 docs/reports/v398-network-optimization-20261010; reusing timestamped evidence is not a second baseline or a before/after performance experiment.

## Reproduced defect and correction

ExternalTradeAdapter.signed used `min(60000,max(configured,60000))`. For every valid project setting1000–60000 it sent60000, including default5000. New memory-only transport tests inspect the actual signed query, timestamp/clock offset and HMAC, rather than merely testing an arithmetic helper. **Before fix:10 failed/7 passed of17** (four incorrectly widened valid/default cases and six invalid inputs reaching the transport). Raw `red-before-fix.log` preserved.

Fix uses the configured integer as recvWindow; invalid/non-finite/out-of-range values fail before the clock, network or exchange write boundary. Configuration5000 now signs5000; explicitly configured60000 remains60000. Zod valid range1000–60000 and default5000 unchanged. No private fact TTL, TP threshold, risk gate, host, egress, socket/queue limit or backoff interval change. This is a timing security correction, **not a claim of improved throughput or resolved451**. Slow queues can still reject5000ms requests; fix those stages rather than silently granting60000ms.

[Official timing contract](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info) makes recvWindow a signature-validity window and specifies default5000; serverTime offset remains independently synchronized. It is distinct from SOCKS/TLS timeout and60s private-fact freshness. Existing bounded -1021 clock resync/retry remains unchanged; unknown503/network failures are not -1021.

## Regression and boundaries

Tests cover default/1000/5000/12000/60000 query values, actual HMAC and+250ms clock offset; NaN/infinity/zero/negative/fraction/>60000 reject before any transport operation. Simulated in-memory POST failures451/429/418/502/503-unknown/SOCKS8000ms each preserve the error and dispatch exactly one order request, no alternate host or automatic blind retry. These are unit mock calls, zero real exchange orders/fills/network/DB writes. Existing higher-level exact identity reconciliation/UNKNOWN recovery remains authoritative and unchanged.

Focused congestion suite additionally runs actual loopback SOCKS/connection-reuse fixtures and requestBudget tests: background single-slot, private/control reserve, saturation/cancellation and429/418 recovery remain enforced. A loopback reuse result does not prove every production Transport shares one pool or quantify the real SSH wire backlog. No admin shell opened on the dedicated MaxSessions0 account; no VPN script/server setting changes without a reproduced technical defect.

Final npm ci/full npm run verify, S00/PowerShell VPN mock and exact PR-head CI evidence recorded separately in VALIDATION.json and PR Conversation. Four pre-existing dependency advisories remain; no force audit upgrade or gate weakening. N2 per-symbol BBO/mark bandwidth implementation and N3 ACK/depth/listenKey/dedup/shared-agent/budget-weight refinements remain next independent work. Do not label all N0–N4 complete.

## Actual acceptance exception retained

Original runtime23688/bb45 attempt aborted at08:34:00.270+08 localTP14/15. Later local17/17 snapshot is not a new signed audit, automatic resumption or PASS; see PR25 immutable abort evidence and Issue22 comment6091779048. Issue23 ENA origin attribution is not resolved by these timing tests. Runtime protection remains running. Any subsequent deployment needs a separate user instruction and formal safety/identity preparation; after repair/release verification start a full new24h, never borrow this aborted window.

## Official REST weight corrections in the same independent N3 PR

Fresh official USD-M Account spec https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account lists leverageBracket IP weight1 and commissionRate20; code used30 for both. A dedicated no-network query-weight regression reproduced2 failures/4 preserved heavy-endpoint passes. Fix only these two estimates, preserving multiAssetsMargin30, positionSide/dual30, income30 and whole-account openOrders40. Budget ceilings, six-slot admission, private/TP reserve, rate-limit response-header authority,429/418 cooldown and no-POST-retry policy unchanged. This avoids a proven accounting overestimate, not a measured production throughput improvement. Source priority classification remains private; no schema/default/Settings change is needed. Original red evidence and timing-only full pass retained. Final suite re-run includes both fixes.
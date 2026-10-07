# Active remediation: integration and pre-deployment gate

The human instruction on 2026-10-07 overrides the old 6/12h deployment gate. Obsolete hourly heartbeat paused; owned collector35268 stopped without touching Engine. The old window is preserved independently:240 samples,3.983189h,private READY75/explicit UNAVAILABLE143/observation gaps22. It failed and is not an acceptance window.

Latest main b92a4882090ee0c8ebecc1740bec3703621ad81b and candidate0737e6649dd9c0754c4238bc3a860ec786487a0a merged with ordinary Git history; no rebase/squash/force. Candidate fixes actual SOCKS keep-alive, old-route idle retirement, per-request negotiation deadline and single settlement/cancellation. Existing F01/F02/F03/F05/F06/F07/F08 implementation retained.

Additional source audit found historical allOrders/risk-history and HISTORICAL_REPAIR timeouts still qualified for NET-002. Classification now excludes historical source/purpose from timeout/network bursts; actual HTTP429/418/451 remain visible, current-account bursts remain critical, and stale private facts still block independently. Two regressions prove history vs current purpose and real rate-limit preservation.

F07 readback now separates unique identities attempted from identities with successful exact fact progress. Counts are tied to durable identity; failed reads do not count as progress. Oldest pending UNKNOWN/deferred age and per-class retry causes remain visible, with no synthetic risk release. Existing six-identity rotation regression validates retry/backoff readback. First targeted run exposed the test's incorrect expectation that all six current reasons stayed EXACT_QUERY_FAILED; three were correctly BACKOFF_OR_PROOF_TTL on the second run. Corrected expectation passes75 tests/4 files. Full integrated verify result pending below.

F01 independent timestamp/monotonic guards, F02 exact terminal + partial quantities/durable reducer identity guards, F05 private reserve/lane isolation/cancellation, F06 required mark purpose vs optional derivative context and bounded hydration, F08 one transition/one recovery already correct and covered in full verify. Natural F02 lost-ACK terminal runtime evidence remains UNKNOWN without such an event.

No strategy/Settings/proxy/database reset or exchange-write probe. Preserve dirty D:\MITS. Only8080 may be redeployed; models12732/17468/51124 retained. F04/F10/F11 deferred. After local gate, promote main, manually deploy only8080 and evaluate an independent10–30min short feedback window. Deployment alone is not success.

## Integrated local gate

Full npm run verify exit0:1976 tests/232 files (Contracts2/Core58/Dashboard123/Engine1793), release/script/S00/typecheck/build PASS. Full log full-verify.log; targeted75 PASS; git diff --check PASS. No GitHub Actions. Independent curl GET /fapi/v1/time through current SOCKS proxy timed out before HTTP, exit28 after10012ms; this is a remaining-path observation, not attribution to Binance. Details retained. Candidate is ready for authorized only8080 cutover; runtime acceptance PENDING.

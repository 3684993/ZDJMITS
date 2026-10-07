# Active remediation: integration and pre-deployment gate

The human instruction on 2026-10-07 overrides the old 6/12h deployment gate. Obsolete hourly heartbeat paused; owned collector35268 stopped without touching Engine. The old window is preserved independently:240 samples,3.983189h,private READY75/explicit UNAVAILABLE143/observation gaps22. It failed and is not an acceptance window.

Latest main b92a4882090ee0c8ebecc1740bec3703621ad81b and candidate0737e6649dd9c0754c4238bc3a860ec786487a0a merged with ordinary Git history; no rebase/squash/force. Candidate fixes actual SOCKS keep-alive, old-route idle retirement, per-request negotiation deadline and single settlement/cancellation. Existing F01/F02/F03/F05/F06/F07/F08 implementation retained.

Additional source audit found historical allOrders/risk-history and HISTORICAL_REPAIR timeouts still qualified for NET-002. Classification now excludes historical source/purpose from timeout/network bursts; actual HTTP429/418/451 remain visible, current-account bursts remain critical, and stale private facts still block independently. Two regressions prove history vs current purpose and real rate-limit preservation.

F07 readback now separates unique identities attempted from identities with successful exact fact progress. Counts are tied to durable identity; failed reads do not count as progress. Oldest pending UNKNOWN/deferred age and per-class retry causes remain visible, with no synthetic risk release. Existing six-identity rotation regression validates retry/backoff readback. First targeted run exposed the test's incorrect expectation that all six current reasons stayed EXACT_QUERY_FAILED; three were correctly BACKOFF_OR_PROOF_TTL on the second run. Corrected expectation passes75 tests/4 files. Full integrated verify result pending below.

F01 independent timestamp/monotonic guards, F02 exact terminal + partial quantities/durable reducer identity guards, F05 private reserve/lane isolation/cancellation, F06 required mark purpose vs optional derivative context and bounded hydration, F08 one transition/one recovery already correct and covered in full verify. Natural F02 lost-ACK terminal runtime evidence remains UNKNOWN without such an event.

No strategy/Settings/proxy/database reset or exchange-write probe. Preserve dirty D:\MITS. Only8080 may be redeployed; models12732/17468/51124 retained. F04/F10/F11 deferred. After local gate, promote main, manually deploy only8080 and evaluate an independent10–30min short feedback window. Deployment alone is not success.

## Integrated local gate

Full npm run verify exit0:1976 tests/232 files (Contracts2/Core58/Dashboard123/Engine1793), release/script/S00/typecheck/build PASS. Full log full-verify.log; targeted75 PASS; git diff --check PASS. No GitHub Actions. Independent curl GET /fapi/v1/time through current SOCKS proxy timed out before HTTP, exit28 after10012ms; this is a remaining-path observation, not attribution to Binance. Details retained. Candidate is ready for authorized only8080 cutover; runtime acceptance PENDING.

## First active short feedback: NOT_HEALTHY

Only8080 manually cut over22:43:50+08, PID9112/instance0c050f74-fc64-43ea-af88-2e1728edfb93/restart264. Source c66dbb739b51445750c2cc7771197dcaad94043778f43d1ef7a0f35e84e96772, artifact3b3fc50d6016c6569b99fa066dfe42b138e836396f2fb85f85bd343b68c80cc8, identity6/6. No automatic retry.

Actual window22:44:50–22:55:37,23samples,10.7954minutes:private READY1/explicit UNAVAILABLE21/observation gap1; health STARTING1/OFFLINE21/gap1, NET-00221 active samples. One private refresh succeeded22:45:38, followed by failure/staleness. New queue appears drained (latest active2/public0/queue0), but that is not usable network truth. Failure phases remain AGENT_OR_SOCKET_ACQUISITION; two independent Python probes show local TCP5/4ms, SOCKS greeting5ms, no SOCKS CONNECT reply within5s. Both bypass Engine agent/REST budget and fail before TLS/HTTP. PROVEN remaining proxy establishment blocker; downstream SSH/VPS/DNS/Binance cause UNKNOWN. No proxy restart/switch/settings change.

A new local F02 propagation defect is PROVEN: ETHUSDT clientv396x9adc0a332525592eeb7a86908f19cb/exchange16816670645 and BCHUSDT clientv396x49c5ed4f88f215302661aee1eaf278/exchange2589655935 have durable FILLED tasks and matching retained USER_DATA_WS full-fill facts, but runtime TP projection remains WORKING with absent positions. Terminal facts were committed only to exit ledger. This is historical immutable exchange terminal evidence, not a fresh account snapshot. New isolated implementation propagates verified terminal facts and replays them on startup with full identity/cycle/quantity guards; it does not reset state or infer certainty from task.state. See docs/reports/v397-tp-terminal-projection-20261007/.

First feedback archive is lossless active-transport-short-feedback-{summary.json,samples.jsonl.gz,events.jsonl}. Legacy analyzer's SHORT_WINDOW_NOT_ACCEPTED means old6h duration threshold only; this active protocol requires10–30min and the real result is NOT_HEALTHY. No6h/12h deployment gate restored. F04/F10/F11 remain deferred.

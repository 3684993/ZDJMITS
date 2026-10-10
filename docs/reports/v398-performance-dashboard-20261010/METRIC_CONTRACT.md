# D1 metric contract
packages/contracts/src/performance.ts is the typed public contract. All reads are GET and add no private exchange/model generation traffic.

| Source | Live TTL / cache | Unit / window |
|---|---|---|
| NODE_OS_CPU_TIMES_AND_MEMORY | 30s / 10s | CPU percent from native tick deltas; memory bytes; Engine RSS/heap bytes |
| WINDOWS_WDDM_PROCESS_COUNTERS | 45s / 10s singleflight | percent busiest PID engine; dedicated/shared bytes across adapters |
| Existing brain/resources and runs | existing health timestamps | active, queueDepth, failures, runtime timing ms; latest100 scope |
| Existing snapshot account/byAsset | private facts <=60s | USDT and USDC separated; available balance, realized ex-funding, confirmed funding subset, unrealized |

Common identity: asOf, instanceId, sampleSource, ttlMs; measureStatus MEASURED/UNKNOWN/STALE; window coveredFrom/coveredTo/sampleCount/droppedSampleCount. GPU services contain constrained resourceId llama:port, port8081/8083/8084, PID, processStartedAt, duty, LUIDs, utilizationPct/dedicatedBytes/sharedBytes. Schema rejects invalid range, duplicate port, duty mismatch and injected physical verification. physicalDeviceIdVerified is literal false and physicalDeviceId null. Physical map remains separately audited evidence.

External collector writes a fixed same-directory file by atomic replacement, restricted current user/SYSTEM ACL. Engine bounded async reader limits64KiB, validates Zod, rejects regressions and future timestamps >1s tolerance, strips extra fields, never executes client-supplied paths or trades. Failure nulls current metrics; history preserves actual samples and instance resets. Reader361 samples, host361(default)/720 maximum, finance720 local samples. History from previous process/instance is never connected. CPU first/invalid delta UNKNOWN; clock/gaps never synthesize zeros.

UI 15s visible-only refresh, 8s AbortController deadline, hidden/unmount abort, no hidden polling; ECharts animation false and dispose/ResizeObserver cleanup. Range15m/1h/6h/24h/7d filters actual covered samples; long windows do not assert full coverage. Gaps exceeding source TTL are null line breaks.

Lamps: green proven fresh healthy, yellow degraded/congested/config-only, red evidenced HTTP/disconnection/safety issue, gray missing/expired. Proxy configured != end-to-end proved; HTTP451 distinct from SOCKS;502/503 red;418/429 yellow. Model idle/no legal work normal, not artificial failure. TP cached PROTECTED is not signed fresh dual-ID proof.

Finance thresholds are display-only: <500 red,500..<1000 yellow,>=1000 green, missing/stale gray, per currency. Realized ex-funding needs complete cycles; funding all-in shows only eligible attributed subset with coverage numerator/denominator, not whole portfolio. No BTC mixing, wallet delta PnL, unavailable funding=0 or unsafe order funnel inference.


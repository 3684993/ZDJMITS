# Private reconciliation fan-out: deployed, runtime acceptance FAIL

2026-10-08 +08. Baseline main 69486283bcaeb50a2d65b846ce4fd20b1109105a; deployed candidate 4cd57a99af028189ca213b7aee3ed27ed1e362c4. Worktree D:\MITS-WORKTREES\v397-private-reconciliation-fanout-20261008. Engine43308/host46544, instance e4ce7af1-1a99-4976-a3a7-062dc4dca2ee, restart275, MANUAL_START. Source4bc16fa18083a3f545ac2c23c5242c6353f4e68cf01a5b187c2f3c452fec651b; artifact68a33f8a45a96be37be157f9fd8391243062a88f0fb42e3820824be6fc7e72c7. Loaded identity6/6. Ordinary FF promotion proven, no Actions, no dirty canonical checkout changes.

## Verdict and comparison

Targeted all-row fan-out remediation PROVEN; overall Engine Reactivity FAIL. One full verify exit0:236 Vitest files/2021tests plus16 script tests. No full test/build during acceptance. Same-root batch deployed once, only8080 cutover; no further remediation branch or automatic restart.

Actual sample window 2026-10-08T09:46:14.986111+00:00 through 2026-10-08T09:52:15.182624+00:00, 6.003267min/25samples. Separate fresh histogram records its own start/end and spans360.358seconds. Startup probes are separate, not included. Initial identity connection refusal before listening preserved in identity-before-ready.log; subsequent loaded identity passes.

| Metric | Previous independent window | New independent window |
|---|---:|---:|
| loop max ms |5255.463|6140.461|
| loop p95 ms |36.405|35.553|
| PRIVATE queue timeouts |0|0|
| EXECUTION queue timeouts |0|0|
| REQUIRED_MARKET identities |7|4|
| private READY |25/25|25/25|
| private max age ms |historical baseline in prior report|18178|
| market FRESH/RECOVERING/DEGRADED |6/12/7|8/12/5|
| TP issue snapshots |2|0|
| main idle CPU sample share |63.7026%|54.5259%|
| known Production writes |0|0|

PRIVATE consecutive failures0 all25; no sampled HTTP read errors; TESTNET locked25/25. TP READY and protected=required all25, final19/19. Natural lost-ACK terminal-to-TP recovery UNKNOWN, no manufactured samples. Active NET incidents empty in samples does not mean all requests succeeded. BACKGROUND_AUDIT1 timeout explicitly excluded from critical count. Required4 identities: premiumIndex mark recovery,2depth book recoveries,1klines; all had admittedAt=null. No assertion of exchange/SSH cause.

## Before/after wall-time evidence

Before:6natural instrumented cycles; after:21complete cycles fully inside actual sample window. Instrumentation overhead, changed workload/entry count and Windows memory pressure limit strict benchmark comparability. Inclusive timings overlap; total/application intervals include async waits and cannot be added as exclusive CPU.

| Per-cycle phase/count | Before | After |
|---|---:|---:|
| entry journal save calls |2622|1–4,mean2.8095;total59|
| entry SQL changed rows |0–3|0–3,total16|
| manual journal save calls |141|4,total84|
| manual SQL changed rows |49|2,total42|
| entry journal wall ms |822.754–1134.206|0.210–39.860|
| manual journal wall ms |65.292–334.342|2.579–12.301|
| claim stats wall ms |456.841–523.219|0.117–6.921,p956.617|
| runtime completion listener ms |full historical fan-out in baseline|0.312–40.065,p956.946|
| completion publish ms |1459.884–1884.958|519.533–637.781,p95623.911|
| TQ completion capture ms |549.008–587.427|515.191–626.214,p95613.150|
| remote-read completion→apply ms |raw baseline timing retained|0.913–2.416|

Changed-ID claim refresh60 IDs over20nonzero cycles; zero-change cycle does not increment the change counter. Actual SQLite `.changes` separate from save calls; duplicate legitimate changed-ID event/completion saves can be SQL no-ops. Unit fixtures prove unchanged histories yield zerojournal callbacks, exact onechangedidentity persistence, UNKNOWN/terminal/nestedproof/reservation durability, retry newest-state behavior, incremental scan parity, proof expiry/clockrollback/transactions/restart, synchronous event order/exceptions. Critical claim/submission/UNKNOWN/TP remains synchronous fail-closed. RuntimeWriteBuffer normal success remains inline; no global async writer.

## Remaining measured blocker and bounded next recommendation

Engine still has6.140second independent loop spike and REQUIRED_MARKET timeouts: cannot sign runtime stability. First60.308second CPU profile shows TQ capture11.778% inclusive, critical reservation mutation→persistRuntime8.3936%, dashboard projection6.0613%, GC3.0034%. These overlap, are not exclusive shares, and are not wall-time attribution for the entire6minute spike. Completion listener wall evidence proves TQ dominates remaining completion publish, but neither this515–626ms capture nor CPU samples uniquely explains6.14seconds. ApplicationBeforeCompletion max18.823s includes remote awaits, not proven main-thread blocking. Exact spike caller UNKNOWN.

Stop expansion here per scope. A next explicitly scoped investigation should correlate slow-task wall clocks with event-loop spike timestamps and exact critical reservation/full-checkpoint and dashboard SQL call chains, with host pressure measured separately. Do not reopen transport/TQ historical isolation or weaken durability. Worker isolation must carry versioned immutable snapshots and preserve synchronous authority-critical commits if later evidence warrants it. No new strategy/TP/Entry/TTL/risk thresholds.

## Memory and preserved boundaries

Host commit headroom min1,225,633,792bytes, max2,788,757,504; Engine sampled RSS max2,155,380,736bytes, heapUsed max1,670,808,880bytes. Independent inspector memory endpoint before/after retained. This is observed pressure, not proof of host ownership or cause; no OS/pagefile/model changes.

Settings247/resources fingerprint exactly equals actual before. Models8081/8083/8084 PIDs12732/17468/51124; actual SOCKS20091PID24916 and guardian11852 retained, no operator tunnel changes. OldSSH29068 was absent before candidate stop; do not claim unchanged versus previous historical window. Dirty D:\MITS and oldworktrees preserved. Production0 is runtime boundary evidence, not a blanket assertion of all remote wire requests.

## Evidence coverage

Raw samples.jsonl + lossless gzip and SHA256; CPU raw+gzip and hashes; fresh histogram; complete cycles/phase summary; baseline raw probe/summary; request-ID deduplicated ledgers; startup/identity/settings/process receipts; full verification and development failure logs retained. Retained ledgers and15second samples are not lossless wire census; natural events absent are UNKNOWN. Bounded64-cycle records are filtered to completed cycles inside actual first/last; no oldfailedwindow mixture. All final artifacts submitted directly to GitHub by ordinary FF.

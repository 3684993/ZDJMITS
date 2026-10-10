# Recovery execution closeout — BLOCKED, not accepted

Observed 2026-10-10 23:55 Asia/Shanghai. All safe source repair, review, test, merge, staging and monitor restoration below were executed. Engine promotion and formal stability remain blocked by fresh signed protection facts and remote diagnostic permission.

| Change | Verified HEAD / CI | Merge |
|---|---|---|
| PR42 MARKET ACK/sharding/recovery | 30b9cb794ff9fce26b464dfaf0ee142d12185a27 / 38059896597 SUCCESS | 33c70b7057166459afc578fb999a65c6093e7166 |
| PR41 proxy lifecycle/identity | 44baccad69fa90bd7e156d3647791428ae501a78 / 38060943533 SUCCESS | 3801c7801805a23cc4010ec112d37de61295ba75 |
| PR44 PUBLIC retained subscriptions/sign-at-admission/private V3 facts | 84052335fce26a0fe46638dc077b3fffcdfd7f21 / 38062626619 SUCCESS | b84c919ed38c35ece4b60ff4473db2e312f00636 |
| PR46 clock/catalog backoff and exhausted guardian observation | f20cba7bb157aab689ccb8ce9813d179189997b6 / 38064711212 SUCCESS | 2dc0bb4620e0d3026433875584d3dc1d06f463e5 |

Initial origin/main was 0962181c43eb09e007d4b5695193e62dfce92447. Original D:/MITS remains clean at ef00780c9b02c1db762ddca2705a836555abbd59, with no reset/switch/overwrite. Source work used isolated worktrees. PR43 documents remains open with head 889c19df16555c59e177077787306e7eda9c29c3 and current merge conflict; it is a reference, not a deployed fix.

Full local exact f20cba7 verify:ci exit 0: 2261 tests, 269 files, S00 T01-T06 PASS. The log contains the same SHA before and after. Intermediate rest-guardian-final-verify-ci.log crossed a later script edit and is diagnostic only; it is not used as exact-head proof. Logs normalize trailing whitespace/EOF only. Latest main push workflow 38065297295 was still running when checked; no success is borrowed from the PR run.

## Actual components

Engine 8080 PID 23828, native host PID 19360, started once at 23:28:37 from sealed b84c919. Source hash cd08eca711169218f90c74ddb063c42833bab8891cb90378486675b9ed95a472, artifact hash e17fa644488bb74c70c70be79c5b075d1023f190a8ec75c31100346e36c1d0e5, build 3.9.8-e17fa644488bb74c70c7. Receipt/process/instance/actual child environment match. Pre-start fresh signed 7-GET gate proved 26 exchange positions and 26 matching TP orders; subsequent independent probes became UNKNOWN. No Engine stop signal, forced termination or repeat start occurred.

On natural-load failure this release's entry approval was atomically revoked. Live entryPermission confirms ANALYSIS_ONLY, analysisAllowed=true, riskObservation=true, orderAuthorization=false. Production writes=0 and lockedToTestnet=true. Primary sole Entry/no-separate-add/HUMAN_MANAGED guards are preserved. Local TP projection is 27/27; that discrepancy against the earlier 26 signed positions is not resolved by assumption. Local coverage does not replace fresh exchange proof. Current private sync UNAVAILABLE with expired facts prevents promotion.

Proxy SSH PID 12300, created 2026-10-10T15:33:47.988242Z. Old guardian performed exactly two cooled identity-checked restarts: 12212 -> 22876 -> 12300, then stopped monitoring at budget exhaustion. Merged PR46 helper was actually installed and hidden guardian PID 22496 restored with MaxRestarts=0. Script SHA256 bd1d15ae6d748e6aa223143a42d2db47fbe79e5e23e2d73cfba2e97851f0027f. PID/birth/source/command readback matches; tunnel lifecycle attempts during monitor restoration=0. HEALTH records continue after its exhausted-budget alert. No third restart, new route, SSH key or sshd change.

Scout 8081 PID25912, qwen3.5:9b, actual GGML_VK_VISIBLE_DEVICES=0; Review 8083 PID22880 and Primary 8084 PID16772, qwen/qwen3.8-27b, actual devices 1 and 2. PID creation/model/list/health/real inference match. Last real probes 221/240/152ms, response OK. Healthy model restarts=0. Vulkan assignment is verified against current state and actual process environment; physical PCI/LUID correlation remains UNVERIFIED in the WDDM projection and is not invented.

GPU sampler and read-only crash observer Running with sealed b84c919 binding. GPU Engine projection MEASURED with current samples. Manual/reboot bindings require fresh signed TP and default to ANALYSIS_ONLY. Engine guardian remains MANUAL_START_ONLY by design; no protective process is killed to obtain a clean status. Actual cockpit /performance loaded, no captured frontend errors, and visibly showed network/private degradation rather than a healthy claim.

## Failure and formal gates

WS acquired exact PUBLIC48/48 and MARKET144/144 ACK for24 retained symbols. The captured natural 60-second window delivered PUBLIC1376564 and MARKET1077025 decoded application bytes. These are not SSH wire bytes. All24 last/mark/bid/ask fields were stale; one captured quote had141790–194004ms event age. ACK/LIVE is not fresh data or stable acceptance. Actual ledger contained nine exchangeInfo attempts and659227 decoded bytes before one RESPONSE_BODY timeout. PR46 removes the catalog prerequisite from CLOCK and backs off failed catalog retries without extending timeout or successful metadata TTL. Its Engine artifact is built in D:/MITS-RELEASES/ZDJMITS-v398-network-f20cba7 at merged2dc0bb4, but is NOT ENGINE_DEPLOYED because replacement cannot bypass fresh signed TP.

The latest independent signed gate failed its first GET /fapi/v1/time at SOCKS_NEGOTIATION, no HTTP status and0 body bytes; no private position/order proof was obtained. Guardian probes also record SOCKS_CONNECT_REPLY, TLS_HANDSHAKE and HTTP_PUBLIC_TIME deadline failures. These phases are retained, not silently reclassified as451 or fixed by longer deadlines.

Ubuntu's existing proxy SSH account denied remote command-channel opening (SSH_EXIT=-1). No configured local admin SSH alias or relevant open browser session was found. Server SSH Send-Q/notsent/RTT/retrans are UNKNOWN. Required missing input is an existing authorized Ubuntu admin SSH alias or username/port/local identity-file path that can execute read-only ss; no key contents are requested and no new access is created.

30-minute continuous stability: NOT STARTED_GATE_FAILED. 90-minute natural observation: NOT STARTED_GATE_FAILED. Formal recovery: BLOCKED_SAFETY_AND_REMOTE_PERMISSION_GATE. Source/CI/staging success and retained local TP do not make this PASS. To continue promotion, first restore the same-route private transport and obtain a new signed all-position TP proof; no authorization can substitute for that evidence.

Evidence and handoff are committed/pushed in PR45. Private SQLite backup passed quick_check/settings-match and remains outside Git. No secrets, private keys, signed URLs, order payloads or databases are uploaded.

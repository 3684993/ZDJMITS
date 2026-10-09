# PR19 actual merge, release and cutover status — 2026-10-09 20:44 Beijing
## Verdict
OFFLINE_VERIFIED / MERGED / RELEASE_BUILT.
LIVE_DEPLOYED = false. NEW_ENGINE_PID = NONE.
CADENCE_90MIN = NOT_STARTED_BLOCKED; SLO = UNKNOWN.
The authorized Engine stop/start tool call was rejected by automatic approval with "blocked by policy"; no more specific reason was provided. The command did not execute: both cutover-start and new-host receipts are absent; old Engine PID18100 remains alive. No alternate tool or disguised command was used to bypass this rejection.
This is an execution restriction, not a request for renewed Engine authorization: operator authorization was already explicit.
## GitHub and candidate
PR19 ordinary merge SHA39931a7ecb1981be28a7ca20c7dded475eb83695; parent main7c9c94e9807c8c8ab1a9e0c8b205e391974493ec and tested PR head84ffa55d017b7bd26f7cae633bb5a6704ccbd63a.
Code repair72126215b4968a59e4b27b4d068ecb3455b24ee0; final source paths unchanged by documentation commit and merge.
Remote main read back39931a7ecb1981be28a7ca20c7dded475eb83695.
Stable release D:\MITS-RELEASES\ZDJMITS-v398-primary-cadence-39931a7, clean source, npm ci and npm run build exit0.
Candidate build3.9.8-871988c3217af31d40f0;
sourceSHA50494d075ebed872367d8cfacb12d99352c3b076ea76dc3b0124f2bbac78090c;
artifactSHA871988c3217af31d40f0567d81e73d874720a27422caad43f6e60bd0a549f14f;
main.jsSHA df014d7d4da78af092844fa646c3ac1409bff38ec27c35da5db3de0caf072376.
Full final verification251 Vitest files2147 tests,16 Node tests, lifecycle/reboot/proxy/collector PowerShell gates,S00,typecheck,build. Latest remote combined statuses and check-runs were empty; hosted CI SUCCESS is not claimed.
Running new-build identity6/6 remains NOT_EXECUTED. Old running build does not equal current main's candidate.
## Current actual runtime
At20:41:51 Beijing, PID18100, instance65185f71-b336-4f6f-8149-cafe90f5e160, old build3.9.8-6cd926abca3eec24392e.
HTTP200 ready=true but overall DEGRADED; current private snapshot stale124s with Binance request timeout. READY alone is not healthy private-account acceptance.
Actual old child ZDJ_ENTRY_ADMISSION_DISABLED=0, ZDJ_ENTRY_EXECUTION_POLICY=TESTNET_ENTRY_ENABLED; API orderAuthorization=true, executionFactsStatus BLOCKED. Existing UNKNOWN/risk guard remains active.
TP projection13/13, Production writes0. Models PID3400/14020/22336 unchanged.
Review ONLINE at readback; historical3 failures REVIEW_EXIT_WITHOUT_PLAN_PREDICATE, not proven Primary-cadence cause.
## Proxy incident and separately authorized action
Before action, formal -Status probe stopped in SOCKS_CONNECT_REPLY after8019ms: TUNNEL_UNHEALTHY, listenerPID6784. Operator subsequently separately authorized one proxy repair/restart.
Official proxy script -Restart ran ONCE and exited0. New PID18300; SOCKS connect/TLS/public time all passed in3387ms.
Initial stderr preservation via PowerShell was blocked by sharing lock; no available log content was invented. Official script retained previous log; it was0bytes. Restart receipt and probe log retained privately.
Private requests remain intermittently timed out after recovered tunnel; no repeat proxy restart was attempted.
## Fresh signed account and protection proof
20:39:27 Beijing real signed account GET: canTrade=true, USDT available2138.30745307 / wallet6237.62269052, USDC available3722.82047121 / wallet5159.62306961.
Real signed openOrders verifies13/13 TP by exchangeOrderId AND clientOrderId, symbol, position side, closing side, reduceOnly, remaining quantity and price. Original private account/order response retained locally.
TESTNET leverage GET recovered3 ladders, failures0, actual key fingerprint matches existing Entry approval; no exchange writes.
SQLite online backup completed, SHA256402450023743723de7cbd12f356f9f156d758ecd0fa35d0a21685ad9aeda2901. No clearing/reset.
New exact-build approval file C:\Users\5700x\AppData\Local\ZDJMITS\entry-authorization\v398-primary-cadence.json prepared and candidate policy probe returns orderAuthorization=true.
Expiry remains2026-11-08 15:02:15.943 Beijing; renewal requires explicit operator approval and exact source/artifact/Settings, no automatic extension.
Autologon action still targets the old release/approval because runtime cutover did not execute; no hidden activation via login-task change.
## Historical exact audit
Bounded read-only audit of3 origin examples, no DB mutation:
- ADAUSDT exact GET timeout: UNKNOWN_NO_RELEASE.
- RAYSOLUSDT both exact IDs match, remoteFILLED606.3, fill sum606.3; journalfilled42.1 differs. Existing held position/TP plus unconserved legacy record prevents origin release.
- TIAUSDC both exact IDs match, remoteFILLED1965, fill sum1965; journalfilled194 differs. Existing held position/TP plus legacy conservation gap prevents release.
An order being remotely FILLED proves a filled order; it does not prove that its position is closed or grant an independent additional Entry.
Other21/35 origin drift remains protected; no mass deletion, blind UNKNOWN clearing or rewritten history.
## Natural Primary cadence and monitoring
Actual old Engine19:12:36–20:42:36 Beijing: Primary requests0, valid completions0. Last actual Primary XRPUSDT completed18:44:09.186. This is old runtime, not acceptance of the unstarted new build.
27B dry-run was historical offline input; it is not counted as a natural live Primary run.
Dedicated task \ZDJMITS\ZDJ-V398-Primary-Cadence-90min registered,5-minute polling, result0 at20:44:10,next20:49:10.
It verifies approved build and distinct PID, ready and Entry authorization before creating actual T0; currently WAITING_FOR_APPROVED_NEW_DEPLOYMENT with no baseline. After valid new instance it records90min; identity interruption is evidence failure, never automatic restart.
Private monitor directory C:\Users\5700x\AppData\Local\ZDJMITS\diagnostics\cadence-90min-20261009.
Finite heartbeat zdjmits-pr19-90 follows every15min; unchanged state quiet; no automatic lifecycle or trade writes. If no deployment by2026-10-10 08:44, it ends as NOT_STARTED_BLOCKED.
Original24h protocol remains ABORTED, checkpointDisabled, old heartbeatPAUSED; WER andCrash Observer Running; latest45s sample329 at20:44:06, old identity unchanged.
Independent passive trade audit result0 at20:40:52,next20:45:51.
## Remaining operator execution steps
1. Execution environment must permit the already-authorized single Engine lifecycle; do not repeat it through alternate tools after a denial.
2. Refresh signed TESTNET account/order/TP proof and proxy status immediately before stop; stop only owned PID18100 if identity still matches. Confirm8080 clear.
3. Use existing formal stable release scripts/start-zdj-engine-host.ps1 once, with candidate source/artifact and prepared approval file. Environment: ZDJ_CONFIG_DIR=<stable release>\config; ZDJ_SETTINGS_DB=D:\MITS\data\zdj-settings.sqlite; ZDJ_DATA_DIR=D:\MITS\data; ZDJ_START_REASON=MANUAL_START; ZDJ_PORT=8080; ZDJ_ENTRY_ADMISSION_DISABLED=0; ZDJ_ENTRY_EXECUTION_POLICY=TESTNET_ENTRY_ENABLED; ZDJ_ENTRY_APPROVAL_FILE=<prepared file>; ZDJ_ENTRY_APPROVED_ARTIFACT_SHA256=<candidate artifactSHA>.
4. Verify actual child environment,8080 ready,private freshness,TP all current,Production0 and v396-g1-g4-identity-closure.mjs against stable release/main6/6; rebind existing Crash Observer receipt/lifecycle to new instance after sealing old lifecycle.
5. Update ZDJ-MITS-AfterReboot-TESTNET action to stable new projectRoot and new approval; preserve model scripts and proxy. Do not run stack orchestrator to restart existing models.
6. Monitoring creates real new-build T0 and18 five-minute windows. Review natural eligible candidates, schema acceptance, JIT/Intent/Reservation/order/cancel/fill/TP chain. Unknown eligibility or zero lawful signals is not SLO_PASS. Do not force orders.
## Private evidence hashes
candidate identity2b9a84cc6b3598eba5830e97431c1de6fadb223d9c28478e484c65769767a20d;
history exact audit4134f6c27f9ef672804045163de4b3012f0ca03e138bea76e605c79f25debf18;
proxy restart log7eeb62e1d6410cf27964717c34bf7b1a53fa837e3b248f3a76d4d21ad2c1e43c;
fresh account summaryc7e9d70e51c8f47858b7dc05eb36d9c2628218171e3a90a7b3e123d380f42829.
Sensitive DB,dumps,credentials and raw account/fill/order payloads remain local.

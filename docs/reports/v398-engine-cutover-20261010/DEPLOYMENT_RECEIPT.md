> **Terminal update2026-10-10:** original24h ABORTED_SAFETY_FAILURE at08:34:00.270+08, LOCAL_TP_GATE_NOT_CLOSED; no24h PASS/new clock. See [abort receipt](ACCEPTANCE_ABORT_RECEIPT_20261010.md) and acceptance/state.json. The initial deployment/running receipt below remains historical.

# V398 actual TESTNET Engine deployment and new24h acceptance

**DEPLOYED / RESTARTED / IDENTITY_CLOSED_6_OF_6 / ACCEPTANCE24H_RUNNING, not yet PASS.** T0 **2026-10-10 08:16:49.685+08**, deadline **2026-10-11 08:16:49.685+08**. See the evolving `acceptance/state.json` and `acceptance/checkpoints.jsonl`; do not interpret this initial running receipt as completion of24h.

## Execution authority and frozen release

Latest direct user instruction explicitly removed waiting for additional official account/region confirmation as this release prerequisite, attesting the existing Singapore proxy route and authorizing immediate normal TESTNET deployment/restart. Recorded as **OPERATOR_ATTESTED**, not independently verified official Binance eligibility. Earlier Issue22 NO_GO is preserved as history, superseded on that prerequisite by the later direct instruction. No geographic endpoint/route rotation, credentials or proxy changes were made. A future451 must retain its actual response/route facts; HTTP200 does not establish that every451 is a script defect. No451/502 was observed in the bounded pre/post samples below, so no unproven proxy-script modification was made.

Fetched main **`362355e09f844ee8416a95693fef3735b8c47f3c`**, verified runtime source/config/lock/scripts equivalent to the clean, sealed release **`D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd`**, frozen commit **`6f228cd90f9146405761f3221b70096f7ca85ed5`**.1923 sealed file hashes reverified. The independent build and existing full251/2157 verification/CI evidence are in the preceding preparation receipt; they were not repeated instead of deployment. Subsequent evidence-only commits do not change runtime code.

Immediate new SQLite online backup: **1,026,117,632 bytes**, SHA256 **`3c970675dceb21228a68fc834d5ac8dfe6666b22c711cc3926346210bb50b2d6`**, `quick_check=ok`, Settings253 payload unchanged. Old approval/instance/actual host receipt copied privately; prior preparation backup also preserved. Database and activation records remain private with current-user/SYSTEM ACL; safe hashes/metadata are public. Rollback retains the current durable DB rather than restoring stale fills/order identities automatically.

Independent new identity approval activated at08:08:12+08, binds actual source/artifact/main/Settings253/account scope/data root and latest user authorization. New path `LOCALAPPDATA\ZDJMITS\entry-authorization\v398-testnet-entry-bb45c11-20261010.json`; old approval unchanged. This was a new release activation, not Renew/relabel of the old receipt. No Settings write, threshold/TTL/risk/TP/no-add policy change or manual model/exchange write.

## Actual one-stop / one-start result

At08:08:18+08 the existing strict `stop-zdj-lan.ps1 -Port8080` identified old Engine **18100**, stopped it successfully and confirmed8080 free. Old host23056 persisted `CHILD_EXITED` with exitCode-1 for that requested termination; it is not an unexplained native crash. No current policy rejection occurred.

At08:08:25+08 launched the actual project **`start-zdj-engine-host.ps1`** once, host **26576**, new child **23688**, launchId **`v398-approved-bb45c11-20261010-one`**. Actual receipt and HOST_STARTED/CHILD_STARTED events confirm the child and `--no-maglev` runtime guard. The launch command's trailing immediate receipt read ran before the receipt existed and reported shell exit1; the host was already started. No second launch/retry was made. Readback confirmed the receipt and live process; HTTP progressed from not listening to503 STARTING and then200 READY. No readiness-driven restart occurred.

New actual instance **`07230a28-51ac-4dda-9c95-20a789b382b4`**, build **`3.9.8-bb45c11acbe9819a3456`**, entrypoint **`D:\MITS-RELEASES\ZDJMITS-v398-main-6f228cd\apps\engine\dist\main.js`**. Actual child environment was read from its PEB and confirms `ZDJ_ENTRY_ADMISSION_DISABLED=0`, `TESTNET_ENTRY_ENABLED`, new approval file, expected artifact hash and unchanged data root. Health/closeout returns `EXPLICIT_TESTNET_APPROVAL_VALID`, orderAuthorization=true.

Six checks all true in `post-start-identity.json`: approved frozen source equals latest-main runtime code; actual source identity; actual full artifact/derived build; actual main entrypoint; actual Settings/account scope; actual child/host/receipt/API/instance and admission environment. Hashes:

| Identity | Actual value |
| --- | --- |
| source | `9d9f1d0a3865cec28c759766d3fca820aa978c9f809740731f84819b4cb3d73f` |
| full artifact | `bb45c11acbe9819a34566eb59f5eaaf0beff8912d92955bbdd882d035e06117e` |
| main.js | `df014d7d4da78af092844fa646c3ac1409bff38ec27c35da5db3de0caf072376` |
| Settings253 payload | `9edea9f1bc02a3b844b2baf50f0be541871d167860ef6bb5fcb8449e0b744151` |

The stage's actual raw-byte source hash differs from the preceding worktree04af474 only by one CRLF/LF file, as already investigated; this release correctly binds9d9f1d0. No runtime6-of-6 claim is based solely on a GitHub build or PID.

## Account, TP, network and retained components

Before stop: six bounded public/signed GETs returned200; exact TP **12/12**, private age10.756s, Production0. After start: six-request sample and a later final refreshed six-request sample all returned200 and exact TP12/12 by dual exchange/client IDs, closing side, reduceOnly, remaining quantity and local price/quantity. Final sample age4.044s at identity closure; private age7.016s, failures0. Current count is12, not the historical13 from06:21; coverage always follows actual current positions.

The V3 account response omits `canTrade`; retained null/TECHNICAL_UNVERIFIED rather than inventing it. A single signed V2 account GET per permission refresh returned **canTrade=true**, HTTP200. V2 is the documented account-permission field source in the [official account API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account); same existing TESTNET host/proxy, not a route workaround. Combined exact-TP/V2-permission/fresh-private gates pass. Bounded task totals: before6 GET + first-post6 GET/permission1 + final6 GET/permission1 = **20 exchange GETs**, manual exchange writes0. Response statuses/timings are retained;451/502 count0 within these samples, not a promise they can never recur. Historical timeout evidence remains intact.

The first identity readback had signed TP age91.479s and was **not used to establish T0**. Added the explicit signed-age safety check and refreshed the final snapshot; final signed age4.044s/permission age1.201s and all gates passed before T0. No TTL was raised.

Models **8081/3400,8083/14020,8084/22336** retain the same PIDs; model GETs200 with expected Scout/Review/Primary aliases. Proxy **20091/18300** unchanged. WER DumpType2/DumpCount2 retained. Old Crash Observer17772 ended naturally after sealing the old instance; the original hidden task was rearmed for the new actual receipt/root/source, new observer **24540**. It was not killed or disabled to hide the cutover. First task-export attempt omitted the existing `\ZDJMITS\` path and failed before modification; corrected the actual TaskPath, not a policy bypass. Principal/restart settings preserved.

Hidden `ZDJ-MITS-AfterReboot-TESTNET` action now points to the new stable root and new approval, preserves triggers/principal/restart settings, and was **not started**. No model/proxy/Engine launch via scheduler was used; scheduler changes here concern the observer, future reboot registration and read-only acceptance only.

New instance Production writes **0**, blocked Production attempts0. At T0 new-instance TESTNET write counter **5**, reflecting natural runtime activity; preceding instance's118 is historical, not erased. No audit-manual orders or model calls. Warmup before T0 has Primary COMPLETED3, Review COMPLETED1, Scout COMPLETED3 and durable ENTRY_ORDER_CREATED2/ENTRY_FILLED1 event counts. Those are warmup event counts, **not24h acceptance counts or a claimed fully joined new-fill proof**; `natural-warmup-evidence.json` scopes them explicitly.

## Continuous acceptance now running

T0 established only after actual new identity, fresh signed account/TP/permission, private, Production0, models and observer/reboot closure. New hidden task **`\ZDJMITS\ZDJ-V398-24h-20261010`** samples each60s with SQLite query_only/readOnly and local GETs; no exchange calls, lifecycle or Settings writes. Initial task executions return0 and stateRUNNING. Collector binds this instance, Settings payload and auxiliary PIDs, records private/TP/Production, Primary counts, durable event identities/hashes and scoped cursor, and preserves original runtime DB/JSONL as full underlying evidence. Failure/user STOP marks the attempt ABORTED without stopping protective Engine; every subsequent repair/redeploy requires a complete new24h.

Existing heartbeat **zdjmits-v398-24** was updated for this current thread and new T0, every30min, to sync safe hourly/milestone/failure/completion evidence to GitHub and perform final signed/funnel review. Superseded old90min follow-up paused; all old files retained. Regular unchanged state remains quiet. Runtime protection/observer are independent of the heartbeat. Completion requires final signed safety/readiness and log/funnel coverage review; expiry alone is **not PASS**. Effective Primary3–5min SLO requires actual legally executable candidate evidence, not UI READY or forced orders. Current first samples prove start/continued monitoring only.

Future451/502/timeout investigations must retain response meaning, route and stage evidence and inspect the existing proxy scripts. Neither network code nor server settings were edited without a reproduced supporting fault in this cutover. Remaining four dependency advisories and intermittent transport reliability are not claimed solved. User may stop acceptance at any time; retain evidence, repair under normal authorization, then reset the full24h after verification.

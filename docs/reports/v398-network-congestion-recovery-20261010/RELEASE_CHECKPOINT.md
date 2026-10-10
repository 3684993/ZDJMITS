# Verified release checkpoint

PR #42 merged at 33c70b7057166459afc578fb999a65c6093e7166 after exact-head CI 38059896597. PR #41 merged at 3801c7801805a23cc4010ec112d37de61295ba75 after exact-head CI 38060943533. PR #44 merged at b84c919ed38c35ece4b60ff4473db2e312f00636 after exact-head 84052335fce26a0fe46638dc077b3fffcdfd7f21 CI 38062626619 SUCCESS.

Full final local verify:ci exit 0: 2259 tests, 269 files, S00 T01-T06 PASS. Build and exact dependencies installed in isolated release directory. Main workflow 38063222310 was still running when this checkpoint was written; no main success claimed.

Private SQLite backup: quick_check ok, Settings payload matches, no Settings writes. Backup and secret material remain outside Git. Pre-start signed GET evidence passed 26/26 TP coverage; this is a timestamped checkpoint and must be refreshed immediately before launch. Engine remains offline at this checkpoint.

Proxy SSH PID 12212 preserved, hidden guardian PID 19364 restored. Real CONNECT/TLS/public time passed. GPU sampler and read-only crash observer Running; task bindings now reference sealed release while preserving principals and restart settings. Future manual/reboot actions require fresh signed TP and default to ANALYSIS_ONLY. Engine guardian remains MANUAL_START_ONLY by design.

Scout 8081 PID 25912, Review 8083 PID 22880, Primary 8084 PID 16772 all passed process creation, actual GGML_VK_VISIBLE_DEVICES, model identity and real inference. Healthy models restarted: zero.

Ubuntu current proxy account cannot open a remote command channel. SSH Send-Q UNKNOWN; no sshd, route, key, or access changes. Formal 30+90 acceptance has not started and is not PASS.

## Actual deployment and safety block (2026-10-10 23:39 +08)

Merged source b84c919ed38c35ece4b60ff4473db2e312f00636, exact main CI 38063222310 SUCCESS. Actual sealed Engine PID 23828 started once at 23:28:37 with fresh signed 26/26 TP PASS; source/artifact/build/receipt/native process/actual child environment matched. Following natural-load transport failure, this release's entry approval was revoked. Live entryPermission confirms ANALYSIS_ONLY and orderAuthorization=false; Production writes 0. Engine and model protectors were not signaled. Local TP projection 27/27 is not a fresh signed proof; the independent signed probe later returned UNKNOWN at its first public GET. Therefore stopping/replacing Engine is safety-blocked and 30+90 acceptance has NOT STARTED.

Proxy guardian made exactly two cooled identity-checked attempts, SSH 12212 -> 22876 -> 12300. Continued SOCKS_CONNECT_REPLY/TLS failures exhausted its budget at 23:35:46 and guardian exited. No third restart. Read-only monitor retention is being repaired in source. Qwen PIDs 25912/22880/16772 remain healthy and were not restarted. GPU sampler and Engine read-only observer are Running; real cockpit /performance loaded without frontend console errors and showed PRIVATE UNAVAILABLE/quote degradation with Primary sole Entry / No Separate Add.

Source follow-up PR #46 fixes the proven catalog/clock retry defect. Evidence PR #45 retains sanitized actual deployment/failure facts. Ubuntu proxy SSH account still cannot open a remote command channel; Send-Q remains UNKNOWN. No auth, route, sshd, Settings, or TP bypass was made. Formal recovery and stability are NOT PASS.

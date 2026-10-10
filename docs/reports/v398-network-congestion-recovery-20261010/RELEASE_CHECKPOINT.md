# Verified release checkpoint

PR #42 merged at 33c70b7057166459afc578fb999a65c6093e7166 after exact-head CI 38059896597. PR #41 merged at 3801c7801805a23cc4010ec112d37de61295ba75 after exact-head CI 38060943533. PR #44 merged at b84c919ed38c35ece4b60ff4473db2e312f00636 after exact-head 84052335fce26a0fe46638dc077b3fffcdfd7f21 CI 38062626619 SUCCESS.

Full final local verify:ci exit 0: 2259 tests, 269 files, S00 T01-T06 PASS. Build and exact dependencies installed in isolated release directory. Main workflow 38063222310 was still running when this checkpoint was written; no main success claimed.

Private SQLite backup: quick_check ok, Settings payload matches, no Settings writes. Backup and secret material remain outside Git. Pre-start signed GET evidence passed 26/26 TP coverage; this is a timestamped checkpoint and must be refreshed immediately before launch. Engine remains offline at this checkpoint.

Proxy SSH PID 12212 preserved, hidden guardian PID 19364 restored. Real CONNECT/TLS/public time passed. GPU sampler and read-only crash observer Running; task bindings now reference sealed release while preserving principals and restart settings. Future manual/reboot actions require fresh signed TP and default to ANALYSIS_ONLY. Engine guardian remains MANUAL_START_ONLY by design.

Scout 8081 PID 25912, Review 8083 PID 22880, Primary 8084 PID 16772 all passed process creation, actual GGML_VK_VISIBLE_DEVICES, model identity and real inference. Healthy models restarted: zero.

Ubuntu current proxy account cannot open a remote command channel. SSH Send-Q UNKNOWN; no sshd, route, key, or access changes. Formal 30+90 acceptance has not started and is not PASS.

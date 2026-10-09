# V3.9.8 crash capture arming receipt

Captured 2026-10-09 (Asia/Shanghai) on the Windows runtime host. Engine lifecycle was not invoked for instrumentation.

## WER LocalDumps

- Status: `CRASH_CAPTURE_ARMED` for image name `node.exe`; this applies to every `node.exe` on this host.
- Registry: `HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe`.
- Dump folder: `%LOCALAPPDATA%\ZDJMITS\diagnostics\engine-wer`; ACL is protected and limited to the current user, SYSTEM, and Administrators.
- Policy: full dump (`DumpType=2`), capped at 2; free-space budget was checked before apply. No dump or credential data is in Git.
- Pre-change registry/AeDebug/WER and folder state is saved under the same user's local `diagnostics\engine-wer-config-backups` directory. `scripts/configure-zdj-node-wer.ps1 -Mode Verify` returned `WER_READY` at 12:44:43 +08.
- Local fixture: an isolated managed `node.exe` crash produced a 71,207,372-byte `MDMP` full-memory dump for PID 12440, SHA-256 `a453acffc48cfad0454c10ee678e477d7c7e90248e26bc021570403f9daf10c6`. Matching local Application Error/WER records were observed. The dump remains local.
- Limitation: `node.exe -e "process.abort()"` did not produce a WER dump on this runtime. The managed same-image fixture verifies LocalDumps service/policy and full-dump output, not native Node/V8 fatal-signal capture. PID 8524's historical `0xC0000409` cause remains `UNKNOWN`; no matching dump/call stack was found.

## Independent observer

- Read-only observer: `scripts/observe-zdj-engine-readonly.ps1`; one exact-identity sample was sealed locally at `C:\Users\5700x\AppData\Local\ZDJMITS\diagnostics\engine-observer\engine-abae6740-87e3-4e89-9f90-b396426088a9-pid12432-1791518312378-observer20261009-123840.jsonl`, SHA-256 `ef545177f56428c30abe3f23954ab5e4ec71f2b0d8a475bc89893b62ff187257`.
- The sample binds PID 12432 to process creation time, parent host PID 11992, launch ID, instance `abae6740-87e3-4e89-9f90-b396426088a9`, build `3.9.8-b40c717775db32ddf33f`, and HTTP 200 `/health` READY. It also records resource pools, model/proxy listener owners, and event record metadata.
- Task `\ZDJMITS\ZDJ-MITS-Engine-Crash-Observer` is registered with no Engine lifecycle actions and is Running. Its first attempt exposed a FollowCurrentReceipt expected-build comparison against an empty parameter; after correction, the 12:47:26 +08 observer log contains two PID/instance/build-bound samples separated by 45 seconds. The JSONL is still open and growing, so no final file hash is claimed.
- Raw WER dumps, private logs and raw crash evidence remain local. Only redacted metadata and hashes are eligible for GitHub.

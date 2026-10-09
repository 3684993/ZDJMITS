# V3.9.8 crash capture arming receipt

## Final state after PR #12 merge and controlled cutover — 2026-10-09 12:59 +08

- WER LocalDumps re-verified `WER_READY` at 12:58:24 +08: `node.exe`, full dump (`DumpType=2`), count 2, protected ACL with only SYSTEM/current user/Administrators, and the local backup manifest present. Raw dumps remain local and were not uploaded.
- The independent task `\\ZDJMITS\\ZDJ-MITS-Engine-Crash-Observer` is Running. Three samples are present for current PID 22988 / instance `322685fa-bd92-4f3b-9257-fd15a2ffdc68` / build `3.9.8-97aa98c71e15a39ef7b6`; each binds the runtime identity and host receipt and reports HTTP 200 READY. The latest sample was 12:58:37 +08. The task has read-only sampling and no Engine lifecycle action.
- The current source/artifact/runtime identity later closed 6/6 against `main` at `a742e3aa3e0f14678178c508ccbde38b8406d97b` (see merge closeout). The observer's earlier per-sample `sourceCommit` field was `SOURCE_COMMIT_NOT_RECORDED`; SHA identity closure supplies the independent source/artifact proof.
- The isolated managed same-image fault previously confirmed WER policy operation, but native Node `process.abort()` did not emit a dump in that fixture. Therefore native fatal-signal capture is **not proven**. Historical PID 8524 `0xC0000409` component/callsite and trigger remain `UNKNOWN`; this receipt does not claim that the historical crash was reproduced or explained.

Raw dump, exchange/private payloads, and full observer JSONL remain on the host only. The prior sample digest is retained below; the actively growing current observer stream is not assigned a final hash.

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

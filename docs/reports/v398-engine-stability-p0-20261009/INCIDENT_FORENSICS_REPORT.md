# V3.9.8 Engine P0 crash forensics — PID 8524

**Status:** `FORENSICS_ONLY`; stop cause class is proven, triggering component/callsite remains `UNKNOWN`. No source has been changed, and no Engine lifecycle or exchange action was taken during this investigation.

**Repository baseline:** `3684993/ZDJMITS` `origin/main` at `b5db4710c6cc4d7be6f0af0b7c744bef242c4ef0`, fetched 2026-10-09. GitHub Actions run [37864514697](https://github.com/3684993/ZDJMITS/actions/runs/37864514697) was `in_progress` at 2026-10-09 00:30:51 UTC; it is not a success claim. The actual loaded Engine was from commit `5fe95a8662639571ac27e2ae1580c5994847ff77`, build `3.9.8-7271c941c2cdec049610`, instance `c685f035-1f52-48ac-80fa-998811ff3fe5`, PID 8524. Its path was `D:\MITS-WORKTREES\v398-entry-quality-20261008\apps\engine\dist\main.js`. The Engine source and launcher files directly relevant to process exit are byte-for-byte unchanged between `5fe95a8` and current `main`; later offline trade-record edits are not evidence of this crash.

## Finding

The missing PID was not inferred from an absent HTTP listener. The parent launcher recorded `CHILD_EXITED` for PID 8524 with exit code `-1073740791` (`0xC0000409`) at **2026-10-09 07:16:58.349 +08 / 2026-10-08 23:16:58.349 UTC**; the lifecycle row itself was appended at 07:16:58.351 +08. Microsoft documents `0xC0000409` as a user-mode fail-fast exception which bypasses exception handlers. The code alone does not provide the fail-fast subcode, faulting module, stack, or trigger, so it does not prove a stack overwrite or implicate a library. [Microsoft Learn: Fail Fast Exception C0000409](https://learn.microsoft.com/en-us/shows/inside/c0000409) and [Microsoft Learn: `__fastfail`](https://learn.microsoft.com/en-us/cpp/intrinsics/fastfail?view=msvc-170).

The first recorded failed HTTP checks were eight GET endpoints at 07:38:46.048 +08, **21m47.699s after the child exit**. A later read-only check at 07:56:37.074 +08 also failed. The latest captured `/health` READY response is 07:00:11.985 +08; this is the latest *known* success in the preserved snapshots, not proof that no later request succeeded. No request-level access log was available to establish the exact last HTTP success.

The last line in this Engine instance's structured runtime log is `BINANCE_USER_DATA` at 07:16:57.109 +08 (1.240s before OS-reported process exit), carrying a TESTNET `ORDER_TRADE_UPDATE` whose exchange transaction timestamp is 07:16:50.299 +08. Immediately preceding records include TESTNET entry submission/creation and `ENTRY_ORDER_REMOTE_STATUS_UNVERIFIED`; they establish the recent work context, not the native faulting stack or causation. It is therefore accurate to say the Engine was processing the Binance user-data path after recent entry-order work; the exact instruction/subsystem active at fail-fast is `UNKNOWN`.

The current event log does not contain a PID/instance-matched Application Error or WER crash record. No PID 8524 crash dump or WER report was found in the bounded inventory of WER ReportArchive/ReportQueue, user CrashDumps, or Windows Minidump directories for 06:30–08:20 +08. The `engine-process-lifecycle.jsonl` has startup and HTTP-listening entries for PID 8524 but no corresponding `UNCAUGHT_EXCEPTION_MONITOR`, `ENGINE_FATAL_HANDLER`, `SHUTDOWN_REQUESTED`, or `PROCESS_EXIT`. This is consistent with fail-fast bypassing in-process handlers; it does not identify the native caller. The host lifecycle's exact child exit receipt remains the strongest direct exit evidence.

This is the same exit status observed in the separate 2026-10-06 foreground crash documented in `docs/reports/crash/ENGINE_NATIVE_CRASH_20261006_FOREGROUND_ANALYSIS.md`. It is a repeated failure signature, not proof of a common trigger: that run ended about 40 seconds after runtime start with a different last recorded subsystem; PID 8524 ran about 70m10.642s after process start and ended immediately after the event sequence above. Both launcher records show Node `v22.23.1`, V8 `12.4.254.21-node.56`, and `--no-maglev`. This contradicts Maglev being active at either observed crash; it neither proves nor rules out other V8/native/runtime causes. No V8 flags were changed.

## Settings and independent incident evidence

Six `SETTINGS_UPDATED` records show versions 248–253 at 06:53:07.387, 06:55:17.774, 06:57:36.357, 07:00:58.920, 07:06:34.300, and 07:15:50.334 +08. The records contain generation/version metadata only; the actor/callsite and setting payload are unavailable in the public evidence. Version 253 precedes the exit by 68.015 seconds. This temporal ordering is not causal proof. The payload was not accessed, copied, reverted, or disclosed.

The bounded Windows Application/System query covered 06:30–08:20 +08 (21 Application events, 7 System events). It found no Application Error/WER record matching PID 8524, instance ID, or `node.exe`; no contemporaneous system reboot/shutdown event was found. The OS had last booted 2026-09-18 22:44:52.820 +08. An 08:04 WER BlueScreen report refers to a minidump named `091826-9671-01.dmp` and is not a PID 8524 user-mode crash record. A 07:10 Defender signature-update failure is unrelated absent evidence linking it to the Engine.

The System log also has four Event ID 2004 records at 06:54:31.157, 07:00:29.419, 07:05:36.999, and 07:12:08.200 +08. Each explicitly reports low virtual memory and names three `llama-server.exe` processes as top users; PID 8524 is not among the three listed. The last report is 4m50.149s before Engine exit. This is **STRONG_EVIDENCE that system-level virtual-memory pressure existed shortly before the crash**, and a material candidate to investigate. It does not establish Engine's own commit/heap use or prove that pressure caused the fail-fast; those counters and a fault stack are absent. Exact event times and bounded raw evidence are referenced in `evidence/RESOURCE_EXHAUSTION_SUMMARY.json` and the local-only evidence manifest.

At 08:28:12.206 +08, PID 8524 and port 8080 were absent; ports 8081/8083/8084 were still listening under their independent model processes. This is a current state snapshot, not evidence that those processes caused the exit. `D:\MITS` remains at HEAD `ea531b5f51e717f0ead322733765f2d6de30b4cb`, 70 commits behind fetched main, with its pre-existing deletion and five untracked paths intact. The `v398-entry-quality-20261008` worktree remains at `5fe95a8`; its source is the loaded Engine identity above. Worktree/status evidence is detailed in `evidence/SOURCE_IDENTITY.json`.

## Classification and limits

| Candidate | Finding | Evidence boundary |
|---|---|---|
| `PROCESS_EXIT_CRASH` | **PROVEN** | Parent launcher observed the same PID exiting with `0xC0000409`; direct Windows fail-fast status. |
| `PROCESS_EXIT_NORMAL_OR_EXTERNAL` | **CONTRADICTED as the primary classification** | Nonzero fail-fast status and no recorded graceful shutdown; an unobserved external action cannot be ruled out absolutely without OS trace/dump. |
| System virtual-memory pressure shortly before exit | **STRONG_EVIDENCE** | Four Windows Event ID 2004 reports between 06:54:31 and 07:12:08 +08; PID 8524 is not in the top-three process lists. |
| Same native status as 2026-10-06 | **PROVEN** | Historical report and this PID's exit receipt; common trigger remains unknown. |
| Exact fail-fast subcode/module/stack or native component | **UNKNOWN** | No matching WER record, dump, exception parameters, or stack. |
| Settings CAS caused exit | **UNKNOWN / unsupported** | Version-only events; no actor, payload, callsite, or causal stack. |
| Event-loop stall caused exit | **UNKNOWN** | Earlier multi-second stall evidence is from a separate observation window and is not joined to this termination. |
| System virtual-memory pressure caused exit | **UNKNOWN** | Pressure was present shortly before exit, but there are no PID 8524 commit/heap samples or fault stack to join it causally. |
| Offline verifier OOM caused exit | **CONTRADICTED** | Those OOM records belong to separate Codex/test processes, not PID 8524. |
| Maglev caused this exit | **CONTRADICTED for the observed run configuration** | Launcher records `--no-maglev` for PID 8524. |

Evidence source coverage, private evidence hashes, exact UTC/+08 timeline, and the machine-readable classification are in `evidence/`. Raw application payloads, full process logs, event text, settings payloads, and any dump remain local; GitHub contains only sanitized facts and digests.

## Conclusion

The immediate failure class is established: PID 8524 terminated by a Windows fail-fast status before the first failed HTTP observation. The code-level trigger is **not yet established**. The supported next step is a bounded, offline diagnostic collector and deterministic classification tests, followed by a separately authorized foreground capture with preconfigured local WER/dump handling if an equivalent natural failure recurs. No broad try/catch, V8 parameter change, business hot-path rewrite, restart, or deployment is justified by current evidence. Runtime status remains `RUNTIME_ACCEPTANCE_PENDING`.

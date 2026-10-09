# Codex local Windows next action: kernel pool tag attribution before WDK installation

Repository: `3684993/ZDJMITS`
Isolated branch: `codex/llama-vulkan-memory-20261009`
Status: `BOTH_27B_STOPPED_9B_ALIVE; KERNEL_POOL_ORIGIN_UNKNOWN; NO_ACTIONS`.
Date: 2026-10-09 (Windows host local +08).

## Your task

This is **not** permission to install any tool or stop a model. First read the current isolated branch's `scripts/llama-vulkan/README.md`, `POST_HARNESS_STOP_AND_KERNEL_POOL_PLAN_20261009.md`, `POST_PRIMARY_STOP_ANALYSIS_20261009.md`, this prompt, and candidate scripts. Do not infer that user's `D:\MITS` tree is clean; preserve dirty files and operate in pre-existing `D:\MITS-worktrees\llama-memory-20261009` or a safe new worktree.

Facts:
- In the actual user's post-stops snapshot, Qwen3.5 9B on 8081 PID12732 remains alive, handles317.
- Two Qwen3.8 27B (8083 and 8084) were deliberately stopped by operator; they must remain stopped until a distinct operator-go/no-go.
- Windows COMMIT ~70/113GiB, free ~42GiB; kernel pools **Paged22.70GiB / Nonpaged7.54GiB** still unusually high.
- Both 27B stops released ~46.7GiB of commit while paged pool declined only ~0.40GiB, nonpaged pool ~1.13GiB. The Windows kernel pool origin is NOT proven and driver blame must be evidence-based.
- `capture-kernel-pool-tags-readonly.ps1` returned POOLMON_NOT_FOUND. This means only that the tool wasn't discovered at its known locations; it does not prove it isn't installed elsewhere. Don't download random poolmon binaries.

## Phase 0: check current host without changing it

Confirm 8080/8081/8083/8084 port owner and process identity and existing static preflight output. Confirm no new Engine Node process. Verify relevant `PowerShell -Version 5.1` x64 and current working tree state. Do not reset, clean, stop, start, change OS pagefile, registry, GPU driver, Windows security config, scheduled task, or enable Driver Verifier. Do not collect private inference payloads, API keys or unfiltered command lines into GitHub.

## Phase 1: install-free native pool tag diagnostic

First run only:
1. `powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"`
2. `powershell -NoProfile -ExecutionPolicy Bypass -File "$review\capture-kernel-pool-tags-native-readonly.ps1" -Mode Validate`
3. If parse and synthetic self-test pass, `powershell -NoProfile -ExecutionPolicy Bypass -File "$review\capture-kernel-pool-tags-native-readonly.ps1" -Mode Capture -Samples 2 -IntervalSeconds 5 -TopRows 20`

This uses `ntdll!NtQuerySystemInformation(SystemPoolTagInformation=0x16)` only to READ per-tag paged/nonpaged bytes, allocs, frees, with a bounded 16MiB managed buffer and x64 ABI checks. **Important:** the 0x16 class's returned binary layout is undocumented and subject to change. A successful synthetic self-test proves only the self-test; verify real tag count, pool bytes and coverage vs OS counters. On failure/status denied/layout mismatch, stop immediately; do not change system settings to force it to work.

After capture:
- Identify paged and nonpaged top tags, bytes, outstanding allocations and short time changes.
- Compare sum-of-tag bytes with Get-CimInstance PerfOS Memory paged/nonpaged pool bytes; large discrepancies mean caution, not a root cause.
- Treat tag->driver mapping as a HYPOTHESIS until verified with locally signed driver binary / authoritative source and repeated snapshots.
- Keep full snapshots in LOCALAPPDATA. Commit only a sanitized, bounded explanation under `scripts/llama-vulkan/` to the isolated branch; no usernames, raw dumps, model prompts or executable path leak.

## Phase 2 (fallback only if native API unsupported): official PoolMon provenance and minimal installation plan

Read Microsoft's official PoolMon documentation:
- https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/poolmon
- https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/poolmon-startup-command
- https://learn.microsoft.com/en-us/windows-hardware/drivers/install-the-wdk-using-winget

First search existing known Windows Kits versions recursively but BOUNDED within trusted `%ProgramFiles(x86)%\Windows Kits` and `%ProgramFiles%\Windows Kits`; check actual installed WDK and signature of any `poolmon.exe`. Do not scan whole disks or download from unknown websites. It may exist at a noncanonical nested path.

If not present, make a precise Microsoft official WinGet/WDK installation PLAN and report dependencies/size/admin requirements. The official docs describe `Microsoft.WindowsWDK.10.0.28000` at the time of drafting; do not execute without verifying current OS, provenance, package ID, user approval and whether Visual Studio/SDK deps would make the install excessive.

**Do not install or invoke elevation automatically. Ask the operator's explicit permission to change Windows software first.** When and only when permission is granted, install solely the required official WDK/PoolMon component if possible (not VS 2026 + all workloads by default), verify Microsoft digital signature + SHA256, avoid reboots/policy changes, then read only per-tag snapshots. Preserve before/after evidence.

## Prohibited

- No GitHub Actions (including workflow_dispatch, rerun); do not push main (a push triggers Actions).
- No blind Vulkan parameter guessing, no unsanctioned llama-server or trading Engine restart, no Windows reboot, memory cleanup scripts, forced handle closure, Driver Verifier or new kernel drivers, no pagefile tweaks.
- No arbitrary open-source `poolmon.exe`, `PoolTag.exe` from forums or unsigned mirrors.
- No claim that 0xC0000409 Engine native fail-fast is fixed without a native dump/subcode/stack; the present diagnostics only identify memory pressure, not crash causality.

## Deliverables

- Report exact PASS/FAIL of Windows PowerShell parse, native self-test, native x64 per-tag query with status if failed, top paged/nonpaged 20 tags if successful, timestamp and perf-counter cross-check.
- If needed, official WDK installation plan requiring user's approval (not execution without approval).
- Minimal audited code fixes only if proven bug, as commits to `codex/llama-vulkan-memory-20261009` or local-only if branch push rules changed.
- Clean distinct status `NATIVE_POOL_TAGS_CAPTURED`, `NATIVE_QUERY_UNSUPPORTED_OFFICIAL_WDK_PLAN_PENDING_AUTHORIZATION`, or `ROOT_CAUSE_STILL_UNKNOWN`.

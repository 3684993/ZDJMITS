# 2026-10-09 09:59 +08 — native pool-tag evidence and Filter Manager investigation

**Current state:** `POOL_TAGS_CAPTURED` / `FILE_SYSTEM_STACK_PRIMARY_HYPOTHESIS` / `KERNEL_POOL_RETAINED` / `ROOT_CAUSE_NOT_PROVEN` / `NO_MODEL_RESTART`.

This is a privacy-filtered extract of the user's local native query output, not the raw host JSON. The native reader uses **undocumented** `NtQuerySystemInformation(SystemPoolTagInformation=0x16)` with assumed x64 entry layout, so results remain experimental even though the returned count and tag sizes look plausible. Do not claim this is an official PoolMon validation, and do not treat the synthetic parser selftest as an OS-ABI proof.

## 1. Verified user-supplied snapshots, with two 5.4-second samples

- OS API reports `10.0.26200.0` but **UBR/full cumulative patch level not yet collected**.
- 2026-10-09 01:59:10.734Z and 01:59:16.132Z; 3,517 pool tags each.
- Windows memory counters: Paged Pool **22.6974 GiB**, Nonpaged Pool **7.5423 GiB**.
- Sum of all native tag entry bytes: Paged **19.6353 GiB**, Nonpaged **6.1200 GiB**. Differences (~3.062 GiB paged, ~1.422 GiB nonpaged) mean pool tags do **not** fully cover OS counters and require caution.
- Two large 27B llama-server processes PID51124 Primary/8084 and PID17468 Harness/8083 have already been stopped by the user. 9B PID12732/8081 remains live, 317 handles. Before the stops the 27Bs showed 10,631,013+2,451,581 handles; a corresponding direct object identity link has not been proven.

### Top paged tags

| Tag | GiB | Outstanding allocations (allocations-frees) | Attribution status |
|---|---:|---:|---|
| `FMfn` | **12.7989** | **38,176,822** | Windows Filter Manager file-name related pool tag; broad component attribution supported, allocation origin unknown |
| `Ntfc` | 1.8958 | 12,722,740 | filesystem/NTFS-context hypothesis, not authoritatively mapped on this machine |
| `IoNm` | 1.7121 | 12,741,513 | I/O name-related hypothesis, actual allocation owner unverified |
| `Toke` | 1.5903 | 784,904 | kernel/security token-type hypothesis; avoid driver blame from tag |
| `D2d ` | 0.3788 | 12,711,097 | no verified driver mapping |

### Top nonpaged tags

| Tag | GiB | Outstanding allocations | Attribution status |
|---|---:|---:|---|
| `File` | **4.7545** | **12,762,864** | file-object related tag; exact references/owners unknown |
| `DAL3` | 0.2751 | 1,732 | attribution not verified; cannot blame a GPU driver solely by label |
| `Cont` | 0.1000 | 12,522 | attribution not verified |
| `SeTl` | 0.0936 | 784,904 | attribution not verified |
| `smNp` | 0.0819 | 21,468 | attribution not verified |

`FMfn+File+Ntfc+IoNm` = ~**21.16 GiB** (compared with ~30.24 GiB total OS paged+nonpaged pool). Their counts include several ~12.7 million allocations and ~38.18 million `FMfn` allocations. The strong numerical correspondence with historical 27B process handle counts is a **testable hypothesis, not an object-by-object mapping**. The two 5-second snapshots were flat, so there is **no measured current growth rate** yet; a flat 5 seconds also does not prove absence of earlier growth or future leak.

## 2. External source comparison

1. Microsoft documents `fltmgr.sys` and mini-filter stack concepts:
   https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/filter-manager-concepts
2. Microsoft describes the read-only enumerations `fltmc filters` and `fltmc instances`:
   https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/development-and-testing-tools
3. A **user-submitted Microsoft Q&A case dated 2026-08-04**, with Windows 11 25H2 build 26200.8973, reports unusually similar `FMfn`, `File`, `IoNm` and NTFS pool retention. The responder associated the tags with Filter Manager/NTFS and advised fltmc topology and WPR/ETW, **but said no known, documented fix was identified**. This is a comparable anecdote, **not proof of the same root cause or an official defect acknowledgement**:
   https://learn.microsoft.com/en-us/answers/questions/5966064/windows-11-25h2-kernel-pool-leak-fmfn-and-file-all
4. A 2022 Microsoft Japan Windows support blog explained a `FMfn` memory leak on Windows Server 2012/2012R2 when there are NO active mini-filters. That old *Server 2012* condition **must not be generalized to Windows 11 25H2**; do not blindly modify UAC, antimalware, file filters or Windows system settings:
   https://jpwinsup.github.io/blog/2022/04/19/Networking/TCPIP/FMfnLeak-without-Minifilter/

## 3. Immediate non-destructive follow-up

We added `capture-filter-stack-readonly.ps1` to this GitHub review branch. It calls only the built-in Windows `fltmc.exe filters`, `fltmc.exe instances`, `fltmc.exe volumes`, plus read-only CIM and Windows memory/build registry values. It never loads/unloads/attaches/detaches a filter, never stops a service, and keeps full stdout/volumes in LOCALAPPDATA. Parses the mini-filter names/altitudes/frames and searches Win32_SystemDriver service names only as a HEURISTIC, not an authoritative driver match.

Run from Windows PowerShell in isolated Git worktree:

~~~powershell
git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\capture-filter-stack-readonly.ps1"
~~~

If fltmc reports `Access is denied`, do not change policies or disable security. Review whether the read-only command can be run from an operator-approved elevated PowerShell. Never call `fltmc unload` or `fltmc detach`.

For a long enough growth baseline, rerun the existing `capture-kernel-pool-tags-native-readonly.ps1 -Mode Capture -Samples 2 -IntervalSeconds 5 -TopRows 20` after an interval of 10–30 minutes of ordinary host operation (no synthetic I/O load). Then execute `compare-kernel-pool-tags-readonly.ps1`; its report compares the latest two separate capture files and avoids assuming a tag absent from Top-N has zero size. This is not an automation; no background work is requested or offered.

## 4. What can be fixed now, and what cannot

**Supported:** The two 27B processes contributed around 46.74GiB of host commit; stopping them reduced pressure substantially while leaving 30.24GiB of kernel pool. A major residual fraction is associated with file-name/file-object tags.

**Unknown:** Whether a third-party minifilter, Microsoft filter path, filesystem cache retention, buggy application I/O pattern, or some combination caused the old allocations. Driver-specific attribution and native stack/ETW evidence are still missing. OS patch build, filter topology, and time slope required.

**Do not do:** blanket `fltmc unload/detach`, disable Defender, turn off UAC, set Driver Verifier/GFlags, change registry/pagefile, reboot Windows, restart/force-close 9B, or restart either 27B. Those all require separate justified testing and operator permission. Do not claim the Engine `0xC0000409` fail-fast is fixed because the pool problem is observed on the same host.

No GitHub Actions and no main push. Evidence-only branch `codex/llama-vulkan-memory-20261009`.

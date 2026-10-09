# 2026-10-09 10:39 +08 — pagefile Apply WMI generated C entry, no reboot

## Actual evidence

User's local Windows PowerShell candidate parser: ALL CANDIDATE POWERSHELL SCRIPTS PARSE PASS, including configure-windows-pagefile-48g-safe.ps1. Original `-Mode Plan` showed autoManaged=True; only D:\\pagefile.sys live, 17408 MiB allocated/139 MiB in use; no explicit Win32_PageFileSetting; `PagingFiles` contained wildcard `?:\\pagefile.sys`. C: free84.31GiB, D:free75.06GiB; host COMMIT70.15/112.93GiB; free42.78GiB; crash dump mode3. Original baseline receipt: local-only pagefile-before-20261009-103729.json.

At `-Mode Apply -ConfirmApply`, script disabled AutomaticManagedPagefile then found `C:\\pagefile.sys` present while attempting to `New-CimInstance`, threw `C_PAGEFILE_CREATED_BY_OTHER_ACTOR`. Old script attempted best-effort rollback, then returned `PAGEFILE_APPLY_FAILED_INSPECT_LOCAL_RECEIPT; DO_NOT_REBOOT_UNTIL_PENDING_SETTINGS_REVIEWED`. The user's output does NOT include local pagefile-apply-error-20261009-103906.json content, so **rollback success/failure currently UNKNOWN**. No user reboot reported. At last verified user snapshot only 9B8081 running, 8083/8084/8080 off.

## Defect and correction

Old code assumed after setting global Win32_ComputerSystem.AutomaticManagedPagefile=false there could not be an explicit C PageFileSetting entry. This assumption was false on this host. Microsoft has historically documented WMI automatic-pagefile setting transitions creating C defaults on other OS builds; this is not proof of a new Windows11 defect:
https://support.microsoft.com/en-us/servicing/os/windows/2017/01/multiple-pagefiles-are-created-when-you-set-the-automaticmanagedpagefile-property-of-the-win32-compu

Candidate revised in independent review branch:
- `Assert-PostSwitchPagefileEntries` accepts only recognized C/D `Win32_PageFileSetting` where min/max are exactly 0/0 and no duplicate. Unknown drive or custom nonzero size fails closed.
- Converts an existing C 0/0 entry IN PLACE to fixed49152/49152 MiB, instead of blindly creating a duplicate; if C absent, creates it.
- Preserves D system-managed 0/0, rechecks after writes and retains full local before/pending receipt.
- On failure restores C original generated 0/0 if this operation changed it, removes only entries created by this invocation, switches automatic management back on, then compares registry wildcard and PageFileSetting count to initial snapshot. Unknown post-rollback state forbids reboot.
- BEFORE NEXT ATTEMPT `-Mode Plan` requires original exact automatic baseline: `automaticManaged=true`, no explicit `Win32_PageFileSetting`, `PagingFiles` exactly wildcard `?:\\pagefile.sys`, one existing D live pagefile, and sufficient free space. Failure means previous rollback not verified; do not re-run Apply.
- `-Mode SelfTest` is no-OS-query synthetic validation that C/D 0/0 is accepted, unknown/nonzero/duplicate rejected. Windows PowerShell actual execution still needed. This test does not prove WMI behavior on host.

## Now — run ONLY read-only checks first

~~~powershell
git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
if($LASTEXITCODE -ne 0){ throw "PARSE_FAILED" }
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode SelfTest
if($LASTEXITCODE -ne 0){ throw "PAGEFILE_SELFTEST_FAILED" }
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode Plan
if($LASTEXITCODE -ne 0){ throw "PAGEFILE_BASELINE_NOT_RESTORED" }
~~~

Require exact `PAGEFILE_WMI_TRANSITION_SELFTEST_PASS`, `PAGEFILE_AUTO_BASELINE_VERIFIED`, `PLAN_ONLY_NO_CHANGES`. No reboot yet, not even a normal restart, until next Apply ends in `PAGEFILE_CONFIG_APPLIED_PENDING_REBOOT` and its receipt is preserved. If baseline failure, report output + sanitized *after/rollback* section of the local pagefile-apply-error-20261009-103906.json; **no automatic cleanup or registry writes**.

ONLY then, from elevated Windows PowerShell and with operator's confirmation:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode Apply -ConfirmApply
if($LASTEXITCODE -ne 0){ throw "PAGEFILE_APPLY_FAILED_DO_NOT_REBOOT" }
~~~

Read `PAGEFILE_CONFIG_APPLIED_PENDING_REBOOT`, pending receipt. After saving work, operator can manually Windows Restart; then `-Mode Verify` MUST PASS before model Start. No auto process lifecycle, trading or production actions by this document.

All changes stay under codex/llama-vulkan-memory-20261009, main stays unchanged.
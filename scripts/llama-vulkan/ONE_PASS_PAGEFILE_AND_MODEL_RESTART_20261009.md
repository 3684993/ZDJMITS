# Windows 11 25H2 — One-pass 48GiB pagefile capacity fix and sequential 3-model restore (2026-10-09)

**User authorized** a plan/script to fix Windows commit headroom and bring back all 3 models and latest 3.9.8 TESTNET Engine. This runbook makes the WINDOWS CONFIG change **explicit** and defers reboot to the operator. It DOES NOT turn off security protections, tweak drivers, destroy any active data, override commit guard or blindly start the Engine. The old Windows file-name pool retention remains; pagefile is a mitigation, NOT a fix for FMfn/File tag accumulation or Engine 0xC0000409.

## Why +48GiB on C instead of buying RAM

User's local 2026-10-09 10:24 (+08) fresh preflight:
- Windows COMMIT 69.903/112.926GiB, free43.022GiB; paged22.701GiB, nonpaged7.549GiB.
- B580 9B remains PID12732/8081 handles317/private14.44GiB; two RX7900 XTX 27Bs 8083/8084 absent; Engine 8080 absent.
- Need at least70GiB free BEFORE attempting full 3-model restoration; +48GiB fixed C:\pagefile.sys may increase limit by approximately48GiB from~113 to~161GiB, giving roughly91GiB free if current usage unchanged. OS reboot may change both usage and D pagefile size; verify actual commit free. Two 27B historic private commit~20.8+24.2GiB, thus target budget leaves room for transient/system/TESTNET Engine.
- Candidate script preserves current D:\pagefile.sys as system-managed (initial/max0), adds fixed 48GiB C pagefile; checks C disk currently free >=64GiB (48G file +16G margin), D free>=16GiB, preexisting only D managed. If ANY assumption fails, abort. No automatic computer reboot or driver/Defender change.

Microsoft references:
- https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows
- https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-pagefilesetting
- https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/slow-page-file-growth-memory-allocation-errors

## Step 1: Windows PowerShell as administrator, dry plan first

Open Windows PowerShell **Run as administrator** (after ensuring all work is saved). Execute:

~~~powershell
git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
if($LASTEXITCODE -ne 0){throw 'PARSER_FAILED_DO_NOT_APPLY'}
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode Plan
if($LASTEXITCODE -ne 0){throw 'PAGEFILE_PLAN_FAILED_DO_NOT_APPLY'}
~~~

Inspect output: current automatic management true; D pagefile exists, C pagefile absent; C disk free >=64GiB, D disk free >=16GiB. If not, DO NOT use the APPLY command. File reports current pagefile and crash dump settings for local-only rollback. The review worktree should be clean for fast-forward; if dirty, do not reset/stash/clean.

## Step 2: explicitly apply ONLY if PLAN PASS and user accepts OS setting change

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode Apply -ConfirmApply
if($LASTEXITCODE -ne 0){throw 'PAGEFILE_APPLY_FAILED_DO_NOT_REBOOT'}
~~~

Expected: PAGEFILE_CONFIG_APPLIED_PENDING_REBOOT. It switches global automatic managed to false, retains D explicitly as SYSTEM-managed, adds C with min/max49152MiB. WMI pending settings are verified. The **currently active** pagefile doesn't expand until boot. Leave pagefile.sys itself alone; NEVER manually delete files. The script will preserve a before/pending local JSON in LOCALAPPDATA. On exceptions it attempts rollback; do not reboot if readback or rollback uncertain. This script does NOT reboot.

## Step 3: operator-managed normal Windows Restart

Once you have saved user work, shut down TESTNET Engine if currently active through its own documented lifecycle (DO NOT force kill) and preserve log files; user currently has 8080 absent. Current 9B 8081 WILL STOP when Windows restarts. From Windows UI choose Restart; no script will call Restart-Computer. This may release historical file-system kernel pool allocations but cannot prove root cause fixed. Confirm no Windows firmware updates or unrelated risky operations scheduled.

After reboot open PowerShell; do not resume old autostart services unexpectedly. Check GPU Vulkan catalog again when needed.

## Step 4: independent pagefile verification — must PASS before ANY model cold start

~~~powershell
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\configure-windows-pagefile-48g-safe.ps1" -Mode Verify
if($LASTEXITCODE -ne 0){throw 'PAGEFILE_VERIFY_SCRIPT_ERROR'}
~~~

Must PRINT PAGEFILE_VERIFY_PASS (otherwise exits nonzero). It requires actual C pagefile allocation>=48,000MiB, intended C setting49152/49152, D setting0/0 and present, host FREE commit>=70GiB. **CHECK LITERAL PAGEFILE_VERIFY_PASS** before proceeding; on failure command exits nonzero.

## Step 5: each optimized script (not a single parallel startup)

The 3 complete scripts reside in THIS review branch. Always check source paths, model files and user-selected llama-server.exe before starting. 27B default 32K context (was64K) and 9B 16K context; these are RESOURCE-OPTIMIZED, not quality-equivalent for every historic prompt. Your tests must confirm exact OpenAI-style aliases and model response/tool compatibility with Engine.

Run **one command at a time**. IF any smoke fails, stop and preserve logs; do not continue to the next model:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.5-9b-vulkan.ps1" -Mode Start -NoWatchdog
if($LASTEXITCODE -ne 0){throw '9B_START_FAILED'}
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\full-recovery-preflight-readonly.ps1" -Enforce
if($LASTEXITCODE -ne 0){throw 'MODEL_BUDGET_PREFLIGHT_FAILED'}
~~~

The full-recovery preflight requires healthy existing 9B AND >=70GiB free at this stage; read the actual output and confirm no ALL_MODEL_RESTART_BLOCKED. If no "RESOURCE_PRECHECK_PASS_ONLY", STOP.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-harness-vulkan1.ps1" -Mode Start -NoWatchdog
if($LASTEXITCODE -ne 0){throw 'HARNESS_8083_START_FAILED'}
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\maintenance-preflight-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\measure-memory-handles-readonly.ps1" -Samples 3 -IntervalSeconds 3
~~~

Require actual model 8083 READY, correct Vulkan1 AMD7900 XTX identity, no >100,000 new handles, host commit free >=40GiB BEFORE second 27B. The script performs this guard inside allocator mutex itself.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-zdj-vulkan1.ps1" -Mode Start -NoWatchdog
if($LASTEXITCODE -ne 0){throw 'PRIMARY_8084_START_FAILED'}
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\maintenance-preflight-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\measure-memory-handles-readonly.ps1" -Samples 3 -IntervalSeconds 3
~~~

Do NOT continue to Engine until all three API calls/aliases/tool/decision smokes pass. 8081 9B B580, 8083 Harness Vulkan1, 8084 Primary Vulkan2. Do not auto-enable watchdog or restart prior processes after failure. Keep host COMMIT far from 90%, monitor kernel pools and handle trend. If both AMD nodes show unexpected handles, HALT Engine restore. Model launcher itself may intentionally terminate *the newly created own child* upon failed startup smoke; never force-kill an existing healthy model.

## Step 6: TESTNET Engine 3.9.8 exact current main source

**Must not simply run npm start or a stale dist.** GitHub main current docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md says latest v3.9.8 offline code has NOT been deployed, old PID8524 stopped UNKNOWN cause, Settings250→253 actor UNKNOWN. Latest-main source/build, account/TP and TESTNET freshness are mandatory before restoring 8080. To prevent accidental live orders:
- Invoke local Codex with this complete authorized, guarded task: [CODEX_V398_CONDITIONAL_FULL_RESTORE_AFTER_KERNEL_POOL_20261009.md](../../docs/prompts/CODEX_V398_CONDITIONAL_FULL_RESTORE_AFTER_KERNEL_POOL_20261009.md).
- First read fresh main, build exact isolated clean worktree, verify TESTNET environment, signed account positions/open orders, required TP and protection identity, live Settings revision/digest, proxy, model routing and no production writes. Do not reset any current SQLite or D:\MITS dirty working tree.
- Existing scripts/start-zdj-engine-host.ps1 requires NodePath/EnginePath/WorkingDirectory/StdoutPath/StderrPath/LifecyclePath/ReceiptPath/LaunchId. Local Codex must derive the correct values from a current accepted release protocol and execute once. Do not invent a guessed stale path. Verify current build 3.9.8, /health READY, identity6/6, no unprotected positions, LIVE Production writes zero. Genuine TESTNET natural TP/order writes may occur and must be reported.
- If any unknown, stop and return a blocker; no forced new orders and no hidden retries.

## Aftercare and safety

- Do not remove C pagefile just because total pool is high, do not force startup after failure. Any file manager pool regressions after reboot warrant a new bounded evidence window.
- Do not start Engine or trade in Production. No GitHub Actions. All private snapshots remain local.
- This is ONE capacity intervention and a staged verification. It cannot guarantee bug-free runtimes; record actual before/after acceptance.

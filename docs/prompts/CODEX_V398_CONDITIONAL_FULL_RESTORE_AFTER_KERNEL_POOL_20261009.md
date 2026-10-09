# Codex on the Windows host: controlled recovery of all three AI roles and TESTNET trading Engine

Date: 2026-10-09 +08. Repository 3684993/ZDJMITS.
Review branch codex/llama-vulkan-memory-20261009; canonical trading Engine release source is CURRENT MAIN, not this review branch.

## User-requested outcome and authority

The operator explicitly requested restoring all three model roles AND the trading system, and asked for a final memory-root-cause conclusion. This grants one controlled TESTNET restore AFTER all fresh safety gates. It DOES NOT authorize pagefile/registry/driver changes, reboot, OS migration, production trading, Settings mutations, manual orders, wiping SQLite, or overriding resource guards. This document is intended for Codex actually operating on the user's Windows PC; GitHub pushes alone DO NOT start physical processes.

## Fact baseline / fixed limits

- Windows 11 Pro 25H2 26200.9457; physical RAM 96GiB.
- 8081 B580 9B PID12732 running, ~317 handles. 8083 Harness27B and 8084 Primary27B intentionally stopped; DON'T kill/restart 9B if healthy.
- Prior 27B PRIVATE commit ~20.79 and ~24.24GiB; their manual stops freed ~46.74GiB host commit. Current remaining host committed ~69.8 / 112.9GiB, free ~43GiB.
- Windows residual paged pool ~22.7GiB, nonpaged ~7.54GiB; tags FMfn12.8GiB, File4.75GiB, Ntfc1.90GiB, IoNm1.71GiB. In 15.42min FMfn +1.128MiB, File +0.253MiB; flat short-term but NOT proven a Windows bug or fixed leak. All 13 detected minifilter service-matched sys files had Microsoft company and Valid signatures, no strong third-party culprit.
- Original 27B handle counts 10,631,013 / 2,451,581. Historical correlation to residual file objects is not proven.
- Latest docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md (main) 2026-10-09 07:40+08 declares Engine3.9.8 latest code feef659 as OFFLINE NOT_DEPLOYED, old PID8524 gone and stop cause UNKNOWN. Settings 250→253 in audit, actor UNKNOWN. Earlier 3.9.8 running closeout describes OLD build 7271c... in v398-entry-quality-20261008 worktree; do not treat as latest production-ready build.
- The candidate model launchers in scripts/llama-vulkan/ require >=40GiB commit FREE for each 27B cold load and forbid >=100000 handle peers; context defaults from 64K to 32K and need role quality/smoke validation. DO NOT LOWER THESE GUARDS.

## A. First: comprehensive READ-ONLY recovery resource and ownership gate

- Read CURRENT_MAINTENANCE_HANDOFF.md, latest v398-trade-record-integrity IMPLEMENTATION_REPORT, release identity instructions, current main code and scripts/start-zdj-engine-host.ps1.
- Preserve dirty D:\MITS; use a separate clean worktree. No git reset/clean/stash, no Actions, no direct main push, no cleanup of runtime state, credentials, logs, TP records.
- Refresh and run the review branch scripts verify-candidate-parse-readonly.ps1, maintenance-preflight-readonly.ps1 and full-recovery-preflight-readonly.ps1. Obtain actual 8080,8081,8083,8084 owner PIDs, 9B health, free physical and committed memory, pagefile parameters, GPU VRAM, watchdog/supervisor state.
- Because both 27Bs previously took ~45GiB private commit plus transients, three-model resource gate conservatively requires >=70GiB currently FREE host commit and total utilization <80%. Current ~43GiB should FAIL. If it fails, STOP WITHOUT STARTING ANY NEW MODEL OR ENGINE. Emit FULL_RESTORE_BLOCKED_HOST_COMMIT_LIMIT, preserve existing 9B.
- Present options as proposals only: (1) user-approved pagefile sizing backed by checked D: free space, crash dump configuration and rollback, (2) lower-memory model profile only if quality and role equivalence already proven, (3) separate Ubuntu pilot. None is included in the present authorization. DO NOT automatically adjust pagefile or force low thresholds.

## B. ONLY AFTER independent approval resolves resource gate

Re-run all fresh checks. Do not assume previous snapshot conditions still hold.
- 8081 existing 9B: do not restart. Verify same actual model/GPU role, listener /health, alias, smoke. If unhealthy, STOP.
- 8083 Harness: start candidate script start-qwen3.8-27b-harness-vulkan1.ps1 with -Mode Start -NoWatchdog once. Use Vulkan1 AMD7900XTX exclusively, verify /health and /v1/responses tool behavior; record memory/handles and current model alias. No auto-kill or silent alternative GPU.
- After confirming 8083 and remaining commit budget, 8084 Primary: start candidate start-qwen3.8-27b-zdj-vulkan1.ps1 -Mode Start -NoWatchdog once with fixed Vulkan2. Verify /health, strict JSON decision smoke, output semantics, memory and handles.
- If any of the three roles FAILS, STOP. Do not fire a second restart or run Engine. Do not silently terminate partially started owned servers without a separate exact PID/creation identity approval. No automatic watchdog launch. Full 3-model-ready gate requires actual RUNNING owner identity and stable resource headroom, not merely PowerShell command return code.

## C. Only after all model roles READY: exact current TESTNET Engine3.9.8 release gate

- Prepare isolated engine worktree from latest verified current-main release; do not run old dist from v398-entry-quality-20261008. Verify source hash, built dist, local test gate, release identity and latest tracked source. Do not trigger GitHub Actions.
- Check actual account is TESTNET and Production write path disabled via fresh independent signed read-only exchange account/position/order evidence; check source and runtime environment, SOCKS proxy, private data readiness, current TP protections for *each* live position, unknown orders and idempotent safety. Settings currently changed since prior release: verify their actual revision/digest and operator provenance; do not reset them.
- Use supported Engine host script scripts/start-zdj-engine-host.ps1 with all mandated inputs (NodePath, EnginePath, WorkingDirectory, StdoutPath, StderrPath, LifecyclePath, ReceiptPath, LaunchId) as prescribed by current release deployment runbook; no guessed npm start shortcuts or duplicate 8080 launches.
- One TESTNET 8080 start only after preflight; capture exact actual build identity, PID, health READY, closeout status, 6/6 identity, role API reachability, private reconciliation freshness, original TP protected and no missing/duplicated/wrong-side/unknown protection, observed production write count zero.
- Real Engine may naturally write TESTNET TP/order actions, including protection orders, after starting. These are not '0 exchange writes'; report explicitly. The native 0xC0000409 cause remains UNKNOWN: preserve logs and do not claim crash fixed by this project.
- If unsafe or unknown: leave Engine off, output exact blocker and do NOT override.

## D. Report

For every state, state EXACT Windows timestamp, host commit pool, stage, new/existing PIDs, ports, physical GPU role, model API smoke, Engine build SHA, version, TESTNET/prod environment and verification. Public GitHub only a sanitized report to review branch. Raw local logs remain on user's Windows system. No Actions or main push.
If resource blocked, explicitly say this was NOT performed and recommend user opt-in to pagefile adjustment, no promise to finish in background.

## Ubuntu option

Intel's xe GPU docs say B580 fully supported by Linux kernel >=6.12 (appropriate Ubuntu HWE), AMD official ROCm supports RX7900XTX on specified Ubuntu version/kernel pairs, llama.cpp has Linux Vulkan backend. A separate reversible Ubuntu trial can avoid Windows Filter Manager accounting, but cannot guarantee app/driver bug disappears. Do not alter OS in this recovery task.

## 2026-10-09 10:27+08: OPERATOR-DRIVEN PAGEFILE FIX AND THREE-MODEL START TAKES PRECEDENCE

The user is now choosing to apply scripts/llama-vulkan/configure-windows-pagefile-48g-safe.ps1 (Plan->Apply -ConfirmApply->manual Windows reboot->Verify) and **operator will personally start all three optimized scripts** according to scripts/llama-vulkan/ONE_PASS_PAGEFILE_AND_MODEL_RESTART_20261009.md. Thus the older Stage A / Stage B language requiring no 8083/8084 listeners, 70GiB cold-start headroom, or Codex launching these two models applies **only BEFORE the first cold load**, not once all three are already healthily running.

When local Codex receives this task AFTER operator reports all three models READY: **do not call the pre-start full-recovery-preflight-readonly.ps1 as the engine-start gate** because it intentionally refuses existing 27B listeners. Instead, read-only verify three exact listening owners, role aliases, GPU assignments, /health plus role-appropriate real smoke, watchdog status and CURRENT physical/committed headroom. A safe minimum post-load FREE commit is 16GiB and <85% committed, with no active llama-server >=100000 handles; any failure blocks Engine but does NOT authorize terminating existing models. The 16GiB value is a conservative operational gate, not an OS-defined guarantee. Monitor pools and loaded models over normal observation interval; do not resurrect two model launch scripts if operator started them successfully.

Then perform ONLY Stage C one-shot latest-main TESTNET Engine deploy after independent exchange/TP/Settings/Production authorization verification; no direct old npm start, no database or order mutation in diagnostic steps, preserve dirty checkout. If all three are not READY, stop without Engine. This addendum is newer than older statements that pagefile change requires separate permission: the operator has now explicitly requested scripts for the pagefile capacity repair, but only literal -Mode Apply -ConfirmApply executes that OS change, and only the operator decides Windows reboot.

# Codex Windows local task: investigate FMfn / File kernel pool retention (NO ACTIONS / NO OS MUTATION)

Repo: `3684993/ZDJMITS`
Branch: `codex/llama-vulkan-memory-20261009`
Date: 2026-10-09

## Purpose

The user's 96GiB Windows machine (Windows Kernel build 26200; UBR not yet known) originally ran three GPU-isolated llama-server models. The two 27B models were intentionally stopped by the user under an explicit identity-checked maintenance process, leaving 9B 8081 running. Those stops released ~46.74GiB of Windows committed bytes, but **Paged Pool remains ~22.70GiB and Nonpaged Pool ~7.54GiB**.

The install-free local x64 native query returned 3,517 tags with two stable short samples:
- paged `FMfn` **12.7989GiB** with **38,176,822** outstanding;
- nonpaged `File` **4.7545GiB** with **12,762,864** outstanding;
- paged `Ntfc` **1.8958GiB** with **12,722,740** outstanding;
- paged `IoNm` **1.7121GiB** with **12,741,513** outstanding;
- paged `Toke` **1.5903GiB** with **784,904** outstanding.
Total native tag entries account for 19.635/22.697GiB paged and 6.120/7.542GiB nonpaged, i.e. incomplete accounting, not a full memory dump. Native query is an undocumented interface. Old 27B processes had 10,631,013 and 2,451,581 handles, now exited. The ~12.7M correlations are numerical, **NOT proven object identity**.

Read:
1. `scripts/llama-vulkan/NATIVE_POOL_TAG_FINDINGS_20261009.md`
2. `scripts/llama-vulkan/POST_HARNESS_STOP_AND_KERNEL_POOL_PLAN_20261009.md`
3. `scripts/llama-vulkan/CONTROLLED_MAINTENANCE_RUNBOOK_20261009.md`
4. Current three full candidate model PS1s and current diagnostic scripts.
5. Microsoft's minifilter architecture and diagnostics: https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/development-and-testing-tools, https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/filter-manager-concepts .
6. Comparable but *unconfirmed* 2026-08-04 Windows11 25H2 26200.8973 FMfn+File case: https://learn.microsoft.com/en-us/answers/questions/5966064/windows-11-25h2-kernel-pool-leak-fmfn-and-file-all .

## Step 1 — safe local filter topology and host OS patch identity

Use isolated clean worktree and the checked-in read-only `verify-candidate-parse-readonly.ps1` then `capture-filter-stack-readonly.ps1`. It executes only the built-in `fltmc filters`, `fltmc instances`, `fltmc volumes`, CIM and registry READS. Check installed minifilter names, active instances by volume, altitudes and frame; identify any 3rd-party filter **as a suspect for investigation, not guilt**. Inspect whether C:/D: have filters and report exact Windows UBR.

If fltmc denied without elevation, report precisely; only invoke an approved elevated READING session, do not change UAC/service/policy. If unexpected script errors, fix the script on isolated branch, rerun parser. Save full fltmc stdout, device volume names, driver paths locally; Github gets only sanitized tables. For actual candidate driver identification read the local Win32_SystemDriver Name/PathName, verify signed driver publisher/hash/version using normal Windows read-only APIs, ensure no service name mismatch. Do not invent driver signers from tag names. Limit enumeration; no scanning entire C:/ or new downloads.

## Step 2 — tag time trend in absence of two 27B models

Wait only as long as user already specifies/authorizes; do NOT offer asynchronous work without scheduling. If directly running in an active local Codex session, sample now and again during the session after ~10–30 minutes of ordinary background activity, no synthetic millions-of-opens workload. Use `capture-kernel-pool-tags-native-readonly.ps1` twice in separate invocations; then `compare-kernel-pool-tags-readonly.ps1`. Collect exact bytes / allocations / frees and compare FMfn, File, Ntfc, IoNm, Toke and total paged/nonpaged. If trend flat, state flat for this window only. If up, quantify MiB/hr with timestamps; don't claim leak from one snapshot.

Separately check for non-llama processes with extreme handle counts; use lightweight Get-Process/CIM, **not** million-handle enumeration and not recursive file IO. Don't stop currently running 9B, don't restart 27B, don't start Engine. The preexisting 13M handles are a quantitative lead, not proof of current open handles.

## Step 3 — evidence-based attribution/mitigation plan only

Map suspect Windows Filter Manager `fltmgr.sys` and file-system stack `ntfs.sys` vs loaded mini-filters. A pool tag denotes an allocator path, not necessarily the offending caller. Specifically: a Microsoft Japan Windows support article from 2022 describes FMfn leaks on Server2012 with NO loaded mini-filters, **not** an established Windows11 workaround. Do not modify UAC or Defender based on it. User-reported Microsoft Q&A 2026 similar build says no confirmed general mitigation, recommend controlled ETW/WPR/WPA traces and vendor/Microsoft support case when reproducible.

If attribution remains unknown, write `FILTER_STACK_AUDIT_ROOT_CAUSE_PENDING` and propose a strictly scoped, operator-approval-gated kernel pool ETW trace plan: tool availability, provider names, CPU/disk/memory budgets, privacy/path metadata, bounded duration, evidence/rollback. **Do not activate ETW tracing or install WDK without explicit approval.**

Absolutely no blanket filter unload, attach/detach, Driver Verifier, forced handle close, registry/pagefile changes, OS restart, model restart, Engine changes, GitHub Actions/workflow_dispatch, main push or production trading writes. Keep original logs and any dirty worktree preserved. For any uncertain evidence, label `UNKNOWN`.

## Deliverables

- Windows parse result, fltmc filters/instances status, exact filter names and which volumes they attach to (sanitized), driver signers/versions if directly verified, Windows UBR;
- top five tag trend with precise before/after and interval, plus OS memory counters;
- confidence-graded finding: established Filter Manager broad allocation category, suspected responsible filter(s) conditional, root cause UNKNOWN unless proof;
- concrete least-risk fix/mitigation choices ranked by evidence; mention operational pagefile/reboot only as separate authorized resource mitigation, not root fix;
- commit sanitized summary to this **isolated review branch only**, do not use Actions.

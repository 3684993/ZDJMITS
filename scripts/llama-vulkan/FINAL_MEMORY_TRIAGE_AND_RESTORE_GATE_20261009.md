# 2026-10-09 +08 Stage closure: Windows memory/pool triage and conditional full-service restore

State: DIAGNOSTIC_PHASE_COMPLETE / HISTORIC_RESOURCE_RETENTION_PROVEN / OS_BUG_CAUSE_UNPROVEN / FULL_RESTART_CURRENTLY_BLOCKED / ENGINE_0xC0000409_ROOT_CAUSE_UNKNOWN.

## Evidence and durable closure

1. Before model intervention on Windows 11 Pro 25H2 26200.9457 (96GB DDR4), three model processes consumed 116.68GiB committed /117.98GiB commit limit; paged pool 23.10GiB, nonpaged pool8.67GiB. Two 27B models showed verified Get-Process AND CIM handles 10,631,013 (Primary/8084) and 2,451,581 (Harness/8083); B580 9B/8081 handles317.
2. Operator-consented exact process stops (8084 then 8083) freed approximately 46.74GiB global committed bytes, and reduced total paging pressure. 9B PID12732 stayed alive; 8080 Engine was not running. Afterward system committed~69.8GiB/limit112.9GiB, paged pool22.70GiB, nonpaged pool7.54GiB. OS pagefile capacity changed dynamically, distinct from per-process private memory.
3. Undocumented native SystemPoolTagInformation sampled 3517 tags; top paged FMfn12.7989GiB, Ntfc1.8958GiB, IoNm1.7121GiB; top nonpaged File4.7545GiB; Toke1.5903GiB. Sum of exposed tags doesn't equal Windows total pools; numbers are diagnostic, not full kernel dump. A large retained file-name and file-object allocation footprint is supported; actual allocation caller / original high-handle process mapping remains unproven.
4. Independent 15.42 minute snapshots: FMfn +1.128 MiB (+3046 outstanding); File +0.253 MiB (+664); OS paged22.697→22.699GiB, nonpaged7.542→7.540GiB. This demonstrates **NOT rapidly rising in this sample window**. It does not exclude prior growth, later recurrence or dormant resource leaks.
5. Local fltmc filters/instances/volumes all exit0: active volume filters include WdFilter, FileInfo, bfs, UCPD, Wof, gameflt. 13 matched driver files report Microsoft Corporation and Valid Authenticode; no obvious third-party MiniFilter in this enumerated stack. Presence does NOT attribute FMfn or File allocations to any specific one. Do not disable Defender/UCPD/UAC.
6. Windows build 26200.9457; a related Microsoft Answers post on earlier build had similar tags but does not prove Microsoft's Windows build defective here. Historic FMfn Server 2012 minifilter workaround DOES NOT apply to this 2026 Windows11 machine.
7. A native Windows Engine failure 0xC0000409 remains separately unproven. Model memory pressure makes instability more likely but does NOT demonstrate causality. The latest main maintenance handoff declares 3.9.8 new source feef659 verified offline NOT_DEPLOYED and stopped Engine PID8524 with UNKNOWN stop cause. It also reports Settings 250→253 audit actor UNKNOWN, so no stale settings/permissions assumption.

## Executive recommendation

- **CLOSE** the current exploratory memory tag/driver inventory phase as adequate to make next decisions. Stop repetitive 5-second snapshots and endless GPU/V8 flag guessing.
- **DO NOT** declare a confirmed OS kernel defect, AMD/Intel driver defect, recovered handle leak root cause, or fixed Engine native crash.
- **DO NOT** buy extra physical RAM as first step. 96GiB RAM had about44GiB available after stopping 27Bs; Windows commit limit~113GiB and residual~30GiB kernel pools, rather than RAM capacity alone, are the primary immediate constraints.
- For Windows near-term use: an **operator-approved** pagefile plan can increase commit limit without buying RAM; size depends on historical peak and crash-dump policy. This is not leak repair and could cause disk paging; verify actual D: free bytes before proposing any size. Never automatically edit system pagefile or reboot.
- For Ubuntu: worthwhile reversible dual-boot/test-machine A/B. Intel Arc B580 xe kernel full support at kernel6.12+ and AMD Radeon7900 XTX officially supported by specific Ubuntu+ROCm versions. Test llama.cpp Linux Vulkan or AMD HIP roles, exact aliases, chat templates/response format, endpoint smoke, VRAM/commit/RSS/driver stability. Linux excludes Windows fltmgr pool machinery but does not guarantee a general application driver bug cannot recur. No system migration authorized.
- **CURRENT FULL RESTART IS NOT SAFE**. Free Windows host commit ~43GiB is less than two 27Bs' measured combined private commit 20.8+24.2GiB, with NO headroom for cold loads and Engine. 27B launch scripts each require >=40GiB free before cold load; first may start but second likely fails. Preflight all-service budget conservatively requires >=70GiB free and ratio<80%, with no >100,000 process handles. The current state fails. Do not start one 27B and imply all 3/Engine are restored.
- Keep already running 8081 9B; 8083 Harness and 8084 Primary remain stopped; 8080 Engine remains off. Cannot remotely start user's Windows processes from a GitHub connector.

## User-requested restore implementation / ownership

A read-only gate lives in scripts/llama-vulkan/full-recovery-preflight-readonly.ps1. It prints exact budget blockers and writes local-only JSON, NEVER starts processes. Run after fetching review branch:

    git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
    $review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
    powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
    powershell -NoProfile -ExecutionPolicy Bypass -File "$review\full-recovery-preflight-readonly.ps1"

Detailed one-time conditional process-start instructions for **local** Codex are at docs/prompts/CODEX_V398_CONDITIONAL_FULL_RESTORE_AFTER_KERNEL_POOL_20261009.md.

Restoration is conditional on fresh approved resource budget (and independently authorized pagefile changes if selected), exact 9B/8083/8084 model health+alias+GPU checks, latest main Engine 3.9.8 build and runtime identity, TESTNET-only environment, current read-only exchange positions/open-orders/TP protections, production writes zero, and guarded exact one-shot deployment. No Actions, no default main push, no private database changes, no force restart or manual trading. MODEL/ENGINE RELEASE REMAINS BLOCKED until gate actually passes on the Windows machine.

## Public external evidence

- Windows commit/pagefile sizing: https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows
- Intel Arc B580 xe driver and Linux kernel: https://dgpu-docs.intel.com/overview/supported-hardware/xe-driver-gpus.html
- AMD Radeon 7900 XTX ROCm and Ubuntu matrix: https://rocm.docs.amd.com/projects/radeon-ryzen/en/docs-7.2.1/docs/compatibility/compatibilityrad/native_linux/native_linux_compatibility.html
- llama.cpp Vulkan and HIP support: https://github.com/ggml-org/llama.cpp

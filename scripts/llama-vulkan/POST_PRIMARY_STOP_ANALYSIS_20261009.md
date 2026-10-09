# 2026-10-09 09:41 +08: Qwen3.8 27B Primary 8084 单独停止后的内存/句柄差异分析

**状态：`PRIMARY_STOP_CONFIRMED` / `RESOURCE_PRESSURE_MITIGATED_NOT_RESOLVED` / `CRASH_ROOT_CAUSE_UNKNOWN`。** 本报告依据用户在本次会话提供的原始控制台输出和 09:41 的三次本地采样 JSON 数据；不能视为 live Engine/Native DLL 根因证明。所有原始文件仍仅在用户本机；报告不包含账号、全量进程命令行、交易私密数据。

## 1. 已确认的操作、证据

- Windows PowerShell 候选 6 个文件 ParseFile 检查 `PARSE PASS`；此验证仅证明语法能解析，非所有运行路径通过。
- 操作员明确执行 `-Mode Stop -ConfirmStop -ExpectedServerPid 51124 -ExpectedStartUtc '2026-10-05T05:45:30.4119803Z'`，返回 `STOP_CONFIRMED role=ZDJ_PRIMARY_BRAIN port=8084 pid=51124`。这个角色已退出，未重新启动；没有自动结束 8081 或 8083。
- 停止后的 `maintenance-preflight-readonly.ps1` 显示 8084 listener absent、8083/8081 仍存活；显示 `MAINTENANCE_RESTART_BLOCKED` 是期望的 fail-closed 状态。
- 09:41:42 / 45 / 49 UTC+0 后续 3 份采样：`commitFreeGiB=22.928/22.925/22.866`；Paged Pool `22.826/22.825/22.826`，Nonpaged Pool `7.914/7.913/7.913`。Harness PID17468 handles `2451581`、Private Bytes `20.785GiB` 一致；9B PID12732 handles `317`、Private Bytes `14.437GiB` 一致。

## 2. 前后严格对照（单位 GiB，前为09:35，后为09:41；四舍五入）

| 项目 | 停止 8084 前 | 停止后 | 变化 |
|---|---:|---:|---:|
| Windows Committed Bytes | 116.68 | 91.32 | **减少约25.36** |
| Windows Commit Limit | 117.98 | 114.32 | **减少约3.66** |
| Windows Commit Free | 1.297 | ~23.00（随后22.93→22.87） | **增约21.7** |
| System Paged Pool | 23.10 | 22.83 | 减约0.27 |
| System Nonpaged Pool | 8.67 | 7.91 | 减约0.76 |
| Primary 8084 HandleCount | 10,631,013 | 进程/监听已退出 | 对应进程句柄表随退出消失 |
| Harness 8083 HandleCount | 2,451,581 | 2,451,581 | 短观察期无变化 |
| 9B 8081 HandleCount | 317 | 317 | 短观察期无变化 |

**解释限定：** `Committed Bytes` 与 `Commit Limit` 是不同量。现场 D: 系统管理 pagefile 上轮 allocated=22581MiB，而本轮为18720MiB；limit 随之下降，与 Windows 动态调整 pagefile 的行为相符，但没有 OS 决策日志，不能仅凭两个快照证明唯一机制。页面文件 `CurrentUsage~136MiB` 不表示 22GiB pagefile 对 Commit Limit 毫无作用。可参阅官方 Windows 页面文件说明：https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/how-to-determine-the-appropriate-page-file-size-for-64-bit-versions-of-windows 。

## 3. 本次对根因的约束

**PROVEN（直接证据）**：

- 8084 Primary PID51124 单独结束后，系统 commit charge 大幅下降约25.36GiB，物理可用内存由先前约18GiB增至约24.9GiB，说明它与相当大的进程资源保留直接相关。
- 8083 Harness 残留245万句柄，且 PagedPool约22.8GiB、NonpagedPool约7.9GiB仍异常高。

**SUPPORTED BUT NOT CAUSAL PROOF（可怀疑，不应宣称已根治）**：

- 停止 8084 后 paged/nonpaged pools 小幅下降，可能释放了部分关联内核对象，但剩余池仍过大。PoolMon 提供 per-tag bytes/allocs/frees 才能定位潜在内核分配者；不能凭总量指认 Vulkan、AMD 显卡或 llama.cpp 本体。
- 同日 PID8524 的 `0xC0000409` Windows native fail-fast 与系统级 commit 压力存在时间相关，但缺少同PID native dump/stack，**不能说此次 Primary 停止“修复了 Engine 崩溃”**。
- 这两段不到一分钟的前后快照不等于持续24小时稳定；句柄数暂时不变不排除既有资源泄漏。

## 4. 推荐下一轮：保全 8083 证据、再单独停止、观察回收；暂不重载

**用户必须先确认 Harness 8083 上没有未完成的 Codex/AI 请求**。同时重新确认 8080 Engine 端口无监听、相应 Node Engine PID 未运行、准确 PID+创建时间未变化。提交额度只有约23GiB，远低于下一次27B冷加载最保守40GiB门槛，**不允许启动任何27B**。

1. 先将现有三份诊断文件哈希、08:03?（实际日志时间以其自身内容为准）、模型stderr/watchdog日志留本机；不要公开 8083 全量命令行/模型消息、不要对245万句柄进行未经预算的大规模枚举。
2. 如本机已装微软 Sysinternals Handle，则可在资源余量稳定后**单独批准**对PID17468执行摘要 `handle.exe -s -p 17468`（官方参数）；这可能枚举245万对象而耗时/占资源。严格限定输出到本机、超时、失败不反复重试；并非必备关卡。如本机已装 Windows Driver Kit PoolMon，可先读 snapshot 的最大内核池标签，保存本地用于与停止后对比；**不要安装新工具或打开 Driver Verifier**。
3. 获得用户对中断 Harness 服务的单次明确认可后，依 `CONTROLLED_MAINTENANCE_RUNBOOK_20261009.md` 用准确 PID17468/start UTC 的确认参数手动停止**唯一** 8083；如 `STOP_CONFIRMED`，立刻执行现有 `maintenance-preflight-readonly.ps1` 与 `measure-memory-handles-readonly.ps1`，对照系统 Commit、PagedPool、NonpagedPool。不要停止9B（8081），不自动启动任何模型。
4. 若释放后 pools 仍很大，优先追踪 PoolMon 最大的 tags 与 drivers。若 8083 结束后 pools 大幅下降，也只能证明这次 stop 与回收有关，再查对应模型/Vulkan驱动、llama.cpp版本及参数是否造成异常句柄积累。
5. 重新冷加载三模型**必须另行配置足够 commit limit、验证 backend GPU/VRAM、合理 context/KV budget**，先按 role 小负载单独 A/B；决不同时启动三模型。静态模型候选默认 27B Context32K，而原 64K 行为未经过质量等价性验证。
6. 如还要恢复 Engine，必须走原项目专门的 Engine 生命周期/交易安全验收，不由这套 AI 模型诊断脚本擅自启动。

官方工具文档：Handle：https://learn.microsoft.com/en-us/sysinternals/downloads/handle ，PoolMon：https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/using-poolmon-to-find-a-kernel-mode-memory-leak 。

## 5. GitHub 边界

仅把此脱敏对照报告与脚本放在独立分支 `codex/llama-vulkan-memory-20261009`。**不执行 GitHub Actions，不 push main，不远端发布私密 dump/Raw process command line。**

# 三模型异常句柄受控维护 SOP（2026-10-09，Windows）

**当前分类：RESOURCE_PRESTART_BLOCKED；不是 ROOT_CAUSE_FIXED。**

## 核实过的现场事实

用户 2026-10-09 09:35 +08 本机只读预检（私有完整 JSON 不提交）：

| Role | Port | Exact PID | Process Start UTC | Handles | Private GiB | Watchdog |
|---|---:|---:|---|---:|---:|---|
| Qwen3.5 9B / Intel B580 | 8081 | 12732 | 2026-09-18T14:52:52.4843775Z | 317 | 14.437 | stale PID file; not alive |
| Qwen3.8 27B Harness / AMD Vulkan1 | 8083 | 17468 | 2026-10-05T05:44:46.2086993Z | 2,451,581 | 20.785 | stale PID file; not alive |
| Qwen3.8 27B Primary / AMD Vulkan2 | 8084 | 51124 | 2026-10-05T05:45:30.4119803Z | 10,631,013 | 24.244 | stale PID file; not alive |

系统已提交 116.68/117.98 GiB（98.9%），空闲 1.297 GiB；Paged Pool 23.10 GiB；Nonpaged Pool 8.67 GiB。采样时 Engine 8080 listener = 0，匹配 Engine node.exe = 0。**只是一次快照，不保证所有依赖 8083/8084 的外部 AI clients 都空闲。**

Windows Get-Process 与 CIM performance counters 的百万句柄数据一致，多个短采样间数值稳定。不能仅凭句柄总量断言 AMD driver、llama.cpp、Windows 或某模型组件泄漏；需要对照停止后的内存/内核池是否释放。

## 正确原则

- 由操作员自行选择维护窗口、暂停实际依赖这两个模型的任务，并手工确认执行。**不要自动检测然后直接杀三个 PID 重启**；不能凭 Port8080 不监听推定不会影响其他 Codex/HTTP 使用者。
- 只计划第一步**停止 Primary 8084 一项**，在中间检验提交/内核池/句柄是否回收后再做决定；没有必要先停止 9B 8081。
- 当前脚本的 Stop 是 **明确确认后的 Windows Stop-Process -Force**：它不是优雅 drain，可能立即中断 8084 请求，用户需确认任务可中断。不会执行任何交易写入。未知 watchdog、PID重用、不是精确端口所有者、存在 Engine 进程/8080 listener，会拒绝 stop。
- 停止前复核新分支脚本通过 Windows PowerShell 语法检查，确认原始日志已在本机保留，绝不清理 JSONL、sqlite、GPU claim 文件，也不自动改系统 pagefile。
- `llama-server` 特别是 10M 句柄时不建议先对所有句柄做完整列举（例如海量 handle.exe 输出），可能大幅增加本来只剩 1.3GiB 的资源压力。

## 只读刷新（可以立即执行）

~~~powershell
git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
$review='D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\maintenance-preflight-readonly.ps1"
~~~

如语法验证失败，**不得执行后续停止命令**；先反馈报错。注意禁止对工作树的原始 dirty 文件 reset/clean。

## 进入实际维护窗口：显式人工确认后才允许的第一个写操作

**只有在操作员明确同意中断 Primary 8084、确认交易 Engine 以及其他 AI 客户端对该模型无进行中的任务、已检查日志保存位置时**，才能手工执行：

~~~powershell
$review='D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-zdj-vulkan1.ps1" -Mode Stop -ConfirmStop -ExpectedServerPid 51124 -ExpectedStartUtc '2026-10-05T05:45:30.4119803Z'
~~~

此命令会尝试终止 **一个** 8084 PID 51124，不是检测脚本。预检明确匹配 pid/start UTC/role/port/commandline/watchdog、发现任何 PID 漂移或 Engine 重新出现则拒绝。**不得忽视异常而去任务管理器直接结束其他 PID。**

如果命令拒绝或报错，保留原样，反馈输出，不进入下一步，不重复强杀/重启。

### 停止 8084 后立即只读复核

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\maintenance-preflight-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\measure-memory-handles-readonly.ps1" -Samples 3 -IntervalSeconds 3
~~~

只将**文本数值摘要**反馈给 ChatGPT/Codex，包括 commit free、paged/nonpaged pool、8083/8081 handlecount、8084 listener absence；完整本机原始日志不要上传公开仓库。参照停止前 commitFree=1.297GiB、PagedPool=23.10、NonPagedPool=8.67，比较 delta。必须保存停止后的 CSV/JSON manifest（已有诊断脚本自动保存独立文件）。

- 如果内存池明显下降，说明 Primary PID 的结束与资源回收时间上相关，但**不能独立证明 DLL 级泄漏根因**；
- 如果仍接近 99% 或页面文件无变化，**暂停进一步停止或重载**，调查其他 commit/pool 占用；
- 如果发现 8084 自动重新出现（旧 watcher 或外部 supervisor），立即停止维护，调查实际重启者，严禁盲目再次杀进程。

### 第二步：只有收到新的观察结果、且用户明确同意继续，才考虑 8083

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-harness-vulkan1.ps1" -Mode Stop -ConfirmStop -ExpectedServerPid 17468 -ExpectedStartUtc '2026-10-05T05:44:46.2086993Z'
~~~

随后重复两项只读快照。**9B 8081 仍保持运行，除非新证据要求停机。**

### 为什么不是停止后立即启动全部？

新脚本按已测模型私有内存 + 冷启动额外开销 + 留余量，分别要求至少 **40 GiB（每个27B）**、**24 GiB（9B）** host commit free，同时 commit 使用比率 <90%，任何现存 llama-server HandleCount >=100000 则新 cold load 被拒绝。注意这并不是 AI 功能或资源稳定性的证明。

例如两个27B停止后如果 host 仅释放约 45GiB，重启第一个27B后 host free 可能降到不足40GiB，因此**第二个27B应该被阻止启动**。需要依据真实池回收量决定是否在另行授权的情况下扩大页面文件（当前 D: 系统管理 pagefile22.6GiB；C:空余约84GiB、D:约70GiB）或进一步减少进程/缓存/上下文消耗。**页面文件扩大不修复非法地址访问，也不能代替泄漏定位**。

禁止使用 `-EnableWatchdog`、`-Mode Watch` 和三个 `-Mode Start` 连发。实际 restart 必须与用户确认资源预算和各角色 smoke 后才进行。

## 当前事实边界和发布

- 所有脚本与报告只在 GitHub 非 Actions push 触发分支 `codex/llama-vulkan-memory-20261009`；不得推送 main、workflow_dispatch 或 rerun Actions。
- GitHub 远端静态审查不等于本机 PowerShell 语法测试或真实模型运行验证；具体崩溃触发源仍 UNKNOWN。
- 若发现百万句柄和大规模 Windows Pool 不能随着进程结束显著回落，优先考虑 PoolMon/相关驱动分析或独立 Windows 资源维护方案；所有驱动/系统设置调整需另行授权。
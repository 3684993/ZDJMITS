# Windows 三 GPU / 三 llama-server 内存稳定性候选（2026-10-09）

**隔离候选：尚未在用户 Windows 主机上执行验证；未替换 D:\llama-vulkan 的现有三个模型脚本、未修改 Engine/Windows/pagefile、未启用 GitHub Actions。**

## 取自用户 09:10:23 +08 的实际日志（脱敏摘要）

- 物理内存约 96 GiB，剩余可用 18.49 GiB；系统 COMMIT 115.98/117.98 GiB，仅余 2.00 GiB、已用 98.3%。
- Paged Pool 23.09 GiB、Nonpaged Pool 8.66 GiB，不能直接据此指认哪个驱动。
- 自动管理的 D: 页面文件 Allocated 22581 MiB、Used 135 MiB，D: 可用 70.32 GiB。
- 8081 Qwen3.5 9B / Intel Arc B580：PID12732，Private Bytes14.44 GiB，HandleCount317。
- 8083 Qwen3.8 27B Harness / AMD 7900 XTX：PID17468，Private Bytes20.79 GiB，HandleCount **2451581**（须独立复核）。
- 8084 Qwen3.8 27B Primary / AMD 7900 XTX：PID51124，Private Bytes24.24 GiB，HandleCount **10631013**（须独立复核）。
- Windows Event 2004 已反复报告低虚拟内存。尚不能据此直接证明 PID8524 的 0xC0000409 是模型造成的。

## 文件和行为

- ZDJ-memory-first-check.ps1：此前的只读首轮诊断脚本，纳入仓库保存，不再要求上传私有原始日志。
- measure-memory-handles-readonly.ps1：读取 Windows commit/pools/pagefile 与两个独立来源的 llama-server 句柄数，默认 3 次、间隔 3 秒。
- verify-candidate-parse-readonly.ps1：只解析候选 PS1 语法，不加载模型、不连交易所。
- start-qwen3.5-9b-vulkan.ps1：完整原架构候选，B580/8081，默认 Context16K、KV q8_0、ubatch128。
- start-qwen3.8-27b-harness-vulkan1.ps1：完整 Harness 候选，7900XTX/8083，Context32K、KV q8_0、batch512/ubatch128，保留 tool/reasoning/responses 逻辑。
- start-qwen3.8-27b-zdj-vulkan1.ps1：完整 Primary 候选，7900XTX/8084，Context32K、KV q8_0、batch512/ubatch128，保留原别名与输出逻辑。

相较原脚本：冷加载前要求 Host Commit 空余至少 8GiB(9B)/20GiB(27B) 且总占用低于90%；任何存活的 llama-server 句柄数超过100000即阻止新 cold load；已有端口 unhealthy 或 legacy 进程**不得**被新的 Start 命令强制杀掉；默认不启动 Watchdog，必须显式 -EnableWatchdog 才会启用；保留既有崩溃日志而不自动清理；在本机 llama.cpp help 提供 --cache-ram 选项时使用 --cache-ram 0；--ctx-checkpoints 0 保留。新的候选文件不影响已经运行的老 watchdog 进程。

**风险/兼容：** context32K 可能不能满足原 Harness/Primary 的 64K 上下文需求；KV/ubatch 改动也需要做真实请求与质量验证。可以通过 -MaxContextTokens 65536 临时选回，但仅在已有明确资源预算且获授权的维护窗口内。缓存选项随 llama.cpp 构建变化，未在用户本机执行前不能声称支持或速度提升。

## 从 GitHub 拉取到隔离工作树（保留 D:\MITS dirty 文件）

在用户 Windows PowerShell 执行以下命令：

~~~powershell
git -C D:\MITS fetch origin codex/llama-vulkan-memory-20261009
git -C D:\MITS worktree add D:\MITS-worktrees\llama-memory-20261009 origin/codex/llama-vulkan-memory-20261009
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\measure-memory-handles-readonly.ps1" -Samples 3 -IntervalSeconds 3
~~~

如果 worktree 已存在，不要执行覆盖、reset、stash、clean 或 force，先用 git worktree list 核对。诊断 JSON 仅保存到用户本机 LOCALAPPDATA/ZDJMITS/diagnostics；不要上传未经脱敏的机器/进程详情到公开 GitHub。

额外可进行三份脚本的只读状态检查（只发本机 health GET，不启动/停止进程）：

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.5-9b-vulkan.ps1" -Mode Status
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-harness-vulkan1.ps1" -Mode Status
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\start-qwen3.8-27b-zdj-vulkan1.ps1" -Mode Status
~~~

**现在禁止 -Mode Start、-Mode Stop、-EnableWatchdog、手动重启模型、调整页面文件、替换原脚本或部署交易 Engine。** 当前只有 2GiB 提交余量，且百万句柄值尚未确认；上述保护门禁会阻止新冷加载。

## 本机后续根因调查

1. 独立核实 8083/8084 的 Process HandleCount 与 PerfCIM HandleCount，检查短时增量与进程创建时间；若仍百万级，使用本机资源工具确认句柄类型与 PoolMon tag，不得直接认定驱动泄漏。
2. 分析 Windows 已提交额度和内核池的来源。页面文件扩容可能缓解提交额度不足，但不是非法内存访问的根因修复，调整需要用户单独授权。
3. 对照本机 llama-server.exe --version/--help、具体 GPU VRAM、Context/KV/cache 配置，证明新二进制选项是否支持；新候选需要 Windows PowerShell ParseFile + 真实接口 smoke + 质量与资源对比。
4. 保留交易 Engine 8080、已有模型 8081/8083/8084 的运行边界，禁止为了试验影响已有交易安全链。

## 后端选择

**目前首推原生 llama.cpp + Vulkan 继续保留三张 GPU 精确隔离。** Ollama 可以作为后续独立 A/B 性能/内存对照，但先解决 Windows commit/handles，不要立即替换 8081/8083/8084。Alpaca 是 Ollama 的 GUI 客户端，不是独立的底层推理替代品。新候选不是经验证的“彻底修复”，而是资源保护与可检验的调优方案。

## GitHub Actions

本专项只保存在非触发 review 分支 codex/llama-vulkan-memory-20261009。不会发 workflow_dispatch、rerun 或推送 main；任何合并 main 都需要用户另行批准。脚本在本轮只经过静态检查；**尚未在 Windows 运行 ParseFile 或真实模型测试**。
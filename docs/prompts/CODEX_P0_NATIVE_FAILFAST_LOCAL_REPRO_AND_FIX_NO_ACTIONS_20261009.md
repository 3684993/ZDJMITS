# Codex P0 本地修复专项：0xC0000409 native fail-fast 取栈、内存压力复核、根因修复（严格 NO GITHUB ACTIONS）

> **最新用户指令：立即推进 Engine 稳定性修复；需要本地权限、真实 Windows 进程和 dump 的部分由 Codex 在用户 Windows 主机执行。优先获取决定性的故障堆栈，而不是再写一轮只会扫描已有日志的取证工具。**
>
> **资源约束：暂停使用 GitHub Actions，节约额度。不得 workflow_dispatch、rerun、cancel/retry workflow，不查询/依赖 CI 是否成功。此任务只在隔离本地 worktree 执行必要的 targeted 和完整本地验证，完整 stdout/stderr 留文件。** 任何提交先在 **非 Actions 匹配的分支** \`codex/p0-native-failfast-local-20261009\`，不要直接 push \`main\`；禁止自动合并或开一个会导致 Actions 的 PR。当前唯一个 \`.github/workflows/v392-verify.yml\` 的 push branches 是明确列举 main / 旧分支模式，本分支不在列表；每次 push 前重新核对最新 workflow 触发配置，若会触发 Actions，改为**只留本地 commit 与报告**，不 push。禁止以节约 CI 为由关闭生产仓库保护或修改 workflow。
>
> **这份提示词不是根因结论。尚无 PID8524 的 crash dump / fast-fail subcode / faulting module / native stack；不能保证立即彻底消除 bug。此任务必须从具体证据发展到真正修复，否则要诚实报告“定位阻塞”，留下下一次故障必需的取证闭环。**

## A. 从最新仓库证据启动，不用用户复制旧对话

Repo: \`3684993/ZDJMITS\`，原工作目录 \`D:\MITS\`；已有 clean worktrees 不得擅自覆盖。隔离当前工作树不得触碰原 \`D:\MITS\` 的六项 dirty/untracked 项目。先 \`git fetch origin\`、\`git status --porcelain\`、\`git log -1\`，确认本任务的 branch、基线、真实 build/hash；不 reset/stash/clean/force-push。

**完整读取并追踪引用：**

1. \`docs/reports/v398-engine-stability-p0-20261009/INCIDENT_FORENSICS_REPORT.md\`
2. \`docs/reports/v398-engine-stability-p0-20261009/evidence/INCIDENT_TIMELINE.json\`
3. \`docs/reports/v398-engine-stability-p0-20261009/evidence/EXIT_CLASSIFICATION.json\`
4. \`docs/reports/v398-engine-stability-p0-20261009/evidence/RESOURCE_EXHAUSTION_SUMMARY.json\`
5. \`docs/reports/v398-engine-stability-p0-20261009/evidence/SOURCE_COVERAGE.json\`
6. \`docs/plans/V398_ENGINE_STABILITY_P0_IMPLEMENTATION_PLAN_20261009.md\`
7. \`docs/reports/v398-engine-stability-p0-20261009/IMPLEMENTATION_REPORT.md\`
8. \`scripts/collect-zdj-engine-crash-evidence.ps1\`、\`scripts/engine-crash-diagnostics.psm1\` 及现有测试；
9. \`scripts/start-zdj-engine-host.ps1\`、\`scripts/start-zdj-lan.ps1\`、\`apps/engine/src/runtime/processLifecycleTelemetry.ts\`、\`apps/engine/src/main.ts\`；
10. \`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md\`、以往 \`ENGINE_NATIVE_CRASH_20261006_FOREGROUND_ANALYSIS.md\` / \`engine.foreground.20261006-090715.log\` 的保留源和源 commit。

已证实：PID 8524/instance \`c685f035-1f52-48ac-80fa-998811ff3fe5\`，已加载旧 5fe95a8 build，2026-10-09 07:16:58.349 +08 的父进程 \`CHILD_EXITED\` 原生状态 \`0xC0000409\`。最后一条已知 ENGINE event 为 07:16:57.109 +08 \`BINANCE_USER_DATA\`，**仅代表日志顺序，不证明最后 CPU 指令在此组件**。06:54—07:12 +08 有 4 次 Windows Event ID 2004 低虚拟内存，指向 3 个 \`llama-server.exe\` 的较大占用，未直接认定其导致 Engine fail-fast。2026-10-06 历史事件也有同样退出码，但两次未证明同因。此前保留的 Node \`v22.23.1\` / \`--no-maglev\`：不再随机切换 V8/JIT 标志。

最新已合入 \`main\` 的 \`d1ecbe9\` **只发布无界外部副作用为零的诊断工具**，没有修复 native crash，也没有部署到 Engine；不能把 25 个采集测试或本地 1899 Engine tests 误报为运行稳定性。

## B. 立即开展的本地只读事实检查（无需启机）

0. 首先短报告：当前是不是已有 8080 Engine 运行、PID/parent/create time/build、ports8081/8083/8084、实际内存与磁盘剩余、pagefile/Windows Commit。**如果已有 Engine，禁止启动第二份**；本任务不可为了测试关闭已运行交易实例。
1. 优先重新列出现存 \`0xC0000409\` 的 WER reports/dump、parent exit file、stdout/stderr 的准确 inode/hash/path，确认有没有上轮漏掉的 dump（时间/进程匹配）。现有原始日志与 SQLite/WAL/交易数据只读，绝不拷贝私密原文到公网。
2. 对用户当前主机做**低开销、有限采样或即刻快照**：Windows \`Committed Bytes\` / \`Commit Limit\` / \`% Committed Bytes In Use\`、pagefile total/used、系统可用物理内存，\`node.exe\`、三 \`llama-server.exe\` 的 PID→process creation→private bytes / working set / commit / handles（可采多少报多少），内存趋势和可用 dump 磁盘空间。明确区分 GPU VRAM、Windows RAM、Windows system commit 和 V8 heap。先查是否持续压在 commit limit 附近；不得只用“GPU还有显存”推断内存充分。输出时间戳、计数器单位、覆盖和 UNKNOWN；不能把今天的系统压力回填 07:16 的 PID8524。
3. 从此前原始 \`BINANCE_USER_DATA\` 的前后限定窗口、其它 engine event、已确认 exact order identity（脱敏后）重建 in-flight path；检查有无此前已保留的异常/fatal 证据，注意最后日志不是调用栈。比较两次 \`0xC0000409\` 和发生时的系统压力、model CPU/RAM、main thread wall-time（所有对照标注不同 PID/time）。
4. 审计现有采集器是否**会在进程下一次 fail-fast 时自动得到调用栈**。如果只是离线读取事件与 JSONL，明确写 \`NATIVE_STACK_CAPTURE_NOT_ENABLED\` 并优先推进 C 阶段，而不是再打一份“崩溃根因 UNKNOWN”的同样报告。

## C. 必须准备可定位 native fail-fast 的下一次本地捕获

**本节是当前最高价值的补证项。** 查阅 Microsoft 官方机制：

- Microsoft Sysinternals ProcDump: https://learn.microsoft.com/en-us/sysinternals/downloads/procdump
- Microsoft WER LocalDumps: https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps
- Windows fail-fast status: https://learn.microsoft.com/en-us/cpp/intrinsics/fastfail

首选**按精确 Engine PID 限定**的异常捕获流程，绝不能将所有 Node \`node.exe\` 当成同一进程、不能全机 \`procdump -i\` 设置自动事后调试器、不能打开不受控的 first-chance \`-e 1\` 大量 dump，也不因“检测到 8080 未监听”才开始挂采集器（那时 PID 已死）。若现有 ProcDump 或 WinDbg 可用，核实工具来源、版本、帮助语法、用户授权和运行环境。离线**合成小型进程**先测试附加、dump 文件与 exit classification 的链路，不在真实交易 Engine 内注入故障、不触发任何下单。

设计并在隔离源码中实现**安全、可逆、明确操作范围**的准备/采集脚本与 rollback 说明：

- PID、创建时间、instance、engine image、source/build SHA 全部匹配才 attach，避免 PID reuse/误选其它 node/llama 或第二引擎；
- 官方支持的 second-chance/unhandled/fail-fast capture：选择能保留本机 native fault stack 的 dump 类型（优先有界 MiniPlus/必要时 full 的受控选项），合理 dumpCount/超时/磁盘配额。不要凭空假定 \`-e\` 必捕所有 native fail-fast：在模拟独立崩溃测试证明能力，不能证实则标 UNKNOWN，准备 WER fallback；
- 崩溃前监控写入到独立受控目录（如 \`%LOCALAPPDATA%\ZDJMITS\engine-native-crashes\`），先验证权限、ACL、空间和磁盘剩余额度。**真实 dump/full stdout/用户账户信息可能含 API 密钥/交易数据/私有 prompt，绝对禁止 GitHub 上传**；只上传源代码、脱敏堆栈摘要/模块 hash、目录私有位置/安全哈希；
- 备选 WER \`LocalDumps\node.exe\` 可能捕获该主机**其他 node.exe** 并写出私有内存；启用前需明确告知范围、先备份原注册表值，独立用户同意后临时设置，限制 DumpCount，退出后恢复原值；不得自行改 HKLM / 安全策略 / AeDebug；
- 故障时同时拿到 \`ExceptionCode=0xC0000409\`、\`ExceptionInformation\` fast-fail subcode、faulting module/path/version、exception address、thread ID、堆栈帧、native caller 和 Node/libuv/OpenSSL/sqlite/worker 等模块边界（实际存在才列）；装有 WinDbg 才能本机 \`!analyze -v\` / \`.exr -1\` / \`.ecxr\` / \`k\` / \`lm\` 分析，所有地址/路径/私有数据在公开报告前脱敏；
- 能区分 \`ALREADY_CRASHED_NO_DUMP\`、\`CAPTURE_ARMED_BEFORE_START\`、\`CAPTURE_ATTACHED_AND_VERIFIED\`、\`DUMP_CAPTURED\`、\`DUMP_FAILED\`，每一步记录时间与 PID。失败不自动重启；监控工具自身退出和磁盘不足不应更改交易状态；
- 环境资源占用过大时，不允许为取 dump 反而将系统推入更严重的 commit pressure；记录风险并停止启动门禁。

**重要授权边界：** 用户授权本地离线调查、诊断脚本制作与基于已证实根因的离线代码修复；**没有明确授权**改 Windows WER/HKLM、改变 pagefile、杀掉/限制模型、停止现有 Engine、部署或重新启动 TESTNET Engine、开启任何自动重启/看门狗、人工交易。上述动作必须在本地准备完之后单独列明“将要执行的命令/影响范围/可逆性/资源代价”给用户确认。可先对完全合成进程演练。准备完不能自行做“为了获取堆栈而在生产测试网逼出崩溃”的实验。

## D. 对系统虚拟内存压力的可证伪排查（不把相关性当因果）

Windows 4 次 2004 事件**必须列为并行 P0 风险**，因为再次启动 Engine 在现有资源条件下也可能造成系统不稳定。核实三 \`llama-server.exe\` 各自 CPU/RAM/private bytes/commit 和 GPU 驱动、模型加载参数、同时运行数量；检查 pagefile 容量、auto-managed 状态、host commit headroom 是否足以同时容纳三个模型 + Node Engine + 异常 dump 的峰值。观察是否存在异常持续增长或频繁 system commit pressure；必须有样本/趋势才能诊断泄漏。

若发现当前 host commit 接近极限，应立即报告 \`RESOURCE_PRESTART_GATE_BLOCKED\`，不要先在资源枯竭时启动 Engine。建议方案应优先基于有据可查的资源预算和隔离：**任何停止/减载模型、改 pagefile/Windows 内存设置、替换三 GPU 模型运行方式都须先取得用户单独同意**。如果随后 dump 证明故障模块和内存分配有关再开展代码根因修复；仅降低模型负载和不再崩溃一段时间只能记为“缓解相关风险”，不是已证明的 native 根因。

若内存足够而依旧崩溃，也要留存反证并继续调查 native stack，不继续随机调 heap/v8 flags、反复改 node release 版本或改 TLS/Undici/SQLite 为临时猜测。

## E. 根因确定后，Codex 必须真正修复而不是继续堆诊断

1. **有清晰 dump stack / 独立可重复 bug / 强因果证据**时：针对出事时已加载 \`5fe95a8\` 的真实触发链和最新版代码逐函数追踪；能够命名唯一 file:line/module/同步窗口/输入则给出最小改动。现有 \`main\` 上 P0 交易执行、durable claim、private data、SQL/worker/market/TP 的约束保持。
2. 对照同个故障的 before/after 复现和崩溃信号是否消失；没有新自然崩溃只证明观察窗口内未再现，不等于永不发生。若 native crash 来自外部 DLL/OS/runtime，给出可复现的主机或依赖修复/减风险建议，但不能修改无关 JavaScript 交易逻辑伪装修复。
3. 如果没有 dump/可复现因果，**允许且优先**实现仅用于未来取栈/资源压力的最小安全诊断工具，记录 \`ROOT_CAUSE_UNKNOWN\` / \`FIX_BLOCKED_ON_NATIVE_STACK\`；绝对禁止因为用户想立即修好就伪造一个“已修复”结果。
4. 一旦发现同步历史路径造成持续 5s event-loop stall，应独立报告/最小化性能修复，但不能将该项当作 \`0xC0000409\` 根因，除非 native 证据真正连接到其上。

按源码情况写完整本地测试：PID attach identity/退出分类、合成 fail-fast dump、Windows event resource pressure、dump 隐私/磁盘配额、权限不足/失败清理、live process 无意操作 0、交易身份 UNKNOWN 不重复提交、HUMAN/TP/no-add/Production 0。必要时执行 \`npm run verify\` 及 S00、本地合成 smoke。**全部只本地运行，不借助 GitHub Actions**。特别注意本机此前 \`npm run verify\` 与模型并发曾 OOM，先确认 host commit headroom；不能为了测试制造另一次系统崩溃。保存失败和成功 stdout/stderr 原文至本地独立日志目录，脱敏摘要和 SHA 上传评审分支。

## F. 文件交付、无 Actions 发布与验收

本任务建议文档及实验脚本目录：

- \`docs/reports/v398-engine-stability-p0-20261009/NATIVE_FAILFAST_LOCAL_FOLLOWUP.md\`
- \`docs/reports/v398-engine-stability-p0-20261009/evidence-native/\`：脱敏 \`host-memory-preflight.json\`、\`native-capture-preflight.json\`、\`dump-analysis-summary.json\`（只有真的 dump 才有 verified 内容）、\`hypothesis-matrix.json\`、\`NO_ACTIONS_LOCAL_VERIFY.json\`、source/hash manifest。
- \`docs/plans/V398_ENGINE_NATIVE_CRASH_ROOT_CAUSE_FIX_PLAN_20261009.md\`：在真实 dump/资源事实基础上由 Codex 自拟的修复点、风险与验证计划；如 dump 暂无则以 \`CAPTURE_AND_AUTHORIZATION_PLAN\` 为标题，不冒充根因修复计划。
- 根据查证结果的本地脚本、targeted tests、变更文件；严禁改动实际运行中的 dist/source/SQLite/WAL。

**GitHub 只允许**使用当前非匹配 \`codex/p0-native-failfast-local-20261009\` 分支（且确认触发条件未变化），必要时 push 该分支来回读，绝不合并 main、绝不发 workflow_dispatch、绝不 rerun/cancel Jobs，不更改 \`.github/workflows\`、branch protections、required status checks。若任何操作会触发 Actions，立即停止远端写入改用本地 commits 并在最后告知，待用户恢复额度后才交付 main。

如果使用 GitHub connector 只读文件而不用 CI 没问题；无需查询 Actions 来“证明成功”。先用本地 verify/test 输出证明，并通过 git SHA、GitHub blob/hash 远端 readback 证明 artifacts（如推 review branch）。所有费用数据、dump、密钥、完整私人交易记录都不上传。

**当前用户最需要的结果**：提供
(1) 本地当前 commit/headroom/活进程简表；
(2) 是否找到 PID8524 已存在的 dump，若没有具体说明未来捕获是否已合成演练成功；
(3) 0xC0000409 具体根因等级和证据，是否关联三个 llama 导致的系统 commit 压力；
(4) 有因果证据才修复并给出本地回归日志；
(5) 需要单独授权的精准一次性 Windows native capture/Engine lifecycle/模型负载调整操作；
(6) GitHub 评审分支文件链接、完整源码哈希；
(7) **NO GITHUB ACTIONS**，本任务未部署、未真实交易、未删除用户状态。

最终状态只能使用 \`ROOT_CAUSE_FIXED_OFFLINE_RUNTIME_PENDING\`、\`DIAGNOSTIC_CAPTURE_READY_AUTHORIZATION_PENDING\` 或 \`INSUFFICIENT_EVIDENCE_ROOT_CAUSE_UNKNOWN\` 等可证明标签。**“诊断器完成”不等于“引擎不再崩溃”，短暂 READY 更不等于持续稳定。**

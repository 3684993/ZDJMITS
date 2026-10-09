# 2026-10-09 09:47 +08：Harness 8083 停止后的内核池定界报告

**分类：`BOTH_27B_STOPPED_9B_STILL_RUNNING` / `HOST_COMMIT_PRESSURE_RELIEVED` / `KERNEL_POOL_ORIGIN_UNKNOWN` / `RESTART_NOT_AUTHORIZED`。**

本报告只摘录用户上传的两轮受控维护控制台与 JSON 采样（09:35、09:41、09:47）。没有在 Windows 主机现场调试；不把两个模型停止与内核池高位之间的相关性偷换为 DLL/Driver 的因果证明。原始 JSON 日志保留用户本地，不入公开仓库。

## 1. 三个阶段，单位 GiB

| 指标 | 09:35 两个27B都运行 | 09:41 仅停止Primary8084 | 09:47 再停止Harness8083 |
|---|---:|---:|---:|
| Committed Bytes | 116.68 | 91.32 | 69.94（后续采样70.67–70.72） |
| Commit Limit | 117.98 | 114.32 | 112.93 |
| Commit Free | 1.30 | 23.00 | 42.99（后续采样42.21–42.25） |
| Paged Pool | 23.10 | 22.83 | **22.70** |
| Nonpaged Pool | 8.67 | 7.91 | **7.54** |
| 8084 Primary / 10,631,013 handles | running | stopped | stopped |
| 8083 Harness / 2,451,581 handles | running | running | stopped |
| 8081 9B / 317 handles | running | running | running |

注意 09:47 的预检和随后的3次采样隔了数秒，Committed Bytes 已从69.94回升到70.67附近；这不意味着该差值来自某个具体驱动。Windows 管理的 D: pagefile allocated 从最初22,581MiB动态降到约17,408MiB，Commit Limit 随之变化，这不是固定上限。

## 2. 分角色差分（四舍五入）

- **先停止Primary 8084：** committed减少约25.36 GiB；paged pool减少约0.27 GiB；nonpaged pool减少约0.76 GiB。
- **再停止Harness 8083：** committed减少约21.38 GiB；paged pool减少约0.13 GiB；nonpaged pool减少约0.37 GiB。
- **两者累计：** committed减少约46.74 GiB；paged pool仅减少约0.40 GiB；nonpaged pool仅减少约1.13 GiB。
- **目前核心待解释对象：** 系统 Paged+Nonpaged Pools ≈30.24GiB（22.70+7.54），并且目前仅有 9B PID12732 作为 llama-server 持续存在，句柄317、Private Bytes约14.437GiB。不能仅据此归责9B、AMD、Intel GPU驱动或 Windows。
- Windows Kernel Pools 与进程 Private Bytes、RAM Available、GPU VRAM 是不同的记账口径；在内核池主要对象及增长来源未确定前，不宜只通过改 ctx/KV 或换 Ollama 宣称修复。

## 3. 现阶段的具体建议

**不立即重启8083/8084、不停止9B、不升级驱动、不重启Windows、不调整pagefile、不启动Engine。** 如果依赖这两个27B模型的任务急需恢复，必须另行制定维护/资源预算，不能靠当前已有42GiB headroom连发两个27B。

下一步应该从 Windows 的 **PoolMon 内核分配标签**直接识别高位占用和增长情况。微软 PoolMon `/n` 是**保存快照后退出**的模式，`/b`按字节大小排序，`/p`仅非分页池，`/p /p`仅分页池。官方来源：
- https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/poolmon-startup-command
- https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/poolmon
- https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/using-poolmon-to-find-a-kernel-mode-memory-leak

本仓库新增 `capture-kernel-pool-tags-readonly.ps1`。它不会安装 PoolMon/WDK，不改 GFlags/Driver Verifier，不重启/停止或加载任何模型。默认在本机已有 Windows Kits WDK 或可信 PATH 的 PoolMon 中寻找可执行文件，分别做 All/Paged/Nonpaged 三份本地 snapshot，仅向控制台打印前三类最大标签并保存 LOCALAPPDATA 内；PoolMon不存在则只返回 `POOLMON_NOT_FOUND`（不能声称内核池已定位）。必要时通过 `-PoolMonPath` 显式指向已安装的正版 WDK 文件。

### 本机执行（只读）

~~~powershell
git -C D:\MITS-worktrees\llama-memory-20261009 pull --ff-only origin codex/llama-vulkan-memory-20261009
$review = 'D:\MITS-worktrees\llama-memory-20261009\scripts\llama-vulkan'
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\verify-candidate-parse-readonly.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "$review\capture-kernel-pool-tags-readonly.ps1" -Mode Capture -TopRows 20
~~~

如果 `POOLMON_NOT_FOUND`，不要下载随机网站的 poolmon.exe，也不要打开 gflags/pool tagging 全局注册表设置；先让本地 Codex 查找 WDK 是否安装，或者获取用户明确授权后从微软官方渠道安装所需 Windows 驱动诊断工具。Windows Server 2003 之后池标记常驻启用，无需额外更改全局设置。

如果成功，给 ChatGPT 提供控制台里 `PAGED TOP BY BYTES` 和 `NONPAGED TOP BY BYTES` 的前20个标签、Bytes/Diff、系统内存汇总即可；**只提交脱敏结构摘要，不将未经核查的 raw snapshot 或可能含用户信息的全量诊断上传 GitHub**。Pool Tag `Mapped Driver` 只是线索，不能根据一个标签名称直接锁定内核驱动责任，必要时将其映射到本机二进制版本和动态趋势。

## 4. 恢复三个模型的边界

原有候选脚本已强制 Host Commit Start budget：27B cold load至少40GiB free、9B至少24GiB free且总commit<90%；任何现有 llama-server >=100,000 handles 阻断 cold load。**这些阈值只是保护防线，不保证连载两次27B不会击穿Commit Limit**。保持 9B，并等待池来源证据；视本机装载成本再评估 pagefile、27B量化与context、是否需要更换固定 llama.cpp Vulkan build，最后才是 Ollama 的独立A/B测试。

## 5. 安全边界

仅在非触发 GitHub Actions 的 review 分支 `codex/llama-vulkan-memory-20261009` 提交代码和报告；main不动，不调用Actions，生产交易写入0，Engine不部署不启动。
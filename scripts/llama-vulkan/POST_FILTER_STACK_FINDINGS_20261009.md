# Windows 11 25H2 Filter Manager 调查：10:07 (+08) 实际实例清单

- 状态：`FILTER_TOPOLOGY_CAPTURED`；`FILESYSTEM_POOL_RETENTION_SUPPORTED`；`SPECIFIC_DRIVER_CAUSE_UNKNOWN`；`NO_OS_OR_MODEL_CHANGE`。
- 取证源：用户本地 `filter-stack-readonly-20261009-100737.json` 中的非私密汇总及 fltmc 输出；原始 JSON 留用户本机，不入公开 GitHub。
- Windows 11 Pro 简体中文 25H2 **26200.9457**；paged pool **22.699GiB**，nonpaged pool **7.540GiB**；committed **69.799GiB**。8080 无 Engine listener，8081 9B 正在监听，8083/8084 两27B仍无监听。
- `fltmc filters`、`fltmc instances`、`fltmc volumes` 均成功返回 0。

## 运行中的 minifilter

| Filter | Instance count | 实际卷关联 | 调查备注 |
|---|---:|---|---|
| `FileInfo` | 5 | C:, D:, ShadowCopy8, Mup; 另外有空卷的输出行 | 文件信息 MiniFilter，归因未证明 |
| `UCPD` | 5 | C:, D:, ShadowCopy8, Mup; 另外有空卷的输出行 | Windows 用户选择保护 |
| `WdFilter` | 5 | C:, D:, ShadowCopy8, Mup; 另外有空卷的输出行 | Microsoft Defender 文件系统过滤 |
| `Wof` | 3 | C:, D:, ShadowCopy8 | Windows Overlay Filter |
| `bfs` | 7 | C:, D:, ShadowCopy8, Mailslot, Mup, NamedPipe; 另外有空卷的输出行 | Windows Brokering File System；真实发行者/文件签名仍应现场核验 |
| `bindflt` | 1 | C: | Windows Bind Filter |
| `gameflt` | 2 | C:, D: | Windows game filter |
| `npsvctrig` | 1 | NamedPipe | 命名管道服务触发 |

另有 `storqosflt`, `wcifs`, `CldFlt`, `FileCrypt`, `UnionFS` 显示 `0` instances；**驱动服务处于 Running 并不等于其已有活跃文件卷过滤实例**。所有 `fltmc filters` 的 Frame 为 `0`，没有明确 `<Legacy>` 过滤器。输出中有 `HarddiskVolumeShadowCopy8`，仅证明存在影子卷，不证明备份服务异常。

## Kernel pool 对照（09:59）

两次运行时静态 tag 查询得到约 3,517 个标签；`FMfn` paged 12.7989GiB、`File` nonpaged 4.7545GiB、`Ntfc` paged 1.8958GiB、`IoNm` paged 1.7121GiB。相隔5秒几乎不动，不能声称正增长。系统 kernel pools 合计约30.24GiB，而标签之和约25.76GiB；需承认该未公开 API 的布局和会计覆盖限制。

之前两27B停止释放约46.74GiB commit，但 pool 仅下降约1.53GiB，**显示大部分高位内核池在两个27B退出后持续存在**。Cannot infer a particular minifilter guilty merely by presence, nor equate millions of historical llama-server handles to specific retained File objects.

## 外部核实及严格边界

- 官方 Microsoft 资料：Filter Manager MiniFilter 机制 https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/filter-manager-concepts
- 官方 Microsoft 资料：Frame<Legacy> 标识 https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/blocking-file-system-filter-drivers
- 官方 2026-09-14 Windows update **KB5129195** 的构建为 26200.9457，发行说明未列出 FMfn 内核池修复：https://support.microsoft.com/en-us/servicing/os/windows-11/2026/09/kb5129195-windows-11-24h2-25h2-security-update
- 2026-08-04 Microsoft Q&A 同类标签报告位于更早的 26200.8973；它是用户反馈、官方社区答复**不代表 Windows 已确认缺陷、没有已证实可直接套用的修复**：https://learn.microsoft.com/en-us/answers/questions/5966064/windows-11-25h2-kernel-pool-leak-fmfn-and-file-all
- 2026-09 WSL Github 也有相同 26200.9457 上 NtFC 等 pool retention 用户报告，但其故障环境是 WSL2/Docker，**本机不应推断安装或运行了 WSL、Docker**：https://github.com/microsoft/wsl/issues/41644

## 下一步最小必要操作（只读）

1. 在 9B 仍运行、两27B停止的稳定状态下，取得**间隔至少10~30分钟**的第二份原生标签快照，再使用已在 GitHub 的 `compare-kernel-pool-tags-readonly.ps1` 比较共同 top-N 的 DeltaBytes/alloc-frees；确认是否仍在增长，量化 MiB/小时。不要制造大规模合成文件 I/O。
2. 本机核实 `fltmc filters` 中列出的过滤器的驱动文件实际路径、签名/发行者、文件版本和 SHA256（可将完整签名/路径留本地，仅提交脱敏摘要）；先证实 `bfs`、`gameflt`、`FileInfo` 是否为微软签名。**不停止任何驱动，不调整 Defender/UCPD/UAC。**
3. 若 pool 数值持续快速增长且对象驱动无法归因，才建议在单独维护窗口征得用户明确授权后采用定界 Windows Performance Recorder/ETW 的文件 I/O 与 pool 事件；评估日志隐私和开销，禁止自动启用 Driver Verifier 或栈追踪大范围采集。
4. Windows 25H2 26200.9457 系统可能存在 2026-09 之后更新，但**不能把任何新更新当作本案确定的修复**。安装 Windows 补丁/重启须独立批准并保存前后数据。
5. 暂不加载两个27B；9B不停止；Engine不启动；不提交原始本机私有日志；GitHub Actions 不运行，main 不动。

## 维护目标

临时目标：先定位内核池高占用的主要标签与持续增长路径，之后才做单一变量受控试验（系统补丁前后、固定 llama.cpp 构建、27B 一次一个及 host commit 预算），避免“换 Ollama 后看似好转”却把历史内核池泄漏遗留在 Windows 的无证据处理。

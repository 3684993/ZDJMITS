# Codex 立即执行 · 三 Qwen 模型恢复与 v3.9.8 本机部署（用户2026-10-10授权）

## 已确认的执行事实（勿重复猜原因）

- PR #38 已由 ChatGPT 审核 GitHub 精确 HEAD 两轮 Windows CI SUCCESS 后合并 main：merge commit `84d5d4f81b3ad6c73b1f7744c441d4f887de9638`；源码 `d39024d97f681c46c94e7537dd688f6bf271096a`，报告 HEAD `bd8911902319d4e0cca3937434ae92afe88e3048`；本机264文件/2210例通过。
- 旧在线 Engine PID23936/build source6533、代理 PID18300/端口20091，模型 8081/8083/8084 真实已退出且监听消失。末次正常推理后退出的发起者和退出码UNKNOWN；不要称已修复根因。
- Codex 工具启动命令**未执行**，阻止来自执行环境自动审批的 `blocked by policy`，不是 Windows 启动器、项目模组或 GitHub CI 的失败。仓库中不存在能取消 Codex 平台审批的改动。**不要通过更名、代理、脚本包装、其他通道或安全降级规避平台审批**；允许操作者在 Codex 正常交互审批 UI 明确授权，或由具备主机权限的操作者使用原有经审查的运维命令执行。若平台仍拒绝，准确报告拒绝，不要假装执行。
- 用户**明确授权现在就恢复离线模型并完成新版本受控部署/Engine必要时重启**；不需为此再次征求交易管理概念许可，但必须核对当时的真实安全和流程技术门槛。用户没有要求开启新24小时验收，因此新验收仍 T0=null，旧08:34 ABORTED保留。不得把技术TP签名守卫、进程身份验证、NO_ADD和Production0删掉，更不能把它们错叫作“自动审批阻断”。

## 立即行动，优先修复停掉的服务而非重复报告

1. 在Windows主机的**有实际执行权的终端 / 当前获得正常审批的 Codex 本地终端**识别 `D:\MITS` 的当前 Engine、代理、Windows service/task、执行用户权限、代码 worktree dirty 状态、三模型已保留的私有 manifest，核对 `git main` 新合并 SHA，备份现场 runtime DB / WAL / 配置和原日志。别用 GitHub-only connector 假装本机执行；不要覆盖已有运行或维护日志。
2. 只读证实最新TESTNET、Production写入0、账户 `canTrade=true`、私有同步新鲜（≤30s）以及所有应保护仓位的**新鲜签名TP**覆盖、orderId+clientOrderId+symbol+side+qty+price+reduceOnly identity与本地 cycle 对应完整；必须保留先前的29→28波动和TP偶发缺口。此检查仅用于是否可安全部署/重启，不代表长时验收通过。
3. 使用Windows的实际端口/PID/启动时刻、原始 launcher 和 `model-binding-readback.json` 的hash与真实GPU枚举再核对，按`Scout 8081` → `Review 8083` → `Primary 8084` **逐个**恢复。优先使用**已经审查过的私有manifest + 新Engine专属 `ModelLifecycleService`**，私钥放主机专属安全位置，配置 `ZDJ_MODEL_MANIFEST`、`ZDJ_MODEL_OPERATIONS_DIR`、随机高强度 `ZDJ_MODEL_OPERATION_TOKEN`、正式 Engine 服务账户可用的PowerShell7 `pwsh.exe`。若需先部署新Engine才能调用模型管理API，先按第4步受控部署。无需 GPU全卡强杀；无在途任务不能直接视作随意关停其它进程的许可。
4. **受控部署/引擎重启**：只能在新鲜私有身份+全仓签名TP+生产零写+配置/备份/旧PID身份+回滚可用的当时门禁通过时，把 GitHub main `84d5d4f...` 编译并执行一次 Engine-only graceful shutdown/start；新PID/源commit/instance identity 6/6 回读。在门禁不满足时保留旧Engine正常管理TP，先恢复不触碰交易状态的离线模型进程，升级记 `NO_GO` 并说明具体拒绝项，不要把旧Engine直接终止。
5. 每个模型必须给出实际 `127.0.0.1:8081/8083/8084` LISTEN PID、进程创建时间、`/health` 状态、一次真实响应（与所配置model相同的有限inference，非模拟）、Win32/GPU PID-LUID/PCI/专用显存来源和对应健康监控图表新鲜时间戳；两个27B与B580同时装载的真实资源预算已验证后才宣称全部恢复。
6. 测试 Settings中人工启动/停止/重启按钮的**授权和拒绝路径**；不要为了测试去停止刚恢复的活跃27B，真实stop/restart只能在队列/slots和TP保护可证明安全时。需要修复UI可显式提示 `DENIED_BY_PLATFORM_POLICY` 与 `MODEL_OPERATION_PERMISSION_DENIED` 属于不同权限域，决不含糊显示 `blocked by policy` 是模型启动故障。
7. 复现真正**退出根因**所需增补的证据（launcher process exit code、控制台关闭事件、Windows Event 1000/1001、Process termination / watchdog/task/WER、日志最后顺序、OOM/driver探测与是否PowerShell父进程退出）。如原因仍UNKNOWN，则部署进程监护/重启审计并在报告中标注具体缺证据，不猜。
8. 提交 GitHub `docs/reports/v398-model-lifecycle-recovery-20261010/FINAL_RUNTIME_RECOVERY_AND_DEPLOYMENT.md`，包含脱敏操作时间线、必要的审批动作是否**真实执行**、每个模型PID/健康/inference、Windows GPU归属、Engine真实身份/重启收据、即时TP认证结果、Production0、回滚情况、原退出根因判断。若无本机权限不能声称恢复。更新 `docs/project-memory.md` / `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`，完成对应精确HEAD CI和 Issue#30/#35。

## 硬边界

**用户已批准行动，不需要重复概念性许可；**不能删除外部平台的访问审批，也不能删除应用层认证token、进程身份、启动器hash、在途推理drain/租约锁、签名TP、Production0与TESTNET边界。用户的“服务必须恢复”是当前最高业务优先级，但任何无法执行的命令必须如实标记**未执行**。不凭修改仓库源码就声称本机模型已经恢复、不自动重启24小时验收。

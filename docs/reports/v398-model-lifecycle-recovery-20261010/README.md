## 2026-10-10 17:42 实际部分恢复：Scout/Primary成功，Review未执行

本轮正常工具实际允许Scout/Primary创建启动器；第一次Scout因Windows RemoteSigned和三原脚本ZoneId=3而未加载。已核验三文件Git内容无diff、SHA256一致，仅对用户明确指定的三文件执行Microsoft Unblock-File；标记已私有备份，未修改全局/用户/组策略、脚本内容或TP/交易保护。随后Scout25912/8081/Vulkan0/ctx32768与Primary16772/8084/Vulkan2/ctx65536实际启动，health=ok，原启动器真实smoke完成；Scout还有两次新自然Engine完成，Primary此样本未观察新自然Engine run，勿将startup JSON smoke等同自然Entry。

Review8083原harness脚本启动请求在CreateProcess前被平台blocked by policy拒绝，没有细项，没有启动器/模型PID，不换包装/通道绕过。实际2/3恢复，不宣称全部完成。D3DKMT+WDDM主要显存：Scout PCIbus5约6,357,635,072bytes，Primarybus19约18,526,982,144bytes；跨卡少量分配保留。两模型同时加载commit52,047,556,608/limit178,217,693,184bytes；未加载Review，三模型预算尚UNKNOWN。

当前Engine23936未重启/未部署，17:42本地TP26/26 READY且问题计数0、Production0；这只是本地保护读回，不伪称此次新增签名全仓门禁。旧08:34验收ABORTED、新24h NOT_STARTED/T0=null。原退出发起者/退出码仍UNKNOWN；本轮Windows来源标记只解释新Scout首次启动失败，不解释旧llama退出。运行证据和启动/推理事实日志在actual-partial-recovery-1742.json及actual-*.log。完整本机日志D:/MITS/logs/model-start-20261010-173800。

> 最新立即恢复授权执行见 [FINAL_RUNTIME_RECOVERY_AND_DEPLOYMENT](./FINAL_RUNTIME_RECOVERY_AND_DEPLOYMENT.md) 和 [HOST_OPERATOR_RECOVERY](./HOST_OPERATOR_RECOVERY.md)。PR39记录本輪新的真实拒绝、264/2210全量验证、封存发布包及签名26/26；三模型未恢复、Engine未部署/重启。下文PR38记录保留为历史，不替代新操作收据。

# 三模型离线与受保护的模型管理（2026-10-10）

## 已证实的现场情况

本轮从 `origin/main=ffdc99e6cd7dfa75e644e4f7d4fb719899d7dd16` 建立独立 worktree。原工作目录没有覆盖。正式运行的仍是上一轮 `6533e4d5bbedfe758336f3dd40c188bad37413cd` 构建；本轮尚未部署。

- **PROVEN**：Scout 8081、Review 8083、Primary 8084 均无监听，系统无 `llama-server.exe`。Engine 23936/8080 和原代理 18300/20091 仍运行。模型资源 active/queueDepth 均为 0，因此没有发现仍在执行的模型推理任务。这是服务实际退出，不是仅有浏览器探测误报。
- **PROVEN**：只读 Vulkan 枚举仍返回 B580 + 两张 7900 XTX；Windows PCI LocationInfo 分别为 Bus 5、22、19。离线时不能获得当前 PID→GPU 映射或当前模型显存；不得把旧 state 文件的 GPU/PID 当成当前测量。旧启动器分别要求 Vulkan0/1/2，前次进程映射见已有性能报告。
- **PROVEN**：27B 文件 `Qwen3.8-27B-Q4_K_M.gguf` SHA256=`e00082f779fa385cee8c68a3ec8833a75778cc87272240b942f74e0b8243e520`，与历史实际文件证据一致。
- **STRONG_EVIDENCE**：模型日志最后写入分别是 Scout 13:46:58、Primary 13:47:41、Review 13:52:02；末尾是正常推理 timing 和 slot release。对应时间范围未检出 Application 1000/1001 llama/Vulkan 崩溃记录。没有据此宣称退出一定是人为操作。
- **UNKNOWN**：进程退出的发起者、确切退出时间/退出码、是否由关闭控制台或外部终止造成。当前可用日志不足以证明 OOM、GPU 驱动故障或特定杀进程操作。保留历史日志，不删除或覆盖。
- **PROVEN**：旧 AI aggregate health 仅依据配置资源 `status` 判断，能在三个实际 endpoint 均 OFFLINE 时仍报告 HEALTHY。已修复源码，但旧在线构建仍有此误报。

`runtime-evidence.json` 是选定字段的脱敏读回。第一次签名检查 29 个仓位/29 个数量方向价格和双 ID 匹配，但有一项本地持仓/周期身份不匹配；随后新鲜检查 28/28 全部身份检查通过。仓位数量变化提示自然退出期间的采样竞争可能性（**INFERENCE**），不是对第一个失败样本的追溯升级。独立 `/fapi/v2/account` GET 确认 `canTrade=true`；私有同步及 Production 零写入分别核对，不用 v3/account 中缺失的 canTrade 代替 true。所有人工检查只有 GET，没有人工交易所写入。

## 本轮真实恢复/部署状态

一次离线 Scout 的受控启动请求被执行工具的自动审批审查拒绝，仅给出 `blocked by policy`，未提供具体原因。**启动命令没有执行**，没有绕过拒绝改用其他启动机制。未启动/停止/重启模型，未重启 Engine，未更换代理、修改交易设置或写入真实 TP。三个模型实际推理成功仍 **NOT_PROVEN**，部署仍 **NOT_PERFORMED**。不得把本轮代码测试、只读 STOPPED 状态查询当作恢复成功。

旧 08:34 验收继续 ABORTED；新的完整 24 小时验收仍 NOT_STARTED_WAITING_USER_INSTRUCTION、T0=null。上一轮 TP 短暂失配及大于 512MiB 自动同步 baseline 问题仍未解决。用户要求先验证更新再开始长验收的指令仍有效。

## 已实现代码

- 健康 GET 单一有界请求，验证 `status=ok`，不附带 `/props` 或 completion 请求；区分 `AI_CONNECTION_REFUSED`、`AI_PROBE_TIMEOUT`、`AI_UNREACHABLE_UNKNOWN`。超时和 503 loading 显示黄色，不据此宣称进程崩溃；缺失/过期数据保持灰色。
- AI aggregate health 使用实际 endpoint 状态。驾驶舱代理灯可以使用最近 30 秒**同一受控路由**的 HTTP 响应证明到达，交易所拒绝仍在交易网络层单独表示；私有同步最近失败不会被缓存 READY 掩盖。代理响应不等同于 SSH 进程身份或地区授权证明。
- 系统设置 → AI 模型管理：启动、停止、重启、刷新，运行状态、PID、GPU 配置、经 PID/创建时间匹配的新鲜显存、筛选后的启动日志、操作结果。授权密钥仅保存在页面内存，未写 localStorage/Settings。
- 后端只接受 `{action: start|stop|restart}` 和既有资源 ID。运维密钥至少 32 字符、恒时比较、同源检查；固定仓库 PowerShell 服务读取独立的运维 manifest，核对启动器/可执行文件 SHA256、模型路径及已保存 endpoint/model 身份。浏览器不能提交命令、脚本、路径、端口或 GPU 参数。
- 全局进程内互斥 + `wx` 磁盘锁；停止前创建时间/PID/可执行文件/命令行/旧启动 state 身份匹配，检查 llama slot 和外部未协调客户端，检查 watchdog。资源维护 drain 阻止新调度，活动/排队任务不被取消。启动 300 秒有界等待，结果未知保留锁及维护 drain，禁止自动重试；操作前后都核查私有事实/TESTNET/TP/Production 门禁。
- 操作审计写入独立私有 JSONL，并发布 Engine MODEL_LIFECYCLE_OPERATION 事件。不加入交易所写接口，不改变 Primary 唯一 Entry、NO_SEPARATE_ADD、HUMAN_MANAGED、Review/TP SHADOW 权限。

## 运维配置和剩余边界

默认管理操作 **关闭**。正式受控部署时，须为正式 Engine 注入 `ZDJ_MODEL_MANIFEST`（用户/SYSTEM 可写的私有绝对路径）、`ZDJ_MODEL_OPERATIONS_DIR`、`ZDJ_MODEL_OPERATION_TOKEN`，并在正式 host 的 PATH 中配置已审查的 PowerShell 7 `pwsh.exe`，不能把 Codex 会话的 PATH 当成正式启动环境。使用同一 PowerShell 7 隐藏启动子启动器，避免 Windows PowerShell 5 的原生 stderr 解释差异。本轮已经生成并只读验证三模型的实际本机 manifest，保存在私有操作目录，不上传密钥或私有配置。三个 `status` 调用实际返回 STOPPED。

manifest 的每个模型包含 `id,model,port,launcher,launcherSha256,executable,executableSha256,stateFile,logRoot,modelPath,physicalDevice`。只能由运维人员配置已审查的启动器；不得用 Settings 资源编辑绕过该清单。当前进程看不到 slot、存在 watchdog/外部客户端、端口归属或创建时间不确定时，后端拒绝停止；这类情况需另行核对，不进行强杀。异常锁只能在确认启动器和模型最终状态、交易保护后由运维人员处理，没有浏览器“强制解锁”接口。

当前 GPU 采样仍依赖上一轮有限采样器；长时间采样服务尚未部署，过期显存继续 UNKNOWN。首次健康探测原先可能串联 `/health` 与 `/props` 两个 GET，现在只发一个 `/health` GET，单测核实请求数；这是探测路径优化，不是自然任务吞吐对比。本轮没有恢复成功后的自然任务性能对比，不能宣称模型/交易吞吐提升。Primary 候选 backlog 也不等于在途推理；保留 backlog 的维护测试通过，实际活动推理和 Review 队列仍会拒绝维护。

## 验证记录

`npm ci` 实际完成；现有 npm audit 报告 2 moderate/2 critical，未执行不经验证的强制依赖升级。初始验证保留 S00 entrypoint 新增、review 路径误选、测试固定端口静态门禁、私有同步联合类型四份失败日志；修复清单与类型后继续完整验证。最终测试/构建与 GitHub 精确 HEAD CI 状态见本目录后续验证收据，不能借用上轮 source6533 的 CI。

## 最终源码验证收据

源码 `d39024d97f681c46c94e7537dd688f6bf271096a` 的本机 `npm run verify:ci` exit0，264 文件/2,210 测试全部通过，包括完整类型检查、构建、脚本/release/S00 门禁；[精确源码 Windows CI 38032096492](https://github.com/3684993/ZDJMITS/actions/runs/38032096492) SUCCESS，完整日志已归档。主实现提交为 `43eca77cf931f79dca4ab3ace6499769095d8f90`，最终边界修正为 d39024d；[Draft PR #38](https://github.com/3684993/ZDJMITS/pull/38) 尚未合并。之后仅更新文档/证据，不能将此 CI 宣称为未来文档 HEAD 的已完成 CI。

本轮最终仍 NOT_PERFORMED / NOT_PROVEN。旧 Engine23936/build3.9.8-0de7665352d82b261c1d 在线，三模型未恢复。最新签名28/28和独立canTrade=true不构成持续安全或长验收 PASS；首次29笔中的本地身份失败样本仍保留。完整失败/成功验证日志和脱敏状态见同目录 JSON/log 文件。

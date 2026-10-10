## 2026-10-10 17:42 实际部分恢复：Scout/Primary成功，Review未执行

本轮正常工具实际允许Scout/Primary创建启动器；第一次Scout因Windows RemoteSigned和三原脚本ZoneId=3而未加载。已核验三文件Git内容无diff、SHA256一致，仅对用户明确指定的三文件执行Microsoft Unblock-File；标记已私有备份，未修改全局/用户/组策略、脚本内容或TP/交易保护。随后Scout25912/8081/Vulkan0/ctx32768与Primary16772/8084/Vulkan2/ctx65536实际启动，health=ok，原启动器真实smoke完成；Scout还有两次新自然Engine完成，Primary此样本未观察新自然Engine run，勿将startup JSON smoke等同自然Entry。

Review8083原harness脚本启动请求在CreateProcess前被平台blocked by policy拒绝，没有细项，没有启动器/模型PID，不换包装/通道绕过。实际2/3恢复，不宣称全部完成。D3DKMT+WDDM主要显存：Scout PCIbus5约6,357,635,072bytes，Primarybus19约18,526,982,144bytes；跨卡少量分配保留。两模型同时加载commit52,047,556,608/limit178,217,693,184bytes；未加载Review，三模型预算尚UNKNOWN。

当前Engine23936未重启/未部署，17:42本地TP26/26 READY且问题计数0、Production0；这只是本地保护读回，不伪称此次新增签名全仓门禁。旧08:34验收ABORTED、新24h NOT_STARTED/T0=null。原退出发起者/退出码仍UNKNOWN；本轮Windows来源标记只解释新Scout首次启动失败，不解释旧llama退出。运行证据和启动/推理事实日志在actual-partial-recovery-1742.json及actual-*.log。完整本机日志D:/MITS/logs/model-start-20261010-173800。

> 用户随后明确指定 `D:/MITS/scripts/1/` 三个原脚本。正常Scout启动请求也在CreateProcess前被平台拒绝，未启动任何模型；路径、实际不同hash/context及本机三条命令见 [USER_SPECIFIED_SCRIPTS_REQUEST](./USER_SPECIFIED_SCRIPTS_REQUEST.md)。前文P0封存和命令是此前授权目标，不冒充此次指定脚本来源。

# 2026-10-10 立即恢复授权：实际执行与部署状态

**尚未恢复模型，尚未部署或重启 Engine。** 本轮已重新请求正常本地执行，但 Scout 启动命令在 CreateProcess 前被平台拒绝：`blocked by policy`。原始模型启动器没有执行，未产生启动回执或新 PID。Review、Primary 和 Engine 生命周期未尝试；没有改名、包装、切换通道、权限降级或删除交易保护来绕过拒绝。当前终端 approval policy 为 never，不提供可用的交互升级入口；用户的业务授权已明确，不是待补的一般许可。

可以实际继续的工作已完成：读取最新 main 正式指令、隔离 worktree、现场只读核验、备份、全量测试、封存独立发布包，以及提供主机操作者使用原有启动器的[具体恢复命令](./HOST_OPERATOR_RECOVERY.md)。命令仅语法校验，绝不作为已经执行的恢复证据。

## 源码、测试与发布准备

- fetched main / 冻结发布源：`4c84631226c5373b04b1c3c73a820bf2a11448a5`；PR38 merge `84d5d4f81b3ad6c73b1f7744c441d4f887de9638` 已包含在 main。
- 对 `d39024d97f681c46c94e7537dd688f6bf271096a` 的 engine/dashboard/core/contracts 源码、scripts、config、package/lock 做 Git diff：无差异。此证明只表示源码等价，不冒充最新 HEAD 的远端 CI。
- 本轮 `npm ci` EXIT0，`npm run verify:ci` EXIT0：**264 文件 / 2210 测试**；contracts2/core63/dashboard140，Engine四 shard575/623/399/408。全日志 `immediate-verify-ci.log`。本轮无需新的源码修补，PR38 修复已在 main。
- 发布 worktree `D:/MITS-RELEASES/ZDJMITS-v398-models-4c84631`：独立 `npm ci`、全部 workspace build EXIT0，clean source，**1999 文件**封存 + Settings253/hash 对照成功。
- source hash `3611b8d300f091946b7dc479e951c8f1ee45dafc4f11ae50ce9e8be71b467de5`；artifact hash `5b239d299d94d9ce70a85c835040337d9d4c36ee2456cd3d48b6ebde7eadc688`；候选 build `3.9.8-5b239d299d94d9ce70a8`。这不是当前在线 build。
- 新精确构建授权 **prepared/inactive/revoked=true**；原在线授权未修改。随机48-byte模型操作 token 已存主机私有文件，ACL仅当前操作者/SYSTEM；没有注入旧 Engine，也未上传 token。
- 本轮 PR39 首次精确 HEAD `ee4bab35e84fa054a90e730ec9a745bedbf6d490` 的 [Windows CI 38040055297](https://github.com/3684993/ZDJMITS/actions/runs/38040055297) **SUCCESS**，job步骤全部success，完整成功作业日志和原始SHA256已另归档到 `github-actions-immediate.json`。随后证据归档提交不改运行源码，其最终HEAD仍需单独回读，不用此绿色冒充归档HEAD结果。PR38 原源码 CI 回执保留在 `github-actions-integration.json`，不覆盖、不借用。

## 现场证据与原因分层

16:51+08 初查，17:00+08 末查：唯一 Engine listener PID **23936** / host **12440** / instance `d071f59f-9eba-4efa-b3da-3d4289f3671f`，仍加载旧6533发布包/build `3.9.8-0de7665352d82b261c1d`。代理 PID **18300** / port **20091** 保持原配置；`D:/MITS` dirty文件原样保留。

| 角色 | 端口 | 当时监听/PID | 实际 `/health` | 新推理 | 配置物理设备 |
| --- | --- | --- | --- | --- | --- |
| Scout | 8081 | 无 / null | connection refused，2071ms | 未执行 | Vulkan0 / Intel B580 |
| Review | 8083 | 无 / null | connection refused，2060ms | 未执行 | Vulkan1 / RX7900XTX |
| Primary | 8084 | 无 / null | connection refused，2046ms | 未执行 | Vulkan2 / RX7900XTX |

不存在 llama 服务进程/端口且本机 HTTP 明确拒绝连接，证明三个服务确实离线，不能解释为单纯 HTTP 超时或 UI 探测误报。旧 Engine 的 `fetch failed` 缺少分类，PR38 已补连接拒绝、探测超时、UNKNOWN及驾驶舱分层显示，但旧在线包仍未加载这些修复。

17:05+08 再次读取三个原始启动器与 llama.exe，hash 均与私有 manifest 匹配。Windows service查询成功且无ZDJ/MITS/llama服务记录；相关task状态另附JSON，未更改task。主机commit limit178,217,693,184bytes、committed25,287,835,648bytes，物理available80,878,825,472bytes；这是未装载模型时的余量，非三模型预算。

9B GGUF hash `cd76ec205963b3b33350093e6904d9de16c4e666fd104e1f632d25c7f15f2a13`、27B GGUF hash `e00082f779fa385cee8c68a3ec8833a75778cc87272240b942f74e0b8243e520` 本轮重读一致。`--list-devices` 真实列出三卡，空闲约11421/23748/23748MiB；这是离线时 Vulkan 枚举值，**不是三模型同时装载的预算或进程显存**。

当时没有模型 PID，当前 PID→LUID→PCI、各模型专用显存、自然任务利用率及真实 inference 都 **UNKNOWN/NOT_PROVEN**，不沿用历史3400/14020/22336或旧PCI归属冒充当前测量。当前 GPU collector 的旧有限窗口也不能充当持久新监控。主机操作步骤提供只读 D3DKMT/WDDM 回读和三点真实采样，采样不会发模型请求。

原退出发起者、真实退出码、是否控制台/父进程退出 **UNKNOWN**。三份原 stderr/state 日志已复制到新私有目录保留。新一轮四小时窗口 Application1000/1001无 llama/Vulkan匹配、System2004/4101无匹配，不证明“无崩溃”或“人为关闭”；缺少原进程退出收据与父控制台退出证据；本轮 Security4689 查询成功但四小时内无匹配，不证明当时已启用终止审计。没有假设为OOM、驱动崩溃或其它维护会话操作。

## 交易安全、备份与部署边界

两轮只读签名 GET 均为 **26/26** 全仓 TP exact dual-ID / local cycle / symbol+side+qty+price / reduceOnly 全项 PASS。V3 account未返回canTrade，原 helper overall仍正确记录 `TECHNICAL_UNVERIFIED`；独立签名V2 GET确认同账户 `canTrade=true`，不把缺失V3字段伪写为true。两份原始脱敏证据保留。先前29→28及一项cycle不符、旧TP偶发缺口仍保留原记录，不被本轮26/26覆盖。

末查本地 TP26/26 READY，所有 missing/unverified/qtyMismatch/wrongSide/duplicate/positionFactUnresolved 为0；独立私有同步样本 age **8134ms**，consecutiveFailures0/lastErrornull；TESTNET_ENABLED、lockedToTestnet=true，Production写入/阻断尝试 **0/0**。Engine累计 TESTNET写 **51** 是自然运行统计，本任务 exchange writes0，不称全局零写。本轮新鲜样本不是稍后操作的永久许可，部署时必须重新采集全部门禁。

SQLite **只读 pinned transaction online backup** 纳入一致的已提交WAL状态；新备份1,026,441,216bytes，`quick_check=ok`，fsync成功，SHA256 `f595b8306e2c5877422ef7f430ed25baf4a8df0fda260b9073e837e62f26cf5d`。配置/Settings与备份对照成功，当前实例、授权、原日志、模型state已私有留存。回滚仍用旧6533精确构建/原授权，并保留最新 durable DB；未恢复任何旧备份、未压缩或修改在线DB。

另有明确技术项：现有 `stop-zdj-lan.ps1` 的停止实现是 **Stop-Process -Force**。它不是 graceful shutdown。本轮正式指令要求一次 graceful Engine-only切换；在可证明的旧实例graceful停止路径缺失时，不直接强制终止旧保护 Engine，记录 **NO_GO**。没有尝试 Engine动作，不能将其称为“Engine启动也被平台拒绝”。

Primary唯一Entry、NO_ADD、HUMAN_MANAGED和TP保护未改变；没有启用安全空闲借用、TP目标ENFORCE、真实改价、撤TP或补仓。新API权限、PID/创建时间、launcher hash、锁、drain/timeout/audit已通过本轮相关全量测试；真实新Engine UI/API授权路径仍待部署，未停止刚恢复的27B制造演示。

## 实际交接

1. 主机操作者在 PowerShell7 按 `HOST_OPERATOR_RECOVERY.md` 逐个执行原有 Scout→Review→Primary启动器，保留完整 stdout/stderr、真实 smoke 和监听状态；只回传日志文件，不复制长控制台内容或凭证。Codex不换通道代执行被拒绝的启动。
2. 回读真实三模型 inference、当前PID/创建时间/alias、PID-LUID-PCI/显存、同时装载资源预算以及TP/私有/Production0；失败不自动重试或杀其它GPU进程。
3. 只有动作时安全门禁、封存/Settings、回滚与graceful停止机制都通过，才能激活此次构建授权并执行一次正式Engine host启动，随后6/6身份、全仓TP和实际UI/API回读。不要运行以前已消费的controlled-switch脚本。
4. 本轮旧24h仍 **08:34 ABORTED_SAFETY_FAILURE**；新24h **NOT_STARTED/T0=null**，等用户后续指令。没有新部署收据、模型恢复收据、推理或性能提升可以报告。

自动审批拒绝的是恢复Scout8081的原启动器进程创建请求，唯一给出的理由是 `blocked by policy`；没有细项。用户业务授权无需再次询问，但当前工具不能发起交互升级，必须由有主机执行权的操作者运行原始命令后再核实结果。

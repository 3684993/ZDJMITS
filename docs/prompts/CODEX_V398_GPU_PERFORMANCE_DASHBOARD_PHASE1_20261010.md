# Codex 直接执行提示词 — v3.9.8 双GPU性能与真实仪表盘（第一轮 D0–D2，随后 G1）

**权威仓库** `3684993/ZDJMITS`；**主任务** Issue #30；**本轮 ChatGPT 已实际提交的实现分支**：
`chatgpt/v398-performance-real-metrics-d0-d2-20261010`，**必须先 fetch 最新远端 HEAD 而非凭此文件抄静态 SHA**。该分支从 2026-10-10 09:22+08 的 main `662d7f3b34c11bb62ca7e028d1b98c32acbeb647` 起步，新增真实主机 CPU/RAM/Engine RSS/heap 采样器、只读 API、Vue/ECharts `/performance` 页面和状态灯；**还没有本机验证和真实物理GPU映射，不能声称通过或已部署**。

## 0. 第一道任务：先读取完整当前事实

在隔离 git worktree 中，依次阅读本文件、`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、`docs/project-memory.md`、`docs/plans/V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010.md`、`docs/plans/V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md`、`docs/plans/V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010.md`，并复核 Issues #30/#26/#28/#24/#23 及开放 PR #25/#27/#29。网络 PR **彼此独立且未部署**，不要无审查地混合合并入本轮。工作树 `D:\MITS` 既有 dirty 状态必须完整保留，不要在其上 reset/clean/cherry-pick 覆盖。

**验收重要状态更正：** 初始仓库 `docs/reports/v398-engine-cutover-20261010/acceptance/state.json` 的 08:24 RUNNING 已滞后。PR #25 分支 `docs/reports/v398-network-optimization-20261010/acceptance-aborted.json` 与 `acceptance-abort-checkpoint.json` 证明 **2026-10-10 08:34:00.270+08 ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED**，当时 LOCAL TP 14/15 缺1、private age15.952s、Production writes0，Engine PID23688/build3.9.8-bb45c11。后来本地缓存17/17不是新的签名核验，不能让原24h恢复/PASS，更不能忽略 TP 警报。先只读核对现时 Engine 实例和全部仓位对应TP身份的签名原始证据；若无法安全闭合，**不执行新Engine部署或重启**。不要改变保护TP或下达订单来“让指标变绿”。

## 1. 拉取 ChatGPT 实码，先做红绿测试与小范围修复（D1/D2）

```powershell
git fetch origin main chatgpt/v398-performance-real-metrics-d0-d2-20261010
git worktree add D:\MITS-WORKTREES\v398-performance-dashboard origin/chatgpt/v398-performance-real-metrics-d0-d2-20261010
cd D:\MITS-WORKTREES\v398-performance-dashboard
git switch -c codex/v398-performance-dashboard-d0-d2
npm ci
npx vitest run apps/engine/src/services/hostPerformanceSampler.test.ts apps/dashboard/src/utils/performanceFacts.test.ts
npm run verify
```

若 monorepo 需 workspace 命令或全局脚本以仓库现有 README/package 为准修正，不要跳过测试。禁止以 `--force` 修改受保护清单或绕过 S00；如源码新增文件导致 inventory 告警，使用**现有机械化清单生成流程**，记录最初失败与修复，然后重新验证。完成后本轮必须提交**真实代码、测试和 GitHub CI**；`D0` 报告不能代替可工作的 Vue 页面。

已有代码锚点：
- `apps/engine/src/services/hostPerformanceSampler.ts`、`.test.ts`：原生 Node OS CPU time 差分（首次 UNKNOWN），Windows RAM、Engine RSS/heap，10s按需采样，实例隔离、有界历史；
- `apps/engine/src/api/router.ts`：GET `/api/v3/observability/performance/host`；
- `apps/dashboard/src/views/PerformanceView.vue`、`components/PerformanceTrend.vue`、`utils/performanceFacts.ts` + tests；
- `apps/dashboard/src/{router.ts,navigation.ts,routePreload.ts,layouts/AppShell.vue,api/client.ts}`：桌面导航、移动“更多”、15s可见时更新；
- Engine 既有 `/api/v3/brain/resources`、`/brain/runs`、`/diagnostics/binance-governance`、`/diagnostics/private-sync`、`/diagnostics/market-stream-traffic`、`/snapshot`，不追加私有REST/模型生成请求。

**审查细节**：修复所有 TS/Vue 类型和 API 数据形状错误；必须保证路由可加载、独立阅读权限、移动端不溢出、ECharts resize/dispose、15m/1h/6h/24h/7d 采样**不得把缺失时间段插0**。审核 source/asOf/TTL/instance、颜色和文字双编码、降级/断连/未知绝不绿灯。不得从 `/brain/runs` 的分页100条冒充完整 7 天排队P95；不要从 output tokens / wall time 伪造 llama tokens/s。GPU/PCI、HTTP451来源与 SSH wire bytes 没有证据就保持 UNKNOWN。检查 ECharts/Pinia/reactivity 重绘是否阻塞核心运行，图表与页面只在本地测试镜像构建展示，**不用真实秘密值做截图**。

## 2. D0 Windows物理GPU映射和30–60分钟自然业务基线（只读，禁止强制模型推理）

在**当前授权Windows本机**，仅使用只读 PowerShell/WMI/WDDM GPU Engine性能计数器、Get-NetTCPConnection(8081/8083/8084/8080/20091)、Win32_Process PID + 命令行、GPU PNPDeviceID/PCI设备实例路径、LUID、服务日志已经存在的 `--device` 配置，交叉证明：

1. Scout B580 ↔ 8081 ↔ 真正 PCI bus/function/LUID ↔ PID；
2. 27B Review 8083 ↔ PID(旧记录14020) ↔ 哪一块 PCI bus19/bus22；
3. 27B Primary 8084 ↔ PID(旧记录22336) ↔ 哪一块 PCI bus19/bus22；
4. GGUF文件哈希/量化、`n_ctx`、chat template、模型alias/JSON输出schema等价性。真实现场 PID/配置可能变化，不得以旧数值强填。

若 WDDM GPU Engine引擎实例和设备 LUID 到物理 PCI 无法闭合，写 `PHYSICAL_MAPPING_UNKNOWN` 并保留 evidence path，不许以 Windows任务管理器GPU1/2序号推断。每 10–15s 抽样至少30分钟优先60分钟的**自然请求**；没有合法自然任务则如实标记 `IDLE_NO_WORK`，不能人为生成请求/交易。记录每服务真实运行/空闲/队列/等待p95/失败/超时/reviewSkipped reasons，应用decoded payload与SSH wire bytes分开。命令行和原始日志可能含路径、私有参数，GitHub只推脱敏枚举摘要及哈希，原始保密证据仅本机受控保存。

普通运维脚本与普通日志放在**同一脚本目录**，采样失败 fail-open for trading / fail-closed for metrics：永不影响交易安全进程；不要同步跑昂贵 CIM/PowerShell 于 Engine 1s tick。不得开启禁用的 `/metrics` 而重启 llama-server。

## 3. D1 数据合同与外部GPU采样器（隔离不影响交易）

补 `packages/contracts` / `apps/engine` 中的 typed read-only performance contract：`asOf, instanceId, sampleSource, measureStatus (MEASURED/UNKNOWN/STALE), unit, window, droppedSampleCount, coveredFrom/To, resourceId, physicalDeviceIdVerified, port, PID, duty`。实现独立低频 Windows sidecar/GPU采样器；优先只读**localhost**、明确 ACL，Engine只能读取已校验的受限采样快照（原子写换、最大大小、TTL、绝不能盲信客户端的 GPU归属或注入交易参数），不把GPU命令运行置于 engine交易tick。保留进程实例更换断点，环形存储旋转或单飞/cache；敏感凭证、原始SQLite、模型完整prompt、真实order/client ID不写公开仪表盘/GitHub。

**真正的连通状态灯合同**：绿 = 来源已证明、采样在 TTL 内正常；黄 = degraded/拥堵/仅配置未端到端证明；红 = 有证据的连接断开、HTTP失败或明确安全问题；灰 = UNKNOWN、没采到或失效。区分：
- SOCKS本地端口监听 ≠ 隧道远端端到端可用；
- SSH连接成功 ≠ Binance私有WS事件送达；
- Binance HTTP451 可能是上游法律/地区限制/HTTP拒绝，不能归为代理故障，也不得切出口规避；
- HTTP502/503与 socket timeout分类，交易响应 UNKNOWN 不能自动重发POST；
- llama ONLINE ≠ 正在推理，IDLE_NO_WORK不得红灯；
- TP显示 PROTECTED 的本地缓存 ≠ **最新签名订单双ID验证**。

## 4. D2 实用驾驶舱，逐阶段替换 UNKNOWN

保持Vue3 + ECharts5，不引入别的 UI/chart 库。将主机/GPU/3模型/代理请求/WS/private/AI队列及 token速率（真实可用时）以带时间戳卡片、轻量折线、事件时间轴和状态灯展示；交易实际事件用由同一`brainRunId→intentId→原始client/exchange order IDs→部分fill→TP→exit` 唯一身份去重的漏斗。收益只使用同一币种可靠归因，资金费缺失不能显示0，钱包差值≠交易PnL。对没有完整事实的漏斗/回撤保留UNKNOWN。

补前端组件测试：真实数据加载、空数据/stale/断连、451/502、model无合法任务、BTC + USD/USDC不合法混加、partial fill不算第二次Entry、响应式布局、组件销毁不留timer和chart、隐藏页面不持续轮询、浏览器负载采样。在真实部署前**离线** browser screenshot，提交脱敏截图至仓库。

## 5. 随后 G1 GPU容量租约 — **单独的独立PR，不混D0/D2**

先查真实 `apps/engine/src/services/aiFabric.ts`：`dutyResources()`目前固定8084 ENTRY_PRIMARY/8083 REVIEW，`queueReview()`用 `reviewActive`，`run()`用`load.active`。不得只新增 dutyRoute 让两个计数器争用同一端口、超 maxConcurrency=1；以**物理模型服务resourceId/endpoint**统一原子 lease、slotAcquire→run→finally release，防所有角色双借用、错误释放与半开熔断重入。Home Primary优先8084，Home Review优先8083，在模型文件/template/context/输出契约兼容且有实际待执行请求、另模型空闲、Review到期不被饿死时，允许负载借用；Primary业务角色/Entry唯一授权上下文**不因执行在8083而变化**；Review永不获Entry授权。

需在离线回放证实 PRIMARY等待p95、Review overdue、failure 和相同授权数量前后可比。围绕 Primary积压+Review到期、两边都忙、模型超时、Service Offline, Context不兼容,两物理GPU其实同一resource,取消请求/重复队列、fallback和fail-closed 做竞争测试。不强制平均每GPU百分比；没有等待任务就正常闲置。

GPU2挂单 Review 的 TTL/事实触发，以及`TP_TARGET_REVIEW_DRY_RUN`采用又一独立小PR。TP SHADOW只从冻结合法候选目标ID/KEEP/HANDOFF选择；零交换写入、不得生成任意新价格/数量、不得撤原TP；如未来要求真实修改TP则需另外正式授权并给出无保护真空证明。NO_SEPARATE_ADD_V398、HUMAN_MANAGED、clientOrderId + exchangeOrderId幂等及全部TP保护不可退化。

## 6. 每一阶段真实交付+GitHub-only永久归档

**任何 Codex报告文件、脱敏结果、单测/verify日志、CI证据、图片全部必须提交 GitHub 分支或 PR**，不得只留本机、ChatGPT附件或临时路径。敏感的原始DB、key、原始订单身份等**例外必须仅在本机受限目录，GitHub只存最小脱敏校验事实**。记录到 `docs/reports/v398-performance-dashboard-20261010/`：
- `D0_GPU_PHYSICAL_MAPPING_AND_BASELINE.md`（真实/UNKNOWN、采样窗口和来源）
- `METRIC_CONTRACT.md`（完整数据字段/失效/单位/实例）
- `D1_D2_IMPLEMENTATION_REPORT.md`（路径、具体功能、性能开销、安全不变量、真实测试、Build、CI SHA）
- `SCREENSHOT_REVIEW.md` 和不含账户隐私的浏览器截图
- `G1_GPU_LEASE_VALIDATION.md`（后续独立PR，真实负载与离线并发测试）

每次PR后更新 `docs/project-memory.md`、`docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、Issue #30（以及 #26/#28相关任务），回读GitHub commit SHA、对应 GitHub Actions实际运行结果，禁止仅有“本地通过”文字无证据。报告先记录RED、FIX、GREEN、和未证实点。**不得仅新增审计/规划文档便标完成**。

## 7. 现网操作门禁和授权边界

本轮默认**全部离线、只读观测**；允许经测试CI/审查推动独立PR。用户原则上授权后续必要的**受控Engine重启**，但必须先独立确认当前验收已ABORTED且没有新的正式24h开始，核查最新runtime/config/approved build、TESTNET only、Production写入0、fresh signed所有当前非零仓位TP完整、client/exchange双ID/side/reduceOnly/qty/price、HUMAN_MANAGED、no-add policy、私有<=60s、代理/交易所合法性、已生效的旧订单保护及可回滚DB备份。只要其中任何一项 UNKNOWN / 未通过，**不部署不重启**，原保护性Engine继续运行，提交阻断报告等运营方再次明确动作。不得因dashboard性能或GPU使用率低就重启模型、SOCKS或修改实际TP订单。

若全部正式门禁通过且明确执行获准，则单次Engine-only控制发布，记录6/6运行身份和恢复收据、Production0、模型/代理PID未误变、TP覆盖签名后验，并从**新的 T0**开启完整24h验收；旧ABORTED尝试不得续算。禁止自动多次重启、自动修改Settings、擅自升级PR25/#27/#29引入新WS路由风险、替代代理地区绕过451限制。

**你的第一条 Codex 回复**必须说明：已拉取本指令及 ChatGPT分支 HEAD、原24h ABORTED事实、将运行哪些实际测试与拟提交PR；执行完成后提供 GitHub 文件和SHA/CI链接，不能只说“完成审计”。
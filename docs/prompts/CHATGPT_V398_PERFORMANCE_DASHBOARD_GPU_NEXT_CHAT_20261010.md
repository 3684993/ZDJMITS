# 新ChatGPT会话提示词
# 聊天标题：v3.9.8仪表盘性能优化

请继续维护我在GitHub的项目 **3684993/ZDJMITS**，这次的主目标不是重新审计交易系统，而是**提高双Qwen 27B GPU的有效任务利用率，并真正实现驾驶舱实时性能监控仪表盘**。请你作为系统架构与代码审查负责人，与Codex协作实施、测试和提交GitHub；不要要求我重新复制历史聊天或解释项目约束。

## 第一步：你必须从GitHub读取最新事实和工作锚点

1. 最新 `main` HEAD、GitHub Actions、所有开放的相关 PR/Issue、真实已部署runtime build（不可用最新文档commit冒充部署）。
2. 优先读取 `docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md`、`docs/project-memory.md`、`docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md`、`docs/reports/v398-engine-cutover-20261010/acceptance/state.json`。
3. **此次主计划：** `docs/plans/V398_DASHBOARD_GPU_OBSERVABILITY_AND_PERFORMANCE_PLAN_20261010.md`；同步读取 `docs/plans/V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md`、`docs/plans/V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010.md`、`docs/plans/V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md`。
4. 关联Issues #23 (ENAUSDC显示补仓1次的订单身份审计)、#24 (REST/WS/SOCKS优化)、#26 (双Qwen27B容量租约)、#28 (GPU2挂单/持仓/TP SHADOW)。必须检查是否已有Codex提交，不要重复工作，新增页面应与现有Vue组件和样式兼容。
5. 当前仓库技术：Dashboard = Vue 3 + Pinia + **ECharts 5** + Vue Router，`apps/dashboard/src/views/{OverviewView,OperationsView,BrainView}.vue`、`components/EquityChart.vue`、`router.ts`、`navigation.ts`、`routePreload.ts`、`layouts/AppShell.vue`；Engine已提供大量只读`/api/v3`快照/diagnostics。先复用已有接口与图表库，不引入新前端框架。

## 已知最新实际运行事实（必须重新只读确认，勿把历史回执当实时）

- 2026-10-10已正式执行过一次 Engine-only受控部署，运行构建 `3.9.8-bb45c11acbe9819a3456`，当时 Engine PID23688 / host26576，6/6构建身份；代理SOCKS本地20091 PID18300；Scout Intel Arc B580 (12GB)本地8081，AMD RX7900XTX上双27B服务8083/8084，先前进程ID14020/22336。**实际物理PCI bus19(bus19 GPU1)和bus22(bus22 GPU2)分别对应哪个模型端口仍需准确查证，不许猜**。
- 用户Windows TaskManager此前显示 RX7900XTX两卡各使用约16GB专用显存，但一张瞬时GPU利用率99%、另一张0%。这个观察说明计算负载不平衡，不能单凭瞬时%断言模型故障。默认配置8084 `PRIMARY_BRAIN/ENTRY_PRIMARY`，8083 `REVIEW_BRAIN/PENDING_ENTRY_REVIEW+POSITION_REVIEW`，同27B、各`maxConcurrency=1`；职责固定造成任务量差异是重要假说。
- 24h TESTNET验收从北京时间**2026-10-10 08:16:49.685**至**2026-10-11 08:16:49.685**，已启动但截至上一回执仍`RUNNING / IN_PROGRESS_NOT_PASS`。开始新工作先检查新checkpoint，不能声称已经PASS；如果仍在运行，优化默认**只读观测、独立工作树离线PR/CI，不自行重启、部署或终止验收**。用户后来另行明确授权发布时，再正式执行实例/TP身份安全检查及新T0。
- 本次部署前后20次有界Binance GET全部HTTP200，历史451/502没在该采样窗口重现，不等于已根治。资金状态/签名TP在旧采样12/12；之后本地缓存13/13不是同一时刻签名13/13。保留TESTNET、Production写入0。
- 本项目严格**禁止向已有仓位补仓/加仓/摊平**。初始原订单多次部分成交不等于第二笔独立授权；绝不绕过NO_SEPARATE_ADD_V398。Primary唯一自主Entry决策权，HUMAN_MANAGED人工所有权优先，原始订单双ID/幂等/TP连续保护与UNKNOWN fail-closed必须保留。历史Issue#23仍需按真实订单身份区分UI“补仓次数”的误标记。
- Engine约15s同步私有状态与对账、5s TP扫查、2s Entry pending处理、15s持仓Review尝试，GPU2 Pending Review最早在订单创建15s后、后续约30s一次；持仓Review可能因原plan、owner、预算、事实未变而不触发。TP Guardian对有效保护TP通常保留原价；GPU2的Position Review只有HOLD/REDUCE_PROPOSAL/EXIT_PROPOSAL/HANDOFF，没有当前自由TP改价权限。不要为拉升GPU占用率而制造虚假Review、补单或频繁撤TP。

## 新功能一：优先解决双27B GPU的有效工作负载失衡

- 先读源码 `aiFabric.ts`、`aiUsageLedger.ts`、`positionReviewRunner.ts`、`positionReviewScheduler.ts`、`entryCoordinator.ts` 和当前真实Settings，而不是只改模型路由配置。
- 用 Windows只读采样/现有`/brain/resources`、`/brain/runs`、localhost llama.cpp `/health`/可用的`/slots`、真实GPU进程/PCI映射，采集至少30–60分钟自然业务：推理任务总数、每角色queue depth/wait p95、延迟、tokens/s、超时、失败、Review skip reasons、运行/空闲时间、GPU内存和活动趋势。
- 重点实现**统一每GPU真实物理服务的原子容量租约**，替换reviewActive/load.active两套独立并发计数：先Home职责，实际有可用工作、另一模型兼容且闲置、不会饿死Review时允许借用8083进行`ENTRY_PRIMARY`推理，同样也可让闲置8084完成Review任务；业务职责仍然以request.role/原Primary授权链决定，不能把Review建议变为新建仓权限。两卡初期每个maxConcurrency=1。
- 优化GPU2挂单Review触发与年龄/TTL/事实版本，保留确认身份再撤单、partial fills禁止重下；持仓与TP的智能建议先做独立 `TP_TARGET_REVIEW_DRY_RUN`/SHADOW，只从Engine已冻结、合法授权候选中选择，**零交易所写入且不修改现有TP价格**。需要自动TP改价时须独立授权、证明不会造成保护真空。
- 成功不是两GPU各50%/99%；成功是有真实任务时Primary排队降低、正常Review更及时、模型输出质量不降、无重复/违规Entry、所有持仓TP保持完整。

## 新功能二：驾驶舱“性能监控”可视化页，必须真正可用而不只是计划

在现有Dashboard新增独立路由（建议`/performance`）与中英文适度搭配的中文标题**“性能监控”**，保留现有驾驶舱信息架构，可从桌面导航及移动端“更多”访问。优先复用ECharts5，分为：

A. **主机资源总览**：CPU、内存总量/可用/占用、Engine RSS/heap、磁盘性能、GPU0 Intel B580 12GB、GPU1/GPU2 AMD RX7900XTX 24GB 的GPU计算使用率、专用与共享显存、PCI物理位置/服务PID/端口/模型名。需显示实时数字、趋势图和真实采样时间；仅在计数器可用时显示温度/功率。
B. **三个Qwen/Scout模型与推理状态**：8081 Scout、8083 Review27B、8084 Primary27B；RUNNING/IDLE/QUEUED/OFFLINE、任务开始/结束/失败/超时、排队耗时、推理耗时、首token延迟/令牌速率（只有真实数据才显）、Context/输出tokens、模型同一业务职责与物理GPU的映射、推理时间线/请求分布与负载对比，解释“GPU忙但另一张空闲”的原因。
C. **SOCKS代理及Binance通信**：Windows 20091经SSH到Ubuntu，再到Binance Futures Demo；代理连接/阶段耗时和拥堵队列、Socks/TLS/HTTP阶段、每类REST请求量/延迟P95、HTTP200/400/429/418/451/502/503/timeout、私有同步时延和有效性，PUBLIC/MARKET/PRIVATE WS状态、消息数、重连、数据陈旧和流量。区分应用payload bytes和SSH真实wire bytes，不能用不可靠计数虚报。
D. **分析/交易流水线图**：选币候选→Primary AI分析→WAIT/PLACE→生成唯一Intent→挂单→部分成交/全部成交→仓位及TP→Review建议→安全平仓。真实状态转化率、订单到期/撤单/改价、未确认UNKNOWN、是否存在补仓硬禁令触发；可选时间窗口并查看同一时间轴关联事件。不能重复计算同一physical cycle/partial fill。
E. **盈亏/风险可视化**：持仓未实现盈亏、平仓已实现损益、费用/资金费、确认净盈亏及UNKNOWN、不完整账务覆盖率、盈利/亏损笔数、权益和回撤曲线、持仓时间/TP当前保护与签名核验来源。明确钱包变化≠纯交易PNL，USDT/USDC不能不换汇混加，资金费UNKNOWN不得算0，图表显示缺口。
F. **统一异常时间轴与状态解释**：GPU失衡/忙碌、推理超时、代理拥堵/451、WS断连、订单UNKNOWN、TP未验证、Engine历史重启，按真实时间戳关联。可选择15分钟/1小时/6小时/24小时/7天，历史与当前实例不能混合为一个连续运行。

页面应精致但克制：KPI卡片、曲线、占用条、timeline/Gantt、漏斗、热力图、状态层级；电脑/手机自适应、深浅主题、中文标签、悬停明细、单位和时间戳、空数据/UNKNOWN/STALE而非虚构0。新页面默认**纯只读，无交易执行/重启/撤单按钮**。

## 性能采样/后端实施要求

- 引入数据合同的asOf、采样source、覆盖率、单位、窗口、实例ID、可信度/UNKNOWN，并与已存在的Dashboard快照/AI Usage/RequestBudget/TradeRecords复用，**禁止由驾驶舱直接连接Binance私有接口或直接向AI模型发生成请求**，不得因刷新页面增加交易所压力。
- Windows CPU/RAM/GPU等OS指标可由独立低开销只读host sampler（本机受限任务）定期采集并传递给Engine的只读聚合端点；不要在1秒Engine交易tick里同步跑重型PowerShell/CIM。对GPU物理PCI与进程归属无法证明则标UNKNOWN；没有启用llama`/metrics`就不能为了监控重新启动27B进程。
- 有界采样与存储/轮转、低CPU/IO、无敏感字段，HTTPS或localhost局域网约束遵从当前部署；前端可见时适度轮询和重绘，不为浏览器刷新每秒重新拉大量长序列。之前我明确要求运维脚本和普通日志位于**同一目录**，不要默认写AppData/TEMP；API密钥、私有SQLite放受限位置且永不输出到UI/GitHub。
- 先做D0真实基线与指标字典，再D1低负载采集、D2真实dashboard、D3GPU职责租约+有用Review与SHADOW、D4完整专项测试/CI。**不能只交设计文档或几个静态假的仪表图，就宣称已经优化**；如果现有工具允许，Codex直接提交离线PR和带截图/数据合同/单测的实现，协同ChatGPT逐阶段审查和修复。

## 与Codex协作/完成判据

作为ChatGPT架构审查员请直接从GitHub读进度，制定分阶段P0/P1任务；对已有代码做line-level审计，给Codex具体有序任务提示与验收项；Codex可以在独立工作树离线编写真实Vue/TypeScript/metrics代码、运行unit/e2e/压力、npm run verify和CI、提交PR，之后你对照源码和CI结果继续推进。凡有证据表明缺陷，允许直接修复**离线源码**；发布/运行时Settings修改/Engine或代理/模型实际重启必须另取我的指令，不要误触正在运行的24h验收，也不要陷入永远只写审计报告的循环。

**首轮请立即输出**：1) 最新main HEAD及与实际Engine的差异；2) 现有可复用的监控API/图表；3) GPU2为何空闲的可证实链路与未知点；4) 功能模块、关键文件、数据合同及完成优先级；5) 一份给Codex可直接执行的第一阶段离线开发指令（优先GPU物理映射+Review队列指标与仪表盘骨架，带真实数据接口而非mock），同时建好Issue/进度文件以便后续接续。完成的每一阶段更新GitHub进度、docs/project-memory.md与CURRENT_MAINTENANCE_HANDOFF.md；我不想再重复项目背景。

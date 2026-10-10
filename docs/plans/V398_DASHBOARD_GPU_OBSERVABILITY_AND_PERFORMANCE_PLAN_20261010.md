# v3.9.8仪表盘性能优化 — GPU利用率、模型推理、代理与交易生命周期统一可观测性实施计划

创建日期：2026-10-10（用户中国北京时间约09:17）；该文件是**实施任务规划，不代表现网已实现或实时监控已测量**。源码审计所依据的 GitHub main：f933b20a676f3dc0b37557c9bb13f5910798f785（新增规划/交接文档会改变main，但不改变正在运行的Engine构建）。当前已部署V398 TESTNET Engine构建 3.9.8-bb45c11acbe9819a3456，发布收据记载PID23688/宿主26576/6of6；启动正式24h验收 T0 2026-10-10 08:16:49.685 +08，结束时间2026-10-11 08:16:49.685 +08，**状态RUNNING、尚未判定PASS**。以上PID与状态是既有发布回执，开始实施时需重新只读核实。不可把GitHub最新文档commit当作新Engine版本已部署。

## 一、产品目标与执行原则

建设一个中文、响应式、直观的“性能监控 / Performance”驾驶舱页（例如 /performance，可从左侧导航和移动更多页进入），用**同一时间轴**将主机资源→三个模型请求→SSH/SOCKS代理→Binance REST/WS→Entry分析漏斗→持仓TP/退出→净盈亏结合起来。目标是发现瓶颈、降低推理等待和网络拥塞、提高有效决策覆盖，**不是使所有GPU总是100%或让模型为填满显卡而反复交易**。

优先复用现有技术：Dashboard Vue3 + Pinia + ECharts 5 + lucide-vue-next，路由 ./apps/dashboard/src/{router.ts,navigation.ts,routePreload.ts,layouts/AppShell.vue}，现有图表组件 EquityChart.vue，视图 OverviewView.vue/BrainView.vue/OperationsView.vue。不要引入第二个图表框架，不要重写驾驶舱导航、快照及WS通信。

**信息展示只读**。不在性能仪表盘上加入建仓、平仓、TP改价、代理出口变更、GPU模型重启按钮。涉及既有运维操作仍保持原有鉴权与单独确认流程。

## 二、现有可复用接口与真正缺失的数据

下列已有源码入口不能因新功能而重复产生数据、形成额外交易所GET：
- /api/v3/snapshot：DashboardSnapshot，含positions/entryOrders/aiResources、executionTruth、tradeQualityEconomics、performanceTracking、运行状态；
- /api/v3/brain/resources 与 /api/v3/brain/runs：资源和推理记录，分页、角色/状态/时间筛选； /api/v3/brain/diagnostics；
- /api/v3/ops/runtime 与 /api/v3/operations/health、/api/v3/diagnostics/storage、/api/v3/diagnostics/closeout；
- /api/v3/diagnostics/binance-governance 与 /api/v3/diagnostics/private-sync：REST限速、请求预算、429/418/队列与private freshness；
- /api/v3/diagnostics/market-stream-traffic：WS每秒桶计数/解码应用字节、PUBLIC/MARKET lane及retained symbols，**明确声明非SSH真实wire bytes**；
- /api/v3/observability/entry、/api/v3/observability/trading-quality、/api/v3/pipeline、/api/v3/experience、交易记录相关API；
- /api/v3/operational-incidents：当前与历史异常事件。

源码中的缺口（需先查实，不能无证据声称完全没有）：
1. Windows**主机/进程**的CPU、RAM（总量、可用、Engine RSS/heap）、GPU计算占用率和专用/共享显存、驱动时间、进程到**物理PCI bus19/bus22**和模型端口8083/8084的可靠对应关系；另有B580 12GB、Scout8081；
2. 每模型推理**统一时序**：请求开始/排队/推理中/结束、上下文tokens、生成tokens、token/s、P50/P95/超时、slot占用、等待/拒绝、实际职责（ENTRY_PRIMARY、POSITION_REVIEW、PENDING_ENTRY_REVIEW、SCOUT）、模型hash+GGUF量化+context和GPU绑定；
3. SOCKS/SSH**真实链路拥堵**：本机20091侦听/SSH PID、Ubuntu TCP Send-Q/notsent/retrans仅在合法有权限的既有监控可读取时采集；TCP-wire bytes与WS解码应用bytes分开；连接等待、TLS、代理SOCKS握手、REST排队及真正HTTP状态码不可混为一谈；
4. 以上数据与交易生命周期、盈亏具有**同一asOf、instanceId、采样覆盖、字段来源与缺失状态**的绑定；交易漏斗及Review拒绝原因和GPU任务等待关系需可视化但不能伪造相关因果。

### 主机采样建议

首选**Windows本机的独立低开销只读采样器**（本机计划任务/sidecar，独立于核心交易事件循环），只访问许可的OS/WDDM Performance Counters/Windows CIM/进程信息及现有localhost llama.cpp只读端点；必要时Ubuntu侧通过已有合法只读统计回执聚合，不得放宽ssh专用账户MaxSessions0，也不能从Windows向服务器开一个非授权交互shell。
- 系统CPU%、内存总量/可用、Engine进程PID/Working Set/Private Bytes/Node heap、磁盘IO可用性；GPU各自vendor/name/PCI bus/device/function/Windows LUID与采样source、dedicated/shared VRAM、GPU Engine utilization、采样间隔；
- GPU利用率为Windows驱动/任务管理器观测值，可能和模型tokens/s不同；不把不同GPU Engine子计数相加到>100%；映射到模型PID必须有可重放证据。若计数器/驱动不提供可靠PCI映射，report UNKNOWN而不是把GPU1/GPU2用下标猜绑定；
- llama.cpp /health、可支持时/slots、如已启用/metrics；不得为采样重启模型去开启metrics，也不应让定时器不断请求模型生成文本；
- 读取localhost现有Engine聚合快照，不频繁抓全量大量明文Prompt或原始持仓；采样保持有界、支持冷启动/断开/浏览器未打开时不无限累积。
- 自定义运维采样脚本产生的普通日志/证据文件保存在**其脚本所在目录**（沿用操作人员提出的约束），不把私有数据库、API key/secret或受限凭证放入日志；按现有D:\MITS-OPERATIONS\operator-cutover的运维操作习惯命名可单独配置，不应任意分散在TEMP/AppData。持久敏感材料仍放受控路径，不放公开网页。

## 三、界面布局（中文，桌面和移动端）

**页头固定状态栏**：当前Engine build/PID/instanceId、TESTNET/PROD隔离状态、观察asOf/采样年龄、24h验收进度/状态、Binance private READY或UNKNOWN、当前非零仓位及签名TP核验时间、Production写入0。历史验收/旧实例数据显示“历史”而非混进当前实时。
 
1. **资源总览**：CPU、内存总/可用、Engine RSS/heap/GC（有来源才显）、GPU0 Intel Arc B580 12GB/8081 Scout、两张AMD RX7900XTX 24GB/8083 8084。每张卡一张卡片：PCI位置/模型PID、显存专用/共享、GPU计算利用率与最近15m趋势、采样延迟、温度/功耗仅有可靠来源才展示。使用数值+小型折线/区域图；99/0的瞬时差异不等于实际任务分布。
2. **模型推理工作流**：统一时间轴的泳道/Gantt（等候QUEUE→RUNNING→COMPLETED/FAILED/TIMEOUT）、各GPU最近5/15/60min利用率和推理tokens/s、推理请求数、平均/分位排队与生成时间、上下文/输出tokens、独立角色、运行中的symbol（脱敏允许）、Review缺计划/Owner/预算/事实未变化等原因。对比Primary8084与Review8083，显示“空闲无合法任务”“资源不可用”“任务积压无法指派”的不同状态。
3. **代理/交易所链路**：Windows SOCKS localhost20091→SSH→Ubuntu转发→Demo，REST请求量、排队P95、阶段超时分布（queue/SOCKS/TLS/HTTP）、200/400/429/418/451/502/503类别、每类事件时间线及关联具体来源，private freshness、每lane WS decoded KB/s和msg/s、重连次数/缺口、retained symbols、如合法可用的SSH-wire bytes另图。不制造新的Binance poll；不得用VPS公共200宣称账户/地区许可，也不得把HTTP451无条件重标为代理故障或尝试规避地域限制。
4. **分析到挂单到建仓漏斗**：每个真实Primary run（SCOUT与POSITION_REVIEW不能混入Entry决策分母）→WAIT/REJECT/PLACE→初始Intent→订单submit→交易所ACK/unknown→PARTIALLY_FILLED/FILLED→保护TP，转化率和各阶段P50/P95用**同一身份与同一时间窗**。给出失败首因、UNKNOWN仍占用、订单TTL/改价次数/Review取消/复核时序，不把挂单量当成交量、不把同一原始单partial fills算第二次Entry/“补仓”。
5. **持仓、保护与退出**：非零仓位数，TP签名protected/required及采样时间、TP UNKNOWN/缺失/方向错误、AI_ACTIVE/HUMAN_MANAGED、持仓FIRST_FILL起算时长、AI管理deadline，仓位Review建议和owner权限、退出任务pending/claim/terminal状态、实现平仓与未平仓分层。
6. **盈亏与风险**：已实现与未实现盈亏分开，交易净收益 ex-funding与包含资金费的all-in、手续费、滑点、胜败次数、亏损笔数及金额、累计权益曲线、亏损/回撤趋势；仅根据有证据支持的TradeRecords与币种USDT/USDC换算状态展示。funding UNKNOWN/不完整记录只能显示部分/UNKNOWN且在图例中区别；**钱包净变化不等于交易PnL**、交易次数不等于独立物理cycle、亏损不能伪造0。可按15m/1h/6h/24h/7d及币种/角色/来源筛选，在图下注明样本数和覆盖率。
7. **异常与因果排查**：复用operational-incidents，将GPU2 idle、Primary队列积压、WS数据空洞、REST请求超时、451、Order UNKNOWN、TP未验证等按共同时刻对齐，给出证据跳转，不直接宣称因果；告警只读，支持时间放大/选区查看窗口详情。

UI要求：适配桌面和手机；ECharts按需模块加载、支持ResizeObserver、图表dispose、防重渲染；页面首次绘制及交互不卡顿，1分钟窗口每点不必1秒全部绘制；超时/暂无数据为UNKNOWN/STALE/NO_SAMPLE不画0，历史状态与实时状态分开。图表必须有文字状态说明、轴单位、时区与数据来源、键盘可达、颜色之外的文本区分以及深浅主题对比。

## 四、GPU负载优化方案和优先级

紧接着实现[双27B调度计划](./V398_DUAL_27B_GPU_UTILIZATION_AND_DUTY_SCHEDULING_20261010.md)、[持仓/挂单Review与TP审计](./V398_GPU2_POSITION_PENDING_TP_REVIEW_OPTIMIZATION_20261010.md)，同时跟进[Binance网络通信优化](./V398_BINANCE_NETWORK_COMMUNICATION_AUDIT_AND_OPTIMIZATION_20261010.md)。

1. **先可观测后调度**：只读映射PCI Bus19/22→PID→8083/8084→resourceRole；采30–60min真实自然任务的入队/运行/空闲/原因、模型GGUF/context/backend兼容性；当前固定8084 ENTRY_PRIMARY、8083 POSITION_REVIEW/PENDING_ENTRY_REVIEW，两个maxConcurrency=1，现有aiFabric的reviewActive与load.active独立计数。
2. **离线统一容量租约**：每物理server一个原子maxConcurrency=1的slot/token，优先Home Duty；只有真实合法待处理工作且另一卡空闲、没有到期Review时才能BORROW_IDLE承接同一种请求职责。模型角色仍按原Primary业务合同执行，Review职责不获建仓权限。GPU实际0%但无合法任务时正常显示IDLE_NO_WORK；不为追求利用率强制触发模型/交易。
3. **Review有价值的任务**：挂单age/TTL/市场变化触发的有界复核，保持对已经部分成交的origin禁止二次Entry，交易所动作前精确双ID/JIT；持仓Review按事实变动、AI owner/计划/预算执行，只读评估TP目标质量，若新增TP_TARGET_REVIEW默认**SHADOW/DRY_RUN不改价、不撤任何TP**，ENFORCE需另行授权、可证明合法无保护空档的替换机制。
4. **性能KPIs**：有机会时Primary请求排队P95下降、Primary有效3–5min决策覆盖不退化、Review overdue减少、吞吐提高或同等结果低成本、模型失败/超时不升、TP签名完整与NO_ADD/HUMAN_MANAGED不变。GPU占用均值只是辅助，不将两卡各50%或两个持续满载设成强制目标。

## 五、实现阶段和Codex交付

- **D0 只读审计/定义数据字典**：核对最新main/运行build/已部署24h验收、新旧接口、当前dashboard性能以及采样可用性。输出 BASELINE.md、MAPPING.md、METRIC_CONTRACT.md（type/units/asOf/source/status/ttl/identity/window/retention/cost、已有接口vs新增字段）。
- **D1 metrics后端**：优先只读旁路低开销Windows sampler和/或既有Engine数据汇聚，统一时间窗端点，例如GET /api/v3/observability/performance/summary和/history，需由Codex选择兼容现有架构的实现，要求单飞、有界缓存、最少采样、ACL、secure read-only；不得把重型OS指标采样塞入1s交易tick。
- **D2 仪表盘UI**：新增 PerformanceView.vue 与 route/nav/preload、响应式主题、复用ECharts已有组件；分区卡片、曲线、时间轴、状态/异常详情，在浏览器可视时轻量刷新与SSE/WS事件合并；无数据、老化、断线、跨实例都明确显示。默认只读，绝不触发交易写入。
- **D3 GPU池化**：Issue#26统一物理server原子lease与真正职责保留，用D0/D2基线比较；Issue#28挂单Review与持仓TP Shadow独立小PR；与Issue#24网络优化错峰，避免代理/REST负载混杂影响指标。
- **D4 安全测试**：前端单元/组件/e2e可访问性、响应式、虚拟大时间序列/内存泄漏、零敏感信息、主机采样失败、跨实例重启切段、计算未知与funding UNKNOWN、真实订单exact 双身份、Partial fills、GPU高负载/idle、451/502/429/418、拥堵/Review pending；后端hostile timeout压力与事件loop抖动、npm run verify、GitHub Actions、各阶段性能前后量化。
- **D5 发布单独决策**：目前24h RUNNING，**默认只离线PR/CI，不擅自部署、重启Engine/代理/模型/修改Settings253/任务/TP**。用户后来明确要求上线则用正规权限和fresh signed全部仓位TP/6-of-6/Production0检查，若中断当前24h则本轮ABORTED，新构建新T0重新完整24h。允许在现有受控测试环境做不影响持仓的离线静态UI截图，但不可用真私有字段泄露。完成后更新GitHub主handoff、project-memory、Issue进度和报告。

## 六、不变量与经验约束

- 主仓库 GitHub 3684993/ZDJMITS。禁止补仓/摊平/第二独立Entry；Primary唯一建仓决策权，Review只可在原合法权限下提供建议；HUMAN_MANAGED人工所有权强约束、TP先于任何性能优化、订单client/exchangeID、UNKNOWN fail-closed、TESTNET-only、Production写入0。
- 真实Engine目前有运行中的私人仓位；不要为了Dashboard看起来更丰满反复抓私有REST、自动调用模型、手工下单或清空历史。新采样绝不能抢占交易安全/签名事实的请求预算。针对HTTP451留原状态和原始来源，确认是否合规拒绝还是实际SOCKS错误，绝不更换出口绕过地区限制。
- 旧PR19 90min验收与2026-10-10新24h验收分离；历史CI成功/文档提交不是当前运行代码已经升级。真实运维收据优先于缺失信息推断。
- 当前仓库已有ECharts5，请勿重新安装React/Vue版第二图表库。所有图表用可溯源真数据，资金曲线未知时必须显示空缺与原因，严禁假造性能数据。

## 七、参考源码与外部任务

- apps/dashboard/{package.json,src/router.ts,src/navigation.ts,src/routePreload.ts,src/layouts/AppShell.vue,src/stores/system.ts,src/api/client.ts,src/views/OverviewView.vue,src/views/OperationsView.vue,src/views/BrainView.vue,src/components/EquityChart.vue}
- apps/engine/src/api/{router.ts,projections.ts}, apps/engine/src/services/{aiFabric.ts,aiUsageLedger.ts,positionReviewRunner.ts,entryCoordinator.ts,tradingQualityRuntimeObserver.ts}, apps/engine/src/adapters/binance/{BinanceTransport.ts,requestBudget.ts,BinanceMarketStream.ts(实际路径在adapters/market)}
- docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md; docs/reports/v398-engine-cutover-20261010/acceptance/state.json; docs/project-memory.md; docs/prompts/CURRENT_MAINTENANCE_HANDOFF.md
- Issues #23 (ENA补仓身份)、#24 (REST/WS/代理拥堵)、#26 (双27B原子调度)、#28 (GPU2挂单/持仓/TP Shadow)

交付标准：**真实有用的性能瓶颈解释 + 可复核的两卡/三个模型与代理/交易统一仪表盘 + 更优业务等待与保护指标**。不能仅交静态UI、假样例截图或只更新文档后宣称优化成功。
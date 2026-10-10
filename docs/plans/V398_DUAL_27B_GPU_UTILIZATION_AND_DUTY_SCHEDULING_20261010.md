# V3.9.8 双 RX 7900 XTX / Qwen 27B 职责路由与 GPU 利用率专项审计和优化方案

2026-10-10。**仅基于 GitHub 代码、此前已存发布回执和用户 Task Manager 截图数字的静态审查，不是假称已采集现场 GPU 性能数据。** 优化首先追求有效分析吞吐、等待时延、交易质量和TP安全，不追求让两个GPU始终显示50%。

## 一、症状与已经能够确认的事实

- 用户现场：同为 AMD Radeon RX 7900 XTX 24 GB，一张 PCI bus19 99%利用率/专显16.2 GB，另一张 PCI bus22 0%/专显16.3 GB。两张都已有约16GB模型权重/显存占用，**0%表示采样窗口无显著GPU执行，不代表模型未加载或故障**；99/0%单一瞬时采样不能代表小时任务处理量。
- 当前默认项目配置：`config/settings.default.json`中 `brain-7900-primary` = `PRIMARY_BRAIN` / `http://127.0.0.1:8084/v1` / `qwen/qwen3.8-27b` / maxConcurrency=1；`brain-7900-review` = `REVIEW_BRAIN` / `http://127.0.0.1:8083/v1` / 同模型别名 / maxConcurrency=1。`aiDutyRoutes`把`ENTRY_PRIMARY`**唯一**绑定8084，把`PENDING_ENTRY_REVIEW`与`POSITION_REVIEW`**唯一**绑定8083；`SCOUT_RESEARCH`默认关，其硬件8081 B580独立。
- 正式发布回执 `docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md`记录：三个模型8081 PID3400、8083 PID14020、8084 PID22336，均留存且HTTP200；当前运行Engine23688/build3.9.8-bb45c11。**哪个PID具体使用物理bus19/bus22需从Windows的实际进程命令行、GPU引擎/LUID和启动日志确认，不能凭端口或TaskManager“GPU1/GPU2”猜。**
- `apps/engine/src/services/aiFabric.ts`：`dutyResources`读取各 duty 的预配置路由、`choose`只在同一 duty 的可用 resource中按 active及上次latency挑选；`ENTRY_PRIMARY`目前只有一个resource，根本没有选择另一个27B的机会。`queueReview`按第一Review resource ID集中排队，POSITION_REVIEW优先；Review任务是否发生还受`positionReviewScheduler.ts`中计划预算、事实触发、owner状态、最短间隔控制。结论：**配置导致任务负载偏斜是合理的优先假说**，仍需真实逐run数据验证繁忙卡究竟服务哪类任务。
- Review在`aiFabric.run`调用时设置`disableThinking=true`；Primary需要完整Entry决策schema、context预算、最大900输出tokens；Review最大600输出tokens且禁用thinking；单次GPU时长差异不能只按“订单数”比较。
- llama.cpp两独立Server时显存分别常驻，但不同推理请求不会自动跨server分摊；此优化属于**业务请求路由与任务调度**，不是简单增加`maxConcurrency`或重启GPU。若仅有一个长耗时Primary任务，另一个卡无其它可兼容待处理请求，就没有可安全同时执行的额外计算。

## 二、立即执行的只读诊断（不打断当前24h交易验收）

在用户Windows PowerShell中运行（纯本地只读，不调用模型推理/不启动进程）：

```powershell
$ports = 8083,8084
Get-NetTCPConnection -State Listen | Where-Object { $ports -contains $_.LocalPort } |
  Sort-Object LocalPort | ForEach-Object {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
    [pscustomobject]@{
      Port = $_.LocalPort
      PID = $_.OwningProcess
      Executable = $proc.ExecutablePath
      CommandLine = $proc.CommandLine
    }
  } | Format-List
```

必要时对比每个PID的`--device`/`--split-mode`参数与`llama-server.exe --list-devices`设备清单、物理bus19/bus22启动日志；不可仅用同名“AMD Radeon RX 7900 XTX”匹配，不要直接变更GPU绑定或为测试新启动另一个27B。端口和PID已可能随真正重启变化，需取当前值。命令行若意外含secret，不能原样贴GitHub。

如果当前llama-server版本支持，先在单个localhost服务器查看`GET /health`、`GET /slots`；`/metrics`只有启用了`--metrics`才可用，不能为采样当场重启打开。使用系统`Get-Counter`的GPU Engine pid实例或Windows任务管理器的“GPU引擎”列，结合当前运行PID，连续多个完整分析/复核周期观察，而非一次99/0。采集脱敏指标：
- 每resource ID/role/duty：run count、queueDepth、queueMs p50/p95、requestMs p95、tokens in/out、tokens/s、失败/timeout、lastCompletedAt、AI circuit状态、耗用GPU处理秒数（如支持）；
- GPU bus/PID/VRAM/执行引擎占用及每分钟活动时间占比，`llama-server`slots processing/deferred和实际并行容量；
- 业务信号：Primary在有可执行候选时的有效3–5min节奏、positionReview欠账/超时、占用中在仓TP签名完整性、禁补仓和Production0；
- snapshot timestamps和采样覆盖，标明独立显卡“空闲无任务”vs“有排队但无法指派”。

## 三、已找到的调度器设计缺口与必须避免的误修

1. **职责固定而非池化。** 在默认`aiDutyRoutes`下，8084只作Primary，8083只做Pending/Position Review；一方积压时另一方无法安全借用。若直接把Review的resourceId添加为`ENTRY_PRIMARY`第二候选，可能由`choose()`选择，但现有同GPU队列`queueReview`仅用`reviewActive`而Primary用`load.active`，没有一个原子共享的physical lease；两种任务可能重叠超出`maxConcurrency=1`。
2. **动态选择与Review队列不是一个调度器。** `choose`检测`load.active`并在请求开始后`load.active++`，Review scheduler按自己的`reviewActive`队列计数；需要共享per-resource原子token并包含queued/active/overdue deadline，才能真正借用空闲GPU而不会互相饿死。
3. **资源静态角色与实际运行任务角色耦合。** `run()`用`resource.role==='PRIMARY_BRAIN'`计入`primaryServes`；`resourceMetrics`里以`r.role`展示固定任务类型，`resourceHealth`也将“Primary是否必需”与角色绑定。跨路由时必须改为按**实际执行的duty/run.role**记账，否则Entry/Review公平计数和故障断路器可能错。
4. **所有者与决策权不可移动。** `ENTRY_PRIMARY`由运行的Primary算法/提示词/冻结candidate决定`PLACE_LONG/SHORT`等，执行前必须通过既有身份、权重、TP、资金、策略门禁。把Primary请求放到物理Review的同型号27B，不代表将Primary权限转给Review职责；记录该run.role仍为PRIMARY_BRAIN且归属同一Primary授权链，绝不能拿`POSITION_REVIEW`输出做建仓决策、不能附加一次下单。
5. **后端模型等价性未经证明。** 显示同model别名与16GB VRAM不保证GGUF hash/量化/ctx/chat-template/build/flash-attention/JSON schema格式/seed/采样参数一致。通过`GET /props` + 启动命令与真实文件hash做同等配置基线，离线比较相同冻结prompt的协议正确率/JSON schema/prompt budget/延迟；模型输出不同为正常可能性，不能要求逐字一致。
6. **负载均衡不等于平均GPU瞬时利用率。** 需优化eligible Primary等待、模型请求服务时延与Review及时性；在两服务器中`--parallel 2`只是同服务器内slot并行，不是跨GPU分流，也可能增加KV内存/高峰等待；不以此作为首选修复。
7. **不建议先改为tensor/layer双卡分片。** 当前两个独立27B已能加载且有不同职责；一请求跨卡模型分片有额外跨PCIe通信/内存/调度成本，不会自然提供双实例任务吞吐改善。仅在实际发现长上下文单请求性能瓶颈且经过离线吞吐/时延对照时评估。

## 四、建议分阶段架构：统一按“实际物理端点”借用空闲计算

### Phase G0：真实映射 + 30–60分钟运行诊断
- 连续观察至少覆盖数次自然Primary分析与Review周期；读取现有AI_RUN_STARTED/COMPLETED、resourceMetrics与真实GPU占用，区分等待候选、不触发Review、模型推理时间、Prompt构造、server内部queue。
- 出具 `gpu-role-process-map.json`（bus→GPU设备→PID→8083/8084→resourceId→duty，缺项UNKNOWN）、`gpu-workload-baseline.json`（时间窗/样本数/指标/缺失值）、`GPU_DUTY_BASELINE.md`。只读不做人工补单/强制推理。采样不得阻塞Engine。
- 若目前是业务本身Review调用少、Primary单请求占满，不能把GPU0%写成故障；报告实际可分派的并行任务数量。

### Phase G1：离线统一租约调度器（不更改交易语义）
- 引入`AiPhysicalResourceScheduler`，将`ENTRY_PRIMARY`、`POSITION_REVIEW`、`PENDING_ENTRY_REVIEW`都映射到真实resource池，保留SCOUT独立。每GPU一个**原子共享active lease容量=1**、perDuty有界队列/截止时间；提交请求时原子地选择资源、占slot、在finally释放，无时序竞态。
- 默认保持原职责亲和：Primary优先8084；Review/挂单优先8083。仅当Primary等待超出可测阈值、8083确实空闲且没有已欠到期的Review，允许8083执行**Primary职责请求**；反过来仅当Review逾期、8084空闲且不会导致已具备执行资格的Primary超时，允许8084承接**Review职责请求**。确定性调度策略，禁止无条件随机轮询。
- 每资源记录pending/active/nextAvailableAt、dispatchReason(`HOME`/`BORROW_IDLE`/`REJECT_BACKPRESSURE`)、queueAge与role，调度时按实际请求duty而非endpoint静态角色给出提示词/schema/模型参数，保留Primary风控/Replay审计和HUMAN_MANAGED。
- 首期保留每GPU`maxConcurrency=1`，不要为了50%利用率增加并发；先证明确有多个独立任务并能安全并行；模型离线、超时、半开断路器时fail-closed，不因重试在两端重复生成新的交易授权。
- 不允许复用已经过期的EIP/market/context；被借用的Primary完成后仍须重新核验其入场事实、当前持仓和原始intent身份。如果等候过久，拒绝本次过期请求，不凭旧快照PLACE。

### Phase G2：回归/压测/候选选择
- 使用固定的离线相同输入、慢快模型延迟注入、多Pending Review/Position Review与间歇Primary突发；证明任意resource`active<=maxConcurrency`、Review无饥饿、Primary原始权限、无需二次提交、JSON契约、原始intent/fill/TP按身份严格一致。
- Compare: A固定角色、B同型号池化且只有空闲借用、C权重/到期时刻驱动（仅离线实验）。对照p50/p95/p99排队及总时延、completion tokens/s、有效Primary cadence与各GPU active时间。通过“延迟更低且安全不退化”决定是否优化，不以两个GPU固定50%为上线条件。
- 必须通过npm run verify/全量CI，专项tests覆盖跨角色并发与Review timeout/Primary fail-closed/模型身份不一致；生成 PR，**仅 offline，不改当前运行Settings253，也不部署**。

### Phase G3：用户授权后的正式发布
- 当当前新24h验收结束或用户主动中止，并取得**单独**上架许可，才准备新的不可变stage与授权，完整6/6 build identity/现场签名TP/Production0/readiness检查，正规一次切换，新T0重启24h。失败走原批准回滚和当前订单保护，不能热修改进程里正在执行的AI策略。
- 如果可通过完全离线 shadow 模拟来验证则优先shadow；没有授权时绝不自动切换/重启两个27B进程。

## 五、简要验证标准

1. 双27B物理PCI身份、PID、端口及GGUF/上下文/后端配置被**可复核**匹配；如果无法映射，明确UNKNOWN。
2. 在有>1项可安全并行处理的工作负载时，闲置模型可被借用，Primary队列p95不升、review逾期/欠账下降或不变；平均GPU%只是辅助指标。
3. 保留`PRIMARY_BRAIN`实际授权与模型角色schema、原始意图唯一性（不得重复下单/补仓）、`HUMAN_MANAGED`、TP、Production0、请求TTL和AI故障停机策略。
4. 有正式的请求-资源分派日志与可读面板显示Duty、实际执行端点、排队时间、token/s、最近错误，健康检测不能将空闲推断成断线。
5. 不因本轮文档/PR影响正在运行的Engine PID23688、27B两个server、SSH/SOCKS代理和当前24h验收；没有新的运行时已部署声明。

## 引用

- `config/settings.default.json`、`apps/engine/src/services/aiFabric.ts`、`apps/engine/src/services/aiFabricResourceState.test.ts`、`apps/engine/src/config/aiResourceLoader.ts`、`apps/engine/src/services/positionReviewScheduler.ts`、`apps/engine/src/adapters/ai/OpenAiCompatibleClient.ts`、`apps/engine/src/services/aiUsageLedger.ts`；
- `docs/reports/v398-engine-cutover-20261010/DEPLOYMENT_RECEIPT.md`及`acceptance/state.json`；
- llama.cpp 官方 [server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)（`/slots`、`/metrics`需启用）与 [multi-GPU](https://github.com/ggml-org/llama.cpp/blob/master/docs/multi-gpu.md)（split模式vs独立服务器）。

**结论：** GPU1 99%/GPU2 0%最可能是固定业务Duty分配+不均衡的真实请求密度造成，非显存或GPU硬件故障的证据。先证实物理PID，离线建设跨GPU统一容量租约与职责可借用机制；无需强求同时50%使用率。

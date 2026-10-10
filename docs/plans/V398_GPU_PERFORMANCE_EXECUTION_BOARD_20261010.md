# v3.9.8 双27B性能 + 性能驾驶舱实施执行板（2026-10-10）

## 最新可核对事实和状态纠偏

- 实际 GitHub main 起点：`662d7f3b34c11bb62ca7e028d1b98c32acbeb647`；当时 GitHub Actions `38012905972` success，仅说明对应main代码验证，不代表当前工作分支验证成功。
- 最后正式部署收据：Engine PID23688 / instance `07230a28-51ac-4dda-9c95-20a789b382b4` / build `3.9.8-bb45c11acbe9819a3456`。这是**历史观察**，不能冒充当前PID/正常。
- **严重状态更正**：main 中历史 `acceptance/state.json` 最后checkpoint08:24显示RUNNING；PR #25分支保存的监测原始副本 `docs/reports/v398-network-optimization-20261010/acceptance-aborted.json` + `acceptance-abort-checkpoint.json` 明确 2026-10-10 **08:34:00.270+08 ABORTED_SAFETY_FAILURE / LOCAL_TP_GATE_NOT_CLOSED**。当时15个需TP的持仓仅14个本地protected、1 missing，private age15.952s，Production writes0。稍后本地缓存17/17不等于fresh signed全部保护。**不能再把原24h称为RUNNING、PASS或续算。** 此处不修改原始历史state/证据，下一次重新开始24h必须独立新attempt/new T0。
- 开放独立网络PR：[#25](https://github.com/3684993/ZDJMITS/pull/25) Demo WS路线、[#27](https://github.com/3684993/ZDJMITS/pull/27) recvWindow/权重、[#29](https://github.com/3684993/ZDJMITS/pull/29) 减小markPrice广播；各自已有CI但未合并/部署。本轮不夹带网络PR运行变更。
- 物理 PCI bus19/bus22 → llama PID/8083/8084当前未知。模型常驻显存不是负载时间，0%也可能无有用任务。默认home职责 Primary8084、Review8083，每台maxConcurrency1，任何借用都必须统一资源级原子容量。

## 首批实码（ChatGPT直接提交到隔离GitHub分支）

GitHub branch `chatgpt/v398-performance-real-metrics-d0-d2-20261010`（跟随实际branch HEAD，不冒充main已合并）：

1. Engine `services/hostPerformanceSampler.ts`：只读CPU tick原生差分、整机物理内存、Engine RSS/heap；首次UNKNOWN、10s缓存、每实例短环形历史，不阻塞1s trading tick，不进行PowerShell/CIM/外网请求。测试 `hostPerformanceSampler.test.ts`。
2. Engine `api/router.ts`：`GET /api/v3/observability/performance/host` 原生只读数据。
3. Dashboard `utils/performanceFacts.ts` 与测试：模型连接、队列、代理配置、private freshness红黄绿灰状态，缺失/STALE不转绿；有限run-ID去重+P95统计。
4. Dashboard `components/PerformanceTrend.vue`：ECharts5真实线图、nullable gaps、ResizeObserver/dispose。
5. Dashboard `views/PerformanceView.vue`：主机CPU/RAM/RSS趋势+独立 status lights、3 GPU 未验证明确 UNKNOWN、AI资源/有限运行列表与排队、Binance诊断/私有同步/WS解码、TP/PNL现有权威投影；桌面和移动端视图。
6. Dashboard `router.ts`/`navigation.ts`/`routePreload.ts`/`layouts/AppShell.vue`/`api/client.ts`：`/performance` 导航及只读GET接线、页面仅可见时15s刷新。

**绝不把首批视为已经测到 GPU 利用率、tokens/s、真实SSH wire bytes、换汇后净收益、完整7天漏斗；这些当前UNKNOWN。ChatGPT当前不可直接执行Windows本机单测/CI/截图，等待实际GitHub CI结果和Codex本机实测，报告和PR中要标记未验证。**

## 任务看板 / 每阶段必有代码

| 阶段 | 真实交付 | 完成门槛 |
|---|---|---|
| D0（立即）| 只读审计真实PID→端口→LUID→物理PCI/设备、模型上下文/模板兼容、自然业务30-60m基线、Review skip reasons | 映射全证据链或明确UNKNOWN；报告源/窗口/缺失；无强制交易 |
| D1（首轮已起步）| Node host低成本采样与API已提交；后续在独立 Windows sampler读取实际 WDDM GPU/显存/SSH连接并可信上报 | 缓存/轮转/ACL/TTLs/跨实例/注入边界/测试；不阻塞交易tick |
| D2（首轮已起步）| 实码 /performance 视图与红黄绿灰灯已提交；继续typed合同、完整UI测试、真实GPU/AI/网络多时间窗曲线、订单漏斗/PNL可信字段 | TS/Vue build、单测、端到端截图、断网/UNKNOWN、节流和移动端、CI通过 |
| G1 | 统一AI per-service原子lease，home优先、兼容空闲借用，Primary业务role不变 | 双角色竞争/不可兼容/超时/overdue Review/重复释放测试 + 专门PR |
| G2 | Pending Review按事实/TTL优化 + Position/TP SHADOW | 双ID/partial fill/no-add/人工/TP全保护，**零真实TP改价** |
| N | 网络PR #25/#27/#29独立审查与逐个测试 | 不把解码payload当SSH流量、不误标HTTP451、PRIVATE授权正确 |
| R | 受控发布和新24小时验收（仅用户正式审批） | 08:34失败已经厘清；fresh signed current TP all, 6/6, private fresh, Production0, no-add、完整重计 |

## D1/D2测量字典与状态灯

**所有metric必须携带**采样时间 `asOf`、采样对象 `engineInstanceId` 或 `modelProcessStartIdentity`、来源 `source`、`status`（MEASURED/UNKNOWN/STALE）、数值可空、`unit`、采样频率与覆盖率、窗口 `from/to`、`droppedRows`、版本/保留边界。不能把页面获取时间和原始指标采样时间混同。**不跨引擎重启续线**。

| 指标或状态 | 当前来源 | 实数/缺失规则 |
|---|---|---|
| 主机CPU/总可用RAM/EngineRSS/heap | 新`/observability/performance/host` | CPU冷启动UNKNOWN，负载用OS tick差分，不使用假常数 |
| 每GPU使用率/VRAM/PCI→PID | 暂无安全证明 | UNKNOWN直到独立Windows/WDDM sampler可信绑定 |
| Qwen Scout/Primary/Review 连接与队列 | `/brain/resources` | health探测超过TTL则UNKNOWN；RUNNING≠ONLINE |
| 已完成AI run与有限P95 | `/brain/runs` | 最近最多100条仅诊断样本；token/s需真实推理分段计时 |
| SOCKS/SSH健康和拥堵 | 现有治理路由/后续Windows+Ubuntu只读 | 代理配置只能黄，端到端健康另证明；SSH wire未知不可填0 |
| REST 429/418，WS decoded bytes | `/diagnostics/binance-governance` 与 `market-stream-traffic` | counter按它自己的观察窗口，decoded不是wire |
| HTTP451/502或私有WS是否送达 | 已有事件和未来直接状态字段 | 不以无数据断言无故障，代理/交易所origin分离 |
| 持仓和TP | `/snapshot` | UI cached protected只是本地快照，fresh signed保护独立证据 |
| 盈亏/资金费/回撤 | `/snapshot` trade/localAccounting | 账户钱包变化!=交易盈亏；funding缺口UNKNOWN；USDT/USDC不盲相加 |
| 订单漏斗 | 未来同一 origin,brainRun,client/exchangeOrder/fill join | partial fill不能等于新订单/独立补仓，UNKNOWN不算成功 |

绿 = 最新来源完备健康；黄 = 拥堵、过期预警、配置存在但无端到端证明；红 = 实证断连、安全故障；灰 = 未采样/来源丢失/UNKNOWN。告警文本与颜色同时出现；TP异常/451明确来源与时间，保障能追溯。前端页不放重启/执行/下单按钮。

## 工作组织和下一步

Codex完整工作命令、测试、单独G1租约、受控发布前停线、报告归档要求一律按：

[CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010.md](../prompts/CODEX_V398_GPU_PERFORMANCE_DASHBOARD_PHASE1_20261010.md)

Issue #30 是唯一整体任务看板；Issue #26负责物理模型租约，#28负责Review/TP SHADOW，#24为网络，#23为部分成交与“补仓”UI真伪。本计划可继续修订，但每阶段必须附实码、单测/CI与可复核事实，**只写新报告而不交付功能不得关单**。
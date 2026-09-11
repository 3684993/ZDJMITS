# V3.9.2 本轮运行问题修复与最终审计接续计划

更新：2026-09-10 22:54 +08:00。状态：**IMPLEMENTING，尚未完成测试/verify/部署**。

## 目标与授权

继续完整2h审计，同时解决用户指出的交易记录平仓时间倒序、市场周期空白、ETHFIUSDC等持仓不同步、私有数据提示误导、模型未启动仍显示在线。只做有证据的小修，不重构执行链。

已授权源码/测试/构建/报告修改和上传Drive zdj；本轮未获Engine生命周期指令，不启停/重启/热重载，不改生产权限、资金/杠杆/损失额度，不交易写入。保留Maker、TP、幂等、UNKNOWN与动态风控。用户要求不因数据问题全局暂停：落实为维护继续、精准展示新增Entry等待；不得使用过期账户事实授权新风险。

## 现场基线与已证根因

- 运行PID16776，instanceId `b6ee5cb2-bdf4-430a-aabe-e8d4bb6cd47e`，buildId `3.9.2-84d58ba7d91508e3fa7b`。当前磁盘已有本轮源码修改，不能再称源码与运行同版。
- collector目录 `data/reports/v392-natural-acceptance-20260910-201439`：120条，summary完成时间22:14:47；summary周期freshness是fresh数量平均值，不是新鲜率。原始聚合未保留逐symbol/runId，须从持久证据补足，不能伪造精确gap持续时间。
- 本轮只读API发现私有REST HTTP418：IP被封禁至1789052879818。请求预算队列40、active0、private inFlight=true、coalesced425，最后账户成功约21:52；不是资金不足。不能绕过封禁或自动重启。
- ETHFIUSDC仍在本地持仓；用户告知已在交易所平仓。尚未独立获取当前远端平仓事实，不得手删生产状态冒充同步修复。
- 私有WS没有pong处理，会在无业务消息45秒后误断线；ACCOUNT_UPDATE旧代码只更新USDT余额，忽略P仓位增量，并错误地把cw当available、把局部推送当完整READY账户。
- AI资源ONLINE主要来自配置/历史请求；空闲或被其他门挡住时缺独立探测。
- Temporal研究被设计为OFFLINE_ONLY，页面展示空研究表；不能开启研究worker写主库解决空白。
- 交易记录API已在分页前byClosedAtDesc排序，前端亦排序；先验证现有行为，不重写。

## 实施清单与当前进度

| 优先级 | 最小修复及文件 | 当前状态 | 验收/回滚 |
|---|---|---|---|
| P0 | `adapters/binance/requestBudget.ts`：封禁期立即报明确等待错误、已排队请求释放失败、排队5秒上限；基于used-weight对公共回补让出私有余量 | 源码已落盘，未回归 | fake-clock覆盖封禁/解封/超时/私有优先；无网络重试/绕禁。回退此文件但保留真实错误提示 |
| P0 | `BinanceUserDataStream.ts` pong延长连接活性，旧socket消息不写当前状态 | 源码已落盘，未回归 | 无业务消息但pong正常不重连；真实断流仍重连；不得操作Engine生命周期 |
| P0 | `runtime/appRuntime.ts`消费ACCOUNT_UPDATE.P：已知仓位数量/零仓同步，时间水位防乱序；不以局部余额伪造完整账户READY | 源码已落盘，必须再审时间边界 | 覆盖ETHFIUSDC零仓、LONG/SHORT/BOTH、乱序、重复、部分变化；缺事件保留UNKNOWN。不可生成假成交/费用 |
| P0 | `state/runtimeState.ts` positionFactTimes；`reconciliationService.ts`防旧REST响应覆盖更新WS事实 | 源码已落盘，必须补竞态回归 | 旧REST不能复活WS已平仓；仅正确scope关闭；复核当前lastRun水位是否过度拒绝合法延迟事件；必要时改为成功读取水位 |
| P1 | `aiFabric.ts`每15s独立有界GET健康探测、健康状态/告警；Primary离线仅挡Entry，9B离线兼容单Primary；`appRuntime.ts`独立调度探测 | 源码已落盘，未回归 | 两模型/只27B/只9B/均离线/恢复/健康过期；不增加并发，不模型推理探针，不启动模型 |
| P1 | `runtimeControlService.ts`显示真实私有等待原因与维护继续；pipeline区分Primary离线/未知和私有数据等待 | 源码已落盘，未回归 | 模式不被非资金问题改为全局暂停；恢复后原因清除；账户门保留 |
| P1 | `api/router.ts`市场周期附只读Hot 15m/5m/1m结构；`TemporalIntelligenceView.vue`显示事实表、离线说明，隐藏空研究表 | 源码已落盘，typecheck通过 | 可视检查无空白；标明这是实时结构而非历史周期研究；不写主库、不增worker |
| P1 | `PositionsView.vue`私有异常显示最后已知仓位警示；`TradeRecordsView.vue`平仓时间↓；`chronologicalSort.ts`tradeId稳定tie-break | 源码已落盘，typecheck通过 | 真实API按平仓倒序、分页稳定；未知时间最后；持仓不伪装已与远端同步 |
| P1 | 完整2h按Hot样本分母重算，统一entryObservation来源逐run对账，质量与P1-A/B裁决 | 未完成 | 不把最近200条当完整窗口；发现归因/费用/时间计算错误先补最小测试修复；缺采样UNKNOWN |

## 中断时精确状态

- 已执行上述源码编辑；第一次Python编辑命令因无python失败，随后Node编辑成功。不重复套补丁。
- `npm run typecheck`四工作区通过；尚未执行本轮新增回归、完整test/build/verify。未发布任何修改。
- 未修改运行DB、Settings、旧交易事实、Engine/模型进程、Windows防火墙。
- 现有最终报告仍是之前CONTINUE-OBSERVING版本，必须本轮收尾后更新，不能作为本次完成凭证。

## 下一步（必须依序）

1. 复核已改文件，尤其WS/REST事实水位和请求预算；补真正覆盖副作用的回归，避免只验证实现自身。
2. 核实前端显示与排序；模型单实例兼容；私有等待不遮蔽真实故障。
3. 重算完整2h：严格1m/5m/15m率、错误/恢复；固定构建窗口的Primary分类/runId守恒；逐ID漏斗与安全边界；fill质量缺项UNKNOWN。P1-A只在有意义1m漏触发被证实才实施；P1-B仅合并同事实稳定必拒，本轮不得借用户诉求删除真实风控。
4. 必要时修entryObservation：当前代码最近200 runs；fill仅按orderId匹配、缺symbol、fee null被当0、completeFillAt取首笔等均须验证后处理。优先真实归因而非增模块。
5. 定向测试通过后npm run verify；构建会更新磁盘dist，运行实例不因此加载新代码。测试隔离，不用live data实例。
6. 更新 `docs/reports/ZDJ-MITS-V3.9.2-FINAL-AUDIT-AND-CLOSEOUT.md/.json`，含12项明确结论与修复/测试/部署状态；本计划同步进度。最终状态只能FINAL-PASS / ENTER-24H-ACCEPTANCE / CONTINUE-OBSERVING / REQUIRES-MINIMAL-FIX / BLOCKED之一。
7. 上传两份集中报告至已核实Drive `zdj`文件夹ID `1n5Mh3CuuVBQ2IwBpp5cHNEz-tdesEu7J`，回读；usage limit只记本地保留，不阻断收尾。

## 交付边界

修复完成不等于线上同步恢复。若需加载新build，先提交具体变更、验证结果与当前实例身份，再取得该次明确手动操作指令。ETHFIUSDC的远端现状未独立核实前，不宣称已修好界面当前仓位；不得手动删除它来做出“同步成功”。

## 最新接续检查点（2026-09-10 23:09，优先于上文旧进度）
- 本轮源码修复已完成，npm run verify 全部通过（Engine 61文件296测试）；随后新增WS pong回归2测试通过。未启停Engine，运行build仍84d58ba7d91508e3fa7b。
- 完整2h已重算：120样本，120.129分钟；Hot分母2137，严格新鲜率1m68.2265%、5m69.8175%、15m84.3238%；quote100%、book99.7660%。原summary新鲜率与最近200次分母错误，不可再引用。
- Primary277=LONG5+SHORT30+WAIT9+NO_EDGE232+协议失败1；RUNNING0。PLACE35→Intent26→本地Order21→exchangeID15→firstFill8→complete7（partial1）。持久化状态为审计时快照，不冒充窗口末状态。
- 重算脚本 scripts/audit-v392-closeout.mjs；执行 node --experimental-strip-types scripts/audit-v392-closeout.mjs。输出 data/reports/v392-final-audit-recomputed.json，含逐run链路和人工抽样。SQLite仅readOnly。
- 发现自然语义问题：NO_EDGE样本仍混用小周期反向解释方向缺失；SHORT样本以同向/低点当回调机会，不能称P0-A质量闭环PASS。不改Prompt倾向，不实施P1-A/B。
- 最新只读API证据 data/reports/v392-final-health.json /closeout.json /snapshot.json /resources.json。私有418封禁、旧账户及ETHFIUSDC802.6仍在；未核实远端零仓，禁止假称同步恢复。
- 剩余检查：observability新路由读取完整archive payload可能随24h增大，宜用轻量列投影；AI probe依赖现有health端点兼容性要明确。修复未自然加载，UI未做可视验收。
- 下一步：收窄观测查询负载，验证；更新最终MD/JSON，状态REQUIRES-MINIMAL-FIX；不批准24h/Production。Drive如限额保留本地。手动加载需用户明确生命周期指令。

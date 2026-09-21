# S01：风险事实、收益账本与可靠观测

状态 NOT_STARTED；terra 主体，luna 负责隔离 collector/指标测试。前置 S00/G0；后继 S02、S05。重点 DA1–DA3、EX4、OP2；涉及 I02/I05/I07/I09。

## 当前问题与范围

UNKNOWN 的七天回溯限制、短期无风险证据到期、funding 未知与记忆分母错误，会污染风险占用和盈利判断。小时率错误、Primary 漏报与事件留存缺口会污染验收。

已存在入口：services/reconciliationService.ts、entryRiskOccupancy.ts、cycleAccounting.ts、tradeRecordSyncService.ts、tradeRecordIntegrityService.ts、experienceService.ts、storageCapacityGuard.ts、liveValidationService.ts；config/settingsStore.ts；adapters/binance/requestBudget.ts。collector `r16-soak.py` 可能位于仓库外，先由 S00 定位、保存 hash，再决定以新只读工具入库，不能悄悄覆盖正在运行的采集器。

## 子 PR 与具体算法

1. **S01-A UNKNOWN 正确性。** 将 exchange 终局、当前风险、身份墓碑分开。保留历史检索覆盖区间及水位，增量拼接 durable 订单/成交证据；当前 openOrders/positions + WS/REST 断档检查继续验证当前风险。不能仅把七天改无限长，不能永久信任五分钟无风险缓存。
2. 对尚无正向终局证据的旧行，提供“历史终局未知但当前风险经新鲜事实验证”的路径；证据失鲜/冲突恢复占用。有 durable 终局才允许终局分类。超过历史接口可追溯范围且本地也缺覆盖的行保留 UNRESOLVED/人工审阅，不为通过 readiness 擅自释放。
3. `validUntil` 与 `nextAuditAt` 留采集/排队裕量；按单调预算和事实变化退避。-2013 缓存只作有时效否定事实，不能代表未成交。先加入探针 orderId/symbol 归因，再讨论重复查询；429/418 不通过加速请求解决。
4. **S01-B 会计真值。** 对每 cycle 保持数量守恒、commission 币种转换证据、有符号 funding。资金费按账户/币种/结算时间/当时持仓历史归属，必要时保留未分配账；总分配额等于来源金额，不能猜给最后一个仓位。缺完整分页/持仓覆盖则 UNKNOWN；证据证明期间无费用才记 EXACT 0。
5. `recordCompleteness` 与净收益可用性分开，收益学习额外要求 netPnl 有限且 funding/费用确证；不要只靠 COMPLETE 标签。修 ExperienceService 的未知分母，同时展示完整/缺失样本数。
6. capital epoch 从可核对账户快照和资金流建立未来有效基准，历史缺失区间保留 GAP；存取款不当收益，不能补造过去净值曲线或自动放行日回撤。
7. **S01-C 观测。** 速率=同一身份相邻/区间计数差÷实际小时差；计数回退和重启分段，不能负数或混身份。peak gauge 按窗口最大值处理，不能套计数器公式。写闸告警使用事件时序和读取时刻，不将闸关闭前合法写误报越权。
8. Primary 告警区别健康 idle、市场暂停、资源故障；按事件即时记录、按持续时间/严重性通知。WS reconnect、存储检查时效和压力必须有真实发布源；替换死探针，去重 lifecycle 不删行为消费者。关键证据存 durable archive，留存覆盖完整验收窗。

## 输出与迁移

输出 RiskFactCoverage、FundingAttribution、CapitalBaseline、CollectorWindowSummary（名称拟议，遵守 CONTRACTS FactStatus）。新增持久结构经 settingsStore 的真实迁移体系登记，活动风险证据不被容量清理删除。

历史回填先 preview（可修/缺证/冲突数量）再在隔离副本 apply；实时应用属于后续单独授权。不改 HUMAN cap、净利地板、SHADOW 或出口策略来消除 blocker。

## 验收用例

| ID | 场景 | 必须结果 |
|---|---|---|
| S01-T01 | 行龄七天前后，账户事实新鲜且身份覆盖连续 | 不仅因 age 跨界退回 tier 0；分类解释一致 |
| S01-T02 | 同例但 WS 断档/分页缺页/新迟到成交 | 保守恢复风险；不能沿用过期无风险 |
| S01-T03 | 仅 -2013 或旧缓存，没有覆盖 | 不得归为永久无风险/终局 |
| S01-T04 | funding 正负/零/重复/未知、跨币种费用 | 符号正确、金额守恒、未知不造零 |
| S01-T05 | 已 CLOSED/COMPLETE 但 netPnl=null | 不能进入胜率/EV 分母；覆盖率可见 |
| S01-T06 | 存取款与交易损益同窗、缺旧基准 | 资金流剥离；缺历史不补造 |
| S01-T07 | 10 分钟计数增量、重启归零、gauge 峰值 | 正确小时归一化/分段/峰值，复现约六倍旧误差 |
| S01-T08 | R17 假 P0 与 Primary 真 PAUSED 同窗 | 写告警不误报，真实 Primary 异常被记录 |
| S01-T09 | 重启/重复回填/事件轮转 | 事实幂等、原始证据可追溯、不丢活动记录 |

复用现有 reconciliationUnknownRisk、unknownRiskAuditTiering、cycleAccounting、tradeRecordSyncService、storageCapacityGuard、liveValidationObservation 测试，按实际文件补命令与结果。

## 通过、停止与交接

G1：上述测试及账本桥接通过；缺证据数量可解释，不要求把所有历史 UNKNOWN 强行清零。必须清除结构性七天退化并区分仍未解决的真实历史缺口。

停止：无法证明资金费归属、身份冲突、需要覆盖原始事实；提交冲突清单而非猜测。回退关闭新读模型并保留新事实，禁止用旧版静默覆盖新分类。

移交 S02/S05：可靠 position/cycle/funding/coverage API、来源/时效字段、缺口夹具；移交 S09：不可变基准与修复前后同输入差异。

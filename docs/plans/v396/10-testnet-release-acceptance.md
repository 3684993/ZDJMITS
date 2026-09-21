# S10：Testnet 验收、发布与最终复审

状态 NOT_STARTED；主实施 terra，luna 只读观测/证据整理。前置 S09 结果完整且所需硬门通过；重点 EX/OP/RI 运行证据。此文件是未来运行说明，**不构成交易、部署、Settings 修改或 Engine 生命周期授权**。

## 当前源码入口

services/liveValidationService.ts、shadowReadiness.ts、privateAccountReadiness.ts；runtime/appRuntime.ts；api/router.ts；scripts/start-zdj-lan.ps1 与现有只读监控工具。先核实真实参数/副作用，不能凭脚本名运行旧 rollout/install/restart 脚本。

拟交付 release-manifest、migration-preview、canary-plan、soak-results、rollback-decision、final-scorecard；新 collector 已在 S01/S08 验证，不在验收窗内悄悄修规则。

## 操作权限表

| 操作 | 可随普通实施任务进行？ | 边界 |
|---|---|---|
| 隔离编译、mock 测试、文档和只读审查 | 是，按任务范围 | 不覆盖 live dist/data，不交换写 |
| 读取已有 Engine health/只读接口 | 是 | 失败报告，不能恢复进程 |
| 启动隔离 test server | 仅满足 AGENTS 测试边界时 | 独立数据/端口/无交换写 |
| 替换运行产物、应用现网迁移/Settings | 否 | 需要具体范围的用户授权 |
| Engine 启动/停止/重启/热重载 | 否 | 每次特定动作需用户指令；手动启动使用指定脚本 |
| Testnet canary 发单、启用 AI 退出 | 否 | 独立明确授权及冻结隔离范围 |
| 实盘/新资本/放宽限额 | 否 | 新风险评审与用户明确指令，不能由分数推导 |

## 发布顺序

1. **S10-A 候选身份。** 固定 source/package/build/artifact/prompt/settings/schema hash；检查已知缺陷、依赖、测试、原始 R17 未完成项，不能沿用旧 PASS。
2. **S10-B 迁移演练。** 对用户授权的只读备份/合规副本 preview→apply→readback→重跑；验证 ownership、deadline、在途任务、账本、旧 UI/readers。保留原始备份和检查结果；演练不修改运行库。
3. **S10-C SHADOW。** 在明确授权环境中仅记录新计划/退出建议与实际事实差异；新 AI 写权限仍关闭。现有安全维护继续。若需要部署/启动才能观察，先准备完整产物/命令/回退，再向用户请求那一次具体动作。
4. **S10-D Canary 预注册。** 环境必须 Testnet，锁定账户/白名单/数量和资金风险/并发/有效期/人工响应；先证明非 canary entry 无法获新授权。TP 与已授权现有保护不被白名单误停。
5. 授权后验证正向链：plan→reservation→submit→fill→AI 有效期复核→合规退出→费用账→记忆；另验证到期/小亏/深亏/人工操作/未知单拒绝链。危险跳空/清算/乱序场景用隔离故障注入，不能人为制造真实亏损来满足测试数量。
6. **S10-E 完整 soak。** 固定本次起点/时区、build/instance/settings 身份和 24h 窗口；记录覆盖率与最大采样空洞。Primary/存储/WS/订单/TP/owner/风险/账本/token 指标齐全，有实际探针源。
7. 计数器按实例分段，写闸按照因果时序，窗口峰值与小时率各用正确口径。报告结束早于窗口则 PENDING_WINDOW_INCOMPLETE；探针失效/身份漂移则不签完整 PASS。
8. **S10-F 复审。** 单独输出工程、经济、运行、授权四个结论，更新证据评分表及残余风险。结果不够只收集下一步证据，不自动加仓、放宽 cap 或重启来修复验收。

## 必须覆盖的验收用例

| ID | 场景 | 预期证据 |
|---|---|---|
| S10-T01 | 真实放行至成交/合法退出 | 全链 ID、版本、适配器响应和最终账本 |
| S10-T02 | 人工接管/到期/旧 owner 指令 | 新 AI 写为零；确定性保护与账户监控持续 |
| S10-T03 | 小亏/深亏权限分界 | 对应估值/证据/拒绝原因；可用隔离注入证明危险边界 |
| S10-T04 | 重复通知/UNKNOWN 订单/模型失败 | 无重复单、无隐藏费用、无自动 Engine 恢复 |
| S10-T05 | 24h 未满/身份变更/采样缺失 | PENDING/INVALID_WINDOW，不伪造 PASS |
| S10-T06 | TP 缺失/真实 P0/P1/账本重大冲突 | 停止新增风险授权的运行机制与告警，报告人工；不擅自停重启 Engine |
| S10-T07 | 旧版本尝试读取新任务 | 检出不兼容，禁止回退旧写入器造成重复交易 |

主动终止 canary 的行为只允许在预先授权的 canary 方案里定义；若没有则报告并使用现有自动风险门，不能把“停止试验”解释为获准 kill Engine 或强制平仓。所有通知按用户授权范围发送。

## 回退与实盘条件

回退默认先关闭新增 AI 策略授权（须属于预授权方案）、维护已有保护与 journal 对账；有在途新格式任务时不能直接覆盖旧产物。任何实际产物替换与 Engine 操作仍须特定用户指令。不得自动回滚数据库丢掉真实成交。

Testnet 通过只证明环境内工程运行，不证明实盘深度、资金费和盈利。实盘复审必须有完整 riskProfile、可承受资本损失/账户隔离证据、资金调拨权限、人工值守与失联处置、经济验证、事件响应及退出受限的残余风险说明。

发布输出用 HANDOFF-TEMPLATE，加 ACCEPTANCE-SCORECARD 全表和六个硬门。未获最终人工批准，最终状态只能是对应范围的“可评审/已验证”，不能写“已具备自动实盘权限”。

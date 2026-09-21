# S04：统一减仓执行与故障恢复

状态 NOT_STARTED；主实施 terra；luna 仅承担冻结接口的 mock 场景。前置 S03；后继 S07。重点 EX1–EX4，涉及 I01–I04/I07/I10/I11。这是高风险阶段，不能用 UI 端串行化代替后端正确性。

## 文件与范围

已有 services/accountExecutor.ts、manualPositionService.ts、tpGuardian.ts、executionLifecycle.ts、reconciliationService.ts；adapters/exchange/ExternalTradeAdapter.ts、adapters/binance/BinanceTransport.ts；config/settingsStore.ts、runtime/appRuntime.ts。拟新增 positionExitCoordinator.ts 与持久 exit tasks，复用真实 adapter 能力。

新 AI 路径默认 OFF。第一版只提出全剩余数量退出，不新增模型分批策略；自然部分成交必须完整处理。不要把模型接入 `EMERGENCY_CLOSE`，其人工语义与无限追单目标不适合作 AI 权限。

## PR 顺序与实现

1. **S04-A 持久任务。** 定义统一 scope claim、幂等 intent/task、版本引用、数量预留与日志。PREPARED 在发请求前落盘，SUBMITTING 不确定不能创建第二个 clientOrderId 重发。跨进程正确性用持久 claim/CAS，而非仅内存 mutex。
2. **S04-B 统一协调接缝。** TP、人工减仓/改 TP、AI 退出接入同域协调器；保护 mandate 与策略动作分开。写路径清单逐条审计，旧 retry worker 和 reconciliation 中取消/补单路径也不能绕过共享 claim。
3. **S04-C JIT 检查。** 取得域 claim 后重读真实仓位/owner/期限/成本，检查 S03 verdict；数量只能为当前可减少量，clientOrderId 唯一且绑定 cycle。任一版本变化拒绝，而非自动扩大授权重新估算后继续。
4. **S04-D TP 协调。** 制定适配器能力矩阵：能否安全修改/置换、reduce-only、双向模式、部分成交。既有 TP 未确认终止不得再发另一张全量单；取消后未成功替换须依有效 mandate 尽快恢复保护并告警。无法证明并发防增仓时拒绝 AI 退出并交接，不假装全程原子。
5. 对 EXIT 使用限价与净收益边界；IOC/GTX 等仅在适配器支持且符合语义时用。未成交/部分成交可在原期限与原预算内有界重验；禁止无界轮询追单、禁止自动降为不受价界约束的市价。
6. **S04-E 恢复。** 启动读取非终局 task→按原 clientOrderId 查询→对齐 fills/剩余 qty→确认 claim 与保护。恢复模块不自动启动 Engine，也不恢复已经失效的 AI 策略授权；已授权在途订单的事实收敛与保护维护仍需完成。
7. 状态变化发布 EXIT_TASK_UPDATED，并将结果给会计/ownership。未知网络状态记录 UNKNOWN，继续安全对账；人工接管后撤掉新 AI 写能力，但不能谎称交易所旧单绝不再成交。

## 安全与账户模式

按实现时官方 Binance 文档核对参数：One-way 与 Hedge 的 positionSide/reduceOnly 约束不同；测试双向模式不能只模拟单向。价格和数量精度、minQty/minNotional、dust、手续费资产均需覆盖。真实过滤器版本作为证据。

禁止新建直接 HTTP 下单路径、绕过 signed()/环境锁或放松 egress；不要借退出重构顺便拆分出口闸。所有可写能力使用同一审查过的适配器。

## 故障序列矩阵

| ID | 注入点 | 必须结果 |
|---|---|---|
| S04-T01 | claim 前/后两个退出请求并发 | 一次有效 claim，无双份数量 |
| S04-T02 | 请求已到交易所但 ACK 丢失 | UNKNOWN；按原 ID 查询，无第二单 |
| S04-T03 | TP 在撤销前/期间成交 | 以事实剩余量为准，不超卖、不反向开仓 |
| S04-T04 | 撤单返回超时，旧 TP 仍 WORKING | 不发冲突全量退出单 |
| S04-T05 | 部分成交后跨 -10 或到期/转人工 | 不新增越权重试；原 cycle 预算保留 |
| S04-T06 | PREPARED/SUBMITTING/WORKING 任意点崩溃重建 | 日志可恢复、clientOrderId 稳定、无重复风险写 |
| S04-T07 | WS 乱序/重复、REST 迟到旧数量 | 去重与版本水位正确，不复活关闭周期 |
| S04-T08 | 两种持仓模式、dust/数量精度/余额变化 | 合法减仓或明确拒绝，不能增加敞口 |
| S04-T09 | 新风险暂停、模型离线、出口未验证 | 各路径按既有安全边界处理；无绕闸写 |
| S04-T10 | 人工撤 TP 后恢复旧 journal | 不恢复已撤 mandate |

复用 executionLifecycle.integration、manualPositionService、tpGuardianEconomics、egressFailClosed 等现有测试；mock 必须具有独立订单簿/成交状态，不可让“请求成功”自动等于成交。

## 验收与回退

G2 要求涉及所有减仓写路径的并发/崩溃矩阵通过；保留 TP 空窗、恢复延迟、实际越界的度量，不承诺网络下绝对无空窗。失败意味着 AI 退出不可启用，即使单元测试全绿。

回退先撤销新 AI 授权、保留 task 和 read-only 对账；有新格式在途任务时禁止运行不识别它的旧版写入器。实际停启或产物切换需用户特定指令。

移交 S07：受限 proposeExit 接口，模型无直接执行能力；移交 S10：适配器能力矩阵、Testnet 待验证场景、完整回退条件。

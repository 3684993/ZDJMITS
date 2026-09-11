# ZDJ-MITS V3.4.1 Runtime Control & Capital-Aware Scheduler 实施报告

日期：2026-08-25  
项目：`D:\MITS`  
执行范围：Google Drive `codex/zdj/` 中的 V3.4.1 实施计划与执行提示词。

## 结论

V3.4.1 已完成代码实施、测试、生产构建、两次重启、浏览器验收及 20 分钟 Binance Testnet smoke。最终服务保持：

- Engine：V3.4.1，PID 6672，`READY`
- Market Stream：`LIVE`，78 个快照；recovery queue 是既有 stale snapshot 恢复机制的短暂队列，采样期间在 0–4 间波动，lastError 始终为 `null`，恢复事件持续成功
- Private Account：`READY`，来源 `BINANCE_TESTNET_ACCOUNT`
- Database：SQLite integrity `true`
- Reconciliation：`READY`，lastError `null`
- TP Guardian：`READY`

当前真实账户的 USDT 可用余额为 0、USDC 可用余额约 2816，当前候选中没有通过同 Underlying 的可执行 USDC 合约准入，因此系统最终处于 `PAUSED_NO_EXECUTABLE_CONTRACT`。这是预期的 fail-closed 结果，不是把 USDC 总余额错误当成可立即建仓资金。

## 已实施

1. 新增 Runtime Mode：`RUNNING`、`PAUSED_MANUAL`、`PAUSED_NO_CAPITAL`、`PAUSED_NO_EXECUTABLE_CONTRACT`、`DEGRADED`。
2. 新建仓流水线增加 Capital Admission pre-gate：Pool → Underlying/Contract Router → Capital Admission → Scout → Primary → AllocationPlan → Entry Intent。
3. USDT=0、USDC>0 时优先检查同 Underlying 的 USDC 合约，并校验行情/订单簿新鲜度、数据完整性、最低保证金、组合暴露和方向/位置策略。
4. 只有准入通过的候选才能进入 AI；暂停期间不再调用 Scout/Primary，不再产生新的 Entry Intent。
5. 暂停期间仍继续行情、私有 WebSocket、账户同步、对账、持仓同步、TP Guardian、TradeRecord、订单审计和人工持仓控制台。
6. 增加手动暂停/恢复 API：
   - `GET /api/v3/runtime/trading-control`
   - `POST /api/v3/runtime/trading-control/pause`
   - `POST /api/v3/runtime/trading-control/resume`
7. 增加运行控制设置：自动暂停、自动恢复、最低可执行候选数、资金检查间隔。
8. Dashboard 显示运行模式、暂停原因、USDT/USDC 可用资金、可执行候选数、实际路由、下次检查时间；AI 页面显示 `PAUSED`。
9. Runtime state 持久化运行模式、暂停来源、恢复策略、准入摘要和审计状态。
10. 新增审计事件：`TRADING_PIPELINE_PAUSED_MANUAL`、`TRADING_PIPELINE_RESUMED_MANUAL`、`TRADING_PIPELINE_PAUSED_NO_CONTRACT` 等。

## 测试与构建

- Core：22 tests passed
- Engine：42 tests passed
- Dashboard：5 tests passed
- 全量 `npm run verify`：typecheck、test、build 均通过
- 生产 Dashboard 构建：Vite 1625 modules transformed，构建成功

新增重点测试覆盖：

- USDT=0、USDC>0 且有合格 USDC 合约时路由继续
- USDT/USDC 均无可用资金时自动暂停
- USDC 有余额但没有同 Underlying 合约时给出 `NO_USDC_CONTRACT`
- 手动暂停/恢复
- 自动暂停后资金/合约恢复自动恢复
- 手动暂停不因资金恢复自动恢复

## 真实运行与浏览器验收

Dashboard 验收确认：

- 页头显示 `ZDJ-MITS V3.4.1 RUNTIME CONTROL`
- 驾驶舱显示 `PAUSED_NO_EXECUTABLE_CONTRACT`
- USDT 可用 `$0.00`，USDC 可用约 `$2.8k`
- Scout 与 Primary 显示 `PAUSED`
- 私有数据、对账、止盈显示 `READY`
- 设置页显示四个 Runtime Control 配置项

API 手动控制验收：

- 自动暂停 → `POST pause`：`PAUSED_MANUAL`
- `POST resume`：`RUNNING`
- 下一次资本复核后因仍无可执行合约自动回到 `PAUSED_NO_EXECUTABLE_CONTRACT`
- 全过程无新 Entry submit/fill

## Testnet 20 分钟 smoke

采样窗口约 20:10–20:30（Asia/Shanghai），每 30 秒检查一次健康、行情流、私有账户、运行模式、AI 状态、提交/成交、对账和 TP：

- 每次健康检查均为 `READY`
- Market Stream 全程 `LIVE`
- Private Account 全程 `READY`
- 快照稳定为 78
- Runtime Mode 全程稳定为 `PAUSED_NO_EXECUTABLE_CONTRACT`
- Scout/Primary 全程 `PAUSED`
- 建仓 submit/fill 全程 `0/0`
- Reconciliation 与 TP Guardian 全程 `READY`
- recovery queue 为有界的短暂恢复队列，采样期间可排空并在新的 stale snapshot 出现时重新入队；未出现 `MARKET_RECOVERY_FAILED`，lastError 始终为 null，服务保持 READY

## 当前业务解释

USDC 余额存在，但当前交易池中的候选主要为 USDT 合约；可见的同 Underlying USDC 合约要么不在当前候选/市场快照范围内，要么受已有 Underlying 暴露与合约准入规则阻断。系统因此没有把 USDC 余额误判为可执行新仓，也没有继续让 AI 消耗资源或制造无效 Entry。

V3.4.0 Portfolio Intelligence 的已有持仓暴露、方向策略、动态 Allocation 和 TP 逻辑未被重构；V3.4.1 只在新建仓链路前增加运行控制和资金/合约准入门。

## 主要代码文件

- `packages/contracts/src/runtimeControl.ts`
- `packages/core/src/capitalAdmission.ts`
- `apps/engine/src/services/runtimeControlService.ts`
- `apps/engine/src/services/entryCoordinator.ts`
- `apps/engine/src/runtime/appRuntime.ts`
- `apps/engine/src/api/router.ts`
- `apps/engine/src/api/projections.ts`
- `apps/dashboard/src/views/OverviewView.vue`
- `apps/dashboard/src/views/SettingsView.vue`
- `apps/dashboard/src/api/client.ts`

## 局域网访问补充修复

在最终重启前，将 `apps/engine/src/main.ts` 的默认监听从 `127.0.0.1` 改为 `0.0.0.0`，等价于：

```ts
app.listen(8080, '0.0.0.0')
```

实际验证：

- TCP 监听：`0.0.0.0:8080`
- 本机局域网地址：`192.168.1.50`
- `http://192.168.1.50:8080/health` 返回 HTTP 200、`READY`
- 重启后 Engine PID 23952，V3.4.1 正常运行

如果其他局域网设备仍无法访问，剩余限制将属于 Windows 防火墙入站规则或网络隔离，而不是应用监听地址。

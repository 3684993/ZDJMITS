# ZDJ-MITS V3.3.1
## 持仓详情、浮动盈亏与人工交易控制台优化实施计划

> 项目目录：`D:\MITS`
> 基线：ZDJ-MITS V3.3.0 FINAL
> 本轮定位：小版本增强，不重构已经通过验收的 Market / Pool / AI 自动交易基础架构。
> 目标：修复持仓主表浮动盈亏显示，并恢复/增强“持仓详情 + 当前币种图表 + 右侧人工管理操作”。

---

# 一、本轮两个核心问题

## 1. 持仓主表

将字段：

`当前 PnL`

改名为：

`浮动盈亏`

显示规则：

- PnL > 0：绿色；
- PnL < 0：红色；
- PnL = 0：中性色；
- 金额和 ROE 同一颜色语义；
- 必须使用现有主题 semantic token，不写死颜色。

示例：

```text
+$12.45 / +6.22% → 绿色
-$39.28 / -19.64% → 红色
$0.00 / 0.00% → 中性
```

同时核对：

- unrealizedPnl 必须来自当前 Binance / Position projection；
- ROE 使用当前项目统一口径；
- 禁止 UI 自己重新计算另一套结果；
- 如果 ROE 存在异常极值，必须核对 margin / leverage / notional 计算口径，不得只改颜色掩盖问题。

---

# 二、持仓详情改为“专业持仓控制台”

当前详情功能不足。

最终桌面布局建议：

```text
┌──────────────────────────────────────────────────────────────┐
│ Symbol / Direction / 浮动盈亏 / TP / 管理状态               │
├───────────────────────────────────────┬──────────────────────┤
│                                       │                      │
│       左侧：价格与趋势图表              │  右侧：人工管理面板    │
│           65~72%                      │      28~35%          │
│                                       │                      │
├───────────────────────────────────────┴──────────────────────┤
│ 持仓事实 / TP / 活动订单 / 交易记录 / AI参考 / 审计          │
└──────────────────────────────────────────────────────────────┘
```

移动端：

- 图表在上；
- 操作面板在下；
- 不强行双栏。

顶部摘要至少显示：

- Symbol；
- LONG / SHORT；
- 浮动盈亏；
- ROE；
- Entry；
- Mark；
- Leverage；
- Qty；
- TP 状态；
- AUTO_MANAGED / HUMAN_MANAGED；
- 建仓/首次同步时间。

---

# 三、恢复当前币种价格图表

## 周期

至少：

- 1m
- 5m
- 15m
- 4h

默认：

`15m`

## 图表

优先：

- K线；
- Volume；
- EMA；
- Bollinger Bands。

可附加：

- MACD；
- 支撑/阻力。

至少绘制参考线：

- Entry price；
- Current Mark；
- TP price。

如果有当前人工活动委托，可显示其 price marker。

## 数据来源

必须复用：

- Market Data Hub；
- Kline Store；
- EIP technical。

禁止前端直连 Binance。

前端只访问 Engine 同源 API / WS。

切换周期不得创建额外失控的 Binance WebSocket。

---

# 四、右侧“人工管理”操作面板

必须提供：

1. 减仓
2. 补仓
3. 紧急平仓
4. 挂单委托
5. 修改 / 重建 TP

右侧建议 sticky，便于边看图边操作。

---

# 五、减仓

默认：

`Reduce-Only Limit / Maker`

用户可输入：

- Qty；
或
- 25% / 50% / 75% / 100%；
- Limit Price；
- 使用当前 Maker 价。

Maker Auto Price 必须由服务端根据：

- bid / ask；
- tick size；
- side；
- PostOnly；

生成。

服务端必须检查：

- qty > 0；
- qty <= 当前 position qty；
- precision；
- min qty；
- reduceOnly；
- position side；
- position 仍真实存在；
- 不会反向开仓。

---

# 六、补仓

定义：

对当前已有 Position 做**人工同方向增仓**。

例如：

- LONG Position → BUY 增仓；
- SHORT Position → SELL 增仓。

边界：

- 不经过 AI；
- 不影响自动选币主逻辑；
- 同 symbol 继续因为已有 Position 而排除 AI 新建仓；
- 只能由用户主动发起。

输入：

- Qty 或名义金额；
- Limit Price；
- Maker Auto Price。

服务端校验：

- available margin；
- leverage；
- precision；
- min notional；
- side；
- Maker/PostOnly；
- environment；
- duplicate manual intent。

补仓成交后必须：

```text
Manual Add Fill
→ Reconciliation
→ Position Qty Changed
→ TP Guardian
→ Cancel/Replace/Repair TP
→ TP coverage=100%
```

禁止 TP 仍只覆盖旧 Qty。

---

# 七、紧急平仓

这是**人工紧急操作**，不是自动止损。

右侧单独危险区域：

`紧急平仓`

建议提供：

### A. 快速限价平仓
优先：

`Reduce-Only aggressive limit`

### B. 市价紧急平仓
只有现有 Binance Adapter 已安全支持时才允许：

`Reduce-Only Market`

市价紧急平仓必须二次确认。

确认窗口显示：

- Symbol；
- Direction；
- Qty；
- Mark；
- 当前浮动盈亏；
- 当前 TP；
- 明确提示“人工紧急操作”。

禁止：

- AI 调用；
- Scheduler 调用；
- 亏损阈值自动调用；
- TP Guardian 自动调用；
- 将该能力演变成自动 stop-loss。

完成链路：

```text
Manual Emergency Close
→ AccountExecutor
→ Binance
→ Reconciliation
→ Position=0
→ 残余TP取消
→ TradeRecord更新
→ Audit
```

---

# 八、挂单委托

右侧增加：

`挂单委托`

至少支持：

- 同方向补仓 Limit；
- Reduce-Only 减仓 Limit；
- TP Replace；
- 当前 symbol 人工 Maker Limit。

输入：

- Side；
- Qty；
- Price；
- ReduceOnly；
- PostOnly；
- Time In Force。

默认：

- LIMIT；
- PostOnly / Maker。

所有人工写必须：

```text
Dashboard
→ ManualIntent
→ Permission / Validation
→ AccountExecutor
→ Binance Adapter
```

禁止浏览器直接接触 Binance key。

---

# 九、人工操作与自动系统互锁

## Manual Add

- 同 symbol 继续视为已有 Position；
- AI 不再分析建仓；
- 成交后 TP 重新覆盖。

## Manual Reduce

- Position qty 更新；
- TP qty 同步；
- 不得存在 TP qty > 剩余 Position。

## Emergency Close

- 标记 `manual close in progress`；
- 期间禁止 TP Guardian 并发创建新 TP；
- Position=0 后取消残余 TP；
- symbol 此后才重新具备候选资格。

## Manual Limit Pending

必须同步显示在：

`订单 → 活动订单`

不能只在详情页存在。

---

# 十、管理状态

`AUTO_MANAGED / HUMAN_MANAGED`

两种状态都允许人工：

- 查看图表；
- 修改 TP；
- 减仓；
- 补仓；
- 紧急平仓；
- 挂单委托。

区别仍保持：

- AUTO_MANAGED：允许现有自动 TP 守护；
- HUMAN_MANAGED：系统不做主动退出决策，但继续同步 Position / TP。

---

# 十一、详情下半部分

建议 Tabs：

1. 持仓事实
2. TP
3. 活动订单
4. 交易记录
5. AI / EIP 参考
6. 审计

### 持仓事实
完整原始字段。

### TP
当前 TP、coverage、replace history。

### 活动订单
当前 symbol 的人工/自动活动订单。

### 交易记录
当前 symbol 的 TradeRecord。

### AI / EIP 参考
只读：
- 最近方向；
- 最近 Primary Decision；
- 15m evidence。

已有 Position 不重新触发 AI 分析。

### 审计
人工和系统操作时间线。

---

# 十二、优先调查前几个版本已有实现

用户明确说明旧版本曾具备：

- 持仓图表；
- 人工管理。

Codex 开始前必须检查：

- Git history；
- 旧 Position 组件；
- 未引用组件；
- 旧 chart；
- 旧 manual intent；
- 旧 Position API。

如果旧实现与 V3.3.0 兼容：

优先复用/迁移。

但禁止恢复任何：

- 前端直连 Binance；
- 绕过 AccountExecutor；
- 绕过 audit；
- 绕过 Testnet/Production gate；

的旧路径。

---

# 十三、后端能力

Codex 按实际代码决定 endpoint 名称，但需要具备等价能力：

- Position Detail；
- symbol Kline；
- Manual Position Action；
- symbol Active Orders。

Manual Action 至少覆盖：

```text
REDUCE_LIMIT
ADD_LIMIT
EMERGENCY_CLOSE_LIMIT
EMERGENCY_CLOSE_MARKET
PLACE_LIMIT
REPLACE_TP
```

所有写操作必须：

- server validation；
- idempotency；
- audit；
- environment gate；
- AccountExecutor。

---

# 十四、审计事件

新增或复用统一事件：

```text
MANUAL_POSITION_INTENT_CREATED
MANUAL_REDUCE_SUBMITTED
MANUAL_ADD_SUBMITTED
MANUAL_LIMIT_SUBMITTED
MANUAL_EMERGENCY_CLOSE_REQUESTED
MANUAL_EMERGENCY_CLOSE_SUBMITTED
MANUAL_ORDER_CANCELED
MANUAL_POSITION_ACTION_FAILED
```

至少记录：

- actor=HUMAN；
- symbol；
- action；
- requested/final qty；
- requested/final price；
- reduceOnly；
- postOnly；
- exchangeOrderId；
- result/error；
- timestamp。

禁止 Secret 进入审计。

---

# 十五、前端交互

- 图表和详情独立 loading；
- 单模块错误局部显示；
- 提交时按钮 disabled；
- 防止双击；
- 成功显示 Intent ID / Order ID / Status；
- 失败展示人类可读 validation / Binance 原因；
- 禁止只显示 `500 Internal Server Error`。

---

# 十六、主题

新增：

- chart；
- management panel；
- danger zone；
- form；
- modal；
- tabs；

全部使用现有 10 套主题 semantic token。

PnL 必须使用现有 success/danger/profit/loss 语义 token。

---

# 十七、测试

## Unit

覆盖：

- PnL positive / negative class；
- Reduce qty validation；
- Add qty validation；
- Manual side；
- ReduceOnly；
- Emergency Close only human；
- Duplicate submit；
- Position disappeared before submit；
- TP repair after add；
- TP repair after reduce；
- Close → orphan TP cleanup。

## Integration

### Manual Reduce

```text
Position
→ Reduce Intent
→ Executor
→ Exchange
→ Reconciliation
→ Position qty decreases
→ TP qty matches
```

### Manual Add

```text
Position
→ Add Intent
→ Fill
→ Position qty increases
→ TP repaired
```

### Emergency Close

```text
Position
→ Human confirmation
→ Emergency Close
→ Position=0
→ TP removed
→ TradeRecord updated
```

## UI

- 浮动盈亏红绿；
- 详情；
- chart render；
- timeframe switch；
- 右侧管理面板；
- forms；
- confirmation；
- success/failure；
- responsive layout。

---

# 十八、浏览器真实验收

必须实际验证：

1. 持仓页字段已变成“浮动盈亏”；
2. 负值红色；
3. 如果自然存在正值则验证绿色；没有时使用组件测试验证，禁止伪造生产数据；
4. 点击详情；
5. 图表加载；
6. 1m/5m/15m/4h 切换；
7. Entry/Mark/TP 标线；
8. 右侧人工管理；
9. 减仓表单；
10. 补仓表单；
11. 挂单委托；
12. 紧急平仓二次确认；
13. 当前 symbol 活动订单；
14. Theme；
15. 响应式。

写操作不要误操作现有大仓位。

优先：

- Integration Test；
- Testnet 可控小仓位；
- fixture；

验证写链。

---

# 十九、回归保护

本轮不允许破坏 V3.3.0 已验收：

- Market LIVE；
- Pool；
- AI；
- Entry；
- TP；
- TradeRecord；
- Memory；
- Orders；
- Settings；
- Theme；
- 8080 Engine。

完成后必须：

```text
npm run typecheck
npm run test
npm run build
```

然后 restart。

健康确认：

- `/health=READY`
- Market LIVE
- Binance Private READY
- TP Guardian 正常

如果没有修改 Scheduler / Market / AI 自动链：

无需重新做完整 60 分钟 AI 验收。

执行：

- 15~30 分钟 Testnet smoke；
- Manual Position Action 专项验收；
- TP / Reconciliation 联动验收。

---

# 二十、退出条件

以下全部完成才允许结束：

- 当前 PnL → 浮动盈亏；
- 正绿负红；
- Position Detail 完成；
- 图表完成；
- 1m/5m/15m/4h；
- Entry/Mark/TP 标线；
- 右侧人工管理；
- 减仓；
- 补仓；
- 紧急平仓；
- 挂单委托；
- ManualIntent；
- AccountExecutor；
- Audit；
- TP 联动；
- TradeRecord 联动；
- Orders 联动；
- typecheck PASS；
- tests PASS；
- build PASS；
- browser PASS；
- Testnet smoke PASS；
- 普通 TODO/PARTIAL/PENDING=0。

完成一项后继续下一项，禁止 checkpoint 提前停止。

---

# 二十一、版本

完成后：

# ZDJ-MITS V3.3.1
## Position Console / 人工持仓控制台增强版

基础 AI / Market / Pool 架构继续冻结。

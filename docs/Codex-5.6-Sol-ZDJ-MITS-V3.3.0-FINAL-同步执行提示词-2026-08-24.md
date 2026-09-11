# Codex 5.6 Sol — ZDJ-MITS V3.3.0 FINAL 执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

这是 **V3.3.0 最后一轮全量修复、交易记录/交易记忆闭环和前端产品化实施**。  
不要拆阶段，不要等待其它问题先解决，不要完成一个子任务后 checkpoint 退出。

先读取并执行：

- `ZDJ-MITS-V3.2.0-当前系统诊断报告-2026-08-24.md`
- `ZDJ-MITS-V3.3.0-正式运行稳定与产品化升级实施计划-2026-08-24.md`
- `ZDJ-MITS-V3.3.0-交易记录-交易记忆-前端产品化-一次性全量实施计划.md`

先基于当前真实代码、SQLite、最近至少 3 小时 AI audit、Binance Testnet 当前持仓/活动委托、本地交易事实和浏览器实际页面独立调查。  
对计划逐项判断：

`ALREADY_IMPLEMENTED / NEEDS_FIX / NEEDS_HARDENING / REJECT`

不要机械照改；发现计划以外的普通生产缺陷，本轮一并解决。

---

## 一、当前最高优先级：长期 100% REJECT

当前真实事实已经证明：

- Market / Pool / Private / Entry Permission 正常；
- Primary 长时间真实运行；
- 但大量独立候选最终都是 `REJECT_CANDIDATE`；
- 后续长期无 PLACE / Entry Intent。

必须从真实 Raw Input / Raw Output 调查：

- 1m/5m 短时冲突；
- 等待回调；
- BB 位置；
- volume；
- orderbook；
- 高周期；
- BTC/ETH regime；
- reachable range；

是否被 Prompt 组合成事实上的“全拒绝器”。

必须保持安全边界：

- `AI_FAILED` → fail-closed；
- Raw REJECT → Normalized REJECT；
- 禁止 fallback 自动下单；
- 15m 继续决定 LONG / SHORT；
- 1m/5m 主要决定 timing / price；
- 4h/1d/1w 只是背景权重。

如果只是：

- 当前价不理想；
- 等待回调；
- 1m/5m 暂时反向；
- BB 接近边缘；
- orderbook 有短时压力；

但仍存在未来 1–5 分钟可达 Maker 区间，则应优先通过：

- idealPrice
- acceptablePriceRange
- confidence
- horizon

表达，而不是机械 REJECT。

禁止强制每次 PLACE。

---

## 二、调度必须持续工作，但不能扎堆

调查当前固定 45 秒 cadence。

目标：

- Scout concurrency=1；
- Primary concurrency=1；
- Primary 永不重叠；
- Scout 可以在 Primary 分析当前候选时，最多预处理下一个候选；
- ready-for-primary buffer 最大 1；
- 有候选且资源空闲时持续流水；
- 禁止长时间 idle 后突然批量分析；
- 禁止 Primary backlog；
- candidate cooldown 继续有效。

驾驶舱增加：

- 距离上次 Primary；
- 距离上次 PLACE；
- 距离上次 Entry Intent；
- 距离上次 Submit；
- 最近 30m Primary；
- 最近 30m unique symbols；
- 最近 30m PLACE / REJECT；
- consecutiveRejects。

当 Market / Pool / AI / Entry Permission 全 READY，却长期无建仓活动时：

显示：

`建仓停滞`

并给出真实原因。

报警不能强制交易。

---

## 三、TP Guardian 双向一致性

不能只验证：

`Position → TP`

还必须验证：

`TP → Position`

当前所有真实 WORKING TP 必须审计：

- orphan TP；
- duplicate TP；
- qty mismatch；
- wrong side；
- invalid reduce-only / close-position semantics。

最终必须达到：

```text
TP_MISSING = 0
ORPHAN_TP = 0
DUPLICATE_TP = 0
QTY_MISMATCH = 0
```

Position=0 的 TP：

→ 自动取消  
→ 保留历史审计

同一 Position 默认只有一套有效 TP coverage，除非未来显式实现多级止盈。

---

## 四、建立真正的 TradeRecord / TradeCycle

新增本地完整交易生命周期：

```text
Entry First Fill
→ Position
→ TP / Manual Close
→ Position Qty = 0
→ TradeRecord CLOSED
```

至少保存：

- tradeId
- symbol
- direction
- openedAt
- closedAt
- duration
- entryQty
- entryAveragePrice
- exitAveragePrice
- entryFee
- exitFee
- totalFee
- grossRealizedPnl
- netPnl
- closeReason
- status
- entryRunId
- entryIntentId
- entryOrderIds
- exitOrderIds
- source
- completeness

净收益：

```text
netPnl = grossRealizedPnl - entryFee - exitFee
```

Funding 单独字段，不默认混入。

---

## 五、本地历史原则

系统启动：

禁止自动导入 Binance 过去一个月历史成交来填交易记录或交易记忆。

允许：

- 从当前 SQLite 中本系统自己的 order/fill/audit/position lifecycle 重建历史；
- 启动前已有 Position 创建 `IMPORTED_OPEN_POSITION`；
- `firstObservedAt = 系统首次真实同步时间`。

UNKNOWN entry time：

禁止出现几十万小时。

显示：

`首次同步时间`

或：

`未知`

Imported Position 后续关闭，如果费用/entry事实不完整：

- `recordCompleteness=PARTIAL`
- `feeCompleteness=PARTIAL`

默认不纳入高可信策略净收益和 Experience。

---

## 六、新增独立“交易记录”菜单

最终导航：

1. 驾驶舱
2. 智能选币
3. 市场智能
4. AI 大脑
5. 持仓
6. 订单
7. **交易记录**
8. 交易记忆
9. 运行中心
10. 系统设置

### 交易记录顶部

横向卡：

- 累计净收益
- 盈利交易收入
- 亏损交易支出
- 当前浮动盈亏
- 已完成记录数

### 表格

- 建仓时间
- 平仓时间
- Symbol
- 方向
- Entry
- Exit
- 数量
- 建仓手续费
- 平仓手续费
- 毛收益
- 净收益
- 持仓时长
- 平仓方式
- 状态
- 操作

支持：

- 服务端分页
- 默认 20 条
- 时间筛选
- Symbol
- LONG/SHORT
- 盈利/亏损
- TP/MANUAL
- COMPLETE/PARTIAL
- 搜索/重置

点击进入详情：

- Summary
- Entry
- Exit
- Fees/PnL
- AI Run / Intent / Orders
- Regime / Memory
- Raw Audit

---

## 七、驾驶舱收益与活动委托

删除：

`24h 已实现收益`

改为：

`交易记录净收益`

来源只允许：

`本地完整 CLOSED TradeRecord.netPnl`

副标题：

`本地完整交易记录累计`

驾驶舱 5 个 KPI 保持横向：

- 总资产估值
- 浮动盈亏
- 当前持仓
- 交易记录净收益
- 当前活动委托

“当前活动委托”必须统计：

`Entry + TP`

例如：

`建仓 0 · 止盈 15`

禁止实际有 TP 但显示 0。

---

## 八、订单页面只保留活动委托

页面改为 Tabs：

### 建仓委托
显示：

- 创建时间
- Symbol
- Direction
- Qty
- Maker Price
- Filled
- Age
- TTL
- 是否超时
- 状态
- 操作

### 止盈委托
显示：

- 创建时间
- Symbol
- Position
- Side
- Qty
- TP Price
- Age
- Coverage
- 操作

以下终态：

- CANCELED
- EXPIRED
- REJECTED
- FILLED

全部退出活动 UI。

但历史保留在：

- SQLite
- Audit
- TradeRecord

删除订单页现有大型 Entry History 日常表格，不再把订单流水和交易记录混在一起。

---

## 九、交易记忆必须从 TradeRecord 自动生成

建立：

```text
TradeRecord CLOSED
→ Experience Builder
→ Experience Sample
```

至少统计：

- 已完成样本
- 盈利样本
- 亏损样本
- 胜率
- 平均净收益
- 平均持仓时长
- 平均成交等待
- LONG 胜率
- SHORT 胜率

Experience Sample 至少：

- tradeId
- symbol
- direction
- regime
- netPnl
- winLoss
- fillDelay
- holdingDuration
- lesson
- mistakeTags
- successTags

Experience 进入 EIP 只提供结构化摘要。

禁止为了填 Memory 拉交易所外部历史。

---

## 十、持仓页面产品化

主表只保留：

- 建仓 / 首次同步时间
- Symbol
- Direction
- TP 状态
- 操作

正收益：

绿色视觉。

负收益：

红色视觉。

点击进入 Position Detail：

### Position
- Qty
- Entry
- Mark
- Leverage
- Unrealized PnL
- ROE

### 时间
- entryAt
- firstObservedAt
- source
- duration

### 趋势
- 1m
- 5m
- 15m
- 4h

### TP
- status
- orderId
- price
- qty
- age
- coverage
- replace/rebuild

### 管理
- AUTO_MANAGED
- HUMAN_MANAGED

### 人工操作
- 修改 TP
- 重建 TP
- Cancel/Replace TP
- reduce-only limit close
- maker close

默认禁止 Market close。

所有人工操作仍走：

`Dashboard → server-side intent → AccountExecutor → Binance`

---

## 十一、市场智能页面必须完成

当前不能再出现：

- 多周期表空白
- Portfolio JSON
- Experience JSON
- Reachable band 无内容
- Contradictions 英文
- OI/Funding/Taker/LongShort 模糊“—”

必须展示：

### 候选概况
- Symbol
- Rank
- Score
- Pool Status
- Freshness
- Selection Reason

### 价格与盘口
- Last
- Mark
- Bid
- Ask
- Spread
- Imbalance
- Microprice
- Reachable Range

### 多周期
- 1m
- 5m
- 15m
- 4h
- 1d
- 1w

字段：

- Trend
- EMA
- MACD
- Bollinger
- ATR
- Swing
- Support/Resistance

视觉突出：

`15m 主方向`

### Portfolio
JSON 改中文卡片。

### Experience
JSON 改中文卡片。

### Derivatives
先调查是否已有：

- OI
- Funding
- Taker
- Long/Short
- Top Trader

如果可可靠获取：

统一缓存/限流接入。

如果未接入：

明确显示：

`未接入`

禁止伪造。

---

## 十二、AI 大脑 Run Detail 真正可点击

必须浏览器实际验证：

`Row Click → Run Detail`

详情至少：

- Summary
- Candidate
- EIP
- Scout Input
- Scout Raw Output
- Scout Normalized
- Primary Input
- Primary Raw Output
- Normalized Direction/Decision
- Price Range
- Reason
- Timing
- Errors
- Raw Audit

最关键：

用户必须能明确看到：

```text
系统给 9B 什么
→ 9B 返回什么
→ 系统给 27B 什么
→ 27B 原始返回什么
→ 系统最后采用什么
```

正常等待候选不能显示 `DEGRADED`。

---

## 十三、运行中心全面中文化

一级只显示：

- 交易网络
- 行情中心
- 动态交易池
- AI 引擎
- 交易所对账
- 止盈保护
- 数据与审计

状态映射：

- HEALTHY → 正常
- READY → 就绪
- RUNNING → 运行中
- DEGRADED → 降级
- RECOVERING → 恢复中
- FAILED → 故障
- BLOCKED → 已阻断

主页面禁止大段 JSON。

原始 Market stream、stale symbols、gaps、queue、lastError 全部进入“查看详情” Drawer。

---

## 十四、Settings 改成 Tabs + Resource Manager

一级 Tabs：

1. 策略与执行
2. 交易所
3. 网络代理
4. AI 模型资源
5. 外观主题

不再使用：

`一区 / 二区 / 三区`

### 交易所
支持：
- 新增
- 编辑
- 删除
- 测试
- 启用/禁用
- 设置默认

模板：
- Binance USD-M
- Binance USDC-M
- OKX
- Coinbase

没有 Adapter：

显示：

`适配器未实现`

且禁止启用。

### 代理
支持：
- 新增
- 删除
- 编辑
- 测试
- 启用/禁用

### AI 模型资源
支持：
- 新增
- 删除
- 编辑
- 测试
- 启用/禁用

字段：
- Resource ID
- Role
- Base URL
- Model
- Max Concurrency
- Timeout
- Health Path
- GPU Label
- Priority
- Status

角色模板：
- SCOUT
- PRIMARY_BRAIN
- REVIEW_BRAIN

不假定 GPU 数量。

---

## 十五、主题

继续一个下拉列表。

10 套主题继续保留。

主题说明放下拉框下方，禁止挤成一行。

Sidebar 当前菜单高亮背景不能继续固定蓝色。

必须使用：

```css
--nav-active-bg
--nav-active-text
--accent
--accent-soft
```

切换主题后左侧选中菜单必须立即变化。

---

## 十六、统一分页、格式化、状态语义

统一用于：

- AI Run
- TradeRecord
- Experience
- Orders
- Audit

默认：
- 20 条/页
- 20/50/100
- 页码
- 上一页/下一页
- 总数
- 搜索
- 筛选
- 重置

金额：

`$4,884.24`

禁止长小数。

时间：

`YYYY/MM/DD HH:mm:ss`

Duration：

- 12m
- 2h 34m
- 1d 4h

UNKNOWN：

`未知`

---

## 十七、数据库迁移与测试

新增/升级至少：

- trade_records
- experience_samples
- exchange_resources
- proxy_resources
- ai_resources

要求：

- versioned migration
- transaction
- restart safe
- backward compatible
- 不破坏当前 AI Runs / Orders / Settings / Position

必须新增测试：

### TradeRecord
- close
- partial close
- fee
- netPnl
- imported position
- incomplete record

### Experience
- CLOSED TradeRecord → Experience

### Orders
- terminal not active
- TP activity count

### Position
- unknown duration
- firstObservedAt

### Settings
- exchange CRUD
- proxy CRUD
- AI CRUD
- unsupported adapter cannot enable
- theme nav active

### 完整链
`Entry Fill → Position → TP Fill → CLOSED TradeRecord → Experience → Dashboard Net Profit`

---

## 十八、浏览器逐页验收

必须实际点击验证：

1. 驾驶舱
2. 智能选币
3. 市场智能
4. AI 大脑 + Run Detail
5. 持仓 + Position Detail
6. 订单两个 Tabs
7. 交易记录 + Detail
8. 交易记忆
9. 运行中心 + Details
10. Settings 5 Tabs + CRUD + Theme

禁止只通过 API 200 / typecheck 就宣称前端完成。

---

## 十九、最终执行

全部实现后：

```text
npm run typecheck
npm run test
npm run build
```

全部通过。

重启 Engine。

然后：

- 浏览器逐页验收；
- 至少 60 分钟 Testnet 自动验收；
- 对比本地 03:00–10:00 与修复后：
  - Primary/hour
  - unique symbols
  - PLACE rate
  - Intent/hour
  - submit/hour
  - fill/hour
  - TP/hour
  - reject rate
  - AI idle/burst

---

## 二十、严格退出条件

执行循环：

`调查 → 修改 → 定向测试 → 更新 progress → 搜索剩余 TODO/PARTIAL/PENDING → 继续`

禁止：

`完成一个子任务 → checkpoint → 停止`

本轮不等待其它问题先完成。

只有以下全部完成才允许最终回复：

- 100% REJECT 根因已真实修复或有明确运行证据；
- TP orphan/duplicate/mismatch 已清零；
- TradeRecord 可用；
- TradeRecord → Experience 成立；
- 驾驶舱收益切换完成；
- Orders / TradeRecord 分离；
- Position 产品化；
- Market Intelligence 完整人类化；
- AI Run 点击审计可用；
- Runtime 中文化；
- Settings Tabs；
- Exchange/Proxy/AI CRUD；
- Theme Sidebar active 修复；
- typecheck PASS；
- tests PASS；
- build PASS；
- restart PASS；
- 浏览器逐页验收 PASS；
- 60 分钟 Testnet 验收完成；
- 普通 `TODO/PARTIAL/PENDING = 0`。

现在直接开始调查和实施，不先写新计划，不提前停止。

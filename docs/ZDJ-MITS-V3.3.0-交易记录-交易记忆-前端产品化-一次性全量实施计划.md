# ZDJ-MITS V3.3.0
## 交易记录 / 交易记忆 / 前端产品化 一次性全量实施计划

> 项目：`D:\MITS`
> 基线：当前 V3.2.0 FINAL
> 本轮目标：**不等待其它问题先解决，同时把交易记录、交易记忆、持仓/订单/市场智能/AI大脑/运行中心/设置页的产品化一次性做完。**
> 退出原则：**普通 TODO / PARTIAL / PENDING 未清零前禁止停止。**

---

# 1. 本轮范围与原则

本轮不等待 AI 全 REJECT、TP 对账等其它问题先完成；这些问题可以并行继续修。本轮必须独立完成：

1. 建立本地 `TradeRecord / TradeCycle`；
2. 将“订单”和“完整交易记录”彻底分开；
3. 驾驶舱收益改为本地交易记录净收益；
4. 交易记忆从 CLOSED TradeRecord 自动生成；
5. 持仓主表简化 + 点击详情 + 人工挂单管理；
6. 市场智能 EIP 完整人类可读化；
7. AI Run 真正可点击查看输入、原始输出、归一化结果、失败原因；
8. 运行中心全面中文化；
9. Settings 改为 Tabs + 可新增/删除资源；
10. 交易所、代理、AI模型资源改为 Resource Manager；
11. 主题继续使用下拉框，Sidebar 高亮颜色随主题改变；
12. 全局统一分页、格式化、状态语义和详情交互。

不得改变：
- 15m 主方向；
- AI 不直接下单；
- Entry Manager 决定 Maker 价格；
- 无自动止损；
- 人工接管持仓不被 AI 主动平仓；
- Testnet / Production 隔离；
- 正式链禁止 Mock fallback。

---

# 2. 最终导航结构

左侧菜单最终建议：

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

语义必须明确：

- **订单**：只看当前活动委托；
- **交易记录**：一条记录代表“建仓 → 完整平仓”；
- **交易记忆**：从完整交易记录抽象经验；
- 不再把 CANCELED/EXPIRED 订单流水和完整交易生命周期混在一个页面。

---

# 3. 建立 TradeRecord / TradeCycle

一条 TradeRecord 代表：

`Entry First Fill → Position Open → Position Management → TP/Manual Close → Position Qty=0 → CLOSED`

建议字段：

```text
tradeId
symbol
direction
openedAt
closedAt
durationMs

entryQty
entryAveragePrice
exitAveragePrice

entryFee
exitFee
totalFee

grossRealizedPnl
netPnl

closeReason
status

entryDecisionRunId
entryIntentId
entryOrderIds[]
exitOrderIds[]

entrySource
exitSource
regime
experienceTags[]

feeCompleteness
recordCompleteness

createdAt
updatedAt
```

净收益统一口径：

`netPnl = grossRealizedPnl - entryFee - exitFee`

Funding 如以后需要统计，必须单独字段，不默认混入净收益。

状态建议：

```text
OPEN
PARTIALLY_CLOSED
CLOSED
IMPORTED_OPEN_POSITION
INCOMPLETE
```

---

# 4. 本地历史原则

系统启动时：

**禁止自动拉取 Binance 过去一个月历史成交来填交易记录或交易记忆。**

允许：

- 从当前 SQLite 中本系统自己的 order/fill/audit/position lifecycle 重建 TradeRecord；
- 当前启动前已经存在的 Position 建立 `IMPORTED_OPEN_POSITION`；
- `firstObservedAt = 系统首次真实同步时间`；
- `entryTimeSource = SYSTEM_FIRST_SEEN / IMPORTED_AT_STARTUP`。

禁止：

- 把 epoch / 1970 当建仓时间；
- UNKNOWN 时间计算成 `496547h`；
- 猜测真实建仓时间。

Imported Position 后续关闭，如果 entry fee / entry fill 不完整：

```text
recordCompleteness=PARTIAL
feeCompleteness=PARTIAL
```

默认不纳入高可信收益和 Experience。

---

# 5. 新增“交易记录”页面

顶部横向统计卡：

1. 累计净收益
2. 盈利交易收入
3. 亏损交易支出
4. 当前浮动盈亏
5. 已完成记录数

其中“累计净收益”只统计：

```text
status=CLOSED
recordCompleteness=COMPLETE
```

的 `netPnl`。

交易记录表主要列：

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
- **净收益**
- 持仓时长
- 平仓方式
- 状态
- 操作

视觉：
- 正净收益绿色；
- 负净收益红色。

筛选：
- 时间范围
- Symbol
- LONG / SHORT
- 盈利 / 亏损
- TP / MANUAL
- COMPLETE / PARTIAL
- 搜索 / 重置

分页：
- 服务端分页；
- 默认 20 条；
- 20 / 50 / 100；
- 页码、上一页、下一页、总数。

点击详情显示：
- Summary
- Entry
- Exit
- PnL / Fees
- AI Run / Intent / Order IDs
- Regime / Memory
- Raw Audit

---

# 6. 驾驶舱收益字段改造

删除：

`24h 已实现收益`

改为：

# `交易记录净收益`

副标题：

`本地完整交易记录累计`

第一版默认统计全部本地完整 CLOSED TradeRecord。

驾驶舱 5 个 KPI 最终保持横向：

1. 总资产估值
2. 浮动盈亏
3. 当前持仓
4. 交易记录净收益
5. 当前活动委托

“当前活动委托”必须统计：

`Entry + TP`

副标题例如：

`建仓 0 · 止盈 15`

禁止 TP 有工作订单而驾驶舱显示挂单 0。

---

# 7. 订单页面只显示“当前活动订单”

页面使用 Tabs：

## 建仓委托

字段：
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

## 止盈委托

字段：
- 创建时间
- Symbol
- Position
- Side
- Qty
- TP Price
- Age
- Coverage
- 操作

以下终态不得出现在活动订单页：

```text
CANCELED
EXPIRED
REJECTED
FILLED
```

这些事实继续保留在 SQLite / Audit / TradeRecord，不物理删除。

删除订单页现有的大型 Entry History 表；历史订单在 TradeRecord 详情或高级审计中查询。

---

# 8. 交易记忆真正建立数据来源

当前“已完成样本=0”不能继续只做 UI。

必须建立：

`TradeRecord CLOSED → Experience Builder → Experience Sample`

Experience Sample 至少：

```text
sampleId
tradeId
symbol
direction
regime
netPnl
winLoss
entryQuality
fillDelay
holdingDuration
lesson
mistakeTags[]
successTags[]
createdAt
```

交易记忆顶部统计：

- 已完成样本
- 盈利样本
- 亏损样本
- 胜率
- 平均净收益
- 平均持仓时长
- 平均成交等待
- LONG 胜率
- SHORT 胜率

Experience 进入 EIP 时只传结构化摘要：

- sameSymbolWinRate
- sameRegimeWinRate
- direction performance
- avg net pnl
- avg fill delay
- recent lessons
- mistake/success tags

禁止把完整历史原文或订单流水塞给 AI。

如果 SQLite 已存在本系统自己的完整交易事实，允许一次性重建 TradeRecord/Experience；禁止为了填 Memory 拉交易所外部历史。

---

# 9. 持仓页面产品化

主表只保留：

- 建仓 / 首次同步时间
- Symbol
- Direction
- TP 状态
- 操作

正收益：
- 绿色状态/侧边条

负收益：
- 红色状态/侧边条

不再把 Qty、Entry/Mark、杠杆、ROE、source、management、duration 全塞主表。

UNKNOWN 时间：
- 显示“未知”或“首次同步时间”；
- 禁止几十万小时。

点击持仓打开 Detail Drawer/Page：

## Position
- Qty
- Entry
- Mark
- Leverage
- unrealized PnL
- ROE

## 时间
- entryAt
- firstObservedAt
- source
- duration

## 趋势
- 1m
- 5m
- 15m
- 4h 图表/指标

## TP
- status
- orderId
- price
- qty
- age
- coverage
- replace / rebuild

## 管理
- AUTO_MANAGED
- HUMAN_MANAGED

## 人工操作
- 修改 TP
- 重建 TP
- Cancel/Replace TP
- reduce-only limit close
- maker close

默认不提供 Market close。

所有人工操作仍走：

`Dashboard → server-side manual intent → AccountExecutor → Binance`

---

# 10. 市场智能页面完整人类化

必须修复当前：

- 多周期表为空；
- Portfolio 直接 JSON；
- Experience 直接 JSON；
- Reachable band 无有效展示；
- OI/Funding/Taker/LongShort 未接入或未映射；
- Contradictions 英文。

## 候选概况
- Symbol
- Rank
- Score
- Pool Status
- Freshness
- Selection Reason

## 价格与盘口
- Last
- Mark
- Bid
- Ask
- Spread
- Imbalance
- Microprice
- Reachable Range

## 多周期
表格展示：
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

## Portfolio
JSON 改中文卡片：
- 当前持仓
- LONG / SHORT
- 同方向盈利率
- LONG/SHORT 名义金额

## Experience
JSON 改卡片：
- 样本数
- 同币胜率
- 同 Regime 胜率
- 平均成交等待
- 最近教训

## Derivatives
先调查是否已有后端数据：
- OI
- Funding
- Taker
- Long/Short
- Top Trader

如果可可靠获取：
- 统一缓存/限流；
- 不按页面请求直接高频打 Binance。

如果未接入：
- 明确显示“未接入”；
- 不伪造。

---

# 11. AI 大脑每条 Run 必须真实可点击

最终链：

`Row Click → GET /api/v3/brain/runs/:id → Detail Drawer/Page`

必须浏览器真实验证。

详情至少：

## Summary
- Run ID
- Symbol
- Role
- Model
- Status
- Direction
- Decision
- Confidence
- Timing
- Tokens

## Candidate
- Rank
- Score
- Pool reason

## EIP
人类可读。

## Scout
- Input
- Raw Output
- Normalized Output

## Primary
- Input
- Raw Output
- Normalized Direction / Decision
- Price Range
- Reason

## Timing
- queue
- prompt build
- request
- retry
- parse
- total

## Errors
- stage
- code
- message
- status
- timeout
- schema
- raw output

## Raw Audit
折叠 JSON。

“DEGRADED”只用于真实异常；正常等待候选不能标成 DEGRADED。

---

# 12. 运行中心全面中文化

运行中心继续保留，但作为高级运维页。

一级只显示中文：

- 交易网络
- 行情中心
- 动态交易池
- AI 引擎
- 交易所对账
- 止盈保护
- 数据与审计

状态：
- HEALTHY → 正常
- READY → 就绪
- RUNNING → 运行中
- DEGRADED → 降级
- RECOVERING → 恢复中
- FAILED → 故障
- BLOCKED → 已阻断

Market Stream 原始 JSON、stale symbol、gap、queue、last error 等全部放“查看详情” Drawer。

主页面示例：

```text
行情中心
恢复中
65 / 71 新鲜
```

而不是整段 JSON。

---

# 13. Settings 改为 Tabs

最终一级 Tabs：

1. 策略与执行
2. 交易所
3. 网络代理
4. AI 模型资源
5. 外观主题

不再使用“一区 / 二区 / 三区”。

---

# 14. 交易所 Resource Manager

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

如果后端没有对应 Adapter：

`适配器未实现 / 不可启用`

绝不能假装已支持真实交易。

每个资源字段：
- name
- type
- environment
- base URL
- auth type
- credential status
- proxy resource
- enabled
- default

---

# 15. Proxy Resource Manager

支持：
- 新增
- 删除
- 编辑
- 测试
- 启用/禁用

字段：
- name
- type
- URL
- DNS mode
- route scope
- enabled
- status

当前 SOCKS5H 作为默认资源保留。

---

# 16. AI Resource Manager

支持新增/删除。

字段：
- resource ID
- role
- base URL
- model
- enabled
- max concurrency
- timeout
- health path
- GPU label
- priority
- status

角色模板：
- SCOUT
- PRIMARY_BRAIN
- REVIEW_BRAIN

不假定 GPU 数量。

---

# 17. 外观主题

继续一个主题下拉框。

10 套主题保留。

主题说明放在下拉框下方，不能与控件挤成一行。

Sidebar 当前选中菜单的固定蓝色必须删除。

统一使用 semantic tokens：

```css
--nav-active-bg
--nav-active-text
--accent
--accent-soft
```

切换主题后 Sidebar 高亮必须立即变化。

---

# 18. 驾驶舱产品化补充

除了 5 个 KPI：

增加“当前系统状态”中文流程：

`实时行情 → 智能选币 → 候选过滤 → 交易池 → 9B整理 → 27B决策 → 挂单管理 → Binance`

增加：

## 当前工作
- Scout 当前任务
- Primary 当前任务
- Entry 当前任务

## 最近决策
- Symbol
- Direction
- Decision
- Confidence

## 下一步
- 下一候选
- 等待价格
- 等待冷却
- 等待 Entry

增加：

## 建仓活动状态
- 上次 Primary
- 上次 PLACE
- 上次 Entry Intent
- 上次 Submit
- 30m Primary
- 30m unique symbols
- 30m PLACE / REJECT
- consecutive rejects

如果 Market/Pool/AI/Entry Permission 全就绪，却长时间无建仓活动：

显示：

`建仓停滞`

并给原因。

报警不能强制交易。

---

# 19. 统一分页与筛选

统一用于：

- AI Run
- 交易记录
- Experience Samples
- Orders（如果很多）
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

---

# 20. 统一格式化

金额：
`$4,884.24`

禁止显示：
`4884.24040186`

时间：
`YYYY/MM/DD HH:mm:ss`

Duration：
- 12m
- 2h 34m
- 1d 4h

Unknown：
`未知`

PnL：
- 正绿色
- 负红色

---

# 21. 数据库迁移

新增/升级至少：

- trade_records
- experience_samples
- exchange_resources
- proxy_resources
- ai_resources

必须：
- versioned migration
- transaction
- restart safe
- backward compatible
- 不破坏 AI Runs / Orders / Settings / current positions

---

# 22. 测试

必须新增 Unit/Integration：

## TradeRecord
- close
- partial close
- fee calculation
- netPnl
- imported position
- incomplete record

## Experience
- CLOSED TradeRecord → Sample
- win/loss stats
- recent lessons

## Orders
- terminal status not active
- TP active count

## Position
- unknown duration
- imported firstObservedAt

## Settings
- exchange CRUD
- proxy CRUD
- AI resource CRUD
- unsupported adapter cannot enable
- theme nav token

## 完整链
`Entry Fill → Position → TP Fill → CLOSED TradeRecord → Experience → Dashboard Net Profit`

---

# 23. 浏览器真实验收

必须逐页浏览器点击：

1. 驾驶舱
2. 智能选币
3. 市场智能
4. AI 大脑 Run Detail
5. 持仓 Detail
6. 订单两个 Tabs
7. 交易记录 + Detail
8. 交易记忆
9. 运行中心 Details
10. Settings 五个 Tabs + CRUD + Theme

禁止只因为 typecheck/API 200 就认为 UI 完成。

---

# 24. 执行与退出规则

执行循环：

`调查 → 实施 → 定向测试 → 更新进度 → 搜索剩余 TODO/PARTIAL/PENDING → 继续`

禁止：

`完成一个子任务 → checkpoint → 停止`

本轮不等待其它问题先修完。

只有以下全部完成才允许结束：

- TradeRecord
- Dashboard 交易记录净收益
- Orders / TradeRecord 分离
- Memory 从 TradeRecord 生成
- Position 产品化
- Market Intelligence 人类化
- AI Run 点击审计
- Runtime 中文化
- Settings Tabs
- Exchange/Proxy/AI CRUD
- Theme Sidebar active 修复
- typecheck
- tests
- build
- restart
- 浏览器逐页验收

普通 `TODO / PARTIAL / PENDING = 0` 才允许最终回复。

---

# 25. 版本结果

完成本计划后：

# ZDJ-MITS V3.3.0
## 交易生命周期、交易记忆与前端产品化完整版

本轮完成后不再反复调整基础产品结构。

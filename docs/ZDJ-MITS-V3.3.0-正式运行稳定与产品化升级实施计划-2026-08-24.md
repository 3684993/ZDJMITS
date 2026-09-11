# ZDJ-MITS V3.3.0 正式运行稳定与产品化升级实施计划
## 目标：解决 100% REJECT、交易记录/记忆缺失、TP 孤儿单、前端产品化与可扩展设置

> 项目：`D:\MITS`
>
> 基线：V3.2.0 FINAL
>
> 原则：先按当前代码、SQLite、AI audit、Binance Testnet 真实状态独立调查；计划允许 `ACCEPT / MODIFY / REJECT / ALREADY_IMPLEMENTED`，不要机械照改。

---

# 一、不可改变的核心边界

1. 15m 是方向 authority；
2. Primary 每次正常决策必须输出 LONG / SHORT；
3. Decision 独立为 PLACE_LONG / PLACE_SHORT / REJECT_CANDIDATE；
4. AI_FAILED / 无法可靠解析必须 fail-closed；
5. 禁止 Raw REJECT → PLACE；
6. 1m/5m 负责时机/价格；
7. 4h/1d/1w 和 BTC/ETH 是背景权重，不是普通硬 veto；
8. AI 不直接调用 Binance；
9. Entry 由 Entry Manager 生成最终 Maker；
10. 不新增自动止损；
11. 已持仓 symbol 只排除自身，不阻塞其它候选；
12. 持仓退出后可重新进入 Universe；
13. TP 由确定性系统负责，AI 只在事实不足时提供建议；
14. 人工接管持仓不再由 AI 主动平仓。

---

# 二、P0-A：彻底解决长期 100% REJECT

## 调查

基于最近至少 3 小时持久化 AI audit，对所有 Primary Run 分析：

- Raw Direction；
- Raw Decision；
- Reject reason；
- 15m 趋势；
- 1m/5m timing；
- BB；
- volume；
- orderbook；
- higher timeframe；
- reachable band；
- confidence。

形成 Reject reason 分布。

重点验证：

- 是否把 1m/5m 短暂冲突当成候选级 REJECT；
- 是否把“等待回调”当成 REJECT，而不是价格区间；
- 是否把 Bollinger overextension 普遍当硬 veto；
- 是否把 volume/orderbook 的软信号组合成事实上的全拒绝；
- 是否把高周期冲突继续隐式当硬 veto。

## 决策原则修复

当：

- 15m 方向明确；
- Market/EIP 新鲜；
- symbol 可交易；
- 存在 1–5m 可达 Maker 区间；

则 1m/5m 的“等待回调/等待确认”应该优先反映为：

- idealPrice；
- acceptablePriceRange；
- confidence；
- horizon；

而不是普通 REJECT。

例如：

```text
15m LONG
当前价格偏高
1m bearish pullback
```

如果 AI 判断更适合等回调：

应该尽量输出：

```text
direction=LONG
decision=PLACE_LONG
acceptablePriceRange=未来1–5m可能回踩区间
```

由 Entry Manager 用 Maker 等待。

只有确实没有可执行区间或硬安全条件失败才 REJECT。

禁止通过：
- 强制每次 PLACE；
- AI failure fallback；
- 随机方向；
来提高频率。

---

# 三、P0-B：建立建仓活动健康监控

新增 `Entry Activity Monitor`。

持续维护：

- lastPrimaryRunAt；
- lastPlaceDecisionAt；
- lastEntryIntentAt；
- lastEntrySubmittedAt；
- lastEntryFilledAt；
- primaryRunsSinceLastPlace；
- uniqueSymbolsSinceLastPlace；
- consecutiveRejects；
- rejectRate30m；
- placeRate30m。

驾驶舱：

### 正常
系统持续产生合理 PLACE/REJECT。

### 警告
Market/Pool/AI/Entry Permission 全 READY，
但 5–10 分钟无 PLACE。

### 严重 · 建仓停滞
例如：
- 20+ 独立候选且 reject rate ≥95%；
- 10–15 分钟没有 Entry Intent；
- 调度停止；
- PLACE 无法进入 Entry。

必须显示具体原因。

报警不能直接触发强制下单。

---

# 四、P0-C：替换固定 45 秒全局节拍为稳定流水调度

先调查现有 cadence 与 Pool refill。

目标：

- Primary concurrency=1；
- Scout concurrency=1；
- Primary 永不重叠；
- Scout 可以在 Primary 工作时预处理“下一候选”；
- ready-for-primary buffer 最大 1；
- Primary 完成后有新鲜候选即可立即接续；
- 禁止一次积压多个 Primary；
- 禁止长时间 sleep 后批量补跑；
- candidate cooldown 继续有效。

如果现有架构不适合完全去掉 cadence，可保留最小 debounce/rate limit，但不得无证据固定等待 45 秒。

---

# 五、P0-D：TP Guardian 增加双向一致性

当前必须真实核对：

`Position → TP`
以及：
`TP → Position`

新增指标：

- requiredPositions；
- protectedPositions；
- tpMissing；
- orphanTp；
- duplicateTp；
- qtyMismatch；
- wrongSide；
- invalidReduceOnly。

规则：

### Position 有效
必须存在正确 TP coverage。

### TP 有效
必须有对应 Position。

Position=0：
TP 必须取消并进入 history。

同一 Position 默认只有一套 TP coverage；
如果未来支持多级止盈，必须显式策略标记，不能把重复订单误当保护。

验收要求：

```text
TP_MISSING = 0
ORPHAN_TP = 0
DUPLICATE_TP = 0
QTY_MISMATCH = 0
```

---

# 六、P0-E：建立 TradeRecord / TradeCycle

新增本地完整交易事实：

```text
Entry Fill
→ Position
→ Exit Fill / TP Fill / Manual Close
→ Position=0
→ TradeRecord CLOSED
```

字段：

- tradeId；
- symbol；
- direction；
- openedAt；
- closedAt；
- duration；
- entryQty；
- entryAvgPrice；
- exitAvgPrice；
- entryFees；
- exitFees；
- grossRealizedPnl；
- netPnl；
- closeReason；
- entryRunId；
- intentId；
- entryOrderIds；
- exitOrderIds；
- regime；
- source；
- completeness。

净收益：

```text
netPnl = grossRealizedPnl - entryFees - exitFees
```

Funding 如果记录，单独字段，不要偷偷混合。

---

# 七、本地历史原则

系统启动：

- 不主动导入交易所过去一个月历史成交；
- 不扫描历史平仓来虚构本地策略记录。

允许：

- 从当前 SQLite 本系统自己的 order/audit/fill 数据重建 TradeRecord；
- 当前已有 Position 创建 `IMPORTED_OPEN_POSITION`；
- firstObservedAt = 本次首次真实同步时间；
- 不知道真实 entryAt 就明确标记，不使用 epoch。

Imported Position 后续关闭：
- 可以生成记录；
- 费用缺失则 completeness=PARTIAL；
- 默认不纳入完整 Experience / 净收益统计，除非口径完整。

---

# 八、驾驶舱收益指标

删除：

`24h 已实现收益`

替换：

# `交易记录净收益`

来源：

本地完整 `TradeRecord.netPnl`。

默认统计：

所有本地完整已完成记录。

副标题显示：

`本地交易记录累计`

以后可增加范围：
- 今日；
- 7日；
- 30日；
- 全部。

---

# 九、订单与交易记录菜单拆分

## 订单

只显示当前活动委托。

Tabs：

### 建仓委托
列：
- 创建时间
- Symbol
- Direction
- Qty
- Maker Price
- Filled
- Age
- TTL
- 超时状态
- 操作

### 止盈委托
列：
- 创建时间
- Symbol
- Position
- Side
- Qty
- TP Price
- Age
- Coverage
- 操作

所有终态：
- CANCELED
- EXPIRED
- REJECTED
- FILLED

退出活动页，但数据库 audit/history 保留。

## 新增：交易记录

一条记录 = 建仓到完整平仓。

顶部总览建议：

- 累计净收益；
- 盈利交易收入；
- 亏损交易支出；
- 当前浮动盈亏；
- 已完成记录数。

表格：

- 建仓时间；
- 平仓时间；
- Symbol；
- 方向；
- Entry；
- Exit；
- 数量；
- Entry fee；
- Exit fee；
- 毛收益；
- 净收益；
- 持仓时长；
- 平仓方式；
- 操作。

支持：
- 分页；
- 时间筛选；
- symbol；
- direction；
- TP / MANUAL；
- 盈利/亏损。

---

# 十、交易记忆真正接入 TradeRecord

完成 TradeRecord 后：

```text
TradeRecord CLOSED
→ Experience Builder
```

生成：

- completed samples；
- winning samples；
- losing samples；
- win rate；
- avg net pnl；
- avg holding duration；
- avg fill delay；
- same-symbol win rate；
- same-regime win rate；
- direction performance；
- recent lessons。

Experience 进入 EIP 只提供结构化摘要。

如果当前本地数据库已拥有完整历史事件，允许重建。

不拉交易所外部历史填充。

---

# 十一、Position 页面产品化

主表只显示：

- 建仓/首次同步时间；
- Symbol；
- 方向；
- TP 状态；
- 操作。

当前 PnL：

- 正收益用绿色行侧标/状态；
- 亏损用红色行侧标/状态；
- 不额外塞很多列。

## 点击 Position

打开详情 Drawer/Page：

- PnL；
- ROE；
- Qty；
- Entry；
- Mark；
- Leverage；
- 1m/5m/15m/4h 图表；
- TP 详情；
- TP 修改；
- management status；
- entry source；
- first observed；
- manual operation。

UNKNOWN entryAt：

禁止显示几十万小时。

使用：

`首次同步时间`

作为 imported Position 的本地管理起点。

---

# 十二、人工操作原则

Position Detail 可以提供：

- 修改 TP；
- 重建 TP；
- Cancel/Replace TP；
- reduce-only limit close；
- maker close。

所有人工操作：

```text
Dashboard
→ server-side manual intent
→ AccountExecutor
→ Binance
```

不允许浏览器直接访问 Binance key。

用户当前要求建仓和平仓都使用挂单，因此默认禁止自动使用 market close。

---

# 十三、市场智能页面补全

必须修复多周期表实际渲染：

- 1m
- 5m
- 15m
- 4h
- 1d
- 1w

显示：

- Trend；
- EMA；
- MACD；
- Bollinger；
- ATR；
- Swing；
- support/resistance。

突出：

`15m 主方向`

修复：

- Portfolio JSON → 中文卡片；
- Experience JSON → 中文卡片；
- Reachable band；
- Contradiction → 中文结构；
- Missing Evidence；
- Evidence completeness。

衍生品：
- OI；
- Funding；
- Taker；
- Long/Short。

Codex 先调查是否已采集。
没有则基于 Binance Public API 加可靠缓存/限流。
无法可靠获取则显示“未接入”，不得伪造。

---

# 十四、AI 大脑详情链必须真实可点

对每条 Run：

```text
Row Click
→ Run Detail
```

显示：

- Candidate；
- EIP；
- Scout Input；
- Scout Raw Output；
- Scout Normalized；
- Primary Input；
- Primary Raw Output；
- Direction；
- Decision；
- Price Range；
- Reason；
- Timing；
- Errors；
- Raw Audit。

必须用浏览器真实点击验证，而不是只验证 API 200。

---

# 十五、运行中心全面中文化

保留高级运维价值，但主页面不显示 JSON。

中文区块：

- 交易网络安全门；
- 行情中心；
- 动态交易池；
- AI 引擎；
- 交易所对账；
- 止盈保护；
- 数据与审计。

状态：
- 正常；
- 降级；
- 恢复中；
- 故障；
- 运行中；
- 就绪。

详情通过 Drawer 展开：

- gaps；
- stale symbols；
- recovery queue；
- stream details；
- audit details。

---

# 十六、Settings 改成 Tabs + CRUD

一级 Tabs：

1. 策略与执行
2. 交易所
3. 网络代理
4. AI 模型资源
5. 外观主题

## 交易所 Resource Manager

支持：

- 新增；
- 编辑；
- 删除；
- 启用；
- 测试；
- 设置默认。

模板：

- Binance USD-M；
- Binance USDC-M；
- OKX；
- Coinbase。

没有真实 Adapter 的：
必须标记 `适配器未安装 / 不可启用`。

## Proxy Resource Manager

新增/删除/测试。

## AI Resource Manager

新增/删除：

- role；
- endpoint；
- model；
- maxConcurrency；
- health path；
- GPU label；
- enabled。

## Theme

一个下拉列表。

主题描述放控件下方。

Sidebar active background 使用主题 token，
禁止固定蓝色。

---

# 十七、驾驶舱最终布局

顶部继续保持 5 卡横向：

1. 总资产估值；
2. 浮动盈亏；
3. 当前持仓；
4. 交易记录净收益；
5. 当前活动委托。

第 5 卡副标题：

`Entry N · TP M`

不能 TP 有工作订单却显示 0。

增加：

## 建仓活动状态

例如：

```text
正常
上次 PLACE 2m
Primary 30m: 32
PLACE: 5
REJECT: 27
```

异常：

```text
严重 · 建仓停滞
32个候选连续REJECT
已12分钟无Entry Intent
```

---

# 十八、最终验收必须与凌晨高频运行做前后对比

Codex 必须从**本地数据**恢复：

`2026-08-24 03:00–10:00`

与修复后的窗口对比：

- Primary runs/hour；
- unique symbols/hour；
- PLACE rate；
- Entry Intent/hour；
- submitted orders/hour；
- fills/hour；
- TP created/hour；
- avg time between Entry Intents；
- avg time between fills；
- reject rate；
- Scout/Primary utilization。

目的：

查明为什么早期能产生订单，后续变成 100% Raw REJECT。

不能简单要求“达到固定盈利”，但必须证明：

- 不再 100% REJECT；
- Entry chain 持续有活动；
- AI 不无理由 idle；
- 不通过 fallback 造订单。

---

# 十九、最终自动化运行验收

完成：

- typecheck；
- tests；
- build；
- restart；
- browser UI audit。

然后运行至少 60 分钟 Testnet acceptance。

PASS 必须包含：

## Market
- freshness；
- gaps；
- reconnect；
- recovery。

## Pool
- target/current；
- refill；
- unique candidates。

## AI
- Primary Raw Direction；
- Raw Decision；
- PLACE / REJECT；
- reject reason；
- no incorrect normalization；
- no AI_FAILED→PLACE；
- no burst overlap；
- idle SLA。

## Entry
- Place decision；
- intent；
- blocked；
- submitted；
- fill。

## Orders
- active Entry；
- active TP；
- no terminal in active list。

## TP
- protected；
- missing；
- orphan；
- duplicate；
- qty mismatch。

## TradeRecord
- closed records；
- fee completeness；
- netPnl。

## Memory
- records → experience update。

---

# 二十、退出条件

只有：

- P0/P1 普通开发项=0；
- 100% REJECT 根因修复并有真实证据；
- TP orphan/duplicate=0；
- TradeRecord 可用；
- 交易记忆可从本地记录生成；
- UI 浏览器真实验证；
- Settings CRUD 可用；
- 60 分钟 acceptance 完成；

才允许交付 V3.3.0。

禁止 checkpoint 提前结束。

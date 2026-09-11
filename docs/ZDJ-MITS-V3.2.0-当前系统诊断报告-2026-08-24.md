# ZDJ-MITS V3.2.0 当前系统诊断报告
## 基于 2026-08-24 运行界面、`20260824-091841.tar` 验收证据与最近真实运行状态

> 结论先行：**当前系统的基础设施已经基本稳定，但还不能作为“正式长期运行版”冻结。**
>
> 最大问题已经从 Market/代理/私有账户稳定性，转移到：
>
> 1. **Primary Brain 系统性 100% REJECT，导致长时间无新建仓；**
> 2. **TP Guardian 只证明“持仓有 TP”，却没有证明“没有孤儿/重复 TP”；**
> 3. **订单、交易记录、交易记忆三个概念没有真正分层；**
> 4. **驾驶舱、市场智能、AI 大脑、持仓、运行中心仍带大量工程态/JSON/英文信息；**
> 5. **Settings 仍是静态单实例配置，不适合后续多交易所、多代理、多模型资源管理。**

---

# 一、当前系统真实状态判断

## 1. 基础运行链已经具备

从当前界面和验收证据看，以下基础能力已经真实存在：

- Binance Public Market：真实行情；
- Binance Testnet Private：READY；
- User Data / Reconciliation：在运行；
- SOCKS5H：已接入；
- Dynamic Pool：通常保持 8/8；
- Scout 9B：真实调用；
- Primary 27B：真实调用；
- AI Run：持久化；
- Primary Direction：LONG/SHORT 已存在；
- AI FAILED / REJECT 不再错误升级为 PLACE；
- TP Guardian：能够识别持仓 TP 覆盖；
- Production Mock path 已基本退出正式链；
- Dashboard/Engine：8080 同源运行。

因此现在不是“系统没有工作”，而是**系统工作了，但决策与产品层仍存在系统性缺陷**。

---

# 二、“12 点以后一直不建仓”的真实根因

## 2.1 不是持仓数量硬门

当前界面事实：

- 当前持仓：15；
- Pending Entry：0；
- Entry Permission：READY；
- Pool：8/8；
- Eligible：有候选；
- Binance Private：READY；
- Scheduler：RUNNING。

所以目前没有证据支持：

`持仓数量过多 → 全局禁止建仓`

这一旧问题已经不是当前第一阻断点。

---

## 2.2 不是 Market / Pool 停止

上传的 60 分钟正式验收中：

### 09:50–10:51
- Pool 最终 8；
- 23 个独立候选；
- Primary completed：81；
- `REJECT_CANDIDATE=81`；
- `PLACE_LONG=0`；
- `PLACE_SHORT=0`。

### 10:57–11:57
- Pool 最终 8；
- 25 个独立候选；
- Primary completed：83；
- `REJECT_CANDIDATE=83`；
- `PLACE_LONG=0`；
- `PLACE_SHORT=0`。

### 13:15–14:15
- Universe：63；
- Eligible：34；
- Pool：8/8；
- Primary completed：75；
- Primary failed：0；
- `REJECT_CANDIDATE=75`；
- `PLACE_LONG=0`；
- `PLACE_SHORT=0`；
- Entry placed：0；
- Entry blocked samples：0；
- Private not ready samples：0；
- Market quote freshness ≈ 98.4%；
- Kline freshness=100%；
- Pool book freshness=100%。

说明：

> **市场、候选、Pool、AI、Entry Permission 都工作，但 Primary 自己拒绝了全部候选。**

---

## 2.3 上传证据中累计出现 325 次 Raw REJECT、0 次 Raw PLACE

对上传的多轮验收 `engine.out.log` 中 `PRIMARY_DECISION_NORMALIZED` 事件做审计：

- Raw `REJECT_CANDIDATE`：325；
- Raw `PLACE_LONG`：0；
- Raw `PLACE_SHORT`：0；
- Normalized 也全部保持 REJECT；
- Direction 分布仍有 LONG/SHORT，因此并非方向无法确定。

这说明当前“不建仓”不是 normalizer 吞 PLACE，而是：

> **27B 的真实原始判断已经被当前 Prompt / 决策语义塑造成系统性拒绝。**

---

# 三、为什么 Primary 会 100% REJECT

对 325 条真实 Reject reason 做关键词审计（分类可重叠）：

- “等待 / pullback / confirmation”类：约 222；
- “风险收益 / 入场时机不佳”类：约 211；
- “盘口/买卖深度压力”类：约 199；
- “量能不足”类：约 168；
- “布林带过度延伸”类：约 166；
- “高周期背景冲突”类：约 130；
- 几乎所有 reason 都引用 1m/5m 短周期条件。

典型真实决策：

- 15m 明确 UP；
- 15m MACD/EMA 也支持 LONG；
- 但因为：
  - 当前接近 Bollinger 上轨；
  - 1m 出现短暂 bearish cross；
  - volume Z-score 偏低；
  - orderbook ask 压力大；
- Primary 返回：
  `direction=LONG + REJECT_CANDIDATE`
- reason 是“等待回调到 5m EMA / 15m EMA”。

这说明当前模型把：

**“现在价格不完美，最好等回调”**

理解成：

**“整个候选应该 REJECT”**

但系统原本已经有 Entry Manager，并且 AI 本来应该给出：

- idealPrice；
- acceptablePriceRange；
- 1–5 分钟 reachable range。

因此这类“等待回调”的情形，正常应该更多转化为：

> **LONG/SHORT 方向不变，给出更优 Maker 挂单价格区间。**

而不是全部 REJECT。

---

# 四、当前 AI 决策语义需要重新收敛

## 4.1 保留安全边界

必须继续保持：

- AI FAILED → 不交易；
- 无法解析 → fail-closed；
- Raw REJECT → Normalized REJECT；
- 不允许 fallback 自动下单；
- 15m 决定方向，但不直接绕过 Primary 下单。

## 4.2 但必须重新定义“什么情况值得 REJECT”

当前 REJECT 范围太宽。

建议业务原则调整为：

### 应作为价格/置信度因素，而不是普通 REJECT 的因素
- 1m 暂时反向；
- 5m 回踩；
- 当前靠近 Bollinger 上/下轨；
- 量能暂时不完美；
- orderbook 有短时压力；
- 4h/1d/1w 一般性冲突；
- BTC/ETH 一般性背景冲突；
- 当前价不够理想但存在 1–5m 可达 Maker 区间。

这些证据应该影响：

- idealPrice；
- acceptablePriceRange；
- confidence；
- maker placement；
- horizon。

### REJECT 应更接近“硬不可执行”
例如：

- 关键行情证据 stale / 缺失；
- 15m 内部本身无法形成可信方向；
- 没有任何 1–5m 可达的 Maker 价格区间；
- spread / liquidity / min-notional / precision 无法安全执行；
- 数据异常；
- 同 symbol 已有 Position / Entry；
- 其它明确硬边界。

> **不能为了交易频率强制 PLACE；但也不能允许“任何轻微不完美都 REJECT”。**

---

# 五、45 秒固定节拍也需要重新审视

当前驾驶舱显示：

`45秒节拍后分析下一候选`

固定 cadence 是之前为避免候选池耗尽而加入的保护，但它带来两个问题：

1. Scout 和 Primary 两块 GPU 不能充分流水工作；
2. 用户会看到“等待 45 秒”，即使资源空闲、Pool 中有候选。

更合理的最终模型：

```text
Primary 正在分析 Candidate A
        │
        └── Scout 可以预处理 Candidate B（最多只预取 1 个）

Primary A 完成
        ↓
如果 B 的 EIP 仍新鲜
Primary 立即开始 B
        ↓
Scout 准备 C
```

约束：

- Scout concurrency=1；
- Primary concurrency=1；
- Primary 永不重叠；
- Primary-ready buffer 最大 1；
- 不批量堆积；
- EIP 超时自动重建；
- candidate cooldown 仍生效。

这样能避免：

`长时间空闲 → 突然扎堆`

也不用依赖固定 45 秒睡眠维持节奏。

---

# 六、必须增加“建仓活动健康度”

用户最关心的不是“AI 是否 ONLINE”，而是：

> **系统有没有持续产生有效建仓活动。**

驾驶舱新增：

### 建仓活动
- 距离上次 PLACE：X 分钟；
- 距离上次 Entry Intent：X 分钟；
- 距离上次 Binance Entry Submit：X 分钟；
- 最近 30 分钟 Primary：N；
- 最近 30 分钟 REJECT：N；
- 最近 30 分钟 PLACE：N；
- 当前连续 Reject：N；
- 独立候选数：N。

报警建议：

### WARNING
满足：
- Market READY；
- Pool > 0；
- AI ONLINE；
- Entry Permission READY；
- 连续 5–10 分钟无 PLACE。

### CRITICAL · ENTRY_STALLED
满足其一：
- 20+ 个不同候选连续 95%–100% REJECT；
- 正常候选充足但 10–15 分钟无 Entry Intent；
- AI 调度无故停顿；
- PLACE 已产生但长期没有进入 Entry Manager。

报警是为了**立即暴露系统异常**，不是为了强制制造订单。

---

# 七、驾驶舱问题

当前驾驶舱仍有以下产品问题：

1. `24h 已实现收益` 与用户目标不一致；
2. 实时执行链仍像开发者状态表；
3. Primary 显示 `DEGRADED`，但实际上只是“准备分析/等待”，状态语义不正确；
4. `FreshMarkets RECOVERING` 只因部分 symbol stale 就过于醒目；
5. 账户资产和保证金信息缺乏清晰分区；
6. “当前活动挂单=0”与页面下方存在大量 WORKING TP 明显矛盾。

## 建议

### 顶部 KPI
- 总资产估值；
- 浮动盈亏；
- 当前持仓；
- **交易记录净收益**；
- **当前活动委托**。

其中：

`交易记录净收益`

只统计本地完整交易记录：

`平仓已实现收益 - 建仓手续费 - 平仓手续费`

不再使用 24h Binance income 作为驾驶舱核心指标。

### 当前活动委托
建议显示：

`总数`
并用副标题：

`建仓 N · 止盈 M`

不能 TP 有 15+ 个 WORKING，驾驶舱却显示 0。

---

# 八、订单与交易记录必须彻底分开

这是下一版必须做的数据模型升级。

## 8.1 菜单建议

保留：

### `订单`
只代表**当前活动委托**。

新增：

### `交易记录`
代表一笔完整交易生命周期。

保留：

### `交易记忆`
但它不再保存订单流水，而是从“交易记录”派生经验统计。

最终导航：

1. 驾驶舱
2. 智能选币
3. 市场智能
4. AI 大脑
5. 持仓
6. 订单
7. 交易记录
8. 交易记忆
9. 运行中心
10. 系统设置

这是比“订单与记录混在一个页面”更清晰的结构。

---

# 九、订单页面最终语义

## 9.1 只显示当前活动订单

两个选项卡：

### 建仓委托
显示：
- 建立时间；
- Symbol；
- 方向；
- 数量；
- Maker 价格；
- 已成交数量；
- 已持续时间；
- Entry TTL；
- 是否超时；
- 当前状态；
- 操作。

### 止盈委托
显示：
- 建立时间；
- Symbol；
- 对应 Position；
- 方向；
- TP 价格；
- 数量；
- 持续时间；
- 覆盖状态；
- 操作。

CANCELED / EXPIRED / REJECTED / FILLED：

**立即退出活动订单 UI。**

审计数据仍在数据库，不物理删除。

---

# 十、当前 TP 页面暴露出比 UI 更严重的问题

当前：

- Position：15；
- TP Guardian：required=15 / protected=15；
- 但活动 TP 表明显远多于 15 笔。

而且存在：

- 当前无 Position 的 symbol 仍有 WORKING TP；
- 同一 symbol 多个 TP；
- 已经关闭/不在持仓表里的 ENAUSDT、BTCUSDT、DOGEUSDT、MUBARAKUSDT、BCHUSDT、TUTUSDT、STXUSDT 等仍有 TP。

这说明当前 TP Guardian 的判断只验证：

> “每个 Position 至少存在一个 TP”

却没有验证：

> “每一个 TP 都有对应的真实 Position”。

这是正式运行前的 **P0 风险**。

## 最终 TP 不变量

对当前策略，如果不是明确的分批止盈：

### 每个真实 Position
必须：

- 有且仅有一套有效 TP coverage；
- side 与 position 相反；
- reduce-only / close-position 语义正确；
- 总 TP qty 与 position qty 匹配；
- TP price 有效。

### 每个 WORKING TP
必须存在对应真实 Position。

如果 Position=0：

```text
TP → ORPHAN
→ 自动取消
```

必须增加：

- `orphanTpCount`
- `duplicateTpCount`
- `quantityMismatchCount`

TP Guardian 不能只显示：

`15/15 protected`

还必须显示：

`孤儿 0 · 重复 0 · 数量不匹配 0`

---

# 十一、交易记录应该成为系统收益的唯一权威

新增本地 `TradeCycle / TradeRecord`。

一条记录代表：

```text
Entry First Fill
→ Position Open
→ TP / Manual Close
→ Position Qty = 0
```

至少记录：

- tradeId；
- symbol；
- direction；
- openedAt；
- closedAt；
- duration；
- entryQty；
- entryAveragePrice；
- exitAveragePrice；
- entryFee；
- exitFee；
- grossRealizedPnl；
- netPnl；
- closeReason；
- TP / MANUAL；
- entryDecisionRunId；
- Entry Intent；
- Binance Entry Order IDs；
- Exit/TP Order IDs；
- regime；
- source；
- fee completeness。

## 净收益口径

```text
netPnl
=
grossRealizedPnl
- entryFee
- exitFee
```

Funding 如要计入必须单独列出，不应偷偷混进口径。

驾驶舱的：

`交易记录净收益`

只来自本地 TradeRecord。

---

# 十二、不启动时拉取历史交易

用户原则：

> 系统启动时不扫描/导入过去一个月 Binance 历史交易作为策略记录，以本地记录为主。

正确实现：

### 本系统已经产生的本地历史
允许重建/迁移 TradeRecord。

### 系统启动前就已经存在的 Position
只创建：

`IMPORTED_OPEN_POSITION`

使用：

- `firstObservedAt` = 本次系统首次真实同步时间；
- source = `SYSTEM_FIRST_SEEN / IMPORTED_AT_STARTUP`。

不伪造真实建仓时间。

如果以后关闭：

- 可以形成本地记录；
- 但如果缺少真实 entry fee，必须标记 `feeCompleteness=PARTIAL`；
- 默认不纳入完整策略收益/Experience，避免假精度。

---

# 十三、当前 Position 页面存在明确显示/数据问题

## 13.1 `496547h` 是严重 bug

`UNKNOWN` entry time 被错误当成 epoch/0 计算时长。

必须禁止。

如果 entry time 不知道：

```text
未知
```

或者按用户要求：

```text
首次同步：2026/8/24 xx:xx
```

绝不能显示几十万小时。

## 13.2 Position 列表应简化

用户最终主列表只需要：

- 建仓/首次同步时间；
- Symbol；
- 方向；
- TP 状态；
- 操作。

当前盈亏用视觉语义表达：

- 正收益：绿色侧边/状态；
- 亏损：红色侧边/状态。

不再把：
- Qty
- Entry/Mark
- leverage
- ROE
- source
- management source
- duration
全部塞主表。

## 13.3 点击行进入 Position Detail

详情显示：

- 当前 PnL / ROE；
- Entry / Mark；
- Qty；
- Leverage；
- 1m/5m/15m/4h 趋势图；
- TP order；
- TP 修改；
- 管理状态；
- firstObserved / entry source；
- 人工操作。

人工平仓默认使用：

`reduce-only limit / maker`

不得新增自动市场止损。

---

# 十四、市场智能页面并没有真正完成

当前问题：

1. 多周期技术指标表为空；
2. EIP raw 数据实际有 technical，但 UI 没渲染；
3. OI / Funding / Taker / LongShort 都是 `—`；
4. Portfolio 仍显示 JSON；
5. Experience 仍显示 JSON；
6. Reachable band 显示 `"—"`；
7. Contradictions 仍是英文字符串。

从验收 engine log 可以确认 EIP 实际包含：

- 1m / 5m / 15m / 4h / 1d / 1w；
- EMA；
- MACD；
- BB；
- ATR；
- Swing。

所以“多周期表为空”首先是**前端映射缺陷**，不是后端完全没数据。

下一版必须修复。

衍生品数据如果暂未采集：

- Codex 应先核实 Binance public capability；
- 有可靠接口则增加缓存/限流采集；
- 无法可靠获取则明确显示“未接入”，而不是给假数据；
- 不得把缺失衍生品默认变成 REJECT 硬门。

---

# 十五、AI 大脑详情点击仍没有真正可用

虽然后端已经有 Run Detail，但当前用户点击无法查看完整内容。

必须重新验证：

```text
AI Trace Row Click
→ GET /api/v3/brain/runs/:id
→ Detail Drawer/Page
```

详情默认展示：

1. Candidate；
2. EIP；
3. Scout Input；
4. Scout Raw Output；
5. Scout Normalized；
6. Primary Input；
7. Primary Raw Output；
8. Normalized Direction / Decision；
9. Timing；
10. Errors；
11. Raw Audit。

最重要的是：

> 用户必须能看到“系统给 27B 的数据”和“27B 原始返回”。

---

# 十六、交易记忆为什么现在是 0

这不是纯 UI bug。

根因是系统没有形成真正的：

`Entry → Close → Completed TradeCycle`

Experience Builder 没有可靠的“完成交易事实”。

正确链：

```text
TradeRecord CLOSED
→ Experience Builder
→ Experience Sample
→ EIP Experience Summary
```

Experience 只从本地完整交易记录生成：

- 同 symbol 胜率；
- 同 regime 胜率；
- LONG/SHORT 统计；
- 平均净收益；
- 平均持仓时长；
- 平均 Entry 等待；
- 最近失败/成功教训。

不要把全部历史原文塞给 AI。

如果当前 SQLite 已有本系统自己的 Entry/Fill/Close 事实，可以做一次本地重建。

禁止为了填满 Memory 去抓交易所一个月历史。

---

# 十七、运行中心必须产品化

当前大量：

- English label；
- JSON；
- 原始 stream object；
- `drift=3`；
- `HEALTHY`；
- `recoveryQueue`；

普通用户难以理解。

建议保留“运行中心”，定位为高级运维页面，但全部中文化。

## 一级只显示

### 交易网络
正常 / 异常

### 行情中心
正常
`65 / 71 新鲜`

### 动态交易池
正常
`8 / 8`

### AI 引擎
工作中
`Scout / Primary`

### 交易所对账
正常
`3 项差异已发现/处理`

### 止盈保护
正常
`15 / 15`
`孤儿 0`
`重复 0`

### 数据与审计
正常
`SQLite integrity PASS`

原始 JSON / gap details / stale symbol：

全部进入“查看详情”。

状态中文：

- HEALTHY → 正常；
- DEGRADED → 降级；
- RECOVERING → 恢复中；
- FAILED → 故障；
- READY → 就绪；
- RUNNING → 运行中。

---

# 十八、Settings 应改为选项卡 + Resource Manager

建议一级 Tabs：

1. 策略与执行
2. 交易所
3. 网络代理
4. AI 模型资源
5. 外观主题

这比“一区/二区/三区”更符合产品 UI。

## 交易所

改成可管理资源列表：

- Add；
- Edit；
- Delete；
- Enable；
- Set Default；
- Test。

模板：

- Binance USD-M；
- Binance USDC-M；
- OKX / 欧易（模板预留）；
- Coinbase（模板预留）。

注意：

> 没有后端 Adapter 的模板只能创建为 DISABLED / NOT_IMPLEMENTED，禁止假装已经支持真实交易。

## 代理

支持新增/删除：

- name；
- type；
- URL；
- enabled；
- route target；
- test。

## AI 模型资源

支持新增/删除：

- resource id；
- role；
- base URL；
- model；
- enabled；
- max concurrency；
- GPU label；
- health path；
- timeout。

## 外观主题

继续使用一个下拉菜单。

主题说明放在下拉框下方，不跟控件挤成一行。

Sidebar active background 必须使用 theme semantic token：

`--nav-active-bg / --accent-soft`

不能继续固定蓝色。

---

# 十九、当前版本正式交付前的 P0 / P1 排序

## P0

1. 100% Primary REJECT；
2. TP orphan / duplicate；
3. TradeRecord 缺失导致收益/Memory 无权威来源；
4. Position UNKNOWN 时间计算成 496547h；
5. “当前活动挂单=0”与实际 WORKING TP 不一致；
6. AI Run Detail 点击链真实不可用。

## P1

1. 市场智能多周期表空；
2. Portfolio / Experience JSON；
3. 运行中心工程化信息过多；
4. Position 表过宽；
5. 订单/记录混杂；
6. Settings 资源不可 CRUD；
7. 主题 sidebar 高亮固定蓝色。

---

# 二十、下一版本建议

当前改动已经超过 patch 级别。

建议：

# **ZDJ-MITS V3.3.0**
## 正式运行稳定与产品化升级版

V3.3.0 不再重构底层交易核心，而重点解决：

- 决策频率；
- Trade lifecycle；
- TP 完整性；
- 产品 UI；
- 资源化设置；
- 运行可解释性。

完成后再冻结平台底座。

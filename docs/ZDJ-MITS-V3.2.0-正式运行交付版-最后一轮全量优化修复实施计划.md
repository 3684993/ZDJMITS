# ZDJ-MITS V3.2.0 正式运行交付版
## FINAL — 最后一轮全量优化、修复、审计与正式运行验收实施计划

> 项目目录：`D:\MITS`  
> 目标版本：**ZDJ-MITS V3.2.0**  
> 定位：**正式运行交付版 / Production-Ready Release Candidate**  
> 执行方式：**一次性完成，不拆阶段，不在普通开发项未清零时提前结束。**  
> 本计划覆盖：运行链、AI 决策边界、候选调度、Entry、订单、持仓、TP、人类接管、驾驶舱、AI 审计、设置、主题、可观测性、验收与正式运行保护。

---

# 0. 为什么需要更新上一版计划

上一轮已经取得关键进展，旧计划中的部分“待排查根因”已经有了真实运行结论，因此本文件替换上一版计划，作为 V3.2.0 最终执行基准。

当前已经确认的真实成果：

- Binance Public / Private 均已接通；
- SOCKS5H 正常；
- Market Stream 已恢复稳定；
- 最近正式 30 分钟测试网验收：
  - `119/119` 采样成功；
  - 行情、K 线、盘口新鲜率全程 `100%`；
  - depth gap = `0`；
  - reconnect = `0`；
  - recovery failure = `0`；
  - fatal = `0`；
  - Primary Brain failure = `0`；
  - `PLACE_LONG = 9`；
  - `PLACE_SHORT = 7`；
  - 新建 Binance Testnet 订单 `10` 笔；
- 当前 Engine、Binance Private 为 `READY`；
- Market Stream 为 `LIVE`；
- 凭证已通过 Windows DPAPI machine scope 加密持久化；
- Settings 只显示掩码，不回显 Secret；
- API Key / Secret 留空可以保留原值，重新输入可以修改；
- Test / Verify / Save 已存在；
- 生产地址已经预留，但未经明确切换不得发送 Production 私有写。

但上一轮还暴露出一个**必须在正式交付前纠正的 P0 边界问题**：

> “AI 异常、拒绝或返回格式不标准时，会归一化为可执行的 15 分钟建仓决策。”

该行为不得进入正式版。

因此 V3.2.0 FINAL 必须首先恢复正确边界：

**15m 决定方向，不等于 15m 自动决定下单。**

---

# 1. 最终业务硬原则

以下原则为最终不可违背的业务约束。Codex 可以优化实现，但不得改变语义。

## 1.1 主周期方向

- `15m` 是建仓方向的主 authority；
- 每一次 Primary Brain 的正常分析都必须明确给出：
  - `direction = LONG | SHORT`
- 禁止 `NONE`；
- 禁止把 `HOLD` 当方向。

## 1.2 方向与执行决策必须彻底分开

方向：

```text
LONG | SHORT
```

执行决策：

```text
PLACE_LONG | PLACE_SHORT | REJECT_CANDIDATE
```

合法组合例如：

```text
direction=LONG
decision=PLACE_LONG
```

也允许：

```text
direction=LONG
decision=REJECT_CANDIDATE
```

含义是：

> 15m 方向偏多，但当前价格、时机、赔率、证据组合或执行条件不足，不在此刻建仓。

同理允许 SHORT + REJECT。

## 1.3 高周期只能提供背景

- 1m / 5m：入场时机、价格、微观执行；
- 15m：主方向；
- 4h / 1d / 1w：背景、置信度、风险权重；
- 默认不得因为 4h / 1d / 1w 与 15m 有一般性冲突，就单独硬否决；
- BTC / ETH regime 也是背景风险信息，默认不得成为单一硬 gate。

## 1.4 AI 失败必须 fail-closed

以下情况不得转换成 PLACE：

- AI HTTP error；
- timeout；
- JSON parse error；
- schema invalid；
- protocol incomplete；
- raw output 无法可靠确定意图；
- Primary 明确 `REJECT_CANDIDATE`。

允许：

```text
轻微格式异常
→ deterministic parser repair
→ 有限 retry
```

只有能**可靠恢复模型原始意图**时才接受。

否则：

```text
AI_FAILED
→ 不创建 Entry Intent
→ 记录失败原因
→ 当前候选进入合理 cooldown / 换下一个候选
```

绝对禁止：

```text
AI_FAILED → 根据 15m 自动 PLACE
REJECT_CANDIDATE → 根据 15m 自动 PLACE
```

## 1.5 AI 只决定“是否现在入场”

AI 不能：

- 直接调用交易所；
- 直接决定最终交易所价格；
- 取消人工持仓；
- 自动止损；
- 改杠杆绕过设置；
- 绕过 Entry Manager / AccountExecutor。

真实链必须保持：

```text
Market
→ Universe
→ Eligibility
→ Ranking
→ Pool
→ Scout
→ EIP
→ Primary Brain
→ Direction + Decision
→ Entry Intent
→ Entry Permission
→ Entry Manager
→ AccountExecutor
→ Binance
```

## 1.6 禁止自动止损

正式版继续保持：

- 无自动止损；
- 无 loss-cut；
- 无亏损触发 MARKET_REDUCE；
- 无 AI 自动亏损平仓。

亏损持仓最终由人工管理。

## 1.7 已有持仓不得阻塞其它币

已有 Position：

```text
只排除相同 symbol
```

不得：

```text
position count >= N
→ 全系统停止 Scout / Primary / Entry
```

Pending Entry 同样只排除该 symbol。

---

# 2. 正式实施前：Codex 必须重新审计当前真实代码

本计划不是让 Codex 机械照改。

开始前必须读取：

- Git / worktree；
- `package.json`；
- `docs/implementation-progress.md`；
- Engine scheduler；
- Market Data Hub；
- Universe；
- Eligibility；
- Pool；
- Candidate cooldown；
- AI queue；
- AI Run persistence；
- EIP builder；
- Scout prompt；
- Primary prompt；
- parser / normalizer；
- Entry Intent；
- Entry Manager；
- Pending Entry Manager；
- AccountExecutor；
- Position projection；
- Order projection；
- Binance User Data WS；
- Reconciliation；
- TP Guardian；
- Settings；
- Dashboard；
- SQLite schema；
- 最近至少 3 小时 runtime log；
- 最近至少 3 小时 AI audit；
- 最近 Testnet Orders / Positions；
- 最近 30 分钟 acceptance summary。

必须先确认当前真实调用链，然后对本计划每一项判断：

```text
ALREADY_IMPLEMENTED
NEEDS_FIX
NEEDS_HARDENING
NOT_APPLICABLE
```

但发现普通生产缺陷后必须在本轮一起修复。

---

# 3. P0 — 逐笔审计最近 PLACE，纠正 AI 决策语义

最近已观测：

```text
PLACE_LONG = 9
PLACE_SHORT = 7
Binance new orders = 10
REJECT_CANDIDATE = 0
Primary failure = 0
```

该结果说明主链已能产生建仓，但也必须证明没有“错误自动 PLACE”。

## 3.1 审计全部 16 个 PLACE

逐笔追踪：

```text
Primary Raw Output
→ Parsed Output
→ Normalized Decision
→ Entry Intent
→ Entry Permission
→ Entry Manager
→ Binance
```

每笔必须能够回答：

- raw direction 是什么；
- raw decision 是什么；
- normalizer 最终 direction；
- normalizer 最终 decision；
- 是否发生 parser repair；
- 是否发生 retry；
- 是否创建 Entry Intent；
- 是否被 Entry Permission 阻断；
- 是否进入 Entry Manager；
- 是否产生 Binance request；
- 是否获得 Binance orderId。

## 3.2 解释 16 PLACE 与 10 Orders 的差异

剩余 6 笔必须逐笔归因，允许的真实原因例如：

- symbol 已有 position；
- symbol 已有 pending entry；
- insufficient margin；
- maker price unreachable；
- stale execution quote；
- exchange precision；
- min notional；
- duplicate intent；
- cooldown；
- canceled before submission。

禁止：

```text
没有记录
不知道
静默消失
```

## 3.3 决策一致性测试

必须增加自动回归：

```text
Raw REJECT → Normalized REJECT
Raw PLACE_LONG → Normalized PLACE_LONG
Raw PLACE_SHORT → Normalized PLACE_SHORT
AI_FAILED → no PLACE
```

任何：

```text
Raw REJECT → Normalized PLACE
AI_FAILED → Normalized PLACE
```

均属于 P0 bug。

---

# 4. 智能选币与交易池最终规则

## 4.1 主链

```text
Production Public Market
→ Universe
→ Eligibility
→ Opportunity Ranking
→ Dynamic Trading Pool
```

## 4.2 Pool refill 必须持续

当前出现：

```text
POOL_EMPTY
```

且解释为候选已经变成持仓或挂单。

正式版必须重新验证此逻辑。

如果 Top8 全部变成 position / pending：

```text
继续向 Universe 后方补位
```

不能：

```text
Top8 都被占用
→ Pool 永久为空
```

只有完整 Eligible Universe 都因为真实原因不可用，才允许 Pool Empty。

## 4.3 Pool Empty 原因细分

不得只显示：

```text
POOL_EMPTY
```

必须至少区分：

```text
POOL_READY
POOL_REFILLING
POOL_EMPTY_NO_ELIGIBLE
POOL_EMPTY_ALL_EXCLUDED
POOL_EMPTY_ALL_COOLDOWN
POOL_EMPTY_MARKET_DEGRADED
```

## 4.4 REJECT cooldown

继续保留 rejection cooldown。

原则：

- REJECT 后立即退出当前 Pool；
- 进入至少到下一根 15m bar 的 cooldown；
- Universe refresh 不得马上把相同 symbol 拉回；
- 只有新 15m bar 或足够显著的市场结构变化才允许重新分析。

必须继续统计：

- candidate turnover；
- unique symbols/hour；
- repeat reject ratio；
- repeated symbol ratio。

---

# 5. AI 调度：不得长时间无解释闲置，也不得扎堆

当前用户观察到：

```text
10+ 分钟无 Run
→ 随后短时间多个币集中 Scout / Primary
```

正式版必须查清根因。

## 5.1 需要审计的调度事实

至少统计最近 3 小时：

- scheduler wake interval；
- pool refresh interval；
- queue depth；
- Scout concurrency；
- Primary concurrency；
- runs/min；
- runs/hour；
- unique symbols/hour；
- idle interval distribution；
- longest idle；
- burst size；
- cooldown release；
- 15m bar events；
- Market recovery events；
- Entry backpressure。

## 5.2 正确目标

不是人为规定：

```text
每 X 秒必须调一次 AI
```

而是：

```text
存在合格候选
+ AI 资源空闲
+ 无真实硬阻断
→ 调度器持续平稳消费
```

不得：

```text
候选积压
→ 定时批量提交
→ 多个 Run 扎堆
```

## 5.3 >10 分钟静默必须可解释

如果 Primary 超过 10 分钟没有新 Run，必须生成明确状态：

```text
WAITING_CANDIDATE
WAITING_MARKET
WAITING_SCOUT
POOL_EMPTY_NO_ELIGIBLE
ALL_CANDIDATES_COOLDOWN
ENTRY_BACKPRESSURE
AI_RESOURCE_BUSY
AI_RESOURCE_ERROR
WAITING_NEW_15M_BAR
```

如果：

- Market READY；
- Eligible > 0；
- Pool > 0；
- Scout/Primary ONLINE；
- 无 Pending/资金硬门；

却仍 >10 分钟不调度，则：

```text
AI_FABRIC = DEGRADED
```

并自动记录 scheduler 诊断信息。

---

# 6. AI 大脑页面升级成实时工作台

## 6.1 资源状态

Scout 和 Primary 顶部卡分别显示：

- ONLINE / OFFLINE；
- 当前运行状态；
- 当前 symbol；
- Run ID；
- 当前运行秒数；
- 最近完成时间；
- 最近 direction；
- 最近 decision；
- 下一步动作；
- idle reason；
- queue depth；
- runs；
- P50/P95；
- 最近失败。

## 6.2 状态枚举

至少：

```text
ANALYZING
WAITING_CANDIDATE
WAITING_MARKET
WAITING_SCOUT
WAITING_PRIMARY
DECISION_READY
ENTRY_PENDING
BLOCKED
IDLE
DEGRADED
```

## 6.3 Direction 必须出现在主列表

AI Run Trace：

| Time | Symbol | Role / Model | Status | Direction | Decision | Confidence | Total | Tokens |
|---|---|---|---|---|---|---|---|---|

示例：

```text
MONUSDT | PRIMARY_BRAIN | COMPLETED | LONG | PLACE_LONG | 0.71
```

或：

```text
ENSUSDT | PRIMARY_BRAIN | COMPLETED | SHORT | REJECT_CANDIDATE | 0.56
```

方向不得隐藏在详情 JSON 中。

---

# 7. AI Run 全链审计详情

每条 Run 必须可点击。

## 7.1 Summary

- Run ID；
- Symbol；
- Role；
- Model；
- Status；
- Direction；
- Decision；
- Confidence；
- Start / End；
- latency；
- input/output tokens。

## 7.2 Candidate / Ranking

- Universe rank；
- opportunity score；
- selection generation；
- 为什么进入 Pool；
- candidate turnover；
- cooldown 状态。

## 7.3 EIP

默认使用人类可读形式。

## 7.4 Scout Input

必须能看到真实传给 9B 的数据。

## 7.5 Scout Raw Output

必须能看到 9B 原始返回。

## 7.6 Scout Normalized Output

展示：

- attention；
- contradictions；
- missing evidence；
- capital anomaly；
- entry concern；
- direction bias（如果存在）。

## 7.7 Primary Input

必须能看到真实传给 27B 的输入，包括：

- EIP；
- Scout result；
- portfolio；
- experience；
- market regime。

## 7.8 Primary Raw Output

完整保留脱敏后的原始模型输出。

## 7.9 Normalized Decision

必须明确：

- direction；
- decision；
- confidence；
- reason；
- idealPrice；
- acceptablePriceRange；
- horizon；
- supportingEvidence；
- contradictions；
- missingEvidence；
- reconsiderCondition。

## 7.10 Timing

持久化：

```text
queueMs
promptBuildMs
requestMs
retryMs
parseMs
totalMs
```

## 7.11 Errors

FAILED 需要显示：

- failureStage；
- errorCode；
- errorMessage；
- HTTP status；
- timeout；
- parser error；
- schema validation；
- retry count；
- raw model output。

## 7.12 Raw Audit

完整 JSON 允许折叠查看。

默认 UI 不显示大段 JSON。

敏感 Secret 永远不得进入 audit。

---

# 8. EIP 最终人类可读界面

智能市场默认不得直接显示 JSON。

## 8.1 候选概况

- Symbol；
- Rank；
- opportunity score；
- pool state；
- freshness；
- selection reason。

## 8.2 当前价格与执行环境

- Last；
- Mark；
- Bid；
- Ask；
- Spread；
- Microprice；
- 1m / 3m / 5m reachable band。

## 8.3 多周期结构

| 周期 | Direction/Trend | EMA | MACD | Bollinger | ATR | Swing | 支撑/阻力 |
|---|---|---|---|---|---|---|---|
| 1m | | | | | | | |
| 5m | | | | | | | |
| 15m | | | | | | | |
| 4h | | | | | | | |
| 1d | | | | | | | |
| 1w | | | | | | | |

必须在视觉上突出：

```text
15m = 主方向
```

高周期只作为背景。

## 8.4 资金与衍生品

- OI；
- OI change；
- Funding；
- Taker ratio；
- Global long/short；
- Top trader ratio。

## 8.5 BTC / ETH Regime

## 8.6 Portfolio

## 8.7 Experience / Memory

## 8.8 Evidence

- supporting evidence；
- contradictions；
- missing evidence；
- evidence completeness。

## 8.9 Scout 结论

## 8.10 Primary 结论

必须突出：

```text
方向
决策
置信度
原因
理想价格
可接受价格区间
有效时间
重新考虑条件
```

---

# 9. 驾驶舱：正式替换“总览”

左侧菜单：

```text
总览 → 驾驶舱
```

路由可保持兼容。

标题：

```text
系统驾驶舱
```

## 9.1 删除重复信息

删除右上角：

```text
总估值 · 浮盈 · 持仓 · 24h · 挂单
```

交易核心数字只在驾驶舱主要区域显示。

## 9.2 KPI 必须横向

必须直接复用“交易记忆”现有统计卡的视觉组件。

不要重新设计卡片风格。

宽屏横向 5 卡：

1. 总资产估值；
2. 浮动盈亏；
3. 当前持仓；
4. 24h 净收益；
5. 当前挂单。

例如：

```text
$4,737.62 | -$1,659.39 | 18 | +$xx.xx | 4
```

禁止长小数：

```text
4737.62218224
```

统一格式化。

## 9.3 响应式

- 大屏：5 列；
- 中屏：合理换行；
- 小屏才纵向。

---

# 10. 账户资产最终显示

驾驶舱显示真实非零资产：

- USDT；
- USDC；
- BTC；
- 其它 Binance 私有账户返回的非零资产。

建议横向资产卡/表。

每项至少：

- wallet balance；
- available balance；
- USD estimate；
- margin eligible。

## 10.1 两个概念必须分开

### 总资产估值
所有可估值的真实非零资产。

### USD-M 可用于新建仓保证金
仅 Binance USD-M 当前实际 available margin。

BTC 等资产不能错误计入 USDT available margin。

## 10.2 UNAVAILABLE 修复原则

Binance Private READY 时，如果：

- floating PnL；
- available margin；
- 24h realized PnL；

仍 UNAVAILABLE：

Codex 必须检查真实 API/projection，不允许只在 UI 隐藏。

确实无法可靠得到 24h 净收益时：

```text
显示 — / 暂无可靠数据
```

并说明数据口径。

不得伪造 0。

---

# 11. Pipeline 改为中文可视化运行流程

开发者字符串：

```text
Market → Universe → Eligibility → Pool → Scout → Primary Brain → Entry Manager → Binance
```

不能继续作为主驾驶舱。

改成：

```text
实时行情
→ 智能选币
→ 候选过滤
→ 动态交易池
→ 9B 证据整理
→ 27B 入场决策
→ 挂单管理
→ Binance 执行
```

每个节点显示：

- 图标；
- 中文标题；
- 状态色；
- 关键数字；
- 当前工作；
- 一句说明。

例如：

```text
实时行情
正常
109 / 110 新鲜
```

```text
动态交易池
6 / 8
正在补位
```

```text
9B 证据整理
正在分析 FXSUSDT
已运行 8s
```

```text
27B 入场决策
LONG
PLACE_LONG
71%
```

---

# 12. RECOVERING / Freshness 主界面简化

禁止驾驶舱直接输出：

```json
{"status":"RECOVERING","count":12,"stale":[...]}
```

主界面只显示：

```text
行情恢复中 · 12 个标的
```

或者：

```text
数据新鲜度 92.3%
```

详细：

- stale symbols；
- quote ratio；
- kline ratio；
- pool book ratio；
- gaps；
- recovery failures；

进入：

- Drawer；
- Modal；
- 点击详情；
- 可滚动区域。

任何长数组/JSON 不得撑爆主页面。

---

# 13. 驾驶舱必须显示“当前工作 / 最近决策 / 下一步”

这是正式版核心可观测能力。

## 当前工作

例如：

```text
9B 正在整理 FXSUSDT
27B 正在分析 MONUSDT
Entry Manager 正在等待可达 Maker 价格
```

## 最近决策

例如：

```text
MONUSDT
方向：LONG
决策：PLACE_LONG
置信度：71%
```

## 下一步

例如：

```text
等待 Entry Manager 选择最终 Maker Price
```

或：

```text
等待下一根 15m K 线解除 MONUSDT 冷却
```

或：

```text
交易池正在从 Universe 补入下一候选
```

用户必须无需读日志就知道系统正在做什么。

---

# 14. 活动订单最终规则

## 14.1 CANCELED 不再显示在活动订单

以下终态：

```text
CANCELED
EXPIRED
REJECTED
FILLED
```

必须自动退出“当前活动订单”列表。

“当前挂单”只统计真实 active open orders。

## 14.2 不允许删除历史事实

终态订单仍必须保留在：

- SQLite history；
- audit；
- 交易记忆；
- 历史订单查询。

## 14.3 Pending Entry 生命周期

必须重新检查：

```text
PLACE
→ OPEN
→ KEEP / REPRICE / CANCEL
→ FILLED / CANCELED
```

禁止：

- orphan pending；
- Binance 已取消但内部仍 pending；
- 内部已释放但 Binance 仍 open；
- symbol 因幽灵 pending 长期不能重新分析。

---

# 15. 持仓最终状态机

每个真实 Position 至少具备：

```text
AUTO_MANAGED
TP_PROTECTED
TP_MISSING
TP_REPAIRING
TP_REPAIR_FAILED
HUMAN_MANAGED
```

---

# 16. 建仓时间恢复必须可靠

系统启动/重启后，持仓的真实建仓时间优先来自：

1. 系统 Fill；
2. Binance trade history；
3. Binance order history；
4. SQLite execution history；
5. reconciliation 恢复记录。

禁止：

```text
Engine restart time = entry time
```

如果确实无法恢复：

```text
entryTimeSource=UNKNOWN
```

而不是伪造。

---

# 17. TP Guardian 正式交付要求

## 17.1 每个需要保护的持仓必须显示

- TP status；
- TP orderId；
- TP price；
- TP qty；
- TP order type；
- create time；
- last verified；
- coverage source。

## 17.2 缺少 TP 必须强提醒

如果：

```text
Position != 0
AND requiredTP = true
AND validTPOrder = none
```

显示：

```text
TP_MISSING
缺少止盈保护
```

使用明显红色警示。

驾驶舱同时汇总：

```text
TP 保护 17 / 18
1 个持仓缺少 TP
```

---

# 18. 确定性自动补 TP

TP 缺失时优先使用系统事实：

- Entry record；
- Fill price；
- Position qty；
- Direction；
- 原 TP intent；
- Strategy TP rule；
- exchange precision；
- Binance order constraints。

生成：

```text
TP Repair Intent
→ TP Manager
→ AccountExecutor
→ Binance
```

AI 不能成为第一选择。

---

# 19. AI 辅助 TP 修复的严格边界

只有确定性事实不足，无法可靠恢复 TP 时才允许：

```text
Scout 9B
→ 整理 position / entry / market / history
```

必要时：

```text
Primary 27B
→ TP recommendation
```

AI 只允许返回：

- recommended TP price / range；
- reason；
- confidence；
- evidence。

之后仍必须：

```text
TP Manager
→ hard validation
→ reduce-only / close-position validation
→ precision
→ AccountExecutor
→ Binance
```

AI 不得直接提交 TP。

失败时：

```text
TP_REPAIR_FAILED
```

保持红色告警，并提示人工处理。

---

# 20. 超时持仓 → HUMAN_MANAGED

Settings 中必须有可理解的：

```text
持仓自动管理时限 / Human handoff after
```

达到时限仍未平仓：

```text
AUTO_MANAGED
→ HUMAN_MANAGED
```

进入后：

系统停止：

- AI 主动退出判断；
- 自动亏损平仓；
- 其它主动 exit decision。

系统继续：

- Binance position sync；
- entry time sync；
- TP order sync；
- TP coverage check；
- TP missing alert；
- 必要 TP repair；
- reconciliation。

HUMAN_MANAGED：

- 不占 Pool；
- 不占 AI 分析容量；
- 不阻塞其它 symbol；
- 同 symbol 仍不得重复 Entry，直到 position=0。

---

# 21. 主题系统最终保护

已经实现的 10 套主题保留。

正式版只检查：

- sidebar；
- topbar；
- app background；
- dashboard；
- cards；
- tables；
- input；
- button；
- chart；
- status；
- drawer/modal；

全部通过 semantic tokens。

不得重新写死颜色。

主题设置：

```text
单一下拉框
```

选择后实时应用、保存、重启保持。

---

# 22. Settings 最终检查

必须检查：

- Binance Testnet profile；
- Production profile（仅预留）；
- SOCKS5H；
- Scout endpoint；
- Primary endpoint；
- theme；
- trading parameters；
- Human handoff；
- TP policy；
- SecretStore 状态。

Secret：

- 永远 masked；
- 不回显；
- 留空保存保留旧 Secret；
- 新输入必须先 Test 再 Save；
- DPAPI machine scope 使用状态可见；
- 不进入日志/audit/AI。

---

# 23. Testnet / Production 边界

正式交付时当前可运行模式仍以已验证环境为准。

Production：

- endpoint 可以存在；
- production profile 可以配置；
- 但不得因为“正式运行交付版”自动切换；
- 必须有显式环境选择；
- Testnet credentials 不得发 Production；
- Production credentials 不得发 Testnet；
- endpoint 与 credential namespace 强绑定；
- private write 前再次检查 environment。

未经用户明确切换：

```text
Production Private Write = BLOCKED
```

---

# 24. 正式运行前静态安全审计

必须搜索并证明：

## 24.1 Production Mock path = 0

Mock 只能存在：

- tests；
- explicit test harness。

正式 Engine 不得自动 fallback Mock。

## 24.2 自动止损 path = 0

静态搜索并检查调用链：

```text
STOP_LOSS
AUTO_STOP
LOSS_CUT
AUTO_CLOSE_LOSS
MARKET_REDUCE
LIMIT_REDUCE
```

区分人工 Exit 与自动 Exit。

证明没有自动亏损平仓。

## 24.3 AI 无直接 Binance write

检查所有 adapter invocation caller。

AI 层不能持有交易所私有写权限。

---

# 25. 最终浏览器 UI 验收

必须实际浏览器验证：

- 驾驶舱；
- 智能选币；
- 市场智能；
- AI 大脑；
- 持仓；
- 订单；
- 交易记忆；
- 运行中心；
- 系统设置。

## 驾驶舱

- 菜单名“驾驶舱”；
- 5 KPI 横排；
- 复用交易记忆统计卡风格；
- 无右上角重复摘要；
- USDT/USDC/BTC/其它资产可读；
- 中文 Pipeline；
- 当前工作 / 最近决策 / 下一步；
- 无 JSON 撑爆。

## AI 大脑

- 当前状态可见；
- direction 可见；
- decision 可见；
- raw request/response 可见；
- normalization 可见；
- failed reason 可见；
- 分页筛选可用；
- idle reason 可见。

## Orders

- CANCELED 不在 active list；
- 历史仍能查。

## Positions

- TP coverage；
- TP missing 红色；
- human managed；
- entry time source。

---

# 26. 自动化正式验收

全部开发完成：

```text
npm run typecheck
npm run test
npm run build
```

全部 PASS 后重启 Engine。

先执行短 smoke。

之后至少运行：

```text
60 分钟正式 Testnet acceptance
```

不要让 Codex 人工等待。

必须使用自动脚本：

```text
等待 Market 稳定
→ 开始计时
→ 周期采样
→ summary.json
→ PASS / FAIL
```

---

# 27. 60 分钟验收统计

## Market

- total symbols；
- fresh symbols；
- quote fresh ratio；
- kline fresh ratio；
- pool book fresh ratio；
- gaps by type；
- reconnects；
- recovery success；
- recovery failure；
- recovering sample ratio。

## Selection

- Universe；
- Eligible；
- Pool target/current；
- Pool refill count；
- candidate turnover；
- unique symbols analyzed；
- cooldown count。

## AI

- Scout completed / failed；
- Primary completed / failed；
- Direction LONG；
- Direction SHORT；
- PLACE_LONG；
- PLACE_SHORT；
- REJECT_CANDIDATE；
- AI_FAILED；
- unique symbols；
- repeat symbol rate；
- idle intervals；
- longest unexplained idle；
- burst distribution；
- queue depth；
- P50/P95 latency；
- token totals。

## Entry

- AI PLACE total；
- Entry Intent total；
- Entry blocked；
- block reason distribution；
- Maker placement；
- reprices；
- cancels；
- Binance submissions；
- Binance orderIds；
- fills。

## Position

- total positions；
- AUTO_MANAGED；
- HUMAN_MANAGED；
- entryTime source distribution。

## TP

- positions requiring TP；
- TP_PROTECTED；
- TP_MISSING；
- TP_REPAIRING；
- repair attempted；
- repair success；
- repair failed。

## Runtime

- NO_ENTRY_REASON distribution；
- fatal；
- exit code；
- sample count；
- failed samples。

---

# 28. 最终 PASS 逻辑必须真实

不能只因为：

```text
process alive
exitCode=0
```

就 PASS。

至少要求：

- fatal=0；
- build/tests/typecheck PASS；
- Market 基础设施稳定；
- no sustained global recovery；
- Universe/Eligible/Pool 不因系统故障长期归零；
- AI 有候选时可以持续消费；
- no unexplained >10m idle；
- Raw / Normalized decision 一致；
- no Raw REJECT → PLACE；
- no AI_FAILED → PLACE；
- Entry chain 无静默丢失；
- active order projection 一致；
- TP missing 可观测且 repair 正常；
- Production Mock=0；
- auto stop-loss=0。

---

# 29. 最终成功不以“必须下单”为单一条件

不能为了验收制造订单。

允许真实市场最终：

```text
REJECT_CANDIDATE
```

但必须满足：

- direction 明确；
- raw response 可查；
- reject reason 可查；
- candidate turnover 正常；
- AI 没有系统性失效。

同理，如果出现 PLACE：

必须完整到：

```text
Primary Raw PLACE
→ Normalized PLACE
→ Entry Intent
→ Entry Manager
→ Binance
```

---

# 30. 正式交付冻结条件

只有全部满足才冻结 V3.2.0：

1. 普通 TODO / PARTIAL / PENDING = 0；
2. typecheck PASS；
3. tests PASS；
4. build PASS；
5. browser UI PASS；
6. Market稳定；
7. Selection持续运行；
8. AI 调度无无解释长时间闲置；
9. Direction 100% 可见；
10. Decision 审计完整；
11. Raw / Normalized 一致；
12. Entry 无静默丢单；
13. CANCELED 不占 active orders；
14. 账户资产真实；
15. TP coverage 可观测；
16. 缺 TP 可修复/告警；
17. Human Handoff 正确；
18. 无自动止损；
19. Production Mock path=0；
20. Production private write 未经显式切换保持 blocked；
21. 60 分钟 acceptance 完成；
22. Codex 自行发现的普通生产缺陷清零。

完成后冻结基础平台。

后续版本只依据真实运行数据优化：

- Universe 权重；
- Pool质量；
- Scout效率；
- Primary Prompt；
- Entry价格效率；
- TP策略质量；
- 成交率与盈利质量。

不再反复改基础架构。

---

# 31. Codex 最终交付报告格式

最终只输出一份简洁报告：

## Version
`3.2.0`

## Validation
- typecheck
- tests
- build
- acceptance

## Runtime
- Engine PID
- Dashboard URL
- Environment
- Proxy
- Binance Public
- Binance Private

## Market / Selection
- Universe
- Eligible
- Pool
- freshness

## AI
- Scout / Primary
- Direction distribution
- Decision distribution
- idle/burst
- raw-normalized consistency

## Entry
- PLACE
- Intents
- Binance submitted
- Filled
- blocked reasons

## Position / TP
- positions
- AUTO/HUMAN
- TP protected/missing/repair

## Remaining
必须是：

```text
普通未完成项：0
```

External gate 如果存在，单独列出。

---

# 32. Codex 最终执行原则

执行循环：

```text
调查真实代码/运行事实
→ 修改
→ 定向测试
→ 更新进度
→ 搜索剩余 TODO/PARTIAL/PENDING
→ 继续
```

禁止：

```text
完成一个子任务
→ 写 checkpoint
→ 退出
```

只有本计划全部完成并通过最终 acceptance 才允许结束。

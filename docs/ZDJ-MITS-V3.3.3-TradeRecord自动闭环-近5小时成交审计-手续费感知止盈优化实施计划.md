# ZDJ-MITS V3.3.3
## TradeRecord 自动闭环、近5小时成交审计与手续费感知止盈优化实施计划

> 项目目录：`D:\MITS`
> 基线：当前 ZDJ-MITS V3.3.x
> 本轮目标：一次性解决两个生产问题：
> 1. 系统运行期间已经发生自然建仓/平仓，但本地 TradeRecord 仍为 0；
> 2. 部分平仓毛收益为正，但扣除建仓+平仓手续费后净收益为负或过低，说明 TP 目标没有把真实交易成本作为硬约束。
>
> 本轮不重构 Market / Pool / Scout / Primary 主架构，只增强：
> `交易生命周期 → 本地交易记录 → 净收益核算 → Experience → Fee-aware TP`

---

# 一、先做最近5小时 Binance Testnet 只读成交审计

通过现有 Private Adapter / Exchange Adapter 拉取最近5小时：

- user trades / fills；
- all orders（必要时）；
- realized PnL / income；
- commission；
- current positions；
- current open orders。

时间窗口：`now - 5h → now`。

本次拉取属于 **ONE-OFF READ-ONLY DIAGNOSTIC**，禁止演变成每次 Engine 启动自动导入历史成交。

输出：

- `docs/reports/ZDJ-MITS-V3.3.3-最近5小时成交与TradeRecord缺失审计报告-YYYY-MM-DD.md`
- `data/diagnostics/trade-audit-5h/<timestamp>/`

每条成交至少记录：

- symbol / side / positionSide；
- orderId / clientOrderId / tradeId；
- executionTime；
- qty / price；
- realizedPnl；
- commission / commissionAsset；
- maker/taker；
- 本地 Intent / Audit / TradeRecord 关联情况；
- SYSTEM / MANUAL / EXTERNAL 来源判断。

---

# 二、按“完整交易生命周期”重建最近5小时事实

不能把每一个 Fill 当成一条交易记录。

必须按：

`symbol + positionSide + qty变化 + orderId/clientOrderId + 本地Intent/Audit`

重建：

`Flat → Entry Fill → Position Open → Add/Reduce → Full Close → Flat`

支持：

- partial fill；
- 多次补仓；
- 部分减仓；
- 多个 Exit Fill；
- TP Close；
- Manual Close；
- Engine restart 期间的 close；
- imported position。

一条完整 Cycle 才对应一条 TradeRecord。

如果能明确证明某笔最近5小时成交：

- 是当前系统自己创建；
- clientOrderId / intentId / audit 可关联；
- 本地只是因为生命周期监听缺陷漏记；

允许幂等修复 TradeRecord，并标记：

`source=LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT`

禁止把外部/人工历史错误写成系统策略样本。

---

# 三、彻查 TradeRecord 为什么一直为 0

逐链审计：

`AI PLACE → Entry Intent → Entry Order → Entry Fill → Position → TP Fill/Manual Close → Position Qty=0 → TradeRecord CLOSED → Experience Sample`

重点检查：

## 3.1 User Data Stream

是否正确消费：

- `ORDER_TRADE_UPDATE`；
- `ACCOUNT_UPDATE`；
- Entry Fill；
- Partial Fill；
- TP Fill；
- Position Qty decrease；
- Position Qty → 0。

## 3.2 Reconciliation

检查当前 reconciliation 是否只同步“现在有多少仓位”，却没有产出 lifecycle transition。

必须支持：

`previousQty > 0 && currentQty == 0 → POSITION_CLOSED_DETECTED`

并触发 TradeRecord finalize。

## 3.3 TP Guardian

检查 TP 成交后是否只是“TP 订单消失”，却没有向 lifecycle / TradeRecord 层发布 Position Closed 事实。

## 3.4 TradeRecord Builder

检查是否只监听某一条理想路径（例如本地 TP_FILLED），导致：

- WS race；
- restart；
- reconciliation close；
- manual close；
- partial reduce；

无法完成 TradeRecord。

## 3.5 Restart-safe

OPEN TradeCycle 必须持久化。

Engine 重启后不得丢失 open cycle；后续自然平仓必须仍能 CLOSED。

---

# 四、建立/强化 PositionLifecycleTracker

以：

`exchange + symbol + positionSide`

为 key。

持久化：

- previousQty；
- currentQty；
- openedAt；
- firstObservedAt；
- entryOrderIds / entryTradeIds；
- exitOrderIds / exitTradeIds；
- cycleId；
- source；
- lastReconciledAt。

状态变化：

- `0 → >0 = OPEN`
- `>0 → larger = INCREASE`
- `>0 → smaller = REDUCE`
- `>0 → 0 = CLOSE`

User Data Stream 是实时首选；Reconciliation 是兜底。

任何 CLOSE 最多一个 reconciliation 周期内必须尝试 finalize TradeRecord。

---

# 五、TradeRecord 必须使用真实成交和真实手续费

CLOSED TradeRecord 优先使用 Binance 实际：

- fill price；
- fill qty；
- realizedPnl；
- entry commission；
- exit commission。

至少保存：

- entryGrossNotional；
- exitGrossNotional；
- entryFees；
- exitFees；
- totalFees；
- grossRealizedPnl；
- netPnl；
- netRoiOnMargin；
- netReturnOnNotional；
- entryFillCount；
- exitFillCount。

统一口径：

`netPnl = grossRealizedPnl - entryFees - exitFees`

如果手续费资产不是 USDT/USDC：

- 保留原 commissionAsset/amount；
- 用可靠行情换算 USD；
- 保存 conversion source。

---

# 六、专项分析“毛盈利但净亏损”

最近5小时所有完整 CLOSED Cycle 分类：

## A 真正盈利
`netProfit > 0`

## B 伪盈利
`grossProfit > 0 && netProfit <= 0`

## C 低价值盈利
`0 < netProfit < minNetProfitFloor`

输出：

- 数量/占比；
- symbol；
- 平均 gross；
- 平均 fee；
- 平均 net；
- TP 距离；
- maker/taker；
- 持仓时长。

报告必须列出最典型的低质量退出样本。

---

# 七、手续费过高不能默认归咎于 TP 太近

必须同时审计：

- Entry 是否真正 Maker；
- Exit/TP 是否真正 Maker；
- 是否有 taker fallback；
- conditional TP 最终是否以 taker 成交；
- 是否频繁 cancel/reprice；
- partial fill 是否增加成本；
- 小仓位是否让固定美元收益门槛失真；
- leverage / margin / notional 是否被混淆。

---

# 八、建立统一 TradingCostModel

新增/强化单一事实源：

`TradingCostModel`

输入：

- entryPrice；
- qty；
- direction；
- entryFeeRate；
- expectedExitFeeRate；
- maker/taker assumption；
- expectedSlippage；
- feeSafetyBuffer。

输出：

- estimatedEntryFee；
- estimatedExitFee；
- estimatedTotalFee；
- breakEvenPrice；
- minProfitableExitPrice；
- expectedNetProfit。

支持：

- maker → maker；
- maker → taker worst-case。

禁止 TP Guardian、Entry Manager、UI 各自计算不同版本。

---

# 九、TP 改为“手续费感知 + 净收益感知”

新 TP 必须满足：

`ExpectedNetProfit = ExpectedGrossProfit - EstimatedEntryFee - EstimatedExitFee - SlippageBuffer`

且：

`ExpectedNetProfit >= RequiredNetProfit`

新增设置：

- Min Net Profit USD；
- Min Net Profit ROI %；
- Fee Safety Buffer %；
- Exit Fee Assumption；
- Slippage Buffer；
- TP Economics Enabled。

建议逻辑：

`requiredNetProfit = max(minNetProfitUsd, marginUsed × minNetProfitRoiPct)`

**默认值不要由 Codex 拍脑袋。**

可以评估 `$5` 作为默认 `Min Net Profit USD` 候选，但必须先用最近5小时真实 position size / margin / fee 做敏感性分析后决定。

---

# 十、同时展示三种收益口径

因为系统使用杠杆，必须避免混淆：

- Net USD；
- Net ROI on Margin；
- Net Return on Notional。

例如 Margin 200 USDT、20x、Notional约4000 USDT：

5 USDT 净收益 ≈ 2.5% margin ROI，而不是 2.5% notional。

---

# 十一、TP 最终目标 = 成本底线 + 市场结构

成本模型决定：

**最低不能低于多少。**

市场结构决定：

**值得把 TP 放在哪里。**

最终结合：

- 15m trend；
- ATR；
- Bollinger；
- swing；
- support/resistance；
- reachable range；
- liquidity。

如果旧策略计算出的 TP：

`expectedNet < requiredNet`

禁止直接创建该 TP。

状态：

`TP_TARGET_BELOW_NET_FLOOR`

调整到最低盈利价格后再检查市场结构。

如果目标明显不可达：

`TP_TARGET_UNREALISTIC`

不能为了“有 TP”而创建一个手续费后必亏的 TP。

---

# 十二、TP 重算时机

以下事件必须重新评估 TP economics：

- Entry first fill；
- partial fill；
- add position；
- manual add；
- manual reduce；
- entry average 改变；
- fee rate 改变；
- position qty 改变。

---

# 十三、已有持仓不要直接批量改 TP

本轮先对当前 Position 做只读审计：

- current TP expected gross；
- expected fees；
- expected net；
- required net。

分类：

- TP_OK；
- TP_LOW_NET；
- TP_NET_NEGATIVE；
- TP_DATA_INCOMPLETE。

默认不要批量修改当前所有既有 TP。

新算法自动应用于：

- 新 Entry；
- 新 TP repair；
- manual add/reduce 后；
- Position qty 变化后。

---

# 十四、交易记录必须开始自动产生

修复后任意自然：

`Position > 0 → Position = 0`

最多一个 reconciliation 周期内必须出现 CLOSED TradeRecord。

随后：

- 驾驶舱“交易记录净收益”更新；
- Experience Sample 增加。

不能依赖用户打开页面才落库。

---

# 十五、TradeRecord Integrity Check

新增周期性完整性巡检：

发现：

`Position lifecycle 已关闭，但没有 CLOSED TradeRecord`

产生：

`TRADE_RECORD_MISSING`

恢复顺序：

1. 本地 fills；
2. audit；
3. lifecycle snapshot；
4. 必要时仅针对该 cycle 查询 Binance recent trades。

幂等补写并记录 repair audit。

禁止每次扫描 30 天历史。

---

# 十六、交易记录 UI 改为以“净收益”为权威

确认/新增列：

- 毛收益；
- 建仓手续费；
- 平仓手续费；
- 总手续费；
- **净收益**；
- Net ROI。

颜色必须依据净收益。

如果：

`gross +2 / fees 3 / net -1`

必须显示：

`净收益 -$1.00` 红色。

不能因为 gross>0 就显示盈利。

---

# 十七、交易记忆必须按 Net PnL 判输赢

Experience：

`winLoss = netPnl > 0 ? WIN : LOSS`

必须新增回归测试：

`gross positive + net negative → LOSS`

否则 AI 会把手续费后亏损的交易学成成功案例。

---

# 十八、驾驶舱净收益

只累计：

`CLOSED + COMPLETE + netPnl`

修复的本地系统交易，如果 exchange fact 足够完整，可以 COMPLETE。

fee 不完整的 PARTIAL 不进入主收益。

---

# 十九、Settings 增加 TP Economics

`策略与执行 → TP` 增加：

- 最低净收益 USD；
- 最低净收益 ROI %；
- 手续费安全缓冲 %；
- Exit fee assumption；
- Slippage buffer；
- TP economics enabled。

说明：

“止盈价必须覆盖建仓费 + 平仓费 + 安全缓冲，并达到最低净收益门槛。”

---

# 二十、Position Detail 增加 TP Economics

显示：

- 当前 TP；
- 预计毛收益；
- 预计手续费；
- 预计净收益；
- 最低净收益要求；
- 盈亏平衡价；
- TP economics status。

示例：

```text
预计毛收益      $8.20
预计总成本      $2.10
预计净收益      $6.10
最低要求        $5.00
状态            合格
```

或：

```text
预计净收益      -$0.80
状态            止盈价格低于成本底线
```

---

# 二十一、近5小时报告最终统计

至少输出：

- 成交 Fill 数；
- 完整 Cycle 数；
- 系统 Cycle；
- 外部/人工 Cycle；
- 本地漏记 TradeRecord；
- gross positive 数量；
- net positive 数量；
- gross positive 但 net negative 数量；
- net < $5 数量；
- 平均手续费；
- 平均 net；
- 平均持仓时长；
- maker entry %；
- maker exit %。

并列出最典型低质量退出。

---

# 二十二、测试

## Trade Lifecycle

- WS TP fill → CLOSED；
- reconciliation qty→0 → CLOSED；
- restart 后 close → CLOSED；
- partial reduce 不提前 CLOSED；
- full close 只生成一次；
- duplicate fill 不重复。

## Fee Model

- LONG；
- SHORT；
- maker/maker；
- maker/taker；
- fee buffer；
- precision rounding。

## TP

- required net USD；
- required margin ROI；
- cost floor；
- TP below floor blocked；
- add/reduce 后重算。

## Memory

`gross positive / net negative → LOSS`

---

# 二十三、真实 Testnet 验收

本轮触及 TradeRecord lifecycle 与 TP 核心算法，因此需要重新验收。

执行：

```text
npm run typecheck
npm run test
npm run build
```

然后 restart。

确认：

- `/health=READY`；
- Market LIVE；
- Binance Private READY；
- TP Guardian 正常。

运行 30~60 分钟 Testnet 验收，重点验证：

- 新 Entry；
- 新 TP；
- expectedNet >= floor；
- Position Close；
- CLOSED TradeRecord；
- Experience Sample；
- Dashboard净收益更新。

如果窗口没有自然 Close：

使用可控 Testnet 专项集成测试验证生命周期，不要强行平现有大仓位。

---

# 二十四、退出条件

只有全部满足才允许回复完成：

- 最近5小时审计报告生成；
- TradeRecord 漏记根因明确；
- PositionLifecycleTracker / reconciliation fallback 完成；
- Close→TradeRecord 闭环可靠；
- netPnl 真实扣费；
- Experience 按 netPnl；
- TradingCostModel 单一事实源；
- 新 TP 做 fee-aware net profit 校验；
- 新 TP 不低于净收益门槛；
- UI/Settings 完成；
- typecheck PASS；
- tests PASS；
- build PASS；
- browser PASS；
- Testnet acceptance PASS；
- 普通 TODO/PARTIAL/PENDING=0。

---

# 二十五、版本

完成后：

# ZDJ-MITS V3.3.3
## Trade Lifecycle Integrity & Fee-Aware Take Profit

本轮完成后：

- TradeRecord 不再依赖单一理想事件链；
- 平仓收益以净收益定义；
- TP 不再允许低于真实交易成本。

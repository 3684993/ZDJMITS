# Codex 5.6 Sol — ZDJ-MITS V3.3.3 TradeRecord闭环 + 手续费感知止盈优化执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

读取并执行：

`ZDJ-MITS-V3.3.3-TradeRecord自动闭环-近5小时成交审计-手续费感知止盈优化实施计划.md`

本轮一次性解决两个生产问题：

1. 系统运行期间已经自然建仓和平仓多笔，但“交易记录”仍为0；
2. 部分平仓毛收益为正，但扣除建仓+平仓手续费后净收益为负/过低，说明TP没有把真实交易成本作为硬约束。

不要先写新计划，直接调查、实现、测试和验收。

## 1. 先只读拉取最近5小时 Binance Testnet 成交

通过现有 Private Adapter 拉取最近5小时：

- user trades / fills
- orders（必要时）
- realized PnL / income
- commissions
- current positions/open orders

按 `symbol + positionSide + qty变化 + orderId/clientOrderId + 本地Intent/Audit` 重建完整 Cycle：

`Flat → Entry → Position → Reduce/Add → Full Close → Flat`

统计：

- 完整Cycle
- 系统Cycle
- 外部/人工Cycle
- 本地漏记TradeRecord
- gross positive
- net positive
- gross positive但net<=0
- net<$5
- maker entry/exit比例
- 平均fee/gross/net

本次5小时拉取是 ONE-OFF READ-ONLY DIAGNOSTIC，不允许变成启动时自动历史导入。

只有能证明是当前系统自己产生、且因生命周期缺陷漏记的 Cycle，才允许幂等修复本地 TradeRecord，并标 repair source。

## 2. 彻查 TradeRecord 为0的根因

逐链检查：

`AI PLACE → Entry Intent → Entry Order → Entry Fill → Position → TP Fill/Manual Close → Position Qty=0 → TradeRecord CLOSED → Experience`

重点：

- ORDER_TRADE_UPDATE
- ACCOUNT_UPDATE
- TP fill
- position qty decrease
- position qty→0
- reconciliation
- Engine restart
- partial fill / partial reduce
- manual close

建立/强化 PositionLifecycleTracker：

- 0→>0 OPEN
- >0→larger INCREASE
- >0→smaller REDUCE
- >0→0 CLOSE

User Data WS 实时优先；Reconciliation 必须兜底。

任何真实 CLOSE 最多一个 reconciliation 周期内必须生成 CLOSED TradeRecord。

OPEN cycle 必须 restart-safe。

增加 TradeRecord Integrity Check：发现 lifecycle 已关闭但没有记录时，优先从本地 fill/audit 恢复；必要时只针对该 cycle 查询 Binance recent trades，禁止扫描30天。

## 3. TradeRecord 必须使用真实成交和手续费

统一：

`netPnl = grossRealizedPnl - entryFee - exitFee`

保存：

- actual fill price/qty
- entry fee
- exit fee
- total fee
- gross
- net
- net ROI on margin
- return on notional

手续费资产非USDT/USDC时保留原asset/amount并可靠折算USD。

交易记录和Experience盈亏都必须以 netPnl 为准。

必须测试：

`gross>0 && fees>gross → net<0 → LOSS`

## 4. 建立统一 TradingCostModel

单一事实源输入：

- entryPrice
- qty
- direction
- entry fee rate
- expected exit fee rate
- maker/taker assumption
- slippage
- fee safety buffer

输出：

- estimated entry fee
- estimated exit fee
- total cost
- break-even price
- minimum profitable exit price
- expected net profit

支持 maker→maker 和 maker→taker worst-case。

禁止 TP Guardian / Entry Manager / UI 各算一套。

## 5. TP 改为手续费感知 + 净收益感知

新 TP 必须满足：

`ExpectedNetProfit = ExpectedGrossProfit - EntryFee - ExitFee - SlippageBuffer`

且：

`ExpectedNetProfit >= RequiredNetProfit`

增加设置：

- Min Net Profit USD
- Min Net Profit ROI %
- Fee Safety Buffer %
- Exit fee assumption
- Slippage buffer

建议：

`requiredNetProfit = max(minNetProfitUsd, marginUsed * minNetProfitRoiPct)`

不要擅自拍脑袋决定默认比例。

可以评估 $5 作为默认 Min Net Profit USD 候选，但先根据最近5小时真实仓位/保证金/手续费做敏感性分析。

## 6. TP = 成本底线 + 市场结构

成本模型决定最低盈利价；市场结构决定最终目标价。

结合：

- 15m trend
- ATR
- BB
- swing
- support/resistance
- reachable range
- liquidity

如果旧策略 TP 的 expectedNet < requiredNet：

禁止创建。

标记：

`TP_TARGET_BELOW_NET_FLOOR`

调整到最低盈利价格后再检查市场结构。

若明显不可达：

`TP_TARGET_UNREALISTIC`

不能为了“有TP”而创建手续费后必亏的TP。

## 7. 既有仓位先审计，不批量乱改

对当前持仓只读计算：

- current TP expected gross
- expected fees
- expected net
- required net

分类：

- TP_OK
- TP_LOW_NET
- TP_NET_NEGATIVE
- TP_DATA_INCOMPLETE

默认不要批量改所有既有 TP。

新算法应用到：

- 新Entry
- 新TP repair
- manual add/reduce后
- Position qty变化后

## 8. 前端

交易记录页显示：

- 毛收益
- 建仓手续费
- 平仓手续费
- 总手续费
- 净收益
- Net ROI

颜色以净收益为准。

Position Detail 增加 TP Economics：

- 当前TP
- 预计毛收益
- 预计手续费
- 预计净收益
- 最低要求
- break-even price
- TP economics status

Settings → 策略与执行 → TP 增加上述净收益/成本参数。

## 9. 测试

补：

- WS TP fill → CLOSED
- reconciliation qty→0 → CLOSED
- restart后 close → CLOSED
- partial reduce不提前CLOSED
- duplicate fill不重复
- LONG/SHORT fee model
- maker/maker
- maker/taker
- cost floor
- TP below floor blocked
- add/reduce后TP重算
- gross positive但net negative → LOSS

然后：

`npm run typecheck → npm run test → npm run build → restart`

## 10. Testnet验收

本轮触及 TradeRecord 和 TP 核心逻辑，运行30~60分钟Testnet验收。

重点验证：

- 新Entry
- 新TP
- expectedNet >= floor
- Position Close
- CLOSED TradeRecord
- Experience Sample
- Dashboard净收益

如果窗口没有自然 close，不要强行平现有大仓位；用可控 Testnet 专项集成测试验证完整生命周期。

## 退出规则

普通 TODO/PARTIAL/PENDING 未清零前禁止 checkpoint 停止。

只有：

- 5小时成交审计完成
- TradeRecord漏记根因修复
- CLOSE→TradeRecord闭环可靠
- netPnl真实扣费
- Experience按netPnl
- Fee Model统一
- 新TP满足净收益底线
- UI/settings完成
- typecheck/test/build PASS
- browser PASS
- Testnet验收 PASS

才允许最终回复。

现在直接调查并实施。

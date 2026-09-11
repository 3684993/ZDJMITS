# Codex 5.6 Sol — ZDJ-MITS V3.3.5 人工减仓 / 紧急平仓热修复执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

读取并执行：

`ZDJ-MITS-V3.3.5-人工减仓-紧急平仓-ClientOrderId热修复实施计划.md`

本轮只修人工减仓/紧急平仓，不重构 Market / Pool / AI / Entry 主链。

当前真实错误：

`Binance -4015: Client order id length should be less than 36 chars`

必须先修服务端真实下单链：

1. 内部 manualIntentId 与 Binance clientOrderId彻底分离；
2. 新增统一 BinanceClientOrderIdFactory；
3. 所有 Binance人工订单 clientOrderId <=35、字符合法、唯一；
4. Adapter调用前 fail-fast assert；
5. 本地保存 manualIntentId↔binanceClientOrderId↔exchangeOrderId。

减仓默认：

- qty=当前真实仓位100%
- priceMode=COUNTERPARTY
- LONG减仓 SELL @ best bid
- SHORT减仓 BUY @ best ask
- LIMIT
- reduceOnly=true
- PostOnly=false

前端预填，提交时服务端重新读取最新position/bid/ask/precision/minNotional。
用户默认只需打开减仓→确认→提交。

100%减仓识别为full close；partial reduce成交后必须同步剩余qty和TP qty。

紧急平仓实现三阶段状态机：

Phase1：
- Maker限价
- LONG SELL best ask
- SHORT BUY best bid
- reduceOnly + PostOnly
- 等60秒

超时：
必须先cancel旧单→等终态→reconcile remaining qty→确认无旧close order→Phase2

Phase2：
- 对手价限价
- LONG SELL best bid
- SHORT BUY best ask
- reduceOnly
- PostOnly=false
- 等60秒

再次超时：
cancel→终态→reconcile→重新计算 projectedNetAfterMarketClose

Phase3：
只有：

`projectedNetAfterMarketClose >= 0`

才允许 reduce-only MARKET。

projectedNet必须考虑：
- 当前可实现gross
- entry fees
- estimated market exit fee
- slippage buffer

如果 projectedNet<0：
状态 `MARKET_CLOSE_BLOCKED_BY_LOSS`
禁止自动Market close。

Emergency close必须 HUMAN ONLY，禁止 AI/Scheduler/亏损阈值自动调用。

TP互锁：

- emergency开始 manualExitLock=true
- TP Guardian期间不得repair/create
- 成功close后 Position=0→清残余TP→TradeRecord CLOSED→release lock
- BLOCKED/用户中止且Position仍存在→release lock→恢复TP保护

持久化状态机并支持Engine重启恢复。

UI必须显示：
- 减仓默认100%数量与对手价
- 紧急平仓三阶段说明
- 当前阶段/等待秒数/orderId/remaining qty
- Phase1/2可停止
- projectedNet<0时中文说明为什么未执行Market

补测试：
- clientOrderId长度/字符/唯一性
- reduce默认100%
- LONG/SHORT对手价
- Phase1成功
- Phase1 timeout→cancel→Phase2
- Phase2成功
- Phase2 timeout+盈利→Market
- Phase2 timeout+亏损→BLOCKED，不发Market
- partial fill remaining qty
- restart recovery
- user abort
- no duplicate close
- TP restore
- TradeRecord联动

然后：

`npm run typecheck`
→ `npm run test`
→ `npm run build`
→ restart

用可控小 Testnet Position真实验证一次人工减仓：

- 不再-4015
- clientOrderId<36
- Binance orderId成功返回

Emergency三阶段优先用Mock/Fake Exchange+小Testnet仓位专项验证，不对现有大仓位做无必要操作。

做15~30分钟专项smoke即可；除非你实际修改了Scheduler/Market/AI主链，否则不重跑完整AI 60分钟。

普通TODO/PARTIAL/PENDING未清零前禁止checkpoint停止。

最终报告必须明确：
- -4015根因
- clientOrderId最终格式/最大长度
- manual reduce真实Testnet结果
- Phase1/2/3测试结果
- projectedNet<0是否确实阻止Market
- TP lock/recovery结果
- TradeRecord联动结果

现在直接调查并实施，不先写新计划。

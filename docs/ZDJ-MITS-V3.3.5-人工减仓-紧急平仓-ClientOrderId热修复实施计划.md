# ZDJ-MITS V3.3.5
## 人工减仓 / 紧急平仓执行链与 Binance ClientOrderId 热修复实施计划

> 项目：`D:\MITS`
> 基线：V3.3.4
> 本轮只修人工减仓/紧急平仓，不重构 Market / Pool / AI / Entry 主链。

## 1. 修复 Binance -4015

当前错误：

`Client order id length should be less than 36 chars`

必须把内部 `manualIntentId` 与 Binance `newClientOrderId` 分离。

新增统一 `BinanceClientOrderIdFactory`：

- 长度严格 <=35；
- 字符合法；
- 唯一；
- 带动作前缀；
- 本地保存 `manualIntentId ↔ binanceClientOrderId ↔ exchangeOrderId` 映射。

建议格式：

- `mr_<base36time>_<hash8>`：manual reduce
- `mc_<base36time>_<hash8>`：manual close
- `ma_<base36time>_<hash8>`：manual add
- `tp_<base36time>_<hash8>`：TP

调用 Exchange Adapter 前必须 assert `length <= 35`。

静态搜索并统一所有 `newClientOrderId/clientOrderId` 生成逻辑，避免其它人工/TP路径继续触发 -4015。

---

## 2. 减仓默认行为

点击“减仓”时默认：

- 数量 = 当前真实持仓数量 100%
- 价格模式 = 对手价

LONG 持仓减仓：
- side=SELL
- 对手价=best bid

SHORT 持仓减仓：
- side=BUY
- 对手价=best ask

前端只显示预览；提交时服务端必须重新读取最新：

- position qty
- bid/ask
- tickSize
- stepSize
- minQty
- minNotional
- private readiness

用户默认流程：

`打开减仓 → 检查数量/价格 → 确认提交`

仍允许 25% / 50% / 75% / 100% / 自定义。

对手价单：
- LIMIT
- reduceOnly=true
- PostOnly=false

Maker 模式保留：
- LONG close SELL → best ask + PostOnly
- SHORT close BUY → best bid + PostOnly

部分减仓成交后：
`Reconciliation → remaining qty → TP Guardian → TP qty同步`

100% 减仓识别为 full manual close，与 TP Guardian 协调，防止重复退出。

---

## 3. 紧急平仓三阶段

紧急平仓只能由用户显式触发，不得成为自动止损。

### Phase 1：Maker 限价，等待60秒

LONG：
- SELL
- best ask
- LIMIT
- reduceOnly
- PostOnly

SHORT：
- BUY
- best bid
- LIMIT
- reduceOnly
- PostOnly

若完全成交 → DONE。

若60秒超时：
1. cancel Phase1 order
2. 等 Binance 确认终态
3. reconciliation 获取剩余 qty
4. 确认没有旧 close order
5. 才进入 Phase2

### Phase 2：对手价限价，等待60秒

LONG：
- SELL
- best bid
- LIMIT
- reduceOnly
- PostOnly=false

SHORT：
- BUY
- best ask
- LIMIT
- reduceOnly
- PostOnly=false

若完全成交 → DONE。

若60秒超时：
1. cancel Phase2
2. 等终态
3. reconcile
4. 获取 remaining qty
5. 重新计算预计市价退出净收益
6. 决定是否进入 Phase3

### Phase 3：仅“不亏损”时市价退出

必须计算：

`projectedNetAfterMarketClose = 当前可实现毛PnL - 已知EntryFee - 预计MarketExitFee - SlippageBuffer`

只有：

`projectedNetAfterMarketClose >= 0`

才允许：

- MARKET
- reduceOnly=true
- qty=最新 remaining qty

如果 projectedNet < 0：

状态：

`MARKET_CLOSE_BLOCKED_BY_LOSS`

禁止自动市价平仓。

UI明确提示：

“前两阶段均超时，当前预计市价退出净收益为负，因此未执行市价平仓。”

---

## 4. TP Guardian 互锁

Emergency Close 开始：

`manualExitLock=true`

期间：
- TP Guardian 不得 repair/create 新 TP；
- 先安全处理当前 TP；
- 任一阶段不得同时存在两张 active full-close order。

若最终平仓成功：

`Position=0 → 清理残余TP → TradeRecord CLOSED → Experience → release lock`

若：
- BLOCKED_BY_LOSS
- 用户取消

且 Position 仍存在：

`release lock → 恢复TP Guardian → ensure TP coverage`

避免紧急平仓失败后裸仓。

---

## 5. Emergency 状态机

持久化：

- REQUESTED
- PHASE1_MAKER_SUBMITTED
- PHASE1_WAITING
- PHASE1_TIMEOUT
- PHASE1_CANCELING
- PHASE2_COUNTERPARTY_SUBMITTED
- PHASE2_WAITING
- PHASE2_TIMEOUT
- PHASE2_CANCELING
- PHASE3_MARKET_ELIGIBILITY_CHECK
- PHASE3_MARKET_SUBMITTED
- COMPLETED
- BLOCKED_BY_LOSS
- CANCELED_BY_USER
- FAILED

Engine 重启后必须能够恢复状态。

---

## 6. UI

### 减仓

默认显示：

- 当前仓位
- 默认减仓数量=100%
- 价格模式=对手价
- 当前预计价格

### 紧急平仓确认框

明确显示：

1. Maker限价，等待60秒
2. 对手价限价，等待60秒
3. 若预计净收益>=0，市价退出

执行中显示：

- 当前阶段
- 已等待秒数
- orderId
- remaining qty
- 当前状态

Phase1/2 允许“停止紧急平仓”。

---

## 7. 错误产品化

不再直接把 Binance 原始 JSON 作为主提示。

主界面显示中文错误，原始 code/message 放折叠详情。

V3.3.5 验收后，-4015 必须彻底消失。

---

## 8. 测试

### ClientOrderId
覆盖：
- reduce
- close
- add
- TP
- 长内部 intent id
- <=35
- 合法字符
- 唯一性

### Reduce
覆盖：
- default qty 100%
- LONG counterpart best bid
- SHORT counterpart best ask
- partial/full
- TP qty sync

### Emergency
使用 fake clock：
- Phase1 success
- Phase1 timeout → cancel → Phase2
- Phase2 success
- Phase2 timeout + projectedNet>=0 → Market
- Phase2 timeout + projectedNet<0 → BLOCKED_BY_LOSS
- partial fill只处理remaining qty
- restart recovery
- user abort
- no duplicate active close
- blocked/abort后TP恢复

---

## 9. Testnet 专项验收

执行：

- `npm run typecheck`
- `npm run test`
- `npm run build`

全部 PASS。

重启确认：

- `/health=READY`
- Market LIVE
- Private READY
- TP healthy

用可控小 Testnet Position 真实验证一次 manual reduce：

- 不再 -4015
- clientOrderId <36
- Binance orderId 正常返回

Emergency 三阶段优先使用 Mock/Fake Exchange + 可控小仓位验证，不对用户大仓位做无必要操作。

本轮做 15~30 分钟专项 smoke，无需重跑完整 AI 60 分钟验收，除非实际修改 Scheduler/Market/AI 主链。

---

## 10. 与 TradeRecord 联动

Partial reduce：
- 不 finalize TradeRecord。

Full close / emergency close：
- Position=0
- TradeRecord CLOSED
- fees补齐
- Experience更新
- Dashboard净收益更新

继续使用 V3.3.4 canonical/completeness 规则。

---

## 11. 建议设置项

`策略与执行 → 人工持仓管理`

增加：

- 紧急平仓 Maker 等待秒数：默认60
- 紧急平仓 对手价等待秒数：默认60
- 市价退出最低预计净收益 USD：默认0

这些设置只影响人工紧急平仓，禁止影响 AI 自动交易。

---

## 12. 退出条件

必须全部满足：

1. -4015 根因修复
2. 所有人工订单 clientOrderId <=35
3. 减仓默认100%当前qty
4. 减仓默认对手价
5. LONG/SHORT 对手价方向正确
6. 一键确认可提交
7. Phase1 Maker 60s
8. 超时先取消旧单
9. Phase2 对手价 60s
10. 超时再次取消旧单
11. projectedNet>=0 才允许 Market
12. projectedNet<0 不发 Market
13. partial fill只处理remaining qty
14. 无重复close订单
15. TP lock/recovery正确
16. Position=0 后无orphan TP
17. TradeRecord联动
18. Audit完整
19. typecheck PASS
20. tests PASS
21. build PASS
22. browser PASS
23. Testnet专项验证 PASS
24. 普通 TODO/PARTIAL/PENDING=0

完成后版本：

# ZDJ-MITS V3.3.5
## Manual Reduce & Emergency Close Execution Hotfix

# ZDJ-MITS V3.3.4
## TradeRecord 数据清洗、分类、去重与手动同步热修复实施计划

> 项目：`D:\MITS`
> 基线：V3.3.3
> 本轮范围：TradeRecord 数据可信度、手动同步、分类展示、去重、ROI/手续费异常修复。
> 不重构 Market / Pool / AI / Entry / TP 主链。

---

## 1. 当前问题

当前交易记录页存在明确异常：

- 总记录很多，但真正 `CLOSED + COMPLETE` 很少；
- 多条 `CLOSED` 没有 Exit；
- 手续费未知却显示 `$0.00`；
- 毛/净收益出现接近 `-$4000`；
- Net ROI 出现固定 `±2000%`；
- `IMPORTED_OPEN_POSITION` 与正式完整交易混在一起；
- 用户无法判断哪些记录可信、哪些只是历史导入/修复中事实。

本轮目标是让 TradeRecord 变成长期可信账本，而不是“所有生命周期事实混在一个表”。

---

## 2. 最终分类

### COMPLETE
只有满足以下全部条件：

- Entry facts 完整；
- Exit facts 完整；
- Position qty 生命周期已闭合；
- Fee facts 完整；
- Net PnL 可计算；

才能：

`status=CLOSED + recordCompleteness=COMPLETE`

只有此类进入：
- 驾驶舱净收益；
- Experience；
- 默认交易记录页。

### PARTIAL / INCOMPLETE
缺 Entry / Exit / Fee / Qty closure 中任何一项。

不得伪装成完整 CLOSED。

### IMPORTED_OPEN_POSITION
系统启动时已存在的持仓，只是首次观察事实，不是完整策略交易。

### EXTERNAL / UNMANAGED
外部/人工/其它工具成交，无法关联系统 Intent 的，只进入审计。

### DUPLICATE / CONFLICT
同一 lifecycle 重复生成多条记录时，选择 canonical record，其它记录保留审计但不进入收益和 Experience。

---

## 3. 先审计当前全部 TradeRecord

Codex 必须直接读取当前 SQLite，逐条检查：

- tradeId / cycleId
- symbol / direction / positionSide
- entryOrderIds / exitOrderIds
- entryTradeIds / exitTradeIds
- openedAt / closedAt
- entry/exit price
- qty
- fee
- gross/net PnL
- margin / ROI
- source / repair source
- completeness

输出：

- total
- complete
- partial
- imported
- external
- duplicate
- conflict
- invalidClosed
- invalidRoi
- missingExit
- missingFee

---

## 4. 修复错误 CLOSED

以下情况不能成为 `CLOSED + COMPLETE`：

- closedAt 有值但 Exit price 缺失；
- exitFillCount=0；
- qty 未真正归零；
- fee unknown；
- lifecycle 事实不完整。

允许：

`CLOSED + PARTIAL`

但 UI 必须明确“待完善”，并说明缺失字段。

---

## 5. 修复 ±2000% ROI

必须找出代码真实根因，重点检查：

- marginUsed=0；
- notional/margin 混用；
- leverage 重复乘；
- missing exit price 当成 0；
- sentinel/clamp 被当真实值；
- imported record 使用错误默认值。

最终：

`Net ROI on Margin = netPnl / actualMarginUsed`

只有 marginUsed 可靠时显示。

否则显示：

`—`

禁止再出现用于兜底的假 `±2000%`。

---

## 6. 手续费未知不能显示 $0.00

增加/使用：

`feeCompleteness = COMPLETE | PARTIAL | UNKNOWN`

只有事实证明手续费为 0 才显示 `$0.00`。

UNKNOWN 必须显示：

`—` 或 `手续费不完整`

不得把未知值变 0。

---

## 7. 交易记录页改为 Tabs

### 完整交易
默认打开，只显示 canonical `CLOSED + COMPLETE`。

### 待完善
PARTIAL / INCOMPLETE。

### 导入持仓
IMPORTED_OPEN_POSITION。

### 外部/未托管
EXTERNAL / UNMANAGED。

### 数据问题
DUPLICATE / CONFLICT / INVALID。

顶部统计必须明确：
- 完整交易数；
- 完整交易净收益；
- 待完善数；
- 导入持仓数；
- 数据异常数。

---

## 8. 增加“同步交易记录”

交易记录页右上增加按钮：

`同步交易记录`

点击打开 Dialog。

### 时间范围
- 最近1小时
- 最近5小时
- 最近24小时
- 自定义

默认：最近5小时。

### 最大 fills
- 100
- 300
- 500
- 1000

默认：500。

### 默认同步范围
- 仅系统可关联订单
- 修复缺失 TradeRecord
- 更新 PARTIAL
- 补齐手续费
- 重新计算净收益

外部/人工未关联默认关闭。

---

## 9. 必须 Preview → Confirm → Apply

禁止点击后直接改库。

Preview 必须只读，显示例如：

- Binance fills
- system fills
- external fills
- cycles detected
- existing COMPLETE
- repairable PARTIAL
- new COMPLETE
- new PARTIAL
- duplicates
- conflicts
- unclosable
- Experience changes

用户确认后才 Apply。

---

## 10. Apply 必须幂等

同一个时间范围同步 10 次，不能产生 10 份 TradeRecord。

去重事实至少使用：

- exchange
- account
- tradeId
- orderId
- cycleId
- symbol
- positionSide

规则：

- 已有 COMPLETE → skip
- PARTIAL + 新完整事实 → upgrade
- EXTERNAL → 默认 skip
- IMPORTED_OPEN → 不得错误 CLOSED

---

## 11. Canonical TradeRecord

同一生命周期出现多条记录时：

优先：
1. COMPLETE
2. facts 最完整
3. exchange IDs 最完整
4. provenance 最可信
5. 更早建立的 canonical

其它记录：

`duplicateOf = canonicalTradeId`

不参与：
- Dashboard net PnL
- Experience
- 默认 COMPLETE 列表

但保留审计，不直接物理删除。

---

## 12. 同步历史

新增：

- `TRADE_SYNC_PREVIEW`
- `TRADE_SYNC_APPLIED`
- `TRADE_SYNC_SKIPPED`
- `TRADE_SYNC_DUPLICATE`
- `TRADE_SYNC_CONFLICT`
- `TRADE_RECORD_REPAIRED`

交易记录页显示：

- 最后同步时间；
- 最近同步 fills/cycles；
- 新增 / 修复 / 跳过 / 冲突数量。

---

## 13. TradeRecord Integrity Check

增加周期性只读巡检：

- CLOSED 无 Exit
- COMPLETE 无 Fee
- duplicate cycle
- impossible ROI
- COMPLETE 无 Experience
- position flat 但 cycle OPEN
- closed cycle 无 TradeRecord

本地事实足够的可以幂等修复。

需要 Binance 历史事实的，等待手动同步。

Engine 启动仍禁止自动扫 30 天历史。

---

## 14. TradeRecord Detail 显示数据可信度

详情增加：

- record completeness
- fee completeness
- source
- repair source
- linked Binance fills
- local intent
- canonical
- duplicateOf
- missing facts

例如：

`PROMUSDT CLOSED + no Exit`

应显示：

- 状态：待完善
- Exit：—
- Fee：—
- Net PnL：—
- ROI：—
- 缺失：EXIT_FACT / FEE_FACT

不得再显示 `-$4000 / -2000%`。

---

## 15. 聚合收益与 Experience

驾驶舱“交易记录净收益”只统计：

- canonical=true
- status=CLOSED
- recordCompleteness=COMPLETE
- feeCompleteness=COMPLETE
- duplicate=false

Experience 同样只来自 canonical COMPLETE。

每个 canonical TradeRecord 最多一个 active Experience。

---

## 16. 手动同步 API

根据当前项目实际路由实现等价能力：

- `POST /api/v3/trade-records/sync/preview`
- `POST /api/v3/trade-records/sync/apply`
- `GET /api/v3/trade-records/sync/history`

Preview 只读。

Apply：
- transactional
- idempotent
- audited
- fail-safe

同步只允许修改本地：
- TradeRecord
- Experience
- lifecycle metadata
- sync history

禁止任何 Binance 交易写操作。

---

## 17. 备份与迁移

清洗前先备份：

- trade_records
- experience_samples
- position_lifecycle

或整个 SQLite。

Migration 必须：
- versioned
- transactional
- rollback-safe

---

## 18. 测试

必须覆盖：

### Classification
- CLOSED no exit → PARTIAL
- fee unknown → null
- imported 不进入收益
- external 不进入收益

### ROI
- missing margin → null
- valid margin → correct
- no ±2000 sentinel

### Dedup
- same cycle multiple records
- canonical selection
- duplicates excluded from totals

### Sync
- Preview no write
- Apply idempotent
- same range twice no duplicate
- PARTIAL → COMPLETE
- COMPLETE skip
- external default skip

### Experience
- canonical COMPLETE only
- duplicate no second sample

---

## 19. 浏览器验收

必须真实验证：

1. 默认只显示 COMPLETE；
2. PARTIAL 单独 Tab；
3. IMPORTED 单独 Tab；
4. 异常 CLOSED 不再显示假 -4000 / -2000%；
5. fee unknown 不再显示 $0；
6. 点击“同步交易记录”；
7. 选择最近5小时；
8. 最大500；
9. Preview；
10. Apply；
11. 相同范围第二次 Apply；
12. 第二次新增=0；
13. 最后同步状态刷新；
14. Dashboard net PnL 与 canonical COMPLETE 汇总一致；
15. Experience 与 canonical COMPLETE 对应。

---

## 20. 回归与验收

执行：

`npm run typecheck`
`npm run test`
`npm run build`

全部 PASS。

Restart 后：

- `/health=READY`
- Market LIVE
- Binance Private READY

本轮不需要完整60分钟交易验收。

做：
- 10~15分钟 readonly smoke
- TradeRecord sync 专项验收
- duplicate/idempotency 专项验收

---

## 21. 最终报告必须明确回答

- 原总记录数如何分类
- COMPLETE 数量
- PARTIAL 数量
- IMPORTED 数量
- EXTERNAL 数量
- DUPLICATE 数量
- INVALID 数量
- ±2000% 根因
- fee unknown=0 根因
- 清洗后 canonical 数量
- 净收益前后变化
- Experience 前后变化
- 第一次5h同步结果
- 第二次相同范围同步新增是否为0

---

## 22. 退出条件

只有以下全部完成才允许结束：

- 分类完成
- invalid CLOSED 修复
- ±2000% 修复
- unknown fee 不再显示0
- COMPLETE 默认主列表
- PARTIAL/IMPORTED/EXTERNAL/ISSUES 分Tab
- 手动同步
- Preview
- Confirm
- Apply
- 幂等
- Canonical
- Sync history
- Dashboard汇总一致
- Experience去重
- typecheck PASS
- tests PASS
- build PASS
- browser PASS
- readonly smoke PASS
- 普通 TODO/PARTIAL/PENDING=0

---

## 23. 版本

完成后：

# ZDJ-MITS V3.3.4
## TradeRecord Data Hygiene & Manual Sync Hotfix

完成后 TradeRecord 才作为长期可信收益账本。

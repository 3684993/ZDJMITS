# Codex 5.6 Sol — ZDJ-MITS V3.3.4 TradeRecord 数据清洗与手动同步执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

读取并执行：

`ZDJ-MITS-V3.3.4-TradeRecord数据清洗-去重-分类-手动同步热修复实施计划.md`

本轮只修 TradeRecord 数据可信度和手动同步，不重构 Market / Pool / AI / Entry / TP。

当前明确异常：

- 交易记录总数很多，但真正 COMPLETE 很少；
- 多条 CLOSED 没有 Exit；
- fee unknown 却显示 $0.00；
- PnL 接近 -$4000；
- ROI 固定 ±2000%；
- IMPORTED_OPEN_POSITION 与完整交易混在主列表。

先直接调查 SQLite 当前全部 TradeRecord，不要猜。

一次性完成：

1. 对全部记录分类：COMPLETE / PARTIAL / IMPORTED / EXTERNAL / DUPLICATE / CONFLICT / INVALID；
2. `CLOSED + no Exit` 不能继续作为完整记录；
3. fee unknown 必须显示 `—`，禁止当 `$0.00`；
4. 找出 ±2000% ROI 的真实代码根因，缺 margin/exit 时显示 `—`，禁止 sentinel/clamp 冒充真实值；
5. 交易记录页改 Tabs：
   - 完整交易（默认）
   - 待完善
   - 导入持仓
   - 外部/未托管
   - 数据问题
6. Dashboard净收益和Experience只统计 canonical `CLOSED + COMPLETE + fee COMPLETE`；
7. 同一 lifecycle 多记录时选择 canonical，其余标 `duplicateOf`，保留审计但排除收益；
8. 增加“同步交易记录”按钮；
9. Dialog支持 1h / 5h / 24h / custom，max fills 100/300/500/1000，默认5h/500；
10. 默认只同步系统可关联成交，并支持修复PARTIAL、补齐fee、重算netPnl；
11. 必须 `Preview → Confirm → Apply`，Preview绝对不写库；
12. Preview显示 fills、system/external、cycles、existing COMPLETE、repairable PARTIAL、new COMPLETE、duplicates/conflicts/unclosable；
13. Apply 必须 transaction + idempotent；相同范围连续同步两次，第二次新增必须为0；
14. 增加 sync history 和 audit；
15. 增加 TradeRecord Integrity Check；
16. TradeRecord Detail 展示 completeness、fee completeness、source、repair source、linked fills、canonical/duplicate；
17. 清洗前备份相关表或整个SQLite；
18. Engine启动仍禁止自动扫30天历史；
19. 手动同步只允许修改本地TradeRecord/Experience/lifecycle metadata，禁止任何Binance交易写操作。

必须补测试：

- CLOSED no exit → PARTIAL
- fee unknown → null
- missing margin → ROI null
- same sync twice → no duplicate
- PARTIAL → COMPLETE
- COMPLETE skip
- imported不误关闭
- external默认skip
- canonical selection
- duplicate excluded from totals
- Preview no write
- Apply transactional/idempotent
- duplicate Experience不生成

完成后：

`npm run typecheck`
→ `npm run test`
→ `npm run build`
→ restart

浏览器真实验收：

- 默认只看COMPLETE；
- PARTIAL/IMPORTED分开；
- 假-$4000/-2000%消失；
- unknown fee不再$0；
- 5h/500 Preview；
- Apply；
- 相同范围再次Apply；
- 第二次新增=0；
- Dashboard净收益与canonical COMPLETE一致；
- Experience与canonical COMPLETE一致。

本轮不跑完整60分钟，只做10~15分钟readonly smoke + sync专项验收。

最终报告必须明确：

- 原总记录数及分类
- COMPLETE/PARTIAL/IMPORTED/EXTERNAL/DUPLICATE/INVALID数量
- ±2000%根因
- fee unknown=0根因
- 清洗后canonical数量
- 净收益前后
- Experience前后
- 第一次5h同步结果
- 第二次重复同步新增是否为0

普通 TODO/PARTIAL/PENDING 未清零前禁止 checkpoint 停止。

现在直接调查并实施，不先写新计划。

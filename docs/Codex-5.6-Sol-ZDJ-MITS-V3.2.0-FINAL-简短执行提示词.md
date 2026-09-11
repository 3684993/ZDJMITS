# Codex 5.6 Sol — ZDJ-MITS V3.2.0 FINAL 执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS，使用当前真实工作树，不重新搭项目。

读取并执行：

`ZDJ-MITS-V3.2.0-FINAL-正式运行交付版-全量优化修复实施计划.md`

这是正式运行前最后一次全量修复和验收。

先调查当前真实代码、SQLite、最近 3 小时日志/AI audit、Binance Testnet 订单与持仓、最近 acceptance；对计划逐项判断 `ALREADY_IMPLEMENTED / NEEDS_FIX / NEEDS_HARDENING`，不要机械修改。

必须优先纠正一个 P0：

**15m 只决定方向，不允许把 AI FAILED、REJECT_CANDIDATE 或无法可靠解析的输出自动转换成 PLACE。**

最终规则：

- Primary 正常请求必须给 `direction=LONG|SHORT`；
- `decision=PLACE_LONG|PLACE_SHORT|REJECT_CANDIDATE`；
- `direction=LONG` 可以合法对应 `REJECT_CANDIDATE`；
- AI FAILED → fail-closed，不创建 Entry Intent；
- Raw REJECT → Normalized REJECT；
- 禁止 AI_FAILED/REJECT fallback 为 15m 自动下单。

逐笔审计最近：
`PLACE_LONG=9 / PLACE_SHORT=7 / Binance新订单=10`
解释 16 个 PLACE 到 10 个订单的每一笔真实去向，禁止静默丢链。

本轮同时一次性完成：

1. Pool refill：持仓/挂单只排除自身，Top候选被占用后继续从 Universe 后方补位；
2. AI 调度：查清 >10 分钟闲置后突然扎堆的原因，改成有候选时按资源能力持续平稳消费；
3. AI 大脑实时显示 current status / symbol / direction / decision / idle reason / next step；
4. AI Trace 每条可点开看：
   EIP → Scout Input → Scout Raw/Normalized → Primary Input → Raw Output → Normalized Decision → Timing → Errors；
5. 驾驶舱：
   - “总览”改“驾驶舱”；
   - 删除右上角重复摘要；
   - 复用“交易记忆”统计卡样式；
   - 5 个 KPI 桌面横排；
   - 金额格式化；
   - USDT/USDC/BTC/其它非零资产横向显示；
6. Pipeline 改中文图形化：
   实时行情 → 智能选币 → 候选过滤 → 动态交易池 → 9B证据整理 → 27B入场决策 → 挂单管理 → Binance执行；
   RECOVERING JSON 只进详情，不撑满主界面；
7. 驾驶舱显示：当前工作 / 最近决策 / 下一步；
8. Active Orders 不显示 CANCELED/EXPIRED/REJECTED/FILLED，但历史审计绝不能删除；
9. Position/TP：
   - AUTO_MANAGED / TP_PROTECTED / TP_MISSING / TP_REPAIRING / TP_REPAIR_FAILED / HUMAN_MANAGED；
   - 恢复真实建仓时间；
   - 缺 TP 红色提醒；
   - 优先确定性自动补 TP；
   - 确定性信息不足时才允许 9B/27B 给 TP recommendation；
   - 最终仍由 TP Manager/AccountExecutor 校验并下单；
10. 持仓超过设置时间进入 HUMAN_MANAGED；系统不主动平仓，但继续同步持仓和 TP；
11. 严禁新增自动止损；
12. 10 套主题继续使用 semantic tokens；
13. Testnet/Production credential 与 endpoint 强隔离，未经明确切换 Production private write 保持 blocked；
14. Production Mock path=0。

全部开发完成后：

`npm run typecheck`
→ `npm run test`
→ `npm run build`
→ restart
→ 浏览器真实检查全部页面
→ 自动运行至少 60 分钟 Testnet acceptance。

最终 acceptance 必须检查：
Market freshness、Universe/Eligible/Pool、candidate turnover、AI idle/burst、Direction、PLACE/REJECT/FAILED、Raw-vs-Normalized 一致性、Entry Intent 到 Binance orderId、active orders、Position/TP coverage、Human Handoff、fatal/exit code。

禁止以“进程没崩”作为 PASS；
禁止制造 PLACE；
禁止 Raw REJECT → PLACE；
禁止 AI FAILED → PLACE。

执行规则：

`调查 → 修改 → 测试 → 更新进度 → 搜索剩余未完成项 → 继续`

普通 `TODO/PARTIAL/PENDING` 未清零前禁止 checkpoint 退出。

只有普通未完成项=0且完整 60 分钟验收完成，才允许最终回复。

现在直接执行，不先写新计划。

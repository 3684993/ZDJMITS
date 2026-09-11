# Codex 5.6 Sol — ZDJ-MITS V3.3.0 执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS。

读取：

- `ZDJ-MITS-V3.2.0-当前系统诊断报告-2026-08-24.md`
- `ZDJ-MITS-V3.3.0-正式运行稳定与产品化升级实施计划-2026-08-24.md`

先基于当前代码、SQLite、最近3小时 AI audit、Binance Testnet 当前持仓/委托和本地 03:00–10:00 交易事实独立调查。对计划逐项 `ALREADY_IMPLEMENTED / NEEDS_FIX / NEEDS_HARDENING / REJECT`，不要机械照改。

本轮最重要的 P0：

1. 当前 Market/Pool/Private/Entry Permission 都正常，但 Primary 已长期真实 100% `REJECT_CANDIDATE`。必须查清 Prompt/证据语义为什么把“1m/5m短时冲突、等待回调、BB位置、量能、orderbook、高周期背景”组合成全拒绝。
2. 保持安全边界：`AI_FAILED` 和 Raw REJECT 绝不能 fallback 为 PLACE。
3. 15m 继续决定 LONG/SHORT；1m/5m主要决定入场价格。若只是“等回调/当前价不理想”且存在1–5m可达Maker区间，应优先输出可执行价格区间，而不是机械REJECT。真正硬不可执行才REJECT。
4. 调查并优化固定45秒节拍，目标是 Scout/Primary 单并发、无扎堆，但有候选时持续流水；可让 Scout 最多预取下一个候选，Primary永不重叠。
5. 增加建仓活动监控：Market/Pool/AI/Entry Permission 全READY却长期无 PLACE/Intent 时，驾驶舱必须报警并给真实原因；报警不能强制下单。

同时完成：

- TP Guardian 双向一致性：每个Position有TP，每个TP必须有Position；清除 orphan/duplicate/qty mismatch；
- 订单页只显示当前活动 Entry/TP，终态订单退出UI但保留审计；
- 新增独立“交易记录”菜单，建立本地 TradeRecord：Entry→Close，记录 entry/exit fee、毛收益、净收益；
- 驾驶舱把“24h已实现收益”改成“交易记录净收益”；
- 系统启动不导入交易所历史交易，只使用本地记录；启动前已有Position以 firstObservedAt 管理，不允许 UNKNOWN 计算出几十万小时；
- 交易记忆从本地 CLOSED TradeRecord 自动生成；
- Position主表简化为：时间、币种、方向、TP状态、操作；盈利用绿色视觉、亏损红色；点击进入详情和人工挂单管理；
- 市场智能修好多周期表、Portfolio/Experience JSON、reachable band，并核实 OI/Funding/Taker/LongShort；
- AI Run 每条必须真实可点击，看系统给AI的数据、Scout返回、Primary输入、Raw Output、Normalized Decision、Errors；
- 运行中心全面中文化，原始JSON收进详情；
- Settings 改为 Tabs：策略、交易所、代理、AI资源、主题；交易所/代理/AI资源支持新增、删除、测试、启用；OKX/Coinbase只做模板，没Adapter时禁止假装可用；
- 主题下拉保留，sidebar active颜色必须跟主题token变化；
- 驾驶舱“当前活动委托”必须统计 Entry+TP，副标题拆分数量，禁止TP存在但显示0。

最终对比本地 03:00–10:00 与修复后：
Primary/hour、unique symbols、PLACE rate、Intent/hour、submit/hour、fill/hour、TP/hour、reject rate、AI idle/burst。

完成：
`typecheck → tests → build → restart → 浏览器逐页验证 → 至少60分钟Testnet验收`

禁止：
- 强制每次PLACE；
- AI失败/REJECT自动下单；
- 自动止损；
- AI直接写Binance；
- 拉取交易所历史成交来填充交易记忆；
- 完成一个子任务后checkpoint退出。

只有普通 TODO/PARTIAL/PENDING=0、100% REJECT根因真实修复、TP无孤儿/重复、TradeRecord/Memory形成闭环、UI与60分钟验收完成，才允许最终回复。

现在直接调查并实施，不先写新计划。

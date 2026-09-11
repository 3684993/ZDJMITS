# ZDJ-MITS V3.3.3 TradeRecord 闭环与手续费感知 TP 优化实施验收报告

日期：2026-08-25  
范围：Binance Futures Testnet，TradeRecord 闭环、成交手续费、净收益、Experience、手续费感知止盈和生产候选验收。

## 一、执行边界

用户请求是“按执行提示词实施”。提示词和实施计划文件属于本次实现的约束、验收口径和已知问题说明；它们不是脱离用户请求的独立操作授权。本次没有把外部/人工成交伪造为系统成交，也没有通过审计或修复接口向 Binance 批量改历史订单、改现有 TP 或下单。

系统仍按现有 `TESTNET_ENABLED` 运行模式工作；本次 5 小时审计、TradeRecord 修复和 30 分钟验收本身均为只读观察/本地事实修复。

## 二、最终结论

最终生产候选验收通过。首次 30 分钟验收发现 2 次重算期间的短暂保护缺口，已定位为“重算先写入新持仓、随后异步认领/创建 TP”造成的快照中间态；增加重算与生产快照的串行化等待后重启系统，并重新执行完整 30 分钟验收。

第二轮验收结果：

- 60/60 次采样；失败采样 0。
- READY 0 异常、行情 LIVE 0 异常、私有数据 READY 0 异常。
- 对账错误 0 次。
- 持仓保护缺口 0 次。
- 完整 TradeRecord 净收益公式错误 0 次。
- 完整 TradeRecord 缺少 Experience 链接 0 次。
- 新建系统 TP 低于手续费/净收益要求 0 次。
- Engine 最终状态：`3.3.3 / READY / LIVE / private READY`。

证据目录：`D:\MITS\data\acceptance-v333-traderecord\20260825-115438`。

## 三、近 5 小时成交审计

审计证据：`D:\MITS\data\diagnostics\trade-audit-5h\20260825-105644\audit.json`。

- fills：330；income：314；orders：61；审计时当前持仓：21；open orders：23。
- 系统可归属成交：318；外部/未关联成交：12。12 条未被自动写成系统闭环记录。
- Entry fills：129，Maker 129/129。
- Exit fills：189，Maker 187/189。
- 系统成交 Maker：316/318；全量成交 Maker：328/330。
- Binance commission income：84 条，绝对值合计约 `22.88021711`。

本次修复入口明确标记为 `LOCAL_LIFECYCLE_REPAIR_FROM_EXCHANGE_FACT`，只修复由系统 client/order ID 和交易事实可证明的周期；外部手工成交不自动纳入系统收益。

## 四、修复结果与数据口径

最新修复结果：检测到 19 个周期，修复 15 个已闭合系统周期，其中手续费完整的 COMPLETE 周期 8 个，手续费不完整的 PARTIAL 周期 7 个；不满足完整 Entry + Exit/数量归零条件的周期不伪造为 CLOSED COMPLETE。

最终服务端汇总在动态 Testnet 持仓变化下保持以下核心结果：

- CLOSED + COMPLETE：8 条。
- TradeRecord 主收益净额：约 `$133.64798966`。
- 毛收益：约 `$146.47716`。
- 总手续费：约 `$12.82917034`。
- Experience：8 条，WIN 8 条，LOSS 0 条。
- 完整记录公式：`netPnl = grossRealizedPnl - entryFee - exitFee`，并保留手续费资产、金额和换算来源。

未完成或手续费事实不完整的记录保留审计状态，但不进入主收益汇总和 Experience，避免把零手续费误报成真实净收益。

## 五、实施内容

- 新增 `PositionLifecycleTracker`，覆盖 Flat → Entry → Position → Reduce/Add → Close → Flat，并持久化生命周期、成交填充和重启恢复事实。
- 接入 `ORDER_TRADE_UPDATE`、`ACCOUNT_UPDATE` 和定时对账；数量减少/归零时统一完成 TradeRecord 关闭和 Experience 生成。
- 新增一次性 5 小时只读审计及幂等本地修复接口，不在启动时自动导入历史。
- 新增统一 `TradingCostModel`，纳入 Entry fee、Exit fee、Maker/Taker、手续费安全缓冲、滑点缓冲、最低净收益和 ROI 门槛。
- TP 新建前计算 break-even、最低盈利价和预期净收益；新建 TP 不允许低于成本/净收益安全线。现有 Binance TP 仅审计，不批量修改。
- TradeRecords 增加建仓费、平仓费、总手续费、毛收益、净收益、Net ROI；净收益颜色按净口径显示。
- Experience 的胜负按净收益判定。
- Settings 增加最低净收益、最低 ROI、手续费缓冲、Exit fee assumption、滑点缓冲和 TP Economics 开关。
- Position Detail 增加 TP Economics 卡片，展示预计毛收益、总成本、净收益、最低要求、Break-even、最低盈利价和状态。
- 修复重算期间快照可能暴露未完成 TP 保护状态的问题：`ReconciliationService` 提供 settle 等待，`/api/v3/snapshot` 在重算完成后返回生产快照。
- Dashboard 版本标识同步为 `ZDJ-MITS V3.3.3 POSITION CONSOLE`。

## 六、验证与交付

- `npm run typecheck`：通过。
- `npm run test`：通过；Core 16 项、Dashboard 5 项、Engine 35 项，共 56 项测试通过。
- `npm run build`：通过。
- Engine 已重启，当前 PID 和健康状态见最终机器总结文件。
- Dashboard 5173 服务已恢复并可访问；浏览器已验证 TradeRecords、Settings、Positions 控制台、TP Economics 和分页。

浏览器截图：`D:\MITS\data\diagnostics\trade-audit-5h\20260825-105644\final-v333-ui.png`。

## 七、已知审计状态

当前部分历史导入/认领持仓的现有 TP 仍可能显示 `TP_LOW_NET`，这是对已存在 Binance open order 的审计事实，不代表新建违规；本次遵守“不批量修改现有 TP”的边界。最终快照中持仓均为 `PROTECTED`，TP Economics 状态随市场价格和数量动态变化。

机器可读最终总结：`D:\MITS\data\acceptance-v333-traderecord\20260825-115438\final-summary.json`。

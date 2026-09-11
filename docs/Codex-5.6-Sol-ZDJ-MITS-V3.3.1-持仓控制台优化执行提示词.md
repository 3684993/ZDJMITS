# Codex 5.6 Sol — ZDJ-MITS V3.3.1 持仓控制台优化执行提示词

继续 `D:\MITS` 当前 ZDJ-MITS V3.3.0 FINAL。

读取并执行：

`ZDJ-MITS-V3.3.1-持仓详情-浮动盈亏-人工交易控制台优化实施计划.md`

本轮是 V3.3.1 小版本，只增强持仓页面与人工 Position 操作，不重构已经通过验收的 Market/Pool/AI 自动交易架构。

先检查当前代码和 Git history。用户明确说旧版本已有“持仓图表 + 人工管理”，优先找旧组件、旧 API、旧 chart、旧 manual intent；兼容当前架构的优先恢复/迁移，不要无意义重写，也禁止恢复任何绕过 AccountExecutor 的旧调用链。

一次性完成：

1. “当前 PnL”改名“浮动盈亏”；
2. 浮动盈亏 >0 绿色，<0 红色，=0 中性，金额和 ROE 一致，使用主题 token；
3. 核对 unrealizedPnl / ROE 数据来源，发现口径错误一并修复；
4. 点击详情后改成专业持仓控制台：
   - 左侧 65~72% 当前 symbol 图表；
   - 右侧 28~35% 人工管理；
   - 移动端上下布局；
5. 图表至少支持 1m/5m/15m/4h，默认15m；
6. 图表至少显示 K线和 Entry / Mark / TP 标线，优先复用现有 EMA/BB/Volume；
7. 图表数据只走 Engine/Market Data Hub，禁止前端直连 Binance；
8. 右侧必须提供：
   - 减仓
   - 补仓
   - 紧急平仓
   - 挂单委托
   - 修改/重建TP
9. 减仓默认 reduce-only limit/maker；
10. 补仓为人工同方向增仓，不经过AI；成交后必须更新TP覆盖数量；
11. 紧急平仓只能人工触发，不得变成自动止损：
   - 优先快速 reduce-only limit；
   - 若现有Adapter安全支持，可显式提供 reduce-only market；
   - market emergency close必须二次确认；
12. 所有写操作严格：
   `Dashboard → ManualIntent → Validation → AccountExecutor → Binance → Audit`
13. Manual Add/Reduce/Close 与 reconciliation、TP Guardian、TradeRecord、Orders 联动；
14. Emergency Close 过程中禁止 TP Guardian 并发补 TP，Position=0 后清理残余 TP；
15. 当前 symbol 的人工活动订单必须同时出现在订单页；
16. 详情下方提供持仓事实、TP、活动订单、交易记录、AI/EIP只读参考、审计；
17. AUTO_MANAGED/HUMAN_MANAGED 都允许用户人工操作；
18. 加 qty/price/precision/minNotional/margin/reduceOnly/PostOnly/idempotency 校验；
19. 错误必须人类可读，禁止只显示500；
20. 新人工动作必须写持久化 audit，禁止 Secret；
21. 新 UI 完整支持现有10套主题。

必须补测试：

- PnL红绿；
- reduce/add校验；
- manual side/reduceOnly；
- duplicate submit；
- position消失竞争；
- 补仓后TP qty；
- 减仓后TP qty；
- 紧急平仓后Position=0、残余TP清理、TradeRecord联动。

完成后：

`npm run typecheck → npm run test → npm run build → restart`

浏览器真实验证：

- 浮动盈亏字段；
- 负值红色；
- 自然有正值则验证绿色，否则组件测试验证，禁止伪造生产数据；
- 详情；
- 图表；
- 1m/5m/15m/4h；
- Entry/Mark/TP标线；
- 右侧管理；
- 减仓/补仓/挂单/紧急平仓；
- 二次确认；
- Orders/TP/TradeRecord联动；
- Theme/响应式。

如果本轮没有修改 Scheduler/Market/AI 自动链，不需要再跑完整60分钟AI验收；运行15~30分钟Testnet smoke + Manual Position Action专项验收即可。

普通 TODO/PARTIAL/PENDING 未清零前禁止 checkpoint 停止。

完成一项继续下一项，全部完成后才回复最终报告。

现在直接调查并实施，不先写新计划。
